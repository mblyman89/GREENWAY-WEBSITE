/**
 * Vitest mirror of pos/register-host-core (Capacitor Phase 0.3).
 *
 * This module decides how the packaged iPad register boots. The properties
 * below are the ones that keep a till working and a sale recorded:
 *
 *   1. The browser PWA must be COMPLETELY unaffected. No configuration, no
 *      change in behavior, ever.
 *   2. A packaged app that was built without a working server address must
 *      refuse to boot LOUDLY, with a plain-English explanation — never boot
 *      into a state where every request silently fails at the counter.
 *   3. A fatal result must not expose an apiBase at all, so no caller can
 *      accidentally start the register with a dead same-origin base.
 *
 * These are written independently of the module's embedded self-tests so a
 * mistake has to survive two separate encodings of the same rules.
 */
import { describe, expect, it } from "vitest";

import {
  detectRegisterPlatform,
  resolveRegisterHostConfig,
  shouldRegisterServiceWorker,
  __runRegisterHostCoreTests,
} from "@/lib/pos/register-host-core";

const PROD = "https://greenwaymarijuana.com";

/** The two origins Capacitor v8 actually serves the app from. */
const IOS_ORIGIN = { protocol: "capacitor:", hostname: "localhost", port: "" };
const ANDROID_ORIGIN = { protocol: "https:", hostname: "localhost", port: "" };
/** The real website. */
const WEB_ORIGIN = { protocol: "https:", hostname: "greenwaymarijuana.com", port: "" };

