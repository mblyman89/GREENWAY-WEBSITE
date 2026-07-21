/**
 * tests/compliance/login-messages-core.test.ts
 *
 * Vitest mirror for the GW-018 anti-enumeration core: with
 * `shouldCreateUser: false` on the public login form, the Auth server
 * answers unknown emails with `otp_disabled` ("Signups not allowed for
 * otp"). Showing that verbatim would turn the login page into a staff-
 * directory oracle — this module folds those responses into the same
 * neutral "check your email" screen a real staffer sees, while keeping
 * actionable errors (rate limits, misconfig) visible.
 */
import { describe, expect, it } from "vitest";
import {
  classifyMagicLinkError,
  __runLoginMessagesCoreTests,
} from "@/lib/auth/login-messages-core";

describe("classifyMagicLinkError", () => {
  it("folds unknown-email refusals into a neutral outcome (no existence leak)", () => {
    // The exact server behavior for shouldCreateUser:false + unknown email
    // (supabase/auth internal/api/otp.go): 422, code otp_disabled.
    expect(classifyMagicLinkError("otp_disabled", "Signups not allowed for otp")).toEqual({
      kind: "neutral",
    });
    expect(
      classifyMagicLinkError("signup_disabled", "Signups not allowed for this instance"),
    ).toEqual({ kind: "neutral" });
  });

  it("recognizes the legacy message when no error code is present", () => {
    expect(classifyMagicLinkError(undefined, "Signups not allowed for otp").kind).toBe("neutral");
    expect(classifyMagicLinkError(undefined, "Signup not allowed for this instance").kind).toBe(
      "neutral",
    );
  });

  it("keeps rate limits visible with friendly wording", () => {
    const r = classifyMagicLinkError("over_email_send_rate_limit", "email rate limit exceeded");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("wait a minute");
    expect(classifyMagicLinkError("over_request_rate_limit", "").kind).toBe("error");
  });

  it("passes other errors through unchanged, with a fallback for blank messages", () => {
    const r = classifyMagicLinkError("validation_failed", "Unable to validate email address");
    expect(r).toEqual({ kind: "error", message: "Unable to validate email address" });
    const blank = classifyMagicLinkError(undefined, "");
    expect(blank.kind).toBe("error");
    if (blank.kind === "error") expect(blank.message.length).toBeGreaterThan(0);
  });

  it("does not go neutral on unrelated messages", () => {
    expect(classifyMagicLinkError(undefined, "Could not reach the server").kind).toBe("error");
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runLoginMessagesCoreTests()).not.toThrow();
  });
});
