/**
 * tests/compliance/pos-sync-core.test.ts  (POS Slice B4)
 *
 * Pins the sync ingest decision logic: a device may only submit its own
 * events bound to its own register, punch replay ASSERTS the recorded intent
 * (never blind-toggles — POS_SEAM_AUDIT Seam 4), manual ID verification
 * events carry the full WAC 314-55-150 audit payload, and the ACK semantics
 * that let a device safely clear its offline queue.
 */
import { describe, it, expect } from "vitest";
import {
  checkClockDrift,
  checkDrawerSessionForSale,
  checkEnvelopeForDevice,
  checkManualIdMathAtSync,
  resolvePunchIntent,
  validateManualIdEventPayload,
  ackMeansDurablyAccepted,
  __runPosSyncCoreTests,
  type ManualIdEventPayload,
} from "@/lib/pos/sync-core";
import type { PosEventEnvelope } from "@/lib/pos/sale-event-core";

const DEV = "11111111-1111-4111-8111-111111111111";
const REG = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";
const OTHER = "99999999-9999-4999-8999-999999999999";

const envelope: PosEventEnvelope = {
  clientUuid: "44444444-4444-4444-8444-444444444444",
  deviceId: DEV,
  registerId: REG,
  employeeId: EMP,
  sequence: 7,
  occurredAt: "2026-07-13T18:00:00.000Z",
  eventType: "punch",
  payload: { intent: "in" },
};

describe("envelope-vs-device binding", () => {
  it("accepts an envelope from the authenticated device on its register", () => {
    expect(checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: REG }).ok).toBe(true);
  });
  it("rejects an envelope claiming a different device", () => {
    const r = checkEnvelopeForDevice(envelope, { deviceId: OTHER, registerId: REG });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("deviceId");
  });
  it("rejects an envelope for a register the device is not bound to", () => {
    const r = checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: OTHER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("registerId");
  });
  it("rejects everything from a device with no register binding", () => {
    const r = checkEnvelopeForDevice(envelope, { deviceId: DEV, registerId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not bound");
  });
  it("rejects malformed envelopes before any binding check", () => {
    const r = checkEnvelopeForDevice({ ...envelope, clientUuid: "nope" }, { deviceId: DEV, registerId: REG });
    expect(r.ok).toBe(false);
  });
});

describe("punch intent replay (Seam 4 — never blind-toggle)", () => {
  it("clock-in intent with no open punch clocks in", () => {
    expect(resolvePunchIntent("in", false)).toEqual({ action: "clock_in" });
  });
  it("clock-out intent with an open punch clocks out", () => {
    expect(resolvePunchIntent("out", true)).toEqual({ action: "clock_out" });
  });
  it("stale clock-in intent (already in) is an idempotent skip", () => {
    const r = resolvePunchIntent("in", true);
    expect(r.action).toBe("skip");
  });
  it("clock-out intent with NO open punch is an exception for manager review", () => {
    const r = resolvePunchIntent("out", false);
    expect(r.action).toBe("exception");
    if (r.action === "exception") expect(r.reason).toContain("manager review");
  });
});

describe("manual_id_verification event payload", () => {
  const good: ManualIdEventPayload = {
    idType: "passport",
    dateOfBirth: "1990-07-13",
    expirationDate: "2030-01-01",
    reason: "Passport has no scannable barcode.",
  };
  it("accepts a complete WAC-typed audit payload", () => {
    expect(validateManualIdEventPayload(good).ok).toBe(true);
  });
  it("refuses non-WAC ID types, bad dates and short reasons", () => {
    expect(validateManualIdEventPayload({ ...good, idType: "library_card" }).ok).toBe(false);
    expect(validateManualIdEventPayload({ ...good, dateOfBirth: "13/07/1990" }).ok).toBe(false);
    expect(validateManualIdEventPayload({ ...good, expirationDate: "" }).ok).toBe(false);
    expect(validateManualIdEventPayload({ ...good, reason: "x" }).ok).toBe(false);
  });
});

