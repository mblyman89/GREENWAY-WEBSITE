/**
 * src/lib/inventory/coa-pdf-text-core.ts  (Round 28)
 *
 * PURE. Reads the TEXT of a lab Certificate of Analysis PDF into typed facts.
 *
 * WHY (owner, R28): "they contain the total thc, per piece thc, and all the
 * cannabinoids and terpenes ... I want our intelligent system to extract that
 * data and use it to fill the facts it doesn't get from the json text."
 * The WCIA lab JSON (wcia-lab-json-core.ts) carries percentages only. The
 * PDF is the ONLY place the lab prints milligrams PER SERVING and the
 * serving weight - exactly the facts the edible holds were waiting on.
 *
 * ONE READER, THREE TEXT SHAPES. The text arrives from one of:
 *   - unpdf (production extractPdfText): one flat line, label then value;
 *   - pdftotext -layout: columns padded with spaces, labels and values on
 *     different lines;
 *   - LlamaParse (when LLAMA_CLOUD_API_KEY is set): markdown, where tables are
 *     "| a | b |" rows (sometimes HTML <td> cells) and labels may be **bold**.
 * normalizeCoaText() folds all three into one whitespace-collapsed token
 * stream, and every table reader below works on rows of TOKENS, never on
 * character positions. Header fields whose value is not adjacent to its label
 * in a layout text are read only by a pattern that cannot match anything else
 * (e.g. the serving weight is the one "<n>g / N/A" token on the page); when a
 * pattern is not unique the field is null with a warning - never a pick.
 *
 * TEMPLATES RECOGNISED (every one verified on the owner's real documents,
 * fixtures in tests/fixtures/coa/):
 *   - "confidence-8": Confidence Analytics, "Template Version: 8.0". Potency
 *     table "Analyte Name % mg/g mg/serving mg/package LoQ (%)" (16 of 17
 *     owner documents), terpene table "Result (ppm) loq (ppm)".
 *   - "ggl": Green Grower Labs. Its PDF draws the potency numbers as vector
 *     art: unpdf returns NO numbers (verified), pdftotext -layout does. The
 *     reader takes the numbers when present and otherwise says so - the GGL
 *     lab JSON carries the same potency, so nothing is lost.
 * Anything else: { ok: false, reason } - an unknown COA is shown to staff, it
 * is never half-read.
 *
 * Internal consistency (checks[]): the lab prints % AND mg/g (mg/g must be
 * 10 x %) AND mg/serving (must be mg/g x serving grams). Each row is checked
 * against the lab's own rounding (2 significant figures) so a mis-read column
 * can never become a fact silently.
 */

import { cannabinoidKey, type CannabinoidKey } from "./wcia-lab-json-core";

export type CoaTemplate = "confidence-8" | "ggl";
export type CoaTotalRow = "total-cannabinoids" | "total-thc" | "total-cbd";

export type CoaPotencyRow = {
  /** Label as printed ("d9-thca", "Total THC"). */
  label: string;
  /** Canonical key - an individual cannabinoid or one of the three totals. */
  key: CannabinoidKey | CoaTotalRow;
  /** null = N/A (not reported), 0 with nd = Not Detected. */
  pct: number | null;
  mgPerG: number | null;
  mgPerServing: number | null;
  mgPerPackage: number | null;
  loqPct: number | null;
  nd: boolean;
};

export type CoaTerpeneRow = { name: string; ppm: number; nd: boolean; loqPpm: number | null; pass: boolean };

export type CoaCheck = { what: string; ok: boolean; detail: string };

export type CoaPdfDoc = {
  template: CoaTemplate;
  labName: string;
  labSampleId: string | null;
  batchId: string | null;
  sampleName: string | null;
  productType: string | null;
  matrixType: "GPM" | "CONC" | "ISL" | null;
  /** Grams per serving as printed ("Serving / Package Wt: 4.54g / N/A"). */
  servingWeightG: number | null;
  packageWeightG: number | null;
  batchPass: "pass" | "fail" | null;
  auth: string | null;
  templateVersion: string | null;
  documentCreated: string | null;
  potencyDate: string | null;
  /** True = the lab recorded a material amendment; false = "No material amendments"; null = section absent. */
  amended: boolean | null;
  amendmentText: string | null;
  potency: CoaPotencyRow[];
  summary: {
    totalThcPct: number | null;
    totalThcMgPerServing: number | null;
    totalThcMgPerG: number | null;
    totalCbdPct: number | null;
    totalCbdMgPerServing: number | null;
    totalCbdMgPerG: number | null;
    totalCannabinoidsPct: number | null;
  };
  terpenes: CoaTerpeneRow[];
  totalTerpenesPpm: number | null;
  terpeneSummary: { totalPct: number | null; top: { name: string; pct: number }[] };
  /** The PDF text carried readable potency numbers at all. */
  potencyReadable: boolean;
  checks: CoaCheck[];
  warnings: string[];
};

