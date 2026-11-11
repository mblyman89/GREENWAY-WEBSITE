import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { MerchStudio } from "@/components/admin/merch-studio/MerchStudio";
import { studioTabFrom } from "@/lib/merch-studio/studio-tabs-core";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { getContentBlock, ensureContentBlocksSeeded } from "@/lib/cms/content-store";
import { listMedia } from "@/lib/media/store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_AD_BLOCK } from "@/lib/merch/merch-ad-core";
import type { JourneyServer } from "@/components/admin/merch-studio/JourneyBar";

export const dynamic = "force-dynamic";

/**
 * R70 - Merch Studio. Designs apparel that is SOLD by Greenway Merchandising
 * LLC (dba Greenway Glass & Goods) on its OWN separate website + Stripe
 * checkout (R71 S4: a brand-new domain, not a subdomain) - never through the
 * cannabis shop, cart, POS or delivery. The cannabis site only carries a pure
 * redirect ad (merch.ad, edited on the Publish & Ads tab) with no product data.
 * Permission: content.edit (same as Creative Studio) - designers already have it.
 */
async function loadSetupBanner(): Promise<{ tone: "bad" | "warn"; text: string } | null> {
  const [{ latestMerchHealthReport }, { readLaunchProgress }, core] = await Promise.all([
    import("@/lib/merch/merch-health-server"),
    import("@/lib/merch/merch-launch-server"),
    import("@/lib/merch/merch-launch-core"),
  ]);
  const [last, prog] = await Promise.all([latestMerchHealthReport().catch(() => ({ report: null, error: null })), readLaunchProgress().catch(() => null)]);
  if (!prog || prog.error) return null;
  const sum = core.summarizeLaunch(last.report, prog.progress);
  if (sum.needsYou) return { tone: "bad", text: `Setup needs you: ${core.stepNumber(sum.needsYou.step.id)} · ${sum.needsYou.step.title}. ${sum.needsYou.why}` };
  if (sum.next) return { tone: "warn", text: `Setup: ${core.progressLine(sum)}. Next: ${core.stepNumber(sum.next.step.id)} · ${sum.next.step.title}.` };
  return null;
}

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

/** D232 M-3b: what the Product journey needs from the server (one catalog read + the last saved health run, no live calls). */
async function loadJourney(): Promise<JourneyServer> {
  const [{ readMerchCatalog }, { latestMerchHealthReport }] = await Promise.all([
    import("@/lib/merch/merch-inventory-store"),
    import("@/lib/merch/merch-health-server"),
  ]);
  const [cat, report] = await Promise.all([readMerchCatalog().catch(() => null), latestMerchHealthReport().catch(() => null)]);
  const published = (cat?.catalog.items ?? []).map((i) => ({
    designId: i.pkg.designId,
    handle: i.handle,
    status: i.status,
    images: i.images.length,
    stockSyncedAt: i.stockSyncedAt,
    minRetailCents: i.pkg.variants.length ? Math.min(...i.pkg.variants.map((v) => v.retailCents)) : 0,
  }));
  const h7 = report?.report?.checks.find((c) => c.id === "H-7")?.level;
  return { published, shopOk: h7 === "ok" ? true : h7 === "fail" || h7 === "warn" ? false : null };
}

export default async function MerchStudioPage({ searchParams }: { searchParams: Promise<{ tab?: string; saved?: string; published?: string; warning_error?: string }> }) {
  const session = await requirePermission("content.edit");
  const sp = await searchParams;
  // Plain module, NOT the "use client" MerchStudio file (calling a client
  // export on the server threw and broke the whole page).
  const initialTab = studioTabFrom(sp.tab);
  // Tabs switch client-side without a reload, so the Publish data is always
  // loaded (one content-block read + the same media list other editors use).
  const publish = { ...(await loadPublishData()), canPublish: can(session.profile.role, "merch.publish") };
  // D232 M-3a: "Setup needs you: Step n" from the LAST SAVED Merch Health run
  // (no live calls here, so the Studio stays fast). Owner & admin only.
  const isOwnerAdmin = can(session.profile.role, "settings.manage");
  const setup = isOwnerAdmin ? await loadSetupBanner() : null;
  const journey = await loadJourney().catch((): JourneyServer => ({ published: [], shopOk: null }));
  const flash = sp.warning_error ? { tone: "bad" as const, text: String(sp.warning_error).slice(0, 300) } : sp.published ? { tone: "ok" as const, text: "Published - the Greenway Goods ad on the website now matches this." } : sp.saved ? { tone: "ok" as const, text: "Draft saved. Nothing changed on the website yet." } : null;
  return (
    <div>
      <AdminPageHeader
        title="Merch Studio"
        subtitle="Design premium apparel, check it like a pro printer would, and see exactly how each sale gets made and shipped - one at a time, no inventory."
        breadcrumbs={<Breadcrumbs items={[{ label: "MKTG & ADV" }, { label: "Merch Studio" }]} />}
        helpId="merch-studio"
        action={
          isOwnerAdmin ? (
            // D232 M-2: Merch Health (owner & admin), H-1..H-19 with the fix for each. M-3a: Setup & Launch.
            <span className="flex flex-wrap gap-2">
              <Link href="/admin/merch-studio/launch" className="rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-sm text-white/90 hover:bg-white/5">
                Setup & Launch
              </Link>
              <Link href="/admin/merch-studio/health" className="rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-sm text-white/90 hover:bg-white/5">
                Merch Health
              </Link>
            </span>
          ) : undefined
        }
      />
      <p className="mx-5 mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 px-3 py-1.5 text-xs text-white/85 sm:mx-8">
        <b className="text-white">Sold by Greenway Glass & Goods</b> (Greenway Merchandising LLC) on its own website and Stripe checkout - never on the cannabis POS or delivery.{" "}
        <Link href="/admin/helpers#merch-studio" className="text-[var(--admin-accent)] hover:underline">Details</Link>
      </p>
      {setup ? (
        <p role="status" className={`mx-5 mt-3 rounded-[var(--admin-radius)] border px-3 py-1.5 text-xs text-white/90 sm:mx-8 ${setup.tone === "bad" ? "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10" : "border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10"}`}>
          {setup.text}{" "}
          <Link href="/admin/merch-studio/launch" className="text-[var(--admin-accent)] hover:underline">Open Setup & Launch</Link>
        </p>
      ) : null}
      {flash ? (
        <p role="status" className={`mb-4 rounded-[var(--admin-radius)] border p-3 text-sm ${flash.tone === "ok" ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-white/90" : "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10 text-white/90"}`}>{flash.text}</p>
      ) : null}
      <MerchStudio initialTab={initialTab ?? (sp.saved || sp.published || sp.warning_error ? "publish" : undefined)} publish={publish} journey={journey} />
    </div>
  );
}
