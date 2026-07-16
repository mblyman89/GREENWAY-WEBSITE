/**
 * src/lib/pos/day-report-core.ts  (POS Slice B22)
 *
 * PURE X/Z day-report math + Star slip builder. Zero I/O — unit-testable
 * with tsx.
 *
 *   X report — mid-day snapshot (a drawer session is still OPEN).
 *   Z report — end-of-day (every session for the business day is closed).
 *
 * The numbers aggregate the register's own append-only ledger
 * (`pos_sale_events`): processed SALE payloads carry the totals the server
 * recomputed and accepted at sync, so summing them is summing verified
 * facts. Drawer figures come from `drawer_sessions` + `drawer_drops`.
 *
 * BLIND-COUNT DISCIPLINE (why this report is manager-gated): gross cash
 * sales + opening float − drops = the expected drawer cash — exactly the
 * number the blind close hides from the cashier. The route therefore
 * requires a MANAGER/LEAD PIN, and over/short prints only after a manager
 * has reconciled the session in the back office (it is stored on the
 * session by then; nothing here computes it early).
 *
 * Money is MINOR UNITS (cents) throughout.
 */

import { escapeReceiptHtml } from "@/lib/pos/receipt-core";
import { formatReceiptTimestamp } from "@/lib/printing/receipt-core";
import { formatCents } from "@/lib/registers/cash";

// ---------------------------------------------------------------------------
// Ledger aggregation
// ---------------------------------------------------------------------------

/** The minimal ledger row shape the summarizer needs (from pos_sale_events). */
export type DayEventRow = {
  eventType: string;
  status: string; // pending | processed | exception
  payload: unknown;
};

export type DaySummary = {
  /** Processed sales only — the compliance gate accepted these. */
  saleCount: number;
  grossMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  /** Medical (recognition-card) sales within saleCount. */
  medicalSaleCount: number;
  medicalSavingsMinor: number;
  /**
   * B33 cash rounding — sales where the amount due was rounded, and the NET
   * adjustment (positive = the store collected more cash than the priced
   * totals; negative = less). Cash expected in the drawer =
   * grossMinor + roundingMinor. Tax was computed on the pre-rounded totals.
   */
  roundedSaleCount: number;
  roundingMinor: number;
  /** Audited no-sale drawer opens. */
  noSaleCount: number;
  /** Events the gate bounced to the manager exception queue. */
  exceptionCount: number;
  /** Ledger rows still pending (transient — mid-processing). */
  pendingCount: number;
};

function intOrZero(v: unknown): number {
  return Number.isInteger(v) ? (v as number) : 0;
}

/**
 * Aggregate one register's ledger rows for a business day. Defensive on
 * payload shape: a malformed payload contributes counts but zero money
 * rather than NaN-poisoning the whole report.
 */
