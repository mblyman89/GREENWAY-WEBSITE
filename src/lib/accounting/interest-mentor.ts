/**
 * src/lib/accounting/interest-mentor.ts   (books-21)
 *
 * THE CPA WHO KNOWS THAT INTEREST IS NOT A PENALTY AND IS USUALLY WORSE.
 *
 * Standing rule 26: every engine ships with a mentor layer and every exported
 * function is taught.
 *
 * There is a theme running through these lessons and it is worth stating once
 * at the top. Penalties are capped; interest is not. A late-filing penalty
 * stops growing after five months or twelve, but interest compounds daily for
 * as long as the balance exists, and it is charged on the penalties too. People
 * negotiate hard over penalties and ignore interest, which is backwards on any
 * balance more than a year old.
 *
 * The other theme: this module refuses more often than it computes, because the
 * quarterly rate table is empty. That is deliberate and it is explained in
 * every relevant lesson below, since "why won't it just tell me the number" is
 * the first question anyone will have.
 *
 * The coverage gate at the bottom reads the core module FROM DISK and takes an
 * optional path so a test can prove the gate fires (rules 16 and 39).
 */

import type { MentorLesson } from "@/lib/accounting/basis-aaa-mentor";

export const INTEREST_LESSONS: readonly MentorLesson[] = [
  {
    fn: "isIsoDate",
    plainEnglish:
      "Checks that a date is both correctly formatted and a day that actually existed, so " +
      "the 30th of February cannot enter an interest calculation.",
    whyItExists:
      "Interest is priced per day, so a date is an amount of money here, not a label. " +
      "JavaScript's own date handling will happily accept 2026-02-30 and silently roll it " +
      "into the 2nd of March, which moves a period across a quarter boundary and changes " +
      "the rate that applies to it.",
    theTrap:
      "Validating the shape and stopping there. A regular expression that accepts four digits, " +
      "two digits and two digits passes every impossible date in the calendar, and the resulting " +
      "off-by-one is invisible because the answer still looks like an answer.",
    whatIWouldDo:
      "Take dates off documents, not off memory: the notice date, the postmark, the date the " +
      "return was actually filed. Every one of those is written down somewhere and each is worth " +
      "money.",
    authorityIds: ["irc-6622-daily-compounding"],
  },
  {
    fn: "daysBetween",
    plainEnglish:
      "Counts the whole days from one date up to but not including another, and returns a " +
      "negative number if the second date comes first.",
    whyItExists:
      "Every figure this module produces is ultimately this count multiplied out, so it is the " +
      "one place where being one day out is guaranteed to be wrong rather than merely likely.",
    theTrap:
      "Counting in local time. Do that and any period spanning a daylight-saving change gains or " +
      "loses an hour, which rounds into a whole day and shifts the answer. This works entirely in " +
      "UTC for that reason. The related trap is inclusive counting: interest runs from the due " +
      "date up to the payment date, and charging both endpoints adds a day to every calculation.",
    whatIWouldDo:
      "Sanity-check any period longer than a year by counting the years first. If the software " +
      "says 400 days and the notice covers 'the 2024 return paid in 2026', one of them is wrong " +
      "and it is worth two minutes to find out which.",
    authorityIds: ["irc-6622-daily-compounding"],
  },
  {
    fn: "daysInYearOf",
    plainEnglish:
      "Returns 366 in a leap year and 365 otherwise, which is the number the daily rate gets " +
      "divided by.",
    whyItExists:
      "\u00a76622 says interest is compounded daily and does not name a denominator. The IRS uses the " +
      "actual number of days in the year, so a leap year genuinely divides by 366 and a daily rate " +
      "hardcoded at 365ths overstates the charge every fourth year.",
    theTrap:
      "Writing the leap rule as 'divisible by four'. That is right for 2024 and 2028 and wrong for " +
      "1900 and 2100, and since these books run to 2100 the error is inside the supported range " +
      "rather than safely theoretical. The full rule needs the century and four-century exceptions.",
    whatIWouldDo:
      "Nothing, day to day. This is here because it is the kind of detail that is free to get " +
      "right now and expensive to discover in a reconciliation later.",
    authorityIds: ["irc-6622-daily-compounding"],
  },
  {
    fn: "quarterOf",
    plainEnglish:
      "Says which calendar quarter a date falls in, because the interest rate changes every " +
      "quarter and nothing else about the calculation does.",
    whyItExists:
      "\u00a76621(b) has the rate reset quarterly. A period of any length therefore has several rates " +
      "in it, and this is what finds the seams.",
    theTrap:
      "Confusing the quarter the rate changes in with the quarter a payroll return covers. This " +
      "module's quarters are pure calendar quarters used for pricing; they have nothing to do " +
      "with the 941 filing periods elsewhere in this system, even though both are called Q1.",
    whatIWouldDo:
      "When reading an IRS interest computation, check the rate changes line up with quarter " +
      "boundaries. If a rate changes mid-quarter on their schedule, one of the two calculations " +
      "has the wrong revenue ruling.",
    authorityIds: ["irc-6621-b-federal-short-term-rate"],
  },
  {
    fn: "compoundDailyInterestCents",
    plainEnglish:
      "Grows a balance day by day at one rate and returns the interest earned, rounding to whole " +
      "cents exactly once at the very end.",
    whyItExists:
      "This is the sentence in \u00a76622 that most people skip: interest is compounded daily. Not " +
      "annually, not simply. On ten thousand dollars at seven per cent for one year that is " +
      "$725.01 rather than $700.00, and the gap widens the longer the balance sits \u2014 over two " +
      "years at ten per cent it is more than two thousand dollars.",
    theTrap:
      "Rounding to cents each day. It looks more careful and it is worse: three hundred and " +
      "sixty-five roundings introduce a drift that no amount of checking will locate, because " +
      "every intermediate figure is individually defensible. Round once, at the end, and never " +
      "before.",
    whatIWouldDo:
      "Never estimate interest as balance times rate in your head and treat it as close enough. " +
      "It is systematically low, and it is low in the direction that makes deferring a payment " +
      "look cheaper than it is.",
    authorityIds: ["irc-6622-daily-compounding"],
  },
  {
    fn: "rateKindFor",
    plainEnglish:
      "Picks which of the five \u00a76621 rates applies, and refuses the punitive one when the " +
      "taxpayer is not a C corporation.",
    whyItExists:
      "\u00a76621 defines five rates, not two, and the differences are not symmetric. Underpayments " +
      "are three points over the short-term rate for everybody. Overpayments are three points for " +
      "an individual but only two for a corporation, and just half a point on the portion of a " +
      "corporate refund above ten thousand dollars. The government charges more than it pays, and " +
      "it pays a corporation least of all.",
    theTrap:
      "Collapsing this into one rate, which is what almost every home-made interest calculation " +
      "does. The second trap is subtler and lives in the words: \u00a76621(c)'s punitive 'large " +
      "corporate underpayment' rate is written on a C CORPORATION, while the \u00a76621(a)(1) " +
      "overpayment reduction is written on a CORPORATION. An S corporation is the second but not " +
      "the first, so one flag cannot serve both tests.",
    whatIWouldDo:
      "Know that Greenway cannot be charged the \u00a76621(c) rate at all. \u00a76621(c)(3)(A) restricts it " +
      "to a C corporation and \u00a71361(a)(2) defines a C corporation as one that is not an S " +
      "corporation for the year, so the extra two points are simply unavailable to the IRS here " +
      "however large an assessment gets. Nobody lists that among the reasons to make the " +
      "election, and it is worth real money on a large old balance. The caveat: it lasts exactly " +
      "as long as the election does.",
    authorityIds: [
      "irc-6621-a-2-underpayment-rate",
      "irc-6621-a-1-overpayment-rate",
      "irc-6621-c-large-corporate-underpayment",
      "irc-1361-a-s-and-c-corporation-defined",
    ],
  },
  {
    fn: "computeInterest",
    plainEnglish:
      "Works out the interest on a balance over a period, re-pricing at every quarter boundary " +
      "and compounding straight through the seams, or explains exactly which quarter's rate is " +
      "missing.",
    whyItExists:
      "Because the two obvious ways to do this are both wrong and both produce believable numbers. " +
      "Rating the whole period at one quarter's rate is wrong. Restarting the compounding each " +
      "quarter is also wrong. The right answer re-rates quarterly while carrying the balance " +
      "across, so each quarter opens where the last one closed.",
    theTrap:
      "Filling a gap in the rate table with the previous quarter's rate. It is the obvious " +
      "workaround, it produces arithmetic that reconciles perfectly against itself, and it is " +
      "silently wrong against the IRS. This function refuses instead, and it lists every missing " +
      "quarter at once so the lookup is one trip rather than four.",
    whatIWouldDo:
      "Treat the output as an estimate for planning until it has been checked against an IRS " +
      "notice, because the rate table has to be loaded from revenue rulings and those are the one " +
      "input here that cannot be derived. And when a notice arrives, compare the rate segments " +
      "rather than the total \u2014 if the totals differ, the segments say why.",
    authorityIds: ["irc-6621-b-federal-short-term-rate", "irc-6622-daily-compounding"],
  },
  {
    fn: "computeSection6699Penalty",
    plainEnglish:
      "Works out the penalty for filing Form 1120-S late: a fixed amount per shareholder per " +
      "month, up to twelve months, with no reference whatsoever to how much tax is owed.",
    whyItExists:
      "Because this system could not see this penalty at all. Asked what a year-late 1120-S cost, " +
      "it applied \u00a76651 \u2014 a percentage of the tax shown on the return \u2014 to an S corporation, " +
      "which normally shows no tax, and answered zero. That was measured, not assumed. A system " +
      "that reports a real five-figure exposure as nothing does not merely fail to warn; it " +
      "recommends the thing it exists to prevent.",
    theTrap:
      "Assuming no tax means no penalty. \u00a76699 never mentions the tax. Greenway has three " +
      "shareholders, so at the statutory base the exposure is $7,020 for a year, and the actual " +
      "inflation-adjusted figure is higher. Two more traps in the details: the shareholder count " +
      "is everyone who held stock during ANY PART of the year, so a one-day holder counts in full " +
      "for all twelve months and the 85/10/5 split is irrelevant \u2014 a five per cent holder costs " +
      "exactly as much as an eighty-five per cent one. And it is charged per month 'or fraction " +
      "thereof', so there is no such thing as being slightly late.",
    whatIWouldDo:
      "File the 1120-S on time even in a year with nothing to report, and file an extension the " +
      "moment it looks tight \u2014 the extension is free and one day of lateness is not. If a return " +
      "is already late, note that \u00a76699's reasonable-cause defence is broader than \u00a76651's: it " +
      "asks only for reasonable cause, where \u00a76651 also requires that the failure was not due to " +
      "willful neglect. It still has to be argued and documented.",
    authorityIds: ["irc-6699-s-corp-failure-to-file", "irc-6699-e-inflation-adjustment"],
  },
  {
    fn: "section6651MinimumFor",
    plainEnglish:
      "Looks up the minimum late-filing penalty for a return more than sixty days late, and " +
      "refuses if that year's figure has not been loaded.",
    whyItExists:
      "\u00a76651(a) sets a floor under the late-filing penalty: once a return is more than sixty days " +
      "late the penalty is at least a fixed dollar amount, regardless of how small the tax is. " +
      "\u00a76651(j) then inflates that amount every year, so it is a dated fact rather than a " +
      "constant.",
    theTrap:
      "Falling back to the $435 in the statute when the year is missing. I had this backwards " +
      "myself and assumed $435 was simply out of date; it is not, it is the statutory BASE and it " +
      "is correct as such. But using it as the current figure understates the 2026 floor by " +
      "ninety dollars, and the error grows every year. The related trap is the year: what matters " +
      "is the calendar year the return was required to be FILED, not the tax year it covers.",
    whatIWouldDo:
      "Load each year's figure from the revenue procedure as it comes out, and check it is a " +
      "multiple of five dollars \u2014 \u00a76651(j)(2) rounds down to the next lowest five, so a figure " +
      "that is not is a transcription error.",
    authorityIds: ["irc-6651-a-sixty-day-minimum", "irc-6651-j-inflation-adjustment"],
  },
  {
    fn: "validateSection6651Rows",
    plainEnglish:
      "Checks a table of minimum-penalty figures against the statute's own rounding rule and " +
      "reports everything wrong with it at once.",
    whyItExists:
      "The figures in this system came out of Michael's notes rather than off a document, and " +
      "\u00a76651(j)(2) happens to provide a mechanical test they must pass: every adjusted amount is " +
      "a multiple of five dollars. That is a free check on hand-entered data, and it either passes " +
      "or it finds a typo. His four figures passed.",
    theTrap:
      "Trusting a number because it looks plausible. $520 and $525 are equally believable to the " +
      "eye and only one of them can be right, since the statute rounds to fives \u2014 and a wrong " +
      "figure here does not contradict anything else in the system, so nothing else will ever " +
      "notice.",
    whatIWouldDo:
      "Run this whenever a year is added, and treat a failure as 'go and read the revenue " +
      "procedure again' rather than 'adjust the check'. Where a rule gives you a cheap way to " +
      "test your own data, use it every time.",
    authorityIds: ["irc-6651-j-inflation-adjustment"],
  },
];

export function findInterestLesson(fn: string): MentorLesson | undefined {
  return INTEREST_LESSONS.find((l) => l.fn === fn);
}

export function taughtInterestFunctionNames(): readonly string[] {
  return INTEREST_LESSONS.map((l) => l.fn);
}

