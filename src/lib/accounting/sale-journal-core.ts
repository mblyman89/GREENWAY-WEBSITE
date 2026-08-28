/**
 * src/lib/accounting/sale-journal-core.ts — the retail sale, as a journal entry.
 *
 * PURE. No I/O, no React, no server-only. Mirrored in vitest and registered in
 * scripts/compliance/run-pure-selftests.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * D-31, measured in the ledger census: `revenue_and_tax_collected.retail_sale`
 * had a null builder, a null poster, and MISSING on every layer. In the census's
 * own words, "This is the single largest number in the business and the books
 * currently contain none of it." `grep -rn 'sourceKind: "pos_sale"' src/` found
 * zero hits; 97 files under src/lib/pos/ and src/app/api/pos/ and not one of
 * them submits a journal. The POS knew what the customer paid. The general
 * ledger never heard about it.
 *
 * D-33 is the other half: COGS on sale. Under IRC 280E, cost of goods sold is
 * the ONLY deduction a cannabis retailer gets. A sale that credits revenue and
 * never relieves inventory overstates taxable income by the entire cost of the
 * product, which is the most expensive arithmetic mistake available here. So the
 * two entries are built TOGETHER by one function, and there is no way to ask for
 * the revenue half alone.
 *
 * THE ONE IDEA THAT MAKES THIS HARD
 * ---------------------------------
 * The price on Michael's shelf is TAX-INCLUSIVE. The sticker says $10.00 and the
 * customer hands over $10.00. Both taxes are already inside that number. So the
 * taxes are EXTRACTED, never added. Adding 37% to $10.00 would invent $3.70 of
 * excise the customer never paid and would inflate revenue by the same amount.
 *
 *   selling price (revenue)   base
 *   + 37% cannabis excise     RCW 69.50.535
 *   + 9.3% retail sales tax   6.5% state + 2.8% Port Orchard
 *   = shelf price             base x 1.463
 *
 * The 9.3% is computed on a base that EXCLUDES the 37% excise. That is not a
 * simplification — account 32100 in the chart of accounts says so in its own
 * description ("the 37% excise is excluded from the selling price this is
 * computed on"), and account 50000 says revenue "is recognised NET of the 37%
 * excise". Both taxes therefore sit on the same base, which is why one divisor
 * of 1.463 does the whole job.
 *
 * WHOSE MONEY IS IT
 * -----------------
 * Accounts 32000 and 32100 are TRUST liabilities. RCW 69.50.535(4) says the
 * excise is "deemed to be held in trust". That money belongs to the State from
 * the moment the customer pays it. It is not revenue, it is not Michael's, and
 * it does not belong on an income statement. This module can never credit a 5xxx
 * account with a cent of it, and the shape of the return value is what enforces
 * that rather than a comment asking nicely.
 *
 * WHERE THE ROUNDING GOES, AND WHY
 * --------------------------------
 * Extracting three numbers from one integer leaves a sub-cent residual, and it
 * has to land somewhere. It lands on REVENUE, deliberately:
 *
 *   excise    = round(paid x 3700 / 14630)   its own statutory rate, exact
 *   salesTax  = round(paid x  930 / 14630)   its own statutory rate, exact
 *   revenue   = paid - excise - salesTax     whatever is left
 *
 * The trust money is computed at its own rate and the owner's revenue absorbs
 * the fraction of a cent. That direction is not arbitrary: if the residual were
 * pushed into a tax account, Michael would be remitting a number he did not
 * compute from the statute, and a rounding convenience would be dressed up as a
 * tax liability. Taking it out of his own revenue instead cannot harm the State
 * and cannot overstate what he owes. This is a stated choice, not an accident,
 * and `roundingResidualCents` reports it on every entry so it is never silent.
 */

import {
  INVENTORY_CATEGORIES,
  cogsAccountCode,
  inventoryAccountCode,
  revenueAccountCode,
} from "./coa-core";
import { LINE_IN_THE_SAND } from "./ledger-core";
import type { JournalDraft, JournalLineDraft } from "./ledger-core";

