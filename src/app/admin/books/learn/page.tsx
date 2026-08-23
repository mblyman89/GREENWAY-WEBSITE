/**
 * src/app/admin/books/learn/page.tsx   (books-44, slice C)
 *
 * THE 82 LESSONS, ON SCREEN AT LAST.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, AND WHAT THIS FIXES
 * ────────────────────────────────────────────────────────────────────────────
 * Six mentor modules in this system - 2,345 lines of finished, tested teaching
 * across 82 lessons - were reachable from NOWHERE. Zero imports from `src/app`,
 * zero from `src/components`. Their tests passed every single night while
 * Michael could not read one word of them. The books-38 gap report named all
 * six. That is standing rule 50 in its purest form: dead code wearing a green
 * check.
 *
 * This page is the thing that ends it. Every one of the 82 is now reachable,
 * and the page counts them in front of you rather than asking you to believe a
 * number in a comment.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE CONTAINS NO TEACHING AND NO DECISIONS
 * ────────────────────────────────────────────────────────────────────────────
 * Not one sentence of instruction is typed here. The lessons live in the six
 * mentors, the running order lives in `learning-path-core.ts`, and every
 * presentational choice - which colour a unit wears, what the position line
 * says, what the search box matched on, whether the coverage banner is green or
 * orange - lives in `learning-path-ui-core.ts`, which is pure and fully tested.
 *
 * The reason is blunt and was learned expensively in books-42: `tests/compliance`
 * cannot render a server component, so a claim written into JSX is a claim
 * nothing can check. A worked example typed straight into markup once asserted
 * a gross margin of "47.9%" when the arithmetic gave 42.71%, and it was caught
 * only because a test recomputed it. If you find yourself wanting to write a
 * sentence of teaching, a piece of arithmetic, or a ternary about meaning in
 * this file, it belongs in the UI core where a test can reach it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE CLASS STRINGS ARE WRITTEN OUT IN FULL BELOW
 * ────────────────────────────────────────────────────────────────────────────
 * Tailwind only emits the classes it can literally SEE in the source. A class
 * assembled by string concatenation - `` `border-${accent}-400/40` `` -
 * typechecks, builds without a murmur, and renders an unstyled page, which
 * looks like a rendering fault rather than a build fault. So the accent map
 * below is a `Record<UnitAccent, ...>` of literal strings: adding a ninth unit
 * to the curriculum breaks the BUILD here instead of silently shipping a
 * colourless card.
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  HOW_TO_USE_THIS,
  LEARNING_SCOPE_NOTE,
  MIN_QUERY_LENGTH,
  buildLearningScreen,
  type FieldTone,
  type LessonCard,
  type UnitAccent,
} from "@/lib/accounting/learning-path-ui-core";
import type { WorkedExample } from "@/lib/accounting/worked-examples-core";
import { AuthorityPanel } from "@/components/admin/books/AuthorityPanel";

export const dynamic = "force-dynamic";

/* ── The eight accents, written out so Tailwind can see every one ─────────── */

type AccentStyle = {
  readonly card: string;
  readonly text: string;
  readonly chip: string;
  readonly tabOn: string;
  readonly rail: string;
};

