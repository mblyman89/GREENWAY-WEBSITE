/**
 * pos/pos-storage-core — the PURE policy for everything the register persists.
 *
 * WHY THIS MODULE EXISTS (Phase 1.1, H-104 / GW-001 / GW-006)
 * ----------------------------------------------------------
 * Today the register keeps ALL of its state in `window.localStorage`: the
 * offline sale queue, the device pairing, the cached menu, the parked sale,
 * the last receipt, the held sale, favorites, theme, medical test mode.
 * That works in Safari and it is the reason the PWA survives a reload.
 *
 * It does NOT work on a packaged iPad app, for two verified reasons:
 *
 *   1. DURABILITY. WebKit may evict Web-Storage for a WKWebView under storage
 *      pressure. The offline queue is the ONLY copy of a sale that has not
 *      reached the server yet. Losing it loses money AND breaks the CCRS
 *      reporting obligation for that sale. Native SQLite in the app container
 *      is not subject to that eviction.
 *   2. CONFIDENTIALITY. Two of the keys carry regulated data in PLAINTEXT
 *      right now: `gw-pos-queue` (a queued medical sale envelope embeds
 *      `medical.card.upid`) and `gw-pos-active-sale` (a parked medical sale
 *      stores the whole `PosCardCapture`, i.e. UPID + card dates). A UPID is
 *      the patient identifier from the DOH Medical Cannabis Registry; the
 *      standing DOH rules require us to PROTECT PHI, not leave it in a store
 *      that a backup or a forensic tool can read.
 *
 * This module owns the DECISIONS. It performs no I/O whatsoever — no
 * localStorage, no SQLite, no plugin imports — so every rule below is unit
 * testable and cannot drift from what the shell actually does.
 *
 * THE HARD CONSTRAINT THAT SHAPES THE WHOLE DESIGN
 * ------------------------------------------------
 * `RegisterShell.tsx` reads storage SYNCHRONOUSLY in 38 places
 * (`window.localStorage.getItem(...)` inside render and inside effects), and
 * `SaleFlow.tsx` in 4 more. Every native storage API in Capacitor is ASYNC.
 * Rewriting 42 call sites into promises would touch the money path, the
 * medical gate and the queue in one change — exactly the kind of edit that
 * breaks a register at the counter.
 *
 * So the seam presents a SYNCHRONOUS facade backed by an in-memory mirror
 * that is HYDRATED ONCE at boot, and every write goes to memory first (so the
 * next synchronous read is always correct) and is then flushed to the durable
 * backend. `plannedWrite()` and `hydrationPlan()` below are the pure rules for
 * that. This is the same discipline as `pos-fetch.ts`: one seam, all policy in
 * a tested core, the impure edge as thin as possible.
 */

// ---------------------------------------------------------------------------
// The key registry — one authoritative list
// ---------------------------------------------------------------------------
//
// Every one of these literals was read out of the live code, not invented:
//   gw-pos-device / gw-pos-queue / gw-pos-seq / gw-pos-menu  -> RegisterShell
//   gw-pos-active-sale  -> active-sale-resume-core.ACTIVE_SALE_KEY
//   gw-pos-last-receipt / gw-pos-held-sale -> register-polish-core
//   gw-pos-favorites -> favorites-core.FAVORITES_KEY
//   gw-pos-theme -> theme-core.THEME_KEY
//   gw-pos-medical-testmode -> medical-testmode-core.MEDICAL_TESTMODE_KEY
//   gw-pos-star-printer / gw-pos-star-printer-model -> star-printer

/** Shared prefix for every register storage key. */
export const POS_STORAGE_PREFIX = "gw-pos-";

/**
 * How bad is it if this value is LOST?
 *
 * - "critical": money or a compliance record. Must be on durable native
 *   storage before the app can be trusted offline. Losing it is unrecoverable.
 * - "important": the register still works without it, but a human notices
 *   immediately and a customer is inconvenienced (re-scan the ID, re-download
 *   the menu).
 * - "convenience": pure preference. Losing it costs one tap.
 */
export type PosDurability = "critical" | "important" | "convenience";

/**
 * Does this value contain data we are legally obliged to protect?
 *
 * - "phi": DOH-regulated patient data (a recognition-card UPID and its dates).
 *   Standing rules: protect PHI, audit access, never leave it in the clear.
 * - "secret": authenticates this device to the server. Anyone holding it can
 *   post sales as this register.
 * - "business": ordinary shop data (menu, prices, receipts). Not public, but
 *   not regulated the way the two above are.
 * - "none": preferences that reveal nothing.
 */
