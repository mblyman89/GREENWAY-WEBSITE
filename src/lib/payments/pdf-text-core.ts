/**
 * src/lib/payments/pdf-text-core.ts  (R39 S6, PURE)
 *
 * A very small PDF 1.4 writer for TEXT records: the e-signed direct deposit
 * authorization and its signing certificate. No dependency: the repo has none
 * that writes PDFs, and the sandbox has little disk. The output is checked in
 * vitest by reading it back with unpdf (pdf.js), the same reader the intake
 * uses.
 *
 * Why this is enough for a legal record:
 *  - E-SIGN 15 U.S.C. 7001(d)/(e) and RCW 1.80.110 ask that an electronic
 *    record "accurately reflects" the information and stays "accessible" and
 *    able to be "accurately reproduced". A plain text PDF that anyone can
 *    open, print or save does that. Its SHA-256 is stored, and the file is
 *    never replaced (0258 ach_doc_guard).
 *  - It is deterministic. The same input gives the same bytes, so a record
 *    can be re-built and its hash compared.
 *
 * Layout: US Letter (612 x 792 pt). Body text is Courier, where every
 * character is exactly 0.6 em wide, so line wrapping is exact, not guessed.
 * Headings use Helvetica-Bold and are limited in length so they always fit.
 * Text is WinAnsi (Windows-1252). Characters outside it are replaced with
 * plain ASCII, so nothing renders as a blank box.
 */

export type PdfLine =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "mono"; text: string } // printed as-is: no re-wrapping beyond the page width
  | { kind: "gap" }
  | { kind: "rule" }
  | { kind: "pagebreak" };

export type PdfDocInput = {
  title: string;
  /** ISO time; becomes /CreationDate. Passed in so the bytes are reproducible. */
  createdAtIso: string;
  lines: readonly PdfLine[];
  /** Printed small at the bottom of every page, with "Page n of m". */
  footer: string;
};

export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN = 54; // 0.75 in
export const BODY_PT = 9;
export const BODY_LEADING = 12;
export const COURIER_EM = 0.6;
/** Characters of Courier 9 pt that fit between the margins: floor(504 / 5.4) = 93. */
export const BODY_COLS = Math.floor((PAGE_W - 2 * MARGIN) / (BODY_PT * COURIER_EM));
export const H1_PT = 14;
export const H2_PT = 11;
/** Helvetica-Bold's widest glyphs (W, M) are under 0.95 em; this many always fit at 14 pt. */
export const H1_MAX = Math.floor((PAGE_W - 2 * MARGIN) / (H1_PT * 0.95));
export const H2_MAX = Math.floor((PAGE_W - 2 * MARGIN) / (H2_PT * 0.95));

/** Windows-1252 code points above 0x7F that differ from Latin-1. */
const CP1252: Readonly<Record<string, number>> = {
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85, "\u2020": 0x86,
  "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95,
  "\u2013": 0x96, "\u2014": 0x97, "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b,
  "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f,
};
/** Characters with no WinAnsi glyph, spelled out in ASCII. */
const ASCII_FALLBACK: Readonly<Record<string, string>> = {
  "\u2265": ">=", "\u2264": "<=", "\u2192": "->", "\u2190": "<-", "\u2713": "[x]", "\u2717": "[ ]",
  "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u2212": "-", "\u2011": "-",
};

/** Map one string to WinAnsi byte values. Unknown characters become "?". Controls become spaces. */
export function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of String(s)) {
    const fb = ASCII_FALLBACK[ch];
    if (fb !== undefined) {
      for (const c of fb) out.push(c.charCodeAt(0));
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp === 9) { out.push(32); continue; }
    if (cp < 32 || cp === 127) { out.push(32); continue; }
    if (cp < 127) { out.push(cp); continue; }
    if (CP1252[ch] !== undefined) { out.push(CP1252[ch]); continue; }
    if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue; }
    out.push(63); // "?"
  }
  return out;
}