export function summarizeDayEvents(rows: DayEventRow[]): DaySummary {
  const out: DaySummary = {
    saleCount: 0,
    grossMinor: 0,
    subtotalMinor: 0,
    taxMinor: 0,
    medicalSaleCount: 0,
    medicalSavingsMinor: 0,
    roundedSaleCount: 0,
    roundingMinor: 0,
    noSaleCount: 0,
    exceptionCount: 0,
    pendingCount: 0,
  };
  for (const row of rows) {
    if (row.status === "exception") {
      out.exceptionCount += 1;
      continue;
    }
    if (row.status === "pending") {
      out.pendingCount += 1;
      continue;
    }
    if (row.status !== "processed") continue;
    if (row.eventType === "no_sale") {
      out.noSaleCount += 1;
      continue;
    }
    if (row.eventType !== "sale") continue;
    const p = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
    out.saleCount += 1;
    out.grossMinor += intOrZero(p.totalMinor);
    out.subtotalMinor += intOrZero(p.subtotalMinor);
    out.taxMinor += intOrZero(p.taxMinor);
    const medical = p.medical && typeof p.medical === "object" ? (p.medical as Record<string, unknown>) : null;
    if (medical) {
      out.medicalSaleCount += 1;
      out.medicalSavingsMinor += intOrZero(medical.medicalSavingsMinor);
    }
    // B33 — sum the cash-rounding adjustments (separate row, Toast-style:
    // rounding is cash over/short territory, never part of gross or tax).
    const rounding = p.rounding && typeof p.rounding === "object" ? (p.rounding as Record<string, unknown>) : null;
    if (rounding) {
      out.roundedSaleCount += 1;
      out.roundingMinor += intOrZero(rounding.adjustmentMinor);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Refund aggregation (AN-4)
// ---------------------------------------------------------------------------
//
// Cash refunded OUT of a drawer comes from two flows, neither of which writes
// to pos_sale_events:
//   - same-day VOIDS   -> audit_logs action "register.sale_voided"
//                         (refundMinor lives in after_json)
//   - counter RETURNS  -> customer_returns.refund_minor_units
//
// Neither record carries register attribution (void audits only name the
// device in actor_email; customer_returns has no device/register column), so
// refunds are reported STORE-WIDE and the slip says so explicitly — we never
// guess a register. Without these rows, gross + float − drops overstates the
// expected drawer cash and blind counts show FALSE SHORTAGES.

/** One refund fact, pre-queried by the caller (core stays I/O-free). */
export type RefundRow = {
  source: "void" | "return";
  refundMinor: number;
};

export type RefundSummary = {
  voidCount: number;
  voidRefundMinor: number;
  returnCount: number;
  returnRefundMinor: number;
  /** Total cash paid out of drawers (voids + returns), cents. */
  refundTotalMinor: number;
};

/** Aggregate refund facts. Defensive: garbage/negative amounts count as $0. */
export function summarizeRefunds(rows: RefundRow[]): RefundSummary {
  const out: RefundSummary = {
    voidCount: 0,
    voidRefundMinor: 0,
    returnCount: 0,
    returnRefundMinor: 0,
    refundTotalMinor: 0,
  };
  for (const r of rows) {
    const minor = Math.max(0, intOrZero(r.refundMinor));
    if (r.source === "void") {
      out.voidCount += 1;
      out.voidRefundMinor += minor;
    } else if (r.source === "return") {
      out.returnCount += 1;
      out.returnRefundMinor += minor;
    } else {
      continue;
    }
    out.refundTotalMinor += minor;
  }
  return out;
}

/**
 * Pull refundMinor out of a `register.sale_voided` audit after_json blob.
 * Defensive on shape — a malformed blob contributes $0, never NaN.
 */
export function auditRefundMinor(afterJson: unknown): number {
  const a = afterJson && typeof afterJson === "object" ? (afterJson as Record<string, unknown>) : {};
  return Math.max(0, intOrZero(a.refundMinor));
}

// ---------------------------------------------------------------------------
// Drawer-day aggregation
// ---------------------------------------------------------------------------

/** The minimal session shape the summarizer needs (from drawer_sessions). */
export type DaySessionRow = {
  status: string; // open | closed | reconciled | verified
  openingCountMinor: number | null;
  overShortMinor: number | null;
};

export type DrawerDaySummary = {
  sessionCount: number;
  /** True while any session is still open — that makes this an X report. */
  anyOpen: boolean;
  /** Sum of counted-in floats across the day's sessions. */
  openingMinor: number;
  dropCount: number;
  dropsMinor: number;
  /**
   * Sum of manager-revealed over/short across reconciled/verified sessions;
   * null until at least one session has been reconciled (never computed
   * here — blind counts stay blind until the manager reveals them).
   */
  overShortMinor: number | null;
};

export function summarizeDrawerDay(
  sessions: DaySessionRow[],
  drops: { amountMinor: number }[],
): DrawerDaySummary {
  let anyOpen = false;
  let openingMinor = 0;
  let overShort: number | null = null;
  for (const s of sessions) {
    if (s.status === "open") anyOpen = true;
    openingMinor += Number.isInteger(s.openingCountMinor) ? (s.openingCountMinor as number) : 0;
    if ((s.status === "reconciled" || s.status === "verified") && Number.isInteger(s.overShortMinor)) {
      overShort = (overShort ?? 0) + (s.overShortMinor as number);
    }
  }
  const dropsMinor = drops.reduce((sum, d) => sum + (Number.isInteger(d.amountMinor) ? d.amountMinor : 0), 0);
  return {
    sessionCount: sessions.length,
    anyOpen,
    openingMinor,
    dropCount: drops.length,
    dropsMinor,
    overShortMinor: overShort,
  };
}

/** X while any session is open; Z once the day's sessions are all closed. */
export function reportKind(drawer: DrawerDaySummary | null): "X" | "Z" {
  return drawer && !drawer.anyOpen && drawer.sessionCount > 0 ? "Z" : "X";
}

// ---------------------------------------------------------------------------
// Star slip (576px — same page family as receipts / no-sale slips)
// ---------------------------------------------------------------------------

export type DayReportSlipInput = {
  kind: "X" | "Z";
  registerLabel: string;
  /** Pacific business day, YYYY-MM-DD. */
  businessDay: string;
  printedAtIso: string;
  requestedByName: string;
  summary: DaySummary;
  drawer: DrawerDaySummary | null;
  /**
   * AN-4: store-wide cash refunded out today (voids + counter returns).
   * Optional so cached registers running an older bundle keep printing;
   * null/absent prints no refund section.
   */
  refunds?: RefundSummary | null;
  headerText: string | null;
  addressLines: string[];
};

const DEFAULT_HEADER = "GREENWAY MARIJUANA";

function row(label: string, value: string): string {
  return `<tr><td class="l">${escapeReceiptHtml(label)}</td><td class="r">${escapeReceiptHtml(value)}</td></tr>`;
}

/**
 * Build the printable X/Z slip. Identical 576px page setup as the sale
 * receipt so the one PassPRNT print path handles everything. A report
 * never pops the drawer — print with openDrawer: false.
 */
export function buildDayReportSlipHtml(input: DayReportSlipInput): string {
  const header = escapeReceiptHtml((input.headerText ?? DEFAULT_HEADER).trim() || DEFAULT_HEADER);
  const s = input.summary;
  const d = input.drawer;
  const kindLabel = input.kind === "Z" ? "Z REPORT — END OF DAY" : "X REPORT — MID-DAY SNAPSHOT";

  const salesRows = [
    row("Sales completed", String(s.saleCount)),
    row("Gross (tax incl.)", formatCents(s.grossMinor)),
    row("Subtotal", formatCents(s.subtotalMinor)),
    row("Tax collected", formatCents(s.taxMinor)),
    row("Medical sales", String(s.medicalSaleCount)),
    row("Medical tax exempt", formatCents(s.medicalSavingsMinor)),
    // B33 — the rounding row prints whenever the policy touched a sale, so
    // the drawer math (gross + rounding) is visible on paper.
    ...(s.roundedSaleCount > 0
      ? [row(`Cash rounding (${s.roundedSaleCount} sales)`, formatCents(s.roundingMinor))]
      : []),
  ].join("");

  // AN-4 — cash refunded OUT (store-wide: voids + counter returns carry no
  // register attribution). Printed so the manager reconciling drawers knows
  // the day's expected cash is lower than gross + float − drops.
  const r = input.refunds ?? null;
  const refundRows = r
    ? [
        row(`Voided sales (${r.voidCount})`, formatCents(-r.voidRefundMinor)),
        row(`Counter returns (${r.returnCount})`, formatCents(-r.returnRefundMinor)),
        row("Total cash refunded", formatCents(-r.refundTotalMinor)),
      ].join("")
    : "";
  const refundSection =
    r && (r.voidCount > 0 || r.returnCount > 0)
      ? [
          "<hr>",
          '<p class="sec">REFUNDS &mdash; STORE-WIDE CASH OUT</p>',
          `<table>${refundRows}</table>`,
          '<p class="sub">Voids/returns are not tied to one register &mdash; count them against the drawer that paid.</p>',
        ].join("")
      : "";

  const activityRows = [
    row("No-sale drawer opens", String(s.noSaleCount)),
    row("Exceptions (manager queue)", String(s.exceptionCount)),
    ...(s.pendingCount > 0 ? [row("Still processing", String(s.pendingCount))] : []),
  ].join("");

  const drawerRows = d
    ? [
        row("Drawer sessions", String(d.sessionCount)),
        row("Opening float", formatCents(d.openingMinor)),
        row(`Safe drops (${d.dropCount})`, formatCents(d.dropsMinor)),
        d.overShortMinor !== null
          ? row("Over / short (reconciled)", formatCents(d.overShortMinor))
          : row("Over / short", "pending manager reconcile"),
      ].join("")
    : row("Drawer", "no session this day");

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    ".addr{font-size:22px;text-align:center;margin:0 0 2px;}",
    ".banner{font-size:26px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    ".sec{font-size:22px;font-weight:bold;margin:10px 0 2px;}",
    "table{width:100%;border-collapse:collapse;font-size:24px;}",
    "td{padding:2px 0;}",
    "td.l{text-align:left;}",
    "td.r{text-align:right;font-weight:bold;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${header}</h1>`,
    ...input.addressLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${escapeReceiptHtml(l)}</p>`),
    `<p class="banner">${kindLabel}</p>`,
    `<p class="sub">${escapeReceiptHtml(input.registerLabel)} &middot; ${escapeReceiptHtml(input.businessDay)}</p>`,
    `<p class="sub">Printed ${escapeReceiptHtml(formatReceiptTimestamp(input.printedAtIso))} by ${escapeReceiptHtml(input.requestedByName)}</p>`,
    "<hr>",
    '<p class="sec">SALES</p>',
    `<table>${salesRows}</table>`,
    refundSection,
    "<hr>",
    '<p class="sec">REGISTER ACTIVITY</p>',
    `<table>${activityRows}</table>`,
    "<hr>",
    '<p class="sec">CASH DRAWER</p>',
    `<table>${drawerRows}</table>`,
    "<hr>",
    '<p class="sub">Cash counts stay blind until a manager reconciles in the back office.</p>',
    "</body></html>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDayReportCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  // summarizeDayEvents
  const events: DayEventRow[] = [
    { eventType: "sale", status: "processed", payload: { totalMinor: 5000, subtotalMinor: 4000, taxMinor: 1000 } },
    {
      eventType: "sale",
      status: "processed",
      payload: { totalMinor: 3000, subtotalMinor: 3000, taxMinor: 0, medical: { medicalSavingsMinor: 555 } },
    },
    { eventType: "sale", status: "exception", payload: { totalMinor: 9999 } },
    { eventType: "sale", status: "pending", payload: { totalMinor: 1111 } },
    { eventType: "no_sale", status: "processed", payload: { reason: "change" } },
    { eventType: "punch", status: "processed", payload: { intent: "in" } },
    { eventType: "sale", status: "processed", payload: "garbage" },
  ];
  const s = summarizeDayEvents(events);
  ok(s.saleCount === 3, "sales: 3 processed counted (incl. malformed payload)");
  ok(s.grossMinor === 8000, "gross sums only processed sales — exceptions and pending excluded");
  ok(s.subtotalMinor === 7000 && s.taxMinor === 1000, "subtotal + tax summed");
  ok(s.medicalSaleCount === 1 && s.medicalSavingsMinor === 555, "medical sale + exempt savings counted");
  ok(s.roundedSaleCount === 0 && s.roundingMinor === 0, "no rounding blocks → zero rounding row");
  ok(s.noSaleCount === 1, "no-sale counted");

  // B33 — rounding adjustments sum into their own row (net of + and −).
  const roundedDay = summarizeDayEvents([
    {
      eventType: "sale",
      status: "processed",
      payload: { totalMinor: 2926, rounding: { mode: "nearest", adjustmentMinor: -1, dueMinor: 2925 } },
    },
    {
      eventType: "sale",
      status: "processed",
      payload: { totalMinor: 2923, rounding: { mode: "nearest", adjustmentMinor: 2, dueMinor: 2925 } },
    },
    { eventType: "sale", status: "processed", payload: { totalMinor: 3000 } },
  ]);
  ok(roundedDay.roundedSaleCount === 2, "B33: two rounded sales counted");
  ok(roundedDay.roundingMinor === 1, "B33: net rounding = −1 + 2 = +1¢");
  ok(roundedDay.grossMinor === 2926 + 2923 + 3000, "B33: gross stays PRE-rounded");
  ok(s.exceptionCount === 1 && s.pendingCount === 1, "exceptions and pending surfaced, never silently dropped");
  ok(summarizeDayEvents([]).grossMinor === 0, "empty day is all zeros");

  // AN-4 — summarizeRefunds
  const r1 = summarizeRefunds([
    { source: "void", refundMinor: 2500 },
    { source: "void", refundMinor: 1000 },
    { source: "return", refundMinor: 750 },
    { source: "return", refundMinor: -50 }, // garbage negative -> $0, still counted
    { source: "return", refundMinor: 12.5 as unknown as number }, // non-integer -> $0
  ]);
  ok(r1.voidCount === 2 && r1.voidRefundMinor === 3500, "AN-4: voids counted and summed");
  ok(r1.returnCount === 3 && r1.returnRefundMinor === 750, "AN-4: returns counted; garbage amounts contribute $0");
  ok(r1.refundTotalMinor === 4250, "AN-4: total = voids + returns");
  const r0 = summarizeRefunds([]);
  ok(r0.refundTotalMinor === 0 && r0.voidCount === 0 && r0.returnCount === 0, "AN-4: empty refunds all zeros");

  // AN-4 — auditRefundMinor (defensive on after_json shape)
  ok(auditRefundMinor({ refundMinor: 4321 }) === 4321, "AN-4: refundMinor extracted from audit blob");
  ok(auditRefundMinor({ refundMinor: "42" }) === 0, "AN-4: string refundMinor -> $0 (never NaN)");
  ok(auditRefundMinor(null) === 0 && auditRefundMinor("garbage") === 0, "AN-4: malformed audit blob -> $0");
  ok(auditRefundMinor({ refundMinor: -100 }) === 0, "AN-4: negative refund clamps to $0");

  // summarizeDrawerDay
  const d1 = summarizeDrawerDay(
    [
      { status: "closed", openingCountMinor: 20000, overShortMinor: null },
      { status: "open", openingCountMinor: 15000, overShortMinor: null },
    ],
    [{ amountMinor: 50000 }, { amountMinor: 30000 }],
  );
  ok(d1.anyOpen && d1.sessionCount === 2 && d1.openingMinor === 35000, "drawer day: open session detected, floats summed");
  ok(d1.dropCount === 2 && d1.dropsMinor === 80000, "drops summed");
  ok(d1.overShortMinor === null, "over/short stays null until a manager reconciles — blind counts stay blind");

  const d2 = summarizeDrawerDay(
    [
      { status: "reconciled", openingCountMinor: 20000, overShortMinor: -125 },
      { status: "verified", openingCountMinor: 10000, overShortMinor: 25 },
    ],
    [],
  );
  ok(d2.overShortMinor === -100, "over/short sums manager-revealed values across reconciled+verified sessions");
  ok(!d2.anyOpen, "all-closed day has no open session");

  // reportKind
  ok(reportKind(d1) === "X", "any open session → X report");
  ok(reportKind(d2) === "Z", "all sessions closed → Z report");
  ok(reportKind(null) === "X", "no drawer data → X (snapshot)");
  ok(reportKind(summarizeDrawerDay([], [])) === "X", "zero sessions → X (nothing to finalize)");

  // slip
  const slip = buildDayReportSlipHtml({
    kind: "Z",
    registerLabel: "Register 1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-17T04:55:00.000Z",
    requestedByName: "Mark <Lead>",
    summary: s,
    drawer: d2,
    headerText: null,
    addressLines: ["Port Orchard, WA"],
  });
  ok(slip.includes("Z REPORT &mdash; END OF DAY") || slip.includes("Z REPORT — END OF DAY"), "Z banner printed");
  ok(slip.includes("GREENWAY MARIJUANA"), "default header on null");
  ok(slip.includes("Register 1") && slip.includes("2026-07-16"), "register + business day printed");
  ok(slip.includes("Mark &lt;Lead&gt;"), "requester name escaped");
  ok(slip.includes("$80.00"), "gross printed as dollars");
  ok(slip.includes("$5.55"), "medical exempt printed");
  ok(slip.includes("-$1.00"), "net short printed with sign");
  ok(slip.includes("body{width:576px"), "same 576px page family as receipts");
  ok(slip.includes("Port Orchard, WA"), "address carried");
  ok(!slip.includes("Cash rounding"), "B33: no rounding row when no sale was rounded");
  ok(!slip.includes("REFUNDS"), "AN-4: no refund section when refunds absent (older cached bundles keep printing)");

  // AN-4 — refund section prints when the day had cash out.
  const slipRefunds = buildDayReportSlipHtml({
    kind: "Z",
    registerLabel: "Register 1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-17T04:55:00.000Z",
    requestedByName: "Mark",
    summary: s,
    drawer: d2,
    refunds: r1,
    headerText: null,
    addressLines: [],
  });
  ok(slipRefunds.includes("REFUNDS &mdash; STORE-WIDE CASH OUT"), "AN-4: refund banner printed");
  ok(slipRefunds.includes("Voided sales (2)") && slipRefunds.includes("-$35.00"), "AN-4: void row negative");
  ok(slipRefunds.includes("Counter returns (3)") && slipRefunds.includes("-$7.50"), "AN-4: return row negative");
  ok(slipRefunds.includes("Total cash refunded") && slipRefunds.includes("-$42.50"), "AN-4: total row");
  ok(slipRefunds.includes("not tied to one register"), "AN-4: store-wide caveat printed");

  // AN-4 — zero-refund day omits the section (nothing to reconcile against).
  const slipZeroRefunds = buildDayReportSlipHtml({
    kind: "Z",
    registerLabel: "Register 1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-17T04:55:00.000Z",
    requestedByName: "Mark",
    summary: s,
    drawer: d2,
    refunds: r0,
    headerText: null,
    addressLines: [],
  });
  ok(!slipZeroRefunds.includes("REFUNDS"), "AN-4: zero-refund day omits section");

  // B33 — the rounding row prints when the policy touched sales.
  const slipRounded = buildDayReportSlipHtml({
    kind: "Z",
    registerLabel: "Register 1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-17T04:55:00.000Z",
    requestedByName: "Mark",
    summary: roundedDay,
    drawer: d2,
    headerText: null,
    addressLines: [],
  });
  ok(slipRounded.includes("Cash rounding (2 sales)"), "B33: rounding row with sale count");
  ok(slipRounded.includes("$0.01"), "B33: net rounding amount printed");

  const slipX = buildDayReportSlipHtml({
    kind: "X",
    registerLabel: "R1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-16T20:00:00.000Z",
    requestedByName: "A",
    summary: summarizeDayEvents([]),
    drawer: d1,
    headerText: "GW",
    addressLines: [],
  });
  ok(slipX.includes("X REPORT"), "X banner printed");
  ok(slipX.includes("pending manager reconcile"), "unreconciled over/short says pending — never computed on-slip");

  const slipNoDrawer = buildDayReportSlipHtml({
    kind: "X",
    registerLabel: "R1",
    businessDay: "2026-07-16",
    printedAtIso: "2026-07-16T20:00:00.000Z",
    requestedByName: "A",
    summary: summarizeDayEvents([]),
    drawer: null,
    headerText: null,
    addressLines: [],
  });
  ok(slipNoDrawer.includes("no session this day"), "drawerless day prints explicitly");

  console.log("day-report-core self-tests passed");
}
