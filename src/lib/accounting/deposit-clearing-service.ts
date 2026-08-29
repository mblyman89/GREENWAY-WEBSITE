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
 * WHAT books-96 CHANGED HERE
 * --------------------------
 * books-95 read `10400` as a single number and took the oldest date from any
 * line that ever added to it. Nothing retired a day once its cash was banked,
 * so that date only ever got older; after a month every deposit was refused as
 * too old. That is D-76, and it made a finished, tested, wired feature unusable
 * in practice - the rule 50 shape the census exists to catch.
 *
 * The read is now BY BUSINESS DAY. Debits are folded under the journal date
 * (a close entry is dated on its business day); credits are folded under the
 * day named in their description, because a clearing credit is dated when the
 * BANK received the money. A day whose debits and credits cancel drops out of
 * the pool entirely, which is what makes the aging figure age.
 *
 * DELIBERATE LIMIT (rule 133f)
 * ----------------------------
 * A deposit is attributed to the DAYS it banked, oldest first, and not to
 * named register SESSIONS. Two tills on the same day are folded into one day
 * because the bank reports one credit for a bag and the feed does not say how
 * it was composed; splitting a day between two sessions would be an invention.
 * The day is as fine as the evidence goes. The census row keeps `married`
 * honest about that.
 *
 * FIFO IS A CONVENTION, NOT A FACT (rule 133f)
 * -------------------------------------------
 * Cash is fungible. Nothing in a sealed bag says which day's twenty-dollar bill
 * it holds, so "oldest first" is a stated convention, chosen because it matches
 * the owner's actual procedure - one bag per day, banked in order - and because
 * it is the only convention under which a pool can be shown to age. It is not a
 * measurement, and `deposit-fifo-core.ts` says so at its head.
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
  type DepositWarning,
} from "@/lib/accounting/deposit-clearing-core";
import {
  foldDaysFromLines,
  parseClearedDay,
  oldestOpenDate,
  type UndepositedDay,
} from "@/lib/accounting/deposit-fifo-core";
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
      /**
       * Things that are true and were posted anyway. Never empty-by-accident:
       * an ordinary same-week deposit legitimately produces none.
       */
      readonly warnings: readonly DepositWarning[];
      /** The business days this deposit banked, oldest first. */
      readonly clearedDays: readonly string[];
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

/** What the pool looks like right now, broken down by the day it came from. */
export type UndepositedPool = {
  /** Sum of every open day. Equals the 10400 debit balance. */
  readonly balanceMinor: number;
  /** The oldest day still OPEN, or null when nothing is waiting. */
  readonly oldestDate: string | null;
  /** Every day still waiting to be banked, oldest first. */
  readonly days: readonly UndepositedDay[];
  /**
   * Days whose credits exceed their debits - more banked for a day than was
   * ever counted for it. Rule 135: reported, never clamped to zero. An empty
   * array means the books agree with themselves.
   */
  readonly negativeDays: readonly UndepositedDay[];
};

/**
 * `10400` read BY BUSINESS DAY, counting POSTED lines only.
 *
 * Returns `null` on a read failure. Standing rule 46: a failed read is NOT an
 * empty result. Zero and "the query broke" mean opposite things here — the
 * first says there is nothing to clear, the second says we do not know, and
 * treating the second as the first would refuse a legitimate deposit with a
 * sentence that is a lie.
 *
 * WHY `description` IS SELECTED. A close DEBIT is dated on its business day, so
 * the journal date is the right bucket for it. A clearing CREDIT is dated when
 * the bank received the money, which is precisely the date that differs. If
 * credits were bucketed by journal date they would never cancel the debits they
 * paid off and every day would look open forever - D-76 exactly. So each credit
 * carries its day in the line description and `parseClearedDay` reads it back.
 */
