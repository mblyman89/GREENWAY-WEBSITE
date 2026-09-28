/**
 * src/lib/pos/menu-imports-cutover.ts   (S21, bible F-075 / F-088)
 *
 * Database side of "has the one-time Cultivera import been completed?". Every
 * decision is made by the pure core (menu-imports-cutover-core.ts); this file
 * only reads. No new egress, no poll, no cron: it runs inside the Menu Imports
 * page render the owner already opens.
 *
 * Three bounded reads on menu_versions, named columns, the same filters as the
 * S18 guard's readCutoverDone (import_id set, is_test false, published_at set):
 *   1. the EARLIEST such row  (limit 1)  -> the one-time import
 *   2. the LATEST such row    (limit 1)  -> a later real upload, if any
 *   3. an exact HEAD count               -> how many real uploads went live
 * Any error or throw -> { done: false, unknown: true }: the page keeps the
 * pre-S21 layout. Never claims "done" on a guess.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  COMPLETED_IMPORT_SELECT,
  menuImportsCutover,
  type CutoverVersionRow,
  type MenuImportsCutover,
} from "@/lib/inventory/menu-imports-cutover-core";

export async function readMenuImportsCutover(): Promise<MenuImportsCutover> {
  try {
    const admin = createSupabaseAdminClient();
    const real = () =>
      admin
        .from("menu_versions")
        .select(COMPLETED_IMPORT_SELECT)
        .not("import_id", "is", null)
        .eq("is_test", false)
        .not("published_at", "is", null);
    const [earliest, latest, counted] = await Promise.all([
      real().order("published_at", { ascending: true }).limit(1).maybeSingle(),
      real().order("published_at", { ascending: false }).limit(1).maybeSingle(),
      admin
        .from("menu_versions")
        .select("id", { count: "exact", head: true })
        .not("import_id", "is", null)
        .eq("is_test", false)
        .not("published_at", "is", null),
    ]);
    const failed = Boolean(earliest.error || latest.error || counted.error);
    if (failed) {
      console.error(
        "[menu-imports-cutover] read error:",
        earliest.error?.message ?? latest.error?.message ?? counted.error?.message,
      );
    }
    return menuImportsCutover({
      earliest: (earliest.data as CutoverVersionRow | null) ?? null,
      latest: (latest.data as CutoverVersionRow | null) ?? null,
      count: counted.count ?? null,
      failed,
    });
  } catch (err) {
    console.error("[menu-imports-cutover] read exception:", err);
    return { done: false, unknown: true };
  }
}
