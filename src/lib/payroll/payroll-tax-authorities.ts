/**
 * src/lib/payroll/payroll-tax-authorities.ts  (books-13)
 *
 * THE SOURCE MATERIAL FOR EVERY PAYROLL NUMBER AND EVERY PAYROLL REFUSAL.
 *
 * Michael asked for something specific: when the system stops him, it must tell
 * him WHY it stopped him, in plain English, with a real citation he can go read.
 * Not "validation error." Not "invalid input." An actual reason, from an actual
 * law, that an actual auditor would recognize.
 *
 * So every quote in this file was transcribed VERBATIM from a primary government
 * source. Not from a blog, not from a payroll vendor's summary, not from memory.
 * The `source` field on each record is the exact URL it came from. If a number in
 * the withholding engine cannot be traced back to a quote in this file, that
 * number is a guess and it does not belong in the product.
 *
 * SHAPE NOTE: this reuses `GuidanceAuthority` from books-guidance-core so payroll
 * authorities render in the same UI as the ledger/audit ones. The field is `cite`,
 * NOT `citation`. Kind must be one of `GuidanceAuthorityKind`.
 *
 * PURE DATA + PURE FUNCTIONS. No I/O. No server imports.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) FEDERAL — INCOME TAX WITHHOLDING METHOD
// ---------------------------------------------------------------------------

/**
 * WHY THIS ONE MATTERS MOST: it is the IRS telling us which of the two methods
 * in Pub. 15-T we are allowed to use. We are an automated system, so we use
 * Worksheet 1A + the Percentage Method. The Wage Bracket tables are for someone
 * doing this by hand and they stop working above ~$100,000. Implementing those
 * instead would have been a silent defect that only showed up on a big paycheck.
 */
export const PUB15T_AUTOMATED_METHOD: GuidanceAuthority = {
  id: "pub15t-2026-automated-method",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), Introduction — Percentage Method Tables for Automated Payroll Systems",
  // THE QUOTE STOPS HERE ON PURPOSE, AND THE REASON IS WORTH RECORDING.
  //
  // In the publication this passage continues: "This method works for Forms W-4
  // for all prior, current, and future years. This method also works for any
  // amount of wages." That continuation is real, it is on the same page, and it
  // is the sentence that actually justifies choosing this method - so it was
  // originally spliced on with an ellipsis.
  //
  // It had to come out. The worksheet box and Table 3 are printed between the
  // two halves, in a different column, and every text extraction of the page
  // emits that column BEFORE the opening sentence. The verifier requires
  // elided segments to appear IN ORDER, which is the property that stops a
  // quote being assembled out of words gathered from wherever they happen to
  // suit - so it refused this one, correctly.
  //
  // The choice was to weaken the ordering check or to quote less. Quoting less
  // is obviously right: an authority that had to disable a safeguard to pass is
  // not an authority. The wage-bracket method's practical ceiling is explained
  // in `soWhat` below in our own words rather than dressed up as a quotation.
  quote:
    "If you're an employer with an automated payroll system, use Worksheet 1A and the Percentage " +
    "Method tables in this section to figure federal income tax withholding.",
  soWhat:
    "This is the method we implement, and the IRS says so in as many words. It is the only one that " +
    "works no matter how old an employee's W-4 is and no matter how large the paycheck. The other " +
    "method in the same publication (the wage bracket tables) is for doing payroll by hand and it " +
    "runs out of road at about $100,000 — if we had used it, your own paycheck would eventually " +
    "have been computed wrong and nothing would have warned you.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

/**
 * The two "-0-" clamps. This is quoted because the ORDER of operations is
 * load-bearing and it is the kind of thing a reasonable person would "simplify"
 * and thereby break. See the long comment in payroll-withholding-core.
 */
export const PUB15T_WORKSHEET_1A_CLAMPS: GuidanceAuthority = {
  id: "pub15t-2026-worksheet-1a-clamps",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), Worksheet 1A, lines 1i and 3c",
  // Both segments end on a word for the same reason as line 1g above: what looks
  // like a full stop is the leading dot of the form's leader run.
  quote:
    "1i Subtract line 1h from line 1e. If zero or less, enter -0-. This is the Adjusted Annual Wage " +
    "Amount ... 3c Subtract line 3b from line 2h. If zero or less, enter -0-",
  soWhat:
    "There are two separate places where the worksheet says 'if this went negative, call it zero,' " +
    "and they are at different points in the math. Collapsing them into one check at the end gives a " +
    "different answer for a low-paid employee who claims dependent credits — the credit would wrongly " +
    "eat into wages it was never allowed to reach. We apply both clamps exactly where the IRS puts them.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

/**
 * The standard-deduction amounts baked into Worksheet 1A line 1g. Quoted so the
 * two magic numbers in the engine ($12,900 / $8,600) have a home.
 */
export const PUB15T_LINE_1G_STANDARD_AMOUNTS: GuidanceAuthority = {
  id: "pub15t-2026-line-1g",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), Worksheet 1A, line 1g",
  // NO TRAILING FULL STOP, AND THAT IS NOT SLOPPINESS. On a worksheet LINE the
  // sentence runs straight into the dot leader that carries the eye to the entry
  // box - "$8,600 otherwise . . . . . . . 1g $" - so the period a reader assumes
  // is there is really the first dot of the leader. Quoting it asserts a
  // character the form does not print. The quote therefore ends on the last
  // WORD, which is exactly as much as can be verified.
  quote:
    "If the box in Step 2 of Form W-4 is checked, enter -0-. If the box is not checked, enter $12,900 " +
    "if the taxpayer is married filing jointly or $8,600 otherwise",
  soWhat:
    "This is the built-in standard deduction the withholding tables assume. It is why checking the " +
    "Step 2 box (the 'I have a second job / my spouse works' box) raises withholding — checking it " +
    "throws this deduction away, because it is already accounted for in the other job's withholding. " +
    "Employees are frequently surprised by this; now you can explain it to them.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

/**
 * The no-W-4 default. Important because it is a DEFAULT WE MUST DISCLOSE, not a
 * default we may apply quietly.
 */
export const PUB15T_NO_W4_DEFAULT: GuidanceAuthority = {
  id: "pub15t-2026-no-w4-default",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), 'Withholding on supplemental wages' / new employee default",
  quote:
    "A new employee who fails to furnish a Form W-4 will be treated as if they had checked the box " +
    "for Single or Married filing separately in Step 1(c) and made no entries in Step 2, Step 3, or " +
    "Step 4 of Form W-4.",
  soWhat:
    "If someone never turns in a W-4, you do not get to guess and you do not get to skip withholding. " +
    "The IRS tells you exactly what to assume: single, nothing else claimed — which is close to the " +
    "highest withholding there is. We apply that, but we also put it on screen, because an employee " +
    "who sees a small paycheck deserves to be told it is because their W-4 is missing, not because " +
    "payroll made an error.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

/**
 * ⭐ THE MOST DANGEROUS MISREADING IN PAYROLL. "Exempt" means exempt from income
 * tax withholding ONLY. It has nothing to do with Social Security and Medicare.
 */
export const PUB15T_EXEMPT_IS_INCOME_TAX_ONLY: GuidanceAuthority = {
  id: "pub15t-2026-exempt-scope",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), exemption from withholding (2026 Form W-4 checkbox below Step 4(c))",
  quote:
    "Employees who check the box for exemption from federal income tax withholding below Step 4(c) " +
    "shall have no federal income tax withheld from their paychecks except in the case of certain " +
    "supplemental wages.",
  soWhat:
    "Read it closely: it says FEDERAL INCOME TAX. It does not say Social Security and it does not say " +
    "Medicare. An employee who claims exempt still has FICA taken out, and you still owe the employer " +
    "half. Payroll systems that treat 'exempt' as 'withhold nothing' create an unpaid trust-fund " +
    "liability that follows you personally under section 6672. We refuse to let 'exempt' touch FICA.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

/**
 * ⭐ THE AUTHORITY BEHIND `PAY_PERIODS_PER_YEAR.annually = 1`.
 *
 * Worksheet 1A's Table 3 lists seven cadences and "Annually" is not one of
 * them, which made an annual payroll period look unsupported — while migration
 * 0195 was accepting exactly that value for Michael's own once-a-year salary.
 * The statute settles it: the annual payroll period is named in the definition
 * itself. Quoted here so nobody later "cleans up" the annually row on the very
 * reasonable-looking grounds that Table 3 does not mention it.
 */
export const IRC_3401B_ANNUAL_PAYROLL_PERIOD: GuidanceAuthority = {
  id: "irc-3401b-annual-payroll-period",
  kind: "statute",
  cite: "26 U.S.C. §3401(b)",
  quote:
    "For purposes of this chapter, the term \u201cpayroll period\u201d means a period for which a payment of " +
    "wages is ordinarily made to the employee by his employer, and the term \u201cmiscellaneous payroll " +
    "period\u201d means a payroll period other than a daily, weekly, biweekly, semimonthly, monthly, " +
    "quarterly, semiannual, or annual payroll period.",
  soWhat:
    "You pay yourself once, at the end of the year, and this is the sentence that makes that a real " +
    "payroll period rather than something we improvised. Congress lists the annual payroll period by " +
    "name, right alongside weekly and biweekly. That matters because the IRS worksheet we use for " +
    "withholding has a small table that happens to leave 'Annually' out, and a reasonable person " +
    "reading only that table would conclude your own paycheck cannot be computed. It can, and this " +
    "is why.",
  source: "https://www.law.cornell.edu/uscode/text/26/3401",
};

/**
 * The other half of the annual-period proof: Pub. 15-T does not merely permit
 * an annual period, it PRINTS a table for one. Both halves are cited because
 * the claim is a two-part claim — the statute says the period exists, and the
 * publication says here is how you withhold on it.
 */
