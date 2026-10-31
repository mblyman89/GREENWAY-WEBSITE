/**
 * Fix Phase 4.5b — Promotions → Clearance markdowns (F-06-17, part 2; owner D57).
 *
 * Owner, verbatim (markdown-lock-core.ts L8–11): "a 50% off products we have
 * been sitting on for too long and things about to expire. ... Those items are
 * excluded from any and all other sales/ daily deals".
 *
 * Proves: the pure rules (self-test), that the draft it builds is a real
 * markdown the engine honours over a 25% storewide day, that the action
 * re-checks on the server and only creates a DRAFT, and that the screen is
 * reachable from the hub, Plan a count → Expiring soon and the checklist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runClearanceTests,
  buildClearanceDraft,
  findClearanceCandidates,
  type ClearanceLot,
} from "@/lib/promotions/clearance-core";
import { parseEngineConfig } from "@/lib/promotions/published-rules-core";
import { computePromotions, type EngineRule } from "@/lib/promotions/discount-engine-core";
import { referenceLinks, CLEARANCE_SCREEN } from "@/lib/inventory/daily-checklist-core";

const read = (f: string) => readFileSync(f, "utf8");

describe("clearance-core", () => {
  it("self-test passes", () => {
    const r = __runClearanceTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("the draft it builds keeps its markdown on a 25% storewide day", () => {
    const lot: ClearanceLot = {
      lotId: "1", lotCode: "L1", posProductKey: "K1", productName: "Old Flower", onHandQty: 4,
      unitCostMinorUnits: 500, expiresOn: "2026-11-10", receivedOn: "2026-09-01", receivedIsGuess: false, expiredKind: "warn",
    };
    const candidates = findClearanceCandidates({
      lots: [lot],
      menu: new Map([["K1", { name: "Old Flower", brand: "B", priceMinorUnits: 4000 }]]),
      neverDiscount: new Set(),
      existing: new Map(),
      today: "2026-10-30",
      settings: { percent: 20, sittingDays: 90 },
    });
    const d = buildClearanceDraft({ keys: ["K1"], candidates, percent: 20, today: "2026-10-30" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const md: EngineRule = {
      id: "clr", title: d.draft.title, discountType: "percent", discountPercent: d.draft.discount_percent, discountFixed: 0,
      priority: d.draft.priority, storewide: false, targetCategories: [], targetBrands: [],
      targetProductKeys: d.draft.targets.map((t) => t.value), excludeCategories: [], excludeBrands: [], excludeProductKeys: [],
      config: parseEngineConfig(d.draft.config),
    };
    const monday: EngineRule = { ...md, id: "mon", title: "Monday", discountPercent: 25, storewide: true, targetProductKeys: [], priority: 0, config: parseEngineConfig({}) };
    const r = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 4000, quantity: 1, categories: ["flower"], brand: "B", productKey: "K1", costMinorUnits: 500 }],
      [md, monday],
    );
    expect(r.lines[0].appliedRuleId).toBe("clr");
    expect(r.lines[0].unitPriceMinorUnits).toBe(3200);
  });
});

describe("the action and the screen", () => {
  const ACTION = read("src/app/admin/promotions/clearance/actions.ts");
  const PAGE = read("src/app/admin/promotions/clearance/page.tsx");
  it("re-reads on the server, needs promotions.manage, creates a DRAFT and audits it", () => {
    expect(ACTION).toContain('requirePermission("promotions.manage")');
    expect(ACTION).toContain("loadClearanceInputs()");
    expect(ACTION).toContain("findClearanceCandidates(");
    expect(ACTION).toContain("createPromotion(");
    expect(ACTION).toContain('action: "promotion.clearance_draft"');
    expect(ACTION).not.toContain("setPromotionStatus");
  });
  it("the page needs promotions.manage and says publish runs the below-cost check", () => {
    expect(PAGE).toContain('requirePermission("promotions.manage")');
    expect(PAGE).toContain("below-cost check");
  });
  it("is linked from the hub, Plan a count → Expiring soon and the checklist", () => {
    expect(read("src/app/admin/promotions/page.tsx")).toContain('href="/admin/promotions/clearance"');
    expect(read("src/app/admin/inventory/audits/new/CountGenerators.tsx")).toContain('href="/admin/promotions/clearance"');
    const links = referenceLinks("Expiration report read; markdown list agreed with the owner", "SOP-05a \u00a74.16", {});
    expect(links.some((l) => l.href === CLEARANCE_SCREEN)).toBe(true);
  });
});
