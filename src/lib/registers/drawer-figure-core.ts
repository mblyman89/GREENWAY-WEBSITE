/**
 * src/lib/registers/drawer-figure-core.ts  (Fix Phase 2.1 · G-05 · F-01-4)
 *
 * The per-drawer cash figure. PURE: no I/O, safe to import anywhere.
 *
 * Owner rule: never guess. Before this slice the manager TYPED the drawer's
 * cash sales at reconcile (F-01-4), from a day report that covers the whole
 * register and a refund total that covers the whole store. This core builds
 * the figure from records the server already holds:
 *
 *   CASH SALES   every PROCESSED register sale whose payload carries this
 *                drawer's id (drawerSessionId). The sync proves that id is a
 *                real session of the same register, open when the sale
 *                happened (sync-core.ts checkDrawerSessionForSale).
 *                cash = totalMinor + cash rounding, for paymentMethod "cash"
 *                only (any other tender is listed, never counted as cash);
 *                an employee-tab sale brings in no cash (same rule as the X/Z
 *                report: Gross + Cash rounding - Employee tab).
 *   REFUNDS      voids and counter returns TIED to this drawer (migration
 *                0313; the register ties them to the open drawer of its own
 *                register, the returns desk asks, a manager ties older ones).
 *   DROPS        drawer_drops for the session.
 *
 *   EXPECTED     opening float + cash sales - refunds paid - drops
 *
 * What the figure cannot know is never filled in. It is reported as a
 * BLOCKER, and reconcile refuses until it is resolved:
 *   - a sale of this drawer still processing (pending): the total is not
 *     final yet;
 *   - a refund on the drawer's business day that is not tied to any drawer
 *     or the safe: it may have come out of this drawer;
 *   - a read that did not complete;
 *   - no opening count.
 * A sale the server refused (exception) is NOT added: it is not a sale on
 * the books. It is listed so the manager knows why the drawer may be over.
 *
 * Money is MINOR units (cents), integers throughout.
 */

export type FigureSaleEvent = {
  status: string;
  eventType: string;
  payload: unknown;
};

export type FigureRefund = {
  source: "void" | "return";
  /** void: the order id; return: customer_returns.id */
  sourceId: string;
  refundMinor: number;
  /** "drawer" | "safe" | null (null = not tied to anything yet). */
  paidFrom: "drawer" | "safe" | null;
  drawerSessionId: string | null;
  /** Receipt or order label for the screen (optional). */
  label?: string | null;
  atIso?: string | null;
};

export type DrawerFigureInput = {
  sessionId: string;
  openingMinor: number | null;
  closingMinor: number | null;
  dropsMinor: number;
  saleEvents: readonly FigureSaleEvent[];
  /** Every cash refund of the drawer's business day (store-wide). */
  dayRefunds: readonly FigureRefund[];
  /** False when any read behind the figure did not complete. */
  readsComplete: boolean;
  readProblem?: string | null;
};

export type DrawerFigure = {
  saleCount: number;
  grossMinor: number;
  roundingMinor: number;
  employeeTabCount: number;
  employeeTabMinor: number;
  /** Processed sales paid by a tender that is neither cash nor employee tab. */
  otherTenderCount: number;
  otherTenderMinor: number;
  cashSalesMinor: number;
  pendingCount: number;
  exceptionCount: number;
  exceptionMinor: number;
  refundsPaid: FigureRefund[];
  refundsPaidMinor: number;
  /** Refunds of the day tied to nothing (blockers). */
  unattributed: FigureRefund[];
  dropsMinor: number;
  openingMinor: number | null;
  /** Null when there is no opening count. */
  expectedMinor: number | null;
  /** counted - expected; null until both are known. */
  overShortMinor: number | null;
  blockers: string[];
};

