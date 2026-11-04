/**
 * pos/offline-unlock — the iPad side of offline PIN unlock (D161).
 *
 * Owner, 2026-11-04: "please now build for me something that allows my
 * employees to unlock the ipad registers in offline mode. we cant ring a sale
 * if we cant get past the pin unlock page."
 *
 * HOW IT WORKS (all decisions live in the pure offline-unlock-core)
 * ----------------------------------------------------------------
 * 1. ARM. When someone's PIN is confirmed ONLINE (unlock, manager approval, or
 *    lock-screen clock), the server's answer carries an "arm block": this
 *    iPad's offline key + the person's PIN stamp. At that moment — and only
 *    then — the iPad turns the PIN it just typed into a verifier:
 *
 *        D        = PBKDF2-SHA256(PIN, deviceSalt, 600 000 rounds, 256 bits)
 *        verifier = HMAC-SHA256(offlineKey, D || "|" || employeeId)
 *
 *    The PIN itself is never stored, logged or sent anywhere new.
 *
 * 2. VERIFY OFFLINE. When the server cannot be reached (no network, timeout,
 *    or a 5xx — never a 4xx "no"), the typed PIN is run through the same two
 *    steps and compared in constant time against every armed record.
 *
 * 3. KEEP HONEST. Every ~10 minutes online the iPad fetches the roster (who
 *    is still active, their current PIN stamps, the owner's policy, today's
 *    drawer). Anyone fired, whose PIN changed, or whose handbook gate closed
 *    is purged. An owner "reset" changes the key and erases every verifier.
 *
 * 4. AUDIT. Every offline unlock / approval / clock queues an `offline_auth`
 *    event that the server re-judges against the database when it syncs.
 *
 * The vault lives in pos-secure-store (iPad keychain, this-device-only).
 * Every mutation goes through one promise chain so an arm and a roster refresh
 * that land together can never overwrite each other.
 */
import {
  applyArm,
  applyRoster,
  matchVerifiers,
  newVault,
  noteClockState,
  noteDrawer,
  offlineUnlockGate,
  OFFLINE_PBKDF2_ITERATIONS,
  OFFLINE_SALT_BYTES,
  parseArmBlock,
  parseRoster,
  parseVault,
  serializeVault,
  throttleAfterFailure,
  throttleAfterSuccess,
  failuresBeforeWipe,
  wipeRecords,
  type CachedDrawer,
  type OfflineRecord,
  type OfflineVault,
} from "./offline-unlock-core";
import { clearOfflineVault, loadOfflineVaultRaw, saveOfflineVaultRaw } from "./pos-secure-store";
import { posFetch } from "./pos-fetch";

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto | null {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  return c && c.subtle ? c.subtle : null;
}

/** True when this device can do the offline check at all (WebCrypto present). */
export function offlineUnlockSupported(): boolean {
  return subtle() !== null && typeof globalThis.crypto?.getRandomValues === "function";
}

function randomSalt(): string | null {
  if (!offlineUnlockSupported()) return null;
  const b = new Uint8Array(OFFLINE_SALT_BYTES);
  globalThis.crypto.getRandomValues(b);
  return toB64url(b);
}

// ---------------------------------------------------------------------------
// The two crypto steps
// ---------------------------------------------------------------------------

/** D = PBKDF2-SHA256(PIN, salt, iterations) → 32 bytes. Deliberately slow. */
async function stretchPin(pin: string, saltB64: string, iterations: number): Promise<Uint8Array> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto unavailable");
  const base = await s.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await s.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(saltB64) as BufferSource, iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** verifier = HMAC-SHA256(key, D || "|" || employeeId), base64url. */
async function verifierFor(keyB64: string, stretched: Uint8Array, employeeId: string): Promise<string> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto unavailable");
  const k = await s.importKey("raw", fromB64url(keyB64) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const tail = new TextEncoder().encode(`|${employeeId.toLowerCase()}`);
  const msg = new Uint8Array(stretched.length + tail.length);
  msg.set(stretched, 0);
  msg.set(tail, stretched.length);
  const sig = await s.sign("HMAC", k, msg);
  return toB64url(new Uint8Array(sig));
}

// ---------------------------------------------------------------------------
// Vault access (serialized)
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

