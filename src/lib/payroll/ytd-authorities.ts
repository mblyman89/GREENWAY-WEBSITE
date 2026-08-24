/**
 * src/lib/payroll/ytd-authorities.ts   (books-34)
 *
 * THE LAW BEHIND YEAR-TO-DATE ACCUMULATION.
 *
 * Michael asked for this first, and he was right to. Of everything left in the
 * payroll pipeline, this is the one gap that produces a WRONG NUMBER THAT LOOKS
 * RIGHT. Every other missing piece announces itself: a form that does not exist
 * cannot be filed, a screen that has no button cannot be clicked. But a payroll
 * run that does not know what it already paid an employee this year keeps
 * withholding Social Security after the wage base is reached, prints a
 * perfectly ordinary-looking paycheck, and is only discovered the following
 * January when the W-2 will not reconcile.
 *
 * WHY THE ENGINE WAS ALREADY READY. `payroll-withholding-core.ts` has accepted
 * a `YtdWageAccumulators` argument since the withholding slice, with SEVEN
 * separate figures because there are seven separate legal definitions of "wages
 * so far this year". It caps OASDI at the wage base, leaves Medicare uncapped,
 * starts Additional Medicare at $200,000 with no employer match, and stops FUTA
 * at $7,000. None of that had to be written here.
 *
 * What did not exist was anywhere to KEEP those seven numbers between runs. A
 * grep across the whole tree found exactly one caller passing the argument, and
 * it passed the constant `ZERO_YTD` - correctly, because it is an onboarding
 * illustration that deliberately starts the year at zero. So the arithmetic was
 * right and permanently unused. This slice supplies the memory.
 *
 * STANDING RULE 24: every `quote` below is copied character-for-character out
 * of the mirrored IRS instructions on disk. `scripts/verify-verbatim-quotes.ts`
 * re-reads each one against the corpus and fails the build on one character of
 * drift. Two of these quotes begin mid-sentence because the mirrored text wraps
 * that way; they are NOT tidied up, because tidying a quote is how a paraphrase
 * gets in.
 */

