"use server";

/**
 * Server actions for the Medical page editor (Website → Medical page), SLICE 107.
 *
 * Thin wrappers around the SAME content-block store used by Site Content
 * (draft → publish → revision/restore), so the Medical page copy + the
 * page-level "hide this page" switch inherit the identical, battle-tested
 * safety machinery. The only differences from the generic content actions are
 * that these redirect back to /admin/medical-page and revalidate the public
 * /medical route (and the shared layout so the nav link updates).
 *
 * SCOPE GUARD: these actions only accept the Medical page's own blocks (the
 * hide flag + the curated copy blocks defined in the pure core). A form that
 * posts any other block_key is rejected — the generic Site Content editor
 * handles everything else.
 *
 * SLICE 106 LESSON: a "use server" module may ONLY export async functions, so
 * every block-key constant / helper lives in the plain pure core
 * (@/lib/medical/medical-content-core), NOT here.
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
import {
  MEDICAL_HIDE_BLOCK,
  isMedicalContentBlock,
} from "@/lib/medical/medical-content-core";

/** All block keys this editor is allowed to touch. */
function isEditableMedicalBlock(blockKey: string): boolean {
  return blockKey === MEDICAL_HIDE_BLOCK || isMedicalContentBlock(blockKey);
}

function backTo(flag: string): string {
  return `/admin/medical-page?${flag}=1`;
}

export async function saveMedicalDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isEditableMedicalBlock(blockKey)) redirect("/admin/medical-page");

  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/medical-page");

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
  revalidatePath("/admin/medical-page");
  redirect(backTo("saved"));
}

export async function publishMedicalAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isEditableMedicalBlock(blockKey)) redirect("/admin/medical-page");

  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/medical-page");

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

  revalidatePath("/admin/medical-page");
  revalidatePath("/medical");
  // Publishing the hide flag changes the nav in the shared chrome, so refresh
  // the whole layout (matches Site Content / Specials).
  revalidatePath("/", "layout");
  redirect(backTo("published"));
}

export async function restoreMedicalRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/medical-page");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result || !isEditableMedicalBlock(result.blockKey)) {
    redirect("/admin/medical-page?error=restore");
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
  revalidatePath("/admin/medical-page");
  redirect(backTo("restored"));
}
