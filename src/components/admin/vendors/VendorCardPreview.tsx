/**
 * src/components/admin/vendors/VendorCardPreview.tsx
 *
 * A faithful, self-contained "this is how your vendor card will look on the
 * public site" preview. Until the public /vendors page is built, this gives
 * staff an honest visual of the published card using the same brand tokens
 * (black bg, white text, green accent, gold/orange highlights).
 *
 * Server component — purely presentational. The editor passes the current
 * (possibly unsaved-on-server but saved-on-submit) vendor fields + resolved
 * logo URL. A small "Preview" chrome frame makes it clear this is a mock of
 * the live site, not the live site itself.
 */
import type { Vendor } from "@/lib/vendors/types";

export function VendorCardPreview({
  vendor,
  logoUrl,
}: {
  vendor: Pick<
    Vendor,
    "display_name" | "mission_statement" | "about" | "website" | "product_count" | "brand_count" | "status"
  >;
  logoUrl: string | null;
}) {
  const tagline = vendor.mission_statement?.trim();
  const blurb = vendor.about?.trim();

  return (
    <div>
      {/* Browser-chrome frame to signal "public site preview" */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#050505]">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#111] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          <span className="ml-3 truncate text-[11px] text-white/40">
            greenwaymarijuana.com/vendors
          </span>
        </div>

        {/* The card itself, styled like a premium public storefront card */}
        <div className="p-5">
          <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-[#7ed957]/20 bg-gradient-to-b from-[#12351f]/40 to-black shadow-lg">
            <div className="flex items-center justify-center bg-black/40 p-6">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={`${vendor.display_name} logo`} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-3xl font-bold text-white/25">{vendor.display_name.charAt(0) || "?"}</span>
                )}
              </div>
            </div>
            <div className="space-y-2 p-5 text-center">
              <h3 className="text-lg font-bold text-white">{vendor.display_name || "Vendor name"}</h3>
              {tagline ? (
                <p className="text-sm font-medium text-[#7ed957]">{tagline}</p>
              ) : (
                <p className="text-sm italic text-white/25">Add a mission statement…</p>
              )}
              {blurb ? (
                <p className="line-clamp-4 text-sm text-white/65">{blurb}</p>
              ) : (
                <p className="text-sm italic text-white/25">Add an about section so customers know who they are.</p>
              )}
              <div className="flex items-center justify-center gap-3 pt-2 text-xs text-white/45">
                <span>{vendor.brand_count} brand{vendor.brand_count === 1 ? "" : "s"}</span>
                <span className="text-white/20">·</span>
                <span>{vendor.product_count} products</span>
              </div>
              {vendor.website?.trim() && (
                <span className="mt-2 inline-block rounded-full border border-[#7ed957]/40 px-4 py-1.5 text-xs font-semibold text-[#7ed957]">
                  Visit website →
                </span>
              )}
            </div>
          </div>

          {vendor.status !== "published" && (
            <p className="mt-4 text-center text-xs text-[#ff7f00]">
              This is a preview. This vendor is a <strong>draft</strong> — publish it to show this card on your site.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
