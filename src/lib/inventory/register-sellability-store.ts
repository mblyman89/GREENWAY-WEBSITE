import "server-only";

/**
 * src/lib/inventory/register-sellability-store.ts   (SLICE 16)
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE REAL FAILURE THIS CLOSES
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The register fix in `register-availability-core.ts` repairs stale
 * availability automatically. But the owner still found this fault the worst
 * possible way: standing at the counter with a customer, scanning packages one
 * at a time to work out which ones his own register would refuse to sell.
 *
 * A fix that only repairs the data leaves that discovery problem in place.
 * There are causes the register CANNOT self-heal — a lot with no product link,
 * a lot with stock that never made it onto the published menu, a card a human
 * hid — and today nothing in the back office says a word about any of them.
 *
 * This module answers, for the inventory page: "which lots that have real
 * stock on hand cannot be sold at the register right now, and why?"
 *
 * All decisions live in the PURE core (`diagnoseLot` / `summarizeSellability`)
 * so they are testable without a database and can never drift from what
 * `/api/pos/menu` actually does. This file only fetches rows.
 *
 * BEST-EFFORT BY DESIGN: every failure path returns "no verdict" rather than a
 * wrong one. A banner that cannot prove its claim must not make one — an
 * inventory page that breaks because a diagnostic read failed would be a far
 * worse bug than the one being diagnosed.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import {
  diagnoseLot,
  summarizeSellability,
  toQty,
  statusForUnits,
  normalizeKey,
  SELLABLE_LOT_STATUS,
  type LiveLotFact,
  type LotDiagnosis,
  type SellabilitySummary,
  type SnapshotCard,
  type InventoryStatusSlug,
} from "@/lib/pos/register-availability-core";

export type RegisterSellabilityReport = {
  /** Null when we could not read enough to be sure. Never a guessed verdict. */
  summary: SellabilitySummary | null;
  /** Blocked lots that HOLD STOCK, worst first. Capped for display. */
  blocked: LotDiagnosis[];
  /**
   * SLICE 18 - products flagged "unavailable" on the published menu that have
   * REAL sellable stock behind them right now. These are the 86 presses that
   * should be undone.
   *
   * Slice 16's reader already lets the register sell these again, so the till
   * is not blocked waiting for anyone. What is still wrong is the STORED
   * status: the back office, the website and every report still read
   * "unavailable" and disagree with the register. Restoring writes the truth
   * back so all four surfaces agree.
   */
  restorable: RestorableProduct[];
};

/** One 86'd product that live stock contradicts. */
export type RestorableProduct = {
  /** `menu_items.source_item_id` == `inventory_lots.pos_product_key`. */
  productKey: string;
  name: string;
  /** Sellable units across ACTIVE lots. Always > 0 for a restorable entry. */
  units: number;
  /** The status a restore would write, computed from `units`. */
  nextStatus: InventoryStatusSlug;
};

/** How many restorable products the banner lists. */
export const RESTORABLE_DISPLAY_LIMIT = 25;

/**
 * How many blocked lots the banner lists PER CAUSE before saying "and N more".
 *
 * SLICE 20 - raised from 25 and made per-cause. The owner has ~973 blocked
 * products: a flat 25 across all causes meant the two lots needing approval in
 * Product Onboarding could be pushed off the list entirely by hundreds of
 * hidden ones, so a whole category of work became invisible. Slicing per cause
 * guarantees every cause is represented, and the summary always reports the
 * TRUE total from `byCode` rather than the number displayed.
 *
 * Not unlimited on purpose: this renders server-side into the inventory page,
 * and ~1000 rows of markup would make the page slow to load and painful to
 * read. Sixty is a working screenful per cause; the bulk links carry the tail.
 */
export const BLOCKED_LOT_DISPLAY_LIMIT = 60;

type LotRow = {
  id: string;
  pos_product_key: string | null;
  status: string | null;
  on_hand_qty: number | string | null;
  product_name: string | null;
  lot_code: string | null;
};

type ItemRow = {
  source_item_id: string;
  inventory_status: string;
  hidden: boolean;
  /** SLICE 18 - shown on the restore button so the manager knows what it is. */
  name: string | null;
};

type VariantRow = { menu_item_id: string; source_variant_id: string };

const EMPTY: RegisterSellabilityReport = { summary: null, blocked: [], restorable: [] };

/**
 * Build the published-card index the diagnosis needs, keyed by EVERY lot key
 * a card can sell under (its own key plus each variant's encoded
 * `${lotKey}-onboarded` key). This mirrors `/api/pos/menu` exactly — a
 * mastered card's lots carry the LOT's key, not the card's, so a card indexed
 * only by its own key would wrongly report every mastered lot as "not on the
 * published menu".
 */
