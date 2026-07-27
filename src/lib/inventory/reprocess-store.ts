/**
 * src/lib/inventory/reprocess-store.ts  (SLICE 67 — re-run intelligence)
 *
 * Server executor for the reprocess pass: reads existing inventory_lots and
 * the PUBLISHED menu version's items, asks the PURE planner
 * (reprocess-core.ts) what — if anything — each row is missing, and applies
 * the patches. Every decision lives in the planner; this module only reads
 * rows and writes verified fills.
 *
 * Scope (deliberate):
 *   - inventory_lots: every non-destroyed lot (the golden record — COAs,
 *     audits, and future re-processing read these columns).
 *   - menu_items: the PUBLISHED version only — the rows customers see right
 *     now. Staged versions are rebuilt by the next import/staging run, which
 *     already flows through the same engines.
 *
 * Fill-only and idempotent by construction (the planner returns null when
 * nothing verified is missing), so re-running the action is always safe.
 * Best-effort per row: one bad row logs and never aborts the pass.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  planLotReprocess,
  planMenuItemReprocess,
  type LotReprocessInput,
  type MenuItemReprocessInput,
} from "@/lib/inventory/reprocess-core";

export type ReprocessResult = {
  ok: boolean;
  lotsScanned: number;
  lotsPatched: number;
  itemsScanned: number;
  itemsPatched: number;
  /** Row-level write failures (logged server-side; the pass keeps going). */
  errors: number;
  message: string | null;
};

const PAGE = 500;

type LotRowRaw = Omit<
  LotReprocessInput,
  "lab_total_thc_pct" | "lab_thc_pct" | "lab_cbd_pct"
> & {
  lab_results:
    | { total_thc_pct: number | null; thc_pct: number | null; cbd_pct: number | null }
    | { total_thc_pct: number | null; thc_pct: number | null; cbd_pct: number | null }[]
    | null;
};

/**
 * Re-run the intelligence engines (fact extraction, house-type labeler,
 * display-name builder) over existing lots and the published menu.
 */
export async function reprocessIntelligence(): Promise<ReprocessResult> {
  const fail = (message: string): ReprocessResult => ({
    ok: false, lotsScanned: 0, lotsPatched: 0, itemsScanned: 0, itemsPatched: 0, errors: 0, message,
  });
  if (!isSupabaseServiceConfigured) return fail("The database isn't configured.");
  const admin = createSupabaseAdminClient();

  let lotsScanned = 0;
  let lotsPatched = 0;
  let itemsScanned = 0;
  let itemsPatched = 0;
  let errors = 0;

  // ---- 1) inventory_lots (paged; lab numbers joined for the cross-exam) ----
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select(
        "id, product_name, inventory_type, strain_type, servings_per_pack, mg_per_serving, package_thc_mg, package_cbd_mg, ratio_label, minor_cannabinoids_json, fact_provenance, lab_results ( total_thc_pct, thc_pct, cbd_pct )",
      )
      .neq("status", "destroyed")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return fail(`Couldn't read the lots: ${error.message}`);
    const rows = (data as unknown as LotRowRaw[] | null) ?? [];
    for (const r of rows) {
      lotsScanned += 1;
      const lab = Array.isArray(r.lab_results) ? r.lab_results[0] ?? null : r.lab_results;
      const patch = planLotReprocess({
        ...r,
        lab_total_thc_pct: lab?.total_thc_pct ?? null,
        lab_thc_pct: lab?.thc_pct ?? null,
        lab_cbd_pct: lab?.cbd_pct ?? null,
      });
      if (!patch) continue;
      const { error: uErr } = await admin
        .from("inventory_lots")
        .update(patch.update)
        .eq("id", r.id);
      if (uErr) {
        errors += 1;
        console.error(`[reprocess] lot ${r.id} update failed:`, uErr.message);
      } else {
        lotsPatched += 1;
        console.log(`[reprocess] lot ${r.id}: ${patch.notes.join("; ")}`);
      }
    }
    if (rows.length < PAGE) break;
  }

  // ---- 2) menu_items on the PUBLISHED version (paged) ----------------------
  const published = await getPublishedVersion();
  if (published) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("menu_items")
        .select(
          "id, name, product_name, brand_name, vendor_name, category, strain_type, strain_name, pos_inventory_type, pos_inventory_category, thc, servings_per_pack, mg_per_serving, package_thc_mg, package_cbd_mg, ratio_label, compounds_json, fact_provenance",
        )
        .eq("menu_version_id", published.id)
        .order("sort_order", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return fail(`Couldn't read the published menu items: ${error.message}`);
      const rows = (data as unknown as MenuItemReprocessInput[] | null) ?? [];
      for (const r of rows) {
        itemsScanned += 1;
        const patch = planMenuItemReprocess(r);
        if (!patch) continue;
        const { error: uErr } = await admin
          .from("menu_items")
          .update(patch.update)
          .eq("id", r.id);
        if (uErr) {
          errors += 1;
          console.error(`[reprocess] menu item ${r.id} update failed:`, uErr.message);
        } else {
          itemsPatched += 1;
          console.log(`[reprocess] menu item ${r.id}: ${patch.notes.join("; ")}`);
        }
      }
      if (rows.length < PAGE) break;
    }
  }

  return {
    ok: true,
    lotsScanned,
    lotsPatched,
    itemsScanned,
    itemsPatched,
    errors,
    message: null,
  };
}
