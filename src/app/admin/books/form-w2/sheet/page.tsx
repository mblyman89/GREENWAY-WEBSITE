/**
 * src/app/admin/books/form-w2/sheet/page.tsx   (books-58, rebuilt in books-61)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE W-2 RUN, ON THE ACTUAL PAPER, FILLED, CLICKABLE AND PRINTABLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * books-58 answered this:
 *
 *   "I want to simply add a way to display the form in one large page with
 *    nothing on it but form. And every box/field that has already been mapped to
 *    its learning lesson, when clicked, should show an info box with all of the
 *    lesson displayed. I don't want to be redirected to the learning center, but
 *    have the lesson brought to me on the form page."
 *
 * It answered it with a styled LIST of boxes, so he said it again, plainer:
 *
 *   "When I had asked for the physical form to be displayed on the page by
 *    itself, I meant literally. I am hoping that for all the various forms, I can
 *    see the form as it would look if I were holding it in my hand. This form
 *    would get filled with real data automatically as it should... Then, if I
 *    click a box or field on the actual form, the lesson would open in the same
 *    manner, an overlay over the form that you click to see and click to un-see.
 *    I am a visual learner and this is the best way for me to learn. ... I want
 *    to be able to export the form to be added to my digital records. Sage allows
 *    me to do this and it is something we will do too."
 *
 * And then, having seen the first single sheet, he raised the bar again:
 *
 *   "I am hoping you are building these forms in a way that is genius and
 *    professional and expert. This is where you add value as if you are the one
 *    using this platform. How would you want and need to interact with these
 *    forms? I want what the cpa needs. We have many employees so that means many
 *    w-2s. ... It's meant to be a part of the process for bookkeeping and taxes,
 *    not just informative."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE IS A RUN AND NOT A FORM
 * ─────────────────────────────────────────────────────────────────────────────
 * Greenway filed ten W-2s for 2025. A page that renders one of them and stops is
 * a demo, and it fails the specific job he named: being part of the process for
 * bookkeeping and taxes. So this renders the WHOLE YEAR, paginated exactly the
 * way his own filing paginates it - which was measured off that filing rather
 * than invented:
 *
 *     2025_FORM_W-2_EMPLOYEE.pdf   10 employees, 2 per sheet, 5 sheets,
 *                                  surname order, filled top-then-bottom
 *
 * Two per sheet is not a choice either. The IRS Copy B page IS two W-2s, at a
 * pitch of exactly 396.0pt, measured from the artwork and corroborated by the
 * agency's own `CopyB_Top` / `CopyB_Bottom` field names. The count comes from
 * the geometry via `copiesOnSheet`, because it belongs to the COPY and not to
 * the form: his employer copy is the same W-2 printed 4-up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE QUESTIONS A CPA ACTUALLY ASKS
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. "Let me see the whole run."      -> the default; every sheet, in order.
 *   2. "Show me Lyman's W-2."           -> `?employee=<id>`, one sheet.
 *   3. "Which year?"                    -> `?year=`, with the years listed.
 *
 * A route that only answers "sheet 4 of 5" answers none of them, so all three
 * are here and each one is a link rather than a URL he has to construct.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TEACHING SPECIMEN IS A FALLBACK AND NOT A FAILURE
 * ─────────────────────────────────────────────────────────────────────────────
 * Greenway's first payroll under this system is 1 January 2027, so there are no
 * W-2 rows to load yet. books-49 records what happens when a teaching surface is
 * gated on data that does not exist: Michael reported "I am unable to see or use
 * the tab system", and he was right. So with no payroll this renders the blank
 * IRS form and says so, and every figure reads as blank rather than as a
 * fabricated $0.00 - because a zero on a W-2 is a claim, not an absence.
 *
 * AND A READ FAILURE IS NOT A FALLBACK. If the store cannot be read this page
 * says so in as many words. Falling back to a specimen because the database
 * broke would present invented figures as though they were his, which is the one
 * thing this page must never do.
 */

