import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";
import { LIQUID_VOLUME_TYPES } from "@/lib/compliance/liquid-volume-derivation-core";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import { resolveWebsiteCategory } from "@/lib/inventory/website-category-resolver";
import { categoryToBucket } from "@/lib/compliance/sales-limits-core";

// EVERY inventory type label in the catalog, plus the CCRS types, and where
// each one actually lands. No assumption about which strings arrive.
const ccrs = ["Topical Ointment", "Suppository", "Transdermal Patch", "Capsule", "Liquid Edible", "Tincture", "Solid Edible"];
const labels = Array.from(new Set([...INVENTORY_TYPE_CATALOG.map((e) => e.label), ...ccrs]));

console.log("inventoryType".padEnd(24), "resolvedCat".padEnd(14), "bucket".padEnd(14), "MG_FACT", "LIQ_VOL");
const rows: string[] = [];
for (const l of labels) {
  const cat = resolveWebsiteCategory({ inventoryType: l, productName: "Balm" }).websiteCategory;
  const bucket = categoryToBucket(cat);
  if (bucket !== "liquid_edible") continue; // only the bucket we care about
  rows.push(
    `${l.padEnd(24)} ${String(cat).padEnd(14)} ${String(bucket).padEnd(14)} ${String(MG_FACT_TYPES.has(l)).padEnd(7)} ${LIQUID_VOLUME_TYPES.has(l)}`,
  );
}
rows.sort().forEach((r) => console.log(r));
