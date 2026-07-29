/**
 * SLICE 95 — "More from" (related products) selection: vitest mirror.
 *
 * Mirrors the embedded self-tests of src/lib/menu/related-products-core.ts
 * and pins the owner-reported bug fix so it can never regress:
 *   - a CERES topical must NEVER appear under "More from 2727" (vendor-pure);
 *   - blank brands must not group items across vendors;
 *   - honest category fallback (scope tells the heading the truth);
 *   - enticement ranking (purchasable → same category → price proximity);
 *   - deterministic output regardless of input order.
 */
import { describe, expect, it } from "vitest";

import {
  __runRelatedProductsCoreTests,
  matchesRelatedIdentity,
  relatedIdentityFor,
  selectRelatedItems,
  type RelatedCandidate,
} from "@/lib/menu/related-products-core";

const mk = (
  id: string,
  over: Partial<RelatedCandidate> = {},
): RelatedCandidate & { id: string } => ({
  id,
  name: `Item ${id}`,
  brand: "",
  vendor: "",
  category: "cartridge",
  priceMinorUnits: 1200,
  inventoryStatus: "in-stock",
  ...over,
});

describe("related-products-core embedded self-tests", () => {
  it("all pass", () => {
    expect(() => __runRelatedProductsCoreTests()).not.toThrow();
  });
});

describe("the owner's leak (verified live): CERES under 'More from 2727'", () => {
  it("a vendor rail contains ONLY that vendor's products", () => {
    const viewed = mk("gorilla", { vendor: "2727", category: "preroll" });
    const pool = [
      mk("ceres-topical", { vendor: "CERES", category: "topical" }),
      mk("2727-cart", { vendor: "2727", category: "cartridge" }),
      mk("2727-blunt", { vendor: "2727", category: "blunt" }),
      mk("other-blank", { vendor: "", category: "preroll" }),
    ];
    const sel = selectRelatedItems(viewed, pool);
    expect(sel.scope).toBe("vendor");
    expect(sel.items.map((i) => i.id).sort()).toEqual(["2727-blunt", "2727-cart"]);
  });

  it("blank brand never matches blank brand (the root cause)", () => {
    const identity = relatedIdentityFor({ brand: "", vendor: "2727" });
    expect(identity?.kind).toBe("vendor");
    expect(matchesRelatedIdentity({ brand: "", vendor: "CERES" }, identity)).toBe(false);
    expect(matchesRelatedIdentity({ brand: "", vendor: "" }, identity)).toBe(false);
    expect(matchesRelatedIdentity({ brand: "Sub", vendor: "2727" }, identity)).toBe(true);
  });
});

describe("honest fallback + heading scope", () => {
  it("zero siblings → category scope, in-category items only", () => {
    const viewed = mk("solo", { brand: "OnlyBrand", category: "topical" });
    const sel = selectRelatedItems(viewed, [
      mk("cat-mate", { brand: "Other", category: "topical" }),
      mk("off-cat", { brand: "Other", category: "flower" }),
    ]);
    expect(sel.scope).toBe("category");
    expect(sel.items.map((i) => i.id)).toEqual(["cat-mate"]);
  });

  it("one sibling → rail of exactly one; strangers never pad it", () => {
    const viewed = mk("a", { brand: "Solo" });
    const sel = selectRelatedItems(viewed, [
      mk("b", { brand: "Solo" }),
      mk("x", { brand: "X" }),
      mk("y", { brand: "Y" }),
    ]);
    expect(sel.scope).toBe("brand");
    expect(sel.items).toHaveLength(1);
  });
});

describe("enticement ranking", () => {
  it("purchasable > same category > price proximity; sold-out last", () => {
    const viewed = mk("v", { vendor: "V", category: "preroll", priceMinorUnits: 1000 });
    const sel = selectRelatedItems(viewed, [
      mk("sold-out", { vendor: "V", category: "preroll", priceMinorUnits: 1000, inventoryStatus: "unavailable" }),
      mk("far-price", { vendor: "V", category: "preroll", priceMinorUnits: 5000 }),
      mk("near-price", { vendor: "V", category: "preroll", priceMinorUnits: 1050 }),
      mk("off-cat", { vendor: "V", category: "flower", priceMinorUnits: 1000 }),
    ]);
    expect(sel.items.map((i) => i.id)).toEqual(["near-price", "far-price", "off-cat", "sold-out"]);
  });

  it("deterministic regardless of input order + limit + self-exclusion", () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      mk(`p${i}`, { vendor: "V", priceMinorUnits: 1000 + i * 10 }),
    );
    const viewed = mk("viewed", { vendor: "V", priceMinorUnits: 1000 });
    const a = selectRelatedItems(viewed, [...pool]);
    const b = selectRelatedItems(viewed, [...pool].reverse());
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    expect(a.items).toHaveLength(8);
    expect(a.items.some((i) => i.id === "viewed")).toBe(false);
  });
});
