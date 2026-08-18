/**
 * src/app/admin/books/journal/JournalExplainer.tsx   (slice books-07)
 *
 * THE MENTOR THAT SITS BESIDE THE GENERAL JOURNAL.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "I have always needed a mentor, a cpa or cfo to shadow, I want our platform
 *    to be that mentor."
 *   "I learn best visually."
 *   "I want verbatim text with regard to policy regulation tax GAAP, all that
 *    plus more."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE NEEDED IT MOST
 * ---------------------------------------------------------------------------
 * Every other way money enters these books is drafted by a machine from a
 * document that already exists: a POS sale, a vendor bill, a payroll run, a
 * bank line. The general journal is the ONLY door where a human types a number
 * into the ledger from nothing but their own understanding of what happened.
 *
 * That makes it simultaneously the most necessary screen and the most
 * dangerous one. Every single failure in the owner's historical corpus came
 * through a door like this one: the $4,624,697.31 inventory plug, the backwards
 * card signs, the negative ATM cash, the debit-A/P-credit-revenue entry. Not
 * one of them was a machine's mistake. They were all somebody, in a hurry,
 * making a page agree.
 *
 * So this screen does not merely warn. It TEACHES THE SEQUENCE, in the order a
 * CPA actually works, because the errors above are not arithmetic failures --
 * they are failures of order. Whoever wrote the plug knew how to add. What they
 * did was start from the answer instead of starting from the document.
 *
 * ---------------------------------------------------------------------------
 * THE ARCHITECTURAL RULE THIS FILE OBEYS
 * ---------------------------------------------------------------------------
 * Every word of substance here is DATA imported from books-guidance-core.ts.
 * This component chooses layout and nothing else. No step, no quotation, no
 * threshold and no legal claim is typed into this file, for the reason stated
 * in Section280EExplainer:
 *
 *   "a diagram that drifts from the engine is worse than no diagram: it teaches
 *    the wrong thing with confidence."
 *
 * If the sequence in the core changes, this screen changes with it. It cannot
 * fall out of step, because there is nothing here to fall out of step WITH.
 *
 * ---------------------------------------------------------------------------
 * THE FINGERPRINT SCREEN ADVISES. IT NEVER BLOCKS.
 * ---------------------------------------------------------------------------
 * The AS 2401.61 screen below runs live on what is being typed, and it is
 * deliberately powerless. The three hard blocks (unbalanced, before the line in
 * the sand, and the §280E traps) stay where they are, in journal-advisor-core,
 * enforced again in the database. What runs here is a mirror of the questions
 * an examiner asks of a manual entry -- shown while the entry can still be
 * explained in one sentence, instead of years later when it cannot.
 *
 * It is phrased as observation and question, never as accusation. A round
 * number is not wrong. A month-end date is not wrong. Accruals BELONG at month
 * end. What is expensive is a round month-end entry with an empty memo, and the
 * cure costs ten seconds today.
 */

"use client";

import { useMemo, useState } from "react";

import {
  JOURNAL_MENTOR_STEPS,
  FINGERPRINT_CLAUSES_NOT_IMPLEMENTED,
  SELDOM_USED_THRESHOLD,
  THIN_MEMO_CHARS,
  screenForFingerprints,
  type Fingerprint,
  type FingerprintInput,
} from "@/lib/accounting/books-guidance-core";
import {
  AuthorityPanel,
  InlineAuthority,
} from "@/components/admin/books/AuthorityPanel";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

/** Every authority the journal sequence relies on, derived from the steps. */
const JOURNAL_AUTHORITY_IDS: readonly string[] = Array.from(
  new Set(JOURNAL_MENTOR_STEPS.flatMap((s) => s.authorityIds)),
);

// ===========================================================================
// THE LIVE SCREEN
// ===========================================================================

/**
 * Runs the AS 2401.61 screen against the entry as it is being typed.
 *
 * Rendered by JournalEntryForm, which owns the state. It is a separate
 * component so that the form keeps one job (capturing the entry) and this keeps
 * the other (explaining it).
 *
 * `priorManualUseByAccount` MUST come from real history. If it is not supplied
 * the seldom-used check is suppressed entirely rather than fired blindly --
 * with an empty map every account looks unfamiliar, and a warning that appears
 * on every entry is worse than no warning at all. It teaches the reader to
 * click past warnings, which is the exact habit this whole screen exists to
 * prevent.
 */
