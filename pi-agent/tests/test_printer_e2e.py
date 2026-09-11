#!/usr/bin/env python3
"""
End-to-end proof for the Greenway receipt printer agent.

The self-test inside greenway_printer.py proves the pure helpers. This file
proves the parts the self-test cannot reach: real HTTP against a real socket,
real bytes written to a real file, and the failure paths that actually happen
in the shop.

A temporary FILE stands in for /dev/usb/lp0. That is not a compromise: under
Linux's usblp driver, printing genuinely is "open the device and write bytes",
so writing to a regular file exercises the identical code path and lets us
assert on the exact ESC/POS stream the printer would have received.

The fake server implements the real CloudPRNT 2.5.2 contract, INCLUDING the
D-68 token rule: Basic auth carries the poll token, `?token=` carries the job
token. A regression on either side fails here.

Run:  python3 pi-agent/tests/test_printer_e2e.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
AGENT_DIR = HERE.parent
sys.path.insert(0, str(AGENT_DIR))

import greenway_printer as p  # noqa: E402

PASSED = 0
FAILED = 0

POLL_TOKEN = "poll-secret-abc123"
JOB_TOKEN = "job-77f3e1c7-2b4a-4d51-8e6f-0a1b2c3d4e5f"
RECEIPT_TEXT = "GREENWAY\nOrder #1234\nJos\u00e9 \u2014 1 x Blue Dream \u00bd oz\nTOTAL  $42.00\n"


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        print(f"  FAIL  {label}  {detail}")


def eq(label: str, got: Any, want: Any) -> None:
    check(label, got == want, f"(got {got!r}, want {want!r})")


# ---------------------------------------------------------------------------
# Fake server implementing the real /api/cloudprnt contract
# ---------------------------------------------------------------------------

class FakeState:
    def __init__(self) -> None:
        self.poll_token = POLL_TOKEN
        # Each entry is one receipt waiting to be handed out.
        self.queue: List[Dict[str, str]] = []
        self.polls = 0
        self.gets = 0
        self.deletes = 0
        self.confirmed: List[str] = []
        self.auth_seen: List[Optional[str]] = []
        self.query_tokens_seen: List[Optional[str]] = []
        self.poll_bodies: List[Dict[str, Any]] = []
        self.force_status: Optional[int] = None
        self.force_get_status: Optional[int] = None
        self.oversized: bool = False
        self.empty_body: bool = False
        self.bad_json: bool = False


STATE = FakeState()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        pass  # keep the test output readable

    # -- helpers ----------------------------------------------------------

    def _basic_password(self) -> Optional[str]:
        header = self.headers.get("authorization")
        STATE.auth_seen.append(header)
        if not header or not header.lower().startswith("basic "):
            return None
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8")
        except Exception:
            return None
        return decoded.split(":", 1)[1] if ":" in decoded else decoded

    def _query_token(self) -> Optional[str]:
        qs = parse_qs(urlparse(self.path).query)
        token = (qs.get("token") or [None])[0]
        STATE.query_tokens_seen.append(token)
        return token

    def _authorized(self) -> bool:
        """
        D-68 server rule: authentication reads the BASIC password, never the
        ?token= query (which carries the job token on GET/DELETE).
        """
        return self._basic_password() == STATE.poll_token

    def _deny(self) -> None:
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="cloudprnt"')
        self.end_headers()
        self.wfile.write(b'{"error":"unauthorized"}')

    def _json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- protocol ---------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802
        STATE.polls += 1
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            STATE.poll_bodies.append(json.loads(raw or b"{}"))
        except Exception:
            STATE.poll_bodies.append({})

        if STATE.force_status is not None:
            self.send_response(STATE.force_status)
            self.end_headers()
            return
        if not self._authorized():
            self._deny()
            return
        if STATE.bad_json:
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b"<html>not json</html>")
            return
        if not STATE.queue:
            self._json({"jobReady": False})
            return
        self._json(
            {
                "jobReady": True,
                "mediaTypes": ["text/plain"],
                "jobToken": STATE.queue[0]["token"],
                "deleteMethod": "DELETE",
            }
        )

    def do_GET(self) -> None:  # noqa: N802
        STATE.gets += 1
        if not self._authorized():
            self._deny()
            return
        token = self._query_token()
        if STATE.force_get_status is not None:
            self.send_response(STATE.force_get_status)
            self.end_headers()
            return
        job = next((j for j in STATE.queue if j["token"] == token), None)
        if job is None:
            self.send_response(404)
            self.end_headers()
            return
        if STATE.empty_body:
            body = b""
        elif STATE.oversized:
            body = b"x" * (p.MAX_RECEIPT_BYTES + 10)
        else:
            body = job["body"].encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self) -> None:  # noqa: N802
        STATE.deletes += 1
        if not self._authorized():
            self._deny()
            return
        token = self._query_token()
        STATE.confirmed.append(token or "")
        STATE.queue = [j for j in STATE.queue if j["token"] != token]
        self.send_response(200)
        self.end_headers()


def start_server() -> tuple[HTTPServer, str]:
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def reset(site: str, device: str, token: str = POLL_TOKEN) -> p.ReceiptPrinter:
    STATE.__init__()  # type: ignore[misc]
    return p.ReceiptPrinter(
        {"siteUrl": site, "pollToken": token, "devicePath": device}
    )


def main() -> int:
    server, site = start_server()
    tmpdir = tempfile.mkdtemp(prefix="gw-printer-test-")
    device = str(Path(tmpdir, "fake-lp0"))
    Path(device).write_bytes(b"")

    try:
        print("\n1. The happy path: a queued receipt reaches the paper")
        agent = reset(site, device)
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        ready, token, error = agent.poll()
        eq("poll reports a job is ready", ready, True)
        eq("poll returns the job token", token, JOB_TOKEN)
        eq("poll reports no error", error, None)

        handled = agent.handle_one_job(token or "")
        eq("the job was handled successfully", handled, True)
        written = Path(device).read_bytes()
        check("bytes reached the device", len(written) > 0, f"(got {len(written)})")
        check("stream starts with ESC @ (init)", written.startswith(p.CMD_INIT))
        check("stream ends with the cut command", written.endswith(p.CMD_CUT))
        check("receipt text is present", b"Order #1234" in written)
        check("accented name was folded to ASCII", b"Jose" in written)
        check("em dash was folded", b"Jose - 1 x Blue Dream 1/2 oz" in written)
        check("no raw UTF-8 bytes reached the printer", all(b < 128 for b in written))
        eq("the website was told it printed", STATE.confirmed, [JOB_TOKEN])
        eq("exactly one confirmation was sent", STATE.deletes, 1)
        eq("the queue is now empty", STATE.queue, [])

        print("\n2. D-68: the poll token and the job token travel separately")
        # The agent must put the poll token in BASIC AUTH and the job token in
        # the QUERY. If it ever put the job token in Basic (or the poll token
        # in the query on a GET) the server would 401 and nothing would print.
        check(
            "every request carried Basic auth",
            all(h and h.lower().startswith("basic ") for h in STATE.auth_seen),
            f"(saw {STATE.auth_seen})",
        )
        decoded = [
            base64.b64decode(h[6:]).decode("utf-8").split(":", 1)[1]
            for h in STATE.auth_seen
            if h
        ]
        check(
            "Basic auth always carried the POLL token, never the job token",
            all(d == POLL_TOKEN for d in decoded),
            f"(saw {decoded})",
        )
        query_tokens = [t for t in STATE.query_tokens_seen if t is not None]
        check(
            "the query string only ever carried the JOB token",
            query_tokens and all(t == JOB_TOKEN for t in query_tokens),
            f"(saw {query_tokens})",
        )
        check(
            "the poll token never appeared in a query string",
            POLL_TOKEN not in query_tokens,
        )

        print("\n3. A wrong token is refused with an actionable message")
        agent = reset(site, device, token="wrong-token")
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        ready, token, error = agent.poll()
        eq("a wrong token yields no job", ready, False)
        check("an error was reported", error is not None)
        check("the error names the 401", "401" in (error or ""))
        check("the error says where to look", "Equipment" in (error or ""))
        check("the error gives the fix command", "pair" in (error or ""))

        print("\n4. Nothing is confirmed when the printer cannot be written to")
        agent = reset(site, device + "-does-not-exist")
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        ready, token, _ = agent.poll()
        eq("the job is offered", ready, True)
        handled = agent.handle_one_job(token or "")
        eq("handling fails", handled, False)
        eq("NOTHING was confirmed (the receipt is not lost)", STATE.confirmed, [])
        eq("the job is still queued for retry", len(STATE.queue), 1)

        print("\n5. An empty queue is quiet and cheap")
        agent = reset(site, device)
        ready, token, error = agent.poll()
        eq("no job is reported", ready, False)
        eq("no token is returned", token, None)
        eq("no error is raised", error, None)
        before = STATE.gets
        agent.poll_once()
        eq("no receipt was fetched", STATE.gets, before)
        eq("no confirmation was sent", STATE.deletes, 0)

        print("\n6. A server error backs off instead of spinning")
        agent = reset(site, device)
        STATE.force_status = 500
        ok = agent.poll_once()
        eq("the cycle reports failure", ok, False)
        eq("the failure was counted", agent.consecutive_failures, 1)
        check("backoff is now non-zero", p.backoff_for(agent.consecutive_failures) > 0)
        STATE.force_status = None
        ok = agent.poll_once()
        eq("recovery resets the counter", agent.consecutive_failures, 0)

        print("\n7. A 503 (no poll token set on the site) is explained")
        agent = reset(site, device)
        STATE.force_status = 503
        _, _, error = agent.poll()
        check("the 503 mentions the poll token", "poll token" in (error or ""))
        check("the 503 points at the admin page", "Equipment" in (error or ""))
        STATE.force_status = None

        print("\n8. Junk instead of JSON does not crash or invent a job")
        agent = reset(site, device)
        STATE.bad_json = True
        ready, token, error = agent.poll()
        eq("no job is invented", ready, False)
        check("the reply is reported as unreadable", "understood" in (error or ""))
        STATE.bad_json = False

        print("\n9. A vanished receipt is handled gracefully")
        agent = reset(site, device)
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        STATE.empty_body = True
        Path(device).write_bytes(b"")
        handled = agent.handle_one_job(JOB_TOKEN)
        eq("handling reports failure", handled, False)
        eq("nothing was printed", Path(device).read_bytes(), b"")
        eq("nothing was confirmed", STATE.confirmed, [])
        STATE.empty_body = False

        print("\n10. An absurdly large body is refused, not printed")
        agent = reset(site, device)
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        STATE.oversized = True
        Path(device).write_bytes(b"")
        text, error = agent.fetch_job(JOB_TOKEN)
        eq("no text is returned", text, None)
        check("the refusal explains itself", "Refusing to print" in (error or ""))
        check("the refusal mentions the paper roll", "paper roll" in (error or ""))
        handled = agent.handle_one_job(JOB_TOKEN)
        eq("the job is not printed", Path(device).read_bytes(), b"")
        eq("the job is not confirmed", STATE.confirmed, [])
        STATE.oversized = False

        print("\n11. A 404 on the body does not confirm the job")
        agent = reset(site, device)
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        STATE.force_get_status = 404
        Path(device).write_bytes(b"")
        handled = agent.handle_one_job(JOB_TOKEN)
        eq("handling fails", handled, False)
        eq("nothing was confirmed", STATE.confirmed, [])
        STATE.force_get_status = None

        print("\n12. The poll body identifies this Pi to the admin panel")
        agent = reset(site, device)
        agent.poll()
        body = STATE.poll_bodies[-1]
        check("a status code is sent", bool(body.get("statusCode")))
        check("a printer MAC is sent", bool(body.get("printerMAC")))
        eq("the client type identifies the Pi", body.get("clientType"), "greenway-pi")
        eq("the agent version is sent", body.get("clientVersion"), p.AGENT_VERSION)

        print("\n13. Two receipts in a row both print")
        agent = reset(site, device)
        Path(device).write_bytes(b"")
        STATE.queue.append({"token": "job-a", "body": "RECEIPT A\n"})
        STATE.queue.append({"token": "job-b", "body": "RECEIPT B\n"})
        agent.poll_once()
        agent.poll_once()
        written = Path(device).read_bytes()
        check("the first receipt printed", b"RECEIPT A" in written)
        check("the second receipt printed", b"RECEIPT B" in written)
        eq("both were confirmed", sorted(STATE.confirmed), ["job-a", "job-b"])
        eq("the queue drained", STATE.queue, [])
        eq("each receipt got its own init command", written.count(p.CMD_INIT), 2)
        eq("each receipt got its own cut", written.count(p.CMD_CUT), 2)

        print("\n14. A confirmation failure still counts as printed")
        # The paper is already out of the printer. Losing the confirmation must
        # never be treated as a print failure -- at worst it prints twice.
        agent = reset(site, device)
        Path(device).write_bytes(b"")
        STATE.queue.append({"token": JOB_TOKEN, "body": RECEIPT_TEXT})
        original = agent.confirm_job
        agent.confirm_job = lambda _t: "simulated network drop"  # type: ignore[assignment]
        handled = agent.handle_one_job(JOB_TOKEN)
        eq("the job is still reported as handled", handled, True)
        check("the receipt did print", b"Order #1234" in Path(device).read_bytes())
        eq("the printed counter advanced", agent.printed_count, 1)
        agent.confirm_job = original  # type: ignore[assignment]

        print("\n15. The unreachable-site path is plain English")
        agent = p.ReceiptPrinter(
            {"siteUrl": "http://127.0.0.1:1", "pollToken": POLL_TOKEN, "devicePath": device}
        )
        _, _, error = agent.poll()
        check("an error is returned", error is not None)
        check("it mentions the network", "network" in (error or "").lower())
        check("it does not leak a stack trace", "Traceback" not in (error or ""))

        print("\n16. A real test page can be written to the device")
        Path(device).write_bytes(b"")
        payload = p.build_escpos(p.build_test_receipt(48))
        ok, detail = p.write_to_device(device, payload)
        eq("the write succeeded", ok, True)
        written = Path(device).read_bytes()
        check("the test page reached the device", b"GREENWAY PRINTER TEST" in written)
        check("the byte count is reported", "bytes" in detail)
        eq("the bytes match exactly", written, payload)

        print("\n17. Device discovery reports problems in human terms")
        found, note = p.find_printer_device(str(Path(tmpdir, "nope")))
        eq("a missing device is not found", found, None)
        check("the note mentions the USB cable", "USB cable" in note)
        found, note = p.find_printer_device(device)
        eq("a real device is found", found, device)
        check("the note says which device", device in note)

        print("\n18. Config survives a round trip with mode 600")
        cfg = Path(tmpdir, "etc", "config.json")
        p.save_config(cfg, {"siteUrl": site, "pollToken": POLL_TOKEN})
        loaded = p.load_config(cfg)
        eq("the site round-trips", loaded.get("siteUrl"), site)
        eq("the token round-trips", loaded.get("pollToken"), POLL_TOKEN)
        eq("the file is mode 600", oct(os.stat(cfg).st_mode & 0o777), "0o600")

    finally:
        server.shutdown()
        import shutil

        shutil.rmtree(tmpdir, ignore_errors=True)

    print("\n" + "=" * 60)
    print(f"{PASSED} passed, {FAILED} failed")
    if FAILED:
        print("E2E FAILED")
        return 1
    print("E2E PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
