/**
 * Vitest mirror of pos/cors-core (Capacitor Phase 0).
 *
 * Locks the cross-origin policy for /api/pos/*. This is a SECURITY boundary:
 * the POS API authenticates with device headers, so an over-permissive CORS
 * policy would let any website on the internet drive the register API with a
 * stolen device key. These tests exist to make that regression impossible.
 */
import { describe, expect, it } from "vitest";

import {
  CAPACITOR_IOS_ORIGIN,
  CAPACITOR_ANDROID_ORIGIN,
  CAPACITOR_LEGACY_IONIC_ORIGIN,
  NATIVE_POS_ORIGINS,
  POS_ALLOWED_HEADERS,
  POS_ALLOWED_METHODS,
  POS_PREFLIGHT_MAX_AGE_SECONDS,
  buildPosAllowedOrigins,
  isAllowedPosOrigin,
  normalizeOrigin,
  posCorsHeaders,
  posPreflightHeaders,
  posPreflightStatus,
  __runPosCorsCoreTests,
} from "@/lib/pos/cors-core";

const PROD = "https://greenwaymarijuana.com";

describe("pos/cors-core", () => {
  it("passes its embedded pure self-tests", () => {
    const r = __runPosCorsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  it("pins the documented Capacitor v8 default origins", () => {
    // Source: capacitorjs.com/docs/config — iosScheme default "capacitor",
    // androidScheme default "https". Changing these breaks the native app.
    expect(CAPACITOR_IOS_ORIGIN).toBe("capacitor://localhost");
    expect(CAPACITOR_ANDROID_ORIGIN).toBe("https://localhost");
    expect(CAPACITOR_LEGACY_IONIC_ORIGIN).toBe("ionic://localhost");
    expect(NATIVE_POS_ORIGINS).toHaveLength(3);
  });

  it("pins the policy values", () => {
    expect(POS_ALLOWED_METHODS).toEqual(["GET", "POST", "OPTIONS"]);
    expect(POS_ALLOWED_HEADERS).toEqual(["content-type", "x-pos-device-id", "x-pos-device-key"]);
    expect(POS_PREFLIGHT_MAX_AGE_SECONDS).toBe(86400);
  });

  it("allows the native app and the production site", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(isAllowedPosOrigin(CAPACITOR_IOS_ORIGIN, allowed)).toBe(true);
    expect(isAllowedPosOrigin(CAPACITOR_ANDROID_ORIGIN, allowed)).toBe(true);
    expect(isAllowedPosOrigin(PROD, allowed)).toBe(true);
  });

  it("NEVER allows a wildcard origin", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(allowed).not.toContain("*");
    expect(isAllowedPosOrigin("*", allowed)).toBe(false);
    expect(posCorsHeaders(PROD, allowed)["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("NEVER sends Access-Control-Allow-Credentials (cookie-CSRF immunity)", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(posCorsHeaders(PROD, allowed)).not.toHaveProperty("Access-Control-Allow-Credentials");
    expect(posPreflightHeaders(PROD, allowed)).not.toHaveProperty(
      "Access-Control-Allow-Credentials",
    );
  });

  it.each([
    ["suffix attack", "https://greenwaymarijuana.com.evil.com"],
    ["prefix attack", "https://evil-greenwaymarijuana.com"],
    ["subdomain attack", "https://evil.greenwaymarijuana.com"],
    ["http downgrade", "http://greenwaymarijuana.com"],
    ["port mismatch", "https://greenwaymarijuana.com:8443"],
    ["hostile scheme on localhost", "evil://localhost"],
    ["plain http localhost", "http://localhost"],
    ["fragment smuggling", "https://x.com#https://localhost"],
    ["literal null origin", "null"],
    ["unrelated site", "https://evil.com"],
  ])("denies %s", (_label, origin) => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(isAllowedPosOrigin(origin, allowed)).toBe(false);
    expect(posCorsHeaders(origin, allowed)).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(posPreflightStatus(origin, allowed)).toBe(403);
  });

  it("always sets Vary: Origin, even when denying", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(posCorsHeaders(PROD, allowed)["Vary"]).toBe("Origin");
    expect(posCorsHeaders("https://evil.com", allowed)["Vary"]).toBe("Origin");
    expect(posCorsHeaders(null, allowed)["Vary"]).toBe("Origin");
  });

  it("leaks nothing on a denied preflight", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    const denied = posPreflightHeaders("https://evil.com", allowed);
    expect(denied).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(denied).not.toHaveProperty("Access-Control-Allow-Methods");
    expect(denied).not.toHaveProperty("Access-Control-Allow-Headers");
    expect(denied).not.toHaveProperty("Access-Control-Max-Age");
  });

  it("answers an allowed preflight with 204 and the full policy", () => {
    const allowed = buildPosAllowedOrigins(PROD);
    expect(posPreflightStatus(CAPACITOR_IOS_ORIGIN, allowed)).toBe(204);
    const pre = posPreflightHeaders(CAPACITOR_IOS_ORIGIN, allowed);
    expect(pre["Access-Control-Allow-Origin"]).toBe(CAPACITOR_IOS_ORIGIN);
    expect(pre["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    expect(pre["Access-Control-Allow-Headers"]).toContain("x-pos-device-key");
    expect(pre["Access-Control-Max-Age"]).toBe("86400");
  });

  it("degrades safely when NEXT_PUBLIC_SITE_URL is missing", () => {
    for (const v of [undefined, null, "", "   "]) {
      const allowed = buildPosAllowedOrigins(v);
      expect(allowed).toHaveLength(3);
      expect(allowed).not.toContain("*");
      // The native app must still work with no site URL configured.
      expect(isAllowedPosOrigin(CAPACITOR_IOS_ORIGIN, allowed)).toBe(true);
    }
  });

  it("keeps only the origin when a full URL with a path is configured", () => {
    const allowed = buildPosAllowedOrigins("https://greenwaymarijuana.com/pos?x=1");
    expect(allowed).toContain(PROD);
    expect(allowed.some((o) => o.includes("/pos"))).toBe(false);
  });

  it("normalizes origins for comparison without being sloppy", () => {
    expect(normalizeOrigin("  HTTPS://A.COM/  ")).toBe("https://a.com");
    expect(normalizeOrigin(null)).toBe("");
    // Normalization must not turn a hostile origin into an allowed one.
    const allowed = buildPosAllowedOrigins(PROD);
    expect(isAllowedPosOrigin("  HTTPS://GREENWAYMARIJUANA.COM/  ", allowed)).toBe(true);
    expect(isAllowedPosOrigin("  https://evil.com/  ", allowed)).toBe(false);
  });

  it("does not double-register an origin already in the native list", () => {
    expect(buildPosAllowedOrigins(CAPACITOR_IOS_ORIGIN)).toHaveLength(3);
  });
});
