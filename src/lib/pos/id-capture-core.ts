/**
 * src/lib/pos/id-capture-core.ts  (Slice AP)
 *
 * PURE keystroke accumulator for the ID gate's HIDDEN scanner capture — the
 * owner's "hide the box and make the read instantaneous". No React, no I/O.
 *
 * Why the old visible textarea failed on a real WA license (verified against
 * the AAMVA DL/ID standard + the old IdGateScreen code): an AAMVA PDF417
 * payload BEGINS "@" + LF ("@\n\x1e\rANSI 636045…") and every data element
 * after it is LF-separated. A keyboard-wedge scanner types each LF/CR as an
 * ENTER keystroke. The old textarea submitted on the FIRST Enter — i.e. right
 * after the single "@" character — so the parser saw "@" alone, failed with
 * "missing @/ANSI header", cleared the buffer, and the rest of the barcode
 * kept printing into the box (the 5-second character-by-character crawl was
 * React re-rendering on every one of the ~600 keystrokes).
 *
 * This core fixes the model: Enter is DATA (a newline inside the payload),
 * not a submit. Completion is detected by IDLE — scanners stream chars
 * 10–50 ms apart, so ≥ 300 ms of silence means the barcode is done. The
 * caller buffers via a ref (zero re-renders → instant) and finalizes on an
 * idle timer.
 *
 *   - printable key (length 1)      → append, consumed
 *   - Enter / Tab (wedge LF/CR/GS)  → append "\n" (only mid-burst), consumed
 *   - modifiers ("Shift", …)        → ignored, untouched
 *   - finalizeIdCapture(state)      → payload when the buffer is plausibly a
 *                                     scan (≥ MIN length), else null; always
 *                                     resets. Sub-min garbage (stray human
 *                                     typing) resets SILENTLY.
 */

import { isCompleteAamvaPayload } from "./id-scan-core";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Idle ms after the last keystroke before the capture finalizes. Wedge
 * scanners stream at 10–50 ms/char; 300 ms of silence safely means "done"
 * while adding only a third of a second before the verdict — versus the old
 * flow's multi-second visible print.
 */
export const ID_CAPTURE_IDLE_MS = 300;

/**
 * STALL-PROOF fallback idle (IDS-1). Content-driven completion
 * (isCompleteAamvaPayload) is the PRIMARY finalize path and fires the instant
 * the buffer is a gate-ready license — perceived-instant. This longer idle is
 * ONLY the safety net for payloads that never satisfy the content check (a
 * truncated read, an unusual jurisdiction encoding, or stray typing). Socket
 * Mobile documents that Basic/HID mode is "much slower ... for barcode
 * symbologies encoding a lot of data, such as many 2D barcodes"; a driver's
 * license PDF417 is ~300–1100 bytes streamed one keystroke at a time over
 * Bluetooth, and the burst can STALL well past 300 ms mid-stream. The old
 * fixed 300 ms window fired during those stalls and finalized a truncated
 * buffer (the "5–7 seconds then fails" bug). 1200 ms comfortably clears any
 * realistic wedge stall so the fallback only ever fires when the stream has
 * genuinely ended.
 */
export const ID_CAPTURE_FALLBACK_IDLE_MS = 1200;

/**
 * Minimum buffered chars for finalize to emit a payload. A real AAMVA PDF417
 * payload is 200+ chars; requiring 20 lets stray human typing in the dead
 * space reset silently instead of flashing a parse error.
 */
export const ID_CAPTURE_MIN_LENGTH = 20;

/**
 * POST-FINALIZE DRAIN window (Slice IDS-5). Content-driven completion (IDS-1)
 * finalizes the INSTANT the buffer is gate-ready (ANSI header + DBB + DBA) —
 * but the scanner is still streaming the REST of the PDF417 (weight DAW,
 * eye/hair color, address, etc.) one keystroke at a time. Once the ID gate
 * hands off to the sales screen, those trailing keystrokes (e.g. "DAW160") land
 * in the product-search box — the "can't find DAW160" error + stray search the
 * owner reported. After ANY finalize we therefore keep swallowing keystrokes
 * for a quiet-period: every trailing key re-arms the window, so it ends only
 * once the scanner burst genuinely stops. 700 ms comfortably covers the gap
 * between the gate-ready fields and the tail of the payload without noticeably
 * delaying legitimate typing on the next screen.
 */
