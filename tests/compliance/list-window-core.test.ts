/**
 * tests/compliance/list-window-core.test.ts  (GW-033)
 *
 * Vitest mirror of the embedded self-tests plus targeted checks on the
 * pagination-window math every admin list page uses for "Showing X–Y of Z".
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  listWindow,
  parsePageParam,
  showingLabel,
  __runListWindowTests,
} from "@/lib/admin/list-window-core";

describe("list-window-core (GW-033)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runListWindowTests()).not.toThrow();
  });

  it("range() indexes are inclusive and 0-based, exactly what PostgREST expects", () => {
    const w = listWindow(431, 2, 100);
    expect(w.from).toBe(100);
    expect(w.to).toBe(199);
    // page size = to - from + 1
    expect(w.to - w.from + 1).toBe(100);
  });

  it("no page ever renders empty while rows exist (clamping)", () => {
    for (const raw of [0, -1, 6, 99, Number.NaN]) {
      const w = listWindow(431, raw, 100);
      expect(w.page).toBeGreaterThanOrEqual(1);
      expect(w.page).toBeLessThanOrEqual(w.totalPages);
      expect(w.showingFrom).toBeGreaterThanOrEqual(1);
      expect(w.showingTo).toBeLessThanOrEqual(431);
    }
  });

  it("the human label matches the window", () => {
    expect(showingLabel(listWindow(431, 5, 100), 431, "order")).toBe(
      "Showing 401\u2013431 of 431 orders",
    );
    expect(showingLabel(listWindow(60, 1, 100), 60, "lot")).toBe("Showing all 60 lots");
    expect(showingLabel(listWindow(0, 1, 100), 0, "customer")).toBe("No customers found");
  });

  it("query-param parsing never explodes", () => {
    expect(parsePageParam("7")).toBe(7);
    expect(parsePageParam("")).toBe(1);
    // parseInt stops at the "e" — scientific notation reads as page 1, fine.
    expect(parsePageParam("1e9")).toBe(1);
    expect(parsePageParam("-0")).toBe(1);
  });

  it("default page size is 100", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(100);
    expect(listWindow(250, 1).totalPages).toBe(3);
  });
});
