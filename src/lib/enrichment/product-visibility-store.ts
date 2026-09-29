/**
 * src/lib/enrichment/product-visibility-store.ts  (Round 12 — Cultivera fix reachability)
 *
 * WRITE path for the product page's Visibility control. Applies the pure plan
 * (product-visibility-core.ts) to `menu_items.hidden` / `hidden_reason` for
 * ONE product key on every LIVE menu version: the published version (so the
 * website + register change now) and any staged intake versions (so a
 * pending publish carries the same decision). That is the same version set
 * the lot price write uses (price-write-store.ts applyLotAfterTaxPrice), and
 * the card is located the same way: `menu_items.source_item_id = key`.
 *
 * Never throws to the caller — failures come back as { ok:false }.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";
import {
  planRowVisibility,
  type MenuRowVisibility,
  type VisibilityChoice,
} from "@/lib/enrichment/product-visibility-core";

export type VisibilityWriteRow = {
  versionId: string;
  versionStatus: "published" | "staged";
  itemId: string;
  before: MenuRowVisibility;
  after: MenuRowVisibility;
};

export type VisibilityWriteResult =
  | { ok: true; changed: VisibilityWriteRow[]; rowsSeen: number }
  | { ok: false; error: string };

export async function applyProductVisibility(
  posProductKey: string,
  choice: VisibilityChoice,
): Promise<VisibilityWriteResult> {
  const key = (posProductKey ?? "").trim();
  if (!key) return { ok: false, error: "Missing product key." };
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "The menu database isn't configured in this environment, so visibility can't be changed on the live menu." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const [published, staged] = await Promise.all([getPublishedVersion(), listIntakeStagedVersions(30)]);
    const versions: { id: string; status: "published" | "staged" }[] = [];
    if (published) versions.push({ id: published.id, status: "published" });
    for (const v of staged) versions.push({ id: v.id, status: "staged" });
    if (versions.length === 0) return { ok: true, changed: [], rowsSeen: 0 };

    const { data, error } = await admin
      .from("menu_items")
      .select("id, menu_version_id, hidden, hidden_reason")
      .in("menu_version_id", versions.map((v) => v.id))
      .eq("source_item_id", key);
    if (error) throw new Error(`load cards: ${error.message}`);
    const rows = (data as { id: string; menu_version_id: string; hidden: boolean; hidden_reason: string | null }[] | null) ?? [];
    const statusById = new Map(versions.map((v) => [v.id, v.status]));

    const changed: VisibilityWriteRow[] = [];
    for (const row of rows) {
      const before = { hidden: row.hidden === true, hidden_reason: row.hidden_reason ?? null };
      const after = planRowVisibility(before, choice);
      if (!after) continue;
      const { error: uErr } = await admin
        .from("menu_items")
        .update({ hidden: after.hidden, hidden_reason: after.hidden_reason })
        .eq("id", row.id);
      if (uErr) throw new Error(`update card: ${uErr.message}`);
      changed.push({
        versionId: row.menu_version_id,
        versionStatus: statusById.get(row.menu_version_id) ?? "staged",
        itemId: row.id,
        before,
        after,
      });
    }
    return { ok: true, changed, rowsSeen: rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Changing visibility on the live menu failed: ${msg}` };
  }
}
