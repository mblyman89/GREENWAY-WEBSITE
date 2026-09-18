import "server-only";

/**
 * src/lib/leafly/evidence-server.ts
 *
 * SLICE L-8. The READ side of `public.leafly_webhook_events` and the non-PII
 * projection of `public.leafly_orders`.
 *
 * ── WHY A SEPARATE FILE FROM evidence-core.ts ───────────────────────────────
 * `evidence-core.ts` is pure and self-tested. This file touches the database,
 * so it cannot be. Keeping them apart is what lets 316 assertions run in CI
 * without a Postgres instance, and it is the same split used by
 * schedule-core/schedule-server and order-ack-core/order-ack-server.
 *
 * ── THIS MODULE IS READ-ONLY, DELIBERATELY ──────────────────────────────────
 * Not one function here writes. `leafly_webhook_events` is append-only
 * evidence: migration 0225 calls it "the evidence Leafly reviews at
 * certification". A screen that could edit it would destroy the only property
 * that makes it evidence. The writers stay where L-5 put them, in
 * `webhook-server.ts`, called only from the webhook routes.
 *
 * ── NOTHING HERE THROWS ─────────────────────────────────────────────────────
 * Every function returns a `problem: string | null` instead of rejecting. The
 * owner will most often open this screen BECAUSE something is broken, so the
 * diagnostics page must never be the second thing that fails. This is the same
 * discipline as `loadLeaflySyncHealth` in schedule-server.ts, which the L-7
 * page comment records as the reason it is safe inside a `Promise.all`.
 *
 * ── PRIVACY IS ENFORCED AT THE QUERY, NOT AT THE VIEW ───────────────────────
 * The `leafly_orders` select lists its columns explicitly and never uses
 * `select("*")`. `raw_order` holds the full Leafly `Order` payload, which the
 * spec requires to contain `firstName`, `lastName`, `emailAddress` and
 * `phoneNumber`, and which may also carry `dateOfBirth` and
 * `medicalCardNumber`. A `select("*")` here would pull all of that into a
 * process whose whole purpose is to produce a downloadable file. Narrowing at
 * the query means PII is never even fetched, so it cannot leak by accident
 * later. `evidence-core`'s `EVIDENCE_FORBIDDEN_KEYS` audit is the second,
 * independent layer.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type EvidenceEventRow,
  type EvidenceOrderRow,
  type EvidenceSummary,
  type EvidenceVerdict,
  type AckEvidence,
  type EvidenceCriterion,
  type EvidenceBundle,
  summarizeEvidence,
  assessEvidence,
  summarizeAckEvidence,
  buildEvidenceCriteria,
  buildEvidenceBundle,
} from "./evidence-core";

/**
 * How many deliveries the on-screen panel loads.
 *
 * Deliberately small. The panel answers "is Leafly reaching us and are the
 * signatures good?", which the most recent deliveries settle. The EXPORT is
 * the place to go wide, and it has its own, larger cap below.
 */
export const EVIDENCE_PANEL_LIMIT = 25;

/**
 * How many rows the export may pull.
 *
 * Capped rather than unbounded because this runs in a serverless function with
 * a finite response budget. An export that times out produces nothing at all,
 * which is strictly worse than one that returns the most recent 2,000
 * deliveries and says so. `truncated` below makes the cap visible instead of
 * letting a silently-short file be mistaken for a complete record -- which, for
 * something offered as certification evidence, would be the worst possible
 * failure mode.
 */
export const EVIDENCE_EXPORT_LIMIT = 2000;

/** Orders pulled for the acknowledgement record. */
export const EVIDENCE_ORDER_LIMIT = 500;

/**
 * Columns selected from `leafly_orders`. Enumerated as a constant so the
 * compliance test can assert that no PII column was ever added to it.
 *
 * Read this list against migration 0225: everything personal
 * (`raw_order`, and any future name/email/phone column) is absent by intent.
 */
export const EVIDENCE_ORDER_COLUMNS =
  "leafly_order_id, leafly_status, fulfillment_mechanism, acknowledge_by, acknowledged_at, first_seen_at";

/** Columns selected from `leafly_webhook_events`. */
export const EVIDENCE_EVENT_COLUMNS =
  "id, event_type, order_id, order_integration_key, event_time, received_at, body_sha256, signature_verified, rejection_reason, response_status, processed_at";

type RawEventRow = {
  id: string | null;
  event_type: string | null;
  order_id: string | null;
  order_integration_key: string | null;
  event_time: string | null;
  received_at: string | null;
  body_sha256: string | null;
  signature_verified: boolean | null;
  rejection_reason: string | null;
  response_status: number | null;
  processed_at: string | null;
};

