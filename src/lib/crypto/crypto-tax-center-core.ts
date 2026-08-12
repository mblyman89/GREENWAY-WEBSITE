/**
 * src/lib/crypto/crypto-tax-center-core.ts
 *
 * R1-F6a — Tax Center view-model + AUDIT BINDER builder (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * This is the presentation brain of the Tax Center. It takes the already-
 * computed outputs of the tax engines — Form 8949 / Schedule D (R1-F3), the
 * ordinary-income report (R1-F4), the method sandbox (R1-F5a) and the file-
 * readiness gate (R1-F5b) — and assembles two things, with ZERO tax logic left
 * in the page/component:
 *
 *   1. buildTaxCenterView(): a per-year on-screen view-model — the year list,
 *      each year's capital-gain and income headline numbers (in whole dollars,
 *      the IRS filing convention), the file-ready badge + open blocks, and the
 *      method-sandbox comparison — everything the screen renders.
 *
 *   2. buildAuditBinderHtml(): a single, self-contained, printable HTML document
 *      (the "golden ticket") — every acquisition lot, every disposal (with the
 *      8949 row + which lots it consumed), every income event, every transfer
 *      match, every price source, the method choice, and every acknowledgment.
 *      This is the §Q95 "records sufficient to establish positions" deliverable:
 *      print it to PDF and hand it to a CPA or the IRS.
 *
 * Safety
 * ------
 * All HTML is escaped through esc() — no user/asset string can inject markup.
 * All money is integer cents in, whole-dollar (half-up) out at render, matching
 * the 8949/income engines exactly. A year is only ever shown "file-ready" when
 * its readiness result says so — this module never overrides a hard-block.
 */

import type { Form8949Report, Form8949Row, ScheduleDResult } from "./crypto-form8949-core";
import { centsToWholeDollars } from "./crypto-form8949-core";
import type { IncomeYearReport } from "./crypto-income-report-core";
import type { FileReadinessResult, ReadinessIssue } from "./crypto-file-readiness-core";
import type { MethodSandboxResult } from "./crypto-method-sandbox-core";

// ---------------------------------------------------------------------------
// Small shared formatting (whole-dollar, IRS style) — no floats.
// ---------------------------------------------------------------------------

/** Integer cents → "$1,234" (whole dollars, half-up, sign preserved). */
export function formatWholeDollars(cents: number): string {
  const dollars = centsToWholeDollars(cents);
  const neg = dollars < 0;
  const abs = Math.abs(dollars);
  const s = abs.toLocaleString("en-US");
  return neg ? `-$${s}` : `$${s}`;
}

/** Escape a string for safe embedding in HTML text/attribute context. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// On-screen view-model.
// ---------------------------------------------------------------------------

/** One year's headline card in the Tax Center. */
export interface TaxCenterYearView {
  taxYear: number;

  // Capital gains (Form 8949 / Schedule D).
  shortTermGainCents: number;
  longTermGainCents: number;
  netCapitalGainCents: number;
  capitalLossCarryforwardCents: number;
  form8949RowCount: number;

  // Ordinary income (Schedule 1 / Schedule C).
  schedule1IncomeCents: number;
  scheduleCIncomeCents: number;
  totalIncomeCents: number;

  // Readiness.
  fileReady: boolean;
  yearLocked: boolean;
  blockingCount: number;
  warningCount: number;
  issues: ReadinessIssue[];

  // Method sandbox (planning).
  chosenMethodGainCents: number;
  lowestGainMethod: string;
  potentialReductionVsFifoCents: number;

  // Pre-formatted display strings (page stays logic-free).
  netCapitalGainDisplay: string;
  totalIncomeDisplay: string;
  carryforwardDisplay: string;
}

/** All inputs for ONE year, from the four engines. */
export interface TaxCenterYearInput {
  taxYear: number;
  form8949: Form8949Report;
  income: IncomeYearReport | null;
  readiness: FileReadinessResult;
  sandbox: MethodSandboxResult;
}

export interface BuildTaxCenterViewInput {
  years: readonly TaxCenterYearInput[];
}

export interface TaxCenterView {
  years: TaxCenterYearView[];
  /** True when EVERY year present is file-ready (or there are no years). */
  allYearsReady: boolean;
  totalNetCapitalGainCents: number;
  totalIncomeCents: number;
}

