/**
 * src/lib/reports/payroll-reconciliation-mentor.ts   (books-27)
 *
 * HOW A CPA ACTUALLY USES A RECONCILIATION REPORT.
 *
 * Michael's words, books-27: *"I don't want to just poke around in them here
 * and there for no reason, I want to know how a real world enterprise grade
 * reporting solution would use and read and learn from these reports."*
 *
 * The honest answer is that in a well-run finance function nobody browses this
 * report. It runs on a schedule, and the only question asked of it is binary:
 * did anything break. The skill is not in reading the grid — it is in knowing
 * the cadence, knowing which differences are expected, and knowing which single
 * number to escalate on. That is what these lessons teach.
 *
 * The four-eyes idea appears more than once below and is worth stating plainly:
 * the person who runs payroll should not be the only person who ever looks at
 * the reconciliation. Michael is a small employer, so "four eyes" means his own
 * eyes at a different time, on a fixed day, against a report he did not
 * assemble by hand. That is a real control and it is nearly free.
 *
 * Coverage is enforced by `assertEveryReconciliationFunctionIsTaught()`, which
 * reads BOTH core modules from disk (standing rule 26).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MentorLesson } from "@/lib/reports/reports-presentation-mentor";

export const RECONCILIATION_LESSONS: readonly MentorLesson[] = [
  {
    fn: "applyBasis",
    plainEnglish:
      "Works out what a levy SHOULD be, using the right shape of arithmetic for that particular " +
      "levy — a straight percentage of wages, a share of a premium, or a rate per hour worked.",
    whyItExists:
      "Washington charges you three fundamentally different ways and they cannot be forced into one " +
      "formula. Medicare, Social Security, unemployment and WA Cares are percentages of wages. Paid " +
      "Family and Medical Leave is a percentage of a premium that is itself a percentage of wages — " +
      "two roundings. Workers' compensation ignores wages entirely and is charged per hour worked. " +
      "One function that knows all three is how the reconciliation stays honest across every return " +
      "you file.",
    theTrap:
      "Collapsing the two-step levies into one rate because it looks equivalent. It is not. Your " +
      "filed Q2 PFML return reports 556.32 of employee premium. Computing the premium first " +
      "(778.83), then taking the employee's 71.43% of it, reproduces 556.32 exactly. Multiplying " +
      "wages by a single combined rate does not. The State's arithmetic is the specification, and " +
      "when our answer and the State's answer differ, ours is the one that is wrong.",
    whatIWouldDo:
      "Whenever a new levy appears — and one will, because Washington adds them — the first question " +
      "is not what the rate is, it is what the rate is applied TO. Get the base wrong and no rate " +
      "will save you. Ask for the agency's own worked example and reproduce it to the cent before " +
      "trusting any figure the system produces.",
    authorityIds: ["CON8_QC30_UNDERSTANDABILITY", "PUB15_RECORDKEEPING_4_YEARS"],
  },
  {
    fn: "maxRoundingDriftCents",
    plainEnglish:
      "Says the largest amount that rounding alone could possibly move a total by, given how many " +
      "people are on the report. Ten people, five cents. Four hundred people, two dollars.",
    whyItExists:
      "It is the line between 'this is normal' and 'go and look'. Each person's tax rounds to the " +
      "nearest cent, so each can drift the total by at most half a cent in either direction. That " +
      "is arithmetic, not judgement, and it means the boundary can be derived rather than chosen.",
    theTrap:
      "The tuned tolerance. Somebody picks five dollars because it felt about right, and from that " +
      "moment the report has two silent failure modes: at eleven employees it swallows a genuine " +
      "error, and at four hundred it cries wolf every quarter until people stop reading it. Both " +
      "look exactly like a working report. A bound derived from the arithmetic scales correctly and " +
      "— this is the part that matters if you are ever examined — can be explained in one sentence " +
      "to somebody who is deciding whether to believe you.",
    whatIWouldDo:
      "Never widen this. If a difference is outside the bound, the bound is not the problem. The " +
      "temptation to nudge a threshold until the report goes green is the single most common way an " +
      "internal control quietly stops being a control.",
    authorityIds: ["CON8_QC31_OMISSION_MISLEADS", "REG_SX_210_4_01_NOT_MISLEADING"],
  },
  {
    fn: "buildReconciliationReport",
    plainEnglish:
      "Builds the whole report: recomputes what each person's withholding should have been, compares " +
      "it to what actually came out, hides the people with nothing to report while telling you how " +
      "many were hidden, and puts a one-sentence verdict at the top.",
    whyItExists:
      "This is the control Sage got right in concept and wrong in presentation. Recompute, compare, " +
      "show the difference — a column of zeros means nothing is wrong, and any non-zero is a name " +
      "and an amount. Sage buried that behind a heading reading 'for MED_COGS' and twenty-six rows " +
      "for ten people, which is why you told me you do not use it. The arithmetic was never the " +
      "problem.",
    theTrap:
      "Two traps, and they pull in opposite directions. The first is reading a small residual as an " +
      "error: the difference between adding up ten rounded paycheques and taxing the quarter in one " +
      "go is expected, it is why Form 941 has line 7, and your own filed return shows it as -0.07. " +
      "The second is reading a clean report as proof that payroll is correct. It is not. It proves " +
      "the withholding matches the RATE. If the rate itself is stale, every line ties perfectly and " +
      "every line is wrong — which is precisely what happened with the 0.64% unemployment rate " +
      "sitting in Sage against the 0.37% the State actually charged.",
    whatIWouldDo:
      "Run it the same day every quarter, before the return is filed rather than after — a " +
      "difference found in July is a correction, the same difference found in November is an " +
      "amended return. Read the verdict first and stop there when it is clean. When it is not, work " +
      "the exception list top down, because it is sorted by size and the largest difference is " +
      "almost always the one with the explanation that accounts for the others. And once a year, " +
      "separately, check the rates against the agency notices — this report cannot do that for you.",
    authorityIds: [
      "CON8_PR35_AGGREGATION_REQUIRED",
      "CON8_PR36_OVER_AGGREGATION",
      "CON8_QC31_OMISSION_MISLEADS",
      "ASC_205_10_45_1_COMPARATIVE",
    ],
  },
  {
    fn: "filedFigure",
    plainEnglish:
      "Looks up one line from one of the returns you actually filed for the second quarter of 2026, " +
      "with the amount, the plain-English meaning, and the arithmetic that reproduces it.",
    whyItExists:
      "Most test data is invented by whoever wrote the test, so it can only prove the code agrees " +
      "with its author. These figures came off returns that were filed and accepted, several with " +
      "agency confirmation numbers. When our arithmetic disagrees with this, ours is wrong. That is " +
      "the difference between a test and an oracle, and it is why this quarter is worth preserving.",
    theTrap:
      "Treating a Sage printout as equivalent evidence. It is not, and this is not a hypothetical: " +
      "four defects were originally recorded against these books and two of them evaporated the " +
      "moment the filed returns were read, because they had been found in a printout of what a " +
      "program believed rather than in a filing. A printout is evidence of what software thinks. A " +
      "filed return is evidence of what was filed.",
    whatIWouldDo:
      "When something disagrees, go and get the filed return before saying a word to anybody. If it " +
      "is not in hand, say so out loud — 'the printout suggests X, and I have not checked the " +
      "return' is a completely different statement from 'X is wrong', and only one of them is safe " +
      "to act on.",
    authorityIds: ["PUB15_RECORDKEEPING_4_YEARS", "CON8_BC342_EXPLAIN_CLEARLY"],
  },
  {
    fn: "assertKnownGoodQuarterCrossFoots",
    plainEnglish:
      "Checks that the known-good quarter still agrees with itself — the ten wage figures add to " +
      "the total on all four returns, the hours match on both, and the Form 941 lines add up the " +
      "way the form says they must.",
    whyItExists:
      "A corrupt reference is worse than none at all, because every test that leans on it starts " +
      "lying in the same direction simultaneously and they all still pass. This runs before anything " +
      "is allowed to reconcile against the quarter.",
    theTrap:
      "Editing the fixture to make a failing test pass. If our engine and the filed return disagree, " +
      "the engine changes. The only legitimate reason to alter a figure in that file is that an " +
      "amended return was actually filed — and then the amendment gets recorded next to the " +
      "original, never quietly on top of it.",
    whatIWouldDo:
      "Think of this quarter the way an auditor thinks of a confirmation letter from a bank. It is " +
      "third-party evidence, it outranks anything produced internally, and it is the thing you reach " +
      "for first when two internal sources disagree. Four separate filings to three agencies all " +
      "agreeing on one wage base is about as strong as small-business evidence gets.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING", "PUB15_RECORDKEEPING_4_YEARS"],
  },
] as const;

export function reconciliationLessonFor(fn: string): MentorLesson | undefined {
  return RECONCILIATION_LESSONS.find((l) => l.fn === fn);
}

export function reconciliationTaughtFunctionNames(): readonly string[] {
  return RECONCILIATION_LESSONS.map((l) => l.fn);
}

export function reconciliationCitedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of RECONCILIATION_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out].sort();
}

/** The two core modules this mentor layer is responsible for covering. */
const COVERED_MODULES: readonly string[] = [
  "payroll-reconciliation-report-core.ts",
  "known-good-quarters.ts",
];