type RawOrderRow = {
  leafly_order_id: string | null;
  leafly_status: string | null;
  fulfillment_mechanism: string | null;
  acknowledge_by: string | null;
  acknowledged_at: string | null;
  first_seen_at: string | null;
};

/**
 * Map a database row to the pure core's shape.
 *
 * `received_at` and `body_sha256` are NOT NULL in 0225, so the `?? ""`
 * fallbacks can only fire if the schema changes underneath us. They exist so a
 * schema drift degrades to a visibly-odd row rather than a crashed page, and
 * the empty string is honest: the core treats an unparseable timestamp as
 * "unknown" rather than inventing one (house rule 3).
 */
function mapEventRow(r: RawEventRow): EvidenceEventRow {
  return {
    id: r.id ?? "",
    eventType: r.event_type,
    orderId: r.order_id,
    orderIntegrationKey: r.order_integration_key,
    eventTime: r.event_time,
    receivedAt: r.received_at ?? "",
    bodySha256: r.body_sha256 ?? "",
    signatureVerified: r.signature_verified === true,
    rejectionReason: r.rejection_reason,
    responseStatus: r.response_status,
    processedAt: r.processed_at,
  };
}

function mapOrderRow(r: RawOrderRow): EvidenceOrderRow {
  return {
    leaflyOrderId: r.leafly_order_id ?? "",
    leaflyStatus: r.leafly_status,
    fulfillmentMechanism: r.fulfillment_mechanism,
    acknowledgeBy: r.acknowledge_by,
    acknowledgedAt: r.acknowledged_at,
    firstSeenAt: r.first_seen_at ?? "",
  };
}

export type EvidenceView = {
  /** Most recent deliveries first. */
  events: EvidenceEventRow[];
  orders: EvidenceOrderRow[];
  summary: EvidenceSummary;
  verdict: EvidenceVerdict;
  ack: AckEvidence;
  criteria: EvidenceCriterion[];
  /** Total deliveries in the table, which may exceed `events.length`. */
  totalDeliveries: number | null;
  /** Total unverified deliveries in the table, across all time. */
  totalUnverified: number | null;
  /** Non-fatal explanation of why some part is missing. Null when all is well. */
  problem: string | null;
  /** When this view was computed, ISO. */
  generatedAt: string;
};

/**
 * Load everything the evidence panel needs. Never throws.
 *
 * The two `count`-only queries matter: the panel shows the most recent 25
 * deliveries, but "how many rejections have there EVER been?" cannot be
 * answered from a 25-row window. Without the all-time count, an owner whose
 * key was wrong last week would see a clean recent page and conclude nothing
 * ever failed. The counts use `head: true` so no rows cross the wire.
 */
export async function loadLeaflyEvidence(
  opts: { limit?: number; nowIso?: string } = {},
): Promise<EvidenceView> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(opts.limit ?? EVIDENCE_PANEL_LIMIT, EVIDENCE_EXPORT_LIMIT));

  const emptyView = (problem: string | null): EvidenceView => {
    const summary = summarizeEvidence([]);
    const ack = summarizeAckEvidence([], nowIso);
    return {
      events: [],
      orders: [],
      summary,
      verdict: assessEvidence(summary),
      ack,
      criteria: buildEvidenceCriteria(summary, ack),
      totalDeliveries: null,
      totalUnverified: null,
      problem,
      generatedAt: nowIso,
    };
  };

  if (!isSupabaseServiceConfigured) {
    return emptyView(
      "The database is not connected in this environment, so no webhook evidence can be read. " +
        "This is expected in local preview builds and is not a Leafly fault.",
    );
  }

  try {
    const admin = createSupabaseAdminClient();

    const [eventsRes, ordersRes, totalRes, unverifiedRes] = await Promise.all([
      admin
        .from("leafly_webhook_events")
        .select(EVIDENCE_EVENT_COLUMNS)
        .order("received_at", { ascending: false })
        .limit(limit),
      admin
        .from("leafly_orders")
        .select(EVIDENCE_ORDER_COLUMNS)
        .order("first_seen_at", { ascending: false })
        .limit(EVIDENCE_ORDER_LIMIT),
      admin.from("leafly_webhook_events").select("id", { count: "exact", head: true }),
      admin
        .from("leafly_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("signature_verified", false),
    ]);

    const problems: string[] = [];
    if (eventsRes.error) problems.push(`Delivery log: ${eventsRes.error.message}`);
    if (ordersRes.error) problems.push(`Order record: ${ordersRes.error.message}`);
    if (totalRes.error) problems.push(`Delivery count: ${totalRes.error.message}`);
    if (unverifiedRes.error) problems.push(`Rejection count: ${unverifiedRes.error.message}`);

    const events = ((eventsRes.data as RawEventRow[] | null) ?? []).map(mapEventRow);
    const orders = ((ordersRes.data as RawOrderRow[] | null) ?? []).map(mapOrderRow);

    const summary = summarizeEvidence(events);
    const ack = summarizeAckEvidence(orders, nowIso);

    return {
      events,
      orders,
      summary,
      verdict: assessEvidence(summary),
      ack,
      criteria: buildEvidenceCriteria(summary, ack),
      totalDeliveries: totalRes.error ? null : (totalRes.count ?? 0),
      totalUnverified: unverifiedRes.error ? null : (unverifiedRes.count ?? 0),
      problem: problems.length > 0 ? problems.join(" | ") : null,
      generatedAt: nowIso,
    };
  } catch (err) {
    return emptyView(
      err instanceof Error
        ? `Could not read the Leafly webhook evidence: ${err.message}`
        : "Could not read the Leafly webhook evidence.",
    );
  }
}

