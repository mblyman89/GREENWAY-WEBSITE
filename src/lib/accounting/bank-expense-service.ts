/**
 * src/lib/accounting/bank-expense-service.ts
 *
 * THE WIRE for expenses from the bank feed (D-56 / D-37).
 *
 * Before this file, `src/lib/plaid/` was 16 files with ZERO calls to
 * submitJournal: the feed could be read, displayed and matched, but nothing in
 * it ever reached the ledger. `classifyExpense` -- 60 measured vendors, 50
 * tests, 18/18 mutants killed -- had no caller in `src/app` at all. Both halves
 * were finished and neither was connected. This joins them.
 *
 * WHAT IT DOES
 * ------------
 * Reads settled rows for one Plaid account, asks `classifyExpense` which
 * expense account each merchant is, asks `bank-expense-core` to turn that plus
 * the owner-set account role into a balanced two-line entry, and submits each
 * one. Every judgement lives in the pure core; this file reads, writes, and
 * reports.
 *
 * WHY IT GOES THROUGH submitJournal AND NOT gl_post_bank_match
 * ------------------------------------------------------------
 * Migration 0189 supplies a complete SQL reconciliation suite --
 * gl_post_bank_match, gl_unmatch_bank_row, gl_bank_reconcile,
 * gl_sign_off_bank_reconciliation -- with no caller anywhere in the codebase.
 * It is tempting to use it. It is the wrong door for THIS event, because
 * matching means "this bank row and this EXISTING journal are the same money".
 * The census is explicit that this family has no in-system counterpart: the
 * bank feed is the only source, so there is nothing to match TO. The entry has
 * to be created first. Once these entries exist, 0189 becomes the right tool
 * for reconciling them -- so it is redundant here, not missing. Recorded so the
 * next person does not "fix" this by rerouting it.
 *
 * IDEMPOTENCY IS FREE, AND THAT IS NOT AN ACCIDENT
 * ------------------------------------------------
 * `submitJournal` is idempotent on (entityCode, sourceKind, sourceRef) and the
 * sourceRef here is the Plaid `transaction_id` -- unique in the table and
 * stable for the life of a settled transaction. Re-running over the same window
 * produces `outcome: "duplicate"`, never a second entry. The census called this
 * out as the natural key that nothing was using; now something does.
 *
 * NOTHING HERE POSTS. EVERYTHING IS A DRAFT.
 * ------------------------------------------
 * `autoPost` is not set, so `gl_submit_journal` receives `p_auto_post = false`
 * and migration 0174 line 475 returns status 'draft'. That is deliberate: these
 * entries are machine-classified from a merchant name, and a merchant name is a
 * guess about intent even when the rule matched. They wait for Michael. The
 * only thing that can bless a draft is `gl_approve_journal`.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { classifyExpense } from "@/lib/accounting/expense-classification-core";
import {
  planBankExpense,
  merchantTextFor,
  BANK_SOURCE_KIND,
  type BankExpenseRefusalCode,
  type BankFeedLine,
  type FundingAccount,
} from "@/lib/accounting/bank-expense-core";
import {
  planCardPayment,
  type CardPaymentDeclineCode,
} from "@/lib/accounting/card-payment-core";

/** One row's outcome, for a screen to render. Refusals are never swallowed. */
export type BankExpenseOutcome =
  | {
      readonly kind: "recorded";
      readonly transactionId: string;
      readonly merchant: string;
      readonly amountCents: number;
      readonly account: string;
      readonly journalId: string | null;
      readonly status: string | null;
      /** 'duplicate' when this row was already recorded. */
      readonly outcome: string | null;
    }
  | {
      readonly kind: "refused";
      readonly transactionId: string;
      readonly merchant: string;
      readonly amountCents: number;
      readonly code: BankExpenseRefusalCode | CardPaymentDeclineCode | "GL_REFUSED";
      readonly underlyingCode: string | null;
      readonly message: string;
    };

export type BankExpenseRunResult = {
  readonly ok: boolean;
  readonly scanned: number;
  readonly recorded: number;
  readonly duplicates: number;
  readonly refused: number;
  readonly outcomes: readonly BankExpenseOutcome[];
  readonly error: string | null;
};

