/**
 * src/lib/leafly/evidence-core.ts
 *
 * SLICE L-8 -- make the Leafly webhook delivery log READABLE.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * Slice L-5 created `public.leafly_webhook_events` and wired every one of the
 * six webhook routes to write to it. Migration 0225 says, in its own table
 * comment, that this log is:
 *
 *   'Append-only log of every webhook delivery Leafly makes to us, verified or
 *    not. Doubles as the idempotency guard (unique body_sha256) and as the
 *    evidence Leafly reviews at certification ("validated by review of logged
 *    activity").'
 *
 * and in its column commentary:
 *
 *   'Leafly grades certification "by review of logged activity", so the
 *    delivery log is evidence, not debug noise.'
 *
 * It was never read. `grep -rn "leafly_webhook_events" src/app src/components`
 * found exactly zero queries. 0225 even creates a partial index built for a
 * question nobody asks:
 *
 *   create index leafly_webhook_events_unverified_idx
 *     on public.leafly_webhook_events (received_at desc)
 *     where signature_verified = false;
 *
 * An index whose only purpose is "show me the rejected deliveries, newest
 * first" is a promise that such a screen exists. This slice keeps it.
 *
 * ── WHY IT MATTERS OPERATIONALLY, NOT JUST TIDILY ───────────────────────────
 * Three concrete failures are invisible today:
 *
 *  1. A ROTATED OR MISTYPED HMAC KEY. Every delivery is rejected with 401 and
 *     logged with `signature_verified = false`. Leafly's dashboard shows
 *     failures; ours shows nothing. The shop would learn about it from a
 *     customer whose order never appeared.
 *
 *  2. LEAFLY NOT ACTUALLY SENDING. Zero rows is a completely different problem
 *     from rows-that-fail (wrong URL, integration not activated, sandbox not
 *     pointed at us) and needs the opposite fix. Without a reader, both look
 *     identical: an empty orders board.
 *
 *  3. AN UNKNOWN EVENT TYPE. The routes deliberately store unknown event types
 *     rather than exploding, because Leafly requires a 200. That tolerance is
 *     only safe if somebody can SEE the anomaly afterwards.
 *
 * ── WHAT IS PURE HERE AND WHAT IS NOT ───────────────────────────────────────
 * Everything in this file is a total function of its arguments. No I/O, no
 * clock, no database. `nowIso` is always passed in. `evidence-server.ts` does
 * the reading; this module does the deciding, and can therefore be exhaustively
 * self-tested (house rule 5).
 *
 * ── RULE 11: WHAT THIS MODULE DELIBERATELY DOES NOT DECLARE ─────────────────
 * The house rule is "never re-implement a rule that has a shared core". So:
 *
 *   * The six event types come from `webhook-parse-core.ts`
 *     (`LEAFLY_WEBHOOK_EVENT_TYPES`). This file does not restate them.
 *   * "Which events carry no order" comes from `leaflyEventCarriesAnOrder()`.
 *     Counting an activate/deactivate delivery as "missing its order id" would
 *     be a false alarm, and that distinction is already encoded once.
 *   * The rejection vocabulary and the "is this OUR fault?" split come from
 *     `hmac-core.ts` (`LEAFLY_HMAC_FAILURE_REASONS`, `isLeaflyHmacLocalFault`).
 *   * The certification criterion shape comes from `certification-core.ts`.
 *   * The 15-minute acknowledgement window comes from `order-ack-core.ts`
 *     (`LEAFLY_ACK_WINDOW_MINUTES`). It is Leafly's number, declared once.
 *
 * ── PRIVACY, MEASURED RATHER THAN ASSUMED ───────────────────────────────────
 * `leafly_webhook_events` stores NO request body -- only `body_sha256`. That is
 * a deliberate L-5 design choice and it means the delivery log is PII-free by
 * construction.
 *
 * Verified against `docs/leafly-specs/order-api-v1.openapi.json`: the `Order`
 * schema REQUIRES `firstName`, `lastName`, `emailAddress`, `phoneNumber`, and
 * additionally carries `dateOfBirth`, `medicalCardNumber`, `medicalCardState`,
 * `medicalCardExpiration` and a full `deliveryAddress`. All of that lands in
 * `leafly_orders.raw_order`.
 *
 * Therefore the exportable evidence bundle is built from the events table plus
 * a strictly enumerated set of non-PII order columns, and `EVIDENCE_FORBIDDEN_KEYS`
 * below is asserted against every row this module emits. The owner is going to
 * send this file to Leafly and to me; it must not carry a customer's phone
 * number or medical card number to either of us.
 */

import {
  LEAFLY_WEBHOOK_EVENT_TYPES,
  isLeaflyWebhookEventType,
  leaflyEventCarriesAnOrder,
} from "./webhook-parse-core";
import {
  LEAFLY_HMAC_FAILURE_REASONS,
  type LeaflyHmacFailureReason,
  isLeaflyHmacLocalFault,
} from "./hmac-core";
import { LEAFLY_ACK_WINDOW_MINUTES } from "./order-ack-core";
import type { CertificationCriterionStatus } from "./certification-core";

// ---------------------------------------------------------------------------
// The row shape, mirroring 0225 exactly
// ---------------------------------------------------------------------------

/**
 * One delivery, as stored. Field-for-field with
 * `public.leafly_webhook_events` in migration 0225.
 *
 * Every field that is nullable in the migration is nullable here. That is not
 * defensive padding -- `event_type` and `order_id` are genuinely null in
 * production traffic (an unrecognised event, an activation webhook), and a
 * non-optional type would push the caller into inventing values, which house
 * rule 3 forbids.
 */
export type EvidenceEventRow = {
  id: string;
  eventType: string | null;
  orderId: string | null;
  orderIntegrationKey: string | null;
  /** Leafly's claim of when it happened. */
  eventTime: string | null;
  /** Our clock, when it landed. Never null (DB default now()). */
  receivedAt: string;
  bodySha256: string;
  signatureVerified: boolean;
  rejectionReason: string | null;
  responseStatus: number | null;
  processedAt: string | null;
};

/**
 * The non-PII projection of `public.leafly_orders` used for the acknowledgement
 * evidence sheet.
 *
 * Note what is ABSENT and why: no name, no email, no phone, no date of birth,
 * no medical card number, no delivery address, and no `raw_order`. Those exist
 * in the table but must never reach an export. See the privacy note above.
 */
export type EvidenceOrderRow = {
  leaflyOrderId: string;
  leaflyStatus: string | null;
  fulfillmentMechanism: string | null;
  acknowledgeBy: string | null;
  acknowledgedAt: string | null;
  firstSeenAt: string;
};

// ---------------------------------------------------------------------------
// Privacy guard
// ---------------------------------------------------------------------------

/**
 * Keys that must never appear in an exported evidence row, in any casing or
 * snake/camel spelling.
 *
 * Sourced from the live Order schema in
 * `docs/leafly-specs/order-api-v1.openapi.json`, not from imagination:
 * `Order.required` is
 *   ['id','emailAddress','phoneNumber','firstName','lastName','marketplace',
 *    'fulfillmentMechanism','deliveryAddress','status','createdAt','cartItems',
 *    'statusChanges','taxes']
 * and its optional properties include `dateOfBirth`, `medicalCardNumber`,
 * `medicalCardState`, `medicalCardExpiration`.
 *
 * `fulfillmentMechanism` and `marketplace` are required-but-not-personal, so
 * they are NOT listed -- "pickup" tells you nothing about a human.
 *
 * Comparison is on a normalised key (lowercased, underscores stripped) so
 * `phone_number`, `phoneNumber` and `PhoneNumber` are all caught by one entry.
 */
export const EVIDENCE_FORBIDDEN_KEYS: readonly string[] = [
  "firstname",
  "lastname",
  "emailaddress",
  "email",
  "phonenumber",
  "phone",
  "dateofbirth",
  "dob",
  "medicalcardnumber",
  "medicalcardstate",
  "medicalcardexpiration",
  "deliveryaddress",
  "address1",
  "address2",
  "deliveryinstructions",
  "coordinates",
  "raworder",
  "customername",
] as const;

/** Lowercase and strip separators, so one entry covers every spelling. */
export function normalizeEvidenceKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

/**
 * Is this key safe to export?
 *
 * Substring-based on purpose. A future column called `customer_phone_number`
 * or `order_email_address` must be caught without anyone remembering to come
 * back and extend the list. A prefix- or equality-only check would let exactly
 * that class of mistake through, and the cost of a false positive here (a
 * harmless column withheld from a diagnostic export) is trivially smaller than
 * the cost of a false negative (a customer's phone number emailed to Leafly).
 */
export function isForbiddenEvidenceKey(key: string): boolean {
  const n = normalizeEvidenceKey(key);
  return EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));
}

/**
 * Assert that a set of column keys carries no PII. Returns the offending keys
 * rather than throwing, so the caller can surface them; an export that quietly
 * dropped a column would hide a real modelling mistake.
 */
export function auditEvidenceKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => isForbiddenEvidenceKey(k));
}

// ---------------------------------------------------------------------------
// Per-delivery classification
// ---------------------------------------------------------------------------

/**
 * What happened to one delivery, from our point of view.
 *
 *   accepted        -- signature verified and we finished handling it.
 *   accepted_unprocessed -- verified, but `processed_at` is still null. Either
 *                     in flight right now, or we 200'd and then died before
 *                     stamping. Distinguished from `accepted` because a
 *                     persistent population here is a real bug, and folding it
 *                     into "accepted" would hide it.
 *   rejected_ours   -- rejected for a reason that is OUR fault (`missing_key`,
 *                     `digest_unavailable`). Leafly did nothing wrong. This is
 *                     the single most actionable state on the screen: the shop
 *                     has not saved its HMAC key.
 *   rejected_theirs -- rejected for a reason that indicts the request itself
 *                     (`mismatch`, `malformed_header`, ...). Usually a key
 *                     mismatch, sometimes a probe from the open internet.
 *   rejected_unknown -- unverified, with a reason we do not recognise. Kept
 *                     separate rather than lumped in, because an unrecognised
 *                     rejection reason means OUR vocabulary drifted from the
 *                     code that writes it.
 */
export type EvidenceDisposition =
  | "accepted"
  | "accepted_unprocessed"
  | "rejected_ours"
  | "rejected_theirs"
  | "rejected_unsigned"
  | "rejected_unknown";

export const ALL_EVIDENCE_DISPOSITIONS: readonly EvidenceDisposition[] = [
  "accepted",
  "accepted_unprocessed",
  "rejected_ours",
  "rejected_theirs",
  "rejected_unsigned",
  "rejected_unknown",
] as const;

export type EvidenceTone = "good" | "warn" | "bad" | "info";

/**
 * Classify one delivery.
 *
 * Order of tests matters and is contractual:
 *   1. `signatureVerified` first. A verified delivery is never a rejection,
 *      whatever else is set -- `rejection_reason` can legitimately be non-null
 *      on a verified row if a later stage complained.
 *   2. Only then split the rejections by fault, via `isLeaflyHmacLocalFault`
 *      (rule 11 -- that judgement is already made once, in hmac-core).
 */
export function classifyEvidenceDelivery(row: EvidenceEventRow): EvidenceDisposition {
  if (row.signatureVerified) {
    return row.processedAt ? "accepted" : "accepted_unprocessed";
  }
  const reason = (row.rejectionReason ?? "").trim();
  if (!isRecognisedRejectionReason(reason)) return "rejected_unknown";
  if (isLeaflyHmacLocalFault(reason as LeaflyHmacFailureReason)) return "rejected_ours";
  if (isUnsignedRequest(reason as LeaflyHmacFailureReason)) return "rejected_unsigned";
  return "rejected_theirs";
}

