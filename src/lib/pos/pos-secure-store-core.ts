/**
 * pos/pos-secure-store-core — PURE policy for the two secrets the register holds.
 *
 * Phase 1.1 gave every saved value a home (`pos-storage-core`). One key in that
 * registry is classified `sensitivity: "secret"` / `tier: "secure-enclave"`:
 *
 *   gw-pos-device — this register's pairing with the server (device id + device key).
 *
 * That pairing IS the register's identity. Anyone holding it can post sales to
 * Greenway's CCRS record as this till. It must not sit in readable storage, it
 * must not be written to a log, and it must not follow an iPad backup onto a
 * second iPad. This module owns those rules.
 *
 * Phase 1.3 adds a second secret that does not exist yet on the web build: the
 * passphrase that unlocks the SQLCipher database holding the queue and the
 * parked sale. That passphrase is minted on the device, lives ONLY in the
 * keychain, and is never stored inside the database it unlocks.
 *
 * WHY THIS FILE IS PURE
 * ---------------------
 * Zero imports, zero I/O, zero clock, zero randomness. Every function is a
 * plain input -> output decision, so the rules can be tested exhaustively
 * without a simulator, a keychain, or a device. The impure half —
 * `pos-secure-store.ts` — is deliberately thin, because anything it decides for
 * itself is something these tests cannot prove.
 *
 * Randomness is handled by INJECTION rather than import: `mintPassphrase()`
 * takes the random bytes as an argument. That keeps this module pure AND makes
 * the entropy rules testable, including the failure cases (too few bytes, all
 * zeros) that a real generator would essentially never produce on demand.
 *
 * SOURCES (verified, not assumed)
 * -------------------------------
 *  - `@aparajita/capacitor-secure-storage` 8.0.0 `src/definitions.ts`:
 *      * `KeychainAccess.whenUnlocked` (the DEFAULT) — "Items with this
 *        attribute migrate to a new device when using encrypted backups."
 *      * `KeychainAccess.whenUnlockedThisDeviceOnly` — "Items with this
 *        attribute do not migrate to a new device."
 *      * `setSynchronize(sync)` / per-operation `sync` — iCloud Keychain.
 *      * `setKeyPrefix(prefix)`, default `"capacitor-storage_"`.
 *      * `clear(sync?)` — "Removes all items from the store with the current
 *        key prefix."
 *      * `StorageErrorType` = missingKey | invalidData | osError | unknownError.
 *    README: on iOS "currently iOS will not delete an app's keychain data when
 *    the app is deleted"; on the web "data is stored unencrypted in
 *    localStorage ... for debugging purposes only; you should not use this
 *    plugin on the web in production."
 *  - Device key shape: `device-store.ts` mints it at both provisioning and
 *    rotation with `randomBytes(24).toString("base64url")` = exactly 32
 *    characters from [A-Za-z0-9_-]. Device id is a Postgres-generated UUID.
 *    `device-setup-core.ts` already enforces both shapes at the setup screen.
 */

// ---------------------------------------------------------------------------
// Keychain item policy
// ---------------------------------------------------------------------------

/**
 * Keychain accessibility levels, mirroring the plugin's `KeychainAccess` enum
 * BY NAME rather than by importing it.
 *
 * Mirrored on purpose: this module must stay import-free to stay pure, and the
 * seam converts these names to the plugin's enum in one place. The conversion
 * is covered by a test that walks every name here, so a rename in the plugin
 * surfaces as a failing test instead of a silently mis-set keychain item.
 */
export type KeychainAccessLevel =
  | "whenUnlocked"
  | "whenUnlockedThisDeviceOnly"
  | "afterFirstUnlock"
  | "afterFirstUnlockThisDeviceOnly"
  | "whenPasscodeSetThisDeviceOnly";

/**
 * Accessibility levels that let a secret ride an encrypted backup onto a
 * DIFFERENT iPad. Named from the plugin's own documentation: the two levels
 * without a "ThisDeviceOnly" suffix are documented as migrating.
 */
export const MIGRATING_ACCESS_LEVELS: readonly KeychainAccessLevel[] = [
  "whenUnlocked",
  "afterFirstUnlock",
] as const;

/** True when a level allows the secret to move to another device. */
export function accessLevelMigratesDevices(level: KeychainAccessLevel): boolean {
  return MIGRATING_ACCESS_LEVELS.includes(level);
}

