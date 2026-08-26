/**
 * src/app/admin/books/form-941/sheet/page.tsx   (books-60, rebuilt in books-61)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE 941 ON THE ACTUAL PAPER - BOTH PAGES, ANY QUARTER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, in books-58, asked for this and then asked for more of it:
 *
 *   "Even with the tab system, there is walls of text and information. I like
 *    it how it is and rather than updating or changing any of it, I want to
 *    simply add a way to display the form in one large page with nothing on it
 *    but form. And every box/field that has already been mapped to its learning
 *    lesson, when clicked, should show an info box with all of the lesson
 *    displayed. I don't want to be redirected to the learning center, but have
 *    the lesson brought to me on the form page."
 *
 * Then, plainer, when the first attempt rendered a styled LIST of boxes:
 *
 *   "When I had asked for the physical form to be displayed on the page by
 *    itself, I meant literally. I am hoping that for all the various forms, I
 *    can see the form as it would look if I were holding it in my hand. ...
 *    I want to be able to export the form to be added to my digital records."
 *
 * And then, raising the bar again:
 *
 *   "I want what the cpa needs. ... We have multiple quarters, so that means
 *    needing forms that can produce those quarters or those data and such. ...
 *    It's meant to be a part of the process for bookkeeping and taxes, not just
 *    informative."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE IS TWO SHEETS AND NOT ONE
 * ───────────────────────────────────────────────────────────────────────────
 * Because Form 941 IS two sheets. `pdfinfo` reports three pages in f941.pdf:
 * page 1 (lines 1-15), page 2 (lines 16-18 plus the signature block), and
 * page 3, which is Form 941-V, the payment voucher - a DIFFERENT form that the
 * IRS's own instructions say to detach and send with a cheque.
 *
 * Rendering only page 1 would leave out line 16, the monthly deposit liability
 * schedule, which is the single most consequential thing on the return for a
 * business that deposits monthly - and it would do so while looking finished.
 * That is the same failure as filling the top W-2 and not the bottom one
 * (rule 123), so both pages are here, in order, each on its own sheet of paper.
 *
 * The 941-V voucher is deliberately NOT rendered. It is not part of the return,
 * it is only used when paying by cheque, and Greenway pays by EFTPS. Rendering
 * a payment voucher nobody should use would invite somebody to use it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY COLUMN 1 IS PASSED IN AND NOT DERIVED
 * ───────────────────────────────────────────────────────────────────────────
 * Lines 5a and 5c each have TWO columns on the paper: a wage base and the tax
 * on it. The engine states both - `oasdiTaxableWagesCents` and
 * `medicareTaxableWagesCents` are the exact integers it fed to `applyMilliPct`.
 *
 * Recovering the base by dividing the tax by the rate would look right and be
 * wrong: division does not invert that function's rounding, so the recovered
 * base would be a cent or two out on most quarters. On a form the IRS reconciles
 * arithmetically, a cent is a discrepancy letter.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FORBIDDEN TO DO
 * ───────────────────────────────────────────────────────────────────────────
 * Change anything on ../page.tsx beyond the door that is already there. He said
 * "rather than updating or changing any of it", and that still holds: the tabbed
 * 941 keeps its checks, its confirmation panel, its deposit schedule and its
 * explorer, untouched. This is a sibling route.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE TEACHING SPECIMEN IS A FALLBACK AND NOT A FAILURE
 * ───────────────────────────────────────────────────────────────────────────
 * Greenway's first payroll under this system is 1 January 2027, so for most
 * quarters there is no return to build. books-49 records what happens when a
 * teaching surface is gated on data that does not exist yet: Michael reported
 * "I am unable to see or use the tab system", and he was right. So this page
 * falls back to `teachingBoxes(FORM_ID_941)`, whose figures carry
 * `notComputedYet` and therefore print BLANK on the paper rather than a
 * fabricated $0.00 - because a zero on a 941 is a claim to the IRS.
 *
 * THE FALLBACK IS NEVER SILENT. A line under the header says which of the two a
 * reader is looking at. Someone who cannot tell a blank specimen from his own
 * computed return is one step from typing invented figures into EFTPS.
 *
 * AND A READ FAILURE IS NOT A FALLBACK. If the store cannot be read, this page
 * says so and shows the specimen explicitly labelled as not-his-data.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FormFacsimile } from "@/components/admin/books/FormFacsimile";
import { FormPrintBar } from "@/components/admin/books/FormPrintBar";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { nine41IdentityText, type W2Employer } from "@/lib/payroll/form-facsimile-core";
import { scheduleBLiability } from "@/lib/payroll/form-941-schedule-b-core";
import {
  SCHEDULE_B_LESSONS,
  scheduleBBoxes,
  scheduleBIdentityText,
  scheduleBTeachingBoxes,
} from "@/lib/payroll/form-941-schedule-b-boxes";
import { form941Boxes, FORM_ID_941 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadForm941 } from "@/lib/payroll/form-941-store";
import { formatQuarter, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import { FormScopeBar } from "@/components/admin/books/FormScopeBar";
import {
  mostRecentlyClosedQuarter,
  readScope,
  scopeQuarters,
  scopeYears,
  type FormScope,
} from "@/lib/payroll/form-scope-core";

export const metadata = { title: "Form 941 — the form itself" };

/**
 * The 941 is printed on two sheets, in this order.
 *
 * A list rather than a single key, because the form does not fit on one piece of
 * paper and a page that renders the first sheet only omits line 16 while looking
 * complete.
 */
