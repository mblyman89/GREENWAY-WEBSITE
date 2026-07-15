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
import { getConfig as getLoyaltyConfig } from "@/lib/loyalty/loyalty-store";
import { listMedicalRegistry } from "@/lib/medical/sale-store";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import type { PosMedicalConfig } from "@/lib/pos/medical-pos-core";
import type { PosMenuBundle, PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { buildBarcodeIndex, type LotBarcodeSource } from "@/lib/pos/scan-to-cart-core";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
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
      products.push({
        productId: item.id,
        variantId: variant.id,
        name: item.name,
        brand: item.brand || null,
        category: String(item.category),
        categories,
        variantLabel: variant.label || null,
        regularPriceMinor: variant.priceMinorUnits,
        costMinorUnits: cost,
        inventoryStatus: item.inventoryStatus,
        // B32 — variant-level count for low-stock badges. Synthetic default
        // variants carry no real count (null = unknown, falls back to the
        // item-level status). Warnings only; never blocks a sale.
        unitsLeft: hasRealVariants ? variant.inventoryLevel : null,
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
      const sellableKeys = new Set(products.map((p) => p.productId));
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
    loyalty: { pointsPerDollar: loyaltyCfg.pointsPerDollar },
    // POS B23 — barcode → product-key index for scan-to-cart.
    barcodes,
    // POS B33 — the owner's cash-rounding policy rides the bundle so OFFLINE
    // sales round the amount due exactly like online ones.
    rounding,
    // POS B41 — scan-required mode rides the bundle so OFFLINE registers
    // keep enforcing the cached policy.
    scanRequired,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(bundle);
}