/** Run one vault mutation at a time. A failure never breaks the chain. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** The current vault (synchronous; from the secure-store mirror). */
export function loadOfflineVault(): OfflineVault | null {
  return parseVault(loadOfflineVaultRaw());
}

function store(v: OfflineVault): void {
  saveOfflineVaultRaw(serializeVault(v));
}

/** Erase everything (device unpaired / revoked, or a manager reset on the iPad). */
export function eraseOfflineVault(): Promise<void> {
  return serialized(async () => {
    clearOfflineVault();
  });
}

// ---------------------------------------------------------------------------
// 1. Arm after an online PIN proof
// ---------------------------------------------------------------------------

/**
 * Store a verifier for the employee the server just confirmed. `rawArm` is the
 * `offline` field of the unlock/approve/clock answer (null on older servers or
 * when the server has no secret — then nothing happens). Never throws.
 */
export function armOfflineFromOnline(pin: string, rawArm: unknown, clockedIn: boolean | null): Promise<boolean> {
  return serialized(async () => {
    try {
      const arm = parseArmBlock(rawArm);
      if (!arm || !offlineUnlockSupported() || !/^\d{4,6}$/.test(pin)) return false;
      let v = loadOfflineVault();
      if (!v) {
        const salt = randomSalt();
        if (!salt) return false;
        v = newVault({ keyId: arm.keyId, key: arm.key, salt, policy: arm.policy, serverNowMs: arm.serverNowMs });
      }
      if (!arm.policy.enabled) {
        store(applyArm(v, arm, { verifier: "", armedAt: new Date().toISOString(), clockedIn }));
        return false;
      }
      const d = await stretchPin(pin, v.salt, v.iterations);
      const verifier = await verifierFor(arm.key, d, arm.employee.id);
      store(applyArm(v, arm, { verifier, armedAt: new Date().toISOString(), clockedIn }));
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Verify offline
// ---------------------------------------------------------------------------

export type OfflineVerifyResult =
  | { ok: true; record: OfflineRecord; vault: OfflineVault }
  | { ok: false; message: string; wiped?: boolean; counted: boolean };

/**
 * Check a PIN with no server. `requireApprover` = only a manager/lead record
 * may match (offline no-sale / price-override approval).
 *
 * Every miss counts toward the SAME throttle as unlock; 25 misses in a row
 * erase every verifier on this iPad (each person then unlocks online once).
 */
export function verifyOfflinePin(pin: string, opts: { requireApprover?: boolean; nowMs?: number } = {}): Promise<OfflineVerifyResult> {
  return serialized(async (): Promise<OfflineVerifyResult> => {
    const nowMs = opts.nowMs ?? Date.now();
    const v = loadOfflineVault();
    const gate = offlineUnlockGate(v, nowMs);
    if (!gate.ok || !v) return { ok: false, message: gate.ok ? "Offline unlock is not set up." : gate.message, counted: false };
    if (!offlineUnlockSupported()) return { ok: false, message: "This device cannot check PINs offline.", counted: false };
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, message: "Enter your 4–6 digit PIN.", counted: false };
    let computed: Map<string, string>;
    try {
      const d = await stretchPin(pin, v.salt, v.iterations);
      computed = new Map<string, string>();
      for (const r of v.records) computed.set(r.employeeId, await verifierFor(v.key, d, r.employeeId));
    } catch {
      return { ok: false, message: "The offline PIN check failed on this device. Try again.", counted: false };
    }
    // Compare against EVERY record (constant work), THEN apply the role rule,
    // so a sales PIN typed at an approval prompt is refused, not "guessed".
    const match = matchVerifiers(v.records, computed, v.policy, nowMs);
    if (match.kind === "match" && opts.requireApprover && !match.record.canApprove) {
      // Correct PIN, wrong role: not a guess, so it does not count.
      return { ok: false, message: "That PIN belongs to someone who cannot approve. A manager or lead must enter their PIN.", counted: false };
    }
    if (match.kind === "match") {
      const next = { ...v, throttle: throttleAfterSuccess(v.throttle), offlineUnlocks: v.offlineUnlocks + 1 };
      store(next);
      return { ok: true, record: match.record, vault: next };
    }
    if (match.kind === "ambiguous") {
      return { ok: false, message: "That PIN matches more than one person on this iPad. Unlock online, or use a different person's PIN.", counted: false };
    }
    if (match.kind === "expired") {
      return {
        ok: false,
        message: `${match.record.fullName}: your offline PIN expired (unlock online at least every ${v.policy.armTtlDays} days). Another armed employee can unlock.`,
        counted: false,
      };
    }
    const t = throttleAfterFailure(v.throttle, nowMs);
    if (t.wipe) {
      store({ ...wipeRecords(v), throttle: t.throttle });
      return {
        ok: false,
        wiped: true,
        counted: true,
        message: "Too many wrong PINs. Offline PINs on this iPad were erased for safety. Unlocking now needs the internet; each person then unlocks once online.",
      };
    }
    store({ ...v, throttle: t.throttle });
    const left = failuresBeforeWipe(t.throttle);
    const paused = t.throttle.lockedUntilMs > nowMs;
    return {
      ok: false,
      counted: true,
      message: paused
        ? `Wrong PIN. Offline unlock is paused for ${Math.ceil((t.throttle.lockedUntilMs - nowMs) / 1000)} seconds.`
        : left <= 10
          ? `Wrong PIN (offline check). ${left} more wrong tries erase offline PINs on this iPad.`
          : "Wrong PIN (offline check), or that person has not unlocked this iPad online yet.",
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Roster refresh + small state notes
// ---------------------------------------------------------------------------

export type RosterRefreshResult =
  | { kind: "ok"; removed: number; reason: string | null }
  | { kind: "refused"; status: number; error: string | null }
  | { kind: "unreachable" };

/**
 * Fetch the roster and merge it. ONLY a parsed 200 changes anything: a network
 * error, 5xx or malformed answer leaves the vault exactly as it was (never
 * purge on a hiccup). A 4xx is reported so the caller can react to a revoked
 * pairing (it erases the vault — a revoked iPad must not unlock offline).
 */
export async function refreshOfflineRoster(creds: { deviceId: string; deviceKey: string }): Promise<RosterRefreshResult> {
  let res: Response;
  try {
    res = await posFetch("/api/pos/offline-roster", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
      body: "{}",
    });
  } catch {
    return { kind: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      const err = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
      return { kind: "refused", status: res.status, error: err };
    }
    return { kind: "unreachable" };
  }
  // Only a fully parsed 200 may merge (and therefore purge). A 5xx, a proxy
  // error page, or a truncated body is treated as "unreachable".
  // We never purge on a hiccup: a flaky network must not erase the vault meant for it.
  const roster = parseRoster(body);
  if (!roster) return { kind: "unreachable" };
  return serialized(async (): Promise<RosterRefreshResult> => {
    let v = loadOfflineVault();
    if (!v) {
      const salt = randomSalt();
      if (!salt) return { kind: "unreachable" };
      v = newVault({ keyId: roster.keyId, key: roster.key, salt, policy: roster.policy, serverNowMs: roster.serverNowMs });
    }
    const merged = applyRoster(v, roster, new Date().toISOString());
    store(merged.vault);
    return { kind: "ok", removed: merged.removed.length, reason: merged.reason };
  });
}

/** Remember a clock state this iPad learned (online answer or its own queued punch). */
export function noteOfflineClock(employeeId: string, clockedIn: boolean): Promise<void> {
  return serialized(async () => {
    const v = loadOfflineVault();
    if (!v) return;
    const next = noteClockState(v, employeeId, clockedIn);
    if (next !== v) store(next);
  });
}

/** Remember the register's open drawer (so an offline unlock can keep ringing). */
export function noteOfflineDrawer(drawer: CachedDrawer | null): Promise<void> {
  return serialized(async () => {
    const v = loadOfflineVault();
    if (!v) return;
    const next = noteDrawer(v, drawer);
    if (next !== v) store(next);
  });
}

/** TEST-ONLY: the two crypto steps, so a vitest can prove arm ⇄ verify agree. */
export const __offlineCryptoForTests = { stretchPin, verifierFor, toB64url, fromB64url };

export { OFFLINE_PBKDF2_ITERATIONS };