export async function undepositedBalanceMinor(
  client?: ReturnType<typeof createSupabaseAdminClient>,
): Promise<UndepositedPool | null> {
  if (!client && !isSupabaseServiceConfigured) return null;
  const admin = client ?? createSupabaseAdminClient();

  const { data, error } = await admin
    .from("gl_journal_lines")
    .select("amount_cents, description, gl_journals!inner(status, journal_date, source_ref)")
    .eq("account_code", UNDEPOSITED_ACCOUNT)
    .eq("gl_journals.status", "posted");

  if (error || !data) return null;

  const rows = data as unknown as Array<{
    amount_cents: number | string;
    description: string | null;
    gl_journals: {
      status: string;
      journal_date: string;
      source_ref: string | null;
    } | null;
  }>;

  const lines: { date: string; amountMinor: number; sourceRef: string }[] = [];

  for (const r of rows) {
    // Rule 46, and the sharpest edge in this file. If `description` was never
    // selected, every credit loses its marker, every credit silently falls back
    // to its journal date, no day ever cancels, and D-76 comes back looking
    // exactly like correct arithmetic. An absent KEY and a null COLUMN are
    // therefore different facts: the first says the query was wrong.
    if (!("description" in r)) return null;

    const cents = typeof r.amount_cents === "string" ? Number(r.amount_cents) : r.amount_cents;
    if (!Number.isFinite(cents)) return null;

    const journalDate = r.gl_journals?.journal_date ?? null;

    // A credit says which day it cleared; a debit is dated on its own day.
    // parseClearedDay returns null when the line does not carry a marker, and
    // that is the ONLY case where the journal date is used for a credit — a
    // pre-books-96 lumped credit, which has no day to name.
    const marked = parseClearedDay(r.description);
    const date = marked ?? journalDate;

    // Rule 46 again: a line with no date at all cannot be bucketed, and
    // guessing one would put real money on a day it did not happen.
    if (date === null) return null;

    lines.push({
      date,
      amountMinor: cents,
      sourceRef: r.gl_journals?.source_ref ?? "",
    });
  }

  const { days, negativeDays } = foldDaysFromLines(lines);
  const balanceMinor =
    days.reduce((a, d) => a + d.amountMinor, 0) +
    negativeDays.reduce((a, d) => a + d.amountMinor, 0);

  return { balanceMinor, oldestDate: oldestOpenDate(days), days, negativeDays };
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

  // Rule 135: a day banked for more than it was ever counted is the books
  // disagreeing with themselves. Netting it against a healthy day would hide
  // the contradiction inside a correct-looking total, so it stops here BY NAME
  // and by date, before any money is attributed to any day.
  if (pool.negativeDays.length > 0) {
    const named = pool.negativeDays
      .map((d) => `${d.date} (${money(d.amountMinor)})`)
      .join(", ");
    return {
      kind: "refused",
      transactionId: row.transactionId,
      code: "DEPOSIT_POOL_NOT_POSITIVE",
      message:
        `Undeposited Funds shows more banked than counted for ${named}. That ` +
        "means a deposit was cleared against a day that never held that much, " +
        "so the day-by-day record contradicts itself. Nothing was posted, " +
        "because clearing more cash against those days would bury the problem " +
        "in a total that still looks right.",
    };
  }

  const built: DepositResult = buildDepositClearingJournal({
    row,
    eventKind,
    // The days ARE the pool. books-95 passed a total and an oldest date as two
    // separate arguments, which allowed a pair that could not both be true.
    days: pool.days,
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
    warnings: built.warnings,
    clearedDays: built.allocation.days.map((d) => d.date),
  };
}

/**
 * One sentence per outcome, for a banner. No outcome may become a shrug.
 *
 * A posted-with-warnings deposit reads as POSTED FIRST and then the caveat.
 * The owner's decision was that these post; a sentence that led with the
 * complaint would read like a failure and send someone looking for a problem
 * that has already been handled.
 */
export function describeDepositOutcome(o: DepositClearOutcome): string {
  switch (o.kind) {
    case "posted":
      return o.warnings.length === 0
        ? o.message
        : `${o.message} Worth a look: ${o.warnings.map((w) => w.message).join(" ")}`;
    case "refused":
      return `Not cleared: ${o.message}`;
    case "failed":
      return (
        `The deposit was accepted but the ledger refused it: ${o.message} ` +
        `Nothing was posted, so Undeposited Funds is unchanged.`
      );
  }
}
