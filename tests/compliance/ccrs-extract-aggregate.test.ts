/**
 * tests/compliance/ccrs-extract-aggregate.test.ts
 *
 * S2 coverage for the CCRS monthly-extract aggregation engine (pure,
 * dependency-free). Verifies against the REAL extract semantics captured in
 * Task H:
 *   - UnitPrice is PER-UNIT cents; line revenue = qty × unit − discount.
 *   - Monthly files are DELTAS, so some sale details won't resolve to a
 *     Product — those must fold into "(unattributed)" and be counted honestly.
 *   - Greenway itself (413541) must NEVER appear in competitor outputs.
 *   - Bounded-memory price histograms with nearest-rank percentiles.
 */
import { describe, it, expect } from "vitest";

import {
  PriceHistogram,
  PRICE_CAP_MINOR,
  U53Map,
  extractBrand,
  CcrsAggregator,
  type AggregationResult,
} from "@/lib/discovery/ccrs-extract/aggregate";
import type {
  LicenseeRow,
  SaleHeaderRow,
  SaleDetailRow,
  ProductRow,
  InventoryRow,
  StrainRow,
} from "@/lib/discovery/ccrs-extract/parse";

// ---------------------------------------------------------------------------
// U53Map (typed-array id join map — the piece that makes 14M-row joins fit)
// ---------------------------------------------------------------------------

describe("U53Map", () => {
  it("sets and gets multi-lane integer values", () => {
    const m = new U53Map(2);
    m.set(42, 7, 9);
    m.set(0, 1, 2); // key 0 must be storable (offset encoding)
    expect(m.get(42, 0)).toBe(7);
    expect(m.get(42, 1)).toBe(9);
    expect(m.get(0, 0)).toBe(1);
    expect(m.get(0, 1)).toBe(2);
    expect(m.get(999)).toBeUndefined();
    expect(m.size).toBe(2);
  });

  it("overwrites existing keys without growing", () => {
    const m = new U53Map(1);
    m.set(5, 10);
    m.set(5, 20);
    expect(m.get(5)).toBe(20);
    expect(m.size).toBe(1);
  });

  it("survives growth well past the initial capacity (rehash correctness)", () => {
    const m = new U53Map(2, 64);
    const N = 10_000;
    for (let i = 0; i < N; i += 1) m.set(i * 3, i, i * 2);
    expect(m.size).toBe(N);
    for (let i = 0; i < N; i += 1) {
      expect(m.get(i * 3, 0)).toBe(i);
      expect(m.get(i * 3, 1)).toBe(i * 2);
    }
    expect(m.get(1)).toBeUndefined(); // never-set key between entries
  });

  it("ignores negative, fractional, and non-finite keys", () => {
    const m = new U53Map(1);
    m.set(-1, 5);
    m.set(1.5, 5);
    m.set(Number.NaN, 5);
    expect(m.size).toBe(0);
    expect(m.get(-1)).toBeUndefined();
  });

  it("reserve() pre-sizes without losing existing entries", () => {
    const m = new U53Map(1, 64);
    m.set(7, 70);
    m.reserve(1_000_000);
    expect(m.get(7)).toBe(70);
    m.set(8, 80);
    expect(m.get(8)).toBe(80);
  });

  it("handles surrogate-key magnitudes from the real extract (9-digit ids)", () => {
    const m = new U53Map(1);
    m.set(327733817, 736); // real May-2026 SaleHeaderId
    expect(m.get(327733817)).toBe(736);
  });
});

// ---------------------------------------------------------------------------
// PriceHistogram
// ---------------------------------------------------------------------------

