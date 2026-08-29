/**
 * tests/compliance/deposit-clearing.test.ts
 *
 * books-95: the entry that clears `10400 Undeposited Funds` when the bank
 * confirms the money arrived.
 *
 * THE RISK THIS FILE IS ABOUT
 * ---------------------------
 * A wrongly-signed bank match STILL BALANCES. Debits equal credits, the journal
 * sums to zero, nothing errors, no screen turns red. Standing rule 19 records
 * that this business has already had backwards signs once, in the Sage books.
 * So the sign is asserted as a VALUE here, repeatedly, and not trusted to a
 * comment.
 *
 * The second risk is quieter: books-94 only ever DEBITS 10400. If nothing
 * credits it, the balance grows forever and the same dollar is counted twice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── mocks, declared before the import under test ─────────────────────────────
// The return type is declared as the UNION the real submitJournal returns, not
// inferred from the happy path. Inference narrows it to `ok: true` and then a
// test that models the ledger REFUSING a journal will not typecheck -- which
// is how the "a failed post is reported as success" hole stayed open.
type SubmitResult =
  | {
      ok: true;
      journalId: string;
      journalNo: number;
      status: "posted" | "draft";
      outcome: string;
      code: string;
      message: string;
    }
  | { ok: false; code: string; message: string };

const submit = vi.fn(
  async (input: { sourceRef: string | null }): Promise<SubmitResult> => ({
    ok: true,
    journalId: "j-1",
    journalNo: 41,
    status: "posted",
    outcome: (input.sourceRef ?? "").includes("already") ? "duplicate" : "created",
    code: "GL_AUTOPOST_OK",
    message: "Posted.",
  }),
);

vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: (...a: unknown[]) => submit(...(a as [{ sourceRef: string | null }])),
}));

// The service reads the ledger through the admin client. Only the one query it
// makes is modelled, and the shape mirrors the real column names so a rename
// cannot pass silently.
type MockLine = {
  amount_cents: number;
  description?: string | null;
  gl_journals: { status: string; journal_date: string; source_ref?: string | null };
};
let LINES: MockLine[] = [];
let READ_FAILS = false;
/** Models a SELECT that forgot `description` — the D-76 relapse shape. */
let DROP_COLUMN = false;
let LAST_QUERY: Record<string, unknown> = {};

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    // The filters are RECORDED and then APPLIED, rather than ignored. A stub
    // that hands back the same rows whatever it is asked cannot tell a query
    // for posted journals from a query for drafts, so it cannot prove the
    // service asks the right question (rule 39).
    const filters: Record<string, unknown> = {};
    const q = {
      from: (table: string) => {
        filters.table = table;
        return q;
      },
      // The SELECT LIST IS RECORDED AND HONOURED. Postgres returns the columns
      // you asked for and no others; a stub that hands back `description`
      // whether or not the query requested it cannot notice a query that
      // forgot to ask, which is exactly how the D-76 relapse would return.
      select: (cols: string) => {
        filters.select = cols;
        return q;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return q;
      },
      then: undefined as unknown,
    };
    // `eq` is awaited on the last call, so the chain must be thenable.
    (q as unknown as { then: unknown }).then = (
      resolve: (r: unknown) => unknown,
    ) => {
      LAST_QUERY = { ...filters };
      if (READ_FAILS) return resolve({ data: null, error: { message: "boom" } });
      const wantStatus = filters["gl_journals.status"];
      const wantAccount = filters["account_code"];
      const rows = LINES.filter(
        (l) =>
          l.gl_journals.status === wantStatus &&
          (wantAccount === UNDEPOSITED_ACCOUNT || wantAccount === undefined),
      ).map((l) => {
        // Postgres returns every SELECTED column on every row, null when empty
        // - and returns nothing at all for a column that was not asked for.
        // Both halves are modelled, because only the second one can catch a
        // SELECT that quietly stopped requesting `description`.
        const asked = String(filters.select ?? "").includes("description");
        if (!asked || DROP_COLUMN) {
          const withheld: Partial<MockLine> = { ...l };
          delete withheld.description;
          return withheld;
        }
        return { ...l, description: l.description ?? null };
      });
      return resolve({ data: rows, error: null });
    };
    return q;
  },
}));

import {
  buildDepositClearingJournal,
  depositSourceRef,
  money,
  BANK_OPERATING_ACCOUNT,
  UNDEPOSITED_ACCOUNT,
  DEPOSIT_SOURCE_PREFIX,
  type DepositInput,
  type DepositResult,
} from "@/lib/accounting/deposit-clearing-core";
import {
  clearedDayDescription,
  parseClearedDay,
  CLEARED_DAY_PREFIX,
  type UndepositedDay,
} from "@/lib/accounting/deposit-fifo-core";
import {
  clearDepositForBankRow,
  undepositedBalanceMinor,
  describeDepositOutcome,
  type DepositClearOutcome,
} from "@/lib/accounting/deposit-clearing-service";
import { UndepositedFunds } from "@/app/admin/registers/eod/UndepositedFunds";
import type { BankRow } from "@/lib/accounting/bank-match-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const CORE = "src/lib/accounting/deposit-clearing-core.ts";
const SERVICE = "src/lib/accounting/deposit-clearing-service.ts";
const PANEL = "src/app/admin/registers/eod/UndepositedFunds.tsx";
const EOD = "src/app/admin/registers/eod/page.tsx";
const CLOSE_BUILDER = "src/lib/accounting/register-cash-journal-core.ts";

