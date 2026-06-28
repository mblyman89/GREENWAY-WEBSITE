"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  saveContentDraft,
  publishContentBlock,
  getContentBlock,
  ensureContentBlocksSeeded,
  upsertSeoEntry,
} from "@/lib/cms/content-store";
import {
  generateContentSuggestion,
  isAiConfigured,
} from "@/lib/cms/ai-content";

export type AiSuggestResult =
  | { ok: true; value: string; complianceFlags: string[]; model: string }
  | { ok: false; error: string };

/**
 * Generate an AI DRAFT suggestion for a single content block. Returns the
 * suggestion to the client for Accept / Edit / Reject — it never writes the
 * draft or publishes. Drafts-only, same gate as menu + blog AI.
 */
export async function suggestContentAction(
  blockKey: string,
  instruction: string,
): Promise<AiSuggestResult> {
  const session = await requirePermission("content.edit");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable “Write with AI.”",
    };
  }

  const block = await getContentBlock(blockKey);
  if (!block) return { ok: false, error: "That content block no longer exists." };

  try {
    const suggestion = await generateContentSuggestion({
      blockKey: block.block_key,
      label: block.label,
      fieldType: block.field_type,
      seoImpact: block.seo_impact,
      current: block.draft_value ?? block.published_value ?? null,
      instruction: instruction.trim() || null,
    });

    // Provenance only — the suggestion is NOT saved; staff must Accept first.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "content.ai_suggest",
      entityType: "content_block",
      entityId: block.block_key,
      after: { model: suggestion.model, flags: suggestion.complianceFlags },
    });

    return {
      ok: true,
      value: suggestion.value,
      complianceFlags: suggestion.complianceFlags,
      model: suggestion.model,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}

/** Lazily seed the controlled block set (idempotent) — used on first visit. */
export async function seedContentBlocksAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const inserted = await ensureContentBlocksSeeded();
  if (inserted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "content.seed",
      entityType: "content_block",
      after: { inserted },
    });
  }
  revalidatePath("/admin/content");
  redirect("/admin/content?seeded=1");
}

export async function saveContentDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  const draftValue = String(formData.get("draft_value") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/content");

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
  revalidatePath("/admin/content");
  redirect("/admin/content?saved=1");
}

export async function publishContentBlockAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const blockKey = String(formData.get("block_key") ?? "");
  const block = await getContentBlock(blockKey);
  if (!block) redirect("/admin/content");

  await publishContentBlock(blockKey, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "content.publish",
    entityType: "content_block",
    entityId: blockKey,
    before: { published_value: block.published_value },
    after: { published_value: block.draft_value ?? block.published_value },
  });

  // Revalidate the affected public page heuristically.
  revalidatePath("/admin/content");
  revalidatePath("/");
  if (block.page === "menu") revalidatePath("/menu");
  if (block.page === "loyalty") revalidatePath("/loyalty");
  if (block.page === "vendors") revalidatePath("/vendors");
  if (block.page === "specials") revalidatePath("/specials");
  redirect("/admin/content?published=1");
}

export async function saveSeoEntryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const path = String(formData.get("path") ?? "").trim();
  if (!path.startsWith("/")) redirect("/admin/content/seo?error=path");

  await upsertSeoEntry({
    path,
    seo_title: String(formData.get("seo_title") ?? "").trim() || null,
    seo_description: String(formData.get("seo_description") ?? "").trim() || null,
    canonical: String(formData.get("canonical") ?? "").trim() || null,
    noindex: formData.get("noindex") === "on",
    sitemap_include: formData.get("sitemap_include") === "on",
    updatedBy: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "seo.upsert",
    entityType: "seo_entry",
    entityId: path,
  });
  revalidatePath("/admin/content/seo");
  revalidatePath(path);
  redirect("/admin/content/seo?saved=1");
}
