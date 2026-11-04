/**
 * src/lib/pos/offline-unlock-core.ts  (D161–D167)
 *
 * Owner, 2026-11-04 (verbatim): "please now build for me something that
 * allows my employees to unlock the ipad registers in offline mode. we cant
 * ring a sale if we cant get past the pin unlock page. if there are other
 * features that we need or should have so that we have an exceptional system
 * that works no matter the situation. use every enterprise grade solution to
 * make this the most robust, hardened feature possible."
 *
 * PURE. No I/O, no crypto, no clock. Every decision the offline unlock makes
 * lives here so it can be proven by self-tests and vitest; the client module
 * (`offline-unlock.ts`) only does WebCrypto and storage around these rules.
 *
 * HOW IT WORKS (the short version)
 * --------------------------------
 *   1. ARM. When an employee unlocks an iPad ONLINE, the server has just
 *      proven their PIN (scrypt, throttled, handbook-gated). Its answer
 *      carries an "arm block": this iPad's offline key (derived on the server
 *      from a server secret + the device id + the owner's revocation epoch),
 *      the employee's PIN stamp, and the policy. The iPad, which still holds
 *      the typed PIN in memory for that instant, stores a VERIFIER:
 *        D = PBKDF2-SHA256(PIN, device salt, 600,000 iterations)
 *        verifier = HMAC-SHA256(offline key, D | employee id)
 *      The PIN itself is never stored, logged, queued or sent anywhere new.
 *   2. REFRESH. While online, the iPad asks the server for the roster every
 *      few minutes: who is still active, still has a PIN, still passes the
 *      handbook gate, their role, and their PIN stamp. Anyone missing, or
 *      whose PIN changed, is erased from this iPad. An owner "revoke all"
 *      bumps the epoch, which changes the key and erases every verifier.
 *   3. UNLOCK OFFLINE. With no server, the iPad derives D once from the typed
 *      PIN and compares HMAC(key, D | id) against every stored verifier in
 *      constant time. Exactly one match unlocks; zero is a wrong PIN; two is
 *      refused as ambiguous. A local throttle (persisted, escalating) and a
 *      wipe-after-25 rule stop guessing. A clock-rollback guard and a
 *      roster-freshness limit stop "set the date back and it works forever".
 *   4. AUDIT. Every offline unlock / approval / clock is queued as an
 *      `offline_auth` event and re-checked by the server at sync (is the
 *      person still active? still a manager?) — a failure lands in the
 *      manager exception queue instead of being silently accepted.
 */

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** Vault schema version. */
export const OFFLINE_VAULT_VERSION = 1 as const;

/**
 * PBKDF2-HMAC-SHA256 work factor. 600,000 is the OWASP Password Storage Cheat
 * Sheet figure for PBKDF2-HMAC-SHA256. Derived ONCE per attempt (not once per
 * employee), so a 20-person roster costs the same as one: a few hundred ms on
 * an iPad, which is invisible behind a PIN tap.
 */
export const OFFLINE_PBKDF2_ITERATIONS = 600_000;
/** Floor a stored vault must meet; anything weaker is treated as corrupt. */
export const OFFLINE_PBKDF2_MIN_ITERATIONS = 100_000;
export const OFFLINE_SALT_BYTES = 16;
export const OFFLINE_KEY_BYTES = 32;
export const OFFLINE_VERIFIER_BYTES = 32;

/** Escalating local throttle: every Nth consecutive failure locks the pad. */
export const OFFLINE_FAILURES_PER_LOCK = 5;
export const OFFLINE_FIRST_LOCK_MS = 30_000;
export const OFFLINE_MAX_LOCK_MS = 15 * 60_000;
/** Consecutive failures (since the last success) that ERASE every verifier. */
export const OFFLINE_WIPE_AFTER_FAILURES = 25;

/** A device clock earlier than the newest server time by more than this is a rollback. */
export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;
/** The roster refresh cadence while online. */
export const OFFLINE_ROSTER_REFRESH_MS = 10 * 60_000;
/** The online unlock waits this long before treating a hung network as offline. */
export const ONLINE_UNLOCK_TIMEOUT_MS = 8_000;
/** Hard cap on stored records (defence against a runaway roster). */
export const OFFLINE_MAX_RECORDS = 200;

/** Roles that may approve (matches /api/pos/approve APPROVER_ROLES). */
export const OFFLINE_APPROVER_ROLES: readonly string[] = ["manager", "lead"];

// ---------------------------------------------------------------------------
// 2. Owner policy (site_settings pos_offline_unlock_policy)
// ---------------------------------------------------------------------------

export type OfflineUnlockPolicy = {
  /** Master switch. Off = every iPad erases its verifiers at the next refresh. */
  enabled: boolean;
  /** How long an iPad may keep unlocking offline after its last roster refresh. */
  maxOfflineHours: number;
  /** An employee must unlock ONLINE on the iPad at least this often. */
  armTtlDays: number;
  /** May a manager/lead PIN approve a no-sale or price override offline? */
  allowOfflineApproval: boolean;
  /** Revocation epoch. Bumping it changes every iPad's key = erases every verifier. */
  epoch: number;
};

export const DEFAULT_OFFLINE_POLICY: OfflineUnlockPolicy = {
  enabled: true,
  maxOfflineHours: 168,
  armTtlDays: 30,
  allowOfflineApproval: true,
  epoch: 1,
};

export const OFFLINE_POLICY_LIMITS = {
  maxOfflineHours: { min: 4, max: 720 },
  armTtlDays: { min: 1, max: 90 },
  epoch: { min: 1, max: 1_000_000 },
} as const;

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Normalize anything into a safe policy. Never throws. */
export function normalizeOfflinePolicy(raw: unknown): OfflineUnlockPolicy {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const L = OFFLINE_POLICY_LIMITS;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_OFFLINE_POLICY.enabled,
    maxOfflineHours: clampInt(r.maxOfflineHours, L.maxOfflineHours.min, L.maxOfflineHours.max, DEFAULT_OFFLINE_POLICY.maxOfflineHours),
    armTtlDays: clampInt(r.armTtlDays, L.armTtlDays.min, L.armTtlDays.max, DEFAULT_OFFLINE_POLICY.armTtlDays),
    allowOfflineApproval: typeof r.allowOfflineApproval === "boolean" ? r.allowOfflineApproval : DEFAULT_OFFLINE_POLICY.allowOfflineApproval,
    epoch: clampInt(r.epoch, L.epoch.min, L.epoch.max, DEFAULT_OFFLINE_POLICY.epoch),
  };
}

