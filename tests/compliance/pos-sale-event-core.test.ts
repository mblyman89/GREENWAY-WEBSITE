/**
 * tests/compliance/pos-sale-event-core.test.ts  (POS Slice B2)
 *
 * Pins the register's offline-first event envelope + cash-tender math:
 * idempotency-shaped envelopes (client UUID, device sequence), the cash-only
 * payment enum (owner decision — POS_FRONTEND_RESEARCH §14), the mandatory
 * ID-gate reference on every sale, intent-carrying punches, and no-sale
 * controls. The same pure core runs on the iPad and in the sync route.
 */
import { describe, it, expect } from "vitest";
import {
  POS_PAYMENT_METHODS,
  ENABLED_PAYMENT_METHODS,
  isPaymentMethodEnabled,
  computeCashChange,
  validateEnvelope,
  validateSalePayload,
  validatePunchPayload,
  validateNoSalePayload,
  sortEventsForReplay,
  __runPosSaleEventTests,
  type PosEventEnvelope,
  type PosSalePayload,
} from "@/lib/pos/sale-event-core";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";
const U5 = "55555555-5555-4555-8555-555555555555";

describe("payment methods (owner decision: cash-only launch)", () => {
  it("enum carries the four planned methods", () => {
    expect([...POS_PAYMENT_METHODS]).toEqual(["cash", "point_of_banking", "ach", "debit"]);
  });
  it("ONLY cash is enabled at launch", () => {
    expect([...ENABLED_PAYMENT_METHODS]).toEqual(["cash"]);
    expect(isPaymentMethodEnabled("cash")).toBe(true);
    expect(isPaymentMethodEnabled("debit")).toBe(false);
    expect(isPaymentMethodEnabled("point_of_banking")).toBe(false);
    expect(isPaymentMethodEnabled("ach")).toBe(false);
    expect(isPaymentMethodEnabled("credit")).toBe(false);
  });
});

