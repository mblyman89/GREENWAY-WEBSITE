import type { CSSProperties } from "react";
import Link from "next/link";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import { cardTypeLabel, websiteCategoryCardLabel } from "@/lib/menu/card-type-core";
import { cardCannabinoids, deriveNetWeightLine, showProfilePill } from "@/lib/menu/card-cannabinoids";
import { cardDisplay } from "@/lib/menu/card-brand-core";
import { dohPillForItem } from "@/lib/menu/menu-doh-badge-core";
// SLICE G: the card's reserved height is a SHARED constant with the loading
// skeleton. It used to be a literal here and a copy of that literal in
// `menu-skeleton-core`; the two agreed as strings but the real card rendered
// 542-596px against a 468px reserve, which is where the 0.405 CLS came from.
// Importing means there is one number and nothing left to drift.
import { CARD_MIN_HEIGHT } from "@/lib/menu/menu-skeleton-core";
import { classificationPillsForItem } from "@/lib/menu/menu-classification-badge-core";
import { ProductCardPriceSelector } from "./ProductCardPriceSelector";
import { glowCardStyle } from "@/lib/ui/glow-card-core";

type CardTone = {
  border: string;
  glow: string;
  glowSoft: string;
  panel: string;
  pill: string;
  packageGradient: string;
  /**
   * Optional split-neon override for leaning hybrids: the LEFT edge/glow uses
   * the leaning side's color and the RIGHT uses the base hybrid color (owner
   * request). When omitted, both sides fall back to `glow`/`glowSoft`.
   */
  glowLeft?: string;
  glowSoftLeft?: string;
  glowRight?: string;
  glowSoftRight?: string;
  /**
   * Optional split fill for the strain-type banner (the labeled pill) on leaning
   * hybrids: `pillLeft` is the leaning side's color, `pillRight` is the base
   * hybrid color. The banner renders a left→right linear-gradient between the
   * two so they mesh through their blended midpoint with NO hard boundary (owner
   * request). When omitted, the banner falls back to the solid `pill` color.
   */
  pillLeft?: string;
  pillRight?: string;
};

const cardTones: Record<GreenwayMenuItem["strainType"], CardTone> = {
  sativa: {
    border: "#b46f34",
    glow: "rgba(217,117,39,0.92)",
    glowSoft: "rgba(255,151,53,0.34)",
    panel: "rgba(42,25,13,0.72)",
    pill: "#a76b3d",
    packageGradient: "linear-gradient(145deg,#f0422f 0%,#ff9d18 48%,#75c85a 100%)",
  },
  indica: {
    border: "#5499b8",
    glow: "rgba(84,153,184,0.95)",
    glowSoft: "rgba(116,184,214,0.34)",
    panel: "rgba(11,26,34,0.75)",
    pill: "#6f91a4",
    packageGradient: "linear-gradient(145deg,#6d39cf 0%,#c33f9d 50%,#6ec563 100%)",
  },
  hybrid: {
    border: "#6f835f",
    glow: "rgba(126,151,95,0.95)",
    glowSoft: "rgba(160,184,127,0.34)",
    panel: "rgba(27,22,31,0.76)",
    pill: "#728068",
    packageGradient: "linear-gradient(145deg,#58156e 0%,#a04ea5 42%,#f18b26 100%)",
  },
  // Indica-Hybrid: split neon — indica-BLUE on the LEFT (the lean), hybrid-GREEN
  // on the RIGHT (the base). `glow`/`glowSoft` stay as a blended fallback.
  "indica-hybrid": {
    border: "#5f88a0",
    glow: "rgba(95,136,160,0.95)",
    glowSoft: "rgba(138,178,178,0.34)",
    glowLeft: "rgba(84,153,184,0.95)",
    glowSoftLeft: "rgba(116,184,214,0.34)",
    glowRight: "rgba(126,151,95,0.95)",
    glowSoftRight: "rgba(160,184,127,0.34)",
    panel: "rgba(16,26,30,0.76)",
    pill: "#5f8890",
    // Banner mesh: indica-blue pill (left) → hybrid-green pill (right).
    pillLeft: "#6f91a4",
    pillRight: "#728068",
    packageGradient: "linear-gradient(145deg,#5499b8 0%,#6ec583 55%,#7ed957 100%)",
  },
  // Sativa-Hybrid: split neon — sativa-ORANGE on the LEFT (the lean), hybrid-GREEN
  // on the RIGHT (the base). `glow`/`glowSoft` stay as a blended fallback.
  "sativa-hybrid": {
    border: "#8a8a4f",
    glow: "rgba(170,150,70,0.95)",
    glowSoft: "rgba(190,180,110,0.34)",
    glowLeft: "rgba(217,117,39,0.92)",
    glowSoftLeft: "rgba(255,151,53,0.34)",
    glowRight: "rgba(126,151,95,0.95)",
    glowSoftRight: "rgba(160,184,127,0.34)",
    panel: "rgba(30,27,17,0.76)",
    pill: "#8a8050",
    // Banner mesh: sativa-orange pill (left) → hybrid-green pill (right).
    pillLeft: "#a76b3d",
    pillRight: "#728068",
    packageGradient: "linear-gradient(145deg,#ff9d18 0%,#c7c94f 52%,#7ed957 100%)",
  },
  cbd: {
    border: "#9a78a9",
    glow: "rgba(160,112,190,0.92)",
    glowSoft: "rgba(209,151,234,0.32)",
    panel: "rgba(34,24,40,0.76)",
    pill: "#906aa3",
    packageGradient: "linear-gradient(145deg,#6635d2 0%,#e565c8 48%,#54d4aa 100%)",
  },
  unknown: {
    border: "#f1f1f1",
    glow: "rgba(255,255,255,0.72)",
    glowSoft: "rgba(255,255,255,0.24)",
    panel: "rgba(14,14,14,0.82)",
    pill: "#f1f1f1",
    packageGradient: "linear-gradient(145deg,#333 0%,#bfbfbf 55%,#fafafa 100%)",
  },
};

