/**
 * src/lib/accounting/card-payment-core.ts
 *
 * books-99 - THE SHOP CARD. Paying the card bill is a TRANSFER, never an
 * expense.
 *
 * Michael: "I will go with the low limit credit card ... I don't want to use
 * the master till any more for petty cash."
 *
 * ── WHY THIS MODULE EXISTS (D-78) ────────────────────────────────────────────
 *
 * A card purchase already books correctly, and has since books-49:
 * `bank-expense-core.ts` maps the owner-set role `credit` to 33000 Credit Cards
 * Payable, so buying $15 of supplies on the shop card posts
 *
 *     DEBIT  <expense>   $15
 *     CREDIT 33000       $15      (a liability going UP)
 *
 * That is right, and nothing here changes it. THE BUG IS THE OTHER HALF. When
 * the card bill is paid from checking, Plaid reports an ordinary OUTFLOW on the
 * account whose role is `main`. Nothing in the pipeline could tell that row
 * apart from a real expense, so `planBankExpense` classified it on its merchant
 * text and booked a SECOND expense against 10200.
 *
 * The consequence is not a rounding error. Every single card purchase would be
 * expensed TWICE - once at the swipe, once again when the statement was paid -
 * and 33000 would grow forever because nothing ever debited it back down. On a
 * 280E return, where the deductible side is already scrutinised, an expense
 * total inflated by a duplicated card bill is exactly the kind of finding that
 * turns an examination into an adjustment.
 *
 * The correct entry for paying the bill touches no expense account at all:
 *
 *     DEBIT  33000       (the liability goes DOWN - we owe less)
 *     CREDIT 10200       (cash goes DOWN - we paid it)
 *
 * Both sides are balance-sheet. The expense was already recorded weeks earlier,
 * when the card was swiped. THAT is the whole idea of a card: the expense and
 * the cash movement happen at different times, and the liability is what
 * carries the gap.
 *
 * ── HOW A CARD PAYMENT IS RECOGNISED (and why not by merchant text) ──────────
 *
 * Plaid's own `personal_finance_category` taxonomy has a detailed value for
 * exactly this event. From Plaid's published taxonomy CSV, verbatim:
 *
 *   "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT,Payments to a credit card. These are
 *    positive amounts for credit card subtypes and negative for depository
 *    subtypes"
 *
 * Recognising the row by CATEGORY rather than by merchant string is deliberate.
 * Matching on text like "CHASE CARD PMT" would be a guess that breaks the first
 * time the bank changes its descriptor, and would also catch a genuine purchase
 * made AT a bank. The category is the issuer's own structured statement of what
 * the row is.
 *
 * ── THE DOUBLE-SIDED SUBTLETY THAT MAKES THIS DANGEROUS (rule 19) ────────────
 *
 * Read that Plaid sentence again: the SAME payment appears on BOTH feeds, with
 * OPPOSITE signs.
 *
 *   * On the CHECKING feed (a depository account) it is money leaving:
 *     Plaid POSITIVE, role `main`.
 *   * On the CARD feed (a credit account) it is the balance being paid down:
 *     Plaid NEGATIVE, role `credit`.
 *
 * If both rows were booked, the payment would be recorded twice - the very
 * double-count this module exists to stop, reappearing from the other end. So
 * exactly ONE side is the bookable side, and this module picks the CHECKING
 * side, because that is the side that carries the real cash movement and the
 * side whose date the bank statement reconciles to.
 *
 * The card-side row is therefore recognised and DELIBERATELY DECLINED, with a
 * reason. Rule 136: an event with no economic consequence of its own must say
 * so out loud rather than fall through a gap in an if-chain and look like an
 * oversight.
 *
 * ── DELIBERATE LIMIT (rule 133f) ─────────────────────────────────────────────
 *
 * INTEREST AND CARD FEES ARE NOT HANDLED HERE, ON PURPOSE. A finance charge is
 * a genuine expense (76040-family), not a transfer, and Plaid gives it its own
 * category - BANK_FEES_INTEREST_CHARGE. It arrives on the CARD feed as a
 * positive amount and flows through the ordinary expense path against 33000,
 * which is already correct. This module must not swallow it: treating interest
 * as a transfer would silently delete a real deductible expense. The self-tests
 * pin that boundary.
 *
 * PARTIAL PAYMENTS NEED NOTHING SPECIAL. Paying $50 against a $200 balance is
 * the same entry for $50. There is no allocation to make, because the expenses
 * were booked individually at swipe time and 33000 is just their running total.
 *
 * PURE: no I/O, no database, no clock. Money is integer CENTS.
 */
