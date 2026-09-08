/**
 * DOOBIE TUESDAY - reproduce what Michael measured at the register.
 *
 * Owner's report:
 *   - tiers should be 1-3 prerolls = 20%, 4+ = 25%
 *   - 4th preroll does NOT trigger the better tier
 *   - it "kicks in" at 6, but computes 4-for-3 across 6 -> ~16% average
 *   - above 7 it reverts to 20% for the whole cart
 *
 * No guessing: run the REAL engine over the REAL seeded rule.
 */
import { applyOnePromotion } from "@/lib/promotions/discount-engine-core";
import type { EngineRule, EngineCartLine } from "@/lib/promotions/discount-engine-core";

const PRICE = 1000; // $10.00 preroll, in minor units

const rule: EngineRule = {
  id: "r-tue",
  promoKey: "daily.tuesday",
  title: "Doobie Tuesday",
  discountType: "multi_item_tier",
  discountPercent: 20,
  discountFixed: 0,
  priority: 10,
  stackable: false,
  targetCategories: [
    "preroll",
    "blunt",
    "preroll-pack",
    "infused-preroll",
    "infused-blunt",
    "infused-preroll-pack",
  ],
  targetBrands: [],
  targetProductKeys: [],
  excludeCategories: [],
  excludeBrands: [],
  excludeProductKeys: [],
  storewide: false,
  config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } },
} as unknown as EngineRule;

function line(id: string, price: number, qty: number, category = "preroll"): EngineCartLine {
  return {
    lineId: id,
    productKey: id,
    categories: [category],
    brand: "Brand",
    variantLabel: "1g",
    regularPriceMinorUnits: price,
    quantity: qty,
  } as unknown as EngineCartLine;
}

function report(label: string, lines: EngineCartLine[]) {
  const res = applyOnePromotion(rule, lines);
  let regular = 0;
  let paid = 0;
  for (const l of lines) {
    regular += l.regularPriceMinorUnits * l.quantity;
    const d = res.get(l.lineId);
    paid += (d ? d.unitPrice : l.regularPriceMinorUnits) * l.quantity;
  }
  const saved = regular - paid;
  const pct = regular > 0 ? (saved / regular) * 100 : 0;
  const anyLabel = [...res.values()][0]?.label ?? "(no discount)";
  console.log(
    `${label.padEnd(34)} regular $${(regular / 100).toFixed(2).padStart(7)}  ` +
      `paid $${(paid / 100).toFixed(2).padStart(7)}  saved $${(saved / 100).toFixed(2).padStart(6)}  ` +
      `= ${pct.toFixed(2).padStart(6)}%   ${anyLabel}`,
  );
  return pct;
}

console.log("=".repeat(118));
console.log("A. ONE LINE, quantity 1..12, identical $10 prerolls");
console.log("   Expected by owner: 20% at 1-3, then 25% from 4 up.");
console.log("=".repeat(118));
const single: number[] = [];
for (let q = 1; q <= 12; q += 1) {
  single.push(report(`qty ${String(q).padStart(2)}`, [line("L1", PRICE, q)]));
}

console.log();
console.log("=".repeat(118));
console.log("B. SEPARATE LINES (how a register cart really looks): q distinct $10 prerolls");
console.log("=".repeat(118));
for (let q = 1; q <= 12; q += 1) {
  const lines = Array.from({ length: q }, (_, i) => line(`L${i}`, PRICE, 1));
  report(`${String(q).padStart(2)} separate lines`, lines);
}

console.log();
console.log("=".repeat(118));
console.log("C. MIXED PRICES - 4 prerolls, one cheap ($2) and three at $10");
console.log("=".repeat(118));
report("4 mixed (2,10,10,10)", [
  line("A", 200, 1),
  line("B", PRICE, 1),
  line("C", PRICE, 1),
  line("D", PRICE, 1),
]);

console.log();
console.log("=".repeat(118));
console.log("D. THE 4-FOR-3 PROMISE, checked directly");
console.log("   'Buy 4 for the price of 3' on identical items IS exactly 25% off.");
console.log("=".repeat(118));
for (const q of [4, 8, 12]) {
  const expectedPaidGroups = Math.floor(q / 4) * 3 + (q % 4);
  console.log(
    `   qty ${q}: a true 4-for-3 charges for ${expectedPaidGroups} units = $${((expectedPaidGroups * PRICE) / 100).toFixed(2)}` +
      `  (a flat 25% would charge $${((q * PRICE * 0.75) / 100).toFixed(2)})`,
  );
}

console.log();
console.log("=".repeat(118));
console.log("E. SUMMARY OF THE SINGLE-LINE CURVE (owner's symptom, in one row)");
console.log("=".repeat(118));
console.log("   qty : " + single.map((_, i) => String(i + 1).padStart(6)).join(""));
console.log("   pct : " + single.map((p) => p.toFixed(1).padStart(6)).join(""));
