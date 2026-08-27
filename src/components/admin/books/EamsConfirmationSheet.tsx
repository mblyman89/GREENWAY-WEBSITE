"use client";

/**
 * src/components/admin/books/EamsConfirmationSheet.tsx   (books-66)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PAGE MICHAEL RECOGNISES, REBUILT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   "I would not be opposed to the form looking like the one given after
 *    efiling, the example you have in the workspace folder,
 *    1st_quarter_form_5208a.pdf. that would actually be better in my opinion as
 *    thats what I am used to seeing. if its not too much work, please recreate
 *    this form using some sort of form building software/ technique using the
 *    example I gave you."
 *
 * Every heading, every label, every column and the order of all of them were
 * read off his own filed Q1 2026 confirmation with `pdftotext -layout`. Where
 * this page differs from that one it is because it MUST — see the two notices —
 * and it says so on its face rather than quietly.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE COMPONENT FROM `FormSheet`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `FormSheet` renders a LIST OF BOXES. That is the right shape for the 940, the
 * 941 and the four WA returns, where the document genuinely is a numbered list
 * of lines and the reader's question is always "what is line 5b".
 *
 * The EAMS confirmation is not that shape. It is a two-column page: an identity
 * block and a charges column side by side, then a wide employee table. Forcing
 * it through `FormSheet` would produce a correct list of figures that looks
 * nothing like the thing Michael asked to recognise, which is the entire point
 * of the request. So the LAYOUT is new and the LESSON MACHINERY is shared —
 * `BoxLessonBody`, the same renderer the other sheets use, reached by the same
 * click. Rule 25 is about not duplicating decisions, and no decision is
 * duplicated here: the lessons, their text and their coverage gate all still
 * live in `form-box-lessons-wa.ts`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CLICK A FIGURE, GET THE LESSON — THE SCHEDULE B STANDARD
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   "on the 941 schedule b, every single box opens with an explanation. this is
 *    the level of thoroughness i want."
 *
 * Charge rows that have a lesson are buttons. Rows that do not are plain text
 * and are visually distinct, because a box that looks clickable and does
 * nothing is worse than one that never invited the click.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NOT EDITABLE, LIKE EVERYTHING ELSE
 * ───────────────────────────────────────────────────────────────────────────
 * There is not one input in this file. The only state is which lesson is open.
 */

import { useState } from "react";

import { BoxLessonBody } from "./BoxLessonBody";
import { lessonFor, type BoxLesson } from "@/lib/payroll/form-box-core";
import { type EamsConfirmationView } from "@/lib/payroll/eams-confirmation-core";

/**
 * Which charge row maps to which lesson.
 *
 * Written as an explicit table rather than derived from the label, because
 * matching on display text means a copy-edit silently unhooks a lesson. The
 * gate in the test file asserts every id here resolves to a real lesson.
 */
const CHARGE_LESSON_BY_LABEL: Readonly<Record<string, { formId: string; box: string }>> = {
  "UI tax due": { formId: "esd_5208a", box: "esd-ui" },
  "EAF tax due": { formId: "esd_5208a", box: "esd-eaf" },
  "UI and EAF charges": { formId: "esd_5208a", box: "esd-total" },
  "Charges this quarter": { formId: "esd_5208a", box: "esd-total" },
};

