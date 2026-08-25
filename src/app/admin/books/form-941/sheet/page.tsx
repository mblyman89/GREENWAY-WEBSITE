/**
 * src/app/admin/books/form-941/sheet/page.tsx   (books-60)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE 941 AS ONE LARGE PAGE, NOTHING ON IT BUT FORM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, in books-58, asked for exactly this and then asked for more of it:
 *
 *   "Even with the tab system, there is walls of text and information. I like
 *    it how it is and rather than updating or changing any of it, I want to
 *    simply add a way to display the form in one large page with nothing on it
 *    but form. And every box/field that has already been mapped to its learning
 *    lesson, when clicked, should show an info box with all of the lesson
 *    displayed. I don't want to be redirected to the learning center, but have
 *    the lesson brought to me on the form page."
 *
 * And then, in books-59:
 *
 *   "get back to work on the forms. i really want to see and interact with the
 *    forms now."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE 941 IS THE RIGHT SECOND FORM, AND NOT AN ARBITRARY PICK
 * ───────────────────────────────────────────────────────────────────────────
 * The W-2 sheet shipped in books-58 with a real hole in its test coverage that
 * nothing could close: the W-2 has zero untaught boxes, so the "not taught yet"
 * marker the sheet renders was UNREACHABLE on the only form that had a sheet.
 * Standing rule 40 says an unreachable guard is an untested guard, and that is
 * not a theoretical complaint -- it means the marker sat there looking finished
 * with nobody able to prove it renders.
 *
 * The 941 is the form that closes it. After books-60's lesson work it has 24
 * taught boxes and 3 untaught ones (12, 13 and 14, left untaught on purpose --
 * see the header of form-box-lessons-941.ts). So this page renders BOTH
 * affordances for the first time on the same screen, and the marker stops being
 * a claim.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FORBIDDEN TO DO
 * ───────────────────────────────────────────────────────────────────────────
 * Change anything on ../page.tsx beyond adding the door. He said "rather than
 * updating or changing any of it" about the tabbed screen, and that still
 * holds: the tabbed 941 keeps its checks, its confirmation panel, its deposit
 * schedule and its explorer, untouched. This is a sibling route.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE TEACHING SPECIMEN IS A FALLBACK AND NOT A FAILURE
 * ───────────────────────────────────────────────────────────────────────────
 * Greenway's first payroll under this system is 1 January 2027, so for most
 * quarters there is no return to build. books-49 records what happens when a
 * teaching surface is gated on data that does not exist yet: Michael reported
 * "I am unable to see or use the tab system", and he was right. So this page
 * falls back to `teachingBoxes(FORM_ID_941)`, whose figures carry
 * `notComputedYet` and therefore print "not computed yet" rather than a
 * fabricated $0.00 -- because a zero on a 941 is a claim to the IRS, not an
 * absence of one.
 *
 * THE FALLBACK IS NEVER SILENT. A line under the header says which of the two
 * a reader is looking at. Someone who cannot tell a blank specimen from his own
 * computed return is one step from typing invented figures into EFTPS.
 *
 * AND A READ FAILURE IS NOT A FALLBACK. If the store cannot be read, this page
 * says so and shows the specimen explicitly labelled as not-his-data. Falling
 * back to a specimen because the database broke would present invented figures
 * as though they were his, which is the single thing this page must never do.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { form941Boxes, FORM_ID_941 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadForm941 } from "@/lib/payroll/form-941-store";
import { formatQuarter, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

export const metadata = { title: "Form 941 — the form itself" };

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

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-[var(--admin-text)]">
      <div className="mx-auto w-full max-w-5xl px-4 pt-5">
        <Link
          href={`/admin/books/form-941?year=${quarter.year}&q=${quarter.quarter}`}
          className="text-xs text-white/50 underline hover:text-white"
        >
          &larr; Back to the full 941 screen, with the checks and the explanations
        </Link>

        {readFailed ? (
          <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
            {loaded.ok ? "" : loaded.message} Nothing below is your data &mdash; the boxes
            shown are the blank IRS form, and every figure reads &ldquo;not computed
            yet&rdquo;.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-white/45">
          {live
            ? `Showing the 941 computed from your ${formatQuarter(quarter)} payroll records.`
            : `No ${formatQuarter(quarter)} payroll exists yet, so this is the blank IRS form. Every figure reads \u201cnot computed yet\u201d \u2014 none of them is a zero, because a zero on a 941 is a statement to the IRS.`}
        </p>
      </div>

      <FormSheet
        title={`Form 941 (${formatQuarter(quarter)})`}
        boxes={boxes}
        lessons={FORM_941_LESSONS}
      />
    </main>
  );
}
