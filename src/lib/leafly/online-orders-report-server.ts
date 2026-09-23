/**
 * src/lib/leafly/online-orders-report-server.ts
 *
 * SLICE 8 (round L-24) — the DATA half of the Online Orders report.
 *
 * This module does exactly two things: read rows, and hand them to the pure
 * core. Every judgement — what counts as a lost order, what "lifecycle reach"
 * means, how a rate behaves over an empty denominator — lives in
 * `online-orders-report-core.ts`, where it can be tested without a database.
 *
 *
 * WHY THE PACIFIC CONVERSION HAPPENS HERE AND NOT IN THE CORE
 * -----------------------------------------------------------
 * The core buckets daily volume by slicing the first ten characters off a
 * timestamp. That is only correct if the timestamp it receives is already
 * Pacific wall time. Postgres hands back UTC, and Port Orchard is 7–8 hours
 * behind it, so a 5pm Tuesday order arrives as Wednesday 00:00Z and would land
 * on the wrong day of the owner's week — every single evening order, silently.
 *
 * House rule 9: business-day logic uses the store's clock. So this module
 * converts to a Pacific day key BEFORE the core sees it, using the same
 * `pacificDayKey` helper the rest of the reporting suite uses. Keeping the
 * conversion here also keeps the core import-free, which is what lets it run
 * in the self-test harness with no module graph.
 *
 *
 * WHY THE QUERY NAMES ITS COLUMNS
 * -------------------------------
 * `select("*")` would work today and break quietly later: `raw_order` is a
 * jsonb blob containing the shopper's name, date of birth, email, phone and
 * medical card number. A report has no use for any of it, and pulling PII into
 * a page that renders aggregate counts is how PII ends up somewhere it was
 * never meant to be. The column list is explicit and deliberately excludes it.
 * (`order-board-server.ts` makes the same choice for the same reason.)
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { describeIncompleteness } from "@/lib/supabase/complete-read-plan-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  buildOnlineOrdersReport,
  type OnlineOrdersReport,
  type ReportAttemptRow,
  type ReportOrderRow,
} from "./online-orders-report-core";

/**
 * Named, and deliberately NOT `*`. See the header note on PII.
 *
 * `raw_order` is excluded on purpose. The only field a report would want from
 * it is the order total, and that is read separately below through a narrow
 * accessor rather than by dragging the whole customer record into memory.
 */
const REPORT_ORDER_COLUMNS = [
  "leafly_order_id",
  "leafly_status",
  "fulfillment_mechanism",
  "marketplace",
  "medical_status",
  "payment_preference",
  "acknowledge_by",
  "acknowledged_at",
  "canceled_at",
  "cancelation_reason_code",
  "local_order_id",
  "first_seen_at",
  "announced_at",
  "printed_at",
  "raw_order",
].join(", ");

const REPORT_ATTEMPT_COLUMNS = [
  "leafly_order_id",
  "operation",
  "requested_status",
  "response_status",
  "disposition",
  "refusal_code",
  "attempted_at",
].join(", ");

type RawOrderRow = {
  leafly_order_id: string | null;
  leafly_status: string | null;
  fulfillment_mechanism: string | null;
  marketplace: string | null;
  medical_status: string | null;
  payment_preference: string | null;
  acknowledge_by: string | null;
  acknowledged_at: string | null;
  canceled_at: string | null;
  cancelation_reason_code: string | null;
  local_order_id: string | null;
  first_seen_at: string | null;
  announced_at: string | null;
  printed_at: string | null;
  raw_order: unknown;
};

type RawAttemptRow = {
  leafly_order_id: string | null;
  operation: string | null;
  requested_status: string | null;
  response_status: number | null;
  disposition: string | null;
  refusal_code: string | null;
  attempted_at: string | null;
};

/**
 * Pull ONLY the total out of the stored payload.
 *
 * Narrow on purpose: `raw_order` holds the shopper's name, date of birth,
 * email, phone and medical card number, and none of that should travel any
 * further than this function. Returns the raw value rather than a number so
 * the core's decimal-text money parser can do the rounding — converting here
 * with `Number()` would reintroduce exactly the IEEE 754 half-cent defect the
 * core exists to avoid.
 *
 * `totalWithTip` is preferred over `total` when present because it is what the
 * shopper actually agreed to pay, and it is the figure that reconciles against
 * the register.
 */
