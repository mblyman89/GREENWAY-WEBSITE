import { evaluateCart } from "@/lib/compliance/sales-limits-core";

// A Soda / Beverage draft never enters the MG_FACT_TYPES branch, so injection
// records NO net_volume_ml even when the NAME states one. Consequence:
console.log("=== a 'Soda' named '12 fl oz' that injection never measured ===");
for (const qty of [9, 72, 73]) {
  const r = evaluateCart([{ category: "edible-liquid", quantity: qty, grams: null, volumeMl: null } as never]);
  const b = r.buckets.find((x) => x.bucket === "liquid_edible");
  console.log(`  qty=${String(qty).padEnd(3)} used=${b?.used}${b?.unit} EXCEEDED=${b?.exceeded}`);
}
console.log("\n  72 x 12 fl oz = 864 fl oz of soda, against a 72 fl oz cap = 12x over.");
