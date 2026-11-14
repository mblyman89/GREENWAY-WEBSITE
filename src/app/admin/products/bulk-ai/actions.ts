"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getPublishedVersion, getVersionItems, getItemBySourceKey } from "@/lib/pos/menu-version";
import { ensureEnrichment, updateEnrichment, getEnrichment, setEnrichmentStatusForKeys, computeGaps } from "@/lib/enrichment/store";
import {
  generateProductDescription,
  getSuggestion,
  reviewSuggestion,
  type ProductFacts,
} from "@/lib/ai/suggestions";
import { isAiConfigured } from "@/lib/ai/provider";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { friendlyAiError } from "@/lib/ai/chat-payload-core";
import { planBulkStatus } from "@/lib/enrichment/bulk-publish-core";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { ACCEPT_ALL_THRESHOLD } from "@/lib/enrichment/ai-draft-v2-core";
import { BULK_AI_V2_MAX_QUEUE, type QueueRequest } from "@/lib/enrichment/bulk-ai-v2-core";
import { cancelBulkAiV2, queueBulkAiV2 } from "@/lib/enrichment/bulk-ai-v2-server";
import { acceptAllMessage, acceptHighConfidenceForKey } from "@/lib/enrichment/accept-drafts-server";

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
  // D244 E-0: keep the FIRST failure reason so the page can say WHY
  // ("Unsupported parameter: max_tokens…") instead of a bare count.
  let firstError = "";
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
    } catch (err) {
      failed += 1;
      if (!firstError) firstError = friendlyAiError(err);
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.bulk_ai_generated",
    entityType: "product",
    after: { requested: batch.length, generated, failed, firstError: firstError || null },
  });

  revalidatePath("/admin/products/bulk-ai");
  const reason = failed > 0 && firstError ? `&reason=${encodeURIComponent(firstError)}` : "";
  redirect(`/admin/products/bulk-ai?generated=${generated}&failed=${failed}${reason}#review`);
}

