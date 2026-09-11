#!/usr/bin/env python3
"""
greenway_printer.py — the Greenway receipt printer agent.

Runs on the same Raspberry Pi as the order announcer. Its whole job is: ask the
website if there is a receipt to print, and if there is, print it.

WHY IT IS SHAPED THIS WAY
-------------------------
The Pi makes OUTBOUND requests to the website. Nothing connects INTO the shop,
which means:

  * no port forwarding, no firewall holes, no router configuration;
  * no static IP, and nothing breaks when the ISP rotates the shop's address;
  * it works identically on Wi-Fi, on Ethernet, and on a phone hotspot.

The printer itself is a dumb USB ESC/POS unit (the vretti / Rongta class of
device). Linux's `usblp` kernel driver exposes it as a character device at
/dev/usb/lp0, and printing is literally writing bytes to that file. No vendor
driver, no CUPS queue, no PPD. That is why a $73 printer works here: this
agent supplies the intelligence the printer does not have.

We deliberately speak the SAME CloudPRNT protocol the website already serves at
/api/cloudprnt, rather than inventing a new endpoint:

  POST   /api/cloudprnt              -> "is there a job?"  { jobReady, jobToken }
  GET    /api/cloudprnt?token=<JOB>  -> the receipt text
  DELETE /api/cloudprnt?token=<JOB>  -> "it printed, mark it done"

That means this agent reuses the queue, the retry cap, the admin diagnostics
panel and the test-print button that already exist and are already tested. If
the shop ever buys a real Star CloudPRNT printer, it speaks this same protocol
and the Pi can simply be unplugged.

THE RULES THIS FILE OBEYS
-------------------------
1. NEVER EXIT. Any unexpected error is caught, logged, and retried. systemd
   would restart us anyway, but a process that stays up keeps its backoff
   state and does not spam the journal with restarts.
2. NEVER GO SILENT WITHOUT SAYING WHY. Every failure path writes one plain
   English line to the journal, including what to do about it. This Pi has no
   screen; the journal is the only witness.
3. NEVER CONFIRM A RECEIPT THAT DID NOT PRINT. We only send the DELETE after
   the bytes are flushed to the device. If we crash mid-print the job stays
   claimed, goes stale after two minutes, and is offered again. A duplicate
   receipt costs a few inches of paper; a lost receipt costs a customer.
4. NEVER LET ONE BAD JOB BLOCK THE QUEUE FOREVER. The server's attempt cap
   handles that, and we surface the reason instead of hiding it.

Requires: Python 3.9+ (Raspberry Pi OS Bookworm ships 3.11) and `requests`.
No other dependencies — printing is a file write.
"""

from __future__ import annotations

import argparse
import getpass
import grp
import json
import logging
import os
import platform
import pwd
import re
import socket
import stat
import sys
import tempfile
import textwrap
import time
import unicodedata
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

# Where the pairing result lives. Root-owned, mode 600: it holds the poll token.
DEFAULT_CONFIG_PATH = Path("/etc/greenway-printer/config.json")

# Candidate device paths, in the order we try them. usblp numbers devices in
# plug order, so lp0 is the only one in play with a single printer -- but if the
# printer is unplugged and replugged without a reboot it can land on lp1.
DEVICE_CANDIDATES = [f"/dev/usb/lp{n}" for n in range(10)] + [
    # Some images expose the raw device without the usb/ subdirectory.
    f"/dev/lp{n}"
    for n in range(4)
]

# Backoff between failed polls, in seconds. Mirrors the announcer so both
# agents behave identically on the same Pi during an outage.
POLL_BACKOFF_SECONDS = [1, 2, 5, 10, 20, 30]

# How long to wait between polls when everything is healthy. The CloudPRNT
# endpoint answers immediately (it does not long-poll), so this is the real
# knob for "how fast does a receipt appear". Three seconds is imperceptible to
# a customer and is 20 requests a minute -- nothing.
IDLE_POLL_SECONDS = 3

# Hard ceilings on single HTTP calls.
POLL_TIMEOUT_SECONDS = 20
SHORT_TIMEOUT_SECONDS = 15

# Receipt width in characters. 80mm paper at Font A is 48 columns; the server
# formats the text, so this is only used for locally generated test pages.
DEFAULT_COLUMNS = 48

# A receipt longer than this is almost certainly a bug (a stack trace, an HTML
# error page). Printing it would waste the whole roll, so we refuse loudly.
MAX_RECEIPT_BYTES = 64 * 1024

log = logging.getLogger("greenway-printer")


# ============================================================================
# ESC/POS — the printer's command language.
#
# Every cheap thermal printer understands this Epson-derived dialect. We use
# the smallest possible subset, because the more exotic the command the more
# likely a no-name printer ignores it (or prints it as garbage text).
# ============================================================================

ESC = b"\x1b"
GS = b"\x1d"

# ESC @ — initialise. Clears any leftover bold/underline/alignment state from a
# previous job or from whatever the printer did at power-on. Without this, one
# malformed receipt can leave every later receipt in double-height.
CMD_INIT = ESC + b"@"
# ESC a 0 — left align.
CMD_ALIGN_LEFT = ESC + b"a\x00"
# ESC t 0 — select character code table 0 (PC437). The universal default; we
# also fold text to ASCII so the table barely matters, but setting it removes
# the chance that a previous job left us in Katakana.
CMD_CODEPAGE_437 = ESC + b"t\x00"
# ESC d n — feed n lines. Needed before a cut so the last line clears the
# cutter blade, which sits ~2cm above the print head. Skip this and you
# guillotine the footer.
CMD_FEED_4 = ESC + b"d\x04"
# GS V 66 0 — "Function B" partial cut after feeding to the cut position. The
# most widely implemented cut command. Printers without a cutter ignore it.
CMD_CUT = GS + b"V\x42\x00"


# ============================================================================
# PURE HELPERS — no I/O, unit-testable. See selftest().
# ============================================================================

def backoff_for(consecutive_failures: int) -> int:
    """
    How long to wait after N consecutive failures.

    Zero failures means no wait at all. The delay climbs to a 30s ceiling and
    stays there: an agent that backs off to ten minutes is an agent that misses
    the receipt for the customer standing at the counter when the wifi returns.
    """
    if consecutive_failures <= 0:
        return 0
    idx = min(consecutive_failures, len(POLL_BACKOFF_SECONDS)) - 1
    return POLL_BACKOFF_SECONDS[idx]


