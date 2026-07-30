"use server";

/**
 * Server actions for the Legal Policies editor (Website → Legal Policies).
 *
 * These are thin wrappers around the SAME content-block store used by Site
 * Content (draft → publish → revision/restore), so legal-policy bodies inherit
 * the identical, battle-tested safety machinery. The only difference from the
 * generic content actions is that these redirect back to /admin/legal-policies
 * (with the correct tab) and revalidate the specific legal route.
 *
 * The body of each policy is ONE "richdoc" block whose value is a JSON document
 * (see policy-doc-core.ts). The editor serializes its rows into `draft_value`
 * before calling saveLegalDraftAction, so no special server-side parsing is
 * needed here — a draft is just text, exactly like every other block.
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
import { POLICY_DOCS } from "@/lib/cms/policy-doc-core";

// page (content_blocks.page) → public route to revalidate on publish.
const LEGAL_PAGE_TO_PATH: Record<string, string> = {
  "legal-privacy": "/privacy-policy",
  "legal-terms": "/terms-of-use",
  "legal-chd": "/consumer-health-data",
};

// docKey → tab query so we return the editor to the right tab.
const DOC_KEY_TO_TAB: Record<string, string> = Object.fromEntries(
  Object.values(POLICY_DOCS).map((d) => [d.docKey, d.policyId]),
);

function tabFor(blockKey: string): string {
  // Body docs map directly; hero blocks map by their key prefix.
  if (DOC_KEY_TO_TAB[blockKey]) return DOC_KEY_TO_TAB[blockKey];
  if (blockKey.startsWith("privacy.")) return "privacy-policy";
  if (blockKey.startsWith("terms.")) return "terms-of-use";
  if (blockKey.startsWith("chd.")) return "consumer-health-data";
  return "privacy-policy";
}

function backTo(blockKey: string, flag: string): string {
  return `/admin/legal-policies?tab=${tabFor(blockKey)}&${flag}=1`;
}

export async function saveLegalDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/legal-policies");

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
  revalidatePath("/admin/legal-policies");
  redirect(backTo(blockKey, "saved"));
}

export async function publishLegalAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/legal-policies");

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

  revalidatePath("/admin/legal-policies");
  const path = LEGAL_PAGE_TO_PATH[block.page];
  if (path) revalidatePath(path);
  // Safety net (shared chrome / force-dynamic pages), matching Site Content.
  revalidatePath("/", "layout");
  redirect(backTo(blockKey, "published"));
}

export async function restoreLegalRevisionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const revisionId = String(formData.get("revision_id") ?? "");
  if (!revisionId) redirect("/admin/legal-policies");

  const result = await restoreContentRevisionToDraft(revisionId, session.userId);
  if (!result) redirect("/admin/legal-policies?error=restore");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.restore",
    entityType: "content_block",
    entityId: result.blockKey,
    after: { restored_from_revision: revisionId },
  });
  revalidatePath("/admin/legal-policies");
  redirect(backTo(result.blockKey, "restored"));
}