function int(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The drawer id a sale event claims (payload.drawerSessionId), or null. */
export function saleDrawerSessionId(payload: unknown): string | null {
  const id = rec(payload).drawerSessionId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Cash one processed sale brought into the drawer (0 for an employee tab). */
export function saleCashMinor(payload: unknown): number {
  const p = rec(payload);
  // Only a CASH sale puts cash in the drawer. The store is cash-only at
  // launch (sale-event-core.ts isPaymentMethodEnabled), but if another
  // tender is ever switched on it is NOT counted as cash: it is listed as
  // "other tender" instead.
  if (p.paymentMethod !== "cash") return 0;
  return int(p.totalMinor) + int(rec(p.rounding).adjustmentMinor);
}

function money(minor: number): string {
  const neg = minor < 0;
  const s = (Math.abs(minor) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${s}`;
}

export function buildDrawerFigure(input: DrawerFigureInput): DrawerFigure {
  const out: DrawerFigure = {
    saleCount: 0,
    grossMinor: 0,
    roundingMinor: 0,
    employeeTabCount: 0,
    employeeTabMinor: 0,
    otherTenderCount: 0,
    otherTenderMinor: 0,
    cashSalesMinor: 0,
    pendingCount: 0,
    exceptionCount: 0,
    exceptionMinor: 0,
    refundsPaid: [],
    refundsPaidMinor: 0,
    unattributed: [],
    dropsMinor: Math.max(0, int(input.dropsMinor)),
    openingMinor: input.openingMinor,
    expectedMinor: null,
    overShortMinor: null,
    blockers: [],
  };

  for (const ev of input.saleEvents) {
    if (ev.eventType !== "sale") continue;
    // Defence in depth: the loader filters by drawer id, the core re-checks.
    if (saleDrawerSessionId(ev.payload) !== input.sessionId) continue;
    const p = rec(ev.payload);
    if (ev.status === "pending") {
      out.pendingCount += 1;
      continue;
    }
    if (ev.status === "exception") {
      out.exceptionCount += 1;
      out.exceptionMinor += int(p.totalMinor);
      continue;
    }
    if (ev.status !== "processed") continue;
    out.saleCount += 1;
    out.grossMinor += int(p.totalMinor);
    out.roundingMinor += int(rec(p.rounding).adjustmentMinor);
    if (p.paymentMethod === "employee_tab") {
      out.employeeTabCount += 1;
      out.employeeTabMinor += int(p.totalMinor);
    } else if (p.paymentMethod !== "cash") {
      out.otherTenderCount += 1;
      out.otherTenderMinor += int(p.totalMinor);
    }
    out.cashSalesMinor += saleCashMinor(p);
  }

  for (const r of input.dayRefunds) {
    if (r.paidFrom === "drawer" && r.drawerSessionId === input.sessionId) {
      out.refundsPaid.push(r);
      out.refundsPaidMinor += Math.max(0, int(r.refundMinor));
    } else if (r.paidFrom === null || (r.paidFrom === "drawer" && !r.drawerSessionId)) {
      out.unattributed.push(r);
    }
  }

  if (!input.readsComplete) {
    out.blockers.push(
      `The records behind this drawer's figure could not all be read${input.readProblem ? ` (${input.readProblem})` : ""}. ` +
        "Nothing is guessed: try again in a minute.",
    );
  }
  if (out.pendingCount > 0) {
    out.blockers.push(
      `${out.pendingCount} sale${out.pendingCount === 1 ? "" : "s"} from this drawer ${out.pendingCount === 1 ? "is" : "are"} still processing. ` +
        "Wait for the register to finish syncing, then reload.",
    );
  }
  if (out.unattributed.length > 0) {
    const total = out.unattributed.reduce((s, r) => s + Math.max(0, int(r.refundMinor)), 0);
    out.blockers.push(
      `${out.unattributed.length} cash refund${out.unattributed.length === 1 ? "" : "s"} (${money(total)}) on this day ` +
        `${out.unattributed.length === 1 ? "is" : "are"} not tied to a drawer or the safe. Say where each one was paid from first.`,
    );
  }
  if (input.openingMinor === null) {
    out.blockers.push("This drawer has no opening count, so its expected cash cannot be worked out.");
  }

  if (input.openingMinor !== null) {
    out.expectedMinor = input.openingMinor + out.cashSalesMinor - out.refundsPaidMinor - out.dropsMinor;
    if (input.closingMinor !== null) out.overShortMinor = input.closingMinor - out.expectedMinor;
  }
  return out;
}

/** True when reconcile may go ahead (no blockers). */
export function figureReady(f: DrawerFigure): boolean {
  return f.blockers.length === 0 && f.expectedMinor !== null;
}

/** Where a refund was paid from, in words for the screen and the print. */
export function refundPaidFromLabel(r: Pick<FigureRefund, "paidFrom" | "drawerSessionId">, drawerName?: string | null): string {
  if (r.paidFrom === "safe") return "Store safe";
  if (r.paidFrom === "drawer" && r.drawerSessionId) return drawerName ? `Drawer: ${drawerName}` : "A drawer";
  return "Not tied to a drawer";
}

/** Read the paid-from choice posted by a form ("safe" or "drawer:<uuid>"). */
export function parsePaidFrom(raw: string | null | undefined): { paidFrom: "drawer" | "safe"; drawerSessionId: string | null } | null {
  const v = String(raw ?? "").trim();
  if (v === "safe") return { paidFrom: "safe", drawerSessionId: null };
  const m = /^drawer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(v);
  if (m) return { paidFrom: "drawer", drawerSessionId: m[1].toLowerCase() };
  return null;
}

export function __runDrawerFigureCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`drawer-figure-core self-test failed: ${label}`);
    }
  };
  const S = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const sale = (status: string, payload: Record<string, unknown>) => ({ status, eventType: "sale", payload });

  const base: DrawerFigureInput = {
    sessionId: S,
    openingMinor: 16750,
    closingMinor: 50000,
    dropsMinor: 20000,
    saleEvents: [
      sale("processed", { drawerSessionId: S, totalMinor: 30000, paymentMethod: "cash" }),
      sale("processed", { drawerSessionId: S, totalMinor: 10003, paymentMethod: "cash", rounding: { adjustmentMinor: -3 } }),
      sale("processed", { drawerSessionId: S, totalMinor: 5000, paymentMethod: "employee_tab" }),
      sale("processed", { drawerSessionId: OTHER, totalMinor: 99999, paymentMethod: "cash" }),
      sale("exception", { drawerSessionId: S, totalMinor: 1200, paymentMethod: "cash" }),
      { status: "processed", eventType: "no_sale", payload: { drawerSessionId: S, totalMinor: 777 } },
    ],
    dayRefunds: [
      { source: "void", sourceId: "o1", refundMinor: 2500, paidFrom: "drawer", drawerSessionId: S },
      { source: "return", sourceId: "r1", refundMinor: 1000, paidFrom: "drawer", drawerSessionId: OTHER },
      { source: "return", sourceId: "r2", refundMinor: 800, paidFrom: "safe", drawerSessionId: null },
    ],
    readsComplete: true,
  };
  const f = buildDrawerFigure(base);
  ok(f.saleCount === 3, "three processed sales of this drawer");
  ok(f.grossMinor === 45003, "gross counts every processed sale of this drawer");
  ok(f.roundingMinor === -3, "rounding summed");
  ok(f.employeeTabCount === 1 && f.employeeTabMinor === 5000, "tab sale counted as a tab");
  ok(f.cashSalesMinor === 40000, "cash = gross + rounding - tab");
  ok(f.exceptionCount === 1 && f.exceptionMinor === 1200, "exception listed, not added");
  ok(f.refundsPaidMinor === 2500 && f.refundsPaid.length === 1, "only this drawer's refunds subtract");
  ok(f.unattributed.length === 0, "safe and other-drawer refunds are attributed");
  ok(f.expectedMinor === 16750 + 40000 - 2500 - 20000, "expected = opening + cash - refunds - drops");
  ok(f.overShortMinor === 50000 - 34250, "over/short = counted - expected");
  ok(figureReady(f), "no blockers -> ready");

  const pend = buildDrawerFigure({ ...base, saleEvents: [...base.saleEvents, sale("pending", { drawerSessionId: S, totalMinor: 100 })] });
  ok(pend.pendingCount === 1 && !figureReady(pend), "a pending sale blocks");
  ok(pend.cashSalesMinor === 40000, "a pending sale is not added");
  ok(pend.blockers.some((b) => b.includes("still processing")), "pending blocker text");

  const un = buildDrawerFigure({
    ...base,
    dayRefunds: [...base.dayRefunds, { source: "void", sourceId: "o9", refundMinor: 4000, paidFrom: null, drawerSessionId: null }],
  });
  ok(un.unattributed.length === 1 && !figureReady(un), "an untied refund blocks");
  ok(un.blockers.some((b) => b.includes("$40.00")), "untied blocker shows the amount");
  ok(un.refundsPaidMinor === 2500, "an untied refund is never guessed into this drawer");

  const noOpen = buildDrawerFigure({ ...base, openingMinor: null });
  ok(noOpen.expectedMinor === null && !figureReady(noOpen), "no opening count -> no expected, blocked");

  const noClose = buildDrawerFigure({ ...base, closingMinor: null });
  ok(noClose.overShortMinor === null && noClose.expectedMinor === 34250, "no count -> expected but no over/short");

  const partial = buildDrawerFigure({ ...base, readsComplete: false, readProblem: "timeout" });
  ok(!figureReady(partial) && partial.blockers[0].includes("timeout"), "incomplete read blocks with the reason");

  const empty = buildDrawerFigure({ ...base, saleEvents: [], dayRefunds: [], dropsMinor: 0, closingMinor: 16750 });
  ok(empty.cashSalesMinor === 0 && empty.expectedMinor === 16750 && empty.overShortMinor === 0, "no sales -> expected is the float");

  ok(saleCashMinor({ totalMinor: "500" }) === 0, "non-integer total counts 0");
  ok(saleCashMinor("garbage") === 0, "garbage payload counts 0");
  ok(saleDrawerSessionId({ drawerSessionId: 5 }) === null, "non-string drawer id ignored");
  ok(parsePaidFrom("safe")?.paidFrom === "safe", "safe parsed");
  ok(parsePaidFrom(`drawer:${S.toUpperCase()}`)?.drawerSessionId === S, "drawer parsed, lower-cased");
  ok(parsePaidFrom("drawer:x") === null && parsePaidFrom("") === null, "bad choice refused");
  ok(refundPaidFromLabel({ paidFrom: null, drawerSessionId: null }) === "Not tied to a drawer", "untied label");
  ok(refundPaidFromLabel({ paidFrom: "drawer", drawerSessionId: S }, "Register 1") === "Drawer: Register 1", "drawer label");
  ok(money(-123456) === "-$1,234.56", "money format");

  const other = buildDrawerFigure({
    ...base,
    saleEvents: [...base.saleEvents, sale("processed", { drawerSessionId: S, totalMinor: 7000, paymentMethod: "debit" })],
  });
  ok(other.otherTenderCount === 1 && other.otherTenderMinor === 7000, "a non-cash tender is listed");
  ok(other.cashSalesMinor === 40000, "a non-cash tender is never counted as drawer cash");
  ok(saleCashMinor({ totalMinor: 500 }) === 0, "no payment method -> not cash");
  ok(saleCashMinor({ totalMinor: 500, paymentMethod: "cash" }) === 500, "cash sale counts");
  return { passed, failed };
}
