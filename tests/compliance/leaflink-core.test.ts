/**
 * tests/compliance/leaflink-core.test.ts
 *
 * SLICE 84 — vitest mirror for the pure LeafLink cores. The embedded
 * self-tests run first (the same code the pure runner executes), then focused
 * specs pin the behaviors that must never drift:
 *
 *   • leaflink-menu-core: HTML descriptions become plain text, "%"-only
 *     potency parsing (mg specs must NEVER be coerced to a percentage),
 *     money in integer cents from all three probed wholesale_price shapes.
 *   • leaflink-media-core: tags start "leaflink", titles end "(LeafLink)",
 *     the PO banner names the platform.
 *   • leaflink-kb-link-core: the durable KB identity uses the SAME canonical
 *     slug rule as the crawler and the GrowFlow path (imported, not copied).
 *
 * The planning machinery (planMediaSaves etc.) is covered by the
 * cultivera-media-core suite — it's structural and shared, not duplicated.
 */
import { describe, expect, it } from "vitest";

import {
  htmlToPlainText,
  pctFromSpecValue,
  normalizeMenuItem,
  __runLeaflinkMenuCoreTests,
} from "@/lib/purchasing/leaflink-menu-core";
import {
  leaflinkMediaTags,
  leaflinkMediaTitleForItem,
  leaflinkMenuPrefillBanner,
  __runLeaflinkMediaCoreTests,
} from "@/lib/purchasing/leaflink-media-core";
import {
  leaflinkKbIdentityForItem,
  __runLeaflinkKbLinkCoreTests,
} from "@/lib/purchasing/leaflink-kb-link-core";
import { kbIdentityForItem } from "@/lib/purchasing/growflow-kb-link-core";

describe("leaflink-menu-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runLeaflinkMenuCoreTests()).not.toThrow();
  });

  it("strips HTML from descriptions and keeps paragraph breaks", () => {
    expect(htmlToPlainText("<p>First.</p><p>Second &amp; third.</p>")).toBe(
      "First.\n\nSecond & third.",
    );
  });

  it("only reads potency percentages from values that carry a % sign", () => {
    expect(pctFromSpecValue("21.5%")).toBe(21.5);
    // Pinned live shape: edible THC arrives as "100 mg" — NOT a percentage.
    expect(pctFromSpecValue("100 mg")).toBeNull();
    expect(pctFromSpecValue(null)).toBeNull();
  });

  it("normalizes money to integer cents from every probed shape", () => {
    const shapes: Array<unknown> = [
      { amount: "112.50", currency: "USD" }, // object with string amount
      60, // bare number (dollars)
      "60.00", // bare string
    ];
    const expected = [11250, 6000, 6000];
    shapes.forEach((wholesale_price, i) => {
      const item = normalizeMenuItem({ id: 1, display_name: "X", wholesale_price }, 0);
      expect(item.wholesalePriceMinor).toBe(expected[i]);
    });
  });
});

describe("leaflink-media-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runLeaflinkMediaCoreTests()).not.toThrow();
  });

  it("brands image saves leaflink + product-image + vendor kebab", () => {
    expect(leaflinkMediaTags("Fairwinds Manufacturing", "image")).toEqual([
      "leaflink",
      "product-image",
      "fairwinds-manufacturing",
    ]);
  });

  it("titles carry the platform suffix", () => {
    expect(leaflinkMediaTitleForItem({ name: "Deep Sleep", brand: "Fairwinds" }, "image")).toBe(
      "Deep Sleep — Fairwinds (LeafLink)",
    );
    expect(leaflinkMediaTitleForItem({ name: "Deep Sleep", brand: "Fairwinds" }, "coa")).toBe(
      "Deep Sleep COA (LeafLink)",
    );
  });

  it("PO banner names the platform", () => {
    expect(leaflinkMenuPrefillBanner(2, "Wyld")).toContain("Started from a LeafLink menu: 2 items from Wyld");
  });
});

describe("leaflink-kb-link-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runLeaflinkKbLinkCoreTests()).not.toThrow();
  });

  it("produces byte-identical identities to the GrowFlow path for the same item", () => {
    const item = { name: "Blue Dream", brand: "Avitas", size_label: "1 g" };
    const ll = leaflinkKbIdentityForItem(item);
    const gf = kbIdentityForItem(item);
    expect(ll.posProductKey).toBe(gf.posProductKey);
    expect(ll.brandSlug).toBe(gf.brandSlug);
    expect(ll.productSlug).toBe(gf.productSlug);
    expect(ll.variantLabel).toBe(gf.variantLabel);
  });

  it("uses the LeafLink-flavoured fallback display name", () => {
    expect(leaflinkKbIdentityForItem({ name: null, brand: null, size_label: null }).displayName).toBe(
      "LeafLink product",
    );
  });
});
