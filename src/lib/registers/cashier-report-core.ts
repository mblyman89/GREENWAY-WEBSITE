/**
 * src/lib/registers/cashier-report-core.ts  (Fix Phase 2.1b · G-05 · F-01-10)
 *
 * PURE. No I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 *
 * THE PER-CASHIER SHIFT SUMMARY.
 *
 * G-05, still open after Phase 2.1 (docs/sop-program/05-GAP-REGISTER.md):
 *   "a printable per-cashier shift summary (sales, voids, no-sales, discounts,
 *   adjustments by employee); the X/Z day report stays per register."
 * Owner message 6: "please completely finish G-05 (2.1), the per cashier
 * print out."
 *
 * WHERE EACH NUMBER COMES FROM (verified columns, never guessed)
 * --------------------------------------------------------------
 *   sales, discounts, payment split, rounding, medical, exceptions, pending
 *       pos_sale_events (0120): employee_id is NOT NULL on every event, so a
 *       sale and a no-sale always say who rang them. Money only from
 *       PROCESSED sales (the compliance gate accepted them), exactly like the
 *       X/Z report (day-report-core.ts summarizeDayEvents).
 *   no-sales
 *       pos_sale_events event_type 'no_sale' (processed), with the reason and
 *       the approving manager from the payload (validateNoSalePayload).
 *   cart adjustments (lines taken off before payment)
 *       pos_cart_adjustments (0301): employee_id, action, units_removed,
 *       value_minor.
 *   voids and returns
 *       Neither record names the cashier: a void audit names the approving
 *       manager and the device, a customer_returns row names the back-office
 *       user. They are attributed to the cashier who RANG THE ORIGINAL SALE,
 *       through the sale's order id (pos_sale_events.order_id). A refund whose
 *       sale cannot be traced to a register event is listed under
 *       "not traced to a cashier", never given to somebody.
 *
 * A SHIFT here is one cashier on one Pacific business day. The day comes from
 * the event's occurred_at in Pacific time (same clock as every report).
 *
 * Money is integer cents throughout.
 */

import { formatCents } from "@/lib/registers/cash";

/* ─── inputs ─────────────────────────────────────────────────────────── */

export type CashierEventRow = {
  employeeId: string;
  registerId: string | null;
  eventType: string;
  status: string; // pending | processed | exception
  businessDay: string; // Pacific YYYY-MM-DD of occurred_at
  orderId: string | null;
  payload: unknown;
};

export type CashierAdjustmentRow = {
  employeeId: string | null;
  businessDay: string;
  action: string; // qty_decrease | line_remove | cart_cancel
  unitsRemoved: number;
  valueMinor: number;
};

export type CashierRefundRow = {
  source: "void" | "return";
  /** The ORIGINAL sale's order id. */
  orderId: string | null;
  businessDay: string;
  refundMinor: number;
  label: string;
};

/* ─── outputs ────────────────────────────────────────────────────────── */

export type DiscountTotals = {
  /** Σ (regular − charged) × qty over every processed sale line. */
  totalMinor: number;
  /** Manager price overrides (originalUnitPriceMinor − charged) × qty. */
  overrideCount: number;
  overrideMinor: number;
  /** Loyalty reward codes (loyaltyDiscountMinor × qty). */
  loyaltyMinor: number;
  /** Special programs (specialDiscountMinor × qty), by program kind. */
  specialMinor: number;
  specialByKind: Record<string, { count: number; minor: number }>;
  /** Medical tax exemption (medical.medicalSavingsMinor). */
  medicalMinor: number;
  /** What is left: deals and sale prices (total − the parts above, ≥ 0). */
  dealMinor: number;
};

