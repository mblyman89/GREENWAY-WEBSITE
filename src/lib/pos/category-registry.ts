/**
 * SLICE 78 — server-side category registry (async: real tables, real counts).
 *
 * The pure brain lives in category-registry-core.ts. This module does the I/O:
 *
 *   - loadCategoryLabelMap(): the DB-backed value→label map every surface uses
 *     (menu, product pages, reports) so a rename at /admin/settings/types
 *     propagates to the customer site without a code deploy. Falls back to the
 *     hardcoded taxonomy exactly like listWebsiteCategoryTypes does.
 *   - countCategoryUsage(): how many REAL rows each surface has per category
 *     (published menu items, staged menu items, onboarding draft picks,
 *     inventory-type mappings) — powers usage badges, safe-delete guards and
 *     the bulk-reassign preview. Never guessed; counted from the tables.
 *   - executeReassign(): the audited bulk move across all four surfaces.
 *   - findMenuOrphans(): live menu category values missing from the registry.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// SLICE 3: PostgREST truncates at db.max_rows (1,000) without an error.
import { pagedAll } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listWebsiteCategoryTypes } from "@/lib/pos/types-store";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  buildCategoryLabelMap,
  findOrphanCategoryValues,
  labelForCategory,
  type ReassignCounts,
} from "@/lib/pos/category-registry-core";

/**
 * The registry as a serializable value→label map (ACTIVE categories only by
 * default — hidden ones stop appearing but still resolve via the title-case
 * fallback in labelForCategory).
 */
export async function loadCategoryLabelMap(opts?: {
  includeInactive?: boolean;
}): Promise<Record<string, string>> {
  const rows = await listWebsiteCategoryTypes({ includeInactive: opts?.includeInactive });
  return buildCategoryLabelMap(rows);
}

/**
 * A ready-to-use labeling function for server pages (reports, admin lists):
 * owner's DB label first, hardcoded taxonomy / title-case fallback after.
 * Includes hidden categories so historical report rows always resolve.
 */
export async function getCategoryLabeler(): Promise<(value: string) => string> {
  const map = await loadCategoryLabelMap({ includeInactive: true });
  return (value: string) => labelForCategory(map, value);
}

/** Real per-surface usage for ONE category value (see ReassignCounts). */
export async function countCategoryUsage(value: string): Promise<ReassignCounts> {
  const zero: ReassignCounts = { publishedItems: 0, stagedItems: 0, draftPicks: 0, typeMappings: 0 };
  if (!isSupabaseServiceConfigured) return zero;
  const admin = createSupabaseAdminClient();
  const published = await getPublishedVersion();

  const [pubRes, stagedVersions, draftRes, typeRes] = await Promise.all([
    published
      ? admin
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("menu_version_id", published.id)
          .eq("category", value)
      : Promise.resolve({ count: 0 }),
    admin.from("menu_versions").select("id").eq("status", "staged"),
    admin
      .from("catalog_product_drafts")
      .select("id", { count: "exact", head: true })
      .eq("chosen_website_category", value),
    admin
      .from("inventory_types")
      .select("id", { count: "exact", head: true })
      .eq("website_category", value),
  ]);

  let stagedItems = 0;
  const stagedIds = ((stagedVersions.data as { id: string }[] | null) ?? []).map((v) => v.id);
  if (stagedIds.length > 0) {
    const { count } = await admin
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .in("menu_version_id", stagedIds)
      .eq("category", value);
    stagedItems = count ?? 0;
  }

  return {
    publishedItems: ("count" in pubRes ? pubRes.count : 0) ?? 0,
    stagedItems,
    // A pre-0141 database has no chosen_website_category column; PostgREST
    // errors surface as null counts — treat as 0 (nothing to move there).
    draftPicks: draftRes.count ?? 0,
    typeMappings: typeRes.count ?? 0,
  };
}

/** Usage counts for EVERY registry value in one pass (for the list badges). */
export async function countAllCategoryUsage(
  values: readonly string[],
): Promise<Map<string, ReassignCounts>> {
  const out = new Map<string, ReassignCounts>();
  // Sequential-ish batches of 5 to stay gentle on PostgREST.
  const queue = [...values];
  while (queue.length > 0) {
    const batch = queue.splice(0, 5);
    const results = await Promise.all(batch.map((v) => countCategoryUsage(v)));
    batch.forEach((v, i) => out.set(v, results[i]));
  }
  return out;
}

