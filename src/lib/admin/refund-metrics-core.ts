/**
 * refund-metrics-core.ts (Slice 21) — PURE. Gross, refunds, and what's left.
 *
 * Michael, verbatim:
 *
 *   "nowhere in the back office can I find anything related to returns or
 *    voids, and possibly other important data/ metrics I should have on hand
 *    and available to see. It should be in reports and in the main cockpit."
 *
 * He is right, and the gap was wider than "a missing panel". `reports/sales.ts`
 * has no concept of a refund at all — grepping it for return/void/refund finds
 * only the phrase "Returning customers" and the JavaScript keyword. So every
 * revenue figure the back office has ever shown is GROSS: it is what was rung
 * up, not what the business kept.
 *
 * The facts were being recorded the whole time, in two different places
 * because they are two different events:
 *
 *   - A VOID unwinds a sale that should not have happened (same-day mistake).
 *     `void-store.ts:62` writes marker "sale_voided" to order_events, and an
 *     audit_logs row with action "register.sale_voided" carrying refundMinor.
 *   - A RETURN is a customer bringing product back, with WAC 314-55-079(12)
 *     attestations, a disposition of restock or destroy, and a CCRS Sale
 *     correction. `customer_returns` (migration 0115:38) holds
 *     refund_minor_units, quantity, disposition and reason.
 *
 * `refunds-store.ts:33` already joined those two into a `RefundSummary` per
 * business day — but only the register's X/Z slip and the register oversight
 * screen ever called it. The cockpit and every /admin/reports page ignored it.
 *
 * This module is the arithmetic layer: given gross figures and refund facts,
 * what is the NET, and what rate are we refunding at. It is pure so the
 * definitions live in exactly one tested place instead of being re-derived
 * (differently) in each panel that wants them.
 *
 * MONEY IS ALWAYS MINOR UNITS (cents), integers, matching the rest of the
 * codebase. Rates are returned as 0..1 fractions, never pre-formatted strings.
 */

// ── Shapes ──────────────────────────────────────────────────────────────────

/**
 * The per-day refund facts, mirroring `RefundSummary` in day-report-core.ts.
 * Redeclared structurally (not imported) on purpose: this module is pure and
 * must not pull in the receipt-printing module's dependency graph. The test
 * suite asserts the two shapes stay compatible, so drift is caught rather than
 * assumed away.
 */
export type RefundFacts = {
  voidCount: number;
  voidRefundMinor: number;
  returnCount: number;
  returnRefundMinor: number;
  refundTotalMinor: number;
};

export const EMPTY_REFUND_FACTS: RefundFacts = {
  voidCount: 0,
  voidRefundMinor: 0,
  returnCount: 0,
  returnRefundMinor: 0,
  refundTotalMinor: 0,
};

/** A defensive integer read: garbage becomes 0 rather than NaN downstream. */
function intOrZero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Coerce anything into well-formed RefundFacts, clamping negatives to 0. */
export function toRefundFacts(raw: unknown): RefundFacts {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const voidCount = Math.max(0, intOrZero(o.voidCount));
  const voidRefundMinor = Math.max(0, intOrZero(o.voidRefundMinor));
  const returnCount = Math.max(0, intOrZero(o.returnCount));
  const returnRefundMinor = Math.max(0, intOrZero(o.returnRefundMinor));
  return {
    voidCount,
    voidRefundMinor,
    returnCount,
    returnRefundMinor,
    // Recomputed rather than trusted: a stored total that disagrees with its
    // own parts is a bug we should not propagate into the owner's dashboard.
    refundTotalMinor: voidRefundMinor + returnRefundMinor,
  };
}

/** Add up refund facts across many days. */
export function sumRefundFacts(days: RefundFacts[]): RefundFacts {
  const out: RefundFacts = { ...EMPTY_REFUND_FACTS };
  for (const d of days) {
    const f = toRefundFacts(d);
    out.voidCount += f.voidCount;
    out.voidRefundMinor += f.voidRefundMinor;
    out.returnCount += f.returnCount;
    out.returnRefundMinor += f.returnRefundMinor;
  }
  out.refundTotalMinor = out.voidRefundMinor + out.returnRefundMinor;
  return out;
}

// ── The numbers that were missing ───────────────────────────────────────────