import type { JournalDraft, JournalLineDraft } from "./ledger-core";
import { plaidToLedgerCashCents } from "./bank-match-core";

/* ══════════════════════════════════════════════════════════════════════════
 * 1) ACCOUNTS AND CATEGORIES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Credit Cards Payable. Seeded by 0173 as a CONTROL account:
 * "CONTROL, reconciled to the Plaid feed. WHICH card is a dimension."
 */
export const CARD_LIABILITY_ACCOUNT = "33000";

/** Bank - Operating. The account the bill is actually paid from. */
export const OPERATING_ACCOUNT = "10200";

/**
 * Plaid's detailed category for a card payment. Verbatim from the published
 * taxonomy; see the header for the full sentence and its sign warning.
 */
export const CARD_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

/**
 * Interest on a card. NOT a transfer - a real expense. Named here only so the
 * boundary is visible in one place and can be asserted against.
 */
export const CARD_INTEREST_CATEGORY = "BANK_FEES_INTEREST_CHARGE";

/* ══════════════════════════════════════════════════════════════════════════
 * 2) RESULT SHAPE
 * ══════════════════════════════════════════════════════════════════════════ */

export type CardPaymentOutcome =
  /** Not a card payment at all. The caller should carry on as normal. */
  | { readonly kind: "not_a_card_payment" }
  /**
   * It IS a card payment, and this is the side that books it.
   * The journal is balance-sheet only: no expense account is touched.
   */
  | { readonly kind: "transfer"; readonly journal: JournalDraft; readonly explanation: string }
  /**
   * It IS a card payment, but this is the mirror row on the other feed, or it
   * cannot be booked. Recognised and declined WITH A REASON (rules 134, 136).
   */
  | { readonly kind: "declined"; readonly code: CardPaymentDeclineCode; readonly explanation: string };

export type CardPaymentDeclineCode =
  /** The card-side mirror of a payment already booked from checking. */
  | "CARD_SIDE_MIRROR"
  /** Direction is wrong for the feed it arrived on. */
  | "UNEXPECTED_DIRECTION"
  /** Zero, fractional, or otherwise not real money. */
  | "BAD_AMOUNT";

/* ══════════════════════════════════════════════════════════════════════════
 * 3) THE FACTS THIS MODULE NEEDS
 * ══════════════════════════════════════════════════════════════════════════ */

export type CardPaymentLine = {
  readonly transactionId: string;
  /** PLAID sign: POSITIVE = money LEFT the account. Never a ledger amount. */
  readonly amountCents: number;
  readonly date: string;
  /** Plaid's detailed personal_finance_category, or null if absent. */
  readonly categoryDetailed: string | null;
  /** The owner-set role of the account this row arrived on. */
  readonly role: string | null;
};

/**
 * Is this row Plaid's card-payment category?
 *
 * Compared case-insensitively after trimming, because the value is carried
 * through a database column and a null there is a QUESTION, not a "no" that
 * should be silently treated as an ordinary expense (rule 135). A null simply
 * is not this category, and the caller's normal path then applies.
 */
export function isCardPaymentCategory(categoryDetailed: string | null | undefined): boolean {
  if (categoryDetailed === null || categoryDetailed === undefined) return false;
  return categoryDetailed.trim().toUpperCase() === CARD_PAYMENT_CATEGORY;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) THE DECISION
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Decide what a bank/card feed row means for the card liability.
 *
 * Returns `not_a_card_payment` for the overwhelming majority of rows, which is
 * the signal for the caller to run its ordinary expense path unchanged.
 */
