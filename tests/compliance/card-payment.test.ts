/**
 * tests/compliance/card-payment.test.ts
 *
 * books-99 -- THE SHOP CARD (D-78).
 *
 * Michael is putting a low-limit card in the shop so employees stop taking cash
 * out of the master till for supply runs. The purchase side already worked. The
 * PAYMENT side did not, and its failure mode is the dangerous kind: paying the
 * bill from checking looked exactly like an ordinary expense, so it balanced,
 * it posted, and it quietly counted every card purchase a second time.
 *
 * These tests guard three things that nothing else can:
 *
 *   1. The bill NEVER reaches the expense path -- from either feed.
 *   2. The transfer that replaces it moves the liability the RIGHT WAY.
 *   3. Interest, and ordinary swipes, are STILL expenses. A guard that was too
 *      greedy would silently delete real deductions, which on a 280E return is
 *      the more expensive mistake of the two.
 */

import { describe, it, expect } from "vitest";
import {
  planCardPayment,
  isCardPaymentCategory,
  CARD_LIABILITY_ACCOUNT,
  OPERATING_ACCOUNT,
  CARD_PAYMENT_CATEGORY,
  CARD_INTEREST_CATEGORY,
  __runCardPaymentTests,
  type CardPaymentLine,
} from "@/lib/accounting/card-payment-core";
import {
  planBankExpense,
  ALL_BANK_EXPENSE_REFUSAL_CODES,
  ROLE_TO_CASH_ACCOUNT,
  type BankFeedLine,
} from "@/lib/accounting/bank-expense-core";
import type { ExpenseClassification } from "@/lib/accounting/expense-classification-core";

/** A classification that WOULD have posted. That is the point of using it. */
const GOOD: Extract<ExpenseClassification, { ok: true }> = {
  ok: true,
  account: "76040",
  entity: "greenway",
  costClass: "nondeductible_280e",
  matchedValue: "CHASE",
  matchKind: "merchant_contains",
  normalized: "CHASE CARD PMT",
};

function feedLine(over: Partial<BankFeedLine> = {}): BankFeedLine {
  return {
    transactionId: "txn_card_bill",
    amountCents: 15_000,
    date: "2026-11-15",
    merchantName: "Chase",
    name: "CHASE CARD PMT",
    pending: false,
    ...over,
  };
}

function cardLine(over: Partial<CardPaymentLine> = {}): CardPaymentLine {
  return {
    transactionId: "txn_card_bill",
    amountCents: 15_000,
    date: "2026-11-15",
    categoryDetailed: CARD_PAYMENT_CATEGORY,
    role: "main",
    ...over,
  };
}

