/**
 * src/lib/payroll/payroll-onboarding-authorities.ts   (books-25)
 *
 * THE PAPERWORK AUTHORITIES: WHAT A NEW HIRE MUST FILL OUT, WHEN, AND WHAT
 * HAPPENS WHEN THEY DO NOT.
 *
 * Michael, recorded verbatim (standing rule 24):
 *
 *   "Every time I hire someone new, they ask me how to fill out their w-4 and
 *    I never know what to say because I have no idea how any of it works
 *    myself. My grandpa does though... the whole purpose of this system is to
 *    replace my grandfather with a like kind solution that both protects me
 *    and teaches me."
 *
 *   "I want to be able to see and understand the various tax formulas used so
 *    it can teach me what exactly is going on... this is a perfect opportunity
 *    to surface more authoritative data about what is happening."
 *
 * WHY THIS FILE IS SEPARATE FROM payroll-tax-authorities.ts
 * That file answers "how much tax comes out of this paycheck." This one
 * answers "is this person's paperwork actually valid, and what am I required
 * to keep." They are different questions asked at different moments by
 * different screens, and mixing them would mean the hiring screen citing
 * thirty-six wage-base and penalty records that have nothing to do with it.
 *
 * WHAT IS DELIBERATELY *NOT* HERE (standing rule 2 — no second copy):
 *   - The no-W-4 default as the IRS DESCRIBES it lives in payroll-tax-
 *     authorities as `pub15t-2026-no-w4-default`. What is added here is the
 *     REGULATION that default comes from. A Publication is persuasive; a
 *     Treasury regulation is binding. They agree, they are not duplicates, and
 *     the mentor layer cites both on purpose so Michael can see that the IRS
 *     booklet and the actual rule say the same thing.
 *   - "Exempt means income tax only" is `pub15t-2026-exempt-scope`. Not
 *     re-declared.
 *
 * SOURCE DISCIPLINE (standing rules 24 and 35)
 * Every quote below is an exact substring of a primary source mirrored on disk
 * under `docs/authorities/`, and `scripts/verify-verbatim-quotes.ts` proves it
 * by machine on every run. Those mirrors are produced by
 * `scripts/fetch-federal-authority-text.ts`, which was extended by this slice
 * to reach title 8 and title 26 part 31 — before that it could only fetch
 * title 26 part 1, so these two regulations could not have been verified at
 * all. A quote nobody can check is a quote rule 24 does not actually protect.
 *
 * These are EDICTS OF GOVERNMENT — works of the United States and of the State
 * of Washington, not subject to copyright (17 U.S.C. §105; Banks v.
 * Manchester, 128 U.S. 244 (1888); Georgia v. Public.Resource.Org, 590 U.S.
 * 255 (2020)). Unlike the FASB material in this repository there is no
 * licensing reason not to mirror them in full.
 *
 * PURE DATA. No I/O, no clock, no randomness, no server-only imports.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) FORM I-9 — 8 C.F.R. §274a.2
//
// The I-9 is not a tax form and it is not optional. It is an immigration
// document with its own deadline, its own retention clock, and its own
// evidence rules, and it is enforced by a different agency than everything
// else in this system. That is why it gets its own section, its own table, and
// — see I9_LIMITATION_ON_USE below — its own legal quarantine.
// ---------------------------------------------------------------------------

/**
 * WHEN SECTION 1 IS DUE: the employee's half, at the time of hire.
 *
 * Note the asymmetry that trips employers up. Section 1 is the EMPLOYEE's and
 * is due at hire. Section 2 is the EMPLOYER's and gets three business days.
 * They are two different deadlines on one piece of paper, and missing either
 * is its own violation.
 */
export const I9_SECTION_1_AT_TIME_OF_HIRE: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(1)(i)(A)",
  quote:
    "Completes section 1—“Employee Information and Verification”—on the Form I-9 at the time of " +
    "hire and signs the attestation with a handwritten or electronic signature in accordance with " +
    "paragraph (h) of this section",
  soWhat:
    "The employee fills out their half on day one — not at the end of the first week, not when you " +
    "get around to it. 'At the time of hire' means the day they start work for pay. This system " +
    "records the date they signed it, because that date is the thing an inspector compares against " +
    "their first day, and a blank in that field is the difference between a clean file and a fine.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * ⭐ THE THREE-BUSINESS-DAY CLOCK. This is the deadline Michael is most likely
 * to miss, because it runs against HIM rather than against the employee, and
 * nothing in the world reminds him it is running.
 *
 * Quoted in two segments because paragraph (A) — the physical examination
 * requirement — sits between the deadline and the section 2 signature. Both
 * halves matter: you must LOOK at the documents and you must SIGN, both within
 * the same three days.
 */
