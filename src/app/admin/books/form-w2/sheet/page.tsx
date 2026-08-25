/**
 * src/app/admin/books/form-w2/sheet/page.tsx   (books-58)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE W-2 AS ONE LARGE PAGE, NOTHING ON IT BUT FORM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael asked for this in as many words:
 *
 *   "Even with the tab system, there is walls of text and information. I like
 *    it how it is and rather than updating or changing any of it, I want to
 *    simply add a way to display the form in one large page with nothing on it
 *    but form. And every box/field that has already been mapped to its learning
 *    lesson, when clicked, should show an info box with all of the lesson
 *    displayed. I don't want to be redirected to the learning center, but have
 *    the lesson brought to me on the form page."
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A NEW ROUTE INSTEAD OF A TAB OR A TOGGLE
 * ──────────────────────────────────────────────────────────────────────────
 * "Rather than updating or changing any of it" is the constraint, and a fourth
 * tab on `../page.tsx` would have meant editing the file he said he likes. A
 * sibling route touches nothing: the tabbed screen is byte-for-byte what it was,
 * and this page can be deleted without leaving a hole in it.
 *
 * It also matches what he actually described - a PAGE, not a mode. The reason
 * the tabbed screen has walls of text is that it is doing something different
 * and doing it well: it explains. This one does not explain. It shows the form.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TEACHING SPECIMEN IS A FALLBACK AND NOT A FAILURE
 * ──────────────────────────────────────────────────────────────────────────
 * Greenway's first payroll is 1 January 2027, so for now there are no W-2 rows
 * to load. books-49 records what happens if a teaching surface is hidden behind
 * `result.ok`: Michael reported "I am unable to see or use the tab system", and
 * the cause was that every teaching surface was gated on data that will not
 * exist for a year. So this page falls back to the teaching specimen - the same
 * `teachingBoxes(FORM_ID_W2)` the tabbed screen already falls back to - whose
 * figures carry `notComputedYet` and therefore print "not computed yet" rather
 * than a fabricated $0.00.
 *
 * The fallback is NOT silent. A line under the title says which it is, because
 * a reader who cannot tell a specimen from his own filed return is one step from
 * copying the wrong figures onto a government portal.
 */

import Link from "next/link";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { w2Boxes, FORM_ID_W2 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadW2s } from "@/lib/payroll/form-w2-store";

export const metadata = { title: "Form W-2 — the form itself" };

/**
 * The most recent year a W-2 can exist for.
 *
 * A W-2 reports a CLOSED year, so the current year is never the default: on
 * 3 March 2027 the form a person wants is the 2026 one. Deliberately duplicated
 * as a small local rule rather than imported from the tabbed page, which does
 * not export it - and exporting it would mean editing that file.
 */
function mostRecentlyClosedYear(now: Date): number {
  return now.getUTCFullYear() - 1;
}

export default async function FormW2SheetPage({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();
  const parsed = Number.parseInt(sp.year ?? "", 10);
  const taxYear =
    Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100
      ? parsed
      : mostRecentlyClosedYear(now);

  const loaded = await loadW2s(taxYear);

  /*
   * A read failure does NOT fall back to the specimen. Showing a specimen
   * because the database could not be read would present invented figures as
   * though they were his, which is the one thing this page must never do. The
   * specimen is for "there is no payroll yet" - a known, honest state - not for
   * "something went wrong".
   */
  const readFailed = !loaded.ok;
  const forms = loaded.ok ? loaded.forms : [];
  const live = forms.length > 0;

  const boxes = live ? w2Boxes(forms[0]) : teachingBoxes(FORM_ID_W2);

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-[var(--admin-text)]">
      <div className="mx-auto w-full max-w-5xl px-4 pt-5">
        <Link
          href={`/admin/books/form-w2?year=${taxYear}`}
          className="text-xs text-white/50 underline hover:text-white"
        >
          ← Back to the full W-2 screen, with the explanations
        </Link>

        {readFailed ? (
          <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
            {loaded.ok ? "" : loaded.message} Nothing below is your filed data — the boxes
            shown are the blank IRS form, and every figure reads &ldquo;not computed
            yet&rdquo;.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-white/45">
          {live
            ? `Showing the W-2 assembled from your ${taxYear} payroll records.`
            : `No ${taxYear} payroll exists yet, so this is the blank IRS form. Every figure reads “not computed yet” — none of them is a zero, because a zero on a W-2 is a claim.`}
        </p>
      </div>

      <FormSheet
        title={`Form W-2 (${taxYear})`}
        boxes={boxes}
        lessons={FORM_W2_BOX_LESSONS}
      />
    </main>
  );
}