/**
 * Did this request arrive with no signature at all?
 *
 * WHY THIS IS A THIRD CATEGORY AND NOT A SHADE OF "rejected_theirs".
 *
 * A request that carries a signature which does not match is a genuine alarm:
 * somebody holding a key we also hold produced a digest we disagree with. The
 * usual cause is a rotated HMAC key, and the correct advice is "re-copy the key
 * from Leafly".
 *
 * A request that carries NO signature header is a different event entirely. It
 * cannot be a key mismatch, because there was no key involved. Leafly always
 * signs; anything unsigned did not come from Leafly. In practice it is a port
 * scanner or a crawler finding a public URL, and turning it away with a 401 is
 * the system working exactly as designed.
 *
 * Collapsing the two was not cosmetic. The sandbox review showed four rejected
 * deliveries, all of them `missing_header` - four unsigned internet probes,
 * correctly refused - and the owner-facing advice told him his HMAC key was
 * probably wrong and to go re-copy it. That is a fully green system reporting a
 * credential fault. Acting on that advice means rotating a working key, and the
 * next real mismatch hides inside the same noise.
 *
 * Advice that always fires is nagging, not diagnosis.
 */
export function isUnsignedRequest(reason: LeaflyHmacFailureReason | null): boolean {
  return reason === "missing_header";
}

/**
 * Is this string one of hmac-core's seven declared failure reasons?
 *
 * Deliberately NOT a loose `reason.length > 0` test. If the writer ever starts
 * emitting a reason this build has never heard of, that is drift between two
 * modules and the owner should see "unrecognised", not a confident label.
 */
export function isRecognisedRejectionReason(value: string): value is LeaflyHmacFailureReason {
  return (LEAFLY_HMAC_FAILURE_REASONS as readonly string[]).includes(value);
}

export function evidenceDispositionTone(d: EvidenceDisposition): EvidenceTone {
  switch (d) {
    case "accepted":
      return "good";
    case "accepted_unprocessed":
      return "warn";
    case "rejected_ours":
      return "bad";
    case "rejected_theirs":
      return "bad";
    case "rejected_unsigned":
      // Deliberately "info", not "bad". An unsigned request turned away is the
      // door being locked, not the lock being broken. Painting routine internet
      // background noise red is how a dashboard teaches its owner that red
      // means nothing.
      return "info";
    case "rejected_unknown":
      return "warn";
  }
}

export function evidenceDispositionLabel(d: EvidenceDisposition): string {
  switch (d) {
    case "accepted":
      return "Accepted";
    case "accepted_unprocessed":
      return "Accepted, not finished";
    case "rejected_ours":
      return "Rejected — our configuration";
    case "rejected_theirs":
      return "Rejected — bad signature";
    case "rejected_unsigned":
      return "Turned away — unsigned request";
    case "rejected_unknown":
      return "Rejected — unrecognised reason";
  }
}

/**
 * Plain-English explanation of a disposition, written for the shop owner rather
 * than for an engineer, and naming the fix where there is one.
 */
export function evidenceDispositionExplanation(d: EvidenceDisposition): string {
  switch (d) {
    case "accepted":
      return "Leafly's signature matched and we finished handling the delivery. Nothing to do.";
    case "accepted_unprocessed":
      return (
        "The signature matched and we answered Leafly, but our record was never stamped as " +
        "finished. One of these during a deploy is harmless. A steady stream of them means " +
        "handling is failing after the reply was sent — send me the export."
      );
    case "rejected_ours":
      return (
        "We turned this delivery away because of OUR configuration, not Leafly's request: the " +
        "HMAC key is missing or unusable. Paste the HMAC key from Leafly into Integrations → " +
        "Leafly and the next delivery will verify. Leafly is doing nothing wrong here."
      );
    case "rejected_theirs":
      return (
        "This request WAS signed, but the signature did not match. The usual cause is that " +
        "the HMAC key saved here is not the key Leafly is signing with — for example after a " +
        "rotation. Re-copy the HMAC key from Leafly into Integrations → Leafly. If these keep " +
        "arriving after that, send me the export."
      );
    case "rejected_unsigned":
      return (
        "This request arrived with no signature at all, so we turned it away. Leafly always " +
        "signs, which means this did not come from Leafly — it is almost always an automated " +
        "scanner finding a public address. Nothing is wrong and there is nothing to fix: this " +
        "is the door being locked, not the lock being broken. Your HMAC key is not involved " +
        "and must NOT be changed because of these."
      );
    case "rejected_unknown":
      return (
        "This delivery was turned away for a reason this build does not recognise, which means " +
        "the code that writes the log and the code that reads it have drifted apart. Not " +
        "dangerous, but it should be reported — send me the export."
      );
  }
}

// ---------------------------------------------------------------------------
// Per-delivery anomalies
// ---------------------------------------------------------------------------

/**
 * A specific, named oddity about one delivery. Separate from the disposition:
 * a delivery can be perfectly accepted and still be anomalous (an unknown
 * event type, a wildly skewed clock).
 */
export type EvidenceAnomalyCode =
  | "unknown_event_type"
  | "missing_event_type"
  | "missing_order_id"
  | "clock_skew"
  | "no_response_status"
  | "bad_response_status";

export type EvidenceAnomaly = {
  code: EvidenceAnomalyCode;
  detail: string;
};

/**
 * How far apart Leafly's `eventTime` and our `receivedAt` may be before we call
 * it skew, in minutes.
 *
 * Chosen, not guessed, and the reasoning is recorded so a future reader does
 * not "tidy" it: Leafly retries deliveries, and a retry legitimately arrives
 * long after the event it describes. The threshold therefore has to be generous
 * enough not to flag ordinary retries, while still catching a genuinely wrong
 * clock. 60 minutes is one full timezone step, which is the smallest error that
 * a misconfigured clock realistically produces.
 *
 * This is OUR diagnostic threshold and is not claimed to be a Leafly rule --
 * the spec states no bound on delivery latency.
 */
export const EVIDENCE_CLOCK_SKEW_MINUTES = 60;

/**
 * Statuses Leafly tells us to answer webhooks with, verbatim from the spec:
 * "should only be responded to with status codes 200 or 201".
 *
 * A 401 is not in this list and is not an anomaly either -- it is the correct
 * answer to an unsigned request. So `bad_response_status` fires only on a
 * VERIFIED delivery, where 200/201 really was mandatory.
 */
export const LEAFLY_EXPECTED_WEBHOOK_STATUSES: readonly number[] = [200, 201] as const;

/**
 * Find everything odd about one delivery.
 *
 * Returns [] for a clean row, so `anomalies.length` is directly the count of
 * problems and the caller needs no null handling.
 */
export function findEvidenceAnomalies(
  row: EvidenceEventRow,
  opts: { skewMinutes?: number } = {},
): EvidenceAnomaly[] {
  const out: EvidenceAnomaly[] = [];
  const skewLimit = opts.skewMinutes ?? EVIDENCE_CLOCK_SKEW_MINUTES;

  const rawType = (row.eventType ?? "").trim();
  if (rawType === "") {
    out.push({
      code: "missing_event_type",
      detail:
        "Leafly's delivery carried no event type. We stored it anyway rather than dropping it, " +
        "because the spec requires us to answer 200.",
    });
  } else if (!isLeaflyWebhookEventType(rawType)) {
    out.push({
      code: "unknown_event_type",
      detail:
        `Event type "${rawType}" is not one of the six Leafly declares ` +
        `(${LEAFLY_WEBHOOK_EVENT_TYPES.join(", ")}). Either Leafly added an event, or this ` +
        "request did not come from Leafly.",
    });
  }

  // Only complain about a missing order id for events that are SUPPOSED to
  // carry one. rule 11: `leaflyEventCarriesAnOrder` already owns that split.
  // Without this guard, every activation webhook would raise a false alarm.
  if (rawType !== "" && isLeaflyWebhookEventType(rawType) && leaflyEventCarriesAnOrder(rawType)) {
    if ((row.orderId ?? "").trim() === "") {
      out.push({
        code: "missing_order_id",
        detail:
          `A "${rawType}" delivery is required to carry an order id, and this one did not. ` +
          "The delivery is logged so the gap is visible rather than silent.",
      });
    }
  }

  const skew = evidenceClockSkewMinutes(row);
  if (skew !== null && Math.abs(skew) > skewLimit) {
    out.push({
      code: "clock_skew",
      detail:
        `Leafly said this happened ${formatSkew(skew)} relative to when we received it ` +
        `(limit ${skewLimit} minutes). A retry can explain a positive gap; a large negative ` +
        "gap means a clock is wrong.",
    });
  }

  if (row.responseStatus === null) {
    out.push({
      code: "no_response_status",
      detail:
        "We have no record of what we answered this delivery with. Certification review asks " +
        "what we returned, so a blank here is a hole in the evidence.",
    });
  } else if (
    row.signatureVerified &&
    !LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(row.responseStatus)
  ) {
    out.push({
      code: "bad_response_status",
      detail:
        `We answered a verified delivery with ${row.responseStatus}. Leafly's spec says webhook ` +
        `requests "should only be responded to with status codes 200 or 201".`,
    });
  }

  return out;
}

/**
 * Signed minutes between Leafly's claimed event time and our receipt.
 * Positive = we received it AFTER Leafly says it happened (normal).
 * Negative = Leafly's timestamp is in our future (a clock is wrong).
 * Null = not computable, which is not an anomaly by itself.
 */
export function evidenceClockSkewMinutes(row: EvidenceEventRow): number | null {
  const claimed = Date.parse(row.eventTime ?? "");
  const got = Date.parse(row.receivedAt ?? "");
  if (!Number.isFinite(claimed) || !Number.isFinite(got)) return null;
  return Math.round((got - claimed) / 60000);
}

function formatSkew(minutes: number): string {
  const abs = Math.abs(minutes);
  const unit = abs === 1 ? "minute" : "minutes";
  return minutes >= 0 ? `${abs} ${unit} earlier` : `${abs} ${unit} later`;
}

export function evidenceAnomalyLabel(code: EvidenceAnomalyCode): string {
  switch (code) {
    case "unknown_event_type":
      return "Unknown event type";
    case "missing_event_type":
      return "No event type";
    case "missing_order_id":
      return "Missing order id";
    case "clock_skew":
      return "Clock skew";
    case "no_response_status":
      return "No response recorded";
    case "bad_response_status":
      return "Unexpected response status";
  }
}

export const ALL_EVIDENCE_ANOMALY_CODES: readonly EvidenceAnomalyCode[] = [
  "unknown_event_type",
  "missing_event_type",
  "missing_order_id",
  "clock_skew",
  "no_response_status",
  "bad_response_status",
] as const;

// ---------------------------------------------------------------------------
// Aggregate summary
// ---------------------------------------------------------------------------

export type EvidenceCounts = Record<EvidenceDisposition, number>;

export type EvidenceSummary = {
  total: number;
  counts: EvidenceCounts;
  /** Deliveries per event type, including unrecognised ones keyed verbatim. */
  byEventType: Record<string, number>;
  /** Count per anomaly code across all rows. */
  anomalyCounts: Record<EvidenceAnomalyCode, number>;
  /** Oldest / newest `received_at` seen, ISO, or null when there are no rows. */
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  /** Distinct order ids referenced (non-empty only). */
  distinctOrders: number;
  /** Count of rows whose signature verified. */
  verified: number;
  /** Count of rows whose signature did not verify. */
  unverified: number;
};

function emptyCounts(): EvidenceCounts {
  return {
    accepted: 0,
    accepted_unprocessed: 0,
    rejected_ours: 0,
    rejected_theirs: 0,
    rejected_unsigned: 0,
    rejected_unknown: 0,
  };
}

function emptyAnomalyCounts(): Record<EvidenceAnomalyCode, number> {
  return {
    unknown_event_type: 0,
    missing_event_type: 0,
    missing_order_id: 0,
    clock_skew: 0,
    no_response_status: 0,
    bad_response_status: 0,
  };
}

