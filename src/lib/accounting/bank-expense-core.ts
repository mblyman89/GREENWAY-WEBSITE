/**
 * src/lib/accounting/bank-expense-core.ts
 *
 * THE PURE HALF of "an expense appears in the bank feed" (D-56 / D-37).
 *
 * WHAT EVENT THIS IS
 * ------------------
 * A card swipe or bank debit lands in the Plaid feed with no corresponding
 * event inside the system. Nobody typed it; the bank is telling us it happened.
 * The census calls this `vendor_cycle.operating_expense_from_bank` and notes
 * why it is the right place to start wiring: "There is no in-system counterpart
 * to marry, which is what makes this family safe."
 *
 * WHY THIS FILE IS SEPARATE FROM THE SERVICE
 * ------------------------------------------
 * Everything here is a decision, and every decision here can be wrong in a way
 * that still balances. Kept pure, each one can be tested without a database.
 * The service does the reading and the writing and owns no judgement.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THAT SILENTLY REVERSE A BANK ENTRY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1) THE SIGN IS INVERTED RELATIVE TO INTUITION.
 *    `plaid-money-core.ts:18-20` states the convention verbatim:
 *      POSITIVE amount_cents = money LEFT the account (an OUTFLOW).
 *      NEGATIVE amount_cents = money CAME IN (an INFLOW).
 *    Read "amount" as a plain number and every expense books backwards. A
 *    backwards match STILL BALANCES -- flip the sign and both lines flip
 *    together, debits still equal credits, nothing turns red, and the only
 *    symptom is a wrong tax return. That is the bank screen's own warning,
 *    and it is the reason this module converts sign to direction ONCE, here,
 *    and never lets a raw Plaid amount reach a journal line.
 *
 * 2) THE CASH SIDE IS NOT DERIVABLE FROM THE TRANSACTION.
 *    `classifyExpense` answers "which EXPENSE account", and its input type
 *    carries ONLY `{ merchant }` -- no amount, no date, no account. The other
 *    side of the entry has to come from WHICH BANK ACCOUNT the row belongs to,
 *    and the only owner-set fact tying a Plaid account to the chart is
 *    `plaid_accounts.role`. Standing rule 1 forbids guessing it, so an
 *    unmapped role REFUSES instead of defaulting. A default here would post
 *    real money to an arbitrary account.
 *
 * 3) THE TWO LINES NEED DIFFERENT 280E TREATMENT.
 *    Migration 0172 check (7) raises GL_COST_CLASS_REQUIRED when an account
 *    with `requires_cost_class` carries 'none', AND raises when a
 *    balance-sheet account carries anything OTHER than 'none'. Every 7xxxx
 *    expense account is seeded `requires_cost_class = true`; every cash and
 *    card account is an asset or a liability. So the expense line MUST carry a
 *    real class and the cash line MUST carry 'none'. Give both lines the same
 *    class -- the obvious thing to do -- and the post is refused.
 */

import type {
  ExpenseClassification,
  ExpenseCostClass,
  ExpenseEntity,
} from "@/lib/accounting/expense-classification-core";
import { isCardPaymentCategory } from "@/lib/accounting/card-payment-core";

/* ------------------------------------------------------------------ *
 * 1) The cash side: owner-set role -> chart account
 * ------------------------------------------------------------------ */

/**
 * The ONLY mapping from a Plaid account to the chart of accounts.
 *
 * `plaid_accounts.role` is assigned by Michael on the Plaid screen and is
 * deliberately never written by a re-sync (`store.ts#upsertPlaidAccount`:
 * "Deliberately does NOT write `role` -- the owner assigns that via a dedicated
 * action so a re-sync never clobbers a role"). That makes it the one honest
 * owner-declared link between a real bank account and an account code.
 *
 * PRECEDENT, NOT INVENTION: using role to find the operating account is
 * already shipped. `plaid-core.ts:68-69` says "'main' is load-bearing for
 * reconciliation (vendor-reconcile uses role==='main' to find the operating
 * account). Never rename or remove it", and
 * `vendor-reconcile-store.ts:110` does exactly `a.role === "main" && a.active`.
 * This table follows that established meaning rather than creating a second,
 * competing notion of "the operating account".
 *
 * WHY THIS IS A CLOSED LIST AND NOT A LOOKUP WITH A FALLBACK:
 * migration 0169 RELAXED `role` to any 1..32 char lower-case key, so a role can
 * be free text Michael typed ("escrow", "tax hold"). There is no defensible way
 * to infer a GL account from an arbitrary word, so anything not listed here
 * REFUSES. Adding a mapping is a deliberate act, which is the point.
 */
