import { evaluateCart, categoryToBucket, DEFAULT_UNIT_GRAMS } from "@/lib/compliance/sales-limits-core";
import { volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";
import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";

console.log("topical -> bucket:", categoryToBucket("topical"));
console.log("DEFAULT_UNIT_GRAMS[topical]:", (DEFAULT_UNIT_GRAMS as Record<string, number>)["topical"]);

// The engine reads `grams` (whole line) or `volumeMl` (whole line). A caller
// resolves those from the label. Mirror that here instead of inventing a field.
function maxQty(category: string, label: string) {
  const g = gramsFromVariantLabel(label);
  const ml = volumeMlFromLabel(label);
  let last = 0;
  for (let q = 1; q <= 1000; q++) {
    const line = {
      category, quantity: q,
      grams: g !== null ? g * q : null,
      volumeMl: ml !== null ? ml * q : null,
    };
    const r = evaluateCart([line as never]);
    const b = r.buckets.find((x) => x.bucket === "liquid_edible");
    if (b && !b.exceeded) last = q; else break;
  }
  return { perUnitG: g, perUnitMl: ml, last };
}

console.log("\n=== A. WEIGHT-labelled topicals (salve/balm) ===");
for (const label of ["1oz", "1.7oz", "2oz", "4oz", "8oz"]) {
  const { perUnitG, last } = maxQty("topical", label);
  const oz = parseFloat(label);
  console.log(`  ${label.padEnd(6)} perUnitG=${perUnitG} MAX=${last}  expected 72/oz=${Math.floor(72 / oz)}`);
}

console.log("\n=== B. VOLUME-labelled topicals (lotion/spray in ml) ===");
for (const label of ["50ml", "100ml", "236ml", "1.5L", "8floz"]) {
  const { perUnitMl, last } = maxQty("topical", label);
  console.log(`  ${label.padEnd(7)} perUnitMl=${perUnitMl} MAX=${last} totalMl=${perUnitMl ? (perUnitMl * last).toFixed(1) : "n/a"}`);
}

console.log("\n=== C. UNLABELLED topical (no size parseable) ===");
const un = maxQty("topical", "each");
console.log("  each ->", JSON.stringify(un));

console.log("\n=== D. shared bucket: 8oz salve + 750ml drink ===");
const gS = gramsFromVariantLabel("8oz");
const mixed = evaluateCart([
  { category: "topical", quantity: 1, grams: gS } as never,
  { category: "edible-liquid", quantity: 1, volumeMl: 750 } as never,
]);
const mb = mixed.buckets.find((x) => x.bucket === "liquid_edible");
console.log(`  8oz salve grams=${gS} + 750ml drink => used=${mb?.used}${mb?.unit} max=${mb?.max} exceeded=${mb?.exceeded}`);
