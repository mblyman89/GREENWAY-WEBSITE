/**
 * src/app/admin/books/form-940/sheet/page.tsx   (books-63)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FORM 940 ON THE ACTUAL PAPER — BOTH PAGES, ANY YEAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, naming this slice:
 *
 *   "Yes please complete 940 and w-3 this next slice, with lessons on boxes
 *    that bite only please."
 *
 * And the standing instruction that decides what "complete" means here:
 *
 *   "I am hoping that for all the various forms, I can see the form as it
 *    would look if I were holding it in my hand."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY TWO SHEETS AND NOT THREE
 * ───────────────────────────────────────────────────────────────────────────
 * MEASURED: `f940.pdf` has three pages carrying 59, 31 and 7 widgets. The
 * third is Form 940-V, the payment voucher — a separate form the instructions
 * say to detach and send with a cheque. Greenway pays by EFTPS, so rendering a
 * voucher nobody should use would only invite somebody to use it. Same stance
 * as the 941 sheet takes with 941-V, for the same reason.
 *
 * Page 2 is not optional. It carries Part 5 — the four quarterly FUTA
 * liabilities and line 17, which MUST equal line 12. A 940 rendered as one
 * page would look finished while omitting the only arithmetic on the form that
 * checks itself.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE IS USUALLY THE BLANK FORM, AND SAYS SO
 * ───────────────────────────────────────────────────────────────────────────
 * Form 940 needs facts no payroll table contains — what was actually paid to
 * Washington in state unemployment tax and when, the experience rate, the
 * state taxable wages, the credit reduction rate, what has been deposited, and
 * the quarterly split for Part 5. `FORM_940_FACTS_ONLY_MICHAEL_KNOWS` lists
 * them, and until they are supplied the engine REFUSES rather than guessing.
 *
 * A refusal is the right answer and a blank page is the wrong way to show it.
 * So the paper renders either way: with his figures when the engine produced
 * them, and with every money box BLANK when it did not — never 0.00, because a
 * zero on a 940 is a statement to the IRS that no such wages were paid. The
 * line under the header always says which of the two is on screen.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FORBIDDEN TO DO
 * ───────────────────────────────────────────────────────────────────────────
 * Change ../page.tsx beyond the door already there. "rather than updating or
 * changing any of it" still holds: the tabbed 940 keeps its checks, its
 * facts-only-Michael-knows list and its explorer, untouched. This is a sibling
 * route, and the scope selector is shared rather than duplicated.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FormFacsimile } from "@/components/admin/books/FormFacsimile";
import { FormPrintBar } from "@/components/admin/books/FormPrintBar";
import { FormScopeBar } from "@/components/admin/books/FormScopeBar";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { nine40IdentityText, type W2Employer } from "@/lib/payroll/form-facsimile-core";
import { form940Boxes, FORM_ID_940 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadForm940 } from "@/lib/payroll/form-940-store";
import { readScope, scopeYears, type FormScope } from "@/lib/payroll/form-scope-core";

export const metadata = { title: "Form 940 — the form itself" };

/**
 * Both pages of the return, in filing order.
 *
 * MEASURED widget counts: 59 and 31. Named as a constant so the count in the
 * "Page 1 of 2" caption can never drift from the list actually rendered.
 */
const NINE40_PAGE_KEYS = ["940-p1", "940-p2"] as const;

