#!/usr/bin/env python3
"""
End-to-end proof for the Greenway announcer agent.

The self-test inside greenway_announcer.py proves the pure helpers. This file
proves the parts the self-test cannot reach: real HTTP against a real socket,
real files on disk, and the failure paths that matter in the shop.

A fake "aplay" is placed on PATH so we can prove a sound was actually played
and check exactly which file and which volume were used, without needing a
sound card in the sandbox.

Run:  python3 pi-agent/tests/test_e2e.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
AGENT_DIR = HERE.parent
sys.path.insert(0, str(AGENT_DIR))

import greenway_announcer as g  # noqa: E402

PASSED = 0
FAILED = 0


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
# Fake server implementing the real /api/announcer contracts
# ---------------------------------------------------------------------------

class FakeServerState:
    def __init__(self) -> None:
        self.pair_code = "ABCD2345"
        self.device_id = "dev-1"
        self.device_key = "key-secret"
        self.jobs_queue: List[List[Dict[str, Any]]] = []
        self.acks: List[Dict[str, Any]] = []
        self.heartbeats: List[Dict[str, Any]] = []
        self.polls = 0
        self.pair_attempts = 0
        self.sound_bytes: bytes | None = None
        self.sound_requests: List[str] = []
        self.force_poll_status: int | None = None
        self.auth_failures = 0


STATE = FakeServerState()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        pass  # keep the test output clean

    def _send(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        return (
            self.headers.get("x-announcer-device-id") == STATE.device_id
            and self.headers.get("x-announcer-device-key") == STATE.device_key
        )

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/announcer/sound":
            path_q = parse_qs(parsed.query).get("path", [""])[0]
            STATE.sound_requests.append(path_q)
            if STATE.sound_bytes is None:
                self._send(404, {"error": "not found"})
                return
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(STATE.sound_bytes)))
            self.end_headers()
            self.wfile.write(STATE.sound_bytes)
            return
        self._send(404, {"error": "no route"})

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {}
        route = urlparse(self.path).path

        if route == "/api/announcer/pair":
            STATE.pair_attempts += 1
            if body.get("code") != STATE.pair_code:
                self._send(400, {"error": "That code is not valid or has expired.",
                                 "hint": "Generate a fresh code in the back office."})
                return
            self._send(200, {
                "deviceId": STATE.device_id,
                "deviceKey": STATE.device_key,
                "deviceName": "Sales Floor",
                "pollHoldSeconds": 25,
            })
            return

        if not self._authed():
            STATE.auth_failures += 1
            self._send(401, {"error": "bad key"})
            return

        if route == "/api/announcer/poll":
            STATE.polls += 1
            if STATE.force_poll_status is not None:
                self._send(STATE.force_poll_status, {"error": "forced"})
                return
            jobs = STATE.jobs_queue.pop(0) if STATE.jobs_queue else []
            self._send(200, {
                "jobs": jobs,
                "serverTime": "2026-03-10T21:00:00.000Z",
                "pollHoldSeconds": 25,
                "deviceName": "Sales Floor",
                "enabled": True,
            })
            return

        if route == "/api/announcer/ack":
            STATE.acks.append(body)
            self._send(200, {"ok": True})
            return

        if route == "/api/announcer/heartbeat":
            STATE.heartbeats.append(body)
            self._send(200, {"ok": True, "enabled": True, "deviceName": "Sales Floor"})
            return

        self._send(404, {"error": "no route"})


# ---------------------------------------------------------------------------
# Fake aplay so playback is observable without a sound card
# ---------------------------------------------------------------------------

def install_fake_players(bin_dir: Path, log_file: Path, exit_code: int = 0) -> None:
    bin_dir.mkdir(parents=True, exist_ok=True)
    for name in ("aplay", "mpg123", "amixer"):
        script = bin_dir / name
        script.write_text(
            "#!/usr/bin/env bash\n"
            f'echo "{name} $*" >> "{log_file}"\n'
            f"exit {exit_code if name != 'amixer' else 0}\n"
        )
        script.chmod(0o755)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="gw-e2e-"))
    bin_dir = tmp / "bin"
    play_log = tmp / "played.log"
    cache_dir = tmp / "cache"
    config_path = tmp / "config.json"
    install_fake_players(bin_dir, play_log)
    os.environ["PATH"] = f"{bin_dir}:{os.environ['PATH']}"

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    site = f"http://127.0.0.1:{port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()

    print("\n=== 1. PAIRING (real HTTP) ===")
    import argparse
    args = argparse.Namespace(
        code="abcd-2345", site=site, config=str(config_path),
        audio_device="", mixer_control="",
    )
    rc = g.cmd_pair(args)
    eq("pair returns success", rc, 0)
    check("config file was written", config_path.exists())
    saved = json.loads(config_path.read_text())
    eq("device id stored", saved["deviceId"], "dev-1")
    eq("device key stored", saved["deviceKey"], "key-secret")
    eq("site url stored", saved["siteUrl"], site)
    mode = oct(config_path.stat().st_mode)[-3:]
    eq("config is mode 600 (device key is not world readable)", mode, "600")
    check("lowercase/dashed code was normalised and accepted",
          STATE.pair_attempts == 1)

    print("\n=== 2. PAIRING WITH A BAD CODE ===")
    bad = argparse.Namespace(code="WRONGCODE", site=site,
                             config=str(tmp / "nope.json"),
                             audio_device="", mixer_control="")
    eq("bad code is rejected with a non-zero exit", g.cmd_pair(bad), 1)
    check("no config written for a failed pairing", not (tmp / "nope.json").exists())

    print("\n=== 3. HEARTBEAT + ONE ORDER, END TO END ===")
    config = json.loads(config_path.read_text())
    ann = g.Announcer(config, cache_dir)
    payload, err = ann.post("heartbeat", {"agentInfo": g.agent_info()},
                            g.SHORT_TIMEOUT_SECONDS)
    eq("heartbeat succeeded", err, None)
    check("server received the heartbeat", len(STATE.heartbeats) == 1)
    info = STATE.heartbeats[0].get("agentInfo", {})
    # Field name pinned against agent_info(): the back office shows this blob
    # verbatim, so a rename here silently blanks the panel's diagnostics.
    check("heartbeat carries the agent version",
          info.get("agentVersion") == g.AGENT_VERSION, str(info))
    check("heartbeat carries the OS for diagnosis", isinstance(info.get("os"), str))
    check("heartbeat carries the hostname", isinstance(info.get("hostname"), str))
    # sanitizeAgentInfo() on the server drops nested values and caps at 20 keys.
    check("agent info is flat and small enough to survive the server's sanitiser",
          len(info) <= 20 and all(isinstance(v, (str, int, float, bool))
                                  for v in info.values()), str(info))

    STATE.jobs_queue.append([
        {"id": "job-1", "kind": "order", "message": "Online order 1041",
         "sound": "chime", "volume": 55, "createdAt": "2026-03-10T21:00:00Z"},
    ])
    ok = ann.poll_once()
    check("poll returned success", ok)
    log_text = play_log.read_text() if play_log.exists() else ""
    check("a sound was actually played", "aplay" in log_text, log_text)
    check("the chime file was the one played", "builtin-chime.wav" in log_text, log_text)
    eq("exactly one ack was sent", len(STATE.acks), 1)
    eq("the played job was acked", STATE.acks[0]["played"], ["job-1"])
    eq("nothing was reported as failed", STATE.acks[0]["failed"], [])

    print("\n=== 4. DUPLICATE JOB IS NOT PLAYED TWICE ===")
    play_log.write_text("")
    STATE.jobs_queue.append([
        {"id": "job-1", "kind": "order", "message": "Online order 1041",
         "sound": "chime", "volume": 55},
    ])
    ann.poll_once()
    eq("no audio played for a repeat job", play_log.read_text().strip(), "")
    eq("repeat job is still acked so the server can clear it",
       STATE.acks[-1]["played"], ["job-1"])

    print("\n=== 5. CUSTOM SOUND DOWNLOAD + CACHE ===")
    play_log.write_text("")
    custom_wav = tmp / "seed.wav"
    g.generate_tone_wav(custom_wav, "bell")
    STATE.sound_bytes = custom_wav.read_bytes()
    STATE.jobs_queue.append([
        {"id": "job-2", "kind": "order", "message": "Online order 1042",
         "sound": "custom/airhorn.wav", "volume": 80},
    ])
    ann.poll_once()
    check("custom sound was requested from the server", len(STATE.sound_requests) == 1,
          str(STATE.sound_requests))
    eq("the exact storage path was requested", STATE.sound_requests[0], "custom/airhorn.wav")
    log_text = play_log.read_text()
    check("the downloaded custom file was played", "custom_airhorn.wav" in log_text, log_text)
    cached = cache_dir / g.safe_cache_name("custom/airhorn.wav")
    check("custom sound is now cached on disk", cached.exists() and cached.stat().st_size > 0)

    play_log.write_text("")
    STATE.jobs_queue.append([
        {"id": "job-3", "kind": "order", "message": "1043",
         "sound": "custom/airhorn.wav", "volume": 80},
    ])
    ann.poll_once()
    eq("second use did NOT re-download (cache hit)", len(STATE.sound_requests), 1)
    check("cached file still played", "custom_airhorn.wav" in play_log.read_text())

    print("\n=== 6. CUSTOM SOUND MISSING -> STILL ANNOUNCES ===")
    play_log.write_text("")
    STATE.sound_bytes = None  # server now 404s on downloads
    STATE.jobs_queue.append([
        {"id": "job-4", "kind": "order", "message": "1044",
         "sound": "custom/deleted.wav", "volume": 60},
    ])
    ann.poll_once()
    log_text = play_log.read_text()
    check("fell back to the built-in chime instead of silence",
          "builtin-chime.wav" in log_text, log_text)
    eq("the order was still reported as played", STATE.acks[-1]["played"], ["job-4"])

    print("\n=== 7. MALFORMED JOBS DO NOT STOP GOOD ONES ===")
    play_log.write_text("")
    STATE.jobs_queue.append([
        "not-a-dict",
        {"no_id": True},
        {"id": "", "sound": "chime"},
        {"id": "job-5", "message": None, "sound": None, "volume": "junk"},
    ])
    ann.poll_once()
    eq("only the one valid job was acked", STATE.acks[-1]["played"], ["job-5"])
    check("the junk-volume job still played", "aplay" in play_log.read_text())

    print("\n=== 8. VOLUME REACHES THE MIXER ===")
    play_log.write_text("")
    cfg_vol = dict(config)
    cfg_vol["mixerControl"] = "PCM"
    ann_vol = g.Announcer(cfg_vol, cache_dir)
    STATE.jobs_queue.append([{"id": "job-6", "sound": "chime", "volume": 42}])
    ann_vol.poll_once()
    log_text = play_log.read_text()
    check("amixer was called with the job's volume", "42%" in log_text, log_text)

    print("\n=== 9. PLAYBACK FAILURE IS REPORTED, NOT SWALLOWED ===")
    play_log.write_text("")
    install_fake_players(bin_dir, play_log, exit_code=1)  # aplay now fails
    ann_fail = g.Announcer(config, cache_dir)
    STATE.jobs_queue.append([{"id": "job-7", "sound": "chime", "volume": 70}])
    ann_fail.poll_once()
    last = STATE.acks[-1]
    eq("nothing claimed as played", last["played"], [])
    eq("the failure was reported to the server", len(last["failed"]), 1)
    eq("the failed job id is correct", last["failed"][0]["id"], "job-7")
    check("a human-readable reason was included", len(last["failed"][0]["reason"]) > 0)
    install_fake_players(bin_dir, play_log, exit_code=0)  # restore

    print("\n=== 10. SERVER ERRORS: BACKOFF AND RECOVERY ===")
    STATE.force_poll_status = 503
    ann_err = g.Announcer(config, cache_dir)
    eq("poll reports failure on 503", ann_err.poll_once(), False)
    eq("failure counter incremented", ann_err.consecutive_failures, 1)
    eq("first retry waits 1s", g.backoff_for(ann_err.consecutive_failures), 1)
    for _ in range(9):
        ann_err.poll_once()
    eq("ten failures recorded", ann_err.consecutive_failures, 10)
    eq("backoff is capped at 30s, never longer",
       g.backoff_for(ann_err.consecutive_failures), 30)
    STATE.force_poll_status = None
    eq("recovers as soon as the server is healthy", ann_err.poll_once(), True)
    eq("failure counter reset after recovery", ann_err.consecutive_failures, 0)
    check("last-ok timestamp was set", ann_err.last_ok_at is not None)

    print("\n=== 11. BAD KEY IS EXPLAINED IN PLAIN ENGLISH ===")
    bad_cfg = dict(config)
    bad_cfg["deviceKey"] = "wrong-key"
    ann_bad = g.Announcer(bad_cfg, cache_dir)
    _, err = ann_bad.post("poll", {}, g.SHORT_TIMEOUT_SECONDS)
    check("an error was returned", err is not None)
    check("the message tells the owner to re-pair", "pair" in (err or "").lower(), err or "")

    print("\n=== 12. SITE UNREACHABLE IS EXPLAINED, NOT A STACK TRACE ===")
    dead_cfg = dict(config)
    dead_cfg["siteUrl"] = "http://127.0.0.1:9"
    ann_dead = g.Announcer(dead_cfg, cache_dir)
    _, err = ann_dead.post("poll", {}, 3)
    check("connection failure returns a message", err is not None)
    check("it mentions the network in plain words",
          "network" in (err or "").lower() or "reach" in (err or "").lower(), err or "")

    print("\n=== 13. THE RUN LOOP SURVIVES A CRASH AND STOPS CLEANLY ===")
    ann_loop = g.Announcer(config, cache_dir)
    boom = {"n": 0}

    def exploding_poll() -> bool:
        boom["n"] += 1
        if boom["n"] <= 2:
            raise RuntimeError("simulated crash")
        ann_loop.running = False
        return True

    ann_loop.poll_once = exploding_poll  # type: ignore[method-assign]
    ann_loop.post = lambda *a, **k: ({}, None)  # type: ignore[method-assign]
    t0 = time.time()
    rc = ann_loop.run()
    eq("run() exits cleanly after crashes", rc, 0)
    check("the loop kept going past both crashes", boom["n"] == 3, str(boom))
    check("it did not hang", time.time() - t0 < 30)

    print("\n=== 14. STOP SIGNAL IS HONOURED ===")
    ann_stop = g.Announcer(config, cache_dir)
    ann_stop.stop()
    eq("stop() clears the running flag", ann_stop.running, False)

    print("\n=== 15. PLAYED-MEMORY IS BOUNDED (no runaway RAM) ===")
    ann_mem = g.Announcer(config, cache_dir)
    for i in range(g.PLAYED_MEMORY + 250):
        ann_mem.remember_played(f"job-{i}")
    eq("memory list is capped", len(ann_mem.played), g.PLAYED_MEMORY)
    check("the newest id is still remembered",
          f"job-{g.PLAYED_MEMORY + 249}" in ann_mem.played)
    check("the oldest id was dropped", "job-0" not in ann_mem.played)

    print("\n=== 16. CONFIG SAFETY ===")
    corrupt = tmp / "corrupt.json"
    corrupt.write_text("{not json at all")
    try:
        g.load_config(corrupt)
        check("corrupt config raises a guided error", False, "no exception")
    except SystemExit as exc:
        check("corrupt config gives an actionable message",
              "pair" in str(exc).lower() or "config" in str(exc).lower(), str(exc))
    except Exception as exc:  # noqa: BLE001
        check("corrupt config raises SystemExit, not a stack trace", False, repr(exc))

    missing = tmp / "missing.json"
    try:
        g.load_config(missing)
        check("missing config raises a guided error", False, "no exception")
    except SystemExit as exc:
        check("missing config tells the owner to pair first",
              "pair" in str(exc).lower(), str(exc))

    print("\n=== 17. CLI SURFACE ===")
    parser = g.build_parser()
    for cmd in ("run", "pair", "test", "status", "selftest"):
        try:
            parsed = parser.parse_args([cmd] if cmd != "pair" else [cmd, "CODE1234"])
            check(f"'{cmd}' is a valid command", parsed is not None)
        except SystemExit:
            check(f"'{cmd}' is a valid command", False, "argparse rejected it")

    rc = subprocess.run(
        [sys.executable, str(AGENT_DIR / "greenway_announcer.py"), "selftest"],
        capture_output=True, text=True, timeout=120,
    )
    eq("selftest subcommand exits 0", rc.returncode, 0)
    check("selftest reports all checks passed", "ALL CHECKS PASSED" in rc.stdout, rc.stdout[-300:])

    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 62)
    print(f"END-TO-END: {PASSED} passed, {FAILED} failed")
    if FAILED == 0:
        print("ALL END-TO-END CHECKS PASSED")
        return 0
    print("END-TO-END FAILURES PRESENT")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
