/**
 * D244 E-1 — the reads behind the vendor-first, on-hand-first worklist.
 *
 * Read-only, named columns, bounded. Every read is best-effort: on failure it
 * returns null and the page falls back (vendor filter off / no quantity
 * column) and SAYS so, instead of showing a silently short list.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import type { QtyLot, VendorLookups } from "./worklist-core";

export type WorklistVendorData = VendorLookups & { labels: Map<string, string> };

const low = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Vendors, vendor aliases and brands (3 small reads, in parallel). */
export async function readWorklistVendorData(): Promise<WorklistVendorData | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const [v, a, b] = await Promise.all([
      admin.from("vendors").select("id, display_name").order("display_name", { ascending: true }).range(0, 4999),
      admin.from("vendor_aliases").select("vendor_id, source_name").range(0, 9999),
      admin.from("brands").select("display_name, vendor_id").range(0, 9999),
    ]);
    if (v.error) {
      console.error("[worklist] vendor read failed:", v.error.message);
      return null;
    }
    const labels = new Map<string, string>();
    const vendorByName = new Map<string, string>();
    for (const row of (v.data as { id: string; display_name: string }[] | null) ?? []) {
      const id = low(row.id);
      if (!id) continue;
      labels.set(id, row.display_name);
      const n = low(row.display_name);
      if (n && !vendorByName.has(n)) vendorByName.set(n, id);
    }
    for (const row of (a.data as { vendor_id: string; source_name: string }[] | null) ?? []) {
      const n = low(row.source_name);
      if (n && !vendorByName.has(n)) vendorByName.set(n, low(row.vendor_id));
    }
    const brandVendor = new Map<string, string>();
    for (const row of (b.data as { display_name: string; vendor_id: string | null }[] | null) ?? []) {
      const n = low(row.display_name);
      const vid = low(row.vendor_id);
      if (n && vid && !brandVendor.has(n)) brandVendor.set(n, vid);
    }
    return { known: new Set(labels.keys()), labels, brandVendor, vendorByName };
  } catch (err) {
    console.error("[worklist] vendor data threw:", err);
    return null;
  }
}

/** inventory_lots on-hand quantity for the given lot keys (null on failure). */
export async function readOnHandLots(lotKeys: readonly string[]): Promise<QtyLot[] | null> {
  if (!isSupabaseServiceConfigured) return null;
  if (lotKeys.length === 0) return [];
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    const rows = await chunkedIn<string, QtyLot & { id: string }>(
      lotKeys,
      async (chunk, from, to) => {
        if (failed) return [];
        const { data, error } = await admin
          .from("inventory_lots")
          .select("id, pos_product_key, on_hand_qty")
          .in("pos_product_key", chunk)
          .gt("on_hand_qty", 0)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          failed = true;
          console.error("[worklist] on-hand read failed:", error.message);
          return [];
        }
        return (data as unknown as (QtyLot & { id: string })[] | null) ?? [];
      },
      { concurrency: MENU_READ_CONCURRENCY },
    );
    return failed ? null : rows;
  } catch (err) {
    console.error("[worklist] on-hand read threw:", err);
    return null;
  }
}
