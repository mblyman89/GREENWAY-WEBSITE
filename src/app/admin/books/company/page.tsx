/**
 * src/app/admin/books/company/page.tsx   (slice books-31)
 *
 * COMPANY INFORMATION - the single row every form in this system reads from.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "Please begin work on the next slice, company information setup. I want to
 *    make sure we record every company detail we need according to all the
 *    different forms they will be auto filling for me. What ever the industry
 *    standard enterprise grade solution would do and include, we should do so
 *    as well. Since this info will be used to fill all the forms and whatever
 *    else it's used for, I want to make sure we are building forward thinking
 *    so everything downstream from this info page will flow into all the
 *    reports and forms."
 *
 * HOW THAT SHAPED THE DESIGN
 *
 * The field list was not written from imagination or copied from Sage. It was
 * derived BACKWARDS FROM THE FORMS, by reading the actual instruction text for
 * the Form 941, the Form 940, the Forms W-2 and W-3, and RCW 50.12.070, and
 * asking of each printed box: where does this value come from? Every field in
 * COMPANY_FIELDS therefore names the forms that consume it, and there is no
 * field that nothing consumes - a field no form reads appears in no readiness
 * check, so nothing would ever tell Michael it was blank while its presence on
 * the screen made it look handled.
 *
 * THE GATE
 *
 * `requireBooksAccess()` - `is_owner()` in application form. It is called here
 * AND again inside the server action, because the action is reachable without
 * this page. The store runs as the service role and so bypasses the RLS
 * policies on `company_profile` entirely; these two calls are the real gate.
 *
 * WHAT THE NEXT SLICES DO WITH THIS (standing rule 62)
 *
 *   - The 941, 940, W-2, W-3 and Form 5208 builders read this row through
 *     `requireField`, which refuses to substitute a blank for a missing value.
 *   - The ACH payment run calls `verifyAchAgreement` before building a NACHA
 *     file, so an EIN that disagrees with the ACH immediate origin stops the
 *     run rather than producing a file the bank rejects after payday.
 *   - The quarterly ESD report reads the hours the POS time clock already
 *     records, because RCW 50.12.070 asks for hours worked and the punches are
 *     already there (standing rule 63b: find the feeder before building one).
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { CompanyInformationForm } from "@/components/admin/books/CompanyInformationForm";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadCompanyProfile, verifyAchAgreement } from "@/lib/accounting/company-profile-store";

import { saveCompanyProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompanyInformationPage() {
  await requireBooksAccess();

  const loaded = await loadCompanyProfile();
  const ach = await verifyAchAgreement();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">Company information</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          One row, read by every form this system produces. Each field below names the filings that
          consume it, and the panel on the right explains what it is, where it goes, why it matters, and
          the sentence in the instructions that says so.
        </p>
      </div>

      {!loaded.ok ? (
        <Card>
          <CardHeader title="The company profile could not be read" />
          <p className="text-sm text-[var(--admin-danger)]">{loaded.message}</p>
        </Card>
      ) : (
        <>
          {!loaded.exists ? (
            <Card>
              <p className="text-sm text-[var(--admin-text-muted)]">
                Nothing has been saved here yet. That is the expected state before cutover - fill in what
                you know, save it, and the panel will tell you exactly which filings are still blocked and
                by what. Nothing is guessed on your behalf.
              </p>
            </Card>
          ) : null}

          {ach.checked && !ach.agrees ? (
            <Card>
              <CardHeader title="The ACH setup and the company EIN disagree" />
              <p className="text-sm text-[var(--admin-danger)]">{ach.explanation}</p>
            </Card>
          ) : null}

          {!ach.checked ? (
            <Card>
              <CardHeader title="The ACH setup has not been checked" />
              <p className="text-sm text-[var(--admin-text-muted)]">{ach.reason}</p>
            </Card>
          ) : null}

          <CompanyInformationForm initial={loaded.profile} saveAction={saveCompanyProfileAction} />
        </>
      )}
    </div>
  );
}