/** Validate an owner's edit from the back office. The epoch is never edited here. */
export function validateOfflinePolicyDraft(
  input: { enabled: unknown; maxOfflineHours: unknown; armTtlDays: unknown; allowOfflineApproval: unknown },
  current: OfflineUnlockPolicy,
): { ok: true; policy: OfflineUnlockPolicy } | { ok: false; error: string } {
  if (typeof input.enabled !== "boolean") return { ok: false, error: "Offline unlock must be on or off." };
  if (typeof input.allowOfflineApproval !== "boolean") return { ok: false, error: "Offline manager approval must be on or off." };
  const h = Number(input.maxOfflineHours);
  const L = OFFLINE_POLICY_LIMITS;
  if (!Number.isInteger(h) || h < L.maxOfflineHours.min || h > L.maxOfflineHours.max) {
    return { ok: false, error: `Offline window must be a whole number of hours from ${L.maxOfflineHours.min} to ${L.maxOfflineHours.max}.` };
  }
  const d = Number(input.armTtlDays);
  if (!Number.isInteger(d) || d < L.armTtlDays.min || d > L.armTtlDays.max) {
    return { ok: false, error: `Online re-check must be a whole number of days from ${L.armTtlDays.min} to ${L.armTtlDays.max}.` };
  }
  return {
    ok: true,
    policy: { enabled: input.enabled, maxOfflineHours: h, armTtlDays: d, allowOfflineApproval: input.allowOfflineApproval, epoch: current.epoch },
  };
}

/** The "revoke every offline PIN on every iPad" action: bump the epoch. */
export function revokedPolicy(current: OfflineUnlockPolicy): OfflineUnlockPolicy {
  return { ...current, epoch: Math.min(OFFLINE_POLICY_LIMITS.epoch.max, current.epoch + 1) };
}

/** The key id a vault carries: "e<epoch>". Changes whenever the owner revokes. */
export function offlineKeyId(epoch: number): string {
  return `e${Math.max(1, Math.round(epoch))}`;
}

// ---------------------------------------------------------------------------
// 3. Wire shapes (server → iPad)
// ---------------------------------------------------------------------------

/** Sent with a successful ONLINE unlock so the iPad can arm that employee. */
export type OfflineArmBlock = {
  keyId: string;
  /** base64url, OFFLINE_KEY_BYTES. */
  key: string;
  policy: OfflineUnlockPolicy;
  /** Server clock (ms) — feeds the rollback guard. */
  serverNowMs: number;
  pinStamp: string;
  canApprove: boolean;
  /** Who was just proven (so approve/clock answers can arm too). */
  employee: { id: string; fullName: string; jobRole: string; sawUsername: string | null };
};

export type OfflineRosterEntry = {
  id: string;
  fullName: string;
  jobRole: string;
  canApprove: boolean;
  sawUsername: string | null;
  pinStamp: string;
  /** Server's view of the clock right now (undefined = not reported). */
  clockedIn?: boolean;
};

export type OfflineRoster = {
  keyId: string;
  key: string;
  policy: OfflineUnlockPolicy;
  serverNowMs: number;
  employees: OfflineRosterEntry[];
  /** The register's open drawer right now (undefined = not reported; null = none open). */
  drawer?: CachedDrawer | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const STAMP_RE = /^[0-9a-f]{16,64}$/;
const KEYID_RE = /^e\d{1,7}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Decoded byte length of an unpadded base64url string, or -1 when malformed. */
export function b64urlByteLength(s: unknown): number {
  if (typeof s !== "string" || s.length === 0 || s.length > 200 || !B64URL_RE.test(s)) return -1;
  const rem = s.length % 4;
  if (rem === 1) return -1;
  return Math.floor((s.length * 3) / 4);
}

function cleanName(v: unknown, max = 80): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
  return t || null;
}

export function parseArmBlock(raw: unknown): OfflineArmBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.keyId !== "string" || !KEYID_RE.test(r.keyId)) return null;
  if (b64urlByteLength(r.key) !== OFFLINE_KEY_BYTES) return null;
  if (typeof r.pinStamp !== "string" || !STAMP_RE.test(r.pinStamp)) return null;
  if (typeof r.serverNowMs !== "number" || !Number.isFinite(r.serverNowMs) || r.serverNowMs <= 0) return null;
  const e = (r.employee ?? null) as Record<string, unknown> | null;
  const name = e ? cleanName(e.fullName) : null;
  if (!e || !isUuidLike(e.id) || !name) return null;
  return {
    keyId: r.keyId,
    key: r.key as string,
    policy: normalizeOfflinePolicy(r.policy),
    serverNowMs: Math.round(r.serverNowMs),
    pinStamp: r.pinStamp,
    canApprove: r.canApprove === true,
    employee: { id: e.id.toLowerCase(), fullName: name, jobRole: cleanName(e.jobRole, 30) ?? "sales", sawUsername: cleanName(e.sawUsername, 80) },
  };
}

export function parseRoster(raw: unknown): OfflineRoster | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.keyId !== "string" || !KEYID_RE.test(r.keyId)) return null;
  if (b64urlByteLength(r.key) !== OFFLINE_KEY_BYTES) return null;
  if (typeof r.serverNowMs !== "number" || !Number.isFinite(r.serverNowMs) || r.serverNowMs <= 0) return null;
  if (!Array.isArray(r.employees) || r.employees.length > OFFLINE_MAX_RECORDS) return null;
  const employees: OfflineRosterEntry[] = [];
  const seen = new Set<string>();
  for (const e of r.employees) {
    if (!e || typeof e !== "object") return null;
    const x = e as Record<string, unknown>;
    const name = cleanName(x.fullName);
    if (!isUuidLike(x.id) || !name || typeof x.pinStamp !== "string" || !STAMP_RE.test(x.pinStamp)) return null;
    const id = x.id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    employees.push({
      id,
      fullName: name,
      jobRole: cleanName(x.jobRole, 30) ?? "sales",
      canApprove: x.canApprove === true,
      sawUsername: cleanName(x.sawUsername, 80),
      pinStamp: x.pinStamp,
      ...(typeof x.clockedIn === "boolean" ? { clockedIn: x.clockedIn } : {}),
    });
  }
  const out: OfflineRoster = { keyId: r.keyId, key: r.key as string, policy: normalizeOfflinePolicy(r.policy), serverNowMs: Math.round(r.serverNowMs), employees };
  if (r.drawer === null) out.drawer = null;
  else if (r.drawer !== undefined) {
    const dr = parseDrawer(r.drawer);
    if (dr) out.drawer = dr;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. The vault (one secure-store item on the iPad)
// ---------------------------------------------------------------------------

export type OfflineRecord = {
  employeeId: string;
  fullName: string;
  jobRole: string;
  canApprove: boolean;
  sawUsername: string | null;
  pinStamp: string;
  /** base64url HMAC-SHA256(key, PBKDF2(pin) | employeeId). */
  verifier: string;
  /** When the employee last proved their PIN ONLINE on this iPad. */
  armedAt: string;
  /** Last known clock state (from the server, or this iPad's own queued punch). */
  clockedIn: boolean;
};

export type OfflineThrottle = {
  /** Consecutive failures since the last success. */
  failures: number;
  lockedUntilMs: number;
  /** Lifetime failures (diagnostics only). */
  totalFailures: number;
};

export type CachedDrawer = { sessionId: string; openedAt: string | null; businessDay: string };

export type OfflineVault = {
  v: typeof OFFLINE_VAULT_VERSION;
  keyId: string;
  key: string;
  salt: string;
  iterations: number;
  policy: OfflineUnlockPolicy;
  /** Last POSITIVE roster answer (ISO). Null until the first refresh. */
  rosterAt: string | null;
  /** Newest server time seen (ms) — rollback guard. */
  serverTimeMs: number;
  records: OfflineRecord[];
  throttle: OfflineThrottle;
  /** The register's open drawer as last seen online. */
  drawer: CachedDrawer | null;
  /** Count of successful offline unlocks (diagnostics). */
  offlineUnlocks: number;
  /** Times the vault was erased by the wipe-after rule (diagnostics). */
  wipes: number;
};

export const FRESH_THROTTLE: OfflineThrottle = { failures: 0, lockedUntilMs: 0, totalFailures: 0 };

export function newVault(input: { keyId: string; key: string; salt: string; iterations?: number; policy: OfflineUnlockPolicy; serverNowMs: number }): OfflineVault {
  return {
    v: OFFLINE_VAULT_VERSION,
    keyId: input.keyId,
    key: input.key,
    salt: input.salt,
    iterations: input.iterations ?? OFFLINE_PBKDF2_ITERATIONS,
    policy: normalizeOfflinePolicy(input.policy),
    rosterAt: null,
    serverTimeMs: input.serverNowMs,
    records: [],
    throttle: { ...FRESH_THROTTLE },
    drawer: null,
    offlineUnlocks: 0,
    wipes: 0,
  };
}

function parseRecord(raw: unknown): OfflineRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = cleanName(r.fullName);
  if (!isUuidLike(r.employeeId) || !name) return null;
  if (typeof r.pinStamp !== "string" || !STAMP_RE.test(r.pinStamp)) return null;
  if (b64urlByteLength(r.verifier) !== OFFLINE_VERIFIER_BYTES) return null;
  if (typeof r.armedAt !== "string" || !ISO_RE.test(r.armedAt) || !Number.isFinite(Date.parse(r.armedAt))) return null;
  return {
    employeeId: r.employeeId.toLowerCase(),
    fullName: name,
    jobRole: cleanName(r.jobRole, 30) ?? "sales",
    canApprove: r.canApprove === true,
    sawUsername: cleanName(r.sawUsername, 80),
    pinStamp: r.pinStamp,
    verifier: r.verifier as string,
    armedAt: r.armedAt,
    clockedIn: r.clockedIn === true,
  };
}

