/**
 * src/lib/accounting/cogs-position-mentor.ts   (books-20)
 *
 * THE CPA WHO SITS BESIDE FORM 1125-A.
 *
 * Standing rule 26: every engine ships with a mentor layer, and every exported
 * function is taught. This slice needs it more than any so far, because it is
 * the only one where the owner has knowingly chosen a position the law does not
 * plainly support, and where the software's job is therefore to be useful and
 * honest at the same time rather than choosing between them.
 *
 * The tone here is deliberate. Michael asked to be told "properly and
 * aggressively" to do it the right way. So these lessons do not hedge. They
 * also do not nag: each one says the thing once, says it in plain words, says
 * what it would actually cost, and then gets on with explaining the mechanics.
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

export const COGS_POSITION_LESSONS: readonly MentorLesson[] = [
  {
    fn: "assertCogsCents",
    plainEnglish:
      "Refuses to let a fraction of a cent into the cost of goods sold computation, and refuses " +
      "numbers so large that ordinary arithmetic quietly stops being exact.",
    whyItExists:
      "Cost of goods sold is a subtraction between two large numbers, and the difference is often " +
      "small relative to both. That is the arithmetic most vulnerable to a stray float: the error " +
      "does not shrink with the answer, so a rounding artefact that would be invisible in purchases " +
      "can be material by the time it reaches line 8.",
    theTrap:
      "Allocating an overhead pool across departments with percentages. Multiply by 0.3333 three " +
      "times and the parts do not add back to the whole, and the missing cent lands wherever the " +
      "last subtraction happens to be.",
    whatIWouldDo:
      "Treat a fractional cent as a bug in whatever produced it, never as something to round here. " +
      "Go and find the division.",
    authorityIds: [],
  },
  {
    fn: "formatCents",
    plainEnglish:
      "Turns integer cents into a dollar string, putting negatives in parentheses the way a tax " +
      "return does rather than with a minus sign.",
    whyItExists:
      "Every number this engine shows Michael is a number he may have to defend. Parentheses for " +
      "negatives is the convention on the forms themselves, and matching the form removes one more " +
      "chance to misread a figure when comparing the screen to the return.",
    theTrap:
      "Formatting for display and then parsing the formatted string back into a number somewhere " +
      "downstream. The parentheses stop meaning negative, commas become separators, and a loss " +
      "silently becomes a gain.",
    whatIWouldDo:
      "Format only at the very edge, when something is about to be read by a human. Keep integer " +
      "cents everywhere else, all the way through.",
    authorityIds: [],
  },
  {
    fn: "determineTaxpayerRole",
    plainEnglish:
      "Decides whether Greenway is a reseller or a producer for tax purposes, by reading which " +
      "Washington cannabis licences it holds rather than by asking anyone's opinion.",
    whyItExists:
      "This one fact decides the entire cost of goods sold position. §1.471-3(b) governs resellers " +
      "and names only invoice price plus the costs of acquiring possession. §1.471-3(c) governs " +
      "producers and lets in direct labour and production overhead. Under §280E that is the " +
      "difference between a dollar that counts and a dollar that vanishes.",
    theTrap:
      "Reasoning about it by degree — 'we handle the product, we repackage, we inspect, surely that " +
      "is production.' Harborside handled far more product than Greenway does and the Tax Court " +
      "still called it a reseller. And in Washington the question never even reaches that argument, " +
      "because RCW 69.50.328 forbids a retail licensee from having any interest in production at " +
      "all. It is settled by the licence, not by the activity.",
    whatIWouldDo:
      "Stop looking for a way into §1.471-3(c). It is closed to Greenway for as long as it holds a " +
      "retail licence, and time spent arguing otherwise is time not spent on the deductions that are " +
      "genuinely available through the ATM and land-holding entities under CHAMP.",
    authorityIds: [
      "RCW_69_50_328_NO_CROSS_OWNERSHIP",
      "REG_1_471_3_B_RESELLER",
      "REG_1_471_3_C_PRODUCER",
      "PATIENTS_MUTUAL_RESELLER",
    ],
  },
  {
    fn: "validatePositionElection",
    plainEnglish:
      "Requires that somebody actually chose this year's cost of goods sold position, on a date, by " +
      "name, with a reason — and refuses the year if nobody did.",
    whyItExists:
      "This is the books-18 principle again: an unchosen position is not a chosen position. If this " +
      "treatment is ever questioned, the difference between a documented decision and a silence is " +
      "enormous. A contemporaneous note saying the owner was shown the conservative number and chose " +
      "otherwise for stated reasons is a position. Nothing at all looks like nobody was minding it.",
    theTrap:
      "Letting last year's answer roll forward as a default. It feels efficient and it destroys the " +
      "entire evidentiary value of the record, because a default proves nobody considered this " +
      "year's facts — and this year's numbers are different from last year's.",
    whatIWouldDo:
      "Re-elect every single year, deliberately, even when the answer is identical. It takes two " +
      "minutes and it is the cheapest insurance in this entire system.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT", "REG_1_471_2_B_CONSISTENCY_WEIGHT"],
  },
  {
    fn: "validateCogsInput",
    plainEnglish:
      "Checks every fact Form 1125-A depends on before computing anything, and reports all the " +
      "problems at once rather than making you fix them one at a time.",
    whyItExists:
      "The form is only eight lines of arithmetic and it will produce a confident, well-formed, " +
      "completely wrong answer from bad inputs without the slightest hesitation. The arithmetic is " +
      "not where the risk lives. The inputs are.",
    theTrap:
      "Treating lines 9a through 9f as an afterthought because they carry no dollar amounts. Line 9f " +
      "in particular — any change in determining quantities, cost, or valuations — is the line that " +
      "quietly reveals a change in method of accounting, which needed consent BEFORE the return was " +
      "computed. A blank there is not a small omission. The subtler version of the same trap is the " +
      "one that feels virtuous: quietly switching to the conservative computation this year and " +
      "saying nothing about the earlier years. That is still a change of method under §446(e), it " +
      "still needs consent FIRST, and doing it silently throws away the audit protection that the " +
      "same change would have carried if it had gone on a Form 3115.",
    whatIWouldDo:
      "Answer the yes/no questions first, before any numbers are entered. If line 9f is a yes, stop " +
      "and work out whether a Form 3115 was required before going any further. And if this year's " +
      "position differs from last year's in either direction, treat that as a method change until " +
      "someone proves otherwise — the refusal this function raises is not an obstacle to doing the " +
      "right thing, it is the difference between doing the right thing and merely appearing to.",
    authorityIds: [
      "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
      "IRC_446_E_CONSENT_REQUIRED",
      "REG_1_471_2_D_VERIFY_BY_COUNT",
    ],
  },
  {
    fn: "bucketsForPosition",
    plainEnglish:
      "Selects which cost buckets are allowed into cost of goods sold under a given position — the " +
      "strict reseller reading, or the treatment carried forward from prior years.",
    whyItExists:
      "It is the single point where the two computations diverge, kept deliberately to one function " +
      "so the difference between them is auditable in one place instead of scattered through the " +
      "arithmetic.",
    theTrap:
      "Believing the §280E sunset will make the two computations converge. It will not, and the first " +
      "version of this engine got that wrong. §280E denies deductions and says nothing about " +
      "inventories; §1.471-3 never mentions §280E. Repeal does not make a budtender's wages " +
      "inventoriable — it makes them deductible under §162 instead of disallowed. So the gap survives " +
      "repeal unchanged; what changes is that it stops being a permanent loss and becomes a question " +
      "of timing. Anything that closes the gap automatically on the repeal date is bending the " +
      "conservative yardstick, which is the one number that must never move.",
    whatIWouldDo:
      "Tag every cost at the moment it is entered, not at year end. The tag is what makes standing " +
      "rule 8 real: on the day §280E ends, the switch is one field, because the labelling was done " +
      "all along.",
    authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_280E"],
  },
  {
    fn: "section280EAppliesTo",
    plainEnglish:
      "Answers whether §280E still restricts this taxpayer for the year being computed, by reading " +
      "one dated field.",
    whyItExists:
      "Standing rule 8 says §280E relief must be a switch, not a rebuild. Michael expects the law to " +
      "change soon and does not want to be re-engineering his books under deadline when it does. " +
      "Concentrating the whole question into one input is what makes that promise keepable.",
    theTrap:
      "Assuming repeal is retroactive. It almost certainly will not be. The year matters, and a " +
      "change effective for years after 2027 does nothing whatsoever for 2026 — including for a 2026 " +
      "return filed in 2028.",
    whatIWouldDo:
      "The day the law changes, set this one field, then re-run every open year and read the gap " +
      "report. Do not touch anything else in this file.",
    authorityIds: ["IRC_280E"],
  },
  {
    fn: "computeForm1125A",
    plainEnglish:
      "Fills in the eight numbered lines of Form 1125-A and produces the cost of goods sold figure " +
      "that flows to page 1, line 2 of Form 1120-S.",
    whyItExists:
      "It is the actual deliverable of this slice. Every other function here exists to make sure the " +
      "number this one produces is defensible.",
    theTrap:
      "Forgetting that line 7, ending inventory, is SUBTRACTED. It runs against intuition — more " +
      "inventory on the shelf means less cost of goods sold and therefore more taxable income. An " +
      "overstated count at year end raises the tax bill, which is exactly why an uncounted ending " +
      "inventory is refused upstream rather than accepted with a warning.",
    whatIWouldDo:
      "Tie line 1 of this year to line 7 of last year, every year, without exception. If they do not " +
      "match, something happened to inventory that the books have not recorded, and finding out what " +
      "is more urgent than filing.",
    authorityIds: ["REG_1_471_1_A_INVENTORIES_REQUIRED", "REG_1_61_3_A"],
  },
  {
    fn: "comparePositions",
    plainEnglish:
      "Computes the cost of goods sold both ways, subtracts one from the other, and states in plain " +
      "dollars what the chosen position is putting at risk.",
    whyItExists:
      "Michael has the right to take an aggressive position. He does not have the ability, with this " +
      "system running, to take one without knowing its size. Those are different things, and keeping " +
      "them apart is the entire design of this slice.",
    theTrap:
      "Reading the gap as 'the tax I might owe'. It is not. It is the DEDUCTION at risk. The tax is a " +
      "fraction of it — but then interest runs from the original due date and penalties may sit on " +
      "top, so the eventual cost is not simply the gap times a rate either. Treat this number as the " +
      "measure of exposure, not as a bill.",
    whatIWouldDo:
      "Look at this number every year before filing, and ask one question: if this were disallowed in " +
      "full, across every open year at once, could the business write that cheque? If the answer is " +
      "no, the position is not really a tax decision any more. It is a solvency decision.",
    authorityIds: ["IRC_280E", "REG_1_471_3_B_RESELLER", "ALTERMAN_COGS_FORMULA"],
  },
  {
    fn: "adviseOnMethodChange",
    plainEnglish:
      "Lays out the legal route from the current treatment to the correct one — §446(e) consent, " +
      "Form 3115, the §481(a) true-up — and makes the argument for taking it.",
    whyItExists:
      "Michael asked for exactly this, in these words: tell me why and how to do it properly by law. " +
      "This is the how, and it is also the why, argued from his own interest rather than from " +
      "principle, because the argument from principle has already been made and considered.",
    theTrap:
      "The universal instinct that filing a form invites scrutiny, so silence is safer. It is " +
      "backwards, and it is the single most expensive misconception in this area. Rev. Proc. 2015-13 " +
      "§8.01 is the IRS undertaking NOT to make you change that item in prior years once you have " +
      "timely filed. Say nothing and you have no such undertaking. And under §8.02(1) the protection " +
      "largely disappears once an examination opens — so it is available exactly while you feel you " +
      "do not need it, and gone at the moment you do.",
    whatIWouldDo:
      "Compute the §481(a) number first, before deciding anything. Most owners discover the true-up " +
      "is far smaller than they feared, and the fear was doing all the work. If it comes in under " +
      "$50,000 it can be finished in a single year by election, and then this is simply over.",
    authorityIds: [
      "IRC_446_E_CONSENT_REQUIRED",
      "IRC_446_F_NO_SHELTER",
      "REG_1_446_1_E_2_I_PROPER_OR_NOT",
      "IRC_481_A_ADJUSTMENT",
      "REVPROC_2015_13_AUDIT_PROTECTION",
      "REVPROC_2015_13_PROTECTION_LOST_IF_UNDER_EXAM",
      "REVPROC_2015_13_DE_MINIMIS",
    ],
  },
  {
    fn: "computeCogsPosition",
    plainEnglish:
      "The single entry point: validates everything, then returns either a complete refusal list or " +
      "the full picture — both computations, the gap, the filed form, and the advice.",
    whyItExists:
      "So that no screen can accidentally get a number without also getting the refusals and the " +
      "comparison that give it meaning. The shape of the return type makes it impossible to read the " +
      "answer without having passed the checks.",
    theTrap:
      "Wanting a 'just give me the number' variant for convenience. That function would be used " +
      "everywhere within a month and every one of the protections in this file would become optional " +
      "in practice while still appearing to exist.",
    whatIWouldDo:
      "Keep it exactly as it is. If a caller finds the refusals inconvenient, the refusals are doing " +
      "their job and the caller is missing a fact it needs.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
];

/** Names of every function taught above. */
export function taughtCogsFunctionNames(): readonly string[] {
  return COGS_POSITION_LESSONS.map((l) => l.fn);
}

