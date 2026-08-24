/**
 * src/lib/payroll/form-box-core.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FORM / WHY / CHECK MODEL — BUILT ONCE, INHERITED BY EVERY FORM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. Michael is a visual learner and told us the verbatim
 * authority panels are "hard to digest as there is a wall of words and colour".
 * He is right, and the diagnosis is precise: the old panels answered forty
 * questions at once, at a moment when he was asking one. This module inverts
 * that. He clicks a box; the box explains itself.
 *
 * His instruction for this slice, verbatim:
 *
 *   "I want to be able to see the form, and click a box to have it teach me all
 *   there is to know about that box. It should be thorough and verbatim and
 *   plain English explain actions. It should teach me how to read them and use
 *   them as a tool. Everything a cpa would know about these forms, I want to
 *   know to."
 *
 * And the clarification that set the scope:
 *
 *   "When I say take me to school, I meant while I'm in the system working. If
 *   I'm unsure about something, there should be a teaching lesson to help me
 *   through the process."
 *
 * That is the design brief for this file. Teaching AT THE POINT OF WORK, not
 * teaching filed away in a documents folder.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GENERIC LAYER AND NOT SIX GOOD SCREENS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The roadmap requires this be "built ONCE, generically, so every form inherits
 * it". That is not a tidiness preference, it is a defect-prevention measure. Six
 * hand-built teaching screens means six places for a rate to go stale, six
 * places a citation can rot, and — worst — six subtly different ideas of what
 * "this box is blank on purpose" looks like. The whole value of trap 2 (box 17
 * must be blank) is that a deliberate blank is VISUALLY DISTINCT from a
 * forgotten one. If that distinction is re-implemented per form it will diverge,
 * and the day it diverges is the day it stops being trustworthy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE ENGINES DISAGREE ABOUT WHAT A BOX IS, AND THAT IS FINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Measured, not assumed (probe run 2026-08-24):
 *
 *   Form941Line   = { line, caption, amountCents, isCount, derivation }
 *   W2Box         = { box, caption, amountCents, derivation }
 *   WaQuarterLine = { id, form, boxLabel, measure, amountCents, quantity,
 *                     whoseMoney, shownAs }
 *
 * Three shapes, three vocabularies, one screen. The resolution is a single
 * generic `FormBox` plus ONE ADAPTER PER ENGINE. The adapters are the only code
 * in the system that knows an engine's field names, so a rename in an engine
 * breaks one small function with a test on it rather than a page.
 *
 * NOTE WHAT IS *NOT* HERE. This module computes no money. It has no rates, no
 * arithmetic, no idea what a premium is. It is a presentation and teaching
 * model. Every figure arrives already computed and already justified by an
 * engine that has its own tests. Two answers to one question is the failure mode
 * this avoids (rule 63: one platform, one ledger).
 *
 * @see src/lib/payroll/form-box-lessons.ts   the per-box teaching content
 * @see src/lib/payroll/form-box-adapters.ts  engine -> FormBox translation
 */

import type { ScreenTone } from "@/lib/ui/screen-tone-core";

/* ═════════════════════════════════════════════════════════════════════════════
 * §1  THE THREE TABS
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * The three tabs, in the order they are worked.
 *
 * The order is the workflow, not alphabetical and not arbitrary:
 *
 *   FORM  — what does the paper say? (orientation)
 *   WHY   — why does it say that?    (understanding)
 *   CHECK — is it right?             (verification)
 *
 * A reader who works them in that order has done what a preparer does. A reader
 * who starts at CHECK is checking figures they have not read yet.
 */
export type FormTab = "form" | "why" | "check";

export const ALL_FORM_TABS: readonly FormTab[] = ["form", "why", "check"];

export function formTabLabel(tab: FormTab): string {
  switch (tab) {
    case "form":
      return "Form";
    case "why":
      return "Why";
    case "check":
      return "Check";
  }
}

/**
 * What each tab is FOR, in one sentence, shown under the tab strip.
 *
 * Written as a promise about what the reader will get, because a tab label alone
 * ("Why") does not tell a first-time user whether it holds law, opinion, or
 * arithmetic.
 */