export type ShiftSummary = {
  employeeId: string;
  businessDay: string;
  registerIds: string[];
  saleCount: number;
  grossMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  unitCount: number;
  cashSaleCount: number;
  cashGrossMinor: number;
  employeeTabCount: number;
  employeeTabMinor: number;
  otherTenderCount: number;
  otherTenderMinor: number;
  roundingMinor: number;
  medicalSaleCount: number;
  discounts: DiscountTotals;
  noSaleCount: number;
  noSales: { reason: string; approvedByEmployeeId: string | null }[];
  exceptionCount: number;
  pendingCount: number;
  adjustments: {
    count: number;
    qtyDecrease: number;
    lineRemove: number;
    cartCancel: number;
    unitsRemoved: number;
    valueMinor: number;
  };
  voidCount: number;
  voidMinor: number;
  returnCount: number;
  returnMinor: number;
};

export type CashierSummary = ShiftSummary & { shifts: ShiftSummary[] };

export type CashierReport = {
  cashiers: CashierSummary[];
  /** Refunds whose original sale is not a register event in range. */
  untracedRefunds: CashierRefundRow[];
  /** Cart adjustments that carry no employee (employee row deleted). */
  unattributedAdjustments: number;
  store: ShiftSummary;
};

/* ─── helpers ────────────────────────────────────────────────────────── */

