/**
 * tests/compliance/set-password-core.test.ts
 *
 * Vitest mirror for the GW-017 invite-flow pure core: URL-fragment
 * classification (Supabase legacy invite links deliver session tokens in the
 * fragment), password validation for the set-password page, and the site
 * base-URL resolver used to build the invite redirectTo.
 */
import { describe, expect, it } from "vitest";
import {
  parseAuthFragment,
  validateNewPassword,
  resolveSiteBase,
  PASSWORD_MIN_LENGTH,
  __runSetPasswordCoreTests,
} from "@/lib/auth/set-password-core";

describe("parseAuthFragment", () => {
  it("extracts a complete token pair", () => {
    const r = parseAuthFragment(
      "#access_token=aaa&refresh_token=bbb&expires_in=3600&token_type=bearer&type=invite",
    );
    expect(r).toEqual({ kind: "tokens", accessToken: "aaa", refreshToken: "bbb" });
  });

  it("parses without a leading #", () => {
    expect(parseAuthFragment("access_token=x&refresh_token=y").kind).toBe("tokens");
  });

  it("classifies GoTrue error fragments, with friendly expiry wording", () => {
    const r = parseAuthFragment(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("expired");
  });

  it("keeps the error_description for generic errors", () => {
    const r = parseAuthFragment("#error=server_error&error_description=Something+went+wrong");
    expect(r).toEqual({ kind: "error", message: "Something went wrong" });
  });

  it("error takes precedence over tokens", () => {
    expect(
      parseAuthFragment("#access_token=a&refresh_token=b&error=access_denied").kind,
    ).toBe("error");
  });

  it("treats half a token pair as an error, not none", () => {
    expect(parseAuthFragment("#access_token=only").kind).toBe("error");
    expect(parseAuthFragment("#refresh_token=only").kind).toBe("error");
  });

  it("returns none for empty or unrelated fragments", () => {
    expect(parseAuthFragment("").kind).toBe("none");
    expect(parseAuthFragment("#").kind).toBe("none");
    expect(parseAuthFragment("#section-2").kind).toBe("none");
  });
});

describe("validateNewPassword", () => {
  it("rejects empty, all-space, short, and mismatched passwords", () => {
    expect(validateNewPassword("", "").ok).toBe(false);
    expect(validateNewPassword("        ", "        ").ok).toBe(false);
    expect(validateNewPassword("abcdefg", "abcdefg").ok).toBe(false);
    expect(validateNewPassword("abcdefgh", "different").ok).toBe(false);
  });

  it("accepts a matching password at the minimum length", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(validateNewPassword("abcdefgh", "abcdefgh").ok).toBe(true);
  });

  it("gives a friendly mismatch reason", () => {
    const r = validateNewPassword("abcdefgh", "abcdefgX");
    expect(r).toEqual({ ok: false, reason: "The two passwords don't match." });
  });
});

describe("resolveSiteBase", () => {
  it("prefers NEXT_PUBLIC_SITE_URL and strips trailing slashes", () => {
    expect(
      resolveSiteBase({
        envSiteUrl: "https://greenwaymarijuana.com/",
        forwardedProto: "https",
        forwardedHost: "preview.vercel.app",
        host: "preview.vercel.app",
      }),
    ).toBe("https://greenwaymarijuana.com");
  });

  it("falls back to x-forwarded-host, then host, defaulting to https", () => {
    expect(
      resolveSiteBase({
        envSiteUrl: "",
        forwardedProto: "https",
        forwardedHost: "greenway-git-fix.vercel.app",
        host: "internal:3000",
      }),
    ).toBe("https://greenway-git-fix.vercel.app");
    expect(
      resolveSiteBase({
        envSiteUrl: undefined,
        forwardedProto: null,
        forwardedHost: null,
        host: "greenwaymarijuana.com",
      }),
    ).toBe("https://greenwaymarijuana.com");
  });

  it("ignores a malformed env URL and returns empty when nothing usable", () => {
    expect(
      resolveSiteBase({
        envSiteUrl: "not-a-url",
        forwardedProto: "https",
        forwardedHost: "site.example",
        host: null,
      }),
    ).toBe("https://site.example");
    expect(
      resolveSiteBase({ envSiteUrl: "", forwardedProto: null, forwardedHost: null, host: null }),
    ).toBe("");
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runSetPasswordCoreTests()).not.toThrow();
  });
});
