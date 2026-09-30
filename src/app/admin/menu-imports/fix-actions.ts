"use server";

/**
 * R15b — Cultivera clean-up presses for one import:
 *   - strain types from the Knowledge Base (bulk for exact/alias matches, one
 *     at a time for everything else);
 *   - adjust out the legacy lots with no product master (CCRS Reconciliation);
 *   - bulk re-file a Type & category check group (suggested, or one pick).
 * Every press is human, validated server-side against a freshly rebuilt plan
 * (hidden fields are never trusted), audited, and revalidates what it changed.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  parseStrainFixChoice,
  nameHintBulkGroups,
  strainFixHref,
  STRAIN_FIX_AUDIT,
} from "@/lib/pos/cultivera-strain-fix-core";
import { loadStrainFixPlan, applyStrainTypeToCards, saveStrainChoiceToKb } from "@/lib/pos/cultivera-strain-fix-store";
import {
  parseLegacyRemovalConfirm,
  legacyRemovalNote,
  LEGACY_REMOVAL_AUDIT,
} from "@/lib/pos/legacy-lot-removal-core";
import { loadLegacyRemovalPlan, adjustOutLegacyLots } from "@/lib/pos/legacy-lot-removal-store";
import {
  buildTypeCheckReport,
  bulkRefileTargets,
  parseTypeCheckRefile,
  typeCheckReturnHref,
  TYPE_CHECK_BULK_REFILE_AUDIT,
  TYPE_CHECK_BULK_ROW_LIMIT,
} from "@/lib/pos/cultivera-type-from-category-core";
import { getVersionItems } from "@/lib/pos/menu-version";
import {
  planBulkReceivedDates,
  receivedDatesHref,
  RECEIVED_DATE_BULK_AUDIT,
} from "@/lib/inventory/received-date-bulk-core";
import { loadUndatedImportLots, setImportLotsReceivedDate } from "@/lib/inventory/received-date-bulk-store";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { getOverridesForKeys } from "@/lib/pos/product-classification-overrides";
import { isValidWebsiteCategory } from "@/lib/menu/menu-category-override-core";

function idFrom(formData: FormData): string {
  const id = String(formData.get("importId") ?? "").trim();
  if (!id) redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  return id;
}

function revalidateStrainSurfaces(importId: string) {
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath(`/admin/menu-imports/${importId}/strains`);
  revalidatePath("/admin/inventory");
  // Same tag as the KB strain-type index (strain-terpenes-server.ts), so a KB
  // write reaches the live cards on the next request.
  revalidatePublicMenuSurfaces();
}

// ── received dates (R16b) ───────────────────────────────────────────────────

/**
 * One vendor group's form: the ticked lots get the group date (or their own
 * per-lot date), owner-entered and attested. The eligible set is re-read
 * server-side; a lot dated meanwhile is skipped, never overwritten.
 */
export async function setImportReceivedDatesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  let msg: string;
  try {
    const selected = formData.getAll("lot").map((v) => String(v));
    const perLot: Record<string, string> = {};
    for (const id of selected) perLot[id] = String(formData.get(`date_${id}`) ?? "");
    const { lots, manifestFound } = await loadUndatedImportLots(importId);
    if (!manifestFound) redirect(receivedDatesHref(importId, "This import's lots were not found.", true));
    const plan = planBulkReceivedDates(
      { selected, groupDate: String(formData.get("groupDate") ?? ""), perLot, attest: String(formData.get("attest") ?? "") },
      new Set(lots.map((l) => l.id)),
    );
    if (!plan.ok) redirect(receivedDatesHref(importId, plan.error, true));
    const byId = new Map(lots.map((l) => [l.id, l]));
    const written: { receivedOn: string; ids: string[] }[] = [];
    for (const d of plan.byDate) {
      const ids = await setImportLotsReceivedDate(importId, d.lotIds, d.receivedOn, session.userId);
      written.push({ receivedOn: d.receivedOn, ids });
    }
    const total = written.reduce((n, w) => n + w.ids.length, 0);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: RECEIVED_DATE_BULK_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      before: { received_on: null },
      after: {
        received_on_source: "owner_entered",
        vendor: String(formData.get("vendorName") ?? "") || null,
        lots: total,
        byDate: written.map((w) => ({
          received_on: w.receivedOn,
          count: w.ids.length,
          lots: w.ids.slice(0, 50).map((id) => [id, byId.get(id)?.lotCode ?? null, byId.get(id)?.productName ?? null]),
        })),
      },
    });
    const skipped = plan.lots - total;
    msg = `Saved the received date on ${total} lot(s).` + (skipped > 0 ? ` ${skipped} already had a date by the time you saved and were left alone.` : "");
  } catch (err) {
    unstable_rethrow(err);
    redirect(receivedDatesHref(importId, err instanceof Error ? err.message : "Could not save the received dates.", true));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath(`/admin/menu-imports/${importId}/received-dates`);
  revalidatePath("/admin/inventory");
  redirect(receivedDatesHref(importId, msg));
}

