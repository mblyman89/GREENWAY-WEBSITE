"use server";

/**
 * R71 S4 - Merch Studio -> Publish & Ads: draft / publish the Greenway Goods
 * redirect ad (ONE content block, merch.ad). Same pattern as the Brand hub
 * (kitAction): content.edit permission, scope-guarded to the one key, the
 * JSON is re-normalized server-side, every write is audited, and the normal
 * draft -> publish + revision machinery protects it.
 *
 * Publishing is REFUSED while the ad is switched on and has a blocker (no or
 * invalid https address on the separate domain, a price, cart/checkout or SKU
 * wording). The public render (resolveMerchAd) enforces the same rules again,
 * so even a hand-edited row can never put product data on the cannabis site.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getContentBlock, saveContentDraft, publishContentBlock, ensureContentBlocksSeeded } from "@/lib/cms/content-store";
import { MERCH_AD_BLOCK, merchAdIssues, parseMerchAd, serializeMerchAd } from "@/lib/merch/merch-ad-core";

const BACK = "/admin/merch-studio?tab=publish";

async function adAction(formData: FormData, publish: boolean): Promise<void> {
  const session = await requirePermission("content.edit");
  if (String(formData.get("block_key") ?? "") !== MERCH_AD_BLOCK) redirect(BACK);
  let block = await getContentBlock(MERCH_AD_BLOCK);
  if (!block && (await ensureContentBlocksSeeded()) > 0) block = await getContentBlock(MERCH_AD_BLOCK);
  if (!block) redirect(`${BACK}&warning_error=${encodeURIComponent("The Greenway Goods ad isn't set up yet - reload the page.")}`);

  // Always store the re-normalized form of what the editor sent.
  const clean = serializeMerchAd(parseMerchAd(String(formData.get("draft_value") ?? "")));
  if (publish) {
    // Publish exactly what is in the editor: save it as the draft first, so the
    // published value can never differ from what the owner was looking at.
    const blockers = merchAdIssues(parseMerchAd(clean)).filter((i) => i.level === "blocker");
    if (parseMerchAd(clean).enabled && blockers.length) {
      redirect(`${BACK}&warning_error=${encodeURIComponent(`Not published: ${blockers[0].text}`)}`);
    }
    if (clean !== (block.draft_value ?? "")) await saveContentDraft(MERCH_AD_BLOCK, clean, session.userId);
    await publishContentBlock(MERCH_AD_BLOCK, session.userId, { actorEmail: session.email, note: "Merch Studio: Greenway Goods ad" });
  } else {
    await saveContentDraft(MERCH_AD_BLOCK, clean, session.userId);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: publish ? "content.publish" : "content.draft",
    entityType: "content_block",
    entityId: MERCH_AD_BLOCK,
    before: publish ? { published_value: block.published_value } : { draft_value: block.draft_value },
  });
  revalidatePath("/admin/merch-studio");
  // The ad renders inside ShopPage: /menu and every prerendered
  // /menu/[category] page (revalidate 60). Same path + pattern calls as
  // revalidatePublicMenuSurfaces, without touching the menu DATA cache.
  if (publish) {
    revalidatePath("/menu");
    revalidatePath("/menu/[category]", "page");
  }
  redirect(`${BACK}&${publish ? "published=1" : "saved=1"}`);
}

export async function saveMerchAdDraftAction(formData: FormData): Promise<void> {
  await adAction(formData, false);
}
export async function publishMerchAdAction(formData: FormData): Promise<void> {
  await adAction(formData, true);
}
