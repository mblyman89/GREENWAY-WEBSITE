/**
 * src/lib/inventory/pdf-coa-core.ts  (H16b-4)
 *
 * PURE parser for the "COA Summary" PDF that vendors email alongside the
 * manifest/invoice (e.g. High End Farms' 22-page High_End_COA.pdf). Operates on
 * the PLAIN TEXT already extracted by the serverless-safe `unpdf` extractor
 * (I/O lives in the server-only pdf-extract.ts). No I/O, no `server-only`, so it
 * is unit-testable with vitest against a saved fixture (the exact unpdf output
 * of the owner's real High_End_COA.pdf).
 *
 * WHY (verified, not guessed): the COA PDF is TWO things merged. Page 1 is a
 * "COA Summary" table that maps EACH inventory Lot ULID to its Lab Report #,
 * Sample ID, strain, and Tested/Expires dates. The remaining pages are the
 * individual Certificates of Analysis (one per Lab Report #), each carrying the
 * batch PASS/FAIL and the Cannabinoid Analysis summary (Total THC / CBD / Total
 * Cannabinoids). Many Lots share ONE Lab Report (16 lots -> 4 reports here), so
 * we (1) read the summary rows to link Lot -> Report, then (2) read each COA's
 * potency/pass, then (3) fan the report's potency back out to every Lot that
 * cited it. The result is a Lot ID -> ParsedLab map the wiring slice (H16b-5)
 * merges onto the manifest's draft lines by Lot ID.
 *
 * unpdf flattens the PDF to a single FLOWING blob and repeats boilerplate; we
 * anchor on the stable labels ("Lot:", "Lab Sample ID:", "Batch Pass/Fail:",
 * "Cannabinoid Analysis - summary") and dedupe by Lot ID / Report #.
 *
 * DRAFTS-ONLY (standing rule): produces enrichment data for HUMAN review only;
 * it never activates stock and never fabricates a PASS (passed stays null if the
 * COA text doesn't state it).
 */

import type { ParsedLab } from "@/lib/inventory/intake-parser";

/** Recognize the COA Summary PDF by its unmistakable header + labels. */
export function looksLikeCoaSummary(text: string): boolean {
  if (!text) return false;
  const hasSummaryHeader = /COA Summary/i.test(text) && /\bItems;\s*\d+\s*COAs\b/i.test(text);
  const hasCoaBody =
    /Certificate of Analysis/i.test(text) && /Lab Sample ID:\s*WA-\d{6}-\d{3}/i.test(text);
  return hasSummaryHeader || hasCoaBody;
}

