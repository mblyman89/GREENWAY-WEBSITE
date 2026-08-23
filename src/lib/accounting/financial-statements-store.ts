/**
 * src/lib/accounting/financial-statements-store.ts   (books-42)
 *
 * THE ONLY PART OF THE FINANCIAL STATEMENTS THAT TALKS TO THE DATABASE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE OBEYS, AND WHY IT IS WORTH OBEYING
 * ─────────────────────────────────────────────────────────────────────────────
 * This module READS. It does not add, subtract, classify, or decide. Every
 * number it returns is a number the database already had, and every judgement
 * about those numbers happens in `financial-statements-ui-core.ts`, which is
 * pure and therefore testable.
 *
 * The reason is not tidiness. `tests/compliance` cannot reach a database, so
 * ANY arithmetic that lands in this file is arithmetic no test will ever check.
 * A single innocuous-looking `.reduce()` here would be a number on Michael's
 * screen that nothing verifies — and on these particular screens, an unverified
 * number is a tax position.
 *
 * So the division is absolute:
 *
 *     this file          →  fetch rows, hand them over
 *     the ui-core        →  every decision, every total, every refusal
 *     the page           →  markup, and nothing else
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY REFUSES TO INVENT
 * ─────────────────────────────────────────────────────────────────────────────
 * Three of the four statements need facts the database simply does not hold.
 * Nobody has told this system which debts are long-term, whether the S election
 * carries accumulated earnings and profits, or what the beginning AAA was. It
 * would be easy — and it is the normal thing for accounting software to do — to
 * default those to the tidy answer: everything current, no E&P, AAA of zero.
 *
 * Each of those defaults produces a statement that renders perfectly and states
 * something false. `loadFactsOnFile()` therefore returns "not supplied" rather
 * than a value, and the UI core turns that into a named blocker with a shopping
 * list of where to obtain the missing document. A blank space that explains
 * itself is worth more than a number that lies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT READS INCEPTION-TO-DATE AND FOLDS
 * ─────────────────────────────────────────────────────────────────────────────
 * It uses the same `getGeneralLedgerToDate` + `foldBalanceForward` pairing the
 * trial balance and general ledger screens already use. This is standing rule 25
 * — extend what exists rather than adding a third way to compute a balance.
 *
 * That history matters here. The trial balance screen originally queried from
 * the start of the window, which excluded the cut-over opening balances dated
 * 2025-12-31. Every asset was understated, several accounts appeared to be on
 * the wrong side, and the report still footed and still certified — because
 * removing a whole balanced journal removes equal debits and credits. If the
 * financial statements ran their own query, they would meet the same trap, and
 * a balance sheet that is missing its opening balances still ties.
 */

import "server-only";

import {
  getGeneralLedgerToDate,
  listAccounts,
  type LedgerResult,
} from "./ledger-store";
import type { GlRefusal } from "./gl-refusal-core";
import type { AccountType, NormalBalance } from "./ledger-core";
import {
  foldBalanceForward,
  natureMapFrom,
  buildTrialBalance,
  type AccountFacts,
  type TrialBalanceView,
} from "./books-ledger-guidance-core";
import type { FsAccountFact, FsFactsOnFile } from "./financial-statements-ui-core";

/**
 * Everything the screen needs, or the reason it cannot be had.
 *
 * `refusal` is a message from the database layer — a permission problem, a
 * missing RPC, a dead connection. It is kept separate from the statement-level
 * refusals in the engine because the two need completely different responses:
 * this kind means "the system is broken", the other kind means "your books are
 * telling you something".
 */
export type FsSourceData = {
  view: TrialBalanceView;
  facts: readonly FsAccountFact[];
  refusal: GlRefusal | null;
};

/**
 * Read the ledger and the chart, and fold them into the trial balance view.
 *
 * The fold and the trial balance construction are pure functions imported from
 * `books-ledger-guidance-core` and already covered by that module's tests. They
 * are called here rather than in the page so that the page receives finished
 * data, but no arithmetic is DEFINED in this file — it is only invoked.
 */
