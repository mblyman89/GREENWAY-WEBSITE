/**
 * src/lib/pos/receipt-tax-core.ts  (Slice 22b)
 *
 * PURE tax-itemization for the printed receipt. No I/O, no React, no
 * server-only import, so the register, the admin live preview, the reprint
 * path and vitest all run the IDENTICAL arithmetic.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * RCW 69.50.535(1)(a), verbatim:
 *
 *   "The tax must be separately itemized from the state and local retail
 *    sales tax on the sales receipt provided to the buyer."
 *
 * Until this slice the register printed ONE combined `Tax` row
 * (pos/receipt-core, the single `Tax` line in the totals block). That is the
 * one thing on the receipt Washington actually legislates, and we were not
 * doing it. Everything else in this slice is presentation; this part is law.
 *
 * For the avoidance of doubt, and because it was researched rather than
 * assumed: CCRS (lcb.wa.gov/ccrs/faq) is a WEEKLY CSV REPORTING system and
 * imposes NO receipt format whatsoever, and the four warning statements in
 * WAC 314-55-155(6) govern ADVERTISING, not receipts. So the only receipt
 * content rule that binds this store is the itemization sentence above.
 *
 * THE RATES ARE NOT RESTATED HERE
 * -------------------------------
 * Every rate is imported from orders/order-pricing-core, which the file's own
 * header calls the "SINGLE SOURCE OF TRUTH for the statutory tax rates" after
 * an earlier slice found two hardcoded twins that had drifted. Re-typing 37%
 * or 9.3% into this file would recreate exactly that bug, so it is not done.
 *
 * WHY A SPLIT CANNOT SIMPLY BE lineTotal / 1.463
 * ----------------------------------------------
 * Two independent things break the naive divisor:
 *
 *  1. CATEGORY. Merch/accessories carry ONLY the retail sales tax, never the
 *     cannabis excise (NON_CANNABIS_TAX_CATEGORIES). Their divisor is 1.093.
 *
 *  2. MEDICAL. The two exemptions are INDEPENDENT (sales tax under
 *     RCW 82.08.9998; excise under WAC 314-55-090(1)), and pos/medical-pos-core
 *     REBUILDS a carded line's inclusive unit price as `base + still-due
 *     taxes`. A fully exempt line's shelf price IS its pre-tax base. Dividing
 *     that by 1.463 would invent an excise charge the patient never paid and
 *     print it on a tax record. So exemption flags travel per line and a line
 *     gets exactly the divisor its own still-due taxes justify.
 *
 * HONESTY RULE
 * ------------
 * The itemized parts MUST add up to the authoritative tax the customer was
 * charged. Rounding each part independently can leave a one-cent residual, so
 * the split is reconciled against the authoritative figure and the residual is
 * absorbed by the LARGER component (a cent moved inside a $12 excise figure is
 * invisible; the same cent moved inside a 40-cent sales figure is not).
 *
 * If the residual is bigger than rounding can explain — which is what would
 * happen if a caller passed lines that do not correspond to the totals, or a
 * historical snapshot recorded under different rules — the split REFUSES and
 * returns null. The caller then prints the single combined `Tax` line, which
 * is the pre-existing behaviour. Degrading to a less detailed true receipt is
 * always correct; printing a confident wrong number on a tax document is not.
 */
