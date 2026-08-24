/**
 * src/lib/payroll/form-w2-ui-core.ts   (books-46, slice A)
 *
 * EVERY DECISION THE W-2 SCREEN MAKES, IN A FILE A TEST CAN REACH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A `page.tsx` cannot be unit tested in this repository - the vitest include is
 * `tests/compliance/` and a server component reaches the database - so any rule
 * that lives in JSX is a rule nothing checks. The page that goes with this file
 * is markup and nothing else. Which badge colour, which sentence, whether the
 * button may be pressed, and what the page says when there is nothing to show
 * all live here.
 *
 * NOTHING HERE READS THE CLOCK, THE DATABASE, OR THE FILESYSTEM. Every input
 * arrives as an argument. On a screen whose whole subject is a deadline, "what
 * day is it" is precisely the input a test needs to control.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE THING THAT MAKES THIS SCREEN DIFFERENT FROM THE 941 SCREEN
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Form 941 is a TAX RETURN. It computes a liability and the liability gets paid,
 * so its failure mode is arithmetic and its screen is organised around a balance
 * due.
 *
 * Form W-2 is an INFORMATION RETURN. It computes nothing and pays nothing. It
 * re-reports figures that twenty-six pay runs already fixed months ago. So its
 * failure mode is not miscalculation - it is FAITHFULLY REPORTING A FIGURE THAT
 * WAS ALREADY WRONG IN MARCH, and no amount of checking the W-2 against itself
 * will ever find that.
 *
 * That single fact decides the layout of this screen. The headline is not "is
 * the form correct" - the form is always internally correct, the engine
 * guarantees it. The headline is DOES IT AGREE WITH THE FOUR 941s, because that
 * is the only question whose answer can be no. `reconciliationTone` and
 * `w2NextAction` both put the reconciliation above everything else for that
 * reason, and `w2NextAction` deliberately ranks a reconciliation break ABOVE an
 * approaching deadline: filing a wrong W-2 on time is worse than filing a right
 * one a day late, because the first costs a W-2c, a W-3c and a 941-X.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS SCREEN MUST NEVER "HELP" WITH
 * ───────────────────────────────────────────────────────────────────────────
 *
 * On Michael's own W-2, box 1 legitimately EXCEEDS boxes 3 and 5, because the
 * company-paid health premium for a 2%-or-more shareholder-employee is wages for
 * income tax but is carved out of FICA by IRC 3121(a)(2)(B). The screen's
 * instinct - any screen's instinct - is to flag boxes that do not agree. Doing
 * so here would train Michael to "fix" a correct form, and every available fix
 * is wrong: making them agree either overpays FICA or understates his income,
 * and the matching 1040 deduction is only available IF IT WENT ON THE W-2 FIRST.
 *
 * So `boxRows` marks that difference EXPECTED and green, with the reason and the
 * authority attached, and `boxDifferenceNote` states it in words. There is a
 * test that fails if this file ever advises making the boxes match.
 */

import {
  ALL_W2_REFUSAL_CODES,
  formatCentsForW2,
  type ReconciliationResult,
  type W2Form,
  type W2Refusal,
  type W2RefusalCode,
  type W3Form,
} from "@/lib/payroll/form-w2-core";
import {
  w2ChecksInOrder,
  w2RefusalLessonFor,
  type W2Check,
  type W2WorkedExample,
  FORM_W2_WORKED_EXAMPLES,
} from "@/lib/payroll/form-w2-mentor";
import type { ScreenTone } from "@/lib/ui/screen-tone-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  HOW LONG IS LEFT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Whole days from `today` to `due`, both ISO dates. Negative means overdue.
 *
 * Computed in UTC from the date parts alone, never from a local `Date`, so the
 * answer does not change with the server's timezone. A deadline screen that says
 * "3 days" in Seattle and "2 days" in UTC is a screen nobody can trust at the
 * only moment it matters.
 *
 * NOT SHARED WITH `form-941-ui-core.daysUntil` ON PURPOSE, and this deserves a
 * note because it looks like the duplication this slice just spent effort
 * removing. It is not the same case. The tone union was one IDEA with four
 * names; extracting it changed nothing about behaviour. Reaching across to
 * import a date helper from the 941 screen's UI module would make the W-2 screen
 * depend on the 941 screen, which is a dependency in the wrong direction between
 * two peers. If a third screen needs it, it moves to a shared date module - that
 * is the trigger, and it has not fired yet.
 */
