/**
 * R74 S16 — the Oct 30 count workbook opens in Excel with NO repair prompt.
 *
 * Owner report (Mac Excel): "We found a problem with some content in 'greenway-count-…xlsx'…" then
 * "Repaired Part: /xl/worksheets/sheet2.xml part with XML error. HRESULT 0x8000ffff".
 * sheet2 = the Scan sheet. Root cause: exceljs 4.4 has no "beginsWith" conditional-format type, so
 * the red "NOT IN CULTIVERA" rule was written as an EMPTY <conditionalFormatting sqref="B2:B5001"/>
 * — illegal in the OOXML schema (CT_ConditionalFormatting needs ≥1 cfRule). Forgiving readers
 * (xlsx, LibreOffice, exceljs) never noticed, so no earlier test could.
 *
 * Pins:
 *   1. The real workbook passes the Excel-strict structure check, on every part and every sheet.
 *   2. The Scan sheet's rule is a real <cfRule type="expression"> with the exact formula, and its
 *      dxf (bold red font) exists in styles.xml.
 *   3. The OLD rule shape, written by the same exceljs, is caught by the check (proves the check
 *      sees the bug the owner hit, not just a synthetic string).
 *   4. The builder fails closed: if the check reports a problem, no workbook is returned.
 *   5. Behaviour the counters rely on is unchanged (sheet order, frozen header, unlocked inputs,
 *      lookup formula, Hand Count validation, hidden Lots / very hidden Meta).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import { xlsxStructureProblems, scanTags, attr, __runXlsxStructureCoreTests } from "@/lib/pos/xlsx-structure-core";

const LOTS = [
  { barcode: "1234567890123456", productName: "Blue Dream 3.5g", storage: "Vault" },
  { barcode: "6543210987654321", productName: "=Not a formula & <tag> \"quoted\"", storage: "Floor" },
  { barcode: "6543210987654321", productName: "dup", storage: "Back" },
  { barcode: "ABC-0001", productName: "Glass — pipe ™", storage: "" },
];

async function build() {
  const { buildCountWorkbook, xlsxParts } = await import("@/lib/pos/cultivera-count-workbook");
  const out = await buildCountWorkbook({ counter: "Michael", countDate: "2026-10-30", lots: LOTS, lotsSource: "run-1", workbookId: "627e354e-0000-4000-8000-000000000000" });
  return { out, parts: await xlsxParts(out.buffer) };
}

function sheetPartFor(parts: Record<string, string>, name: string): string {
  const wb = parts["xl/workbook.xml"];
  const rels = parts["xl/_rels/workbook.xml.rels"];
  const sheet = new RegExp(`<sheet [^>]*name="${name}"[^>]*r:id="([^"]+)"`).exec(wb);
  expect(sheet, `sheet ${name} in workbook.xml`).not.toBeNull();
  const rel = new RegExp(`<Relationship [^>]*Id="${sheet![1]}"[^>]*Target="([^"]+)"`).exec(rels) ?? new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${sheet![1]}"`).exec(rels);
  expect(rel).not.toBeNull();
  return "xl/" + rel![1].replace(/^\/?xl\//, "");
}

afterEach(() => {
  vi.doUnmock("@/lib/pos/xlsx-structure-core");
  vi.resetModules();
});

describe("R74 S16 count workbook — Excel-strict structure", () => {
  it("the real workbook has no structure problems in any part", { timeout: 60_000 }, async () => {
    const { parts } = await build();
    const names = Object.keys(parts);
    expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/sharedStrings.xml"]));
    expect(names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toHaveLength(5);
    expect(xlsxStructureProblems(parts)).toEqual([]);
  });

  it("Scan (sheet2, the part Excel repaired) has exactly one real expression rule with a bold-red dxf", { timeout: 60_000 }, async () => {
    const { parts } = await build();
    const { NOT_IN_CULTIVERA_CF_FORMULA } = await import("@/lib/pos/cultivera-count-workbook");
    const scanPart = sheetPartFor(parts, "Scan");
    expect(scanPart).toBe("xl/worksheets/sheet2.xml");
    const xml = parts[scanPart];
    expect(xml).not.toMatch(/<conditionalFormatting[^>]*\/>/);
    const cf = xml.match(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g) ?? [];
    expect(cf).toHaveLength(1);
    expect(attr(/<conditionalFormatting\b([^>]*)>/.exec(cf[0] ?? "")![1] ?? "", "sqref")).toBe("B2:B5001");
    const rule = /<cfRule\b([^>]*)>([\s\S]*?)<\/cfRule>/.exec(cf[0] ?? "")!;
    const ruleAttrs = rule[1] ?? "";
    expect(attr(ruleAttrs, "type")).toBe("expression");
    expect(attr(ruleAttrs, "priority")).toBe("1");
    const formula = /<formula>([\s\S]*?)<\/formula>/.exec(rule[2] ?? "")![1]!.replace(/&quot;/g, '"');
    expect(formula).toBe(NOT_IN_CULTIVERA_CF_FORMULA);
    expect(formula).toBe('LEFT(B2,16)="NOT IN CULTIVERA"');
    expect("NOT IN CULTIVERA".length).toBe(16);
    // the not-found text the lookup writes starts with exactly that prefix
    expect(xml).toContain("NOT IN CULTIVERA — set aside");
    const dxfId = Number(attr(ruleAttrs, "dxfId"));
    const dxfs = /<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(parts["xl/styles.xml"])![1].match(/<dxf>[\s\S]*?<\/dxf>/g)!;
    expect(dxfs[dxfId]).toContain("<b/>");
    expect(dxfs[dxfId]).toContain('rgb="FFC00000"');
  });

  it("the OLD beginsWith rule shape, written by the same exceljs, is caught (the owner's exact error)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scan");
    ws.getCell("B2").value = "x";
    ws.addConditionalFormatting({
      ref: "B2:B5001",
      rules: [{ type: "beginsWith", operator: "beginsWith", text: "NOT IN CULTIVERA", priority: 1, style: { font: { bold: true } } } as unknown as ExcelJS.ConditionalFormattingRule],
    });
    const { xlsxParts } = await import("@/lib/pos/cultivera-count-workbook");
    const parts = await xlsxParts(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parts["xl/worksheets/sheet1.xml"]).toContain('<conditionalFormatting sqref="B2:B5001"/>');
    const problems = xlsxStructureProblems(parts);
    expect(problems.some((p) => p.includes("xl/worksheets/sheet1.xml") && p.includes("is empty (no <cfRule>)"))).toBe(true);
  });

  it("the builder fails closed when the structure check reports a problem", { timeout: 60_000 }, async () => {
    vi.resetModules();
    vi.doMock("@/lib/pos/xlsx-structure-core", async (orig) => ({
      ...(await orig<typeof import("@/lib/pos/xlsx-structure-core")>()),
      xlsxStructureProblems: () => ["xl/worksheets/sheet2.xml: injected"],
    }));
    const { buildCountWorkbook } = await import("@/lib/pos/cultivera-count-workbook");
    await expect(buildCountWorkbook({ counter: "M", countDate: "2026-10-30", lots: LOTS, lotsSource: "r" })).rejects.toThrow(
      /failed its Excel structure check: xl\/worksheets\/sheet2\.xml: injected/,
    );
  });

  it("counter-facing behaviour is unchanged", { timeout: 60_000 }, async () => {
    const { out, parts } = await build();
    const wb = parts["xl/workbook.xml"];
    expect([...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Start Here", "Scan", "Hand Count", "Lots", "Meta"]);
    expect(wb).toMatch(/name="Lots" state="hidden"/);
    expect(wb).toMatch(/name="Meta" state="veryHidden"/);
    expect(wb).toMatch(/activeTab="1"/);
    const scan = parts["xl/worksheets/sheet2.xml"];
    expect(scan).toMatch(/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    expect(scan).toMatch(/<sheetProtection [^>]*sheet="1"/);
    expect(scan).toContain("<f>IF(A2=&quot;&quot;,&quot;&quot;,IFERROR(INDEX(&apos;Lots&apos;!$B$2:$B$4,MATCH(A2,&apos;Lots&apos;!$A$2:$A$4,0))");
    const hand = parts["xl/worksheets/sheet3.xml"];
    expect(hand).toMatch(/<dataValidations count="1"><dataValidation type="whole"[^>]*sqref="B2:B301"><formula1>0<\/formula1><formula2>100000<\/formula2>/);
    // inputs stay unlocked after a load (what Excel sees)
    const x = new ExcelJS.Workbook();
    await x.xlsx.load(out.buffer as unknown as ArrayBuffer);
    expect(x.getWorksheet("Scan")!.getCell("A2").protection?.locked).toBe(false);
    expect(x.getWorksheet("Scan")!.getCell("B2").protection?.locked).not.toBe(false);
    expect(x.getWorksheet("Hand Count")!.getCell("B2").protection?.locked).toBe(false);
  });

  it("after a counter's save (scans written, file re-saved) it is still structurally clean and still parses", { timeout: 60_000 }, async () => {
    const { out } = await build();
    const { xlsxParts, workbookCells } = await import("@/lib/pos/cultivera-count-workbook");
    const { parseCountWorkbook } = await import("@/lib/pos/cultivera-count-core");
    const x = new ExcelJS.Workbook();
    await x.xlsx.load(out.buffer as unknown as ArrayBuffer);
    x.getWorksheet("Scan")!.getCell("A2").value = "1234567890123456";
    x.getWorksheet("Scan")!.getCell("A3").value = "NOPE";
    const saved = Buffer.from(await x.xlsx.writeBuffer());
    expect(xlsxStructureProblems(await xlsxParts(saved))).toEqual([]);
    const parsed = parseCountWorkbook({ fileName: "c.xlsx", sha256: "s", cells: await workbookCells(saved) });
    expect(parsed.problems).toEqual([]);
    expect(parsed.meta?.workbookId).toBe("627e354e-0000-4000-8000-000000000000");
    expect(parsed.scanCount).toBe(2);
  });

  it("the tag scanner reads the real 1.3 MB Scan sheet without a problem", { timeout: 60_000 }, async () => {
    const { parts } = await build();
    const r = scanTags(parts["xl/worksheets/sheet2.xml"]);
    expect(r.problem).toBeNull();
    expect(r.tags.filter((t) => t.name === "row" && !t.close)).toHaveLength(5001);
  });

  it("the structure core's own self-tests pass (29)", () => {
    expect(__runXlsxStructureCoreTests()).toEqual({ passed: 29, failed: 0 });
  });

  it("the self-test runner pins the structure core", () => {
    const runner = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
    expect(runner).toContain('assertRan("xlsx-structure-core", __runXlsxStructureCoreTests(), 29)');
  });
});
