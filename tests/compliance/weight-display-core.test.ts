/**
 * SLICE 98 — topicals/edibles/liquids display OUNCES, not grams.
 *
 * Owner's verbatim ask: "the topicals, edibles, liquids, are listed/shown
 * using grams as its weight rather than in ounces like I'd prefer it be."
 *
 * Verified live before building: a topical card rendered "$26.00/96.4 g"
 * (the raw POS variant label). The conversion is DISPLAY-ONLY — the stored
 * label still keys cart lines, ounce-tier deal math and WAC 314-55-095
 * limit parsing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OUNCE_DISPLAY_CATEGORIES,
  displayVariantLabel,
  __runWeightDisplayCoreTests,
} from "@/lib/menu/weight-display-core";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");

describe("weight-display-core (SLICE 98)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runWeightDisplayCoreTests()).not.toThrow();
  });

  it("owner's live case: topical 96.4 g shows 3.4 oz — matching the WAC net-weight line", () => {
    // deriveNetWeightLine already renders "3.4 oz (96.4 g)" for this product;
    // the price unit now agrees with it.
    expect(displayVariantLabel("96.4 g", "topical")).toBe("3.4 oz");
    expect(displayVariantLabel("355ml", "edible-liquid")).toBe("12 fl oz");
  });

  it("flower and every non-listed category stays in grams (license-honest units)", () => {
    for (const cat of ["flower", "popcorn-bud", "preroll", "blunt", "concentrate", "cartridge", "rso", "infused-flower"]) {
      expect(displayVariantLabel("3.5g", cat)).toBe("3.5g");
      expect(OUNCE_DISPLAY_CATEGORIES.has(cat)).toBe(false);
    }
  });

  it("only Michael's categories convert: topical, edible-solid, edible-liquid, tincture", () => {
    expect([...OUNCE_DISPLAY_CATEGORIES].sort()).toEqual(["edible-liquid", "edible-solid", "tincture", "topical"]);
  });

  it("non-weight labels never convert (potency mg, packs, each, blank)", () => {
    expect(displayVariantLabel("100mg", "edible-solid")).toBe("100mg");
    expect(displayVariantLabel("10pk", "edible-solid")).toBe("10pk");
    expect(displayVariantLabel("each", "topical")).toBe("each");
    expect(displayVariantLabel("", "topical")).toBe("");
  });

  it("wiring: the card price selector converts the unit label per category", () => {
    const src = read("src/components/menu/ProductCardPriceSelector.tsx");
    expect(src).toContain('import { displayVariantLabel } from "@/lib/menu/weight-display-core";');
    expect(src).toContain("const shownLabel = displayVariantLabel(variant.label, category);");
    expect(src).toContain("unitLabel: shownLabel ? `/${shownLabel}` : \"\",");
    // Both PriceLine render sites pass the item's category.
    expect(src.split("category={item.category}").length - 1).toBe(2);
  });

  it("wiring: detail panel, cart drawer, checkout summary and confirmation all convert", () => {
    const panel = read("src/components/menu/ProductDetailPurchasePanel.tsx");
    expect(panel).toContain("{displayVariantLabel(variant.label, item.category)} — {formatMinorCurrency(variant.priceMinorUnits)}");

    const cart = read("src/components/cart/CartProvider.tsx");
    expect(cart).toContain('{displayVariantLabel(item.variantLabel, item.category) || "each"}');

    const checkout = read("src/components/checkout/CheckoutFlow.tsx");
    expect(checkout).toContain("${displayVariantLabel(item.variantLabel, item.category)}");
    // The completed-order snapshot now carries the category for the receipt.
    expect(checkout).toContain("category: item.category,");

    const confirmation = read("src/components/checkout/OrderConfirmation.tsx");
    expect(confirmation).toContain("displayVariantLabel(line.variantLabel, line.category ?? null)");

    const api = read("src/app/api/orders/[token]/route.ts");
    expect(api).toContain("category: l.category ?? null,");
  });

  it("display-only: the stored label still keys the cart, deals and limit math", () => {
    // addItem still receives the RAW variant label (identity + engine input).
    const panel = read("src/components/menu/ProductDetailPurchasePanel.tsx");
    expect(panel).toContain("variantLabel: selectedVariant.label,");
    // Checkout still submits the RAW label to the server.
    const checkout = read("src/components/checkout/CheckoutFlow.tsx");
    expect(checkout).toContain("variantLabel: item.variantLabel,");
    // The deal/limit parsers are untouched by this slice.
    expect(read("src/lib/specials/cart-discount.ts")).toContain("Convert a variant label to grams.");
    expect(read("src/lib/pos/variant-grams-core.ts")).toContain("export function gramsFromVariantLabel");
  });
});
