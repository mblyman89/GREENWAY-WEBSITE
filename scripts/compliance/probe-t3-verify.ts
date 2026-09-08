import { buildDraftInjectionPlan } from "@/lib/pos/draft-injection-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

function run(name: string, invType: string, cat: string) {
  const d = {
    id: "d1", pos_product_key: "KEY-1", name,
    brand_name: "B", vendor_name: "V", strain_name: null,
    thc_pct: null, cbd_pct: null, total_thc_pct: null, potency_json: null,
    price_minor_units: 1000, updated_at: "2026-01-01T00:00:00Z",
    inventory_type: invType,
  } as unknown as ApprovedDraftForInjection;
  const e = new Map<string, DraftEnrichment>([["d1", { websiteCategory: cat, strainType: null, onHandQty: 5, packageLabel: "each" } as DraftEnrichment]]);
  const p = buildDraftInjectionPlan({ drafts: [d], existingKeys: new Set(), enrichmentByDraftId: e, baseSortOrder: 100 });
  const item = p.items[0] as unknown as Record<string, unknown> | undefined;
  const missing = p.diagnostics.filter((x) => x.code === "net_volume_missing").length;
  console.log(
    `  ${invType.padEnd(20)} ${name.padEnd(26)} net_volume_ml=${String(item?.net_volume_ml).padEnd(9)} net_weight_grams=${String(item?.net_weight_grams).padEnd(9)} missingDiag=${missing}`,
  );
}

console.log("=== T3: types that were NEVER measured before ===");
run("Soda", "Soda", "edible-liquid");
run("Craft Soda 12 fl oz", "Soda", "edible-liquid");
run("Hi-Fi Hops 355ml", "Beverage", "edible-liquid");
run("Wellness Shot 2 fl oz", "Shots", "edible-liquid");
run("Relief Balm 2oz", "Topical", "topical");
run("Bath Soak 8oz", "Bath Salts", "topical");
run("Roll On 10ml", "Roll On", "topical");
console.log("\n=== already-working types must not move ===");
run("Lemonade 750ml", "Liquid Edible", "edible-liquid");
run("Tincture 30ml", "Tincture", "edible-liquid");
console.log("\n=== non-liquid untouched ===");
run("Blue Dream 3.5g", "Usable Cannabis", "flower");