describe("pos/register-host-core", () => {
  it("passes its embedded pure self-tests", () => {
    const r = __runRegisterHostCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  describe("platform detection (observed, never declared)", () => {
    it.each([
      ["iOS capacitor scheme", IOS_ORIGIN],
      ["Android portless https://localhost", ANDROID_ORIGIN],
    ])("treats %s as native", (_label, loc) => {
      expect(detectRegisterPlatform(loc)).toBe("native");
    });

    it.each([
      ["the production website", WEB_ORIGIN],
      ["next dev", { protocol: "http:", hostname: "localhost", port: "3000" }],
      ["vite dev", { protocol: "http:", hostname: "localhost", port: "5173" }],
      ["https localhost WITH a port", { protocol: "https:", hostname: "localhost", port: "5173" }],
      ["a vercel preview", { protocol: "https:", hostname: "greenwaywebsite1.vercel.app", port: "" }],
      ["a lookalike host", { protocol: "https:", hostname: "localhost.evil.com", port: "" }],
      ["file protocol", { protocol: "file:", hostname: "", port: "" }],
    ])("treats %s as web", (_label, loc) => {
      expect(detectRegisterPlatform(loc)).toBe("web");
    });

    it("degrades junk to web (the safe direction)", () => {
      expect(detectRegisterPlatform({})).toBe("web");
      expect(detectRegisterPlatform({ protocol: null, hostname: 7, port: [] })).toBe("web");
    });
  });

  describe("the browser PWA must not change at all", () => {
    it.each([undefined, null, {}, { apiBase: "" }, { apiBase: "   " }])(
      "config %p keeps the browser on same-origin",
      (cfg) => {
        const r = resolveRegisterHostConfig(cfg, WEB_ORIGIN);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.platform).toBe("web");
          expect(r.apiBase).toBe("");
        }
      },
    );

    it.each([
      ["insecure http", "http://greenwaymarijuana.com"],
      ["garbage", "not a url"],
      ["a base with a path", `${PROD}/pos`],
    ])("never dies in the browser on %s — it degrades and keeps selling", (_l, bad) => {
      const r = resolveRegisterHostConfig({ apiBase: bad }, WEB_ORIGIN);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.apiBase).toBe("");
    });
  });

  describe("the packaged app must refuse to boot when it cannot possibly work", () => {
    it.each([
      ["iOS", IOS_ORIGIN],
      ["Android", ANDROID_ORIGIN],
    ])("%s: a build with no server address is fatal", (_label, loc) => {
      const r = resolveRegisterHostConfig({}, loc);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.platform).toBe("native");
        // Plain English, actionable, and blames the build not the hardware.
        expect(r.error).toContain("REGISTER_API_BASE");
        expect(r.error.length).toBeGreaterThan(60);
      }
    });

    it.each([
      ["insecure http would put PII on the wire", "http://greenwaymarijuana.com"],
      ["garbage", "not a url"],
      ["a non-web protocol", "ftp://greenwaymarijuana.com"],
      ["a base carrying a path", `${PROD}/pos`],
      ["scheme-relative", "//greenwaymarijuana.com"],
      ["a javascript: url", "javascript:alert(1)"],
    ])("iOS: refuses to boot on %s", (_label, bad) => {
      const r = resolveRegisterHostConfig({ apiBase: bad }, IOS_ORIGIN);
      expect(r.ok).toBe(false);
    });

    // THE key safety property. If a fatal result carried apiBase:"" then a
    // careless caller could ignore `ok` and boot a register whose every
    // request goes to capacitor://localhost and fails at the counter.
    it("a fatal result exposes no apiBase for anyone to misuse", () => {
      const r = resolveRegisterHostConfig({ apiBase: "http://x.com" }, IOS_ORIGIN);
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty("apiBase");
      expect(r).not.toHaveProperty("buildVersion");
    });

    it("boots normally once a valid https base is supplied", () => {
      const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "abc1234" }, IOS_ORIGIN);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.platform).toBe("native");
        expect(r.apiBase).toBe(PROD);
        expect(r.buildVersion).toBe("abc1234");
      }
    });

    it("normalizes ONE trailing slash so no URL is ever double-slashed", () => {
      const r = resolveRegisterHostConfig({ apiBase: `${PROD}/` }, IOS_ORIGIN);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.apiBase).toBe(PROD);
    });

    // "https://host//" is not a trailing slash, it is a base carrying the path
    // "//". api-base-core refuses any base with a path, and for the packaged
    // app a refusal is fatal by design — a typo in the build config must stop
    // the build being shipped, not produce a subtly wrong URL at the counter.
    it("refuses a base whose path is '//' rather than silently repairing it", () => {
      expect(resolveRegisterHostConfig({ apiBase: `${PROD}//` }, IOS_ORIGIN).ok).toBe(false);
    });

    it("allows http://localhost so a simulator can hit a laptop", () => {
      expect(resolveRegisterHostConfig({ apiBase: "http://localhost:3000" }, IOS_ORIGIN).ok).toBe(
        true,
      );
    });
  });

  describe("build version is informational and never fatal", () => {
    it.each([
      [undefined, "dev"],
      [null, "dev"],
      ["", "dev"],
      [123, "dev"],
      ["abc1234", "abc1234"],
      ["AB!!cd", "abcd"],
    ])("version %p resolves to %p", (input, expected) => {
      const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: input }, IOS_ORIGIN);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.buildVersion).toBe(expected);
    });
  });

  describe("descriptions are plain English for the diagnostics screen", () => {
    it("names the destination when packaged", () => {
      const r = resolveRegisterHostConfig({ apiBase: PROD }, IOS_ORIGIN);
      if (r.ok) expect(r.description).toContain(PROD);
    });

    it("says 'same website' for the untouched browser PWA", () => {
      const r = resolveRegisterHostConfig({}, WEB_ORIGIN);
      if (r.ok) expect(r.description.toLowerCase()).toContain("same website");
    });

    it("explains the fallback when a browser base was refused", () => {
      const r = resolveRegisterHostConfig({ apiBase: "http://x.com" }, WEB_ORIGIN);
      if (r.ok) expect(r.description.toLowerCase()).toContain("refused");
    });
  });

  describe("service worker registration", () => {
    // The browser PWA's offline boot depends on this worker. Turning it off by
    // accident would mean a register that cannot open without signal.
    it.each([
      ["the production website", WEB_ORIGIN],
      ["next dev", { protocol: "http:", hostname: "localhost", port: "3000" }],
    ])("still registers on %s", (_l, loc) => {
      expect(shouldRegisterServiceWorker(loc)).toBe(true);
    });

    // In the packaged app a worker would 404 on iOS and — worse — on Android
    // would install and could serve a cached shell in front of an App Store
    // update, leaving a till running code the owner thinks was replaced.
    it.each([
      ["iOS", IOS_ORIGIN],
      ["Android", ANDROID_ORIGIN],
    ])("never registers on packaged %s", (_l, loc) => {
      expect(shouldRegisterServiceWorker(loc)).toBe(false);
    });
  });

  it("is deterministic", () => {
    const a = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "a1b2c3d" }, IOS_ORIGIN);
    const b = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "a1b2c3d" }, IOS_ORIGIN);
    expect(a).toEqual(b);
  });
});