// ── strain types ──────────────────────────────────────────────────────────

/** One press: every EXACT/ALIAS KB match with a curated type (Rule 3.1 safe set). */
export async function applyKbExactStrainsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  let msg: string;
  try {
    const { plan } = await loadStrainFixPlan(importId);
    const exact = plan.groups.filter((g) => g.kind === "kb_exact" && g.best?.type);
    if (exact.length === 0) redirect(strainFixHref(importId, "No exact Knowledge Base matches are left to apply.", true));
    const r = await applyStrainTypeToCards(
      importId,
      exact.map((g) => ({ sourceItemIds: g.sourceItemIds, type: g.best!.type!, provenance: "kb" as const })),
      session.userId,
    );
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: STRAIN_FIX_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      after: { mode: "kb_exact_bulk", strains: exact.length, cards: r.cards, lots: r.lots, sample: exact.slice(0, 20).map((g) => [g.strainName, g.best!.slug, g.best!.type]) },
    });
    msg = `Applied the Knowledge Base type to ${exact.length} strain(s): ${r.cards} card(s) and ${r.lots} lot(s) updated. Types already set were left alone.`;
  } catch (err) {
    unstable_rethrow(err);
    redirect(strainFixHref(importId, err instanceof Error ? err.message : "Could not apply the strain types.", true));
  }
  revalidateStrainSurfaces(importId);
  redirect(strainFixHref(importId, msg));
}

/**
 * R16: one press for strains whose PRODUCT NAMES state the type with an
 * explicit >= 90% code (e.g. "(I)", "Indica") and no KB candidate contradicts
 * it. Writes only the cards whose own name carries the code (nameHintIds),
 * only where the type is still unknown, provenance "name". Menu cards/lots
 * only; the Knowledge Base is never written from a name code.
 */
export async function applyNameHintStrainsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  let msg: string;
  try {
    const { plan } = await loadStrainFixPlan(importId);
    const hinted = nameHintBulkGroups(plan).filter((g) => g.nameHintIds.length > 0);
    if (hinted.length === 0) redirect(strainFixHref(importId, "No product-name type codes are left to apply.", true));
    const r = await applyStrainTypeToCards(
      importId,
      hinted.map((g) => ({ sourceItemIds: g.nameHintIds, type: g.nameHint!.value, provenance: "name" as const })),
      session.userId,
    );
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: STRAIN_FIX_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      after: {
        mode: "name_hint_bulk",
        strains: hinted.length,
        cards: r.cards,
        lots: r.lots,
        sample: hinted.slice(0, 20).map((g) => [g.strainName, g.nameHint!.value, g.nameHint!.evidence, g.nameHintIds.length]),
      },
    });
    msg = `Applied the type stated in the product names for ${hinted.length} strain(s): ${r.cards} card(s) and ${r.lots} lot(s) updated. Cards without a code in their own name were left for the per-strain pick.`;
  } catch (err) {
    unstable_rethrow(err);
    redirect(strainFixHref(importId, err instanceof Error ? err.message : "Could not apply the name-code types.", true));
  }
  revalidateStrainSurfaces(importId);
  redirect(strainFixHref(importId, msg));
}

