#!/usr/bin/env python3
"""
greenway_announcer.py — the Greenway order announcer agent.

Runs on a Raspberry Pi in the office, on the sales floor, or in storage. Its
whole job is: ask the website if there is an order to announce, and if there
is, make a noise.

WHY IT IS SHAPED THIS WAY
-------------------------
The Pi makes an OUTBOUND long-poll to the website. Nothing connects INTO the
shop, which means:

  * no port forwarding, no firewall holes, no router configuration;
  * no static IP and nothing breaks when the ISP rotates the shop's WAN address;
  * adding a fourth speaker is plugging in a fourth Pi, not editing a router;
  * it works identically on Wi-Fi, on Ethernet, and on a phone hotspot.

The website holds each request open for up to ~25 seconds waiting for work, so
an order is announced within about a second of being placed without hammering
the server.

THE RULES THIS FILE OBEYS
-------------------------
1. NEVER EXIT. Any unexpected error is caught, logged, and retried. systemd
   would restart us anyway, but a process that stays up keeps its backoff state
   and its warm audio device, and it does not spam the journal with restarts.
2. NEVER GO SILENT WITHOUT SAYING WHY. Every failure path writes one plain
   English line to the journal, including what to do about it.
3. NEVER PLAY THE SAME ORDER TWICE. Jobs are acknowledged by id, and ids
   already played are remembered.
4. ALWAYS MAKE SOME NOISE. If a custom sound file is missing or unplayable, we
   fall back to a built-in tone rather than failing silently. A wrong-sounding
   announcement is infinitely better than no announcement.

Requires: Python 3.9+ (Raspberry Pi OS Bookworm ships 3.11) and the `requests`
library. Audio playback uses ALSA's `aplay`, which is present on every
Raspberry Pi OS image, with `mpg123` used only if an MP3 is supplied.
"""

from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import math
import os
import platform
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:  # pragma: no cover - guidance path, not logic
    print(
        "The 'requests' library is missing.\n"
        "Fix it by running:  sudo apt install -y python3-requests\n",
        file=sys.stderr,
    )
    raise SystemExit(2)

AGENT_VERSION = "1.1.0"

# Where the pairing result lives. Root-owned, mode 600: it holds the device key.
DEFAULT_CONFIG_PATH = Path("/etc/greenway-announcer/config.json")
# Where downloaded custom sounds are cached.
DEFAULT_CACHE_DIR = Path("/var/lib/greenway-announcer/sounds")

# Backoff between failed polls, in seconds. Mirrors POLL_BACKOFF_SECONDS in
# src/lib/announcer/announcer-core.ts so the Pi and the server agree.
POLL_BACKOFF_SECONDS = [1, 2, 5, 10, 20, 30]

# Hard ceiling on a single HTTP call. The server holds a poll for ~25s, so this
# must be comfortably longer or we would abandon good requests.
POLL_TIMEOUT_SECONDS = 45
SHORT_TIMEOUT_SECONDS = 15

# How many played ids to remember. Generous: the server expires jobs long
# before this fills, and it costs a few kilobytes.
PLAYED_MEMORY = 500

log = logging.getLogger("greenway-announcer")


# ============================================================================
# PURE HELPERS — no I/O, unit-testable. See selftest().
# ============================================================================

def backoff_for(consecutive_failures: int) -> int:
    """
    How long to wait after N consecutive failures.

    Deliberately capped: a speaker that has been offline for an hour must still
    retry every 30 seconds, so it recovers on its own the moment the network
    comes back. Unbounded exponential backoff would mean a Pi that quietly stays
    dead for hours after a brief outage.
    """
    if consecutive_failures <= 0:
        return 0
    index = min(consecutive_failures - 1, len(POLL_BACKOFF_SECONDS) - 1)
    return POLL_BACKOFF_SECONDS[index]


def normalize_volume(raw: Any) -> int:
    """
    Clamp a volume to 0..100.

    Mirrors normalizeVolume() in announcer-core.ts, including its most important
    property: junk becomes the default 70, NEVER 0. A silent speaker caused by a
    bad value is the failure mode this whole project exists to prevent.
    """
    default = 70
    if isinstance(raw, bool):
        return default
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str) and raw.strip() != "":
        try:
            value = float(raw.strip())
        except ValueError:
            return default
    else:
        return default
    if math.isnan(value) or math.isinf(value):
        return default
    return max(0, min(100, int(round(value))))


def volume_to_alsa_percent(volume: int) -> str:
    """ALSA wants a percentage string. Kept separate so it can be asserted."""
    return f"{max(0, min(100, int(volume)))}%"


def is_builtin_sound(sound: str) -> bool:
    """
    Built-ins are bare ids ('chime'); custom sounds are storage paths with a
    slash or a file extension. Getting this wrong means trying to download
    'chime', so it is pinned by tests.
    """
    if not isinstance(sound, str) or sound.strip() == "":
        return False
    s = sound.strip()
    return "/" not in s and "." not in s


def safe_cache_name(storage_path: str) -> str:
    """
    Turn a storage path into a flat, safe filename.

    Path traversal is not a security concern here (the server is trusted) but
    '../..' in a filename would still break the cache, so it is neutralised.
    """
    cleaned = []
    for ch in storage_path.strip():
        cleaned.append(ch if (ch.isalnum() or ch in "-_.") else "_")
    name = "".join(cleaned).strip("._") or "sound"
    return name[:120]


def parse_jobs(payload: Any) -> List[Dict[str, Any]]:
    """
    Pull the job list out of a poll response, tolerating anything.

    A malformed job is skipped rather than crashing the loop: one bad row must
    never stop the other speakers' announcements from being handled.
    """
    if not isinstance(payload, dict):
        return []
    raw_jobs = payload.get("jobs")
    if not isinstance(raw_jobs, list):
        return []
    jobs: List[Dict[str, Any]] = []
    for item in raw_jobs:
        if not isinstance(item, dict):
            continue
        job_id = item.get("id")
        if job_id is None or str(job_id).strip() == "":
            continue
        jobs.append(
            {
                "id": str(job_id),
                "kind": item.get("kind") if item.get("kind") in ("order", "test") else "order",
                "message": item.get("message") if isinstance(item.get("message"), str) else "",
                "sound": item.get("sound") if isinstance(item.get("sound"), str) else "chime",
                "volume": normalize_volume(item.get("volume")),
            }
        )
    return jobs


def describe_http_error(status: int) -> str:
    """
    Plain English for an HTTP status, with the fix attached.

    This text ends up in the journal and in `greenway-announcer status`, so it
    is written for somebody standing in a storage room, not for a developer.
    """
    if status == 401:
        return (
            "The website rejected this speaker's key (401). "
            "Re-pair it: run 'sudo greenway-announcer pair <CODE>' with a fresh "
            "code from the Announcer page in the back office."
        )
    if status == 404:
        return (
            "The announcer address was not found (404). "
            "Check the site URL in the config file is correct and has no typo."
        )
    if status in (502, 503, 504):
        return (
            f"The website is temporarily unavailable ({status}). "
            "This usually clears by itself; the speaker will keep retrying."
        )
    if 500 <= status:
        return f"The website returned an error ({status}). The speaker will keep retrying."
    if status in (202, 302, 303, 307, 308):
        # Observed for real on a live domain: a security gateway answers 202
        # with an HTML CAPTCHA page instead of passing the request through, so
        # the request never reaches the announcer code at all. "Unexpected
        # response (202)" would send the reader hunting for a pairing problem
        # that does not exist, so name the real cause.
        return (
            f"The website answered {status} instead of handling the speaker request. "
            "This usually means the address points at a domain behind a security "
            "gateway or CAPTCHA, which blocks automated requests before they reach "
            "the announcer code. Point this Pi at the address that serves the "
            "announcer software directly (run: greenway-announcer status to see "
            "the current one)."
        )
    if 200 <= status <= 299:
        return (
            f"The website answered {status}, which the speaker could not use. "
            "If the address sits behind a security gateway or CAPTCHA, point this "
            "Pi at the address that serves the announcer software directly."
        )
    return f"Unexpected response from the website ({status})."


def looks_like_html(text: str) -> bool:
    """
    Is this response body a web page rather than an answer from our API?

    A security gateway returns a CAPTCHA page, and printing that raw HTML at
    somebody standing at a Pi is useless noise. Detecting it lets us say what
    actually went wrong instead.
    """
    head = (text or "")[:400].lower()
    return any(marker in head for marker in ("<html", "<!doctype html", "sgcaptcha", "<meta"))


