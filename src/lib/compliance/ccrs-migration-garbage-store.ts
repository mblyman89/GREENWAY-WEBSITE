/**
 * src/lib/compliance/ccrs-migration-garbage-store.ts — R50 S10c (D-15)
 *
 * READ-ONLY server side of ccrs-migration-garbage-core.ts. It writes nothing:
 * zeroing goes through the existing R15b screen (legacy-lot-removal-store),
 * which already asks for a typed confirmation.
 *
 * The migration import is the one-time Cultivera import (readMenuImportsCutover
 * `first`). From it: the newest menu version's cards, the lots on that
 * import's manifests (import-lineage-store, which throws on a short read), the
 * import's diagnostics (a checked read), and the CCRS ledger slice for those
 * lots' ids. Fail-closed: any short read → { ok:false }, never a partial list.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readMenuImportsCutover } from "@/lib/pos/menu-imports-cutover";
import { getVersionItems, countVersionItems, getImportDiagnosticsChecked } from "@/lib/pos/menu-version";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import { loadLedgerForBatch } from "@/lib/compliance/ccrs-ledger-store";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { buildGarbageReport, type GarbageReport } from "@/lib/compliance/ccrs-migration-garbage-core";

type LotRow = {
  id: string;
  pos_product_key: string | null;
  lot_code: string | null;
  ccrs_inventory_external_id: string | null;
  on_hand_qty: number | string | null;
  status: string | null;
  product_name: string | null;
};

export const GARBAGE_LOT_SELECT = "id, pos_product_key, lot_code, ccrs_inventory_external_id, on_hand_qty, status, product_name";

export type GarbageLoad =
  | { ok: true; state: "no_migration" }
  | { ok: true; state: "ready"; importId: string; report: GarbageReport; ledgerAbsentReason: string | null }
  | { ok: false; error: string };

export async function loadMigrationGarbage(env: LedgerEnv): Promise<GarbageLoad> {
  try {
    const cut = await readMenuImportsCutover();
    if (!cut.done) {
      return cut.unknown ? { ok: false, error: "Could not read whether the Cultivera import is done." } : { ok: true, state: "no_migration" };
    }
    const importId = cut.first.importId;
    const admin = createSupabaseAdminClient();
    // Same version R15b reads (the newest for this import), so both screens agree.
    const { data: vrows, error: verr } = await admin
      .from("menu_versions")
      .select("id, created_at")
      .eq("import_id", importId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (verr) return { ok: false, error: `Could not read the import's menu version. ${verr.message}` };
    const versionId = ((vrows ?? [])[0] as { id: string } | undefined)?.id ?? cut.first.versionId;
    // getVersionItems answers [] on a read error; a count witness tells that
    // apart from a real empty menu (an empty list would hide every dead card).
    const expected = await countVersionItems(versionId);
    const items = await getVersionItems(versionId);
    if (expected === null || items.length !== expected) {
      return { ok: false, error: "Could not read every product card of the Cultivera import." };
    }
    const manifestIds = await importManifestIds(admin, importId);
    const lots = manifestIds.length ? await readLotsOnManifests<LotRow>(admin, manifestIds, GARBAGE_LOT_SELECT) : [];
    const diags = await getImportDiagnosticsChecked(importId);
    if (!diags.verdict.complete) return { ok: false, error: `Could not read every import warning. ${diags.verdict.message}` };
    const ids = [...new Set(lots.map((l) => (l.ccrs_inventory_external_id ?? "").trim()).filter(Boolean))];
    const slice = await loadLedgerForBatch(admin, env, ids, []);
    const view = slice.kind === "loaded" ? slice.ledger.view : null;
    const report = buildGarbageReport({
      items: items.map((i) => ({ sourceItemId: i.source_item_id, hidden: i.hidden, hiddenReason: i.hidden_reason })),
      lots: lots.map((l) => ({
        id: l.id,
        posProductKey: l.pos_product_key,
        lotCode: l.lot_code,
        ccrsExternalId: l.ccrs_inventory_external_id,
        onHandQty: l.on_hand_qty,
        status: l.status,
        productName: l.product_name,
      })),
      diagnostics: diags.rows.map((d) => ({ code: d.code })),
      view,
    });
    return { ok: true, state: "ready", importId, report, ledgerAbsentReason: slice.kind === "absent" ? slice.reason : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
