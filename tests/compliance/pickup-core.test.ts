/**
 * tests/compliance/pickup-core.test.ts  (POS Slice B28)
 *
 * Vitest mirror of the pickup-core pure policy: POS-materialized order
 * detection, counter sorting, queue-entry shaping, and the register-side
 * handover completion gates (ID attestation, active status, cash tender).
 */
import { describe, it, expect } from "vitest";
import {
  POS_SALE_STAFF_NOTE_PREFIX,
  isPosMaterializedOrder,
  customerPickupLabel,
  minutesBetween,
  sortPickupQueue,
  toPickupQueueEntry,
  evaluatePickupCompletion,
  __runPickupCoreTests,
} from "@/lib/pos/pickup-core";
import type { OrderStatus } from "@/lib/orders/types";

describe("pickup-core (POS B28)", () => {
  it("detects POS-materialized orders by the exact sync staff_note prefix (em-dash)", () => {
    expect(POS_SALE_STAFF_NOTE_PREFIX).toBe("POS sale —");
    expect(isPosMaterializedOrder("POS sale — Front iPad — rung by Casey. Event x.")).toBe(true);
    expect(isPosMaterializedOrder("POS sale - hyphen does not match")).toBe(false);
    expect(isPosMaterializedOrder("Customer called ahead")).toBe(false);
    expect(isPosMaterializedOrder(null)).toBe(false);
    expect(isPosMaterializedOrder(undefined)).toBe(false);
  });

  it("builds privacy-lean counter labels", () => {
    expect(customerPickupLabel("Jordan", "Taylor")).toBe("Jordan T.");
    expect(customerPickupLabel("Jordan", null)).toBe("Jordan");
    expect(customerPickupLabel("", "")).toBe("Customer");
  });

  it("computes waiting minutes defensively (floor, clamp, never NaN)", () => {
    expect(minutesBetween("2026-02-10T10:00:00Z", "2026-02-10T10:31:30Z")).toBe(31);
    expect(minutesBetween("2026-02-10T11:00:00Z", "2026-02-10T10:00:00Z")).toBe(0);
    expect(minutesBetween("garbage", "2026-02-10T10:00:00Z")).toBe(0);
  });

  it("sorts the queue ready-first then oldest-first within each status", () => {
    const sorted = sortPickupQueue([
      { status: "new" as OrderStatus, placedAtIso: "2026-02-10T09:00:00Z", tag: "new-early" },
      { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T10:00:00Z", tag: "ready-late" },
      { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T08:00:00Z", tag: "ready-early" },
      { status: "preparing" as OrderStatus, placedAtIso: "2026-02-10T07:00:00Z", tag: "prep" },
    ]);
    expect(sorted.map((e) => (e as { tag: string }).tag)).toEqual([
      "ready-early",
      "ready-late",
      "prep",
      "new-early",
    ]);
  });

  it("shapes a queue entry with label, waiting minutes, status label, and note flag", () => {
    const entry = toPickupQueueEntry(
      {
        id: "o1",
        order_number: "GW-1042",
        customer_first_name: "Jordan",
        customer_last_name: "Taylor",
        status: "ready",
        item_count: 3,
        total_minor_units: 4550,
        placed_at: "2026-02-10T10:00:00Z",
        customer_note: "  Will arrive around 4pm  ",
      },
      "2026-02-10T10:20:00Z",
    );
    expect(entry.customerLabel).toBe("Jordan T.");
    expect(entry.minutesWaiting).toBe(20);
    expect(entry.statusLabel).toBe("Ready for pickup");
    expect(entry.hasCustomerNote).toBe(true);
    expect(entry.totalMinor).toBe(4550);
  });

  it("allows a compliant handover and computes change in cents", () => {
    const v = evaluatePickupCompletion({
      orderStatus: "ready",
      isPosSale: false,
      idConfirmed: true,
      totalMinor: 4550,
      tenderedMinor: 5000,
    });
    expect(v).toEqual({ ok: true, changeMinor: 450 });
  });

  it("reports ALL failing handover gates together (POS sale, closed status, no ID, short tender)", () => {
    const v = evaluatePickupCompletion({
      orderStatus: "completed",
      isPosSale: true,
      idConfirmed: false,
      totalMinor: 4550,
      tenderedMinor: 4000,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toHaveLength(4);
      expect(v.errors.join(" ")).toContain("register sale");
      expect(v.errors.join(" ")).toContain("ID");
    }
  });

  it("refuses fractional-cent totals and allows zero-total (fully discounted) pickups", () => {
    const bad = evaluatePickupCompletion({
      orderStatus: "ready",
      isPosSale: false,
      idConfirmed: true,
      totalMinor: 45.5,
      tenderedMinor: 5000,
    });
    expect(bad.ok).toBe(false);
    const zero = evaluatePickupCompletion({
      orderStatus: "ready",
      isPosSale: false,
      idConfirmed: true,
      totalMinor: 0,
      tenderedMinor: 0,
    });
    expect(zero).toEqual({ ok: true, changeMinor: 0 });
  });

  it("embedded self-tests pass", () => {
    expect(() => __runPickupCoreTests()).not.toThrow();
  });
});
