/**
 * src/lib/payroll/form-940-authorities.ts   (books-43)
 *
 * THE LAW BEHIND THE ANNUAL FEDERAL UNEMPLOYMENT RETURN, WORD FOR WORD.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, AND WHY FORM 940 IS THE MOST MISUNDERSTOOD FORM YOU FILE
 * ───────────────────────────────────────────────────────────────────────────
 * Form 940 looks trivial. It is one page, the tax is "0.6%", and for a business
 * of Greenway's size the cheque is usually a few hundred dollars. That is
 * exactly why it goes wrong: nobody gives it any attention, and it contains a
 * piece of arithmetic that is genuinely counter-intuitive.
 *
 * The statutory FUTA rate is SIX PERCENT (26 U.S.C. §3301). Almost nobody pays
 * six percent. You get a credit of up to 5.4% for the state unemployment tax
 * you paid — which is why the number in everyone's head is 0.6%. But that
 * credit is CONDITIONAL. It is conditional on having actually paid the state,
 * and on having paid it on time. Miss the deadline and §3302(a)(3) cuts the
 * credit for those late contributions to 90% of what it would have been.
 *
 * So the same wage base can produce a small federal tax or a much larger one
 * depending on a fact that has nothing to do with the federal government:
 * whether the Washington ESD payment cleared. That is the single most important
 * thing to understand about this form, and it is the reason the engine
 * downstream refuses to compute a number until it is told whether the state tax
 * was actually paid, and how much of it was paid late.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A CORRECTION MADE DURING THIS SLICE, RECORDED RATHER THAN QUIETLY FIXED
 * ───────────────────────────────────────────────────────────────────────────
 * The first draft of this file contained the sentence:
 *
 *     "You're entitled to the maximum credit if you paid all state
 *      unemployment tax by the due date."
 *
 * That is NOT what the instructions say, and the difference is not cosmetic.
 * The actual sentence ends "...by the due date of your Form 940 or if you
 * weren't required to pay state unemployment tax during the calendar year due
 * to your state experience rate." Truncating it invented a deadline.
 *
 * The real deadline for earning the credit is the due date of FORM 940 — the
 * following 31 January — not the state's own quarterly due date. A Q1 ESD
 * payment made two months late in, say, August is still "on time" for FUTA
 * credit purposes, because it landed before the Form 940 due date. It will
 * attract Washington's own late penalties and interest under RCW 50.12.220 and
 * RCW 50.24.040, but it does NOT cost Michael the federal credit. The truncated
 * version would have told him he had lost a credit he had not lost, and would
 * have made the engine overstate his federal tax.
 *
 * It was caught by `scripts`-level verification comparing each quote back to
 * the mirrored source file, which is precisely the check that exists because
 * memory is not a source. See `tests/compliance/form-940-authorities.test.ts`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* IN THIS FILE (standing rule 25)
 * ───────────────────────────────────────────────────────────────────────────
 * The FUTA rate, the $7,000 wage base, the 5.4% maximum credit, the 90% late
 * factor and the $1,500 quarterly employer test are ALREADY declared as
 * constants in `payroll-withholding-core.ts`, and `IRC_3301_FUTA_RATE`,
 * `IRC_3306_FUTA_WAGE_BASE` and `IRC_3302_FUTA_CREDIT` already exist in
 * `payroll-tax-authorities.ts`. Not one of them is redeclared here. This file
 * quotes only what that registry does not carry: the INSTRUCTIONS — who files,
 * when, the deposit carry-forward, the line-by-line arithmetic, and the
 * Worksheet—Line 10 that actually computes the credit.
 *
 * `form940Authorities()` returns both sets together so a reader gets the whole
 * picture from one call without the same paragraph living in two places.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TRANSCRIPTION NOTE (standing rule 24: the quote is sacred)
 * ───────────────────────────────────────────────────────────────────────────
 * Every `quote` below was extracted MECHANICALLY from the mirrored authority at
 * `docs/authorities/federal/irs-instructions-940-2025.txt`, whose source PDF
 * (`i940.pdf`, sha256 prefix `e2085d60827d25e8`) is recorded in
 * `docs/authorities/MANIFEST.tsv`. Nothing was retyped from memory.
 *
 * Two — and only two — transformations were applied:
 *
 *   1. The PDF wraps lines mid-sentence, so newlines are closed to single
 *      spaces. No word is added, removed or reordered.
 *   2. Curly apostrophes and curly double quotes are written as their ASCII
 *      equivalents, to match the rest of this codebase. Dashes are left exactly
 *      as printed, because an en dash in "line 1 – line 4" is arithmetic.
 *
 * Where a quote skips over intervening material — a bullet glyph, a page
 * header such as "Instructions for Form 940 (2025) 5" that the PDF drops into
 * the middle of a sentence, or an irrelevant clause — the omission is marked
 * with " ... ", the same elision convention already used in
 * `payroll-tax-authorities.ts`. The test splits every quote on that marker and
 * proves each remaining fragment still appears character-for-character in the
 * mirrored file, so an elision can hide a page number but cannot hide a word of
 * law.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A YEAR MISMATCH THAT IS BEING SURFACED, NOT HIDDEN
 * ───────────────────────────────────────────────────────────────────────────
 * The mirrored instructions are the **2025** revision. Greenway's first payroll
 * is **1 January 2027**, so the first Form 940 Michael actually files will be
 * the 2027 revision, filed in early 2028. The structural law quoted here —
 * §3301, §3302, the $7,000 base, the deposit threshold, the worksheet — has
 * been stable for decades. The things that DO change annually are the list of
 * credit reduction states and the exact due date. Both are treated by the
 * engine as INPUTS that must be supplied, never as constants baked into code.
 * `FORM_940_SOURCE_YEAR` below is exported so the screen can tell Michael which
 * revision he is reading, rather than letting him assume it is current.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";

/**
 * The revision year of the mirrored instructions these quotes came from.
 *
 * Exported rather than hard-coded into prose so that the screen, the mentor and
 * the tests all read the same number, and so that re-mirroring a newer revision
 * is a one-line change that the tests immediately check.
 */
