/**
 * S-09 — CCRS CSV fidelity (RFC 4180, lossless) + E38 line-break withholding.
 *
 * Bible v2 Part 05 §F.1 / Part 12 U-25. Grounding:
 *   [G L0167-L0169] "Only load .CSV files … Do not add/remove columns."
 *   [G L0580-L0583] Product name must match in "same format and spelling".
 *
 * The fixture holds REAL values from the LCB CCRS Service Desk delivery of
 * 2026-09-18 (license 413541): names CCRS already stores with literal double
 * quotes, TABs, mojibake, edge spaces, double spaces and line breaks. The old
 * encoder STRIPPED double quotes, so 14 live Inventory rows could never be
 * referenced in the exact spelling CCRS holds. These tests prove every one of
 * those values now survives encode → parse byte-for-byte, and that line-break
 * values are withheld (reported, never sent corrupted, never silently lost).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsCell,
  CcrsEncodeError,
  ccrsHasLineBreak,
  classifyWarning,
  CCRS_COLUMNS,
  e38Message,
  splitCsvLine,
  verifyCcrsFile,
  withholdLineBreakRows,
} from "@/lib/compliance/ccrs-batch-core";
import { cell as adjustmentCell } from "@/lib/compliance/ccrs-inventory-adjustment-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

type Cat = { distinctInDelivery: number; sample: string[] };
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "ccrs-real-names.json"), "utf8"),
) as { source: string; categories: Record<string, Cat> };
const C = fixture.categories;
const encodable = [
  ...C.dquote.sample,
  ...C.tab.sample,
  ...C.nonascii.sample,
  ...C.edge_space.sample,
  ...C.double_space.sample,
];
const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("fixture integrity (the test of the tests)", () => {
  it("holds the real categories with the counts measured from the delivery", () => {
    expect(C.dquote.distinctInDelivery).toBe(17);
    expect(C.dquote.sample.length).toBe(17);
    expect(C.dquote.sample.every((s) => s.includes('"'))).toBe(true);
    expect(C.tab.sample.length).toBe(2);
    expect(C.tab.sample.every((s) => s.includes("\t"))).toBe(true);
    expect(C.crlf.sample.length).toBe(2);
    expect(C.crlf.sample.every((s) => /[\r\n]/.test(s))).toBe(true);
    expect(C.nonascii.sample.every((s) => /[^\x00-\x7f]/.test(s))).toBe(true);
    expect(C.edge_space.sample.every((s) => s !== s.trim())).toBe(true);
    expect(C.double_space.sample.every((s) => s.includes("  "))).toBe(true);
    expect(C.comma.distinctInDelivery).toBe(0);
    expect(encodable.length).toBeGreaterThan(60);
  });
});

describe("ccrsCell is lossless for every real CCRS value (U-25)", () => {
  it.each(encodable.map((v) => [JSON.stringify(v), v]))("round-trips %s", (_l, v) => {
    const enc = ccrsCell(v);
    expect(splitCsvLine(enc)).toEqual([v]);
    // A whole row of the same value also survives with its neighbours intact.
    expect(splitCsvLine([ccrsCell("413541"), enc, ccrsCell("x")].join(","))).toEqual(["413541", v, "x"]);
  });

  it("quotes are doubled, never stripped", () => {
    expect(ccrsCell('"Bubba\'s Gift"')).toBe('"""Bubba\'s Gift"""');
    expect(ccrsCell('a"b')).toBe('"a""b"');
  });

  it("edge spaces are protected by quoting; inner spacing, TAB and non-ASCII untouched", () => {
    expect(ccrsCell("GF41583505706958 ")).toBe('"GF41583505706958 "');
    expect(ccrsCell(" lead")).toBe('" lead"');
    expect(ccrsCell("a  b")).toBe("a  b");
    expect(ccrsCell("a\tb")).toBe("a\tb");
    expect(ccrsCell("Piña")).toBe("Piña");
  });

  it("commas are quoted; plain values and null are emitted bare", () => {
    expect(ccrsCell("Smith, Jane")).toBe('"Smith, Jane"');
    expect(ccrsCell("Blue Dream")).toBe("Blue Dream");
    expect(ccrsCell(12.5)).toBe("12.5");
    expect(ccrsCell(null)).toBe("");
    expect(ccrsCell(undefined)).toBe("");
  });

  it("refuses CR/LF with CcrsEncodeError (the E38 tripwire)", () => {
    for (const v of [...C.crlf.sample, "a\r\nb", "a\rb"]) {
      expect(() => ccrsCell(v)).toThrow(CcrsEncodeError);
    }
  });

  it("the adjustment-core cell() delegates to the same encoder", () => {
    for (const v of [...encodable, "a,b", null]) expect(adjustmentCell(v)).toBe(ccrsCell(v));
  });
});

describe("assembled files carry the exact spelling CCRS holds", () => {
  it("Inventory rows with real Product/Strain names pass verifyCcrsFile and parse back exactly", () => {
    const cols = CCRS_COLUMNS.Inventory;
    const rows = encodable.map((name, i) => {
      const r = cols.map(() => "");
      r[cols.indexOf("LicenseNumber")] = "413541";
      r[cols.indexOf("Strain")] = name;
      r[cols.indexOf("Area")] = "Sales Floor";
      r[cols.indexOf("Product")] = name;
      r[cols.indexOf("InitialQuantity")] = "1";
      r[cols.indexOf("QuantityOnHand")] = "1";
      r[cols.indexOf("TotalCost")] = "1.00";
      r[cols.indexOf("IsMedical")] = "FALSE";
      r[cols.indexOf("ExternalIdentifier")] = `GWL-20260101-${String(i + 1).padStart(6, "0")}`;
      r[cols.indexOf("CreatedBy")] = "Greenway";
      r[cols.indexOf("CreatedDate")] = "01/01/2026";
      r[cols.indexOf("Operation")] = "Insert";
      return r;
    });
    const csv = assembleCcrsFile({ type: "Inventory", submittedBy: "Greenway", submittedDate: new Date("2026-01-01T20:00:00Z"), rows });
    expect(verifyCcrsFile("Inventory", csv).filter((p) => p.severity === "error")).toEqual([]);
    const lines = csv.replace(/\r\n$/, "").split("\r\n");
    expect(lines.length).toBe(4 + rows.length);
    expect(lines.slice(4).map(splitCsvLine)).toEqual(rows);
    // CRLF only — no bare LF anywhere (a bare LF would split a record).
    expect(/(^|[^\r])\n/.test(csv)).toBe(false);
  });
});

describe("E38 — rows with a line break are withheld and reported", () => {
  const cols = CCRS_COLUMNS.Product;
  const good = cols.map((c) => (c === "Name" ? "Good" : c === "ExternalIdentifier" ? "GWP-1" : "x"));
  const bad = cols.map((c) => (c === "Name" ? C.crlf.sample[0] : c === "ExternalIdentifier" ? "GWP-2" : "x"));

  it("ccrsHasLineBreak detects CR and LF only", () => {
    expect(ccrsHasLineBreak("a\nb")).toBe(true);
    expect(ccrsHasLineBreak("a\rb")).toBe(true);
    expect(ccrsHasLineBreak("a\tb")).toBe(false);
    expect(ccrsHasLineBreak(null)).toBe(false);
  });

  it("splits rows, names the column, keeps order, and the result assembles cleanly", () => {
    const out = withholdLineBreakRows([good, bad, good], cols, (r) => r[cols.indexOf("ExternalIdentifier")]);
    expect(out.rows).toEqual([good, good]);
    expect(out.withheld).toEqual([{ label: "GWP-2", column: "Name", value: C.crlf.sample[0] }]);
    expect(() => assembleCcrsFile({ type: "Product", submittedBy: "G", rows: out.rows })).not.toThrow();
    expect(() => assembleCcrsFile({ type: "Product", submittedBy: "G", rows: [bad] })).toThrow(CcrsEncodeError);
  });

  it("the operator message is BLOCKING, names every row (capped at 10), and says what to do", () => {
    const one = e38Message("Product", [{ label: "GWP-2", column: "Name" }]);
    expect(classifyWarning(one)).toBe("error");
    expect(one).toContain("GWP-2 (Name)");
    expect(one).toContain("Remove the line break");
    const many = e38Message("Product", Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, column: "Name" })));
    expect(many).toContain("12 Product row(s)");
    expect(many).toContain("L9 (Name)");
    expect(many).not.toContain("L10 (Name)");
    expect(many).toContain("and 2 more");
  });

  it("E38 is a registered preflight code pinned to the CSV rule", () => {
    expect(CCRS_ISSUE_CODES).toContain("E38_FIELD_HAS_LINE_BREAK");
    expect(specPinFor("E38_FIELD_HAS_LINE_BREAK")).toBe("[G L0167-L0169]");
  });
});

describe("wiring guard — every production builder withholds before encoding", () => {
  it("batch push(), sales, adjustment and sale-correction route all call withholdLineBreakRows", () => {
    const batch = src("src/lib/compliance/ccrs-batch.ts");
    const pushBody = batch.slice(batch.indexOf("const push = ("), batch.indexOf("files.push({", batch.indexOf("const push = (")));
    expect(pushBody).toContain("withholdLineBreakRows(rawRows");
    expect(pushBody).toContain('"E38_FIELD_HAS_LINE_BREAK"');
    // The rows that reach the encoder are the withheld-filtered rows, and the
    // raw rows are used ONLY as the withhold input (param + one call).
    expect(pushBody).toContain("const rows = e38.rows;");
    expect(pushBody.match(/\brawRows\b/g)?.length).toBe(2);
    expect(batch).toMatch(/assembleCcrsFile\(\{ type, submittedBy, submittedDate: now, rows \}\)/);

    const sales = src("src/lib/compliance/ccrs-sales.ts");
    expect(sales).toMatch(/withholdLineBreakRows\(rows, CCRS_COLUMNS\.Sale/);
    expect(sales).toContain('indexOf("SaleDetailExternalIdentifier")');
    expect(sales).toContain("buildFile(e38.rows, license)");
    expect(sales).toContain("warnings.push(e38Message(");

    const adj = src("src/lib/compliance/ccrs-inventory-adjustment.ts");
    expect(adj).toMatch(/withholdLineBreakRows\(rows, CCRS_COLUMNS\.InventoryAdjustment/);
    expect(adj).toContain("buildAdjustmentFile(e38.rows, license)");
    expect(adj).toContain("result.warnings.push(e38Message(");

    const route = src("src/app/admin/inventory/disposition/sale-correction-export/route.ts");
    expect(route).toMatch(/withholdLineBreakRows\(rows, CCRS_COLUMNS\.Sale/);
    expect(route).toContain("buildSaleCorrectionFile(e38.rows, license)");
    // Withheld corrections must stay pending, never marked exported.
    expect(route).toContain("markCorrectionsExported(exportIds)");
    expect(route).not.toContain("markCorrectionsExported(includedIds)");
  });

  it("no CCRS encoder anywhere strips double quotes any more", () => {
    for (const p of [
      "src/lib/compliance/ccrs-batch-core.ts",
      "src/lib/compliance/ccrs-inventory-adjustment-core.ts",
      "src/lib/compliance/ccrs-sale-correction-core.ts",
      "src/lib/compliance/ccrs-sales.ts",
    ]) {
      expect(src(p)).not.toMatch(/replace\(\/"\/g,\s*""\)/);
    }
  });
});
