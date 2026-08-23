/**
 * src/lib/payroll/form-941-ui-core.ts   (books-40)
 *
 * EVERY DECISION THE 941 SCREEN MAKES, IN A FILE A TEST CAN REACH.
 *
 * WHY THIS FILE EXISTS. A `page.tsx` cannot be unit tested in this repository -
 * the vitest include is `tests/compliance/` and a server component reaches the
 * database - so any rule that lives in JSX is a rule nothing checks. The page
 * that goes with this file is markup and nothing else: which badge colour,
 * which sentence, whether the file button may be pressed and what the page
 * says when there is nothing to show all live here.
 *
 * NOTHING HERE READS THE CLOCK, THE DATABASE, OR THE FILESYSTEM. Every input
 * arrives as an argument. A function that calls `new Date()` answers a
 * different question every day and cannot be pinned by a test - and on a
 * screen whose entire subject is deadlines, "what day is it" is precisely the
 * input a test needs to control.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE DESIGN RULE ON THIS SCREEN
 * ───────────────────────────────────────────────────────────────────────────
 *
 * THERE IS EXACTLY ONE NEXT ACTION, AND IT IS THE LOUDEST THING ON THE PAGE.
 *
 * `nextAction()` collapses the whole state of the quarter into ONE sentence
 * and ONE destination, chosen by a strict priority order. Everything else is
 * still on screen underneath, but "what do I do right now" always has a single
 * answer.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE COLOURS, AND WHY THERE ARE ONLY FOUR
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   green   - the return is complete and it is not yet urgent.
 *   gold    - complete, but the deadline is close. Nothing is wrong.
 *   orange  - complete, and the deadline is very close or the return owes money.
 *   danger  - it cannot be filed, or the deadline has passed.
 *
 * Gold is the interesting one and it is the same choice the pay-run screen
 * made: a state that is CORRECT but wants attention has to be visually
 * distinct from a state that is WRONG, or Michael learns to treat both the
 * same way. There is no `--admin-warning` token in this codebase; gold and
 * orange are the two intermediate tones that exist.
 */

