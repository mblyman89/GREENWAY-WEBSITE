"use server";

/**
 * Server actions for the Specials presentation editor (Website → Specials).
 *
 * Thin wrappers around the SAME content-block store used by Site Content
 * (draft → publish → revision/restore), so the /specials presentation settings
 * inherit the identical, battle-tested safety machinery. The only difference
 * from the generic content actions is that these redirect back to
 * /admin/specials and revalidate the public /specials route.
 *
 * The presentation is ONE "richjson" block (specials.deals.presentation) whose
 * value is a JSON settings document (see specials-presentation-core.ts). The
 * editor serializes its state into `draft_value` before calling
 * saveSpecialsDraftAction, so no special server-side parsing is needed here — a
 * draft is just text, exactly like every other block.
 *
 * IMPORTANT: these actions govern PRESENTATION ONLY. They never touch discount
 * math — pricing and offers live in the promotions engine (/admin/promotions).
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

export const SPECIALS_PRESENTATION_BLOCK = "specials.deals.presentation";

function backTo(flag: string): string {
  return `/admin/specials?${flag}=1`;
}

export async function saveSpecialsDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? SPECIALS_PRESENTATION_BLOCK);
  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/specials");

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
  revalidatePath("/admin/specials");
  redirect(backTo("saved"));
}

export async function publishSpecialsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? SPECIALS_PRESENTATION_BLOCK);
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/specials");

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

  revalidatePath("/admin/specials");
  revalidatePath("/specials");
  // Safety net (shared chrome / force-dynamic pages), matching Site Content.
  revalidatePath("/", "layout");
  redirect(backTo("published"));
}

export async function restoreSpecialsRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/specials");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result) redirect("/admin/specials?error=restore");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.restore",
    entityType: "content_block",
    entityId: result.blockKey,
    after: { restored_from_revision: revisionId },
  });
  revalidatePath("/admin/specials");
  redirect(backTo("restored"));
}
