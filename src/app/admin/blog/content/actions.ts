"use server";

/**
 * Server actions for the Blog page-wording editor (Blog & Newsletter → Blog
 * wording), MIG-6 Slice 1.
 *
 * Thin wrappers around the SAME content-block store used by Site Content and
 * the Medical page editor (draft → publish → revision/restore), so the blog
 * page CHROME inherits the identical, battle-tested safety machinery. The only
 * differences from the generic content actions are that these redirect back to
 * /admin/blog/content and revalidate the public /blog routes.
 *
 * SCOPE GUARD: these actions only accept the 7 curated blog.* page-chrome
 * blocks (isBlogContentBlock). A form that posts any other block_key is
 * rejected — Site Content and the other dedicated editors own everything else.
 * They NEVER touch blog POSTS (those are managed under /admin/blog).
 *
 * LESSON (SLICE 106): a "use server" module may ONLY export async functions, so
 * every block-key predicate lives in the pure core
 * (@/lib/blog/blog-content-core), NOT here.
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
import { isBlogContentBlock } from "@/lib/blog/blog-content-core";

function backTo(flag: string): string {
  return `/admin/blog/content?${flag}=1`;
}

export async function saveBlogCopyDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isBlogContentBlock(blockKey)) redirect("/admin/blog/content");

  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/blog/content");

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
  revalidatePath("/admin/blog/content");
  redirect(backTo("saved"));
}

export async function publishBlogCopyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  if (!isBlogContentBlock(blockKey)) redirect("/admin/blog/content");

  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/blog/content");

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

  revalidatePath("/admin/blog/content");
  // The chrome appears on both the blog list and every article detail page.
  revalidatePath("/blog");
  revalidatePath("/blog/[slug]", "page");
  redirect(backTo("published"));
}

export async function restoreBlogCopyRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/blog/content");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result || !isBlogContentBlock(result.blockKey)) {
    redirect("/admin/blog/content?error=restore");
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
  revalidatePath("/admin/blog/content");
  redirect(backTo("restored"));
}
