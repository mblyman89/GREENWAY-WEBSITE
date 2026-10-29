/**
 * tests/compliance/fix-p2-5-cash-to-bank.test.ts
 *
 * Fix Phase 2.5 (G-14; F-03-1, F-03-3). Owner message 4, verbatim:
 * "…post drops, then deposit-to-bank books, then deposit bag screen and
 * end-of-day sheet."
 *
 * Owner D25, verbatim: "anyone can seal the bag, I am the only one to take
 * cash to the bank".
 *
 * What this slice proves:
 *   1. The bank-deposit clearing poster (books-95) finally has a caller, it is
 *      owner-only, and only the transaction id comes from the browser.
 *   2. The door refuses a deposit into any account whose role is not `main`,
 *      because the entry debits 10200 Bank - Operating.
 *   3. A failed read is reported as a failure, never as "no deposits".
 *   4. The stale "a drawer close fills 10400" text is gone (F-03-1).
 *   5. The census tells the truth: clearing reachable via the real door, the
 *      seal still MISSING until the bag screen (Phase 2.6) wires it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── mocks ────────────────────────────────────────────────────────────────────
const clearMock = vi.fn(async (row: { transactionId: string }, kind: string) => ({
  kind: "posted" as const,
  transactionId: row.transactionId,
  sourceRef: `deposit-clear:${row.transactionId}`,
  journalId: "j1",
  journalNo: 7,
  outcome: "created",
  code: "GL_AUTOPOST_OK",
  message: `posted as ${kind}`,
  warnings: [],
  clearedDays: ["2026-11-02"],
}));

vi.mock("@/lib/accounting/deposit-clearing-service", () => ({
  clearDepositForBankRow: (...a: unknown[]) =>
    clearMock(...(a as [{ transactionId: string }, string])),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

type Tables = Record<string, Record<string, unknown>[]>;
let TABLES: Tables = {};
let FAIL_TABLE: string | null = null;
const QUERIES: Array<{ table: string; filters: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const preds: Array<(r: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {};
      const chain = (k: string, f: (col: string, v: unknown) => (r: Record<string, unknown>) => boolean) =>
        (col: string, v: unknown) => {
          filters[`${k}:${col}`] = v;
          preds.push(f(col, v));
          return q;
        };
      const run = () => {
        QUERIES.push({ table, filters });
        if (FAIL_TABLE === table) return { data: null, error: { message: "boom" } };
        return { data: (TABLES[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null };
      };
      Object.assign(q, {
        select: () => q,
        eq: chain("eq", (c, v) => (r) => r[c] === v),
        in: chain("in", (c, v) => (r) => (v as unknown[]).includes(r[c])),
        lt: chain("lt", (c, v) => (r) => (r[c] as number) < (v as number)),
        gte: chain("gte", (c, v) => (r) => String(r[c]) >= String(v)),
        like: chain("like", (c, v) => (r) => String(r[c]).startsWith(String(v).replace("%", ""))),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const r = run();
          return { data: r.data ? (r.data[0] ?? null) : null, error: r.error };
        },
        then: (resolve: (x: unknown) => unknown) => resolve(run()),
      });
      return q;
    },
  }),
}));

import {
  checkDepositAccountRole,
  planDepositCandidates,
  clearedTransactionId,
  lookbackStart,
  __runBankDepositDoorTests,
  DEPOSIT_ACCOUNT_ROLE,
  SALES_DEPOSIT_EVENT_KIND,
} from "@/lib/accounting/bank-deposit-door-core";
import {
  clearBankDepositLine,
  listDepositCandidates,
} from "@/lib/accounting/bank-deposit-door-service";
import { ROLE_TO_CASH_ACCOUNT } from "@/lib/accounting/bank-expense-core";
import { BANK_OPERATING_ACCOUNT, depositSourceRef } from "@/lib/accounting/deposit-clearing-core";
import { LEDGER_CENSUS_ROWS as LEDGER_CENSUS } from "@/lib/accounting/ledger-census-data";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const TXN = {
  transaction_id: "t-dep",
  account_id: "acct-main",
  amount_cents: -48_000,
  date: "2026-11-03",
  name: "COUNTER DEPOSIT",
  merchant_name: null,
  pending: false,
  removed: false,
  personal_finance_category_primary: "TRANSFER_IN",
};

beforeEach(() => {
  clearMock.mockClear();
  FAIL_TABLE = null;
  QUERIES.length = 0;
  TABLES = {
    plaid_accounts: [
      { account_id: "acct-main", role: "main", active: true },
      { account_id: "acct-atm", role: "atm", active: true },
    ],
    plaid_transactions: [
      TXN,
      { ...TXN, transaction_id: "t-atm", account_id: "acct-atm" },
      { ...TXN, transaction_id: "t-out", amount_cents: 2_500 },
    ],
    gl_journals: [{ source_ref: depositSourceRef("t-old"), status: "posted" }],
  };
});

/* ── 1. the pure core ─────────────────────────────────────────────────────── */

