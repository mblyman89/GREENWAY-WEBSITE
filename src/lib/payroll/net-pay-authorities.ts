/**
 * NET PAY AUTHORITIES - the law that decides the order of operations on a
 * paycheque, and therefore the number at the bottom of it.
 *
 * books-37. Michael's instruction for this slice, verbatim: "Please proceed
 * with the net pay and the deferred ytd store slice. Please make sure to
 * include the same level of verbatim authoritative text and their plain
 * english explanations."
 *
 * WHY A SEPARATE AUTHORITY FILE, WHEN GARNISHMENT AND WITHHOLDING BOTH HAVE ONE
 *
 * Because the question this slice answers belongs to neither of them. The
 * withholding authorities say how much tax comes out. The garnishment
 * authorities say how much a creditor may take. Neither says what ORDER those
 * happen in, or what the second one is measured against - and that is the
 * question that was silently unanswered until books-37, because the two
 * engines were never connected to each other.
 *
 * The order is not a style choice. Do it in the wrong sequence and every
 * individual calculation is still correct while the cheque is wrong.
 *
 * STANDING RULE 24: the quote is sacred. Every `quote` below is a
 * character-for-character copy taken from the mirrored source file on disk, not
 * a retyping from memory. scripts/verify-verbatim-quotes.ts re-reads each one
 * against its corpus on every commit and fails the build on a single character
 * of drift.
 */

