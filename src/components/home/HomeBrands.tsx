"use client";

import { useMemo } from "react";
import Link from "next/link";
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
 * PR 3: the cards are now WIRED \u2014 each links to the vendor-filtered menu
 * (/menu?vendors=<vendor name>), which the additive by-vendor menu filter reads.
 * The link wraps the shared presentational VendorGlowCard so that component stays
 * dumb (the Vendors page can adopt it later with its own wrapper).
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
    <section id="shop-by-brand" className="px-4 py-6 md:px-8 md:py-8" aria-label="Shop by brand">
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
            // PR 3: wire each card to the vendor-filtered menu. vendor.name is the
            // clean display vendor the menu filter matches on (item.vendor).
            <Link
              key={vendor.slug}
              href={`/menu?vendors=${encodeURIComponent(vendor.name)}`}
              aria-label={`Shop ${vendor.name} products`}
              className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--greenway)]/60"
            >
              <VendorGlowCard vendor={vendor} index={index} />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
