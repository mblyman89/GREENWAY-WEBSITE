/**
 * src/lib/payroll/form-box-ui-core.ts
 *
 * THE LOGIC BEHIND THE FORM / WHY / CHECK SCREEN, WITH NO JSX IN IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS SEPARATE FROM THE COMPONENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything a reviewer would actually want to check about this screen is a
 * decision, not a div: which boxes go in which column, how wide a bar segment
 * is, whether a box has a lesson behind it, what the reconciliation says when
 * two figures disagree. Left inside a component those decisions are only
 * reachable by rendering React, and in practice that means they are never
 * tested at all and the screen is verified by looking at it.
 *
 * So the decisions live here as pure functions over plain data, the component
 * becomes a thin projection of them, and the gates in
 * tests/compliance/form-box-ui-core.test.ts can attack the arithmetic of the
 * bar chart directly. This is the same split the rest of the payroll code
 * already uses — form-941-ui-core.ts, wa-quarterly-ui-core.ts — so it is the
 * established pattern rather than a rival one (rule 25).
 *
 * A second reason, which turned out to matter more: this module must be
 * BROWSER-SAFE. The client-bundle-purity gate exists because a client component
 * once imported a mentor that called readFileSync, and every Vercel build died
 * while CI stayed green for slices on end. Nothing in this file may ever touch
 * node:fs. The verbatim-quote checking that DOES read the corpus off disk lives
 * in the test files, on purpose, where it cannot reach a browser bundle.
 */
import {
  boxIsEmpty,
  boxTone,
  formatBoxValue,
  lessonFor,
  splitMoney,
  type BoxLesson,
  type FormBox,
  type MoneySplit,
} from "@/lib/payroll/form-box-core";
import type { ScreenTone } from "@/lib/ui/screen-tone-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  A BOX, READY TO DRAW
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One row of the Form tab, with every presentation decision already made.
 *
 * `hasLesson` is the field that earns this type. Michael was explicit: "I want
 * to be able to see the form, and click a box to have it teach me all there is
 * to know about that box." A box that looks clickable and teaches nothing is
 * worse than a box that plainly is not clickable, because the first one costs a
 * click and some trust. So whether a lesson exists is computed ONCE, here, and
 * both the affordance and the click handler read the same answer. They cannot
 * disagree.
 */
export type RenderableBox = {
  readonly box: FormBox;
  readonly tone: ScreenTone;
  /** The value as it should be printed. "$1,404.88", "3,558 hours", "6". */
  readonly printed: string;
  /** True when there is no figure at all. */
  readonly empty: boolean;
  /**
   * True when the box is empty AND that is correct, with a reason to show.
   *
   * Kept apart from `empty` because the two mean opposite things to a reader:
   * an empty box with no reason is something to go and investigate, and an
   * empty box with a reason is something to stop worrying about.
   */
  readonly correctlyBlank: boolean;
  /** True when a lesson exists for this exact (formId, box) pair. */
  readonly hasLesson: boolean;
};

/**
 * Prepare every box of a form for drawing.
 *
 * The lesson lookup is keyed on the box's OWN formId, not on a form id passed
 * in alongside it. Passing one in separately would let a caller hand over the
 * boxes of one form and the id of another, and the failure mode is silent: the
 * lessons simply stop being found and the screen renders a form where nothing
 * is clickable. Reading `b.formId` makes that mistake impossible to express.
 */
export function renderableBoxes(
  boxes: readonly FormBox[],
  lessons: readonly BoxLesson[],
): readonly RenderableBox[] {
  return boxes.map((b) => {
    const empty = boxIsEmpty(b);
    return {
      box: b,
      tone: boxTone(b),
      printed: formatBoxValue(b),
      empty,
      correctlyBlank: empty && b.blankOnPurpose !== null,
      // `lessonFor` returns UNDEFINED when there is no lesson, not null. An
      // earlier draft compared against null, which is never equal to undefined,
      // so hasLesson was true for every box and the whole form looked clickable
      // while most of it taught nothing. The self-test below caught it, and the
      // comparison is written against the documented sentinel.
      hasLesson: lessonFor(lessons, b.formId, b.box) !== undefined,
    };
  });
}

