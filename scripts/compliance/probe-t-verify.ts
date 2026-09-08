import { deriveNetVolumeMl, deriveNetWeightGrams } from "@/lib/compliance/liquid-volume-derivation-core";
import { assessReceivingVolume, validateReceivingVolumeChoice } from "@/lib/inventory/receiving-classification-core";
import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";

console.log("=== T1: weight-labelled salves must now ONBOARD ===");
for (const n of [
  "Fairwinds Flow Cream 2oz",
  "Ceres Wellness Balm 1.7oz",
  "Green Revolution Sublime Salve 30g",
  "Zoots Zootrx Releaf Balm 50ml",
  "Fairwinds Relief Balm",           // genuinely unmeasurable -> MUST still gate
]) {
  const f = extractNameFacts(n);
  const vol = deriveNetVolumeMl({ rawName: n, sizes: f.sizes, packCount: f.packCount });
  const g = deriveNetWeightGrams(f.sizes);
  const a = assessReceivingVolume({
    resolvedWebsiteCategory: "topical",
    derivedVolumeMl: vol.netVolumeMl,
    derivedWeightGrams: g,
  });
  const r = validateReceivingVolumeChoice({ assessment: a });
  console.log(`  ${n.padEnd(34)} ml=${String(vol.netVolumeMl).padEnd(8)} g=${String(g).padEnd(9)} gate=${String(a.needsVolumePick).padEnd(5)} ${r.ok ? "APPROVES" : "REFUSED(" + r.code + ")"}`);
}

console.log("\n=== a DRINK with no size must STILL gate (fail-closed intact) ===");
{
  const n = "Mystery Tonic";
  const f = extractNameFacts(n);
  const vol = deriveNetVolumeMl({ rawName: n, sizes: f.sizes, packCount: f.packCount });
  const a = assessReceivingVolume({
    resolvedWebsiteCategory: "edible-liquid",
    derivedVolumeMl: vol.netVolumeMl,
    derivedWeightGrams: deriveNetWeightGrams(f.sizes),
  });
  const r = validateReceivingVolumeChoice({ assessment: a });
  console.log(`  ${n.padEnd(34)} gate=${a.needsVolumePick} ${r.ok ? "APPROVES <-- WRONG" : "REFUSED(" + r.code + ") <-- correct"}`);
}

console.log("\n=== non-liquid shelves untouched ===");
for (const cat of ["flower", "concentrate", "edible-solid"]) {
  const a = assessReceivingVolume({ resolvedWebsiteCategory: cat, derivedVolumeMl: null, derivedWeightGrams: null });
  console.log(`  ${cat.padEnd(14)} meteredShelf=${a.isVolumeMeteredShelf} gate=${a.needsVolumePick}`);
}
