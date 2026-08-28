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
    const plan = planBankExpense(feedLine(), { accountId: "a", role: "main" }, CLASSIFIED);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const [debit, credit] = plan.lines;
    expect(debit.accountCode).toBe("76040");
    expect(debit.amountCents).toBe(2500);
    expect(credit.accountCode).toBe("10200");
    expect(credit.amountCents).toBe(-2500);
  });

  it("balances", () => {
    const plan = planBankExpense(feedLine(), { accountId: "a", role: "main" }, CLASSIFIED);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.lines[0].amountCents + plan.lines[1].amountCents).toBe(0);
  });

  // If this ever passes, every refund and deposit in the feed books as an
  // expense -- and it balances, so nothing complains.
  it("REFUSES a negative amount, which is money coming IN", () => {
    const plan = planBankExpense(
      feedLine({ amountCents: -2500 }),
      { accountId: "a", role: "main" },
      CLASSIFIED,
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe("NOT_AN_OUTFLOW");
  });

  it("refuses a zero-dollar row", () => {
    const plan = planBankExpense(
      feedLine({ amountCents: 0 }),
      { accountId: "a", role: "main" },
      CLASSIFIED,
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("ZERO_AMOUNT");
  });
});

describe("bank expense: 280E cost class, both halves of migration 0172 check (7)", () => {
  it("puts a real cost class on the expense line and 'none' on the funding line", () => {
    const plan = planBankExpense(feedLine(), { accountId: "a", role: "main" }, CLASSIFIED);
    if (!plan.ok) throw new Error("expected a plan");
    // requires_cost_class = true on every 7xxxx account -> 'none' is refused.
    expect(plan.lines[0].costClass).toBe("nondeductible_280e");
    // asset/liability lines carrying any class other than 'none' are refused.
    expect(plan.lines[1].costClass).toBe("none");
  });
});

describe("bank expense: the cash side is never guessed", () => {
  it("refuses when the owner has not assigned a role", () => {
    const plan = planBankExpense(feedLine(), { accountId: "a", role: null }, CLASSIFIED);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("CASH_ACCOUNT_UNASSIGNED");
  });

  it("refuses a custom typed role rather than defaulting to the operating account", () => {
    // Migration 0169 relaxed `role` to any 1..32 char key, so this is reachable
    // in production the moment Michael types a role of his own.
    const plan = planBankExpense(feedLine(), { accountId: "a", role: "escrow" }, CLASSIFIED);
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
      { accountId: "a", role: "main" },
      classified({ account: "79010", entity: "personal", costClass: "personal" }),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("PERSONAL_ON_BUSINESS_ACCOUNT");
  });

  it("refuses an entity the funding account is restricted away from", () => {
    // 0173 seeds 10300 as array['atm','greenway'].
    const plan = planBankExpense(
      feedLine(),
      { accountId: "a", role: "atm" },
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
      { accountId: "a", role: "main" },
      classified({ entity: "landholding", costClass: "separate_business" }),
    );
    expect(plan.ok).toBe(true);
  });
});

describe("bank expense: refusals are carried, never swallowed", () => {
  it("passes the classifier's own code through", () => {
    const plan = planBankExpense(feedLine(), { accountId: "a", role: "main" }, {
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
      { accountId: "a", role: null },
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
      { accountId: "a", role: "main" },
      CLASSIFIED,
    );
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.sourceRef).toBe("txn_stable_99");
  });

  it("dates the entry to the bank's date, not today", () => {
    const plan = planBankExpense(
      feedLine({ date: "2026-01-09" }),
      { accountId: "a", role: "main" },
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
 * THE D-67 GATE.
 *
 * Not a test of this slice's code -- a test of the step that comes after it.
 * Every entry this wire creates is a draft, and at the time of writing nothing
 * in the application can approve or post a draft. That is D-67.
 *
 * This test asserts the CURRENT, MEASURED position. It is written to FAIL the
 * day somebody wires an approval path, and that is deliberate: the failure is
 * the reminder to go and close D-67 rather than let a stale HIGH-severity entry
 * sit in the register describing a problem that was quietly fixed. A gate that
 * only ever confirms bad news is worth little; this one changes state.
 */
describe("D-67: the approval path still does not exist (fails when it does)", () => {
  const files = execSync(
    "grep -rl 'approveJournal\\|gl_post_journal' src/ --include=*.ts --include=*.tsx || true",
    { encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  it("has no caller of approveJournal or gl_post_journal outside posting-service itself", () => {
    // posting-service.ts DEFINES approveJournal; a mere mention in a comment
    // elsewhere is not a caller. Anything else in src/ that references these is
    // a real wiring attempt and should flip this test.
    const callers = files.filter((f) => !f.endsWith("posting-service.ts"));
    const realCallers = callers.filter((f) => {
      const body = readFileSync(f, "utf8");
      return /\bapproveJournal\s*\(/.test(body) || /gl_post_journal["']/.test(body);
    });
    expect(realCallers).toEqual([]);
  });

  it("has no screen that lists drafts from gl_journals", () => {
    const pages = execSync(
      "grep -rl 'gl_journals' src/app --include=*.tsx --include=*.ts || true",
      { encoding: "utf8" },
    ).trim();
    expect(pages).toBe("");
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