export function formTabPurpose(tab: FormTab): string {
  switch (tab) {
    case "form":
      return "The form as it is actually printed. Click any box to learn what it means.";
    case "why":
      return "The law and the instructions behind the box you clicked — quoted word for word.";
    case "check":
      return "The cross-checks that catch a wrong figure before an agency does.";
  }
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §2  WHAT A BOX IS, ONCE, FOR EVERY FORM
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * What a box is measured in.
 *
 * Money is not the only unit on these returns and pretending otherwise produces
 * the worst kind of error - a plausible one. The L&I quarterly return charges on
 * HOURS, and Form 941 line 1 is a COUNT OF PEOPLE. Formatting either as dollars
 * yields "$3,558.00" where the form wants "3,558 hours", which is wrong in a way
 * that looks perfectly normal on screen.
 *
 * `WaQuarterLine` already solved this for the WA forms with its own `measure`
 * field, and the comment there is worth repeating: the alternative was a
 * sentinel (`amountCents: 0` meaning "not money"), and a sentinel is a bug
 * waiting for a caller who does not know the convention.
 */
export type BoxMeasure = "money" | "hours" | "count";

/**
 * Whose money a box represents. THE MOST IMPORTANT FIELD IN THIS FILE.
 *
 * ═══ THIS IS A LEGAL DISTINCTION, NOT A LABEL ═══
 *
 * Washington law treats these three categories as fundamentally different
 * relationships, and the penalties for confusing them are real:
 *
 *   employer_cost   Greenway's own money. For unemployment, RCW 50.24.010 and
 *                   RCW 50.24.014 make deducting it from a worker UNLAWFUL. For
 *                   workers' compensation, RCW 51.16.140(2) makes the attempt a
 *                   GROSS MISDEMEANOR - not a fine, a misdemeanour.
 *
 *   employee_money  Already withheld from staff. Greenway holds it AS THEIR
 *                   AGENT (RCW 50A.10.030(7)(b) says so for Paid Leave). It was
 *                   never Greenway's money. Spending it is not a cash-flow
 *                   decision, it is spending someone else's money.
 *
 *   shared          Both sides contribute and THE STATE SETS THE SPLIT. Michael
 *                   does not get to choose the ratio, and L&I is the sharpest
 *                   case: RCW 51.16.140(1) permits deducting one-half of the
 *                   MEDICAL AID portion only - not half the premium.
 *
 * A screen that shows six numbers without saying whose they are teaches nothing
 * about the one distinction that carries criminal exposure. So the colour of
 * every box on this system is driven by this field.
 */
export type WhoseMoney = "employer_cost" | "employee_money" | "shared" | "not_money";

/**
 * The plain-English name for a money category, for a caption or a legend.
 */
export function whoseMoneyLabel(whose: WhoseMoney): string {
  switch (whose) {
    case "employer_cost":
      return "Greenway's own cost";
    case "employee_money":
      return "Your employees' money, held in trust";
    case "shared":
      return "Shared — the State sets the split";
    case "not_money":
      return "Not money";
  }
}

/**
 * The one-sentence consequence of getting this category wrong.
 *
 * Deliberately phrased as a consequence rather than a definition. "Employer
 * cost" is a definition and forgettable; "deducting this from your staff is a
 * gross misdemeanour" is a consequence and it sticks.
 */
export function whoseMoneyConsequence(whose: WhoseMoney): string {
  switch (whose) {
    case "employer_cost":
      return (
        "You pay this. You may not take it out of anyone's cheque. For unemployment that is " +
        "RCW 50.24.010; for workers' compensation, RCW 51.16.140(2) makes the attempt a gross " +
        "misdemeanour."
      );
    case "employee_money":
      return (
        "This was already taken out of your employees' pay. It is theirs and you are holding it " +
        "as their agent — RCW 50A.10.030(7)(b) uses that word for Paid Leave. If it is short at " +
        "filing time, the shortfall came out of somebody's wages."
      );
    case "shared":
      return (
        "Both sides pay, and the State decides the split — you do not. For L&I, RCW 51.16.140(1) " +
        "lets you deduct one-half of the MEDICAL AID portion only. Half the whole premium is not " +
        "the same number, and taking it is unlawful."
      );
    case "not_money":
      return "This box is a count, not an amount. Nothing is owed on the strength of this box alone.";
  }
}

/**
 * A box's colour, and this is the one visual convention the whole system shares.
 *
 * ═══ WHY THE COLOUR FOLLOWS *WHOSE MONEY*, NOT SIZE OR STATUS ═══
 *
 * The obvious choice is to colour by magnitude, or red for problems. Both are
 * worse. Magnitude teaches Michael to look at big numbers, and the expensive
 * mistakes on these forms are not the big numbers - box 17 holding $43 of Paid
 * Leave is a tiny figure and a real problem. Red-for-problems means the screen
 * is grey on every ordinary day, so the colour carries no information until the
 * day something is wrong, which is the day nobody has practice reading it.
 *
 * Colouring by WHOSE MONEY means the palette teaches the legal distinction every
 * single time the screen is opened. After a month Michael should be able to
 * glance at a form and see, without reading a caption, which figures are his own
 * cost and which are his employees' money that he is merely holding.
 */
export function whoseMoneyTone(whose: WhoseMoney): ScreenTone {
  switch (whose) {
    case "employer_cost":
      // Gold: your money is leaving. Not an error - a cost. Worth feeling.
      return "gold";
    case "employee_money":
      // Green: correctly held in trust. Green because the STATE of the money is
      // right, not because the amount is pleasant.
      return "green";
    case "shared":
      // Orange: the split is the trap. Orange says "check the ratio", which is
      // exactly the question RCW 51.16.140(1) turns on.
      return "orange";
    case "not_money":
      return "neutral";
  }
}

/**
 * ONE BOX, ON ANY FORM, READY TO RENDER AND READY TO TEACH.
 *
 * Every field here is either copied from an engine or derived by an adapter. No
 * field is computed in this module and none is optional-by-accident: where a
 * field can be absent it is `| null` and the null MEANS something, stated in the
 * field's own comment. Rule 62d - never invent a default.
 */
export type FormBox = {
  /**
   * Which form this box belongs to. Stable, machine-readable.
   * e.g. "form_941", "form_940", "form_w2", "esd_5208a", "lni_quarterly".
   */
  readonly formId: string;
  /** The box or line number AS PRINTED ON THE PAPER. "1", "5a", "12a", "17". */
  readonly box: string;
  /** The caption as the form itself prints it. Not our words - theirs. */
  readonly caption: string;
  readonly measure: BoxMeasure;
  /** Integer cents. Always 0 when `measure` is not "money" - read `quantity`. */
  readonly amountCents: number;
  /**
   * The count, when `measure` is "hours" or "count". Null for money boxes.
   *
   * Hours are carried in integer HUNDREDTHS to match the timesheet engine, so
   * 480 hours arrives as 48000. The formatter below is the only place that
   * knows.
   */
  readonly quantity: number | null;
  readonly whose: WhoseMoney;
  /** The arithmetic, in English, with the real numbers substituted in. */
  readonly derivation: string;
  /**
   * Set ONLY when a box is correctly empty, and it carries the REASON.
   *
   * ═══ THIS FIELD IS THE POINT OF THE WHOLE SCREEN ═══
   *
   * A box that is SUPPOSED to be blank looks identical to a box somebody
   * forgot. Box 17 on Michael's W-2 must be blank because Washington levies no
   * personal income tax; a preparer who "helpfully" fills it in tells the IRS
   * his employees paid a tax that does not exist. Grey plus a reason - never
   * red, and never silent.
   */
  readonly blankOnPurpose: string | null;
  /** True for boxes a reader must not skim (the ones other forms are compared against). */
  readonly emphasise: boolean;
};

/**
 * The ONE correct way to render a box's value, whatever it is measured in.
 *
 * Provided so no caller has to remember the rule. A screen that calls this
 * cannot print "$0.00" beside a box that really says "3,558 hours" - which is
 * precisely the defect the `measure` field exists to prevent, and which would
 * otherwise reappear in every new screen.
 */
export function formatBoxValue(box: FormBox): string {
  if (box.measure === "hours") {
    const hundredths = box.quantity ?? 0;
    const hours = hundredths / 100;
    return `${hours.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} hours`;
  }
  if (box.measure === "count") {
    const n = box.quantity ?? 0;
    return n.toLocaleString("en-US");
  }
  const sign = box.amountCents < 0 ? "-" : "";
  const abs = Math.abs(box.amountCents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Is this box empty? Answered once, so no caller invents its own rule.
 *
 * Deliberately NOT `amountCents === 0` for every case. A money box is empty at
 * zero cents; an hours box is empty at zero hours; and a count box showing zero
 * employees is a real, meaningful zero on a return that still has to be filed.
 */
export function boxIsEmpty(box: FormBox): boolean {
  if (box.measure === "money") return box.amountCents === 0;
  return (box.quantity ?? 0) === 0;
}

/**
 * The tone to paint a box.
 *
 * ORDER OF PRECEDENCE MATTERS AND IS TESTED. A box that is blank on purpose is
 * NEUTRAL regardless of whose money it would have been, because the teaching
 * point is "this emptiness is correct" and painting it gold would say "your
 * money left" about a box where no money moved.
 */
export function boxTone(box: FormBox): ScreenTone {
  if (box.blankOnPurpose !== null) return "neutral";
  return whoseMoneyTone(box.whose);
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §3  THE LESSON — "EVERYTHING A CPA WOULD KNOW ABOUT THIS BOX"
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * A worked example: real numbers, one step at a time, ending in the answer.
 *
 * Michael asked for "colors and worked examples and such". An example is the
 * difference between being told a rule and being able to apply it, and the
 * SUBSTITUTED numbers are what make it usable - "0.58% of wages" is a rule,
 * "$10,000.00 x 0.58% = $58.00" is a thing you can check against your own
 * cheque stub.
 */
export type BoxExample = {
  readonly title: string;
  /** Each step in order. Arithmetic shown, never just asserted. */
  readonly steps: readonly string[];
  /** The answer, formatted as it would appear in the box. */
  readonly answer: string;
  /** What the example proves. The reason it was worth reading. */
  readonly moral: string;
};

/**
 * A quotation from a real, mirrored authority.
 *
 * Rule 24: verbatim authority or no feature. Rule 35: verbatim must be
 * MECHANICALLY VERIFIED, not carefully typed - which is why `quote` and
 * `sourcePath` travel together and a gate reads the file to confirm the quote is
 * really in it. A citation nobody can check is decoration.
 */
export type BoxQuote = {
  /** How the authority is cited. "IRS Instructions for Form 941 (2026), Line 5a". */
  readonly cite: string;
  /** The words, EXACTLY as the source has them. Never paraphrased, never tidied. */
  readonly quote: string;
  /** Path to the mirrored copy in this repo, so a gate can verify the quote. */
  readonly sourcePath: string;
  /** Where Michael reads the real thing. Must be a URL a browser can open. */
  readonly sourceUrl: string;
  /** What it MEANS for Greenway. The translation from law into action. */
  readonly soWhat: string;
};

/**
 * EVERYTHING ABOUT ONE BOX.
 *
 * The field order is the teaching order, and it is deliberate. `plainEnglish`
 * comes FIRST and `quotes` come late, because the wall-of-words problem Michael
 * described is what happens when the statute arrives before the explanation. Say
 * what it means, then show the words that prove it.
 */
export type BoxLesson = {
  readonly formId: string;
  readonly box: string;
  /** A title a beginner would recognise. Not the statutory caption. */
  readonly headline: string;
  /** WHAT THIS BOX IS, in language that assumes nothing. 2-5 sentences. */
  readonly plainEnglish: string;
  /** Where the figure comes from - which records, which engine, which period. */
  readonly whereItComesFrom: string;
  /** HOW TO READ IT AS A TOOL: what a high or low number is telling Michael. */
  readonly howToReadIt: string;
  /**
   * The mistake actually made on this box, and how to see it.
   *
   * Null ONLY when there is no characteristic error - which is rare and must be
   * justified in the lesson's own comment. A box with no known failure mode is
   * usually a box nobody has thought hard enough about yet.
   */
  readonly commonMistake: string | null;
  /** What Michael should DO. Imperative. Never "consider" or "may wish to". */
  readonly whatToDo: string;
  readonly examples: readonly BoxExample[];
  readonly quotes: readonly BoxQuote[];
  /**
   * Boxes on OTHER forms that must agree with this one, and why.
   *
   * This is the field that turns a stack of forms into a system. Box 3 of the
   * W-2 is not merely similar to line 5a of the 941 - it is the same money
   * counted twice, and if they disagree one of them is wrong. A preparer who
   * knows the links can find an error in minutes; one who does not waits for a
   * notice.
   */
  readonly tiesTo: readonly { readonly formId: string; readonly box: string; readonly why: string }[];
};

/**
 * The lesson for one box, or undefined.
 *
 * Returns undefined rather than a stand-in lesson. A cheerful "no guidance
 * available" panel is worse than nothing: it looks like teaching, so the reader
 * stops looking for the real answer (rule 50 - dead code wearing a green check).
 * The gate in tests asserts every RENDERED box has a lesson, so undefined here
 * is a build-time problem, not a runtime experience.
 */
export function lessonFor(
  lessons: readonly BoxLesson[],
  formId: string,
  box: string,
): BoxLesson | undefined {
  return lessons.find((l) => l.formId === formId && l.box === box);
}

/** Every lesson for one form, in the order the form prints its boxes. */
export function lessonsForForm(
  lessons: readonly BoxLesson[],
  formId: string,
): readonly BoxLesson[] {
  return lessons.filter((l) => l.formId === formId);
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §4  THE MONEY SPLIT — ONE PICTURE THAT ANSWERS "WHOSE IS IT?"
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * How a form's total divides between Greenway's money and the employees'.
 *
 * Michael said visualising data is very important to him. This is the figure
 * behind the bar at the top of every payroll form: of everything this return
 * sends to the State, how much was Greenway's own cost and how much was money
 * already taken out of staff pay.
 *
 * It answers a question Michael asked in a different form months ago - "where
 * did the money go" - and it answers it in the only way that is legally
 * meaningful, by ownership rather than by agency or by size.
 */
export type MoneySplit = {
  readonly employerCents: number;
  readonly employeeCents: number;
  readonly totalCents: number;
  /** Employer share as milli-percent of the total. Null when the total is zero. */
  readonly employerMilliPct: number | null;
  /** Employee share as milli-percent of the total. Null when the total is zero. */
  readonly employeeMilliPct: number | null;
};

/**
 * Split a set of boxes into employer money and employee money.
 *
 * ═══ WHY "shared" IS NOT COUNTED HERE, AND WHY THAT IS NOT A GAP ═══
 *
 * A `shared` box is nearly always a TOTAL of two boxes that are themselves
 * already classified - the L&I return prints the employee share, the employer
 * share, and then the combined amount owed. Adding the combined line to the two
 * halves would double-count the whole return, so the split reads only the boxes
 * whose ownership is unambiguous.
 *
 * That means a caller must pass the COMPONENT boxes, not the totals. This is
 * exactly the kind of convention that gets violated silently, so
 * `assertSplitIgnoresTotals` below proves it, and the percentages return NULL on
 * a zero total rather than 0 - because "nothing was owed" and "none of it was
 * yours" are different statements and a zero would blur them.
 */
export function splitMoney(boxes: readonly FormBox[]): MoneySplit {
  let employerCents = 0;
  let employeeCents = 0;
  for (const b of boxes) {
    if (b.measure !== "money") continue;
    if (b.whose === "employer_cost") employerCents += b.amountCents;
    else if (b.whose === "employee_money") employeeCents += b.amountCents;
  }
  const totalCents = employerCents + employeeCents;
  return {
    employerCents,
    employeeCents,
    totalCents,
    employerMilliPct: totalCents === 0 ? null : Math.round((employerCents * 100_000) / totalCents),
    employeeMilliPct: totalCents === 0 ? null : Math.round((employeeCents * 100_000) / totalCents),
  };
}

/** A milli-percent as a human string. 71_430 -> "71.43%". */
export function formatMilliPct(milliPct: number): string {
  return `${(milliPct / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * The sentence under the split bar.
 *
 * Says the thing that matters rather than restating the percentages the bar
 * already shows: that the employee portion was never Greenway's money.
 */
export function splitMeaning(split: MoneySplit): string {
  if (split.totalCents === 0) {
    return "Nothing is owed on this return. That is not the same as the return not being due — an empty return still has to be filed.";
  }
  if (split.employeeCents === 0) {
    return "Every dollar on this return is Greenway's own cost. None of it came out of anyone's pay cheque.";
  }
  if (split.employerCents === 0) {
    return (
      "Every dollar on this return was already withheld from your employees. It was never your money — " +
      "you are holding it as their agent and passing it on."
    );
  }
  return (
    `Of the ${formatCents(split.totalCents)} this return sends to the State, ` +
    `${formatCents(split.employerCents)} is Greenway's own cost and ` +
    `${formatCents(split.employeeCents)} was already withheld from your employees' pay. ` +
    "That second figure was never your money."
  );
}

/** Cents to dollars, for prose. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §5  SELF-TESTS (rule 5: PURE core + __run…Tests)
 * ═════════════════════════════════════════════════════════════════════════════ */

function box(over: Partial<FormBox>): FormBox {
  return {
    formId: "test_form",
    box: "1",
    caption: "Test box",
    measure: "money",
    amountCents: 0,
    quantity: null,
    whose: "employer_cost",
    derivation: "test",
    blankOnPurpose: null,
    emphasise: false,
    ...over,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`form-box-core self-test: ${msg}`);
}

/**
 * An hours box must never be formatted as money.
 *
 * This is the sentinel defect the `measure` field exists to prevent, so it is
 * the first thing tested.
 */
export function assertHoursNeverFormatAsMoney(): void {
  const hours = box({ measure: "hours", amountCents: 0, quantity: 355_800 });
  const out = formatBoxValue(hours);
  assert(!out.includes("$"), `hours box formatted with a dollar sign: ${out}`);
  assert(out === "3,558.00 hours", `expected "3,558.00 hours", got "${out}"`);

  const count = box({ measure: "count", amountCents: 0, quantity: 12 });
  const countOut = formatBoxValue(count);
  assert(!countOut.includes("$"), `count box formatted with a dollar sign: ${countOut}`);
  assert(countOut === "12", `expected "12", got "${countOut}"`);
}

/** Money must round-trip through the formatter exactly, including negatives. */
export function assertMoneyFormatsExactly(): void {
  assert(formatBoxValue(box({ amountCents: 1_143_900 })) === "$11,439.00", "11,439.00");
  assert(formatBoxValue(box({ amountCents: 5_800 })) === "$58.00", "58.00");
  assert(formatBoxValue(box({ amountCents: 0 })) === "$0.00", "0.00");
  assert(formatBoxValue(box({ amountCents: -2_500 })) === "-$25.00", "negative");
  assert(formatBoxValue(box({ amountCents: 1 })) === "$0.01", "one cent");
}

/**
 * A blank-on-purpose box is neutral even when its money category is not.
 *
 * The precedence in `boxTone` is the whole of trap 2. If whoseMoney won, box 17
 * would be painted gold and would look like money that left.
 */
export function assertBlankOnPurposeBeatsWhoseMoney(): void {
  const deliberate = box({
    whose: "employee_money",
    blankOnPurpose: "Washington has no personal income tax.",
  });
  assert(boxTone(deliberate) === "neutral", "blank-on-purpose must be neutral");

  const ordinary = box({ whose: "employee_money", blankOnPurpose: null });
  assert(boxTone(ordinary) === "green", "employee money must be green when not blank");
}

/** Emptiness is measure-aware, not a bare zero check. */
export function assertEmptinessIsMeasureAware(): void {
  assert(boxIsEmpty(box({ measure: "money", amountCents: 0 })), "zero money is empty");
  assert(!boxIsEmpty(box({ measure: "money", amountCents: 1 })), "one cent is not empty");
  assert(
    boxIsEmpty(box({ measure: "hours", amountCents: 0, quantity: 0 })),
    "zero hours is empty",
  );
  assert(
    !boxIsEmpty(box({ measure: "hours", amountCents: 0, quantity: 100 })),
    "one hour is not empty",
  );
  // A money box with a stray quantity must still be judged on its cents.
  assert(
    boxIsEmpty(box({ measure: "money", amountCents: 0, quantity: 999 })),
    "money box judged on cents, not quantity",
  );
}

/**
 * The split must ignore `shared` totals, or every return double-counts.
 *
 * Modelled on the real L&I shape: an employee share, an employer share, and a
 * combined "amount owed" line that is the sum of the two.
 */
export function assertSplitIgnoresTotals(): void {
  const lni = [
    box({ box: "hours", measure: "hours", quantity: 355_800, whose: "shared" }),
    box({ box: "employee", amountCents: 58_511, whose: "employee_money" }),
    box({ box: "employer", amountCents: 140_467, whose: "employer_cost" }),
    box({ box: "total", amountCents: 198_978, whose: "shared" }),
  ];
  const split = splitMoney(lni);
  assert(split.employeeCents === 58_511, `employee ${split.employeeCents}`);
  assert(split.employerCents === 140_467, `employer ${split.employerCents}`);
  assert(
    split.totalCents === 198_978,
    `total ${split.totalCents} must equal the form's own total line`,
  );
  // And the percentages must add to 100.00% within rounding.
  const sum = (split.employerMilliPct ?? 0) + (split.employeeMilliPct ?? 0);
  assert(Math.abs(sum - 100_000) <= 1, `percentages sum to ${sum}, not 100000`);
}

/**
 * A zero total yields NULL percentages, never zero.
 *
 * "Nothing was owed" and "none of it was yours" are different facts. A zero
 * would let a screen print "0% was your money" on a return where no money moved
 * at all.
 */
export function assertZeroTotalGivesNullPercentages(): void {
  const split = splitMoney([box({ amountCents: 0, whose: "employer_cost" })]);
  assert(split.totalCents === 0, "total must be zero");
  assert(split.employerMilliPct === null, "employer pct must be null, not 0");
  assert(split.employeeMilliPct === null, "employee pct must be null, not 0");
  assert(
    splitMeaning(split).includes("still has to be filed"),
    "a nil return must still say it must be filed",
  );
}

/** Every money category must have a label, a consequence and a tone. */
export function assertEveryCategoryIsExplained(): void {
  const all: readonly WhoseMoney[] = ["employer_cost", "employee_money", "shared", "not_money"];
  for (const w of all) {
    assert(whoseMoneyLabel(w).length > 3, `no label for ${w}`);
    assert(whoseMoneyConsequence(w).length > 40, `no real consequence for ${w}`);
    whoseMoneyTone(w);
  }
  // The three that carry legal exposure must cite the statute that creates it.
  assert(
    whoseMoneyConsequence("employer_cost").includes("RCW 50.24.010"),
    "employer cost must cite RCW 50.24.010",
  );
  assert(
    whoseMoneyConsequence("employer_cost").includes("gross misdemeanour"),
    "employer cost must name the criminal exposure",
  );
  assert(
    whoseMoneyConsequence("employee_money").includes("RCW 50A.10.030(7)(b)"),
    "employee money must cite the agency provision",
  );
  assert(
    whoseMoneyConsequence("shared").includes("RCW 51.16.140(1)"),
    "shared must cite the one-half medical aid rule",
  );
}

/** Every tab must have a label and a stated purpose. */
export function assertEveryTabIsExplained(): void {
  assert(ALL_FORM_TABS.length === 3, "there are three tabs");
  for (const t of ALL_FORM_TABS) {
    assert(formTabLabel(t).length > 2, `no label for ${t}`);
    assert(formTabPurpose(t).length > 30, `no purpose for ${t}`);
  }
  // The order IS the workflow. Form before Why before Check.
  assert(ALL_FORM_TABS[0] === "form", "Form must be first");
  assert(ALL_FORM_TABS[1] === "why", "Why must be second");
  assert(ALL_FORM_TABS[2] === "check", "Check must be third");
}

/** Lesson lookup must not confuse two forms that share a box number. */
export function assertLessonLookupIsFormScoped(): void {
  const stub = (formId: string, boxNo: string): BoxLesson => ({
    formId,
    box: boxNo,
    headline: `${formId} ${boxNo}`,
    plainEnglish: "x",
    whereItComesFrom: "x",
    howToReadIt: "x",
    commonMistake: null,
    whatToDo: "x",
    examples: [],
    quotes: [],
    tiesTo: [],
  });
  const lessons = [stub("form_941", "1"), stub("form_w2", "1"), stub("form_941", "5a")];

  const a = lessonFor(lessons, "form_941", "1");
  const b = lessonFor(lessons, "form_w2", "1");
  assert(a?.headline === "form_941 1", "941 box 1 lesson");
  assert(b?.headline === "form_w2 1", "W-2 box 1 lesson");
  assert(a !== b, "two forms sharing a box number must not collide");
  assert(lessonFor(lessons, "form_940", "1") === undefined, "absent lesson must be undefined");
  assert(lessonsForForm(lessons, "form_941").length === 2, "two 941 lessons");
}

export function __runFormBoxCoreTests(): void {
  assertHoursNeverFormatAsMoney();
  assertMoneyFormatsExactly();
  assertBlankOnPurposeBeatsWhoseMoney();
  assertEmptinessIsMeasureAware();
  assertSplitIgnoresTotals();
  assertZeroTotalGivesNullPercentages();
  assertEveryCategoryIsExplained();
  assertEveryTabIsExplained();
  assertLessonLookupIsFormScoped();
}