export const ROLE_TO_CASH_ACCOUNT: Readonly<Record<string, string>> = {
  /** Timberland operating checking. Chart: 10200 Bank - Operating. */
  main: "10200",
  /** Chart: 10300 Bank - ATM Vault Account. */
  atm: "10300",
  /**
   * Chart: 33000 Credit Cards Payable. A card is a LIABILITY, not cash: paying
   * with it increases what is owed rather than decreasing a balance. The entry
   * shape is identical (credit the funding account) because crediting a
   * liability increases it while crediting an asset decreases it -- the same
   * signed line means the right thing on both. 0173 seeds 33000 as
   * "CONTROL, reconciled to the Plaid feed. WHICH card is a dimension."
   */
  credit: "33000",
} as const;

/**
 * Accounts above that are seeded `is_control = true` in 0173/0178.
 *
 * This is SAFE here and would NOT be safe from the journal screen. Migration
 * 0172 check (6) fires only `if j.source_kind = 'manual'`, so control-account
 * discipline blocks a human typing at 10200 while still allowing the subledger
 * that owns it to post. The bank feed IS that subledger, and this module posts
 * `sourceKind: "bank"`. Recorded because "why is a control account allowed
 * here?" is the first question a reviewer should ask.
 */
export const BANK_SOURCE_KIND = "bank" as const;

/* ------------------------------------------------------------------ *
 * 2) Refusal codes
 * ------------------------------------------------------------------ */

export type BankExpenseRefusalCode =
  /** `role` is null/blank: Michael has not told us what this account is. */
  | "CASH_ACCOUNT_UNASSIGNED"
  /** `role` is set but is a custom key with no chart mapping. */
  | "CASH_ACCOUNT_UNMAPPED"
  /** amount_cents < 0: money came IN. A deposit/refund is not an expense. */
  | "NOT_AN_OUTFLOW"
  /** amount_cents === 0: nothing happened. */
  | "ZERO_AMOUNT"
  /** Plaid still calls this pending; the amount and even the merchant move. */
  | "TRANSACTION_PENDING"
  /** The classifier refused. Its own code is carried through verbatim. */
  | "NOT_CLASSIFIED"
  /** Expense says one entity, the funding account belongs to another. */
  | "ENTITY_MISMATCH"
  /** A personal expense funded from a business account. See below. */
  | "PERSONAL_ON_BUSINESS_ACCOUNT"
  /**
   * D-78. Paying the shop card's bill is a TRANSFER, not an expense: the
   * purchases were already expensed at the swipe. See the guard in
   * `planBankExpense` for why this refusal has to exist.
   */
  | "CARD_PAYMENT_NOT_AN_EXPENSE";

export const ALL_BANK_EXPENSE_REFUSAL_CODES: readonly BankExpenseRefusalCode[] = [
  "CASH_ACCOUNT_UNASSIGNED",
  "CASH_ACCOUNT_UNMAPPED",
  "NOT_AN_OUTFLOW",
  "ZERO_AMOUNT",
  "TRANSACTION_PENDING",
  "NOT_CLASSIFIED",
  "ENTITY_MISMATCH",
  "PERSONAL_ON_BUSINESS_ACCOUNT",
  "CARD_PAYMENT_NOT_AN_EXPENSE",
] as const;

/**
 * Which entities each funding account may serve, mirroring
 * `allowed_entity_codes` in 0173. `null` there means "all entities", which is
 * why 10200 and 33000 are absent from this table: the chart genuinely does not
 * restrict them. 10300 is seeded `array['atm','greenway']`.
 *
 * Restated here so a mismatch is caught before a round trip, exactly as
 * `expense-classification-core.ts` restates ACCOUNT_ENTITY_RESTRICTIONS. The
 * database remains the authority; this is an early, clearer refusal.
 */
