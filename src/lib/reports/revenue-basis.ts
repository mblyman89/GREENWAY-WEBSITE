/**
 * src/lib/reports/revenue-basis.ts
 *
 * PURE, single source of truth for WHICH orders count as revenue on the
 * internal operational reports (GW-015).
 *
 * The decision (made once, applied everywhere): revenue = COMPLETED orders
 * only. This store captures no online payment — money only changes hands when
 * an order reaches `completed` at pickup / POS. A `no_show` order or an order
 * stuck in `ready` (e.g. an exception order the completion gate refused)
 * never collected a cent, so it must not count toward gross revenue, AOV,
 * COGS revenue, customer classification, or the revenue forecast.
 *
 * This also makes the internal dashboards' "gross" tie to the tax report's
 * completed-basis gross (docs/PERIOD_BASIS.md) on the status axis. The
 * operational reports intentionally KEEP `placed_at` day-bucketing — they
 * answer "what happened in the shop that day", not "what do we owe the
 * state" — only the STATUS filter changes here.
 *
 * No imports; embedded self-tests follow the repo's pure-core pattern.
 */

/** The one status whose orders carry real, collected revenue. */
export const REVENUE_STATUS = "completed";

/** True when an order with this status counts as revenue on internal reports. */
export function isRevenueOrder(status: string): boolean {
  return status === REVENUE_STATUS;
}

/** UI label describing the revenue basis, shown wherever gross is displayed. */
export const REVENUE_BASIS_LABEL = "completed orders";

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runRevenueBasisTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`revenue-basis self-test failed: ${name}`);
  };

  // The full order-status universe (src/lib/orders/types.ts) — exactly ONE
  // status carries revenue.
  ok("completed counts", isRevenueOrder("completed") === true);
  ok("new does not count (not yet paid)", isRevenueOrder("new") === false);
  ok("acknowledged does not count", isRevenueOrder("acknowledged") === false);
  ok("preparing does not count", isRevenueOrder("preparing") === false);
  ok("ready does not count (money not yet taken)", isRevenueOrder("ready") === false);
  ok("cancelled does not count", isRevenueOrder("cancelled") === false);
  ok("no_show does not count (GW-015 core case)", isRevenueOrder("no_show") === false);

  // Defensive: unknown/garbage statuses never count as money.
  ok("empty string does not count", isRevenueOrder("") === false);
  ok("unknown status does not count", isRevenueOrder("refunded") === false);
  ok("case matters (DB enum is lowercase)", isRevenueOrder("Completed") === false);

  // Pinned so a UI copy edit can't silently detach from the policy.
  ok("basis label pinned", REVENUE_BASIS_LABEL === "completed orders");
  ok("revenue status pinned", REVENUE_STATUS === "completed");
}