def site_typo_hint(raw: Any) -> str:
    """
    Name what is wrong with a mistyped website address, quoting it back.

    A missing colon ("https//site.com") is easy to make and easy to stare
    straight past: the eye reads the word "https" and moves on. Returns "" when
    nothing obvious is wrong, so the caller can print it unconditionally.
    """
    if not isinstance(raw, str):
        return ""
    shown = raw.strip()
    if not shown:
        return ""
    lower = shown.lower()
    for scheme in ("https", "http"):
        if lower.startswith(scheme + "//"):
            fixed = scheme + "://" + shown[len(scheme) + 2 :]
            return (
                f"\nYou typed:  {shown}\n"
                f"The ':' is missing after '{scheme}'. You want:\n  {fixed}"
            )
        if lower.startswith(scheme + ":/") and not lower.startswith(scheme + "://"):
            fixed = scheme + "://" + shown[len(scheme) + 2 :]
            return (
                f"\nYou typed:  {shown}\n"
                f"There is only one '/' after '{scheme}:'. You want:\n  {fixed}"
            )
    return ""


# ============================================================================
# AUDIO
# ============================================================================

# The built-in sounds, in the order `test` plays them. Defined once so the
# command and its selftest can never disagree about what the set is.
BUILTIN_SOUND_ORDER = ("chime", "bell", "ding", "alert", "cash", "voice")


def generate_tone_wav(path: Path, kind: str) -> None:
    """
    Write a built-in tone to disk as a WAV.

    Generated rather than shipped as binary assets so the agent is a single
    text file that can be read, audited, and repaired by hand. Every tone is a
    short two-note figure that carries over background noise in a shop.
    """
    sample_rate = 22050
    # (frequency_hz, seconds) pairs per built-in sound id.
    patterns: Dict[str, List[Tuple[float, float]]] = {
        "chime": [(880.0, 0.18), (1174.7, 0.32)],
        "bell": [(1318.5, 0.14), (1046.5, 0.14), (1318.5, 0.40)],
        "ding": [(1567.9, 0.12), (0.0, 0.05), (1567.9, 0.28)],
        "alert": [(784.0, 0.16), (523.3, 0.16), (784.0, 0.16), (523.3, 0.24)],
        "cash": [(1046.5, 0.09), (1318.5, 0.09), (1567.9, 0.09), (2093.0, 0.30)],
        "voice": [(659.3, 0.20), (830.6, 0.20), (987.8, 0.36)],
    }
    pattern = patterns.get(kind, patterns["chime"])

    frames = bytearray()
    for freq, seconds in pattern:
        count = int(sample_rate * seconds)
        for i in range(count):
            if freq <= 0.0:
                frames += struct.pack("<h", 0)
                continue
            # Fade in and out so the speaker does not click on every note.
            envelope = min(1.0, i / 220.0, (count - i) / 220.0)
            value = math.sin(2.0 * math.pi * freq * (i / sample_rate))
            frames += struct.pack("<h", int(22000 * envelope * value))

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(frames))


def usable_cache_dir(preferred: Path) -> Path:
    """
    Return a directory we can actually write tones into.

    The real cache lives in /var/lib/greenway-announcer, which is root-owned.
    `test` is the command somebody is most likely to run without sudo, and its
    entire purpose is to make a noise and prove the hardware. Refusing to play
    anything because a cache directory is not writable would be absurd, so fall
    back to a temp directory and carry on.
    """
    try:
        preferred.mkdir(parents=True, exist_ok=True)
        probe = preferred / ".write-probe"
        probe.write_bytes(b"")
        probe.unlink()
        return preferred
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "greenway-announcer-sounds"
        try:
            fallback.mkdir(parents=True, exist_ok=True)
        except OSError:
            return Path(tempfile.mkdtemp(prefix="greenway-sounds-"))
        return fallback


def ensure_builtin(cache_dir: Path, kind: str) -> Path:
    """Return a playable path for a built-in sound, generating it once."""
    path = cache_dir / f"builtin-{kind}.wav"
    try:
        fresh = path.exists() and path.stat().st_size > 0
    except OSError:
        # A locked-down parent makes exists() raise rather than return False.
        fresh = False
    if not fresh:
        generate_tone_wav(path, kind)
    return path


def parse_aplay_devices(text: str) -> List[Dict[str, Any]]:
    """
    Turn `aplay -l` output into a list of {card, device, id, name, is_headphone}.

    Written as a pure function so it can be asserted against real captured
    output instead of needing a sound card in CI.
    """
    devices: List[Dict[str, Any]] = []
    for line in (text or "").split("\n"):
        match = re.match(
            r"^card (\d+): (\S+) \[([^\]]*)\], device (\d+): (.*?)(?: \[|$)", line.strip()
        )
        if not match:
            continue
        card_id = match.group(2)
        card_name = match.group(3)
        device_name = match.group(5)
        blob = f"{card_id} {card_name} {device_name}".lower()
        # HDMI is checked FIRST and wins. On the common Raspbian layout the
        # analog jack and the HDMI output are BOTH exposed by the same
        # "bcm2835" card, so a naive "bcm2835 means headphone" test labels the
        # HDMI output as the analog jack and hands out the wrong buzz advice.
        is_hdmi = "hdmi" in blob or "iec958" in blob
        devices.append(
            {
                "card": int(match.group(1)),
                "device": int(match.group(4)),
                "id": card_id,
                # Prefer the per-device name when it adds something: one card
                # can expose several outputs, and "bcm2835 ALSA" twice tells
                # the reader nothing about which line is which.
                "name": device_name if device_name and device_name != card_name else card_name,
                "alsa": f"plughw:{match.group(1)},{match.group(4)}",
                # The Pi's built-in analog jack is driven by PWM and is the
                # known source of hiss/buzz complaints. A USB dongle or HAT is
                # a real DAC and does not have that problem.
                "is_headphone": (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob),
                "is_hdmi": is_hdmi,
            }
        )
    return devices


def detected_outputs() -> List[Dict[str, Any]]:
    """Ask ALSA what outputs exist. Returns [] rather than raising."""
    if shutil.which("aplay") is None:
        return []
    try:
        listing = subprocess.run(["aplay", "-l"], capture_output=True, timeout=10)
    except (subprocess.SubprocessError, OSError):
        return []
    return parse_aplay_devices((listing.stdout or b"").decode("utf-8", "replace"))


def explain_alsa_error(detail: str, devices: List[Dict[str, Any]]) -> Optional[str]:
    """
    Turn a raw aplay error into something a shop owner can act on.

    The message that started this: on a headless Pi,

        aplay: main:850: audio open error: Unknown error 524

    524 is not a userspace errno at all -- the highest real one is 132. It is
    the kernel's internal ENOTSUPP leaking out of an ALSA driver, and it means
    "the device exists but the driver will not open it". On a Raspberry Pi with
    no monitor plugged in, that is almost always the HDMI output being the
    default: the sound card is listed, so nothing looks wrong, but it cannot be
    opened because there is no display attached to carry the audio.

    Printing the raw text at somebody is useless. Naming the cause is not.
    """
    text = (detail or "").lower()
    if not text:
        return None

    hdmi = [d for d in devices if d["is_hdmi"]]
    analog = [d for d in devices if d["is_headphone"]]
    other = [d for d in devices if not d["is_hdmi"] and not d["is_headphone"]]

    if "524" in text or "not supported" in text or "no such device" in text:
        target = (other or analog or [None])[0]
        lines = [
            "The sound output exists but the driver refused to open it.",
        ]
        if hdmi:
            lines.append(
                "This Pi has an HDMI audio output, and HDMI is usually the default. "
                "With no monitor plugged in, HDMI audio cannot open -- which is "
                "exactly this error. Nothing is broken."
            )
        if target:
            lines.append(
                f"Send the sound to a real output instead: --audio-device {target['alsa']}"
            )
        return " ".join(lines)

    if "busy" in text or "resource busy" in text:
        return (
            "Something else is already using the sound output. Usually that is the "
            "announcer service itself. Stop it, test, then start it again:\n"
            "  sudo systemctl stop greenway-announcer\n"
            "  sudo greenway-announcer test\n"
            "  sudo systemctl start greenway-announcer"
        )

    if "no such file or directory" in text:
        return (
            "That audio output does not exist on this Pi. Run "
            "'sudo greenway-announcer audio' to see the real list."
        )

    if "permission denied" in text:
        return (
            "Not allowed to open the sound output. Run the command with sudo, or add "
            "the user to the 'audio' group:  sudo usermod -aG audio $USER"
        )

    return None


