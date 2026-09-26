/**
 * src/lib/leafly/online-orders-report-server.ts
 *
 * The DATA half of the Online Orders report. Reads rows and hands them to
 * the two pure cores:
 *
 *   - `online-orders-report-core.ts`  the Leafly CONTRACT (15-minute clock,
 *                                     lifecycle reach, outbound calls).
 *   - `reports/online-orders-channels-core.ts`
 *                                     the ALL-CHANNELS comparison, website
 *                                     vs Leafly (ONLINE ORDERS ALL-CHANNELS).
 *
 * Every judgement lives in those cores, where it is tested without a
 * database.
 *
 *
 * WHAT CHANGED IN THE ALL-CHANNELS SLICE, AND WHY
 * -----------------------------------------------
 * The owner saw "23 online orders" and "$33,700.00 order value, avg
 * $3,744.44 over 9" and said the ratio was way off. It was, for three
 * reasons, all fixed here:
 *
 *   1. MONEY WAS 100x. Leafly's `Order.total` is already minor units; the old
 *      `readOrderTotal` handed it to a decimal-dollar parser. It now goes
 *      through the channels core's integer-only reader, and only from a
 *      payload that IS the real Order (has `id`), never a webhook envelope.
 *      `total` is used, not `totalWithTip`: the register collects `total`
 *      (bridge-core: "the tip is not ours"); tip is reported on its own.
 *   2. WEBSITE ORDERS WERE MISSING. This file now also reads `orders`, keeping
 *      only real website orders (not register sales, not Leafly copies).
 *   3. 14 OF 23 LEAFLY ROWS HAD NO VALUE. Their `raw_order` held a webhook
 *      envelope. When the payload is missing, the order's local register copy
 *      (built from that same `total` when the order was accepted) is used and
 *      labelled as such; otherwise the order is counted as "value unknown",
 *      on screen, never as $0. The cause is fixed at source in
 *      `webhookMayWriteRawOrder` (webhook-parse-core.ts).
 *
 *
 * PACIFIC TIME
 * ------------
 * House rule 9. Day, hour and weekday buckets are Pacific and computed HERE,
 * so the cores stay import-free. Durations stay true UTC instants.
 *
 *
 * PII
 * ---
 * `raw_order` and customer contact fields are read into this function only.
 * What leaves it is an opaque SHA-256 prefix for "same customer?" and the
 * cart lines' product names. No name, phone, email or birth date reaches the
 * page.
 */
import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { describeIncompleteness } from "@/lib/supabase/complete-read-plan-core";
import { addPacificDays, pacificDayKey, pacificHour, storeWeekday } from "@/lib/reports/timezone";
import { REGISTER_PICKED_UP_NOTE_PREFIX } from "@/lib/pos/pickup-progress-core";
import {
  buildOnlineOrdersReport,
  type OnlineOrdersReport,
  type ReportAttemptRow,
  type ReportOrderRow,
} from "./online-orders-report-core";
import {
  buildOnlineChannelsReport,
  contactIdentity,
  intMinorOrNull,
  isWebsiteOrderRow,
  leaflyOutcome,
  readLeaflyPayloadFacts,
  websiteOutcome,
  type ChannelLine,
  type ChannelOrderRow,
  type OnlineChannelsReport,
} from "@/lib/reports/online-orders-channels-core";

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
  // Read ONLY to extract totals, cart lines and a hashed identity inside
  // this function. See the PII note above.
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

/**
 * Website orders. Named columns only. `customer_email`/`customer_phone` are
 * read solely to derive the hashed identity and never leave this file.
 */
const WEBSITE_ORDER_COLUMNS = [
  "id",
  "status",
  "origin",
  "staff_note",
  "pos_client_uuid",
  "placed_at",
  "acknowledged_at",
  "ready_at",
  "completed_at",
  "total_minor_units",
  "estimated_tax_minor_units",
  "savings_minor_units",
  "loyalty_discount_minor_units",
  "item_count",
  "customer_id",
  "customer_email",
  "customer_phone",
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

type WebsiteRow = {
  id: string;
  status: string | null;
  origin: string | null;
  staff_note: string | null;
  pos_client_uuid: string | null;
  placed_at: string | null;
  acknowledged_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  total_minor_units: number | null;
  estimated_tax_minor_units: number | null;
  savings_minor_units: number | null;
  loyalty_discount_minor_units: number | null;
  item_count: number | null;
  customer_id: string | null;
  customer_email: string | null;
  customer_phone: string | null;
};

type LocalCopyRow = {
  id: string;
  status: string | null;
  total_minor_units: number | null;
  item_count: number | null;
  completed_at: string | null;
};

type PickupEventRow = { order_id: string; created_at: string | null };
type LineRow = { order_id: string; product_name: string | null; brand: string | null; quantity: number | null; price_minor_units: number | null };

function toPacificDayStamp(iso: string | null): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  if (!Number.isFinite(Date.parse(iso))) return null;
  return pacificDayKey(iso);
}

