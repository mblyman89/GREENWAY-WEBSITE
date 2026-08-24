/**
 * src/lib/accounting/interest-authorities.ts   (books-21)
 *
 * INTEREST, THE S-CORPORATION FILING PENALTY, AND THE FOUR THINGS MICHAEL'S
 * SUMMARY GOT WRONG OR LEFT OUT.
 *
 * Michael supplied the rate structure and the inflation-adjusted minimums from
 * his own notes and asked, verbatim: "The rates are available publicly I think,
 * so we should add the text in verbatim so we have it available to us if
 * needed." He also said, in the same breath, "never guess, never assume."
 *
 * Standing rule 1 does not carve out an exception for the owner. So every one
 * of his figures was checked against the statute rather than transcribed, and
 * the statute is mirrored in `docs/authorities/federal/` so rule 35 can verify
 * these quotes by machine instead of by careful typing. That check found four
 * things worth his attention:
 *
 *  1. §6621(c)'s extra FIVE points \u2014 the "large corporate underpayment" rate \u2014
 *     applies only to a C CORPORATION. Greenway is an S corporation, so it
 *     cannot apply. My own plan for this slice had it the other way round and
 *     was about to build an exposure he is immune from.
 *
 *  2. The overpayment and underpayment rates are NOT mirror images, and the
 *     asymmetry runs against the taxpayer. Underpayments are short-term plus 3
 *     for everybody. Overpayments are plus 3 for an individual but only plus 2
 *     for a CORPORATION, dropping to plus 0.5 on the part above $10,000. He
 *     told me he has had refunds, so this is live for him.
 *
 *  3. The $435 in the shipped engine is NOT stale. It is the statutory base in
 *     §6651(a), and §6651(j) adjusts it for inflation. His 450/485/525/525 are
 *     the adjusted figures. Both numbers are right; they are different things.
 *
 *  4. §6699 \u2014 the penalty for filing an 1120-S late \u2014 did not exist anywhere in
 *     this codebase. That is the one that actually applies to him, and it is
 *     charged per shareholder per month regardless of tax due. See the note on
 *     IRC_6699_S_CORP_FAILURE_TO_FILE below; it is the most valuable authority
 *     in this file.
 *
 * PURE DATA. No I/O, no clock, no server imports.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) §6621 — WHAT THE RATE IS
// ---------------------------------------------------------------------------

/**
 * The underpayment rate. Short-term plus three, for everyone.
 *
 * Note what is ABSENT: there is no corporate variant in (a)(2). Compare
 * (a)(1)(B), which has one. That asymmetry is the subject of the next record.
 */
export const IRC_6621_A2_UNDERPAYMENT_RATE: GuidanceAuthority = {
  id: "irc-6621-a-2-underpayment-rate",
  kind: "statute",
  cite: "26 U.S.C. §6621(a)(2)",
  quote:
    "The underpayment rate established under this section shall be the sum of— (A) the Federal " +
    "short-term rate determined under subsection (b), plus (B) 3 percentage points.",
  soWhat:
    "This is the rate on anything Michael owes late, to any federal tax, and it is the same three " +
    "points whether the debt is his personally or the company's. Two practical consequences. First, " +
    "the rate is NOT fixed \u2014 it is pegged to the federal short-term rate, which the Secretary " +
    "resets every quarter, so a balance sitting unpaid for two years has been charged at eight " +
    "different rates and there is no single number to multiply by. Second, and this is the one that " +
    "surprises people, the rate here is entirely separate from the failure-to-pay PENALTY of 0.5% a " +
    "month. Interest and penalty run at the same time, on the same money, and they are added " +
    "together. This system keeps them in separate columns for exactly that reason.",
  source: "https://www.law.cornell.edu/uscode/text/26/6621",
};

/**
 * ⭐ THE ASYMMETRY. Read this one against the record above.
 *
 * Michael's summary treated overpayment and underpayment as one rate structure.
 * They are not, and the difference is in the government's favour on both sides:
 * you are paid less on a refund than you are charged on a debt, and if you are a
 * corporation you are paid less still.
 */
