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
  checkEnvelopeForDevice,
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

describe("embedded self-tests", () => {
  it("__runPosSyncCoreTests passes", () => {
    expect(() => __runPosSyncCoreTests()).not.toThrow();
  });
});