export type CoaPdfParse = { ok: true; doc: CoaPdfDoc } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Fold unpdf / layout / LlamaParse markdown into one collapsed token stream. */
export function normalizeCoaText(raw: string): string {
  return raw
    .replace(/<\/?(?:td|th|tr|table|thead|tbody|br|p|div)[^>]*>/gi, " ")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ") // markdown separator rows
    .replace(/\|/g, " ")
    .replace(/\*\*|__/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const NUM = String.raw`\d+(?:\.\d+)?`;
const CELL = String.raw`(?:${NUM}|ND|N\/A|NT|NA)`;

/** One table cell: number, ND (0, detected=false) or N/A / NT / NA (null). */
function cell(tok: string): { v: number | null; nd: boolean } {
  if (tok === "ND") return { v: 0, nd: true };
  if (tok === "N/A" || tok === "NT" || tok === "NA") return { v: null, nd: false };
  const n = Number(tok);
  return Number.isFinite(n) ? { v: n, nd: false } : { v: null, nd: false };
}

/** Round to n significant figures (the Confidence COA prints 2). */
export function sigFig(x: number, n = 2): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}

/**
 * Does a printed (2-significant-figure) value agree with an exact one?
 * Both sides are rounded to 2 sig figs; a one-unit difference in the last
 * printed digit is accepted (the lab rounds from unrounded inputs).
 */
export function agreesPrinted(printed: number, exact: number): boolean {
  if (printed === 0 || exact === 0) return printed === exact || Math.abs(printed - exact) < 0.0051;
  const a = sigFig(exact, 2);
  if (Math.abs(a - printed) < 1e-9) return true;
  const unit = Math.pow(10, Math.floor(Math.log10(Math.abs(printed))) - 1);
  return Math.abs(printed - exact) <= unit * 1.0000001;
}

const TOTAL_LABELS: Record<string, CoaTotalRow> = {
  "total cannabinoids": "total-cannabinoids",
  "total thc": "total-thc",
  "total cbd": "total-cbd",
};

function rowKey(label: string): CannabinoidKey | CoaTotalRow | null {
  const l = label.toLowerCase().replace(/\u0394|\u03b4/g, "d");
  return TOTAL_LABELS[l] ?? cannabinoidKey(l.replace(/^d9-?thc$/, "d9-thc"));
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** All matches of a value pattern; returns the value only when it is unique. */
function uniqueMatch(text: string, re: RegExp, warnings: string[], what: string): RegExpMatchArray | null {
  const all = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  const distinct = new Set(all.map((m) => m[0].replace(/\s+/g, " ")));
  if (distinct.size === 0) return null;
  if (distinct.size > 1) {
    warnings.push(`${what}: ${distinct.size} different candidates in the text - not read.`);
    return null;
  }
  return all[0];
}

// ---------------------------------------------------------------------------
// Template detection
// ---------------------------------------------------------------------------

export function detectCoaTemplate(text: string): CoaTemplate | null {
  if (/Analyte Name % mg\/g mg\/serving mg\/package LoQ \(%\)/i.test(text) && /Confidence Analytics/i.test(text)) {
    return "confidence-8";
  }
  if (/Green Grower Labs/i.test(text) || /greengrowerlabs\.com/i.test(text)) return "ggl";
  return null;
}

// ---------------------------------------------------------------------------
// Confidence Analytics template 8.0
// ---------------------------------------------------------------------------

const POTENCY_HEADER = /Analyte Name % mg\/g mg\/serving mg\/package LoQ \(%\)/i;
const POTENCY_END = /\[End of Analytes\]|Terpene Profile|Template Version:|Regulatory Compliance Testing/i;
const POTENCY_ROW = new RegExp(
  String.raw`(Total Cannabinoids|Total THC|Total CBD|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s+(${CELL})\s+(${CELL})\s+(${CELL})\s+(${CELL})\s+(${CELL})(?=\s|$)`,
  "gi",
);
const TERP_ROW = new RegExp(
  String.raw`([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?: [a-z][a-z0-9]*(?:-[a-z0-9]+)*){0,2})\s+(${NUM}|ND)\s+(${NUM}|NA|N\/A)\s+(PASS|FAIL)\b`,
  "g",
);

/** PDF terpene abbreviations -> the WCIA JSON spelling ("a-pinene" -> "alpha-pinene"). */
export function terpeneName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^a-/, "alpha-")
    .replace(/^b-/, "beta-")
    .replace(/^g-/, "gamma-");
}