function int(v: unknown): number {
  return Number.isSafeInteger(v) ? (v as number) : 0;
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function emptyDiscounts(): DiscountTotals {
  return {
    totalMinor: 0,
    overrideCount: 0,
    overrideMinor: 0,
    loyaltyMinor: 0,
    specialMinor: 0,
    specialByKind: {},
    medicalMinor: 0,
    dealMinor: 0,
  };
}

export function emptyShift(employeeId: string, businessDay: string): ShiftSummary {
  return {
    employeeId,
    businessDay,
    registerIds: [],
    saleCount: 0,
    grossMinor: 0,
    subtotalMinor: 0,
    taxMinor: 0,
    unitCount: 0,
    cashSaleCount: 0,
    cashGrossMinor: 0,
    employeeTabCount: 0,
    employeeTabMinor: 0,
    otherTenderCount: 0,
    otherTenderMinor: 0,
    roundingMinor: 0,
    medicalSaleCount: 0,
    discounts: emptyDiscounts(),
    noSaleCount: 0,
    noSales: [],
    exceptionCount: 0,
    pendingCount: 0,
    adjustments: { count: 0, qtyDecrease: 0, lineRemove: 0, cartCancel: 0, unitsRemoved: 0, valueMinor: 0 },
    voidCount: 0,
    voidMinor: 0,
    returnCount: 0,
    returnMinor: 0,
  };
}

/**
 * The discount on one processed sale, split into its parts. Each part is
 * read from the payload field the register wrote (sale-event-core.ts
 * PosSaleLine / PosSalePayload), in the register's own order
 * (SaleFlow.tsx discountTransparencyFields): deal (engine price) ->
 * manager override -> medical tax pass-through -> loyalty OR special.
 *
 *   total    = sum (regularPriceMinor - unitPriceMinor) x qty. The charged
 *              price already has EVERY cut taken off, the medical one too
 *              (SaleFlow adds medical/qty back to rebuild the override
 *              price), so medical is inside this total, never added on top.
 *   override = sum (originalUnitPriceMinor - overridePrice) x qty, where the
 *              override price is charged + loyalty + special per unit (the
 *              line's price before the later stages took theirs).
 *   deal     = what is left. When a medical sale's per-line share cannot be
 *              split (the payload stores one medical total), the override
 *              part gives way so the parts ALWAYS add up exactly to the
 *              real saving and none is negative.
 */
export function saleDiscounts(payload: unknown): DiscountTotals {
  const p = rec(payload);
  const out = emptyDiscounts();
  const lines = Array.isArray(p.lines) ? p.lines : [];
  for (const raw of lines) {
    const l = rec(raw);
    const qty = Math.max(0, int(l.quantity));
    const charged = Math.max(0, int(l.unitPriceMinor));
    const regular = Math.max(charged, int(l.regularPriceMinor));
    out.totalMinor += (regular - charged) * qty;
    const loyaltyUnit = Math.max(0, int(l.loyaltyDiscountMinor));
    const specialUnit = Math.max(0, int(l.specialDiscountMinor));
    if (l.override && typeof l.override === "object") {
      const ov = rec(l.override);
      out.overrideCount += 1;
      out.overrideMinor += Math.max(0, int(ov.originalUnitPriceMinor) - (charged + loyaltyUnit + specialUnit)) * qty;
    }
    out.loyaltyMinor += loyaltyUnit * qty;
    out.specialMinor += specialUnit * qty;
  }
  const special = rec(p.specialDiscount);
  if (p.specialDiscount && typeof p.specialDiscount === "object") {
    const kind = typeof special.kind === "string" ? special.kind : "special";
    out.specialByKind[kind] = { count: 1, minor: out.specialMinor };
  }
  const medical = rec(p.medical);
  if (p.medical && typeof p.medical === "object") out.medicalMinor = Math.max(0, int(medical.medicalSavingsMinor));
  // Keep the parts inside the real saving: shrink in reverse application
  // order of certainty (override first, then the medical figure).
  let rest = out.totalMinor - out.loyaltyMinor - out.specialMinor;
  if (rest < 0) rest = 0;
  if (out.medicalMinor > rest) out.medicalMinor = rest;
  rest -= out.medicalMinor;
  if (out.overrideMinor > rest) out.overrideMinor = rest;
  rest -= out.overrideMinor;
  out.dealMinor = rest;
  return out;
}

function addDiscounts(into: DiscountTotals, d: DiscountTotals): void {
  into.totalMinor += d.totalMinor;
  into.overrideCount += d.overrideCount;
  into.overrideMinor += d.overrideMinor;
  into.loyaltyMinor += d.loyaltyMinor;
  into.specialMinor += d.specialMinor;
  into.medicalMinor += d.medicalMinor;
  into.dealMinor += d.dealMinor;
  for (const [k, v] of Object.entries(d.specialByKind)) {
    const cur = into.specialByKind[k] ?? { count: 0, minor: 0 };
    into.specialByKind[k] = { count: cur.count + v.count, minor: cur.minor + v.minor };
  }
}

function addShift(into: ShiftSummary, s: ShiftSummary): void {
  for (const r of s.registerIds) if (!into.registerIds.includes(r)) into.registerIds.push(r);
  into.saleCount += s.saleCount;
  into.grossMinor += s.grossMinor;
  into.subtotalMinor += s.subtotalMinor;
  into.taxMinor += s.taxMinor;
  into.unitCount += s.unitCount;
  into.cashSaleCount += s.cashSaleCount;
  into.cashGrossMinor += s.cashGrossMinor;
  into.employeeTabCount += s.employeeTabCount;
  into.employeeTabMinor += s.employeeTabMinor;
  into.otherTenderCount += s.otherTenderCount;
  into.otherTenderMinor += s.otherTenderMinor;
  into.roundingMinor += s.roundingMinor;
  into.medicalSaleCount += s.medicalSaleCount;
  addDiscounts(into.discounts, s.discounts);
  into.noSaleCount += s.noSaleCount;
  into.noSales.push(...s.noSales);
  into.exceptionCount += s.exceptionCount;
  into.pendingCount += s.pendingCount;
  into.adjustments.count += s.adjustments.count;
  into.adjustments.qtyDecrease += s.adjustments.qtyDecrease;
  into.adjustments.lineRemove += s.adjustments.lineRemove;
  into.adjustments.cartCancel += s.adjustments.cartCancel;
  into.adjustments.unitsRemoved += s.adjustments.unitsRemoved;
  into.adjustments.valueMinor += s.adjustments.valueMinor;
  into.voidCount += s.voidCount;
  into.voidMinor += s.voidMinor;
  into.returnCount += s.returnCount;
  into.returnMinor += s.returnMinor;
}

/* ─── the report ─────────────────────────────────────────────────────── */

export function buildCashierReport(input: {
  events: readonly CashierEventRow[];
  adjustments: readonly CashierAdjustmentRow[];
  refunds: readonly CashierRefundRow[];
  /** order id → employee who rang it, for sales OUTSIDE the event range. */
  extraSaleCashiers?: ReadonlyMap<string, string>;
}): CashierReport {
  const shifts = new Map<string, ShiftSummary>();
  const shiftFor = (employeeId: string, day: string) => {
    const k = `${employeeId}|${day}`;
    let s = shifts.get(k);
    if (!s) {
      s = emptyShift(employeeId, day);
      shifts.set(k, s);
    }
    return s;
  };
  const saleCashier = new Map<string, string>();

  for (const e of input.events) {
    if (!e.employeeId) continue;
    const s = shiftFor(e.employeeId, e.businessDay);
    if (e.registerId && !s.registerIds.includes(e.registerId)) s.registerIds.push(e.registerId);
    if (e.eventType === "sale" && e.orderId) saleCashier.set(e.orderId, e.employeeId);
    if (e.status === "exception") {
      s.exceptionCount += 1;
      continue;
    }
    if (e.status === "pending") {
      s.pendingCount += 1;
      continue;
    }
    if (e.status !== "processed") continue;
    const p = rec(e.payload);
    if (e.eventType === "no_sale") {
      s.noSaleCount += 1;
      s.noSales.push({
        reason: typeof p.reason === "string" ? p.reason : "",
        approvedByEmployeeId: typeof p.approvedByEmployeeId === "string" ? p.approvedByEmployeeId : null,
      });
      continue;
    }
    if (e.eventType !== "sale") continue;
    const total = int(p.totalMinor);
    s.saleCount += 1;
    s.grossMinor += total;
    s.subtotalMinor += int(p.subtotalMinor);
    s.taxMinor += int(p.taxMinor);
    for (const raw of Array.isArray(p.lines) ? p.lines : []) s.unitCount += Math.max(0, int(rec(raw).quantity));
    const rounding = rec(p.rounding);
    const roundMinor = p.rounding && typeof p.rounding === "object" ? int(rounding.adjustmentMinor) : 0;
    s.roundingMinor += roundMinor;
    if (p.paymentMethod === "cash") {
      s.cashSaleCount += 1;
      s.cashGrossMinor += total;
    } else if (p.paymentMethod === "employee_tab") {
      s.employeeTabCount += 1;
      s.employeeTabMinor += total;
    } else {
      s.otherTenderCount += 1;
      s.otherTenderMinor += total;
    }
    if (p.medical && typeof p.medical === "object") s.medicalSaleCount += 1;
    addDiscounts(s.discounts, saleDiscounts(p));
  }

  let unattributedAdjustments = 0;
  for (const a of input.adjustments) {
    if (!a.employeeId) {
      unattributedAdjustments += 1;
      continue;
    }
    const s = shiftFor(a.employeeId, a.businessDay);
    s.adjustments.count += 1;
    if (a.action === "qty_decrease") s.adjustments.qtyDecrease += 1;
    else if (a.action === "line_remove") s.adjustments.lineRemove += 1;
    else if (a.action === "cart_cancel") s.adjustments.cartCancel += 1;
    s.adjustments.unitsRemoved += Math.max(0, int(a.unitsRemoved));
    s.adjustments.valueMinor += Math.max(0, int(a.valueMinor));
  }

  const untracedRefunds: CashierRefundRow[] = [];
  for (const r of input.refunds) {
    const who = r.orderId ? (saleCashier.get(r.orderId) ?? input.extraSaleCashiers?.get(r.orderId) ?? null) : null;
    if (!who) {
      untracedRefunds.push(r);
      continue;
    }
    // Filed on the day the refund happened, against the cashier who rang it.
    const s = shiftFor(who, r.businessDay);
    const minor = Math.max(0, int(r.refundMinor));
    if (r.source === "void") {
      s.voidCount += 1;
      s.voidMinor += minor;
    } else {
      s.returnCount += 1;
      s.returnMinor += minor;
    }
  }

  const byEmployee = new Map<string, CashierSummary>();
  const store = emptyShift("*", "*");
  const ordered = [...shifts.values()].sort((a, b) =>
    a.employeeId === b.employeeId ? a.businessDay.localeCompare(b.businessDay) : a.employeeId.localeCompare(b.employeeId),
  );
  for (const s of ordered) {
    let c = byEmployee.get(s.employeeId);
    if (!c) {
      c = { ...emptyShift(s.employeeId, "*"), shifts: [] };
      byEmployee.set(s.employeeId, c);
    }
    c.shifts.push(s);
    addShift(c, s);
    addShift(store, s);
  }
  return { cashiers: [...byEmployee.values()], untracedRefunds, unattributedAdjustments, store };
}

/* ─── range + printing helpers ───────────────────────────────────────── */

/** Longest range one report reads (bounded reads, a printable report). */
export const CASHIER_REPORT_MAX_DAYS = 31;

export function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

export function checkCashierRange(from: string, to: string): { ok: true } | { ok: false; error: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to)) return { ok: false, error: "Pick both days as YYYY-MM-DD." };
  if (from > to) return { ok: false, error: "The From day is after the To day." };
  const n = daysBetweenInclusive(from, to);
  if (!Number.isFinite(n)) return { ok: false, error: "Those are not real dates." };
  if (n > CASHIER_REPORT_MAX_DAYS) {
    return { ok: false, error: `Pick ${CASHIER_REPORT_MAX_DAYS} days or fewer (you picked ${n}). Run a second report for the rest.` };
  }
  return { ok: true };
}

