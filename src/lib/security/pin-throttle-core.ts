/**
 * pin-throttle-core.ts (Task AN-8)
 *
 * PURE state math for the DURABLE PIN brute-force throttle. No imports, no
 * I/O — the server wrapper (pin-throttle-store.ts) loads/saves the
 * `pin_throttle` row (migration 0123) and every PIN entry point calls it.
 *
 * WHY (verified gap): the S-10 throttle (5 fails / 60 s window → 60 s lock)
 * lived in server MEMORY, per lambda instance — it reset on every cold start
 * and was not shared across concurrently-warm instances, so the real lockout
 * an online attacker faced was far weaker than intended. This core computes
 * identical policy over a durable row.
 *
 * SCOPES (one row per physical entry point):
 *   'pos-device:<uuid>'  — a register device's PIN pad
 *   'timeclock'          — the shared staffing clock pad (station + phone)
 * A failed PIN identifies no employee (that is the attack), so keying by
 * employee is impossible; per-entry-point preserves the shared-pad model.
 *
 * POLICY (unchanged from S-10): MAX_FAILURES failures inside WINDOW_MS locks
 * the scope for LOCK_MS; a success clears everything; failures age out.
 *
 * NEVER GUESS: garbage stored state (non-array, non-finite or FUTURE
 * timestamps) is dropped entry-by-entry rather than trusted — a corrupt row
 * can weaken its own window but can never manufacture a lock from nothing or
 * hold one forever.
 */

export const THROTTLE_MAX_FAILURES = 5;
export const THROTTLE_WINDOW_MS = 60_000;
export const THROTTLE_LOCK_MS = 60_000;

export type ThrottleState = {
  /** Epoch-ms timestamps of failures inside the current window. */
  failureTimes: number[];
  /** Epoch-ms until which the scope is locked, or null. */
  lockedUntilMs: number | null;
};

export function emptyThrottleState(): ThrottleState {
  return { failureTimes: [], lockedUntilMs: null };
}

/**
 * Defensive parse of the stored row (`failure_times` jsonb + `locked_until`
 * timestamptz) into a clean state. Entries that are not finite numbers, or
 * sit in the future relative to `nowMs` (clock skew / tampering), are
 * dropped. A malformed locked_until is treated as unlocked.
 */
export function parseThrottleState(
  failureTimesJson: unknown,
  lockedUntilIso: string | null,
  nowMs: number,
): ThrottleState {
  const times: number[] = [];
  if (Array.isArray(failureTimesJson)) {
    for (const t of failureTimesJson) {
      if (typeof t === "number" && Number.isFinite(t) && t <= nowMs) times.push(t);
    }
  }
  let lockedUntilMs: number | null = null;
  if (typeof lockedUntilIso === "string" && lockedUntilIso) {
    const ms = Date.parse(lockedUntilIso);
    // A lock more than LOCK_MS in the future is impossible under our policy —
    // treat it as corrupt rather than honoring an unbounded lock.
    if (Number.isFinite(ms) && ms > nowMs && ms <= nowMs + THROTTLE_LOCK_MS) {
      lockedUntilMs = ms;
    }
  }
  return { failureTimes: times, lockedUntilMs };
}

/** Null when attempts are allowed; otherwise a human message with wait time. */
export function throttleBlockedMessage(state: ThrottleState, nowMs: number): string | null {
  if (state.lockedUntilMs != null && nowMs < state.lockedUntilMs) {
    const secs = Math.ceil((state.lockedUntilMs - nowMs) / 1000);
    return `Too many wrong PINs — the PIN pad is locked for ${secs} more second${secs === 1 ? "" : "s"}.`;
  }
  return null;
}

/**
 * Next state after a failed attempt: prune aged failures, record this one,
 * lock once the window fills (and clear the window, matching S-10).
 */
