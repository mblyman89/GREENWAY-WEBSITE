#!/usr/bin/env node
/**
 * scripts/discovery/measure-rollup-headroom.mjs
 *
 * MEASURE the CCRS monthly rollup payload budget. Do not guess it.
 *
 * OWNER REQUEST (verbatim, standing rule 1):
 *   "For the caps question, Please measure real headroom for best results. I
 *    will be upgrading to vercel paid plan so if the hobby plan is a limiting
 *    factor, just know it will be upgraded soon."
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser-side transformer crunches the ~1 GB monthly CCRS zip locally and
 * POSTs only a compact rollup JSON through a Server Action. Every cap in
 * aggregate.ts (TOP_SIGNALS_STATEWIDE, TOP_SUPPLIERS_STATEWIDE, ...) is applied
 * at crunch time, and the discarded detail is NEVER persisted. That makes each
 * cap a ONE-WAY DOOR: raising it later cannot recover a past month.
 *
 * So the caps must be set from a measured bytes-per-row cost against a real,
 * verified ceiling - never from a guess.
 *
 * THE REAL CEILING (verified 2026-08-15)
 * --------------------------------------
 *   Vercel Functions - Request body size:
 *     "The maximum payload size for the request body or the response body of a
 *      Vercel Function is 4.5 MB. If a Vercel Function receives a payload in
 *      excess of the limit it will return an error 413:
 *      FUNCTION_PAYLOAD_TOO_LARGE"
 *     https://vercel.com/docs/functions/limitations (Last updated July 1, 2026)
 *
 *   This figure is stated FLAT, with no Hobby/Pro/Enterprise split - unlike
 *   memory and duration on the same page, which ARE tiered. Upgrading to Pro
 *   therefore does NOT raise it.
 *
 *   next.config.ts sets experimental.serverActions.bodySizeLimit = "50mb".
 *   That raises Next's OWN framework check (default 1 MB), which is why large
 *   POS xlsx uploads work locally - but it cannot raise Vercel's platform
 *   limit. On production the binding constraint is 4.5 MB.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Builds rollup payloads with the REAL aggregator output shape at realistic
 * string widths, then measures the exact serialized byte cost of one row of
 * each kind. From that it derives, for any proposed set of caps, the projected
 * payload size and the remaining headroom under 4.5 MB.
 *
 * Usage:
 *   npx tsx scripts/discovery/measure-rollup-headroom.mjs
 */

const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4,718,592
/**
 * Safety margin. The Server Action body carries more than the rollup JSON
 * (action id, multipart framing, headers), and a single 413 loses the whole
 * month's crunch - the user must re-drag a ~1 GB zip. We size to 70% of the
 * hard limit so a bad month cannot silently breach it.
 */
const SAFETY_FRACTION = 0.7;
const BUDGET_BYTES = Math.floor(VERCEL_BODY_LIMIT_BYTES * SAFETY_FRACTION);

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");
const fmt = (n) => n.toLocaleString("en-US");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/**
 * Realistic field widths, taken from actual CCRS values seen in the repo's
 * fixtures and the seeded roster - NOT invented. Long-but-plausible strings are
 * used deliberately so the measurement is conservative (over- rather than
 * under-estimates).
 */
const SAMPLE = {
  productName: "Phat Panda | Grape Ape Premium Smalls 3.5g Indica Hybrid",
  brand: "Phat Panda",
  strain: "Grape Ape",
  inventoryType: "Usable Marijuana",
  licensee: "LYMAN'S MARIJUANA, INC. DBA GREENWAY MARIJUANA",
  license: "413541",
};

/** One statewide/brand/strain benchmark row. */
const benchRow = () => ({
  scope: "brand",
  sale_class: "retail",
  key: SAMPLE.brand,
  inventory_type: SAMPLE.inventoryType,
  units: 12345.678,
  revenue_minor: 987654321,
  avg_unit_price_minor: 1899,
  median_unit_price_minor: 1750,
  avg_price_per_gram_minor: 542,
  line_count: 45678,
});

/** One per-competitor stat row. */
const competitorRow = () => ({
  license_number: SAMPLE.license,
  tradename: SAMPLE.licensee,
  sale_class: "retail",
  units: 12345.678,
  revenue_minor: 987654321,
  line_count: 45678,
  avg_unit_price_minor: 1899,
  median_unit_price_minor: 1750,
});

/** One market signal (product mover / type mover). */
const signalRow = () => ({
  kind: "type_mover",
  product_name: SAMPLE.productName,
  brand: SAMPLE.brand,
  strain: SAMPLE.strain,
  inventory_type: SAMPLE.inventoryType,
  vendor_name: SAMPLE.licensee,
  vendor_license: SAMPLE.license,
  license_number: SAMPLE.license,
  units: 12345.678,
  revenue_minor: 987654321,
  line_count: 45678,
  avg_unit_price_minor: 1899,
});

