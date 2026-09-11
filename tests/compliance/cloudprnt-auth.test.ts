/**
 * tests/compliance/cloudprnt-auth.test.ts
 *
 * D-68 — the CloudPRNT token collision.
 *
 * Two classes of test live here, on purpose:
 *
 *   1. BEHAVIOUR — the pure module resolves the poll token and the job token
 *      independently, even when a single request carries both.
 *
 *   2. WIRING (source greps) — the D-66 lesson: a flawless pure module proves
 *      nothing if the route still uses its own hand-rolled extractor. These
 *      tests read src/app/api/cloudprnt/route.ts and assert it actually
 *      delegates, that the old collision-causing fallback is gone, and that
 *      the security guards were not collateral damage of the refactor.
 *
 * Why this defect deserves its own file: the printer polls fine, is told a job
 * is ready, then is 401'd when it tries to fetch the body — so the queue
 * silently dead-ends while the admin heartbeat still reports "online". There
 * is no user-visible error to debug, only receipts that never appear.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  __runCloudPrntAuthCoreTests,
  authCredential,
  basicAuthPassword,
  extractCloudPrntToken,
  jobHandle,
} from "../../src/lib/printing/cloudprnt-auth-core";

const POLL = "poll-secret-abc123";
const JOB = "job-9f3e1c77-2b4a-4d51-8e6f-0a1b2c3d4e5f";

const basic = (user: string, pw: string) =>
  "Basic " + Buffer.from(`${user}:${pw}`, "utf8").toString("base64");

const ROUTE_PATH = path.resolve(__dirname, "../../src/app/api/cloudprnt/route.ts");
const routeSource = readFileSync(ROUTE_PATH, "utf8");

describe("cloudprnt-auth-core embedded self-tests", () => {
  it("all pass", () => {
    expect(() => __runCloudPrntAuthCoreTests()).not.toThrow();
  });
});

describe("the collision: one request, two different secrets", () => {
  // This is the exact request Star sends for the GET and DELETE steps: Basic
  // auth (configured once in the printer web UI) PLUS ?token=<jobToken>
  // (because our POST reply told it to).
  const starFetch = { authorizationHeader: basic("printer", POLL), queryToken: JOB };

  it("resolves the poll token for authentication, not the job token", () => {
    expect(authCredential(starFetch)).toBe(POLL);
  });

  it("resolves the job token for addressing, not the poll token", () => {
    expect(jobHandle(starFetch)).toBe(JOB);
  });

  it("never returns the same value for both uses of one request", () => {
    expect(extractCloudPrntToken("auth", starFetch)).not.toBe(
      extractCloudPrntToken("job", starFetch),
    );
  });

  it("reproduces the old defect: reading the query first would 401 the fetch", () => {
    // The pre-fix extractor: query wins for BOTH uses. Asserting the broken
    // outcome keeps the regression honest — if someone reverts the precedence,
    // the behaviour tests above fail and this one documents exactly why.
    const oldExtractor = (s: typeof starFetch) =>
      s.queryToken || basicAuthPassword(s.authorizationHeader);
    const providedToAuthCheck = oldExtractor(starFetch);
    expect(providedToAuthCheck).toBe(JOB);
    expect(providedToAuthCheck).not.toBe(POLL); // => timingSafeEqualStr fails => 401
  });
});

describe("the full Star CloudPRNT 2.5.2 sequence authenticates at every step", () => {
  const steps = [
    { name: "POST poll", authorizationHeader: basic("printer", POLL), queryToken: null },
    { name: "GET body", authorizationHeader: basic("printer", POLL), queryToken: JOB },
    { name: "DELETE confirm", authorizationHeader: basic("printer", POLL), queryToken: JOB },
  ];

  for (const step of steps) {
    it(`${step.name} presents the poll token to the auth check`, () => {
      expect(extractCloudPrntToken("auth", step)).toBe(POLL);
    });
  }

  it("GET and DELETE still address the queued receipt", () => {
    for (const step of steps.slice(1)) {
      expect(extractCloudPrntToken("job", step)).toBe(JOB);
    }
  });
});

describe("setups that authenticate with ?token= only (no Basic header) still work", () => {
  it("accepts the poll token from the query when Basic is absent", () => {
    expect(authCredential({ authorizationHeader: null, queryToken: POLL })).toBe(POLL);
  });

  it("accepts a job token from Basic when the query is absent", () => {
    expect(jobHandle({ authorizationHeader: basic("printer", JOB), queryToken: null })).toBe(JOB);
  });
});

describe("malformed credentials degrade to null, never to an empty string", () => {
  // An empty string would shadow a valid query token through the `??` chain
  // AND would be handed to timingSafeEqualStr, which is a subtle way to turn
  // a 401 into a confusing 200 if a future secret is ever empty.
  it("an empty Basic password yields null so the query fallback applies", () => {
    expect(basicAuthPassword(basic("printer", ""))).toBeNull();
    expect(authCredential({ authorizationHeader: basic("printer", ""), queryToken: POLL })).toBe(
      POLL,
    );
  });

  it("rejects non-Basic schemes", () => {
    expect(basicAuthPassword("Bearer abc123")).toBeNull();
  });

  it("survives undecodable base64 without throwing", () => {
    expect(() => basicAuthPassword("Basic !!!not-base64!!!")).not.toThrow();
  });

  it("treats blank query tokens as absent", () => {
    expect(jobHandle({ authorizationHeader: null, queryToken: "   " })).toBeNull();
    expect(authCredential({ authorizationHeader: null, queryToken: "" })).toBeNull();
  });

  it("splits Basic on the FIRST colon so passwords may contain colons", () => {
    expect(
      basicAuthPassword("Basic " + Buffer.from("printer:a:b:c", "utf8").toString("base64")),
    ).toBe("a:b:c");
  });
});

describe("route wiring — the pure module is useless if the route ignores it", () => {
  it("imports the shared extractor", () => {
    expect(routeSource).toContain('from "@/lib/printing/cloudprnt-auth-core"');
    expect(routeSource).toContain("extractCloudPrntToken");
  });

  it("asks for the auth token exactly once (the authFail check)", () => {
    const matches = routeSource.match(/extractToken\(req, "auth"\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("asks for the job token exactly twice (GET body + DELETE confirm)", () => {
    const matches = routeSource.match(/extractToken\(req, "job"\)/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("no longer hand-rolls base64 Basic-auth decoding", () => {
    expect(routeSource).not.toMatch(/Buffer\.from\([^)]*"base64"\)/);
  });

  it("has no `searchParams.get(\"token\") ||` fallback left (the collision itself)", () => {
    expect(routeSource).not.toMatch(/searchParams\.get\("token"\)\s*\|\|/);
  });

  it("reads the token query parameter in exactly one place", () => {
    const matches = routeSource.match(/searchParams\.get\("token"\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("keeps the constant-time comparison (GW-022)", () => {
    expect(routeSource).toContain("timingSafeEqualStr(");
  });

  it("keeps the fail-closed production guard (S-9)", () => {
    expect(routeSource).toContain("shouldRefuseWhenSecretMissing(");
  });
});

describe("selftest registration", () => {
  it("is wired into the pure selftest runner so CI cannot skip it", () => {
    const runner = readFileSync(
      path.resolve(__dirname, "../../scripts/compliance/run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("__runCloudPrntAuthCoreTests");
    expect(runner).toMatch(/__runCloudPrntAuthCoreTests\(\);/);
  });
});
