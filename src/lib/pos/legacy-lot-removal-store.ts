/**
 * src/lib/pos/legacy-lot-removal-store.ts — R15b server side of
 * legacy-lot-removal-core.ts. Reads the lots behind this import's
 * `no_product_master` cards and, on a confirmed press, adjusts each out with a
 * CCRS Reconciliation adjustment (reason "count") — the same
 * insert-adjustment-then-atomic-delta shape disposition.ts postRemoval uses,
 * including removing the ledger row when the atomic write is refused.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { applyLotDelta } from "@/lib/inventory/atomic-quantity";
import { getVersionItems } from "@/lib/pos/menu-version";
import {
  planLegacyRemoval,
  LEGACY_REMOVAL_REASON,
  type LegacyLotInput,
  type LegacyRemovalPlan,
} from "@/lib/pos/legacy-lot-removal-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type LotRow = {
  id: string;
  pos_product_key: string | null;
  on_hand_qty: number | string | null;
  status: string | null;
  product_name: string | null;
  lot_code: string | null;
};

async function importManifestId(admin: Admin, importId: string): Promise<string | null> {
  // import-service.ts createImportLots: one synthetic manifest per import.
  const { data } = await admin
    .from("inbound_manifests")
    .select("id")
    .eq("manifest_number", `POS-IMPORT-${importId.slice(0, 8)}`)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function loadLegacyRemovalPlan(
  importId: string,
): Promise<{ plan: LegacyRemovalPlan; flaggedCards: number; manifestFound: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: vrows } = await admin
    .from("menu_versions")
    .select("id, created_at")
    .eq("import_id", importId)
    .order("created_at", { ascending: false })
    .limit(1);
  const vid = ((vrows ?? [])[0] as { id: string } | undefined)?.id ?? null;
  const empty = planLegacyRemoval([], new Set());
  if (!vid) return { plan: empty, flaggedCards: 0, manifestFound: false };
  const items = await getVersionItems(vid);
  const keys = new Set(items.filter((i) => i.hidden && i.hidden_reason === "no_product_master").map((i) => i.source_item_id));
  const manifestId = await importManifestId(admin, importId);
  if (!manifestId || keys.size === 0) return { plan: empty, flaggedCards: keys.size, manifestFound: Boolean(manifestId) };
  let failed: string | null = null;
  const lots = await chunkedIn<string, LotRow>([...keys], async (chunk, from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, pos_product_key, on_hand_qty, status, product_name, lot_code")
      .eq("manifest_id", manifestId)
      .in("pos_product_key", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) { failed = error.message; return []; }
    return (data ?? []) as LotRow[];
  });
  // A partial read would under-count what is removed; refuse instead.
  if (failed) throw new Error(`Could not read the flagged lots: ${failed}`);
  const input: LegacyLotInput[] = lots.map((l) => ({
    id: l.id,
    posProductKey: l.pos_product_key,
    onHandQty: l.on_hand_qty,
    status: l.status,
    productName: l.product_name,
    lotCode: l.lot_code,
  }));
  return { plan: planLegacyRemoval(input, keys), flaggedCards: keys.size, manifestFound: true };
}

/** Adjust every planned lot out. Per-lot failures are counted and reported, never hidden. */
export async function adjustOutLegacyLots(
  plan: LegacyRemovalPlan,
  note: string,
  actorId: string | null,
): Promise<{ removed: number; units: number; failed: { id: string; error: string }[] }> {
  const admin = createSupabaseAdminClient();
  let removed = 0;
  let units = 0;
  const failed: { id: string; error: string }[] = [];
  const queue = [...plan.rows];
  const worker = async () => {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      const { data: adj, error: insErr } = await admin
        .from("inventory_adjustments")
        .insert({ lot_id: r.id, qty_delta: -r.qty, reason: LEGACY_REMOVAL_REASON, note, actor_id: actorId })
        .select("id")
        .single();
      if (insErr || !adj) { failed.push({ id: r.id, error: insErr?.message ?? "adjustment not saved" }); continue; }
      const written = await applyLotDelta(admin, {
        lotId: r.id,
        delta: -r.qty,
        clamp: false, // STRICT: refused if a sale moved the stock since the preview
        actorId,
        autoStatus: true, // active → sold_out at zero
        fallbackAbsolute: { onHandQty: 0, status: "sold_out", updatedBy: actorId },
      });
      if (!written.ok) {
        await admin.from("inventory_adjustments").delete().eq("id", (adj as { id: string }).id);
        failed.push({ id: r.id, error: written.error ?? "lot not updated" });
        continue;
      }
      removed += 1;
      units += r.qty;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()));
  return { removed, units, failed };
}