/** Strip comments so a doc-block cannot satisfy a source assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function row(over: Partial<BankRow> = {}): BankRow {
  return {
    transactionId: "txn_dep_1",
    accountId: "acct_1",
    amountCents: -50_000, // PLAID: negative = money came IN
    date: "2026-11-03",
    name: "DEPOSIT",
    pending: false,
    removed: false,
    ...over,
  };
}

/** One day, one bag, banked the next morning: the ordinary case. */
function days(...d: Array<[string, number]>): UndepositedDay[] {
  return d.map(([date, amountMinor]) => ({
    date,
    amountMinor,
    sourceRef: `till-close:${date}`,
  }));
}

function input(over: Partial<DepositInput> = {}): DepositInput {
  return {
    row: row(),
    eventKind: "deposit_of_sales",
    days: days(["2026-11-02", 50_000]),
    ...over,
  };
}

/** Rule 48: a check that cannot classify must FAIL, not skip. */
function mustJournal(r: DepositResult) {
  if (r.kind !== "journal") {
    throw new Error(`expected a journal, got ${r.kind}: ${r.explanation}`);
  }
  return r;
}
function mustRefuse(r: DepositResult) {
  if (r.kind !== "refused") throw new Error(`expected a refusal, got ${r.kind}`);
  return r;
}
function amountOn(r: DepositResult, account: string): number {
  const j = mustJournal(r);
  return j.journal.lines.filter((l) => l.accountCode === account)
    .reduce((a, l) => a + l.amountCents, 0);
}

