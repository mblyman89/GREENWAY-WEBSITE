/**
 * src/lib/security/keyed-hash.ts  (R39 S5)
 *
 * Keyed fingerprints (HMAC-SHA256) of bank numbers, for two jobs:
 *   - ach_authorization_accounts.account_key_hmac: spot the same account
 *     twice (0258 unique index) without storing the number in the clear;
 *   - the blind re-key's pending first entry: per-field fingerprints, so the
 *     append-only events table never holds a bank number.
 *
 * KEYS: no new secret. Each purpose gets its own key derived from
 * DATA_ENCRYPTION_KEY with HKDF-SHA256 (RFC 5869). The `info` label binds a
 * key to one purpose, so the same input key material never yields the same
 * key in two contexts (RFC 5869 section 3.2). A fixed public salt is used
 * (RFC 5869 section 3.1: the salt need not be secret).
 *
 * FAIL CLOSED: unlike encryptSecret (which passes plaintext through when the
 * key is missing), these return null without a key. An unkeyed hash of a
 * routing+account number can be brute-forced, so callers must refuse.
 *
 * ROTATION: changing DATA_ENCRYPTION_KEY changes every fingerprint (as it
 * already makes old ciphertext unreadable). Pending re-keys simply need to be
 * entered again; account rows would be re-entered with their ciphertext.
 */
import { createHmac, hkdfSync } from "node:crypto";

export const KEYED_HASH_PURPOSES = {
  achAccountKey: "greenway/r39/ach-account-key-hmac/v1",
  achRekeyFingerprint: "greenway/r39/ach-rekey-fingerprint/v1",
} as const;
export type KeyedHashPurpose = keyof typeof KEYED_HASH_PURPOSES;

const SALT = Buffer.from("greenway-keyed-hash-salt-v1", "utf8");

/** Derive the 32-byte key for one purpose, or null when no key is configured. */
export function deriveKey(purpose: KeyedHashPurpose, explicitKey?: string | null): Buffer | null {
  const raw = (explicitKey ?? process.env.DATA_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  return Buffer.from(hkdfSync("sha256", Buffer.from(raw, "utf8"), SALT, KEYED_HASH_PURPOSES[purpose], 32));
}

/** A keyed hasher for one purpose (lower-case hex), or null without a key. */
export function keyedHasher(purpose: KeyedHashPurpose, explicitKey?: string | null): ((s: string) => string) | null {
  const key = deriveKey(purpose, explicitKey);
  if (!key) return null;
  return (s: string) => createHmac("sha256", key).update(s, "utf8").digest("hex");
}

export function __runKeyedHashTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`keyed-hash FAIL: ${n}`);
    }
  };
  // RFC 5869 Appendix A.1 test vector: proves the HKDF primitive we call.
  const okm = Buffer.from(
    hkdfSync("sha256", Buffer.alloc(22, 0x0b), Buffer.from("000102030405060708090a0b0c", "hex"), Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex"), 42),
  ).toString("hex");
  ok(okm === "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", "RFC 5869 A.1 vector");
  // RFC 4231 test case 2 (HMAC-SHA256, key "Jefe").
  ok(
    createHmac("sha256", "Jefe").update("what do ya want for nothing?").digest("hex") ===
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    "RFC 4231 case 2",
  );
  ok(keyedHasher("achAccountKey", "") === null && deriveKey("achAccountKey", "   ") === null, "no key -> null (fail closed)");
  const a = keyedHasher("achAccountKey", "k1")!;
  const b = keyedHasher("achRekeyFingerprint", "k1")!;
  const c = keyedHasher("achAccountKey", "k2")!;
  const h = a("021000021:12345678:checking");
  ok(/^[0-9a-f]{64}$/.test(h), "64 hex (0258 CHECK)");
  ok(h === a("021000021:12345678:checking"), "deterministic");
  ok(h !== b("021000021:12345678:checking"), "purposes are separated");
  ok(h !== c("021000021:12345678:checking"), "key changes the hash");
  ok(keyedHasher("achAccountKey", " k1 ")!("x") === a("x"), "key is trimmed like at-rest-crypto");
  ok(!h.includes("12345678"), "no number in the output");
  return { passed, failed };
}