/**
 * Names of every function the core module exports, read FROM DISK.
 *
 * Reading the source rather than importing the module is deliberate: an import
 * would only reveal what the module chose to expose at runtime, and the point
 * of the gate is to notice a new `export function` the moment it is written.
 *
 * Standing rule 39: the optional path exists so a test can aim this at a
 * fixture it controls and prove the gate genuinely fires, rather than
 * re-implementing the check and testing its own copy.
 */
export function exportedCogsFunctionNames(sourcePath?: string): readonly string[] {
  const path =
    sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "cogs-position-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

/**
 * Fail if any exported core function ships without a lesson.
 *
 * Two guards, not one. The obvious guard catches an untaught function. The
 * less obvious one catches a gate that has stopped reading anything at all,
 * because a coverage check that inspects an empty list passes vacuously and
 * protects nothing. Standing rules 16 and 39.
 */
export function assertEveryCogsFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtCogsFunctionNames());
  const exported = exportedCogsFunctionNames(sourcePath);

  if (exported.length === 0) {
    throw new Error(
      "COGS MENTOR COVERAGE GATE BROKEN: read no exported functions from the core module. " +
        "A coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  const untaught = exported.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `COGS MENTOR COVERAGE GAP: these exported functions have no lesson: ${untaught.join(", ")}. ` +
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
export function assertEveryCogsLessonIsSubstantive(
  lessons: readonly MentorLesson[] = COGS_POSITION_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "COGS MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is not passing.",
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
      `COGS MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a real ` +
        `explanation in every field, not a placeholder.`,
    );
  }
}
