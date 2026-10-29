/**
 * S-16 (CCRS Bible Part 17 §G G-3, Part 09 S-16): copy diff verifier.
 *
 * Why this matters to the license: the examiner's advice is "after the initial
 * uploads, recommendation is to reach out for a copy of what was submitted to
 * check for accuracy" [EXAM L0568]. A verifier that calls a wrong record
 * "verified" hides a bad state record; one that judges a record the copy could
 * not yet show raises a false alarm. These tests pin:
 *   1. Which of our rows count: only the LAST row per record that may have
 *      reached CCRS (rejected / withheld / planned / emitted never did).
 *   2. Which records are NOT judged, and why: uncertain, unanswered, too new.
 *   3. Every compared field, exactly (numbers as numbers, dates as days, the
 *      Product name read from the copy's own Product report, case rules).
 *   4. The report shows exact bytes and never "fixes" anything.
 *   5. The SQL CI runs is the SQL the script sends; the read returns exactly
 *      the lines these tests use; the script end to end, read-only.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUCKETS,
  BUCKET_MEANING,
  CopyVerifyError,
  PROBLEM_BUCKETS,
  SENT_READ_SQL,
  VERIFY_TYPES,
  __runCcrsCopyVerifyCoreTests,
  asOfCutoffUs,
  ccrsDay,
  parseSentLine,
  sameNumber,
  verifyCopy,
  verifyCopyTexts,
  verifyReport,
  type SentLine,
} from "@/lib/compliance/ccrs-copy-verify-core";
import { SEED_HEADERS, buildLedgerSeed } from "@/lib/compliance/ccrs-ledger-seed-core";
import { buildCopyVerifyPgCheck, copyVerifyFixture } from "../../scripts/compliance/copy-verify-pg-check-fixture";
import { main } from "../../scripts/compliance/verify-ccrs-copy";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/* ----------------------------- fixtures ----------------------------- */
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
type InvOver = Partial<Record<(typeof SEED_HEADERS.Inventory)[number], string>>;
const invRow = (id: string, over: InvOver = {}): string[] => {
  const base: Record<string, string> = {
    "License Number": "413541", Strain: "Blue Dream", "Inventory Type": "Usable Cannabis", Name: "ignored", "Product Identifier": "P-1",
    "Product Name": "the description", IsMedical: "FALSE", "InventoryIdentifier (ExternalIdentifier on inventory.csv)": id, "Initial Quantity": "10",
    "Quantity on Hand": "4", TotalCost: "25.00", CreatedBy: "Greenway Marijuana", CreatedDate: "10/20/2026", Updatedby: "", UpdatedDate: "",
  };
  return SEED_HEADERS.Inventory.map((h) => over[h] ?? base[h]);
};
const prodRow = (id: string, name: string, over: Partial<Record<string, string>> = {}) => [
  over.Inventorytype ?? "Usable Cannabis", name, over.Description ?? "the description", over.UnitWeightGrams ?? "1", id, "G", "10/20/2026", "", "", "",
];
const strainRow = (name: string, type = "Hybrid") => [type, name, "G", "10/20/2026", "", ""];
const areaRow = (id: string, name: string, q = "FALSE") => [name, q, id, "G", "10/20/2026", "", ""];
type CopyParts = { inv?: string[][]; prod?: string[][]; strain?: string[][]; area?: string[][] };
const texts = (p: CopyParts = {}) => ({
  Inventory: csv([[...SEED_HEADERS.Inventory], ...(p.inv ?? [invRow("L1")])]),
  Product: csv([[...SEED_HEADERS.Product], ...(p.prod ?? [prodRow("P-1", "BD 1g")])]),
  Strain: csv([[...SEED_HEADERS.Strain], ...(p.strain ?? [strainRow("Blue Dream")])]),
  Area: csv([[...SEED_HEADERS.Area], ...(p.area ?? [areaRow("A-1", "Sales Floor")])]),
});
const us = (iso: string) => String(BigInt(Date.parse(iso)) * BigInt(1000));
const OCT20 = us("2026-10-20T19:00:00Z");
const invPayload = (over: Record<string, string> = {}) => ({
  LicenseNumber: "413541", Strain: "Blue Dream", Area: "Sales Floor", Product: "BD 1g", InitialQuantity: "10", QuantityOnHand: "4", TotalCost: "25",
  IsMedical: "False", ExternalIdentifier: "L1", CreatedBy: "Greenway Marijuana", CreatedDate: "10/20/2026", UpdatedBy: "", UpdatedDate: "", Operation: "Insert", ...over,
});
const line = (over: Partial<SentLine> = {}): SentLine => ({
  t: "Inventory", id: "L1", op: "Insert", rowState: "submitted", fileState: "succeeded", file: "Inventory_413541_20261020190000.csv",
  stampUs: OCT20, uploadedUs: OCT20, rowNo: 1, eventsAfter: 0, payload: invPayload(), ...over,
});
const AS_OF = "2026-11-01";
const run = (sent: SentLine[], p: CopyParts = {}, asOf = AS_OF) => verifyCopyTexts(texts(p), sent, asOf);
const one = (sent: SentLine[], p: CopyParts = {}, asOf = AS_OF) => {
  const r = run(sent, p, asOf);
  expect(r.items).toHaveLength(1);
  return r.items[0];
};

