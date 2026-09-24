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

  it("sorts the queue newest-first regardless of status (L-36)", () => {
    const sorted = sortPickupQueue([
      { status: "new" as OrderStatus, placedAtIso: "2026-02-10T09:00:00Z", tag: "new-early" },
      { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T10:00:00Z", tag: "ready-late" },
      { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T08:00:00Z", tag: "ready-early" },
      { status: "preparing" as OrderStatus, placedAtIso: "2026-02-10T07:00:00Z", tag: "prep" },
    ]);
    expect(sorted.map((e) => (e as { tag: string }).tag)).toEqual([
      "ready-late",
      "new-early",
      "ready-early",
      "prep",
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

  // =========================================================================
  // SLICE L-12 — the register can tell a Leafly order from a website order
  // =========================================================================
  //
  // Owner: "The two types need to be distinguishable from each other." He
  // said it about the register, and the register was the one screen where
  // they were not: `orders.origin` has existed since migration 0226 and the
  // back office showed it, but this queue entry never copied it across. The
  // last screen before a regulated handover drew both kinds of order as the
  // same tile.
  describe("L-12: origin reaches the counter", () => {
    const row = {
      id: "o1",
      order_number: "GW-2001",
      customer_first_name: "Sam",
      customer_last_name: "Reed",
      status: "ready" as OrderStatus,
      item_count: 2,
      total_minor_units: 3000,
      placed_at: "2026-02-10T10:00:00Z",
      customer_note: null,
    };
    const at = "2026-02-10T10:05:00Z";

    it("a Leafly order arrives at the counter labelled as one", () => {
      const e = toPickupQueueEntry({ ...row, origin: "leafly" }, at);
      expect(e.origin).toBe("leafly");
      expect(e.originLabel).toBe("Leafly");
      expect(e.isMarketplace).toBe(true);
    });

    it("a website order is not dressed up as a marketplace order", () => {
      const e = toPickupQueueEntry({ ...row, origin: "greenway" }, at);
      expect(e.origin).toBe("greenway");
      expect(e.originLabel).toBe("Website");
      expect(e.isMarketplace).toBe(false);
    });

    it("THE REQUIREMENT: the two types actually differ, in word and in kind", () => {
      // Asserting each label separately would still pass if somebody made
      // both of them read "Online" — which would satisfy every other test in
      // this file while completely undoing the owner's request.
      const leafly = toPickupQueueEntry({ ...row, origin: "leafly" }, at);
      const site = toPickupQueueEntry({ ...row, origin: "greenway" }, at);
      expect(leafly.originLabel).not.toBe(site.originLabel);
      expect(leafly.isMarketplace).not.toBe(site.isMarketplace);
    });

    it("treats an untracked column, a null and junk as the website default", () => {
      // Three states, one safe answer. A row read before migration 0226 has
      // no column at all; that is not the same as a null, and neither is an
      // error. Both resolve to the least-restricted origin, because the cost
      // of guessing wrong here is a missing badge — never a blocked handover.
      expect(toPickupQueueEntry(row, at).origin).toBe("greenway");
      expect(toPickupQueueEntry({ ...row, origin: null }, at).origin).toBe("greenway");
      expect(toPickupQueueEntry({ ...row, origin: "weedmaps" }, at).origin).toBe("greenway");
      expect(toPickupQueueEntry({ ...row, origin: "weedmaps" }, at).isMarketplace).toBe(false);
    });

    it("normalises case and whitespace, because the value crosses three systems", () => {
      expect(toPickupQueueEntry({ ...row, origin: "  LEAFLY " }, at).origin).toBe("leafly");
    });

    it("never produces an empty label", () => {
      // An empty badge reads as a rendering bug, and staff stop trusting the
      // whole column — taking the Leafly badge down with it.
      for (const origin of [undefined, null, "", "leafly", "greenway", "register", "junk"]) {
        const e = toPickupQueueEntry({ ...row, origin }, at);
        expect(e.originLabel.trim()).not.toBe("");
      }
    });
  });

  it("embedded self-tests pass", () => {
    expect(() => __runPickupCoreTests()).not.toThrow();
  });

  it("the embedded suite still runs its full body (harness floor)", () => {
    // `__runPickupCoreTests` returns void and throws only on FAILURE, so a
    // suite whose assertions were all deleted would pass in total silence —
    // the exact failure mode standing rule 5's floors exist to prevent.
    //
    // It cannot be given an `assertRan` floor without changing its signature
    // and every call site, so the count is pinned here instead, by capturing
    // the line it prints. 38 is the count after L-12 added the origin
    // assertions (was 21). Raise it deliberately when you add more; a DROP
    // means coverage was deleted.
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      __runPickupCoreTests();
    } finally {
      console.log = original;
    }
    const summary = lines.find((l) => l.includes("pickup-core self-tests"));
    expect(summary).toBeDefined();
    const count = Number(/\((\d+) assertions\)/.exec(summary ?? "")?.[1] ?? 0);
    expect(count).toBeGreaterThanOrEqual(38);
  });
});