export const I9_SECTION_2_THREE_BUSINESS_DAYS: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(1)(ii)",
  quote:
    "Except as provided in paragraph (b)(1)(viii) of this section, an employer, his or her agent, " +
    "or anyone acting directly or indirectly in the interest thereof, must within three business " +
    "days of the hire: ... Complete section 2—“Employer Review and Verification”—on the Form I-9 " +
    "within three business days of the hire and sign the attestation with a handwritten signature " +
    "or electronic signature in accordance with paragraph (i) of this section.",
  soWhat:
    "Three BUSINESS days, not three days — weekends and holidays do not count, which is the only " +
    "part of this rule that works in your favour. The clock starts on the first day the employee " +
    "works for pay. This system computes that date for you and refuses to call an employee ready " +
    "for payroll until section 2 is signed, because the alternative is what happens today: the " +
    "deadline passes silently and you find out about it during an inspection.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * ONLY UNEXPIRED DOCUMENTS. A short sentence with an outsized consequence: an
 * expired driver's licence or passport is not "close enough", it is not a
 * document at all for this purpose.
 */
export const I9_ONLY_UNEXPIRED_DOCUMENTS: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-1-v-only-unexpired-documents",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(1)(v)",
  quote:
    "The individual may present either an original document which establishes both employment " +
    "authorization and identity, or an original document which establishes employment " +
    "authorization and a separate original document which establishes identity. Only unexpired " +
    "documents are acceptable. The identification number and expiration date (if any) of all " +
    "documents must be noted in the appropriate space provided on the Form I-9.",
  soWhat:
    "Two practical rules in one paragraph. First, it is either ONE document from the combined list " +
    "or TWO documents — one proving who they are and one proving they may work. Second, an expired " +
    "document is not acceptable, full stop. This system asks for each document's expiration date " +
    "and refuses a date already in the past, because 'expired last month' is exactly the kind of " +
    "thing a busy person waves through and cannot un-wave two years later.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * THE RETENTION CLOCK — and it is a formula, not a fixed number of years.
 *
 * "Three years after hire OR one year after termination, WHICHEVER IS LATER"
 * means a long-tenured employee's form is kept for one year past their exit,
 * while a two-week employee's form is kept for nearly three years past theirs.
 * Most people remember this as "three years" and throw away files they were
 * required to keep.
 */
export const I9_RETENTION_PERIOD: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-2-i-a-retention-period",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(2)(i)(A)",
  quote:
    "In the case of an employer, three years after the date of the hire or one year after the date " +
    "the individual's employment is terminated, whichever is later",
  soWhat:
    "This is a calculation, not a filing-cabinet habit, and it is the reason this system stores the " +
    "hire date and the termination date rather than a 'keep until' note somebody typed. Take three " +
    "years from the hire date, take one year from the termination date, and keep the form until the " +
    "LATER of the two. For someone who worked two weeks that is almost three years after they left. " +
    "Destroying a form early is its own violation, separate from anything on the form.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * ⭐ THE QUARANTINE CLAUSE. THIS RECORD IS THE REASON I-9 DATA LIVES IN ITS OWN
 * TABLE THAT THE PAYROLL ENGINE CANNOT READ.
 *
 * "May be used ONLY for enforcement of the Act" is a limitation on the
 * employer as much as on the government. I-9 information — including the
 * citizenship attestation and the document images — is not general HR data. It
 * is not available to the payroll calculation, it is not available to a
 * report, and it is not available to a manager browsing an employee record.
 *
 * A system that stores it in the same row as the pay rate has already made
 * that separation impossible to enforce. So this one does not.
 */
