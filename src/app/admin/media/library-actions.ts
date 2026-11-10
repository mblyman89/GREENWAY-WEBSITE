"use server";

/**
 * src/app/admin/media/library-actions.ts   (D221 M5 + M7)
 *
 * The Media Library v2 buttons:
 *   - M5: one-click Undo / Redo of auto-publish (all, or one picture), via the
 *     0354 media_set_auto_publish rpc. Undo puts auto-published pictures back
 *     to draft (publish_reason 'auto-reverted', so the nightly auto-publish
 *     never re-publishes them). Nothing is deleted.
 *   - M7: the v2 bulk bar (publish / archive / re-describe / set vendor /
 *     undo auto-publish / add to collection) and collections (create, archive,
 *     add / take out one picture).
 * Every action needs media.manage and writes an audit row. Attaching a
 * picture to a PRODUCT stays a person's step on the product page (AGENTS.md
 * rule 3, D221 exception), so nothing here touches products.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { safeAdminPath, appendQuery } from "@/lib/media/return-state-core";
import { bulkStep, bulkSummary, parseBulkAction, parseCollectionInput, type BulkRow, type BulkStep } from "@/lib/media/library-v2-core";
import { isMissingObject } from "@/lib/media/library-v2-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_0354 = "This needs the 0354 database update (docs/MIGRATIONS_TO_RUN.md). Apply it in Supabase, then try again.";

function back(raw: FormDataEntryValue | null, fallback: string): string {
  return safeAdminPath(String(raw ?? ""), fallback);
}

function errText(message: string): string {
  return isMissingObject(message) ? NEEDS_0354 : message;
}

/** M5: undo (or redo) auto-publish. ids: none = every auto-published picture. */
export async function setAutoPublishAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const mode = String(formData.get("mode") ?? "");
  const ret = back(formData.get("return_to"), "/admin/media");
  if (mode !== "undo" && mode !== "redo") redirect(appendQuery(ret, { error: "Unknown auto-publish action." }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const ids = [...new Set(formData.getAll("id").map((v) => String(v).trim()).filter((v) => UUID_RE.test(v)))];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("media_set_auto_publish", { p_mode: mode, p_ids: ids.length ? ids : null });
  if (error) redirect(appendQuery(ret, { error: errText(error.message) }));
  const changed = Number((data as { changed?: number } | null)?.changed ?? 0);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: mode === "undo" ? "media.auto_publish_undone" : "media.auto_publish_redone",
    entityType: "media_asset",
    entityId: ids.length === 1 ? ids[0] : null,
    after: { mode, scope: ids.length ? ids : "all", changed },
  });
  revalidatePath("/admin/media");
  for (const id of ids) revalidatePath(`/admin/media/${id}`);
  const note =
    mode === "undo"
      ? `${changed} auto-published picture(s) set back to draft. Nothing was deleted; Redo puts them back.`
      : `${changed} picture(s) published again.`;
  redirect(appendQuery(ret, { deleted: "1", note }));
}

/** M7: the v2 bulk bar. */
export async function bulkLibraryV2Action(formData: FormData) {
  const session = await requirePermission("media.manage");
  const ret = back(formData.get("returnTo"), "/admin/media");
  const action = parseBulkAction(formData.get("bulk"));
  const ids = [...new Set(formData.getAll("ids").map((v) => String(v).trim()).filter((v) => UUID_RE.test(v)))].slice(0, 1000);
  if (!action) redirect(appendQuery(ret, { error: "Choose what to do with the selection." }));
  if (ids.length === 0) redirect(appendQuery(ret, { error: "Select at least one item first." }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const collectionId = String(formData.get("collection_id") ?? "").trim();
  if (action === "set-vendor" && !UUID_RE.test(vendorId)) redirect(appendQuery(ret, { error: "Choose the vendor to set." }));
  if (action === "add-to-collection" && !UUID_RE.test(collectionId)) redirect(appendQuery(ret, { error: "Choose the collection." }));

  const admin = createSupabaseAdminClient();
  if (action === "set-vendor") {
    const v = await admin.from("vendors").select("id").eq("id", vendorId).maybeSingle();
    if (v.error || !v.data) redirect(appendQuery(ret, { error: v.error?.message ?? "That vendor card was not found." }));
  }
  if (action === "add-to-collection") {
    const c = await admin.from("media_collections").select("id,archived_at").eq("id", collectionId).maybeSingle();
    if (c.error) redirect(appendQuery(ret, { error: errText(c.error.message) }));
    if (!c.data || (c.data as { archived_at: string | null }).archived_at) redirect(appendQuery(ret, { error: "That collection is archived or missing." }));
  }

  const rows: BulkRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("media_assets")
      .select("id,status,mime_type,review_state,publish_reason,vendor_id,ai_status,canonical_id,field_provenance")
      .in("id", ids.slice(i, i + 200))
      .range(0, 199);
    if (error) redirect(appendQuery(ret, { error: error.message }));
    rows.push(...((data as BulkRow[] | null) ?? []));
  }
  const nowIso = new Date().toISOString();
  const steps: BulkStep[] = rows.map((r) => bulkStep(action, r, { vendorId, actorId: session.userId, nowIso }));
  let done = 0;
  let failed = 0;

  const undoIds = steps.filter((s) => s.kind === "rpc-undo").map((s) => s.id);
  if (undoIds.length) {
    const { data, error } = await admin.rpc("media_set_auto_publish", { p_mode: "undo", p_ids: undoIds });
    if (error) redirect(appendQuery(ret, { error: errText(error.message) }));
    done += Number((data as { changed?: number } | null)?.changed ?? 0);
  }

  const collectIds = steps.filter((s) => s.kind === "collect").map((s) => s.id);
  if (collectIds.length) {
    const { error } = await admin
      .from("media_collection_items")
      .upsert(
        collectIds.map((id, i) => ({ collection_id: collectionId, media_id: id, position: i, added_by: session.userId, added_at: nowIso, removed_at: null })),
        { onConflict: "collection_id,media_id" },
      );
    if (error) redirect(appendQuery(ret, { error: errText(error.message) }));
    done += collectIds.length;
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const s of steps) {
    if (s.kind !== "patch") continue;
    const before = byId.get(s.id);
    const { error } = await admin.from("media_assets").update(s.patch).eq("id", s.id);
    if (error) {
      failed += 1;
      continue;
    }
    done += 1;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `media.bulk_${action.replace(/-/g, "_")}`,
      entityType: "media_asset",
      entityId: s.id,
      before: before ? { status: before.status, vendor_id: before.vendor_id, ai_status: before.ai_status, publish_reason: before.publish_reason } : null,
      after: s.patch,
    }).catch(() => {});
  }
  if (undoIds.length || collectIds.length) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `media.bulk_${action.replace(/-/g, "_")}`,
      entityType: "media_asset",
      after: { ids: undoIds.length ? undoIds : collectIds, ...(collectIds.length ? { collection_id: collectionId } : {}) },
    }).catch(() => {});
  }
  revalidatePath("/admin/media");
  redirect(appendQuery(ret, { deleted: "1", note: bulkSummary(action, steps, done, failed) }));
}

