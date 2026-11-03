/**
 * CVB-9 - Forecast data source switch (owner request 2026-11-02, decision CVB-D16).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runForecastSourceTests, combineSeries, parseForecastSource } from "@/lib/reports/forecast-source-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("CVB-9 forecast-source-core", () => {
  it("self-tests pass", () => {
    const r = __runForecastSourceTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(18);
  });

  it("non-owners can never pick a Cultivera source", () => {
    expect(parseForecastSource("blend", false)).toBe("greenway");
    expect(parseForecastSource("cultivera", false)).toBe("greenway");
  });

  it("Cultivera never lands on or after the cut-over", () => {
    const { series } = combineSeries({
      source: "blend",
      ours: { revenue: [], orders: [], units: [] },
      cultivera: [
        { day: "2026-10-31", revenue_minor: 1, orders: 1, units: 1 },
        { day: "2026-11-01", revenue_minor: 2, orders: 1, units: 1 },
        { day: "2026-11-02", revenue_minor: 3, orders: 1, units: 1 },
      ],
      cutover: "2026-11-01",
      today: "2026-11-02",
      lookbackDays: 30,
    });
    expect(series.revenue.map((o) => o.date)).toEqual(["2026-10-31"]);
  });
});

describe("CVB-9 wiring", () => {
  it("page: owner-only switch, gold badge, source note, cut-over line", () => {
    const p = read("src/app/admin/reports/forecast/page.tsx");
    expect(p).toContain('can(session.profile.role, "cultivera.benchmark")');
    expect(p).toContain("parseForecastSource(sp.source, canUseCultivera)");
    expect(p).toContain("CULTIVERA_LABEL");
    expect(p).toContain("<SourceNote info={bundle.source} />");
    expect(p).toContain("cutoverDate={bundle.source.cutover ?? undefined}");
    const c = read("src/components/admin/reports/ForecastChart.tsx");
    expect(c).toContain('name="Actual (Cultivera, imported)"');
    expect(c).toContain('value: "Cut-over"');
  });

  it("the AI is told the source and the audit records it", () => {
    expect(read("src/lib/reports/forecast-ai.ts")).toContain("lines.push(bundle.source.note)");
    const a = read("src/app/admin/reports/forecast/actions.ts");
    expect(a).toContain('parseForecastSource(sourceRaw, can(session.profile.role, "cultivera.benchmark"))');
    expect(a).toContain("source: bundle.source.source");
  });
});
