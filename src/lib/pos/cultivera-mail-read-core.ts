/**
 * src/lib/pos/cultivera-mail-read-core.ts — R74 S9. PURE: read the PDFs and spreadsheets the email
 * harvest (S7) kept as "stored".
 *
 * Owner (round 6): "when you build the pdf and spreadsheet reader ... utilize llama parse ai if it
 * helps us in any way." It does, and the site already relies on it: LlamaParse is the PRIMARY PDF
 * reader of the live intake (owner decision, llamaparse-recovery), with the unpdf text layer only as
 * the outage fallback. S9 runs the very same path for each kept PDF, then the very same layout
 * parsers (pdf-manifest-dispatch-core: LCB Internal Shipping Document, GrowFlow, Transfer Log,
 * OpenTHC invoice-manifest). For spreadsheets the cells are read locally (exceljs, exact values, no
 * cost) and LlamaParse is NOT needed: a cell is already text, an AI could only add error.
 *
 * Never guess (standing rule):
 *   - A barcode is only taken from a column whose HEADER names it (barcode / inventory id / lot id /
 *     external identifier / tag / package id ...), and only when the cell is a 10–24 character id
 *     with at least 8 digits. No header = no barcodes ("unreadable", with the reason).
 *   - Quantity / price / product / type come only from their named columns; a missing column is
 *     null, never inferred. Money in cents (Math.round of dollars × 100).
 *   - The manifest number / vendor license / transfer date come from a "Label: value" cell pair or a
 *     header column with ONE distinct value across the rows; anything ambiguous stays null.
 *   - Vision text (LlamaParse) is grounded: when the PDF also has a usable text layer, a barcode
 *     LlamaParse read but the layer does not contain is DROPPED (the R26 grounding rule), so an OCR
 *     slip can never place a lot on the wrong manifest. A scanned PDF with no layer keeps the
 *     vision barcodes but says so in the note.
 *
 *   readPdfText          LlamaParse text + layer -> ParsedDocSummary (via the shared summarizer)
 *   sheetToManifest      cells of a sheet -> ParsedManifest-shaped facts
 *   readSpreadsheetCells all sheets -> the best sheet's manifest (most barcodes) -> summary
 *   pdfReadNote          the engine note kept on the row (which reader ran, and why)
 *   READ_BATCH_* / readBatchLine   the button's batch size, time budget and result sentence
 *   READ_CONCURRENCY / readMayStart / readWidth   S19: documents read at once, inside the budget
 *
 * Reads nothing, writes nothing.
 */

import type { ParsedLine, ParsedManifest } from "@/lib/inventory/intake-parser";
import { parsePdfManifestText } from "@/lib/inventory/pdf-manifest-dispatch-core";
import { hasUsableLayer } from "@/lib/inventory/extraction-grounding-core";
import { normalizeAnyDate } from "@/lib/inventory/pdf-generic-transport-core";
import { markdownTables } from "@/lib/inventory/markdown-fields-core";
import { summarizeManifest, type ParsedDocSummary } from "@/lib/pos/cultivera-mail-harvest-run-core";

export const MAIL_READ_RULE_VERSION = 1;
/**
 * R74 S19 (round 10: "it says it can do up to 12 at a time ... I am hoping we can bump up the read
 * rate from llama parse"). The most documents one press may pick up. Each PDF is one LlamaParse job
 * (~5–40 s), so in practice the time budget, not this number, ends a press.
 */
export const READ_BATCH_MAX_DOCS = 100;
/**
 * Documents read AT ONCE. 5 = LlamaParse's concurrent parse jobs on the Free and Starter plans
 * (developers.llamaindex.ai/llamaparse/general/billing, read 2026-10). Its request-rate caps
 * (500 job creations per 10 s, 80 status reads per s) are far above 5 jobs polled every 2 s.
 */
export const READ_CONCURRENCY = 5;
/**
 * Stop STARTING new documents after this long. The page's function lives 300 s; a document started
 * at 180 s has 120 s left, more than LlamaParse's own 90 s wait plus the download and the write.
 */
export const READ_BATCH_TIME_BUDGET_MS = 180_000;

/** Whether a read worker may start another document. Pure; the store asks it before each one. */
export function readMayStart(i: { elapsedMs: number; budgetMs: number; stopped: boolean; next: number; total: number }): "go" | "done" | "budget" | "stopped" {
  if (i.stopped) return "stopped";
  if (i.next >= i.total) return "done";
  if (i.elapsedMs > i.budgetMs) return "budget";
  return "go";
}

