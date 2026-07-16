/**
 * AN-0 — versioned register service worker (vitest mirror).
 *
 * Mirrors the pure self-tests in src/lib/pos/sw-core.ts and pins the update
 * contract: versioned cache names per deploy, NO install-time skipWaiting
 * (an update can never activate mid-sale), message-driven activation only,
 * and the B11 offline-boot + never-touch-/api/* behavior preserved.
 */
import { describe, expect, it } from "vitest";
import {
  DEV_SW_VERSION,
  __runSwCoreTests,
  buildPosServiceWorkerSource,
  posSwCacheNames,
  resolveBuildVersion,
  sanitizeSwVersion,
} from "../../src/lib/pos/sw-core";

describe("sw-core (AN-0)", () => {
  it("passes its pure self-tests", () => {
    expect(() => __runSwCoreTests()).not.toThrow();
  });

  it("sanitizes untrusted versions and degrades garbage to dev", () => {
    expect(sanitizeSwVersion("abc1234")).toBe("abc1234");
    expect(sanitizeSwVersion("ABC-123")).toBe("abc-123");
    expect(sanitizeSwVersion("../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeSwVersion("")).toBe(DEV_SW_VERSION);
    expect(sanitizeSwVersion(undefined)).toBe(DEV_SW_VERSION);
    expect(sanitizeSwVersion("x".repeat(50))).toHaveLength(12);
  });

  it("resolves the Vercel commit SHA to a 7-char version, dev otherwise", () => {
    expect(resolveBuildVersion({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456");
    expect(resolveBuildVersion({})).toBe(DEV_SW_VERSION);
  });

  it("embeds the version in both cache names", () => {
    expect(posSwCacheNames("abc1234")).toEqual({
      shell: "gw-pos-shell-abc1234",
      assets: "gw-pos-assets-abc1234",
    });
  });

  it("never auto-activates: the only skipWaiting call is message-driven", () => {
    const src = buildPosServiceWorkerSource("abc1234");
    expect(src.match(/skipWaiting\(\)/g)).toHaveLength(1);
    const installBlock = src.slice(src.indexOf('"install"'), src.indexOf('"message"'));
    expect(installBlock).not.toContain("skipWaiting");
    expect(src).toContain('type === "SKIP_WAITING"');
  });

  it("preserves the B11 contract: offline shell fallback, cache-first assets, /api/* untouched", () => {
    const src = buildPosServiceWorkerSource("abc1234");
    expect(src).toContain('caches.match("/pos")');
    expect(src).toContain('url.pathname.startsWith("/_next/static/")');
    expect(src).toContain('url.pathname.startsWith("/api/")');
    expect(src).toContain("clients.claim()");
  });

  it("produces byte-different workers per version (the browser's update signal)", () => {
    expect(buildPosServiceWorkerSource("abc1234")).not.toBe(buildPosServiceWorkerSource("def5678"));
  });
});
