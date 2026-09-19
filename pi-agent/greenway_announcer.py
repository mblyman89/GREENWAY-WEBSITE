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
import builtins
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
import types
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


SERVICE_NAME = "greenway-announcer"


def should_save_audio_device(
    found: Optional[str],
    configured: Optional[str],
    explicit: Optional[str],
) -> bool:
    """
    Should a working output discovered by `test` be written to the config?

    THE REAL FAILURE THIS COMES FROM
    --------------------------------
    A shop owner's Pi reported everything green. `status` said:

        audio out: (system default)

    and `test` said:

        default output  FAILED - aplay: audio open error: Unknown error 524
        plughw:1,0     bcm2835 Headphones           WORKS

    So the program KNEW which output worked, printed it, and then threw it
    away -- telling the human to re-run the whole installer to apply it.
    Meanwhile the background service kept using the broken HDMI default, so
    every real order was silent while every screen said "green".

    A tool that discovers the fix and refuses to apply it is not diagnosing,
    it is nagging. Saving is therefore the default.

    Pure so the rule can be asserted without touching a disk:
      - nothing found            -> nothing to save
      - the user named a device  -> respect it, do not overwrite the config
                                    from a one-off experiment
      - already configured       -> no write, no needless service restart
    """
    if not found:
        return False
    if explicit:
        return False
    return found != (configured or None)


def restart_service_command() -> List[str]:
    """The one place the restart command is spelled, so tests can assert it."""
    return ["systemctl", "restart", SERVICE_NAME]


def describe_uptime(seconds: Optional[float]) -> str:
    """
    Turn /proc/uptime into a sentence a shop owner can act on.

    WHY THIS EXISTS
    ---------------
    A shop reported "the pi keeps turning itself off after a little bit of
    time". That one sentence covers two completely different faults with
    opposite fixes:

      * The Pi really is REBOOTING (bad power supply, loose cable). Uptime
        resets to near zero every time.
      * The Pi is fine and only its Wi-Fi radio is dozing, so the website
        marks it offline. Uptime keeps climbing right through the "outage".

    Guessing between those wastes a week. Uptime tells you which, for free,
    and it is the first thing status prints about staying awake.
    """
    if seconds is None or seconds < 0:
        return "unknown"
    total = int(seconds)
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def read_uptime_seconds(proc_uptime: Path = Path("/proc/uptime")) -> Optional[float]:
    """Seconds since boot, or None if it cannot be read. Never raises."""
    try:
        first = proc_uptime.read_text(encoding="utf-8").split()[0]
        return float(first)
    except Exception:
        return None


def judge_uptime(seconds: Optional[float]) -> Tuple[bool, str]:
    """
    (looks_healthy, sentence). A Pi that has been up for minutes when the shop
    has been open for hours has been restarting itself, and that is hardware.
    """
    if seconds is None:
        return True, "Up for: unknown (could not read /proc/uptime)"
    line = f"Up for: {describe_uptime(seconds)}"
    if seconds < 900:
        return False, (
            f"{line}\n"
            "    This Pi started less than 15 minutes ago. If you did not just\n"
            "    restart it, it is LOSING POWER - that is the power supply or\n"
            "    the cable, not software. Swap the supply before anything else."
        )
    return True, line


def wireless_interfaces(net_dir: Path = Path("/sys/class/net")) -> List[str]:
    """Every wireless interface on this box. Empty list on a wired-only Pi."""
    found: List[str] = []
    try:
        for entry in sorted(net_dir.iterdir()):
            if (entry / "wireless").exists():
                found.append(entry.name)
    except Exception:
        return []
    return found


def power_save_state(iface: str) -> str:
    """
    "off", "on", or "unknown" for one interface. Never raises.

    Parsed from `iw dev <iface> get power_save`, which prints a line like
    "Power save: off". Anything unexpected is reported as unknown rather than
    guessed at, because claiming power saving is off when it is not is exactly
    how a speaker looks healthy and stays unreachable.
    """
    if not shutil.which("iw"):
        return "unknown"
    try:
        result = subprocess.run(
            ["iw", "dev", iface, "get", "power_save"],
            capture_output=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, OSError):
        return "unknown"
    text = (result.stdout or b"").decode("utf-8", "replace").lower()
    if "power save: off" in text:
        return "off"
    if "power save: on" in text:
        return "on"
    return "unknown"


def keep_awake_report(interfaces: List[str], states: Dict[str, str]) -> Tuple[bool, List[str]]:
    """
    PURE. (all_good, lines) describing whether this Pi will stay reachable.

    Separated from the commands that read the hardware so it can be tested
    without a radio: the judgement is the part that must not be wrong.
    """
    if not interfaces:
        return True, ["Wi-Fi: none found (wired network - nothing to keep awake)"]

    lines: List[str] = []
    all_good = True
    for iface in interfaces:
        state = states.get(iface, "unknown")
        if state == "off":
            lines.append(f"Wi-Fi {iface}: power saving OFF - good, it will stay reachable")
        elif state == "on":
            all_good = False
            lines.append(
                f"Wi-Fi {iface}: power saving is ON - the radio dozes, so the website\n"
                f"    will show this speaker offline even though the Pi is fine.\n"
                f"    Fix it now:  sudo /usr/local/bin/greenway-keep-awake\n"
                f"    Or re-run the installer, which sets it permanently."
            )
        else:
            lines.append(f"Wi-Fi {iface}: power saving unknown (the 'iw' tool is missing)")
    return all_good, lines