export function recordThrottleFailure(state: ThrottleState, nowMs: number): ThrottleState {
  const fresh = state.failureTimes.filter((t) => nowMs - t < THROTTLE_WINDOW_MS);
  fresh.push(nowMs);
  if (fresh.length >= THROTTLE_MAX_FAILURES) {
    return { failureTimes: [], lockedUntilMs: nowMs + THROTTLE_LOCK_MS };
  }
  return { failureTimes: fresh, lockedUntilMs: state.lockedUntilMs };
}

/** Scope key for a register device's PIN pad. */
export function deviceThrottleScope(deviceId: string): string {
  return `pos-device:${deviceId}`;
}

/** Scope key for the shared staffing time-clock pad. */
export const TIMECLOCK_THROTTLE_SCOPE = "timeclock";

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runPinThrottleCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  const t0 = 1_000_000_000;

  // Open by default
  eq(throttleBlockedMessage(emptyThrottleState(), t0), null, "starts open");

  // 5 failures inside the window → locked for LOCK_MS
  let s = emptyThrottleState();
  for (let i = 0; i < 5; i++) s = recordThrottleFailure(s, t0 + i * 1000);
  ok(throttleBlockedMessage(s, t0 + 5000) != null, "locks after 5 failures");
  eq(s.lockedUntilMs, t0 + 4000 + THROTTLE_LOCK_MS, "lock expiry = last failure + LOCK_MS");
  eq(s.failureTimes, [], "window cleared on lock (matches S-10)");
  eq(throttleBlockedMessage(s, t0 + 4000 + THROTTLE_LOCK_MS), null, "unlocks after LOCK_MS");

  // Failures age out of the window
  s = emptyThrottleState();
  for (let i = 0; i < 4; i++) s = recordThrottleFailure(s, t0 + i * 1000);
  s = recordThrottleFailure(s, t0 + 70_000); // earlier 4 aged out (>60 s)
  eq(throttleBlockedMessage(s, t0 + 70_001), null, "aged-out failures don't lock");
  eq(s.failureTimes.length, 1, "only the fresh failure remains");

  // Message contains a countdown
  s = { failureTimes: [], lockedUntilMs: t0 + 30_000 };
  const msg = throttleBlockedMessage(s, t0);
  ok(msg != null && msg.includes("30 more seconds"), "countdown in message");
  const msg1 = throttleBlockedMessage({ failureTimes: [], lockedUntilMs: t0 + 1000 }, t0);
  ok(msg1 != null && msg1.includes("1 more second."), "singular second");

  // parseThrottleState — defensive
  eq(
    parseThrottleState([t0 - 1000, t0 - 2000], null, t0).failureTimes,
    [t0 - 1000, t0 - 2000],
    "valid times kept",
  );
  eq(parseThrottleState("garbage", null, t0), emptyThrottleState(), "non-array json → empty");
  eq(
    parseThrottleState([t0 - 1000, "x", null, t0 + 999_999], null, t0).failureTimes,
    [t0 - 1000],
    "non-numbers and FUTURE times dropped",
  );
  eq(parseThrottleState([], "not-a-date", t0).lockedUntilMs, null, "malformed lock ignored");
  const validLock = new Date(t0 + 30_000).toISOString();
  eq(parseThrottleState([], validLock, t0).lockedUntilMs, t0 + 30_000, "valid lock kept");
  const expiredLock = new Date(t0 - 1).toISOString();
  eq(parseThrottleState([], expiredLock, t0).lockedUntilMs, null, "expired lock dropped");
  const absurdLock = new Date(t0 + THROTTLE_LOCK_MS + 60_000).toISOString();
  eq(parseThrottleState([], absurdLock, t0).lockedUntilMs, null, "impossible far-future lock dropped");

  // Scope keys
  eq(deviceThrottleScope("abc-123"), "pos-device:abc-123", "device scope key");
  eq(TIMECLOCK_THROTTLE_SCOPE, "timeclock", "timeclock scope key");

  console.log(`pin-throttle-core: PASSED ${passed} assertions`);
}
