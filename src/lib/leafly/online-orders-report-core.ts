/**
 * src/lib/leafly/online-orders-report-core.ts
 *
 * SLICE 8 (round L-24) — the Online Orders report, as a PURE core.
 *
 * WHAT THIS IS
 * ------------
 * Every number on the Online Orders report tab is computed here, from plain
 * rows, with no database, no clock of its own, and no network. The server
 * module reads rows; this module decides what they MEAN. That split is what
 * makes the hard parts (percentiles, deadline arithmetic, divide-by-zero,
 * "0 of 0 is not 0%") testable without a Supabase instance.
 *
 *
 * WHY THIS REPORT EXISTS, AND WHY IT IS NOT "JUST ANOTHER SALES TAB"
 * -----------------------------------------------------------------
 * The existing report tabs measure MONEY. This one measures a CONTRACT.
 *
 * Leafly's Order API specification imposes two obligations that no sales
 * report can see, and that quietly cost real revenue when they are missed:
 *
 *   1. THE FIFTEEN-MINUTE CLOCK. Verbatim from the spec:
 *        "Orders are acknowledged as having been retrieved in whole by your
 *         system within fifteen minutes of receiving an order submission
 *         webhook. Any orders not acknowledged by this deadline will be auto
 *         canceled."
 *      An order lost this way is indistinguishable, in a sales report, from
 *      an order that was never placed. It shows up as nothing at all. The
 *      only place the loss is visible is `cancelation_reason_code =
 *      'order_api_unacknowledged'`, which this report surfaces as its own
 *      headline rather than burying inside a generic "cancelled" bucket.
 *
 *   2. THE LIFECYCLE OBLIGATION. Verbatim:
 *        "Order status updates correspond to an intuitive, smoothly
 *         progressing lifecycle. Not all statuses are required (as our
 *         systems might not have a clear 1:1 status mapping), but for
 *         example, supporting only direct movement to `picked_up` would not
 *         be allowed."
 *      Combined with the spec's other rule — that Leafly is the "sole
 *      originator of automated consumer facing communications" — this is the
 *      whole customer-notification story. The shopper hears from Leafly, and
 *      Leafly speaks when WE report a transition. A lifecycle that stalls at
 *      `confirmed` is therefore not a cosmetic data-quality issue: it is the
 *      reason a customer never learns their order is ready.
 *
 * So this core computes a metric the rest of the reporting suite has no
 * concept of: LIFECYCLE REACH — of the orders we accepted, how many ever got
 * a `ready` signal, and how many ever got `picked_up`. That single number
 * answers "why did my customer not hear anything?" with evidence instead of
 * speculation, and it is also the exact number Leafly reviews when granting
 * production access.
 *
 *
 * DESIGN RULES OBSERVED HERE
 * --------------------------
 * - ZERO imports. Pure core convention: this file must be runnable by the
 *   self-test harness with no module graph behind it. The one money helper it
 *   needs is re-derived locally rather than imported, and there is a test that
 *   proves the local copy AGREES with the shared one on a hostile corpus —
 *   proving a duplicate has not drifted is worth more than asserting it will
 *   not (the same discipline `parseStaffEmailList` uses in notify.ts).
 * - NO `new Date()`. Every function that needs "now" takes it as an argument,
 *   so tests are deterministic and a report can be recomputed for any instant.
 * - MISSING IS NOT ZERO. A rate over an empty denominator is `null`, never 0.
 *   "0% acknowledged on time" and "no orders yet" demand opposite reactions
 *   from the owner, and a report that renders them identically is lying.
 */

// ---------------------------------------------------------------------------
// Input row shapes — deliberately WIDER than the DB columns.
//
// Every field is optional/nullable because these rows come from a table whose
// own migration comments explain that almost everything is nullable by design
// (an unrecognised status must be recordable inside a handler that is
// contractually obliged to answer 200). A report that throws on a null is a
// report that goes blank exactly when something has gone wrong — which is the
// one moment it is needed.
// ---------------------------------------------------------------------------

export type ReportOrderRow = {
  leaflyOrderId?: string | null;
  leaflyStatus?: string | null;
  fulfillmentMechanism?: string | null;
  marketplace?: string | null;
  medicalStatus?: string | null;
  paymentPreference?: string | null;
  acknowledgeBy?: string | null;
  acknowledgedAt?: string | null;
  canceledAt?: string | null;
  cancelationReasonCode?: string | null;
  localOrderId?: string | null;
  firstSeenAt?: string | null;
  announcedAt?: string | null;
  printedAt?: string | null;
  /** Total in MAJOR units as Leafly sends it (e.g. "42.50"), or a number. */
  totalRaw?: unknown;
};

export type ReportAttemptRow = {
  leaflyOrderId?: string | null;
  operation?: string | null;
  requestedStatus?: string | null;
  responseStatus?: number | null;
  disposition?: string | null;
  refusalCode?: string | null;
  attemptedAt?: string | null;
};

// ---------------------------------------------------------------------------
// Vocabulary, taken from the spec's OrderStatus enum IN LIFECYCLE ORDER.
//
// Order matters: `LEAFLY_LIFECYCLE_ORDER` is what lets us ask "did this order
// ever get at least as far as X" without hard-coding comparisons at each call
// site. `canceled` and `expired` are NOT in this list because they are exits
// from the lifecycle, not points along it — ranking them would make
// "progressed further than confirmed" true for a cancelled order.
// ---------------------------------------------------------------------------

export const LEAFLY_LIFECYCLE_ORDER = [
  "pending",
  "confirmed",
  "ready",
  "out_for_delivery",
  "arrived_at_customer",
  "picked_up",
] as const;

export type LeaflyLifecycleStatus = (typeof LEAFLY_LIFECYCLE_ORDER)[number];

