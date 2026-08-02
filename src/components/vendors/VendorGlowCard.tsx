/**
 * src/components/vendors/VendorGlowCard.tsx
 *
 * Shared, presentational vendor card: the dark #101010 glow tile with a slim
 * vendor-name bar at the top, the logo filling the middle, and a product-count
 * footer. This is the SAME visual family as the public /vendors directory card
 * (VendorDirectory.tsx) and sources its glow recipe from the shared
 * src/lib/ui/glow-card-core.ts, so the theme can never drift.
 *
 * Deliberately DUMB and UNWIRED: no button, no click-to-expand, no description
 * overlay, no link. It renders a plain <div> so callers decide the wrapper
 * (a link to a filtered menu, a static grid tile, etc.). The homepage
 * "Shop by Brand" section renders these as static tiles for now; a later slice
 * will wire them to the menu once the menu filter switches from brand to vendor.
 *
 * Server-safe (no hooks, no "use client"): a pure function of its props.
 */
import Image from "next/image";
import { glowCardStyle, glowToneByIndex } from "@/lib/ui/glow-card-core";
import type { VendorDirectoryEntry } from "@/lib/menu/vendor-directory-core";

// Byte-matched to VendorDirectory.tsx: the honest fallback when a vendor has no
// uploaded logo yet.
const PLACEHOLDER_LOGO = "/vendors/vendor-logo-placeholder.png";

// The vendor name lives in a slim bar at the top of the card; the total
// character count drives how small we go to keep it on ONE line on the narrow
// mobile tile. Short names keep the default size. (Same ladder as the public
// directory card so both read identically.)
function nameSizeClass(name: string): string {
  const total = name.trim().length;
  if (total >= 34) return "text-[0.5rem] md:text-[0.7rem]";
  if (total >= 28) return "text-[0.56rem] md:text-[0.8rem]";
  if (total >= 22) return "text-[0.64rem] md:text-[0.9rem]";
  if (total >= 16) return "text-[0.72rem] md:text-base";
  return "text-[0.82rem] md:text-lg";
}

export function VendorGlowCard({
  vendor,
  index,
}: {
  vendor: VendorDirectoryEntry;
  index: number;
}) {
  // Cycle the shared on-brand glow tones so an adjacent grid reads lively while
  // every card stays in one cohesive family with product/type/specials cards.
  const tone = glowToneByIndex(index);
  const logoSrc = vendor.logoUrl || PLACEHOLDER_LOGO;

  return (
    <div
      className="group relative isolate flex aspect-[4/5] w-full flex-col overflow-hidden rounded-2xl border text-left transition duration-300 hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
      style={glowCardStyle(tone)}
    >
      {/* Product-card glow strips: left / right verticals + a soft bottom line. */}
      <span
        className="pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]"
        style={{ background: tone.glowLeft }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]"
        style={{ background: tone.glowRight }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]"
        style={{ background: tone.glowRight }}
        aria-hidden="true"
      />

      {/* Slim name bar at the very TOP — one line, scaled to fit. */}
      <div className="relative z-10 border-b border-white/10 px-3 py-2 md:px-4 md:py-2.5">
        <p
          className={`w-full truncate text-center font-black uppercase leading-none tracking-tight text-white drop-shadow ${nameSizeClass(vendor.name)}`}
        >
          {vendor.name}
        </p>
      </div>

      {/* Logo fills nearly the entire card. object-contain keeps brand marks
          crisp and un-cropped; a subtle floor shadow grounds them. */}
      <div className="relative z-0 flex flex-1 items-center justify-center p-3 md:p-4">
        <span className="relative h-full w-full">
          <Image
            src={logoSrc}
            alt={`${vendor.name} logo`}
            fill
            sizes="(max-width: 768px) 45vw, 22vw"
            className="object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
          />
        </span>
      </div>

      {/* Product-count footer. */}
      <div className="relative z-10 px-3 pb-2.5 text-center md:px-4 md:pb-3">
        <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/70 md:text-[0.62rem]">
          {vendor.productCount} {vendor.productCount === 1 ? "product" : "products"}
        </p>
      </div>
    </div>
  );
}