def normalize_site_url(raw: Any) -> Optional[str]:
    """
    Clean up whatever the installer typed for the website address.

    Accepts 'example.com', 'https://example.com/', ' https://example.com/api '
    and returns a bare origin with no trailing slash. Returns None when there
    is nothing usable, so the caller can refuse to pair rather than writing a
    broken config that fails silently at 9am.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    if not re.match(r"^https?://", text, re.IGNORECASE):
        text = "https://" + text
    text = text.rstrip("/")
    # Reject an address with no host at all (e.g. "https://").
    match = re.match(r"^(https?)://([^/\s?#]+)", text, re.IGNORECASE)
    if not match:
        return None
    host = match.group(2)
    if "." not in host and host.split(":")[0] not in ("localhost", "127.0.0.1"):
        # A bare word like "mysite" cannot resolve; catching it here turns a
        # baffling DNS error at runtime into a clear message during pairing.
        return None
    return f"{match.group(1).lower()}://{host}"


def safe_columns(raw: Any) -> int:
    """
    Paper width in characters, clamped to something a thermal printer can do.

    Junk or missing values become 48 (80mm paper), NOT zero. A zero here would
    produce empty receipts, which is a far worse failure than a slightly wrong
    width.
    """
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_COLUMNS
    if value < 24:
        return 24
    if value > 96:
        return 96
    return value


def ascii_fold(text: str) -> str:
    """
    Force receipt text into plain ASCII the printer can actually render.

    Cheap ESC/POS printers have no Unicode. Handed a UTF-8 'é' they print two
    pieces of garbage; handed '—' or a smart quote (which every copy-paste from
    a document contains) they print a random box character. Names and product
    titles in this database DO contain these characters, so folding is not
    optional.

    Strategy: replace the punctuation we know about with ASCII equivalents,
    then decompose accents and drop the combining marks, then substitute '?'
    for anything still unprintable so the receipt stays legible and aligned.
    """
    if not text:
        return ""
    replacements = {
        "\u2018": "'", "\u2019": "'", "\u201a": ",", "\u201b": "'",
        "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2032": "'", "\u2033": '"',
        "\u2013": "-", "\u2014": "-", "\u2012": "-", "\u2015": "-", "\u2212": "-",
        "\u2026": "...", "\u2022": "*", "\u00b7": "*", "\u2043": "-",
        "\u00a0": " ", "\u2009": " ", "\u200a": " ", "\u202f": " ", "\u3000": " ",
        "\u200b": "", "\u200c": "", "\u200d": "", "\ufeff": "",
        "\u00ae": "(R)", "\u00a9": "(C)", "\u2122": "(TM)",
        "\u00bd": "1/2", "\u00bc": "1/4", "\u00be": "3/4",
        "\u00b0": "deg", "\u20ac": "EUR", "\u00a3": "GBP", "\u00a5": "JPY",
        "\u2190": "<-", "\u2192": "->", "\u2264": "<=", "\u2265": ">=",
        "\u00d7": "x", "\u00f7": "/",
    }
    out = []
    for ch in text:
        if ch in replacements:
            out.append(replacements[ch])
            continue
        if ch in ("\n", "\r", "\t"):
            out.append(ch)
            continue
        if 32 <= ord(ch) <= 126:
            out.append(ch)
            continue
        # Decompose (é -> e + combining acute) and keep only ASCII pieces.
        decomposed = unicodedata.normalize("NFKD", ch)
        kept = "".join(c for c in decomposed if 32 <= ord(c) <= 126)
        out.append(kept if kept else "?")
    return "".join(out)


def normalize_newlines(text: str) -> str:
    """
    Thermal printers want CR+LF or bare LF consistently; mixed endings can
    produce a blank line between every printed line (double spacing) on some
    firmware. Normalise everything to bare LF.
    """
    return text.replace("\r\n", "\n").replace("\r", "\n")


def build_escpos(body_text: str, *, cut: bool = True) -> bytes:
    """
    Turn receipt text into the exact byte stream to write to the device.

    Order matters: initialise, set a known code page and alignment, print the
    text, feed the paper clear of the cutter, then cut.
    """
    text = normalize_newlines(ascii_fold(body_text))
    if not text.endswith("\n"):
        text += "\n"
    payload = CMD_INIT + CMD_CODEPAGE_437 + CMD_ALIGN_LEFT
    payload += text.encode("ascii", errors="replace")
    payload += CMD_FEED_4
    if cut:
        payload += CMD_CUT
    return payload


def parse_poll_reply(payload: Any) -> Tuple[bool, Optional[str]]:
    """
    Read the CloudPRNT poll answer: is a job ready, and what is its token?

    Defensive on purpose. A reverse proxy, a captive portal or a deploy in
    progress can return HTML, a string, or a half-built object where we expect
    JSON. Anything we cannot understand means "no job", never a crash.

    Returns (job_ready, job_token). job_ready is only True when we also have a
    usable token, because being told "yes" without a token is unactionable --
    and treating it as actionable is what would spin a hot loop.
    """
    if not isinstance(payload, dict):
        return False, None
    ready = payload.get("jobReady")
    if ready is not True:
        # Tolerate the string "true" some proxies produce, but nothing looser:
        # "false", 0 and None must all mean no.
        if not (isinstance(ready, str) and ready.strip().lower() == "true"):
            return False, None
    token = payload.get("jobToken")
    if not isinstance(token, str) or not token.strip():
        return False, None
    return True, token.strip()


def describe_http_error(status: int) -> str:
    """
    Plain-English HTTP failures, written for whoever is standing at the Pi.

    401 is called out specifically because it is the one error a person can
    actually fix, and because the D-68 defect made it the symptom of a server
    bug rather than a wrong token. Naming both possibilities saves an hour.
    """
    if status == 401:
        return (
            "The website refused this Pi's printer token (401). Check that the token in "
            "Admin -> Equipment -> Receipt printer matches the one on this Pi "
            "(run: greenway-printer status), then re-pair with: "
            "sudo greenway-printer pair <token> --site https://your-site.com"
        )
    if status == 403:
        return "The website forbade the request (403). The printer token may have been revoked."
    if status == 404:
        return (
            "The printer endpoint was not found (404). The website may be mid-deploy, or the "
            "site address on this Pi may be wrong (run: greenway-printer status)."
        )
    if status == 503:
        return (
            "The website is refusing printer requests until a poll token is set (503). "
            "Set one in Admin -> Equipment -> Receipt printer, then pair this Pi with it."
        )
    if status == 429:
        return "The website asked us to slow down (429). Backing off."
    if 500 <= status <= 599:
        return f"The website had an internal error ({status}). Not this Pi's fault. Will retry."
    if status in (202, 302, 303, 307, 308):
        # Observed for real: a security gateway in front of a domain answers
        # 202 with an HTML CAPTCHA redirect instead of passing the request
        # through. The request never reached our code, so no amount of token
        # fiddling will help -- but "unexpected status 202" sends the reader
        # hunting for a token problem that does not exist.
        return (
            f"The website answered {status} instead of handling the printer request. "
            "This usually means the address points at a domain behind a security "
            "gateway or CAPTCHA, which blocks automated requests before they reach "
            "the printer code. Point this Pi at the address that serves the printer "
            "software directly (run: greenway-printer status to see the current one)."
        )
    if 200 <= status <= 299:
        return (
            f"The website answered {status} with something the printer could not use. "
            "If this address sits behind a security gateway or CAPTCHA, it is "
            "intercepting the request. Check the site address with: "
            "greenway-printer status"
        )
    return f"The website answered with an unexpected status {status}."


def describe_device_problem(path: str, exists: bool, writable: bool) -> str:
    """
    Explain a printer device problem in terms of what to physically do.

    This is the single most valuable function in the file. "Permission denied
    on /dev/usb/lp0" means nothing to a shop owner; "the printer is plugged in
    but this agent is not allowed to talk to it, run this one command" does.
    """
    if not exists:
        return (
            f"No printer found at {path}. Check that: (1) the printer's USB cable is plugged "
            "into the Pi, (2) the printer is switched on and its light is steady, not blinking "
            "(a blinking light usually means the paper roll is out or the lid is open). "
            "Then run: greenway-printer status"
        )
    if not writable:
        user = "this agent"
        try:
            user = getpass.getuser()
        except Exception:
            pass
        return (
            f"The printer at {path} is plugged in, but {user} is not allowed to write to it. "
            "Fix it by running:  sudo usermod -a -G lp $USER  and then rebooting. "
            "(The bundled installer runs the agent as root, which avoids this entirely.)"
        )
    return f"The printer at {path} could not be written to."


def agent_info() -> Dict[str, Any]:
    """A small identity blob for the journal and the status command."""
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "unknown"
    return {
        "agent": "greenway-printer",
        "version": AGENT_VERSION,
        "hostname": hostname,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }


def pi_mac_address() -> Optional[str]:
    """
    Best-effort MAC address, used as the printer identity in the heartbeat so
    the admin panel can show WHICH device is polling. Never fatal.
    """
    for iface in ("eth0", "wlan0", "end0"):
        candidate = Path(f"/sys/class/net/{iface}/address")
        try:
            if candidate.exists():
                value = candidate.read_text(encoding="utf-8").strip()
                if value and value != "00:00:00:00:00:00":
                    return value.upper()
        except Exception:
            continue
    return None


def build_test_receipt(columns: int = DEFAULT_COLUMNS) -> str:
    """
    A locally generated page that proves the hardware works without needing the
    website, an order, or a queue. Deliberately exercises the things that
    actually break: column alignment, the full ASCII range, accented
    characters, and a long wrapping line.
    """
    width = safe_columns(columns)
    line = "-" * width
    title = "GREENWAY PRINTER TEST".center(width).rstrip()
    stamp = time.strftime("%b %d %Y %I:%M%p")
    rows = [
        title,
        line,
        "If you can read this, the printer works.",
        "",
        f"Version : {AGENT_VERSION}",
        f"Columns : {width}",
        f"Printed : {stamp}",
        "",
        "Alignment check (bars must line up):",
        "|" + "1234567890" * ((width - 2) // 10) + "|",
        line,
        "Character check:",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789 !#$%&()*+,-./:;=?@",
        "",
        "Accents (should read Jose, cafe, 1/2):",
        "Jos\u00e9, caf\u00e9, \u00bd \u2014 \u201csmart quotes\u201d",
        line,
        "Nothing was charged. No order affected.",
        "",
    ]
    # Wrap to the paper width rather than trusting the printer's own wrapping,
    # which on narrow rolls silently chops the overflow instead of continuing
    # it on the next line. Verified by the selftest at both 32 and 48 columns.
    out: List[str] = []
    for row in rows:
        folded = ascii_fold(row)
        if not folded:
            out.append("")
            continue
        if len(folded) <= width:
            out.append(folded)
            continue
        out.extend(textwrap.wrap(folded, width=width, break_long_words=True) or [""])
    return "\n".join(out)


# ============================================================================
# CONFIG
# ============================================================================

def load_config(path: Path) -> Dict[str, Any]:
    """Read the config, or return {} when it is missing/unreadable."""
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        log.error(
            "The config file %s is not valid JSON (%s). Re-pair this Pi to rewrite it.",
            path,
            exc,
        )
        return {}
    except OSError as exc:
        log.error("Could not read %s (%s).", path, exc)
        return {}


def save_config(path: Path, data: Dict[str, Any]) -> None:
    """
    Write the config atomically with mode 600.

    Atomic because a power cut during a normal write leaves a truncated file,
    and a Pi with a truncated config is a Pi that will not print after the
    power comes back. 600 because this file contains the poll token.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=".config-",
        delete=False,
    )
    tmp_path = Path(handle.name)
    try:
        with handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise


