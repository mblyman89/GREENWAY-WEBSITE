/**
 * src/lib/pos/sync-store.ts  (POS Slice B4)
 *
 * SERVER-ONLY ingest for the register's offline event queue. The device
 * flushes its append-only queue here (via POST /api/pos/sync); every event is
 * recorded in `pos_sale_events` (client_uuid UNIQUE = the idempotency key,
 * POS_FRONTEND_RESEARCH §4.2) and then PROCESSED:
 *
 *   sale                  → materialize an order (server-priced snapshot) and
 *                           re-run the FULL shared completion gate (B1). A
 *                           sale that passed on-device but fails server-side
 *                           (e.g. limits crossed by a concurrent register)
 *                           becomes an EXCEPTION for manager review — never
 *                           silently dropped, never completed.
 *   punch                 → intent-asserting replay through the timeclock
 *                           store (Seam 4; stale intents skip or except).
 *   no_sale               → recorded + audited (drawer opened without a sale).
 *   manual_id_verification→ recorded as the audit event the B3 manual gate
 *                           requires; sales reference its client UUID.
 *
 * Device auth: `X-POS-Device-Id` + `X-POS-Device-Key` headers. The key is
 * verified against pos_devices.provision_hash (same scrypt discipline as
 * clock PINs — plaintext never stored). Fails closed: unknown/revoked device
 * or bad key ⇒ 401; migration 0120 not applied ⇒ clear 503-style refusal.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { verifyPin } from "@/lib/security/pin-hash";
import { recordAudit } from "@/lib/auth/audit";
import { runCompletionGate } from "@/lib/orders/completion-gate";
import { setOrderStatus, getOrder } from "@/lib/orders/orders-store";
import { supersedeNote } from "@/lib/pos/order-to-cart-core";
import { openWorkPunch, toggleClock } from "@/lib/staffing/store";
import {
  validateSalePayload,
  validatePunchPayload,
  validateNoSalePayload,
  sortEventsForReplay,
  isUuid,
  type PosEventEnvelope,
  type PosSalePayload,
  type PosPunchPayload,
  type PosNoSalePayload,
} from "./sale-event-core";
import {
  checkClockDrift,
  checkDrawerSessionForSale,
  checkEnvelopeForDevice,
  checkManualIdMathAtSync,
  resolvePunchIntent,
  validateManualIdEventPayload,
  type DrawerSessionForSale,
  type PosSyncAck,
  type ManualIdEventPayload,
} from "./sync-core";
import { validateCardCapture, type PosCardCapture } from "./medical-pos-core";
import {
  classifyPendingRetry,
  buildOrderExistsReason,
  DUPLICATE_RETRY_STALE_MS,
  SWEEP_STALE_MS,
  SWEEP_BATCH_LIMIT,
} from "./pending-recovery-core";
import {
  buildMenuPriceIndex,
  checkPriceDrift,
  summarizePriceDrift,
  type MenuPriceRow,
} from "./price-drift-core";
import { getPublishedVersion } from "./menu-version";
import { findAuthorizationByUpid, attachCardToOrder } from "@/lib/medical/sale-store";
import { toRecognitionCard } from "@/lib/medical/store";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";

// ---------------------------------------------------------------------------
// Schema guard (migration 0120 applied manually by the owner)
// ---------------------------------------------------------------------------

function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    /relation .* does not exist|column .* does not exist|Could not find the table|could not find .* column/i.test(
      error.message ?? "",
    )
  );
}

const MIGRATION_HINT =
  "POS tables are not available yet — apply supabase/migrations/0120_pos_foundation.sql first.";

// ---------------------------------------------------------------------------
// Device authentication
// ---------------------------------------------------------------------------

export type PosDevice = {
  id: string;
  name: string;
  register_id: string | null;
  status: "active" | "revoked";
  provision_hash: string | null;
};

export type DeviceAuthResult =
  | { ok: true; device: PosDevice }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Authenticate a device by id + provisioning key. Fails CLOSED: a device row
 * without a provision_hash cannot authenticate (a manager must finish
 * provisioning first).
 */
