/**
 * PERF P3 (owner 2026-11-05, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D186-D190):
 *   "I need my back office to be lightning fast ... I want the main admin page to be instant."
 *   "If there is ways to pin optimization and efficiency in the test suite ... please make it a
 *    permanent issue to address every time we add to the repo."
 *
 * Pins: the cockpit streams per section (Suspense) instead of awaiting one Promise.all of every
 * read; shared reads happen once per request; heavy display figures sit behind a short cache that
 * never stores a failed read; the tax/CCRS/Sage/LIQ-1295 category lookups read only the sold keys;
 * the low-stock read is paged and checked (it was silently capped at 1,000 of ~2,300 lots).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runCockpitCacheTests,
  COCKPIT_TODAY_TTL_S,
  COCKPIT_PAST_TTL_S,
  COCKPIT_STOCK_TTL_S,
  decideCockpitCacheWrite,
  isPlainJson,
} from "@/lib/admin/cockpit-cache-core";

const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("PERF P3: the cockpit is instant", () => {
  const page = () => strip(read("src/app/admin/page.tsx"));

  it("the pure cache policy passes its self-tests and is registered", () => {
    const r = __runCockpitCacheTests();
    expect(r.messages).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("cockpit-cache-core", __runCockpitCacheTests(), 24)',
    );
  });

  it("the page no longer waits for every read before sending anything", () => {
    const src = page();
    // The old single wait-for-everything.
    expect(src).not.toMatch(/const \[snap, setup, overdueCompliance/);
    expect(src).not.toContain("getCockpitSnapshot(");
    // The default export awaits only the session and the URL, never data.
    const main = src.slice(src.indexOf("export default async function AdminDashboardPage"));
    const awaits = main.match(/await [A-Za-z.]+\(?/g) ?? [];
    expect(awaits.sort()).toEqual(["await requireStaff(", "await searchParams"]);
  });

  it("every data section streams inside its own Suspense boundary", () => {
    const src = page();
    for (const c of [
      "CockpitBanners",
      "MyDayHomePanel",
      "MorningReportPanel",
      "GuidedCashPanel",
      "CockpitAttention",
      "CockpitSalesSection",
      "CockpitTaxSection",
      "CockpitRefundsSection",
      "CockpitHourlySection",
      "CockpitOrdersSection",
      "CockpitOpsSection",
    ]) {
      const re = new RegExp(`<Suspense fallback=\\{[^\\n]*\\}>\\s*(\\{canSeeCash \\? )?<${c}\\b`);
      expect(src, `${c} must sit directly inside a <Suspense>`).toMatch(re);
    }
    expect((src.match(/<Suspense\b/g) ?? []).length).toBeGreaterThanOrEqual(11);
  });

  it("sections share reads through React cache (one read per request)", () => {
    const data = read("src/lib/admin/cockpit-data.ts");
    expect(data).toContain('import { cache } from "react";');
    for (const n of ["cockpitSales", "cockpitOps", "cockpitRefunds", "cockpitLowStock"]) {
      expect(data).toMatch(new RegExp(`export const ${n} = cache\\(`));
    }
  });

  it("the heavy figures use the short display cache; failed reads are never stored", () => {
    const srv = read("src/lib/admin/cockpit-cache-server.ts");
    expect(srv).toContain('import "server-only"');
    expect(srv).toContain("decideCockpitCacheWrite(");
    expect(srv).toContain("tags: [COCKPIT_CACHE_TAG]");
    expect(srv).toContain('if (!r.ok) throw new Error("today\'s returns and voids could not be read")');
    expect(read("src/lib/admin/cockpit-extras-server.ts")).toContain('cockpitCached("taxes-today", COCKPIT_TODAY_TTL_S');
    expect(COCKPIT_TODAY_TTL_S).toBeLessThanOrEqual(60);
    expect(COCKPIT_PAST_TTL_S).toBeLessThanOrEqual(900);
    expect(COCKPIT_STOCK_TTL_S).toBeLessThanOrEqual(300);
    expect(decideCockpitCacheWrite(new Map()).store).toBe(false);
    expect(isPlainJson({ a: [1, { b: "c" }] })).toBe(true);
  });

  it("CACHE THE DISPLAY, NEVER THE MONEY: only the cockpit imports the display cache", () => {
    const users = [
      "src/lib/admin/cockpit-data.ts",
      "src/lib/admin/cockpit-extras-server.ts",
    ];
    for (const f of [
      "src/lib/reports/wa-tax.ts",
      "src/lib/reports/sales.ts",
      "src/lib/compliance/excise-return.ts",
      "src/lib/compliance/ccrs-sales.ts",
      "src/lib/accounting/sage-exports.ts",
      "src/lib/purchasing/po-store.ts",
    ]) {
      expect(read(f), `${f} must read straight through`).not.toContain("cockpit-cache");
    }
    for (const f of users) expect(read(f)).toContain("cockpit-cache");
  });

  it("an unreadable low-stock count says so instead of 'all above reorder point'", () => {
    const src = page();
    expect(src).toContain('value={snap.lowStockCount ?? "Unavailable"}');
    expect(src).toContain("Stock levels could not be read just now");
    expect(read("src/lib/admin/cockpit-data.ts")).toContain("return r.ok ? r.data : null;");
  });

  it("an unreadable day of sales is said out loud", () => {
    expect(page()).toContain("!snap.todayReadable");
  });
});

describe("PERF P3: the category lookups read only the sold keys", () => {
  it("WA tax, LIQ-1295, Cultivera benchmark, CCRS Sale.csv and both Sage exports pass the keys", () => {
    expect(read("src/lib/reports/wa-tax.ts")).toContain("buildCategoryLookup(admin, lines.map((l) => l.product_id))");
    expect(read("src/lib/reports/wa-tax.ts")).toContain("loadLatestMenuFacts(admin, keys ?? null)");
    expect(read("src/lib/compliance/excise-return.ts")).toContain("buildCategoryLookup(admin, lines.map((l) => l.product_id))");
    expect(read("src/lib/reports/cultivera-benchmark-report-store.ts")).toContain(
      "buildCategoryLookup(admin, lineRows.map((l) => l.product_id))",
    );
    expect(read("src/lib/compliance/ccrs-sales.ts")).toContain("buildCategoryLookup(admin, lines.map((l) => l.product_id))");
    const sage = read("src/lib/accounting/sage-exports.ts");
    expect(sage).toContain("buildCategoryLookup(admin, lines.map((l) => l.product_id))");
    expect(sage).toContain("buildCategoryLookup(admin, lotsData.map((l) => l.pos_product_key))");
  });

  it("no caller is left reading every product key", () => {
    for (const f of [
      "src/lib/reports/wa-tax.ts",
      "src/lib/compliance/excise-return.ts",
      "src/lib/reports/cultivera-benchmark-report-store.ts",
      "src/lib/compliance/ccrs-sales.ts",
      "src/lib/accounting/sage-exports.ts",
    ]) {
      expect(strip(read(f)), f).not.toContain("buildCategoryLookup(admin)");
      expect(strip(read(f)), f).not.toContain("loadLatestMenuFacts(admin))");
    }
  });

  it("the filing reads it touched now read their errors (rule 135)", () => {
    const wa = read("src/lib/reports/wa-tax.ts");
    expect(wa).toContain("WA tax report: completed orders could not be read");
    expect(wa).toContain("WA tax report: order lines could not be read");
    expect(wa).toContain("WA tax report: medical exemptions could not be read");
    expect(read("src/lib/compliance/ccrs-sales.ts")).toContain("CCRS Sale.csv: order lines could not be read");
    expect(read("src/lib/accounting/sage-exports.ts")).toContain("Sage cash receipts: order lines could not be read");
    expect(read("src/lib/accounting/sage-exports.ts")).toContain("Sage adjustments: lots could not be read");
    const sales = read("src/lib/reports/sales.ts");
    expect(sales).toContain("Sales report: orders could not be read");
    expect(sales).toContain("Sales report: order lines could not be read");
  });
});

describe("PERF P3: reorder suggestions read every lot", () => {
  const po = () => read("src/lib/purchasing/po-store.ts");
  it("active lots are paged (no silent 1,000-row cap) and every read is checked", () => {
    const src = po();
    const fn = src.slice(src.indexOf("export async function buildReorderSuggestions"), src.indexOf("// Purchase order CRUD"));
    expect(fn).toContain("pagedAll<LotRow>(");
    expect(fn).toContain("Reorder suggestions: active lots could not be read");
    expect(fn).toContain("Reorder suggestions: recent orders could not be read");
    expect(fn).toContain("chunkedIn<string, SoldLine>(");
    expect(fn).toContain("Reorder suggestions: sold lines could not be read");
    expect(fn).toContain("could not be read: ${error.message}");
    // No unpaged, unchecked `{ data: ... } = await admin` reads left in it.
    expect(fn).not.toMatch(/const \{ data: \w+ \} = await admin/);
  });
});
