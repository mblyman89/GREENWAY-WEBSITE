/**
 * src/lib/inventory/lot-menu-stock.ts  (R74 S32) - SERVER-ONLY.
 *
 * After a lot's on-hand moves (adjustment, disposition, return add-back,
 * Cultivera count, legacy-lot removal), move the menu stock of the size that
 * lot sells as by the same amount, on the published version and every staged
 * version, so Leafly and the website show what the shelf holds. See
 * lot-menu-stock-core.ts for the rules.
 *
 * Reuses the price writer's lot -> size finder (findLotVariantOnVersion: the
 * S30 link, then "-onboarded", then a one-size card; multi-size unlinked =
 * ambiguous, never guessed) and the atomic menu write (applyVariantDelta,
 * 0129, deltas combine under concurrency). Price, cost and visibility are
 * never written.
 *
 * NEVER THROWS: the lot write already happened and is the legal record; a
 * menu-stock problem comes back as a plain sentence the caller shows.
 */
import "server-only";
import { isSampleLot } from "@/lib/inventory/sample-lot-core";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";
import { findLotVariantOnVersion } from "@/lib/inventory/price-write-store";
import { applyVariantDelta } from "@/lib/inventory/atomic-quantity";
import { isMissingSizeLinkColumnError } from "@/lib/inventory/lot-size-link-store";
import {
  menuStockSentence,
  planMenuStockStep,
  type MenuStockMatch,
  type MenuStockVersionOutcome,
} from "@/lib/inventory/lot-menu-stock-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MenuVersionsForStock = { id: string; status: "published" | "staged" }[];

/** The live versions a stock change applies to (published first). Load once per batch. */
export async function loadMenuVersionsForStock(): Promise<MenuVersionsForStock> {
  const [published, staged] = await Promise.all([getPublishedVersion(), listIntakeStagedVersions(30)]);
  const out: MenuVersionsForStock = [];
  if (published) out.push({ id: published.id, status: "published" });
  for (const v of staged) out.push({ id: v.id, status: "staged" });
  return out;
}

export type LotMenuStockResult = { outcomes: MenuStockVersionOutcome[]; sentence: string | null };

type LotRow = { id: string; pos_product_key: string | null; lot_code: string | null; product_name: string | null; menu_source_variant_id?: string | null; is_sample?: boolean | null };

export async function syncLotMenuStock(
  admin: Admin,
  lotId: string,
  delta: number,
  opts: { versions?: MenuVersionsForStock } = {},
): Promise<LotMenuStockResult> {
  const d = Math.trunc(Number(delta) || 0);
  if (d === 0) return { outcomes: [], sentence: null };
  let label = "This lot";
  try {
    const read = (cols: string) => admin.from("inventory_lots").select(cols).eq("id", lotId).maybeSingle();
    let res = await read("id, pos_product_key, lot_code, product_name, menu_source_variant_id, is_sample");
    if (res.error && isMissingSizeLinkColumnError(res.error)) res = await read("id, pos_product_key, lot_code, product_name, is_sample");
    if (res.error) throw new Error(`read the lot: ${res.error.message}`);
    const lot = res.data as unknown as LotRow | null;
    if (!lot) throw new Error("the lot was not found");
    label = (lot.product_name ?? "").trim() || (lot.lot_code ?? "").trim() || label;
    // Fix Phase 0.2 (G-51): a trade sample has no menu stock to move.
    if (isSampleLot(lot)) {
      return { outcomes: [], sentence: `${label}: trade sample lot; samples are never on the menu, so no menu stock changed.` };
    }
    const key = (lot.pos_product_key ?? "").trim();
    if (!key) {
      return { outcomes: [], sentence: `${label}: the lot changed by ${d}; it has no POS product key, so it has no menu stock to change.` };
    }
    const versions = opts.versions ?? (await loadMenuVersionsForStock());
    const target = { posProductKey: key, menuSourceVariantId: lot.menu_source_variant_id ?? null };
    const outcomes: MenuStockVersionOutcome[] = [];
    for (const v of versions) {
      try {
        const found = await findLotVariantOnVersion(admin, v.id, target);
        let match: MenuStockMatch;
        let itemId: string | null = null;
        if (found.kind === "none") match = { kind: "none" };
        else if (found.kind === "ambiguous") match = { kind: "ambiguous", variantCount: found.variantCount };
        else {
          itemId = found.variant.menu_item_id;
          const { data: item, error: itemErr } = await admin
            .from("menu_items")
            .select("id, inventory_status")
            .eq("id", found.variant.menu_item_id)
            .maybeSingle();
          if (itemErr) throw new Error(`read the menu card: ${itemErr.message}`);
          match = {
            kind: found.kind,
            variantId: found.variant.id,
            cardVariants: found.cardVariants.map((c) => ({ id: c.id, inventory_level: c.inventory_level })),
            itemStatus: (item as { inventory_status: string | null } | null)?.inventory_status ?? null,
          };
        }
        const step = planMenuStockStep(match, d);
        if (step.action === "skip") {
          outcomes.push({ status: v.status, result: step.reason === "not-on-menu" ? "not-on-menu" : "skipped" });
          continue;
        }
        if (step.action === "ambiguous") {
          outcomes.push({ status: v.status, result: "ambiguous" });
          continue;
        }
        const written = await applyVariantDelta(admin, { variantRowId: step.variantId, delta: step.delta, fallbackAbsoluteLevel: step.fallbackLevel });
        if (!written.ok) throw new Error(written.error ?? "menu stock not written");
        // Recompute the status from the level the database reports (another
        // writer may have landed in between); the plan's level otherwise.
        const after = planMenuStockStep(match, d, written.newQty);
        if (after.action === "write" && after.newStatus && itemId) {
          const { error: stErr } = await admin.from("menu_items").update({ inventory_status: after.newStatus }).eq("id", itemId);
          if (stErr) throw new Error(`menu stock written, card status not updated: ${stErr.message}`);
        }
        outcomes.push({ status: v.status, result: "written" });
      } catch (err) {
        outcomes.push({ status: v.status, result: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    }
    const sentence = menuStockSentence(label, d, outcomes);
    if (sentence && outcomes.some((o) => o.result === "failed")) console.error(`[lot-menu-stock] ${sentence}`);
    return { outcomes, sentence };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const outcomes: MenuStockVersionOutcome[] = [{ status: "published", result: "failed", error: msg }];
    const sentence = menuStockSentence(label, d, outcomes);
    console.error(`[lot-menu-stock] ${sentence}`);
    return { outcomes, sentence };
  }
}