// SLICE 49: categoryAliases moved to card-type-core.ts (websiteCategoryCardLabel)
// so the card mockup label and the new type line share one source of truth.

function cardStyle(tone: CardTone): CSSProperties {
  // Split neon: left uses the leaning color, right uses the base hybrid color.
  // Falls back to the single `glow`/`glowSoft` for non-split tones.
  const glowL = tone.glowLeft ?? tone.glow;
  const glowSoftL = tone.glowSoftLeft ?? tone.glowSoft;
  const glowR = tone.glowRight ?? tone.glow;
  const glowSoftR = tone.glowSoftRight ?? tone.glowSoft;
  // SLICE 117: the exact glow recipe now lives in one shared module so the
  // product, vendor, and specials cards can never drift apart. Output is
  // byte-identical to the hand-rolled version this replaced.
  return glowCardStyle({
    border: tone.border,
    glowLeft: glowL,
    glowSoftLeft: glowSoftL,
    glowRight: glowR,
    glowSoftRight: glowSoftR,
    panel: tone.panel,
  });
}

function isNonCannabisItem(item: GreenwayMenuItem) {
  return item.category === "paraphernalia";
}

function isCannabisItem(item: GreenwayMenuItem) {
  return !isNonCannabisItem(item);
}

/**
 * SLICE 43 (owner directive): the strain-type box only appears when we have a
 * VALIDATED strain type assigned. No fallback to the product category — if the
 * strain type is unknown (or the item is non-cannabis), the box is hidden and
 * this returns null. Unknown-strain cannabis still gets the hybrid card COLOR
 * (see cardToneForItem); non-cannabis keeps the neutral white tone.
 */
function displayStrain(item: GreenwayMenuItem): string | null {
  if (isNonCannabisItem(item)) return null;
  if (item.strainType === "unknown") return null;
  return strainTypeLabel(item.strainType);
}

function cardToneForItem(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return cardTones.unknown;
  if (item.strainType === "unknown") return cardTones.hybrid;
  return cardTones[item.strainType];
}

function categoryLabel(item: GreenwayMenuItem) {
  return websiteCategoryCardLabel(item.category);
}

/**
 * Fill for the strain-type banner (pill). Leaning hybrids mesh left→right from
 * the leaning color into the base hybrid color with no hard boundary; every
 * other strain type keeps its solid pill color. Text color stays as set by the
 * caller (white for cannabis, dark for non-cannabis).
 */
function pillBackground(tone: CardTone): CSSProperties["background"] {
  if (tone.pillLeft && tone.pillRight) {
    return `linear-gradient(to right, ${tone.pillLeft} 0%, ${tone.pillRight} 100%)`;
  }
  return tone.pill;
}

function productCardDisplayName(item: GreenwayMenuItem, baseName: string = item.name) {
  // SLICE 47 (owner Q4): `baseName` is the label-clipped name from cardDisplay —
  // the brand/vendor shown above the picture is removed from the front of the
  // name (display only; item.name itself is never mutated).
  // SLICE 49: the product TYPE is no longer appended here — it has its own
  // dedicated line under the brand/vendor label (owner card-layout request),
  // so the name stays simple. Ratio/cannabinoid info living IN the source name
  // (e.g. "Paradise Punch 1:1 THC:CBD 200mg") is untouched — clipping only ever
  // removes the brand/vendor prefix.
  void item;
  return baseName;
}

