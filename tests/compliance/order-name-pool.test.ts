/**
 * tests/compliance/order-name-pool.test.ts
 *
 * SLICE 113 — the order-NAME pool (recycling personality names for online
 * orders) + its non-blocking I-502 compliance nudge.
 *
 * NEVER GUESS contracts under test:
 *  - Duplicate detection is case- AND space-insensitive after normalization,
 *    and never blocks an edit from keeping its OWN name (ignoreId).
 *  - Validation blocks only on blank / over-length / duplicate; compliance tone
 *    is a SEPARATE non-blocking concern and must never gate a save.
 *  - The recycle order is Least-Recently-Used first (never-used names lead),
 *    tie-broken by sort_order then id — a total, STABLE order so the picker and
 *    the "next few" preview can never disagree.
 *  - Disabled names never appear in the rotation or preview.
 *  - resolveOrderDisplay is the ONE rule: a non-blank display name wins,
 *    otherwise the unique GWY order number (the search backstop).
 *  - The compliance review is whole-word (never substring: "class" ≠ "ass"),
 *    splits leet digit-runs ("Nugs4Thugs" → "nugs 4 thugs"), and is advisory.
 */
import { describe, expect, it } from "vitest";

import {
  ORDER_NAME_MAX_LEN,
  normalizeOrderName,
  orderNameDedupeKey,
  isDuplicateOrderName,
  validateOrderName,
  recycleOrder,
  pickNextOrderName,
  previewNextOrderNames,
  resolveOrderDisplay,
  type OrderNamePoolRow,
} from "@/lib/orders/order-name-pool-core";
import { reviewOrderName } from "@/lib/orders/order-name-compliance-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(
  id: string,
  name: string,
  opts: Partial<Omit<OrderNamePoolRow, "id" | "name">> = {},
): OrderNamePoolRow {
  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    sort_order: opts.sort_order ?? 0,
    last_assigned_at: opts.last_assigned_at ?? null,
    assigned_count: opts.assigned_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Normalization + dedupe key
// ---------------------------------------------------------------------------

describe("normalizeOrderName", () => {
  it("collapses runs of whitespace and trims, but preserves case", () => {
    expect(normalizeOrderName("  High   Life  ")).toBe("High Life");
    expect(normalizeOrderName("High Life")).toBe("High Life");
  });

  it("returns empty string for blank / whitespace-only input", () => {
    expect(normalizeOrderName("   ")).toBe("");
    expect(normalizeOrderName("")).toBe("");
    // @ts-expect-error — defends against runtime null despite the string type
    expect(normalizeOrderName(null)).toBe("");
  });
});

describe("orderNameDedupeKey", () => {
  it("is case- and space-insensitive", () => {
    expect(orderNameDedupeKey("High Life")).toBe(orderNameDedupeKey("high life"));
    expect(orderNameDedupeKey("  HIGH   life ")).toBe(orderNameDedupeKey("high life"));
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

describe("isDuplicateOrderName", () => {
  const pool = [row("a", "High Life"), row("b", "Nugs4Thugs")];

  it("catches case/space variants of an existing name", () => {
    expect(isDuplicateOrderName(pool, "high life")).toBe(true);
    expect(isDuplicateOrderName(pool, "  HIGH   LIFE ")).toBe(true);
  });

  it("does not flag a genuinely new name", () => {
    expect(isDuplicateOrderName(pool, "Green Dream")).toBe(false);
  });

  it("blank candidate is never a duplicate", () => {
    expect(isDuplicateOrderName(pool, "   ")).toBe(false);
  });

  it("ignoreId lets an edit keep its own name", () => {
    // Editing row "a" back to the same (normalized) value is allowed.
    expect(isDuplicateOrderName(pool, "high life", "a")).toBe(false);
    // But it must still collide with a DIFFERENT row.
    expect(isDuplicateOrderName(pool, "high life", "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation (blocking) — length / blank / duplicate only
// ---------------------------------------------------------------------------

describe("validateOrderName", () => {
  const pool = [row("a", "High Life")];

  it("rejects blank input", () => {
    const res = validateOrderName(pool, "   ");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/enter a name/i);
  });

  it("accepts a fresh name and returns the NORMALIZED value to persist", () => {
    const res = validateOrderName(pool, "  Green   Dream ");
    expect(res.ok).toBe(true);
    expect(res.value).toBe("Green Dream");
  });

  it("rejects an over-length name", () => {
    const long = "x".repeat(ORDER_NAME_MAX_LEN + 1);
    const res = validateOrderName(pool, long);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(new RegExp(String(ORDER_NAME_MAX_LEN)));
  });

  it("accepts exactly the max length", () => {
    const exact = "y".repeat(ORDER_NAME_MAX_LEN);
    expect(validateOrderName(pool, exact).ok).toBe(true);
  });

  it("rejects a duplicate (case-insensitive) but allows self-edit via ignoreId", () => {
    expect(validateOrderName(pool, "high life").ok).toBe(false);
    expect(validateOrderName(pool, "high life", "a").ok).toBe(true);
  });

  it("does NOT block on compliance tone (that is a separate nudge)", () => {
    // "Nugs4Thugs" trips the tone nudge but is still a VALID pool entry.
    const res = validateOrderName(pool, "Nugs4Thugs");
    expect(res.ok).toBe(true);
    expect(reviewOrderName("Nugs4Thugs").level).toBe("caution");
  });
});

// ---------------------------------------------------------------------------
// Recycle order (LRU) + picker + preview
// ---------------------------------------------------------------------------

describe("recycleOrder", () => {
  it("puts never-used names first, then by oldest last_assigned_at", () => {
    const pool = [
      row("a", "Recent", { last_assigned_at: "2024-01-03T00:00:00Z" }),
      row("b", "NeverUsed", { last_assigned_at: null }),
      row("c", "Older", { last_assigned_at: "2024-01-01T00:00:00Z" }),
    ];
    expect(recycleOrder(pool).map((r) => r.name)).toEqual([
      "NeverUsed",
      "Older",
      "Recent",
    ]);
  });

  it("drops disabled names entirely", () => {
    const pool = [
      row("a", "On"),
      row("b", "Off", { enabled: false }),
    ];
    expect(recycleOrder(pool).map((r) => r.name)).toEqual(["On"]);
  });

  it("breaks ties by sort_order, then id — a total, stable order", () => {
    const pool = [
      row("z", "Zed", { sort_order: 1 }),
      row("a", "Ann", { sort_order: 1 }),
      row("m", "Mid", { sort_order: 0 }),
    ];
    // sort_order 0 first, then within sort_order 1 the lower id ("a" < "z").
    expect(recycleOrder(pool).map((r) => r.name)).toEqual(["Mid", "Ann", "Zed"]);
  });

  it("is stable across repeated calls (no random shuffle)", () => {
    const pool = [row("a", "One"), row("b", "Two"), row("c", "Three")];
    const first = recycleOrder(pool).map((r) => r.id);
    const second = recycleOrder(pool).map((r) => r.id);
    expect(first).toEqual(second);
  });
});

describe("pickNextOrderName", () => {
  it("returns the LRU head", () => {
    const pool = [
      row("a", "Recent", { last_assigned_at: "2024-02-01T00:00:00Z" }),
      row("b", "NeverUsed"),
    ];
    expect(pickNextOrderName(pool)?.name).toBe("NeverUsed");
  });

  it("returns null when there are no enabled names", () => {
    expect(pickNextOrderName([])).toBeNull();
    expect(pickNextOrderName([row("a", "Off", { enabled: false })])).toBeNull();
  });
});

describe("previewNextOrderNames", () => {
  it("cycles the LRU order deterministically", () => {
    const pool = [
      row("a", "Alpha", { sort_order: 0 }),
      row("b", "Bravo", { sort_order: 1 }),
    ];
    expect(previewNextOrderNames(pool, 5)).toEqual([
      "Alpha",
      "Bravo",
      "Alpha",
      "Bravo",
      "Alpha",
    ]);
  });

  it("returns [] for an empty pool or non-positive count", () => {
    expect(previewNextOrderNames([], 3)).toEqual([]);
    expect(previewNextOrderNames([row("a", "Alpha")], 0)).toEqual([]);
    expect(previewNextOrderNames([row("a", "Alpha")], -2)).toEqual([]);
  });

  it("agrees with pickNextOrderName on the very next name", () => {
    const pool = [
      row("a", "Recent", { last_assigned_at: "2024-03-01T00:00:00Z" }),
      row("b", "NeverUsed"),
    ];
    expect(previewNextOrderNames(pool, 1)[0]).toBe(pickNextOrderName(pool)?.name);
  });
});

// ---------------------------------------------------------------------------
// resolveOrderDisplay — the ONE customer-facing rule
// ---------------------------------------------------------------------------

describe("resolveOrderDisplay", () => {
  it("prefers a non-blank display name", () => {
    expect(resolveOrderDisplay("High Life", "GWY-000123")).toBe("High Life");
  });

  it("falls back to the GWY number when the display name is null/blank", () => {
    expect(resolveOrderDisplay(null, "GWY-000123")).toBe("GWY-000123");
    expect(resolveOrderDisplay(undefined, "GWY-000123")).toBe("GWY-000123");
    expect(resolveOrderDisplay("   ", "GWY-000123")).toBe("GWY-000123");
    expect(resolveOrderDisplay("", "GWY-000123")).toBe("GWY-000123");
  });
});

// ---------------------------------------------------------------------------
// Compliance nudge — advisory, whole-word, leet-aware
// ---------------------------------------------------------------------------

describe("reviewOrderName", () => {
  it("is ok for a clean, professional name", () => {
    const r = reviewOrderName("Green Dream");
    expect(r.level).toBe("ok");
    expect(r.reasons).toHaveLength(0);
    expect(r.matches).toHaveLength(0);
  });

  it("flags appeal-to-minors cues (WAC 314-55-155)", () => {
    const r = reviewOrderName("Candy Land Gummies");
    expect(r.level).toBe("caution");
    expect(r.matches).toContain("candy");
    expect(r.matches).toContain("gummies");
    expect(r.reasons.join(" ")).toMatch(/minors/i);
  });

  it("flags mild profanity for a public receipt", () => {
    const r = reviewOrderName("Bad Ass Buds");
    expect(r.level).toBe("caution");
    expect(r.matches).toContain("ass");
  });

  it("does NOT false-positive on substrings (class ≠ ass)", () => {
    expect(reviewOrderName("Classic Kush").level).toBe("ok");
    expect(reviewOrderName("Assortment Special").level).toBe("ok");
  });

  it("splits leet digit-runs so 'Nugs4Thugs' trips a tone caution", () => {
    const r = reviewOrderName("Nugs4Thugs");
    expect(r.level).toBe("caution");
    expect(r.matches).toContain("thugs");
  });

  it("never throws on odd input and de-dupes its matches", () => {
    // @ts-expect-error — runtime resilience against null
    expect(() => reviewOrderName(null)).not.toThrow();
    const r = reviewOrderName("ass ass ass");
    expect(r.matches.filter((m) => m === "ass")).toHaveLength(1);
  });
});
