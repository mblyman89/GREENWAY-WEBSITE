"use server";

/**
 * R64 — Brand hub actions. The kit is ONE content block (brand.kit), so the
 * same draft → publish + revision machinery protects it. Scope-guarded to the
 * one key; the JSON is re-normalized server-side before it is stored.
 *
 * listBrandBannersAction / saveBrandBannerAction power "Saved brand banners"
 * inside every Design Studio editor: the owner can save the design they're
 * working on to the brand kit (straight to the draft AND live library — it's
 * a library, not page content) and start any banner from a saved one.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getContentBlock, saveContentDraft, publishContentBlock, ensureContentBlocksSeeded } from "@/lib/cms/content-store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeDesign } from "@/lib/cms/banner-design-core";
import {
  BRAND_KIT_BLOCK,
  BRAND_MAX_BANNERS,
  parseBrandKit,
  safeBrandSrc,
  serializeBrandKit,
  type BrandSaved,
} from "@/lib/brand/brand-kit-core";

const BACK = "/admin/settings/branding";

function backWith(formData: FormData, flag: string): string {
  const tab = String(formData.get("tab") ?? "");
  return `${BACK}?${/^[a-z]{2,12}$/.test(tab) ? `tab=${tab}&` : ""}${flag}`;
}

async function kitAction(formData: FormData, publish: boolean): Promise<void> {
  const session = await requirePermission("content.edit");
  if (String(formData.get("block_key") ?? "") !== BRAND_KIT_BLOCK) redirect(BACK);
  let block = await getContentBlock(BRAND_KIT_BLOCK);
  if (!block && (await ensureContentBlocksSeeded()) > 0) block = await getContentBlock(BRAND_KIT_BLOCK);
  if (!block) redirect(`${BACK}?warning_error=${encodeURIComponent("The brand kit isn't set up yet — reload the page.")}`);
  if (publish) {
    await publishContentBlock(BRAND_KIT_BLOCK, session.userId, { actorEmail: session.email });
  } else {
    const clean = serializeBrandKit(parseBrandKit(String(formData.get("draft_value") ?? "")));
    await saveContentDraft(BRAND_KIT_BLOCK, clean, session.userId);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: publish ? "content.publish" : "content.draft",
    entityType: "content_block",
    entityId: BRAND_KIT_BLOCK,
    before: publish ? { published_value: block.published_value } : { draft_value: block.draft_value },
  });
  revalidatePath(BACK);
  // Colours + the header logo apply to every page.
  if (publish) revalidatePath("/(site)", "layout") /* PERF-S6: public site only, not /admin */;
  redirect(backWith(formData, publish ? "published=1" : "saved=1"));
}

export async function saveBrandKitDraftAction(formData: FormData): Promise<void> {
  await kitAction(formData, false);
}
export async function publishBrandKitAction(formData: FormData): Promise<void> {
  await kitAction(formData, true);
}

/** Saved brand banners for the Design Studio pickers (draft-first). */
export async function listBrandBannersAction(): Promise<BrandSaved[]> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return [];
  const block = await getContentBlock(BRAND_KIT_BLOCK);
  return parseBrandKit(block?.draft_value || block?.published_value).banners;
}

/**
 * Add the design the owner is working on to the saved brand banners. Written
 * to BOTH draft and published (it's a reusable library entry, not something a
 * visitor sees); any other unpublished kit edits in the draft are kept as-is.
 */
export async function saveBrandBannerAction(input: { name: string; image: string; design: unknown }): Promise<{ ok: true; banners: BrandSaved[] } | { ok: false; error: string }> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't set up on this deployment." };
  const design = normalizeDesign(input?.design);
  if (!design) return { ok: false, error: "That design couldn't be read." };
  let block = await getContentBlock(BRAND_KIT_BLOCK);
  if (!block && (await ensureContentBlocksSeeded()) > 0) block = await getContentBlock(BRAND_KIT_BLOCK);
  if (!block) return { ok: false, error: "The brand kit isn't set up yet — open Website → Branding once." };
  const entry: BrandSaved = {
    id: `b-${Date.now().toString(36)}`,
    name: String(input?.name ?? "").trim().slice(0, 80) || "Saved banner",
    image: safeBrandSrc(input?.image),
    design: { ...design, enabled: true },
  };
  const add = (raw: string | null) => {
    const kit = parseBrandKit(raw);
    if (kit.banners.length >= BRAND_MAX_BANNERS) return null;
    kit.banners = [...kit.banners, entry];
    return kit;
  };
  const draftKit = add(block.draft_value || block.published_value);
  const liveKit = add(block.published_value);
  if (!draftKit || !liveKit) return { ok: false, error: `The brand kit holds up to ${BRAND_MAX_BANNERS} saved banners. Remove one in Website → Branding first.` };
  const { error } = await createSupabaseAdminClient()
    .from("content_blocks")
    .update({ draft_value: serializeBrandKit(draftKit), published_value: serializeBrandKit(liveKit), last_edited_by: session.userId })
    .eq("block_key", BRAND_KIT_BLOCK);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "brand.banner.save",
    entityType: "content_block",
    entityId: BRAND_KIT_BLOCK,
    after: { name: entry.name },
  });
  revalidatePath(BACK);
  return { ok: true, banners: draftKit.banners };
}
