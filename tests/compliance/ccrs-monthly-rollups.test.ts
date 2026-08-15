/**
 * tests/compliance/ccrs-monthly-rollups.test.ts
 *
 * S3 coverage for the monthly-zip transformer's server boundary:
 * sanitizeAggregationResult — the structural validator that stands between the
 * browser-posted rollup JSON and the database. NEVER GUESS: a malformed
 * payload must be rejected whole; a valid payload must round-trip losslessly.
 * (persistAggregationResult itself is DB glue, exercised in preview — the
 * validation gate is the part that must be airtight.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeAggregationResult } from "@/lib/discovery/market-rollups";
import { CcrsAggregator } from "@/lib/discovery/ccrs-extract/aggregate";

function validResult(): unknown {
  // Built by the REAL aggregator so the fixture can never drift from the
  // transformer's actual output shape.
  const agg = new CcrsAggregator({
    selfLicenseNumber: "413541",
    trackedLicenseNumbers: ["415229"],
  });
  agg.addLicensee({
    licenseeId: "900",
    licenseNumber: "415229",
    name: "POT ZONE PO LLC",
    dba: "POT ZONE",
    status: "Active",
    city: "PORT ORCHARD",
    county: "KITSAP",
  });
  agg.addStrain({ strainId: "77", name: "Blue Dream" });
  agg.addProduct({
    productId: "5001",
    licenseeId: null,
    inventoryType: "Usable Marijuana",
    name: "Phat Panda | Grape Ape 3.5g",
    unitWeightGrams: 3.5,
  });
  agg.addInventory({ inventoryId: "9001", licenseeId: null, productId: "5001", strainId: "77", externalIdentifier: null });
  agg.addSaleHeader({
    saleHeaderId: "327733901",
    sellerLicenseeId: "900",
    buyerLicenseeId: null,
    saleType: "retail",
    saleDate: "2026-05-10",
  });
  agg.addSaleDetail({
    saleHeaderId: "327733901",
    inventoryId: "9001",
    quantity: 3,
    unitPriceMinor: 2500,
    discountMinor: 0,
    isDeleted: false,
  });
  // S7: a wholesale purchase — the tracked competitor buys from licensee 901.
  agg.addLicensee({
    licenseeId: "901",
    licenseNumber: "999999",
    name: "SOMEWHERE ELSE LLC",
    dba: null,
    status: "Active",
    city: "SPOKANE",
    county: null,
  });
  agg.addSaleHeader({
    saleHeaderId: "327733904",
    sellerLicenseeId: "901",
    buyerLicenseeId: "900",
    saleType: "wholesale",
    saleDate: "2026-05-01",
  });
  agg.addSaleDetail({
    saleHeaderId: "327733904",
    inventoryId: null,
    quantity: 50,
    unitPriceMinor: 220,
    discountMinor: 0,
    isDeleted: false,
  });
  // Serialize/deserialize like the real client→server hop.
  return JSON.parse(JSON.stringify(agg.result()));
}

describe("sanitizeAggregationResult", () => {
  it("round-trips a real aggregator payload losslessly", () => {
    const out = sanitizeAggregationResult(validResult());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    // I1: period = the dominant SaleHeader month's FULL span (all headers are
    // May 2026 here), with the honest observed span carried alongside.
    expect(r.periodStart).toBe("2026-05-01");
    expect(r.periodEnd).toBe("2026-05-31");
    expect(r.observedMinDate).toBe("2026-05-01");
    expect(r.observedMaxDate).toBe("2026-05-10");
    expect(r.totals.saleDetailRows).toBe(2);
    expect(r.totals.retailLines).toBe(1);
    expect(r.totals.wholesaleLines).toBe(1);
    expect(r.totals.attributedRetailLines).toBe(1);
    // Statewide: overall + type + brand + strain (retail).
    const overall = r.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
    expect(overall?.unitPrice?.medianMinor).toBe(2500);
    expect(overall?.revenueMinor).toBe(7500);
    // Competitor preserved with price summary and top products.
    expect(r.competitors).toHaveLength(1);
    expect(r.competitors[0].licenseNumber).toBe("415229");
    expect(r.competitors[0].retail.unitPrice?.sampleSize).toBe(1);
    expect(r.competitors[0].retail.topProducts[0].productName).toBe("Phat Panda | Grape Ape 3.5g");
    // S7: wholesale sourcing round-trips losslessly.
    const ws = r.competitors[0].wholesale;
    expect(ws.lineCount).toBe(1);
    expect(ws.spendMinor).toBe(11_000);
    expect(ws.topSuppliers).toHaveLength(1);
    expect(ws.topSuppliers[0]).toEqual({
      licenseeId: "901",
      licenseNumber: "999999",
      name: "SOMEWHERE ELSE LLC",
      dba: null,
      lineCount: 1,
      spendMinor: 11_000,
    });
    // Signals preserved with both bands.
    const mover = r.signals.find((s) => s.kind === "statewide_mover");
    expect(mover?.p25UnitPriceMinor).toBe(2500);
    expect(mover?.medianUnitPriceMinor).toBe(2500);
  });

  it("accepts pre-S7 payloads without a wholesale block (backward compatible)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    const comps = base.competitors as Array<Record<string, unknown>>;
    for (const c of comps) delete c.wholesale; // older transformer build
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const ws = out.result.competitors[0].wholesale;
    expect(ws.lineCount).toBe(0);
    expect(ws.spendMinor).toBe(0);
    expect(ws.topSuppliers).toEqual([]);
  });

  it("rejects supplier rows without a licenseeId and oversized supplier lists", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    const comps = base.competitors as Array<Record<string, unknown>>;
    (comps[0].wholesale as Record<string, unknown>).topSuppliers = [
      { licenseeId: "", name: "NO ID LLC", lineCount: 1, spendMinor: 100 },
    ];
    expect(sanitizeAggregationResult(base).ok).toBe(false);

    const base2 = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    const comps2 = base2.competitors as Array<Record<string, unknown>>;
    (comps2[0].wholesale as Record<string, unknown>).topSuppliers = Array.from(
      { length: 21 },
      (_, i) => ({ licenseeId: String(i + 1), lineCount: 1, spendMinor: 1 }),
    );
    const out2 = sanitizeAggregationResult(base2);
    expect(out2.ok).toBe(false);
    if (out2.ok) return;
    expect(out2.error).toMatch(/supplier/i);
  });

  it("coerces junk supplier numbers to safe values (never trusted)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    const comps = base.competitors as Array<Record<string, unknown>>;
    (comps[0].wholesale as Record<string, unknown>) = {
      lineCount: "7",
      spendMinor: Number.NaN,
      topSuppliers: [
        { licenseeId: "901", licenseNumber: 42, name: "", dba: null, lineCount: "3", spendMinor: 100.6 },
      ],
    };
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const ws = out.result.competitors[0].wholesale;
    expect(ws.lineCount).toBe(0); // string → 0, not parsed
    expect(ws.spendMinor).toBe(0); // NaN → 0
    expect(ws.topSuppliers[0].licenseNumber).toBeNull(); // number → null, not coerced
    expect(ws.topSuppliers[0].name).toBeNull(); // empty string → null
    expect(ws.topSuppliers[0].lineCount).toBe(0);
    expect(ws.topSuppliers[0].spendMinor).toBe(101); // rounded integer cents
  });

  it("rejects non-object payloads", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      const out = sanitizeAggregationResult(bad);
      expect(out.ok).toBe(false);
    }
  });

  it("rejects payloads missing the rollup arrays", () => {
    const out = sanitizeAggregationResult({ totals: {}, statewide: [] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/missing/i);
  });

  it("rejects malformed statewide rows (bad scope / class / key)", () => {
    const base = validResult() as Record<string, unknown>;
    const withBadRow = {
      ...base,
      statewide: [
        { scope: "bogus", scopeKey: "x", saleClass: "retail", units: 1, revenueMinor: 1 },
      ],
    };
    expect(sanitizeAggregationResult(withBadRow).ok).toBe(false);

    const withBadClass = {
      ...base,
      statewide: [{ scope: "type", scopeKey: "x", saleClass: "sideways", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(withBadClass).ok).toBe(false);

    const withNoKey = {
      ...base,
      statewide: [{ scope: "type", scopeKey: "", saleClass: "retail", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(withNoKey).ok).toBe(false);
  });

  it("rejects competitor rows without license identifiers", () => {
    const base = validResult() as Record<string, unknown>;
    const bad = {
      ...base,
      competitors: [{ licenseNumber: "", licenseeId: "1", retail: {} }],
    };
    expect(sanitizeAggregationResult(bad).ok).toBe(false);
  });

  it("rejects signals with unknown kinds", () => {
    const base = validResult() as Record<string, unknown>;
    const bad = {
      ...base,
      signals: [{ kind: "made_up_mover", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(bad).ok).toBe(false);
  });

  // Task I (I4): the per-type top-10 signal kind + manifest-derived vendor
  // fields (migration 0110) must round-trip; pre-I4 payloads must still pass.
  it("accepts type_mover signals and round-trips vendor fields losslessly (I4)", () => {
    const base = validResult() as Record<string, unknown>;
    const withType = {
      ...base,
      signals: [
        {
          kind: "type_mover",
          licenseNumber: null,
          inventoryType: "Usable Marijuana",
          productName: "Phat Panda | Grape Ape 3.5g",
          brand: "Phat Panda",
          strainName: "Blue Dream",
          units: 3,
          revenueMinor: 7500,
          medianUnitPriceMinor: 2500,
          p25UnitPriceMinor: 2500,
          vendorName: "GROW OP LLC",
          vendorLicense: "620002",
        },
      ],
    };
    const out = sanitizeAggregationResult(withType);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.signals).toHaveLength(1);
    const s = out.result.signals[0];
    expect(s.kind).toBe("type_mover");
    expect(s.inventoryType).toBe("Usable Marijuana");
    expect(s.vendorName).toBe("GROW OP LLC");
    expect(s.vendorLicense).toBe("620002");
  });

  it("sanitizes missing/junk vendor fields to null — pre-I4 payloads stay valid (I4)", () => {
    // A pre-I4 transformer payload: signals carry NO vendor fields at all.
    const base = validResult() as Record<string, unknown>;
    const signals = base.signals as Array<Record<string, unknown>>;
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      delete s.vendorName;
      delete s.vendorLicense;
    }
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const s of out.result.signals) {
      expect(s.vendorName).toBeNull();
      expect(s.vendorLicense).toBeNull();
    }

    // Junk types must coerce to null, never pass through.
    const base2 = validResult() as Record<string, unknown>;
    const signals2 = base2.signals as Array<Record<string, unknown>>;
    signals2[0].vendorName = 42;
    signals2[0].vendorLicense = { evil: true };
    const out2 = sanitizeAggregationResult(base2);
    expect(out2.ok).toBe(true);
    if (!out2.ok) return;
    expect(out2.result.signals[0].vendorName).toBeNull();
    expect(out2.result.signals[0].vendorLicense).toBeNull();
  });

  it("counts manifest input totals, defaulting to 0 for pre-I4 payloads (I4)", () => {
    // The real-aggregator fixture fed no manifests → totals must be 0, not undefined.
    const out = sanitizeAggregationResult(validResult());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.totals.manifestRows).toBe(0);
    expect(out.result.totals.transportedItemRows).toBe(0);

    // Payload with counts round-trips them.
    const base = validResult() as Record<string, unknown>;
    (base.totals as Record<string, unknown>).manifestRows = 123;
    (base.totals as Record<string, unknown>).transportedItemRows = 456;
    const out2 = sanitizeAggregationResult(base);
    expect(out2.ok).toBe(true);
    if (!out2.ok) return;
    expect(out2.result.totals.manifestRows).toBe(123);
    expect(out2.result.totals.transportedItemRows).toBe(456);
  });

  it("rejects oversized payloads (defensive caps)", () => {
    const base = validResult() as Record<string, unknown>;
    const row = { scope: "type", scopeKey: "x", saleClass: "retail", units: 1, revenueMinor: 1 };
    const huge = { ...base, statewide: Array.from({ length: 5_001 }, () => ({ ...row })) };
    const out = sanitizeAggregationResult(huge);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/too many/i);
  });

  it("coerces junk numbers/dates to safe values instead of trusting them", () => {
    const base = validResult() as Record<string, unknown>;
    const messy = {
      ...base,
      periodStart: "not-a-date",
      periodEnd: "2026-05-31",
      totals: { saleDetailRows: "9999", retailLines: Number.NaN },
      statewide: [
        {
          scope: "overall",
          scopeKey: "all",
          saleClass: "retail",
          unitPrice: { sampleSize: 0 }, // zero samples → summary must become null
          pricePerGram: "garbage",
          units: "12",
          revenueMinor: 100.7,
        },
      ],
      competitors: [],
      signals: [],
    };
    const out = sanitizeAggregationResult(messy);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.periodStart).toBeNull(); // bad date → null, not guessed
    expect(out.result.periodEnd).toBe("2026-05-31");
    expect(out.result.totals.saleDetailRows).toBe(0); // string → 0, not parsed
    expect(out.result.totals.retailLines).toBe(0); // NaN → 0
    expect(out.result.statewide[0].unitPrice).toBeNull();
    expect(out.result.statewide[0].pricePerGram).toBeNull();
    expect(out.result.statewide[0].units).toBe(0);
    expect(out.result.statewide[0].revenueMinor).toBe(101); // rounded to integer cents
  });

  it("truncates over-long strings instead of storing unbounded keys", () => {
    const base = validResult() as Record<string, unknown>;
    const long = "x".repeat(1000);
    const bad = {
      ...base,
      statewide: [
        { scope: "brand", scopeKey: long, saleClass: "retail", units: 1, revenueMinor: 1 },
      ],
    };
    const out = sanitizeAggregationResult(bad);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.statewide[0].scopeKey.length).toBeLessThanOrEqual(300);
  });

  // S8 regression: real statewide revenue totals exceed int4 (the April 2026
  // upload failed with "value 8932289184 is out of range for type integer").
  // Sanitize must PASS these values through untouched — the DB columns are
  // bigint as of migration 0108, so clamping them here would silently corrupt
  // money. Values chosen straight from the real failure + the May extract.
  it("passes >2^31 revenue totals through unclamped (real months overflow int4)", () => {
    const base = validResult() as Record<string, unknown>;
    const big = {
      ...base,
      statewide: [
        {
          scope: "overall",
          scopeKey: "all",
          saleClass: "retail",
          unitPrice: null,
          pricePerGram: null,
          units: 10_208_708,
          revenueMinor: 12_531_365_735, // May 2026 retail/overall/all (verified)
        },
        {
          scope: "type",
          scopeKey: "(unattributed)",
          saleClass: "wholesale",
          unitPrice: null,
          pricePerGram: null,
          units: 1,
          revenueMinor: 8_932_289_184, // the exact value from April's failure
        },
      ],
    };
    const out = sanitizeAggregationResult(big);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.statewide[0].revenueMinor).toBe(12_531_365_735);
    expect(out.result.statewide[1].revenueMinor).toBe(8_932_289_184);
  });
});

// ---------------------------------------------------------------------------
// S8 schema guard: every *_minor column the transformer writes must be bigint.
// The failed April upload proved a real month overflows int4 on the statewide
// revenue metrics (avg_minor carries retail_revenue / wholesale_revenue
// totals). Migration 0108 widens all three rollup tables; this test pins the
// migration text so the columns can never regress to `integer`.
// ---------------------------------------------------------------------------
describe("migration 0108 — rollup money columns are bigint", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0108_discovery_minor_columns_bigint.sql"),
    "utf8",
  );

  const required: Array<[table: string, column: string]> = [
    ["discovery_benchmarks", "min_minor"],
    ["discovery_benchmarks", "p25_minor"],
    ["discovery_benchmarks", "median_minor"],
    ["discovery_benchmarks", "p75_minor"],
    ["discovery_benchmarks", "max_minor"],
    ["discovery_benchmarks", "avg_minor"],
    ["discovery_competitor_stats", "price_min_minor"],
    ["discovery_competitor_stats", "price_p25_minor"],
    ["discovery_competitor_stats", "price_median_minor"],
    ["discovery_competitor_stats", "price_p75_minor"],
    ["discovery_competitor_stats", "price_max_minor"],
    ["discovery_competitor_stats", "price_avg_minor"],
    ["discovery_market_signals", "median_unit_price_minor"],
    ["discovery_market_signals", "p25_unit_price_minor"],
  ];

  it("widens every transformer-written *_minor column to bigint", () => {
    for (const [table, column] of required) {
      const tableBlock = sql
        .split(new RegExp(`alter table public\\.${table}\\b`))
        .slice(1)
        .join("\n");
      expect(tableBlock, `${table} block missing`).not.toBe("");
      const re = new RegExp(`alter column ${column}\\s+type bigint`);
      expect(re.test(tableBlock), `${table}.${column} must be widened to bigint`).toBe(true);
    }
  });

  it("never narrows a column back to integer", () => {
    // Strip `--` comments first: the header quotes the original Postgres
    // error text ("out of range for type integer"), which is documentation,
    // not DDL.
    const ddl = sql
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    expect(/type\s+integer/i.test(ddl)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S10: statewide supplier benchmarks — sanitize round-trip, backward compat,
// and the migration 0109 schema guard (bigint money, S8 lesson).
// ---------------------------------------------------------------------------
describe("sanitizeAggregationResult — statewide suppliers (S10)", () => {
  it("round-trips the aggregator's suppliers block losslessly", () => {
    const out = sanitizeAggregationResult(validResult());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The fixture's only wholesale seller is 901 (50 × $2.20 → $110.00).
    expect(out.result.suppliers).toHaveLength(1);
    const s = out.result.suppliers[0];
    expect(s.licenseeId).toBe("901");
    expect(s.licenseNumber).toBe("999999");
    expect(s.name).toBe("SOMEWHERE ELSE LLC");
    expect(s.dba).toBeNull();
    expect(s.lineCount).toBe(1);
    expect(s.revenueMinor).toBe(11_000);
    expect(s.unitPrice?.sampleSize).toBe(1);
    expect(s.unitPrice?.medianMinor).toBe(220);
    expect(s.distinctBuyers).toBe(1);
    expect(s.trackedBuyers).toBe(1);
  });

  it("accepts pre-S10 payloads without a suppliers array (backward compatible)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    delete base.suppliers; // older transformer build
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.suppliers).toEqual([]);
  });

  it("rejects statewide supplier rows without a licenseeId", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    base.suppliers = [{ licenseeId: "", name: "NO ID LLC", lineCount: 1, revenueMinor: 100 }];
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/supplier/i);
  });

  it("rejects oversized statewide supplier lists (defensive cap)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    base.suppliers = Array.from({ length: 201 }, (_, i) => ({
      licenseeId: String(i + 1),
      lineCount: 1,
      revenueMinor: 1,
    }));
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/supplier/i);
  });

  it("coerces junk supplier stat values to safe defaults (never trusted)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    base.suppliers = [
      {
        licenseeId: "901",
        licenseNumber: 42, // number → null, not coerced
        name: "",
        dba: null,
        lineCount: "3", // string → 0, not parsed
        revenueMinor: 100.6, // rounded to integer cents
        unitPrice: null,
        distinctBuyers: Number.NaN, // NaN → 0
        trackedBuyers: 2.9, // finite float → rounded (intOrNull semantics)
      },
    ];
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const s = out.result.suppliers[0];
    expect(s.licenseNumber).toBeNull();
    expect(s.name).toBeNull();
    expect(s.lineCount).toBe(0);
    expect(s.revenueMinor).toBe(101);
    expect(s.unitPrice).toBeNull();
    expect(s.distinctBuyers).toBe(0);
    expect(s.trackedBuyers).toBe(3); // Math.round(2.9)
  });

  it("passes >2^31 supplier revenue through unclamped (real months overflow int4)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    base.suppliers = [
      {
        licenseeId: "901",
        licenseNumber: "999999",
        name: "MEGA FARMS LLC",
        dba: null,
        lineCount: 590_560,
        revenueMinor: 8_716_406_494, // May 2026 wholesale overall revenue (verified)
        unitPrice: null,
        distinctBuyers: 400,
        trackedBuyers: 3,
      },
    ];
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.suppliers[0].revenueMinor).toBe(8_716_406_494);
  });
});

// ---------------------------------------------------------------------------
// S10 schema guard: migration 0109 must create the supplier-stats table with
// BIGINT money/count columns (the S8 lesson — never int4 for money rollups),
// the per-dataset uniqueness the delete-then-insert persist relies on, and
// staff-only RLS.
// ---------------------------------------------------------------------------
describe("migration 0109 — discovery_supplier_stats schema", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0109_discovery_supplier_stats.sql"),
    "utf8",
  );
  // Strip `--` comments line-wise so prose can't false-positive the DDL checks.
  const ddl = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  it("creates the table idempotently with bigint money and count columns", () => {
    expect(ddl).toMatch(/create table if not exists public\.discovery_supplier_stats/);
    for (const col of [
      "line_count",
      "revenue_minor",
      "price_sample_size",
      "price_min_minor",
      "price_p25_minor",
      "price_median_minor",
      "price_p75_minor",
      "price_max_minor",
      "price_avg_minor",
    ]) {
      const re = new RegExp(`${col}\\s+bigint`);
      expect(re.test(ddl), `${col} must be bigint`).toBe(true);
    }
    // No money/count column may be plain `integer` (buyer counts are the only
    // integer columns and they are bounded by the licensee population).
    expect(/\b(?:line_count|revenue_minor|price_\w+_minor|price_sample_size)\s+integer\b/.test(ddl)).toBe(false);
  });

  it("enforces one row per (dataset, supplier) and cascades on dataset delete", () => {
    expect(ddl).toMatch(/unique\s*\(\s*dataset_id\s*,\s*licensee_id\s*\)/);
    expect(ddl).toMatch(/references public\.discovery_datasets\s*\(\s*id\s*\)\s*on delete cascade/);
  });

  it("enables RLS with staff-only read and write policies", () => {
    expect(ddl).toMatch(/alter table public\.discovery_supplier_stats enable row level security/);
    expect(ddl).toMatch(/create policy discovery_supplier_stats_read/);
    expect(ddl).toMatch(/create policy discovery_supplier_stats_write/);
    expect(ddl).toMatch(/public\.is_staff\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Task I (I4): migration 0110 schema guard — the vendor columns behind the
// per-type top-10 boards. Text columns (no money), additive + idempotent.
// ---------------------------------------------------------------------------
describe("migration 0110 — discovery_market_signals vendor columns", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0110_discovery_signal_vendor.sql"),
    "utf8",
  );
  // Strip `--` comments line-wise so prose can't false-positive the DDL checks.
  const ddl = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  it("adds both vendor columns idempotently as plain text", () => {
    expect(ddl).toMatch(/alter table public\.discovery_market_signals/);
    expect(ddl).toMatch(/add column if not exists vendor_name\s+text/);
    expect(ddl).toMatch(/add column if not exists vendor_license\s+text/);
  });

  it("stays additive: no drops, no type changes, no constraint on kind", () => {
    expect(/drop\s/i.test(ddl)).toBe(false);
    expect(/alter column/i.test(ddl)).toBe(false);
    // kind is intentionally unconstrained text — 'type_mover' needs no DDL.
    expect(/check\s*\(/i.test(ddl)).toBe(false);
  });
});

/**
 * Medical class must survive the validator and reach the database.
 *
 * The validator previously accepted ONLY retail|wholesale, so a medical row
 * would have been rejected outright (whole payload refused). The benchmark-row
 * builder also chose metric names with a retail/else ternary, which would have
 * silently filed medical rows under the WHOLESALE metrics. Both are covered
 * here because either failure loses the medical breakout without erroring in a
 * way the owner would notice.
 */
