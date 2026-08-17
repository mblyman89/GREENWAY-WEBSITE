/**
 * pos/pos-secure-store — the ONE way the register reads or writes a secret.
 *
 * Two secrets exist:
 *   - the device pairing (`gw-pos-device`: device id + device key), and
 *   - the passphrase that unlocks the encrypted database (Phase 1.3).
 *
 * Both are classified `secure-enclave` in `pos-storage-core`'s registry. This
 * module is where that classification becomes real behaviour, exactly the way
 * `posFetch()` did for the network and `posStorage` did for ordinary values.
 *
 * WHY A SEPARATE SEAM FROM `pos-storage`
 * --------------------------------------
 * `pos-storage` writes to one backend for every key. A secret needs different
 * treatment at the OS level — a keychain item with an accessibility class and
 * an iCloud-sync flag, not a row in a database — and it needs rules that
 * ordinary values do not have (never log it, never let it follow a backup to
 * another iPad). Folding secrets into the general backend would mean the
 * strictest rules were only as strong as the loosest call site.
 *
 * SYNCHRONOUS FACADE, SAME AS PHASE 1.1
 * -------------------------------------
 * `RegisterShell.loadCreds()` is called synchronously during render and inside
 * mount effects, and every Capacitor storage API is asynchronous. So this seam
 * uses the identical proven shape: hydrate once at boot into an in-memory
 * mirror, then serve synchronous reads from it. Writes update the mirror first
 * and persist in the background, so the next synchronous read is always correct.
 *
 * WHAT THIS SLICE DOES NOT DO
 * ---------------------------
 * It does not install the native keychain backend — that needs the Capacitor
 * plugin and a Mac to build, and Apple has not finished enrolling Greenway yet.
 * It ships the seam, the policy, and the web backend that reproduces today's
 * behaviour byte-for-byte, so the native backend later is a `configure...` call
 * and nothing else changes. Shipping the seam first is what makes that swap
 * boring instead of risky.
 *
 * HONESTY ON THE WEB
 * ------------------
 * There is no keychain in a browser. The register PWA at /pos keeps its pairing
 * in localStorage exactly as it always has, and `secureStoreStatus()` says so
 * in plain English rather than implying a padlock that does not exist.
 */
import {
  type DevicePairing,
  type SecureItemName,
  auditKeychainPolicies,
  describePairing,
  isValidPassphrase,
  keychainItemName,
  keychainItemPolicy,
  mintPassphrase,
  parsePairing,
  passphraseDecision,
  PASSPHRASE_ENTROPY_BYTES,
  secureStorageAvailability,
  SECURE_ITEM_NAMES,
  unpairPlan,
} from "./pos-secure-store-core";

/**
 * What a secret backend must provide. Async, three methods, string in/out —
 * deliberately the same tiny shape as `PosStorageBackend` so a Capacitor plugin
 * drops in without adapting anything.
 *
 * `name` is for the diagnostics footer. It must never contain a secret.
 */