export function EamsConfirmationSheet({
  view,
  lessons,
}: {
  readonly view: EamsConfirmationView;
  readonly lessons: readonly BoxLesson[];
}) {
  const [open, setOpen] = useState<BoxLesson | null>(null);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-16">
      {/* ── THE TWO THINGS THAT MAKE THIS NOT A FILING ──────────────────── */}
      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
        <div className="font-semibold uppercase tracking-wide">Preview, not a receipt</div>
        <p className="mt-2">{view.notFiledNotice}</p>
      </div>

      {/* ── THE SHEET ITSELF ────────────────────────────────────────────── */}
      <div className="mt-4 rounded-md border border-white/15 bg-white p-6 text-[#1a1a1a] print:border-0 print:p-0">
        {/* Masthead, as EAMS prints it */}
        <div className="border-b border-[#1a1a1a]/20 pb-3">
          <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/70">
            EAMS Employer Account Management System
          </div>
          <div className="text-[0.7rem] uppercase tracking-wide text-[#1a1a1a]/70">
            Unemployment Insurance
          </div>
          <div className="mt-2 text-sm font-semibold">
            File Quarterly Report &bull; Preview
          </div>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[0.7rem]">
            <span className="font-semibold">{view.quarterLabel}</span>
            <span>BUSINESS: {view.businessName}</span>
            <span>ESD # {view.esdAccount}</span>
          </div>
        </div>

        {/*
          Where the green "Quarterly report was successfully filed!" banner and
          the confirmation code sit on the real page. Rendered as a visible
          absence rather than omitted, so the difference from the real article
          is obvious at a glance rather than only to someone comparing closely.
        */}
        <div className="mt-3 rounded border border-dashed border-[#1a1a1a]/30 bg-[#1a1a1a]/[0.03] px-3 py-2 text-[0.7rem] text-[#1a1a1a]/70">
          <span className="font-semibold">CONFIRMATION CODE:</span> none &mdash; not filed.{" "}
          <span className="font-semibold">SUBMITTED ON:</span> never. ESD issues both when it
          receives your report.
        </div>

        {/* ── TWO COLUMNS: identity on the left, charges on the right ───── */}
        <div className="mt-5 grid gap-8 md:grid-cols-2">
          {/* LEFT */}
          <div>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-wide">
              Business information
            </h3>
            <dl className="mt-2 space-y-2">
              {view.identity.map((p) => (
                <div key={p.label}>
                  <dt className="text-[0.6rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/55">
                    {p.label}
                  </dt>
                  <dd
                    className={
                      p.missing
                        ? "text-[0.78rem] font-medium text-red-700"
                        : "text-[0.78rem] font-medium"
                    }
                  >
                    {p.value}
                  </dd>
                </div>
              ))}
            </dl>

            <h3 className="mt-5 text-[0.72rem] font-semibold uppercase tracking-wide">
              Preparer information
            </h3>
            <dl className="mt-2 space-y-2">
              {view.preparer.map((p) => (
                <div key={p.label}>
                  <dt className="text-[0.6rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/55">
                    {p.label}
                  </dt>
                  <dd
                    className={
                      p.missing
                        ? "text-[0.78rem] font-medium text-red-700"
                        : "text-[0.78rem] font-medium"
                    }
                  >
                    {p.value}
                  </dd>
                </div>
              ))}
            </dl>

            <h3 className="mt-5 text-[0.72rem] font-semibold uppercase tracking-wide">
              Employee wages summary
            </h3>
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/55">
                  Total employees
                </div>
                <div className="text-[0.78rem] font-medium">{view.totalEmployees}</div>
              </div>
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/55">
                  Total hours
                </div>
                <div className="text-[0.78rem] font-medium">{view.totalHours}</div>
              </div>
            </div>

            <h3 className="mt-5 text-[0.72rem] font-semibold uppercase tracking-wide">
              Total employees each month
            </h3>
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
              {view.monthlyCounts.map((m) => (
                <div key={m.month}>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-[#1a1a1a]/55">
                    {m.month}
                  </div>
                  <div className="text-[0.78rem] font-medium">{m.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — the charges column */}
          <div>
            <p className="text-[0.62rem] leading-relaxed text-[#1a1a1a]/60">
              The charges shown below are applicable to this quarter&rsquo;s unemployment taxes
              only. Employment Security Department will mail you each month a complete billing
              statement, including changes and credits from prior quarters and any applicable
              penalties.
            </p>

            <h3 className="mt-3 text-[0.72rem] font-semibold uppercase tracking-wide">
              Amount due for Washington wages
            </h3>

            <div className="mt-2 divide-y divide-[#1a1a1a]/10 border-y border-[#1a1a1a]/10">
              {view.charges.map((row) => {
                const map = CHARGE_LESSON_BY_LABEL[row.label];
                const lesson =
                  map === undefined ? undefined : lessonFor(lessons, map.formId, map.box);

                const body = (
                  <>
                    <div className="flex items-baseline justify-between gap-4">
                      <span
                        className={
                          row.emphasis
                            ? "text-[0.78rem] font-semibold"
                            : "text-[0.78rem]"
                        }
                      >
                        {row.label}
                        {lesson !== undefined && (
                          <span className="ml-1 text-[0.6rem] text-blue-700">(explain)</span>
                        )}
                      </span>
                      <span
                        className={
                          row.emphasis
                            ? "text-[0.82rem] font-semibold tabular-nums"
                            : "text-[0.82rem] tabular-nums"
                        }
                      >
                        {row.amount}
                      </span>
                    </div>
                    {row.note !== null && (
                      <div className="mt-0.5 text-[0.6rem] text-[#1a1a1a]/55">{row.note}</div>
                    )}
                  </>
                );

                return lesson === undefined ? (
                  <div key={row.label} className="py-2">
                    {body}
                  </div>
                ) : (
                  <button
                    key={row.label}
                    type="button"
                    onClick={() => setOpen(lesson)}
                    className="w-full cursor-pointer py-2 text-left hover:bg-blue-50"
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── THE EMPLOYEE TABLE ──────────────────────────────────────────── */}
        <h3 className="mt-6 text-[0.72rem] font-semibold uppercase tracking-wide">
          Employee Wages
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[0.7rem]">
            <thead>
              <tr className="border-b border-[#1a1a1a]/25 text-left">
                <th className="py-1 pr-2 font-semibold">#</th>
                <th className="py-1 pr-2 font-semibold">SSN</th>
                <th className="py-1 pr-2 font-semibold">Name</th>
                <th className="py-1 pr-2 text-right font-semibold">Hours</th>
                <th className="py-1 pr-2 text-right font-semibold">Wages</th>
                <th className="py-1 font-semibold">SOC code</th>
              </tr>
            </thead>
            <tbody>
              {view.wageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-[0.7rem] text-[#1a1a1a]/60">
                    No employee rows for this quarter yet. This is an honest blank, not a zero
                    &mdash; run the quarter&rsquo;s payroll and the rows appear here.
                  </td>
                </tr>
              ) : (
                view.wageRows.map((r) => (
                  <tr key={r.index} className="border-b border-[#1a1a1a]/10">
                    <td className="py-1 pr-2 tabular-nums">{r.index}</td>
                    <td className="py-1 pr-2 tabular-nums">{r.ssn}</td>
                    <td className="py-1 pr-2">{r.lastName}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.hours}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.wages}</td>
                    <td
                      className={
                        r.socCode === "missing" ? "py-1 font-medium text-red-700" : "py-1"
                      }
                    >
                      {r.socCode}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {view.wageRows.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-1 pr-2" colSpan={3}>
                    Total employees: {view.totalEmployees}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{view.totalHours}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{view.totalWages}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="mt-4 text-[0.62rem] text-[#1a1a1a]/55">
          Questions? Contact the ESD Account Management Center at 855-829-9243 or
          OlympiaAMC@esd.wa.gov
        </p>
      </div>

      {/* ── THE LESSON, BROUGHT TO WHERE HE IS STANDING ─────────────────── */}
      {open !== null && (
        <div className="mt-4 rounded-md border border-blue-400/40 bg-[var(--admin-panel,#12161c)] p-4 print:hidden">
          <div className="flex items-start justify-between gap-4">
            <h4 className="text-sm font-semibold text-white">{open.headline}</h4>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="shrink-0 text-xs text-white/50 underline hover:text-white"
            >
              close
            </button>
          </div>
          <BoxLessonBody lesson={open} />
        </div>
      )}
    </div>
  );
}