function emptyRun(error: string | null): BankExpenseRunResult {
  return {
    ok: error === null,
    scanned: 0,
    recorded: 0,
    duplicates: 0,
    refused: 0,
    outcomes: [],
    error,
  };
}

/**
 * Record every settled expense in `lines` against `account`.
 *
 * Pure in its inputs so the whole decision path is testable without a database:
 * the caller supplies the rows and the funding account. `recordBankExpenses`
 * below is the door that does the reading.
 */
export async function recordBankExpenseLines(
  lines: readonly BankFeedLine[],
  account: FundingAccount,
  client?: Parameters<typeof submitJournal>[1],
): Promise<BankExpenseRunResult> {
  const outcomes: BankExpenseOutcome[] = [];
  let recorded = 0;
  let duplicates = 0;
  let refused = 0;

  for (const line of lines) {
    const merchant = merchantTextFor(line);

    // THE CARD BILL (D-78). `planBankExpense` refuses this row, and refusing is
    // only half an answer: if nothing posted the transfer, 33000 would still
    // never come down and the refusal would look like a bug to whoever read the
    // screen. So the same row is offered to `planCardPayment` FIRST, and the
    // expense path is only reached when that says the row is something else.
    //
    // The two are mutually exclusive by construction: both ask the same
    // question of the same field, so a row can be a transfer or an expense but
    // never both, and never neither.
    const card = planCardPayment({
      transactionId: line.transactionId,
      amountCents: line.amountCents,
      date: line.date,
      categoryDetailed: line.categoryDetailed ?? null,
      role: account.role,
    });

    if (card.kind === "declined") {
      // The mirror row on the card's own feed. Recognised, and deliberately not
      // recorded, because the checking side already booked it (rule 136).
      refused += 1;
      outcomes.push({
        kind: "refused",
        transactionId: line.transactionId,
        merchant: merchant ?? "(no merchant)",
        amountCents: line.amountCents,
        code: card.code,
        underlyingCode: null,
        message: card.explanation,
      });
      continue;
    }

    if (card.kind === "transfer") {
      const moved = await submitJournal(
        // JournalDraft and SubmitJournalInput differ in two nullable spots:
        // sourceRef may be absent, and a line description may be null. Both are
        // normalised here rather than loosened at either type, because the
        // draft type is shared and the posting type is the stricter one.
        // planCardPayment always sets both, so nothing is invented.
        {
          ...card.journal,
          sourceRef: card.journal.sourceRef ?? null,
          lines: card.journal.lines.map((l) => ({
            accountCode: l.accountCode,
            amountCents: l.amountCents,
            costClass: l.costClass,
            description: l.description ?? undefined,
          })),
        },
        client,
      );
      if (!moved.ok) {
        refused += 1;
        outcomes.push({
          kind: "refused",
          transactionId: line.transactionId,
          merchant: merchant ?? "(no merchant)",
          amountCents: line.amountCents,
          code: "GL_REFUSED",
          underlyingCode: moved.code,
          message: moved.message,
        });
        continue;
      }
      if (moved.outcome === "duplicate") duplicates += 1;
      else recorded += 1;
      outcomes.push({
        kind: "recorded",
        transactionId: line.transactionId,
        merchant: merchant ?? "(no merchant)",
        amountCents: line.amountCents,
        account: card.journal.lines[0].accountCode,
        journalId: moved.journalId,
        status: moved.status,
        outcome: moved.outcome,
      });
      continue;
    }

    const plan = planBankExpense(line, account, classifyExpense({ merchant }));

    if (!plan.ok) {
      refused += 1;
      outcomes.push({
        kind: "refused",
        transactionId: line.transactionId,
        merchant: merchant ?? "(no merchant)",
        amountCents: line.amountCents,
        code: plan.code,
        underlyingCode: plan.underlyingCode,
        message: plan.message,
      });
      continue;
    }

    const result = await submitJournal(
      {
        entityCode: plan.entityCode,
        journalDate: plan.journalDate,
        sourceKind: BANK_SOURCE_KIND,
        sourceRef: plan.sourceRef,
        memo: plan.memo,
        lines: plan.lines.map((l) => ({
          accountCode: l.accountCode,
          amountCents: l.amountCents,
          costClass: l.costClass,
          description: l.description,
        })),
      },
      client,
    );

    if (!result.ok) {
      refused += 1;
      outcomes.push({
        kind: "refused",
        transactionId: line.transactionId,
        merchant: merchant ?? "(no merchant)",
        amountCents: line.amountCents,
        code: "GL_REFUSED",
        underlyingCode: result.code,
        message: result.message,
      });
      continue;
    }

    if (result.outcome === "duplicate") duplicates += 1;
    else recorded += 1;

    outcomes.push({
      kind: "recorded",
      transactionId: line.transactionId,
      merchant: merchant ?? "(no merchant)",
      amountCents: line.amountCents,
      account: plan.lines[0].accountCode,
      journalId: result.journalId,
      status: result.status,
      outcome: result.outcome,
    });
  }

  return {
    ok: true,
    scanned: lines.length,
    recorded,
    duplicates,
    refused,
    outcomes,
    error: null,
  };
}