function parseDrawer(raw: unknown): CachedDrawer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isUuidLike(r.sessionId) || typeof r.businessDay !== "string" || !DAY_RE.test(r.businessDay)) return null;
  return {
    sessionId: r.sessionId,
    openedAt: typeof r.openedAt === "string" && ISO_RE.test(r.openedAt) ? r.openedAt : null,
    businessDay: r.businessDay,
  };
}

/**
 * Parse the stored vault. STRICT: anything malformed returns null (the iPad
 * then behaves as "not armed", which is safe — the online unlock still works
 * and re-arms). A corrupt record is dropped, not the whole vault.
 */
export function parseVault(raw: string | null | undefined): OfflineVault | null {
  if (!raw || typeof raw !== "string" || raw.length > 200_000) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const r = j as Record<string, unknown>;
  if (r.v !== OFFLINE_VAULT_VERSION) return null;
  if (typeof r.keyId !== "string" || !KEYID_RE.test(r.keyId)) return null;
  if (b64urlByteLength(r.key) !== OFFLINE_KEY_BYTES) return null;
  if (b64urlByteLength(r.salt) !== OFFLINE_SALT_BYTES) return null;
  if (typeof r.iterations !== "number" || !Number.isInteger(r.iterations) || r.iterations < OFFLINE_PBKDF2_MIN_ITERATIONS || r.iterations > 10_000_000) return null;
  if (typeof r.serverTimeMs !== "number" || !Number.isFinite(r.serverTimeMs)) return null;
  const t = (r.throttle ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const records: OfflineRecord[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(r.records) ? r.records.slice(0, OFFLINE_MAX_RECORDS) : []) {
    const rec = parseRecord(x);
    if (rec && !seen.has(rec.employeeId)) {
      seen.add(rec.employeeId);
      records.push(rec);
    }
  }
  return {
    v: OFFLINE_VAULT_VERSION,
    keyId: r.keyId,
    key: r.key as string,
    salt: r.salt as string,
    iterations: r.iterations,
    policy: normalizeOfflinePolicy(r.policy),
    rosterAt: typeof r.rosterAt === "string" && ISO_RE.test(r.rosterAt) ? r.rosterAt : null,
    serverTimeMs: Math.round(r.serverTimeMs),
    records,
    throttle: { failures: num(t.failures), lockedUntilMs: num(t.lockedUntilMs), totalFailures: num(t.totalFailures) },
    drawer: parseDrawer(r.drawer),
    offlineUnlocks: num(r.offlineUnlocks),
    wipes: num(r.wipes),
  };
}

export function serializeVault(v: OfflineVault): string {
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// 5. Arm + roster merge
// ---------------------------------------------------------------------------

/**
 * Re-key a vault when the server's key id changed (owner revoked, or the
 * server secret rotated). EVERY verifier is erased: they were bound to the
 * old key and cannot be re-derived without each person's PIN.
 */
function rekey(v: OfflineVault, keyId: string, key: string): OfflineVault {
  if (v.keyId === keyId && v.key === key) return v;
  return { ...v, keyId, key, records: [] };
}

/** Store (or replace) one employee's verifier after an ONLINE PIN proof. */
export function applyArm(
  vault: OfflineVault,
  arm: OfflineArmBlock,
  rec: { verifier: string; armedAt: string; clockedIn: boolean | null },
): OfflineVault {
  let v = rekey(vault, arm.keyId, arm.key);
  v = { ...v, policy: arm.policy, serverTimeMs: Math.max(v.serverTimeMs, arm.serverNowMs) };
  if (!arm.policy.enabled) return { ...v, records: [] };
  const id = arm.employee.id.toLowerCase();
  const prior = v.records.find((r) => r.employeeId === id);
  const next: OfflineRecord = {
    employeeId: id,
    fullName: arm.employee.fullName,
    jobRole: arm.employee.jobRole,
    sawUsername: arm.employee.sawUsername,
    verifier: rec.verifier,
    armedAt: rec.armedAt,
    // null = this answer did not say (e.g. an approval); keep what we knew.
    clockedIn: rec.clockedIn ?? prior?.clockedIn ?? false,
    pinStamp: arm.pinStamp,
    canApprove: arm.canApprove,
  };
  // A newly-armed PIN that equals someone else's old verifier is impossible to
  // tell apart offline; the record for THIS employee simply replaces their own.
  const others = v.records.filter((r) => r.employeeId !== id);
  const records = [...others, next].slice(-OFFLINE_MAX_RECORDS);
  // A successful online proof is also a success for the local throttle.
  return { ...v, records, throttle: { ...v.throttle, failures: 0, lockedUntilMs: 0 } };
}

export type RosterMergeResult = { vault: OfflineVault; removed: string[]; reason: string | null };

/**
 * Apply a POSITIVE roster answer. Only ever called with a parsed, successful
 * server response — a network or server error must never purge the cache
 * (that would lock people out exactly when the internet is flaky).
 */
export function applyRoster(vault: OfflineVault, roster: OfflineRoster, nowIso: string): RosterMergeResult {
  const keyChanged = vault.keyId !== roster.keyId || vault.key !== roster.key;
  let v = rekey(vault, roster.keyId, roster.key);
  v = { ...v, policy: roster.policy, rosterAt: nowIso, serverTimeMs: Math.max(v.serverTimeMs, roster.serverNowMs) };
  const prevIds = (keyChanged ? vault.records : v.records).map((r) => r.employeeId);
  if (!roster.policy.enabled) {
    return { vault: { ...v, records: [] }, removed: prevIds, reason: "The owner turned offline unlock off." };
  }
  const byId = new Map(roster.employees.map((e) => [e.id, e]));
  const kept: OfflineRecord[] = [];
  const removed: string[] = keyChanged ? [...prevIds] : [];
  for (const r of v.records) {
    const e = byId.get(r.employeeId);
    if (!e || e.pinStamp !== r.pinStamp) {
      removed.push(r.employeeId);
      continue;
    }
    kept.push({
      ...r,
      fullName: e.fullName,
      jobRole: e.jobRole,
      canApprove: e.canApprove,
      sawUsername: e.sawUsername,
      clockedIn: typeof e.clockedIn === "boolean" ? e.clockedIn : r.clockedIn,
    });
  }
  return {
    vault: { ...v, records: kept, drawer: roster.drawer === undefined ? v.drawer : roster.drawer },
    removed,
    reason: keyChanged && prevIds.length > 0 ? "Offline PINs were reset by the owner (or the server key changed)." : null,
  };
}

/** Erase every verifier but keep the key/salt (used by wipe-after and device revoke). */
export function wipeRecords(v: OfflineVault): OfflineVault {
  return { ...v, records: [], throttle: { ...FRESH_THROTTLE, totalFailures: v.throttle.totalFailures }, wipes: v.wipes + 1 };
}

/** Update the cached clock state for one employee. */
export function noteClockState(v: OfflineVault, employeeId: string, clockedIn: boolean): OfflineVault {
  const id = employeeId.toLowerCase();
  if (!v.records.some((r) => r.employeeId === id && r.clockedIn !== clockedIn)) return v;
  return { ...v, records: v.records.map((r) => (r.employeeId === id ? { ...r, clockedIn } : r)) };
}

export function noteDrawer(v: OfflineVault, drawer: CachedDrawer | null): OfflineVault {
  const d = drawer ? parseDrawer(drawer) : null;
  if (JSON.stringify(d) === JSON.stringify(v.drawer)) return v;
  return { ...v, drawer: d };
}

/** The cached drawer, only if it belongs to TODAY's business day. */
export function cachedDrawerFor(v: OfflineVault | null, todayKey: string): CachedDrawer | null {
  if (!v?.drawer) return null;
  return v.drawer.businessDay === todayKey ? v.drawer : null;
}

// ---------------------------------------------------------------------------
// 6. Gates
// ---------------------------------------------------------------------------

export type OfflineGateCode =
  | "not-armed"
  | "disabled"
  | "nobody"
  | "clock-rollback"
  | "roster-stale"
  | "throttled";

export type OfflineGate = { ok: true } | { ok: false; code: OfflineGateCode; message: string };

function pluralMin(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Is an offline PIN attempt allowed right now? Ordered: the most fundamental reason first. */
export function offlineUnlockGate(v: OfflineVault | null, nowMs: number): OfflineGate {
  if (!v) {
    return {
      ok: false,
      code: "not-armed",
      message: "Offline unlock is not set up on this iPad yet. Each employee must unlock it once while the internet works.",
    };
  }
  if (!v.policy.enabled) return { ok: false, code: "disabled", message: "The owner has turned offline unlock off. Unlocking needs the internet." };
  if (v.records.length === 0) {
    return {
      ok: false,
      code: "nobody",
      message: "No one can unlock this iPad offline yet. Each employee must unlock it once while the internet works.",
    };
  }
  if (nowMs < v.serverTimeMs - OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS) {
    return {
      ok: false,
      code: "clock-rollback",
      message: "This iPad's clock is set earlier than the last time it talked to the server. Fix the date and time in Settings, then try again.",
    };
  }
  const base = v.rosterAt ? Math.max(Date.parse(v.rosterAt), v.serverTimeMs) : v.serverTimeMs;
  if (!Number.isFinite(base) || nowMs - base > v.policy.maxOfflineHours * 3_600_000) {
    return {
      ok: false,
      code: "roster-stale",
      message: `This iPad has been offline longer than the owner allows (${v.policy.maxOfflineHours} hours). Unlocking needs the internet.`,
    };
  }
  if (nowMs < v.throttle.lockedUntilMs) {
    return { ok: false, code: "throttled", message: `Too many wrong PINs. Offline unlock is paused for ${pluralMin(v.throttle.lockedUntilMs - nowMs)}.` };
  }
  return { ok: true };
}

/** Is one record still within the owner's "unlock online at least every N days" rule? */
export function recordIsFresh(r: OfflineRecord, policy: OfflineUnlockPolicy, nowMs: number): boolean {
  const at = Date.parse(r.armedAt);
  return Number.isFinite(at) && nowMs - at <= policy.armTtlDays * 86_400_000 && at - nowMs <= OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS;
}

/** Constant-time string comparison (length leak only, and every verifier has the same length). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  return diff === 0;
}

export type MatchResult =
  | { kind: "match"; record: OfflineRecord }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "expired"; record: OfflineRecord };

/**
 * Compare a computed verifier per record against every stored one. EVERY
 * record is compared (no early exit) so timing does not reveal position.
 */
export function matchVerifiers(records: readonly OfflineRecord[], computed: ReadonlyMap<string, string>, policy: OfflineUnlockPolicy, nowMs: number): MatchResult {
  const hits: OfflineRecord[] = [];
  for (const r of records) {
    const c = computed.get(r.employeeId) ?? "";
    if (constantTimeEqual(c, r.verifier)) hits.push(r);
  }
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous" };
  const hit = hits[0]!;
  if (!recordIsFresh(hit, policy, nowMs)) return { kind: "expired", record: hit };
  return { kind: "match", record: hit };
}

/** Throttle after a wrong PIN. Returns the new throttle and whether to wipe. */
export function throttleAfterFailure(t: OfflineThrottle, nowMs: number): { throttle: OfflineThrottle; wipe: boolean } {
  const failures = t.failures + 1;
  const totalFailures = t.totalFailures + 1;
  if (failures >= OFFLINE_WIPE_AFTER_FAILURES) {
    return { throttle: { failures: 0, lockedUntilMs: 0, totalFailures }, wipe: true };
  }
  let lockedUntilMs = t.lockedUntilMs;
  if (failures % OFFLINE_FAILURES_PER_LOCK === 0) {
    const step = failures / OFFLINE_FAILURES_PER_LOCK; // 1, 2, 3, 4
    lockedUntilMs = nowMs + Math.min(OFFLINE_MAX_LOCK_MS, OFFLINE_FIRST_LOCK_MS * 2 ** (step - 1));
  }
  return { throttle: { failures, lockedUntilMs, totalFailures }, wipe: false };
}

export function throttleAfterSuccess(t: OfflineThrottle): OfflineThrottle {
  return { failures: 0, lockedUntilMs: 0, totalFailures: t.totalFailures };
}

/** Failures left before the vault is erased (for the warning shown after a miss). */
export function failuresBeforeWipe(t: OfflineThrottle): number {
  return Math.max(0, OFFLINE_WIPE_AFTER_FAILURES - t.failures);
}

/**
 * When may the lock screen fall back to the offline check?
 * - The request threw (no network, DNS, TLS, timeout/abort): yes.
 * - The server answered 5xx (Vercel up, database down; or a gateway error): yes.
 * - The server answered 4xx (wrong PIN, throttled, handbook, unbound): NEVER.
 *   A server that can say "no" must be obeyed; offline is not a second chance.
 */
export function offlineFallbackAllowed(input: { threw: boolean; status: number | null }): boolean {
  if (input.threw) return true;
  return typeof input.status === "number" && input.status >= 500 && input.status <= 599;
}

/** Why the register went to the offline check — carried in the audit event. */
export type OfflineReason = "offline" | "timeout" | "network" | "server_error";

export function offlineReasonFor(input: { online: boolean; threw: boolean; aborted: boolean; status: number | null }): OfflineReason {
  if (!input.online) return "offline";
  if (input.aborted) return "timeout";
  if (input.threw) return "network";
  return "server_error";
}

// ---------------------------------------------------------------------------
// 7. Readiness (lock screen chip + back-office health)
// ---------------------------------------------------------------------------

export type OfflineReadiness = {
  state: "ready" | "warn" | "off";
  armed: number;
  approvers: number;
  text: string;
};

export function offlineReadiness(v: OfflineVault | null, nowMs: number, formatAgo: (ms: number) => string = defaultAgo): OfflineReadiness {
  if (!v) return { state: "warn", armed: 0, approvers: 0, text: "Offline unlock: not set up yet. Each person unlocks once online." };
  if (!v.policy.enabled) return { state: "off", armed: 0, approvers: 0, text: "Offline unlock is turned off by the owner." };
  const fresh = v.records.filter((r) => recordIsFresh(r, v.policy, nowMs));
  const approvers = fresh.filter((r) => r.canApprove).length;
  if (fresh.length === 0) return { state: "warn", armed: 0, approvers: 0, text: "Offline unlock: no one is set up yet. Each person unlocks once online." };
  const at = v.rosterAt ? Date.parse(v.rosterAt) : NaN;
  const ago = Number.isFinite(at) ? `, checked ${formatAgo(nowMs - at)} ago` : "";
  return {
    state: "ready",
    armed: fresh.length,
    approvers,
    text: `Offline unlock ready: ${fresh.length} ${fresh.length === 1 ? "person" : "people"}${ago}.`,
  };
}

function defaultAgo(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** Offline approval available right now (policy + at least one fresh approver)? */
export function offlineApprovalReady(v: OfflineVault | null, nowMs: number): boolean {
  if (!v || !v.policy.enabled || !v.policy.allowOfflineApproval) return false;
  if (!offlineUnlockGate(v, nowMs).ok) return false;
  return v.records.some((r) => r.canApprove && recordIsFresh(r, v.policy, nowMs));
}

/** What the iPad reports about its offline readiness on every heartbeat. No secrets. */
export type OfflineHealth = {
  enabled: boolean;
  armed: number;
  approvers: number;
  rosterAt: string | null;
  keyId: string | null;
  lockedUntil: string | null;
  failures: number;
  offlineUnlocks: number;
  wipes: number;
};

export function offlineHealthOf(v: OfflineVault | null, nowMs: number): OfflineHealth {
  if (!v) return { enabled: true, armed: 0, approvers: 0, rosterAt: null, keyId: null, lockedUntil: null, failures: 0, offlineUnlocks: 0, wipes: 0 };
  const fresh = v.records.filter((r) => recordIsFresh(r, v.policy, nowMs));
  return {
    enabled: v.policy.enabled,
    armed: fresh.length,
    approvers: fresh.filter((r) => r.canApprove).length,
    rosterAt: v.rosterAt,
    keyId: v.keyId,
    lockedUntil: v.throttle.lockedUntilMs > nowMs ? new Date(v.throttle.lockedUntilMs).toISOString() : null,
    failures: v.throttle.failures,
    offlineUnlocks: v.offlineUnlocks,
    wipes: v.wipes,
  };
}

/** Server-side sanitizer for the health field. Never throws; junk → null. */
export function sanitizeOfflineHealth(raw: unknown): OfflineHealth | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, max = 10_000) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);
  const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && ISO_RE.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
  return {
    enabled: r.enabled !== false,
    armed: n(r.armed, OFFLINE_MAX_RECORDS),
    approvers: n(r.approvers, OFFLINE_MAX_RECORDS),
    rosterAt: iso(r.rosterAt),
    keyId: typeof r.keyId === "string" && KEYID_RE.test(r.keyId) ? r.keyId : null,
    lockedUntil: iso(r.lockedUntil),
    failures: n(r.failures, 1000),
    offlineUnlocks: n(r.offlineUnlocks, 1_000_000),
    wipes: n(r.wipes, 1000),
  };
}

/** The back-office line for one iPad. */
export function offlineHealthCheck(h: OfflineHealth | null, policy: OfflineUnlockPolicy, nowMs: number):
  { label: string; state: "ok" | "warn" | "bad" | "unknown"; text: string } {
  const label = "Offline unlock";
  if (!policy.enabled) return { label, state: "warn", text: "Turned OFF by the owner. A locked iPad cannot be unlocked during an internet outage." };
  if (!h) return { label, state: "unknown", text: "Not reported (this iPad runs a build from before offline unlock). Rebuild it." };
  if (h.keyId && h.keyId !== offlineKeyId(policy.epoch)) return { label, state: "warn", text: "Reset pending: the iPad will drop its old offline PINs at its next check-in." };
  if (h.wipes > 0 && h.armed === 0) return { label, state: "bad", text: "Offline PINs were erased after too many wrong guesses. Each person must unlock once online." };
  if (h.armed === 0) return { label, state: "bad", text: "No one can unlock this iPad offline. Each employee must unlock it once while online." };
  const rosterMs = h.rosterAt ? Date.parse(h.rosterAt) : NaN;
  if (!Number.isFinite(rosterMs) || nowMs - rosterMs > 2 * 3_600_000) {
    return { label, state: "warn", text: `${h.armed} ready, but the staff list has not been re-checked recently.` };
  }
  if (h.lockedUntil) return { label, state: "warn", text: `${h.armed} ready. PIN pad paused after ${h.failures} wrong offline PINs.` };
  return {
    label,
    state: h.approvers > 0 || !policy.allowOfflineApproval ? "ok" : "warn",
    text:
      h.approvers > 0 || !policy.allowOfflineApproval
        ? `${h.armed} ${h.armed === 1 ? "person" : "people"} can unlock offline${policy.allowOfflineApproval ? `, ${h.approvers} can approve` : ""}.`
        : `${h.armed} can unlock offline, but no manager is set up to approve offline. A manager should unlock this iPad once online.`,
  };
}

// ---------------------------------------------------------------------------
// 8. The audit event (`offline_auth`, validated at sync)
// ---------------------------------------------------------------------------

export type OfflineAuthKind = "unlock" | "approval" | "clock";

export type OfflineAuthPayload = {
  kind: OfflineAuthKind;
  reason: OfflineReason;
  /** When this employee last proved their PIN online on this iPad. */
  armedAt: string;
  /** The vault's last positive roster answer. */
  rosterAt: string | null;
  keyId: string;
  /** approval only: what was approved. */
  purpose?: "no_sale" | "price_override";
  /** clock only. */
  intent?: "in" | "out";
};

export function validateOfflineAuthPayload(p: Partial<OfflineAuthPayload> | null | undefined): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["payload must be an object."] };
  if (p.kind !== "unlock" && p.kind !== "approval" && p.kind !== "clock") errors.push('kind must be "unlock", "approval" or "clock".');
  if (p.reason !== "offline" && p.reason !== "timeout" && p.reason !== "network" && p.reason !== "server_error") errors.push("reason is not recognized.");
  if (typeof p.armedAt !== "string" || !ISO_RE.test(p.armedAt)) errors.push("armedAt must be an ISO timestamp.");
  if (p.rosterAt !== null && p.rosterAt !== undefined && (typeof p.rosterAt !== "string" || !ISO_RE.test(p.rosterAt))) errors.push("rosterAt must be an ISO timestamp or null.");
  if (typeof p.keyId !== "string" || !KEYID_RE.test(p.keyId)) errors.push("keyId is malformed.");
  if (p.kind === "approval" && p.purpose !== "no_sale" && p.purpose !== "price_override") errors.push('approval purpose must be "no_sale" or "price_override".');
  if (p.kind === "clock" && p.intent !== "in" && p.intent !== "out") errors.push('clock intent must be "in" or "out".');
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * The server's post-hoc verdict for a synced offline_auth event, given what
 * the database says about the employee NOW. Anything doubtful becomes a
 * manager exception rather than a quiet pass.
 */
