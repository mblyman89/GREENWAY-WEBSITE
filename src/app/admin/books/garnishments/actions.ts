"use server";

/**
 * src/app/admin/books/garnishments/actions.ts   (books-38)
 *
 * SERVER ACTIONS for entering and managing wage orders.
 *
 * These four functions are the only way a garnishment or child support order
 * can enter, change state in, or leave the system. Before books-38 there was
 * no way at all — Michael's own words:
 *
 *   "the child support and garnishment page does not have a way for me to
 *    enter that in. Is it on other page like the payroll setup page?"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ACCESS GATE IS CALLED FIRST IN EVERY ONE OF THEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A server action is a PUBLIC HTTP ENDPOINT. It is reachable by anybody who can
 * work out its identifier, with or without ever loading the page it belongs to.
 * Checking access in the page is checking the front door while leaving the
 * window open.
 *
 * That matters more here than almost anywhere else in this application, and for
 * a reason worth spelling out: `wage-order-write-store.ts` uses the SERVICE
 * ROLE, which BYPASSES the owner-only RLS policies migration 0198 puts on
 * `wage_orders`. Those policies are real, they are correct, and on this code
 * path they are INERT. `requireBooksAccess()` is therefore not a convenience —
 * it is the entire protection standing between a public endpoint and a table
 * containing the case numbers, court names and support obligations of
 * Greenway's employees.
 *
 * This is the same reasoning, for the same reason, as `leave/actions.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE STAFF ID COMES FROM THE SESSION AND NEVER FROM THE FORM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `created_by_staff_id` is an audit fact: who entered this garnishment. A value
 * that arrives in the request body is not a fact, it is a text field that the
 * sender chose. Every one of these actions takes the id from the session
 * `requireBooksAccess()` returns, and the form is never asked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOTHING THROWS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A thrown error renders Next's error boundary: a blank screen where the
 * guidance used to be, and no indication of whether the order was saved.
 * Michael's standing complaint about Sage is being stopped without being told
 * why. Every failure here returns a sentence, and every one of those sentences
 * says explicitly whether anything was written.
 */

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import type { WageOrderDraft } from "@/lib/payroll/wage-order-entry-core";
import {
  createWageOrder,
  resumeWageOrder,
  suspendWageOrder,
  terminateWageOrder,
  type WageOrderWriteResult,
} from "@/lib/payroll/wage-order-write-store";

const SCREEN = "/admin/books/garnishments";

/**
 * Enter a new order from the judgement.
 *
 * The draft arrives EXACTLY as typed. No trimming, no coercion, no "helpful"
 * normalising happens here — all of that lives in the pure validator, where it
 * is tested. An action that quietly cleaned up its input would be a second,
 * untested place where what Michael typed and what got saved could differ.
 */
export async function createWageOrderAction(
  draft: WageOrderDraft,
): Promise<WageOrderWriteResult> {
  const session = await requireBooksAccess();

  const result = await createWageOrder({
    draft,
    createdByStaffId: session.profile.id,
  });

  if (result.ok) {
    revalidatePath(SCREEN);
    // The net-pay screen shows what actually comes out of a paycheck, and a new
    // garnishment changes that from the effective date. Leaving it cached would
    // show a take-home figure that no longer matches what will be paid.
    revalidatePath("/admin/books/net-pay");
  }

  return result;
}

/**
 * End an order permanently, with the reason on the record.
 *
 * The reason is required by the database, by the store, and again in the
 * refusal sentence the store returns. Three layers for one field looks like
 * over-engineering until the day somebody asks why withholding stopped in
 * March and the only answer on file is a status column.
 */
export async function terminateWageOrderAction(input: {
  orderId: string;
  reason: string;
}): Promise<WageOrderWriteResult> {
  await requireBooksAccess();

  if (!input.orderId) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "No order was identified, so nothing was changed and withholding continues exactly as " +
        "it was. Reload the garnishments page and try again.",
    };
  }

  const result = await terminateWageOrder({
    orderId: input.orderId,
    reason: input.reason ?? "",
  });

  if (result.ok) {
    revalidatePath(SCREEN);
    revalidatePath("/admin/books/net-pay");
  }
  return result;
}

/**
 * Pause withholding without ending the order.
 *
 * Deliberately the weaker tool — see the store, which explains at length why
 * this is not what to reach for when an order has actually been released.
 */
export async function suspendWageOrderAction(input: {
  orderId: string;
  note: string | null;
}): Promise<WageOrderWriteResult> {
  await requireBooksAccess();

  if (!input.orderId) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "No order was identified, so nothing was changed and withholding continues exactly as " +
        "it was. Reload the garnishments page and try again.",
    };
  }

  const result = await suspendWageOrder({ orderId: input.orderId, note: input.note });
  if (result.ok) {
    revalidatePath(SCREEN);
    revalidatePath("/admin/books/net-pay");
  }
  return result;
}

/** Put a paused order back into effect. Does NOT catch up missed periods. */
export async function resumeWageOrderAction(input: {
  orderId: string;
}): Promise<WageOrderWriteResult> {
  await requireBooksAccess();

  if (!input.orderId) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "No order was identified, so nothing was changed. Reload the garnishments page and try " +
        "again.",
    };
  }

  const result = await resumeWageOrder({ orderId: input.orderId });
  if (result.ok) {
    revalidatePath(SCREEN);
    revalidatePath("/admin/books/net-pay");
  }
  return result;
}