export type ReassignExecution =
  | { ok: true; moved: ReassignCounts }
  | { ok: false; error: string };

/**
 * Execute a validated bulk move `from` → `to` across all four surfaces.
 * The CALLER is responsible for validation (buildReassignPlan) + audit.
 * Menu-item updates touch published + staged versions only — historical
 * (archived/superseded) versions keep their original categories.
 */
export async function executeReassign(from: string, to: string): Promise<ReassignExecution> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const published = await getPublishedVersion();

  const moved: ReassignCounts = { publishedItems: 0, stagedItems: 0, draftPicks: 0, typeMappings: 0 };

  // 1) LIVE menu items.
  if (published) {
    const { data, error } = await admin
      .from("menu_items")
      .update({ category: to })
      .eq("menu_version_id", published.id)
      .eq("category", from)
      .select("id");
    if (error) return { ok: false, error: `Live menu update failed: ${error.message}` };
    moved.publishedItems = data?.length ?? 0;
  }

  // 2) Staged (unpublished) menu versions, so the next publish agrees.
  const { data: stagedVersions, error: stagedErr } = await admin
    .from("menu_versions")
    .select("id")
    .eq("status", "staged");
  if (stagedErr) return { ok: false, error: `Staged versions lookup failed: ${stagedErr.message}` };
  const stagedIds = ((stagedVersions as { id: string }[] | null) ?? []).map((v) => v.id);
  if (stagedIds.length > 0) {
    const { data, error } = await admin
      .from("menu_items")
      .update({ category: to })
      .in("menu_version_id", stagedIds)
      .eq("category", from)
      .select("id");
    if (error) return { ok: false, error: `Staged menu update failed: ${error.message}` };
    moved.stagedItems = data?.length ?? 0;
  }

  // 3) Onboarding draft picks (pre-0141 DBs have no column — skip gracefully).
  {
    const { data, error } = await admin
      .from("catalog_product_drafts")
      .update({ chosen_website_category: to })
      .eq("chosen_website_category", from)
      .select("id");
    if (error) {
      const missingColumn =
        error.code === "42703" || /column .* does not exist|could not find/i.test(error.message ?? "");
      if (!missingColumn) return { ok: false, error: `Draft picks update failed: ${error.message}` };
    } else {
      moved.draftPicks = data?.length ?? 0;
    }
  }

  // 4) Inventory-type mappings (drives FUTURE intake resolution).
  {
    const { data, error } = await admin
      .from("inventory_types")
      .update({ website_category: to })
      .eq("website_category", from)
      .select("id");
    if (error) return { ok: false, error: `Type mappings update failed: ${error.message}` };
    moved.typeMappings = data?.length ?? 0;
  }

  return { ok: true, moved };
}

/**
 * Live-menu category values that are MISSING from the registry (deleted rows
 * or import typos). Empty when everything resolves.
 */
export async function findMenuOrphans(): Promise<string[]> {
  if (!isSupabaseServiceConfigured) return [];
  const published = await getPublishedVersion();
  if (!published) return [];
  const admin = createSupabaseAdminClient();
  // SLICE 3: `.limit(5000)` never raised PostgREST's 1,000-row ceiling, so
  // this only inspected the first 1,000 live products. An orphaned category
  // (a deleted registry row or an import typo) sitting past the cap went
  // unreported, and products carrying it silently vanish from the menu's
  // category filters.
  const [items, registry] = await Promise.all([
    pagedAll<{ category: string | null }>(async (from, to) => {
      const { data } = await admin
        .from("menu_items")
        .select("category")
        .eq("menu_version_id", published.id)
        .order("id", { ascending: true })
        .range(from, to);
      return (data as { category: string | null }[] | null) ?? [];
    }),
    listWebsiteCategoryTypes({ includeInactive: true }),
  ]);
  const values = items.map((i) => i.category);
  return findOrphanCategoryValues(values, registry.map((r) => r.value));
}