export async function authenticateDevice(deviceId: string, deviceKey: string): Promise<DeviceAuthResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, status: 503, error: "Database not configured." };
  if (!isUuid(deviceId) || !deviceKey) {
    return { ok: false, status: 401, error: "Missing or malformed device credentials." };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_devices")
    .select("id, name, register_id, status, provision_hash")
    .eq("id", deviceId)
    .maybeSingle<PosDevice>();
  if (error) {
    return { ok: false, status: 503, error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message };
  }
  if (!data || data.status !== "active") {
    return { ok: false, status: 401, error: "Unknown or revoked device." };
  }
  if (!data.provision_hash || !verifyPin(deviceKey, data.provision_hash)) {
    return { ok: false, status: 401, error: "Device key rejected." };
  }
  // Best-effort heartbeat; never blocks ingest.
  await admin
    .from("pos_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {}, () => {});
  return { ok: true, device: data };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

type LedgerRow = {
  id: string;
  status: "pending" | "processed" | "exception";
  order_id: string | null;
  exception_reason: string | null;
};

/** LedgerRow + the fields the GW-023 recovery decision needs. */
type LedgerRetryRow = LedgerRow & {
  received_at: string | null;
  recovery_attempts: number;
};

/**
 * Ingest a batch of envelopes from an authenticated device. Returns one ACK
 * per envelope (by clientUuid). Envelopes are replayed in true offline order
 * (device sequence) so punches/sales land chronologically.
 */
export async function ingestPosEvents(
  device: PosDevice,
  rawEnvelopes: Partial<PosEventEnvelope>[],
): Promise<{ ok: true; acks: PosSyncAck[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const acks: PosSyncAck[] = [];

  // Validate + bind every envelope first; only valid ones enter the ledger.
  const valid: PosEventEnvelope[] = [];
  for (const raw of rawEnvelopes) {
    const check = checkEnvelopeForDevice(raw, { deviceId: device.id, registerId: device.register_id });
    if (!check.ok) {
      acks.push({
        clientUuid: typeof raw.clientUuid === "string" ? raw.clientUuid : "(invalid)",
        status: "rejected",
        reason: check.reason,
      });
      continue;
    }
    valid.push(raw as PosEventEnvelope);
  }

  for (const envelope of sortEventsForReplay(valid)) {
    const ack = await ingestOne(admin, device, envelope);
    // null = "wait": the event's earlier copy is still mid-processing on
    // another invocation. No ack ⇒ the device keeps the row queued and
    // retries next flush (applyAcks leaves un-acked rows in `remaining`).
    if (ack) acks.push(ack);
  }

  // Best-effort sync stamp.
  await admin
    .from("pos_devices")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", device.id)
    .then(() => {}, () => {});

  return { ok: true, acks };
}

/** Load the ledger row a retried clientUuid points at, tolerating pre-0128
 * databases (recovery_attempts column missing ⇒ retry the select without it,
 * defaulting attempts to 0 — recovery still works, only the cap is unenforced
 * until the owner runs the migration). */
async function loadLedgerRetryRow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientUuid: string,
): Promise<LedgerRetryRow | null> {
  const { data, error } = await admin
    .from("pos_sale_events")
    .select("id, status, order_id, exception_reason, received_at, recovery_attempts")
    .eq("client_uuid", clientUuid)
    .maybeSingle<LedgerRetryRow>();
  if (!error && data) return { ...data, recovery_attempts: data.recovery_attempts ?? 0 };
  if (error && (error.code === "42703" || /recovery_attempts/i.test(error.message ?? ""))) {
    const { data: legacy } = await admin
      .from("pos_sale_events")
      .select("id, status, order_id, exception_reason, received_at")
      .eq("client_uuid", clientUuid)
      .maybeSingle<Omit<LedgerRetryRow, "recovery_attempts">>();
    return legacy ? { ...legacy, recovery_attempts: 0 } : null;
  }
  return null;
}

/** Best-effort attempt-counter bump; pre-0128 databases no-op silently. */
async function bumpRecoveryAttempts(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ledgerId: string,
  current: number,
): Promise<void> {
  await admin
    .from("pos_sale_events")
    .update({ recovery_attempts: current + 1 })
    .eq("id", ledgerId)
    .then(() => {}, () => {});
}

async function ingestOne(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  device: PosDevice,
  envelope: PosEventEnvelope,
): Promise<PosSyncAck | null> {
  // ── 1. Insert-once into the ledger (client_uuid UNIQUE = idempotency) ──
  const { data: inserted, error: insertError } = await admin
    .from("pos_sale_events")
    .insert({
      client_uuid: envelope.clientUuid,
      device_id: envelope.deviceId,
      register_id: envelope.registerId,
      employee_id: envelope.employeeId,
      sequence: envelope.sequence,
      occurred_at: envelope.occurredAt,
      event_type: envelope.eventType,
      payload: envelope.payload,
    })
    .select("id, status, order_id, exception_reason")
    .maybeSingle<LedgerRow>();

  if (insertError) {
    // Unique violation ⇒ this exact event was accepted before: return its
    // recorded outcome so a retried flush converges without double-posting.
    if (insertError.code === "23505") {
      const existing = await loadLedgerRetryRow(admin, envelope.clientUuid);
      if (existing) {
        if (existing.status === "exception") {
          return {
            clientUuid: envelope.clientUuid,
            status: "exception",
            reason: existing.exception_reason ?? undefined,
            orderId: existing.order_id ?? undefined,
          };
        }
        if (existing.status === "processed") {
          return {
            clientUuid: envelope.clientUuid,
            status: "duplicate",
            orderId: existing.order_id ?? undefined,
          };
        }
        // GW-023 — the row is still `pending`: a previous invocation died
        // mid-processing. This used to be acked "duplicate" (durable!), so
        // the register deleted its ONLY copy of an unfinished sale. Now:
        //   wait      → return NO ack (the device keeps the row queued and
        //               simply retries next flush — applyAcks semantics),
        //   escalate  → manager exception (order already exists / attempts
        //               exhausted — never a blind re-run, never silent),
        //   reprocess → re-run the chain on the EXISTING ledger row.
        const decision = classifyPendingRetry({
          receivedAtIso: existing.received_at,
          nowMs: Date.now(),
          staleAfterMs: DUPLICATE_RETRY_STALE_MS,
          recoveryAttempts: existing.recovery_attempts,
          orderId: existing.order_id,
        });
        if (decision.action === "wait") return null;
        if (decision.action === "escalate") {
          return markException(admin, existing.id, envelope.clientUuid, decision.reason);
        }
        await bumpRecoveryAttempts(admin, existing.id, existing.recovery_attempts);
        await recordAudit({
          actorId: null,
          actorEmail: `pos-device:${device.id}`,
          action: "register.sync_recovery",
          entityType: "register",
          entityId: envelope.registerId,
          after: {
            clientUuid: envelope.clientUuid,
            eventType: envelope.eventType,
            trigger: "device_retry",
            attempt: existing.recovery_attempts + 1,
            receivedAt: existing.received_at,
          },
        });
        return processEnvelope(admin, device, envelope, existing.id);
      }
    }
    if (isMissingSchemaError(insertError)) {
      return { clientUuid: envelope.clientUuid, status: "rejected", reason: MIGRATION_HINT };
    }
    // A medical_card_capture rejected by the 0120 CHECK constraint means
    // migration 0121 hasn't been applied yet — say so precisely.
    if (insertError.code === "23514" && envelope.eventType === "medical_card_capture") {
      return {
        clientUuid: envelope.clientUuid,
        status: "rejected",
        reason:
          "Medical card-capture events are not accepted yet — apply supabase/migrations/0121_pos_medical.sql first.",
      };
    }
    // FK violations (unknown employee/register) are rejections — the event
    // never became a ledger fact, the device keeps it visible.
    return { clientUuid: envelope.clientUuid, status: "rejected", reason: insertError.message };
  }
  if (!inserted) {
    return { clientUuid: envelope.clientUuid, status: "rejected", reason: "Ledger insert returned no row." };
  }

  return processEnvelope(admin, device, envelope, inserted.id);
}

/**
 * The drift check + per-type processing chain, shared by the fresh-insert
 * path, the duplicate-retry recovery path, and the sweeper (GW-023). Always
 * runs against an EXISTING ledger row and always ends in a durable outcome
 * (processed / exception) unless the invocation itself dies — in which case
 * the recovery paths pick the row up again.
 */
async function processEnvelope(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  device: PosDevice,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  // AN-3(d): device clock drift.
  // A FUTURE occurredAt (beyond tolerance) poisons the sales-hours gate and
  // the business-day ledger, so the event is preserved as an EXCEPTION for
  // manager review instead of being processed as if the clock were right.
  // Lateness is never drift — offline queues legitimately flush days later.
  const drift = checkClockDrift(envelope.occurredAt, Date.now());
  if (drift.drifted) {
    return await markException(admin, ledgerId, envelope.clientUuid, drift.reason);
  }

  // Process by type.
  try {
    switch (envelope.eventType) {
      case "sale":
        return await processSale(admin, device, envelope, ledgerId);
      case "punch":
        return await processPunch(admin, envelope, ledgerId);
      case "no_sale":
        return await processNoSale(admin, envelope, ledgerId);
      case "manual_id_verification":
        return await processManualId(admin, envelope, ledgerId);
      case "medical_card_capture":
        return await processCardCapture(admin, envelope, ledgerId);
      default:
        return await markException(admin, ledgerId, envelope.clientUuid, "Unknown event type.");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unexpected processing error.";
    return await markException(admin, ledgerId, envelope.clientUuid, reason);
  }
}

// ---------------------------------------------------------------------------
// Outcome helpers
// ---------------------------------------------------------------------------

async function markProcessed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ledgerId: string,
  patch: { order_id?: string } = {},
): Promise<void> {
  await admin
    .from("pos_sale_events")
    .update({ status: "processed", processed_at: new Date().toISOString(), ...patch })
    .eq("id", ledgerId);
}

async function markException(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ledgerId: string,
  clientUuid: string,
  reason: string,
  patch: { order_id?: string } = {},
): Promise<PosSyncAck> {
  await admin
    .from("pos_sale_events")
    .update({ status: "exception", exception_reason: reason.slice(0, 1000), ...patch })
    .eq("id", ledgerId);
  return { clientUuid, status: "exception", reason, ...(patch.order_id ? { orderId: patch.order_id } : {}) };
}

// ---------------------------------------------------------------------------
// sale — materialize an order + re-run the shared completion gate (B1)
// ---------------------------------------------------------------------------

async function processSale(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  device: PosDevice,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  const payload = envelope.payload as Partial<PosSalePayload>;
  const check = validateSalePayload(payload);
  if (!check.ok) {
    return markException(admin, ledgerId, envelope.clientUuid, `Invalid sale payload: ${check.errors.join(" ")}`);
  }
  const sale = payload as PosSalePayload;

  // AN-3(c) — the drawer session must be REAL: it must exist, belong to the
  // register this device is bound to, and its open interval must contain the
  // sale's occurredAt (a late offline flush is fine; a sale claiming to
  // predate the open or postdate the close is not). Today only the UUID
  // shape was checked — a fabricated or foreign session id would have joined
  // the day's cash story unchallenged.
  {
    const { data: sessionRow, error: sessionError } = await admin
      .from("drawer_sessions")
      .select("id, register_id, opened_at, closed_at")
      .eq("id", sale.drawerSessionId)
      .maybeSingle<DrawerSessionForSale>();
    if (sessionError) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Drawer session lookup failed: ${sessionError.message}.`,
      );
    }
    const sessionCheck = checkDrawerSessionForSale(sessionRow, envelope.registerId, envelope.occurredAt);
    if (!sessionCheck.ok) {
      return markException(admin, ledgerId, envelope.clientUuid, sessionCheck.reason);
    }
  }

  // Manual ID verifies must reference an ALREADY-SYNCED audit event from the
  // same device (the queue is flushed in order, so it precedes the sale).
  if (sale.idVerification.method === "manual") {
    const { data: audit } = await admin
      .from("pos_sale_events")
      .select("id, status")
      .eq("client_uuid", sale.idVerification.manualEventUuid!)
      .eq("event_type", "manual_id_verification")
      .maybeSingle<{ id: string; status: string }>();
    if (!audit) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        "Sale references a manual ID verification event that has not been synced — flush order violated or the audit event was rejected.",
      );
    }
    // AN-3(b): the verification must have PASSED ingest. An excepted
    // verification (age/expiry math failed at sync) grants nothing — the
    // sale that leaned on it needs the same manager review.
    if (audit.status !== "processed") {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        "Sale references a manual ID verification event that FAILED server-side re-checks (see its exception). The sale cannot rely on it.",
      );
    }
  }

  // POS B8 — medical sale: resolve the captured card BEFORE materializing the
  // order, so a bad card never creates an order at all. Three checks:
  //  1. the medical_card_capture audit event was synced first (flush order),
  //  2. the UPID resolves to an ACTIVE back-office authorization row (the
  //     durable card the gate re-validates — DOH 608-048 intake enforced),
  //  3. that row is VALID today (authorizationValidityAt — same source of
  //     truth as the completion gate; catches revocations since the download).
  // The resolved row is attached to the order AFTER insert and BEFORE the
  // gate, so the gate's medCtx / medical limits / WAC 090(2) ledger all fire.
  let medicalAuth: { id: string; customer_id: string } | null = null;
  if (sale.medical) {
    const { data: cardEvent } = await admin
      .from("pos_sale_events")
      .select("id")
      .eq("client_uuid", sale.medical.cardEventUuid)
      .eq("event_type", "medical_card_capture")
      .maybeSingle<{ id: string }>();
    if (!cardEvent) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        "Medical sale references a card-capture event that has not been synced — flush order violated or the capture event was rejected.",
      );
    }
    const auth = await findAuthorizationByUpid(sale.medical.card.upid);
    if (!auth) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Medical sale: no ACTIVE recognition card with UPID "${sale.medical.card.upid}" exists in the back office. Intake the patient's card (Admin → Medical) before ringing medical sales, then resolve this exception.`,
      );
    }
    const validity = authorizationValidityAt(toRecognitionCard(auth), new Date());
    if (!validity.valid) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Medical sale: the recognition card for UPID "${sale.medical.card.upid}" is not valid: ${validity.reason ?? "unknown reason"}. Fix the card on the patient's profile, then resolve this exception.`,
      );
    }
    medicalAuth = { id: auth.id, customer_id: auth.customer_id };
  }

  // POS B14 — loyalty member attach: the customerId came from the server's
  // own /api/pos/member lookup, so it MUST resolve. A dangling id is an
  // exception (customer deleted/merged since the attach), never a silent
  // recreational-anonymous completion — that would quietly lose the
  // customer's points. When the sale is ALSO medical, the recognition card's
  // customer is authoritative; a mismatch is an exception because points
  // would otherwise land on the wrong person.
  let loyaltyCustomerId: string | null = null;
  if (sale.loyalty) {
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("id", sale.loyalty.customerId)
      .maybeSingle<{ id: string }>();
    if (!customer) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty sale: customer ${sale.loyalty.customerId} ("${sale.loyalty.memberLabel}") no longer exists — the profile was deleted or merged after the register attached it. Re-ring the sale with the correct member, then resolve this exception.`,
      );
    }
    if (medicalAuth && medicalAuth.customer_id !== customer.id) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty sale: the attached member ("${sale.loyalty.memberLabel}") is a different customer than the recognition-card holder — points would land on the wrong person. Re-ring with the card holder's own profile, then resolve this exception.`,
      );
    }
    loyaltyCustomerId = customer.id;
  }

  // Task AM-B — loyalty redemption applied at the register: resolve the
  // redemption row BEFORE materializing the order, so a bad code never
  // creates an order at all. The row must exist, match the code the device
  // saw, still be 'issued' (the atomic claim happens after the order
  // exists), and be worth at least what the device applied. The reduced
  // prices already live in the lines (validateSalePayload proved the
  // per-line reductions sum to appliedMinor).
  let redemptionRow: { id: string; code: string; account_id: string; value_minor: number } | null = null;
  if (sale.loyaltyRedemption) {
    const { data: row } = await admin
      .from("loyalty_redemptions")
      .select("id, code, status, value_minor, account_id")
      .eq("id", sale.loyaltyRedemption.redemptionId)
      .maybeSingle<{ id: string; code: string; status: string; value_minor: number; account_id: string }>();
    if (!row) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty redemption ${sale.loyaltyRedemption.redemptionId} does not exist — the discount cannot be honored. Re-ring the sale, then resolve this exception.`,
      );
    }
    if (row.code !== sale.loyaltyRedemption.code) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty redemption code mismatch (device saw ${sale.loyaltyRedemption.code}, row holds ${row.code}) — refused.`,
      );
    }
    if (row.status !== "issued") {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty code ${row.code} is ${row.status} — it was used, cancelled, or expired after the register applied it. Re-ring the sale, then resolve this exception.`,
      );
    }
    if (sale.loyaltyRedemption.appliedMinor > row.value_minor) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty code ${row.code} is worth $${(row.value_minor / 100).toFixed(2)} but the register applied $${(sale.loyaltyRedemption.appliedMinor / 100).toFixed(2)} — refused.`,
      );
    }
    redemptionRow = { id: row.id, code: row.code, account_id: row.account_id, value_minor: row.value_minor };
  }

  // Employee name for the customer-facing snapshot (orders require a name).
  const { data: emp } = await admin
    .from("employees")
    .select("full_name")
    .eq("id", envelope.employeeId)
    .maybeSingle<{ full_name: string }>();
  const employeeName = emp?.full_name ?? "Register";

  // Materialize the order (walk-in snapshot; money in minor units).
  // GW-023: pos_client_uuid (migration 0128) is the DB-enforced guarantee
  // that ONE register event can never materialize TWO orders — a recovery
  // re-run racing a not-quite-dead original, or a crash that left the ledger
  // row unstamped, hits the unique index instead of double-selling. Pre-0128
  // databases retry without the column (same behavior as before this fix).
  const orderInsertRow = (withClientUuid: boolean) => ({
    status: "ready", // in-store sale: picked, bagged, paid — gate decides "completed"
    customer_first_name: "Walk-in",
    customer_last_name: null,
    subtotal_minor_units: sale.subtotalMinor,
    estimated_tax_minor_units: sale.taxMinor,
    savings_minor_units: Math.max(
      0,
      sale.lines.reduce((s, l) => s + (l.regularPriceMinor - l.unitPriceMinor) * l.quantity, 0),
    ),
    total_minor_units: sale.totalMinor,
    item_count: sale.lines.reduce((s, l) => s + l.quantity, 0),
    staff_note: `POS sale — ${device.name} — rung by ${employeeName}. Event ${envelope.clientUuid}.`,
    ...(withClientUuid ? { pos_client_uuid: envelope.clientUuid } : {}),
  });
  let { data: order, error: orderError } = await admin
    .from("orders")
    .insert(orderInsertRow(true))
    .select("id, order_number")
    .single<{ id: string; order_number: string }>();
  if (
    orderError &&
    (orderError.code === "PGRST204" ||
      orderError.code === "42703" ||
      /pos_client_uuid/i.test(orderError.message ?? "")) &&
    orderError.code !== "23505"
  ) {
    // Migration 0128 not applied yet — insert without the guarantee column.
    ({ data: order, error: orderError } = await admin
      .from("orders")
      .insert(orderInsertRow(false))
      .select("id, order_number")
      .single<{ id: string; order_number: string }>());
  }
  if (orderError?.code === "23505" && /pos_client_uuid/i.test(orderError.message ?? "")) {
    // An order for this exact register event ALREADY exists (a previous
    // attempt crashed after materializing it). Never build a second one —
    // stamp the ledger row with the existing order and hand it to a manager.
    const { data: existingOrder } = await admin
      .from("orders")
      .select("id, order_number")
      .eq("pos_client_uuid", envelope.clientUuid)
      .maybeSingle<{ id: string; order_number: string }>();
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      buildOrderExistsReason(existingOrder?.id ?? envelope.clientUuid, existingOrder?.order_number ?? null),
      existingOrder ? { order_id: existingOrder.id } : {},
    );
  }
  if (orderError || !order) {
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Order insert failed: ${orderError?.message ?? "no row returned"}.`,
    );
  }

  // GW-023: stamp the ledger row with the order IMMEDIATELY, not only at the
  // end. If the function dies anywhere in the rest of this chain, the
  // breadcrumb makes the recovery classifier escalate ("order exists — human
  // eyes") instead of ever re-running over a half-built order. Best-effort:
  // a failed stamp just means the 0128 unique index is the (absolute) net.
  await admin
    .from("pos_sale_events")
    .update({ order_id: order.id })
    .eq("id", ledgerId)
    .then(() => {}, () => {});

  const buildLineRows = (withUnitGrams: boolean) =>
    sale.lines.map((l) => ({
      order_id: order.id,
      product_id: l.productId || null,
      // POS B20: exact variant identity from the register (null on pre-B20
      // queued sales) — powers the B19 exact-variant decrement and gives the
      // CCRS Sale.csv resolver its most precise input.
      variant_id: l.variantId?.trim() || null,
      product_name: l.productName,
      brand: null,
      variant_label: null,
      category: l.category,
      quantity: l.quantity,
      price_minor_units: l.unitPriceMinor,
      regular_price_minor_units: l.regularPriceMinor,
      // Task AM-B — per-UNIT loyalty reduction snapshot (migration 0116).
      // Only written when a redemption rode this sale, so pre-0116 databases
      // never see the column on loyalty-free sales.
      ...(redemptionRow && l.loyaltyDiscountMinor
        ? { loyalty_discount_minor_units: l.loyaltyDiscountMinor }
        : {}),
      // AN-1 — per-UNIT grams snapshot (migration 0122). The completion gate
      // prefers this over the category default; null = unknown weight.
      ...(withUnitGrams && typeof l.unitGrams === "number" && l.unitGrams > 0
        ? { unit_grams: l.unitGrams }
        : {}),
    }));
  let { error: linesError } = await admin.from("order_lines").insert(buildLineRows(true));
  if (
    linesError &&
    (linesError.code === "PGRST204" ||
      linesError.code === "42703" ||
      /unit_grams/i.test(linesError.message ?? ""))
  ) {
    // Migration 0122 not applied yet — retry without the weight snapshot
    // (the gate falls back to category defaults, exactly the pre-AN-1 math).
    ({ error: linesError } = await admin.from("order_lines").insert(buildLineRows(false)));
  }
  if (linesError) {
    await admin.from("orders").delete().eq("id", order.id); // never strand a header
    return markException(admin, ledgerId, envelope.clientUuid, `Order lines insert failed: ${linesError.message}.`);
  }

  await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "placed",
    to_status: "ready",
    actor_label: `POS · ${employeeName}`,
    note: `Register sale synced from ${device.name} (event ${envelope.clientUuid}). Payment: ${sale.paymentMethod}.${sale.medical ? " MEDICAL sale (recognition card attached)." : ""}`,
  });

  // POS B24 — audit every manager price override that rode this sale. The
  // approver's PIN was verified by /api/pos/approve moments before enqueue;
  // validateSalePayload already enforced the block's shape (markdown-only,
  // reason, approver employees.id). One audit row per overridden line keeps
  // the trail queryable by manager, product, and order.
  for (const l of sale.lines) {
    if (!l.override) continue;
    await recordAudit({
      actorId: null,
      actorEmail: `pos-device:${device.id}`,
      action: "register.price_override",
      entityType: "order",
      entityId: order.id,
      after: {
        productId: l.productId,
        productName: l.productName,
        variantId: l.variantId ?? null,
        quantity: l.quantity,
        originalUnitPriceMinor: l.override.originalUnitPriceMinor,
        overriddenUnitPriceMinor: l.unitPriceMinor,
        reason: l.override.reason,
        approvedByEmployeeId: l.override.approvedByEmployeeId,
        soldByEmployeeId: envelope.employeeId,
        clientUuid: envelope.clientUuid,
        occurredAt: envelope.occurredAt,
      },
    });
  }

  // POS B8 — attach the resolved recognition card BEFORE the gate runs, so
  // the gate re-validates the card, evaluates the 3× MEDICAL limits (WAC
  // 314-55-095(2)(d)), and writes the WAC 314-55-090(2) exempt-sale ledger
  // rows from the repriced lines. Attach failure is an exception, never a
  // silent recreational completion — that would misreport a medical sale.
  if (medicalAuth) {
    const attached = await attachCardToOrder(order.id, medicalAuth);
    if (!attached.ok) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Medical sale: could not attach the recognition card to the order (${attached.error ?? "unknown error"}).`,
        { order_id: order.id },
      );
    }
  } else if (loyaltyCustomerId) {
    // POS B14 — link the member BEFORE the gate/completion so the EXISTING
    // completion accrual (setOrderStatus → accrueForOrder) earns the points.
    // Medical sales skip this branch: attachCardToOrder already wrote the
    // card holder's customer_id (verified same person above).
    const { error: linkError } = await admin
      .from("orders")
      .update({ customer_id: loyaltyCustomerId })
      .eq("id", order.id);
    if (linkError) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty sale: could not link the member to the order (${linkError.message}).`,
        { order_id: order.id },
      );
    }
  }

  // Task AM-B — ATOMIC CLAIM of the register-applied redemption, exactly the
  // back-office discipline (loyalty-sale-store): conditional on status still
  // being 'issued' so two syncs (or a register + the back office) presenting
  // the same code can't both win. Then the migration-0116 header columns —
  // the completion gate's checkLoyaltyCodeForCompletion re-verifies the row
  // is consumed by THIS order before the sale may complete.
  if (redemptionRow && sale.loyaltyRedemption) {
    const { data: claimed } = await admin
      .from("loyalty_redemptions")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_order_id: order.id })
      .eq("id", redemptionRow.id)
      .eq("status", "issued")
      .select("id");
    if (!claimed || claimed.length === 0) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty code ${redemptionRow.code} was just used elsewhere — it can only be redeemed once. Re-ring the sale, then resolve this exception.`,
        { order_id: order.id },
      );
    }
    const { error: loyaltyHeaderError } = await admin
      .from("orders")
      .update({
        loyalty_kind: "code",
        loyalty_redemption_id: redemptionRow.id,
        loyalty_code: redemptionRow.code,
        loyalty_discount_minor_units: sale.loyaltyRedemption.appliedMinor,
      })
      .eq("id", order.id);
    if (loyaltyHeaderError) {
      // Release the claim we just took — never strand a consumed code on an
      // order that can't record it (pre-0116 databases land here).
      await admin
        .from("loyalty_redemptions")
        .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
        .eq("id", redemptionRow.id)
        .eq("status", "redeemed")
        .eq("redeemed_order_id", order.id);
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        `Loyalty redemption could not be recorded on the order (${loyaltyHeaderError.message}) — apply migration 0116, then resolve this exception.`,
        { order_id: order.id },
      );
    }
    await admin.from("order_events").insert({
      order_id: order.id,
      event_type: "note",
      note: `Loyalty code ${redemptionRow.code} applied at the register ($${(sale.loyaltyRedemption.appliedMinor / 100).toFixed(2)} off).`,
      actor_label: `POS · ${employeeName}`,
    });
  }

  // ── The compliance gate (B1): the IDENTICAL 8-step sequence the back
  //    office runs. POS sync NEVER carries an override — an over-limit sale
  //    that slipped through on-device lands in the exception queue.
  const refusal = await runCompletionGate({
    orderId: order.id,
    actorId: null,
    overridePermitted: false,
    overrideReason: null,
    // AN-3(a): grade the sales-hours gate on when the sale OCCURRED, not
    // when the queue flushed — a legal 11 PM sale syncing at 2 AM must pass;
    // an illegal 2 AM sale syncing at noon must be refused. The clock-drift
    // check upstream already excepted any future-stamped envelope, so this
    // instant cannot be gamed forward.
    hoursAt: envelope.occurredAt,
  });
  if (refusal) {
    await recordAudit({
      actorId: null,
      actorEmail: `pos-device:${device.id}`,
      action: "order.completion_blocked",
      entityType: "order",
      entityId: order.id,
      after: { reason: refusal, source: "pos_sync", clientUuid: envelope.clientUuid },
    });
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Completion gate refused the synced sale: ${refusal}`,
      { order_id: order.id },
    );
  }

  const completed = await setOrderStatus(order.id, "completed", {
    actorLabel: `POS · ${employeeName}`,
    note: `Completed via POS sync (${device.name}).`,
  });
  if (!completed.ok) {
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Order passed the gate but the status write failed${completed.refusal ? `: ${completed.refusal}` : "."}`,
      { order_id: order.id },
    );
  }

  // AM-D2 — supersede the SOURCE website order NOW (on completion), not on
  // load. When this register sale was started by loading a website pickup
  // order, that order stayed ACTIVE while the budtender rang the sale — so an
  // abandoned/locked-out load never lost the order. The register sale has now
  // completed and materialized its OWN order (the sale of record), so we
  // cancel the website order with the loud timeline note here: the two can
  // never both fulfill, and this is the only moment the website order should
  // disappear from the pickup queue. Best-effort by design: a completed,
  // paid-for sale must never be undone by a supersede hiccup — if the cancel
  // fails we leave a loud audit row so the manager can close the order by hand.
  if (sale.sourceOrderId && sale.sourceOrderId !== order.id) {
    try {
      const source = await getOrder(sale.sourceOrderId);
      const ACTIVE = new Set(["new", "acknowledged", "preparing", "ready"]);
      if (source && ACTIVE.has(source.status)) {
        const superseded = await setOrderStatus(source.id, "cancelled", {
          actorLabel: `POS · ${employeeName}`,
          note: supersedeNote(device.name, employeeName),
        });
        if (!superseded.ok) {
          await recordAudit({
            actorId: null,
            actorEmail: `pos-device:${device.id}`,
            action: "order.supersede_on_complete_failed",
            entityType: "order",
            entityId: source.id,
            after: {
              reason: superseded.refusal ?? "unknown",
              registerOrderId: order.id,
              clientUuid: envelope.clientUuid,
            },
          });
        }
      }
    } catch {
      // Never let a source-order lookup/cancel failure touch the completed sale.
    }
  }

  // AN-5 — price-drift NOTICE (never blocks): compare the device's
  // pre-discount menu snapshots (regularPriceMinor — overrides/promos/
  // loyalty only ever touch unitPriceMinor) against the CURRENT published
  // menu. Drift means the register priced from a stale bundle; the sale
  // stands (the customer paid the displayed price, and excepting it would
  // strip its money from the X/Z report), but a durable audit row tells the
  // manager which register needs a menu refresh. Best-effort by design.
  try {
    const drift = await detectSalePriceDrift(admin, sale.lines);
    if (drift.length > 0) {
      await recordAudit({
        actorId: null,
        actorEmail: `pos-device:${device.id}`,
        action: "register.price_drift",
        entityType: "order",
        entityId: order.id,
        after: {
          clientUuid: envelope.clientUuid,
          occurredAt: envelope.occurredAt,
          summary: summarizePriceDrift(drift),
          findings: drift,
        },
      });
    }
  } catch {
    // A drift-check failure must never affect an already-completed sale.
  }

  await markProcessed(admin, ledgerId, { order_id: order.id });
  return { clientUuid: envelope.clientUuid, status: "processed", orderId: order.id };
}

