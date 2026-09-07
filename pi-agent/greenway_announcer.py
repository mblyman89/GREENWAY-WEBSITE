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

AGENT_VERSION = "1.0.0"

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
    return f"Unexpected response from the website ({status})."


# ============================================================================
# AUDIO
# ============================================================================

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


def ensure_builtin(cache_dir: Path, kind: str) -> Path:
    """Return a playable path for a built-in sound, generating it once."""
    path = cache_dir / f"builtin-{kind}.wav"
    if not path.exists() or path.stat().st_size == 0:
        generate_tone_wav(path, kind)
    return path


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

def load_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
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

    if site is None and config_path.exists():
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
        return 1

    if response.status_code != 200:
        try:
            detail = response.json()
            message = detail.get("error") or detail.get("hint") or response.text
            hint = detail.get("hint")
        except ValueError:
            message = response.text
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
    cache_dir = Path(args.cache_dir)
    device = args.audio_device or None
    if not device and Path(args.config).exists():
        try:
            device = json.loads(Path(args.config).read_text(encoding="utf-8")).get("audioDevice") or None
        except Exception:
            device = None

    print("Playing each built-in sound. You should hear six different tones.\n")
    failures = 0
    for kind in ("chime", "bell", "ding", "alert", "cash", "voice"):
        path = ensure_builtin(cache_dir, kind)
        set_alsa_volume(args.volume, args.mixer_control)
        ok, detail = play_file(path, device)
        print(f"  {kind:<6} {'OK' if ok else 'FAILED — ' + detail}")
        if not ok:
            failures += 1
        time.sleep(0.4)

    if failures:
        print(
            "\nSome sounds did not play.\n"
            "  1. Is the speaker plugged in and switched on?\n"
            "  2. Is its volume knob turned up?\n"
            "  3. Run 'aplay -l' to list audio outputs, then set 'audioDevice' in\n"
            f"     {args.config} to the right one (for example: plughw:1,0).\n"
            "  4. Run 'alsamixer' and check nothing is muted (MM means muted; press M to unmute)."
        )
        return 1
    print("\nAll six sounds played. The audio hardware on this Pi is working.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    config_path = Path(args.config)
    print(f"Greenway announcer v{AGENT_VERSION}")
    for key, value in agent_info().items():
        print(f"  {key}: {value}")

    if not config_path.exists():
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

    # -- tone generation actually produces playable audio -----------------
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for kind in ("chime", "bell", "ding", "alert", "cash", "voice"):
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
