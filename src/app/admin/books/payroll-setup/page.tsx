/**
 * src/app/admin/books/payroll-setup/page.tsx   (slice books-13)
 *
 * SET UP PAYROLL FROM W-4 DATA — and the mentor that stands in front of it.
 * Owner-only, like every books screen.
 *
 * WHY THIS PAGE EXISTS
 * Michael asked for two things by name (standing rule 1 — verbatim):
 *
 *   "I also need a way to setup payroll for my employees using their w-4 data
 *    if it's not already been built."
 *
 * and, about every editable number on every form in this product:
 *
 *   "the moment i try to modify a number, the system will jump in and say hey,
 *    you can't do that here, what are you trying to accomplish… and then help
 *    them discover the proper path to get that number on the form to change
 *    properly with the proper audit trail that follows. That's true mentoring
 *    behavior and the type of hand holding I want baked into our system."
 *
 * So this screen is deliberately TWO things at once. The top half is the setup
 * itself: what a W-4 actually controls, what it does not, and what this system
 * refuses to do without evidence. The bottom half is the mentor's whole
 * repertoire, laid out in the open — every interception it can raise, why, and
 * where each one sends you instead.
 *
 * WHY THE BLOCKERS ARE SHOWN UP FRONT RATHER THAN ONLY ON A FAILED KEYSTROKE
 * Because a guardrail you meet only by tripping over it feels like an
 * accusation. Read in advance, the same text is a lesson. The interception
 * dialogs use these exact records, so nothing here can drift away from what he
 * will actually be told in the moment — it is one registry, rendered twice.
 *
 * A REGULATORY CONSTRAINT THAT SHAPED THE LAYOUT
 * Pub. 15-T's rules for electronic substitute W-4s require the fields of
 * Steps 1(c) through 4(c) to be presented with the same wording and the same
 * prominence as the paper form. That forbids the pattern this codebase would
 * otherwise reach for — hiding secondary fields behind hover cards or
 * default-collapsed accordions. Hence the flat, fully-visible field list below.
 * The teaching copy is what collapses; the form fields never do.
 *
 * THE GATE
 * `requireBooksAccess()` — `is_owner()` in application form. This page is a
 * read-only teaching surface: it renders no mutation controls at all, so the
 * gate is the whole story here rather than belt-and-braces.
 */

import Link from "next/link";

import { Badge, Card, CardHeader, Section } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  ALL_W4_FILING_STATUSES,
  PAY_FREQUENCY_LABELS,
  PAY_PERIODS_PER_YEAR,
  W4_FILING_STATUS_LABELS,
  W4_REDESIGN_YEAR,
  defaultW4WhenNoneFurnished,
  validateW4,
} from "@/lib/payroll/payroll-w4-core";
import {
  BLOCKER_SEVERITY_MEANING,
  PAYROLL_BLOCKERS,
  PAYROLL_EDIT_TARGET_LABELS,
  authoritiesForBlocker,
  type BlockerSeverity,
} from "@/lib/payroll/payroll-withholding-guidance-core";
import {
  MEDICARE_RATE_MILLI_PCT,
  OASDI_RATE_MILLI_PCT,
  OASDI_WAGE_BASE_2026_CENTS,
  formatCentsPlain,
} from "@/lib/payroll/payroll-withholding-core";

export const metadata = { title: "Set up payroll from W-4 data | Greenway" };