/**
 * AN-5 helper: build the published-menu price index for JUST the products a
 * sale touched and run the pure drift check. Returns [] when there is no
 * published version (nothing to compare against — never a false positive).
 */
async function detectSalePriceDrift(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lines: PosSalePayload["lines"],
): Promise<ReturnType<typeof checkPriceDrift>> {
  const productKeys = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  if (productKeys.length === 0) return [];
  const version = await getPublishedVersion();
  if (!version) return [];
  const { data: itemRows } = await admin
    .from("menu_items")
    .select("id, source_item_id")
    .eq("menu_version_id", version.id)
    .in("source_item_id", productKeys);
  const items = (itemRows as { id: string; source_item_id: string }[] | null) ?? [];
  const priceRows: MenuPriceRow[] = [];
  if (items.length > 0) {
    const { data: variantRows } = await admin
      .from("menu_variants")
      .select("menu_item_id, source_variant_id, price_minor_units")
      .in("menu_item_id", items.map((i) => i.id));
    const bySourceKey = new Map(items.map((i) => [i.id, i.source_item_id]));
    for (const v of (variantRows as { menu_item_id: string; source_variant_id: string; price_minor_units: number }[] | null) ?? []) {
      const productId = bySourceKey.get(v.menu_item_id);
      if (!productId) continue;
      priceRows.push({ productId, variantId: v.source_variant_id, priceMinor: v.price_minor_units });
    }
  }
  return checkPriceDrift(
    lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      variantId: l.variantId ?? null,
      regularPriceMinor: l.regularPriceMinor,
    })),
    buildMenuPriceIndex(priceRows),
  );
}