/* ══════════════════════════════════════════════════════════════════════════
 * 1) THE STATUTORY RATES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Basis points. These are RESTATED here rather than imported from
 * src/lib/orders/order-pricing-core.ts on purpose, and the purpose is not
 * laziness — it is that order-pricing-core is the CART's module and this is the
 * LEDGER's module, and a silent divergence between what the customer was charged
 * and what the books record is exactly the class of bug that produced twelve
 * years of mis-computed excise in the old Sage file.
 *
 * Restating them without a check would just be the same drift with extra steps,
 * so `SALE_TAX_RATES_MATCH_POS` in the test file imports both and asserts they
 * are equal. Two independent statements of the same statute that are proven
 * equal by machine are safer than one shared constant nobody ever re-derives.
 */
export const EXCISE_BPS = 3700;
/** 6.5% state + 2.8% Port Orchard local. */
export const SALES_TAX_BPS = 930;

/** Denominator for a cannabis shelf price: 10000 + 3700 + 930. */
export const CANNABIS_INCLUSIVE_BPS = 10000 + EXCISE_BPS + SALES_TAX_BPS; // 14630
/** Denominator for accessories/merch: no excise applies. */
export const NON_CANNABIS_INCLUSIVE_BPS = 10000 + SALES_TAX_BPS; // 10930

/** Cash on Hand — Tills. Where the money actually lands. */
export const TILL_ACCOUNT = "10110";
/** Cannabis Excise Tax Payable (37%) — TRUST. */
export const EXCISE_PAYABLE_ACCOUNT = "32000";
/** Retail Sales Tax Payable — TRUST. */
export const SALES_TAX_PAYABLE_ACCOUNT = "32100";

/* ══════════════════════════════════════════════════════════════════════════
 * 2) INPUT
 * ══════════════════════════════════════════════════════════════════════════ */

export type SaleLineInput = {
  /** A slug from INVENTORY_CATEGORIES. Anything else is refused, never guessed. */
  readonly categorySlug: string;
  /** Integer units sold. Must be positive. */
  readonly quantity: number;
  /**
   * The TAX-INCLUSIVE price the customer actually paid for this line, in whole
   * cents, AFTER any discount. Not the sticker price if a discount was applied —
   * the amount that hit the drawer.
   */
  readonly paidCents: number;
  /**
   * What this product cost Greenway, in whole cents, for the whole line.
   * `null` means the lot cost is not known yet, which is a REFUSAL and not a
   * zero: booking a sale with no cost is how 280E income gets overstated.
   */
  readonly unitCostCentsTotal: number | null;
};

export type SaleJournalInput = {
  /** ISO YYYY-MM-DD, Pacific business date. */
  readonly saleDate: string;
  /** POS order id. Becomes the sourceRef, which is what makes this idempotent. */
  readonly orderRef: string;
  readonly lines: readonly SaleLineInput[];
  /**
   * What the POS says the order totalled, if the caller has it. When supplied it
   * is CHECKED, not trusted; a disagreement is a refusal. Null skips the check.
   */
  readonly posTotalCents: number | null;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3) REFUSALS
 * ══════════════════════════════════════════════════════════════════════════ */

export const SALE_JOURNAL_REFUSAL_CODES = [
  "NO_LINES",
  "UNKNOWN_CATEGORY",
  "NON_POSITIVE_QUANTITY",
  "NON_POSITIVE_PRICE",
  "FRACTIONAL_CENTS",
  "UNIT_COST_UNKNOWN",
  "NEGATIVE_UNIT_COST",
  "DATE_BEFORE_CUTOVER",
  "POS_TOTAL_DISAGREES",
] as const;

export type SaleJournalRefusalCode = (typeof SALE_JOURNAL_REFUSAL_CODES)[number];

export type SaleJournalRefusal = {
  readonly kind: "refused";
  readonly code: SaleJournalRefusalCode;
  /** Plain English, aimed at Michael, not at a developer. */
  readonly explanation: string;
  /** What to actually do about it. */
  readonly resolution: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 4) OUTPUT
 * ══════════════════════════════════════════════════════════════════════════ */

/** The extraction, per category, kept so the arithmetic can be shown on screen. */
export type CategorySplit = {
  readonly categorySlug: string;
  readonly isCannabis: boolean;
  readonly paidCents: number;
  readonly revenueCents: number;
  readonly exciseCents: number;
  readonly salesTaxCents: number;
  readonly costCents: number;
  readonly revenueAccount: string;
  readonly cogsAccount: string;
  readonly inventoryAccount: string;
};

