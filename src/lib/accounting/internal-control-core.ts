/**
 * src/lib/accounting/internal-control-core.ts   (books-28)
 *
 * THE INTERNAL CONTROL REVIEW, AS AN ENGINE.
 *
 * COSO's framework is usually delivered as a binder. This turns the part that
 * applies to Greenway into something that can be answered, stored, and compared
 * against last year - which is the only form in which a small business will ever
 * actually use it.
 *
 * THE ONE DESIGN DECISION THAT MATTERS. COSO does not average. Its own words:
 * when a major deficiency exists with respect to a component or relevant
 * principle, "the organization cannot conclude that it has met the requirements
 * for an effective system of internal control." So `evaluateInternalControlSystem`
 * returns a verdict of effective or not-effective with the blocking answers
 * named - never a score out of seventeen. A percentage would let sixteen good
 * answers bury the one that costs money.
 *
 * THE SECOND DECISION. "Present" and "functioning" are kept as genuinely
 * different states, because that is COSO's test and because the gap between
 * them is where small businesses actually fail. A month-end checklist that
 * exists and was last completed in August is PRESENT and NOT FUNCTIONING, and
 * this engine will say so rather than tick a box.
 *
 * PURE DATA AND PURE FUNCTIONS. No I/O, no clock, no randomness. The assessment
 * date is passed in, never read from the system clock, so a review can be
 * recomputed years later and produce the same answer.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  COSO_COMPONENTS,
  INTERNAL_CONTROL_AUTHORITIES,
} from "@/lib/accounting/internal-control-authorities";

/**
 * COSO's two-part test, kept as three states rather than a boolean.
 *
 * `not_assessed` is deliberately distinct from `absent`. "Nobody looked" and
 * "we looked and it is not there" are different facts, and treating silence as
 * a pass is the single most common way a control review lies to its owner.
 */
export type PrincipleState = "present_and_functioning" | "present_not_functioning" | "absent" | "not_assessed";

export type PrincipleAssessment = {
  /** COSO principle number, 1 to 17. */
  principle: number;
  state: PrincipleState;
  /**
   * Why you gave that answer, in your own words. Required for anything other
   * than `not_assessed`, because an answer with no reason cannot be reviewed
   * next year - and next year's comparison is the whole point.
   */
  reason: string;
  /** Compensating controls, where the honest answer is "we cannot fully do this". */
  compensatingControls?: readonly string[];
};

export type ComponentDescription = {
  readonly component: string;
  readonly principleNumbers: readonly number[];
  readonly plainEnglish: string;
};

/**
 * One of COSO's five components, with the principles beneath it.
 *
 * Returns undefined rather than throwing on an unknown name, so a screen with a
 * stale link degrades to "not found" instead of a crash.
 */
export function describeComponent(component: string): ComponentDescription | undefined {
  const found = COSO_COMPONENTS.find((c) => c.component.toLowerCase() === component.trim().toLowerCase());
  if (!found) return undefined;
  return {
    component: found.component,
    principleNumbers: found.principleNumbers,
    plainEnglish: found.plainEnglish,
  };
}

export type AssessmentProblem = { readonly principle: number; readonly problem: string };

/**
 * Record one answer, refusing the ones that cannot mean anything.
 *
 * REFUSALS ARE THE POINT OF THIS FUNCTION. A principle number outside 1-17 is
 * not a principle. An answer other than `not_assessed` with no reason is not an
 * answer - it is a tick, and a tick cannot be reviewed, defended, or compared
 * against last year. Both come back as a problem rather than an exception so a
 * form can show every fault at once instead of one per submission.
 */
export function assessPrinciple(input: {
  principle: number;
  state: PrincipleState;
  reason?: string;
  compensatingControls?: readonly string[];
}): { readonly assessment?: PrincipleAssessment; readonly problems: readonly AssessmentProblem[] } {
  const problems: AssessmentProblem[] = [];

  if (!Number.isInteger(input.principle) || input.principle < 1 || input.principle > 17) {
    problems.push({
      principle: input.principle,
      problem:
        `There are seventeen COSO principles, numbered 1 to 17. "${input.principle}" is not one of them, ` +
        `so this answer has nothing to attach to.`,
    });
  }

  const reason = (input.reason ?? "").trim();
  if (input.state !== "not_assessed" && reason.length === 0) {
    problems.push({
      principle: input.principle,
      problem:
        "An answer needs a reason. Write one sentence describing what actually happens and who does it - " +
        "if you cannot, the honest answer is that the control is not present, whatever the policy says.",
    });
  }

  // Claiming a control is fully working WHILE listing what compensates for it
  // is a contradiction, and it is the flattering kind. Caught rather than
  // stored, because it would make next year's comparison meaningless.
  if (input.state === "present_and_functioning" && (input.compensatingControls?.length ?? 0) > 0) {
    problems.push({
      principle: input.principle,
      problem:
        "You have marked this principle as present and working, but also listed compensating controls. " +
        "Compensating controls exist because something is NOT fully satisfied. Pick one: either the " +
        "principle is met, or it is partly met and these are what cover the gap.",
    });
  }

  if (problems.length > 0) return { problems };

  return {
    assessment: {
      principle: input.principle,
      state: input.state,
      reason,
      ...(input.compensatingControls && input.compensatingControls.length > 0
        ? { compensatingControls: input.compensatingControls }
        : {}),
    },
    problems: [],
  };
}

