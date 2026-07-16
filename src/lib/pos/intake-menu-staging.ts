/**
 * src/lib/pos/intake-menu-staging.ts
 *
 * Intake auto-carry + AUTO-PUBLISH (owner-approved Option 1) — SERVER executor.
 *
 * When a manifest is accepted, this stages a NEW menu version made of every
 * currently-published item (carried forward) plus the manifest's APPROVED
 * onboarding products, WITHOUT any Cultivera "Menu Imports" (POS-export)
 * upload. The pure planner (intake-menu-staging-core) makes every decision;
 * this module only gathers DB rows + enrichment and writes the result.
 *
 * ORIGIN: the new row has `import_id = NULL` (an intake-origin version — legal
 * per migration 0002, no schema change) and `summary_json.origin = "intake"`
 * with the source manifest id + the planner diagnostics, so the review surface
 * can show what was carried / added / skipped WITHOUT a pos_imports row.
 *
 * AUTO-PUBLISH: the human review already happened item-by-item at draft
 * approval (price set + Approve pressed on Product Onboarding) — that IS the
 * go-live decision, so after staging succeeds the version is published
 * immediately via the same gated `publish_menu_version` RPC the Menu Imports
 * page uses (atomic swap; archives the previously-published version). On a
 * publish hiccup the STAGED version remains and lands on Menu Imports as the
 * manual fallback — nothing can be silently lost. After a successful publish,
 * stale intake-origin staged siblings (built from an older live snapshot —
 * publishing one would DROP newer products) are archived as housekeeping.
 *
 * BEST-EFFORT: called from finalizeManifestDispositions AFTER lots activate and
 * drafts are seeded, and from approveDraftWithPrice after each approval. Any
 * failure logs and returns a skipped result; it must NEVER fail the manifest
 * finalize or the draft approval. No-op when Supabase isn't configured or the
 * manifest has no APPROVED drafts to carry.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  buildIntakeStagedVersionPlan,
  type CarryForwardItem,
} from "@/lib/pos/intake-menu-staging-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";
import type { MenuItemRow, MenuVariantRow, MenuVersion } from "@/lib/pos/db-types";

export type IntakeStagingOutcome = {
  /** True when a staged version was created. */
  staged: boolean;
  /** True when the version also went LIVE (auto-publish succeeded). */
  published: boolean;
  /** The new version id (when staged). */
  versionId: string | null;
  carried: number;
  added: number;
  /** Why nothing was staged (for the timeline note). */
  reason?: string;
};

const ITEM_BATCH = 250;
const VARIANT_BATCH = 500;

/**
 * Stage an intake-origin menu version from a freshly-accepted manifest's
 * APPROVED onboarding products. Returns an outcome the caller can log; never
 * throws.
 */
