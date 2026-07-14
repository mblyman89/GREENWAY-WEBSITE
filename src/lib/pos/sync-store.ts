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
import { setOrderStatus } from "@/lib/orders/orders-store";
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
  checkEnvelopeForDevice,
  resolvePunchIntent,
  validateManualIdEventPayload,
  type PosSyncAck,
  type ManualIdEventPayload,
} from "./sync-core";
import { validateCardCapture, type PosCardCapture } from "./medical-pos-core";
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
    acks.push(await ingestOne(admin, device, envelope));
  }

  // Best-effort sync stamp.
  await admin
    .from("pos_devices")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", device.id)
    .then(() => {}, () => {});

  return { ok: true, acks };
}

async function ingestOne(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  device: PosDevice,
  envelope: PosEventEnvelope,
): Promise<PosSyncAck> {
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
      const { data: existing } = await admin
        .from("pos_sale_events")
        .select("id, status, order_id, exception_reason")
        .eq("client_uuid", envelope.clientUuid)
        .maybeSingle<LedgerRow>();
      if (existing) {
        return {
          clientUuid: envelope.clientUuid,
          status: existing.status === "exception" ? "exception" : "duplicate",
          reason: existing.exception_reason ?? undefined,
          orderId: existing.order_id ?? undefined,
        };
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

  // ── 2. Process by type ──
  try {
    switch (envelope.eventType) {
      case "sale":
        return await processSale(admin, device, envelope, inserted.id);
      case "punch":
        return await processPunch(admin, envelope, inserted.id);
      case "no_sale":
        return await processNoSale(admin, envelope, inserted.id);
      case "manual_id_verification":
        return await processManualId(admin, envelope, inserted.id);
      case "medical_card_capture":
        return await processCardCapture(admin, envelope, inserted.id);
      default:
        return await markException(admin, inserted.id, envelope.clientUuid, "Unknown event type.");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unexpected processing error.";
    return await markException(admin, inserted.id, envelope.clientUuid, reason);
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

  // Manual ID verifies must reference an ALREADY-SYNCED audit event from the
  // same device (the queue is flushed in order, so it precedes the sale).
  if (sale.idVerification.method === "manual") {
    const { data: audit } = await admin
      .from("pos_sale_events")
      .select("id")
      .eq("client_uuid", sale.idVerification.manualEventUuid!)
      .eq("event_type", "manual_id_verification")
      .maybeSingle<{ id: string }>();
    if (!audit) {
      return markException(
        admin,
        ledgerId,
        envelope.clientUuid,
        "Sale references a manual ID verification event that has not been synced — flush order violated or the audit event was rejected.",
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

  // Employee name for the customer-facing snapshot (orders require a name).
  const { data: emp } = await admin
    .from("employees")
    .select("full_name")
    .eq("id", envelope.employeeId)
    .maybeSingle<{ full_name: string }>();
  const employeeName = emp?.full_name ?? "Register";

  // Materialize the order (walk-in snapshot; money in minor units).
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
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
    })
    .select("id, order_number")
    .single<{ id: string; order_number: string }>();
  if (orderError || !order) {
    return markException(
      admin,
      ledgerId,
      envelope.clientUuid,
      `Order insert failed: ${orderError?.message ?? "no row returned"}.`,
    );
  }

  const lineRows = sale.lines.map((l) => ({
    order_id: order.id,
    product_id: l.productId || null,
    variant_id: null,
    product_name: l.productName,
    brand: null,
    variant_label: null,
    category: l.category,
    quantity: l.quantity,
    price_minor_units: l.unitPriceMinor,
    regular_price_minor_units: l.regularPriceMinor,
  }));
  const { error: linesError } = await admin.from("order_lines").insert(lineRows);
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
  }

  // ── The compliance gate (B1): the IDENTICAL 8-step sequence the back
  //    office runs. POS sync NEVER carries an override — an over-limit sale
  //    that slipped through on-device lands in the exception queue.
  const refusal = await runCompletionGate({
    orderId: order.id,
    actorId: null,
    overridePermitted: false,
    overrideReason: null,
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

  await markProcessed(admin, ledgerId, { order_id: order.id });
  return { clientUuid: envelope.clientUuid, status: "processed", orderId: order.id };
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
};

export async function listPosExceptions(limit = 100): Promise<PosExceptionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_sale_events")
    .select(
      "id, client_uuid, device_id, register_id, employee_id, event_type, occurred_at, received_at, exception_reason, order_id",
    )
    .eq("status", "exception")
    .is("resolved_at", null)
    .order("occurred_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data as PosExceptionRow[] | null) ?? [];
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
