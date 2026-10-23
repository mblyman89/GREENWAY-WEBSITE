import "server-only";
/**
 * src/lib/promotions/bad-product-queue.ts  (R74 S27, owner round 12)
 *
 * Loader for the bad product queue. Reads the PUBLISHED menu (cards + sizes),
 * the guard's weighted-average cost map, the never-discount list and the
 * inventory lots, then hands everything to the pure buildBadProductQueue.
 *
 * Every read is paged or chunked (chunked-in.ts), so nothing is silently cut
 * at PostgREST's 1,000-row cap, and completeness is REPORTED: any failed or
 * truncated read sets `complete: false`. The page then says so, and the fix
 * actions refuse to act on a partial queue (fail closed).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { loadProductCostsChecked } from "@/lib/promotions/discount-engine";
import {
  buildBadProductQueue,
  type BadProductQueue,
  type QueueCard,
  type QueueLot,
} from "@/lib/promotions/bad-product-queue-core";

export type BadProductQueueLoad = {
  queue: BadProductQueue;
  /** False when any read failed or was cut short. Never act on a partial queue. */
  complete: boolean;
  /** Which reads failed (plain English, for the notice). */
  problems: string[];
  /** False when there is no published menu (nothing to judge). */
  hasMenu: boolean;
};

const EMPTY: BadProductQueue = {
  rows: [],
  counts: { no_price: 0, below_floor: 0, needs_category: 0, no_cost: 0, missing_coa: 0, hidden_with_stock: 0 },
  scanned: 0,
};

type ItemRow = {
  id: string;
  source_item_id: string;
  name: string;
  brand_name: string | null;
  category: string | null;
  filter_categories: string[] | null;
  price_minor_units: number | null;
  hidden: boolean | null;
  hidden_reason: string | null;
};
type VariantRow = { id: string; menu_item_id: string; price_minor_units: number | null };
type LotRow = {
  id: string;
  pos_product_key: string | null;
  status: string;
  on_hand_qty: number | null;
  lab_result_id: string | null;
  created_at: string;
};

export async function loadBadProductQueue(): Promise<BadProductQueueLoad> {
  if (!isSupabaseServiceConfigured) {
    return { queue: EMPTY, complete: false, problems: ["The database is not configured in this environment."], hasMenu: false };
  }
  const problems: string[] = [];
  try {
    const published = await getPublishedVersion();
    if (!published) return { queue: EMPTY, complete: true, problems, hasMenu: false };
    const admin = createSupabaseAdminClient();

    const itemsP = pagedAllChecked<ItemRow>(async (from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select("id, source_item_id, name, brand_name, category, filter_categories, price_minor_units, hidden, hidden_reason")
        .eq("menu_version_id", published.id)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        console.error("[bad-product-queue] menu_items read error:", error.message);
        return { rows: [], ok: false };
      }
      return { rows: (data as ItemRow[] | null) ?? [], ok: true };
    });
    const lotsP = pagedAllChecked<LotRow>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, pos_product_key, status, on_hand_qty, lab_result_id, created_at")
        .not("pos_product_key", "is", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        console.error("[bad-product-queue] inventory_lots read error:", error.message);
        return { rows: [], ok: false };
      }
      return { rows: (data as LotRow[] | null) ?? [], ok: true };
    });
    const neverP = pagedAllChecked<{ id: string; pos_product_key: string | null }>(async (from, to) => {
      const { data, error } = await admin
        .from("promotion_never_discount")
        .select("id, pos_product_key")
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        console.error("[bad-product-queue] never-discount read error:", error.message);
        return { rows: [], ok: false };
      }
      return { rows: (data as { id: string; pos_product_key: string | null }[] | null) ?? [], ok: true };
    });
    const [items, lots, costs, never] = await Promise.all([itemsP, lotsP, loadProductCostsChecked(), neverP]);
    if (!items.verdict.complete) problems.push(`menu cards: ${items.verdict.message}`);
    if (!lots.verdict.complete) problems.push(`inventory lots: ${lots.verdict.message}`);
    if (!costs.verdict.complete) problems.push(`costs: ${costs.verdict.message}`);
    if (!never.verdict.complete) problems.push(`never-discount list: ${never.verdict.message}`);
    const neverKeys = new Set(never.rows.map((r) => (r.pos_product_key ?? "").trim()).filter(Boolean));

    let variantsFailed = false;
    const variants = await chunkedIn<string, VariantRow>(
      items.rows.map((i) => i.id),
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_variants")
          .select("id, menu_item_id, price_minor_units")
          .in("menu_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[bad-product-queue] menu_variants read error:", error.message);
          variantsFailed = true;
          return [];
        }
        return (data as VariantRow[] | null) ?? [];
      },
      { chunkSize: 200, concurrency: MENU_READ_CONCURRENCY },
    );
    if (variantsFailed) problems.push("menu sizes: the read failed.");

    const pricesByItem = new Map<string, number[]>();
    for (const v of variants) {
      const list = pricesByItem.get(v.menu_item_id) ?? [];
      list.push(v.price_minor_units == null ? Number.NaN : Number(v.price_minor_units));
      pricesByItem.set(v.menu_item_id, list);
    }
    const cards: QueueCard[] = items.rows.map((i) => ({
      key: i.source_item_id,
      name: i.name,
      brand: i.brand_name ?? "",
      categories: (i.filter_categories?.length ? i.filter_categories : [i.category ?? ""]).map((c) => String(c).toLowerCase()),
      priceMinor: i.price_minor_units == null ? Number.NaN : Number(i.price_minor_units),
      hidden: i.hidden === true,
      hiddenReason: i.hidden_reason,
      variantPrices: pricesByItem.get(i.id) ?? [],
    }));
    const queueLots: QueueLot[] = lots.rows.map((l) => ({
      id: l.id,
      key: l.pos_product_key,
      status: l.status,
      onHand: Number(l.on_hand_qty ?? 0),
      hasCoa: !!l.lab_result_id,
      createdAt: l.created_at,
    }));
    const queue = buildBadProductQueue({ cards, costs: costs.costs, neverKeys, lots: queueLots });
    return { queue, complete: problems.length === 0, problems, hasMenu: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bad-product-queue] load exception:", msg);
    return { queue: EMPTY, complete: false, problems: [`the queue could not be read (${msg}).`], hasMenu: true };
  }
}