export function FingerprintScreen({
  journalDate,
  memo,
  lines,
  priorManualUseByAccount,
}: {
  journalDate: string;
  memo: string;
  lines: readonly { accountCode: string; amountCents: number; description?: string | null }[];
  priorManualUseByAccount?: Readonly<Record<string, number>>;
}) {
  const fingerprints = useMemo<readonly Fingerprint[]>(() => {
    // Nothing to screen until there is something to screen. Showing "your memo
    // is too short" against a blank form is nagging, not mentoring.
    const usable = lines.filter((l) => l.accountCode !== "" && l.amountCents !== 0);
    if (usable.length === 0) return [];

    const input: FingerprintInput = {
      journalDate,
      memo,
      lines: usable,
      priorManualUseByAccount,
    };
    const all = screenForFingerprints(input);

    // Suppress the history-dependent check when there is no history to judge
    // against. See the note above: a false alarm on every entry is the failure
    // mode, not a missing warning.
    return priorManualUseByAccount === undefined
      ? all.filter((f) => f.code !== "FP_SELDOM_USED_ACCOUNT")
      : all;
  }, [journalDate, memo, lines, priorManualUseByAccount]);

  if (fingerprints.length === 0) return null;

  return (
    <section
      aria-live="polite"
      className="rounded-2xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.05] p-5"
    >
      <h2 className={H2}>
        Questions an examiner would ask about this entry
      </h2>
      <p className={`${MUTED} mt-1`}>
        None of these stop you posting, and none of them mean anything is wrong.
        They are the characteristics auditors are trained to look at on manual
        entries <InlineAuthority id="AS_2401_61_FINGERPRINTS" />. Answering them
        in the memo now costs a sentence. Answering them in three years costs a
        professional&apos;s hourly rate.
      </p>

      <ul className="mt-4 space-y-3">
        {fingerprints.map((f) => (
          <li
            key={f.code}
            className="rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-gold)]">
                AS 2401.61{f.clause}
              </span>
              {f.lines.length > 0 && (
                <span className="text-[11px] text-white/45">
                  {f.lines.length === 1
                    ? `line ${f.lines[0]}`
                    : `lines ${f.lines.join(", ")}`}
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] text-white/25">
                {f.code}
              </span>
            </div>

            <p className="text-sm text-white/85">{f.observation}</p>
            <p className="mt-2 text-sm font-medium text-white/75">{f.question}</p>
            <p className="mt-2 text-sm text-white/60">
              <span className="text-white/40">What to do: </span>
              {f.suggestion}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===========================================================================
// THE SEQUENCE
// ===========================================================================

/**
 * The seven steps, in order, with what each one costs when skipped.
 *
 * The order IS the teaching, so the numbers are rendered prominently and the
 * "if you skip this" is never hidden behind a click. Each consequence is a real
 * event from the owner's own history wherever one exists -- an abstract warning
 * teaches nobody anything.
 */
export function JournalSequence() {
  const [openStep, setOpenStep] = useState<number | null>(1);

  return (
    <section className={CARD}>
      <h2 className={H2}>How to write an entry, in the order a CPA does it</h2>
      <p className={`${MUTED} mt-1`}>
        Notice that choosing accounts comes <strong className="text-white/60">third</strong>,
        not first. Most people start by hunting for an account, which is how money
        ends up wherever the search box happened to land.
      </p>

      <ol className="mt-4 space-y-2">
        {JOURNAL_MENTOR_STEPS.map((s) => {
          const isOpen = openStep === s.step;
          return (
            <li key={s.step} className="rounded-xl border border-white/10 bg-black/20">
              <button
                type="button"
                onClick={() => setOpenStep(isOpen ? null : s.step)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)]/20 text-xs font-semibold text-[var(--admin-accent)]">
                  {s.step}
                </span>
                <span className="flex-1 text-sm text-white/85">{s.action}</span>
                <span className="mt-0.5 text-xs text-white/30">
                  {isOpen ? "\u2212" : "+"}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-white/10 px-4 pb-4 pt-3 pl-[3.25rem]">
                  <p className={P}>
                    <span className="text-white/40">Why here: </span>
                    {s.why}
                  </p>
                  <p className="text-sm leading-relaxed text-white/70">
                    <span className="text-[var(--admin-orange)]/80">
                      If you skip it:{" "}
                    </span>
                    {s.ifSkipped}
                  </p>
                  {s.authorityIds.length > 0 && (
                    <p className={MUTED}>
                      <span className="text-white/35">Where this comes from: </span>
                      {s.authorityIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && "; "}
                          <InlineAuthority id={id} />
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ===========================================================================
// WHAT THE SCREEN LOOKS AT, AND WHAT IT DELIBERATELY DOES NOT
// ===========================================================================

/**
 * Honesty about the gaps.
 *
 * Two of the five AS 2401.61 clauses cannot fire in this system, and saying so
 * out loud is the difference between a tool that is trusted and one that is
 * merely believed. A reader who thinks all five checks are running would draw a
 * conclusion from silence that the silence does not support.
 */
export function ScreenScope() {
  return (
    <section className={CARD}>
      <h2 className={H2}>What that screen checks, and what it can&apos;t</h2>
      <p className={`${P} mt-2`}>
        The screen looks at how familiar the accounts are to you (fewer than{" "}
        <strong className="text-white/75">{SELDOM_USED_THRESHOLD + 1}</strong> hand-written
        entries counts as unfamiliar), whether the date lands on a period end,
        whether the memo is long enough to be an explanation (under{" "}
        <strong className="text-white/75">{THIN_MEMO_CHARS}</strong> characters is a label,
        not an explanation), and whether the amounts are suspiciously tidy.
      </p>

      <p className={`${MUTED} mt-4`}>
        Two of the five things auditors look for cannot happen here at all. They
        are listed rather than quietly omitted, because a check you believe is
        running when it isn&apos;t is worse than one you know is missing:
      </p>
      <ul className="mt-2 space-y-2">
        {FINGERPRINT_CLAUSES_NOT_IMPLEMENTED.map((c) => (
          <li
            key={c.clause}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          >
            <p className="text-xs text-white/60">
              <span className="font-mono text-white/35">{c.clause}</span>{" "}
              <span className="italic text-white/50">&ldquo;{c.text}&rdquo;</span>
            </p>
            <p className="mt-1 text-xs text-white/45">{c.why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===========================================================================
// THE WHOLE EXPLAINER
// ===========================================================================

/** Everything the journal page shows below the form. */
export function JournalExplainer() {
  return (
    <div className="space-y-6">
      <JournalSequence />
      <ScreenScope />
      <AuthorityPanel
        ids={JOURNAL_AUTHORITY_IDS}
        title="The actual words, so you never have to take mine for it"
        intro={
          "Everything above is built on these. They are quoted exactly as written " +
          "so you can read the source yourself rather than trusting a summary of it."
        }
      />
    </div>
  );
}