function buildYearView(input: TaxCenterYearInput): TaxCenterYearView {
  const sd: ScheduleDResult = input.form8949.scheduleD;
  const shortTermGainCents = input.form8949.shortTermTotals.gainLossCents;
  const longTermGainCents = input.form8949.longTermTotals.gainLossCents;

  const schedule1IncomeCents = input.income ? input.income.schedule1.amountCents : 0;
  const scheduleCIncomeCents = input.income ? input.income.scheduleC.amountCents : 0;
  const totalIncomeCents = schedule1IncomeCents + scheduleCIncomeCents;

  const chosen = input.sandbox.outcomes.find((o) => o.method === input.sandbox.defaultMethod)
    ?? input.sandbox.outcomes[0];

  return {
    taxYear: input.taxYear,
    shortTermGainCents,
    longTermGainCents,
    netCapitalGainCents: sd.netCapitalGainCents,
    capitalLossCarryforwardCents: sd.lossCarryforwardCents,
    form8949RowCount: input.form8949.rows.length,
    schedule1IncomeCents,
    scheduleCIncomeCents,
    totalIncomeCents,
    fileReady: input.readiness.fileReady,
    yearLocked: input.readiness.yearLocked,
    blockingCount: input.readiness.blockingCount,
    warningCount: input.readiness.warningCount,
    issues: input.readiness.issues,
    chosenMethodGainCents: chosen ? chosen.totalRealizedGainCents : 0,
    lowestGainMethod: input.sandbox.lowestGainMethod,
    potentialReductionVsFifoCents: input.sandbox.potentialGainReductionVsFifoCents,
    netCapitalGainDisplay: formatWholeDollars(sd.netCapitalGainCents),
    totalIncomeDisplay: formatWholeDollars(totalIncomeCents),
    carryforwardDisplay: formatWholeDollars(sd.lossCarryforwardCents),
  };
}

export function buildTaxCenterView(input: BuildTaxCenterViewInput): TaxCenterView {
  const years = input.years
    .map(buildYearView)
    .sort((a, b) => a.taxYear - b.taxYear);

  let totalNetCapitalGainCents = 0;
  let totalIncomeCents = 0;
  let allReady = true;
  for (const y of years) {
    totalNetCapitalGainCents += y.netCapitalGainCents;
    totalIncomeCents += y.totalIncomeCents;
    if (!y.fileReady) allReady = false;
  }

  return {
    years,
    allYearsReady: allReady,
    totalNetCapitalGainCents,
    totalIncomeCents,
  };
}

// ---------------------------------------------------------------------------
// Audit Binder (printable HTML).
// ---------------------------------------------------------------------------

/** An acquisition lot line for the binder (pre-formatted by the caller). */
export interface BinderLot {
  assetSymbol: string;
  quantityDisplay: string;
  acquiredDate: string;
  basisDisplay: string;
  source: string;
}

/** A disposal line for the binder (8949 row + which lots it consumed). */
export interface BinderDisposal {
  assetSymbol: string;
  quantityDisplay: string;
  box: string;
  dateAcquired: string;
  dateSold: string;
  proceedsDisplay: string;
  basisDisplay: string;
  gainLossDisplay: string;
  consumedLots: string;
  hasMissingBasis: boolean;
}

/** An income event line for the binder. */
export interface BinderIncome {
  assetSymbol: string;
  tagLabel: string;
  fmvDisplay: string;
  receivedDate: string;
  schedule: string;
}

/** A confirmed self-transfer line (basis carryover proof). */
export interface BinderTransfer {
  assetSymbol: string;
  quantityDisplay: string;
  fromWallet: string;
  toWallet: string;
  transferDate: string;
  note: string;
}

/** A price-source line (provenance). */
export interface BinderPriceSource {
  assetSymbol: string;
  source: string;
  asOf: string;
}