export type SystemVerdict = {
  /** COSO's conclusion: effective, or not. Never a percentage. */
  readonly effective: boolean;
  /** Plain-English sentence a non-accountant can act on. */
  readonly conclusion: string;
  /** The principles that blocked an effective conclusion, with why. */
  readonly blockers: readonly { readonly principle: number; readonly why: string }[];
  /** Principles nobody answered. Never silently treated as passes. */
  readonly unanswered: readonly number[];
  /** For the record, not for scoring. */
  readonly counts: Readonly<Record<PrincipleState, number>>;
};

/**
 * The whole-system conclusion.
 *
 * Deliberately NOT a score. See the module header: COSO forbids concluding
 * effectiveness while a major deficiency exists, so one blocker is enough to
 * make the answer "not effective, and here is what to fix".
 */
export function evaluateInternalControlSystem(
  assessments: readonly PrincipleAssessment[],
): SystemVerdict {
  const byPrinciple = new Map<number, PrincipleAssessment>();
  for (const a of assessments) byPrinciple.set(a.principle, a);

  const counts: Record<PrincipleState, number> = {
    present_and_functioning: 0,
    present_not_functioning: 0,
    absent: 0,
    not_assessed: 0,
  };

  const blockers: { principle: number; why: string }[] = [];
  const unanswered: number[] = [];

  for (let n = 1; n <= 17; n += 1) {
    const a = byPrinciple.get(n);
    if (!a || a.state === "not_assessed") {
      counts.not_assessed += 1;
      unanswered.push(n);
      continue;
    }
    counts[a.state] += 1;
    if (a.state === "absent") {
      blockers.push({ principle: n, why: `Principle ${n} is not in place: ${a.reason}` });
    } else if (a.state === "present_not_functioning") {
      // The quiet failure. It exists on paper and does not run, which COSO
      // counts as a deficiency rather than partial credit.
      blockers.push({
        principle: n,
        why: `Principle ${n} exists on paper but is not actually running: ${a.reason}`,
      });
    }
  }

  const effective = blockers.length === 0 && unanswered.length === 0;

  let conclusion: string;
  if (effective) {
    conclusion =
      "All seventeen principles are in place and actually running, so you can reasonably say your controls " +
      "are effective. That is a statement about this year, not a permanent status - the framework expects " +
      "you to ask again.";
  } else if (unanswered.length > 0 && blockers.length === 0) {
    conclusion =
      `Nothing has failed, but ${unanswered.length} of the seventeen principles have not been answered ` +
      `(${unanswered.join(", ")}). An unanswered question is not a pass. Until they are answered there is ` +
      `no conclusion to draw either way.`;
  } else {
    conclusion =
      `Your controls cannot be called effective: ${blockers.length} ` +
      `${blockers.length === 1 ? "principle" : "principles"} ` +
      `(${blockers.map((b) => b.principle).join(", ")}) ${blockers.length === 1 ? "is" : "are"} not working` +
      (unanswered.length > 0 ? `, and ${unanswered.length} more were never answered` : "") +
      `. This is not a score you can average up - COSO says one serious hole stops the conclusion, because ` +
      `the hole is where the loss comes from. Fix or compensate for what is listed here.`;
  }

  return { effective, conclusion, blockers, unanswered, counts };
}

export type SegregationFinding = {
  /** True when one person holds duties that ought to be split. */
  readonly weaknessExists: boolean;
  readonly finding: string;
  /** The duties this person holds that conflict with each other. */
  readonly conflictingDuties: readonly string[];
  readonly compensatingControls: readonly string[];
  readonly authorityIds: readonly string[];
};

/**
 * The finding Michael cannot fix by trying harder, stated plainly.
 *
 * The four duties below are the classic incompatible set: whoever RECORDS
 * transactions should not also hold the ASSET, AUTHORISE the spending, or
 * RECONCILE the result. Greenway has one accounting person, so this will report
 * a weakness - and that is correct. The framework's answer to an unavoidable
 * weakness is documented compensating controls, not silence, which is why the
 * compensating list is part of the finding rather than an afterthought.
 */
