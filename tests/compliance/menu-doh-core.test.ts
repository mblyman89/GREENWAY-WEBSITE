/**
 * SLICE D (SHOP-4) — the DOH-compliant flag is threaded onto the public menu
 * item.
 *
 * Michael: "the doh compliant flag onto the public menu." A product is
 * DOH-compliant when the store has VERIFIED it and recorded it in the durable
 * medical_product_registry (migration 0113), keyed by the STABLE POS product
 * key (= the public item's id). That is the SAME registry the medical checkout
 * uses to zero the sales/excise tax, so the public flag and the register agree
 * by construction — single source of truth, never a second list.
 *
 * NEVER GUESS — these pins lock the overlay contract so Slices E (filter) + F
 * (badge) can trust it:
 *   - an EMPTY registry (the pre-migration / unconfigured case the server
 *     overlay hands us) marks EVERY item not-compliant (the honest default —
 *     no badge until a product is actually verified),
 *   - a registry hit threads BOTH the boolean AND the WAC 246-70 category
 *     (general_use / high_thc / high_cbd); a miss / blank id stays clean,
 *   - attach is NON-MUTATING (new objects; source untouched) so re-enrichment
 *     can't corrupt cached items,
 *   - the category labels/help are the reused, statute-grounded strings.
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import {
  attachDohCompliance,
  dohCategoryHelp,
  dohCategoryLabel,
  dohInfoForItem,
  emptyDohInfo,
  isItemDohCompliant,
  type DohRegistryMap,
} from "@/lib/menu/menu-doh-core";

const item = (over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem =>
  ({
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  }) as GreenwayMenuItem;

const registry: DohRegistryMap = new Map<string, DohCategory>([
  ["p-general", "general_use"],
  ["p-cbd", "high_cbd"],
  ["p-thc", "high_thc"],
]);

describe("menu DOH: dohInfoForItem reads the registry by id", () => {
  it("a registry hit is compliant and carries its category", () => {
    expect(dohInfoForItem({ id: "p-general" }, registry)).toEqual({ compliant: true, category: "general_use" });
    expect(dohInfoForItem({ id: "p-cbd" }, registry).category).toBe("high_cbd");
  });

  it("a miss or blank id is not compliant", () => {
    expect(dohInfoForItem({ id: "nope" }, registry)).toEqual(emptyDohInfo());
    expect(dohInfoForItem({ id: "   " }, registry).compliant).toBe(false);
  });
});

describe("menu DOH: attachDohCompliance overlays the flag", () => {
  const items = [item({ id: "p-general" }), item({ id: "p-thc" }), item({ id: "plain" })];

  it("an EMPTY registry marks every item not-compliant (honest pre-migration default)", () => {
    const out = attachDohCompliance(items, new Map());
    expect(out.every((i) => i.dohCompliant === false && i.dohCategory === null)).toBe(true);
  });

  it("a real registry threads the boolean AND the category", () => {
    const out = attachDohCompliance(items, registry);
    expect(out[0].dohCompliant).toBe(true);
    expect(out[0].dohCategory).toBe("general_use");
    expect(out[1].dohCategory).toBe("high_thc");
    // Unverified item stays clean.
    expect(out[2].dohCompliant).toBe(false);
    expect(out[2].dohCategory).toBeNull();
  });

  it("is non-mutating — new objects, source untouched", () => {
    const out = attachDohCompliance(items, registry);
    expect(out[0]).not.toBe(items[0]);
    expect((items[0] as { dohCompliant?: boolean }).dohCompliant).toBeUndefined();
  });
});

describe("menu DOH: category labels + help (reused by Slices E/F)", () => {
  it("labels map the three WAC 246-70 lanes", () => {
    expect(dohCategoryLabel("general_use")).toBe("General Use");
    expect(dohCategoryLabel("high_thc")).toBe("High THC");
    expect(dohCategoryLabel("high_cbd")).toBe("High CBD");
  });

  it("labels/help are null-safe and reject bad categories", () => {
    expect(dohCategoryLabel(null)).toBeNull();
    expect(dohCategoryLabel("bogus" as DohCategory)).toBeNull();
    expect(dohCategoryHelp(null)).toBeNull();
    expect((dohCategoryHelp("high_cbd") ?? "").length).toBeGreaterThan(0);
  });
});

describe("menu DOH: isItemDohCompliant", () => {
  it("trusts the threaded boolean, stays defensive on category", () => {
    expect(isItemDohCompliant({ dohCompliant: true, dohCategory: null })).toBe(true);
    expect(isItemDohCompliant({ dohCompliant: false, dohCategory: "high_cbd" })).toBe(true);
    expect(isItemDohCompliant({ dohCompliant: false, dohCategory: null })).toBe(false);
    expect(isItemDohCompliant({})).toBe(false);
  });
});
