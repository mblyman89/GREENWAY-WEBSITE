/**
 * src/lib/pos/draft-injection.ts
 *
 * W7 (Decision B) — server-side executor: inject APPROVED onboarding drafts
 * into a freshly-STAGED menu version during runImport. The pure planner
 * (draft-injection-core) makes every decision; this module only gathers
 * inputs and writes rows.
 *
 * DRAFTS-ONLY: only the staged version is touched — the human still reviews
 * the diff/diagnostics and presses Publish. POS stays the source of truth:
 * when the export already carries a draft's POS key, the POS row wins and no
 * injection happens (the planner emits a "superseded" diagnostic instead).
 *
 * BEST-EFFORT: called inside runImport AFTER the POS items are persisted; any
 * failure here logs and returns zeros — it must never fail the import itself.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  buildDraftInjectionPlan,
  type ApprovedDraftForInjection,
  type DraftEnrichment,
  type InjectionDiagnostic,
} from "@/lib/pos/draft-injection-core";

export type DraftInjectionResult = {
  injected: number;
  diagnostics: InjectionDiagnostic[];
};

/**
 * Inject approved drafts into the staged version `versionId`. `importId` is
 * used to persist the planner's diagnostics alongside the import's own.
 * Returns how many items were added so the caller can bump version counts.
 */
