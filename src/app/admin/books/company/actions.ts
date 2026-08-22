"use server";

/**
 * src/app/admin/books/company/actions.ts   (slice books-31)
 *
 * SERVER ACTION for the company information screen. Exactly one of them.
 *
 * WHY THE GATE IS RE-CHECKED HERE
 *
 * `company-profile-store.ts` uses the service role, which ignores the
 * owner-only RLS policies on `company_profile`. The database gate is therefore
 * INERT on this path, and `requireBooksAccess()` is the whole protection. It is
 * called first, before anything is read or written, and it is not optional.
 *
 * WHY NOTHING HERE RE-IMPLEMENTS A RULE
 *
 * This function is wiring. Every judgement about what a field must look like
 * lives in COMPANY_FIELDS, and every judgement about whether a form can be
 * produced lives in `formReadiness`. A second copy of either would eventually
 * disagree with the first, silently, and the disagreement would surface on a
 * filing months later.
 *
 * WHY ERRORS ARE RETURNED RATHER THAN THROWN
 *
 * A thrown error renders an error boundary - a blank red screen where the
 * guidance used to be. Michael's whole complaint about Sage is being stopped
 * without being told anything, so failing into silence is the one thing this
 * file must never do.
 */

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { saveCompanyProfile } from "@/lib/accounting/company-profile-store";
import type { CompanyProfileValues } from "@/lib/accounting/company-identity-core";

export async function saveCompanyProfileAction(
  values: CompanyProfileValues,
): Promise<{ ok: boolean; message?: string; field?: string }> {
  await requireBooksAccess();

  const res = await saveCompanyProfile(values);
  if (!res.ok) {
    return { ok: false, message: res.message, field: res.field };
  }

  revalidatePath("/admin/books/company");
  return { ok: true };
}