beforeEach(() => {
  submit.mockClear();
  READ_FAILS = false;
  DROP_COLUMN = false;
  LAST_QUERY = {};
  LINES = [
    {
      amount_cents: 50_000,
      description: "Cash counted out of the drawer",
      gl_journals: {
        status: "posted",
        journal_date: "2026-11-02",
        source_ref: "till-close:s1",
      },
    },
  ];
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE SIGN WALL — the failure that balances perfectly
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · the sign wall", () => {
  it("money arriving DEBITS the bank and CREDITS undeposited funds", () => {
    const r = buildDepositClearingJournal(input());
    expect(amountOn(r, BANK_OPERATING_ACCOUNT)).toBe(50_000);
    expect(amountOn(r, UNDEPOSITED_ACCOUNT)).toBe(-50_000);
  });

  it("the bank line is POSITIVE — a flipped sign still balances, so pin the value", () => {
    // This is the whole reason this describe block exists. Negating both lines
    // keeps the journal balanced and produces a books-destroying entry that no
    // balance check can see.
    const r = mustJournal(buildDepositClearingJournal(input()));
    const bank = r.journal.lines.find((l) => l.accountCode === BANK_OPERATING_ACCOUNT);
    expect(bank?.amountCents).toBeGreaterThan(0);
  });

  it("the entry sums to zero", () => {
    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(r.journal.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
  });

  it("money LEAVING is refused, not booked as a deposit", () => {
    const r = mustRefuse(
      buildDepositClearingJournal(input({ row: row({ amountCents: 50_000 }) })),
    );
    expect(r.code).toBe("DEPOSIT_WRONG_DIRECTION");
  });

  it("the negation is delegated, never re-implemented here (rule 25)", () => {
    // bank-match-core's header names plaidToLedgerCashCents as the ONLY
    // sanctioned crossing in the repository. A second negation is a second
    // chance to get it backwards.
    const src = stripComments(read(CORE));
    // The whole EXPRESSION, not just the identifier: the identifier survives
    // in the import line even after the call is replaced by a hand-rolled
    // negation, so asserting the name alone proves nothing (rule 39).
    expect(src).toContain("plaidToLedgerCashCents(row.amountCents)");
    // And nothing may negate the feed by hand alongside it.
    expect(src).not.toContain("Math.abs(row.amountCents)");
    expect(src).not.toContain("-row.amountCents");
    // No hand-rolled negation of a plaid amount anywhere in this module.
    expect(src).not.toMatch(/-\s*row\.amountCents/);
    expect(src).not.toMatch(/-\s*input\.row\.amountCents/);
  });

  it("the stripper really strips, so the assertion above cannot pass on prose", () => {
    expect(stripComments("// plaidToLedgerCashCents\n")).not.toContain(
      "plaidToLedgerCashCents",
    );
    expect(stripComments("const a = 1; // x\n")).toContain("const a = 1;");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) NO INCOME IS INVENTED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · a deposit is not income", () => {
  it("touches exactly two accounts, both of them cash", () => {
    const r = mustJournal(buildDepositClearingJournal(input()));
    const codes = r.journal.lines.map((l) => l.accountCode).sort();
    expect(codes).toEqual([BANK_OPERATING_ACCOUNT, UNDEPOSITED_ACCOUNT]);
  });

  it("says out loud that the sale was already booked", () => {
    // The revenue was recognised when the sale was rung up. Recognising it
    // again here would double the day's takings, and the explanation is what
    // stops a future reader "fixing" the missing revenue line.
    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(r.explanation).toMatch(/already booked/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) WHAT IT REFUSES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · what it refuses", () => {
  const cases: Array<[string, Partial<DepositInput>, string]> = [
    ["a pending row", { row: row({ pending: true }) }, "DEPOSIT_PENDING_ROW"],
    ["a withdrawn row", { row: row({ removed: true }) }, "DEPOSIT_REMOVED_ROW"],
    ["a pre-cutover row", { row: row({ date: "2025-12-31" }) }, "DEPOSIT_PRE_CUTOVER"],
    ["a zero row", { row: row({ amountCents: 0 }) }, "DEPOSIT_ZERO_AMOUNT"],
    ["a fractional cent", { row: row({ amountCents: -1.5 }) }, "DEPOSIT_NON_INTEGER_CENTS"],
    ["an own transfer", { eventKind: "own_transfer" }, "DEPOSIT_WRONG_EVENT_KIND"],
    ["an ATM settlement", { eventKind: "atm_vault" }, "DEPOSIT_WRONG_EVENT_KIND"],
    ["an owner contribution", { eventKind: "owner_contribution" }, "DEPOSIT_WRONG_EVENT_KIND"],
    ["an empty pool", { days: [] }, "DEPOSIT_NOTHING_UNDEPOSITED"],
    ["more than was counted", { days: days(["2026-11-02", 10_000]) }, "DEPOSIT_EXCEEDS_UNDEPOSITED"],
    ["a bank row already used", { alreadyMatched: true }, "DEPOSIT_ALREADY_MATCHED"],
    ["an unreadable business day", { days: days(["", 50_000]) }, "DEPOSIT_INVALID_DATE"],
    ["a day worth nothing", { days: days(["2026-11-02", 0]) }, "DEPOSIT_POOL_NOT_POSITIVE"],
    [
      "a day banked for more than it held",
      { days: days(["2026-11-01", -1], ["2026-11-02", 50_001]) },
      "DEPOSIT_POOL_NOT_POSITIVE",
    ],
  ];

  for (const [label, over, code] of cases) {
    it(`${label} is refused with ${code}`, () => {
      expect(mustRefuse(buildDepositClearingJournal(input(over))).code).toBe(code);
    });
  }

  it("banking EXACTLY what was counted is allowed", () => {
    // `>` versus `>=` differ by precisely the everyday case.
    expect(buildDepositClearingJournal(input({ days: days(["2026-11-02", 50_000]) })).kind)
      .toBe("journal");
  });

  it("ONE CENT more than was counted is refused", () => {
    // The boundary from the other side. Without this, the over-clear guard can
    // be loosened by a single cent and every test still passes -- and a single
    // cent is enough to prove 10400 is allowed to go negative, which is the
    // whole thing the guard exists to prevent.
    const r = buildDepositClearingJournal(
      input({ row: row({ amountCents: -50_001 }), days: days(["2026-11-02", 50_000]) }),
    );
    expect(mustRefuse(r).code).toBe("DEPOSIT_EXCEEDS_UNDEPOSITED");
  });

  it("a fractional POOL balance is refused, not silently rounded", () => {
    // The row amount and the pool are two different numbers and each needs its
    // own whole-cent check. A fractional pool means the ledger read returned
    // something that is not money, and guessing which way to round it would
    // invent or destroy a cent of somebody's cash.
    const r = buildDepositClearingJournal(input({ days: days(["2026-11-02", 50_000.5]) }));
    expect(mustRefuse(r).code).toBe("DEPOSIT_NON_INTEGER_CENTS");
  });

  it("the too-large refusal shows BOTH figures, so the gap is obvious", () => {
    const r = mustRefuse(
      buildDepositClearingJournal(input({ days: days(["2026-11-02", 10_000]) })),
    );
    expect(r.explanation).toContain("$500.00");
    expect(r.explanation).toContain("$100.00");
  });

  it("the wrong-kind refusal names the kind it actually saw", () => {
    const r = mustRefuse(buildDepositClearingJournal(input({ eventKind: "own_transfer" })));
    expect(r.explanation).toContain("own_transfer");
  });

  it("a partial deposit posts and names what is still outstanding", () => {
    const r = mustJournal(
      buildDepositClearingJournal(
        input({ days: days(["2026-11-01", 50_000], ["2026-11-02", 30_000]) }),
      ),
    );
    expect(amountOn(r, UNDEPOSITED_ACCOUNT)).toBe(-50_000);
    expect(r.explanation).toContain("$300.00");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) IDEMPOTENCY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · twice leaves the books unchanged", () => {
  it("the ref is the plaid transaction id, which is unique and stable", () => {
    expect(depositSourceRef("txn_9")).toBe(`${DEPOSIT_SOURCE_PREFIX}:txn_9`);
  });

  it("two different bank rows get two different refs", () => {
    expect(depositSourceRef("a")).not.toBe(depositSourceRef("b"));
  });

  it("the ref is not keyed on the DATE, which would merge two deposits in a day", () => {
    // Banking twice in one day is normal for a cash business. A date key would
    // silently discard the second run — the D-24 shape.
    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(r.journal.sourceRef).toContain("txn_dep_1");
    expect(r.journal.sourceRef).not.toContain(r.journal.journalDate);
  });

  it("a replay is reported as already cleared, not as a fresh posting", async () => {
    const o = await clearDepositForBankRow(row({ transactionId: "already" }), "deposit_of_sales");
    expect(o.kind).toBe("posted");
    if (o.kind === "posted") {
      expect(o.outcome).toBe("duplicate");
      expect(o.message).toMatch(/already cleared/i);
      expect(o.message).not.toMatch(/reached the bank on/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) THE SERVICE — reading the real balance
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · the balance is read, not taken on trust", () => {
  it("sums posted lines into the pool", async () => {
    LINES = [
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-03" } },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.balanceMinor).toBe(50_000);
    // and it is broken down by the day the cash came from, not lumped
    expect(pool?.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("reports the OLDEST date among lines that added to the pool", async () => {
    LINES = [
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-05" } },
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
    ];
    expect((await undepositedBalanceMinor())?.oldestDate).toBe("2026-11-01");
  });

  it("a previous clearing credit does not make the pool look older than it is", async () => {
    // A credit is a deposit that already left. Letting it set the oldest date
    // would age the pool with cash that is no longer in it, and could trip the
    // 30-day warning on money that is only days old.
    LINES = [
      {
        amount_cents: -40_000,
        description: clearedDayDescription("2026-01-05"),
        gl_journals: { status: "posted", journal_date: "2026-01-20" },
      },
      {
        amount_cents: 50_000,
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.oldestDate).toBe("2026-11-02");
    expect(pool?.balanceMinor).toBe(10_000);
  });

  it("a failed read is NULL, never an empty pool (rule 46)", async () => {
    READ_FAILS = true;
    expect(await undepositedBalanceMinor()).toBeNull();
  });

  it("and the service refuses rather than claiming nothing is waiting", async () => {
    READ_FAILS = true;
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.code).toBe("DEPOSIT_BALANCE_UNREADABLE");
      // The distinction said out loud, so nobody collapses it into the
      // nothing-to-clear refusal.
      expect(o.message).toMatch(/not the same as there being nothing/i);
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("posts with autoPost and the deposit ref when everything is in order", async () => {
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("posted");
    expect(submit).toHaveBeenCalledTimes(1);
    const sent = submit.mock.calls[0][0] as unknown as {
      sourceRef: string; autoPost: boolean; sourceKind: string;
      lines: Array<{ accountCode: string; amountCents: number }>;
    };
    expect(sent.sourceRef).toBe("deposit-clear:txn_dep_1");
    expect(sent.autoPost).toBe(true);
    expect(sent.sourceKind).toBe("bank");
    const bank = sent.lines.find((l) => l.accountCode === BANK_OPERATING_ACCOUNT);
    expect(bank?.amountCents).toBe(50_000);
    // and the outcome names the day it banked, so the screen can show it
    if (o.kind === "posted") expect(o.clearedDays).toEqual(["2026-11-02"]);
  });

  it("a refusal never reaches the ledger", async () => {
    const o = await clearDepositForBankRow(row(), "own_transfer");
    expect(o.kind).toBe("refused");
    expect(submit).not.toHaveBeenCalled();
  });

  it("the balance is read from POSTED journals only, never drafts", async () => {
    // Clearing real cash against an unapproved draft would let a proposal
    // unlock a deposit. Asserted through the QUERY the service actually sent,
    // because the word "posted" appears in this file for several reasons and
    // finding it proves nothing about the filter (rule 39).
    LINES = [
      { amount_cents: 50_000, gl_journals: { status: "draft", journal_date: "2026-11-02" } },
    ];
    const pool = await undepositedBalanceMinor();
    expect(LAST_QUERY["gl_journals.status"]).toBe("posted");
    // and the draft row must not have reached the balance
    expect(pool?.balanceMinor).toBe(0);
  });

  it("the balance is read from 10400 and no other account", async () => {
    await undepositedBalanceMinor();
    expect(LAST_QUERY["account_code"]).toBe(UNDEPOSITED_ACCOUNT);
    expect(LAST_QUERY["table"]).toBe("gl_journal_lines");
  });

  it("a ledger that rejects the journal is reported as FAILED, not posted", async () => {
    // Rule 135: a post that did not happen is not a quiet non-event. If the
    // ledger says no and the screen says yes, the manager stops looking.
    submit.mockImplementationOnce(
      async (): Promise<SubmitResult> => ({
        ok: false,
        code: "GL_OUT_OF_BALANCE",
        message: "The ledger refused it.",
      }),
    );
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("failed");
    if (o.kind === "failed") {
      expect(o.code).toBe("GL_OUT_OF_BALANCE");
      expect(o.message).toContain("refused");
    }
    // and the sentence the manager reads must not sound like success
    expect(describeDepositOutcome(o)).toMatch(/unchanged/i);
  });

  it("every outcome kind gets its own sentence", () => {
    const kinds: DepositClearOutcome[] = [
      { kind: "posted", transactionId: "t", sourceRef: "r", journalId: "j", journalNo: 1, outcome: "created", code: "C", message: "money arrived", warnings: [], clearedDays: ["2026-11-02"] },
      { kind: "refused", transactionId: "t", code: "C", message: "not a deposit" },
      { kind: "failed", transactionId: "t", sourceRef: "r", code: "C", message: "ledger said no" },
    ];
    const said = kinds.map(describeDepositOutcome);
    expect(new Set(said).size).toBe(3);
    expect(said[1]).toMatch(/not cleared/i);
    expect(said[2]).toMatch(/unchanged/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE LOOP CLOSES — books-94's debit now has a credit
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · 10400 can now go down as well as up", () => {
  it("the close builder DEBITS 10400 and this core CREDITS it", () => {
    // The two halves, asserted together. This is the assertion that would have
    // failed for the whole of books-94, and it is the reason this slice exists.
    const closeSrc = stripComments(read(CLOSE_BUILDER));
    expect(closeSrc).toContain("UNDEPOSITED_ACCOUNT");

    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(amountOn(r, UNDEPOSITED_ACCOUNT)).toBeLessThan(0);
  });

  it("clearing the full pool returns it to zero and says so", () => {
    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(r.explanation).toMatch(/back to zero/i);
  });

  it("money() formats cents for humans without floats", () => {
    expect(money(50_000)).toBe("$500.00");
    expect(money(1_234_567)).toBe("$12,345.67");
    expect(money(5)).toBe("$0.05");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) REACHABILITY (rule 133) — Michael can SEE the balance
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · reachability", () => {
  it("the end-of-day page renders the undeposited panel", () => {
    const src = stripComments(read(EOD));
    expect(src).toContain("<UndepositedFunds />");
    expect(src).toContain('from "./UndepositedFunds"');
  });

  // The next three RENDER the panel instead of reading its source. Reading the
  // source proved almost nothing here: the name `undepositedBalanceMinor`
  // survives in the import line even after the call is replaced by a hardcoded
  // zero, and `=== null` survives inside `if (false && pool === null)`. Both
  // of those breakages sailed past the source-text versions of these tests
  // (rule 39: a test that re-implements what it checks proves nothing).

  it("the panel prints the balance the LEDGER holds, not a constant", async () => {
    LINES = [
      { amount_cents: 73_500, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toContain("$735.00");
  });

  it("and it moves when the ledger moves", async () => {
    // One figure could be a coincidence; two different ledgers producing two
    // different screens is the actual claim.
    LINES = [
      { amount_cents: 12_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toContain("$120.00");
    expect(html).not.toContain("$735.00");
  });

  it("an unreadable balance does NOT render as a clean $0.00 (rule 46)", async () => {
    // "$0.00" and "we could not find out" are opposite statements. If they
    // share a rendering, a broken query looks like a clean set of books.
    READ_FAILS = true;
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).not.toContain("$0.00");
    expect(html.replace(/\s+/g, " ")).toMatch(/could not be read/i);
  });

  it("a genuinely empty pool DOES render as all clear", async () => {
    // The other side of the same coin: if every read looked like a failure the
    // panel would cry wolf and be ignored, which is the same outcome.
    LINES = [];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toContain("$0.00");
    expect(html).not.toMatch(/could not be read/i);
  });

  it("the panel says that showing the number does not clear it", () => {
    // books-93's lesson, recorded in the census: rendering is a read. The panel
    // must not imply the balance has been dealt with just because it is visible.
    expect(read(PANEL)).toMatch(/does not clear it/i);
  });

  it("the panel names the account, so it can be checked against the books", () => {
    expect(read(PANEL)).toContain("10400");
  });

  it("books-96: the panel LISTS the waiting days, not just a total", async () => {
    // A single figure cannot tell one busy Saturday from eleven quiet days
    // piling up, and those want different reactions. Rendered, not grepped
    // (rule 141): source text proves the string exists, not that it reaches
    // a screen.
    LINES = [
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toContain("2026-11-01");
    expect(html).toContain("2026-11-02");
    expect(html).toContain("$300.00");
    expect(html).toContain("$200.00");
    expect(html).toContain("$500.00");
  });

  it("books-96: the days appear OLDEST FIRST on the screen too", async () => {
    LINES = [
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-05" } },
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html.indexOf("2026-11-01")).toBeLessThan(html.indexOf("2026-11-05"));
  });

  it("books-96: a banked day disappears from the list", async () => {
    // D-76 seen from the screen. Nov 1 was banked; only Nov 2 should remain.
    LINES = [
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
      {
        amount_cents: -30_000,
        description: clearedDayDescription("2026-11-01"),
        gl_journals: { status: "posted", journal_date: "2026-11-04" },
      },
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).not.toContain("2026-11-01");
    expect(html).toContain("2026-11-02");
    expect(html).toContain("$200.00");
  });

  it("books-96: an over-cleared day is shown in red, never netted into the total", async () => {
    // Rule 135. The total here is a perfectly innocent $0.00 and the books are
    // broken; a panel that only printed the total would show all-clear.
    LINES = [
      {
        amount_cents: -10_000,
        description: clearedDayDescription("2026-11-01"),
        gl_journals: { status: "posted", journal_date: "2026-11-04" },
      },
      { amount_cents: 10_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toMatch(/More was banked than was counted/i);
    expect(html).toContain("2026-11-01");
    expect(html).not.toMatch(/Every dollar counted out of a drawer has been matched/i);
  });

  it("books-96: the panel ties a listed day to a physical bag", async () => {
    // The control only works if the list is checkable against the safe.
    LINES = [
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
    ];
    const html = renderToStaticMarkup(await UndepositedFunds());
    expect(html).toMatch(/sealed deposit bag/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) THE REMAINING LIMIT, STATED (rule 133f)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-95 · what this slice deliberately does NOT do", () => {
  it("the service says it clears against the pool, not against named sessions", () => {
    // One bank credit can cover a bag holding several shifts, and nothing in
    // the feed says how it was composed. Attributing it would be invention.
    expect(read(SERVICE)).toMatch(/DELIBERATE LIMIT/);
    expect(read(SERVICE)).toMatch(/POOL|pool/);
  });

  it("nothing here posts the vault leg or the ATM leg", () => {
    const src = stripComments(read(CORE));
    expect(src).not.toContain("10100");
    expect(src).not.toContain("10300");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9) books-96 — D-76: THE POOL MUST AGE OUT
 *
 * books-95 shipped a working deposit and an unusable one. The credit was a
 * single lump, so nothing retired a banked day; the pool's oldest date only
 * ever got older, and after a month every deposit was refused as too old. The
 * feature passed its tests and would have failed in the shop.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-96 · a banked day leaves the pool", () => {
  it("D-76: a fully cleared day stops setting the pool's age", async () => {
    // THE DEFECT, REPRODUCED AGAINST THE READER. Jan 5 was counted and banked;
    // Nov 2 is still waiting. Before this slice the pool reported Jan 5 as its
    // oldest cash forever, because the credit never cancelled the debit.
    LINES = [
      {
        amount_cents: 50_000,
        gl_journals: { status: "posted", journal_date: "2026-01-05" },
      },
      {
        amount_cents: -50_000,
        description: clearedDayDescription("2026-01-05"),
        gl_journals: { status: "posted", journal_date: "2026-01-20" },
      },
      {
        amount_cents: 30_000,
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.oldestDate).toBe("2026-11-02");
    expect(pool?.balanceMinor).toBe(30_000);
    // and the settled day is gone entirely, not carried as a zero
    expect(pool?.days.map((d) => d.date)).toEqual(["2026-11-02"]);
  });

  it("the credit is bucketed by the day it CLEARED, not the day it banked", async () => {
    // The distinction the whole fix rests on. Both lines below are Jan 5 cash;
    // the credit's JOURNAL date is Jan 20. If the reader used the journal date
    // the two would never cancel and Jan 5 would stay open forever.
    LINES = [
      {
        amount_cents: 50_000,
        gl_journals: { status: "posted", journal_date: "2026-01-05" },
      },
      {
        amount_cents: -50_000,
        description: clearedDayDescription("2026-01-05"),
        gl_journals: { status: "posted", journal_date: "2026-01-20" },
      },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.balanceMinor).toBe(0);
    expect(pool?.days).toEqual([]);
    expect(pool?.oldestDate).toBeNull();
  });

  it("a credit with no marker falls back to its journal date, and says so", async () => {
    // Rule 133f: books-95's lumped credits exist in no real ledger yet, but the
    // code path is reachable and must not silently vanish money. Without a
    // marker the only date the line has is the journal's, and using it is a
    // stated fallback rather than a guess.
    LINES = [
      {
        amount_cents: 50_000,
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
      {
        amount_cents: -50_000,
        description: "Till cash cleared out of Undeposited Funds",
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.balanceMinor).toBe(0);
  });

  it("a day banked for MORE than it held is reported, never netted away", async () => {
    // Rule 135. Nov 1 is over-cleared by $100 and Nov 2 holds $100. The total
    // is a perfectly innocent zero; the day-by-day view is not.
    LINES = [
      {
        amount_cents: -10_000,
        description: clearedDayDescription("2026-11-01"),
        gl_journals: { status: "posted", journal_date: "2026-11-03" },
      },
      {
        amount_cents: 10_000,
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.negativeDays.map((d) => d.date)).toEqual(["2026-11-01"]);
    expect(pool?.balanceMinor).toBe(0);
  });

  it("and the service refuses to clear against a pool that contradicts itself", async () => {
    LINES = [
      {
        amount_cents: -10_000,
        description: clearedDayDescription("2026-11-01"),
        gl_journals: { status: "posted", journal_date: "2026-11-03" },
      },
      {
        amount_cents: 60_000,
        gl_journals: { status: "posted", journal_date: "2026-11-02" },
      },
    ];
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.code).toBe("DEPOSIT_POOL_NOT_POSITIVE");
      // it must name the offending day, or nobody can go and fix it
      expect(o.message).toContain("2026-11-01");
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("a line with no date at all is a NULL read, not a day called undefined", async () => {
    // Rule 46. Bucketing money under a missing date would put real cash on a
    // day that does not exist, and the total would still look right.
    LINES = [
      {
        amount_cents: 50_000,
        description: null,
        gl_journals: {
          status: "posted",
          journal_date: null as unknown as string,
        },
      },
    ];
    expect(await undepositedBalanceMinor()).toBeNull();
  });

  it("the query actually ASKS for `description`", async () => {
    // The other half of the guard below. That test proves the service copes
    // when the column is absent; this one proves it never asks for a row
    // shape that would make the column absent in the first place.
    await undepositedBalanceMinor();
    expect(String(LAST_QUERY["select"])).toContain("description");
  });

  it("a SELECT that forgot `description` is a failed read, not a silent relapse", async () => {
    // THE DOOR THIS FIX CLOSES. Drop the column and every credit loses its
    // marker, falls back to its journal date, never cancels its debit, and the
    // pool ages forever again - D-76 wearing the face of correct arithmetic.
    // Rule 46: that is a question, so it comes back null and nothing posts.
    DROP_COLUMN = true;
    expect(await undepositedBalanceMinor()).toBeNull();
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("refused");
    expect(submit).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10) books-96 — ONE CREDIT PER BUSINESS DAY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-96 · the deposit names the days it banked", () => {
  const threeDays = () =>
    days(["2026-11-01", 30_000], ["2026-11-02", 10_000], ["2026-11-03", 10_000]);

  it("a bag covering three days writes three credits, not one lump", () => {
    const r = mustJournal(buildDepositClearingJournal(input({ days: threeDays() })));
    const credits = r.journal.lines.filter((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    expect(credits).toHaveLength(3);
    expect(credits.map((l) => parseClearedDay(l.description))).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("and the whole entry still balances", () => {
    const r = mustJournal(buildDepositClearingJournal(input({ days: threeDays() })));
    expect(r.journal.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    expect(amountOn(r, BANK_OPERATING_ACCOUNT)).toBe(50_000);
    expect(amountOn(r, UNDEPOSITED_ACCOUNT)).toBe(-50_000);
  });

  it("no line is ever zero — the schema forbids it", () => {
    // `gl_journal_lines.amount_cents` carries a `<> 0` check. A day worth
    // nothing would be rejected by the database at post time, which is a
    // 500 error on a real deposit rather than a sentence anyone can read.
    const r = mustJournal(buildDepositClearingJournal(input({ days: threeDays() })));
    expect(r.journal.lines.every((l) => l.amountCents !== 0)).toBe(true);
  });

  it("line numbers stay unique as the credits multiply", () => {
    const r = mustJournal(buildDepositClearingJournal(input({ days: threeDays() })));
    const nos = r.journal.lines.map((l) => l.lineNo);
    expect(new Set(nos).size).toBe(nos.length);
  });

  it("OLDEST FIRST: a short deposit takes the oldest day, not the newest", () => {
    // If this ever flipped, every total in the system would stay correct and
    // the pool would age forever — D-76 wearing a different hat.
    const r = mustJournal(
      buildDepositClearingJournal(
        input({ row: row({ amountCents: -30_000 }), days: threeDays() }),
      ),
    );
    const credits = r.journal.lines.filter((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    expect(credits).toHaveLength(1);
    expect(parseClearedDay(credits[0].description)).toBe("2026-11-01");
    expect(r.allocation.oldestOpenDate).toBe("2026-11-02");
  });

  it("the sentence the owner reads names the same days as the lines", () => {
    // Two renderings of one fact. If they can drift, one of them is a lie.
    const r = mustJournal(buildDepositClearingJournal(input({ days: threeDays() })));
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
      expect(r.explanation).toContain(d);
    }
  });

  it("the credits reach the LEDGER, not just the return value", async () => {
    LINES = [
      { amount_cents: 30_000, gl_journals: { status: "posted", journal_date: "2026-11-01" } },
      { amount_cents: 20_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
    ];
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("posted");
    const sent = submit.mock.calls[0][0] as unknown as {
      lines: Array<{ accountCode: string; amountCents: number; description: string }>;
    };
    const credits = sent.lines.filter((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    expect(credits).toHaveLength(2);
    expect(credits.map((l) => l.description)).toEqual([
      clearedDayDescription("2026-11-01"),
      clearedDayDescription("2026-11-02"),
    ]);
    if (o.kind === "posted") {
      expect(o.clearedDays).toEqual(["2026-11-01", "2026-11-02"]);
    }
  });

  it("what this entry writes, the reader can read back", async () => {
    // THE LOOP, CLOSED (rule 140). The credits produced by the builder are fed
    // straight back through the pool reader. If the marker the writer emits and
    // the marker the reader parses ever diverge, this fails — and nothing else
    // would, because each side is self-consistent.
    const r = mustJournal(
      buildDepositClearingJournal(input({ days: days(["2026-11-02", 50_000]) })),
    );
    LINES = [
      { amount_cents: 50_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
      ...r.journal.lines
        .filter((l) => l.accountCode === UNDEPOSITED_ACCOUNT)
        .map((l) => ({
          amount_cents: l.amountCents,
          description: l.description,
          gl_journals: { status: "posted", journal_date: r.journal.journalDate },
        })),
    ];
    const pool = await undepositedBalanceMinor();
    expect(pool?.balanceMinor).toBe(0);
    expect(pool?.oldestDate).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11) books-96 — THE WARNING THAT POSTS
 *
 * Michael, verbatim: "For question 1, post with a warning."
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-96 · aged cash posts with a warning", () => {
  const aged = () => input({ days: days(["2026-08-01", 50_000]) });

  it("cash older than the 30-day window POSTS — it is no longer refused", () => {
    // books-95 refused this outright. The owner overruled it, and the reason
    // matters: refusing a deposit that really happened does not un-happen it,
    // it just sends the money somewhere it does not belong.
    const r = buildDepositClearingJournal(aged());
    expect(r.kind).toBe("journal");
  });

  it("and it carries a warning that says why it is odd", () => {
    const r = mustJournal(buildDepositClearingJournal(aged()));
    expect(r.warnings.map((w) => w.code)).toContain("DEPOSIT_AGED_PAST_WINDOW");
    expect(r.warnings[0].message).toContain("2026-08-01");
    expect(r.warnings[0].message).toMatch(/94 days/);
  });

  it("the warning survives on the JOURNAL, not only on the screen", () => {
    // A warning that lives in a banner is gone when the banner closes. The
    // ledger is the thing anyone will still be reading in a year.
    const r = mustJournal(buildDepositClearingJournal(aged()));
    expect(r.journal.memo).toContain("DEPOSIT_AGED_PAST_WINDOW");
  });

  it("an ordinary same-week deposit is NOT warned about", () => {
    // Rule 135 in the other direction: if everything warns, nothing does.
    const r = mustJournal(buildDepositClearingJournal(input()));
    expect(r.warnings).toEqual([]);
    expect(r.journal.memo).not.toContain("[");
  });

  it("banking part of a day warns that a bag was split", () => {
    // Under the owner's stated procedure — one sealed bag per business day —
    // this cannot happen by accident, so it is worth a sentence.
    const r = mustJournal(
      buildDepositClearingJournal(
        input({ row: row({ amountCents: -20_000 }), days: days(["2026-11-02", 50_000]) }),
      ),
    );
    expect(r.warnings.map((w) => w.code)).toContain("DEPOSIT_SPLITS_A_DAY");
    expect(r.warnings[0].message).toContain("$200.00");
    expect(r.warnings[0].message).toContain("$500.00");
  });

  it("a whole-day bag does NOT trip the split warning", () => {
    const r = mustJournal(
      buildDepositClearingJournal(input({ days: days(["2026-11-02", 50_000]) })),
    );
    expect(r.warnings.map((w) => w.code)).not.toContain("DEPOSIT_SPLITS_A_DAY");
  });

  it("the service posts the aged deposit and hands the warning on", async () => {
    LINES = [
      { amount_cents: 50_000, gl_journals: { status: "posted", journal_date: "2026-08-01" } },
    ];
    const o = await clearDepositForBankRow(row(), "deposit_of_sales");
    expect(o.kind).toBe("posted");
    expect(submit).toHaveBeenCalledTimes(1);
    if (o.kind === "posted") {
      expect(o.warnings.map((w) => w.code)).toContain("DEPOSIT_AGED_PAST_WINDOW");
    }
  });

  it("the sentence leads with the posting and follows with the caveat", async () => {
    // It posted. A sentence that led with the complaint would read like a
    // failure and send someone looking for a problem already handled.
    LINES = [
      { amount_cents: 50_000, gl_journals: { status: "posted", journal_date: "2026-08-01" } },
    ];
    const said = describeDepositOutcome(
      await clearDepositForBankRow(row(), "deposit_of_sales"),
    );
    expect(said).toMatch(/reached the bank/i);
    expect(said).toMatch(/worth a look/i);
    expect(said.indexOf("reached the bank")).toBeLessThan(said.indexOf("Worth a look"));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12) books-96 — THE LIMITS THE OWNER SET
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-96 · no home safe, by decision", () => {
  it("no intermediate cash account was invented between the drawer and the bank", () => {
    // Michael: "I don't want to include the home safe... I don't want to add
    // complexity by routing money around before it hits the bank." An account
    // for a place the money no longer goes would be a second 10400 with the
    // same one-way defect.
    const src = stripComments(read(CORE)) + stripComments(read(SERVICE));
    expect(src).not.toContain("10150");
    expect(src).not.toMatch(/home_?safe/i);
  });

  it("the deposit still moves cash from 10400 to 10200 and nowhere else", () => {
    const r = mustJournal(
      buildDepositClearingJournal(
        input({ days: days(["2026-11-01", 30_000], ["2026-11-02", 20_000]) }),
      ),
    );
    const accounts = new Set(r.journal.lines.map((l) => l.accountCode));
    expect([...accounts].sort()).toEqual([BANK_OPERATING_ACCOUNT, UNDEPOSITED_ACCOUNT].sort());
  });

  it("the marker is one string, defined once", () => {
    // If the writer and the reader ever hold separate copies of this prefix,
    // they can drift apart and every test on each side still passes.
    expect(clearedDayDescription("2026-11-02")).toBe(`${CLEARED_DAY_PREFIX}2026-11-02`);
    expect(parseClearedDay(clearedDayDescription("2026-11-02"))).toBe("2026-11-02");
  });

  it("the FIFO split always accounts for every cent it was given", () => {
    // WHY THIS IS A PROPERTY AND NOT AN EXAMPLE. The builder carries a guard
    // for a split that does not add up (DEPOSIT_ALLOCATION_MISMATCH). A
    // mutation probe showed that guard can never fire: once the pool is all
    // positive and the deposit is no larger than the pool, FIFO cannot come up
    // short. Rule 138 says an equivalent mutant is replaced rather than
    // tolerated, and rule 133f says a dead end must SAY SO - so the guard is
    // documented as belt-and-braces and the invariant behind it is asserted
    // directly here, over many shapes rather than one.
    let worstGap = 0;
    for (let i = 0; i < 2_000; i++) {
      const n = 1 + (i % 5);
      const pool = Array.from({ length: n }, (_, k) => ({
        date: `2026-11-${String(k + 1).padStart(2, "0")}`,
        amountMinor: 1 + ((i * 7 + k * 13) % 997),
        sourceRef: `till-close:${k}`,
      }));
      const total = pool.reduce((a, d) => a + d.amountMinor, 0);
      const deposit = 1 + ((i * 31) % total);
      const r = buildDepositClearingJournal(
        input({ row: row({ amountCents: -deposit }), days: pool }),
      );
      const j = mustJournal(r);
      worstGap = Math.max(worstGap, Math.abs(j.allocation.appliedMinor - deposit));
      // and the entry balances, every time
      expect(j.journal.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    }
    expect(worstGap).toBe(0);
  });

  it("a malformed marker is refused rather than half-read", () => {
    expect(parseClearedDay(`${CLEARED_DAY_PREFIX}2026-1-1`)).toBeNull();
    expect(parseClearedDay("something else entirely")).toBeNull();
    expect(parseClearedDay(null)).toBeNull();
  });
});