function parseConfidence(text: string): CoaPdfDoc {
  const warnings: string[] = [];
  const checks: CoaCheck[] = [];

  // --- page header (repeated on every page; identical in every text shape)
  const pageHead = text.match(/Batch #: (\S+?), ID: (\S+?), Sample Name: (.+?), Type: (.+?), Origin:/);
  const batchId = pageHead ? pageHead[1] : null;
  const labSampleId = pageHead ? pageHead[2] : firstMatch(text, /Lab Sample ID: (WA-\d{6}-\d{3})/);
  const sampleName = pageHead ? pageHead[3].trim() : null;
  const productType = pageHead ? pageHead[4].trim() : null;
  if (!pageHead) warnings.push("The page header (Batch / ID / Sample Name / Type) was not found.");

  const matrix = firstMatch(text, /Matrix Type:\s*(GPM|CONC|ISL)\b/);
  const matrixType = matrix === "GPM" || matrix === "CONC" || matrix === "ISL" ? matrix : null;

  // Serving / Package Wt: "4.54g / N/A" (edible) or "N/A / N/A" (everything else).
  let servingWeightG: number | null = null;
  let packageWeightG: number | null = null;
  const adjacent = text.match(new RegExp(String.raw`Serving / Package Wt:\s*(${NUM}\s*g|N\/A)\s*/\s*(${NUM}\s*g|N\/A)`));
  const wtMatch =
    adjacent ??
    uniqueMatch(text, new RegExp(String.raw`(?<![\w.])(${NUM}\s*g|N\/A)\s*/\s*(${NUM}\s*g|N\/A)(?![\w])`), warnings, "Serving / package weight");
  if (wtMatch) {
    const g = (s: string) => (s === "N/A" ? null : Number(s.replace(/\s*g$/, "")));
    servingWeightG = g(wtMatch[1]);
    packageWeightG = g(wtMatch[2]);
  } else if (/Serving \/ Package Wt:/.test(text)) {
    warnings.push("The Serving / Package Wt label is present but its value could not be read.");
  }

  const passTok = firstMatch(text, /Batch Pass\/Fail:\s*(?:\u2714|\u2716|\u2718)?\s*(PASS|FAIL)\b/);
  const batchPass = passTok === "PASS" ? "pass" : passTok === "FAIL" ? "fail" : null;
  const auth = firstMatch(text, /Auth: ([A-Za-z0-9]{8,})/);
  const templateVersion = firstMatch(text, /Template Version: (\d+(?:\.\d+)?)/);
  const documentCreated = firstMatch(text, /Document Created: (\d{4}-\d{2}-\d{2})/);

  // --- amendments
  let amended: boolean | null = null;
  let amendmentText: string | null = null;
  const am = text.match(/Material Amendments (.+?) Template Version:/);
  if (am) {
    if (/^No material amendments/i.test(am[1])) amended = false;
    else {
      amended = true;
      amendmentText = am[1].trim();
    }
  }

  // --- summary block
  const sum = (label: RegExp) => text.match(label);
  const thcS = sum(new RegExp(String.raw`Total d9-THC:\s*(${NUM})\s*%\s*(${NUM})\s*mg/(serving|g)`));
  const cbdS = sum(new RegExp(String.raw`Total CBD:\s*(${NUM})\s*%\s*(${NUM})\s*mg/(serving|g)`));
  const tcS = sum(new RegExp(String.raw`Total Cannabinoids:\s*(${NUM})\s*%`));
  const summary = {
    totalThcPct: thcS ? Number(thcS[1]) : null,
    totalThcMgPerServing: thcS && thcS[3] === "serving" ? Number(thcS[2]) : null,
    totalThcMgPerG: thcS && thcS[3] === "g" ? Number(thcS[2]) : null,
    totalCbdPct: cbdS ? Number(cbdS[1]) : null,
    totalCbdMgPerServing: cbdS && cbdS[3] === "serving" ? Number(cbdS[2]) : null,
    totalCbdMgPerG: cbdS && cbdS[3] === "g" ? Number(cbdS[2]) : null,
    totalCannabinoidsPct: tcS ? Number(tcS[1]) : null,
  };

  // --- potency table
  const potency: CoaPotencyRow[] = [];
  let potencyDate: string | null = null;
  const hIdx = text.search(POTENCY_HEADER);
  if (hIdx >= 0) {
    const before = text.slice(Math.max(0, hIdx - 40), hIdx);
    const d = before.match(/(\d{4}-\d{2}-\d{2})\s*$/);
    potencyDate = d ? d[1] : null;
    const afterHeader = text.slice(hIdx).replace(POTENCY_HEADER, "");
    const endIdx = afterHeader.search(POTENCY_END);
    const seg = endIdx >= 0 ? afterHeader.slice(0, endIdx) : afterHeader;
    const seen = new Set<string>();
    for (const m of seg.matchAll(POTENCY_ROW)) {
      const key = rowKey(m[1]);
      if (!key) {
        warnings.push(`Potency row "${m[1]}" is not a known cannabinoid - shown, not used.`);
        continue;
      }
      if (seen.has(key)) {
        warnings.push(`Potency row ${key} appears twice; the first is kept.`);
        continue;
      }
      seen.add(key);
      const [pct, mgg, mgs, mgp, loq] = [m[2], m[3], m[4], m[5], m[6]].map(cell);
      potency.push({
        label: m[1],
        key,
        pct: pct.v,
        mgPerG: mgg.v,
        mgPerServing: mgs.v,
        mgPerPackage: mgp.v,
        loqPct: loq.v,
        nd: pct.nd,
      });
    }
    if (potency.length === 0) warnings.push("The potency table header was found but no rows could be read.");
  } else {
    warnings.push("No potency table in the text.");
  }

  // --- terpene table (flower / concentrates; edibles have none)
  const terpenes: CoaTerpeneRow[] = [];
  let totalTerpenesPpm: number | null = null;
  // Header: unpdf prints "Terpenes2 <date> Analyte Name Result (ppm) loq (ppm)";
  // the layout text prints both column headers side by side ("Analyte Result
  // loq Analyte Result loq Name (ppm) (ppm) ..."). The table runs to the page
  // footer; "total terpenes" can sit mid-stream in the two-column layout, so
  // it is read as a row, never used as the end marker. Footnote digits ("1")
  // can never be a row: a row name must start with a letter.
  const tIdx = text.search(/Terpenes2? \d{4}-\d{2}-\d{2}(?: Terpenes continued)? Analyte /);
  if (tIdx >= 0) {
    const seg0 = text.slice(tIdx);
    const tEnd = seg0.search(/Template Version:|Page \d+ of \d+/);
    const seg = tEnd >= 0 ? seg0.slice(0, tEnd) : seg0.slice(0, 6000);
    const clean = seg
      .replace(/Terpenes2? \d{4}-\d{2}-\d{2}/g, " ")
      .replace(/Terpenes continued/g, " ")
      .replace(/Analyte Name Result \(ppm\) loq \(ppm\)/g, " ")
      .replace(/Analyte Result loq Analyte Result loq Name \(ppm\) \(ppm\) Name \(ppm\) \(ppm\)/g, " ")
      .replace(/\s+/g, " ");
    const seen = new Set<string>();
    for (const m of clean.matchAll(TERP_ROW)) {
      const name = terpeneName(m[1]);
      const val = m[2] === "ND" ? { v: 0, nd: true } : { v: Number(m[2]), nd: false };
      const loq = m[3] === "NA" || m[3] === "N/A" ? null : Number(m[3]);
      if (name === "total terpenes") {
        totalTerpenesPpm = val.v;
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      terpenes.push({ name, ppm: val.v ?? 0, nd: val.nd, loqPpm: loq, pass: m[4] === "PASS" });
    }
    if (terpenes.length === 0) warnings.push("The terpene table header was found but no rows could be read.");
  }
  const tsum = text.match(new RegExp(String.raw`Total Terpenes:\s*(${NUM})\s*%`));
  const top: { name: string; pct: number }[] = [];
  const topSeg = text.match(/Top Three:(.{0,160})/);
  if (topSeg) {
    for (const m of topSeg[1].matchAll(new RegExp(String.raw`([A-Za-z][A-Za-z\- ]*?):\s*(${NUM})\s*%`, "g"))) {
      if (top.length < 3) top.push({ name: terpeneName(m[1]), pct: Number(m[2]) });
    }
  }

  // --- internal consistency (the lab's own numbers must agree with each other)
  for (const r of potency) {
    if (r.pct !== null && r.mgPerG !== null && !r.nd) {
      const ok = agreesPrinted(r.mgPerG, r.pct * 10);
      checks.push({ what: `${r.key} mg/g = 10 x %`, ok, detail: `${r.pct}% -> ${r.mgPerG} mg/g` });
    }
    if (r.mgPerServing !== null && servingWeightG !== null && r.pct !== null && !r.nd) {
      const exact = r.pct * 10 * servingWeightG;
      // pct is itself printed to 2 s.f., so allow the printed-pct rounding band.
      const lo = (r.pct - unitOf(r.pct) / 2) * 10 * servingWeightG;
      const hi = (r.pct + unitOf(r.pct) / 2) * 10 * servingWeightG;
      const ok = r.mgPerServing >= sigFig(lo, 2) - unitOf(r.mgPerServing) && r.mgPerServing <= sigFig(hi, 2) + unitOf(r.mgPerServing);
      checks.push({
        what: `${r.key} mg/serving = % x 10 x serving g`,
        ok,
        detail: `${r.pct}% x 10 x ${servingWeightG} g = ${round3(exact)} mg; printed ${r.mgPerServing} mg`,
      });
    }
  }
  const pThc = potency.find((r) => r.key === "total-thc");
  if (pThc && summary.totalThcPct !== null && pThc.pct !== null) {
    checks.push({
      what: "summary Total d9-THC = potency table Total THC",
      ok: Math.abs(pThc.pct - summary.totalThcPct) < 1e-9 && (summary.totalThcMgPerServing ?? pThc.mgPerServing) === pThc.mgPerServing,
      detail: `summary ${summary.totalThcPct}% / ${summary.totalThcMgPerServing ?? "-"} mg; table ${pThc.pct}% / ${pThc.mgPerServing ?? "-"} mg`,
    });
  }

  return {
    template: "confidence-8",
    labName: "Confidence Analytics",
    labSampleId,
    batchId,
    sampleName,
    productType,
    matrixType,
    servingWeightG,
    packageWeightG,
    batchPass,
    auth,
    templateVersion,
    documentCreated,
    potencyDate,
    amended,
    amendmentText,
    potency,
    summary,
    terpenes,
    totalTerpenesPpm,
    terpeneSummary: { totalPct: tsum ? Number(tsum[1]) : null, top },
    potencyReadable: potency.some((r) => r.pct !== null),
    checks,
    warnings,
  };
}

/** One unit in the last printed (2nd significant) digit. */
function unitOf(x: number): number {
  if (x === 0) return 0;
  return Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// Green Grower Labs
// ---------------------------------------------------------------------------

function parseGgl(text: string): CoaPdfDoc {
  const warnings: string[] = [];
  const potency: CoaPotencyRow[] = [];
  const rows: [RegExp, CannabinoidKey | CoaTotalRow, string][] = [
    [new RegExp(String.raw`(?:\u0394|\u03b4|d)9-THC\s+(${NUM})\s+(${NUM})`, "i"), "d9-thc", "d9-THC"],
    [new RegExp(String.raw`\bTHCa\s+(${NUM})\s+(${NUM})`), "thca", "THCa"],
    [new RegExp(String.raw`Total THC\s+(${NUM})\s+(${NUM})`), "total-thc", "Total THC"],
    [new RegExp(String.raw`\bCBDA\s+(${NUM}|ND)\s+(${NUM}|ND)`), "cbda", "CBDA"],
    [new RegExp(String.raw`Total CBD\s+(${NUM}|ND)\s+(${NUM}|ND)`), "total-cbd", "Total CBD"],
  ];
  for (const [re, key, label] of rows) {
    const m = text.match(re);
    if (!m) continue;
    const a = cell(m[1]);
    const b = cell(m[2]);
    potency.push({ label, key, pct: a.v, mgPerG: b.v, mgPerServing: null, mgPerPackage: null, loqPct: null, nd: a.nd });
  }
  if (potency.length === 0) {
    warnings.push(
      "Green Grower Labs draws its potency numbers as graphics - this PDF text carries none. " +
        "The lab JSON is the source for this certificate.",
    );
  }
  const checks: CoaCheck[] = potency
    .filter((r) => r.pct !== null && r.mgPerG !== null && !r.nd)
    .map((r) => ({
      what: `${r.key} mg/g = 10 x %`,
      ok: Math.abs(r.mgPerG! - r.pct! * 10) <= Math.max(0.6, r.pct! * 10 * 0.01),
      detail: `${r.pct}% -> ${r.mgPerG} mg/g`,
    }));
  return {
    template: "ggl",
    labName: "Green Grower Labs",
    labSampleId: null,
    batchId: null,
    sampleName: null,
    productType: null,
    matrixType: null,
    servingWeightG: null,
    packageWeightG: null,
    batchPass: null,
    auth: null,
    templateVersion: null,
    documentCreated: null,
    potencyDate: null,
    amended: null,
    amendmentText: null,
    potency,
    summary: {
      totalThcPct: potency.find((r) => r.key === "total-thc")?.pct ?? null,
      totalThcMgPerServing: null,
      totalThcMgPerG: potency.find((r) => r.key === "total-thc")?.mgPerG ?? null,
      totalCbdPct: potency.find((r) => r.key === "total-cbd")?.pct ?? null,
      totalCbdMgPerServing: null,
      totalCbdMgPerG: potency.find((r) => r.key === "total-cbd")?.mgPerG ?? null,
      totalCannabinoidsPct: null,
    },
    terpenes: [],
    totalTerpenesPpm: null,
    terpeneSummary: { totalPct: null, top: [] },
    potencyReadable: potency.length > 0,
    checks,
    warnings,
  };
}

/** Parse COA text (unpdf, pdftotext -layout or LlamaParse markdown). */
export function parseCoaPdfText(raw: string): CoaPdfParse {
  if (typeof raw !== "string" || raw.trim().length < 40) return { ok: false, reason: "The COA text is empty." };
  const text = normalizeCoaText(raw);
  const t = detectCoaTemplate(text);
  if (!t) {
    return {
      ok: false,
      reason: "This certificate layout is not one the reader knows yet - its facts were not read. Enter them by hand or send it to the developer.",
    };
  }
  return { ok: true, doc: t === "confidence-8" ? parseConfidence(text) : parseGgl(text) };
}

export function potencyRow(doc: Pick<CoaPdfDoc, "potency">, key: CannabinoidKey | CoaTotalRow): CoaPotencyRow | null {
  return doc.potency.find((r) => r.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Self-tests. `fixtures` maps "itemNN.unpdf" / "itemNN.layout" -> text.
// ---------------------------------------------------------------------------
export function __runCoaPdfTextCoreTests(fixtures: Record<string, string>): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL coa-pdf-text-core: " + msg);
    }
  };
  const get = (id: string): CoaPdfDoc => {
    const r = parseCoaPdfText(fixtures[id] ?? "");
    if (!r.ok) throw new Error(`fixture ${id}: ${r.reason}`);
    return r.doc;
  };

  // Verified by reading every certificate by eye (R28 research).
  const EDIBLES: Record<string, { sw: number; thc: number; cbd: number | null; minor: [CannabinoidKey, number][]; tc: number; name: string }> = {
    item12: { sw: 4.54, thc: 5.5, cbd: 10, minor: [["cbc", 9.5], ["cbg", 10]], tc: 35, name: "Sour Mandarin CBG CBC CBD THC - 5g" },
    item13: { sw: 4.62, thc: 11, cbd: null, minor: [["cbg", 30]], tc: 40, name: "Honeydew Melon CBG THC - 5g" },
    item14: { sw: 4.61, thc: 11, cbd: 21, minor: [["cbn", 21]], tc: 54, name: "Apple Cardamom CBN CBD THC - 5g" },
    item15: { sw: 4.71, thc: 10, cbd: 9.8, minor: [["cbn", 9.8]], tc: 30, name: "Concord Grape CBN THC - 5g" },
    item16: { sw: 4.54, thc: 10, cbd: 49, minor: [], tc: 59, name: "Raspberry Peach CBD THC - Raspberry Peach - 5g" },
  };

  for (const shape of ["unpdf", "layout"] as const) {
    for (const [item, x] of Object.entries(EDIBLES)) {
      const d = get(`${item}.${shape}`);
      const tag = `${item}.${shape}`;
      ok(d.template === "confidence-8", `${tag} template`);
      ok(d.servingWeightG === x.sw && d.packageWeightG === null, `${tag} serving ${x.sw} g / package N/A`);
      ok(d.matrixType === "ISL" || shape === "layout", `${tag} matrix ISL`);
      ok(d.productType === "Edible" && d.sampleName === x.name, `${tag} type + sample name`);
      ok(potencyRow(d, "total-thc")?.mgPerServing === x.thc, `${tag} Total THC ${x.thc} mg/serving`);
      ok(potencyRow(d, "d9-thc")?.mgPerServing === x.thc, `${tag} d9 ${x.thc} mg/serving`);
      const cbd = potencyRow(d, "total-cbd");
      ok(x.cbd === null ? cbd?.nd === true && cbd.mgPerServing === null : cbd?.mgPerServing === x.cbd, `${tag} Total CBD`);
      for (const [k, v] of x.minor) ok(potencyRow(d, k)?.mgPerServing === v, `${tag} ${k} ${v} mg/serving`);
      ok(potencyRow(d, "total-cannabinoids")?.mgPerServing === x.tc, `${tag} total cannabinoids ${x.tc}`);
      ok(potencyRow(d, "thca")?.nd === true, `${tag} THCA not detected`);
      ok(d.potency.length === 20, `${tag} 20 potency rows (3 totals + 17 analytes)`);
      ok(d.potency.every((r) => r.mgPerPackage === null), `${tag} mg/package always N/A`);
      ok(d.checks.length > 0 && d.checks.every((c) => c.ok), `${tag} every internal check agrees: ${d.checks.filter((c) => !c.ok).map((c) => c.what + " " + c.detail).join("; ")}`);
      ok(d.terpenes.length === 0 && d.totalTerpenesPpm === null, `${tag} edibles carry no terpene table`);
      ok(d.warnings.length === 0, `${tag} no warnings: ${d.warnings.join(" | ")}`);
    }
  }
  const e12 = get("item12.unpdf");
  ok(e12.labSampleId === "WA-260921-006" && e12.batchId === "GF41852405694996", "12 ids");
  ok(e12.batchPass === "pass" && e12.auth === "7mDLOjIpm5i3xxjGEgDAEY" && e12.templateVersion === "8.0", "12 pass/auth/template");
  ok(e12.amended === true && (e12.amendmentText ?? "").startsWith("2026-10-01: Version 2 amended"), "12 amendment recorded");
  ok(e12.potencyDate === "2026-09-22" && e12.documentCreated === "2026-10-01", "12 dates");
  ok(e12.summary.totalThcPct === 0.12 && e12.summary.totalThcMgPerServing === 5.5 && e12.summary.totalCbdMgPerServing === 10, "12 summary");
  ok(e12.summary.totalCannabinoidsPct === 0.77 && e12.summary.totalThcMgPerG === null, "12 summary per-serving, not per-gram");
  const e13 = get("item13.unpdf");
  ok(e13.summary.totalCbdPct === 0 && e13.summary.totalCbdMgPerServing === 0, "13 summary prints CBD 0% 0mg");

  // ---- flower (item00), both shapes ----------------------------------------
  for (const shape of ["unpdf", "layout"] as const) {
    const f = get(`item00.${shape}`);
    const tag = `item00.${shape}`;
    ok(f.servingWeightG === null && f.packageWeightG === null, `${tag} flower: N/A / N/A`);
    ok(potencyRow(f, "thca")?.pct === 30 && potencyRow(f, "thca")?.mgPerG === 300, `${tag} THCA 30% 300 mg/g`);
    ok(potencyRow(f, "total-thc")?.pct === 27 && potencyRow(f, "total-thc")?.mgPerServing === null, `${tag} total THC 27%, no serving`);
    ok(potencyRow(f, "thcva")?.pct === 0.17, `${tag} d9-thcva -> thcva 0.17`);
    ok(f.potency.length === 20, `${tag} 20 potency rows`);
    ok(f.terpenes.length === 45, `${tag} 45 terpene rows (got ${f.terpenes.length})`);
    ok(f.totalTerpenesPpm === 25000, `${tag} total terpenes 25000 ppm`);
    ok(f.terpenes.find((t) => t.name === "limonene")?.ppm === 5100, `${tag} limonene 5100 (2 s.f.)`);
    ok(f.terpenes.find((t) => t.name === "alpha-pinene")?.ppm === 530, `${tag} a-pinene -> alpha-pinene`);
    ok(f.terpenes.find((t) => t.name === "isobornyl acetate")?.nd === true, `${tag} two-word name, ND`);
    ok(f.terpenes.find((t) => t.name === "trans-a-bergamotene")?.ppm === 550, `${tag} trans-a-bergamotene kept as the JSON spells it`);
    ok(f.checks.every((c) => c.ok), `${tag} checks agree`);
  }
  const f0 = get("item00.unpdf");
  ok(f0.matrixType === "GPM" && f0.productType === "Flower", "00 GPM flower");
  ok(f0.summary.totalThcMgPerG === 270 && f0.summary.totalThcMgPerServing === null, "00 summary mg/g, not per serving");
  ok(f0.terpeneSummary.totalPct === 2.5 && f0.terpeneSummary.top.map((t) => t.name).join(",") === "limonene,myrcene,linalool", "00 terpene summary");
  ok(f0.amended === false && f0.amendmentText === null, "00 no amendments");

  // ---- every Confidence fixture reads, both shapes -------------------------
  for (let i = 0; i <= 16; i++) {
    if (i === 1) continue;
    for (const shape of ["unpdf", "layout"]) {
      const id = `item${String(i).padStart(2, "0")}.${shape}`;
      const r = parseCoaPdfText(fixtures[id] ?? "");
      ok(r.ok && r.doc.template === "confidence-8" && r.doc.potency.length === 20, `${id} reads 20 potency rows`);
      if (r.ok) ok(r.doc.checks.every((c) => c.ok), `${id} internal checks: ${r.doc.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}`);
      if (r.ok && i <= 11) ok(r.doc.terpenes.length >= 45 && r.doc.totalTerpenesPpm !== null, `${id} terpene table read (${r.ok ? r.doc.terpenes.length : 0})`);
    }
  }

  // ---- GGL: unpdf text has no numbers (verified); layout text has them ------
  const gu = get("item01.unpdf");
  ok(gu.template === "ggl" && gu.potency.length === 0 && !gu.potencyReadable, "01 unpdf: GGL, no numbers in the text");
  ok(gu.warnings.length === 1 && gu.warnings[0].includes("graphics"), "01 unpdf: says so honestly");
  const gl = get("item01.layout");
  ok(potencyRow(gl, "d9-thc")?.pct === 1.1 && potencyRow(gl, "d9-thc")?.mgPerG === 11, "01 layout d9 1.1% 11 mg/g");
  ok(potencyRow(gl, "thca")?.pct === 86 && potencyRow(gl, "total-thc")?.pct === 77, "01 layout THCa 86, total 77");
  ok(potencyRow(gl, "total-cbd")?.pct === 0.19, "01 layout total CBD 0.19");
  ok(gl.checks.every((c) => c.ok), "01 layout mg/g checks");

  // ---- LlamaParse markdown shape (SYNTHETIC: built from item12's printed
  // values in the markdown table form LlamaParse emits; no API key here) ----
  const md = [
    "# Medical Compliance Test Report",
    "**Sample Name:** Sour Mandarin CBG CBC CBD THC - 5g",
    "| Product Type: | Date of Collection: | Serving / Package Wt: |",
    "|---|---|---|",
    "| Edible | 2026-09-18 | 4.54g / N/A |",
    "Total d9-THC: 0.12% 5.5mg/serving Total CBD: 0.22% 10mg/serving Total Cannabinoids: 0.77%",
    "## Cannabinoids - Potency 2026-09-22",
    "| Analyte Name | % | mg/g | mg/serving | mg/package | LoQ (%) |",
    "| :--- | ---: | ---: | ---: | ---: | ---: |",
    "| **Total THC** | 0.12 | 1.2 | 5.5 | N/A | N/A |",
    "| d9-thc | 0.12 | 1.2 | 5.5 | N/A | 0.003 |",
    "| d9-thca | ND | ND | N/A | N/A | 0.003 |",
    "| cbd | 0.22 | 2.2 | 10 | N/A | 0.003 |",
    "<table><tr><td>cbg</td><td>0.22</td><td>2.2</td><td>10</td><td>N/A</td><td>0.0059</td></tr></table>",
    "[End of Analytes]",
    "Batch #: GF41852405694996, ID: WA-260921-006, Sample Name: Sour Mandarin CBG CBC CBD THC - 5g, Type: Edible, Origin: Firetree LLC",
    "Confidence Analytics",
  ].join("\n");
  const m = parseCoaPdfText(md);
  ok(m.ok, "markdown parses");
  if (m.ok) {
    ok(m.doc.servingWeightG === 4.54, "markdown serving weight from a table cell");
    ok(potencyRow(m.doc, "total-thc")?.mgPerServing === 5.5 && potencyRow(m.doc, "d9-thc")?.mgPerServing === 5.5, "markdown bold + pipes");
    ok(potencyRow(m.doc, "cbg")?.mgPerServing === 10, "html table cells");
    ok(potencyRow(m.doc, "thca")?.nd === true && m.doc.potency.length === 5, "markdown rows exact");
    ok(m.doc.checks.every((c) => c.ok), "markdown checks agree");
  }

  // ---- refusals + ambiguity ------------------------------------------------
  ok(!parseCoaPdfText("").ok && !parseCoaPdfText("short").ok, "empty refused");
  const unk = parseCoaPdfText("Some Other Lab certificate of analysis THC 12% potency table here and more words");
  ok(!unk.ok && unk.reason.includes("not one the reader knows"), "unknown lab refused honestly");
  const two = parseCoaPdfText(
    "Confidence Analytics Analyte Name % mg/g mg/serving mg/package LoQ (%) d9-thc 0.12 1.2 5.5 N/A 0.003 [End of Analytes] Serving / Package Wt: weights below 4.54g / N/A and 4.62g / N/A",
  );
  ok(two.ok && two.doc.servingWeightG === null && two.doc.warnings.some((w) => w.includes("2 different candidates")), "two serving weights -> none read, warned");
  const bad = parseCoaPdfText(
    "Confidence Analytics Serving / Package Wt: 4.54g / N/A Analyte Name % mg/g mg/serving mg/package LoQ (%) d9-thc 0.12 1.2 9.9 N/A 0.003 [End of Analytes]",
  );
  ok(bad.ok && bad.doc.checks.some((c) => !c.ok && c.what.includes("mg/serving")), "a mg/serving that disagrees with % x weight fails its check");
  const badg = parseCoaPdfText(
    "Confidence Analytics Analyte Name % mg/g mg/serving mg/package LoQ (%) cbd 0.22 9.9 N/A N/A 0.003 [End of Analytes]",
  );
  ok(badg.ok && badg.doc.checks.some((c) => !c.ok && c.what.includes("mg/g")), "a mg/g that is not 10 x % fails its check");
  ok(sigFig(10.6219, 2) === 11 && sigFig(0.2299, 2) === 0.23 && sigFig(5.4752, 2) === 5.5, "sigFig");
  ok(agreesPrinted(11, 10.62) && agreesPrinted(5.5, 5.475) && !agreesPrinted(9.9, 5.5), "agreesPrinted");
  ok(terpeneName("b-Pinene") === "beta-pinene" && terpeneName("g-terpinene") === "gamma-terpinene", "terpeneName");
  ok(normalizeCoaText("| a |  **b** |\n|---|---|\n<td>c</td>") === "a b c", "normalize");
  return { passed, failed };
}
