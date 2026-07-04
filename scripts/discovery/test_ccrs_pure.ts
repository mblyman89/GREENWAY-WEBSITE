/**
 * scripts/discovery/test_ccrs_pure.ts
 *
 * Self-contained unit tests for the PURE CCRS parser/normalizer (no DB, no
 * network). Run with the already-present `tsx`:
 *
 *   npx tsx scripts/discovery/test_ccrs_pure.ts
 *
 * Covers: header detection (with + without the 3-line preamble), file-kind
 * detection by column signature, row→record mapping, $→minor, date parsing,
 * SaleType normalization, brand extraction, price-per-gram, and the benchmark
 * aggregation helpers (percentile/summarize).
 *
 * STANDING RULE (verify by running): asserts the behaviors the ingest +
 * benchmark layers rely on. Exits non-zero on first failure.
 */
import {
  normHeader,
  findHeaderRowIndex,
  detectFileKind,
  toNum,
  moneyToMinor,
  toIsoDate,
  normalizeSaleType,
  extractBrand,
  pricePerGramMinor,
  parseCcrsFile,
} from "../../src/lib/discovery/ccrs";
import { percentile, summarizeMinor } from "../../src/lib/discovery/benchmarks-core";

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
// header + value helpers
// ---------------------------------------------------------------------------
eq(normHeader("Unit Weight (Grams)"), "unitweightgrams", "normHeader strips non-alnum");
eq(toNum("$1,234.50"), 1234.5, "toNum strips $ and commas");
eq(toNum(""), null, "toNum blank -> null");
eq(toNum("abc"), null, "toNum non-numeric -> null");
eq(moneyToMinor("12.00"), 1200, "moneyToMinor dollars -> cents");
eq(moneyToMinor("$3.5"), 350, "moneyToMinor handles $ + single decimal");
eq(moneyToMinor(""), null, "moneyToMinor blank -> null");
eq(toIsoDate("03/09/2025"), "2025-03-09", "toIsoDate MM/DD/YYYY");
eq(toIsoDate("2025-03-09"), "2025-03-09", "toIsoDate passthrough ISO");
eq(toIsoDate("not a date"), null, "toIsoDate junk -> null");
eq(normalizeSaleType("RecreationalRetail"), "retail", "saleType retail");
eq(normalizeSaleType("Wholesale"), "wholesale", "saleType wholesale");
eq(normalizeSaleType("RecreationalMedical"), "medical", "saleType medical");
eq(normalizeSaleType("weird"), "other", "saleType unknown -> other");
eq(extractBrand("Fairwinds - Companion Tincture"), "Fairwinds", "extractBrand splits on dash");
eq(extractBrand("Blue Dream 3.5g"), null, "extractBrand no separator -> null (never guess)");
eq(pricePerGramMinor(700, 3.5), 200, "pricePerGram 7.00/3.5g = 2.00");
eq(pricePerGramMinor(700, 0), null, "pricePerGram zero weight -> null");
eq(pricePerGramMinor(null, 3.5), null, "pricePerGram null price -> null");

// ---------------------------------------------------------------------------
// header row detection (preamble vs not)
// ---------------------------------------------------------------------------
eq(findHeaderRowIndex([["SubmittedBy"], ["SubmittedDate"], ["NumberRecords"], ["LicenseNumber"]]), 3, "detect preamble -> header row 3");
eq(findHeaderRowIndex([["LicenseNumber", "SaleType"]]), 0, "no preamble -> header row 0");

// ---------------------------------------------------------------------------
// file-kind detection by signature
// ---------------------------------------------------------------------------
eq(
  detectFileKind(["LicenseNumber", "SoldToLicenseNumber", "SaleType", "SaleDate", "Quantity", "UnitPrice"]),
  "sale",
  "detect Sale file",
);
eq(
  detectFileKind(["LicenseNumber", "InventoryCategory", "InventoryType", "Name", "Description", "ExternalIdentifier"]),
  "product",
  "detect Product file",
);
eq(detectFileKind(["Strain", "StrainType", "CreatedBy"]), "strain", "detect Strain file");
eq(detectFileKind(["Foo", "Bar"]), "unknown", "unknown header -> unknown (never guess)");

