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
 *
 * R-CART-1 (owner, first trading day 2026-11-01): the exceptions queue filled
 * with "Invalid cart adjustment: variantId must be a UUID." for every minus /
 * remove at Register 1. Root cause, read from the code, not guessed: the
 * register's `variantId` is the MENU variant id (`menu_variants.
 * source_variant_id`, a TEXT column, migration 0002), shipped to the device
 * by api/pos/menu via pos/live-menu `toVariant`. Real ids look like
 * `<lot key>-onboarded` (receiving intake, variant-lot-core),
 * `<item id>-default` (single-price items, api/pos/menu), the Cultivera
 * `<item id>-<hash>` scheme, or `pos-custom-<uid>` (custom-sale-core). None
 * is a UUID, so the S3 check refused EVERY minus / remove that had an item.
 * Sales were never affected: order_items.variant_id is TEXT (0007) and the
 * sale validator has no UUID check on it. The tracker now accepts any real
 * menu variant id (trimmed, 1..200 chars, no control characters); the
 * ledger keeps it in pos_sale_events.payload, and the uuid column
 * pos_cart_adjustments.variant_id keeps null for non-UUID ids as before.
 * `planCartAdjustReplay` picks which already-stranded exceptions can now be
 * recorded, so the tracker the owner asked for has no first-day hole.
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

/** Longest menu variant id the tracker accepts (real ids are well under 100). */
export const MAX_VARIANT_ID_LENGTH = 200;

// Any C0 control character or DEL: never part of a real menu id.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Is this a menu variant id the register could really have sent? It is the
 * register's `PosMenuProduct.variantId` = `menu_variants.source_variant_id`
 * (TEXT). Shape is deliberately NOT checked beyond sanity: the id comes from
 * our own menu, and the ledger keeps the full payload for review.
 */
export function isMenuVariantId(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_VARIANT_ID_LENGTH && !CONTROL_RE.test(t);
}

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
  if (p.action && p.action !== "cart_cancel" && p.variantId != null && !isMenuVariantId(p.variantId)) {
    errors.push(`variantId must be the item's menu id (text, 1-${MAX_VARIANT_ID_LENGTH} characters).`);
  }
  if (p.productName != null && String(p.productName).length > 300) errors.push("productName too long.");
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** The exact reason the pre-R-CART-1 validator wrote on a stranded row. */
export const STRANDED_UUID_REASON = "Invalid cart adjustment: variantId must be a UUID.";

/** An open exception row as the replay reads it from pos_sale_events. */
export type CartAdjustExceptionRow = {
  id: string;
  clientUuid: string;
  eventType: string;
  status: string;
  resolvedAt: string | null;
  exceptionReason: string | null;
  payload: unknown;
};

export type CartAdjustReplayPlan = {
  /** Rows to record in pos_cart_adjustments, then resolve with a note. */
  record: { id: string; clientUuid: string; payload: CartAdjustPayload }[];
  /** Rows left for a person, each with the plain reason. */
  leave: { id: string; clientUuid: string; why: string }[];
};

/**
 * Which open exceptions can now be recorded automatically. ONLY rows that
 * (1) are cart_adjustment events, (2) are still open (status exception,
 * not resolved), (3) were stranded by EXACTLY the old UUID rule, and
 * (4) pass today's validator in full. Anything else is left for a manager
 * with the reason; nothing is guessed (rule 3).
 */
export function planCartAdjustReplay(rows: CartAdjustExceptionRow[]): CartAdjustReplayPlan {
  const plan: CartAdjustReplayPlan = { record: [], leave: [] };
  for (const r of rows) {
    if (r.eventType !== "cart_adjustment") continue;
    if (r.status !== "exception" || r.resolvedAt != null) continue;
    if ((r.exceptionReason ?? "").trim() !== STRANDED_UUID_REASON) {
      plan.leave.push({ id: r.id, clientUuid: r.clientUuid, why: "Different reason; review it by hand." });
      continue;
    }
    const payload = r.payload && typeof r.payload === "object"
      ? (r.payload as Partial<CartAdjustPayload>)
      : null;
    if (!payload) {
      plan.leave.push({ id: r.id, clientUuid: r.clientUuid, why: "The register sent no readable details." });
      continue;
    }
    const check = validateCartAdjustPayload(payload);
    if (!check.ok) {
      plan.leave.push({ id: r.id, clientUuid: r.clientUuid, why: check.errors.join(" ") });
      continue;
    }
    plan.record.push({ id: r.id, clientUuid: r.clientUuid, payload: payload as CartAdjustPayload });
  }
  return plan;
}

