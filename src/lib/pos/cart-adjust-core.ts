/**
 * src/lib/pos/cart-adjust-core.ts  (Register round — S3)
 *
 * Owner request (verbatim, todo.md): "I also want to keep track of who is
 * using the minus quantity button on the register screen. It is like a void,
 * and I want to make sure it is not getting abused in anyway. So a tracker on
 * when, who and how often it gets used would be great, in addition to
 * tracking on voids, who and when and how often."
 *
 * PURE. Validates the `cart_adjustment` register event and rolls the ledger
 * (pos_cart_adjustments, migration 0301) + voids up per employee and per
 * Pacific day. Money in cents.
 */

export const CART_ADJUST_ACTIONS = ["qty_decrease", "line_remove", "cart_cancel"] as const;
export type CartAdjustAction = (typeof CART_ADJUST_ACTIONS)[number];

export const CART_ADJUST_LABELS: Record<CartAdjustAction, string> = {
  qty_decrease: "Minus (−) qty",
  line_remove: "Line removed (✕)",
  cart_cancel: "Sale cancelled",
};

export type CartAdjustPayload = {
  action: CartAdjustAction;
  /** Item affected (absent for cart_cancel). */
  variantId?: string | null;
  productName?: string | null;
  /** Units removed by this action (cart_cancel: total units in the cart). */
  unitsRemoved: number;
  /** Shelf value removed, in cents. */
  valueMinor: number;
  /** Lines in the cart at cancel (cart_cancel only). */
  lineCount?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCartAdjustPayload(
  p: Partial<CartAdjustPayload>,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!p.action || !(CART_ADJUST_ACTIONS as readonly string[]).includes(p.action)) {
    errors.push("Unknown cart adjustment action.");
  }
  if (!Number.isInteger(p.unitsRemoved) || (p.unitsRemoved as number) < 1 || (p.unitsRemoved as number) > 10_000) {
    errors.push("unitsRemoved must be a whole number 1–10000.");
  }
  if (!Number.isInteger(p.valueMinor) || (p.valueMinor as number) < 0) {
    errors.push("valueMinor must be whole cents ≥ 0.");
  }
  if (p.action && p.action !== "cart_cancel" && p.variantId != null && !UUID_RE.test(String(p.variantId))) {
    errors.push("variantId must be a UUID.");
  }
  if (p.productName != null && String(p.productName).length > 300) errors.push("productName too long.");
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** One ledger row as read for reporting. */
export type CartAdjustRow = {
  employeeId: string | null;
  action: CartAdjustAction;
  unitsRemoved: number;
  valueMinor: number;
  occurredAt: string;
};

/** One void (from audit register.sale_voided) as read for reporting. */
export type VoidRow = {
  approverId: string | null;
  processedByName: string | null;
  refundMinor: number;
  occurredAt: string;
};

export type AdjustEmployeeSummary = {
  employeeId: string;
  qtyDecrease: number;
  lineRemove: number;
  cartCancel: number;
  units: number;
  valueMinor: number;
  lastAt: string;
};

export type AdjustDaySummary = { day: string; adjustments: number; voids: number; valueMinor: number };

export type AdjustReportSummary = {
  totals: { adjustments: number; units: number; valueMinor: number; voids: number; voidMinor: number };
  byEmployee: AdjustEmployeeSummary[];
  voidsByApprover: { employeeId: string; voids: number; refundMinor: number; lastAt: string }[];
  byDay: AdjustDaySummary[];
};

/** Rolls adjustments + voids up. `dayOf` maps an ISO time → Pacific YYYY-MM-DD. */
export function summarizeAdjustments(
  rows: CartAdjustRow[],
  voids: VoidRow[],
  dayOf: (iso: string) => string,
): AdjustReportSummary {
  const emp = new Map<string, AdjustEmployeeSummary>();
  const days = new Map<string, AdjustDaySummary>();
  const day = (iso: string) => {
    const k = dayOf(iso);
    let d = days.get(k);
    if (!d) days.set(k, (d = { day: k, adjustments: 0, voids: 0, valueMinor: 0 }));
    return d;
  };
  const totals = { adjustments: 0, units: 0, valueMinor: 0, voids: 0, voidMinor: 0 };
  for (const r of rows) {
    totals.adjustments += 1;
    totals.units += r.unitsRemoved;
    totals.valueMinor += r.valueMinor;
    const id = r.employeeId ?? "unknown";
    let e = emp.get(id);
    if (!e) emp.set(id, (e = { employeeId: id, qtyDecrease: 0, lineRemove: 0, cartCancel: 0, units: 0, valueMinor: 0, lastAt: "" }));
    if (r.action === "qty_decrease") e.qtyDecrease += 1;
    else if (r.action === "line_remove") e.lineRemove += 1;
    else e.cartCancel += 1;
    e.units += r.unitsRemoved;
    e.valueMinor += r.valueMinor;
    if (r.occurredAt > e.lastAt) e.lastAt = r.occurredAt;
    const d = day(r.occurredAt);
    d.adjustments += 1;
    d.valueMinor += r.valueMinor;
  }
  const vmap = new Map<string, { employeeId: string; voids: number; refundMinor: number; lastAt: string }>();
  for (const v of voids) {
    totals.voids += 1;
    totals.voidMinor += v.refundMinor;
    const id = v.approverId ?? "unknown";
    let a = vmap.get(id);
    if (!a) vmap.set(id, (a = { employeeId: id, voids: 0, refundMinor: 0, lastAt: "" }));
    a.voids += 1;
    a.refundMinor += v.refundMinor;
    if (v.occurredAt > a.lastAt) a.lastAt = v.occurredAt;
    day(v.occurredAt).voids += 1;
  }
  const count = (e: AdjustEmployeeSummary) => e.qtyDecrease + e.lineRemove + e.cartCancel;
  return {
    totals,
    byEmployee: [...emp.values()].sort((a, b) => count(b) - count(a) || b.valueMinor - a.valueMinor),
    voidsByApprover: [...vmap.values()].sort((a, b) => b.voids - a.voids),
    byDay: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}

export function __runCartAdjustTests(): void {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`cart-adjust-core: ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  };
  const V = "11111111-1111-4111-8111-111111111111";
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: V, unitsRemoved: 1, valueMinor: 2500 }).ok, true, "minus ok");
  eq(validateCartAdjustPayload({ action: "cart_cancel", unitsRemoved: 3, valueMinor: 9000, lineCount: 2 }).ok, true, "cancel ok");
  eq(validateCartAdjustPayload({ action: "qty_decrease", unitsRemoved: 0, valueMinor: 0 }).ok, false, "zero units refused");
  eq(validateCartAdjustPayload({ action: "nope" as CartAdjustAction, unitsRemoved: 1, valueMinor: 0 }).ok, false, "bad action refused");
  const s = summarizeAdjustments(
    [
      { employeeId: "a", action: "qty_decrease", unitsRemoved: 1, valueMinor: 100, occurredAt: "2026-01-02T20:00:00Z" },
      { employeeId: "a", action: "line_remove", unitsRemoved: 2, valueMinor: 400, occurredAt: "2026-01-02T21:00:00Z" },
      { employeeId: "b", action: "cart_cancel", unitsRemoved: 1, valueMinor: 50, occurredAt: "2026-01-03T20:00:00Z" },
    ],
    [{ approverId: "m", processedByName: "Pat", refundMinor: 1200, occurredAt: "2026-01-03T22:00:00Z" }],
    (iso) => iso.slice(0, 10),
  );
  eq(s.totals, { adjustments: 3, units: 4, valueMinor: 550, voids: 1, voidMinor: 1200 }, "totals");
  eq(s.byEmployee[0].employeeId, "a", "heaviest user first");
  eq([s.byEmployee[0].qtyDecrease, s.byEmployee[0].lineRemove], [1, 1], "per-action counts");
  eq(s.byDay.map((d) => [d.day, d.adjustments, d.voids]), [["2026-01-03", 1, 1], ["2026-01-02", 2, 0]], "by day");
}
