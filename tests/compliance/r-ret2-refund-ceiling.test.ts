/**
 * R-RET-2 (owner message 13): "my test sale was two products in one sale ...
 * I tried to return the second item from that sale, and it rejected it ...
 * 'refund exceeds what the customer paid for the returned quantity (max 0.00)'
 * ... fix it for me so I can make any refund necessary. please make the
 * errors be more plain english."
 *
 * Root cause: the refund ceiling was (unit price x quantity returned NOW)
 * minus EVERY earlier refund on the line. The owner's sale line was OG Kush
 * (1g) x2 at $18.70: unit 1 refunded $18.70, so unit 2's ceiling became
 * 18.70 - 18.70 = $0.00 and the exact refund the register computed was
 * refused. The ceiling is now the SMALLER of what the customer paid for the
 * units coming back and what is still unrefunded on the whole line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  refundCeilingMinor,
  refundTooHighMessage,
  validateCustomerReturn,
  __runDispositionCoreTests,
} from "../../src/lib/inventory/disposition-core";
import { refundForLine, __runPosReturnsCoreTests } from "../../src/lib/pos/returns-core";
import { dbErrorForStaff, plainDbError, __runRpcFallbackCoreTests } from "../../src/lib/db/rpc-fallback-core";

const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

/** Replays the register flow: refundForLine computes, the ceiling checks. */
function registerReturn(line: { unit: number; qty: number }, prior: { qty: number; refund: number }[], qtyNow: number) {
  const returned = prior.reduce((a, r) => a + r.qty, 0);
  const refunded = prior.reduce((a, r) => a + r.refund, 0);
  const refund = refundForLine({ unitPriceMinor: line.unit, quantity: qtyNow, remainingReturnable: line.qty - returned });
  if (!refund.ok) return refund;
  return validateCustomerReturn({
    quantity: qtyNow,
    originalQuantity: line.qty - returned,
    originalPackaging: true,
    lotIdLegible: true,
    disposition: "restock",
    reason: "wrong_item",
    refundMinor: refund.refundMinor,
    maxRefundMinor: refundCeilingMinor({
      unitPriceMinor: line.unit,
      lineQuantity: line.qty,
      returnQuantity: qtyNow,
      alreadyRefundedMinor: refunded,
    }),
  });
}

describe("R-RET-2: the owner's two-unit sale returns one unit at a time", () => {
  const ogKush = { unit: 1870, qty: 2 };

  it("first unit returns (as before)", () => {
    expect(registerReturn(ogKush, [], 1).ok).toBe(true);
  });

  it("second unit now returns too (was refused with 'max 0.00')", () => {
    const res = registerReturn(ogKush, [{ qty: 1, refund: 1870 }], 1);
    expect(res).toEqual({ ok: true, correctionOperation: "Delete" });
  });

  it("a third return on the same line is refused in plain English", () => {
    const res = registerReturn(ogKush, [{ qty: 1, refund: 1870 }, { qty: 1, refund: 1870 }], 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already been returned/);
  });

  it("works for any split: 5 units returned 1, 2, then 2", () => {
    const line = { unit: 999, qty: 5 };
    expect(registerReturn(line, [], 1).ok).toBe(true);
    expect(registerReturn(line, [{ qty: 1, refund: 999 }], 2).ok).toBe(true);
    expect(registerReturn(line, [{ qty: 1, refund: 999 }, { qty: 2, refund: 1998 }], 2).ok).toBe(true);
  });

  it("still never pays out more than the customer paid", () => {
    expect(refundCeilingMinor({ unitPriceMinor: 1870, lineQuantity: 2, returnQuantity: 1, alreadyRefundedMinor: 1870 })).toBe(1870);
    expect(refundCeilingMinor({ unitPriceMinor: 1870, lineQuantity: 2, returnQuantity: 1, alreadyRefundedMinor: 3740 })).toBe(0);
    const over = validateCustomerReturn({
      quantity: 1, originalQuantity: 1, originalPackaging: true, lotIdLegible: true,
      disposition: "restock", reason: "wrong_item", refundMinor: 1871, maxRefundMinor: 1870,
    });
    expect(over.ok).toBe(false);
  });
});

describe("R-RET-2: both return paths use the new ceiling", () => {
  it("cannabis returns (back office + register) use refundCeilingMinor", () => {
    const d = src("src/lib/inventory/disposition.ts");
    expect(d).toContain("const maxRefundMinor = refundCeilingMinor({");
    expect(d).not.toContain("outTheDoorUnit * input.quantity - alreadyRefundedMinor");
  });
  it("Other Inventory returns use the same ceiling and message", () => {
    const n = src("src/lib/noncannabis/returns.ts");
    expect(n).toContain("const maxRefund = refundCeilingMinor({");
    expect(n).toContain("refundTooHighMessage(input.refundMinor, maxRefund)");
    expect(n).not.toContain("* qty - Math.max(0, refunded - 0)");
  });
});

describe("R-RET-2: errors read as plain English", () => {
  it("the refund message names dollars and says what to do", () => {
    expect(refundTooHighMessage(2000, 1870)).toBe(
      "The refund of $20.00 is more than the customer paid for what they're returning. " +
        "The most you can refund for this return is $18.70. Lower the refund and try again.",
    );
    expect(refundTooHighMessage(1870, 0)).toMatch(/already been refunded everything they paid/);
  });
  it("no return message uses the old jargon", () => {
    const files = [
      "src/lib/inventory/disposition-core.ts",
      "src/lib/pos/returns-core.ts",
      "src/lib/noncannabis/returns.ts",
    ];
    for (const f of files) {
      const t = src(f);
      expect(t, f).not.toContain("Reduce the refund.");
      expect(t, f).not.toContain("Only COMPLETED sales");
      expect(t, f).not.toContain("exceeds what is still returnable");
      expect(t, f).not.toContain("non-negative integer cents");
    }
  });
  it("database errors are translated", () => {
    expect(dbErrorForStaff({ code: "23505", message: "duplicate key value violates unique constraint \"x\"" })).toMatch(/already saved/);
    expect(plainDbError({ code: "P0001", message: "record_customer_return: lot 12 not found" })).toBe("Lot 12 not found.");
    expect(dbErrorForStaff({ code: "42501", message: "permission denied for function record_customer_return" })).toMatch(
      /isn't allowed to use function record_customer_return/,
    );
  });
  it("embedded self-tests pass", () => {
    expect(__runDispositionCoreTests().failed).toBe(0);
    expect(() => __runPosReturnsCoreTests()).not.toThrow();
    expect(() => __runRpcFallbackCoreTests()).not.toThrow();
  });
});
