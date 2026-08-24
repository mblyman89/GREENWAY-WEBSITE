/**
 * src/lib/payroll/form-941-authorities.ts   (books-40)
 *
 * THE LAW THAT MAKES THE QUARTERLY RETURN A DUTY, TRANSCRIBED WORD FOR WORD.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Then - books-40: quarterly filings. 941 first, since it is due first and
 *    is mostly summation; then the ESD and L&I quarterly reports."
 *
 * Michael is right that the 941 is "mostly summation", and that is precisely
 * what makes it dangerous. A form that is mostly addition invites the belief
 * that it is entirely addition, and the two lines that are NOT addition -
 * the number-of-employees count on line 1 and the fractions-of-cents
 * adjustment on line 7 - are exactly the two lines a summing program gets
 * wrong. Both are quoted below in the government's own words so that the code
 * downstream can be checked against the source rather than against my memory
 * of the source.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * Twelve deposit-schedule and Schedule B authorities already exist in
 * `payroll-tax-authorities.ts` - PUB15_LOOKBACK_PERIOD, PUB15_SCHEDULE_B_REQUIRED,
 * PUB15_SEMIWEEKLY_SPANNING_QUARTERS and nine more - and the FICA rate and wage
 * base authorities (IRC_3101, IRC_3111, SSA_2026_WAGE_BASE) are there too.
 * Standing rule 25 says extend, do not duplicate, so this file quotes only the
 * texts that registry does not already carry: the duty to FILE, the date it is
 * due, the weekend/holiday shift, and the four line-level instructions the
 * return's own arithmetic depends on. `form941Authorities()` hands back both
 * sets together, so a reader gets the whole picture from one call without the
 * same paragraph being maintained in two places.
 *
 * TRANSCRIPTION NOTE. Every `quote` below was taken from the live source on the
 * date this file was written, by fetching the page and extracting the text
 * mechanically rather than retyping it. Curly apostrophes in the originals are
 * rendered as ASCII apostrophes to match the rest of this codebase; no other
 * character has been changed, and no sentence has been shortened without an
 * explicit ellipsis. Standing rule 24: the quote is sacred.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * books-48 — THE PARAGRAPH ABOVE WAS NOT TRUE, AND NOTHING TOLD US FOR EIGHT
 * SLICES. WHAT WENT WRONG, AND WHY IT COULD NOT BE SEEN.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * All four line-level cites in §2 were originally written as:
 *
 *     "IRS, Instructions for Form 941, line 1 (...)"
 *          ^                              ^^^^^^^^
 *          comma after IRS                and no year, anywhere
 *
 * `sourceFileFor` in `scripts/verify-verbatim-quotes.ts` routes IRS form
 * instructions on this pattern:
 *
 *     /^IRS Instructions for Forms? ([\w-]+(?: and [\w-]+)?) \((\d{4})\)/
 *
 * That pattern needs "IRS Instructions" with NO comma, and it needs a
 * four-digit year in parentheses. Our cites had a comma and no year, so the
 * regex did not match, so `sourceFileFor` returned null.
 *
 * NOW FOLLOW WHAT HAPPENS TO A NULL. The verifier asks `expectedCorpusFile`
 * whether the citation at least BELONGS to a mirrored corpus, because a
 * citation that belongs to one and has no file is an error worth failing on.
 * But `expectedCorpusFile` routes on the very same table of regexes — so it
 * returned null too. Two nulls in a row are read as "this is a document we
 * simply do not mirror", the honest skip, and the quote was counted in the
 * cheerful summary line:
 *
 *     "309 verified against local sources, 138 have no local copy to check
 *      against"
 *
 * `docs/authorities/federal/irs-instructions-941-2026.txt` has been on disk
 * the entire time. Four quotes about the four lines this form's arithmetic
 * actually depends on sat inside that "138", unchecked, behind a green line
 * saying RULE 24/35 VERIFICATION PASSED.
 *
 * ── AND TWO OF THE FOUR QUOTES WERE IN FACT WRONG ─────────────────────────
 *
 * This is the part that matters, and it is the reason a routing bug is not a
 * cosmetic bug. The moment the cites were corrected and the quotes were
 * actually compared against the file, two of them failed:
 *
 *   LINE 1 — the quote ran "Don't include: Household employees, Employees in
 *   nonpay status..." as flowing prose. The source does not say that. It is a
 *   BULLETED LIST, and each item carries a literal "• " on disk. The bullets
 *   are now transcribed, because a list rendered as a sentence is a
 *   paraphrase, and standing rule 24 does not have a clause about how small
 *   the edit was.
 *
 *   LINE 7 — the quote wrote "lines 5a-5d" with an ASCII HYPHEN. The source
 *   has an EN DASH: "lines 5a–5d". One invisible character, and it is the one
 *   character in the sentence a reader would never think to check.
 *
 * ── THE LESSON, WHICH IS THE WHOLE REASON THIS COMMENT IS THIS LONG ───────
 *
 * A GATE THAT CANNOT ROUTE ITS INPUT DOES NOT REPORT A PROBLEM — IT REPORTS
 * NOTHING, AND NOTHING LOOKS EXACTLY LIKE SUCCESS.
 *
 * The two defects here are causally linked and the order is instructive: the
 * routing hole did not merely coexist with the bad transcriptions, it is what
 * ALLOWED them. Nobody was careless twice. Somebody was careless once, and
 * the check that existed to catch it had been silently switched off by a
 * comma. That is standing rule 39 — a gate that parses nothing approves
 * everything — arriving in the one form it is hardest to notice.
 *
 * ── WHY THIS WAS FIXED IN THE 941 SLICE AND NOT SOONER ────────────────────
 *
 * It was not missed. `tests/compliance/form-940-authorities.test.ts` found the
 * identical hole in the Form 940 cites, fixed its own, and then wrote down, in
 * as many words: "THE SAME HOLE IS OPEN ON FORM 941 TODAY... That is books-40's
 * debt, not this slice's, and standing rule 4 says one feature per pull
 * request, so it is RECORDED here rather than silently fixed in a 940 branch."
 *
 * That is the system working. The debt was named, in a file that runs on every
 * commit, next to the assertion that proves the 940 half is closed. This is
 * the 941 slice; the debt comes due here. `tests/compliance/form-941-authorities.test.ts`
 * now asserts the same thing for this module in BOTH directions (rule 34):
 * every cite must ROUTE to a file that exists, AND every quote must be found
 * in it. Either half alone is decoration.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";

/**
 * THE MIRRORED FILE THESE QUOTES ARE CHECKED AGAINST.
 *
 * Exported for the gate, following the shape `form-940-authorities.ts` settled
 * on. Note the two facts kept in two constants rather than one field: the PATH
 * locates the copy on disk for a machine, the URL is where Michael reads the
 * real thing in a browser. books-43 conflated them and shipped 28 dead links,
 * because `GuidanceAuthority.source` is rendered as `href={a.source}`.
 */