export type NetSales = {
  /** What was rung up, before any money went back out. */
  grossMinor: number;
  /** Everything paid back out: voids + returns. */
  refundMinor: number;
  /** Gross − refunds. What the business actually kept. */
  netMinor: number;
  /**
   * Refunds as a fraction of gross, 0..1, or null when gross is 0.
   *
   * Null rather than 0 is deliberate: refunding $50 on a day that rang up
   * nothing is not "a 0% refund rate", it is a rate that cannot be expressed
   * as a share of a zero denominator. Showing 0% there would be the most
   * flattering possible reading of the worst possible day.
   */
  refundRate: number | null;
};

export function computeNetSales(grossMinor: number, refunds: RefundFacts): NetSales {
  const gross = Math.max(0, intOrZero(grossMinor));
  const f = toRefundFacts(refunds);
  const refundMinor = f.refundTotalMinor;
  return {
    grossMinor: gross,
    refundMinor,
    // Net is allowed to go NEGATIVE and is not clamped. A day whose refunds
    // exceed its sales is a real and important event (a big return against a
    // prior day's sale), and hiding it behind a 0 floor would erase exactly
    // the signal the owner asked to be able to see.
    netMinor: gross - refundMinor,
    refundRate: gross === 0 ? null : refundMinor / gross,
  };
}

/** Format a 0..1 rate as a percentage string, or an em dash when unknowable. */
export function formatRate(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

// ── Severity banding, so the cockpit can raise a flag ───────────────────────

export type RefundSeverity = "ok" | "watch" | "high";

/**
 * Band a refund rate.
 *
 * These thresholds are PRESENTATION defaults, not compliance limits, and are
 * named as such so nobody later mistakes them for a WAC rule. They exist so
 * the cockpit can colour a tile and raise an attention flag; the owner can see
 * the underlying rate and judge for himself.
 *
 * A null rate (no gross) with refunds present is "high" — money went out and
 * none came in, which is precisely when a human should look.
 */
export const REFUND_RATE_WATCH = 0.03;
export const REFUND_RATE_HIGH = 0.06;

export function refundSeverity(net: NetSales): RefundSeverity {
  if (net.refundRate === null) return net.refundMinor > 0 ? "high" : "ok";
  if (net.refundRate >= REFUND_RATE_HIGH) return "high";
  if (net.refundRate >= REFUND_RATE_WATCH) return "watch";
  return "ok";
}

// ── Breakdowns ──────────────────────────────────────────────────────────────

export type BreakdownRow = {
  key: string;
  label: string;
  count: number;
  refundMinor: number;
  /** Share of the breakdown's total refund value, 0..1. */
  share: number;
};

/** A single return row, as read from customer_returns. */
export type ReturnRowFacts = {
  reason: string | null;
  disposition: string | null;
  refundMinorUnits: number;
  quantity: number;
};

const REASON_LABELS: Record<string, string> = {
  defective: "Defective",
  wrong_item: "Wrong item",
  customer_changed_mind: "Changed mind",
  damaged: "Damaged",
  recall: "Recall",
  other: "Other",
};

/** Title-case an unmapped snake_case key rather than showing it raw. */
export function humanizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "Unspecified";
  const mapped = REASON_LABELS[trimmed.toLowerCase()];
  if (mapped) return mapped;
  return trimmed
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Group return rows by a field, biggest refund value first.
 *
 * Ties break by key so the order is STABLE across renders — an unstable sort
 * makes a dashboard appear to change when nothing has.
 */
export function breakdownBy(
  rows: ReturnRowFacts[],
  field: "reason" | "disposition",
): BreakdownRow[] {
  const buckets = new Map<string, { count: number; refundMinor: number }>();
  for (const r of rows) {
    const raw = (r[field] ?? "").toString().trim();
    const key = raw === "" ? "unspecified" : raw.toLowerCase();
    const b = buckets.get(key) ?? { count: 0, refundMinor: 0 };
    b.count += 1;
    b.refundMinor += Math.max(0, intOrZero(r.refundMinorUnits));
    buckets.set(key, b);
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.refundMinor, 0);
  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      label: humanizeKey(key),
      count: b.count,
      refundMinor: b.refundMinor,
      share: total === 0 ? 0 : b.refundMinor / total,
    }))
    .sort((a, b) => b.refundMinor - a.refundMinor || a.key.localeCompare(b.key));
}