export function judgeOfflineAuth(input: {
  payload: OfflineAuthPayload;
  employee: { active: boolean; jobRole: string } | null;
  currentKeyId: string;
}): { ok: true; action: string } | { ok: false; reason: string } {
  const { payload, employee } = input;
  if (!employee) return { ok: false, reason: "Offline PIN use by an employee id the server does not know. Review this register's sales from that time." };
  if (!employee.active) return { ok: false, reason: "Offline PIN use by an employee who is no longer active. Review this register's sales from that time." };
  if (payload.kind === "approval" && !OFFLINE_APPROVER_ROLES.includes(employee.jobRole)) {
    return { ok: false, reason: "An offline approval was made by someone who is not a manager or lead now. Review it." };
  }
  // A keyId older than the current epoch means the iPad used a PIN set from
  // before the owner's revoke (it had not checked in yet). Flag, don't hide.
  const used = Number(payload.keyId.slice(1));
  const cur = Number(input.currentKeyId.slice(1));
  if (Number.isFinite(used) && Number.isFinite(cur) && used < cur) {
    return { ok: false, reason: "An offline PIN from before the owner's reset was used (the iPad had not checked in yet). Review it." };
  }
  const action = payload.kind === "unlock" ? "register.unlocked_offline" : payload.kind === "approval" ? "register.offline_approval" : "register.offline_clock";
  return { ok: true, action };
}

