import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __runPosSecureStoreCoreTests,
  accessLevelMigratesDevices,
  auditKeychainPolicies,
  describePairing,
  DEVICE_KEY_LENGTH,
  findLeakedSecrets,
  isValidPairing,
  isValidPassphrase,
  KEYCHAIN_PREFIX,
  keychainItemName,
  keychainItemPolicy,
  maskSecret,
  MIGRATING_ACCESS_LEVELS,
  mintPassphrase,
  parsePairing,
  PASSPHRASE_ENTROPY_BYTES,
  PASSPHRASE_LENGTH,
  passphraseDecision,
  PLUGIN_DEFAULT_KEY_PREFIX,
  REQUIRED_ACCESS_LEVEL,
  secretMayBeWrittenTo,
  secureStorageAvailability,
  SECURE_ITEM_NAMES,
  unpairPlan,
  type DevicePairing,
  type KeychainAccessLevel,
  type SecretDestination,
} from "../../src/lib/pos/pos-secure-store-core";
import {
  __resetSecureStoreForTests,
  __secureStoreItemsForTests,
  clearSecureStoreWriteAlert,
  configurePosSecureStore,
  describeCurrentPairing,
  ensureDatabasePassphrase,
  hasDatabasePassphrase,
  hydrateSecureStore,
  isSecureStoreHydrated,
  loadPairing,
  savePairing,
  secureStoreStatus,
  secureStoreWriteAlert,
  unpairRegister,
  WEB_PAIRING_KEY,
  type PosSecureBackend,
} from "../../src/lib/pos/pos-secure-store";

/**
 * Phase 1.2 / 1.3 — the register's two secrets.
 *
 * Like the Phase 1.1 suite, these tests read the REAL shipping source rather
 * than fixtures. The risk being managed is DRIFT: someone logs a device key,
 * writes the pairing back into ordinary storage, or relaxes the keychain
 * accessibility to the plugin's migrating default. None of those would break a
 * test that only exercised a copy of the policy — they only surface when the
 * shipping files themselves are inspected.
 */

const REPO = path.resolve(__dirname, "../..");
const SHELL = path.join(REPO, "src/app/pos/RegisterShell.tsx");
const CORE = path.join(REPO, "src/lib/pos/pos-secure-store-core.ts");
const SEAM = path.join(REPO, "src/lib/pos/pos-secure-store.ts");

const shellSrc = readFileSync(SHELL, "utf8");
const coreSrc = readFileSync(CORE, "utf8");
const seamSrc = readFileSync(SEAM, "utf8");

/**
 * Strip comments so a scan tests CODE, not documentation about code.
 *
 * Line comments are removed FIRST, and that order is not cosmetic. Removing
 * block comments first was a real bug in this helper: RegisterShell contains a
 * line comment ending "...(see" whose next line begins "public/pos-sw.js)".
 * The "/*" inside that path opened a block comment that swallowed 3,776
 * characters of REAL CODE, including the hydration call this suite exists to
 * verify — so the test failed while the code was correct. Stripping line
 * comments first means a "/*" that only ever appears inside one can never open
 * a block.
 */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const ID = "59768c42-aa8c-4dab-8e6e-a2e766fe16b0";
const KEY = "RJH5doEHCd78c2fneJmS7vgKGb1TXWiA";
const PAIR: DevicePairing = { deviceId: ID, deviceKey: KEY, name: "Register 1", registerId: "r-1" };

/** A controllable fake keychain. */
function fakeBackend(opts: { encrypted?: boolean; name?: string } = {}) {
  const store = new Map<string, string>();
  let failWrites = false;
  let failReads = false;
  const backend: PosSecureBackend = {
    name: opts.name ?? "fake keychain",
    encrypted: opts.encrypted ?? true,
    async getItem(name) {
      if (failReads) throw new Error("keychain unavailable");
      return store.get(name) ?? null;
    },
    async setItem(name, value) {
      if (failWrites) throw new Error("keychain write failed");
      store.set(name, value);
    },
    async removeItem(name) {
      if (failWrites) throw new Error("keychain remove failed");
      store.delete(name);
    },
  };
  return {
    backend,
    store,
    failWrites: (v: boolean) => {
      failWrites = v;
    },
    failReads: (v: boolean) => {
      failReads = v;
    },
  };
}

