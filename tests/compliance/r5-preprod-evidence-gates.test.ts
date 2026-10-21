/**
 * Round 5 / Slice R5-3 (S-02b remnants): the pre-flight agrees with what CCRS
 * ACTUALLY did in the 2026-09-17 PREproduction run, using the real files we
 * uploaded and the real error files CCRS sent back
 * (docs/ccrs-bible/evidence/2026-09-17-preprod-run/).
 *
 *   T-19  Product, Usable Cannabis, EMPTY Description  -> ACCEPTED by CCRS.
 *         The guide has only a Note: "required when inventorytype = Useable
 *         cannabis, or Cannabis Mix Packaged" [G L0482-L0483]. So E10 must be
 *         a WARNING that never blocks the batch (U-21; examiner: "There is an
 *         expectation that a description is on file" [EXAM L0552]).
 *   T-42  Sale, RecreationalRetail, CannabisExciseTax 0.00 -> REJECTED,
 *         verbatim "Only Medical Sales Excise tax can be 0". Guide: "Only
 *         Medical Sales can be 0" [G L1378]; "An entry of 0 CannabisExciseTax
 *         is only allowed for sale type Wholsale, and sales that meet medical
 *         compliance conditions." [G L1460-L1461]  -> new blocking E50.
 *   T-40  the same sale with 4.44 excise -> ACCEPTED (control: E50 is silent).
 *   T-54  Inventory, NumberRecords 1 with 2 data rows -> REJECTED "CheckSum and
 *         number of records don't match"; "This number must match the number
 *         of records or the file will fail to process." [G L0203]  -> E19 is
 *         the verifier's NumberRecords check on the FINAL csv.
 *   T-37  Inventory naming "blue  dream flower 3.5g" (not the filed name) ->
 *         REJECTED "Invalid Product" [G L0579]  -> E20 is the ledger
 *         self-check L_REF_PRODUCT (exact, case- and space-sensitive).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CCRS_COLUMNS,
  verifyCcrsFile,
  verifySaleExciseRule,
  splitCsvLine,
} from "../../src/lib/compliance/ccrs-batch-core";
import { specPinFor, CCRS_ISSUE_CODES } from "../../src/lib/compliance/ccrs-preflight-core";
import { planOutboxFiles, verifyOutboxAgainstLedger } from "../../src/lib/compliance/ccrs-outbox-core";
import { buildLedgerView, type LedgerEntry } from "../../src/lib/compliance/ccrs-ledger-core";

const ROOT = join(__dirname, "..", "..");
const EV = join(ROOT, "docs/ccrs-bible/evidence/2026-09-17-preprod-run");
const probe = (dir: string, file: string) => readFileSync(join(EV, "probes", dir, file), "utf8");
const dataRows = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(splitCsvLine);
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const T42 = probe("T-42-EXPECT-ERROR", "Sale_413541_20250615213000.csv");
const T40 = probe("T-40", "Sale_413541_20250615213000.csv");
const T54 = probe("T-54-EXPECT-ERROR", "Inventory_413541_20250615213000.csv");
const T37 = probe("T-37-EXPECT-ERROR", "Inventory_413541_20250615213000.csv");
const T19 = probe("T-19-EXPECT-ERROR", "Product_413541_20250615213000.csv");

describe("the guide lines this slice rests on are verbatim (re-read from ../lcb when present)", () => {
  const guidePath = join(ROOT, "..", "lcb", "guide.txt");
  it.runIf(existsSync(guidePath))("[G L1378] [G L1460-L1461] [G L0203] [G L0482-L0483]", () => {
    const g = readFileSync(guidePath, "utf8").split("\n");
    const at = (n: number) => (g[n - 1] ?? "").trim();
    expect(at(1378)).toContain("Only Medical Sales can be 0");
    expect(at(1460)).toContain("An entry of 0 CannabisExciseTax is");
    expect(at(1461)).toContain("only allowed for sale type Wholsale, and sales that meet medical compliance conditions.");
    expect(at(203)).toContain("This number must match the number of records or the file will fail to process.");
    expect(at(482) + " " + at(483)).toMatch(/Note: required when inventorytype = Useable cannabis, or\s+Cannabis Mix Packaged/);
  });
  it("the bible copy (Part 02) carries the same lines", () => {
    const p2 = src("docs/ccrs-bible/02-authoritative-spec.md");
    expect(p2).toContain("L1378|                        ■   Only Medical Sales can be 0");
    expect(p2).toContain("L1461| only allowed for sale type Wholsale, and sales that meet medical compliance conditions.");
    expect(p2).toContain("L0203| Note: This number must match the number of records or the file will fail to process.");
  });
});

describe("E50: a non-medical Sale line with zero excise is caught before CCRS rejects it (T-42)", () => {
  it("the REAL error file CCRS returned for T-42 says exactly this", () => {
    const err = readFileSync(join(EV, "errors", "Sale__20260917T133244864.csv"), "utf8");
    expect(err).toContain(",RecreationalRetail,");
    expect(err).toContain(",0.00,GWSALE42,");
    expect(err.trimEnd().endsWith("Only Medical Sales Excise tax can be 0")).toBe(true);
  });

  it("verifyCcrsFile blocks the exact T-42 file we uploaded", () => {
    const p = verifyCcrsFile("Sale", T42);
    const e50 = p.filter((x) => x.severity === "error" && /Only Medical Sales Excise tax can be 0/.test(x.message));
    expect(e50).toHaveLength(1);
    expect(e50[0].message).toContain("GWSALE42-1");
    expect(e50[0].message).toContain("[G L1378]");
  });

  it("the accepted T-40 control (excise 4.44) passes the verifier with no error at all", () => {
    expect(verifyCcrsFile("Sale", T40).filter((x) => x.severity === "error")).toEqual([]);
  });

  const base = dataRows(T40)[0];
  const C = CCRS_COLUMNS.Sale;
  const row = (patch: Record<string, string>) => C.map((col, i) => (col in patch ? patch[col] : base[i]));

  it("RecreationalMedical with 0.00 is legal (medical compliance conditions)", () => {
    expect(verifySaleExciseRule([row({ SaleType: "RecreationalMedical", CannabisExciseTax: "0.00" })])).toEqual([]);
  });
  it("Wholesale with 0.00 is legal per [G L1461] (never emitted by a retailer, but not our error)", () => {
    expect(verifySaleExciseRule([row({ SaleType: "Wholesale", CannabisExciseTax: "0.00" })])).toEqual([]);
  });
  it.each(["0", "0.0", "0.00", " 0.00 "])("RecreationalRetail with %j is an error", (v) => {
    const p = verifySaleExciseRule([row({ CannabisExciseTax: v })]);
    expect(p).toHaveLength(1);
    expect(p[0].severity).toBe("error");
    expect(p[0].file).toBe("Sale");
  });
  it("a one-cent excise is NOT zero (boundary)", () => {
    expect(verifySaleExciseRule([row({ CannabisExciseTax: "0.01" })])).toEqual([]);
  });
  it("an empty or non-numeric excise is left to the numeric check (no double report)", () => {
    expect(verifySaleExciseRule([row({ CannabisExciseTax: "" })])).toEqual([]);
    expect(verifySaleExciseRule([row({ CannabisExciseTax: "abc" })])).toEqual([]);
  });
  it("every offending row is listed, by row number and sale line id, never capped", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ CannabisExciseTax: "0.00", SaleDetailExternalIdentifier: `L-${i + 1}` }));
    const p = verifySaleExciseRule(rows);
    expect(p).toHaveLength(40);
    expect(p[39].message).toContain("Sale row 40");
    expect(p[39].message).toContain("L-40");
  });
  it("the check also applies to Update/Delete correction rows (CCRS reads the same columns)", () => {
    expect(verifySaleExciseRule([row({ CannabisExciseTax: "0.00", Operation: "Update" })])).toHaveLength(1);
    expect(verifySaleExciseRule([row({ CannabisExciseTax: "0.00", Operation: "Delete" })])).toHaveLength(1);
  });
  it("SaleType is compared exactly as CCRS's enum (a lower-case type is not medical)", () => {
    expect(verifySaleExciseRule([row({ SaleType: "recreationalmedical", CannabisExciseTax: "0.00" })])).toHaveLength(1);
  });
  it("other files are never checked by the Sale rule", () => {
    expect(verifyCcrsFile("Inventory", T37).some((x) => /Excise/.test(x.message))).toBe(false);
  });
});

describe("E10 is a warning: CCRS accepted T-19 with an empty Description", () => {
  it("the T-19 file really had an empty Description for Usable Cannabis", () => {
    const r = dataRows(T19)[0];
    expect(r[CCRS_COLUMNS.Product.indexOf("InventoryType")]).toBe("Usable Cannabis");
    expect(r[CCRS_COLUMNS.Product.indexOf("Description")]).toBe("");
  });
  it("the T-19 file passes the verifier (no error) — the file shape was fine", () => {
    expect(verifyCcrsFile("Product", T19).filter((x) => x.severity === "error")).toEqual([]);
  });
  const batch = src("src/lib/compliance/ccrs-batch.ts");
  const at = batch.indexOf('code: "E10_DESCRIPTION_REQUIRED"');
  const block = batch.slice(batch.lastIndexOf("issues.push({", at), batch.indexOf("});", at));
  it("the builder pushes E10 as a WARNING (so the gate never refuses the batch for it)", () => {
    expect(at).toBeGreaterThan(0);
    expect(block).toContain('severity: "warning"');
    expect(block).not.toContain('severity: "error"');
  });
  it("the E10 message says CCRS accepts it today and the examiner expects descriptions", () => {
    expect(block).toContain("T-19");
    expect(block).toContain("[EXAM L0552]");
  });
  it("E9 (unit weight) stays an ERROR — CCRS really rejected it", () => {
    const at9 = batch.indexOf('code: "E9_UNITWEIGHT_ZERO_USABLE"');
    const b9 = batch.slice(batch.lastIndexOf("issues.push({", at9), at9);
    expect(b9).toContain('severity: "error"');
  });
  it("the product row is still emitted when E10 fires (never withheld)", () => {
    const loop = batch.slice(batch.indexOf("for (const found of productRowIssues({"), batch.indexOf("rows.push([", batch.indexOf("for (const found of productRowIssues({")));
    expect(loop).not.toMatch(/continue;/);
  });
});

describe("E19: NumberRecords is checked on the FINAL csv (T-54)", () => {
  it("the REAL T-54 file (NumberRecords 1, two rows) is refused by the verifier", () => {
    const p = verifyCcrsFile("Inventory", T54);
    expect(p.some((x) => x.severity === "error" && /NumberRecords \(1\) does not equal the 2 data row\(s\)/.test(x.message))).toBe(true);
  });
  it("the export route verifies the files it is about to ship (after every withholding step)", () => {
    const route = src("src/app/admin/reports/compliance/batch-export/route.ts");
    const v = route.indexOf("verifyCcrsBatch(batch.files.map((f) => ({ type: f.type, csv: f.csv })))");
    const g = route.indexOf("assertCcrsBatchSubmittable({");
    const refuse = route.indexOf("if (!verdict.submittable)");
    expect(v).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(v);
    expect(refuse).toBeGreaterThan(g);
  });
  it("assembleCcrsFile writes the count from the rows it is given (withheld rows are already gone)", () => {
    const core = src("src/lib/compliance/ccrs-batch-core.ts");
    expect(core).toContain('lines.push(["NumberRecords", String(rows.length)].join(","));');
  });
});

describe("E20: an Inventory Product must equal a filed Product name byte-for-byte (T-37)", () => {
  const view = buildLedgerView(
    "preprod",
    [
      { fileType: "Product", externalId: "P1", filedName: "Blue Dream Flower 3.5g", state: "filed", productExternalId: null },
      { fileType: "Strain", externalId: "Blue Dream", filedName: "Blue Dream", state: "filed", productExternalId: null },
      { fileType: "Area", externalId: "A1", filedName: "Sales Floor", state: "filed", productExternalId: null },
    ] as LedgerEntry[],
  ).view;
  const plan = (csv: string) => planOutboxFiles([{ type: "Inventory", csv }], { licenseNumber: "413541", now: new Date("2026-10-20T19:00:00Z"), lastStamp: null });
  it("the exact T-37 file we uploaded (double space, lower case) is flagged L_REF_PRODUCT", () => {
    const p = verifyOutboxAgainstLedger(view, plan(T37));
    expect(p.map((x) => x.code)).toEqual(["L_REF_PRODUCT"]);
    expect(p[0].message).toContain('"blue  dream flower 3.5g"');
  });
  it("the same file with the filed spelling is clean (control)", () => {
    const fixed = T37.replace("blue  dream flower 3.5g", "Blue Dream Flower 3.5g");
    expect(verifyOutboxAgainstLedger(view, plan(fixed))).toEqual([]);
  });
});

describe("E50 registration and wiring", () => {
  it("E50 is a coded issue with the guide pins", () => {
    expect(CCRS_ISSUE_CODES).toContain("E50_ZERO_EXCISE_NOT_MEDICAL");
    expect(specPinFor("E50_ZERO_EXCISE_NOT_MEDICAL")).toBe("[G L1378]");
  });
  it("verifyCcrsFile runs the excise rule for Sale files", () => {
    const core = src("src/lib/compliance/ccrs-batch-core.ts");
    const fn = core.slice(core.indexOf("export function verifyCcrsFile("), core.indexOf("export function verifyCcrsBatch("));
    expect(fn).toMatch(/if \(type === "Sale"\) \{\s*problems\.push\(\.\.\.verifySaleExciseRule\(dataRows\.map\(ccrsReaderSplit\)\)\);/);
  });
  it("the strategy table already knows the verbatim CCRS string (one vocabulary)", () => {
    expect(src("src/lib/compliance/ccrs-strategy-core.ts")).toContain('"Only Medical Sales Excise tax can be 0"');
    expect(src("src/lib/compliance/ccrs-outcome-core.ts")).toContain('text: "Only Medical Sales Excise tax can be 0"');
  });
});
