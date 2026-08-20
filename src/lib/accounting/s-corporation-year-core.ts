/**
 * src/lib/accounting/s-corporation-year-core.ts   (books-21)
 *
 * WHICH YEAR THE S ELECTION STARTED, AND WHY THAT IS NOT THE SAME QUESTION AS
 * WHICH YEAR THIS SOFTWARE STARTS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS — A DEFECT REPORT
 * ---------------------------------------------------------------------------
 *
 * books-19 and books-20 both declared this:
 *
 *     export const FIRST_S_CORP_YEAR = 2026;
 *
 * once in `basis-aaa-core.ts` and once in `cogs-position-core.ts`. One name,
 * and it was doing THREE unrelated jobs:
 *
 *   1. the earliest year this software will compute anything for  — LEGITIMATE.
 *      That is the standing-rule-10 line in the sand. The books start 2026-01-01
 *      and nothing before that is ours to compute.
 *
 *   2. the year the AAA must open at zero                          — WRONG.
 *      That is a TAX fact about an election, not a fact about software.
 *
 *   3. the year before which "earlier years were filed by the LLC
 *      under different rules"                                      — WRONG,
 *      and worse, factually false about this taxpayer.
 *
 * Michael, on being asked directly rather than guessed at, verbatim:
 *
 *   "I have been an s corp since inception... for as long as I can remember, I
 *   have been a single owner LLC elected to be an s corp. there has never been
 *   an accounting change."
 *
 *   "I would have made the election sometime between late 2015- early 2016."
 *
 * So jobs 2 and 3 were off by about a decade, and the roadmap already recorded
 * the same thing from an earlier session: "Greenway has never been a C
 * corporation, was an S corporation from formation."
 *
 * ---------------------------------------------------------------------------
 * WHY IT COSTS MONEY, AND WHICH DIRECTION
 * ---------------------------------------------------------------------------
 *
 * This is the unusual kind of bug that does not create audit risk. It INVENTS
 * TAX. Follow it through:
 *
 *   - §1.1368-2(a)(1) says the AAA is zero on day one of the first S year.
 *   - The engine believed the first S year was 2026, so it FORCED the 2026
 *     opening AAA to zero and refused any other figure.
 *   - The true 2026 opening AAA is roughly ten years of already-taxed retained
 *     profit — whatever Schedule M-2 of the last filed 1120-S actually says.
 *   - AAA is the measure of what can come out tax free. §1368(b)(1).
 *   - Zeroing it makes ordinary distributions look like they exceed basis, and
 *     §1368(b)(2) then reports the excess as CAPITAL GAIN.
 *
 * The result is Michael paying capital gains tax on his own money, which was
 * already taxed once when it was earned. The basis engine exists specifically
 * to prevent that outcome, and on this one input it was causing it.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, AND WHY IT IS AN INPUT AND NOT A CORRECTED CONSTANT
 * ---------------------------------------------------------------------------
 *
 * The lazy fix is `FIRST_S_CORP_YEAR = 2016`. That would be a guess, and
 * standing rule 1 forbids guesses, but there is a sharper reason to refuse it:
 * MICHAEL DID NOT GIVE ME A YEAR. He gave me "late 2015 - early 2016," which
 * SPANS TWO TAX YEARS. For a calendar-year taxpayer those are two different
 * answers with two different consequences, and the difference is a whole year
 * of AAA. Writing either one down would be inventing a fact he did not state.
 *
 * So:
 *
 *   SYSTEM_START_YEAR   a real constant. 2026. Rule 10. Range checks use this.
 *   sElectionYear       an EVIDENCED INPUT. `number | null`. null REFUSES.
 *
 * and the AAA-opens-at-zero rule attaches to the ELECTION year, never to 2026.
 *
 * The consequence is deliberate and it is the whole point: 2026 becomes an
 * ORDINARY CONTINUING YEAR. Its opening AAA has to be carried in from evidence
 * — Schedule M-2 of the most recently filed 1120-S — exactly like 2027's will
 * be carried in from 2026. There is no longer a magic year that gets to invent
 * its own opening balances.
 *
 * ---------------------------------------------------------------------------
 * ONE MORE DEFECT FOUND WHILE FIXING THIS ONE
 * ---------------------------------------------------------------------------
 *
 * `basis-aaa-core.ts` gated its carry-forward evidence requirement on
 * `fiscalYear > FIRST_S_CORP_YEAR`. Combined with the zero-AAA rule at
 * `=== FIRST_S_CORP_YEAR`, that made 2026 the ONE year with no evidence
 * requirement whatsoever: its AAA was forced to zero, and it was exempt from
 * proving where its opening balances came from. A silent plug (rule 12) sitting
 * inside a missing-evidence hole (rule 11), and neither test suite noticed
 * because both rules were individually correct for a genuine first S year.
 *
 * The exemption is now attached to the ELECTION year too, where it belongs and
 * where it is actually true.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT TOUCH
 * ---------------------------------------------------------------------------
 *
 * `period-close-core.FIRST_FISCAL_YEAR = 2026` and the "fiscal 2026 — the first
 * year" comments in `books-ledger-guidance-core.ts` were both read in full
 * while investigating this. They are about the BOOKS, not the election, and the
 * database agrees with them: `gl_periods check (fiscal_year between 2026 and
 * 2100)`. They are TRUE and they stay. Changing them would be drift (rule 2)
 * dressed up as a fix.
 *
 * Pure data and pure functions. No I/O. Integer years only.
 */
