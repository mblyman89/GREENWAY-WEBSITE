import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { MerchStudio } from "@/components/admin/merch-studio/MerchStudio";
import { studioTabFrom } from "@/lib/merch-studio/studio-tabs-core";
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
  // Plain module, NOT the "use client" MerchStudio file (calling a client
  // export on the server threw and broke the whole page).
  const initialTab = studioTabFrom(sp.tab);
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
        helpId="merch-studio"
      />
      <p className="mx-5 mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 px-3 py-1.5 text-xs text-white/85 sm:mx-8">
        <b className="text-white">Sold by Greenway Glass & Goods</b> (Greenway Merchandising LLC) on its own website and Stripe checkout - never on the cannabis POS or delivery.{" "}
        <Link href="/admin/helpers#merch-studio" className="text-[var(--admin-accent)] hover:underline">Details</Link>
      </p>
      {flash ? (
        <p role="status" className={`mb-4 rounded-[var(--admin-radius)] border p-3 text-sm ${flash.tone === "ok" ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-white/90" : "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10 text-white/90"}`}>{flash.text}</p>
      ) : null}
      <MerchStudio initialTab={initialTab ?? (sp.saved || sp.published || sp.warning_error ? "publish" : undefined)} publish={publish} />
    </div>
  );
}
