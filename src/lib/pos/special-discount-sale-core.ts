/**
 * src/lib/pos/special-discount-sale-core.ts  (SLICE 28)
 *
 * PURE math + rules for applying a SPECIAL discount (employee / industry /
 * veteran — migration 0133) AT THE REGISTER. No I/O, no server-only — the
 * same module runs on the iPad, in the sync re-checks, and in tests.
 *
 * How a special discount works at the register (mirrors the loyalty pattern
 * line for line, because that pattern already survives the server's gates):
 *
 *  1. The budtender opens the Special discount panel and picks a program.
 *     Each program collects its facts first (veteran: the military-ID-checked
 *     box; industry: the visitor's company name; employee: WHO is buying +
 *     a DIFFERENT employee's PIN verified ONLINE by /api/pos/witness — and
 *     the buyer can never be the employee logged into THIS register).
 *  2. applySpecialDiscountToLines takes percentBps off each line's CURRENT
 *     (post-promotion) unit price as whole-cent per-unit reductions, clamped
 *     to the SAME legal floors loyalty uses: the statutory 1¢ cannabis floor
 *     (RCW 69.50.357) and the acquisition-cost floor (WAC 314-55-155(5)(g))
 *     via loyaltyUnitFloor. A line at its floor simply absorbs less.
 *  3. The sale payload carries the per-line reductions + ONE specialDiscount
 *     block (validateSalePayload proves they agree before the offline queue
 *     accepts the sale); the sync re-validates the program rules, records
 *     the use in special_discount_uses, and audits it.
 *
 * STALE-SAFE: like loyalty, the application is only valid for the EXACT
 * priced cart it was computed on — the register drops it on any cart change
 * and the budtender re-applies (pricingFingerprint drift detection).
 *
 * NO STACKING: one special discount per sale, and it shares the
 * "reduce the unit price" lane with loyalty redemptions — applying one
 * drops the other (fingerprint drift), never both.
 *
 * All money in MINOR UNITS (cents); percent in BASIS POINTS (3500 = 35%).
 */
import { loyaltyUnitFloor } from "@/lib/loyalty/loyalty-sale-core";
import { computeOrderTotals, type OrderTotals } from "@/lib/orders/order-pricing-core";
import {
  applySpecialDiscount,
  isSpecialDiscountKind,
  validateSpecialDiscountUse,
  type SpecialDiscountKind,
  type SpecialDiscountSetting,
} from "@/lib/discounts/special-discount-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A priced line as the register holds it (post-promo, pre-special). */
export type SpecialDiscountLineInput = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  /** CURRENT tax-inclusive unit price (post-promotion), cents. */
  unitPriceMinor: number;
  /** Pre-discount unit price (tax-inclusive), cents. */
  regularPriceMinor: number;
  /** Weighted-average acquisition cost per unit (PRE-tax) when known. */
  costMinorUnits: number | null;
};

/** One line's outcome: the reduced price + the per-UNIT reduction taken. */
export type SpecialDiscountLineResult = {
  variantId?: string;
  productId: string;
  unitPriceMinor: number;
  /** Per-UNIT reduction (whole cents; 0 = line at its legal floor). */
  specialDiscountMinor: number;
};

export type SpecialDiscountApplication =
  | {
      ok: true;
      lines: SpecialDiscountLineResult[];
      /** Σ per-unit reduction × quantity actually taken, cents. */
      appliedMinor: number;
    }
  | { ok: false; reason: string };