export const I9_LIMITATION_ON_USE: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-4-limitation-on-use",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(4)",
  quote:
    "Limitation on use of Form I-9. Any information contained in or appended to the Form I-9, " +
    "including copies or electronic images of documents listed in paragraph (c) of this section " +
    "used to verify an individual's identity or employment eligibility, may be used only for " +
    "enforcement of the Act and sections 1001, 1028, 1546, or 1621 of title 18, United States Code.",
  soWhat:
    "Read 'only' literally, because it is meant literally. What an employee wrote on their I-9 — " +
    "their citizenship status, their document numbers — may be used for immigration enforcement and " +
    "for prosecuting fraud, and for nothing else. Not for scheduling, not for a report, not for " +
    "deciding anything about their job. This system enforces that with structure rather than with " +
    "good intentions: the I-9 record is a separate table, the payroll engine never reads it, and no " +
    "report joins to it. A promise not to look is not a control. Not being able to look is.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * REVERIFICATION. The one deadline that arrives YEARS after the hire, which is
 * precisely why it needs to be computed and stored rather than remembered.
 *
 * Note the last clause: if you let it lapse, the person "may no longer be
 * employed." There is no grace period written into this sentence.
 */
export const I9_REVERIFICATION_BEFORE_EXPIRY: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-1-vii-reverification",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(1)(vii)",
  quote:
    "If an individual's employment authorization expires, the employer, recruiter or referrer for a " +
    "fee must reverify on the Form I-9 to reflect that the individual is still authorized to work " +
    "in the United States; otherwise, the individual may no longer be employed, recruited, or " +
    "referred. Reverification on the Form I-9 must occur not later than the date work authorization " +
    "expires and must comply with the applicable document presentation and examination procedures " +
    "in paragraphs (b)(1)(ii)(A) and (b)(1)(ix) of this section, and form instructions.",
  soWhat:
    "If an employee's work authorization has an expiration date, that date is a deadline for YOU. " +
    "Miss it and the rule does not say 'fix it soon' — it says they may no longer be employed. This " +
    "is the single easiest compliance failure to walk into, because the deadline can be three years " +
    "out and there is nothing in a normal day that raises it. That is why this system stores the " +
    "expiration date as data and puts the reverification date on a schedule, instead of trusting " +
    "anyone to remember something three years from now.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

/**
 * ⭐ THE TRAP THAT PUNISHES BEING HELPFUL. An employer who asks for "a
 * passport" — or who decides to photocopy documents for some employees and not
 * others — can commit a DIFFERENT violation, under section 274B, while trying
 * to comply with this one.
 *
 * The employee chooses which acceptable documents to present. Not the
 * employer. This system therefore records what WAS presented; it never
 * prompts for a specific document.
 */
export const I9_COPYING_MUST_NOT_BE_SELECTIVE: GuidanceAuthority = {
  id: "cfr-8-274a-2-b-3-copying-not-selective",
  kind: "regulation",
  cite: "8 C.F.R. §274a.2(b)(3)",
  quote:
    "An employer, or a recruiter or referrer for a fee may, but is not required to, copy or make an " +
    "electronic image of a document presented by an individual solely for the purpose of complying " +
    "with the verification requirements of this section. ... An employer, recruiter or referrer for " +
    "a fee should not, however, copy or electronically image only the documents of individuals of " +
    "certain national origins or citizenship statuses. To do so may violate section 274B of the Act.",
  soWhat:
    "Copying documents is OPTIONAL — but if you do it, you must do it for everyone or for no one. " +
    "Copying only some people's documents is a discrimination violation under a different section " +
    "of the law, enforced by a different office, with its own penalties. The same trap applies to " +
    "asking for a particular document: the employee picks which acceptable documents to show you, " +
    "and asking for 'a green card' or 'a passport' specifically is itself the violation. This " +
    "system never asks for a named document — it records what the employee chose to present.",
  source: "https://www.ecfr.gov/current/title-8/section-274a.2",
};

// ---------------------------------------------------------------------------
// 2) FORM W-4 — 26 C.F.R. §31.3402(f)(2)-1
//
// The BINDING rule behind the W-4. IRS Pub. 15-T explains the arithmetic and
// is already registered in payroll-tax-authorities; a Publication is the IRS's
// own summary and cannot be relied on as authority against the IRS. These are
// the Treasury regulations themselves, which can.
// ---------------------------------------------------------------------------

/**
 * WHEN THE W-4 IS DUE: on or before the first day. Same day as I-9 section 1,
 * which is why this system collects them in one sitting.
 */