export type SaleJournalResult = {
  readonly kind: "built";
  /** Debit till, credit revenue + both trust liabilities. */
  readonly revenueJournal: JournalDraft;
  /** Debit COGS, credit inventory. The 280E half. */
  readonly cogsJournal: JournalDraft;
  readonly splits: readonly CategorySplit[];
  readonly totalPaidCents: number;
  readonly totalRevenueCents: number;
  readonly totalExciseCents: number;
  readonly totalSalesTaxCents: number;
  readonly totalCostCents: number;
  /**
   * Revenue minus what the exact unrounded extraction would have been, summed.
   * Reported so the rounding choice documented in the header is visible on every
   * entry rather than buried in this file.
   */
  readonly roundingResidualCents: number;
};

export type SaleJournalOutcome = SaleJournalResult | SaleJournalRefusal;

/* ══════════════════════════════════════════════════════════════════════════
 * 5) THE EXTRACTION
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Half-up rounding on a non-negative rational, in integers only.
 *
 * No floats anywhere in the money path. `Math.round` on `a / b` would route the
 * value through a float and inherit its representation error, which is how a
 * cent goes missing on one order in ten thousand and is never traced.
 */
function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/**
 * Pull the two taxes out of one tax-inclusive amount.
 *
 * Exported because the sale screen has to be able to show Michael this
 * arithmetic on a single line without rebuilding a whole journal. He is a visual
 * learner and "where did the $10 go" is the question this answers.
 */
export function extractTaxes(
  paidCents: number,
  isCannabis: boolean,
): { revenueCents: number; exciseCents: number; salesTaxCents: number } {
  const denominator = isCannabis ? CANNABIS_INCLUSIVE_BPS : NON_CANNABIS_INCLUSIVE_BPS;
  const exciseCents = isCannabis ? divRoundHalfUp(paidCents * EXCISE_BPS, denominator) : 0;
  const salesTaxCents = divRoundHalfUp(paidCents * SALES_TAX_BPS, denominator);
  // Revenue is the residual claimant. See the header: the trust accounts get
  // their statutory rate and the owner eats the fraction of a cent.
  return { revenueCents: paidCents - exciseCents - salesTaxCents, exciseCents, salesTaxCents };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) THE BUILDER
 * ══════════════════════════════════════════════════════════════════════════ */

const refuse = (
  code: SaleJournalRefusalCode,
  explanation: string,
  resolution: string,
): SaleJournalRefusal => ({ kind: "refused", code, explanation, resolution });

/**
 * Turn a POS order into the two journal entries it implies.
 *
 * Returns a REFUSAL rather than throwing, and rather than producing a plausible
 * entry from incomplete facts. Standing rule 1: never guess. A sale whose cost
 * is unknown is not a sale this module will book.
 */
