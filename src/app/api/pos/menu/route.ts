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

  const products: PosMenuProduct[] = [];
  for (const item of menu) {
    if (item.hidden) continue;
    // Item-level availability gates the whole card, same as the website.
    if (item.inventoryStatus === "unavailable") continue;
    // AN-7 — recall hold excludes the product from the register entirely.
    if (recalled.has(item.id)) continue;
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
        inventoryStatus: item.inventoryStatus,
        // B32 — variant-level count for low-stock badges. Synthetic default
        // variants carry no real count (null = unknown, falls back to the
        // item-level status). Warnings only; never blocks a sale.
        unitsLeft: hasRealVariants ? variant.inventoryLevel : null,
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

  // POS B23 — barcode index for keyboard-wedge scan-to-cart. Built from
  // ACTIVE lots' codes (lot_code + the same canonical CCRS derivation the
  // Sale.csv builder and B19 decrement use), restricted to product keys that
  // are actually sellable in THIS bundle. Best-effort: a lot-read failure
  // ships an empty index (scanning degrades to product-key matches), never
  // a failed menu download.
  let barcodes: Record<string, string> = {};
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: lotRows } = await admin
        .from("inventory_lots")
        .select("id, lot_code, pos_product_key, ccrs_inventory_external_id")
        .eq("status", "active")
        .gt("on_hand_qty", 0)
        .limit(5000);
      // Sellable = every card key PLUS every variant's own encoded lot key
      // (mastered cards' lots carry the LOT's pos_product_key, not the card
      // key — without the union their barcodes would be dropped as
      // "delisted"). Single-lot cards contribute the same key twice.
      const sellableKeys = new Set(products.map((p) => p.productId));
      for (const p of products) {
        const k = lotKeyFromVariantId(p.variantId);
        if (k) sellableKeys.add(k);
      }
      const sources: LotBarcodeSource[] = (
        (lotRows as {
          id: string;
          lot_code: string | null;
          pos_product_key: string | null;
          ccrs_inventory_external_id: string | null;
        }[] | null) ?? []
      ).map((l) => ({
        lotCode: l.lot_code,
        posProductKey: l.pos_product_key,
        ccrsExternalId: deriveInventoryExternalId(l),
      }));
      barcodes = buildBarcodeIndex(sources, sellableKeys);
    } catch {
      barcodes = {};
    }
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
