import Image from "next/image";
import Link from "next/link";
import { HomeBrands } from "@/components/home/HomeBrands";
import { SectionBanner, type SectionBannerButton } from "@/components/home/SectionBanner";
import type { VendorDirectoryEntry } from "@/lib/menu/vendor-directory-core";
import { categoryLanes } from "@/lib/specials/daily-deal-presentation";
import { glowCardStyle, glowToneByIndex } from "@/lib/ui/glow-card-core";
import type { HomeTypeLaneKey } from "@/lib/cms/home-section-settings-core";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { typeCardGridClass, type TypeCard } from "@/lib/cms/type-cards-core";
import { isGifSrc } from "@/lib/media/gif-core";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { BannerMedia } from "@/components/site/BannerMedia";
import { DesignedCard } from "@/components/site/DesignedCard";
import { heroColorHex, heroFontStack, isScriptHeroFont } from "@/lib/loyalty/loyalty-hero-core";

/**
 * Home "Shop by Category" + "Shop by Brand" sections.
 *
 * Category: a wide/short SectionBanner header followed by the six fixed
 * customer-facing lanes (Flower, Prerolls, Concentrates, Edibles, Liquids,
 * Topicals). Each tile links to the pre-filtered menu via the lane's
 * /menu?categories=a,b,c href.
 *
 * Brand: delegated to the client HomeBrands component, which now rotates
 * through VENDOR glow cards (feature-shuffle style) — the same look as the
 * public Vendors page.
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
  /**
   * R41 S2(a) — the Home editor's alignment / image focus / buttons now reach
   * the public banners (they were never passed before, so the controls looked
   * broken). imageFocus is only passed when it is NOT "center": "center" keeps
   * the classic look (image hugs the side opposite the text).
   */
  categoryTextAlign?: "left" | "center" | "right";
  categoryImageFocus?: "top" | "bottom" | "left" | "right";
  categoryButtons?: SectionBannerButton[];
  brandTextAlign?: "left" | "center" | "right";
  brandImageFocus?: "top" | "bottom" | "left" | "right";
  brandButtons?: SectionBannerButton[];
  /** R41 S2(b): owner's custom design (Banner Studio); null/disabled = classic look. */
  categoryDesign?: BannerDesign | null;
  categoryDesignOwner?: string;
  brandDesign?: BannerDesign | null;
  brandDesignOwner?: string;
};