export const FORM_941_SOURCE_PATH =
  "docs/authorities/federal/irs-instructions-941-2026.txt";

export const FORM_941_SOURCE_URL = "https://www.irs.gov/instructions/i941";

/**
 * THE EDITION, AND WHY IT IS IN THE CITE RATHER THAN ASSUMED.
 *
 * The 941 is quarterly, so the IRS revises it by DATE ("Rev. March 2026")
 * rather than by tax year, but the mirrored corpus reduces both shapes to a
 * single year in the filename. The year must therefore be stated in the
 * citation or the quote cannot be routed to an edition at all — which is
 * exactly the failure this file's header describes.
 *
 * It is a constant, not a literal typed four times, so the four cites can
 * never drift onto different editions of the same document.
 */
export const FORM_941_SOURCE_YEAR = 2026;

/** The elision marker. ASCII, spaced, matching the verifier's segmenter exactly. */
export const FORM_941_ELISION = " ... ";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE DUTY TO FILE AT ALL
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE ONE THAT SURPRISES PEOPLE. Note the parenthesis: "whether or not wages
 * are paid therein". The obligation is not triggered quarter by quarter by
 * having a payroll; it is triggered ONCE, by the first payroll ever, and then
 * it repeats until a final return is filed. A quiet quarter is still a return.
 */
