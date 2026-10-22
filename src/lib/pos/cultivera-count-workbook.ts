/**
 * src/lib/pos/cultivera-count-workbook.ts — R50 S11: the scan workbook for the Oct 30 count.
 *
 * One workbook per counter (8–9 people). The owner's flow (R50 §0.6 clarification #2): download →
 * plug in a Tera / Socket scanner → point-scan rapid fire → upload. The barcode IS the Cultivera lot
 * number, so a scan is matched to the imported lot by its lot_code (exact, case-insensitive).
 *
 * Built so a rushed counter cannot corrupt it:
 *   • Scan!A is TEXT ("@") before anyone types — Cultivera has 17–19-digit numeric barcodes and
 *     leading zeros; a General cell would turn them into 8.71E+18 and lose the digits (measured:
 *     56 live barcodes collide at Excel's 15 significant digits, 155 start with 0). The parser
 *     still refuses anything that looks mangled (isMangledScan).
 *   • Only the input cells are unlocked; the sheets are protected (no password — it guards against
 *     accidents, not people), so the lookup formulas cannot be typed over.
 *   • Each scan row shows the product name the barcode belongs to (from the hidden Lots sheet, the
 *     latest verified Cultivera harvest) or "NOT IN CULTIVERA", so a misread is seen at the shelf.
 *   • BLIND count: no Cultivera quantity is in the workbook (counters count what is there).
 *   • A hidden Meta sheet carries a unique workbook id, so the same copy uploaded twice — or one
 *     download shared between two counters — is refused instead of double counted.
 *
 * Server-only (exceljs).
 */
import "server-only";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { COUNT_WORKBOOK_SPEC as S } from "@/lib/pos/cultivera-count-core";

export type CountWorkbookLot = { barcode: string; productName: string; storage: string };

export type CountWorkbookInput = {
  counter: string;
  countDate: string; // YYYY-MM-DD
  /** Lots from the latest verified Cultivera harvest (inventories.json), any order. */
  lots: CountWorkbookLot[];
  /** Where the lots came from (harvest run id) — recorded in Meta for the audit. */
  lotsSource: string;
  generatedAt?: Date;
  workbookId?: string;
};

const GREEN = "FF1F4D2B";
const PALE = "FFEFF7F1";
const AMBER = "FFFFF4CC";