/** Net sales after refunds of this cashier's sales (never hides the parts). */
export function netAfterRefunds(s: ShiftSummary): number {
  return s.grossMinor - s.voidMinor - s.returnMinor;
}

/** Average sale, whole cents (0 when no sales). */
export function averageSale(s: ShiftSummary): number {
  return s.saleCount > 0 ? Math.round(s.grossMinor / s.saleCount) : 0;
}

/** Discount as a share of the regular price, one decimal ("12.5%"). */
export function discountRate(s: ShiftSummary): string {
  const regular = s.grossMinor + s.discounts.totalMinor;
  if (regular <= 0) return "0.0%";
  return `${((s.discounts.totalMinor / regular) * 100).toFixed(1)}%`;
}

export const CASHIER_CSV_HEADERS = [
  "Employee",
  "Business day",
  "Registers",
  "Sales",
  "Units",
  "Gross",
  "Pre-tax",
  "Tax",
  "Cash sales",
  "Cash gross",
  "Employee tab",
  "Other tender",
  "Cash rounding",
  "Discounts total",
  "Deals",
  "Manager overrides",
  "Loyalty",
  "Special programs",
  "Medical tax exempt",
  "No-sales",
  "Cart adjustments",
  "Adjusted value",
  "Voids",
  "Voided",
  "Returns",
  "Returned",
  "Net after refunds",
  "Exceptions",
  "Pending",
] as const;

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const money = (m: number) => (m / 100).toFixed(2);