export const CASH_ACCOUNT_ENTITY_RESTRICTIONS: Readonly<
  Record<string, readonly ExpenseEntity[]>
> = {
  "10300": ["atm", "greenway"],
} as const;

/* ------------------------------------------------------------------ *
 * 3) Shapes
 * ------------------------------------------------------------------ */

/**
 * The bank facts this module needs. A structural subset of
 * `PlaidTransactionRecord` so the store type can change without dragging this
 * pure module (and its tests) along behind it.
 */
export type BankFeedLine = {
  readonly transactionId: string;
  /** Plaid sign: POSITIVE = money OUT. Never pass this to a journal line. */
  readonly amountCents: number;
  readonly date: string;
  readonly merchantName: string | null;
  readonly name: string | null;
  readonly pending: boolean;
  /**
   * Plaid's `personal_finance_category.detailed`, stored since books-88 as
   * `plaid_transactions.personal_finance_category_detailed`.
   *
   * OPTIONAL ON PURPOSE, and the distinction matters (rule 135). Absent means
   * the caller did not ask the database for the column; null means Plaid had no
   * opinion about this row. Neither is a licence to invent one, so both fall
   * through to the ordinary merchant-text path, which is what every row did
   * before D-78 was found. What the field DOES do is let the one row that must
   * never be expensed -- the card bill -- identify itself.
   */
  readonly categoryDetailed?: string | null;
};

/** The owner-set role for the account the line belongs to. */
export type FundingAccount = {
  readonly accountId: string;
  readonly role: string | null;
};

export type BankExpenseLine = {
  readonly accountCode: string;
  /** Signed cents, LEDGER convention: POSITIVE = debit, NEGATIVE = credit. */
  readonly amountCents: number;
  readonly costClass: ExpenseCostClass;
  readonly description: string;
};

export type BankExpensePlan =
  | {
      readonly ok: true;
      readonly sourceRef: string;
      readonly journalDate: string;
      readonly entityCode: ExpenseEntity;
      readonly memo: string;
      readonly lines: readonly [BankExpenseLine, BankExpenseLine];
    }
  | {
      readonly ok: false;
      readonly code: BankExpenseRefusalCode;
      /** The classifier's own code when `code` is NOT_CLASSIFIED. */
      readonly underlyingCode: string | null;
      readonly message: string;
    };

/* ------------------------------------------------------------------ *
 * 4) The merchant text
 * ------------------------------------------------------------------ */

/**
 * Which text to classify on.
 *
 * Plaid supplies a cleaned `merchant_name` and a raw `name` (the statement
 * descriptor). `merchant_name` is preferred because the classifier's rules were
 * measured against merchant text, but it is frequently null on ACH and bank-fee
 * rows -- which is precisely the 76040 Bank Fees case D-37 names. Falling back
 * to `name` keeps those classifiable; if BOTH are blank the classifier's own
 * MERCHANT_MISSING refusal fires, which is the correct outcome rather than
 * something invented here.
 */
export function merchantTextFor(line: BankFeedLine): string | null {
  const merchant = line.merchantName?.trim();
  if (merchant) return merchant;
  const raw = line.name?.trim();
  if (raw) return raw;
  return null;
}

/* ------------------------------------------------------------------ *
 * 5) The cash side
 * ------------------------------------------------------------------ */

export type CashAccountResolution =
  | { readonly ok: true; readonly accountCode: string }
  | {
      readonly ok: false;
      readonly code: "CASH_ACCOUNT_UNASSIGNED" | "CASH_ACCOUNT_UNMAPPED";
      readonly message: string;
    };

/**
 * Resolve which chart account this bank account IS. Refuses rather than
 * defaulting -- see the header, reason (2).
 */