export default async function Form940SheetPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  /*
   * Grain "year", stated and not defaulted: Form 940 is the ANNUAL FUTA return.
   * A `?q=` in the address is refused out loud rather than ignored, because
   * somebody who typed one believes the 940 is quarterly - which is the single
   * most common misunderstanding about this form, and the reason Part 5 exists
   * to record four quarterly LIABILITIES on an annual RETURN.
   */
  const now = new Date();
  const scope: FormScope = readScope(sp, now, "year");
  const year = scope.year;

  const loaded = await loadForm940(year);

  /*
   * A read failure is NOT the same as "no facts yet", and the two must not
   * share a presentation. A specimen shown because the database could not be
   * read would present invented figures as though they were his.
   */
  const readFailed = !loaded.ok;
  const live = loaded.ok && loaded.result.ok;
  const boxes = live && loaded.ok && loaded.result.ok
    ? form940Boxes(loaded.result.ret)
    : teachingBoxes(FORM_ID_940);

  /*
   * ═══ WHOSE RETURN THIS IS ═══
   *
   * The same company profile row the 941 sheet and the W-2 sheet read. The IRS
   * reconciles a year's 940 against the four 941s filed under one EIN, so if
   * these pages could disagree about the EIN the disagreement would arrive as a
   * notice months later rather than as an error here. One row, one answer.
   */
  const profileLoad = await loadCompanyProfile();
  const profile = profileLoad.ok ? profileLoad.profile : {};
  const str = (key: string): string | null => {
    const v = profile[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const employer: W2Employer = {
    ein: str("ein"),
    legalName: str("legal_name"),
    street: str("address_line1"),
    city: str("city"),
    state: str("state_code"),
    zip: str("zip_code"),
  };
  const identity = nine40IdentityText(employer, str("trade_name"));

  const missingIdentity: readonly string[] = [
    employer.ein === null ? "the EIN" : null,
    employer.legalName === null ? "the legal business name" : null,
    employer.street === null ? "the business address" : null,
  ].filter((x): x is string => x !== null);

  /*
   * Form 940 has no two-column rows. Lines 4 and 5 look like they might — the
   * paper prints their figures in an inset column — but each is ONE figure that
   * feeds the subtotal on line 6, not a base-and-tax pair like the 941's 5a.
   * So no `columnOne` is passed, and `slotsFor` leaves nothing to fill.
   */

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
      <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-6 print:hidden">
        <Link
          href={`/admin/books/form-940?year=${year}`}
          className="text-xs text-white/45 underline hover:text-white"
        >
          &larr; Back to Form 940, line by line
        </Link>

        {readFailed ? (
          <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
            <strong>Your {year} figures could not be read.</strong> {loaded.message} The form
            below is the blank IRS artwork &mdash; no figure on it is yours.
          </p>
        ) : null}

        {missingIdentity.length > 0 ? (
          <p className="mt-3 rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3 text-xs">
            The top of this form is incomplete: your company profile is missing{" "}
            {missingIdentity.length === 1
              ? missingIdentity[0]
              : `${missingIdentity.slice(0, -1).join(", ")} and ${missingIdentity[missingIdentity.length - 1]}`}
            . Those boxes print blank below rather than guessed. The IRS matches a 940 to your
            account using the EIN and the business name together, so a return missing either
            cannot post.{" "}
            <Link href="/admin/books/company" className="underline hover:text-white">
              Fill in the company profile
            </Link>
            .
          </p>
        ) : null}

        <h1 className="mt-3 text-lg font-semibold tracking-tight">
          Form 940 ({year}) &mdash; as it prints
        </h1>

        <p className="mt-1 text-xs text-white/45">
          {live
            ? `Both pages of the ${year} FUTA return, computed from your payroll records. Page 2 carries Part 5, where the four quarterly liabilities must add to line 12 exactly.`
            : `Your ${year} return is not computed yet, so every money box below is blank \u2014 not zero. Form 940 needs facts no payroll table holds, chiefly what you actually paid Washington in state unemployment tax and when. The line-by-line page lists them.`}
        </p>

        {/*
          Gold, not green, and across the whole form. Not one cent of FUTA is
          withheld from an employee, it never appears on a W-2, and withholding
          it would be unlawful. This is the cleanest case in the whole payroll
          system of a tax that is purely the employer's cost.
        */}
        <p className="mt-2 rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3 text-xs">
          <strong>Every cent on this form is your money.</strong> Nothing here is withheld from
          anybody. The headline rate is 6.0% on the first $7,000 you pay each person, but the
          state unemployment credit takes most employers to 0.6% &mdash; so this return turns
          more on what you paid Washington than on what you paid your staff.
        </p>

        {/*
          Quarters null, employees null. The 940 is annual, and it names no
          employee anywhere on either page - it reports TOTAL payments to all
          employees, so an employee filter would be a control that cannot
          change anything on the paper.
        */}
        <FormScopeBar
          basePath="/admin/books/form-940/sheet"
          scope={scope}
          years={scopeYears(scope, now)}
          quarters={null}
          employees={null}
        />
      </div>

      {/*
        The 940's instructions say "Please type or print within the boxes",
        which is what this does. There is no scannable-red-copy rule as on the
        W-2, so there is no caution to give and none is invented.
      */}
      <FormPrintBar what={`Form 940 (${year})`} />

      {NINE40_PAGE_KEYS.map((pageKey, index) => (
        <div key={pageKey} className="facsimile-sheet-wrap">
          <p className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-4 text-[11px] uppercase tracking-wider text-white/35 print:hidden">
            Page {index + 1} of {NINE40_PAGE_KEYS.length}
            {index === 1 ? " \u2014 Part 5, which must tie to line 12" : ""}
          </p>

          <FormFacsimile
            pageKey={pageKey}
            lessons={FORM_940_LESSONS}
            /*
             * `identity` goes to BOTH sheets. Form 940 repeats the name and EIN
             * at the top of page 2 — the pages get separated in handling — and
             * the box map places those rectangles from this same record.
             * Passing identity only to page 1 would produce an anonymous
             * second sheet, which is the defect rule 123 exists to catch.
             */
            copies={[{ subject: null, boxes, identity }]}
          />
        </div>
      ))}

      {/* The books-47 explorer surface, kept and kept working. The paper is
          better at being the form; a list is better at showing every caption at
          once and is what a screen reader can move through linearly. Hidden
          when printing, because he is printing a 940 and not a web page. */}
      <div className="admin-chrome print:hidden">
        <FormSheet
          title={`Form 940 (${year}) \u2014 line by line`}
          boxes={boxes}
          lessons={FORM_940_LESSONS}
        />
      </div>
    </main>
  );
}