const ACCENT: Record<UnitAccent, AccentStyle> = {
  slate: {
    card: "border-slate-400/35 bg-slate-400/[0.06]",
    text: "text-slate-200",
    chip: "bg-slate-400/15 text-slate-200 ring-1 ring-slate-400/30",
    tabOn: "border-slate-400/60 bg-slate-400/15 text-slate-100",
    rail: "bg-slate-400/60",
  },
  sky: {
    card: "border-sky-400/35 bg-sky-400/[0.06]",
    text: "text-sky-200",
    chip: "bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30",
    tabOn: "border-sky-400/60 bg-sky-400/15 text-sky-100",
    rail: "bg-sky-400/60",
  },
  emerald: {
    card: "border-emerald-400/35 bg-emerald-400/[0.06]",
    text: "text-emerald-200",
    chip: "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30",
    tabOn: "border-emerald-400/60 bg-emerald-400/15 text-emerald-100",
    rail: "bg-emerald-400/60",
  },
  violet: {
    card: "border-violet-400/35 bg-violet-400/[0.06]",
    text: "text-violet-200",
    chip: "bg-violet-400/15 text-violet-200 ring-1 ring-violet-400/30",
    tabOn: "border-violet-400/60 bg-violet-400/15 text-violet-100",
    rail: "bg-violet-400/60",
  },
  cyan: {
    card: "border-cyan-400/35 bg-cyan-400/[0.06]",
    text: "text-cyan-200",
    chip: "bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/30",
    tabOn: "border-cyan-400/60 bg-cyan-400/15 text-cyan-100",
    rail: "bg-cyan-400/60",
  },
  indigo: {
    card: "border-indigo-400/35 bg-indigo-400/[0.06]",
    text: "text-indigo-200",
    chip: "bg-indigo-400/15 text-indigo-200 ring-1 ring-indigo-400/30",
    tabOn: "border-indigo-400/60 bg-indigo-400/15 text-indigo-100",
    rail: "bg-indigo-400/60",
  },
  amber: {
    card: "border-amber-400/35 bg-amber-400/[0.06]",
    text: "text-amber-200",
    chip: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30",
    tabOn: "border-amber-400/60 bg-amber-400/15 text-amber-100",
    rail: "bg-amber-400/60",
  },
  rose: {
    card: "border-rose-400/35 bg-rose-400/[0.06]",
    text: "text-rose-200",
    chip: "bg-rose-400/15 text-rose-200 ring-1 ring-rose-400/30",
    tabOn: "border-rose-400/60 bg-rose-400/15 text-rose-100",
    rail: "bg-rose-400/60",
  },
};

/**
 * The four field tones.
 *
 * FIXED BY MEANING, NEVER BY TASTE - gold is always "why this exists", orange
 * is always "what goes wrong", green is always "what I would do". Michael said
 * the verbatim panels were "hard to digest as there is a wall of words and
 * color"; the answer to that is not less colour, it is colour that means
 * something the same way every single time, so after two lessons he is finding
 * the orange block before he has read a word.
 */
