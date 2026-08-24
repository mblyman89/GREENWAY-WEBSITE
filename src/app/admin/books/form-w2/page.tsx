/**
 * src/app/admin/books/form-w2/page.tsx   (books-46 slice A)
 *
 * THE ANNUAL WAGE REPORT - Forms W-2 and W-3.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   "Please proceed with slice a. I want substantial help and guidance on this
 *    topic as well... I want to know how to use it, why to use it, how to read
 *    it, how to learn from it, how to use it as a tool. Take me to school
 *    again please. The PhD cpa treatment please."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THIS PAGE, AND WHY IT IS IN THIS ORDER
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   1. THE ONE NEXT ACTION.  One sentence, biggest thing on the page.
 *   2. The deadline.         The statutory date and the one Greenway may use.
 *   3. What is missing.      Refusal cards, grouped, each with the fix.
 *   4. THE RECONCILIATION.   The W-3 against the four filed 941s.
 *   5. The W-3.              The totals that go to the SSA.
 *   6. The forms.            One per person, box by box, arithmetic shown.
 *   7. The checklist.        Eight questions, in the order they arrive.
 *   8. The worked examples.  Six of them, one arithmetic step per line.
 *   9. The law.              Verbatim, with the plain reading beside it.
 *
 * IT ANSWERS THE QUESTIONS IN THE ORDER THEY ARRIVE: what do I do, by when,
 * what is stopping me, does it agree with what I already filed, what do I send,
 * what does each person's form say, how do I know it is right, show me one that
 * worked, prove it.
 *
 * ═══ WHY THE RECONCILIATION IS SECTION 4 AND NOT SECTION 8. ═══
 *
 * This is the one ordering decision on the page worth defending, because every
 * instinct says "show the forms first, check them later".
 *
 * The W-3 totals boxes 1, 3 and 5 across every W-2. The four 941s reported the
 * same three figures, quarter by quarter, during the year. The SSA and the IRS
 * compare them - that comparison is automatic, it is not a matter of luck, and
 * IRS Publication 15 describes it. So the question "do these agree" is not a
 * final tidy-up. It decides whether the forms below are worth reading at all.
 *
 * And the COST of the answer depends entirely on WHEN it is asked. A variance
 * found in October is a correction on the next 941: one form. The identical
 * variance found on 30 January costs a 941-X, a W-2c and a W-3c - three
 * filings to fix one number, plus a letter to answer. Putting the comparison
 * last would put the cheapest question at the bottom of the page during the
 * only months when it is cheap.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO LOGIC IN THIS FILE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Every decision - the colour, the sentence, whether a button may be pressed,
 * what the single next action is, which box is emphasised, whether a blank box
 * is blank on purpose - comes from `form-w2-ui-core.ts`, which is pure and has
 * 63 unit tests. This file arranges the answers on screen.
 *
 * A `page.tsx` cannot be tested in this repository: the vitest include is
 * `tests/compliance/`, and this is a server component that reaches the
 * database. Any rule written into the JSX below would be a rule nothing checks,
 * and on a wage report that the SSA machine-compares, an unchecked rule is how
 * a wrong number gets signed.
 *
 * The one piece of arithmetic here is the due date, and it is delegated too:
 * `onOrAfterBusinessDay` from the deposit-schedule module already knows the
 * federal holidays and the weekend rule. It is the same function the 941 screen
 * uses, so the two screens cannot disagree about what a holiday is.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS PAGE FILES NOTHING
 * ───────────────────────────────────────────────────────────────────────────
 *
 * We replace the data-preparation half of what Aatrix did. We are NOT a filing
 * agent, and nothing here transmits to the SSA or the IRS. The note under the
 * button says so in as many words, in every state, including the states where
 * the button is disabled - because a button labelled "File" that does not file
 * is the single most dangerous control this system could ship. The failure mode
 * is Michael believing a return went in when it did not, and finding out from a
 * penalty notice.
 */

