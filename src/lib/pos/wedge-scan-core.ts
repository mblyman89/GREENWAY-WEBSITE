/**
 * src/lib/pos/wedge-scan-core.ts  (Task AM-A)
 *
 * PURE keystroke classifier for GLOBAL keyboard-wedge scanning — the owner's
 * "scan a product without pushing any buttons or clicking inside the search
 * bar". No I/O, no React — safe for the tsx self-test harness and vitest.
 *
 * How wedge scanners behave (verified against the existing B23 scan path,
 * which relies on the same convention): they TYPE the barcode as a burst of
 * printable keystrokes — typically 10–30 ms apart, far faster than human
 * typing (~150–300 ms) — and finish with Enter. The register listens at the
 * document level; when nothing is focused, a fast burst ending in Enter is a
 * SCAN and feeds the same resolveScan() path the search box uses. Slow
 * (human) keystrokes never accumulate, so stray typing can never fire a
 * phantom scan.
 *
 * The classifier is a tiny state machine:
 *   - printable key ≤ WEDGE_INTERKEY_MS after the previous one → append;
 *     slower → the buffer RESTARTS with this key (it's human typing).
 *   - Enter → emit the buffer as a scan IF it has ≥ WEDGE_MIN_LENGTH chars
 *     (every real barcode/lot code is longer than any accidental burst);
 *     always resets.
 *   - modifier/navigation keys (length > 1, e.g. "Shift" during an
 *     uppercase burst) are ignored WITHOUT touching the timer — scanners
 *     emit Shift+char pairs back-to-back and the char must still chain.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Max ms between two keystrokes for them to chain as one scanner burst.
 * Scanners run 10–30 ms/char; the slowest observed wedge configs ~50 ms.
 * Humans very rarely sustain <80 ms between printable keys.
 */
export const WEDGE_INTERKEY_MS = 80;

/** Min buffered chars for Enter to count as a scan (real codes are longer). */
export const WEDGE_MIN_LENGTH = 4;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type WedgeState = {
  /** Chars captured in the current burst. */
  buffer: string;
  /** Timestamp (ms) of the last printable key, or null when idle. */
  lastKeyMs: number | null;
};

export function emptyWedgeState(): WedgeState {
  return { buffer: "", lastKeyMs: null };
}

export type WedgeResult = {
  state: WedgeState;
  /** Non-null when this key COMPLETED a scan (it was a qualifying Enter). */
  scan: string | null;
};

/**
 * Feed one keydown into the classifier. `key` is KeyboardEvent.key; `nowMs`
 * is a monotonic-enough clock (Date.now / performance.now).
 */
export function wedgeKey(state: WedgeState, key: string, nowMs: number): WedgeResult {
  if (key === "Enter") {
    const burst = state.buffer;
    const emit = burst.length >= WEDGE_MIN_LENGTH;
    return { state: emptyWedgeState(), scan: emit ? burst : null };
  }
  // Modifier / navigation keys ("Shift", "Tab", "ArrowLeft", …): ignore
  // entirely — do NOT touch the timer, so Shift+char scanner pairs chain.
  if (key.length !== 1) {
    return { state, scan: null };
  }
  // Printable key: chain onto the burst when fast enough, otherwise this is
  // human typing — restart the buffer at this key.
  const chained = state.lastKeyMs !== null && nowMs - state.lastKeyMs <= WEDGE_INTERKEY_MS;
  return {
    state: { buffer: chained ? state.buffer + key : key, lastKeyMs: nowMs },
    scan: null,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runWedgeScanCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`wedge-scan-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  /** Type a string as a burst with fixed inter-key gap; returns final result. */
  const type = (s: WedgeState, text: string, startMs: number, gapMs: number): { state: WedgeState; t: number } => {
    let state = s;
    let t = startMs;
    for (const ch of text) {
      state = wedgeKey(state, ch, t).state;
      t += gapMs;
    }
    return { state, t };
  };

  // Fast burst + Enter = scan
  const fast = type(emptyWedgeState(), "1A2B3C4D", 1000, 20);
  const r1 = wedgeKey(fast.state, "Enter", fast.t);
  ok(r1.scan === "1A2B3C4D", "fast burst + Enter emits the scan");
  ok(r1.state.buffer === "" && r1.state.lastKeyMs === null, "scan resets the state");

  // Human-speed typing + Enter = NO scan (each slow key restarts the buffer)
  const slow = type(emptyWedgeState(), "hello", 1000, 200);
  const r2 = wedgeKey(slow.state, "Enter", slow.t);
  ok(r2.scan === null, "slow typing never emits a scan");
  ok(slow.state.buffer === "o", "slow keys restart the buffer each time");

  // Short fast burst + Enter = NO scan (below min length)
  const short = type(emptyWedgeState(), "ab1", 1000, 20);
  ok(wedgeKey(short.state, "Enter", short.t).scan === null, "short burst refused (min length)");
  ok(WEDGE_MIN_LENGTH === 4, "min length is 4");

  // Exactly min length passes
  const four = type(emptyWedgeState(), "ab12", 1000, 20);
  ok(wedgeKey(four.state, "Enter", four.t).scan === "ab12", "exactly min-length burst emits");

  // Enter with empty buffer = nothing
  ok(wedgeKey(emptyWedgeState(), "Enter", 500).scan === null, "bare Enter emits nothing");

  // Boundary: gap EXACTLY at the threshold still chains; one ms over restarts
  let s = wedgeKey(emptyWedgeState(), "a", 1000).state;
  s = wedgeKey(s, "b", 1000 + WEDGE_INTERKEY_MS).state;
  ok(s.buffer === "ab", "gap exactly at threshold chains");
  let s2 = wedgeKey(emptyWedgeState(), "a", 1000).state;
  s2 = wedgeKey(s2, "b", 1000 + WEDGE_INTERKEY_MS + 1).state;
  ok(s2.buffer === "b", "gap over threshold restarts the buffer");

  // Shift (or any non-printable) mid-burst is ignored without breaking the chain
  let s3 = wedgeKey(emptyWedgeState(), "a", 1000).state;
  s3 = wedgeKey(s3, "Shift", 1010).state;
  s3 = wedgeKey(s3, "B", 1020).state;
  s3 = wedgeKey(s3, "c", 1040).state;
  s3 = wedgeKey(s3, "9", 1060).state;
  ok(s3.buffer === "aBc9", "Shift mid-burst ignored; chain survives");
  ok(wedgeKey(s3, "Enter", 1080).scan === "aBc9", "mixed-case burst scans");

  // A human pause mid-"burst" severs it — only the tail remains
  let s4 = type(emptyWedgeState(), "12345", 1000, 20).state;
  s4 = wedgeKey(s4, "6", 5000).state; // long pause
  ok(s4.buffer === "6", "pause severs the burst; tail restarts");

  // Two scans back to back — state fully isolates them
  const first = type(emptyWedgeState(), "CODE-ONE", 1000, 15);
  const e1 = wedgeKey(first.state, "Enter", first.t);
  const second = type(e1.state, "CODE-TWO", 9000, 15);
  const e2 = wedgeKey(second.state, "Enter", second.t);
  ok(e1.scan === "CODE-ONE" && e2.scan === "CODE-TWO", "back-to-back scans isolate cleanly");

  console.log(`wedge-scan-core self-tests: ALL PASS (${pass} assertions)`);
}