export type EvidenceExport = {
  bundle: EvidenceBundle | null;
  /** True when the delivery cap was hit, so the file is a window, not the whole log. */
  truncated: boolean;
  problem: string | null;
};

/**
 * Build the downloadable evidence bundle.
 *
 * Returns the pure core's `EvidenceBundle`; the route hands it to
 * `exportResponse` in `src/lib/reports/workbook.ts` (rule 11 -- the CSV/XLSX
 * writer already exists and is used by ten other admin exports, so this slice
 * adds no second one).
 *
 * `truncated` is computed by comparing the rows we got against the cap, and is
 * surfaced to the caller so it can be written INTO the file. A short evidence
 * file that does not admit it is short would mislead exactly the audience it
 * is meant to inform.
 */
export async function buildLeaflyEvidenceExport(
  opts: { nowIso?: string; limit?: number } = {},
): Promise<EvidenceExport> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(opts.limit ?? EVIDENCE_EXPORT_LIMIT, EVIDENCE_EXPORT_LIMIT));

  if (!isSupabaseServiceConfigured) {
    return {
      bundle: null,
      truncated: false,
      problem: "The database is not connected, so there is no evidence to export.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const [eventsRes, ordersRes] = await Promise.all([
      admin
        .from("leafly_webhook_events")
        .select(EVIDENCE_EVENT_COLUMNS)
        .order("received_at", { ascending: false })
        .limit(limit),
      admin
        .from("leafly_orders")
        .select(EVIDENCE_ORDER_COLUMNS)
        .order("first_seen_at", { ascending: false })
        .limit(EVIDENCE_ORDER_LIMIT),
    ]);

    if (eventsRes.error) {
      return {
        bundle: null,
        truncated: false,
        problem: `Could not read the delivery log: ${eventsRes.error.message}`,
      };
    }

    const events = ((eventsRes.data as RawEventRow[] | null) ?? []).map(mapEventRow);
    const orders = ((ordersRes.data as RawOrderRow[] | null) ?? []).map(mapOrderRow);

    const bundle = buildEvidenceBundle({ events, orders, nowIso });
    const truncated = events.length >= limit;

    // Record the window inside the file itself.
    const summarySheet = bundle.sheets.find((s) => s.name === "Summary");
    if (summarySheet) {
      summarySheet.rows.push({
        item: "Deliveries in this file",
        value: events.length,
      });
      summarySheet.rows.push({
        item: "Complete log?",
        value: truncated
          ? `No — capped at ${limit} most recent deliveries. Ask for a wider export if more is needed.`
          : "Yes — every delivery ever received is included.",
      });
      summarySheet.rows.push({
        item: "Customer data included?",
        value:
          "No. This file carries no name, email, phone, date of birth, medical card or address. " +
          "Deliveries are identified by a SHA-256 hash of the request body.",
      });
    }

    return {
      bundle,
      truncated,
      problem:
        ordersRes.error
          ? `Deliveries exported, but the order record could not be read: ${ordersRes.error.message}`
          : null,
    };
  } catch (err) {
    return {
      bundle: null,
      truncated: false,
      problem:
        err instanceof Error
          ? `Could not build the evidence export: ${err.message}`
          : "Could not build the evidence export.",
    };
  }
}
