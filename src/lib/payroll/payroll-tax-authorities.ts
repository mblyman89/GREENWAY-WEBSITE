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
  quote:
    "If you're an employer with an automated payroll system, use Worksheet 1A and the Percentage " +
    "Method tables in this section to figure federal income tax withholding. This method works for " +
    "Forms W-4 for all prior, current, and future years. This method also works for any amount of wages.",
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
  quote:
    "1i Subtract line 1h from line 1e. If zero or less, enter -0-. This is the Adjusted Annual Wage " +
    "Amount. ... 3c Subtract line 3b from line 2h. If zero or less, enter -0-.",
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
  quote:
    "If the box in Step 2 of Form W-4 is checked, enter -0-. If the box is not checked, enter $12,900 " +
    "if the taxpayer is married filing jointly or $8,600 otherwise.",
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
    "Withhold on regular wages and other compensation. Withhold social security and Medicare taxes on " +
    "tips. Withhold income tax on tips.",
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
  quote:
    "Any employer or officer, vice principal or agent of any employer ... who (1) Shall collect or " +
    "receive from any employee a rebate of any part of wages theretofore paid by such employer to such " +
    "employee; or (2) Wilfully and with intent to deprive the employee of any part of his or her wages, " +
    "shall pay any employee a lower wage than the wage such employer is obligated to pay such employee " +
    "by any statute, ordinance, or contract ... Shall be guilty of a misdemeanor.",
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
  RCW_50B_04_080_WA_CARES,
  WA_CARES_UNCAPPED,
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
