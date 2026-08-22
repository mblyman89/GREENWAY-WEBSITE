/**
 * src/app/admin/books/net-pay/page.tsx   (books-37)
 *
 * NET PAY — THE NUMBER ON THE CHEQUE, WORKED ALL THE WAY THROUGH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Please proceed with the net pay and the deferred ytd store slice. Please
 *    make sure to include the same level of verbatim authoritative text and
 *    their plain english explanations."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE IS A CALCULATOR, AND IT SAYS SO ON ITS FACE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There are two independent reasons it cannot yet be a report of real cheques,
 * and both were verified rather than assumed:
 *
 *   1. Michael's first payroll is 1 January 2027. There are no pay runs to
 *      report on. Today is 2026.
 *
 *   2. Even afterwards, `payroll_run_lines` stores ONE column called
 *      `taxes_cents`. Disposable earnings under 15 U.S.C. 1672(b) are gross pay
 *      less the amounts REQUIRED BY LAW to be withheld — and a single lump
 *      cannot answer that question, because nothing in it records whether a
 *      voluntary health premium is inside. Treat the lump as required by law
 *      and disposable earnings come out too low, which UNDER-garnishes a
 *      support order and can make the shortfall Michael's own liability.
 *      Ignore it and they come out too high, which OVER-garnishes an employee
 *      who is already short. Both are silent.
 *
 * So the honest screen is a worked example driven by the real engines, clearly
 * labelled as one. When the itemised columns exist, the same
 * `buildNetPayWorkedExample` reads them from the database instead and neither
 * this page nor `NetPayWorkbench` changes (standing rule 62e).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THING THIS PAGE FOUND, WHICH IS WHY THE BANNER IS AT THE TOP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Running the chain against 2027-01-01 rather than reasoning about it returned
 * a refusal, not a cheque. Ten of the eleven rates in the registry have no
 * evidenced row covering Michael's first payroll date: PFML (all three), SUTA
 * and its wage base, both L&I rates, the Social Security wage base, and both
 * minimum wages. Every one of those rows deliberately closes on 2026-12-31
 * because the agency that sets it had not published the 2027 figure when the
 * row was written.
 *
 * The registry is behaving correctly — refusing beats reusing a stale rate,
 * which produces a paycheque that adds up perfectly and is wrong against the
 * State. But correct is not the same as safe. The date is fixed and the notices
 * arrive on somebody else's schedule, so the readiness banner is placed FIRST,
 * above the worked example, where it cannot be missed in December.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `requireBooksAccess()` runs before anything else. Nothing here reads the
 * database — the illustration is computed from the rate registry — but the gate
 * is called anyway and in the same position as every sibling page. A page whose
 * access check depends on what it happens to read today is a page that becomes
 * unprotected the day somebody adds a read.
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { NetPayWorkbench } from "@/components/admin/books/NetPayWorkbench";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  buildIllustrationScenario,
  buildNetPayWorkedExample,
  payDateReadiness,
} from "@/lib/payroll/net-pay-ui-core";

export const dynamic = "force-dynamic";

/**
 * Michael's first payroll, from his own instruction: biweekly on Fridays,
 * starting 1 January 2027. Written down because the readiness banner is about
 * THIS date specifically, and a date that drifts with the clock would quietly
 * stop asking the question that matters.
 */
const FIRST_PAYROLL_DATE = "2027-01-01";

/**
 * The date the illustration is worked on.
 *
 * The last biweekly Friday for which every rate is on file. It is NOT the first
 * payroll date, and the difference is the entire point of the banner above the
 * example: showing a refusal where the worked cheque should be would teach
 * nothing about net pay, while hiding the refusal would teach something false
 * about readiness. Michael gets both, labelled.
 */
const ILLUSTRATION_DATE = "2026-12-18";

export default async function NetPayPage() {
  await requireBooksAccess();

  const readiness = payDateReadiness(FIRST_PAYROLL_DATE);
  const illustration = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
  const worked = buildNetPayWorkedExample(illustration.scenario);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Net pay &mdash; how a paycheque is built
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Gross pay, less what the law requires, gives disposable earnings; a garnishment
          is capped against that figure, and only then do authorised deductions come off.
          The order is set by statute, not by preference, and getting it wrong is the most
          expensive mistake available on a paycheque.
        </p>
      </div>

      {/* ══ READINESS, FIRST ══════════════════════════════════════════════════
          Placed above the worked example on purpose. The example proves the
          arithmetic works; this card answers the question Michael actually
          needs answered before January, which is whether his first payroll can
          run at all. Reported as a refusal to compute, never as a zero. */}
      {readiness.canRun ? (
        <Card>
          <CardHeader
            title={`Your first payroll (${FIRST_PAYROLL_DATE}) can be calculated`}
            subtitle="Every rate a paycheque needs has an evidenced row covering that date."
          />
          <p className="text-sm text-[var(--admin-text-muted)]">{readiness.summary}</p>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`Your first payroll (${FIRST_PAYROLL_DATE}) cannot be calculated yet`}
            subtitle="This is the system refusing to guess, not a fault. Each rate below needs the notice it comes from before that date can be run."
          />
          <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">
            {readiness.summary}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-muted)]">
            None of these are overdue. Each one is set by an agency on its own schedule
            &mdash; L&amp;I announces the new minimum wage on 30 September, and the SUTA and
            L&amp;I rate notices arrive in December. What matters is that the notices are
            entered here as they arrive, rather than being discovered missing on the
            morning of the first pay run.
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            {readiness.rates
              .filter((r) => !r.onFile)
              .map((r) => (
                <li key={r.key} className="border-l-2 border-[var(--admin-orange)]/50 pl-4">
                  <p className="font-medium text-[var(--admin-text)]">{r.label}</p>
                  <p className="mt-1 text-[var(--admin-text-muted)]">{r.why}</p>
                  <p className="mt-1 text-[var(--admin-text-muted)]">
                    <span className="text-white/50">What to do: </span>
                    {r.whatToDo}
                  </p>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <NetPayWorkbench worked={worked} scenarioNote={illustration.provenance} />
    </div>
  );
}