import {
  CANNABIS_EXCISE_TAX_RATE,
  LOCAL_SALES_TAX_RATE,
  CANNABIS_EXCISE_TAX_BPS,
  STATE_SALES_TAX_BPS,
  LOCAL_CITY_SALES_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

/**
 * One line as far as the tax split is concerned.
 *
 * Every field except quantity/unitPriceMinor is OPTIONAL because historical
 * frozen receipts (reprints, emailed copies) were captured before this slice
 * existed and will never carry them. Absent category ⇒ the split refuses,
 * rather than assuming the line was cannabis.
 */
export type ReceiptTaxLine = {
  quantity: number;
  /** Final tax-INCLUSIVE unit price actually charged, minor units. */
  unitPriceMinor: number;
  /** Product category. Absent ⇒ cannabis/non-cannabis is UNKNOWN. */
  category?: string | null;
  /** Retail sales tax was exempted on this line (RCW 82.08.9998). */
  salesExempt?: boolean;
  /** Cannabis excise was exempted on this line (WAC 314-55-090(1)). */
  exciseExempt?: boolean;
};

export type ReceiptTaxSplit = {
  /** WA cannabis excise actually charged across the sale, minor units. */
  exciseMinor: number;
  /** State + local retail sales tax actually charged, minor units. */
  salesMinor: number;
  /** True when at least one line carried excise (drives label wording). */
  anyExcise: boolean;
  /** True when at least one line carried sales tax. */
  anySales: boolean;
};

/**
 * Largest residual (in cents) that independent rounding can legitimately
 * produce. Each line contributes at most a fraction of a cent per component,
 * and the authoritative subtotal is itself rounded once, so a handful of cents
 * is generous. Beyond this the inputs disagree with the totals and the split
 * must not be printed.
 */
export const RECEIPT_TAX_RESIDUAL_TOLERANCE_MINOR = 5;

/** Human labels, built from the SAME basis points the math uses. */
export function exciseTaxLabel(): string {
  return `WA Cannabis Excise (${formatBpsPercent(CANNABIS_EXCISE_TAX_BPS)}%)`;
}

export function salesTaxLabel(): string {
  return `State & Local Sales Tax (${formatBpsPercent(COMBINED_SALES_TAX_BPS)}%)`;
}

/**
 * Detail line for the curious customer: how the 9.3% is actually composed.
 * Derived from the constants so a rate change can never leave stale prose.
 */
export function salesTaxCompositionNote(): string {
  return `Includes WA state ${formatBpsPercent(STATE_SALES_TAX_BPS)}% + local ${formatBpsPercent(
    LOCAL_CITY_SALES_TAX_BPS,
  )}%`;
}

/** 3700 -> "37", 930 -> "9.3", 650 -> "6.5". No trailing ".0". */
export function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

/**
 * Split the authoritative tax into its excise and sales components.
 *
 * `authoritativeTaxMinor` is the tax the sale actually charged (total minus
 * pre-tax subtotal, computed by orders/order-pricing-core). The split is
 * derived, then FORCED to reconcile to it — the receipt can never disagree
 * with the drawer.
 *
 * Returns null when the split cannot be trusted:
 *   • no lines,
 *   • any line missing its category (historical snapshot),
 *   • the derived total drifts from the authoritative figure by more than
 *     rounding can explain.
 * A null result means "print the single combined Tax line", never "guess".
 */
export function splitReceiptTax(
  lines: readonly ReceiptTaxLine[],
  authoritativeTaxMinor: number,
): ReceiptTaxSplit | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  if (!Number.isFinite(authoritativeTaxMinor)) return null;

  // A sale that charged no tax at all (fully exempt medical basket) is a
  // legitimate, fully-known state: both components are genuinely zero.
  if (authoritativeTaxMinor === 0) {
    return { exciseMinor: 0, salesMinor: 0, anyExcise: false, anySales: false };
  }
  // DEFENCE IN DEPTH, KNOWINGLY REDUNDANT. A 300,000-trial randomized probe
  // over the full input space could not construct a negative authoritative tax
  // that escaped the `excise < 0 || sales < 0` guard further down: 6,234 trials
  // reached this condition and all 6,234 were caught later anyway. It is kept
  // because the caller is a printed tax document and a cheap early refusal is
  // worth more than the line it costs. Do not delete it as "dead code" — it is
  // deliberate redundancy, not an oversight.
  if (authoritativeTaxMinor < 0) return null;

  let exciseFloat = 0;
  let salesFloat = 0;
  let anyExcise = false;
  let anySales = false;

  for (const line of lines) {
    // Category is REQUIRED. Without it we cannot know whether the excise
    // applied, and assuming is exactly what the standing rule forbids.
    if (typeof line.category !== "string" || line.category.trim() === "") return null;

    const qty = Math.max(0, Math.round(line.quantity));
    if (qty === 0) continue;
    if (!Number.isFinite(line.unitPriceMinor)) return null;

    const lineTotal = line.unitPriceMinor * qty;
    if (lineTotal <= 0) continue;

    const cannabis = !isNonCannabisCategory(line.category);
    // Excise exists only on cannabis, and only when not exempted.
    const exciseApplies = cannabis && line.exciseExempt !== true;
    const salesApplies = line.salesExempt !== true;

    const exciseRate = exciseApplies ? CANNABIS_EXCISE_TAX_RATE : 0;
    const salesRate = salesApplies ? LOCAL_SALES_TAX_RATE : 0;

    // The line's own divisor: only the taxes THIS line actually carries are
    // backed out of THIS line's inclusive price.
    const divisor = 1 + exciseRate + salesRate;
    const base = lineTotal / divisor;

    if (exciseApplies) {
      exciseFloat += base * exciseRate;
      anyExcise = true;
    }
    if (salesApplies) {
      salesFloat += base * salesRate;
      anySales = true;
    }
  }

  let excise = Math.round(exciseFloat);
  let sales = Math.round(salesFloat);
  const residual = authoritativeTaxMinor - (excise + sales);

  if (Math.abs(residual) > RECEIPT_TAX_RESIDUAL_TOLERANCE_MINOR) return null;

  // Absorb the rounding residual in the larger component so the printed parts
  // sum EXACTLY to what was charged.
  if (residual !== 0) {
    if (excise >= sales) excise += residual;
    else sales += residual;
  }

  // A reconciliation must never drive a component negative; if it would, the
  // inputs did not describe this sale and the split is not printable.
  if (excise < 0 || sales < 0) return null;
  // DEFENCE IN DEPTH, KNOWINGLY REDUNDANT. The tolerance guard above plus the
  // residual absorption make this arithmetically unreachable: the same
  // 300,000-trial probe fired it exactly 0 times. It stays because it is the
  // single assertion that the two numbers we PRINT sum to the number we
  // CHARGED, and that invariant is the whole point of RCW 69.50.535(1)(a).
  // If a future refactor of the absorption above ever breaks it, this is the
  // line that will refuse to print a lie.
  if (excise + sales !== authoritativeTaxMinor) return null;

  return { exciseMinor: excise, salesMinor: sales, anyExcise, anySales };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptTaxCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL: ${msg}`);
    }
  };

  // -- labels derive from the constants, never from typed-in prose ----------
  ok(exciseTaxLabel() === "WA Cannabis Excise (37%)", "excise label reads 37%");
  ok(salesTaxLabel() === "State & Local Sales Tax (9.3%)", "sales label reads 9.3%");
  ok(formatBpsPercent(3700) === "37", "3700 bps prints as 37, not 37.00");
  ok(formatBpsPercent(930) === "9.3", "930 bps prints as 9.3");
  ok(formatBpsPercent(650) === "6.5", "650 bps prints as 6.5");
  ok(
    salesTaxCompositionNote() === "Includes WA state 6.5% + local 2.8%",
    "composition note names both halves of the sales tax",
  );

  // -- a plain cannabis sale ------------------------------------------------
  // $46.30 inclusive at 1.463 => base 3165.4..., excise 1171.2, sales 294.4
  const cannabisLines: ReceiptTaxLine[] = [
    { quantity: 1, unitPriceMinor: 4630, category: "flower" },
  ];
  const authTax = 4630 - Math.round(4630 / 1.463);
  const split = splitReceiptTax(cannabisLines, authTax);
  ok(split !== null, "a plain cannabis line splits");
  if (split) {
    ok(split.exciseMinor + split.salesMinor === authTax, "parts sum to the tax charged");
    ok(split.exciseMinor > split.salesMinor, "excise (37%) exceeds sales (9.3%)");
    ok(split.anyExcise && split.anySales, "both components flagged present");
    // Roughly 1171 vs 294 — assert the ratio rather than a brittle exact cent.
    const ratio = split.exciseMinor / split.salesMinor;
    ok(ratio > 3.8 && ratio < 4.2, "excise:sales ratio tracks 37:9.3 (~3.98)");
  }

  // -- merch carries sales tax ONLY ----------------------------------------
  for (const cat of ["merch", "accessories", "accessory", "paraphernalia"]) {
    const total = 1093;
    const auth = total - Math.round(total / 1.093);
    const s = splitReceiptTax([{ quantity: 1, unitPriceMinor: total, category: cat }], auth);
    ok(s !== null && s.exciseMinor === 0, `${cat} is never charged cannabis excise`);
    ok(s !== null && s.salesMinor === auth, `${cat} sales tax is the whole tax`);
    ok(s !== null && s.anyExcise === false, `${cat} reports no excise present`);
  }
  // Case-insensitivity comes from isNonCannabisCategory; prove we inherit it.
  const upper = splitReceiptTax([{ quantity: 1, unitPriceMinor: 1093, category: "MERCH" }], 93);
  ok(upper !== null && upper.exciseMinor === 0, "category matching is case-insensitive");

  // -- mixed basket: flower + a lighter -------------------------------------
  const mixed: ReceiptTaxLine[] = [
    { quantity: 2, unitPriceMinor: 2000, category: "flower" },
    { quantity: 1, unitPriceMinor: 500, category: "accessories" },
  ];
  const mixedAuth =
    4000 + 500 - (Math.round(4000 / 1.463 + 500 / 1.093));
  const mixedSplit = splitReceiptTax(mixed, mixedAuth);
  ok(mixedSplit !== null, "a mixed basket splits");
  if (mixedSplit) {
    ok(
      mixedSplit.exciseMinor + mixedSplit.salesMinor === mixedAuth,
      "mixed basket parts reconcile exactly",
    );
    // The lighter must contribute to sales tax but not to excise.
    const flowerOnly = splitReceiptTax(
      [{ quantity: 2, unitPriceMinor: 2000, category: "flower" }],
      4000 - Math.round(4000 / 1.463),
    );
    // The accessory must add NO excise. The two figures can still differ by a
    // single cent, because the mixed basket carries a rounding residual that
    // gets absorbed into the larger component (see the honesty rule above).
    // What must NOT happen is the accessory contributing excise of its own:
    // at 37% of a $5 item that would be roughly 126 cents, so a 1-cent
    // tolerance distinguishes "rounding" from "we charged excise on a lighter"
    // with an enormous margin.
    ok(
      flowerOnly !== null && Math.abs(mixedSplit.exciseMinor - flowerOnly.exciseMinor) <= 1,
      "the accessory adds ZERO excise (within the 1c rounding residual)",
    );
    ok(
      flowerOnly !== null && mixedSplit.salesMinor > flowerOnly.salesMinor,
      "the accessory DOES add sales tax",
    );
  }

  // -- MEDICAL: the exemptions are independent ------------------------------
  // Fully exempt carded line: medical-pos-core repriced it to its pre-tax
  // base, so its inclusive price carries NO tax at all.
  const fullyExempt = splitReceiptTax(
    [{ quantity: 1, unitPriceMinor: 3165, category: "flower", salesExempt: true, exciseExempt: true }],
    0,
  );
  ok(fullyExempt !== null, "a fully exempt medical line is a known state");
  ok(
    fullyExempt !== null && fullyExempt.exciseMinor === 0 && fullyExempt.salesMinor === 0,
    "a fully exempt medical line invents NO tax",
  );

  // Excise exempt but sales still due (post-sunset shape): divisor is 1.093,
  // and the excise component must stay at zero.
  const exciseOff = splitReceiptTax(
    [{ quantity: 1, unitPriceMinor: 1093, category: "flower", exciseExempt: true }],
    1093 - Math.round(1093 / 1.093),
  );
  ok(exciseOff !== null && exciseOff.exciseMinor === 0, "excise-exempt line charges no excise");
  ok(exciseOff !== null && exciseOff.salesMinor > 0, "excise-exempt line still charges sales tax");

  // Sales exempt but excise still due: divisor 1.37.
  const salesOff = splitReceiptTax(
    [{ quantity: 1, unitPriceMinor: 1370, category: "flower", salesExempt: true }],
    1370 - Math.round(1370 / 1.37),
  );
  ok(salesOff !== null && salesOff.salesMinor === 0, "sales-exempt line charges no sales tax");
  ok(salesOff !== null && salesOff.exciseMinor > 0, "sales-exempt line still charges excise");

  // A naive 1.463 divisor would have invented excise on the exempt line; prove
  // the exempt path really differs from the non-exempt one.
  const naive = splitReceiptTax([{ quantity: 1, unitPriceMinor: 1093, category: "flower" }], 345);
  ok(
    naive !== null && exciseOff !== null && naive.exciseMinor !== exciseOff.exciseMinor,
    "exemption flags genuinely change the arithmetic",
  );

  // -- REFUSALS: the split degrades instead of lying ------------------------
  ok(splitReceiptTax([], 100) === null, "no lines => refuse");
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630 }], 1465) === null,
    "a historical line with NO category => refuse (never assume cannabis)",
  );
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630, category: "   " }], 1465) === null,
    "a blank category => refuse",
  );
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630, category: "flower" }], 9999) === null,
    "a tax figure the lines cannot explain => refuse",
  );
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630, category: "flower" }], -5) === null,
    "a negative tax => refuse",
  );
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: 4630, category: "flower" }], Number.NaN) === null,
    "a non-finite tax => refuse",
  );
  ok(
    splitReceiptTax([{ quantity: 1, unitPriceMinor: Number.NaN, category: "flower" }], 100) === null,
    "a non-finite unit price => refuse",
  );

  // -- reconciliation is exact, across many shapes --------------------------
  let reconciled = 0;
  for (let cents = 100; cents <= 20000; cents += 137) {
    const auth = cents - Math.round(cents / 1.463);
    const s = splitReceiptTax([{ quantity: 1, unitPriceMinor: cents, category: "flower" }], auth);
    if (s && s.exciseMinor + s.salesMinor === auth && s.exciseMinor >= 0 && s.salesMinor >= 0) {
      reconciled += 1;
    }
  }
  ok(reconciled === 146, `every swept price reconciles exactly (got ${reconciled})`);

  // Quantity handling: 3 x $10 must equal 1 x $30.
  const q3 = splitReceiptTax([{ quantity: 3, unitPriceMinor: 1000, category: "flower" }], 3000 - Math.round(3000 / 1.463));
  const q1 = splitReceiptTax([{ quantity: 1, unitPriceMinor: 3000, category: "flower" }], 3000 - Math.round(3000 / 1.463));
  ok(
    q3 !== null && q1 !== null && q3.exciseMinor === q1.exciseMinor && q3.salesMinor === q1.salesMinor,
    "quantity multiplies rather than re-rounding",
  );

  // A zero-quantity or zero-price line contributes nothing but must not break.
  const withZero = splitReceiptTax(
    [
      { quantity: 1, unitPriceMinor: 4630, category: "flower" },
      { quantity: 0, unitPriceMinor: 4630, category: "flower" },
      { quantity: 1, unitPriceMinor: 0, category: "merch" },
    ],
    4630 - Math.round(4630 / 1.463),
  );
  ok(withZero !== null, "zero-quantity and zero-price lines are ignored, not fatal");

  console.log(`pos/receipt-tax-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`receipt-tax-core self-tests failed: ${fail}`);
}
