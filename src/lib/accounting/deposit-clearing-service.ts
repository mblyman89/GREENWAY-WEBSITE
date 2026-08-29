import "server-only";

/**
 * src/lib/accounting/deposit-clearing-service.ts
 *
 * THE WIRE that empties `10400 Undeposited Funds` when the bank confirms the
 * money arrived. The judgement all lives in `deposit-clearing-core.ts`; this
 * file reads, writes and reports.
 *
 * WHY THIS EXISTS THE SLICE AFTER books-94
 * ----------------------------------------
 * books-94 wired the drawer close, which DEBITS `10400` on every reconcile.
 * Nothing credited it. That made `10400` an asset balance that could only ever
 * grow — the balance sheet claiming cash is in transit that reached the bank
 * weeks ago, and the same dollars counted twice once the bank balance is read.
 * Shipping the close without this is the half-a-loop shape the census exists to
 * catch, and it is recorded as D-75.
 *
 * THE CHAIN, LINK BY LINK (rule 133b)
 * -----------------------------------
 *   a manager reconciles a drawer            (books-94)
 *     -> posted entry DEBITS 10400
 *   Plaid shows a deposit credit at the bank
 *     -> clearDepositForBankRow(transactionId, eventKind)
 *     -> reads the REAL 10400 balance from POSTED journal lines
 *     -> buildDepositClearingJournal (pure) decides or refuses
 *     -> submitJournal, autoPost, sourceRef `deposit-clear:<transactionId>`
 *     -> 10200 debited, 10400 credited, balance returns toward zero
 *     -> outcome returned as a sentence for the screen
 *
 * WHY THE BALANCE IS READ AND NOT PASSED IN
 * -----------------------------------------
 * A caller-supplied balance is a caller-supplied opportunity to be wrong. The
 * whole point of the `DEPOSIT_EXCEEDS_UNDEPOSITED` refusal is that it compares
 * the deposit against what was genuinely counted; comparing it against a number
 * the caller made up would make the guard decorative. Only POSTED lines count —
 * a draft is a proposal, and clearing real cash against a proposal would let an
 * unapproved entry unlock a real deposit.
 *
 * WHY THE EVENT KIND IS NOT GUESSED FROM THE DESCRIPTOR
 * ----------------------------------------------------
 * A transfer in from Michael's own account, an ATM settlement credit, an owner
 * contribution and a sales deposit are all money arriving. Bank descriptors do
 * not reliably distinguish them, and picking one from a string is exactly the
 * guess standing rule 1 forbids. The caller states the kind; the pure core
 * refuses every kind except `deposit_of_sales`, BY NAME.
 *
 * DELIBERATE LIMIT (rule 133f)
 * ----------------------------
 * This clears the deposit against the 10400 balance AS A POOL. It does not
 * record WHICH till closes make up a given deposit, because the bank reports
 * one credit for a bag that may hold several shifts and nothing in the feed
 * says how it was composed. Attributing a deposit to specific sessions would be
 * an invention. The census row keeps `married` honest about that.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import {
  buildDepositClearingJournal,
  depositSourceRef,
  money,
  UNDEPOSITED_ACCOUNT,
  type DepositResult,
} from "@/lib/accounting/deposit-clearing-core";
import type { BankRow } from "@/lib/accounting/bank-match-core";

/** The entity these registers belong to. */
const ENTITY_CODE = "greenway";

export type DepositClearOutcome =
  | {
      readonly kind: "posted";
      readonly transactionId: string;
      readonly sourceRef: string;
      readonly journalId: string | null;
      readonly journalNo: number | null;
      readonly outcome: string | null;
      readonly code: string | null;
      readonly message: string;
    }
  | {
      readonly kind: "refused";
      readonly transactionId: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly kind: "failed";
      readonly transactionId: string;
      readonly sourceRef: string;
      readonly code: string | null;
      readonly message: string;
    };

/**
 * The debit balance of `10400`, in cents, counting POSTED lines only.
 *
 * Returns `null` on a read failure. Standing rule 46: a failed read is NOT an
 * empty result. Zero and "the query broke" mean opposite things here — the
 * first says there is nothing to clear, the second says we do not know, and
 * treating the second as the first would refuse a legitimate deposit with a
 * sentence that is a lie.
 */
