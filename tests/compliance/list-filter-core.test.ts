/**
 * tests/compliance/list-filter-core.test.ts
 *
 * SLICE 26 — vitest mirror for the pure list filter/sort grammar. The
 * exhaustive cases live in the module's embedded self-tests (run by the
 * compliance pure runner); this mirror keeps the module under vitest too
 * and pins the URL-facing contract.
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SORTS,
  LOT_SORTS,
  ORDER_SORTS,
  __runListFilterTests,
  endOfDayIso,
  parseIsoDate,
  parseYesNo,
  resolveSort,
} from "@/lib/admin/list-filter-core";

describe("list-filter-core", () => {
  it("runs the embedded self-test battery", () => {
    expect(() => __runListFilterTests()).not.toThrow();
  });

  it("falls back to each menu's default on unknown sort keys", () => {
    expect(resolveSort("nope", ORDER_SORTS).key).toBe("newest");
    expect(resolveSort(undefined, LOT_SORTS).key).toBe("newest");
    expect(resolveSort("__proto__", CUSTOMER_SORTS).key).toBe("recent");
  });

  it("keeps sort keys stable (URL contract — never rename)", () => {
    expect(ORDER_SORTS.map((o) => o.key)).toEqual([
      "newest",
      "oldest",
      "total_high",
      "total_low",
      "name",
    ]);
    expect(LOT_SORTS.map((o) => o.key)).toEqual([
      "newest",
      "oldest",
      "expiry",
      "qty_high",
      "qty_low",
      "name",
    ]);
    expect(CUSTOMER_SORTS.map((o) => o.key)).toEqual([
      "recent",
      "newest",
      "name",
      "spend_high",
      "visits_high",
    ]);
  });

  it("rejects impossible calendar dates and accepts real ones", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDate("2026-02-29")).toBeUndefined();
    expect(parseIsoDate("2026-06-31")).toBeUndefined();
    expect(parseIsoDate("' OR 1=1 --")).toBeUndefined();
  });

  it("parses tri-state yes/no flags", () => {
    expect(parseYesNo("yes")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("YES")).toBeUndefined();
  });

  it("builds an inclusive end-of-day upper bound", () => {
    expect(endOfDayIso("2026-01-31")).toBe("2026-01-31T23:59:59.999Z");
  });
});