/** One supplier stat row. */
const supplierRow = () => ({
  supplier_license: SAMPLE.license,
  supplier_name: SAMPLE.licensee,
  buyer_license: SAMPLE.license,
  units: 12345.678,
  spend_minor: 987654321,
  line_count: 45678,
  avg_unit_price_minor: 1899,
});

/**
 * A potency-enriched signal row - what capturing lab results adds per row.
 * Grounded in parse.ts mapLabResult, which yields {inventoryId, testName,
 * testValue}; rolled up per product this becomes a small set of numeric fields.
 */
const potencyFields = () => ({
  thc_pct: 24.86,
  cbd_pct: 0.12,
  total_cannabinoid_pct: 29.41,
  potency_sample_count: 137,
});

function measure(label, factory, counts) {
  const one = bytes(factory());
  console.log(`\n${label}`);
  console.log(`  bytes per row (serialized, worst-case widths): ${fmt(one)}`);
  for (const n of counts) {
    console.log(`    ${String(n).padStart(6)} rows -> ${kb(one * n).padStart(10)}`);
  }
  return one;
}

console.log("=".repeat(72));
console.log("CCRS MONTHLY ROLLUP - PAYLOAD HEADROOM MEASUREMENT");
console.log("=".repeat(72));
console.log(`\nHard ceiling (Vercel platform, all plans): ${mb(VERCEL_BODY_LIMIT_BYTES)}`);
console.log(`Safety fraction:                          ${SAFETY_FRACTION * 100}%`);
console.log(`Working budget:                            ${mb(BUDGET_BYTES)}`);

const perBench = measure("BENCHMARK rows (statewide / brand / strain)", benchRow, [500, 1000, 2500, 5000]);
const perComp = measure("COMPETITOR stat rows", competitorRow, [40, 100, 200, 400]);
const perSignal = measure("MARKET SIGNAL rows (movers)", signalRow, [100, 500, 1000, 4000]);
const perSupplier = measure("SUPPLIER stat rows", supplierRow, [100, 200, 500, 1000]);

const potencyDelta = bytes({ ...signalRow(), ...potencyFields() }) - perSignal;
console.log(`\nPOTENCY enrichment adds ${fmt(potencyDelta)} bytes per signal row`);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
function project(name, { bench, comps, signals, suppliers, potency = false, medicalSplit = false }) {
  // A medical/non-medical split multiplies the CLASS-scoped rows (benchmarks
  // and competitor stats are emitted per sale class), not the global ones.
  const classMult = medicalSplit ? 1.5 : 1;
  const total =
    bench * perBench * classMult +
    comps * perComp * classMult +
    signals * (perSignal + (potency ? potencyDelta : 0)) +
    suppliers * perSupplier;
  const pct = (total / BUDGET_BYTES) * 100;
  const hard = (total / VERCEL_BODY_LIMIT_BYTES) * 100;
  console.log(
    `  ${name.padEnd(38)} ${mb(total).padStart(9)}  ${pct.toFixed(1).padStart(6)}% of budget  ${hard.toFixed(1).padStart(6)}% of hard limit`,
  );
  return total;
}

console.log("\n" + "=".repeat(72));
console.log("SCENARIOS");
console.log("=".repeat(72));

console.log("\nToday's caps (aggregate.ts + market-rollups.ts guards):");
project("current: 500 bench/scope, 100 sig", {
  bench: 500 * 4,
  comps: 40,
  signals: 100 + 15 * 40,
  suppliers: 100,
});

console.log("\nOwner's approved scope (keep :884, +medical split, +potency):");
project("approved, current caps", {
  bench: 500 * 4,
  comps: 40,
  signals: 100 + 15 * 40,
  suppliers: 100,
  potency: true,
  medicalSplit: true,
});
project("approved, 2x signals+suppliers", {
  bench: 500 * 4,
  comps: 40,
  signals: 200 + 30 * 40,
  suppliers: 200,
  potency: true,
  medicalSplit: true,
});
project("approved, 4x signals+suppliers", {
  bench: 500 * 4,
  comps: 40,
  signals: 400 + 60 * 40,
  suppliers: 400,
  potency: true,
  medicalSplit: true,
});

console.log("\nAt the market-rollups.ts hard validator guards (absolute worst case):");
project("MAX_* guards, all maxed", {
  bench: 5000,
  comps: 200,
  signals: 4000,
  suppliers: 200,
  potency: true,
  medicalSplit: true,
});

console.log("\n" + "=".repeat(72));
console.log("HOW MANY ROWS FIT IN THE WORKING BUDGET (if spent on ONE kind)");
console.log("=".repeat(72));
console.log(`  benchmark rows:  ${fmt(Math.floor(BUDGET_BYTES / perBench))}`);
console.log(`  signal rows:     ${fmt(Math.floor(BUDGET_BYTES / (perSignal + potencyDelta)))}`);
console.log(`  supplier rows:   ${fmt(Math.floor(BUDGET_BYTES / perSupplier))}`);
console.log("");
