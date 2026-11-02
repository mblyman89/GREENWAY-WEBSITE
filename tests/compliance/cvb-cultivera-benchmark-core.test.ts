/**
 * Vitest mirror of cultivera-benchmark-core (CVB-4). The owner asked to "compare Cultivera's system with
 * ours ... Leave nothing out" and for "a total build cost amount that goes down as our system outperforms
 * theirs as well as account for the 5500 less ... Total build was 40k." Locks the cents conversion, the
 * never-zero-for-missing rule, the payback arithmetic, and agreement with migration 0337.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_FILE_NAME_RE,
  DAYS_BATCH_SIZE,
  MAX_ARCHIVE_FILES,
  METRICS,
  OWNER_BUILD_COST_MINOR,
  OWNER_FIRST_SAVING_MINOR,
  comparePeriods,
  compareMetric,
  dollarsToCents,
  formatCents,
  manifestToRegisterFiles,
  normalizeDailySales,
  normalizeDailySalesRow,
  outperformCredit,
  outperformKey,
  paybackSummary,
  savingFromInput,
  sumPeriod,
  type BenchmarkDayRow,
  __runCultiveraBenchmarkCoreTests,
} from "@/lib/reports/cultivera-benchmark-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MIG = "supabase/migrations/0337_cultivera_benchmark_archive.sql";

describe("cultivera-benchmark-core", () => {
  it("passes its embedded pure self-tests", () => {
    const r = __runCultiveraBenchmarkCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
  });

  it("converts Cultivera's measured 2026-10-31 daily row to cents exactly", () => {
    const r = normalizeDailySalesRow({ Day: 31, Month: 10, Year: 2026, GrossSales: 8684.14, Discounts: 2577.7, Taxes: 2779.9, Returns: 0, CashRedemption: 0, NetSales: 6106.44, Cost: 3686.18, GrossProfit: 4997.96, NetProfit: 2420.26 });
    expect(r).toEqual({
      day: "2026-10-31",
      gross_sales_minor: 868414,
      discounts_minor: 257770,
      taxes_minor: 277990,
      returns_minor: 0,
      net_sales_minor: 610644,
      cost_minor: 368618,
      gross_profit_minor: 499796,
      net_profit_minor: 242026,
      cash_redemption_minor: 0,
    });
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("keeps a day with two different answers out instead of picking one", () => {
    const base = { Day: 1, Month: 1, Year: 2026, GrossSales: 1, Discounts: 0, Taxes: 0, Returns: 0, CashRedemption: 0, NetSales: 1, Cost: 0, GrossProfit: 1, NetProfit: 1 };
    const n = normalizeDailySales([base, { ...base, NetSales: 2 }]);
    expect(n.rows).toHaveLength(0);
    expect(n.conflicts).toEqual(["2026-01-01"]);
  });

  it("never treats a missing side as zero, and a partial period never wins", () => {
    const gs = METRICS.find((m) => m.key === "gross_sales")!;
    expect(compareMetric(gs, null, 5).status).toBe("not_comparable");
    const day = (d: string, g: number): BenchmarkDayRow => ({ day: d, gross_sales_minor: g, discounts_minor: 0, taxes_minor: 0, returns_minor: 0, net_sales_minor: g, cost_minor: 0, gross_profit_minor: g, net_profit_minor: g, cash_redemption_minor: 0 });
    const ours = sumPeriod([day("2026-10-01", 500)], "2026-10-01", "2026-10-02");
    const theirs = sumPeriod([day("2025-10-01", 100), day("2025-10-02", 100)], "2025-10-01", "2025-10-02");
    const c = comparePeriods(ours, theirs);
    expect(c.complete).toBe(false);
    expect(c.ahead).toBe(0);
    expect(outperformCredit(c, "gross_profit", "2026-11-01")).toBe("one side is missing days in this period");
  });

  it("starts the payback at the owner's figures: $40,000 - $5,500 = $34,500", () => {
    expect(OWNER_BUILD_COST_MINOR).toBe(4_000_000);
    expect(OWNER_FIRST_SAVING_MINOR).toBe(550_000);
    const s = paybackSummary([
      { entryKey: "owner-build-cost", entryDate: "2026-11-01", kind: "build_cost", amountMinor: OWNER_BUILD_COST_MINOR, note: "x" },
      { entryKey: "owner-saving-2026-11-01", entryDate: "2026-11-01", kind: "saving", amountMinor: OWNER_FIRST_SAVING_MINOR, note: "x" },
    ]);
    expect(formatCents(s.remainingMinor)).toBe("$34,500.00");
    expect(s.pctPaidBack).toBe(13.8);
    expect(outperformKey("gross_profit", "2026-11-01", "2026-11-30")).toBe("outperform:gross_profit:2026-11-01:2026-11-30");
    expect(typeof savingFromInput({ dollars: "5,500", date: "2026-12-01", note: "invoice" })).toBe("object");
  });

  it("agrees with migration 0337 (seed amounts, keys, limits, file names, row keys)", () => {
    const sql = read(MIG);
    expect(sql).toContain("('owner-build-cost', '2026-11-01', 'build_cost', 4000000,");
    expect(sql).toContain("('owner-saving-2026-11-01', '2026-11-01', 'saving', 550000,");
    expect(sql).toContain(`jsonb_array_length(p_files) > ${MAX_ARCHIVE_FILES}`);
    expect(sql).toContain(`jsonb_array_length(p_rows) > ${DAYS_BATCH_SIZE}`);
    expect(sql).toContain(`file_name ~ '${ARCHIVE_FILE_NAME_RE.source}'`);
    for (const k of ["gross_sales_minor", "discounts_minor", "taxes_minor", "returns_minor", "net_sales_minor", "cost_minor", "gross_profit_minor", "net_profit_minor", "cash_redemption_minor"]) {
      expect(sql).toContain(`(r->>'${k}')::bigint`);
    }
    expect(sql).toContain("check (kind in ('build_cost', 'saving', 'outperform', 'adjustment'))");
    expect(sql).toContain("check (kind = 'adjustment' or amount_minor > 0)");
  });

  it("accepts every file name the crawler's archive harvester writes", () => {
    const py = read("crawler/app/cultivera_archive.py");
    for (const single of ["summaries.json", "lookups.json", "manifest.json", "state.json", "errors.jsonl"]) {
      expect(py).toContain(`"${single}"`);
      expect(ARCHIVE_FILE_NAME_RE.test(single)).toBe(true);
    }
    for (const part of ["sales_lines.p0001.jsonl.gz", "orders.2024-08.jsonl.gz", "valuation_snapshot_rows.s00012.jsonl.gz", "cycle_count_details.cc00004.jsonl.gz"]) {
      expect(ARCHIVE_FILE_NAME_RE.test(part)).toBe(true);
    }
    expect(manifestToRegisterFiles({ files: [{ name: "x/../y.json", bytes: 1, sha256: "a".repeat(64) }] }).files).toHaveLength(0);
  });
});
