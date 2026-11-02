/**
 * src/lib/pos/register-fix-later-store.ts  (register-sell-everything-fix-later)
 *
 * Server read for the back office "Fix later" list. The owner, verbatim:
 * "let the system fix it for me so it can be sold, then set that item aside
 * so I can fix it properly."
 *
 * Reads every stocked lot, its lab result, recall holds, open destructions,
 * the published menu's keys and the register's `register.fix_and_sell` audit
 * rows, then hands them to the pure stockCoverage() so the page can say, in
 * one sentence, whether every lot with stock sells, and list what to fix.
 *
 * Read-only. Never changes a lot.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { OPEN_DESTRUCTION_STATUSES } from "@/lib/inventory/destruction-lot-status-core";
import { sellableQty } from "@/lib/inventory/held-stock-core";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import {
  REGISTER_FIX_AND_SELL_AUDIT_ACTION,
  stockCoverage,
  type FixLaterLot,
  type StockCoverage,
} from "@/lib/pos/register-fix-later-core";

type Row = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  status: string | null;
  on_hand_qty: number | string | null;
  held_qty?: number | string | null;
  product_name: string | null;
  unit_cost_minor_units: number | null;
  category: string | null;
  inventory_type: string | null;
  lab_result_id: string | null;
  is_sample: boolean | null;
};

export type FixLaterRead =
  | { ok: true; coverage: StockCoverage; lots: Map<string, FixLaterLot & { lotCode: string | null }>; complete: boolean }
  | { ok: false; error: string };

export async function readFixLaterCoverage(): Promise<FixLaterRead> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const COLS =
    "id, lot_code, pos_product_key, status, on_hand_qty, held_qty, product_name, unit_cost_minor_units, category, inventory_type, lab_result_id, is_sample";
  const { rows, verdict } = await pagedAllChecked<Row>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select(COLS)
      .gt("on_hand_qty", 0)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as unknown as Row[] | null) ?? [], ok: true };
  });
  if (rows.length === 0 && !verdict.complete) return { ok: false, error: "Could not read the inventory lots." };

  const labIds = [...new Set(rows.map((r) => r.lab_result_id).filter((v): v is string => !!v))];
  const labPassed = new Map<string, boolean | null>();
  for (let i = 0; i < labIds.length; i += 200) {
    const { data } = await admin.from("lab_results").select("id, passed").in("id", labIds.slice(i, i + 200));
    for (const r of (data as { id: string; passed: boolean | null }[] | null) ?? []) labPassed.set(r.id, r.passed);
  }

  let recalled = new Set<string>();
  try {
    recalled = await recalledProductKeys();
  } catch {
    recalled = new Set();
  }

  const { data: dRows } = await admin.from("destruction_events").select("lot_id").in("status", [...OPEN_DESTRUCTION_STATUSES]);
  const destructionHeld = new Set(((dRows as { lot_id: string | null }[] | null) ?? []).map((d) => d.lot_id ?? "").filter(Boolean));

  const menuKeys = new Set<string>();
  try {
    for (const item of await loadLiveMenuAll()) {
      menuKeys.add(item.id);
      for (const v of item.variants) {
        const k = lotKeyFromVariantId(v.id);
        if (k) menuKeys.add(k);
      }
    }
  } catch {
    // Menu read failed: do not claim lots lack a menu product.
  }

  const fixedIds = new Set<string>();
  const { data: aRows } = await admin
    .from("audit_logs")
    .select("entity_id")
    .eq("action", REGISTER_FIX_AND_SELL_AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(2000);
  for (const a of (aRows as { entity_id: string | null }[] | null) ?? []) if (a.entity_id) fixedIds.add(a.entity_id);

  const lots = new Map<string, FixLaterLot & { lotCode: string | null }>();
  const facts: FixLaterLot[] = rows.map((r) => {
    const key = (r.pos_product_key ?? "").trim();
    const fact: FixLaterLot = {
      id: r.id,
      posProductKey: r.pos_product_key,
      lotCode: r.lot_code,
      productName: r.product_name,
      status: r.status,
      onHandQty: sellableQty(r.on_hand_qty, r.held_qty),
      category: r.category,
      inventoryType: r.inventory_type,
      unitCostMinor: r.unit_cost_minor_units,
      hasLabResult: !!r.lab_result_id,
      labPassed: r.lab_result_id ? (labPassed.get(r.lab_result_id) ?? null) : null,
      isSample: r.is_sample,
      recalled: key ? recalled.has(key) : false,
      scheduledForDestruction: destructionHeld.has(r.id),
      hasMenuProduct: menuKeys.size === 0 ? undefined : key ? menuKeys.has(key) : false,
      fixedAtRegister: fixedIds.has(r.id),
    };
    lots.set(r.id, { ...fact, lotCode: r.lot_code });
    return fact;
  });
  return { ok: true, coverage: stockCoverage(facts), lots, complete: verdict.complete };
}