export const IRC_6621_A1_OVERPAYMENT_RATE: GuidanceAuthority = {
  id: "irc-6621-a-1-overpayment-rate",
  kind: "statute",
  cite: "26 U.S.C. §6621(a)(1)",
  quote:
    "The overpayment rate established under this section shall be the sum of— (A) the Federal " +
    "short-term rate determined under subsection (b), plus (B) 3 percentage points (2 percentage " +
    "points in the case of a corporation). To the extent that an overpayment of tax by a corporation " +
    "for any taxable period (as defined in subsection (c)(3), applied by substituting " +
    "\u201coverpayment\u201d for \u201cunderpayment\u201d) exceeds $10,000, subparagraph (B) shall be applied by " +
    "substituting \u201c0.5 percentage point\u201d for \u201c2 percentage points\u201d.",
  soWhat:
    "Three different overpayment rates hide in this one paragraph, and which one applies depends on " +
    "WHOSE tax was overpaid, not on who wrote the cheque. If Michael overpays his own 1040 he is " +
    "paid short-term plus 3. If Greenway overpays its 941 it is paid short-term plus 2 \u2014 and only " +
    "plus 0.5 on the slice above $10,000, which is a rate low enough to lose money to inflation. " +
    "Note the parenthetical says \u201ca corporation\u201d, not \u201ca C corporation\u201d, so being an S " +
    "corporation does not help here (contrast \u00a76621(c), which does say C corporation and therefore " +
    "does not apply to Greenway at all). The practical lesson is unglamorous and worth real money: " +
    "a large overpayment left sitting with the IRS is a bad place to keep cash. Deliberately " +
    "overpaying to build a cushion earns half a point above short-term. Do not use the IRS as a " +
    "savings account.",
  source: "https://www.law.cornell.edu/uscode/text/26/6621",
};

/**
 * ⭐ THE ONE THAT DOES NOT APPLY, AND THAT IS WHY IT IS HERE.
 *
 * An authority is worth recording when it proves an exposure is ABSENT, not
 * only when it creates one. My own plan for this slice asserted that the extra
 * five points applied to Greenway. It does not, and this quote is the proof.
 * Without it the next person to read the plan makes the same mistake.
 */
export const IRC_6621_C_LARGE_CORPORATE_UNDERPAYMENT: GuidanceAuthority = {
  id: "irc-6621-c-large-corporate-underpayment",
  kind: "statute",
  cite: "26 U.S.C. §6621(c)",
  quote:
    "For purposes of determining the amount of interest payable under section 6601 on any large " +
    "corporate underpayment for periods after the applicable date, paragraph (2) of subsection (a) " +
    "shall be applied by substituting \u201c5 percentage points\u201d for \u201c3 percentage points\u201d. ... The " +
    "term \u201clarge corporate underpayment\u201d means any underpayment of a tax by a C corporation for " +
    "any taxable period if the amount of such underpayment for such period exceeds $100,000.",
  soWhat:
    "This is the \u201chot interest\u201d rate, and it is the single most expensive interest provision in " +
    "the Code \u2014 five points over short-term instead of three, running from thirty days after the " +
    "IRS sends its first notice. GREENWAY CANNOT BE CHARGED IT. The definition says \u201ca C " +
    "corporation\u201d, and \u00a71361(a)(2) defines a C corporation as one that is not an S corporation " +
    "for the year. Greenway has been an S corporation since about 2015. This is a genuine, " +
    "quantifiable benefit of the election that nobody ever mentions when listing the reasons to " +
    "make it. It is recorded here so that no future version of this system, and no adviser reading " +
    "it, quietly adds two points to Michael's exposure on a large assessment. The caution attached " +
    "is narrow but real: this protection depends entirely on the S election remaining valid. Blow " +
    "the election \u2014 a disqualifying shareholder, a second class of stock \u2014 and the company becomes " +
    "a C corporation retroactively for that year, at which point this rate switches on along with " +
    "everything else.",
  source: "https://www.law.cornell.edu/uscode/text/26/6621",
};