/* ------------------------------- tests ------------------------------ */
describe("S-16 pure self-tests", () => {
  it("all pass, and there are at least 15 of them", () => {
    const r = __runCcrsCopyVerifyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
});

describe("S-16 buckets are fixed and explained", () => {
  it("nine buckets, four of them problems, each with a plain meaning", () => {
    expect([...BUCKETS]).toEqual(["verified", "mismatched", "zeroedNotZero", "missing", "deletedPresent", "copyConflict", "notJudgedUncertain", "notJudgedUnanswered", "notJudgedTooNew"]);
    expect([...PROBLEM_BUCKETS]).toEqual(["mismatched", "zeroedNotZero", "missing", "deletedPresent"]);
    for (const b of BUCKETS) expect(BUCKET_MEANING[b].length).toBeGreaterThan(20);
    expect([...VERIFY_TYPES]).toEqual(["Inventory", "Product", "Strain", "Area"]);
  });
});

describe("S-16 which of our rows count", () => {
  it("an identical record verifies (25 = 25.00, False = FALSE, 10/20/2026 = 10/20/2026)", () => {
    const it0 = one([line()]);
    expect(it0.bucket).toBe("verified");
    expect(it0.diffs).toEqual([]);
    expect(it0.notes).toEqual([]);
  });
  it("rejected, withheld, planned and emitted rows never reached CCRS: the record is not listed at all", () => {
    for (const rowState of ["rejected", "withheld", "planned", "emitted"]) expect(run([line({ rowState })]).items).toEqual([]);
  });
  it("a rejected LATER row is skipped: the earlier landed row is the one judged", () => {
    const later = us("2026-10-21T19:00:00Z");
    const it0 = one([line(), line({ stampUs: later, uploadedUs: later, rowState: "rejected", op: "Update", payload: invPayload({ QuantityOnHand: "0", Operation: "Update" }), file: "B.csv" })]);
    expect(it0.bucket).toBe("verified");
    expect(it0.file).toBe("Inventory_413541_20261020190000.csv");
  });
  it("the last row wins by file stamp, regardless of input order", () => {
    const later = us("2026-10-21T19:00:00Z");
    const upd = line({ stampUs: later, uploadedUs: later, op: "Update", payload: invPayload({ QuantityOnHand: "3", Operation: "Update" }), file: "B.csv" });
    expect(one([upd, line()]).file).toBe("B.csv");
    expect(one([upd, line()]).bucket).toBe("mismatched"); // copy holds 4
    expect(one([line(), upd], { inv: [invRow("L1", { "Quantity on Hand": "3" })] }).bucket).toBe("verified");
  });
  it("within one file, the higher row number wins", () => {
    const a = line({ rowNo: 1, payload: invPayload({ QuantityOnHand: "9" }) });
    const b = line({ rowNo: 2 });
    expect(one([b, a]).bucket).toBe("verified");
    expect(one([line({ rowNo: 2, payload: invPayload({ QuantityOnHand: "9" }) }), line({ rowNo: 1 })]).bucket).toBe("mismatched");
  });
  it("stamps are compared exactly as integers (no float rounding)", () => {
    const a = line({ stampUs: "1792530000000001", uploadedUs: OCT20 });
    const b = line({ stampUs: "1792530000000000", uploadedUs: OCT20, payload: invPayload({ QuantityOnHand: "9" }) });
    expect(one([a, b]).bucket).toBe("verified");
  });
});

describe("S-16 records that are not judged (never a guess)", () => {
  it("uncertain last row", () => expect(one([line({ rowState: "uncertain" })]).bucket).toBe("notJudgedUncertain"));
  it("unanswered file (state uploaded)", () => expect(one([line({ fileState: "uploaded" })]).bucket).toBe("notJudgedUnanswered"));
  it("uploaded at exactly 00:00 UTC of the copy date is too new; one microsecond earlier is judged", () => {
    const cut = asOfCutoffUs(AS_OF);
    expect(one([line({ uploadedUs: String(cut) })]).bucket).toBe("notJudgedTooNew");
    expect(one([line({ uploadedUs: String(cut - BigInt(1)) })]).bucket).toBe("verified");
  });
  it("no upload time is too new (never judged)", () => expect(one([line({ uploadedUs: null })]).bucket).toBe("notJudgedTooNew"));
  it("not-judged buckets are not problems", () => {
    expect(run([line({ rowState: "uncertain" })]).problems).toBe(0);
    expect(run([line({ id: "L9", fileState: "uploaded" })]).problems).toBe(0);
  });
  it("the cutoff is midnight UTC; impossible or malformed dates are refused", () => {
    expect(asOfCutoffUs("2026-11-01")).toBe(BigInt(Date.parse("2026-11-01T00:00:00Z")) * BigInt(1000));
    for (const bad of ["2026-02-30", "2026-13-01", "11/01/2026", "2026-1-01", "", "2026-11-01T00:00"]) expect(() => asOfCutoffUs(bad)).toThrow(CopyVerifyError);
    expect(() => run([line()], {}, "2026-02-29")).toThrow(CopyVerifyError);
  });
});

describe("S-16 Inventory fields", () => {
  it("each compared field is reported by name with both values", () => {
    const fields: [string, Record<string, string>][] = [
      ["LicenseNumber", { LicenseNumber: "413542" }],
      ["Strain", { Strain: "Purple Haze" }],
      ["Product", { Product: "BD 2g" }],
      ["InitialQuantity", { InitialQuantity: "11" }],
      ["QuantityOnHand", { QuantityOnHand: "5" }],
      ["TotalCost", { TotalCost: "25.01" }],
      ["IsMedical", { IsMedical: "True" }],
      ["CreatedDate", { CreatedDate: "10/21/2026" }],
    ];
    for (const [field, over] of fields) {
      const r = one([line({ payload: invPayload(over) })]);
      expect(r.bucket, field).toBe("mismatched");
      expect(r.diffs.map((d) => d.field), field).toEqual([field]);
      expect(r.diffs[0].sent, field).toBe(Object.values(over)[0]);
    }
  });
  it("Area, CreatedBy, UpdatedBy and UpdatedDate are not compared (the copy cannot show them / undocumented)", () => {
    expect(one([line({ payload: invPayload({ Area: "Vault", CreatedBy: "someone", UpdatedBy: "x", UpdatedDate: "10/30/2026" }) })]).bucket).toBe("verified");
  });
  it("the product name comes from the copy's Product report by id, never from the Inventory 'Product Name' (the Description)", () => {
    expect(one([line()], { inv: [invRow("L1", { "Product Name": "BD 1g" })], prod: [prodRow("P-1", "Something Else")] }).diffs).toEqual([{ field: "Product", sent: "BD 1g", stored: "Something Else" }]);
    expect(one([line()], { inv: [invRow("L1", { "Product Name": "totally different", Name: "also different" })] }).bucket).toBe("verified");
  });
  it("a lot whose product id is not in the copy's Product report is a mismatch, saying so", () => {
    const r = one([line()], { inv: [invRow("L1", { "Product Identifier": "P-404" })] });
    expect(r.bucket).toBe("mismatched");
    expect(r.diffs[0]).toEqual({ field: "Product", sent: "BD 1g", stored: "(Product P-404 is not in the copy's Product report)" });
  });
  it("a lot whose product is listed twice in the copy is a mismatch, saying so", () => {
    const r = one([line()], { prod: [prodRow("P-1", "BD 1g"), prodRow("P-1", "BD 1g v2")] });
    expect(r.diffs[0].stored).toBe("(Product P-1 is listed more than once in the copy)");
  });
  it("product names compare byte for byte (a trailing space is a difference)", () => {
    expect(one([line({ payload: invPayload({ Product: "BD 1g " }) })]).diffs[0]).toEqual({ field: "Product", sent: "BD 1g ", stored: "BD 1g" });
    expect(one([line({ payload: invPayload({ Product: "bd 1g" }) })]).bucket).toBe("mismatched");
  });
  it("strain differing only in letter case is a note, not a mismatch (U-45b)", () => {
    const r = one([line({ payload: invPayload({ Strain: "BLUE DREAM" }) })]);
    expect(r.bucket).toBe("verified");
    expect(r.notes[0]).toContain("U-45b");
    expect(r.notes[0]).toContain('"BLUE DREAM"');
  });
  it("numbers are equal as numbers (10 = 10.00 = 10.0); 10 vs 10.001 is not", () => {
    expect(one([line({ payload: invPayload({ InitialQuantity: "10.00", QuantityOnHand: "4.0", TotalCost: "25.000" }) })]).bucket).toBe("verified");
    expect(one([line({ payload: invPayload({ InitialQuantity: "10.001" }) })]).bucket).toBe("mismatched");
  });
  it("IsMedical compares without letter case (CCRS writes FALSE, we send False)", () => {
    expect(one([line({ payload: invPayload({ IsMedical: "FALSE" }) })]).bucket).toBe("verified");
    expect(one([line({ payload: invPayload({ IsMedical: "false" }) })]).bucket).toBe("verified");
    expect(one([line({ payload: invPayload({ IsMedical: "" }) })]).bucket).toBe("mismatched");
  });
  it("CreatedDate compares as a day (9/1/2026 = 09/01/2026); an unreadable date is a mismatch, never equal", () => {
    expect(one([line({ payload: invPayload({ CreatedDate: "09/01/2026" }) })], { inv: [invRow("L1", { CreatedDate: "9/1/2026" })] }).bucket).toBe("verified");
    expect(one([line({ payload: invPayload({ CreatedDate: "2026-10-20" }) })]).diffs[0].field).toBe("CreatedDate");
    expect(one([line({ payload: invPayload({ CreatedDate: "02/30/2026" }) })], { inv: [invRow("L1", { CreatedDate: "02/30/2026" })] }).bucket).toBe("mismatched");
  });
  it("we sent QoH 0 and CCRS still shows a quantity: zeroedNotZero (a problem)", () => {
    const r = run([line({ op: "Update", payload: invPayload({ QuantityOnHand: "0", Operation: "Update" }) })]);
    expect(r.items[0].bucket).toBe("zeroedNotZero");
    expect(r.items[0].diffs).toEqual([{ field: "QuantityOnHand", sent: "0", stored: "4" }]);
    expect(r.problems).toBe(1);
    expect(one([line({ payload: invPayload({ QuantityOnHand: "0.00" }) })]).bucket).toBe("zeroedNotZero");
  });
  it("we sent 0 and CCRS shows 0.00: verified", () => {
    expect(one([line({ payload: invPayload({ QuantityOnHand: "0" }) })], { inv: [invRow("L1", { "Quantity on Hand": "0.00" })] }).bucket).toBe("verified");
  });
  it("a QoH difference after later landed Sale/Adjustment rows is still reported, with a U-68 note", () => {
    const r = one([line({ eventsAfter: 2, payload: invPayload({ QuantityOnHand: "6" }) })]);
    expect(r.bucket).toBe("mismatched");
    expect(r.notes.join(" ")).toMatch(/^2 landed Sale\/Adjustment row\(s\).*U-68/);
  });
  it("no U-68 note when the QoH matches, even with later events", () => {
    expect(one([line({ eventsAfter: 3 })]).notes).toEqual([]);
  });
});

describe("S-16 present / absent / deleted / conflicts", () => {
  it("a landed Insert or Update the copy lacks is missing", () => {
    expect(one([line({ id: "L9" })]).bucket).toBe("missing");
    expect(one([line({ id: "L9", op: "Update" })]).bucket).toBe("missing");
  });
  it("a landed Delete: present = deletedPresent (problem), absent = verified", () => {
    expect(one([line({ op: "Delete" })]).bucket).toBe("deletedPresent");
    expect(run([line({ op: "Delete" })]).problems).toBe(1);
    expect(one([line({ id: "L9", op: "Delete" })]).bucket).toBe("verified");
  });
  it("a record the copy lists twice with different values is copyConflict, not judged, not a problem", () => {
    const r = run([line()], { inv: [invRow("L1"), invRow("L1", { "Quantity on Hand": "9" })] });
    expect(r.items[0].bucket).toBe("copyConflict");
    expect(r.items[0].notes).toEqual(["2 rows in the copy"]);
    expect(r.problems).toBe(0);
  });
  it("copy records we never sent are not listed (the S-15 re-seed handles those)", () => {
    expect(run([], { inv: [invRow("L1"), invRow("L2")] }).items).toEqual([]);
  });
});

describe("S-16 Product, Strain, Area fields", () => {
  const prodPayload = (over: Record<string, string> = {}) => ({
    LicenseNumber: "413541", InventoryCategory: "EndProduct", InventoryType: "Usable Cannabis", Name: "BD 1g", Description: "the description", UnitWeightGrams: "1",
    ExternalIdentifier: "P-1", CreatedBy: "G", CreatedDate: "10/20/2026", UpdatedBy: "", UpdatedDate: "", Operation: "Insert", ...over,
  });
  const p = (over: Record<string, string> = {}) => line({ t: "Product", id: "P-1", payload: prodPayload(over) });
  it("Product verifies on Name, Description, InventoryType (copy 'Inventorytype') and UnitWeightGrams (1 = 1.00)", () => {
    expect(one([p({ UnitWeightGrams: "1.00", InventoryCategory: "Anything", CreatedBy: "x" })]).bucket).toBe("verified");
    for (const [field, over] of [["Name", { Name: "BD 2g" }], ["Description", { Description: "other" }], ["InventoryType", { InventoryType: "Concentrate for Inhalation" }], ["UnitWeightGrams", { UnitWeightGrams: "2" }]] as const) {
      expect(one([p(over)]).diffs.map((d) => d.field), field).toEqual([field]);
    }
  });
  const s = (id: string, type = "Hybrid") => line({ t: "Strain", id, op: null, payload: { LicenseNumber: "413541", Strain: id, StrainType: type, CreatedBy: "G", CreatedDate: "10/20/2026" } });
  it("Strain verifies on StrainType; a null op is treated as Insert", () => {
    const r = one([s("Blue Dream")]);
    expect(r.bucket).toBe("verified");
    expect(r.op).toBe("Insert");
    expect(one([s("Blue Dream", "Indica")]).diffs).toEqual([{ field: "StrainType", sent: "Indica", stored: "Hybrid" }]);
  });
  it("a strain held only in another letter case verifies with a U-45b note; held in two cases it cannot be compared but is not missing", () => {
    const r = one([s("BLUE DREAM")]);
    expect(r.bucket).toBe("verified");
    expect(r.notes[0]).toContain('"Blue Dream"');
    const r2 = one([s("BLUE DREAM")], { strain: [strainRow("Blue Dream"), strainRow("blue dream")] });
    expect(r2.bucket).toBe("verified");
    expect(r2.notes[0]).toContain('"Blue Dream", "blue dream"');
    expect(one([s("Nope")]).bucket).toBe("missing");
  });
  it("a strain in another case still has its StrainType compared", () => {
    expect(one([s("BLUE DREAM", "Sativa")]).bucket).toBe("mismatched");
  });
  const a = (over: Record<string, string> = {}) => line({ t: "Area", id: "A-1", payload: { LicenseNumber: "413541", Area: "Sales Floor", IsQuarantine: "False", ExternalIdentifier: "A-1", Operation: "Insert", ...over } });
  it("Area verifies on Area vs the copy's Name and IsQuarantine (any letter case)", () => {
    expect(one([a()]).bucket).toBe("verified");
    expect(one([a({ Area: "Vault" })]).diffs).toEqual([{ field: "Area", sent: "Vault", stored: "Sales Floor" }]);
    expect(one([a({ IsQuarantine: "True" })]).diffs[0].field).toBe("IsQuarantine");
  });
});

describe("S-16 counts, order and report", () => {
  it("items are sorted by type then id in byte order; counts add up", () => {
    const r = run([line({ id: "b" }), line({ id: "B" }), line({ id: "L1" }), line({ t: "Area", id: "A-1", payload: { Area: "Sales Floor", IsQuarantine: "FALSE" } })]);
    expect(r.items.map((i) => `${i.t}:${i.id}`)).toEqual(["Area:A-1", "Inventory:B", "Inventory:L1", "Inventory:b"]);
    expect(r.counts.sentRecords).toBe(4);
    expect(r.counts.total.missing).toBe(2);
    expect(r.counts.byType.Inventory.verified).toBe(1);
    expect(r.counts.byType.Area.verified).toBe(1);
    expect(Object.values(r.counts.total).reduce((x, y) => x + y, 0)).toBe(4);
    expect(r.problems).toBe(2);
  });
  it("the report says 'no problems' only when there are none", () => {
    expect(verifyReport(run([line()]))).toContain("**Result: no problems.**");
    const bad = verifyReport(run([line({ id: "L9" })]));
    expect(bad).toContain("**Result: 1 problem record(s).**");
    expect(bad).toContain("## missing (1)");
    expect(bad).toContain("Nothing was changed anywhere");
  });
  it("the report lists what is NOT compared", () => {
    const t = verifyReport(run([line()]));
    for (const w of ["Area on lots", "CreatedBy / UpdatedBy / UpdatedDate", "InventoryCategory", "sales, adjustments and transfers"]) expect(t).toContain(w);
  });
  it("values are JSON-quoted and table-safe (spaces, pipes, line breaks visible)", () => {
    const t = verifyReport(run([line({ payload: invPayload({ Product: "BD | 1g\nx " }) })]));
    expect(t).toContain('Product: sent "BD \\| 1g\\\\nx ", stored "BD 1g"');
    expect(t.split("\n").filter((l) => l.startsWith("| Inventory")).length).toBe(1);
  });
  it("verified items with a note get their own section", () => {
    expect(verifyReport(run([line({ payload: invPayload({ Strain: "blue dream" }) })]))).toContain("## verified, with a note (1)");
  });
  it("long sections are cut at the limit and say how many are hidden", () => {
    const sent = Array.from({ length: 5 }, (_, i) => line({ id: `X${i}` }));
    const t = verifyReport(run(sent), 2);
    expect(t).toContain("| … | 3 more not shown |");
  });
});

describe("S-16 sent lines are validated, never trusted", () => {
  const ok = JSON.stringify(line());
  it("a good line parses to the same object", () => expect(parseSentLine(ok)).toEqual(line()));
  const bad: [string, Record<string, unknown>][] = [
    ["type", { t: "Sale" }], ["id", { id: "" }], ["op", { op: "Upsert" }], ["rowState", { rowState: "done" }], ["fileState", { fileState: "draft" }],
    ["fileState abandoned", { fileState: "abandoned" }], ["file", { file: "" }], ["stamp", { stampUs: "1.5" }], ["stamp text", { stampUs: 5 }],
    ["upload", { uploadedUs: "x" }], ["rowNo", { rowNo: 0 }], ["rowNo float", { rowNo: 1.5 }], ["eventsAfter", { eventsAfter: -1 }],
    ["payload array", { payload: [] }], ["payload number", { payload: { a: 1 } }], ["payload null", { payload: null }],
  ];
  for (const [name, over] of bad) it(`refuses a bad ${name}`, () => expect(() => parseSentLine(JSON.stringify({ ...line(), ...over }))).toThrow(CopyVerifyError));
  it("refuses non-JSON and non-objects", () => {
    expect(() => parseSentLine("not json")).toThrow(CopyVerifyError);
    expect(() => parseSentLine("[1]")).toThrow(CopyVerifyError);
    expect(() => parseSentLine("null")).toThrow(CopyVerifyError);
  });
});

describe("S-16 helpers", () => {
  it("sameNumber is exact and never equal on unreadable input", () => {
    expect(sameNumber("10", "10.00")).toBe(true);
    expect(sameNumber("-0", "0")).toBe(true);
    expect(sameNumber("0.1", "0.10")).toBe(true);
    expect(sameNumber("10", "10.0000001")).toBe(false);
    for (const [x, y] of [["", ""], ["", "0"], ["abc", "abc"], ["1e3", "1000"]]) expect(sameNumber(x, y), `${x}/${y}`).toBe(false);
  });
  it("ccrsDay reads M/D/YYYY and MM/DD/YYYY and refuses impossible days", () => {
    expect(ccrsDay("9/1/2026")).toBe("2026-09-01");
    expect(ccrsDay("02/29/2028")).toBe("2028-02-29");
    for (const b of ["02/29/2026", "13/01/2026", "0/1/2026", "2026-09-01", "9/1/26", ""]) expect(ccrsDay(b), b).toBe(null);
  });
});

describe("S-16 the database read (SENT_READ_SQL)", () => {
  it("reads only production, non-seed, Inventory/Product/Strain/Area files that left the building", () => {
    expect(SENT_READ_SQL).toContain("f.env = 'prod'");
    expect(SENT_READ_SQL).toContain("f.purpose <> 'seed'");
    expect(SENT_READ_SQL).toContain("f.file_type in ('Inventory', 'Product', 'Strain', 'Area')");
    expect(SENT_READ_SQL).toContain("f.state in ('uploaded', 'succeeded', 'errored', 'reconciling', 'closed')");
    expect(SENT_READ_SQL).not.toMatch(/'draft'|'emitted'|'abandoned'/);
  });
  it("counts only landed Sale/Adjustment rows of answered files as later events", () => {
    expect(SENT_READ_SQL).toContain("ef.file_type in ('Sale', 'InventoryAdjustment')");
    expect(SENT_READ_SQL).toContain("ef.state in ('succeeded', 'errored', 'reconciling', 'closed') and er.state in ('submitted', 'confirmed')");
    expect(SENT_READ_SQL).toContain("s > f.stamp_at");
  });
  it("times are integer microseconds (independent of DateStyle / TimeZone); order is byte order", () => {
    expect(SENT_READ_SQL).toContain("(extract(epoch from f.stamp_at) * 1000000)::bigint::text");
    expect(SENT_READ_SQL).toContain('r.external_id collate "C"');
  });
  it("is read-only", () => {
    expect(SENT_READ_SQL).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
    expect(SENT_READ_SQL.trim().startsWith("with ev as (select")).toBe(true);
  });
});

describe("S-16 the SQL CI runs is the SQL the script sends", () => {
  it("the checked-in pg-check equals its generator", () => {
    expect(read("scripts/recon/ccrs-copy-verify-pg-check.sql")).toBe(buildCopyVerifyPgCheck());
  });
  it("the pg-check embeds SENT_READ_SQL verbatim and rolls back", () => {
    const sql = buildCopyVerifyPgCheck();
    expect(sql).toContain(`create temp table cv_sent as ${SENT_READ_SQL.replace(/;$/, "")};`);
    expect(sql.trim().endsWith("rollback;")).toBe(true);
    expect(sql).not.toMatch(/\bcommit\b/i);
    expect(sql).toContain("ccrs_mark_uploaded(");
    expect(sql).toContain("ccrs_record_outcome(");
  });
  it("is registered for CI's migrations job with its PASSED line", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-copy-verify-pg-check.sql", mustPrint: "CCRS COPY VERIFY CHECK PASSED" });
  });
});

describe("S-16 the fixture history, judged against a constructed copy", () => {
  const fx = copyVerifyFixture();
  // The copy LCB would send a week after the history, with CV-L3 sold down by 1 (U-68 case).
  const copyParts = (over: { l3?: string; l2?: string; dropL1?: boolean } = {}): CopyParts => ({
    inv: [
      ...(over.dropL1 ? [] : [invRow("CV-L1", { Strain: "CV Kush", "Product Identifier": "CV-P-1", "Initial Quantity": "10", "Quantity on Hand": "0", TotalCost: "25.00", CreatedDate: "9/21/2026" })]),
      invRow("CV-L2", { Strain: "CV Kush", "Product Identifier": "CV-P-1", "Initial Quantity": "10", "Quantity on Hand": over.l2 ?? "3", TotalCost: "25.00", CreatedDate: "9/21/2026" }),
      invRow("CV-L3", { Strain: "CV Kush", "Product Identifier": "CV-P-2", "Initial Quantity": "5", "Quantity on Hand": over.l3 ?? "5", TotalCost: "9.50", CreatedDate: "9/21/2026" }),
    ],
    prod: [prodRow("CV-P-1", "CV Kush 1g", { Description: "cv desc" }), prodRow("CV-P-2", "CV O'Neil 1g", { Description: "cv desc 2" })],
    strain: [strainRow("CV Kush")],
    area: [areaRow("CV-AREA-1", "CV Floor")],
  });
  it("the fixture's expected lines are themselves valid sent lines", () => {
    for (const l of fx.expected) expect(parseSentLine(JSON.stringify(l))).toEqual(l);
    expect(fx.expected.map((l) => `${l.t}:${l.id}:${l.rowState}:${l.fileState}`)).toEqual([
      "Area:CV-AREA-1:confirmed:closed",
      "Inventory:CV-L1:confirmed:errored", "Inventory:CV-L1:submitted:succeeded",
      "Inventory:CV-L2:confirmed:errored", "Inventory:CV-L2:submitted:succeeded",
      "Inventory:CV-L3:submitted:errored",
      "Inventory:CV-REJ:rejected:errored",
      "Product:CV-P-1:submitted:succeeded", "Product:CV-P-2:submitted:succeeded",
      "Strain:CV Kush:confirmed:closed",
    ]);
    expect(fx.expected.find((l) => l.id === "CV-L3")!.eventsAfter).toBe(1);
  });
  it("a copy holding exactly what we sent verifies everything; the rejected lot is not listed", () => {
    const r = verifyCopyTexts(texts(copyParts()), fx.expected, "2026-10-12");
    expect(r.problems).toBe(0);
    expect(r.items.map((i) => `${i.t}:${i.id}:${i.bucket}`)).toEqual([
      "Area:CV-AREA-1:verified", "Inventory:CV-L1:verified", "Inventory:CV-L2:verified", "Inventory:CV-L3:verified",
      "Product:CV-P-1:verified", "Product:CV-P-2:verified", "Strain:CV Kush:verified",
    ]);
    expect(r.items.find((i) => i.id === "CV-L1")!.op).toBe("Update");
  });
  it("CV-L3 sold down to 4 in the copy: a mismatch with the U-68 note (1 later sale)", () => {
    const r = verifyCopyTexts(texts(copyParts({ l3: "4" })), fx.expected, "2026-10-12");
    const l3 = r.items.find((i) => i.id === "CV-L3")!;
    expect(l3.bucket).toBe("mismatched");
    expect(l3.notes[0]).toMatch(/^1 landed Sale\/Adjustment row\(s\).*U-68/);
  });
  it("CV-L1 closed by our Update but the copy lacks it: missing; CV-L2 at 6 (week-1 value): mismatched", () => {
    const r = verifyCopyTexts(texts(copyParts({ dropL1: true, l2: "6" })), fx.expected, "2026-10-12");
    expect(r.items.find((i) => i.id === "CV-L1")!.bucket).toBe("missing");
    expect(r.items.find((i) => i.id === "CV-L2")!.diffs).toEqual([{ field: "QuantityOnHand", sent: "3", stored: "6" }]);
    expect(r.problems).toBe(2);
  });
  it("a copy dated before week 2 does not judge the week-2 Updates (too new)", () => {
    const r = verifyCopyTexts(texts(copyParts()), fx.expected, "2026-09-28");
    expect(r.items.filter((i) => i.bucket === "notJudgedTooNew").map((i) => i.id)).toEqual(["CV-L1", "CV-L2"]);
  });
  it("the copy is read with the S-12 delivery reader (one parser for all three slices)", () => {
    expect(verifyCopyTexts(texts(copyParts()), fx.expected, "2026-10-12")).toEqual(verifyCopy(buildLedgerSeed(texts(copyParts())).entities, fx.expected, "2026-10-12"));
  });
});

describe("S-16 script end to end (saved files, no database)", () => {
  let dir = "";
  let logs: string[] = [];
  let errs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "s16-"));
    logs = []; errs = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
  const setup = (sent: SentLine[], p: CopyParts = {}) => {
    const t = texts(p);
    for (const [k, v] of Object.entries(t)) writeFileSync(path.join(dir, `${k}.csv`), v);
    writeFileSync(path.join(dir, "sent.jsonl"), sent.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return ["node", "verify-ccrs-copy.ts", "--inventory", path.join(dir, "Inventory.csv"), "--product", path.join(dir, "Product.csv"), "--strain", path.join(dir, "Strain.csv"), "--area", path.join(dir, "Area.csv"), "--sent-file", path.join(dir, "sent.jsonl")];
  };
  it("no problems: exit 0, prints counts, writes the report and JSON", () => {
    const argv = [...setup([line()]), "--as-of", AS_OF, "--report", path.join(dir, "r.md"), "--json", path.join(dir, "r.json")];
    expect(main(argv)).toBe(0);
    expect(logs[0]).toBe(`copy check counts: ${JSON.stringify(run([line()]).counts.total)}`);
    expect(logs).toContain("OK: no problems. Nothing was changed.");
    expect(readFileSync(path.join(dir, "r.md"), "utf8")).toBe(verifyReport(run([line()])));
    expect(JSON.parse(readFileSync(path.join(dir, "r.json"), "utf8")).problems).toBe(0);
  });
  it("problems: exit 1 and says nothing was changed", () => {
    expect(main([...setup([line({ id: "L9" })]), "--as-of", AS_OF])).toBe(1);
    expect(logs.join("\n")).toContain("PROBLEMS: 1 record(s)");
  });
  it("--as-of is required (never guessed): exit 2", () => {
    expect(main(setup([line()]))).toBe(2);
    expect(errs[0]).toContain("--as-of");
  });
  it("a bad --as-of is refused: exit 1", () => {
    expect(main([...setup([line()]), "--as-of", "2026-02-30"])).toBe(1);
    expect(errs[0]).toMatch(/^REFUSED: --as-of 2026-02-30 is not a real date/);
  });
  it("a missing copy file: exit 2", () => {
    const argv = setup([line()]);
    rmSync(path.join(dir, "Area.csv"));
    expect(main([...argv, "--as-of", AS_OF])).toBe(2);
    expect(errs[0]).toContain("--area");
  });
  it("no source of sent rows: exit 2", () => {
    const argv = setup([line()]).slice(0, -2);
    expect(main([...argv, "--as-of", AS_OF])).toBe(2);
    expect(errs[0]).toContain("--psql");
  });
  it("a sent file that does not exist: exit 2", () => {
    const argv = setup([line()]);
    rmSync(path.join(dir, "sent.jsonl"));
    expect(main([...argv, "--as-of", AS_OF])).toBe(2);
  });
  it("a corrupt sent line is refused: exit 1", () => {
    const argv = setup([line()]);
    writeFileSync(path.join(dir, "sent.jsonl"), "{bad\n");
    expect(main([...argv, "--as-of", AS_OF])).toBe(1);
    expect(errs[0]).toMatch(/^REFUSED: sent line is not JSON/);
  });
  it("a copy file in the wrong layout is refused: exit 1", () => {
    const argv = setup([line()]);
    writeFileSync(path.join(dir, "Area.csv"), "a,b\r\n1,2\r\n");
    expect(main([...argv, "--as-of", AS_OF])).toBe(1);
    expect(errs[0]).toMatch(/^REFUSED: Area: header does not match/);
  });
  it("never overwrites an existing report or JSON: exit 2, file untouched", () => {
    const rep = path.join(dir, "r.md");
    writeFileSync(rep, "keep me");
    expect(main([...setup([line()]), "--as-of", AS_OF, "--report", rep])).toBe(2);
    expect(readFileSync(rep, "utf8")).toBe("keep me");
    const js = path.join(dir, "r.json");
    writeFileSync(js, "keep");
    expect(main([...setup([line()]), "--as-of", AS_OF, "--json", js])).toBe(2);
    expect(readFileSync(js, "utf8")).toBe("keep");
  });
  it("a flag with no value: exit 2", () => {
    expect(main([...setup([line()]), "--as-of", AS_OF, "--report"])).toBe(2);
    expect(existsSync(path.join(dir, "--report"))).toBe(false);
  });
  it("blank lines in the sent file are ignored", () => {
    const argv = setup([line()]);
    writeFileSync(path.join(dir, "sent.jsonl"), `\n${JSON.stringify(line())}\n\n`);
    expect(main([...argv, "--as-of", AS_OF])).toBe(0);
  });
});