def restart_service() -> Tuple[bool, str]:
    """
    Restart the background service so a saved setting takes effect now.

    Returns (restarted, detail). Never raises: failing to restart is worth
    reporting, but it must not turn a successful `test` into a crash. The
    config is already saved at this point, so the worst case is that the new
    output applies at the next reboot.
    """
    if shutil.which("systemctl") is None:
        return False, "systemctl is not available on this system"
    try:
        result = subprocess.run(restart_service_command(), capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        return False, "the restart took too long"
    except OSError as exc:
        return False, f"could not run systemctl ({exc})"
    if result.returncode != 0:
        detail = (result.stderr or b"").decode("utf-8", "replace").strip()
        return False, detail or f"systemctl exited {result.returncode}"
    return True, "restarted"


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
        is_headphone = (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob)
        # USB is now a NAMED category rather than "whatever is left over".
        #
        # It used to be inferred as `not is_hdmi and not is_headphone`, which is
        # true for a dongle but is ALSO true for an I2S HAT, a Bluetooth sink,
        # or anything else unrecognised. Inferring the owner's dongle from a
        # double negative meant nothing could ever deliberately PREFER it, and
        # a wrong guess sent the sound to the wrong box entirely.
        #
        # The markers below are the strings a real dongle actually reports.
        # `aplay -l` for the common C-Media/generic adapters prints the card as
        # "Device [USB Audio Device]" with device "USB Audio"; branded ones
        # print their own name but still carry "usb" in the card id or name.
        # Verified against the captured `aplay -l` fixtures in selftest.
        is_usb = ("usb" in blob) or ("uac" in blob)
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
                # STABLE ADDRESS. ALSA numbers cards in probe order, so
                # "plughw:1,0" can point at a different card after a reboot or
                # after the dongle is unplugged and replugged. The card ID is a
                # name, not a position, so `plughw:CARD=Device,DEV=0` survives
                # renumbering. This is the "works forever, even after power off
                # and on again" half of the problem.
                "stable": f"plughw:CARD={card_id},DEV={match.group(4)}",
                # The Pi's built-in analog jack is driven by PWM and is the
                # known source of hiss/buzz complaints. A USB dongle or HAT is
                # a real DAC and does not have that problem.
                "is_headphone": is_headphone,
                "is_hdmi": is_hdmi,
                "is_usb": is_usb,
            }
        )
    return devices


# The order the shop wants sound to come out, best first. Named once here so
# the ranking, the messages and the tests can never disagree about the policy.
#
#   USB dongle  - a real DAC. Clean signal. This is what the owner bought.
#   Headphones  - the Pi's own 3.5 mm jack. Works, but PWM-driven and noisy.
#   HDMI        - on a headless Pi this cannot open at all (error 524).
#
# HDMI is LAST deliberately: it is usually the system default, and being the
# default is exactly why a headless Pi plays silence while every screen says
# it is fine.
OUTPUT_PREFERENCE = ("usb", "headphone", "hdmi")


def output_kind(device: Dict[str, Any]) -> str:
    """Which preference bucket an output falls in. One place, so nothing drifts."""
    if device.get("is_usb"):
        return "usb"
    if device.get("is_hdmi"):
        return "hdmi"
    if device.get("is_headphone"):
        return "headphone"
    # An unrecognised card (I2S HAT, Bluetooth sink) is still a real output and
    # is still better than HDMI on a headless Pi, but it is not the dongle the
    # owner plugged in. It sorts between headphones and HDMI.
    return "other"


