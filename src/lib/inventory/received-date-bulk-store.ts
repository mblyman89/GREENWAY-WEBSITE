/**
 * src/lib/inventory/received-date-bulk-store.ts — R16b server side of
 * received-date-bulk-core.ts.
 *
 * Reads the lots one Cultivera import created WITHOUT a received date (they
 * hang off the import's synthetic manifest `POS-IMPORT-<id8>`, import-service.ts
 * createImportLots — same lookup as legacy-lot-removal-store.ts), and writes an
 * owner-entered date with the same provenance columns the single-lot path uses
 * (store.ts updateLotReceivedDate): received_on_source "owner_entered",
 * received_on_set_by / _set_at. Every update is guarded by
 * `received_on is null`, so a date is never overwritten.
 *
 * Reads use pagedAllChecked; a partial read is refused (never a short list
 * presented as the whole answer).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import type { UndatedLot } from "@/lib/inventory/received-date-bulk-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type LotRow = {
  id: string;
  vendor_id: string | null;
  product_name: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  on_hand_qty: number | string | null;
  received_on: string | null;
};

async function importManifestId(admin: Admin, importId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("inbound_manifests")
    .select("id")
    .eq("manifest_number", `POS-IMPORT-${importId.slice(0, 8)}`)
    .maybeSingle();
  if (error) throw new Error(`Could not find this import's lots: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

export type UndatedLotsLoad = {
  manifestFound: boolean;
  lots: UndatedLot[];
  /** Lots of this import that already carry a date (context for the header). */
  datedCount: number;
};

/** Every non-destroyed lot of this import with no received date, plus dated-sibling references. */
export async function loadUndatedImportLots(importId: string): Promise<UndatedLotsLoad> {
  const admin = createSupabaseAdminClient();
  const manifestId = await importManifestId(admin, importId);
  if (!manifestId) return { manifestFound: false, lots: [], datedCount: 0 };

  const read = await pagedAllChecked<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, vendor_id, product_name, lot_code, pos_product_key, on_hand_qty, received_on")
      .eq("manifest_id", manifestId)
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data ?? []) as LotRow[] };
  });
  if (!read.verdict.complete) throw new Error(`Could not read every lot of this import. ${read.verdict.message}`);

  const undated = read.rows.filter((r) => !r.received_on);
  const siblings = new Map<string, Set<string>>();
  for (const r of read.rows) {
    if (!r.received_on || !r.pos_product_key) continue;
    const s = siblings.get(r.pos_product_key) ?? new Set<string>();
    s.add(r.received_on);
    siblings.set(r.pos_product_key, s);
  }

  const vendorIds = [...new Set(undated.map((r) => r.vendor_id).filter(Boolean))] as string[];
  const vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    let vErr: string | null = null;
    const rows = await chunkedIn<string, { id: string; display_name: string | null }>(vendorIds, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("vendors")
        .select("id, display_name")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) { vErr = error.message; return []; }
      return (data ?? []) as { id: string; display_name: string | null }[];
    });
    if (vErr) throw new Error(`Could not read the vendor names: ${vErr}`);
    for (const v of rows) vendorMap.set(v.id, v.display_name ?? "");
  }

  const lots: UndatedLot[] = undated.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    vendorName: r.vendor_id ? vendorMap.get(r.vendor_id) ?? null : null,
    productName: r.product_name,
    lotCode: r.lot_code,
    posProductKey: r.pos_product_key,
    onHandQty: Number(r.on_hand_qty ?? 0) || 0,
    siblingDates: r.pos_product_key ? [...(siblings.get(r.pos_product_key) ?? [])].sort() : [],
  }));
  return { manifestFound: true, lots, datedCount: read.rows.length - undated.length };
}

/**
 * Write one owner-entered date to many lots. Only lots of THIS import that are
 * still undated are touched (manifest + `received_on is null` guard).
 * Returns the ids actually written.
 */
export async function setImportLotsReceivedDate(
  importId: string,
  lotIds: readonly string[],
  receivedOn: string,
  actorId: string | null,
): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const manifestId = await importManifestId(admin, importId);
  if (!manifestId) throw new Error("This import's lots were not found.");
  const written: string[] = [];
  const at = new Date().toISOString();
  for (let i = 0; i < lotIds.length; i += 200) {
    const chunk = lotIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("inventory_lots")
      .update({
        received_on: receivedOn,
        received_on_source: "owner_entered",
        received_on_set_by: actorId,
        received_on_set_at: at,
        updated_by: actorId,
      })
      .in("id", chunk)
      .eq("manifest_id", manifestId)
      .is("received_on", null)
      .select("id");
    if (error) {
      throw new Error(
        `${written.length} lot(s) were dated, then the save stopped: ${error.message}. Reload — the dated lots are no longer listed.`,
      );
    }
    for (const r of (data ?? []) as { id: string }[]) written.push(r.id);
  }
  return written;
}