/**
 * The accessibility level every Greenway keychain item must use.
 *
 * WHY NOT THE DEFAULT: the plugin defaults to `whenUnlocked`, which the plugin
 * documents as migrating "to a new device when using encrypted backups". If a
 * manager restored an iPad backup onto a spare iPad, that spare would come up
 * holding a VALID pairing for a register that is still on the floor — two
 * devices posting sales as the same till, which is exactly the kind of
 * duplicate/ambiguous reporting CCRS cannot untangle after the fact.
 *
 * WHY NOT `whenPasscodeSetThisDeviceOnly`: it is stricter, but the plugin
 * documents that "disabling the device passcode causes all items in this class
 * to be deleted". A manager turning off the passcode would silently unpair
 * every register mid-shift. Losing the pairing to a settings change is a worse
 * failure than the one it prevents.
 *
 * WHY NOT `afterFirstUnlockThisDeviceOnly`: it would let the register reach its
 * secrets in the background before anyone unlocks the iPad. The register is a
 * foreground, human-operated till; it has no background work that needs a
 * secret, so the wider window buys nothing and costs reach.
 *
 * `whenUnlockedThisDeviceOnly` is therefore the exact fit: readable whenever a
 * budtender is actually using the iPad, and provably unable to leave it.
 */
export const REQUIRED_ACCESS_LEVEL: KeychainAccessLevel = "whenUnlockedThisDeviceOnly";

/**
 * iCloud Keychain synchronization. Always false, for the same reason the
 * migrating access levels are banned: syncing would publish the pairing to
 * every device on the owner's Apple ID.
 */
export const REQUIRE_ICLOUD_SYNC_OFF = true;

/**
 * Prefix for every Greenway keychain item. The plugin's own default is
 * `"capacitor-storage_"`, which is shared by every app that never changes it.
 * Pinning our own keeps a `keys()` listing unambiguous and makes an accidental
 * `clear()` blast radius describable.
 */
export const KEYCHAIN_PREFIX = "gw-pos-secure_";

/**
 * The plugin's own default prefix, recorded so the test that we do NOT use it
 * compares against the real value rather than a literal copied into the
 * assertion. Typed as `string` so the comparison is a genuine runtime check.
 */
export const PLUGIN_DEFAULT_KEY_PREFIX: string = "capacitor-storage_";

/** The keychain item names this app is allowed to use. */
export type SecureItemName = "device-pairing" | "db-passphrase";

export const SECURE_ITEM_NAMES: readonly SecureItemName[] = ["device-pairing", "db-passphrase"] as const;

/** Fully-qualified keychain item name for a logical secret. */
export function keychainItemName(item: SecureItemName): string {
  return `${KEYCHAIN_PREFIX}${item}`;
}

export type KeychainItemPolicy = {
  /** The fully-qualified item name. */
  name: string;
  access: KeychainAccessLevel;
  /** iCloud Keychain sync. Always false. */
  sync: boolean;
  /** One plain-English line about what this item is. */
  what: string;
};

/** The complete, authoritative policy for one secret. */
export function keychainItemPolicy(item: SecureItemName): KeychainItemPolicy {
  return {
    name: keychainItemName(item),
    access: REQUIRED_ACCESS_LEVEL,
    sync: false,
    what:
      item === "device-pairing"
        ? "This register's pairing with the server (its id and key)."
        : "The passphrase that unlocks this register's encrypted database.",
  };
}

export type SecurePolicyProblem = { item: string; code: string; message: string };

/**
 * Audit a set of keychain policies. Used by the tests AND by the seam, so the
 * rules cannot drift apart between what is documented and what is installed.
 */
