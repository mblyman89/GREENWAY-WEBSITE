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
export type WhoseMoney =
  | "employer_cost"
  | "employee_money"
  | "shared"
  | "tax_base"
  | "not_money";

/**
 * Every category, as DATA.
 *
 * Exported so a coverage test can walk the whole vocabulary instead of keeping
 * its own hand-typed copy of it. A test that lists the members itself passes
 * happily on the day a sixth category is added and never mentions it again -
 * standing rule 43, and the reason this constant exists rather than a comment
 * asking people to remember.
 */
export const ALL_WHOSE_MONEY: readonly WhoseMoney[] = [
  "employer_cost",
  "employee_money",
  "shared",
  "tax_base",
  "not_money",
];

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
    case "tax_base":
      return "What the tax is charged on, not the tax";
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
    case "tax_base":
      return (
        "Nobody owes this figure. It is the WAGES the tax is charged on, and it is here so the " +
        "tax below it can be checked. Reading a wage base as an amount due is the single most " +
        "common way to misread one of these returns \u2014 it makes the form look many times more " +
        "expensive than it is."
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
    case "tax_base":
      // Neutral, deliberately, and this is the most important colour decision on
      // the screen. A wage base is the BIGGEST number on Form 941 - line 2 dwarfs
      // every tax line beneath it. If it were coloured, the eye would go to it
      // first and Michael would spend his attention on the one figure nobody owes.
      // Neutral makes the big number recede so the taxes stand out, which is the
      // opposite of what colouring-by-magnitude would have done.
      return "neutral";
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
  /**
   * The box's contents WHEN THEY ARE WORDS RATHER THAN AN AMOUNT.
   *
   * ═══ WHY THIS EXISTS (books-68, defect D-21) ═══
   *
   * `BoxMeasure` is money | hours | count, and every one of those formats a
   * NUMBER. That was sufficient while every rendered form was a tax return,
   * where the identity fields (EIN, legal name, address) are printed by a
   * separate facsimile layer and the boxes carry only figures.
   *
   * The DSHS 18-463 new-hire report broke that assumption completely: not one
   * of its twelve boxes is an amount. They are names, a street address, a
   * social security number and two dates. Modelled as `count` — the only
   * non-money option — `formatBoxValue` printed `quantity ?? 0`, so the whole
   * form rendered as twelve zeroes. Every test passed; the screenshot caught it.
   *
   * The first fix was to flag those boxes `notComputedYet`, following the
   * pattern `employerEntityBoxes` uses for the 941's identity fields. That
   * removed the false zeroes but replaced them with a different false
   * statement: a fully populated report reading "not computed yet" in every
   * box, when the values were sitting right there.
   *
   * ═══ WHY A FIELD AND NOT A FOURTH `BoxMeasure` ═══
   *
   * A `"text"` member would widen a union that 47 sites read, and would make
   * every exhaustive check over it incomplete until each was revisited — a
   * change to every form in the system for one form's benefit. Michael: "We
   * need to find a fair balance between having perfect code verse acceptable
   * code within budget."
   *
   * This field is ADDITIVE and defaults to null. `formatBoxValue` consults it
   * only after `notComputedYet`, so:
   *   - every existing box, which sets it null, behaves exactly as before;
   *   - an unknown figure still refuses to print, which is the older and more
   *     important guarantee;
   *   - a text box prints its words instead of a fabricated zero.
   *
   * MUST BE NULL when `measure` is "money". A form box cannot be both an
   * amount and a sentence, and letting it be would put a caption where a
   * reader expects a dollar figure. `assertBoxTextIsHonest` enforces that.
   *
   * OPTIONAL, and deliberately so. Making it required would have been the
   * stricter choice, and the type checker did enumerate all ~30 construction
   * sites when it was — but every one of them would have been edited to write
   * `text: null`, which is the meaning `undefined` already carries: this box is
   * not textual. That is churn across nine files of tax-form code to restate a
   * default, and it is exactly the kind of change that hides a real edit in a
   * hundred mechanical ones. Absent and null are read identically by
   * `boxText()`, which is the ONLY thing permitted to read this field.
   */
  readonly text?: string | null;
  /** True for boxes a reader must not skim (the ones other forms are compared against). */
  readonly emphasise: boolean;
  /**
   * Set when THE FIGURE IS NOT KNOWN, and it carries the reason.
   *
   * ═══ WHY THIS IS NOT JUST amountCents = 0 (books-49) ═══
   *
   * Michael reported: "I am unable to see or use the tab system... The form
   * pages are still just walls of text." The cause was that every teaching
   * surface was hidden behind `result.ok`, which is false until real payroll
   * exists — and the first payroll is 1 January 2027. So the one thing he
   * asked for was invisible, and would have stayed invisible for a year.
   *
   * The fix is to teach the form whether or not the figures exist. That
   * immediately raises the question this field answers: what goes in the
   * figure column when nothing has been computed?
   *
   * NOT zero. A zero is a CLAIM. `$0.00` in box 5a says "you paid no Social
   * Security wages this quarter", which on a filed return is a statement the
   * IRS acts on. This codebase already refuses that trade elsewhere — the
   * Washington hours adapter THROWS rather than report zero reportable hours,
   * because "zero hours" is a claim on a workers' compensation return. The
   * same reasoning applies to every box on every form.
   *
   * So an unknown figure is modelled as its own state. `blankOnPurpose` could
   * not be reused: that field means "this box is CORRECTLY empty and here is
   * the law that says so" — a statement of fact about the form. This one means
   * "we do not know yet" — a statement about OUR data. Collapsing the two would
   * tell Michael that a box he simply has no data for is a box the IRS wants
   * left blank, which is a different and much more dangerous sentence.
   */
  readonly notComputedYet: string | null;
};