import Link from "next/link";

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  citeGuidanceAuthorities,
  GUIDANCE_KIND_LABELS,
} from "@/lib/accounting/books-guidance-core";
import { formW2Authorities } from "@/lib/payroll/form-w2-authorities";
import {
  FORM_W2_WORKED_EXAMPLES,
  w2ChecksInOrder,
} from "@/lib/payroll/form-w2-mentor";
import { loadW2s } from "@/lib/payroll/form-w2-store";
// The teaching surface (books-49). `w2Boxes` existed and was called by nothing;
// the box lessons had to be written because FORM_W2_LESSONS is a MentorLesson.
import { FormBoxExplorer } from "@/components/admin/books/FormBoxExplorer";
import { w2Boxes, FORM_ID_W2 } from "@/lib/payroll/form-box-adapters";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import {
  groupW2Refusals,
  reconRows,
  reconciliationTone,
  voidNote,
  w2BoxDifferenceNote,
  w2BoxRows,
  w2ButtonState,
  w2CheckRows,
  w2DaysUntil,
  w2EmptyStateFor,
  w2ExampleRows,
  w2NextAction,
  w2RefusalCard,
  w2StatusLabel,
  w2StatusMeaning,
  w2StatusOf,
  w2StatusTone,
  w2UrgencyBand,
  w2UrgencyMeaning,
  w2UrgencyTone,
  w3Rows,
} from "@/lib/payroll/form-w2-ui-core";
import {
  dayName,
  holidaySet,
  onOrAfterBusinessDay,
} from "@/lib/payroll/payroll-deposit-schedule-core";
import type { ScreenTone } from "@/lib/ui/screen-tone-core";

export const dynamic = "force-dynamic";

/* ── colour, in one place ──────────────────────────────────────────────────
   Every tone on this page resolves through these maps, so a colour cannot
   drift between the banner and the cards. There is no `--admin-warning` token
   in this codebase; gold is the "attention" colour. */

const PANEL: Record<ScreenTone, string> = {
  green: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
  gold: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]",
  orange: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
  neutral: "border-white/12 bg-white/[0.03]",
};

const TEXT: Record<ScreenTone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-[var(--admin-danger)]",
  neutral: "text-[var(--admin-text-muted)]",
};

const BADGE: Record<ScreenTone, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  green: "green",
  gold: "gold",
  orange: "orange",
  danger: "danger",
  neutral: "neutral",
};

/**
 * The tax year this screen defaults to.
 *
 * A W-2 is prepared in the January AFTER the year it reports, so the default is
 * "last year" for the first eight months and "last year" still for the rest -
 * i.e. always the most recently COMPLETED calendar year. Nobody opens this
 * screen in March 2028 wanting 2028's incomplete figures.
 *
 * NOT HARDCODED. This screen will still be here in 2035, and a hardcoded year
 * is a wrong answer with a long fuse - it would silently show the wrong year's
 * wages, which is a form of the exact error the page exists to catch.
 */
function mostRecentlyClosedYear(today: Date): number {
  return today.getUTCFullYear() - 1;
}

/**
 * When the W-2s are due, and whether a weekend or holiday moved the date.
 *
 * IRC §6051(a) says "on or before January 31 of the succeeding year". 26 CFR
 * 301.7503-1 moves that to the next business day when the 31st is a Saturday,
 * Sunday or federal holiday. BOTH DATES ARE SHOWN on the screen, because the
 * statutory date is the one the law states and the shifted date is the one
 * Michael may actually rely on, and collapsing them into one number hides the
 * reason the later date is legitimate.
 *
 * For the 2026 tax year this matters immediately: 31 January 2027 is a Sunday,
 * so the deadline is Monday 1 February 2027 - which is exactly what
 * `form-w2-authorities.ts` records, and it is computed here rather than
 * repeated, so the two cannot drift.
 */
function dueDatesFor(taxYear: number): {
  readonly statutory: string;
  readonly effective: string;
  readonly shifted: boolean;
} {
  const statutory = `${taxYear + 1}-01-31`;
  const effective = onOrAfterBusinessDay(statutory, holidaySet(taxYear + 1));
  return { statutory, effective, shifted: effective !== statutory };
}

