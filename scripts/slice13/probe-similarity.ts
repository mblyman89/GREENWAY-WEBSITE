/**
 * Slice 13 probe — measure what the EXISTING fuzzy stack actually does before
 * depending on it. Facts, not assumptions.
 *
 * Run: npx tsx scripts/slice13/probe-similarity.ts
 */
import { similarity, normalizeStrainQuery } from "../../src/lib/ai/kb/strain-matcher";

const NAMES = [
  "Blue Dream 3.5g",
  "Cantina Gummies - Guava 10 Pack 400mg",
  "2727 - Live Resin Cart - GG4 1g",
  "Gorilla Glue #4 Preroll",
  "Wedding Cake Live Rosin 1g",
  "Dutchie Dark Chocolate Bar 100mg",
];

const QUERIES = [
  "blue dream",
  "dream blue",       // reordered
  "blue dreem",       // typo
  "gummies guava",    // reordered, middle words
  "guava",            // middle substring
  "cantina",          // leading word
  "400mg",            // trailing token
  "gg4",              // compressed
  "live resin",       // middle phrase
  "weding cake",      // typo, missing letter
  "chocolat",         // partial word
  "xyzzy",            // should match nothing
];

console.log("normalize examples:");
for (const n of NAMES.slice(0, 3)) {
  console.log(`  ${JSON.stringify(n)} -> ${JSON.stringify(normalizeStrainQuery(n))}`);
}
console.log();

for (const q of QUERIES) {
  const nq = normalizeStrainQuery(q);
  const scored = NAMES.map((n) => ({
    n,
    s: similarity(nq, normalizeStrainQuery(n)),
  })).sort((a, b) => b.s - a.s);
  const top = scored[0];
  const second = scored[1];
  console.log(
    `q=${JSON.stringify(q).padEnd(16)} best=${top ? top.s.toFixed(3) : "n/a"} ${top ? JSON.stringify(top.n) : ""}`,
  );
  if (second) console.log(`${" ".repeat(23)}2nd=${second.s.toFixed(3)} ${JSON.stringify(second.n)}`);
}