function readOrderTotal(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.totalWithTip !== undefined && o.totalWithTip !== null) return o.totalWithTip;
  if (o.total !== undefined && o.total !== null) return o.total;
  return null;
}

/**
 * Convert a UTC timestamp to a Pacific day key, preserving a usable time part.
 *
 * The core only reads the first ten characters (the date), but returning a
 * full ISO-shaped string keeps `msBetween` working for the acknowledgement
 * timings, which must stay in true UTC instants — a duration is a duration in
 * any zone, and converting those would be wrong.
 */
function toPacificDayStamp(iso: string | null): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return pacificDayKey(iso);
}

export type OnlineOrdersReportResult = {
  ok: boolean;
  report: OnlineOrdersReport;
  /** Human-readable explanation when something prevented a full read. */
  notice: string | null;
};

const EMPTY_REPORT: OnlineOrdersReport = buildOnlineOrdersReport({ orders: [] });

/**
 * One page per round trip. Kept BELOW PostgREST's db.max_rows of 1,000 so a
 * short page always means "end of data" and never "the server clamped you" —
 * the two are indistinguishable at exactly 1,000, which is the ambiguity that
 * made the original `.limit(5000)` silently wrong.
 */
const REPORT_PAGE_SIZE = 500;

/**
 * A ceiling, so a mis-typed date range cannot try to pull the entire table
 * into a web request. Reaching it is reported as an incomplete read rather
 * than silently truncated — `pagedAllChecked` sets `hitCeiling` and the
 * verdict turns into an on-screen caveat.
 */
const REPORT_MAX_ROWS = 20_000;

/**
 * Load and build the Online Orders report for a window.
 *
 * NEVER THROWS. A report page that 500s tells the owner nothing; a report page
 * that renders zeroes with an explanation tells him the database is
 * unreachable, which is a different and more useful fact.
 */