describe("medical sale class — validator + metric mapping", () => {
  const medRow = {
    scope: "overall" as const,
    scopeKey: "all",
    saleClass: "medical",
    unitPrice: {
      sampleSize: 2,
      minMinor: 2500,
      p25Minor: 2500,
      medianMinor: 2500,
      p75Minor: 2500,
      maxMinor: 2500,
      avgMinor: 2500,
    },
    pricePerGram: null,
    units: 2,
    revenueMinor: 5000,
  };

  it("accepts a medical statewide row", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    (base.statewide as unknown[]).push(medRow);
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.statewide.some((b) => b.saleClass === "medical")).toBe(true);
  });

  it("preserves the medical row's figures exactly", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    (base.statewide as unknown[]).push(medRow);
    const out = sanitizeAggregationResult(base);
    if (!out.ok) throw new Error("expected ok");
    const med = out.result.statewide.find((b) => b.saleClass === "medical");
    expect(med?.units).toBe(2);
    expect(med?.revenueMinor).toBe(5000);
    expect(med?.unitPrice?.medianMinor).toBe(2500);
  });

  it("still rejects a genuinely unknown sale class", () => {
    const out = sanitizeAggregationResult({
      totals: {},
      statewide: [{ scope: "type", scopeKey: "x", saleClass: "sideways", units: 1, revenueMinor: 1 }],
      competitors: [],
      signals: [],
    });
    expect(out.ok).toBe(false);
  });

  it("carries medicalLines through totals", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    (base.totals as Record<string, unknown>).medicalLines = 3;
    const out = sanitizeAggregationResult(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.totals.medicalLines).toBe(3);
  });

  it("keeps an explicit zero as zero (a measured month with no medical sales)", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    (base.totals as Record<string, unknown>).medicalLines = 0;
    const out = sanitizeAggregationResult(base);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.totals.medicalLines).toBe(0);
  });

  it("leaves medicalLines UNDEFINED for a pre-split payload (never measured is not zero)", () => {
    // A payload produced before the medical split has no medicalLines field.
    // Coercing that to 0 would assert the month had no medical sales, which is
    // a guess. It must stay absent so it persists as NULL.
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    delete (base.totals as Record<string, unknown>).medicalLines;
    const out = sanitizeAggregationResult(base);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.totals.medicalLines).toBeUndefined();
  });

  it("ignores a non-numeric medicalLines rather than trusting it", () => {
    const base = JSON.parse(JSON.stringify(validResult())) as Record<string, unknown>;
    (base.totals as Record<string, unknown>).medicalLines = "12";
    const out = sanitizeAggregationResult(base);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.totals.medicalLines).toBeUndefined();
  });
});