export function planCardPayment(line: CardPaymentLine): CardPaymentOutcome {
  if (!isCardPaymentCategory(line.categoryDetailed)) {
    return { kind: "not_a_card_payment" };
  }

  const role = line.role?.trim().toLowerCase() ?? null;

  // THE CARD-SIDE MIRROR. Same payment, other feed, opposite sign. Booking it
  // would double-count the very thing this module exists to prevent.
  if (role === "credit") {
    return {
      kind: "declined",
      code: "CARD_SIDE_MIRROR",
      explanation:
        "This is the card's own record of the bill being paid. The same payment " +
        "also appears on the checking account, and that is the copy the books " +
        "use, because it is the one that moves real cash. Recording both would " +
        "pay the card down twice. Nothing was recorded here, and nothing is missing.",
    };
  }

  if (!Number.isInteger(line.amountCents) || line.amountCents === 0) {
    return {
      kind: "declined",
      code: "BAD_AMOUNT",
      explanation:
        "A card payment has to be a whole number of cents and cannot be zero. " +
        "Nothing was recorded.",
    };
  }

  // On the CHECKING feed the payment must be money going OUT. A negative here
  // is money coming IN on a card-payment category, which is a refund or a
  // reversal - a real event, but not this one, and guessing at it would post a
  // backwards entry against a control account.
  if (line.amountCents < 0) {
    return {
      kind: "declined",
      code: "UNEXPECTED_DIRECTION",
      explanation:
        "Money came IN on a row the bank labelled as a credit-card payment, " +
        "which usually means a refund or a reversed payment. That is not a bill " +
        "being paid, so it was not recorded as one. Check the row and handle it " +
        "on its own terms.",
    };
  }

  // THE SIGN WALL. plaidToLedgerCashCents is the ONE sanctioned crossing from
  // Plaid's convention (positive = money out) to the ledger's (positive =
  // debit). A positive Plaid amount becomes a NEGATIVE ledger amount: a credit
  // to cash. The card liability takes the opposite side.
  const cashLedgerCents = plaidToLedgerCashCents(line.amountCents);
  const liabilityLedgerCents = -cashLedgerCents;

  const lines: JournalLineDraft[] = [
    {
      lineNo: 1,
      accountCode: CARD_LIABILITY_ACCOUNT,
      entityCode: "greenway",
      amountCents: liabilityLedgerCents,
      costClass: "none",
      description: "Shop card balance paid down",
    },
    {
      lineNo: 2,
      accountCode: OPERATING_ACCOUNT,
      entityCode: "greenway",
      amountCents: cashLedgerCents,
      costClass: "none",
      description: "Payment to card issuer",
    },
  ];

  return {
    kind: "transfer",
    explanation:
      `${money(line.amountCents)} moved from checking to the shop card. This is a ` +
      `TRANSFER, not an expense - the things bought on the card were already ` +
      `recorded as expenses when they were purchased. Booking this as an expense ` +
      `too would count every card purchase twice.`,
    journal: {
      entityCode: "greenway",
      journalDate: line.date,
      sourceKind: "bank",
      sourceRef: `card-payment:${line.transactionId}`,
      memo: "Shop card payment",
      lines,
    },
  };
}

