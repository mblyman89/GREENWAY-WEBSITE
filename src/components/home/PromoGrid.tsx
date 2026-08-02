import Image from "next/image";
import Link from "next/link";
import { HomeBrands } from "@/components/home/HomeBrands";
import { SectionBanner } from "@/components/home/SectionBanner";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { BrandFactsOverlay } from "@/lib/home/brand-facts";
import { categoryLanes } from "@/lib/specials/daily-deal-presentation";
import { glowCardStyle, glowToneByIndex } from "@/lib/ui/glow-card-core";
import type { HomeTypeLaneKey } from "@/lib/cms/home-section-settings-core";

/**
 * Home "Shop by Category" + "Shop by Brand" sections.
 *
 * Category: a wide/short SectionBanner header followed by the six fixed
 * customer-facing lanes (Flower, Prerolls, Concentrates, Edibles, Liquids,
 * Topicals). Each tile links to the pre-filtered menu via the lane's
 * /menu?categories=a,b,c href.
 *
 * Brand: delegated to the client HomeBrands component, which rotates through
 * brands (feature-shuffle style) into a 4x4 grid.
 */
export type PromoBannerContent = {
  categoryImage?: string;
  categoryEyebrow?: string;
  categoryTitle?: string;
  categorySubtitle?: string;
  brandImage?: string;
  brandEyebrow?: string;
  brandTitle?: string;
  brandSubtitle?: string;
  editable?: boolean;
};

export function PromoGrid({
  content,
  items = [],
  brandFacts,
  brandCount,
  laneImages,
}: {
  content?: PromoBannerContent;
  /** Live menu items (from the published DB version) for the brand grid. */
  items?: GreenwayMenuItem[];
  /** 7d: master-data brand overlay (normalized name -> canonical name + known_for). */
  brandFacts?: Record<string, BrandFactsOverlay>;
  /** SLICE 112: owner-controlled brand-grid card count (home.brand settings.cardCount). */
  brandCount?: number;
  /**
   * Owner-uploaded product photo per category lane (home.category
   * settings.laneImages). An unset lane resolves to "" so the tile renders its
   * clean text-only fallback, byte-identical to the card the site shipped with.
   */
  laneImages?: Partial<Record<HomeTypeLaneKey, string>>;
} = {}) {
  return (
    <>
      <section
        id="shop-by-category"
        className="bg-black px-4 py-6 md:px-8 md:py-8"
        aria-label="Shop by category"
      >
        <div className="mx-auto max-w-[88rem] space-y-4 md:space-y-6">
          <SectionBanner
            imageSrc={content?.categoryImage || "/home/category-banner.webp"}
            imageAlt="Greenway cannabis product categories"
            eyebrow={content?.categoryEyebrow || "Browse the Menu"}
            title={content?.categoryTitle || "Shop by Category"}
            subtitle={
              content?.categorySubtitle ||
              "Jump straight into the products you want — every tile opens a pre-filtered menu."
            }
            editable={content?.editable}
            blockKeyPrefix="home.category"
          />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
            {categoryLanes.map((lane, index) => {
              const tone = glowToneByIndex(index);
              // Owner-uploaded product photo for this lane, or "" -> clean
              // text-only fallback (byte-identical to the card the site shipped).
              const image = laneImages?.[lane.key as HomeTypeLaneKey] || "";
              return (
                <Link
                  key={lane.key}
                  href={lane.href}
                  className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl border shadow-lg shadow-black/30 transition duration-300 hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)] lg:aspect-[3/4]"
                  style={glowCardStyle(tone)}
                >
                  {/* Owner image fills the card (object-cover). When unset, the
                      glow shell alone shows through — the clean fallback. */}
                  {image ? (
                    <Image
                      src={image}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 45vw, 16vw"
                      className="absolute inset-0 z-0 object-cover"
                      aria-hidden="true"
                    />
                  ) : null}

                  {/* Product-card glow strips: left / right verticals. */}
                  <span
                    className="pointer-events-none absolute -left-px top-[14%] z-[2] h-[42%] w-px opacity-90 blur-[1px]"
                    style={{ background: tone.glowLeft }}
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute -right-px top-[31%] z-[2] h-[46%] w-px opacity-90 blur-[1px]"
                    style={{ background: tone.glowRight }}
                    aria-hidden="true"
                  />

                  {/* Text lives in its OWN bottom bar/container so it never sits
                      on top of the product photo. Centered per owner request. */}
                  <div className="relative z-[3] border-t border-white/12 bg-[linear-gradient(180deg,rgba(10,14,11,0.82),rgba(8,10,9,0.96))] px-2 py-2.5 text-center backdrop-blur-[2px]">
                    <p className="text-base font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-lg lg:text-xl">
                      {lane.label}
                    </p>
                    <p className="mt-0.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-[var(--greenway)] md:text-[0.62rem]">
                      Shop now →
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <HomeBrands
        items={items}
        content={content}
        brandFacts={brandFacts}
        count={brandCount}
      />
    </>
  );
}