export type PosSensitivity = "phi" | "secret" | "business" | "none";

/** Where a value is allowed to live once the native app exists. */
export type PosStorageTier =
  /** Native encrypted database (SQLCipher) / localStorage on the web. */
  | "encrypted-db"
  /** OS keychain — tiny, high-value secrets only. */
  | "secure-enclave"
  /** Ordinary key/value. Fine for preferences. */
  | "preference";

export type PosStorageKeySpec = {
  /** The literal storage key, exactly as the shipping code uses it. */
  key: string;
  /** One line a non-engineer can understand. */
  what: string;
  durability: PosDurability;
  sensitivity: PosSensitivity;
  tier: PosStorageTier;
  /**
   * True when a partly-unreadable value must degrade instead of throwing.
   * Mirrors `parseQueue`'s droppedRows discipline in register-client-core.
   */
  degradesOnCorruption: boolean;
};

/**
 * THE registry. Adding a key to the register without adding it here is a bug
 * the tests below will catch (see `unregisteredKeys`).
 */
export const POS_STORAGE_KEYS: readonly PosStorageKeySpec[] = [
  {
    key: "gw-pos-queue",
    what: "Sales and events that have not reached the server yet.",
    durability: "critical",
    sensitivity: "phi", // a queued medical sale embeds medical.card.upid
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-seq",
    what: "The counter that keeps queued events in order.",
    durability: "critical",
    sensitivity: "business",
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-device",
    what: "This register's pairing with the server (id + key).",
    durability: "critical",
    sensitivity: "secret",
    tier: "secure-enclave",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-active-sale",
    what: "A sale parked when the screen locked, so the customer is not re-scanned.",
    durability: "important",
    sensitivity: "phi", // stores the whole PosCardCapture for a medical sale
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-held-sale",
    what: "A sale put on hold so another customer can be rung up.",
    durability: "important",
    sensitivity: "business",
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-menu",
    what: "The downloaded product menu, so the register can sell while offline.",
    durability: "important",
    sensitivity: "business",
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-last-receipt",
    what: "The last receipt, so it can be reprinted.",
    durability: "convenience",
    sensitivity: "business",
    tier: "encrypted-db",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-favorites",
    what: "Products pinned to this register's favorites page.",
    durability: "convenience",
    sensitivity: "none",
    tier: "preference",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-theme",
    what: "Dark or light screen for this register.",
    durability: "convenience",
    sensitivity: "none",
    tier: "preference",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-medical-testmode",
    what: "Whether this register is in medical test mode.",
    durability: "convenience",
    sensitivity: "none",
    tier: "preference",
    degradesOnCorruption: true,
  },
  {
    // SLICE 11, and a correction to SLICE 10.
    //
    // SLICE 10 stored the pairing under "pos.star.pairedPrinterIdentifier"
    // and never registered it here. Two things were therefore wrong:
    //
    //   1. plannedWrite() rejects any unregistered key, so EVERY write was
    //      refused. Verified by running SLICE 10's own pos-storage-core
    //      against that key: writeMemory false, writeDurable false, rejected
    //      "...is not a registered register storage key". The setup screen
    //      would have looked like it succeeded and the printer would have
    //      been forgotten on the next launch, silently dropping the register
    //      back to opening PassPRNT mid-sale.
    //   2. The name broke the POS_STORAGE_PREFIX rule audited below, so a
    //      bulk cleanup targeting the register's own keys would have missed it.
    //
    // Both are fixed by registering the value under a "gw-pos-" name. Because
    // the SLICE 10 write was always rejected, no installed iPad can be holding
    // a value under the old name, so this rename needs no migration.
    key: "gw-pos-star-printer",
    what: "Which Star receipt printer THIS iPad prints to, as an opaque StarXpand identifier.",
    durability: "convenience",
    sensitivity: "none",
    tier: "preference",
    degradesOnCorruption: true,
  },
  {
    key: "gw-pos-star-printer-model",
    what: "The model name of this iPad's paired receipt printer, shown on the setup screen.",
    durability: "convenience",
    sensitivity: "none",
    tier: "preference",
    degradesOnCorruption: true,
  },
] as const;

/** Look a key up in the registry. Null when it is not a known register key. */
export function findKeySpec(key: string): PosStorageKeySpec | null {
  return POS_STORAGE_KEYS.find((s) => s.key === key) ?? null;
}

