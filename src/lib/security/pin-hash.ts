/**
 * src/lib/security/pin-hash.ts  (S-10)
 *
 * Salted scrypt hashing for employee time-clock PINs. PURE except for
 * node:crypto — unit-testable with tsx.
 *
 * Why scrypt-with-salt instead of a deterministic HMAC: 4–6 digit PINs have at
 * most 10^6 possibilities, so any UNsalted/deterministic scheme is trivially
 * reversible offline. A per-PIN random salt + memory-hard scrypt forces an
 * attacker with a stolen table dump to grind each employee separately. The
 * roster is small, so "fetch active employees and verify each" is a perfectly
 * fast lookup strategy (and is what the staffing store does).
 *
 * Format: `scrypt$<salt b64url>$<hash b64url>` — self-identifying so legacy
 * plaintext `clock_pin` values can coexist during the hash-on-use migration.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt$";
const SALT_BYTES = 16;
const KEY_LEN = 32;
// Interactive-login cost (N=2^14): ~25ms — fine for a clock-in tap.
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

/** Hash a PIN for storage. */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTS);
  return PREFIX + salt.toString("base64url") + "$" + hash.toString("base64url");
}

/** True when a stored value is one of our PIN hashes. */
export function isPinHash(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Constant-time verify of a PIN against a stored hash. */
export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!pin || !stored || !stored.startsWith(PREFIX)) return false;
  const parts = stored.slice(PREFIX.length).split("$");
  if (parts.length !== 2) return false;
  try {
    const salt = Buffer.from(parts[0], "base64url");
    const expected = Buffer.from(parts[1], "base64url");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_LEN) return false;
    const actual = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Attempt throttle (S-10). In-memory, per server process: the PIN pad is a
// single shared station, so a global failure window is the right model. After
// MAX_FAILURES failed attempts within WINDOW_MS the pad locks for LOCK_MS.
// (A horizontally-scaled deployment would need a shared store; the back
// office runs as a single instance, and even per-instance throttling defeats
// online brute force of a 4–6 digit space.)
// ---------------------------------------------------------------------------
const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;
const LOCK_MS = 60_000;

type ThrottleState = { failures: number[]; lockedUntil: number };
const state: ThrottleState = { failures: [], lockedUntil: 0 };

/** Null when attempts are allowed; otherwise a human message with wait time. */
export function pinThrottleBlocked(now = Date.now()): string | null {
  if (now < state.lockedUntil) {
    const secs = Math.ceil((state.lockedUntil - now) / 1000);
    return `Too many wrong PINs — the PIN pad is locked for ${secs} more second${secs === 1 ? "" : "s"}.`;
  }
  return null;
}

/** Record a failed attempt; locks the pad once the window fills. */
export function recordPinFailure(now = Date.now()): void {
  state.failures = state.failures.filter((t) => now - t < WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES) {
    state.lockedUntil = now + LOCK_MS;
    state.failures = [];
  }
}

/** Clear the failure window (called on a successful clock in/out). */
export function recordPinSuccess(): void {
  state.failures = [];
  state.lockedUntil = 0;
}

/** TEST ONLY: reset throttle state between test cases. */
export function __resetPinThrottleForTests(): void {
  state.failures = [];
  state.lockedUntil = 0;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runPinHashTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  const h = hashPin("1234");
  expect("hash has scrypt prefix", h.startsWith("scrypt$"));
  expect("hash verifies", verifyPin("1234", h));
  expect("wrong pin rejected", !verifyPin("4321", h));
  expect("salted: same pin, different hash", hashPin("1234") !== h);
  expect("both salted hashes verify", verifyPin("1234", hashPin("1234")));
  expect("isPinHash true", isPinHash(h));
  expect("isPinHash false for plaintext", !isPinHash("1234"));
  expect("verify vs plaintext stored is false", !verifyPin("1234", "1234"));
  expect("verify empty stored", !verifyPin("1234", ""));
  expect("verify null stored", !verifyPin("1234", null));
  expect("verify corrupt hash", !verifyPin("1234", "scrypt$AA$BB"));
  expect("six-digit round trip", verifyPin("987654", hashPin("987654")));

  // Throttle
  __resetPinThrottleForTests();
  const t0 = 1_000_000;
  expect("throttle starts open", pinThrottleBlocked(t0) === null);
  for (let i = 0; i < 5; i++) recordPinFailure(t0 + i * 1000);
  expect("throttle locks after 5 failures", pinThrottleBlocked(t0 + 5000) !== null);
  expect("throttle unlocks after lock window", pinThrottleBlocked(t0 + 5000 + 61_000) === null);
  __resetPinThrottleForTests();
  for (let i = 0; i < 4; i++) recordPinFailure(t0 + i * 1000);
  recordPinSuccess();
  recordPinFailure(t0 + 10_000);
  expect("success resets the failure window", pinThrottleBlocked(t0 + 11_000) === null);
  // Old failures age out of the rolling window.
  __resetPinThrottleForTests();
  for (let i = 0; i < 4; i++) recordPinFailure(t0 + i * 1000);
  recordPinFailure(t0 + 70_000); // earlier 4 have aged out (>60s)
  expect("failures age out of window", pinThrottleBlocked(t0 + 70_001) === null);
  __resetPinThrottleForTests();

  if (failures > 0) throw new Error(`pin-hash self-tests: ${failures} failure(s)`);
  console.log("pin-hash self-tests: all passed");
}