describe("PriceHistogram", () => {
  it("returns null summary and percentiles when empty", () => {
    const h = new PriceHistogram();
    expect(h.count).toBe(0);
    expect(h.percentile(0.5)).toBeNull();
    expect(h.summary()).toBeNull();
  });

  it("handles a single value: all percentiles collapse to it", () => {
    const h = new PriceHistogram();
    h.add(1234);
    const s = h.summary();
    expect(s).toEqual({
      sampleSize: 1,
      minMinor: 1234,
      p25Minor: 1234,
      medianMinor: 1234,
      p75Minor: 1234,
      maxMinor: 1234,
      avgMinor: 1234,
    });
  });

  it("computes nearest-rank percentiles on a known set", () => {
    // Values 100..1000 step 100 (n=10). Nearest-rank: pXX = value at
    // ceil(p*n)-th smallest. p25 → rank 3 → 300; p50 → rank 5 → 500;
    // p75 → rank 8 → 800.
    const h = new PriceHistogram();
    for (let v = 100; v <= 1000; v += 100) h.add(v);
    expect(h.percentile(0.25)).toBe(300);
    expect(h.percentile(0.5)).toBe(500);
    expect(h.percentile(0.75)).toBe(800);
    expect(h.percentile(0)).toBe(100); // rank clamps to 1
    expect(h.percentile(1)).toBe(1000);
    const s = h.summary();
    expect(s?.minMinor).toBe(100);
    expect(s?.maxMinor).toBe(1000);
    expect(s?.avgMinor).toBe(550);
    expect(s?.sampleSize).toBe(10);
  });

  it("is insertion-order independent (bucketed, sorted at query time)", () => {
    const a = new PriceHistogram();
    const b = new PriceHistogram();
    const values = [500, 100, 300, 300, 900];
    for (const v of values) a.add(v);
    for (const v of [...values].reverse()) b.add(v);
    expect(a.percentile(0.5)).toBe(b.percentile(0.5));
    expect(a.summary()).toEqual(b.summary());
  });

  it("clamps prices at the cap and ignores negative/non-finite input", () => {
    const h = new PriceHistogram();
    h.add(PRICE_CAP_MINOR + 5_000_000); // absurd price clamps into top bucket
    h.add(-1); // ignored
    h.add(Number.NaN); // ignored
    h.add(Number.POSITIVE_INFINITY); // ignored
    expect(h.count).toBe(1);
    expect(h.percentile(0.5)).toBe(PRICE_CAP_MINOR);
    expect(h.summary()?.maxMinor).toBe(PRICE_CAP_MINOR);
  });

  it("rounds fractional cents on add and averages with rounding", () => {
    const h = new PriceHistogram();
    h.add(100.4); // → 100
    h.add(101); // → 101
    expect(h.count).toBe(2);
    // sum 201 / 2 = 100.5 → rounds to 101 (Math.round half-up)
    expect(h.summary()?.avgMinor).toBe(101);
  });
});

// ---------------------------------------------------------------------------
// extractBrand
// ---------------------------------------------------------------------------