/** The register's record of an applied (not-yet-synced) special discount. */
export type AppliedSpecialDiscount = {
  kind: SpecialDiscountKind;
  /** The program rate the device applied (from the bundle), basis points. */
  percentBps: number;
  /** Σ per-unit reduction × quantity, cents. */
  appliedMinor: number;
  /** employee program: which staff member is buying (employees.id). */
  beneficiaryEmployeeId?: string;
  /** employee program: display name for the rail chip (UI only). */
  beneficiaryName?: string;
  /** employee program: the OTHER employee who approved by PIN (server-verified). */
  approvedByEmployeeId?: string;
  /** employee program: approver display name (UI only, never in the payload). */
  approvedByName?: string;
  /** industry program: the visitor's company. */
  companyName?: string;
  /** veteran program: cashier ticked the military-ID-checked box. */
  militaryIdChecked?: boolean;
  /** pricingFingerprint() of the cart the reductions were computed for. */
  fingerprint: string;
  /** (variantId ?? productId) → per-UNIT reduction (whole cents). */
  perLine: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Apply — percent off each line, floors always win
// ---------------------------------------------------------------------------

/**
 * Take percentBps off every line's CURRENT unit price as a whole-cent
 * per-unit reduction, clamped so no unit ever drops below its legal floor
 * (statutory 1¢ for cannabis + the acquisition-cost floor when the cost is
 * known — loyaltyUnitFloor, the same helper loyalty redemptions trust).
 * Refused outright when the cart has no room at all (everything at floor)
 * or the percent is not a real program rate.
 */
export function applySpecialDiscountToLines(
  lines: SpecialDiscountLineInput[],
  percentBps: number,
): SpecialDiscountApplication {
  if (!Number.isInteger(percentBps) || percentBps <= 0 || percentBps > 10_000) {
    return { ok: false, reason: "This discount program has no rate set." };
  }
  if (!lines.length) return { ok: false, reason: "The cart is empty." };
  const out: SpecialDiscountLineResult[] = [];
  let applied = 0;
  for (const l of lines) {
    const current = Math.max(0, Math.round(l.unitPriceMinor));
    const floor = loyaltyUnitFloor({
      category: l.category,
      regularPriceMinorUnits: Math.max(0, Math.round(l.regularPriceMinor)),
      costMinorUnits: l.costMinorUnits,
    });
    // The program's cut of THIS unit price, floored to the cent — then the
    // legal floor caps it (a line at floor absorbs nothing, never negative).
    const want = applySpecialDiscount(current, percentBps).discountMinor;
    const room = Math.max(0, current - floor);
    const perUnit = Math.min(want, room);
    out.push({
      ...(l.variantId ? { variantId: l.variantId } : {}),
      productId: l.productId,
      unitPriceMinor: current - perUnit,
      specialDiscountMinor: perUnit,
    });
    applied += perUnit * Math.max(0, Math.round(l.quantity));
  }
  if (applied <= 0) {
    return {
      ok: false,
      reason: "Every item is already at its legal floor — nothing can be discounted.",
    };
  }
  return { ok: true, lines: out, appliedMinor: applied };
}

// ---------------------------------------------------------------------------
// Re-apply a stored application to the register's priced lines
// ---------------------------------------------------------------------------

export type SpecialPricedLine = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  unitPriceMinor: number;
  regularPriceMinor: number;
};

export type SpecialDiscountView<T extends SpecialPricedLine> = {
  /** Lines with reduced unit prices + per-unit specialDiscountMinor stamped on. */
  lines: (T & { specialDiscountMinor?: number })[];
  /** Totals recomputed from the reduced lines — the SAME computeOrderTotals the sync gate uses. */
  totals: OrderTotals;
  /** Σ per-unit reduction × quantity actually taken (defensive clamps included). */
  appliedMinor: number;
};

/**
 * Subtract a stored application's per-line map from the priced lines and
 * recompute totals (mirrors applyLoyaltyToPricedLines exactly). Defensive:
 * a reduction can never push a unit below 1 cent — the map was computed
 * against the same cart (fingerprint-guarded), so this clamp only guards
 * corruption — and unmatched lines are left untouched.
 */
export function applySpecialDiscountToPricedLines<T extends SpecialPricedLine>(
  lines: T[],
  perLine: Record<string, number>,
): SpecialDiscountView<T> {
  let applied = 0;
  const out = lines.map((l) => {
    const key = l.variantId ?? l.productId;
    const rawOff = perLine[key];
    if (!rawOff || !Number.isInteger(rawOff) || rawOff <= 0) return l;
    const off = Math.min(rawOff, Math.max(0, l.unitPriceMinor - 1));
    if (off <= 0) return l;
    applied += off * l.quantity;
    return { ...l, unitPriceMinor: l.unitPriceMinor - off, specialDiscountMinor: off };
  });
  const totals = computeOrderTotals(
    out.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
    })),
  );
  return { lines: out, totals, appliedMinor: applied };
}

// ---------------------------------------------------------------------------
// Program availability + register-side gate
// ---------------------------------------------------------------------------

