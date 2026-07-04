/**
 * scripts/discovery/test_discovery_pure.ts
 *
 * Self-contained unit tests for the PURE Discovery helpers (no DB, no network).
 * The repo has no unit-test runner wired up (only Playwright e2e), so this runs
 * with the already-present `tsx`:
 *
 *   npx tsx scripts/discovery/test_discovery_pure.ts
 *
 * Exits non-zero on the first failed assertion. Covers:
 *   - reconcile: normalizeLicense / normalizeName / dedupe keys / matchVendorLead
 *   - import: detectDelimiter / parseDelimited / dollarsToMinor / parse*Csv
 *
 * STANDING RULE (verify by running): these assert the behaviors the UI relies on.
 */
import {
  normalizeLicense,
  normalizeName,
  vendorLeadDedupeKey,
  productLeadDedupeKey,
  matchVendorLead,
  type VendorMatchCandidate,
} from "../../src/lib/discovery/reconcile";
import {
  detectDelimiter,
  parseDelimited,
  dollarsToMinor,
  parseVendorLeadsCsv,
  parseProductLeadsCsv,
} from "../../src/lib/discovery/import";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`\u2717 FAIL: ${msg}`);
    process.exit(1);
  }
  passed += 1;
}
function eq<T>(a: T, b: T, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ---------------------------------------------------------------------------
// reconcile: normalization
// ---------------------------------------------------------------------------
eq(normalizeLicense("41-2345"), "412345", "normalizeLicense strips separators");
eq(normalizeLicense("  ab12cd  "), "AB12CD", "normalizeLicense uppercases + trims");
eq(normalizeLicense(null), "", "normalizeLicense null -> empty");

eq(normalizeName("Evergreen Farms LLC"), "evergreen", "normalizeName drops suffixes (farms, llc)");
eq(normalizeName("Cascade Extracts, Inc."), "cascade extracts", "normalizeName drops inc + punctuation");
eq(normalizeName("Green & Gold Co."), "green and gold", "normalizeName expands & and drops co");

// ---------------------------------------------------------------------------
// reconcile: dedupe keys
// ---------------------------------------------------------------------------
eq(
  vendorLeadDedupeKey({ display_name: "Evergreen Farms", license_number: "41-2345" }),
  "lic:412345",
  "vendorLeadDedupeKey prefers license",
);
eq(
  vendorLeadDedupeKey({ display_name: "Evergreen Farms LLC" }),
  "name:evergreen",
  "vendorLeadDedupeKey falls back to name slug",
);
eq(vendorLeadDedupeKey({}), "", "vendorLeadDedupeKey empty when nothing stable");

eq(
  productLeadDedupeKey({ brand: "Evergreen", product_name: "Blue Dream", pack_size: "3.5g" }),
  "prod:evergreen|blue-dream|3-5g",
  "productLeadDedupeKey combines brand|name|pack",
);

// ---------------------------------------------------------------------------
// reconcile: matching
// ---------------------------------------------------------------------------
const vendors: VendorMatchCandidate[] = [
  { id: "v1", display_name: "Evergreen Farms", legal_name: "Evergreen Farms LLC", license_number: "412345" },
  { id: "v2", display_name: "Cascade Extracts", legal_name: "Cascade Extracts Inc", license_number: "987654" },
];

eq(
  matchVendorLead({ display_name: "Anything", license_number: "41-2345" }, vendors),
  { matchedVendorId: "v1", matchState: "existing" },
  "matchVendorLead: license equality => existing",
);
eq(
  matchVendorLead({ display_name: "Evergreen Farms LLC" }, vendors),
  { matchedVendorId: "v1", matchState: "possible" },
  "matchVendorLead: name equality (no license) => possible",
);
eq(
  matchVendorLead({ display_name: "Brand New Grower", license_number: "555000" }, vendors),
  { matchedVendorId: null, matchState: "unmatched" },
  "matchVendorLead: no match => unmatched",
);
// license mismatch but name match should still be possible (never auto-existing on name)
eq(
  matchVendorLead({ display_name: "Cascade Extracts", license_number: "000000" }, vendors),
  { matchedVendorId: "v2", matchState: "possible" },
  "matchVendorLead: unknown license + name match => possible (not existing)",
);

// ---------------------------------------------------------------------------
// import: delimiter + parsing
// ---------------------------------------------------------------------------
eq(detectDelimiter("a,b,c\n1,2,3"), ",", "detectDelimiter comma");
eq(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t", "detectDelimiter tab");
eq(detectDelimiter("a;b;c"), ";", "detectDelimiter semicolon");

eq(
  parseDelimited('name,note\n"Acme, LLC","says ""hi"""\n', ","),
  [["name", "note"], ["Acme, LLC", 'says "hi"']],
  "parseDelimited handles quoted comma + escaped quotes",
);
eq(
  parseDelimited("a,b\n1,2\n\n\n", ","),
  [["a", "b"], ["1", "2"]],
  "parseDelimited drops empty trailing rows",
);

eq(dollarsToMinor("$12.50"), 1250, "dollarsToMinor strips $");
eq(dollarsToMinor("1,234.00"), 123400, "dollarsToMinor strips commas");
eq(dollarsToMinor(""), null, "dollarsToMinor empty -> null");
eq(dollarsToMinor("-5"), 500, "dollarsToMinor strips sign then parses magnitude");

// ---------------------------------------------------------------------------
// import: parse vendor CSV
// ---------------------------------------------------------------------------
const vcsv = `Vendor Name,License,City,Priority
Evergreen Farms,41-2345,Olympia,high
,999,NoName,low
Cascade Extracts,987654,Seattle,`;
const vres = parseVendorLeadsCsv(vcsv);
eq(vres.rows.length, 2, "parseVendorLeadsCsv keeps 2 valid rows");
eq(vres.skipped.length, 1, "parseVendorLeadsCsv skips the no-name row");
eq(vres.rows[0].displayName, "Evergreen Farms", "parseVendorLeadsCsv maps 'Vendor Name'");
eq(vres.rows[0].licenseNumber, "41-2345", "parseVendorLeadsCsv maps 'License'");
eq(vres.rows[0].priority, "high", "parseVendorLeadsCsv maps priority");
eq(vres.rows[1].priority, "med", "parseVendorLeadsCsv defaults blank priority to med");
assert(vres.recognized.includes("display_name"), "parseVendorLeadsCsv recognizes display_name");

// ---------------------------------------------------------------------------
// import: parse product CSV (tab-delimited, dollar costs, unknown col)
// ---------------------------------------------------------------------------
const pcsv = `product\tbrand\tcategory\tcost\tretail\tvendor\tmystery
Blue Dream 3.5g\tEvergreen\tflower\t$12.00\t$25.00\tEvergreen Farms\tignore-me
\tNoName\tflower\t1\t2\tX\tignore`;
const pres = parseProductLeadsCsv(pcsv);
eq(pres.rows.length, 1, "parseProductLeadsCsv keeps 1 valid row (skips no-name)");
eq(pres.skipped.length, 1, "parseProductLeadsCsv skips the no-product-name row");
eq(pres.rows[0].estUnitCostMinor, 1200, "parseProductLeadsCsv cost -> minor units");
eq(pres.rows[0].estRetailMinor, 2500, "parseProductLeadsCsv retail -> minor units");
eq(pres.rows[0].vendorName, "Evergreen Farms", "parseProductLeadsCsv maps vendor name");
assert(pres.unrecognized.includes("mystery"), "parseProductLeadsCsv reports unrecognized column");

console.log(`\u2713 All ${passed} discovery pure-function assertions passed.`);