/**
 * Fold a page of deliveries into the numbers the panel and the export both use.
 *
 * Single pass, and deliberately the ONLY place these totals are computed, so
 * the screen and the exported file can never disagree -- which would be fatal
 * for something described as certification evidence.
 */
export function summarizeEvidence(rows: readonly EvidenceEventRow[]): EvidenceSummary {
  const counts = emptyCounts();
  const anomalyCounts = emptyAnomalyCounts();
  const byEventType: Record<string, number> = {};
  const orders = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  let verified = 0;

  for (const row of rows) {
    counts[classifyEvidenceDelivery(row)] += 1;
    if (row.signatureVerified) verified += 1;

    const key = (row.eventType ?? "").trim() === "" ? "(none)" : (row.eventType as string).trim();
    byEventType[key] = (byEventType[key] ?? 0) + 1;

    for (const a of findEvidenceAnomalies(row)) anomalyCounts[a.code] += 1;

    const oid = (row.orderId ?? "").trim();
    if (oid !== "") orders.add(oid);

    const t = Date.parse(row.receivedAt ?? "");
    if (Number.isFinite(t)) {
      if (first === null || t < Date.parse(first)) first = row.receivedAt;
      if (last === null || t > Date.parse(last)) last = row.receivedAt;
    }
  }

  return {
    total: rows.length,
    counts,
    byEventType,
    anomalyCounts,
    firstReceivedAt: first,
    lastReceivedAt: last,
    distinctOrders: orders.size,
    verified,
    unverified: rows.length - verified,
  };
}

// ---------------------------------------------------------------------------
// Overall verdict
// ---------------------------------------------------------------------------

/**
 * The one-line answer the owner actually wants at the top of the screen.
 *
 *   silent          -- no deliveries at all, ever.
 *   misconfigured   -- deliveries are arriving but OUR config rejects them.
 *                      Highest priority: it is both broken AND fixable here.
 *   all_rejected    -- deliveries arriving, none verified, not our declared
 *                      fault. Almost always a key mismatch.
 *   some_rejected   -- a mixture. Working, but something is wrong.
 *   healthy         -- verified traffic, nothing rejected.
 */
export type EvidenceVerdictCode =
  | "silent"
  | "misconfigured"
  | "all_rejected"
  | "some_rejected"
  | "healthy";

export const ALL_EVIDENCE_VERDICT_CODES: readonly EvidenceVerdictCode[] = [
  "silent",
  "misconfigured",
  "all_rejected",
  "some_rejected",
  "healthy",
] as const;

export type EvidenceVerdict = {
  code: EvidenceVerdictCode;
  tone: EvidenceTone;
  headline: string;
  detail: string;
  /** What the owner should do next, or null when there is nothing to do. */
  nextStep: string | null;
};

/**
 * Decide the overall verdict.
 *
 * ── ORDERING IS CONTRACTUAL ────────────────────────────────────────────────
 *  1. `silent` first: with zero rows every other test is vacuous.
 *  2. `misconfigured` BEFORE `all_rejected`. A run where every delivery failed
 *     on `missing_key` satisfies both, and "you have not saved your HMAC key"
 *     is a strictly more useful sentence than "everything is failing". Swap
 *     these two and the owner is told to go argue with Leafly about a field he
 *     could have filled in himself.
 *  3. `some_rejected` before `healthy`, so a partial failure is never rounded
 *     up to fine.
 */
export function assessEvidence(summary: EvidenceSummary): EvidenceVerdict {
  if (summary.total === 0) {
    return {
      code: "silent",
      tone: "info",
      headline: "No Leafly webhook deliveries recorded yet.",
      detail:
        "Nothing has arrived at our webhook endpoints. Before Leafly activates the integration " +
        "in the sandbox this is exactly the expected state, so on its own it is not a fault.",
      nextStep:
        "Once Leafly has your six URLs and has activated the sandbox integration, place a test " +
        "order. If this panel is still empty afterwards, Leafly is not reaching us and the URLs " +
        "or the activation are the place to look — not this shop's settings.",
    };
  }

  if (summary.counts.rejected_ours > 0) {
    return {
      code: "misconfigured",
      tone: "bad",
      headline: `${summary.counts.rejected_ours} delivery(ies) rejected because of our own configuration.`,
      detail:
        "These were turned away for a reason that is ours, not Leafly's: the HMAC key is missing " +
        "or unusable. Leafly sent a valid request and we could not check it.",
      nextStep:
        "Open Integrations → Leafly and paste the HMAC key Leafly issued alongside your client " +
        "credentials. No redeploy is needed; the next delivery will verify.",
    };
  }

  if (summary.verified === 0) {
    return {
      code: "all_rejected",
      tone: "bad",
      headline: `All ${summary.total} delivery(ies) failed signature verification.`,
      detail:
        "Deliveries are reaching us — so the URLs are right — but not one signature matched. " +
        "The usual cause is that the HMAC key saved here is not the key Leafly is signing with.",
      nextStep:
        "Re-copy the HMAC key from Leafly and save it again, watching for a truncated paste or a " +
        "trailing space. If it still fails on every delivery, ask Leafly to confirm the key and " +
        "whether the signature is hex or base64 encoded.",
    };
  }

  // NOTE: no `|| counts.rejected_unknown > 0` here. `classifyEvidenceDelivery`
  // can only return `rejected_unknown` on its unverified branch, so such a row
  // ALWAYS increments `unverified` and the extra clause would be unreachable.
  // Dead conditions are worse than useless: they survive mutation testing and
  // so advertise coverage that does not exist. The invariant is asserted in the
  // self-tests instead.
  if (summary.unverified > 0) {
    return {
      code: "some_rejected",
      tone: "warn",
      headline: `${summary.verified} of ${summary.total} deliveries verified; ${summary.unverified} did not.`,
      detail:
        "The integration is working, but some deliveries were turned away. A handful dated before " +
        "you saved the key is ordinary history. Recent ones are not, and a key rotation is the " +
        "most likely cause.",
      nextStep:
        "Check the timestamps of the rejected rows below. If any are recent, re-save the HMAC key. " +
        "If they are all old, no action is needed — they are the record of the integration being " +
        "set up.",
    };
  }

  return {
    code: "healthy",
    tone: "good",
    headline: `All ${summary.total} deliveries verified.`,
    detail:
      "Every delivery Leafly made was authenticated and handled. This is the log Leafly reviews " +
      "at certification, and it currently reads clean.",
    nextStep: null,
  };
}

// ---------------------------------------------------------------------------
// Certification evidence
// ---------------------------------------------------------------------------

/**
 * Leafly's order-integration certification is "validated by review of logged
 * activity", and the single hard, quotable number in the order spec is:
 *
 *   "Orders are acknowledged as having been retrieved in whole by your system
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders not acknowledged by this deadline will be auto canceled."
 *
 * So the one thing our log can PROVE about order certification is the
 * acknowledgement record. This function computes it from the non-PII order
 * projection.
 *
 * `LEAFLY_ACK_WINDOW_MINUTES` is imported from order-ack-core rather than
 * restated (rule 11): fifteen is Leafly's number and lives in exactly one file.
 */
export type AckEvidence = {
  submissions: number;
  acknowledged: number;
  /** Acknowledged after `acknowledgeBy` had already passed. */
  lateAcknowledged: number;
  /** Still unacknowledged and the deadline has passed. */
  missed: number;
  /** Still unacknowledged, deadline still ahead. */
  pending: number;
  /** Slowest acknowledgement, whole minutes from first sight. Null if none. */
  slowestAckMinutes: number | null;
  /** Fastest acknowledgement, whole minutes. Null if none. */
  fastestAckMinutes: number | null;
  windowMinutes: number;
};

export function summarizeAckEvidence(
  orders: readonly EvidenceOrderRow[],
  nowIso: string,
): AckEvidence {
  const now = Date.parse(nowIso);
  let acknowledged = 0;
  let lateAcknowledged = 0;
  let missed = 0;
  let pending = 0;
  let slowest: number | null = null;
  let fastest: number | null = null;

  for (const o of orders) {
    const ackedAt = Date.parse(o.acknowledgedAt ?? "");
    const deadline = Date.parse(o.acknowledgeBy ?? "");
    const seen = Date.parse(o.firstSeenAt ?? "");

    if (Number.isFinite(ackedAt)) {
      acknowledged += 1;
      // Late is measured against LEAFLY'S OWN deadline, never against a
      // locally recomputed one. 0225 records `acknowledge_by` verbatim from
      // the submission webhook precisely so this comparison is Leafly's.
      if (Number.isFinite(deadline) && ackedAt > deadline) lateAcknowledged += 1;
      if (Number.isFinite(seen)) {
        const mins = Math.round((ackedAt - seen) / 60000);
        if (slowest === null || mins > slowest) slowest = mins;
        if (fastest === null || mins < fastest) fastest = mins;
      }
      continue;
    }

    // Unacknowledged. An unreadable or absent deadline counts as PENDING, not
    // as missed: accusing ourselves of a miss we cannot evidence would corrupt
    // the very record Leafly reviews. House rule 3 -- never invent a value.
    if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) missed += 1;
    else pending += 1;
  }

  return {
    submissions: orders.length,
    acknowledged,
    lateAcknowledged,
    missed,
    pending,
    slowestAckMinutes: slowest,
    fastestAckMinutes: fastest,
    windowMinutes: LEAFLY_ACK_WINDOW_MINUTES,
  };
}

/**
 * Render the log as certification criteria, using
 * `CertificationCriterionStatus` from certification-core so the menu and order
 * sides of certification speak one vocabulary (`pass|fail|unknown|attest`).
 *
 * `unknown` is used honestly and often: with no traffic we genuinely cannot
 * claim a pass, and claiming one would be the exact failure mode house rule 2
 * exists to prevent.
 */
export type EvidenceCriterion = {
  id: string;
  title: string;
  status: CertificationCriterionStatus;
  detail: string;
};

