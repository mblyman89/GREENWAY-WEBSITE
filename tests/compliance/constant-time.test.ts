/**
 * Vitest mirror of the constant-time pure self-tests (GW-022).
 * Locks the shared-secret token comparison used by the CloudPRNT printer
 * endpoint and the inbound-email webhook: equal tokens match, everything
 * else (diff, prefix, empty, missing) is rejected — with no early-exit
 * string comparison that could leak token prefixes through response timing.
 */
import { describe, expect, it } from "vitest";

import { timingSafeEqualStr, __runConstantTimeTests } from "@/lib/security/constant-time";

describe("constant-time", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runConstantTimeTests()).not.toThrow();
  });

  it("matches only exactly-equal tokens", () => {
    expect(timingSafeEqualStr("secret-token", "secret-token")).toBe(true);
    expect(timingSafeEqualStr("secret-token", "secret-tokeX")).toBe(false);
    expect(timingSafeEqualStr("secret", "secret-token")).toBe(false);
  });

  it("never matches when either side is empty or missing", () => {
    expect(timingSafeEqualStr("", "")).toBe(false);
    expect(timingSafeEqualStr(null, "secret")).toBe(false);
    expect(timingSafeEqualStr("secret", undefined)).toBe(false);
  });

  it("handles multibyte UTF-8 correctly", () => {
    expect(timingSafeEqualStr("emoji-🔒-token", "emoji-🔒-token")).toBe(true);
    expect(timingSafeEqualStr("emoji-🔒-token", "emoji-🔓-token")).toBe(false);
  });
});
