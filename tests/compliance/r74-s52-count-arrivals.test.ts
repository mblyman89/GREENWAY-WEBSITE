import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runCultiveraCountCoreTests, planCount, rollupSales, salesDayAfter } from "@/lib/pos/cultivera-count-core";

describe("R74 S52 count: sales window + late arrivals", () => {
  it("self-tests pass and the runner pin matches", () => {
    expect(__runCultiveraCountCoreTests()).toEqual({ passed: 71, failed: 0 });
    expect(readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8")).toContain('assertRan("cultivera-count-core", __runCultiveraCountCoreTests(), 71)');
  });

  it("count date 10/30 subtracts only 10/31 sales; a 10/30 sale is never taken off the count", () => {
    expect(salesDayAfter("2026-10-30")).toBe("2026-10-31");
    const s = rollupSales(
      [
        { Id: 1, Tsid: "A1", Units: 2, ReturnUnits: 0, Cost: 1, CreatedAt: "2026-10-30T15:00:00Z", OrderStatus: 1 },
        { Id: 2, Tsid: "A1", Units: 3, ReturnUnits: 1, Cost: 1, CreatedAt: "2026-10-31T15:00:00Z", OrderStatus: 1 },
      ],
      { salesDay: "2026-10-31" },
    );
    expect(s.netSold.get("a1")?.units).toBe(2);
    const p = planCount({ lots: [{ lotId: "L", lotCode: "A1", productName: "", onHand: 6 }], counted: new Map([["a1", { code: "A1", units: 8, byCounter: {} }]]), sales: s, problems: [] });
    expect(p.lines[0].rolled).toBe(6);
    expect(p.adjustments).toHaveLength(0);
  });

  it("preview passes the workbooks' lot list; the page explains the new exception", () => {
    expect(readFileSync("src/lib/pos/cultivera-count-store.ts", "utf8")).toContain("listedBarcodes: merged.listed");
    const page = readFileSync("src/app/admin/menu-imports/count/page.tsx", "utf8");
    expect(page).toContain("arrived_after_count:");
    expect(page).toContain('data-testid="count-sales-window"');
  });
});
