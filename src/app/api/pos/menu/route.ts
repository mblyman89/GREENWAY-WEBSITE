/**
 * GET /api/pos/menu  (POS Slice B6)
 *
 * The register's menu download. An authenticated POS device pulls everything
 * it needs to ring sales — including OFFLINE ones — in a single bundle:
 *
 *   products — the PUBLISHED menu flattened per sellable variant (hidden items
 *              excluded; tax-inclusive minor-unit prices; weighted-average
 *              acquisition cost attached for the CCRS cost floor)
 *   rules    — the promotions ACTIVE RIGHT NOW as pure EngineRules, so the
 *              device prices with the IDENTICAL engine the website checkout
 *              and the server-side completion gate use (no drift possible)
 *   limits   — the owner's WAC 314-55-095 sales-limit settings
 *   hours    — the WAC 314-55-147 sales-hours window (owner may tighten)
 *
 * Auth: same X-POS-Device-Id / X-POS-Device-Key headers as /api/pos/sync.
 * The device caches the bundle locally and refreshes whenever online; a
 * synced sale is ALWAYS re-priced and re-gated server-side (B4), so a stale
 * device bundle can never make an illegal sale stick.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { loadActiveRules, loadProductCosts } from "@/lib/promotions/discount-engine";
import { getSalesLimitSettings } from "@/lib/compliance/sales-limits";
import { getSalesHoursWindow } from "@/lib/compliance/sales-hours-store";
import { getMedTaxSettings, getEndorsementConfig } from "@/lib/medical/store";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { getPosCashRoundingConfig } from "@/lib/pos/cash-rounding-store";
import { getPosScanRequiredConfig } from "@/lib/pos/scan-required-store";
import { trimDescription } from "@/lib/pos/product-info-core";
import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";
// SLICE L4 — label → millilitres, the fallback when a card predates the L3
// intake volume plumbing.
import { resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";
import { cleanCardDisplayName } from "@/lib/pos/menu-name-display-core";
import { getConfig as getLoyaltyConfig } from "@/lib/loyalty/loyalty-store";
// SLICE 28 — the owner's employee/industry/veteran discount settings ride the
// bundle so the register offers the programs OFFLINE with the saved rates.
import { getSpecialDiscountSettings } from "@/lib/discounts/special-discount-store";
import { listMedicalRegistry } from "@/lib/medical/sale-store";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import type { PosMedicalConfig } from "@/lib/pos/medical-pos-core";
import type { PosMenuBundle, PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { buildBarcodeIndex, type LotBarcodeSource } from "@/lib/pos/scan-to-cart-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
// SLICE 16 — reconcile the register's CACHED availability flag against LIVE
// lot truth. See register-availability-core.ts for the full proof; in short,
// `inventory_lots.on_hand_qty` (what the back office shows) and
// `menu_variants.inventory_level` (what the register reads) are two counters
// that only sales and voids keep in step. Cycle counts, dispositions and
// intake adjustments move the first and leave the second frozen, so real
// stock became unsellable with no message anywhere. Reconciling here is
// self-healing: the next menu download repairs every stale card at once.
import {
  reconcileRegisterAvailability,
  toQty,
  SELLABLE_LOT_STATUS,
  type LiveLotFact,
  type SnapshotCard,
} from "@/lib/pos/register-availability-core";

/**
 * SLICE 5C — memory ceiling for the barcode-index lot scan. NOT a row cap:
 * reaching it is REPORTED as an incomplete read, never silently accepted.
 */
