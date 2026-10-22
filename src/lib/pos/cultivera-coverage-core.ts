/**
 * src/lib/pos/cultivera-coverage-core.ts — R74 S8 (PURE). The per-lot coverage report.
 *
 * Owner (R74 round 2, #5): "Whatever Cultivera doesn't find, the email will. I'm hoping the 148 will
 * be found by the email and sent properly through onboarding. But for ones the email can't find
 * either, yes flag them in one unmatched Cultivera stock manifest." and "if there is no receive date
 * it does not exist, include it in the clean up."
 *
 * Before anything is moved, the owner needs to SEE, lot by lot, where each Cultivera lot's manifest
 * will come from. This core joins the two plans that already exist (it decides nothing new):
 *
 *   1. the crawler's transfer match (cultivera-transfer-match-core, TransferMatchPlan): matched =
 *      "Cultivera transfer" with that transfer's real manifest number;
 *   2. for the lots it left open, the email match (cultivera-mail-match-core, S6) over the documents
 *      the stephen@ harvest kept (S7): one emailed manifest = "Email"; two or more = "Several emails"
 *      (never guessed, goes on the unmatched manifest); none = "Unmatched" (CV-UNMATCHED).
 *
 * Every lot also says whether Cultivera's Received date is blank: owner #5 says such a lot "does not
 * exist" and belongs in the CCRS clean-up (S4 lists it there). The flag is reported beside the
 * source, never instead of it, so the numbers always add up to the lots.
 *
 * Output: one row per lot (sorted vendor, product, barcode), per-vendor counts, a loud summary line
 * and a spreadsheet (RFC 4180, formula starters neutralised). Reads nothing, writes nothing. Units
 * are Cultivera's (Cultivera wins on quantity, owner #3). No money.
 */

import type { LotTransferDecision, TransferMatchPlan, UnmatchedReason } from "@/lib/inventory/cultivera-transfer-match-core";
import { openLotsFromTransferPlan, planMailMatch, UNMATCHED_MANIFEST_LABEL, UNMATCHED_MANIFEST_NUMBER, type MailDoc, type MailMatchPlan } from "@/lib/pos/cultivera-mail-match-core";

export const COVERAGE_RULE_VERSION = 1;

export type CoverageSource = "transfer" | "email" | "several_emails" | "unmatched";
export const COVERAGE_SOURCES: readonly CoverageSource[] = ["transfer", "email", "several_emails", "unmatched"];

export const COVERAGE_SOURCE_TEXT: Record<CoverageSource, string> = {
  transfer: "Cultivera transfer",
  email: "Email (stephen@)",
  several_emails: "Several emails (not guessed)",
  unmatched: UNMATCHED_MANIFEST_LABEL,
};

export const TRANSFER_MISS_TEXT: Record<UnmatchedReason, string> = {
  no_receipt: "no Cultivera transfer carried this barcode",
  ambiguous_no_time: "on several transfers and the lot has no received time",
  ambiguous_none_after: "on several transfers, none accepted after it was received",
  ambiguous_tie: "on several transfers accepted at the same moment",
  vendor_mismatch: "the only transfer is from a different vendor",
};

/** One export row, as the transform gives it (PlanLotSource). */
export type CoverageLotSource = { barcode: string; vendor: string; receivedDateRaw: string | null; units: number; productName: string };

export type CoverageRow = {
  barcode: string;
  vendor: string;
  product: string;
  units: number;
  source: CoverageSource;
  /** The manifest number the lot will sit on (transfer number, emailed number, or CV-UNMATCHED). */
  manifestNumber: string | null;
  /** Plain words: which transfer / email, or why not. */
  detail: string;
  /** Cultivera's Received date is blank (owner #5: "does not exist", CCRS clean-up). */
  noReceivedDate: boolean;
};

export type VendorCoverage = { vendor: string; lots: number; units: number } & Record<CoverageSource, number> & { noReceivedDate: number };