export type PosSecureBackend = {
  readonly name: string;
  /** True when the OS actually encrypts this at rest. */
  readonly encrypted: boolean;
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// The web backend — today's behaviour, unchanged
// ---------------------------------------------------------------------------

/**
 * The key the browser build has always used for the pairing. Imported as a
 * literal rather than from the registry because its job here is BACKWARD
 * COMPATIBILITY: it must keep matching what is already saved in every
 * budtender's browser, even if the registry key were ever renamed.
 */
export const WEB_PAIRING_KEY = "gw-pos-device";

/** Where the web build keeps each secret. Only the pairing has a legacy home. */
function webKeyFor(item: SecureItemName): string {
  return item === "device-pairing" ? WEB_PAIRING_KEY : keychainItemName(item);
}

/**
 * True when a usable Web Storage exists. Guarded rather than assumed: SSR has
 * no `window`, and Safari private mode can make `localStorage` throw on ACCESS
 * rather than returning null.
 */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Browser backend. `encrypted: false` is not a limitation to hide — it is the
 * literal truth, and the status line reports it.
 */
export const webSecureBackend: PosSecureBackend = {
  name: "browser storage (not encrypted)",
  encrypted: false,
  async getItem(name: string): Promise<string | null> {
    if (!hasLocalStorage()) return null;
    return window.localStorage.getItem(name);
  },
  async setItem(name: string, value: string): Promise<void> {
    if (!hasLocalStorage()) return;
    window.localStorage.setItem(name, value);
  },
  async removeItem(name: string): Promise<void> {
    if (!hasLocalStorage()) return;
    window.localStorage.removeItem(name);
  },
};

/** A backend that persists nothing. Used on the server and before boot. */
export const memorySecureBackend: PosSecureBackend = {
  name: "memory only",
  encrypted: false,
  async getItem(): Promise<string | null> {
    return null;
  },
  async setItem(): Promise<void> {
    /* nothing to do — the mirror already holds it */
  },
  async removeItem(): Promise<void> {
    /* nothing to do */
  },
};

// ---------------------------------------------------------------------------
// Seam state
// ---------------------------------------------------------------------------

let backend: PosSecureBackend = hasLocalStorage() ? webSecureBackend : memorySecureBackend;
/** In-memory copy of each secret, so reads can stay synchronous. */
let mirror = new Map<SecureItemName, string>();
let hydrated = false;
/** Set when a secret could not be persisted. Never contains the secret. */
let writeAlert: string | null = null;

/**
 * Install the real backend. Called once at boot BEFORE `hydrateSecureStore()`.
 *
 * REFUSES a backend whose policies do not pass the audit, so a native backend
 * configured with the plugin's migrating default accessibility can never be
 * installed by accident. This is the one place that check can be enforced for
 * every future caller at once.
 */
export function configurePosSecureStore(next: PosSecureBackend): void {
  const problems = auditKeychainPolicies();
  if (problems.length > 0) {
    // Policy is a compile-time constant, so this can only fire if someone edits
    // the policy into an unsafe state. Refuse rather than store secrets badly.
    console.error(`pos-secure-store: refusing to configure — ${problems[0].message}`);
    return;
  }
  backend = next;
}

/** Plain-English status for the diagnostics footer. Never contains a secret. */
export function secureStoreStatus(platform: "ios" | "android" | "web" = "web"): {
  encrypted: boolean;
  label: string;
  warning: string | null;
} {
  const availability = secureStorageAvailability(platform);
  // Trust the BACKEND over the platform guess: if the native backend was never
  // installed, an iPad is still using browser storage and must say so.
  if (!backend.encrypted) {
    return {
      encrypted: false,
      label: backend.name,
      warning: availability.warning ?? "This register's pairing is not encrypted at rest.",
    };
  }
  return availability;
}

/**
 * Load every secret into the mirror once at boot.
 *
 * A secret that cannot be read is treated as absent rather than fatal: for the
 * pairing that lands the register on the setup screen, which is recoverable,
 * whereas throwing would leave a blank iPad at the counter.
 */
export async function hydrateSecureStore(): Promise<void> {
  const next = new Map<SecureItemName, string>();
  for (const item of SECURE_ITEM_NAMES) {
    try {
      const raw = await backend.getItem(secureNameFor(item));
      if (raw !== null && raw !== undefined && raw !== "") next.set(item, raw);
    } catch {
      // Unreadable secret = not paired. Deliberately silent: the error object
      // from a keychain failure can echo the value back, and this module never
      // logs anything that could contain one.
    }
  }
  mirror = next;
  hydrated = true;
}

/** Whether the mirror has been filled. */
export function isSecureStoreHydrated(): boolean {
  return hydrated;
}

/** The storage name for a secret under the CURRENT backend. */
function secureNameFor(item: SecureItemName): string {
  return backend.encrypted ? keychainItemName(item) : webKeyFor(item);
}

/** The newest write-failure alert, or null. Never contains a secret. */
export function secureStoreWriteAlert(): string | null {
  return writeAlert;
}

export function clearSecureStoreWriteAlert(): void {
  writeAlert = null;
}

// ---------------------------------------------------------------------------
// The device pairing
// ---------------------------------------------------------------------------

/**
 * Read the pairing. Synchronous — a drop-in for the old
 * `JSON.parse(localStorage.getItem("gw-pos-device"))`.
 *
 * Returns null for anything that is not a complete, well-shaped pairing, so a
 * half-written keychain value sends the register to setup instead of letting it
 * post sales with a mangled credential the server would reject anyway.
 */
export function loadPairing(): DevicePairing | null {
  return parsePairing(mirror.get("device-pairing") ?? null);
}

/**
 * Save the pairing. Validates BEFORE storing: writing a malformed pairing would
 * strand the register at setup on its next launch with no way to tell why.
 *
 * Returns false when the pairing was refused. Never throws — throwing here
 * would unmount the register during provisioning.
 */
export function savePairing(pairing: DevicePairing): boolean {
  const serialized = JSON.stringify(pairing);
  if (parsePairing(serialized) === null) {
    // Do NOT include the pairing in this message: it holds the device key.
    console.error("pos-secure-store: refusing to save a malformed register pairing.");
    return false;
  }
  mirror.set("device-pairing", serialized);
  void backend.setItem(secureNameFor("device-pairing"), serialized).catch(() => {
    writeAlert =
      "This register could not save its pairing. It still works right now, but it may ask to be set up again after a restart. Call a manager.";
  });
  return true;
}

/**
 * Erase every secret — the deliberate "unpair this register" action.
 *
 * This exists because deleting the app does NOT remove keychain data on iOS
 * (verified in the plugin's README), so uninstalling is not a way to retire an
 * iPad. The app has to erase its own secrets.
 */
export function unpairRegister(): void {
  for (const item of unpairPlan().erase) {
    mirror.delete(item);
    void backend.removeItem(secureNameFor(item)).catch(() => {
      writeAlert = "This register could not finish unpairing. Call a manager before handing this iPad on.";
    });
  }
}

/** Safe one-line description of the current pairing. Never contains the key. */
export function describeCurrentPairing(): string {
  return describePairing(loadPairing());
}

// ---------------------------------------------------------------------------
// The database passphrase (Phase 1.3)
// ---------------------------------------------------------------------------

/**
 * Random bytes from the platform CSPRNG.
 *
 * `crypto.getRandomValues` is required — there is no `Math.random` fallback on
 * purpose. A silent fallback to a non-cryptographic generator would produce a
 * database that looks encrypted and is not, which is worse than refusing.
 */
function randomBytesFor(count: number): number[] | null {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!c || typeof c.getRandomValues !== "function") return null;
  const buf = new Uint8Array(count);
  c.getRandomValues(buf);
  return Array.from(buf);
}

