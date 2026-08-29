/**
 * tests/compliance/bank-expense-core.test.ts
 *
 * Guards the decisions in the bank-expense wire (D-56 / D-37).
 *
 * The theme: EVERY failure mode here still balances. A reversed sign, a wrong
 * funding account, a personal charge on the business card -- none of them make
 * debits differ from credits, so none of them turn anything red. These tests
 * are the only thing standing between a plausible-looking entry and a wrong
 * tax return.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  planBankExpense,
  resolveCashAccount,
  merchantTextFor,
  ROLE_TO_CASH_ACCOUNT,
  ALL_BANK_EXPENSE_REFUSAL_CODES,
  __runBankExpenseCoreTests,
  type BankFeedLine,
} from "@/lib/accounting/bank-expense-core";
import type { ExpenseClassification } from "@/lib/accounting/expense-classification-core";

const CLASSIFIED: ExpenseClassification = {
  ok: true,
  account: "76040",
  entity: "greenway",
  costClass: "nondeductible_280e",
  matchedValue: "TIMBERLAND",
  matchKind: "merchant_contains",
  normalized: "TIMBERLAND BANK FEE",
};

/** Keeps the ok:true arm pinned; a bare spread widens it to the whole union. */
function classified(
  over: Partial<Extract<ExpenseClassification, { ok: true }>> = {},
): ExpenseClassification {
  return { ...(CLASSIFIED as Extract<ExpenseClassification, { ok: true }>), ...over };
}

/**
 * A funding account with its books already set (migration 0213).
 *
 * books-101 made the ENTITY of a posted expense come from the ACCOUNT rather
 * than the merchant rule (D-80), so an account with no books refuses outright.
 * Defaulting to "greenway" here keeps every test below aimed at the thing it
 * was written to prove; the refusals for an UNCLASSIFIED and a PERSONAL account
 * get their own tests rather than being smuggled into all of these.
 */
function funding(
  role: string | null,
  booksEntity: string | null = "greenway",
): { accountId: string; role: string | null; booksEntity: string | null } {
  return { accountId: "a", role, booksEntity };
}

function feedLine(over: Partial<BankFeedLine> = {}): BankFeedLine {
  return {
    transactionId: "txn_abc",
    amountCents: 2500,
    date: "2026-11-03",
    merchantName: "Timberland Bank",
    name: "TIMBERLAND BANK FEE",
    pending: false,
    ...over,
  };
}

