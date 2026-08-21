/**
 * src/lib/reports/reports-presentation-mentor.ts   (books-27)
 *
 * THE CPA WHO SITS NEXT TO MICHAEL WHEN HE OPENS A REPORT.
 *
 * Michael's words, books-27: *"The reports engine is another prime area where
 * the concierge and PhD cpa mentor to guide me to use the reports in the way
 * they are meant to be used. I don't want to just poke around in them here and
 * there for no reason, I want to know how a real world enterprise grade
 * reporting solution would use and read and learn from these reports."*
 *
 * That is a different request from the earlier mentor layers. Those taught a
 * calculation: here is the number, here is why it is that number. This one has
 * to teach a HABIT — when to open the report, what to look at first, what a
 * healthy one looks like, and what the specific thing is that should make him
 * stop and pick up the phone. A number he can recompute is worth less than a
 * routine he actually follows.
 *
 * So every lesson below ends somewhere useful. `whatIWouldDo` is not "be
 * careful"; it is the sentence a CPA would say out loud in the room, naming the
 * report, the cadence, and the threshold.
 *
 * Every exported function in `reports-presentation-core.ts` has a lesson here,
 * and `assertEveryExportedFunctionIsTaught()` reads the core module FROM DISK
 * to prove it (standing rule 26). Reading from disk rather than importing is
 * deliberate: importing would only ever see what the module chose to export at
 * runtime, while reading the source sees what a developer actually wrote, which
 * is the thing that needs covering.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type MentorLesson = {
  /** The exported function this lesson teaches. */
  fn: string;
  plainEnglish: string;
  whyItExists: string;
  theTrap: string;
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const REPORTS_PRESENTATION_LESSONS: readonly MentorLesson[] = [
  {
    fn: "decodeSageToken",
    plainEnglish:
      "Takes a machine label off one of your Sage reports — SUI2_COGS_C, WAPFML, MED_C — and tells " +
      "you three things in English: what the levy actually is, whether it belongs to the cost of " +
      "goods sold side or the selling side, and whether it is your money or the employee's.",
    whyItExists:
      "Section 8.9 of the baseline measured the Employee Payroll Analysis you gave me: thirty-three " +
      "columns, and the headings wrapped across eight physical lines. Nobody reads that. They read " +
      "the one column they already know and ignore the other thirty-two, which means thirty-two " +
      "facts about your money go unexamined every quarter. The tokens are not hard, they are just " +
      "unexplained, and an unexplained column is an unread column.",
    theTrap:
      "Guessing at a token from its shape. SS and SS_C look like the same tax and are not — one is " +
      "withheld from the employee and one comes out of your pocket, and if you read them as one " +
      "number you will believe payroll costs you about half what it does. The trailing _C is the " +
      "whole difference. That is also why the decoder strips _C before it strips _COGS, and why " +
      "there is a test that deliberately reverses the order to prove the order matters.",
    whatIWouldDo:
      "When a column you do not recognise appears on a report, do not skip it — hover it and read " +
      "the definition, then check whether it is employer-side. The employer-side columns added " +
      "together are the real cost of having staff, and that total is the number to carry into any " +
      "hiring decision. If a token comes back unknown, tell me rather than assuming: an unknown " +
      "token means Sage started reporting something new, and something new in payroll is always " +
      "worth ten minutes.",
    authorityIds: [
      "CON8_QC30_UNDERSTANDABILITY",
      "CON8_QC32_REASONABLE_KNOWLEDGE",
      "CON8_BC342_EXPLAIN_CLEARLY",
      "IRC_280E",
    ],
  },
  {
    fn: "comparePeriods",
    plainEnglish:
      "Puts this period next to last period, shows the dollar difference, and — only when the two " +
      "periods were measured the same way — the percentage change.",
    whyItExists:
      "A single number cannot be judged. Payroll taxes of fourteen thousand dollars is neither good " +
      "nor bad until you know it was eleven thousand last quarter. ASC 205-10-45-1 says outright " +
      "that comparative statements are ordinarily necessary, and that in any one year the current " +
      "figures alone are not particularly useful. Enterprise reporting tools default every report " +
      "to a comparative view for exactly this reason; a single-column report is the exception that " +
      "has to justify itself, not the norm.",
    theTrap:
      "The confident percentage that is measuring the wrong thing. When your unemployment rate " +
      "changes, or the wage ceiling moves, or you add a department mid-year, the percentage change " +
      "in that line is a fact about the rate table, not about your business — and it will read as " +
      "though you did something. ASC 205-10-45-3 uses the word 'shall' twice on this: prior figures " +
      "shall in fact be comparable, and any exception shall be clearly brought out. So when the " +
      "caller declares a break, this function withholds the percentage, keeps both dollar amounts " +
      "and the difference, which remain true, and names what changed.",
    whatIWouldDo:
      "Read the dollar column first and the percentage second — the dollars are what leave the bank. " +
      "When you see a refusal instead of a percentage, that is the most informative cell on the " +
      "page: it is telling you a rule changed underneath you, which is usually a bigger deal than " +
      "the movement itself. And when the first quarter after cutover shows no percentage at all, " +
      "that is correct — there is genuinely no prior period, and a made-up baseline would be worse " +
      "than an honest blank.",
    authorityIds: ["ASC_205_10_45_1_COMPARATIVE", "ASC_205_10_45_3_COMPARABILITY", "CON8_QC31_OMISSION_MISLEADS"],
  },
  {
    fn: "formatCents",
    plainEnglish:
      "Turns an amount held in whole cents into the dollars-and-cents text you see on screen — " +
      "1420457 becomes $14,204.57.",
    whyItExists:
      "Every amount in this system is stored as an integer number of cents and only ever becomes a " +
      "string at the moment it is displayed (standing rule 13e). The instant money becomes a " +
      "decimal number in a computer it starts drifting, and drift in payroll shows up as a penny " +
      "difference between a report and a return — which is exactly the kind of difference that " +
      "takes an afternoon to explain and cannot be explained away.",
    theTrap:
      "Formatting the same amount in two places with two slightly different helpers, so the summary " +
      "page and the detail page disagree by a cent and you lose confidence in both. That is why " +
      "there is one formatter and everything routes through it. It also throws rather than rounding " +
      "if it is ever handed a fraction, because a fractional cent arriving here means something " +
      "upstream did decimal arithmetic on money and needs fixing at the source.",
    whatIWouldDo:
      "If you ever see two pages of this system quote different figures for the same thing, treat it " +
      "as a real defect and tell me — do not reconcile it by hand. One of the two is wrong and the " +
      "hand reconciliation will hide which.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING", "CON8_QC30_UNDERSTANDABILITY"],
  },
  {
    fn: "signedCents",
    plainEnglish:
      "Formats a change column so the direction is impossible to miss: +$412.30, -$118.02, or the " +
      "words 'no change'.",
    whyItExists:
      "Section 8.8 of the baseline found a leave balance printed as a bare negative number with no " +
      "explanation. A minus sign carries no meaning on its own — it means one thing on a change " +
      "column, something else on a balance, and something else again in accounting parentheses. " +
      "Spelling out 'no change' instead of printing $0.00 matters too, because a zero in a change " +
      "column is genuinely ambiguous: it can mean nothing moved, or it can mean nobody filled the " +
      "field in.",
    theTrap:
      "Accounting parentheses. A finance-trained reader knows (412.30) is negative; everyone else " +
      "reads it as a footnote or a grouping. This system uses an explicit minus sign everywhere and " +
      "never parentheses, on purpose. CON 8 QC32 sets the bar at a reader with reasonable knowledge " +
      "of business who reviews the information diligently — not a reader who has memorised a " +
      "typesetting convention from the 1970s.",
    whatIWouldDo:
      "Scan the change column before the amount column. On a payroll report, the amounts are mostly " +
      "predictable and the changes are where the story is — a new hire, a terminated employee, a " +
      "rate change, or a mistake. Three of those four you already know about, so the change you " +
      "cannot explain is the one to chase.",
    authorityIds: ["CON8_QC30_UNDERSTANDABILITY", "CON8_QC32_REASONABLE_KNOWLEDGE"],
  },
  {
    fn: "formatBasisPoints",
    plainEnglish:
      "Turns a percentage held as a whole number of basis points into readable text — 1234 becomes " +
      "12.34%, and 1200 becomes a clean 12% rather than 12.00%.",
    whyItExists:
      "Percentages get stored the same way money does: as integers, in hundredths of a percent, so " +
      "that the same rate rendered on two screens is the same rate. This matters more than it " +
      "sounds for you specifically, because your Washington rates are quoted in awkward fractions — " +
      "the unemployment rate on your filed Q2 return works out to 0.37% and the Employment " +
      "Administration Fund to 0.03%. Those are 37 and 3 basis points exactly, and they stay exact.",
    theTrap:
      "Trailing-zero noise. A page full of 12.00% and 3.00% reads as though the precision means " +
      "something, and the eye stops distinguishing values. Trimming to 12% and 3% lets the genuinely " +
      "precise figures — 0.37% — stand out as precise, which is information.",
    whatIWouldDo:
      "Treat a rate on a report as something to verify once a year against the agency notice, not " +
      "something to trust because it is printed. Rates are the single most common source of a " +
      "quietly wrong return, because nothing about the report looks broken when the rate is stale. " +
      "When your rate notices arrive, hand them to me and we update the dated rate table — the " +
      "system keeps every historical rate with the dates it applied, so re-running an old quarter " +
      "still uses the rate that was correct then.",
    authorityIds: ["CON8_QC30_UNDERSTANDABILITY", "ASC_205_10_45_3_COMPARABILITY"],
  },
  {
    fn: "formatLeaveBalance",
    plainEnglish:
      "Says a leave balance the way a person would: '48.01 hours available', or, when it has gone " +
      "below zero, '48.01 hours advanced' — meaning the employee has taken leave they have not " +
      "earned yet.",
    whyItExists:
      "This is the §8.8 defect answered directly. Your Sage report printed a negative leave balance " +
      "as a bare minus number, which tells a reader nothing about what happened or whether it is a " +
      "problem. It is a specific and quite ordinary event with a name — leave advanced against " +
      "future accrual — and naming it turns a puzzle into a fact.",
    theTrap:
      "Letting an advanced balance sit unexamined until someone quits. Advanced leave is money you " +
      "have already paid for time not yet earned, and if that employee leaves you are usually " +
      "recovering it from a final paycheque, which Washington constrains. The report is the early " +
      "warning; the exit interview is far too late.",
    whatIWouldDo:
      "Look at the leave report once a month, not once a year, and treat any advanced balance as a " +
      "conversation to have that week — not because it is wrong, but because it is a decision you " +
      "want to have made deliberately rather than discovered later. Zero shows as 'none available' " +
      "rather than 0.00 for the same reason: it is a state, not a measurement.",
    authorityIds: ["CON8_QC30_UNDERSTANDABILITY", "CON8_QC31_OMISSION_MISLEADS"],
  },
  {
    fn: "suppressEmptySubjects",
    plainEnglish:
      "Hides the rows that have nothing to say, counts them, and prints a sentence telling you " +
      "exactly how many were hidden and how to bring them back.",
    whyItExists:
      "Section 8.3 of the baseline measured a Sage report that printed twenty-six rows to tell you " +
      "about ten people — sixteen rows of zeros for employees who did not work that period. That is " +
      "not neutral. CON 8 PR36 warns that too much aggregation can obscure information, and the " +
      "mirror image is just as damaging: padding a report with empty rows makes the reader scan " +
      "sixteen lines of nothing to find the ten that matter, and after a few quarters he stops " +
      "scanning carefully at all.",
    theTrap:
      "Hiding silently. The disclosure sentence is not politeness — it is the entire justification " +
      "for hiding anything. CON 8 QC31 says excluding information can make a report incomplete and " +
      "therefore potentially misleading; the cure is that the reader always knows something was " +
      "withheld and can ask for it. Hidden-and-disclosed is a summary. Hidden-and-silent is a lie " +
      "of omission, and it is how fifteen inactive employees stay on a payroll list for three years " +
      "without anyone noticing.",
    whatIWouldDo:
      "Read the hidden count every time, even though you will not usually act on it. It is a free " +
      "headcount check: if the report says 'sixteen of twenty-six had nothing to report' and you " +
      "only expected to have ten people, the difference is a list of names you should look at once " +
      "— terminated employees who were never deactivated, duplicates, or someone who should have " +
      "been paid and was not.",
    authorityIds: [
      "CON8_QC31_OMISSION_MISLEADS",
      "CON8_PR35_AGGREGATION_REQUIRED",
      "CON8_PR36_OVER_AGGREGATION",
      "CON8_PR13_DETAIL_ASYMMETRY",
    ],
  },
  {
    fn: "emptyStateFor",
    plainEnglish:
      "Decides what to show when a report has no data, and — critically — distinguishes 'nothing " +
      "happened in the period you picked' from 'this report has never had anything in it'.",
    whyItExists:
      "Section 8.7 of the baseline found Sage's Employee Compensation report drawing seven columns " +
      "and twenty-six rows of pure blank. Structure with no content is worse than a blank page, " +
      "because it looks like an answer. Those two situations are completely different facts: a " +
      "quiet quarter is fine, while a report that has never populated usually means a feature was " +
      "never switched on and something has been going unrecorded — possibly for years.",
    theTrap:
      "Reading an empty report as reassurance. An empty exception report and a broken exception " +
      "report look identical, and the broken one is the dangerous one. This is the reporting form " +
      "of standing rule 48: never let a check that did not run look like a check that passed.",
    whatIWouldDo:
      "When a report comes back empty, read the sentence, not the grid. If it says the report has " +
      "never had data, stop and find out why before concluding anything — that is a configuration " +
      "question, not a reporting one. If it says the period was genuinely quiet, widen the date " +
      "range once to confirm you are looking where you meant to look, then move on.",
    authorityIds: ["CON8_QC31_OMISSION_MISLEADS", "CON8_BC342_EXPLAIN_CLEARLY", "PUB15_RECORDKEEPING_4_YEARS"],
  },
] as const;