export const ID_SCAN_DRAIN_MS = 700;

/**
 * True while we are still inside the post-finalize drain window and should
 * swallow the trailing burst keystrokes. `lastFinalizeMs` is the timestamp of
 * the last scan finalize (null = no scan finalized yet). Pure.
 */
export function shouldDrainKey(lastFinalizeMs: number | null, nowMs: number): boolean {
  if (lastFinalizeMs === null) return false;
  return nowMs - lastFinalizeMs < ID_SCAN_DRAIN_MS;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type IdCaptureState = {
  /** Characters captured so far (Enter/Tab stored as "\n"). */
  buffer: string;
  /** Timestamp (ms) of the last consumed key, or null when idle. */
  lastKeyMs: number | null;
};

export function emptyIdCaptureState(): IdCaptureState {
  return { buffer: "", lastKeyMs: null };
}

export type IdCaptureKeyResult = {
  state: IdCaptureState;
  /**
   * True when the key was captured into the buffer — the caller should
   * preventDefault so iOS/Safari never acts on the keystroke.
   */
  consumed: boolean;
};

/**
 * Feed one keydown into the capture. `key` is KeyboardEvent.key; `nowMs` is
 * Date.now()/performance.now(). Enter and Tab are how wedge scanners transmit
 * the payload's LF/CR/GS control characters — they become "\n" so the AAMVA
 * parser sees the element separators it expects. A LEADING Enter (empty
 * buffer) is not consumed: it can't be scan data, and swallowing it would
 * break Enter-activating a focused button.
 */
export function idCaptureKey(state: IdCaptureState, key: string, nowMs: number): IdCaptureKeyResult {
  if (key === "Enter" || key === "Tab") {
    if (state.buffer.length === 0) return { state, consumed: false };
    return { state: { buffer: state.buffer + "\n", lastKeyMs: nowMs }, consumed: true };
  }
  if (key.length !== 1) {
    // Modifier / navigation keys ("Shift" during uppercase bursts, etc.):
    // ignore without touching the timer.
    return { state, consumed: false };
  }
  return { state: { buffer: state.buffer + key, lastKeyMs: nowMs }, consumed: true };
}

/**
 * Feed a key AND report whether the buffer is now a COMPLETE AAMVA payload
 * (IDS-1 content-driven completion). This is the primary finalize trigger: the
 * caller finalizes immediately when `complete` is true — perceived-instant,
 * no timer wait — and otherwise (re)arms the longer stall-proof idle timer.
 * `complete` is only ever true once the buffer parses to a gate-ready license
 * (ANSI header + normalized DBB + DBA), so a partial mid-stream buffer can
 * never trip it. Delegates keystroke handling to idCaptureKey (unchanged).
 */
export type IdCaptureFeedResult = {
  state: IdCaptureState;
  /** The key was captured into the buffer (caller should preventDefault). */
  consumed: boolean;
  /** The buffer is now a complete, gate-ready AAMVA payload — finalize now. */
  complete: boolean;
};

export function feedIdCaptureKey(state: IdCaptureState, key: string, nowMs: number): IdCaptureFeedResult {
  const r = idCaptureKey(state, key, nowMs);
  const complete =
    r.consumed &&
    r.state.buffer.length >= ID_CAPTURE_MIN_LENGTH &&
    isCompleteAamvaPayload(r.state.buffer);
  return { state: r.state, consumed: r.consumed, complete };
}

export type IdCaptureFinalizeResult = {
  state: IdCaptureState;
  /** The full payload when the buffer plausibly holds a scan, else null. */
  payload: string | null;
};

/**
 * Finalize the capture (the caller's idle timer fired ID_CAPTURE_IDLE_MS
 * after the last consumed key). Emits the payload only when the buffer is at
 * least ID_CAPTURE_MIN_LENGTH chars — shorter buffers are stray keystrokes
 * and reset silently. Always returns a fresh state.
 */
export function finalizeIdCapture(state: IdCaptureState): IdCaptureFinalizeResult {
  const payload = state.buffer.length >= ID_CAPTURE_MIN_LENGTH ? state.buffer : null;
  return { state: emptyIdCaptureState(), payload };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runIdCaptureCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  /** Type a string; "\n" is sent as the Enter key (wedge behavior). */
  const type = (s: IdCaptureState, text: string, startMs: number, gapMs: number): { state: IdCaptureState; t: number } => {
    let state = s;
    let t = startMs;
    for (const ch of text) {
      state = idCaptureKey(state, ch === "\n" ? "Enter" : ch, t).state;
      t += gapMs;
    }
    return { state, t };
  };

  // The killer case from the store floor: an AAMVA-shaped payload whose FIRST
  // character is "@" followed by Enter — the old textarea submitted right
  // there. This capture keeps going and hands back the WHOLE payload.
  const aamva =
    "@\n\nANSI 636045080002DL00410278DLDAQWDL123ABC456\nDCSPUBLIC\nDACJOHN\nDBB07131990\nDBA07132028\nDAJWA\nDCGUSA\n";
  {
    const r = type(emptyIdCaptureState(), aamva, 1000, 20);
    const fin = finalizeIdCapture(r.state);
    ok(fin.payload === aamva, "full AAMVA payload captured intact — early Enters are data, not submits");
    ok(fin.state.buffer === "" && fin.state.lastKeyMs === null, "finalize resets the state");
  }

  // Leading Enter with an empty buffer is NOT consumed (button activation survives).
  {
    const r = idCaptureKey(emptyIdCaptureState(), "Enter", 1000);
    ok(!r.consumed && r.state.buffer === "", "leading Enter passes through");
  }

  // Mid-burst Enter IS consumed and becomes "\n".
  {
    let s = idCaptureKey(emptyIdCaptureState(), "@", 1000).state;
    const r = idCaptureKey(s, "Enter", 1020);
    ok(r.consumed && r.state.buffer === "@\n", "mid-burst Enter consumed as newline");
    s = idCaptureKey(r.state, "Tab", 1040).state;
    ok(s.buffer === "@\n\n", "Tab treated like Enter (wedge GS/CR configs)");
  }

  // Printable keys are consumed; modifiers are ignored without breaking the chain.
  {
    let s = idCaptureKey(emptyIdCaptureState(), "a", 1000).state;
    const shift = idCaptureKey(s, "Shift", 1010);
    ok(!shift.consumed && shift.state.buffer === "a", "Shift ignored");
    s = idCaptureKey(shift.state, "B", 1020).state;
    ok(s.buffer === "aB", "chain survives modifiers");
  }

  // Sub-min-length garbage (stray human typing) finalizes to null — silent reset.
  {
    const r = type(emptyIdCaptureState(), "hello", 1000, 200);
    const fin = finalizeIdCapture(r.state);
    ok(fin.payload === null, "short buffer resets silently (no error flash)");
    ok(fin.state.buffer === "", "silent reset clears state");
  }

  // Exactly MIN length emits.
  {
    const twenty = "x".repeat(ID_CAPTURE_MIN_LENGTH);
    const r = type(emptyIdCaptureState(), twenty, 1000, 20);
    ok(finalizeIdCapture(r.state).payload === twenty, "exactly-min-length payload emits");
    const nineteen = "x".repeat(ID_CAPTURE_MIN_LENGTH - 1);
    const r2 = type(emptyIdCaptureState(), nineteen, 1000, 20);
    ok(finalizeIdCapture(r2.state).payload === null, "one short of min refuses");
  }

  // Two captures back to back isolate cleanly.
  {
    const first = type(emptyIdCaptureState(), "@\nANSI 636045FIRSTPAYLOAD\n", 1000, 20);
    const f1 = finalizeIdCapture(first.state);
    const second = type(f1.state, "@\nANSI 636045SECONDPAYLOAD\n", 9000, 20);
    const f2 = finalizeIdCapture(second.state);
    ok(
      f1.payload !== null && f2.payload !== null && f1.payload !== f2.payload,
      "back-to-back captures isolate",
    );
  }

  // Constants sanity — the idle window must exceed the slowest observed
  // wedge inter-key gap (~50 ms) by a wide margin.
  ok(ID_CAPTURE_IDLE_MS >= 200 && ID_CAPTURE_IDLE_MS <= 1000, "idle window sane (near-instant, scanner-safe)");
  ok(ID_CAPTURE_MIN_LENGTH === 20, "min length is 20");

  // IDS-1 — content-driven completion via feedIdCaptureKey. The capture
  // reports complete=true the instant the buffer is a gate-ready license, so
  // the caller finalizes without waiting on any timer, and a truncated
  // mid-stream buffer NEVER reports complete (the old-floor failure).
  {
    const full =
      "@\n\x1e\rANSI 636045080002DL00410278DLDAQWDL123ABC456\n" +
      "DCSPUBLIC\nDACJOHN\nDBB07131990\nDBA07132028\nDAJWA\nDCGUSA\n";
    // Stream char-by-char; complete must flip true exactly once, at/after DBA,
    // and the state buffer at that point must itself be a finalizable payload.
    let st = emptyIdCaptureState();
    let firstCompleteAt = -1;
    let t = 1000;
    for (let i = 0; i < full.length; i++) {
      const ch = full[i] === "\n" ? "Enter" : full[i];
      const r = feedIdCaptureKey(st, ch, t);
      st = r.state;
      t += 20;
      if (r.complete && firstCompleteAt === -1) firstCompleteAt = i;
    }
    ok(firstCompleteAt !== -1, "feed reports complete once the whole payload has streamed");
    // It should not have reported complete before DBA's value finished.
    const dbaEnd = full.indexOf("DBA") + "DBA07132028".length;
    ok(firstCompleteAt >= dbaEnd - 1, "complete only fires at/after DBA is fully present (no truncation)");
    // The final buffer finalizes to the full payload.
    ok(finalizeIdCapture(st).payload === full, "streamed buffer finalizes to the full payload");
  }
  // A partial stream that stalls before DBA must NOT report complete — the
  // longer fallback idle (not a 300 ms guess) is what eventually fires.
  {
    const partial = "@\n\x1e\rANSI 636045080002DL00410278DLDAQWDL123ABC456\nDCSPUBLIC\nDACJOHN\nDBB07131990\n";
    let st = emptyIdCaptureState();
    let sawComplete = false;
    let t = 1000;
    for (const chRaw of partial) {
      const ch = chRaw === "\n" ? "Enter" : chRaw;
      const r = feedIdCaptureKey(st, ch, t);
      st = r.state;
      t += 20;
      if (r.complete) sawComplete = true;
    }
    ok(!sawComplete, "stream missing DBA never reports content-complete");
  }
  ok(ID_CAPTURE_FALLBACK_IDLE_MS >= 1000 && ID_CAPTURE_FALLBACK_IDLE_MS > ID_CAPTURE_IDLE_MS, "fallback idle is long + exceeds the primary idle");

  // IDS-5: post-finalize drain window swallows the scanner's trailing burst
  // (e.g. "DAW160") so it never leaks into the sales-screen search box.
  ok(!shouldDrainKey(null, 1000), "no drain before any scan finalized");
  ok(shouldDrainKey(1000, 1000), "drain active at the instant of finalize");
  ok(shouldDrainKey(1000, 1000 + ID_SCAN_DRAIN_MS - 1), "drain active just inside window");
  ok(!shouldDrainKey(1000, 1000 + ID_SCAN_DRAIN_MS), "drain ends at window edge");
  ok(!shouldDrainKey(1000, 1000 + ID_SCAN_DRAIN_MS + 500), "drain inactive well past window");
  ok(ID_SCAN_DRAIN_MS >= 500, "drain window is long enough to cover the payload tail");

  console.log(`pos/id-capture-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/id-capture-core tests failed`);
}
