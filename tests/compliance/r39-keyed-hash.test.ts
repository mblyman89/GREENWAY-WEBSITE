/**
 * R39 S5: keyed fingerprints. The purpose labels are pinned: changing one
 * silently changes every stored account_key_hmac and pending re-key, so it
 * must be a deliberate, reviewed change (new /v2 label + migration plan).
 */
import { describe, expect, it } from "vitest";
import { __runKeyedHashTests, deriveKey, KEYED_HASH_PURPOSES, keyedHasher } from "@/lib/security/keyed-hash";

describe("keyed-hash", () => {
  it("self-tests (RFC vectors, separation, fail-closed) all pass", () => {
    const r = __runKeyedHashTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(9);
  });
  it("purpose labels are pinned and distinct", () => {
    expect(KEYED_HASH_PURPOSES).toEqual({
      achAccountKey: "greenway/r39/ach-account-key-hmac/v1",
      achRekeyFingerprint: "greenway/r39/ach-rekey-fingerprint/v1",
      esignOtp: "greenway/r39/esign-otp/v1",
      vendorEsignToken: "greenway/r39/vendor-esign-token/v1",
      vendorEsignOtp: "greenway/r39/vendor-esign-otp/v1",
      vendorEsignBrowser: "greenway/r39/vendor-esign-browser/v1",
      achFileEntrySet: "greenway/r41/ach-file-entry-set/v1",
    });
  });
  it("a fixed key gives a fixed fingerprint (detects any change to salt, label or algorithm)", () => {
    const h = keyedHasher("achAccountKey", "fixed-test-key")!;
    const v = h("021000021:12345678:checking");
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    // Golden values cross-checked with an independent Python HKDF/HMAC
    // implementation written from RFC 5869 (not with this module).
    expect(v).toBe("17d9a52133ae388bdf3f59dbd1563d2f7d1496fc52d9a16926d01510fdf8bcd0");
    expect(keyedHasher("achRekeyFingerprint", "fixed-test-key")!("021000021:12345678:checking")).toBe(
      "ce1e7fd340b91d0c03387687bf4acce7b1b9b6617add8b82f0333718020b4fb8",
    );
    // R39 S6: the e-sign code digest (input as otpDigest() builds it).
    expect(keyedHasher("esignOtp", "fixed-test-key")!("esign-otp|S1|123456")).toBe(
      "abc3f51c2208c45cc0d793432c4bbdec06aff4aa63a6bf09429fd89c914a4063",
    );
    // R39 S7: vendor e-sign link token, code and browser binding (inputs as
    // vendor-esign-core builds them). Golden values from the same independent
    // Python RFC 5869 implementation, which also reproduces the esignOtp value.
    expect(keyedHasher("vendorEsignToken", "fixed-test-key")!("vesign-token|" + "A".repeat(43))).toBe(
      "8c66fb7001549ab223c381897f71d2db8cafdc317270f199fc1cc60080dec7e0",
    );
    expect(keyedHasher("vendorEsignOtp", "fixed-test-key")!("vesign-otp|I1|123456")).toBe(
      "52934928fbccb900b33e6867235b7f3a258cd2279653db39bd67ecd3c0c5f21f",
    );
    expect(keyedHasher("vendorEsignBrowser", "fixed-test-key")!("vesign-browser|I1|BBBB")).toBe(
      "fe1f88501e4bf47befa17a3deda58a2f305827e756b7e0687dd684fe571f8de6",
    );
    expect(deriveKey("achAccountKey", "fixed-test-key")!.length).toBe(32);
  });
  it("reads DATA_ENCRYPTION_KEY from the environment and fails closed without it", () => {
    const old = process.env.DATA_ENCRYPTION_KEY;
    try {
      delete process.env.DATA_ENCRYPTION_KEY;
      expect(keyedHasher("achRekeyFingerprint")).toBeNull();
      process.env.DATA_ENCRYPTION_KEY = "env-key";
      expect(keyedHasher("achRekeyFingerprint")!("x")).toBe(keyedHasher("achRekeyFingerprint", "env-key")!("x"));
    } finally {
      if (old === undefined) delete process.env.DATA_ENCRYPTION_KEY;
      else process.env.DATA_ENCRYPTION_KEY = old;
    }
  });
});