// ---------------------------------------------------------------------------
// 9. Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runOfflineUnlockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`offline-unlock-core FAIL: ${label}`);
    }
  };
  const K = "A".repeat(43); // 32 bytes b64url
  const S = "B".repeat(22); // 16 bytes
  const V = "C".repeat(43);
  const E1 = "11111111-1111-4111-8111-111111111111";
  const E2 = "22222222-2222-4222-8222-222222222222";
  const now = Date.parse("2026-11-04T12:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  // policy
  ok(JSON.stringify(normalizeOfflinePolicy(null)) === JSON.stringify(DEFAULT_OFFLINE_POLICY), "policy defaults");
  ok(normalizeOfflinePolicy({ maxOfflineHours: 99999 }).maxOfflineHours === 720, "offline window clamped high");
  ok(normalizeOfflinePolicy({ maxOfflineHours: 1 }).maxOfflineHours === 4, "offline window clamped low");
  ok(normalizeOfflinePolicy({ enabled: "yes" }).enabled === true, "non-boolean enabled falls back to default");
  ok(!validateOfflinePolicyDraft({ enabled: true, maxOfflineHours: 3, armTtlDays: 30, allowOfflineApproval: true }, DEFAULT_OFFLINE_POLICY).ok, "3h refused");
  ok(!validateOfflinePolicyDraft({ enabled: true, maxOfflineHours: 72, armTtlDays: 0, allowOfflineApproval: true }, DEFAULT_OFFLINE_POLICY).ok, "0 days refused");
  const d = validateOfflinePolicyDraft({ enabled: false, maxOfflineHours: "72", armTtlDays: "14", allowOfflineApproval: false }, { ...DEFAULT_OFFLINE_POLICY, epoch: 7 });
  ok(d.ok && d.policy.maxOfflineHours === 72 && d.policy.epoch === 7, "draft accepted, epoch preserved");
  ok(revokedPolicy({ ...DEFAULT_OFFLINE_POLICY, epoch: 3 }).epoch === 4, "revoke bumps epoch");
  ok(offlineKeyId(4) === "e4", "key id");

  // base64url lengths
  ok(b64urlByteLength(K) === 32 && b64urlByteLength(S) === 16, "b64url lengths");
  ok(b64urlByteLength("abc=") === -1 && b64urlByteLength("") === -1 && b64urlByteLength("a") === -1, "malformed b64url refused");

  // arm block / roster parsing
  const emp1 = { id: E1, fullName: "Ann", jobRole: "manager", sawUsername: null };
  const emp2 = { id: E2, fullName: "Bo", jobRole: "sales", sawUsername: null };
  const armRaw = { keyId: "e1", key: K, policy: {}, serverNowMs: now, pinStamp: "ab".repeat(8), canApprove: true, employee: emp1 };
  ok(parseArmBlock(armRaw) !== null, "arm block parses");
  ok(parseArmBlock({ ...armRaw, key: "short" }) === null, "short key refused");
  ok(parseArmBlock({ ...armRaw, keyId: "x1" }) === null, "bad key id refused");
  ok(parseArmBlock({ ...armRaw, employee: { id: "x", fullName: "A" } }) === null, "arm without a real employee refused");
  const rosterRaw = { keyId: "e1", key: K, policy: {}, serverNowMs: now, employees: [{ id: E1, fullName: "Ann", jobRole: "manager", canApprove: true, pinStamp: "ab".repeat(8) }] };
  ok(parseRoster(rosterRaw)?.employees.length === 1, "roster parses");
  ok(parseRoster({ ...rosterRaw, employees: [rosterRaw.employees[0], rosterRaw.employees[0]] }) === null, "duplicate ids refused");
  ok(parseRoster({ ...rosterRaw, employees: [{ ...rosterRaw.employees[0], fullName: "<>" }] }) === null, "empty name refused");

  // vault round trip + strictness
  const arm = parseArmBlock(armRaw)!;
  let v = newVault({ keyId: "e1", key: K, salt: S, policy: DEFAULT_OFFLINE_POLICY, serverNowMs: now });
  v = applyArm(v, arm, { verifier: V, armedAt: iso(now), clockedIn: false });
  ok(v.records.length === 1 && v.records[0]!.canApprove, "arm stores a record");
  const round = parseVault(serializeVault(v));
  ok(round !== null && round.records.length === 1 && round.records[0]!.verifier === V, "vault round-trips");
  ok(parseVault("{") === null && parseVault(JSON.stringify({ ...v, v: 2 })) === null, "corrupt / wrong version refused");
  ok(parseVault(JSON.stringify({ ...v, iterations: 1000 })) === null, "weak iterations refused");
  ok(parseVault(JSON.stringify({ ...v, records: [{ ...v.records[0], verifier: "x" }] }))!.records.length === 0, "bad record dropped, vault kept");
  ok(!serializeVault(v).includes("1234"), "no PIN-shaped content by construction");

  // re-arm replaces, never duplicates
  v = applyArm(v, { ...arm, employee: { ...emp1, id: E1.toUpperCase() } }, { verifier: V, armedAt: iso(now), clockedIn: true });
  ok(v.records.length === 1 && v.records[0]!.clockedIn, "re-arm replaces");
  ok(applyArm(v, arm, { verifier: V, armedAt: iso(now), clockedIn: null }).records[0]!.clockedIn, "unknown clock state keeps the last known");
  const arm2: OfflineArmBlock = { ...arm, canApprove: false, employee: emp2 };
  v = applyArm(v, arm2, { verifier: V, armedAt: iso(now), clockedIn: false });
  ok(v.records.length === 2, "second employee armed");
  const rek = applyArm(v, { ...arm2, keyId: "e2", key: "D".repeat(43) }, { verifier: V, armedAt: iso(now), clockedIn: false });
  ok(rek.records.length === 1 && rek.keyId === "e2", "new key erases verifiers bound to the old key");
  ok(applyArm(v, { ...arm, policy: { ...DEFAULT_OFFLINE_POLICY, enabled: false } }, { verifier: V, armedAt: iso(now), clockedIn: false }).records.length === 0, "disabled policy stores nothing");

  // roster merge
  const r1 = parseRoster(rosterRaw)!;
  const m1 = applyRoster(v, r1, iso(now));
  ok(m1.vault.records.length === 1 && m1.removed.join() === E2, "employee missing from roster purged");
  const m2 = applyRoster(v, { ...r1, employees: [{ ...r1.employees[0]!, pinStamp: "cd".repeat(8) }] }, iso(now));
  ok(m2.vault.records.length === 0, "changed PIN stamp purges");
  const m3 = applyRoster(v, { ...r1, keyId: "e2", key: "D".repeat(43) }, iso(now));
  ok(m3.vault.records.length === 0 && !!m3.reason, "owner revoke purges everything and says why");
  const m4 = applyRoster(v, { ...r1, policy: { ...DEFAULT_OFFLINE_POLICY, enabled: false } }, iso(now));
  ok(m4.vault.records.length === 0, "policy off purges");
  const m5 = applyRoster(v, { ...r1, employees: [{ ...r1.employees[0]!, jobRole: "sales", canApprove: false }] }, iso(now));
  ok(m5.vault.records[0]!.canApprove === false, "demotion removes approval rights");
  ok(m1.vault.rosterAt === iso(now), "roster time stamped");
  const m6 = applyRoster(v, { ...r1, employees: [{ ...r1.employees[0]!, clockedIn: true }], drawer: { sessionId: E2, openedAt: null, businessDay: "2026-11-04" } }, iso(now));
  ok(m6.vault.records[0]!.clockedIn && m6.vault.drawer?.sessionId === E2, "roster refreshes clock state and drawer");
  ok(applyRoster(m6.vault, r1, iso(now)).vault.drawer?.sessionId === E2, "roster without a drawer field leaves the drawer");
  ok(applyRoster(m6.vault, { ...r1, drawer: null }, iso(now)).vault.drawer === null, "roster drawer null clears it");
  ok(parseRoster({ ...rosterRaw, drawer: null })!.drawer === null && parseRoster(rosterRaw)!.drawer === undefined, "roster drawer parse");

  // gates
  let g = m1.vault;
  ok(offlineUnlockGate(null, now).ok === false, "no vault refused");
  ok(offlineUnlockGate(g, now).ok, "fresh vault allowed");
  const rb = offlineUnlockGate(g, now - 10 * 60_000);
  ok(!rb.ok && rb.code === "clock-rollback", "clock set back refused");
  const st = offlineUnlockGate(g, now + 169 * 3_600_000);
  ok(!st.ok && st.code === "roster-stale", "offline past the window refused");
  ok(offlineUnlockGate({ ...g, records: [] }, now).ok === false, "empty vault refused");
  ok(offlineUnlockGate({ ...g, policy: { ...g.policy, enabled: false } }, now).ok === false, "disabled refused");

  // throttle
  let t = { ...FRESH_THROTTLE };
  for (let i = 0; i < 4; i++) t = throttleAfterFailure(t, now).throttle;
  ok(t.lockedUntilMs === 0, "4 misses: no lock yet");
  t = throttleAfterFailure(t, now).throttle;
  ok(t.lockedUntilMs === now + 30_000, "5th miss locks 30s");
  for (let i = 0; i < 5; i++) t = throttleAfterFailure(t, now).throttle;
  ok(t.lockedUntilMs === now + 60_000, "10th miss locks 60s");
  g = { ...g, throttle: t };
  const th = offlineUnlockGate(g, now + 1000);
  ok(!th.ok && th.code === "throttled" && th.message.includes("second"), "throttled gate");
  for (let i = 0; i < 14; i++) t = throttleAfterFailure(t, now).throttle;
  ok(t.failures === 24, "24 misses counted");
  const w = throttleAfterFailure(t, now);
  ok(w.wipe && w.throttle.failures === 0, "25th miss wipes");
  ok(throttleAfterSuccess(t).failures === 0 && throttleAfterSuccess(t).totalFailures === t.totalFailures, "success resets streak, keeps lifetime");
  ok(wipeRecords(g).records.length === 0 && wipeRecords(g).wipes === g.wipes + 1, "wipe erases records and counts");
  ok(failuresBeforeWipe({ failures: 20, lockedUntilMs: 0, totalFailures: 20 }) === 5, "failures before wipe");

  // matching
  const recs = v.records;
  const comp = new Map([[E1, V], [E2, "Z".repeat(43)]]);
  const mm = matchVerifiers(recs, comp, DEFAULT_OFFLINE_POLICY, now);
  ok(mm.kind === "match" && mm.record.employeeId === E1, "unique match");
  ok(matchVerifiers(recs, new Map([[E1, "Z".repeat(43)]]), DEFAULT_OFFLINE_POLICY, now).kind === "none", "wrong PIN = none");
  ok(matchVerifiers(recs, new Map([[E1, V], [E2, V]]), DEFAULT_OFFLINE_POLICY, now).kind === "ambiguous", "two matches = ambiguous");
  ok(matchVerifiers(recs, comp, DEFAULT_OFFLINE_POLICY, now + 31 * 86_400_000).kind === "expired", "arm older than TTL = expired");
  ok(constantTimeEqual("abc", "abc") && !constantTimeEqual("abc", "abd") && !constantTimeEqual("abc", "ab") && !constantTimeEqual("", "a"), "constant-time equal");

  // fallback rules
  ok(offlineFallbackAllowed({ threw: true, status: null }), "thrown -> offline allowed");
  ok(offlineFallbackAllowed({ threw: false, status: 503 }), "503 -> offline allowed");
  ok(!offlineFallbackAllowed({ threw: false, status: 401 }), "401 never falls back");
  ok(!offlineFallbackAllowed({ threw: false, status: 429 }), "429 never falls back");
  ok(!offlineFallbackAllowed({ threw: false, status: 403 }), "403 never falls back");
  ok(offlineReasonFor({ online: false, threw: true, aborted: false, status: null }) === "offline", "reason offline");
  ok(offlineReasonFor({ online: true, threw: true, aborted: true, status: null }) === "timeout", "reason timeout");
  ok(offlineReasonFor({ online: true, threw: false, aborted: false, status: 502 }) === "server_error", "reason server error");

  // readiness + approval
  const rd = offlineReadiness(v, now);
  ok(rd.state === "ready" && rd.armed === 2 && rd.approvers === 1, "readiness counts");
  ok(offlineReadiness(null, now).state === "warn", "no vault = warn");
  ok(offlineApprovalReady(m1.vault, now), "approval ready with a fresh manager");
  ok(!offlineApprovalReady({ ...m1.vault, policy: { ...m1.vault.policy, allowOfflineApproval: false } }, now), "approval off by policy");
  ok(!offlineApprovalReady(m5.vault, now), "no approver = not ready");

  // drawer cache + clock state
  const dv = noteDrawer(v, { sessionId: E1, openedAt: iso(now), businessDay: "2026-11-04" });
  ok(cachedDrawerFor(dv, "2026-11-04")?.sessionId === E1, "today's drawer reused");
  ok(cachedDrawerFor(dv, "2026-11-05") === null, "yesterday's drawer never reused");
  ok(noteDrawer(dv, null).drawer === null, "closed drawer cleared");
  ok(noteClockState(v, E2, true).records.find((r) => r.employeeId === E2)!.clockedIn, "clock state cached");

  // health
  const h = offlineHealthOf(m1.vault, now);
  ok(h.armed === 1 && h.approvers === 1 && h.keyId === "e1", "health summary");
  ok(!JSON.stringify(h).includes(V) && !JSON.stringify(h).includes(K), "health carries no verifier or key");
  const hs = sanitizeOfflineHealth({ ...h, armed: 1e9, keyId: "<x>", rosterAt: "nope" })!;
  ok(hs.armed === OFFLINE_MAX_RECORDS && hs.keyId === null && hs.rosterAt === null, "health sanitized");
  ok(sanitizeOfflineHealth("x") === null, "junk health refused");
  ok(offlineHealthCheck({ ...h, rosterAt: iso(now) }, DEFAULT_OFFLINE_POLICY, now).state === "ok", "healthy offline check");
  ok(offlineHealthCheck({ ...h, armed: 0 }, DEFAULT_OFFLINE_POLICY, now).state === "bad", "nobody armed = bad");
  ok(offlineHealthCheck(h, { ...DEFAULT_OFFLINE_POLICY, epoch: 2 }, now).text.includes("Reset pending"), "stale key id flagged");
  ok(offlineHealthCheck(null, DEFAULT_OFFLINE_POLICY, now).state === "unknown", "old build unknown");

  // audit payload
  const p: OfflineAuthPayload = { kind: "unlock", reason: "offline", armedAt: iso(now), rosterAt: iso(now), keyId: "e1" };
  ok(validateOfflineAuthPayload(p).ok, "unlock payload valid");
  ok(!validateOfflineAuthPayload({ ...p, kind: "approval" }).ok, "approval needs purpose");
  ok(validateOfflineAuthPayload({ ...p, kind: "approval", purpose: "no_sale" }).ok, "approval with purpose valid");
  ok(!validateOfflineAuthPayload({ ...p, kind: "clock" }).ok, "clock needs intent");
  ok(!validateOfflineAuthPayload({ ...p, reason: "magic" as OfflineReason }).ok, "unknown reason refused");
  ok(!validateOfflineAuthPayload(null).ok, "null payload refused");
  ok(judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "sales" }, currentKeyId: "e1" }).ok, "active employee passes");
  ok(!judgeOfflineAuth({ payload: p, employee: { active: false, jobRole: "sales" }, currentKeyId: "e1" }).ok, "inactive employee flagged");
  ok(!judgeOfflineAuth({ payload: p, employee: null, currentKeyId: "e1" }).ok, "unknown employee flagged");
  ok(!judgeOfflineAuth({ payload: { ...p, kind: "approval", purpose: "no_sale" }, employee: { active: true, jobRole: "sales" }, currentKeyId: "e1" }).ok, "non-manager approval flagged");
  ok(!judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "sales" }, currentKeyId: "e2" }).ok, "pre-revoke PIN flagged");
  const j = judgeOfflineAuth({ payload: { ...p, kind: "clock", intent: "in" }, employee: { active: true, jobRole: "sales" }, currentKeyId: "e1" });
  ok(j.ok && j.action === "register.offline_clock", "clock action name");

  ok(OFFLINE_PBKDF2_ITERATIONS >= 600_000, "work factor meets OWASP PBKDF2-SHA256 figure");
  ok(OFFLINE_APPROVER_ROLES.join() === "manager,lead", "approver roles match /api/pos/approve");

  return { passed, failed };
}