const TONE: Record<FieldTone, string> = {
  neutral: "border-white/10 bg-black/20",
  gold: "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]",
  orange: "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]",
  green: "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]",
  quote: "border-amber-400/30 bg-amber-400/[0.10]",
};

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; q?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;

  const screen = buildLearningScreen({ unitKey: sp.unit ?? null, query: sp.q ?? null });
  const unit = screen.unit;
  const accent = ACCENT[unit.accent];

  return (
    <div className="space-y-5">
      {/* ─────────────────────────── TITLE ─────────────────────────── */}
      <div>
        <h1 className="text-2xl font-black text-white">Learning the books</h1>
        <p className="mt-1 text-sm text-white/50">{screen.subtitle}</p>
      </div>

      {/* ──────────────────── COVERAGE, COUNTED LIVE ───────────────── */}
      <div
        className={`rounded-2xl border p-5 ${
          screen.coverage.tone === "green"
            ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]"
            : "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]"
        }`}
      >
        <p className="text-sm font-black text-white">{screen.coverage.headline}</p>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{screen.coverage.body}</p>
        {screen.coverage.gaps.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {screen.coverage.gaps.map((g) => (
              <li key={g} className="font-mono text-[11px] text-white/60">
                {g}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ───────────────────────── THE SCOPE ───────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black text-white">What this course is, and what it is not</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/65">{LEARNING_SCOPE_NOTE}</p>
      </div>

      {/* ──────────────────────── HOW TO USE IT ────────────────────── */}
      <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <summary className="cursor-pointer text-sm font-black text-white">
          How to get the most out of this
        </summary>
        <div className="mt-4 space-y-4">
          {HOW_TO_USE_THIS.map((h, i) => (
            <div key={h.step}>
              <p className="text-sm font-bold text-white">
                {i + 1}. {h.step}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/65">{h.body}</p>
            </div>
          ))}
        </div>
      </details>

      {/* ────────────────────────── SEARCH ─────────────────────────── */}
      <form
        method="get"
        action="/admin/books/learn"
        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
      >
        <label htmlFor="q" className="text-xs font-black uppercase tracking-wide text-white/50">
          Find a lesson
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="q"
            name="q"
            defaultValue={screen.query}
            placeholder={`Any word, at least ${MIN_QUERY_LENGTH} characters — "I-9", "interest", "rounding"`}
            className="min-w-[16rem] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25"
          />
          <input type="hidden" name="unit" value={unit.key} />
          <button
            type="submit"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white"
          >
            Search
          </button>
        </div>

        {screen.searchNotice ? (
          <p className="mt-3 text-sm leading-relaxed text-white/60">{screen.searchNotice}</p>
        ) : null}

        {screen.hits.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {screen.hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  href={hit.href}
                  className={`block rounded-xl border p-3 ${ACCENT[hit.accent].card}`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm font-bold text-white">{hit.fn}</span>
                    <span className={`text-[11px] ${ACCENT[hit.accent].text}`}>
                      {hit.unitTitle} · lesson {hit.globalIndex}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-white/70">{hit.summary}</p>
                  <p className="mt-1 text-[11px] text-white/40">
                    Matched in: {hit.matchedIn.join(", ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      {/* ───────────────────────── THE TABS ────────────────────────── */}
      <nav className="flex flex-wrap gap-2">
        {screen.tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`rounded-xl border px-3 py-2 text-xs font-bold ${
              t.isCurrent ? ACCENT[t.accent].tabOn : "border-white/10 bg-white/[0.02] text-white/55"
            }`}
          >
            <span className="mr-1 opacity-60">{t.stepNumber}.</span>
            {t.shortTitle}
            <span className="ml-2 opacity-50">{t.lessonCount}</span>
          </Link>
        ))}
      </nav>

      {screen.unknownUnitRequested ? (
        <p className="rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-3 text-sm text-white/75">
          There is no unit called &ldquo;{screen.unknownUnitRequested}&rdquo; — the link may be from
          an older version of this page. Showing the first unit instead, rather than a blank screen.
        </p>
      ) : null}

      {/* ─────────────────────── THE OPEN UNIT ─────────────────────── */}
      <section className={`rounded-2xl border p-6 ${accent.card}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}
          >
            Unit {unit.stepNumber} of {unit.stepCount}
          </span>
          <span className="text-[11px] text-white/40">{unit.positionLine}</span>
        </div>

        <h2 className="mt-3 text-xl font-black text-white">{unit.title}</h2>
        <p className={`mt-2 text-base italic ${accent.text}`}>{unit.theQuestion}</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="When you need this" body={unit.whenYouNeedIt} tone="neutral" />
          <Field label="Why it sits here in the order" body={unit.whyHere} tone="gold" />
        </div>

        <div className="mt-3">
          <Field
            label="If you remember one thing from this unit"
            body={unit.theOneThing}
            tone="green"
          />
        </div>
      </section>

      {/* ───────────────────────── THE LESSONS ─────────────────────── */}
      <div className="space-y-3">
        {unit.lessons.map((l) => (
          <LessonView key={l.id} lesson={l} />
        ))}
      </div>

      {/* ──────────────────────── WHERE TO NEXT ────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        {unit.prevUnit ? (
          <Link href={unit.prevUnit.href} className="text-sm text-white/60">
            ← Back to unit {unit.stepNumber - 1}: {unit.prevUnit.title}
          </Link>
        ) : (
          <span className="text-sm text-white/30">This is where the course starts.</span>
        )}

        {unit.nextUnit ? (
          <Link
            href={unit.nextUnit.href}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white"
          >
            Next — unit {unit.stepNumber + 1}: {unit.nextUnit.title} →
          </Link>
        ) : (
          <span className="text-sm text-white/40">
            That is the whole course. Come back to any lesson through the search box above.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One lesson.
 *
 * COLLAPSED BY DEFAULT, and that is the single most important layout decision
 * on this page. Twenty-two open lessons is the wall of words Michael already
 * told us he cannot read. Closed, the unit is a scannable list of one-line
 * summaries he can run his eye down; open, one lesson at a time is four short
 * blocks and its citations.
 */
function LessonView({ lesson }: { lesson: LessonCard }) {
  const accent = ACCENT[lesson.accent];

  return (
    <details
      id={lesson.anchor}
      className="scroll-mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
    >
      <summary className="cursor-pointer">
        <span className="inline-flex flex-wrap items-baseline gap-2">
          <span className={`inline-block h-3 w-1 rounded-full ${accent.rail}`} aria-hidden />
          <span className="font-mono text-sm font-black text-white">{lesson.fn}</span>
          <span className="text-[11px] text-white/35">
            {lesson.globalIndex} · {lesson.sourceLabel}
          </span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-white/60">{lesson.summary}</span>
      </summary>

      <p className="mt-3 text-[11px] uppercase tracking-wide text-white/30">
        {lesson.positionLine}
      </p>

      {/*
        THE WORKED EXAMPLE COMES FIRST, BEFORE THE FOUR PARAGRAPHS.

        The order is the whole point. Michael is a visual learner who told us
        these cards were "a wall of words and color", and the measurement bore
        him out: the 82 lessons average 173 words each and only 25 of them
        contain a single number. Putting the table underneath the prose would
        mean reaching it only after reading the wall. Putting it on top means
        the first thing on an opened lesson is four rows of real Greenway
        figures, and the paragraphs below become the explanation of something
        already seen rather than a preamble to it.
      */}
      {lesson.workedExample ? <WorkedExampleView example={lesson.workedExample} /> : null}

      <div className="mt-3 space-y-3">
        {lesson.fields.map((f) => (
          <Field key={f.label} label={f.label} body={f.body} tone={f.tone} />
        ))}
      </div>

      {lesson.authorityIds.length > 0 ? (
        <div className="mt-4">
          <AuthorityPanel
            ids={lesson.authorityIds}
            title="The law behind this lesson"
            intro="Inside the amber block are their words, exactly as written. Outside it are mine."
          />
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/55">
          {lesson.noAuthorityNote}
        </p>
      )}
    </details>
  );
}

/**
 * A worked example: the engine's own arithmetic, laid out as a table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LOOKS THE WAY IT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * Three rules, all borrowed from the rest of this page rather than invented
 * here, because a screen where colour means different things in different
 * places is the "wall of colour" complaint all over again:
 *
 *   • ORANGE IS ALWAYS THE TRAP. It means exactly what it means in the
 *     "What goes wrong here" block six inches below. A reader who has learned
 *     the colour once has learned it everywhere.
 *   • THE OUTPUT COLUMN IS MONOSPACED AND EMPHASISED. It is the answer, and it
 *     is the reason the table exists; it should be findable without reading.
 *   • EVERY ROW EXPLAINS ITSELF. A number with no sentence beside it is a
 *     figure to be taken on faith, which is how Sage taught him nothing.
 *
 * Rendered as a real <table> rather than a grid of divs so that the row and
 * column relationships survive for a screen reader, and so it prints sensibly.
 */
function WorkedExampleView({ example }: { example: WorkedExample }) {
  return (
    <section className="mt-4 rounded-xl border border-sky-400/35 bg-sky-400/[0.06] p-4">
      <p className="text-xs font-black uppercase tracking-wide text-sky-200/80">
        Worked example
      </p>
      <h4 className="mt-1 text-sm font-black text-white">{example.title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-white/70">{example.setup}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-white/40">
              <th scope="col" className="border-b border-white/10 py-2 pr-4 font-black">
                What happens
              </th>
              <th scope="col" className="border-b border-white/10 py-2 pr-4 font-black">
                What it comes to
              </th>
              <th scope="col" className="border-b border-white/10 py-2 font-black">
                Why that matters
              </th>
            </tr>
          </thead>
          <tbody>
            {example.rows.map((row) => (
              <tr
                key={row.given}
                className={
                  row.isTrap
                    ? "bg-[var(--admin-orange)]/[0.10] align-top"
                    : "align-top"
                }
              >
                <td className="border-b border-white/5 py-2 pr-4 text-white/75">
                  {row.isTrap ? (
                    <span
                      className="mr-2 inline-block rounded bg-[var(--admin-orange)]/25 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--admin-orange)]"
                      title="This is the case the lesson warns about"
                    >
                      Trap
                    </span>
                  ) : null}
                  {row.given}
                </td>
                <td className="border-b border-white/5 py-2 pr-4 font-mono text-sm font-black text-white">
                  {row.output}
                </td>
                <td className="border-b border-white/5 py-2 text-white/60">{row.soWhat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.08] p-3 text-sm leading-relaxed text-white/80">
        <span className="font-black uppercase tracking-wide text-[var(--admin-accent)]">
          The point:{" "}
        </span>
        {example.takeaway}
      </p>

      <p className="mt-2 text-[11px] leading-relaxed text-white/30">
        Every figure above was produced by running the same code that runs your
        real books — not typed in by hand. If the engine ever changes, this table
        changes with it.
      </p>
    </section>
  );
}

/** One labelled block. The tone comes from the data, never from this file. */
function Field({ label, body, tone }: { label: string; body: string; tone: FieldTone }) {
  return (
    <div className={`rounded-xl border p-4 ${TONE[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/80">{body}</p>
    </div>
  );
}