export function reconciliationExportedFunctionNames(): readonly string[] {
  const names: string[] = [];
  for (const file of COVERED_MODULES) {
    const src = readFileSync(join(process.cwd(), "src", "lib", "reports", file), "utf8");
    const re = /^export function ([A-Za-z_$][A-Za-z0-9_$]*)/gm;
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) {
      names.push(m[1]);
      m = re.exec(src);
    }
  }
  return names;
}

/**
 * THE COVERAGE GATE (standing rule 26), across BOTH modules.
 *
 * Fails the same three ways as its siblings: a vacuous read, an untaught
 * export, and a lesson for code that no longer exists.
 */
export function assertEveryReconciliationFunctionIsTaught(): void {
  const exported = reconciliationExportedFunctionNames();
  if (exported.length === 0) {
    throw new Error(
      `payroll-reconciliation-mentor: found NO exported functions across ${COVERED_MODULES.join(" and ")}. ` +
        "The coverage gate cannot read the source, so it would pass without checking anything.",
    );
  }

  const taught = new Set(reconciliationTaughtFunctionNames());
  const untaught = exported.filter((n) => !taught.has(n));
  if (untaught.length > 0) {
    throw new Error(
      `payroll-reconciliation-mentor: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        "A reconciliation function that ships without an explanation is an unfinished function (standing rule 26).",
    );
  }

  const exportedSet = new Set(exported);
  const orphans = reconciliationTaughtFunctionNames().filter((n) => !exportedSet.has(n));
  if (orphans.length > 0) {
    throw new Error(
      `payroll-reconciliation-mentor: these lessons teach functions that no longer exist: ${orphans.join(", ")}. ` +
        "A mentor layer that describes deleted code teaches something false.",
    );
  }
}
