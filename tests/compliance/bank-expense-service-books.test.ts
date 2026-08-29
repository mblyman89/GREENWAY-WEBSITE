/**
 * tests/compliance/bank-expense-service-books.test.ts   (slice books-101, D-80)
 *
 * THE DOOR for the account-books gate.
 *
 * `account-classification.test.ts` proves the DECISION is right — an account on
 * personal books never posts to a business ledger, and the account outranks the
 * merchant. This file proves the decision is actually REACHED by the shipped
 * path, because a gate that is perfectly correct and never consulted is D-80
 * exactly as it was before (rule 133g, rule 50).
 *
 * The ways this gate can be silently severed, all of which leave every unit
 * test in the slice green:
 *
 *   * `recordBankExpenses` stops SELECTing `books_entity`,
 *   * it reads the column and passes `null`/nothing through anyway,
 *   * `recordBankExpenseLines` drops `booksEntity` before calling the core,
 *   * `planBankExpense` treats an absent books tag as "assume business".
 *
 * Each one restores the original defect in full: a personal charge posts into a
 * 280E business return and looks perfectly ordinary doing it.
 *
 * Faked at the `submitJournal` seam, matching bank-expense-service-card.test.ts:
 * what is under test is the decision-making around the call, not Postgres.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { BankFeedLine, FundingAccount } from "@/lib/accounting/bank-expense-core";

vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: vi.fn(async () => ({
    ok: true,
    journalId: "j-101",
    journalNo: 101,
    status: "draft",
    outcome: "created",
    code: "GL_DRAFT_CREATED",
    message: "Draft created.",
  })),
}));

const { submitJournal } = await import("@/lib/accounting/posting-service");
const { recordBankExpenseLines } = await import("@/lib/accounting/bank-expense-service");

/**
 * AMAZON is used because the service runs the REAL classifier, which has no
 * fallback by design: an unknown merchant returns MERCHANT_UNKNOWN and would
 * refuse for the wrong reason, hiding whatever this test meant to prove.
 * Verified by execution: classifyExpense({merchant:"AMAZON"}) returns
 * { account:"76010", entity:"greenway", costClass:"nondeductible_280e" }.
 */
function line(over: Partial<BankFeedLine> = {}): BankFeedLine {
  return {
    transactionId: "txn_amzn",
    amountCents: 4_200,
    date: "2026-11-20",
    merchantName: "AMAZON",
    name: "AMAZON MKTPL",
    pending: false,
    categoryDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    ...over,
  };
}

const GREENWAY_CHECKING: FundingAccount = {
  accountId: "acct_main",
  role: "main",
  booksEntity: "greenway",
};

beforeEach(() => {
  vi.mocked(submitJournal).mockClear();
});

describe("the books gate is reached by the shipped path (D-80)", () => {
  it("posts an Amazon charge on a GREENWAY account", () => {
    return recordBankExpenseLines([line()], GREENWAY_CHECKING).then((run) => {
      expect(run.recorded).toBe(1);
      expect(submitJournal).toHaveBeenCalledTimes(1);
    });
  });

  // THE DEFECT, at the door. The identical charge, on a personal account.
  // Before books-101 this posted into Greenway, because the entity came from
  // the merchant rule and the merchant text is the same either way.
  it("does NOT post the same charge on a PERSONAL account", async () => {
    const run = await recordBankExpenseLines([line()], {
      accountId: "acct_personal",
      role: "main",
      booksEntity: "personal",
    });
    expect(run.recorded).toBe(0);
    expect(run.refused).toBe(1);
    // Rule 133g: the sharpest assertion is that nothing was WRITTEN, because
    // that is the harm. A counted refusal with a journal behind it is worse
    // than no test at all.
    expect(submitJournal).not.toHaveBeenCalled();
    expect(run.outcomes[0]?.kind).toBe("refused");
    if (run.outcomes[0]?.kind === "refused") {
      expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_ARE_PERSONAL");
    }
  });

  it("does NOT post from an account nobody has classified yet", async () => {
    const run = await recordBankExpenseLines([line()], {
      accountId: "acct_new",
      role: "main",
      booksEntity: null,
    });
    expect(run.recorded).toBe(0);
    expect(submitJournal).not.toHaveBeenCalled();
    if (run.outcomes[0]?.kind === "refused") {
      expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_UNASSIGNED");
    }
  });

  // The mutation "drop booksEntity from FundingAccount before calling the
  // core" leaves the field optional and every other test green. An ABSENT tag
  // must behave exactly like an explicitly null one, or that mutation is a
  // silent way back to assuming everything is the business.
  it("treats an ABSENT books tag exactly like an unclassified one", async () => {
    const run = await recordBankExpenseLines([line()], {
      accountId: "acct_absent",
      role: "main",
    });
    expect(run.recorded).toBe(0);
    expect(submitJournal).not.toHaveBeenCalled();
  });

  it("refuses when the account and the merchant disagree about the business", async () => {
    // AMAZON classifies as greenway; the account says landholding.
    const run = await recordBankExpenseLines([line()], {
      accountId: "acct_land",
      role: "main",
      booksEntity: "landholding",
    });
    expect(run.recorded).toBe(0);
    expect(submitJournal).not.toHaveBeenCalled();
    if (run.outcomes[0]?.kind === "refused") {
      expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_MISMATCH");
    }
  });
});

describe("the wire the fake cannot see", () => {
  // Rule 141: reading source text is a last resort, used here for exactly one
  // claim -- that the SELECT names the column -- because no fake can prove what
  // a real Postgres query asked for. Everything else above is behavioural.
  it("selects books_entity when reading the account", () => {
    const service = readFileSync("src/lib/accounting/bank-expense-service.ts", "utf8");
    // Rule 137: anchored on the whole SELECT literal, not the bare column name.
    // The bare name also appears in the row mapping below it, so a loose
    // `toContain` would stay green with the column dropped from the query --
    // which is the exact mutation this test exists to catch.
    expect(service).toContain('.select("account_id,role,books_entity,active")');
  });

  it("passes the column it read through to the funding account", () => {
    const service = readFileSync("src/lib/accounting/bank-expense-service.ts", "utf8");
    expect(service).toContain("booksEntity");
    expect(service).toContain("acct.books_entity");
  });
});
