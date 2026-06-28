/**
 * src/components/admin/promotions/SaleBadgePreview.tsx
 *
 * Live "this is how the sale will look" preview for a promotion. Renders a
 * mock storefront product card with the discount badge + (when it's a simple
 * per-item percent/fixed deal) a strikethrough original price and the sale
 * price. For complex deal types (BOGO, tiers, baskets) we show the rule badge
 * only — those resolve in the cart, so we don't fake a single-item number.
 *
 * Server component, purely presentational. The page passes a representative
 * affected product (or sensible defaults when the menu has no matches yet).
 */
import { formatMinorCurrency } from "@/lib/leafly/format";
import { sampleDiscount } from "@/lib/promotions/sample-discount";
import type { DiscountType } from "@/lib/promotions/types";

export function SaleBadgePreview({
  title,
  sampleName,
  sampleBrand,
  samplePriceMinorUnits,
  discountType,
  discountPercent,
  discountFixed,
  multiItemPercent,
  bonusNote,
}: {
  title: string;
  sampleName: string;
  sampleBrand: string;
  samplePriceMinorUnits: number;
  discountType: DiscountType;
  discountPercent: number;
  discountFixed: number;
  multiItemPercent: number | null;
  bonusNote: string | null;
}) {
  const d = sampleDiscount(samplePriceMinorUnits, {
    discountType,
    discountPercent,
    discountFixed,
    multiItemPercent,
  });

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-white/40">Sale badge preview</h3>
      <p className="mt-1 text-xs text-white/40">How this deal shows on a product card.</p>

      <div className="mt-3 flex justify-center">
        <div className="relative w-44 overflow-hidden rounded-xl border border-[#7ed957]/25 bg-gradient-to-b from-[#12351f]/30 to-black">
          {/* Sale flag */}
          <div className="absolute left-0 top-2 rounded-r-full bg-[#ff7f00] px-2.5 py-1 text-[10px] font-bold text-black shadow">
            {d.badge}
          </div>

          {/* Image placeholder */}
          <div className="flex h-24 items-center justify-center bg-black/40 text-2xl">🌿</div>

          <div className="space-y-1 p-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40">{sampleBrand || "Brand"}</p>
            <p className="line-clamp-2 text-xs font-semibold text-white">{sampleName || "Product name"}</p>

            {d.showsPrice ? (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-[#7ed957]">{formatMinorCurrency(d.saleMinorUnits)}</span>
                <span className="text-xs text-white/30 line-through">{formatMinorCurrency(samplePriceMinorUnits)}</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-white">{formatMinorCurrency(samplePriceMinorUnits)}</span>
                <span className="rounded bg-[#7ed957]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#7ed957]">
                  deal applies in cart
                </span>
              </div>
            )}

            {bonusNote && <p className="text-[10px] text-[#ffd700]">{bonusNote}</p>}
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-white/40">
        Promotion: <span className="text-white/70">{title || "Untitled"}</span>
      </p>
    </div>
  );
}
