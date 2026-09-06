/**
 * tests/compliance/order-name-inheritance.test.ts  (SLICE 26)
 *
 * A website order is given its fun name SERVER-side when the row is inserted,
 * and the customer sees that name twice before they ever reach the store: on
 * the confirmation screen and in the email. When they arrive and the budtender
 * loads the order into a register sale, the printed receipt must show the SAME
 * name — not a fresh draw.
 *
 * Owner: "the fun overlay on the printed receipt is now different from the one
 * originally attached to the online order. I am all about consistency and I
 * feel like if I notice this, others will too."
 *
 * This file pins both halves of that fix:
 *   1. a loaded order INHERITS its stored name (consistency), and
 *   2. inheriting consumes NO pool slot (the register used to burn a second
 *      name to print a receipt for an order that already had one).
 */
import { describe, it, expect } from "vitest";
import {
  resolveNameInheritance,
  normalizeSourceOrderIdForName,
  normalizePrefetchedName,
  __runOrderNamePrefetchCoreTests,
} from "@/lib/pos/order-name-prefetch-core";

const ORD = "4f6d2a1e-8c3b-4d5e-9a7f-1b2c3d4e5f60";

describe("order name inheritance (SLICE 26)", () => {
  it("a loaded website order reuses the exact name the customer already saw", () => {
    const got = resolveNameInheritance({ sourceOrderId: ORD, storedDisplayName: "Purple Rain" });
    expect(got.action).toBe("inherit");
    expect(got.action === "inherit" && got.name).toBe("Purple Rain");
  });

  it("inheriting never falls through to a draw, so no pool slot is burned", () => {
    // The rotation is the scarce resource: every draw stamps the assignment
    // sequence and pulls the next repeat closer. A pickup that already has a
    // name must cost the pool nothing.
    expect(resolveNameInheritance({ sourceOrderId: ORD, storedDisplayName: "High Life" }).action)
      .not.toBe("draw");
  });

  it("a walk-in sale still draws from the pool exactly as before", () => {
    expect(resolveNameInheritance({ sourceOrderId: null, storedDisplayName: null }).action).toBe("draw");
    // Even a stray stored name cannot leak into a walk-in: no source order,
    // no inheritance.
    expect(resolveNameInheritance({ sourceOrderId: null, storedDisplayName: "Purple Rain" }).action)
      .toBe("draw");
  });

  it("a loaded order with no stored name draws (pre-pool, pre-0147, or empty pool)", () => {
    // Those customers were shown the plain GWY- number, so there is nothing to
    // be consistent WITH and the paper should get a name like any walk-in.
    for (const stored of [null, undefined, "", "   "]) {
      expect(resolveNameInheritance({ sourceOrderId: ORD, storedDisplayName: stored }).action)
        .toBe("draw");
    }
  });

  it("an inherited name is trimmed so it matches the confirmation page byte for byte", () => {
    const got = resolveNameInheritance({ sourceOrderId: ORD, storedDisplayName: "  Purple Rain  " });
    expect(got.action === "inherit" && got.name).toBe("Purple Rain");
  });

  it("an over-long inherited name is inherited, never re-drawn", () => {
    // Re-drawing here would be the worst outcome: it would burn a pool slot AND
    // print a name contradicting the customer's email. Printability is decided
    // once, by normalizePrefetchedName, which degrades it to the real number.
    const long = "x".repeat(64);
    expect(resolveNameInheritance({ sourceOrderId: ORD, storedDisplayName: long }).action)
      .toBe("inherit");
    expect(normalizePrefetchedName(long)).toBeNull();
  });

  it("only a UUID-shaped source order id is ever looked up", () => {
    expect(normalizeSourceOrderIdForName(ORD)).toBe(ORD);
    expect(normalizeSourceOrderIdForName(`  ${ORD}  `)).toBe(ORD);
    for (const bad of ["not-a-uuid", "", "   ", `${ORD}x`, null, undefined, 42, { id: ORD }]) {
      expect(normalizeSourceOrderIdForName(bad)).toBeNull();
    }
  });

  it("runs the pure self-tests with zero failures", () => {
    const { passed, failed } = __runOrderNamePrefetchCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });
});