function brandInitials(brand: string) {
  return (
    brand
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("") || "G"
  );
}

function CartIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.2 6.5h15.1l-1.7 8.1a2 2 0 0 1-2 1.6H8.8a2 2 0 0 1-2-1.7L5.4 3.8H2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 20.2h.01M17.2 20.2h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ProductImageMockup({ item, tone }: { item: GreenwayMenuItem; tone: CardTone }) {
  const initials = brandInitials(item.brand);
  const nonCannabis = isNonCannabisItem(item);
  const label = categoryLabel(item).toUpperCase();
  // SLICE 43: the mockup's "X Formula" ribbon only prints a VALIDATED strain
  // type — never the category as a stand-in (owner rule: show real data or nothing).
  const strain = displayStrain(item);

  if (nonCannabis) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_45%,rgba(0,0,0,0.055),transparent_34%),linear-gradient(180deg,rgba(255,255,255,1),rgba(245,245,245,1))]" aria-hidden="true" />
        <div className="relative h-[83%] w-[54%] rotate-[-8deg]">
          <div className="absolute left-[45%] top-[3%] h-[42%] w-[10%] rounded-full bg-zinc-400 shadow-[0_2px_8px_rgba(0,0,0,0.2)]" />
          <div className="absolute left-[41%] top-[34%] h-[25%] w-[18%] rounded-full bg-gradient-to-b from-zinc-300 to-zinc-600 shadow-md" />
          <div className="absolute bottom-[8%] left-[30%] h-[43%] w-[40%] rounded-full bg-gradient-to-br from-[#722118] via-[#d57d38] to-[#3c160f] shadow-2xl shadow-black/25" />
          <div className="absolute bottom-[11%] left-[35%] h-[36%] w-[30%] rounded-full bg-[radial-gradient(circle_at_30%_28%,rgba(255,219,120,0.72),transparent_18%),radial-gradient(circle_at_70%_70%,rgba(62,12,8,0.75),transparent_35%)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 28% 18%, rgba(255,255,255,0.95), transparent 20%), radial-gradient(circle at 72% 72%, ${tone.glowSoft}, transparent 42%), linear-gradient(145deg, #ffffff 0%, #f8f8f8 62%, rgba(235,235,235,1) 100%)` }} aria-hidden="true" />
      <div className="relative flex h-[86%] w-[67%] flex-col items-center justify-between overflow-hidden rounded-[0.95rem] border border-black/15 bg-[#111] p-2.5 shadow-[0_19px_35px_rgba(0,0,0,0.28)]">
        <div className="absolute inset-0 opacity-95" style={{ background: tone.packageGradient }} aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 h-10 bg-white/12" aria-hidden="true" />
        <div className="relative z-10 w-full text-center text-[0.48rem] font-black uppercase tracking-[0.21em] text-black/62">{label}</div>
        <div className="relative z-10 grid h-16 w-16 place-items-center rounded-full bg-black text-base font-black uppercase text-white shadow-xl shadow-black/30 md:h-[4.55rem] md:w-[4.55rem]">
          {initials}
        </div>
        {/* Bottom ribbon: validated strain only. The category already prints in
            the top ribbon, so when strain is unknown the bottom ribbon hides
            rather than repeating the category (owner rule: real data or nothing). */}
        {strain ? (
          <div className="relative z-10 w-full rounded-md bg-black/16 px-1.5 py-1 text-center text-[0.58rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
            {strain} Formula
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ProductCardVisualProps = {
  item: GreenwayMenuItem;
  salePriceMinorUnits?: number;
  saleBadgeLabel?: string;
  ctaLabel?: string;
  className?: string;
};

export function ProductCardVisual({ item, salePriceMinorUnits, saleBadgeLabel, ctaLabel = "ADD TO CART", className = "" }: ProductCardVisualProps) {
  const showCannabinoids = isCannabisItem(item);
  const tone = cardToneForItem(item);
  // SLICE 47 (owner Q4): label above the picture = brand, else vendor, else
  // nothing; the shown label is clipped from the FRONT of the display name so
  // the card never reads "Fairwinds — Fairwinds Healing Balm". Website display
  // only — item.name is untouched everywhere else (search, cart, admin, CCRS).
  const { label: cardLabel, name: clippedName } = cardDisplay(item);
  const displayName = productCardDisplayName(item, clippedName);
  // SLICE 43: honest, validated-only display. Boxes appear ONLY when there is
  // real data (no "--" placeholders, no "~" category-average estimates). One
  // combined TOTAL THC box (folds THC-A), total CBD, and full boxes for minors
  // (CBG/CBN/CBC/CBDV). All values are totals, never per-serving.
  const cannabinoids = showCannabinoids ? cardCannabinoids(item) : null;
  const netWeightLine = showCannabinoids ? deriveNetWeightLine(item) : null;
  const strain = displayStrain(item);
  // SLICE F (owner Michael): the on-card DOH pill. Michael locked in a BLUE
  // pill that says "DOH", living "with the other pills" (the 1:1 / CBD profile
  // pill). dohPillForItem returns null for non-compliant items so nothing shows
  // pre-migration (empty medical registry) -- exactly like today. It renders
  // INDEPENDENTLY of the cannabinoid block so a DOH item ALWAYS shows its pill,
  // even a non-cannabis DOH item or one whose profile pill is suppressed.
  const dohPill = dohPillForItem(item);
  // SLICE 18C: the sales-limit classification pills, living in the SAME lane
  // as the DOH pill because they answer the same kind of question ("what rules
  // does this product fall under?"). Returns an EMPTY array for an ordinary or
  // unreviewed product, so nothing renders and the card is byte-identical to
  // today -- the same graceful default the DOH pill ships with.
  //
  // The specs come from the shared badge core, which delegates to SLICE 18B's
  // itemHasClassification -> the register's own predicates. So a pill appears
  // here ONLY when the till would genuinely route the product to that bucket;
  // the card can never advertise an allowance the register refuses to honour.
  const classificationPills = classificationPillsForItem(item);

  // SLICE 95 (owner: uniform card heights): NO h-full on the card. In the
  // PDP's horizontal flex rail, `height: 100%` resolves against an auto-height
  // container, so each card kept its OWN content height — the ragged
  // 552–631px cards Michael saw (measured in-browser). Un-heighted flex/grid
  // items stretch to the tallest sibling by default (align-items: stretch),
  // which is exactly the equal-height behavior we want on every surface
  // (shop grid, home rail, specials grid, PDP rail) — verified both ways.
  return (
    <article
      className={`group relative flex ${CARD_MIN_HEIGHT} min-w-0 flex-col justify-between overflow-hidden border p-4 text-white transition duration-300 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)] ${className}`}
      style={cardStyle(tone)}
    >
      <span className="pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]" style={{ background: tone.glowLeft ?? tone.glow }} aria-hidden="true" />
      <span className="pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]" style={{ background: tone.glowRight ?? tone.glow }} aria-hidden="true" />
      <span className="pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />

      <div>
        {cardLabel ? (
          <p className="truncate pb-1 text-center text-lg font-black leading-none text-white md:text-xl">{cardLabel}</p>
        ) : (
          // Keep the card grid aligned when no brand/vendor exists to show.
          <p className="pb-1 text-center text-lg font-black leading-none text-transparent md:text-xl" aria-hidden="true">&nbsp;</p>
        )}
        {/* SLICE 49 (owner card layout): product TYPE gets its own line right
            under the brand/vendor — "Live Resin", "Gummies", "Flower" — so the
            product name below the picture stays simple. Never empty (falls
            back to the website category), so the grid stays aligned. */}
        <p className="truncate pb-2 text-center text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/60">
          {cardTypeLabel(item)}
        </p>

        <Link href={`/menu/products/${item.id}`} className="block" aria-label={`View ${item.name}`}>
          <div className="relative h-[14.15rem] overflow-hidden bg-white p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] md:h-[14.65rem]">
            {item.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {item.imageIsFallback ? (
                  <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                    Representative image
                  </span>
                ) : null}
              </>
            ) : (
              <ProductImageMockup item={item} tone={tone} />
            )}
          </div>
        </Link>

        <Link
          href={`/menu/products/${item.id}`}
          className="mx-auto mt-4 line-clamp-2 block min-h-[2.45rem] text-center text-[1.08rem] font-black leading-[1.12] text-white transition group-hover:text-white md:text-[1.18rem]"
        >
          {displayName}
        </Link>
      </div>

      {/* Bottom group: strain + cannabinoid boxes + price + cart all hug the bottom so boxes align across cards regardless of name length. */}
      <div className="pt-4 text-center">
        <div className="mb-3 grid gap-2 text-center">
          {/* SLICE 43: strain-type box ONLY when a validated strain type is
              assigned. Unknown strain / non-cannabis = no box at all (the card
              color still falls back to hybrid for unknown-strain cannabis). */}
          {strain ? (
            <span
              className="flex min-h-9 w-full items-center justify-center rounded-md px-3 py-2 text-sm font-black uppercase leading-none text-white"
              style={{ background: pillBackground(tone) }}
            >
              {strain}
            </span>
          ) : null}
          {/* SLICE F (owner Michael): the DOH pill. Same rounded-full shape as
              the profile pill so it sits naturally in the pill lane, but BLUE
              (tone tokens live in menu-doh-badge-core → colour is one line).
              Rendered OUTSIDE the cannabinoid block so it always shows for a
              DOH item; when the profile pill is present the two stack neatly. */}
          {dohPill ? (
            <span
              className={`mx-auto inline-flex items-center gap-1.5 rounded-full border ${dohPill.tone.border} bg-black/45 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] ${dohPill.tone.text} backdrop-blur-sm`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dohPill.tone.dot}`} aria-hidden="true" />
              {dohPill.label}
            </span>
          ) : null}
          {/* SLICE 18C: the sales-limit classification pills. Identical shape to
              the DOH pill above so they share the lane naturally, but in their
              own tones (amber / violet) because blue is DOH and green is the
              deal badge -- a compliance classification must never read as a
              sale. `title` carries the FULL shopper label ("Low-THC Beverages")
              while the pill shows the short form, since the lane is a narrow
              0.62rem column. Tones live in menu-classification-badge-core, so a
              recolour is one assignment. */}
          {classificationPills.map((pill) => (
            <span
              key={pill.kind}
              title={pill.title}
              className={`mx-auto inline-flex items-center gap-1.5 rounded-full border ${pill.tone.border} bg-black/45 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] ${pill.tone.text} backdrop-blur-sm`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${pill.tone.dot}`} aria-hidden="true" />
              {pill.label}
            </span>
          ))}
          {showCannabinoids && cannabinoids ? (
            <div className="grid gap-2">
              {/* Profile badge — mirrors the compliance naming tag (1:1 /
                  THC:CBD:CBN / CBD). SLICE 66 (owner C3): only rendered when
                  it ADDS information — a lone "THC" pill is redundant noise
                  and is suppressed by showProfilePill. */}
              {showProfilePill(cannabinoids.profile) && cannabinoids.profile ? (
                <span className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/45 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-white/90 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--greenway)]" aria-hidden="true" />
                  {cannabinoids.profile.kind === "thc"
                    ? "THC"
                    : cannabinoids.profile.kind === "cbd"
                      ? "CBD"
                      : cannabinoids.profile.kind === "ratio"
                        ? `${cannabinoids.profile.label} THC:CBD`
                        : cannabinoids.profile.label}
                </span>
              ) : null}

              {/* SLICE 43: unified validated info boxes — TOTAL THC (folds THCA),
                  total CBD, then minors (CBG/CBN/CBC/CBDV) each promoted to the
                  same white box. Values are package/lab TOTALS, never per-serving.
                  When there is no validated data, NOTHING renders (no "--"). */}
              {cannabinoids.boxes.length > 0 ? (
                <div className={`grid gap-2 ${cannabinoids.boxes.length >= 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {cannabinoids.boxes.slice(0, 4).map((box) => (
                    <span
                      key={box.label}
                      className="flex min-h-9 items-center justify-center rounded-md bg-white px-2.5 py-2 text-[0.72rem] font-black uppercase leading-none text-black"
                    >
                      {box.label}: {box.display}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Net weight/volume companion line for edibles/drinks (WAC 314-55-105). */}
              {netWeightLine ? (
                <span className="text-center text-[0.62rem] font-bold uppercase tracking-[0.06em] text-white/70">
                  {netWeightLine}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {saleBadgeLabel ? (
          <div className="mb-2 rounded-full border border-[var(--greenway)]/55 bg-black/60 px-3 py-1.5 text-[0.66rem] font-black uppercase leading-tight tracking-[0.08em] text-[var(--greenway)] shadow-[0_0_18px_rgba(126,217,87,0.18)]">
            {saleBadgeLabel}
          </div>
        ) : null}
        <ProductCardPriceSelector item={item} salePriceMinorUnits={salePriceMinorUnits} />

        <Link
          href={`/menu/products/${item.id}`}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:bg-[var(--orange)]"
          aria-label={`${ctaLabel} ${item.name}`}
        >
          <CartIcon />
          {ctaLabel}
        </Link>
      </div>
    </article>
  );
}
