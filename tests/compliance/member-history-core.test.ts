/**
 * tests/compliance/member-history-core.test.ts  (POS Slice B29)
 *
 * Vitest mirror of the member-history pure core: privacy budget constants,
 * Pacific date labels, purchase shaping (line caps + counts), favorites
 * ranking, and window discipline.
 */
import { describe, it, expect } from "vitest";
import {
  HISTORY_ORDER_LIMIT,
  FAVORITES_LIMIT,
  HISTORY_LINES_PER_ORDER,
  pacificDateLabel,
  buildMemberHistory,
  __runMemberHistoryCoreTests,
  type HistoryOrderInput,
} from "@/lib/pos/member-history-core";

const NOW = "2026-02-10T20:00:00Z";

describe("member-history-core (POS B29)", () => {
  it("keeps the privacy budget tight", () => {
    expect(HISTORY_ORDER_LIMIT).toBe(5);
    expect(FAVORITES_LIMIT).toBe(3);
    expect(HISTORY_LINES_PER_ORDER).toBe(4);
  });

  it("labels dates on the Pacific calendar (year only when different)", () => {
    expect(pacificDateLabel("2026-02-08T19:30:00Z", NOW)).toBe("Feb 8");
    expect(pacificDateLabel("2025-11-30T19:30:00Z", NOW)).toBe("Nov 30, 2025");
    // 05:00 UTC on Jan 1 is still Dec 31 in Pacific.
    expect(pacificDateLabel("2026-01-01T05:00:00Z", NOW)).toBe("Dec 31, 2025");
    expect(pacificDateLabel(null, NOW)).toBe("—");
    expect(pacificDateLabel("garbage", NOW)).toBe("—");
  });

  it("shapes purchases with line caps, moreCount, and item counts", () => {
    const orders: HistoryOrderInput[] = [
      {
        orderId: "o1",
        completedAtIso: "2026-02-08T19:30:00Z",
        totalMinor: 4550,
        lines: [
          { productName: "Blue Dream 3.5g", quantity: 2 },
          { productName: "OG Kush Pre-roll", quantity: 1 },
          { productName: "Gummies 100mg", quantity: 1 },
          { productName: "Vape Cart 1g", quantity: 1 },
          { productName: "Lighter", quantity: 1 },
        ],
      },
    ];
    const h = buildMemberHistory(orders, NOW);
    expect(h.purchases).toHaveLength(1);
    const p = h.purchases[0];
    expect(p.dateLabel).toBe("Feb 8");
    expect(p.totalMinor).toBe(4550);
    expect(p.itemCount).toBe(6);
    expect(p.items).toHaveLength(HISTORY_LINES_PER_ORDER);
    expect(p.items[0]).toBe("2x Blue Dream 3.5g");
    expect(p.moreCount).toBe(1);
  });

  it("ranks favorites by quantity, breaks ties by order count then name, and caps the list", () => {
    const orders: HistoryOrderInput[] = [
      {
        orderId: "o1",
        completedAtIso: NOW,
        totalMinor: 100,
        lines: [
          { productName: "Gummies", quantity: 3 },
          { productName: "Blue Dream", quantity: 2 },
          { productName: "Cart", quantity: 2 },
          { productName: "Lighter", quantity: 1 },
        ],
      },
      {
        orderId: "o2",
        completedAtIso: NOW,
        totalMinor: 100,
        lines: [{ productName: "Blue Dream", quantity: 1 }],
      },
    ];
    const h = buildMemberHistory(orders, NOW);
    expect(h.favorites).toHaveLength(FAVORITES_LIMIT);
    expect(h.favorites[0].productName).toBe("Blue Dream"); // 3 units, 2 orders
    expect(h.favorites[0].totalQuantity).toBe(3);
    expect(h.favorites[0].orderCount).toBe(2);
    expect(h.favorites[1].productName).toBe("Gummies"); // 3 units, 1 order — loses the tie on order count
    expect(h.favorites[2].productName).toBe("Cart");
  });

  it("never sees beyond the order window and sanitizes malformed rows", () => {
    const many: HistoryOrderInput[] = Array.from({ length: 8 }, (_, i) => ({
      orderId: `m${i}`,
      completedAtIso: NOW,
      totalMinor: 100,
      lines: [{ productName: i < HISTORY_ORDER_LIMIT ? "InWindow" : "OutOfWindow", quantity: 1 }],
    }));
    const capped = buildMemberHistory(many, NOW);
    expect(capped.purchases).toHaveLength(HISTORY_ORDER_LIMIT);
    expect(capped.favorites.every((f) => f.productName === "InWindow")).toBe(true);

    const bad = buildMemberHistory(
      [{ orderId: "x", completedAtIso: null, totalMinor: 45.5, lines: [{ productName: "ok", quantity: 0 }] }],
      NOW,
    );
    expect(bad.purchases[0].totalMinor).toBe(0);
    expect(bad.purchases[0].dateLabel).toBe("—");
    expect(bad.purchases[0].itemCount).toBe(0);
  });

  it("returns an empty history for a first-time member (not an error)", () => {
    const h = buildMemberHistory([], NOW);
    expect(h.purchases).toHaveLength(0);
    expect(h.favorites).toHaveLength(0);
  });

  it("embedded self-tests pass", () => {
    expect(() => __runMemberHistoryCoreTests()).not.toThrow();
  });
});