/** Exits from the lifecycle. Not rankable, deliberately. */
export const LEAFLY_EXIT_STATUSES = ["canceled", "expired"] as const;

/**
 * Leafly's own reason code for "you missed the fifteen-minute window".
 *
 * Hard-coded as a named constant precisely because it must never be confused
 * with a customer changing their mind. Migration 0225's column comment makes
 * the same point: `order_api_unacknowledged` "means WE missed the 15-minute
 * window, so it must stay distinguishable from a customer changing their mind."
 */
export const AUTO_CANCEL_REASON_CODE = "order_api_unacknowledged";

/** Rank within the lifecycle, or -1 for anything that is not a lifecycle stop. */
export function lifecycleRank(status: string | null | undefined): number {
  if (typeof status !== "string") return -1;
  const i = (LEAFLY_LIFECYCLE_ORDER as readonly string[]).indexOf(status.trim());
  return i;
}

/** True when `status` is at or beyond `floor` in the documented lifecycle. */
export function reachedAtLeast(
  status: string | null | undefined,
  floor: LeaflyLifecycleStatus,
): boolean {
  const s = lifecycleRank(status);
  if (s < 0) return false;
  return s >= lifecycleRank(floor);
}

// ---------------------------------------------------------------------------
// Small numeric helpers, written out rather than reached for, because each one
// encodes a decision that a library would make differently.
// ---------------------------------------------------------------------------

/**
 * Money to minor units WITHOUT binary multiplication.
 *
 * `Math.round(1.005 * 100)` is `100`, not `101`, because 1.005 is stored as
 * 1.00499999999999989341858963598497211933135986328125. Multiplying first and
 * rounding after therefore loses a cent on a value that a human typed as
 * exact. This does the work on the DECIMAL TEXT instead, so the only rounding
 * is the one we perform deliberately.
 *
 * This mirrors `toMinorUnits` in order-detail-core.ts. It is duplicated rather
 * than imported to keep this core import-free; `__runOnlineOrdersReportTests`
 * contains a corpus test that fails if the two ever disagree.
 */
export function reportMoneyToMinor(value: unknown): number | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim().replace(/[$,\s]/g, "");
    if (text === "") return null;
  } else {
    return null;
  }
  if (/e/i.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    text = n.toFixed(4);
  }
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (m === null) return null;
  const [, sign, whole = "", frac = ""] = m;
  if (whole === "" && frac === "") return null;
  const cents = `${whole === "" ? "0" : whole}${frac.padEnd(2, "0").slice(0, 2)}`;
  let minor = Number(cents);
  if (!Number.isFinite(minor)) return null;
  const third = frac.length > 2 ? Number(frac[2]) : 0;
  if (Number.isFinite(third) && third >= 5) minor += 1;
  return sign === "-" ? -minor : minor;
}