describe("extractBrand", () => {
  it("extracts the prefix before ' - ' / ' | ' / ': ' separators", () => {
    expect(extractBrand("Fairwinds - Flow CBD Gel")).toBe("Fairwinds");
    expect(extractBrand("Phat Panda | Grape Ape 3.5g")).toBe("Phat Panda");
    expect(extractBrand("Dutchberry: Sativa Preroll")).toBe("Dutchberry");
  });

  it("returns null when there is no separator (never guesses)", () => {
    expect(extractBrand("Blue Dream 3.5g Flower")).toBeNull();
    expect(extractBrand(null)).toBeNull();
    expect(extractBrand("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CcrsAggregator — end-to-end over synthetic rows mirroring the real shape
// ---------------------------------------------------------------------------

const SELF = "413541"; // Greenway (LicenseeId 736 in the real May 2026 file)
const COMP = "415229"; // Pot Zone Port Orchard (real roster entry)

function licensee(
  licenseeId: string,
  licenseNumber: string | null,
  name: string,
  dba: string | null = null,
  city: string | null = null,
): LicenseeRow {
  return { licenseeId, licenseNumber, name, dba, status: "Active", city, county: null };
}

function product(
  productId: string,
  inventoryType: string | null,
  name: string | null,
  unitWeightGrams: number | null = null,
): ProductRow {
  return { productId, licenseeId: null, inventoryType, name, unitWeightGrams };
}

function inventory(inventoryId: string, productId: string | null, strainId: string | null = null): InventoryRow {
  return { inventoryId, licenseeId: null, productId, strainId };
}

function header(
  saleHeaderId: string,
  sellerLicenseeId: string | null,
  saleType: SaleHeaderRow["saleType"],
  saleDate: string | null,
  buyerLicenseeId: string | null = null,
): SaleHeaderRow {
  return { saleHeaderId, sellerLicenseeId, buyerLicenseeId, saleType, saleDate };
}

function detail(
  saleHeaderId: string | null,
  inventoryId: string | null,
  quantity: number | null,
  unitPriceMinor: number | null,
  discountMinor: number | null = 0,
  isDeleted: boolean | null = false,
): SaleDetailRow {
  return { saleHeaderId, inventoryId, quantity, unitPriceMinor, discountMinor, isDeleted };
}

/** Builds the standard fixture world and returns the finished result. */
function runFixture(): AggregationResult {
  const agg = new CcrsAggregator({
    selfLicenseNumber: SELF,
    trackedLicenseNumbers: [SELF, COMP], // self in list on purpose — must be excluded
  });

  // Reference tables (dependency order, like the transformer feeds them).
  agg.addLicensee(licensee("736", SELF, "LYMAN'S MARIJUANA L.L.C.", "GREENWAY MARIJUANA", "PORT ORCHARD"));
  agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC", "POT ZONE", "PORT ORCHARD"));
  agg.addLicensee(licensee("901", "999999", "SOMEWHERE ELSE LLC", null, "SPOKANE"));

  const strains: StrainRow[] = [{ strainId: "77", name: "Blue Dream" }];
  for (const s of strains) agg.addStrain(s);

  // Ids are numeric strings, exactly like the real extract's surrogate keys.
  agg.addProduct(product("5001", "Usable Marijuana", "Phat Panda | Grape Ape 3.5g", 3.5));
  agg.addProduct(product("5002", "Concentrate", "Dab Co - Live Resin 1g", 1));
  agg.addProduct(product("5003", "Usable Marijuana", "House Flower 7g", 7));

  agg.addInventory(inventory("9001", "5001", "77"));
  agg.addInventory(inventory("9002", "5002"));
  agg.addInventory(inventory("9003", "5003"));
  // 9009 deliberately ABSENT → unattributed path (delta-month reality).

  // Headers: self retail, competitor retail, unrelated retail, wholesale, other.
  const H_SELF = "327733901";
  const H_COMP = "327733902";
  const H_ELSE = "327733903";
  const H_WS = "327733904";
  const H_OTHER = "327733905";
  const H_MISSING = "327733999";
  agg.addSaleHeader(header(H_SELF, "736", "retail", "2026-05-02"));
  agg.addSaleHeader(header(H_COMP, "900", "retail", "2026-05-10"));
  agg.addSaleHeader(header(H_ELSE, "901", "medical", "2026-05-30"));
  // Wholesale: seller 901 (Somewhere Else) → buyer 900 (the tracked competitor).
  // S7: this is the sourcing edge — the competitor BOUGHT from 901 this month.
  agg.addSaleHeader(header(H_WS, "901", "wholesale", "2026-05-01", "900"));
  agg.addSaleHeader(header(H_OTHER, "901", "other", "2026-05-15"));

  // Details.
  // Self retail: 2 × $30.00 with $5.00 line discount → line $55.00.
  agg.addSaleDetail(detail(H_SELF, "9001", 2, 3000, 500));
  // Competitor retail: 3 × $25.00 → $75.00 (same product 5001).
  agg.addSaleDetail(detail(H_COMP, "9001", 3, 2500));
  // Competitor retail: 1 × $40.00 concentrate → $40.00.
  agg.addSaleDetail(detail(H_COMP, "9002", 1, 4000));
  // Competitor retail: unattributed inventory 1 × $10.00.
  agg.addSaleDetail(detail(H_COMP, "9009", 1, 1000));
  // Unrelated store medical (counts as retail class, not a competitor): 1 × $20.00.
  agg.addSaleDetail(detail(H_ELSE, "9003", 1, 2000));
  // Wholesale: 50 × $2.20 → $110.00 (real wholesale pattern from May file).
  agg.addSaleDetail(detail(H_WS, "9001", 50, 220));
  // Deleted line — must be skipped everywhere.
  agg.addSaleDetail(detail(H_COMP, "9001", 5, 9900, 0, true));
  // Header of type "other" — line must be dropped (header not retained).
  agg.addSaleDetail(detail(H_OTHER, "9001", 1, 1500));
  // Orphan header reference — dropped.
  agg.addSaleDetail(detail(H_MISSING, "9001", 1, 1500));
  // Null unit price — dropped.
  agg.addSaleDetail(detail(H_COMP, "9001", 1, null));

  return agg.result();
}

describe("CcrsAggregator", () => {
  const result = runFixture();

  it("tracks totals honestly, including the attribution join rate", () => {
    expect(result.totals.licenseeRows).toBe(3);
    expect(result.totals.productRows).toBe(3);
    expect(result.totals.inventoryRows).toBe(3);
    expect(result.totals.strainRows).toBe(1);
    expect(result.totals.saleHeaderRows).toBe(5);
    expect(result.totals.saleDetailRows).toBe(10); // every fed row counted
    // Classified lines: self(1) + comp(3) + medical(1) = 5 retail; 1 wholesale.
    expect(result.totals.retailLines).toBe(5);
    expect(result.totals.wholesaleLines).toBe(1);
    // The i9 line fails product attribution → 4 of 5 retail lines attributed.
    expect(result.totals.attributedRetailLines).toBe(4);
  });

  it("derives the period from sale-header dates (min/max)", () => {
    expect(result.periodStart).toBe("2026-05-01");
    expect(result.periodEnd).toBe("2026-05-30");
  });

  it("computes the retail 'overall' statewide benchmark with per-unit semantics", () => {
    const overall = result.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
    expect(overall).toBeDefined();
    // Unit prices seen at retail: 3000, 2500, 4000, 1000, 2000.
    expect(overall?.unitPrice?.sampleSize).toBe(5);
    expect(overall?.unitPrice?.minMinor).toBe(1000);
    expect(overall?.unitPrice?.maxMinor).toBe(4000);
    expect(overall?.unitPrice?.medianMinor).toBe(2500); // nearest-rank on 5 samples
    // Units 2+3+1+1+1 = 8; revenue 5500+7500+4000+1000+2000 = 20000.
    expect(overall?.units).toBe(8);
    expect(overall?.revenueMinor).toBe(20_000);
  });

  it("computes the wholesale 'overall' benchmark separately (qty-50 line)", () => {
    const ws = result.statewide.find((b) => b.scope === "overall" && b.saleClass === "wholesale");
    expect(ws?.unitPrice?.sampleSize).toBe(1);
    expect(ws?.unitPrice?.medianMinor).toBe(220); // PER-UNIT, not the $110 line
    expect(ws?.units).toBe(50);
    expect(ws?.revenueMinor).toBe(11_000);
  });

  it("buckets unresolvable joins into '(unattributed)' instead of guessing", () => {
    const un = result.statewide.find(
      (b) => b.scope === "type" && b.scopeKey === "(unattributed)" && b.saleClass === "retail",
    );
    expect(un?.units).toBe(1);
    expect(un?.revenueMinor).toBe(1000);
    // No weight known → no price-per-gram samples for the unattributed bucket.
    expect(un?.pricePerGram).toBeNull();
  });

  it("produces type/brand/strain scopes with price-per-gram from unit weight", () => {
    const usable = result.statewide.find(
      (b) => b.scope === "type" && b.scopeKey === "Usable Marijuana" && b.saleClass === "retail",
    );
    // p1 retail lines (3000, 2500) + p3 line (2000): units 2+3+1=6, rev 5500+7500+2000=15000.
    expect(usable?.units).toBe(6);
    expect(usable?.revenueMinor).toBe(15_000);
    // $/g: 3000/3.5=857, 2500/3.5=714, 2000/7=286 (rounded cents).
    expect(usable?.pricePerGram?.sampleSize).toBe(3);
    expect(usable?.pricePerGram?.minMinor).toBe(286);
    expect(usable?.pricePerGram?.maxMinor).toBe(857);

    const brand = result.statewide.find(
      (b) => b.scope === "brand" && b.scopeKey === "Phat Panda" && b.saleClass === "retail",
    );
    expect(brand?.units).toBe(5); // 2 self + 3 comp
    expect(brand?.revenueMinor).toBe(13_000);

    const strain = result.statewide.find(
      (b) => b.scope === "strain" && b.scopeKey === "Blue Dream" && b.saleClass === "retail",
    );
    expect(strain?.units).toBe(5);
    expect(strain?.revenueMinor).toBe(13_000);
  });

  it("sorts statewide benchmarks deterministically (class, scope, revenue desc)", () => {
    const keys = result.statewide.map((b) => `${b.saleClass}/${b.scope}/${b.revenueMinor}`);
    const sorted = [...result.statewide]
      .sort(
        (a, b) =>
          a.saleClass.localeCompare(b.saleClass) ||
          a.scope.localeCompare(b.scope) ||
          b.revenueMinor - a.revenueMinor,
      )
      .map((b) => `${b.saleClass}/${b.scope}/${b.revenueMinor}`);
    expect(keys).toEqual(sorted);
  });

  it("builds competitor stats ONLY for tracked licenses and NEVER for self", () => {
    expect(result.competitors).toHaveLength(1);
    const c = result.competitors[0];
    expect(c.licenseNumber).toBe(COMP);
    expect(c.licenseeId).toBe("900");
    expect(c.name).toBe("POT ZONE PO LLC");
    expect(c.dba).toBe("POT ZONE");
    expect(c.city).toBe("PORT ORCHARD");
    // Self (413541) sold retail in the fixture but must not appear.
    expect(result.competitors.some((x) => x.licenseNumber === SELF)).toBe(false);
  });

  it("aggregates competitor retail correctly (units, revenue, types, top products)", () => {
    const c = result.competitors[0];
    // Lines: 3×2500 (p1), 1×4000 (p2), 1×1000 (i9 unattributed). Deleted + null-price skipped.
    expect(c.retail.lineCount).toBe(3);
    expect(c.retail.units).toBe(5);
    expect(c.retail.revenueMinor).toBe(12_500);
    expect(c.retail.unitPrice?.sampleSize).toBe(3);
    expect(c.retail.unitPrice?.minMinor).toBe(1000);
    expect(c.retail.unitPrice?.maxMinor).toBe(4000);

    // byType sorted by revenue desc: Usable 7500, Concentrate 4000, (unattributed) 1000.
    expect(c.retail.byType.map((t) => t.inventoryType)).toEqual([
      "Usable Marijuana",
      "Concentrate",
      "(unattributed)",
    ]);
    expect(c.retail.byType[0]).toEqual({ inventoryType: "Usable Marijuana", units: 3, revenueMinor: 7500 });

    // topProducts: named products only, revenue desc.
    expect(c.retail.topProducts.map((p) => p.productName)).toEqual([
      "Phat Panda | Grape Ape 3.5g",
      "Dab Co - Live Resin 1g",
    ]);
    expect(c.retail.topProducts[0].units).toBe(3);
    expect(c.retail.topProducts[0].revenueMinor).toBe(7500);
    expect(c.retail.topProducts[0].medianUnitPriceMinor).toBe(2500);
  });

  it("attributes wholesale purchases to the buying competitor's suppliers (S7)", () => {
    const c = result.competitors[0];
    // The H_WS line: 50 × $2.20 = $110.00 bought by COMP from licensee 901.
    expect(c.wholesale.lineCount).toBe(1);
    expect(c.wholesale.spendMinor).toBe(11_000);
    expect(c.wholesale.topSuppliers).toHaveLength(1);
    const sup = c.wholesale.topSuppliers[0];
    expect(sup.licenseeId).toBe("901");
    expect(sup.licenseNumber).toBe("999999");
    expect(sup.name).toBe("SOMEWHERE ELSE LLC");
    expect(sup.dba).toBeNull(); // real null in the fixture — never guessed
    expect(sup.lineCount).toBe(1);
    expect(sup.spendMinor).toBe(11_000);
  });

  it("emits statewide_mover signals for NAMED products only, with p25/median bands", () => {
    const movers = result.signals.filter((s) => s.kind === "statewide_mover");
    // p1, p2, p3 sold at retail; the unattributed i9 line has no product name.
    expect(movers.map((m) => m.productName).sort()).toEqual([
      "Dab Co - Live Resin 1g",
      "House Flower 7g",
      "Phat Panda | Grape Ape 3.5g",
    ]);
    const grape = movers.find((m) => m.productName === "Phat Panda | Grape Ape 3.5g");
    expect(grape?.units).toBe(5);
    expect(grape?.revenueMinor).toBe(13_000);
    expect(grape?.brand).toBe("Phat Panda");
    expect(grape?.strainName).toBe("Blue Dream");
    // Prices 3000 (self) + 2500 (comp): nearest-rank p25 = 2500, median = 2500.
    expect(grape?.p25UnitPriceMinor).toBe(2500);
    expect(grape?.medianUnitPriceMinor).toBe(2500);
    expect(grape?.licenseNumber).toBeNull();
    // Movers are revenue-desc.
    const revs = movers.map((m) => m.revenueMinor);
    expect(revs).toEqual([...revs].sort((a, b) => b - a));
  });

  it("emits competitor_mover signals tagged with the competitor's license", () => {
    const comps = result.signals.filter((s) => s.kind === "competitor_mover");
    expect(comps).toHaveLength(2);
    for (const s of comps) expect(s.licenseNumber).toBe(COMP);
    const top = comps[0];
    expect(top.productName).toBe("Phat Panda | Grape Ape 3.5g");
    expect(top.units).toBe(3);
    expect(top.revenueMinor).toBe(7500);
    expect(top.medianUnitPriceMinor).toBe(2500);
    expect(top.p25UnitPriceMinor).toBe(2500);
  });

  it("treats missing/zero quantity as 1 unit (defensive, never negative)", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [] });
    agg.addSaleHeader(header("100", "1", "retail", "2026-05-05"));
    agg.addSaleDetail(detail("100", null, null, 1000));
    agg.addSaleDetail(detail("100", null, 0, 2000));
    const r = agg.result();
    const overall = r.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
    expect(overall?.units).toBe(2);
    expect(overall?.revenueMinor).toBe(3000);
  });

  it("clamps line revenue at zero when discount exceeds the line total", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [] });
    agg.addSaleHeader(header("100", "1", "retail", "2026-05-05"));
    agg.addSaleDetail(detail("100", null, 1, 1000, 5000)); // $50 discount on a $10 line
    const r = agg.result();
    const overall = r.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
    expect(overall?.revenueMinor).toBe(0);
    expect(overall?.units).toBe(1);
  });

  it("returns an empty-but-valid result when fed nothing", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    const r = agg.result();
    expect(r.periodStart).toBeNull();
    expect(r.periodEnd).toBeNull();
    expect(r.statewide).toEqual([]);
    expect(r.competitors).toEqual([]);
    expect(r.signals).toEqual([]);
    expect(r.totals.saleDetailRows).toBe(0);
  });

  it("caps competitor topProducts at 25 and per-competitor signals at 15", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addSaleHeader(header("100", "900", "retail", "2026-05-05"));
    for (let i = 0; i < 40; i += 1) {
      agg.addProduct(product(`${5000 + i}`, "Usable Marijuana", `Product ${String(i).padStart(2, "0")}`));
      agg.addInventory(inventory(`${9000 + i}`, `${5000 + i}`));
      // Distinct revenue per product so ordering is deterministic.
      agg.addSaleDetail(detail("100", `${9000 + i}`, 1, 1000 + i * 10));
    }
    const r = agg.result();
    expect(r.competitors[0].retail.topProducts).toHaveLength(25);
    // Highest-revenue product first.
    expect(r.competitors[0].retail.topProducts[0].productName).toBe("Product 39");
    expect(r.signals.filter((s) => s.kind === "competitor_mover")).toHaveLength(15);
  });

  it("caps statewide movers at 100", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [] });
    agg.addSaleHeader(header("100", "1", "retail", "2026-05-05"));
    for (let i = 0; i < 120; i += 1) {
      agg.addProduct(product(`${5000 + i}`, "Usable Marijuana", `Product ${i}`));
      agg.addInventory(inventory(`${9000 + i}`, `${5000 + i}`));
      agg.addSaleDetail(detail("100", `${9000 + i}`, 1, 1000 + i));
    }
    const r = agg.result();
    expect(r.signals.filter((s) => s.kind === "statewide_mover")).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// S7 — competitor wholesale sourcing (buyer-side attribution)
