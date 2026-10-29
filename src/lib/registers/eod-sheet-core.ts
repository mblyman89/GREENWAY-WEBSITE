/**
 * src/lib/registers/eod-sheet-core.ts  (Fix Phase 2.6b · G-15)
 *
 * PURE builder for the END-OF-DAY DEPOSIT SHEET: the owner's
 *   "end of day spreadsheet that one person completes before close, and the
 *    morning employee recounts and verifies the amount before sealing the bag"
 * and his
 *   "closing shift and closing day reports are built and can be exported and
 *    printed".
 *
 * Zero I/O. The store (eod-store.ts) reads the rows; this file does the math
 * and decides what may be shown. The same model feeds the printed page and
 * the CSV / XLSX export, so paper and spreadsheet cannot disagree.
 *
 *   Deposit (SOP-03 §4.1): for each closed drawer, takings = closing count −
 *   its own counted opening float; deposit = Σ takings + drops. Worked out by
 *   deposit-bag-flow-core#expectedDeposit, the same function the bag screen
 *   uses at the night count (one rule, one place).
 *
 *   Cash check (F-03-6): cash sales (processed, cash tender, with rounding)
 *   − refunds paid out of drawers = net cash the drawers should have taken
 *   in. Refunds are the Z report's sources (voids in audit_logs, counter
 *   returns in customer_returns) summarised by day-report-core#summarizeRefunds.
 *   A refund that is not tied to a drawer or the safe makes the net figure a
 *   question (null, with the reason), never a guess (rule 135).
 *
 *   Bag (G-04): the day's bag, its night count and its morning recount, by
 *   denomination. The night figure stays hidden until the morning recount is
 *   saved (deposit-bag-flow-core#showNightFigure, SOP-03 §4.10 step 2), on the
 *   page AND in the export.
 *
 * Money is MINOR UNITS (cents), integers throughout.
 */