export type PassphraseResult = { passphrase: string | null; rebuiltDatabase: boolean; message: string | null };

/**
 * Get the passphrase that unlocks this register's encrypted database, minting
 * one on first run.
 *
 * An existing valid passphrase is ALWAYS reused and never replaced — see
 * `passphraseDecision`, which spells out why replacing one would permanently
 * lock the register out of its own unsynced sales.
 */
export async function ensureDatabasePassphrase(databaseExists: boolean): Promise<PassphraseResult> {
  const stored = mirror.get("db-passphrase") ?? null;
  const decision = passphraseDecision({ stored, databaseExists });

  if (decision.reuse) {
    return { passphrase: stored, rebuiltDatabase: false, message: null };
  }

  const bytes = randomBytesFor(PASSPHRASE_ENTROPY_BYTES);
  if (bytes === null) {
    return {
      passphrase: null,
      rebuiltDatabase: false,
      message: "This device cannot generate a secure database passphrase, so encrypted storage is unavailable.",
    };
  }
  const minted = mintPassphrase(bytes);
  if (!minted.ok || minted.passphrase === null) {
    return { passphrase: null, rebuiltDatabase: false, message: minted.problem };
  }

  mirror.set("db-passphrase", minted.passphrase);
  try {
    await backend.setItem(secureNameFor("db-passphrase"), minted.passphrase);
  } catch {
    // Awaited deliberately, unlike the pairing: a passphrase that is not on
    // disk would leave an encrypted database that nothing can ever reopen. The
    // caller must know before it writes anything into that database.
    mirror.delete("db-passphrase");
    return {
      passphrase: null,
      rebuiltDatabase: false,
      message: "This register could not save its database passphrase, so encrypted storage is unavailable. Call a manager.",
    };
  }
  return {
    passphrase: minted.passphrase,
    rebuiltDatabase: decision.discardDatabase,
    message: decision.discardDatabase ? decision.reason : null,
  };
}

/** Is a usable passphrase already in memory? Diagnostics only. */
export function hasDatabasePassphrase(): boolean {
  return isValidPassphrase(mirror.get("db-passphrase") ?? null);
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Reset the seam. TEST-ONLY. */
export function __resetSecureStoreForTests(): void {
  backend = memorySecureBackend;
  mirror = new Map();
  hydrated = false;
  writeAlert = null;
}

/**
 * Names of the secrets currently held. TEST-ONLY / diagnostics.
 * Returns NAMES ONLY — never the values, so that even a test helper cannot
 * become the thing that prints a device key into CI output.
 */
export function __secureStoreItemsForTests(): string[] {
  return Array.from(mirror.keys()).sort();
}

/** The policy actually in force, re-exported so call sites need only this module. */
export { keychainItemPolicy, SECURE_ITEM_NAMES };