def diagnose_buzz(devices: List[Dict[str, Any]], chosen: Optional[str]) -> List[str]:
    """
    Explain a buzzing / static speaker, in the order the fixes are worth trying.

    The Pi's own 3.5 mm jack is PWM-driven and genuinely noisy: a constant hiss
    or buzz through it is normal behaviour for the hardware, not a fault in the
    speaker or this software. Saying so saves somebody replacing a perfectly
    good speaker.
    """
    notes: List[str] = []
    analog = [d for d in devices if d["is_headphone"]]
    usb = [d for d in devices if not d["is_headphone"] and not d["is_hdmi"]]

    using_analog = False
    if chosen:
        for d in analog:
            if chosen in (d["alsa"], f"hw:{d['card']},{d['device']}"):
                using_analog = True
    elif analog and not usb:
        using_analog = True

    if using_analog or (analog and not chosen):
        notes.append(
            "This Pi is playing through its own 3.5 mm headphone jack. That output is "
            "PWM-driven and is genuinely noisy: a steady hiss or buzz through it is "
            "normal for the hardware, not a broken speaker."
        )
        notes.append(
            "Most effective fix: turn the Pi's own volume DOWN to about 80% and turn "
            "the speaker's knob UP. Driving the Pi's jack at 100% is the single most "
            "common cause of buzzing and distortion."
        )
        if usb:
            notes.append(
                "Better fix: this Pi already has another audio output. Use it: "
                f"sudo ./install.sh --site <your-site> --audio-device {usb[0]['alsa']}"
            )
        else:
            notes.append(
                "Permanent fix: a $10 USB audio adapter is a real DAC and removes the "
                "noise completely. Plug it in, then re-run the installer with "
                "--audio-device pointing at it."
            )
    notes.append(
        "A buzz that is present even when nothing is playing is electrical, not audio: "
        "try a different USB power supply for the speaker, plug the speaker into a "
        "different mains socket from the Pi, or use a shorter/shielded audio cable."
    )
    notes.append(
        "A buzz ONLY while a sound plays usually means the level is too high. Lower the "
        "Pi's volume first, then the speaker's."
    )
    return notes


def set_alsa_volume(volume: int, control: Optional[str]) -> None:
    """
    Set the output volume.

    Best-effort by design: mixer control names vary across USB dongles and HATs,
    so a failure here is logged and ignored rather than blocking the sound. A
    slightly-wrong volume is not a reason to stay silent.
    """
    if shutil.which("amixer") is None:
        return
    controls = [control] if control else ["PCM", "Master", "Speaker", "Headphone"]
    for name in controls:
        if not name:
            continue
        try:
            result = subprocess.run(
                ["amixer", "-M", "sset", name, volume_to_alsa_percent(volume)],
                capture_output=True,
                timeout=5,
            )
            if result.returncode == 0:
                return
        except (subprocess.SubprocessError, OSError):
            continue
    log.debug("Could not set volume via amixer; playing at the current level.")


def play_file(path: Path, device: Optional[str]) -> Tuple[bool, str]:
    """
    Play one audio file. Returns (played, detail).

    WAV goes through aplay, which is on every Raspberry Pi OS image. MP3 needs
    mpg123; if it is missing we say exactly how to install it rather than
    failing with a stack trace.
    """
    if not path.exists():
        return False, f"Sound file is missing: {path}"

    suffix = path.suffix.lower()
    if suffix == ".mp3":
        player = shutil.which("mpg123")
        if player is None:
            return False, "MP3 playback needs mpg123. Install it: sudo apt install -y mpg123"
        cmd = [player, "-q"]
        if device:
            cmd += ["-a", device]
        cmd.append(str(path))
    else:
        player = shutil.which("aplay")
        if player is None:
            return False, "aplay is missing. Install it: sudo apt install -y alsa-utils"
        cmd = [player, "-q"]
        if device:
            cmd += ["-D", device]
        cmd.append(str(path))

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "Playback took too long and was stopped."
    except OSError as exc:
        return False, f"Could not start the audio player: {exc}"

    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()
        return False, f"Audio player failed: {detail or 'unknown error'}"
    return True, "played"


# ============================================================================
# CONFIG
# ============================================================================

def config_state(path: Path) -> str:
    """
    Can we read the config? Returns "readable", "denied" or "missing".

    Path.exists() RAISES PermissionError -- it does not return False -- when a
    parent directory is not searchable. The config lives in /etc/greenway-
    announcer, which the installer deliberately locks to mode 700 because the
    file holds this speaker's device key. So every `path.exists()` in this
    program was a crash waiting for the first person to run a command without
    sudo, which is exactly what happened in the field:

        greenway-announcer test
        PermissionError: [Errno 13] Permission denied:
          '/etc/greenway-announcer/config.json'

    Reproduced deliberately before fixing. "Denied" is a different state from
    "missing" and needs a different fix ("use sudo" vs "pair this speaker"), so
    it is reported separately rather than collapsed into a boolean.
    """
    try:
        return "readable" if path.exists() else "missing"
    except PermissionError:
        return "denied"
    except OSError:
        return "missing"


def needs_sudo_message(path: Path, command: str) -> str:
    """The fix, named, for somebody who forgot sudo."""
    return (
        f"Cannot read this speaker's settings at {path} (permission denied).\n"
        "That file is readable only by the administrator because it holds this\n"
        "speaker's key.\n\n"
        f"Run the same command with 'sudo' in front:\n"
        f"  sudo greenway-announcer {command}"
    )