export async function undepositedBalanceMinor(
  client?: ReturnType<typeof createSupabaseAdminClient>,
): Promise<{ balanceMinor: number; oldestDate: string | null } | null> {
  if (!client && !isSupabaseServiceConfigured) return null;
  const admin = client ?? createSupabaseAdminClient();

  const { data, error } = await admin
    .from("gl_journal_lines")
    .select("amount_cents, gl_journals!inner(status, journal_date)")
    .eq("account_code", UNDEPOSITED_ACCOUNT)
    .eq("gl_journals.status", "posted");

  if (error || !data) return null;

  const rows = data as unknown as Array<{
    amount_cents: number | string;
    gl_journals: { status: string; journal_date: string } | null;
  }>;

  let balance = 0;
  let oldest: string | null = null;

  for (const r of rows) {
    const cents = typeof r.amount_cents === "string" ? Number(r.amount_cents) : r.amount_cents;
    if (!Number.isFinite(cents)) return null;
    balance += cents;

    // The oldest date among lines that ADDED to the pool. A credit clearing a
    // previous deposit says nothing about how old the remaining cash is.
    const d = r.gl_journals?.journal_date ?? null;
    if (cents > 0 && d !== null && (oldest === null || d < oldest)) oldest = d;
  }

  return { balanceMinor: balance, oldestDate: oldest };
}

/**
 * Clear one confirmed bank deposit against the counted cash waiting in 10400.
 *
 * `eventKind` is what the owner says this bank row is. It is passed straight
 * through to the pure core, which accepts only `deposit_of_sales`.
 */
export async function clearDepositForBankRow(
  row: BankRow,
  eventKind: string,
  opts?: {
    alreadyMatched?: boolean;
    client?: ReturnType<typeof createSupabaseAdminClient>;
  },
): Promise<DepositClearOutcome> {
  const pool = await undepositedBalanceMinor(opts?.client);

  if (pool === null) {
    // Rule 46 again, said out loud so nobody "simplifies" it into a zero.
    return {
      kind: "refused",
      transactionId: row.transactionId,
      code: "DEPOSIT_BALANCE_UNREADABLE",
      message:
        "The Undeposited Funds balance could not be read, so there is no way to " +
        "tell whether this deposit matches the cash that was counted. That is " +
        "not the same as there being nothing to clear, so nothing was posted.",
    };
  }

  const built: DepositResult = buildDepositClearingJournal({
    row,
    eventKind,
    undepositedBalanceMinor: pool.balanceMinor,
    // Rule 135: a missing oldest date is a question, not today's date. If the
    // pool is non-empty the balance read must have found a debit line, so a
    // null here means the data disagrees with itself; passing an empty string
    // makes the core's own date guard refuse rather than inventing a window.
    oldestUndepositedDate: pool.oldestDate ?? "",
    alreadyMatched: opts?.alreadyMatched,
  });

  if (built.kind === "refused") {
    return {
      kind: "refused",
      transactionId: row.transactionId,
      code: built.code,
      message: built.explanation,
    };
  }

  const sourceRef = depositSourceRef(row.transactionId);

  const result = await submitJournal(
    {
      entityCode: ENTITY_CODE,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: built.journal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        description: l.description,
      })),
      autoPost: true,
    },
    opts?.client,
  );

  if (!result.ok) {
    return {
      kind: "failed",
      transactionId: row.transactionId,
      sourceRef,
      code: result.code,
      message: result.message,
    };
  }

  return {
    kind: "posted",
    transactionId: row.transactionId,
    sourceRef,
    journalId: result.journalId,
    journalNo: result.journalNo,
    outcome: result.outcome,
    code: result.code,
    message:
      result.outcome === "duplicate"
        ? `That deposit was already cleared. Nothing was written twice, and ` +
          `Undeposited Funds still stands at ${money(pool.balanceMinor)}.`
        : built.explanation,
  };
}

/** One sentence per outcome, for a banner. No outcome may become a shrug. */
export function describeDepositOutcome(o: DepositClearOutcome): string {
  switch (o.kind) {
    case "posted":
      return o.message;
    case "refused":
      return `Not cleared: ${o.message}`;
    case "failed":
      return (
        `The deposit was accepted but the ledger refused it: ${o.message} ` +
        `Nothing was posted, so Undeposited Funds is unchanged.`
      );
  }
}