export type CoverageReport = {
  ruleVersion: typeof COVERAGE_RULE_VERSION;
  rows: CoverageRow[];
  byVendor: VendorCoverage[];
  counts: Record<CoverageSource, number> & { lots: number; units: number; noReceivedDate: number };
  /** Whether harvested email documents were available at all (0293 applied and read). */
  emailChecked: boolean;
  documents: number;
  documentsUsed: number;
  line: string;
  /** Every lot has a manifest that is not the unmatched one. */
  complete: boolean;
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Lot sources -> one fact per barcode (first row labels it; units summed; rows with units <= 0 are not stock). */
function lotsByBarcode(sources: readonly CoverageLotSource[]): Map<string, { vendor: string; product: string; units: number; noReceivedDate: boolean }> {
  const out = new Map<string, { vendor: string; product: string; units: number; noReceivedDate: boolean }>();
  for (const s of sources) {
    const bc = clean(s.barcode);
    if (!bc) continue;
    const u = Number(s.units);
    if (Number.isFinite(u) && u <= 0) continue;
    const blank = clean(s.receivedDateRaw) === "";
    const cur = out.get(bc);
    if (!cur) out.set(bc, { vendor: clean(s.vendor) || "(no vendor)", product: clean(s.productName), units: Number.isFinite(u) ? u : 0, noReceivedDate: blank });
    else {
      cur.units += Number.isFinite(u) ? u : 0;
      // A barcode is dated when any of its rows carries a date.
      cur.noReceivedDate = cur.noReceivedDate && blank;
    }
  }
  return out;
}

/**
 * Build the report. `docs` = null means the harvested documents could not be read (0293 not applied):
 * the email step is reported as not checked, never as "nothing found".
 */
export function buildCoverageReport(sources: readonly CoverageLotSource[], plan: Pick<TransferMatchPlan, "decisions" | "transferGroups">, docs: readonly MailDoc[] | null): CoverageReport {
  const lots = lotsByBarcode(sources);
  const numberByTransfer = new Map<number, string>();
  for (const g of plan.transferGroups) numberByTransfer.set(g.transferId, g.manifestNumber);
  const decisionBy = new Map<string, LotTransferDecision>();
  for (const d of plan.decisions) decisionBy.set(clean(d.barcode), d);

  const rowsForOpen = sources.map((s) => ({ barcode: s.barcode, vendor: s.vendor, receivedDateRaw: s.receivedDateRaw, units: s.units, productName: s.productName }));
  const open = openLotsFromTransferPlan(rowsForOpen, plan.decisions);
  const mail: MailMatchPlan | null = docs ? planMailMatch(open, docs) : null;
  const mailBy = new Map((mail?.decisions ?? []).map((d) => [d.barcode, d]));
  const groupBy = new Map((mail?.groups ?? []).map((g) => [g.key, g]));

  const rows: CoverageRow[] = [];
  for (const [barcode, lot] of lots) {
    const d = decisionBy.get(barcode);
    const base = { barcode, vendor: lot.vendor, product: lot.product, units: lot.units, noReceivedDate: lot.noReceivedDate };
    if (d && d.matched) {
      const num = numberByTransfer.get(d.transferId) ?? null;
      const how = d.evidence === "only_receipt" ? "its only transfer" : "first transfer accepted after it was received";
      rows.push({ ...base, source: "transfer", manifestNumber: num, detail: `Cultivera transfer ${num ?? d.transferId} (${how})` });
      continue;
    }
    const why = d && !d.matched ? TRANSFER_MISS_TEXT[d.reason] : "not in the transfer match";
    const m = mailBy.get(barcode);
    if (m && m.outcome === "email") {
      const g = groupBy.get(m.manifestKey);
      const num = g?.manifestNumber ?? null;
      const files = g ? g.files.slice(0, 2).join(", ") : "";
      rows.push({ ...base, source: "email", manifestNumber: num, detail: `emailed manifest ${num ?? "(no number)"}${g?.vendorLabel ? ` from ${g.vendorLabel}` : ""}${files ? ` (${files})` : ""}; Cultivera: ${why}` });
      continue;
    }
    if (m && m.outcome === "several_manifests") {
      const nums = m.candidates.map((k) => groupBy.get(k)?.manifestNumber ?? k).slice(0, 4);
      rows.push({ ...base, source: "several_emails", manifestNumber: UNMATCHED_MANIFEST_NUMBER, detail: `on ${m.candidates.length} emailed manifests (${nums.join(", ")}); none chosen; Cultivera: ${why}` });
      continue;
    }
    const emailWhy = mail ? "no harvested email lists this barcode" : "harvested email not checked";
    rows.push({ ...base, source: "unmatched", manifestNumber: UNMATCHED_MANIFEST_NUMBER, detail: `Cultivera: ${why}; ${emailWhy}` });
  }
  rows.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.product.localeCompare(b.product) || a.barcode.localeCompare(b.barcode));

  const counts = { transfer: 0, email: 0, several_emails: 0, unmatched: 0, lots: 0, units: 0, noReceivedDate: 0 };
  const vend = new Map<string, VendorCoverage>();
  for (const r of rows) {
    counts[r.source] += 1;
    counts.lots += 1;
    counts.units += r.units;
    if (r.noReceivedDate) counts.noReceivedDate += 1;
    const v = vend.get(r.vendor) ?? { vendor: r.vendor, lots: 0, units: 0, transfer: 0, email: 0, several_emails: 0, unmatched: 0, noReceivedDate: 0 };
    v.lots += 1;
    v.units += r.units;
    v[r.source] += 1;
    if (r.noReceivedDate) v.noReceivedDate += 1;
    vend.set(r.vendor, v);
  }
  const byVendor = [...vend.values()].sort((a, b) => b.unmatched + b.several_emails - (a.unmatched + a.several_emails) || b.lots - a.lots || a.vendor.localeCompare(b.vendor));
  const left = counts.unmatched + counts.several_emails;
  const complete = counts.lots > 0 && left === 0;
  const parts = [
    `${counts.lots} Cultivera lot${counts.lots === 1 ? "" : "s"}: ${counts.transfer} on a Cultivera transfer, ${counts.email} found in email`,
    `${left} left for "${UNMATCHED_MANIFEST_LABEL}"${counts.several_emails > 0 ? ` (${counts.several_emails} on several emails, not guessed)` : ""}`,
  ];
  let line = parts.join(", ") + ".";
  if (!mail) line += " The harvested email was NOT checked (apply database update 0293 and run the harvest).";
  else if (mail.summary.documents === 0) line += " No harvested email documents yet: press Harvest the next batch on Menu imports.";
  if (counts.noReceivedDate > 0) line += ` ${counts.noReceivedDate} have no received date (they go to the CCRS clean-up).`;
  if (counts.lots === 0) line = "This import has no Cultivera lots.";
  return {
    ruleVersion: COVERAGE_RULE_VERSION,
    rows,
    byVendor,
    counts,
    emailChecked: mail !== null,
    documents: mail?.summary.documents ?? 0,
    documentsUsed: mail?.summary.documentsUsed ?? 0,
    line,
    complete,
  };
}