export async function stageIntakeMenuVersionForManifest(
  manifestId: string,
  actorId: string | null,
): Promise<IntakeStagingOutcome> {
  const skip = (reason: string): IntakeStagingOutcome => ({
    staged: false,
    published: false,
    versionId: null,
    carried: 0,
    added: 0,
    reason,
  });

  if (!isSupabaseServiceConfigured) return skip("supabase-not-configured");
  const admin = createSupabaseAdminClient();

  try {
    // 1) APPROVED onboarding drafts for THIS manifest. Only human-approved,
    //    priced products are eligible (price set at approval from intake data);
    //    unapproved/dismissed drafts are ignored.
    const { data: draftRows, error: dErr } = await admin
      .from("catalog_product_drafts")
      .select(
        "id, pos_product_key, name, brand_name, vendor_name, strain_name, thc_pct, cbd_pct, total_thc_pct, potency_json, price_minor_units, updated_at, lot_id, inventory_type, category",
      )
      .eq("manifest_id", manifestId)
      .eq("status", "approved");
    if (dErr) {
      console.error("[intake-menu-staging] drafts read failed:", dErr.message);
      return skip("drafts-read-failed");
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
    if (drafts.length === 0) return skip("no-approved-drafts");

    // 2) Currently-published version + its items (carry-forward snapshot). When
    //    nothing is live yet, the staged version is just the intake products.
    const { data: publishedRow } = await admin
      .from("menu_versions")
      .select("*")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    const published = (publishedRow as MenuVersion | null) ?? null;
    const publishedItems = published ? await loadCarryForwardItems(published.id) : [];

    // 3) Enrichment (same sources as draft-injection.ts): website category via
    //    the house resolver, curated strain type from kb_strains, and the
    //    source lot's on-hand + package label from inventory_lots.
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
        | {
            id: string;
            on_hand_qty: number;
            unit_weight: number | null;
            unit_weight_uom: string | null;
          }[]
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

    // 4) Pure plan.
    const plan = buildIntakeStagedVersionPlan({
      publishedItems,
      approvedDrafts: drafts,
      enrichmentByDraftId,
    });

    // Nothing NEW to carry (every approved draft was superseded/skipped): do not
    // create a redundant staged version. The diagnostics still tell the human why
    // via the timeline note in the caller.
    if (!plan.hasChanges) return skip("no-new-items");

    // 5) Create the STAGED intake-origin version (import_id NULL). Counts +
    //    diagnostics live in summary_json so the review surface needs no
    //    pos_imports/pos_import_diagnostics rows.
    const variantCount = plan.items.reduce((s, it) => s + it.variants.length, 0);
    const warningCount = plan.diagnostics.filter((d) => d.severity === "warning").length;
    const { data: versionRow, error: vErr } = await admin
      .from("menu_versions")
      .insert({
        import_id: null,
        status: "staged",
        is_test: false,
        item_count: plan.items.length,
        variant_count: variantCount,
        vendor_count: countVendors(plan.items),
        hidden_count: plan.items.filter((it) => it.hidden).length,
        error_count: 0,
        warning_count: warningCount,
        summary_json: {
          origin: "intake",
          manifest_id: manifestId,
          carried: plan.carriedCount,
          added: plan.addedCount,
          diagnostics: plan.diagnostics,
        },
        notes: `Auto-carried from accepted manifest ${manifestId}: ${plan.addedCount} new product(s) staged on top of ${plan.carriedCount} live item(s).`,
        created_by: actorId,
      })
      .select("*")
      .single();
    if (vErr || !versionRow) {
      console.error("[intake-menu-staging] version insert failed:", vErr?.message);
      return skip("version-insert-failed");
    }
    const version = versionRow as MenuVersion;

    // 6) Persist items + variants in batches (same shape as persistMenuItems).
    await persistSnapshotItems(version.id, plan.items);

    // 7) AUTO-PUBLISH (owner-approved Option 1): the item-by-item human review
    //    already happened at draft approval, so promote the fresh snapshot to
    //    live immediately via the same atomic RPC the Menu Imports publish
    //    button uses. Best-effort: on ANY failure the STAGED version remains
    //    and surfaces on Menu Imports as the manual-publish fallback.
    const publishedOk = await autoPublishIntakeVersion(version.id, actorId, manifestId);

    return {
      staged: true,
      published: publishedOk,
      versionId: version.id,
      carried: plan.carriedCount,
      added: plan.addedCount,
    };
  } catch (err) {
    console.error("[intake-menu-staging] staging failed:", err);
    return skip("exception");
  }
}

/**
 * Promote a freshly-staged intake-origin version to LIVE via the same atomic
 * `publish_menu_version` RPC the Menu Imports publish button uses (archives
 * the previously-published version in the same transaction). Returns true on
 * success. BEST-EFFORT: any failure logs, records a `menu_auto_publish_failed`
 * timeline event, and returns false — the staged version remains on Menu
 * Imports as the manual-publish fallback. The freshly-inserted version always
 * has error_count = 0 (intake staging never writes error diagnostics), so the
 * Menu Imports error guard is satisfied by construction.
 */
async function autoPublishIntakeVersion(
  versionId: string,
  actorId: string | null,
  manifestId: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const logEvent = async (eventType: string, note: string): Promise<void> => {
    try {
      await admin.from("manifest_events").insert({
        manifest_id: manifestId,
        event_type: eventType,
        note,
        actor_id: actorId,
      });
    } catch (err) {
      console.error("[intake-menu-staging] timeline event insert failed:", err);
    }
  };

  try {
    const { error } = await admin.rpc("publish_menu_version", {
      p_version_id: versionId,
      p_actor: actorId,
    });
    if (error) {
      console.error("[intake-menu-staging] auto-publish failed:", error.message);
      await logEvent(
        "menu_auto_publish_failed",
        "Automatic publish didn't finish — the menu update is STAGED on Admin → Menu Imports. Press Publish there to put it live.",
      );
      return false;
    }
  } catch (err) {
    console.error("[intake-menu-staging] auto-publish exception:", err);
    await logEvent(
      "menu_auto_publish_failed",
      "Automatic publish didn't finish — the menu update is STAGED on Admin → Menu Imports. Press Publish there to put it live.",
    );
    return false;
  }

  // Housekeeping: archive STALE intake-origin staged siblings. Each was built
  // from an OLDER live snapshot — publishing one later would silently DROP the
  // products this publish just added, so they must not linger as landmines.
  // (The RPC only archives staged siblings that belong to a pos_import; for
  // intake-origin versions import_id is NULL, so we sweep them here.)
  try {
    await admin
      .from("menu_versions")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .is("import_id", null)
      .eq("status", "staged")
      .neq("id", versionId);
  } catch (err) {
    console.error("[intake-menu-staging] stale staged sweep failed:", err);
  }

  // Audit trail — same action name as the manual Menu Imports publish, with
  // the intake origin recorded (recordAudit never throws).
  await recordAudit({
    actorId,
    action: "menu_version.published",
    entityType: "menu_version",
    entityId: versionId,
    after: { origin: "intake", manifest_id: manifestId, auto: true },
  });

  await logEvent(
    "menu_auto_publish",
    "Published to the live menu automatically — the approved products from this delivery are now on the website and sellable at the register.",
  );

  // Refresh the public menu surfaces + the Menu Imports admin list (same set
  // the manual publish action revalidates).
  try {
    revalidatePath("/admin/menu-imports");
    revalidatePath("/menu");
    revalidatePath("/shop");
    revalidatePath("/");
  } catch (err) {
    console.error("[intake-menu-staging] revalidate failed:", err);
  }

  return true;
}

/**
 * Ribbon step ④ snapshot for a manifest: how many onboarding drafts are still
 * unpriced vs approved, and whether an intake-origin STAGED version for this
 * manifest is still waiting (auto-publish fallback). Returns null when the
 * counts can't be read — the ribbon then shows a neutral step rather than
 * guessing.
 */
export async function intakeMenuStepSnapshot(
  manifestId: string,
): Promise<{ pendingDrafts: number; approvedDrafts: number; stagedWaiting: boolean } | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const [pendingRes, approvedRes, stagedRes] = await Promise.all([
      admin
        .from("catalog_product_drafts")
        .select("id", { count: "exact", head: true })
        .eq("manifest_id", manifestId)
        .eq("status", "draft"),
      admin
        .from("catalog_product_drafts")
        .select("id", { count: "exact", head: true })
        .eq("manifest_id", manifestId)
        .eq("status", "approved"),
      admin
        .from("menu_versions")
        .select("id", { count: "exact", head: true })
        .is("import_id", null)
        .eq("status", "staged")
        .eq("summary_json->>manifest_id", manifestId),
    ]);
    if (pendingRes.error || approvedRes.error || stagedRes.error) {
      console.error(
        "[intake-menu-staging] menu-step snapshot read failed:",
        pendingRes.error?.message ?? approvedRes.error?.message ?? stagedRes.error?.message,
      );
      return null;
    }
    return {
      pendingDrafts: pendingRes.count ?? 0,
      approvedDrafts: approvedRes.count ?? 0,
      stagedWaiting: (stagedRes.count ?? 0) > 0,
    };
  } catch (err) {
    console.error("[intake-menu-staging] menu-step snapshot exception:", err);
    return null;
  }
}