export async function loadFinancialStatementSource(
  entityCode: string,
  fromDate: string,
  toDate: string,
): Promise<FsSourceData> {
  const [ledger, accounts] = await Promise.all([
    getGeneralLedgerToDate(entityCode, null, toDate),
    listAccounts(entityCode, true),
  ]);

  const refusal = firstRefusal([ledger, accounts]);

  // THE CHART IS READ WITH `includeInactive = true`, ON PURPOSE.
  //
  // An account can be deactivated while still holding a balance — that is the
  // normal way a chart is tidied up. If inactive accounts were excluded here,
  // their codes would arrive from the ledger with no matching chart entry, the
  // adapter would (correctly) refuse the whole statement, and the message would
  // blame a missing account rather than a deactivated one. Worse, if the
  // adapter ever became lenient, that money would vanish from a statement that
  // still balanced.
  const facts: readonly FsAccountFact[] = (accounts.ok ? accounts.data : []).map((a) => ({
    code: a.code,
    name: a.name,
    accountType: a.account_type as AccountType,
    normalBalance: a.normal_balance as NormalBalance,
    // Straight from `gl_accounts.is_contra`, which migration 0173 sets true on
    // 50900 Discounts & Comps and 50910 Returns & Refunds. Reading the flag
    // rather than hard-coding those two codes is what lets a third contra
    // account be added to the chart without silently overstating net sales.
    isContra: a.is_contra,
  }));

  const nature: AccountFacts[] = facts.map((f) => ({
    code: f.code,
    name: f.name,
    accountType: f.accountType,
    normalBalance: f.normalBalance,
  }));

  const sections = ledger.ok ? foldBalanceForward(ledger.data, fromDate, natureMapFrom(nature)) : [];
  const view = buildTrialBalance(sections, nature);

  return { view, facts, refusal };
}

/**
 * WHICH OF THE FACTS THE STATEMENTS NEED ARE ACTUALLY ON FILE.
 *
 * Today the honest answer for all five is "no", and this function says so in
 * one place rather than scattering `false` through a page.
 *
 * IT IS NOT A STUB, AND IT MUST NOT BE QUIETLY UPGRADED. Each field maps to a
 * specific document that has been requested from Michael and not yet supplied:
 *
 *   nonCurrentClassificationSupplied  ← the Wells Fargo amortisation schedule
 *   cashFlowActivitySplitSupplied     ← nothing in this system computes the
 *                                       operating/investing/financing split yet
 *   hasAccumulatedEandP               ← Form 2553 and the CP261 acceptance
 *                                       letter; a C-corp history means E&P can
 *                                       exist, and it changes how distributions
 *                                       are taxed
 *   beginningAaaSupplied              ← Schedule M-2 line 8 from the prior return
 *   beginningBasisSupplied            ← Form 7203, per shareholder
 *
 * When a document arrives, the change is to STORE it and read it here — not to
 * flip a boolean. A hard-coded `true` would remove the blocker from the screen
 * while the underlying figure stayed unknown, which converts an honest refusal
 * into a confident wrong answer. That is standing rule 12 exactly: never
 * silently plug a hole.
 *
 * `hasAccumulatedEandP` is `null` rather than `false` for the same reason. False
 * is a claim about the company. Null is the truth about our knowledge.
 */
export async function loadFactsOnFile(): Promise<FsFactsOnFile> {
  return {
    nonCurrentClassificationSupplied: false,
    cashFlowActivitySplitSupplied: false,
    hasAccumulatedEandP: null,
    beginningAaaSupplied: false,
    beginningBasisSupplied: false,
  };
}

/**
 * Which liabilities are long-term.
 *
 * Empty, and it stays empty until the loan terms are on file. Returning `[]`
 * means every liability is presented as current, which UNDERSTATES the
 * business's position — it makes the current ratio look worse than it is. That
 * direction is chosen deliberately: an error that makes you look weaker is one
 * you investigate, and an error that makes you look stronger is one you rely on.
 *
 * The screen does not leave it at that. The matching blocker names the missing
 * document, so the pessimistic figure is never mistaken for a measured one.
 */
export async function loadNonCurrentAccountCodes(): Promise<readonly string[]> {
  return [];
}

/** The first database-level refusal, if any of the reads failed. */
function firstRefusal(results: readonly LedgerResult<unknown>[]): GlRefusal | null {
  for (const r of results) {
    if (!r.ok) return r.refusal;
  }
  return null;
}
