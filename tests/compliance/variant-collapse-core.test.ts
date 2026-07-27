/**
 * tests/compliance/variant-collapse-core.test.ts  (SLICE 70)
 *
 * Restock readiness: a new lot of the SAME product at the SAME label+price
 * joins the live card as its own variant (lot identity is load-bearing), and
 * the WEBSITE collapses the visually-identical rows to one — represented by
 * the first in-stock (= oldest, FIFO-friendly) lot. Display-only: nothing
 * stored changes; the register and admin still see every lot.
 */
import { describe, it, expect } from "vitest";
import {
  collapseVariantsForDisplay,
  groupInventoryTotal,
  __runVariantCollapseTests,
} from "@/lib/menu/variant-collapse-core";

const v = (
  id: string,
  label: string,
  priceMinorUnits: number,
  inventoryLevel: number,
  medical = false,
) => ({ id, label, priceMinorUnits, inventoryLevel, medical });

describe("variant-collapse-core (SLICE 70)", () => {
  it("embedded self-tests all pass", () => {
    const res = __runVariantCollapseTests();
    expect(res.failed).toBe(0);
    expect(res.passed).toBeGreaterThanOrEqual(15);
  });

  it("owner's restock case: same label+price collapses to ONE row, in-stock lot shown", () => {
    const out = collapseVariantsForDisplay([
      v("LOT-OLD-onboarded", "3.5g", 4000, 0),
      v("LOT-NEW-onboarded", "3.5g", 4000, 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("LOT-NEW-onboarded");
    expect(out[0].inventoryLevel).toBe(20);
  });

  it("both lots stocked: the FIRST (oldest, FIFO) lot represents the row", () => {
    const out = collapseVariantsForDisplay([
      v("LOT-OLD-onboarded", "3.5g", 4000, 2),
      v("LOT-NEW-onboarded", "3.5g", 4000, 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("LOT-OLD-onboarded");
  });

  it("a different price NEVER collapses (restock may carry its own price)", () => {
    const out = collapseVariantsForDisplay([
      v("A", "3.5g", 4000, 5),
      v("B", "3.5g", 3800, 5),
    ]);
    expect(out).toHaveLength(2);
  });

  it("a different medical flag NEVER collapses", () => {
    const out = collapseVariantsForDisplay([
      v("A", "3.5g", 4000, 5, false),
      v("B", "3.5g", 4000, 5, true),
    ]);
    expect(out).toHaveLength(2);
  });

  it("no duplicates: pass-through preserving order and objects", () => {
    const input = [v("A", "1g", 1200, 3), v("B", "3.5g", 3500, 4)];
    const out = collapseVariantsForDisplay(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(input[1]);
  });

  it("group anchors at first occurrence so sorted size order survives", () => {
    const out = collapseVariantsForDisplay([
      v("A", "1g", 1200, 0),
      v("B", "3.5g", 3500, 4),
      v("C", "1g", 1200, 9),
    ]);
    expect(out.map((x) => x.id)).toEqual(["C", "B"]);
  });

  it("groupInventoryTotal sums the whole group behind the shown row", () => {
    const all = [v("A", "3.5g", 4000, 2), v("B", "3.5g", 4000, 20), v("C", "7g", 6500, 5)];
    const out = collapseVariantsForDisplay(all);
    expect(groupInventoryTotal(all, out[0])).toBe(22);
    expect(groupInventoryTotal(all, out[1])).toBe(5);
  });

  it("all lots drained: first variant represents (card is unavailable anyway)", () => {
    const out = collapseVariantsForDisplay([v("A", "3.5g", 4000, 0), v("B", "3.5g", 4000, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("A");
  });
});