/**
 * How the rate is set and, critically, WHEN it changes. This is the record that
 * justifies refusing to compute interest for a quarter whose rate is not loaded.
 */
export const IRC_6621_B_FEDERAL_SHORT_TERM_RATE: GuidanceAuthority = {
  id: "irc-6621-b-federal-short-term-rate",
  kind: "statute",
  cite: "26 U.S.C. §6621(b)",
  quote:
    "General rule. The Secretary shall determine the Federal short-term rate for the first month in " +
    "each calendar quarter. ... Period during which rate applies. (A) In general. Except as provided " +
    "in subparagraph (B), the Federal short-term rate determined under paragraph (1) for any month " +
    "shall apply during the first calendar quarter beginning after such month. ... Federal " +
    "short-term rate. The Federal short-term rate for any month shall be the Federal short-term " +
    "rate determined during such month by the Secretary in accordance with section 1274(d). Any " +
    "such rate shall be rounded to the nearest full percent (or, if a multiple of \u00bd of 1 percent, " +
    "such rate shall be increased to the next highest full percent).",
  soWhat:
    "The rate is a QUARTERLY FACT published in a revenue ruling, not a formula this system can " +
    "derive. That is why interest here refuses when a quarter is missing instead of carrying the " +
    "last known rate forward. Carrying it forward is the classic failure: the arithmetic reconciles " +
    "perfectly against itself and is silently wrong against the IRS, which is the worst kind of " +
    "wrong because nothing looks broken. Two details in the text repay attention. The rate is set " +
    "from the month BEFORE the quarter it applies to, so it is always knowable in advance \u2014 there " +
    "is never a good reason to guess it. And the rounding rule is quietly one-directional: a rate " +
    "that lands exactly on a half point is rounded UP, never down.",
  source: "https://www.law.cornell.edu/uscode/text/26/6621",
};

// ---------------------------------------------------------------------------
// 2) §6622 — DAILY COMPOUNDING
// ---------------------------------------------------------------------------

/**
 * ⭐ MICHAEL DID NOT MENTION THIS AT ALL, and it is the provision that turns a
 * manageable balance into a painful one. It is short enough to quote in full.
 */
export const IRC_6622_DAILY_COMPOUNDING: GuidanceAuthority = {
  id: "irc-6622-daily-compounding",
  kind: "statute",
  cite: "26 U.S.C. §6622",
  quote:
    "(a) General rule. In computing the amount of any interest required to be paid under this title " +
    "or sections 1961(c)(1) or 2411 of title 28, United States Code, by the Secretary or by the " +
    "taxpayer, or any other amount determined by reference to such amount of interest, such " +
    "interest and such amount shall be compounded daily. (b) Exception for penalty for failure to " +
    "file estimated tax. Subsection (a) shall not apply for purposes of computing the amount of any " +
    "addition to tax under section 6654 or 6655.",
  soWhat:
    "\u201cCompounded daily\u201d is the difference between an annoyance and a problem. At 7% simple " +
    "interest a debt grows 7% in a year; compounded daily it grows about 7.25%, and over five years " +
    "the gap widens to roughly six percentage points of the original balance. Every online penalty " +
    "calculator that quotes you a simple-interest figure is understating what you owe, and it is " +
    "understating it more the longer the debt has run. Two things follow. First, this system " +
    "compounds daily rather than describing the compounding in a footnote, because a number that is " +
    "quietly low is worse than no number. Second, note subsection (b): the estimated-tax additions " +
    "under \u00a76654 and \u00a76655 are expressly carved out and do NOT compound. Applying daily " +
    "compounding to an estimated-tax penalty would overstate it, so this engine keeps that carve-out " +
    "explicit rather than treating \u201cdaily\u201d as a universal rule.",
  source: "https://www.law.cornell.edu/uscode/text/26/6622",
};

