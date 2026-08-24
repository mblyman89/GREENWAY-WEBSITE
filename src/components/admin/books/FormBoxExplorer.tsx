"use client";

/**
 * src/components/admin/books/FormBoxExplorer.tsx   (books-47, slice D)
 *
 * THE FORM / WHY / CHECK SURFACE. CLICK A BOX, LEARN THE BOX.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS COMPONENT EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   "Please move on to adding the forms to all the forms pages. I want to be
 *    able to see the form, and click a box to have it teach me all there is to
 *    know about that box. It should be thorough and verbatim and plain English
 *    explain actions. It should teach me how to read them and use them as a
 *    tool. Everything a cpa would know about these forms, I want to know to. I
 *    like colors and worked examples and such. When I say take me to school, I
 *    meant while I'm in the system working. If I'm unsure about something,
 *    there should be a teaching lesson to help me through the process."
 *
 * And the correction that set the scope:
 *
 *   "the majority of the forms I really am interested in are the payroll forms
 *    like 940 941 l&I esd pfml wa cares etc."
 *
 * `docs/BOOKS_ROADMAP.md` lines 53-134 define the three tabs:
 *
 *   Form  - the form AS PRINTED, with correctly-blank boxes grey and labelled
 *           "blank on purpose" together with the reason.
 *   Why   - the authority for ONE box at a time, on click.
 *   Check - the reconciliations.
 *
 * The roadmap also fixes the honesty of the thing: "this is a *worksheet and
 * review* surface, not a filing surface." Nothing here transmits anything.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO LOGIC IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every decision - which boxes are clickable, how wide a bar segment is, what
 * colour a failed reconciliation is - comes from `form-box-ui-core.ts`, which
 * is pure and mutation-tested. A rule written into JSX is a rule nothing
 * checks, and the vitest include is `tests/compliance/`, so a rule written
 * here could never be tested at all.
 *
 * The one thing this file DOES decide is the tab, because which tab is open is
 * genuinely a property of the screen and of nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A CLIENT COMPONENT, AND THE GATE THAT CONSTRAINS IT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tabs and a selected box are interaction, so this must be `"use client"`.
 * That drags in `client-bundle-purity.test.ts`: no `"use client"` file may
 * transitively reach `node:fs`. It exists because a client component once
 * imported a mentor that called readFileSync and every Vercel build died while
 * CI stayed green for slices on end.
 *
 * So this file imports ONLY pure modules. The verbatim-quote checking that
 * reads the mirrored corpus off disk lives in the test files, deliberately,
 * where it cannot reach a browser bundle. The lessons and boxes arrive as
 * PROPS from a server component that did whatever reading it needed.
 */

import { useMemo, useState } from "react";

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import {
  type BoxLesson,
  type FormBox,
  lessonFor,
} from "@/lib/payroll/form-box-core";
import {
  type CheckRow,
  checkSummary,
  checkTone,
  renderableBoxes,
  splitBar,
  untaughtBoxes,
} from "@/lib/payroll/form-box-ui-core";
import type { ScreenTone } from "@/lib/ui/screen-tone-core";

/* ── colour, in one place ────────────────────────────────────────────────
   Every tone on this screen resolves through these maps, so a colour cannot
   drift between the bar, the badges and the check rows. There is no
   `--admin-warning` token in this codebase; gold is the "attention" colour.
   Michael asked for colour explicitly, so it is used to carry MEANING and
   never as decoration. */

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

const FILL: Record<ScreenTone, string> = {
  green: "bg-[var(--admin-accent)]",
  gold: "bg-[var(--admin-gold)]",
  orange: "bg-[var(--admin-orange)]",
  danger: "bg-[var(--admin-danger)]",
  neutral: "bg-white/20",
};

/** Milli-percent as a human string: 29403 -> "29.403%". */
function milliPct(v: number | null): string {
  if (v === null) return "—";
  const whole = Math.trunc(v / 1000);
  const frac = Math.abs(v % 1000).toString().padStart(3, "0");
  return `${whole}.${frac}%`;
}

/** Cents as dollars, sign preserved. A negative must READ as negative. */
function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return neg ? `−${s}` : s;
}

