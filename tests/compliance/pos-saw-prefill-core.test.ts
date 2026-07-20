/**
 * POS Slice 6 — SAW username helper for the DOH medical-verification step.
 *
 * Runs the full pure self-test suite, then pins the safety-critical behaviour:
 * we surface the signed-in employee's OWN SAW username (never a password),
 * sanitize untrusted stored values fail-safe, and always open SAW's canonical
 * login URL (no invented pre-fill query param, which would silently do nothing).
 */
import { describe, expect, it } from "vitest";

import {
  __runSawPrefillCoreTests,
  SAW_LOGIN_URL,
  sanitizeSawUsername,
  hasSawUsername,
  buildSawLoginUrl,
  sawUsernameHint,
} from "@/lib/pos/saw-prefill-core";

describe("saw-prefill-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runSawPrefillCoreTests()).not.toThrow();
  });
});

describe("saw username handling", () => {
  it("opens the canonical SAW login URL with no query params", () => {
    expect(SAW_LOGIN_URL).toBe("https://secureaccess.wa.gov/");
    expect(SAW_LOGIN_URL.includes("?")).toBe(false);
    expect(buildSawLoginUrl("jsmith")).toBe(SAW_LOGIN_URL);
  });

  it("sanitizes usernames fail-safe", () => {
    expect(sanitizeSawUsername("jsmith")).toBe("jsmith");
    expect(sanitizeSawUsername("  j smith ")).toBe("jsmith");
    expect(sanitizeSawUsername("")).toBeNull();
    expect(sanitizeSawUsername(null)).toBeNull();
    expect(sanitizeSawUsername(42 as unknown)).toBeNull();
  });

  it("reports presence correctly", () => {
    expect(hasSawUsername("jsmith")).toBe(true);
    expect(hasSawUsername("   ")).toBe(false);
  });

  it("names the login when known and never mentions a password", () => {
    expect(sawUsernameHint("jsmith")).toContain("jsmith");
    expect(sawUsernameHint(null).toLowerCase()).not.toContain("password");
  });
});
