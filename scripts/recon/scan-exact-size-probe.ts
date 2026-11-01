/**
 * scripts/recon/scan-exact-size-probe.ts  (slice register-scan-exact-size)
 *
 * READ-ONLY recon. Runs the REAL Cultivera transformer + lot planner on the
 * workbooks committed under normalized_cultivera/ and asks, for every lot
 * barcode: what does the register do when that package is scanned?
 *
 *   before  = resolveScan with the barcode -> card-key index only (main)
 *   after   = resolveScan with the barcode -> exact-size index as well
 *
 * Usage: npx tsx scripts/recon/scan-exact-size-probe.ts
 * No database, no network. Prints one JSON object.
 */
import fs from "node:fs";
import * as XLSX from "xlsx";
import { transformWorkbooks } from "@/lib/pos/transform";
import { planImportLots } from "@/lib/pos/import-lot-core";
import { buildBarcodeIndex, resolveScan } from "@/lib/pos/scan-to-cart-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { buildBarcodeSizeIndex, sizeIndexSummary } from "@/lib/pos/scan-exact-size-core";

const wb = XLSX.read(fs.readFileSync("normalized_cultivera/PRODUCTS_NORMALIZED.xlsx"));
const rows = XLSX.utils
  .sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" })
  .map((r) => ({ ...r, Description: "" }));
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows), "Sheet1");
const t = transformWorkbooks({
  productsBuffer: XLSX.write(out, { type: "buffer", bookType: "xlsx" }) as Buffer,
  inventoriesBuffer: fs.readFileSync("normalized_cultivera/INVENTORIES_NORMALIZED.xlsx"),
  productsSheet: "Sheet1",
  inventoriesSheet: "Inventories",
});
const lots = planImportLots(t.lotSources).lots.filter((l) => l.receivedQty > 0 && !l.isSample);

// Register lines: every card (hidden or not, the register now sells both), one line per size.
const products: PosMenuProduct[] = [];
for (const item of t.items) {
  for (const v of item.variants) {
    products.push({
      productId: item.id,
      variantId: v.id,
      name: item.name,
      brand: null,
      category: String(item.category),
      categories: [String(item.category)],
      variantLabel: v.label,
      regularPriceMinor: v.priceMinorUnits,
      costMinorUnits: null,
      inventoryStatus: "in-stock",
    });
  }
}
const sizesByCard = new Map<string, number>();
for (const p of products) sizesByCard.set(p.productId, (sizesByCard.get(p.productId) ?? 0) + 1);

const sellable = new Set(products.map((p) => p.productId));
const sources = lots.map((l) => ({ lotCode: l.lotCode, posProductKey: l.posProductKey, ccrsExternalId: l.ccrsExternalId }));
const idx = buildBarcodeIndex(sources, sellable);
// Lots exactly as /api/pos/menu hands them over (size link, weight, medical).
const sized = buildBarcodeSizeIndex(
  lots.map((l) => ({
    lotCode: l.lotCode,
    ccrsExternalId: l.ccrsExternalId,
    posProductKey: l.posProductKey,
    sizeId: l.menuSourceVariantId,
    unitWeight: l.unitWeight,
    unitWeightUom: l.unitWeightUom,
    isMedical: l.isMedical,
  })),
  t.items.map((i) => ({ id: i.id, name: i.name, variants: i.variants.map((v) => ({ id: v.id, label: v.label, medical: v.medical })) })),
  new Set(products.map((p) => p.variantId)),
);
// The same run with the 0294 size link withheld: what package weight alone proves.
const weightOnly = buildBarcodeSizeIndex(
  lots.map((l) => ({ lotCode: l.lotCode, ccrsExternalId: l.ccrsExternalId, posProductKey: l.posProductKey, unitWeight: l.unitWeight, unitWeightUom: l.unitWeightUom, isMedical: l.isMedical })),
  t.items.map((i) => ({ id: i.id, name: i.name, variants: i.variants.map((v) => ({ id: v.id, label: v.label, medical: v.medical })) })),
  new Set(products.map((p) => p.variantId)),
);

const tally = (useSize: boolean) => {
  const r = { add: 0, pick: 0, refused: 0, none: 0, pickOnMultiSizeCard: 0, wrongSizeAdds: 0 };
  for (const l of lots) {
    const code = l.lotCode ?? l.ccrsExternalId;
    const res = resolveScan(products, idx, code, useSize ? sized.index : undefined);
    r[res.status] += 1;
    if (res.status === "pick" && (sizesByCard.get(l.posProductKey) ?? 0) > 1) r.pickOnMultiSizeCard += 1;
    if (res.status === "add" && l.menuSourceVariantId && res.product.variantId !== l.menuSourceVariantId) r.wrongSizeAdds += 1;
  }
  return r;
};

const multiSizeLots = lots.filter((l) => (sizesByCard.get(l.posProductKey) ?? 0) > 1);
console.log(
  JSON.stringify(
    {
      lotsWithStock: lots.length,
      cards: t.items.length,
      multiSizeCards: [...sizesByCard.values()].filter((n) => n > 1).length,
      lotsOnMultiSizeCards: multiSizeLots.length,
      lotsOnMultiSizeCardsWithSizeLink: multiSizeLots.filter((l) => l.menuSourceVariantId).length,
      before: tally(false),
      after: tally(true),
      stats: sized.stats,
      summary: sizeIndexSummary(sized.stats),
      weightOnlyWouldProve: weightOnly.stats.exactBy.weight,
      weightOnlyNarrowed: weightOnly.stats.narrowed,
      weightOnlyUnknown: weightOnly.stats.unknown,
      bundleBytes: JSON.stringify(sized.index).length,
    },
    null,
    2,
  ),
);