const BARCODE_SCAN_MAX_ROWS = 100_000;
// Mastering Slice 1: intake variants encode their own lot key (`${key}-onboarded`).
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";

  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [menu, rules, costs, limitSettings, hours, medSettings, endorsement, registryRows, receipt, rounding, scanRequired] =
    await Promise.all([
      loadLiveMenuAll(),
      loadActiveRules(),
      loadProductCosts(),
      getSalesLimitSettings(),
      getSalesHoursWindow(),
      getMedTaxSettings(),
      getEndorsementConfig(),
      listMedicalRegistry({ limit: 2000 }),
      getPosReceiptConfig(),
      getPosCashRoundingConfig(),
      getPosScanRequiredConfig(),
    ]);
  const loyaltyCfg = await getLoyaltyConfig();
  // SLICE 28 — ship ALL three program rows (enabled or not); the device
  // filters with availableSpecialDiscounts, and the sync re-verifies the
  // program is enabled + the rate matches at completion time, so a stale
  // cached bundle can never make an off-book discount stick.
  const specialDiscounts = await getSpecialDiscountSettings();

  // AN-7 — recall hold: products with ANY lot in `recalled` status are
  // EXCLUDED from the register bundle so they can't even be rung up. This is
  // the advisory layer (best-effort: a lot-read failure ships an unfiltered
  // menu, never a blank register); the completion gate is the fail-closed
  // statutory stop that re-checks at sync.
  const recalled = await recalledProductKeys();

  // POS B8 — the medical-sale config the device prices with OFFLINE. The
  // registry is the durable DOH 246-70 table keyed by the stable POS product
  // key (= order_lines.product_id), so applyMedicalPricing on-device uses the
  // IDENTICAL inputs the server completion gate re-derives at sync.
  const registry: Record<string, DohCategory> = {};
  for (const row of registryRows) {
    registry[row.pos_product_key] = row.doh_category;
  }
  const medical: PosMedicalConfig = {
    endorsed: medSettings.medicallyEndorsed,
    // Same fallback the completion gate uses (WAC 314-55-090(6) statutory sunset).
    exciseExemptionUntil: endorsement?.exciseExemptionUntil ?? "2029-06-30",
    registry,
  };

  // ═══ SLICE 16 — LIVE LOT TRUTH ═══════════════════════════════════════════
  //
  // Read `inventory_lots` ONCE, up front, and use it for two jobs that were
  // previously starved of it:
  //
  //   1. AVAILABILITY RECONCILIATION (new). The published snapshot's
  //      `inventory_status` is a CACHE. Only sales and voids refresh it;
  //      cycle counts, dispositions, intake adjustments and bulk fills move
  //      `inventory_lots.on_hand_qty` and leave the cache frozen. Every card
  //      whose cache went stale silently vanished from the register — the
  //      exact fault the owner hit at the counter.
  //
  //   2. THE BARCODE INDEX (existing, SLICE 5C). Previously this read filtered
  //      `.eq("status","active").gt("on_hand_qty",0)` in SQL. It now selects
  //      `status` and `on_hand_qty` and filters in the PURE core instead, so
  //      one read serves both jobs and the two can never disagree about what
  //      "sellable stock" means.
  //
  // Best-effort, exactly as before: a failed read yields NO live facts, which
  // makes reconciliation a no-op (the snapshot's own answer stands) and ships
  // an empty barcode index. It can never break the menu download.
  let liveLots: LiveLotFact[] = [];
  let liveLotsComplete = false;
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      // SLICE 5C — `.limit(5000)` cannot exceed PostgREST's 1,000-row cap
      // (chunked-in.ts:13-14). `inventory_lots` is the largest table in the
      // system (SLICE 3 proved 4,179 rows), so this MUST page.
      type LotRow = {
        id: string;
        lot_code: string | null;
        pos_product_key: string | null;
        ccrs_inventory_external_id: string | null;
        status: string | null;
        on_hand_qty: number | string | null;
        product_name: string | null;
      };
      const { rows, verdict } = await pagedAllChecked<LotRow>(
        async (from, to) => {
          const { data, error } = await admin
            .from("inventory_lots")
            .select(
              "id, lot_code, pos_product_key, ccrs_inventory_external_id, status, on_hand_qty, product_name",
            )
            // Stable UNIQUE ordering — REQUIRED for deterministic paging.
            .order("id", { ascending: true })
            .range(from, to);
          if (error) return { rows: [], ok: false };
          return { rows: (data as LotRow[] | null) ?? [], ok: true };
        },
        { maxRows: BARCODE_SCAN_MAX_ROWS },
      );
      liveLotsComplete = verdict.complete;
      if (!verdict.complete) {
        console.warn(`[pos/menu] inventory lot read may be incomplete — ${verdict.message}`);
      }
      liveLots = rows.map((l) => ({
        id: l.id,
        posProductKey: l.pos_product_key,
        status: l.status,
        onHandQty: l.on_hand_qty,
        productName: l.product_name,
        lotCode: l.lot_code,
        // Carried for the barcode index below (not part of LiveLotFact).
        ccrsExternalId: deriveInventoryExternalId(l),
      })) as (LiveLotFact & { ccrsExternalId: string | null })[];
    } catch {
      liveLots = [];
      liveLotsComplete = false;
    }
  }

  // Build the reconciliation input: one entry per published card, carrying
  // EVERY lot key it can sell under (its own key plus each variant's encoded
  // `${lotKey}-onboarded` key — a mastered card's lots carry the LOT's key,
  // not the card's, so both must be considered).
  const snapshotCards: SnapshotCard[] = menu.map((item) => {
    const lotKeys = [item.id];
    for (const v of item.variants) {
      const k = lotKeyFromVariantId(v.id);
      if (k) lotKeys.push(k);
    }
    return {
      productId: item.id,
      lotKeys,
      inventoryStatus: item.inventoryStatus,
      // `hidden` is optional on GreenwayMenuItem. The gate this replaces was
      // `if (item.hidden) continue`, so undefined means NOT hidden — keep that
      // exactly, or every card lacking the field would vanish.
      hidden: item.hidden === true,
      // AN-7 — CARD-level recall only, exactly as the gate this replaces did
      // (`if (recalled.has(item.id)) continue`). A recalled LOT must remove
      // only ITS OWN SIZE, and that is still enforced per-variant in the loop
      // below. Widening it to `lotKeys.some(...)` here would pull a whole
      // mastered card off the register because one of its sizes was recalled
      // — turning a fix into a new outage. The behavioural test
      // "keeps a recalled LOT's size off a mastered card" pins this.
      recalled: recalled.has(item.id),
    };
  });

  const availability = reconcileRegisterAvailability({ cards: snapshotCards, lots: liveLots });
  const availabilityByProduct = new Map(availability.cards.map((c) => [c.productId, c]));
  if (availability.restoredCount > 0) {
    console.info(
      `[pos/menu] restored ${availability.restoredCount} product(s) to the register from live lot stock (stale published inventory_status)`,
    );
  }
  // Honesty about the limits of this repair. A truncated lot read cannot make
  // the bundle WRONG — reconciliation only ever adds availability, so missing
  // lots simply mean fewer restorations. But it can leave a product the owner
  // expects to sell still missing, and he must never have to guess why.
  if (!liveLotsComplete) {
    const stillBlocked = availability.cards.filter(
      (c) => !c.sellable && (c.reason === "no_live_stock" || c.reason === "no_lot_evidence"),
    ).length;
    if (stillBlocked > 0) {
      console.warn(
        `[pos/menu] the inventory lot read was incomplete, so ${stillBlocked} unavailable product(s) could not be re-checked against live stock — some may be sellable in reality.`,
      );
    }
  }

  const products: PosMenuProduct[] = [];
  for (const item of menu) {
    // SLICE 16 — ONE decision point. The reconciler already applied, in this
    // order: recall hold, hidden, snapshot-sellable (one-way — never removes
    // availability), then live-stock restoration. The three separate
    // `continue`s that used to live here are folded into it so the register
    // and the back office can never disagree about why a card is missing.
    const verdict = availabilityByProduct.get(item.id);
    if (!verdict || !verdict.sellable) continue;

    // A restored card's cached status is stale by definition, so ship the
    // status LIVE STOCK implies. Without this the card would reach the device
    // still labelled "unavailable" and be dropped again downstream by
    // order-to-cart-core.ts:75 and register-polish-core.ts:165.
    const effectiveStatus = verdict.restored ? verdict.liveStatus : item.inventoryStatus;
    const categories = (item.filterCategories?.length ? item.filterCategories : [item.category]).map(
      (c) => String(c).toLowerCase(),
    );
    const cost = costs.get(item.id) ?? null;
    // Items without explicit variants sell at the item price — same synthetic
    // default the website's price selector renders. Its inventoryLevel of 0
    // is a placeholder, NOT a real count — flagged below so B32 treats the
    // units as unknown instead of "out".
    const hasRealVariants = item.variants.length > 0;
    const variants = hasRealVariants
      ? item.variants
      : [
          {
            id: `${item.id}-default`,
            label: item.priceLabel.replace(/^\$[\d.]+\s*/, "") || "each",
            priceMinorUnits: item.priceMinorUnits,
            inventoryLevel: 0,
            medical: false,
          },
        ];
    for (const variant of variants) {
      // Mastering Slice 1: a variant that encodes its own lot key resolves
      // recall + cost against THAT lot (single-lot cards: key = item.id, so
      // both lookups behave exactly as before).
      const variantLotKey = lotKeyFromVariantId(variant.id);
      // AN-7 — a recalled lot excludes ITS size, not just cards whose item
      // key matches (mastered cards would otherwise sell a recalled size).
      if (variantLotKey && recalled.has(variantLotKey)) continue;
      products.push({
        productId: item.id,
        variantId: variant.id,
        // Bug 2 — DISPLAY cleanup: strip a leftover baked-in package size from
        // the rolled-up card name so the register shows "SPR - Sour Diesel"
        // beside its real size chip ("3.5 g") instead of "SPR - Sour Diesel
        // -7g · 3.5 g". Pure + reversible; stored data (back office + website)
        // is untouched — only what the register displays changes.
        // SLICE 49: the card's category rides along so dose-led categories
        // (edibles/liquids/topicals/tinctures/RSO) keep their trailing mg dose
        // in the register name — the dose is identity, not package-size noise.
        name: cleanCardDisplayName(item.name, variant.label, String(item.category)),
        brand: item.brand || null,
        category: String(item.category),
        categories,
        variantLabel: variant.label || null,
        regularPriceMinor: variant.priceMinorUnits,
        costMinorUnits: (variantLotKey ? costs.get(variantLotKey) : undefined) ?? cost,
        // AN-1 — true per-unit grams parsed from the package-size label the
        // transform generated ("3.5g" → 3.5, "1oz" → 28; mg/ml/pack/each →
        // null = unknown → the limit engine keeps its category default).
        unitGrams: gramsFromVariantLabel(variant.label),
        // SLICE L4 — per-unit millilitres. Prefers the L3-plumbed
        // net_volume_ml (a real measured package volume); falls back to
        // parsing the variant label so a card staged before L3 still gets a
        // volume when its label states one. null = unknown, and the engine
        // then uses the weight-carried basis rather than assuming a size.
        unitVolumeMl: resolveUnitVolumeMl(variant.label, item.netVolumeMl),
        // SLICE 16 — the low-THC beverage classification and the per-UNIT mg
        // figure. Set at intake from the label/invoice; never derived from
        // servings × mg-per-serving (a 16 mg bottle labelled "4 × 4 mg" is one
        // 16 mg unit and does NOT qualify). null = not classified = the engine
        // counts it as a normal liquid.
        lowThcLiquid: item.lowThcLiquid ?? null,
        unitThcMg: item.unitThcMg ?? null,
        // SLICE 17 — the register bundle carries the otherwise-taken facts so
        // the device can enforce the ten-unit limit offline.
        otherwiseTaken: item.otherwiseTaken ?? null,
        unitsPerPackage: item.unitsPerPackage ?? null,
        inventoryStatus: effectiveStatus,
        // B32 — variant-level count for low-stock badges. Synthetic default
        // variants carry no real count (null = unknown, falls back to the
        // item-level status). Warnings only; never blocks a sale.
        // SLICE 16 — a RESTORED card's cached variant levels are stale (that
        // staleness is exactly why it was wrongly unavailable), so shipping
        // them would paint a "0 left" badge on a product with real stock.
        // null = unknown, which B32 already handles by falling back to the
        // item-level status. Never invent a per-variant count we cannot prove.
        unitsLeft: verdict.restored ? null : hasRealVariants ? variant.inventoryLevel : null,
        // B42 — product-info facts for the on-demand detail card (sensory/
        // descriptive only). Descriptions trimmed so the device cache stays
        // small; missing facts ship as absent, and the card omits them.
        strainType: item.strainType ?? null,
        thc: item.thc,
        cbd: item.cbd,
        terpenes: item.terpenes?.length ? item.terpenes : undefined,
        description: trimDescription(item.description) || undefined,
      });
    }
  }

  // POS B23 — barcode index for keyboard-wedge scan-to-cart, built from the
  // SAME live lot read the availability reconciliation above used.
  //
  // SLICE 16 — WHY THIS NO LONGER FILTERS IN SQL. The read used to narrow with
  // `.eq("status","active").gt("on_hand_qty",0)`, which meant the barcode
  // index and the availability decision were answering "does this have
  // sellable stock?" from two different places. `indexLiveStock` in the pure
  // core now applies exactly those two rules, so the index and the bundle can
  // never disagree about which lots count — and the whole thing is testable
  // without a database.
  //
  // The best-effort contract is unchanged: a failed or truncated read leaves
  // `liveLots` empty and ships an empty index rather than breaking the menu
  // download. A TRUNCATED read is still never mistaken for a complete one.
  let barcodes: Record<string, string> = {};
  if (liveLots.length > 0) {
    // Sellable = every card key PLUS every variant's own encoded lot key
    // (mastered cards' lots carry the LOT's pos_product_key, not the card
    // key — without the union their barcodes would be dropped as "delisted").
    // Because `products` now INCLUDES the cards restored from live stock,
    // their barcodes finally make it into the index too: the scan the owner
    // was making at the counter starts working.
    const sellableKeys = new Set(products.map((p) => p.productId));
    for (const p of products) {
      const k = lotKeyFromVariantId(p.variantId);
      if (k) sellableKeys.add(k);
    }
    const sources: LotBarcodeSource[] = liveLots
      .filter(
        (l) =>
          (l.status ?? "").trim().toLowerCase() === SELLABLE_LOT_STATUS && toQty(l.onHandQty) > 0,
      )
      .map((l) => ({
        lotCode: l.lotCode ?? null,
        posProductKey: l.posProductKey,
        ccrsExternalId: (l as LiveLotFact & { ccrsExternalId: string | null }).ccrsExternalId,
      }));
    barcodes = buildBarcodeIndex(sources, sellableKeys);
  }

  const bundle: PosMenuBundle = {
    products,
    rules,
    limits: {
      enforce: limitSettings.enforce,
      hardBlock: limitSettings.hardBlock,
      rec: limitSettings.rec,
      med: limitSettings.med,
      unitGrams: limitSettings.unitGrams,
    },
    hours,
    medical,
    // POS B13 — owner receipt customization travels with the bundle so
    // OFFLINE sales print the customized receipt.
    receipt,
    // POS B14 — earn rate for the device's points ESTIMATE on the receipt
    // (authoritative accrual runs server-side at completion).
    // Task AM-B — point cash value + minimum balance so the register can
    // offer "Redeem points" (the ONLINE /api/pos/loyalty route re-verifies).
    loyalty: {
      pointsPerDollar: loyaltyCfg.pointsPerDollar,
      pointValueMinor: loyaltyCfg.pointValueMinor,
      minRedeemPoints: loyaltyCfg.minRedeemPoints,
    },
    // POS B23 — barcode → product-key index for scan-to-cart.
    barcodes,
    // POS B33 — the owner's cash-rounding policy rides the bundle so OFFLINE
    // sales round the amount due exactly like online ones.
    rounding,
    // POS B41 — scan-required mode rides the bundle so OFFLINE registers
    // keep enforcing the cached policy.
    scanRequired,
    // SLICE 28 — special-discount program settings (employee/industry/
    // veteran rates + switches) so the register offers them OFFLINE.
    specialDiscounts,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(bundle);
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handleGet(req));
}
