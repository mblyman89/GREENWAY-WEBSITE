"use server";

/**
 * src/app/admin/books/bank/actions.ts
 *
 * THE DOOR THAT WAS MISSING (D-70).
 *
 * books-88. Michael, verbatim: "I did refresh the atm connection to bring in
 * new atm fees, but those didn't land in the pending page."
 *
 * He was right. `bank-expense-service.ts` was finished in books-84 - it reads a
 * connected account's settled charges, classifies each merchant, builds a
 * balanced two-line entry and files it as a draft - and NOTHING called it. Two
 * independent greps came back empty; the only mentions of it anywhere in `src/`
 * were inside the census document that claimed it was live.
 *
 * WHY THIS ONE GOT FORGOTTEN, WHICH IS THE USEFUL PART
 *
 * The other three posting services all hang off an in-system event. A sale
 * posts when an order transitions. A vendor bill posts when a manifest is
 * received. An inventory audit posts when the session closes. Each one had an
 * obvious place to put the call, so the call got put there.
 *
 * A bank feed has no such event. Money left the account days ago and the feed
 * is just a record of it arriving. There is no natural moment to hang the
 * posting off, so somebody has to ASK - and the asking is the thing nobody
 * built. The absence of a trigger is exactly why this was the one that was
 * missed, and it is why this file is a deliberate, owner-pressed button rather
 * than something automatic.
 *
 * WHY IT IS NOT AUTOMATIC, ON PURPOSE
 *
 * It would be easy to run this on every Plaid sync. That would be wrong here.
 * The classifier is measured at 54 of 60 vendors on Michael's real Sage history
 * (see the census row for `expense_classified`); the remaining six refuse
 * rather than guess. Running silently in the background would mean refusals
 * nobody reads and drafts nobody expected. Pressing a button and being shown
 * the outcome of every single row - recorded, duplicate, or refused with the
 * reason - keeps the owner in the loop for the one decision the machine is not
 * allowed to make on its own.
 *
 * NOTHING POSTS HERE. Every entry this creates is a DRAFT. It appears on
 * /admin/books/drafts and waits for Michael to approve it. That is the
 * three-step model the whole ledger uses - submit, approve, post - and this
 * action only performs the first step.
 */

import { revalidatePath } from "next/cache";

import { recordBankExpenses } from "@/lib/accounting/bank-expense-service";
import type { BankExpenseRunResult } from "@/lib/accounting/bank-expense-service";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { recordAudit } from "@/lib/auth/audit";

/**
 * Read one connected account's settled charges and file each as a draft.
 *
 * Returns the run result verbatim from the service, refusals included. The
 * screen prints all of it: a row the system could not classify is more
 * important to show than the ones it could.
 */
export async function recordBankExpensesAction(input: {
  plaidAccountId: string;
}): Promise<BankExpenseRunResult> {
  // The books are owner-only, and this writes to them. The gate comes before
  // anything is read, not after.
  const session = await requireBooksAccess();

  const accountId = input.plaidAccountId?.trim() ?? "";
  if (accountId === "") {
    return {
      ok: false,
      scanned: 0,
      recorded: 0,
      duplicates: 0,
      refused: 0,
      outcomes: [],
      error: "No account was chosen, so nothing was read and nothing was written.",
    };
  }

  const result = await recordBankExpenses(accountId);

  // Audited whether or not it wrote anything. A run that recorded nothing is
  // still a fact worth having later - it is the difference between "the feed
  // was empty" and "nobody ever pressed the button".
  await recordAudit({
    actorId: session.userId,
    actorEmail: null,
    action: "books.bank_expenses.recorded",
    entityType: "plaid_account",
    entityId: accountId,
    after: {
      scanned: result.scanned,
      recorded: result.recorded,
      duplicates: result.duplicates,
      refused: result.refused,
      ok: result.ok,
    },
  });

  if (result.recorded > 0) {
    // The drafts screen is where these now appear, so it must not serve a
    // cached copy that predates them.
    revalidatePath("/admin/books/drafts");
    revalidatePath("/admin/books/bank");
  }

  return result;
}
