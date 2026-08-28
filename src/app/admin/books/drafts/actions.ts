/**
 * src/app/admin/books/drafts/actions.ts   (slice books-85, closes D-67)
 *
 * The one server action behind the Post button.
 *
 * It trusts nothing the browser sends except the journal id, and even that is
 * re-read from the database before anything happens. The permission check, the
 * approval decision and the posting rules all live server-side in
 * approval-service.ts / approval-core.ts and in the database itself; this file
 * is a thin wire, deliberately.
 *
 * Errors are RETURNED, never thrown. A thrown error here would replace the
 * refusal sentence — which is the whole point of the control — with an error
 * boundary that says nothing useful.
 */

"use server";

import { revalidatePath } from "next/cache";

import {
  approveAndPostJournal,
  type ApprovalResult,
} from "@/lib/accounting/approval-service";

export async function postDraftAction(
  journalId: string,
  note?: string,
): Promise<ApprovalResult> {
  try {
    const result = await approveAndPostJournal(journalId, note);
    if (result.ok) {
      // The draft has left the queue and the ledger has grown, so both screens
      // are now stale.
      revalidatePath("/admin/books/drafts");
      revalidatePath("/admin/books/ledger");
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      code: "POST_FAILED",
      message:
        "Couldn't post that just now, and the reason is not one the books recognise: " +
        (err instanceof Error ? err.message : String(err)) +
        " Nothing was posted. Try again, and if it keeps happening do not work around it.",
      journalNo: null,
    };
  }
}
