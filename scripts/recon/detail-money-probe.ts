/**
 * scripts/recon/detail-money-probe.ts
 *
 * SLICE L-25 — does the order detail view show the right money?
 *
 * ===========================================================================
 * WHY THIS PROBE EXISTS
 * ===========================================================================
 * It was not on the plan. It came out of a failing assertion.
 *
 * While writing the regression test for the owner's blank-detail report, a
 * CONTROL case — "prove the reader is not at fault, a real order parses
 * fine" — expected a total of 4803 and got 480300. The test expectation was
 * written from the spec; the code returned something a hundred times larger.
 *
 * One of the two was wrong, and money is not a thing to settle by argument,
 * so this probe settles it against the vendored authoritative spec and the
 * two readers that disagree.
 *
 * ===========================================================================
 * WHAT THE SPEC SAYS (docs/leafly-specs/order-api-v1.openapi.json)
 * ===========================================================================
 *   Order.subtotal        "order total before taxes and fees in minor units"
 *   Order.total           "order grand total in minor units, ..."
 *   Order.deliveryFee     "order delivery fee in minor units..."
 *   Order.totalDiscounts  "total of discounts applied to the order in minor units"
 *   Order.taxes           $ref Taxes  ->  ARRAY of TaxComponent
 *   TaxComponent.amountCents  "tax amount in minor units"
 *   CartItemOutgoing.priceCents           "...in minor units"
 *   CartItemOutgoing.discountedPriceCents "...in minor units"
 *
 * Every money field Leafly sends on an Order is ALREADY in minor units.
 *
 * ===========================================================================
 * WHAT THE TWO READERS DO
 * ===========================================================================
 *   order-fetch-core.ts   `intOrNull(o.subtotal)`   — takes it as given.
 *   order-detail-core.ts  `toMinorUnits(o.subtotal)` — MULTIPLIES BY 100.
 *
 * `toMinorUnits` is a correct and carefully-written dollars-to-cents
 * converter. The defect is not in it; it is in applying it to a field that
 * is already cents.
 *
 * Run:  npx tsx scripts/recon/detail-money-probe.ts
 */

import { readFileSync } from "node:fs";

import { readOrderDetail, formatDetailMoney } from "../../src/lib/leafly/order-detail-core";
import { normaliseFetchedOrder } from "../../src/lib/leafly/order-fetch-core";

const spec = JSON.parse(
  readFileSync("docs/leafly-specs/order-api-v1.openapi.json", "utf8"),
) as {
  components: { schemas: Record<string, { properties?: Record<string, { description?: string }> }> };
};

console.log("=== 1. WHAT THE SPEC SAYS ===");
const orderProps = spec.components.schemas.Order.properties ?? {};
for (const field of ["subtotal", "total", "deliveryFee", "totalDiscounts"]) {
  const desc = orderProps[field]?.description ?? "(absent)";
  console.log(`  Order.${field}: ${desc.slice(0, 80)}`);
}
console.log(
  `  TaxComponent.amountCents: ${
    spec.components.schemas.TaxComponent.properties?.amountCents?.description ?? "(absent)"
  }`,
);

/**
 * A realistic Order, built strictly from the spec's field names and units.
 * A $48.03 order: subtotal 4000 cents, tax 803 cents, total 4803 cents.
 */
const REAL_ORDER = {
  id: "5f8d0d55-b9a1-4a1e-9f2b-2f1a9c0d3e77",
  firstName: "Jane",
  lastName: "Doe",
  subtotal: 4000,
  total: 4803,
  taxes: [
    { name: "Cannabis Excise Tax", amountCents: 600 },
    { name: "Sales Tax", amountCents: 203 },
  ],
  cartItems: [
    {
      id: "ci-1",
      name: "Blue Dream",
      quantity: 1,
      priceCents: 4000,
      discountedPriceCents: 4000,
      packagePrice: 4000,
    },
  ],
};

console.log("\n=== 2. THE TWO READERS, SAME PAYLOAD ===");
const facts = normaliseFetchedOrder(REAL_ORDER);
console.log("  order-fetch-core (intOrNull, takes as given):");
console.log(`    subtotalMinorUnits = ${facts.subtotalMinorUnits}   (expected 4000)`);
console.log(`    totalMinorUnits    = ${facts.totalMinorUnits}   (expected 4803)`);

const detail = readOrderDetail(REAL_ORDER);
console.log("  order-detail-core (toMinorUnits, multiplies by 100):");
console.log(`    subtotalMinorUnits = ${detail.subtotalMinorUnits}`);
console.log(`    taxesMinorUnits    = ${detail.taxesMinorUnits}`);
console.log(`    totalMinorUnits    = ${detail.totalMinorUnits}`);
console.log(`    lines[0].lineTotal = ${detail.lines[0]?.lineTotalMinorUnits}`);

console.log("\n=== 3. WHAT THE OPERATOR ACTUALLY SEES ===");
console.log(`    Subtotal: ${formatDetailMoney(detail.subtotalMinorUnits)}   (truth: $40.00)`);
console.log(`    Taxes:    ${formatDetailMoney(detail.taxesMinorUnits)}   (truth: $8.03)`);
console.log(`    Total:    ${formatDetailMoney(detail.totalMinorUnits)}   (truth: $48.03)`);
console.log(
  `    Line:     ${formatDetailMoney(detail.lines[0]?.lineTotalMinorUnits ?? null)}   (truth: $40.00)`,
);

console.log("\n=== 4. VERDICT ===");
const defects: string[] = [];
if (detail.totalMinorUnits !== 4803) {
  defects.push(
    `TOTAL IS ${detail.totalMinorUnits === null ? "MISSING" : `${detail.totalMinorUnits / 4803}x TOO LARGE`} ` +
      `(got ${detail.totalMinorUnits}, spec says 4803)`,
  );
}
if (detail.subtotalMinorUnits !== 4000) {
  defects.push(
    `SUBTOTAL IS WRONG (got ${detail.subtotalMinorUnits}, spec says 4000)`,
  );
}
if (detail.taxesMinorUnits !== 803) {
  defects.push(
    `TAXES ARE WRONG (got ${detail.taxesMinorUnits}, spec says 803). ` +
      `Order.taxes is an ARRAY of TaxComponent, not a number — toMinorUnits(array) is null.`,
  );
}
if (detail.lines[0]?.lineTotalMinorUnits !== 4000) {
  defects.push(
    `LINE PRICE IS WRONG (got ${detail.lines[0]?.lineTotalMinorUnits}, spec says 4000). ` +
      `The reader looks for totalPrice/total/price; the spec sends ` +
      `discountedPriceCents/priceCents/packagePrice.`,
  );
}

if (defects.length === 0) {
  console.log("  No defects. The detail view agrees with the spec.");
} else {
  for (const d of defects) console.log(`  DEFECT: ${d}`);
  console.log(
    `\n  ${defects.length} money defect(s) on the screen a staff member reads before\n` +
      `  handing over a bag, inside a fifteen-minute window.`,
  );
}
