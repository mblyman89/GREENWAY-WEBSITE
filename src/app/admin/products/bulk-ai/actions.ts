"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys } from "@/lib/enrichment/store";
import { ensureEnrichment, updateEnrichment } from "@/lib/enrichment/store";
import {
  generateProductDescription,
  getSuggestion,
  reviewSuggestion,
  type ProductFacts,
} from "@/lib/ai/suggestions";
import { isAiConfigured } from "@/lib/ai/provider";

/**
 * Bulk AI: generate draft DESCRIPTIONS for a set of selected products in one
 * action. Each generated value is persisted as a pending ai_suggestion (the
 * same drafts-only gate as single-product AI) for review/accept on the bulk
 * grid. Nothing is applied to the public product until a human accepts it.
 */
export async function bulkGenerateDescriptionsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  if (!isAiConfigured) {
    redirect("/admin/products/bulk-ai?error=" + encodeURIComponent("AI is not configured."));
  }

  const keys = formData.getAll("keys").map((k) => String(k)).filter(Boolean);
  if (keys.length === 0) {
    redirect("/admin/products/bulk-ai?error=" + encodeURIComponent("Select at least one product."));
  }
  // Cap per batch to keep it responsive and cost-bounded.
  const batch = keys.slice(0, 25);

  const published = await getPublishedVersion();
  if (!published) redirect("/admin/products/bulk-ai");
  const items = await getVersionItems(published!.id);
  const byKey = new Map(items.map((i) => [i.source_item_id, i]));

  let generated = 0;
  let failed = 0;
  for (const key of batch) {
    const item = byKey.get(key);
    if (!item) continue;
    const facts: ProductFacts = {
      name: item.name,
      brand: item.brand_name || null,
      category: item.category || null,
      strainType: item.strain_type || null,
      strainName: item.strain_name ?? null,
      thc: item.thc ?? null,
      cbd: item.cbd ?? null,
    };
    try {
      await generateProductDescription(key, facts, session.userId);
      generated += 1;
    } catch {
      failed += 1;
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.bulk_ai_generated",
    entityType: "product",
    after: { requested: batch.length, generated, failed },
  });

  revalidatePath("/admin/products/bulk-ai");
  redirect(`/admin/products/bulk-ai?generated=${generated}&failed=${failed}#review`);
}

/** Accept one pending description suggestion from the bulk grid. */
export async function bulkAcceptSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  const sugg = await getSuggestion(id);
  if (!sugg || !key) redirect("/admin/products/bulk-ai");

  await ensureEnrichment(key, {}, session.userId);
  if (sugg!.field_key === "description") {
    await updateEnrichment(key, { description: sugg!.suggested_value }, session.userId);
  }
  await reviewSuggestion(id, "accepted", session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.bulk_ai_accepted",
    entityType: "product",
    entityId: key,
    after: { suggestionId: id },
  });

  revalidatePath("/admin/products/bulk-ai");
  redirect("/admin/products/bulk-ai?accepted=1#review");
}

/** Reject one pending suggestion from the bulk grid. */
export async function bulkRejectSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  if (id) await reviewSuggestion(id, "rejected", session.userId);
  revalidatePath("/admin/products/bulk-ai");
  redirect("/admin/products/bulk-ai#review");
}