const NINE41_PAGE_KEYS = ["941-p1", "941-p2"] as const;

/**
 * Schedule B is a SEPARATE FORM, not a third page of the 941.
 *
 * It has its own lessons, its own box ids (a 93-cell calendar rather than
 * numbered lines) and its own artwork, so it is rendered from its own boxes
 * below the return rather than folded into the loop above.
 *
 * Michael: "I am a schedule b filer, so we don't need to compute the monthly
 * payment." So the 941's own monthly grid on line 16 stays blank and this
 * schedule carries the liability - which is what his filed Q2 return does.
 */
const SCHEDULE_B_PAGE_KEY = "941sb";

/*
 * BOTH LOCAL HELPERS MOVED TO form-scope-core.ts IN books-63.
 *
 * `mostRecentlyClosedQuarter` and `recentQuarters` lived here, and this file's
 * own comment admitted the problem: "Deliberately duplicated as a small local
 * rule ... The duplication is three lines and is pinned by a test that requires
 * both copies to agree."
 *
 * It was not two copies. It was SIX - three of the quarter rule and three of the
 * year rule, across six form pages - and the `?year=` bounds check was spelled
 * three different ways between them. Michael asked for filtering that "works
 * with the full form workflow and all its tabs and pages", and six copies of the
 * period rule is the thing that makes that impossible to promise.
 *
 * `recentQuarters(from, 8)` is now `scopeQuarters(scope, now)`, which keeps the
 * eight-quarter window AND its reasoning (two years = the IRS lookback period),
 * and additionally guarantees the SELECTED quarter is in the list - so a link to
 * Q1 2021 no longer renders a picker that cannot show where you are.
 */

