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
import { form941Boxes, FORM_ID_941 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadForm941 } from "@/lib/payroll/form-941-store";
import { formatQuarter, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

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
 * The quarter that most recently ENDED.
 *
 * A 941 reports a CLOSED quarter, so "today's quarter" is never the right
 * default: on 5 May the return a person wants is Q1's. Deliberately duplicated
 * as a small local rule rather than imported from ../page.tsx, which does not
 * export it -- and exporting it would mean editing the file he asked me not to
 * touch. The duplication is three lines and is pinned by a test that requires
 * both copies to agree.
 */
function mostRecentlyClosedQuarter(today: Date): QuarterRef {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3) + 1;
  if (q === 1) return { year: y - 1, quarter: 4 };
  return { year: y, quarter: (q - 1) as 1 | 2 | 3 | 4 };
}

/**
 * The eight most recently closed quarters, newest first.
 *
 * ═══ WHY EIGHT, AND WHY THIS IS A LIST OF LINKS AT ALL ═══
 *
 * Michael: "We have multiple quarters, so that means needing forms that can
 * produce those quarters or those data and such." A route that reads `?year=` and
 * `?q=` technically produces any quarter - but only for somebody willing to
 * type a URL, and rule 125(d) is explicit that a run needs a way in that is not
 * a URL.
 *
 * Eight because that is TWO YEARS, and two years is the window the IRS itself
 * uses: the lookback period that decides whether a business deposits monthly or
 * semiweekly is the four quarters ending 30 June of the preceding year, so
 * anybody checking their own deposit schedule needs to see two years of returns
 * at once. `lookbackQuartersFor` in the deposit-schedule core works on exactly
 * that window. Eight links is also small enough to read without a dropdown.
 */
function recentQuarters(from: QuarterRef, count = 8): readonly QuarterRef[] {
  const out: QuarterRef[] = [];
  let { year, quarter } = from;
  for (let i = 0; i < count; i += 1) {
    out.push({ year, quarter });
    if (quarter === 1) {
      year -= 1;
      quarter = 4;
    } else {
      quarter = (quarter - 1) as 1 | 2 | 3 | 4;
    }
  }
  return out;
}

export default async function FormNine41SheetPage({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string; q?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();
  const parsedYear = Number.parseInt(sp.year ?? "", 10);
  const parsedQ = Number.parseInt(sp.q ?? "", 10);
  const fallback = mostRecentlyClosedQuarter(now);

  /*
   * Both halves of the quarter must be valid or NEITHER is used. Accepting a
   * good year with a nonsense quarter would silently show a different period
   * than the URL asked for, and the heading would agree with itself while
   * being wrong -- the hardest kind of error to notice.
   */
  const quarter: QuarterRef =
    Number.isInteger(parsedYear) &&
    parsedYear >= 2020 &&
    parsedYear <= 2100 &&
    parsedQ >= 1 &&
    parsedQ <= 4
      ? { year: parsedYear, quarter: parsedQ as 1 | 2 | 3 | 4 }
      : fallback;

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

  const quarters = recentQuarters(fallback);

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
          ═══ ONE PERIOD, DIRECTLY ═══

          Rule 125(d): a run needs three ways in, and on the 941 the period IS
          the run. Two years of quarters, because two years is the IRS's own
          lookback window for deciding a deposit schedule.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-white/40">Go to a quarter:</span>
          {quarters.map((q) => {
            const isNow = q.year === quarter.year && q.quarter === quarter.quarter;
            return (
              <Link
                key={`${q.year}-${q.quarter}`}
                href={`/admin/books/form-941/sheet?year=${q.year}&q=${q.quarter}`}
                className={[
                  "rounded border px-2 py-0.5",
                  isNow
                    ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-white"
                    : "border-white/15 text-white/60 hover:bg-white/10",
                ].join(" ")}
              >
                {formatQuarter(q)}
              </Link>
            );
          })}
        </div>
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
            Page {index + 1} of {NINE41_PAGE_KEYS.length}
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