// ---------------------------------------------------------------------------
// 3) §6651 — THE MINIMUM, AND WHY $435 WAS NEVER WRONG
// ---------------------------------------------------------------------------

/**
 * The statutory base figure. Quoted so the number in the engine can be proved
 * to be the statute rather than a stale copy of a revenue procedure.
 */
export const IRC_6651_A_SIXTY_DAY_MINIMUM: GuidanceAuthority = {
  id: "irc-6651-a-sixty-day-minimum",
  kind: "statute",
  cite: "26 U.S.C. §6651(a)",
  quote:
    "In the case of a failure to file a return of tax imposed by chapter 1 within 60 days of the " +
    "date prescribed for filing of such return (determined with regard to any extensions of time " +
    "for filing), unless it is shown that such failure is due to reasonable cause and not due to " +
    "willful neglect, the addition to tax under paragraph (1) shall not be less than the lesser of " +
    "$435 or 100 percent of the amount required to be shown as tax on such return.",
  soWhat:
    "Sixty days is a cliff, not a slope. Up to day sixty the failure-to-file penalty is a percentage " +
    "of the tax; past it there is a floor. But read the floor carefully, because it is \u201cthe LESSER " +
    "of\u201d: the minimum is capped at 100% of the tax due, so on a return showing no tax the minimum " +
    "is nothing. For an S corporation, which normally shows no tax because the income passes " +
    "through, this provision is close to toothless \u2014 and that is precisely why Congress enacted " +
    "\u00a76699 separately. If you take one thing from this record, take that: \u00a76651 is not the " +
    "provision that punishes a late 1120-S.",
  source: "https://www.law.cornell.edu/uscode/text/26/6651",
};

/**
 * The inflation mechanism. This is the record that reconciles the $435 in the
 * statute with the $525 on Michael's list — they are not in conflict.
 */
export const IRC_6651_J_INFLATION_ADJUSTMENT: GuidanceAuthority = {
  id: "irc-6651-j-inflation-adjustment",
  kind: "statute",
  cite: "26 U.S.C. §6651(j)",
  quote:
    "In general. In the case of any return required to be filed in a calendar year beginning after " +
    "2020, the $435 dollar amount under subsection (a) shall be increased by an amount equal to " +
    "such dollar amount multiplied by the cost-of-living adjustment determined under section 1(f)(3) " +
    "for the calendar year determined by substituting \u201ccalendar year 2019\u201d for \u201ccalendar year " +
    "2016\u201d in subparagraph (A)(ii) thereof. (2) Rounding. If any amount adjusted under paragraph " +
    "(1) is not a multiple of $5, such amount shall be rounded to the next lowest multiple of $5.",
  soWhat:
    "This settles an apparent contradiction that would otherwise look like a bug. The statute says " +
    "$435; the figure actually in force for 2026 is $525. Both are correct \u2014 $435 is the BASE and " +
    "this subsection inflates it, with the result published annually in a revenue procedure. So the " +
    "$435 that has been sitting in this codebase since books-16 was never stale; what was missing " +
    "was the adjustment layer, which needs an evidenced figure per year and now has one. Two " +
    "consequences for how this is built. The adjusted amount turns on the year the return was " +
    "REQUIRED TO BE FILED, not the tax year it covers, so a 2025 return filed late in 2026 uses the " +
    "2026 figure. And because the rounding is to the next LOWEST multiple of $5, every valid figure " +
    "is divisible by 5 \u2014 which is a cheap, genuine check on any number someone types in, and one " +
    "that Michael's own list of 450/485/525/525 passes.",
  source: "https://www.law.cornell.edu/uscode/text/26/6651",
};

// ---------------------------------------------------------------------------
// 4) §6699 — THE PENALTY THAT ACTUALLY APPLIES TO GREENWAY
// ---------------------------------------------------------------------------