async function loadPublishedCards(): Promise<{ byKey: Map<string, SnapshotCard>; names: Map<string, string> } | null> {
  const version = await getPublishedVersion();
  // No published menu is a real, knowable state, not a read failure: nothing
  // is sellable. An empty map lets every stocked lot report "no_menu_card",
  // which is exactly right.
  if (!version) return { byKey: new Map(), names: new Map() };

  const admin = createSupabaseAdminClient();

  let itemsFailed = false;
  const items = await pagedAll<ItemRow & { id: string }>(async (from, to) => {
    const { data, error } = await admin
      .from("menu_items")
      .select("id, source_item_id, inventory_status, hidden, name")
      .eq("menu_version_id", version.id)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      itemsFailed = true;
      return [];
    }
    return (data as (ItemRow & { id: string })[] | null) ?? [];
  });
  // A partial card list would invent "not on the published menu" verdicts for
  // products that ARE on it. Refuse to report rather than accuse wrongly.
  if (itemsFailed) return null;

  const rowIdToKey = new Map(items.map((i) => [i.id, i.source_item_id]));

  let variantsFailed = false;
  const variants = await pagedAll<VariantRow>(async (from, to) => {
    const { data, error } = await admin
      .from("menu_variants")
      .select("menu_item_id, source_variant_id")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      variantsFailed = true;
      return [];
    }
    return (data as VariantRow[] | null) ?? [];
  });
  if (variantsFailed) return null;

  const recalled = await recalledProductKeys();

  const byKey = new Map<string, SnapshotCard>();
  for (const it of items) {
    const card: SnapshotCard = {
      productId: it.source_item_id,
      lotKeys: [it.source_item_id],
      inventoryStatus: it.inventory_status as InventoryStatusSlug,
      hidden: it.hidden === true,
      // CARD-level recall only — identical to /api/pos/menu. A recalled LOT
      // removes only its own size and is not a property of the whole card.
      recalled: recalled.has(it.source_item_id),
    };
    byKey.set(it.source_item_id, card);
  }
  // Index each card under its variants' lot keys too.
  for (const v of variants) {
    const cardKey = rowIdToKey.get(v.menu_item_id);
    if (!cardKey) continue;
    const card = byKey.get(cardKey);
    if (!card) continue;
    const lotKey = lotKeyFromVariantId(v.source_variant_id);
    if (!lotKey || byKey.has(lotKey)) continue;
    card.lotKeys.push(lotKey);
    byKey.set(lotKey, card);
  }
  const names = new Map<string, string>();
  for (const it of items) {
    names.set(it.source_item_id, (it.name ?? "").trim() || it.source_item_id);
  }
  return { byKey, names };
}

/**
 * Diagnose every inventory lot that HOLDS STOCK against the published menu.
 *
 * Only stocked lots are examined: an empty or destroyed lot cannot be sold and
 * that is not a problem worth putting in front of the owner. Nagging about
 * normal history is how a useful warning becomes wallpaper.
 */
export async function getRegisterSellabilityReport(): Promise<RegisterSellabilityReport> {
  if (!isSupabaseServiceConfigured) return EMPTY;
  try {
    const admin = createSupabaseAdminClient();

    let lotsFailed = false;
    const rows = await pagedAll<LotRow>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, pos_product_key, status, on_hand_qty, product_name, lot_code")
        // Stable UNIQUE ordering — REQUIRED for deterministic paging.
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        lotsFailed = true;
        return [];
      }
      return (data as LotRow[] | null) ?? [];
    });
    if (lotsFailed) return EMPTY;

    const loaded = await loadPublishedCards();
    if (!loaded) return EMPTY;
    const cards = loaded.byKey;

    const facts: LiveLotFact[] = rows
      .filter(
        (r) =>
          (r.status ?? "").trim().toLowerCase() === SELLABLE_LOT_STATUS &&
          toQty(r.on_hand_qty) > 0,
      )
      .map((r) => ({
        id: r.id,
        posProductKey: r.pos_product_key,
        status: r.status,
        onHandQty: r.on_hand_qty,
        productName: r.product_name,
        lotCode: r.lot_code,
      }));

    const diagnoses = facts.map((f) => diagnoseLot(f, cards));
    const summary = summarizeSellability(diagnoses);
    /**
     * SLICE 20 - cap PER CAUSE, not across the whole list. A flat cap let one
     * loud cause bury a quiet one; the owner could not see the 2 lots awaiting
     * approval behind hundreds of hidden ones. Counts shown to the owner come
     * from `summary.byCode`, which is computed from ALL diagnoses above, so
     * capping the display can never understate the real total.
     */
    const perCause = new Map<string, number>();
    const blocked = diagnoses.filter((d) => {
      if (d.sellable) return false;
      const seen = perCause.get(d.code) ?? 0;
      if (seen >= BLOCKED_LOT_DISPLAY_LIMIT) return false;
      perCause.set(d.code, seen + 1);
      return true;
    });

    /**
     * SLICE 18 - the 86 presses that live stock contradicts.
     *
     * Built from the SAME `facts` the diagnosis used (active lots with units
     * on hand), so the banner and the register can never disagree about what
     * has stock. A card qualifies when it is flagged "unavailable" but real
     * units sit behind it and no compliance gate applies - recalled and
     * hidden cards are deliberately excluded, because restoring must never
     * override either. `statusForUnits` decides what the restore WOULD write,
     * so the button can promise exactly what it will do.
     */
    const unitsByCard = new Map<string, number>();
    for (const f of facts) {
      const key = normalizeKey(f.posProductKey);
      if (!key) continue;
      const card = cards.get(key);
      if (!card) continue;
      unitsByCard.set(card.productId, (unitsByCard.get(card.productId) ?? 0) + toQty(f.onHandQty));
    }

    const restorable: RestorableProduct[] = [];
    const seen = new Set<string>();
    for (const card of cards.values()) {
      if (seen.has(card.productId)) continue;
      seen.add(card.productId);
      if (card.inventoryStatus !== "unavailable") continue;
      if (card.recalled || card.hidden) continue;
      const units = unitsByCard.get(card.productId) ?? 0;
      if (units <= 0) continue;
      restorable.push({
        productKey: card.productId,
        name: loaded.names.get(card.productId) ?? card.productId,
        units,
        nextStatus: statusForUnits(units),
      });
    }
    // Most stock first - the biggest sellable loss is the most urgent undo.
    restorable.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

    return { summary, blocked, restorable: restorable.slice(0, RESTORABLE_DISPLAY_LIMIT) };
  } catch {
    // Never let a diagnostic read break the inventory page.
    return EMPTY;
  }
}