/** The worker count for a batch: never more than the documents, never below 1, never above the cap. */
export function readWidth(requested: number, docs: number): number {
  const w = Number.isFinite(requested) ? Math.floor(requested) : READ_CONCURRENCY;
  return Math.max(0, Math.min(Math.max(1, Math.min(w, READ_CONCURRENCY)), docs));
}
/** A spreadsheet larger than this many cells is not a manifest (a price list / export); refused by name. */
export const SHEET_MAX_CELLS = 200_000;

/* ------------------------------------------------------------------ *
 *  Cells -> manifest
 * ------------------------------------------------------------------ */

export type Cell = string | number | boolean | null;

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const headerKey = (s: unknown) =>
  norm(s)
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

/** Header words that name the state barcode column (WCIA inventory_id = CCRS InventoryExternalIdentifier = Cultivera Barcode). */
const BARCODE_HEADERS = [
  "barcode",
  "bar code",
  "inventory id",
  "inventory_id",
  "inventoryid",
  "inventory external identifier",
  "inventoryexternalidentifier",
  "external identifier",
  "lot id",
  "lot #",
  "lot number",
  "lot code",
  "package id",
  "package tag",
  "tag id",
  "tag",
  "uid",
  "global id",
  "inventory tag",
];
const QTY_HEADERS = ["qty", "quantity", "units", "unit count", "count", "shipped qty", "qty shipped", "received qty", "shipped quantity", "accepted quantity"];
const NAME_HEADERS = ["product", "product name", "item", "item name", "description", "name", "strain product", "product description"];
const TYPE_HEADERS = ["inventory type", "type", "product type", "category"];
const UNIT_PRICE_HEADERS = ["unit price", "price", "unit cost", "cost", "price each", "wholesale price", "price per unit", "line price each"];