/** The open barcodes the email step needs documents for (read only those rows from 0293). */
export function openBarcodes(sources: readonly CoverageLotSource[], plan: Pick<TransferMatchPlan, "decisions">): string[] {
  const rows = sources.map((s) => ({ barcode: s.barcode, vendor: s.vendor, receivedDateRaw: s.receivedDateRaw, units: s.units, productName: s.productName }));
  return openLotsFromTransferPlan(rows, plan.decisions).map((l) => l.barcode);
}

/* ------------------------------------------------------------------ *
 *  Filter + spreadsheet
 * ------------------------------------------------------------------ */

export type CoverageFilter = { source: CoverageSource | null; vendor: string | null; undatedOnly: boolean };

export function coverageFilterFromParams(get: (k: string) => string | null | undefined): CoverageFilter {
  const s = clean(get("source"));
  const v = clean(get("vendor"));
  return {
    source: (COVERAGE_SOURCES as readonly string[]).includes(s) ? (s as CoverageSource) : null,
    vendor: v ? v.slice(0, 200) : null,
    undatedOnly: get("undated") === "1",
  };
}

export function filterCoverage(rows: readonly CoverageRow[], f: CoverageFilter): CoverageRow[] {
  return rows.filter((r) => (!f.source || r.source === f.source) && (!f.vendor || r.vendor === f.vendor) && (!f.undatedOnly || r.noReceivedDate));
}

/** RFC 4180 cell with formula starters (= + - @ tab CR) neutralised by a leading apostrophe. */
export function coverageCsvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const COVERAGE_CSV_HEADER = ["Barcode", "Vendor", "Product", "Cultivera units", "Manifest source", "Manifest number", "Why", "No received date"];