/**
 * ⭐⭐ THE MOST IMPORTANT RECORD IN THIS FILE.
 *
 * Found by grepping the codebase for "6699" and getting zero hits, then proving
 * the consequence: the shipped engine, asked what a year-late 1120-S costs,
 * answered $0.00, because §6651 is a percentage of a tax that an S corporation
 * does not show. The true floor for Greenway is $195 × 3 shareholders × 12
 * months before inflation adjustment.
 *
 * A system that reports a real penalty as zero does not merely fail to warn.
 * It actively encourages the behaviour it exists to prevent.
 */
export const IRC_6699_S_CORP_FAILURE_TO_FILE: GuidanceAuthority = {
  id: "irc-6699-s-corp-failure-to-file",
  kind: "statute",
  cite: "26 U.S.C. §6699",
  quote:
    "(a) General rule. In addition to the penalty imposed by section 7203 (relating to willful " +
    "failure to file return, supply information, or pay tax), if any S corporation required to file " +
    "a return under section 6037 for any taxable year— (1) fails to file such return at the time " +
    "prescribed therefor (determined with regard to any extension of time for filing), or (2) files " +
    "a return which fails to show the information required under section 6037, such S corporation " +
    "shall be liable for a penalty determined under subsection (b) for each month (or fraction " +
    "thereof) during which such failure continues (but not to exceed 12 months), unless it is shown " +
    "that such failure is due to reasonable cause. (b) Amount per month. For purposes of subsection " +
    "(a), the amount determined under this subsection for any month is the product of— (1) $195, " +
    "multiplied by (2) the number of persons who were shareholders in the S corporation during any " +
    "part of the taxable year.",
  soWhat:
    "This is the provision that makes filing the 1120-S on time matter, and it works nothing like " +
    "the penalties most people have in mind. It is not a percentage of anything. There is no tax in " +
    "the formula at all, so a return showing zero tax \u2014 which is what a normal S-corporation return " +
    "shows, because the income goes onto the shareholders' 1040s \u2014 carries exactly the same penalty " +
    "as one showing a million. For Greenway the arithmetic is $195, adjusted for inflation, times " +
    "FOUR shareholders \u2014 the number box I of the filed Form 1120-S reports \u2014 times every month " +
    "or part month it is late, capped at twelve. At the statutory base that is $9,360 for a return " +
    "with no tax due on it. Three details " +
    "that cost real money if missed. \u201cFraction thereof\u201d means one day late is a full month, so " +
    "there is no such thing as being slightly late. The multiplier counts anyone who was a " +
    "shareholder \u201cduring any part of the taxable year\u201d, so adding a shareholder for a single day " +
    "in January increases the monthly penalty for all twelve months \u2014 a real consideration before " +
    "moving stock around. And it applies to a return that is FILED but incomplete, not just to one " +
    "never filed: \u00a76037 requires each shareholder's Schedule K-1, so a return missing a K-1 is " +
    "exposed to the same penalty as one that never arrived. The one piece of good news is the " +
    "defence, which is broader than usual: \u00a76699(a) requires only \u201creasonable cause\u201d and, unlike " +
    "\u00a76651, does not add \u201cand not due to willful neglect\u201d.",
  source: "https://www.law.cornell.edu/uscode/text/26/6699",
};

/**
 * The inflation adjustment for §6699, and the reason this engine refuses rather
 * than computing with the $195 base.
 */