describe("bank expense: the sign convention", () => {
  // plaid-money-core.ts:18-20 -- POSITIVE = money LEFT the account.
  it("books a POSITIVE Plaid amount as a DEBIT to the expense account", () => {
    const plan = planBankExpense(feedLine(), funding("main"), CLASSIFIED);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const [debit, credit] = plan.lines;
    expect(debit.accountCode).toBe("76040");
    expect(debit.amountCents).toBe(2500);
    expect(credit.accountCode).toBe("10200");
    expect(credit.amountCents).toBe(-2500);
  });

  it("balances", () => {
    const plan = planBankExpense(feedLine(), funding("main"), CLASSIFIED);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.lines[0].amountCents + plan.lines[1].amountCents).toBe(0);
  });

  // If this ever passes, every refund and deposit in the feed books as an
  // expense -- and it balances, so nothing complains.
  it("REFUSES a negative amount, which is money coming IN", () => {
    const plan = planBankExpense(
      feedLine({ amountCents: -2500 }),
      funding("main"),
      CLASSIFIED,
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe("NOT_AN_OUTFLOW");
  });

  it("refuses a zero-dollar row", () => {
    const plan = planBankExpense(
      feedLine({ amountCents: 0 }),
      funding("main"),
      CLASSIFIED,
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("ZERO_AMOUNT");
  });
});

describe("bank expense: 280E cost class, both halves of migration 0172 check (7)", () => {
  it("puts a real cost class on the expense line and 'none' on the funding line", () => {
    const plan = planBankExpense(feedLine(), funding("main"), CLASSIFIED);
    if (!plan.ok) throw new Error("expected a plan");
    // requires_cost_class = true on every 7xxxx account -> 'none' is refused.
    expect(plan.lines[0].costClass).toBe("nondeductible_280e");
    // asset/liability lines carrying any class other than 'none' are refused.
    expect(plan.lines[1].costClass).toBe("none");
  });
});

describe("bank expense: the cash side is never guessed", () => {
  it("refuses when the owner has not assigned a role", () => {
    const plan = planBankExpense(feedLine(), funding(null), CLASSIFIED);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("CASH_ACCOUNT_UNASSIGNED");
  });

  it("refuses a custom typed role rather than defaulting to the operating account", () => {
    // Migration 0169 relaxed `role` to any 1..32 char key, so this is reachable
    // in production the moment Michael types a role of his own.
    const plan = planBankExpense(feedLine(), funding("escrow"), CLASSIFIED);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.code).toBe("CASH_ACCOUNT_UNMAPPED");
      expect(plan.message).toContain("escrow");
    }
  });

  it("maps only the three roles the chart has accounts for", () => {
    expect(ROLE_TO_CASH_ACCOUNT).toEqual({ main: "10200", atm: "10300", credit: "33000" });
  });

  it("matches the role case-insensitively and trimmed", () => {
    const r = resolveCashAccount({ accountId: "a", role: "  MAIN  " });
    expect(r.ok && r.accountCode).toBe("10200");
  });
});

describe("bank expense: entity discipline", () => {
  it("refuses a personal charge funded from a business bank account", () => {
    const plan = planBankExpense(
      feedLine(),
      funding("main"),
      classified({ account: "79010", entity: "personal", costClass: "personal" }),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("PERSONAL_ON_BUSINESS_ACCOUNT");
  });

  it("refuses an entity the funding account is restricted away from", () => {
    // 0173 seeds 10300 as array['atm','greenway'].
    // The ACCOUNT agrees it is landholding, so books-101's account-vs-merchant
    // check passes cleanly and what is left under test is the CHART's own
    // restriction, which is the point of this test.
    const plan = planBankExpense(
      feedLine(),
      funding("atm", "landholding"),
      classified({ entity: "landholding", costClass: "separate_business" }),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("ENTITY_MISMATCH");
  });

  it("allows an unrestricted funding account to serve any entity", () => {
    // 10200 has allowed_entity_codes = null in the chart. Asserting the
    // restriction is real and not blanket.
    const plan = planBankExpense(
      feedLine(),
      funding("main", "landholding"),
      classified({ entity: "landholding", costClass: "separate_business" }),
    );
    expect(plan.ok).toBe(true);
  });
});

describe("bank expense: refusals are carried, never swallowed", () => {
  it("passes the classifier's own code through", () => {
    const plan = planBankExpense(feedLine(), funding("main"), {
      ok: false,
      code: "MERCHANT_AMBIGUOUS",
      message: "Costco could be several accounts.",
      normalized: "COSTCO",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.code).toBe("NOT_CLASSIFIED");
      expect(plan.underlyingCode).toBe("MERCHANT_AMBIGUOUS");
      expect(plan.message).toContain("Costco");
    }
  });

  it("refuses a pending row before anything else", () => {
    // Pending rows change amount AND get replaced by a settled row with a new
    // transaction_id, so posting one both books a stale number and duplicates.
    const plan = planBankExpense(
      feedLine({ pending: true, amountCents: -1 }),
      funding(null),
      CLASSIFIED,
    );
    expect(plan.ok).toBe(false);
    // Pending wins over BOTH the sign problem and the missing role.
    if (!plan.ok) expect(plan.code).toBe("TRANSACTION_PENDING");
  });
});

describe("bank expense: idempotency key", () => {
  it("uses the Plaid transaction id as the source ref", () => {
    // submitJournal is idempotent on (entity, sourceKind, sourceRef). If this
    // is ever anything but the stable transaction id, a re-run double-books.
    const plan = planBankExpense(
      feedLine({ transactionId: "txn_stable_99" }),
      funding("main"),
      CLASSIFIED,
    );
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.sourceRef).toBe("txn_stable_99");
  });

  it("dates the entry to the bank's date, not today", () => {
    const plan = planBankExpense(
      feedLine({ date: "2026-01-09" }),
      funding("main"),
      CLASSIFIED,
    );
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.journalDate).toBe("2026-01-09");
  });
});