export function buildSaleJournal(input: SaleJournalInput): SaleJournalOutcome {
  if (input.lines.length === 0) {
    return refuse(
      "NO_LINES",
      "This order has no lines, so there is nothing to record.",
      "Check that the POS order actually contains items before sending it to the ledger.",
    );
  }

  if (input.saleDate < LINE_IN_THE_SAND) {
    return refuse(
      "DATE_BEFORE_CUTOVER",
      `This sale is dated ${input.saleDate}, which is before the new books open on ` +
        `${LINE_IN_THE_SAND}. Only the single opening-balance entry may be dated earlier.`,
      "If this is a genuine historical sale it belongs to the old Sage file, not here. " +
        "If the date is wrong, correct it in the POS and re-send.",
    );
  }

  // Aggregate by category FIRST, then extract tax once per category. Extracting
  // per line and summing would round once per line and drift against the POS
  // total by a cent per line on a big basket.
  const byCategory = new Map<string, { paid: number; cost: number; qty: number }>();

  for (const line of input.lines) {
    const seed = INVENTORY_CATEGORIES.find((c) => c.slug === line.categorySlug);
    if (seed === undefined) {
      return refuse(
        "UNKNOWN_CATEGORY",
        `"${line.categorySlug}" is not one of the ${INVENTORY_CATEGORIES.length} product ` +
          "categories in the chart of accounts, so there is no revenue, COGS or inventory " +
          "account to post it to.",
        "Add the category to the chart of accounts first, or correct the category on the " +
          "product. Guessing an account here is how the old books ended up with one " +
          "catch-all inventory line holding everything.",
      );
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return refuse(
        "NON_POSITIVE_QUANTITY",
        `A ${line.categorySlug} line has a quantity of ${line.quantity}.`,
        "A sale line must move at least one whole unit. Returns are a separate entry, " +
          "not a negative sale line.",
      );
    }
    if (!Number.isInteger(line.paidCents)) {
      return refuse(
        "FRACTIONAL_CENTS",
        `A ${line.categorySlug} line is priced at ${line.paidCents} cents, which is not a ` +
          "whole number of cents.",
        "Money is stored as whole cents everywhere in this system. Round in the POS, once, " +
          "before the amount reaches the ledger.",
      );
    }
    if (line.paidCents <= 0) {
      return refuse(
        "NON_POSITIVE_PRICE",
        `A ${line.categorySlug} line was sold for ${line.paidCents} cents.`,
        "RCW 69.50.357 forbids giving cannabis away, so a zero-price cannabis line cannot " +
          "be recorded as a sale. A comp or a sample is a different entry with a different " +
          "tax answer.",
      );
    }
    if (line.unitCostCentsTotal === null) {
      return refuse(
        "UNIT_COST_UNKNOWN",
        `The lot cost for the ${line.categorySlug} line is not known, so the cost of goods ` +
          "sold on this order cannot be computed.",
        "Under IRC 280E, cost of goods sold is the only deduction this business gets. " +
          "Booking the sale without it would overstate taxable income by the entire cost of " +
          "the product, so the entry is refused until the receiving cost is entered.",
      );
    }
    if (!Number.isInteger(line.unitCostCentsTotal) || line.unitCostCentsTotal < 0) {
      return refuse(
        "NEGATIVE_UNIT_COST",
        `The ${line.categorySlug} line carries a cost of ${line.unitCostCentsTotal} cents.`,
        "A cost must be a whole number of cents and cannot be negative. A negative cost " +
          "would credit COGS and inflate the only deduction 280E allows.",
      );
    }

    const prior = byCategory.get(line.categorySlug) ?? { paid: 0, cost: 0, qty: 0 };
    byCategory.set(line.categorySlug, {
      paid: prior.paid + line.paidCents,
      cost: prior.cost + line.unitCostCentsTotal,
      qty: prior.qty + line.quantity,
    });
  }

  let totalPaid = 0;
  for (const agg of byCategory.values()) totalPaid += agg.paid;

  if (input.posTotalCents !== null && input.posTotalCents !== totalPaid) {
    return refuse(
      "POS_TOTAL_DISAGREES",
      `The lines add up to ${totalPaid} cents but the POS says the order totalled ` +
        `${input.posTotalCents} cents.`,
      "The ledger will not record a total it cannot reproduce from the lines. Find the " +
        "missing or extra line before posting — a difference here means the drawer and the " +
        "books would disagree from day one.",
    );
  }

  // Deterministic order: by category slot, so the same basket always produces
  // byte-identical lines and a re-post can be compared against the original.
  const slugsInSlotOrder = INVENTORY_CATEGORIES.filter((c) => byCategory.has(c.slug));

  const splits: CategorySplit[] = [];
  let totalRevenue = 0;
  let totalExcise = 0;
  let totalSalesTax = 0;
  let totalCost = 0;
  let residual = 0;

  for (const seed of slugsInSlotOrder) {
    const agg = byCategory.get(seed.slug);
    if (agg === undefined) continue; // unreachable: filtered above, but no `!`.
    const t = extractTaxes(agg.paid, seed.isCannabis);

    // What revenue would have been at its own rate, for the residual report.
    const denominator = seed.isCannabis ? CANNABIS_INCLUSIVE_BPS : NON_CANNABIS_INCLUSIVE_BPS;
    residual += t.revenueCents - divRoundHalfUp(agg.paid * 10000, denominator);

    splits.push({
      categorySlug: seed.slug,
      isCannabis: seed.isCannabis,
      paidCents: agg.paid,
      revenueCents: t.revenueCents,
      exciseCents: t.exciseCents,
      salesTaxCents: t.salesTaxCents,
      costCents: agg.cost,
      revenueAccount: revenueAccountCode(seed.slot),
      cogsAccount: cogsAccountCode(seed.slot),
      inventoryAccount: inventoryAccountCode(seed.slot),
    });

    totalRevenue += t.revenueCents;
    totalExcise += t.exciseCents;
    totalSalesTax += t.salesTaxCents;
    totalCost += agg.cost;
  }

  /* ---- Entry 1: the money ------------------------------------------------ */
  const revenueLines: JournalLineDraft[] = [];
  let lineNo = 1;

  revenueLines.push({
    lineNo: lineNo++,
    accountCode: TILL_ACCOUNT,
    entityCode: "greenway",
    amountCents: totalPaid, // positive = debit
    costClass: "none",
    description: "Cash to till, tax-inclusive, as paid",
  });

  for (const s of splits) {
    revenueLines.push({
      lineNo: lineNo++,
      accountCode: s.revenueAccount,
      entityCode: "greenway",
      amountCents: -s.revenueCents, // negative = credit
      // Income accounts carry no 280E character; the chart and 0172 agree.
      costClass: "none",
      description: `Sales — ${s.categorySlug}, net of excise`,
    });
  }

  if (totalExcise > 0) {
    revenueLines.push({
      lineNo: lineNo++,
      accountCode: EXCISE_PAYABLE_ACCOUNT,
      entityCode: "greenway",
      amountCents: -totalExcise,
      costClass: "none", // liability: GL_COST_CLASS_NOT_ALLOWED otherwise
      description: "37% cannabis excise collected — held in trust, RCW 69.50.535(4)",
    });
  }

  revenueLines.push({
    lineNo: lineNo++,
    accountCode: SALES_TAX_PAYABLE_ACCOUNT,
    entityCode: "greenway",
    amountCents: -totalSalesTax,
    costClass: "none",
    description: "9.3% retail sales tax collected — held in trust",
  });

  const revenueJournal: JournalDraft = {
    entityCode: "greenway",
    journalDate: input.saleDate,
    sourceKind: "pos_sale",
    sourceRef: input.orderRef,
    memo: `Retail sale ${input.orderRef}`,
    assumptionNote:
      "Shelf prices are tax-inclusive, so both taxes are EXTRACTED from what the customer " +
      "paid, never added to it. The 9.3% sales tax is computed on a base that excludes the " +
      "37% excise. Sub-cent rounding is absorbed by revenue, never by a trust liability.",
    lines: revenueLines,
  };

  /* ---- Entry 2: the goods (280E) ---------------------------------------- */
  const cogsLines: JournalLineDraft[] = [];
  lineNo = 1;
  for (const s of splits) {
    if (s.costCents === 0) continue; // a zero line is illegal in 0172
    cogsLines.push({
      lineNo: lineNo++,
      accountCode: s.cogsAccount,
      entityCode: "greenway",
      amountCents: s.costCents, // debit
      // 60xxx carries requires_cost_class in 0173; 'none' would raise
      // GL_COST_CLASS_REQUIRED. The chart seeds every 6xxxx category account —
      // including accessories and merch — as cogs_direct.
      costClass: "cogs_direct",
      description: `COGS — ${s.categorySlug}`,
    });
  }
  for (const s of splits) {
    if (s.costCents === 0) continue;
    cogsLines.push({
      lineNo: lineNo++,
      accountCode: s.inventoryAccount,
      entityCode: "greenway",
      amountCents: -s.costCents, // credit
      costClass: "none",
      description: `Inventory relieved — ${s.categorySlug}`,
    });
  }

  const cogsJournal: JournalDraft = {
    entityCode: "greenway",
    journalDate: input.saleDate,
    sourceKind: "pos_sale",
    // A DIFFERENT sourceRef, so the two entries cannot collide on the
    // idempotency key while still being traceable to the same order.
    sourceRef: `${input.orderRef}#cogs`,
    memo: `Cost of goods sold ${input.orderRef}`,
    assumptionNote:
      "Under IRC 280E, cost of goods sold is the only deduction this business gets. " +
      "Inventory is relieved at recorded lot cost on the same date as the sale.",
    lines: cogsLines,
  };

  return {
    kind: "built",
    revenueJournal,
    cogsJournal,
    splits,
    totalPaidCents: totalPaid,
    totalRevenueCents: totalRevenue,
    totalExciseCents: totalExcise,
    totalSalesTaxCents: totalSalesTax,
    totalCostCents: totalCost,
    roundingResidualCents: residual,
  };
}