/** The programs the register may offer: enabled AND carrying a real rate. */
export function availableSpecialDiscounts(
  settings: SpecialDiscountSetting[] | undefined,
): SpecialDiscountSetting[] {
  return (settings ?? []).filter(
    (s) => isSpecialDiscountKind(s.kind) && s.enabled && s.percentBps > 0 && s.percentBps <= 10_000,
  );
}

/**
 * The register-side gate before an employee-program application: the buyer
 * must not be the employee logged into THIS register (owner rule — they ring
 * it on another register), and the approver must be someone else. Wraps the
 * shared validateSpecialDiscountUse so the register and the sync agree.
 */
export function checkSpecialDiscountAtRegister(args: {
  kind: SpecialDiscountKind;
  cashierEmployeeId: string;
  registerId: string;
  beneficiaryEmployeeId?: string | null;
  approvedByEmployeeId?: string | null;
  companyName?: string | null;
  militaryIdChecked?: boolean;
}): string | null {
  return validateSpecialDiscountUse({
    kind: args.kind,
    cashierEmployeeId: args.cashierEmployeeId,
    registerId: args.registerId,
    beneficiaryEmployeeId: args.beneficiaryEmployeeId ?? null,
    approvedByEmployeeId: args.approvedByEmployeeId ?? null,
    // The buyer "is logged into this register" exactly when they own the
    // current session — i.e. they ARE the cashier. Map that fact onto the
    // shared rule's register comparison.
    beneficiaryActiveRegisterId:
      args.beneficiaryEmployeeId && args.beneficiaryEmployeeId === args.cashierEmployeeId
        ? args.registerId
        : null,
    companyName: args.companyName ?? null,
    militaryIdChecked: args.militaryIdChecked,
  });
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runSpecialDiscountSaleTests(): void {
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`special-discount-sale-core: ${what}`);
  };
  const line = (over: Partial<SpecialDiscountLineInput> = {}): SpecialDiscountLineInput => ({
    variantId: "v1",
    productId: "p1",
    category: "flower",
    quantity: 1,
    unitPriceMinor: 1000,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    ...over,
  });

  // Plain percent-off: 35% of $10.00 = $3.50 per unit.
  const a = applySpecialDiscountToLines([line()], 3500);
  ok(a.ok && a.lines[0].specialDiscountMinor === 350, "35% of $10 takes 350");
  ok(a.ok && a.lines[0].unitPriceMinor === 650, "reduced price 650");
  ok(a.ok && a.appliedMinor === 350, "appliedMinor sums");

  // Quantity multiplies the applied total, not the per-unit cut.
  const q = applySpecialDiscountToLines([line({ quantity: 3 })], 1500);
  ok(q.ok && q.lines[0].specialDiscountMinor === 150, "15% of $10 per unit");
  ok(q.ok && q.appliedMinor === 450, "3 units apply 3× the cut");

  // Cost floor wins: cost 650 pre-tax → floor ceil(650×1.4623) = 951.
  const c = applySpecialDiscountToLines([line({ costMinorUnits: 650 })], 3500);
  ok(c.ok && c.lines[0].unitPriceMinor === 951, "cost floor caps the reduction");
  ok(c.ok && c.lines[0].specialDiscountMinor === 49, "only the room above floor is taken");

  // Statutory floor: a 1¢ cannabis line has no room — whole cart refused.
  const f = applySpecialDiscountToLines([line({ unitPriceMinor: 1, regularPriceMinor: 1 })], 9900);
  ok(!f.ok, "all-at-floor cart refused");

  // Mixed cart: floored line absorbs nothing, the other still discounts.
  const m = applySpecialDiscountToLines(
    [line({ unitPriceMinor: 1, regularPriceMinor: 1 }), line({ variantId: "v2", productId: "p2" })],
    2000,
  );
  ok(m.ok && m.lines[0].specialDiscountMinor === 0, "floored line untouched");
  ok(m.ok && m.lines[1].specialDiscountMinor === 200, "roomy line takes 20%");

  // Garbage rates refused (0, negative, over 100%, non-integer).
  ok(!applySpecialDiscountToLines([line()], 0).ok, "0 bps refused");
  ok(!applySpecialDiscountToLines([line()], -100).ok, "negative bps refused");
  ok(!applySpecialDiscountToLines([line()], 10_001).ok, "over 100% refused");
  ok(!applySpecialDiscountToLines([line()], 12.5).ok, "fractional bps refused");
  ok(!applySpecialDiscountToLines([], 3500).ok, "empty cart refused");

  // Re-apply a stored per-line map to priced lines (fingerprint-guarded in
  // the UI; here we prove the math + the defensive clamps).
  const reapplied = applySpecialDiscountToPricedLines(
    [
      { variantId: "v1", productId: "p1", category: "flower", quantity: 2, unitPriceMinor: 1000, regularPriceMinor: 1000 },
      { variantId: "v2", productId: "p2", category: "flower", quantity: 1, unitPriceMinor: 500, regularPriceMinor: 500 },
    ],
    { v1: 350 },
  );
  ok(
    reapplied.lines[0].unitPriceMinor === 650 && reapplied.lines[0].specialDiscountMinor === 350,
    "stored map reduces the matched line",
  );
  ok(reapplied.lines[1].specialDiscountMinor === undefined, "unmatched line untouched");
  ok(reapplied.appliedMinor === 700, "applied total multiplies by quantity");
  ok(
    reapplied.totals.totalMinorUnits === 650 * 2 + 500,
    "totals recomputed from the reduced lines",
  );
  const clampedMap = applySpecialDiscountToPricedLines(
    [{ variantId: "v1", productId: "p1", category: "flower", quantity: 1, unitPriceMinor: 100, regularPriceMinor: 100 }],
    { v1: 5000 },
  );
  ok(
    clampedMap.lines[0].unitPriceMinor === 1 && clampedMap.appliedMinor === 99,
    "corrupted map clamped at the 1-cent statutory floor",
  );

  // Program availability: only enabled programs with a real rate.
  const avail = availableSpecialDiscounts([
    { kind: "employee", percentBps: 3500, enabled: true },
    { kind: "industry", percentBps: 0, enabled: false },
    { kind: "veteran", percentBps: 1500, enabled: false },
  ]);
  ok(avail.length === 1 && avail[0].kind === "employee", "only enabled+rated programs offered");
  ok(availableSpecialDiscounts(undefined).length === 0, "missing bundle block -> none");

  // Register gate: buyer logged into THIS register (buyer === cashier) blocked.
  const self = checkSpecialDiscountAtRegister({
    kind: "employee",
    cashierEmployeeId: "emp-1",
    registerId: "reg-1",
    beneficiaryEmployeeId: "emp-1",
    approvedByEmployeeId: "emp-2",
  });
  ok(!!self && /another register/.test(self), "buyer-on-own-register blocked");

  // Register gate: distinct buyer + distinct approver passes.
  const pass = checkSpecialDiscountAtRegister({
    kind: "employee",
    cashierEmployeeId: "emp-1",
    registerId: "reg-1",
    beneficiaryEmployeeId: "emp-2",
    approvedByEmployeeId: "emp-3",
  });
  ok(pass === null, "distinct buyer+approver passes");

  // Register gate: approver must differ from the buyer.
  const dup = checkSpecialDiscountAtRegister({
    kind: "employee",
    cashierEmployeeId: "emp-1",
    registerId: "reg-1",
    beneficiaryEmployeeId: "emp-2",
    approvedByEmployeeId: "emp-2",
  });
  ok(!!dup && /OTHER than the buyer/.test(dup), "self-approval blocked");

  // Register gate: veteran + industry facts required.
  ok(
    checkSpecialDiscountAtRegister({
      kind: "veteran",
      cashierEmployeeId: "c",
      registerId: "r",
      militaryIdChecked: false,
    }) !== null,
    "veteran needs the ID box",
  );
  ok(
    checkSpecialDiscountAtRegister({
      kind: "industry",
      cashierEmployeeId: "c",
      registerId: "r",
      companyName: " ",
    }) !== null,
    "industry needs a company",
  );
  ok(
    checkSpecialDiscountAtRegister({
      kind: "industry",
      cashierEmployeeId: "c",
      registerId: "r",
      companyName: "Green Vendor LLC",
    }) === null,
    "industry with company passes",
  );

  console.log("special-discount-sale: 28 self-tests passed");
}
