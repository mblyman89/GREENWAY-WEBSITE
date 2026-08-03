"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizeCoreValues, type CoreValue } from "@/lib/about/core-values-core";
import { saveCoreValuesDraft, publishCoreValues } from "@/lib/about/core-values-store";

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