# ============================================================================
# DEVICE
# ============================================================================

def device_state(path: str) -> Tuple[bool, bool]:
    """(exists, writable) for a device path. Never raises."""
    try:
        p = Path(path)
        if not p.exists():
            return False, False
        return True, os.access(path, os.W_OK)
    except Exception:
        return False, False


def find_printer_device(preferred: Optional[str] = None) -> Tuple[Optional[str], str]:
    """
    Locate the printer.

    Returns (path, note). A configured path always wins so a two-printer setup
    stays predictable; otherwise we scan the usual suspects and prefer one we
    can actually write to over one we merely can see. That ordering matters:
    reporting "found lp0 but permission denied" when lp1 is usable would send
    someone chasing a permissions ghost.
    """
    if preferred:
        exists, writable = device_state(preferred)
        if exists and writable:
            return preferred, f"Using the configured printer device {preferred}."
        return None, describe_device_problem(preferred, exists, writable)

    seen_but_unwritable: Optional[str] = None
    for candidate in DEVICE_CANDIDATES:
        exists, writable = device_state(candidate)
        if exists and writable:
            return candidate, f"Found the printer at {candidate}."
        if exists and seen_but_unwritable is None:
            seen_but_unwritable = candidate

    if seen_but_unwritable:
        return None, describe_device_problem(seen_but_unwritable, True, False)
    return None, describe_device_problem(DEVICE_CANDIDATES[0], False, False)


