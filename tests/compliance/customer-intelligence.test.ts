/**
 * tests/compliance/customer-intelligence.test.ts  (Slice 3)
 *
 * Customer tracking must be CONNECTED before it can be clever. This file pins
 * both halves:
 *
 *   1. CONNECTION — migration 0232 keeps visit_count / lifetime spend /
 *      last + first visit live from completed orders less refunds (the same
 *      revenue basis as every report), preserves the old-POS spend in its own
 *      column, and the pre-0232 fallback (rollupsFromRows) computes the SAME
 *      four facts. The importer writes old-POS spend to the new column and
 *      falls back only when that column is genuinely missing.
 *
 *   2. INTELLIGENCE — the pure cores (one customer's profile; the whole base)
 *      are checked with hand-worked numbers, independent of the cores' own
 *      embedded self-tests, which are ALSO required to run and pass here.
 *
 *   3. WIRING — the pages actually call the loaders and render the sections;
 *      the nav links the dashboard; the pure runner registers both suites.
 *
 * Every expected value below was worked out by hand from the rules in the
 * source, not copied from a run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  __runCustomerInsightsCoreTests,
  buildCustomerInsights,
  computeCadence,
  money,
  productKeyOf,
  purchaseChannelOf,
  type LineInput,
  type PurchaseInput,
} from "@/lib/customers/customer-insights-core";
import {
  __runCustomerSegmentsCoreTests,
  dueAndOverdue,
  identificationRate,
  preferenceLift,
  quintileScores,
  scorePopulation,
  segmentFor,
  stapleSignalsFromProductDays,
  storeTypicalGapDays,
  buildStockWatch,
} from "@/lib/customers/customer-segments-core";
import { rollupsFromRows } from "@/lib/customers/customer-insights-server";
import { isMissingImportedSpendColumn } from "@/lib/customers/import";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// Embedded self-tests must run and pass (and not be hollow)
// ---------------------------------------------------------------------------
describe("embedded core self-tests", () => {
  it("customer-insights-core: all pass, at least 125 assertions", () => {
    const r = __runCustomerInsightsCoreTests();
    expect(r.messages.filter((m) => m.startsWith("FAIL"))).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(125);
  });
  it("customer-segments-core: all pass, at least 105 assertions", () => {
    const r = __runCustomerSegmentsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(105);
  });
});

// ---------------------------------------------------------------------------
// CONNECTION: the fallback fold == the trigger's definition
// ---------------------------------------------------------------------------
describe("rollupsFromRows (pre-0232 fallback, same rules as customer_rollup_compute)", () => {
  const orders = [
    { id: "o1", customer_id: "A", total_minor_units: 5000, placed_at: "2026-05-01T18:00:00Z", completed_at: "2026-05-01T18:05:00Z" },
    { id: "o2", customer_id: "A", total_minor_units: 3000, placed_at: "2026-05-10T18:00:00Z", completed_at: null },
    { id: "o3", customer_id: "B", total_minor_units: 1000, placed_at: "2026-05-03T18:00:00Z", completed_at: "2026-05-03T18:01:00Z" },
  ];
  const refunds = [
    { order_id: "o1", refund_minor_units: 1200 },
    { order_id: "o1", refund_minor_units: 300 },
    { order_id: "o3", refund_minor_units: 4000 }, // more than paid → floored at 0
  ];
  const out = rollupsFromRows(["A", "B", "C"], orders, refunds);
  const by = new Map(out.map((r) => [r.customerId, r]));

  it("counts visits and nets refunds (A: 5000+3000−1500 = 6500)", () => {
    expect(by.get("A")).toEqual({
      customerId: "A",
      visits: 2,
      netSpendMinor: 6500,
      firstVisitAt: "2026-05-01T18:05:00Z", // completed_at preferred
      lastVisitAt: "2026-05-10T18:00:00Z", // placed_at fallback when completed_at is null
    });
  });
  it("floors spend at zero like greatest(0, …)", () => {
    expect(by.get("B")?.netSpendMinor).toBe(0);
    expect(by.get("B")?.visits).toBe(1);
  });
  it("keeps customers with no purchases at zero", () => {
    expect(by.get("C")).toEqual({ customerId: "C", visits: 0, netSpendMinor: 0, firstVisitAt: null, lastVisitAt: null });
  });
});

describe("migration 0232 text", () => {
  const sql = read("supabase/migrations/0232_customer_rollups.sql");
  // Code only: strip "--" comments so a comment can never satisfy an assertion.
  const code = sql.replace(/--[^\n]*/g, "");
  const body = (fn: string) => {
    const start = code.indexOf(`create or replace function public.${fn}`);
    const open = code.indexOf("$$", start);
    const close = code.indexOf("$$", open + 2);
    return start < 0 || open < 0 || close < 0 ? "" : code.slice(open + 2, close);
  };
  it("counts only completed orders, nets refunds, floors at zero", () => {
    const compute = body("customer_rollup_compute(");
    expect(compute).toMatch(/where o\.customer_id = p_customer_id\s+and o\.status = 'completed'/);
    expect(compute).toMatch(/greatest\(0,/);
    expect(compute).toMatch(/from public\.customer_returns r/);
    expect(sql).toMatch(/greatest\(\s*0/i);
    expect(sql).toMatch(/customer_returns/);
    expect(sql).toMatch(/coalesce\(\s*o\.completed_at\s*,\s*o\.placed_at\s*\)|coalesce\(\s*completed_at\s*,\s*placed_at\s*\)/i);
  });
  it("preserves the old-POS spend exactly once, only when the column is created", () => {
    expect(sql).toMatch(/imported_spend_minor_units/);
    expect(sql).toMatch(/cultivera-export/);
    // The copy lives inside the IF-NOT-EXISTS branch, so a re-run never re-copies.
    expect(sql).toMatch(
      /if not exists \([\s\S]*?column_name = 'imported_spend_minor_units'[\s\S]*?\) then[\s\S]*?add column imported_spend_minor_units[\s\S]*?set imported_spend_minor_units = lifetime_spend_minor_units[\s\S]*?cultivera-export[\s\S]*?end if;/,
    );
    // The copy sits directly under the add-column, with no branch closing in between.
    const doStart = code.indexOf("add column imported_spend_minor_units");
    const copyAt = code.indexOf("set imported_spend_minor_units = lifetime_spend_minor_units");
    expect(doStart).toBeGreaterThan(0);
    expect(copyAt).toBeGreaterThan(doStart);
    expect(code.slice(doStart, copyAt)).not.toMatch(/end if|if true|else/i);
    // …and there is no other copy statement outside it.
    expect(sql.match(/set imported_spend_minor_units = lifetime_spend_minor_units/g)).toHaveLength(1);
  });
  it("installs the triggers on orders and customer_returns", () => {
    expect(sql).toMatch(/create trigger orders_customer_rollup_ins_del/i);
    expect(sql).toMatch(/create trigger orders_customer_rollup_upd/i);
    expect(sql).toMatch(/after update of status, customer_id, total_minor_units, completed_at, placed_at/i);
    expect(sql).toMatch(/create trigger customer_returns_customer_rollup/i);
  });
  it("is re-runnable and locked down", () => {
    expect(sql).toMatch(/drop trigger if exists orders_customer_rollup_ins_del/i);
    expect(sql).toMatch(/drop function if exists public\.customer_rollup_audit\(\)/i);
    expect(sql).toMatch(/revoke all on function public\.customer_rollup_compute\(uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.customer_rollup_audit\(\) to service_role/i);
    expect(sql).toMatch(/notify pgrst, 'reload schema'/);
  });
  it("is documented for the owner with the audit query", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toMatch(/0232_customer_rollups\.sql/);
    expect(doc).toMatch(/select \* from customer_rollup_audit\(\);/);
  });
});

