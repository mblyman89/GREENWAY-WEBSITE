/**
 * R74 S42 - "remove all blockers ... the records we have that are factual are
 * able to be uploaded no matter what" (owner, Round 22).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runCcrsNeverBlockTests, fixLinksFor } from "@/lib/compliance/ccrs-never-block-core";
import { assertCcrsBatchSubmittable } from "@/lib/compliance/ccrs-submit-gate-core";
import { CCRS_ISSUE_CODES } from "@/lib/compliance/ccrs-preflight-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S42 CCRS never blocks good records", () => {
  it("pure self-tests pinned", () => {
    expect(__runCcrsNeverBlockTests()).toEqual({ passed: 19, failed: 0 });
  });

  it("the owner's Fire Bros E9 screen is now submittable, held, with fix links", () => {
    const row = { id: "pos-db86af8ccba2", label: "Fire Bros. Fire Bros Yuzu Sour Flower", detail: "no unit weight" };
    const v = assertCcrsBatchSubmittable({
      syncIssues: [
        { severity: "error", file: "Product", message: "1 product no unit weight", code: "E9_UNITWEIGHT_ZERO_USABLE", rows: [row] },
        { severity: "error", file: "Strain", message: "reserved", code: "E11_STRAIN_NAME_RESERVED", rows: [row] },
        { severity: "error", file: "Inventory", message: "dup", code: "E59_LEDGER_DUPLICATE_HELD", rows: [{ id: "Inventory/X", label: "X" }] },
        { severity: "error", file: "Sale", message: "row refused", code: "E60_ROW_REFUSED_HELD", rows: [{ id: "D1", label: "D1" }] },
      ],
      verifierProblems: [],
      files: [],
    });
    expect(v.submittable).toBe(true);
    expect(v.heldCount).toBe(4);
    expect(fixLinksFor({ code: "E9_UNITWEIGHT_ZERO_USABLE", file: "Product" }, row).map((l) => l.label)).toEqual(["Product page", "Onboarding row", "Find in inventory"]);
    for (const c of ["E57_PRODUCT_TYPE_UNKNOWN", "E58_PRODUCT_ON_CLEANUP_LIST", "E59_LEDGER_DUPLICATE_HELD", "E60_ROW_REFUSED_HELD"]) expect(CCRS_ISSUE_CODES).toContain(c);
  });

  it("wiring: the builder holds instead of blocking; the hub offers the clean-up list", () => {
    const b = read("src/lib/compliance/ccrs-batch.ts");
    expect(b).toMatch(/applyProductHolds\(/);
    expect(b).toMatch(/E60_ROW_REFUSED_HELD/);
    expect(b).not.toMatch(/ERROR \\u2014 Product|ERROR — Product/);
    expect(b).not.toMatch(/duplicate record\(s\)\. Routing cannot prove/);
    expect(read("src/app/admin/compliance/ccrs/page.tsx")).toMatch(/cleanup=\{canEdit \? \{ action: ccrsCleanupAction/);
    expect(read("src/components/admin/compliance/CcrsIssueList.tsx")).toMatch(/Add to CCRS clean-up list/);
  });
});