describe("bank expense: merchant text", () => {
  it("prefers merchant_name but falls back to the raw descriptor", () => {
    expect(merchantTextFor(feedLine())).toBe("Timberland Bank");
    expect(merchantTextFor(feedLine({ merchantName: null }))).toBe("TIMBERLAND BANK FEE");
    expect(merchantTextFor(feedLine({ merchantName: null, name: null }))).toBeNull();
  });
});

describe("bank expense: the service actually calls the ledger", () => {
  // Rule: assert the CALL, not the import binding. An import can be present
  // while the function is never invoked -- that is exactly how D-56 and D-37
  // stayed open with a finished classifier sitting unused.
  //
  // books-88, D-70 -- READ THIS BEFORE TRUSTING THIS BLOCK. Everything below
  // is true and was true the whole time the feature was dead. It proves the
  // SERVICE calls submitJournal. It does NOT prove anything calls the SERVICE,
  // and for two slices nothing did: Michael refreshed his ATM feed, got no
  // drafts, and found it by hand. Reachability was measured one link too early
  // and the census believed it.
  //
  // Standing rule 50 says invert such a gate rather than delete it, so this
  // block stays exactly as it was and the missing half now lives in
  // tests/compliance/posting-services-are-reachable.test.ts, which walks src/
  // for a real caller of all four posting services. If you add a fifth poster,
  // add it there; passing tests in THIS file mean nothing about whether a
  // human can reach the feature.
  const service = readFileSync("src/lib/accounting/bank-expense-service.ts", "utf8");

  it("invokes submitJournal, not merely imports it", () => {
    expect(service).toContain("await submitJournal(");
  });

  it("invokes classifyExpense on the merchant text", () => {
    expect(service).toContain("classifyExpense({ merchant })");
  });

  it("posts as sourceKind 'bank' so control-account discipline permits 10200", () => {
    // 0172 check (6) blocks control accounts only for source_kind = 'manual'.
    // If this becomes 'manual', every entry is refused GL_CONTROL_ACCOUNT.
    expect(service).toContain("sourceKind: BANK_SOURCE_KIND");
  });

  it("never requests autoPost, so every entry lands as a draft (see D-67)", () => {
    expect(service).not.toContain("autoPost: true");
  });

  it("reads the funding role from the database rather than from a caller", () => {
    expect(service).toContain('.from("plaid_accounts")');
    expect(service).toContain('.eq("removed", false)');
  });
});

/**
 * THE D-67 GATE — NOW INVERTED, DELIBERATELY (slice books-85).
 *
 * WHAT THIS BLOCK USED TO SAY. In books-84 these two tests asserted that the
 * approval path did NOT exist: no caller of approveJournal or gl_post_journal
 * anywhere in src/, and no screen reading gl_journals. That was the true,
 * measured position at the time, and the block was written to FAIL the day
 * somebody wired the path -- so that a stale HIGH-severity defect could not sit
 * in the register describing a problem that had been quietly fixed.
 *
 * IT FIRED. books-85 built approval-core.ts, approval-service.ts and the
 * /admin/books/drafts screen, and both assertions failed exactly as designed.
 * That is the gate working, not the gate being wrong.
 *
 * WHY IT IS INVERTED RATHER THAN DELETED. Deleting it would throw away the only
 * automated statement that the outlet exists at all. The queue had no outlet for
 * six slices precisely because nothing was watching for one. So the same two
 * questions are still asked, with the answers the other way round: there MUST be
 * a real caller, and there MUST be a screen. If a future refactor removes either,
 * D-67 comes straight back and this block says so immediately.
 */