def write_to_device(path: str, payload: bytes) -> Tuple[bool, str]:
    """
    Write bytes to the printer and make sure they left the buffer.

    os.fsync is the important part: without it Python can return successfully
    while the bytes are still in the kernel buffer, and we would confirm the
    job to the website before the paper moved. If the printer is off or jammed
    the write is what fails, and the job must stay unconfirmed.
    """
    # A printer under usblp is a CHARACTER device: it has no file offset, so
    # every write simply streams to the print head. A regular file does have an
    # offset, and O_WRONLY alone would rewind to 0 and overwrite the previous
    # receipt. That matters in two real cases: the end-to-end tests (which
    # point this at a temp file to assert on the exact byte stream), and
    # capturing output to a file for diagnosis. So append when, and only when,
    # the target is a regular file. On a character device O_APPEND is a no-op.
    flags = os.O_WRONLY
    try:
        if stat.S_ISREG(os.stat(path).st_mode):
            flags |= os.O_APPEND
    except OSError:
        pass

    try:
        fd = os.open(path, flags)
    except PermissionError:
        return False, describe_device_problem(path, True, False)
    except FileNotFoundError:
        return False, describe_device_problem(path, False, False)
    except OSError as exc:
        return False, f"Could not open the printer at {path}: {exc}"

    try:
        os.write(fd, payload)
        try:
            os.fsync(fd)
        except OSError:
            # Some usblp implementations do not support fsync on the character
            # device. The write itself is synchronous there, so this is not a
            # failure -- but we say so rather than pretending we verified it.
            log.debug("Device %s does not support fsync; relying on synchronous write.", path)
        return True, f"Sent {len(payload)} bytes to {path}."
    except BrokenPipeError:
        return False, (
            f"The printer at {path} disconnected mid-print. Check the USB cable, then the "
            "receipt will be retried automatically."
        )
    except OSError as exc:
        # ENOSPC / EIO from usblp almost always means out of paper or lid open.
        return False, (
            f"The printer at {path} rejected the data ({exc}). This usually means the paper "
            "roll is empty or the lid is not fully closed."
        )
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


# ============================================================================
# THE AGENT
# ============================================================================

