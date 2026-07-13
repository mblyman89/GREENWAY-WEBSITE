/**
 * src/lib/pos/sync-core.ts  (POS Slice B4)
 *
 * PURE decision logic for the POS sync ingest — no DB, no React, no
 * server-only. The sync route (server) and the device flush loop (iPad) both
 * reason about ingest outcomes with THIS module so behavior can never drift.
 *
 * Responsibilities:
 *   - Envelope-vs-device checks: an authenticated device may only submit its
 *     OWN events, bound to ITS register (POS_FRONTEND_RESEARCH §4.1/§6.1).
 *   - Punch INTENT resolution (POS_SEAM_AUDIT Seam 4): replay ASSERTS the
 *     device's recorded intent against the server's open-punch state — it
 *     never blind-toggles. A stale "in" is an idempotent skip; an "out" with
 *     no open punch is an EXCEPTION for manager review (never silent).
 *   - Manual ID-verification event payload validation (the audit record the
 *     B3 gate requires before a manual-verify sale may reference it).
 *   - The per-event ACK shape the device uses to mark queue rows synced.
 */

import { validateEnvelope, type PosEventEnvelope } from "./sale-event-core";
import { isAcceptableIdType, isYmd } from "./id-scan-core";

// ---------------------------------------------------------------------------
// Envelope-vs-authenticated-device checks
// ---------------------------------------------------------------------------

export type IngestCheck = { ok: true } | { ok: false; reason: string };

/**
 * May this envelope be ingested from the authenticated device? The device
 * token authenticates ONE device bound to ONE register; an envelope claiming
 * a different device or register is rejected outright (not an exception row —
 * it never enters the ledger).
 */
