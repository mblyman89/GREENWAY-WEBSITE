import "server-only";

/**
 * src/lib/reports/workbook.ts  (Slice 47)
 *
 * Shared, presentation-quality export helpers for the reporting suite. A single
 * "table spec" can be rendered as either a clean CSV or a styled .xlsx workbook,
 * so every report tab gets BOTH formats from one definition with consistent,
 * spreadsheet-friendly formatting.
 *
 * Design goals (the owner's ask — "very clean tables of data"):
 *   • One bold, frozen header row.
 *   • Money shown as real currency cells ($#,##0.00) in XLSX; two-decimal
 *     dollars in CSV (with raw-cents NOT duplicated — we keep the columns the
 *     report defines, clean).
 *   • Percent cells formatted 0.0%.
 *   • Auto-sized columns, subtle banding, a styled TOTALS row.
 *   • A small title + generated-at caption sheet header for context.
 *
 * Money is supplied in MINOR UNITS (cents); currency columns divide by 100.
 *
 * Server-only (exceljs is a Node lib).
 */

import ExcelJS from "exceljs";

export type ColumnType = "text" | "number" | "currency" | "percent" | "integer";

export type TableColumn = {
  /** Object key in each row. */
  key: string;
  /** Header label. */
  header: string;
  type?: ColumnType; // default "text"
  /** Optional fixed width hint (chars). Auto otherwise. */
  width?: number;
};

export type TableRow = Record<string, string | number | null | undefined>;

export type TableSheet = {
  /** Sheet name (XLSX) / section (CSV). Kept <= 31 chars for Excel. */
  name: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Optional totals row (rendered bold). Keyed like a row. */
  totals?: TableRow;
  /** Optional caption shown above the table. */
  caption?: string;
};

export type WorkbookSpec = {
  /** File base name (no extension). */
  filename: string;
  /** Title shown on the first sheet header (and CSV banner). */
  title: string;
  sheets: TableSheet[];
};

const CURRENCY_FMT = '"$"#,##0.00;[Red]-"$"#,##0.00';
const PERCENT_FMT = "0.0%";
const INT_FMT = "#,##0";
const NUM_FMT = "#,##0.00";

const BRAND_GREEN = "FF1F7A3D"; // header fill
const HEADER_TEXT = "FFFFFFFF";
const BAND_FILL = "FFF3F6F4";
const TOTALS_FILL = "FFE8F0EA";

function safeSheetName(name: string): string {
  // Excel forbids : \ / ? * [ ] and >31 chars.
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Sheet";
}

/** Coerce a raw value into the numeric form a currency/percent cell expects. */
function numericValue(type: ColumnType, raw: string | number | null | undefined): number | string | null {
  if (raw == null || raw === "") return null;
  if (type === "currency") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n / 100 : null; // minor units -> dollars
  }
  if (type === "percent") {
    const n = typeof raw === "number" ? raw : Number(raw);
    // Accept either fraction (0.42) or already-scaled (42 meaning 42%). We treat
    // values > 1.5 as already-percent and divide; otherwise treat as fraction.
    if (!Number.isFinite(n)) return null;
    return Math.abs(n) > 1.5 ? n / 100 : n;
  }
  if (type === "number" || type === "integer") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

function fmtFor(type: ColumnType): string | undefined {
  switch (type) {
    case "currency":
      return CURRENCY_FMT;
    case "percent":
      return PERCENT_FMT;
    case "integer":
      return INT_FMT;
    case "number":
      return NUM_FMT;
    default:
      return undefined;
  }
}

/**
 * Build a styled .xlsx workbook buffer from a spec.
 */