export function lessonFor(fn: string): MentorLesson | undefined {
  return REPORTS_PRESENTATION_LESSONS.find((l) => l.fn === fn);
}

export function taughtFunctionNames(): readonly string[] {
  return REPORTS_PRESENTATION_LESSONS.map((l) => l.fn);
}

export function citedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of REPORTS_PRESENTATION_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out].sort();
}

/**
 * Read the exported function names out of the core module ON DISK.
 *
 * Textual on purpose, for the reason given in the file header: importing would
 * see the runtime shape, and the runtime shape is not what needs covering.
 */
export function exportedCoreFunctionNames(): readonly string[] {
  const path = join(process.cwd(), "src", "lib", "reports", "reports-presentation-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    names.push(m[1]);
    m = re.exec(src);
  }
  return names;
}

/**
 * THE COVERAGE GATE (standing rule 26).
 *
 * Fails three ways, and all three matter:
 *   - zero functions found, which would mean the regex broke and the gate had
 *     started passing vacuously (standing rule 39);
 *   - an exported function with no lesson;
 *   - a lesson for a function that no longer exists, which is how a mentor
 *     layer rots into describing code that was deleted years ago.
 */
export function assertEveryExportedFunctionIsTaught(): void {
  const exported = exportedCoreFunctionNames();
  if (exported.length === 0) {
    throw new Error(
      "reports-presentation-mentor: found NO exported functions in reports-presentation-core.ts. " +
        "The coverage gate cannot read the source, so it would pass without checking anything.",
    );
  }

  const taught = new Set(taughtFunctionNames());
  const untaught = exported.filter((n) => !taught.has(n));
  if (untaught.length > 0) {
    throw new Error(
      `reports-presentation-mentor: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        "Michael asked to be coached on how these reports are meant to be used, so a report function " +
        "that ships without an explanation is an unfinished function (standing rule 26).",
    );
  }

  const exportedSet = new Set(exported);
  const orphans = taughtFunctionNames().filter((n) => !exportedSet.has(n));
  if (orphans.length > 0) {
    throw new Error(
      `reports-presentation-mentor: these lessons teach functions that no longer exist: ${orphans.join(", ")}. ` +
        "A mentor layer that describes deleted code teaches something false.",
    );
  }
}