describe("Phase 2.5 · the door's pure decisions", () => {
  it("the self-test runs clean", () => {
    expect(() => __runBankDepositDoorTests()).not.toThrow();
  });

  it("the only role it accepts is the one whose chart account is 10200", () => {
    // Not a second list of roles: the same table the expense engine uses.
    expect(ROLE_TO_CASH_ACCOUNT[DEPOSIT_ACCOUNT_ROLE]).toBe(BANK_OPERATING_ACCOUNT);
    expect(checkDepositAccountRole("main")).toBeNull();
    for (const r of ["atm", "credit", "savings"]) {
      expect(checkDepositAccountRole(r)?.code).toBe("DEPOSIT_ACCOUNT_NOT_MAIN");
    }
    expect(checkDepositAccountRole(null)?.code).toBe("DEPOSIT_ACCOUNT_NO_ROLE");
  });

  it("asserts the sales-deposit kind, the only kind the clearing core accepts", () => {
    expect(SALES_DEPOSIT_EVENT_KIND).toBe("deposit_of_sales");
  });

  it("shows money in only, settled, not removed, after cutover; marks cleared lines", () => {
    const base = {
      transactionId: "x",
      accountId: "a",
      amountCents: -100,
      date: "2026-11-02",
      name: null,
      merchantName: null,
      pending: false,
      removed: false,
    };
    const c = planDepositCandidates(
      [base, { ...base, transactionId: "y", amountCents: 100 }],
      [depositSourceRef("x")],
    );
    expect(c.map((r) => r.transactionId)).toEqual(["x"]);
    expect(c[0].alreadyCleared).toBe(true);
    expect(c[0].depositMinor).toBe(100);
  });

  it("reads a clearing source ref back to its transaction", () => {
    expect(clearedTransactionId("deposit-clear:abc")).toBe("abc");
    expect(clearedTransactionId("seal-bag:abc")).toBeNull();
  });

  it("the look-back window is stated arithmetic", () => {
    expect(lookbackStart("2026-12-31", 60)).toBe("2026-11-01");
  });
});

/* ── 2. the door service ──────────────────────────────────────────────────── */