/** M7: create a collection (or brand kit). */
export async function createCollectionAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const ret = back(formData.get("return_to"), "/admin/media/collections");
  const parsed = parseCollectionInput({ name: formData.get("name"), description: formData.get("description"), kind: formData.get("kind") });
  if (!parsed.ok) redirect(appendQuery(ret, { error: parsed.error }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const vendorRaw = String(formData.get("vendor_id") ?? "").trim();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_collections")
    .insert({ name: parsed.name, slug: parsed.slug, description: parsed.description, kind: parsed.kind, vendor_id: UUID_RE.test(vendorRaw) ? vendorRaw : null, created_by: session.userId })
    .select("id")
    .single();
  if (error) {
    const dup = error.message.includes("uq_media_collections_live_slug") || error.code === "23505";
    redirect(appendQuery(ret, { error: dup ? "A collection with that name already exists." : errText(error.message) }));
  }
  const id = (data as { id: string }).id;
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "media.collection_created", entityType: "media_collection", entityId: id, after: parsed });
  revalidatePath("/admin/media/collections");
  redirect(appendQuery(ret, { saved: "1" }));
}

/** M7: archive / restore a collection (never deleted). */
export async function archiveCollectionAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const ret = back(formData.get("return_to"), "/admin/media/collections");
  const id = String(formData.get("id") ?? "").trim();
  const restore = String(formData.get("restore") ?? "") === "1";
  if (!UUID_RE.test(id)) redirect(appendQuery(ret, { error: "Missing collection." }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("media_collections").update({ archived_at: restore ? null : new Date().toISOString() }).eq("id", id);
  if (error) redirect(appendQuery(ret, { error: error.code === "23505" ? "A live collection already uses that name." : errText(error.message) }));
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: restore ? "media.collection_restored" : "media.collection_archived", entityType: "media_collection", entityId: id });
  revalidatePath("/admin/media/collections");
  redirect(appendQuery(ret, { saved: "1" }));
}

/** M7: add one picture to a collection, or take it out (stamps removed_at). */
export async function toggleCollectionItemAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const mediaId = String(formData.get("media_id") ?? "").trim();
  const collectionId = String(formData.get("collection_id") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  const ret = back(formData.get("return_to"), `/admin/media/${mediaId}`);
  if (!UUID_RE.test(mediaId) || !UUID_RE.test(collectionId)) redirect(appendQuery(ret, { error: "Choose a collection." }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = remove
    ? await admin.from("media_collection_items").update({ removed_at: nowIso }).eq("collection_id", collectionId).eq("media_id", mediaId)
    : await admin
        .from("media_collection_items")
        .upsert({ collection_id: collectionId, media_id: mediaId, added_by: session.userId, added_at: nowIso, removed_at: null }, { onConflict: "collection_id,media_id" });
  if (error) redirect(appendQuery(ret, { error: errText(error.message) }));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: remove ? "media.collection_item_removed" : "media.collection_item_added",
    entityType: "media_asset",
    entityId: mediaId,
    after: { collection_id: collectionId },
  });
  revalidatePath(`/admin/media/${mediaId}`);
  revalidatePath("/admin/media/collections");
  redirect(appendQuery(ret, { saved: "1" }));
}