export type NetPayAuthority = {
  readonly id: string;
  /**
   * NARROW ON PURPOSE, and it is a strict subset of `GuidanceAuthorityKind`.
   * The adapter in books-guidance-core.ts converts this type to that one, so if
   * anybody ever adds a kind here that the shared registry does not know, the
   * BUILD stops at that conversion instead of a payroll screen rendering a
   * blank weight badge next to a citation.
   *
   * A NOTE ON `agency_guidance`, BECAUSE THE FIRST ATTEMPT GOT IT WRONG. Two of
   * the records below are DOL Wage and Hour fact sheets. The first draft tagged
   * them `irs_guidance` on the reasoning that the WEIGHT was identical -
   * persuasive, official, not binding - so the tag was close enough. It was
   * not. `GUIDANCE_KIND_LABELS` renders that tag on screen as the literal words
   * "IRS guidance", so an authority panel would have told Michael that a
   * Department of Labor document came from the IRS. Right weight, false
   * attribution, and attribution is the entire job of an authority panel. The
   * fix was to add a truthful kind to the shared union rather than to keep
   * stretching a wrong one.
   */
  readonly kind: "statute" | "regulation" | "state_law" | "agency_guidance";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

const USC1672 = "docs/authorities/federal/usc-15-1672.txt";
const FS30 = "docs/authorities/federal/dol-whd-fact-sheet-30.txt";
const RCW5116 = "docs/authorities/state-wa/rcw-51.16.140.txt";
const RCW4952_050 = "docs/authorities/state-wa/rcw-49.52.050.txt";
const RCW4952_060 = "docs/authorities/state-wa/rcw-49.52.060.txt";

/* ------------------------------------------------------------------ *
 * THE BASE - and the deduction that was missing from it
 * ------------------------------------------------------------------ */

/**
 * The statutory definition. Short, and it decides everything downstream.
 *
 * Note what it does NOT do: it does not list which deductions qualify. It sets
 * a TEST - "required by law" - and leaves the application to whatever other law
 * does the requiring. That is why the two records below matter.
 */
export const DISPOSABLE_EARNINGS_BASE: NetPayAuthority = {
  id: "net-pay-usc-15-1672-base",
  kind: "statute",
  cite: "15 U.S.C. §1672(b)",
  quote:
    'The term "disposable earnings" means that part of the earnings of any individual remaining after the deduction from those earnings of any amounts required by law to be withheld.',
  soWhat:
    "This is the line everything else on the cheque is measured from, and it is neither gross pay nor take-home pay. It is gross MINUS only what the law forces out. The statute deliberately does not hand you a list - it gives you a test, 'required by law', and you apply that test to each deduction one at a time. Get this line wrong and every garnishment computed from it is wrong too, in the same direction, on every cheque, forever.",
  source: USC1672,
};

/**
 * THE DEFECT books-37 FOUND AND FIXED.
 *
 * garnishment-core.PaycheckFacts documented the required-by-law bucket as
 * income tax, FICA, PFML and WA Cares, and said "NOTHING ELSE." That omitted
 * the L&I employee premium. This is the sentence that proves the omission wrong.
 */
export const LNI_IS_REQUIRED_BY_LAW: NetPayAuthority = {
  id: "net-pay-rcw-51-16-140-required",
  kind: "state_law",
  cite: "RCW 51.16.140(1), (2)",
  // RULE 24, CAUGHT BY THE GATE, RECORDED SO IT IS NOT REPEATED. The first
  // draft of this quote ran subsection (1) straight into subsection (2) and
  // dropped the "(2)" marker in the join, because on the source page the two
  // are separated by a line break rather than by anything that looks like
  // punctuation. Every word was real and the result still misrepresented the
  // statute: it read as one continuous sentence-run, which hides the fact that
  // the criminal penalty lives in its OWN subsection and attaches to a
  // different act than the mandatory deduction in (1). verify-verbatim-quotes
  // failed the commit with "matches the first 732 characters, then diverges".
  // Four characters. That is the whole reason the quote is re-read from disk on
  // every commit instead of trusted because it looked right the day it was
  // pasted.
  quote:
    "(1) Every employer who is not a self-insurer shall deduct from the pay of each of his or her workers one-half of the amount he or she is required to pay, for medical benefits within each risk classification. Such amount shall be periodically determined by the director and reported by him or her to all employers under this title: PROVIDED, That the state governmental unit shall pay the entire amount into the medical aid fund for volunteers, as defined in RCW 51.12.035, and the state apprenticeship council shall pay the entire amount into the medical aid fund for registered apprentices or trainees, for the purposes of RCW 51.12.130. The deduction under this section is not authorized for premiums assessed under RCW 51.16.210. (2) It shall be unlawful for the employer, unless specifically authorized by this title, to deduct or obtain any part of the premium or other costs required to be by him or her paid from the wages or earnings of any of his or her workers, and the making of or attempt to make any such deduction shall be a gross misdemeanor.",
  soWhat:
    "Read the verb: 'shall deduct'. Not may. Washington ORDERS you to take half the medical-aid premium out of your worker's pay, and the second half of this section makes deducting the wrong amount a gross misdemeanor. Something the state compels you to withhold, on pain of a criminal charge, is about as clearly 'required by law' as a deduction can get. So it comes out BEFORE the garnishment limits are applied. The old code left it in, which quietly made disposable earnings look bigger than they were, which let a creditor take 25% of a number that was too high. Small on one cheque, permanent, and taken from somebody who is already having their wages garnished.",
  source: RCW5116,
};

/**
 * The enforcing agency's own reading of the statutory test.
 *
 * WEIGHT, STATED HONESTLY. Fact Sheet #30 says of itself that its contents "do
 * not have the force and effect of law". It is quoted because it is the
 * published view of the division that ENFORCES the CCPA against employers, on a
 * term the statute leaves undefined. Persuasive, not binding, and tagged
 * `agency_guidance` rather than `regulation` so the weight badge on screen
 * reads rank 1 and nobody mistakes it for a rule.
 */
export const WHAT_COUNTS_AS_REQUIRED: NetPayAuthority = {
  id: "net-pay-fs30-legally-required",
  kind: "agency_guidance",
  cite: "U.S. DOL, Wage and Hour Division, Fact Sheet #30 (Dec. 2024)",
  quote:
    'The amount of pay subject to garnishment is based on an employee\'s "disposable earnings," which is the amount of earnings left after legally required deductions are made. Examples of such deductions include federal, state, and local taxes, and the employee\'s share of Social Security, Medicare and State Unemployment Insurance tax. It also includes withholdings for employee retirement systems required by law.',
  soWhat:
    "The agency that enforces this against employers gives its examples, and the pattern in them is what matters: the test is whether the deduction is COMPELLED, not who ends up holding the money. They include the employee's share of state unemployment insurance - a state-law payroll deduction that is not an income tax at all. Washington's L&I employee premium is the same kind of animal, which is why it belongs in the same bucket. Worth knowing that this document says of itself that it does not have the force of law; it is the enforcer's published reading of a term the statute leaves open, which is why we follow it and why we tell you what it is.",
  source: FS30,
};

/**
 * THE MIRROR IMAGE, and the mistake almost everybody makes.
 *
 * The instinct that health insurance is "a deduction like any other" is
 * overwhelming, because on a pay stub it looks exactly like one.
 */
export const VOLUNTARY_DOES_NOT_REDUCE_THE_BASE: NetPayAuthority = {
  id: "net-pay-fs30-voluntary-excluded",
  kind: "agency_guidance",
  cite: "U.S. DOL, Wage and Hour Division, Fact Sheet #30 (Dec. 2024)",
  quote:
    "Deductions not required by law - such as those for voluntary wage assignments, union dues, health and life insurance, contributions to charitable causes, purchases of savings bonds, retirement plan contributions (except those required by law) and payments to employers for payroll advances or purchases of merchandise - usually may not be subtracted from gross earnings when calculating disposable earnings under the CCPA.",
  soWhat:
    "Health insurance, retirement, dues, a payroll advance you are recovering - none of them reduce the base a garnishment is measured against, however automatic they look on the stub. They come out AFTER the garnishment, not before it. Subtract them first and you shrink the base, take too little for the order, and on a support order the shortfall can become YOUR liability rather than the employee's. This is the single most common garnishment error in payroll, and it is easy to make because the wrong answer looks completely ordinary.",
  source: FS30,
};

/* ------------------------------------------------------------------ *
 * THE TWO SENTENCES THAT MAKE A DEDUCTION LAWFUL IN WASHINGTON
 * ------------------------------------------------------------------ */

/**
 * Why an unauthorised deduction is refused rather than warned about.
 *
 * Note the phrase "any officer, vice principal or agent". This one reaches
 * Michael personally, not merely LYMAN'S MARIJUANA L.L.C.
 */
export const WAGE_REBATE_IS_A_CRIME: NetPayAuthority = {
  id: "net-pay-rcw-49-52-050-rebate",
  kind: "state_law",
  cite: "RCW 49.52.050(2)",
  // RULE 24, AND A CATCH WORTH RECORDING. The first draft of this record
  // stitched the lead-in "Any employer or officer, vice principal or agent ...
  // who" directly onto subsection (2) and then onto "Shall be guilty of a
  // misdemeanor", with ellipses. Every word appeared in the statute and the
  // resulting sentence exists nowhere in Washington law - subsections (1) and
  // (3) through (5) sit between the pieces. Quoting the whole section is both
  // honest and more useful, because (4) turns out to matter here too: failing
  // to record a deduction openly in the books is its own offence, which is
  // exactly what an undocumented voluntary deduction would be.
  quote:
    "Any employer or officer, vice principal or agent of any employer, whether said employer be in private business or an elected public official, who (1) Shall collect or receive from any employee a rebate of any part of wages theretofore paid by such employer to such employee; or (2) Wilfully and with intent to deprive the employee of any part of his or her wages, shall pay any employee a lower wage than the wage such employer is obligated to pay such employee by any statute, ordinance, or contract; or (3) Shall wilfully make or cause another to make any false entry in any employer's books or records purporting to show the payment of more wages to an employee than such employee received; or (4) Being an employer or a person charged with the duty of keeping any employer's books or records shall wilfully fail or cause another to fail to show openly and clearly in due course in such employer's books and records any rebate of or deduction from any employee's wages; or (5) Shall wilfully receive or accept from any employee any false receipt for wages; Shall be guilty of a misdemeanor.",
  soWhat:
    "Taking money out of somebody's cheque that you were not entitled to take is not a bookkeeping error in this state, it is a misdemeanor - and the statute names officers and agents, so it reaches you personally and not just the LLC. That is why the engine REFUSES a deduction with no written authorisation instead of taking it and flagging it. A refusal costs you five minutes. The alternative is a wage claim, doubled damages, and your name on it.",
  source: RCW4952_050,
};

/**
 * The only two exits. Both are narrow, and one of them is about TIMING.
 */
export const THE_ONLY_LAWFUL_DEDUCTIONS: NetPayAuthority = {
  id: "net-pay-rcw-49-52-060-authorized",
  kind: "state_law",
  cite: "RCW 49.52.060",
  quote:
    "The provisions of RCW 49.52.050 shall not make it unlawful for an employer to withhold or divert any portion of an employee's wages when required or empowered so to do by state or federal law or when a deduction has been expressly authorized in writing in advance by the employee for a lawful purpose accruing to the benefit of such employee nor shall the provisions of RCW 49.52.050 make it unlawful for an employer to withhold deductions for medical, surgical, or hospital care or service, pursuant to any rule or regulation: PROVIDED, That the employer derives no financial benefit from such deduction and the same is openly, clearly and in due course recorded in the employer's books.",
  soWhat:
    "Two main exits and no third one. Either the law makes you withhold it, or the employee signed for it IN WRITING, IN ADVANCE, for something that actually benefits them. 'In advance' is the part that catches people: taking the deduction this Friday and collecting the signature next week does not satisfy this, because the authorisation has to exist before the money moves. That is why a deduction without paperwork stops the cheque here rather than generating a note somebody reads later. There is a narrow extra allowance for medical, surgical and hospital deductions, and note the two conditions riding on it - you must derive NO financial benefit from the deduction, and it has to be recorded openly in the books. A health premium you quietly mark up is outside this exit entirely.",
  source: RCW4952_060,
};

/* ------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------ */

export const NET_PAY_AUTHORITIES: readonly NetPayAuthority[] = [
  DISPOSABLE_EARNINGS_BASE,
  LNI_IS_REQUIRED_BY_LAW,
  WHAT_COUNTS_AS_REQUIRED,
  VOLUNTARY_DOES_NOT_REDUCE_THE_BASE,
  WAGE_REBATE_IS_A_CRIME,
  THE_ONLY_LAWFUL_DEDUCTIONS,
];
