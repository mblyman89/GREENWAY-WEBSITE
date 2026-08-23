/**
 * src/app/admin/books/financial-statements/StatementsMentor.tsx   (books-42)
 *
 * THE CPA, ON THE PAGE.
 *
 * Michael asked to be TAUGHT these statements — not shown them. He asked to
 * understand how to read them, how to use them as a tool rather than as a piece
 * of paper with numbers on it, and what matters about each one. This component
 * is that lesson, and it sits directly underneath the statements it teaches so
 * the explanation and the thing being explained are never more than a scroll
 * apart.
 *
 * EVERY WORD HERE IS DATA, NOT MARKUP. The lessons, the principles, the worked
 * example and its arithmetic all live in
 * `financial-statements-reading-mentor.ts`, which has 50 tests against it —
 * including tests that recompute the worked example from its inputs and that
 * check the prose against the arithmetic it claims. That matters more than it
 * sounds: the worked example originally claimed a gross margin of "47.9%" when
 * the real figure was 42.71%, and the only reason anybody found out was that a
 * test recomputed it. Prose in a JSX file is prose nothing can check.
 *
 * So this file maps data to markup and does nothing else.
 */
import {
  STATEMENT_LESSONS,
  STATEMENT_PRINCIPLES,
  WORKED_EXAMPLE_IS_ILLUSTRATIVE,
  workedExample,
  theSentence,
} from "@/lib/accounting/financial-statements-reading-mentor";
import { formatCents } from "@/lib/accounting/financial-statements-core";

export function StatementsMentor() {
  const example = workedExample();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-white">Learning to read these</h2>
        <p className="mt-1 text-sm text-white/50">
          Everything below is here so these four pages become a tool you use rather than a report
          you file. Take them in order the first time.
        </p>
      </div>

      {/* ─────────────────── 1) THE FOUR, ONE AT A TIME ─────────────────── */}
      <div className="space-y-3">
        {STATEMENT_LESSONS.map((l) => (
          <details
            key={l.statement}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
          >
            <summary className="cursor-pointer">
              <span className="text-sm font-black text-white">{l.title}</span>
              <span className="mt-1 block text-sm italic text-white/60">
                {l.theQuestionItAnswers}
              </span>
            </summary>

            <div className="mt-4 space-y-4">
              <Field label="Period or instant" body={l.periodOrInstant} />
              <Field label="What it is" body={l.whatItIs} />
              <Field label="How to read it" body={l.howToReadIt} />
              <Field label="What good looks like, for a shop like yours" body={l.whatGoodLooksLike} />
              <Field
                label="The expensive mistake"
                body={l.theExpensiveMistake}
                tone="orange"
              />
              <Field label="What §280E changes about it" body={l.the280eTwist} tone="gold" />
              <Field label="What I would do" body={l.whatIWouldDo} tone="green" />
            </div>
          </details>
        ))}
      </div>

      {/* ───────────────── 2) THE THINGS TRUE OF ALL FOUR ───────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-black text-white">
          Seven things that are true of all four
        </h3>
        <p className="mt-1 text-sm text-white/50">
          These are the parts people get wrong for years without ever finding out.
        </p>
        <div className="mt-4 space-y-4">
          {STATEMENT_PRINCIPLES.map((p) => (
            <div key={p.key}>
              <p className="text-sm font-bold text-white">{p.headline}</p>
              <p className="mt-1 text-sm leading-relaxed text-white/70">{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ──────────────────── 3) THE WORKED EXAMPLE ──────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-black text-white">
          One month, worked all the way through
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-white/55">
          {WORKED_EXAMPLE_IS_ILLUSTRATIVE}
        </p>

        <div className="mt-4 space-y-3">
          {example.map((line) => (
            <div
              key={line.label}
              className={`rounded-xl border p-3 ${
                line.isDerived
                  ? "border-white/15 bg-white/[0.03]"
                  : "border-white/[0.06] bg-transparent"
              }`}
            >
              <div className="flex items-baseline justify-between gap-4">
                <p
                  className={`text-sm ${
                    line.isDerived ? "font-black text-white" : "text-white/75"
                  }`}
                >
                  {line.label}
                </p>
                <p
                  className={`font-mono text-sm ${
                    line.isDerived ? "font-black text-white" : "text-white/75"
                  }`}
                >
                  {formatCents(line.amountCents)}
                </p>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-white/55">{line.note}</p>
            </div>
          ))}
        </div>

        {/* THE PAYOFF. This sentence is DERIVED from the lines above rather
            than typed, so it can never drift from them. */}
        <div className="mt-4 rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-4">
          <p className="text-sm font-black leading-relaxed text-white">{theSentence()}</p>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  body,
  tone = "neutral",
}: {
  label: string;
  body: string;
  tone?: "neutral" | "green" | "gold" | "orange";
}) {
  const cls =
    tone === "green"
      ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]"
      : tone === "gold"
        ? "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]"
        : tone === "orange"
          ? "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]"
          : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs font-black uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/80">{body}</p>
    </div>
  );
}