/** Every registered key, in registry order. */
export function allStorageKeys(): string[] {
  return POS_STORAGE_KEYS.map((s) => s.key);
}

/**
 * Keys the register uses that nobody registered. The compliance test feeds
 * this the keys it greps out of the real shell source, so a new
 * `localStorage.setItem("gw-pos-something")` cannot land unnoticed.
 */
export function unregisteredKeys(keysInUse: readonly string[]): string[] {
  const known = new Set(allStorageKeys());
  const missing: string[] = [];
  for (const k of keysInUse) {
    if (!known.has(k) && !missing.includes(k)) missing.push(k);
  }
  return missing.sort();
}

/** Keys that must never be readable in the clear on a lost/stolen iPad. */
export function keysRequiringEncryption(): string[] {
  return POS_STORAGE_KEYS.filter((s) => s.sensitivity === "phi" || s.sensitivity === "secret").map((s) => s.key);
}

/** Keys whose loss costs money or a compliance record. */
export function criticalKeys(): string[] {
  return POS_STORAGE_KEYS.filter((s) => s.durability === "critical").map((s) => s.key);
}

// ---------------------------------------------------------------------------
// Tier policy — the rules that decide where a value is ALLOWED to live
// ---------------------------------------------------------------------------

export type TierProblem = { key: string; code: string; message: string };

/**
 * Audit the registry against the rules. Returns a problem list (empty = good).
 *
 * These are deliberately expressed as rules over the data rather than as a
 * hand-written expected list, so that a FUTURE key added with a careless tier
 * is caught by the same logic that guards today's twelve.
 */
