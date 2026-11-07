/**
 * D204a–d — blind counts that do not line up.
 *  a) the iPad close asks the closer to look again (empty coin / $1 groups;
 *     a count far below expected, checked by the server, never shown);
 *  b) reconcile shows the two counts row by row and suggests the second count;
 *  c) a refused sale is resolved only by a checked re-ring or a no-sale reason;
 *  d) GL_AUTOPOST_NO_TEMPLATE on reconcile is "deferred", not "failed".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCloseCountCheckTests,
  closeShortCheck,
  countDiffRows,
  emptyGroupWarnings,
  RECHECK_COUNT_CODE,
} from "../../src/lib/registers/close-count-check-core";
import { __runExceptionResolveTests, resolveExceptionVerdict } from "../../src/lib/pos/exception-resolve-core";
import { EMPTY_DENOMS } from "../../src/lib/registers/cash";
import { validateTillRequest } from "../../src/lib/pos/till-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("D204a close look-again", () => {
  it("self-tests pass", () => {
    const r = __runCloseCountCheckTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });
  it("flags empty coin and $1 groups", () => {
    expect(emptyGroupWarnings({ ...EMPTY_DENOMS, twenties: 20 }).map((w) => w.key)).toEqual(["coins", "ones"]);
  });
  it("server check asks to recount, then accepts the confirmation", () => {
    const r = closeShortCheck({ countedMinor: 0, expectedMinor: 267810, recountConfirmed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(RECHECK_COUNT_CODE);
      expect(r.error).not.toMatch(/2,?678/);
    }
    expect(closeShortCheck({ countedMinor: 0, expectedMinor: 267810, recountConfirmed: true }).ok).toBe(true);
  });
  it("till request carries recountConfirmed", () => {
    const v = validateTillRequest({ action: "close", pin: "1234", denoms: { ones: 1 }, recountConfirmed: true, tipsMinor: 0 });
    expect(v.ok && v.req.action === "close" && v.req.recountConfirmed === true).toBe(true);
  });
  it("route checks before closing and stays blind", () => {
    const r = read("src/app/api/pos/till/route.ts");
    expect(r.indexOf("closeShortCheck(")).toBeGreaterThan(0);
    expect(r.indexOf("closeShortCheck(")).toBeLessThan(r.indexOf("closeDrawerBlind({"));
    expect(r).toContain("drawer.close_recheck_asked");
    expect(r).not.toMatch(/json\(\{[^}]*expectedMinor/);
  });
  it("iPad shows the look-again box", () => {
    const s = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(s).toContain('data-testid="close-recount"');
    expect(s).toContain("recheck_count");
    expect(s).toContain("recountConfirmed");
  });
});

describe("D204b reconcile row diffs", () => {
  it("lists only differing rows, money first", () => {
    const rows = countDiffRows({ ...EMPTY_DENOMS, fifties: 1, ones: 55 }, { ...EMPTY_DENOMS, hundreds: 1 });
    expect(rows.map((r) => r.key)).toEqual(["hundreds", "fifties", "ones"]);
  });
  it("page renders the diff and suggests the second count", () => {
    const p = read("src/app/admin/registers/page.tsx");
    expect(p).toContain('data-testid="count-diff-rows"');
    expect(p).toContain("suggestedBasis(");
    expect(p).toContain("getCloseCountDenoms");
  });
});

describe("D204c refused-sale resolve", () => {
  it("self-tests pass", () => {
    expect(__runExceptionResolveTests().failed).toBe(0);
  });
  it("a sale needs a re-ring or a no-sale reason", () => {
    expect(resolveExceptionVerdict({ eventType: "sale", kind: "", receipt: "", note: "looked at it" }).ok).toBe(false);
    expect(resolveExceptionVerdict({ eventType: "sale", kind: "rerung", receipt: "ABCDEF12", note: "" }).ok).toBe(true);
  });
  it("store checks the re-ring receipt; action uses it", () => {
    expect(read("src/lib/pos/sync-store.ts")).toContain("export async function resolvePosExceptionChecked");
    expect(read("src/app/admin/registers/exceptions/actions.ts")).toContain("resolvePosExceptionChecked(");
    expect(read("src/app/admin/registers/exceptions/page.tsx")).toContain('name="resolve_kind"');
  });
});

describe("D204d ledger deferred", () => {
  it("no-template is deferred", () => {
    const s = read("src/lib/registers/drawer-posting-service.ts");
    expect(s).toContain('kind: "deferred"');
    expect(s).toContain('"GL_AUTOPOST_NO_TEMPLATE"');
  });
});