export const CFR_31_6011_A_1_MUST_FILE_QUARTERLY: GuidanceAuthority = {
  id: "cfr-31-6011a1-must-file-quarterly",
  kind: "regulation",
  cite: "26 CFR 31.6011(a)-1(a)(1)",
  quote:
    "Except as otherwise provided in paragraphs (a)(3) and (a)(5) of this section and in " +
    "31.6011(a)-5 every employer is required to make a return for the first calendar quarter in " +
    "which the employer pays wages, other than wages for agricultural labor, subject to the tax " +
    "imposed by the Federal Insurance Contributions Act, and is required to make a return for each " +
    "subsequent calendar quarter (whether or not wages are paid therein) until the employer has " +
    "filed a final return in accordance with 31.6011(a)-6. ... Form 941, \"Employer's QUARTERLY " +
    "Federal Tax Return,\" is the form prescribed for making the return required by this paragraph " +
    "(a)(1).",
  soWhat:
    "Greenway's first payroll under this system is 1 January 2027, which lands in Q1 2027. That " +
    "single payroll creates a filing duty for Q1 2027 AND for every quarter after it - Q2, Q3, Q4, " +
    "and on into 2028 - regardless of whether anybody is paid in those quarters. The words in the " +
    "parenthesis are the whole point: a quarter with no payroll is not a quarter with no return, " +
    "it is a quarter with a zero return. The only thing that ever switches the duty off is a FINAL " +
    "return, which is a deliberate act on a specific form, not something that happens by going " +
    "quiet. This is why the screen offers to build a zero return instead of showing an empty page.",
  source:
    "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-C/part-31/subpart-G/section-31.6011(a)-1",
};

/**
 * THE DEADLINE, AND THE TEN-DAY REWARD FOR HAVING DEPOSITED PROPERLY.
 *
 * The second sentence is easy to skim past and is worth real money in
 * breathing room: file by the 10th of the second month IF the deposits were
 * made in full and on time. It is conditional on conduct, not on asking.
 */
export const CFR_31_6071_A_1_WHEN_DUE: GuidanceAuthority = {
  id: "cfr-31-6071a1-when-due",
  kind: "regulation",
  cite: "26 CFR 31.6071(a)-1(a)(1)",
  quote:
    "Except as provided in paragraph (a)(4) of this section, each return required to be made under " +
    "31.6011(a)-1, in respect of the taxes imposed by the Federal Insurance Contributions Act (26 " +
    "U.S.C. 3101-3128), or required to be made under 31.6011(a)-4, in respect of income tax " +
    "withheld, shall be filed on or before the last day of the first calendar month following the " +
    "period for which it is made. A return may be filed on or before the 10th day of the second " +
    "calendar month following such period if timely deposits under section 6302(c) of the Code and " +
    "the regulations have been made in full payment of such taxes due for the period.",
  soWhat:
    "Two dates, not one. The ordinary due date is the last day of the month after the quarter ends " +
    "- 30 April, 31 July, 31 October, 31 January. The extended date is the 10th of the following " +
    "month, and it is EARNED: it applies only if every deposit for the quarter was made on time " +
    "and in full. The software computes both and shows the ordinary one as the deadline, because " +
    "the extension depends on a deposit history the return itself cannot verify. Treating the 10th " +
    "as the deadline and then discovering one late deposit turns a comfortable filing into a late " +
    "one, and lateness on this form is priced by IRC 6651 at 5% of the tax per month.",
  source:
    "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-C/part-31/subpart-G/section-31.6071(a)-1",
};