export const W4_FURNISH_ON_COMMENCEMENT: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-a-1-furnish-on-commencement",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(a)(1)",
  quote:
    "On or before the date on which an individual commences employment with an employer, the " +
    "individual must furnish the employer with a signed withholding allowance certificate",
  soWhat:
    "The W-4 is due on or before the first day of work — the same day as the employee's half of the " +
    "I-9. That is not a coincidence this system exploits; it is why the setup flow gathers both at " +
    "once. Note the word SIGNED. An unsigned W-4 is not a late W-4, it is not a W-4 at all, and the " +
    "no-certificate rule below is what applies instead.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

/**
 * ⭐ WHAT TO DO WHEN THEY NEVER HAND ONE IN. The regulation behind the default
 * that `defaultW4WhenNoneFurnished()` already implements in payroll-w4-core.
 *
 * This is registered SEPARATELY from `pub15t-2026-no-w4-default` on purpose.
 * The Publication describes the same outcome; this is the rule that creates
 * it. When the mentor layer shows Michael both, the point being made is that
 * the booklet and the law agree — which is exactly the check nobody performs.
 */
export const W4_NO_CERTIFICATE_DEFAULT: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-a-4-no-certificate-default",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(a)(4)",
  quote:
    "If an employee has no valid withholding allowance certificate in effect with the employer at " +
    "the time of the payment of the wages, and fails to furnish a valid withholding allowance " +
    "certificate to the employer, the employee will be treated as single but having the withholding " +
    "allowance provided in forms, instructions, publications, and other guidance prescribed by the " +
    "Commissioner.",
  soWhat:
    "No W-4 does not mean no withholding, and it does not mean you get to guess. The law picks for " +
    "them: single, with nothing else claimed, which is close to the highest withholding there is. " +
    "Two things follow. You are never stuck — there is always a correct answer, so a missing W-4 can " +
    "never stop a payroll. And the employee is the one who pays for it in a smaller cheque, so this " +
    "system shows them the difference in dollars rather than applying the default quietly.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

/**
 * ⭐ WHAT MAKES A W-4 INVALID. Read this one twice — it is the record that
 * turns "the form looks a bit odd" into a legal conclusion with a required
 * response.
 *
 * "Any alteration" includes the helpful kind. An employee who crosses out a
 * line, or who writes "I want exactly $200 withheld" in the margin, has just
 * invalidated the certificate.
 */
export const W4_ALTERATION_MAKES_INVALID: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-f-3-i-alteration-invalid",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(f)(3)(i)",
  quote:
    "Any alteration of or unauthorized addition to a withholding allowance certificate causes such " +
    "certificate to be invalid",
  soWhat:
    "Crossing something out, adding a note in the margin, writing in a figure the form does not ask " +
    "for — any of these makes the whole certificate invalid, not just the altered line. The same " +
    "paragraph adds that a form the employee TELLS you is false is also invalid, even if they only " +
    "say it out loud. This matters to Michael specifically: an employee who says 'just take out an " +
    "extra hundred, don't worry about the form' has handed him an invalid certificate, and the next " +
    "record says exactly what he must then do about it.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

/**
 * WHAT AN EMPLOYER MUST DO WITH AN INVALID FORM. Three obligations in one
 * paragraph, and the first one is counter-intuitive: DISREGARD it. Not "use it
 * cautiously", not "use the parts that look fine."
 */
export const W4_EMPLOYER_MUST_DISREGARD_INVALID: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-f-3-ii-employer-disregards-invalid",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(f)(3)(ii)",
  quote:
    "If an employer receives an invalid withholding allowance certificate, the employer must " +
    "disregard it for purposes of computing withholding. The employer must inform the employee who " +
    "furnished the certificate that it is invalid and must request another withholding allowance " +
    "certificate from the employee.",
  soWhat:
    "Three duties, and they are not optional. Ignore the invalid form completely. Tell the employee " +
    "it is invalid. Ask for a new one. What you must NOT do is fix it yourself, or use the parts " +
    "that look reasonable — this is the regulation behind the refusal in this system that will not " +
    "let you edit an employee's W-4 on their behalf. If they never replace it, you fall back to the " +
    "single default, unless an older valid W-4 is still on file, in which case that older one keeps " +
    "governing. This system keeps prior certificates for exactly that reason.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

/**
 * THE SSN RULE, AND THE REASON THIS SYSTEM DOES NOT NEED TO STORE THE NUMBER.
 *
 * The regulation requires the SSN to be ON THE CERTIFICATE — the piece of
 * paper the employee signs and Michael keeps. It does not require the number
 * to be copied into a payroll database, and no calculation in this system
 * consumes it. Storing it anyway would add breach liability and buy nothing.
 */