/** An owner acknowledgment line (documented $0-basis / unpriced choices). */
export interface BinderAcknowledgment {
  kind: string;
  detail: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

export interface BinderYear {
  taxYear: number;
  method: string;
  fileReady: boolean;
  netCapitalGainDisplay: string;
  totalIncomeDisplay: string;
  lots: readonly BinderLot[];
  disposals: readonly BinderDisposal[];
  income: readonly BinderIncome[];
  transfers: readonly BinderTransfer[];
  priceSources: readonly BinderPriceSource[];
  acknowledgments: readonly BinderAcknowledgment[];
  issues: readonly ReadinessIssue[];
  /**
   * R1-G5 — pre-rendered "reconstruction workpaper + assumptions register" HTML
   * for coins traced back to an origin (built by crypto-reconstruction-report-
   * core). Empty string when nothing was reconstructed this year, so a clean
   * year shows no clutter. Already escaped + self-contained sections.
   */
  reconstructionHtml?: string;
}

export interface AuditBinderInput {
  ownerName: string;
  businessName: string;
  generatedAtIso: string;
  years: readonly BinderYear[];
}

function tableRows(cells: readonly (readonly string[])[]): string {
  return cells
    .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
}

function headerRow(headers: readonly string[]): string {
  return `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
}

function section(title: string, headers: readonly string[], rows: string, emptyNote: string): string {
  const body = rows.length > 0
    ? `<table><thead>${headerRow(headers)}</thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">${esc(emptyNote)}</p>`;
  return `<section><h3>${esc(title)}</h3>${body}</section>`;
}

function form8949RowsHtml(disposals: readonly BinderDisposal[]): string {
  return tableRows(
    disposals.map((d) => [
      `${d.quantityDisplay} ${d.assetSymbol}`,
      d.box,
      d.dateAcquired,
      d.dateSold,
      d.proceedsDisplay,
      d.basisDisplay,
      d.gainLossDisplay,
      d.hasMissingBasis ? "⚠ MISSING BASIS" : d.consumedLots,
    ]),
  );
}

function binderYearHtml(y: BinderYear): string {
  const readyBadge = y.fileReady
    ? `<span class="badge ready">FILE-READY</span>`
    : `<span class="badge blocked">NOT READY — ${esc(String(y.issues.filter((i) => i.severity === "blocking").length))} open block(s)</span>`;

  const issuesHtml = y.issues.length > 0
    ? `<section><h3>Open items &amp; notes</h3><ul>${y.issues
        .map((i) => `<li><strong>${esc(i.title)}</strong> (${esc(i.severity)}${i.count > 0 ? `, ${esc(String(i.count))}` : ""}): ${esc(i.fix)}</li>`)
        .join("")}</ul></section>`
    : "";

  return `
  <div class="year">
    <div class="year-head">
      <h2>Tax year ${esc(String(y.taxYear))}</h2>
      ${readyBadge}
    </div>
    <p class="summary">
      Accounting method: <strong>${esc(y.method.toUpperCase())}</strong> &nbsp;•&nbsp;
      Net capital gain/(loss): <strong>${esc(y.netCapitalGainDisplay)}</strong> &nbsp;•&nbsp;
      Ordinary income: <strong>${esc(y.totalIncomeDisplay)}</strong>
    </p>

    ${section(
      "Form 8949 — disposals (self-custody; boxes I short-term / L long-term)",
      ["Property", "Box", "Date acquired", "Date sold", "Proceeds", "Cost basis", "Gain/(loss)", "Lots consumed"],
      form8949RowsHtml(y.disposals),
      "No disposals this year.",
    )}

    ${section(
      "Acquisition lots (cost-basis ledger)",
      ["Asset", "Quantity", "Acquired", "Cost basis", "Source"],
      tableRows(y.lots.map((l) => [l.assetSymbol, l.quantityDisplay, l.acquiredDate, l.basisDisplay, l.source])),
      "No acquisition lots recorded this year.",
    )}

    ${section(
      "Ordinary income events (FMV at receipt)",
      ["Asset", "Type", "FMV (USD)", "Received", "Schedule"],
      tableRows(y.income.map((e) => [e.assetSymbol, e.tagLabel, e.fmvDisplay, e.receivedDate, e.schedule])),
      "No income events this year.",
    )}

    ${section(
      "Self-transfers (basis carryover proof — non-taxable)",
      ["Asset", "Quantity", "From wallet", "To wallet", "Date", "Note"],
      tableRows(y.transfers.map((t) => [t.assetSymbol, t.quantityDisplay, t.fromWallet, t.toWallet, t.transferDate, t.note])),
      "No self-transfers matched this year.",
    )}

    ${section(
      "Price sources (provenance)",
      ["Asset", "Source", "As of"],
      tableRows(y.priceSources.map((p) => [p.assetSymbol, p.source, p.asOf])),
      "No external price sources recorded this year.",
    )}

    ${section(
      "Acknowledgments (documented owner choices)",
      ["Kind", "Detail", "By", "At"],
      tableRows(y.acknowledgments.map((a) => [a.kind, a.detail, a.acknowledgedBy, a.acknowledgedAt])),
      "No acknowledgments recorded — nothing was assumed.",
    )}

    ${y.reconstructionHtml ?? ""}

    ${issuesHtml}
  </div>`;
}

/** Build the whole self-contained printable Audit Binder HTML document. */
export function buildAuditBinderHtml(input: AuditBinderInput): string {
  const style = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 32px; background: #fff; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 17px; margin: 0; }
    h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #444; margin: 18px 0 6px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
    .year { border-top: 3px solid #111; padding-top: 12px; margin-top: 28px; page-break-inside: auto; }
    .year:first-of-type { margin-top: 12px; }
    .year-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .summary { font-size: 13px; color: #222; margin: 6px 0 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0 10px; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; font-weight: 600; }
    .empty { font-size: 12px; color: #777; font-style: italic; margin: 2px 0 10px; }
    .badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
    .badge.ready { background: #e6f4ea; color: #137333; border: 1px solid #137333; }
    .badge.blocked { background: #fce8e6; color: #b3261e; border: 1px solid #b3261e; }
    ul { margin: 6px 0 10px; padding-left: 18px; font-size: 12px; }
    li { margin: 3px 0; }
    footer { margin-top: 32px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 10px; color: #777; }
    @media print { body { padding: 0; } .year { page-break-before: always; } .year:first-of-type { page-break-before: avoid; } }
  `;

  const yearsHtml = input.years.length > 0
    ? input.years
        .slice()
        .sort((a, b) => a.taxYear - b.taxYear)
        .map(binderYearHtml)
        .join("")
    : `<p class="empty">No tax years to report yet. Connect wallets, sync, and classify transactions to populate this binder.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(input.businessName)} — Crypto Tax Audit Binder</title>
<style>${style}</style></head>
<body>
  <h1>${esc(input.businessName)} — Crypto Tax Audit Binder</h1>
  <div class="meta">
    Prepared for ${esc(input.ownerName)} &nbsp;•&nbsp; Generated ${esc(input.generatedAtIso)}<br/>
    This binder documents every acquisition lot, disposal (with the specific lots consumed), ordinary-income event,
    self-transfer (basis carryover), price source, accounting-method choice, and owner acknowledgment used to compute
    the figures below. Cost basis is tracked per wallet (IRS 2025 rule). Nothing is assumed: any missing basis or price
    is flagged, never silently set to $0. Figures are rounded to whole dollars for filing.
  </div>
  ${yearsHtml}
  <footer>
    Generated by the Greenway crypto Tax Center. Self-custody digital-asset sales are reported on IRS Form 8949 in
    box I (short-term) / box L (long-term) and summarized on Schedule D. Ordinary-income events are reported on
    Schedule 1 (or Schedule C for business income). This is a records workpaper, not tax advice — review with a CPA.
  </footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-tax-center-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`crypto-tax-center-core: ${msg}`);
}

function fakeForm8949(shortGain: number, longGain: number, net: number, carry: number, rows: number): Form8949Report {
  const mkRow = (): Form8949Row => ({
    box: "I",
    holdingPeriod: "short",
    descriptionColA: "1 FLR",
    dateAcquiredColB: "2024-01-01",
    dateSoldColC: "2024-06-01",
    proceedsCents: 0,
    costBasisCents: 0,
    adjustmentCodeColF: "",
    adjustmentCents: 0,
    gainLossCents: 0,
    disposalId: "d",
    hasMissingBasis: false,
  });
  return {
    rows: Array.from({ length: rows }, mkRow),
    shortTermTotals: { box: "I", holdingPeriod: "short", rowCount: rows, proceedsCents: 0, costBasisCents: 0, adjustmentCents: 0, gainLossCents: shortGain },
    longTermTotals: { box: "L", holdingPeriod: "long", rowCount: 0, proceedsCents: 0, costBasisCents: 0, adjustmentCents: 0, gainLossCents: longGain },
    scheduleD: {
      shortTermNetCents: shortGain,
      longTermNetCents: longGain,
      netCapitalGainCents: net,
      allowedLossOrGainCents: net,
      lossCarryforwardCents: carry,
      filingStatus: "single",
      capUsedCents: 0,
    },
    hasAnyMissingBasis: false,
  };
}

function fakeIncome(taxYear: number, sched1: number, schedC: number): IncomeYearReport {
  return {
    taxYear,
    schedule1: { schedule: "schedule-1", eventCount: sched1 > 0 ? 1 : 0, amountCents: sched1, byTag: [] },
    scheduleC: { schedule: "schedule-c", eventCount: schedC > 0 ? 1 : 0, amountCents: schedC, byTag: [] },
    totalIncomeCents: sched1 + schedC,
    eventCount: (sched1 > 0 ? 1 : 0) + (schedC > 0 ? 1 : 0),
  };
}

function fakeReadiness(taxYear: number, fileReady: boolean, blocking: number, issues: ReadinessIssue[]): FileReadinessResult {
  return { taxYear, issues, blockingCount: blocking, warningCount: 0, fileReady, yearLocked: false };
}

function fakeSandbox(fifoGain: number, lowest: "fifo" | "lifo" | "hifo", reduction: number): MethodSandboxResult {
  return {
    outcomes: [
      { method: "fifo", totalRealizedGainCents: fifoGain, totalShortTermGainCents: fifoGain, totalLongTermGainCents: 0, hasAnyMissingBasis: false, requiresSpecId: false, guardRailNote: "" },
      { method: "lifo", totalRealizedGainCents: fifoGain - reduction, totalShortTermGainCents: 0, totalLongTermGainCents: 0, hasAnyMissingBasis: false, requiresSpecId: true, guardRailNote: "note" },
      { method: "hifo", totalRealizedGainCents: fifoGain - reduction, totalShortTermGainCents: 0, totalLongTermGainCents: 0, hasAnyMissingBasis: false, requiresSpecId: true, guardRailNote: "note" },
    ],
    lowestGainMethod: lowest,
    defaultMethod: "fifo",
    potentialGainReductionVsFifoCents: reduction,
    hasAnyMissingBasis: false,
  };
}

export function __runCryptoTaxCenterCoreTests(): void {
  // --- whole-dollar formatting (half-up, sign, thousands) ---
  eq(formatWholeDollars(0), "$0", "$0");
  eq(formatWholeDollars(150), "$2", "150c -> $2 (half up)");
  eq(formatWholeDollars(149), "$1", "149c -> $1");
  eq(formatWholeDollars(123456), "$1,235", "1234.56 -> $1,235");
  eq(formatWholeDollars(-250050), "-$2,501", "negative rounds + sign");

  // --- HTML escaping ---
  eq(esc(`a<b>&"'`), "a&lt;b&gt;&amp;&quot;&#39;", "escapes html specials");

  // --- year view assembly ---
  const view = buildTaxCenterView({
    years: [
      {
        taxYear: 2024,
        form8949: fakeForm8949(5000, 12000, 17000, 0, 3),
        income: fakeIncome(2024, 2500, 100000),
        readiness: fakeReadiness(2024, true, 0, []),
        sandbox: fakeSandbox(17000, "lifo", 4000),
      },
      {
        taxYear: 2023,
        form8949: fakeForm8949(-600000, -100000, -700000, 400000, 2),
        income: null,
        readiness: fakeReadiness(2023, false, 1, [
          { check: "MISSING_BASIS", severity: "blocking", title: "Missing cost basis on a sale", fix: "Connect the wallet.", count: 2 },
        ]),
        sandbox: fakeSandbox(-700000, "fifo", 0),
      },
    ],
  });

  eq(view.years.length, 2, "two years");
  eq(view.years[0].taxYear, 2023, "sorted ascending — 2023 first");
  eq(view.years[1].taxYear, 2024, "2024 second");

  const y24 = view.years[1];
  eq(y24.netCapitalGainCents, 17000, "2024 net capital gain");
  eq(y24.form8949RowCount, 3, "2024 8949 row count");
  eq(y24.schedule1IncomeCents, 2500, "2024 schedule 1 income");
  eq(y24.scheduleCIncomeCents, 100000, "2024 schedule C income");
  eq(y24.totalIncomeCents, 102500, "2024 total income");
  eq(y24.totalIncomeDisplay, "$1,025", "2024 income display");
  eq(y24.netCapitalGainDisplay, "$170", "2024 gain display");
  eq(y24.fileReady, true, "2024 file-ready");
  eq(y24.chosenMethodGainCents, 17000, "chosen (fifo) gain");
  eq(y24.lowestGainMethod, "lifo", "lowest method surfaced");
  eq(y24.potentialReductionVsFifoCents, 4000, "reduction surfaced");

  const y23 = view.years[0];
  eq(y23.fileReady, false, "2023 not ready");
  eq(y23.blockingCount, 1, "2023 has a block");
  eq(y23.capitalLossCarryforwardCents, 400000, "2023 carryforward");
  eq(y23.carryforwardDisplay, "$4,000", "2023 carryforward display");
  eq(view.allYearsReady, false, "not all years ready (2023 blocks)");
  eq(view.totalNetCapitalGainCents, 17000 - 700000, "total net across years");

  // --- empty view is trivially all-ready ---
  const emptyView = buildTaxCenterView({ years: [] });
  eq(emptyView.years.length, 0, "no years");
  eq(emptyView.allYearsReady, true, "empty -> all ready (nothing blocks)");

  // --- Audit Binder HTML: structure + escaping + flags ---
  const html = buildAuditBinderHtml({
    ownerName: "Michael",
    businessName: "Greenway Marijuana",
    generatedAtIso: "2026-01-15T00:00:00Z",
    years: [
      {
        taxYear: 2024,
        method: "fifo",
        fileReady: true,
        netCapitalGainDisplay: "$170",
        totalIncomeDisplay: "$1,025",
        lots: [{ assetSymbol: "FLR", quantityDisplay: "100", acquiredDate: "2024-01-01", basisDisplay: "$50", source: "buy tx 0xabc" }],
        disposals: [{
          assetSymbol: "FLR", quantityDisplay: "10", box: "I", dateAcquired: "2024-01-01", dateSold: "2024-06-01",
          proceedsDisplay: "$20", basisDisplay: "$5", gainLossDisplay: "$15", consumedLots: "lot A (10)", hasMissingBasis: false,
        }],
        income: [{ assetSymbol: "FLR", tagLabel: "FTSO / delegation reward", fmvDisplay: "$12", receivedDate: "2024-03-01", schedule: "Schedule 1" }],
        transfers: [{ assetSymbol: "FLR", quantityDisplay: "5", fromWallet: "Wallet A", toWallet: "Ledger", transferDate: "2024-04-01", note: "self-move, basis carried" }],
        priceSources: [{ assetSymbol: "FLR", source: "CoinGecko", asOf: "2024-03-01" }],
        acknowledgments: [],
        issues: [],
        reconstructionHtml: "<section><h3>Cost-basis reconstruction workpaper</h3><p>traced XRP back to Coinbase</p></section>",
      },
      {
        taxYear: 2023,
        method: "fifo",
        fileReady: false,
        netCapitalGainDisplay: "-$7,000",
        totalIncomeDisplay: "$0",
        lots: [],
        disposals: [{
          assetSymbol: "XLM", quantityDisplay: "50", box: "I", dateAcquired: "", dateSold: "2023-05-01",
          proceedsDisplay: "$500", basisDisplay: "$0", gainLossDisplay: "$500", consumedLots: "", hasMissingBasis: true,
        }],
        income: [],
        transfers: [],
        priceSources: [],
        acknowledgments: [{ kind: "Zero-basis", detail: "XLM lot, no records", acknowledgedBy: "Michael", acknowledgedAt: "2026-01-10" }],
        issues: [{ check: "MISSING_BASIS", severity: "blocking", title: "Missing cost basis on a sale", fix: "Connect the wallet.", count: 1 }],
      },
    ],
  });

  truthy(html.startsWith("<!doctype html>"), "binder is a full html doc");
  truthy(html.includes("Greenway Marijuana — Crypto Tax Audit Binder"), "binder has titled header");
  truthy(html.includes("Prepared for Michael"), "binder names the owner");
  truthy(html.includes("Tax year 2023"), "binder includes 2023");
  truthy(html.includes("Tax year 2024"), "binder includes 2024");
  truthy(html.includes("FILE-READY"), "binder shows file-ready badge");
  truthy(html.includes("NOT READY"), "binder shows not-ready badge");
  truthy(html.includes("⚠ MISSING BASIS"), "binder flags missing basis, never silent $0");
  truthy(html.includes("box I (short-term) / box L (long-term)"), "binder cites correct 8949 boxes");
  // 2023 must be ordered before 2024 in the document.
  truthy(html.indexOf("Tax year 2023") < html.indexOf("Tax year 2024"), "binder years sorted ascending");
  // R1-G5: the reconstruction workpaper HTML is folded into the year when present.
  truthy(html.includes("Cost-basis reconstruction workpaper"), "binder folds in reconstruction workpaper");
  truthy(html.includes("traced XRP back to Coinbase"), "binder includes reconstruction body");

  // --- escaping actually applies to asset/source strings ---
  const injected = buildAuditBinderHtml({
    ownerName: "M<script>",
    businessName: "Greenway",
    generatedAtIso: "2026-01-15",
    years: [],
  });
  truthy(injected.includes("M&lt;script&gt;"), "owner name is escaped");
  truthy(!injected.includes("M<script>"), "no raw injection survives");

  console.log("crypto-tax-center-core self-tests: all passed");
}
