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
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { draftRefundsForDay, type RefundDraftOutcome } from "@/lib/accounting/refund-posting-service";
import { recordAudit } from "@/lib/auth/audit";

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

/**
 * Fix Phase 2.8 (G-48 · F-15-14). THE REFUND DOOR.
 *
 * G-48, verbatim: "a daily draft journal for customer refunds (debit 50910
 * Returns & Refunds and the tax liabilities as applicable, credit cash)
 * awaiting owner approval". Owner basis books-23: "Anything accounting,
 * bookkeeping, taxes, finance, should be hard gated to me only."
 *
 * The owner gate runs BEFORE anything is read. The service only drafts
 * (no autoPost); the entry then waits in the list below for Post.
 */
export async function draftRefundsAction(businessDay: string): Promise<RefundDraftOutcome> {
  const session = await requireBooksAccess();
  const day = (businessDay ?? "").trim();
  let outcome: RefundDraftOutcome;
  try {
    outcome = await draftRefundsForDay(day);
  } catch (err) {
    outcome = {
      kind: "failed",
      businessDay: day,
      code: "REFUND_DRAFT_FAILED",
      message: `The refunds could not be drafted: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`,
    };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: null,
    action: "books.refunds.drafted",
    entityType: "business_day",
    entityId: day || null,
    after: {
      kind: outcome.kind,
      code: outcome.kind === "drafted" ? (outcome.duplicate ? "DUPLICATE" : "DRAFTED") : outcome.code,
      journalId: outcome.kind === "drafted" ? outcome.journalId : null,
      refundCents: outcome.kind === "drafted" ? outcome.totals.refundCents : null,
    },
  });
  if (outcome.kind === "drafted" && !outcome.duplicate) revalidatePath("/admin/books/drafts");
  return outcome;
}