/** Accept one pending description suggestion from the bulk grid. */
export async function bulkAcceptSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  const sugg = await getSuggestion(id);
  if (!sugg || !key) redirect("/admin/products/bulk-ai");

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(sugg!);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product.bulk_ai_accept_blocked",
      entityType: "product",
      entityId: key,
      after: { suggestionId: id, ...gate.audit },
    });
    redirect("/admin/products/bulk-ai?error=" + encodeURIComponent(gate.message) + "#review");
  }

  await ensureEnrichment(key, {}, session.userId);
  if (sugg!.field_key === "description") {
    await updateEnrichment(key, { description: sugg!.suggested_value }, session.userId);
  }
  await reviewSuggestion(id, "accepted", session.userId);

  // Promote the newly-validated fact(s) into the KB (drafts-only, best-effort).
  const writeback = await writeBackOnPublish(key, session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.bulk_ai_accepted",
    entityType: "product",
    entityId: key,
    after: { suggestionId: id, kb_writeback: writeback ?? undefined, ...gate.audit },
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

// ---------------------------------------------------------------------------
// D244 E-5 - Bulk AI v2. "Draft with AI" QUEUES products; the every-minute
// worker drafts every field for each (the product page's all-fields call),
// so a whole vendor finishes after the tab is closed. The review grid accepts
// per product (>= ACCEPT_ALL_THRESHOLD, never a best guess, every field
// through the compliance gate) and "Accept & publish" is still a person's
// click that publishes only a draft that has a photo.
// ---------------------------------------------------------------------------

const BULK_URL = "/admin/products/bulk-ai";

/** Keep the grid's filters (vendor / min) on the way back. */
function gridUrl(formData: FormData, flash: string, hash = "#review"): string {
  const q = new URLSearchParams();
  const vendor = String(formData.get("vendor_filter") ?? "").trim();
  const min = String(formData.get("min") ?? "").trim();
  if (vendor) q.set("vendor", vendor);
  if (min) q.set("min", min);
  const base = [q.toString(), flash].filter(Boolean).join("&");
  return `${BULK_URL}${base ? `?${base}` : ""}${hash}`;
}

/** Queue the ticked products, or every live product from one vendor. */
export async function queueBulkAiV2Action(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  if (!isAiConfigured) redirect(`${BULK_URL}?error=` + encodeURIComponent("AI is not configured.") + "#queue");
  const ticked = new Set(formData.getAll("keys").map((k) => String(k).trim()).filter(Boolean));
  const vendor = String(formData.get("vendor") ?? "").trim();
  if (ticked.size === 0 && !vendor) {
    redirect(`${BULK_URL}?error=` + encodeURIComponent("Tick at least one product, or pick a vendor.") + "#queue");
  }
  const published = await getPublishedVersion();
  if (!published) redirect(`${BULK_URL}?error=` + encodeURIComponent("There is no live menu yet.") + "#queue");
  const items = await getVersionItems(published!.id);
  const reqs: QueueRequest[] = items
    .filter((i) => ticked.has(i.source_item_id) || (vendor !== "" && (i.vendor_name ?? "").trim() === vendor))
    .map((i) => ({ key: i.source_item_id, name: i.name, vendor: (i.vendor_name ?? "").trim() || null }));
  if (reqs.length === 0) redirect(`${BULK_URL}?error=` + encodeURIComponent("None of those products is on the live menu.") + "#queue");
  let out: Awaited<ReturnType<typeof queueBulkAiV2>>;
  try {
    out = await queueBulkAiV2(reqs, session.userId);
  } catch (err) {
    redirect(`${BULK_URL}?error=` + encodeURIComponent((err as Error).message) + "#queue");
  }
  revalidatePath(BULK_URL);
  const parts = [`Queued ${out!.added} product${out!.added === 1 ? "" : "s"} for an all-fields AI draft.`];
  if (out!.already) parts.push(`${out!.already} already waiting.`);
  if (out!.capped) parts.push(`Only the first ${BULK_AI_V2_MAX_QUEUE} were added; queue the rest after these finish.`);
  parts.push("The worker starts within a minute; you can close this tab.");
  redirect(`${BULK_URL}?queued=` + encodeURIComponent(parts.join(" ")) + "#queue");
}

/** Cancel everything still waiting (a product already drafting finishes). */
export async function cancelBulkAiV2Action(): Promise<void> {
  const session = await requirePermission("products.enrich");
  let n = 0;
  try {
    n = await cancelBulkAiV2(session.userId);
  } catch (err) {
    redirect(`${BULK_URL}?error=` + encodeURIComponent((err as Error).message) + "#queue");
  }
  revalidatePath(BULK_URL);
  redirect(`${BULK_URL}?queued=` + encodeURIComponent(`Canceled ${n} waiting product${n === 1 ? "" : "s"}.`) + "#queue");
}

/**
 * Per product on the grid: "Accept all >= 85%" (publish=0) or "Accept all >=
 * 85% & publish" (publish=1). Publishing follows the worklist's default rule:
 * only a DRAFT that has a photo (bulk-publish-core, mode "photo").
 */
export async function bulkAcceptAllForProductAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "").trim();
  const andPublish = formData.get("publish") === "1";
  if (!key) redirect(gridUrl(formData, "error=" + encodeURIComponent("Missing product key.")));

  const out = await acceptHighConfidenceForKey(key, session.userId);
  if (!out.ok) redirect(gridUrl(formData, "error=" + encodeURIComponent(out.error)));
  if (out.eligible === 0) {
    redirect(gridUrl(formData, "error=" + encodeURIComponent(`No draft for this product is at or above ${ACCEPT_ALL_THRESHOLD}% (best guesses never count). Review them one by one.`)));
  }
  const { accepted, blocked, writeback } = out;

  let published = false;
  let publishNote = "";
  if (andPublish && accepted.length > 0) {
    const live = await getPublishedVersion();
    const item = live ? await getItemBySourceKey(live.id, key).catch(() => null) : null;
    const e = await getEnrichment(key).catch(() => null);
    if (!item || !e) {
      publishNote = " Not published: the product could not be read just now.";
    } else {
      const g = computeGaps(item, e);
      const plan = planBulkStatus(
        [{ posKey: key, hasImage: g.hasImage, hasDescription: g.hasDescription, descriptionPlaceholder: g.descriptionPlaceholder, enrichmentStatus: g.enrichmentStatus, hasOwnRecord: true }],
        "published",
        "photo",
      );
      if (plan.apply.length === 0) {
        publishNote = plan.skipped["no-photo"]
          ? " Not published: it has no photo yet."
          : plan.skipped.already
            ? " It was already published."
            : " Not published.";
      } else {
        try {
          published = (await setEnrichmentStatusForKeys([key], "published", session.userId)).length === 1;
          if (published) await writeBackOnPublish(key, session.userId).catch(() => null);
          publishNote = published ? " Published." : " Not published: the change did not save.";
        } catch (err) {
          publishNote = ` Not published: ${(err as Error).message}`;
        }
      }
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.bulk_ai_accepted_all",
    entityType: "product",
    entityId: key,
    after: { threshold: ACCEPT_ALL_THRESHOLD, accepted, blocked, andPublish, published, kb_writeback: writeback ?? undefined },
  });
  revalidatePath(BULK_URL);
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  if (published) {
    revalidatePath("/admin/products");
    revalidatePublicMenuSurfaces();
  }
  const msg = acceptAllMessage(accepted, blocked) + publishNote;
  redirect(gridUrl(formData, (accepted.length ? "accepted_note=" : "error=") + encodeURIComponent(msg)));
}