export function auditKeyRegistry(specs: readonly PosStorageKeySpec[] = POS_STORAGE_KEYS): TierProblem[] {
  const problems: TierProblem[] = [];
  const seen = new Set<string>();

  for (const s of specs) {
    if (!s.key.startsWith(POS_STORAGE_PREFIX)) {
      problems.push({
        key: s.key,
        code: "prefix",
        message: `${s.key} does not start with ${POS_STORAGE_PREFIX}, so a bulk cleanup that targets the register's own keys would miss it.`,
      });
    }
    if (seen.has(s.key)) {
      problems.push({
        key: s.key,
        code: "duplicate",
        message: `${s.key} is registered twice, so two different rules could apply to the same value.`,
      });
    }
    seen.add(s.key);

    // A secret belongs in the keychain, nowhere else. The device key
    // authenticates every sale this register posts (GW-006).
    if (s.sensitivity === "secret" && s.tier !== "secure-enclave") {
      problems.push({
        key: s.key,
        code: "secret-tier",
        message: `${s.key} holds the credential that lets this device post sales, so it must live in the device keychain, not in ${s.tier}.`,
      });
    }
    // PHI must be encrypted at rest. The keychain is for small secrets, so
    // PHI belongs in the encrypted database.
    if (s.sensitivity === "phi" && s.tier !== "encrypted-db") {
      problems.push({
        key: s.key,
        code: "phi-tier",
        message: `${s.key} contains patient information from the medical card, so it must live in the encrypted database, not in ${s.tier}.`,
      });
    }
    // Anything whose loss is unrecoverable must be on durable storage.
    if (s.durability === "critical" && s.tier === "preference") {
      problems.push({
        key: s.key,
        code: "critical-tier",
        message: `${s.key} cannot be re-created if it is lost, so it must not live in ordinary preferences that the system may clear.`,
      });
    }
    // A preference-tier value must be harmless by definition.
    if (s.tier === "preference" && s.sensitivity !== "none") {
      problems.push({
        key: s.key,
        code: "preference-sensitivity",
        message: `${s.key} is stored as a plain preference but is marked ${s.sensitivity}; only data that reveals nothing may be stored that way.`,
      });
    }
    // Every stored value in this register is parsed from untrusted text at
    // boot. None of them may be allowed to throw the React tree down.
    if (!s.degradesOnCorruption) {
      problems.push({
        key: s.key,
        code: "must-degrade",
        message: `${s.key} must degrade to a safe empty value when it cannot be read, otherwise a single bad byte white-screens the register.`,
      });
    }
    if (s.what.trim().length < 20) {
      problems.push({
        key: s.key,
        code: "description",
        message: `${s.key} has no plain-English description of what it holds.`,
      });
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Hydration policy (boot)
// ---------------------------------------------------------------------------

/**
 * The order keys are loaded at boot. Critical first, then important, then
 * convenience: if hydration is interrupted (app killed during launch), the
 * values that matter are already in memory.
 */
export function hydrationPlan(specs: readonly PosStorageKeySpec[] = POS_STORAGE_KEYS): string[] {
  const rank: Record<PosDurability, number> = { critical: 0, important: 1, convenience: 2 };
  return [...specs]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank[a.s.durability] - rank[b.s.durability] || a.i - b.i)
    .map((x) => x.s.key);
}

/**
 * What the register may do before hydration has finished.
 *
 * Reading a not-yet-hydrated value would look exactly like "no saved value",
 * which for the queue would mean "no pending sales" — and the shell would
 * happily start a fresh queue and orphan real money. So the seam must report
 * that it is not ready, and the shell must wait.
 */
export type ReadinessVerdict = { ready: boolean; mayRing: boolean; message: string | null };

export function readinessVerdict(hydrated: boolean, failedKeys: readonly string[] = []): ReadinessVerdict {
  if (!hydrated) {
    return {
      ready: false,
      mayRing: false,
      message: "Still loading this register's saved data — do not start a sale yet.",
    };
  }
  const criticalFailed = failedKeys.filter((k) => criticalKeys().includes(k));
  if (criticalFailed.length > 0) {
    return {
      ready: true,
      mayRing: false,
      message:
        "This register could not read its saved sales queue or pairing. Do NOT ring sales on this device — call a manager. Ringing now risks losing sales that have not reached the server.",
    };
  }
  if (failedKeys.length > 0) {
    return {
      ready: true,
      mayRing: true,
      message: "Some saved settings on this register could not be read and were reset to their defaults.",
    };
  }
  return { ready: true, mayRing: true, message: null };
}

// ---------------------------------------------------------------------------
// Write policy
// ---------------------------------------------------------------------------

export type PlannedWrite = {
  /** Update the in-memory mirror so the next synchronous read is correct. */
  writeMemory: boolean;
  /** Also persist to the durable backend. */
  writeDurable: boolean;
  /** Remove rather than store (null/undefined value). */
  remove: boolean;
  /** Set when the CALLER passed something we refuse to store. */
  rejected: string | null;
};

/**
 * Decide what a `set(key, value)` actually does.
 *
 * Writing an unknown key is REFUSED rather than silently accepted: an
 * unregistered key has no durability or sensitivity rules, so on the native
 * build nobody would know whether it must be encrypted or may be evicted.
 * Failing loudly here is what keeps the registry honest.
 */
export function plannedWrite(key: string, value: string | null | undefined): PlannedWrite {
  const spec = findKeySpec(key);
  if (!spec) {
    return {
      writeMemory: false,
      writeDurable: false,
      remove: false,
      rejected: `${key} is not a registered register storage key. Add it to POS_STORAGE_KEYS with its durability and sensitivity before storing it.`,
    };
  }
  if (value === null || value === undefined) {
    return { writeMemory: true, writeDurable: true, remove: true, rejected: null };
  }
  return { writeMemory: true, writeDurable: true, remove: false, rejected: null };
}

// ---------------------------------------------------------------------------
// Quota / write-failure policy (GW-001, mirrors register-client-core)
// ---------------------------------------------------------------------------

/**
 * Plain-English alert for a durable write that FAILED, chosen by what the
 * value actually is. register-client-core already owns the two original
 * messages for the queue and the device pairing; this covers every key using
 * the registry so a new key cannot end up with a vague "storage error".
 */
export function writeFailureAlert(key: string): string {
  const spec = findKeySpec(key);
  if (!spec) {
    return "This register could not save something to disk. Call a manager before ringing more sales.";
  }
  if (spec.durability === "critical") {
    return `Register storage is full — "${spec.what}" could NOT be saved and would be lost if this device restarts. Call a manager and do not restart this device.`;
  }
  if (spec.durability === "important") {
    return `Register storage is full — "${spec.what}" could not be saved. The register still works, but that will not survive a restart.`;
  }
  return `This register could not save a setting ("${spec.what}"). It will go back to the default next time it starts.`;
}

/**
 * Is a durable-write failure allowed to block ringing sales?
 *
 * Only for the critical tier. A register that refuses to sell because the
 * theme could not be saved would be worse than the problem it reports.
 */
export function writeFailureBlocksSales(key: string): boolean {
  return findKeySpec(key)?.durability === "critical";
}

// ---------------------------------------------------------------------------
// Migration policy (PWA localStorage -> native durable storage)
// ---------------------------------------------------------------------------

export type MigrationDecision = {
  /** Copy this key's existing web value into the durable backend. */
  adopt: boolean;
  /** Erase the web copy after a successful adopt. */
  eraseSource: boolean;
  reason: string;
};

/**
 * First native boot on a device that already ran the PWA.
 *
 * Rules, in order:
 *  - Never overwrite a value the native store already has. The native copy is
 *    newer by definition (it was written by this app), and clobbering the
 *    queue with a stale web copy would resurrect already-synced sales.
 *  - Adopt anything the native store lacks: an unsynced queue on that iPad is
 *    real money, and there is no downside to importing a preference.
 *  - After adopting a value that must be encrypted, ERASE the plaintext web
 *    copy. Leaving a readable UPID or device key behind is precisely the
 *    exposure this phase exists to close.
 */
export function migrationDecision(args: {
  key: string;
  webValue: string | null | undefined;
  nativeValue: string | null | undefined;
}): MigrationDecision {
  const { key, webValue, nativeValue } = args;
  const spec = findKeySpec(key);
  if (!spec) {
    return { adopt: false, eraseSource: false, reason: `${key} is not a registered register key, so it is left alone.` };
  }
  if (webValue === null || webValue === undefined || webValue === "") {
    return { adopt: false, eraseSource: false, reason: "Nothing saved on the web side to bring over." };
  }
  if (nativeValue !== null && nativeValue !== undefined && nativeValue !== "") {
    return {
      adopt: false,
      eraseSource: false,
      reason: "The app already has its own copy, which is newer than the browser's — the browser copy is ignored.",
    };
  }
  const mustEncrypt = spec.sensitivity === "phi" || spec.sensitivity === "secret";
  return {
    adopt: true,
    eraseSource: mustEncrypt,
    reason: mustEncrypt
      ? "Brought over from the browser and the readable browser copy erased, because it holds protected information."
      : "Brought over from the browser because the app had no copy yet.",
  };
}

// ---------------------------------------------------------------------------
// Corruption degradation
// ---------------------------------------------------------------------------

export type CorruptionOutcome = {
  /** What the caller receives instead of the unreadable value. */
  value: null;
  /** Record the key as failed so readinessVerdict can speak up. */
  recordFailure: boolean;
  /** Wipe the unreadable bytes so the register stops re-reading them. */
  discardStored: boolean;
  message: string;
};

/**
 * What to do when a stored value cannot be read at all.
 *
 * We NEVER throw: `parseQueue` established the house rule that a bad blob
 * yields an empty result rather than an unmounted React tree. We DO discard
 * the unreadable bytes, because a value that failed to parse once will fail
 * every boot, and keeping it means the failure banner never clears.
 */
export function corruptionOutcome(key: string): CorruptionOutcome {
  const spec = findKeySpec(key);
  const what = spec ? spec.what : "a saved value";
  return {
    value: null,
    recordFailure: true,
    discardStored: true,
    message: `This register could not read ${what.charAt(0).toLowerCase()}${what.slice(1).replace(/\.$/, "")} and has reset it.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPosStorageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`pos-storage-core FAIL: ${label}`);
    }
  };

  // ---- registry integrity -------------------------------------------------
  {
    ok(POS_STORAGE_KEYS.length === 12, "the registry covers all twelve keys the register uses today");
    ok(
      POS_STORAGE_KEYS.some((s) => s.key === "gw-pos-star-printer"),
      "the paired receipt printer is registered, so the pairing can actually persist",
    );
    ok(auditKeyRegistry().length === 0, "the shipping registry has no policy problems");
    const keys = allStorageKeys();
    ok(new Set(keys).size === keys.length, "no key is registered twice");
    ok(
      keys.every((k) => k.startsWith(POS_STORAGE_PREFIX)),
      "every key carries the register prefix",
    );
    ok(
      POS_STORAGE_KEYS.every((s) => s.what.trim().length >= 20),
      "every key explains itself in plain English",
    );
  }

  // ---- the exact literals the shipping code uses ---------------------------
  {
    // These are asserted individually because a typo in ANY of them would
    // silently orphan real saved data on an upgrade.
    ok(findKeySpec("gw-pos-queue") !== null, "the offline queue key is registered");
    ok(findKeySpec("gw-pos-seq") !== null, "the sequence key is registered");
    ok(findKeySpec("gw-pos-device") !== null, "the device pairing key is registered");
    ok(findKeySpec("gw-pos-menu") !== null, "the cached menu key is registered");
    ok(findKeySpec("gw-pos-active-sale") !== null, "the parked sale key is registered");
    ok(findKeySpec("gw-pos-held-sale") !== null, "the held sale key is registered");
    ok(findKeySpec("gw-pos-last-receipt") !== null, "the last receipt key is registered");
    ok(findKeySpec("gw-pos-favorites") !== null, "the favorites key is registered");
    ok(findKeySpec("gw-pos-theme") !== null, "the theme key is registered");
    ok(findKeySpec("gw-pos-medical-testmode") !== null, "the medical test mode key is registered");
    ok(findKeySpec("gw-pos-nope") === null, "an unknown key is not pretended to exist");
    ok(findKeySpec("") === null, "the empty key is not a registered key");
  }

  // ---- sensitivity classification is the compliance-critical part ----------
  {
    const enc = keysRequiringEncryption();
    ok(enc.includes("gw-pos-queue"), "the queue must be encrypted (a queued medical sale carries the patient UPID)");
    ok(
      enc.includes("gw-pos-active-sale"),
      "the parked sale must be encrypted (it stores the whole medical card capture)",
    );
    ok(enc.includes("gw-pos-device"), "the device pairing must be encrypted");
    ok(!enc.includes("gw-pos-theme"), "a screen preference does not need encryption");
    ok(!enc.includes("gw-pos-favorites"), "pinned products do not need encryption");
    ok(findKeySpec("gw-pos-device")!.tier === "secure-enclave", "the device pairing goes to the keychain");
    ok(findKeySpec("gw-pos-queue")!.tier === "encrypted-db", "the queue goes to the encrypted database");
    ok(findKeySpec("gw-pos-active-sale")!.tier === "encrypted-db", "the parked sale goes to the encrypted database");
  }

  // ---- durability classification ------------------------------------------
  {
    const crit = criticalKeys();
    ok(crit.includes("gw-pos-queue"), "unsynced sales are critical");
    ok(crit.includes("gw-pos-seq"), "the ordering counter is critical");
    ok(crit.includes("gw-pos-device"), "the pairing is critical");
    ok(!crit.includes("gw-pos-menu"), "the menu is re-downloadable, so it is not critical");
    ok(!crit.includes("gw-pos-theme"), "a preference is never critical");
    ok(crit.length === 3, "exactly three values are unrecoverable if lost");
  }

  // ---- the audit actually catches bad policy (not just a passing list) -----
  {
    const base = findKeySpec("gw-pos-device")!;
    const secretInPrefs = auditKeyRegistry([{ ...base, tier: "preference" }]);
    ok(
      secretInPrefs.some((p) => p.code === "secret-tier"),
      "a device credential in plain preferences is rejected",
    );
    const phi = findKeySpec("gw-pos-queue")!;
    ok(
      auditKeyRegistry([{ ...phi, tier: "preference" }]).some((p) => p.code === "phi-tier"),
      "patient data in plain preferences is rejected",
    );
    ok(
      auditKeyRegistry([{ ...phi, sensitivity: "none", tier: "preference" }]).some(
        (p) => p.code === "critical-tier",
      ),
      "an unrecoverable value in clearable preferences is rejected",
    );
    ok(
      auditKeyRegistry([{ ...base, key: "device", tier: "secure-enclave" }]).some((p) => p.code === "prefix"),
      "a key without the register prefix is rejected",
    );
    ok(
      auditKeyRegistry([base, base]).some((p) => p.code === "duplicate"),
      "the same key registered twice is rejected",
    );
    ok(
      auditKeyRegistry([{ ...base, degradesOnCorruption: false }]).some((p) => p.code === "must-degrade"),
      "a key that would throw on bad data is rejected",
    );
    const themeSpec = findKeySpec("gw-pos-theme")!;
    ok(
      auditKeyRegistry([{ ...themeSpec, sensitivity: "business" }]).some(
        (p) => p.code === "preference-sensitivity",
      ),
      "real data stored as a throwaway preference is rejected",
    );
    ok(auditKeyRegistry([]).length === 0, "an empty registry has nothing to complain about");
  }

  // ---- unregistered-key detection -----------------------------------------
  {
    ok(unregisteredKeys([]).length === 0, "no keys in use means nothing unregistered");
    ok(unregisteredKeys(allStorageKeys()).length === 0, "the real key set is fully registered");
    ok(
      unregisteredKeys(["gw-pos-queue", "gw-pos-secret-new"]).join() === "gw-pos-secret-new",
      "a brand new key is reported",
    );
    ok(
      unregisteredKeys(["gw-pos-a", "gw-pos-a"]).length === 1,
      "the same unknown key twice is reported once",
    );
    ok(
      unregisteredKeys(["gw-pos-z", "gw-pos-a"]).join() === "gw-pos-a,gw-pos-z",
      "unknown keys come back sorted so the message is stable",
    );
  }

  // ---- hydration order ----------------------------------------------------
  {
    const plan = hydrationPlan();
    ok(plan.length === POS_STORAGE_KEYS.length, "every key is hydrated");
    ok(new Set(plan).size === plan.length, "no key is hydrated twice");
    const idx = (k: string) => plan.indexOf(k);
    ok(idx("gw-pos-queue") < idx("gw-pos-menu"), "unsynced sales load before the menu");
    ok(idx("gw-pos-device") < idx("gw-pos-theme"), "the pairing loads before a preference");
    ok(idx("gw-pos-seq") < idx("gw-pos-favorites"), "the ordering counter loads before favorites");
    const rank = (k: string) => ({ critical: 0, important: 1, convenience: 2 })[findKeySpec(k)!.durability];
    let sorted = true;
    for (let i = 1; i < plan.length; i += 1) if (rank(plan[i]!) < rank(plan[i - 1]!)) sorted = false;
    ok(sorted, "the plan is ordered by how badly the value is needed");
    ok(hydrationPlan([]).length === 0, "an empty registry yields an empty plan");
    // Stability: equal-rank keys keep registry order, so the plan is deterministic.
    ok(hydrationPlan().join() === hydrationPlan().join(), "the plan is deterministic");
  }

  // ---- readiness ----------------------------------------------------------
  {
    const cold = readinessVerdict(false);
    ok(!cold.ready && !cold.mayRing, "before loading finishes the register may not ring a sale");
    ok((cold.message ?? "").length > 20, "the not-ready message explains itself");

    const good = readinessVerdict(true, []);
    ok(good.ready && good.mayRing && good.message === null, "a clean boot is silent");

    const lostQueue = readinessVerdict(true, ["gw-pos-queue"]);
    ok(lostQueue.ready && !lostQueue.mayRing, "an unreadable sales queue stops sales");
    ok((lostQueue.message ?? "").includes("call a manager") || (lostQueue.message ?? "").includes("manager"),
      "the blocking message tells the budtender to get a manager");

    const lostPref = readinessVerdict(true, ["gw-pos-theme"]);
    ok(lostPref.ready && lostPref.mayRing, "an unreadable preference never stops sales");
    ok(lostPref.message !== null, "an unreadable preference is still reported");

    ok(!readinessVerdict(true, ["gw-pos-device"]).mayRing, "an unreadable pairing stops sales");
    ok(!readinessVerdict(true, ["gw-pos-theme", "gw-pos-seq"]).mayRing, "one critical failure is enough to stop sales");
    ok(readinessVerdict(true, ["gw-pos-menu"]).mayRing, "a lost menu cache does not stop sales");
    ok(!readinessVerdict(false, ["gw-pos-theme"]).ready, "not-hydrated wins over any failure list");
  }

  // ---- write policy -------------------------------------------------------
  {
    const w = plannedWrite("gw-pos-queue", "{}");
    ok(w.writeMemory && w.writeDurable && !w.remove && w.rejected === null, "a normal write goes to memory and disk");

    const del = plannedWrite("gw-pos-queue", null);
    ok(del.remove && del.writeMemory && del.writeDurable, "a null value removes the key everywhere");
    ok(plannedWrite("gw-pos-queue", undefined).remove, "undefined removes too");

    const bad = plannedWrite("gw-pos-unknown", "x");
    ok(!bad.writeMemory && !bad.writeDurable, "an unregistered key is never written");
    ok((bad.rejected ?? "").includes("POS_STORAGE_KEYS"), "the rejection says exactly how to fix it");

    // Empty string is a REAL value (e.g. a deliberately blank setting) and
    // must be stored, not treated as a delete.
    const empty = plannedWrite("gw-pos-theme", "");
    ok(!empty.remove && empty.writeMemory, "an empty string is stored, not treated as a delete");
  }

  // ---- write-failure messaging -------------------------------------------
  {
    ok(writeFailureBlocksSales("gw-pos-queue"), "failing to save the queue blocks sales");
    ok(writeFailureBlocksSales("gw-pos-device"), "failing to save the pairing blocks sales");
    ok(!writeFailureBlocksSales("gw-pos-theme"), "failing to save the theme does not block sales");
    ok(!writeFailureBlocksSales("gw-pos-menu"), "failing to save the menu does not block sales");
    ok(!writeFailureBlocksSales("gw-pos-unknown"), "an unknown key does not block sales");

    ok(writeFailureAlert("gw-pos-queue").includes("restart"), "the critical alert warns about restarting");
    ok(writeFailureAlert("gw-pos-queue").includes("manager"), "the critical alert escalates to a manager");
    ok(!writeFailureAlert("gw-pos-theme").includes("manager"), "a preference failure does not cry wolf");
    ok(writeFailureAlert("gw-pos-unknown").length > 20, "even an unknown key gets a real sentence");
    ok(
      POS_STORAGE_KEYS.every((s) => writeFailureAlert(s.key).length > 30),
      "every registered key has a real failure message",
    );
    ok(
      POS_STORAGE_KEYS.every((s) => !/\b(localStorage|SQLite|SQLCipher|quota|exception)\b/i.test(writeFailureAlert(s.key))),
      "no failure message leaks engineering jargon at the counter",
    );
  }

  // ---- migration ----------------------------------------------------------
  {
    const fresh = migrationDecision({ key: "gw-pos-queue", webValue: '{"v":1}', nativeValue: null });
    ok(fresh.adopt, "an unsynced queue left in the browser is brought over");
    ok(fresh.eraseSource, "and the readable browser copy is erased because it holds patient data");

    const already = migrationDecision({ key: "gw-pos-queue", webValue: '{"v":1}', nativeValue: '{"v":2}' });
    ok(!already.adopt, "the app's own queue is never overwritten by the browser's");
    ok(!already.eraseSource, "and nothing is erased when nothing was adopted");

    ok(!migrationDecision({ key: "gw-pos-queue", webValue: null, nativeValue: null }).adopt, "nothing to adopt");
    ok(!migrationDecision({ key: "gw-pos-queue", webValue: "", nativeValue: null }).adopt, "empty is nothing to adopt");
    ok(
      migrationDecision({ key: "gw-pos-queue", webValue: "x", nativeValue: "" }).adopt,
      "an empty native value counts as absent, so the browser copy IS adopted",
    );

    const dev = migrationDecision({ key: "gw-pos-device", webValue: "{}", nativeValue: null });
    ok(dev.adopt && dev.eraseSource, "the device pairing is moved out of the browser and erased there");

    const theme = migrationDecision({ key: "gw-pos-theme", webValue: "dark", nativeValue: null });
    ok(theme.adopt, "a preference is brought over");
    ok(!theme.eraseSource, "but a harmless preference is not worth erasing");

    const unknown = migrationDecision({ key: "gw-pos-nope", webValue: "x", nativeValue: null });
    ok(!unknown.adopt && !unknown.eraseSource, "an unregistered key is left alone entirely");
    ok(
      POS_STORAGE_KEYS.filter((s) => s.sensitivity === "phi" || s.sensitivity === "secret").every(
        (s) => migrationDecision({ key: s.key, webValue: "v", nativeValue: null }).eraseSource,
      ),
      "EVERY protected value is erased from the browser after being brought over",
    );
    ok(
      POS_STORAGE_KEYS.every((s) => migrationDecision({ key: s.key, webValue: "v", nativeValue: null }).reason.length > 20),
      "every migration decision explains itself",
    );
  }

  // ---- corruption ---------------------------------------------------------
  {
    const c = corruptionOutcome("gw-pos-queue");
    ok(c.value === null, "an unreadable value reads back as nothing rather than throwing");
    ok(c.recordFailure, "the failure is recorded so the banner can appear");
    ok(c.discardStored, "the unreadable bytes are thrown away so the warning can clear");
    ok(c.message.length > 20, "the corruption message is a real sentence");
    ok(corruptionOutcome("gw-pos-unknown").value === null, "an unknown key degrades the same safe way");
    ok(
      POS_STORAGE_KEYS.every((s) => corruptionOutcome(s.key).discardStored),
      "no key is left in a permanently unreadable state",
    );
  }

  return { passed, failed };
}
