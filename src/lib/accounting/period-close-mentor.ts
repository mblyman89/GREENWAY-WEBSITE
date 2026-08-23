/**
 * src/lib/accounting/period-close-mentor.ts   (books-18)
 *
 * THE CPA WHO SITS BESIDE THE CLOSE SCREEN.
 *
 * Standing rule 26: every engine ships with a mentor layer, and every exported
 * function is taught. Michael has a Master's in accounting and has not opened a
 * book in thirteen years, so the job here is to restore what he already knows
 * rather than lecture him \u2014 and to be honest about the traps, including the
 * ones that are tempting precisely because they look efficient.
 *
 * A coverage gate at the bottom of this file reads the core module FROM DISK
 * and fails if any exported function ships without a lesson. That gate has
 * already caught real omissions twice in earlier slices; it is not decorative.
 */

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

export const PERIOD_CLOSE_LESSONS: readonly MentorLesson[] = [
  {
    fn: "findCloseCheck",
    plainEnglish:
      "Looks up one item on the month-end checklist by its name and hands back the question, why it " +
      "matters, and what counts as proof.",
    whyItExists:
      "The checklist is defined in exactly one place so the screen, the database and the tests are " +
      "all reading the same list. The moment a check exists in two places, one of them gets edited " +
      "and the other quietly becomes a lie.",
    theTrap:
      "Rewording a check to make it easier to pass. If 'was the cash counted' becomes 'does the cash " +
      "look about right', the control is gone but the green tick remains \u2014 which is worse than " +
      "having no checklist, because now there is false comfort.",
    whatIWouldDo:
      "Read the whole list once before your first close, then never again. The questions do not " +
      "change; only the answers do.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    fn: "evaluatePeriodClose",
    plainEnglish:
      "Decides whether a month has earned the right to be sealed, and if not, lists every single " +
      "reason at once rather than one at a time.",
    whyItExists:
      "Sealing a month is the moment its numbers become real. After that, a mistake is not a tidy " +
      "correction \u2014 GAAP says an error found after statements are issued must be fixed by restating " +
      "the earlier statements, and the restatement has to be disclosed. Ten minutes of checking " +
      "beforehand is the cheapest insurance you will ever buy.",
    theTrap:
      "Treating an UNANSWERED check as a passed one. This engine keeps 'nobody looked' and 'we " +
      "looked and it is wrong' as genuinely different states, because the most dangerous item on " +
      "any checklist is the one nobody read. Silence is never consent here.",
    whatIWouldDo:
      "Close within a few days of month end, while people still remember what happened. A close " +
      "attempted in October for June is archaeology, and the person who could have explained the " +
      "odd entry has forgotten it.",
    authorityIds: [
      "ASC_250_10_45_23_RESTATE",
      "ASC_250_10_45_22_NOT_CURRENT_INCOME",
      "ASC_250_10_20_ERROR_DEFINED",
      "REG_1_6001_1_A_PERMANENT_BOOKS",
      "REG_1_446_1_A_2_CLEARLY_REFLECT",
    ],
  },
  {
    fn: "evaluatePeriodReopen",
    plainEnglish:
      "Decides whether a sealed month can be opened again, insists on a written reason, and refuses " +
      "outright once a tax return has been filed on it.",
    whyItExists:
      "Reopening is sometimes genuinely correct \u2014 a vendor invoice turns up late and belongs in the " +
      "month it relates to. What must never happen is reopening without a trace. A month that " +
      "reopens silently is indistinguishable, later, from a month that was edited to suit somebody.",
    theTrap:
      "Writing 'correction' or 'fix' in the reason box. That records nothing. A year from now the " +
      "only question anybody asks is WHAT changed and WHY, and 'correction' answers neither. Write " +
      "the sentence you would want to read if somebody else had done it.",
    whatIWouldDo:
      "Reopen when the entry genuinely belongs in that month and the amount matters. If it is small " +
      "and the month is long gone, book it currently and note why \u2014 but be honest that this is a " +
      "judgement about materiality, not a free pass.",
    authorityIds: [
      "ASC_250_10_45_23_RESTATE",
      "ASC_250_10_50_7_DISCLOSE_RESTATEMENT",
      "REG_1_6001_1_A_PERMANENT_BOOKS",
    ],
  },
  {
    fn: "validatePeriodIdentity",
    plainEnglish:
      "Before asking whether a month is ready to close, this asks a blunter question: is this a " +
      "real month, in a real year, for one of the four sets of books?",
    whyItExists:
      "It exists because it was missing, and the gap was found by attacking a test suite that had " +
      "just gone green with eighty-one passes. The engine was checking the checklist in great " +
      "detail and never checking what it was being pointed at. Asked to close month NaN of year " +
      "NaN, it answered \u2014 in a full sentence \u2014 \"Period NaN-NaN is ready to close. All 10 checks " +
      "pass.\" Every bound here is copied from the database\u2019s own constraints rather than chosen: " +
      "months 1 to 12, years 2026 through 2100, and the four entities.",
    theTrap:
      "Assuming rubbish input cannot reach here because the screen would never send it. Screens go " +
      "stale, requests get replayed, and somebody eventually calls this from a script at eleven at " +
      "night. A confident wrong answer is far more dangerous than a crash, because you would " +
      "believe it.",
    whatIWouldDo:
      "If you ever see a refusal naming a month that makes no sense, do not try to fix the month \u2014 " +
      "find out what sent it. That refusal is reporting a plumbing fault, not a bookkeeping one.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    fn: "lastDayOfMonth",
    plainEnglish:
      "Says how many days are in a given month, allowing for leap years.",
    whyItExists:
      "To know when a month is actually over. It is written out longhand instead of asking the " +
      "computer\u2019s built-in date tools, because those quietly apply a time zone \u2014 and a month end " +
      "that lands on the 31st here and the 30th on a server in another country is the sort of bug " +
      "that never shows up until it matters.",
    theTrap:
      "Thinking the leap year rule is just \u2018every four years\u2019. It is not: 2100 is divisible by four " +
      "and is not a leap year. Since these books run through 2100, that exact case is inside the " +
      "range rather than safely beyond it.",
    whatIWouldDo:
      "Nothing \u2014 this one is plumbing. It is described here only because everything that ships gets " +
      "explained, including the boring parts.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    fn: "refuseIfNotFinished",
    plainEnglish:
      "Refuses to seal a month that has not actually ended yet.",
    whyItExists:
      "This is the one an eager person trips over. Closing August on the 20th of August feels " +
      "productive and is genuinely damaging: eleven days of sales have not happened yet, and once " +
      "the month is sealed they have nowhere to go. Worse, the books look finished, so nobody goes " +
      "looking. The repair is not a quick correcting entry \u2014 ASC 250-10-45-23 says an error found " +
      "after statements are issued is fixed by restating those statements, and ASC 250-10-50-7 " +
      "says the restatement has to be disclosed rather than done quietly.",
    theTrap:
      "Closing early to \u2018get ahead\u2019 before a holiday or a lender deadline. Every hour saved in " +
      "August is repaid with interest in the restatement.",
    whatIWouldDo:
      "Close the month no earlier than the first business day of the next one, once the last bank " +
      "and excise figures are actually in. If a lender wants numbers sooner, send them labelled " +
      "clearly as preliminary \u2014 that costs nothing and commits to nothing.",
    authorityIds: ["ASC_250_10_45_23_RESTATE", "ASC_250_10_45_22_NOT_CURRENT_INCOME"],
  },
  {
    fn: "periodLabel",
    plainEnglish:
      "Writes a month out as something like 2026-08, padding single digits so the list sorts " +
      "properly, and says plainly when it has been handed something that is not a month.",
    whyItExists:
      "Because the earlier version padded blindly and produced labels like \u20182026-NaN\u2019 and " +
      "\u20182026--1\u2019 inside otherwise confident sentences. If this cannot name the period, it says so " +
      "in the label rather than printing something that looks almost right.",
    theTrap:
      "Writing months as 2026-8 instead of 2026-08. Sorted as text, \u201810\u2019 comes before \u20188\u2019, so " +
      "October files itself before August and a year of closes ends up in an order nobody notices " +
      "is wrong.",
    whatIWouldDo:
      "Use this label anywhere a period is shown to a human, so the screen, the export and the " +
      "audit trail all say the month the same way.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    fn: "describeDifference",
    plainEnglish:
      "Puts a difference into plain money and flatly refuses to call it an adjustment.",
    whyItExists:
      "Language does real damage in bookkeeping. The word 'adjustment' makes a difference sound " +
      "resolved when nothing has been resolved \u2014 it has only been named. This function says the " +
      "amount and says it is real.",
    theTrap:
      "Deciding a small difference is not worth chasing. In a cash business a $12 difference is not " +
      "a small version of a $12,000 difference; it is the same event caught early. The cause is " +
      "identical and only the amount happens to differ this time.",
    whatIWouldDo:
      "Count the drawer and the safe again before touching the books at all. Then look for a vendor " +
      "paid out of the till, an owner draw taken in cash, an ATM refill, or a deposit dated a day " +
      "off. It is almost always one of those five.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS", "ASC_250_10_20_ERROR_DEFINED"],
  },
  {
    fn: "__runPeriodCloseCoreTests",
    plainEnglish:
      "The module's own built-in checks, which prove it still behaves before anything trusts it.",
    whyItExists:
      "A module that can prove itself in isolation stays trustworthy even when the test framework " +
      "around it changes. It is a seatbelt that does not depend on the car.",
    theTrap:
      "Believing these replace the real test suite. They do not \u2014 they are a floor, not a ceiling. " +
      "The genuine hostile cases live in the compliance tests, and the defects that actually mattered " +
      "in this codebase were found by attacking a suite that was already green.",
    whatIWouldDo:
      "If this ever fails, stop and read it rather than working around it. It only checks things that " +
      "should be impossible.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
];

export function lessonFor(fn: string): MentorLesson | undefined {
  return PERIOD_CLOSE_LESSONS.find((l) => l.fn === fn);
}

export function taughtFunctionNames(): readonly string[] {
  return PERIOD_CLOSE_LESSONS.map((l) => l.fn);
}

export function citedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of PERIOD_CLOSE_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out];
}

/**
 * Read the exported FUNCTION names out of the core module, from disk.
 *
 * Reading the source rather than importing it is deliberate: an import would
 * only see what the module chose to expose at runtime, whereas the file is the
 * actual truth about what shipped. This is what makes the coverage gate below
 * impossible to satisfy by accident.
 */