// ---------------------------------------------------------------------------
// punch — intent-asserting replay (Seam 4)
// ---------------------------------------------------------------------------

async function processPunch(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  const payload = envelope.payload as Partial<PosPunchPayload>;
  const check = validatePunchPayload(payload);
  if (!check.ok) {
    return markException(admin, ledgerId, envelope.clientUuid, `Invalid punch payload: ${check.errors.join(" ")}`);
  }
  const intent = (payload as PosPunchPayload).intent;
  const open = await openWorkPunch(envelope.employeeId);
  const resolution = resolvePunchIntent(intent, !!open);

  switch (resolution.action) {
    case "skip":
      await markProcessed(admin, ledgerId);
      return { clientUuid: envelope.clientUuid, status: "processed", punchAction: "skip" };
    case "exception":
      return markException(admin, ledgerId, envelope.clientUuid, resolution.reason);
    case "clock_in":
    case "clock_out": {
      const result = await toggleClock(envelope.employeeId, "register");
      if (!result.ok) {
        return markException(admin, ledgerId, envelope.clientUuid, `Punch replay failed: ${result.error}`);
      }
      await markProcessed(admin, ledgerId);
      return {
        clientUuid: envelope.clientUuid,
        status: "processed",
        punchAction: result.action === "in" ? "clock_in" : "clock_out",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// no_sale — drawer opened without a sale (audited)
// ---------------------------------------------------------------------------

async function processNoSale(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  const payload = envelope.payload as Partial<PosNoSalePayload>;
  const check = validateNoSalePayload(payload);
  if (!check.ok) {
    return markException(admin, ledgerId, envelope.clientUuid, `Invalid no-sale payload: ${check.errors.join(" ")}`);
  }
  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${envelope.deviceId}`,
    action: "register.no_sale",
    entityType: "register",
    entityId: envelope.registerId,
    after: {
      reason: (payload as PosNoSalePayload).reason,
      approvedByEmployeeId: (payload as PosNoSalePayload).approvedByEmployeeId,
      employeeId: envelope.employeeId,
      clientUuid: envelope.clientUuid,
      occurredAt: envelope.occurredAt,
    },
  });
  await markProcessed(admin, ledgerId);
  return { clientUuid: envelope.clientUuid, status: "processed" };
}

// ---------------------------------------------------------------------------
// manual_id_verification — the audit record the B3 manual gate requires
// ---------------------------------------------------------------------------

async function processManualId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  const payload = envelope.payload as Partial<ManualIdEventPayload>;
  const check = validateManualIdEventPayload(payload);
  if (!check.ok) {
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Invalid manual ID verification payload: ${check.errors.join(" ")}`,
    );
  }
  // AN-3(b) — re-run the AGE and EXPIRY math server-side, against the
  // EVENT's own date (the verification happened then, possibly offline days
  // ago). validateManualIdEventPayload proved the shape; this proves the
  // substance — a tampered device or corrupted queue row cannot smuggle an
  // underage or expired-document verification into the audit trail. Sales
  // referencing an excepted verification are themselves refused below.
  const math = checkManualIdMathAtSync(
    payload as Pick<ManualIdEventPayload, "dateOfBirth" | "expirationDate" | "visualOver40">,
    envelope.occurredAt.slice(0, 10),
  );
  if (!math.ok) {
    return markException(admin, ledgerId, envelope.clientUuid, math.errors.join(" "));
  }
  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${envelope.deviceId}`,
    action: "register.manual_id_verification",
    entityType: "register",
    entityId: envelope.registerId,
    after: {
      idType: payload.idType,
      dateOfBirth: payload.dateOfBirth,
      expirationDate: payload.expirationDate,
      reason: payload.reason,
      // House policy: over-40 visual verifications are flagged in the audit
      // trail (DOB-only entry; validity checked in hand, no expiry recorded).
      visualOver40: payload.visualOver40 === true,
      employeeId: envelope.employeeId,
      clientUuid: envelope.clientUuid,
      occurredAt: envelope.occurredAt,
    },
  });
  await markProcessed(admin, ledgerId);
  return { clientUuid: envelope.clientUuid, status: "processed" };
}

// ---------------------------------------------------------------------------
// medical_card_capture — the audit record every medical sale references (B8)
// ---------------------------------------------------------------------------

async function processCardCapture(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  envelope: PosEventEnvelope,
  ledgerId: string,
): Promise<PosSyncAck> {
  const payload = envelope.payload as Partial<PosCardCapture>;
  // Validate against the DEVICE's wall-clock date (the capture happened
  // then, possibly offline days ago) — the SALE re-validates against the
  // durable authorization row at its own ingest.
  const capturedYmd = envelope.occurredAt.slice(0, 10);
  const check = validateCardCapture(payload, capturedYmd);
  if (!check.ok) {
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Invalid medical card capture: ${check.errors.join(" ")}`,
    );
  }
  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${envelope.deviceId}`,
    action: "register.medical_card_capture",
    entityType: "register",
    entityId: envelope.registerId,
    after: {
      upid: check.card.upid,
      effectiveOn: check.card.effectiveOn,
      expiresOn: check.card.expiresOn,
      holderType: check.card.holderType,
      mcrVerified: check.card.mcrVerified,
      employeeId: envelope.employeeId,
      clientUuid: envelope.clientUuid,
      occurredAt: envelope.occurredAt,
    },
  });
  await markProcessed(admin, ledgerId);
  return { clientUuid: envelope.clientUuid, status: "processed" };
}

// ---------------------------------------------------------------------------
// GW-023 sweeper — the safety net for stranded `pending` rows
// ---------------------------------------------------------------------------

type SweepRow = {
  id: string;
  client_uuid: string;
  device_id: string;
  register_id: string;
  employee_id: string;
  sequence: number;
  occurred_at: string;
  received_at: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  order_id: string | null;
  recovery_attempts: number | null;
};

export type SweepResult = {
  scanned: number;
  reprocessed: number;
  escalated: number;
  /** Outcomes per row, for the cron's JSON response / logs. */
  details: { clientUuid: string; outcome: string }[];
};

/**
 * Find `pending` ledger rows older than SWEEP_STALE_MS and heal them: re-run
 * processing when it is provably safe (no order materialized, attempts
 * remain), escalate to the manager exception queue otherwise. Runs from the
 * daily cron — the register's own retry path usually beats it, so this is
 * the net under the net (a register that never comes back online, a deleted
 * queue, an iPad in a drawer).
 *
 * Tolerates pre-0128 databases (recovery_attempts missing) and never throws:
 * a sweep failure must not break the cron's reminder work.
 */
export async function sweepStalePendingEvents(): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, reprocessed: 0, escalated: 0, details: [] };
  if (!isSupabaseServiceConfigured) return result;
  try {
    const admin = createSupabaseAdminClient();
    const cutoffIso = new Date(Date.now() - SWEEP_STALE_MS).toISOString();
    const selectWith = (withAttempts: boolean) =>
      admin
        .from("pos_sale_events")
        .select(
          "id, client_uuid, device_id, register_id, employee_id, sequence, occurred_at, received_at, event_type, payload, order_id" +
            (withAttempts ? ", recovery_attempts" : ""),
        )
        .eq("status", "pending")
        .lt("received_at", cutoffIso)
        .order("received_at", { ascending: true })
        .limit(SWEEP_BATCH_LIMIT);
    let { data: rows, error } = await selectWith(true);
    if (error && (error.code === "42703" || /recovery_attempts/i.test(error.message ?? ""))) {
      ({ data: rows, error } = await selectWith(false));
    }
    if (error || !rows) return result;

    for (const raw of rows as unknown as SweepRow[]) {
      result.scanned += 1;
      const attempts = raw.recovery_attempts ?? 0;
      const decision = classifyPendingRetry({
        receivedAtIso: raw.received_at,
        nowMs: Date.now(),
        staleAfterMs: SWEEP_STALE_MS,
        recoveryAttempts: attempts,
        orderId: raw.order_id,
      });
      if (decision.action === "wait") {
        // Can't happen (the query itself filtered on staleness) — skip safely.
        result.details.push({ clientUuid: raw.client_uuid, outcome: "wait" });
        continue;
      }
      if (decision.action === "escalate") {
        await markException(admin, raw.id, raw.client_uuid, decision.reason);
        result.escalated += 1;
        result.details.push({ clientUuid: raw.client_uuid, outcome: `escalated:${decision.kind}` });
        continue;
      }
      // Reprocess: rebuild the envelope and run the exact same chain the
      // sync route runs. The device row is needed for processSale's
      // staff-note snapshot; a revoked/deleted device does not erase the
      // FACT of the sale — recovery proceeds with a placeholder name.
      const { data: deviceRow } = await admin
        .from("pos_devices")
        .select("id, name, register_id, status, provision_hash")
        .eq("id", raw.device_id)
        .maybeSingle<PosDevice>();
      const device: PosDevice =
        deviceRow ?? {
          id: raw.device_id,
          name: "(retired device)",
          register_id: raw.register_id,
          status: "active",
          provision_hash: null,
        };
      const envelope: PosEventEnvelope = {
        clientUuid: raw.client_uuid,
        deviceId: raw.device_id,
        registerId: raw.register_id,
        employeeId: raw.employee_id,
        sequence: raw.sequence,
        occurredAt: raw.occurred_at,
        eventType: raw.event_type as PosEventEnvelope["eventType"],
        payload: raw.payload ?? {},
      };
      await bumpRecoveryAttempts(admin, raw.id, attempts);
      await recordAudit({
        actorId: null,
        actorEmail: "cron:pos-sweeper",
        action: "register.sync_recovery",
        entityType: "register",
        entityId: raw.register_id,
        after: {
          clientUuid: raw.client_uuid,
          eventType: raw.event_type,
          trigger: "sweeper",
          attempt: attempts + 1,
          receivedAt: raw.received_at,
        },
      });
      const ack = await processEnvelope(admin, device, envelope, raw.id);
      if (ack.status === "processed") result.reprocessed += 1;
      else result.escalated += 1;
      result.details.push({ clientUuid: raw.client_uuid, outcome: ack.status });
    }
    return result;
  } catch {
    return result;
  }
}

// ---------------------------------------------------------------------------
// Exception queue reads (manager review UI)
// ---------------------------------------------------------------------------

export type PosExceptionRow = {
  id: string;
  client_uuid: string;
  device_id: string;
  register_id: string;
  employee_id: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  exception_reason: string | null;
  order_id: string | null;
  /** Full validated envelope payload — managers inspect it before resolving. */
  payload: Record<string, unknown> | null;
};

/**
 * AN-6: lightweight snapshot of the unresolved exception queue — exact count
 * plus the oldest occurred_at — for the daily reminder and the admin-nav
 * badge. Best-effort: unconfigured or failing DB reports an empty queue
 * (never blocks a page render or the reminder cron).
 */
export async function posExceptionSnapshot(): Promise<{
  count: number;
  oldestOccurredAt: string | null;
}> {
  if (!isSupabaseServiceConfigured) return { count: 0, oldestOccurredAt: null };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error, count } = await admin
      .from("pos_sale_events")
      .select("occurred_at", { count: "exact" })
      .eq("status", "exception")
      .is("resolved_at", null)
      .order("occurred_at", { ascending: true })
      .limit(1);
    if (error) return { count: 0, oldestOccurredAt: null };
    const oldest = (data as { occurred_at: string | null }[] | null)?.[0]?.occurred_at ?? null;
    return { count: count ?? 0, oldestOccurredAt: oldest };
  } catch {
    return { count: 0, oldestOccurredAt: null };
  }
}

export async function listPosExceptions(limit = 100): Promise<PosExceptionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_sale_events")
    .select(
      "id, client_uuid, device_id, register_id, employee_id, event_type, occurred_at, received_at, exception_reason, order_id, payload",
    )
    .eq("status", "exception")
    .is("resolved_at", null)
    .order("occurred_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data as PosExceptionRow[] | null) ?? [];
}

export type PosResolvedExceptionRow = PosExceptionRow & {
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

/** Recently resolved exceptions — the manager's paper trail. */
export async function listResolvedPosExceptions(limit = 25): Promise<PosResolvedExceptionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_sale_events")
    .select(
      "id, client_uuid, device_id, register_id, employee_id, event_type, occurred_at, received_at, exception_reason, order_id, payload, resolved_by, resolved_at, resolution_note",
    )
    .eq("status", "exception")
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as PosResolvedExceptionRow[] | null) ?? [];
}

/** Manager resolution: mark an exception reviewed with a written note. */
export async function resolvePosException(
  id: string,
  opts: { resolvedBy: string; note: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const note = opts.note.trim();
  if (note.length < 5) return { ok: false, error: "A resolution note (at least 5 characters) is required." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("pos_sale_events")
    .update({ resolved_by: opts.resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("id", id)
    .eq("status", "exception");
  if (error) return { ok: false, error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}