/** Milliseconds between two ISO instants, or null if either is unusable. */
export function msBetween(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

/**
 * Nearest-rank percentile over a sorted-ascending array.
 *
 * Deliberately NOT interpolating. These samples are seconds-to-acknowledge
 * measured from real orders; an interpolated p95 reports a duration that never
 * happened, and the owner reads these as "how bad does it actually get".
 * Nearest-rank always returns an observation that genuinely occurred.
 */
export function percentileNearestRank(sortedAsc: number[], p: number): number | null {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  if (!Number.isFinite(p)) return null;
  const clamped = Math.min(Math.max(p, 0), 1);
  const rank = Math.ceil(clamped * sortedAsc.length);
  const idx = Math.min(Math.max(rank - 1, 0), sortedAsc.length - 1);
  return sortedAsc[idx];
}

/** Median. Even counts average the two middles; empty is null, not zero. */
export function medianOf(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

/**
 * A rate in 0..1, or NULL when the denominator is zero.
 *
 * This is the single most important helper in the file. Returning 0 for 0/0
 * would render "no orders this week" as "0% acknowledged on time" — a
 * five-alarm number for a week in which nothing whatsoever went wrong.
 */
export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// The report shape
// ---------------------------------------------------------------------------

export type CountedBreakdown = { key: string; label: string; count: number };

export type AcknowledgementPerformance = {
  /** Orders that carried a deadline AND were acknowledged — the measurable set. */
  measured: number;
  medianSeconds: number | null;
  p95Seconds: number | null;
  slowestSeconds: number | null;
  /** Acknowledged with time still on Leafly's clock. */
  onTime: number;
  /** Acknowledged, but after the deadline had already passed. */
  late: number;
  onTimeRate: number | null;
  /** Median seconds of headroom left when we acknowledged. Negative = late. */
  medianHeadroomSeconds: number | null;
};

export type LifecycleReach = {
  /** Orders we acknowledged — the only ones whose lifecycle we control. */
  acknowledged: number;
  reachedConfirmed: number;
  reachedReady: number;
  reachedPickedUp: number;
  confirmedRate: number | null;
  readyRate: number | null;
  pickedUpRate: number | null;
  /**
   * Acknowledged orders that never advanced past `confirmed` and are not
   * cancelled/expired — i.e. the shopper was told "the store has your order"
   * and then heard nothing further. This is the customer-notification gap,
   * expressed as a number.
   */
  stalledAtConfirmed: number;
};

export type OutboundHealth = {
  total: number;
  success: number;
  retry: number;
  fixConfig: number;
  fixRequest: number;
  gone: number;
  /** Attempts we declined to send at all (refusal_code populated). */
  refused: number;
  successRate: number | null;
  topRefusals: CountedBreakdown[];
};

export type OnlineOrdersReport = {
  totalOrders: number;
  acknowledgedOrders: number;
  /** Lost to the fifteen-minute clock. The headline that no sales tab shows. */
  autoCanceledOrders: number;
  otherCanceledOrders: number;
  autoCancelRate: number | null;
  /** Orders that reached the register (a local order exists). */
  bridgedToRegister: number;
  announced: number;
  printed: number;
  /** Sum of order totals, minor units, over rows that carried a readable total. */
  grossMinorUnits: number;
  ordersWithTotal: number;
  averageOrderMinorUnits: number | null;
  statusMix: CountedBreakdown[];
  fulfillmentMix: CountedBreakdown[];
  marketplaceMix: CountedBreakdown[];
  acknowledgement: AcknowledgementPerformance;
  lifecycle: LifecycleReach;
  outbound: OutboundHealth;
  dailyVolume: { date: string; orders: number; autoCanceled: number }[];
};

// ---------------------------------------------------------------------------
// Labels. Kept beside the vocabulary so a new status cannot appear on screen
// as a raw snake_case token nobody recognises.
// ---------------------------------------------------------------------------

const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: "Awaiting acknowledgement",
  confirmed: "Confirmed",
  ready: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  arrived_at_customer: "Arrived at customer",
  picked_up: "Picked up",
  canceled: "Cancelled",
  expired: "Expired",
};

const FULFILLMENT_LABEL: Readonly<Record<string, string>> = {
  pickup: "Pickup",
  delivery: "Delivery",
};

const MARKETPLACE_LABEL: Readonly<Record<string, string>> = {
  leafly: "Leafly",
  uberEats: "UberEats",
};

const REFUSAL_LABEL: Readonly<Record<string, string>> = {
  already_acknowledged: "Already acknowledged",
  not_acknowledged: "Not acknowledged yet",
  terminal_status: "Order already finished",
  same_status: "Already in that status",
  missing_config: "Credentials missing",
  no_order_id: "No Leafly order id",
};

export function labelForStatus(status: string | null | undefined): string {
  if (typeof status !== "string" || status.trim() === "") return "Unknown";
  return STATUS_LABEL[status.trim()] ?? status.trim();
}

/**
 * Tally a nullable text column into a stable, human-labelled breakdown.
 *
 * Sorted by count DESC then key ASC. The tie-break is not decoration: without
 * it the order of two equal buckets depends on Map insertion order, which
 * depends on row order, which depends on the database — and a report whose
 * rows reshuffle between identical loads looks broken to the person reading it.
 */
export function tally(
  rows: readonly ReportOrderRow[],
  pick: (r: ReportOrderRow) => string | null | undefined,
  labels: Readonly<Record<string, string>>,
): CountedBreakdown[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = pick(r);
    const key = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === "unknown" ? "Unknown" : (labels[key] ?? key),
      count,
    }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

/**
 * THE REPORT.
 *
 * Takes rows and returns numbers. No clock, no IO, no surprises.
 */
export function buildOnlineOrdersReport(input: {
  orders: readonly ReportOrderRow[];
  attempts?: readonly ReportAttemptRow[];
}): OnlineOrdersReport {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];

  let acknowledgedOrders = 0;
  let autoCanceledOrders = 0;
  let otherCanceledOrders = 0;
  let bridgedToRegister = 0;
  let announced = 0;
  let printed = 0;
  let grossMinorUnits = 0;
  let ordersWithTotal = 0;

  // Acknowledgement timing samples.
  const ackSeconds: number[] = [];
  const headroomSeconds: number[] = [];
  let onTime = 0;
  let late = 0;

  // Lifecycle reach.
  let reachedConfirmed = 0;
  let reachedReady = 0;
  let reachedPickedUp = 0;
  let stalledAtConfirmed = 0;

  const dayMap = new Map<string, { orders: number; autoCanceled: number }>();

  for (const r of orders) {
    const isAcknowledged = typeof r.acknowledgedAt === "string" && r.acknowledgedAt.trim() !== "";
    if (isAcknowledged) acknowledgedOrders += 1;

    const reason = typeof r.cancelationReasonCode === "string" ? r.cancelationReasonCode.trim() : "";
    const isCanceled =
      (typeof r.canceledAt === "string" && r.canceledAt.trim() !== "") ||
      r.leaflyStatus === "canceled" ||
      r.leaflyStatus === "expired";
    if (reason === AUTO_CANCEL_REASON_CODE) autoCanceledOrders += 1;
    else if (isCanceled) otherCanceledOrders += 1;

    if (typeof r.localOrderId === "string" && r.localOrderId.trim() !== "") bridgedToRegister += 1;
    if (typeof r.announcedAt === "string" && r.announcedAt.trim() !== "") announced += 1;
    if (typeof r.printedAt === "string" && r.printedAt.trim() !== "") printed += 1;

    const minor = reportMoneyToMinor(r.totalRaw);
    if (minor !== null) {
      grossMinorUnits += minor;
      ordersWithTotal += 1;
    }

    // Acknowledgement timing. Requires BOTH a first-seen instant and an
    // acknowledgement; an order acknowledged before we have a record of
    // seeing it is not a measurement, it is a clock problem.
    const elapsed = msBetween(r.firstSeenAt, r.acknowledgedAt);
    if (elapsed !== null && elapsed >= 0) ackSeconds.push(elapsed / 1000);

    // Headroom against LEAFLY'S OWN deadline, never a locally computed
    // first_seen + 15min. Migration 0225 is explicit that acknowledge_by is
    // "Leafly's OWN acknowledgement deadline ... Never computed locally",
    // because their clock is the one that decides whether a real customer's
    // order gets auto-cancelled.
    const headroom = msBetween(r.acknowledgedAt, r.acknowledgeBy);
    if (headroom !== null) {
      headroomSeconds.push(headroom / 1000);
      if (headroom >= 0) onTime += 1;
      else late += 1;
    }

    // Lifecycle reach, measured off the CURRENT status. A terminal `picked_up`
    // implies every earlier stop was passed, which is exactly what
    // `reachedAtLeast` encodes.
    if (reachedAtLeast(r.leaflyStatus, "confirmed")) reachedConfirmed += 1;
    if (reachedAtLeast(r.leaflyStatus, "ready")) reachedReady += 1;
    if (reachedAtLeast(r.leaflyStatus, "picked_up")) reachedPickedUp += 1;

    // The notification gap: acknowledged, sitting exactly at `confirmed`, and
    // not cancelled. The shopper was told the store has it, then nothing.
    if (isAcknowledged && r.leaflyStatus === "confirmed" && !isCanceled) {
      stalledAtConfirmed += 1;
    }

    // Daily volume, bucketed on the DATE PORTION of first_seen_at as supplied.
    // The server module is responsible for handing us Pacific-correct
    // timestamps; slicing here keeps the core free of timezone tables.
    if (typeof r.firstSeenAt === "string" && r.firstSeenAt.length >= 10) {
      const day = r.firstSeenAt.slice(0, 10);
      const cur = dayMap.get(day) ?? { orders: 0, autoCanceled: 0 };
      cur.orders += 1;
      if (reason === AUTO_CANCEL_REASON_CODE) cur.autoCanceled += 1;
      dayMap.set(day, cur);
    }
  }

  const sortedAck = [...ackSeconds].sort((a, b) => a - b);

  // Outbound health.
  let success = 0;
  let retry = 0;
  let fixConfig = 0;
  let fixRequest = 0;
  let gone = 0;
  let refused = 0;
  const refusalCounts = new Map<string, number>();
  for (const a of attempts) {
    switch (a.disposition) {
      case "success":
        success += 1;
        break;
      case "retry":
        retry += 1;
        break;
      case "fix_config":
        fixConfig += 1;
        break;
      case "fix_request":
        fixRequest += 1;
        break;
      case "gone":
        gone += 1;
        break;
      default:
        break;
    }
    const code = typeof a.refusalCode === "string" ? a.refusalCode.trim() : "";
    if (code !== "") {
      refused += 1;
      refusalCounts.set(code, (refusalCounts.get(code) ?? 0) + 1);
    }
  }

  const topRefusals = [...refusalCounts.entries()]
    .map(([key, count]) => ({ key, label: REFUSAL_LABEL[key] ?? key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))
    .slice(0, 6);

  return {
    totalOrders: orders.length,
    acknowledgedOrders,
    autoCanceledOrders,
    otherCanceledOrders,
    autoCancelRate: safeRate(autoCanceledOrders, orders.length),
    bridgedToRegister,
    announced,
    printed,
    grossMinorUnits,
    ordersWithTotal,
    averageOrderMinorUnits:
      ordersWithTotal > 0 ? Math.round(grossMinorUnits / ordersWithTotal) : null,
    statusMix: tally(orders, (r) => r.leaflyStatus, STATUS_LABEL),
    fulfillmentMix: tally(orders, (r) => r.fulfillmentMechanism, FULFILLMENT_LABEL),
    marketplaceMix: tally(orders, (r) => r.marketplace, MARKETPLACE_LABEL),
    acknowledgement: {
      measured: sortedAck.length,
      medianSeconds: medianOf(sortedAck),
      p95Seconds: percentileNearestRank(sortedAck, 0.95),
      slowestSeconds: sortedAck.length > 0 ? sortedAck[sortedAck.length - 1] : null,
      onTime,
      late,
      onTimeRate: safeRate(onTime, onTime + late),
      medianHeadroomSeconds: medianOf(headroomSeconds),
    },
    lifecycle: {
      acknowledged: acknowledgedOrders,
      reachedConfirmed,
      reachedReady,
      reachedPickedUp,
      confirmedRate: safeRate(reachedConfirmed, acknowledgedOrders),
      readyRate: safeRate(reachedReady, acknowledgedOrders),
      pickedUpRate: safeRate(reachedPickedUp, acknowledgedOrders),
      stalledAtConfirmed,
    },
    outbound: {
      total: attempts.length,
      success,
      retry,
      fixConfig,
      fixRequest,
      gone,
      refused,
      successRate: safeRate(success, attempts.length),
      topRefusals,
    },
    dailyVolume: [...dayMap.entries()]
      .map(([date, v]) => ({ date, orders: v.orders, autoCanceled: v.autoCanceled }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers. In the core (not the component) so they are testable
// and so two surfaces cannot format the same number two different ways.
// ---------------------------------------------------------------------------

/** A duration a human reads at a glance. Null stays an em dash, never "0s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const neg = seconds < 0;
  const s = Math.abs(Math.round(seconds));
  let out: string;
  if (s < 60) out = `${s}s`;
  else if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    out = r === 0 ? `${m}m` : `${m}m ${r}s`;
  } else {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    out = m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return neg ? `-${out}` : out;
}

/** A rate as a percentage. Null renders as an em dash — "no data", not "0%". */
export function formatRate(rate: number | null | undefined, digits = 0): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Minor units to money. Mirrors formatDetailMoney in order-detail-core.ts. */
export function formatReportMoney(minorUnits: number | null | undefined): string {
  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return "—";
  const negative = minorUnits < 0;
  const abs = Math.abs(Math.trunc(minorUnits));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${String(cents).padStart(2, "0")}`;
}

/**
 * ALERT_FREE_NOTE — the subtitle over the "Did the shop find out?" section.
 *
 * This constant exists because the owner drew a hard line, verbatim: "I don't
 * need an email sent to us, the back office dashboard, printer and speaker let
 * us know an order has been placed." That sentence is a design constraint, not
 * a preference, and it is easy for a future contributor to read this section —
 * three delivery channels with success counts — and conclude the obvious next
 * feature is "email the staff when one fails". It is not. The counts here exist
 * so a failure is VISIBLE, not so it can be mailed.
 *
 * It lives in the core rather than inline in the page for the same reason every
 * other string in this file does: one place, testable, and it cannot drift away
 * from the rationale recorded in `staff-alert-core.ts`, which encodes the same
 * rule in executable form (an alert fires only when these channels have ALL
 * failed and there is therefore no other way for the shop to learn).
 */
export const ALERT_FREE_NOTE =
  "The speaker, the ticket printer and the register are how the shop hears about an order — " +
  "not email. These counts are here so a silent failure shows up as a number instead of a " +
  "missed customer.";

/**
 * The one sentence the owner should read first.
 *
 * Returns the most actionable finding, or null when there is genuinely nothing
 * to say. Ordered by COST, not by severity-sounding words: losing orders to the
 * clock costs revenue today; a stalled lifecycle costs customer trust and
 * Leafly production access; everything else is informational.
 */
export function headlineFinding(report: OnlineOrdersReport): string | null {
  if (report.totalOrders === 0) return null;
  if (report.autoCanceledOrders > 0) {
    const n = report.autoCanceledOrders;
    return (
      `${n} order${n === 1 ? "" : "s"} auto-cancelled because the 15-minute ` +
      `acknowledgement window closed first. Those customers were told the ` +
      `store did not respond.`
    );
  }
  if (report.lifecycle.stalledAtConfirmed > 0) {
    const n = report.lifecycle.stalledAtConfirmed;
    return (
      `${n} acknowledged order${n === 1 ? "" : "s"} never moved past ` +
      `"Confirmed". Leafly only notifies the shopper when we report a status ` +
      `change, so ${n === 1 ? "that customer was" : "those customers were"} ` +
      `never told their order was ready.`
    );
  }
  if (report.acknowledgement.late > 0) {
    const n = report.acknowledgement.late;
    return `${n} order${n === 1 ? " was" : "s were"} acknowledged after Leafly's deadline had passed.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOnlineOrdersReportTests(): {
  passed: number;
  failed: number;
  messages: string[];
} {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, want: unknown) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(want);
    if (a === b) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label} (got ${a}, want ${b})`);
    }
  };

  // -- vocabulary -----------------------------------------------------------
  eq("six lifecycle stops", LEAFLY_LIFECYCLE_ORDER.length, 6);
  eq("pending is first", LEAFLY_LIFECYCLE_ORDER[0], "pending");
  eq("picked_up is last", LEAFLY_LIFECYCLE_ORDER[5], "picked_up");
  ok(
    "canceled is NOT a lifecycle stop",
    !(LEAFLY_LIFECYCLE_ORDER as readonly string[]).includes("canceled"),
  );
  ok(
    "expired is NOT a lifecycle stop",
    !(LEAFLY_LIFECYCLE_ORDER as readonly string[]).includes("expired"),
  );
  eq("two exit statuses", LEAFLY_EXIT_STATUSES.length, 2);
  eq("auto-cancel code is Leafly's own", AUTO_CANCEL_REASON_CODE, "order_api_unacknowledged");

  // -- lifecycleRank / reachedAtLeast ---------------------------------------
  eq("rank of pending", lifecycleRank("pending"), 0);
  eq("rank of picked_up", lifecycleRank("picked_up"), 5);
  eq("rank of canceled is -1", lifecycleRank("canceled"), -1);
  eq("rank of null is -1", lifecycleRank(null), -1);
  eq("rank of nonsense is -1", lifecycleRank("bananas"), -1);
  eq("rank trims whitespace", lifecycleRank("  ready  "), 2);
  ok("picked_up reached ready", reachedAtLeast("picked_up", "ready"));
  ok("ready reached ready", reachedAtLeast("ready", "ready"));
  ok("confirmed did NOT reach ready", !reachedAtLeast("confirmed", "ready"));
  ok("pending did not reach confirmed", !reachedAtLeast("pending", "confirmed"));
  // THE TRAP: a cancelled order must never count as progress.
  ok("canceled did NOT reach confirmed", !reachedAtLeast("canceled", "confirmed"));
  ok("expired did NOT reach confirmed", !reachedAtLeast("expired", "confirmed"));
  ok("null did not reach anything", !reachedAtLeast(null, "pending"));
  ok("delivery stops rank above ready", reachedAtLeast("out_for_delivery", "ready"));
  ok("arrived_at_customer is below picked_up", !reachedAtLeast("arrived_at_customer", "picked_up"));

  // -- money ----------------------------------------------------------------
  eq("plain dollars", reportMoneyToMinor("42.50"), 4250);
  eq("number input", reportMoneyToMinor(42.5), 4250);
  eq("integer string", reportMoneyToMinor("7"), 700);
  eq("strips currency symbols", reportMoneyToMinor("$1,234.56"), 123456);
  eq("negative", reportMoneyToMinor("-3.25"), -325);
  eq("null in, null out", reportMoneyToMinor(null), null);
  eq("undefined in, null out", reportMoneyToMinor(undefined), null);
  eq("empty string", reportMoneyToMinor("   "), null);
  eq("garbage", reportMoneyToMinor("abc"), null);
  eq("object", reportMoneyToMinor({}), null);
  eq("NaN", reportMoneyToMinor(NaN), null);
  eq("Infinity", reportMoneyToMinor(Infinity), null);
  eq("one decimal place pads", reportMoneyToMinor("5.1"), 510);
  eq("bare decimal", reportMoneyToMinor(".75"), 75);
  // THE SEPARATOR-ONLY INPUTS. Found by mutation testing, not by inspection:
  // a mutant that turned the "no digits at all" guard into `return 0` SURVIVED
  // the whole suite, because "" and "   " exit earlier and "abc" fails the
  // regex — so NOTHING in the corpus actually reached that branch. These four
  // are the only inputs that do, and a truncated payload really can produce a
  // lone separator. A missing total that renders as $0.00 is how a bag leaves
  // the counter without payment.
  eq("a lone decimal point is MISSING, not zero", reportMoneyToMinor("."), null);
  eq("a lone minus sign is MISSING, not zero", reportMoneyToMinor("-"), null);
  eq("minus-point is MISSING, not zero", reportMoneyToMinor("-."), null);
  eq("a lone currency symbol is MISSING, not zero", reportMoneyToMinor("$."), null);
  // THE IEEE 754 TRAP, demonstrated then defended.
  ok("the float trap is real", Math.round(1.005 * 100) === 100);
  eq("but we round the half cent UP", reportMoneyToMinor("1.005"), 101);
  eq("another float trap", reportMoneyToMinor("10.005"), 1001);
  eq("third decimal below half rounds down", reportMoneyToMinor("1.004"), 100);
  eq("19.99 survives", reportMoneyToMinor("19.99"), 1999);
  eq("exponent notation", reportMoneyToMinor("1e2"), 10000);

  // -- msBetween ------------------------------------------------------------
  eq(
    "elapsed ms",
    msBetween("2025-01-01T00:00:00.000Z", "2025-01-01T00:01:00.000Z"),
    60000,
  );
  eq("negative elapsed is preserved", msBetween("2025-01-01T00:01:00Z", "2025-01-01T00:00:00Z"), -60000);
  eq("null from", msBetween(null, "2025-01-01T00:00:00Z"), null);
  eq("null to", msBetween("2025-01-01T00:00:00Z", null), null);
  eq("unparseable", msBetween("not-a-date", "2025-01-01T00:00:00Z"), null);

  // -- percentile / median --------------------------------------------------
  eq("empty percentile is null", percentileNearestRank([], 0.95), null);
  eq("p95 of one", percentileNearestRank([5], 0.95), 5);
  eq("p100 is the max", percentileNearestRank([1, 2, 3, 4], 1), 4);
  eq("p0 is the min", percentileNearestRank([1, 2, 3, 4], 0), 1);
  // Nearest-rank never invents a value: p50 of [1,2,3,4] is an OBSERVATION.
  eq("p50 nearest-rank returns a real sample", percentileNearestRank([1, 2, 3, 4], 0.5), 2);
  eq("p95 of ten", percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  eq("percentile clamps above 1", percentileNearestRank([1, 2, 3], 5), 3);
  eq("percentile clamps below 0", percentileNearestRank([1, 2, 3], -5), 1);
  eq("NaN percentile is null", percentileNearestRank([1, 2, 3], NaN), null);
  eq("median empty", medianOf([]), null);
  eq("median odd", medianOf([3, 1, 2]), 2);
  eq("median even averages", medianOf([1, 2, 3, 4]), 2.5);
  eq("median does not mutate input order", (() => { const v = [3, 1, 2]; medianOf(v); return v; })(), [3, 1, 2]);

  // -- safeRate: THE most important helper ----------------------------------
  eq("half", safeRate(1, 2), 0.5);
  eq("zero over zero is NULL not 0", safeRate(0, 0), null);
  eq("anything over zero is null", safeRate(5, 0), null);
  eq("negative denominator is null", safeRate(1, -2), null);
  eq("NaN is null", safeRate(NaN, 2), null);

  // -- tally ----------------------------------------------------------------
  const tallied = tally(
    [
      { leaflyStatus: "pending" },
      { leaflyStatus: "pending" },
      { leaflyStatus: "picked_up" },
      { leaflyStatus: null },
      { leaflyStatus: "   " },
    ],
    (r) => r.leaflyStatus,
    STATUS_LABEL,
  );
  eq("tally groups", tallied[0], { key: "pending", label: "Awaiting acknowledgement", count: 2 });
  ok("tally buckets blanks as unknown", tallied.some((t) => t.key === "unknown" && t.count === 2));
  ok("tally labels unknown readably", tallied.some((t) => t.label === "Unknown"));
  // Deterministic tie-break, so the report does not reshuffle between loads.
  const tiedA = tally([{ marketplace: "zeta" }, { marketplace: "alpha" }], (r) => r.marketplace, {});
  const tiedB = tally([{ marketplace: "alpha" }, { marketplace: "zeta" }], (r) => r.marketplace, {});
  eq("equal counts sort deterministically regardless of row order", tiedA, tiedB);
  eq("alphabetical on ties", tiedA[0].key, "alpha");

  // -- labels ---------------------------------------------------------------
  eq("known status label", labelForStatus("picked_up"), "Picked up");
  eq("unknown status echoes itself", labelForStatus("brand_new_status"), "brand_new_status");
  eq("null status", labelForStatus(null), "Unknown");
  eq("blank status", labelForStatus("  "), "Unknown");

  // -- the empty report -----------------------------------------------------
  const empty = buildOnlineOrdersReport({ orders: [] });
  eq("empty total", empty.totalOrders, 0);
  eq("empty auto-cancel rate is NULL", empty.autoCancelRate, null);
  eq("empty average is NULL", empty.averageOrderMinorUnits, null);
  eq("empty ack median is NULL", empty.acknowledgement.medianSeconds, null);
  eq("empty on-time rate is NULL", empty.acknowledgement.onTimeRate, null);
  eq("empty lifecycle rate is NULL", empty.lifecycle.readyRate, null);
  eq("empty outbound rate is NULL", empty.outbound.successRate, null);
  eq("empty headline says nothing", headlineFinding(empty), null);
  eq("empty daily volume", empty.dailyVolume, []);
  // Defensive: non-array input must not throw.
  eq(
    "non-array orders tolerated",
    buildOnlineOrdersReport({ orders: undefined as unknown as ReportOrderRow[] }).totalOrders,
    0,
  );

  // -- a realistic mixed window ---------------------------------------------
  const report = buildOnlineOrdersReport({
    orders: [
      {
        // acknowledged quickly, completed
        leaflyOrderId: "a",
        leaflyStatus: "picked_up",
        fulfillmentMechanism: "pickup",
        marketplace: "leafly",
        firstSeenAt: "2025-03-01T10:00:00.000Z",
        acknowledgedAt: "2025-03-01T10:01:00.000Z",
        acknowledgeBy: "2025-03-01T10:15:00.000Z",
        localOrderId: "local-1",
        announcedAt: "2025-03-01T10:00:05.000Z",
        printedAt: "2025-03-01T10:00:06.000Z",
        totalRaw: "42.50",
      },
      {
        // acknowledged, then stalled at confirmed — the notification gap
        leaflyOrderId: "b",
        leaflyStatus: "confirmed",
        fulfillmentMechanism: "pickup",
        marketplace: "leafly",
        firstSeenAt: "2025-03-01T11:00:00.000Z",
        acknowledgedAt: "2025-03-01T11:05:00.000Z",
        acknowledgeBy: "2025-03-01T11:15:00.000Z",
        totalRaw: "20.00",
      },
      {
        // LOST to the fifteen-minute clock
        leaflyOrderId: "c",
        leaflyStatus: "canceled",
        fulfillmentMechanism: "delivery",
        marketplace: "uberEats",
        firstSeenAt: "2025-03-02T09:00:00.000Z",
        canceledAt: "2025-03-02T09:15:00.000Z",
        cancelationReasonCode: AUTO_CANCEL_REASON_CODE,
        totalRaw: "31.00",
      },
      {
        // cancelled by the customer — NOT our fault, must not be conflated
        leaflyOrderId: "d",
        leaflyStatus: "canceled",
        firstSeenAt: "2025-03-02T12:00:00.000Z",
        canceledAt: "2025-03-02T12:30:00.000Z",
        cancelationReasonCode: "customer",
        acknowledgedAt: "2025-03-02T12:02:00.000Z",
        acknowledgeBy: "2025-03-02T12:15:00.000Z",
      },
      {
        // acknowledged LATE — after Leafly's deadline
        leaflyOrderId: "e",
        leaflyStatus: "ready",
        firstSeenAt: "2025-03-03T08:00:00.000Z",
        acknowledgedAt: "2025-03-03T08:20:00.000Z",
        acknowledgeBy: "2025-03-03T08:15:00.000Z",
        totalRaw: "10.25",
      },
    ],
    attempts: [
      { operation: "acknowledge", disposition: "success" },
      { operation: "status", requestedStatus: "confirmed", disposition: "success" },
      { operation: "status", requestedStatus: "ready", disposition: "retry" },
      { operation: "status", disposition: null, refusalCode: "already_acknowledged" },
      { operation: "status", disposition: null, refusalCode: "already_acknowledged" },
      { operation: "cart", disposition: "fix_request" },
    ],
  });

  eq("total orders", report.totalOrders, 5);
  eq("acknowledged", report.acknowledgedOrders, 4);
  eq("auto-cancelled counted separately", report.autoCanceledOrders, 1);
  eq("customer cancellation is NOT auto-cancel", report.otherCanceledOrders, 1);
  eq("auto-cancel rate", report.autoCancelRate, 1 / 5);
  eq("bridged to register", report.bridgedToRegister, 1);
  eq("announced", report.announced, 1);
  eq("printed", report.printed, 1);
  eq("orders with a readable total", report.ordersWithTotal, 4);
  eq("gross minor units", report.grossMinorUnits, 4250 + 2000 + 3100 + 1025);
  eq("average order", report.averageOrderMinorUnits, Math.round((4250 + 2000 + 3100 + 1025) / 4));

  // Acknowledgement timing: samples are 60s, 300s, 120s, 1200s (order d & e).
  eq("measured acknowledgements", report.acknowledgement.measured, 4);
  eq("median seconds", report.acknowledgement.medianSeconds, (120 + 300) / 2);
  eq("slowest", report.acknowledgement.slowestSeconds, 1200);
  eq("p95 is a real observation", report.acknowledgement.p95Seconds, 1200);
  eq("on time", report.acknowledgement.onTime, 3);
  eq("late", report.acknowledgement.late, 1);
  eq("on-time rate", report.acknowledgement.onTimeRate, 3 / 4);
  // Headroom: +840, +600, +780, -300 -> median of sorted [-300,600,780,840]
  eq("median headroom", report.acknowledgement.medianHeadroomSeconds, (600 + 780) / 2);

  // Lifecycle reach.
  eq("reached confirmed", report.lifecycle.reachedConfirmed, 3); // picked_up, confirmed, ready
  eq("reached ready", report.lifecycle.reachedReady, 2); // picked_up, ready
  eq("reached picked_up", report.lifecycle.reachedPickedUp, 1);
  eq("confirmed rate over acknowledged", report.lifecycle.confirmedRate, 3 / 4);
  eq("ready rate", report.lifecycle.readyRate, 2 / 4);
  eq("picked-up rate", report.lifecycle.pickedUpRate, 1 / 4);
  eq("stalled at confirmed", report.lifecycle.stalledAtConfirmed, 1);

  // Outbound health.
  eq("outbound total", report.outbound.total, 6);
  eq("outbound success", report.outbound.success, 2);
  eq("outbound retry", report.outbound.retry, 1);
  eq("outbound fix_request", report.outbound.fixRequest, 1);
  eq("outbound refused", report.outbound.refused, 2);
  eq("outbound success rate", report.outbound.successRate, 2 / 6);
  eq("top refusal", report.outbound.topRefusals[0], {
    key: "already_acknowledged",
    label: "Already acknowledged",
    count: 2,
  });

  // Daily volume, ascending by date.
  eq("three days", report.dailyVolume.length, 3);
  eq("first day", report.dailyVolume[0], { date: "2025-03-01", orders: 2, autoCanceled: 0 });
  eq("second day carries the loss", report.dailyVolume[1], {
    date: "2025-03-02",
    orders: 2,
    autoCanceled: 1,
  });
  ok(
    "days are sorted ascending",
    report.dailyVolume.every((d, i, arr) => i === 0 || arr[i - 1].date <= d.date),
  );

  // Status mix must cover every row exactly once.
  eq(
    "status mix totals the order count",
    report.statusMix.reduce((sum, s) => sum + s.count, 0),
    5,
  );
  eq(
    "fulfillment mix totals the order count",
    report.fulfillmentMix.reduce((sum, s) => sum + s.count, 0),
    5,
  );

  // -- headline ordering: cost, not vocabulary ------------------------------
  const headline = headlineFinding(report);
  ok("headline mentions the auto-cancel first", headline !== null && headline.includes("auto-cancelled"));
  ok("headline names the 15-minute window", headline !== null && headline.includes("15-minute"));
  const stalledOnly = buildOnlineOrdersReport({
    orders: [
      {
        leaflyStatus: "confirmed",
        acknowledgedAt: "2025-03-01T10:01:00.000Z",
        firstSeenAt: "2025-03-01T10:00:00.000Z",
      },
    ],
  });
  const h2 = headlineFinding(stalledOnly);
  ok("stalled headline explains Leafly notifies on OUR status change", h2 !== null && h2.includes("Leafly only notifies"));
  ok("stalled headline is singular for one order", h2 !== null && h2.includes("1 acknowledged order "));
  const cleanRun = buildOnlineOrdersReport({
    orders: [
      {
        leaflyStatus: "picked_up",
        acknowledgedAt: "2025-03-01T10:01:00.000Z",
        acknowledgeBy: "2025-03-01T10:15:00.000Z",
        firstSeenAt: "2025-03-01T10:00:00.000Z",
      },
    ],
  });
  eq("a clean window has no headline", headlineFinding(cleanRun), null);

  // -- formatters -----------------------------------------------------------
  eq("seconds", formatDuration(45), "45s");
  eq("minutes", formatDuration(120), "2m");
  eq("minutes and seconds", formatDuration(125), "2m 5s");
  eq("hours", formatDuration(7200), "2h");
  eq("hours and minutes", formatDuration(7860), "2h 11m");
  eq("negative duration keeps its sign", formatDuration(-90), "-1m 30s");
  eq("null duration is an em dash", formatDuration(null), "—");
  eq("NaN duration is an em dash", formatDuration(NaN), "—");
  eq("zero seconds is still zero", formatDuration(0), "0s");
  eq("rate", formatRate(0.756), "76%");
  eq("rate with digits", formatRate(0.756, 1), "75.6%");
  eq("null rate is an em dash NOT 0%", formatRate(null), "—");
  eq("zero rate really is 0%", formatRate(0), "0%");
  eq("money", formatReportMoney(123456), "$1,234.56");
  eq("money zero", formatReportMoney(0), "$0.00");
  eq("money negative", formatReportMoney(-500), "-$5.00");
  eq("null money is an em dash NOT $0.00", formatReportMoney(null), "—");
  eq("money groups millions", formatReportMoney(123456789), "$1,234,567.89");

  // -- the duplication guard ------------------------------------------------
  // `reportMoneyToMinor` duplicates order-detail-core's `toMinorUnits` so this
  // core can stay import-free. A duplicate that silently drifts is worse than
  // no duplicate at all, so the vitest suite compares them on this corpus.
  // Here we at least pin the corpus itself so both sides test the same inputs.
  const MONEY_CORPUS = __MONEY_CORPUS;
  eq("money corpus is pinned", MONEY_CORPUS.length, 26);
  // The separator-only inputs must be IN the shared corpus, not just tested
  // locally, so the cross-core drift check exercises them too.
  ok("corpus includes the lone decimal point", MONEY_CORPUS.includes("."));
  ok("corpus includes the lone minus sign", MONEY_CORPUS.includes("-"));
  ok(
    "every corpus entry yields a number or null, never a throw",
    MONEY_CORPUS.every((v) => {
      const r = reportMoneyToMinor(v);
      return r === null || (typeof r === "number" && Number.isFinite(r));
    }),
  );

  return { passed, failed, messages };
}

/**
 * Exported for the vitest suite's drift check against order-detail-core.
 *
 * The last four entries ("." "-" "-." "$.") were added AFTER a mutation run
 * proved they were the only inputs that reach the "parsed, but no digits at
 * all" branch — every other malformed value exits earlier. They are the
 * difference between a missing total showing as "—" and showing as "$0.00".
 */
export const __MONEY_CORPUS: readonly unknown[] = [
  "0", "0.00", "1", "1.005", "1.004", "10.005", "19.99", "42.50", "$1,234.56",
  "-3.25", ".75", "5.1", "1e2", "", "   ", "abc", null, undefined, NaN, Infinity, {}, 42.5,
  ".", "-", "-.", "$.",
];