/**
 * The ONE correct way to render a box's value, whatever it is measured in.
 *
 * Provided so no caller has to remember the rule. A screen that calls this
 * cannot print "$0.00" beside a box that really says "3,558 hours" - which is
 * precisely the defect the `measure` field exists to prevent, and which would
 * otherwise reappear in every new screen.
 */
/**
 * The words in a text box, or null if this box is not a text box.
 *
 * The single reader of `FormBox.text`, so "absent" and "explicitly null" cannot
 * be treated as different things by two callers who each guessed. An
 * empty-or-whitespace string is also null: a box containing only spaces is not
 * a box containing an answer.
 */
export function boxText(box: FormBox): string | null {
  const t = box.text;
  if (t === undefined || t === null) return null;
  return t.trim() === "" ? null : t;
}

export function formatBoxValue(box: FormBox): string {
  /*
   * AN UNKNOWN FIGURE IS NEVER PRINTED AS A NUMBER (books-49).
   *
   * This branch is first on purpose. If it came after the money branch, a box
   * carrying `notComputedYet` with the default amountCents of 0 would print
   * "$0.00" — the exact false claim the field exists to prevent. Order is
   * load-bearing here, and the gate asserts this by constructing a
   * not-computed box and checking the output contains no digits.
   */
  if (box.notComputedYet !== null) return "not computed yet";
  /*
   * WORDS, WHEN THE BOX HOLDS WORDS (books-68, D-21).
   *
   * Second, never first: an unknown figure must still refuse to print, and a
   * box that is both unknown and textual is unknown. Before the numeric
   * branches, because those would format `quantity ?? 0` as a literal zero for
   * a box that holds a person's name.
   */
  const words = boxText(box);
  if (words !== null) return words;
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
  /*
   * UNKNOWN IS NOT EMPTY (books-49).
   *
   * "Empty" is a statement about the FORM: this box has nothing in it. A box
   * whose figure has not been computed yet is not empty — we simply have not
   * looked. Returning true here would make `correctlyBlank` reachable for a
   * not-computed box (it is `empty && blankOnPurpose !== null`), which would
   * grey the box out and tell Michael the form wants it left blank. That is
   * the confusion `notComputedYet` was created to prevent, so it is refused at
   * the one place that decides emptiness rather than at each caller.
   */
  if (box.notComputedYet !== null) return false;
  /*
   * A TEXT BOX IS EMPTY WHEN IT HAS NO WORDS, not when its quantity is zero
   * (books-68). Without this, every populated text box would report itself
   * empty — quantity is null on all of them — and `correctlyBlank` would grey
   * out a box containing an employee's name.
   */
  if (boxText(box) !== null) return false;
  if (box.measure === "money") return box.amountCents === 0;
  return (box.quantity ?? 0) === 0;
}

/**
 * A box may be an amount or a sentence, never both.
 *
 * Called by the box gate rather than at construction, so the failure names the
 * offending box instead of throwing from inside a render. A money box carrying
 * text would print words where a reader expects dollars — on a page whose whole
 * purpose is being copied onto a government portal.
 */
