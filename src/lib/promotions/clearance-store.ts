/**
 * src/lib/promotions/clearance-store.ts   (Fix Phase 4.5b · F-06-17)
 *
 * SERVER-ONLY reads for Promotions → Clearance markdowns. Every rule lives in
 * the PURE clearance-core.ts; this file only gathers:
 *   - the Active lots with stock (paged and CHECKED: a short or failed read is
 *     refused, never shown as "nothing to clear"),
 *   - the published menu (price, name, brand by register product key),
 *   - the never-discount keys,
 *   - the markdown promotions that already exist (not archived) and their
 *     product targets.
 * It writes nothing; the action creates the draft through createPromotion.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { expiryKindFor } from "@/lib/inventory/expired-stock-core";
import { listNeverDiscountKeys } from "./promotions-store";
import { isMarkdownConfig } from "./markdown-lock-core";
import type { ClearanceLot, ClearanceMenuItem, ExistingMarkdown } from "./clearance-core";

export type ClearanceInputs = {
  lots: ClearanceLot[];
  menu: Map<string, ClearanceMenuItem>;
  neverDiscount: Set<string>;
  existing: Map<string, ExistingMarkdown[]>;
  menuPublished: boolean;
};

export type ClearanceRead = { ok: true; data: ClearanceInputs } | { ok: false; error: string };

type LotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  on_hand_qty: number | string | null;
  unit_cost_minor_units: number | string | null;
  expires_on: string | null;
  received_on: string | null;
  created_at: string | null;
  category: string | null;
  inventory_type: string | null;
  is_sample: boolean | null;
};

type MenuRow = { source_item_id: string; name: string; brand_name: string | null; price_minor_units: number };

function text(err: unknown): string {
  return err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
}

function intOrNull(v: number | string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function loadClearanceInputs(): Promise<ClearanceRead> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured in this environment." };
  const admin = createSupabaseAdminClient();

  const lotsP = pagedAllChecked<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, pos_product_key, product_name, on_hand_qty, unit_cost_minor_units, expires_on, received_on, created_at, category, inventory_type, is_sample")
      .eq("status", "active")
      .gt("on_hand_qty", 0)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as LotRow[] | null) ?? [], ok: true };
  });

  const versionP = getPublishedVersion();
  const neverP = listNeverDiscountKeys();

  const [lotRes, version, never] = await Promise.all([lotsP, versionP, neverP]);
  if (!lotRes.verdict.complete) {
    return { ok: false, error: "The lots could not be read in full, so no clearance list is shown (a short list would hide products). Reload the page." };
  }

  const menu = new Map<string, ClearanceMenuItem>();
  if (version) {
    const items = await pagedAllChecked<MenuRow>(async (from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select("source_item_id, name, brand_name, price_minor_units")
        .eq("menu_version_id", version.id)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as MenuRow[] | null) ?? [], ok: true };
    });
    if (!items.verdict.complete) {
      return { ok: false, error: "The published menu could not be read in full, so prices are unknown. Reload the page." };
    }
    for (const r of items.rows) {
      if (!r.source_item_id || !Number.isInteger(r.price_minor_units)) continue;
      menu.set(r.source_item_id, { name: r.name, brand: r.brand_name ?? "", priceMinorUnits: r.price_minor_units });
    }
  }

  // Markdowns that already exist (draft / scheduled / published), by product key.
  const existing = new Map<string, ExistingMarkdown[]>();
  try {
    const { data: promos, error } = await admin
      .from("promotions")
      .select("id, title, status, discount_percent, config")
      .neq("status", "archived");
    if (error) throw error;
    const md = ((promos ?? []) as { id: string; title: string; status: string; discount_percent: number; config: Record<string, unknown> | null }[]).filter((p) =>
      isMarkdownConfig(p.config),
    );
    if (md.length > 0) {
      const byId = new Map(md.map((p) => [p.id, p]));
      const targets = await chunkedIn<string, { promotion_id: string; scope: string; value: string | null }>(md.map((p) => p.id), async (chunk, from, to) => {
        const { data, error: e } = await admin
          .from("promotion_targets")
          .select("promotion_id, scope, value")
          .in("promotion_id", chunk as string[])
          .order("id", { ascending: true })
          .range(from, to);
        if (e) throw e;
        return (data ?? []) as { promotion_id: string; scope: string; value: string | null }[];
      });
      for (const t of targets) {
        if (t.scope !== "product" || !t.value) continue;
        const p = byId.get(t.promotion_id);
        if (!p) continue;
        const list = existing.get(t.value) ?? [];
        list.push({ promotionId: p.id, title: p.title, status: p.status, percent: Number(p.discount_percent) || 0 });
        existing.set(t.value, list);
      }
    }
  } catch (err) {
    return { ok: false, error: `The existing markdowns could not be read, so a product could be marked down twice: ${text(err)}` };
  }

  const lots: ClearanceLot[] = [];
  for (const r of lotRes.rows) {
    if (r.is_sample === true) continue; // samples are never sold (G-51)
    const onHand = Number(r.on_hand_qty ?? 0);
    if (!Number.isFinite(onHand) || onHand <= 0) continue;
    const created = r.created_at ? r.created_at.slice(0, 10) : null;
    lots.push({
      lotId: r.id,
      lotCode: r.lot_code,
      posProductKey: r.pos_product_key,
      productName: r.product_name,
      onHandQty: onHand,
      unitCostMinorUnits: intOrNull(r.unit_cost_minor_units),
      expiresOn: r.expires_on,
      receivedOn: r.received_on ?? created,
      receivedIsGuess: !r.received_on,
      expiredKind: expiryKindFor({ category: r.category, inventoryType: r.inventory_type, productName: r.product_name }),
    });
  }

  return { ok: true, data: { lots, menu, neverDiscount: new Set(never), existing, menuPublished: !!version } };
}
