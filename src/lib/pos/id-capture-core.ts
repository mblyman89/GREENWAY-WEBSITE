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
 * Minimum buffered chars for finalize to emit a payload. A real AAMVA PDF417
 * payload is 200+ chars; requiring 20 lets stray human typing in the dead
 * space reset silently instead of flashing a parse error.
 */
export const ID_CAPTURE_MIN_LENGTH = 20;

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

  console.log(`pos/id-capture-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/id-capture-core tests failed`);
}
