/**
 * src/components/admin/vendors/VendorCardPreview.tsx
 *
 * A faithful "this is how your vendor card looks on the public site" preview.
 * SLICE 114: redesigned to MATCH the public /vendors card — a dark #101010
 * tile with a glowing side-lit border (Greenway green), a slim vendor-name bar
 * at the top, the logo filling nearly the whole card, and the blurb shown as a
 * tap-to-reveal overlay (here always visible so staff see the copy). The blurb
 * follows the SAME fallback order the public card uses: mission_statement →
 * about → product_philosophy.
 *
 * Server component — purely presentational. The editor passes the current
 * vendor fields + resolved logo URL. A small browser-chrome frame makes it
 * clear this is a mock of the live site, not the live site itself.
 */
import type { CSSProperties } from "react";
import type { Vendor } from "@/lib/vendors/types";

// On-brand Greenway-green glow, byte-matched to the public card's first tone.
const TONE = {
  border: "#4f8f5a",
  glowLeft: "rgba(79,143,90,0.95)",
  glowSoftLeft: "rgba(126,184,127,0.34)",
  glowRight: "rgba(79,143,90,0.95)",
  glowSoftRight: "rgba(126,184,127,0.34)",
  panel: "rgba(15,28,18,0.76)",
};

const cardStyle: CSSProperties = {
  borderColor: TONE.border,
  backgroundColor: "#101010",
  backgroundImage: `radial-gradient(ellipse 54% 72% at -9% 44%, ${TONE.glowLeft} 0%, ${TONE.glowSoftLeft} 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, ${TONE.glowRight} 0%, ${TONE.glowSoftRight} 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), ${TONE.panel} 48%, rgba(10,10,10,0.98))`,
  boxShadow: `inset 18px 0 34px -31px ${TONE.glowLeft}, inset -18px 0 34px -31px ${TONE.glowRight}, 0 13px 28px rgba(0,0,0,0.38)`,
};

export function VendorCardPreview({
  vendor,
  logoUrl,
}: {
  vendor: Pick<
    Vendor,
    | "display_name"
    | "mission_statement"
    | "about"
    | "product_philosophy"
    | "website"
    | "product_count"
    | "brand_count"
    | "status"
  >;
  logoUrl: string | null;
}) {
  // Same fallback order as the public card (vendor-directory-core.ts).
  const blurb =
    vendor.mission_statement?.trim() ||
    vendor.about?.trim() ||
    vendor.product_philosophy?.trim() ||
    "";

  return (
    <div>
      {/* Browser-chrome frame to signal "public site preview". */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#050505]">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#111] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          <span className="ml-3 truncate text-[11px] text-white/40">
            greenwaymarijuana.com/vendors
          </span>
        </div>

        {/* The card itself — dark glow tile, logo forward (matches public). */}
        <div className="p-5">
          <div
            className="mx-auto flex aspect-[4/5] max-w-[15rem] flex-col overflow-hidden rounded-2xl border"
            style={cardStyle}
          >
            {/* Slim vendor-name bar at the top. */}
            <div className="border-b border-white/10 px-3 py-2">
              <p className="truncate text-center text-sm font-black uppercase leading-none tracking-tight text-white drop-shadow">
                {vendor.display_name || "Vendor name"}
              </p>
            </div>

            {/* Logo fills nearly the whole card. */}
            <div className="flex flex-1 items-center justify-center p-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={`${vendor.display_name} logo`}
                  className="h-full w-full object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
                />
              ) : (
                <span className="text-5xl font-black text-white/20">
                  {vendor.display_name.charAt(0) || "?"}
                </span>
              )}
            </div>

            {/* Product-count footer. */}
            <div className="px-3 pb-2.5 text-center">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-white/70">
                {vendor.product_count} {vendor.product_count === 1 ? "product" : "products"}
              </p>
            </div>
          </div>

          {/* The tap-to-reveal blurb, shown here so staff can proof the copy. */}
          <div className="mx-auto mt-4 max-w-[15rem] rounded-xl border border-white/10 bg-black/40 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
              Tap-to-reveal blurb
            </p>
            {blurb ? (
              <p className="mt-1.5 text-xs leading-snug text-white/80">{blurb}</p>
            ) : (
              <p className="mt-1.5 text-xs italic text-white/25">
                Add a mission statement, about, or product philosophy so customers
                know who they are.
              </p>
            )}
          </div>

          {vendor.website?.trim() && (
            <p className="mt-3 text-center text-[11px] font-semibold text-[var(--admin-accent)]">
              {vendor.website.trim()}
            </p>
          )}

          {vendor.status !== "published" && (
            <p className="mt-4 text-center text-xs text-[var(--admin-orange)]">
              This is a preview. This vendor is a <strong>draft</strong> — publish it to show this card on your site.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
