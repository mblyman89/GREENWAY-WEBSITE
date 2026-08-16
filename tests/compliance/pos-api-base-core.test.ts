/**
 * Vitest mirror of pos/api-base-core + pos-fetch (Capacitor Phase 0, AB-1).
 *
 * This is the seam that lets ONE copy of the register code run both as the
 * browser PWA and as the packaged iPad app. Two properties must never break:
 *
 *   1. NO WEB REGRESSION. With no configuration, every URL is byte-for-byte
 *      what the shell produced before this seam existed.
 *   2. NO INSECURE OR MALFORMED BASE. A POS carries customer PII and device
 *      keys, so an http:// or malformed base is refused, not silently used.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildApiUrl,
  describeApiBase,
  isCrossOriginApi,
  resolveApiBase,
  __runPosApiBaseCoreTests,
} from "@/lib/pos/api-base-core";
import {
  configurePosApiBase,
  describePosApiBase,
  getPosApiBase,
  isPosApiCrossOrigin,
  posApiUrl,
  posFetch,
} from "@/lib/pos/pos-fetch";

const PROD = "https://greenwaymarijuana.com";

/** Every endpoint the register actually calls. */
const ENDPOINTS = [
  "/api/pos/sync",
  "/api/pos/unlock",
  "/api/pos/menu",
  "/api/pos/till",
  "/api/pos/void",
  "/api/pos/returns",
  "/api/pos/witness",
  "/api/pos/approve",
  "/api/pos/loyalty",
  "/api/pos/pickup",
  "/api/pos/day-report",
  "/api/pos/version",
  "/api/pos/leaderboard",
  "/api/pos/stock-flag",
  "/api/pos/email-receipt",
  "/api/pos/member",
  "/api/pos/member-match",
  "/api/pos/member-history",
  "/api/pos/product-image",
];