describe("importer: old-POS spend goes to imported_spend_minor_units", () => {
  const src = read("src/lib/customers/import.ts");
  it("writes the new column, keeps a legacy fallback", () => {
    expect(src).toMatch(/imported_spend_minor_units:\s*row\.lifetime_spend_minor_units/);
    expect(src).toMatch(/legacyPayload/);
  });
  it("falls back only for the genuine missing-column error", () => {
    expect(isMissingImportedSpendColumn({ code: "PGRST204", message: "Could not find the 'imported_spend_minor_units' column" })).toBe(true);
    expect(isMissingImportedSpendColumn({ code: "42703", message: 'column "imported_spend_minor_units" does not exist' })).toBe(true);
    expect(isMissingImportedSpendColumn({ code: "PGRST204", message: "Could not find the 'phone' column" })).toBe(false);
    expect(isMissingImportedSpendColumn({ code: "23505", message: "imported_spend_minor_units duplicate" })).toBe(false);
    expect(isMissingImportedSpendColumn(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// INTELLIGENCE: hand-worked checks
// ---------------------------------------------------------------------------
describe("computeCadence (hand-worked)", () => {
  it("personal rhythm: gaps 7,7,7 → every 7 days, medium confidence", () => {
    const c = computeCadence(["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22"], "2026-05-25", null);
    expect(c.basis).toBe("personal");
    expect(c.gapDays).toBe(7);
    expect(c.gapsObserved).toBe(3);
    expect(c.confidence).toBe("medium");
    expect(c.expectedNextDay).toBe("2026-05-29");
    expect(c.daysUntilExpected).toBe(4);
    expect(c.status).toBe("on_track"); // since 3 < 0.8×7 = 5.6
  });
  it("status bands: 6 days → due_now, 9 → overdue (> 8.75), 18 → lapsed (> 17.5)", () => {
    const days = ["2026-05-01", "2026-05-08"];
    expect(computeCadence(days, "2026-05-14", null).status).toBe("due_now");
    expect(computeCadence(days, "2026-05-17", null).status).toBe("overdue");
    expect(computeCadence(days, "2026-05-26", null).status).toBe("lapsed");
  });
  it("one visit uses the store gap, or says unknown", () => {
    expect(computeCadence(["2026-05-01"], "2026-05-03", 10).basis).toBe("store");
    expect(computeCadence(["2026-05-01"], "2026-05-03", null).status).toBe("unknown");
  });
});

describe("buildCustomerInsights (hand-worked profile)", () => {
  const L = (o: Partial<LineInput> & { productKey: string }): LineInput => ({
    productName: o.productKey,
    brand: null,
    vendor: null,
    category: null,
    strainType: null,
    thcText: null,
    quantity: 1,
    unitPriceMinor: 1000,
    regularPriceMinor: 1000,
    isCustom: false,
    ...o,
  });
  const P = (id: string, iso: string, lines: LineInput[]): PurchaseInput => ({
    orderId: id,
    orderNumber: id,
    channel: "register",
    pickedUpFrom: null,
    completedAt: iso,
    placedAt: iso,
    totalMinor: lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0),
    savingsMinor: 0,
    loyaltyDiscountMinor: 0,
    lines,
  });
  const flower = { productKey: "f1", productName: "Flower A", brand: "BrandX", vendor: "FarmX", category: "Flower", unitPriceMinor: 3000, regularPriceMinor: 3000 };
  const pre = { productKey: "r1", productName: "Preroll B", brand: "BrandY", vendor: "FarmY", category: "Pre-Roll", unitPriceMinor: 1000, regularPriceMinor: 1000 };
  const x = buildCustomerInsights({
    purchases: [
      P("a", "2026-05-01T20:00:00Z", [L(flower), L(pre)]), // 4000
      P("b", "2026-05-08T20:00:00Z", [L(flower)]), // 3000
      P("c", "2026-05-15T20:00:00Z", [L({ ...flower, quantity: 2 })]), // 6000
    ],
    returns: [{ orderId: "c", productName: "Flower A", quantity: 1, refundMinor: 3000, reason: "Defective", createdAt: "2026-05-16T20:00:00Z" }],
    onlineOrders: [],
    loyalty: null,
    catalog: [],
    unlinkedMatchingOrders: 0,
    context: {
      nowIso: "2026-05-18T20:00:00Z",
      storeTypicalGapDays: null,
      categoryMedianPriceMinor: {},
      birthdate: null,
      marketingConsent: false,
      doNotContact: false,
      importedSpendMinor: 0,
      importedLastPurchaseAt: null,
      spendRankLabel: null,
      segmentLabel: null,
    },
  });
  it("money: gross 13000, refunds 3000, net 10000, AOV round(13000/3) = 4333", () => {
    expect(x.visits).toBe(3);
    expect(x.grossSpendMinor).toBe(13000);
    expect(x.refundsMinor).toBe(3000);
    expect(x.netSpendMinor).toBe(10000);
    expect(x.avgOrderMinor).toBe(4333);
  });
  it("favourites: Flower/BrandX/FarmX lead with 12000 of 13000 attributed", () => {
    expect(x.topCategories[0]).toMatchObject({ label: "Flower", spendMinor: 12000, units: 4, visits: 3 });
    expect(x.topCategories[0].spendShare).toBeCloseTo(12000 / 13000, 10);
    expect(x.topBrands.map((b) => b.label)).toEqual(["BrandX", "BrandY"]);
    expect(x.topVendors[0].label).toBe("FarmX");
  });
  it("staple: Flower A on 3 days, 7-day gap, last 3 days ago → due in 4", () => {
    const s = x.staples.find((st) => st.productKey === "f1");
    expect(s).toMatchObject({ purchaseDays: 3, typicalGapDays: 7, daysSinceLast: 3, dueInDays: 4 });
  });
  it("cadence: every 7 days, on track", () => {
    expect(x.cadence.gapDays).toBe(7);
    expect(x.cadence.status).toBe("on_track");
  });
  it("returns: one, reason tallied", () => {
    expect(x.returnsCount).toBe(1);
    expect(x.returnReasons).toEqual([{ label: "Defective", count: 1 }]);
  });
});

describe("small identity helpers", () => {
  it("money formats cents", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money(-50)).toBe("-$0.50");
  });
  it("productKeyOf prefers the id, else a normalized name", () => {
    expect(productKeyOf("abc", "Whatever")).toBe("abc");
    expect(productKeyOf(null, "Blue Dream")).toBe(productKeyOf(null, "  blue dream "));
  });
  it("purchaseChannelOf: register origin is in-store", () => {
    expect(purchaseChannelOf({ origin: "register" })).toBe("register");
    expect(purchaseChannelOf({ origin: "leafly" })).toBe("leafly");
  });
});

describe("segments core (hand-worked)", () => {
  it("quintiles: 5 distinct values → 1..5, and reversed for recency", () => {
    expect(quintileScores([10, 20, 30, 40, 50], true)).toEqual([1, 2, 3, 4, 5]);
    expect(quintileScores([10, 20, 30, 40, 50], false)).toEqual([5, 4, 3, 2, 1]);
  });
  it("segment rules", () => {
    expect(segmentFor({ r: 5, f: 5, m: 5 }, 9)).toBe("champions");
    expect(segmentFor({ r: 1, f: 5, m: 5 }, 9)).toBe("cant_lose");
    expect(segmentFor({ r: 5, f: 1, m: 1 }, 1)).toBe("new");
    expect(segmentFor({ r: 1, f: 1, m: 1 }, 1)).toBe("lost");
    expect(segmentFor(null, 0)).toBe("none");
  });
  it("store typical gap: median of span/(visits−1)", () => {
    // A: 20 days / 2 = 10; B: 30 / 1 = 30; C: 12 / 3 = 4 → median 10
    const g = storeTypicalGapDays([
      { customerId: "A", visits: 3, netSpendMinor: 1, firstVisitAt: "2026-05-01T00:00:00Z", lastVisitAt: "2026-05-21T00:00:00Z" },
      { customerId: "B", visits: 2, netSpendMinor: 1, firstVisitAt: "2026-04-01T00:00:00Z", lastVisitAt: "2026-05-01T00:00:00Z" },
      { customerId: "C", visits: 4, netSpendMinor: 1, firstVisitAt: "2026-05-01T00:00:00Z", lastVisitAt: "2026-05-13T00:00:00Z" },
      { customerId: "D", visits: 1, netSpendMinor: 1, firstVisitAt: "2026-05-01T00:00:00Z", lastVisitAt: "2026-05-01T00:00:00Z" },
    ]);
    expect(g).toBe(10);
  });
  it("scorePopulation leaves non-buyers unscored", () => {
    const s = scorePopulation([{ customerId: "Z", visits: 0, netSpendMinor: 0, firstVisitAt: null, lastVisitAt: null }], "2026-05-20T00:00:00Z");
    expect(s[0].segment).toBe("none");
    expect(s[0].score).toBeNull();
  });
  it("dueAndOverdue: gap 10; since 8 → due in 2; since 15 → overdue; since 30 → neither", () => {
    const now = "2026-06-01T00:00:00Z";
    const mk = (id: string, lastDay: string, firstDay: string) => ({
      customerId: id,
      visits: 2,
      netSpendMinor: 100,
      firstVisitAt: `${firstDay}T00:00:00Z`,
      lastVisitAt: `${lastDay}T00:00:00Z`,
    });
    const { dueSoon, overdue } = dueAndOverdue(
      [mk("due", "2026-05-24", "2026-05-14"), mk("late", "2026-05-17", "2026-05-07"), mk("gone", "2026-05-02", "2026-04-22"), { ...mk("one", "2026-05-30", "2026-05-30"), visits: 1 }],
      now,
      7,
    );
    expect(dueSoon.map((d) => [d.customerId, d.gapDays, d.dueInDays])).toEqual([["due", 10, 2]]);
    expect(overdue.map((d) => [d.customerId, d.dueInDays])).toEqual([["late", -5]]);
  });
  it("preferenceLift: group share / everyone share", () => {
    // Everyone: X 600, Y 400 (X 60%). Group {g}: X 300, Y 0 → groupShare X 100%, lift 1/0.6
    const rows = preferenceLift(
      [
        { customerId: "g", label: "X", spendMinor: 300 },
        { customerId: "o", label: "X", spendMinor: 300 },
        { customerId: "o", label: "Y", spendMinor: 400 },
      ],
      new Set(["g"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("X");
    expect(rows[0].groupShare).toBe(1);
    expect(rows[0].allShare).toBeCloseTo(0.6, 10);
    expect(rows[0].lift).toBeCloseTo(1 / 0.6, 10);
    expect(rows[0].groupCustomers).toBe(1);
  });
  it("staple signals + stock watch: sold-out staple for a champion → reorder now", () => {
    const signals = stapleSignalsFromProductDays(
      [
        { customerId: "c1", productKey: "p", productName: "P", dayKey: "2026-05-01" },
        { customerId: "c1", productKey: "p", productName: "P", dayKey: "2026-05-01" }, // same day collapses
        { customerId: "c1", productKey: "p", productName: "P", dayKey: "2026-05-11" },
        { customerId: "c2", productKey: "q", productName: "Q", dayKey: "2026-05-11" }, // one day: not a staple
      ],
      "2026-05-15",
      new Map([["c1", "champions" as const]]),
    );
    expect(signals).toEqual([
      { customerId: "c1", productKey: "p", productName: "P", purchaseDays: 2, typicalGapDays: 10, daysSinceLast: 4, segment: "champions" },
    ]);
    const watch = buildStockWatch(signals, new Map([["p", "unavailable" as const]]));
    expect(watch[0]).toMatchObject({ productKey: "p", urgency: "reorder_now", regulars: 1, valuableRegulars: 1, dueSoon: 1, typicalGapDays: 10 });
  });
  it("identification rate clamps and handles zero", () => {
    expect(identificationRate(3, 4)).toBe(0.75);
    expect(identificationRate(9, 4)).toBe(1);
    expect(identificationRate(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
describe("pages are wired to the loaders", () => {
  it("customer profile renders the intelligence and the connect-history form", () => {
    const p = read("src/app/admin/customers/[id]/page.tsx");
    expect(p).toMatch(/loadCustomerProfile\(customer\)/);
    expect(p).toMatch(/linkCustomerOrdersAction\.bind\(null, id\)/);
    expect(p).toMatch(/name="orderId"/);
    expect(p).toMatch(/Next best action/);
    expect(p).toMatch(/Favourite brands/);
    expect(p).toMatch(/Favourite vendors/);
    expect(p).toMatch(/Their staples/);
    expect(p).toMatch(/CustomerMonthlyChart/);
    expect(p).toMatch(/profile\.partial\.length > 0/);
    expect(p).toMatch(/populationSource === "computed"/);
    // The old dead columns are no longer the headline numbers.
    expect(p).not.toMatch(/value=\{customer\.visit_count\}/);
    // The editing panels are kept.
    expect(p).toMatch(/<CustomerForm/);
    expect(p).toMatch(/<LoyaltyPanel/);
    expect(p).toMatch(/<MedicalPanel/);
  });
  it("customer list shows live figures and groups", () => {
    const p = read("src/app/admin/customers/page.tsx");
    expect(p).toMatch(/loadSegmentMap\(\)/);
    expect(p).toMatch(/figuresFor\(c\)/);
    expect(p).toMatch(/\/admin\/customers\/insights/);
    expect(p).not.toMatch(/\{c\.visit_count\}<\/td>/);
  });
  it("insights dashboard is permission-gated and renders every section", () => {
    const p = read("src/app/admin/customers/insights/page.tsx");
    expect(p).toMatch(/requirePermission\("customers\.manage"\)/);
    expect(p).toMatch(/loadIntelligenceDashboard\(\)/);
    for (const s of ["identificationAdvice", "CONFIDENCE_NOTE", "SegmentCharts", "Due back this week", "Win-back list", "Stock watch", "Brands your best customers love", "Top customers by spend"]) {
      expect(p).toContain(s);
    }
    // Win-back respects consent.
    expect(p).toMatch(/doNotContact/);
  });
  it("link action is permission-checked and audited", () => {
    const a = read("src/app/admin/customers/actions.ts");
    const fn = a.slice(a.indexOf("export async function linkCustomerOrdersAction"));
    expect(fn).toMatch(/requirePermission\("customers\.manage"\)/);
    expect(fn).toMatch(/can\([^)]*"orders\.manage"\)/);
    expect(fn).toMatch(/linkMatchedOrders\(/);
    expect(fn).toMatch(/order\.customer_linked/);
  });
  it("linking never overwrites another customer's order", () => {
    const s = read("src/lib/customers/customer-insights-server.ts");
    const fn = s.slice(s.indexOf("export async function linkMatchedOrders"), s.indexOf("export type NamedCustomer"));
    expect(fn).toMatch(/\.is\("customer_id", null\)/);
    expect(fn).toMatch(/partial\.length > 0/);
  });
  it("nav links the dashboard under CRM with the same permission", () => {
    const item = adminNav.find((n) => n.href === "/admin/customers/insights");
    expect(item).toBeDefined();
    expect(item?.group).toBe("CRM");
    expect(item?.permission).toBe("customers.manage");
  });
  it("pure runner registers both suites", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toMatch(/assertRan\("customer-insights-core", __runCustomerInsightsCoreTests\(\), \d+\)/);
    expect(r).toMatch(/assertRan\("customer-segments-core", __runCustomerSegmentsCoreTests\(\), \d+\)/);
  });
});
