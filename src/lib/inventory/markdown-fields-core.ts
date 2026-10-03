/**
 * src/lib/inventory/markdown-fields-core.ts  (R26, PURE)
 *
 * WHY THIS EXISTS (the root cause behind "LlamaParse doesn't find the invoice
 * number / delivery details"):
 *
 * Since #799 LlamaParse markdown is the PRIMARY text for every intake PDF. Our
 * field scanners (Invoice/Order #, the generic transport label reader, the
 * Cultivera invoice reader) were written for unpdf's FLAT text, where a label
 * and its value sit side by side ("Invoice #: 20636"). LlamaParse emits
 * MARKDOWN instead, and markdown hides the label/value adjacency the scanners
 * rely on:
 *
 *   **Invoice #:** 20636                      bold markers between label and value
 *   Invoice \# 20636                          escaped "#"
 *   | Invoice # | 20636 |                     a two-cell table row
 *   | Driver Name: | Chris | VIN #: | W1Y.. | a four-cell "form" row
 *   | Invoice # | Order Date |               header row + value row: the value
 *   |---|---|                                sits in a DIFFERENT line from its
 *   | 20636 | 3/11/25 |                       label, aligned only by column
 *   <table><tr><th>Invoice #</th>...          HTML tables (LlamaParse may emit
 *                                             HTML for complex tables)
 *
 * The roadmap (docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md, "R-LLAMA") planned a
 * normalizer for exactly this; it was never built. This is it.
 *
 * WHAT IT DOES (two outputs, both deterministic):
 *
 *  1. normalizeMarkdownFields(text) -> text the EXISTING regex scanners read
 *     correctly. Tables become "Label: value" lines (pair rows by pairs,
 *     header+value tables by column), emphasis/escapes/heading markers are
 *     removed, separator rows are dropped. Text that has NO markdown markers
 *     (unpdf flat text) is returned BYTE-FOR-BYTE unchanged, so the scanners'
 *     verified behaviour on real vendor PDFs cannot regress (idempotent).
 *
 *  2. extractKeyValuePairs(text) -> [{label, value}] — the "key-value pairs"
 *     output enterprise document-AI services expose (Azure Document
 *     Intelligence key-value pairs, LlamaParse forms). Each value is bounded by
 *     its table cell / line, so a reader never has to guess where a value ends
 *     (the run-on problem of flat text). Only STRUCTURAL pairs are emitted:
 *     table pair rows, header->value columns, and whole-line "Label: value"
 *     lines of multi-line (markdown) text.
 *
 * NEVER-GUESS RULES:
 *  - a pair exists only where the document itself puts a label next to a value
 *    (same row, adjacent cell; or the header of the value's own column);
 *  - empty cells never become values; a cell that itself looks like a label
 *    is never taken as another label's value;
 *  - "<Vendor Sample>"-style angle-bracket text that is NOT an HTML table tag
 *    is left untouched (real Cultivera product names contain it).
 *
 * PURE: no I/O. Self-tests: __runMarkdownFieldsTests (pure runner).
 */

export type KeyValuePair = {
  /** Label as printed, without the trailing ":" (e.g. "Invoice #", "Driver Name"). */
  label: string;
  /** Value as printed, whitespace-collapsed (never empty). */
  value: string;
};

// ── Small helpers ───────────────────────────────────────────────────────────

const ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&#35;": "#",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#35);/g, (m) => ENTITY[m] ?? m);
}

