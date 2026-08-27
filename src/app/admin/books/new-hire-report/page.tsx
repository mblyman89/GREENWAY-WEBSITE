/**
 * src/app/admin/books/new-hire-report/page.tsx   (books-68)
 *
 * The DSHS 18-463 Washington New Hire Report, rendered as paper, read-only,
 * with a lesson behind every box. Reached from the button at the top right of
 * the payroll setup screen, which is where Michael asked for it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT HE ASKED FOR, AND WHERE EACH PART LANDED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, books-68:
 *
 *   "I want to create the new hire form and add it to the w-4 payroll setup
 *    page in the same way the other forms are displayed. I want a button in the
 *    setup employee page at the top right corner that shows me the form filled
 *    out and downloadable for me to send to the state. ... I should be able to
 *    see the form empty. And if it's not too much work, learning lessons for
 *    each box would be amazing!"
 *
 *   - "in the same way the other forms are displayed"  -> `FormSheet`, the same
 *     component the 941, 940, W-2 and the four Washington returns use.
 *   - "a button ... top right corner"                  -> payroll-setup/page.tsx
 *   - "filled out and downloadable"                    -> `FormPrintBar`, whose
 *     Save-as-PDF path is what every other sheet already offers.
 *   - "I should be able to see the form empty"         -> `?empty=1`, and also
 *     the natural state of a quarter with no hires. Both draw the real layout.
 *   - "learning lessons for each box"                  -> all twelve boxes, from
 *     form-box-lessons-new-hire.ts. Not one box is undocumented.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS PAGE IS ITS OWN ROUTE AND NOT A PANEL ON THE SETUP SCREEN
 * ═══════════════════════════════════════════════════════════════════════════
 * Because a form is a PAGE, and `window.print()` prints the page it is on. The
 * setup screen is a working surface full of controls; printing it would produce
 * a sheet of buttons with a form somewhere in the middle. Every other form in
 * this system already lives at its own `sheet` route for exactly this reason,
 * and the print CSS those routes rely on assumes the form owns the paper.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO GEOMETRY, AND WHY THAT IS A FINDING RATHER THAN A SHORTCUT
 * ═══════════════════════════════════════════════════════════════════════════
 * The federal sheets place figures into the agency's own `/Widget` rectangles,
 * so the positions are the IRS's answer rather than mine. MEASURED on the DSHS
 * file with `pdfinfo`:
 *
 *     Form: none
 *
 * No AcroForm, no widgets, not one rectangle. There is no agency answer to
 * "where does DATE OF HIRE sit", so placing boxes on that artwork would mean
 * measuring the paper by eye — which is guessing, on a form where a date in the
 * wrong box is a false statement to a child-support registry. Rule 127:
 * geometry is MEASURED from the agency's file, never estimated. This takes the
 * same `FormSheet` path books-65 took for the ESD 5208A, for the same reason.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY, LIKE EVERY OTHER FORM HERE
 * ═══════════════════════════════════════════════════════════════════════════
 * Michael, books-65: "the form should only have numbers on it based on records
 * from the books, not something i snuck in last minute". There is not one input
 * on this page and no server action behind it. Every value arrives from
 * `buildNewHireReport`, which computes nothing of its own.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FormPrintBar } from "@/components/admin/books/FormPrintBar";
import { NEW_HIRE_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-new-hire";
import {
  NEW_HIRE_FORM_ID,
  NEW_HIRE_FORM_TITLE,
  NEW_HIRE_REPORT_DUE_DAYS,
  RCW_26_23_040_URL,
  buildNewHireReport,
  newHireBoxes,
  onlyRefusalIsEmptiness,
} from "@/lib/payroll/new-hire-report-core";
import {
  NEW_HIRE_LOOKBACK_DAYS,
  loadNewHireReport,
} from "@/lib/payroll/new-hire-report-store";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function NewHireReportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireBooksAccess();
  const sp = (await searchParams) ?? {};

  /*
   * "I should be able to see the form empty."
   *
   * A DELIBERATE empty, requested by the URL, and it is not the same thing as
   * a quiet month. When Michael asks for the blank he gets the blank without
   * the database being read at all — no employee rows, and no SSN audit entries
   * written for numbers nobody looked at. Logging a disclosure that did not
   * happen would make the reveal log lie.
   */
  const wantEmpty = sp["empty"] === "1";

  const today = new Date();
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - NEW_HIRE_LOOKBACK_DAYS);

  const loaded = wantEmpty
    ? null
    : await loadNewHireReport({
        sinceYmd: ymd(since),
        actorId: session.userId,
        role: session.profile.role,
      });

  const view = buildNewHireReport({
    employer: loaded?.employer ?? {
      legalName: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      ein: null,
    },
    employees: loaded?.employees ?? [],
    todayYmd: ymd(today),
  });

  /*
   * ═══ THE BOOKS-67 LAW, APPLIED FROM THE START ═══
   *
   * An EMPTY report draws a blank form. A BROKEN one still refuses. Those look
   * identical on screen — both are a form with nothing in it — and they mean
   * opposite things, so the branch is made once, here, and named.
   *
   *   readFailed  - the database could not be read. A FAULT. Never draw.
   *   refusals    - a required fact is missing. A REFUSAL, named by field.
   *   emptiness   - read fine, nobody was hired. HONEST. Draw the blank.
   */
  const readFailed = loaded !== null && loaded.readFailed;
  const drawsBlank = wantEmpty || onlyRefusalIsEmptiness(view.refusals);
  const showsForm = !readFailed && (drawsBlank || view.refusals.length === 0);

  const boxes = newHireBoxes(showsForm && !drawsBlank ? view : null);

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
      <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-6 print:hidden">
        <Link
          href="/admin/books/payroll-setup"
          className="text-xs text-white/45 underline hover:text-white"
        >
          &larr; Back to payroll setup
        </Link>

        <header className="mt-4 space-y-3">
          <h1 className="text-2xl font-semibold text-white">{NEW_HIRE_FORM_TITLE}</h1>
          <p className="text-sm leading-relaxed text-white/60">
            Washington requires a report on every new hire within{" "}
            <strong className="text-white/85">{NEW_HIRE_REPORT_DUE_DAYS} days</strong> of the date
            they start. This is that report, drawn the way DSHS prints it, from the records already
            in your books. Nothing on this page can be typed into &mdash; if something is wrong, it
            is wrong in the employee record, and that is where it gets fixed.{" "}
            <a
              className="underline hover:text-white"
              href={RCW_26_23_040_URL}
              target="_blank"
              rel="noreferrer"
            >
              RCW 26.23.040
            </a>
          </p>

          {/* The lookback is OURS, not the state's, so it says so. Rule 62d. */}
          {!wantEmpty && (
            <p className="text-xs text-white/40">
              Showing hires from the last {NEW_HIRE_LOOKBACK_DAYS} days. That window is ours, not a
              DSHS rule &mdash; it is long enough that a hire which is already late still appears
              instead of quietly dropping off the screen.{" "}
              <Link className="underline hover:text-white" href="?empty=1">
                Show me the blank form instead
              </Link>
            </p>
          )}
          {wantEmpty && (
            <p className="text-xs text-white/40">
              This is the blank form. No employee records were read to draw it.{" "}
              <Link className="underline hover:text-white" href="/admin/books/new-hire-report">
                Show me my actual hires
              </Link>
            </p>
          )}
        </header>

        {/* ── A FAULT IS NOT A BLANK FORM ─────────────────────────────────── */}
        {readFailed && (
          <div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">
            <strong className="block text-red-50">The records could not be read.</strong>
            No form is drawn, on purpose. An empty form here would look exactly like &ldquo;nobody
            was hired&rdquo;, and those are not the same thing. Nothing is wrong with your filing
            obligation &mdash; something is wrong with this screen.
          </div>
        )}

        {/* ── A REFUSAL NAMES THE FIELD AND THE PERSON ────────────────────── */}
        {!readFailed && !drawsBlank && view.refusals.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <strong className="block text-amber-50">
              This report is not complete enough to send, so it has not been drawn.
            </strong>
            <p className="mt-1 text-amber-100/80">
              An incomplete new-hire report is a failure to report, and RCW 26.23.040(5) charges{" "}
              <strong>$25 per month, per employee</strong> for one. Better to see what is missing
              here than to mail a form with a hole in it.
            </p>
            <ul className="mt-3 space-y-1.5">
              {view.refusals.map((r, i) => (
                <li key={`${r.code}-${r.employeeId ?? "co"}-${i}`} className="text-amber-100/90">
                  &bull; {r.because}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── AN HONEST BLANK SAYS SO ─────────────────────────────────────── */}
        {!readFailed && drawsBlank && !wantEmpty && view.emptyReason !== null && (
          <div className="mt-4 rounded-lg border border-white/15 bg-white/5 p-4 text-sm text-white/70">
            {view.emptyReason}
          </div>
        )}

        {loaded !== null && loaded.auditWriteFailed && (
          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            The Social Security numbers were withheld because the disclosure could not be recorded.
            This is deliberate: if the log fails, the reveal fails. The refusals above name it as a
            missing SSN, which is what it is on the paper.
          </div>
        )}

        {showsForm && (
          <div className="mt-4">
            <FormPrintBar
              what={NEW_HIRE_FORM_TITLE}
              caution={
                drawsBlank
                  ? "This is a blank specimen. It carries no employee's details and must not be mailed as a return."
                  : "Check every box against the employee record before you mail it. This is your report, not a filing service's."
              }
            />
          </div>
        )}
      </div>

      {/* ── THE FORM ITSELF ───────────────────────────────────────────────── */}
      {showsForm && (
        <div className="admin-chrome">
          <FormSheet
            title={NEW_HIRE_FORM_TITLE}
            boxes={boxes}
            lessons={NEW_HIRE_BOX_LESSONS}
          />
        </div>
      )}

      {/* ── THE PEOPLE, ONE BLOCK EACH, PAGINATED AS THE PAPER PAGINATES ──── */}
      {showsForm && !drawsBlank && (
        <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pb-12">
          {view.pages.map((page) => (
            <section key={page.pageNumber} className="mt-6 break-after-page last:break-after-auto">
              <h2 className="text-xs uppercase tracking-wide text-white/40">
                Page {page.pageNumber} of {view.pages.length} &mdash; up to four employees per
                sheet, exactly as DSHS prints it
              </h2>
              {page.blocks.map((b) => (
                <article
                  key={b.employeeId}
                  className="mt-3 rounded-lg border border-white/12 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">{b.displayName}</h3>
                    {b.deadline !== null && (
                      <span
                        className={
                          b.deadline.overdue
                            ? "text-xs font-semibold text-red-300"
                            : "text-xs text-white/50"
                        }
                      >
                        {b.deadline.overdue
                          ? `Overdue by ${Math.abs(b.deadline.daysRemaining)} day(s) — due ${b.deadline.dueYmd}`
                          : `Due ${b.deadline.dueYmd} — ${b.deadline.daysRemaining} day(s) left`}
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    {b.cells.map((c) => (
                      <div key={c.caption}>
                        <dt className="text-[10px] uppercase tracking-wide text-white/35">
                          {c.caption}
                        </dt>
                        <dd className="text-sm text-white/85">{c.value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </section>
          ))}
          <p className="mt-6 text-xs text-white/35">
            Form {NEW_HIRE_FORM_ID.replace(/_/g, "-").toUpperCase()} &mdash; {view.totalEmployees}{" "}
            employee{view.totalEmployees === 1 ? "" : "s"} on {view.pages.length} sheet
            {view.pages.length === 1 ? "" : "s"}. The last sheet is left short rather than padded;
            a repeated name on a child-support registry report would be a false statement.
          </p>
        </div>
      )}
    </main>
  );
}
