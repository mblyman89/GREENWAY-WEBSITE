/**
 * CVB-10 - "Same period last year" on Reports → Overview and Sales (owner request 2026-11-02, decision CVB-D17).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runLastYearTests, comparePeriod, splitAtCutover } from "@/lib/reports/last-year-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("CVB-10 last-year-core", () => {
  it("self-tests pass", () => {
    const r = __runLastYearTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(17);
  });

  it("a period spanning the cut-over is split, never blended silently", () => {
    expect(splitAtCutover("2026-10-25", "2026-11-05", "2026-11-01").map((s) => s.source)).toEqual(["cultivera", "greenway"]);
  });

  it("non-owners never see a Cultivera figure or a change built on one", () => {
    const c = comparePeriod({
      from: "2026-10-01", to: "2026-10-07", now: { revenueMinor: 1, orders: 1, units: 1, days: 7 }, cutover: "2026-09-01",
      canSeeCultivera: false, partTotals: () => ({ revenueMinor: 999, orders: 9, units: 9, days: 7 }),
    });
    expect(c?.parts[0].hidden).toBe(true);
    expect(c?.metrics.every((m) => m.then === null && m.changePct === null)).toBe(true);
  });
});

describe("CVB-10 wiring", () => {
  it("Overview and Sales offer the comparison with an owner-only Cultivera part", () => {
    for (const p of ["src/app/admin/reports/page.tsx", "src/app/admin/reports/sales/page.tsx"]) {
      const s = read(p);
      expect(s).toContain('sp.compare === "ly"');
      expect(s).toContain('can(session.profile.role, "cultivera.benchmark")');
      expect(s).toContain("<LastYearPanel");
      expect(s).toContain("Compare with last year");
    }
  });

  it("the panel badges every part with its system", () => {
    const s = read("src/components/admin/reports/LastYearPanel.tsx");
    expect(s).toContain("CULTIVERA_LABEL");
    expect(s).toContain("<Badge source={p.segment.source} />");
  });

  it("the loader reads Cultivera only from cultivera_history_days and checks every read", () => {
    const s = read("src/lib/reports/last-year.ts");
    expect(s).toContain("historyDays(from, to)");
    expect(s).toContain("if (error) return { rows: [], ok: false }");
    expect(s).toContain("if (!verdict.complete) return null");
  });
});