export function coverageCsv(rows: readonly CoverageRow[]): string {
  const out = [COVERAGE_CSV_HEADER.map(coverageCsvCell).join(",")];
  for (const r of rows) {
    out.push(
      [r.barcode, r.vendor, r.product, r.units, COVERAGE_SOURCE_TEXT[r.source], r.manifestNumber, r.detail, r.noReceivedDate ? "yes" : ""].map(coverageCsvCell).join(","),
    );
  }
  return out.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraCoverageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL cultivera-coverage-core: ${name}`);
    }
  };

  const src = (barcode: string, vendor: string, units: number, received: string | null = "2025-01-02 10:00:00", productName = `P ${barcode}`): CoverageLotSource => ({ barcode, vendor, receivedDateRaw: received, units, productName });
  const sources: CoverageLotSource[] = [
    src("1111", "Fireline", 3),
    src("2222", "Canna Organix", 4, ""),
    src("3333", "Canna Organix", 2),
    src("4444", "Mystery Farms", 1, null),
    src("5555", "Mystery Farms", 0), // not stock
    src("2222", "Canna Organix", 1, ""), // same barcode, summed
    src("", "Nobody", 5), // no barcode
  ];
  const plan = {
    transferGroups: [{ transferId: 77, manifestNumber: "0001234" }] as unknown as TransferMatchPlan["transferGroups"],
    decisions: [
      { barcode: "1111", matched: true, transferId: 77, evidence: "only_receipt", receipts: 1, alsoOn: [], vendorByLink: false, link: "none" },
      { barcode: "2222", matched: false, reason: "no_receipt", receipts: 0, link: "none" },
      { barcode: "3333", matched: false, reason: "ambiguous_no_time", receipts: 2, link: "none" },
      { barcode: "4444", matched: false, reason: "no_receipt", receipts: 0, link: "none" },
    ] as LotTransferDecision[],
  };
  const doc = (id: string, num: string, lines: [string, number][]): MailDoc => ({
    messageId: id,
    emailAt: "2025-01-02T18:00:00Z",
    filename: `${num}.json`,
    manifest: {
      manifest_number: num,
      vendor_label: "CANNA ORGANIX LLC",
      vendor_license: "412345",
      transfer_date: "2025-01-02",
      source_format: "wcia",
      lines: lines.map(([lot_code, received_qty]) => ({ lot_code, received_qty, product_name: "Blue Dream", inventory_type: "Usable Marijuana", unit_cost_minor_units: 450 })) as unknown as MailDoc["manifest"]["lines"],
    },
  });

  // 1. no email documents read (0293 missing): not "checked"
  const r0 = buildCoverageReport(sources, plan, null);
  ok(r0.rows.length === 4, "one row per stocked barcode (zero units and blank barcodes left out)");
  ok(r0.counts.transfer === 1 && r0.counts.unmatched === 3 && r0.counts.email === 0, "without email: 1 transfer, 3 unmatched");
  ok(!r0.emailChecked && /NOT checked/.test(r0.line), "email not checked is said loudly");
  ok(r0.rows.find((r) => r.barcode === "1111")?.manifestNumber === "0001234", "transfer row carries the real manifest number");
  ok(/only transfer/.test(r0.rows.find((r) => r.barcode === "1111")?.detail ?? ""), "transfer row says how it matched");
  ok(r0.rows.find((r) => r.barcode === "2222")?.units === 5, "units summed across rows of one barcode");
  ok(r0.rows.find((r) => r.barcode === "2222")?.noReceivedDate === true, "blank received date flagged");
  ok(r0.rows.find((r) => r.barcode === "4444")?.noReceivedDate === true, "null received date flagged");
  ok(r0.rows.find((r) => r.barcode === "3333")?.noReceivedDate === false, "dated lot not flagged");
  ok(r0.counts.noReceivedDate === 2 && /2 have no received date/.test(r0.line), "no-received-date count in the line");
  ok(/harvested email not checked/.test(r0.rows.find((r) => r.barcode === "4444")?.detail ?? ""), "unmatched row says email was not checked");
  ok(r0.rows.find((r) => r.barcode === "4444")?.manifestNumber === UNMATCHED_MANIFEST_NUMBER, "unmatched goes on CV-UNMATCHED");
  ok(!r0.complete, "not complete while lots are unmatched");

  // 2. with email: 2222 on one email, 3333 on two different emails
  const docs = [doc("gm1", "M-1", [["2222", 5]]), doc("gm2", "M-2", [["3333", 2]]), doc("gm3", "M-3", [["3333", 2]]), doc("gm4", "M-1", [["2222", 5]])];
  const r1 = buildCoverageReport(sources, plan, docs);
  const by = (b: string) => r1.rows.find((r) => r.barcode === b)!;
  ok(by("2222").source === "email" && by("2222").manifestNumber === "M-1", "one emailed manifest places the lot (re-sent email = same manifest)");
  ok(/no Cultivera transfer carried/.test(by("2222").detail), "email row keeps why Cultivera missed");
  ok(by("3333").source === "several_emails" && by("3333").manifestNumber === UNMATCHED_MANIFEST_NUMBER, "several emails: not guessed, unmatched manifest");
  ok(/M-2/.test(by("3333").detail) && /M-3/.test(by("3333").detail), "several: candidates named");
  ok(by("4444").source === "unmatched" && /no harvested email lists/.test(by("4444").detail), "unmatched with email checked says so");
  ok(r1.emailChecked && r1.documents === 4, "documents counted");
  ok(r1.counts.transfer + r1.counts.email + r1.counts.several_emails + r1.counts.unmatched === r1.counts.lots, "sources add up to the lots");
  ok(r1.counts.units === 3 + 5 + 2 + 1, "units total");
  ok(/2 left for "Unmatched Cultivera stock" \(1 on several emails, not guessed\)/.test(r1.line), "line names what is left");

  // 3. per vendor: most unplaced first
  ok(r1.byVendor.map((v) => v.vendor).join("|") === "Canna Organix|Mystery Farms|Fireline", "vendors: most unplaced first, then most lots");
  const canna = r1.byVendor.find((v) => v.vendor === "Canna Organix")!;
  ok(canna.lots === 2 && canna.email === 1 && canna.several_emails === 1 && canna.noReceivedDate === 1, "per-vendor counts");
  ok(r1.rows.map((r) => r.vendor).join("|") === "Canna Organix|Canna Organix|Fireline|Mystery Farms", "rows sorted by vendor");

  // 4. complete when everything is placed; empty import
  const allDocs = [doc("gm9", "M-9", [["2222", 5], ["4444", 1]]), doc("gm8", "M-8", [["3333", 2]])];
  const r2 = buildCoverageReport(sources, plan, allDocs);
  ok(r2.complete && r2.counts.unmatched === 0, "complete when every lot is placed");
  ok(buildCoverageReport([], { decisions: [], transferGroups: [] }, []).line === "This import has no Cultivera lots.", "empty import");
  ok(!buildCoverageReport([], { decisions: [], transferGroups: [] }, []).complete, "empty import is not complete");
  const r3 = buildCoverageReport(sources, plan, []);
  ok(/No harvested email documents yet/.test(r3.line), "zero documents: tells the owner to run the harvest");

  // 5. open barcodes = what to read from 0293
  ok(openBarcodes(sources, plan).join(",") === "2222,3333,4444", "open barcodes are the transfer misses with stock");

  // 6. filter
  const f = coverageFilterFromParams((k) => ({ source: "unmatched", vendor: " Mystery  Farms ", undated: "1" })[k] ?? null);
  ok(f.source === "unmatched" && f.vendor === "Mystery Farms" && f.undatedOnly, "filter from params (whitespace collapsed)");
  ok(filterCoverage(r1.rows, f).map((r) => r.barcode).join() === "4444", "filter applies source + vendor + undated");
  ok(coverageFilterFromParams(() => "bogus").source === null, "unknown source ignored");
  ok(filterCoverage(r1.rows, { source: null, vendor: null, undatedOnly: false }).length === 4, "no filter = all");

  // 7. csv
  ok(coverageCsvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)", "formula neutralised");
  ok(coverageCsvCell('a,"b"') === '"a,""b"""', "quotes doubled");
  ok(coverageCsvCell(-5) === "-5", "numbers are not neutralised");
  ok(coverageCsvCell(null) === "", "null empty");
  const csv = coverageCsv(r1.rows);
  ok(csv.startsWith(COVERAGE_CSV_HEADER.join(",") + "\r\n"), "csv header");
  ok(csv.split("\r\n").length === r1.rows.length + 2, "one line per row + header + trailing");
  ok(csv.includes("Several emails (not guessed)") && csv.includes(",yes\r\n"), "csv names the source and the flag");

  return { passed, failed };
}
