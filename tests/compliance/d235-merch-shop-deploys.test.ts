/**
 * D235 (F-11-19): "MERCH_HEALTH_TOKEN not accepted". The token was fine; the
 * merch project never deployed slices M-1 … M-8 because its Ignored Build
 * Step diffed only the last (docs-only) commit of each merge.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHOP_REDEPLOY_FIX,
  SHOP_ROUTE_MISSING,
  __runMerchHealthCoreTests,
  isMissingRoute404,
} from "../../src/lib/merch/merch-health-core";

const read = (p: string) => readFileSync(p, "utf8");
const SCRIPT = "merch-site/scripts/vercel-ignore.sh";

function ignoreExit(prev: string | undefined): number {
  try {
    execFileSync("bash", ["scripts/vercel-ignore.sh"], {
      cwd: "merch-site",
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: prev ?? "" },
      stdio: "pipe",
    });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

describe("D235: the shop deploys every merch change", () => {
  it("vercel.json uses the script, not the last-commit-only diff", () => {
    const v = JSON.parse(read("merch-site/vercel.json")) as { ignoreCommand?: string; git?: unknown };
    expect(v.ignoreCommand).toBe("bash scripts/vercel-ignore.sh");
    expect(read("merch-site/vercel.json")).not.toContain("HEAD^ HEAD");
    expect(v.git).toEqual({ deploymentEnabled: { main: true, "**": false } });
  });

  it("the script compares with the last successful deploy and builds when unsure", () => {
    const s = read(SCRIPT);
    expect(s).toContain("VERCEL_GIT_PREVIOUS_SHA");
    expect(s).toContain('git diff --quiet "$prev" HEAD -- .');
    expect(ignoreExit(undefined)).toBe(1);
    expect(ignoreExit("0123456789abcdef0123456789abcdef01234567")).toBe(1);
    let head = "";
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"], { stdio: "pipe" }).toString().trim();
    } catch {
      head = "";
    }
    if (head) expect(ignoreExit(head)).toBe(0); // nothing changed since itself -> skip
  });
});

describe("D235: Merch Health names a missing route", () => {
  it("core self-test passes (28)", () => {
    const r = __runMerchHealthCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(28);
  });

  it("HTML 404 = route missing; the fix is a redeploy, not the token", () => {
    expect(isMissingRoute404(404, "text/html; charset=utf-8")).toBe(true);
    expect(isMissingRoute404(404, "text/plain;charset=UTF-8")).toBe(false);
    expect(SHOP_ROUTE_MISSING).toContain("The token is not the problem");
    expect(SHOP_REDEPLOY_FIX).toContain("Create Deployment");
    const server = read("src/lib/merch/merch-health-server.ts");
    expect(server).toContain('isMissingRoute404(res.status, res.headers.get("content-type"))');
    expect(server).toContain('(process.env.MERCH_HEALTH_TOKEN ?? "").trim()');
    expect(read("merch-site/app/api/health/route.ts")).toContain('new Response("Not found", { status: 404 })');
  });

  it("docs record F-11-19 and the owner step", () => {
    expect(read("docs/sop/SOP-11-merch-studio-merch-inventory.md")).toContain("| **F-11-19** | GAP · S1 |");
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toContain("### F-11-19 · CONFIRMED · GAP · S1");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("### As built (D235)");
  });
});
