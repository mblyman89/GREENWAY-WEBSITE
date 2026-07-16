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
import { MINIMUM_AGE_YEARS, ageOn, isAcceptableIdType, isExpired, isYmd } from "./id-scan-core";

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

/**
 * AN-3(b) — re-run the manual-ID AGE and EXPIRY math at sync, against the
 * event's OWN date (the verification happened then, possibly offline days
 * ago — grading it against the sync-arrival date would wrongly fail a
 * document that expired in between). `validateManualIdEventPayload` proves
 * the SHAPE; this proves the SUBSTANCE: the DOB really was 21+ and the
 * document really was unexpired on the day the budtender said so. A device
 * whose math was tampered with (or a corrupted queue row) becomes an
 * exception for manager review, never a silently-honored audit record.
 */
export function checkManualIdMathAtSync(
  p: Pick<ManualIdEventPayload, "dateOfBirth" | "expirationDate">,
  occurredYmd: string,
  minimumAgeYears: number = MINIMUM_AGE_YEARS,
): PayloadCheck {
  const errors: string[] = [];
  if (!isYmd(occurredYmd)) {
    return { ok: false, errors: ["Internal error: event date is not YYYY-MM-DD."] };
  }
  const age = ageOn(p.dateOfBirth ?? "", occurredYmd);
  if (age === null || age < minimumAgeYears) {
    errors.push(
      `Manual ID math failed at sync: DOB ${p.dateOfBirth} is under ${minimumAgeYears} (age ${age ?? "unknown"}) on ${occurredYmd}.`,
    );
  }
  const expired = isExpired(p.expirationDate ?? "", occurredYmd);
  if (expired !== false) {
    errors.push(
      `Manual ID math failed at sync: document expiry ${p.expirationDate} was not valid on ${occurredYmd} (WAC 314-55-150).`,
    );
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// AN-3(c) — drawer-session validation (a sale must belong to a REAL session)
// ---------------------------------------------------------------------------

/** The minimal drawer_sessions shape the sale-vs-session check needs. */
export type DrawerSessionForSale = {
  id: string;
  register_id: string;
  opened_at: string | null;
  closed_at: string | null;
};

/**
 * May this synced sale claim this drawer session? Today only the UUID shape
 * is checked (validateSalePayload) — a fabricated or foreign session id
 * would be written into the day's cash story unchallenged. Rules:
 *   - the session must EXIST (caller resolves the row; null = unknown id),
 *   - it must belong to THE REGISTER the authenticated device is bound to,
 *   - the sale's occurredAt must fall INSIDE the session's open interval
 *     (opened_at ≤ occurredAt, and occurredAt ≤ closed_at when closed —
 *     an offline queue may flush AFTER the drawer closed, which is fine;
 *     a sale claiming to have happened before open or after close is not).
 * Pure: the row and instants are passed in; the caller queries.
 */
export function checkDrawerSessionForSale(
  session: DrawerSessionForSale | null,
  registerId: string,
  occurredAtIso: string,
): IngestCheck {
  if (!session) {
    return {
      ok: false,
      reason:
        "Sale references a drawer session that does not exist on the server — the cash story cannot absorb it. Needs manager review.",
    };
  }
  if (session.register_id !== registerId) {
    return {
      ok: false,
      reason: "Sale references a drawer session belonging to a DIFFERENT register. Needs manager review.",
    };
  }
  const occurred = Date.parse(occurredAtIso);
  if (!Number.isFinite(occurred)) {
    return { ok: false, reason: "Sale occurredAt does not parse as a timestamp." };
  }
  if (session.opened_at) {
    const opened = Date.parse(session.opened_at);
    if (Number.isFinite(opened) && occurred < opened) {
      return {
        ok: false,
        reason: "Sale claims to have occurred BEFORE its drawer session was opened. Needs manager review.",
      };
    }
  }
  if (session.closed_at) {
    const closed = Date.parse(session.closed_at);
    if (Number.isFinite(closed) && occurred > closed) {
      return {
        ok: false,
        reason:
          "Sale claims to have occurred AFTER its drawer session was closed — it cannot join that session's cash story. Needs manager review.",
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AN-3(d) — device clock drift
// ---------------------------------------------------------------------------

/**
 * How far ahead of the SERVER's clock an event's occurredAt may sit before
 * it is flagged. Events legitimately arrive LATE (offline queues flush hours
 * or days after the sale) so lateness is never drift — only a timestamp from
 * the FUTURE proves the device's clock is wrong. 5 minutes absorbs normal
 * NTP skew on a healthy iPad.
 */
export const CLOCK_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;

export type ClockDriftCheck =
  | { drifted: false }
  | { drifted: true; aheadMs: number; reason: string };

/**
 * Flag an envelope whose occurredAt is ahead of the server's now by more
 * than the tolerance. Pure: both instants are passed in. The caller marks
 * the event a POS EXCEPTION (the ledger fact is preserved and the manager
 * reviews it) — a future timestamp poisons the sales-hours gate and the
 * business-day ledger, so the event must not be auto-processed as if its
 * clock were trustworthy. Lateness is NEVER drift: offline queues
 * legitimately flush hours or days after the fact.
 */
export function checkClockDrift(
  occurredAtIso: string,
  serverNowMs: number,
  toleranceMs: number = CLOCK_DRIFT_TOLERANCE_MS,
): ClockDriftCheck {
  const occurred = Date.parse(occurredAtIso);
  if (!Number.isFinite(occurred)) {
    return { drifted: true, aheadMs: Number.NaN, reason: "occurredAt does not parse as a timestamp." };
  }
  const aheadMs = occurred - serverNowMs;
  if (aheadMs <= toleranceMs) return { drifted: false };
  const minutes = Math.round(aheadMs / 60000);
  return {
    drifted: true,
    aheadMs,
    reason:
      `Device clock drift: the event claims it occurred ~${minutes} minute${minutes === 1 ? "" : "s"} in the FUTURE ` +
      `(beyond the ${Math.round(toleranceMs / 60000)}-minute tolerance). Fix the device's clock — ` +
      `its timestamps drive the sales-hours gate and the business-day ledger.`,
  };
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

  // AN-3(b): manual-ID math re-run at sync, against the EVENT's date
  const manualMath = { dateOfBirth: "1990-07-13", expirationDate: "2030-01-01" };
  ok(checkManualIdMathAtSync(manualMath, "2026-07-13").ok, "21+ and unexpired on event date passes");
  ok(!checkManualIdMathAtSync({ ...manualMath, dateOfBirth: "2010-01-01" }, "2026-07-13").ok, "underage DOB fails at sync");
  ok(
    !checkManualIdMathAtSync({ ...manualMath, expirationDate: "2026-07-12" }, "2026-07-13").ok,
    "document expired the day before the event fails",
  );
  ok(
    checkManualIdMathAtSync({ ...manualMath, expirationDate: "2026-07-13" }, "2026-07-13").ok,
    "document valid THROUGH its expiry date",
  );
  {
    // Graded against the EVENT date, not sync arrival: expiry after the event
    // but (hypothetically) before sync must still pass.
    const r = checkManualIdMathAtSync({ dateOfBirth: "1990-01-01", expirationDate: "2026-07-14" }, "2026-07-13");
    ok(r.ok, "expiry between event and sync still passes (event-date grading)");
  }
  ok(!checkManualIdMathAtSync(manualMath, "13/07/2026").ok, "bad event date refused");
  {
    // Exactly 21 on the event date passes; the day before fails.
    ok(checkManualIdMathAtSync({ ...manualMath, dateOfBirth: "2005-07-13" }, "2026-07-13").ok, "21st birthday passes");
    ok(!checkManualIdMathAtSync({ ...manualMath, dateOfBirth: "2005-07-14" }, "2026-07-13").ok, "day before 21st fails");
  }

  // AN-3(c): drawer-session validation
  const SES = { id: U("5"), register_id: REG, opened_at: "2026-07-13T15:00:00.000Z", closed_at: null };
  ok(checkDrawerSessionForSale(SES, REG, "2026-07-13T18:00:00.000Z").ok, "sale inside open session ok");
  ok(!checkDrawerSessionForSale(null, REG, "2026-07-13T18:00:00.000Z").ok, "unknown session refused");
  {
    const r = checkDrawerSessionForSale({ ...SES, register_id: U("9") }, REG, "2026-07-13T18:00:00.000Z");
    ok(!r.ok && r.reason.includes("DIFFERENT register"), "foreign register session refused");
  }
  {
    const r = checkDrawerSessionForSale(SES, REG, "2026-07-13T14:00:00.000Z");
    ok(!r.ok && r.reason.includes("BEFORE"), "sale before session open refused");
  }
  {
    const closed = { ...SES, closed_at: "2026-07-13T23:00:00.000Z" };
    ok(checkDrawerSessionForSale(closed, REG, "2026-07-13T18:00:00.000Z").ok, "sale inside closed session's interval ok (late flush)");
    const r = checkDrawerSessionForSale(closed, REG, "2026-07-13T23:30:00.000Z");
    ok(!r.ok && r.reason.includes("AFTER"), "sale after session close refused");
  }

  // AN-3(d): clock drift — only FUTURE timestamps are drift; lateness never is.
  const NOW = Date.parse("2026-07-13T18:00:00.000Z");
  ok(!checkClockDrift("2026-07-13T18:00:00.000Z", NOW).drifted, "same instant not drifted");
  ok(!checkClockDrift("2026-07-10T18:00:00.000Z", NOW).drifted, "days-late offline flush not drifted");
  ok(!checkClockDrift("2026-07-13T18:04:00.000Z", NOW).drifted, "4 minutes ahead within tolerance");
  {
    const r = checkClockDrift("2026-07-13T18:06:00.000Z", NOW);
    ok(r.drifted && r.reason.includes("FUTURE"), "6 minutes ahead flagged");
  }
  ok(checkClockDrift("garbage", NOW).drifted, "unparseable timestamp flagged");

  console.log(`pos/sync-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/sync-core tests failed`);
}
