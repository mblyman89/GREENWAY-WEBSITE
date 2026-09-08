/**
 * L3 RECON PROBE — what does extractNameFacts actually return for real
 * liquid product names? Answers the two design questions that decide the
 * derivation rule, WITHOUT guessing:
 *   1. Does a multi-pack liquid ("4 x 50ml") yield packCount, so a per-package
 *      total is derivable, or is it silently a single 50 ml fact?
 *   2. How often do names carry MORE THAN ONE volume size (ambiguity)?
 *
 * Run: npx tsx scripts/compliance/probe-l3-sizes.ts
 */
import { extractNameFacts } from "../../src/lib/inventory/fact-extraction-core";

const NAMES = [
  // single, unambiguous
  "Fairwinds Sleepy Time Tincture 30ml",
  "Ceres Quencher Lemonade 12 fl oz",
  "Happy Apple Cider 1L",
  "Zoots Zooties Drink 750 ml",
  // multi-pack phrasings (the dangerous class)
  "Ray's Lemonade 4 x 50ml",
  "Ray's Lemonade 4x50ml",
  "Pearl Rx Drink 4 Pack 100mg",
  "Legal Cherry 6 Pack 12 fl oz",
  "Vitalis Shot 2 x 2 fl oz",
  // weight-only (must NOT produce a volume)
  "A.C. Topical Salve 1.7 oz",
  "Cannasol Rick Simpson Oil 1g",
  // mixed units in one name
  "Tincture 1 oz 30ml",
  "Elixir 100ml 3.4 fl oz",
  // bare ounces on a liquid (ambiguous by design)
  "Mirth Provisions Legal Root Beer 12 oz",
  // dose mg must never be read as a volume
  "Wyld Raspberry Sparkling Water 10mg",
];

for (const n of NAMES) {
  const f = extractNameFacts(n);
  const vol = f.sizes.filter((s) => s.unit === "ml" || s.unit === "l" || s.unit === "floz");
  console.log(
    JSON.stringify({
      name: n,
      sizes: f.sizes,
      volumeSizes: vol,
      packCount: f.packCount,
      servingsTimesDose: f.servingsTimesDose,
    }),
  );
}