function findCol(header: readonly string[], names: readonly string[]): number {
  const keys = header.map(headerKey);
  for (const n of names) {
    const i = keys.indexOf(n.replace(/[^a-z0-9#]+/g, " ").trim());
    if (i >= 0) return i;
  }
  return -1;
}

/** A state inventory id: 10–24 chars of letters/digits/dots/dashes with at least 8 digits. */
export function looksLikeBarcode(v: Cell): string | null {
  if (v == null || typeof v === "boolean") return null;
  // exceljs gives big ids as numbers: render integers without exponent; a float is never an id.
  let s: string;
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) return null;
    s = BigInt(v).toString();
  } else s = norm(v);
  if (!/^[A-Za-z0-9.-]{10,24}$/.test(s)) return null;
  if ((s.match(/\d/g) ?? []).length < 8) return null;
  return s;
}

function toNumber(v: Cell): number | null {
  if (v == null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const c = v.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/** Dollars -> whole cents (the house rule); null when not a number. */
export function dollarsToCents(v: Cell): number | null {
  const n = toNumber(v);
  return n == null || n < 0 ? null : Math.round(n * 100);
}

const LABELS: Record<"number" | "license" | "vendor" | "date", RegExp> = {
  number: /^(manifest|manifest id|manifest #|manifest number|transfer id|transfer #|transfer number)$/,
  license: /^(from license|from license number|from license #|license|license #|license number|origin license|origin license #|vendor license|sender license|licensee #)$/,
  vendor: /^(from|from license name|vendor|vendor name|origin|origin license name|sender|shipper|licensee name)$/,
  date: /^(date|transfer date|ship date|shipped|departure date|manifest date|est departed at|departed)$/,
};

/** Value of the first "Label | value" pair (or "Label: value" in one cell) whose label matches. */
function labelValue(rows: readonly (readonly Cell[])[], re: RegExp): string | null {
  for (const r of rows) {
    for (let i = 0; i < r.length; i += 1) {
      const raw = norm(r[i]);
      if (!raw) continue;
      const inline = raw.match(/^([A-Za-z][A-Za-z #._-]{0,40}?)\s*:\s*(.+)$/);
      if (inline && re.test(headerKey(inline[1]))) return norm(inline[2]);
      if (re.test(headerKey(raw.replace(/:\s*$/, "")))) {
        for (let j = i + 1; j < r.length; j += 1) {
          const v = norm(r[j]);
          if (v) return v;
        }
      }
    }
  }
  return null;
}

/** The one distinct non-blank value of a column, else null (two values = ambiguous = never guessed). */
function soleValue(rows: readonly (readonly Cell[])[], col: number): string | null {
  if (col < 0) return null;
  const seen = new Set<string>();
  for (const r of rows) {
    const v = norm(typeof r[col] === "number" && Number.isInteger(r[col]) ? BigInt(r[col] as number).toString() : r[col]);
    if (v) seen.add(v);
  }
  return seen.size === 1 ? [...seen][0] : null;
}

function blankLine(): ParsedLine {
  return {
    product_name: null,
    lot_code: null,
    pos_product_key: null,
    brand_name: null,
    category: null,
    strain_name: null,
    strain_type: null,
    received_qty: 0,
    unit: "each",
    unit_cost_minor_units: null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    lab: null,
    warnings: [],
    raw: null,
  };
}

export type SheetManifest = {
  manifest: Pick<ParsedManifest, "manifest_number" | "vendor_label" | "vendor_license" | "transfer_date" | "source_format" | "lines">;
  /** Why no barcodes were taken (null when some were). */
  why: string | null;
  headerRow: number;
};

/**
 * One sheet (rows of cells) -> manifest facts. The header row is the first row (of the first 40)
 * that names a barcode column. source_format "generic" (the 0293 format check allows it).
 */
export function sheetToManifest(rows: readonly (readonly Cell[])[]): SheetManifest {
  const empty = (why: string, headerRow = -1): SheetManifest => ({
    manifest: { manifest_number: null, vendor_label: null, vendor_license: null, transfer_date: null, source_format: "generic", lines: [] },
    why,
    headerRow,
  });
  let h = -1;
  let bcCol = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const c = findCol(rows[i].map((x) => norm(x)), BARCODE_HEADERS);
    if (c >= 0) {
      h = i;
      bcCol = c;
      break;
    }
  }
  if (h < 0) return empty("no column is headed barcode / inventory id / lot id / external identifier, so no barcode is guessed");
  const header = rows[h].map((x) => norm(x));
  const body = rows.slice(h + 1);
  const above = rows.slice(0, h);
  const qtyCol = findCol(header, QTY_HEADERS);
  const nameCol = findCol(header, NAME_HEADERS);
  const typeCol = findCol(header, TYPE_HEADERS);
  const priceCol = findCol(header, UNIT_PRICE_HEADERS);
  const lines: ParsedLine[] = [];
  let notIds = 0;
  for (const r of body) {
    const bc = looksLikeBarcode(r[bcCol] ?? null);
    if (!bc) {
      if (norm(r[bcCol])) notIds += 1;
      continue;
    }
    const l = blankLine();
    l.lot_code = bc;
    // No quantity column: the line is a receipt of an unknown count; S6 needs qty > 0 to call it a
    // receipt, and a listed lot on a shipping document was shipped, so 1 marks "present" — but we
    // say so on the line instead of pretending to know the count.
    const q = qtyCol >= 0 ? toNumber(r[qtyCol] ?? null) : null;
    l.received_qty = q != null && q > 0 ? q : qtyCol >= 0 ? 0 : 1;
    if (qtyCol < 0) l.warnings.push("no quantity column: listed, count unknown");
    l.product_name = nameCol >= 0 ? norm(r[nameCol]) || null : null;
    l.inventory_type = typeCol >= 0 ? norm(r[typeCol]) || null : null;
    l.unit_cost_minor_units = priceCol >= 0 ? dollarsToCents(r[priceCol] ?? null) : null;
    lines.push(l);
  }
  if (lines.length === 0) return empty(`the ${header[bcCol]} column has no state ids (${notIds} other values)`, h);
  const numberCol = findCol(header, ["manifest", "manifest id", "manifest #", "manifest number", "transfer id", "transfer #"]);
  const licenseCol = findCol(header, ["from license", "from license number", "license", "license #", "vendor license", "origin license"]);
  const vendorCol = findCol(header, ["vendor", "vendor name", "from", "from license name", "origin license name", "licensee"]);
  const dateCol = findCol(header, ["transfer date", "date", "ship date", "manifest date"]);
  const number = labelValue(above, LABELS.number) ?? soleValue(body, numberCol);
  const license = labelValue(above, LABELS.license) ?? soleValue(body, licenseCol);
  const vendor = labelValue(above, LABELS.vendor) ?? soleValue(body, vendorCol);
  const dateRaw = labelValue(above, LABELS.date) ?? soleValue(body, dateCol);
  const licDigits = license ? (license.match(/\d{5,}/) ?? [null])[0] : null;
  return {
    manifest: {
      manifest_number: number ? number.replace(/\s+/g, "") : null,
      vendor_label: vendor,
      vendor_license: licDigits,
      transfer_date: dateRaw ? normalizeAnyDate(dateRaw) : null,
      source_format: "generic",
      lines,
    },
    why: null,
    headerRow: h,
  };
}

/**
 * One exceljs cell value -> a plain Cell. exceljs gives: primitives, Date, { richText: [{text}] },
 * { formula|sharedFormula, result }, { text, hyperlink }, { error }. A formula counts by its saved
 * RESULT (what the vendor saw); an error or a formula with no saved result is blank (never computed
 * here). A date becomes YYYY-MM-DD (UTC: Excel dates carry no zone).
 */
export function excelCellValue(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map((r) => String(r?.text ?? "")).join("");
    if ("formula" in o || "sharedFormula" in o) return "result" in o ? excelCellValue(o.result) : null;
    if ("error" in o) return null;
    if ("text" in o) return excelCellValue(o.text);
  }
  return null;
}

/** Spreadsheet files larger than this are refused by name (a manifest workbook is kilobytes). */
export const SHEET_MAX_BYTES = 15 * 1024 * 1024;

/** Old Excel 97-2003 (.xls, OLE2 compound file) — the reader opens .xlsx only, and says so. */
export function isOldExcel(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

export const OLD_XLS_NOTE = "an old Excel 97-2003 .xls file: the reader opens .xlsx only (open it in Excel and Save As .xlsx, or read the paper copy)";

/** Every sheet of a workbook -> the sheet with the most barcodes -> the row summary. */
export function readSpreadsheetCells(sheets: readonly { name: string; rows: readonly (readonly Cell[])[] }[]): ParsedDocSummary {
  if (sheets.length === 0) return unreadable("the spreadsheet has no sheets");
  const cells = sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.length, 0), 0);
  if (cells > SHEET_MAX_CELLS) return unreadable(`the spreadsheet has ${cells} cells; a transfer manifest is far smaller (price list or export?)`);
  let best: { name: string; sm: SheetManifest } | null = null;
  const whys: string[] = [];
  for (const s of sheets) {
    const sm = sheetToManifest(s.rows);
    if (sm.manifest.lines.length === 0) whys.push(`${s.name}: ${sm.why}`);
    else if (!best || sm.manifest.lines.length > best.sm.manifest.lines.length) best = { name: s.name, sm };
  }
  if (!best) return unreadable(`no barcodes read (${whys.slice(0, 3).join("; ")})`);
  const sum = summarizeManifest(best.sm.manifest, `sheet "${best.name}"`);
  const notes = [`read sheet "${best.name}" (header row ${best.sm.headerRow + 1})`];
  if (best.sm.manifest.lines.some((l) => l.warnings.length > 0)) notes.push("no quantity column: each listed lot counted as present");
  if (!best.sm.manifest.manifest_number) notes.push("no manifest number in the sheet");
  if (sum.note) notes.push(sum.note);
  return { ...sum, note: notes.join("; ") };
}

function unreadable(note: string): ParsedDocSummary {
  return { status: "unreadable", sourceFormat: null, manifestNumber: null, vendorLabel: null, vendorLicense: null, transferDate: null, lines: [], note };
}

/* ------------------------------------------------------------------ *
 *  PDF text -> summary (LlamaParse first, grounded by the text layer)
 * ------------------------------------------------------------------ */

export type PdfEngine = "llamaparse" | "unpdf" | "none";

export type PdfTextInput = {
  /** What the reader returned (LlamaParse markdown, or unpdf text on an outage). */
  text: string;
  engine: PdfEngine;
  /** The PDF's own text layer (unpdf), read independently, for grounding. "" for a scanned image. */
  layer: string;
  /** Why LlamaParse did not run (key unset, outage, 402), when it did not. */
  engineNote?: string | null;
};

/** LlamaParse markdown keeps tables as | cells |; the layout parsers want plain lines. */
export function flattenMarkdownTables(text: string): string {
  if (!/(?:^|\n)\s*\|.*\|/.test(text) && !/<table\b/i.test(text)) return text;
  const tables = markdownTables(text);
  if (tables.length === 0) return text;
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      const cells = raw.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      lines.push(cells.filter(Boolean).join(" "));
      continue;
    }
    lines.push(raw);
  }
  return lines.join("\n");
}

export function pdfReadNote(i: Pick<PdfTextInput, "engine" | "engineNote">): string {
  if (i.engine === "llamaparse") return "read by LlamaParse";
  if (i.engine === "unpdf") return `read from the PDF's text layer (LlamaParse unavailable${i.engineNote ? `: ${i.engineNote}` : ""})`;
  return `no reader produced text${i.engineNote ? ` (${i.engineNote})` : ""}`;
}

/**
 * Run the intake's layout parsers over the PDF text: first the reader's text as given, then (when
 * that is markdown) its tables flattened, then the raw text layer. The first that parses wins.
 * Barcodes are grounded against the layer when the layer is usable.
 */
export function readPdfText(i: PdfTextInput): ParsedDocSummary {
  const how = pdfReadNote(i);
  const tries: { text: string; via: string }[] = [];
  if (i.text.trim()) {
    tries.push({ text: i.text, via: how });
    const flat = flattenMarkdownTables(i.text);
    if (flat !== i.text) tries.push({ text: flat, via: `${how}, tables flattened` });
  }
  if (i.layer.trim() && i.layer !== i.text) tries.push({ text: i.layer, via: "read from the PDF's text layer" });
  if (tries.length === 0) return unreadable(`${how}; the PDF has no text (a scanned image LlamaParse could not read)`);
  let lastError = "";
  const usable = hasUsableLayer(i.layer);
  const grounded = (lines: ParsedLine[]) => groundLines(lines, i.layer, usable);
  const finish = (manifest: Parameters<typeof summarizeManifest>[0], what: string, via: string, dropped: number, extra: string[] = []) => {
    const sum = summarizeManifest(manifest, what);
    const notes = [via, ...extra];
    if (dropped > 0) notes.push(`${dropped} barcode${dropped === 1 ? "" : "s"} LlamaParse read but the PDF's own text does not contain, dropped (never guessed)`);
    if (!usable && i.engine === "llamaparse") notes.push("scanned PDF: barcodes are from LlamaParse's image reading, no text layer to check them against");
    if (sum.note) notes.push(sum.note);
    return { ...sum, note: notes.join("; ") };
  };
  for (const t of tries) {
    const r = parsePdfManifestText(t.text);
    if (!r.ok) {
      lastError = r.error;
      continue;
    }
    const g = grounded(r.manifest.lines);
    return finish({ ...r.manifest, lines: g.lines }, `this PDF (${r.layout})`, `${t.via} (${r.layout})`, g.dropped);
  }
  // No known layout. LlamaParse keeps a vendor's own table as a markdown table: read it like a
  // spreadsheet (barcode only from a column whose header names it), still grounded by the layer.
  if (i.engine === "llamaparse") {
    const t = pdfTableManifest(i.text);
    if (t) {
      const g = grounded(t.manifest.lines);
      if (g.lines.length > 0) {
        return finish({ ...t.manifest, lines: g.lines }, "this PDF's table", `${how}, from a table with a ${t.barcodeHeader} column (no known manifest layout)`, g.dropped);
      }
      return unreadable(`${how}; a ${t.barcodeHeader} table was found but none of its ${g.dropped} barcodes appear in the PDF's own text (never guessed)`);
    }
  }
  return unreadable(`${how}; ${lastError}`);
}

/** Keep only barcodes the PDF's own text layer contains (when the layer is usable). */
export function groundLines(lines: readonly ParsedLine[], layer: string, usable = hasUsableLayer(layer)): { lines: ParsedLine[]; dropped: number } {
  if (!usable) return { lines: [...lines], dropped: 0 };
  const squash = layer.replace(/\s+/g, "");
  let dropped = 0;
  const kept = lines.filter((l) => {
    const bc = (l.lot_code ?? "").trim();
    if (!bc || squash.includes(bc)) return true;
    dropped += 1;
    return false;
  });
  return { lines: kept, dropped };
}

/** The markdown table (from LlamaParse) with the most header-named barcodes, read as a sheet. */
export function pdfTableManifest(markdown: string): (SheetManifest & { barcodeHeader: string }) | null {
  let best: (SheetManifest & { barcodeHeader: string }) | null = null;
  const tables = markdownTables(markdown);
  // Text around the tables can carry "Manifest #: ..." lines; feed them as the label block.
  const labelRows: Cell[][] = markdown
    .split(/\r?\n/)
    .filter((l) => !/^\s*\|/.test(l) && /:/.test(l))
    .slice(0, 30)
    .map((l) => [l.replace(/[*_#>]+/g, "").trim()]);
  for (const t of tables) {
    const rows: Cell[][] = [...labelRows, ...(t.header ? [t.header] : []), ...t.rows];
    const sm = sheetToManifest(rows);
    if (sm.manifest.lines.length === 0) continue;
    if (!best || sm.manifest.lines.length > best.manifest.lines.length) best = { ...sm, barcodeHeader: norm(rows[sm.headerRow]?.[findCol(rows[sm.headerRow].map((x) => norm(x)), BARCODE_HEADERS)]) };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 *  Batch result
 * ------------------------------------------------------------------ */

export type ReadBatchResult = {
  ok: boolean;
  /** Stored documents waiting before this press. */
  waiting: number;
  read: number;
  parsed: number;
  unreadable: number;
  /** Documents whose file could not be downloaded from storage (left stored, retried next press). */
  failed: number;
  llamaparse: number;
  unpdf: number;
  /** Stored documents still waiting after this press. */
  left: number;
  stoppedBecause: string | null;
};

export function readBatchLine(r: ReadBatchResult): string {
  if (r.waiting === 0) return "Nothing to read: every kept PDF and spreadsheet has been read.";
  const parts = [
    `Read ${r.read} kept document${r.read === 1 ? "" : "s"}: ${r.parsed} with barcodes, ${r.unreadable} without`,
  ];
  if (r.read > 0) parts.push(`(LlamaParse ${r.llamaparse}, text layer ${r.unpdf})`);
  if (r.failed > 0) parts.push(`${r.failed} could not be opened and wait for the next press`);
  parts.push(r.left === 0 ? "Finished: nothing left to read." : `${r.left} left; press again.`);
  if (r.stoppedBecause) parts.push(`Stopped: ${r.stoppedBecause}.`);
  return parts.join(" ").replace(/\s+\./g, ".");
}

/* ------------------------------------------------------------------ *
 *  Self-tests
 * ------------------------------------------------------------------ */

export function __runCultiveraMailReadCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL cultivera-mail-read-core: ${name}`);
    }
  };

  // barcode shape
  ok(looksLikeBarcode("1234567890123456") === "1234567890123456", "16-digit id");
  ok(looksLikeBarcode(1234567890123456) === "1234567890123456", "numeric cell rendered without exponent");
  ok(looksLikeBarcode("WA413287.TRBOCF12345678") === "WA413287.TRBOCF12345678", "license-dotted id with 8+ digits");
  ok(looksLikeBarcode("M07825632432") === "M07825632432", "Cultivera M-number shape");
  ok(looksLikeBarcode("12345") === null && looksLikeBarcode("Blue Dream 3.5g") === null, "short / words never ids");
  ok(looksLikeBarcode(12.5) === null && looksLikeBarcode(true) === null && looksLikeBarcode(null) === null, "floats / booleans / blank never ids");
  ok(looksLikeBarcode("ABCDEFGHIJK1234") === null, "fewer than 8 digits is not an id");
  ok(dollarsToCents("$4.50") === 450 && dollarsToCents(4.5) === 450 && dollarsToCents("1,204.10") === 120410, "money to cents");
  ok(dollarsToCents("n/a") === null && dollarsToCents(-1) === null, "non-money -> null");

  // a manifest sheet with a label block above the table
  const sheet: Cell[][] = [
    ["Manifest #:", "0009123"],
    ["From License #:", "412345"],
    ["From:", "CANNA ORGANIX LLC"],
    ["Transfer Date:", "3/1/2025"],
    [],
    ["Inventory ID", "Product Name", "Inventory Type", "Qty", "Unit Price"],
    ["1234567890123456", "Blue Dream 3.5g", "Usable Marijuana", 10, "$4.50"],
    [1234567890123457, "Gelato 1g", "Usable Marijuana", "5", 2],
    ["TOTAL", "", "", 15, ""],
  ];
  const sm = sheetToManifest(sheet);
  ok(sm.manifest.lines.length === 2 && sm.why === null, "two barcode lines; total row skipped");
  ok(sm.manifest.manifest_number === "0009123" && sm.manifest.vendor_license === "412345", "number + license from the label block");
  ok(sm.manifest.vendor_label === "CANNA ORGANIX LLC" && sm.manifest.transfer_date === "2025-03-01", "vendor + date from the label block");
  ok(sm.manifest.lines[0].unit_cost_minor_units === 450 && sm.manifest.lines[1].unit_cost_minor_units === 200, "unit price in cents");
  ok(sm.manifest.lines[0].received_qty === 10 && sm.manifest.lines[1].received_qty === 5, "quantities from the Qty column");
  ok(sm.manifest.lines[0].product_name === "Blue Dream 3.5g" && sm.manifest.lines[0].inventory_type === "Usable Marijuana", "name + type columns");
  ok(sm.headerRow === 5, "header row found under the label block");

  // number from a column with one distinct value; two values = ambiguous
  const colSheet: Cell[][] = [
    ["Manifest ID", "Barcode", "Quantity"],
    ["M-77", "1111111111111111", 1],
    ["M-77", "2222222222222222", 2],
  ];
  ok(sheetToManifest(colSheet).manifest.manifest_number === "M-77", "manifest number from a one-value column");
  const twoNums: Cell[][] = [
    ["Manifest ID", "Barcode", "Quantity"],
    ["M-77", "1111111111111111", 1],
    ["M-78", "2222222222222222", 2],
  ];
  ok(sheetToManifest(twoNums).manifest.manifest_number === null, "two manifest numbers in the column: not guessed");

  // no barcode header = nothing guessed, even when ids are in the cells
  const noHeader: Cell[][] = [
    ["Item", "Count"],
    ["1234567890123456", 3],
  ];
  const nh = sheetToManifest(noHeader);
  ok(nh.manifest.lines.length === 0 && /no barcode is guessed/.test(nh.why ?? ""), "no barcode header: no guessing");
  // header present but values are not ids
  const notIds: Cell[][] = [
    ["Tag", "Qty"],
    ["red", 1],
    ["blue", 2],
  ];
  ok(/no state ids \(2 other values\)/.test(sheetToManifest(notIds).why ?? ""), "a Tag column of words is named, not read");
  // no qty column: present with a warning
  const noQty: Cell[][] = [
    ["Lot ID", "Product"],
    ["1234567890123456", "Blue Dream"],
  ];
  const nq = sheetToManifest(noQty);
  ok(nq.manifest.lines[0].received_qty === 1 && nq.manifest.lines[0].warnings.length === 1, "no qty column: listed = present, says so");
  // qty column present but blank -> 0 (not a receipt in S6)
  const blankQty: Cell[][] = [
    ["Barcode", "Qty"],
    ["1234567890123456", ""],
  ];
  ok(sheetToManifest(blankQty).manifest.lines[0].received_qty === 0, "blank qty with a qty column is 0 (never invented)");

  // workbook: best sheet wins; summary notes
  const wb = readSpreadsheetCells([
    { name: "Cover", rows: [["Thank you for your order"]] },
    { name: "Manifest", rows: sheet },
  ]);
  ok(wb.status === "parsed" && wb.lines.length === 2 && wb.sourceFormat === "generic", "workbook parsed from the manifest sheet");
  ok(/read sheet "Manifest" \(header row 6\)/.test(wb.note ?? ""), "note names the sheet and header row");
  ok(wb.lines[0][0] === "1234567890123456" && wb.lines[0][4] === 450, "DocLine = [barcode, qty, name, type, cents]");
  const wbNone = readSpreadsheetCells([{ name: "Prices", rows: [["Strain", "Price"], ["Gelato", 5]] }]);
  ok(wbNone.status === "unreadable" && /Prices: no column is headed/.test(wbNone.note ?? ""), "price list: unreadable with the sheet's reason");
  ok(readSpreadsheetCells([]).status === "unreadable", "no sheets: unreadable");
  const huge = readSpreadsheetCells([{ name: "Big", rows: [new Array(SHEET_MAX_CELLS + 1).fill("x")] }]);
  ok(huge.status === "unreadable" && /cells/.test(huge.note ?? ""), "oversized sheet refused by name");

  // PDF text: markdown table flattening + engine notes
  ok(flattenMarkdownTables("| a | b |\n|---|---|\n| 1 | 2 |") === "a b\n1 2", "markdown table flattened to lines");
  ok(flattenMarkdownTables("plain text") === "plain text", "plain text untouched");
  ok(pdfReadNote({ engine: "llamaparse" }) === "read by LlamaParse", "engine note: llamaparse");
  ok(/LlamaParse unavailable: LLAMA_CLOUD_API_KEY not set/.test(pdfReadNote({ engine: "unpdf", engineNote: "LLAMA_CLOUD_API_KEY not set" })), "engine note: outage reason kept");
  const noText = readPdfText({ text: "", engine: "none", layer: "", engineNote: "x" });
  ok(noText.status === "unreadable" && /no text/.test(noText.note ?? ""), "no text at all: unreadable, says why");
  const notManifest = readPdfText({ text: "Certificate of Analysis THC 21%", engine: "llamaparse", layer: "" });
  ok(notManifest.status === "unreadable" && /read by LlamaParse/.test(notManifest.note ?? ""), "a non-manifest PDF: unreadable, reader named");

  // LlamaParse table fallback (no known layout): header-named barcode column only, grounded
  const md = [
    "**Manifest #:** 0004455",
    "**From License #:** 423456",
    "",
    "| Lot ID | Product | Qty | Unit Price |",
    "|---|---|---|---|",
    "| 1234567890123456 | Blue Dream 3.5g | 10 | $4.50 |",
    "| 9999999999999999 | Gelato 1g | 5 | $2.00 |",
  ].join("\n");
  const layerHas1 = "VENDOR INVOICE Manifest 0004455 Lot 1234567890123456 Blue Dream 3.5g qty 10 and more words here to be usable";
  const tbl = readPdfText({ text: md, engine: "llamaparse", layer: layerHas1 });
  ok(tbl.status === "parsed" && tbl.lines.length === 1 && tbl.lines[0][0] === "1234567890123456", "table fallback: grounded to the layer (OCR-only id dropped)");
  ok(/1 barcode LlamaParse read but the PDF's own text does not contain, dropped/.test(tbl.note ?? "") && /Lot ID column/.test(tbl.note ?? ""), "table fallback note: column named + drop counted");
  ok(tbl.manifestNumber === "0004455" && tbl.vendorLicense === "423456" && tbl.lines[0][4] === 450, "table fallback: label lines + cents");
  const scanned = readPdfText({ text: md, engine: "llamaparse", layer: "" });
  ok(scanned.status === "parsed" && scanned.lines.length === 2 && /scanned PDF/.test(scanned.note ?? ""), "scanned table: vision ids kept, said so");
  const noneInLayer = readPdfText({ text: md, engine: "llamaparse", layer: "A completely different document text layer that has plenty of characters in it." });
  ok(noneInLayer.status === "unreadable" && /none of its 2 barcodes appear/.test(noneInLayer.note ?? ""), "table whose ids are all absent from the layer: unreadable");
  const unpdfTbl = readPdfText({ text: md, engine: "unpdf", layer: md });
  ok(unpdfTbl.status === "unreadable", "the table fallback is for LlamaParse output only");
  const gl = groundLines(sm.manifest.lines, "x".repeat(50) + " 1234567890123456");
  ok(gl.lines.length === 1 && gl.dropped === 1, "groundLines keeps only ids in the layer");
  ok(groundLines(sm.manifest.lines, "").dropped === 0, "groundLines: no usable layer keeps all");

  // exceljs values
  ok(excelCellValue({ richText: [{ text: "Blue " }, { text: "Dream" }] }) === "Blue Dream", "rich text joined");
  ok(excelCellValue({ formula: "A1*2", result: 9 }) === 9 && excelCellValue({ sharedFormula: "A1", result: "x" }) === "x", "formula = saved result");
  ok(excelCellValue({ formula: "A1*2" }) === null && excelCellValue({ error: "#N/A" }) === null, "no saved result / error = blank, never computed");
  ok(excelCellValue(new Date(Date.UTC(2025, 2, 1))) === "2025-03-01" && excelCellValue({ text: "x", hyperlink: "http://y" }) === "x", "date + hyperlink");
  ok(excelCellValue(Number.NaN) === null && excelCellValue(undefined) === null, "NaN / undefined blank");
  ok(isOldExcel(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])) && !isOldExcel(new Uint8Array([0x50, 0x4b, 3, 4])), "old .xls detected by its OLE2 signature");

  // batch line
  ok(readBatchLine({ ok: true, waiting: 0, read: 0, parsed: 0, unreadable: 0, failed: 0, llamaparse: 0, unpdf: 0, left: 0, stoppedBecause: null }).startsWith("Nothing to read"), "nothing waiting");
  const line = readBatchLine({ ok: true, waiting: 20, read: 12, parsed: 9, unreadable: 3, failed: 0, llamaparse: 11, unpdf: 1, left: 8, stoppedBecause: null });
  ok(/Read 12 kept documents: 9 with barcodes, 3 without \(LlamaParse 11, text layer 1\) 8 left; press again\./.test(line), "batch line");
  ok(/Finished/.test(readBatchLine({ ok: true, waiting: 2, read: 2, parsed: 2, unreadable: 0, failed: 0, llamaparse: 2, unpdf: 0, left: 0, stoppedBecause: null })), "finished line");

  // R74 S19: parallel reads inside the budget
  ok(READ_CONCURRENCY === 5 && READ_BATCH_MAX_DOCS === 100 && READ_BATCH_TIME_BUDGET_MS === 180_000, "S19 limits");
  ok(READ_BATCH_TIME_BUDGET_MS + 90_000 + 25_000 <= 300_000, "a document started at the budget still ends inside the 300 s page");
  ok(readMayStart({ elapsedMs: 0, budgetMs: 10, stopped: false, next: 0, total: 3 }) === "go", "start when time and documents remain");
  ok(readMayStart({ elapsedMs: 10, budgetMs: 10, stopped: false, next: 0, total: 3 }) === "go", "exactly at the budget still starts");
  ok(readMayStart({ elapsedMs: 11, budgetMs: 10, stopped: false, next: 0, total: 3 }) === "budget", "past the budget stops");
  ok(readMayStart({ elapsedMs: 11, budgetMs: 10, stopped: false, next: 3, total: 3 }) === "done", "no documents left wins over the budget");
  ok(readMayStart({ elapsedMs: 0, budgetMs: 10, stopped: true, next: 0, total: 3 }) === "stopped", "a storage outage stops every worker");
  ok(readWidth(5, 100) === 5 && readWidth(5, 2) === 2 && readWidth(5, 0) === 0, "width = min(cap, documents)");
  ok(readWidth(50, 100) === 5 && readWidth(0, 9) === 1 && readWidth(-3, 9) === 1 && readWidth(Number.NaN, 9) === 5, "width never above the cap, never below 1");

  return { passed, failed };
}
