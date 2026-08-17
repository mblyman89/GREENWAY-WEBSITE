/**
 * src/app/admin/books/journal/actions.ts   (slice books-01)
 *
 * SERVER ACTIONS for the General Journal screen. Two of them: one that ASKS the
 * advisor what it thinks, and one that WRITES.
 *
 * WHY BOTH, AND WHY THE PREVIEW IS NOT OPTIONAL.
 * Michael asked for a system that argues with him:
 *   "I want to be able to make entries manually, but the system pushes back and
 *    try's to help me enter it correctly rather than rejecting it out right"
 * That only works if the pushback arrives BEFORE the entry is committed. So the
 * screen previews on every change, and the submit path re-runs the identical
 * evaluation server-side — a preview is advice, not a permission slip. A client
 * that skipped the preview, or lied about what the advisor said, gets exactly
 * the same answer from `submitManualJournal`.
 *
 * NEITHER of these functions trusts the caller's claim about who they are; both
 * go through `requireOwner()` inside the service, which reads the session.
 */

"use server";

import { revalidatePath } from "next/cache";

import {
  previewManualJournal,
  submitManualJournal,
  type ManualJournalInput,
  type ManualJournalResult,
} from "@/lib/accounting/journal-entry-service";

/**
 * Ask the advisor what it makes of a draft. Writes nothing, ever.
 *
 * Errors are returned rather than thrown, because this runs on every keystroke
 * of a form and a thrown error there produces an error boundary instead of a
 * helpful sentence.
 */
export async function previewJournalAction(
  input: ManualJournalInput,
): Promise<ManualJournalResult> {
  try {
    return await previewManualJournal(input);
  } catch (err) {
    return {
      ok: false,
      code: "PREVIEW_FAILED",
      message:
        "Couldn't check this entry just now: " +
        (err instanceof Error ? err.message : String(err)),
      journalId: null,
      journalNo: null,
      verdict: null,
      unacknowledged: [],
    };
  }
}

/**
 * Create the journal as a DRAFT. Nothing here posts to the ledger directly:
 * the service calls `gl_submit_journal`, which is the one door into the books,
 * with `autoPost: false`.
 */
export async function submitJournalAction(
  input: ManualJournalInput,
): Promise<ManualJournalResult> {
  try {
    const result = await submitManualJournal(input);
    if (result.ok) {
      // The new draft has to appear on the ledger and trial-balance screens.
      revalidatePath("/admin/books/journal");
      revalidatePath("/admin/books/ledger");
      revalidatePath("/admin/books/trial-balance");
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      code: "SUBMIT_FAILED",
      message:
        "The entry was not saved: " +
        (err instanceof Error ? err.message : String(err)),
      journalId: null,
      journalNo: null,
      verdict: null,
      unacknowledged: [],
    };
  }
}
