/**
 * src/lib/security/at-rest-crypto.ts  (S-10)
 *
 * App-layer envelope encryption for SECRETS AT REST (employee banking, the
 * company ACH funding account, integration API secrets). PURE except for
 * node:crypto and one env read — unit-testable with tsx.
 *
 * Design
 * ------
 * - AES-256-GCM, key derived (SHA-256) from the `DATA_ENCRYPTION_KEY` env var.
 * - Ciphertext format: `encv1:<iv b64url>:<ciphertext+tag b64url>` — the
 *   prefix makes encrypted values self-identifying, so legacy PLAINTEXT rows
 *   keep working: `decryptSecret` passes anything without the prefix through
 *   unchanged. No migration and no big-bang re-encrypt is required; values
 *   become encrypted as they are next saved.
 * - If `DATA_ENCRYPTION_KEY` is NOT set, `encryptSecret` returns the plaintext
 *   unchanged (with a one-time console.warn), and everything keeps working —
 *   the admin dashboard nags the owner to set the key (fail-visible, not
 *   fail-broken; these are privacy/fraud protections, not LCB gates).
 * - If a ciphertext can't be decrypted (key rotated/lost), `decryptSecret`
 *   returns "" and warns — callers already treat empty as "not on file".
 *
 * KEY MANAGEMENT: set `DATA_ENCRYPTION_KEY` to any long random string (32+
 * chars) in the deployment env. Changing it makes previously-encrypted values
 * unreadable — they would need to be re-entered.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "encv1:";

let warnedNoKey = false;

/** Resolve the 32-byte AES key from env, or null when not configured. */
function resolveKey(explicitKey?: string | null): Buffer | null {
  const raw = explicitKey ?? process.env.DATA_ENCRYPTION_KEY ?? "";
  if (!raw || raw.trim().length === 0) return null;
  return createHash("sha256").update(raw.trim(), "utf8").digest();
}

/** True when at-rest encryption is active (key present). */
export function isAtRestEncryptionConfigured(): boolean {
  return resolveKey() !== null;
}

/** True when a stored value is one of our ciphertexts. */
export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt a secret for storage. Empty input stays empty. Without a key the
 * plaintext is returned unchanged (warned once) so nothing breaks pre-setup.
 * Already-encrypted input is returned unchanged (idempotent).
 */
export function encryptSecret(plain: string, explicitKey?: string | null): string {
  if (!plain) return plain;
  if (isEncryptedValue(plain)) return plain;
  const key = resolveKey(explicitKey);
  if (!key) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        "[at-rest-crypto] DATA_ENCRYPTION_KEY not set — secrets are stored in plaintext. " +
          "Set it to enable at-rest encryption.",
      );
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX + iv.toString("base64url") + ":" + Buffer.concat([ct, tag]).toString("base64url")
  );
}

/**
 * Read a stored value: decrypt our ciphertexts; pass legacy plaintext through.
 * Returns "" (with a warning) when a ciphertext cannot be decrypted, so
 * callers treat it as "not on file" instead of using garbage.
 */
export function decryptSecret(stored: string | null | undefined, explicitKey?: string | null): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = resolveKey(explicitKey);
  if (!key) {
    console.warn("[at-rest-crypto] cannot decrypt: DATA_ENCRYPTION_KEY not set.");
    return "";
  }
  try {
    const parts = stored.slice(PREFIX.length).split(":");
    if (parts.length !== 2) return "";
    const iv = Buffer.from(parts[0], "base64url");
    const blob = Buffer.from(parts[1], "base64url");
    if (iv.length !== 12 || blob.length < 17) return "";
    const ct = blob.subarray(0, blob.length - 16);
    const tag = blob.subarray(blob.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    console.warn("[at-rest-crypto] decryption failed (wrong or rotated key).");
    return "";
  }
}

/** Mask an account-ish value for display: last 4 in the clear, e.g. ••••6789. */
export function maskAccountTail(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runAtRestCryptoTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  const KEY = "test-data-encryption-key-for-selftests";

  // Round trip.
  const ct = encryptSecret("123456789", KEY);
  expect("encrypt produces prefixed ciphertext", ct.startsWith("encv1:"));
  expect("ciphertext differs from plaintext", ct !== "123456789");
  expect("round trip", decryptSecret(ct, KEY) === "123456789");

  // Distinct IVs — same plaintext encrypts differently each time.
  const ct2 = encryptSecret("123456789", KEY);
  expect("random IV per encryption", ct !== ct2);
  expect("second round trip", decryptSecret(ct2, KEY) === "123456789");

  // Idempotent: encrypting a ciphertext returns it unchanged.
  expect("encrypt is idempotent on ciphertext", encryptSecret(ct, KEY) === ct);

  // Legacy plaintext passes through decrypt unchanged.
  expect("legacy plaintext passthrough", decryptSecret("000123456789", KEY) === "000123456789");

  // Empty stays empty.
  expect("empty encrypt", encryptSecret("", KEY) === "");
  expect("empty decrypt", decryptSecret("", KEY) === "");
  expect("null decrypt", decryptSecret(null, KEY) === "");

  // Wrong key -> "" (treated as not-on-file), not garbage.
  expect("wrong key yields empty", decryptSecret(ct, "some-other-key") === "");

  // Corrupted ciphertext -> "".
  expect("corrupt ciphertext yields empty", decryptSecret("encv1:AAAA:BBBB", KEY) === "");

  // No key (explicit empty key forces the unconfigured path): encrypt passes
  // through and decrypt of a ciphertext yields "" (documented degrade).
  expect("no key encrypt passthrough", encryptSecret("sec", "") === "sec");
  expect("no key decrypt of ciphertext yields empty", decryptSecret(ct, "") === "");

  // Unicode round trip.
  const uni = encryptSecret("sécret-钥匙-🔑", KEY);
  expect("unicode round trip", decryptSecret(uni, KEY) === "sécret-钥匙-🔑");

  // Masking.
  expect("mask long", maskAccountTail("000123456789") === "••••6789");
  expect("mask short", maskAccountTail("123") === "••••");
  expect("mask empty", maskAccountTail("") === "");

  if (failures > 0) throw new Error(`at-rest-crypto self-tests: ${failures} failure(s)`);
  console.log("at-rest-crypto self-tests: all passed");
}