import type { StatementRefusal } from "@/lib/accounting/financial-statements-core";

// ---------------------------------------------------------------------------
// 1) THE ONE HONEST CONSTANT
// ---------------------------------------------------------------------------

/**
 * The first fiscal year this software computes. Standing rule 10's line in the
 * sand: the books start 2026-01-01 and nothing earlier is reconstructed here.
 *
 * THIS IS A FACT ABOUT THE SOFTWARE. It is not a fact about the tax election,
 * and the two must never be spelled the same way again — that conflation is the
 * entire subject of this file's header.
 */
export const SYSTEM_START_YEAR = 2026;

/** The last year the engines will accept. Guards typos like 20226. */
export const LAST_SUPPORTED_YEAR = 2100;

/**
 * The earliest year an S election could plausibly be claimed for.
 *
 * Subchapter S has existed since 1958, but this bound exists to catch a
 * TYPO, not to make a legal ruling: `1015` and `2O16` should be refused rather
 * than quietly producing a hundred-year-long "continuing year" calculation.
 */
export const EARLIEST_PLAUSIBLE_S_ELECTION_YEAR = 1958;

// ---------------------------------------------------------------------------
// 2) THE EVIDENCED INPUT
// ---------------------------------------------------------------------------

/**
 * What is known about when the S election took effect.
 *
 * `year: null` means UNKNOWN, and unknown REFUSES (rule 27). It does not
 * default, does not fall back to the system start year, and does not pick the
 * earlier or later end of a range on the taxpayer's behalf.
 */
export type SElectionFacts = {
  /**
   * The first TAX YEAR for which the S election was effective, or null if not
   * established. For a calendar-year taxpayer this is a calendar year.
   */
  readonly year: number | null;
  /**
   * What the year above was read off. A year with no document behind it is a
   * memory, not evidence (rule 11).
   *
   * Michael's Form 2553 and CP261 cannot be located. He said so plainly and
   * asked not to be sent looking again: "I can't find the physical letter the
   * irs sent back in 2014, but it's somewhere in my records. Please don't make
   * me go find it." A filed 1120-S is an equally good source and he has one —
   * the earliest return in hand states the year, and Schedule M-2 of the latest
   * one carries the AAA forward from it.
   */
  readonly evidenceSource: string | null;
  /**
   * Set this when the only thing known is a RANGE spanning more than one tax
   * year — which is exactly the situation this slice was built in. Recording
   * the range honestly produces a refusal that says what to look for. Recording
   * one end of it as fact produces a silently wrong AAA forever.
   */
  readonly statedRange: string | null;
};

/** Nothing established yet. The state this system starts in, stated out loud. */
export const S_ELECTION_UNKNOWN: SElectionFacts = {
  year: null,
  evidenceSource: null,
  statedRange: null,
};

/**
 * What Michael actually told me, recorded verbatim and NOT resolved.
 *
 * This is deliberately a refusing value. It exists so the ambiguity is a
 * first-class fact in the system with his own words attached, rather than a
 * TODO comment that someone eventually "cleans up" by picking a year.
 */
export const S_ELECTION_AS_STATED_BY_OWNER: SElectionFacts = {
  year: null,
  evidenceSource: null,
  statedRange: "late 2015 - early 2016",
};