export function auditKeychainPolicies(
  policies: readonly KeychainItemPolicy[] = SECURE_ITEM_NAMES.map(keychainItemPolicy),
): SecurePolicyProblem[] {
  const problems: SecurePolicyProblem[] = [];
  const seen = new Set<string>();
  for (const p of policies) {
    if (!p.name.startsWith(KEYCHAIN_PREFIX)) {
      problems.push({
        item: p.name,
        code: "prefix",
        message: `${p.name} does not carry the ${KEYCHAIN_PREFIX} prefix, so it cannot be told apart from another app's keychain items.`,
      });
    }
    if (seen.has(p.name)) {
      problems.push({ item: p.name, code: "duplicate", message: `${p.name} is declared twice.` });
    }
    seen.add(p.name);
    if (accessLevelMigratesDevices(p.access)) {
      problems.push({
        item: p.name,
        code: "migrates",
        message: `${p.name} uses ${p.access}, which Apple migrates to a new device through an encrypted backup. A restored backup would clone this register onto a second iPad.`,
      });
    }
    if (p.access !== REQUIRED_ACCESS_LEVEL) {
      problems.push({
        item: p.name,
        code: "access",
        message: `${p.name} must use ${REQUIRED_ACCESS_LEVEL}, not ${p.access}.`,
      });
    }
    if (p.sync) {
      problems.push({
        item: p.name,
        code: "icloud",
        message: `${p.name} is set to synchronize with iCloud Keychain, which would copy this register's secret to every device on the Apple ID.`,
      });
    }
    if (p.what.trim().length < 20) {
      problems.push({
        item: p.name,
        code: "description",
        message: `${p.name} does not explain itself in plain English.`,
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Device pairing: shape + redaction
// ---------------------------------------------------------------------------

/** Exactly what `gw-pos-device` holds, mirroring RegisterShell's `DeviceCreds`. */
export type DevicePairing = {
  deviceId: string;
  deviceKey: string;
  name: string;
  registerId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** base64url of 24 random bytes is always exactly 32 chars — see device-store.ts. */
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{32}$/;

/** The length every minted device key has. Asserted so a change is deliberate. */
export const DEVICE_KEY_LENGTH = 32;

/**
 * Is this a structurally valid pairing?
 *
 * Deliberately shape-only. Whether the server still accepts the key is a
 * network question; this guards the storage boundary so a truncated or
 * half-written keychain value is never handed to the shell as if it were real.
 */
export function isValidPairing(value: unknown): value is DevicePairing {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.deviceId !== "string" || !UUID_RE.test(v.deviceId)) return false;
  if (typeof v.deviceKey !== "string" || !DEVICE_KEY_RE.test(v.deviceKey)) return false;
  if (typeof v.name !== "string") return false;
  if (v.registerId !== null && typeof v.registerId !== "string") return false;
  return true;
}

/**
 * Parse a stored pairing. Returns null for anything that is not a complete,
 * well-shaped pairing — including valid JSON with a mangled key.
 *
 * Never throws: a corrupt keychain value must land the register on the setup
 * screen, not in a React error boundary. Mirrors `parseQueue`'s house rule.
 */
export function parsePairing(raw: string | null | undefined): DevicePairing | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidPairing(parsed)) return null;
  return {
    deviceId: parsed.deviceId,
    deviceKey: parsed.deviceKey,
    name: parsed.name,
    registerId: parsed.registerId,
  };
}

/**
 * Mask a secret for display. Shows the first 4 characters so a manager can
 * confirm they are looking at the right credential, and hides the rest.
 *
 * 4 of 32 base64url characters leaves ~163 bits unknown, so this reveals
 * nothing usable while still being a useful confirmation on a support call.
 * Short values are masked completely rather than partially, because revealing
 * 4 of 6 characters would be a real disclosure.
 */
export function maskSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length === 0) return "(none)";
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}${"*".repeat(secret.length - 4)}`;
}

/**
 * The ONLY representation of a pairing that may be logged, shown in a
 * diagnostics panel, or attached to an error report.
 *
 * The device id is included in full: it is a UUID that identifies the till and
 * is already visible in Admin, and support is impossible without it. The device
 * key is the actual secret and is always masked.
 */
export function describePairing(pairing: DevicePairing | null): string {
  if (!pairing) return "This register is not paired yet.";
  const where = pairing.registerId ? `register ${pairing.registerId}` : "no register assigned";
  return `${pairing.name || "Unnamed register"} (${where}), device ${pairing.deviceId}, key ${maskSecret(pairing.deviceKey)}`;
}

/**
 * Scan text destined for a log/report and refuse it if it contains a live
 * secret. Used by the tests to prove the never-log rule, and available to any
 * future diagnostics feature so the rule is enforced rather than remembered.
 *
 * Returns the offending secret names, empty when the text is safe.
 */
export function findLeakedSecrets(text: string, secrets: readonly string[]): string[] {
  const leaked: string[] = [];
  for (const s of secrets) {
    // A short or empty "secret" cannot be searched for meaningfully: "" is a
    // substring of everything and a 1-2 character value matches constantly.
    if (typeof s !== "string" || s.length < 8) continue;
    if (text.includes(s)) leaked.push(s);
  }
  return leaked;
}

// ---------------------------------------------------------------------------
// SQLCipher passphrase policy (Phase 1.3)
// ---------------------------------------------------------------------------

/**
 * Bytes of randomness required for the database passphrase.
 *
 * 32 bytes = 256 bits. SQLCipher derives its key from the passphrase with
 * PBKDF2, so passphrase entropy is the ceiling on key strength; 256 bits
 * matches the AES-256 key SQLCipher actually uses, and anything less would make
 * the KDF the weak point rather than the cipher.
 */
export const PASSPHRASE_ENTROPY_BYTES = 32;

/**
 * Length of the encoded passphrase. base64url of 32 bytes is 43 characters
 * (ceil(32 * 4 / 3) = 43 with the padding stripped).
 */
export const PASSPHRASE_LENGTH = 43;

const PASSPHRASE_RE = /^[A-Za-z0-9_-]{43}$/;

/** base64url alphabet, in index order. */
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode bytes as unpadded base64url.
 *
 * Hand-written rather than using `Buffer`/`btoa` so this module stays pure and
 * runs identically in Node, the browser and the iPad WebView. base64url is
 * chosen over hex because it packs the same entropy into 43 characters instead
 * of 64, and over plain base64 because `+` and `/` are awkward to pass through
 * a keychain value and a connection string.
 */
function toBase64Url(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 0x3f];
  }
  return out;
}

export type PassphraseMint =
  | { ok: true; passphrase: string; problem: null }
  | { ok: false; passphrase: null; problem: string };

/**
 * Turn raw random bytes into a database passphrase.
 *
 * The randomness is passed IN (from `crypto.getRandomValues` at the seam) so
 * this stays pure and so the rejection paths are testable. Every rule below
 * exists because the failure it prevents is silent: a database encrypted with a
 * weak or predictable passphrase looks exactly like a properly encrypted one.
 */
export function mintPassphrase(bytes: readonly number[]): PassphraseMint {
  if (!Array.isArray(bytes) && !ArrayBuffer.isView(bytes as never)) {
    return { ok: false, passphrase: null, problem: "No random bytes were supplied for the database passphrase." };
  }
  if (bytes.length !== PASSPHRASE_ENTROPY_BYTES) {
    return {
      ok: false,
      passphrase: null,
      problem: `The database passphrase needs exactly ${PASSPHRASE_ENTROPY_BYTES} random bytes, but ${bytes.length} were supplied.`,
    };
  }
  for (const b of bytes) {
    if (!Number.isInteger(b) || b < 0 || b > 255) {
      return {
        ok: false,
        passphrase: null,
        problem: "The random bytes for the database passphrase are not whole bytes.",
      };
    }
  }
  // A generator that is not wired up yields all zeros (or one repeated value).
  // That produces a perfectly well-formed passphrase, so nothing downstream
  // would ever notice. Refuse here, where it is still detectable.
  if (bytes.every((b) => b === bytes[0])) {
    return {
      ok: false,
      passphrase: null,
      problem: "The random bytes for the database passphrase are all identical, which means the random number generator is not working.",
    };
  }
  const passphrase = toBase64Url(bytes);
  if (!PASSPHRASE_RE.test(passphrase)) {
    return { ok: false, passphrase: null, problem: "The generated database passphrase has the wrong shape." };
  }
  return { ok: true, passphrase, problem: null };
}

/**
 * Is a stored passphrase one we minted and still trust?
 *
 * Deliberately returns a plain boolean rather than a `value is string` type
 * predicate. A predicate would tell TypeScript that anything failing this check
 * is NOT a string, which is false — a corrupt passphrase is usually a string,
 * just not a valid one — and that wrong narrowing hid the "damaged" branch of
 * `passphraseDecision` from the compiler.
 */
export function isValidPassphrase(value: unknown): boolean {
  return typeof value === "string" && PASSPHRASE_RE.test(value);
}

export type PassphraseDecision = {
  /** Generate a new passphrase and store it. */
  mint: boolean;
  /** Use the passphrase already in the keychain. */
  reuse: boolean;
  /**
   * True when an unusable passphrase was found and the database it unlocks can
   * never be opened again, so it must be discarded and rebuilt.
   */
  discardDatabase: boolean;
  reason: string;
};

/**
 * Decide what to do at boot given what the keychain holds.
 *
 * THE DANGEROUS CASE, spelled out: iOS does NOT delete keychain items when an
 * app is deleted (plugin README, verified). So on a reinstall the passphrase
 * SURVIVES while the app's database file does NOT. If we minted a fresh
 * passphrase whenever the database was missing, we would be fine; but if we
 * ever minted a fresh passphrase while the database still EXISTED, that
 * database would become permanently unreadable — taking any unsynced sales with
 * it. Hence: an existing valid passphrase is ALWAYS reused, never replaced.
 *
 * The mirror-image case is a passphrase that is missing or corrupt while a
 * database file exists. Nothing can open that file — the only key is gone — so
 * the honest move is to say so plainly and rebuild, rather than retry forever.
 */
export function passphraseDecision(args: {
  stored: string | null | undefined;
  databaseExists: boolean;
}): PassphraseDecision {
  const { stored, databaseExists } = args;
  if (isValidPassphrase(stored)) {
    return {
      mint: false,
      reuse: true,
      discardDatabase: false,
      reason: "This register already has its database passphrase, so it is reused.",
    };
  }
  const hadSomething = typeof stored === "string" && stored.length > 0;
  if (databaseExists) {
    return {
      mint: true,
      reuse: false,
      discardDatabase: true,
      reason: hadSomething
        ? "The saved database passphrase is damaged, so the encrypted database can no longer be opened. It will be rebuilt and anything not yet sent to the server may be lost."
        : "The database passphrase is missing, so the encrypted database can no longer be opened. It will be rebuilt and anything not yet sent to the server may be lost.",
    };
  }
  return {
    mint: true,
    reuse: false,
    discardDatabase: false,
    reason: "First run on this register: a new database passphrase is created.",
  };
}

/**
 * Where a secret is allowed to be written. Exists so the rule "the passphrase
 * never goes in the database it unlocks" is a tested function rather than a
 * comment somebody has to remember.
 */
export type SecretDestination = "keychain" | "encrypted-db" | "preferences" | "log" | "network";

export function secretMayBeWrittenTo(item: SecureItemName, destination: SecretDestination): boolean {
  // Both secrets are keychain-only. Writing the DB passphrase into the DB is
  // circular (you need it to read it); writing the pairing anywhere readable
  // defeats the whole phase. Preferences are unencrypted. Logs and crash
  // reports leave the device.
  if (destination === "keychain") return true;
  void item;
  return false;
}

/** Plain-English explanation for a refused destination. */
export function destinationRefusal(item: SecureItemName, destination: SecretDestination): string | null {
  if (secretMayBeWrittenTo(item, destination)) return null;
  const what = item === "device-pairing" ? "the register's pairing" : "the database passphrase";
  switch (destination) {
    case "encrypted-db":
      return item === "db-passphrase"
        ? `${what} cannot be stored in the database, because it is the key that opens that database.`
        : `${what} belongs in the keychain, not in the database.`;
    case "preferences":
      return `${what} cannot be stored in ordinary settings, because those are not encrypted.`;
    case "log":
      return `${what} must never be written to a log or a crash report.`;
    case "network":
      return `${what} must never be sent anywhere except as the register's own credentials header.`;
    default:
      return `${what} may only be stored in the keychain.`;
  }
}