describe("ACK semantics — when may the device clear a queue row?", () => {
  it("processed, duplicate and exception are durably accepted", () => {
    expect(ackMeansDurablyAccepted("processed")).toBe(true);
    expect(ackMeansDurablyAccepted("duplicate")).toBe(true);
    expect(ackMeansDurablyAccepted("exception")).toBe(true);
  });
  it("rejected is NOT durable — the device keeps and surfaces it", () => {
    expect(ackMeansDurablyAccepted("rejected")).toBe(false);
  });
});

describe("AN-3(b): manual-ID math re-run at sync (event-date grading)", () => {
  const good = { dateOfBirth: "1990-07-13", expirationDate: "2030-01-01" };
  it("passes a 21+ unexpired verification on its own date", () => {
    expect(checkManualIdMathAtSync(good, "2026-07-13").ok).toBe(true);
  });
  it("refuses an underage DOB the shape check could not catch", () => {
    expect(checkManualIdMathAtSync({ ...good, dateOfBirth: "2010-01-01" }, "2026-07-13").ok).toBe(false);
  });
  it("21st birthday passes; the day before fails", () => {
    expect(checkManualIdMathAtSync({ ...good, dateOfBirth: "2005-07-13" }, "2026-07-13").ok).toBe(true);
    expect(checkManualIdMathAtSync({ ...good, dateOfBirth: "2005-07-14" }, "2026-07-13").ok).toBe(false);
  });
  it("grades expiry against the EVENT date, not sync arrival", () => {
    // Valid through expiry day; expired the day after.
    expect(checkManualIdMathAtSync({ ...good, expirationDate: "2026-07-13" }, "2026-07-13").ok).toBe(true);
    expect(checkManualIdMathAtSync({ ...good, expirationDate: "2026-07-12" }, "2026-07-13").ok).toBe(false);
    // A doc that expires between event and sync must still pass.
    expect(checkManualIdMathAtSync({ ...good, expirationDate: "2026-07-14" }, "2026-07-13").ok).toBe(true);
  });
});

describe("AN-3(c): drawer-session validation for synced sales", () => {
  const SES = { id: "55555555-5555-4555-8555-555555555555", register_id: REG, opened_at: "2026-07-13T15:00:00.000Z", closed_at: null };
  it("accepts a sale inside its open session on the right register", () => {
    expect(checkDrawerSessionForSale(SES, REG, "2026-07-13T18:00:00.000Z").ok).toBe(true);
  });
  it("refuses an unknown session and a foreign register's session", () => {
    expect(checkDrawerSessionForSale(null, REG, "2026-07-13T18:00:00.000Z").ok).toBe(false);
    expect(checkDrawerSessionForSale({ ...SES, register_id: OTHER }, REG, "2026-07-13T18:00:00.000Z").ok).toBe(false);
  });
  it("refuses sales outside the session's open interval, but allows late flushes", () => {
    expect(checkDrawerSessionForSale(SES, REG, "2026-07-13T14:00:00.000Z").ok).toBe(false); // before open
    const closed = { ...SES, closed_at: "2026-07-13T23:00:00.000Z" };
    expect(checkDrawerSessionForSale(closed, REG, "2026-07-13T18:00:00.000Z").ok).toBe(true); // late flush of an in-window sale
    expect(checkDrawerSessionForSale(closed, REG, "2026-07-13T23:30:00.000Z").ok).toBe(false); // after close
  });
});

describe("AN-3(d): device clock drift — future-only, lateness never flags", () => {
  const NOW = Date.parse("2026-07-13T18:00:00.000Z");
  it("late offline flushes are never drift", () => {
    expect(checkClockDrift("2026-07-10T18:00:00.000Z", NOW).drifted).toBe(false);
  });
  it("small forward skew is tolerated; beyond tolerance flags", () => {
    expect(checkClockDrift("2026-07-13T18:04:00.000Z", NOW).drifted).toBe(false);
    expect(checkClockDrift("2026-07-13T18:06:00.000Z", NOW).drifted).toBe(true);
  });
  it("unparseable timestamps flag", () => {
    expect(checkClockDrift("garbage", NOW).drifted).toBe(true);
  });
});

describe("embedded self-tests", () => {
  it("__runPosSyncCoreTests passes", () => {
    expect(() => __runPosSyncCoreTests()).not.toThrow();
  });
});
