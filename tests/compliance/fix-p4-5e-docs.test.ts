/**
 * Fix Phase 4.5e — the docs record Fix Phase 4.5 (F-06-17 fixed, minutes, reminder preview).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("Fix 4.5e — docs", () => {
  it("SOP-06 v1.7 describes the clearance screen, minutes and the preview", () => {
    const sop = read("docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.[7-9]/);
    expect(sop).toMatch(/\| 1\.7 \| 2026-10-30 \|/);
    expect(sop).toContain("**Promotions \u2192 Clearance markdowns**");
    expect(sop).not.toContain("list them for the owner");
    expect(sop).toContain("**Re-plan by time**");
    expect(sop).toContain("**December cockpit reminder**");
  });

  it("the SOP quotes the promotion form's real markdown box", () => {
    const form = read("src/components/admin/promotions/PromotionForm.tsx");
    expect(form).toContain("Clearance or vendor-day markdown");
    expect(form).toContain("This is a markdown");
  });

  it("ledgers record F-06-17 fixed and 4.5a-d built", () => {
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toContain("**Status: FIXED (Fix Phase 4.5a\u20134.5b, #1578, #1579).");
    const plan = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
    for (const [row, pr] of [["4.5a", "#1578"], ["4.5b", "#1579"], ["4.5c", "#1580"], ["4.5d", "#1581"]]) {
      expect(plan).toMatch(new RegExp(`\\| ${row.replace(".", "\\.")} \\|[^\\n]*\\| \\*\\*BUILT\\*\\* \\| ${pr} \\|`));
    }
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).not.toContain("waits for the clearance screen");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Clearance markdowns and counting time (Fix Phase 4.5, F-06-17)");
  });
});