export const W4_SSN_REQUIRED_NO_TRUNCATION: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-f-2-ssn-no-truncation",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(f)(2)",
  quote:
    "Every individual to whom a social security number has been assigned must include such number " +
    "on any withholding allowance certificate furnished to an employer. An employee may not use a " +
    "truncated social security number",
  soWhat:
    "The full number must appear on the signed form — an employee who writes 'XXX-XX-1234' has not " +
    "furnished a valid certificate. Note carefully what the rule governs: the CERTIFICATE. It says " +
    "nothing about what a payroll system stores. Nothing in this system's arithmetic uses the SSN, " +
    "so holding all nine digits would create a breach to report and buy no capability whatsoever. " +
    "The signed form is the record; this system records that the number is present on it.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

/**
 * WHEN AN EXISTING EMPLOYEE MUST HAND IN A NEW ONE. Ten days, and only in the
 * direction that INCREASES withholding — an employee whose circumstances would
 * lower their withholding may file a new W-4 but is not required to.
 */
export const W4_CHANGE_OF_STATUS_TEN_DAYS: GuidanceAuthority = {
  id: "cfr-31-3402-f-2-1-b-1-change-of-status-ten-days",
  kind: "regulation",
  cite: "26 C.F.R. §31.3402(f)(2)-1(b)(1)",
  quote:
    "If, on any day during the calendar year, the employee experiences a change of status that " +
    "reduces the employee's withholding allowance or withholding allowances, in the manner described " +
    "in paragraph (b)(2) of this section, the employee must, within 10 days after the change occurs, " +
    "furnish the employer with a new withholding allowance certificate claiming the withholding " +
    "allowance to which the employee is entitled under \u00a7 31.3402(f)(1)-1(b), unless paragraph " +
    "(b)(3) of this section applies to the employee.",
  soWhat:
    "A W-4 is not filed once and forgotten. If something changes that should INCREASE an employee's " +
    "withholding — a divorce, a child who no longer qualifies, a second job in the household — they " +
    "have ten days to hand you a new one. The obligation runs one way only: a change that would " +
    "lower their withholding lets them file a new form but never forces them to. This is the " +
    "employee's duty, not yours, and you are not required to police it — but you are required to " +
    "act on the new form once it arrives, which is why this system keeps W-4s as a dated history " +
    "rather than overwriting one row.",
  source: "https://www.ecfr.gov/current/title-26/section-31.3402(f)(2)-1",
};

// ---------------------------------------------------------------------------
// 3) WASHINGTON NEW-HIRE REPORTING — RCW 26.23.040
//
// The obligation almost nobody outside payroll knows exists. It is not a tax,
// it has nothing to do with wages, and it is enforced by the Division of Child
// Support. It has a twenty-day fuse and a per-employee monthly penalty.
// ---------------------------------------------------------------------------

/**
 * ⭐ THE TWENTY-DAY REPORT. A third deadline, from a third agency, on the same
 * hire — after the I-9's three business days and alongside the W-4.
 */
export const RCW_26_23_040_TWENTY_DAY_REPORT: GuidanceAuthority = {
  id: "rcw-26-23-040-twenty-day-new-hire-report",
  kind: "state_law",
  cite: "RCW 26.23.040(3)",
  quote:
    "Employers shall submit reports within twenty days of the hiring, rehiring, or return to work " +
    "of the employee, except as provided in subsection (4) of this section. The report shall " +
    "contain: (a) The employee's name, address, social security number, and date of birth; and (b) " +
    "The employer's name, address, and identifying number assigned under section 6109 of the " +
    "internal revenue code of 1986.",
  soWhat:
    "Every new hire must be reported to the Washington State Support Registry within twenty days. " +
    "This is not a tax filing and it is not optional, and it also catches REHIRES — someone coming " +
    "back after sixty days away counts as a new hire all over again. The required contents are " +
    "exactly the fields already on the W-4 plus a date of birth, which is why this system asks for " +
    "the date of birth during setup: not because withholding needs it, but because this report does.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=26.23.040",
};

/**
 * WHY THE W-4 AND THIS REPORT BELONG IN ONE FLOW — the statute itself says the
 * W-4 is the reporting instrument.
 */
