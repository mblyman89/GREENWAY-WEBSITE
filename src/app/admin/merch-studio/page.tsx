import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { MerchStudio } from "@/components/admin/merch-studio/MerchStudio";

export const dynamic = "force-dynamic";

/**
 * R70 - Merch Studio. Designs apparel that is SOLD by Greenway Merchandising
 * LLC (dba Greenway Glass & Goods) on its own merch subdomain + separate
 * checkout - never through the cannabis shop, cart, POS or delivery.
 * Permission: content.edit (same as Creative Studio) - designers already have it.
 */
export default async function MerchStudioPage() {
  await requirePermission("content.edit");
  return (
    <div>
      <AdminPageHeader
        title="Merch Studio"
        subtitle="Design premium apparel, check it like a pro printer would, and see exactly how each sale gets made and shipped - one at a time, no inventory."
        breadcrumbs={<Breadcrumbs items={[{ label: "MKTG & ADV" }, { label: "Merch Studio" }]} />}
      />
      <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 p-3 text-sm text-white/85">
        <b className="text-white">Sold by Greenway Glass & Goods.</b> Everything designed here is sold by <b>Greenway Merchandising LLC (dba Greenway Glass & Goods)</b> on its own merch subdomain with its own cart and card checkout. Apparel is never shown in the cannabis shop, never rung up on the cannabis POS, and never delivered by cannabis delivery. Confirm this structure with your attorney before launch.
      </div>
      <HelpPanel
        id="merch-studio"
        title="How the Merch Studio works"
        steps={[
          "Garments: pick a premium blank (Comfort Colors, Independent, Bella+Canvas, Yupoong, Richardson) and a colour. Every placement shows its real print size, methods and Printful price.",
          "Design: pick a placement pill, add text, icons, shapes or your own art, and drag it on a true-to-inch canvas. The green dashed box is the exact printable area. Arrows nudge 1/16 inch (Shift = 1/4 inch), Ctrl+Z / Ctrl+Shift+Z undo and redo, Ctrl+D duplicates, Alt-drag skips snapping. Checks run live, and Preview shows every side in every colour.",
          "Proof & Export: pick a saved design to see every print file exactly as Printful receives it (trimmed, transparent, true inches, DPI, distance from the collar or brim). Download the ZIP (300-DPI sRGB PNGs + README + proof sheet + design backup), open the printable proof sheet, generate Printful photo mockups once Printful is connected, and tick off the sample checklist when your sample arrives.",
          "Artwork Check: drop in any file to see if it will print sharp on this garment, placement and method.",
          "Fulfillment & Pricing: see the just-in-time pipeline (Printful makes and ships one item per sale) and your profit per unit after Printful and card fees.",
        ]}
      />
      <MerchStudio />
    </div>
  );
}