// ---------------------------------------------------------------------------

describe("CcrsAggregator wholesale sourcing (S7)", () => {
  it("creates a competitor entry for wholesale-only activity (no retail lines)", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC", "POT ZONE", "PORT ORCHARD"));
    agg.addLicensee(licensee("901", "999999", "SOMEWHERE ELSE LLC"));
    // Only a wholesale purchase — the competitor sold nothing at retail.
    agg.addSaleHeader(header("100", "901", "wholesale", "2026-05-03", "900"));
    agg.addSaleDetail(detail("100", null, 10, 500)); // 10 × $5.00 = $50.00
    const r = agg.result();
    expect(r.competitors).toHaveLength(1);
    const c = r.competitors[0];
    expect(c.licenseNumber).toBe(COMP);
    expect(c.retail.lineCount).toBe(0);
    expect(c.retail.revenueMinor).toBe(0);
    expect(c.wholesale.lineCount).toBe(1);
    expect(c.wholesale.spendMinor).toBe(5000);
    expect(c.wholesale.topSuppliers[0].licenseeId).toBe("901");
    expect(c.wholesale.topSuppliers[0].name).toBe("SOMEWHERE ELSE LLC");
  });

  it("NEVER attributes wholesale purchases to self (self excluded as buyer)", () => {
    const agg = new CcrsAggregator({
      selfLicenseNumber: SELF,
      trackedLicenseNumbers: [SELF, COMP], // self in list on purpose
    });
    agg.addLicensee(licensee("736", SELF, "LYMAN'S MARIJUANA L.L.C.", "GREENWAY MARIJUANA"));
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addLicensee(licensee("901", "999999", "SOMEWHERE ELSE LLC"));
    // Greenway itself buys wholesale — must NOT create a competitor entry.
    agg.addSaleHeader(header("100", "901", "wholesale", "2026-05-03", "736"));
    agg.addSaleDetail(detail("100", null, 10, 500));
    const r = agg.result();
    expect(r.competitors).toHaveLength(0);
    // The line still counts in the honest statewide wholesale totals.
    expect(r.totals.wholesaleLines).toBe(1);
  });

  it("ignores wholesale headers whose buyer is not tracked", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addLicensee(licensee("901", "999999", "SOMEWHERE ELSE LLC"));
    agg.addLicensee(licensee("902", "888888", "ANOTHER STORE LLC"));
    // 901 sells to 902 — neither buyer nor seller is on the roster.
    agg.addSaleHeader(header("100", "901", "wholesale", "2026-05-03", "902"));
    agg.addSaleDetail(detail("100", null, 10, 500));
    const r = agg.result();
    expect(r.competitors).toHaveLength(0);
    expect(r.totals.wholesaleLines).toBe(1);
  });

  it("accumulates spend per supplier across headers and lines (qty × price − discount)", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addLicensee(licensee("901", "999999", "SUPPLIER A LLC"));
    agg.addLicensee(licensee("902", "888888", "SUPPLIER B LLC", "B FARMS"));
    agg.addSaleHeader(header("100", "901", "wholesale", "2026-05-03", "900"));
    agg.addSaleHeader(header("101", "901", "wholesale", "2026-05-10", "900"));
    agg.addSaleHeader(header("102", "902", "wholesale", "2026-05-12", "900"));
    agg.addSaleDetail(detail("100", null, 10, 500)); // A: $50.00
    agg.addSaleDetail(detail("100", null, 4, 250, 100)); // A: $10.00 − $1.00 = $9.00
    agg.addSaleDetail(detail("101", null, 2, 1000)); // A: $20.00
    agg.addSaleDetail(detail("102", null, 1, 300, 9999)); // B: clamps to $0.00
    const r = agg.result();
    const c = r.competitors[0];
    expect(c.wholesale.lineCount).toBe(4);
    expect(c.wholesale.spendMinor).toBe(7900); // 5000 + 900 + 2000 + 0
    // Suppliers sorted by spend desc; B kept even at $0 spend (real lines).
    expect(c.wholesale.topSuppliers.map((s) => s.licenseeId)).toEqual(["901", "902"]);
    const a = c.wholesale.topSuppliers[0];
    expect(a.spendMinor).toBe(7900); // all of it — B's line clamped to $0
    expect(a.lineCount).toBe(3);
    const b = c.wholesale.topSuppliers[1];
    expect(b.spendMinor).toBe(0);
    expect(b.lineCount).toBe(1);
    expect(b.dba).toBe("B FARMS");
  });

  it("caps topSuppliers at 10, keeping the highest-spend suppliers", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    for (let i = 0; i < 14; i += 1) {
      agg.addLicensee(licensee(`${1000 + i}`, `${700000 + i}`, `SUPPLIER ${String(i).padStart(2, "0")} LLC`));
      agg.addSaleHeader(header(`${200 + i}`, `${1000 + i}`, "wholesale", "2026-05-05", "900"));
      // Distinct spend per supplier so ordering is deterministic (i=13 highest).
      agg.addSaleDetail(detail(`${200 + i}`, null, 1, 1000 + i * 100));
    }
    const r = agg.result();
    const c = r.competitors[0];
    expect(c.wholesale.lineCount).toBe(14);
    expect(c.wholesale.topSuppliers).toHaveLength(10);
    expect(c.wholesale.topSuppliers[0].name).toBe("SUPPLIER 13 LLC");
    expect(c.wholesale.topSuppliers[0].spendMinor).toBe(2300);
    // The 4 lowest-spend suppliers (i=0..3) fell off; the total keeps them.
    expect(c.wholesale.topSuppliers.some((s) => s.name === "SUPPLIER 00 LLC")).toBe(false);
    expect(c.wholesale.spendMinor).toBe(14 * 1000 + 100 * ((13 * 14) / 2));
  });

  it("keeps supplier identity honest when the licensee row is missing (nulls, never guessed)", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    // Seller 903 has NO licensee row in this drop.
    agg.addSaleHeader(header("100", "903", "wholesale", "2026-05-03", "900"));
    agg.addSaleDetail(detail("100", null, 1, 700));
    const r = agg.result();
    const sup = r.competitors[0].wholesale.topSuppliers[0];
    expect(sup.licenseeId).toBe("903");
    expect(sup.licenseNumber).toBeNull();
    expect(sup.name).toBeNull();
    expect(sup.dba).toBeNull();
    expect(sup.spendMinor).toBe(700);
  });

  it("does not credit retail buyers: sourcing only flows through wholesale headers", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addLicensee(licensee("901", "999999", "SOMEWHERE ELSE LLC"));
    // A retail header that (oddly) carries the competitor as buyer — ignored.
    agg.addSaleHeader(header("100", "901", "retail", "2026-05-03", "900"));
    agg.addSaleDetail(detail("100", null, 1, 700));
    const r = agg.result();
    expect(r.competitors).toHaveLength(0);
    expect(r.totals.retailLines).toBe(1);
  });

  it("round-trips a 9-digit supplier licensee id through the packed header (real magnitudes)", () => {
    const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: [COMP] });
    agg.addLicensee(licensee("900", COMP, "POT ZONE PO LLC"));
    agg.addLicensee(licensee("123456789", "777777", "BIG ID FARMS LLC"));
    agg.addSaleHeader(header("327733904", "123456789", "wholesale", "2026-05-03", "900"));
    agg.addSaleDetail(detail("327733904", null, 3, 220));
    const r = agg.result();
    const sup = r.competitors[0].wholesale.topSuppliers[0];
    expect(sup.licenseeId).toBe("123456789");
    expect(sup.name).toBe("BIG ID FARMS LLC");
    expect(sup.spendMinor).toBe(660);
  });
});