function pacificBuckets(iso: string | null): { dayKey: string | null; hour: number | null; weekday: number | null } {
  if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso))) return { dayKey: null, hour: null, weekday: null };
  return { dayKey: pacificDayKey(iso), hour: pacificHour(iso), weekday: storeWeekday(iso) };
}

/** Opaque "same customer?" key. A SHA-256 prefix, never the contact itself. */
function hashKey(identity: string | null): string | null {
  if (identity === null) return null;
  return createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24);
}

/** Every Pacific day in the window, oldest first, capped at 400 days. */
export function windowDayKeys(fromDate: string | null | undefined, toDate: string | null | undefined): string[] {
  if (typeof fromDate !== "string" || typeof toDate !== "string") return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) return [];
  const out: string[] = [];
  let d = fromDate;
  while (d <= toDate && out.length < 400) {
    out.push(d);
    d = addPacificDays(d, 1);
  }
  return out;
}

export type OnlineOrdersReportResult = {
  ok: boolean;
  report: OnlineOrdersReport;
  channels: OnlineChannelsReport;
  notice: string | null;
};

const EMPTY_REPORT: OnlineOrdersReport = buildOnlineOrdersReport({ orders: [] });
const EMPTY_CHANNELS: OnlineChannelsReport = buildOnlineChannelsReport({ orders: [] });

/** Below PostgREST's db.max_rows of 1,000, so a short page means end of data. */
const REPORT_PAGE_SIZE = 500;
/** A ceiling; reaching it is reported on screen, never silently truncated. */
const REPORT_MAX_ROWS = 20_000;
/** `.in()` chunk size for the id-keyed follow-up reads. */
const ID_CHUNK = 200;

/**
 * Load both halves of the report for a window.
 *
 * NEVER THROWS. A report page that 500s tells the owner nothing.
 */