describe("D-78: the card bill can never be expensed", () => {
  it("refuses the checking-side payment even though it classifies cleanly", () => {
    // Rule 39: this is not re-implementing the guard, it is proving that a row
    // which passes every OTHER check is still stopped.
    const plan = planBankExpense(
      feedLine({ categoryDetailed: CARD_PAYMENT_CATEGORY }),
      { accountId: "a1", role: "main" },
      GOOD,
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe("CARD_PAYMENT_NOT_AN_EXPENSE");
  });

  it("refuses the card-side mirror for being a card payment, not for its sign", () => {
    // The mirror arrives NEGATIVE. Without the guard sitting ahead of the
    // direction check it would refuse as NOT_AN_OUTFLOW -- accidentally the
    // right outcome for entirely the wrong reason, which is the sort of thing
    // that gets "fixed" later by someone who reads the message and believes it.
    const plan = planBankExpense(
      feedLine({ categoryDetailed: CARD_PAYMENT_CATEGORY, amountCents: -15_000 }),
      { accountId: "a1", role: "credit" },
      GOOD,
    );
    expect(plan.ok === false && plan.code).toBe("CARD_PAYMENT_NOT_AN_EXPENSE");
  });

  it("tells Michael, in the refusal itself, why nothing was recorded", () => {
    const plan = planBankExpense(
      feedLine({ categoryDetailed: CARD_PAYMENT_CATEGORY }),
      { accountId: "a1", role: "main" },
      GOOD,
    );
    expect(plan.ok === false && /twice/i.test(plan.message)).toBe(true);
  });

  it("declares the new refusal code in the exported list", () => {
    // A code the door can emit but the list does not name is invisible to every
    // screen that renders refusals by iterating this array.
    expect(ALL_BANK_EXPENSE_REFUSAL_CODES).toContain("CARD_PAYMENT_NOT_AN_EXPENSE");
    // Rule 89: 8 -> 9, stated out loud.
    expect(ALL_BANK_EXPENSE_REFUSAL_CODES.length).toBe(9);
  });
});

describe("what must STILL be an expense", () => {
  it("posts card interest as a real expense against 33000", () => {
    const plan = planBankExpense(
      feedLine({ categoryDetailed: CARD_INTEREST_CATEGORY }),
      { accountId: "a1", role: "credit" },
      GOOD,
    );
    expect(plan.ok).toBe(true);
    expect(plan.ok === true && plan.lines[1].accountCode).toBe(CARD_LIABILITY_ACCOUNT);
  });

  it("posts an ordinary swipe as an expense that INCREASES the card balance", () => {
    const plan = planBankExpense(
      feedLine({ categoryDetailed: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES" }),
      { accountId: "a1", role: "credit" },
      GOOD,
    );
    expect(plan.ok).toBe(true);
    // A liability going UP is a CREDIT: negative in ledger convention (rule 19).
    expect(plan.ok === true && plan.lines[1].amountCents).toBeLessThan(0);
  });

  it("leaves rows with no category alone, whether absent or null", () => {
    // Rule 135: missing is a question, not a "no". Neither may change behaviour.
    expect(planBankExpense(feedLine(), { accountId: "a1", role: "main" }, GOOD).ok).toBe(true);
    expect(
      planBankExpense(
        feedLine({ categoryDetailed: null }),
        { accountId: "a1", role: "main" },
        GOOD,
      ).ok,
    ).toBe(true);
  });

  it("keeps the purchase side wired to the card liability", () => {
    // If this mapping ever moved, expensing at the swipe would stop crediting
    // 33000 and the payment transfer would debit a balance nothing built.
    expect(ROLE_TO_CASH_ACCOUNT.credit).toBe(CARD_LIABILITY_ACCOUNT);
  });
});

describe("the transfer that replaces the expense", () => {
  it("debits 33000 and credits 10200, and nothing else", () => {
    const out = planCardPayment(cardLine());
    expect(out.kind).toBe("transfer");
    if (out.kind !== "transfer") return;

    const codes = out.journal.lines.map((l) => l.accountCode).sort();
    expect(codes).toEqual([OPERATING_ACCOUNT, CARD_LIABILITY_ACCOUNT].sort());

    const liab = out.journal.lines.find((l) => l.accountCode === CARD_LIABILITY_ACCOUNT);
    const cash = out.journal.lines.find((l) => l.accountCode === OPERATING_ACCOUNT);
    // Paying the bill: we owe LESS (debit, positive) and hold LESS (credit).
    expect(liab?.amountCents).toBe(15_000);
    expect(cash?.amountCents).toBe(-15_000);
  });

  it("balances", () => {
    const out = planCardPayment(cardLine({ amountCents: 8_333 }));
    expect(out.kind === "transfer" && out.journal.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
  });

  it("declines the mirror so the same payment is never booked twice", () => {
    const out = planCardPayment(cardLine({ amountCents: -15_000, role: "credit" }));
    expect(out.kind === "declined" && out.code).toBe("CARD_SIDE_MIRROR");
  });

  it("declines money coming IN rather than posting a backwards entry", () => {
    const out = planCardPayment(cardLine({ amountCents: -15_000 }));
    expect(out.kind === "declined" && out.code).toBe("UNEXPECTED_DIRECTION");
  });

  it("refuses amounts that are not real money", () => {
    for (const bad of [0, 12.5, Number.NaN]) {
      const out = planCardPayment(cardLine({ amountCents: bad }));
      expect(out.kind === "declined" && out.code).toBe("BAD_AMOUNT");
    }
  });

  it("passes every other row straight through untouched", () => {
    expect(planCardPayment(cardLine({ categoryDetailed: "FOOD_AND_DRINK_COFFEE" })).kind).toBe(
      "not_a_card_payment",
    );
    expect(planCardPayment(cardLine({ categoryDetailed: null })).kind).toBe("not_a_card_payment");
  });

  it("keys the entry to the transaction so a re-run cannot duplicate it", () => {
    // submitJournal is idempotent on (entity, sourceKind, sourceRef).
    const out = planCardPayment(cardLine());
    expect(out.kind === "transfer" && out.journal.sourceRef).toBe("card-payment:txn_card_bill");
  });

  it("recognises the category regardless of case or padding", () => {
    expect(isCardPaymentCategory(" Loan_Payments_Credit_Card_Payment ")).toBe(true);
    expect(isCardPaymentCategory(CARD_INTEREST_CATEGORY)).toBe(false);
  });

  it("matches the category EXACTLY, not by prefix", () => {
    // LOAN_PAYMENTS also covers car notes, student loans and mortgages. A
    // prefix match would turn every one of them into a payment against the shop
    // card's balance -- balanced, posted, and completely fictional. These are
    // real siblings from Plaid's published taxonomy, not invented strings.
    expect(isCardPaymentCategory("LOAN_PAYMENTS_CAR_PAYMENT")).toBe(false);
    expect(isCardPaymentCategory("LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toBe(false);
    expect(planCardPayment(cardLine({ categoryDetailed: "LOAN_PAYMENTS_CAR_PAYMENT" })).kind).toBe(
      "not_a_card_payment",
    );
  });

  it("pays from the operating account, not the ATM account", () => {
    // 10300 is restricted to the atm/greenway books and exists to hold vault
    // cash for the machine. Paying a card bill out of it would balance, and
    // would quietly drain the account the ATM reconciles against.
    expect(OPERATING_ACCOUNT).toBe("10200");
    const out = planCardPayment(cardLine());
    expect(out.kind === "transfer" && out.journal.lines.some((l) => l.accountCode === "10300")).toBe(
      false,
    );
  });
});

describe("the module's own self-tests", () => {
  it("pass", () => {
    expect(() => __runCardPaymentTests()).not.toThrow();
  });
});