describe("S-16 wiring and guards", () => {
  const CORE = read("src/lib/compliance/ccrs-copy-verify-core.ts");
  const CLI = read("scripts/compliance/verify-ccrs-copy.ts");
  it("the core is pure: no node:, require, clock, network or database", () => {
    expect(/from "node:|require\(|Date\.now\(|new Date\(\)|supabase|fetch\(/.test(CORE)).toBe(false);
  });
  it("the CLI is read-only: one SELECT via psql with ON_ERROR_STOP; writes only new files (wx)", () => {
    expect(CLI).toContain('"-v", "ON_ERROR_STOP=1"');
    expect(CLI).toContain("SENT_READ_SQL");
    expect(CLI).not.toMatch(/insert into|update public|delete from|ccrs_emit_files|ccrs_mark_uploaded|ccrs_record_outcome/i);
    expect(CLI.match(/writeFileSync\(/g)!.length).toBe(2);
    expect(CLI.match(/flag: "wx"/g)!.length).toBe(2);
  });
  it("is registered in the pure self-test runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("ccrs-copy-verify-core", __runCcrsCopyVerifyCoreTests(), 15)');
  });
  it("no migration was added by this slice", () => {
    const migs = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(migs[migs.length - 1]).toBe("0317_little_safe_exchanges.sql");
  });
  it("the bucket counts in the report header match the result", () => {
    const r = run([line(), line({ id: "L9" })]);
    expect(verifyReport(r)).toContain(`Counts: \`${JSON.stringify(r.counts.total)}\``);
  });
});