/** Units returned, summed defensively (quantity is numeric in the DB). */
export function totalReturnedUnits(rows: ReturnRowFacts[]): number {
  let sum = 0;
  for (const r of rows) {
    const n = typeof r.quantity === "number" ? r.quantity : Number(r.quantity);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  // Quantity can be fractional (grams), so round to 2dp rather than trunc.
  return Math.round(sum * 100) / 100;
}

/**
 * Share of returned value that went back on the shelf.
 *
 * Worth surfacing because restock is revenue recoverable and destroy is not:
 * two stores with identical refund rates have very different problems if one
 * restocks 90% and the other destroys 90%.
 */
export function restockShare(rows: ReturnRowFacts[]): number | null {
  let restock = 0;
  let total = 0;
  for (const r of rows) {
    const v = Math.max(0, intOrZero(r.refundMinorUnits));
    total += v;
    if ((r.disposition ?? "").toString().trim().toLowerCase() === "restock") restock += v;
  }
  return total === 0 ? null : restock / total;
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runRefundMetricsCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`refund-metrics-core: ${msg}`);
    passed += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) => {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(`refund-metrics-core: ${msg} (got ${sa}, want ${sb})`);
    passed += 1;
  };

  // ── toRefundFacts is defensive ────────────────────────────────────────────
  eq(toRefundFacts(null), EMPTY_REFUND_FACTS, "null coerces to zeros");
  eq(toRefundFacts(undefined), EMPTY_REFUND_FACTS, "undefined coerces to zeros");
  eq(toRefundFacts({}), EMPTY_REFUND_FACTS, "empty object coerces to zeros");
  eq(toRefundFacts("nonsense"), EMPTY_REFUND_FACTS, "string coerces to zeros");
  const neg = toRefundFacts({ voidRefundMinor: -500, voidCount: -2 });
  eq(neg.voidRefundMinor, 0, "negative refund clamped to 0");
  eq(neg.voidCount, 0, "negative count clamped to 0");

  // A stored total that disagrees with its parts is RECOMPUTED, not trusted.
  const lying = toRefundFacts({
    voidRefundMinor: 100,
    returnRefundMinor: 200,
    refundTotalMinor: 999999,
  });
  eq(lying.refundTotalMinor, 300, "total is recomputed from parts, not trusted");

  // ── computeNetSales ───────────────────────────────────────────────────────
  const facts = toRefundFacts({
    voidCount: 1,
    voidRefundMinor: 2500,
    returnCount: 2,
    returnRefundMinor: 5000,
  });
  const net = computeNetSales(100_000, facts);
  eq(net.grossMinor, 100_000, "gross preserved");
  eq(net.refundMinor, 7500, "refunds are voids + returns");
  eq(net.netMinor, 92_500, "net is gross minus refunds");
  ok(Math.abs(net.refundRate! - 0.075) < 1e-9, "refund rate is refunds/gross");

  // THE ZERO-GROSS RULE: null, never a flattering 0%.
  const noSales = computeNetSales(0, toRefundFacts({ returnRefundMinor: 5000 }));
  eq(noSales.refundRate, null, "zero gross yields null rate, not 0%");
  eq(noSales.netMinor, -5000, "net goes negative rather than clamping to 0");
  eq(formatRate(noSales.refundRate), "—", "null rate renders as a dash");
  eq(refundSeverity(noSales), "high", "money out with no sales is high severity");

  const nothingAtAll = computeNetSales(0, EMPTY_REFUND_FACTS);
  eq(nothingAtAll.refundRate, null, "0 gross 0 refunds still null rate");
  eq(refundSeverity(nothingAtAll), "ok", "a quiet day is not an alarm");

  // Net is not clamped even with sales present.
  const bigReturn = computeNetSales(1000, toRefundFacts({ returnRefundMinor: 9000 }));
  eq(bigReturn.netMinor, -8000, "a big return against a prior day shows negative net");
  ok(bigReturn.refundRate! > 1, "refund rate above 100% is reported honestly");

  // ── formatRate ────────────────────────────────────────────────────────────
  eq(formatRate(0.075), "7.5%", "rate formats to 1dp");
  eq(formatRate(0.075, 0), "8%", "digits arg respected");
  eq(formatRate(0), "0.0%", "a real zero rate is shown as 0.0%, not a dash");
  eq(formatRate(null), "—", "null is a dash");

  // The distinction that matters: a real 0% and an unknowable rate differ.
  ok(formatRate(0) !== formatRate(null), "0% and 'no denominator' render differently");

  // ── Severity banding ──────────────────────────────────────────────────────
  eq(refundSeverity(computeNetSales(100_000, toRefundFacts({ returnRefundMinor: 1000 }))), "ok", "1% is ok");
  eq(refundSeverity(computeNetSales(100_000, toRefundFacts({ returnRefundMinor: 3000 }))), "watch", "3% hits watch");
  eq(refundSeverity(computeNetSales(100_000, toRefundFacts({ returnRefundMinor: 6000 }))), "high", "6% hits high");
  eq(refundSeverity(computeNetSales(100_000, toRefundFacts({ returnRefundMinor: 5999 }))), "watch", "just under high is watch");
  ok(REFUND_RATE_WATCH < REFUND_RATE_HIGH, "watch threshold is below high");

  // ── sumRefundFacts ────────────────────────────────────────────────────────
  const summed = sumRefundFacts([
    toRefundFacts({ voidCount: 1, voidRefundMinor: 100, returnCount: 1, returnRefundMinor: 200 }),
    toRefundFacts({ voidCount: 2, voidRefundMinor: 300, returnCount: 3, returnRefundMinor: 400 }),
  ]);
  eq(summed.voidCount, 3, "void counts add");
  eq(summed.returnCount, 4, "return counts add");
  eq(summed.refundTotalMinor, 1000, "summed total is all parts");
  eq(sumRefundFacts([]), EMPTY_REFUND_FACTS, "summing nothing is zeros");

  // ── breakdownBy ───────────────────────────────────────────────────────────
  const rows: ReturnRowFacts[] = [
    { reason: "defective", disposition: "destroy", refundMinorUnits: 5000, quantity: 1 },
    { reason: "defective", disposition: "destroy", refundMinorUnits: 3000, quantity: 2 },
    { reason: "wrong_item", disposition: "restock", refundMinorUnits: 1000, quantity: 1 },
    { reason: null, disposition: null, refundMinorUnits: 500, quantity: 0.5 },
  ];
  const byReason = breakdownBy(rows, "reason");
  eq(byReason[0].key, "defective", "biggest refund value sorts first");
  eq(byReason[0].count, 2, "grouped count is right");
  eq(byReason[0].refundMinor, 8000, "grouped value is right");
  eq(byReason[0].label, "Defective", "known reason gets a friendly label");
  eq(byReason[1].key, "wrong_item", "second by value");
  eq(byReason[1].label, "Wrong item", "snake_case reason humanised");
  eq(byReason[2].key, "unspecified", "null reason buckets as unspecified, not dropped");
  ok(Math.abs(byReason[0].share - 8000 / 9500) < 1e-9, "share is of the breakdown total");
  ok(
    Math.abs(byReason.reduce((s, r) => s + r.share, 0) - 1) < 1e-9,
    "shares sum to 1",
  );
  eq(breakdownBy([], "reason"), [], "no rows yields no buckets");

  // Stable ordering on ties.
  const tied = breakdownBy(
    [
      { reason: "zebra", disposition: null, refundMinorUnits: 100, quantity: 1 },
      { reason: "alpha", disposition: null, refundMinorUnits: 100, quantity: 1 },
    ],
    "reason",
  );
  eq(tied.map((t) => t.key), ["alpha", "zebra"], "ties break alphabetically for a stable render");

  // Zero-value rows still bucket, with a 0 share rather than NaN.
  const zeroes = breakdownBy(
    [{ reason: "other", disposition: null, refundMinorUnits: 0, quantity: 1 }],
    "reason",
  );
  eq(zeroes[0].share, 0, "zero total yields 0 share, never NaN");
  ok(Number.isFinite(zeroes[0].share), "share is finite");

  const byDisp = breakdownBy(rows, "disposition");
  eq(byDisp[0].key, "destroy", "disposition groups too");
  eq(byDisp.find((d) => d.key === "restock")?.refundMinor, 1000, "restock bucket found");

  // ── humanizeKey ───────────────────────────────────────────────────────────
  eq(humanizeKey("customer_changed_mind"), "Changed mind", "mapped label wins");
  eq(humanizeKey("some_new_reason"), "Some New Reason", "unmapped key is title-cased, not shown raw");
  eq(humanizeKey(""), "Unspecified", "empty key is labelled");
  eq(humanizeKey("   "), "Unspecified", "whitespace key is labelled");

  // ── units + restock share ─────────────────────────────────────────────────
  eq(totalReturnedUnits(rows), 4.5, "fractional grams sum correctly");
  eq(totalReturnedUnits([]), 0, "no rows is 0 units");
  eq(
    totalReturnedUnits([{ reason: null, disposition: null, refundMinorUnits: 0, quantity: -5 }]),
    0,
    "negative quantity ignored",
  );
  ok(Math.abs(restockShare(rows)! - 1000 / 9500) < 1e-9, "restock share is by value");
  eq(restockShare([]), null, "no rows yields null restock share, not 0");
  eq(
    restockShare([{ reason: null, disposition: "RESTOCK", refundMinorUnits: 100, quantity: 1 }]),
    1,
    "disposition match is case-insensitive",
  );

  return { passed };
}