export async function injectApprovedDraftsIntoVersion(
  versionId: string,
  importId: string,
): Promise<DraftInjectionResult> {
  const none: DraftInjectionResult = { injected: 0, diagnostics: [] };
  if (!isSupabaseServiceConfigured) return none;
  const admin = createSupabaseAdminClient();

  try {
    // 1) Approved drafts (the queue of validated-but-not-yet-on-menu products).
    const { data: draftRows, error: dErr } = await admin
      .from("catalog_product_drafts")
      .select(
        "id, pos_product_key, name, brand_name, vendor_name, strain_name, thc_pct, cbd_pct, total_thc_pct, potency_json, price_minor_units, updated_at, lot_id, inventory_type, category",
      )
      .eq("status", "approved");
    if (dErr) {
      console.error("[draft-injection] drafts read failed:", dErr.message);
      return none;
    }
    type DraftRow = ApprovedDraftForInjection & {
      lot_id: string | null;
      inventory_type: string | null;
      category: string | null;
    };
    const drafts = ((draftRows as DraftRow[] | null) ?? []).map((r) => ({
      ...r,
      thc_pct: r.thc_pct != null ? Number(r.thc_pct) : null,
      cbd_pct: r.cbd_pct != null ? Number(r.cbd_pct) : null,
      total_thc_pct: r.total_thc_pct != null ? Number(r.total_thc_pct) : null,
      price_minor_units: r.price_minor_units != null ? Number(r.price_minor_units) : null,
    }));
    if (drafts.length === 0) return none;

    // 2) What the POS export already staged (source_item_ids = POS truth).
    const { data: staged, error: sErr } = await admin
      .from("menu_items")
      .select("source_item_id, sort_order")
      .eq("menu_version_id", versionId);
    if (sErr) {
      console.error("[draft-injection] staged items read failed:", sErr.message);
      return none;
    }
    const stagedRows = (staged as { source_item_id: string; sort_order: number }[] | null) ?? [];
    const existingKeys = new Set(stagedRows.map((r) => r.source_item_id));
    const baseSortOrder =
      stagedRows.reduce((max, r) => Math.max(max, Number(r.sort_order ?? 0)), -1) + 1;

    // 3) Enrichment: website category (house resolver), curated strain type
    //    (kb_strains), and the source lot's on-hand + package label.
    const resolutions = await resolveWebsiteCategories(
      drafts.map((d) => ({
        posProductKey: d.pos_product_key,
        productName: d.name,
        inventoryType: d.inventory_type,
        category: d.category,
      })),
    );

    const strainTypeBySlug = new Map<string, string>();
    const slugs = Array.from(
      new Set(
        drafts
          .map((d) => d.strain_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "")
          .filter(Boolean),
      ),
    );
    if (slugs.length) {
      const { data: strains } = await admin
        .from("kb_strains")
        .select("slug, strain_type")
        .in("slug", slugs);
      for (const s of (strains as { slug: string; strain_type: string | null }[] | null) ?? []) {
        if (s.strain_type) strainTypeBySlug.set(s.slug, s.strain_type);
      }
    }

    const lotById = new Map<
      string,
      { on_hand_qty: number; unit_weight: number | null; unit_weight_uom: string | null }
    >();
    const lotIds = Array.from(
      new Set(drafts.map((d) => d.lot_id).filter((v): v is string => Boolean(v))),
    );
    if (lotIds.length) {
      const { data: lots } = await admin
        .from("inventory_lots")
        .select("id, on_hand_qty, unit_weight, unit_weight_uom")
        .in("id", lotIds);
      for (const l of (lots as
        | { id: string; on_hand_qty: number; unit_weight: number | null; unit_weight_uom: string | null }[]
        | null) ?? []) {
        lotById.set(l.id, l);
      }
    }

    const enrichmentByDraftId = new Map<string, DraftEnrichment>();
    drafts.forEach((d, i) => {
      const lot = d.lot_id ? lotById.get(d.lot_id) ?? null : null;
      const slug = d.strain_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
      const rawStrainType = slug ? strainTypeBySlug.get(slug) ?? null : null;
      const canonical = rawStrainType ? canonicalStrainType(rawStrainType) : null;
      enrichmentByDraftId.set(d.id, {
        websiteCategory: resolutions[i]?.websiteCategory ?? null,
        strainType: canonical && canonical !== "unknown" ? canonical : null,
        onHandQty: lot ? Number(lot.on_hand_qty ?? 0) : null,
        packageLabel:
          lot && lot.unit_weight != null
            ? `${lot.unit_weight} ${lot.unit_weight_uom ?? ""}`.trim()
            : null,
      });
    });

    // 4) Pure plan, then persist (same insert shape as persistMenuItems).
    const plan = buildDraftInjectionPlan({
      drafts,
      existingKeys,
      enrichmentByDraftId,
      baseSortOrder,
    });

    if (plan.items.length > 0) {
      const rows = plan.items.map((it) => ({
        menu_version_id: versionId,
        source_item_id: it.source_item_id,
        name: it.name,
        product_name: it.product_name,
        brand_name: it.brand_name,
        vendor_name: it.vendor_name,
        category: it.category,
        filter_categories: it.filter_categories,
        pos_inventory_type: it.pos_inventory_type,
        pos_inventory_category: it.pos_inventory_category,
        strain_type: it.strain_type,
        strain_name: it.strain_name,
        thc: it.thc,
        cbd: it.cbd,
        total_thc_json: it.total_thc_json,
        total_cbd_json: it.total_cbd_json,
        compounds_json: it.compounds_json,
        // SLICE 62: structured facts (migration 0138) — verified-only values
        // from the word-by-word extraction engine; null means "not verified".
        servings_per_pack: it.servings_per_pack,
        mg_per_serving: it.mg_per_serving,
        package_thc_mg: it.package_thc_mg,
        package_cbd_mg: it.package_cbd_mg,
        ratio_label: it.ratio_label,
        fact_provenance: it.fact_provenance,
        description: it.description,
        price_label: it.price_label,
        price_minor_units: it.price_minor_units,
        inventory_status: it.inventory_status,
        hidden: it.hidden,
        hidden_reason: it.hidden_reason,
        sort_order: it.sort_order,
      }));
      const { data: inserted, error: iErr } = await admin
        .from("menu_items")
        .insert(rows)
        .select("id, source_item_id");
      if (iErr || !inserted) {
        console.error("[draft-injection] item insert failed:", iErr?.message);
        return none;
      }
      const idBySource = new Map<string, string>();
      for (const r of inserted as { id: string; source_item_id: string }[]) {
        idBySource.set(r.source_item_id, r.id);
      }
      const variantRows = plan.items
        .filter((it) => it.variant && idBySource.has(it.source_item_id))
        .map((it) => ({
          menu_item_id: idBySource.get(it.source_item_id)!,
          source_variant_id: it.variant!.source_variant_id,
          label: it.variant!.label,
          price_minor_units: it.variant!.price_minor_units,
          inventory_level: it.variant!.inventory_level,
          medical: it.variant!.medical,
          sort_order: it.variant!.sort_order,
        }));
      if (variantRows.length) {
        const { error: vErr } = await admin.from("menu_variants").insert(variantRows);
        if (vErr) console.error("[draft-injection] variant insert failed:", vErr.message);
      }

      // Keep the staged version's counts honest for the review screen.
      const { data: vRow } = await admin
        .from("menu_versions")
        .select("item_count, variant_count, warning_count")
        .eq("id", versionId)
        .maybeSingle();
      if (vRow) {
        const v = vRow as { item_count: number; variant_count: number; warning_count: number };
        await admin
          .from("menu_versions")
          .update({
            item_count: v.item_count + plan.items.length,
            variant_count: v.variant_count + variantRows.length,
            warning_count:
              v.warning_count + plan.diagnostics.filter((d) => d.severity === "warning").length,
          })
          .eq("id", versionId);
      }
    }

    // 5) Persist the planner's diagnostics so the review screen tells the
    //    human exactly what was added/skipped before they publish.
    if (plan.diagnostics.length > 0) {
      const batch = plan.diagnostics.map((d) => ({
        import_id: importId,
        severity: d.severity,
        code: d.code,
        message: d.message,
        context_json: d.context ?? null,
      }));
      const { error: dgErr } = await admin.from("pos_import_diagnostics").insert(batch);
      if (dgErr) console.error("[draft-injection] diagnostics insert failed:", dgErr.message);
    }

    return { injected: plan.items.length, diagnostics: plan.diagnostics };
  } catch (err) {
    console.error("[draft-injection] injection failed:", err);
    return none;
  }
}