export function segregationOfDutiesFinding(input: {
  readonly recordsTransactions: boolean;
  readonly holdsCashOrInventory: boolean;
  readonly authorisesPayments: boolean;
  readonly reconcilesAccounts: boolean;
  readonly compensatingControls?: readonly string[];
}): SegregationFinding {
  const held: string[] = [];
  if (input.recordsTransactions) held.push("records the transactions");
  if (input.holdsCashOrInventory) held.push("holds the cash and product");
  if (input.authorisesPayments) held.push("authorises the payments");
  if (input.reconcilesAccounts) held.push("reconciles the accounts");

  const authorityIds = [
    "green-book-2025-segregation-of-duties",
    "coso-2013-principle-10-control-activities",
    "green-book-2025-documentation-required",
  ];

  if (held.length <= 1) {
    return {
      weaknessExists: false,
      finding:
        "No conflict here: this person holds at most one of the four duties that ought to be kept apart.",
      conflictingDuties: held,
      compensatingControls: [],
      authorityIds,
    };
  }

  const compensating = input.compensatingControls ?? [];
  const finding =
    `One person ${held.join(", ")}. Those duties are supposed to be split between different people, so ` +
    `this is a real weakness and it will not be fixed by being careful. ` +
    (compensating.length > 0
      ? `You have ${compensating.length} compensating ${compensating.length === 1 ? "control" : "controls"} ` +
        `written down, which is the defensible position: the gap is named and something specific covers it.`
      : `NOTHING IS WRITTEN DOWN TO COVER IT. That is the part to fix today - not the staffing, the ` +
        `documentation. A known weakness with compensating controls is defensible; an undocumented one is ` +
        `just a weakness waiting to be found by someone else.`);

  return {
    weaknessExists: true,
    finding,
    conflictingDuties: held,
    compensatingControls: compensating,
    authorityIds,
  };
}

export type CutoverRisk = {
  readonly risk: string;
  readonly whyItMatters: string;
  readonly control: string;
};

/**
 * COSO principle 9 applied to the one change Greenway is actually making.
 *
 * The Sage-to-this-system cutover on 1 January 2027 is the largest control
 * change the business will have, and controls that quietly depended on Sage do
 * not survive a migration on their own. These are stated as risks with the
 * control that answers each, because a risk list with no controls beside it is
 * just anxiety.
 */
export function changeRiskForCutover(): readonly CutoverRisk[] {
  return [
    {
      risk: "Opening balances carried over wrong, and nobody notices until the return is filed.",
      whyItMatters:
        "Every number for the whole year is built on the opening balance. An error here is not one mistake, " +
        "it is a wrong answer to every question you ask for twelve months.",
      control:
        "Reconcile the opening trial balance to Sage's final one, line by line, and keep the comparison. A " +
        "difference you have explained is fine; a difference you have not looked for is not.",
    },
    {
      risk: "A control that existed only because of how Sage behaved is silently gone.",
      whyItMatters:
        "Some checks were never written down - a report someone always glanced at, a total that never came " +
        "out wrong. Those are real controls, and a migration deletes them without any warning message.",
      control:
        "Before the cutover, write down what you actually LOOK at in Sage and when. Anything on that list " +
        "has to exist here on 1 January or it has been lost.",
    },
    {
      risk: "Two systems running at once, and the books disagree about which is true.",
      whyItMatters:
        "A parallel period is the right way to gain confidence, but only if one system is the official " +
        "record. If both are half-official, you have two sets of books and no reconciliation.",
      control:
        "Name the system of record for each day, in writing, before you start. Parallel running is a " +
        "comparison exercise, not a shared responsibility.",
    },
    {
      risk: "Payroll cuts over mid-year and the year-to-date figures do not add up on the W-2.",
      whyItMatters:
        "Wage bases, the Social Security ceiling and the FUTA credit all depend on year-to-date totals. A " +
        "cutover that loses them produces returns that are individually plausible and collectively wrong.",
      control:
        "Cut payroll over at a year boundary - which is why the first payroll here is 1 January 2027 - and " +
        "reconcile each quarter's filed figures against the new system before trusting it.",
    },
  ];
}

/**
 * The verbatim words behind a control question.
 *
 * Reads from the machine-verified registry, so anything this returns has been
 * proven to be an exact substring of COSO's own Executive Summary or the GAO
 * Green Book. Undefined for an unknown id rather than a throw, and never a
 * paraphrase.
 */
export function controlAuthorityFor(authorityId: string): GuidanceAuthority | undefined {
  return INTERNAL_CONTROL_AUTHORITIES.find((a) => a.id === authorityId);
}