describe("pos/api-base-core", () => {
  it("passes its embedded pure self-tests", () => {
    const r = __runPosApiBaseCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  describe("no web regression (the browser PWA must be untouched)", () => {
    it.each([undefined, null, "", "   "])("base %p leaves paths exactly as-is", (v) => {
      const { base } = resolveApiBase(v);
      expect(base).toBe("");
      for (const e of ENDPOINTS) {
        expect(buildApiUrl(base, e)).toBe(e);
      }
    });

    it("preserves query strings untouched when same-origin", () => {
      const p = `/api/pos/member?q=${encodeURIComponent("Smith & Sons, #4")}`;
      expect(buildApiUrl("", p)).toBe(p);
    });
  });

  describe("packaged app (absolute base)", () => {
    it("prefixes every endpoint exactly once", () => {
      for (const e of ENDPOINTS) {
        const url = buildApiUrl(PROD, e);
        expect(url).toBe(`${PROD}${e}`);
        expect(url).not.toContain(".com//");
        expect(new URL(url).host).toBe("greenwaymarijuana.com");
      }
    });

    it("never produces a double slash regardless of trailing slashes", () => {
      for (const b of [PROD, `${PROD}/`, `${PROD}//`, `${PROD}///`]) {
        expect(buildApiUrl(b, "/api/pos/sync")).toBe(`${PROD}/api/pos/sync`);
      }
    });

    it("passes encoded query strings through byte-for-byte", () => {
      const p = `/api/pos/member?q=${encodeURIComponent("A & B #1")}`;
      expect(buildApiUrl(PROD, p)).toBe(`${PROD}${p}`);
    });
  });

  describe("security: refuses anything unsafe", () => {
    it.each([
      ["plain http on a public host", "http://greenwaymarijuana.com"],
      ["ftp", "ftp://greenwaymarijuana.com"],
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:text/html,x"],
      ["file:", "file:///etc/passwd"],
      ["garbage", "not a url"],
      ["bare host", "greenwaymarijuana.com"],
      ["scheme-relative", "//greenwaymarijuana.com"],
    ])("refuses %s and falls back to same-origin", (_label, value) => {
      const r = resolveApiBase(value);
      expect(r.ok).toBe(false);
      expect(r.base).toBe("");
      if (!r.ok) expect(r.error.length).toBeGreaterThan(20);
    });

    it.each([
      ["a path", `${PROD}/pos`],
      ["a query", `${PROD}/?x=1`],
      ["a hash", `${PROD}/#x`],
      ["a deep path", `${PROD}/a/b/c`],
    ])("refuses a base containing %s", (_label, value) => {
      expect(resolveApiBase(value).ok).toBe(false);
    });

    it("allows http ONLY on localhost (developer convenience)", () => {
      expect(resolveApiBase("http://localhost:3000").ok).toBe(true);
      expect(resolveApiBase("http://127.0.0.1:3000").ok).toBe(true);
      expect(resolveApiBase("http://example.com").ok).toBe(false);
    });

    it("a refused base can never leak into a built URL", () => {
      const r = resolveApiBase("http://evil.com");
      expect(buildApiUrl(r.base, "/api/pos/sync")).toBe("/api/pos/sync");
    });
  });

  describe("normalization", () => {
    it("strips a trailing slash and lowercases the host", () => {
      expect(resolveApiBase(`${PROD}/`).base).toBe(PROD);
      expect(resolveApiBase("HTTPS://GREENWAYMARIJUANA.COM").base).toBe(PROD);
    });

    it("preserves a non-default port", () => {
      expect(resolveApiBase("https://example.com:8443").base).toBe("https://example.com:8443");
    });
  });

  describe("helpers", () => {
    it("reports cross-origin only when a base is set", () => {
      expect(isCrossOriginApi("")).toBe(false);
      expect(isCrossOriginApi(PROD)).toBe(true);
    });

    it("describes the destination in plain English", () => {
      expect(describeApiBase("").toLowerCase()).toContain("same website");
      expect(describeApiBase(PROD)).toContain(PROD);
    });
  });
});

describe("pos-fetch (module seam)", () => {
  beforeEach(() => {
    configurePosApiBase(""); // reset to the safe default between tests
  });

  it("defaults to same-origin", () => {
    expect(getPosApiBase()).toBe("");
    expect(isPosApiCrossOrigin()).toBe(false);
    expect(posApiUrl("/api/pos/sync")).toBe("/api/pos/sync");
  });

  it("applies a configured absolute base to every endpoint", () => {
    const r = configurePosApiBase(PROD);
    expect(r.ok).toBe(true);
    expect(isPosApiCrossOrigin()).toBe(true);
    for (const e of ENDPOINTS) {
      expect(posApiUrl(e)).toBe(`${PROD}${e}`);
    }
  });

  it("falls back to same-origin (and reports why) on a bad base", () => {
    const r = configurePosApiBase("http://greenwaymarijuana.com");
    expect(r.ok).toBe(false);
    // The register still works rather than being unable to talk at all.
    expect(getPosApiBase()).toBe("");
    expect(posApiUrl("/api/pos/sync")).toBe("/api/pos/sync");
  });

  it("is idempotent — reconfiguring the same value changes nothing", () => {
    configurePosApiBase(PROD);
    const first = posApiUrl("/api/pos/sync");
    configurePosApiBase(PROD);
    expect(posApiUrl("/api/pos/sync")).toBe(first);
  });

  // Every rejected shape must land on same-origin, not just the http:// one.
  it.each([
    ["plain http on a public host", "http://greenwaymarijuana.com"],
    ["not a URL at all", "not a url"],
    ["a path in the base", "https://greenwaymarijuana.com/api"],
    ["a query in the base", "https://greenwaymarijuana.com/?a=1"],
    ["a hash in the base", "https://greenwaymarijuana.com/#x"],
    ["a non-web protocol", "ftp://greenwaymarijuana.com"],
  ])("never adopts a rejected base: %s", (_label, bad) => {
    const r = configurePosApiBase(bad);
    expect(r.ok).toBe(false);
    expect(getPosApiBase()).toBe("");
    expect(isPosApiCrossOrigin()).toBe(false);
    expect(posApiUrl("/api/pos/sync")).toBe("/api/pos/sync");
  });

  // A register that was pointed somewhere valid must NOT keep using that old
  // address after a later, invalid reconfigure. Stale state is a silent
  // mis-route: the till would keep talking to yesterday's server.
  it("clears a previously good base when a later base is rejected", () => {
    configurePosApiBase(PROD);
    expect(getPosApiBase()).toBe(PROD);

    configurePosApiBase("http://greenwaymarijuana.com");
    expect(getPosApiBase()).toBe("");
    expect(posApiUrl("/api/pos/sync")).toBe("/api/pos/sync");
  });

  it("treats null and undefined as same-origin", () => {
    expect(configurePosApiBase(null).ok).toBe(true);
    expect(getPosApiBase()).toBe("");
    expect(configurePosApiBase(undefined).ok).toBe(true);
    expect(getPosApiBase()).toBe("");
  });

  it("explains the current base in plain English", () => {
    expect(describePosApiBase().length).toBeGreaterThan(0);
    configurePosApiBase(PROD);
    expect(describePosApiBase()).toContain("greenwaymarijuana.com");
  });

  describe("posFetch", () => {
    it("calls fetch with the relative path when same-origin", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        await posFetch("/api/pos/sync", { method: "POST" });
      } finally {
        globalThis.fetch = original;
      }

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("/api/pos/sync");
      expect(calls[0].init?.method).toBe("POST");
    });

    it("calls fetch with the absolute URL when a base is configured", async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        configurePosApiBase(PROD);
        await posFetch("/api/pos/sync");
      } finally {
        globalThis.fetch = original;
      }

      expect(calls).toEqual([`${PROD}/api/pos/sync`]);
    });

    // The packaged iPad app is useless if even ONE endpoint forgets the base:
    // that call would go to capacitor://localhost and fail at the counter.
    it("prefixes EVERY register endpoint when packaged", async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        configurePosApiBase(PROD);
        for (const e of ENDPOINTS) {
          await posFetch(e);
        }
      } finally {
        globalThis.fetch = original;
      }

      expect(calls).toEqual(ENDPOINTS.map((e) => `${PROD}${e}`));
    });

    it("leaves EVERY register endpoint relative in the browser", async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        for (const e of ENDPOINTS) {
          await posFetch(e);
        }
      } finally {
        globalThis.fetch = original;
      }

      expect(calls).toEqual(ENDPOINTS);
    });

    it("keeps query strings intact through the seam", async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        await posFetch("/api/pos/member?phone=360%20555%201234");
        configurePosApiBase(PROD);
        await posFetch("/api/pos/member?phone=360%20555%201234");
      } finally {
        globalThis.fetch = original;
      }

      expect(calls).toEqual([
        "/api/pos/member?phone=360%20555%201234",
        `${PROD}/api/pos/member?phone=360%20555%201234`,
      ]);
    });

    it("passes headers and body through untouched", async () => {
      let seen: RequestInit | undefined;
      const original = globalThis.fetch;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        seen = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", "x-pos-device-id": "d1" },
        body: JSON.stringify({ a: 1 }),
      };

      try {
        await posFetch("/api/pos/unlock", init);
      } finally {
        globalThis.fetch = original;
      }

      expect(seen?.headers).toEqual({
        "content-type": "application/json",
        "x-pos-device-id": "d1",
      });
      expect(seen?.body).toBe(JSON.stringify({ a: 1 }));
    });

    it("does not add credentials, headers, or retries of its own", async () => {
      let seen: RequestInit | undefined;
      const original = globalThis.fetch;
      let callCount = 0;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        callCount += 1;
        seen = init;
        return Promise.resolve(new Response("nope", { status: 500 }));
      }) as typeof fetch;

      try {
        await posFetch("/api/pos/sync");
      } finally {
        globalThis.fetch = original;
      }

      // A 500 must surface to the caller's existing retry logic, not be
      // swallowed or silently retried inside the seam.
      expect(callCount).toBe(1);
      expect(seen).toBeUndefined();
    });

    it("lets fetch rejections propagate to the caller", async () => {
      const original = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.reject(new Error("offline"))) as typeof fetch;

      try {
        await expect(posFetch("/api/pos/sync")).rejects.toThrow("offline");
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