describe("D-67 is closed: the approval path exists (fails if it is ever removed)", () => {
  const files = execSync(
    "grep -rl 'approveJournal\\|gl_post_journal' src/ --include=*.ts --include=*.tsx || true",
    { encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  it("has a real caller of approveJournal or gl_post_journal outside posting-service", () => {
    // posting-service.ts DEFINES approveJournal; a mere mention in a comment
    // elsewhere is not a caller. This looks for an actual call.
    const callers = files.filter((f) => !f.endsWith("posting-service.ts"));
    const realCallers = callers.filter((f) => {
      const body = readFileSync(f, "utf8");
      return /\bapproveJournal\s*\(/.test(body) || /gl_post_journal["']/.test(body);
    });
    expect(realCallers.length).toBeGreaterThan(0);
    expect(realCallers.some((f) => f.includes("approval-service"))).toBe(true);
  });

  it("has a screen that lists drafts waiting to be posted", () => {
    const pages = execSync(
      "grep -rl 'listDraftJournals' src/app --include=*.tsx --include=*.ts || true",
      { encoding: "utf8" },
    ).trim();
    expect(pages).not.toBe("");
    expect(pages).toContain("drafts");
  });

  it("actually EXPORTS the reader that screen imports", () => {
    // A mutation probe found this hole: deleting the `export` keyword from
    // listDraftJournals left the grep above perfectly happy -- the page still
    // MENTIONED the name, it just could no longer import it. The screen would
    // have failed to build while the suite stayed green, which is exactly the
    // kind of test that buys confidence without paying for it (rule 13c).
    //
    // So both ends of the wire are checked: the module must export it, and the
    // page must import it from that module by name.
    const svc = readFileSync("src/lib/accounting/approval-service.ts", "utf8");
    expect(svc).toMatch(/export\s+async\s+function\s+listDraftJournals\s*\(/);
    expect(svc).toMatch(/export\s+async\s+function\s+approveAndPostJournal\s*\(/);

    const page = readFileSync("src/app/admin/books/drafts/page.tsx", "utf8");
    expect(page).toContain("listDraftJournals");
    expect(page).toContain("@/lib/accounting/approval-service");

    // And the button really reaches the service, not a stub.
    const action = readFileSync("src/app/admin/books/drafts/actions.ts", "utf8");
    expect(action).toMatch(/approveAndPostJournal\s*\(/);
  });

  it("posts through the SESSION client, never the admin client", () => {
    // The whole reason D-67 called this hard: gl_approve_journal refuses a null
    // auth.uid(), and gl_post_journal writes posted_by = auth.uid(). The admin
    // client has neither. If this file ever reaches for it, approvals become
    // anonymous or impossible, so the check is here rather than in a comment.
    //
    // The file's own header WARNS against the admin client by name, so a naive
    // substring search matches that warning and fails on a correct file. The
    // check therefore looks at what the module IMPORTS -- prose cannot import
    // anything, and nothing can be called that was not first imported.
    const svc = readFileSync("src/lib/accounting/approval-service.ts", "utf8");
    const imports = svc
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\s/.test(l))
      .join("\n");
    expect(imports).toContain("books-client");
    expect(imports).not.toContain("supabase/admin");
  });
});

describe("bank expense: self-tests", () => {
  it("passes its own registered self-tests", () => {
    expect(() => __runBankExpenseCoreTests()).not.toThrow();
  });

  it("declares every refusal code exactly once", () => {
    expect(new Set(ALL_BANK_EXPENSE_REFUSAL_CODES).size).toBe(
      ALL_BANK_EXPENSE_REFUSAL_CODES.length,
    );
  });
});