/**
 * Gross margin in milli-percent, or null when nothing was sold.
 *
 * Deliberately computed on revenue NET of excise, because that is the number
 * that reaches the income statement. Computing margin on the tax-inclusive shelf
 * price would flatter every product by roughly a third.
 */
export function grossMarginMilliPct(result: SaleJournalResult): number | null {
  if (result.totalRevenueCents <= 0) return null;
  return divRoundHalfUp(
    (result.totalRevenueCents - result.totalCostCents) * 100000,
    result.totalRevenueCents,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7) SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("sale-journal-core: " + msg);
}

const sumOf = (j: JournalDraft): number =>
  j.lines.reduce((acc, l) => acc + l.amountCents, 0);

export function __runSaleJournalCoreTests(): void {
  const base: SaleJournalInput = {
    saleDate: "2026-03-14",
    orderRef: "POS-1",
    posTotalCents: null,
    lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: 400 }],
  };

  // --- The $10 bag of flower, worked by hand. -----------------------------
  //   excise   = round(1000 x 3700 / 14630) = round(252.90) = 253
  //   salesTax = round(1000 x  930 / 14630) = round( 63.57) =  64
  //   revenue  = 1000 - 253 - 64            =                 683
  const r = buildSaleJournal(base);
  assert(r.kind === "built", "a plain flower sale must build");
  if (r.kind === "built") {
    assert(r.totalExciseCents === 253, "excise on $10 flower is 253c, got " + r.totalExciseCents);
    assert(r.totalSalesTaxCents === 64, "sales tax is 64c, got " + r.totalSalesTaxCents);
    assert(r.totalRevenueCents === 683, "revenue is 683c, got " + r.totalRevenueCents);
    // The whole point: the three parts equal what the customer handed over.
    assert(
      r.totalRevenueCents + r.totalExciseCents + r.totalSalesTaxCents === 1000,
      "the extraction must reconstitute the price exactly",
    );
    assert(sumOf(r.revenueJournal) === 0, "the revenue entry must balance to zero");
    assert(sumOf(r.cogsJournal) === 0, "the COGS entry must balance to zero");
    assert(r.revenueJournal.sourceKind === "pos_sale", "source kind is pos_sale");
    assert(r.splits[0].revenueAccount === "50010", "flower revenue is 50010");
    assert(r.splits[0].cogsAccount === "60010", "flower COGS is 60010");
    assert(r.splits[0].inventoryAccount === "20010", "flower inventory is 20010");
  }

  // --- Accessories carry sales tax but NEVER excise. ----------------------
  const acc = buildSaleJournal({
    ...base,
    orderRef: "POS-2",
    lines: [{ categorySlug: "accessories", quantity: 1, paidCents: 1000, unitCostCentsTotal: 500 }],
  });
  assert(acc.kind === "built", "an accessory sale must build");
  if (acc.kind === "built") {
    assert(acc.totalExciseCents === 0, "no excise on accessories, got " + acc.totalExciseCents);
    // round(1000 x 930 / 10930) = round(85.09) = 85
    assert(acc.totalSalesTaxCents === 85, "accessory sales tax is 85c, got " + acc.totalSalesTaxCents);
    assert(acc.totalRevenueCents === 915, "accessory revenue is 915c");
    assert(
      acc.revenueJournal.lines.every((l) => l.accountCode !== EXCISE_PAYABLE_ACCOUNT),
      "a non-cannabis sale must not touch the excise trust account at all",
    );
    assert(sumOf(acc.revenueJournal) === 0, "accessory entry balances");
  }

  // --- A trust liability is never credited to revenue. --------------------
  if (r.kind === "built") {
    for (const l of r.revenueJournal.lines) {
      const isFive = l.accountCode.startsWith("5");
      assert(
        !(isFive && l.amountCents < -r.totalRevenueCents),
        "no 5xxxx line may exceed total net revenue — tax would be hiding in it",
      );
      // Balance-sheet lines must not carry 280E character (GL_COST_CLASS_NOT_ALLOWED).
      const isBalanceSheet = l.accountCode.startsWith("1") || l.accountCode.startsWith("3");
      assert(
        !isBalanceSheet || l.costClass === "none",
        "balance-sheet line " + l.accountCode + " must not carry a cost class",
      );
    }
    // Every 6xxxx line MUST carry one (GL_COST_CLASS_REQUIRED).
    for (const l of r.cogsJournal.lines) {
      if (l.accountCode.startsWith("6")) {
        assert(l.costClass === "cogs_direct", "COGS line must be cogs_direct");
      }
      if (l.accountCode.startsWith("2")) {
        assert(l.costClass === "none", "inventory line must carry no cost class");
      }
    }
  }

  // --- Aggregation: two flower lines round ONCE, not twice. ---------------
  const twoLines = buildSaleJournal({
    ...base,
    orderRef: "POS-3",
    lines: [
      { categorySlug: "flower", quantity: 1, paidCents: 500, unitCostCentsTotal: 200 },
      { categorySlug: "flower", quantity: 1, paidCents: 500, unitCostCentsTotal: 200 },
    ],
  });
  assert(twoLines.kind === "built", "two-line order must build");
  if (twoLines.kind === "built" && r.kind === "built") {
    assert(twoLines.splits.length === 1, "same category collapses to one split");
    assert(
      twoLines.totalExciseCents === r.totalExciseCents,
      "2x500 must give the same excise as 1x1000, got " + twoLines.totalExciseCents,
    );
  }

  // --- Every refusal is reachable, or rule 43 makes it decoration. --------
  const seen = new Set<string>();
  const push = (o: SaleJournalOutcome): void => {
    if (o.kind === "refused") seen.add(o.code);
  };
  push(buildSaleJournal({ ...base, lines: [] }));
  push(buildSaleJournal({ ...base, saleDate: "2025-12-31" }));
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "unicorn", quantity: 1, paidCents: 100, unitCostCentsTotal: 1 }],
    }),
  );
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantity: 0, paidCents: 100, unitCostCentsTotal: 1 }],
    }),
  );
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantity: 1, paidCents: 0, unitCostCentsTotal: 1 }],
    }),
  );
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantity: 1, paidCents: 10.5, unitCostCentsTotal: 1 }],
    }),
  );
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantity: 1, paidCents: 100, unitCostCentsTotal: null }],
    }),
  );
  push(
    buildSaleJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantity: 1, paidCents: 100, unitCostCentsTotal: -5 }],
    }),
  );
  push(buildSaleJournal({ ...base, posTotalCents: 999 }));
  for (const code of SALE_JOURNAL_REFUSAL_CODES) {
    assert(seen.has(code), "refusal code never emitted, so it is decoration: " + code);
  }

  // --- The POS total check passes when it agrees. -------------------------
  assert(
    buildSaleJournal({ ...base, posTotalCents: 1000 }).kind === "built",
    "an agreeing POS total must not refuse",
  );

  // --- Margin is computed on NET revenue, not the shelf price. ------------
  if (r.kind === "built") {
    // (683 - 400) / 683 = 0.4143484... -> x100000 = 41434.84 -> half-up 41435.
    // Written as 41434 first from a sloppy mental round-down; an independent
    // integer recomputation disagreed and the CODE was right. Left recorded
    // because the near-miss is the argument for never eyeballing a rounding.
    assert(
      grossMarginMilliPct(r) === 41435,
      "margin on net revenue is 41435 milli-pct, got " + grossMarginMilliPct(r),
    );
  }

  // --- Balance holds across every category, not one happy example. --------
  for (const c of INVENTORY_CATEGORIES) {
    for (const paid of [1, 3, 7, 99, 1234, 999_99]) {
      const one = buildSaleJournal({
        ...base,
        orderRef: `POS-sweep-${c.slug}-${paid}`,
        lines: [{ categorySlug: c.slug, quantity: 1, paidCents: paid, unitCostCentsTotal: 1 }],
      });
      assert(one.kind === "built", `sweep must build for ${c.slug} at ${paid}`);
      if (one.kind === "built") {
        assert(sumOf(one.revenueJournal) === 0, `revenue entry must balance for ${c.slug}/${paid}`);
        assert(sumOf(one.cogsJournal) === 0, `COGS entry must balance for ${c.slug}/${paid}`);
        assert(
          one.totalRevenueCents + one.totalExciseCents + one.totalSalesTaxCents === paid,
          `extraction must reconstitute ${paid} for ${c.slug}`,
        );
        assert(one.totalRevenueCents > 0, `revenue must stay positive for ${c.slug}/${paid}`);
        assert(
          (one.totalExciseCents > 0) === c.isCannabis || paid < 3,
          `excise presence must follow isCannabis for ${c.slug}`,
        );
      }
    }
  }
}