export function w2DaysUntil(today: string, due: string): number {
  const parse = (iso: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`form-w2 ui: "${iso}" is not an ISO date (YYYY-MM-DD).`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((parse(due) - parse(today)) / 86_400_000);
}

export type W2UrgencyBand = "overdue" | "due-now" | "due-soon" | "reconcile-season" | "comfortable";

/**
 * Turn days-remaining into a band.
 *
 * ═══ THE BOUNDARIES ARE CHOSEN, AND ONE OF THEM IS UNIQUE TO THIS FORM. ═══
 *
 * The 941 screen has four bands. This one has five, and the extra band is the
 * whole reason the W-2 screen is worth building.
 *
 * `reconcile-season` covers 31 to 120 days out - roughly October through
 * December for a 1 February deadline. That window is not "plenty of time", which
 * is what a four-band scale would call it. It is THE ONLY WINDOW IN WHICH A
 * MISTAKE IS CHEAP. A variance found in October is a correction on the next 941.
 * The identical variance found on 30 January costs a 941-X, a W-2c and a W-3c -
 * three filings to fix one number, plus a letter to answer.
 *
 * A scale that renders October and June the same colour is telling Michael the
 * cheapest month and the most useless month look alike. So October gets its own
 * band and its own sentence.
 */
export function w2UrgencyBand(daysLeft: number): W2UrgencyBand {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "due-now";
  if (daysLeft <= 30) return "due-soon";
  if (daysLeft <= 120) return "reconcile-season";
  return "comfortable";
}

export function w2UrgencyTone(band: W2UrgencyBand): ScreenTone {
  switch (band) {
    case "overdue":
      return "danger";
    case "due-now":
      return "orange";
    case "due-soon":
      return "gold";
    case "reconcile-season":
      return "gold";
    case "comfortable":
      return "green";
  }
}

/**
 * The deadline in words.
 *
 * The `overdue` sentence names BOTH penalties, because they are two separate
 * duties with two separate sections and an owner who has missed one has usually
 * missed both. The `reconcile-season` sentence is written to be encouraging
 * rather than alarming - it is the one band where the correct emotional response
 * is "good, I am early".
 */
export function w2UrgencyMeaning(band: W2UrgencyBand, daysLeft: number, due: string): string {
  const d = Math.abs(daysLeft);
  const dayWord = d === 1 ? "day" : "days";
  switch (band) {
    case "overdue":
      return (
        `These forms were due ${due} - ${d} ${dayWord} ago. Two separate penalties are running, ` +
        `not one: IRC 6721 for the copies owed to the SSA and IRC 6722 for the copies owed to ` +
        `your employees. They are charged PER FORM, so ten employees means ten of each. File ` +
        `and furnish today.`
      );
    case "due-now":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. This is the week. Remember the employee ` +
        `copies are due the same day as the SSA copies - there is no grace period between them ` +
        `any more.`
      );
    case "due-soon":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. Nothing is wrong. Finish the checking now, ` +
        `because everything has to be right before anything leaves the building.`
      );
    case "reconcile-season":
      return (
        `Due ${due}, which is ${d} ${dayWord} away - and this is the valuable window. Run the ` +
        `reconciliation NOW, while a variance is still a correction on the next 941 rather than ` +
        `a 941-X, a W-2c and a W-3c. This is the cheapest month of the year to find a mistake.`
      );
    case "comfortable":
      return (
        `Due ${due}, which is ${d} ${dayWord} away. There is nothing to do yet. The work on this ` +
        `screen starts once the third quarter is filed.`
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE STATE OF THE YEAR
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2Status =
  | "blocked"
  | "reconciliation-broken"
  | "reconciliation-incomplete"
  | "not-reconciled"
  | "ready";

/**
 * Collapse the whole year into one status.
 *
 * ═══ THE ORDER OF THESE TESTS IS THE DESIGN. ═══
 *
 *   1. `blocked` - some W-2 could not be built at all. Nothing else matters,
 *      because a batch with a missing form has a W-3 that is wrong by
 *      construction and reconciling it would produce a confident, false answer.
 *   2. `reconciliation-broken` - the W-3 disagrees with the 941s. This ranks
 *      ABOVE any deadline, deliberately. See `w2NextAction`.
 *   3. `reconciliation-incomplete` - fewer than four quarters supplied. This is
 *      NOT an error and must not look like one; in October it is the expected
 *      and correct state.
 *   4. `not-reconciled` - never run. Distinct from `incomplete` because "you
 *      have not checked" and "you checked with what you had" are different
 *      facts, and collapsing them would let a batch reach February never having
 *      been compared to anything.
 *   5. `ready`.
 *
 * `recon` is `null` when the comparison has not been run. That is why the type
 * is nullable rather than defaulted: rule 62d, never invent a default. A default
 * of "agrees" would mark an unchecked year green.
 */
export function w2StatusOf(
  forms: readonly W2Form[],
  refusalCount: number,
  recon: ReconciliationResult | null,
): W2Status {
  if (refusalCount > 0 || forms.length === 0) return "blocked";
  if (recon === null) return "not-reconciled";
  if (!recon.allAgree) return "reconciliation-broken";
  if (!recon.isComplete) return "reconciliation-incomplete";
  return "ready";
}

export function w2StatusTone(status: W2Status): ScreenTone {
  switch (status) {
    case "blocked":
      return "danger";
    case "reconciliation-broken":
      return "danger";
    case "reconciliation-incomplete":
      return "gold";
    case "not-reconciled":
      return "gold";
    case "ready":
      return "green";
  }
}

export function w2StatusLabel(status: W2Status): string {
  switch (status) {
    case "blocked":
      return "Cannot be produced yet";
    case "reconciliation-broken":
      return "Do not file - the totals disagree";
    case "reconciliation-incomplete":
      return "Checked so far, and it agrees";
    case "not-reconciled":
      return "Not yet compared to the 941s";
    case "ready":
      return "Ready to file";
  }
}

/**
 * What the status MEANS.
 *
 * The `reconciliation-incomplete` sentence has to open by saying it is correct.
 * Gold on this screen must be unmistakably different from red, and the fastest
 * way to make that true is to say so in the first six words.
 */
export function w2StatusMeaning(status: W2Status): string {
  switch (status) {
    case "blocked":
      return (
        "One or more forms could not be produced, so there is no complete batch and no W-3. " +
        "Nothing has been saved and nothing has been filed. Fix the items below and the forms " +
        "will build themselves."
      );
    case "reconciliation-broken":
      return (
        "The forms are internally correct, but the W-3 totals do not match the four 941s you " +
        "already filed. That means one of the two is wrong, and filing the W-2s now would lock " +
        "in the disagreement. The IRS says you WILL be contacted about a mismatch, not that you " +
        "may be. Find the cause first - it is almost always a pay run that reached one report " +
        "and not the other."
      );
    case "reconciliation-incomplete":
      return (
        "Everything checked so far agrees - this is a good result, not a problem. Fewer than " +
        "four quarters have been loaded, so the comparison is partial. If it is October, that is " +
        "exactly right and exactly when you want to be doing this."
      );
    case "not-reconciled":
      return (
        "The forms are built and internally correct, but they have not been compared to the four " +
        "941s yet. That comparison is the only check that can find a figure which was already " +
        "wrong months ago, so it is the one thing on this screen worth doing before you file."
      );
    case "ready":
      return (
        "Every figure on the W-3 agrees with the four 941s you filed. Read box 1, box 3 and box " +
        "5 out loud against the W-3, then file. Keep the comparison - if the SSA writes in " +
        "eighteen months, this is what resolves it in ten minutes instead of a week."
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE ONE NEXT ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2NextAction = {
  readonly headline: string;
  readonly detail: string;
  readonly href: string | null;
  readonly ctaLabel: string;
  readonly tone: ScreenTone;
};

/**
 * Collapse the whole screen into one instruction.
 *
 * ═══ PRIORITY ORDER, AND WHY A DEADLINE IS NOT AT THE TOP. ═══
 *
 *   1. Refusals. A form that cannot be built cannot be late in any useful
 *      sense; "file this" is not actionable when there is nothing to file.
 *   2. A BROKEN RECONCILIATION - even when the deadline has passed.
 *   3. Overdue.
 *   4. Never reconciled.
 *   5. Incomplete reconciliation.
 *   6. The ordinary case.
 *
 * Step 2 sitting above step 3 is the one judgement call in this file, so here is
 * the reasoning explicitly. Filing a WRONG W-2 on time costs a W-2c, a W-3c, a
 * 941-X and a letter to answer. Filing a RIGHT one a few days late costs a
 * per-form penalty that, at Greenway's size, is smaller and - critically - is
 * bounded and known. Sending Michael to "file now" when the totals disagree
 * would be advising him to convert a cheap problem into an expensive one, and it
 * is exactly what an urgency-first screen would do.
 */
export function w2NextAction(args: {
  readonly forms: readonly W2Form[];
  readonly refusals: readonly W2Refusal[];
  readonly recon: ReconciliationResult | null;
  readonly today: string;
  readonly due: string;
}): W2NextAction {
  const { forms, refusals, recon, today, due } = args;

  if (refusals.length > 0) {
    const first = refusals[0];
    const lesson = first ? w2RefusalLessonFor(first.code) : undefined;
    return {
      headline:
        refusals.length === 1
          ? "One thing is missing before these forms can be built."
          : `${refusals.length} things are missing before these forms can be built.`,
      detail: lesson ? lesson.howToFix : (first?.remedy ?? "Review the items listed below."),
      href: null,
      ctaLabel: "See what is missing",
      tone: "danger",
    };
  }

  if (forms.length === 0) {
    return {
      headline: "There are no W-2s to show for this year.",
      detail:
        "No employee has any year-to-date figures for this tax year, so there is nothing to " +
        "report. If people were paid, the pay runs have probably not been posted yet.",
      href: null,
      ctaLabel: "Check the pay runs",
      tone: "gold",
    };
  }

  const daysLeft = w2DaysUntil(today, due);
  const band = w2UrgencyBand(daysLeft);

  if (recon !== null && !recon.allAgree) {
    const broken = recon.lines.filter((l) => !l.agrees);
    const worst = broken[0];
    return {
      headline:
        broken.length === 1
          ? "One figure on the W-3 does not match the 941s. Do not file yet."
          : `${broken.length} figures on the W-3 do not match the 941s. Do not file yet.`,
      detail:
        `Start with "${worst?.label ?? "the first difference"}": the W-3 says ` +
        `${formatCentsForW2(worst?.w3Cents ?? 0)} and the 941s say ` +
        `${formatCentsForW2(worst?.form941Cents ?? 0)}, a difference of ` +
        `${formatCentsForW2(Math.abs(worst?.differenceCents ?? 0))}. Fixing this before you file ` +
        `costs one correction. Filing first and fixing after costs a 941-X, a W-2c and a W-3c.` +
        (band === "overdue"
          ? " These forms are already late, and that is still the right order - a wrong form " +
            "filed today creates three more filings."
          : ""),
      href: null,
      ctaLabel: "Open the comparison",
      tone: "danger",
    };
  }

  if (band === "overdue") {
    return {
      headline: `The ${
        forms.length === 1 ? "form is" : "forms are"
      } overdue by ${Math.abs(daysLeft)} ${
        Math.abs(daysLeft) === 1 ? "day" : "days"
      }.`,
      detail:
        "File the SSA copies and furnish the employee copies today. Both are late, they are " +
        "charged separately under IRC 6721 and IRC 6722, and both are charged per form.",
      href: null,
      ctaLabel: "Review and file",
      tone: "danger",
    };
  }

  if (recon === null) {
    return {
      headline: `${forms.length} ${forms.length === 1 ? "form is" : "forms are"} built. Compare them to the 941s before filing.`,
      detail:
        "The forms are internally correct - the engine guarantees that. What it cannot know is " +
        "whether the figures it faithfully copied were right in the first place. The comparison " +
        "against the four 941s is the only check that can find that, and it is the reason this " +
        "screen exists.",
      href: null,
      ctaLabel: "Run the comparison",
      tone: "gold",
    };
  }

  if (!recon.isComplete) {
    return {
      headline: `Everything checked agrees, using ${recon.quartersIncluded} of 4 quarters.`,
      detail:
        `This is the right answer for a partial year and nothing is wrong. Load the remaining ` +
        `${4 - recon.quartersIncluded} ${
          4 - recon.quartersIncluded === 1 ? "quarter" : "quarters"
        } as they are filed. Doing this now rather than in January is the entire point: a ` +
        `variance found today is a correction, not three amended returns.`,
      href: null,
      ctaLabel: "Review the comparison",
      tone: "gold",
    };
  }

  return {
    headline: `${forms.length} ${forms.length === 1 ? "form" : "forms"} ready, and the W-3 agrees with all four 941s.`,
    detail: w2UrgencyMeaning(band, daysLeft, due),
    href: null,
    ctaLabel: "Review and file",
    tone: w2UrgencyTone(band),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  MAY THE BUTTON BE PRESSED?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2ButtonState = {
  readonly enabled: boolean;
  readonly label: string;
  readonly disabledReason: string | null;
  readonly honestyNote: string;
};

/**
 * ═══ THIS SYSTEM IS NOT A FILING AGENT, AND THE BUTTON SAYS SO. ═══
 *
 * We replace the data-preparation half of what Aatrix did. We do not transmit
 * anything and we never will. A button labelled "File" that does not file is the
 * single most dangerous control this project could ship, because the failure
 * mode is Michael believing a return went in when it did not - and discovering
 * otherwise from a penalty notice.
 *
 * So the label is "Show the forms", and the honesty note appears whether the
 * button is enabled or not.
 *
 * NOTE THAT A BROKEN RECONCILIATION DOES NOT DISABLE THIS BUTTON. It is
 * tempting, and it would be wrong: the forms are worth LOOKING AT precisely when
 * the totals disagree, because looking at them is how the cause gets found.
 * Blocking the view would leave Michael with a red banner and no way to
 * investigate it. The next action already tells him not to file.
 */
export function w2ButtonState(
  refusals: readonly W2Refusal[],
  formCount: number,
): W2ButtonState {
  const note =
    "This produces the figures for the forms. It does not transmit anything to the SSA or the " +
    "IRS - nothing here files on your behalf, and nothing here is a filing agent. Take these " +
    "figures to your filing method, check them against the form, and sign it yourself.";

  if (refusals.length > 0) {
    return {
      enabled: false,
      label: "Cannot produce these forms yet",
      disabledReason:
        refusals.length === 1
          ? "One item below has to be resolved first."
          : `${refusals.length} items below have to be resolved first.`,
      honestyNote: note,
    };
  }

  if (formCount === 0) {
    return {
      enabled: false,
      label: "Nothing to show",
      disabledReason: "No employee has year-to-date figures for this tax year.",
      honestyNote: note,
    };
  }

  return {
    enabled: true,
    label: formCount === 1 ? "Show the form" : `Show all ${formCount} forms`,
    disabledReason: null,
    honestyNote: note,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE BOXES, AND THE DIFFERENCE THAT IS SUPPOSED TO BE THERE
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2BoxRow = {
  readonly box: string;
  readonly caption: string;
  readonly display: string;
  readonly derivation: string;
  /** True for the boxes a reader should not skim. */
  readonly emphasise: boolean;
  readonly tone: ScreenTone;
  /**
   * Set only on box 17 and only when it is correctly zero.
   *
   * A box that is SUPPOSED to be blank looks identical to a box somebody forgot,
   * and the difference is the whole of trap 2. Grey plus a reason, never red and
   * never silent.
   */
  readonly blankOnPurpose: string | null;
};

/**
 * The boxes, formatted for display.
 *
 * BOXES 1, 3 AND 5 ARE EMPHASISED. Not because they are the largest, but
 * because they are the three the W-3 totals and therefore the three the SSA
 * compares against the 941s. Box 2 is not emphasised even though it is money:
 * nobody has ever mis-stated federal income tax withheld without also
 * mis-stating a wage box.
 *
 * BOX 17 IS TREATED SPECIALLY AND THIS IS NOT A STYLE CHOICE. Washington levies
 * no personal income tax, so box 17 must be blank. PFML and WA Cares are real
 * employee deductions but they belong in BOX 14. Reporting them in box 17 tells
 * the IRS that Michael's employees paid a state income tax that does not exist,
 * and invites them to claim a deduction they are not entitled to.
 */
export function w2BoxRows(form: W2Form): readonly W2BoxRow[] {
  const emphasised = new Set(["1", "3", "5"]);
  return form.boxes.map((b) => {
    const isBox17 = b.box === "17";
    const blankOnPurpose =
      isBox17 && b.amountCents === 0
        ? "Blank on purpose. Washington has no personal income tax, so there is no state income " +
          "tax to withhold. PFML and WA Cares are real deductions from your employees' pay, but " +
          "they belong in box 14, not here. Putting them in box 17 would tell the IRS your " +
          "employees paid a tax that does not exist."
        : null;

    return {
      box: b.box,
      caption: b.caption,
      display: formatCentsForW2(b.amountCents),
      derivation: b.derivation,
      emphasise: emphasised.has(b.box),
      tone: isBox17 ? (b.amountCents === 0 ? "neutral" : "danger") : "neutral",
      blankOnPurpose,
    };
  });
}

/**
 * The sentence explaining why box 1 is larger than boxes 3 and 5.
 *
 * ═══ RETURNS NULL WHEN THERE IS NOTHING TO EXPLAIN. ═══
 *
 * Not an empty string, and not a reassuring sentence. Showing "these boxes
 * agree, which is correct" on every ordinary employee's form would teach Michael
 * to skim past the panel, and then it would be invisible on the ONE form where
 * it matters - his own.
 *
 * The engine has already computed `box1MinusBox3Cents` and produced
 * `box1ExceedsFicaExplanation`. This function does NOT recompute either. A
 * second opinion about the same figure, formed in a UI file, is how two answers
 * to one question come into existence.
 */
export function w2BoxDifferenceNote(form: W2Form): {
  readonly tone: ScreenTone;
  readonly headline: string;
  readonly body: string;
  readonly authorityId: string;
} | null {
  if (form.box1MinusBox3Cents === 0) return null;

  return {
    // GREEN, NOT GOLD, AND CERTAINLY NOT RED. This is correct. Colouring it as a
    // warning is what teaches somebody to "fix" it.
    tone: "green",
    headline: `Box 1 is ${formatCentsForW2(
      form.box1MinusBox3Cents,
    )} higher than boxes 3 and 5, and that is correct.`,
    body:
      (form.box1ExceedsFicaExplanation ??
        "The difference is the company-paid health premium for a 2%-or-more shareholder-employee.") +
      " Do not make these boxes agree. Forcing them to match either overpays Social Security and " +
      "Medicare or understates the income - and the deduction you get for this premium on your " +
      "personal return is only available because it appeared on the W-2 first.",
    authorityId: "iw2w3-2026-box-3-scorp-health-carve-out",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE W-3 AND THE COMPARISON
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W3Row = {
  readonly box: string;
  readonly caption: string;
  readonly display: string;
  readonly note: string;
  readonly tone: ScreenTone;
};

/**
 * The W-3, as rows.
 *
 * BOX 12a CARRIES THE LOUDEST NOTE ON THIS SCREEN, because it is the one box on
 * the W-3 that is NOT a total. Only the deferral codes carry up; codes DD
 * (employer-paid health coverage) and C (group-term life) are deliberately
 * dropped. Summing all of box 12 into 12a is the single easiest W-3 error for a
 * generator to make, and it produces a figure the IRS is not expecting.
 *
 * The excluded amount is shown DELIBERATELY rather than hidden, because a filter
 * whose effect nobody can see is a filter nobody trusts. When it is non-zero it
 * is the exact amount a naive total would have overstated by.
 */
export function w3Rows(w3: W3Form): readonly W3Row[] {
  const rows: W3Row[] = [
    {
      box: "1",
      caption: "Wages, tips, other compensation",
      display: formatCentsForW2(w3.box1Cents),
      note: `The sum of box 1 across ${w3.formCount} ${w3.formCount === 1 ? "form" : "forms"}. Compare this to line 2 of the four 941s added together.`,
      tone: "neutral",
    },
    {
      box: "2",
      caption: "Federal income tax withheld",
      display: formatCentsForW2(w3.box2Cents),
      note: "Compare to line 3 of the four 941s. Same money counted twice, so it must match exactly.",
      tone: "neutral",
    },
    {
      box: "3",
      caption: "Social security wages",
      display: formatCentsForW2(w3.box3Cents),
      note: "Compare to line 5a of the four 941s. Both are after the annual cap.",
      tone: "neutral",
    },
    {
      box: "4",
      caption: "Social security tax withheld",
      display: formatCentsForW2(w3.box4Cents),
      note: "The EMPLOYEE half only. The 941 reports both halves, so line 5a tax should be exactly double this.",
      tone: "neutral",
    },
    {
      box: "5",
      caption: "Medicare wages and tips",
      display: formatCentsForW2(w3.box5Cents),
      note: "Compare to line 5c of the four 941s. Never capped.",
      tone: "neutral",
    },
    {
      box: "6",
      caption: "Medicare tax withheld",
      display: formatCentsForW2(w3.box6Cents),
      note: "Includes the extra 0.9% Additional Medicare Tax, which has no employer match. That is why the 941 is only APPROXIMATELY double this box.",
      tone: "neutral",
    },
    {
      box: "12a",
      caption: "Deferred compensation",
      display: formatCentsForW2(w3.box12aCents),
      note:
        "THE ONE BOX ON THIS FORM THAT IS NOT A TOTAL. Only the retirement deferral codes carry " +
        "up here. Codes DD and C are excluded on purpose" +
        (w3.box12ExcludedFromW3Cents > 0
          ? `, and ${formatCentsForW2(
              w3.box12ExcludedFromW3Cents,
            )} was excluded this year - that is exactly the amount a naive total would have overstated by.`
          : ". Nothing was excluded this year because no form carried an excluded code."),
      // Gold: correct, and the box most worth reading twice.
      tone: "gold",
    },
    {
      box: "16",
      caption: "State wages, tips, etc.",
      display: formatCentsForW2(w3.box16Cents),
      note: `State: ${w3.stateCode ?? "not set"}.`,
      tone: "neutral",
    },
    {
      box: "17",
      caption: "State income tax",
      display: formatCentsForW2(w3.box17Cents),
      note:
        w3.box17Cents === 0
          ? "Zero, and it must be. Washington has no personal income tax."
          : "THIS MUST BE ZERO IN WASHINGTON. A non-zero figure here means PFML or WA Cares was put in box 17 instead of box 14 on at least one form.",
      tone: w3.box17Cents === 0 ? "neutral" : "danger",
    },
  ];
  return rows;
}

/**
 * The tone for the reconciliation panel.
 *
 * `null` (never run) is GOLD rather than neutral. Neutral would say "no opinion",
 * and this screen does have an opinion about an unchecked year: it is the one
 * thing worth doing before filing.
 */
export function reconciliationTone(recon: ReconciliationResult | null): ScreenTone {
  if (recon === null) return "gold";
  if (!recon.allAgree) return "danger";
  if (!recon.isComplete) return "gold";
  return "green";
}

export type ReconRow = {
  readonly label: string;
  readonly w3Display: string;
  readonly form941Display: string;
  readonly differenceDisplay: string;
  readonly agrees: boolean;
  readonly plain: string;
  readonly tone: ScreenTone;
};

/**
 * The comparison, as rows.
 *
 * THE DIFFERENCE COLUMN IS ALWAYS SHOWN, even when it is zero, and it shows a
 * signed figure. A column that appears only on failure trains the reader to look
 * for its presence rather than to read it, and an unsigned difference hides the
 * most diagnostic fact available - WHICH SIDE is short.
 */
export function reconRows(recon: ReconciliationResult): readonly ReconRow[] {
  return recon.lines.map((l) => ({
    label: l.label,
    w3Display: formatCentsForW2(l.w3Cents),
    form941Display: formatCentsForW2(l.form941Cents),
    differenceDisplay:
      l.differenceCents === 0
        ? formatCentsForW2(0)
        : `${l.differenceCents > 0 ? "+" : "-"}${formatCentsForW2(Math.abs(l.differenceCents))}`,
    agrees: l.agrees,
    plain: l.plain,
    tone: l.agrees ? "green" : "danger",
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  REFUSALS, CHECKS AND EXAMPLES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2RefusalCard = {
  readonly code: W2RefusalCode;
  readonly headline: string;
  readonly whatHappened: string;
  readonly howToFix: string;
  readonly whyWeRefuse: string;
  readonly tone: ScreenTone;
};

/**
 * Turn a refusal into a card, using the mentor for the teaching and the engine
 * for the specifics.
 *
 * BOTH ARE NEEDED. The lesson explains the CLASS of problem - what this code
 * means and why the system refuses rather than guessing. The refusal names the
 * person and the amount. A card with only the lesson is a textbook; a card with
 * only the refusal is an error message.
 */
export function w2RefusalCard(refusal: W2Refusal): W2RefusalCard {
  const lesson = w2RefusalLessonFor(refusal.code);
  if (!lesson) {
    /*
     * Reachable only if a code is added to the engine without a lesson, which
     * `assertEveryW2RefusalIsTaught` fails the build on. Degrading to the
     * refusal's own words beats rendering an empty card - and it SAYS the
     * missing lesson is itself a defect rather than hiding it.
     */
    return {
      code: refusal.code,
      headline: refusal.message,
      whatHappened: refusal.message,
      howToFix: refusal.remedy,
      whyWeRefuse:
        "This refusal has no lesson attached to it, which is itself a defect - please report it.",
      tone: "danger",
    };
  }
  return {
    code: refusal.code,
    headline: lesson.headline,
    // The engine's sentence, because it names the person and the figure.
    whatHappened: refusal.message,
    // The engine's remedy is the specific one; the lesson's is the general one.
    howToFix: refusal.remedy,
    whyWeRefuse: lesson.whyWeRefuse,
    tone: "danger",
  };
}

/** Group refusals by code so five people missing the same field are one card. */
export function groupW2Refusals(
  refusals: readonly W2Refusal[],
): readonly { readonly code: W2RefusalCode; readonly items: readonly W2Refusal[] }[] {
  const order: W2RefusalCode[] = [];
  const byCode = new Map<W2RefusalCode, W2Refusal[]>();
  for (const r of refusals) {
    if (!byCode.has(r.code)) {
      byCode.set(r.code, []);
      order.push(r.code);
    }
    byCode.get(r.code)!.push(r);
  }
  return order.map((code) => ({ code, items: byCode.get(code)! }));
}

/**
 * Every refusal code, paired with whether the mentor can explain it.
 *
 * Exists so a test can prove the screen never shows a code it cannot teach,
 * without the test hand-typing the code list (standing rule 43).
 */
export function w2RefusalCoverage(): readonly { code: W2RefusalCode; taught: boolean }[] {
  return ALL_W2_REFUSAL_CODES.map((code) => ({
    code,
    taught: w2RefusalLessonFor(code) !== undefined,
  }));
}

export type W2CheckRow = {
  readonly key: string;
  readonly order: number;
  readonly question: string;
  readonly whyThisOrder: string;
  readonly howToCheck: string;
  readonly ifItFails: string;
};

/**
 * The checklist, in order.
 *
 * Reads `w2ChecksInOrder()` rather than sorting here. The ORDER IS THE TEACHING
 * on this list - item 1 is first because it is the only one whose cost depends
 * on the date you do it - and a screen that re-sorted it would silently destroy
 * the argument. Passing it straight through is the point.
 */
export function w2CheckRows(): readonly W2CheckRow[] {
  return w2ChecksInOrder().map((c: W2Check) => ({
    key: c.key,
    order: c.order,
    question: c.question,
    whyThisOrder: c.whyThisOrder,
    howToCheck: c.howToCheck,
    ifItFails: c.ifItFails,
  }));
}

export type W2ExampleRow = {
  readonly key: string;
  readonly title: string;
  readonly setup: string;
  readonly steps: readonly string[];
  readonly theLesson: string;
};

/**
 * The worked examples.
 *
 * Michael is a visual learner and told us the verbatim authority panels are
 * "hard to digest as there is a wall of words and colour". A worked example with
 * one arithmetic step per line is the antidote: it is the same information as the
 * statute, arranged so the eye can follow it.
 */
export function w2ExampleRows(): readonly W2ExampleRow[] {
  return FORM_W2_WORKED_EXAMPLES.map((e: W2WorkedExample) => ({
    key: e.key,
    title: e.title,
    setup: e.setup,
    steps: e.steps,
    theLesson: e.theLesson,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §8  VOIDS AND THE EMPTY STATE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The note about voided forms.
 *
 * ═══ WHY THIS IS ITS OWN PANEL AND NOT A FOOTNOTE. ═══
 *
 * A voided W-2 still exists as a row. It must NOT reach the W-3 totals. That is
 * correct behaviour, and it produces a display that looks like an error: the
 * screen shows twelve forms and the W-3 says ten.
 *
 * If the screen does not explain that gap, one of two things happens. Either
 * Michael assumes the W-3 is broken, or - far worse - somebody "fixes" it by
 * including the voids, which overstates every total on the form.
 *
 * Returns null when there are no voids, because a panel that says "0 voided"
 * every year is noise that trains the eye to skip the area.
 */
export function voidNote(w3: W3Form): { readonly tone: ScreenTone; readonly body: string } | null {
  if (w3.voidedCount === 0) return null;
  const n = w3.voidedCount;
  return {
    tone: "gold",
    body:
      `${n} ${n === 1 ? "form is" : "forms are"} marked VOID and ${
        n === 1 ? "is" : "are"
      } deliberately excluded from every W-3 total above. That is why the W-3 counts ` +
      `${w3.formCount} ${w3.formCount === 1 ? "form" : "forms"} rather than ${w3.formCount + n}. ` +
      `A voided form is not a correction - it is a form that never should have existed - so its ` +
      `figures must not be added to anything. Do not "fix" the count by including them.`,
  };
}

/**
 * The empty state.
 *
 * A blank screen is a bug report waiting to happen: the reader cannot tell
 * whether there is nothing to show or whether something failed. This says which,
 * and what to do about it.
 */
export function w2EmptyStateFor(taxYear: number): { readonly title: string; readonly body: string } {
  return {
    title: `Nothing has been recorded for the ${taxYear} tax year yet.`,
    body:
      `No employee has any year-to-date figures for ${taxYear}, so there are no W-2s to produce ` +
      `and no W-3 to total. If that is right, there is nothing to file for this year. If people ` +
      `were paid in ${taxYear}, the pay runs have probably not been posted - a run that is still ` +
      `in draft contributes nothing to anybody's year-to-date figures, which is exactly what ` +
      `this screen is reading.`,
  };
}