/** Milli-percent → a string a human reads. 6_200 → "6.2%". */
function pct(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = milli % 1000;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}%`;
}

const SEVERITY_TONE: Record<BlockerSeverity, "danger" | "orange" | "green"> = {
  refuse: "danger",
  reroute: "orange",
  teach: "green",
};

const SEVERITY_WORD: Record<BlockerSeverity, string> = {
  refuse: "Hard stop",
  reroute: "Not here",
  teach: "Heads up",
};

export default async function PayrollSetupPage() {
  await requireBooksAccess();

  // The no-W-4 default, computed rather than described, so the page cannot
  // drift from the engine. Pub. 15-T: an employee who furnishes no W-4 is
  // treated as Single with no other entries.
  const noW4 = defaultW4WhenNoneFurnished("example", W4_REDESIGN_YEAR + 6);
  const noW4Check = validateW4(noW4);

  const refuseCount = PAYROLL_BLOCKERS.filter((b) => b.severity === "refuse").length;
  const rerouteCount = PAYROLL_BLOCKERS.filter((b) => b.severity === "reroute").length;
  const teachCount = PAYROLL_BLOCKERS.filter((b) => b.severity === "teach").length;

  return (
    <div className="space-y-8 pb-16">
      {/* ---------------------------------------------------------------- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-[var(--admin-text)]">
            Set up payroll from W-4 data
          </h1>
          <Badge tone="gold">Owner only</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--admin-text-faint)]">
          A W-4 is the employee&apos;s instruction sheet for one tax and one tax only: federal
          income tax withholding. It is not a switch for Social Security, it is not a switch for
          Medicare, and it has nothing to say about anything Washington charges. Getting that
          straight up front saves you an afternoon later, because the single most common payroll
          question — &ldquo;I filed a new W-4, why didn&apos;t Social Security change?&rdquo; — has
          the answer built into the question.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="What the W-4 controls"
        description="Everything on the left moves when a W-4 changes. Nothing on the right does."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card accent="green">
            <CardHeader
              title="A W-4 changes this"
              subtitle="Federal income tax withholding, and nothing else"
            />
            <ul className="mt-3 space-y-2 text-sm text-[var(--admin-text-faint)]">
              <li>
                <strong className="text-[var(--admin-text)]">Step 1(c) filing status</strong> —
                picks which of the three rate schedules runs.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Step 2 checkbox</strong> — switches to
                the higher table built for a second income in the household.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Step 3 credits</strong> — subtracts
                from the tax, not from the wages.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Step 4(a) and 4(b)</strong> — other
                income and extra deductions, both annual figures.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Step 4(c)</strong> — a flat dollar
                amount added to every single check.
              </li>
            </ul>
          </Card>

          <Card accent="orange">
            <CardHeader
              title="A W-4 does not touch any of this"
              subtitle="Which is why these keep coming out of the check either way"
            />
            <ul className="mt-3 space-y-2 text-sm text-[var(--admin-text-faint)]">
              <li>
                <strong className="text-[var(--admin-text)]">Social Security</strong> —{" "}
                {pct(OASDI_RATE_MILLI_PCT)} of wages up to{" "}
                {formatCentsPlain(OASDI_WAGE_BASE_2026_CENTS)} for the year. Statutory.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Medicare</strong> —{" "}
                {pct(MEDICARE_RATE_MILLI_PCT)} of every dollar, with no ceiling at all.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">Additional Medicare</strong> — kicks in
                by law once wages pass the threshold, whatever the W-4 says.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">WA Paid Leave and WA Cares</strong> —
                state programs; a federal form has no bearing on them.
              </li>
              <li>
                <strong className="text-[var(--admin-text)]">L&amp;I</strong> — charged per hour
                worked, not per dollar earned. It is the odd one out on the whole stub.
              </li>
            </ul>
          </Card>
        </div>

        <Card className="mt-4" raised>
          <p className="text-sm leading-relaxed text-[var(--admin-text-faint)]">
            <strong className="text-[var(--admin-text)]">
              The one that catches everybody: &ldquo;Exempt&rdquo;.
            </strong>{" "}
            An employee who writes exempt on their W-4 is telling you to stop withholding federal
            income tax. They are not — and cannot be — telling you to stop withholding Social
            Security and Medicare. Those come out of an exempt employee&apos;s check exactly as
            before. This system enforces that and refuses to be talked out of it, because the money
            involved is held in trust for the United States the instant it is withheld, and the
            shortfall is collectible from you personally.
          </p>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Pay frequency"
        description="Chosen once per employee. It decides how the annual tables get sliced."
      >
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-4 font-semibold">Frequency</th>
                  <th className="py-2 pr-4 font-semibold">Pay periods a year</th>
                </tr>
              </thead>
              <tbody>
                {(
                  Object.keys(PAY_PERIODS_PER_YEAR) as (keyof typeof PAY_PERIODS_PER_YEAR)[]
                ).map((f) => (
                  <tr key={f} className="border-b border-[var(--admin-border)]/40">
                    <td className="py-2 pr-4 text-[var(--admin-text)]">
                      {PAY_FREQUENCY_LABELS[f]}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-[var(--admin-text-faint)]">
                      {PAY_PERIODS_PER_YEAR[f]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
            Worth knowing before it surprises you: the totals do not always land on the same number.
            Withholding is computed per period from a table that was divided by the period count, so
            rounding happens once per check. Twenty-six biweekly checks and twelve monthly checks on
            identical annual pay will not agree to the penny. That is normal, it is what Form 941
            line 7 exists to absorb, and this system tracks it rather than hiding it.
          </p>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Filing statuses"
        description="Straight off Step 1(c) of the paper form. No interpretation."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {ALL_W4_FILING_STATUSES.map((s) => (
            <Card key={s} raised>
              <p className="text-sm font-semibold text-[var(--admin-text)]">
                {W4_FILING_STATUS_LABELS[s]}
              </p>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="When an employee gives you nothing"
        description="There is a prescribed answer, and guessing is not it."
      >
        <Card accent="gold">
          <p className="text-sm leading-relaxed text-[var(--admin-text-faint)]">
            If someone never hands in a W-4, you do not get to invent one and you do not get to stop
            paying them. Pub. 15-T says to treat them as though they had checked{" "}
            <strong className="text-[var(--admin-text)]">
              {W4_FILING_STATUS_LABELS[noW4.filingStatus]}
            </strong>{" "}
            in Step 1(c) and made no entries anywhere else. That is what this system does, and it is
            the highest-withholding reasonable default on purpose — an employee who is
            over-withheld gets it back in April, whereas an under-withheld one creates a liability
            that lands on you.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
            The same rule applies to an unsigned form. A W-4 with every box filled in and no
            signature is not a W-4 — the perjury statement is the operative part — so it is
            treated as though no form was furnished at all.{" "}
            {noW4Check.issues.length > 0 ? (
              <>
                The validator flags this default with{" "}
                {noW4Check.issues.length === 1
                  ? "one note"
                  : `${noW4Check.issues.length} notes`}{" "}
                so it never passes silently as a real election.
              </>
            ) : null}
          </p>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="What this system will not let you do, and where it sends you instead"
        description="Every interception the payroll screens can raise, written out in advance."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone="danger">{refuseCount} hard stops</Badge>
          <Badge tone="orange">{rerouteCount} reroutes</Badge>
          <Badge tone="green">{teachCount} heads-ups</Badge>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          {(["refuse", "reroute", "teach"] as const).map((s) => (
            <Card key={s} raised padding="sm">
              <Badge tone={SEVERITY_TONE[s]}>{SEVERITY_WORD[s]}</Badge>
              <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-faint)]">
                {BLOCKER_SEVERITY_MEANING[s]}
              </p>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          {PAYROLL_BLOCKERS.map((b) => {
            const authorities = authoritiesForBlocker(b);
            return (
              <Card key={b.id} accent={b.severity === "refuse" ? "orange" : undefined}>
                <CardHeader
                  title={PAYROLL_EDIT_TARGET_LABELS[b.target]}
                  subtitle={b.oneLine}
                  action={<Badge tone={SEVERITY_TONE[b.severity]}>{SEVERITY_WORD[b.severity]}</Badge>}
                />

                <p className="mt-4 text-sm font-medium leading-relaxed text-[var(--admin-text)]">
                  {b.whatIStopped}
                </p>

                <div className="mt-3 space-y-2">
                  {b.why.split("\n\n").map((para, i) => (
                    <p key={i} className="text-sm leading-relaxed text-[var(--admin-text-faint)]">
                      {para}
                    </p>
                  ))}
                </div>

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
                    What are you trying to accomplish?
                  </p>
                  <div className="mt-3 space-y-3">
                    {b.whatAreYouTryingToDo.map((intent, i) => {
                      const path = b.correctPaths[i]!;
                      return (
                        <div
                          key={i}
                          className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3"
                        >
                          <p className="text-sm font-medium text-[var(--admin-text)]">
                            &ldquo;{intent}&rdquo;
                          </p>
                          <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
                            <div>
                              <dt className="inline font-semibold text-[var(--admin-text-muted)]">
                                Do this:{" "}
                              </dt>
                              <dd className="inline text-[var(--admin-text-faint)]">
                                {path.action}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-[var(--admin-text-muted)]">
                                Where:{" "}
                              </dt>
                              <dd className="inline text-[var(--admin-text-faint)]">
                                {path.where}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-[var(--admin-text-muted)]">
                                What gets recorded:{" "}
                              </dt>
                              <dd className="inline text-[var(--admin-text-faint)]">
                                {path.auditTrail}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-[var(--admin-text-muted)]">
                                Then:{" "}
                              </dt>
                              <dd className="inline text-[var(--admin-text-faint)]">
                                {path.thenWhat}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 border-t border-[var(--admin-border)] pt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
                    Why I am allowed to say that
                  </p>
                  <ul className="mt-2 space-y-2">
                    {authorities.map((a) => (
                      <li key={a.id} className="text-xs leading-relaxed">
                        <a
                          href={a.source}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[var(--admin-accent)] hover:underline"
                        >
                          {a.cite}
                        </a>
                        <span className="text-[var(--admin-text-faint)]">
                          {" "}
                          — &ldquo;{a.quote}&rdquo;
                        </span>
                        <span className="block text-[var(--admin-text-muted)]">
                          In plain English: {a.soWhat}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Related">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/books/payroll"
            className="text-sm font-semibold text-[var(--admin-accent)] hover:underline"
          >
            Payroll &amp; COGS — can I write my employees off?
          </Link>
          <Link
            href="/admin/payroll"
            className="text-sm font-semibold text-[var(--admin-accent)] hover:underline"
          >
            Payroll runs
          </Link>
        </div>
      </Section>
    </div>
  );
}