/** Normalize a "2026-03-06" ISO-ish date; pass through when already ISO. PURE. */
export function normalizeCoaDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) {
    const mm = Number(mdy[1]);
    const dd = Number(mdy[2]);
    let yy = Number(mdy[3]);
    if (mdy[3].length === 2) yy = 2000 + yy;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${yy}-${p(mm)}-${p(dd)}`;
  }
  return null;
}

/** A row of the front-page "COA Summary" table. */
export type CoaSummaryRow = {
  lotId: string;
  reportNumber: string; // Lab Report # e.g. WA-260305-083
  sampleId: string | null; // Sample ULID
  strain: string | null;
  testedOn: string | null;
  expiresOn: string | null;
};

/**
 * Parse the front-page summary rows. Each row on this layout reads:
 *   #N Lot: <ULID> <product/variety...> WA-<report#> Sample: <sampleULID>
 *   <strain...> Tested: <date> Expires: <date>
 * We anchor on "Lot:" ... "WA-######-###" ... "Sample:" ... "Tested:" ...
 * "Expires:". Dedupe by Lot ID. PURE.
 */
export function parseCoaSummaryRows(text: string): CoaSummaryRow[] {
  const seen = new Set<string>();
  const out: CoaSummaryRow[] = [];
  // The summary IDs on this layout are 16-char uppercase base32-ish tokens
  // (e.g. 01KMG0FTXX17N0ST), NOT full 26-char ULIDs. Match a run of 14-26
  // uppercase alphanumerics to stay robust across integrators.
  const rowRe =
    /Lot:\s*([0-9A-Z]{14,26})\s+[\s\S]*?(WA-\d{6}-\d{3})\s+Sample:\s*([0-9A-Z]{14,26})\s+([\s\S]*?)\s+Tested:\s*(\d{4}-\d{2}-\d{2})\s+Expires:\s*(\d{4}-\d{2}-\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const lotId = m[1];
    if (seen.has(lotId)) continue;
    seen.add(lotId);
    const strain = m[4].replace(/\s+/g, " ").trim() || null;
    out.push({
      lotId,
      reportNumber: m[2],
      sampleId: m[3] || null,
      strain,
      testedOn: normalizeCoaDate(m[5]),
      expiresOn: normalizeCoaDate(m[6]),
    });
  }
  return out;
}

/** Parsed potency + pass for a single Lab Report #. */
export type CoaReport = {
  reportNumber: string;
  strain: string | null;
  passed: boolean | null;
  tested_on: string | null;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  total_cannabinoids_pct: number | null;
};

/** Turn "22%" / "0.054%" / "27%" into a number, or null. */
function pct(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the per-report COA detail bodies. Each report body starts at
 * "Lab Sample ID: WA-######-###" and carries a "Cannabinoid Analysis - summary"
 * block plus "Batch Pass/Fail: ✔ PASS". Dedupe by report #. PURE.
 */
export function parseCoaReports(text: string): CoaReport[] {
  const seen = new Set<string>();
  const out: CoaReport[] = [];
  // Each detail body opens with the Lab Sample ID + "Flower Lot / <strain>".
  const bodyRe =
    /Lab Sample ID:\s*(WA-\d{6}-\d{3})\b([\s\S]*?)(?=Lab Sample ID:\s*WA-\d{6}-\d{3}\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(text)) !== null) {
    const reportNumber = m[1];
    if (seen.has(reportNumber)) continue;
    seen.add(reportNumber);
    const body = m[2];

    // Strain from "Flower Lot / Cat Piss Cookies" right after the ID.
    const strainM = body.match(/(?:Flower Lot|Lot)\s*\/\s*([A-Za-z0-9][A-Za-z0-9 .'#\-]{1,60}?)\s+Product Type:/i);
    const strain = strainM ? strainM[1].replace(/\s+/g, " ").trim() : null;

    // Batch Pass/Fail: ✔ PASS  (the checkmark is a unicode glyph in unpdf).
    const passM = body.match(/Batch Pass\/Fail:\s*\S*\s*(PASS|FAIL)/i);
    const passed = passM ? /pass/i.test(passM[1]) : null;

    // Tested/completion date.
    const testedM = body.match(/Date of Completion:\s*(\d{4}-\d{2}-\d{2})/i);
    const tested_on = testedM ? normalizeCoaDate(testedM[1]) : null;

    // Cannabinoid Analysis summary: "Total d9-THC: 22% 220mg/g Total CBD: 0.054%
    // 0.54mg/g Total Cannabinoids: 27%".
    const thcM = body.match(/Total d9-THC:\s*([\d.]+)\s*%/i);
    const cbdM = body.match(/Total CBD:\s*([\d.]+)\s*%/i);
    const totM = body.match(/Total Cannabinoids:\s*([\d.]+)\s*%/i);

    out.push({
      reportNumber,
      strain,
      passed,
      tested_on,
      total_thc_pct: pct(thcM?.[1]),
      total_cbd_pct: pct(cbdM?.[1]),
      total_cannabinoids_pct: pct(totM?.[1]),
    });
  }
  return out;
}

/** Build a ParsedLab for a Lot from its summary row + its report's potency. */
function toParsedLab(row: CoaSummaryRow, report: CoaReport | undefined): ParsedLab {
  return {
    labtest_external_identifier: row.reportNumber,
    lab_name: null,
    tested_on: report?.tested_on ?? row.testedOn ?? null,
    thc_pct: null,
    cbd_pct: null,
    thca_pct: null,
    cbda_pct: null,
    total_thc_pct: report?.total_thc_pct ?? null,
    total_cbd_pct: report?.total_cbd_pct ?? null,
    total_cannabinoids_pct: report?.total_cannabinoids_pct ?? null,
    potency_json:
      report && report.total_thc_pct != null
        ? {
            "total-thc": report.total_thc_pct,
            ...(report.total_cbd_pct != null ? { "total-cbd": report.total_cbd_pct } : {}),
            ...(report.total_cannabinoids_pct != null
              ? { "total-cannabinoids": report.total_cannabinoids_pct }
              : {}),
          }
        : null,
    terpenes_json: null,
    analytes_json: null,
    passed: report?.passed ?? null,
    coa_url: null, // the COA is the attached PDF itself; no external URL here.
    coa_release_date: report?.tested_on ?? row.testedOn ?? null,
    coa_expire_date: row.expiresOn,
    raw: {
      report_number: row.reportNumber,
      sample_id: row.sampleId,
      strain: row.strain ?? report?.strain ?? null,
      tested_on: report?.tested_on ?? row.testedOn ?? null,
      expires_on: row.expiresOn,
    },
  };
}

/** The full parsed COA summary result. */
export type ParsedCoaSummary = {
  /** Lot ULID -> enrichment ParsedLab (+ expires_on carried in coa_expire_date). */
  byLot: Record<string, ParsedLab>;
  /** Expiry per Lot (convenience for line.expires_on merges). */
  expiresByLot: Record<string, string | null>;
  reports: CoaReport[];
  rows: CoaSummaryRow[];
  warnings: string[];
};

/**
 * Parse a COA Summary PDF's text. Returns null if it isn't a COA doc. Links
 * every summary Lot to its report's potency/pass. PURE.
 */
export function parseCoaSummary(text: string): ParsedCoaSummary | null {
  if (!looksLikeCoaSummary(text)) return null;

  const rows = parseCoaSummaryRows(text);
  const reports = parseCoaReports(text);
  const reportByNumber = new Map(reports.map((r) => [r.reportNumber, r]));

  const byLot: Record<string, ParsedLab> = {};
  const expiresByLot: Record<string, string | null> = {};
  for (const row of rows) {
    const report = reportByNumber.get(row.reportNumber);
    byLot[row.lotId] = toParsedLab(row, report);
    expiresByLot[row.lotId] = row.expiresOn;
  }

  return {
    byLot,
    expiresByLot,
    reports,
    rows,
    warnings: [
      "Parsed from a COA Summary PDF (drafts only) — verify PASS status, potency, and expiry before receiving.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests. Runs against the real sample text passed in by the test.
// ---------------------------------------------------------------------------
export function __runCoaSummaryTests(sampleText: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // date helper
  ok(normalizeCoaDate("2026-03-06") === "2026-03-06", "iso date passthrough");
  ok(normalizeCoaDate("3/6/26") === "2026-03-06", "m/d/yy -> iso");
  ok(normalizeCoaDate("nope") === null, "bad date -> null");

  // classifier
  ok(looksLikeCoaSummary(sampleText) === true, "sample recognized as COA summary");
  ok(
    looksLikeCoaSummary("Internal Shipping Document Manifest ID: 21544 Batch") === false,
    "LCB doc not mistaken for a COA",
  );

  // summary rows
  const rows = parseCoaSummaryRows(sampleText);
  ok(rows.length === 16, `all 16 summary lots parsed (got ${rows.length})`);
  ok(rows[0]?.lotId === "01KMG0FTXX17N0ST", `row 1 lot (got ${rows[0]?.lotId})`);
  ok(rows[0]?.reportNumber === "WA-260305-083", `row 1 report (got ${rows[0]?.reportNumber})`);
  ok(rows[0]?.sampleId === "01KJJGDGHYZ4TY06", `row 1 sample (got ${rows[0]?.sampleId})`);
  ok(rows[0]?.strain === "Cat Piss Cookies", `row 1 strain (got ${rows[0]?.strain})`);
  ok(rows[0]?.testedOn === "2026-03-06", `row 1 tested (got ${rows[0]?.testedOn})`);
  ok(rows[0]?.expiresOn === "2027-03-06", `row 1 expires (got ${rows[0]?.expiresOn})`);
  ok(rows[15]?.lotId === "01KMG0M73JXFQNDP", `row 16 lot (got ${rows[15]?.lotId})`);

  // reports (4 unique, one per Lab Report #)
  const reports = parseCoaReports(sampleText);
  ok(reports.length === 4, `4 unique COA reports parsed (got ${reports.length})`);
  const r083 = reports.find((r) => r.reportNumber === "WA-260305-083");
  ok(r083?.passed === true, `report 083 PASS (got ${r083?.passed})`);
  ok(r083?.total_thc_pct === 22, `report 083 total THC (got ${r083?.total_thc_pct})`);
  ok(r083?.total_cbd_pct === 0.054, `report 083 total CBD (got ${r083?.total_cbd_pct})`);
  ok(r083?.total_cannabinoids_pct === 27, `report 083 total cannabinoids (got ${r083?.total_cannabinoids_pct})`);
  ok(r083?.tested_on === "2026-03-06", `report 083 tested (got ${r083?.tested_on})`);
  ok(r083?.strain === "Cat Piss Cookies", `report 083 strain (got ${r083?.strain})`);
  const r031 = reports.find((r) => r.reportNumber === "WA-260305-031");
  ok(r031?.total_thc_pct === 24, `report 031 total THC (got ${r031?.total_thc_pct})`);

  // full parse: fan report potency out to every lot that cited it
  const parsed = parseCoaSummary(sampleText)!;
  ok(parsed !== null, "sample parses");
  ok(Object.keys(parsed.byLot).length === 16, `16 lots mapped (got ${Object.keys(parsed.byLot).length})`);
  const lab1 = parsed.byLot["01KMG0FTXX17N0ST"];
  ok(lab1?.labtest_external_identifier === "WA-260305-083", `lot1 report id (got ${lab1?.labtest_external_identifier})`);
  ok(lab1?.passed === true, `lot1 passed (got ${lab1?.passed})`);
  ok(lab1?.total_thc_pct === 22, `lot1 total THC (got ${lab1?.total_thc_pct})`);
  ok(lab1?.coa_expire_date === "2027-03-06", `lot1 expiry (got ${lab1?.coa_expire_date})`);
  ok(lab1?.potency_json?.["total-thc"] === 22, `lot1 potency map thc (got ${lab1?.potency_json?.["total-thc"]})`);
  // A DIFFERENT lot that shares report 083 gets the SAME potency (fan-out).
  const lab5 = parsed.byLot["01KMG0JFJT0ZN4VS"];
  ok(lab5?.labtest_external_identifier === "WA-260305-083", `lot5 shares report 083 (got ${lab5?.labtest_external_identifier})`);
  ok(lab5?.total_thc_pct === 22, `lot5 fan-out THC (got ${lab5?.total_thc_pct})`);
  ok(parsed.expiresByLot["01KMG0FTXX17N0ST"] === "2027-03-06", "expiresByLot convenience map");
  // never fabricate a URL we don't have
  ok(lab1?.coa_url === null, "coa_url left null (COA is the attached PDF)");

  if (failed === 0) console.log(`pdf-coa-core: all ${passed} tests passed`);
  return { passed, failed };
}