export const FORM_940_SOURCE_YEAR = 2025;

/** Where the quotes came from. Re-read by the test that verifies each fragment. */
export const FORM_940_SOURCE_PATH =
  "docs/authorities/federal/irs-instructions-940-2025.txt";

/**
 * The marker used inside a `quote` to show that intervening text was skipped.
 * Exported so the verification test and this module cannot drift apart on what
 * an elision looks like.
 */
export const FORM_940_ELISION = " ... ";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHO MUST FILE, AND THE TWO TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TWO TESTS ARE "OR", NOT "AND" — and that catches people.
 *
 * Greenway will answer YES to the first question in its very first quarter: a
 * single fortnight of payroll for a handful of budtenders clears $1,500 easily.
 * But note the second test as well, because a business with ONE part-time
 * employee who works twenty separate weeks is liable even if total wages never
 * approach $1,500 in any quarter.
 *
 * Note also the lookback across TWO years ("during 2024 or 2025"). Liability is
 * sticky: once you cross the threshold, the following year is captured too,
 * even if that year is quiet.
 */
export const I940_WHO_MUST_FILE: GuidanceAuthority = {
  id: "i940-who-must-file",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Who Must File Form 940?",
  quote:
    "Except as noted below, if you answer \"Yes\" to either one of these questions, you must file " +
    "Form 940. ... Did you pay wages of $1,500 or more to employees in any calendar quarter during " +
    "2024 or 2025? ... Did you have one or more employees for at least some part of a day in any 20 " +
    "or more different weeks in 2024 or 20 or more different weeks in 2025? Count all full-time, " +
    "part-time, and temporary employees. However, if your business is a partnership, don't count " +
    "its partners.",
  soWhat:
    "You file a 940 if you paid $1,500 in wages in ANY single quarter, or if you had any employee " +
    "for any part of a day in 20 different weeks. It is either/or, not both, and it looks back over " +
    "two years. Greenway crosses the first test in its first fortnight of payroll.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE ZERO RETURN. A year with no payroll is still a year with a form, if you
 * were liable in the lookback. You check box c rather than skipping the filing.
 * This is the FUTA twin of the 941 rule that a quiet quarter is still a return.
 */
export const I940_NO_PAYMENTS_STILL_FILE: GuidanceAuthority = {
  id: "i940-no-payments-still-file",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Who Must File Form 940?",
  quote:
    "If you're not liable for FUTA tax for 2025 because you made no payments to employees in 2025, " +
    "check box c in the top right corner of the form. Then, go to Part 7, sign the form, and file " +
    "it with the IRS.",
  soWhat:
    "No payroll all year does not mean no form. You still file, and you tick box c to say why. " +
    "Silence is not a filing, and the IRS cannot tell the difference between a dormant business " +
    "and a delinquent one unless you tell it.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE HEADLINE RATE, AND THE CONDITION HIDING UNDERNEATH IT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE HEADLINE RATE AND THE REAL RATE, IN THE IRS'S OWN WORDS.
 *
 * Note the word "Most" in "Most employers receive a maximum credit". The IRS
 * does not say "employers receive". It says most do. The whole design of this
 * engine is about finding out whether Michael is in the "most" or not.
 *
 * The elision here skips the string "Instructions for Form 940 (2025) 5", which
 * is a PAGE HEADER the PDF drops into the middle of the sentence between the
 * words "maximum" and "credit". Nothing of substance is omitted.
 */
export const I940_RATE_AND_CREDIT: GuidanceAuthority = {
  id: "i940-rate-and-credit",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), How Do You Figure Your FUTA Tax Liability for Each Quarter?",
  quote:
    "You owe FUTA tax on the first $7,000 you pay to each employee during the calendar year after " +
    "subtracting any payments exempt from FUTA tax. The FUTA tax is 6.0% (0.060) for 2025. Most " +
    "employers receive a maximum ... credit of up to 5.4% (0.054) against this FUTA tax. Every " +
    "quarter, you must figure how much of the first $7,000 of each employee's annual wages you paid " +
    "during that quarter.",
  soWhat:
    "The law's rate is 6%. The rate most employers actually pay is 0.6%, because a 5.4% credit is " +
    "subtracted for the state unemployment tax they paid. The credit is the whole story: the " +
    "federal tax is small only because the state tax was paid.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE CONDITION ON THE CREDIT — QUOTED IN FULL, BECAUSE THE TAIL IS THE POINT.
 *
 * This is the sentence the first draft of this file truncated. Read the ending:
 * "by the due date of your Form 940". Not the state's due date. Form 940's due
 * date, the following 31 January.
 *
 * That has a consequence worth stating plainly, because it is the opposite of
 * what most people assume: paying Washington ESD late does NOT automatically
 * cost you the federal credit. If the late ESD payment still clears before the
 * Form 940 due date, it counts as paid "on time" for FUTA purposes. Michael
 * will owe Washington penalties and interest for being late to Washington — but
 * the IRS credit survives.
 *
 * There is a second escape hatch in the tail as well: an employer who "weren't
 * required to pay state unemployment tax during the calendar year due to your
 * state experience rate" — that is, an experience rate of 0% — still gets the
 * maximum credit. See also `I940_LINE_9_ALL_EXCLUDED`, which cautions that this
 * is NOT the same thing as having wages excluded from state unemployment tax.
 */
export const I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT: GuidanceAuthority = {
  id: "i940-credit-requires-timely-state-payment",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Figure Your Tax Liability",
  quote:
    "The tax rates are based on your receiving the maximum credit against FUTA taxes. You're " +
    "entitled to the maximum credit if you paid all state unemployment tax by the due date of your " +
    "Form 940 or if you weren't required to pay state unemployment tax during the calendar year due " +
    "to your state experience rate.",
  soWhat:
    "The 0.6% rate assumes you paid Washington ESD, and paid it before your Form 940 was due — the " +
    "following 31 January, NOT the state's own quarterly deadline. So a state payment that was late " +
    "to Washington but still landed before 31 January costs you Washington penalties and interest, " +
    "and costs you nothing federally. Only tax still unpaid, or paid after the Form 940 due date, " +
    "damages the federal credit.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE DEFINITIONS THE WORKSHEET RUNS ON. Two words, "on time" and "late", each
 * given an explicit meaning by the instructions, and both anchored to the Form
 * 940 due date rather than to any state deadline.
 *
 * The caution attached below matters for Washington specifically: Michael pays
 * ESD an amount that includes an employee-withheld share for PFML and WA Cares,
 * plus penalties and interest if he was late. NONE of that goes on this
 * worksheet. Only the employer's own state unemployment contribution counts.
 * Putting the whole ESD cheque on line 2 would overstate the credit.
 */
export const I940_ON_TIME_AND_LATE_DEFINED: GuidanceAuthority = {
  id: "i940-on-time-and-late-defined",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 10 instructions",
  quote:
    "The amount of state unemployment taxes you paid on time. \"On time\" means that you paid the " +
    "state unemployment taxes by the due date for filing Form 940. ... The amount of state " +
    "unemployment taxes you paid late. \"Late\" means after the due date for filing Form 940. " +
    "Caution: Don't include any penalties, interest, or unemployment taxes deducted from your " +
    "employees' pay in the amount of state unemployment taxes.",
  soWhat:
    "\"On time\" and \"late\" are measured against the Form 940 due date, not against Washington's " +
    "quarterly due dates. And when you total up what you paid the state, strip out the penalties, " +
    "the interest, and anything withheld from your employees' own pay. Only your employer " +
    "unemployment contribution belongs in that figure.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE ARITHMETIC, LINE BY LINE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LINE 5, THE ONE PEOPLE INVERT. Line 5 is not the taxable wages. It is the
 * EXCESS over $7,000 per employee, which then gets subtracted out on line 7.
 * The form makes you compute what is NOT taxable and take it away, rather than
 * computing what IS taxable directly. Get the direction backwards and every
 * subsequent line is wrong.
 */
export const I940_LINE_5_WAGE_BASE: GuidanceAuthority = {
  id: "i940-line-5-wage-base",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), line 5 - Total of Payments Made to Each Employee in Excess of $7,000",
  quote:
    "Only the first $7,000 you paid to each employee in a calendar year, after subtracting any " +
    "payments exempt from FUTA tax, is subject to FUTA tax. This $7,000 is called the FUTA wage " +
    "base.",
  soWhat:
    "The $7,000 cap is per employee, per year — not per job and not per pay period. Line 5 asks for " +
    "the amount ABOVE the cap so the form can subtract it. It is the excess, not the taxable wages. " +
    "Reading it the other way round is the single most common way this form is filled in wrong.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 8. The form computes tax at 0.6% here, BEFORE any adjustment — that is,
 * it optimistically assumes the full 5.4% credit. Lines 9, 10 and 11 then claw
 * it back if the assumption was wrong. Understanding that ordering is what
 * makes the rest of the form legible: line 8 is a best case, not an answer.
 */
export const I940_LINE_8_BEFORE_ADJUSTMENTS: GuidanceAuthority = {
  id: "i940-line-8-before-adjustments",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 8 - FUTA Tax Before Adjustments",
  quote:
    "To figure your total FUTA tax before adjustments, multiply line 7 by 0.006 and then enter the " +
    "result on line 8.",
  soWhat:
    "Line 8 uses 0.006 — the after-credit rate — before anyone has checked whether you earned the " +
    "credit. It is the best case. Lines 9, 10 and 11 exist to take back whatever you did not earn. " +
    "So a Form 940 that stops at line 8 is not finished, it is merely optimistic.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 9 — THE FULL 6% BRANCH, AND ITS TRAP.
 *
 * If ALL your FUTA wages were excluded from state unemployment tax, you get no
 * credit at all and pay the full 6%. Line 9 implements that by adding back the
 * whole 5.4%.
 *
 * The caution is the part to read twice: a 0% state experience rate is NOT the
 * same as being excluded. A 0% rate still earns you the full credit (see
 * `I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT`). Confusing "I paid the state
 * nothing because my rate was zero" with "my wages were excluded from state
 * tax" would multiply Michael's federal unemployment tax by ten.
 *
 * This branch also LOCKS OUT lines 10 and 11 — which is a mutual exclusion the
 * engine has to enforce, not merely mention.
 */
export const I940_LINE_9_ALL_EXCLUDED: GuidanceAuthority = {
  id: "i940-line-9-all-excluded",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), line 9 - If ALL of the Taxable FUTA Wages You Paid Were Excluded From State Unemployment Tax",
  quote:
    "Caution: Line 9 doesn't apply to FUTA wages on which you paid no state unemployment tax only " +
    "because the state assigned you a tax rate of 0%. If all of the taxable FUTA wages you paid " +
    "were excluded from state unemployment tax, multiply line 7 by 0.054 and enter the result on " +
    "line 9. ... If line 9 applies to you, lines 10 and 11 don't apply to you. Therefore, leave " +
    "lines 10 and 11 blank. Don't fill out the worksheet in these instructions.",
  soWhat:
    "If none of your wages were subject to state unemployment tax, there is no credit and you pay " +
    "the full 6%. But watch the caution: being assigned a 0% state rate is NOT the same as being " +
    "excluded, and it does not put you here. Line 9 and line 10 are mutually exclusive — if one is " +
    "filled in, the other must be blank.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 10 — WHEN THE SIMPLE PATH ENDS AND THE WORKSHEET BEGINS.
 *
 * Two triggers, and either one is enough. Most small employers never see this
 * worksheet, which is exactly why the ones who need it do not know it exists.
 */
export const I940_WORKSHEET_TRIGGER: GuidanceAuthority = {
  id: "i940-worksheet-trigger",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), line 10 - If SOME of the Taxable FUTA Wages You Paid Were Excluded From State Unemployment Tax, or You Paid Any State Unemployment Tax Late",
  quote:
    "You must fill out the worksheet, later, if: • Some of the taxable FUTA wages you paid were " +
    "excluded from state unemployment tax, or • Any of your payments of state unemployment tax were " +
    "late. The worksheet takes you step by step through the process of figuring your credit. At the " +
    "end of the worksheet, you'll find an example of how to use it. Don't complete the worksheet if " +
    "line 9 applied to you (see the instructions for line 9, earlier).",
  soWhat:
    "Either trigger sends you to the worksheet: some wages excluded from state tax, OR any state " +
    "tax paid late. And note the last sentence — if line 9 applied to you, you do not touch the " +
    "worksheet at all. The two paths are mutually exclusive, which is a rule the software enforces " +
    "rather than merely mentions.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * WHERE THE WORKSHEET'S ANSWER GOES, AND WHERE THE WORKSHEET ITSELF GOES.
 *
 * Split out as its own record rather than elided into the one above, because
 * the two passages sit seventeen hundred characters apart in the instructions
 * and joining them with a "..." would have concealed a whole intervening
 * section — the list of information you must gather first — behind three dots.
 * An elision is for a page header, not for a section. Standing rule 24.
 */
export const I940_WORKSHEET_IS_NOT_FILED: GuidanceAuthority = {
  id: "i940-worksheet-is-not-filed",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 10 instructions",
  quote:
    "After you complete the worksheet, enter the amount from line 7 of the worksheet on Form 940, " +
    "line 10. Don't attach the worksheet to your Form 940. Keep it with your records.",
  soWhat:
    "Only the ANSWER goes on the return — one number on line 10. The worksheet that produced it " +
    "stays in your own files. Which means that if the IRS ever asks how line 10 was arrived at, the " +
    "only evidence in existence is the paper you kept. This is exactly why the software stores the " +
    "full worksheet with every figure rather than just the final adjustment.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE WORKSHEET ITSELF — THE ARITHMETIC THE ENGINE IMPLEMENTS.
 *
 * Seven steps, three of which are early exits. The shape worth memorising:
 *
 *   line 1 = taxable FUTA wages x 5.4%          the credit you COULD have
 *   line 2 = state tax paid on time             the credit you earned outright
 *   line 3 = additional credit                  a top-up when your experience
 *                                               rate was BELOW 5.4%
 *   line 4 = line 2 + line 3
 *   line 5 = the late-payment credit, worth only 90 cents on the dollar and
 *            capped at the credit still remaining
 *   line 6 = your actual credit
 *   line 7 = line 1 − line 6 = what you LOST, which is the adjustment that
 *            goes on Form 940 line 10 and INCREASES your tax
 *
 * Line 3 is the one nobody expects. A low experience rate — which Washington
 * gives you for not laying people off — means you paid the state less than
 * 5.4%. You would think that means a smaller credit. It does not: the IRS hands
 * you the difference as "additional credit", so being a stable employer is not
 * punished federally. Michael should understand that, because it means his good
 * ESD experience rating is worth money twice.
 */
export const I940_WORKSHEET_LINE_10: GuidanceAuthority = {
  id: "i940-worksheet-line-10",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Worksheet-Line 10",
  quote:
    "1. Maximum allowable credit — Enter Form 940, line 7 (Form 940, line 7 x 0.054 = line 1). . x " +
    "0.054 on line 1 1. . 2. Credit for timely state unemployment tax payments — How much did you " +
    "pay on time? 2. . • If line 2 is equal to or more than line 1, STOP here. You've completed the " +
    "worksheet. Leave Form 940, line 10, blank. • If line 2 is less than line 1, continue this " +
    "worksheet. 3. Additional credit — Were ALL of your assigned experience rates 5.4% or more? • " +
    "If yes, enter zero on line 3. Then, go to line 4 of this worksheet." +
    " ... " +
    "4. Subtotal (line 2 + line 3 = line 4) 4. . • If line 4 is equal to or more than line 1, STOP " +
    "here. You've completed the worksheet. Leave Form 940, line 10, blank. • If line 4 is less than " +
    "line 1, continue this worksheet. 5. Credit for paying state unemployment taxes late: 5a. What " +
    "is your remaining allowable credit? (line 1 – line 4 = line 5a) 5a. . 5b. How much state " +
    "unemployment tax did you pay late? 5b. . 5c. Which is smaller, line 5a or line 5b? Enter the " +
    "smaller number here. 5c. . 5d. Your allowable credit for paying state unemployment taxes late " +
    "(line 5c x 0.900 = line 5d) 5d. . 6. Your FUTA credit (line 4 + line 5d = line 6) 6. . • If " +
    "line 6 is equal to or more than line 1, STOP here. You've completed the worksheet. Leave Form " +
    "940, line 10, blank. • If line 6 is less than line 1, continue this worksheet. 7. Your " +
    "adjustment (line 1 – line 6 = line 7) Enter line 7 from this worksheet on Form 940, line 10.",
  soWhat:
    "This is the machine that decides what your federal unemployment tax really is. Line 1 is the " +
    "credit you could have had; line 6 is the credit you actually earned; line 7 is the gap, and " +
    "the gap is added to your tax. Notice line 5d: state tax paid late still earns credit, but only " +
    "90 cents on the dollar — that 10% haircut is the federal penalty for paying the state late. " +
    "And notice line 3: if Washington gave you an experience rate BELOW 5.4%, the IRS tops your " +
    "credit back up, so a good safety record is worth money twice.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 12, AND THE MUTUAL EXCLUSION STATED AS A CAUTION. Worth encoding as a
 * hard check: a return with a positive line 9 AND a positive line 10 is
 * internally contradictory, and the instructions say so in as many words.
 */
export const I940_LINE_12_TOTAL: GuidanceAuthority = {
  id: "i940-line-12-total",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 12 - Total FUTA Tax After Adjustments",
  quote:
    "Add the amounts shown on lines 8, 9, 10, and 11, and enter the result on line 12. ... Caution: " +
    "If line 9 is greater than zero, lines 10 and 11 must be zero because they don't apply.",
  soWhat:
    "Line 12 is your real federal unemployment tax for the year. Every adjustment only ever adds. " +
    "And the caution is a consistency rule the software should refuse to break: if line 9 has a " +
    "number in it, lines 10 and 11 must be empty, because they describe situations that cannot both " +
    "be true at once.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  WHEN — FILING, DEPOSITING AND PAYING ARE THREE DIFFERENT DEADLINES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TEN-DAY BONUS. The 940 is one of the very few federal returns that gives
 * you EXTRA TIME as a reward for having deposited properly. Note that these are
 * the 2025 revision's dates; the engine derives due dates from the year rather
 * than hard-coding them, because 31 January falls differently each year.
 */
export const I940_WHEN_TO_FILE: GuidanceAuthority = {
  id: "i940-when-to-file",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), When Must You File Form 940?",
  quote:
    "The due date for filing Form 940 for 2025 is February 2, 2026. However, if you deposited all " +
    "your FUTA tax when it was due, you may file Form 940 by February 10, 2026.",
  soWhat:
    "The 940 is due 31 January after the year ends (2 February in 2026, because the 31st fell on a " +
    "Saturday). If you deposited everything on time during the year, you get ten extra days. It is " +
    "the only federal payroll return that pays you for good behaviour.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE $500 RULE, WHICH IS A CARRY-FORWARD AND NOT A THRESHOLD PER QUARTER.
 *
 * Read the middle sentences twice: an under-$500 quarter is not forgiven, it is
 * CARRIED. The liability accumulates until the cumulative figure crosses $500,
 * and only then does a deposit fall due. Greenway, with a small crew, may well
 * carry three quarters and deposit once — and a program that tested each
 * quarter in isolation would report "no deposit due" four times and be wrong by
 * the end of the year.
 */
export const I940_DEPOSIT_THRESHOLD: GuidanceAuthority = {
  id: "i940-deposit-threshold",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), When Must You Deposit Your FUTA Tax?",
  quote:
    "If your FUTA tax is more than $500 for the calendar year, you must deposit at least one " +
    "quarterly payment. ... If your FUTA tax is $500 or less in a quarter, carry it over to the " +
    "next quarter. Continue carrying your tax liability over until your cumulative tax is more than " +
    "$500. At that point, you must deposit your tax for the quarter. Deposit your FUTA tax by the " +
    "last day of the month after the end of the quarter.",
  soWhat:
    "A quarter under $500 is not written off — it rolls forward and adds to the next one. Once the " +
    "running total passes $500 you must deposit by the end of the month after that quarter. A small " +
    "employer often carries for three quarters and deposits once. Testing each quarter on its own " +
    "would miss the deposit entirely.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE FOURTH QUARTER IS DIFFERENT: if the accumulated amount is still $500 or
 * less at year end, you may simply pay it WITH the return instead of making a
 * separate deposit. This is the branch most small employers actually take.
 */
export const I940_FOURTH_QUARTER: GuidanceAuthority = {
  id: "i940-fourth-quarter",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Fourth quarter liabilities",
  quote:
    "If your FUTA tax for the fourth quarter (plus any undeposited amounts from earlier quarters) " +
    "is more than $500, deposit the entire amount by February 2, 2026. If it is $500 or less, you " +
    "can either deposit the amount or pay it with your Form 940 by February 2, 2026.",
  soWhat:
    "At year end, if everything you have carried still adds up to $500 or less, you can just pay it " +
    "with the return. That is the ordinary path for a business Greenway's size, and it means one " +
    "payment a year rather than four.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 14 — THREE BANDS, INCLUDING A DE MINIMIS ONE MOST PEOPLE HAVE NEVER
 * HEARD OF. Under a dollar and you simply do not pay it. Over $500 and paying
 * with the return is not merely discouraged, it exposes you to a penalty.
 */
export const I940_BALANCE_DUE_BANDS: GuidanceAuthority = {
  id: "i940-balance-due-bands",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 14 - Balance Due",
  quote:
    "If line 13 is less than line 12, enter the difference on line 14. line 12 – line 13 line 14 If " +
    "line 14 is: • More than $500, you must deposit your tax—see When Must You Deposit Your FUTA " +
    "Tax, earlier; • $500 or less, you can deposit your tax, pay your tax by EFT, pay your tax with " +
    "a credit card or debit card, pay your tax by EFW if filing electronically, or pay your tax by " +
    "check or money order with your return—for more information on electronic payment options, go " +
    "to IRS.gov/Pay; or • Less than $1, you don't have to pay it. Caution: If you don't deposit as " +
    "required and pay any balance due with Form 940, you may be subject to a penalty.",
  soWhat:
    "Three bands. Under $1: forget it. $500 or less: pay it however you like, including with the " +
    "return. More than $500: it had to be DEPOSITED, and settling it with the return instead can " +
    "earn you a penalty even though the IRS ends up with the same money on the same day.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * CREDIT REDUCTION STATES. This is a fact about the STATE'S borrowing, not
 * about anything the employer did, and it changes year to year by act of the
 * U.S. Department of Labor. Washington is not currently one — but the engine
 * takes the rate as an INPUT rather than assuming zero, because "not this year"
 * is a fact with an expiry date, and a hard-coded zero would silently
 * understate the tax the year that changes.
 */
export const I940_CREDIT_REDUCTION_STATE: GuidanceAuthority = {
  id: "i940-credit-reduction-state",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Credit reduction state",
  quote:
    "A state that hasn't repaid money it borrowed from the federal government to pay unemployment " +
    "benefits is called a credit reduction state. The U.S. Department of Labor determines these " +
    "states. If an employer pays wages that are subject to the unemployment tax laws of a credit " +
    "reduction state, that employer must pay additional federal unemployment tax when filing its " +
    "Form 940.",
  soWhat:
    "If a state borrowed from the federal government to pay unemployment benefits and has not " +
    "repaid it, employers in that state lose part of the 5.4% credit and owe more federal tax. It " +
    "is nothing you did. Washington is not a credit reduction state today, which is a fact that can " +
    "change, so the software asks rather than assumes.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE IRS'S OWN WORKED EXAMPLE — A TEST VECTOR, NOT AN ILLUSTRATION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The instructions print a fully worked Worksheet—Line 10 with every
 * intermediate figure. That makes it something better than an example: it is an
 * ORACLE. If this engine reproduces all seven lines from the same inputs, the
 * implementation matches the IRS's own arithmetic; if it does not, the engine
 * is wrong and there is no arguing about whose interpretation is right.
 *
 * Recorded here as data so `form-940-core` and its tests both read the same
 * numbers from one place instead of each retyping them.
 *
 * All money is integer cents, per house convention. Rates are basis points.
 */
export const I940_IRS_WORKSHEET_EXAMPLE = {
  /** Form 940 line 7, taxable FUTA wages: $21,000.00 */
  taxableFutaWagesCents: 2_100_000,
  /** Taxable state unemployment wages: $8,000.00 */
  taxableStateWagesCents: 800_000,
  /** Assigned experience rate 0.041 = 4.1% = 410 basis points */
  experienceRateBps: 410,
  /** State unemployment tax paid on time: $100.00 */
  statePaidOnTimeCents: 10_000,
  /** State unemployment tax paid late: $78.00 */
  statePaidLateCents: 7_800,
  /** State unemployment tax not paid at all: $150.00 */
  stateNotPaidCents: 15_000,

  // ── the seven answers the IRS prints ──────────────────────────────────
  /** Worksheet line 1, maximum allowable credit: $1,134.00 */
  line1MaximumCreditCents: 113_400,
  /** Worksheet line 2, credit for timely payments: $100.00 */
  line2TimelyCreditCents: 10_000,
  /** Worksheet line 3, additional credit: $104.00 */
  line3AdditionalCreditCents: 10_400,
  /** Worksheet line 4, subtotal: $204.00 */
  line4SubtotalCents: 20_400,
  /** Worksheet line 5a, remaining allowable credit: $930.00 */
  line5aRemainingCreditCents: 93_000,
  /** Worksheet line 5b, state tax paid late: $78.00 */
  line5bPaidLateCents: 7_800,
  /** Worksheet line 5c, smaller of 5a and 5b: $78.00 */
  line5cSmallerCents: 7_800,
  /** Worksheet line 5d, allowable late credit at 90%: $70.20 */
  line5dLateCreditCents: 7_020,
  /** Worksheet line 6, total FUTA credit: $274.20 */
  line6FutaCreditCents: 27_420,
  /** Worksheet line 7, the adjustment for Form 940 line 10: $859.80 */
  line7AdjustmentCents: 85_980,
} as const;

/**
 * The narrative the IRS attaches to those figures, quoted so the example on
 * screen is the IRS's example and not a paraphrase of it.
 */
export const I940_WORKSHEET_EXAMPLE_FACTS: GuidanceAuthority = {
  id: "i940-worksheet-example-facts",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Example for Using the Worksheet",
  quote:
    "Jill Brown and Tom White are corporate officers whose wages are excluded from state " +
    "unemployment tax in your state. Jack Davis's wages aren't excluded from state unemployment " +
    "tax. During 2025, you paid $44,000 to Jill, $22,000 to Tom, and $16,000 to Jack. Your state's " +
    "wage base is $8,000. You paid some state unemployment tax on time, some late, and some remains " +
    "unpaid.",
  soWhat:
    "This is the IRS doing the worksheet itself, with every intermediate number printed. That makes " +
    "it a test the software must pass: feed the engine these facts and it must produce the IRS's " +
    "own seven answers to the penny. If it does not, the engine is wrong — there is no room for a " +
    "difference of opinion when the author of the form has shown its working.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE SET
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Only the authorities declared HERE. Used by the coverage tests. */
export const FORM_940_OWN_AUTHORITIES: readonly GuidanceAuthority[] = [
  I940_WHO_MUST_FILE,
  I940_NO_PAYMENTS_STILL_FILE,
  I940_RATE_AND_CREDIT,
  I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT,
  I940_ON_TIME_AND_LATE_DEFINED,
  I940_LINE_5_WAGE_BASE,
  I940_LINE_8_BEFORE_ADJUSTMENTS,
  I940_LINE_9_ALL_EXCLUDED,
  I940_WORKSHEET_TRIGGER,
  I940_WORKSHEET_IS_NOT_FILED,
  I940_WORKSHEET_LINE_10,
  I940_LINE_12_TOTAL,
  I940_WHEN_TO_FILE,
  I940_DEPOSIT_THRESHOLD,
  I940_FOURTH_QUARTER,
  I940_BALANCE_DUE_BANDS,
  I940_CREDIT_REDUCTION_STATE,
  I940_WORKSHEET_EXAMPLE_FACTS,
];

/**
 * The ids this module reuses from the shared payroll registry rather than
 * redeclaring (standing rule 25). If one of these ever disappears from the
 * registry, `form940Authorities()` would silently return a shorter list — so
 * the test asserts every id here still resolves.
 */
export const FORM_940_REUSED_AUTHORITY_IDS: readonly string[] = [
  "irc-3301-futa-rate",
  "irc-3306-futa-wage-base",
  "irc-3302-futa-credit",
];

/**
 * Everything a reader needs for Form 940, in one call: this module's own quotes
 * plus the shared FUTA statutes that already existed.
 *
 * Deduplicated by id, because a shared registry entry appearing twice in a
 * mentor panel reads like a mistake even when it is harmless.
 */
export function form940Authorities(): readonly GuidanceAuthority[] {
  const reused = PAYROLL_TAX_AUTHORITIES.filter((a) =>
    FORM_940_REUSED_AUTHORITY_IDS.includes(a.id),
  );
  const seen = new Set<string>();
  const out: GuidanceAuthority[] = [];
  for (const a of [...FORM_940_OWN_AUTHORITIES, ...reused]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Look up one Form 940 authority by id. Returns undefined rather than throwing. */
export function findForm940Authority(id: string): GuidanceAuthority | undefined {
  return form940Authorities().find((a) => a.id === id);
}
