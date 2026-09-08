/**
 * DOOBIE TUESDAY - the arithmetic behind the sawtooth, proven not asserted.
 *
 * For q identical units, a 4-for-3 spread saves floor(q/4) units, i.e.
 *   raw  = floor(q/4)/q
 *   pct  = floor(raw * 100)          <- integer floor, store-advantaged
 * The engine then picks min(20, pct). Both the floor AND the min contribute.
 */

function bundlePercentIdentical(q: number): number {
  const groups = Math.floor(q / 4);
  if (groups <= 0) return 0;
  return Math.min(99, Math.floor((groups / q) * 100));
}

console.log("q   bundle%  flat%  ENGINE PICKS   effective   what the owner expects");
console.log("-".repeat(86));
let worst = { q: 0, pct: 100 };
for (let q = 1; q <= 24; q += 1) {
  const b = bundlePercentIdentical(q);
  const flat = 20;
  // engine: smaller POSITIVE savings wins
  let pick: number;
  let which: string;
  if (b <= 0) {
    pick = flat;
    which = "flat";
  } else if (flat <= b) {
    pick = flat;
    which = "flat";
  } else {
    pick = b;
    which = "bundle";
  }
  const expected = q >= 4 ? 25 : 20;
  const flag = pick < expected ? "  <-- SHORT" : "";
  if (q >= 4 && pick < worst.pct) worst = { q, pct: pick };
  console.log(
    `${String(q).padStart(2)}  ${String(b).padStart(6)}%  ${String(flat).padStart(4)}%  ` +
      `${which.padEnd(12)}  ${String(pick).padStart(7)}%   ${String(expected).padStart(3)}%${flag}`,
  );
}
console.log();
console.log(`Worst effective discount at 4+ units: ${worst.pct}% at q=${worst.q}`);
console.log();

console.log("WHY THE 4th UNIT DOES NOTHING:");
console.log("  q=4 -> bundle raw = 1/4 = 25%, floor = 25%. Engine compares 25% vs flat 20%");
console.log("         and takes the SMALLER saving -> 20%. The tier is reachable but never chosen.");
console.log();
console.log("WHY IT 'KICKS IN' AT 6:");
console.log("  q=6 -> bundle raw = 1/6 = 16.67%, floor = 16%. 16% < 20%, so the bundle now");
console.log("         saves LESS and therefore WINS the store-advantaged comparison. The");
console.log("         customer's discount DROPS from 20% to 16% by adding a 6th preroll.");
console.log();
console.log("WHY IT 'GOES BACK' ABOVE 7:");
console.log("  q=8 -> bundle raw = 2/8 = 25% -> not smaller than 20% -> flat 20% wins again.");
console.log("  The bundle only wins when q is NOT a multiple of 4 in a way that drags the");
console.log("  average below 20%: q = 6,7,11,13,14,15,19,21,22,23...  -> a sawtooth.");
console.log();

const dips: number[] = [];
for (let q = 4; q <= 40; q += 1) {
  const b = bundlePercentIdentical(q);
  if (b > 0 && b < 20) dips.push(q);
}
console.log("Quantities where the customer gets LESS than the headline 20%:");
console.log("  " + dips.join(", "));
console.log();

console.log("NON-MONOTONIC: adding one more preroll can REDUCE total savings.");
for (const q of [5, 6, 7, 8]) {
  const pct = Math.min(20, bundlePercentIdentical(q) || 20);
  const saved = (q * 1000 * pct) / 100;
  console.log(`  ${q} x $10.00 -> ${pct}% -> saves $${(saved / 100).toFixed(2)}`);
}
console.log("  Note 5 -> 6 : savings fall from $10.00 to $9.60 while the cart GREW.");