/** Remove inline markdown emphasis + escapes from a single cell / line. */
function stripInline(s: string): string {
  let t = s;
  // Markdown escapes: \# \* \_ \| \[ \] \( \) \- \. \! \+ \` \~ \>
  t = t.replace(/\\([#*_|[\]()\-.!+`~>])/g, "$1");
  // Bold / strong first, then italics. Only PAIRED markers are removed so a
  // lone "*" (e.g. a footnote) is never eaten.
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  t = t.replace(/__([^_\n]+?)__/g, "$1");
  t = t.replace(/(^|[\s(|])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,:;|])/g, "$1$2");
  t = t.replace(/(^|[\s(|])_(?!\s)([^_\n]+?)_(?=$|[\s).,:;|])/g, "$1$2");
  // Inline code ticks.
  t = t.replace(/`([^`\n]+)`/g, "$1");
  // Inline HTML that LlamaParse uses inside cells.
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<\/?(?:b|strong|em|i|u|span|p|div|sup|sub)(?:\s[^>]*)?>/gi, "");
  t = decodeEntities(t);
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Is this cell a LABEL? Grounded in how real vendor forms print labels:
 * a trailing ":" or "#" ("Driver Name:", "Invoice #", "VIN #:"), or a trailing
 * "No."/"Number"/"ID" ("Invoice No.", "Manifest ID"). A cell with a trailing
 * label marker but that is mostly digits (a value like "#413541") is not a label.
 */
export function isLabelCell(cell: string): boolean {
  const c = cell.trim();
  if (c.length < 2 || c.length > 48) return false;
  if (!/[A-Za-z]/.test(c)) return false;
  // Must START with a letter: "#413541" or "123 Main St:" are not labels.
  if (!/^[A-Za-z]/.test(c)) return false;
  if (/(?:[:#]|#\s*:)$/.test(c)) return true;
  if (/\b(?:No\.?|Number|ID)$/i.test(c) && !/\d/.test(c)) return true;
  return false;
}

/** "Invoice #:" -> "Invoice #"; "Driver Name:" -> "Driver Name". */
function cleanLabel(cell: string): string {
  return cell.replace(/\s*:\s*$/, "").trim();
}

/** Split a pipe-table line into cells (respects escaped "\|"). */
function splitPipeRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => stripInline(c));
}

function isSeparatorRow(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.length > 0);
  return nonEmpty.length > 0 && nonEmpty.every((c) => /^:?-{2,}:?$/.test(c));
}

type Table = { header: string[] | null; rows: string[][] };

/**
 * A PAIR row: label, value, label, value ... Every even cell (that has
 * content) is a label and every odd cell is NOT itself a label. Empty
 * trailing pairs are allowed (a blank form field).
 */
function isPairRow(cells: string[]): boolean {
  if (cells.length < 2 || cells.length % 2 !== 0) return false;
  let labels = 0;
  for (let i = 0; i < cells.length; i += 2) {
    const l = cells[i];
    const v = cells[i + 1];
    if (l.length === 0 && v.length === 0) continue; // fully blank pair
    if (!isLabelCell(l)) return false;
    if (v.length > 0 && isLabelCell(v)) return false;
    labels += 1;
  }
  return labels > 0;
}

/**
 * Classify one row of a table: its pairs, or null when the row is not a
 * pairing row (kept as plain text by the renderer). The header line of a
 * header->value table returns [] (its labels attach to the rows below).
 */
function rowPairs(
  row: string[],
  columnHeader: string[] | null,
  isHeaderLine: boolean,
): KeyValuePair[] | null {
  if (isPairRow(row)) {
    const out: KeyValuePair[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const l = row[i];
      const v = row[i + 1];
      if (l && v) out.push({ label: cleanLabel(l), value: v });
    }
    return out;
  }
  if (isHeaderLine) return [];
  if (columnHeader) {
    // A row whose cells are all labels is a second header line, not values.
    if (row.every((c) => c.length === 0 || isLabelCell(c))) return null;
    const out: KeyValuePair[] = [];
    for (let i = 0; i < row.length && i < columnHeader.length; i += 1) {
      const h = columnHeader[i];
      const v = row[i];
      if (h && v && /[A-Za-z]/.test(h)) out.push({ label: cleanLabel(h), value: v });
    }
    return out;
  }
  return null;
}

/**
 * Is the first (header) row really a label|value PAIR row (LlamaParse renders
 * a form's first line as the markdown header) rather than column headers?
 * Only when it is pair-shaped AND either the body rows are pair rows too, or
 * its value cells carry a digit (a real value, never a column title).
 * "| Invoice # | Order Date |" over "| 20636 | 3/11/25 |" is column headers.
 */
function headerIsPairRow(table: Table): boolean {
  const h = table.header;
  if (!h || !isPairRow(h)) return false;
  const blank = (r: string[]) => r.every((c) => c.length === 0);
  if (table.rows.every((r) => blank(r) || isPairRow(r))) return true;
  return h.some((c, i) => i % 2 === 1 && /\d/.test(c));
}

/** A column-header row: every non-empty cell is wordy (no value-shaped cell). */
function isColumnHeader(row: string[]): boolean {
  const cells = row.filter((c) => c.length > 0);
  return cells.length > 0 && cells.every((c) => /[A-Za-z]/.test(c) && !/\d{3,}/.test(c));
}

function tableRows(table: Table): { row: string[]; pairs: KeyValuePair[] | null }[] {
  const header = table.header;
  const hPair = headerIsPairRow(table);
  const columnHeader = header && !hPair && isColumnHeader(header) ? header : null;
  const out: { row: string[]; pairs: KeyValuePair[] | null }[] = [];
  if (header) {
    out.push({
      row: header,
      pairs: hPair ? rowPairs(header, null, false) : columnHeader ? [] : null,
    });
  }
  for (const row of table.rows) out.push({ row, pairs: rowPairs(row, columnHeader, false) });
  return out;
}

/** Pairs from one table (pair rows + header->value columns). */
function tablePairs(table: Table): KeyValuePair[] {
  return tableRows(table).flatMap((r) => r.pairs ?? []);
}

/** Render a table back as text the flat scanners understand. Rows that are
 * not pairing rows keep their cells as plain text so nothing is lost. */
function renderTable(table: Table): string {
  const lines: string[] = [];
  for (const { row, pairs } of tableRows(table)) {
    if (pairs) {
      for (const p of pairs) lines.push(`${p.label}: ${p.value}`);
      continue;
    }
    const plain = row.filter((c) => c.length > 0).join(" ");
    if (plain) lines.push(plain);
  }
  return lines.join("\n");
}

// ── HTML tables ─────────────────────────────────────────────────────────────

const HTML_TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;

function parseHtmlTable(inner: string): Table {
  const rows: { cells: string[]; th: boolean }[] = [];
  for (const tr of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    let allTh = true;
    for (const td of tr[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
      if (td[1].toLowerCase() !== "th") allTh = false;
      cells.push(stripInline(td[2].replace(/<[^>]+>/g, (tag) => (/^<br/i.test(tag) ? " " : ""))));
    }
    if (cells.length > 0) rows.push({ cells, th: allTh });
  }
  if (rows.length > 0 && rows[0].th) {
    return { header: rows[0].cells, rows: rows.slice(1).map((r) => r.cells) };
  }
  return { header: null, rows: rows.map((r) => r.cells) };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * True when the text carries markdown/HTML structure we normalize. unpdf flat
 * text has none of these, which is what makes normalization a no-op there.
 */
export function hasMarkdownStructure(text: string): boolean {
  if (!text) return false;
  return (
    /(?:^|\n)\s*\|.*\|/.test(text) || // pipe table row
    /\*\*[^*\n]+\*\*/.test(text) || // bold
    /__[^_\n]+__/.test(text) ||
    /\\[#*_|]/.test(text) || // escapes
    /<table\b/i.test(text) ||
    /(?:^|\n)#{1,6}\s+\S/.test(text) // heading
  );
}

type Block = { kind: "table"; table: Table } | { kind: "line"; text: string };

function toBlocks(text: string): Block[] {
  // Pull HTML tables out first, replacing them with a placeholder line.
  const htmlTables: Table[] = [];
  const withoutHtml = text.replace(HTML_TABLE_RE, (_m, inner: string) => {
    htmlTables.push(parseHtmlTable(inner));
    return `\n\u0000HTMLTABLE${htmlTables.length - 1}\u0000\n`;
  });

  const blocks: Block[] = [];
  const lines = withoutHtml.split(/\r?\n/);
  let pipeRows: string[][] = [];
  const flushPipe = () => {
    if (pipeRows.length === 0) return;
    // header = first row when the SECOND row is a separator.
    let header: string[] | null = null;
    let body = pipeRows;
    if (pipeRows.length >= 2 && isSeparatorRow(pipeRows[1])) {
      header = pipeRows[0];
      body = pipeRows.slice(2);
    }
    body = body.filter((r) => !isSeparatorRow(r));
    blocks.push({ kind: "table", table: { header, rows: body } });
    pipeRows = [];
  };
  for (const raw of lines) {
    const ph = raw.match(/^\u0000HTMLTABLE(\d+)\u0000$/);
    if (ph) {
      flushPipe();
      blocks.push({ kind: "table", table: htmlTables[Number(ph[1])] });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      pipeRows.push(splitPipeRow(raw));
      continue;
    }
    flushPipe();
    blocks.push({ kind: "line", text: raw });
  }
  flushPipe();
  return blocks;
}

function normalizeLine(raw: string): string {
  let t = raw;
  t = t.replace(/^\s*#{1,6}\s+/, ""); // heading marker
  t = t.replace(/^\s*>\s?/, ""); // blockquote
  t = t.replace(/^\s*(?:[-*+]|\d{1,3}\.)\s+(?=\S)/, ""); // list bullet
  t = t.replace(/^\s*\[\d{1,4}\]\s+/, ""); // LlamaParse forms list "[1] "
  return stripInline(t);
}

/**
 * Normalize LlamaParse markdown (or HTML-table markdown) into flat
 * "Label: value" text for the existing regex scanners. Text with NO markdown
 * structure (unpdf flat text) is returned unchanged.
 */
export function normalizeMarkdownFields(text: string | null | undefined): string {
  if (!text) return "";
  if (!hasMarkdownStructure(text)) return text;
  const out: string[] = [];
  for (const b of toBlocks(text)) {
    if (b.kind === "table") {
      const r = renderTable(b.table);
      if (r) out.push(r);
    } else {
      const l = normalizeLine(b.text);
      if (l) out.push(l);
    }
  }
  return out.join("\n");
}

/** Whole-line "Label: value" (or "Label # value") in multi-line text. */
const LINE_PAIR_RE =
  /^([A-Za-z][A-Za-z0-9 .'/&()-]{0,46}?(?:\s*#)?)\s*:\s*(\S.{0,150})$/;
const LINE_HASH_PAIR_RE = /^([A-Za-z][A-Za-z .'/&()-]{0,40}?#)\s*(\S.{0,150})$/;

/**
 * Structural key-value pairs from markdown: table pair rows, header->value
 * columns, and whole-line "Label: value" lines. Flat single-line text yields
 * no line pairs (a 3,000-char unpdf line is not a field) — the flat regex
 * scanners stay responsible for that shape.
 */
export function extractKeyValuePairs(text: string | null | undefined): KeyValuePair[] {
  if (!text) return [];
  const out: KeyValuePair[] = [];
  const multiLine = /\n/.test(text.trim());
  for (const b of toBlocks(text)) {
    if (b.kind === "table") {
      out.push(...tablePairs(b.table));
      continue;
    }
    if (!multiLine) continue;
    const l = normalizeLine(b.text);
    if (!l || l.length > 200) continue;
    const m = l.match(LINE_PAIR_RE) ?? l.match(LINE_HASH_PAIR_RE);
    if (!m) continue;
    const label = cleanLabel(m[1]);
    const value = m[2].trim();
    // A value that is itself "Label:" (a blank form field followed by the next
    // label on the same line) is NOT a value.
    if (!value || /^[A-Za-z][A-Za-z .'/#-]{0,40}:/.test(value)) continue;
    if (/\d{1,2}$/.test(label) && /^\d{2}\b/.test(value)) continue; // "07:00" time, not a label
    out.push({ label, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runMarkdownFieldsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: markdown-fields", msg);
    }
  };
  const has = (pairs: KeyValuePair[], label: string, value: string) =>
    pairs.some((p) => p.label === label && p.value === value);

  // Idempotent on unpdf flat text (verbatim slices of the real QGT invoice
  // and an LCB-style line with "<DOH Compliant>" product text).
  const flat =
    "INVOICE Created By: March 11, 2025 20636Order #: Order Date: Cultivera Support " +
    "Manifest #: 15410217973875889GREENWAY MARIJUANA Plate: A3169588 Freddy's FUEGO Pack <DOH Compliant>";
  ok(normalizeMarkdownFields(flat) === flat, "flat text returned byte-for-byte");
  ok(!hasMarkdownStructure(flat), "flat text has no markdown structure");
  ok(extractKeyValuePairs(flat).length === 0, "flat single-line text yields no line pairs");
  ok(normalizeMarkdownFields("") === "" && normalizeMarkdownFields(null) === "", "empty/null");

  // Bold + escaped hash.
  ok(normalizeMarkdownFields("**Invoice #:** 20636") === "Invoice #: 20636", "bold label");
  ok(normalizeMarkdownFields("Invoice \\# 20636\nnext") === "Invoice # 20636\nnext", "escaped #");
  ok(normalizeMarkdownFields("## Manifest Details\n**Driver:** Chris") === "Manifest Details\nDriver: Chris", "heading + bold");

  // Two-cell rows (no header separator).
  const two = "| Invoice # | 20636 |\n| Order Date | 3/11/25 |";
  ok(normalizeMarkdownFields(two).split("\n")[0] === "Invoice #: 20636", "2-cell label|value row");

  // Four-cell form rows, with the first row taken as a markdown header.
  const form =
    "| Driver Name: | Chris Gibilterra | VIN #: | W1Y40BHY9LT036548 |\n" +
    "|---|---|---|---|\n" +
    "| Vehicle License Plate: | A3169588 | Vehicle Color: | White |\n" +
    "| Vehicle Make: | Mercedes Benz | Vehicle Model: | Sprinters250 |\n" +
    "| License Name: |  | License #: |  |";
  const fp = extractKeyValuePairs(form);
  ok(has(fp, "Driver Name", "Chris Gibilterra"), "form header row is a pair row");
  ok(has(fp, "VIN #", "W1Y40BHY9LT036548"), "VIN pair");
  ok(has(fp, "Vehicle License Plate", "A3169588"), "plate pair");
  ok(has(fp, "Vehicle Model", "Sprinters250"), "model pair");
  ok(!fp.some((p) => p.label === "License Name" || p.label === "License #"), "blank form cells -> no pair");
  const fn = normalizeMarkdownFields(form);
  ok(fn.includes("Driver Name: Chris Gibilterra\nVIN #: W1Y40BHY9LT036548"), "form rendered as lines");
  ok(!fn.includes("---"), "separator dropped");

  // Header row + value row mapped by column.
  const hv = "| Invoice # | Order Date | Manifest # |\n| --- | :---: | ---: |\n| 20636 | 3/11/25 | 15410217973875889 |";
  const hvp = extractKeyValuePairs(hv);
  ok(has(hvp, "Invoice #", "20636"), "header->value: invoice #");
  ok(has(hvp, "Manifest #", "15410217973875889"), "header->value: manifest #");
  ok(normalizeMarkdownFields(hv).startsWith("Invoice #: 20636\nOrder Date: 3/11/25"), "header->value rendered");
  // Two labels in a header (Invoice # | Order #) are NOT a pair row.
  const hv2 = "| Invoice # | Order # |\n|---|---|\n| INV-77 | 5521 |";
  const hv2p = extractKeyValuePairs(hv2);
  ok(has(hv2p, "Invoice #", "INV-77") && has(hv2p, "Order #", "5521"), "label|label header -> by column");
  ok(!hv2p.some((p) => p.value === "Order #"), "a label is never another label's value");

  // A pair-shaped first row whose body is NOT pairs and whose value cell is a
  // word is column headers ("Invoice # | Order Date"); a pair-shaped header
  // carrying a digit value is data, and its non-pair body never maps by column.
  const edge = "| Invoice # | 20636 |\n|---|---|\n| Order Date | 3/11/25 |";
  const ep = extractKeyValuePairs(edge);
  ok(has(ep, "Invoice #", "20636"), "digit-valued header row is a pair");
  ok(!ep.some((p) => p.value === "Order Date"), "never maps a label as a value by column");

  // HTML table (LlamaParse may emit HTML for complex tables).
  const html =
    "<table><tr><th>Invoice #</th><th>Order Date</th></tr><tr><td>20636</td><td>3/11/25</td></tr></table>\n" +
    "<table><tr><td><b>Driver:</b></td><td>Chris&nbsp;Gibilterra</td></tr></table>";
  const hp = extractKeyValuePairs(html);
  ok(has(hp, "Invoice #", "20636"), "html header->value");
  ok(has(hp, "Driver", "Chris Gibilterra"), "html pair row + entity decode + inner tag");
  ok(normalizeMarkdownFields(html).includes("Invoice #: 20636"), "html rendered");

  // Line pairs in multi-line markdown; forms-list prefix; times are not labels.
  const lines = "- [1] Driver Name: Chris Gibilterra\n**Arrival Date/Time:** 03/13/2025 04:00 pm\nOrder #: Order Date:";
  const lp = extractKeyValuePairs(lines);
  ok(has(lp, "Driver Name", "Chris Gibilterra"), "forms list line");
  ok(has(lp, "Arrival Date/Time", "03/13/2025 04:00 pm"), "bold line pair keeps the time");
  ok(!lp.some((p) => p.label === "Order #"), "valueless label line yields no pair");

  // Line-item tables are kept as text; numeric cells never become labels.
  const items = "| Lot | Product | Qty |\n|---|---|---|\n| 15410167200667924 | Freddy's FUEGO Pack | 15.00 |";
  const ip = extractKeyValuePairs(items);
  ok(has(ip, "Product", "Freddy's FUEGO Pack"), "item table by column");
  ok(isLabelCell("Invoice #") && isLabelCell("VIN #:") && isLabelCell("Manifest ID"), "label cells");
  ok(!isLabelCell("#413541") && !isLabelCell("20636") && !isLabelCell("Chris Gibilterra"), "non-label cells");
  ok(!isLabelCell("123 Main St:"), "a value starting with digits is not a label");

  // Idempotence: normalizing normalized output changes nothing.
  for (const s of [form, hv, html, two, lines]) {
    const once = normalizeMarkdownFields(s);
    ok(normalizeMarkdownFields(once) === once, `idempotent: ${s.slice(0, 20)}`);
  }

  console.log(`markdown-fields self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