class ReceiptPrinter:
    def __init__(self, config: Dict[str, Any]) -> None:
        site = normalize_site_url(config.get("siteUrl"))
        if not site:
            raise ValueError(
                "No usable website address in the config. Re-pair this Pi with: "
                "sudo greenway-printer pair <token> --site https://your-site.com"
            )
        self.site_url = site
        self.poll_token = str(config.get("pollToken") or "")
        self.device_path: Optional[str] = config.get("devicePath") or None
        self.columns = safe_columns(config.get("paperColumns"))
        self.cut = config.get("cut") is not False
        self.session = requests.Session()
        self.session.headers.update(
            {"user-agent": f"greenway-printer/{AGENT_VERSION}"}
        )
        # CloudPRNT authenticates with the poll token as the HTTP Basic
        # password. D-68: this is the channel the server prefers for the "auth"
        # use precisely because the ?token= query parameter is reserved for the
        # per-receipt job token on the GET and DELETE steps.
        if self.poll_token:
            self.session.auth = ("printer", self.poll_token)
        self.running = True
        self.consecutive_failures = 0
        self.printed_count = 0
        self.last_ok_at: Optional[float] = None

    @property
    def endpoint(self) -> str:
        return f"{self.site_url}/api/cloudprnt"

    def stop(self, *_: Any) -> None:
        log.info("Stop requested. Finishing the current receipt and shutting down cleanly.")
        self.running = False

    # -- network -----------------------------------------------------------

    def _request(
        self,
        method: str,
        *,
        params: Optional[Dict[str, str]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        timeout: int = SHORT_TIMEOUT_SECONDS,
    ) -> Tuple[Optional[requests.Response], Optional[str]]:
        """One HTTP call, with every network failure turned into English."""
        try:
            response = self.session.request(
                method,
                self.endpoint,
                params=params,
                json=json_body,
                timeout=timeout,
            )
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
        return response, None

    def poll(self) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Ask whether a receipt is waiting. Returns (job_ready, token, error).

        The POST body mirrors what Star firmware sends, so the server's
        existing heartbeat recording works unchanged and the admin panel shows
        this Pi as the polling device.
        """
        body: Dict[str, Any] = {
            "status": "200 OK",
            "statusCode": "200 OK",
            "printerMAC": pi_mac_address() or "00:00:00:00:00:00",
            "clientType": "greenway-pi",
            "clientVersion": AGENT_VERSION,
        }
        response, error = self._request(
            "POST", json_body=body, timeout=POLL_TIMEOUT_SECONDS
        )
        if error is not None:
            return False, None, error
        assert response is not None
        try:
            payload = response.json()
        except ValueError:
            return False, None, "The website sent a reply that could not be understood."
        ready, token = parse_poll_reply(payload)
        return ready, token, None

    def fetch_job(self, token: str) -> Tuple[Optional[str], Optional[str]]:
        """Fetch the receipt text for a job token. Returns (text, error)."""
        response, error = self._request("GET", params={"token": token})
        if error is not None:
            return None, error
        assert response is not None
        raw = response.content
        if not raw:
            # A 200 with an empty body means the job vanished (cancelled from
            # the admin panel between our poll and our fetch). Not an error.
            return None, "The receipt was no longer available (it may have been cancelled)."
        if len(raw) > MAX_RECEIPT_BYTES:
            return None, (
                f"Refusing to print a {len(raw)}-byte receipt; that is far larger than any "
                "real receipt and would waste the paper roll. The job has been left for "
                "review in Admin -> Equipment -> Receipt printer."
            )
        try:
            return raw.decode("utf-8"), None
        except UnicodeDecodeError:
            # Never fail on encoding -- print what we can rather than nothing.
            return raw.decode("utf-8", errors="replace"), None

    def confirm_job(self, token: str) -> Optional[str]:
        """Tell the website the receipt printed. Returns an error string or None."""
        _, error = self._request("DELETE", params={"token": token})
        return error

    # -- printing ----------------------------------------------------------

    def resolve_device(self) -> Tuple[Optional[str], str]:
        return find_printer_device(self.device_path)

    def print_text(self, body_text: str) -> Tuple[bool, str]:
        """Render and write one receipt. Returns (ok, detail)."""
        device, note = self.resolve_device()
        if device is None:
            return False, note
        payload = build_escpos(body_text, cut=self.cut)
        return write_to_device(device, payload)

    def handle_one_job(self, token: str) -> bool:
        """
        Fetch, print, and confirm a single receipt.

        The order is deliberate and is the whole reason rule 3 exists: we only
        confirm AFTER the bytes are flushed. If we die in between, the server
        re-offers the job after two minutes.
        """
        text, error = self.fetch_job(token)
        if error is not None or text is None:
            log.error("Could not get the receipt from the website: %s", error)
            return False

        ok, detail = self.print_text(text)
        if not ok:
            # Do NOT confirm. The job stays claimed, goes stale, and is
            # retried -- which is exactly what we want when the paper ran out.
            log.error("Receipt did not print: %s", detail)
            return False

        log.info("Receipt printed. %s", detail)
        self.printed_count += 1

        confirm_error = self.confirm_job(token)
        if confirm_error:
            # The paper is already out of the printer, so this is a warning.
            # Worst case the server re-offers it and the customer gets two
            # copies -- far better than us dropping a receipt.
            log.warning(
                "Printed, but could not confirm it to the website (%s). "
                "It may print a second time.",
                confirm_error,
            )
        return True

    def poll_once(self) -> bool:
        """One cycle. Returns False when the cycle failed (caller backs off)."""
        ready, token, error = self.poll()
        if error is not None:
            self.consecutive_failures += 1
            # Log the first failure loudly, then stay quiet until it recovers.
            # An overnight outage must not fill the SD card with identical
            # lines -- SD card wear is the number one killer of Pi appliances.
            if self.consecutive_failures == 1:
                log.error("%s", error)
            elif self.consecutive_failures % 20 == 0:
                log.error(
                    "Still failing after %d attempts: %s", self.consecutive_failures, error
                )
            return False

        if self.consecutive_failures > 0:
            log.info(
                "Back in touch with the website after %d failed attempts.",
                self.consecutive_failures,
            )
        self.consecutive_failures = 0
        self.last_ok_at = time.time()

        if not ready or not token:
            return True

        self.handle_one_job(token)
        return True

    def run(self) -> int:
        log.info(
            "Greenway printer agent v%s starting. Site %s", AGENT_VERSION, self.site_url
        )
        device, note = self.resolve_device()
        if device is None:
            # Not fatal: the printer may simply be switched off right now, and
            # this agent must come back on its own when it is switched on.
            log.warning("%s", note)
            log.warning("Polling anyway; receipts will print once the printer is reachable.")
        else:
            log.info("%s", note)

        while self.running:
            try:
                ok = self.poll_once()
            except Exception as exc:  # never exit the loop
                self.consecutive_failures += 1
                log.exception("Unexpected problem while polling (%s). Continuing.", exc)
                ok = False

            if not self.running:
                break
            delay = backoff_for(self.consecutive_failures) if not ok else IDLE_POLL_SECONDS
            waited = 0.0
            while waited < delay and self.running:
                time.sleep(min(0.5, delay - waited))
                waited += 0.5

        log.info("Greenway printer agent stopped. %d receipt(s) printed.", self.printed_count)
        return 0


# ============================================================================
# COMMANDS
# ============================================================================

def cmd_pair(args: argparse.Namespace) -> int:
    """
    Save the site address and poll token, then prove both work.

    "Pair" is a slight misnomer -- there is no handshake, because CloudPRNT
    uses a single shared token the owner sets in the admin panel. We keep the
    verb so the two Pi agents are operated identically.
    """
    config_path = Path(args.config)
    existing = load_config(config_path)

    raw_site = args.site or existing.get("siteUrl")
    site = normalize_site_url(raw_site)
    if not site:
        # Say WHAT was wrong with what they typed, not just what is wanted.
        # A missing colon ("https//site.com") is an easy typo to make and an
        # easy one to stare straight past: the eye reads the word "https" and
        # moves on. Quoting it back with the fix spelled out ends that hunt.
        hint = ""
        if isinstance(raw_site, str) and raw_site.strip():
            shown = raw_site.strip()
            if re.match(r"^https?//", shown, re.IGNORECASE):
                fixed = re.sub(r"^(https?)//", r"\1://", shown, flags=re.IGNORECASE)
                hint = (
                    f"\nYou typed:  {shown}\n"
                    f"The ':' is missing after 'https'. You want:\n  {fixed}"
                )
            elif re.match(r"^https?:/[^/]", shown, re.IGNORECASE):
                fixed = re.sub(r"^(https?):/", r"\1://", shown, flags=re.IGNORECASE)
                hint = (
                    f"\nYou typed:  {shown}\n"
                    f"There is only one '/' after 'https:'. You want:\n  {fixed}"
                )
            else:
                hint = f"\nI could not make sense of:  {shown}"
        print(
            "I need the website address. Example:\n"
            "  sudo greenway-printer pair YOUR-TOKEN --site https://your-site.com"
            + hint,
            file=sys.stderr,
        )
        return 2

    token = (args.token or "").strip()
    if not token:
        print(
            "I need the printer poll token from Admin -> Equipment -> Receipt printer.\n"
            "  sudo greenway-printer pair YOUR-TOKEN --site https://your-site.com",
            file=sys.stderr,
        )
        return 2

    config = dict(existing)
    config["siteUrl"] = site
    config["pollToken"] = token
    if args.device:
        config["devicePath"] = args.device
    if args.columns is not None:
        config["paperColumns"] = safe_columns(args.columns)
    if args.no_cut:
        config["cut"] = False

    try:
        save_config(config_path, config)
    except OSError as exc:
        print(f"Could not save {config_path}: {exc}", file=sys.stderr)
        print("Try again with sudo.", file=sys.stderr)
        return 1
    print(f"Saved {config_path}.")

    # Prove it end to end rather than declaring success on a file write.
    try:
        agent = ReceiptPrinter(config)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"Checking the connection to {site} ...")
    ready, job_token, error = agent.poll()
    if error is not None:
        print(f"\nPaired, but the check FAILED:\n  {error}", file=sys.stderr)
        return 1
    print("  The website accepted this Pi's token.")

    device, note = agent.resolve_device()
    print(f"  {note}")
    if ready and job_token:
        print("  A receipt is already waiting; it will print when the service runs.")
    if device is None:
        print("\nPaired. Plug in / switch on the printer, then run: greenway-printer test")
        return 0
    print("\nPaired and ready. Test the printer with: sudo greenway-printer test")
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    """
    Print a locally generated test page.

    Needs no website and no order, which makes it the right first step: it
    isolates 'is the printer wired up correctly' from 'is the website talking
    to us', so a failure points at exactly one of the two.
    """
    config = load_config(Path(args.config))
    preferred = args.device or config.get("devicePath")
    columns = safe_columns(
        args.columns if args.columns is not None else config.get("paperColumns")
    )

    device, note = find_printer_device(preferred)
    print(note)
    if device is None:
        return 1

    payload = build_escpos(build_test_receipt(columns), cut=not args.no_cut)
    ok, detail = write_to_device(device, payload)
    print(detail)
    if not ok:
        return 1
    print("\nIf a test page came out, the printer is working correctly.")
    print("If the paper moved but the page is blank, the roll is in upside down.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Everything a person needs to diagnose this Pi, in one screen."""
    config_path = Path(args.config)
    config = load_config(config_path)

    print(f"Agent           : greenway-printer v{AGENT_VERSION}")
    print(f"Config file     : {config_path}" + ("" if config else "  (MISSING or empty)"))

    site = normalize_site_url(config.get("siteUrl"))
    print(f"Website         : {site or '(not set)'}")
    token = str(config.get("pollToken") or "")
    if token:
        shown = token[:3] + "..." + token[-3:] if len(token) > 8 else "(set)"
        print(f"Printer token   : {shown}  ({len(token)} characters)")
    else:
        print("Printer token   : (not set)")

    device, note = find_printer_device(config.get("devicePath"))
    print(f"Printer device  : {device or '(not found)'}")
    print(f"  -> {note}")

    print(f"Paper columns   : {safe_columns(config.get('paperColumns'))}")
    print(f"Auto-cut        : {'no' if config.get('cut') is False else 'yes'}")
    mac = pi_mac_address()
    print(f"This Pi's MAC   : {mac or '(unknown)'}")

    # Group membership is the single most common cause of "it worked for root
    # but not for the service", so report it rather than making someone guess.
    try:
        user = getpass.getuser()
        groups = sorted(g.gr_name for g in grp.getgrall() if user in g.gr_mem)
        primary = grp.getgrgid(pwd.getpwnam(user).pw_gid).gr_name
        print(f"Running as      : {user} (groups: {primary} {' '.join(groups)})".rstrip())
        if os.geteuid() != 0 and "lp" not in groups and primary != "lp":
            print("  NOTE: not in the 'lp' group. If printing fails with a permission error,")
            print("        run:  sudo usermod -a -G lp $USER   then reboot.")
    except Exception:
        pass

    if not site or not token:
        print("\nNot paired yet. Run:")
        print("  sudo greenway-printer pair YOUR-TOKEN --site https://your-site.com")
        return 1

    print(f"\nChecking {site}/api/cloudprnt ...")
    try:
        agent = ReceiptPrinter(config)
    except ValueError as exc:
        print(f"  {exc}")
        return 1
    ready, job_token, error = agent.poll()
    if error is not None:
        print(f"  FAILED: {error}")
        return 1
    print("  OK - the website accepted this Pi's token.")
    print(
        "  A receipt is waiting to print."
        if ready
        else "  No receipts waiting (this is normal)."
    )
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """What systemd starts."""
    import signal

    config = load_config(Path(args.config))
    if not config:
        log.error(
            "No configuration at %s. Pair this Pi first: "
            "sudo greenway-printer pair YOUR-TOKEN --site https://your-site.com",
            args.config,
        )
        # Exit non-zero so systemd's restart loop makes the problem visible in
        # `systemctl status` instead of the agent silently idling forever.
        return 1
    try:
        agent = ReceiptPrinter(config)
    except ValueError as exc:
        log.error("%s", exc)
        return 1
    signal.signal(signal.SIGTERM, agent.stop)
    signal.signal(signal.SIGINT, agent.stop)
    return agent.run()


# ============================================================================
# SELF-TEST
# ============================================================================

def selftest() -> int:
    """
    Run the pure logic checks.

    This ships with the agent on purpose: when something is wrong at 9am on a
    Saturday, being able to run `greenway-printer selftest` on the actual Pi
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

    # -- site url ---------------------------------------------------------
    eq("url: adds https", normalize_site_url("example.com"), "https://example.com")
    eq("url: keeps https", normalize_site_url("https://example.com"), "https://example.com")
    eq("url: keeps http", normalize_site_url("http://example.com"), "http://example.com")
    eq("url: strips trailing slash", normalize_site_url("https://example.com/"), "https://example.com")
    eq("url: strips whitespace", normalize_site_url("  example.com  "), "https://example.com")
    eq("url: strips path", normalize_site_url("https://example.com/admin/x"), "https://example.com")
    eq("url: keeps port", normalize_site_url("http://localhost:3000"), "http://localhost:3000")
    eq("url: allows localhost", normalize_site_url("localhost"), "https://localhost")
    eq("url: lowercases scheme", normalize_site_url("HTTPS://Example.com"), "https://Example.com")
    eq("url: None is rejected", normalize_site_url(None), None)
    eq("url: empty is rejected", normalize_site_url(""), None)
    eq("url: blank is rejected", normalize_site_url("   "), None)
    eq("url: scheme only is rejected", normalize_site_url("https://"), None)
    eq("url: bare word is rejected", normalize_site_url("mysite"), None)
    eq("url: number is rejected", normalize_site_url(12345), None)

    # -- columns: the blank-receipt guard ---------------------------------
    eq("columns: 48 stays 48", safe_columns(48), 48)
    eq("columns: 32 stays 32", safe_columns(32), 32)
    eq("columns: None becomes 48 NOT 0", safe_columns(None), 48)
    eq("columns: empty string becomes 48 NOT 0", safe_columns(""), 48)
    eq("columns: junk becomes 48 NOT 0", safe_columns("wide"), 48)
    eq("columns: zero clamps up to 24", safe_columns(0), 24)
    eq("columns: negative clamps up to 24", safe_columns(-10), 24)
    eq("columns: 9999 clamps to 96", safe_columns(9999), 96)
    eq("columns: numeric string works", safe_columns("42"), 42)
    ok("columns: never zero for any input", all(
        safe_columns(v) >= 24 for v in [None, "", "x", 0, -1, [], {}, 1.5]
    ))

    # -- ascii folding: the garbage-character guard ------------------------
    eq("fold: plain ascii untouched", ascii_fold("Order #1234"), "Order #1234")
    eq("fold: accented e", ascii_fold("Jos\u00e9"), "Jose")
    eq("fold: accented cafe", ascii_fold("caf\u00e9"), "cafe")
    eq("fold: em dash", ascii_fold("a \u2014 b"), "a - b")
    eq("fold: en dash", ascii_fold("a \u2013 b"), "a - b")
    eq("fold: smart double quotes", ascii_fold("\u201chi\u201d"), '"hi"')
    eq("fold: smart single quotes", ascii_fold("\u2018hi\u2019"), "'hi'")
    eq("fold: apostrophe in a name", ascii_fold("O\u2019Brien"), "O'Brien")
    eq("fold: ellipsis", ascii_fold("wait\u2026"), "wait...")
    eq("fold: bullet", ascii_fold("\u2022 item"), "* item")
    eq("fold: half", ascii_fold("\u00bd oz"), "1/2 oz")
    eq("fold: registered mark", ascii_fold("Brand\u00ae"), "Brand(R)")
    eq("fold: degree", ascii_fold("70\u00b0"), "70deg")
    eq("fold: nbsp becomes space", ascii_fold("a\u00a0b"), "a b")
    eq("fold: zero-width space removed", ascii_fold("a\u200bb"), "ab")
    eq("fold: newlines preserved", ascii_fold("a\nb"), "a\nb")
    eq("fold: tabs preserved", ascii_fold("a\tb"), "a\tb")
    eq("fold: empty string", ascii_fold(""), "")
    eq("fold: emoji becomes ?", ascii_fold("\U0001f600"), "?")
    eq("fold: cjk becomes ?", ascii_fold("\u4e2d"), "?")
    ok("fold: output is always pure ascii", all(
        ord(c) < 128
        for c in ascii_fold("Jos\u00e9 \u2014 \u201cx\u201d \u00bd \U0001f600 \u4e2d \u00a0")
    ))
    ok("fold: never raises on odd input", ascii_fold("\x00\x01\x7f") is not None)

    # -- newline normalisation: the double-spacing guard ------------------
    eq("newlines: crlf becomes lf", normalize_newlines("a\r\nb"), "a\nb")
    eq("newlines: bare cr becomes lf", normalize_newlines("a\rb"), "a\nb")
    eq("newlines: lf untouched", normalize_newlines("a\nb"), "a\nb")
    eq("newlines: mixed normalised", normalize_newlines("a\r\nb\rc\nd"), "a\nb\nc\nd")

    # -- escpos: the byte stream ------------------------------------------
    payload = build_escpos("Hello")
    ok("escpos: starts with the init command", payload.startswith(CMD_INIT))
    ok("escpos: sets the code page", CMD_CODEPAGE_437 in payload)
    ok("escpos: sets left alignment", CMD_ALIGN_LEFT in payload)
    ok("escpos: contains the text", b"Hello" in payload)
    ok("escpos: feeds before cutting", payload.index(CMD_FEED_4) < payload.index(CMD_CUT))
    ok("escpos: ends with the cut", payload.endswith(CMD_CUT))
    ok("escpos: text ends with a newline", b"Hello\n" in payload)
    ok("escpos: no-cut option omits the cut", CMD_CUT not in build_escpos("Hello", cut=False))
    ok("escpos: no-cut still feeds the paper", CMD_FEED_4 in build_escpos("Hello", cut=False))
    ok("escpos: folds non-ascii before encoding", b"Jose" in build_escpos("Jos\u00e9"))
    ok("escpos: result is bytes", isinstance(build_escpos("x"), bytes))
    ok("escpos: empty receipt still initialises", build_escpos("").startswith(CMD_INIT))
    ok(
        "escpos: does not double the trailing newline",
        b"Hello\n\n" not in build_escpos("Hello\n"),
    )
    ok("escpos: never raises on odd text", isinstance(build_escpos("\U0001f600\r\n\x00"), bytes))

    # -- poll reply parsing: the hot-loop guard ---------------------------
    eq("poll: ready with token", parse_poll_reply({"jobReady": True, "jobToken": "t1"}), (True, "t1"))
    eq("poll: not ready", parse_poll_reply({"jobReady": False}), (False, None))
    eq("poll: ready but NO token is not actionable", parse_poll_reply({"jobReady": True}), (False, None))
    eq("poll: ready with empty token", parse_poll_reply({"jobReady": True, "jobToken": ""}), (False, None))
    eq("poll: ready with blank token", parse_poll_reply({"jobReady": True, "jobToken": "  "}), (False, None))
    eq("poll: token is trimmed", parse_poll_reply({"jobReady": True, "jobToken": " t1 "}), (True, "t1"))
    eq("poll: string 'true' tolerated", parse_poll_reply({"jobReady": "true", "jobToken": "t1"}), (True, "t1"))
    eq("poll: string 'false' means no", parse_poll_reply({"jobReady": "false", "jobToken": "t1"}), (False, None))
    eq("poll: 1 does not mean true", parse_poll_reply({"jobReady": 1, "jobToken": "t1"}), (False, None))
    eq("poll: non-string token rejected", parse_poll_reply({"jobReady": True, "jobToken": 99}), (False, None))
    eq("poll: html page is not a job", parse_poll_reply("<html>error</html>"), (False, None))
    eq("poll: None is not a job", parse_poll_reply(None), (False, None))
    eq("poll: list is not a job", parse_poll_reply([1, 2]), (False, None))
    eq("poll: empty dict is not a job", parse_poll_reply({}), (False, None))

    # -- error messages must be actionable --------------------------------
    ok("http 401: names the admin page", "Equipment" in describe_http_error(401))
    ok("http 401: gives the repair command", "pair" in describe_http_error(401))
    ok("http 503: explains the missing token", "poll token" in describe_http_error(503))
    ok("http 404: mentions the site address", "address" in describe_http_error(404))
    ok("http 500: says it is not the Pi's fault", "not this pi's fault" in describe_http_error(500).lower())
    ok("http: every status yields a non-empty message", all(
        len(describe_http_error(s)) > 20 for s in [400, 401, 403, 404, 418, 429, 500, 502, 503, 599]
    ))

    # --- WAF / security-gateway interception --------------------------------
    # Observed against a real domain: a security gateway answered POST
    # /api/cloudprnt with 202 + an HTML CAPTCHA redirect. The old message,
    # "unexpected status 202", sent the reader hunting for a token fault that
    # did not exist. These pin the diagnosis to the actual cause.
    for gateway_status in (202, 302, 303, 307, 308):
        msg = describe_http_error(gateway_status).lower()
        ok(
            f"http {gateway_status}: blames a security gateway, not the token",
            ("security gateway" in msg or "captcha" in msg),
        )
        ok(
            f"http {gateway_status}: tells the reader how to see the current address",
            "greenway-printer status" in msg,
        )
        ok(
            f"http {gateway_status}: does not accuse the printer token",
            "token" not in msg.split("printer code")[0].replace("printer software", ""),
        )
    ok(
        "http 2xx: a non-200 success is still reported as unusable",
        "could not use" in describe_http_error(204).lower(),
    )
    # Regression guard: 401/503 must NOT be swallowed by the new 2xx branch.
    ok("http 401 still names the admin page", "Equipment" in describe_http_error(401))
    ok("http 503 still explains the token", "poll token" in describe_http_error(503))

    # --- site address typos -------------------------------------------------
    # The exact typo made in the field: the colon after https was missing.
    ok("site: 'https//host' is refused, not silently accepted",
       normalize_site_url("https//example.com") is None)
    ok("site: 'https:/host' (one slash) is refused",
       normalize_site_url("https:/example.com") is None)
    ok("site: a bare host is accepted and gets https",
       normalize_site_url("example.com") == "https://example.com")
    ok("site: a trailing slash is trimmed",
       normalize_site_url("https://example.com/") == "https://example.com")

    ok("device missing: mentions the USB cable", "USB cable" in describe_device_problem("/dev/usb/lp0", False, False))
    ok("device missing: mentions the power switch", "switched on" in describe_device_problem("/dev/usb/lp0", False, False))
    ok("device missing: mentions paper/lid", "paper roll" in describe_device_problem("/dev/usb/lp0", False, False))
    ok("device unwritable: gives the usermod fix", "usermod -a -G lp" in describe_device_problem("/dev/usb/lp0", True, False))
    ok("device unwritable: does NOT blame the cable", "USB cable" not in describe_device_problem("/dev/usb/lp0", True, False))

    # -- test receipt ------------------------------------------------------
    page = build_test_receipt(48)
    ok("test page: has a title", "GREENWAY PRINTER TEST" in page)
    ok("test page: states nothing was charged", "Nothing was charged" in page)
    ok("test page: includes the version", AGENT_VERSION in page)
    ok("test page: respects a narrow width", all(
        len(line) <= 32 for line in build_test_receipt(32).split("\n")
    ))
    ok("test page: respects the default width", all(
        len(line) <= 48 for line in build_test_receipt(48).split("\n")
    ))
    # Every width a real thermal roll uses, plus the clamp edges. A ragged test
    # page would make someone suspect the printer when the bug was ours.
    ok("test page: never overflows at ANY supported width", all(
        len(line) <= w
        for w in (24, 30, 32, 33, 40, 42, 48, 56, 64, 80, 96)
        for line in build_test_receipt(w).split("\n")
    ))
    ok("test page: is pure ascii at every width", all(
        ord(c) < 128
        for w in (24, 32, 48, 96)
        for c in build_test_receipt(w)
    ))
    ok("test page: survives junk width", isinstance(build_test_receipt(safe_columns("x")), str))
    ok("test page: still readable when squeezed to 24", "printer works" in build_test_receipt(24))

    # -- device discovery --------------------------------------------------
    ok("devices: lp0 is checked first", DEVICE_CANDIDATES[0] == "/dev/usb/lp0")
    ok("devices: several are checked", len(DEVICE_CANDIDATES) >= 10)
    ok("devices: no duplicates", len(DEVICE_CANDIDATES) == len(set(DEVICE_CANDIDATES)))
    missing, note = find_printer_device("/dev/definitely-not-a-printer-xyz")
    eq("devices: a bad configured path finds nothing", missing, None)
    ok("devices: a bad configured path explains itself", "No printer found" in note)

    # -- config round trip -------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp, "sub", "config.json")
        eq("config: missing file reads as empty", load_config(target), {})
        save_config(target, {"siteUrl": "https://x.com", "pollToken": "abc"})
        loaded = load_config(target)
        eq("config: round-trips the site", loaded.get("siteUrl"), "https://x.com")
        eq("config: round-trips the token", loaded.get("pollToken"), "abc")
        mode = stat.S_IMODE(target.stat().st_mode)
        eq("config: is mode 600 (it holds the token)", mode, 0o600)
        ok("config: no temp files left behind", list(Path(tmp, "sub").glob(".config-*")) == [])
        Path(tmp, "bad.json").write_text("{not json", encoding="utf-8")
        eq("config: corrupt file reads as empty, not a crash", load_config(Path(tmp, "bad.json")), {})

        # -- writing: consecutive receipts must not overwrite each other ---
        # A character device has no file offset, but a regular file does, and
        # the capture/diagnostic path uses a regular file. Proven, not assumed.
        target = Path(tmp, "capture.bin")
        target.write_bytes(b"")
        write_to_device(str(target), b"FIRST")
        write_to_device(str(target), b"SECOND")
        eq("write: consecutive writes append, never overwrite", target.read_bytes(), b"FIRSTSECOND")
        ok_w, detail_w = write_to_device(str(target), b"X")
        ok("write: reports success", ok_w is True)
        ok("write: says how many bytes went out", "1 bytes" in detail_w)
        ok_bad, detail_bad = write_to_device(str(Path(tmp, "no-such-device")), b"X")
        ok("write: a missing device fails", ok_bad is False)
        ok("write: a missing device is explained", "No printer found" in detail_bad)

    # -- the agent wires the token into HTTP Basic auth (D-68) ------------
    agent = ReceiptPrinter({"siteUrl": "https://example.com", "pollToken": "tok123"})
    eq("agent: endpoint is /api/cloudprnt", agent.endpoint, "https://example.com/api/cloudprnt")
    eq("agent: token goes in Basic auth, not the query", agent.session.auth, ("printer", "tok123"))
    eq("agent: columns default safely", agent.columns, 48)
    ok("agent: cutting is on by default", agent.cut is True)
    ok(
        "agent: refuses a config with no site",
        _raises(lambda: ReceiptPrinter({"pollToken": "x"}), ValueError),
    )
    ok(
        "agent: refuses a config with a junk site",
        _raises(lambda: ReceiptPrinter({"siteUrl": "mysite", "pollToken": "x"}), ValueError),
    )

    print(f"\n{passed} checks passed, {failed} failed.")
    if failed == 0:
        print("ALL CHECKS PASSED — the printer software on this Pi is healthy.")
        return 0
    print("SOME CHECKS FAILED — the agent file may be corrupted. Reinstall it.")
    return 1


def _raises(fn: Any, exc_type: Any) -> bool:
    """True when fn() raises exc_type. Used by selftest only."""
    try:
        fn()
    except exc_type:
        return True
    except Exception:
        return False
    return False


# ============================================================================
# ENTRY POINT
# ============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="greenway-printer",
        description="Greenway receipt printer agent for Raspberry Pi.",
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG_PATH), help="Path to the config file."
    )
    parser.add_argument("--verbose", action="store_true", help="Log more detail.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run the printer agent (what systemd starts).")
    p_run.set_defaults(func=cmd_run)

    p_pair = sub.add_parser("pair", help="Save the site address and printer token.")
    p_pair.add_argument("token", help="The poll token from Admin -> Equipment -> Receipt printer.")
    p_pair.add_argument("--site", help="Website address, e.g. https://your-site.com")
    p_pair.add_argument("--device", help="Printer device path, e.g. /dev/usb/lp0")
    p_pair.add_argument("--columns", type=int, help="Paper width in characters (default 48).")
    p_pair.add_argument("--no-cut", action="store_true", help="Do not send the paper-cut command.")
    p_pair.set_defaults(func=cmd_pair)

    p_test = sub.add_parser("test", help="Print a test page. No website needed.")
    p_test.add_argument("--device", help="Printer device path, e.g. /dev/usb/lp0")
    p_test.add_argument("--columns", type=int, help="Paper width in characters.")
    p_test.add_argument("--no-cut", action="store_true", help="Do not send the paper-cut command.")
    p_test.set_defaults(func=cmd_test)

    p_status = sub.add_parser("status", help="Show config and check the printer + website.")
    p_status.set_defaults(func=cmd_status)

    p_self = sub.add_parser("selftest", help="Check the agent's own logic. No network needed.")
    p_self.set_defaults(func=lambda _a: selftest())

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
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