/** The resolution note written on each row the replay records. */
export const REPLAY_RESOLUTION_NOTE =
  "Recorded in the cart-adjustment tracker after fix R-CART-1 (the register's item id is a menu id, not a UUID). Nothing to re-ring: the sale itself was never affected.";

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
  // R-CART-1: every real register variant id shape is accepted.
  for (const id of ["LOT-A-onboarded", "pos-1234-default", "pos-cult-x1a2b3", "pos-custom-9f8e", V]) {
    eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: id, unitsRemoved: 1, valueMinor: 100 }).ok, true, `menu id ${id} ok`);
    eq(validateCartAdjustPayload({ action: "line_remove", variantId: id, unitsRemoved: 2, valueMinor: 200 }).ok, true, `remove ${id} ok`);
  }
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: null, unitsRemoved: 1, valueMinor: 0 }).ok, true, "null id ok");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: "", unitsRemoved: 1, valueMinor: 0 }).ok, false, "empty id refused");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: "   ", unitsRemoved: 1, valueMinor: 0 }).ok, false, "blank id refused");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: "a\nb", unitsRemoved: 1, valueMinor: 0 }).ok, false, "control char refused");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: 42 as unknown as string, unitsRemoved: 1, valueMinor: 0 }).ok, false, "number id refused");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: "x".repeat(MAX_VARIANT_ID_LENGTH), unitsRemoved: 1, valueMinor: 0 }).ok, true, "200 chars ok");
  eq(validateCartAdjustPayload({ action: "qty_decrease", variantId: "x".repeat(MAX_VARIANT_ID_LENGTH + 1), unitsRemoved: 1, valueMinor: 0 }).ok, false, "201 chars refused");
  const bad = validateCartAdjustPayload({ action: "qty_decrease", variantId: "", unitsRemoved: 1, valueMinor: 0 });
  eq(!bad.ok && bad.errors.some((e) => /UUID/.test(e)), false, "message never says UUID again");
  // R-CART-1: the replay planner.
  const row = (over: Partial<CartAdjustExceptionRow>): CartAdjustExceptionRow => ({
    id: "r1", clientUuid: "c1", eventType: "cart_adjustment", status: "exception", resolvedAt: null,
    exceptionReason: STRANDED_UUID_REASON,
    payload: { action: "qty_decrease", variantId: "LOT-A-onboarded", productName: "Blue Dream (3.5g)", unitsRemoved: 1, valueMinor: 2500 },
    ...over,
  });
  const plan = planCartAdjustReplay([
    row({}),
    row({ id: "r2", clientUuid: "c2", eventType: "sale" }),
    row({ id: "r3", clientUuid: "c3", resolvedAt: "2026-11-01T17:00:00Z" }),
    row({ id: "r4", clientUuid: "c4", status: "processed" }),
    row({ id: "r5", clientUuid: "c5", exceptionReason: "Cart adjustment not recorded: boom" }),
    row({ id: "r6", clientUuid: "c6", payload: { action: "qty_decrease", variantId: "LOT-B-onboarded", unitsRemoved: 0, valueMinor: 0 } }),
    row({ id: "r7", clientUuid: "c7", payload: null }),
    row({ id: "r8", clientUuid: "c8", payload: [1, 2] }),
    row({ id: "r9", clientUuid: "c9", exceptionReason: `  ${STRANDED_UUID_REASON}  ` }),
  ]);
  eq(plan.record.map((r) => r.id), ["r1", "r9"], "only stranded, open, now-valid rows are recorded");
  eq(plan.leave.map((r) => r.id), ["r5", "r6", "r7", "r8"], "other open cart rows are left for a person");
  eq(plan.record[0].payload.variantId, "LOT-A-onboarded", "payload carried verbatim");
  eq(planCartAdjustReplay([]).record.length, 0, "empty in, empty out");
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
