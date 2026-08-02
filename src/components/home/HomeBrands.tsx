"use client";

import { useMemo } from "react";
import { SectionBanner } from "@/components/home/SectionBanner";
import { VendorGlowCard } from "@/components/vendors/VendorGlowCard";
import type { PromoBannerContent } from "@/components/home/PromoGrid";
import type { VendorDirectoryEntry } from "@/lib/menu/vendor-directory-core";
import { useShuffleOrder } from "@/lib/home/useShuffleOrder";
import { HOME_CARD_COUNT_DEFAULT } from "@/lib/cms/home-section-settings-core";

/**
 * Home "Shop by Brand" section.
 *
 * PR 2 (owner Option B): this section now shows VENDOR cards that look exactly
 * like the public Vendors page — a dark glow tile with the vendor name on top,
 * the logo in the middle, and the product count at the bottom (shared
 * VendorGlowCard). This replaces the old free-text `brand`-grouped gradient
 * tiles, which is why the homepage previously showed only one card when the
 * menu actually carried several vendors: the old grid grouped by the free-text
 * `brand` field, while the Vendors page (and now this) group by `vendor`.
 *
 * The cards are intentionally UNWIRED for now (static tiles, no menu link). A
 * later slice will switch the customer menu filter from brand to vendor and
 * then point each card at the vendor-filtered menu.
 *
 * Like the old section, it rotates through the vendors (feature-shuffle style)
 * and honours the owner-controlled card count (home.brand → settings.cardCount).
 */
export function HomeBrands({
  vendors,
  content,
  count = HOME_CARD_COUNT_DEFAULT,
}: {
  /** Vendor directory entries derived live from the published menu + profiles. */
  vendors: VendorDirectoryEntry[];
  content?: PromoBannerContent;
  /**
   * How many vendor cards to show. Owner-controlled via the Home page editor's
   * "Shop by Brand" section ("Grid — cards shown", home.brand → settings.cardCount).
   * Defaults to 16 (the count the homepage shipped with).
   */
  count?: number;
}) {
  const LIMIT = count;
  const shuffle = useShuffleOrder(
    "home-brands",
    vendors.map((v) => v.slug),
  );

  const shown = useMemo(() => {
    const ordered = [...vendors].sort(
      (a, b) => (shuffle[a.slug] ?? 0) - (shuffle[b.slug] ?? 0),
    );
    return ordered.slice(0, LIMIT);
  }, [vendors, shuffle, LIMIT]);

  return (
    <section id="shop-by-brand" className="bg-black px-4 py-6 md:px-8 md:py-8" aria-label="Shop by brand">
      <div className="mx-auto max-w-[88rem] space-y-4 md:space-y-6">
        <SectionBanner
          imageSrc={content?.brandImage || "/home/brand-banner.webp"}
          imageAlt="Greenway featured cannabis brands"
          eyebrow={content?.brandEyebrow || "Featured Brands"}
          title={content?.brandTitle || "Shop by Brand"}
          subtitle={
            content?.brandSubtitle ||
            "A fresh lineup of our favorite brands every visit — tap any to shop their full menu."
          }
          editable={content?.editable}
          blockKeyPrefix="home.brand"
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((vendor, index) => (
            <VendorGlowCard key={vendor.slug} vendor={vendor} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