def load_config(path: Path) -> Dict[str, Any]:
    state = config_state(path)
    if state == "denied":
        raise SystemExit(needs_sudo_message(path, "status"))
    if state == "missing":
        raise SystemExit(
            f"This speaker is not paired yet (no config at {path}).\n"
            "Pair it by running:  sudo greenway-announcer pair <CODE>\n"
            "Get a code from the Announcer panel on the Orders page in the back office."
        )
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(
            f"The config file at {path} could not be read ({exc}).\n"
            "Fix it by pairing again:  sudo greenway-announcer pair <CODE>"
        )
    for key in ("siteUrl", "deviceId", "deviceKey"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise SystemExit(
                f"The config file at {path} is missing '{key}'.\n"
                "Fix it by pairing again:  sudo greenway-announcer pair <CODE>"
            )
    return data


def save_config(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file in the same directory and rename, so a power cut
    # during the write cannot leave a half-written config behind.
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".config-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def agent_info() -> Dict[str, Any]:
    """Diagnostics the back office can show without anyone SSHing in."""
    info: Dict[str, Any] = {
        "agentVersion": AGENT_VERSION,
        "python": platform.python_version(),
        "hostname": platform.node(),
        "machine": platform.machine(),
    }
    try:
        model = Path("/proc/device-tree/model").read_text(errors="replace").strip("\x00").strip()
        if model:
            info["model"] = model
    except OSError:
        pass
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("PRETTY_NAME="):
                    info["os"] = line.split("=", 1)[1].strip().strip('"')
                    break
    except OSError:
        pass
    return info


# ============================================================================
# THE AGENT
# ============================================================================

class Announcer:
    def __init__(self, config: Dict[str, Any], cache_dir: Path) -> None:
        self.site_url = str(config["siteUrl"]).rstrip("/")
        self.device_id = str(config["deviceId"])
        self.device_key = str(config["deviceKey"])
        self.audio_device: Optional[str] = config.get("audioDevice") or None
        self.mixer_control: Optional[str] = config.get("mixerControl") or None
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers.update(
            {
                "x-announcer-device-id": self.device_id,
                "x-announcer-device-key": self.device_key,
                "content-type": "application/json",
                "user-agent": f"greenway-announcer/{AGENT_VERSION}",
            }
        )
        self.played: List[str] = []
        self.consecutive_failures = 0
        self.running = True
        self.last_ok_at: Optional[float] = None

    # -- lifecycle ---------------------------------------------------------

    def stop(self, *_: Any) -> None:
        log.info("Stop requested. Finishing the current poll and shutting down cleanly.")
        self.running = False

    def remember_played(self, job_id: str) -> None:
        self.played.append(job_id)
        if len(self.played) > PLAYED_MEMORY:
            del self.played[: len(self.played) - PLAYED_MEMORY]

    # -- network -----------------------------------------------------------

    def post(self, route: str, body: Dict[str, Any], timeout: int) -> Tuple[Optional[Any], Optional[str]]:
        url = f"{self.site_url}/api/announcer/{route}"
        try:
            response = self.session.post(url, json=body, timeout=timeout)
        except requests.exceptions.SSLError as exc:
            return None, f"Secure connection to the website failed: {exc}"
        except requests.exceptions.ConnectionError:
            return None, (
                "Cannot reach the website. Check this Pi's network cable or Wi-Fi, "
                "and that the shop's internet is up."
            )
        except requests.exceptions.Timeout:
            return None, "The website did not answer in time. Will retry."
        except requests.exceptions.RequestException as exc:
            return None, f"Network error: {exc}"

        if response.status_code != 200:
            return None, describe_http_error(response.status_code)
        try:
            return response.json(), None
        except ValueError:
            return None, "The website sent a reply that could not be understood."

    # -- sound resolution --------------------------------------------------

    def resolve_sound(self, sound: str) -> Path:
        """
        Turn the job's `sound` value into a file on disk.

        Falls back to the built-in chime at every failure point. This function
        is contractually incapable of returning a path that does not exist,
        because the alternative is a speaker that stays silent.
        """
        if is_builtin_sound(sound):
            try:
                return ensure_builtin(self.cache_dir, sound.strip())
            except Exception as exc:
                log.warning("Could not prepare built-in sound '%s' (%s). Using chime.", sound, exc)
                return ensure_builtin(self.cache_dir, "chime")

        cached = self.cache_dir / safe_cache_name(sound)
        if cached.exists() and cached.stat().st_size > 0:
            return cached

        try:
            url = f"{self.site_url}/api/announcer/sound?path={requests.utils.quote(sound, safe='')}"
            response = self.session.get(url, timeout=SHORT_TIMEOUT_SECONDS)
            if response.status_code == 200 and response.content:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(response.content)
                return cached
            log.warning(
                "Could not download the custom sound '%s' (HTTP %s). Using the built-in chime "
                "so the order is still announced.",
                sound,
                response.status_code,
            )
        except Exception as exc:
            log.warning("Could not download the custom sound '%s' (%s). Using the built-in chime.", sound, exc)

        return ensure_builtin(self.cache_dir, "chime")

    # -- work --------------------------------------------------------------

    def handle_job(self, job: Dict[str, Any]) -> Tuple[bool, str]:
        job_id = job["id"]
        if job_id in self.played:
            return True, "already played"

        set_alsa_volume(job["volume"], self.mixer_control)
        path = self.resolve_sound(job["sound"])
        played, detail = play_file(path, self.audio_device)

        if not played and path.suffix.lower() != ".wav":
            # Custom file would not play. Never leave the shop silent: fall back.
            log.warning("%s Falling back to the built-in chime.", detail)
            played, detail = play_file(ensure_builtin(self.cache_dir, "chime"), self.audio_device)

        if played:
            self.remember_played(job_id)
            log.info("Announced: %s", job["message"] or "(new order)")
        else:
            log.error("Could not play the announcement. %s", detail)
        return played, detail

    def poll_once(self) -> bool:
        payload, error = self.post("poll", {}, POLL_TIMEOUT_SECONDS)
        if error is not None:
            self.consecutive_failures += 1
            # Log the first failure loudly, then stay quiet until it recovers,
            # so an overnight outage does not fill the SD card with identical
            # lines. SD card wear is the number one killer of Pi appliances.
            if self.consecutive_failures == 1:
                log.error("%s", error)
            elif self.consecutive_failures % 20 == 0:
                log.error("Still failing after %d attempts: %s", self.consecutive_failures, error)
            return False

        if self.consecutive_failures > 0:
            log.info("Back in touch with the website after %d failed attempts.", self.consecutive_failures)
        self.consecutive_failures = 0
        self.last_ok_at = time.time()

        jobs = parse_jobs(payload)
        if not jobs:
            return True

        played_ids: List[str] = []
        failed: List[Dict[str, str]] = []
        for job in jobs:
            ok, detail = self.handle_job(job)
            if ok:
                played_ids.append(job["id"])
            else:
                failed.append({"id": job["id"], "reason": detail[:200]})

        if played_ids or failed:
            _, ack_error = self.post(
                "ack", {"played": played_ids, "failed": failed}, SHORT_TIMEOUT_SECONDS
            )
            if ack_error:
                # The job will lapse and be re-offered. Better a repeat than a
                # missed order, so this is a warning, not an error.
                log.warning("Could not confirm playback to the website: %s", ack_error)
        return True

    def run(self) -> int:
        log.info(
            "Greenway announcer v%s starting. Speaker id %s, site %s",
            AGENT_VERSION,
            self.device_id,
            self.site_url,
        )
        # Announce ourselves once so the dot goes green immediately rather than
        # after the first poll completes.
        _, hb_error = self.post("heartbeat", {"agentInfo": agent_info()}, SHORT_TIMEOUT_SECONDS)
        if hb_error:
            log.warning("First check-in did not go through: %s", hb_error)
        else:
            log.info("Checked in with the website. This speaker should now show green in the back office.")

        while self.running:
            try:
                ok = self.poll_once()
            except Exception as exc:  # never exit the loop
                self.consecutive_failures += 1
                log.exception("Unexpected problem while polling (%s). Continuing.", exc)
                ok = False

            if not ok and self.running:
                delay = backoff_for(self.consecutive_failures)
                # Sleep in short slices so a stop request is honoured promptly.
                waited = 0.0
                while waited < delay and self.running:
                    time.sleep(min(0.5, delay - waited))
                    waited += 0.5

        log.info("Greenway announcer stopped.")
        return 0


# ============================================================================
# COMMANDS
# ============================================================================

def cmd_pair(args: argparse.Namespace) -> int:
    site = args.site.rstrip("/") if args.site else None
    config_path = Path(args.config)

    if site is None and config_state(config_path) == "readable":
        try:
            site = str(json.loads(config_path.read_text(encoding="utf-8")).get("siteUrl", "")).rstrip("/")
        except Exception:
            site = None
    if not site:
        print("Which website? Pass it like:  sudo greenway-announcer pair ABCD2345 --site https://your-site.com")
        return 2

    code = "".join(ch for ch in args.code.upper() if ch.isalnum())
    print(f"Pairing this speaker with {site} using code {code} ...")

    try:
        response = requests.post(
            f"{site}/api/announcer/pair",
            json={"code": code, "agentInfo": agent_info()},
            timeout=SHORT_TIMEOUT_SECONDS,
        )
    except requests.exceptions.RequestException as exc:
        print(f"\nCould not reach {site}.\n  {exc}\n\nCheck this Pi's network and the site address, then try again.")
        typo = site_typo_hint(args.site)
        if typo:
            print(typo)
        return 1

    if response.status_code != 200:
        try:
            detail = response.json()
            message = detail.get("error") or detail.get("hint") or response.text
            hint = detail.get("hint")
        except ValueError:
            # A gateway/CAPTCHA page is not an error message. Printing the raw
            # HTML tells the reader nothing, so translate it instead.
            message = describe_http_error(response.status_code) if looks_like_html(response.text) else response.text
            hint = None
        print(f"\nPairing failed ({response.status_code}): {message}")
        if hint and hint != message:
            print(f"What to do: {hint}")
        return 1

    data = response.json()
    save_config(
        config_path,
        {
            "siteUrl": site,
            "deviceId": data["deviceId"],
            "deviceKey": data["deviceKey"],
            "deviceName": data.get("deviceName", ""),
            "audioDevice": args.audio_device or "",
            "mixerControl": args.mixer_control or "",
        },
    )
    print(
        f"\nPaired successfully as \"{data.get('deviceName', 'this speaker')}\".\n"
        f"Config saved to {config_path}\n\n"
        "Now start it:\n"
        "  sudo systemctl enable --now greenway-announcer\n\n"
        "Then press \"Test all speakers\" in the back office. You should hear a chime."
    )
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    """Play every built-in sound locally. Proves the hardware without the network."""
    cache_dir = usable_cache_dir(Path(args.cache_dir))
    device = args.audio_device or None
    # The config is root-only on purpose, and `test` is the command somebody is
    # most likely to run without sudo. Not being able to read the saved audio
    # device is not a reason to refuse to make a noise: say so and carry on
    # with the system default, because the whole point of this command is to
    # prove the hardware works.
    if not device:
        state = config_state(Path(args.config))
        if state == "readable":
            try:
                device = json.loads(Path(args.config).read_text(encoding="utf-8")).get("audioDevice") or None
            except Exception:
                device = None
        elif state == "denied":
            print(
                f"Note: cannot read the saved audio output from {args.config} without sudo,\n"
                "      so this test uses the system default. For the exact setup this\n"
                "      speaker uses, run:  sudo greenway-announcer test\n"
            )

    # Prove one sound can play before running all six. Six identical failures
    # in a row tell somebody nothing they did not know after the first.
    probe = ensure_builtin(cache_dir, BUILTIN_SOUND_ORDER[0])
    set_alsa_volume(args.volume, args.mixer_control)
    first_ok, first_detail = play_file(probe, device)

    devices = detected_outputs()

    if not first_ok and not args.audio_device:
        # The default output refused. Rather than reporting failure six times
        # and sending somebody to read `aplay -l` themselves, try every output
        # this Pi actually has and find the one that works. This is the whole
        # difference between "it is broken" and "use this one".
        explain = explain_alsa_error(first_detail, devices)
        print(f"  default output  FAILED — {first_detail}")
        if explain:
            print(f"\n{explain}\n")

        candidates = [d for d in devices if d["alsa"] != device]
        # Try real outputs before HDMI: on a headless Pi, HDMI is the one that
        # cannot work, and it is usually what the default already tried.
        candidates.sort(key=lambda d: (d["is_hdmi"], d["is_headphone"]))
        if candidates:
            print("Trying every output this Pi has, to find one that works:\n")
        for candidate in candidates:
            set_alsa_volume(args.volume, args.mixer_control)
            ok_try, detail_try = play_file(probe, candidate["alsa"])
            label = f"  {candidate['alsa']:<14} {candidate['name'][:28]:<28}"
            if ok_try:
                print(f"{label} WORKS")
                device = candidate["alsa"]
                first_ok = True
                print(
                    f"\nFound a working output: {device}\n"
                    "\nMake it permanent so the speaker uses it from now on. Run this\n"
                    "from the pi-agent folder:\n"
                    f"  sudo ./install.sh --site <your-site> --audio-device {device}\n"
                )
                break
            print(f"{label} no ({detail_try.splitlines()[0][:40]})")

    if not first_ok:
        print("\nNo sound could be played through any output on this Pi.")
        explain = explain_alsa_error(first_detail, devices)
        if explain:
            print(f"\n{explain}")
        print(
            "\nCheck these, in order:\n"
            "  1. Is the speaker plugged in and switched on?\n"
            "  2. Is its volume knob turned up?\n"
            "  3. Run 'sudo greenway-announcer audio' to see every output and its volume.\n"
            "  4. Run 'alsamixer' and check nothing is muted (MM means muted; press M to unmute)."
        )
        return 1

    # A working output is confirmed: now play the rest of the set.
    print("\nPlaying each built-in sound. You should hear six different tones.\n")
    print(f"  {BUILTIN_SOUND_ORDER[0]:<6} OK")
    failures = 0
    for kind in BUILTIN_SOUND_ORDER[1:]:
        path = ensure_builtin(cache_dir, kind)
        set_alsa_volume(args.volume, args.mixer_control)
        ok, detail = play_file(path, device)
        print(f"  {kind:<6} {'OK' if ok else 'FAILED — ' + detail}")
        if not ok:
            failures += 1
        time.sleep(0.4)

    if failures:
        print("\nSome sounds did not play, but others did, so the output itself works.")
        print("Try again; if it keeps happening run 'sudo greenway-announcer audio'.")
        return 1
    print("\nAll six sounds played. The audio hardware on this Pi is working.")
    if device:
        print(f"Output used: {device}")
    return 0


def cmd_audio(args: argparse.Namespace) -> int:
    """
    Diagnose the sound hardware: what outputs exist, which one is in use, what
    is muted, and what to do about a buzz.

    Added because the first speaker in the field came up "connected, green dot,
    but buzzing", and there was no single command that answered "what is this
    Pi actually plugged into?".
    """
    print("Sound hardware on this Pi")
    print("=" * 40)

    if shutil.which("aplay") is None:
        print("\naplay is missing. Install it:  sudo apt install -y alsa-utils")
        return 1

    try:
        listing = subprocess.run(["aplay", "-l"], capture_output=True, timeout=10)
        text = (listing.stdout or b"").decode("utf-8", "replace")
    except (subprocess.SubprocessError, OSError) as exc:
        print(f"\nCould not list the audio outputs: {exc}")
        return 1

    devices = parse_aplay_devices(text)
    if not devices:
        print("\nNo audio outputs found at all.")
        print("  1. If you are using the Pi's own headphone jack, make sure audio is")
        print("     enabled: check /boot/firmware/config.txt has 'dtparam=audio=on'.")
        print("  2. If you are using a USB adapter, unplug it and plug it back in,")
        print("     then run this again.")
        return 1

    print(f"\nFound {len(devices)} output{'' if len(devices) == 1 else 's'}:")
    for d in devices:
        kind = "Pi headphone jack (noisy PWM)" if d["is_headphone"] else (
            "HDMI" if d["is_hdmi"] else "USB / add-on card (recommended)"
        )
        print(f"  {d['alsa']:<16} {d['name']}  -- {kind}")

    # What is this speaker actually configured to use?
    chosen: Optional[str] = args.audio_device or None
    source = "the --audio-device you just passed"
    if not chosen:
        state = config_state(Path(args.config))
        if state == "readable":
            try:
                chosen = json.loads(Path(args.config).read_text(encoding="utf-8")).get("audioDevice") or None
                source = "this speaker's saved setting"
            except Exception:
                chosen = None
        elif state == "denied":
            print(
                f"\nNote: cannot read the saved output from {args.config} without sudo."
                "\n      Run 'sudo greenway-announcer audio' to see the real setting."
            )

    print("")
    if chosen:
        print(f"In use: {chosen}  (from {source})")
        if not any(chosen in (d["alsa"], f"hw:{d['card']},{d['device']}") for d in devices):
            print("  WARNING: that output is not in the list above. It may have been")
            print("           unplugged, or the name may be wrong.")
    else:
        print("In use: the system default (no specific output was chosen)")

    # Mixer levels: a too-high level on the Pi's jack is the usual buzz cause.
    if shutil.which("amixer") is not None:
        print("\nVolume controls:")
        try:
            controls = subprocess.run(["amixer", "scontrols"], capture_output=True, timeout=10)
            names = re.findall(
                r"Simple mixer control '([^']+)'", (controls.stdout or b"").decode("utf-8", "replace")
            )
        except (subprocess.SubprocessError, OSError):
            names = []
        if not names:
            print("  (none reported)")
        for name in names[:6]:
            try:
                got = subprocess.run(["amixer", "-M", "sget", name], capture_output=True, timeout=10)
                body = (got.stdout or b"").decode("utf-8", "replace")
            except (subprocess.SubprocessError, OSError):
                continue
            level = re.search(r"\[(\d+)%\]", body)
            muted = "[off]" in body
            shown = f"{level.group(1)}%" if level else "?"
            flag = "  MUTED - press M in alsamixer to unmute" if muted else ""
            print(f"  {name:<12} {shown}{flag}")
            if level and int(level.group(1)) >= 95:
                print("               ^ this is very high; try about 80% to stop buzzing")

    print("\nAbout that buzzing / static:")
    for note in diagnose_buzz(devices, chosen):
        print(f"  - {note}")

    print("\nNext step: play the tones and listen.")
    print("  greenway-announcer test")
    for d in devices:
        print(f"  greenway-announcer test --audio-device {d['alsa']}")
    return 0


def stale_install_warning(running: Path, repo_copy: Path) -> Optional[str]:
    """
    Warn when the installed program is older than the checked-out source.

    `git pull` updates the repository. It does NOT update the program, which
    lives at /usr/local/bin/greenway-announcer. Somebody who pulls and then
    runs a brand-new command gets "invalid choice", which reads like the fix
    was never shipped. It was: it just was not installed.
    """
    try:
        if not repo_copy.is_file() or not running.is_file():
            return None
        if repo_copy.read_bytes() == running.read_bytes():
            return None
    except OSError:
        return None
    return (
        "The installed program is not the same as the code in this folder.\n"
        "  'git pull' updates the folder; it does NOT update the installed program.\n"
        "  Install the new version (this keeps the existing pairing):\n"
        f"    cd {repo_copy.parent}\n"
        "    sudo ./install.sh --site https://greenwaywebsite1.vercel.app"
    )


def cmd_status(args: argparse.Namespace) -> int:
    config_path = Path(args.config)
    print(f"Greenway announcer v{AGENT_VERSION}")
    for key, value in agent_info().items():
        print(f"  {key}: {value}")

    # If a repo checkout sits next to this, say so when it has moved ahead.
    for candidate in (
        Path.home() / "GREENWAY-WEBSITE" / "pi-agent" / "greenway_announcer.py",
        Path("/home/greenway-office/GREENWAY-WEBSITE/pi-agent/greenway_announcer.py"),
    ):
        warning = stale_install_warning(Path(sys.argv[0]).resolve(), candidate)
        if warning:
            print(f"\n{warning}")
            break

    state = config_state(config_path)
    if state == "denied":
        # Distinct from NOT PAIRED: the speaker may be perfectly fine and this
        # is just a missing sudo. Telling somebody their speaker is unpaired
        # when it is not sends them off to re-pair for no reason.
        print(f"\n{needs_sudo_message(config_path, 'status')}")
        return 1
    if state == "missing":
        print(f"\nNOT PAIRED. No config at {config_path}.")
        print("Fix: sudo greenway-announcer pair <CODE> --site https://your-site.com")
        return 1

    try:
        config = load_config(config_path)
    except SystemExit as exc:
        print(f"\n{exc}")
        return 1

    print(f"\nPaired as: {config.get('deviceName') or '(unnamed)'}")
    print(f"  site:      {config['siteUrl']}")
    print(f"  device id: {config['deviceId']}")
    print(f"  audio out: {config.get('audioDevice') or '(system default)'}")

    print("\nChecking the connection to the website ...")
    session = requests.Session()
    session.headers.update(
        {
            "x-announcer-device-id": config["deviceId"],
            "x-announcer-device-key": config["deviceKey"],
            "content-type": "application/json",
        }
    )
    try:
        response = session.post(
            f"{config['siteUrl'].rstrip('/')}/api/announcer/heartbeat",
            json={"agentInfo": agent_info()},
            timeout=SHORT_TIMEOUT_SECONDS,
        )
    except requests.exceptions.RequestException as exc:
        print(f"  FAILED: cannot reach the website. {exc}")
        print("  Fix: check this Pi's network cable or Wi-Fi, and the shop's internet.")
        return 1

    if response.status_code == 200:
        print("  OK. The website answered and this speaker is checked in.")
        print("  It should show a green dot on the Orders page right now.")
        return 0
    print(f"  FAILED: {describe_http_error(response.status_code)}")
    return 1


def cmd_run(args: argparse.Namespace) -> int:
    config = load_config(Path(args.config))
    agent = Announcer(config, Path(args.cache_dir))
    signal.signal(signal.SIGTERM, agent.stop)
    signal.signal(signal.SIGINT, agent.stop)
    return agent.run()


# ============================================================================
# SELF-TEST — the agent proves its own logic, on the Pi, with no network.
# ============================================================================

def selftest() -> int:
    """
    Run the pure logic checks.

    This ships with the agent on purpose: when something is wrong at 9am on a
    Saturday, being able to run `greenway-announcer selftest` on the actual Pi
    and see 'ALL CHECKS PASSED' rules out the software in five seconds and
    points at the hardware or the network instead.
    """
    passed = 0
    failed = 0

    def eq(label: str, got: Any, want: Any) -> None:
        nonlocal passed, failed
        if got == want:
            passed += 1
        else:
            failed += 1
            print(f"FAIL: {label} -> got {got!r} want {want!r}")

    def ok(label: str, cond: bool) -> None:
        nonlocal passed, failed
        if cond:
            passed += 1
        else:
            failed += 1
            print(f"FAIL: {label}")

    # -- backoff ----------------------------------------------------------
    eq("backoff: no failures means no wait", backoff_for(0), 0)
    eq("backoff: first failure waits 1s", backoff_for(1), 1)
    eq("backoff: second waits 2s", backoff_for(2), 2)
    eq("backoff: sixth waits 30s", backoff_for(6), 30)
    eq("backoff: caps at 30s, never longer", backoff_for(999), 30)
    ok("backoff: never negative", all(backoff_for(n) >= 0 for n in range(-5, 50)))
    ok("backoff: recovery stays possible", backoff_for(100000) <= 30)

    # -- volume: the silent-speaker guard ---------------------------------
    eq("volume: 50 stays 50", normalize_volume(50), 50)
    eq("volume: 0 is honoured when deliberate", normalize_volume(0), 0)
    eq("volume: 150 clamps to 100", normalize_volume(150), 100)
    eq("volume: -20 clamps to 0", normalize_volume(-20), 0)
    eq("volume: None becomes 70 NOT 0", normalize_volume(None), 70)
    eq("volume: empty string becomes 70 NOT 0", normalize_volume(""), 70)
    eq("volume: junk text becomes 70 NOT 0", normalize_volume("loud"), 70)
    eq("volume: list becomes 70 NOT 0", normalize_volume([]), 70)
    eq("volume: dict becomes 70 NOT 0", normalize_volume({}), 70)
    eq("volume: False becomes 70 NOT 0", normalize_volume(False), 70)
    eq("volume: numeric string works", normalize_volume("42"), 42)
    eq("volume: float rounds", normalize_volume(42.6), 43)
    eq("volume: nan becomes 70", normalize_volume(float("nan")), 70)
    eq("volume: inf becomes 100", normalize_volume(float("inf")), 70)
    eq("alsa: 70 renders as percent", volume_to_alsa_percent(70), "70%")
    eq("alsa: clamps high", volume_to_alsa_percent(500), "100%")
    eq("alsa: clamps low", volume_to_alsa_percent(-5), "0%")

    # -- built-in detection -----------------------------------------------
    ok("builtin: chime is built-in", is_builtin_sound("chime"))
    ok("builtin: bell is built-in", is_builtin_sound("bell"))
    ok("builtin: a storage path is not", not is_builtin_sound("sounds/horn.mp3"))
    ok("builtin: a bare filename is not", not is_builtin_sound("horn.mp3"))
    ok("builtin: empty is not", not is_builtin_sound(""))
    ok("builtin: None is not", not is_builtin_sound(None))

    # -- cache names -------------------------------------------------------
    eq("cache: slashes flattened", safe_cache_name("a/b/c.mp3"), "a_b_c.mp3")
    ok("cache: traversal neutralised", "/" not in safe_cache_name("../../etc/passwd"))
    ok("cache: never empty", len(safe_cache_name("///")) > 0)
    ok("cache: length bounded", len(safe_cache_name("x" * 500)) <= 120)

    # -- job parsing -------------------------------------------------------
    eq("jobs: garbage yields none", parse_jobs(None), [])
    eq("jobs: missing key yields none", parse_jobs({}), [])
    eq("jobs: non-list yields none", parse_jobs({"jobs": "nope"}), [])
    good = parse_jobs({"jobs": [{"id": 7, "kind": "order", "message": "New order", "sound": "chime", "volume": 60}]})
    eq("jobs: one good job parsed", len(good), 1)
    eq("jobs: id stringified", good[0]["id"], "7")
    eq("jobs: volume normalised", good[0]["volume"], 60)
    mixed = parse_jobs({"jobs": [{"id": "1"}, "junk", {"no_id": True}, {"id": ""}, 42]})
    eq("jobs: malformed entries skipped, good kept", len(mixed), 1)
    eq("jobs: missing volume becomes 70 NOT 0", mixed[0]["volume"], 70)
    eq("jobs: missing sound defaults to chime", mixed[0]["sound"], "chime")
    eq("jobs: bad kind coerced to order", parse_jobs({"jobs": [{"id": "1", "kind": "weird"}]})[0]["kind"], "order")

    # -- error messages name the fix --------------------------------------
    ok("http 401 says re-pair", "pair" in describe_http_error(401).lower())
    ok("http 404 mentions the URL", "url" in describe_http_error(404).lower())
    ok("http 503 says it retries", "retry" in describe_http_error(503).lower())
    ok("every message is non-empty", all(len(describe_http_error(s)) > 0 for s in (200, 401, 403, 404, 500, 503, 599)))

    # A security gateway in front of the site answers 202 with a CAPTCHA page.
    # Proved against a real domain. "Unexpected response (202)" would send the
    # reader hunting for a pairing fault that does not exist.
    for gateway_status in (202, 302, 303, 307, 308):
        message = describe_http_error(gateway_status)
        ok(f"http {gateway_status} blames the security gateway", "gateway" in message.lower())
        ok(f"http {gateway_status} names CAPTCHA", "captcha" in message.lower())
        ok(f"http {gateway_status} does NOT say 'unexpected'", "unexpected" not in message.lower())
        ok(f"http {gateway_status} quotes the status", str(gateway_status) in message)
        # These two pin the *dedicated* gateway branch. Without them, deleting
        # 202 from the branch list left the generic 2xx fallback answering --
        # and that text also mentions a gateway, so the checks above stayed
        # green while the specific diagnosis was gone. Caught by mutation.
        ok(f"http {gateway_status} says the request was not handled",
           "instead of handling" in message.lower())
        ok(f"http {gateway_status} names the command that shows the address",
           "greenway-announcer status" in message.lower())
    generic_2xx = describe_http_error(299)
    ok("http 2xx explains it could not be used", "could not use" in generic_2xx.lower())
    ok("http 2xx is not the gateway branch", "instead of handling" not in generic_2xx.lower())
    # Regression guard: the new 2xx/3xx branches must not swallow the old ones.
    ok("http 401 still says re-pair", "pair" in describe_http_error(401).lower())
    ok("http 503 still says it retries", "retry" in describe_http_error(503).lower())
    ok("http 500 is still an error, not a gateway", "gateway" not in describe_http_error(500).lower())

    # -- a CAPTCHA page is not an error message ---------------------------
    ok("html: a gateway CAPTCHA page is detected",
       looks_like_html('<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/"></meta></head></html>'))
    # Each marker needs a case that ONLY it can catch. The real CAPTCHA page
    # above trips three markers at once, so dropping one of them left the
    # sniffer still passing. Caught by mutation.
    ok("html: '<html' alone is enough", looks_like_html("<html><body>blocked</body>"))
    ok("html: '<meta' alone is enough", looks_like_html('<meta http-equiv="refresh" content="0;/elsewhere">'))
    ok("html: a doctype page is detected", looks_like_html("<!DOCTYPE html><body>hi</body>"))
    ok("html: the sgcaptcha marker alone is enough", looks_like_html("blocked by sgcaptcha"))
    ok("html: real JSON is not mistaken for a web page", not looks_like_html('{"error":"We do not recognize this code."}'))
    ok("html: plain text is not a web page", not looks_like_html("We do not recognize this code."))
    ok("html: empty body is not a web page", not looks_like_html(""))

    # -- mistyped website addresses are named, not just rejected ----------
    ok("site typo: 'https//host' is diagnosed", "missing" in site_typo_hint("https//example.com").lower())
    ok("site typo: 'https//host' shows the fix", "https://example.com" in site_typo_hint("https//example.com"))
    ok("site typo: 'http//host' is diagnosed", "missing" in site_typo_hint("http//example.com").lower())
    ok("site typo: 'https:/host' (one slash) is diagnosed", site_typo_hint("https:/example.com") != "")
    ok("site typo: 'https:/host' shows the fix", "https://example.com" in site_typo_hint("https:/example.com"))
    ok("site typo: a correct address is not nagged about", site_typo_hint("https://example.com") == "")
    ok("site typo: a bare host is not nagged about", site_typo_hint("example.com") == "")
    ok("site typo: empty input is silent", site_typo_hint("") == "" and site_typo_hint(None) == "")
    ok("site typo: quotes the input back", "https//example.com" in site_typo_hint("  https//example.com  "))

    # -- tone generation actually produces playable audio -----------------
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for kind in BUILTIN_SOUND_ORDER:
            path = ensure_builtin(tmp_dir, kind)
            ok(f"tone {kind}: file created", path.exists())
            ok(f"tone {kind}: not empty", path.stat().st_size > 1000)
            with wave.open(str(path), "rb") as wav:
                ok(f"tone {kind}: is mono 16-bit", wav.getnchannels() == 1 and wav.getsampwidth() == 2)
                ok(f"tone {kind}: has audible length", wav.getnframes() > 4000)
        # An unknown id must still produce a sound rather than raising.
        fallback = ensure_builtin(tmp_dir, "does-not-exist")
        ok("tone: unknown id still yields a playable file", fallback.exists() and fallback.stat().st_size > 1000)
        # Cached on second call rather than regenerated.
        before = fallback.stat().st_mtime_ns
        again = ensure_builtin(tmp_dir, "does-not-exist")
        eq("tone: reused from cache", again.stat().st_mtime_ns, before)

    # -- config write is atomic and private -------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "sub" / "config.json"
        save_config(cfg, {"siteUrl": "https://x", "deviceId": "d", "deviceKey": "k"})
        ok("config: written", cfg.exists())
        eq("config: mode is 600", oct(cfg.stat().st_mode & 0o777), "0o600")
        loaded = load_config(cfg)
        eq("config: round-trips", loaded["deviceId"], "d")
        ok("config: no temp files left behind", list(Path(tmp, "sub").glob(".config-*")) == [])

    # -- explain_alsa_error: the "Unknown error 524" that stopped a real shop --
    # 524 is not a userspace errno (the highest is 132). It is the kernel's
    # internal ENOTSUPP leaking out of an ALSA driver, and on a headless Pi it
    # means HDMI audio cannot open because no monitor is attached.
    _hdmi_pi = parse_aplay_devices(
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
        "card 1: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]\n"
    )
    _524 = explain_alsa_error(
        "aplay: main:850: audio open error: Unknown error 524", _hdmi_pi
    )
    ok("alsa 524: is explained at all", bool(_524))
    ok("alsa 524: blames the driver refusing to open", "refused to open" in (_524 or ""))
    ok(
        "alsa 524: names HDMI as the likely cause",
        "HDMI audio output" in (_524 or "") and "usually the default" in (_524 or ""),
    )
    ok(
        "alsa 524: explains WHY HDMI fails (no monitor attached)",
        "no monitor plugged in" in (_524 or ""),
    )
    ok("alsa 524: reassures that nothing is broken", "Nothing is broken" in (_524 or ""))
    ok("alsa 524: names a real output to use instead", "plughw:0,0" in (_524 or ""))
    ok(
        "alsa 524: does not send you to the HDMI output that just failed",
        "--audio-device plughw:1,0" not in (_524 or ""),
    )

    # Same error, but this Pi has no HDMI at all: do not invent an HDMI story.
    _no_hdmi = parse_aplay_devices(
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
    )
    _plain = explain_alsa_error("audio open error: Unknown error 524", _no_hdmi)
    ok("alsa 524: still explained without HDMI", bool(_plain))
    ok("alsa 524: no HDMI blame when there is no HDMI", "HDMI" not in (_plain or ""))

    _busy = explain_alsa_error("aplay: device is busy", _hdmi_pi)
    ok("alsa busy: recognised", bool(_busy))
    ok("alsa busy: blames the running service", "already using the sound output" in (_busy or ""))
    ok("alsa busy: gives the stop/start commands", "systemctl stop greenway-announcer" in (_busy or ""))

    _missing = explain_alsa_error("aplay: No such file or directory", _hdmi_pi)
    ok("alsa missing device: recognised", "does not exist on this Pi" in (_missing or ""))

    _denied = explain_alsa_error("aplay: Permission denied", _hdmi_pi)
    ok("alsa permission: recognised", bool(_denied))
    ok("alsa permission: suggests the audio group", "usermod -aG audio" in (_denied or ""))

    eq("alsa: an empty error explains nothing", explain_alsa_error("", _hdmi_pi), None)
    eq("alsa: an unknown error is not guessed at", explain_alsa_error("weird thing", _hdmi_pi), None)

    # -- stale install: 'git pull' does not update the installed program ------
    with tempfile.TemporaryDirectory() as tmp:
        installed = Path(tmp) / "installed.py"
        source = Path(tmp) / "repo.py"
        installed.write_text("OLD", encoding="utf-8")
        source.write_text("NEW", encoding="utf-8")
        warn = stale_install_warning(installed, source)
        ok("stale: a newer source is noticed", bool(warn))
        ok("stale: says git pull is not enough", "does NOT update" in (warn or ""))
        ok("stale: gives the install command", "sudo ./install.sh" in (warn or ""))

        installed.write_text("NEW", encoding="utf-8")
        eq("stale: identical copies are not flagged", stale_install_warning(installed, source), None)
        eq(
            "stale: a missing repo copy is not flagged",
            stale_install_warning(installed, Path(tmp) / "absent.py"),
            None,
        )
        eq(
            "stale: a missing installed copy is not flagged",
            stale_install_warning(Path(tmp) / "absent.py", source),
            None,
        )

    # -- cache dir falls back instead of crashing -----------------------------
    # Second crash of the same family: /var/lib/greenway-announcer is
    # root-owned, so `test` without sudo died writing its tone cache. The whole
    # point of `test` is to make a noise, so it must degrade, never refuse.
    with tempfile.TemporaryDirectory() as tmp:
        wanted = Path(tmp) / "cache"
        eq("cache: uses the real directory when writable", usable_cache_dir(wanted), wanted)
        ok("cache: creates it if absent", wanted.is_dir())
        ok("cache: leaves no probe file behind", list(wanted.glob(".write-probe")) == [])

        # Use a path *underneath a regular file*: mkdir then fails with
        # ENOTDIR. A mode-500 directory would not do, because these tests must
        # also hold when run as root, and root ignores permission bits.
        wall = Path(tmp) / "not-a-directory"
        wall.write_text("", encoding="utf-8")
        got = usable_cache_dir(wall / "sounds")
        ok("cache: falls back when the directory cannot be created", got != (wall / "sounds"))
        ok("cache: the fallback is usable", got.is_dir() and os.access(got, os.W_OK))
        # And a tone must actually be produced there.
        tone = ensure_builtin(got, "chime")
        ok("cache: a tone is still generated after falling back", tone.exists() and tone.stat().st_size > 0)

    # ensure_builtin must survive a cache whose exists() raises, which is what
    # a root-owned parent directory actually does to a non-root process.
    class _RaisingPath(type(Path("/tmp"))):  # type: ignore[misc]
        def exists(self, *a: Any, **k: Any) -> bool:
            raise PermissionError(13, "Permission denied")

    with tempfile.TemporaryDirectory() as tmp:
        real = Path(tmp) / "regen"
        real.mkdir()
        raising = _RaisingPath(str(real))
        # Sanity-check the double: if the subclass does not actually raise, the
        # assertion below would pass for the wrong reason.
        _raised = False
        try:
            (raising / "probe.wav").exists()
        except PermissionError:
            _raised = True
        ok("cache: the test double really does raise", _raised)

        tone = ensure_builtin(raising, "bell")
        ok(
            "cache: a tone regenerates when exists() raises",
            Path(str(tone)).is_file() and Path(str(tone)).stat().st_size > 0,
        )

    # -- config_state: the bug that crashed the first speaker in the field ---
    # `greenway-announcer test` died with PermissionError because Path.exists()
    # RAISES when a parent directory is not searchable -- it does not return
    # False. /etc/greenway-announcer is mode 700, so every non-sudo run of the
    # command crashed with a traceback instead of saying "use sudo".
    with tempfile.TemporaryDirectory() as tmp:
        readable = Path(tmp) / "readable.json"
        readable.write_text('{"deviceId":"d"}', encoding="utf-8")
        eq("config_state: an existing file is readable", config_state(readable), "readable")
        eq("config_state: an absent file is missing", config_state(Path(tmp) / "nope.json"), "missing")

        class _Denied(type(Path(tmp))):  # type: ignore[misc]
            def exists(self, *a: Any, **k: Any) -> bool:
                raise PermissionError(13, "Permission denied")

        class _Errored(type(Path(tmp))):  # type: ignore[misc]
            def exists(self, *a: Any, **k: Any) -> bool:
                raise OSError(5, "I/O error")

        eq(
            "config_state: PermissionError means denied, it must not crash",
            config_state(_Denied(tmp, "config.json")),
            "denied",
        )
        eq(
            "config_state: any other OS error is treated as missing",
            config_state(_Errored(tmp, "config.json")),
            "missing",
        )

    # The message has to name the fix, not just the problem.
    _sudo_msg = needs_sudo_message(Path("/etc/greenway-announcer/config.json"), "status")
    ok("needs_sudo_message: names the file", "/etc/greenway-announcer/config.json" in _sudo_msg)
    ok("needs_sudo_message: says permission denied", "permission denied" in _sudo_msg.lower())
    ok("needs_sudo_message: gives the exact command", "sudo greenway-announcer status" in _sudo_msg)
    ok(
        "needs_sudo_message: uses the command it was asked about",
        "sudo greenway-announcer test" in needs_sudo_message(Path("/x"), "test"),
    )

    # -- parse_aplay_devices, against real `aplay -l` output -----------------
    _APLAY_OLD = (
        "**** List of PLAYBACK Hardware Devices ****\n"
        "card 0: ALSA [bcm2835 ALSA], device 0: bcm2835 ALSA [bcm2835 ALSA]\n"
        "  Subdevices: 7/7\n"
        "card 0: ALSA [bcm2835 ALSA], device 1: bcm2835 IEC958/HDMI [bcm2835 IEC958/HDMI]\n"
        "  Subdevices: 1/1\n"
    )
    _APLAY_BOOKWORM = (
        "**** List of PLAYBACK Hardware Devices ****\n"
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
        "  Subdevices: 8/8\n"
        "card 1: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]\n"
        "  Subdevices: 1/1\n"
    )
    _APLAY_USB = (
        "**** List of PLAYBACK Hardware Devices ****\n"
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
        "  Subdevices: 8/8\n"
        "card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]\n"
        "  Subdevices: 1/1\n"
    )

    _old = parse_aplay_devices(_APLAY_OLD)
    eq("aplay: two outputs on the old layout", len(_old), 2)
    eq("aplay: builds a usable ALSA name", _old[0]["alsa"], "plughw:0,0")
    eq("aplay: second output on the same card", _old[1]["alsa"], "plughw:0,1")
    ok("aplay: the analog jack is flagged", _old[0]["is_headphone"])
    # Regression: both outputs live on the "bcm2835" card, so a naive check
    # labels HDMI as the headphone jack and gives the wrong buzz advice.
    ok("aplay: HDMI is NOT mistaken for the headphone jack", not _old[1]["is_headphone"])
    ok("aplay: HDMI is flagged as HDMI", _old[1]["is_hdmi"])

    _bw = parse_aplay_devices(_APLAY_BOOKWORM)
    eq("aplay: two outputs on Bookworm", len(_bw), 2)
    ok("aplay: Bookworm analog jack is flagged", _bw[0]["is_headphone"])
    ok("aplay: vc4hdmi is HDMI", _bw[1]["is_hdmi"])
    ok("aplay: vc4hdmi is not the headphone jack", not _bw[1]["is_headphone"])
    eq("aplay: HDMI sits on its own card", _bw[1]["alsa"], "plughw:1,0")

    _usb = parse_aplay_devices(_APLAY_USB)
    ok("aplay: a USB dongle is not the headphone jack", not _usb[1]["is_headphone"])
    ok("aplay: a USB dongle is not HDMI", not _usb[1]["is_hdmi"])
    eq("aplay: the USB output is addressable", _usb[1]["alsa"], "plughw:1,0")

    eq("aplay: no sound card yields no outputs", parse_aplay_devices(""), [])
    eq("aplay: junk yields no outputs", parse_aplay_devices("no soundcards found..."), [])
    ok("aplay: never raises on rubbish", isinstance(parse_aplay_devices("card x: y"), list))

    # -- diagnose_buzz -------------------------------------------------------
    _analog_advice = diagnose_buzz(_old, "plughw:0,0")
    _joined = " ".join(_analog_advice).lower()
    ok("buzz: reassures that the PWM jack is normally noisy", "pwm" in _joined)
    ok("buzz: says it is not a broken speaker", "not a broken speaker" in _joined)
    ok("buzz: tells him to turn the Pi DOWN", "down to about 80%" in _joined)
    ok("buzz: tells him to turn the speaker UP", "speaker's knob up" in _joined)
    ok("buzz: recommends a USB adapter when there is none", "usb audio adapter" in _joined)
    ok("buzz: covers the idle/electrical case", "even when nothing is playing" in _joined)
    ok("buzz: covers the too-loud case", "only while a sound plays" in _joined)

    # When a real USB output already exists, point at it instead of shopping.
    _usb_advice = " ".join(diagnose_buzz(_usb, "plughw:0,0")).lower()
    ok("buzz: prefers an output this Pi already has", "already has another audio output" in _usb_advice)
    ok("buzz: names that output", "plughw:1,0" in _usb_advice)
    ok("buzz: does not tell him to buy one he does not need", "usb audio adapter is a real dac" not in _usb_advice)

    # Playing through the USB dongle: the PWM explanation must NOT appear.
    _clean = " ".join(diagnose_buzz(_usb, "plughw:1,0")).lower()
    ok("buzz: no PWM excuse when not using the analog jack", "pwm" not in _clean)
    ok("buzz: still covers electrical noise on any output", "even when nothing is playing" in _clean)

    ok("buzz: always returns advice, even with no devices", len(diagnose_buzz([], None)) >= 1)

    print(f"\n{passed} checks passed, {failed} failed.")
    if failed == 0:
        print("ALL CHECKS PASSED — the announcer software on this Pi is healthy.")
        return 0
    print("SOME CHECKS FAILED — the agent file may be corrupted. Reinstall it.")
    return 1


# ============================================================================
# ENTRY POINT
# ============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="greenway-announcer",
        description="Greenway order announcer for Raspberry Pi.",
    )
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to the config file.")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR), help="Where sounds are cached.")
    parser.add_argument("--verbose", action="store_true", help="Log more detail.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run the announcer (what systemd starts).")
    p_run.set_defaults(func=cmd_run)

    p_pair = sub.add_parser("pair", help="Pair this Pi with the website using a code.")
    p_pair.add_argument("code", help="The 8-character code from the Announcer panel.")
    p_pair.add_argument("--site", help="Website address, e.g. https://your-site.com")
    p_pair.add_argument("--audio-device", help="ALSA device, e.g. plughw:1,0")
    p_pair.add_argument("--mixer-control", help="ALSA mixer control, e.g. PCM")
    p_pair.set_defaults(func=cmd_pair)

    p_test = sub.add_parser("test", help="Play every built-in sound locally.")
    p_test.add_argument("--audio-device", help="ALSA device, e.g. plughw:1,0")
    p_test.add_argument("--mixer-control", help="ALSA mixer control, e.g. PCM")
    p_test.add_argument("--volume", type=int, default=70)
    p_test.set_defaults(func=cmd_test)

    p_audio = sub.add_parser("audio", help="Show the sound hardware and diagnose buzzing.")
    p_audio.add_argument("--audio-device", help="ALSA device to check, e.g. plughw:1,0")
    p_audio.set_defaults(func=cmd_audio)

    p_status = sub.add_parser("status", help="Show config and check the website connection.")
    p_status.set_defaults(func=cmd_status)

    p_self = sub.add_parser("selftest", help="Check the agent's own logic. No network needed.")
    p_self.set_defaults(func=lambda _a: selftest())

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    handlers: List[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )

    try:
        return int(args.func(args) or 0)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        log.exception("Unexpected failure: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