export function resolveCashAccount(account: FundingAccount): CashAccountResolution {
  const role = account.role?.trim().toLowerCase();
  if (!role) {
    return {
      ok: false,
      code: "CASH_ACCOUNT_UNASSIGNED",
      message:
        "This bank account has not been told what it is yet. Open the Plaid screen and give it a role " +
        "(Main operating, ATM, or Credit card) so the system knows which account on the books it stands for. " +
        "Nothing was written.",
    };
  }
  const mapped = ROLE_TO_CASH_ACCOUNT[role];
  if (!mapped) {
    return {
      ok: false,
      code: "CASH_ACCOUNT_UNMAPPED",
      message:
        `This account is tagged "${role}", which is a name you typed rather than one of the roles the books ` +
        "know how to post to (Main operating, ATM, or Credit card). Rather than guess which account on the " +
        "books it means, nothing was written.",
    };
  }
  return { ok: true, accountCode: mapped };
}

/* ------------------------------------------------------------------ *
 * 6) The plan
 * ------------------------------------------------------------------ */

/**
 * Turn one bank-feed row plus its classification into a balanced two-line
 * journal, or refuse with a reason a human can act on.
 *
 * The classification is passed IN rather than computed here so this stays pure
 * and so the caller cannot accidentally classify different text than the text
 * this module reports.
 */
export function planBankExpense(
  line: BankFeedLine,
  account: FundingAccount,
  classification: ExpenseClassification,
): BankExpensePlan {
  // (1) PENDING FIRST. A pending row's amount and merchant both still move, and
  // Plaid later replaces it with a settled row carrying a DIFFERENT
  // transaction_id. Posting it would book a number that is about to change and
  // leave a duplicate behind when the settled row arrives.
  if (line.pending) {
    return {
      ok: false,
      code: "TRANSACTION_PENDING",
      underlyingCode: null,
      message:
        "This charge is still pending at the bank, so the amount can change. It will be booked once it settles.",
    };
  }

  // (2) THE CARD BILL IS NOT AN EXPENSE (D-78).
  //
  // When the shop card's statement is paid from checking, Plaid reports an
  // ordinary OUTFLOW on the operating account. Nothing below could tell that
  // row apart from a real purchase, so it was classified on its merchant text
  // ("CHASE CARD PMT" and the like) and booked as a SECOND expense.
  //
  // That is a double count, not a rounding error. The things bought on the card
  // were already expensed at the swipe, when `ROLE_TO_CASH_ACCOUNT.credit`
  // credited 33000. Expensing the payment as well would count every card
  // purchase twice on a 280E return and leave 33000 growing forever, because
  // nothing would ever debit the liability back down.
  //
  // The right entry -- DEBIT 33000, CREDIT 10200 -- touches no expense account
  // at all, and `card-payment-core.ts` builds it. This guard's whole job is to
  // make sure the row cannot ALSO travel the expense path.
  //
  // IT IS DELIBERATELY SIGN-BLIND. The same payment appears on BOTH feeds with
  // OPPOSITE signs (Plaid: "positive amounts for credit card subtypes and
  // negative for depository subtypes"), so refusing before the direction check
  // means neither copy can ever reach a classifier, whichever way it points.
  if (isCardPaymentCategory(line.categoryDetailed)) {
    return {
      ok: false,
      code: "CARD_PAYMENT_NOT_AN_EXPENSE",
      underlyingCode: null,
      message:
        "This is the shop card's bill being paid, which is a transfer rather than an expense. " +
        "Whatever was bought on the card was already recorded as an expense when it was purchased, " +
        "so recording this too would count it twice. It is booked against the card balance instead.",
    };
  }

  // (3) DIRECTION. POSITIVE = money OUT (plaid-money-core.ts:18-20).
  if (line.amountCents === 0) {
    return {
      ok: false,
      code: "ZERO_AMOUNT",
      underlyingCode: null,
      message: "This row is for zero dollars, so there is nothing to record.",
    };
  }
  if (line.amountCents < 0) {
    return {
      ok: false,
      code: "NOT_AN_OUTFLOW",
      underlyingCode: null,
      message:
        "Money came IN on this row, so it is a deposit or a refund rather than an expense. " +
        "Deposits are handled by the sales and ATM entries, not here.",
    };
  }

  // (4) THE EXPENSE SIDE.
  if (!classification.ok) {
    return {
      ok: false,
      code: "NOT_CLASSIFIED",
      underlyingCode: classification.code,
      message: classification.message,
    };
  }

  // (5) THE CASH SIDE.
  const cash = resolveCashAccount(account);
  if (!cash.ok) {
    return { ok: false, code: cash.code, underlyingCode: null, message: cash.message };
  }

  // (6) THE TWO SIDES MUST AGREE ON WHOSE BOOKS THIS IS.
  //
  // A personal expense paid from a business account is NOT an expense on the
  // business books -- it is an owner distribution, and booking it as an expense
  // on a 280E return is the kind of thing that turns an audit into an
  // adjustment. Michael's standing instruction is "I am also only concerned
  // with business expenses for now", so rather than invent a distribution entry
  // this refuses and says what it is.
  if (classification.entity === "personal" && cash.accountCode !== "33000") {
    return {
      ok: false,
      code: "PERSONAL_ON_BUSINESS_ACCOUNT",
      underlyingCode: null,
      message:
        "This looks like a personal expense paid from a business account. That is not a business expense -- " +
        "it is money taken out of the business, and recording it as an expense on a cannabis return is exactly " +
        "the kind of item that does not survive an audit. It needs your decision, so nothing was written.",
    };
  }

  const allowed = CASH_ACCOUNT_ENTITY_RESTRICTIONS[cash.accountCode];
  if (allowed && !allowed.includes(classification.entity)) {
    return {
      ok: false,
      code: "ENTITY_MISMATCH",
      underlyingCode: null,
      message:
        `The expense belongs to the ${classification.entity} books, but it was paid from an account the chart ` +
        `restricts to ${allowed.join(" or ")}. One of the two is wrong, so nothing was written.`,
    };
  }

  // (7) THE ENTRY. Debit the expense, credit what funded it.
  //
  // The 280E class goes on the EXPENSE line only; the funding line is an asset
  // (10200/10300) or a liability (33000) and migration 0172 check (7) refuses a
  // balance-sheet line carrying any class other than 'none'.
  const merchant = merchantTextFor(line) ?? "unknown merchant";
  const debit: BankExpenseLine = {
    accountCode: classification.account,
    amountCents: line.amountCents,
    costClass: classification.costClass,
    description: merchant,
  };
  const credit: BankExpenseLine = {
    accountCode: cash.accountCode,
    amountCents: -line.amountCents,
    costClass: "none",
    description: merchant,
  };

  return {
    ok: true,
    sourceRef: line.transactionId,
    journalDate: line.date,
    entityCode: classification.entity,
    memo: `Bank feed: ${merchant}`,
    lines: [debit, credit],
  };
}