/** $#,##0.00 from integer cents. Local so this module stays dependency-light. */
function money(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${s}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════ */

function ok(what: string, cond: boolean): void {
  if (!cond) throw new Error(`card-payment-core self-test FAILED: ${what}`);
}

function checkingLine(over: Partial<CardPaymentLine> = {}): CardPaymentLine {
  return {
    transactionId: "txn-1",
    amountCents: 15_000, // positive = money OUT of checking
    date: "2026-11-15",
    categoryDetailed: CARD_PAYMENT_CATEGORY,
    role: "main",
    ...over,
  };
}

export function __runCardPaymentTests(): void {
  /* ── recognition ─────────────────────────────────────────────────────── */
  ok("the exact category is recognised", isCardPaymentCategory(CARD_PAYMENT_CATEGORY));
  ok("case and padding do not matter", isCardPaymentCategory("  loan_payments_credit_card_payment "));
  ok("null is not this category", !isCardPaymentCategory(null));
  ok("undefined is not this category", !isCardPaymentCategory(undefined));
  ok("a grocery run is not a card payment", !isCardPaymentCategory("FOOD_AND_DRINK_GROCERIES"));
  // The boundary that protects a real deductible expense.
  ok("interest is NOT a card payment", !isCardPaymentCategory(CARD_INTEREST_CATEGORY));

  /* ── the ordinary row passes straight through ────────────────────────── */
  {
    const r = planCardPayment(checkingLine({ categoryDetailed: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES" }));
    ok("a normal purchase is not intercepted", r.kind === "not_a_card_payment");
  }
  {
    const r = planCardPayment(checkingLine({ categoryDetailed: CARD_INTEREST_CATEGORY, role: "credit" }));
    ok("card interest is not intercepted - it is a real expense", r.kind === "not_a_card_payment");
  }

  /* ── the bookable side: checking ─────────────────────────────────────── */
  {
    const r = planCardPayment(checkingLine());
    ok("a card payment from checking books a transfer", r.kind === "transfer");
    if (r.kind === "transfer") {
      const j = r.journal;
      ok("it balances", j.lines.reduce((a, l) => a + l.amountCents, 0) === 0);

      const liab = j.lines.find((l) => l.accountCode === CARD_LIABILITY_ACCOUNT);
      const cash = j.lines.find((l) => l.accountCode === OPERATING_ACCOUNT);
      ok("33000 is present", !!liab);
      ok("10200 is present", !!cash);
      // THE SIGNS ARE THE WHOLE POINT (rule 19). Paying the bill REDUCES the
      // liability (a DEBIT, positive) and REDUCES cash (a CREDIT, negative).
      ok("33000 is DEBITED - we owe less", !!liab && liab.amountCents === 15_000);
      ok("10200 is CREDITED - cash went out", !!cash && cash.amountCents === -15_000);

      // The defining property: no expense account anywhere.
      ok("exactly two lines", j.lines.length === 2);
      ok(
        "NO expense account is touched",
        j.lines.every(
          (l) => l.accountCode === CARD_LIABILITY_ACCOUNT || l.accountCode === OPERATING_ACCOUNT,
        ),
      );
      ok("every line is costClass none", j.lines.every((l) => l.costClass === "none"));
      ok("the source ref is keyed to the transaction", j.sourceRef === "card-payment:txn-1");
      ok("the explanation says it is not an expense", /not an expense/i.test(r.explanation));
    }
  }

  /* ── the mirror side: the card's own feed ────────────────────────────── */
  {
    // Plaid: "negative for depository subtypes" - on the CARD feed the payment
    // arrives with the opposite sign. Either sign must be declined, because the
    // checking side is always the bookable one.
    for (const amt of [-15_000, 15_000]) {
      const r = planCardPayment(checkingLine({ amountCents: amt, role: "credit" }));
      ok(`the card-side mirror is declined (${amt})`, r.kind === "declined");
      if (r.kind === "declined") {
        ok("and says why", r.code === "CARD_SIDE_MIRROR");
        ok("and reassures nothing is missing", /nothing is missing/i.test(r.explanation));
      }
    }
  }

  /* ── refusals on the bookable side ───────────────────────────────────── */
  {
    const refund = planCardPayment(checkingLine({ amountCents: -15_000 }));
    ok("money IN on checking is declined, not booked backwards", refund.kind === "declined");
    if (refund.kind === "declined") ok("as a direction problem", refund.code === "UNEXPECTED_DIRECTION");

    for (const bad of [0, 10.5, Number.NaN]) {
      const r = planCardPayment(checkingLine({ amountCents: bad }));
      ok(`amount ${String(bad)} is declined`, r.kind === "declined");
      if (r.kind === "declined") ok("as a bad amount", r.code === "BAD_AMOUNT");
    }
  }

  /* ── a role nobody set yet ───────────────────────────────────────────── */
  {
    // An unassigned role on a card-payment row still books from the cash side:
    // the category already told us what the row is, and the checking side is
    // the only side that can carry real cash out.
    const r = planCardPayment(checkingLine({ role: null }));
    ok("an unset role still books the transfer", r.kind === "transfer");
  }

  console.log("card-payment-core self-tests: all passed");
}