describe("cash tender math (no mental math at the register)", () => {
  it("computes exact change in minor units", () => {
    const r = computeCashChange({ totalMinor: 2926, tenderedMinor: 4000 });
    expect(r).toEqual({ ok: true, changeMinor: 1074 });
  });
  it("refuses short tenders with the shortfall amount", () => {
    const r = computeCashChange({ totalMinor: 2926, tenderedMinor: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("9.26");
  });
  it("refuses non-integer money", () => {
    expect(computeCashChange({ totalMinor: 29.26 as unknown as number, tenderedMinor: 4000 }).ok).toBe(false);
    expect(computeCashChange({ totalMinor: 2926, tenderedMinor: -1 }).ok).toBe(false);
  });
});

describe("event envelope", () => {
  const good: PosEventEnvelope = {
    clientUuid: U1,
    deviceId: U2,
    registerId: U3,
    employeeId: U4,
    sequence: 7,
    occurredAt: "2026-07-13T10:00:00.000Z",
    eventType: "sale",
    payload: {},
  };
  it("accepts a complete envelope", () => {
    expect(validateEnvelope(good).ok).toBe(true);
  });
  it("requires UUIDs for identity fields", () => {
    for (const k of ["clientUuid", "deviceId", "registerId", "employeeId"] as const) {
      expect(validateEnvelope({ ...good, [k]: "not-a-uuid" }).ok).toBe(false);
    }
  });
  it("requires a non-negative integer sequence and a real timestamp", () => {
    expect(validateEnvelope({ ...good, sequence: -1 }).ok).toBe(false);
    expect(validateEnvelope({ ...good, sequence: 1.5 }).ok).toBe(false);
    expect(validateEnvelope({ ...good, occurredAt: "garbage" }).ok).toBe(false);
    expect(validateEnvelope({ ...good, occurredAt: "2026-07-13T10:00:00-07:00" }).ok).toBe(true);
  });
  it("rejects unknown event types", () => {
    expect(validateEnvelope({ ...good, eventType: "refund" as never }).ok).toBe(false);
  });
});

describe("sale payload", () => {
  const good: PosSalePayload = {
    lines: [
      {
        productId: "prod-1",
        productName: "Blue Dream 3.5g",
        category: "flower",
        quantity: 2,
        unitPriceMinor: 1463,
        regularPriceMinor: 1463,
      },
    ],
    totalMinor: 2926,
    subtotalMinor: 2000,
    taxMinor: 926,
    paymentMethod: "cash",
    tenderedMinor: 3000,
    changeMinor: 74,
    drawerSessionId: U5,
    idVerification: { method: "scan" },
  };
  it("accepts a valid cash sale", () => {
    expect(validateSalePayload(good).ok).toBe(true);
  });
  it("hard-blocks disabled payment methods (cash-only launch)", () => {
    const r = validateSalePayload({ ...good, paymentMethod: "debit" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("not enabled");
  });
  it("cash sales must record tendered and consistent change", () => {
    expect(validateSalePayload({ ...good, tenderedMinor: undefined }).ok).toBe(false);
    expect(validateSalePayload({ ...good, tenderedMinor: 2000 }).ok).toBe(false);
    expect(validateSalePayload({ ...good, changeMinor: 999 }).ok).toBe(false);
  });
  it("every sale must carry an ID-gate result; manual verifies reference their audit event", () => {
    expect(validateSalePayload({ ...good, idVerification: undefined }).ok).toBe(false);
    expect(validateSalePayload({ ...good, idVerification: { method: "manual" } }).ok).toBe(false);
    expect(
      validateSalePayload({ ...good, idVerification: { method: "manual", manualEventUuid: U1 } }).ok,
    ).toBe(true);
  });
  it("lines require category snapshots, positive quantities, integer money", () => {
    expect(validateSalePayload({ ...good, lines: [] }).ok).toBe(false);
    expect(validateSalePayload({ ...good, lines: [{ ...good.lines[0], category: " " }] }).ok).toBe(false);
    expect(validateSalePayload({ ...good, lines: [{ ...good.lines[0], quantity: 0 }] }).ok).toBe(false);
    expect(
      validateSalePayload({ ...good, lines: [{ ...good.lines[0], unitPriceMinor: 14.63 as unknown as number }] }).ok,
    ).toBe(false);
  });
  it("sale must belong to an open drawer session", () => {
    expect(validateSalePayload({ ...good, drawerSessionId: "till-1" }).ok).toBe(false);
  });

  describe("loyalty block (POS B14)", () => {
    it("accepts a valid member attach", () => {
      expect(validateSalePayload({ ...good, loyalty: { customerId: U4, memberLabel: "Jane D." } }).ok).toBe(true);
    });
    it("refuses non-uuid customer ids, blank/over-long labels, non-objects", () => {
      expect(validateSalePayload({ ...good, loyalty: { customerId: "cust-1", memberLabel: "Jane D." } }).ok).toBe(false);
      expect(validateSalePayload({ ...good, loyalty: { customerId: U4, memberLabel: " " } }).ok).toBe(false);
      expect(validateSalePayload({ ...good, loyalty: { customerId: U4, memberLabel: "x".repeat(81) } }).ok).toBe(false);
      expect(
        validateSalePayload({ ...good, loyalty: "member" as unknown as { customerId: string; memberLabel: string } }).ok,
      ).toBe(false);
    });
    it("stays optional — a sale with no loyalty block is untouched", () => {
      expect(validateSalePayload(good).ok).toBe(true);
    });
  });

  describe("medical block (POS B8)", () => {
    const medical = {
      card: {
        upid: "WA-UPID-0001",
        effectiveOn: "2026-01-01",
        expiresOn: "2027-01-01",
        holderType: "patient" as const,
        mcrVerified: true,
      },
      cardEventUuid: U3,
      medicalSavingsMinor: 463,
    };
    // A fully exempt medical version of the same cart: patient pays base only.
    const goodMed: PosSalePayload = {
      ...good,
      lines: [{ ...good.lines[0], unitPriceMinor: 1000 }],
      totalMinor: 2000,
      subtotalMinor: 2000,
      taxMinor: 0,
      tenderedMinor: 2000,
      changeMinor: 0,
      medical,
    };
    it("accepts a medical sale with the full block", () => {
      expect(validateSalePayload(goodMed).ok).toBe(true);
    });
    it("a sale without the medical block is still valid (recreational)", () => {
      expect(validateSalePayload(good).ok).toBe(true);
    });
    it("requires the card-capture audit event UUID", () => {
      const r = validateSalePayload({ ...goodMed, medical: { ...medical, cardEventUuid: "nope" } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain("medical_card_capture");
    });
    it("requires the MCR verification attestation", () => {
      const r = validateSalePayload({
        ...goodMed,
        medical: { ...medical, card: { ...medical.card, mcrVerified: false } },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain("DOH Medical Cannabis Database");
    });
    it("refuses malformed card facts (UPID, dates, holder type)", () => {
      expect(
        validateSalePayload({ ...goodMed, medical: { ...medical, card: { ...medical.card, upid: "x" } } }).ok,
      ).toBe(false);
      expect(
        validateSalePayload({
          ...goodMed,
          medical: { ...medical, card: { ...medical.card, effectiveOn: "01/01/2026" } },
        }).ok,
      ).toBe(false);
      expect(
        validateSalePayload({
          ...goodMed,
          medical: { ...medical, card: { ...medical.card, holderType: "friend" as "patient" } },
        }).ok,
      ).toBe(false);
    });
    it("savings must be a non-negative integer", () => {
      expect(validateSalePayload({ ...goodMed, medical: { ...medical, medicalSavingsMinor: -1 } }).ok).toBe(false);
      expect(
        validateSalePayload({ ...goodMed, medical: { ...medical, medicalSavingsMinor: 4.63 as unknown as number } })
          .ok,
      ).toBe(false);
    });
  });
});

describe("punch + no-sale payloads", () => {
  it("punches carry explicit intent (never a blind toggle)", () => {
    expect(validatePunchPayload({ intent: "in" }).ok).toBe(true);
    expect(validatePunchPayload({ intent: "out" }).ok).toBe(true);
    expect(validatePunchPayload({ intent: "toggle" as never }).ok).toBe(false);
    expect(validatePunchPayload({}).ok).toBe(false);
  });
  it("no-sale drawer opens require a reason and a manager approver", () => {
    expect(validateNoSalePayload({ reason: "change fund swap", approvedByEmployeeId: U4 }).ok).toBe(true);
    expect(validateNoSalePayload({ reason: "x", approvedByEmployeeId: U4 }).ok).toBe(false);
    expect(validateNoSalePayload({ reason: "valid reason" }).ok).toBe(false);
  });
});

describe("replay ordering", () => {
  it("sorts by device, then monotonic sequence, then time", () => {
    const sorted = sortEventsForReplay([
      { deviceId: U2, sequence: 2, occurredAt: "2026-07-13T10:02:00Z" },
      { deviceId: U1, sequence: 5, occurredAt: "2026-07-13T10:05:00Z" },
      { deviceId: U2, sequence: 1, occurredAt: "2026-07-13T10:01:00Z" },
    ]);
    expect(sorted[0].deviceId).toBe(U1);
    expect(sorted[1]).toMatchObject({ deviceId: U2, sequence: 1 });
    expect(sorted[2]).toMatchObject({ deviceId: U2, sequence: 2 });
  });
});

describe("embedded self-tests", () => {
  it("__runPosSaleEventTests passes", () => {
    expect(() => __runPosSaleEventTests()).not.toThrow();
  });
});