export function checkEnvelopeForDevice(
  envelope: Partial<PosEventEnvelope>,
  authenticated: { deviceId: string; registerId: string | null },
): IngestCheck {
  const base = validateEnvelope(envelope);
  if (!base.ok) return { ok: false, reason: base.errors.join(" ") };
  if (envelope.deviceId !== authenticated.deviceId) {
    return { ok: false, reason: "Envelope deviceId does not match the authenticated device." };
  }
  if (!authenticated.registerId) {
    return { ok: false, reason: "Device is not bound to a register — a manager must assign one before syncing." };
  }
  if (envelope.registerId !== authenticated.registerId) {
    return { ok: false, reason: "Envelope registerId does not match the register this device is bound to." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Punch intent resolution (Seam 4: intent-carrying punches, never blind toggle)
// ---------------------------------------------------------------------------

export type PunchIntentResolution =
  | { action: "clock_in" }
  | { action: "clock_out" }
  /** Idempotent replay — state already matches intent. Processed with a note. */
  | { action: "skip"; note: string }
  /** State contradicts intent in a way a human must review. */
  | { action: "exception"; reason: string };

/**
 * Assert a device-recorded punch INTENT against the server's current
 * open-punch state for that employee.
 */
export function resolvePunchIntent(intent: "in" | "out", hasOpenPunch: boolean): PunchIntentResolution {
  if (intent === "in") {
    return hasOpenPunch
      ? { action: "skip", note: "Already clocked in — 'in' intent replayed idempotently." }
      : { action: "clock_in" };
  }
  // intent === "out"
  return hasOpenPunch
    ? { action: "clock_out" }
    : {
        action: "exception",
        reason:
          "Clock-out intent arrived but the employee has no open punch on the server — " +
          "possible missed clock-in or an edit made while the register was offline. Needs manager review.",
      };
}

// ---------------------------------------------------------------------------
// manual_id_verification event payload (the B3 audit record)
// ---------------------------------------------------------------------------

export type ManualIdEventPayload = {
  /** WAC 314-55-150 acceptable ID type the budtender selected. */
  idType: string;
  /** DOB from the document (YYYY-MM-DD) — proves the 21+ math is auditable. */
  dateOfBirth: string;
  /** Expiry from the document (YYYY-MM-DD). */
  expirationDate: string;
  /** Why the ID was verified manually (owner rule: audit trail attached). */
  reason: string;
};

export type PayloadCheck = { ok: true } | { ok: false; errors: string[] };

export function validateManualIdEventPayload(p: Partial<ManualIdEventPayload>): PayloadCheck {
  const errors: string[] = [];
  if (!isAcceptableIdType(p.idType)) errors.push("idType must be a WAC 314-55-150 acceptable ID type.");
  if (!isYmd(p.dateOfBirth)) errors.push("dateOfBirth must be YYYY-MM-DD.");
  if (!isYmd(p.expirationDate)) errors.push("expirationDate must be YYYY-MM-DD.");
  const reason = (p.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) errors.push("reason must be 3–500 characters.");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Per-event ACK shape (what the device uses to mark its queue rows synced)
// ---------------------------------------------------------------------------

export type PosSyncAckStatus = "processed" | "duplicate" | "exception" | "rejected";

export type PosSyncAck = {
  clientUuid: string;
  status: PosSyncAckStatus;
  /** Present for exception/rejected — human-readable, surfaced on-device. */
  reason?: string;
  /** Present when a sale event materialized (or matched) an order. */
  orderId?: string;
  /** Present for processed punches — what the replay actually did. */
  punchAction?: "clock_in" | "clock_out" | "skip";
};

/**
 * A device may DELETE a queue row only when the server has durably accepted
 * it: processed, duplicate (already accepted earlier), or exception (recorded
 * in the exception queue — the manager resolves it server-side). A "rejected"
 * event never entered the ledger and must be kept + surfaced on-device.
 */
export function ackMeansDurablyAccepted(status: PosSyncAckStatus): boolean {
  return status === "processed" || status === "duplicate" || status === "exception";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPosSyncCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else { fail += 1; console.log("FAIL:", msg); }
  };

  const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
  const DEV = U("1");
  const REG = U("2");
  const EMP = U("3");
  const envelope: PosEventEnvelope = {
    clientUuid: U("4"),
    deviceId: DEV,
    registerId: REG,
    employeeId: EMP,
    sequence: 7,
    occurredAt: "2026-07-13T18:00:00.000Z",
    eventType: "punch",
    payload: { intent: "in" },
  };

  // Envelope-vs-device
  ok(checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: REG }).ok, "matching device+register ok");
  {
    const r = checkEnvelopeForDevice(envelope, { deviceId: U("9"), registerId: REG });
    ok(!r.ok && r.reason.includes("deviceId"), "foreign device rejected");
  }
  {
    const r = checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: U("9") });
    ok(!r.ok && r.reason.includes("registerId"), "wrong register rejected");
  }
  {
    const r = checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: null });
    ok(!r.ok && r.reason.includes("not bound"), "unbound device rejected");
  }
  {
    const r = checkEnvelopeForDevice({ ...envelope, clientUuid: "nope" }, { deviceId: DEV, registerId: REG });
    ok(!r.ok, "invalid envelope rejected");
  }

  // Punch intent resolution
  ok(resolvePunchIntent("in", false).action === "clock_in", "in + no open punch → clock_in");
  ok(resolvePunchIntent("out", true).action === "clock_out", "out + open punch → clock_out");
  ok(resolvePunchIntent("in", true).action === "skip", "in + open punch → idempotent skip");
  {
    const r = resolvePunchIntent("out", false);
    ok(r.action === "exception" && r.reason.includes("manager review"), "out + no open punch → exception");
  }

  // Manual ID event payload
  const goodManual: ManualIdEventPayload = {
    idType: "passport",
    dateOfBirth: "1990-07-13",
    expirationDate: "2030-01-01",
    reason: "Passport has no scannable barcode.",
  };
  ok(validateManualIdEventPayload(goodManual).ok, "valid manual-id payload ok");
  ok(!validateManualIdEventPayload({ ...goodManual, idType: "library_card" }).ok, "non-WAC idType refused");
  ok(!validateManualIdEventPayload({ ...goodManual, dateOfBirth: "13/07/1990" }).ok, "bad DOB refused");
  ok(!validateManualIdEventPayload({ ...goodManual, expirationDate: "" }).ok, "missing expiry refused");
  ok(!validateManualIdEventPayload({ ...goodManual, reason: "x" }).ok, "short reason refused");

  // ACK semantics
  ok(ackMeansDurablyAccepted("processed"), "processed → durable");
  ok(ackMeansDurablyAccepted("duplicate"), "duplicate → durable");
  ok(ackMeansDurablyAccepted("exception"), "exception → durable (manager queue)");
  ok(!ackMeansDurablyAccepted("rejected"), "rejected → NOT durable (device keeps it)");

  console.log(`pos/sync-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/sync-core tests failed`);
}
