"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizeCoreValues, type CoreValue } from "@/lib/about/core-values-core";
import { saveCoreValuesDraft, publishCoreValues } from "@/lib/about/core-values-store";
import { getContentBlock, saveContentDraft, publishContentBlock } from "@/lib/cms/content-store";
import { ABOUT_SIDE_BLOCK, resolveAboutSide, serializeAboutSide } from "@/lib/about/about-side-core";

const ABOUT_ADMIN = "/admin/pages/about";

function revalidateAbout(): void {
  revalidatePath("/admin/pages/about");
  revalidatePath("/about");
}

/** Parse the JSON list of cards the editor submitted (blank-safe). */
function parseValues(raw: unknown): CoreValue[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    return normalizeCoreValues(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Save the whole DRAFT list of core-value cards (never touches live). */
export async function saveCoreValuesDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const values = parseValues(formData.get("values_json"));
  try {
    await saveCoreValuesDraft(values, session.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save your draft.";
    redirect(`${ABOUT_ADMIN}?valuesError=${encodeURIComponent(msg)}#about-core-values`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "about_values.draft",
    entityType: "about_core_values",
    entityId: "about-core-values",
    after: { count: values.length },
  });
  revalidateAbout();
  redirect(`${ABOUT_ADMIN}?valuesSaved=1#about-core-values`);
}

/** Publish the core-value cards: copy draft -> live. */
export async function publishCoreValuesAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  try {
    await publishCoreValues(session.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not publish.";
    redirect(`${ABOUT_ADMIN}?valuesError=${encodeURIComponent(msg)}#about-core-values`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "about_values.publish",
    entityType: "about_core_values",
    entityId: "about-core-values",
  });
  revalidateAbout();
  redirect(`${ABOUT_ADMIN}?valuesPublished=1#about-core-values`);
}

// R64: the About side panel (right-hand container). Scope-guarded to the ONE
// block; the draft is re-normalized server-side before it is stored.
async function sidePanelAction(formData: FormData, publish: boolean): Promise<void> {
  const session = await requirePermission("content.edit");
  if (String(formData.get("block_key") ?? "") !== ABOUT_SIDE_BLOCK) redirect(ABOUT_ADMIN);
  const block = await getContentBlock(ABOUT_SIDE_BLOCK);
  if (!block) redirect(`${ABOUT_ADMIN}?tab=side`);
  if (publish) {
    await publishContentBlock(ABOUT_SIDE_BLOCK, session.userId, { actorEmail: session.email });
  } else {
    const clean = serializeAboutSide(resolveAboutSide(String(formData.get("draft_value") ?? "")));
    await saveContentDraft(ABOUT_SIDE_BLOCK, clean, session.userId);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: publish ? "content.publish" : "content.draft",
    entityType: "content_block",
    entityId: ABOUT_SIDE_BLOCK,
    before: publish ? { published_value: block.published_value } : { draft_value: block.draft_value },
  });
  revalidateAbout();
  redirect(`${ABOUT_ADMIN}?tab=side&${publish ? "published" : "saved"}=1`);
}

export async function saveAboutSideDraftAction(formData: FormData): Promise<void> {
  await sidePanelAction(formData, false);
}

export async function publishAboutSideAction(formData: FormData): Promise<void> {
  await sidePanelAction(formData, true);
}
