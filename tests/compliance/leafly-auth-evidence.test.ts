/**
 * tests/compliance/leafly-auth-evidence.test.ts
 *
 * Guards the fix for the third sandbox defect: a successful, read-only
 * "Check integration status" call did not clear the certification page's
 * "Client successfully authenticates" criterion.
 *
 * The panel told Michael, in its own remedy text, to press that button because
 * it "proves auth". He pressed it. Leafly answered HTTP 200 with
 * menuIntegrationEnabled:true and integratedItemCount:1876. The criterion went
 * on reading UNTESTED, because the page inferred authentication from menu
 * PUSHES alone.
 *
 * Following a system's instructions and watching nothing change is how an
 * owner learns to stop believing the system. These tests make that specific
 * lie fail.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveAuthSucceeded,
  latestSuccessfulAttempt,
  type AuthenticatedAttempt,
} from "@/lib/leafly/certification-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("a read-only status check counts as proof of authentication", () => {
  it("a 200 from a status check proves auth, with no push required", () => {
    expect(deriveAuthSucceeded([{ kind: "status check", httpStatus: 200 }])).toBe(true);
  });

  it("the exact sandbox situation: one status check, zero pushes", () => {
    // This is the case that was reported as UNTESTED on a live, working
    // integration.
    const attempts: AuthenticatedAttempt[] = [
      { kind: "status check", httpStatus: 200, at: "2026-09-18T10:00:00.000Z" },
    ];
    expect(deriveAuthSucceeded(attempts)).toBe(true);
    expect(latestSuccessfulAttempt(attempts)?.kind).toBe("status check");
  });

  it("a push still counts too - the fix widens the proof, it does not move it", () => {
    expect(deriveAuthSucceeded([{ kind: "menu push", httpStatus: 200 }])).toBe(true);
  });
});

describe("what must NOT be treated as proof", () => {
  it("no recorded calls is untested, never failed", () => {
    // Reporting a login failure for a shop that has not tried yet would send
    // the owner hunting a credential problem that does not exist.
    expect(deriveAuthSucceeded([])).toBeNull();
  });

  it("a server error leaves the verdict open rather than blaming our key", () => {
    for (const status of [500, 502, 503, 504, 0]) {
      expect(
        deriveAuthSucceeded([{ kind: "status check", httpStatus: status }]),
        `HTTP ${status} says nothing about our credentials`,
      ).toBeNull();
    }
  });

  it("only an explicit credential rejection is reported as failure", () => {
    expect(deriveAuthSucceeded([{ kind: "status check", httpStatus: 401 }])).toBe(false);
    expect(deriveAuthSucceeded([{ kind: "status check", httpStatus: 403 }])).toBe(false);
  });

  it("a 404 is not a credential failure", () => {
    // A wrong URL is our bug, not a rejected key. Calling it an auth failure
    // sends the owner to re-enter a secret that was never the problem.
    expect(deriveAuthSucceeded([{ kind: "status check", httpStatus: 404 }])).toBeNull();
  });
});

describe("the page really uses this, not just the library", () => {
  // A pure function nobody calls proves nothing. The defect was in the WIRING:
  // the logic for "did auth work" lived on the page and looked only at pushes.
  const page = read("src/app/admin/integrations/leafly/page.tsx");

  it("the certification page derives auth through the shared helper", () => {
    expect(page).toContain("deriveAuthSucceeded");
  });

  it("the page loads the recorded status checks", () => {
    expect(page).toContain("loadLeaflyAuthAttempts");
  });

  it("the old push-only inference is gone", () => {
    expect(
      /authSucceeded\s*=\s*\n?\s*livePushes\.length === 0/.test(page),
      "the page still infers authentication from menu pushes alone",
    ).toBe(false);
  });
});

describe("reading the recorded status back is defensive", () => {
  it("an unreadable audit row yields no status rather than a guess", async () => {
    // Imported lazily: auth-evidence.ts is "server-only".
    const { readHttpStatus } = await import("@/lib/leafly/auth-evidence");
    expect(readHttpStatus(null)).toBeNull();
    expect(readHttpStatus(undefined)).toBeNull();
    expect(readHttpStatus({})).toBeNull();
    expect(readHttpStatus({ httpStatus: "200 OK" })).toBeNull();
    expect(readHttpStatus("200")).toBeNull();
    expect(readHttpStatus({ httpStatus: Number.NaN })).toBeNull();
  });

  it("a well-formed row yields its status, including numeric strings", async () => {
    const { readHttpStatus } = await import("@/lib/leafly/auth-evidence");
    expect(readHttpStatus({ httpStatus: 200 })).toBe(200);
    expect(readHttpStatus({ httpStatus: 401 })).toBe(401);
    expect(readHttpStatus({ httpStatus: "200" })).toBe(200);
  });
});