import {
  type Form941Refusal,
  type Form941Result,
  type Form941Return,
  ALL_FORM_941_REFUSAL_CODES,
} from "@/lib/payroll/form-941-core";
import { formatCents, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import { form941RefusalLessonFor } from "@/lib/payroll/form-941-mentor";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  HOW LONG IS LEFT
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941Tone = "green" | "gold" | "orange" | "danger" | "neutral";

/**
 * Whole days from `today` to `due`, both ISO dates. Negative means overdue.
 *
 * Computed in UTC from the date parts alone, never from a local `Date`, so
 * that the answer does not change with the server's timezone. A deadline
 * screen that says "3 days" in Seattle and "2 days" in UTC is a screen nobody
 * can trust at the only moment it matters.
 */
export function daysUntil(today: string, due: string): number {
  const parse = (iso: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`form-941 ui: "${iso}" is not an ISO date (YYYY-MM-DD).`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((parse(due) - parse(today)) / 86_400_000);
}

export type UrgencyBand = "overdue" | "due-now" | "due-soon" | "comfortable";

/**
 * Turn days-remaining into a band.
 *
 * THE BOUNDARIES ARE CHOSEN, NOT ARBITRARY. Seven days is one full week -
 * enough time to find a missing pay run and still file. Thirty days is roughly
 * the whole filing window, since the return is due one month after the quarter
 * ends; anything beyond that means the quarter has only just closed.
 */
export function urgencyBand(daysLeft: number): UrgencyBand {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "due-now";
  if (daysLeft <= 30) return "due-soon";
  return "comfortable";
}

export function urgencyTone(band: UrgencyBand): Form941Tone {
  switch (band) {
    case "overdue":
      return "danger";
    case "due-now":
      return "orange";
    case "due-soon":
      return "gold";
    case "comfortable":
      return "green";
  }
}

/**
 * The deadline in words, including the number of days, phrased so the urgent
 * cases cannot be misread as reassurance.
 */
export function urgencyMeaning(band: UrgencyBand, daysLeft: number, due: string): string {
  const d = Math.abs(daysLeft);
  const dayWord = d === 1 ? "day" : "days";
  switch (band) {
    case "overdue":
      return (
        `This return was due ${due} - ${d} ${dayWord} ago. Late filing is charged at 5% of the ` +
        `tax per month under IRC 6651, so file it today even if the payment has to follow.`
      );
    case "due-now":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. This is the week to file it.`
      );
    case "due-soon":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. Nothing is wrong - this is simply the ` +
        `reminder that the window is open.`
      );
    case "comfortable":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. There is no hurry; the return is here when ` +
        `you want it.`
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE STATE OF THE QUARTER
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941Status = "ready" | "attention" | "blocked";

export function statusOf(result: Form941Result): Form941Status {
  if (!result.ok) return "blocked";
  if (result.balanceDueCents !== null && result.balanceDueCents > 0) return "attention";
  return "ready";
}

export function statusTone(status: Form941Status): Form941Tone {
  switch (status) {
    case "ready":
      return "green";
    case "attention":
      return "gold";
    case "blocked":
      return "danger";
  }
}

export function statusLabel(status: Form941Status): string {
  switch (status) {
    case "ready":
      return "Ready to file";
    case "attention":
      return "Ready to file - money owed";
    case "blocked":
      return "Cannot be filed yet";
  }
}

/**
 * What the status MEANS, in a sentence.
 *
 * The `attention` sentence must open by saying the return is correct. Gold on
 * a payroll screen has to be unmistakably different from red, and the fastest
 * way to make that true is to say so in the first six words - the same choice
 * the pay-run screen made, for the same reason.
 */
export function statusMeaning(status: Form941Status): string {
  switch (status) {
    case "ready":
      return (
        "The return is complete and it foots. Read line 1, line 2 and line 12 out loud, then sign " +
        "and file it."
      );
    case "attention":
      return (
        "The return is correct and it is ready to file - there is simply money still owed on it. " +
        "The deposits made during the quarter came to less than the quarter's tax, so a payment " +
        "goes with the return."
      );
    case "blocked":
      return (
        "Something is missing, so no return has been produced. Nothing has been saved and nothing " +
        "has been filed - fix the items listed below and the return will build itself."
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE ONE NEXT ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NextAction = {
  /** The single sentence at the top of the page. */
  readonly headline: string;
  /** What to do, in the imperative. */
  readonly detail: string;
  /** Where to go, or null when the action is right here. */
  readonly href: string | null;
  readonly ctaLabel: string;
  readonly tone: Form941Tone;
};

/**
 * Collapse the whole screen into one instruction.
 *
 * PRIORITY ORDER, AND WHY IT IS THIS ORDER.
 *
 *   1. Refusals first, always. A return that cannot be built cannot be late in
 *      any useful sense - "file this" is not actionable advice when there is
 *      nothing to file.
 *   2. Then overdue, because the meter is running.
 *   3. Then money owed, because a payment needs arranging and that takes
 *      longer than filing does.
 *   4. Then the ordinary "file it" case.
 *
 * The order is deliberately NOT "most severe colour first". An overdue return
 * that also cannot be built should send Michael to the missing pay run, not to
 * a deadline he cannot meet until the pay run is found.
 */
export function nextAction(result: Form941Result, today: string): NextAction {
  if (!result.ok) {
    const first = result.refusals[0];
    const lesson = first ? form941RefusalLessonFor(first.code) : undefined;
    return {
      headline:
        result.refusals.length === 1
          ? "One thing is missing before this return can be built."
          : `${result.refusals.length} things are missing before this return can be built.`,
      detail: lesson ? lesson.howToFix : (first?.fix ?? "Review the items listed below."),
      href: null,
      ctaLabel: "See what is missing",
      tone: "danger",
    };
  }

  const daysLeft = daysUntil(today, result.due.ordinary);
  const band = urgencyBand(daysLeft);

  if (band === "overdue") {
    return {
      headline: `${result.quarterLabel} is overdue by ${Math.abs(daysLeft)} ${
        Math.abs(daysLeft) === 1 ? "day" : "days"
      }.`,
      detail:
        "File it today. The failure-to-file penalty is charged per month at 5% of the tax, and " +
        "it is charged on the return being late rather than on the money being late - so filing " +
        "now stops the larger of the two meters even if the payment follows separately.",
      href: null,
      ctaLabel: "Review and file",
      tone: "danger",
    };
  }

  if (result.balanceDueCents !== null && result.balanceDueCents > 0) {
    return {
      headline: `${result.quarterLabel} is ready, with ${formatCents(
        result.balanceDueCents,
      )} still owed.`,
      detail:
        `The return itself is correct. Arrange the payment of ${formatCents(
          result.balanceDueCents,
        )} and file by ${result.due.ordinary}. Check the deposit record first - a balance due on a ` +
        `quarter you believed was fully paid usually means a deposit was recorded against the ` +
        `wrong quarter rather than never made.`,
      href: null,
      ctaLabel: "Review and file",
      tone: band === "due-now" ? "orange" : "gold",
    };
  }

  if (result.balanceDueCents !== null && result.balanceDueCents < 0) {
    return {
      headline: `${result.quarterLabel} is ready, and was overpaid by ${formatCents(
        -result.balanceDueCents,
      )}.`,
      detail:
        "Decide on the form whether the overpayment is refunded or applied to the next quarter. " +
        "Applying it forward is usually simpler, because a refund has to be tracked until it " +
        "arrives.",
      href: null,
      ctaLabel: "Review and file",
      tone: "gold",
    };
  }

  return {
    headline: `${result.quarterLabel} is ready to file.`,
    detail: urgencyMeaning(band, daysLeft, result.due.ordinary),
    href: null,
    ctaLabel: "Review and file",
    tone: urgencyTone(band),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  MAY THE FILE BUTTON BE PRESSED?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FileButtonState = {
  readonly enabled: boolean;
  readonly label: string;
  /** Why it is disabled. Null when it is enabled. */
  readonly disabledReason: string | null;
  /**
   * The honest note that sits under the button whether or not it is enabled.
   *
   * THIS SYSTEM DOES NOT FILE ANYTHING. It prepares a return for a human being
   * to read, check, sign and submit. Saying so under the button is not
   * modesty - a button labelled "File" that does not file is the single most
   * dangerous control we could ship, because the failure mode is Michael
   * believing a return went in when it did not.
   */
  readonly honestyNote: string;
};

export function fileButtonState(result: Form941Result): FileButtonState {
  const note =
    "This produces the figures for the return. It does not transmit anything to the IRS - " +
    "nothing here files on your behalf, and nothing here is a filing agent. Take these figures " +
    "to your filing method, check them against the form, and sign it yourself.";

  if (!result.ok) {
    return {
      enabled: false,
      label: "Cannot produce this return yet",
      disabledReason:
        result.refusals.length === 1
          ? "One item below has to be resolved first."
          : `${result.refusals.length} items below have to be resolved first.`,
      honestyNote: note,
    };
  }

  return {
    enabled: true,
    label: "Show the return",
    disabledReason: null,
    honestyNote: note,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  RENDERING THE PIECES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RefusalCard = {
  readonly code: string;
  readonly headline: string;
  readonly whatHappened: string;
  readonly howToFix: string;
  readonly whyWeRefuse: string;
  readonly subjectId: string | null;
  readonly tone: Form941Tone;
};

/**
 * Turn a refusal into a card, using the mentor's lesson for the teaching and
 * the engine's refusal for the specifics.
 *
 * THE TWO ARE BOTH NEEDED. The lesson explains the CLASS of problem - what
 * this code means and why the system refuses rather than guessing. The refusal
 * names the PERSON and the amount. A card with only the lesson is a textbook;
 * a card with only the refusal is an error message.
 */
export function refusalCard(refusal: Form941Refusal): RefusalCard {
  const lesson = form941RefusalLessonFor(refusal.code);
  if (!lesson) {
    // Reachable only if a code is added to the engine without a lesson, which
    // `assertEveryForm941RefusalIsTaught` fails on. Degrading to the refusal's
    // own words is better than rendering an empty card.
    return {
      code: refusal.code,
      headline: refusal.what,
      whatHappened: refusal.what,
      howToFix: refusal.fix,
      whyWeRefuse:
        "This refusal has no lesson attached to it, which is itself a defect - please report it.",
      subjectId: refusal.subjectId,
      tone: "danger",
    };
  }
  return {
    code: refusal.code,
    headline: lesson.headline,
    // The engine's sentence, because it names the person and the figure.
    whatHappened: refusal.what,
    // The engine's fix is the specific one; the lesson's is the general one.
    howToFix: refusal.fix,
    whyWeRefuse: lesson.whyWeRefuse,
    subjectId: refusal.subjectId,
    tone: "danger",
  };
}

/** Group refusals by code so five people missing the same answer are one card. */
export function groupRefusals(
  refusals: readonly Form941Refusal[],
): readonly { readonly code: string; readonly items: readonly Form941Refusal[] }[] {
  const order: string[] = [];
  const byCode = new Map<string, Form941Refusal[]>();
  for (const r of refusals) {
    if (!byCode.has(r.code)) {
      byCode.set(r.code, []);
      order.push(r.code);
    }
    byCode.get(r.code)!.push(r);
  }
  return order.map((code) => ({ code, items: byCode.get(code)! }));
}

export type LineRow = {
  readonly line: string;
  readonly caption: string;
  /** Pre-formatted: dollars for money, a bare integer for line 1. */
  readonly display: string;
  readonly derivation: string;
  /** True for the lines a reader should look at hardest. */
  readonly emphasise: boolean;
  readonly tone: Form941Tone;
};

/**
 * The lines, formatted for display.
 *
 * LINES 1, 7 AND 12 ARE EMPHASISED. Not because they are the biggest, but
 * because they are the three a reader should not skim: line 1 is the only
 * figure that is not money and the only one matched against the W-2s, line 7
 * is the one place a wrong number looks normal, and line 12 is the answer.
 */
export function lineRows(ret: Form941Return): readonly LineRow[] {
  const emphasised = new Set(["1", "7", "12"]);
  return ret.lines.map((l) => ({
    line: l.line,
    caption: l.caption,
    display: l.isCount ? String(l.amountCents) : formatCents(l.amountCents),
    derivation: l.derivation,
    emphasise: emphasised.has(l.line),
    tone:
      l.line === "14"
        ? "orange"
        : l.line === "15"
          ? "gold"
          : l.line === "12"
            ? "green"
            : "neutral",
  }));
}

/**
 * The empty state.
 *
 * A blank screen is a bug report waiting to happen: the reader cannot tell
 * whether there is nothing to show or whether something failed. This says
 * which, and what to do about it.
 */
export function emptyStateFor(quarter: QuarterRef): { title: string; body: string } {
  return {
    title: `Nothing has been recorded for Q${quarter.quarter} ${quarter.year} yet.`,
    body:
      `No pay runs have been posted with a pay date inside this quarter. If that is right, this ` +
      `quarter still needs a return - 26 CFR 31.6011(a)-1(a)(1) requires one "whether or not ` +
      `wages are paid therein" - so use the zero-return option rather than leaving it unfiled. ` +
      `If it is not right, the pay runs are probably still in draft; check the pay-run list.`,
  };
}

/**
 * Every refusal code, paired with whether the mentor can explain it.
 *
 * Exists so a test can prove the screen never shows a code it cannot teach,
 * without the test hand-typing the code list (standing rule 43).
 */
export function refusalCoverage(): readonly { code: string; taught: boolean }[] {
  return ALL_FORM_941_REFUSAL_CODES.map((code) => ({
    code,
    taught: form941RefusalLessonFor(code) !== undefined,
  }));
}
