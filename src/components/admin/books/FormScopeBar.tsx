/**
 * src/components/admin/books/FormScopeBar.tsx   (books-63)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE PERIOD PICKER, ON EVERY FORM PAGE AND EVERY TAB
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Michael: "sorting and filtering per period/ employee/ qtr/ yr, etc would be
 * really handy on the forms pages in some way. I am not sure the smart industry
 * standard or professional way to do it. ... Please make sure you are building
 * these features so I can sort and filter that works with the full form workflow
 * and all its tabs and pages."
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THE "PROFESSIONAL WAY" ACTUALLY IS, SINCE HE ASKED
 * ──────────────────────────────────────────────────────────────────────────────
 * He said he did not know the industry-standard way, so: in filing software the
 * period selector is a PERSISTENT BAR, in the same place on every screen, and the
 * selection lives in the ADDRESS rather than in hidden state. Three reasons, all
 * practical rather than aesthetic:
 *
 *   1. A link to "the Q2 941" can be sent to a CPA and open on his machine
 *      showing Q2. Hidden state cannot be sent to anybody.
 *   2. Browser Back means what it looks like it means.
 *   3. The period is visible while the figures are on screen. A period selector
 *      that lives in a modal is a selector you have to open to find out what you
 *      are looking at - and these figures get typed into EFTPS.
 *
 * That is why this is a bar of links and not a dropdown with a submit button.
 * A dropdown needs client JavaScript, and this whole form workflow is server
 * components; a `<select>` that requires hydration to change the period is a
 * period picker that does nothing while the page is loading.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY IT PRINTS NOTHING
 * ──────────────────────────────────────────────────────────────────────────────
 * `print:hidden`. He prints these pages to put in a folder for his CPA, and a
 * row of navigation pills on a filed 941 makes it obvious the document came out
 * of a web browser. The FORM prints; the chrome does not.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THE NOTICE IS PART OF THIS COMPONENT AND NOT THE PAGE'S PROBLEM
 * ──────────────────────────────────────────────────────────────────────────────
 * Because a substitution the reader is not told about is the defect this whole
 * slice fixes. `?year=2025&q=7` used to render Q2 2026 under a heading reading
 * "Q2 2026" - self-consistent and wrong. If the notice were the page's job, six
 * pages would each have to remember, and the measurement at the top of
 * form-scope-core.ts shows what happens when six pages each remember something:
 * three of them spell it differently and nobody knows which is right.
 */
import Link from "next/link";

import {
  scopeHref,
  scopeLabel,
  scopeNotice,
  type FormScope,
  type QuarterNumber,
} from "@/lib/payroll/form-scope-core";

/** One selectable employee. `id` goes in the URL, `label` on the pill. */
export type ScopeEmployee = {
  readonly id: string;
  readonly label: string;
};

export type FormScopeBarProps = {
  /** The route this bar links within, e.g. "/admin/books/form-940/sheet". */
  readonly basePath: string;
  readonly scope: FormScope;
  /** Years to offer. Never empty - see the gate; a bar with no way out is not a bar. */
  readonly years: readonly number[];
  /** Quarters to offer, or null on an annual form. */
  readonly quarters: readonly { readonly year: number; readonly quarter: QuarterNumber }[] | null;
  /** Employees to offer, or null where the form has no employee dimension. */
  readonly employees: readonly ScopeEmployee[] | null;
  /** True when the page looked for `scope.employee` and found nobody. */
  readonly unmatchedEmployee?: boolean;
};

const PILL_BASE = "rounded border px-2 py-0.5";
const PILL_ON = "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-white";
const PILL_OFF = "border-white/15 text-white/60 hover:bg-white/10";

function pill(on: boolean): string {
  return [PILL_BASE, on ? PILL_ON : PILL_OFF].join(" ");
}

export function FormScopeBar({
  basePath,
  scope,
  years,
  quarters,
  employees,
  unmatchedEmployee = false,
}: FormScopeBarProps) {
  const notice = scopeNotice(scope, unmatchedEmployee);

  /*
   * An empty year list would render a bar with a label and nothing after it,
   * which reads as a broken page rather than as a missing feature. `scopeYears`
   * cannot return empty - it always unions in the current selection - so this
   * is a guard against a future caller passing a filtered list, not against
   * that function.
   */
  const showYears = years.length > 0;
  const showQuarters = quarters !== null && quarters.length > 0;
  const showEmployees = employees !== null && employees.length > 1;

  return (
    <div className="mt-3 space-y-2 print:hidden">
      {/*
        ═══ WHAT YOU ARE LOOKING AT, IN WORDS, BEFORE ANY PILLS ═══

        The pills show what is available; this shows what is SELECTED. They are
        different questions, and a highlighted pill answers the second one only
        if you can find it.
      */}
      <p className="text-[11px] text-white/40">
        Showing <span className="font-semibold text-white/70">{scopeLabel(scope)}</span>
        {scope.employee !== null && !unmatchedEmployee ? (
          <> &middot; one employee</>
        ) : null}
        {scope.defaulted && scope.refused.length === 0 ? (
          <> &middot; the most recent closed period, because none was asked for</>
        ) : null}
      </p>

      {notice !== null ? (
        /*
         * Gold, not red. Nothing has broken - the page is working exactly as
         * designed - but the reader is not seeing what they asked for, and on a
         * page whose figures get typed into a government portal that distinction
         * has to be visible. Red would say "this is broken"; silence would say
         * nothing, which is what it used to say.
         */
        <p className="rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-2 text-[11px]">
          {notice}
        </p>
      ) : null}

      {showQuarters ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-white/40">Quarter:</span>
          {quarters.map((q) => {
            const on = q.year === scope.year && q.quarter === scope.quarter;
            return (
              <Link
                key={`${q.year}-${q.quarter}`}
                href={scopeHref(basePath, scope, { year: q.year, quarter: q.quarter })}
                className={pill(on)}
                aria-current={on ? "page" : undefined}
              >
                Q{q.quarter} {q.year}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/*
        The year row is shown on QUARTERLY forms too, and deliberately. On the
        941 it jumps a whole year at once instead of clicking back through four
        quarters - and it keeps the quarter, so "same quarter, last year" is one
        click. That is the comparison an owner actually makes.
      */}
      {showYears ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-white/40">
            {scope.grain === "quarter" ? "Same quarter, another year:" : "Year:"}
          </span>
          {years.map((y) => {
            const on = y === scope.year;
            return (
              <Link
                key={y}
                href={scopeHref(basePath, scope, { year: y })}
                className={pill(on)}
                aria-current={on ? "page" : undefined}
              >
                {y}
              </Link>
            );
          })}
        </div>
      ) : null}

      {showEmployees ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-white/40">Employee:</span>
          {/*
            "Everybody" is a pill like any other, and it is highlighted when it
            is the current state. A filter you can turn on and cannot see how to
            turn off is a trap - and this used to be built as a bare
            `?year=${taxYear}` link, which cleared the employee as a SIDE EFFECT
            of setting the year.
          */}
          <Link
            href={scopeHref(basePath, scope, { employee: null })}
            className={pill(scope.employee === null)}
            aria-current={scope.employee === null ? "page" : undefined}
          >
            Everybody ({employees.length})
          </Link>
          {employees.map((e) => {
            const on = e.id === scope.employee;
            return (
              <Link
                key={e.id}
                href={scopeHref(basePath, scope, { employee: e.id })}
                className={pill(on)}
                aria-current={on ? "page" : undefined}
              >
                {e.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