export async function getOnlineOrdersReport(input: {
  fromISO: string;
  toISO: string;
  fromDate?: string;
  toDate?: string;
}): Promise<OnlineOrdersReportResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      report: EMPTY_REPORT,
      channels: EMPTY_CHANNELS,
      notice:
        "The database is not connected, so no online-order history could be read. " +
        "This is a configuration problem, not an empty week.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const partial: string[] = [];

    // Leafly orders, by FIRST SEEN. Paged (SLICE 5C rule).
    const orderPage = await pagedAllChecked<RawOrderRow>(
      async (from, to) => {
        const res = await admin
          .from("leafly_orders")
          .select(REPORT_ORDER_COLUMNS)
          .gte("first_seen_at", input.fromISO)
          .lte("first_seen_at", input.toISO)
          .order("first_seen_at", { ascending: true })
          .order("leafly_order_id", { ascending: true })
          .range(from, to);
        return { rows: ((res.data ?? []) as unknown as RawOrderRow[]) ?? [], ok: !res.error };
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
        return { rows: ((res.data ?? []) as unknown as RawAttemptRow[]) ?? [], ok: !res.error };
      },
      { pageSize: REPORT_PAGE_SIZE, maxRows: REPORT_MAX_ROWS },
    );

    // Website orders, by PLACED AT. The server-side filter drops the bulk of
    // register sales (origin 'greenway' + pos_client_uuid set); the pure
    // `isWebsiteOrderRow` then drops pre-0128 sales by their staff note.
    const websitePage = await pagedAllChecked<WebsiteRow>(
      async (from, to) => {
        const res = await admin
          .from("orders")
          .select(WEBSITE_ORDER_COLUMNS)
          .eq("origin", "greenway")
          .is("pos_client_uuid", null)
          .gte("placed_at", input.fromISO)
          .lte("placed_at", input.toISO)
          .order("placed_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: ((res.data ?? []) as unknown as WebsiteRow[]) ?? [], ok: !res.error };
      },
      { pageSize: REPORT_PAGE_SIZE, maxRows: REPORT_MAX_ROWS },
    );

    if (!orderPage.verdict.complete && orderPage.rows.length === 0 && !websitePage.verdict.complete && websitePage.rows.length === 0) {
      return {
        ok: false,
        report: EMPTY_REPORT,
        channels: EMPTY_CHANNELS,
        notice:
          "Could not read online orders — the database read failed. This is a " +
          "connection problem, not an empty week. Refresh to try again.",
      };
    }

    const websiteRows = websitePage.rows.filter((r) =>
      isWebsiteOrderRow({ origin: r.origin, staffNote: r.staff_note, posClientUuid: r.pos_client_uuid }),
    );
    const rawOrders = orderPage.rows;
    const localIds = rawOrders.map((r) => r.local_order_id).filter((x): x is string => typeof x === "string" && x !== "");

    // ── id-keyed follow-up reads (each chunk paged; failures flagged) ──────
    const readChunked = async <Row,>(
      ids: readonly string[],
      label: string,
      page: (chunk: string[], from: number, to: number) => Promise<{ rows: Row[]; ok: boolean }>,
    ): Promise<Row[]> => {
      const out: Row[] = [];
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += ID_CHUNK) {
        const chunk = unique.slice(i, i + ID_CHUNK);
        const res = await pagedAllChecked<Row>((from, to) => page(chunk, from, to), {
          pageSize: REPORT_PAGE_SIZE,
          maxRows: REPORT_MAX_ROWS,
        });
        out.push(...res.rows);
        if (!res.verdict.complete) {
          partial.push(label);
          break;
        }
      }
      return out;
    };

    // Online orders closed by a register sale (SLICE L-37): "cancelled" in the
    // database, "picked up" in truth.
    const pickupEvents = await readChunked<PickupEventRow>(
      [...websiteRows.map((r) => r.id), ...localIds],
      "register pickups",
      async (chunk, from, to) => {
        const res = await admin
          .from("order_events")
          .select("order_id, created_at")
          .in("order_id", chunk)
          .eq("event_type", "status_changed")
          .eq("to_status", "cancelled")
          .like("note", `${REGISTER_PICKED_UP_NOTE_PREFIX}%`)
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: ((res.data ?? []) as unknown as PickupEventRow[]) ?? [], ok: !res.error };
      },
    );
    const pickedUpAt = new Map<string, string | null>();
    for (const e of pickupEvents) if (!pickedUpAt.has(e.order_id)) pickedUpAt.set(e.order_id, e.created_at);

    const localCopies = await readChunked<LocalCopyRow>(localIds, "Leafly register copies", async (chunk, from, to) => {
      const res = await admin
        .from("orders")
        .select("id, status, total_minor_units, item_count, completed_at")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return { rows: ((res.data ?? []) as unknown as LocalCopyRow[]) ?? [], ok: !res.error };
    });
    const localById = new Map(localCopies.map((c) => [c.id, c]));

    const lineRows = await readChunked<LineRow>(
      websiteRows.map((r) => r.id),
      "website order lines",
      async (chunk, from, to) => {
        const res = await admin
          .from("order_lines")
          .select("order_id, product_name, brand, quantity, price_minor_units")
          .in("order_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: ((res.data ?? []) as unknown as LineRow[]) ?? [], ok: !res.error };
      },
    );
    const linesByOrder = new Map<string, ChannelLine[]>();
    for (const l of lineRows) {
      const q = typeof l.quantity === "number" && Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1;
      const unit = intMinorOrNull(l.price_minor_units);
      const list = linesByOrder.get(l.order_id) ?? [];
      list.push({ name: l.product_name ?? "Unnamed item", brand: l.brand, category: null, quantity: q, lineMinor: unit === null ? null : unit * q });
      linesByOrder.set(l.order_id, list);
    }

    // ── the unified rows ──────────────────────────────────────────────────
    const channelRows: ChannelOrderRow[] = [];

    for (const w of websiteRows) {
      const pickup = pickedUpAt.has(w.id);
      const outcome = websiteOutcome(w.status, pickup);
      const identity =
        contactIdentity(w.customer_email, w.customer_phone) ??
        (typeof w.customer_id === "string" && w.customer_id !== "" ? `c:${w.customer_id}` : null);
      channelRows.push({
        channel: "website",
        id: w.id,
        placedAt: w.placed_at,
        ...pacificBuckets(w.placed_at),
        outcome,
        totalMinor: intMinorOrNull(w.total_minor_units),
        totalSource: intMinorOrNull(w.total_minor_units) === null ? null : "order",
        taxMinor: intMinorOrNull(w.estimated_tax_minor_units),
        discountMinor: intMinorOrNull(w.savings_minor_units),
        loyaltyDiscountMinor: intMinorOrNull(w.loyalty_discount_minor_units),
        itemCount: intMinorOrNull(w.item_count),
        acknowledgedAt: w.acknowledged_at,
        readyAt: w.ready_at,
        fulfilledAt: pickup ? (pickedUpAt.get(w.id) ?? null) : outcome === "fulfilled" ? w.completed_at : null,
        customerKey: hashKey(identity),
        lines: linesByOrder.get(w.id) ?? [],
      });
    }

    const leaflyContractRows: ReportOrderRow[] = [];
    for (const r of rawOrders) {
      const facts = readLeaflyPayloadFacts(r.raw_order);
      const local = r.local_order_id ? localById.get(r.local_order_id) : undefined;
      const localPickedUp = r.local_order_id ? pickedUpAt.has(r.local_order_id) : false;
      const localFulfilled = localPickedUp || local?.status === "completed";
      const localTotal = local ? intMinorOrNull(local.total_minor_units) : null;
      const totalMinor = facts.totalMinor ?? localTotal;
      const totalSource = facts.totalMinor !== null ? "leafly_payload" : localTotal !== null ? "register_copy" : null;

      leaflyContractRows.push({
        leaflyOrderId: r.leafly_order_id,
        leaflyStatus: r.leafly_status,
        fulfillmentMechanism: r.fulfillment_mechanism,
        marketplace: r.marketplace,
        medicalStatus: r.medical_status,
        paymentPreference: r.payment_preference,
        acknowledgeBy: r.acknowledge_by,
        acknowledgedAt: r.acknowledged_at,
        canceledAt: r.canceled_at,
        cancelationReasonCode: r.cancelation_reason_code,
        localOrderId: r.local_order_id,
        firstSeenAt: toPacificDayStamp(r.first_seen_at),
        announcedAt: r.announced_at,
        printedAt: r.printed_at,
        totalMinorUnits: totalMinor,
      });

      channelRows.push({
        channel: "leafly",
        id: r.leafly_order_id ?? "",
        placedAt: r.first_seen_at,
        ...pacificBuckets(r.first_seen_at),
        outcome: leaflyOutcome({
          leaflyStatus: r.leafly_status,
          cancelationReasonCode: r.cancelation_reason_code,
          canceledAt: r.canceled_at,
          localFulfilled,
        }),
        totalMinor,
        totalSource,
        taxMinor: facts.taxMinor,
        discountMinor: facts.discountMinor,
        tipMinor: facts.tipMinor,
        itemCount: facts.itemCount ?? (local ? intMinorOrNull(local.item_count) : null),
        acknowledgedAt: r.acknowledged_at,
        readyAt: facts.readyAt,
        fulfilledAt:
          facts.pickedUpAt ??
          (localPickedUp ? (pickedUpAt.get(r.local_order_id as string) ?? null) : local?.status === "completed" ? local.completed_at : null),
        customerKey: hashKey(contactIdentity(facts.email, facts.phone)),
        lines: facts.lines,
      });
    }

    // The Leafly contract report. Day buckets are Pacific; the timing overlay
    // below uses the true UTC instants.
    const attempts: ReportAttemptRow[] = attemptPage.rows.map((a) => ({
      leaflyOrderId: a.leafly_order_id,
      operation: a.operation,
      requestedStatus: a.requested_status,
      responseStatus: a.response_status,
      disposition: a.disposition,
      refusalCode: a.refusal_code,
      attemptedAt: a.attempted_at,
    }));
    const report = buildOnlineOrdersReport({ orders: leaflyContractRows, attempts });
    const timing = buildOnlineOrdersReport({
      orders: rawOrders.map((r) => ({
        acknowledgeBy: r.acknowledge_by,
        acknowledgedAt: r.acknowledged_at,
        firstSeenAt: r.first_seen_at,
      })),
    });
    report.acknowledgement = timing.acknowledgement;

    const channels = buildOnlineChannelsReport({
      orders: channelRows,
      dayKeys: windowDayKeys(input.fromDate, input.toDate),
    });

    const notices = [
      describeIncompleteness(orderPage.verdict, "Leafly orders"),
      describeIncompleteness(websitePage.verdict, "website orders"),
      attemptPage.verdict.complete
        ? null
        : "The outbound call log could not be read in full, so the delivery-health counts are a floor, not a total.",
      partial.length > 0
        ? `Some detail could not be read in full (${[...new Set(partial)].join(", ")}), so figures that depend on it are a floor.`
        : null,
    ].filter((n): n is string => typeof n === "string" && n !== "");

    return { ok: true, report, channels, notice: notices.join(" ") || null };
  } catch (err) {
    return {
      ok: false,
      report: EMPTY_REPORT,
      channels: EMPTY_CHANNELS,
      notice: `Could not build the report: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