/**
 * WHY A DUE DATE IS NOT ALWAYS THE DATE ON THE CALENDAR.
 *
 * 30 April 2027 is a Friday, so this rule does not move Greenway's first
 * deadline - but 31 October 2027 is a Sunday, and it does move that one. The
 * rule is mirrored here rather than assumed, because "the deadline is the last
 * day of the month" is true right up until the last day of the month is a
 * Sunday.
 */
export const CFR_301_7503_1_WEEKEND_HOLIDAY_SHIFT: GuidanceAuthority = {
  id: "cfr-301-7503-1-weekend-holiday-shift",
  kind: "regulation",
  cite: "26 CFR 301.7503-1(a)",
  quote:
    "Section 7503 provides that when the last day prescribed under authority of any internal " +
    "revenue law for the performance of any act falls on a Saturday, Sunday, or legal holiday, " +
    "such act shall be considered performed timely if performed on the next succeeding day which " +
    "is not a Saturday, Sunday, or legal holiday. For this purpose, any authorized extension of " +
    "time shall be included in determining the last day for performance of any act.",
  soWhat:
    "The deadline shown on this screen is computed, not copied off a calendar. Q3 2027 ends 30 " +
    "September and would ordinarily be due 31 October 2027 - which is a Sunday - so the real " +
    "deadline is Monday 1 November 2027. The same engine that already knows federal holidays for " +
    "deposit due dates is reused here rather than a second calendar being written, so the two can " +
    "never drift apart and disagree about whether a day is a business day.",
  source: "https://www.ecfr.gov/current/title-26/part-301/section-301.7503-1",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE FOUR LINE-LEVEL INSTRUCTIONS THE ARITHMETIC DEPENDS ON
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LINE 1 IS A HEADCOUNT ON ONE NAMED DAY. IT IS NOT "HOW MANY PEOPLE DID I PAY".
 *
 * This is the first of the two lines a summing program gets wrong, and it is
 * the one that looks most obviously like summation. It is not summation at
 * all: it is a snapshot of a single pay period, the one containing the 12th of
 * the last month of the quarter.
 */
export const I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH: GuidanceAuthority = {
  id: "i941-line-1-pay-period-including-the-12th",
  kind: "irs_guidance",
  cite: `IRS Instructions for Form 941 (${FORM_941_SOURCE_YEAR}), line 1 (Number of Employees Who Received Wages, Tips, or Other Compensation)`,
  /*
   * THE BULLETS ARE PART OF THE QUOTE. books-48.
   *
   * This originally read "Don't include: Household employees, Employees in
   * nonpay status for the pay period, ..." — the five exclusions run together
   * as one sentence. The source is a bulleted list and each item begins with a
   * literal "\u2022 " character on disk:
   *
   *     941. Don't include:
   *     \u2022 Household employees,
   *     \u2022 Employees in nonpay status for the pay period,
   *     \u2022 Farm employees,
   *     \u2022 Pensioners, or
   *     \u2022 Active members of the U.S. Armed Forces.
   *
   * The verifier collapses newlines but NOT the bullet glyphs, so the flowing
   * version did not match. It could not be seen to not match, because the cite
   * did not route — see the header.
   *
   * TRANSCRIBED RATHER THEN ELIDED, DELIBERATELY. The obvious repair is to cut
   * the list out with an ellipsis and quote only the first sentence, which does
   * match. That was rejected: the list IS the instruction. "How many employees"
   * is only answerable once you know pensioners and non-paid staff are excluded,
   * and a quote that drops the five exclusions keeps the part everyone already
   * understands and discards the part that catches errors.
   */
  quote:
    "Enter the number of employees on your payroll for the pay period including March 12, June 12, " +
    "September 12, or December 12, for the quarter indicated at the top of Form 941. Don't include: " +
    "\u2022 Household employees, \u2022 Employees in nonpay status for the pay period, \u2022 Farm employees, " +
    "\u2022 Pensioners, or \u2022 Active members of the U.S. Armed Forces.",
  soWhat:
    "Line 1 is a headcount on one particular day, not a count of everybody paid during the three " +
    "months. If somebody quit in April and somebody else started in May, the June figure counts " +
    "whoever was on the payroll for the pay period containing 12 June and nobody else. Michael " +
    "could easily have twelve people paid across a quarter and a line 1 of nine, and both numbers " +
    "are right. The software therefore computes this from the pay period that contains the 12th " +
    "rather than from the number of people appearing in the quarter's wage detail - and it says " +
    "which date it used, so the answer can be checked.",
  source: FORM_941_SOURCE_URL,
};

/**
 * LINE 2 IS DEFINED BY REFERENCE TO THE W-2, WHICH IS WHY IT IS NOT THE SAME
 * NUMBER AS LINE 5a.
 */
export const I941_LINE_2_MATCHES_W2_BOX_1: GuidanceAuthority = {
  id: "i941-line-2-matches-w2-box-1",
  kind: "irs_guidance",
  cite: `IRS Instructions for Form 941 (${FORM_941_SOURCE_YEAR}), line 2 (Wages, Tips, and Other Compensation)`,
  /*
   * THE THIRD DASH DEFECT, AND THE ONE THAT ARGUES FOR THE STRICTER GATE.
   * books-48.
   *
   * This read "Box 1 - Wages, tips, other compensation". The source prints an
   * EM DASH with no spaces around it: "Box 1\u2014Wages, tips, other compensation".
   *
   * WHY THIS ONE IS DIFFERENT FROM THE OTHER TWO, AND WHY IT WAS STILL WRONG.
   * The central verifier's normaliser folds "\u2014" to "-" and then pads every
   * hyphen to " - " on BOTH sides, so " - " and "\u2014" are equivalent to it. This
   * quote would therefore have passed the central gate the moment the citation
   * was made routable. It was found only because the new gate in
   * `tests/compliance/form-941-authorities.test.ts` normalises more narrowly:
   * whitespace and curly quotes, nothing else.
   *
   * The strict version is the right one, for a reason worth stating. The
   * central normaliser folds dashes because publishers disagree about spacing
   * around a dash introducing a list, and that IS typesetting rather than law.
   * But the tolerance is a licence to be LENIENT about what the source says,
   * not a licence to be CARELESS about what we claim it says. Standing rule 35
   * asks for verbatim, mechanically verified. Transcribing the character the
   * IRS actually printed satisfies both normalisers at once and costs nothing;
   * relying on the fold means the quote is only correct as long as nobody
   * tightens the gate.
   *
   * So all three dashes in this module are now the characters on disk: the en
   * dash in line 7's "5a\u20135d", the em dash here, and no invented spacing.
   */
  quote:
    "Enter amounts on line 2 that would also be included in box 1 of your employees' Forms W-2. See " +
    "Box 1\u2014Wages, tips, other compensation in the General Instructions for Forms W-2 and W-3 for " +
    "details.",
  soWhat:
    "Line 2 is tied by definition to W-2 box 1, which is why the four quarterly 941s and the " +
    "January W-2s have to agree - and why the IRS compares them. It also explains a difference " +
    "that worries people the first time they see it: line 2 and line 5a are allowed to be " +
    "different numbers, because box 1 excludes things like 401(k) deferrals that Social Security " +
    "still taxes. For Greenway in Q2 2026 they happen to be identical, because there is nothing " +
    "in the pay that is treated differently by the two definitions. The software does not assume " +
    "they are always identical.",
  source: FORM_941_SOURCE_URL,
};

/**
 * LINE 5a CARRIES BOTH HALVES AT ONCE, AND STOPS AT THE WAGE BASE.
 *
 * The 12.4% is the giveaway that this line is employer + employee combined.
 * The dollar figure in this quote is the 2026 base; SSA_2026_WAGE_BASE in the
 * shared registry is the authority of record for it, and the two agree.
 */
export const I941_LINE_5A_BOTH_HALVES_AND_THE_CAP: GuidanceAuthority = {
  id: "i941-line-5a-both-halves-and-the-cap",
  kind: "irs_guidance",
  cite: `IRS Instructions for Form 941 (${FORM_941_SOURCE_YEAR}), line 5a (Taxable social security wages)`,
  quote:
    "Enter the total wages, sick pay, and taxable fringe benefits subject to social security tax " +
    "you paid to your employees during the quarter. ... Enter the amount before payroll deductions. " +
    "Don't include tips on this line. ... For 2026, the rate of social security tax on taxable " +
    "wages is 6.2% (0.062) each for the employer and employee. Stop paying social security tax on " +
    "and entering an employee's wages on line 5a when the employee's taxable wages and tips reach " +
    "$184,500 for the year. However, continue to withhold income and Medicare taxes for the whole " +
    "year on all wages and tips, even when the social security wage base limit of $184,500 has " +
    "been reached. line 5a (column 1) x 0.124 line 5a (column 2)",
  soWhat:
    "Three things Michael should be able to say out loud. First, the 12.4% at the end means line " +
    "5a already contains BOTH halves - his and the employee's - so the 941 total is not the same " +
    "as what came out of the paycheques. Second, the cap is per employee and per calendar year, " +
    "which is why year-to-date wages are an input to a quarterly return and not just a report: " +
    "the quarter in which somebody crosses $184,500 has a line 5a smaller than its line 2. Third, " +
    "Medicare does not stop, ever. Nobody at Greenway is near $184,500, so the cap does not bite " +
    "today - it is implemented and tested anyway, because the first year it matters is the year " +
    "nobody is looking for it.",
  source: FORM_941_SOURCE_URL,
};

/**
 * LINE 7 - THE LINE THAT PROVES THE FORM IS NOT PURE SUMMATION.
 *
 * This is the second line a summing program gets wrong, and the more subtle of
 * the two. Greenway's filed Q2 2026 return carries -0.07 here.
 */
export const I941_LINE_7_FRACTIONS_OF_CENTS: GuidanceAuthority = {
  id: "i941-line-7-fractions-of-cents",
  kind: "irs_guidance",
  cite: `IRS Instructions for Form 941 (${FORM_941_SOURCE_YEAR}), line 7 (Current quarter's adjustment for fractions of cents)`,
  /*
   * ONE INVISIBLE CHARACTER. books-48.
   *
   * This read "lines 5a-5d" with an ASCII hyphen (U+002D). The source has an
   * EN DASH (U+2013): "lines 5a\u20135d". The verifier's normaliser folds an EM dash
   * to a hyphen but deliberately leaves the EN dash alone, so the two did not
   * match — and again, nothing said so, because the cite did not route.
   *
   * WRITTEN AS AN ESCAPE, NOT AS THE GLYPH. `\u2013` is used rather than pasting
   * the character, because a hyphen and an en dash are visually near-identical
   * in most editors at most sizes. The next person to read this line can see
   * WHICH dash it is without selecting it; if the literal glyph were here, the
   * only way to know would be to run the gate. The gate does run — but a source
   * file that states its own intent is cheaper than a gate you have to consult.
   */
  quote:
    "Enter adjustments for fractions of cents (due to rounding) relating to the employee share of " +
    "social security and Medicare taxes withheld. The employee share of amounts shown in column 2 " +
    "of lines 5a\u20135d may differ slightly from amounts actually withheld from employees' pay due to " +
    "the rounding of social security and Medicare taxes based on statutory rates. This adjustment " +
    "may be a positive or a negative adjustment.",
  soWhat:
    "This is the IRS admitting in writing that the form will not foot, and telling you where to " +
    "put the difference. Taxing each paycheque and rounding to the cent does not give the same " +
    "answer as taxing the whole quarter in one multiplication, and the gap is a few cents. " +
    "Greenway's filed Q2 2026 return shows -0.07 on this line. The software computes line 7 as a " +
    "RESIDUAL - what was actually withheld minus what the rate says - rather than plugging it to " +
    "make the form balance, and it refuses if the residual is bigger than rounding can explain. " +
    "A plug that absorbs any difference would hide a genuine withholding error behind a line the " +
    "IRS expects to be small, which is the one place on this form where a wrong number looks " +
    "completely normal.",
  source: FORM_941_SOURCE_URL,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The seven texts this slice adds. */
export const FORM_941_AUTHORITIES: readonly GuidanceAuthority[] = [
  CFR_31_6011_A_1_MUST_FILE_QUARTERLY,
  CFR_31_6071_A_1_WHEN_DUE,
  CFR_301_7503_1_WEEKEND_HOLIDAY_SHIFT,
  I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH,
  I941_LINE_2_MATCHES_W2_BOX_1,
  I941_LINE_5A_BOTH_HALVES_AND_THE_CAP,
  I941_LINE_7_FRACTIONS_OF_CENTS,
] as const;

/**
 * The ids this slice reuses from the shared payroll registry rather than
 * restating (standing rule 25).
 *
 * Named explicitly instead of pulled in by a wildcard so that deleting one of
 * them from the shared registry breaks a test here with a useful message,
 * rather than silently shrinking the authority panel on the screen.
 */
export const FORM_941_BORROWED_AUTHORITY_IDS: readonly string[] = [
  "irc-3101-employee-fica",
  "irc-3111-employer-fica",
  "ssa-2026-contribution-benefit-base",
  "wa-cares-uncapped",
  "pub15-2026-lookback-period",
  "pub15-2026-schedule-b-required",
  "pub15-2026-semiweekly-spanning-quarters",
  "irc-6651-failure-to-file",
  "irc-6656-deposit-penalty",
  "irc-7501-trust-fund-payroll",
] as const;

/**
 * Everything a reader of the 941 screen should be able to click through to:
 * the seven new texts plus the ten borrowed ones, in that order.
 *
 * Throws rather than skipping if a borrowed id has gone missing. A citation
 * panel that quietly renders sixteen items when it was built to render
 * seventeen is standing rule 39's vacuous read wearing a different hat.
 */
export function form941Authorities(): readonly GuidanceAuthority[] {
  const borrowed = FORM_941_BORROWED_AUTHORITY_IDS.map((id) => {
    const found = PAYROLL_TAX_AUTHORITIES.find((a) => a.id === id);
    if (!found) {
      throw new Error(
        `form-941-authorities: borrowed authority "${id}" is no longer in PAYROLL_TAX_AUTHORITIES. ` +
          `Either restore it there or remove it from FORM_941_BORROWED_AUTHORITY_IDS - do not let ` +
          `the 941 screen silently cite one fewer source than it was built to cite.`,
      );
    }
    return found;
  });
  return [...FORM_941_AUTHORITIES, ...borrowed];
}

/**
 * Self-check: ids unique, nothing empty, no accidental duplication of a text
 * the shared registry already carries.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertForm941AuthoritiesAreWellFormed(): void {
  const seen = new Set<string>();
  for (const a of FORM_941_AUTHORITIES) {
    if (seen.has(a.id)) {
      throw new Error(`form-941-authorities: duplicate id "${a.id}".`);
    }
    seen.add(a.id);

    for (const [field, value] of [
      ["cite", a.cite],
      ["quote", a.quote],
      ["soWhat", a.soWhat],
      ["source", a.source],
    ] as const) {
      if (value.trim().length === 0) {
        throw new Error(`form-941-authorities: "${a.id}" has an empty ${field}.`);
      }
    }

    if (PAYROLL_TAX_AUTHORITIES.some((p) => p.id === a.id)) {
      throw new Error(
        `form-941-authorities: "${a.id}" also exists in PAYROLL_TAX_AUTHORITIES. One text, one home.`,
      );
    }
  }
}