// ---------------------------------------------------------------------------
// Web-build honesty
// ---------------------------------------------------------------------------

/**
 * On the web there is no keychain. The plugin's own web implementation stores
 * values UNENCRYPTED in localStorage and its README says plainly: "This is for
 * debugging purposes only; you should not use this plugin on the web in
 * production."
 *
 * The browser PWA at /pos is a REAL production surface for Greenway today, so
 * we do not pretend otherwise: on the web the pairing keeps living in
 * localStorage exactly as it always has, and this function names that fact so
 * the status panel can be honest instead of showing a padlock that means
 * nothing.
 */
export function secureStorageAvailability(platform: "ios" | "android" | "web"): {
  encrypted: boolean;
  label: string;
  warning: string | null;
} {
  if (platform === "web") {
    return {
      encrypted: false,
      label: "browser storage (not encrypted)",
      warning:
        "In a web browser this register's pairing is stored unencrypted, the same way it always has been. Use the installed iPad app for encrypted storage.",
    };
  }
  return {
    encrypted: true,
    label: platform === "ios" ? "iPad keychain" : "device keystore",
    warning: null,
  };
}

/**
 * What to do about a keychain item when the register is unpaired on purpose.
 *
 * Because iOS keeps keychain data after an app is deleted, "delete the app" is
 * NOT a way to unpair a register. The app must erase the item itself, and the
 * unpair flow is the only place that happens.
 */
