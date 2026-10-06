/**
 * S-09 / S-09b — CCRS CSV fidelity, written the way CCRS ACTUALLY reads.
 *
 * Bible v2 Part 05 §F.1 / Part 12 U-25, U-27, U-44. Grounding:
 *   [G L0167-L0169] "Only load .CSV files … Do not add/remove columns."
 *   [G L0580-L0583] Product name must match in "same format and spelling".
 *   [OBS P20261005A] PREprod Product file: the 3 rows that held a comma (inside
 *     RFC 4180 quotes) came back cut at that comma and rejected "Operation is
 *     invalid must be Insert, Update or Delete"; the 5 rows without one raised
 *     no error. Evidence: docs/ccrs-bible/evidence/P20261005A/.
 *
 * So CCRS splits every row on every comma and ignores quoting. The encoder
 * therefore never adds quotes, never changes a character, and refuses a value
 * holding a comma (E42) or line break (E38). A `"` passes through unchanged:
 * PREprod P20261006A (P-04b, 28/28 Success) accepted names holding one and
 * Inventory rows referencing them (S-09c; E43 retired, U-44 CLOSED).
 * Free-text Description/AdjustmentDetail are rewritten instead (E44).
 *
 * The fixture holds REAL values from the LCB CCRS Service Desk delivery of
 * 2026-09-18 (license 413541). Every value without a comma/quote/line break
 * must survive encode → CCRS-split byte-for-byte; the rest must be refused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsCell,
  CcrsEncodeError,
  ccrsFreeText,
  ccrsHasLineBreak,
  ccrsReaderSplit,
  ccrsUnencodableReason,
  CCRS_FREE_TEXT_COLUMNS,
  CCRS_UNENCODABLE_CODE,
  classifyWarning,
  CCRS_COLUMNS,
  freeTextRewriteMessage,
  unencodableMessage,
  verifyCcrsFile,
  withholdUnencodableRows,
} from "@/lib/compliance/ccrs-batch-core";
import { cell as adjustmentCell } from "@/lib/compliance/ccrs-inventory-adjustment-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

type Cat = { distinctInDelivery: number; sample: string[] };
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "ccrs-real-names.json"), "utf8"),
) as { source: string; categories: Record<string, Cat> };
const C = fixture.categories;
const encodable = [...C.tab.sample, ...C.nonascii.sample, ...C.edge_space.sample, ...C.double_space.sample];
const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const evidence = (f: string) => readFileSync(join(root, "docs", "ccrs-bible", "evidence", "P20261005A", f), "utf8");

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
    expect(encodable.length).toBeGreaterThan(50);
    // none of the "encodable" set may carry a character the reader cannot take
    expect(encodable.filter((v) => ccrsUnencodableReason(v) !== null)).toEqual([]);
  });
});

describe("the PREprod evidence this slice rests on (P20261005A)", () => {
  const sent = evidence("SENT_Product_413541_20261005182936.csv").replace(/\r\n$/, "").split("\r\n").slice(4);
  const echo = evidence("Product__20261006T113333390.csv").replace(/\r\n$/, "").split("\r\n");

  it("the sent file was valid RFC 4180: 8 rows, 12 columns each when quotes are honoured", () => {
    expect(sent).toHaveLength(8);
  });

  it("exactly the rows holding a comma were rejected, and CCRS's echo is cut at that comma", () => {
    const withComma = sent.filter((l) => ccrsReaderSplit(l).length !== CCRS_COLUMNS.Product.length);
    expect(withComma).toHaveLength(3);
    expect(echo.slice(1)).toHaveLength(3); // header + 3 rejected rows
    const ids = echo.slice(1).map((l) => l.split(",").find((c) => /^P20261005A-P0\d$/.test(c)));
    expect(ids).toEqual(["P20261005A-P01", "P20261005A-P04", "P20261005A-P07"]);
    for (const l of withComma) expect(ids.some((id) => l.includes(`,${id},`))).toBe(true);
    // the echo carries the name/description split at the comma — CCRS did not honour the quotes
    expect(echo.join("\n")).toContain('"P20261005A Smith, Jane Fidelity - 1g"');
    expect(echo.every((l, i) => i === 0 || l.includes("Operation is invalid must be Insert, Update or Delete"))).toBe(true);
  });

  it("our verifier now rejects that sent file (it would have been caught before upload)", () => {
    const file = evidence("SENT_Product_413541_20261005182936.csv");
    const errs = verifyCcrsFile("Product", file).filter((p) => p.severity === "error");
    expect(errs.filter((e) => /as CCRS reads it/.test(e.message))).toHaveLength(3);
    expect(errs.some((e) => /double quote/.test(e.message))).toBe(false); // S-09c
  });
});

describe("ccrsCell sends every value CCRS can carry byte-for-byte, never adds quotes", () => {
  it.each(encodable.map((v) => [JSON.stringify(v), v]))("round-trips %s", (_l, v) => {
    const enc = ccrsCell(v);
    expect(enc).toBe(v);
    expect(ccrsReaderSplit([ccrsCell("413541"), enc, ccrsCell("x")].join(","))).toEqual(["413541", v, "x"]);
  });

  it("edge spaces, inner spacing, TAB and non-ASCII are sent as they are (no wrapping)", () => {
    expect(ccrsCell("GF41583505706958 ")).toBe("GF41583505706958 ");
    expect(ccrsCell(" lead")).toBe(" lead");
    expect(ccrsCell("a  b")).toBe("a  b");
    expect(ccrsCell("a\tb")).toBe("a\tb");
    expect(ccrsCell("Piña")).toBe("Piña");
    expect(ccrsCell("Blue Dream")).toBe("Blue Dream");
    expect(ccrsCell(12.5)).toBe("12.5");
    expect(ccrsCell(null)).toBe("");
    expect(ccrsCell(undefined)).toBe("");
  });

  it("refuses a comma and CR/LF with CcrsEncodeError naming the reason; a double quote passes through (S-09c)", () => {
    expect(() => ccrsCell("Smith, Jane")).toThrow(CcrsEncodeError);
    expect(() => ccrsCell("Smith, Jane")).toThrow(/comma \(E42\)/);
    for (const v of C.dquote.sample.filter((s) => !/[\r\n]/.test(s))) {
      if (v.includes(",")) expect(() => ccrsCell(v)).toThrow(/comma/);
      else {
        expect(ccrsCell(v)).toBe(v);
        expect(ccrsReaderSplit(["L", ccrsCell(v), "R"].join(","))).toEqual(["L", v, "R"]);
      }
    }
    for (const v of [...C.crlf.sample, "a\r\nb", "a\rb"]) expect(() => ccrsCell(v)).toThrow(/line break \(E38\)/);
  });

  it("reason precedence: line break, then comma; a double quote alone is fine (S-09c)", () => {
    expect(ccrsUnencodableReason('a\n,"')).toBe("line break");
    expect(ccrsUnencodableReason('a,"')).toBe("comma");
    expect(ccrsUnencodableReason('a"')).toBeNull();
    expect(ccrsUnencodableReason("a")).toBeNull();
    expect(ccrsUnencodableReason(null)).toBeNull();
  });

  it("the adjustment-core cell() delegates to the same encoder", () => {
    for (const v of [...encodable, null]) expect(adjustmentCell(v)).toBe(ccrsCell(v));
    expect(() => adjustmentCell("a,b")).toThrow(CcrsEncodeError);
  });
});

describe("assembled files carry the exact spelling and the column count CCRS will see", () => {
  it("Inventory rows with real Product/Strain names pass verifyCcrsFile and split back exactly", () => {
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
    expect(lines.slice(4).map(ccrsReaderSplit)).toEqual(rows);
    expect(csv).not.toContain('"');
    expect(/(^|[^\r])\n/.test(csv)).toBe(false);
  });

  it("verifyCcrsFile flags a hand-made quoted comma that an RFC 4180 parser would accept", () => {
    const good = assembleCcrsFile({ type: "Strain", submittedBy: "G", submittedDate: new Date("2026-01-01T20:00:00Z"), rows: [["413541", "Kush", "Hybrid", "G", "01/01/2026"]] });
    const bad = good.replace("Kush", '"Kush, Blue"');
    const errs = verifyCcrsFile("Strain", bad).filter((p) => p.severity === "error").map((p) => p.message);
    expect(errs.some((m) => /6 column\(s\) as CCRS reads it/.test(m))).toBe(true);
    expect(errs.some((m) => /double quote/.test(m))).toBe(false); // S-09c: the comma is the error, not the quote
  });
});

describe("withholdUnencodableRows — E38 / E42 withhold, E44 free-text rewrite (E43 retired S-09c)", () => {
  const cols = CCRS_COLUMNS.Product;
  const mk = (name: string, desc: string, id: string) => cols.map((c) => (c === "Name" ? name : c === "Description" ? desc : c === "ExternalIdentifier" ? id : "x"));
  const label = (r: string[]) => r[cols.indexOf("ExternalIdentifier")];

  it("ccrsHasLineBreak detects CR and LF only", () => {
    expect(ccrsHasLineBreak("a\nb")).toBe(true);
    expect(ccrsHasLineBreak("a\rb")).toBe(true);
    expect(ccrsHasLineBreak("a\tb")).toBe(false);
    expect(ccrsHasLineBreak(null)).toBe(false);
  });

  it("withholds a comma / line break in a NON-free-text column, names the column and reason, keeps order; a quote row is kept", () => {
    const good = mk("Good", "fine", "GWP-1");
    const out = withholdUnencodableRows(
      [good, mk("Smith, Jane", "d", "GWP-2"), mk('7" Cone', "d", "GWP-3"), mk(C.crlf.sample[0], "d", "GWP-4"), good],
      cols,
      label,
      CCRS_FREE_TEXT_COLUMNS.Product,
    );
    expect(out.rows).toEqual([good, mk('7" Cone', "d", "GWP-3"), good]);
    expect(out.withheld.map((w) => [w.label, w.column, w.reason])).toEqual([
      ["GWP-2", "Name", "comma"],
      ["GWP-4", "Name", "line break"],
    ]);
    expect(() => assembleCcrsFile({ type: "Product", submittedBy: "G", rows: out.rows })).not.toThrow();
  });

  it("rewrites Description (free text) instead of withholding, reports before/after, same length", () => {
    const desc = 'Indoor, hand-trimmed "small batch"';
    const out = withholdUnencodableRows([mk("Blue Dream", desc, "GWP-9")], cols, label, CCRS_FREE_TEXT_COLUMNS.Product);
    expect(out.withheld).toEqual([]);
    expect(out.rows[0][cols.indexOf("Description")]).toBe('Indoor; hand-trimmed "small batch"');
    expect(out.rows[0][cols.indexOf("Description")].length).toBe(desc.length);
    expect(out.rewritten).toEqual([{ label: "GWP-9", column: "Description", before: desc, after: 'Indoor; hand-trimmed "small batch"' }]);
    expect(ccrsFreeText("a,b\"c")).toBe('a;b"c');
    // a quote-only Description is not a rewrite at all
    const q = withholdUnencodableRows([mk("Blue Dream", 'say "hi"', "GWP-8")], cols, label, CCRS_FREE_TEXT_COLUMNS.Product);
    expect(q.rewritten).toEqual([]);
    expect(q.rows[0][cols.indexOf("Description")]).toBe('say "hi"');
  });

  it("does not mutate the caller's rows; a Description with a line break is still withheld (E38)", () => {
    const row = mk("Blue Dream", "a,\nb", "GWP-5");
    const copy = row.slice();
    const out = withholdUnencodableRows([row], cols, label, CCRS_FREE_TEXT_COLUMNS.Product);
    expect(row).toEqual(copy);
    expect(out.rewritten).toEqual([]);
    expect(out.withheld.map((w) => [w.column, w.reason])).toEqual([["Description", "line break"]]);
  });

  it("without a free-text list, a comma in Description withholds (nothing is rewritten silently)", () => {
    const out = withholdUnencodableRows([mk("Blue Dream", "a,b", "GWP-6")], cols, label);
    expect(out.rewritten).toEqual([]);
    expect(out.withheld.map((w) => w.reason)).toEqual(["comma"]);
  });

  it("free-text columns are exactly Product.Description and InventoryAdjustment.AdjustmentDetail — never a join key", () => {
    expect(CCRS_FREE_TEXT_COLUMNS).toEqual({ Product: ["Description"], InventoryAdjustment: ["AdjustmentDetail"] });
    for (const [type, list] of Object.entries(CCRS_FREE_TEXT_COLUMNS)) {
      for (const c of list ?? []) {
        expect(CCRS_COLUMNS[type as keyof typeof CCRS_COLUMNS]).toContain(c);
        expect(c).not.toMatch(/Name|Strain|Area|Product$|Identifier|Date|License/);
      }
    }
  });

  it("the withhold message is BLOCKING, groups by reason, caps at 10 per reason; the rewrite message is advisory", () => {
    const one = unencodableMessage("Product", [{ label: "GWP-2", column: "Name", reason: "comma" }]);
    expect(classifyWarning(one)).toBe("error");
    expect(one).toContain("GWP-2 (Name)");
    expect(one).toContain("CCRS splits every row on every comma");
    expect(one).toContain("Remove the comma");
    const lb = unencodableMessage("Product", [{ label: "GWP-4", column: "Name" }]);
    expect(lb).toContain("Remove the line break");
    const many = unencodableMessage("Product", Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, column: "Name", reason: "comma" as const })));
    expect(many).toContain("12 Product row(s)");
    expect(many).toContain("L9 (Name)");
    expect(many).not.toContain("L10 (Name)");
    expect(many).toContain("and 2 more");
    expect(many).toContain("Remove the comma");
    expect(many).not.toMatch(/double quote/);
    const rw = freeTextRewriteMessage("Product", [{ label: "GWP-9", column: "Description", before: "a,b", after: "a;b" }]);
    expect(classifyWarning(rw)).not.toBe("error");
    expect(rw).toContain("GWP-9 (Description)");
  });

  it("E38 / E42 / E43 (retired, still registered for stored issues) / E44 are registered preflight codes pinned to the CSV rule", () => {
    for (const code of ["E38_FIELD_HAS_LINE_BREAK", "E42_FIELD_HAS_COMMA", "E43_FIELD_HAS_DOUBLE_QUOTE", "E44_FREE_TEXT_REWRITTEN"] as const) {
      expect(CCRS_ISSUE_CODES).toContain(code);
      expect(specPinFor(code)).toBe("[G L0167-L0169]");
    }
    expect(CCRS_UNENCODABLE_CODE).toEqual({ "line break": "E38_FIELD_HAS_LINE_BREAK", comma: "E42_FIELD_HAS_COMMA" });
    // nothing emits E43 any more (S-09c)
    for (const p of ["src/lib/compliance/ccrs-batch.ts", "src/lib/compliance/ccrs-batch-core.ts", "src/lib/compliance/ccrs-sales.ts", "src/lib/compliance/ccrs-inventory-adjustment.ts"]) {
      expect(src(p)).not.toContain("E43_FIELD_HAS_DOUBLE_QUOTE");
    }
  });
});

describe("wiring guard — every production builder withholds before encoding", () => {
  it("batch push(), sales, adjustment and sale-correction route all call withholdUnencodableRows", () => {
    const batch = src("src/lib/compliance/ccrs-batch.ts");
    const pushBody = batch.slice(batch.indexOf("const push = ("), batch.indexOf("files.push({", batch.indexOf("const push = (")));
    expect(pushBody).toContain("withholdUnencodableRows(");
    expect(pushBody).toContain("CCRS_FREE_TEXT_COLUMNS[type] ?? []");
    expect(pushBody).toContain("CCRS_UNENCODABLE_CODE[reason]");
    expect(pushBody).toContain('"E44_FREE_TEXT_REWRITTEN"');
    expect(pushBody).toContain("const rows = e38.rows;");
    expect(pushBody.match(/\brawRows\b/g)?.length).toBe(2);
    expect(batch).toMatch(/assembleCcrsFile\(\{ type, submittedBy, submittedDate: now, rows \}\)/);

    const sales = src("src/lib/compliance/ccrs-sales.ts");
    expect(sales).toMatch(/withholdUnencodableRows\(rows, CCRS_COLUMNS\.Sale/);
    expect(sales).toContain('indexOf("SaleDetailExternalIdentifier")');
    expect(sales).toContain("buildFile(e38.rows, license)");
    expect(sales).toContain("warnings.push(unencodableMessage(");

    const adj = src("src/lib/compliance/ccrs-inventory-adjustment.ts");
    expect(adj).toMatch(/withholdUnencodableRows\(\s*rows,\s*CCRS_COLUMNS\.InventoryAdjustment/);
    expect(adj).toContain("CCRS_FREE_TEXT_COLUMNS.InventoryAdjustment");
    expect(adj).toContain("buildAdjustmentFile(e38.rows, license)");
    expect(adj).toContain("result.warnings.push(unencodableMessage(");
    expect(adj).toContain("result.warnings.push(freeTextRewriteMessage(");

    const route = src("src/app/admin/inventory/disposition/sale-correction-export/route.ts");
    expect(route).toMatch(/withholdUnencodableRows\(rows, CCRS_COLUMNS\.Sale/);
    expect(route).toContain("buildSaleCorrectionFile(e38.rows, license)");
    expect(route).toContain("markCorrectionsExported(exportIds)");
    expect(route).not.toContain("markCorrectionsExported(includedIds)");
  });

  it("no CCRS encoder strips double quotes, and none adds RFC 4180 quoting any more", () => {
    for (const p of [
      "src/lib/compliance/ccrs-batch-core.ts",
      "src/lib/compliance/ccrs-inventory-adjustment-core.ts",
      "src/lib/compliance/ccrs-sale-correction-core.ts",
      "src/lib/compliance/ccrs-sales.ts",
    ]) {
      expect(src(p)).not.toMatch(/replace\(\/"\/g,\s*""\)/);
    }
    expect(src("src/lib/compliance/ccrs-batch-core.ts")).not.toContain("needsQuotes");
  });

  it("the old line-break-only helpers are gone (one withhold path, no stale caller)", () => {
    for (const p of ["src/lib/compliance/ccrs-batch.ts", "src/lib/compliance/ccrs-sales.ts", "src/lib/compliance/ccrs-inventory-adjustment.ts", "src/app/admin/inventory/disposition/sale-correction-export/route.ts", "src/lib/compliance/ccrs-batch-core.ts"]) {
      expect(src(p)).not.toMatch(/withholdLineBreakRows|e38Message/);
    }
  });
});