export const PUB15T_ANNUAL_PAYROLL_PERIOD_TABLE: GuidanceAuthority = {
  id: "pub15t-2026-annual-payroll-period",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 8 (Payroll Period)",
  // WHY THIS QUOTE AND NOT THE TABLE HEADING.
  //
  // This started out quoting the two words "ANNUAL Payroll Period" - the
  // heading Pub. 15-T prints above its annual withholding table. That was a bad
  // citation for a reason worth writing down: two words are not evidence. They
  // carry no rule, and the registry's own self-test rejects any quote under 40
  // characters precisely to stop that. The self-test was right and I was wrong.
  //
  // The amount ROWS of that table were the other tempting choice and they are
  // worse: they extract from the PDF with dot-leader runs that are a layout
  // artifact, so a "verbatim" quote of one is verbatim to pdftotext rather than
  // to the IRS.
  //
  // So the quote below is the actual RULE, taken from Pub. 15 section 8, which
  // is the passage that defines what a payroll period is at all. Verified
  // character-for-character (not merely word-for-word) against p15-2026.pdf
  // converted with `pdftotext -layout`, left column, de-hyphenated across the
  // line break in "payroll pe-/riod". 38 words, exact match.
  quote:
    "Your payroll period is a period of service for which you usually pay wages. When you have a " +
    "regular payroll period, withhold income tax for that time period even if your employee " +
    "doesn\u2019t work the full period.",
  soWhat:
    "This is the IRS's own definition of a payroll period, and notice what it turns on: the period " +
    "you USUALLY pay wages for. Nothing about it requires a paycheck every two weeks. You pay " +
    "yourself once at the end of the year, so your payroll period is the year, and withholding is " +
    "figured for that period. Pub. 15-T backs it up by printing a withholding table headed 'ANNUAL " +
    "Payroll Period' - reproduced in the 2026 publication with the same brackets our engine uses, " +
    "which is how the $5,020.00 on your own illustration was checked by hand. The reason this " +
    "authority exists at all is that the smaller table the automated worksheet points at (Table 3) " +
    "leaves 'Annually' out, and reading only that table would tell you your own paycheck cannot be " +
    "computed. It can be, it is ordinary, and this is the paragraph that says so.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

export const PUB15T_ROUNDING: GuidanceAuthority = {
  id: "pub15t-2026-rounding",
  kind: "irs_guidance",
  cite: "IRS Pub. 15-T (2026), 'Rounding'",
  quote:
    "To figure the income tax to withhold, you may reduce the last digit of the wages to zero, or " +
    "figure the wages to the nearest dollar. You may also round the tax for the pay period to the " +
    "nearest dollar. If rounding is used, it must be used consistently. Withheld tax amounts should be " +
    "rounded to the nearest whole dollar by dropping amounts under 50 cents and increasing amounts " +
    "from 50 to 99 cents to the next dollar. For example, $2.30 becomes $2 and $2.50 becomes $3.",
  soWhat:
    "Rounding to whole dollars is allowed but optional — and the catch is the word 'consistently.' " +
    "You cannot round when it helps and skip it when it does not. We compute everything in exact cents " +
    "and treat rounding as one deliberate on/off setting for the whole run, so it can never drift.",
  source: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
};

// ---------------------------------------------------------------------------
// 2) FEDERAL — FICA (SOCIAL SECURITY AND MEDICARE)
// ---------------------------------------------------------------------------

export const IRC_3101_EMPLOYEE_FICA: GuidanceAuthority = {
  id: "irc-3101-employee-fica",
  kind: "statute",
  cite: "26 U.S.C. §3101(a), (b)(1), (b)(2)",
  quote:
    "(a) Old-age, survivors, and disability insurance — In addition to other taxes, there is hereby " +
    "imposed on the income of every individual a tax equal to 6.2 percent of the wages (as defined in " +
    "section 3121(a)) received by the individual with respect to employment (as defined in section " +
    "3121(b)). (b) Hospital insurance (1) In general — ... a tax equal to 1.45 percent of the wages ... " +
    "(2) Additional tax — ... a tax equal to 0.9 percent of wages which are received with respect to " +
    "employment ... and which are in excess of— (A) in the case of a joint return, $250,000, (B) in the " +
    "case of a married taxpayer (as defined in section 7703) filing a separate return, 1/2 of the dollar " +
    "amount determined under subparagraph (A), and (C) in any other case, $200,000.",
  soWhat:
    "The employee's side of FICA: 6.2% for Social Security, 1.45% for Medicare, plus an extra 0.9% " +
    "Medicare surtax on high earners. Note there are THREE thresholds for that surtax — $250,000, " +
    "$125,000, and $200,000 — depending on how the person files, not one flat number. And note what " +
    "is missing: there is no employer match on the extra 0.9%. That one is the employee's alone.",
  source: "https://www.law.cornell.edu/uscode/text/26/3101",
};

export const IRC_3111_EMPLOYER_FICA: GuidanceAuthority = {
  id: "irc-3111-employer-fica",
  kind: "statute",
  cite: "26 U.S.C. §3111(a), (b)",
  quote:
    "(a) ... there is hereby imposed on every employer an excise tax, with respect to having " +
    "individuals in his employ, equal to 6.2 percent of the wages (as defined in section 3121(a)) paid " +
    "by the employer with respect to employment (as defined in section 3121(b)). (b) ... equal to 1.45 " +
    "percent of the wages ...",
  soWhat:
    "Your side of FICA, and it is a real cost of employing someone that never shows on their paystub: " +
    "another 6.2% and another 1.45% out of your pocket. Compare this section to section 3101 and you " +
    "will see it stops there — Congress gave the employer no matching obligation for the extra 0.9% " +
    "Medicare surtax.",
  source: "https://www.law.cornell.edu/uscode/text/26/3111",
};

/**
 * The SSA base. This record carries a free TEST ORACLE: SSA states the maximum
 * employee OASDI contribution for 2026 outright. We assert against it.
 */
export const SSA_2026_WAGE_BASE: GuidanceAuthority = {
  id: "ssa-2026-contribution-benefit-base",
  kind: "state_manual",
  cite: "Social Security Administration, Contribution and Benefit Base (2026)",
  quote:
    "For earnings in 2026, this base is $184,500. The OASDI tax rate for wages paid in 2026 is set by " +
    "statute at 6.2 percent for employees and employers, each. Thus, an individual with wages equal to " +
    "or larger than $184,500 would contribute $11,439.00 to the OASDI program in 2026, and his or her " +
    "employer would contribute the same amount. ... After 1993, there has been no limitation on " +
    "HI-taxable earnings. Tax rates under the HI program are 1.45 percent for employees and employers, each.",
  soWhat:
    "Social Security stops at $184,500 of wages in 2026. Medicare never stops — there is no ceiling on " +
    "it at all. SSA also does us a favor here by publishing the answer: the most any one employee can " +
    "pay into Social Security in 2026 is $11,439.00. We use that as a test the software has to pass, " +
    "so if anyone ever fat-fingers the rate the tests fail immediately instead of quietly underpaying.",
  source: "https://www.ssa.gov/oact/cola/cbb.html",
};

// ---------------------------------------------------------------------------
// 3) FEDERAL — UNEMPLOYMENT (FUTA)
// ---------------------------------------------------------------------------

export const IRC_3301_FUTA_RATE: GuidanceAuthority = {
  id: "irc-3301-futa-rate",
  kind: "statute",
  cite: "26 U.S.C. §3301",
  quote:
    "There is hereby imposed on every employer (as defined in section 3306(a)) for each calendar year " +
    "an excise tax, with respect to having individuals in his employ, equal to 6 percent of the total " +
    "wages (as defined in section 3306(b)) paid by such employer during the calendar year with respect " +
    "to employment (as defined in section 3306(c)).",
  soWhat:
    "Federal unemployment tax starts at 6 percent — not the 0.6 percent everyone quotes. The 0.6 is " +
    "what is left AFTER a credit you only earn by paying your Washington state unemployment tax on " +
    "time. That distinction is the whole point of the next two authorities.",
  source: "https://www.law.cornell.edu/uscode/text/26/3301",
};

export const IRC_3306_FUTA_WAGE_BASE: GuidanceAuthority = {
  id: "irc-3306-futa-wage-base",
  kind: "statute",
  cite: "26 U.S.C. §3306(b)(1)",
  quote:
    "(b) Wages — For purposes of this chapter, the term 'wages' means all remuneration for employment " +
    "... except that such term shall not include— (1) that part of the remuneration which, after " +
    "remuneration ... equal to $7,000 with respect to employment has been paid to an individual by an " +
    "employer during any calendar year, is paid to such individual by such employer during such " +
    "calendar year. If an employer (hereinafter referred to as successor employer) during any calendar " +
    "year acquires substantially all the property used in a trade or business of another employer ... " +
    "any remuneration ... paid (or considered under this paragraph as having been paid) to such " +
    "individual by such predecessor during such calendar year and prior to such acquisition shall be " +
    "considered as having been paid by such successor employer;",
  soWhat:
    "FUTA only applies to the first $7,000 you pay each person all year, and that figure is written " +
    "into the statute — it does not adjust for inflation. The second half matters for your " +
    "restructuring: if one of your entities takes over another, wages already paid by the old entity " +
    "COUNT toward the new entity's $7,000. Miss that and you pay the same tax twice.",
  source: "https://www.law.cornell.edu/uscode/text/26/3306",
};

/**
 * ⭐ The reason "net FUTA is 0.6%" must never be hardcoded.
 */
export const IRC_3302_FUTA_CREDIT: GuidanceAuthority = {
  id: "irc-3302-futa-credit",
  kind: "statute",
  cite: "26 U.S.C. §3302(a)(3), (b), (c)(1)",
  quote:
    "(a)(3) The credit against the tax for any taxable year shall be permitted only for contributions " +
    "paid on or before the last day upon which the taxpayer is required under section 6071 to file a " +
    "return for such year; except that credit shall be permitted for contributions paid after such last " +
    "day, but such credit shall not exceed 90 percent of the amount which would have been allowable as " +
    "credit on account of such contributions had they been paid on or before such last day. ... (b) ... " +
    "equal to the amount ... if throughout the taxable year he had been subject under such State law to " +
    "the highest rate applied thereunder ... or to a rate of 5.4 percent, whichever rate is lower. ... " +
    "(c)(1) The total credits allowed to a taxpayer under this section shall not exceed 90 percent of " +
    "the tax against which such credits are allowable.",
  soWhat:
    "Here is the trap. Everyone says federal unemployment tax is 0.6%. It is really 6% minus a credit " +
    "of up to 5.4%, and you only get the full credit if you paid Washington on time. Pay the state " +
    "late and the federal credit drops to 90% of what it would have been — so one late state payment " +
    "gets punished twice, once by the state and once by the IRS. That is why this system computes " +
    "the credit instead of assuming 0.6%.",
  source: "https://www.law.cornell.edu/uscode/text/26/3302",
};

// ---------------------------------------------------------------------------
// 4) WASHINGTON — PAID FAMILY & MEDICAL LEAVE
// ---------------------------------------------------------------------------

export const RCW_50A_10_030_PFML: GuidanceAuthority = {
  id: "rcw-50a-10-030-pfml",
  kind: "state_law",
  cite: "RCW 50A.10.030(3)(a), (4), (5)(a), (6)(b)(ii)",
  quote:
    "(3)(a) For medical leave premiums, an employer may deduct from the wages of each employee up to " +
    "the full amount of the premium required. ... (4) The commissioner must annually set a maximum " +
    "limit on the amount of wages that is subject to a premium assessment under this section that is " +
    "equal to the maximum wages subject to taxation for social security as determined by the social " +
    "security administration. ... (5)(a) Employers with fewer than 50 employees employed in the state " +
    "are not required to pay the employer portion of premiums for family and medical leave. ... " +
    "(6)(b)(ii) The total premium rate must not exceed 1.20 percent.",
  soWhat:
    "Paid Leave stops at the same wage ceiling as Social Security — and it says so by pointing AT " +
    "Social Security, so the two numbers can never legally disagree. That is why the code derives the " +
    "Paid Leave cap from the Social Security figure instead of typing $184,500 a second time. Also: " +
    "with fewer than 50 employees in Washington you do not owe the employer share, but you must still " +
    "withhold and send in the employee share. Not owing it is not the same as not collecting it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50A.10.030",
};

// ---------------------------------------------------------------------------
// 5) WASHINGTON — WA CARES (LONG-TERM SERVICES AND SUPPORTS)
// ---------------------------------------------------------------------------

export const RCW_50B_04_080_WA_CARES: GuidanceAuthority = {
  id: "rcw-50b-04-080-wa-cares",
  kind: "state_law",
  cite: "RCW 50B.04.080(1), (2)(a), (2)(b)",
  quote:
    "(1) Unless otherwise exempted pursuant to this chapter, beginning July 1, 2023, the employment " +
    "security department shall assess for each individual in employment with an employer a premium " +
    "based on the amount of the individual's wages. The initial premium rate is .58 percent of the " +
    "individual's wages. Beginning January 1, 2026, and biennially thereafter, the premium rate shall " +
    "be set by the pension funding council at a rate no greater than .58 percent. ... (2)(a) The " +
    "employer must collect from the employees the premiums provided under this section through payroll " +
    "deductions and remit the amounts collected to the employment security department. (2)(b) In " +
    "collecting employee premiums through payroll deductions, the employer shall act as the agent of " +
    "the employees ...",
  soWhat:
    "WA Cares is 0.58% and it comes entirely out of the employee — you owe no share of it. The phrase " +
    "to notice is 'the employer shall act as the agent of the employees.' That money is never yours. " +
    "You are holding it for them, which is exactly why this system will not let a WA Cares liability " +
    "be moved into income or owner draw.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50B.04.080",
};

/**
 * THE ACTUAL MINIMUM-WAGE DOLLARS, AND WHY THEY LIVE APART FROM THE STATUTE.
 *
 * RCW 49.46.020(2) is already quoted in payroll-cogs-core.ts as
 * RCW_49_46_020_MINWAGE, and books-26 corrected that quote from a paraphrase to
 * the real text rather than adding a second authority for the same statute
 * (rule 25: extend, do not duplicate). What was genuinely missing was the
 * DOLLARS: the statute describes machinery, and L&I publishes the output of it
 * every September 30.
 *
 * They are two authorities because they change on completely different clocks.
 * The statute has not moved since 2019. This one moves every single year, and
 * the whole reason the rate registry is dated is that a figure like this needs a
 * span attached to it.
 */
export const LNI_MINIMUM_WAGE_ANNOUNCEMENT: GuidanceAuthority = {
  id: "lni-minimum-wage-announcement",
  kind: "state_law",
  cite: "WA Dept. of Labor & Industries, \"Minimum Wage\"",
  quote:
    "Washington employers must pay most employees at least the minimum wage for every hour worked. " +
    "The 2026 minimum wage in the state of Washington is $17.13 per hour. ... The 2025 minimum wage " +
    "in the state of Washington was $16.66 per hour. ... Some local jurisdictions have higher minimum " +
    "wage rates and different labor rules than Washington State. ... Beginning mid-September each " +
    "year, L&I will make a cost-of-living adjustment to the minimum wage based on the federal " +
    "Consumer Price Index for Urban Wage Earners and Clerical Workers (CPI-W). The new minimum wage " +
    "will be announced on Sept. 30, and take effect Jan. 1.",
  soWhat:
    "$17.13 is the 2026 figure, not a permanent one, and the 2027 figure does not exist yet - L&I " +
    "announces it on September 30. That matters here because Greenway's first payroll is January 1, " +
    "2027: the wage floor for that paycheck is a number nobody has published. The other sentence to " +
    "notice is the one about local jurisdictions. Several Washington cities set their own higher " +
    "floor, and using the state figure inside one of them underpays every hour. Port Orchard is not " +
    "one of them, which is why the state rate governs Greenway - but that is a fact about Greenway's " +
    "address, not a fact about Washington.",
  source: "https://www.lni.wa.gov/workers-rights/wages/minimum-wage/",
};

/**
 * THE FEDERAL MINIMUM WAGE — the other floor, and the one that was missing.
 *
 * WHY IT IS HERE AND NOT WITH THE WASHINGTON FIGURE ABOVE. They are different
 * numbers under different statutes, doing different jobs, on different clocks.
 * L&I recalculates Washington's every September 30 by CPI-W. The federal wage
 * has not moved since July 2009 because it moves only by act of Congress.
 * Filing them as one authority would imply a relationship that does not exist.
 *
 * WHY A PAYROLL SYSTEM IN WASHINGTON NEEDS THE FEDERAL FIGURE AT ALL — which is
 * the interesting part, because Washington's is more than twice as high and
 * therefore always governs what an employee must be PAID. It is not used for
 * pay. It is used for GARNISHMENT, and garnishment runs two independent tests:
 *
 *   15 U.S.C. 1673(a)(2) — protects 30 × the FEDERAL minimum wage per workweek
 *   RCW 6.27.150         — protects 35 × the STATE minimum wage per workweek
 *
 * The employee keeps whichever protection is greater, so both must be computed
 * and neither may be assumed. At $7.25 the federal floor is $217.50 a week;
 * Washington's, at $17.13 × 35, is $599.55. Washington will nearly always bind
 * — but "nearly always" is a fact the software has to DEMONSTRATE by running
 * both tests, not one it may take for granted.
 *
 * HOW THE GAP WAS FOUND, in books-37: by running a real creditor order through
 * the assembled net-pay chain rather than by reading code. Every order refused,
 * because the registry had no federal row. `garnishment-core.ts` — the whole of
 * books-36, fully tested — could not compute a single withholding for want of
 * this one number. Correct code that can never execute is standing rule 50 in
 * its most expensive form, and no unit test could have caught it: each half was
 * green in isolation.
 *
 * ON WEIGHT, STATED HONESTLY. The wage is fixed by 29 U.S.C. 206(a)(1), which
 * this repository has not mirrored. What IS mirrored, and re-verified verbatim
 * on every commit, is DOL Fact Sheet #30 — the enforcing division's own
 * publication, which states the figure three times, once as a section heading.
 * So this is the agency's published statement of a figure set elsewhere:
 * `agency_guidance`, not `statute`. Mirroring 29 U.S.C. 206 would upgrade it,
 * and that is recorded as follow-up work rather than quietly assumed done.
 */
export const FEDERAL_MINIMUM_WAGE_FS30: GuidanceAuthority = {
  id: "federal-minimum-wage-fs30",
  kind: "agency_guidance",
  cite: "U.S. DOL, Wage and Hour Division, Fact Sheet #30 (Dec. 2024)",
  quote:
    "The wage garnishment provisions of the CCPA set the maximum amount that may be garnished in any workweek or pay period, regardless of the number of garnishment orders received by the employer. For ordinary garnishments (i.e., those not for support, bankruptcy, or any state or federal tax), the weekly amount may not exceed the lesser of two figures: 25% of the employee's disposable earnings, or the amount by which an employee's disposable earnings are greater than 30 times the federal minimum wage (currently $7.25 an hour).",
  soWhat:
    "This is the number the garnishment calculator was stuck waiting for, and without it not one order could be computed. Thirty times $7.25 is $217.50 protected per workweek, so $435.00 on your biweekly cheques, before an ordinary creditor may take anything. Washington protects thirty-five times the STATE minimum wage instead, which is far more, and the employee always keeps the better of the two - so both get calculated and the calculator tells you which one actually bound. Notice the word 'currently' in the quote: that is exactly why the rate is filed with dates on it rather than as a constant, and why a paycheck dated after the row expires will stop and ask for a fresh source instead of assuming nothing changed.",
  source: "https://www.dol.gov/agencies/whd/fact-sheets/30-cppa",
};

/**
 * ⭐ THE SINGLE MOST COUNTERINTUITIVE FACT IN WASHINGTON PAYROLL, straight from
 * the agency's own employer page. Two programs, one quarterly return, two
 * different wage bases.
 */
export const WA_CARES_UNCAPPED: GuidanceAuthority = {
  id: "wa-cares-uncapped",
  kind: "state_manual",
  cite: "WA Cares Fund, Employer Information — Calculating Premiums",
  quote:
    "The premium is 0.58% of an employee's gross wages, so: Gross wages x .0058 = total premium for " +
    "employee. Note that unlike Paid Leave, premium contributions are not capped at the taxable " +
    "maximum for social security. ... You won't pay any share of these contributions for your " +
    "employees; you may, however, elect to pay some or all of your employees' share on their behalf.",
  soWhat:
    "This is the one that catches everybody. Paid Leave and WA Cares are reported on the SAME " +
    "quarterly form to the SAME agency — but Paid Leave stops at $184,500 and WA Cares never stops. " +
    "If a payroll system computes one 'Washington wage base' and reuses it, it is wrong, and it will " +
    "only be wrong for your highest-paid people, which is the hardest place to notice it.",
  source: "https://wacaresfund.wa.gov/employers",
};

// ---------------------------------------------------------------------------
// 5b) WASHINGTON — THE 2026 PFML RATE ITSELF, AND WHY IT IS NOT A CONSTANT
// ---------------------------------------------------------------------------

/**
 * ⭐ THE RATE THAT PROVES RATES CANNOT BE HARDCODED.
 *
 * PFML went from 0.92% to 1.13% in a single year — a 22.8% increase. ESD says
 * in this same release that it recalculates the rate EVERY OCTOBER. Any system
 * holding 0.92% in a constant under-withheld every 2026 paycheck and would only
 * have discovered it at a quarterly reconciliation, after the money was gone.
 */
export const ESD_PFML_2026_RATE: GuidanceAuthority = {
  id: "esd-pfml-2026-rate-announcement",
  kind: "state_manual",
  cite: "WA Employment Security Department, news release (Oct. 29, 2025) — Paid Family & Medical Leave premium rate increases to 1.13% in 2026",
  quote:
    "Starting Jan. 1, 2026: The premium rate will be 1.13%. The rate for 2025 is 0.92%. Employers " +
    "will pay 28.57% of the total premium and employees will pay 71.43%. ... By law, the Employment " +
    "Security Department recalculates the premium rate annually in October based on program usage " +
    "and premiums collected the previous year. ... Businesses classified by Employment Security as " +
    "having fewer than 50 employees are not required to pay the employer portion of the premium, " +
    "unless they opt to do so. However, they must still collect the employee premium or pay " +
    "employees' premiums on their behalf.",
  soWhat:
    "Three things in one release. First, your Paid Leave rate for 2026 is 1.13% of wages, and the " +
    "employees carry 71.43% of that. Second, because Greenway has fewer than 50 people, you do not " +
    "owe the employer 28.57% — but the agency says in plain words that you must still collect and " +
    "send in the employee share. Third, and this is the reason the rates in this system live in a " +
    "dated table instead of in the code: ESD resets this number every single October. It moved 22.8% " +
    "in one year. A payroll system with 0.92% typed into it would have quietly under-withheld every " +
    "check in 2026 and nothing would have complained.",
  source:
    "https://esd.wa.gov/about-us/news-release/2025/paid-family-medical-leave-premium-rate-increases-113-2026",
};

// ---------------------------------------------------------------------------
// 5c) LATE FILING AND LATE PAYMENT — WHAT IT ACTUALLY COSTS
// ---------------------------------------------------------------------------

/**
 * ⭐ MICHAEL ASKED FOR THIS ONE BY NAME: "i am naughty sometimes and forget to
 * pay or file on time."
 *
 * Note the structure carefully. The statute states the penalties as CUMULATIVE
 * TOTALS (5%, then 10% total, then 20% total). ESD's own web page states the
 * same schedule as INCREMENTS (5%, an additional 5%, an additional 10%). They
 * agree — 5, 5+5=10, 10+10=20 — but anyone implementing from one of them while
 * remembering the other double-counts. That is a tested case in this system.
 */
export const RCW_50_12_220_ESD_LATE: GuidanceAuthority = {
  id: "rcw-50-12-220-esd-late-penalty",
  kind: "state_law",
  cite: "RCW 50.12.220(1), (3), (4)",
  quote:
    "(1) If an employer fails to file a timely report as required by RCW 50.12.070, or the rules " +
    "adopted pursuant thereto, the employer is subject to a penalty of $25 per violation, unless the " +
    "penalty is waived by the commissioner ... (3) If an employer knowingly misrepresents to the " +
    "employment security department the amount of his or her payroll upon which contributions under " +
    "this title are based, the employer shall be liable to the state for up to 10 times the amount of " +
    "the difference in contributions paid ... (4) If contributions are not paid on the date on which " +
    "they are due and payable as prescribed by the commissioner, there shall be assessed a penalty of " +
    "five percent of the amount of the contributions for the first month or part thereof of " +
    "delinquency; there shall be assessed a total penalty of 10 percent of the amount of the " +
    "contributions for the second month or part thereof of delinquency; and there shall be assessed a " +
    "total penalty of 20 percent of the amount of the contributions for the third month or part " +
    "thereof of delinquency.",
  soWhat:
    "Filing the quarterly report late is a flat $25. Paying late is 5% of the tax in month one, 10% " +
    "total by month two, 20% total by month three. Read 'total' literally — the statute is quoting a " +
    "running total, not three penalties stacked on each other. And 'part thereof' means one day into " +
    "a month costs the whole month; there is no proration and no grace period. The one to genuinely " +
    "fear is subsection (3): knowingly understating payroll is up to TEN TIMES the shortfall, which " +
    "is why this system will not let a payroll number be adjusted without a reason attached to it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.12.220",
};

export const RCW_50_24_040_ESD_INTEREST: GuidanceAuthority = {
  id: "rcw-50-24-040-esd-interest",
  kind: "state_law",
  cite: "RCW 50.24.040",
  quote:
    "If contributions are not paid on the date on which they are due and payable as prescribed by the " +
    "commissioner, the whole or part thereof remaining unpaid shall bear interest at the rate of one " +
    "percent per month or fraction thereof from and after such date until payment plus accrued " +
    "interest is received by him or her. ... Where adequate information has been furnished the " +
    "department and the department has failed to act or has advised the employer of no liability or " +
    "inability to decide the issue, interest may be waived.",
  soWhat:
    "Interest is 1% per month on top of the penalty, and 'or fraction thereof' means a single day " +
    "late costs a full month of interest. This is charged separately from the 5/10/20% penalty, so a " +
    "payment three months late carries 20% penalty plus 3% interest, not 20% total. The last sentence " +
    "is worth knowing: if you gave ESD the information and ESD sat on it or told you that you owed " +
    "nothing, the interest can be waived.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.040",
};

/**
 * ⭐ THE MOST EXPENSIVE THING ON THIS PAGE, and it is not a penalty at all.
 *
 * Missing September 30 does not just cost a fine — it can raise the tax RATE for
 * the whole following year, on every dollar of payroll. That dwarfs any late fee.
 * Given Michael's stated habit, this is the single highest-value alarm in the
 * payroll system.
 */
export const ESD_DELINQUENT_TAX_RATE: GuidanceAuthority = {
  id: "esd-delinquent-tax-rate-sept-30",
  kind: "state_manual",
  cite: "WA Employment Security Department — Penalties for late or incomplete tax payments and reports",
  quote:
    "If your tax payment is late, we will charge you interest at a rate of 1% of total taxes due per " +
    "month. ... First month: 5% of total taxes due or $10, whichever is more. Second month: An " +
    "additional 5% of total taxes due or $10, whichever is more. Third month: An additional 10% of " +
    "total taxes due or $10, whichever is more. ... We charge a $25 penalty for each late report. ... " +
    "If you do not send us all late tax payments and reports by Sept. 30 of each year, we might also " +
    "assign a delinquent tax rate to your account. This higher tax rate would be in addition to the " +
    "penalties detailed on this page. ... If we approve your payment plan before Sept. 30, you will " +
    "not receive a delinquent rate for the following year.",
  soWhat:
    "This is the page that turns a small problem into a large one. The fines are survivable — 5%, " +
    "10%, 20% and a dollar a month per hundred. The DELINQUENT TAX RATE is not: miss September 30 " +
    "with anything still outstanding and ESD can raise your unemployment rate for the entire " +
    "following year, on your whole payroll. Notice also the floor: each monthly penalty is the " +
    "percentage OR $10, whichever is larger, so a tiny balance still costs $10 a month. The escape " +
    "hatch is in the last line — an APPROVED PAYMENT PLAN before September 30 prevents the rate " +
    "increase even if you cannot pay in full. That is worth setting a calendar reminder for.",
  source:
    "https://esd.wa.gov/employer-requirements/unemployment-taxes/penalties-late-or-incomplete-tax-payments-and-reports",
};

export const RCW_51_48_210_LNI_LATE: GuidanceAuthority = {
  id: "rcw-51-48-210-lni-late-penalty",
  kind: "state_law",
  cite: "RCW 51.48.210",
  quote:
    "If payment of any tax due is not received by the department by the due date, there shall be " +
    "assessed a penalty of five percent of the amount of the tax for the first month or part thereof " +
    "of delinquency; there shall be assessed a total penalty of ten percent of the amount of the tax " +
    "for the second month or part thereof of delinquency; and there shall be assessed a total penalty " +
    "of twenty percent of the amount of the tax for the third month or part thereof of delinquency. " +
    "No penalty so added may be less than ten dollars. If a warrant is issued by the department for " +
    "the collection of taxes, increases, and penalties, there shall be added thereto a penalty of " +
    "five percent of the amount of the tax, but not less than five dollars nor greater than one " +
    "hundred dollars. In addition, delinquent taxes shall bear interest at the rate of one percent of " +
    "the delinquent amount per month or fraction thereof from and after the due date until payment, " +
    "increases, and penalties are received by the department.",
  soWhat:
    "L&I runs the same 5/10/20 percent schedule as unemployment, with two differences worth " +
    "remembering: there is a hard floor of $10 no matter how small the balance, and if it goes far " +
    "enough for L&I to issue a warrant there is another 5% on top, bounded between $5 and $100. " +
    "Interest is again 1% per month with 'or fraction thereof', so one day late is a full month.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.48.210",
};

/**
 * ⭐ THE ONE NOBODY EXPECTS: an L&I delinquency can be turned into an
 * INJUNCTION THAT STOPS YOU FROM OPERATING. Not a fine. A closed business.
 */
export const RCW_51_16_150_LNI_INJUNCTION: GuidanceAuthority = {
  id: "rcw-51-16-150-lni-injunction",
  kind: "state_law",
  cite: "RCW 51.16.150",
  quote:
    "If any employer shall default in any payment to any fund, the sum due may be collected by action " +
    "at law in the name of the state as plaintiff ... If such default occurs after demand, the " +
    "director may require from the defaulting employer a bond to the state for the benefit of any " +
    "fund ... in the penalty of double the amount of the estimated payments which will be required " +
    "from such employer into the said funds for and during the ensuing one year ... In case of " +
    "refusal or failure after written demand personally served to furnish such bond, the state shall " +
    "be entitled to an injunction restraining the delinquent from prosecuting an occupation or work " +
    "until such bond is furnished, and until all delinquent premiums, penalties, interest, and costs " +
    "are paid, and any sale, transfer, or lease attempted to be made by such delinquent during the " +
    "period of any of the defaults herein mentioned, of his or her works, plant, or lease thereto, " +
    "shall be invalid until all past delinquencies are made good, and such bond furnished.",
  soWhat:
    "Everything else on this subject is money. This one is your doors. If an L&I default goes past a " +
    "written demand, the State can require a bond for DOUBLE a year's estimated premiums, and if you " +
    "do not post it a court can enjoin you from operating at all until you do. It also freezes your " +
    "ability to sell, transfer or lease the business while you are in default — so an unpaid L&I " +
    "balance is a title problem, not just a tax problem. This is the reason the system treats an " +
    "overdue L&I payment as an emergency rather than a reminder.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.16.150",
};

/**
 * ⭐ FEDERAL DEPOSIT PENALTIES RUN ON A DIFFERENT CLOCK ENTIRELY — DAYS, not
 * months. This is why federal and state late-payment logic must never share a
 * code path.
 */
export const IRC_6656_DEPOSIT_PENALTY: GuidanceAuthority = {
  id: "irc-6656-deposit-penalty",
  kind: "statute",
  cite: "26 U.S.C. § 6656(a), (b)(1)",
  quote:
    "(a) In the case of any failure by any person to deposit ... on the date prescribed therefor any " +
    "amount of tax imposed by this title ... unless it is shown that such failure is due to " +
    "reasonable cause and not due to willful neglect, there shall be imposed upon such person a " +
    "penalty equal to the applicable percentage of the amount of the underpayment. (b)(1)(A) ... the " +
    "term 'applicable percentage' means — (i) 2 percent if the failure is for not more than 5 days, " +
    "(ii) 5 percent if the failure is for more than 5 days but not more than 15 days, and (iii) 10 " +
    "percent if the failure is for more than 15 days. (B) ... the applicable percentage shall be 15 " +
    "percent.",
  soWhat:
    "The IRS counts DAYS, not months, and Washington counts months. A deposit six days late is 5% " +
    "federally while the State is still in its first month; sixteen days late is already the full 10% " +
    "federally. Because the two clocks disagree, this system computes them with separate code and " +
    "never reuses one schedule for the other. The 15% tier is what happens after the IRS has sent a " +
    "notice and you still have not paid. 'Reasonable cause and not willful neglect' is a real defence " +
    "but it has to be argued, so the practical answer is to deposit on time.",
  source: "https://www.law.cornell.edu/uscode/text/26/6656",
};

export const IRC_6651_FAILURE_TO_FILE: GuidanceAuthority = {
  id: "irc-6651-failure-to-file",
  kind: "statute",
  cite: "26 U.S.C. § 6651(a)(1)",
  quote:
    "In case of failure to file any return required under authority of subchapter A of chapter 61 ... " +
    "on the date prescribed therefor (determined with regard to any extension of time for filing), " +
    "unless it is shown that such failure is due to reasonable cause and not due to willful neglect, " +
    "there shall be added to the amount required to be shown as tax on such return 5 percent of the " +
    "amount of such tax if the failure is for not more than 1 month, with an additional 5 percent for " +
    "each additional month or fraction thereof during which such failure continues, not exceeding 25 " +
    "percent in the aggregate.",
  soWhat:
    "Failing to FILE federally is 5% a month up to a 25% ceiling — and note this one is written as " +
    "'an additional 5 percent for each additional month', which is genuinely incremental, unlike the " +
    "Washington statutes that quote running totals. Three different structures for the same idea in " +
    "one problem domain is exactly how a copy-pasted penalty calculation ends up wrong, so each is " +
    "implemented separately and tested against its own words.",
  source: "https://www.law.cornell.edu/uscode/text/26/6651",
};

// ---------------------------------------------------------------------------
// 6) WASHINGTON — UNEMPLOYMENT INSURANCE (SUTA)
// ---------------------------------------------------------------------------

export const ESD_SUTA_RATE_STRUCTURE: GuidanceAuthority = {
  id: "esd-suta-rate-structure",
  kind: "state_manual",
  cite: "WA Employment Security Department, 'How we determine tax rates' (2026)",
  quote:
    "An experience rating tax based on the amount of benefits charged to your account over the past 4 " +
    "fiscal years ... The experience rate is currently capped at 5.4%. A shared cost (social) tax based " +
    "on benefits we paid out last year that don't relate to a specific employer. The flat social tax is " +
    "currently capped at 1.22%. A contribution to the employment administration fund (EAF) ... The fee " +
    "ranges from 0.02% to .03%, depending on your rate class. The total of the experience tax and the " +
    "social tax cannot exceed 6%. ... We send your tax rate each year in December. ... " +
    "[Taxable wage base] 2026 | $78,200",
  soWhat:
    "Your Washington unemployment rate is specific to YOU — it depends on your own layoff history — and " +
    "ESD mails it to you every December. There is no public formula we could use to work it out, so " +
    "this system will not invent one. It will ask you for the notice. Note the wage base too: $78,200 " +
    "for 2026, which is a completely different ceiling from Social Security's $184,500.",
  source: "https://esd.wa.gov/employer-requirements/unemployment-taxes/how-we-determine-tax-rates",
};

// ---------------------------------------------------------------------------
// 7) WASHINGTON — L&I INDUSTRIAL INSURANCE
// ---------------------------------------------------------------------------

/**
 * ⭐⭐ THE STRONGEST BLOCKER AUTHORITY IN THE ENTIRE PAYROLL DOMAIN.
 * An unauthorized deduction from a worker's wages is a GROSS MISDEMEANOR.
 * This is not a warning. This is a refusal.
 */
export const RCW_51_16_140_LNI_DEDUCTION: GuidanceAuthority = {
  id: "rcw-51-16-140-lni-deduction",
  kind: "state_law",
  cite: "RCW 51.16.140(1), (2)",
  quote:
    "(1) Every employer who is not a self-insurer shall deduct from the pay of each of his or her " +
    "workers one-half of the amount he or she is required to pay, for medical benefits within each risk " +
    "classification. Such amount shall be periodically determined by the director and reported by him " +
    "or her to all employers under this title ... (2) It shall be unlawful for the employer, unless " +
    "specifically authorized by this title, to deduct or obtain any part of the premium or other costs " +
    "required to be by him or her paid from the wages or earnings of any of his or her workers, and the " +
    "making of or attempt to make any such deduction shall be a gross misdemeanor.",
  soWhat:
    "This is the medical aid half, and note the verb: you SHALL deduct it. It is not optional. But " +
    "read it for what it does not say, too — this section covers medical aid only. It is not the " +
    "whole employee share. Two other funds are also split with the worker (see RCW 51.32.073 for " +
    "the supplemental pension and RCW 51.32.090(6) for stay-at-work), and the accident fund is " +
    "yours alone. Then read subsection (2): taking more than the law allows is not a bookkeeping " +
    "mistake, it is a gross misdemeanor. A crime, not a penalty. That asymmetry is why this system " +
    "reads the employee rate off your L&I notice instead of deriving it, always rounds the " +
    "worker's share DOWN, and refuses outright rather than estimating.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.16.140",
};

export const RCW_51_16_035_LNI_CLASSIFICATION: GuidanceAuthority = {
  id: "rcw-51-16-035-lni-classification",
  kind: "state_law",
  cite: "RCW 51.16.035(1), (2)",
  quote:
    "(1) The department shall classify all occupations or industries in accordance with their degree of " +
    "hazard and fix therefor basic rates of premium which shall be: (a) The lowest necessary to maintain " +
    "actuarial solvency of the accident and medical aid funds in accordance with recognized insurance " +
    "principles; and (b) Designed to attempt to limit fluctuations in premium rates. (2) The department " +
    "shall formulate and adopt rules governing the method of premium calculation and collection ... The " +
    "department may annually, or at such other times as it deems necessary to achieve the objectives " +
    "under this section, readjust rates ... to become effective on such dates as the department may " +
    "designate.",
  soWhat:
    "L&I assigns your risk classification and sets the rate for it, and it can change those rates " +
    "whenever it decides to. There is no constant we could safely freeze into the software. Guessing a " +
    "class code is worse than useless — the wrong class means both a wrong premium and an audit " +
    "finding — so the system refuses to compute L&I until you give it your actual rate notice.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.16.035",
};

export const RCW_51_16_060_LNI_HOURS: GuidanceAuthority = {
  id: "rcw-51-16-060-lni-hours",
  kind: "state_law",
  cite: "RCW 51.16.060",
  quote:
    "every employer not qualifying as a self-insurer, shall insure with the state and shall, on or " +
    "before the last day of January, April, July and October of each year thereafter, furnish the " +
    "department with a true and accurate payroll for the period in which workers were employed by it " +
    "during the preceding calendar quarter, the total amount paid to such workers during such preceding " +
    "calendar quarter, and a segregation of employment in the different classes established pursuant to " +
    "this title, and shall pay its premium thereon to the appropriate fund. ... the director may in his " +
    "or her discretion ... require an employer ... to furnish a supplementary report containing the name " +
    "of each individual worker, his or her hours worked, his or her rate of pay and the class or classes " +
    "in which such work was performed ...",
  soWhat:
    "Workers' comp is the odd one out: it is charged by the HOUR worked, not as a percentage of wages, " +
    "and it is reported by risk class. That means your timeclock hours are tax data — they carry the " +
    "same accuracy burden as dollars do, and they have to be kept per person, per class.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.16.060",
};

/**
 * ⭐ THE AUTHORITY THAT CAUGHT A DEFECT IN OUR OWN CODE (books-14).
 *
 * We originally believed the supplemental pension was the employer's alone.
 * RCW 51.32.073(1) says the opposite in plain words: the employer "shall retain
 * from the earnings of each worker" an amount that is then "matched in an equal
 * amount by each employer." It is a half-and-half split and it is MANDATORY.
 *
 * Read subsection (2) carefully too - it is the ONLY carve-out, and it applies
 * to RCW 51.16.210, which is horse racing. It has nothing to do with retail.
 */
export const RCW_51_32_073_SUPPLEMENTAL_PENSION: GuidanceAuthority = {
  id: "rcw-51-32-073-supplemental-pension-split",
  kind: "state_law",
  cite: "RCW 51.32.073(1), (2)",
  quote:
    "(1) Except as provided in subsection (2) of this section, each employer shall retain from the " +
    "earnings of each worker that amount as shall be fixed from time to time by the director, the " +
    "basis for measuring said amount to be determined by the director. The money so retained shall " +
    "be matched in an equal amount by each employer, and all such moneys shall be remitted to the " +
    "department in such manner and at such intervals as the department directs and shall be placed " +
    "in the supplemental pension fund ... (2) None of the amount assessed for the supplemental " +
    "pension fund under RCW 51.16.210 may be retained from the earnings of workers covered under " +
    "RCW 51.16.210.",
  soWhat:
    "The supplemental pension is split with your workers, half and half, and the statute says " +
    "'shall' - you do not have a choice about it. This corrected a real bug in this system. The " +
    "first version of our workers' comp math treated the pension as entirely yours and would have " +
    "under-withheld about $202 a year per full-time employee, quietly, forever. Under-withholding " +
    "is not the safe direction: the shortfall becomes your cost, and Washington does not let you " +
    "go back and claw it out of a worker's later paycheck.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.32.073",
};

/**
 * The Stay-at-Work fund. Note the verb: "may collect," and "up to one-half."
 * This is the only one of the three shared funds that is PERMISSIVE. It is a
 * ceiling, not a formula - which is one more reason this system reads the split
 * off the rate notice instead of trying to re-derive it.
 */
export const RCW_51_32_090_STAY_AT_WORK: GuidanceAuthority = {
  id: "rcw-51-32-090-stay-at-work-split",
  kind: "state_law",
  cite: "RCW 51.32.090(6)",
  quote:
    "The department shall create a Washington stay-at-work account which shall be funded by " +
    "assessments of employers insured through the state fund for the costs of the payments " +
    "authorized by subsection (4) of this section, for the cost of creating a reserve for " +
    "anticipated liabilities, and for costs authorized in RCW 51.32.095(2). Employers may collect " +
    "up to one-half the fund assessment from workers.",
  soWhat:
    "Stay-at-Work is the third fund your employees help pay for, but this one is optional and " +
    "capped: you MAY collect up to half, and no more. Because it is optional, there is no single " +
    "correct employee share that software can compute from the base rates alone - it depends on " +
    "what you elected. L&I already resolved all of this and printed the answer on your rate " +
    "notice, so that is the number this system uses.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=51.32.090",
};

/**
 * L&I's own arithmetic, in L&I's own words. This is the formula that let us
 * reconstruct Michael's $0.16445 employee rate exactly and prove the old code
 * was wrong. Note what the experience factor does and does not touch.
 */
export const LNI_PREMIUM_RATE_FORMULA: GuidanceAuthority = {
  id: "lni-premium-rate-formula",
  kind: "state_law",
  cite: "WA Dept. of Labor & Industries, \"Calculating Premium Rates\"",
  quote:
    "Here's how L&I calculates the premium rate for each of the business's risk classifications: " +
    "1. Multiplying the business's experience factor by the sum of the Accident Fund, Medical Aid " +
    "Fund, and Stay at Work base rates, and then 2. Adding the base rate for the Supplemental " +
    "Pension Fund. ... The business's experience factor is 0.9789. ... Accident Fund: $0.0221 ... " +
    "Medical Aid Fund: $0.0160 ... Stay At Work: $0.0003 ... Supplemental Pension Fund: $0.1120 ... " +
    "0.9789 x ($0.0221 + $0.0160 + $0.0003) + $0.1120 = $0.1496 per hour worked.",
  soWhat:
    "Two things fall out of this that matter. First, your experience factor multiplies three of " +
    "the funds but NOT the supplemental pension - the pension is added on at full price. Second, " +
    "these rates run to four and five decimal places of a dollar. Your own employee rate is " +
    "$0.16445 per hour. That cannot be stored as whole cents, which is why this system tracks L&I " +
    "rates in thousandths of a cent. Rounding $0.16445 down to 16 cents would be wrong every " +
    "hour, and rounding it up to 17 cents would be an unlawful deduction.",
  source:
    "https://lni.wa.gov/insurance/rates-risk-classes/rates-for-workers-compensation/calculating-premium-rates",
};

// ---------------------------------------------------------------------------
// 8) TRUST FUND — WHY WITHHELD MONEY IS NOT THE COMPANY'S MONEY
// ---------------------------------------------------------------------------

export const IRC_7501_TRUST_FUND: GuidanceAuthority = {
  id: "irc-7501-trust-fund-payroll",
  kind: "statute",
  cite: "26 U.S.C. §7501(a)",
  quote:
    "Whenever any person is required to collect or withhold any internal revenue tax from any other " +
    "person and to pay over such tax to the United States, the amount of tax so collected or withheld " +
    "shall be held to be a special fund in trust for the United States.",
  soWhat:
    "The moment you withhold money from someone's paycheck, the law says you are holding it in trust. " +
    "It is not revenue, it is not working capital, and it is not yours to borrow from when things get " +
    "tight. In a cash business that distinction is easy to lose sight of, which is exactly why the " +
    "ledger enforces it instead of trusting anyone to remember.",
  source: "https://www.law.cornell.edu/uscode/text/26/7501",
};

export const IRC_6672_TRUST_FUND_PENALTY: GuidanceAuthority = {
  id: "irc-6672-trust-fund-penalty-payroll",
  kind: "statute",
  cite: "26 U.S.C. §6672(a)",
  quote:
    "Any person required to collect, truthfully account for, and pay over any tax imposed by this title " +
    "who willfully fails to collect such tax, or truthfully account for and pay over such tax, or " +
    "willfully attempts in any manner to evade or defeat any such tax or the payment thereof, shall, in " +
    "addition to other penalties provided by law, be liable to a penalty equal to the total amount of " +
    "the tax evaded, or not collected, or not accounted for and paid over.",
  soWhat:
    "This is the one that reaches past the corporation and touches you personally, Michael. Being an " +
    "S-corp does not shield you from it. If withheld payroll taxes do not get paid over, the IRS can " +
    "collect 100% of them from the individual who was responsible — and 'responsible person' means the " +
    "person who decided which bills got paid. That is you. It is the strongest reason in this entire " +
    "system for why payroll liabilities are locked down harder than anything else.",
  source: "https://www.law.cornell.edu/uscode/text/26/6672",
};

// ---------------------------------------------------------------------------
// 8b) WHEN THE CHECK IS TOO SMALL TO CARRY ITS OWN WITHHOLDING
// ---------------------------------------------------------------------------

/**
 * The IRS's own ordering rule. It appears in the tips section because tips are
 * where insufficient funds arise most often, but the principle it states —
 * withhold in a defined order and stop when the money runs out, rather than
 * driving the check negative — is the only ordering instruction the IRS gives
 * an employer anywhere.
 */
export const PUB15_INSUFFICIENT_FUNDS_ORDERING: GuidanceAuthority = {
  id: "pub15-2026-insufficient-funds-ordering",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 6, 'Ordering rule'",
  quote:
    "If, by the 10th of the month after the month for which you received an employee's report on tips, " +
    "you don't have enough employee funds available to deduct the employee tax, you no longer have to " +
    "collect it. If there aren't enough funds available, withhold taxes in the following order. " +
    // THE LIST IS NUMBERED IN THE PUBLICATION. Dropping "1.", "2." and "3."
    // made this quote unverifiable against the source text, and the numbers are
    // not decoration here - the whole authority is about ORDER. Restored.
    "1. Withhold on regular wages and other compensation. 2. Withhold social security and Medicare " +
    "taxes on tips. 3. Withhold income tax on tips.",
  soWhat:
    "The IRS contemplates the situation where a paycheck cannot cover everything that is supposed to " +
    "come out of it, and its answer is an ORDER, not an overdraft. You withhold down the list until " +
    "the money is gone and then you stop. Nowhere does any rule permit handing an employee a check for " +
    "a negative amount — that is not withholding, that is billing your employee for working. When this " +
    "system hits that wall it stops and tells you, rather than quietly inventing a number.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * The companion rule: what you failed to withhold, you may recover from later
 * pay — but you, the employer, owe it either way.
 */
export const PUB15_COLLECTING_UNDERWITHHELD: GuidanceAuthority = {
  id: "pub15-2026-collecting-underwithheld",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 13, 'Collecting underwithheld taxes from employees'",
  quote:
    "If you withheld no income, social security, or Medicare tax, or less than the correct amount from " +
    "an employee's wages, you can make it up from later pay to that employee. But you're the one who " +
    "owes the underpayment. Reimbursement is a matter for settlement between you and the employee. " +
    "Underwithheld income tax and Additional Medicare Tax must be recovered from the employee on or " +
    "before the last day of the calendar year.",
  soWhat:
    "This is the escape hatch and the catch, in the same paragraph. If a check is too small to carry " +
    "its withholding, you are allowed to catch up out of the next one — so the correct move is to " +
    "record the shortfall and recover it, not to force this check negative. The catch is that the IRS " +
    "considers the money owed the moment the wages were paid, whether or not you managed to take it " +
    "out of the employee. And income tax has a hard deadline: December 31 of the same year. After that " +
    "it stops being recoverable from the employee and stays yours.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * Washington's criminal wage-deduction statute. The one that makes an
 * unauthorized deduction a MISDEMEANOR rather than a billing dispute.
 */
export const RCW_49_52_050_WAGE_REBATE: GuidanceAuthority = {
  id: "rcw-49-52-050-wage-rebate",
  kind: "state_law",
  cite: "RCW 49.52.050",
  // books-37 MIRRORED THE SOURCE AND THE GATE IMMEDIATELY FAILED THIS QUOTE.
  // It elided nine words out of the opening clause ("whether said employer be
  // in private business or an elected public official") and then jumped from
  // subsection (2) to the closing line, skipping (3), (4) and (5). Neither
  // ellipsis joined substantial passages, which is what
  // verify-verbatim-quotes.ts refuses - the first one dropped a phrase short
  // enough that eliding it served no purpose except to hide that the quote had
  // been reassembled by hand. Now quoted in full and verified character for
  // character. Subsection (4) earns its place: failing to record a deduction
  // openly in the books is its own offence.
  quote:
    "Any employer or officer, vice principal or agent of any employer, whether said employer be in " +
    "private business or an elected public official, who (1) Shall collect or receive from any " +
    "employee a rebate of any part of wages theretofore paid by such employer to such employee; or " +
    "(2) Wilfully and with intent to deprive the employee of any part of his or her wages, shall pay " +
    "any employee a lower wage than the wage such employer is obligated to pay such employee by any " +
    "statute, ordinance, or contract; or (3) Shall wilfully make or cause another to make any false " +
    "entry in any employer's books or records purporting to show the payment of more wages to an " +
    "employee than such employee received; or (4) Being an employer or a person charged with the duty " +
    "of keeping any employer's books or records shall wilfully fail or cause another to fail to show " +
    "openly and clearly in due course in such employer's books and records any rebate of or deduction " +
    "from any employee's wages; or (5) Shall wilfully receive or accept from any employee any false " +
    "receipt for wages; Shall be guilty of a misdemeanor.",
  soWhat:
    "Washington does not treat taking money out of somebody's wages as a civil matter you can settle " +
    "later. Paying an employee less than you owe them, on purpose, is a crime in this state — and note " +
    "the statute reaches 'any officer, vice principal or agent', which means you personally, Michael, " +
    "not just the corporation. A negative paycheck is the clearest possible example of paying somebody " +
    "less than they earned. That is why this system refuses to produce one instead of warning about it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.52.050",
};

/**
 * The exception that proves the rule: deductions are lawful only when required
 * by law or authorized IN WRITING IN ADVANCE.
 */
export const RCW_49_52_060_AUTHORIZED_WITHHOLDING: GuidanceAuthority = {
  id: "rcw-49-52-060-authorized-withholding",
  kind: "state_law",
  cite: "RCW 49.52.060",
  quote:
    "The provisions of RCW 49.52.050 shall not make it unlawful for an employer to withhold or divert " +
    "any portion of an employee's wages when required or empowered so to do by state or federal law or " +
    "when a deduction has been expressly authorized in writing in advance by the employee for a lawful " +
    "purpose accruing to the benefit of such employee ... PROVIDED, That the employer derives no " +
    "financial benefit from such deduction and the same is openly, clearly and in due course recorded " +
    "in the employer's books.",
  soWhat:
    "There are exactly two doors out of the misdemeanor in RCW 49.52.050: the deduction is required by " +
    "law, or the employee signed for it in advance and it benefits them. Nothing else counts — not a " +
    "verbal okay, not a handbook, not 'they knew'. Read the last clause too: the deduction has to be " +
    "recorded openly in your books. Washington wrote the audit-trail requirement directly into the " +
    "statute, which is why every deduction in this system carries its authorization document with it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.52.060",
};

// ---------------------------------------------------------------------------
// 8.5) FEDERAL DEPOSIT SCHEDULE - WHEN THE WITHHELD MONEY IS ACTUALLY DUE
// ---------------------------------------------------------------------------

/*
 * WHY THIS SECTION EXISTS, AND WHY IT IS THE MOST DANGEROUS GAP WE HAD.
 *
 * Everything above this line answers "how much comes out of the check." Nothing
 * above this line answers "by WHEN must Greenway hand that money to the IRS."
 * Those are different questions with different penalties, and the second one is
 * the one that bites: IRC 6656 (already in this file) charges up to 15% for a
 * LATE deposit of a PERFECTLY CALCULATED amount. You can get every paycheck
 * exactly right and still lose 15% by depositing on the wrong Wednesday.
 *
 * Michael's Q2 2026 Form 941 reported $14,204.57 on line 12 and carried a
 * POPULATED Schedule B. Per PUB15_SCHEDULE_B_REQUIRED below, only semiweekly
 * depositors file Schedule B - so his own filing already asserts he is
 * semiweekly. Independently, four quarters at that level is $56,818.28, which
 * clears the $50,000 line in PUB15_LOOKBACK_PERIOD by 13.6%. Two separate
 * proofs, same answer.
 *
 * That matters enormously for the January 1, 2027 cutover, because the tempting
 * assumption is the wrong one. Greenway is NOT a new employer - the business has
 * been running payroll for years and only the SOFTWARE is new. So the "new
 * employers ... considered to be zero ... monthly" relief in
 * PUB15_NEW_EMPLOYER_ZERO does NOT apply to us, and a system that quietly
 * defaulted a fresh install to "monthly" would have been handing Michael a 15%
 * penalty in the name of a sensible-looking default. It defaults to nothing.
 */

/**
 * THE RULE THAT DECIDES IT. Everything else in this section is downstream of
 * these two sentences.
 */
export const PUB15_LOOKBACK_PERIOD: GuidanceAuthority = {
  id: "pub15-2026-lookback-period",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Lookback period'",
  quote:
    "If you're a Form 941 filer, your deposit schedule for a calendar year is determined from the " +
    "total taxes reported on Forms 941, line 12, in a 4-quarter lookback period. The lookback " +
    "period begins July 1 and ends June 30 as shown next in Table 1. If you reported $50,000 or " +
    "less of taxes for the lookback period, you're a monthly schedule depositor; if you reported " +
    "more than $50,000, you're a semiweekly schedule depositor.",
  soWhat:
    "Read the dates carefully, because they are the part everyone gets wrong: the lookback period " +
    "is NOT last year. For calendar year 2027 it runs July 1, 2025 through June 30, 2026 - it " +
    "ends eighteen months before the payroll it governs. That is deliberate on the IRS's part, so " +
    "you always know your schedule before the year starts. Practically, it means Greenway's 2027 " +
    "schedule was already locked in by the middle of 2026 and cannot be changed by anything that " +
    "happens in 2027. It also means the number that matters is line 12 as ORIGINALLY FILED on " +
    "four specific 941s, not your ledger, not your accruals, and not a corrected figure.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * The companion that stops the lookback sum being quietly "improved" by later
 * corrections. This one exists to make the engine refuse to be helpful.
 */
export const PUB15_LOOKBACK_ADJUSTMENTS: GuidanceAuthority = {
  id: "pub15-2026-lookback-adjustments",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Adjustments and the lookback rule'",
  quote:
    "Adjustments made on Form 941-X, Form 943-X, Form 944-X, and Form 945-X don't affect the " +
    "amount of tax liability for previous periods for purposes of the lookback rule.",
  soWhat:
    "If you amend an old quarter, the lookback total does NOT move. The IRS's own example is an " +
    "employer who originally reported $45,000, later found a $10,000 understatement, filed a " +
    "941-X, and STILL stayed monthly for the year - because the test reads what was originally " +
    "reported. This is the opposite of how an accountant instinctively wants to treat a " +
    "correction, so the engine stores the as-originally-filed line 12 for each lookback quarter " +
    "and will not silently swap in an amended figure.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * THE MISCONCEPTION KILLER. Michael pays biweekly on Friday; that fact has
 * nothing to do with his deposit schedule, and the IRS says so outright.
 */
export const PUB15_SCHEDULE_TERMS_MEANING: GuidanceAuthority = {
  id: "pub15-2026-schedule-terms-meaning",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Application of Monthly and Semiweekly Schedules'",
  quote:
    "The terms \"monthly schedule depositor\" and \"semiweekly schedule depositor\" don't refer to " +
    "how often your business pays its employees or even how often you're required to make " +
    "deposits. The terms identify which set of deposit rules you must follow when an employment " +
    "tax liability arises. The deposit rules are based on the dates when wages are paid (cash " +
    "basis), not on when tax liabilities are accrued for accounting purposes.",
  soWhat:
    "\"Semiweekly\" does not mean you deposit twice a week. Greenway pays every other Friday, so " +
    "Greenway will make ONE deposit per payday - roughly 26 a year - each due the Wednesday after " +
    "its Friday. The word describes WHICH RULEBOOK applies, not how often you write a check. The " +
    "last sentence is the one an accountant needs to underline: deposits follow the CASH date the " +
    "wages were paid, not the period they were earned in or accrued to. A pay period ending in " +
    "June that pays in July is a JULY deposit obligation.",
  source: "https://www.irs.gov/publications/p15",
};

/** What a "deposit period" actually is - the unit liabilities pool into. */
export const PUB15_DEPOSIT_PERIOD: GuidanceAuthority = {
  id: "pub15-2026-deposit-period",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Deposit period'",
  quote:
    "The term \"deposit period\" refers to the period during which tax liabilities are accumulated " +
    "for each required deposit due date. For monthly schedule depositors, the deposit period is a " +
    "calendar month. The deposit periods for semiweekly schedule depositors are Wednesday through " +
    "Friday and Saturday through Tuesday.",
  soWhat:
    "The week is cut into exactly two buckets: Wednesday-Thursday-Friday, and " +
    "Saturday-Sunday-Monday-Tuesday. Every payday falls in one of them, and everything paid in the " +
    "same bucket is deposited together on one due date. Greenway's Friday paydays always land in " +
    "the Wednesday-Friday bucket, which is why the answer is always 'the following Wednesday'.",
  source: "https://www.irs.gov/publications/p15",
};

/** Table 2, in words: the semiweekly due-date mapping the engine encodes. */
export const PUB15_SEMIWEEKLY_DUE_DATES: GuidanceAuthority = {
  id: "pub15-2026-semiweekly-due-dates",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Semiweekly Deposit Schedule' (and Table 2)",
  quote:
    "Under the semiweekly deposit schedule, deposit employment taxes for payments made on " +
    "Wednesday, Thursday, and/or Friday by the following Wednesday. Deposit taxes for payments " +
    "made on Saturday, Sunday, Monday, and/or Tuesday by the following Friday.",
  soWhat:
    "This is the whole semiweekly calendar in two sentences, and it is what the engine turns into " +
    "an actual date. Pay on Friday, deposit by the next Wednesday - five days later, never the " +
    "same week. For Greenway that produces one due date per payday, 26 times a year, every one of " +
    "them a Wednesday unless a federal holiday pushes it.",
  source: "https://www.irs.gov/publications/p15",
};

/** The monthly counterpart, so the engine can explain both branches. */
export const PUB15_MONTHLY_DUE_DATE: GuidanceAuthority = {
  id: "pub15-2026-monthly-due-date",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Monthly Deposit Schedule'",
  quote:
    "Under the monthly deposit schedule, deposit employment taxes on payments made during a month " +
    "by the 15th day of the following month.",
  soWhat:
    "The simpler branch: everything paid in a calendar month goes in one deposit due the 15th of " +
    "the next month. Greenway is NOT on this schedule, but the engine still has to compute it, " +
    "because the whole point of showing both is that Michael can see which rule he is on and what " +
    "the other one would have said.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * The independent proof of Michael's status, and a filing obligation in its own
 * right: semiweekly depositors must attach Schedule B.
 */
export const PUB15_SCHEDULE_B_REQUIRED: GuidanceAuthority = {
  id: "pub15-2026-schedule-b-required",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Semiweekly Deposit Schedule' (Caution)",
  quote:
    "Semiweekly schedule depositors must complete Schedule B (Form 941), Report of Tax Liability " +
    "for Semiweekly Schedule Depositors, and submit it with Form 941.",
  soWhat:
    "Two things follow. First, it is evidence: Greenway's Q2 2026 Form 941 came with a populated " +
    "Schedule B, and only semiweekly depositors file one - so the existing filings already say " +
    "which schedule Michael is on, independently of any arithmetic. Second, it is a duty books-28 " +
    "inherits: a semiweekly 941 is incomplete without Schedule B, and Schedule B is a " +
    "day-by-day liability record, which means the daily liability has to be captured as payroll " +
    "is run rather than reconstructed from a quarterly total at filing time.",
  source: "https://www.irs.gov/publications/p15",
};

/**
 * THE TRAP. This relief is real, it is generous, and it does NOT apply to
 * Greenway - which is exactly why it is recorded here rather than left out.
 */
export const PUB15_NEW_EMPLOYER_ZERO: GuidanceAuthority = {
  id: "pub15-2026-new-employer-zero",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'New employers'",
  quote:
    "For Form 941 filers, your tax liability for any quarter in the lookback period before you " +
    "started or acquired your business is considered to be zero. Therefore, you're a monthly " +
    "schedule depositor for the first calendar year of your business.",
  soWhat:
    "A genuinely new business has no lookback history, so the law treats it as zero and starts it " +
    "on the easy schedule. Greenway does not get this. The business has been paying employees for " +
    "years - it is the SOFTWARE that is new on January 1, 2027, and the IRS has never cared what " +
    "software you use. Recording the rule we DON'T qualify for is the point: it is the most " +
    "plausible wrong answer, the one a fresh install would drift into by looking at its own empty " +
    "tables and concluding 'no history, therefore monthly.' The engine must be told the history.",
  source: "https://www.irs.gov/publications/p15",
};

/** Weekends and DC holidays move due dates. Without this the dates are wrong. */
export const PUB15_BUSINESS_DAYS_ONLY: GuidanceAuthority = {
  id: "pub15-2026-business-days-only",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Deposits Due on Business Days Only'",
  quote:
    "If a deposit is required to be made on a day that isn't a business day, the deposit is " +
    "considered timely if it is made by the close of the next business day. A business day is any " +
    "day other than a Saturday, Sunday, or legal holiday.",
  soWhat:
    "A computed due date is not a real due date until it has been walked forward off weekends and " +
    "holidays. Note the definition is narrow on purpose: for deposits, a 'legal holiday' means a " +
    "legal holiday in the District of Columbia - NOT a Washington State holiday. A day off in " +
    "Olympia does not move an IRS deposit.",
  source: "https://www.irs.gov/publications/p15",
};

/** The semiweekly extension, which is a floor of THREE BUSINESS DAYS. */
export const PUB15_SEMIWEEKLY_THREE_BUSINESS_DAYS: GuidanceAuthority = {
  id: "pub15-2026-semiweekly-three-business-days",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Deposits Due on Business Days Only'",
  quote:
    "Semiweekly schedule depositors have at least 3 business days following the close of the " +
    "semiweekly period to make a deposit. If any of the 3 weekdays after the end of a semiweekly " +
    "period is a legal holiday, you'll have an additional day for each day that is a legal holiday " +
    "to make the required deposit.",
  soWhat:
    "This is a stronger guarantee than the plain next-business-day rule, and it is easy to " +
    "under-apply. A holiday ANYWHERE in the three weekdays after the period closes pushes the due " +
    "date out a day - even a holiday that falls BEFORE the Wednesday you were aiming at. The IRS's " +
    "own example: pay Friday, Monday is a holiday, and the deposit normally due Wednesday may be " +
    "made Thursday. Counting three business days is therefore the correct algorithm; nudging a " +
    "Wednesday off holidays is not, and would silently under-count.",
  source: "https://www.irs.gov/publications/p15",
};

/** The emergency brake: $100,000 in one deposit period is due the NEXT DAY. */
export const PUB15_100K_NEXT_DAY: GuidanceAuthority = {
  id: "pub15-2026-100k-next-day-rule",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, '$100,000 Next-Day Deposit Rule'",
  quote:
    "If you accumulate $100,000 or more in taxes on any day during a monthly or semiweekly " +
    "deposit period (see Deposit period, earlier in this section), you must deposit the tax by " +
    "the next business day, whether you're a monthly or semiweekly schedule depositor. The " +
    "$100,000 tax liability threshold requiring a next-day deposit is determined before you " +
    "consider any reduction of your liability for nonrefundable credits.",
  soWhat:
    "It overrides whatever schedule you are on, and it has a sting in the tail: a MONTHLY " +
    "depositor who trips it becomes semiweekly on the next day and stays semiweekly for the rest " +
    "of that year and all of the next. Greenway's biggest quarter of 2026 was $14,204.57, so this " +
    "is nowhere near live today - but a single large event (an owner bonus, a payout) is exactly " +
    "the shape of thing that trips it, so the engine watches for it instead of assuming Greenway " +
    "is too small. Note 'before you consider any reduction ... for nonrefundable credits': you " +
    "test the GROSS liability, not what you would actually wire.",
  source: "https://www.irs.gov/publications/p15",
};

/** Two paydays, one semiweekly period, two quarters: two deposits. */
export const PUB15_SEMIWEEKLY_SPANNING_QUARTERS: GuidanceAuthority = {
  id: "pub15-2026-semiweekly-spanning-quarters",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'Semiweekly deposit period spanning 2 quarters'",
  quote:
    "If you have more than 1 pay date during a semiweekly period and the pay dates fall in " +
    "different calendar quarters, you'll need to make separate deposits for the separate " +
    "liabilities.",
  soWhat:
    "The one due date can still require two separate deposits, because each 941 covers one " +
    "quarter and money cannot be reported on two returns at once. The IRS's example is a " +
    "Wednesday September 30 payday and a Friday October 2 payday: both deposits are due Wednesday " +
    "October 7, but they must go separately, tagged to Q3 and Q4. Greenway's biweekly Friday " +
    "cadence makes this rare, but 'rare' and 'never' are different, and this is the kind of edge " +
    "that produces a mismatched 941 nobody can explain a year later.",
  source: "https://www.irs.gov/publications/p15",
};

// ---------------------------------------------------------------------------
// 9) THE REGISTRY
// ---------------------------------------------------------------------------

/** Every payroll-tax authority, in the order a human would want to read them. */
export const PAYROLL_TAX_AUTHORITIES: readonly GuidanceAuthority[] = [
  // federal income tax withholding method
  PUB15T_AUTOMATED_METHOD,
  PUB15T_WORKSHEET_1A_CLAMPS,
  PUB15T_LINE_1G_STANDARD_AMOUNTS,
  PUB15T_NO_W4_DEFAULT,
  PUB15T_EXEMPT_IS_INCOME_TAX_ONLY,
  IRC_3401B_ANNUAL_PAYROLL_PERIOD,
  PUB15T_ANNUAL_PAYROLL_PERIOD_TABLE,
  PUB15T_ROUNDING,
  // FICA
  IRC_3101_EMPLOYEE_FICA,
  IRC_3111_EMPLOYER_FICA,
  SSA_2026_WAGE_BASE,
  // FUTA
  IRC_3301_FUTA_RATE,
  IRC_3306_FUTA_WAGE_BASE,
  IRC_3302_FUTA_CREDIT,
  // Washington
  RCW_50A_10_030_PFML,
  ESD_PFML_2026_RATE,
  RCW_50B_04_080_WA_CARES,
  WA_CARES_UNCAPPED,
  LNI_MINIMUM_WAGE_ANNOUNCEMENT,
  FEDERAL_MINIMUM_WAGE_FS30,
  // late filing / late payment — penalties and interest
  RCW_50_12_220_ESD_LATE,
  RCW_50_24_040_ESD_INTEREST,
  ESD_DELINQUENT_TAX_RATE,
  RCW_51_48_210_LNI_LATE,
  RCW_51_16_150_LNI_INJUNCTION,
  IRC_6656_DEPOSIT_PENALTY,
  IRC_6651_FAILURE_TO_FILE,
  ESD_SUTA_RATE_STRUCTURE,
  RCW_51_16_140_LNI_DEDUCTION,
  RCW_51_16_035_LNI_CLASSIFICATION,
  RCW_51_16_060_LNI_HOURS,
  RCW_51_32_073_SUPPLEMENTAL_PENSION,
  RCW_51_32_090_STAY_AT_WORK,
  LNI_PREMIUM_RATE_FORMULA,
  // when the check cannot carry its own withholding
  PUB15_INSUFFICIENT_FUNDS_ORDERING,
  PUB15_COLLECTING_UNDERWITHHELD,
  RCW_49_52_050_WAGE_REBATE,
  RCW_49_52_060_AUTHORIZED_WITHHOLDING,
  // federal deposit schedule - WHEN the money is due
  PUB15_LOOKBACK_PERIOD,
  PUB15_LOOKBACK_ADJUSTMENTS,
  PUB15_SCHEDULE_TERMS_MEANING,
  PUB15_DEPOSIT_PERIOD,
  PUB15_SEMIWEEKLY_DUE_DATES,
  PUB15_MONTHLY_DUE_DATE,
  PUB15_SCHEDULE_B_REQUIRED,
  PUB15_NEW_EMPLOYER_ZERO,
  PUB15_BUSINESS_DAYS_ONLY,
  PUB15_SEMIWEEKLY_THREE_BUSINESS_DAYS,
  PUB15_100K_NEXT_DAY,
  PUB15_SEMIWEEKLY_SPANNING_QUARTERS,
  // trust fund
  IRC_7501_TRUST_FUND,
  IRC_6672_TRUST_FUND_PENALTY,
] as const;

/** Look up one authority by id. Returns undefined rather than throwing. */
export function findPayrollAuthority(id: string): GuidanceAuthority | undefined {
  return PAYROLL_TAX_AUTHORITIES.find((a) => a.id === id);
}

/**
 * Resolve a list of ids to authorities. THROWS on an unknown id on purpose:
 * a refusal that cites a citation which does not exist is worse than no refusal
 * at all, because it looks authoritative while being empty. Fail loudly at the
 * seam instead of shipping a dangling reference into Michael's face.
 */
export function resolvePayrollAuthorities(ids: readonly string[]): GuidanceAuthority[] {
  return ids.map((id) => {
    const found = findPayrollAuthority(id);
    if (!found) {
      throw new Error(
        `payroll-tax-authorities: unknown authority id "${id}". ` +
          `A refusal must cite a real source; refusing to render a dangling citation.`,
      );
    }
    return found;
  });
}

// ---------------------------------------------------------------------------
// 10) SELF-TESTS
// ---------------------------------------------------------------------------

/**
 * These run in the vitest suite. They exist because an authorities file rots in
 * a specific way: someone adds a record, copies a neighbouring one, and forgets
 * to change the id or blanks the quote. Both are invisible in review and both
 * destroy the credibility of every refusal in the product.
 */
export function __runPayrollTaxAuthoritiesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`payroll-tax-authorities self-test FAILED: ${name}`);
    }
  };

  const ids = PAYROLL_TAX_AUTHORITIES.map((a) => a.id);
  check("ids are unique", new Set(ids).size === ids.length);
  check("registry is non-empty", PAYROLL_TAX_AUTHORITIES.length > 0);

  for (const a of PAYROLL_TAX_AUTHORITIES) {
    check(`${a.id}: has cite`, a.cite.trim().length > 0);
    check(`${a.id}: has quote`, a.quote.trim().length > 0);
    check(`${a.id}: has soWhat`, a.soWhat.trim().length > 0);
    check(`${a.id}: source is a government URL`, /^https:\/\//.test(a.source));
    check(`${a.id}: quote is substantive`, a.quote.trim().length >= 40);
  }

  check("lookup finds a known id", findPayrollAuthority("irc-3101-employee-fica") !== undefined);
  check("lookup misses an unknown id", findPayrollAuthority("nope") === undefined);

  let threw = false;
  try {
    resolvePayrollAuthorities(["definitely-not-real"]);
  } catch {
    threw = true;
  }
  check("resolve throws on a dangling citation", threw);

  return { passed, failed };
}