/* ------------------------------------------------------------------ *
 * 7) Self-tests
 * ------------------------------------------------------------------ */

function expect(label: string, cond: boolean): void {
  if (!cond) throw new Error(`bank-expense-core self-test FAILED: ${label}`);
}

const OK_CLASS: ExpenseClassification = {
  ok: true,
  account: "76040",
  entity: "greenway",
  costClass: "nondeductible_280e",
  matchedValue: "TIMBERLAND",
  matchKind: "merchant_contains",
  normalized: "TIMBERLAND BANK FEE",
};

/**
 * Build an `ok: true` classification. Spreading OK_CLASS inline widens the
 * literal to the whole discriminated union, so TypeScript can no longer tell
 * which arm it is; this keeps the arm pinned.
 */
function classified(
  over: Partial<Extract<ExpenseClassification, { ok: true }>> = {},
): ExpenseClassification {
  return { ...(OK_CLASS as Extract<ExpenseClassification, { ok: true }>), ...over };
}

function line(over: Partial<BankFeedLine> = {}): BankFeedLine {
  return {
    transactionId: "txn_1",
    amountCents: 2500,
    date: "2026-11-03",
    merchantName: "Timberland Bank",
    name: "TIMBERLAND BANK FEE",
    pending: false,
    ...over,
  };
}

