/**
 * src/app/admin/books/pay-run/actions.ts   (slice books-86)
 *
 * The one write this screen can perform: send a computed payroll to the ledger.
 *
 * Thin on purpose. Every decision lives in payroll-posting-core.ts (pure,
 * tested) and every database call in payroll-posting-service.ts. A server
 * action cannot be unit tested in this repository, so anything decided here
 * would be a rule nothing checks — and on a payroll screen that is how somebody
 * gets booked at the wrong amount.
 *
 * The period id is re-validated and the whole run re-read inside the service.
 * Nothing the browser sends is trusted beyond which period was clicked.
 */

"use server";

import { revalidatePath } from "next/cache";

import { postPayrollRun, type PayrollPostOutcome } from "@/lib/accounting/payroll-posting-service";

export async function postPayrollAction(periodId: string): Promise<PayrollPostOutcome> {
  const result = await postPayrollRun(periodId);

  if (result.ok) {
    // The entry lands as a draft, so the drafts screen genuinely changes.
    revalidatePath("/admin/books/drafts");
    revalidatePath("/admin/books/pay-run");
  }

  return result;
}
