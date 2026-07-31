/**
 * SLICE B (SHOP-2) — each Shop carousel slide can be LINKED to a one-off
 * promotion, given an owner-chosen FILTER NAME, and opted into showing its own
 * checkbox in the Shop sidebar. The link lives INSIDE the Slice A presentation
 * JSON blob (published + draft `presentation` columns), so there is NO new
 * migration — the whole look, sale link included, round-trips through
 * normalize/serialize.
 *
 * Michael: link a slide to a sale and give the sidebar filter a name; that
 * auto-populates a dynamic sale filter (the sidebar checkbox render itself is
 * Slice C, which consumes collectShopSaleFilters()).
 *
 * NEVER GUESS — pure-model pins so a future refactor can't silently regress the
 * sale-link contract that Slice C depends on:
 *   - default slide links NO sale (promotionId null, autoFilter off),
 *   - normalize coerces bad data safely (blank/whitespace id -> null; a filter
 *     with no linked promotion can't auto-filter; filter name trimmed + capped
 *     at 40 chars),
 *   - the sale link survives a serialize -> parse round-trip,
 *   - slugifyShopFilter produces DOM/URL-safe tokens and falls back on the
 *     promotion id when the name slugs to nothing,
 *   - slideFilterName's fallback chain (owner name -> promo title -> "Sale"),
 *   - collectShopSaleFilters is the BRIDGE Slice C reads: only auto+linked
 *     slides, deduped by promotion (first slide wins), unique ids even when two
 *     labels collide, capped at 10, in slide order.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SHOP_CAROUSEL_SLIDES,
  defaultShopSlidePromotion,
  normalizeShopSlidePromotion,
  slugifyShopFilter,
  slideLinkedPromotionId,
  slideFilterName,
  collectShopSaleFilters,
  defaultShopHeroPresentation,
  normalizeShopHeroPresentation,
  serializeShopHeroPresentation,
  parseShopHeroPresentation,
  type ShopHeroPresentation,
} from "@/lib/cms/shop-carousel-core";

/** Build a presentation that links a promotion (auto-filter on unless said). */
const withSale = (
  promotionId: string | null,
  filterName = "",
  autoFilter = true,
): ShopHeroPresentation =>
  normalizeShopHeroPresentation({
    ...defaultShopHeroPresentation(),
    promotion: { promotionId, filterName, autoFilter },
  });

describe("shop slide sale link: the pure presentation model", () => {
  it("default slide links NO sale", () => {
    const p = defaultShopSlidePromotion();
    expect(p.promotionId).toBeNull();
    expect(p.filterName).toBe("");
    expect(p.autoFilter).toBe(false);
    // ...and the slide default carries that empty link.
    expect(defaultShopHeroPresentation().promotion).toEqual(p);
  });

  it("normalize coerces bad/blank data to a safe empty link", () => {
    expect(normalizeShopSlidePromotion(null)).toEqual(defaultShopSlidePromotion());
    expect(normalizeShopSlidePromotion("nope")).toEqual(defaultShopSlidePromotion());
    // Whitespace-only id is treated as no link.
    expect(normalizeShopSlidePromotion({ promotionId: "   " }).promotionId).toBeNull();
  });

  it("a filter with no linked promotion can't auto-filter", () => {
    const p = normalizeShopSlidePromotion({ promotionId: null, autoFilter: true, filterName: "x" });
    expect(p.autoFilter).toBe(false);
  });

  it("filter name is trimmed and capped at 40 chars", () => {
    const p = normalizeShopSlidePromotion({
      promotionId: "  promo-1  ",
      filterName: "  " + "A".repeat(60) + "  ",
      autoFilter: true,
    });
    expect(p.promotionId).toBe("promo-1");
    expect(p.filterName).toBe("A".repeat(40));
    expect(p.autoFilter).toBe(true);
  });

  it("the sale link survives a serialize -> parse round-trip", () => {
    const custom = withSale("promo-42", "Weekend Wax", true);
    const round = parseShopHeroPresentation(serializeShopHeroPresentation(custom))!;
    expect(round.promotion.promotionId).toBe("promo-42");
    expect(round.promotion.filterName).toBe("Weekend Wax");
    expect(round.promotion.autoFilter).toBe(true);
    expect(slideLinkedPromotionId(round)).toBe("promo-42");
  });
});

describe("shop slide sale link: filter naming + slugs", () => {
  it("slugifyShopFilter yields a DOM/URL-safe token", () => {
    expect(slugifyShopFilter("Weekend Wax!", "promo-1")).toBe("weekend-wax");
    expect(slugifyShopFilter("50% Off — Flower", "promo-1")).toBe("50-off-flower");
  });

  it("slugify falls back to the promotion id when the name slugs to nothing", () => {
    expect(slugifyShopFilter("!!!", "promo-9")).toBe("sale-promo-9");
    expect(slugifyShopFilter("", "promo-9")).toBe("sale-promo-9");
  });

  it("slideFilterName fallback chain: owner name -> promo title -> Sale", () => {
    expect(slideFilterName(withSale("p1", "My Sale"), "Promo Title")).toBe("My Sale");
    expect(slideFilterName(withSale("p1", ""), "Promo Title")).toBe("Promo Title");
    expect(slideFilterName(withSale("p1", ""), "")).toBe("Sale");
    expect(slideFilterName(withSale("p1", ""), null)).toBe("Sale");
  });
});

describe("collectShopSaleFilters: the bridge Slice C consumes", () => {
  it("keeps only auto+linked slides, in slide order, deduped by promotion", () => {
    const slides = [
      { presentation: withSale("promo-a", "Alpha Sale", true) },
      { presentation: withSale("promo-a", "Alpha Dup", true) }, // dup promo -> dropped
      { presentation: withSale("promo-b", "Beta (no auto)", false) }, // autoFilter off -> dropped
      { presentation: withSale(null, "Ghost", true) }, // no link -> dropped
      { presentation: withSale("promo-c", "Charlie Sale", true) },
    ];
    const out = collectShopSaleFilters(slides);
    expect(out.map((f) => f.promotionId)).toEqual(["promo-a", "promo-c"]);
    // First slide wins for the deduped promotion.
    expect(out[0].name).toBe("Alpha Sale");
    expect(out[0].id).toBe("alpha-sale");
    expect(out[1].name).toBe("Charlie Sale");
  });

  it("uses the promotion-title map for slides that didn't name their filter", () => {
    const slides = [{ presentation: withSale("promo-x", "", true) }];
    const out = collectShopSaleFilters(slides, { "promo-x": "Doobie Tuesday" });
    expect(out[0].name).toBe("Doobie Tuesday");
    expect(out[0].id).toBe("doobie-tuesday");
  });

  it("guarantees unique ids even when two labels slug identically", () => {
    const slides = [
      { presentation: withSale("promo-1", "Big Sale", true) },
      { presentation: withSale("promo-2", "Big Sale", true) },
    ];
    const out = collectShopSaleFilters(slides);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((f) => f.id)).size).toBe(2);
    expect(out[0].id).toBe("big-sale");
    expect(out[1].id).not.toBe("big-sale");
  });

  it("caps the collected filters at MAX_SHOP_CAROUSEL_SLIDES (10)", () => {
    const slides = Array.from({ length: 14 }, (_, i) => ({
      presentation: withSale(`promo-${i}`, `Sale ${i}`, true),
    }));
    const out = collectShopSaleFilters(slides);
    expect(out).toHaveLength(MAX_SHOP_CAROUSEL_SLIDES);
    expect(out[0].promotionId).toBe("promo-0");
  });
});
