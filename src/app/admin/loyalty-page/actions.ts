"use server";

/**
 * Server actions for the Loyalty page editor (Website → Loyalty page), SLICE 108.
 *
 * Thin wrappers around the SAME content-block store used by Site Content
 * (draft → publish → revision/restore), so the Loyalty page's friendly copy
 * inherits the identical, battle-tested safety machinery. The only differences
 * from the generic content actions are that these redirect back to
 * /admin/loyalty-page and revalidate the public /loyalty route.
 *
 * SCOPE GUARD: these actions only accept the Loyalty page's curated copy blocks
 * (defined in the pure core @/lib/loyalty/loyalty-content-core). A form that
 * posts any other block_key is rejected — the generic Site Content editor
 * handles everything else, and the LEGAL consent text + LIVE register
 * numbers/tiers are never content blocks at all.
 *
 * SLICE 106 LESSON: a "use server" module may ONLY export async functions, so
 * every block-key constant / helper lives in the plain pure core, NOT here.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  getContentBlock,
  saveContentDraft,
  publishContentBlock,
  restoreContentRevisionToDraft,
} from "@/lib/cms/content-store";
import { isLoyaltyContentBlock } from "@/lib/loyalty/loyalty-content-core";
import { LOYALTY_HERO_PRESENTATION_BLOCK } from "@/lib/loyalty/loyalty-hero-core";

function backTo(flag: string): string {
  return `/admin/loyalty-page?${flag}=1`;
}

export async function saveLoyaltyDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isLoyaltyContentBlock(blockKey)) redirect("/admin/loyalty-page");

  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/loyalty-page");

  await saveContentDraft(blockKey, draftValue, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.draft",
    entityType: "content_block",
    entityId: blockKey,
    before: { draft_value: block.draft_value },
    after: { draft_value: draftValue },
  });
  revalidatePath("/admin/loyalty-page");
  redirect(backTo("saved"));
}

export async function publishLoyaltyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isLoyaltyContentBlock(blockKey)) redirect("/admin/loyalty-page");

  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/loyalty-page");

  await publishContentBlock(blockKey, session.userId, { actorEmail: session.email });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.publish",
    entityType: "content_block",
    entityId: blockKey,
    before: { published_value: block.published_value },
    after: { published_value: block.draft_value ?? block.published_value },
  });

  revalidatePath("/admin/loyalty-page");
  revalidatePath("/loyalty");
  redirect(backTo("published"));
}

export async function restoreLoyaltyRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/loyalty-page");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result || !isLoyaltyContentBlock(result.blockKey)) {
    redirect("/admin/loyalty-page?error=restore");
    return;
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.restore",
    entityType: "content_block",
    entityId: result.blockKey,
    after: { restored_from_revision: revisionId },
  });
  revalidatePath("/admin/loyalty-page");
  redirect(backTo("restored"));
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 123 (LOY-1): Hero BANNER actions. The hero is ONE "richjson" block
// (loyalty.hero.presentation) that holds the image + overlay text styling. It is
// NOT one of the friendly-copy blocks, so it needs its own scope guard (the copy
// actions above reject anything that isn't a loyalty CONTENT block). These reuse
// the same draft → publish → revision/restore machinery and revalidate /loyalty.
// ─────────────────────────────────────────────────────────────────────────────

function isLoyaltyHeroBlock(key: string): boolean {
  return key === LOYALTY_HERO_PRESENTATION_BLOCK;
}

export async function saveLoyaltyHeroDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? LOYALTY_HERO_PRESENTATION_BLOCK);
  if (!isLoyaltyHeroBlock(blockKey)) redirect("/admin/loyalty-page");

  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/loyalty-page");

  await saveContentDraft(blockKey, draftValue, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.draft",
    entityType: "content_block",
    entityId: blockKey,
    before: { draft_value: block.draft_value },
    after: { draft_value: draftValue },
  });
  revalidatePath("/admin/loyalty-page");
  redirect(backTo("saved"));
}

export async function publishLoyaltyHeroAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? LOYALTY_HERO_PRESENTATION_BLOCK);
  if (!isLoyaltyHeroBlock(blockKey)) redirect("/admin/loyalty-page");

  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/loyalty-page");

  await publishContentBlock(blockKey, session.userId, { actorEmail: session.email });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.publish",
    entityType: "content_block",
    entityId: blockKey,
    before: { published_value: block.published_value },
    after: { published_value: block.draft_value ?? block.published_value },
  });

  revalidatePath("/admin/loyalty-page");
  revalidatePath("/loyalty");
  // Safety net (shared chrome / force-dynamic pages), matching Site Content.
  revalidatePath("/", "layout");
  redirect(backTo("published"));
}

export async function restoreLoyaltyHeroRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/loyalty-page");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result || !isLoyaltyHeroBlock(result.blockKey)) {
    redirect("/admin/loyalty-page?error=restore");
    return;
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.restore",
    entityType: "content_block",
    entityId: result.blockKey,
    after: { restored_from_revision: revisionId },
  });
  revalidatePath("/admin/loyalty-page");
  redirect(backTo("restored"));
}