export async function getOnlineOrdersReport(input: {
  fromISO: string;
  toISO: string;
}): Promise<OnlineOrdersReportResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      report: EMPTY_REPORT,
      notice:
        "The database is not connected, so no online-order history could be read. " +
        "This is a configuration problem, not an empty week.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();

    // Orders in the window, by FIRST SEEN — the moment Leafly told us. Not by
    // acknowledgement, which would drop the orders we never acknowledged, and
    // those are precisely the ones this report exists to count.
    // PAGED, NOT `.limit(5000)`. PostgREST clamps any single response at
    // db.max_rows (1,000 here) and raises NO error when it does — the caller
    // simply receives fewer rows and believes it has them all. On this
    // particular report that failure mode is especially nasty: the rows it
    // would silently drop are the OLDEST in the window, so a busy month would
    // quietly under-report exactly the auto-cancelled orders the tab exists to
    // count, and the headline would read "0 orders lost" while orders were
    // being lost. `pagedAllChecked` walks the window in full and, crucially,
    // returns a VERDICT saying whether it managed to — so a partial read is
    // labelled on screen instead of being mistaken for a quiet week.
    //
    // This is the SLICE 5C rule, enforced mechanically by
    // tests/compliance/slice5c-cap-relevant-reads.test.ts. It caught this
    // exact line when the full suite ran.
    const orderPage = await pagedAllChecked<RawOrderRow>(
      async (from, to) => {
        const res = await admin
          .from("leafly_orders")
          .select(REPORT_ORDER_COLUMNS)
          .gte("first_seen_at", input.fromISO)
          .lte("first_seen_at", input.toISO)
          .order("first_seen_at", { ascending: true })
          .range(from, to);
        return {
          rows: ((res.data ?? []) as unknown as RawOrderRow[]) ?? [],
          ok: !res.error,
        };
      },
      { pageSize: REPORT_PAGE_SIZE, maxRows: REPORT_MAX_ROWS },
    );

    const attemptPage = await pagedAllChecked<RawAttemptRow>(
      async (from, to) => {
        const res = await admin
          .from("leafly_outbound_attempts")
          .select(REPORT_ATTEMPT_COLUMNS)
          .gte("attempted_at", input.fromISO)
          .lte("attempted_at", input.toISO)
          .order("attempted_at", { ascending: true })
          .range(from, to);
        return {
          rows: ((res.data ?? []) as unknown as RawAttemptRow[]) ?? [],
          ok: !res.error,
        };
      },
      { pageSize: REPORT_PAGE_SIZE, maxRows: REPORT_MAX_ROWS },
    );

    // A read that failed on its very FIRST page produced nothing, and
    // rendering zeroes for that is indistinguishable from a genuinely empty
    // week. Say so instead.
    if (!orderPage.verdict.complete && orderPage.rows.length === 0) {
      return {
        ok: false,
        report: EMPTY_REPORT,
        notice:
          "Could not read online orders — the database read failed. This is a " +
          "connection problem, not an empty week. Refresh to try again.",
      };
    }

    const rawOrders = orderPage.rows;
    const orders: ReportOrderRow[] = rawOrders.map((r) => ({
      leaflyOrderId: r.leafly_order_id,
      leaflyStatus: r.leafly_status,
      fulfillmentMechanism: r.fulfillment_mechanism,
      marketplace: r.marketplace,
      medicalStatus: r.medical_status,
      paymentPreference: r.payment_preference,
      // Durations stay in TRUE UTC instants — see toPacificDayStamp's note.
      acknowledgeBy: r.acknowledge_by,
      acknowledgedAt: r.acknowledged_at,
      canceledAt: r.canceled_at,
      cancelationReasonCode: r.cancelation_reason_code,
      localOrderId: r.local_order_id,
      // ...but the DAY BUCKET is Pacific, or every evening order lands on
      // tomorrow in the owner's own weekly view.
      firstSeenAt: toPacificDayStamp(r.first_seen_at),
      announcedAt: r.announced_at,
      printedAt: r.printed_at,
      totalRaw: readOrderTotal(r.raw_order),
    }));

    // The acknowledgement timings need the real UTC instants, which the
    // Pacific day key above has thrown away. Rather than carry two fields
    // through the core's row type, the timing sample is built from a second,
    // parallel row set that keeps the instants intact. Same rows, different
    // projection — no second query.
    const timingRows: ReportOrderRow[] = rawOrders.map((r) => ({
      acknowledgeBy: r.acknowledge_by,
      acknowledgedAt: r.acknowledged_at,
      firstSeenAt: r.first_seen_at,
    }));

    const attempts: ReportAttemptRow[] = attemptPage.rows.map((a) => ({
      leaflyOrderId: a.leafly_order_id,
      operation: a.operation,
      requestedStatus: a.requested_status,
      responseStatus: a.response_status,
      disposition: a.disposition,
      refusalCode: a.refusal_code,
      attemptedAt: a.attempted_at,
    }));

    const report = buildOnlineOrdersReport({ orders, attempts });

    // Overlay the UTC-accurate acknowledgement timings.
    const timing = buildOnlineOrdersReport({ orders: timingRows });
    report.acknowledgement = timing.acknowledgement;

    // An INCOMPLETE read must be labelled, never presented as fact. This
    // report is advisory (nobody acts on it automatically), so partial data is
    // allowed on screen — but only with the caveat attached, because every
    // number below is then a floor rather than a count.
    const ordersNotice = describeIncompleteness(orderPage.verdict, "online orders");
    const attemptsNotice = attemptPage.verdict.complete
      ? null
      : "Order history loaded, but the outbound call log could not be read in " +
        "full, so the delivery-health counts below are a floor, not a total.";

    const notice =
      [ordersNotice, attemptsNotice].filter((n): n is string => typeof n === "string").join(" ") ||
      null;

    return { ok: true, report, notice };
  } catch (err) {
    return {
      ok: false,
      report: EMPTY_REPORT,
      notice: `Could not build the report: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
}
