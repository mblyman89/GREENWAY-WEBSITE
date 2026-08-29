/**
 * tests/compliance/bank-expense-service-card.test.ts   (slice books-99, D-78)
 *
 * THE DOOR. `card-payment.test.ts` proves the DECISION is right; this file
 * proves the decision is actually REACHED, and that its result is written.
 *
 * The mutation probe found three holes that every unit test in the slice
 * survived, because unit tests hand the core a category directly:
 *
 *   * the service could stop SELECTing `personal_finance_category_detailed`,
 *   * it could read the column and pass `null` anyway,
 *   * it could plan the transfer and never submit it.
 *
 * Any one of those restores D-78 in full - the card bill flows on to the
 * classifier and gets expensed a second time - while every other test in the
 * repository stays green. Rule 133: a feature nobody can reach is not finished,
 * and rule 140: refusing to expense the bill is only half the loop if nothing
 * ever pays the liability down.
 *
 * Faked at the `submitJournal` seam, matching atm-settlement-service.test.ts:
 * what is under test is the decision-making around the call, not Postgres.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { BankFeedLine, FundingAccount } from "@/lib/accounting/bank-expense-core";

vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: vi.fn(async () => ({
    ok: true,
    journalId: "j-99",
    journalNo: 99,
    status: "draft",
    outcome: "created",
    code: "GL_DRAFT_CREATED",
    message: "Draft created.",
  })),
}));

const { submitJournal } = await import("@/lib/accounting/posting-service");
const { recordBankExpenseLines } = await import("@/lib/accounting/bank-expense-service");

const CHECKING: FundingAccount = { accountId: "acct_main", role: "main" };
const CARD: FundingAccount = { accountId: "acct_card", role: "credit" };

function line(over: Partial<BankFeedLine> = {}): BankFeedLine {
  return {
    transactionId: "txn_bill",
    amountCents: 15_000,
    date: "2026-11-15",
    merchantName: "Chase",
    name: "CHASE CARD PMT",
    pending: false,
    categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    ...over,
  };
}

/** The lines of the journal the service last submitted. */
function lastLines(): { accountCode: string; amountCents: number }[] {
  const call = vi.mocked(submitJournal).mock.calls.at(-1)?.[0] as {
    lines: { accountCode: string; amountCents: number }[];
  };
  return call.lines;
}

describe("the card bill reaches the ledger as a TRANSFER (D-78)", () => {
  it("posts DR 33000 / CR 10200 and touches no expense account", async () => {
    vi.mocked(submitJournal).mockClear();
    const run = await recordBankExpenseLines([line()], CHECKING);

    // Mutation 15 severs this: the transfer is planned and never submitted.
    expect(vi.mocked(submitJournal).mock.calls.length).toBe(1);
    expect(run.recorded).toBe(1);
    expect(run.refused).toBe(0);

    const lines = lastLines();
    const liab = lines.find((l) => l.accountCode === "33000");
    const cash = lines.find((l) => l.accountCode === "10200");
    // Paying the bill: we owe LESS (debit) and hold LESS cash (credit).
    expect(liab?.amountCents).toBe(15_000);
    expect(cash?.amountCents).toBe(-15_000);
    expect(lines.length).toBe(2);
  });

  it("declines the card-side mirror and writes nothing at all", async () => {
    vi.mocked(submitJournal).mockClear();
    const run = await recordBankExpenseLines(
      [line({ amountCents: -15_000 })],
      CARD,
    );

    expect(vi.mocked(submitJournal).mock.calls.length).toBe(0);
    expect(run.recorded).toBe(0);
    expect(run.refused).toBe(1);
    const o = run.outcomes[0];
    expect(o.kind === "refused" && o.code).toBe("CARD_SIDE_MIRROR");
    // Rule 136: the reason has to reach the human, not just the counter.
    expect(o.kind === "refused" && /nothing is missing/i.test(o.message)).toBe(true);
  });

  it("still expenses an ordinary card purchase, so the guard is not too greedy", async () => {
    vi.mocked(submitJournal).mockClear();
    // AMAZON is a real rule in expense-classification-core (76010, greenway).
    // The service runs the REAL classifier, so a merchant it does not know
    // would refuse for that reason and prove nothing about this guard.
    const run = await recordBankExpenseLines(
      [
        line({
          merchantName: "AMAZON",
          name: "AMAZON MKTPL",
          categoryDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
        }),
      ],
      CARD,
    );

    expect(run.recorded).toBe(1);
    const lines = lastLines();
    // The expense is DEBITED and the card liability is CREDITED: the balance
    // goes UP at the swipe, which is what the payment later pays down.
    expect(lines.find((l) => l.accountCode === "76010")?.amountCents).toBe(15_000);
    expect(lines.find((l) => l.accountCode === "33000")?.amountCents).toBe(-15_000);
  });
});

describe("the door actually opens", () => {
  // Rule 141: reading source text is a last resort. It is used for exactly one
  // claim -- that the SELECT names the column -- because no fake can prove what
  // a real query asks Postgres for, and mutation 13 showed that dropping it
  // breaks nothing else.
  const service = readFileSync("src/lib/accounting/bank-expense-service.ts", "utf8");

  it("selects the category column the guard depends on", () => {
    // Anchored on the SELECT literal itself, not on the bare column name: the
    // name also appears in the row mapping below it, so a loose `toContain`
    // stayed green when mutation 13 dropped the column from the query. That is
    // rule 137 in miniature - an ambiguous anchor is not a probe.
    expect(service).toContain(
      '"transaction_id,amount_cents,date,merchant_name,name,pending,personal_finance_category_detailed"',
    );
  });

  it("hands the column through to the core rather than a hardcoded null", () => {
    // Mutation 14: `categoryDetailed: null` reads the column and throws it away.
    expect(service).toContain("categoryDetailed: row.personal_finance_category_detailed");
  });
});
