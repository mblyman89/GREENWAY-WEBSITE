/**
 * tests/compliance/device-setup-core.test.ts  (POS Slice B25)
 *
 * Pins the register setup screen's credential shape-check: the device id is
 * a UUID and the key is a 32-char random string, so a field swap (the exact
 * mix-up that blocked the store's first provisioning) is detected and
 * corrected, pasted whitespace/zero-width characters are stripped, and
 * malformed input gets a human explanation before any network call.
 */
import { describe, it, expect } from "vitest";
import { checkSetupCredentials, __runDeviceSetupCoreTests } from "@/lib/pos/device-setup-core";

const ID = "59768c42-aa8c-4dab-8e6e-a2e766fe16b0";
const KEY = "RJH5doEHCd78c2fneJmS7vgKGb1TXWiA";

describe("setup credential shape-check", () => {
  it("accepts a correct id + key untouched", () => {
    const r = checkSetupCredentials(ID, KEY);
    expect(r.problem).toBeNull();
    expect(r.swapped).toBe(false);
    expect(r.deviceId).toBe(ID);
    expect(r.deviceKey).toBe(KEY);
  });
  it("detects and corrects the id/key field swap", () => {
    const r = checkSetupCredentials(KEY, ID);
    expect(r.swapped).toBe(true);
    expect(r.deviceId).toBe(ID);
    expect(r.deviceKey).toBe(KEY);
    expect(r.problem).toBeNull();
  });
  it("cleans pasted whitespace and zero-width characters", () => {
    expect(checkSetupCredentials(`  ${ID}\n`, `${KEY} \n`).problem).toBeNull();
    expect(checkSetupCredentials(`${ID}\u200b`, `\ufeff${KEY}`).problem).toBeNull();
  });
  it("explains a malformed id instead of a terse 401", () => {
    const r = checkSetupCredentials("register-1", KEY);
    expect(r.swapped).toBe(false);
    expect(r.problem).toContain("UUID");
  });
  it("a UUID in the key field points at key rotation", () => {
    const r = checkSetupCredentials(ID, "11111111-1111-4111-8111-111111111111");
    expect(r.problem).toContain("rotate");
  });
  it("catches empty and too-short values before the network call", () => {
    expect(checkSetupCredentials("", KEY).problem).not.toBeNull();
    expect(checkSetupCredentials(ID, "").problem).not.toBeNull();
    expect(checkSetupCredentials(ID, "shortkey").problem).toContain("too short");
  });
});

describe("B26 key-shape integrity (the 'Device key rejected.' field failure)", () => {
  it("names an out-of-alphabet character and calls out case sensitivity", () => {
    const r = checkSetupCredentials(ID, "RJH5doEHCd78c2fneJmS7vgKGb1TXWi.");
    expect(r.problem).toContain('"."');
    expect(r.problem).toContain("CASE-SENSITIVE");
  });
  it("counts a wrong-length key (missed or extra character)", () => {
    expect(checkSetupCredentials(ID, KEY.slice(0, 31)).problem).toContain("31 characters");
    expect(checkSetupCredentials(ID, `${KEY}X`).problem).toContain("33 characters");
  });
  it("normalizes iOS smart dashes back to ASCII hyphens in both fields", () => {
    expect(checkSetupCredentials(ID.replace(/-/g, "\u2013"), KEY).problem).toBeNull();
    const keyWithDash = "RJH5doEHCd78c2fneJmS7vgKGb1TXW-A";
    expect(checkSetupCredentials(ID, keyWithDash.replace("-", "\u2014")).problem).toBeNull();
  });
  it("accepts base64url specials (- and _) and the canonical key", () => {
    expect(checkSetupCredentials(ID, "A-b_C-d_E-f_G-h_I-j_K-l_M-n_O-p_").problem).toBeNull();
    expect(checkSetupCredentials(ID, KEY).problem).toBeNull();
  });
});

describe("embedded self-tests", () => {
  it("__runDeviceSetupCoreTests passes", () => {
    expect(() => __runDeviceSetupCoreTests()).not.toThrow();
  });
});