/** A PDF literal string body: ( ) \ escaped, bytes over 0x7E as octal. */
export function pdfLiteral(bytes: readonly number[]): string {
  let s = "";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s;
}

/** Word-wrap to `cols` characters (counted in WinAnsi bytes); a word longer than a line is split. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/ +/).filter((w) => w.length > 0);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (let w of words) {
      while (toWinAnsi(w).length > cols) {
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!line) line = w;
      else if (toWinAnsi(line + " " + w).length <= cols) line += " " + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

/** D:YYYYMMDDHHmmSSZ from an ISO time (UTC). Bad input gives null. */
export function pdfDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

type Placed = { font: "F1" | "F2"; size: number; x: number; y: number; text: string } | { rule: true; y: number };

/** Lay lines out on pages. Pure; exported for tests. */
export function layout(lines: readonly PdfLine[]): Placed[][] {
  const pages: Placed[][] = [[]];
  const top = PAGE_H - MARGIN;
  const bottom = MARGIN + 24; // leave room for the footer
  let y = top;
  const page = () => pages[pages.length - 1];
  const need = (h: number) => {
    if (y - h < bottom) { pages.push([]); y = top; }
  };
  for (const ln of lines) {
    if (ln.kind === "pagebreak") { if (page().length) { pages.push([]); y = top; } continue; }
    if (ln.kind === "gap") { y -= BODY_LEADING / 2; continue; }
    if (ln.kind === "rule") { need(8); y -= 4; page().push({ rule: true, y }); y -= 6; continue; }
    if (ln.kind === "h1" || ln.kind === "h2") {
      const size = ln.kind === "h1" ? H1_PT : H2_PT;
      const max = ln.kind === "h1" ? H1_MAX : H2_MAX;
      for (const t of wrap(ln.text, max)) {
        need(size + 6);
        y -= size + 4;
        page().push({ font: "F2", size, x: MARGIN, y, text: t });
      }
      y -= 2;
      continue;
    }
    const rows = ln.kind === "mono" ? wrap(ln.text, BODY_COLS) : wrap(ln.text, BODY_COLS);
    for (const t of rows) {
      need(BODY_LEADING);
      y -= BODY_LEADING;
      page().push({ font: "F1", size: BODY_PT, x: MARGIN, y, text: t });
    }
  }
  if (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return pages;
}

/** Build the PDF bytes. Deterministic for the same input. */
export function buildTextPdf(input: PdfDocInput): Uint8Array {
  const created = pdfDate(input.createdAtIso);
  if (!created) throw new Error("buildTextPdf: createdAtIso is not a valid time.");
  const pages = layout(input.lines);
  const n = pages.length;
  // Object numbers: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then per page: page obj, content obj.
  const objs: string[] = [];
  const pageIds: number[] = [];
  for (let i = 0; i < n; i++) pageIds.push(6 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  objs[5] = `<< /Title (${pdfLiteral(toWinAnsi(input.title))}) /Producer (Greenway R39 pdf-text-core) /CreationDate (${created}) >>`;
  pages.forEach((placed, i) => {
    const ops: string[] = [];
    for (const p of placed) {
      if ("rule" in p) {
        ops.push(`0.5 w ${MARGIN} ${p.y} m ${PAGE_W - MARGIN} ${p.y} l S`);
      } else {
        ops.push(`BT /${p.font} ${p.size} Tf ${p.x} ${p.y} Td (${pdfLiteral(toWinAnsi(p.text))}) Tj ET`);
      }
    }
    const foot = wrap(`${input.footer}  |  Page ${i + 1} of ${n}`, Math.floor((PAGE_W - 2 * MARGIN) / (7 * COURIER_EM)))[0] ?? "";
    ops.push(`BT /F1 7 Tf ${MARGIN} ${MARGIN} Td (${pdfLiteral(toWinAnsi(foot))}) Tj ET`);
    const stream = ops.join("\n");
    const len = Buffer.byteLength(stream, "latin1");
    objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objs[pageIds[i] + 1] = `<< /Length ${len} >>\nstream\n${stream}\nendstream`;
  });
  const total = objs.length - 1;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id <= total; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runPdfTextCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else { failed++; console.error("pdf-text-core FAIL:", name); }
  };
  ok(BODY_COLS === 93, "93 Courier columns at 9 pt between 0.75 in margins");
  ok(toWinAnsi("A").join() === "65", "ascii");
  ok(toWinAnsi("\u201cx\u201d").join() === "147,120,148", "curly quotes -> cp1252");
  ok(toWinAnsi("\u00a7").join() === "167", "section sign latin-1");
  ok(toWinAnsi("\u2265").map((b) => String.fromCharCode(b)).join("") === ">=", ">= fallback");
  ok(toWinAnsi("\u4e2d").join() === "63", "cjk -> ?");
  ok(toWinAnsi("a\u0007b").join() === "97,32,98", "control -> space");
  ok(pdfLiteral([40, 41, 92]) === "\\(\\)\\\\", "escapes parens and backslash");
  ok(pdfLiteral([167]) === "\\247", "octal for high bytes");
  ok(pdfLiteral([10]) === "\\012", "octal for newline");
  const w = wrap("aaa bbb ccc", 7);
  ok(w.join("|") === "aaa bbb|ccc", "wrap at word boundary");
  ok(wrap("abcdefghij", 4).join("|") === "abcd|efgh|ij", "long word is split");
  ok(wrap("a\n\nb", 10).join("|") === "a||b", "blank lines kept");
  ok(wrap("x".repeat(93), BODY_COLS).length === 1 && wrap("x".repeat(94), BODY_COLS).length === 2, "exact column limit");
  ok(pdfDate("2026-01-15T08:09:10.000Z") === "D:20260115080910Z", "pdf date");
  ok(pdfDate("nope") === null, "bad date");
  const many: PdfLine[] = Array.from({ length: 200 }, (_, i) => ({ kind: "p", text: `line ${i}` }) as PdfLine);
  const pg = layout(many);
  ok(pg.length >= 3, "long text spans pages");
  ok(pg.every((p) => p.every((x) => "rule" in x || (x.y >= MARGIN + 24 && x.y <= PAGE_H - MARGIN))), "nothing in the margins or footer");
  ok(layout([{ kind: "p", text: "a" }, { kind: "pagebreak" }, { kind: "p", text: "b" }]).length === 2, "page break");
  ok(layout([{ kind: "pagebreak" }, { kind: "p", text: "b" }]).length === 1, "leading page break ignored");
  const input: PdfDocInput = { title: "T (x)", createdAtIso: "2026-01-15T08:09:10.000Z", lines: [{ kind: "h1", text: "Hi" }, { kind: "p", text: "Body \u00a7 7001" }], footer: "F" };
  const a = buildTextPdf(input);
  const b = buildTextPdf(input);
  ok(Buffer.from(a).equals(Buffer.from(b)), "deterministic bytes");
  const s = Buffer.from(a).toString("latin1");
  ok(s.startsWith("%PDF-1.4\n") && s.trimEnd().endsWith("%%EOF"), "header and trailer");
  const sx = Number(/startxref\n(\d+)\n/.exec(s)?.[1]);
  ok(s.slice(sx, sx + 4) === "xref", "startxref points at xref");
  const offs = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  ok(offs.length > 0 && offs.every((o, i) => s.slice(o).startsWith(`${i + 1} 0 obj`)), "every xref offset is exact");
  const lens = [...s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
  ok(lens.length > 0 && lens.every((m) => s.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10) === "\nendstream"), "stream lengths are exact");
  ok(s.includes("(T \\(x\\))"), "title escaped");
  ok(s.includes("Body \\247 7001"), "section sign encoded");
  let threw = false;
  try { buildTextPdf({ ...input, createdAtIso: "x" }); } catch { threw = true; }
  ok(threw, "bad date refused");
  console.log(`pdf-text-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