beforeEach(() => {
  __resetSecureStoreForTests();
});

// ---------------------------------------------------------------------------

describe("pos-secure-store-core self-tests", () => {
  it("passes its own pure self-tests", () => {
    const r = __runPosSecureStoreCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(100);
  });
});

describe("the core's self-tests actually run in CI", () => {
  it("is registered in the pure self-test runner", () => {
    // Without this, someone could comment out the registration and all 113
    // self-tests would silently stop running in CI while every other test still
    // passed. Comments are stripped first so a commented-out registration
    // cannot satisfy the check — mutation testing proved that hole was real.
    const runner = readFileSync(path.join(REPO, "scripts/compliance/run-pure-selftests.ts"), "utf8");
    const live = stripComments(runner);
    expect(live).toMatch(/^import \{ __runPosSecureStoreCoreTests \}/m);
    expect(live).toMatch(
      /^\s*assertNoFailures\("pos\/pos-secure-store-core", __runPosSecureStoreCoreTests\(\)\);$/m,
    );
  });

  it("exports a self-test entry point in the house shape", () => {
    expect(coreSrc).toContain(
      "export function __runPosSecureStoreCoreTests(): { passed: number; failed: number }",
    );
  });
});

describe("the core stays pure", () => {
  it("imports nothing at all", () => {
    expect(stripComments(coreSrc)).not.toMatch(/^\s*import\s/m);
  });

  it("performs no I/O, no clock reads and no randomness", () => {
    const code = stripComments(coreSrc);
    expect(code).not.toMatch(/window\./);
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/fetch\(/);
    expect(code).not.toMatch(/Date\.now\(/);
    // Randomness is INJECTED so the rules stay testable; the core must never
    // reach for a generator itself.
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/getRandomValues/);
    expect(code).not.toMatch(/randomBytes/);
  });
});

// ---------------------------------------------------------------------------