export const IRC_6699_E_INFLATION_ADJUSTMENT: GuidanceAuthority = {
  id: "irc-6699-e-inflation-adjustment",
  kind: "statute",
  cite: "26 U.S.C. §6699(e)",
  quote:
    "In general. In the case of any return required to be filed in a calendar year beginning after " +
    "2014, the $195 dollar amount under subsection (b)(1) shall be increased by an amount equal to " +
    "such dollar amount multiplied by the cost-of-living adjustment determined under section 1(f)(3) " +
    "for the calendar year determined by substituting \u201ccalendar year 2013\u201d for \u201ccalendar year " +
    "2016\u201d in subparagraph (A)(ii) thereof. (2) Rounding. If any amount adjusted under paragraph " +
    "(1) is not a multiple of $5, such amount shall be rounded to the next lowest multiple of $5.",
  soWhat:
    "The $195 in subsection (b) has not been the operative figure since 2014. Like the \u00a76651 " +
    "minimum it is inflated annually and published in a revenue procedure, and the adjustment is " +
    "large after a decade \u2014 enough that using the base figure would understate a twelve-month " +
    "exposure by a meaningful amount. That is why this engine will not compute a \u00a76699 penalty " +
    "from the statutory base: it demands the evidenced per-shareholder amount for the year the " +
    "return was due, and refuses if it does not have it. As with \u00a76651(j), the amount turns on the " +
    "calendar year the return was REQUIRED to be filed rather than the tax year, and the " +
    "next-lowest-$5 rounding means any valid figure is divisible by 5.",
  source: "https://www.law.cornell.edu/uscode/text/26/6699",
};

// ---------------------------------------------------------------------------
// 5) §1361 — WHY §6621(c) CANNOT REACH GREENWAY
// ---------------------------------------------------------------------------

/**
 * The definitional link. §6621(c) says "C corporation"; this says what that
 * means. Without this record the conclusion in
 * IRC_6621_C_LARGE_CORPORATE_UNDERPAYMENT is an assertion.
 */
export const IRC_1361_A_S_AND_C_DEFINED: GuidanceAuthority = {
  id: "irc-1361-a-s-and-c-corporation-defined",
  kind: "statute",
  cite: "26 U.S.C. §1361(a)",
  quote:
    "S corporation defined. (1) In general. For purposes of this title, the term \u201cS " +
    "corporation\u201d means, with respect to any taxable year, a small business corporation for which " +
    "an election under section 1362(a) is in effect for such year. (2) C corporation. For purposes " +
    "of this title, the term \u201cC corporation\u201d means, with respect to any taxable year, a " +
    "corporation which is not an S corporation for such year.",
  soWhat:
    "Two words in this definition are load-bearing for everything above: \u201cfor purposes of this " +
    "title\u201d and \u201cfor such year\u201d. The first means the definition reaches all the way into the " +
    "penalty and interest provisions in Subtitle F, which is what lets us say with confidence that " +
    "\u00a76621(c)'s extra five points cannot apply to Greenway. The second is the warning: S or C " +
    "status is determined YEAR BY YEAR. It is not a permanent attribute of the company. If the " +
    "election were ever broken, that year would be a C year for every purpose in the Code, and the " +
    "protections that depend on S status \u2014 including immunity from hot interest \u2014 would vanish for " +
    "that year retroactively. Which is also why this system refuses to compute anything until it " +
    "knows which years the election actually covers.",
  source: "https://www.law.cornell.edu/uscode/text/26/1361",
};

// ---------------------------------------------------------------------------
// 6) THE SLICE'S REGISTRY CONTRIBUTION
// ---------------------------------------------------------------------------

/** Everything this slice adds to the one shared registry. */
export const INTEREST_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  IRC_6621_A2_UNDERPAYMENT_RATE,
  IRC_6621_A1_OVERPAYMENT_RATE,
  IRC_6621_C_LARGE_CORPORATE_UNDERPAYMENT,
  IRC_6621_B_FEDERAL_SHORT_TERM_RATE,
  IRC_6622_DAILY_COMPOUNDING,
  IRC_6651_A_SIXTY_DAY_MINIMUM,
  IRC_6651_J_INFLATION_ADJUSTMENT,
  IRC_6699_S_CORP_FAILURE_TO_FILE,
  IRC_6699_E_INFLATION_ADJUSTMENT,
  IRC_1361_A_S_AND_C_DEFINED,
] as const;

/** Look up one authority introduced by this slice. Undefined, never a throw. */
export function findInterestAuthority(id: string): GuidanceAuthority | undefined {
  return INTEREST_AUTHORITIES_NEW.find((a) => a.id === id);
}