export type FormBoxExplorerProps = {
  /** The form's boxes, already translated by the adapters. */
  readonly boxes: readonly FormBox[];
  /** Every lesson available. Filtered per box by formId + box. */
  readonly lessons: readonly BoxLesson[];
  /** The reconciliations for the Check tab. May be empty. */
  readonly checks?: readonly CheckRow[];
  /** The form's title, as printed on the paper. */
  readonly title: string;
  /**
   * What this form is for, in one sentence. Shown above the tabs so a reader
   * who opened the wrong screen knows immediately.
   */
  readonly subtitle: string;
};

type Tab = "form" | "why" | "check";

export function FormBoxExplorer({
  boxes,
  lessons,
  checks = [],
  title,
  subtitle,
}: FormBoxExplorerProps) {
  const [tab, setTab] = useState<Tab>("form");
  const [selected, setSelected] = useState<string | null>(null);

  const rendered = useMemo(() => renderableBoxes(boxes, lessons), [boxes, lessons]);
  const bar = useMemo(() => splitBar(boxes), [boxes]);
  const untaught = useMemo(() => untaughtBoxes(rendered), [rendered]);

  const openBox = rendered.find((r) => r.box.box === selected) ?? null;
  const openLesson =
    openBox === null ? undefined : lessonFor(lessons, openBox.box.formId, openBox.box.box);

  /** Clicking a box selects it AND moves to Why, because that is the intent. */
  function teach(boxNumber: string): void {
    setSelected(boxNumber);
    setTab("why");
  }

  const summaryTone = checkTone(checks);

  return (
    <div className="space-y-4">
      {/* ── heading + tabs ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={title}
          subtitle={subtitle}
          action={
            <Badge tone={untaught.length === 0 ? "green" : "gold"}>
              {untaught.length === 0
                ? "every box teaches"
                : `${untaught.length} box${untaught.length === 1 ? "" : "es"} not yet taught`}
            </Badge>
          }
        />

        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Form, Why, Check">
          {(
            [
              ["form", "Form", "the form as it prints"],
              ["why", "Why", "the authority, one box at a time"],
              ["check", "Check", "the reconciliations"],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-[var(--admin-radius-sm)] border px-3 py-1.5 text-left text-xs transition ${
                tab === id
                  ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                  : "border-white/12 bg-white/[0.03] text-[var(--admin-text-muted)] hover:border-white/25"
              }`}
            >
              <span className="font-semibold uppercase tracking-wide">{label}</span>
              <span className="ml-2 normal-case opacity-70">{hint}</span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
          This is a worksheet and review surface, not a filing surface. Nothing here is
          transmitted to the IRS, ESD, L&amp;I or anyone else. You file the form yourself; this
          screen shows you what the figures are, where each one came from, and whether they
          agree with each other.
        </p>
      </Card>

      {/* ── FORM TAB ───────────────────────────────────────────────────── */}
      {tab === "form" && (
        <Card>
          <CardHeader
            title="The form, as it prints"
            subtitle="Click any box with a dotted underline to be taught it. Grey boxes with a reason are blank ON PURPOSE."
          />

          {!bar.empty && (
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between text-[0.7rem]">
                <span className="text-[var(--admin-text-muted)]">Whose money is on this form</span>
                <span className="text-[var(--admin-text-muted)]">
                  total {money(bar.split.totalCents)}
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full border border-white/12">
                {bar.segments.map((s) => (
                  <div
                    key={s.label}
                    className={FILL[s.tone]}
                    style={{ width: `${s.widthPct}%` }}
                    title={`${s.label}: ${money(s.cents)} (${milliPct(s.exactMilliPct)})`}
                  />
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem]">
                {bar.segments.map((s) => (
                  <span key={s.label} className={TEXT[s.tone]}>
                    {s.label}: {money(s.cents)}{" "}
                    <span className="opacity-70">({milliPct(s.exactMilliPct)})</span>
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[0.65rem] text-[var(--admin-text-muted)]">
                The bar is drawn to the nearest whole percent so it cannot overflow its
                container; the percentages printed beside it are exact to three decimals.
                Wage-base boxes are excluded from the split deliberately — a wage base is a
                measuring stick, not money anybody owes.
              </p>
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3">Box</th>
                  <th className="py-2 pr-3">As the form captions it</th>
                  <th className="py-2 pr-3 text-right">Figure</th>
                  <th className="py-2">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                {rendered.map((r) => (
                  <tr
                    key={`${r.box.formId}:${r.box.box}`}
                    className={`border-b border-white/[0.06] align-top ${
                      r.correctlyBlank ? "opacity-60" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 font-mono text-[0.7rem]">
                      {r.hasLesson ? (
                        <button
                          type="button"
                          onClick={() => teach(r.box.box)}
                          className="rounded border-b border-dotted border-[var(--admin-accent)] text-[var(--admin-accent)] hover:bg-[var(--admin-accent-soft)]"
                          aria-label={`Teach me box ${r.box.box}`}
                        >
                          {r.box.box}
                        </button>
                      ) : (
                        <span className="text-[var(--admin-text-muted)]">{r.box.box}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={r.box.emphasise ? "font-semibold" : ""}>
                        {r.box.caption}
                      </span>
                      {r.correctlyBlank && (
                        <div className="mt-1 text-[0.65rem] text-[var(--admin-text-muted)]">
                          <span className="mr-1 rounded bg-white/10 px-1 py-0.5 uppercase tracking-wide">
                            blank on purpose
                          </span>
                          {r.box.blankOnPurpose}
                        </div>
                      )}
                      {r.empty && !r.correctlyBlank && (
                        <div className="mt-1 text-[0.65rem] text-[var(--admin-orange)]">
                          Empty, and nothing on file explains why. Check this before you file.
                        </div>
                      )}
                    </td>
                    <td className={`py-2 pr-3 text-right font-mono ${TEXT[r.tone]}`}>
                      {r.printed}
                    </td>
                    <td className="py-2 text-[0.7rem] text-[var(--admin-text-muted)]">
                      {r.box.derivation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {untaught.length > 0 && (
            <p className="mt-3 text-[0.7rem] text-[var(--admin-text-muted)]">
              Boxes with no lesson yet: {untaught.join(", ")}. They are shown without a dotted
              underline so a click is never wasted. This count is asserted in the test suite and
              is meant to fall to zero.
            </p>
          )}
        </Card>
      )}

      {/* ── WHY TAB ────────────────────────────────────────────────────── */}
      {tab === "why" && (
        <Card>
          {openLesson === undefined ? (
            <>
              <CardHeader
                title="Pick a box"
                subtitle="Every box with a dotted underline on the Form tab has a full lesson behind it."
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {rendered
                  .filter((r) => r.hasLesson)
                  .map((r) => (
                    <button
                      key={r.box.box}
                      type="button"
                      onClick={() => teach(r.box.box)}
                      className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-xs hover:border-[var(--admin-accent)]/50"
                    >
                      <span className="font-mono text-[var(--admin-accent)]">{r.box.box}</span>
                      <span className="ml-2 text-[var(--admin-text-muted)]">{r.box.caption}</span>
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <>
              <CardHeader
                title={`Box ${openLesson.box} — ${openLesson.headline}`}
                subtitle={openBox?.box.caption}
                action={
                  <Badge tone="neutral">
                    {openBox === null ? "" : openBox.printed}
                  </Badge>
                }
              />

              <div className="mt-3 space-y-3 text-xs leading-relaxed">
                <Lesson label="What this box is" tone="neutral">
                  {openLesson.plainEnglish}
                </Lesson>
                <Lesson label="Where the figure comes from" tone="neutral">
                  {openLesson.whereItComesFrom}
                </Lesson>
                <Lesson label="How to read it as a tool" tone="green">
                  {openLesson.howToReadIt}
                </Lesson>
                {openLesson.commonMistake !== null && (
                  <Lesson label="The mistake people actually make" tone="orange">
                    {openLesson.commonMistake}
                  </Lesson>
                )}
                <Lesson label="What to do" tone="gold">
                  {openLesson.whatToDo}
                </Lesson>
              </div>

              {openLesson.examples.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Worked examples
                  </h4>
                  {openLesson.examples.map((ex) => (
                    <div
                      key={ex.title}
                      className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL.neutral}`}
                    >
                      <div className="text-xs font-semibold">{ex.title}</div>
                      <ol className="mt-2 list-decimal space-y-1 pl-4 text-[0.7rem] text-[var(--admin-text-muted)]">
                        {ex.steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                      <div className="mt-2 font-mono text-xs text-[var(--admin-accent)]">
                        = {ex.answer}
                      </div>
                      <div className="mt-1 text-[0.7rem] italic text-[var(--admin-text-muted)]">
                        {ex.moral}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {openLesson.quotes.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    The authority, word for word
                  </h4>
                  {openLesson.quotes.map((q) => (
                    <div
                      key={q.cite}
                      className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL.gold}`}
                    >
                      <div className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-gold)]">
                        {q.cite}
                      </div>
                      <blockquote className="mt-2 border-l-2 border-[var(--admin-gold)]/50 pl-3 text-[0.72rem] italic">
                        “{q.quote}”
                      </blockquote>
                      <div className="mt-2 text-[0.7rem]">
                        <span className="font-semibold">What that means here: </span>
                        {q.soWhat}
                      </div>
                      <a
                        href={q.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-[0.65rem] text-[var(--admin-accent)] underline"
                      >
                        Read the source
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {openLesson.tiesTo.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    What this box must agree with
                  </h4>
                  <ul className="mt-2 space-y-1 text-[0.7rem]">
                    {openLesson.tiesTo.map((t) => (
                      <li key={`${t.formId}:${t.box}`} className="text-[var(--admin-text-muted)]">
                        <span className="font-mono text-[var(--admin-accent)]">
                          {t.formId} box {t.box}
                        </span>
                        {" — "}
                        {t.why}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[0.65rem] text-[var(--admin-text-muted)]">
                    These links are what turn a stack of forms into a system. If two of them
                    disagree, one of them is wrong, and finding out here costs minutes instead
                    of waiting for a notice.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => setTab("form")}
                className="mt-4 rounded-[var(--admin-radius-sm)] border border-white/12 px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:border-white/25"
              >
                ← Back to the form
              </button>
            </>
          )}
        </Card>
      )}

      {/* ── CHECK TAB ──────────────────────────────────────────────────── */}
      {tab === "check" && (
        <Card>
          <CardHeader
            title="The reconciliations"
            subtitle="Two figures that must agree, and the plain-English consequence when they do not."
            action={<Badge tone={summaryTone === "neutral" ? "neutral" : summaryTone}>{summaryTone}</Badge>}
          />

          <div className={`mt-3 rounded-[var(--admin-radius-sm)] border p-3 ${PANEL[summaryTone]}`}>
            <p className={`text-xs font-semibold ${TEXT[summaryTone]}`}>{checkSummary(checks)}</p>
          </div>

          <div className="mt-3 space-y-3">
            {checks.map((c) => (
              <div
                key={c.title}
                className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL[c.tone]}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold">{c.title}</span>
                  <Badge tone={c.tone === "neutral" ? "neutral" : c.tone}>{c.outcome}</Badge>
                </div>
                <p className="mt-1 text-[0.7rem] text-[var(--admin-text-muted)]">{c.question}</p>
                <div className="mt-2 grid gap-2 text-[0.7rem] sm:grid-cols-3">
                  <Figure label={c.leftLabel} cents={c.leftCents} />
                  <Figure label={c.rightLabel} cents={c.rightCents} />
                  <Figure label="Difference" cents={c.differenceCents} />
                </div>
                <p className={`mt-2 text-[0.7rem] ${TEXT[c.tone]}`}>{c.meaning}</p>
                {c.toleranceCents > 0 && (
                  <p className="mt-1 text-[0.65rem] text-[var(--admin-text-muted)]">
                    Agreement is allowed within {money(c.toleranceCents)}, because rounding each
                    employee separately and then totalling cannot always land on the same cent as
                    totalling first.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** One labelled block of the lesson. */
function Lesson({
  label,
  tone,
  children,
}: {
  readonly label: string;
  readonly tone: ScreenTone;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL[tone]}`}>
      <div className={`text-[0.65rem] font-semibold uppercase tracking-wide ${TEXT[tone]}`}>
        {label}
      </div>
      <p className="mt-1 text-[0.72rem] leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * One figure in a reconciliation.
 *
 * A null prints as "not supplied" and NEVER as $0.00. Treating a missing
 * figure as zero would report a difference of the entire amount and scream
 * about a catastrophe that has not happened.
 */
function Figure({ label, cents }: { readonly label: string; readonly cents: number | null }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[0.6rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs">
        {cents === null ? (
          <span className="text-[var(--admin-orange)]">not supplied</span>
        ) : (
          money(cents)
        )}
      </div>
    </div>
  );
}