export async function buildXlsx(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Greenway Back Office";
  wb.created = new Date();

  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name), {
      views: [{ state: "frozen", ySplit: sheet.caption ? 3 : 2 }],
    });

    let rowCursor = 1;
    // Title banner.
    ws.mergeCells(rowCursor, 1, rowCursor, Math.max(1, sheet.columns.length));
    const titleCell = ws.getCell(rowCursor, 1);
    titleCell.value = sheet.caption ? `${spec.title} — ${sheet.caption}` : spec.title;
    titleCell.font = { bold: true, size: 13, color: { argb: "FF111111" } };
    rowCursor++;

    // Header row.
    const headerRowIdx = rowCursor;
    const headerRow = ws.getRow(headerRowIdx);
    sheet.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: HEADER_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_GREEN } };
      cell.alignment = { vertical: "middle", horizontal: col.type && col.type !== "text" ? "right" : "left" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
    });
    headerRow.height = 18;
    rowCursor++;

    // Data rows.
    sheet.rows.forEach((row, ri) => {
      const r = ws.getRow(rowCursor);
      sheet.columns.forEach((col, ci) => {
        const cell = r.getCell(ci + 1);
        const type = col.type ?? "text";
        cell.value = numericValue(type, row[col.key]);
        const fmt = fmtFor(type);
        if (fmt) cell.numFmt = fmt;
        cell.alignment = { horizontal: type !== "text" ? "right" : "left" };
        if (ri % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
        }
      });
      rowCursor++;
    });

    // Totals row.
    if (sheet.totals) {
      const r = ws.getRow(rowCursor);
      sheet.columns.forEach((col, ci) => {
        const cell = r.getCell(ci + 1);
        const type = col.type ?? "text";
        cell.value = numericValue(type, sheet.totals![col.key]);
        const fmt = fmtFor(type);
        if (fmt) cell.numFmt = fmt;
        cell.font = { bold: true };
        cell.alignment = { horizontal: type !== "text" ? "right" : "left" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_FILL } };
        cell.border = { top: { style: "thin", color: { argb: "FF999999" } } };
      });
      rowCursor++;
    }

    // Column widths: explicit hint or auto from content.
    sheet.columns.forEach((col, ci) => {
      const column = ws.getColumn(ci + 1);
      if (col.width) {
        column.width = col.width;
        return;
      }
      let maxLen = col.header.length;
      for (const row of sheet.rows) {
        const v = row[col.key];
        const len = v == null ? 0 : String(v).length;
        if (len > maxLen) maxLen = len;
      }
      column.width = Math.min(48, Math.max(10, maxLen + 2));
    });
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

/* ------------------------------------------------------------------------- */
/* CSV rendering from the SAME spec (clean: dollars for currency, % for pct). */
/* ------------------------------------------------------------------------- */

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvValue(type: ColumnType, raw: string | number | null | undefined): string {
  if (raw == null || raw === "") return "";
  if (type === "currency") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? (n / 100).toFixed(2) : "";
  }
  if (type === "percent") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return "";
    const frac = Math.abs(n) > 1.5 ? n / 100 : n;
    return (frac * 100).toFixed(1);
  }
  return String(raw);
}

/** Render a spec to a single clean CSV (multi-sheet specs are concatenated with a blank line + section header). */
export function buildCsv(spec: WorkbookSpec): string {
  const blocks: string[] = [];
  for (const sheet of spec.sheets) {
    const lines: string[] = [];
    if (spec.sheets.length > 1 || sheet.caption) {
      lines.push(csvCell(sheet.caption ? `${spec.title} — ${sheet.caption}` : `${spec.title} — ${sheet.name}`));
    }
    lines.push(sheet.columns.map((c) => csvCell(c.header)).join(","));
    for (const row of sheet.rows) {
      lines.push(sheet.columns.map((c) => csvCell(csvValue(c.type ?? "text", row[c.key]))).join(","));
    }
    if (sheet.totals) {
      lines.push(sheet.columns.map((c) => csvCell(csvValue(c.type ?? "text", sheet.totals![c.key]))).join(","));
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------------- */
/* HTTP response helpers.                                                     */
/* ------------------------------------------------------------------------- */

export type ExportFormat = "csv" | "xlsx";

export function parseFormat(v: string | null | undefined): ExportFormat {
  return (v ?? "").toLowerCase() === "xlsx" ? "xlsx" : "csv";
}

/**
 * Render a spec to an HTTP Response in the requested format with the right
 * content type + filename. Filenames carry the format extension.
 */
export async function exportResponse(spec: WorkbookSpec, format: ExportFormat): Promise<Response> {
  if (format === "xlsx") {
    const buf = await buildXlsx(spec);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${spec.filename}.xlsx"`,
      },
    });
  }
  const csv = buildCsv(spec);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${spec.filename}.csv"`,
    },
  });
}