export function buildEvidenceCriteria(
  summary: EvidenceSummary,
  ack: AckEvidence,
): EvidenceCriterion[] {
  const out: EvidenceCriterion[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // REACHABILITY MUST MEAN "LEAFLY REACHED US", NOT "SOMEBODY REACHED US".
  //
  // This criterion used to read `summary.total === 0 ? "unknown" : "pass"`, so
  // ANY logged delivery turned it green. In the sandbox review the only four
  // deliveries on record were unsigned probes from the open internet, every one
  // of them correctly refused with a 401 - and this criterion reported, on a
  // page headed "certification evidence", that Leafly could reach our webhook.
  //
  // Nothing had ever arrived from Leafly. A port scanner had proved that our
  // DNS resolves. Those are not the same claim, and the second one is the one
  // certification turns on.
  //
  // Only a signature-verified delivery proves Leafly reached us: the signature
  // is the only thing in the request that a stranger cannot forge. So the pass
  // condition is `verified > 0`. Unsigned traffic alone is reported as its own
  // honest state - we are online and refusing strangers, which is worth seeing,
  // but it is NOT reachability.
  // ─────────────────────────────────────────────────────────────────────────
  const unsignedOnly = summary.total > 0 && summary.verified === 0;
  out.push({
    id: "deliveries-received",
    title: "Leafly can reach our webhook endpoints",
    status: summary.verified > 0 ? "pass" : "unknown",
    detail:
      summary.total === 0
        ? "No deliveries logged, so reachability is unproven. Expected before Leafly activates the sandbox integration."
        : unsignedOnly
          ? `${summary.total} request(s) reached the endpoint, but NONE carried a valid Leafly signature, so none of them prove Leafly reached us — unsigned traffic is almost always internet scanners, and refusing it is correct. Reachability stays unproven until the first signature-verified delivery arrives.`
          : `${summary.verified} signature-verified delivery(ies) from Leafly, out of ${summary.total} request(s) logged, between ${summary.firstReceivedAt ?? "?"} and ${summary.lastReceivedAt ?? "?"}.`,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE SAME CONFUSION, IN REVERSE.
  //
  // This criterion used to fail whenever `unverified > 0`. An unsigned probe
  // increments `unverified`, so four internet scanners - refused exactly as
  // intended - made a certification page report FAIL against the HMAC
  // criterion. A security control working perfectly was rendered as a defect.
  //
  // Only a delivery that CARRIED a signature can say anything about our
  // signature handling. Requests with no signature at all are excluded from the
  // judgement and reported separately, so both facts stay visible without
  // either one contaminating the other.
  // ─────────────────────────────────────────────────────────────────────────
  const unsigned = summary.counts.rejected_unsigned;
  const signedAttempts = summary.total - unsigned;
  const badlySigned = summary.unverified - unsigned;
  const unsignedNote =
    unsigned > 0
      ? ` (${unsigned} further request(s) arrived unsigned and were turned away — those are scanners, not Leafly, and they say nothing about our key.)`
      : "";

  out.push({
    id: "signatures-verified",
    title: "Every signed delivery verifies (HMAC-SHA-256)",
    status: signedAttempts === 0 ? "unknown" : badlySigned === 0 ? "pass" : "fail",
    detail:
      signedAttempts === 0
        ? `No signed deliveries to verify yet.${unsignedNote}`
        : badlySigned === 0
          ? `All ${signedAttempts} signed delivery(ies) verified.${unsignedNote}`
          : `${badlySigned} of ${signedAttempts} signed delivery(ies) failed verification. That is the signature of a rotated key — re-copy the HMAC key from Leafly.${unsignedNote}`,
  });

  out.push({
    id: "ack-window",
    title: `Order submissions acknowledged within ${ack.windowMinutes} minutes`,
    status:
      ack.submissions === 0
        ? "unknown"
        : ack.missed > 0 || ack.lateAcknowledged > 0
          ? "fail"
          : ack.pending > 0
            ? "unknown"
            : "pass",
    detail:
      ack.submissions === 0
        ? "No orders received yet, so the acknowledgement window is unproven."
        : `${ack.acknowledged} of ${ack.submissions} acknowledged` +
          (ack.lateAcknowledged > 0 ? `, ${ack.lateAcknowledged} after Leafly's deadline` : "") +
          (ack.missed > 0 ? `, ${ack.missed} missed entirely` : "") +
          (ack.pending > 0 ? `, ${ack.pending} still inside the window` : "") +
          ".",
  });

  out.push({
    id: "responses-compliant",
    title: 'Verified deliveries answered with 200 or 201',
    status:
      summary.total === 0
        ? "unknown"
        : summary.anomalyCounts.bad_response_status === 0 &&
            summary.anomalyCounts.no_response_status === 0
          ? "pass"
          : "fail",
    detail:
      summary.total === 0
        ? "No deliveries answered yet."
        : summary.anomalyCounts.bad_response_status === 0 &&
            summary.anomalyCounts.no_response_status === 0
          ? 'Every verified delivery was answered inside the spec\'s "200 or 201" rule.'
          : `${summary.anomalyCounts.bad_response_status} answered outside 200/201; ` +
            `${summary.anomalyCounts.no_response_status} with no recorded response.`,
  });

  out.push({
    id: "idempotency",
    title: "Duplicate deliveries do no work twice",
    status: "attest",
    detail:
      "Enforced structurally, not by review: leafly_webhook_events.body_sha256 is UNIQUE, so a " +
      "byte-identical retry cannot be inserted a second time. Proven by the unique constraint " +
      "in migration 0225 and by the migration-execution gate, not by counting rows here.",
  });

  return out;
}

// ---------------------------------------------------------------------------
// Export bundle (fed to src/lib/reports/workbook.ts)
// ---------------------------------------------------------------------------

/**
 * A table destined for `buildCsv`/`buildXlsx`. Structurally compatible with
 * `TableSheet` from `src/lib/reports/workbook.ts` but declared locally as a
 * plain shape so this pure module stays free of a server-only import
 * (workbook.ts pulls in exceljs).
 *
 * Rule 11 is still satisfied: we are not re-implementing CSV. The escaping,
 * the content types and the filename handling all remain workbook.ts's job.
 * This is only the data.
 */
export type EvidenceSheet = {
  name: string;
  caption?: string;
  columns: { key: string; header: string; type?: "text" | "number" | "integer" }[];
  rows: Record<string, string | number | null>[];
};

/**
 * Audit EVERY column key of EVERY sheet and return the forbidden ones,
 * namespaced `SheetName.key` so a violation names the exact place to look.
 *
 * Exported -- and NOT inlined in `buildEvidenceBundle` -- deliberately. When
 * this loop lived inside the builder, the only way to reach it was through a
 * bundle we construct ourselves, and every bundle we construct is clean. So
 * every assertion tested `privacyViolations.length === 0`: the guard was only
 * ever exercised in the state where it is silent. Mutation M11 deleted the
 * `violations.push(...)` line and the entire suite still passed, which is the
 * definition of a guard that cannot fail.
 *
 * Pulling it out lets the self-tests hand it a deliberately POISONED sheet and
 * insist that it speaks up. The privacy promise in this slice is the one
 * promise that must never be able to break quietly: the owner is going to send
 * the exported file to Leafly and to me.
 *
 * Returns ALL violations, not the first. A partial report would let a second
 * mistake hide behind the fix for the first.
 */
export function auditEvidenceSheets(sheets: readonly EvidenceSheet[]): string[] {
  const violations: string[] = [];
  for (const sheet of sheets) {
    for (const bad of auditEvidenceKeys(sheet.columns.map((c) => c.key))) {
      violations.push(`${sheet.name}.${bad}`);
    }
  }
  return violations;
}

export type EvidenceBundle = {
  filename: string;
  title: string;
  sheets: EvidenceSheet[];
  /** Any forbidden keys detected. MUST be empty; surfaced, never silently dropped. */
  privacyViolations: string[];
};

/** Deterministic, sortable, timezone-explicit filename stem. */
export function evidenceFilename(nowIso: string): string {
  const t = Date.parse(nowIso);
  const stamp = Number.isFinite(t)
    ? new Date(t).toISOString().slice(0, 19).replace(/[:T]/g, "-")
    : "unknown-time";
  return `leafly-evidence-${stamp}`;
}

/**
 * Build the whole bundle the owner downloads and sends to me or to Leafly.
 *
 * Four sheets, because they answer four different questions:
 *   Summary     -- the verdict and the totals, so the file is readable alone.
 *   Criteria    -- the certification read-out.
 *   Deliveries  -- every delivery, classified, with its anomalies.
 *   Orders      -- the acknowledgement record, non-PII columns only.
 *
 * Every emitted column key is audited against `EVIDENCE_FORBIDDEN_KEYS`, and
 * violations are RETURNED rather than dropped. A silent drop would hide a
 * modelling error; a loud, empty-by-assertion list turns the privacy promise
 * into something the tests can prove.
 */
export function buildEvidenceBundle(input: {
  events: readonly EvidenceEventRow[];
  orders: readonly EvidenceOrderRow[];
  nowIso: string;
}): EvidenceBundle {
  const summary = summarizeEvidence(input.events);
  const verdict = assessEvidence(summary);
  const ack = summarizeAckEvidence(input.orders, input.nowIso);
  const criteria = buildEvidenceCriteria(summary, ack);

  const summarySheet: EvidenceSheet = {
    name: "Summary",
    caption: "Leafly webhook evidence — overview",
    columns: [
      { key: "item", header: "Item" },
      { key: "value", header: "Value" },
    ],
    rows: [
      { item: "Generated at (UTC)", value: input.nowIso },
      { item: "Verdict", value: verdict.code },
      { item: "Headline", value: verdict.headline },
      { item: "Next step", value: verdict.nextStep ?? "(none)" },
      { item: "Deliveries logged", value: summary.total },
      { item: "Signature verified", value: summary.verified },
      { item: "Signature failed", value: summary.unverified },
      { item: "Accepted and finished", value: summary.counts.accepted },
      { item: "Accepted, not finished", value: summary.counts.accepted_unprocessed },
      { item: "Rejected — our config", value: summary.counts.rejected_ours },
      { item: "Rejected — bad signature", value: summary.counts.rejected_theirs },
      { item: "Turned away — unsigned", value: summary.counts.rejected_unsigned },
      { item: "Rejected — unrecognised", value: summary.counts.rejected_unknown },
      { item: "Distinct orders referenced", value: summary.distinctOrders },
      { item: "First delivery", value: summary.firstReceivedAt ?? "(none)" },
      { item: "Last delivery", value: summary.lastReceivedAt ?? "(none)" },
      { item: "Order submissions tracked", value: ack.submissions },
      { item: "Acknowledged", value: ack.acknowledged },
      { item: "Acknowledged late", value: ack.lateAcknowledged },
      { item: "Acknowledgement missed", value: ack.missed },
      { item: "Acknowledgement pending", value: ack.pending },
      { item: "Ack window (minutes)", value: ack.windowMinutes },
      { item: "Fastest ack (minutes)", value: ack.fastestAckMinutes ?? "(none)" },
      { item: "Slowest ack (minutes)", value: ack.slowestAckMinutes ?? "(none)" },
    ],
  };

  for (const code of ALL_EVIDENCE_ANOMALY_CODES) {
    summarySheet.rows.push({
      item: `Anomaly — ${evidenceAnomalyLabel(code)}`,
      value: summary.anomalyCounts[code],
    });
  }
  for (const [type, n] of Object.entries(summary.byEventType).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    summarySheet.rows.push({ item: `Event type — ${type}`, value: n });
  }

  const criteriaSheet: EvidenceSheet = {
    name: "Criteria",
    caption: "What this log proves",
    columns: [
      { key: "id", header: "Criterion" },
      { key: "title", header: "Requirement" },
      { key: "status", header: "Status" },
      { key: "detail", header: "Evidence" },
    ],
    rows: criteria.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      detail: c.detail,
    })),
  };

  const deliveriesSheet: EvidenceSheet = {
    name: "Deliveries",
    caption: "Every webhook delivery Leafly made",
    columns: [
      { key: "receivedAt", header: "Received (UTC)" },
      { key: "eventTime", header: "Leafly event time" },
      { key: "skewMinutes", header: "Skew (min)", type: "integer" },
      { key: "eventType", header: "Event type" },
      { key: "orderId", header: "Leafly order id" },
      { key: "disposition", header: "Outcome" },
      { key: "rejectionReason", header: "Rejection reason" },
      { key: "responseStatus", header: "We answered", type: "integer" },
      { key: "processedAt", header: "Finished at" },
      { key: "anomalies", header: "Anomalies" },
      { key: "bodySha256", header: "Body SHA-256" },
    ],
    rows: input.events.map((e) => ({
      receivedAt: e.receivedAt,
      eventTime: e.eventTime,
      skewMinutes: evidenceClockSkewMinutes(e),
      eventType: e.eventType,
      orderId: e.orderId,
      disposition: classifyEvidenceDelivery(e),
      rejectionReason: e.rejectionReason,
      responseStatus: e.responseStatus,
      processedAt: e.processedAt,
      anomalies:
        findEvidenceAnomalies(e)
          .map((a) => a.code)
          .join(" ") || "",
      // The hash, NOT the body. Proves two deliveries were byte-identical
      // without ever carrying the customer data the body contained.
      bodySha256: e.bodySha256,
    })),
  };

  const ordersSheet: EvidenceSheet = {
    name: "Orders",
    caption: "Acknowledgement record (no customer data)",
    columns: [
      { key: "leaflyOrderId", header: "Leafly order id" },
      { key: "firstSeenAt", header: "First seen (UTC)" },
      { key: "leaflyStatus", header: "Leafly status" },
      { key: "fulfillmentMechanism", header: "Fulfilment" },
      { key: "acknowledgeBy", header: "Leafly ack deadline" },
      { key: "acknowledgedAt", header: "We acknowledged at" },
      { key: "ackMinutes", header: "Ack took (min)", type: "integer" },
      { key: "ackOutcome", header: "Ack outcome" },
    ],
    rows: input.orders.map((o) => {
      const seen = Date.parse(o.firstSeenAt ?? "");
      const acked = Date.parse(o.acknowledgedAt ?? "");
      const deadline = Date.parse(o.acknowledgeBy ?? "");
      const now = Date.parse(input.nowIso);
      let outcome: string;
      if (Number.isFinite(acked)) {
        outcome = Number.isFinite(deadline) && acked > deadline ? "late" : "on_time";
      } else if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) {
        outcome = "missed";
      } else {
        outcome = "pending";
      }
      return {
        leaflyOrderId: o.leaflyOrderId,
        firstSeenAt: o.firstSeenAt,
        leaflyStatus: o.leaflyStatus,
        fulfillmentMechanism: o.fulfillmentMechanism,
        acknowledgeBy: o.acknowledgeBy,
        acknowledgedAt: o.acknowledgedAt,
        ackMinutes:
          Number.isFinite(acked) && Number.isFinite(seen)
            ? Math.round((acked - seen) / 60000)
            : null,
        ackOutcome: outcome,
      };
    }),
  };

  const sheets = [summarySheet, criteriaSheet, deliveriesSheet, ordersSheet];

  // Audit EVERY column key of EVERY sheet. Cheap, total, and the thing that
  // turns "we don't export PII" from a claim into a checked invariant.
  // See auditEvidenceSheets for why this is a named function and not a loop
  // inlined here (mutation survivor M11).
  const violations = auditEvidenceSheets(sheets);

  return {
    filename: evidenceFilename(input.nowIso),
    title: "Leafly webhook evidence",
    sheets,
    privacyViolations: violations,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

/**
 * Returns {passed, failed} so `assertRan` in
 * scripts/compliance/run-pure-selftests.ts can enforce a FLOOR. A suite that
 * silently stops asserting is not a passing suite -- that is the vacuous-pass
 * lesson, and it is why every loop below also asserts its own iteration count.
 */
export function __runLeaflyEvidenceTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else failures.push(msg);
  };

  const ev = (over: Partial<EvidenceEventRow> = {}): EvidenceEventRow => ({
    id: "e1",
    eventType: "order_submit",
    orderId: "ord-1",
    orderIntegrationKey: "key-1",
    eventTime: "2026-09-18T10:00:00.000Z",
    receivedAt: "2026-09-18T10:00:05.000Z",
    bodySha256: "a".repeat(64),
    signatureVerified: true,
    rejectionReason: null,
    responseStatus: 200,
    processedAt: "2026-09-18T10:00:06.000Z",
    ...over,
  });

  // ---- privacy guard -------------------------------------------------------
  ok(normalizeEvidenceKey("phone_number") === "phonenumber", "normalize strips underscores");
  ok(normalizeEvidenceKey("Phone-Number") === "phonenumber", "normalize strips dashes + case");
  ok(normalizeEvidenceKey("date of birth") === "dateofbirth", "normalize strips spaces");
  ok(isForbiddenEvidenceKey("emailAddress"), "emailAddress forbidden");
  ok(isForbiddenEvidenceKey("customer_phone_number"), "substring match catches prefixed PII");
  ok(isForbiddenEvidenceKey("raw_order"), "raw_order forbidden");
  ok(isForbiddenEvidenceKey("medicalCardNumber"), "medical card number forbidden");
  ok(isForbiddenEvidenceKey("deliveryAddress"), "delivery address forbidden");
  ok(isForbiddenEvidenceKey("dateOfBirth"), "dob forbidden");
  // Not-forbidden side. Without these the guard could return true always and
  // still "pass" every assertion above -- the classic vacuous-guard trap.
  ok(!isForbiddenEvidenceKey("leaflyOrderId"), "order id allowed");
  ok(!isForbiddenEvidenceKey("fulfillmentMechanism"), "fulfilment allowed");
  ok(!isForbiddenEvidenceKey("bodySha256"), "body hash allowed");
  ok(!isForbiddenEvidenceKey("receivedAt"), "timestamp allowed");
  ok(!isForbiddenEvidenceKey("responseStatus"), "response status allowed");
  ok(auditEvidenceKeys(["orderId", "emailAddress"]).length === 1, "audit finds exactly one");
  ok(auditEvidenceKeys(["orderId", "emailAddress"])[0] === "emailAddress", "audit names the key");
  ok(auditEvidenceKeys([]).length === 0, "audit of nothing is clean");

  // Every declared forbidden key must actually BE forbidden by the checker.
  let forbiddenChecked = 0;
  for (const k of EVIDENCE_FORBIDDEN_KEYS) {
    forbiddenChecked += 1;
    ok(isForbiddenEvidenceKey(k), `declared forbidden key is enforced: ${k}`);
  }
  ok(forbiddenChecked === EVIDENCE_FORBIDDEN_KEYS.length, "swept every forbidden key");
  ok(forbiddenChecked >= 18, "forbidden list did not shrink below 18 entries");

  // ---- classification ------------------------------------------------------
  ok(classifyEvidenceDelivery(ev()) === "accepted", "verified + processed = accepted");
  ok(
    classifyEvidenceDelivery(ev({ processedAt: null })) === "accepted_unprocessed",
    "verified + unprocessed is its own state",
  );
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: "missing_key" })) ===
      "rejected_ours",
    "missing_key is our fault",
  );
  ok(
    classifyEvidenceDelivery(
      ev({ signatureVerified: false, rejectionReason: "digest_unavailable" }),
    ) === "rejected_ours",
    "digest_unavailable is our fault",
  );
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: "mismatch" })) ===
      "rejected_theirs",
    "mismatch is not our fault",
  );
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: "nonsense" })) ===
      "rejected_unknown",
    "unrecognised reason is not silently bucketed",
  );
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: null })) ===
      "rejected_unknown",
    "null reason on an unverified row is unknown",
  );
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: "   " })) ===
      "rejected_unknown",
    "whitespace reason is unknown",
  );
  // Verification wins over a stray rejection reason -- the documented order.
  ok(
    classifyEvidenceDelivery(ev({ signatureVerified: true, rejectionReason: "mismatch" })) ===
      "accepted",
    "verified row is never a rejection even with a reason set",
  );

  // Every hmac-core reason must classify, and must land on the correct side.
  let reasonsSwept = 0;
  let oursSeen = 0;
  let theirsSeen = 0;
  let unsignedSeen = 0;
  for (const r of LEAFLY_HMAC_FAILURE_REASONS) {
    reasonsSwept += 1;
    const d = classifyEvidenceDelivery(ev({ signatureVerified: false, rejectionReason: r }));
    ok(d !== "rejected_unknown", `declared reason ${r} is recognised`);
    if (d === "rejected_ours") oursSeen += 1;
    if (d === "rejected_theirs") theirsSeen += 1;
    if (d === "rejected_unsigned") unsignedSeen += 1;
    ok(isRecognisedRejectionReason(r), `isRecognisedRejectionReason accepts ${r}`);
  }
  ok(reasonsSwept === LEAFLY_HMAC_FAILURE_REASONS.length, "swept every hmac reason");
  ok(reasonsSwept === 7, "hmac-core still declares exactly 7 reasons");
  // Absolute counts, not counts relative to the list -- the L-7 M27 lesson.
  ok(oursSeen === 2, "exactly two reasons are our fault");
  // Was 5. `missing_header` now has its own disposition, because a request that
  // carried NO signature cannot be evidence of a key mismatch, and advising a
  // key rotation over one is how a working system gets broken by hand.
  ok(theirsSeen === 4, "exactly four reasons indict a signature that WAS sent");
  ok(unsignedSeen === 1, "exactly one reason means no signature was sent at all");
  ok(oursSeen + theirsSeen + unsignedSeen === 7, "every declared reason lands in exactly one bucket");
  ok(!isRecognisedRejectionReason("totally_made_up"), "unknown reason rejected by the recogniser");
  ok(!isRecognisedRejectionReason(""), "empty reason rejected by the recogniser");

  // Tone + label + explanation total over the union.
  let dispSwept = 0;
  const tones = new Set<EvidenceTone>();
  for (const d of ALL_EVIDENCE_DISPOSITIONS) {
    dispSwept += 1;
    const tone = evidenceDispositionTone(d);
    tones.add(tone);
    ok(
      tone === "good" || tone === "warn" || tone === "bad" || tone === "info",
      `tone for ${d} is a known tone`,
    );
    ok(evidenceDispositionLabel(d).length > 0, `label for ${d}`);
    ok(evidenceDispositionExplanation(d).length > 40, `explanation for ${d} is substantive`);
  }
  ok(dispSwept === ALL_EVIDENCE_DISPOSITIONS.length, "swept every disposition");
  ok(dispSwept === 6, "exactly six dispositions");
  // Pin tones BY NAME, not just "some known tone" -- the L-7 M59 lesson.
  ok(evidenceDispositionTone("accepted") === "good", "accepted is good");
  ok(evidenceDispositionTone("rejected_ours") === "bad", "our-fault rejection is bad");
  ok(evidenceDispositionTone("rejected_theirs") === "bad", "signature rejection is bad");
  ok(evidenceDispositionTone("accepted_unprocessed") === "warn", "unprocessed is a warning");
  ok(evidenceDispositionTone("rejected_unknown") === "warn", "unknown reason is a warning");
  // "info", and deliberately so: an unsigned request turned away is the lock
  // working. Painting routine internet noise red teaches the owner that red
  // means nothing, which is how a real alarm gets missed.
  ok(evidenceDispositionTone("rejected_unsigned") === "info", "an unsigned probe is informational");
  ok(tones.size === 4, "dispositions use exactly four distinct tones");
  // The our-fault explanation must tell the owner where to go.
  ok(
    evidenceDispositionExplanation("rejected_ours").includes("HMAC key"),
    "our-fault explanation names the HMAC key",
  );
  ok(
    evidenceDispositionExplanation("rejected_ours").includes("Integrations"),
    "our-fault explanation names the screen",
  );

  // ---- anomalies -----------------------------------------------------------
  ok(findEvidenceAnomalies(ev()).length === 0, "a clean row has no anomalies");
  const unknownType = findEvidenceAnomalies(ev({ eventType: "order_teleport" }));
  ok(unknownType.length === 1, "unknown event type yields exactly one anomaly");
  ok(unknownType[0].code === "unknown_event_type", "unknown event type code");
  ok(
    unknownType[0].detail.includes("order_teleport"),
    "unknown event anomaly quotes the offending value",
  );
  ok(
    unknownType[0].detail.includes("order_submit"),
    "unknown event anomaly lists the legal values",
  );
  const noType = findEvidenceAnomalies(ev({ eventType: null }));
  ok(noType.some((a) => a.code === "missing_event_type"), "null event type flagged");
  ok(!noType.some((a) => a.code === "unknown_event_type"), "null type is not ALSO 'unknown'");
  ok(
    findEvidenceAnomalies(ev({ eventType: "   " })).some((a) => a.code === "missing_event_type"),
    "whitespace event type is missing, not unknown",
  );

  // missing_order_id must respect leaflyEventCarriesAnOrder (rule 11).
  ok(
    findEvidenceAnomalies(ev({ eventType: "order_submit", orderId: null })).some(
      (a) => a.code === "missing_order_id",
    ),
    "order_submit without an order id is flagged",
  );
  ok(
    findEvidenceAnomalies(ev({ eventType: "order_submit", orderId: "  " })).some(
      (a) => a.code === "missing_order_id",
    ),
    "blank order id counts as missing",
  );
  // The false-alarm guard: activation webhooks legitimately carry no order.
  ok(
    !findEvidenceAnomalies(ev({ eventType: "order_activate", orderId: null })).some(
      (a) => a.code === "missing_order_id",
    ),
    "order_activate without an order id is NOT an anomaly",
  );
  ok(
    !findEvidenceAnomalies(ev({ eventType: "order_deactivate", orderId: null })).some(
      (a) => a.code === "missing_order_id",
    ),
    "order_deactivate without an order id is NOT an anomaly",
  );
  // ...and an unknown type must not also claim a missing order id, because we
  // have no idea whether that type is supposed to carry one.
  ok(
    !findEvidenceAnomalies(ev({ eventType: "order_teleport", orderId: null })).some(
      (a) => a.code === "missing_order_id",
    ),
    "unknown type does not assert an order-id requirement",
  );

  // Sweep the real event vocabulary and prove the split is 4 / 2.
  let typesSwept = 0;
  let carrying = 0;
  let notCarrying = 0;
  for (const t of LEAFLY_WEBHOOK_EVENT_TYPES) {
    typesSwept += 1;
    const flagged = findEvidenceAnomalies(ev({ eventType: t, orderId: null })).some(
      (a) => a.code === "missing_order_id",
    );
    if (flagged) carrying += 1;
    else notCarrying += 1;
    ok(
      !findEvidenceAnomalies(ev({ eventType: t })).some(
        (a) => a.code === "unknown_event_type" || a.code === "missing_event_type",
      ),
      `declared event type ${t} is not called unknown`,
    );
  }
  ok(typesSwept === LEAFLY_WEBHOOK_EVENT_TYPES.length, "swept every event type");
  ok(typesSwept === 6, "Leafly still declares exactly 6 event types");
  ok(carrying === 4, "exactly four event types require an order id");
  ok(notCarrying === 2, "exactly two event types carry no order");

  // Clock skew.
  ok(evidenceClockSkewMinutes(ev()) === 0, "5s skew rounds to 0 minutes");
  ok(
    evidenceClockSkewMinutes(
      ev({ eventTime: "2026-09-18T10:00:00.000Z", receivedAt: "2026-09-18T11:30:00.000Z" }),
    ) === 90,
    "90 minute positive skew computed",
  );
  ok(
    evidenceClockSkewMinutes(
      ev({ eventTime: "2026-09-18T12:00:00.000Z", receivedAt: "2026-09-18T10:00:00.000Z" }),
    ) === -120,
    "negative skew (Leafly in our future) computed",
  );
  ok(evidenceClockSkewMinutes(ev({ eventTime: null })) === null, "null event time = no skew");
  ok(
    evidenceClockSkewMinutes(ev({ eventTime: "not-a-date" })) === null,
    "unparseable event time = no skew",
  );
  ok(
    findEvidenceAnomalies(ev({ eventTime: null })).length === 0,
    "a missing event time is not itself an anomaly",
  );
  // Boundary: the threshold is exclusive (`> limit`), pinned on both sides.
  ok(
    !findEvidenceAnomalies(
      ev({ eventTime: "2026-09-18T10:00:00.000Z", receivedAt: "2026-09-18T11:00:00.000Z" }),
    ).some((a) => a.code === "clock_skew"),
    "exactly 60 minutes does NOT trip the skew limit",
  );
  ok(
    findEvidenceAnomalies(
      ev({ eventTime: "2026-09-18T10:00:00.000Z", receivedAt: "2026-09-18T11:01:00.000Z" }),
    ).some((a) => a.code === "clock_skew"),
    "61 minutes DOES trip the skew limit",
  );
  ok(
    findEvidenceAnomalies(
      ev({ eventTime: "2026-09-18T12:00:00.000Z", receivedAt: "2026-09-18T10:00:00.000Z" }),
    ).some((a) => a.code === "clock_skew"),
    "negative skew trips the limit too (absolute value)",
  );
  ok(
    findEvidenceAnomalies(
      ev({ eventTime: "2026-09-18T10:00:00.000Z", receivedAt: "2026-09-18T10:30:00.000Z" }),
      { skewMinutes: 10 },
    ).some((a) => a.code === "clock_skew"),
    "skew limit is overridable",
  );
  ok(EVIDENCE_CLOCK_SKEW_MINUTES === 60, "skew default pinned at 60 minutes");

  // Response status.
  ok(
    findEvidenceAnomalies(ev({ responseStatus: null })).some((a) => a.code === "no_response_status"),
    "missing response status flagged",
  );
  ok(
    findEvidenceAnomalies(ev({ responseStatus: 500 })).some(
      (a) => a.code === "bad_response_status",
    ),
    "500 on a verified delivery flagged",
  );
  ok(
    findEvidenceAnomalies(ev({ responseStatus: 201 })).length === 0,
    "201 is explicitly allowed by the spec",
  );
  ok(
    findEvidenceAnomalies(ev({ responseStatus: 200 })).length === 0,
    "200 is explicitly allowed by the spec",
  );
  // The load-bearing asymmetry: 401 on an UNVERIFIED delivery is correct
  // behaviour and must never be reported as a fault.
  ok(
    !findEvidenceAnomalies(
      ev({ signatureVerified: false, rejectionReason: "mismatch", responseStatus: 401 }),
    ).some((a) => a.code === "bad_response_status"),
    "401 on an unverified delivery is correct, not an anomaly",
  );
  ok(
    LEAFLY_EXPECTED_WEBHOOK_STATUSES.length === 2,
    "exactly two statuses are spec-approved",
  );
  ok(LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(200), "200 approved");
  ok(LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(201), "201 approved");
  ok(!LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(204), "204 is not webhook-approved");

  let anomSwept = 0;
  for (const c of ALL_EVIDENCE_ANOMALY_CODES) {
    anomSwept += 1;
    ok(evidenceAnomalyLabel(c).length > 0, `anomaly label for ${c}`);
  }
  ok(anomSwept === ALL_EVIDENCE_ANOMALY_CODES.length, "swept every anomaly code");
  ok(anomSwept === 6, "exactly six anomaly codes");

  // ---- summary -------------------------------------------------------------
  const empty = summarizeEvidence([]);
  ok(empty.total === 0, "empty summary total");
  ok(empty.verified === 0 && empty.unverified === 0, "empty summary verification counts");
  ok(empty.firstReceivedAt === null && empty.lastReceivedAt === null, "empty summary has no range");
  ok(empty.distinctOrders === 0, "empty summary has no orders");
  ok(Object.keys(empty.byEventType).length === 0, "empty summary has no event types");

  const mixed = summarizeEvidence([
    ev({ id: "1", receivedAt: "2026-09-18T10:00:00.000Z", orderId: "ord-1" }),
    ev({ id: "2", receivedAt: "2026-09-18T09:00:00.000Z", orderId: "ord-1" }),
    ev({ id: "3", receivedAt: "2026-09-18T11:00:00.000Z", orderId: "ord-2" }),
    ev({
      id: "4",
      receivedAt: "2026-09-18T12:00:00.000Z",
      signatureVerified: false,
      rejectionReason: "mismatch",
      responseStatus: 401,
      processedAt: null,
      eventType: "order_status",
      orderId: "ord-2",
    }),
    ev({
      id: "5",
      receivedAt: "2026-09-18T08:00:00.000Z",
      signatureVerified: false,
      rejectionReason: "missing_key",
      responseStatus: 401,
      processedAt: null,
      eventType: "order_activate",
      orderId: null,
    }),
  ]);
  ok(mixed.total === 5, "mixed summary counts every row");
  ok(mixed.verified === 3, "mixed verified count");
  ok(mixed.unverified === 2, "mixed unverified count");
  ok(mixed.counts.accepted === 3, "mixed accepted count");
  ok(mixed.counts.rejected_theirs === 1, "mixed their-fault count");
  ok(mixed.counts.rejected_ours === 1, "mixed our-fault count");
  ok(mixed.distinctOrders === 2, "mixed distinct orders dedupes ord-1");
  ok(mixed.firstReceivedAt === "2026-09-18T08:00:00.000Z", "earliest received found");
  ok(mixed.lastReceivedAt === "2026-09-18T12:00:00.000Z", "latest received found");
  ok(mixed.byEventType["order_submit"] === 3, "event type tally: submit");
  ok(mixed.byEventType["order_status"] === 1, "event type tally: status");
  ok(mixed.byEventType["order_activate"] === 1, "event type tally: activate");
  // Totals must reconcile. A summary whose parts do not sum is worthless as
  // evidence, so this is asserted rather than eyeballed.
  const dispSum = ALL_EVIDENCE_DISPOSITIONS.reduce((n, d) => n + mixed.counts[d], 0);
  ok(dispSum === mixed.total, "disposition counts sum to the total");
  const typeSum = Object.values(mixed.byEventType).reduce((n, v) => n + v, 0);
  ok(typeSum === mixed.total, "event-type counts sum to the total");
  ok(mixed.verified + mixed.unverified === mixed.total, "verified + unverified = total");

  const noTypeSummary = summarizeEvidence([ev({ eventType: null })]);
  ok(noTypeSummary.byEventType["(none)"] === 1, "null event type buckets as (none)");
  ok(
    noTypeSummary.anomalyCounts.missing_event_type === 1,
    "summary tallies the missing-type anomaly",
  );

  // ---- verdict -------------------------------------------------------------
  const silent = assessEvidence(summarizeEvidence([]));
  ok(silent.code === "silent", "no rows = silent");
  ok(silent.tone === "info", "silent is informational, not an error");
  ok(silent.nextStep !== null, "silent still tells the owner what to do");
  ok(
    silent.detail.includes("not a fault"),
    "silent explicitly says an empty log is not yet a fault",
  );

  const allClean = assessEvidence(summarizeEvidence([ev({ id: "a" }), ev({ id: "b" })]));
  ok(allClean.code === "healthy", "all verified = healthy");
  ok(allClean.tone === "good", "healthy is good");
  ok(allClean.nextStep === null, "healthy has no next step");

  const oursRow = ev({
    signatureVerified: false,
    rejectionReason: "missing_key",
    processedAt: null,
    responseStatus: 401,
  });
  const misconfigured = assessEvidence(summarizeEvidence([oursRow]));
  ok(misconfigured.code === "misconfigured", "our-fault rejection = misconfigured");
  ok(misconfigured.tone === "bad", "misconfigured is bad");
  ok(
    (misconfigured.nextStep ?? "").includes("HMAC key"),
    "misconfigured next step names the HMAC key",
  );

  const theirsRow = ev({
    signatureVerified: false,
    rejectionReason: "mismatch",
    processedAt: null,
    responseStatus: 401,
  });
  const allRejected = assessEvidence(summarizeEvidence([theirsRow, { ...theirsRow, id: "z" }]));
  ok(allRejected.code === "all_rejected", "no verified rows = all_rejected");
  ok(allRejected.tone === "bad", "all_rejected is bad");
  ok(
    (allRejected.nextStep ?? "").toLowerCase().includes("base64"),
    "all_rejected raises the hex/base64 question",
  );

  const someRejected = assessEvidence(summarizeEvidence([ev(), theirsRow]));
  ok(someRejected.code === "some_rejected", "a mixture = some_rejected");
  ok(someRejected.tone === "warn", "some_rejected is a warning, not an error");

  // THE ORDERING PROOF. A page where every delivery failed on `missing_key`
  // satisfies BOTH `misconfigured` and `all_rejected`. `misconfigured` must
  // win, because it is the one the owner can fix himself. Without this
  // assertion the two branches could be swapped and every other test here
  // would still pass.
  const bothApply = assessEvidence(summarizeEvidence([oursRow, { ...oursRow, id: "q" }]));
  ok(bothApply.code === "misconfigured", "our-fault outranks all-rejected when both apply");
  // And the mirror: a page with our-fault AND verified traffic is still
  // misconfigured, never rounded up to some_rejected.
  const oursPlusGood = assessEvidence(summarizeEvidence([ev(), oursRow]));
  ok(oursPlusGood.code === "misconfigured", "our-fault outranks some_rejected too");
  // An unrecognised reason must not be rounded up to healthy.
  const unknownOnly = assessEvidence(
    summarizeEvidence([
      ev(),
      // NOTE the `signatureVerified: false`. A first draft of this fixture left
      // it true, which made the row `accepted` and the whole assertion vacuous
      // -- it passed for the wrong reason. Caught by running the suite, kept
      // here as the reason this fixture is spelled out in full.
      ev({
        id: "u",
        signatureVerified: false,
        rejectionReason: "weird_new_reason",
        processedAt: null,
        responseStatus: 401,
      }),
    ]),
  );
  ok(unknownOnly.code !== "healthy", "a stray unrecognised reason is not healthy");
  ok(unknownOnly.code === "some_rejected", "an unrecognised rejection lands in some_rejected");
  // An unrecognised reason implies the signature did NOT verify -- see
  // `classifyEvidenceDelivery`, which only reaches `rejected_unknown` on the
  // unverified branch. Asserted so the invariant is checked rather than assumed.
  const unknownSummary = summarizeEvidence([
    ev({ signatureVerified: false, rejectionReason: "weird", processedAt: null }),
  ]);
  ok(
    unknownSummary.counts.rejected_unknown === 1 && unknownSummary.unverified === 1,
    "rejected_unknown always implies unverified",
  );

  let verdictSwept = 0;
  for (const c of ALL_EVIDENCE_VERDICT_CODES) {
    verdictSwept += 1;
    ok(c.length > 0, `verdict code present: ${c}`);
  }
  ok(verdictSwept === 5, "exactly five verdict codes");

  // ---- acknowledgement evidence -------------------------------------------
  const NOW = "2026-09-18T12:00:00.000Z";
  const ord = (over: Partial<EvidenceOrderRow> = {}): EvidenceOrderRow => ({
    leaflyOrderId: "ord-1",
    leaflyStatus: "confirmed",
    fulfillmentMechanism: "pickup",
    acknowledgeBy: "2026-09-18T10:15:00.000Z",
    acknowledgedAt: "2026-09-18T10:05:00.000Z",
    firstSeenAt: "2026-09-18T10:00:00.000Z",
    ...over,
  });

  const ackEmpty = summarizeAckEvidence([], NOW);
  ok(ackEmpty.submissions === 0, "no orders = no submissions");
  ok(ackEmpty.slowestAckMinutes === null, "no orders = no slowest");
  ok(ackEmpty.fastestAckMinutes === null, "no orders = no fastest");
  ok(ackEmpty.windowMinutes === LEAFLY_ACK_WINDOW_MINUTES, "window comes from order-ack-core");
  ok(ackEmpty.windowMinutes === 15, "Leafly's window is still 15 minutes");

  const onTime = summarizeAckEvidence([ord()], NOW);
  ok(onTime.acknowledged === 1, "on-time ack counted");
  ok(onTime.lateAcknowledged === 0, "on-time ack not called late");
  ok(onTime.missed === 0 && onTime.pending === 0, "acked order is neither missed nor pending");
  ok(onTime.fastestAckMinutes === 5, "ack latency measured from first sight");
  ok(onTime.slowestAckMinutes === 5, "single order is both fastest and slowest");

  const late = summarizeAckEvidence(
    [ord({ acknowledgedAt: "2026-09-18T10:20:00.000Z" })],
    NOW,
  );
  ok(late.lateAcknowledged === 1, "ack after Leafly's deadline is late");
  ok(late.acknowledged === 1, "a late ack still counts as acknowledged");
  ok(late.slowestAckMinutes === 20, "late ack latency measured");
  // Boundary: exactly ON the deadline is NOT late (comparison is strict `>`).
  const exactly = summarizeAckEvidence(
    [ord({ acknowledgedAt: "2026-09-18T10:15:00.000Z" })],
    NOW,
  );
  ok(exactly.lateAcknowledged === 0, "acking exactly on the deadline is not late");

  const missed = summarizeAckEvidence([ord({ acknowledgedAt: null })], NOW);
  ok(missed.missed === 1, "unacknowledged past deadline = missed");
  ok(missed.pending === 0, "a missed order is not pending");
  ok(missed.acknowledged === 0, "a missed order is not acknowledged");

  const pending = summarizeAckEvidence(
    [ord({ acknowledgedAt: null, acknowledgeBy: "2026-09-18T12:30:00.000Z" })],
    NOW,
  );
  ok(pending.pending === 1, "unacknowledged before deadline = pending");
  ok(pending.missed === 0, "a pending order is not missed");

  // House rule 3: an unknown deadline must NOT be recorded as a miss we
  // cannot evidence. This protects the integrity of the certification record.
  const noDeadline = summarizeAckEvidence([ord({ acknowledgedAt: null, acknowledgeBy: null })], NOW);
  ok(noDeadline.pending === 1, "no deadline + unacked = pending, never invented as missed");
  ok(noDeadline.missed === 0, "we never claim a miss we cannot evidence");
  const badDeadline = summarizeAckEvidence(
    [ord({ acknowledgedAt: null, acknowledgeBy: "not-a-date" })],
    NOW,
  );
  ok(badDeadline.pending === 1, "unparseable deadline + unacked = pending");
  ok(badDeadline.missed === 0, "unparseable deadline never counted as missed");
  // A late ack against an unreadable deadline cannot be proven late either.
  const lateUnprovable = summarizeAckEvidence([ord({ acknowledgeBy: "not-a-date" })], NOW);
  ok(lateUnprovable.acknowledged === 1, "ack with unreadable deadline still counts as acked");
  ok(lateUnprovable.lateAcknowledged === 0, "lateness is never asserted without a deadline");

  const spread = summarizeAckEvidence(
    [
      ord({ leaflyOrderId: "a", acknowledgedAt: "2026-09-18T10:01:00.000Z" }),
      ord({ leaflyOrderId: "b", acknowledgedAt: "2026-09-18T10:09:00.000Z" }),
      ord({ leaflyOrderId: "c", acknowledgedAt: null }),
    ],
    NOW,
  );
  ok(spread.submissions === 3, "all submissions counted");
  ok(spread.fastestAckMinutes === 1, "fastest across a spread");
  ok(spread.slowestAckMinutes === 9, "slowest across a spread");
  ok(
    spread.acknowledged + spread.missed + spread.pending === spread.submissions,
    "ack buckets partition the submissions exactly",
  );

  // ---- criteria ------------------------------------------------------------
  const critEmpty = buildEvidenceCriteria(summarizeEvidence([]), summarizeAckEvidence([], NOW));
  ok(critEmpty.length === 5, "five criteria reported");
  let unknownCount = 0;
  let attestCount = 0;
  let critSwept = 0;
  for (const c of critEmpty) {
    critSwept += 1;
    ok(c.id.length > 0, `criterion ${c.id} has an id`);
    ok(c.title.length > 0, `criterion ${c.id} has a title`);
    ok(c.detail.length > 0, `criterion ${c.id} has evidence text`);
    ok(
      c.status === "pass" || c.status === "fail" || c.status === "unknown" || c.status === "attest",
      `criterion ${c.id} uses the certification-core vocabulary`,
    );
    if (c.status === "unknown") unknownCount += 1;
    if (c.status === "attest") attestCount += 1;
  }
  ok(critSwept === 5, "swept every criterion");
  // With no traffic, nothing may claim a pass. This is house rule 2 encoded.
  ok(unknownCount === 4, "with no traffic, four criteria are honestly unknown");
  ok(attestCount === 1, "idempotency is structural, so it attests rather than measures");
  ok(
    critEmpty.every((c) => c.status !== "pass"),
    "an empty log never reports a passing criterion",
  );

  const critGood = buildEvidenceCriteria(
    summarizeEvidence([ev({ id: "g1" }), ev({ id: "g2" })]),
    summarizeAckEvidence([ord()], NOW),
  );
  ok(
    critGood.find((c) => c.id === "deliveries-received")?.status === "pass",
    "reachability passes with traffic",
  );
  ok(
    critGood.find((c) => c.id === "signatures-verified")?.status === "pass",
    "verification passes when all verified",
  );
  ok(critGood.find((c) => c.id === "ack-window")?.status === "pass", "ack passes when on time");
  ok(
    critGood.find((c) => c.id === "responses-compliant")?.status === "pass",
    "responses pass on 200",
  );

  const critBad = buildEvidenceCriteria(
    summarizeEvidence([theirsRow]),
    summarizeAckEvidence([ord({ acknowledgedAt: null })], NOW),
  );
  ok(
    critBad.find((c) => c.id === "signatures-verified")?.status === "fail",
    "verification fails on an unverified delivery",
  );
  ok(critBad.find((c) => c.id === "ack-window")?.status === "fail", "ack fails on a miss");
  // A pending order is not a failure and not a pass -- it is unknown.
  const critPending = buildEvidenceCriteria(
    summarizeEvidence([ev()]),
    summarizeAckEvidence([ord({ acknowledgedAt: null, acknowledgeBy: "2026-09-18T12:30:00.000Z" })], NOW),
  );
  ok(
    critPending.find((c) => c.id === "ack-window")?.status === "unknown",
    "an in-flight ack is unknown, not a pass and not a fail",
  );
  // A late ack must fail the window criterion even though it WAS acknowledged.
  const critLate = buildEvidenceCriteria(
    summarizeEvidence([ev()]),
    summarizeAckEvidence([ord({ acknowledgedAt: "2026-09-18T10:20:00.000Z" })], NOW),
  );
  ok(
    critLate.find((c) => c.id === "ack-window")?.status === "fail",
    "a late acknowledgement fails the window criterion",
  );
  const critNoStatus = buildEvidenceCriteria(
    summarizeEvidence([ev({ responseStatus: null })]),
    summarizeAckEvidence([], NOW),
  );
  ok(
    critNoStatus.find((c) => c.id === "responses-compliant")?.status === "fail",
    "a missing response status fails the response criterion",
  );
  // `=== true` rather than relying on the optional chain's truthiness: a
  // missing criterion yields `undefined`, which is falsy and would therefore
  // fail the assertion correctly -- but `ok()` takes a boolean, and being
  // explicit keeps the intent ("present AND containing") unambiguous.
  ok(
    critEmpty.find((c) => c.id === "idempotency")?.detail.includes("body_sha256") === true,
    "the idempotency criterion cites the actual constraint",
  );

  // ---- bundle --------------------------------------------------------------
  const bundle = buildEvidenceBundle({
    events: [ev(), theirsRow],
    orders: [ord()],
    nowIso: NOW,
  });
  ok(bundle.sheets.length === 4, "bundle has four sheets");
  ok(bundle.privacyViolations.length === 0, "bundle carries no forbidden column");

  // ---- the privacy audit must be able to SPEAK UP -------------------------
  // Mutation M11 removed the `violations.push(...)` in the audit and the whole
  // suite still passed, because every assertion above only ever checks the
  // CLEAN direction. A guard that is only exercised while silent is untested.
  // So: hand the audit a deliberately poisoned sheet and insist it objects.
  const poisoned: EvidenceSheet = {
    name: "Poisoned",
    columns: [
      { key: "leaflyOrderId", header: "Order" },
      { key: "emailAddress", header: "Email" },
    ],
    rows: [],
  };
  const poisonedFindings = auditEvidenceSheets([poisoned]);
  ok(poisonedFindings.length === 1, "a poisoned sheet yields exactly one violation");
  ok(
    poisonedFindings[0] === "Poisoned.emailAddress",
    "the violation is namespaced Sheet.key so it names where to look",
  );
  // Absolute count, not a count relative to the list under test: if the audit
  // ever silently reported only the first finding, this pins the exact number.
  const multiPoisoned = auditEvidenceSheets([
    poisoned,
    {
      name: "AlsoBad",
      columns: [
        { key: "phoneNumber", header: "Phone" },
        { key: "medical_card_number", header: "Card" },
        { key: "eventType", header: "Event" },
      ],
      rows: [],
    },
  ]);
  ok(multiPoisoned.length === 3, "every violation across every sheet is reported, not just the first");
  ok(
    multiPoisoned.includes("AlsoBad.phoneNumber") &&
      multiPoisoned.includes("AlsoBad.medical_card_number"),
    "snake_case and camelCase forbidden keys are both caught and both named",
  );
  // Non-vacuity: the same function must stay QUIET on a clean sheet, otherwise
  // the four assertions above would pass even for an audit that flags
  // everything unconditionally.
  ok(
    auditEvidenceSheets([
      { name: "Clean", columns: [{ key: "eventType", header: "Event" }], rows: [] },
    ]).length === 0,
    "a clean sheet produces no violation (the audit is not flagging blindly)",
  );
  ok(auditEvidenceSheets([]).length === 0, "no sheets means no violations");
  // And the builder must actually USE the audit: prove the wiring, not just
  // the function. buildEvidenceBundle's own sheets are fixed, so we assert the
  // audit agrees with the bundle's reported result on the real sheet set.
  ok(
    auditEvidenceSheets(bundle.sheets).length === bundle.privacyViolations.length,
    "the bundle's privacyViolations is exactly what auditing its sheets yields",
  );
  ok(bundle.filename.startsWith("leafly-evidence-"), "filename is prefixed");
  ok(bundle.filename.includes("2026-09-18"), "filename carries the date");
  ok(!bundle.filename.includes(":"), "filename has no colons (filesystem-safe)");
  ok(evidenceFilename("garbage").includes("unknown-time"), "unparseable now yields a safe stem");
  ok(bundle.title.length > 0, "bundle has a title");

  const names = bundle.sheets.map((s) => s.name);
  ok(names.includes("Summary"), "Summary sheet present");
  ok(names.includes("Criteria"), "Criteria sheet present");
  ok(names.includes("Deliveries"), "Deliveries sheet present");
  ok(names.includes("Orders"), "Orders sheet present");

  const deliveries = bundle.sheets.find((s) => s.name === "Deliveries")!;
  ok(deliveries.rows.length === 2, "every delivery is exported");
  ok(
    deliveries.columns.some((c) => c.key === "bodySha256"),
    "the body HASH is exported (not the body)",
  );
  ok(
    !deliveries.columns.some((c) => normalizeEvidenceKey(c.key).includes("body") && c.key !== "bodySha256"),
    "no raw body column exists",
  );
  ok(deliveries.rows[0].disposition === "accepted", "delivery row carries its disposition");
  ok(deliveries.rows[1].disposition === "rejected_theirs", "rejected delivery classified in export");

  const ordersSheetOut = bundle.sheets.find((s) => s.name === "Orders")!;
  ok(ordersSheetOut.rows.length === 1, "every order is exported");
  ok(ordersSheetOut.rows[0].ackOutcome === "on_time", "on-time ack labelled in export");
  ok(ordersSheetOut.rows[0].ackMinutes === 5, "ack latency exported");
  const lateBundle = buildEvidenceBundle({
    events: [],
    orders: [ord({ acknowledgedAt: "2026-09-18T10:20:00.000Z" })],
    nowIso: NOW,
  });
  ok(
    lateBundle.sheets.find((s) => s.name === "Orders")!.rows[0].ackOutcome === "late",
    "late ack labelled in export",
  );
  const missedBundle = buildEvidenceBundle({
    events: [],
    orders: [ord({ acknowledgedAt: null })],
    nowIso: NOW,
  });
  ok(
    missedBundle.sheets.find((s) => s.name === "Orders")!.rows[0].ackOutcome === "missed",
    "missed ack labelled in export",
  );
  ok(
    missedBundle.sheets.find((s) => s.name === "Orders")!.rows[0].ackMinutes === null,
    "an unacknowledged order reports no latency rather than a made-up 0",
  );
  const pendingBundle = buildEvidenceBundle({
    events: [],
    orders: [ord({ acknowledgedAt: null, acknowledgeBy: "2026-09-18T12:30:00.000Z" })],
    nowIso: NOW,
  });
  ok(
    pendingBundle.sheets.find((s) => s.name === "Orders")!.rows[0].ackOutcome === "pending",
    "pending ack labelled in export",
  );

  // THE PRIVACY PROOF, swept over every sheet and every column of a fully
  // populated bundle. This is the assertion that makes it safe for the owner
  // to email the file to Leafly and to me.
  let columnsAudited = 0;
  for (const sheet of bundle.sheets) {
    for (const col of sheet.columns) {
      columnsAudited += 1;
      ok(!isForbiddenEvidenceKey(col.key), `exported column is PII-free: ${sheet.name}.${col.key}`);
    }
  }
  ok(columnsAudited >= 25, "audited at least 25 exported columns");
  // And prove the audit is not vacuous: a forbidden key must be CAUGHT.
  ok(
    auditEvidenceKeys([...bundle.sheets[2].columns.map((c) => c.key), "phoneNumber"]).length === 1,
    "the column audit would catch a PII column if one were added",
  );

  const summarySheetOut = bundle.sheets.find((s) => s.name === "Summary")!;
  ok(summarySheetOut.rows.length >= 20, "summary sheet is substantive");
  const findRow = (item: string) => summarySheetOut.rows.find((r) => r.item === item)?.value;
  ok(findRow("Deliveries logged") === 2, "summary sheet reports the delivery count");
  ok(findRow("Signature verified") === 1, "summary sheet reports the verified count");
  ok(findRow("Signature failed") === 1, "summary sheet reports the failed count");
  ok(findRow("Ack window (minutes)") === 15, "summary sheet reports Leafly's window");
  ok(findRow("Verdict") === "some_rejected", "summary sheet reports the verdict code");
  ok(findRow("Generated at (UTC)") === NOW, "summary sheet stamps when it was made");
  // Every anomaly code must appear as a row, so a zero is visible rather than
  // absent -- "no clock skew" is itself evidence.
  let anomalyRows = 0;
  for (const c of ALL_EVIDENCE_ANOMALY_CODES) {
    const label = `Anomaly — ${evidenceAnomalyLabel(c)}`;
    if (summarySheetOut.rows.some((r) => r.item === label)) anomalyRows += 1;
  }
  ok(anomalyRows === ALL_EVIDENCE_ANOMALY_CODES.length, "every anomaly code has a summary row");

  const emptyBundle = buildEvidenceBundle({ events: [], orders: [], nowIso: NOW });
  ok(emptyBundle.sheets.length === 4, "an empty bundle still has all four sheets");
  ok(emptyBundle.privacyViolations.length === 0, "empty bundle is clean");
  ok(
    emptyBundle.sheets.find((s) => s.name === "Deliveries")!.rows.length === 0,
    "empty bundle has no delivery rows",
  );
  ok(
    emptyBundle.sheets.find((s) => s.name === "Criteria")!.rows.length === 5,
    "empty bundle still reports all five criteria",
  );

  // ---- unsigned probes are not a key fault --------------------------------
  //
  // THE DEFECT: four `missing_header` rejections - unsigned scanners from the
  // open internet, refused exactly as designed - were classified alongside real
  // signature mismatches. The owner-facing advice therefore told Michael his
  // HMAC key was probably wrong and to go re-copy it, on a system where nothing
  // was wrong. Acting on that means rotating a working key.
  const probe = ev({ signatureVerified: false, rejectionReason: "missing_header", responseStatus: 401, processedAt: null });
  const badSig = ev({ signatureVerified: false, rejectionReason: "mismatch", responseStatus: 401, processedAt: null });
  const noKey = ev({ signatureVerified: false, rejectionReason: "missing_key", responseStatus: 503, processedAt: null });

  ok(classifyEvidenceDelivery(probe) === "rejected_unsigned", "an unsigned probe is its own category");
  ok(classifyEvidenceDelivery(badSig) === "rejected_theirs", "a real mismatch is still rejected_theirs");
  ok(classifyEvidenceDelivery(noKey) === "rejected_ours", "a missing local key is still our fault");
  ok(isUnsignedRequest("missing_header"), "missing_header is the unsigned case");
  ok(!isUnsignedRequest("mismatch"), "a mismatch is NOT unsigned - it carried a signature");
  ok(!isUnsignedRequest("empty_header"), "an empty header is malformed, not absent");
  ok(!isUnsignedRequest(null), "no reason at all is not the unsigned case");

  // The wording is the whole point of the fix, so assert the wording.
  const probeText = evidenceDispositionExplanation("rejected_unsigned");
  ok(!/re-?copy the HMAC key|Paste the HMAC key/i.test(probeText), "unsigned advice does NOT tell the owner to change a working key");
  ok(/must NOT be changed/i.test(probeText), "unsigned advice explicitly protects the key");
  ok(evidenceDispositionTone("rejected_unsigned") === "info", "routine scanner traffic is not painted red");

  // Negative control: the mismatch case MUST still give the key advice, or the
  // fix above has simply deleted a real warning instead of aiming it.
  const mismatchText = evidenceDispositionExplanation("rejected_theirs");
  ok(/HMAC key/i.test(mismatchText), "a genuine mismatch still names the HMAC key");
  ok(evidenceDispositionTone("rejected_theirs") === "bad", "a genuine mismatch is still bad");

  // ---- reachability must mean LEAFLY reached us ---------------------------
  //
  // THE DEFECT: `summary.total === 0 ? "unknown" : "pass"` meant any logged
  // request turned this green. Four refused port scans "proved" that Leafly
  // could reach our webhook. Nothing from Leafly had ever arrived.
  const probesOnly = summarizeEvidence([probe, probe, probe, probe]);
  const probeCriteria = buildEvidenceCriteria(probesOnly, summarizeAckEvidence([], NOW));
  const reach = probeCriteria.find((c) => c.id === "deliveries-received")!;
  ok(reach.status === "unknown", "unsigned probes alone do NOT prove Leafly can reach us");
  ok(/unsigned/i.test(reach.detail), "the reachability detail explains what the traffic actually was");

  // ...and the HMAC criterion must not read as a failure because of them.
  const sig = probeCriteria.find((c) => c.id === "signatures-verified")!;
  ok(sig.status !== "fail", "refused scanners do not make signature handling look broken");

  // Positive control: one genuine verified delivery flips both to pass.
  const realOne = summarizeEvidence([ev(), probe]);
  const realCriteria = buildEvidenceCriteria(realOne, summarizeAckEvidence([], NOW));
  ok(
    realCriteria.find((c) => c.id === "deliveries-received")!.status === "pass",
    "one signature-verified delivery DOES prove reachability",
  );
  ok(
    realCriteria.find((c) => c.id === "signatures-verified")!.status === "pass",
    "a verified delivery alongside probes still passes the HMAC criterion",
  );

  // And a genuinely bad signature must still FAIL, or the fix has disarmed the
  // alarm it was meant to aim.
  const withBad = buildEvidenceCriteria(summarizeEvidence([ev(), badSig]), summarizeAckEvidence([], NOW));
  ok(
    withBad.find((c) => c.id === "signatures-verified")!.status === "fail",
    "a real signature mismatch still fails the HMAC criterion",
  );

  ok(probesOnly.counts.rejected_unsigned === 4, "unsigned probes are counted separately");
  ok(probesOnly.counts.rejected_theirs === 0, "unsigned probes are not counted as mismatches");

  if (failures.length > 0) {
    for (const f of failures) console.error(`leafly-evidence-core FAIL: ${f}`);
  }
  return { passed, failed: failures.length };
}