export function assertBoxTextIsHonest(boxes: readonly FormBox[]): void {
  for (const b of boxes) {
    if (boxText(b) !== null && b.measure === "money") {
      throw new Error(
        `form-box-core: box ${b.formId}/${b.box} is measure "money" and also carries text ` +
          `(${JSON.stringify(b.text)}). A box is an amount or a sentence, not both: printing ` +
          `words where a dollar figure belongs is how a wrong number reaches a return.`,
      );
    }
    if (boxText(b) !== null && b.notComputedYet !== null) {
      throw new Error(
        `form-box-core: box ${b.formId}/${b.box} carries text and is ALSO flagged not-computed. ` +
          `Those are contradictory claims, and the reader would be shown "not computed yet" ` +
          `while the value sat in the object.`,
      );
    }
  }
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
  /*
   * AN UNKNOWN FIGURE IS PAINTED NEUTRAL (books-49), and it is checked SECOND
   * so that a box which is blank on purpose keeps saying so.
   *
   * Colour on this screen carries meaning, never decoration — gold is "your
   * money", green is "your employees' money". Painting a box gold because it
   * WOULD be Greenway's money if it had a figure states a fact about money
   * that has not been counted. Neutral says "no claim is being made here",
   * which is exactly the claim we are entitled to make.
   */
  if (box.notComputedYet !== null) return "neutral";
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
 *
 * ═══ AND WHY "tax_base" IS EXCLUDED, WHICH MATTERS EVEN MORE ═══
 *
 * A `tax_base` box holds WAGES. On Form 941 line 2 that is around $69,000 while
 * the taxes beneath it are around $10,000. Letting a wage base into this sum
 * would not merely skew the split, it would swamp it - the bar would read about
 * 87% "employer" and the real question, who funded the tax, would become
 * invisible. This function answers "whose money was OWED", so only boxes that
 * somebody actually owes may enter it.
 *
 * This is written as an allow-list, never a deny-list: a category is added only
 * by being named here. A new sixth category therefore contributes NOTHING until
 * somebody makes a decision about it, which is the failure mode worth having.
 */
export function splitMoney(boxes: readonly FormBox[]): MoneySplit {
  let employerCents = 0;
  let employeeCents = 0;
  for (const b of boxes) {
    if (b.measure !== "money") continue;
    /*
     * A FIGURE WE HAVE NOT COMPUTED CANNOT BE ADDED UP (books-49).
     *
     * Skipped EXPLICITLY rather than relying on the fact that such a box
     * carries amountCents = 0 and would therefore add nothing. That would be
     * correct by accident: the day somebody builds a not-computed box that
     * also carries a placeholder amount, this loop would silently start
     * summing figures nobody computed into a bar Michael reads as fact.
     * Rule 62d — the safety must be stated, not inherited.
     */
    if (b.notComputedYet !== null) continue;
    // Allow-list. "shared" is a total, "tax_base" is wages, "not_money" is a
    // count; none of the three is money anybody owes, so none may be added.
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
    notComputedYet: null,
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
 * The split must ignore a WAGE BASE, or the bar stops answering its own question.
 *
 * Modelled on the real Form 941 shape, where line 2 is wages of about $69,000
 * and the taxes below it are about $10,000. If the base leaked in, the split
 * would read roughly 87/13 instead of the true 50/50 of FICA, and it would look
 * plausible - which is the dangerous kind of wrong.
 */
export function assertSplitIgnoresTaxBase(): void {
  const withoutBase = [
    box({ box: "employee-fica", amountCents: 527_36, whose: "employee_money" }),
    box({ box: "employer-fica", amountCents: 527_36, whose: "employer_cost" }),
  ];
  const withBase = [
    box({ box: "2", amountCents: 6_892_345, whose: "tax_base" }),
    ...withoutBase,
  ];
  const a = splitMoney(withoutBase);
  const b = splitMoney(withBase);
  assert(
    a.totalCents === b.totalCents,
    `a wage base changed the total from ${a.totalCents} to ${b.totalCents}`,
  );
  assert(b.employerCents === 527_36, `wage base leaked into employer: ${b.employerCents}`);
  // FICA is the textbook 50/50, and it must still read that way.
  assert(b.employerMilliPct === 50_000, `employer pct ${b.employerMilliPct}, expected 50000`);
  assert(b.employeeMilliPct === 50_000, `employee pct ${b.employeeMilliPct}, expected 50000`);
}

/**
 * A wage base must be NEUTRAL, not coloured.
 *
 * Stated as its own gate because it is the one colour rule a well-meaning future
 * change is most likely to "improve" - the biggest number on the form looks like
 * it deserves the loudest colour, and it deserves the quietest.
 */
export function assertTaxBaseIsQuiet(): void {
  assert(whoseMoneyTone("tax_base") === "neutral", "a wage base must not be coloured");
  assert(
    whoseMoneyConsequence("tax_base").includes("Nobody owes"),
    "the wage base consequence must say nobody owes it",
  );
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
  // Walked from the exported constant, never from a copy typed out here. Rule 43.
  for (const w of ALL_WHOSE_MONEY) {
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
  assertSplitIgnoresTaxBase();
  assertTaxBaseIsQuiet();
  assertZeroTotalGivesNullPercentages();
  assertEveryCategoryIsExplained();
  assertEveryTabIsExplained();
  assertLessonLookupIsFormScoped();
}