def rank_outputs(devices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Every output this Pi has, best first: USB, then the analog jack, then
    anything unrecognised, then HDMI.

    Pure, so the policy can be asserted without a sound card present. The
    original code expressed this ordering inline inside `cmd_test` as
    `sort(key=lambda d: (d["is_hdmi"], d["is_headphone"]))`, where it was
    unreachable from the background service and untested. Lifting it out is
    what lets the service use the same rule the diagnostics print.
    """
    order = {"usb": 0, "headphone": 1, "other": 2, "hdmi": 3}
    return sorted(
        devices,
        key=lambda d: (order.get(output_kind(d), 2), d.get("card", 0), d.get("device", 0)),
    )


def describe_choice(device: Optional[Dict[str, Any]]) -> str:
    """Plain English for why this output was picked. Never a bare device string."""
    if not device:
        return "no audio output was found on this Pi"
    kind = output_kind(device)
    if kind == "usb":
        return f"{device['name']} — your USB audio adapter (a real DAC, best quality)"
    if kind == "headphone":
        return f"{device['name']} — the Pi's own 3.5 mm jack (works, but hisses)"
    if kind == "hdmi":
        return f"{device['name']} — HDMI (only works with a screen plugged in)"
    return f"{device['name']} — an add-on sound card"


def choose_output(
    devices: List[Dict[str, Any]],
    configured: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Pick the output to play through.

    THE RULE, AND WHY IT IS THIS WAY
    --------------------------------
    A device the owner explicitly configured ALWAYS wins, as long as it is
    actually present. Respecting an explicit choice is the difference between a
    tool and a tool that argues with you.

    But "configured" must mean "still plugged in". The old behaviour read the
    saved device once at startup and played to it forever, so a config pinned
    to the analog jack silently ignored a working USB dongle sitting right next
    to it -- which is exactly the fault reported. If the configured device is
    NOT in the list, we fall through to preference order rather than playing to
    a device that is not there.

    Matching accepts either spelling of the same output (`plughw:1,0` or
    `plughw:CARD=Device,DEV=0`, with or without the `plug` prefix) so an older
    config written before stable names existed still matches after an upgrade.
    """
    if not devices:
        return None

    if configured:
        wanted = configured.strip()
        for d in devices:
            if wanted in _address_forms(d):
                return d

    ranked = rank_outputs(devices)
    return ranked[0] if ranked else None


def _address_forms(device: Dict[str, Any]) -> set:
    """Every string that legitimately names this one output."""
    card, dev, cid = device.get("card"), device.get("device"), device.get("id", "")
    return {
        f"plughw:{card},{dev}",
        f"hw:{card},{dev}",
        f"plughw:CARD={cid},DEV={dev}",
        f"hw:CARD={cid},DEV={dev}",
        f"sysdefault:CARD={cid}",
        cid,
    }


def candidate_probe_order(device: Dict[str, Any]) -> List[str]:
    """
    The addresses to TRY for one candidate output, best spelling first.

    WHY THIS IS NOT JUST `[device["stable"]]`
    -----------------------------------------
    We want to SAVE the stable `plughw:CARD=...` name, because card numbers are
    handed out in probe order and a saved `plughw:2,0` can point at a different
    device after a power cut. But we must never save an address we have not
    actually played a sound through: that is how a config ends up holding a
    name that looks right and works nowhere.

    So the stable name is tried FIRST -- if it plays, that is what gets saved.
    The card-number form is kept as a second try for the rare card whose id is
    duplicated or unusable, so a working output is never rejected merely
    because its preferred spelling failed.
    """
    forms = [device.get("stable"), device.get("alsa")]
    out: List[str] = []
    for f in forms:
        if f and f not in out:
            out.append(f)
    return out


def playback_order(
    devices: List[Dict[str, Any]],
    configured: Optional[str] = None,
) -> List[str]:
    """
    The addresses to TRY, in order, for one announcement.

    This is the "can it be smart so both usb and aux can be used?" answer. The
    shop must make a noise; which socket it comes out of matters less than it
    coming out at all. So playback is a LIST, not a single device: the chosen
    output first, then every other real output as a fallback.

    Stable `CARD=` names are used so the list keeps working after a reboot
    renumbers the cards. HDMI is never silently promoted above a working jack.
    """
    if not devices:
        return []
    first = choose_output(devices, configured)
    ordered: List[str] = []
    if first is not None:
        ordered.append(first["stable"])
    for d in rank_outputs(devices):
        if first is not None and d is first:
            continue
        # A headless Pi cannot open HDMI at all; including it is harmless
        # (it simply fails fast) and it is the only output on a Pi that is
        # plugged into a TV, so it stays in the list as a last resort.
        ordered.append(d["stable"])
    # Dedupe while preserving order: two ALSA lines can resolve to one address.
    seen: set = set()
    unique: List[str] = []
    for addr in ordered:
        if addr not in seen:
            seen.add(addr)
            unique.append(addr)
    return unique


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
    # USB must be POSITIVELY identified. This used to be "not headphone and not
    # HDMI", which quietly swept up I2S HATs and Bluetooth sinks and called them
    # USB dongles -- and, worse, meant nothing in the program could deliberately
    # prefer the real dongle. output_kind() is now the only place that decides.
    usb = [d for d in devices if output_kind(d) == "usb"]

    # Diagnose the output that will ACTUALLY be used, not the one written in the
    # config. Those differ whenever the configured device has been unplugged, and
    # advice about a device that is not there is worse than no advice at all.
    in_use = choose_output(devices, chosen)
    using_analog = in_use is not None and output_kind(in_use) == "headphone"

    if using_analog:
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
            # The STABLE name (plughw:CARD=...), never plughw:1,0. Card numbers
            # are assigned in probe order, so the number printed today can point
            # at a different card after the next power cut -- which is exactly
            # the "works until you reboot it" failure this command exists to
            # prevent somebody from re-creating.
            notes.append(
                "Better fix: this Pi already has another audio output. Use it: "
                f"sudo ./install.sh --site <your-site> --audio-device {usb[0]['stable']}"
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


def play_with_fallback(
    path: Path,
    addresses: List[str],
    player: Any = play_file,
) -> Tuple[bool, str, Optional[str]]:
    """
    Try each output in turn until one makes a noise.

    Returns (played, detail, address_that_worked).

    WHY THIS EXISTS
    ---------------
    The background service used to hold ONE device string, read once when it
    started, and play to it forever. That single line is the whole reported
    fault: a Pi configured for the 3.5 mm jack ignored a working USB dongle
    plugged in beside it, and a Pi left on the system default played to HDMI
    with no screen attached and made no sound at all -- while `status` happily
    reported green, because nothing ever checked whether the sound landed.

    Trying the list means a shop with both a dongle AND the aux jack in use
    gets the dongle, and still gets a chime out of the jack if somebody pulls
    the dongle out mid-shift. Silence in a shop is the one unacceptable
    outcome: a missed order is a customer standing at an empty counter.

    `player` is injectable so this can be tested without a sound card.
    """
    if not addresses:
        # No enumerated outputs at all. Fall back to the system default rather
        # than refusing: on a Pi with a single card, aplay with no -D works.
        played, detail = player(path, None)
        return played, detail, None

    failures: List[str] = []
    for address in addresses:
        played, detail = player(path, address)
        if played:
            return True, detail, address
        first_line = (detail or "").splitlines()[0] if detail else "no detail"
        failures.append(f"{address}: {first_line}")

    return False, "Every audio output failed. " + "; ".join(failures), None


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
        # The outputs to try, best first, recomputed from the hardware rather
        # than trusted from the config. See refresh_outputs().
        self.audio_chain: List[str] = []
        self.audio_chain_at: float = 0.0
        self.last_output_used: Optional[str] = None
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

    def refresh_outputs(self, now: Optional[float] = None, max_age: float = 60.0) -> List[str]:
        """
        Recompute the list of outputs to try, at most once a minute.

        RE-ASKING THE HARDWARE IS THE POINT. The old code read one device
        string at startup and never looked again, so plugging a USB dongle in
        did nothing until somebody re-ran the whole installer -- and unplugging
        one left the service talking to a card that no longer existed.

        Cached briefly because `aplay -l` spawns a process, and an announcement
        must not wait on that. A minute is short enough that a dongle plugged
        in mid-shift is picked up on the next order, and long enough that a
        busy Saturday does not shell out on every chime.
        """
        stamp = time.time() if now is None else now
        if self.audio_chain and (stamp - self.audio_chain_at) < max_age:
            return self.audio_chain
        try:
            devices = detected_outputs()
        except Exception as exc:  # never let enumeration kill an announcement
            log.warning("Could not list audio outputs (%s). Using the saved setting.", exc)
            devices = []
        chain = playback_order(devices, self.audio_device)
        if not chain and self.audio_device:
            # Enumeration failed but the owner named a device: honour it.
            chain = [self.audio_device]
        self.audio_chain = chain
        self.audio_chain_at = stamp
        return chain

    def handle_job(self, job: Dict[str, Any]) -> Tuple[bool, str]:
        job_id = job["id"]
        if job_id in self.played:
            return True, "already played"

        set_alsa_volume(job["volume"], self.mixer_control)
        path = self.resolve_sound(job["sound"])
        chain = self.refresh_outputs()
        played, detail, used = play_with_fallback(path, chain)

        if played and used and used != self.last_output_used:
            # Say it ONCE when it changes, not on every chime: a log line per
            # order is noise, but a silent switch of output is a mystery.
            log.info("Playing through %s", used)
            self.last_output_used = used

        if not played and path.suffix.lower() != ".wav":
            # Custom file would not play. Never leave the shop silent: fall back.
            log.warning("%s Falling back to the built-in chime.", detail)
            played, detail, used = play_with_fallback(
                ensure_builtin(self.cache_dir, "chime"), chain
            )

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


def _persist_working_output(args: argparse.Namespace, device: str) -> None:
    """
    Save the output `test` just proved works, and restart the service.

    Everything here is best-effort and reported in plain English. `test` is a
    diagnostic: it must never fail because it could not write a file. But it
    must also never again find the answer and discard it.
    """
    config_path = Path(args.config)
    state = config_state(config_path)

    if state == "denied":
        print(
            "This output could not be saved because the config needs sudo.\n"
            "Run this to save it for good:\n"
            f"  sudo greenway-announcer use-output {device}\n"
        )
        return
    if state == "missing":
        print(
            "This speaker is not paired yet, so there is no config to save it in.\n"
            "Pair it first, then this output will be saved automatically.\n"
        )
        return

    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Could not read the config to save this output ({exc}).\n")
        return

    if not should_save_audio_device(device, config.get("audioDevice") or None, args.audio_device):
        return

    config["audioDevice"] = device
    try:
        save_config(config_path, config)
    except OSError as exc:
        print(
            f"Could not save this output ({exc}).\n"
            f"Set it by hand with:  sudo greenway-announcer use-output {device}\n"
        )
        return

    print(f"Saved. This speaker will use {device} from now on.")
    restarted, detail = restart_service()
    if restarted:
        print("The announcer has been restarted, so it is using it already.\n")
    else:
        print(
            f"Could not restart the announcer automatically ({detail}).\n"
            f"Run this to apply it now:  sudo systemctl restart {SERVICE_NAME}\n"
        )


def cmd_use_output(args: argparse.Namespace) -> int:
    """
    Set the audio output directly, without re-running the installer.

    Exists because the only documented way to change the output was to re-run
    the whole installer with --audio-device, which is a heavy, frightening
    thing to ask somebody to do just to change one setting.
    """
    config_path = Path(args.config)
    state = config_state(config_path)
    if state == "denied":
        print(needs_sudo_message(config_path, f"use-output {args.device}"))
        return 1
    if state == "missing":
        print(
            "This speaker is not paired yet, so there is nothing to configure.\n"
            "Pair it first:  sudo greenway-announcer pair <CODE>"
        )
        return 1

    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"The config could not be read ({exc}).")
        return 1

    device = args.device.strip()
    known = detected_outputs()
    # Accept ANY legitimate spelling of a real output.
    #
    # This used to compare against d["alsa"] alone, i.e. only "plughw:1,0". The
    # `audio` report now prints reboot-proof `plughw:CARD=...` names and tells
    # the owner to use them -- so the one command that applies them would have
    # rejected its own advice as "this Pi does not have an output called that".
    # Being refused by your own tool, while holding the name it just gave you,
    # is worse than no validation at all.
    if known and not any(device in _address_forms(d) for d in known):
        print(f"This Pi does not have an output called '{device}'. It has:\n")
        for d in rank_outputs(known):
            print(f"  {d['stable']:<28} {describe_choice(d)}")
        print("\nRun 'sudo greenway-announcer test' to find which one works.")
        return 1

    config["audioDevice"] = device
    try:
        save_config(config_path, config)
    except OSError as exc:
        print(f"Could not save the setting ({exc}).")
        return 1

    print(f"Saved. This speaker will use {device} from now on.")
    restarted, detail = restart_service()
    if restarted:
        print("The announcer has been restarted, so it is using it already.")
    else:
        print(
            f"Could not restart the announcer automatically ({detail}).\n"
            f"Run this to apply it now:  sudo systemctl restart {SERVICE_NAME}"
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

        # Try the outputs in the SAME order the background service uses, from
        # the one shared rule: USB dongle, then the Pi's own jack, then an
        # add-on card, then HDMI. This used to be a second, inline sort written
        # only for this command, which meant `test` could recommend one output
        # while the service quietly used another.
        candidates = [d for d in rank_outputs(devices) if d["alsa"] != device]
        if candidates:
            print("Trying every output this Pi has, to find one that works:\n")
        for candidate in candidates:
            # Try the reboot-proof spelling FIRST, then the card number.
            #
            # Save only what actually made a noise. An earlier version of this
            # probed `candidate["alsa"]` and then saved `candidate["stable"]`,
            # which meant the config could be handed an address that had never
            # been proven to work -- a silent shop with a green dot, which is
            # the exact fault this command exists to end.
            detail_try = ""
            worked: Optional[str] = None
            for address in candidate_probe_order(candidate):
                set_alsa_volume(args.volume, args.mixer_control)
                ok_try, detail_try = play_file(probe, address)
                if ok_try:
                    worked = address
                    break
            label = f"  {candidate['stable']:<26} {candidate['name'][:24]:<24}"
            if worked:
                print(f"{label} WORKS")
                device = worked
                first_ok = True
                print(f"\nFound a working output: {describe_choice(candidate)}\n")
                # Knowing the answer and not applying it is what left a shop
                # silent while every screen said "green". Save it.
                _persist_working_output(args, worked)
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

    # Best first, and described by the SAME functions the service plays
    # through, so what this prints can never disagree with what it does.
    ranked = rank_outputs(devices)
    print(f"\nFound {len(devices)} output{'' if len(devices) == 1 else 's'}, best first:")
    for d in ranked:
        print(f"  {d['stable']:<28} {describe_choice(d)}")
    print("\n  (Use the long plughw:CARD=... name above, not plughw:1,0 — card")
    print("   numbers are handed out in plug-in order and can change on reboot.)")

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
    # `chosen` is what the CONFIG says. `actual` is what will really be played
    # through. They diverge when the configured dongle has been unplugged, and
    # printing only the config is how a Pi reports a device that is not there.
    actual = choose_output(devices, chosen)
    if chosen:
        print(f"Configured: {chosen}  (from {source})")
        # Six spellings legitimately name one output (plughw:1,0, hw:1,0,
        # plughw:CARD=Device,DEV=0, ...). Matching only two of them made a
        # correctly-configured stable name look "not in the list above".
        present = any(chosen.strip() in _address_forms(d) for d in devices)
        if not present:
            print("  WARNING: that output is not plugged in right now, so it is being")
            print("           ignored. Falling back to the best output that IS here.")
    else:
        print("Configured: nothing specific — pick the best output automatically")

    print(f"In use:     {describe_choice(actual)}")

    # The whole point of the smart fallback: show the order it will be tried in
    # so "both USB and aux" is something the owner can SEE, not just trust.
    chain = playback_order(devices, chosen)
    if len(chain) > 1:
        print("\nIf the first output fails, these are tried in order:")
        for i, addr in enumerate(chain, 1):
            print(f"  {i}. {addr}")
        print("  An announcement is only reported as failed if ALL of them fail.")

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
    for d in ranked:
        print(f"  greenway-announcer test --audio-device {d['stable']}")
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

    # "The Pi keeps turning itself off" is one of the most common reports and
    # one of the least precise. These two lines separate the two causes before
    # anybody starts replacing things: uptime says whether it really restarted,
    # and the radio's power-save state says whether it only LOOKED offline.
    print("\nStaying awake:")
    _, uptime_line = judge_uptime(read_uptime_seconds())
    print(f"  {uptime_line}")
    ifaces = wireless_interfaces()
    _, awake_lines = keep_awake_report(ifaces, {i: power_save_state(i) for i in ifaces})
    for line in awake_lines:
        print(f"  {line}")

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

    # -- saving the output `test` discovered ---------------------------------
    # The defect this encodes: a Pi reported "audio out: (system default)",
    # the default failed with error 524, `test` found plughw:1,0 WORKS -- and
    # then threw that away, so every real order stayed silent while every
    # screen said green. Finding the fix and not applying it is the bug.
    ok(
        "save output: a working output found on a default-configured Pi is saved",
        should_save_audio_device("plughw:1,0", None, None),
    )
    ok(
        "save output: nothing found means nothing to save",
        not should_save_audio_device(None, None, None),
    )
    ok(
        "save output: an explicitly requested device never overwrites the config",
        not should_save_audio_device("plughw:1,0", None, "plughw:1,0"),
    )
    ok(
        "save output: no pointless write when it is already configured",
        not should_save_audio_device("plughw:1,0", "plughw:1,0", None),
    )
    ok(
        "save output: a different working output does replace a stale one",
        should_save_audio_device("plughw:1,0", "plughw:0,0", None),
    )
    eq(
        "save output: the restart command is the service, not a guess",
        restart_service_command(),
        ["systemctl", "restart", "greenway-announcer"],
    )

    # -- "the pi keeps turning itself off" -----------------------------------
    # Two different faults hide behind that one sentence, with opposite fixes:
    # a Pi that really reboots (power supply) versus a Pi whose Wi-Fi radio
    # dozes so the website calls it offline (power saving). Telling them apart
    # is the whole job; getting it wrong sends a shop to buy the wrong part.
    eq("uptime: minutes are readable", describe_uptime(600), "10m")
    eq("uptime: hours are readable", describe_uptime(7200), "2h 0m")
    eq("uptime: days are readable", describe_uptime(90000), "1d 1h 0m")
    eq("uptime: unreadable is said, never invented", describe_uptime(None), "unknown")
    eq("uptime: nonsense is not dressed up as a number", describe_uptime(-5), "unknown")
    ok("uptime: a long-running Pi is reported healthy", judge_uptime(86400)[0])
    ok("uptime: a Pi up 2 minutes is NOT called healthy", not judge_uptime(120)[0])
    ok(
        "uptime: a short uptime blames the power supply, not the software",
        "power supply" in judge_uptime(120)[1].lower(),
    )
    ok(
        "uptime: an unreadable uptime is not reported as a fault",
        judge_uptime(None)[0],
    )

    # A wired Pi has no radio and must not be told it has a Wi-Fi problem.
    wired_ok, wired_lines = keep_awake_report([], {})
    ok("keep awake: a wired Pi is fine and says so", wired_ok)
    ok("keep awake: a wired Pi is never given a Wi-Fi fix", "wired" in wired_lines[0].lower())

    good_ok, good_lines = keep_awake_report(["wlan0"], {"wlan0": "off"})
    ok("keep awake: power saving off is reported as good", good_ok)
    ok("keep awake: it says which interface", "wlan0" in good_lines[0])

    bad_ok, bad_lines = keep_awake_report(["wlan0"], {"wlan0": "on"})
    ok("keep awake: power saving ON is a fault, not a note", not bad_ok)
    ok(
        "keep awake: the fault explains the speaker looks offline while the Pi is fine",
        "offline" in bad_lines[0].lower(),
    )
    ok(
        "keep awake: the fault carries the command that fixes it",
        "greenway-keep-awake" in bad_lines[0],
    )

    unknown_ok, unknown_lines = keep_awake_report(["wlan0"], {"wlan0": "unknown"})
    ok(
        "keep awake: unknown is never claimed to be off",
        "off - good" not in unknown_lines[0],
    )
    ok("keep awake: unknown is not reported as a fault either", unknown_ok)

    multi_ok, multi_lines = keep_awake_report(
        ["wlan0", "wlan1"], {"wlan0": "off", "wlan1": "on"}
    )
    eq("keep awake: every interface is reported", len(multi_lines), 2)
    ok("keep awake: one bad radio makes the whole verdict bad", not multi_ok)

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

    # An I2S HAT: not the Pi's jack, not HDMI, and NOT USB. It exists to prove
    # the difference between "USB" and "everything left over" -- with only a
    # jack and a dongle in the fixtures those two definitions agree, and a test
    # that cannot tell them apart cannot defend the distinction.
    _APLAY_HAT = (
        "**** List of PLAYBACK Hardware Devices ****\n"
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
        "  Subdevices: 8/8\n"
        "card 1: sndrpihifiberry [snd_rpi_hifiberry_dac], device 0: HifiBerry DAC HiFi pcm5102a-hifi-0 [HifiBerry DAC HiFi pcm5102a-hifi-0]\n"
        "  Subdevices: 1/1\n"
    )

    _usb = parse_aplay_devices(_APLAY_USB)
    ok("aplay: a USB dongle is not the headphone jack", not _usb[1]["is_headphone"])
    ok("aplay: a USB dongle is not HDMI", not _usb[1]["is_hdmi"])
    eq("aplay: the USB output is addressable", _usb[1]["alsa"], "plughw:1,0")

    eq("aplay: no sound card yields no outputs", parse_aplay_devices(""), [])
    eq("aplay: junk yields no outputs", parse_aplay_devices("no soundcards found..."), [])
    ok("aplay: never raises on rubbish", isinstance(parse_aplay_devices("card x: y"), list))

    # -- USB is a NAMED category, not "whatever is left over" ----------------
    ok("aplay: a USB dongle is positively identified as USB", _usb[1]["is_usb"])
    ok("aplay: the Pi's own jack is not USB", not _usb[0]["is_usb"])
    ok("aplay: HDMI is not USB", not _bw[1]["is_usb"])
    ok("aplay: the old bcm2835 jack is not USB", not _old[0]["is_usb"])

    # Stable addresses survive the cards being renumbered at boot.
    eq("aplay: stable name for the USB dongle", _usb[1]["stable"], "plughw:CARD=Device,DEV=0")
    eq("aplay: stable name for the analog jack", _usb[0]["stable"], "plughw:CARD=Headphones,DEV=0")
    ok("aplay: the stable name is not position-based", "CARD=" in _usb[1]["stable"])

    # -- output_kind / rank_outputs -----------------------------------------
    eq("kind: USB dongle", output_kind(_usb[1]), "usb")
    eq("kind: analog jack", output_kind(_usb[0]), "headphone")
    eq("kind: HDMI", output_kind(_bw[1]), "hdmi")

    # THE HEADLINE RULE: with a dongle present, the dongle wins.
    _ranked = rank_outputs(_usb)
    eq("rank: the USB dongle is preferred over the Pi's jack", output_kind(_ranked[0]), "usb")
    eq("rank: the analog jack comes second", output_kind(_ranked[1]), "headphone")

    # HDMI must never win: it is the system default and cannot open headless.
    _three = parse_aplay_devices(
        "card 0: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]\n"
        "card 1: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
        "card 2: Device [USB Audio Device], device 0: USB Audio [USB Audio]\n"
    )
    eq("rank: three outputs parsed", len(_three), 3)
    _r3 = rank_outputs(_three)
    eq("rank: USB first even when HDMI is card 0", output_kind(_r3[0]), "usb")
    eq("rank: jack second", output_kind(_r3[1]), "headphone")
    eq("rank: HDMI dead last", output_kind(_r3[2]), "hdmi")
    eq("rank: ranking never loses an output", len(_r3), 3)

    # An unrecognised card (I2S HAT) beats HDMI but not the dongle.
    _hat = parse_aplay_devices(
        "card 0: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]\n"
        "card 1: sndrpihifiberry [snd_rpi_hifiberry_dac], device 0: HifiBerry DAC HiFi [HifiBerry]\n"
    )
    eq("rank: an add-on card is 'other', not guessed as USB", output_kind(_hat[1]), "other")
    eq("rank: an add-on card still beats HDMI", output_kind(rank_outputs(_hat)[0]), "other")

    # -- choose_output -------------------------------------------------------
    eq("choose: with no config, the dongle wins", choose_output(_three)["alsa"], "plughw:2,0")
    eq(
        "choose: an explicitly configured jack is respected",
        choose_output(_three, "plughw:1,0")["alsa"],
        "plughw:1,0",
    )
    eq(
        "choose: a configured STABLE name is respected too",
        choose_output(_three, "plughw:CARD=Headphones,DEV=0")["alsa"],
        "plughw:1,0",
    )
    eq(
        "choose: a hw: spelling matches the same output",
        choose_output(_three, "hw:2,0")["alsa"],
        "plughw:2,0",
    )
    # THE REPORTED FAULT: a config pinned to a device that is GONE must not
    # win, or the shop plays to a card that is not there and stays silent.
    eq(
        "choose: a configured device that is unplugged falls back to the best present one",
        choose_output(_usb, "plughw:7,0")["alsa"],
        "plughw:1,0",
    )
    eq("choose: no devices yields nothing rather than crashing", choose_output([]), None)

    # -- playback_order ------------------------------------------------------
    _chain = playback_order(_three)
    eq("chain: every output is offered", len(_chain), 3)
    eq("chain: the dongle is tried first", _chain[0], "plughw:CARD=Device,DEV=0")
    eq("chain: HDMI is tried last", _chain[-1], "plughw:CARD=vc4hdmi,DEV=0")
    ok("chain: uses stable names so a reboot cannot break it", all("CARD=" in a for a in _chain))
    _chain_cfg = playback_order(_three, "plughw:1,0")
    eq("chain: an explicit choice leads the list", _chain_cfg[0], "plughw:CARD=Headphones,DEV=0")
    eq("chain: but the dongle is still available as a fallback", len(_chain_cfg), 3)
    eq("chain: no hardware yields an empty list", playback_order([]), [])
    # Two ALSA lines that resolve to ONE address must not be tried twice.
    # This needs a fixture that actually collides: the old bcm2835 layout puts
    # two outputs on one card, and a malformed duplicate line is something
    # `aplay -l` really can produce after a hot-replug. A no-duplicates assert
    # made against a list that never had any is a test that cannot fail --
    # mutation "duplicate outputs no longer removed" survived until this was
    # written, proving the original assert was decoration.
    _dupe_src = (
        "card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]\n"
        "card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]\n"
        "card 0: Headphones [bcm2835 Headphones], device 0: bcm2835 Headphones [bcm2835 Headphones]\n"
    )
    _dupe_devices = parse_aplay_devices(_dupe_src)
    eq("chain: the duplicate fixture really does repeat a device", len(_dupe_devices), 3)
    _dupe_chain = playback_order(_dupe_devices)
    eq("chain: the repeated output is collapsed to one entry", len(_dupe_chain), 2)
    eq("chain: no duplicates survive", len(_dupe_chain), len(set(_dupe_chain)))
    eq("chain: the dongle still leads after deduping", _dupe_chain[0], "plughw:CARD=Device,DEV=0")
    ok("chain: three-output chain has no duplicates either", len(_chain) == len(set(_chain)))

    # -- play_with_fallback --------------------------------------------------
    # Injected players, so this runs with no sound card present.
    _attempts: List[Optional[str]] = []

    def _all_fail(_p: Path, dev: Optional[str]) -> Tuple[bool, str]:
        _attempts.append(dev)
        return False, "audio open error: Unknown error 524"

    def _only_usb_works(_p: Path, dev: Optional[str]) -> Tuple[bool, str]:
        _attempts.append(dev)
        return (True, "played") if dev == "plughw:CARD=Device,DEV=0" else (False, "no such device")

    _attempts.clear()
    _played, _detail, _used = play_with_fallback(Path("/tmp/x.wav"), _chain, _only_usb_works)
    ok("fallback: finds the output that works", _played)
    eq("fallback: reports which one worked", _used, "plughw:CARD=Device,DEV=0")
    eq("fallback: stopped as soon as it succeeded", len(_attempts), 1)

    # The whole point: the jack still makes a noise if the dongle is pulled.
    def _only_jack_works(_p: Path, dev: Optional[str]) -> Tuple[bool, str]:
        _attempts.append(dev)
        return (True, "played") if dev == "plughw:CARD=Headphones,DEV=0" else (False, "gone")

    _attempts.clear()
    _played2, _d2, _used2 = play_with_fallback(Path("/tmp/x.wav"), _chain, _only_jack_works)
    ok("fallback: dongle unplugged -> the aux jack still sounds", _played2)
    eq("fallback: and it says the jack was used", _used2, "plughw:CARD=Headphones,DEV=0")
    ok("fallback: it tried the dongle first", _attempts[0] == "plughw:CARD=Device,DEV=0")

    _attempts.clear()
    _played3, _detail3, _used3 = play_with_fallback(Path("/tmp/x.wav"), _chain, _all_fail)
    ok("fallback: total failure is reported as failure", not _played3)
    eq("fallback: every output was attempted before giving up", len(_attempts), 3)
    eq("fallback: nothing is claimed to have worked", _used3, None)
    ok("fallback: the message names the outputs it tried", "CARD=Device" in _detail3)

    # No enumerated hardware must still attempt the system default, not refuse.
    _attempts.clear()
    play_with_fallback(Path("/tmp/x.wav"), [], _all_fail)
    eq("fallback: with no list, the system default is still tried", _attempts, [None])

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
    ok("buzz: names that output", "plughw:card=device,dev=0" in _usb_advice)
    # The advice is a command the owner will PASTE and keep. Handing him a card
    # number means it works today and points at the wrong card after a power
    # cut -- the exact "it stopped working and nobody touched it" fault.
    ok(
        "buzz: the suggested command uses the reboot-proof name, not a card number",
        "--audio-device plughw:1,0" not in _usb_advice,
    )
    ok("buzz: does not tell him to buy one he does not need", "usb audio adapter is a real dac" not in _usb_advice)

    # Playing through the USB dongle: the PWM explanation must NOT appear.
    _clean = " ".join(diagnose_buzz(_usb, "plughw:1,0")).lower()
    ok("buzz: no PWM excuse when not using the analog jack", "pwm" not in _clean)
    ok("buzz: still covers electrical noise on any output", "even when nothing is playing" in _clean)
    # Same output, stable spelling. The diagnosis must not change because the
    # config was written by a newer installer.
    ok(
        "buzz: stable and numbered spellings of one output diagnose alike",
        "pwm" not in " ".join(diagnose_buzz(_usb, "plughw:CARD=Device,DEV=0")).lower(),
    )

    # Nothing configured, but a dongle is present: the Pi will PLAY through the
    # dongle, so blaming the PWM jack would be a diagnosis of a device that is
    # not in use. Previously this branch fired on "analog exists and no config".
    ok(
        "buzz: no PWM excuse when unconfigured but a dongle will be chosen",
        "pwm" not in " ".join(diagnose_buzz(_usb, None)).lower(),
    )
    # ...and the negative control: with ONLY the analog jack, it must still fire.
    ok(
        "buzz: PWM excuse DOES fire when the jack is all there is",
        "pwm" in " ".join(diagnose_buzz(_old, None)).lower(),
    )
    # A config naming a dongle that has been unplugged must diagnose the jack
    # that is actually carrying the sound, not the absent dongle.
    ok(
        "buzz: an unplugged configured device does not suppress the real diagnosis",
        "pwm" in " ".join(diagnose_buzz(_old, "plughw:CARD=Device,DEV=0")).lower(),
    )

    ok("buzz: always returns advice, even with no devices", len(diagnose_buzz([], None)) >= 1)
    ok(
        "buzz: no devices means no PWM claim it cannot support",
        "pwm" not in " ".join(diagnose_buzz([], None)).lower(),
    )

    # An I2S HAT is a real DAC but it is NOT the USB dongle the owner bought.
    # Calling it "another audio output" and telling him to switch to it would
    # send him hunting for a device he does not have. Under the old
    # define-USB-by-elimination rule this is exactly what happened.
    _hat = parse_aplay_devices(_APLAY_HAT)
    eq("aplay: the HAT fixture parses", len(_hat), 2)
    ok("aplay: an I2S HAT is not USB", not _hat[1]["is_usb"])
    ok("aplay: an I2S HAT is not the headphone jack", not _hat[1]["is_headphone"])
    ok("aplay: an I2S HAT is not HDMI", not _hat[1]["is_hdmi"])
    eq("outputs: an I2S HAT is classed as 'other', not 'usb'", output_kind(_hat[1]), "other")
    _hat_advice = " ".join(diagnose_buzz(_hat, "plughw:0,0")).lower()
    ok(
        "buzz: an I2S HAT is not passed off as a USB dongle",
        "already has another audio output" not in _hat_advice,
    )
    ok(
        "buzz: with no real dongle it still recommends buying one",
        "usb audio adapter is a real dac" in _hat_advice,
    )
    # ...but the HAT is still a better output than HDMI and must be offered.
    ok(
        "outputs: an I2S HAT still outranks HDMI in the fallback chain",
        playback_order(_hat, None)[0] == "plughw:CARD=Headphones,DEV=0",
    )
    ok(
        "outputs: the HAT is still reachable as a fallback",
        "plughw:CARD=sndrpihifiberry,DEV=0" in playback_order(_hat, None),
    )

    # -- candidate_probe_order ----------------------------------------------
    # We save the reboot-proof name, so we must PROVE the reboot-proof name.
    # Probing one spelling and saving another writes an address into the config
    # that was never played through.
    eq(
        "probe order: the reboot-proof spelling is tried first",
        candidate_probe_order(_usb[1])[0],
        "plughw:CARD=Device,DEV=0",
    )
    eq(
        "probe order: the card number is kept as a fallback spelling",
        candidate_probe_order(_usb[1]),
        ["plughw:CARD=Device,DEV=0", "plughw:1,0"],
    )
    ok(
        "probe order: never offers the same address twice",
        len(candidate_probe_order(_usb[1])) == len(set(candidate_probe_order(_usb[1]))),
    )
    # A card whose two spellings collapse to one must not be probed twice.
    eq(
        "probe order: identical spellings collapse to a single attempt",
        candidate_probe_order({"stable": "plughw:CARD=X,DEV=0", "alsa": "plughw:CARD=X,DEV=0"}),
        ["plughw:CARD=X,DEV=0"],
    )
    eq("probe order: a device with no addresses yields nothing", candidate_probe_order({}), [])

    # -- cmd_audio: the actual screen the owner reads ------------------------
    # The report is the only thing standing between the owner and an hour of
    # guessing at a silent speaker. Until now nothing executed it, so every
    # rule inside it (ordering, stable names, the unplugged warning, the
    # fallback chain) was unprotected. This runs the real function with the
    # shell calls stubbed and asserts on what it actually prints.
    def _render(aplay_text: str, configured: Optional[str]) -> str:
        real_run, real_which = subprocess.run, shutil.which
        buf: List[str] = []
        real_print = builtins.print

        def _fake_run(cmd, *a, **kw):
            out = b""
            if list(cmd[:2]) == ["aplay", "-l"]:
                out = aplay_text.encode()
            elif list(cmd[:2]) == ["amixer", "scontrols"]:
                out = b"Simple mixer control 'PCM',0\n"
            elif list(cmd[:2]) == ["amixer", "-M"]:
                out = b"  Mono: Playback 80 [80%] [on]\n"
            return types.SimpleNamespace(returncode=0, stdout=out, stderr=b"")

        try:
            subprocess.run = _fake_run
            shutil.which = lambda n: "/usr/bin/" + n
            builtins.print = lambda *a, **k: buf.append(" ".join(str(x) for x in a))
            cmd_audio(
                argparse.Namespace(
                    audio_device=configured,
                    config="/nonexistent/greenway-selftest.json",
                )
            )
        finally:
            subprocess.run, shutil.which = real_run, real_which
            builtins.print = real_print
        return "\n".join(buf)

    # Assertions below target the SPECIFIC line, not the whole page. Searching
    # the whole page is how a test passes on text that happens to appear
    # somewhere else -- e.g. the listing and the fallback chain both contain
    # the same addresses, so "is it anywhere" proves nothing about either.
    def _line(report: str, prefix: str) -> str:
        for ln in report.splitlines():
            if ln.strip().startswith(prefix):
                return ln
        return ""

    def _listing(report: str) -> List[str]:
        """Only the 'Found N outputs, best first:' block."""
        out, grabbing = [], False
        for ln in report.splitlines():
            if ln.startswith("Found "):
                grabbing = True
                continue
            if grabbing:
                if not ln.strip() or ln.strip().startswith("("):
                    break
                out.append(ln.strip())
        return out

    _rep = _render(_APLAY_USB, None)
    ok("audio report: lists the USB dongle", "USB Audio" in _rep)
    ok(
        "audio report: the IN USE line names the dongle",
        "USB audio adapter" in _line(_rep, "In use:"),
    )
    ok("audio report: shows the fallback chain", "tried in order" in _rep)
    ok("audio report: the jack is listed as a fallback", "plughw:CARD=Headphones,DEV=0" in _rep)

    # The listing must use reboot-proof names. Asserting the stable name is
    # merely "in the report" passed even when the listing printed plughw:1,0,
    # because the fallback chain below it carried the stable name anyway.
    _rows = _listing(_rep)
    eq("audio report: every output is listed", len(_rows), 2)
    ok(
        "audio report: the listing uses reboot-proof CARD= names",
        all(r.startswith("plughw:CARD=") for r in _rows),
    )
    ok(
        "audio report: the listing never offers a bare card number",
        not any(re.match(r"^plughw:\d+,\d+", r) for r in _rows),
    )

    # Ordering is the whole feature: USB must be printed ABOVE the jack, and
    # must be first in the chain. Asserting mere presence would pass even if
    # the preference were reversed.
    ok(
        "audio report: USB is listed above the analog jack",
        _rows and _rows[0].startswith("plughw:CARD=Device,DEV=0"),
    )
    ok(
        "audio report: USB is first in the fallback chain",
        "1. plughw:CARD=Device,DEV=0" in _rep,
    )

    # Negative control for that ordering: with no dongle present, the jack must
    # take first place. If the assertions above pass in BOTH worlds they are
    # measuring nothing.
    _rep_jack = _render(_APLAY_BOOKWORM, None)
    ok(
        "audio report: with no dongle the jack is first instead",
        "1. plughw:CARD=Headphones,DEV=0" in _rep_jack,
    )
    ok("audio report: HDMI is never promoted to first", "1. plughw:CARD=vc4hdmi" not in _rep_jack)

    # A configured device that is not plugged in must be called out, not
    # silently reported as "in use" -- that is the fault being fixed.
    _rep_ghost = _render(_APLAY_USB, "plughw:CARD=Ghost,DEV=0")
    ok("audio report: warns when the configured output is absent", "WARNING" in _rep_ghost)
    ok("audio report: says it is falling back", "not plugged in right now" in _rep_ghost)
    ok(
        "audio report: still names what will really play",
        "USB audio adapter" in _line(_rep_ghost, "In use:"),
    )
    # The report must never answer "what will play?" with silence or a shrug.
    # Without this, blanking the lookup entirely still passed, because the
    # dongle's name appears elsewhere on the page.
    ok(
        "audio report: the IN USE line is never 'nothing found' when hardware exists",
        "no audio output was found" not in _line(_rep_ghost, "In use:"),
    )
    ok(
        "audio report: the IN USE line names a real device when one exists",
        "no audio output was found" not in _line(_rep, "In use:"),
    )
    # An explicitly configured, present jack must be reported as in use -- the
    # negative control proving the IN USE line tracks the choice rather than
    # printing a constant.
    ok(
        "audio report: the IN USE line follows an explicit jack choice",
        "3.5 mm jack" in _line(_render(_APLAY_USB, "plughw:CARD=Headphones,DEV=0"), "In use:"),
    )

    # ...and the negative control: a device that IS present must NOT warn.
    _rep_ok = _render(_APLAY_USB, "plughw:CARD=Device,DEV=0")
    ok("audio report: no false alarm for a present output", "WARNING" not in _rep_ok)
    # The same output spelled with a card number must also not warn. This is
    # the regression that made a correct config look broken.
    ok(
        "audio report: a numbered spelling of a present output does not warn",
        "WARNING" not in _render(_APLAY_USB, "plughw:1,0"),
    )
    ok(
        "audio report: a hw: spelling of a present output does not warn",
        "WARNING" not in _render(_APLAY_USB, "hw:CARD=Device,DEV=0"),
    )

    # An explicitly configured jack must be honoured, not overridden by USB.
    _rep_forced = _render(_APLAY_USB, "plughw:CARD=Headphones,DEV=0")
    ok(
        "audio report: an explicit jack choice is obeyed over USB",
        "1. plughw:CARD=Headphones,DEV=0" in _rep_forced,
    )
    ok(
        "audio report: the dongle is still offered as a fallback",
        "2. plughw:CARD=Device,DEV=0" in _rep_forced,
    )

    # No hardware at all must fail loudly and usefully, never traceback.
    _rep_none = _render("no soundcards found...\n", None)
    ok("audio report: says plainly when there is no sound hardware", "No audio outputs found" in _rep_none)

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

    p_use = sub.add_parser("use-output", help="Set which sound output this speaker uses.")
    p_use.add_argument("device", help="ALSA device, e.g. plughw:1,0")
    p_use.set_defaults(func=cmd_use_output)

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