import { summarizeRefunds, type DaySummary, type RefundRow, type RefundSummary } from "@/lib/pos/day-report-core";
import { saleCashMinor } from "@/lib/registers/drawer-figure-core";
import { DENOM_FIELDS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";
import {
  bagStage,
  expectedDeposit,
  showNightFigure,
  STAGE_LABEL,
  type BagRow,
  type ExpectedDeposit,
  type ExpectedSessionInput,
} from "@/lib/registers/deposit-bag-flow-core";
import type { WorkbookSpec } from "@/lib/reports/workbook";

// ---------------------------------------------------------------------------
// Cash sales from the day's sale events
// ---------------------------------------------------------------------------

export type CashSalesSummary = {
  cashSaleCount: number;
  /** Cash in: total + rounding, cash tender only (drawer-figure-core#saleCashMinor). */
  cashSalesMinor: number;
  employeeTabCount: number;
  employeeTabMinor: number;
  /** Processed sales paid by any tender that is neither cash nor employee tab. */
  otherTenderCount: number;
  otherTenderMinor: number;
};

function int(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Processed sales only, split by tender. Pending and refused sales add nothing. */
export function summarizeCashSales(events: readonly { eventType: string; status: string; payload: unknown }[]): CashSalesSummary {
  const out: CashSalesSummary = {
    cashSaleCount: 0,
    cashSalesMinor: 0,
    employeeTabCount: 0,
    employeeTabMinor: 0,
    otherTenderCount: 0,
    otherTenderMinor: 0,
  };
  for (const e of events) {
    if (e.eventType !== "sale" || e.status !== "processed") continue;
    const p = rec(e.payload);
    if (p.paymentMethod === "cash") {
      out.cashSaleCount += 1;
      out.cashSalesMinor += saleCashMinor(p);
    } else if (p.paymentMethod === "employee_tab") {
      out.employeeTabCount += 1;
      out.employeeTabMinor += int(p.totalMinor);
    } else {
      out.otherTenderCount += 1;
      out.otherTenderMinor += int(p.totalMinor);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Refunds: where each one was paid from
// ---------------------------------------------------------------------------

export type SheetRefund = {
  source: "void" | "return";
  refundMinor: number;
  /** "drawer" | "safe" | null (null = not tied to anything yet). */
  paidFrom: "drawer" | "safe" | null;
};

export type RefundSplit = {
  /** The Z report's summary: counts and totals of voids and returns. */
  summary: RefundSummary;
  fromDrawersMinor: number;
  fromSafeMinor: number;
  unattributedCount: number;
  unattributedMinor: number;
};

export function splitRefunds(rows: readonly SheetRefund[]): RefundSplit {
  const summary = summarizeRefunds(rows.map((r): RefundRow => ({ source: r.source, refundMinor: r.refundMinor })));
  let fromDrawersMinor = 0;
  let fromSafeMinor = 0;
  let unattributedCount = 0;
  let unattributedMinor = 0;
  for (const r of rows) {
    const m = Math.max(0, int(r.refundMinor));
    if (r.paidFrom === "drawer") fromDrawersMinor += m;
    else if (r.paidFrom === "safe") fromSafeMinor += m;
    else {
      unattributedCount += 1;
      unattributedMinor += m;
    }
  }
  return { summary, fromDrawersMinor, fromSafeMinor, unattributedCount, unattributedMinor };
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export type SheetBagInput = BagRow & {
  nightDenoms: DenomCounts | null;
  morningDenoms: DenomCounts | null;
  nightCountedByName: string | null;
  morningCountedByName: string | null;
  sealedByName: string | null;
};

export type SheetBag = {
  bagNo: string;
  stageLabel: string;
  /** False until the morning recount is saved: the night figure is hidden. */
  nightShown: boolean;
  nightCountMinor: number | null;
  nightDenoms: DenomCounts | null;
  nightCountedByName: string | null;
  morningCountMinor: number | null;
  morningDenoms: DenomCounts | null;
  morningCountedByName: string | null;
  varianceReason: string | null;
  sealedByName: string | null;
  sealedAt: string | null;
  bankedOn: string | null;
  /** The bag's count compared with the drawers' expected deposit. */
  againstExpectedMinor: number | null;
};

export type EodSheet = {
  businessDay: string;
  deposit: ExpectedDeposit;
  cash: CashSalesSummary;
  refunds: RefundSplit;
  /** cash sales − refunds paid from drawers. Null when a refund is not tied to anything. */
  netCashMinor: number | null;
  netCashProblem: string | null;
  /** expected deposit − net cash: should match the drawers' total over/short. */
  differenceMinor: number | null;
  bag: SheetBag | null;
  /** Why there is no bag (not set up, none recorded yet, or a read error). */
  bagNote: string | null;
  /** Every read that did not complete. Non-empty = the sheet may be short. */
  readProblems: string[];
};

export const NO_BAG_YET = "No deposit bag has been recorded for this day yet (Deposit bags screen, SOP-03 §4.5).";
export const BAG_SCHEMA_MISSING = "The Deposit bags screen is not set up yet (migration 0316). Use the paper night sheet (form 8.1).";

export function buildEodSheet(input: {
  businessDay: string;
  sessions: readonly ExpectedSessionInput[];
  drops: readonly { sessionId: string; amountMinor: number }[];
  saleEvents: readonly { eventType: string; status: string; payload: unknown }[];
  refunds: readonly SheetRefund[];
  bag: SheetBagInput | null;
  bagMissingSchema: boolean;
  readProblems: readonly string[];
}): EodSheet {
  const deposit = expectedDeposit(input.sessions, input.drops);
  const cash = summarizeCashSales(input.saleEvents);
  const refunds = splitRefunds(input.refunds);
  const readProblems = [...input.readProblems];

  let netCashMinor: number | null = null;
  let netCashProblem: string | null = null;
  if (refunds.unattributedCount > 0) {
    netCashProblem =
      `${refunds.unattributedCount} cash refund${refunds.unattributedCount === 1 ? " is" : "s are"} (${formatCents(refunds.unattributedMinor)}) ` +
      "not tied to a drawer or the safe, so the net cash cannot be worked out. Say where each was paid from on the reconcile screen first.";
  } else if (readProblems.length > 0) {
    netCashProblem = "Some records could not be read (see the warning at the top), so the net cash is not shown.";
  } else {
    netCashMinor = cash.cashSalesMinor - refunds.fromDrawersMinor;
  }
  const differenceMinor =
    netCashMinor !== null && deposit.expectedMinor !== null ? deposit.expectedMinor - netCashMinor : null;

  let bag: SheetBag | null = null;
  let bagNote: string | null = null;
  if (input.bag) {
    const b = input.bag;
    const nightShown = showNightFigure(b);
    bag = {
      bagNo: b.bagNo,
      stageLabel: STAGE_LABEL[bagStage(b)],
      nightShown,
      nightCountMinor: nightShown ? b.nightCountMinor : null,
      nightDenoms: nightShown ? b.nightDenoms : null,
      nightCountedByName: b.nightCountedByName,
      morningCountMinor: b.morningCountMinor,
      morningDenoms: b.morningDenoms,
      morningCountedByName: b.morningCountedByName,
      varianceReason: b.varianceReason,
      sealedByName: b.sealedByName,
      sealedAt: b.sealedAt,
      bankedOn: b.bankedOn,
      againstExpectedMinor:
        deposit.expectedMinor === null
          ? null
          : b.morningCountMinor !== null
            ? b.morningCountMinor - deposit.expectedMinor
            : nightShown && b.nightCountMinor !== null
              ? b.nightCountMinor - deposit.expectedMinor
              : null,
    };
  } else if (input.bagMissingSchema) {
    bagNote = BAG_SCHEMA_MISSING;
  } else if (!readProblems.some((p) => p.startsWith("Deposit bag"))) {
    bagNote = NO_BAG_YET;
  } else {
    bagNote = "The day's deposit bag could not be read.";
  }

  return {
    businessDay: input.businessDay,
    deposit,
    cash,
    refunds,
    netCashMinor,
    netCashProblem,
    differenceMinor,
    bag,
    bagNote,
    readProblems,
  };
}

/** Read a jsonb denomination blob from 0316 into counts. Null when absent or not an object. */
export function denomsFromJson(v: unknown): DenomCounts | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out = {} as DenomCounts;
  for (const f of DENOM_FIELDS) {
    const n = o[f.key];
    out[f.key] = typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
  }
  return out;
}

/** One row per denomination, high to low: label, night qty/value, morning qty/value. */
export function denomGridRows(night: DenomCounts | null, morning: DenomCounts | null) {
  return DENOM_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    nightQty: night ? night[f.key] : null,
    nightMinor: night ? denomTotalMinor({ [f.key]: night[f.key] }) : null,
    morningQty: morning ? morning[f.key] : null,
    morningMinor: morning ? denomTotalMinor({ [f.key]: morning[f.key] }) : null,
  }));
}

// ---------------------------------------------------------------------------
// Export (CSV / XLSX through src/lib/reports/workbook.ts)
// ---------------------------------------------------------------------------

/**
 * The sheet as a workbook spec. The caller must refuse to export when
 * `readProblems` is not empty (a file cannot carry the warning banner).
 */
export function eodSheetWorkbook(sheet: EodSheet, sales: DaySummary): WorkbookSpec {
  const d = sheet.deposit;
  const cashRows: { item: string; amount: number | null; note: string }[] = [
    { item: "Total takings (closing count − float)", amount: d.totalTakingsMinor, note: "(a)" },
    { item: "Drops", amount: d.totalDropsMinor, note: "(b)" },
    { item: "Expected deposit (a) + (b)", amount: d.expectedMinor, note: d.expectedMinor === null ? d.problems.join(" ") : "(c)" },
    { item: `Cash sales (${sheet.cash.cashSaleCount}, with rounding)`, amount: sheet.cash.cashSalesMinor, note: "processed, cash tender" },
    { item: `Refunds paid from drawers`, amount: -sheet.refunds.fromDrawersMinor, note: "voids + counter returns" },
    { item: "Net cash from sales", amount: sheet.netCashMinor, note: sheet.netCashProblem ?? "" },
    { item: "Expected deposit − net cash", amount: sheet.differenceMinor, note: "should match the drawers' total over/short" },
    { item: `Refunds paid from the safe`, amount: sheet.refunds.fromSafeMinor, note: "not drawer cash" },
    { item: `Employee tab, no cash (${sheet.cash.employeeTabCount})`, amount: sheet.cash.employeeTabMinor, note: "" },
  ];
  if (sheet.cash.otherTenderCount > 0) {
    cashRows.push({ item: `Other tender, not cash (${sheet.cash.otherTenderCount})`, amount: sheet.cash.otherTenderMinor, note: "" });
  }
  const r = sheet.refunds.summary;
  const bag = sheet.bag;
  const grid = denomGridRows(bag?.nightDenoms ?? null, bag?.morningDenoms ?? null);
  return {
    filename: `end-of-day-${sheet.businessDay}`,
    title: `Greenway Marijuana · End-of-day deposit sheet · ${sheet.businessDay}`,
    sheets: [
      {
        name: "Deposit",
        caption: `Deposit by till, business day ${sheet.businessDay}`,
        columns: [
          { key: "till", header: "Till" },
          { key: "float", header: "Float (opening count)", type: "currency" },
          { key: "closing", header: "Closing count", type: "currency" },
          { key: "takings", header: "Takings", type: "currency" },
          { key: "drops", header: "Drops", type: "currency" },
          { key: "toBag", header: "To the bag", type: "currency" },
        ],
        rows: d.lines.map((l) => ({
          till: l.registerName,
          float: l.floatMinor,
          closing: l.closingMinor,
          takings: l.takingsMinor,
          drops: l.dropsMinor,
          toBag: l.toBagMinor,
        })),
        totals: {
          till: "TOTAL",
          takings: d.totalTakingsMinor,
          drops: d.totalDropsMinor,
          toBag: d.expectedMinor,
        },
      },
      {
        name: "Cash check",
        columns: [
          { key: "item", header: "Line" },
          { key: "amount", header: "Amount", type: "currency" },
          { key: "note", header: "Note" },
        ],
        rows: cashRows,
      },
      {
        name: "Refunds",
        columns: [
          { key: "kind", header: "Refunds (store-wide cash out)" },
          { key: "count", header: "Count", type: "integer" },
          { key: "amount", header: "Amount", type: "currency" },
        ],
        rows: [
          { kind: "Voided sales", count: r.voidCount, amount: r.voidRefundMinor },
          { kind: "Counter returns", count: r.returnCount, amount: r.returnRefundMinor },
          { kind: "Not tied to a drawer or the safe", count: sheet.refunds.unattributedCount, amount: sheet.refunds.unattributedMinor },
        ],
        totals: { kind: "Total cash refunded", count: r.voidCount + r.returnCount, amount: r.refundTotalMinor },
      },
      {
        name: "Bag",
        caption: bag
          ? `Bag ${bag.bagNo} · ${bag.stageLabel}${bag.nightShown ? "" : " · night count hidden until the morning recount"}`
          : (sheet.bagNote ?? "No bag"),
        columns: [
          { key: "denom", header: "Denomination" },
          { key: "nightQty", header: "Night qty", type: "integer" },
          { key: "night", header: "Night", type: "currency" },
          { key: "morningQty", header: "Morning qty", type: "integer" },
          { key: "morning", header: "Morning", type: "currency" },
        ],
        rows: grid.map((g) => ({ denom: g.label, nightQty: g.nightQty, night: g.nightMinor, morningQty: g.morningQty, morning: g.morningMinor })),
        totals: {
          denom: "COUNTED",
          night: bag?.nightCountMinor ?? null,
          morning: bag?.morningCountMinor ?? null,
        },
      },
      {
        name: "Sales",
        columns: [
          { key: "item", header: "Sales (all registers, server-verified)" },
          { key: "value", header: "Amount", type: "currency" },
          { key: "count", header: "Count", type: "integer" },
        ],
        rows: [
          { item: "Completed sales", count: sales.saleCount },
          { item: "Subtotal", value: sales.subtotalMinor },
          { item: "Tax collected", value: sales.taxMinor },
          { item: "Gross sales (not cash: see Cash check)", value: sales.grossMinor },
          { item: "Cash rounding", value: sales.roundingMinor, count: sales.roundedSaleCount },
          { item: "Audited no-sale drawer opens", count: sales.noSaleCount },
          { item: "Unresolved exceptions", count: sales.exceptionCount },
          { item: "Still processing", count: sales.pendingCount },
        ],
      },
      {
        name: "Signatures",
        columns: [
          { key: "role", header: "Role" },
          { key: "name", header: "Name (from the app)" },
          { key: "sign", header: "Signature" },
          { key: "time", header: "Date / time" },
        ],
        rows: [
          { role: "Night count (one person, before close)", name: bag?.nightCountedByName ?? "", sign: "", time: "" },
          { role: "Morning recount (a DIFFERENT employee)", name: bag?.morningCountedByName ?? "", sign: "", time: "" },
          { role: "Sealed by", name: bag?.sealedByName ?? "", sign: "", time: "" },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runEodSheetTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`eod-sheet-core FAIL: ${m}`);
    }
  };

  const sessions: ExpectedSessionInput[] = [
    { id: "s1", registerName: "Sales Register 1", status: "reconciled", openingMinor: 16750, closingMinor: 96750 },
    { id: "s2", registerName: "Sales Register 2", status: "closed", openingMinor: 16750, closingMinor: 56750 },
  ];
  const drops = [{ sessionId: "s1", amountMinor: 50000 }];
  const sale = (method: string, total: number, adj = 0, status = "processed") => ({
    eventType: "sale",
    status,
    payload: { paymentMethod: method, totalMinor: total, ...(adj ? { rounding: { adjustmentMinor: adj } } : {}) },
  });
  const events = [
    sale("cash", 100000, 2),
    sale("cash", 72000, -2),
    sale("employee_tab", 3000),
    sale("debit", 4000),
    sale("cash", 9999, 0, "pending"),
    sale("cash", 8888, 0, "exception"),
    { eventType: "no_sale", status: "processed", payload: {} },
  ];

  const cs = summarizeCashSales(events);
  ok(cs.cashSaleCount === 2 && cs.cashSalesMinor === 172000, "cash = processed cash sales with rounding");
  ok(cs.employeeTabCount === 1 && cs.employeeTabMinor === 3000, "employee tab split out");
  ok(cs.otherTenderCount === 1 && cs.otherTenderMinor === 4000, "other tender split out, never counted as cash");

  const base = {
    businessDay: "2026-11-02",
    sessions,
    drops,
    saleEvents: events,
    refunds: [
      { source: "void" as const, refundMinor: 2000, paidFrom: "drawer" as const },
      { source: "return" as const, refundMinor: 1500, paidFrom: "safe" as const },
    ],
    bag: null,
    bagMissingSchema: false,
    readProblems: [],
  };
  const s = buildEodSheet(base);
  ok(s.deposit.totalTakingsMinor === 120000, "takings = Σ(closing − float)");
  ok(s.deposit.expectedMinor === 170000, "expected deposit = takings + drops");
  ok(s.refunds.summary.refundTotalMinor === 3500 && s.refunds.summary.voidCount === 1, "Z report refund summary");
  ok(s.refunds.fromDrawersMinor === 2000 && s.refunds.fromSafeMinor === 1500, "refunds split by where paid");
  ok(s.netCashMinor === 170000, "net cash = cash sales − drawer refunds (safe refunds excluded)");
  ok(s.differenceMinor === 0, "difference 0 when the drawers balance");
  ok(s.bagNote === NO_BAG_YET, "no bag yet note");

  const un = buildEodSheet({ ...base, refunds: [{ source: "return", refundMinor: 700, paidFrom: null }] });
  ok(un.netCashMinor === null && (un.netCashProblem ?? "").includes("not tied to a drawer or the safe"), "unattributed refund makes net cash a question");
  ok(un.differenceMinor === null, "no difference without net cash");

  const rp = buildEodSheet({ ...base, readProblems: ["Sales could not all be read: x"] });
  ok(rp.netCashMinor === null && rp.readProblems.length === 1, "read problem hides net cash");

  const open = buildEodSheet({ ...base, sessions: [...sessions, { id: "s3", registerName: "Manager Till", status: "open", openingMinor: 30000, closingMinor: null }] });
  ok(open.deposit.expectedMinor === null && open.differenceMinor === null, "an open drawer makes the expected deposit a question");

  const missing = buildEodSheet({ ...base, bagMissingSchema: true });
  ok(missing.bagNote === BAG_SCHEMA_MISSING, "0316 missing note");
  const bagErr = buildEodSheet({ ...base, readProblems: ["Deposit bag could not be read: x"] });
  ok(bagErr.bagNote === "The day's deposit bag could not be read.", "bag read error is not 'no bag yet'");

  const denoms = denomsFromJson({ hundreds: 17, twenties: 0, fives: -3, ones: 1.5, bogus: 9 });
  ok(denoms !== null && denoms.hundreds === 17 && denoms.fives === 0 && denoms.ones === 0, "denoms from json are clean");
  ok(denomsFromJson(null) === null && denomsFromJson([1]) === null, "non-object denoms are null");

  const bagRow: SheetBagInput = {
    id: "b1",
    bagNo: "A100",
    businessDay: "2026-11-02",
    status: "undeclared",
    amountMinor: null,
    nightCountMinor: 170000,
    nightCountedBy: "e1",
    nightCountedAt: "2026-11-03T05:00:00Z",
    expectedMinor: 170000,
    nightNote: null,
    morningCountMinor: null,
    morningCountedBy: null,
    morningCountedAt: null,
    varianceReason: null,
    sealedAt: null,
    sealedBy: null,
    sealJournalId: null,
    bankedOn: null,
    bankedBy: null,
    bankNote: null,
    depositConfirmedOn: null,
    nightDenoms: { ...denoms! },
    morningDenoms: null,
    nightCountedByName: "Night Closer",
    morningCountedByName: null,
    sealedByName: null,
  };
  const blind = buildEodSheet({ ...base, bag: bagRow });
  ok(blind.bag !== null && !blind.bag.nightShown, "night figure hidden before recount");
  ok(blind.bag!.nightCountMinor === null && blind.bag!.nightDenoms === null, "night count and denominations withheld");
  ok(blind.bag!.againstExpectedMinor === null, "no comparison leaks the night count");
  const wbBlind = eodSheetWorkbook(blind, {
    saleCount: 0, grossMinor: 0, subtotalMinor: 0, taxMinor: 0, medicalSaleCount: 0, medicalSavingsMinor: 0,
    roundedSaleCount: 0, roundingMinor: 0, noSaleCount: 0, exceptionCount: 0, pendingCount: 0,
  });
  const bagSheet = wbBlind.sheets.find((x) => x.name === "Bag")!;
  ok(bagSheet.rows.every((x) => x.nightQty === null) && bagSheet.totals!.night === null, "export withholds the night count too");

  const after = buildEodSheet({ ...base, bag: { ...bagRow, morningCountMinor: 169900, morningCountedBy: "e2", morningDenoms: { ...denoms! }, morningCountedByName: "Morning Opener" } });
  ok(after.bag!.nightShown && after.bag!.nightCountMinor === 170000, "night shown after recount");
  ok(after.bag!.againstExpectedMinor === -100, "bag vs expected uses the morning count");

  const wb = eodSheetWorkbook(after, {
    saleCount: 3, grossMinor: 179000, subtotalMinor: 150000, taxMinor: 29000, medicalSaleCount: 0, medicalSavingsMinor: 0,
    roundedSaleCount: 2, roundingMinor: 0, noSaleCount: 1, exceptionCount: 1, pendingCount: 1,
  });
  ok(wb.filename === "end-of-day-2026-11-02", "export filename carries the day");
  ok(wb.sheets.map((x) => x.name).join(",") === "Deposit,Cash check,Refunds,Bag,Sales,Signatures", "export sheets in order");
  const sig = wb.sheets.find((x) => x.name === "Signatures")!;
  ok(sig.rows.length === 3 && sig.rows[1].name === "Morning Opener", "two counters plus sealer on the signature sheet");
  const grid = denomGridRows(denoms, null);
  ok(grid[0].label === "$100" && grid[0].nightMinor === 170000 && grid[0].morningQty === null, "denomination grid high to low");

  return { passed, failed };
}