export function __runBankExpenseCoreTests(): void {
  // --- the sign convention, the thing most likely to be silently wrong ---
  const plan = planBankExpense(line(), { accountId: "a1", role: "main" }, OK_CLASS);
  expect("a positive Plaid amount is an OUTFLOW and plans", plan.ok);
  if (plan.ok) {
    const [debit, credit] = plan.lines;
    expect("the EXPENSE line is a debit (positive)", debit.amountCents === 2500);
    expect("the expense line is the classified account", debit.accountCode === "76040");
    expect("the CASH line is a credit (negative)", credit.amountCents === -2500);
    expect("role 'main' funds from 10200", credit.accountCode === "10200");
    expect("the entry balances", debit.amountCents + credit.amountCents === 0);
    // 0172 check (7), both halves.
    expect("the expense line carries a real 280E class", debit.costClass === "nondeductible_280e");
    expect("the balance-sheet line carries 'none'", credit.costClass === "none");
    expect("the source ref is the Plaid transaction id", plan.sourceRef === "txn_1");
    expect("the journal date is the bank's date", plan.journalDate === "2026-11-03");
  }

  // A NEGATIVE amount is money coming IN. If this ever plans, every refund in
  // the feed books as an expense.
  const inflow = planBankExpense(
    line({ amountCents: -2500 }),
    { accountId: "a1", role: "main" },
    OK_CLASS,
  );
  expect("an inflow is refused", !inflow.ok);
  expect("an inflow refuses as NOT_AN_OUTFLOW", !inflow.ok && inflow.code === "NOT_AN_OUTFLOW");

  const zero = planBankExpense(line({ amountCents: 0 }), { accountId: "a1", role: "main" }, OK_CLASS);
  expect("a zero row is refused", !zero.ok && zero.code === "ZERO_AMOUNT");

  // --- pending is checked BEFORE anything else ---
  const pending = planBankExpense(
    line({ pending: true }),
    { accountId: "a1", role: "main" },
    OK_CLASS,
  );
  expect("a pending row is refused", !pending.ok && pending.code === "TRANSACTION_PENDING");

  // --- the cash side refuses rather than defaulting ---
  const unassigned = planBankExpense(line(), { accountId: "a1", role: null }, OK_CLASS);
  expect(
    "an unassigned role refuses",
    !unassigned.ok && unassigned.code === "CASH_ACCOUNT_UNASSIGNED",
  );
  const custom = planBankExpense(line(), { accountId: "a1", role: "tax hold" }, OK_CLASS);
  expect("a custom role refuses", !custom.ok && custom.code === "CASH_ACCOUNT_UNMAPPED");
  expect(
    "the custom-role refusal quotes the role back",
    !custom.ok && custom.message.includes("tax hold"),
  );

  expect("role 'atm' funds from 10300", resolveCashAccount({ accountId: "a", role: "atm" }).ok);
  const atmAcct = resolveCashAccount({ accountId: "a", role: "atm" });
  expect("atm maps to 10300", atmAcct.ok && atmAcct.accountCode === "10300");
  const cardAcct = resolveCashAccount({ accountId: "a", role: "credit" });
  expect("credit maps to 33000", cardAcct.ok && cardAcct.accountCode === "33000");
  const upper = resolveCashAccount({ accountId: "a", role: "  MAIN  " });
  expect("role matching is trimmed + case-insensitive", upper.ok && upper.accountCode === "10200");

  // --- the classifier's refusal is carried through, never swallowed ---
  const refused = planBankExpense(line(), { accountId: "a1", role: "main" }, {
    ok: false,
    code: "MERCHANT_UNKNOWN",
    message: "No rule matched.",
    normalized: "WIDGETS INC",
  });
  expect("an unclassified row refuses", !refused.ok && refused.code === "NOT_CLASSIFIED");
  expect(
    "the classifier's own code survives",
    !refused.ok && refused.underlyingCode === "MERCHANT_UNKNOWN",
  );

  // --- entity discipline ---
  const personal = planBankExpense(
    line(),
    { accountId: "a1", role: "main" },
    classified({ account: "79010", entity: "personal", costClass: "personal" }),
  );
  expect(
    "personal spend on the operating account refuses",
    !personal.ok && personal.code === "PERSONAL_ON_BUSINESS_ACCOUNT",
  );

  const mismatch = planBankExpense(
    line(),
    { accountId: "a1", role: "atm" },
    classified({ entity: "landholding", costClass: "separate_business" }),
  );
  expect(
    "landholding spend from the ATM account refuses",
    !mismatch.ok && mismatch.code === "ENTITY_MISMATCH",
  );

  // 10200 is unrestricted in the chart, so landholding from 'main' is allowed.
  const unrestricted = planBankExpense(
    line(),
    { accountId: "a1", role: "main" },
    classified({ entity: "landholding", costClass: "separate_business" }),
  );
  expect("10200 is not entity-restricted", unrestricted.ok);

  // --- merchant text fallback ---
  expect(
    "merchant_name wins when present",
    merchantTextFor(line()) === "Timberland Bank",
  );
  expect(
    "falls back to the raw descriptor",
    merchantTextFor(line({ merchantName: null })) === "TIMBERLAND BANK FEE",
  );
  expect(
    "blank merchant_name is not preferred over a real descriptor",
    merchantTextFor(line({ merchantName: "   " })) === "TIMBERLAND BANK FEE",
  );
  expect(
    "both blank -> null, so the classifier raises MERCHANT_MISSING",
    merchantTextFor(line({ merchantName: null, name: null })) === null,
  );

  // --- D-78: the card bill can never travel the expense path ---------------
  //
  // The classification handed in below is a PERFECTLY GOOD one. That is the
  // point: before this guard existed, a card payment classified cleanly on its
  // merchant text and posted a second expense. If the guard is removed, these
  // become ok:true and the double count is back.
  const cardBill = planBankExpense(
    line({ categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    { accountId: "a1", role: "main" },
    classified({}),
  );
  expect(
    "paying the shop card bill is refused, not expensed",
    !cardBill.ok && cardBill.code === "CARD_PAYMENT_NOT_AN_EXPENSE",
  );

  // SIGN-BLIND ON PURPOSE. The mirror row on the card feed carries the opposite
  // sign; it must be refused for being a card payment, NOT for its direction,
  // or the reason a human reads would be wrong.
  const cardMirror = planBankExpense(
    line({ categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", amountCents: -15_000 }),
    { accountId: "a1", role: "credit" },
    classified({}),
  );
  expect(
    "the card-side mirror is refused as a card payment, not as an inflow",
    !cardMirror.ok && cardMirror.code === "CARD_PAYMENT_NOT_AN_EXPENSE",
  );

  // THE BOUNDARY. Interest on the card IS a real expense and must still post.
  // A guard that swallowed this would silently delete a deduction.
  const interest = planBankExpense(
    line({ categoryDetailed: "BANK_FEES_INTEREST_CHARGE" }),
    { accountId: "a1", role: "credit" },
    classified({}),
  );
  expect("card interest is still a real expense", interest.ok);

  // An ordinary purchase on the card is untouched by any of this.
  const swipe = planBankExpense(
    line({ categoryDetailed: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES" }),
    { accountId: "a1", role: "credit" },
    classified({}),
  );
  expect("a card swipe still posts an expense against 33000", swipe.ok);
  expect(
    "and credits the card liability",
    swipe.ok && swipe.lines[1].accountCode === "33000" && swipe.lines[1].amountCents < 0,
  );

  // Absent and null both mean "nobody said", and must behave exactly as before.
  expect("an absent category still posts", planBankExpense(
    line(), { accountId: "a1", role: "main" }, classified({}),
  ).ok);
  expect("a null category still posts", planBankExpense(
    line({ categoryDetailed: null }), { accountId: "a1", role: "main" }, classified({}),
  ).ok);

  // --- every declared refusal code is reachable from the shipped door ---
  expect(
    "the refusal code list matches the union",
    ALL_BANK_EXPENSE_REFUSAL_CODES.length === 9,
  );
}