/** One strain, one human pick (confirm a candidate, or choose a type), optionally saved to the KB. */
export async function applyStrainChoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  let msg: string;
  try {
    const { plan } = await loadStrainFixPlan(importId);
    const parsed = parseStrainFixChoice(
      {
        key: formData.get("key") as string | null,
        strainType: formData.get("strainType") as string | null,
        kbSlug: formData.get("kbSlug") as string | null,
        saveToKb: formData.get("saveToKb") as string | null,
      },
      plan,
    );
    if (!parsed.ok) redirect(strainFixHref(importId, parsed.error, true));
    const group = plan.groups.find((g) => g.key === parsed.key)!;
    const r = await applyStrainTypeToCards(
      importId,
      [{ sourceItemIds: group.sourceItemIds, type: parsed.type, provenance: parsed.kbSlug ? "kb" : "reviewer" }],
      session.userId,
    );
    let kbNote = "";
    let kb: Awaited<ReturnType<typeof saveStrainChoiceToKb>> | null = null;
    if (parsed.saveToKb || parsed.addAlias) {
      kb = await saveStrainChoiceToKb({
        strainName: group.strainName,
        kbSlug: parsed.kbSlug,
        type: parsed.type,
        addAlias: parsed.addAlias,
        actorId: session.userId,
      });
      kbNote =
        kb.action === "create" ? " Added to the Strain library." :
        kb.action === "set" ? " Saved the type to the Strain library." :
        kb.action === "alias" ? " Taught the Strain library this spelling." :
        kb.action === "skip" && parsed.saveToKb ? ` Strain library left as is (${kb.reason}).` : "";
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: STRAIN_FIX_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      after: { mode: "one", strain: group.strainName, kind: group.kind, type: parsed.type, kbSlug: parsed.kbSlug, cards: r.cards, lots: r.lots, kb },
    });
    msg = `"${group.strainName}" set to ${parsed.type}: ${r.cards} card(s), ${r.lots} lot(s).${kbNote}`;
  } catch (err) {
    unstable_rethrow(err);
    redirect(strainFixHref(importId, err instanceof Error ? err.message : "Could not save the strain type.", true));
  }
  revalidateStrainSurfaces(importId);
  redirect(strainFixHref(importId, msg));
}

// ── legacy lots with no product master ────────────────────────────────────

export async function adjustOutLegacyLotsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  const back = `/admin/menu-imports/${importId}/missing-products`;
  let msg: string;
  try {
    const { plan } = await loadLegacyRemovalPlan(importId);
    const confirm = parseLegacyRemovalConfirm(formData.get("confirm") as string | null, plan.lots);
    if (!confirm.ok) redirect(`${back}?error=${encodeURIComponent(confirm.error)}#remove-legacy`);
    const note = legacyRemovalNote(formData.get("note") as string | null);
    const r = await adjustOutLegacyLots(plan, note, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: LEGACY_REMOVAL_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      before: { lots: plan.lots, units: plan.units },
      after: { removed: r.removed, units: r.units, failed: r.failed.slice(0, 50), note },
    });
    msg =
      `Adjusted out ${r.removed} lot(s), ${r.units} unit(s), as CCRS "Reconciliation". ` +
      "They are on your next Inventory Adjustment export (Compliance → CCRS)." +
      (r.failed.length > 0 ? ` ${r.failed.length} lot(s) could not be adjusted (stock moved or a write failed) — press again to retry just those.` : "");
  } catch (err) {
    unstable_rethrow(err);
    redirect(`${back}?error=${encodeURIComponent(err instanceof Error ? err.message : "Could not adjust the lots out.")}#remove-legacy`);
  }
  revalidatePath(back);
  revalidatePath("/admin/inventory");
  redirect(`${back}?done=${encodeURIComponent(msg)}#remove-legacy`);
}

