/**
 * PROBE (throwaway, not shipped): measure the customer-facing website's liquid
 * volume coverage, and test the variant-vs-card precedence question.
 * Run: npx tsx scripts/compliance/probe-l5a.ts
 */
import { cartLimitBlock, cartLimitLines } from "../../src/lib/menu/cart-limit-meter-core";
import { volumeMlFromLabel } from "../../src/lib/compliance/liquid-volume-core";

type Row = { label: string; qty: number; unitVolumeMl?: number | null };

function meter(label: string, qty: number, unitVolumeMl?: number | null) {
  const items = [
    { category: "edible-liquid", quantity: qty, variantLabel: label, unitVolumeMl: unitVolumeMl ?? null },
  ];
  const lines = cartLimitLines(items);
  const { over } = cartLimitBlock(items);
  const line = lines[0] as { volumeMl?: number; grams?: number };
  return { volumeMl: line.volumeMl, grams: line.grams, over };
}

console.log("=== A. volumeMlFromLabel on real storefront labels ===");
for (const l of ["", "each", "100mg", "4pk", "750ml", "1.5L", "2 fl oz", "12oz", "1g"]) {
  console.log(`  label=${JSON.stringify(l).padEnd(10)} -> ${volumeMlFromLabel(l)}`);
}

console.log("\n=== B. WEBSITE meter TODAY (no unitVolumeMl plumbed = current CartItemInput) ===");
const cases: Row[] = [
  { label: "", qty: 72 },
  { label: "100mg", qty: 72 },
  { label: "4pk", qty: 72 },
  { label: "750ml", qty: 3 },
];
for (const c of cases) {
  const r = meter(c.label, c.qty);
  console.log(
    `  label=${JSON.stringify(c.label).padEnd(9)} qty=${String(c.qty).padEnd(3)} volumeMl=${String(r.volumeMl).padEnd(9)} grams=${String(r.grams).padEnd(8)} BLOCKED=${r.over}`,
  );
}

console.log("\n=== C. WEBSITE meter WITH unitVolumeMl plumbed (the L5a fix) ===");
for (const c of cases) {
  const r = meter(c.label, c.qty, 750);
  console.log(
    `  label=${JSON.stringify(c.label).padEnd(9)} qty=${String(c.qty).padEnd(3)} unitVolumeMl=750 volumeMl=${String(r.volumeMl).padEnd(9)} BLOCKED=${r.over}`,
  );
}

console.log("\n=== D. PRECEDENCE: card-level netVolumeMl vs variant label ===");
console.log("  Scenario: ONE card, variants 750ml and 1.5L. Card netVolumeMl comes");
console.log("  from firstAvailable (the first variant with stock), so it may be 750.");
const cardMl = 750; // firstAvailable = the 750 ml lot
console.log("\n  -- current precedence (item.netVolumeMl ?? label), buying the 1.5L variant --");
{
  const chosen = cardMl ?? volumeMlFromLabel("1.5L");
  console.log(`     resolved unit ml = ${chosen}  (TRUE value = 1500)`);
  const r = meter("1.5L", 2, chosen);
  console.log(`     qty=2 volumeMl=${r.volumeMl} BLOCKED=${r.over}  (TRUE = 3000 ml, cap 2129.292)`);
}
console.log("\n  -- label-first precedence (volumeMlFromLabel(label) ?? item.netVolumeMl) --");
{
  const chosen = volumeMlFromLabel("1.5L") ?? cardMl;
  console.log(`     resolved unit ml = ${chosen}`);
  const r = meter("1.5L", 2, chosen);
  console.log(`     qty=2 volumeMl=${r.volumeMl} BLOCKED=${r.over}`);
}
console.log("\n  -- label-first still covers the empty-label 'each' case --");
{
  const chosen = volumeMlFromLabel("") ?? cardMl;
  console.log(`     label="" resolved unit ml = ${chosen} (falls through to card measure)`);
}
