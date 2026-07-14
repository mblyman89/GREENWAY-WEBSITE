/**
 * tests/compliance/change-calc-core.test.ts
 *
 * Vitest mirror for the B31 denomination-aware change calculator. Cash-only
 * store — the count-back plan must be exactly right: greedy breakdown
 * (optimal for US denominations), $50/$100 accepted but never given back,
 * no $2 bills / half-dollars / dollar coins in change, and smart tender
 * chips that match what customers actually hand over.
 */
import { describe, expect, it } from "vitest";
import {
  changeBreakdown,
  formatChangeBreakdown,
  smartTenderSuggestions,
  CHANGE_DENOMS,
  __runChangeCalcCoreTests,
} from "@/lib/pos/change-calc-core";

describe("changeBreakdown", () => {
  it("breaks $26.41 into the canonical 7 pieces, summing exactly", () => {
    const parts = changeBreakdown(2641);
    expect(parts).not.toBeNull();
    expect(parts!.length).toBe(7);
    expect(parts![0]).toMatchObject({ label: "$20", count: 1, kind: "bill" });
    expect(parts!.reduce((s, p) => s + p.minor, 0)).toBe(2641);
  });

  it("never plans $50/$100 into change ($99 = 4×$20 …)", () => {
    const parts = changeBreakdown(9900);
    expect(parts![0]).toMatchObject({ label: "$20", count: 4 });
    expect(CHANGE_DENOMS.every((d) => d.minor <= 2000)).toBe(true);
  });

  it("never uses $2 bills, half-dollars, or dollar coins", () => {
    const parts = changeBreakdown(350);
    expect(formatChangeBreakdown(parts!)).toBe("3×$1 · 2×25¢");
  });

  it("handles coins-only change with fewest pieces", () => {
    const parts = changeBreakdown(41);
    expect(parts!.every((p) => p.kind === "coin")).toBe(true);
    expect(parts!.reduce((s, p) => s + p.count, 0)).toBe(4);
  });

  it("returns [] for zero and null for invalid input", () => {
    expect(changeBreakdown(0)).toEqual([]);
    expect(changeBreakdown(-5)).toBeNull();
    expect(changeBreakdown(10.5)).toBeNull();
  });
});

describe("smartTenderSuggestions", () => {
  it("starts exact, then whole-dollar and bill steps, ascending + deduped", () => {
    const s = smartTenderSuggestions(2641);
    expect(s[0]).toBe(2641);
    expect(s).toContain(2700);
    expect(s).toContain(3000);
    expect(s).toContain(4000);
    expect(s).toContain(5000);
    expect(s).toContain(10000);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
    expect(new Set(s).size).toBe(s.length);
  });

  it("never suggests bills below the total", () => {
    const s = smartTenderSuggestions(15000);
    expect(s).not.toContain(5000);
    expect(s).not.toContain(10000);
    expect(s).toContain(16000);
  });

  it("rejects invalid totals", () => {
    expect(smartTenderSuggestions(0)).toEqual([]);
    expect(smartTenderSuggestions(-100)).toEqual([]);
    expect(smartTenderSuggestions(12.5)).toEqual([]);
  });
});

describe("embedded self-tests", () => {
  it("run clean (23 assertions)", () => {
    expect(() => __runChangeCalcCoreTests()).not.toThrow();
  });
});