export type YtdAuthority = {
  readonly id: string;
  /**
   * The IRS instructions are `irs_guidance`: persuasive, official, and NOT law.
   * Saying so is the difference between teaching Michael and misleading him -
   * a Publication or an Instruction cannot be relied on as authority against
   * the IRS, and this codebase tags them accordingly everywhere else.
   */
  readonly kind: "irs_guidance";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

/**
 * ═══ THE PATH IS NOT THE SOURCE. (books-46) ═══
 *
 * These two constants describe the SAME IRS document and they are not
 * interchangeable, because two different readers consume them:
 *
 *   - `W2_SOURCE_PATH` is for MACHINES. `ytd-authorities.test.ts` opens it with
 *     `readFileSync` to prove every quote below is a real substring of the
 *     mirrored corpus. It must stay a repo-relative path or that check dies.
 *
 *   - `W2_SOURCE_URL` is for MICHAEL. `GuidanceAuthority.source` is rendered as
 *     `href={a.source}` — in `CompanyInformationForm.tsx`, in
 *     `payroll-setup/page.tsx`, and now on the Form W-2 screen. It is his way
 *     OUT of this software and into the actual document.
 *
 * WHY THIS SPLIT EXISTS. Originally one constant fed both, holding the path. The
 * seven authorities in this file are BORROWED by `formW2Authorities()` and
 * render in the same panel as that module's own 28 — so seven of the forty-one
 * rows on the W-2 screen would have shown a link to `docs/authorities/...`,
 * dead in a browser.
 *
 * AND NOTHING WOULD HAVE CAUGHT IT. `form-w2-authorities.ts` documents finding
 * and fixing this exact defect in its own 28, and shipped a gate for it — but
 * the gate loops `FORM_W2_OWN_AUTHORITIES`, so it guards 28 of the 41 it
 * displays. The registry-wide assertion elsewhere only requires `source` to be
 * NON-EMPTY, and a repo-relative path is gloriously non-empty. A correct fix
 * with a scope narrower than the bug leaves the bug (standing rule 39). The
 * gate in `ytd-authorities.test.ts` now loops THIS file, so the two halves of
 * the panel cannot drift apart again.
 *
 * The URL is byte-identical to `FORM_W2_SOURCE_URL` in `form-w2-authorities.ts`
 * on purpose, and a test asserts they match. Half a panel linking one document
 * to two addresses is a panel that quietly contradicts itself.
 */
export const W2_SOURCE_PATH = "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt";

/** Where Michael reads the real thing. Rendered as an href. */
export const W2_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf";

/* ------------------------------------------------------------------ *
 * THE CEILING, AND THE THING THAT HAS NO CEILING
 * ------------------------------------------------------------------ */

/**
 * The wage base is an ANNUAL ceiling, which is precisely why per-period
 * arithmetic cannot find it.
 *
 * A pay run that only knows about itself has no way to notice that the
 * twenty-third cheque of the year crossed $184,500. This sentence is the reason
 * the accumulator table exists.
 */
export const W2_BOX3_WAGE_BASE_CEILING: YtdAuthority = {
  id: "w2-box3-wage-base-ceiling",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 3—Social security wages",
  quote:
    // Starts at a sentence boundary. The preceding sentence runs back into a
    // cross-reference ("...(or railroad retirement taxes, if applicable) paid
    // by employer."), so opening the quote there would drag in a dangling
    // fragment that says nothing about the ceiling. This is the whole rule.
    "The total of boxes 3 and 7 cannot exceed $184,500 (2026 maximum social security wage base).",
  soWhat:
    "Social Security stops once an employee has been paid $184,500 in a calendar year. Nobody at Greenway is likely to reach it soon, but the rule is not optional and the system must be able to stop - and the only way to know you have reached an annual figure is to remember what you already paid. This is the single number that made year-to-date storage the first job in the queue rather than the fourth.",
  source: W2_SOURCE_URL,
};

/**
 * Medicare has NO ceiling, and storing one figure for "wages" would hide that.
 *
 * This is why the accumulator has seven columns instead of one. OASDI wages and
 * Medicare wages are the same until the wage base, and permanently different
 * afterwards.
 */
export const W2_BOX5_NO_MEDICARE_LIMIT: YtdAuthority = {
  id: "w2-box5-no-medicare-limit",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 5—Medicare wages and tips",
  quote:
    "Box 5—Medicare wages and tips. The wages and tips subject to Medicare tax are the same as those subject to social security tax (boxes 3 and 7) except that there is no wage base limit for Medicare tax. Enter the total Medicare",
  soWhat:
    "Medicare never stops. Social Security does. If the system kept a single running total called 'wages' it would be right for one of these and wrong for the other from the moment an employee crossed the wage base - so it keeps them apart, permanently, in separate columns.",
  source: W2_SOURCE_URL,
};

/**
 * THE IRS'S OWN WORKED EXAMPLE, used as the test oracle.
 *
 * A worked example published by the agency that will read the form is worth
 * more than any figure I could invent, because if our engine disagrees with it
 * the engine is wrong by definition. `tests/compliance/ytd-core.test.ts` runs
 * exactly these numbers.
 */
export const W2_WORKED_EXAMPLE: YtdAuthority = {
  id: "w2-worked-example-199750",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Example of how to report social security and Medicare wages",
  quote:
    "Medicare wages. You paid your employee $199,750 in wages. Enter in box 3 (social security wages) 184500.00, but enter in box 5 (Medicare wages and tips) 199750.00. There is no limit on the amount reported in box 5. If the amount of wages paid was $184,500 or less, the amounts entered in boxes 3 and 5 will be the same.",
  soWhat:
    "This is the test the accumulator has to pass, in the IRS's own numbers. Pay somebody $199,750 across a year and box 3 must read 184,500 while box 5 reads 199,750. Our engine is run against exactly this example, so if it ever drifts the suite says so in seconds rather than the SSA saying so in February.",
  source: W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * ADDITIONAL MEDICARE - the one with no employer match
 * ------------------------------------------------------------------ */

/**
 * Note the phrase "in the pay period in which it pays wages ... in excess of
 * $200,000". The trigger is a YEAR-TO-DATE test evaluated at every period, and
 * once tripped it stays tripped until December. Another rule that is simply
 * uncomputable without memory.
 */
export const ADDITIONAL_MEDICARE_THRESHOLD: YtdAuthority = {
  id: "w2-additional-medicare-threshold",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Additional Medicare Tax",
  quote:
    "Additional Medicare Tax. In addition to withholding Medicare tax at 1.45%, an employer is required to withhold a 0.9% Additional Medicare Tax on any Federal Insurance Contributions Act (FICA) wages or Railroad Retirement Tax Act (RRTA) compensation it pays to an employee in excess of $200,000 in a calendar year. An employer is required to begin withholding Additional Medicare Tax in the pay period in which it pays wages or compensation in excess of $200,000 to an employee and continue to withhold it until the end of the calendar year. Additional Medicare Tax is imposed only on the employee. There is no employer share of Additional Medicare Tax. All wages and compensation that are subject to Medicare tax are subject to Additional Medicare Tax withholding if paid in excess of the $200,000 withholding threshold.",
  soWhat:
    "Above $200,000 in a year an extra 0.9% comes out of the EMPLOYEE's cheque and Greenway matches none of it. Two things make this a year-to-date problem rather than a per-cheque one: the threshold is annual, and once an employee crosses it you keep withholding for the rest of the year even on later, smaller cheques. A system with no memory would start and stop the extra withholding at random.",
  source: W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * THE SSA'S REJECTION RULES - invariants, not advice
 * ------------------------------------------------------------------ */

/**
 * THE MOST USEFUL PARAGRAPH IN THE WHOLE DOCUMENT.
 *
 * These are not style tips. They are the mechanical conditions under which the
 * Social Security Administration REJECTS a wage report outright. Every one of
 * them is a statement about the RELATIONSHIP between accumulated figures, which
 * means every one of them can be enforced by a database constraint at the
 * moment the numbers are written instead of discovered in February when the
 * filing bounces.
 *
 * Migration 0199 encodes these as CHECK constraints. That is the whole design
 * argument for putting the accumulators in their own table rather than deriving
 * them on the fly: a derived figure cannot be constrained.
 */
export const SSA_REJECTION_CONDITIONS: YtdAuthority = {
  id: "ssa-rejection-conditions",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Rejected wage reports from the Social Security Administration (SSA)",
  quote:
    // The heading sentence above this one is NOT quoted, and that is
    // deliberate. The mirrored text hyphenates it across a line break as
    // "Social Security Ad-\nministration", so any faithful copy would either
    // begin with the orphan fragment "ministration" or be silently repaired by
    // hand - and repairing a quote by hand is how a paraphrase gets in. The
    // heading is carried in `cite` instead, where it belongs, and the quote
    // starts at the next clean sentence boundary.
    "The SSA will reject Form W-2 electronic and paper wage reports under the following conditions. • Medicare wages and tips are less than the sum of social security wages and social security tips. • Social security tax is greater than zero; social security wages and social security tips are equal to zero. • Medicare tax is greater than zero; Medicare wages and tips are equal to zero.",
  soWhat:
    "Three ways to have a whole year's wage report thrown back at you. Each one is a relationship between two running totals, so the database enforces all three the moment a pay run is posted: Medicare wages can never be less than Social Security wages, and neither tax can be nonzero while its own wage figure is zero. Catching this in August costs nothing; catching it at the filing deadline costs a scramble.",
  source: W2_SOURCE_URL,
};

/**
 * The IRS's own pre-filing checklist, which repeats the wage base as an
 * EMPLOYEE-BY-EMPLOYEE test.
 */
export const W2_PREFILING_CHECKLIST: YtdAuthority = {
  id: "w2-prefiling-checklist",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Caution: To help reduce discrepancies on Forms W-2",
  // THE WHOLE LIST, ALL TEN BULLETS. An earlier draft of this authority quoted
  // only three of them, and the verbatim checker passed it without complaint -
  // because a truncated quote is still a valid substring of the source. The
  // structural guard in tests/compliance/ytd-authorities.test.ts is what found
  // it, by noticing that the quote stopped immediately before another bullet.
  // Seven of these ten rules were being dropped, including "do not report a
  // nonzero amount in box 4 if boxes 3 and 7 are both zero" - a constraint the
  // accumulator table needs and would not otherwise have been taught.
  quote:
    "Caution: To help reduce discrepancies on Forms W-2, do the following. • Report bonuses as wages and as social security and Medicare wages on Form W-2; and on Forms 941, 943, 944, and Schedule H (Form 1040). • Report both social security and Medicare wages and taxes separately on Forms W-2 and W-3; and on Forms 941, 943, 944, and Schedule H (Form 1040). • Report social security taxes withheld on Form W-2 in box 4, not in box 3. • Report Medicare taxes withheld on Form W-2 in box 6, not in box 5. • Do not report a nonzero amount in box 4 if boxes 3 and 7 are both zero. • Do not report a nonzero amount in box 6 if box 5 is zero. • Do not report an amount in box 5 that is less than the sum of boxes 3 and 7. • Make sure that the social security wage amount for each employee does not exceed the annual social security wage base limit ($184,500 for 2026). • Do not report noncash wages that are not subject to social security or Medicare taxes as social security or Medicare wages. • If you use an EIN on any quarterly Forms 941 for the year (or annual Forms 943, 944, CT-1, or Schedule H (Form 1040)) that is different from the EIN reported in box e on Form W-3, enter the other EIN in box h on Form W-3.",
  soWhat:
    "This is the IRS's own pre-filing checklist, and most of it reads as arithmetic the system can simply enforce. The wage-base ceiling is tested PER EMPLOYEE, not across the payroll, which is why the accumulator is keyed by employee and year rather than kept as a company total. Three of these bullets restate the same invariants the SSA rejection paragraph gives - when a tax authority says a thing twice in one document, it is worth encoding as a database constraint rather than a habit.",
  source: W2_SOURCE_URL,
};

/**
 * W-2 must reconcile to the four quarterly 941s.
 *
 * This is why the accumulator stores TAX as well as WAGES. A design that kept
 * only wages would force the 941 and the W-2 to each recompute tax from wages,
 * and two independent recomputations that must agree are two chances to
 * disagree.
 */
export const W2_941_RECONCILIATION: YtdAuthority = {
  id: "w2-941-reconciliation",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Reconciling Forms W-2, W-3, 941",
  quote:
    "• Be sure that the amounts on Form W-3 are the total amounts from Forms W-2. • Reconcile Form W-3 with your four quarterly Forms 941 (or annual Forms 943, 944, CT-1, or Schedule H (Form 1040)) by comparing amounts reported for the following. 1. Income tax withholding (box 2). 2. Social security wages, Medicare wages and tips, and social security tips (boxes 3, 5, and 7).",
  soWhat:
    "The W-2 you file in January must agree with the four 941s you filed during the year. That is only achievable if both are reading the SAME stored figures, which is why this table holds tax withheld as well as wages paid. When the 941 builder arrives it will read these columns rather than recompute them, and 'recomputed it twice and got two answers' stops being possible.",
  source: W2_SOURCE_URL,
};

export const YTD_AUTHORITIES: readonly YtdAuthority[] = [
  W2_BOX3_WAGE_BASE_CEILING,
  W2_BOX5_NO_MEDICARE_LIMIT,
  W2_WORKED_EXAMPLE,
  ADDITIONAL_MEDICARE_THRESHOLD,
  SSA_REJECTION_CONDITIONS,
  W2_PREFILING_CHECKLIST,
  W2_941_RECONCILIATION,
];