/**
 * The shipped door: read one account's feed and record what it can.
 *
 * Reads the account's role from `plaid_accounts` rather than accepting it from
 * a caller. A caller passing the role from memory is how the wrong bank account
 * ends up funding an entry, and unlike a wrong amount it would never look
 * wrong -- the entry still balances.
 */
export async function recordBankExpenses(
  plaidAccountId: string,
  limit = 100,
): Promise<BankExpenseRunResult> {
  if (!isSupabaseServiceConfigured) {
    return emptyRun("Database not connected. Nothing was written.");
  }
  const admin = createSupabaseAdminClient();

  const { data: acct, error: acctError } = await admin
    .from("plaid_accounts")
    .select("account_id,role,active")
    .eq("account_id", plaidAccountId)
    .maybeSingle();

  if (acctError) {
    return emptyRun(`Could not read the bank account: ${acctError.message}. Nothing was written.`);
  }
  if (!acct) {
    return emptyRun("That bank account is not connected. Nothing was written.");
  }

  const { data: rows, error: txnError } = await admin
    .from("plaid_transactions")
    .select(
      // personal_finance_category_detailed is what lets a card-bill payment
      // identify itself before it can be mistaken for an expense (D-78).
      // Without it in this select the guard in planBankExpense sees `undefined`
      // and every row falls through to the merchant-text path, which is
      // precisely the bug. The column has been stored since books-88.
      // NOTE: one unbroken string literal on purpose. supabase-js infers the
      // row type FROM this text, so splitting it across a `+` concatenation
      // collapses the inference to GenericStringError and the mapping below
      // stops being type-checked at all.
      "transaction_id,amount_cents,date,merchant_name,name,pending,personal_finance_category_detailed",
    )
    .eq("account_id", plaidAccountId)
    .eq("removed", false)
    .order("date", { ascending: false })
    .limit(limit);

  if (txnError) {
    return emptyRun(`Could not read the bank feed: ${txnError.message}. Nothing was written.`);
  }

  const lines: BankFeedLine[] = (rows ?? []).map((r) => {
    const row = r as {
      transaction_id: string;
      amount_cents: number | string;
      date: string;
      merchant_name: string | null;
      name: string | null;
      pending: boolean | null;
      personal_finance_category_detailed: string | null;
    };
    return {
      transactionId: row.transaction_id,
      amountCents:
        typeof row.amount_cents === "string" ? Number(row.amount_cents) : row.amount_cents,
      date: row.date,
      merchantName: row.merchant_name,
      name: row.name,
      pending: !!row.pending,
      categoryDetailed: row.personal_finance_category_detailed,
    };
  });

  const role = typeof acct.role === "string" && acct.role.trim() !== "" ? acct.role : null;
  return recordBankExpenseLines(lines, { accountId: plaidAccountId, role }, admin);
}