// ---------------------------------------------------------------------------
// 3) REFUSALS
// ---------------------------------------------------------------------------

export const S_ELECTION_REFUSAL_CODES = [
  "S_ELECTION_YEAR_UNKNOWN",
  "S_ELECTION_YEAR_AMBIGUOUS",
  "S_ELECTION_YEAR_NOT_EVIDENCED",
  "S_ELECTION_YEAR_IMPLAUSIBLE",
  "S_ELECTION_YEAR_AFTER_FISCAL_YEAR",
] as const;

export type SElectionRefusalCode = (typeof S_ELECTION_REFUSAL_CODES)[number];

/** Same shape as every other refusal in this system, narrowed to these codes. */
export type SElectionRefusal = Omit<StatementRefusal, "code"> & {
  code: SElectionRefusalCode;
};

// ---------------------------------------------------------------------------
// 4) VALIDATION
// ---------------------------------------------------------------------------

/**
 * Everything that must be true about the election facts before any year can be
 * classified as a first year or a continuing year.
 *
 * Returns ALL problems rather than the first. Sending Michael away three times
 * for three documents is three interruptions.
 *
 * `fiscalYear` is optional because two of these checks are about the election
 * facts alone and can be run before a year is even chosen.
 */
export function validateSElectionFacts(
  facts: SElectionFacts,
  fiscalYear?: number,
): readonly SElectionRefusal[] {
  const out: SElectionRefusal[] = [];

  // A stated RANGE is checked before a missing year, because it is the more
  // specific and more useful complaint. "You told me two years" is actionable;
  // "I don't know the year" is not.
  if (facts.year === null && facts.statedRange !== null) {
    out.push({
      code: "S_ELECTION_YEAR_AMBIGUOUS",
      message:
        `The S election was described as "${facts.statedRange}", which spans more than one tax ` +
        `year. A range cannot be used, because the two ends give two different answers.`,
      whatToDo:
        "Two ways to settle it, both easy. Either look at the OLDEST Form 1120-S you have and " +
        "read the tax year off the top of page 1 — the first year you filed an 1120-S instead of " +
        "a Schedule C is the election year — or pull the account transcript from IRS e-Services, " +
        "which shows the year the S election was posted. Nothing here needs the missing Form 2553.",
      authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
    });
  } else if (facts.year === null) {
    out.push({
      code: "S_ELECTION_YEAR_UNKNOWN",
      message:
        "The first year of the S election is not recorded, so this engine cannot tell whether any " +
        "given year is the first S year or a continuing one.",
      whatToDo:
        "That single number decides whether the AAA opens at zero or is carried forward from the " +
        "last return, which decides whether a distribution is tax free or a reported capital gain. " +
        "Read it off the oldest Form 1120-S on hand.",
      authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
    });
  }

  if (facts.year !== null) {
    if (
      !Number.isInteger(facts.year) ||
      facts.year < EARLIEST_PLAUSIBLE_S_ELECTION_YEAR ||
      facts.year > LAST_SUPPORTED_YEAR
    ) {
      out.push({
        code: "S_ELECTION_YEAR_IMPLAUSIBLE",
        message:
          `The S election year was given as ${String(facts.year)}, which is not a whole year ` +
          `between ${EARLIEST_PLAUSIBLE_S_ELECTION_YEAR} and ${LAST_SUPPORTED_YEAR}.`,
        whatToDo:
          "This looks like a typo rather than a disagreement. Check the figure that was entered.",
        authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
      });
    }

    // Rule 11: the year needs a document behind it. Checked separately from
    // plausibility so a well-formed guess still gets caught.
    if (facts.evidenceSource === null || facts.evidenceSource.trim() === "") {
      out.push({
        code: "S_ELECTION_YEAR_NOT_EVIDENCED",
        message:
          `The S election year ${String(facts.year)} was supplied with no source document. A year ` +
          `with nothing behind it is a recollection, not evidence.`,
        whatToDo:
          "Name what it was read off — \"Form 1120-S for 2016, page 1\", \"IRS account transcript " +
          "dated 2026-03-04\", or the CP261 notice if it ever turns up. The point is that somebody " +
          "auditing this in five years can go and look at the same piece of paper.",
        authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
      });
    }

    if (
      fiscalYear !== undefined &&
      Number.isInteger(fiscalYear) &&
      Number.isInteger(facts.year) &&
      facts.year > fiscalYear
    ) {
      out.push({
        code: "S_ELECTION_YEAR_AFTER_FISCAL_YEAR",
        message:
          `The year being computed is ${fiscalYear}, but the S election is recorded as starting ` +
          `in ${String(facts.year)}. There was no S corporation in ${fiscalYear}.`,
        whatToDo:
          "One of the two is wrong. If the election really is later, then this year belongs on a " +
          "Schedule C or an 1120, not on an 1120-S, and none of the basis and AAA machinery " +
          "applies to it.",
        authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 5) THE CLASSIFICATION EVERYTHING ELSE HANGS OFF
// ---------------------------------------------------------------------------

/**
 * Is this year the first S year, or a continuing one?
 *
 * `"unknown"` is a real answer and callers must handle it. Returning a boolean
 * here would have forced exactly the bug this file fixes: `false` and "I don't
 * know" would have been the same value.
 */
export type SYearKind = "first_s_year" | "continuing_s_year" | "unknown";

/**
 * Classify a fiscal year against the election.
 *
 * Deliberately total and deliberately dull. Every interesting decision in the
 * basis engine — whether AAA opens at zero, whether opening balances must be
 * carried forward, whether a prior year even exists — reduces to this one
 * question, and it is answered in exactly one place so the two answers cannot
 * drift apart the way they did in books-19.
 */
export function classifySYear(fiscalYear: number, facts: SElectionFacts): SYearKind {
  if (!Number.isInteger(fiscalYear)) return "unknown";
  if (facts.year === null || !Number.isInteger(facts.year)) return "unknown";
  if (fiscalYear < facts.year) return "unknown";
  return fiscalYear === facts.year ? "first_s_year" : "continuing_s_year";
}

/**
 * True only when the AAA must open at exactly zero.
 *
 * §1.1368-2(a)(1): "On the first day of the first year for which the
 * corporation is an S corporation, the balance of the AAA is zero."
 *
 * Note what this function does NOT do: it does not return `true` when the
 * election year is unknown. The old code effectively did, by comparing against
 * a hardcoded 2026, and that is how a decade of retained earnings got zeroed.
 */
export function aaaMustOpenAtZero(fiscalYear: number, facts: SElectionFacts): boolean {
  return classifySYear(fiscalYear, facts) === "first_s_year";
}

/**
 * True when opening balances must have been carried forward from a computed
 * prior year, rather than typed in.
 *
 * The first S year is exempt because there is nothing to carry from. EVERY
 * other year needs a chain — including 2026, which is the correction. 2026 is
 * a continuing year whose opening AAA comes off Schedule M-2 of the last filed
 * return, and the system now says so instead of forcing it to zero.
 *
 * When the election year is unknown this returns `false`, because a refusal for
 * the unknown election is already being raised and stacking a second, derived
 * complaint on top of it just buries the real one.
 */
export function openingBalancesMustBeCarriedForward(
  fiscalYear: number,
  facts: SElectionFacts,
): boolean {
  return classifySYear(fiscalYear, facts) === "continuing_s_year";
}

/**
 * Plain-English description of where a year's opening balances come from.
 *
 * Standing rule 29: the explanation is part of the deliverable, not a comment.
 * This is the string a screen shows next to an opening AAA figure so Michael
 * can see WHY it is what it is.
 */
export function describeOpeningBalanceSource(fiscalYear: number, facts: SElectionFacts): string {
  switch (classifySYear(fiscalYear, facts)) {
    case "first_s_year":
      return (
        `${fiscalYear} is the first year of the S election, so the AAA opens at exactly zero. ` +
        `That is not a convention, it is 26 CFR §1.1368-2(a)(1).`
      );
    case "continuing_s_year":
      return (
        `${fiscalYear} is a continuing S year — the election started in ${String(facts.year)} — so ` +
        `nothing opens at zero. The opening AAA is the closing AAA from ${fiscalYear - 1}, which ` +
        `for the first year computed here means Schedule M-2 of the ${fiscalYear - 1} Form 1120-S.`
      );
    case "unknown":
      return (
        "The year the S election started is not recorded, so it cannot be said whether this year " +
        "opens at zero or carries balances forward. Nothing will be computed until it is."
      );
  }
}
