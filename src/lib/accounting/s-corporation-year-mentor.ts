/**
 * src/lib/accounting/s-corporation-year-mentor.ts   (books-21)
 *
 * THE CPA WHO ASKS "SINCE WHEN?" BEFORE TOUCHING THE OPENING BALANCE.
 *
 * Standing rule 26: every engine ships with a mentor layer and every exported
 * function is taught. This module is small, and the lessons are long, because
 * the whole module exists to correct one shipped mistake that I made twice and
 * that cost real money on paper: treating the year this software started as the
 * year the S corporation started.
 *
 * The distinction is boring to state and expensive to get wrong, which is
 * exactly the profile of the thing a mentor layer is for.
 *
 * The coverage gate at the bottom reads the core module FROM DISK and takes an
 * optional path, so a test can point it at a file it controls and prove the
 * gate actually fires (standing rules 16 and 39).
 */

import type { MentorLesson } from "@/lib/accounting/basis-aaa-mentor";

export const S_CORPORATION_YEAR_LESSONS: readonly MentorLesson[] = [
  {
    fn: "validateSElectionFacts",
    plainEnglish:
      "Checks whether we actually know what year Greenway became an S corporation, and refuses to " +
      "let any calculation proceed on a year that was assumed rather than read off a document.",
    whyItExists:
      "Because the alternative already happened. Two shipped slices of this system hardcoded the " +
      "S-corporation start year as 2026 \u2014 which is simply the year these books begin \u2014 and nothing " +
      "anywhere asked whether that was true. It was not. The election dates to roughly 2015 or " +
      "2016, so about ten years of already-taxed retained earnings were being thrown away every " +
      "time the software opened a year.",
    theTrap:
      "Thinking of this as a data-quality nicety. It is not: the year drives whether the " +
      "accumulated adjustments account opens at zero or carries forward, and that single fork " +
      "decides whether a distribution is a tax-free return of previously-taxed income or a " +
      "capital gain. Guess it wrong in the direction I guessed it and the software reports tax on " +
      "money that was already taxed once.",
    whatIWouldDo:
      "Find the oldest Form 1120-S in the filing cabinet and read the tax year off page one. That " +
      "is evidence and it takes five minutes. Do not reconstruct the year from memory of when the " +
      "accountant said it was done, and do not accept a range \u2014 'late 2015 or early 2016' spans " +
      "two different tax years and they give different answers.",
    authorityIds: ["irc-1361-a-s-and-c-corporation-defined", "IRC_1368_DISTRIBUTIONS_AAA"],
  },
  {
    fn: "classifySYear",
    plainEnglish:
      "Answers one question about a fiscal year: is this the first year of the S election, a " +
      "later year, or do we not know enough to say?",
    whyItExists:
      "Almost every rule about opening balances hangs off this one classification, and before this " +
      "module existed the answer was computed inline, differently, in two separate engines. Two " +
      "copies of a rule are two rules, and they drift.",
    theTrap:
      "Assuming the answer is always one of two things. 'Unknown' is a real third answer and it " +
      "has to survive all the way to the user, because the two-valued version of this function " +
      "forces a caller to pick a side on no evidence \u2014 and the side it picks will be whichever one " +
      "the code was written for.",
    whatIWouldDo:
      "Treat an 'unknown' coming out of here as a stop, not a shrug. It means the file is missing " +
      "a document, and the fix is to go and get it rather than to pick the likely answer.",
    authorityIds: ["irc-1361-a-s-and-c-corporation-defined"],
  },
  {
    fn: "aaaMustOpenAtZero",
    plainEnglish:
      "Says whether the accumulated adjustments account should start this year at zero \u2014 which is " +
      "true only in the very first year of the S election, and false in every year after it.",
    whyItExists:
      "The accumulated adjustments account starts at zero when the election starts. That sentence " +
      "is correct and it is the source of the whole problem, because it is true of the FIRST year " +
      "and gets applied to whichever year the software happens to be looking at.",
    theTrap:
      "Reading a rule about a first year as a rule about a starting point. Greenway's 2026 is not " +
      "a first year, it is year ten or eleven, and the balance it opens with is the balance 2025 " +
      "closed with. Forcing it to zero does not lose a bookkeeping detail; it makes ordinary " +
      "distributions of old, already-taxed profit look like they exceeded basis, which turns them " +
      "into reported capital gain under \u00a71368(b)(2).",
    whatIWouldDo:
      "If this ever returns true for a year other than the first, stop and find out why before " +
      "touching anything else. And note that the gate runs in both directions: a non-zero opening " +
      "in a first year is just as wrong as a zero opening in a continuing year, and both are " +
      "refused.",
    authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA", "REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
  },
  {
    fn: "openingBalancesMustBeCarriedForward",
    plainEnglish:
      "Says whether this year's opening balances have to come from last year's closing balances " +
      "rather than being entered by hand.",
    whyItExists:
      "Because the version of this rule that shipped had a hole in it precisely where it mattered " +
      "most. The carry-forward requirement was written as 'applies to years after the first', and " +
      "since the first year was wrongly believed to be 2026, the year Michael is actually working " +
      "in was the one year exempt from every evidence requirement in the module.",
    theTrap:
      "Writing a guard as 'later years must be evidenced' and forgetting that this quietly makes " +
      "the earliest year a free-for-all. If a year is genuinely the first year of the election, " +
      "its opening balances come from the statute (zero) and there is nothing to carry \u2014 but if it " +
      "only LOOKS like the first year because a constant was wrong, that exemption is a hole in " +
      "the middle of the live data.",
    whatIWouldDo:
      "Never type an opening balance that the software could have carried forward. If it will not " +
      "let you, that is the point; the number you were about to type is the number that has to be " +
      "reconciled to something. What is at stake is not tidiness: an unevidenced opening balance " +
      "is the first number an examiner asks about, and it is the one number in the return that " +
      "cannot be recomputed from anything else in the file. If it is wrong, every distribution " +
      "figure downstream of it is wrong too, and the tax on those distributions is wrong with " +
      "them.",
    authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
  },
  {
    fn: "describeOpeningBalanceSource",
    plainEnglish:
      "Writes one plain sentence saying where this year's opening balances came from and why they " +
      "are allowed to be what they are.",
    whyItExists:
      "Standing rule 29: the explanation is part of the deliverable, not decoration on top of it. " +
      "The old wording actively asserted something false \u2014 that there was no basis schedule before " +
      "2026 because there was no S corporation \u2014 and a confident false sentence in a report is " +
      "worse than a blank, because nobody goes looking behind it.",
    theTrap:
      "Explaining a number by describing what the software did instead of what the law requires. " +
      "'Opening balance set to zero for the first year' sounds like a reason and is actually a " +
      "restatement. The useful sentence names the year the election started and where that year " +
      "was read from.",
    whatIWouldDo:
      "Read this sentence before signing the return. If it cannot tell you which document the " +
      "opening figure traces to, the schedule is not ready to sign regardless of whether it " +
      "foots — and it is your signature on the 1120-S, not the software's. A sentence that " +
      "explains where the money came from is the difference between an examiner ticking a box " +
      "and an examiner opening a file.",
    authorityIds: ["REG_1_1368_2_A_5_AAA_ORDERING"],
  },
];

export function findSCorporationYearLesson(fn: string): MentorLesson | undefined {
  return S_CORPORATION_YEAR_LESSONS.find((l) => l.fn === fn);
}

export function taughtSCorporationYearFunctionNames(): readonly string[] {
  return S_CORPORATION_YEAR_LESSONS.map((l) => l.fn);
}

/**
 * The exported function names in the core module, read from disk.
 *
 * Takes an optional path so a test can point it at a fixture and prove the
 * coverage gate below actually fires (standing rule 39: a self-check that
 * re-implements the gate tests nothing).
 */