import Link from "next/link";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FormFacsimile } from "@/components/admin/books/FormFacsimile";
import { FormPrintBar } from "@/components/admin/books/FormPrintBar";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { w2Boxes, FORM_ID_W2 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { loadW2s } from "@/lib/payroll/form-w2-store";
import type { W2Form } from "@/lib/payroll/form-w2-core";
import {
  byPaperOrder,
  paginateRun,
  w2IdentityText,
  type W2Employer,
} from "@/lib/payroll/form-facsimile-core";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";

export const metadata = { title: "Form W-2 — the form itself" };

const W2_PAGE_KEY = "w2-copyb";

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
  searchParams?: Promise<{ year?: string; employee?: string; sheet?: string }>;
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
   * though they were his. The specimen is for "there is no payroll yet" - a
   * known, honest state - not for "something went wrong".
   */
  const readFailed = !loaded.ok;
  const forms: readonly W2Form[] = loaded.ok ? loaded.forms : [];
  const live = forms.length > 0;

  /*
   * ═══ WHO THE EMPLOYER IS ═══
   *
   * Read from the company profile - the same row the 941 builder reads, so the
   * EIN on a W-2 and the EIN on the quarterly returns cannot disagree. The SSA
   * reconciles the W-2 batch against the four 941s filed under one EIN, and a
   * mismatch produces a notice rather than a silent acceptance.
   *
   * A MISSING PROFILE IS NOT A FAILURE HERE. Greenway may not have filled it in
   * yet, and the honest result is a form with blank employer boxes - visibly
   * unfinished - rather than no form at all. What must never happen is a
   * plausible-looking placeholder, so absent fields become null and null prints
   * blank.
   */
  const profileLoad = await loadCompanyProfile();
  const profile = profileLoad.ok ? profileLoad.profile : {};
  const str = (key: string): string | null => {
    const v = profile[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const employer: W2Employer = {
    ein: str("ein"),
    // The LEGAL name, not the trade name. Greenway trades as "LYMAN'S
    // MARIJUANA"; the SSA matches on the name the EIN was issued to.
    legalName: str("legal_name"),
    street: str("address_line1"),
    city: str("city"),
    state: str("state_code"),
    zip: str("zip_code"),
  };
  const employerIncomplete =
    employer.ein === null || employer.legalName === null || employer.street === null;

  /*
   * ═══ THE RUN ═══
   *
   * Ordered by the surname the ENGINE carries, not by a surname recovered from
   * the display name. `employeeLastName` exists for exactly this: a last-word
   * rule files "ANN MARIE DE LA CRUZ" under C and "JOHN SMITH JR" under J, and
   * both put an employee on the wrong sheet of a filed run.
   */
  const run = paginateRun(
    W2_PAGE_KEY,
    forms.map((form) => ({
      label: form.employeeName || "(name incomplete)",
      sortKey: form.employeeLastName,
      value: form,
    })),
    byPaperOrder,
  );

  /*
   * "Show me Lyman's W-2." Matched on employee id rather than name, because two
   * employees here are both called Michael and a name filter would show the
   * wrong man's wages. When it matches, the run narrows to the single sheet that
   * person prints on - so what is on screen is still a real sheet of paper, in
   * its real position, rather than a form lifted out of context.
   */
  const wanted = (sp.employee ?? "").trim();
  const focusSheet =
    wanted === ""
      ? null
      : (run.sheets.find((s) => s.subjects.some((x) => x.value.employeeId === wanted)) ?? null);
  const focusName =
    focusSheet === null
      ? null
      : (focusSheet.subjects.find((x) => x.value.employeeId === wanted)?.label ?? null);

  const sheets = focusSheet === null ? run.sheets : [focusSheet];

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-[var(--admin-text)] print:bg-white">
      <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-5 print:hidden">
        <Link
          href={`/admin/books/form-w2?year=${taxYear}`}
          className="text-xs text-white/50 underline hover:text-white"
        >
          ← Back to the full W-2 screen, with the explanations
        </Link>

        {readFailed ? (
          <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs">
            {loaded.ok ? "" : loaded.message} Nothing below is your filed data &mdash; the form
            shown is the blank IRS form, and every figure reads &ldquo;not computed
            yet&rdquo;.
          </p>
        ) : null}

        {/*
          ═══ COMPUTED SINCE BOOKS-61 AND, UNTIL NOW, NEVER SHOWN ═══

          `employerIncomplete` was being calculated and then dropped on the
          floor, so a W-2 run with no EIN in box b rendered silently. Box b
          empty is not a cosmetic gap: the SSA matches a wage report to an
          employer on the EIN, and a run submitted without one is rejected
          wholesale rather than per-employee.
        */}
        {employerIncomplete ? (
          <p className="mt-3 rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3 text-xs">
            Boxes b and c at the top of every W-2 below are incomplete, because your
            company profile is missing the EIN, the legal business name or the street
            address. They print blank rather than guessed. The Social Security
            Administration matches a wage report to your account on the EIN and the
            business name, so these copies are not yet ready to hand out or file.{" "}
            <Link href="/admin/books/company" className="underline hover:text-white">
              Fill in the company profile
            </Link>
            .
          </p>
        ) : null}

        <h1 className="mt-3 text-lg font-semibold tracking-tight">
          Form W-2 ({taxYear}) &mdash; Copy B, as it prints
        </h1>

        <p className="mt-1 text-xs text-white/45">
          {live
            ? `${run.totalSubjects} employee${run.totalSubjects === 1 ? "" : "s"}, ${run.perSheet} per sheet, ${run.sheets.length} sheet${run.sheets.length === 1 ? "" : "s"} — the same pagination your filed W-2 run uses.`
            : `No ${taxYear} payroll exists yet, so this is the blank IRS form. Every figure is left blank and reads “not computed yet” in the lesson — none of them is a zero, because a zero on a W-2 is a claim.`}
        </p>

        {/*
          One person, straight to their sheet. This is the question a CPA asks
          most often, and typing an employee id into a URL is not an answer.
        */}
        {live && run.totalSubjects > 1 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="mr-1 text-white/40">Go to one employee:</span>
            {focusSheet !== null ? (
              <Link
                href={`/admin/books/form-w2/sheet?year=${taxYear}`}
                className="rounded border border-white/20 px-2 py-0.5 text-white/70 hover:bg-white/10"
              >
                Show all {run.totalSubjects}
              </Link>
            ) : null}
            {run.sheets.flatMap((s) =>
              s.subjects.map((x) => {
                const isFocus = x.value.employeeId === wanted;
                return (
                  <Link
                    key={x.value.employeeId}
                    href={`/admin/books/form-w2/sheet?year=${taxYear}&employee=${encodeURIComponent(x.value.employeeId)}`}
                    className={[
                      "rounded border px-2 py-0.5",
                      isFocus
                        ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-white"
                        : "border-white/15 text-white/60 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {x.label}
                  </Link>
                );
              }),
            )}
          </div>
        ) : null}

        {focusName !== null ? (
          <p className="mt-2 text-xs text-white/45">
            Showing sheet {focusSheet?.sheet} of {run.sheets.length}, which is the sheet{" "}
            {focusName} prints on. The other form on this sheet is that employee&rsquo;s
            neighbour in the run, exactly as it comes off the printer.
          </p>
        ) : null}
      </div>

      {/*
        THE CAUTION IS THE IRS'S OWN SENTENCE, NOT MY SUMMARY OF IT.

        Quoted from page 1 of the same fw2.pdf this page draws its artwork from -
        the file whose sha256 is recorded in the geometry - and verified by
        reading it out of that file rather than from memory:

          "Do not print and file Copy A downloaded from www.irs.gov with the
           SSA. You may be charged a penalty if you file forms that can't be
           scanned. ... Note: Copy B and other copies of this form, which appear
           in black, may be downloaded, completed, printed, and used to satisfy
           the requirement to provide the information to the recipient."

        Which is exactly why this page renders COPY B and not Copy A. A print
        button on a W-2 page that stays quiet about the Copy A penalty is a trap
        with a friendly label on it, and he has said plainly what the stakes are:
        "i really want this feature and it should be great so i dont mess up
        reporting and paying taxes."
      */}
      <FormPrintBar
        what={
          focusName === null
            ? `Form W-2 (${taxYear}) — ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`
            : `Form W-2 (${taxYear}) — ${focusName}`
        }
        caution={
          "This is Copy B — the employee's copy. The IRS says of this exact file: " +
          "\u201cCopy B and other copies of this form, which appear in black, may be " +
          "downloaded, completed, printed, and used to satisfy the requirement to " +
          "provide the information to the recipient.\u201d Copy A is the red one that " +
          "goes to the SSA, it is not what this page prints, and the same IRS notice " +
          "warns \u201cyou may be charged a penalty if you file forms that can\u2019t be " +
          "scanned.\u201d So: print this for your employees and your records, and order " +
          "or e-file the scannable Copy A separately."
        }
      />

      {/* ══ THE PAPER ══════════════════════════════════════════════════════ */}
      {sheets.map((sheet) => (
        <div key={sheet.sheet} className="facsimile-sheet-wrap">
          {sheets.length > 1 ? (
            <p className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-4 text-[11px] uppercase tracking-wider text-white/35 print:hidden">
              Sheet {sheet.sheet} of {run.sheets.length}
              {sheet.subjects.length > 0
                ? ` — ${sheet.subjects.map((s) => s.label).join(" · ")}`
                : ""}
            </p>
          ) : null}

          <FormFacsimile
            pageKey={W2_PAGE_KEY}
            lessons={FORM_W2_BOX_LESSONS}
            copies={
              /*
               * WITH PAYROLL: one entry per employee on this sheet, and NOTHING
               * for the spare slot on a short last sheet. That slot prints blank,
               * which is what his own employer copy does with its two spare
               * forms - and is never padded with a repeat of somebody, because
               * a duplicated W-2 is a plausible-looking invention.
               *
               * WITHOUT PAYROLL: the teaching specimen on the TOP form only. The
               * bottom one stays blank IRS stock. Filling both with the same
               * specimen would show two identical strangers and teach him that
               * a two-up sheet means one person twice.
               */
              live
                ? sheet.subjects.map((s) => ({
                    subject: s.label,
                    boxes: w2Boxes(s.value),
                    /*
                     * The boxes that are not numbers. Without this the form
                     * carries wages and no name - see §5 of form-facsimile-core
                     * for the defect this fixes. Every string here is a fact the
                     * engine or the profile already states; nothing is invented,
                     * and anything absent prints blank.
                     */
                    identity: w2IdentityText(employer, {
                      /*
                       * Box e is THREE rectangles, and each part is taken from
                       * the field the engine carries for it. Splitting the joined
                       * display name back up - by stripping the surname off the
                       * end, which is what the first version of this did - is the
                       * rule-121 mistake in mirror image: it breaks on
                       * "ANN MARIE DE LA CRUZ" and on anyone whose surname also
                       * appears in their first name.
                       */
                      firstNameAndInitial: s.value.employeeFirstNameAndInitial,
                      lastName: s.value.employeeLastName,
                      suffix: s.value.employeeSuffix,
                      ssnMasked: s.value.ssnMasked,
                      // Optional on the real form. Greenway does not use one.
                      controlNumber: null,
                      stateCode: s.value.stateCode,
                      employerStateIdNumber: s.value.employerStateIdNumber,
                    }),
                  }))
                : [{ subject: null, boxes: teachingBoxes(FORM_ID_W2) }]
            }
          />
        </div>
      ))}

      {/* ══ THE SAME BOXES AS A LIST ══════════════════════════════════════
          The books-58 sheet, kept and kept working. It is better than the paper
          at some things - it groups the boxes, it shows every caption at once,
          and it is what a screen reader can move through linearly. The paper is
          better at being the form. Neither replaces the other, so both are here,
          and this one is hidden when printing because he is printing a W-2, not
          a web page. */}
      <div className="admin-chrome print:hidden">
        <FormSheet
          title={`Form W-2 (${taxYear}) — box by box`}
          boxes={live ? w2Boxes(forms[0]) : teachingBoxes(FORM_ID_W2)}
          lessons={FORM_W2_BOX_LESSONS}
        />
      </div>
    </main>
  );
}