// ---------------------------------------------------------------------------
// full parse — Sale WITH preamble (official template shape)
// ---------------------------------------------------------------------------
const saleWithPreamble = [
  "SubmittedBy,,,,,,,,,,,,,,,,,",
  "SubmittedDate,,,,,,,,,,,,,,,,,",
  "NumberRecords,,,,,,,,,,,,,,,,,",
  "LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice,Discount,SalesTax,OtherTax,SaleExternalIdentifier,SaleDetailExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
  "412345,555555,INV-1,,Wholesale,03/09/2025,10,7.00,0,0,0,SALE-1,SD-1,me,03/09/2025,,,Insert",
  "412345,,INV-2,,RecreationalRetail,03/10/2025,1,25.00,2.00,3.05,0,SALE-2,SD-2,me,03/10/2025,,,Insert",
].join("\n");
const saleParsed = parseCcrsFile(saleWithPreamble);
eq(saleParsed.kind, "sale", "parse Sale (preamble) kind");
eq(saleParsed.records.length, 2, "parse Sale (preamble) 2 rows");
if (saleParsed.kind === "sale") {
  eq(saleParsed.records[0].sale_type, "wholesale", "sale row0 wholesale");
  eq(saleParsed.records[0].seller_license, "412345", "sale row0 seller");
  eq(saleParsed.records[0].buyer_license, "555555", "sale row0 buyer");
  eq(saleParsed.records[0].unit_price_minor, 700, "sale row0 unit price minor");
  eq(saleParsed.records[0].sale_date, "2025-03-09", "sale row0 date");
  eq(saleParsed.records[1].sale_type, "retail", "sale row1 retail");
  eq(saleParsed.records[1].sales_tax_minor, 305, "sale row1 sales tax minor");
}

// ---------------------------------------------------------------------------
// full parse — Product WITHOUT preamble (aggregated extract shape)
// ---------------------------------------------------------------------------
const productNoPreamble = [
  "LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
  "412345,Flower Lot,Usable Marijuana,Fairwinds - Blue Dream,Nice,3.5,PROD-1,me,01/01/2025,,,Insert",
  "412345,Concentrate,Vape Cartridge,House Cart,,1,PROD-2,me,01/01/2025,,,Insert",
].join("\n");
const prodParsed = parseCcrsFile(productNoPreamble);
eq(prodParsed.kind, "product", "parse Product (no preamble) kind");
eq(prodParsed.records.length, 2, "parse Product 2 rows");
if (prodParsed.kind === "product") {
  eq(prodParsed.records[0].category, "Flower Lot", "product row0 category");
  eq(prodParsed.records[0].brand, "Fairwinds", "product row0 brand extracted");
  eq(prodParsed.records[0].unit_weight_grams, 3.5, "product row0 weight");
  eq(prodParsed.records[1].brand, null, "product row1 no brand");
}

// ---------------------------------------------------------------------------
// full parse — unknown file -> no records (never guess)
// ---------------------------------------------------------------------------
const unknown = parseCcrsFile("foo,bar\n1,2");
eq(unknown.kind, "unknown", "unknown file kind");
eq(unknown.records.length, 0, "unknown file 0 records");

// ---------------------------------------------------------------------------
// benchmark aggregation helpers
// ---------------------------------------------------------------------------
eq(percentile([], 0.5), null, "percentile empty -> null");
eq(percentile([10], 0.5), 10, "percentile single");
eq(percentile([1, 2, 3, 4], 0.5), 2.5, "percentile median even (interpolated)");
eq(percentile([1, 2, 3, 4, 5], 0.5), 3, "percentile median odd");
eq(percentile([1, 2, 3, 4], 0.25), 1.75, "percentile p25");

const summ = summarizeMinor([100, 200, 300, 400]);
eq(summ.sample_size, 4, "summarize n");
eq(summ.min_minor, 100, "summarize min");
eq(summ.max_minor, 400, "summarize max");
eq(summ.median_minor, 250, "summarize median");
eq(summ.avg_minor, 250, "summarize avg");
const summEmpty = summarizeMinor([]);
eq(summEmpty.sample_size, 0, "summarize empty n=0");
eq(summEmpty.median_minor, null, "summarize empty median null (never fabricate)");

console.log(`\u2713 All ${passed} CCRS pure-function assertions passed.`);