// ── Type & category check: bulk re-file ──────────────────────────────────

export async function bulkRefileFromTypeCheck(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = idFrom(formData);
  const key = String(formData.get("groupKey") ?? "");
  const mode = formData.get("mode") === "manual" ? "manual" : "suggested";
  let msg: string;
  try {
    const admin = createSupabaseAdminClient();
    const { data: vrows } = await admin
      .from("menu_versions")
      .select("id, created_at")
      .eq("import_id", importId)
      .order("created_at", { ascending: false })
      .limit(1);
    const vid = ((vrows ?? [])[0] as { id: string } | undefined)?.id;
    if (!vid) redirect(typeCheckReturnHref(importId, "This import has no menu version to re-file from.", true));
    const items = await getVersionItems(vid);
    const report = buildTypeCheckReport(
      items.map((i) => ({
        sourceItemId: i.source_item_id,
        name: i.name,
        productName: i.product_name,
        category: i.pos_inventory_category,
        inventoryType: i.pos_inventory_type,
      })),
      TYPE_CHECK_BULK_ROW_LIMIT,
    );
    let manual: { websiteCategory: string; houseType: string | null } | undefined;
    if (mode === "manual") {
      const [cats, types] = await Promise.all([
        listWebsiteCategoryTypes({ includeInactive: false }),
        listInventoryTypes({ includeInactive: false }),
      ]);
      const [wc, ht] = String(formData.get("choice") ?? "").split("|");
      const parsed = parseTypeCheckRefile(
        { website_category: wc ?? "", house_type: ht ?? "" },
        { validCategoryValues: cats.map((c) => c.value).filter((v) => isValidWebsiteCategory(v)), validTypeLabels: types.map((t) => t.label) },
      );
      if (!parsed.ok) redirect(typeCheckReturnHref(importId, parsed.error, true));
      manual = { websiteCategory: parsed.websiteCategory, houseType: parsed.houseType };
    }
    const targets = bulkRefileTargets(report, key, mode, manual);
    if (targets.length === 0) redirect(typeCheckReturnHref(importId, "Nothing in that group to re-file (the check may have changed — reload).", true));

    // Keep each product's existing note; same row shape as upsertOverride.
    const existing = await getOverridesForKeys(targets.map((t) => t.sourceItemId));
    const nowIso = new Date().toISOString();
    for (let i = 0; i < targets.length; i += 200) {
      const rows = targets.slice(i, i + 200).map((t) => ({
        pos_product_key: t.sourceItemId,
        website_category: t.websiteCategory,
        house_type: t.houseType,
        note: existing.get(t.sourceItemId)?.note ?? null,
        updated_by: session.userId,
        updated_at: nowIso,
      }));
      const { error } = await admin.from("product_classification_overrides").upsert(rows, { onConflict: "pos_product_key" });
      if (error) {
        const missing = error.code === "42P01" || /does not exist|could not find the table/i.test(error.message);
        throw new Error(missing ? "Re-filing needs database migration 0150 applied first." : `Re-file stopped after ${i} product(s): ${error.message}`);
      }
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: TYPE_CHECK_BULK_REFILE_AUDIT,
      entityType: "pos_import",
      entityId: importId,
      after: { groupKey: key, mode, manual: manual ?? null, count: targets.length, sample: targets.slice(0, 25) },
    });
    msg = `Re-filed ${targets.length} product(s)${manual ? ` as ${manual.houseType ?? manual.websiteCategory}` : " as suggested"}. The CCRS type was not changed.`;
  } catch (err) {
    unstable_rethrow(err);
    redirect(typeCheckReturnHref(importId, err instanceof Error ? err.message : "Bulk re-file failed.", true));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory");
  revalidatePublicMenuSurfaces();
  redirect(typeCheckReturnHref(importId, msg));
}