describe("keychain policy — the register cannot be cloned onto another iPad", () => {
  it("pins every secret to this device only", () => {
    expect(REQUIRED_ACCESS_LEVEL).toBe("whenUnlockedThisDeviceOnly");
    for (const item of SECURE_ITEM_NAMES) {
      expect(keychainItemPolicy(item).access).toBe("whenUnlockedThisDeviceOnly");
    }
  });

  it("never uses an accessibility level that follows an encrypted backup", () => {
    for (const item of SECURE_ITEM_NAMES) {
      expect(accessLevelMigratesDevices(keychainItemPolicy(item).access)).toBe(false);
    }
  });

  it("identifies the plugin's own DEFAULT level as unsafe for us", () => {
    // The plugin defaults to whenUnlocked. If we ever forgot to override it,
    // this is the fact that makes the audit fire.
    expect(accessLevelMigratesDevices("whenUnlocked")).toBe(true);
    expect(MIGRATING_ACCESS_LEVELS).toContain("whenUnlocked");
    expect(MIGRATING_ACCESS_LEVELS).toContain("afterFirstUnlock");
  });

  it("classifies every level the plugin offers", () => {
    const all: KeychainAccessLevel[] = [
      "whenUnlocked",
      "whenUnlockedThisDeviceOnly",
      "afterFirstUnlock",
      "afterFirstUnlockThisDeviceOnly",
      "whenPasscodeSetThisDeviceOnly",
    ];
    for (const level of all) {
      // "ThisDeviceOnly" is Apple's own marker for non-migrating items.
      expect(accessLevelMigratesDevices(level)).toBe(!level.includes("ThisDeviceOnly"));
    }
  });

  it("keeps iCloud Keychain sync off for every secret", () => {
    for (const item of SECURE_ITEM_NAMES) {
      expect(keychainItemPolicy(item).sync).toBe(false);
    }
  });

  it("never enables iCloud sync anywhere in the seam", () => {
    const code = stripComments(seamSrc);
    expect(code).not.toMatch(/setSynchronize\s*\(\s*true\s*\)/);
    expect(code).not.toMatch(/sync:\s*true/);
  });

  it("uses its own keychain prefix, not the plugin's shared default", () => {
    expect(KEYCHAIN_PREFIX).not.toBe(PLUGIN_DEFAULT_KEY_PREFIX);
    for (const item of SECURE_ITEM_NAMES) {
      expect(keychainItemName(item).startsWith(KEYCHAIN_PREFIX)).toBe(true);
    }
  });

  it("gives the two secrets distinct names", () => {
    const names = SECURE_ITEM_NAMES.map(keychainItemName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no policy problems as shipped", () => {
    expect(auditKeychainPolicies()).toEqual([]);
  });

  it("never calls the plugin's clear(), which would wipe every prefixed item", () => {
    expect(stripComments(seamSrc)).not.toMatch(/\.clear\s*\(/);
  });
});

describe("the policy audit actually catches the mistakes it exists for", () => {
  const base = keychainItemPolicy("device-pairing");

  it("catches the migrating default being restored", () => {
    const problems = auditKeychainPolicies([{ ...base, access: "whenUnlocked" }]);
    expect(problems.map((p) => p.code)).toContain("migrates");
    expect(problems.find((p) => p.code === "migrates")!.message).toMatch(/clone this register/i);
  });

  it("catches iCloud sync being switched on", () => {
    expect(auditKeychainPolicies([{ ...base, sync: true }]).map((p) => p.code)).toContain("icloud");
  });

  it("catches a missing prefix", () => {
    expect(auditKeychainPolicies([{ ...base, name: "pairing" }]).map((p) => p.code)).toContain("prefix");
  });

  it("catches a duplicate item", () => {
    expect(auditKeychainPolicies([base, base]).map((p) => p.code)).toContain("duplicate");
  });

  it("catches an item that does not explain itself", () => {
    expect(auditKeychainPolicies([{ ...base, what: "creds" }]).map((p) => p.code)).toContain("description");
  });

  it("passes a correct policy with no complaints", () => {
    expect(auditKeychainPolicies([base])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the pairing is validated before it is trusted", () => {
  it("accepts a real pairing", () => {
    expect(isValidPairing(PAIR)).toBe(true);
    expect(parsePairing(JSON.stringify(PAIR))).toEqual(PAIR);
  });

  it("refuses a truncated device key rather than posting sales with it", () => {
    expect(isValidPairing({ ...PAIR, deviceKey: KEY.slice(0, 31) })).toBe(false);
    expect(parsePairing(JSON.stringify({ ...PAIR, deviceKey: KEY.slice(0, 31) }))).toBeNull();
  });

  it("refuses a non-UUID device id", () => {
    expect(isValidPairing({ ...PAIR, deviceId: "register-1" })).toBe(false);
  });

  it("matches the key length device-store actually mints", () => {
    // randomBytes(24).toString("base64url") is always exactly 32 chars.
    expect(DEVICE_KEY_LENGTH).toBe(32);
    expect(KEY.length).toBe(DEVICE_KEY_LENGTH);
  });

  it("never throws on corrupt input", () => {
    for (const bad of ["", "not json", "{", "null", "[]", "{}", '{"deviceId":1}']) {
      expect(() => parsePairing(bad)).not.toThrow();
      expect(parsePairing(bad)).toBeNull();
    }
  });
});

describe("secrets are never written where they could be read", () => {
  it("masks the device key everywhere it is described", () => {
    const desc = describePairing(PAIR);
    expect(desc).not.toContain(KEY);
    expect(desc).toContain(ID);
  });

  it("masks a secret without revealing a usable prefix of a short value", () => {
    expect(maskSecret("short12")).toBe("*******");
    expect(maskSecret(KEY)).not.toContain(KEY.slice(4));
    expect(maskSecret("")).toBe("(none)");
  });

  it("allows only the keychain as a destination", () => {
    const all: SecretDestination[] = ["keychain", "encrypted-db", "preferences", "log", "network"];
    for (const item of SECURE_ITEM_NAMES) {
      for (const d of all) {
        expect(secretMayBeWrittenTo(item, d)).toBe(d === "keychain");
      }
    }
  });

  it("refuses to put the database passphrase inside the database it unlocks", () => {
    expect(secretMayBeWrittenTo("db-passphrase", "encrypted-db")).toBe(false);
  });

  it("catches a real leak and passes clean text", () => {
    expect(findLeakedSecrets(`x-pos-device-key: ${KEY}`, [KEY])).toEqual([KEY]);
    expect(findLeakedSecrets(describePairing(PAIR), [KEY])).toEqual([]);
  });

  it("never logs a secret-bearing variable from the seam", () => {
    // A console call may say the WORD "pairing" in its fixed text — that is how
    // it stays plain English. What it must never do is interpolate a variable
    // that holds a secret. So the string literals are removed first and only
    // the remaining executable expression is inspected; otherwise this test
    // would flag its own safe wording.
    const code = stripComments(seamSrc);
    const calls = [...code.matchAll(/console\.\w+\(([^;]*)\)/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const withoutLiterals = call
        .replace(/`(?:[^`$\\]|\\.|\$(?!\{))*`/g, "``") // template literals with no ${}
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        // what is left of a template literal: keep ONLY the ${...} expressions
        .replace(/`[^`]*`/g, (t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" "));
      expect(withoutLiterals).not.toMatch(/\b(pairing|serialized|passphrase|minted|stored|deviceKey|creds)\b/);
    }
  });

  it("proves that guard by catching a deliberately unsafe call", () => {
    // Testing the test: the scan above is only worth having if it would
    // actually fire. This is the exact shape of the mistake it guards against.
    const unsafe = "console.error(`saving ${serialized}`);";
    const call = [...unsafe.matchAll(/console\.\w+\(([^;]*)\)/g)].map((m) => m[1]!)[0]!;
    const withoutLiterals = call
      .replace(/`(?:[^`$\\]|\\.|\$(?!\{))*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`[^`]*`/g, (t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" "));
    expect(withoutLiterals).toMatch(/\bserialized\b/);
  });

  it("never logs a secret from the shell's credential paths", () => {
    const code = stripComments(shellSrc);
    expect(code).not.toMatch(/console\.\w+\([^)]*deviceKey/);
    expect(code).not.toMatch(/console\.\w+\([^)]*creds\b/);
  });
});

// ---------------------------------------------------------------------------

describe("the database passphrase", () => {
  it("carries 256 bits, matching the AES key SQLCipher uses", () => {
    expect(PASSPHRASE_ENTROPY_BYTES).toBe(32);
    expect(PASSPHRASE_LENGTH).toBe(43);
  });

  it("encodes exactly like Node's base64url", () => {
    // Known-answer vectors: a broken encoder would still produce a well-shaped
    // string, so shape checks alone cannot catch it.
    const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
    expect(mintPassphrase(bytes).passphrase).toBe("AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw");
    expect(mintPassphrase(Array.from({ length: 32 }, (_, i) => i)).passphrase).toBe(
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    );
  });

  it("refuses a broken random generator instead of encrypting with a weak key", () => {
    expect(mintPassphrase(new Array(32).fill(0)).ok).toBe(false);
    expect(mintPassphrase(new Array(32).fill(255)).ok).toBe(false);
    expect(mintPassphrase([]).ok).toBe(false);
    expect(mintPassphrase(new Array(16).fill(1)).ok).toBe(false);
  });

  it("refuses the wrong NUMBER of bytes, for that reason specifically", () => {
    // Asserting the REASON, not just ok=false. Mutation testing showed that
    // deleting the byte-count check still produced ok=false for 16 bytes,
    // because the shape check happened to catch the short result. That made the
    // count check look tested when it was not. A 48-byte input is the sharp
    // case: it encodes to 64 characters, so only the count check can reject it.
    const short = mintPassphrase(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(short.problem).toMatch(/exactly 32 random bytes, but 16 were supplied/);

    const long = mintPassphrase(Array.from({ length: 48 }, (_, i) => i + 1));
    expect(long.ok).toBe(false);
    expect(long.problem).toMatch(/exactly 32 random bytes, but 48 were supplied/);

    const one = mintPassphrase(Array.from({ length: 33 }, (_, i) => i + 1));
    expect(one.ok).toBe(false);
    expect(one.problem).toMatch(/33 were supplied/);
  });

  it("produces a different passphrase for different randomness", () => {
    const a = Array.from({ length: 32 }, (_, i) => i);
    const b = a.slice();
    b[31] = 99;
    expect(mintPassphrase(a).passphrase).not.toBe(mintPassphrase(b).passphrase);
  });

  it("validates only well-formed passphrases", () => {
    expect(isValidPassphrase("a".repeat(43))).toBe(true);
    expect(isValidPassphrase("a".repeat(42))).toBe(false);
    expect(isValidPassphrase(null)).toBe(false);
    expect(isValidPassphrase(`${"a".repeat(42)}.`)).toBe(false);
  });

  it("NEVER replaces a passphrase that already exists", () => {
    // This is the rule that prevents permanently locking the register out of
    // its own unsynced sales.
    const valid = "a".repeat(43);
    for (const databaseExists of [true, false]) {
      const d = passphraseDecision({ stored: valid, databaseExists });
      expect(d.reuse).toBe(true);
      expect(d.mint).toBe(false);
      expect(d.discardDatabase).toBe(false);
    }
  });

  it("mints on first run without discarding anything", () => {
    const d = passphraseDecision({ stored: null, databaseExists: false });
    expect(d.mint).toBe(true);
    expect(d.discardDatabase).toBe(false);
  });

  it("warns plainly when a database exists but its passphrase is gone", () => {
    const d = passphraseDecision({ stored: null, databaseExists: true });
    expect(d.mint).toBe(true);
    expect(d.discardDatabase).toBe(true);
    expect(d.reason).toMatch(/may be lost/i);
  });

  it("survives the reinstall case: keychain kept, database gone", () => {
    // iOS does NOT delete keychain data when an app is deleted, so after a
    // reinstall the passphrase is still there and must be reused.
    const d = passphraseDecision({ stored: "a".repeat(43), databaseExists: false });
    expect(d.reuse).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("the seam behaves like the storage it replaces", () => {
  it("round-trips a pairing through a keychain backend", async () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    expect(savePairing(PAIR)).toBe(true);
    expect(loadPairing()).toEqual(PAIR);
    // and it reached the durable store, not just the mirror
    await vi.waitFor(() => expect(fake.store.size).toBe(1));
    expect([...fake.store.keys()][0]).toBe(keychainItemName("device-pairing"));
  });

  it("reads back what a previous session stored", async () => {
    const fake = fakeBackend();
    fake.store.set(keychainItemName("device-pairing"), JSON.stringify(PAIR));
    configurePosSecureStore(fake.backend);
    await hydrateSecureStore();
    expect(isSecureStoreHydrated()).toBe(true);
    expect(loadPairing()).toEqual(PAIR);
  });

  it("keeps using the ORIGINAL browser key so existing installs keep working", async () => {
    // The browser build must keep reading exactly what it already saved. If
    // this key changed, every budtender's browser would come up unpaired.
    expect(WEB_PAIRING_KEY).toBe("gw-pos-device");
    const fake = fakeBackend({ encrypted: false, name: "browser storage (not encrypted)" });
    fake.store.set(WEB_PAIRING_KEY, JSON.stringify(PAIR));
    configurePosSecureStore(fake.backend);
    await hydrateSecureStore();
    expect(loadPairing()).toEqual(PAIR);
  });

  it("refuses to save a malformed pairing", () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    expect(savePairing({ ...PAIR, deviceKey: "nope" })).toBe(false);
    expect(loadPairing()).toBeNull();
    expect(fake.store.size).toBe(0);
  });

  it("serves a synchronous read immediately after a write", () => {
    // The whole point of the mirror: RegisterShell reads during render.
    configurePosSecureStore(fakeBackend().backend);
    savePairing(PAIR);
    expect(loadPairing()).toEqual(PAIR); // no await anywhere
  });

  it("treats an unreadable secret as 'not paired' rather than crashing", async () => {
    const fake = fakeBackend();
    fake.failReads(true);
    configurePosSecureStore(fake.backend);
    await expect(hydrateSecureStore()).resolves.toBeUndefined();
    expect(loadPairing()).toBeNull();
  });

  it("raises a plain-English alert when the pairing cannot be persisted", async () => {
    const fake = fakeBackend();
    fake.failWrites(true);
    configurePosSecureStore(fake.backend);
    expect(savePairing(PAIR)).toBe(true); // the register keeps working
    await vi.waitFor(() => expect(secureStoreWriteAlert()).not.toBeNull());
    expect(secureStoreWriteAlert()).toMatch(/manager/i);
    expect(secureStoreWriteAlert()).not.toContain(KEY);
    clearSecureStoreWriteAlert();
    expect(secureStoreWriteAlert()).toBeNull();
  });

  it("erases both secrets when the register is unpaired", async () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    savePairing(PAIR);
    await ensureDatabasePassphrase(false);
    expect(__secureStoreItemsForTests().length).toBe(2);
    unpairRegister();
    expect(__secureStoreItemsForTests()).toEqual([]);
    await vi.waitFor(() => expect(fake.store.size).toBe(0));
  });

  it("erases both secrets because deleting the app does not", () => {
    expect(unpairPlan().erase.length).toBe(SECURE_ITEM_NAMES.length);
    expect(unpairPlan().reason).toMatch(/Deleting the app does not remove/);
  });

  it("never exposes secret VALUES through its test hook", () => {
    configurePosSecureStore(fakeBackend().backend);
    savePairing(PAIR);
    expect(JSON.stringify(__secureStoreItemsForTests())).not.toContain(KEY);
  });

  it("describes the live pairing without ever revealing the key", () => {
    configurePosSecureStore(fakeBackend().backend);
    expect(describeCurrentPairing()).toMatch(/not paired/i);
    savePairing(PAIR);
    const desc = describeCurrentPairing();
    expect(desc).toContain(ID); // support needs the id
    expect(desc).not.toContain(KEY); // and must never see the key
    expect(desc).toContain("Register 1");
  });
});

describe("the passphrase lifecycle through the seam", () => {
  it("mints once and reuses forever", async () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    const first = await ensureDatabasePassphrase(false);
    expect(first.passphrase).not.toBeNull();
    expect(isValidPassphrase(first.passphrase)).toBe(true);
    expect(hasDatabasePassphrase()).toBe(true);

    const second = await ensureDatabasePassphrase(true);
    expect(second.passphrase).toBe(first.passphrase);
    expect(second.rebuiltDatabase).toBe(false);
  });

  it("stores the passphrase in the keychain, never in the database", async () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    await ensureDatabasePassphrase(false);
    expect([...fake.store.keys()]).toContain(keychainItemName("db-passphrase"));
  });

  it("reports a rebuild when a database exists with no passphrase", async () => {
    const fake = fakeBackend();
    configurePosSecureStore(fake.backend);
    const r = await ensureDatabasePassphrase(true);
    expect(r.rebuiltDatabase).toBe(true);
    expect(r.message).toMatch(/may be lost/i);
  });

  it("refuses to hand back a passphrase it could not save", async () => {
    // Awaited on purpose: an unsaved passphrase means an unopenable database.
    const fake = fakeBackend();
    fake.failWrites(true);
    configurePosSecureStore(fake.backend);
    const r = await ensureDatabasePassphrase(false);
    expect(r.passphrase).toBeNull();
    expect(r.message).toMatch(/manager|unavailable/i);
    expect(hasDatabasePassphrase()).toBe(false);
  });

  it("refuses to mint at all when the platform has no secure random generator", async () => {
    // There is deliberately NO Math.random fallback: a database encrypted with
    // predictable bytes looks exactly like a properly encrypted one, so the
    // only safe behaviour is to refuse. Mutation testing showed this branch was
    // unproven until this test existed.
    const realCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      configurePosSecureStore(fakeBackend().backend);
      const r = await ensureDatabasePassphrase(false);
      expect(r.passphrase).toBeNull();
      expect(r.message).toMatch(/cannot generate a secure database passphrase/i);
      expect(hasDatabasePassphrase()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
    }
    expect(globalThis.crypto).toBe(realCrypto);
  });

  it("also refuses when getRandomValues is missing from an otherwise present crypto", async () => {
    const realCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
      configurePosSecureStore(fakeBackend().backend);
      const r = await ensureDatabasePassphrase(false);
      expect(r.passphrase).toBeNull();
      expect(r.message).toMatch(/cannot generate a secure database passphrase/i);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
    }
  });

  it("generates real randomness, not a constant", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      __resetSecureStoreForTests();
      configurePosSecureStore(fakeBackend().backend);
      const r = await ensureDatabasePassphrase(false);
      seen.add(r.passphrase ?? "");
    }
    expect(seen.size).toBe(5);
  });
});

describe("the status line is honest", () => {
  it("does not claim encryption in a browser", () => {
    expect(secureStorageAvailability("web").encrypted).toBe(false);
    expect(secureStorageAvailability("web").warning).toMatch(/unencrypted/i);
  });

  it("reports encrypted storage on a packaged app", () => {
    expect(secureStorageAvailability("ios").encrypted).toBe(true);
    expect(secureStorageAvailability("ios").warning).toBeNull();
  });

  it("trusts the installed backend over the platform guess", () => {
    // If the native backend was never installed, an iPad is still on browser
    // storage and must say so rather than showing a padlock that means nothing.
    configurePosSecureStore(fakeBackend({ encrypted: false, name: "browser storage (not encrypted)" }).backend);
    const status = secureStoreStatus("ios");
    expect(status.encrypted).toBe(false);
    expect(status.warning).not.toBeNull();
  });

  it("reports encrypted once a real keychain backend is installed", () => {
    configurePosSecureStore(fakeBackend({ encrypted: true }).backend);
    expect(secureStoreStatus("ios").encrypted).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("the shell routes its credentials through the secure store", () => {
  it("imports the secure seam", () => {
    expect(shellSrc).toMatch(/from "@\/lib\/pos\/pos-secure-store"/);
  });

  it("no longer parses the pairing by hand", () => {
    const code = stripComments(shellSrc);
    // The old code did JSON.parse(posStorageGet(LS_DEVICE)). If that pattern
    // comes back, the shape validation is bypassed.
    expect(code).not.toMatch(/JSON\.parse\([^)]*LS_DEVICE/);
    expect(code).not.toMatch(/posStorageSet\(\s*LS_DEVICE/);
    expect(code).not.toMatch(/posStorageGet\(\s*LS_DEVICE/);
  });

  it("uses loadPairing/savePairing at the credential boundary", () => {
    const code = stripComments(shellSrc);
    expect(code).toMatch(/loadPairing\(\)/);
    expect(code).toMatch(/savePairing\(/);
  });

  it("hydrates the secure store before reading the pairing", () => {
    // Reading before hydration looks exactly like "never set up" and would drop
    // a working till onto the setup screen mid-shift.
    const code = stripComments(shellSrc);
    expect(code).toMatch(/hydrateSecureStore\(\)/);
    const hydrateIdx = code.indexOf("hydrateSecureStore()");
    const bootIdx = code.indexOf("bootFromStorage(verdict)");
    expect(hydrateIdx).toBeGreaterThan(-1);
    expect(bootIdx).toBeGreaterThan(hydrateIdx);
    // Both stores are awaited together.
    expect(code).toMatch(/Promise\.all\(\[\s*hydratePosStorage\(\)\s*,\s*hydrateSecureStore\(\)\s*\]\)/);
  });

  it("does not keep a stale local copy of the device key literal", () => {
    const code = stripComments(shellSrc);
    expect(code).not.toMatch(/const LS_DEVICE\s*=/);
  });
});