describe("Phase 2.5 · clearBankDepositLine", () => {
  it("re-reads the line by id and calls the poster with deposit_of_sales", async () => {
    const o = await clearBankDepositLine("t-dep");
    expect(o.kind).toBe("posted");
    expect(clearMock).toHaveBeenCalledTimes(1);
    const [row, kind] = clearMock.mock.calls[0];
    expect(kind).toBe("deposit_of_sales");
    // The amount came from the database, not the caller.
    expect((row as unknown as { amountCents: number }).amountCents).toBe(-48_000);
    expect((row as unknown as { accountId: string }).accountId).toBe("acct-main");
  });

  it("refuses a deposit into an ATM account by name and posts nothing", async () => {
    const o = await clearBankDepositLine("t-atm");
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("DEPOSIT_ACCOUNT_NOT_MAIN");
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("refuses an account with no role", async () => {
    TABLES.plaid_accounts[0].role = null;
    const o = await clearBankDepositLine("t-dep");
    if (o.kind !== "refused") throw new Error("expected refusal");
    expect(o.code).toBe("DEPOSIT_ACCOUNT_NO_ROLE");
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("refuses a blank id without reading anything", async () => {
    const o = await clearBankDepositLine("   ");
    if (o.kind !== "refused") throw new Error("expected refusal");
    expect(o.code).toBe("DEPOSIT_NO_LINE");
    expect(QUERIES).toHaveLength(0);
  });

  it("refuses a line that is not in the feed", async () => {
    const o = await clearBankDepositLine("nope");
    if (o.kind !== "refused") throw new Error("expected refusal");
    expect(o.code).toBe("DEPOSIT_LINE_NOT_FOUND");
  });

  it("a failed read of the line is a refusal that says so, not a post", async () => {
    FAIL_TABLE = "plaid_transactions";
    const o = await clearBankDepositLine("t-dep");
    if (o.kind !== "refused") throw new Error("expected refusal");
    expect(o.code).toBe("DEPOSIT_LINE_UNREADABLE");
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("a failed read of the account is a refusal, not a guess at the role", async () => {
    FAIL_TABLE = "plaid_accounts";
    const o = await clearBankDepositLine("t-dep");
    if (o.kind !== "refused") throw new Error("expected refusal");
    expect(o.code).toBe("DEPOSIT_ACCOUNT_UNREADABLE");
    expect(clearMock).not.toHaveBeenCalled();
  });
});

describe("Phase 2.5 · listDepositCandidates", () => {
  it("lists only money-in lines on main accounts", async () => {
    const r = await listDepositCandidates("2026-11-20");
    if (!r.ok) throw new Error(r.error);
    expect(r.candidates.map((c) => c.transactionId)).toEqual(["t-dep"]);
    expect(r.accounts).toBe(1);
  });

  it("marks a line already cleared from the ledger's own source refs", async () => {
    TABLES.gl_journals.push({ source_ref: depositSourceRef("t-dep"), status: "posted" });
    const r = await listDepositCandidates("2026-11-20");
    if (!r.ok) throw new Error(r.error);
    expect(r.candidates[0].alreadyCleared).toBe(true);
  });

  for (const t of ["plaid_accounts", "plaid_transactions", "gl_journals"]) {
    it(`rule 46: a failed read of ${t} is ok:false, never an empty list`, async () => {
      FAIL_TABLE = t;
      const r = await listDepositCandidates("2026-11-20");
      expect(r.ok).toBe(false);
    });
  }

  it("no main account is an honest empty list with zero accounts", async () => {
    TABLES.plaid_accounts = [{ account_id: "acct-atm", role: "atm", active: true }];
    const r = await listDepositCandidates("2026-11-20");
    expect(r).toEqual({ ok: true, candidates: [], accounts: 0 });
  });
});

/* ── 3. the action and the page ───────────────────────────────────────────── */

describe("Phase 2.5 · the owner-only action and the page", () => {
  const ACTION = "src/app/admin/books/bank/actions.ts";
  const PAGE = "src/app/admin/books/bank/page.tsx";
  const PANEL = "src/components/admin/books/ClearBankDepositsPanel.tsx";

  it("the action gates on requireBooksAccess before the door (owner-only, D25)", () => {
    const fn = strip(read(ACTION)).split("export async function clearBankDepositAction")[1];
    expect(fn).toBeDefined();
    expect(fn.indexOf("requireBooksAccess(")).toBeGreaterThan(-1);
    expect(fn.indexOf("requireBooksAccess(")).toBeLessThan(fn.indexOf("clearBankDepositLine("));
  });

  it("the books gate admits the owner role only", () => {
    expect(read("src/lib/accounting/books-access.ts")).toContain("canReadBooks(session.profile.role)");
    expect(read("src/lib/accounting/books-view-core.ts")).toMatch(
      /export function canReadBooks\([^)]*\): boolean \{\s*return role === "owner";/,
    );
  });

  it("the action accepts only a transaction id from the browser", () => {
    const src = read(ACTION);
    expect(src).toMatch(/clearBankDepositAction\(input: \{\s*transactionId: string;\s*\}\)/);
  });

  it("the action audits and refreshes the EOD panel after a posting", () => {
    const src = read(ACTION);
    expect(src).toContain("books.bank_deposit.cleared");
    expect(src).toContain('revalidatePath("/admin/registers/eod")');
  });

  it("the page reads the candidates on the server and renders the panel", () => {
    const src = strip(read(PAGE));
    expect(src).toContain("listDepositCandidates(pacificToday())");
    expect(src).toContain("<ClearBankDepositsPanel");
    expect(src).toContain("readError={depositList.ok ? null : depositList.error}");
  });

  it("the panel tells the owner what NOT to clear", () => {
    expect(read(PANEL)).toMatch(/transfer between your own accounts/);
    expect(read(PANEL)).toMatch(/Pressing twice writes nothing twice/);
  });
});

/* ── 4. F-03-1 stale text ─────────────────────────────────────────────────── */

describe("Phase 2.5 · F-03-1: nothing still says a drawer close fills 10400", () => {
  it("the EOD panel no longer says a drawer close moves cash into 10400", () => {
    const src = read("src/app/admin/registers/eod/UndepositedFunds.tsx");
    expect(src).not.toMatch(/A drawer\s+close moves cash into it/);
    expect(src).toMatch(/Sealing a\s+deposit bag moves cash into it/);
    expect(src).not.toMatch(/Every dollar counted out of a drawer/);
  });

  it("the clearing refusal names unsealed bags, not unreconciled drawers", () => {
    const src = read("src/lib/accounting/deposit-clearing-core.ts");
    expect(src).not.toContain("drawer closes have not been");
    expect(src).toContain("deposit bags have not been sealed");
  });

  it("the file headers state the D-77 correction", () => {
    for (const f of [
      "src/lib/accounting/deposit-clearing-core.ts",
      "src/lib/accounting/deposit-clearing-service.ts",
      "src/app/admin/registers/eod/UndepositedFunds.tsx",
      "src/lib/registers/drawer-posting-service.ts",
    ]) {
      expect(read(f), f).toMatch(/D-77/);
    }
  });
});

/* ── 5. census ────────────────────────────────────────────────────────────── */

describe("Phase 2.5 · the census tells the truth", () => {
  const row = (k: string) => {
    const r = LEDGER_CENSUS.find((x) => x.key === k);
    if (!r) throw new Error(`no census row ${k}`);
    return r;
  };

  it("bank clearing is reachable through the real door, and says so", () => {
    const r = row("cash_and_banking.cash_deposit_to_bank");
    expect(r.layers.reachable.status).toBe("PRESENT");
    expect(r.layers.reachable.evidence).toContain("clearBankDepositAction");
    expect(r.layers.exists.evidence).not.toContain("the drawer count into 10400");
  });

  // STATED: Phase 2.5 pinned the seal as MISSING "until the bag screen wires
  // it". Phase 2.6 built that screen, so the pin now checks the wiring it was
  // waiting for (poster named, reachable through sealBagAction).
  it("the seal is wired by the bag screen (G-14 requirement 3, Phase 2.6)", () => {
    const r = row("cash_and_banking.seal_deposit_bag");
    expect(r.poster).toBe("src/lib/accounting/seal-bag-posting-service.ts#postSealForBag");
    expect(r.layers.reachable.status).toBe("PRESENT");
    expect(r.layers.reachable.evidence).toContain("sealBagAction");
  });
});
