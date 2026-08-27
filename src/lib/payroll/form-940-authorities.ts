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
 * LINE 3 — "ALL PAYMENTS", INCLUDING THE ONES THAT ARE NOT TAXABLE.
 *
 * The sentence that matters is the third one: "even if the payments aren't
 * taxable for FUTA". Line 3 is deliberately gross. People who enter their
 * taxable figure here and then subtract again on line 5 remove the same money
 * twice and understate the tax, which is why this passage is quoted onto the
 * line 3 lesson rather than merely paraphrased.
 *
 * The elision skips the long bulleted catalogue of includable compensation —
 * salaries, fringe benefits, cafeteria plans and so on — and resumes at the
 * sentence about payment method. Nothing of substance is omitted from the
 * proposition being cited: that line 3 is everything.
 */
export const I940_LINE_3_ALL_PAYMENTS: GuidanceAuthority = {
  id: "i940-line-3-all-payments",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 3 - Total Payments to All Employees",
  quote:
    "Report the total payments you made during the calendar year on line 3. Include payments for " +
    "the services of all employees, even if the payments aren't taxable for FUTA. Your method of " +
    "payment doesn't determine whether payments are wages.",
  soWhat:
    "Line 3 is gross and it is everything. The IRS says to include payments that are not even " +
    "taxable for FUTA, because the subtracting happens later on lines 4 and 5. Entering an " +
    "already-reduced figure here and then subtracting again takes the same money out twice and " +
    "understates the tax you owe.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 7 — THE ONLY FIGURE ON THE FORM THAT TAX IS ACTUALLY CHARGED ON.
 *
 * Two sentences, quoted together because line 7 is meaningless without line 6:
 * the subtotal of exempt payments and above-ceiling excess is what gets taken
 * off the gross. Line 7 is then the taxable base, and every dollar of FUTA
 * flows from it.
 */
export const I940_LINE_7_TAXABLE_WAGES: GuidanceAuthority = {
  id: "i940-line-7-taxable-wages",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 7 - Total Taxable FUTA Wages",
  quote:
    "To figure your subtotal, add the amounts on lines 4 and 5 and enter the result on line 6. " +
    "... To figure your total taxable FUTA wages, subtract line 6 from line 3 and enter the " +
    "result on line 7.",
  soWhat:
    "Line 7 is the one figure on the form that tax is genuinely charged on. Everything above it " +
    "is bookkeeping: gross in line 3, exempt and above-ceiling money out through line 6. Divide " +
    "line 7 by $7,000 and you get the number of full wage bases you funded this year, which is a " +
    "headcount sanity check you can do in your head.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 17 — THE FORM'S OWN INTERNAL PROOF.
 *
 * "must equal line 12" is not advice. It is an identity, and it is the single
 * cheapest error check on the whole return: if Part 5 does not foot to line
 * 12, something upstream is wrong and the IRS will see it immediately.
 */
export const I940_LINE_17_MUST_EQUAL_12: GuidanceAuthority = {
  id: "i940-line-17-must-equal-12",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), line 17 - Total Tax Liability for the Year",
  quote:
    "Your total tax liability for the year must equal line 12. Copy the amount from line 12 onto " +
    "line 17.",
  soWhat:
    "This is the form checking itself. Part 5 splits the year's tax across four quarters, and the " +
    "four quarters must add back to line 12 to the cent. If they do not, the quarterly split is " +
    "wrong, and it is far better to find that here than in a notice.",
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

/* ══════════════════════════════════════════════════════════════════════════
 * §4b  THE TWELVE LINES THAT HAD NO WORDS (books-54)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Form 940 has 30 numbered lines on the printed page. This module explained
 * eighteen of them. The twelve below were unexplainable by construction: no
 * authority, no lesson, and -- for the ownership table in form-box-adapters --
 * no classification either, which means `resolveWhose` THREW for them and the
 * teaching screen could not even list the box.
 *
 * The twelve: 1a, 1b, 2, 4a, 4b, 4c, 4d, 4e, 15b, 15c, 15d, 15e. Line 4 itself
 * was classified but had no authority, so it is quoted here too.
 *
 * WHY 15b-15e EXIST ON A 940 AT ALL. Direct deposit of Form 940 refunds is new
 * for the 2025 revision. Michael's own filed 2025 form shows 15c/15d/15e
 * printed and empty. They are bank credentials, not accounting figures, which
 * is the reason the teaching layer deliberately shows no specimen value.
 *
 * EVERY QUOTE BELOW WAS SLICED FROM THE CORPUS BY MACHINE. Two anchors used
 * while doing it were not unique -- "Fringe benefits, such as the following."
 * and "Other payments, such as the following." each appear twice, once in the
 * line-3 section and once in the line-4 section. Taking the first hit produced
 * a 2,180-character "quote" that swallowed the IRS's three-employee worked
 * example and a page header, and it PASSED a substring check because it was a
 * genuine contiguous slice. That is defect 5 in the test file's list, produced
 * again from a different direction, and it is why the slicer now pins the
 * search to a section, caps the length, and refuses a slice containing a page
 * header.
 *
 * ONE SENTENCE IS DELIBERATELY NOT QUOTED. The line-2 section contains "For
 * tax year 2025, there are credit reduction states." -- with no number where a
 * count belongs. That is genuinely what the mirrored PDF says (verified at the
 * byte level, and it reads the same way at two separate places in the
 * document), so the mirror is faithful and the omission is the IRS's. It is
 * not quoted because a sentence with a hole in it teaches nothing; the
 * complete adjacent sentence is quoted instead. For the record, the 2025
 * credit reduction states are California and the U.S. Virgin Islands, and
 * neither is Washington.
 *
 * A HYPHENATION ARTEFACT IS ALSO AVOIDED. The 1b heading in the PDF breaks
 * "employer" across a line as "employ-" / "er)", which after newline-closing
 * becomes "employ- er)". Showing Michael a word split in half would make him
 * doubt every other quote, and repairing it would be a third transformation
 * this module does not declare. So the quote starts at the next sentence.
 * ══════════════════════════════════════════════════════════════════════════ */

export const I940_LINE_1A_ONE_STATE: GuidanceAuthority = {
  id: "i940-line-1a-one-state",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 1a. One state only",
  quote:
    "1a. One state only. Enter the two-letter USPS abbreviation for the state where you were " +
    "required to pay your state unemployment tax on line 1a. For a list of state abbreviations, " +
    "see the Schedule A (Form 940) instructions or go to the website for the U.S. Postal Service " +
    "at USPS.com.",
  soWhat:
    "Greenway pays state unemployment tax to Washington and only to Washington, so line 1a reads " +
    "WA and line 1b stays empty. Two letters, and they decide whether a Schedule A has to be " +
    "attached at all.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_1B_MULTI_STATE: GuidanceAuthority = {
  id: "i940-line-1b-multi-state",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 1b. More than one state (you're a multi-state " +
    "employer)",
  quote:
    "Check the box on line 1b. Then, fill out Schedule A (Form 940) and attach it to your Form " +
    "940.",
  soWhat:
    "This box is for employers who owe state unemployment tax in more than one state. Ticking it " +
    "obliges you to file Schedule A. Greenway operates in Washington only, so it stays blank -- " +
    "but it would have to be ticked the first year an employee worked in Oregon.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_2_CREDIT_REDUCTION_BOX: GuidanceAuthority = {
  id: "i940-line-2-credit-reduction-box",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 2. If You Paid Wages in a State That Is Subject to " +
    "Credit Reduction",
  quote:
    "If you paid wages subject to the unemployment tax laws of these states, check the box on " +
    "line 2 and fill out Schedule A (Form 940). See the instructions for line 9 before completing " +
    "Schedule A (Form 940).",
  soWhat:
    "Line 2 is a tickbox, not an amount. You tick it only if you paid wages in a state that the " +
    "Department of Labor has named a credit reduction state for that year, and ticking it forces " +
    "a Schedule A. Washington is not one today, so the box stays empty -- but this is decided " +
    "annually and must be re-checked every January rather than assumed.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4_EXEMPT_MUST_BE_IN_LINE_3: GuidanceAuthority = {
  id: "i940-line-4-exempt-must-be-in-line-3",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4. Payments Exempt From FUTA Tax",
  quote:
    "If you enter an amount on line 4, check the appropriate box or boxes on lines 4a through 4e " +
    "to show the types of payments exempt from FUTA tax. You only report a payment as exempt from " +
    "FUTA tax on line 4 if you included the payment on line 3.",
  soWhat:
    "The trap is in the last sentence: a payment only belongs on line 4 if it was already counted " +
    "on line 3. Line 4 SUBTRACTS, so putting something there that was never added takes money out " +
    "of the base that was never in it, and understates the tax.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4A_FRINGE_BENEFITS: GuidanceAuthority = {
  id: "i940-line-4a-fringe-benefits",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4a. Fringe benefits",
  quote:
    "Fringe benefits, such as the following. —The value of certain meals and lodging. " +
    "—Contributions to accident or health plans for employees, including certain employer " +
    "payments to a health savings account or an Archer MSA. —Payments for benefits excluded under " +
    "section 125 (cafeteria) plans.",
  soWhat:
    "The 4a box describes WHAT KIND of exempt payment line 4 holds. Note the third bullet: " +
    "section 125 cafeteria plan benefits. If Greenway ever runs pre-tax benefit deductions " +
    "through a cafeteria plan, this is the box that explains the line 4 amount.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4B_GROUP_TERM_LIFE: GuidanceAuthority = {
  id: "i940-line-4b-group-term-life",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4b. Group-term life insurance",
  quote:
    "Group-term life insurance. For information about group-term life insurance and other " +
    "payments for fringe benefits that may be exempt from FUTA tax, see Pub. 15-B.",
  soWhat:
    "Employer-paid group-term life insurance is exempt from FUTA. It is a separate tickbox from " +
    "4a because the IRS wants to know which category the line 4 subtraction came from.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4C_RETIREMENT_PENSION: GuidanceAuthority = {
  id: "i940-line-4c-retirement-pension",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4c. Retirement/Pension",
  quote:
    "Retirement/Pension, such as employer contributions to a qualified plan, including a SIMPLE " +
    "retirement account (other than elective salary reduction contributions) and a 401(k) plan.",
  soWhat:
    "Employer contributions to a qualified plan are exempt from FUTA. Read the parenthesis " +
    "carefully: elective salary reduction contributions are NOT exempt. The employer's own " +
    "contribution comes out of the base; the employee's deferral stays in it.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4D_DEPENDENT_CARE: GuidanceAuthority = {
  id: "i940-line-4d-dependent-care",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4d. Dependent care",
  quote:
    "Dependent care, such as payments (up to $5,000 per employee, $2,500 if married filing " +
    "separately) for a qualifying person's care that allows your employees to work and that would " +
    "be excludable by the employee under section 129.",
  soWhat:
    "Dependent care assistance is exempt from FUTA up to $5,000 per employee, halved for " +
    "married-filing-separately. Anything above the cap is ordinary taxable wages, so this is one " +
    "of the few line 4 categories with an arithmetic ceiling inside it.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_4E_OTHER_PAYMENTS: GuidanceAuthority = {
  id: "i940-line-4e-other-payments",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 4e. Other payments",
  quote:
    "Other payments, such as the following. —All non-cash payments and certain cash payments for " +
    "agricultural labor, and all payments to H-2A visa workers.",
  soWhat:
    "The catch-all box. For Greenway the relevant reading is the opposite of what people expect: " +
    "this list does NOT include ordinary wages, so 4e is not a place to park anything that does " +
    "not fit. If nothing on the list applies, line 4 is blank and 4e is unticked.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_15B_APPLY_OR_REFUND: GuidanceAuthority = {
  id: "i940-line-15b-apply-or-refund",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 15b. Choose to have your overpayment applied to your " +
    "next return or refunded",
  quote:
    "15b. Choose to have your overpayment applied to your next return or refunded. If you " +
    "deposited more than the FUTA tax due for the year, you may choose to have us either: ... " +
    "Check the appropriate box on line 15b to tell us which option you select. Check only one box " +
    "on line 15b. If you don't check either box or if you check both boxes, we will generally " +
    "apply the overpayment to your next return.",
  soWhat:
    "If you overpaid, you must choose: carry it forward, or take it back. Two facts matter. Check " +
    "ONE box -- checking both, or neither, means the IRS applies it to the next return by " +
    "default. And regardless of what you check, the IRS may take the overpayment against any " +
    "past-due account under the same EIN.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_15C_ROUTING_NUMBER: GuidanceAuthority = {
  id: "i940-line-15c-routing-number",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 15c. Routing number",
  quote:
    "15c. Routing number. The routing number must be nine digits. The first two digits must be 01 " +
    "through 12 or 21 through 32. Verify that your financial institution will accept a direct " +
    "deposit.",
  soWhat:
    "A bank routing number, entered only when you asked for a refund on 15b. Nine digits, and the " +
    "first two must fall in 01-12 or 21-32 -- which is a free validity check you can run before " +
    "filing. This figure comes from the bank, never from the ledger.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_15D_ACCOUNT_TYPE: GuidanceAuthority = {
  id: "i940-line-15d-account-type",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 15d. Type of account",
  quote:
    "15d. Type of account. Check the appropriate box for the type of account. Don't check more " +
    "than one box. You must check the correct box to ensure your deposit is accepted.",
  soWhat:
    "Checking or savings, exactly one box. Getting it wrong does not merely delay the refund; it " +
    "can cause the deposit to be rejected outright and a paper cheque issued instead.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

export const I940_LINE_15E_ACCOUNT_NUMBER: GuidanceAuthority = {
  id: "i940-line-15e-account-number",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 15e. Account number",
  quote:
    "15e. Account number. The account number can be up to 17 characters (both numbers and " +
    "letters). Include hyphens but omit spaces and special symbols. Enter the number from left to " +
    "right and leave any unused boxes blank.",
  soWhat:
    "The bank account number for the refund, up to seventeen characters, hyphens included but " +
    "spaces and symbols omitted, left-aligned. Like 15c this is a bank credential rather than an " +
    "accounting figure, which is why the teaching screen shows no specimen value for it.",
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
 * §4c  THE FIFTEEN BOXES THAT STILL HAD NO WORDS  (books-65)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * books-54 closed twelve lines and this file's own comment above says so. It
 * did not close all of them, and the marker on the screen is what proved it:
 * Michael, inspecting the rendered forms, wrote "the boxes that dont have
 * lessons, the boxes look like there is a red squiggly line in it, but id
 * rather they just open a box that says in plain english what it is and why it
 * doesn't need a lesson."
 *
 * Measured rather than guessed. `scripts/tmp-gap.ts` joined the teaching
 * specimen against every lesson module in the repository and printed:
 *
 *     form_940: 35 boxes | 15 UNTAUGHT ->
 *       [ein, name, tradeName, address, cityStateZip,
 *        4, 6, 11, 13, 14, 15a, 16a, 16b, 16c, 16d]
 *
 * Then the second question, the one that decides whether a lesson is even
 * permitted: is there authority for each, or would some be explained on my own
 * say-so (standing rule 62d)? Every one of the fifteen has instruction text in
 * the mirrored corpus. So none of them was a box that "doesn't need a lesson";
 * all fifteen were boxes nobody had written. Michael's fallback panel is
 * unnecessary, which is the best answer his question could have had.
 *
 * Lines 4 and 14 already had authorities here, and lines 4a-4e are covered
 * above. The eight records below close the rest. Every quote was extracted
 * mechanically from the corpus by a throwaway slicing script rather than
 * retyped, so a failure of the verbatim gate means the corpus changed, not
 * that somebody's fingers slipped.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TOP OF THE FORM. The IRS's own worked example here is, by coincidence,
 * exactly Greenway's situation: a legal name that nobody says out loud and a
 * trading name that everybody does. The last sentence is the rule people break
 * - a trade name identical to the legal name is left BLANK, not repeated.
 */
export const I940_ENTITY_TOP_OF_FORM: GuidanceAuthority = {
  id: "i940-entity-top-of-form",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), Employer Identification Number (EIN), Name, Trade Name, and Address",
  quote:
    "Enter your EIN, name, and address in the spaces provided. You must enter your name and EIN " +
    "here and on page 2. Enter the business (legal) name that you used when you applied for your " +
    "EIN on Form SS-4. For example, if you're a sole proprietor, enter \u201CRonald Smith\u201D on the Name " +
    "line and \u201CRon's Cycles\u201D on the Trade Name line. Leave the Trade Name line blank if it is the " +
    "same as your Name.",
  soWhat:
    "Two names, and the form decides which goes where: the one on the SS-4 goes on Name, the one " +
    "on the door goes on Trade Name, and if they are the same the second line stays empty. " +
    "Greenway is the two-name case - LYMAN'S MARIJUANA L.L.C. and GREENWAY MARIJUANA - so both " +
    "lines print.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE EIN, AND WHY IT IS A PENALTY RATHER THAN A TYPO. Worth quoting on the
 * 940 as well as the 941 even though the wording is close: this is the return
 * that ties to the state's records, and Michael runs four entities.
 */
export const I940_EIN_MUST_MATCH_EXACTLY: GuidanceAuthority = {
  id: "i940-ein-must-match-exactly",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Employer identification number (EIN)",
  quote:
    "Always be sure the EIN on the form you file exactly matches the EIN that the IRS assigned to " +
    "your business. Don't use a social security number (SSN) or an individual taxpayer " +
    "identification number (ITIN) on forms that ask for an EIN. Filing a Form 940 with an " +
    "incorrect EIN or using the EIN of another's business may result in penalties and delays in " +
    "processing your return.",
  soWhat:
    "\u201CExactly\u201D, and the penalty is for the identifier rather than for the tax. With four entities " +
    "on one desk, borrowing the wrong EIN is a realistic mistake with a real cost, which is why " +
    "this product stores it once per entity and prints it rather than asking anyone to type it.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * THE PREPARER SENTENCE. Michael prepares his own returns today; his CPA
 * touches them too. This is the sentence that says the name must survive the
 * handover unchanged.
 */
export const I940_PREPARER_MUST_USE_EXACT_NAME: GuidanceAuthority = {
  id: "i940-preparer-must-use-exact-name",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Enter Your Business Information at the Top of the Form",
  quote:
    "If you pay a tax preparer to fill out Form 940, make sure the preparer shows your business " +
    "name exactly as it appeared when you applied for your EIN.",
  soWhat:
    "A name retyped by somebody else is a name that can drift. The instruction puts the duty on " +
    "the business owner rather than on the preparer, which is why the stored profile - not the " +
    "preparer's memory - is the source this product prints from.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 6. Two lines added, and the reason it exists as its own line rather
 * than being folded into line 7 is that it is the total the IRS wants to see
 * SUBTRACTED - exempt payments plus over-the-ceiling payments, the whole of
 * what is not taxable.
 */
export const I940_LINE_6_SUBTOTAL: GuidanceAuthority = {
  id: "i940-line-6-subtotal",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 6. Subtotal",
  quote:
    "To figure your subtotal, add the amounts on lines 4 and 5 and enter the result on line 6.",
  soWhat:
    "Line 4 is money that was never FUTA wages at all; line 5 is money that was, but sat above " +
    "the $7,000 ceiling. Line 6 is the two together, and line 7 takes it away from line 3. The " +
    "split matters because the two halves fail in different ways.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 11. The line that is blank for Greenway, and the year it stops being
 * blank is a year Washington borrowed from the federal unemployment fund and
 * did not repay. Not an employer's doing, and not optional.
 */
export const I940_LINE_11_CREDIT_REDUCTION_AMOUNT: GuidanceAuthority = {
  id: "i940-line-11-credit-reduction-amount",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 11. If Credit Reduction Applies...",
  quote:
    "If you paid FUTA taxable wages that were also subject to state unemployment taxes in any " +
    "states that are subject to credit reduction, enter the total amount from Schedule A (Form " +
    "940) on Form 940, line 11. However, if you entered an amount on line 9 because all the FUTA " +
    "taxable wages you paid were excluded from state unemployment tax, skip line 11 and go to " +
    "line 12.",
  soWhat:
    "The figure is not computed on this form - it comes off Schedule A, which is a separate page " +
    "listing the affected states. Washington is not one today. If it ever is, this line stops " +
    "being blank and Schedule A must be attached, so the emptiness of the box is a fact with an " +
    "expiry date rather than a permanent truth.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 13. The only line on Form 940 that records money leaving the bank.
 * Everything above it is liability; this is cash, and it comes from outside
 * the form.
 */
export const I940_LINE_13_DEPOSITED: GuidanceAuthority = {
  id: "i940-line-13-deposited",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 13. FUTA Tax Deposited for the Year",
  quote:
    "Enter the amount of FUTA tax that you deposited for the year, including any overpayment that " +
    "you applied from a prior year.",
  soWhat:
    "Deposits made, plus credit carried in from last year. Nothing on the form can compute it, " +
    "which is exactly why it is capable of contradicting the form - and a line that cannot " +
    "contradict the computation above it would be worthless as a check.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 15a. The mirror image of line 14, and the instruction that matters is
 * the one shared with the 941: never both.
 */
export const I940_LINE_15A_OVERPAYMENT: GuidanceAuthority = {
  id: "i940-line-15a-overpayment",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 15a. Overpayment",
  quote:
    // books-65, SECOND CORRECTION. The first draft ran the quote on past the
    // full stop to pick up the arithmetic diagram the IRS prints beneath it:
    // "line 13 \u2013 line 12 line 15a". The quote-truncation gate rejected it,
    // correctly. Those three lines are a BOX DIAGRAM, not the tail of the
    // sentence, so a quote that swallows them ends on the bare fragment
    // "line 15a" and reads as though the authority were cut off mid-thought.
    //
    // The sentence the authority actually states is complete on its own and is
    // the whole rule, so the quote now stops at its full stop. The subtraction
    // it describes is explained in `soWhat` in our own words, which is where
    // our paraphrase belongs.
    "If line 13 is more than line 12, enter the difference on\nline 15a.",
  soWhat:
    "One subtraction, in the opposite direction from line 14. A return cannot be both short and " +
    "over, so a figure here means line 14 is blank, and a figure on both is a return that " +
    "contradicts itself on its face.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * PART 5 DOES NOT APPLY TO GREENWAY, AND THE FORM SAYS SO ITSELF.
 *
 * books-65. `filed-940-threshold.test.ts` refused the first draft of the
 * 16a-16d lessons and it was RIGHT to: Michael's filed 2025 return shows line
 * 12 of $420.00, and Part 5's own heading says to fill it out "Only if Line 12
 * Is More Than $500". A lesson that explains how to apportion his FUTA across
 * four quarters, without ever mentioning that he leaves all four blank, teaches
 * him a box he does not file.
 *
 * He asked for those boxes to open anyway - "you can write me a genuine, non
 * verbatim plain english explanation for the boxes that are trivial or the
 * boxes that dont apply to me" - so the lessons stay. This authority is what
 * makes them honest: every one of the four now leads with the threshold and the
 * instruction to leave Part 5 blank, in the IRS's own words, before explaining
 * what the box would mean if his payroll ever crossed $500.
 */
export const I940_PART5_ONLY_IF_OVER_500: GuidanceAuthority = {
  id: "i940-part-5-only-if-over-500",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), Part 5: Report Your FUTA Tax Liability by Quarter Only if Line 12 Is More Than $500",
  quote:
    "Fill out Part 5 only if line 12 is more than $500. If line 12 is\n$500 or less, leave Part 5 blank and go to Part 6.",
  soWhat:
    "This is the gate on all four boxes. Greenway's 2025 line 12 was 420.00, which is under the " +
    "threshold, so Part 5 was correctly left entirely blank - not zeroed, blank. The boxes are " +
    "still worth understanding, because the day the payroll grows past 500.00 they switch on " +
    "with no warning from the form itself.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 16a-16d. The quarterly liability breakdown, and the single most
 * misunderstood instruction on the form: "Don't enter the amount you
 * deposited." These four boxes are a LIABILITY diary, exactly like Schedule B
 * is for the 941, and confusing them with the deposits is what makes line 17
 * fail to equal line 12.
 */
export const I940_LINE_16_QUARTERLY_LIABILITY: GuidanceAuthority = {
  id: "i940-line-16-quarterly-liability",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 16. Report the Amount of Your FUTA Tax Liability for Each Quarter",
  quote:
    // En dash again (see line 15a above): the corpus prints "16a\u201316d".
    "Enter the amount of your FUTA tax liability for each quarter on lines 16a\u201316d. Don't enter " +
    "the amount you deposited. If you had no liability for a quarter, leave the line blank.",
  soWhat:
    "Liability, not deposits, and a blank rather than a zero when there was none. The four boxes " +
    "must add to line 17, which must equal line 12 - so entering deposits here breaks an " +
    "arithmetic check the IRS runs on every return.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * LINE 16d IS COMPUTED DIFFERENTLY FROM THE OTHER THREE, and almost nobody
 * knows it. The fourth quarter is a RESIDUAL, so any rounding drift in the
 * first three quarters lands there by design rather than by accident.
 */
export const I940_LINE_16D_IS_A_RESIDUAL: GuidanceAuthority = {
  id: "i940-line-16d-is-a-residual",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 16d. 4th quarter (October 1 to December 31)",
  quote:
    "To figure your FUTA tax liability for the fourth quarter, complete Form 940 through line 12. " +
    "Then, copy the amount from line 12 onto line 17. Lastly, subtract the sum of lines 16a " +
    "through 16c from line 17 and enter the result on line 16d.",
  soWhat:
    "The fourth quarter is not computed from fourth-quarter wages. It is whatever is left of the " +
    "year's tax after the first three quarters are taken off, which is what guarantees the four " +
    "boxes sum exactly to line 12. A 16d that looks slightly odd against Q4 payroll is usually " +
    "correct for this reason.",
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
  I940_LINE_3_ALL_PAYMENTS,
  I940_LINE_5_WAGE_BASE,
  I940_LINE_7_TAXABLE_WAGES,
  I940_LINE_8_BEFORE_ADJUSTMENTS,
  I940_LINE_9_ALL_EXCLUDED,
  I940_WORKSHEET_TRIGGER,
  I940_WORKSHEET_IS_NOT_FILED,
  I940_WORKSHEET_LINE_10,
  I940_LINE_12_TOTAL,
  I940_LINE_17_MUST_EQUAL_12,
  I940_WHEN_TO_FILE,
  I940_DEPOSIT_THRESHOLD,
  I940_FOURTH_QUARTER,
  I940_BALANCE_DUE_BANDS,
  I940_CREDIT_REDUCTION_STATE,
  I940_WORKSHEET_EXAMPLE_FACTS,
  I940_LINE_1A_ONE_STATE,
  I940_LINE_1B_MULTI_STATE,
  I940_LINE_2_CREDIT_REDUCTION_BOX,
  I940_LINE_4_EXEMPT_MUST_BE_IN_LINE_3,
  I940_LINE_4A_FRINGE_BENEFITS,
  I940_LINE_4B_GROUP_TERM_LIFE,
  I940_LINE_4C_RETIREMENT_PENSION,
  I940_LINE_4D_DEPENDENT_CARE,
  I940_LINE_4E_OTHER_PAYMENTS,
  I940_LINE_15B_APPLY_OR_REFUND,
  I940_LINE_15C_ROUTING_NUMBER,
  I940_LINE_15D_ACCOUNT_TYPE,
  I940_LINE_15E_ACCOUNT_NUMBER,
  // books-65 - the fifteen boxes that still carried the untaught marker.
  I940_ENTITY_TOP_OF_FORM,
  I940_EIN_MUST_MATCH_EXACTLY,
  I940_PREPARER_MUST_USE_EXACT_NAME,
  I940_LINE_6_SUBTOTAL,
  I940_LINE_11_CREDIT_REDUCTION_AMOUNT,
  I940_LINE_13_DEPOSITED,
  I940_LINE_15A_OVERPAYMENT,
  I940_LINE_16_QUARTERLY_LIABILITY,
  I940_LINE_16D_IS_A_RESIDUAL,
  I940_PART5_ONLY_IF_OVER_500,
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