/** Load a published version's items (with variants) as carry-forward rows. */
async function loadCarryForwardItems(versionId: string): Promise<CarryForwardItem[]> {
  const admin = createSupabaseAdminClient();
  const { data: itemRows, error } = await admin
    .from("menu_items")
    .select("*")
    .eq("menu_version_id", versionId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[intake-menu-staging] carry-forward items read failed:", error.message);
    return [];
  }
  const items = (itemRows as MenuItemRow[] | null) ?? [];
  if (items.length === 0) return [];

  const variantsByItem = new Map<string, MenuVariantRow[]>();
  const ids = items.map((i) => i.id);
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: variants } = await admin
      .from("menu_variants")
      .select("*")
      .in("menu_item_id", slice)
      .order("sort_order", { ascending: true });
    for (const v of (variants as MenuVariantRow[] | null) ?? []) {
      const list = variantsByItem.get(v.menu_item_id) ?? [];
      list.push(v);
      variantsByItem.set(v.menu_item_id, list);
    }
  }

  return items.map((it) => ({
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
    description: it.description,
    price_label: it.price_label,
    price_minor_units: it.price_minor_units,
    inventory_status: it.inventory_status,
    hidden: it.hidden,
    hidden_reason: it.hidden_reason,
    variants: (variantsByItem.get(it.id) ?? []).map((v) => ({
      source_variant_id: v.source_variant_id,
      label: v.label,
      price_minor_units: v.price_minor_units,
      inventory_level: v.inventory_level,
      medical: v.medical,
    })),
  }));
}