export function cashierCsvRow(s: ShiftSummary, name: string, registerNames: string): string[] {
  return [
    name,
    s.businessDay,
    registerNames,
    String(s.saleCount),
    String(s.unitCount),
    money(s.grossMinor),
    money(s.subtotalMinor),
    money(s.taxMinor),
    String(s.cashSaleCount),
    money(s.cashGrossMinor),
    money(s.employeeTabMinor),
    money(s.otherTenderMinor),
    money(s.roundingMinor),
    money(s.discounts.totalMinor),
    money(s.discounts.dealMinor),
    money(s.discounts.overrideMinor),
    money(s.discounts.loyaltyMinor),
    money(s.discounts.specialMinor),
    money(s.discounts.medicalMinor),
    String(s.noSaleCount),
    String(s.adjustments.count),
    money(s.adjustments.valueMinor),
    String(s.voidCount),
    money(s.voidMinor),
    String(s.returnCount),
    money(s.returnMinor),
    money(netAfterRefunds(s)),
    String(s.exceptionCount),
    String(s.pendingCount),
  ];
}

export function cashierCsv(rows: readonly string[][]): string {
  return [CASHIER_CSV_HEADERS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** One line a printed report can carry about what it does not cover. */
export function untracedNote(r: CashierReport): string | null {
  const n = r.untracedRefunds.length;
  if (n === 0 && r.unattributedAdjustments === 0) return null;
  const parts: string[] = [];
  if (n > 0) {
    const total = r.untracedRefunds.reduce((s, x) => s + Math.max(0, int(x.refundMinor)), 0);
    parts.push(
      `${n} refund${n === 1 ? "" : "s"} (${formatCents(total)}) could not be traced to the cashier who rang the sale (an online order, or a sale older than this report), so they are listed separately and given to nobody.`,
    );
  }
  if (r.unattributedAdjustments > 0) {
    parts.push(`${r.unattributedAdjustments} cart adjustment(s) carry no employee (the employee record was deleted).`);
  }
  return parts.join(" ");
}

/* ─── self-tests ─────────────────────────────────────────────────────── */

export function __runCashierReportCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`cashier-report-core FAIL: ${m}`);
    }
  };
  const sale = (emp: string, day: string, order: string, payload: Record<string, unknown>, status = "processed"): CashierEventRow => ({
    employeeId: emp,
    registerId: "R1",
    eventType: "sale",
    status,
    businessDay: day,
    orderId: order,
    payload,
  });
  const lines = [{ quantity: 2, unitPriceMinor: 900, regularPriceMinor: 1000 }];
  const r = buildCashierReport({
    events: [
      sale("A", "2026-11-02", "o1", { totalMinor: 1800, subtotalMinor: 1400, taxMinor: 400, paymentMethod: "cash", lines }),
      sale("A", "2026-11-02", "o2", { totalMinor: 500, paymentMethod: "employee_tab", lines: [{ quantity: 1, unitPriceMinor: 500, regularPriceMinor: 500 }] }),
      sale("B", "2026-11-02", "o3", { totalMinor: 700, paymentMethod: "cash", lines: [] }, "exception"),
      { employeeId: "A", registerId: "R1", eventType: "no_sale", status: "processed", businessDay: "2026-11-02", orderId: null, payload: { reason: "change", approvedByEmployeeId: "M" } },
    ],
    adjustments: [
      { employeeId: "A", businessDay: "2026-11-02", action: "line_remove", unitsRemoved: 1, valueMinor: 250 },
      { employeeId: null, businessDay: "2026-11-02", action: "cart_cancel", unitsRemoved: 3, valueMinor: 900 },
    ],
    refunds: [
      { source: "void", orderId: "o1", businessDay: "2026-11-02", refundMinor: 1800, label: "v" },
      { source: "return", orderId: "web-1", businessDay: "2026-11-02", refundMinor: 300, label: "r" },
    ],
  });
  const a = r.cashiers.find((c) => c.employeeId === "A")!;
  ok(a.saleCount === 2 && a.grossMinor === 2300, "A has both processed sales");
  ok(a.cashSaleCount === 1 && a.cashGrossMinor === 1800 && a.employeeTabMinor === 500, "payment split");
  ok(a.discounts.totalMinor === 200 && a.discounts.dealMinor === 200, "deal discount = (1000-900)*2");
  ok(a.noSaleCount === 1 && a.noSales[0].approvedByEmployeeId === "M", "no-sale with approver");
  ok(a.adjustments.count === 1 && a.adjustments.valueMinor === 250, "cart adjustment attributed");
  ok(a.voidCount === 1 && a.voidMinor === 1800, "void goes to the cashier who rang the sale");
  ok(netAfterRefunds(a) === 500, "net after refunds");
  const b = r.cashiers.find((c) => c.employeeId === "B")!;
  ok(b.exceptionCount === 1 && b.grossMinor === 0, "exception counted, never summed as money");
  ok(r.untracedRefunds.length === 1 && r.untracedRefunds[0].orderId === "web-1", "untraced refund given to nobody");
  ok(r.unattributedAdjustments === 1, "adjustment without employee counted apart");
  ok(r.store.grossMinor === 2300 && r.store.voidMinor === 1800, "store total adds the cashiers");
  ok(untracedNote(r)!.includes("given to nobody"), "untraced note says so");
  // discount parts
  const d = saleDiscounts({
    lines: [
      { quantity: 1, unitPriceMinor: 700, regularPriceMinor: 1000, override: { originalUnitPriceMinor: 800 }, loyaltyDiscountMinor: 50 },
      { quantity: 2, unitPriceMinor: 650, regularPriceMinor: 1000, specialDiscountMinor: 350 },
    ],
    specialDiscount: { kind: "veteran" },
  });
  ok(d.totalMinor === 300 + 700, "total discount");
  ok(d.overrideMinor === 50 && d.overrideCount === 1, "override part = 800 - (700 + 50 loyalty)");
  ok(d.loyaltyMinor === 50 && d.specialMinor === 700, "loyalty and special parts");
  ok(d.specialByKind.veteran?.minor === 700, "special by kind");
  ok(d.dealMinor === 200, "deal part is what is left");
  ok(d.dealMinor + d.overrideMinor + d.loyaltyMinor + d.specialMinor + d.medicalMinor === d.totalMinor, "parts add up exactly");
  // medical: charged price already has the tax off; never added on top
  const med = saleDiscounts({ lines: [{ quantity: 1, unitPriceMinor: 800, regularPriceMinor: 1000 }], medical: { medicalSavingsMinor: 200 } });
  ok(med.totalMinor === 200 && med.medicalMinor === 200 && med.dealMinor === 0, "medical inside the total, not double counted");
  const medBad = saleDiscounts({ lines: [{ quantity: 1, unitPriceMinor: 900, regularPriceMinor: 1000 }], medical: { medicalSavingsMinor: 500 } });
  ok(medBad.medicalMinor === 100 && medBad.totalMinor === 100, "a medical figure larger than the saving is capped");
  const neg = saleDiscounts({ lines: [{ quantity: 1, unitPriceMinor: 1200, regularPriceMinor: 1000 }] });
  ok(neg.totalMinor === 0, "a price above regular is never a negative discount");
  ok(saleDiscounts(null).totalMinor === 0, "garbage payload = zero, never NaN");
  // range
  ok(checkCashierRange("2026-10-01", "2026-10-31").ok, "31 days accepted");
  ok(!checkCashierRange("2026-10-01", "2026-11-01").ok, "32 days refused");
  ok(!checkCashierRange("not-a-day", "2026-11-01").ok, "garbage dates refused");
  ok(!checkCashierRange("2026-11-02", "2026-11-01").ok, "reversed range refused");
  ok(!checkCashierRange("2026-01-01", "2026-03-01").ok, "over 31 days refused");
  ok(checkCashierRange("2026-11-01", "2026-11-30").ok, "30 days accepted");
  // csv
  const csv = cashierCsv([cashierCsvRow(a, "=Alice", "Front")]);
  ok(csv.includes("'=Alice"), "csv neutralises formulas");
  ok(csv.split("\r\n")[0].startsWith("Employee,Business day"), "csv header");
  ok(averageSale(a) === 1150 && discountRate(a) === "8.0%", "average and discount rate");
  return { passed, failed };
}
