/** R50 S3 recon: how many lots share one card key (pos_product_key) in the real export. */
import fs from "node:fs";
import * as XLSX from "xlsx";
import { transformWorkbooks } from "@/lib/pos/transform";
import { planImportLots } from "@/lib/pos/import-lot-core";
const wb = XLSX.read(fs.readFileSync("normalized_cultivera/PRODUCTS_NORMALIZED.xlsx"));
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" }).map((r) => ({ ...r, Description: "" }));
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows), "Sheet1");
const t = transformWorkbooks({
  productsBuffer: XLSX.write(out, { type: "buffer", bookType: "xlsx" }) as Buffer,
  inventoriesBuffer: fs.readFileSync("normalized_cultivera/INVENTORIES_NORMALIZED.xlsx"),
  productsSheet: "Sheet1",
  inventoriesSheet: "Inventories",
});
const lots = planImportLots(t.lotSources).lots;
const byKey = new Map<string, typeof lots>();
for (const l of lots) byKey.set(l.posProductKey, [...(byKey.get(l.posProductKey) ?? []), l]);
const hist = new Map<number, number>();
for (const v of byKey.values()) hist.set(v.length, (hist.get(v.length) ?? 0) + 1);
const sameName = [...byKey.values()].filter((v) => v.length > 1 && new Set(v.map((l) => l.productName)).size > 1).length;
const visible = t.items.filter((i) => !i.hidden).length;
console.log(JSON.stringify({ lots: lots.length, keys: byKey.size, items: t.items.length, visible, sizeHist: [...hist.entries()].sort((a, b) => a[0] - b[0]), keysWithDifferentNames: sameName,
  withStrainType: lots.filter((l) => l.strainType).length, withStrain: lots.filter((l) => l.strainName).length, withPotency: lots.filter((l) => l.potency && (l.potency.thc != null || l.potency.cbd != null)).length,
  withMinors: lots.filter((l) => (l.potency?.minors ?? []).length > 0).length, withWeight: lots.filter((l) => l.unitWeight != null).length, withBrand: lots.filter((l) => l.brandLabel).length, withCost: lots.filter((l) => l.unitCostMinorUnits != null).length }));