/** Distinct non-empty vendor names among the staged items. */
function countVendors(
  items: { vendor_name: string | null; brand_name: string }[],
): number {
  const set = new Set<string>();
  for (const it of items) {
    const v = (it.vendor_name || it.brand_name || "").trim();
    if (v) set.add(v.toLowerCase());
  }
  return set.size;
}

/** Insert the full staged snapshot (items + variants) under `versionId`. */
async function persistSnapshotItems(
  versionId: string,
  items: Awaited<ReturnType<typeof buildIntakeStagedVersionPlan>>["items"],
) {
  const admin = createSupabaseAdminClient();

  for (let start = 0; start < items.length; start += ITEM_BATCH) {
    const batch = items.slice(start, start + ITEM_BATCH);
    const rows = batch.map((it) => ({
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
      description: it.description,
      price_label: it.price_label,
      price_minor_units: it.price_minor_units,
      inventory_status: it.inventory_status,
      hidden: it.hidden,
      hidden_reason: it.hidden_reason,
      sort_order: it.sort_order,
    }));

    const { data: inserted, error } = await admin
      .from("menu_items")
      .insert(rows)
      .select("id, source_item_id");
    if (error || !inserted) {
      throw new Error(`Failed to insert staged menu items: ${error?.message ?? "unknown"}`);
    }

    const idBySource = new Map<string, string>();
    for (const r of inserted as { id: string; source_item_id: string }[]) {
      idBySource.set(r.source_item_id, r.id);
    }

    const variantRows: Record<string, unknown>[] = [];
    for (const it of batch) {
      const dbId = idBySource.get(it.source_item_id);
      if (!dbId) continue;
      for (const v of it.variants) {
        variantRows.push({
          menu_item_id: dbId,
          source_variant_id: v.source_variant_id,
          label: v.label,
          price_minor_units: v.price_minor_units,
          inventory_level: v.inventory_level,
          medical: v.medical,
          sort_order: v.sort_order,
        });
      }
    }
    for (let v = 0; v < variantRows.length; v += VARIANT_BATCH) {
      const vBatch = variantRows.slice(v, v + VARIANT_BATCH);
      const { error: vErr } = await admin.from("menu_variants").insert(vBatch);
      if (vErr) throw new Error(`Failed to insert staged menu variants: ${vErr.message}`);
    }
  }
}
