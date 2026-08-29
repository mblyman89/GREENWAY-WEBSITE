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
let LINES: Array<{ amount_cents: number; gl_journals: { status: string; journal_date: string } }> = [];
let READ_FAILS = false;
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
      select: () => q,
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
      );
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

function input(over: Partial<DepositInput> = {}): DepositInput {
  return {
    row: row(),
    eventKind: "deposit_of_sales",
    undepositedBalanceMinor: 50_000,
    oldestUndepositedDate: "2026-11-02",
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
  LAST_QUERY = {};
  LINES = [
    { amount_cents: 50_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
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
    ["an empty pool", { undepositedBalanceMinor: 0 }, "DEPOSIT_NOTHING_UNDEPOSITED"],
    ["more than was counted", { undepositedBalanceMinor: 10_000 }, "DEPOSIT_EXCEEDS_UNDEPOSITED"],
    ["a pairing 30+ days apart", { oldestUndepositedDate: "2026-08-01" }, "DEPOSIT_DATE_TOO_FAR"],
    ["a bank row already used", { alreadyMatched: true }, "DEPOSIT_ALREADY_MATCHED"],
    ["an unreadable date", { oldestUndepositedDate: "" }, "DEPOSIT_INVALID_DATE"],
  ];

  for (const [label, over, code] of cases) {
    it(`${label} is refused with ${code}`, () => {
      expect(mustRefuse(buildDepositClearingJournal(input(over))).code).toBe(code);
    });
  }

  it("banking EXACTLY what was counted is allowed", () => {
    // `>` versus `>=` differ by precisely the everyday case.
    expect(buildDepositClearingJournal(input({ undepositedBalanceMinor: 50_000 })).kind)
      .toBe("journal");
  });

  it("ONE CENT more than was counted is refused", () => {
    // The boundary from the other side. Without this, the over-clear guard can
    // be loosened by a single cent and every test still passes -- and a single
    // cent is enough to prove 10400 is allowed to go negative, which is the
    // whole thing the guard exists to prevent.
    const r = buildDepositClearingJournal(
      input({ row: row({ amountCents: -50_001 }), undepositedBalanceMinor: 50_000 }),
    );
    expect(mustRefuse(r).code).toBe("DEPOSIT_EXCEEDS_UNDEPOSITED");
  });

  it("a fractional POOL balance is refused, not silently rounded", () => {
    // The row amount and the pool are two different numbers and each needs its
    // own whole-cent check. A fractional pool means the ledger read returned
    // something that is not money, and guessing which way to round it would
    // invent or destroy a cent of somebody's cash.
    const r = buildDepositClearingJournal(input({ undepositedBalanceMinor: 50_000.5 }));
    expect(mustRefuse(r).code).toBe("DEPOSIT_NON_INTEGER_CENTS");
  });

  it("the too-large refusal shows BOTH figures, so the gap is obvious", () => {
    const r = mustRefuse(
      buildDepositClearingJournal(input({ undepositedBalanceMinor: 10_000 })),
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
      buildDepositClearingJournal(input({ undepositedBalanceMinor: 80_000 })),
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
    // 30-day refusal on money that is only days old.
    LINES = [
      { amount_cents: -40_000, gl_journals: { status: "posted", journal_date: "2026-01-05" } },
      { amount_cents: 50_000, gl_journals: { status: "posted", journal_date: "2026-11-02" } },
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
      { kind: "posted", transactionId: "t", sourceRef: "r", journalId: "j", journalNo: 1, outcome: "created", code: "C", message: "money arrived" },
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
