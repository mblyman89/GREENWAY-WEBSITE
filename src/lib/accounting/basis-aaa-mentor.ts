/**
 * src/lib/accounting/basis-aaa-mentor.ts   (books-19)
 *
 * THE CPA WHO SITS BESIDE THE BASIS SCHEDULE.
 *
 * Standing rule 26: every engine ships with a mentor layer, and every exported
 * function is taught. This slice needs it more than most. Basis and AAA are the
 * part of subchapter S that people with accounting degrees still get wrong,
 * because the rules are simple individually and interact badly.
 *
 * A coverage gate at the bottom reads the core module FROM DISK and fails if
 * any exported function ships without a lesson. Standing rule 39: it takes an
 * optional path so a test can point it at a file it controls and prove the gate
 * actually fires, and it refuses to pass when it reads nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type MentorLesson = {
  /** The exported function this lesson teaches. */
  fn: string;
  /** What it does, in one breath, with no jargon. */
  plainEnglish: string;
  /** Why it exists at all. */
  whyItExists: string;
  /** The mistake a competent person actually makes here. */
  theTrap: string;
  /** What a CPA would do in Michael's chair. */
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const BASIS_AAA_LESSONS: readonly MentorLesson[] = [
  {
    fn: "assertBasisCents",
    plainEnglish:
      "Refuses to let a fraction of a cent into any basis calculation, and refuses numbers so large " +
      "that ordinary arithmetic stops being exact.",
    whyItExists:
      "Basis is a balance that rolls forward forever. A half-cent introduced in 2026 is still there " +
      "in 2036, having quietly compounded through ten years of schedules, and by then nobody can " +
      "tell whether the ending balance is right.",
    theTrap:
      "Allocating income three ways by multiplying by 0.85, 0.10 and 0.05. Those are floats, they do " +
      "not sum to one, and the result will be off by a cent in a way that looks like a rounding " +
      "difference and is actually a permanent error in someone's basis.",
    whatIWouldDo:
      "Treat any fractional cent as a bug upstream, not something to round away here. Find the " +
      "division that produced it.",
    authorityIds: [],
  },
  {
    fn: "validateBasisInput",
    plainEnglish:
      "Checks every fact the year's calculation depends on before doing any arithmetic, and reports " +
      "all the problems at once instead of one at a time.",
    whyItExists:
      "Basis arithmetic is fast and confident. It will happily produce a beautiful schedule from " +
      "nonsense inputs, and the schedule will not look wrong. The only defence is refusing to start.",
    theTrap:
      "Treating 'unknown' as 'no'. Whether the company has accumulated earnings and profits, and " +
      "whether a \u00a71.1367-1(g) election was ever filed, are facts about documents. Defaulting either " +
      "one to the common answer is guessing, and it changes the tax result.",
    whatIWouldDo:
      "When this refuses, do not look for an override. Go and find the document. Every refusal here " +
      "names exactly which one.",
    authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA", "REG_1_1367_1_G_ELECTIVE_ORDERING"],
  },
  {
    fn: "validateShareholders",
    plainEnglish:
      "Checks the shareholder roster: no duplicates, no blank names, ownership totalling exactly " +
      "100%, and no impossible carry-in balances such as negative basis.",
    whyItExists:
      "Everything in subchapter S is allocated strictly pro rata, so if the percentages do not total " +
      "100 then every single number downstream is wrong for every single person \u2014 including the " +
      "K-1s that get filed.",
    theTrap:
      "The same person entered twice, usually as 'Michael Lyman' and 'Mike Lyman'. Their basis is " +
      "then split in half, each half hits the \u00a71366(d)(1) ceiling early, and losses get suspended " +
      "that should have been deductible. The totals still foot, so nothing looks wrong.",
    whatIWouldDo:
      "Fix the roster once and never type a name freehand again. It should come from one list.",
    authorityIds: ["IRC_1366_D_LOSS_LIMITATION", "IRC_1361_B_1_D_ONE_CLASS"],
  },
  {
    fn: "allocateProRata",
    plainEnglish:
      "Splits an amount between shareholders by ownership so that the pieces add back to exactly " +
      "the original amount, with no cent invented and none lost.",
    whyItExists:
      "$100.00 split 85/5/5/5 is fine. $100.01 is not: the four shares are $85.01, $5.00, $5.00 and " +
      "$5.00 only if you decide deliberately who gets the leftover cent. Left to naive rounding you " +
      "get $100.00 or $100.04, and the difference has to go somewhere \u2014 usually into a plug.",
    theTrap:
      "Assuming a loss splits differently from a profit. It does not; the same percentages apply. " +
      "But code that allocates by flooring will drift in the opposite direction on negatives, so " +
      "the loss year and the profit year stop being mirror images and the multi-year schedule " +
      "slowly loses money.",
    whatIWouldDo:
      "Never allocate by hand in a spreadsheet. If you must check it, check that the three pieces " +
      "add to the total \u2014 that single test catches almost every allocation bug.",
    authorityIds: ["IRC_1366_D_LOSS_LIMITATION"],
  },
  {
    fn: "computeStockBasisSchedule",
    plainEnglish:
      "Runs one shareholder's year through the four prescribed steps \u2014 income, then distributions, " +
      "then nondeductible expenses, then losses \u2014 and reports the balance after each one.",
    whyItExists:
      "This is the calculation that decides whether the money you took out of the company was " +
      "tax-free or a capital gain, and how much of the year's loss you are actually allowed to " +
      "deduct. It is the single most consequential arithmetic in an S corporation.",
    theTrap:
      "Doing the four steps in the wrong order, which almost always means netting everything " +
      "together the way a spreadsheet naturally does. \u00a71.1367-1(f) puts distributions SECOND, ahead " +
      "of your \u00a7280E disallowances and ahead of your losses. Net them and you reduce basis before " +
      "measuring the distribution against it, which manufactures a capital gain that does not exist.",
    whatIWouldDo:
      "Read the schedule down the column, not across. If the distribution line shows a capital gain, " +
      "check first that this year's income was added in before it \u2014 that is the mistake nine times " +
      "in ten.",
    authorityIds: [
      "REG_1_1367_1_F_ORDERING",
      "IRC_1367_STOCK_BASIS_ADJUSTMENTS",
      "IRC_1368_DISTRIBUTIONS_AAA",
      "IRC_1366_D_LOSS_LIMITATION",
      "IRC_1366_D_2_CARRYOVER",
      "REG_1_1367_2_B_1_DEBT_REDUCTION",
      "REG_1_1367_2_C_1_DEBT_RESTORATION",
      "REG_1_1367_1_C_2_NONCAPITAL_NONDEDUCTIBLE",
    ],
  },
  {
    fn: "computeAaaSchedule",
    plainEnglish:
      "Rolls the company's accumulated adjustments account forward for the year, in the AAA's own " +
      "prescribed order, which is not the same order used for basis.",
    whyItExists:
      "AAA is the running total of income the company has already been taxed on and not yet " +
      "distributed. It belongs to the company, not to any shareholder, and it is what Schedule M-2 " +
      "of the 1120-S reports \u2014 the form this system builds next.",
    theTrap:
      "Assuming AAA and basis move together. They do not, and for a cannabis retailer they will " +
      "diverge badly. Stock basis stops at zero; AAA keeps falling. Tax-exempt income raises basis " +
      "but not AAA. AAA is reduced by the whole of a loss even the part nobody could deduct. If " +
      "your AAA and your total basis agree at year end, be suspicious rather than reassured.",
    whatIWouldDo:
      "Keep them on separate schedules and never reconcile one to the other. They are two different " +
      "histories of the same year and they are supposed to disagree.",
    authorityIds: [
      "REG_1_1368_2_A_5_AAA_ORDERING",
      "REG_1_1368_2_A_1_AAA_NOT_APPORTIONED",
      "REG_1_1368_2_A_3_II_BELOW_ZERO",
      "REG_1_1368_2_A_3_III_DISTRIBUTIONS_NOT_BELOW_ZERO",
      "IRC_1368_DISTRIBUTIONS_AAA",
    ],
  },
  {
    fn: "assessProportionality",
    plainEnglish:
      "Compares what each shareholder was actually paid to what their ownership percentage would " +
      "have given them, and explains what any difference does and does not mean.",
    whyItExists:
      "At Greenway what a shareholder is ALLOCATED and what a shareholder is actually PAID are not " +
      "the same number for every holder. That is a real, deliberate, ongoing pattern, and it " +
      "deserves a straight answer rather than either silence or an alarm. Which holders are paid " +
      "is an owner fact the engine is given, never one it assumes.",
    theTrap:
      "Believing that unequal distributions terminate the S election. They generally do not \u2014 the " +
      "test in \u00a71.1361-1(l)(1) is about the RIGHTS in your governing documents, and the regulation's " +
      "own example has one shareholder paid a year later than another with no consequence. The " +
      "opposite trap is worse though: concluding it therefore does not matter. It does. The gap " +
      "still has to be characterised as a loan, compensation, or a gift.",
    whatIWouldDo:
      "Answer the two questions separately. Read the operating agreement once and confirm identical " +
      "distribution rights \u2014 that closes the S-election question permanently. Then decide, each " +
      "year, what the unpaid 10% actually is, and book it. An amount nobody has characterised is " +
      "the only genuinely dangerous outcome.",
    authorityIds: [
      "IRC_1361_B_1_D_ONE_CLASS",
      "REG_1_1361_1_L_1_IDENTICAL_RIGHTS",
      "REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS",
    ],
  },
  {
    fn: "formatCents",
    plainEnglish: "Turns a whole number of cents into a dollar figure for reading, never for maths.",
    whyItExists:
      "Every explanation this engine writes has to name real amounts, and a message saying " +
      "'received 1250000 more than pro rata' is not a sentence anybody can act on.",
    theTrap:
      "Formatting early and then computing on the formatted value. Once a number is a string with a " +
      "dollar sign and a comma in it, parsing it back is lossy and the cents are gone.",
    whatIWouldDo:
      "Keep cents everywhere and format only at the last moment, at the edge of the screen or the " +
      "report.",
    authorityIds: [],
  },
  {
    fn: "computeBasisAndAaa",
    plainEnglish:
      "Runs the whole year: checks the facts, allocates the income and expenses, produces each " +
      "shareholder's basis schedule and the company's AAA schedule, and flags the proportionality " +
      "question.",
    whyItExists:
      "These pieces are only correct together. The AAA needs the total distributions that the " +
      "individual schedules consume; the proportionality finding needs the amounts actually paid. " +
      "Calling them separately in the wrong order is how the pieces stop agreeing.",
    theTrap:
      "Reaching past this into the individual functions to 'just get the basis'. The validation " +
      "lives here, so bypassing it means computing a beautiful schedule from unchecked facts \u2014 " +
      "exactly the failure mode standing rule 14 exists to prevent.",
    whatIWouldDo:
      "Call this one function per year, keep its output, and feed it to the next year with " +
      "carryForward. Never assemble a year by hand.",
    authorityIds: ["REG_1_1367_1_F_ORDERING", "REG_1_1368_2_A_5_AAA_ORDERING"],
  },
  {
    fn: "carryForward",
    plainEnglish:
      "Takes one completed year and produces the opening balances for the next, so nothing has to " +
      "be retyped.",
    whyItExists:
      "Basis is a chain. Every year's opening balance is last year's closing balance, and the chain " +
      "runs for as long as the company exists. One mistyped opening balance corrupts every year " +
      "after it, and the error is invisible because each individual year still adds up.",
    theTrap:
      "Forgetting the things that are not the main number. Suspended losses under \u00a71366(d)(2)(A) " +
      "carry forward indefinitely and belong to a specific person; debt basis carries too. Both are " +
      "easy to drop when copying figures across, and dropping a suspended loss means permanently " +
      "losing a deduction you already paid for.",
    whatIWouldDo:
      "Never open a new year by typing numbers. Use this, and if a figure looks wrong, fix the prior " +
      "year and carry forward again rather than adjusting the new year's opening balance.",
    authorityIds: ["IRC_1366_D_2_CARRYOVER", "REG_1_1367_2_C_1_DEBT_RESTORATION"],
  },
  {
    fn: "validateCarryForwardFacts",
    plainEnglish:
      "Checks the names you use for next year's contributions, distributions and loans against the " +
      "actual shareholder roster, and refuses anything it does not recognise.",
    whyItExists:
      "Next year's figures are handed over keyed by name. Looking up a name that does not exist " +
      "gives back nothing, and nothing quietly becomes zero. So a single mistyped letter would " +
      "record that a shareholder took no distribution at all: his basis would be overstated, the " +
      "AAA would be overstated, and every following year would inherit the error. Nothing on the " +
      "return would look odd, because zero is a perfectly ordinary amount for somebody to receive.",
    theTrap:
      "Assuming you would notice. You would not. This is the exact shape of error that survives " +
      "review, because the report shows a complete roster with plausible numbers and the columns " +
      "still add up \u2014 the money does not go missing, it just gets attributed to the wrong year.",
    whatIWouldDo:
      "Let it refuse and fix the spelling. If a genuinely new shareholder has appeared, stop and " +
      "handle that properly: new ownership percentages have to be entered, and a mid-year change " +
      "means the allocation is no longer a simple annual split.",
    authorityIds: ["IRC_1366_D_2_CARRYOVER", "IRC_1361_B_1_D_ONE_CLASS"],
  },
  {
    fn: "setAllocationFaultForTesting",
    plainEnglish:
      "A switch that deliberately breaks the pro-rata allocator so the safety net underneath it " +
      "can be seen catching something. It is off in every real code path and exists only so the " +
      "tests can prove the net is really there.",
    whyItExists:
      "The allocator ends with a check that the pieces add back to the whole. That check can only " +
      "trigger if the allocator above it is already wrong, so no ordinary figures will ever reach " +
      "it. When the engine was deliberately mutated to delete that check entirely, every test " +
      "still passed \u2014 which meant the protection was completely unverified. A safety net that has " +
      "never been seen to catch anything is not known to work.",
    theTrap:
      "Deciding an unreachable check does not need testing, and then quietly deleting it during a " +
      "later tidy-up because nothing fails. That is how the cent-level guarantees that make these " +
      "schedules trustworthy get removed by accident, years later, by someone acting reasonably.",
    whatIWouldDo:
      "Never call this outside a test, and always switch it back off in a finally block. If you " +
      "ever see the allocation error in real use, stop: it means the split logic itself is broken " +
      "and no number produced by that run can be relied on.",
    authorityIds: ["IRC_1366_D_LOSS_LIMITATION", "REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
  },
];

export function findBasisLesson(fn: string): MentorLesson | undefined {
  return BASIS_AAA_LESSONS.find((l) => l.fn === fn);
}

export function taughtBasisFunctionNames(): readonly string[] {
  return BASIS_AAA_LESSONS.map((l) => l.fn);
}

/**
 * Read the exported function names out of the core module ON DISK.
 *
 * `sourcePath` exists purely so a test can aim this at a fixture and prove the
 * gate below actually fires (standing rule 39). Production callers pass nothing.
 */
export function exportedBasisFunctionNames(sourcePath?: string): readonly string[] {
  const path = sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "basis-aaa-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

/**
 * Fail loudly if any exported function shipped without a lesson.
 *
 * Two guards, not one. The obvious guard catches an untaught function. The
 * less obvious one catches a gate that has stopped reading anything at all \u2014
 * because in books-18 a mutation that disabled the coverage check survived the
 * entire suite, and the reason was a self-check that re-implemented the gate
 * instead of calling it. Standing rules 16 and 39.
 */
export function assertEveryBasisFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtBasisFunctionNames());
  const exported = exportedBasisFunctionNames(sourcePath);

  if (exported.length === 0) {
    throw new Error(
      "BASIS MENTOR COVERAGE GATE BROKEN: read no exported functions from the core module. " +
        "A coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  const untaught = exported.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `BASIS MENTOR COVERAGE GAP: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        `Standing rule 26 requires every exported function to be taught before it ships.`,
    );
  }
}

/**
 * Every lesson must be complete, not merely present.
 *
 * A lesson with an empty `theTrap` satisfies a naive coverage count while
 * teaching nothing, which is the mentor-layer equivalent of a test that
 * asserts true.
 */
export function assertEveryBasisLessonIsSubstantive(
  lessons: readonly MentorLesson[] = BASIS_AAA_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "BASIS MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is not passing.",
    );
  }
  const thin: string[] = [];
  for (const l of lessons) {
    const fields: Array<[string, string]> = [
      ["plainEnglish", l.plainEnglish],
      ["whyItExists", l.whyItExists],
      ["theTrap", l.theTrap],
      ["whatIWouldDo", l.whatIWouldDo],
    ];
    for (const [name, value] of fields) {
      if (value.trim().length < 40) thin.push(`${l.fn}.${name}`);
    }
  }
  if (thin.length > 0) {
    throw new Error(
      `BASIS MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a real ` +
        `explanation in every field, not a placeholder.`,
    );
  }
}