function safeText(v: string): string {
  // A leading = + - @ would make Excel read a product name as a formula.
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

export async function buildCountWorkbook(input: CountWorkbookInput): Promise<{ buffer: Buffer; workbookId: string; fileName: string }> {
  const workbookId = input.workbookId ?? crypto.randomUUID();
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Greenway — Cultivera menu upload";
  wb.created = new Date(generatedAt);
  wb.calcProperties = { fullCalcOnLoad: true };

  // Lots: unique barcodes (the import merges duplicate-barcode rows into one lot), sorted.
  const byCode = new Map<string, CountWorkbookLot>();
  for (const l of input.lots) {
    const code = String(l.barcode ?? "").trim();
    if (!code) continue;
    const k = code.toLowerCase();
    const prev = byCode.get(k);
    if (!prev) byCode.set(k, { barcode: code, productName: l.productName ?? "", storage: l.storage ?? "" });
    else if (l.storage && !prev.storage.split(" + ").includes(l.storage)) prev.storage = `${prev.storage} + ${l.storage}`;
  }
  const lots = [...byCode.values()].sort((a, b) => a.barcode.localeCompare(b.barcode));
  const lastLot = Math.max(2, lots.length + 1);
  const lotsRange = (col: "A" | "B") => `'${S.lotsSheet}'!$${col}$2:$${col}$${lastLot}`;

  // ---------------- Start Here ----------------
  const start = wb.addWorksheet(S.startSheet, { properties: { tabColor: { argb: GREEN } } });
  start.getColumn(1).width = 4;
  start.getColumn(2).width = 100;
  const scanLast = S.scanRows + 1;
  const handLast = S.handRows + 1;
  const lines: [string, "title" | "head" | "text" | "warn"][] = [
    ["Greenway — Cultivera count workbook", "title"],
    [`Counter: ${input.counter}     Count date: ${input.countDate}`, "head"],
    ["", "text"],
    ["BEFORE YOU START (once per computer)", "head"],
    ["1. Excel: File › Options › Advanced › turn OFF “Enable AutoComplete for cell values”. AutoComplete can change a scan into an earlier one.", "warn"],
    ["2. Set up the scanner on Admin › Menu Imports › Count, step 0 “Set up and test each scanner”. Tera D5100: plug in its dongle, scan Real Time Mode, United States, Conversion Off, Carriage Return. Socket D760: charge from a wall plug, scan Basic Mode (HID), Carriage Return and English while NOT connected, then pair it in Bluetooth. Alacrity MJ-2020R: charge it on its cradle, plug the cradle in, scan Wedge, US English and CR (its factory setting is two Enters). The test box there must say OK.", "text"],
    ["3. Test: click the Scan sheet, cell A2, scan one item. The barcode appears, the cursor drops to A3, and column B shows the product name.", "text"],
    ["", "text"],
    ["COUNTING", "head"],
    ["• Scan sheet: point-scan EVERY unit, one scan = one unit. Never type a quantity on the Scan sheet.", "text"],
    ["• Column B shows the product. “NOT IN CULTIVERA” = set that item aside and tell the manager (it is still counted, and reviewed before anything changes).", "text"],
    ["• Hand Count sheet: only for items you cannot scan one by one (a sealed case, an unreadable label). Type the barcode exactly and a whole-number quantity.", "text"],
    ["• Made a mistake on the Scan sheet? Select the cell and press Delete. Blank rows are fine.", "text"],
    ["• Do NOT copy this file for someone else — every counter downloads their own workbook (a copy is refused at upload).", "warn"],
    ["• Do not rename, add or delete sheets, and do not paste over column B.", "text"],
    ["", "text"],
    ["WHEN YOU ARE DONE", "head"],
    ["Save (keep it .xlsx) and give the file to the manager. The manager uploads every counter's workbook on Admin › Menu Imports › Count.", "text"],
    ["", "text"],
  ];
  lines.forEach(([t, kind], i) => {
    const c = start.getCell(i + 1, 2);
    c.value = t;
    c.alignment = { wrapText: true, vertical: "top" };
    if (kind === "title") c.font = { bold: true, size: 16, color: { argb: GREEN } };
    if (kind === "head") c.font = { bold: true, size: 12 };
    if (kind === "warn") c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  });
  const tot = lines.length + 1;
  start.getCell(tot, 2).value = "Your totals so far:";
  start.getCell(tot, 2).font = { bold: true };
  start.getCell(tot + 1, 2).value = { formula: `"Units scanned: "&COUNTA('${S.scanSheet}'!$A$2:$A$${scanLast})` };
  start.getCell(tot + 2, 2).value = { formula: `"Units hand-counted: "&SUM('${S.handSheet}'!$B$2:$B$${handLast})` };
  start.getCell(tot + 3, 2).value = {
    formula: `"Scans NOT IN CULTIVERA: "&COUNTIF('${S.scanSheet}'!$B$2:$B$${scanLast},"NOT IN CULTIVERA*")`,
  };
  start.getCell(tot + 4, 2).value = `Product list: ${lots.length.toLocaleString("en-US")} Cultivera barcodes from harvest ${input.lotsSource}.`;
  start.getCell(tot + 4, 2).font = { italic: true, color: { argb: "FF666666" } };
  await start.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  // ---------------- Scan ----------------
  const scan = wb.addWorksheet(S.scanSheet, { properties: { tabColor: { argb: GREEN } }, views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }] });
  scan.columns = [
    { header: S.scanHeader, key: "a", width: 30 },
    { header: "Product (check it matches the item)", key: "b", width: 70 },
  ];
  scan.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  scan.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  for (let r = 2; r <= scanLast; r++) {
    const a = scan.getCell(r, 1);
    a.numFmt = "@";
    a.protection = { locked: false };
    a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
    scan.getCell(r, 2).value = {
      formula: `IF(A${r}="","",IFERROR(INDEX(${lotsRange("B")},MATCH(A${r},${lotsRange("A")},0)),"NOT IN CULTIVERA — set aside"))`,
    };
  }
  scan.addConditionalFormatting({
    ref: `B2:B${scanLast}`,
    rules: [{ type: "beginsWith", operator: "beginsWith", text: "NOT IN CULTIVERA", priority: 1, style: { font: { bold: true, color: { argb: "FFC00000" } } } } as unknown as ExcelJS.ConditionalFormattingRule],
  });
  await scan.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  // ---------------- Hand Count ----------------
  const hand = wb.addWorksheet(S.handSheet, { views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }] });
  hand.columns = [
    { header: S.handHeaders[0], key: "a", width: 30 },
    { header: S.handHeaders[1], key: "b", width: 10 },
    { header: S.handHeaders[2], key: "c", width: 30 },
    { header: "Product (check it matches the item)", key: "d", width: 60 },
  ];
  hand.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  hand.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  for (let r = 2; r <= handLast; r++) {
    for (const col of [1, 2, 3]) {
      const c = hand.getCell(r, col);
      c.protection = { locked: false };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
      if (col !== 2) c.numFmt = "@";
    }
    hand.getCell(r, 4).value = {
      formula: `IF(A${r}="","",IFERROR(INDEX(${lotsRange("B")},MATCH(A${r},${lotsRange("A")},0)),"NOT IN CULTIVERA — set aside"))`,
    };
  }
  // exceljs has dataValidations at runtime (verified in the LibreOffice round-trip) but not in its .d.ts.
  (hand as unknown as { dataValidations: { add(ref: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(`B2:B${handLast}`, {
    type: "whole",
    operator: "between",
    allowBlank: true,
    formulae: [0, 100000],
    showErrorMessage: true,
    errorTitle: "Whole number",
    error: "Type a whole number of units (0 or more).",
  });
  await hand.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  // ---------------- Lots (hidden) ----------------
  const lotSheet = wb.addWorksheet(S.lotsSheet, { state: "hidden" });
  lotSheet.columns = [
    { header: "Barcode", key: "barcode", width: 28 },
    { header: "Product", key: "product", width: 60 },
    { header: "Storage", key: "storage", width: 24 },
  ];
  lotSheet.getColumn(1).numFmt = "@";
  for (const l of lots) {
    const row = lotSheet.addRow([l.barcode, safeText(l.productName), safeText(l.storage)]);
    row.getCell(1).numFmt = "@";
  }
  await lotSheet.protect("", {});

  // ---------------- Meta (very hidden) ----------------
  const meta = wb.addWorksheet(S.metaSheet, { state: "veryHidden" });
  const metaValues: Record<(typeof S.metaKeys)[number], string> = {
    format: S.format,
    workbook_id: workbookId,
    counter: input.counter,
    count_date: input.countDate,
    generated_at: generatedAt,
    lots_from_import: input.lotsSource,
  };
  for (const k of S.metaKeys) {
    const row = meta.addRow([k, metaValues[k]]);
    row.getCell(2).numFmt = "@";
  }
  await meta.protect("", {});

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: "visible" }];
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const who = input.counter.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "counter";
  return { buffer, workbookId, fileName: `greenway-count-${input.countDate}-${who}-${workbookId.slice(0, 8)}.xlsx` };
}

/** xlsx buffer → the cell grids parseCountWorkbook takes (header:1, raw:false = formatted text). */
export async function workbookCells(buffer: Buffer): Promise<{ sheets: Record<string, unknown[][]> }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheets: Record<string, unknown[][]> = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: false, blankrows: true });
  }
  return { sheets };
}