/**
 * How many boxes on this form have nothing to teach.
 *
 * Exists so a gate can hold coverage as a NUMBER rather than as an intention.
 * "Every box should have a lesson eventually" is not a testable statement;
 * "this form has 3 untaught boxes" is, and it can be asserted to decrease.
 */
export function untaughtBoxes(rendered: readonly RenderableBox[]): readonly string[] {
  return rendered.filter((r) => !r.hasLesson).map((r) => r.box.box);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE WHOSE-MONEY BAR
 *
 * Michael: "Visualizing data is very important to me and I want to make sure I
 * fully understand all that is going on using all available techniques."
 *
 * This is the one chart on the screen, and it answers one question: of the
 * money on this form, how much was Greenway's and how much was the employees'?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One segment of the split bar.
 *
 * `widthPct` is a rounded percentage for a CSS width and NOTHING else. It is
 * deliberately a different field from the milli-percent in `MoneySplit`, so
 * that a number rounded for the convenience of a stylesheet can never be
 * mistaken for the figure a reader is being taught. That confusion is how a
 * screen ends up quoting "71%" at somebody as though it were the statutory
 * share.
 */
export type SplitSegment = {
  readonly label: string;
  readonly cents: number;
  readonly widthPct: number;
  readonly tone: ScreenTone;
  /** The exact share, for the caption. Null when the total is zero. */
  readonly exactMilliPct: number | null;
};

export type SplitBar = {
  readonly split: MoneySplit;
  readonly segments: readonly SplitSegment[];
  /** True when there is nothing to draw at all. */
  readonly empty: boolean;
};

/**
 * Build the bar.
 *
 * ═══ WHY THE SEGMENTS ARE FORCED TO ADD TO EXACTLY 100 ═══
 *
 * Rounding two shares independently can produce 29% + 71% = 100%, or 33% + 33%
 * + 33% = 99%, or in the worst case 100% + 1% = 101% — and a bar whose segments
 * total 101% wraps or overflows its container, which looks like a rendering bug
 * and quietly discredits every honest number on the page.
 *
 * So the FIRST segment is rounded and the LAST takes the remainder. The last
 * segment absorbs at most one percentage point of error, the bar always totals
 * exactly 100, and the exact shares are carried separately in `exactMilliPct`
 * for anything a reader is meant to read. The compromise is confined to the
 * geometry.
 */
export function splitBar(boxes: readonly FormBox[]): SplitBar {
  const split = splitMoney(boxes);
  if (split.totalCents === 0) {
    return { split, segments: [], empty: true };
  }
  const employerPct = Math.round((split.employerCents * 100) / split.totalCents);
  return {
    split,
    segments: [
      {
        label: "Greenway's own cost",
        cents: split.employerCents,
        widthPct: employerPct,
        tone: "gold",
        exactMilliPct: split.employerMilliPct,
      },
      {
        label: "Your employees' money",
        cents: split.employeeCents,
        // The remainder, never a second independent rounding.
        widthPct: 100 - employerPct,
        tone: "green",
        exactMilliPct: split.employeeMilliPct,
      },
    ],
    empty: false,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE CHECK TAB
 *
 * The roadmap calls this tab "the reconciliations". A reconciliation is two
 * figures that must agree, plus the plain-English consequence when they do not.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CheckOutcome = "agrees" | "disagrees" | "cannot_check";

export type CheckRow = {
  readonly title: string;
  /** What is being compared, in words, before any numbers appear. */
  readonly question: string;
  readonly leftLabel: string;
  readonly leftCents: number | null;
  readonly rightLabel: string;
  readonly rightCents: number | null;
  /** How far apart they are allowed to be, and why. Usually zero. */
  readonly toleranceCents: number;
  readonly outcome: CheckOutcome;
  readonly differenceCents: number | null;
  /** What it MEANS. Never merely "match" or "mismatch". */
  readonly meaning: string;
  readonly tone: ScreenTone;
};

/**
 * Compare two figures and say what the answer means.
 *
 * ═══ WHY "cannot_check" IS A FIRST-CLASS OUTCOME ═══
 *
 * Because the alternative is a green tick that means nothing. If a figure has
 * not been supplied — no deposit history, no prior quarter to compare against —
 * then treating the missing side as zero makes the two sides differ by the
 * whole amount and reports a catastrophe, while skipping the row entirely tells
 * Michael a check passed that was never performed. Both are worse than saying
 * plainly that the comparison could not be made and naming what is missing.
 * Rule 62d, in the one place where inventing a default is most tempting.
 */
export function checkRow(args: {
  title: string;
  question: string;
  leftLabel: string;
  leftCents: number | null;
  rightLabel: string;
  rightCents: number | null;
  toleranceCents?: number;
  agreesMeaning: string;
  disagreesMeaning: string;
  missingMeaning: string;
}): CheckRow {
  const tolerance = args.toleranceCents ?? 0;
  if (args.leftCents === null || args.rightCents === null) {
    return {
      title: args.title,
      question: args.question,
      leftLabel: args.leftLabel,
      leftCents: args.leftCents,
      rightLabel: args.rightLabel,
      rightCents: args.rightCents,
      toleranceCents: tolerance,
      outcome: "cannot_check",
      differenceCents: null,
      meaning: args.missingMeaning,
      // Orange, not danger: nothing is known to be wrong. Something is unknown,
      // which is a different state and must not look like a failure.
      tone: "orange",
    };
  }
  const difference = args.leftCents - args.rightCents;
  const agrees = Math.abs(difference) <= tolerance;
  return {
    title: args.title,
    question: args.question,
    leftLabel: args.leftLabel,
    leftCents: args.leftCents,
    rightLabel: args.rightLabel,
    rightCents: args.rightCents,
    toleranceCents: tolerance,
    outcome: agrees ? "agrees" : "disagrees",
    differenceCents: difference,
    meaning: agrees ? args.agreesMeaning : args.disagreesMeaning,
    tone: agrees ? "green" : "danger",
  };
}

/**
 * The one-line summary above the Check tab.
 *
 * Counts rather than a bare "all good", because "3 of 4 checks agree, 1 could
 * not be checked" is the true state and "all good" is not.
 */
export function checkSummary(rows: readonly CheckRow[]): string {
  if (rows.length === 0) {
    return "There is nothing to reconcile on this form yet.";
  }
  const agrees = rows.filter((r) => r.outcome === "agrees").length;
  const disagrees = rows.filter((r) => r.outcome === "disagrees").length;
  const unknown = rows.filter((r) => r.outcome === "cannot_check").length;
  const parts: string[] = [];
  if (agrees > 0) parts.push(`${agrees} agree${agrees === 1 ? "s" : ""}`);
  if (disagrees > 0) parts.push(`${disagrees} DISAGREE${disagrees === 1 ? "S" : ""}`);
  if (unknown > 0) parts.push(`${unknown} could not be checked`);
  const lead = `${rows.length} check${rows.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
  if (disagrees > 0) {
    return `${lead} Do not file until the disagreement is understood — a figure that does not tie is a figure one of the two sides has wrong.`;
  }
  if (unknown > 0) {
    return `${lead} An unchecked figure is not a passed check; supply what is missing before you rely on it.`;
  }
  return `${lead} Every figure on this form ties to the record it came from.`;
}

/**
 * The worst tone across the rows, for the tab's own badge.
 *
 * Written as an explicit ladder rather than with a max over severities, because
 * the ONE thing this must never do is let a green tick outrank a disagreement.
 */
export function checkTone(rows: readonly CheckRow[]): ScreenTone {
  if (rows.some((r) => r.outcome === "disagrees")) return "danger";
  if (rows.some((r) => r.outcome === "cannot_check")) return "orange";
  if (rows.length === 0) return "neutral";
  return "green";
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`form-box-ui-core self-test failed: ${msg}`);
}

function fakeBox(over: Partial<FormBox>): FormBox {
  return {
    formId: "f",
    box: "1",
    caption: "c",
    measure: "money",
    amountCents: 0,
    quantity: null,
    whose: "employer_cost",
    derivation: "d",
    blankOnPurpose: null,
    notComputedYet: null,
    emphasise: false,
    ...over,
  };
}

/**
 * The bar's segments must total exactly 100, on the awkward numbers.
 *
 * 29.403 / 70.597 is Greenway's real L&I split and rounds to 29 / 71. A naive
 * pair of independent roundings gives 29 + 71 = 100 here but 33 + 67 vs 33 + 33
 * elsewhere, so the property is checked across a spread of ratios rather than
 * on the one case that happens to work.
 */
export function assertBarAlwaysTotalsOneHundred(): void {
  // ═══ WHY THIS LIST IS NOT HAND-PICKED ═══
  //
  // The first version of this check used ten ratios chosen by eye, and a
  // mutation that rounded BOTH segments independently passed every one of
  // them. The reason is arithmetic, not luck: two shares of one total have
  // fractional parts that sum to 0 or to 1, so for both to round UP both must
  // be exactly .5 (Math.round breaks ties upward). None of the ten hand-picked
  // ratios put a share on a .5 boundary, so none of them could ever have
  // caught the bug they were written to catch.
  //
  // The adversarial cases are therefore DERIVED from the failure mode rather
  // than guessed at: eighths and fortieths land on 12.5% and 2.5%, both tie
  // upward, and independent rounding yields 13 + 88 = 101. If this ever stops
  // finding them the assertion at the foot of the loop says so.
  const adversarial: [number, number][] = [];
  for (let total = 2; total <= 120; total += 1) {
    for (let employee = 0; employee <= total; employee += 1) {
      const employer = total - employee;
      const naive =
        Math.round((employer * 100) / total) + Math.round((employee * 100) / total);
      if (naive !== 100) adversarial.push([employee, employer]);
    }
  }
  assert(
    adversarial.length > 0,
    "no adversarial ratio was derived; this check can no longer detect independent rounding",
  );

  const ratios: readonly [number, number][] = [
    [58_511, 140_488], // the real L&I split, 29.403 / 70.597
    [1, 7], // 12.5% / 87.5% -- both tie upward, the classic overflow
    [7, 1],
    [1, 39], // 2.5% / 97.5%
    [1, 2],
    [1, 3],
    [2, 3],
    [1, 299],
    [999, 1],
    [1, 1],
    [0, 100],
    [100, 0],
    [7, 993],
    ...adversarial,
  ];
  for (const [employee, employer] of ratios) {
    const bar = splitBar([
      fakeBox({ box: "ee", amountCents: employee, whose: "employee_money" }),
      fakeBox({ box: "er", amountCents: employer, whose: "employer_cost" }),
    ]);
    const total = bar.segments.reduce((n, s) => n + s.widthPct, 0);
    assert(total === 100, `segments total ${total} for ${employee}/${employer}, not 100`);
    for (const s of bar.segments) {
      assert(s.widthPct >= 0, `negative width ${s.widthPct}`);
      assert(s.widthPct <= 100, `width over 100: ${s.widthPct}`);
    }
  }
}

/**
 * A zero-total form draws NO bar, rather than a bar of two zero-width segments.
 *
 * Two zero-width segments render as an empty grey strip that looks like a bar
 * that failed to load. The absence has to be explicit.
 */
export function assertEmptyFormDrawsNoBar(): void {
  const bar = splitBar([fakeBox({ amountCents: 0 })]);
  assert(bar.empty, "a form with no money must report empty");
  assert(bar.segments.length === 0, "an empty bar must have no segments");
}

/**
 * The bar must never quote the rounded CSS width as the real share.
 */
export function assertExactShareIsCarriedSeparately(): void {
  const bar = splitBar([
    fakeBox({ box: "ee", amountCents: 58_511, whose: "employee_money" }),
    fakeBox({ box: "er", amountCents: 140_488, whose: "employer_cost" }),
  ]);
  const employee = bar.segments.find((s) => s.label.includes("employees"));
  assert(employee !== undefined, "no employee segment");
  assert(employee!.widthPct === 29, `css width should be 29, got ${employee!.widthPct}`);
  // The teachable figure keeps all three decimals.
  assert(
    employee!.exactMilliPct === 29_403,
    `exact share should be 29403 milli-percent, got ${employee!.exactMilliPct}`,
  );

  // BOTH segments, not just the one. A mutation that replaced the employer's
  // exact share with its rounded CSS width survived this check because only
  // the employee side was ever asserted -- the caption would then have read
  // "71% is Greenway's own cost" when the true figure is 70.597%, a number
  // Michael is meant to be able to trust to three decimals.
  const employer = bar.segments.find((s) => s.label.includes("Greenway"));
  assert(employer !== undefined, "no employer segment");
  assert(employer!.widthPct === 71, `css width should be 71, got ${employer!.widthPct}`);
  assert(
    employer!.exactMilliPct === 70_597,
    `exact share should be 70597 milli-percent, got ${employer!.exactMilliPct}`,
  );
  // The whole point: the drawn width and the quoted share are different
  // numbers, and neither may be derived from the other.
  assert(
    employer!.exactMilliPct !== employer!.widthPct * 1000,
    "the exact share must not be the rounded width in disguise",
  );
  assert(
    employee!.exactMilliPct !== employee!.widthPct * 1000,
    "the exact share must not be the rounded width in disguise",
  );
  // And the two exact shares must still describe one whole.
  assert(
    employer!.exactMilliPct! + employee!.exactMilliPct! === 100_000,
    "the two exact shares must total exactly 100.000%",
  );
}

/**
 * A missing figure must NOT be reported as a passed check.
 */
export function assertMissingFigureIsNotAPass(): void {
  const row = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 100,
    rightLabel: "r",
    rightCents: null,
    agreesMeaning: "agrees",
    disagreesMeaning: "disagrees",
    missingMeaning: "the deposit history has not been supplied",
  });
  assert(row.outcome === "cannot_check", `outcome was ${row.outcome}`);
  assert(row.differenceCents === null, "an unknown comparison has no difference");
  assert(row.tone === "orange", "unknown must not look like a failure, nor like a pass");
  assert(row.meaning.includes("not been supplied"), "the missing side must be named");

  // And the other direction (rule 34): a real comparison must actually compare.
  const real = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 100,
    rightLabel: "r",
    rightCents: 100,
    agreesMeaning: "agrees",
    disagreesMeaning: "disagrees",
    missingMeaning: "m",
  });
  assert(real.outcome === "agrees", "identical figures must agree");
  assert(real.differenceCents === 0, "identical figures differ by zero");
}

/**
 * One disagreement must dominate any number of passes.
 */
export function assertOneDisagreementDominates(): void {
  const pass = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 1,
    rightLabel: "r",
    rightCents: 1,
    agreesMeaning: "a",
    disagreesMeaning: "d",
    missingMeaning: "m",
  });
  const fail = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 1,
    rightLabel: "r",
    rightCents: 2,
    agreesMeaning: "a",
    disagreesMeaning: "d",
    missingMeaning: "m",
  });
  assert(checkTone([pass, pass, pass, fail]) === "danger", "a disagreement must dominate");
  assert(checkSummary([pass, pass, fail]).includes("Do not file"), "the summary must say so");
  assert(checkTone([pass, pass]) === "green", "all passes must read green");
  assert(checkTone([]) === "neutral", "no checks is neutral, not green");

  // The ROW's own colour, not just the summary's. A mutation that painted
  // every row green survived an earlier campaign because only the
  // cannot_check tone was ever asserted -- meaning a reconciliation that
  // FAILED would have shown Michael a green tick and told him to file.
  assert(fail.tone === "danger", "a disagreeing row must be danger, never green");
  assert(pass.tone === "green", "an agreeing row must be green");
  assert(fail.meaning === "d", "a disagreeing row must carry the disagrees wording");
  assert(pass.meaning === "a", "an agreeing row must carry the agrees wording");
}

/**
 * A tolerance must be honoured, and must not swallow a real error.
 */
export function assertToleranceIsBounded(): void {
  const within = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 100_007,
    rightLabel: "r",
    rightCents: 100_000,
    toleranceCents: 7,
    agreesMeaning: "a",
    disagreesMeaning: "d",
    missingMeaning: "m",
  });
  assert(within.outcome === "agrees", "7 cents inside a 7-cent tolerance must agree");
  const beyond = checkRow({
    title: "t",
    question: "q",
    leftLabel: "l",
    leftCents: 100_008,
    rightLabel: "r",
    rightCents: 100_000,
    toleranceCents: 7,
    agreesMeaning: "a",
    disagreesMeaning: "d",
    missingMeaning: "m",
  });
  assert(beyond.outcome === "disagrees", "8 cents outside a 7-cent tolerance must disagree");
  assert(beyond.differenceCents === 8, "the difference must be reported exactly");
}

/**
 * A box's clickability must equal whether it really has a lesson.
 */
export function assertClickabilityMatchesTeachability(): void {
  const boxes = [fakeBox({ box: "1" }), fakeBox({ box: "2" })];
  const lessons: BoxLesson[] = [
    {
      formId: "f",
      box: "1",
      headline: "h",
      plainEnglish: "p",
      whereItComesFrom: "w",
      howToReadIt: "h",
      commonMistake: null,
      whatToDo: "w",
      examples: [],
      quotes: [],
      tiesTo: [],
    },
  ];
  const rendered = renderableBoxes(boxes, lessons);
  assert(rendered[0].hasLesson, "box 1 has a lesson and must say so");
  assert(!rendered[1].hasLesson, "box 2 has none and must not pretend");
  assert(untaughtBoxes(rendered).join(",") === "2", "the untaught list must name box 2");

  // A lesson for a DIFFERENT form must not satisfy this form's box.
  const wrongForm = renderableBoxes(boxes, [{ ...lessons[0], formId: "other" }]);
  assert(!wrongForm[0].hasLesson, "a lesson from another form must not be found");
}

/**
 * A correctly-blank box is distinguished from a merely empty one.
 */
export function assertCorrectlyBlankIsNotJustEmpty(): void {
  const rendered = renderableBoxes(
    [
      fakeBox({ box: "17", amountCents: 0, blankOnPurpose: "Washington has no income tax." }),
      fakeBox({ box: "13", amountCents: 0, blankOnPurpose: null }),
      fakeBox({ box: "12", amountCents: 500, blankOnPurpose: null }),
    ],
    [],
  );
  assert(rendered[0].empty && rendered[0].correctlyBlank, "box 17 is blank on purpose");
  assert(rendered[1].empty && !rendered[1].correctlyBlank, "box 13 is empty and unexplained");
  assert(!rendered[2].empty && !rendered[2].correctlyBlank, "box 12 has a figure");
}

export function __runFormBoxUiCoreTests(): void {
  assertBarAlwaysTotalsOneHundred();
  assertEmptyFormDrawsNoBar();
  assertExactShareIsCarriedSeparately();
  assertMissingFigureIsNotAPass();
  assertOneDisagreementDominates();
  assertToleranceIsBounded();
  assertClickabilityMatchesTeachability();
  assertCorrectlyBlankIsNotJustEmpty();
}