export function PromoGrid({
  content,
  vendors = [],
  brandCount,
  laneImages,
  typeCards,
}: {
  content?: PromoBannerContent;
  /**
   * Vendor directory entries (derived live from the published menu + back-office
   * profiles) for the "Shop by Brand" vendor-card grid.
   */
  vendors?: VendorDirectoryEntry[];
  /** SLICE 112: owner-controlled brand-grid card count (home.brand settings.cardCount). */
  brandCount?: number;
  /**
   * Owner-uploaded product photo per category lane (home.category
   * settings.laneImages). An unset lane resolves to "" so the tile renders its
   * clean text-only fallback, byte-identical to the card the site shipped with.
   */
  laneImages?: Partial<Record<HomeTypeLaneKey, string>>;
  /**
   * R41 S3: the owner's Type Cards (visible ones only, already normalized).
   * Absent = the six original lanes (classic render). An empty array means the
   * owner deleted or hid every card, so the tile grid is hidden.
   */
  typeCards?: TypeCard[];
} = {}) {
  const tiles: TypeCard[] =
    typeCards ??
    categoryLanes.map((lane) => ({
      id: lane.key,
      label: lane.label,
      href: lane.href,
      image: laneImages?.[lane.key as HomeTypeLaneKey] || "",
      cta: "Shop now →",
      enabled: true,
    }));
  return (
    <>
      <section
        id="shop-by-category"
        className="px-4 py-6 md:px-8 md:py-8"
        aria-label="Shop by category"
      >
        <div className="mx-auto max-w-[88rem] space-y-4 md:space-y-6">
          <SectionBanner
            imageSrc={content?.categoryImage || "/home/category-banner.webp"}
            imageAlt="Greenway Marijuana product categories"
            eyebrow={content?.categoryEyebrow || "Browse the Menu"}
            title={content?.categoryTitle || "Shop by Category"}
            subtitle={
              content?.categorySubtitle ||
              "Jump straight into the products you want — every tile opens a pre-filtered menu."
            }
            editable={content?.editable}
            blockKeyPrefix="home.category"
            textAlign={content?.categoryTextAlign}
            imageFocus={content?.categoryImageFocus}
            buttons={content?.categoryButtons}
            design={content?.categoryDesign}
            designOwner={content?.categoryDesignOwner}
          />

          {tiles.length > 0 ? (
          <div
            className={typeCardGridClass(tiles.length)}
            {...(content?.editable ? { "data-gw-edit-area": "home-typecards" } : {})}
          >
            {tiles.map((lane, index) => {
              const tone = glowToneByIndex(index);
              // Owner-uploaded product photo for this card, or "" -> clean
              // text-only fallback (byte-identical to the card the site shipped).
              const image = lane.image;
              // R61-S3: a custom card design (shared Banner Studio) wins.
              if (lane.adv?.design?.enabled) {
                return (
                  <DesignedCard
                    key={lane.id}
                    design={lane.adv.design}
                    imageSrc={image}
                    legacy={{ title: lane.label, subtitle: lane.cta }}
                    href={lane.href}
                    newTab={lane.adv.newTab}
                    label={lane.label.replace(/\n/g, " ")}
                    frameClassName="border shadow-lg shadow-black/30 transition duration-300 group-hover:-translate-y-0.5 group-hover:border-white/70 group-hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
                    frameExtraStyle={glowCardStyle(tone)}
                  />
                );
              }
              // R47: a card with advanced options, or a video picture, takes
              // the advanced path. Everything else is byte-identical to R41.
              if (lane.adv || isVideoSrc(image)) {
                return <AdvancedTypeCard key={lane.id} lane={lane} index={index} />;
              }
              return (
                <Link
                  key={lane.id}
                  href={lane.href}
                  className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl border shadow-lg shadow-black/30 transition duration-300 hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)] lg:aspect-[3/4]"
                  style={glowCardStyle(tone)}
                >
                  {/* Owner image fills the card (object-cover). When unset, the
                      glow shell alone shows through — the clean fallback. */}
                  {image ? (
                    <Image
                      src={image}
                      unoptimized={isGifSrc(image)}
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
                    <p
                      className={`text-base font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-lg lg:text-xl${lane.label.includes("\n") ? " whitespace-pre-line" : ""}`}
                    >
                      {lane.label}
                    </p>
                    {lane.cta ? (
                      <p className="mt-0.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-[var(--greenway)] md:text-[0.62rem]">
                        {lane.cta}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
          ) : null}
        </div>
      </section>

      <HomeBrands
        vendors={vendors}
        content={content}
        count={brandCount}
      />
    </>
  );
}

// ── R47: advanced Type Card ─────────────────────────────────────────────────

const OBJ_POS: Record<string, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};
const MD_OBJ_POS: Record<string, string> = {
  center: "md:object-center",
  top: "md:object-top",
  bottom: "md:object-bottom",
  left: "md:object-left",
  right: "md:object-right",
};

function AdvancedTypeCard({ lane, index }: { lane: TypeCard; index: number }) {
  const tone = glowToneByIndex(index);
  const a = lane.adv ?? {};
  const desk = a.imageFocus ?? "center";
  const phone = a.imageFocusMobile ?? desk;
  const zoom = a.zoom && a.zoom > 100 ? { transform: `scale(${a.zoom / 100})` } : undefined;
  const textStyle = a.textStyle ?? "bar";
  const labelStyle: React.CSSProperties = {};
  if (a.labelFont) labelStyle.fontFamily = heroFontStack(a.labelFont);
  if (a.labelColor) labelStyle.color = heroColorHex(a.labelColor);
  const ctaStyle: React.CSSProperties = a.ctaColor ? { color: heroColorHex(a.ctaColor) } : {};
  const script = a.labelFont ? isScriptHeroFont(a.labelFont) : false;
  const media = (src: string, cls: string) => (
    <BannerMedia
      src={src}
      alt=""
      ariaHidden
      hideControl
      sizes="(max-width: 768px) 45vw, 16vw"
      className={`z-0 object-cover ${cls}`}
      style={zoom}
    />
  );
  return (
    <Link
      href={lane.href}
      {...(a.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      aria-label={textStyle === "hidden" ? lane.label.replace(/\n/g, " ") : undefined}
      className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl border shadow-lg shadow-black/30 transition duration-300 hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)] lg:aspect-[3/4]"
      style={glowCardStyle(tone)}
    >
      {a.imageMobile ? (
        <>
          <div className="absolute inset-0 z-0 overflow-hidden md:hidden">{media(a.imageMobile, OBJ_POS[phone])}</div>
          {lane.image ? (
            <div className="absolute inset-0 z-0 hidden overflow-hidden md:block">{media(lane.image, OBJ_POS[desk])}</div>
          ) : null}
        </>
      ) : lane.image ? (
        <div className="absolute inset-0 z-0 overflow-hidden">
          {media(lane.image, `${OBJ_POS[phone]} ${MD_OBJ_POS[desk]}`)}
        </div>
      ) : null}
      {a.dim ? (
        <span
          className="pointer-events-none absolute inset-0 z-[1] bg-black"
          style={{ opacity: a.dim / 100 }}
          aria-hidden="true"
        />
      ) : null}
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
      {textStyle === "hidden" ? null : (
        <div
          className={
            textStyle === "overlay"
              ? "relative z-[3] bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.7)_100%)] px-2 pb-3 pt-8 text-center"
              : "relative z-[3] border-t border-white/12 bg-[linear-gradient(180deg,rgba(10,14,11,0.82),rgba(8,10,9,0.96))] px-2 py-2.5 text-center backdrop-blur-[2px]"
          }
        >
          <p
            className={`text-base font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-lg lg:text-xl${lane.label.includes("\n") ? " whitespace-pre-line" : ""}${script ? " normal-case tracking-normal" : ""}`}
            style={labelStyle}
          >
            {lane.label}
          </p>
          {lane.cta ? (
            <p
              className="mt-0.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-[var(--greenway)] md:text-[0.62rem]"
              style={ctaStyle}
            >
              {lane.cta}
            </p>
          ) : null}
        </div>
      )}
    </Link>
  );
}
