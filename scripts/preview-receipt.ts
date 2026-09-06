/**
 * scripts/preview-receipt.ts (Slice 22b, dev-only)
 *
 * Renders a representative sale through the REAL builder so the printed
 * layout can be eyeballed before it ever reaches paper. Writes HTML to stdout.
 *
 *   npx tsx scripts/preview-receipt.ts > /tmp/receipt.html
 */
import { buildPosReceiptHtml, type PosReceiptInput } from "../src/lib/pos/receipt-core";

const input: PosReceiptInput = {
  saleClientUuid: "9f2c1a44-5b7e-4c3d-8a19-7e4d2b6c9f30",
  soldAtIso: "2026-09-05T21:14:00.000Z",
  registerLabel: "Register 1",
  headerText: "GREENWAY MARIJUANA",
  footerText:
    "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!",
  addressLines: [
    "9107 SW State Hwy 3",
    "Port Orchard, WA 98367",
    "(360) 616-0700",
    "License 413541",
  ],
  servedBy: "Marcus",
  hideSavings: false,
  lines: [
    {
      productName: "Blue Dream (3.5g)",
      quantity: 1,
      unitPriceMinor: 3500,
      regularPriceMinor: 4200,
      category: "flower",
      brand: "Sky High Farms",
      variantLabel: "3.5g",
      unitGrams: 3.5,
      appliedLabel: "Happy Hour 15%",
    },
    {
      productName: "Sour Watermelon Gummies",
      quantity: 2,
      unitPriceMinor: 1500,
      regularPriceMinor: 1500,
      category: "edible",
      brand: "Craft Elixirs",
      unitThcMg: 10,
    },
    {
      productName: "Glass Grinder",
      quantity: 1,
      unitPriceMinor: 1200,
      regularPriceMinor: 1200,
      category: "accessories",
      brand: "Santa Cruz",
    },
  ],
  subtotalMinor: 0,
  taxMinor: 0,
  totalMinor: 0,
  savingsMinor: 700,
  medicalSavingsMinor: 0,
  medicalSale: false,
  tenderedMinor: 8000,
  changeMinor: 0,
  loyalty: { memberLabel: "M. Lyman (••4821)", pointsEarned: 54 },
};

// Compute the money exactly the way the register does, from the same core.
import { computeOrderTotals } from "../src/lib/orders/order-pricing-core";
const totals = computeOrderTotals(
  input.lines.map((l) => ({
    category: l.category ?? null,
    quantity: l.quantity,
    unitPriceMinorUnits: l.unitPriceMinor,
    regularPriceMinorUnits: l.regularPriceMinor,
  })),
);
input.subtotalMinor = totals.subtotalMinorUnits;
input.taxMinor = totals.estimatedTaxMinorUnits;
input.totalMinor = totals.totalMinorUnits;
input.changeMinor = input.tenderedMinor - input.totalMinor;

process.stdout.write(buildPosReceiptHtml(input));
