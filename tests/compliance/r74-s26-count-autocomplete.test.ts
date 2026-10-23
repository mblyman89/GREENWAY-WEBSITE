/**
 * R74 S26 (round 12): "A few of the laptops that we will use for the count are
 * Mac's, and they do not have the setting for disabling autocomplete for cells.
 * Can you add this feature in programmatically?"
 *
 * AutoComplete is an Excel application setting (no .xlsx can switch it off), so
 * the defence is built into the workbook and the upload: the Mac menu path is
 * printed, prefix barcodes are routed to Hand Count, and the upload re-plays
 * AutoComplete's rules and leaves every barcode it could have changed alone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  __runCountAutocompleteCoreTests,
  autocompleteRisks,
  prefixBarcodes,
  scanSheetCandidates,
  uncountedPrefixRisks,
} from "@/lib/pos/count-autocomplete-core";
import { COUNT_WORKBOOK_SPEC as S, mergeCountWorkbooks, parseCountWorkbook, planCount, rollupSales, type CellGrid } from "@/lib/pos/cultivera-count-core";

const CORE = readFileSync("src/lib/pos/count-autocomplete-core.ts", "utf8");
const RUNNER = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
const PAGE = readFileSync("src/app/admin/menu-imports/count/page.tsx", "utf8");
const STORE = readFileSync("src/lib/pos/cultivera-count-store.ts", "utf8");

// The measured Cultivera shapes: "1" and "RoyalBlunt" are the start of longer barcodes.
const LIST = [
  { barcode: "1", productName: "Pastime Accessories", storage: "Floor" },
  { barcode: "100270836", productName: "Lighter", storage: "Floor" },
  { barcode: "RoyalBlunt", productName: "Royal Blunts Blunt 20", storage: "Floor" },
  { barcode: "RoyalBluntWrap", productName: "Royal Blunt Wrap", storage: "Floor" },
  { barcode: "1111111111111111", productName: "Blue Dream 3.5g", storage: "Vault" },
];

const meta = (id: string): CellGrid => [
  ["format", S.format],
  ["workbook_id", id],
  ["counter", "Ana"],
  ["count_date", "2026-10-30"],
  ["generated_at", "2026-10-29T10:00:00Z"],
  ["lots_from_import", "imp-1"],
];
const book = (scan: string[], hand: [string, string][] = [], id = "w1") =>
  parseCountWorkbook({
    fileName: `${id}.xlsx`,
    sha256: id,
    cells: {
      sheets: {
        [S.metaSheet]: meta(id),
        [S.scanSheet]: [[S.scanHeader], ...scan.map((c) => [c])],
        [S.handSheet]: [[...S.handHeaders], ...hand.map(([c, q]) => [c, q, ""])],
        [S.lotsSheet]: [["Barcode", "Product", "Storage"], ...LIST.map((l) => [l.barcode, l.productName, l.storage])],
      },
    },
  });
const lots = LIST.map((l, i) => ({ lotId: `L${i}`, lotCode: l.barcode, productName: l.productName, onHand: 5 }));
const noSales = rollupSales([], { salesDay: "2026-10-31" });

describe("R74 S26 count AutoComplete defence", () => {
  it("self-tests: exact count, runner floor 26, pure", () => {
    expect(__runCountAutocompleteCoreTests()).toEqual({ passed: 26, failed: 0 });
    expect(RUNNER).toMatch(
      /\{ const r = __runCountAutocompleteCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 26\) throw new Error\([^\n]*\} \/\/ R74 S26/,
    );
    expect(CORE).not.toContain("process" + ".env");
    expect(CORE).not.toMatch(/^import /m);
  });

  it("prefixBarcodes finds exactly the measured pairs", () => {
    expect(prefixBarcodes(LIST.map((l) => l.barcode))).toEqual([
      { prefix: "1", longer: ["100270836", "1111111111111111"] },
      { prefix: "RoyalBlunt", longer: ["RoyalBluntWrap"] },
    ]);
  });

  it("a clean count (prefixes on Hand Count, normal repeats scanned) has no warnings and adjusts normally", () => {
    const b = book(["100270836", "100270836", "RoyalBluntWrap", "RoyalBluntWrap", "1111111111111111"], [["1", "4"], ["RoyalBlunt", "0"]]);
    expect(b.problems).toEqual([]);
    expect(b.autocompleteRisk.size).toBe(0);
    const m = mergeCountWorkbooks([b]);
    const plan = planCount({ lots, counted: m.counted, sales: noSales, problems: m.problems, autocompleteRisk: m.autocompleteRisk });
    expect(plan.summary.autocompleteRisk).toBe(0);
    expect(plan.lines.find((l) => l.lotCode === "1")).toMatchObject({ counted: 4, exception: null, adjust: true });
    expect(plan.lines.find((l) => l.lotCode === "RoyalBluntWrap")).toMatchObject({ counted: 2, exception: null });
  });

  it("a prefix scanned on the Scan sheet: the repeats that follow are warned and both barcodes left alone", () => {
    const b = book(["RoyalBluntWrap", "RoyalBlunt", "RoyalBluntWrap"], [["1", "1"]]);
    const w = b.problems.filter((p) => p.code === "autocomplete_risk");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "warning", sheet: "Scan", row: 4, value: "RoyalBluntWrap" });
    expect(w[0].message).toMatch(/could be a scan of "RoyalBlunt"/);
    const m = mergeCountWorkbooks([b]);
    expect([...m.autocompleteRisk].sort()).toEqual(["royalblunt", "royalbluntwrap"]);
    const plan = planCount({ lots, counted: m.counted, sales: noSales, problems: m.problems, autocompleteRisk: m.autocompleteRisk });
    for (const code of ["RoyalBlunt", "RoyalBluntWrap"]) {
      expect(plan.lines.find((l) => l.lotCode === code)).toMatchObject({ exception: "autocomplete_risk", adjust: false, delta: 0 });
    }
    expect(plan.summary.autocompleteRisk).toBe(2);
    expect(plan.blocked).toBe(false); // a warning: the rest of the count still applies
  });

  it("a prefix nobody counted while a longer one was: both left alone (the completion leaves no trace)", () => {
    const b = book(["100270836", "1111111111111111"], [["RoyalBlunt", "0"]]);
    expect(b.problems).toEqual([]);
    const m = mergeCountWorkbooks([b]);
    const plan = planCount({ lots, counted: m.counted, sales: noSales, problems: m.problems, autocompleteRisk: m.autocompleteRisk });
    for (const code of ["1", "100270836", "1111111111111111"]) {
      expect(plan.lines.find((l) => l.lotCode === code)?.exception).toBe("autocomplete_risk");
    }
    expect(plan.lines.find((l) => l.lotCode === "RoyalBluntWrap")?.exception).toBe("uncounted");
    expect(uncountedPrefixRisks(LIST.map((l) => l.barcode), new Set(["1", "100270836"]))).toEqual([]);
  });

  it("Hand Count: a typed prefix completed to a row above is warned", () => {
    const b = book([], [["RoyalBluntWrap", "3"], ["RoyalBluntWrap", "2"], ["1", "0"]]);
    expect(b.problems.filter((p) => p.code === "autocomplete_risk").map((p) => [p.sheet, p.row])).toEqual([["Hand Count", 3]]);
  });

  it("scanSheetCandidates and autocompleteRisks agree with Excel's blank-row stop", () => {
    const col = ["RoyalBluntWrap", "RoyalBlunt", "", "RoyalBluntWrap", "RoyalBluntWrap"];
    const { candidates, scannedPrefixes } = scanSheetCandidates(col, ["1", "RoyalBlunt"]);
    expect(scannedPrefixes).toEqual(["RoyalBlunt"]);
    expect(autocompleteRisks(col, candidates, 2).map((h) => h.row)).toEqual([6]);
  });

  it("the downloaded workbook prints the Mac path and lists the prefix items for Hand Count; still Excel-clean and parses", { timeout: 60_000 }, async () => {
    const { buildCountWorkbook, workbookCells, xlsxParts } = await import("@/lib/pos/cultivera-count-workbook");
    const { xlsxStructureProblems } = await import("@/lib/pos/xlsx-structure-core");
    const out = await buildCountWorkbook({ counter: "Ana", countDate: "2026-10-30", lots: LIST, lotsSource: "run-x", workbookId: "627e354e-0000-4000-8000-000000000026" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.getWorksheet("Start Here")!.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ""))));
    const all = text.join("\n");
    expect(all).toContain("Mac: Excel menu › Preferences › AutoComplete (under Formulas and Lists) › clear “Enable AutoComplete for cell values”");
    expect(all).toContain("Windows: File › Options › Advanced");
    expect(all).toMatch(/Count these 2 item\(s\) on the Hand Count sheet/);
    expect(all).toContain("1  —  Pastime Accessories");
    expect(all).toContain("RoyalBlunt  —  Royal Blunts Blunt 20");
    expect(all).toMatch(/upload re-checks every Scan and Hand Count column/);
    expect(xlsxStructureProblems(await xlsxParts(out.buffer))).toEqual([]);
    // a counter's save with an AutoComplete pattern is caught after the real round trip
    const scan = wb.getWorksheet("Scan")!;
    ["RoyalBluntWrap", "RoyalBlunt", "RoyalBluntWrap"].forEach((c, i) => (scan.getCell(i + 2, 1).value = c));
    const saved = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = parseCountWorkbook({ fileName: "a.xlsx", sha256: "s", cells: await workbookCells(saved) });
    expect(parsed.problems.map((p) => [p.code, p.row])).toEqual([["autocomplete_risk", 4]]);
  });

  it("no prefix barcodes: the workbook adds no Hand Count list", { timeout: 60_000 }, async () => {
    const { buildCountWorkbook } = await import("@/lib/pos/cultivera-count-workbook");
    const out = await buildCountWorkbook({ counter: "Ana", countDate: "2026-10-30", lots: [LIST[4]], lotsSource: "run-x" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.getWorksheet("Start Here")!.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ""))));
    expect(text.join("\n")).not.toMatch(/Count these/);
  });

  it("wiring: the preview passes the risk set to the plan; the page explains the exception", () => {
    expect(STORE).toContain("autocompleteRisk: merged.autocompleteRisk })");
    expect(PAGE).toMatch(/autocomplete_risk: "Excel AutoComplete could have turned a scan/);
  });
});