export const RCW_26_23_040_REPORT_BY_W4: GuidanceAuthority = {
  id: "rcw-26-23-040-report-by-w4-form",
  kind: "state_law",
  cite: "RCW 26.23.040(2)",
  quote:
    "Employers shall report to the extent practicable by W-4 form, or, at the option of the " +
    "employer, an equivalent form, and may mail the form by first-class mail, or may transmit it " +
    "electronically, or by other means authorized by the registry which will result in timely " +
    "reporting.",
  soWhat:
    "Washington names the W-4 as the reporting instrument. That is the legal reason these two tasks " +
    "sit in one flow in this system rather than on two screens a month apart: the same form that " +
    "sets an employee's withholding is the form the state wants for its registry. Collect it once, " +
    "use it twice, and the twenty-day deadline stops being a separate thing to remember.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=26.23.040",
};

/**
 * WHAT IT COSTS TO SKIP IT. Small per employee, but it is charged PER MONTH,
 * and the second limb is the one to read carefully — agreeing with an employee
 * not to report them is a five-hundred-dollar item, not a favour.
 */
export const RCW_26_23_040_PENALTY: GuidanceAuthority = {
  id: "rcw-26-23-040-failure-to-report-penalty",
  kind: "state_law",
  cite: "RCW 26.23.040(5)",
  quote:
    "An employer who fails to report as required under this section shall be subject to a civil " +
    "penalty of: (a) Twenty-five dollars per month per employee; or (b) Five hundred dollars, if " +
    "the failure to report is the result of a conspiracy between the employer and the employee not " +
    "to supply the required report, or to supply a false report.",
  soWhat:
    "Twenty-five dollars a month per employee is small enough to ignore and that is the danger — it " +
    "accrues monthly, per person, and nobody sends a reminder. The second limb is the serious one: " +
    "if an employee asks you not to report them and you agree, the penalty becomes five hundred " +
    "dollars and the statute calls it a conspiracy. The usual reason for such a request is a child " +
    "support order the employee is avoiding, which is precisely what this registry exists to find.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=26.23.040",
};

// ---------------------------------------------------------------------------
// 4) THE REGISTRY
// ---------------------------------------------------------------------------

/**
 * Every hiring-paperwork authority, ordered the way the setup flow encounters
 * them: the I-9 first (it has the tightest deadline), then the W-4, then the
 * state report that the W-4 feeds.
 *
 * WIRING NOTE — READ BEFORE ADDING A RECORD. Exporting this array is not
 * enough to make these citations reachable. It must also be spread into
 * `taggedCandidates()` in books-guidance-core.ts under a tag listed in
 * `ALL_SOURCE_REGISTRIES`. PAYROLL_TAX_AUTHORITIES sat exported and unimported
 * for an entire slice, which made thirty-six authorities invisible to
 * `findGuidanceAuthority()` while looking completely fine in this file. This
 * slice's tests assert the wiring rather than trusting it.
 */
export const PAYROLL_ONBOARDING_AUTHORITIES: readonly GuidanceAuthority[] = [
  // Form I-9 — 8 C.F.R. §274a.2
  I9_SECTION_1_AT_TIME_OF_HIRE,
  I9_SECTION_2_THREE_BUSINESS_DAYS,
  I9_ONLY_UNEXPIRED_DOCUMENTS,
  I9_REVERIFICATION_BEFORE_EXPIRY,
  I9_RETENTION_PERIOD,
  I9_LIMITATION_ON_USE,
  I9_COPYING_MUST_NOT_BE_SELECTIVE,
  // Form W-4 — 26 C.F.R. §31.3402(f)(2)-1
  W4_FURNISH_ON_COMMENCEMENT,
  W4_NO_CERTIFICATE_DEFAULT,
  W4_ALTERATION_MAKES_INVALID,
  W4_EMPLOYER_MUST_DISREGARD_INVALID,
  W4_SSN_REQUIRED_NO_TRUNCATION,
  W4_CHANGE_OF_STATUS_TEN_DAYS,
  // Washington new-hire reporting — RCW 26.23.040
  RCW_26_23_040_TWENTY_DAY_REPORT,
  RCW_26_23_040_REPORT_BY_W4,
  RCW_26_23_040_PENALTY,
] as const;

/** Look up one authority introduced by this slice. Undefined, never a throw. */
export function findPayrollOnboardingAuthority(id: string): GuidanceAuthority | undefined {
  return PAYROLL_ONBOARDING_AUTHORITIES.find((a) => a.id === id);
}
