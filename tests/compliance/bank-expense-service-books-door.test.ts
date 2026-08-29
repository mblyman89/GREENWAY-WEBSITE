/**
 * tests/compliance/bank-expense-service-books-door.test.ts  (books-101, D-80)
 *
 * THE READING DOOR — `recordBankExpenses`, the function the app actually calls.
 *
 * `bank-expense-service-books.test.ts` drives `recordBankExpenseLines`, which
 * is handed a funding account already built. That leaves a gap the mutation
 * probe found and no behavioural test covered: the code that BUILDS the funding
 * account by reading `plaid_accounts`. Three mutations survived there —
 *
 *   * read `books_entity` and pass `null` through anyway,
 *   * build the funding account without `booksEntity` at all,
 *   * move the gate after the classifier, where a refusal masks it,
 *
 * — and each restores D-80 in full: the gate stays perfectly correct and is
 * simply never given anything to judge, so a personal charge posts into a 280E
 * business with every other test in the repository green.
 *
 * THE FAKE HONOURS THE SELECT LIST, deliberately, matching
 * deposit-clearing.test.ts. Postgres returns the columns you asked for and no
 * others; a stub that hands back `books_entity` whether or not the query asked
 * for it cannot notice a query that forgot to ask — which is rule 39, a test
 * that re-implements what it checks proves nothing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Rows the fake Postgres will serve, keyed by table. */
const ACCOUNT_ROW: Record<string, unknown> = {
  account_id: "acct_personal",
  role: "main",
  books_entity: "personal",
  active: true,
};

const TXN_ROW: Record<string, unknown> = {
  transaction_id: "txn_amzn",
  amount_cents: 4_200,
  date: "2026-11-20",
  merchant_name: "AMAZON",
  name: "AMAZON MKTPL",
  pending: false,
  personal_finance_category_detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
  removed: false,
};

/** Only the columns a query actually names come back, exactly like Postgres. */
function project(row: Record<string, unknown>, cols: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of cols.split(",")) {
    const col = raw.trim();
    if (col !== "" && Object.prototype.hasOwnProperty.call(row, col)) {
      out[col] = row[col];
    }
  }
  return out;
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    let table = "";
    let cols = "";
    const q = {
      from: (t: string) => {
        table = t;
        return q;
      },
      select: (c: string) => {
        cols = c;
        return q;
      },
      eq: () => q,
      order: () => q,
      limit: () => Promise.resolve({ data: [project(TXN_ROW, cols)], error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: table === "plaid_accounts" ? project(ACCOUNT_ROW, cols) : null,
          error: null,
        }),
    };
    return q;
  },
}));

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
const { recordBankExpenses } = await import("@/lib/accounting/bank-expense-service");

beforeEach(() => {
  vi.mocked(submitJournal).mockClear();
  ACCOUNT_ROW.books_entity = "personal";
});

describe("recordBankExpenses carries the account's books to the gate (D-80)", () => {
  // THE DEFECT, through the real reading path. An Amazon charge on a PERSONAL
  // account. The merchant rule says greenway; the account says personal; before
  // books-101 the merchant won silently.
  it("refuses a personal account's charge and writes NOTHING", async () => {
    const run = await recordBankExpenses("acct_personal", 10);
    expect(run.recorded).toBe(0);
    // The harm is the write, so that is what is asserted.
    expect(submitJournal).not.toHaveBeenCalled();
    expect(run.outcomes[0]?.kind).toBe("refused");
    if (run.outcomes[0]?.kind === "refused") {
      expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_ARE_PERSONAL");
    }
  });

  // The counterpart, so the test above is not passing because NOTHING posts.
  // Rule 13c: a refusal test with no matching acceptance cannot fail usefully.
  it("posts the very same charge when the account is on GREENWAY books", async () => {
    ACCOUNT_ROW.books_entity = "greenway";
    const run = await recordBankExpenses("acct_personal", 10);
    expect(run.recorded).toBe(1);
    expect(submitJournal).toHaveBeenCalledTimes(1);
  });

  it("refuses when the account has not been classified yet", async () => {
    ACCOUNT_ROW.books_entity = null;
    const run = await recordBankExpenses("acct_personal", 10);
    expect(run.recorded).toBe(0);
    expect(submitJournal).not.toHaveBeenCalled();
    if (run.outcomes[0]?.kind === "refused") {
      expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_UNASSIGNED");
    }
  });

  // Rule 135: a blank string is "nobody said yet" wearing a value's clothes.
  it("treats a blank books tag as unclassified, not as a value", async () => {
    ACCOUNT_ROW.books_entity = "   ";
    const run = await recordBankExpenses("acct_personal", 10);
    expect(run.recorded).toBe(0);
    expect(submitJournal).not.toHaveBeenCalled();
  });

  // THE GATE MUST RUN BEFORE THE CLASSIFIER. If it runs after, a merchant the
  // classifier cannot place refuses first, and the refusal Michael reads says
  // "I don't know this merchant" when the truth is "this is your wife's
  // account". Same count of refusals, wrong reason, and the moment he adds a
  // rule for that merchant the personal charge posts.
  it("blames the personal account, not the merchant, when both would refuse", async () => {
    TXN_ROW.merchant_name = "SOME PLACE NOBODY HAS EVER CLASSIFIED";
    TXN_ROW.name = "SOME PLACE NOBODY HAS EVER CLASSIFIED";
    try {
      const run = await recordBankExpenses("acct_personal", 10);
      expect(run.recorded).toBe(0);
      expect(submitJournal).not.toHaveBeenCalled();
      if (run.outcomes[0]?.kind === "refused") {
        expect(run.outcomes[0].code).toBe("ACCOUNT_BOOKS_ARE_PERSONAL");
      }
    } finally {
      TXN_ROW.merchant_name = "AMAZON";
      TXN_ROW.name = "AMAZON MKTPL";
    }
  });
});