export default async function FormNine41SheetPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();
  /*
   * Grain "quarter", stated and not defaulted. `readScope` keeps this page's own
   * both-halves-or-neither rule - see its docblock, which quotes the reasoning
   * from this file - and adds the half it was missing: it now RECORDS the
   * substitution so `FormScopeBar` can say it out loud. `?year=2025&q=7` used to
   * render Q2 2026 under a heading reading "Q2 2026", self-consistent and wrong.
   */
  const scope: FormScope = readScope(sp, now, "quarter");

  /*
   * `scope.quarter` is non-null because the grain is "quarter" - readScope
   * guarantees it and a gate pins it. Narrowed explicitly rather than asserted
   * with `!`, because a non-null assertion here would be a promise the compiler
   * cannot keep if the grain above is ever changed.
   */
  const quarter: QuarterRef = {
    year: scope.year,
    quarter: scope.quarter ?? mostRecentlyClosedQuarter(now).quarter,
  };

  const loaded = await loadForm941(quarter);

  const readFailed = !loaded.ok;
  /*
   * `subjectCount > 0` is the same condition ../page.tsx uses to decide between
   * the computed return and the specimen. It matters that it is the SUBJECT
   * count and not `result.ok`: the engine happily builds a return for a quarter
   * with nobody in it, and that return is all zeroes -- which would print as
   * real figures. See books-49.
   */
  const live = loaded.ok && loaded.result.ok && loaded.result.subjectCount > 0;

  const boxes = live ? form941Boxes(loaded.result) : teachingBoxes(FORM_ID_941);

  /*
   * ═══ WHOSE RETURN THIS IS ═══
   *
   * Read from the SAME company profile row the W-2 sheet reads, deliberately.
   * The SSA and the IRS reconcile a year's W-2s against the four 941s filed
   * under one EIN; if this page and that one could disagree about the EIN, the
   * disagreement would surface as a notice months later rather than as an error
   * here. One row, one answer.
   *
   * Trade name is read as well as legal name because Form 941 prints them in
   * TWO SEPARATE BOXES. Greenway's own filed Q2 return shows why they cannot be
   * collapsed: the name box reads "LYMAN'S MARIJUANA" - the name the EIN was
   * issued to - and the trade-name box reads "GREENWAY MARIJUANA". Putting the
   * trading name in the legal-name box is a name-control mismatch, which is one
   * of the most common reasons a return fails to post to the right account.
   *
   * A MISSING PROFILE IS NOT AN ERROR HERE. Absent fields become null and null
   * prints blank, so the form is visibly unfinished rather than plausibly
   * wrong. What must never appear is a placeholder EIN.
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
  const identity = nine41IdentityText(employer, str("trade_name"));

  /*
   * The three the IRS cannot process the return without. Checked as a POSITIVE
   * statement on screen rather than left for him to notice: a 941 with no EIN
   * is not a return, it is a page of arithmetic nobody can match to a taxpayer,
   * and the failure mode is a blank box that reads as an unfilled form.
   */
  const missingIdentity: readonly string[] = [
    employer.ein === null ? "the EIN" : null,
    employer.legalName === null ? "the legal business name" : null,
    employer.street === null ? "the business address" : null,
  ].filter((x): x is string => x !== null);

  /*
   * ═══ THE TWO-COLUMN LINES ═══
   *
   * Only when live. The specimen has no wage base to state, and inventing one
   * would put a figure in column 1 of line 5a that no computation stands behind.
   */
  const columnOne: Readonly<Record<string, number>> =
    live && loaded.ok && loaded.result.ok
      ? {
          "5a": loaded.result.oasdiTaxableWagesCents,
          "5c": loaded.result.medicareTaxableWagesCents,
        }
      : {};

  /*
   * ═══ SCHEDULE B ═══
   *
   * Built from the SAME read, and anchored on the SAME line 12, so it cannot
   * disagree with the return above it. `scheduleBLiability` refuses rather than
   * returning an approximate schedule - see D-05 - and a refusal is shown as a
   * refusal, because a blank Schedule B beside a filled 941 reads as a form
   * that has not been started.
   */
  const scheduleB =
    live && loaded.ok && loaded.result.ok
      ? scheduleBLiability({
          quarter,
          paydays: loaded.paydays,
          line12Cents: loaded.result.totalTaxCents,
        })
      : null;

  const scheduleBBoxList =
    scheduleB !== null && scheduleB.ok
      ? scheduleBBoxes(scheduleB, employer)
      : scheduleBTeachingBoxes(quarter);

  const quarters = scopeQuarters(scope, now);

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-[var(--admin-text)] print:bg-white">
      <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-5 print:hidden">
        <Link
          href={`/admin/books/form-941?year=${quarter.year}&q=${quarter.quarter}`}
          className="text-xs text-white/50 underline hover:text-white"
        >
          &larr; Back to the full 941 screen, with the checks and the explanations
        </Link>

        {readFailed ? (
          <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
            {loaded.ok ? "" : loaded.message} Nothing below is your data &mdash; the form
            shown is the blank IRS form, and every figure reads &ldquo;not computed
            yet&rdquo;.
          </p>
        ) : null}

        {/*
          ═══ THE FORM CANNOT BE FILED WITHOUT THESE ═══

          Said out loud, with the fix one click away. A blank name box looks
          like a form nobody has started, not like a form that is broken, and
          that is precisely why it needs saying: the IRS matches a return to an
          account on the EIN and the name control together.
        */}
        {missingIdentity.length > 0 ? (
          <p className="mt-3 rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3 text-xs">
            The top of this form is incomplete: your company profile is missing{" "}
            {missingIdentity.length === 1
              ? missingIdentity[0]
              : `${missingIdentity.slice(0, -1).join(", ")} and ${missingIdentity[missingIdentity.length - 1]}`}
            . Those boxes print blank below rather than guessed. The IRS matches a
            941 to your account using the EIN and the business name together, so a
            return missing either cannot post.{" "}
            <Link href="/admin/books/company" className="underline hover:text-white">
              Fill in the company profile
            </Link>
            .
          </p>
        ) : null}

        <h1 className="mt-3 text-lg font-semibold tracking-tight">
          Form 941 ({formatQuarter(quarter)}) &mdash; as it prints
        </h1>

        <p className="mt-1 text-xs text-white/45">
          {live
            ? `Both pages of the 941 computed from your ${formatQuarter(quarter)} payroll records. Page 2 carries line 16, the monthly deposit liability \u2014 the part your deposit schedule depends on.`
            : `No ${formatQuarter(quarter)} payroll exists yet, so this is the blank IRS form. Every figure is left blank \u2014 none of them is a zero, because a zero on a 941 is a statement to the IRS.`}
        </p>

        {/*
          ONE PERIOD, DIRECTLY - now through the shared bar.

          Rule 125(d): a run needs a way in that is not a URL, and on the 941 the
          period IS the run. This was an ad-hoc pill row; it is now the same
          component the 940 and W-2 sheets use, so the eight-quarter window, the
          highlighting and the refusal notice cannot drift between them.

          `scopeYears` is also passed, which the old row had no equivalent of: it
          jumps a whole year while KEEPING the quarter, so "same quarter, last
          year" is one click. That is the comparison an owner actually makes, and
          it was four clicks before.
        */}
        <FormScopeBar
          basePath="/admin/books/form-941/sheet"
          scope={scope}
          years={scopeYears(scope, now)}
          quarters={quarters}
          employees={null}
        />
      </div>

      {/*
        The 941 carries no print caution of its own. Its instructions say "Type
        or print within the boxes", which is what this does, and unlike the W-2
        there is no scannable-red-copy rule to warn about. Saying nothing is
        correct here; inventing a caution would be worse than none.
      */}
      <FormPrintBar what={`Form 941 (${formatQuarter(quarter)})`} />

      {/* ══ THE PAPER - BOTH SHEETS ═════════════════════════════════════════
          Boxes for lines that live on the other page are skipped silently by
          `facsimileBoxes`, so the same box list is handed to both sheets and
          each takes the lines the IRS put on it. */}
      {NINE41_PAGE_KEYS.map((pageKey, index) => (
        <div key={pageKey} className="facsimile-sheet-wrap">
          <p className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-4 text-[11px] uppercase tracking-wider text-white/35 print:hidden">
            Page {index + 1} of {NINE41_PAGE_KEYS.length} &mdash; then Schedule B
          </p>

          <FormFacsimile
            pageKey={pageKey}
            lessons={FORM_941_LESSONS}
            /*
             * One form per sheet - `copy_partition` measured exactly one copy on
             * each 941 page, unlike the W-2's two. `subject` is null because the
             * 941 is about the business, not about a person.
             */
            /*
             * `identity` goes to BOTH sheets, not just page 1. Form 941 repeats
             * the name and EIN in its own page-2 header - the IRS's stated
             * reason is that the pages get separated in handling - and the
             * geometry places those two rectangles on page 2 from this same
             * record. Passing identity only to page 1 would produce a page 2
             * with an anonymous header, which is exactly the defect this slice
             * found on page 1.
             */
            copies={[{ subject: null, boxes, columnOne, identity }]}
          />
        </div>
      ))}

      {/* ══ SCHEDULE B ═════════════════════════════════════════════════════════
          Its own form, its own lessons, its own artwork. Printed after the
          return because that is the order it is filed in. */}
      <div className="facsimile-sheet-wrap">
        <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-4 print:hidden">
          <p className="text-[11px] uppercase tracking-wider text-white/35">
            Schedule B (Form 941) &mdash; required, because Greenway is a semiweekly depositor
          </p>

          {scheduleB !== null && !scheduleB.ok ? (
            <p className="mt-2 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
              <strong>This Schedule B was not produced.</strong> {scheduleB.explanation} The
              schedule below is blank &mdash; no figure on it is yours. Fix the disagreement
              rather than filing a schedule that does not tie.
            </p>
          ) : null}

          {scheduleB !== null && scheduleB.ok ? (
            <p className="mt-2 text-xs text-white/45">{scheduleB.plain}</p>
          ) : null}

          {scheduleB === null ? (
            <p className="mt-2 text-xs text-white/45">
              No {formatQuarter(quarter)} payroll exists yet, so every numbered space is
              blank. A zero on a Schedule B would state that a payday happened and produced
              no tax.
            </p>
          ) : null}
        </div>

        <FormFacsimile
          pageKey={SCHEDULE_B_PAGE_KEY}
          lessons={SCHEDULE_B_LESSONS}
          /*
           * No `columnOne`: Schedule B has no two-column rows. Every money box
           * is one figure split into its own dollars and cents rectangles.
           */
          copies={[
            {
              subject: null,
              boxes: scheduleBBoxList,
              identity:
                scheduleB !== null && scheduleB.ok
                  ? scheduleBIdentityText(employer, quarter)
                  : {},
            },
          ]}
        />
      </div>

      {/* ══ THE SAME BOXES AS A LIST ════════════════════════════════════════
          The books-60 sheet, kept and kept working. It is better than the paper
          at some things - it groups the lines, shows every caption at once, and
          is what a screen reader can move through linearly. The paper is better
          at being the form. Neither replaces the other, so both are here, and
          this one is hidden when printing because he is printing a 941, not a
          web page. */}
      <div className="admin-chrome print:hidden">
        <FormSheet
          title={`Form 941 (${formatQuarter(quarter)}) — line by line`}
          boxes={boxes}
          lessons={FORM_941_LESSONS}
        />
      </div>
    </main>
  );
}
