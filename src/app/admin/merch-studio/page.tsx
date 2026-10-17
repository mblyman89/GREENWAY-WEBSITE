import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { MerchStudio, STUDIO_TAB_IDS, type StudioTab } from "@/components/admin/merch-studio/MerchStudio";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { getContentBlock, ensureContentBlocksSeeded } from "@/lib/cms/content-store";
import { listMedia } from "@/lib/media/store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_AD_BLOCK } from "@/lib/merch/merch-ad-core";

export const dynamic = "force-dynamic";

/**
 * R70 - Merch Studio. Designs apparel that is SOLD by Greenway Merchandising
 * LLC (dba Greenway Glass & Goods) on its OWN separate website + Stripe
 * checkout (R71 S4: a brand-new domain, not a subdomain) - never through the
 * cannabis shop, cart, POS or delivery. The cannabis site only carries a pure
 * redirect ad (merch.ad, edited on the Publish & Ads tab) with no product data.
 * Permission: content.edit (same as Creative Studio) - designers already have it.
 */
async function loadPublishData() {
  if (!isSupabaseServiceConfigured) return { adBlock: { draft: null, published: null, status: "draft", available: isSupabaseServiceConfigured }, mediaChoices: [] as MediaChoice[] };
  let block = await getContentBlock(MERCH_AD_BLOCK).catch(() => null);
  if (!block && (await ensureContentBlocksSeeded().catch(() => 0)) > 0) block = await getContentBlock(MERCH_AD_BLOCK).catch(() => null);
  const media = await listMedia({ status: "published", limit: 200 }).catch(() => []);
  const mediaChoices: MediaChoice[] = media
    .filter((m) => /^image\//.test(m.mime_type ?? "") && m.public_url)
    .map((m) => ({ id: m.id, url: m.public_url as string, title: m.title ?? m.filename ?? "Image", usageType: m.usage_type ?? null, mimeType: m.mime_type ?? null }));
  return { adBlock: { draft: block?.draft_value ?? null, published: block?.published_value ?? null, status: block?.status ?? "draft", available: !!block }, mediaChoices };
}

export default async function MerchStudioPage({ searchParams }: { searchParams: Promise<{ tab?: string; saved?: string; published?: string; warning_error?: string }> }) {
  await requirePermission("content.edit");
  const sp = await searchParams;
  const initialTab = STUDIO_TAB_IDS.find((t) => t === sp.tab) as StudioTab | undefined;
  // Tabs switch client-side without a reload, so the Publish data is always
  // loaded (one content-block read + the same media list other editors use).
  const publish = await loadPublishData();
  const flash = sp.warning_error ? { tone: "bad" as const, text: String(sp.warning_error).slice(0, 300) } : sp.published ? { tone: "ok" as const, text: "Published - the Greenway Goods ad on the website now matches this." } : sp.saved ? { tone: "ok" as const, text: "Draft saved. Nothing changed on the website yet." } : null;
  return (
    <div>
      <AdminPageHeader
        title="Merch Studio"
        subtitle="Design premium apparel, check it like a pro printer would, and see exactly how each sale gets made and shipped - one at a time, no inventory."
        breadcrumbs={<Breadcrumbs items={[{ label: "MKTG & ADV" }, { label: "Merch Studio" }]} />}
      />
      <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 p-3 text-sm text-white/85">
        <b className="text-white">Sold by Greenway Glass & Goods.</b> Everything designed here is sold by <b>Greenway Merchandising LLC (dba Greenway Glass & Goods)</b> on its own separate website (its own domain, cart and Stripe card checkout). The cannabis website only shows a redirect ad with no product details, and apparel is never rung up on the cannabis POS or delivered by cannabis delivery. Confirm this structure with your attorney before launch.
      </div>
      {flash ? (
        <p role="status" className={`mb-4 rounded-[var(--admin-radius)] border p-3 text-sm ${flash.tone === "ok" ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-white/90" : "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10 text-white/90"}`}>{flash.text}</p>
      ) : null}
      <HelpPanel
        id="merch-studio"
        title="How the Merch Studio works"
        steps={[
          "Garments: pick a premium blank (Comfort Colors, Independent, Bella+Canvas, Yupoong, Richardson) and a colour. Every placement shows its real print size, methods and Printful price.",
          "Design: pick a placement pill, add text, icons, shapes or your own art, and drag it on a true-to-inch canvas. The green dashed box is the exact printable area. Arrows nudge 1/16 inch (Shift = 1/4 inch), Ctrl+Z / Ctrl+Shift+Z undo and redo, Ctrl+D duplicates, Alt-drag skips snapping. Checks run live, and Preview shows every side in every colour.",
          "Proof & Export: pick a saved design to see every print file exactly as Printful receives it (trimmed, transparent, true inches, DPI, distance from the collar or brim). Download the ZIP (300-DPI sRGB PNGs + README + proof sheet + design backup), open the printable proof sheet, generate Printful photo mockups once Printful is connected, and tick off the sample checklist when your sample arrives.",
          "Artwork Check: drop in any file to see if it will print sharp on this garment, placement and method.",
          "Fulfillment & Pricing: see the just-in-time pipeline (Printful makes and ships one item per sale) and your profit per unit after Printful and card fees.",
          "Publish & Ads: (A) turn on the Greenway Goods ad on the cannabis website - one link to the separate merch website, your words and pictures, never prices or product details - draft, preview, publish. (B) download a design's listing package (colours, sizes, Printful variants, retail prices, print positions) for the separate merch website to import.",
        ]}
      />
      <MerchStudio initialTab={initialTab ?? (sp.saved || sp.published || sp.warning_error ? "publish" : undefined)} publish={publish} />
    </div>
  );
}