export default async function FormW2Page({
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

  const today = now.toISOString().slice(0, 10);
  const due = dueDatesFor(taxYear);
  const loaded = await loadW2s(taxYear);

  if (!loaded.ok) {
    return (
      <Shell taxYear={taxYear}>
        <Card>
          <CardHeader title="This year could not be read" />
          <p className="text-sm text-[var(--admin-danger)]">{loaded.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was computed and nothing was changed. This is a problem reading the
            records, not a problem with your payroll or with a form you have already
            filed. No figure on this screen was estimated to work around it.
          </p>
        </Card>
      </Shell>
    );
  }

  const { forms, w3, refusedPeople, reconciliation, filed, linesMissingWaDetail } = loaded;
  const allRefusals = refusedPeople.flatMap((p) => p.refusals);
  const action = w2NextAction({
    forms,
    refusals: allRefusals,
    recon: reconciliation,
    today,
    due: due.effective,
  });
  // `w2StatusOf` takes a COUNT, not the array. It was written that way so the
  // status can be computed from a summary row without loading every refusal —
  // and passing the array would have coerced to NaN-free nonsense silently in
  // plain JS. The compiler caught it here; that is the compiler doing the job
  // a test would otherwise have to.
  const status = w2StatusOf(forms, allRefusals.length, reconciliation);
  const button = w2ButtonState(allRefusals, forms.length);
  const daysLeft = w2DaysUntil(today, due.effective);
  const band = w2UrgencyBand(daysLeft);
  const voids = w3 ? voidNote(w3) : null;
  const empty = w2EmptyStateFor(taxYear);

  return (
    <Shell taxYear={taxYear}>
      {/* ── 1. THE ONE NEXT ACTION ───────────────────────────────────────── */}
      <section className={`rounded-[var(--admin-radius)] border p-5 ${PANEL[action.tone]}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={BADGE[w2StatusTone(status)]}>{w2StatusLabel(status)}</Badge>
          <span className="text-xs text-[var(--admin-text-faint)]">
            {taxYear} tax year &middot; read on {today}
          </span>
        </div>
        <h2 className={`mt-3 text-lg font-semibold ${TEXT[action.tone]}`}>{action.headline}</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--admin-text)]">{action.detail}</p>
        <p className="mt-3 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {w2StatusMeaning(status)}
        </p>
        {action.href ? (
          <Link
            href={action.href}
            className="mt-4 inline-flex rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1.5 text-sm font-semibold text-black"
          >
            {action.ctaLabel}
          </Link>
        ) : null}
      </section>

      {/* ── 2. THE DEADLINE ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="When these are due"
          subtitle="Two dates. The statute names one; the weekend rule may give you the other."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              The date in the statute
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--admin-text)]">{due.statutory}</p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              {dayName(due.statutory)}. IRC &sect;6051(a) says &ldquo;on or before January 31 of
              the succeeding year&rdquo;, for both copies &mdash; the one you give the employee
              and the one you send the SSA.
            </p>
          </div>
          <div className={`rounded-[var(--admin-radius)] border p-4 ${PANEL[w2UrgencyTone(band)]}`}>
            <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              The date you may actually use
            </p>
            <p className={`mt-1 text-lg font-semibold ${TEXT[w2UrgencyTone(band)]}`}>
              {due.effective}
            </p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              {due.shifted
                ? `${dayName(due.statutory)} is not a business day, so 26 CFR 301.7503-1 moves the deadline to ${dayName(due.effective)}. This is an extension the regulation gives you automatically - it is not something you request, and it is not a grace period anyone can withdraw.`
                : `${dayName(due.effective)} is a business day, so the statutory date stands and nothing moves it.`}
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {w2UrgencyMeaning(band, daysLeft, due.effective)}
        </p>
      </Card>

      {/* ── 3. WHAT IS MISSING ───────────────────────────────────────────── */}
      {refusedPeople.length > 0 ? (
        <Card>
          <CardHeader
            title={
              allRefusals.length === 1
                ? "One thing has to be fixed before these forms can be built"
                : `${allRefusals.length} things have to be fixed before these forms can be built`
            }
            subtitle="Each one says what happened, how to fix it, and why the system will not guess instead."
          />
          <div className="space-y-4">
            {groupW2Refusals(allRefusals).map((group) => {
              const card = w2RefusalCard(group.items[0]!);
              return (
                <div
                  key={group.code}
                  className={`rounded-[var(--admin-radius)] border p-4 ${PANEL[card.tone]}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`text-sm font-semibold ${TEXT[card.tone]}`}>{card.headline}</h3>
                    {group.items.length > 1 ? (
                      <Badge tone="neutral">{group.items.length} people</Badge>
                    ) : null}
                  </div>
                  <Labelled label="What happened">{card.whatHappened}</Labelled>
                  <Labelled label="How to fix it">{card.howToFix}</Labelled>
                  <Labelled label="Why this refuses instead of guessing">
                    {card.whyWeRefuse}
                  </Labelled>
                  <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
                    Affects:{" "}
                    {refusedPeople
                      .filter((p) => p.refusals.some((r) => r.code === group.code))
                      .map((p) => p.displayName)
                      .join(", ")}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* ── 4. THE RECONCILIATION ────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Does the W-3 agree with the four 941s you filed?"
          subtitle="The SSA and the IRS run this comparison automatically. It is far cheaper to fail it here."
        />

        {filed === null ? (
          <div className={`rounded-[var(--admin-radius)] border p-4 ${PANEL.gold}`}>
            <h3 className={`text-sm font-semibold ${TEXT.gold}`}>
              No 941 has been recorded for {taxYear}, so this comparison has not run.
            </h3>
            <p className="mt-2 text-sm text-[var(--admin-text)]">
              This is deliberately NOT shown as a pass. Nobody has checked, which is a
              different thing from &ldquo;checked and agreed&rdquo; and has to stay
              different &mdash; a green tick here would tell you that you are finished.
            </p>
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              Enter what you actually filed for each of the four quarters, taking the
              figures from the returns themselves. Typing them in by hand is the point:
              the comparison only means something because the two sides come from
              different places. If this screen recomputed the &ldquo;filed&rdquo; side
              from your pay runs, both sides would share one ancestor and would agree
              every single time &mdash; five green ticks that prove nothing.
            </p>
          </div>
        ) : null}

        {filed !== null && filed.quartersMissing.length > 0 ? (
          <div className={`mt-2 rounded-[var(--admin-radius)] border p-4 ${PANEL.gold}`}>
            <h3 className={`text-sm font-semibold ${TEXT.gold}`}>
              {filed.quartersFound.length} of the 4 quarters are recorded.
            </h3>
            <p className="mt-2 text-sm text-[var(--admin-text)]">
              {filed.quartersMissing.map((q) => `Q${q}`).join(" and ")}{" "}
              {filed.quartersMissing.length === 1 ? "is" : "are"} missing, so any
              comparison would be short by that much in wages and would report a
              difference that is really just absent data. Enter the missing{" "}
              {filed.quartersMissing.length === 1 ? "return" : "returns"} before relying
              on the result below.
            </p>
          </div>
        ) : null}

        {reconciliation !== null ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="py-2 pr-4 font-medium">Figure</th>
                  <th className="py-2 pr-4 text-right font-medium">W-3 says</th>
                  <th className="py-2 pr-4 text-right font-medium">The 941s say</th>
                  <th className="py-2 pr-4 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {reconRows(reconciliation).map((r) => (
                  <tr key={r.label} className="border-t border-white/8 align-top">
                    <td className="py-3 pr-4 text-[var(--admin-text)]">
                      {r.label}
                      <p className="mt-1 max-w-xl text-xs text-[var(--admin-text-muted)]">
                        {r.plain}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-[var(--admin-text)]">
                      {r.w3Display}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-[var(--admin-text)]">
                      {r.form941Display}
                    </td>
                    <td
                      className={`py-3 pr-4 text-right font-semibold tabular-nums ${TEXT[r.tone]}`}
                    >
                      {r.differenceDisplay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p
              className={`mt-3 rounded-[var(--admin-radius)] border p-3 text-sm ${
                PANEL[reconciliationTone(reconciliation)]
              }`}
            >
              {reconciliation.verdict}
            </p>
            <p className="mt-2 max-w-3xl text-xs text-[var(--admin-text-muted)]">
              The difference column is shown even when it is zero, and it is signed on
              purpose. A column that appears only when something is wrong trains the eye
              to look for its presence instead of reading it, and an unsigned difference
              hides the single most useful fact available &mdash; which side is short.
            </p>
          </div>
        ) : (
          /*
           * ═══ NOT RUN IS NOT AGREEMENT, AND AN EMPTY CARD SAYS "AGREEMENT". ═══
           *
           * `loadW2s` is careful here and the first draft of this page threw
           * that care away. The store REFUSES to compare the W-3 against
           * invented zeros, with a comment explaining why: on a year with no
           * wages, zeros against zeros comes back ALL GREEN — a vacuous
           * agreement presented as a clean bill of health (standing rule 39).
           * It sets `reconciliation` to null and its comment says "the screen
           * says so in gold".
           *
           * The screen did not say so. This branch was `: null`, so the most
           * important card on the page rendered as a heading over blank space —
           * and blank space, on a screen whose other cards fill with green
           * ticks, reads as "nothing to report". The engine's honest refusal
           * became a silent one in the last six inches of the pipeline. That is
           * standing rule 63d: the handoff is where the defect lives.
           *
           * So the absence is stated, in gold, with the exact thing that is
           * missing and the exact reason it cannot be substituted.
           */
          <div
            className={`rounded-[var(--admin-radius)] border p-4 ${PANEL.gold}`}
          >
            <p className="text-sm font-semibold">
              This check has not been run, and that is not the same as passing it.
            </p>
            <p className="mt-2 max-w-3xl text-sm">
              To compare the W-3 against what you already told the IRS, this screen needs the
              four Form 941s you actually filed for {taxYear} &mdash; as filed, not as
              recomputed here. None have been recorded yet, so there is nothing to compare
              against.
            </p>
            <p className="mt-2 max-w-3xl text-xs">
              It would be easy to compare against zero instead and show you a result. That
              result would be worthless in both directions: in a year with wages it would
              report the W-3 disagreeing with zero by your entire payroll, a five-line red
              alarm describing nothing but missing data; and in a year without wages it would
              compare zero to zero and come back <strong>all green</strong> &mdash; a clean
              bill of health that checked nothing at all. A blank card would have been just as
              misleading, which is why this panel is here instead of empty space.
            </p>
            <p className="mt-2 max-w-3xl text-xs">
              Recording them is a typing job, not a calculation: take the four returns you
              filed and enter the totals as they appear on the paper you sent. The point of
              the comparison is that the figures come from a DIFFERENT source than this
              software &mdash; if this screen computed them itself it would only ever be
              agreeing with itself, which is the one thing a cross-check may never do.
            </p>
          </div>
        )}

        {filed !== null && filed.quartersFound.length > 0 ? (
          <p className="mt-4 text-xs text-[var(--admin-text-faint)]">
            Filed figures entered from:{" "}
            {filed.quartersFound
              .map((q) => `Q${q.quarter} on ${q.filedOn} (${q.sourceNote})`)
              .join("; ")}
            .
          </p>
        ) : null}
      </Card>

      {/* ── 5. THE W-3 ───────────────────────────────────────────────────── */}
      {w3 !== null ? (
        <Card>
          <CardHeader
            title="Form W-3 — the transmittal"
            subtitle="One form for the whole business. It is the totals page for every W-2 below it."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="py-2 pr-4 font-medium">Box</th>
                  <th className="py-2 pr-4 font-medium">What it is</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {w3Rows(w3).map((r) => (
                  <tr key={r.box} className="border-t border-white/8 align-top">
                    <td className="py-3 pr-4 font-mono text-xs text-[var(--admin-text-faint)]">
                      {r.box}
                    </td>
                    <td className="py-3 pr-4 text-[var(--admin-text)]">
                      {r.caption}
                      <p className={`mt-1 max-w-xl text-xs ${TEXT[r.tone]}`}>{r.note}</p>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-[var(--admin-text)]">
                      {r.display}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {voids !== null ? (
            <p
              className={`mt-4 rounded-[var(--admin-radius)] border p-3 text-sm ${PANEL[voids.tone]}`}
            >
              {voids.body}
            </p>
          ) : null}

          {linesMissingWaDetail > 0 ? (
            <p className={`mt-3 rounded-[var(--admin-radius)] border p-3 text-sm ${PANEL.gold}`}>
              {linesMissingWaDetail}{" "}
              {linesMissingWaDetail === 1 ? "pay line does" : "pay lines do"} not record
              their own Paid Leave / WA Cares split, so box 14 below is short by whatever
              those lines withheld. Those columns were added later and are deliberately
              left empty on older lines rather than filled with zeros &mdash; a line that
              genuinely does not know its own split must not claim it withheld nothing.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* ── 6. THE FORMS, ONE PER PERSON ─────────────────────────────────── */}
      {forms.length === 0 ? (
        <Card>
          <CardHeader title={empty.title} />
          <p className="max-w-3xl text-sm text-[var(--admin-text-muted)]">{empty.body}</p>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`The ${forms.length === 1 ? "form" : `${forms.length} forms`}, box by box`}
            subtitle="Every figure shows where it came from, so you can check it instead of trusting it."
          />
          <div className="space-y-6">
            {forms.map((form) => {
              const diff = w2BoxDifferenceNote(form);
              return (
                <div
                  key={form.employeeId}
                  className="rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                      {form.employeeName || "(name incomplete)"}
                    </h3>
                    {form.isVoid ? <Badge tone="danger">Void</Badge> : null}
                    {/*
                     * THE BADGE I TRIED TO WRITE HERE WAS A LIE, AND THE
                     * COMPILER CAUGHT IT.
                     *
                     * The first draft read `form.isTwoPercentShareholder`.
                     * `W2Form` has no such field, and it must not: NOTHING in
                     * the W-2 engine knows who the shareholders are. Ownership
                     * lives in the ledger, not in payroll. Had that field
                     * existed, this screen would have been asserting a
                     * corporate-law fact from a wage record.
                     *
                     * What the engine DOES know is arithmetic: box 1 came out
                     * higher than boxes 3 and 5. So the badge states the
                     * observable, and `w2BoxDifferenceNote` supplies the
                     * reason in the engine's own words below. A screen should
                     * report what it measured and cite who explained it.
                     */}
                    {diff !== null ? <Badge tone="gold">Box 1 &gt; boxes 3 &amp; 5</Badge> : null}
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                          <th className="py-2 pr-4 font-medium">Box</th>
                          <th className="py-2 pr-4 font-medium">What it is</th>
                          <th className="py-2 pr-4 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {w2BoxRows(form).map((b) => (
                          <tr key={b.box} className="border-t border-white/8 align-top">
                            <td className="py-2.5 pr-4 font-mono text-xs text-[var(--admin-text-faint)]">
                              {b.box}
                            </td>
                            <td className="py-2.5 pr-4">
                              <span
                                className={
                                  b.emphasise
                                    ? "font-semibold text-[var(--admin-text)]"
                                    : "text-[var(--admin-text)]"
                                }
                              >
                                {b.caption}
                              </span>
                              <p className="mt-1 max-w-xl text-xs text-[var(--admin-text-muted)]">
                                {b.derivation}
                              </p>
                              {b.blankOnPurpose !== null ? (
                                <p className="mt-1 max-w-xl text-xs text-[var(--admin-text-faint)]">
                                  {b.blankOnPurpose}
                                </p>
                              ) : null}
                            </td>
                            <td
                              className={`py-2.5 pr-4 text-right tabular-nums ${
                                b.emphasise ? "font-semibold" : ""
                              } ${TEXT[b.tone]}`}
                            >
                              {b.display}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/*
                   * `w2BoxDifferenceNote` RETURNS NULL when box 1 equals boxes
                   * 3 and 5, and null here means "there is nothing unusual to
                   * explain" — not "we do not know". Those are different
                   * statements and the screen must not blur them, so the
                   * else-branch says so out loud rather than rendering empty
                   * space. Silence is the one thing a compliance screen may
                   * never use to mean "fine".
                   */}
                  {diff !== null ? (
                    <div
                      className={`mt-3 rounded-[var(--admin-radius)] border p-3 ${PANEL[diff.tone]}`}
                    >
                      <p className="text-xs font-semibold">{diff.headline}</p>
                      <p className="mt-1 text-xs">{diff.body}</p>
                      <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
                        Authority: {citeGuidanceAuthorities([diff.authorityId])}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3 text-xs text-[var(--admin-text-muted)]">
                      Boxes 1, 3 and 5 all agree. For most employees that is exactly what you
                      should see &mdash; the difference only appears when the company paid
                      something that is income to the person but not subject to Social Security
                      and Medicare.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* The button that does not file. */}
          <div className="mt-6 rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.03] p-4">
            <button
              type="button"
              disabled={!button.enabled}
              className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold ${
                button.enabled
                  ? "bg-[var(--admin-accent)] text-black"
                  : "cursor-not-allowed bg-[var(--admin-surface-2)] text-[var(--admin-text-faint)]"
              }`}
            >
              {button.label}
            </button>
            {button.disabledReason !== null ? (
              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                {button.disabledReason}
              </p>
            ) : null}
            <p className="mt-2 max-w-3xl text-xs text-[var(--admin-text-faint)]">
              {button.honestyNote}
            </p>
          </div>
        </Card>
      )}

      {/* ═══ TAKE ME TO SCHOOL — THE W-2 (books-49) ═══════════════════════════

          Michael, verbatim: "There should be a visual form for every single
          form in its own tab."

          The W-2 was the form with NO teaching tab at all. The section above
          this one renders a table per employee, and that table is exactly what
          Michael described as "still just walls of text" - you can read it,
          but you cannot click a box and be taught it.

          Two things had to be built before this could exist, and it is worth
          recording why neither was already done:

          1. `w2Boxes` had been written in form-box-adapters.ts and was used by
             NOTHING. Dead code wearing a green check (rule 50) - it was tested,
             it worked, and no screen ever called it.

          2. `FORM_W2_LESSONS` exists and looks like it fills the gap, but it is
             a MentorLesson - it teaches the FORM as a whole. The explorer needs
             BoxLessons, which teach one box each. So the eight box lessons were
             written for this slice, and every quote in them is verified
             character for character against the mirrored IRS instructions.

          UNCONDITIONAL, on purpose. Greenway's first payroll is 1 January 2027,
          so `forms` is empty for the whole of this year. Gating the teaching on
          having W-2s would hide it until the day it stopped being needed - the
          exact bug reported on the 940, 941 and Washington screens.

          WHOSE W-2 IS SHOWN. When real forms exist the FIRST one is the worked
          specimen, because the explorer teaches ONE form's boxes and eight
          identical tabs would teach nothing new; the per-person figures are in
          the table above. When none exist, the teaching specimen is used and
          every figure reads "not computed yet" rather than $0.00 - a zero here
          would claim Greenway paid somebody nothing, which is a statement
          rather than a blank. */}
      <FormBoxExplorer
        title="Form W-2, box by box"
        subtitle={
          forms.length > 0
            ? `Employer's annual wage report. Showing ${forms[0].employeeName || "the first form"} as the worked example - click a box number to be taught it: what belongs there, whose money it is, and which boxes on your other forms must agree with it.`
            : "Employer's annual wage report. Your figures are not available yet, so the amounts are marked as not computed rather than shown as zero. Every box still teaches - click a box number."
        }
        boxes={forms.length > 0 ? w2Boxes(forms[0]) : teachingBoxes(FORM_ID_W2)}
        lessons={FORM_W2_BOX_LESSONS}
      />

      {/* ── 7. THE CHECKLIST ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="How to know it is right"
          subtitle="In order. The order is the teaching — item 1 is first because its cost depends on the date."
        />
        <ol className="space-y-4">
          {w2CheckRows().map((c) => (
            <li
              key={c.key}
              className="rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.02] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-xs font-semibold text-[var(--admin-accent)]">
                  {c.order}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--admin-text)]">{c.question}</h3>
                  <Labelled label="Why here in the order">{c.whyThisOrder}</Labelled>
                  <Labelled label="How to check it">{c.howToCheck}</Labelled>
                  <Labelled label="If it fails">{c.ifItFails}</Labelled>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── 8. THE WORKED EXAMPLES ───────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={`${FORM_W2_WORKED_EXAMPLES.length} worked examples`}
          subtitle="One arithmetic step per line, so the eye can follow it instead of decoding a paragraph."
        />
        <div className="space-y-4">
          {w2ExampleRows().map((e) => (
            <details
              key={e.key}
              className="rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.02] p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">
                {e.title}
              </summary>
              <p className="mt-3 text-sm text-[var(--admin-text-muted)]">{e.setup}</p>
              <ol className="mt-3 space-y-1.5">
                {e.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-[var(--admin-text)]">
                    <span className="shrink-0 font-mono text-xs text-[var(--admin-text-faint)]">
                      {i + 1}.
                    </span>
                    <span className="tabular-nums">{s}</span>
                  </li>
                ))}
              </ol>
              <p
                className={`mt-3 rounded-[var(--admin-radius)] border p-3 text-sm ${PANEL.green}`}
              >
                <span className="font-semibold">The lesson: </span>
                {e.theLesson}
              </p>
            </details>
          ))}
        </div>
      </Card>

      {/* ── 9. THE LAW ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="The law, in its own words"
          subtitle="Collapsed by default. The plain-English reading sits beside each quotation, not instead of it."
        />
        <div className="space-y-3">
          {formW2Authorities().map((a) => (
            <details
              key={a.id}
              className="rounded-[var(--admin-radius)] border border-white/12 bg-white/[0.02] p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">
                {/*
                 * THE BADGE SHOWS A LABEL, NOT THE RAW ENUM.
                 *
                 * `books-guidance-core` ships `GUIDANCE_KIND_LABELS` with the
                 * comment "used by the UI so a badge never shows a raw enum",
                 * and the distinction earns its keep here: this panel mixes
                 * `statute` with `irs_guidance`, and those carry DIFFERENT
                 * WEIGHT. A statute binds. An IRS instruction is the agency's
                 * own view and cannot be relied on against the agency. Michael
                 * needs to see which is which, so the label is rendered rather
                 * than the identifier.
                 */}
                <span className="mr-2 rounded-[var(--admin-radius-sm)] border border-white/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--admin-text-dim)]">
                  {GUIDANCE_KIND_LABELS[a.kind]}
                </span>
                {a.cite}
              </summary>
              <p className="mt-3 whitespace-pre-line border-l-2 border-[var(--admin-gold)] pl-3 text-xs italic text-[var(--admin-text-muted)]">
                {a.quote}
              </p>
              <Labelled label="What that means here">{a.soWhat}</Labelled>
              {/*
               * `source` IS ALWAYS A URL, and books-46 is the slice that made
               * that true for all 41 rows rather than 28 of them. Seven of the
               * authorities on this screen are borrowed from `ytd-authorities`
               * and still carried a repo-relative path — non-empty, so every
               * existing check passed, and stone dead in a browser. Rendering
               * it unconditionally is deliberate: a conditional link would have
               * HIDDEN those seven instead of exposing them.
               */}
              <a
                href={a.source}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs text-[var(--admin-accent)] underline"
              >
                Read the original
              </a>
            </details>
          ))}
        </div>
      </Card>
    </Shell>
  );
}

/* ── small presentational helpers ──────────────────────────────────────────
   These hold no rules. They exist so that a label/body pair looks identical
   everywhere on the page, which is the only reason to have them. */

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">{label}</p>
      <p className="mt-0.5 max-w-3xl text-sm text-[var(--admin-text)]">{children}</p>
    </div>
  );
}

function Shell({ taxYear, children }: { taxYear: number; children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Forms W-2 and W-3 &mdash; {taxYear}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          The annual wage report. One W-2 for each person you paid, and one W-3 that totals
          them all. This screen reads the year-to-date figures your posted pay runs produced,
          shows every box with the arithmetic that made it, and compares the W-3 against the
          four 941s you actually filed. Nothing here is transmitted to the SSA or the IRS and
          nothing is written to your books &mdash; where a figure cannot be produced honestly,
          it says so instead of guessing.
        </p>
      </div>
      {children}
    </div>
  );
}