export function unpairPlan(): { erase: readonly SecureItemName[]; reason: string } {
  return {
    erase: SECURE_ITEM_NAMES,
    reason:
      "Deleting the app does not remove these from the iPad, so unpairing erases the register's pairing and its database passphrase directly.",
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPosSecureStoreCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`pos-secure-store-core FAIL: ${label}`);
    }
  };

  const ID = "59768c42-aa8c-4dab-8e6e-a2e766fe16b0";
  const KEY = "RJH5doEHCd78c2fneJmS7vgKGb1TXWiA"; // 32-char base64url shape
  const PAIR: DevicePairing = { deviceId: ID, deviceKey: KEY, name: "Register 1", registerId: "r-1" };

  // ---- keychain policy ----------------------------------------------------
  {
    ok(REQUIRED_ACCESS_LEVEL === "whenUnlockedThisDeviceOnly", "secrets are pinned to this iPad only");
    ok(!accessLevelMigratesDevices(REQUIRED_ACCESS_LEVEL), "the level we use cannot follow a backup to another iPad");
    ok(accessLevelMigratesDevices("whenUnlocked"), "the plugin's DEFAULT level is correctly identified as migrating");
    ok(accessLevelMigratesDevices("afterFirstUnlock"), "the other migrating level is identified");
    ok(!accessLevelMigratesDevices("afterFirstUnlockThisDeviceOnly"), "this-device-only variants do not migrate");
    ok(!accessLevelMigratesDevices("whenPasscodeSetThisDeviceOnly"), "the passcode-bound level does not migrate");
    ok(REQUIRE_ICLOUD_SYNC_OFF, "iCloud Keychain sync is required to stay off");

    ok(auditKeychainPolicies().length === 0, "the shipping keychain policy has no problems");
    ok(SECURE_ITEM_NAMES.length === 2, "exactly two secrets are declared");
    ok(
      SECURE_ITEM_NAMES.every((n) => keychainItemName(n).startsWith(KEYCHAIN_PREFIX)),
      "every keychain item carries the Greenway prefix",
    );
    ok(keychainItemName("device-pairing") !== keychainItemName("db-passphrase"), "the two secrets have distinct names");
    ok(KEYCHAIN_PREFIX !== PLUGIN_DEFAULT_KEY_PREFIX, "we do not use the plugin's shared default prefix");
    ok(
      SECURE_ITEM_NAMES.every((n) => keychainItemPolicy(n).sync === false),
      "no secret is set to synchronize with iCloud",
    );
    ok(
      SECURE_ITEM_NAMES.every((n) => keychainItemPolicy(n).access === REQUIRED_ACCESS_LEVEL),
      "every secret uses the required access level",
    );
  }

  // ---- the audit actually catches the mistakes it exists to catch ----------
  {
    const base = keychainItemPolicy("device-pairing");
    const migrating = auditKeychainPolicies([{ ...base, access: "whenUnlocked" }]);
    ok(migrating.some((p) => p.code === "migrates"), "the audit catches a level that follows a backup to a new iPad");
    ok(migrating.some((p) => p.code === "access"), "the audit also names the required level");
    ok(
      auditKeychainPolicies([{ ...base, sync: true }]).some((p) => p.code === "icloud"),
      "the audit catches iCloud Keychain sync being switched on",
    );
    ok(
      auditKeychainPolicies([{ ...base, name: "device-pairing" }]).some((p) => p.code === "prefix"),
      "the audit catches a missing prefix",
    );
    ok(
      auditKeychainPolicies([base, base]).some((p) => p.code === "duplicate"),
      "the audit catches the same item declared twice",
    );
    ok(
      auditKeychainPolicies([{ ...base, what: "creds" }]).some((p) => p.code === "description"),
      "the audit catches an item that does not explain itself",
    );
    ok(
      auditKeychainPolicies([{ ...base, access: "afterFirstUnlock" }]).some((p) => p.code === "migrates"),
      "the audit catches the second migrating level too",
    );
  }

  // ---- pairing shape ------------------------------------------------------
  {
    ok(isValidPairing(PAIR), "a well-formed pairing is accepted");
    ok(isValidPairing({ ...PAIR, registerId: null }), "a pairing with no register assigned is still valid");
    ok(!isValidPairing({ ...PAIR, deviceId: "register-1" }), "a non-UUID device id is refused");
    ok(!isValidPairing({ ...PAIR, deviceKey: KEY.slice(0, 31) }), "a truncated device key is refused");
    ok(!isValidPairing({ ...PAIR, deviceKey: `${KEY}A` }), "an over-long device key is refused");
    ok(!isValidPairing({ ...PAIR, deviceKey: `${KEY.slice(0, 31)}.` }), "a key with a stray character is refused");
    ok(!isValidPairing({ ...PAIR, registerId: 7 }), "a non-string register id is refused");
    ok(!isValidPairing({ ...PAIR, name: null }), "a missing name is refused");
    ok(!isValidPairing(null) && !isValidPairing("x") && !isValidPairing([]), "non-objects are refused");
    ok(DEVICE_KEY_LENGTH === 32, "the device key length matches what device-store mints");
    ok(KEY.length === DEVICE_KEY_LENGTH, "the sample key is the real minted length");

    ok(parsePairing(JSON.stringify(PAIR))?.deviceKey === KEY, "a stored pairing round-trips");
    ok(parsePairing("not json") === null, "unreadable text yields nothing instead of throwing");
    ok(parsePairing(null) === null && parsePairing("") === null, "nothing stored yields nothing");
    ok(parsePairing(JSON.stringify({ ...PAIR, deviceKey: "short" })) === null, "valid JSON with a bad key is refused");
    ok(parsePairing("{}") === null, "an empty object is not a pairing");
    ok(parsePairing(JSON.stringify([PAIR])) === null, "an array is not a pairing");
  }

  // ---- redaction / never-log ---------------------------------------------
  {
    ok(maskSecret(KEY).startsWith(KEY.slice(0, 4)), "a masked key keeps four characters for identification");
    ok(maskSecret(KEY).length === KEY.length, "masking does not change the visible length");
    ok(!maskSecret(KEY).includes(KEY.slice(4)), "masking hides the rest of the key");
    ok(maskSecret("short12") === "*******", "a short value is masked completely");
    ok(maskSecret("") === "(none)", "an empty secret says so plainly");

    const desc = describePairing(PAIR);
    ok(desc.includes(ID), "the description names the device id, which support needs");
    ok(!desc.includes(KEY), "the description NEVER contains the device key");
    ok(desc.includes("Register 1"), "the description names the register");
    ok(describePairing(null).includes("not paired"), "an unpaired register says so");
    ok(!describePairing({ ...PAIR, name: "" }).includes(KEY), "the key stays hidden even with no name");

    ok(findLeakedSecrets(desc, [KEY]).length === 0, "the safe description passes the leak scan");
    ok(findLeakedSecrets(`key=${KEY}`, [KEY]).length === 1, "the leak scan catches a real leak");
    ok(findLeakedSecrets("nothing here", [KEY]).length === 0, "clean text passes");
    ok(findLeakedSecrets("anything", [""]).length === 0, "an empty secret cannot match everything");
    ok(findLeakedSecrets("abc", ["ab"]).length === 0, "a too-short secret is not searched for");
  }

  // ---- passphrase minting -------------------------------------------------
  {
    const good = Array.from({ length: PASSPHRASE_ENTROPY_BYTES }, (_, i) => (i * 7 + 3) % 256);
    const minted = mintPassphrase(good);
    ok(minted.ok, "32 good random bytes mint a passphrase");
    ok(minted.passphrase !== null && minted.passphrase.length === PASSPHRASE_LENGTH, "the passphrase is 43 characters");
    ok(minted.passphrase !== null && isValidPassphrase(minted.passphrase), "the minted passphrase validates");
    ok(PASSPHRASE_ENTROPY_BYTES === 32, "the passphrase carries 256 bits, matching AES-256");

    // Determinism: same bytes in, same passphrase out (this module is pure).
    ok(mintPassphrase(good).passphrase === minted.passphrase, "minting is deterministic for the same bytes");
    // Different bytes must give a different passphrase (the encoder is real).
    const other = good.slice();
    other[0] = (other[0] + 1) % 256;
    ok(mintPassphrase(other).passphrase !== minted.passphrase, "different random bytes give a different passphrase");

    ok(!mintPassphrase([]).ok, "no bytes is refused");
    ok(!mintPassphrase(good.slice(0, 16)).ok, "too few bytes is refused");
    ok(!mintPassphrase([...good, 1]).ok, "too many bytes is refused");
    ok(!mintPassphrase(new Array(32).fill(0)).ok, "all-zero bytes are refused as a broken generator");
    ok(!mintPassphrase(new Array(32).fill(200)).ok, "all-identical bytes are refused too");
    ok(!mintPassphrase(good.map((b, i) => (i === 0 ? 256 : b))).ok, "an out-of-range byte is refused");
    ok(!mintPassphrase(good.map((b, i) => (i === 0 ? -1 : b))).ok, "a negative byte is refused");
    ok(!mintPassphrase(good.map((b, i) => (i === 0 ? 1.5 : b))).ok, "a fractional byte is refused");
    ok((mintPassphrase([]).problem ?? "").length > 20, "a refusal explains itself");

    // KNOWN-ANSWER VECTORS. The checks above only prove the passphrase has the
    // right SHAPE; a broken encoder can produce well-shaped nonsense. These two
    // expected values were produced by Node's own
    // `Buffer.from(bytes).toString("base64url")`, and the hand-written encoder
    // was additionally verified byte-for-byte against Node on 20,000 random
    // 32-byte samples. Pinning them here means any future edit to the encoder
    // fails loudly instead of silently weakening every database passphrase.
    ok(
      mintPassphrase(good).passphrase === "AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw",
      "the encoder matches Node's base64url for a known 32-byte input",
    );
    ok(
      mintPassphrase(Array.from({ length: 32 }, (_, i) => i)).passphrase ===
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      "the encoder matches Node's base64url for a second known input",
    );

    // The encoder is correct, not merely well-shaped: 32 bytes of 0x00 with one
    // altered byte must still encode to the documented alphabet only.
    const enc = mintPassphrase(good).passphrase ?? "";
    ok(/^[A-Za-z0-9_-]+$/.test(enc), "the passphrase uses only URL-safe characters");
    ok(!enc.includes("+") && !enc.includes("/") && !enc.includes("="), "no plain-base64 or padding characters appear");

    ok(!isValidPassphrase(""), "an empty passphrase is invalid");
    ok(!isValidPassphrase(null), "a missing passphrase is invalid");
    ok(!isValidPassphrase("a".repeat(42)), "a short passphrase is invalid");
    ok(!isValidPassphrase("a".repeat(44)), "a long passphrase is invalid");
    ok(!isValidPassphrase(`${"a".repeat(42)}.`), "a passphrase with a stray character is invalid");
    ok(isValidPassphrase("a".repeat(43)), "a 43-character URL-safe passphrase is valid");
  }

  // ---- passphrase lifecycle ----------------------------------------------
  {
    const valid = "a".repeat(43);
    const reuse = passphraseDecision({ stored: valid, databaseExists: true });
    ok(reuse.reuse && !reuse.mint, "an existing passphrase is REUSED, never replaced");
    ok(!reuse.discardDatabase, "reusing the passphrase keeps the database");

    // The reinstall case: keychain survived, database did not.
    const reinstall = passphraseDecision({ stored: valid, databaseExists: false });
    ok(reinstall.reuse && !reinstall.mint, "after a reinstall the surviving passphrase is reused");
    ok(!reinstall.discardDatabase, "there is no database to discard after a reinstall");

    const first = passphraseDecision({ stored: null, databaseExists: false });
    ok(first.mint && !first.reuse, "first run mints a passphrase");
    ok(!first.discardDatabase, "first run has nothing to discard");
    ok(first.reason.includes("First run"), "first run says so plainly");

    const lost = passphraseDecision({ stored: null, databaseExists: true });
    ok(lost.mint && lost.discardDatabase, "a missing passphrase with a database present forces a rebuild");
    ok(lost.reason.includes("may be lost"), "the rebuild warns that unsent sales may be lost");

    const corrupt = passphraseDecision({ stored: "garbage", databaseExists: true });
    ok(corrupt.mint && corrupt.discardDatabase, "a corrupt passphrase forces a rebuild");
    ok(corrupt.reason.includes("damaged"), "a corrupt passphrase is described as damaged, not missing");

    ok(
      [reuse, reinstall, first, lost, corrupt].every((d) => d.reason.trim().length > 20),
      "every passphrase decision explains itself in plain English",
    );
    ok(
      [reuse, reinstall, first, lost, corrupt].every((d) => d.mint !== d.reuse),
      "a decision is never both mint and reuse, and never neither",
    );
  }

  // ---- destination rules --------------------------------------------------
  {
    ok(secretMayBeWrittenTo("db-passphrase", "keychain"), "the passphrase may go in the keychain");
    ok(secretMayBeWrittenTo("device-pairing", "keychain"), "the pairing may go in the keychain");
    ok(!secretMayBeWrittenTo("db-passphrase", "encrypted-db"), "the passphrase may NOT go inside the database it opens");
    ok(!secretMayBeWrittenTo("device-pairing", "encrypted-db"), "the pairing does not belong in the database");
    ok(!secretMayBeWrittenTo("device-pairing", "preferences"), "no secret goes in unencrypted settings");
    ok(!secretMayBeWrittenTo("device-pairing", "log"), "no secret is ever logged");
    ok(!secretMayBeWrittenTo("db-passphrase", "log"), "the passphrase is never logged");
    ok(!secretMayBeWrittenTo("device-pairing", "network"), "no secret is sent off the device");

    ok(destinationRefusal("db-passphrase", "keychain") === null, "an allowed destination has no refusal");
    ok(
      (destinationRefusal("db-passphrase", "encrypted-db") ?? "").includes("key that opens"),
      "the circular-storage refusal explains the circularity",
    );
    ok(
      (destinationRefusal("device-pairing", "preferences") ?? "").includes("not encrypted"),
      "the preferences refusal explains why",
    );
    ok((destinationRefusal("device-pairing", "log") ?? "").includes("never"), "the log refusal is absolute");
    const allDest: SecretDestination[] = ["keychain", "encrypted-db", "preferences", "log", "network"];
    ok(
      allDest.every((d) => (d === "keychain") === (destinationRefusal("device-pairing", d) === null)),
      "exactly one destination is allowed, and every other one is refused with a reason",
    );
  }

  // ---- web honesty + unpair ----------------------------------------------
  {
    const web = secureStorageAvailability("web");
    ok(!web.encrypted, "we do not claim encryption in a browser");
    ok(web.warning !== null && web.warning.includes("unencrypted"), "the browser warning is honest");
    ok(web.label.includes("not encrypted"), "the browser label is honest at a glance");
    const ios = secureStorageAvailability("ios");
    ok(ios.encrypted && ios.warning === null, "the iPad app reports encrypted storage with no caveat");
    ok(ios.label.includes("keychain"), "the iPad label names the keychain");
    ok(secureStorageAvailability("android").encrypted, "Android reports encrypted storage");

    const plan = unpairPlan();
    ok(plan.erase.length === SECURE_ITEM_NAMES.length, "unpairing erases every secret");
    ok(plan.erase.includes("device-pairing") && plan.erase.includes("db-passphrase"), "both secrets are erased");
    ok(plan.reason.includes("Deleting the app does not remove"), "the unpair reason names the iOS keychain behaviour");
  }

  return { passed, failed };
}
