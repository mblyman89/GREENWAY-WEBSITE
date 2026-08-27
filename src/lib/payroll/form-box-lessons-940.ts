/**
 * src/lib/payroll/form-box-lessons-940.ts   (books-47, slice D)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FORM 940 — WHAT A CPA KNOWS ABOUT EVERY LINE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Michael's instruction for this slice, verbatim:
 *
 *   "I want to be able to see the form, and click a box to have it teach me
 *   all there is to know about that box. It should be thorough and verbatim
 *   and plain English explain actions. It should teach me how to read them and
 *   use them as a tool. Everything a cpa would know about these forms, I want
 *   to know to."
 *
 * And the correction that put this form first:
 *
 *   "the majority of the forms I really am interested in are the payroll forms
 *   like 940 941 l&I esd pfml wa cares etc."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE IDEA THAT MAKES THE WHOLE FORM MAKE SENSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Form 940 is a form about a CREDIT, not about a tax.
 *
 * The federal unemployment rate is 6.0% on the first $7,000 you pay each
 * person. Almost nobody pays 6.0%. If you paid your state unemployment tax on
 * time you get a credit of 5.4%, and the 6.0% becomes 0.6%. That is a
 * ten-to-one difference, and it turns entirely on a payment made to
 * Washington rather than on anything paid to the IRS.
 *
 * So the form is built in an unusual order, and knowing the order is what
 * makes it legible:
 *
 *   lines 3-7   work out the WAGE BASE. No tax anywhere yet.
 *   line 8      charges 0.6% — the BEST CASE, assuming the full credit.
 *   lines 9-11  TAKE BACK whatever credit was not actually earned.
 *   line 12     the real tax. Every adjustment only ever ADDS.
 *
 * A Form 940 that stops at line 8 is not finished; it is merely optimistic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SECOND IDEA: NONE OF IT IS YOUR STAFF'S MONEY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Not one cent of FUTA is withheld from an employee. It never appears on a
 * W-2, no employee ever sees it, and withholding it would be unlawful. This
 * is the cleanest example in the whole payroll system of a tax that is purely
 * the employer's cost, which is why the whose-money bar on this form is a
 * solid gold bar across the full width. If it ever shows green, a line has
 * been classified wrongly.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THE QUOTES COME FROM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every quote below is taken from the `GuidanceAuthority` constants in
 * `form-940-authorities.ts` — the SAME objects, not re-typed copies.
 *
 * That matters for two reasons. Rule 25: re-typing them would create a second
 * copy that can drift. Rule 35: those constants are already verified
 * MECHANICALLY by `tests/compliance/form-940-authorities.test.ts`, which reads
 * the mirrored instruction text off disk and asserts every segment appears in
 * it. By building these lessons out of the same objects, the quotes here
 * inherit that proof rather than asking to be trusted.
 *
 * This module is PURE and BROWSER-SAFE. No node:fs, no server-only. The
 * corpus-reading lives in the test file, deliberately, where it cannot reach
 * a browser bundle.
 */

import type { BoxLesson, BoxQuote } from "./form-box-core";
import {
  FORM_940_SOURCE_PATH,
  I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT,
  I940_LINE_12_TOTAL,
  I940_LINE_15B_APPLY_OR_REFUND,
  I940_LINE_15C_ROUTING_NUMBER,
  I940_LINE_15D_ACCOUNT_TYPE,
  I940_LINE_15E_ACCOUNT_NUMBER,
  I940_LINE_17_MUST_EQUAL_12,
  I940_LINE_1A_ONE_STATE,
  I940_LINE_1B_MULTI_STATE,
  I940_LINE_2_CREDIT_REDUCTION_BOX,
  I940_LINE_3_ALL_PAYMENTS,
  I940_LINE_4A_FRINGE_BENEFITS,
  I940_LINE_4B_GROUP_TERM_LIFE,
  I940_LINE_4C_RETIREMENT_PENSION,
  I940_LINE_4D_DEPENDENT_CARE,
  I940_LINE_4E_OTHER_PAYMENTS,
  I940_LINE_5_WAGE_BASE,
  I940_LINE_7_TAXABLE_WAGES,
  I940_LINE_8_BEFORE_ADJUSTMENTS,
  I940_LINE_9_ALL_EXCLUDED,
  I940_ON_TIME_AND_LATE_DEFINED,
  // books-65 - the authorities behind the fifteen boxes that still carried the
  // untaught marker on Michael's screen.
  I940_CREDIT_REDUCTION_STATE,
  I940_DEPOSIT_THRESHOLD,
  I940_EIN_MUST_MATCH_EXACTLY,
  I940_ENTITY_TOP_OF_FORM,
  I940_FOURTH_QUARTER,
  I940_LINE_11_CREDIT_REDUCTION_AMOUNT,
  I940_LINE_13_DEPOSITED,
  I940_LINE_15A_OVERPAYMENT,
  I940_LINE_16D_IS_A_RESIDUAL,
  I940_LINE_16_QUARTERLY_LIABILITY,
  I940_PART5_ONLY_IF_OVER_500,
  I940_LINE_4_EXEMPT_MUST_BE_IN_LINE_3,
  I940_LINE_6_SUBTOTAL,
  I940_PREPARER_MUST_USE_EXACT_NAME,
  I940_BALANCE_DUE_BANDS,
  I940_RATE_AND_CREDIT,
  I940_WHO_MUST_FILE,
} from "./form-940-authorities";

/** Where Michael reads the real thing. */
export const FORM_940_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/i940.pdf";

/**
 * The FUTA wage base, in dollars. Teaching text only.
 *
 * NOT used for any calculation — `form-940-core.ts` owns the arithmetic and
 * applies the cap itself. Held as a named constant so the prose and the
 * worked examples cannot drift apart.
 */
export const FUTA_WAGE_BASE_DOLLARS = 7_000;

/**
 * Turn a verified authority into the quote shape the lesson panel renders.
 *
 * One function, so the mapping cannot be done three different ways in three
 * places, and so the `sourcePath` that the gate checks against can never be
 * mistyped on an individual lesson.
 */
function quoteOf(a: {
  readonly cite: string;
  readonly quote: string;
  readonly soWhat: string;
}): BoxQuote {
  return {
    cite: a.cite,
    quote: a.quote,
    sourcePath: FORM_940_SOURCE_PATH,
    sourceUrl: FORM_940_SOURCE_URL,
    soWhat: a.soWhat,
  };
}

export const FORM_940_LESSONS: readonly BoxLesson[] = [
  {
    formId: "form_940",
    box: "1a",
    headline:
      "Two letters that decide whether you owe a Schedule A",
    plainEnglish:
      "Line 1a holds the postal abbreviation of the ONE state where you had to pay state " +
      "unemployment tax. For Greenway that is WA. It is not an amount and nothing is computed from " +
      "it, but it is the first thing on the form for a reason: it tells the IRS you are a " +
      "single-state employer, and a single-state employer does not file Schedule A.",
    whereItComesFrom:
      "From the fact of where Greenway's employees work and which state agency it pays unemployment " +
      "tax to. Washington's Employment Security Department, so WA. It comes from a decision about " +
      "the business, not from any ledger account.",
    howToReadIt:
      "Read it together with 1b as a pair: exactly one of the two should be filled in. 1a with a " +
      "state code and 1b blank is the simple case. Both filled is a contradiction, and both blank " +
      "means either you paid no state unemployment tax at all — which forces line 9 and loses the " +
      "whole 5.4% credit — or you forgot.",
    commonMistake:
      "Leaving 1a blank because it looks like an optional detail. If 1a and 1b are both empty and " +
      "line 7 is more than zero, the instructions require line 9 to be completed, which multiplies " +
      "the wage base by 5.4% instead of 0.6%. On Greenway's own 2025 figures that is the difference " +
      "between $420 and $3,780.",
    whatToDo:
      "Enter WA on line 1a and leave 1b empty, every year, until the first year an employee " +
      "performs work in another state. Check it before anything else on the form.",
    examples: [
      {
        title: "The Washington-only year",
        steps: [
          "Greenway paid state unemployment tax to Washington ESD and to no other state.",
          "Line 1a: WA.",
          "Line 1b: left blank.",
          "No Schedule A is required.",
        ],
        answer: "WA",
        moral:
          "The answer is two letters, and it is worth as much as the largest credit on the form.",
      },
    ],
    quotes: [quoteOf(I940_LINE_1A_ONE_STATE)],
    tiesTo: [
      {
        formId: "esd_5208a",
        box: "esd-ui",
        why:
          "Line 1a asserts that Washington is the state you paid unemployment tax to, and the ESD " +
          "5208A is that payment. If a quarter's 5208A was never filed, the assertion on line 1a is " +
          "the one that becomes false.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "1b",
    headline:
      "The tickbox that turns a one-page job into a two-form job",
    plainEnglish:
      "Line 1b is a single tickbox meaning \"I owed state unemployment tax in more than one state " +
      "this year\". Ticking it obliges you to fill out Schedule A and attach it. It stays empty for " +
      "Greenway today, and it is worth understanding now rather than the year it first applies.",
    whereItComesFrom:
      "From where work was physically performed, not from where the company is registered and not " +
      "from where an employee happens to live. One employee working a few weeks in Oregon can make " +
      "this box apply.",
    howToReadIt:
      "Treat it as a question about your payroll footprint rather than about tax. If you are paying " +
      "unemployment tax to two agencies, this box is ticked and 1a is blank. There is no partial " +
      "answer — it is either one state or more than one.",
    commonMistake:
      "Ticking 1b and also entering a state on 1a. They are alternatives, not a heading and a " +
      "detail, and filling both tells the IRS two different things about the same year.",
    whatToDo:
      "Leave 1b blank while Greenway pays only Washington. Revisit it the first time an employee " +
      "works outside Washington, and file Schedule A that year.",
    examples: [
      {
        title: "A hypothetical Oregon delivery route",
        steps: [
          "Suppose one employee spent eight weeks working in Oregon.",
          "Greenway would owe unemployment tax to Washington AND Oregon.",
          "Line 1a: left blank. Line 1b: ticked.",
          "Schedule A must be completed and attached.",
        ],
        answer: "ticked",
        moral:
          "The trigger is where the work happened. Nothing about the company's address changes the " +
          "answer.",
      },
    ],
    quotes: [quoteOf(I940_LINE_1B_MULTI_STATE)],
    tiesTo: [
      {
        formId: "form_940",
        box: "1a",
        why:
          "1a and 1b are mutually exclusive. Exactly one of them should be filled in on any given " +
          "return, and checking that pair is a five-second review that catches a whole class of " +
          "error.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "2",
    headline:
      "A tickbox that can cost real money, decided annually by someone else",
    plainEnglish:
      "Line 2 asks whether you paid wages in a state that is subject to CREDIT REDUCTION. A credit " +
      "reduction state is one that borrowed from the federal government to pay unemployment " +
      "benefits and has not repaid it. Employers there lose part of the 5.4% credit and owe more " +
      "federal tax. Ticking line 2 forces Schedule A, and the extra tax it computes lands on line " +
      "11.",
    whereItComesFrom:
      "From the U.S. Department of Labor's list for that specific year, not from Greenway's " +
      "records. The list changes annually, which is why this software asks for the answer instead " +
      "of storing one.",
    howToReadIt:
      "Read line 2 as a warning light rather than a figure. Blank means the full credit survives " +
      "and line 8's 0.6% stands. Ticked means look at line 11, because that is where the cost " +
      "appears. For the 2025 year the credit reduction states were California and the U.S. Virgin " +
      "Islands — Washington was not one.",
    commonMistake:
      "Assuming last year's answer. This is the single most common reason a 940 is amended: a state " +
      "joins or leaves the list, the preparer copies the prior year's form, and the federal tax is " +
      "understated by up to 5.4% of the wage base.",
    whatToDo:
      "Check the Department of Labor's credit reduction list every January before filing, even in a " +
      "year you expect no change. Record the year you checked.",
    examples: [
      {
        title: "Why the answer is not a constant",
        steps: [
          "A state borrows from the federal unemployment account in a recession.",
          "It fails to repay within the statutory window.",
          "The Department of Labor names it a credit reduction state.",
          "Every employer paying wages there ticks line 2 and files Schedule A.",
        ],
        answer: "blank for Washington",
        moral:
          "Nothing Greenway does affects this box. It is decided by a state government and a " +
          "federal department, and it must be looked up rather than remembered.",
      },
    ],
    quotes: [quoteOf(I940_LINE_2_CREDIT_REDUCTION_BOX)],
    tiesTo: [
      {
        formId: "form_940",
        box: "11",
        why:
          "Line 2 is the tickbox and line 11 is the money. If line 2 is ticked, line 11 should " +
          "carry the Schedule A total; if line 2 is blank, line 11 should be blank or zero. One " +
          "filled without the other is a contradiction on the face of the return.",
      },
    ],
  },

  /* ── LINE 3 ─────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "3",
    headline: "Everything you paid everybody, before anything is taken out",
    plainEnglish:
      "Line 3 is the total of all payments you made to all employees during the year. Not the " +
      "taxable part — ALL of it, including amounts that are about to be subtracted on lines 4 " +
      "and 5. It is deliberately the biggest number on the form and you owe nothing on it.",
    whereItComesFrom:
      "Every pay run line in the calendar year, added up by PAY DATE. A cheque dated 2 January " +
      "belongs to the new year even if it pays for work done in December — the same convention " +
      "the Form 941 uses, for the same reason.",
    howToReadIt:
      "Use it as a sanity check against your own books. Line 3 should be close to your total " +
      "gross wages expense for the year. If it is far below, a pay run is missing; if it is far " +
      "above, something that is not payroll has been swept in. It is the cheapest error check " +
      "on the form because you already know roughly what you paid people.",
    commonMistake:
      "Entering only the taxable wages here, because that is what feels relevant. The form wants " +
      "the gross and then does its own subtracting on lines 4 and 5. Entering the net figure " +
      "here and then subtracting again on line 5 takes the same money out twice and understates " +
      "the tax.",
    whatToDo:
      "Compare line 3 against your gross payroll expense for the year. Investigate any difference " +
      "before you look at another line, because every figure below it inherits the error.",
    examples: [
      {
        title: "Two employees, one of them well paid",
        steps: [
          "Joan was paid $44,000 across the year.",
          "Nicholas was paid $6,200 across the year.",
          "Line 3 = $44,000 + $6,200.",
        ],
        answer: "$50,200.00",
        moral:
          "Line 3 does not care that Joan is far above the $7,000 ceiling. The ceiling is applied " +
          "later, on line 5, and applying it early is the commonest way this form goes wrong.",
      },
    ],
    quotes: [quoteOf(I940_LINE_3_ALL_PAYMENTS)],
    tiesTo: [
      {
        formId: "form_941",
        box: "2",
        why:
          "Both are wages paid in the same year, so the four quarters of 941 line 2 should be in " +
          "the same neighbourhood as 940 line 3. They will not match exactly — the definitions of " +
          "taxable wages differ — but a large gap means one of them is wrong.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4a",
    headline:
      "The fringe-benefit category, and the box that touches health premiums",
    plainEnglish:
      "Line 4a is one of five tickboxes under line 4 saying WHICH KIND of exempt payment the line 4 " +
      "amount was. 4a covers fringe benefits: certain meals and lodging, contributions to accident " +
      "or health plans, and benefits excluded under a section 125 cafeteria plan. It is a tick, not " +
      "an amount.",
    whereItComesFrom:
      "From the benefit categories behind whatever total sits on line 4. If line 4 is zero then no " +
      "box under it is ticked at all.",
    howToReadIt:
      "Use the ticks to explain the line 4 total to yourself. Line 4 is a single number, and a year " +
      "later nobody remembers what it was made of — the ticks are the record. If line 4 has an " +
      "amount and no box is ticked, the composition of that subtraction has been lost.",
    commonMistake:
      "Ticking 4a for the employer-paid health premiums on a more-than-2% S-corporation " +
      "shareholder. Those premiums are added to the shareholder's taxable wages, not exempted from " +
      "them, so they belong in line 3 and NOT in line 4. This matters at Greenway specifically, " +
      "because a shareholder health premium already appears in box 1 of a filed W-2 here.",
    whatToDo:
      "Tick 4a only when a real fringe benefit from the IRS list was included in line 3 and is " +
      "being taken back out on line 4. If line 4 is blank, leave every box under it blank.",
    examples: [
      {
        title: "A cafeteria plan deduction",
        steps: [
          "Suppose Greenway ran pre-tax benefit deductions under a section 125 plan.",
          "Those amounts are paid to employees and belong in line 3.",
          "They are exempt from FUTA, so the same amounts come out on line 4.",
          "4a is ticked to record that the exemption was a fringe benefit.",
        ],
        answer: "ticked when line 4 includes a fringe benefit",
        moral:
          "A payment must be IN line 3 before it can come out on line 4. That is the rule the IRS " +
          "states in the line 4 instruction and the one people break.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4A_FRINGE_BENEFITS)],
    tiesTo: [
      {
        formId: "form_w2",
        box: "14",
        why:
          "Box 14 of the W-2 is where Greenway's filed 2025 forms carry a HEALTH entry for a " +
          "shareholder-employee. That amount is taxable wages, which is exactly why it must not be " +
          "swept into line 4 of the 940 as a fringe benefit.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4b",
    headline:
      "Group-term life insurance, exempt from FUTA in full",
    plainEnglish:
      "Line 4b is the tickbox for employer-paid group-term life insurance. It is one of the " +
      "cleanest exemptions on the form: the premiums are wages for some purposes and are not " +
      "reached by FUTA at all.",
    whereItComesFrom:
      "From the payroll register's benefit lines. If Greenway pays group-term life premiums for " +
      "staff, the amount belongs in line 3 and then comes out again on line 4 with this box ticked.",
    howToReadIt:
      "A ticked 4b tells you part of the line 4 subtraction is insurance rather than cash pay. It " +
      "is also a signal about the payroll setup: an employer with group-term life cover has benefit " +
      "accounts that need reconciling to the W-2 as well.",
    commonMistake:
      "Confusing group-term life with the imputed cost of coverage above $50,000, which is taxable " +
      "and reported in W-2 box 12 with code C. The exemption here is not a blanket exemption for " +
      "anything labelled life insurance.",
    whatToDo:
      "Tick 4b when group-term life premiums were included in line 3 and are being removed on line " +
      "4. Leave it blank in a year Greenway pays no such premiums.",
    examples: [
      {
        title: "Reading the tick as documentation",
        steps: [
          "Line 4 shows a single total.",
          "4b is ticked and no other box is.",
          "That total is therefore entirely group-term life insurance.",
          "The figure can be tied straight back to one benefit account.",
        ],
        answer: "ticked when group-term life is in line 4",
        moral:
          "Five tickboxes turn one anonymous subtotal into something auditable a year later.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4B_GROUP_TERM_LIFE)],
    tiesTo: [
      {
        formId: "form_w2",
        box: "12",
        why:
          "Group-term life cover above $50,000 produces an imputed taxable amount reported in W-2 " +
          "box 12 code C. The 940's 4b exemption and that W-2 entry are two different things about " +
          "the same benefit, and reading them together prevents treating taxable cover as exempt.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4c",
    headline:
      "Retirement contributions: the employer's are exempt, the employee's are not",
    plainEnglish:
      "Line 4c is the tickbox for retirement and pension contributions. The distinction inside it " +
      "is the one that matters: the EMPLOYER's contribution to a qualified plan is exempt from " +
      "FUTA, and the employee's own elective salary reduction contribution is not.",
    whereItComesFrom:
      "From the employer-contribution side of any retirement plan Greenway offers, kept separate " +
      "from employee deferrals. Two different accounts, and they are treated oppositely here.",
    howToReadIt:
      "If 4c is ticked, ask immediately whether the amount in line 4 is the employer's contribution " +
      "alone. An employee's 401(k) deferral is still FUTA wages — it reduces income tax " +
      "withholding, not federal unemployment tax.",
    commonMistake:
      "Taking the whole retirement plan total out on line 4. Elective salary reduction " +
      "contributions stay in the FUTA base, so including them understates line 7 and therefore the " +
      "tax on line 8. The IRS states the exclusion in the same sentence as the exemption, and it is " +
      "easy to read past.",
    whatToDo:
      "Split any retirement figure into employer contribution and employee deferral before touching " +
      "line 4. Put only the employer's part there, and tick 4c.",
    examples: [
      {
        title: "A SIMPLE plan with both kinds of contribution",
        steps: [
          "An employee defers part of their own pay into the plan.",
          "Greenway also makes an employer contribution.",
          "Only the employer contribution is exempt from FUTA and goes on line 4.",
          "The employee's deferral remains in the FUTA base.",
        ],
        answer: "employer contribution only",
        moral:
          "The same plan produces one exempt figure and one taxable figure. Treating the plan as a " +
          "single number is how the base gets understated.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4C_RETIREMENT_PENSION)],
    tiesTo: [
      {
        formId: "form_w2",
        box: "12",
        why:
          "Employee elective deferrals are reported in W-2 box 12 with code D and remain in the " +
          "FUTA base. If a box 12 code D amount ever appeared inside 940 line 4, one of the two " +
          "forms is wrong.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4d",
    headline:
      "Dependent care, exempt only up to a hard ceiling",
    plainEnglish:
      "Line 4d is the tickbox for dependent care assistance. It is exempt from FUTA up to $5,000 " +
      "per employee for the year, or $2,500 if the employee is married and files separately. " +
      "Anything above the ceiling is ordinary taxable wages.",
    whereItComesFrom:
      "From a dependent care assistance programme, per employee and per year. The cap is applied to " +
      "each person separately, not to the company total.",
    howToReadIt:
      "A ticked 4d should prompt one arithmetic check: is any single employee's dependent care " +
      "above $5,000? This is one of very few line 4 categories with a number inside it, so it is " +
      "one of the few that can be partly exempt — the first $5,000 out, the rest left in.",
    commonMistake:
      "Applying the $5,000 cap to the total across all employees rather than per employee, or " +
      "forgetting the $2,500 halving for married-filing-separately. Both produce a line 4 that is " +
      "too large and a tax that is too small.",
    whatToDo:
      "Cap dependent care at $5,000 per employee before it reaches line 4, and check filing status " +
      "for anyone claiming near the ceiling.",
    examples: [
      {
        title: "One employee above the ceiling",
        steps: [
          "Suppose an employee received $6,200 of dependent care assistance.",
          "The first $5,000 is exempt from FUTA and belongs on line 4.",
          "The remaining $1,200 stays in the FUTA base as ordinary wages.",
          "4d is ticked for the exempt portion only.",
        ],
        answer: "$5,000 exempt, $1,200 taxable",
        moral:
          "A category with a ceiling is never all-or-nothing. Splitting at the cap is the whole " +
          "job.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4D_DEPENDENT_CARE)],
    tiesTo: [
      {
        formId: "form_w2",
        box: "10",
        why:
          "W-2 box 10 reports dependent care benefits, and amounts above the exclusion are carried " +
          "into taxable wages in box 1. Box 10 and 940 line 4 should tell the same story about the " +
          "same programme.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4e",
    headline:
      "The catch-all category, which is not a catch-all for convenience",
    plainEnglish:
      "Line 4e is the last of the five tickboxes and covers the IRS's \"other payments\" list: " +
      "certain agricultural labour payments, payments to H-2A visa workers, workers' compensation " +
      "payments made because of a work-related injury, and some domestic service payments. It is a " +
      "specific list, not a miscellaneous bucket.",
    whereItComesFrom:
      "From the IRS's enumerated categories in the line 4 instructions. If a payment is not on one " +
      "of the five lists, it is not exempt and does not belong on line 4 at all.",
    howToReadIt:
      "Treat a ticked 4e as the one that needs the most support. 4a to 4d name a recognisable kind " +
      "of benefit; 4e means \"something else the IRS allows\", and a year later that is the hardest " +
      "to reconstruct. For Greenway the realistic reading is that 4e stays blank — a retail " +
      "cannabis shop has no agricultural labour or H-2A workers.",
    commonMistake:
      "Using 4e as a home for anything that seemed non-taxable. The word \"other\" invites it, and " +
      "the effect is a subtraction from the FUTA base with no authority behind it, which " +
      "understates the tax and is indefensible on audit.",
    whatToDo:
      "Leave 4e blank unless a payment matches a category the IRS actually lists, and write down " +
      "which category it was. If it does not match, do not put the amount on line 4.",
    examples: [
      {
        title: "Workers' compensation, which really is exempt",
        steps: [
          "An injured employee receives payments under a workers' compensation law.",
          "Those payments are on the IRS's other-payments list.",
          "They are exempt from FUTA and belong on line 4 with 4e ticked.",
          "An ordinary bonus, by contrast, is on no list and stays in the base.",
        ],
        answer: "ticked only for a listed category",
        moral:
          "The test is whether the IRS names it, not whether it feels like a payment that should " +
          "not be taxed.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4E_OTHER_PAYMENTS)],
    tiesTo: [
      {
        formId: "lni_quarterly",
        box: "lni-hours",
        why:
          "Workers' compensation payments are exempt from FUTA under 4e, and the L&I quarterly " +
          "return is where Greenway's workers' compensation obligation is reported. The same injury " +
          "touches both forms in opposite directions.",
      },
    ],
  },

  /* ── LINE 5 ─────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "5",
    headline: "The money above $7,000 a head, which FUTA does not touch",
    plainEnglish:
      `FUTA is charged on the first $${FUTA_WAGE_BASE_DOLLARS.toLocaleString("en-US")} you pay ` +
      "each person in the year, and nothing after that. Line 5 asks for the EXCESS — the part " +
      "above the ceiling — so the form can subtract it. It is not the taxable amount. It is the " +
      "amount that is NOT taxable.",
    whereItComesFrom:
      "Computed per person, never on the total. Each employee's payments are capped separately " +
      "and the amounts above each cap are added together.",
    howToReadIt:
      "A large line 5 means most of your payroll is above the ceiling, which means your FUTA bill " +
      "is nearly fixed regardless of raises — it is roughly $42 a head per year at the 0.6% rate. " +
      "That is genuinely useful for budgeting: FUTA is a headcount tax far more than a wages tax.",
    commonMistake:
      "Reading line 5 as 'wages subject to FUTA' and entering the capped figure instead of the " +
      "excess. It is the single most common way this form is filled in wrong. The two are " +
      "opposites, and getting them the wrong way round on a payroll of any size produces a tax " +
      "that is wildly too high or too low.",
    whatToDo:
      "Check one employee by hand. Take somebody paid well above the ceiling, subtract $7,000 " +
      "from their total, and confirm their contribution to line 5 is what is left over — not the " +
      "$7,000 itself.",
    examples: [
      {
        title: "Why the cap is per person and never on the total",
        steps: [
          "Joan was paid $44,000. Her first $7,000 is taxable, so her excess is $44,000 − $7,000 = $37,000.",
          "Nicholas was paid $6,200, which is below the ceiling, so his excess is $0.",
          "Line 5 = $37,000 + $0.",
          "Line 7 (taxable wages) = line 3 $50,200 − line 5 $37,000 = $13,200.",
          "Check it the other way: Joan's $7,000 + Nicholas's $6,200 = $13,200.",
        ],
        answer: "$37,000.00",
        moral:
          "Capping the TOTAL instead of each person would have given $50,200 − $7,000 = $43,200 " +
          "of excess and only $7,000 of taxable wages — barely half the real figure. The two " +
          "routes to $13,200 agreeing is the check worth doing.",
      },
    ],
    quotes: [quoteOf(I940_LINE_5_WAGE_BASE)],
    tiesTo: [
      {
        formId: "form_940",
        box: "7",
        why:
          "Line 7 is line 3 minus lines 4 and 5. If line 5 holds the capped wages instead of the " +
          "excess, line 7 becomes nonsense and every figure below it follows.",
      },
    ],
  },

  /* ── LINE 7 ─────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "7",
    headline: "The wages FUTA is actually charged on",
    plainEnglish:
      "Line 7 is what is left after the exempt payments on line 4 and the above-the-ceiling money " +
      "on line 5 have been taken out of line 3. This is the base the tax is computed on. It is " +
      "still not a tax — nobody owes line 7.",
    whereItComesFrom:
      "Line 3 minus line 6, where line 6 is lines 4 and 5 added together. Pure subtraction; the " +
      "engine shows the arithmetic on the Form tab.",
    howToReadIt:
      "Line 7 divided by $7,000 tells you, roughly, how many people you employed for long enough " +
      "to exhaust the ceiling. That is a headcount cross-check you can do in your head, and it " +
      "should agree with what you know about the year.",
    commonMistake:
      "Expecting line 7 to match a figure from the 941 or the W-3. It will not, and it should " +
      "not: FUTA has a $7,000 ceiling that no other payroll tax shares. A preparer who forces " +
      "them to agree has broken the return to fix a difference that was correct.",
    whatToDo:
      "Divide line 7 by 7,000 and sanity-check the answer against your headcount. Then stop " +
      "comparing it to other forms.",
    examples: [
      {
        title: "Reading line 7 as a headcount",
        steps: [
          "Line 7 = $13,200.",
          "$13,200 ÷ $7,000 = 1.89.",
          "So the year is equivalent to about 1.9 people who fully exhausted the ceiling.",
        ],
        answer: "$13,200.00",
        moral:
          "With one full-year employee and one part-year employee, 1.9 is exactly what you would " +
          "expect. A figure of 6 when you employed two people means something is wrong.",
      },
    ],
    quotes: [quoteOf(I940_LINE_7_TAXABLE_WAGES)],
    tiesTo: [
      {
        formId: "form_940",
        box: "8",
        why: "Line 8 is line 7 multiplied by 0.006. If line 7 is wrong, the tax is wrong.",
      },
    ],
  },

  /* ── LINE 8 ─────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "8",
    headline: "The best case: 0.6%, assuming you earned the whole credit",
    plainEnglish:
      "Line 8 charges FUTA at 0.6% of line 7. But the real federal rate is 6.0%. The form uses " +
      "0.6% here because it OPTIMISTICALLY assumes you earned the full 5.4% state credit, and " +
      "then lines 9, 10 and 11 take back whatever you did not actually earn.",
    whereItComesFrom:
      "Line 7 × 0.006, computed by the engine. Nothing about your state payments has been " +
      "considered yet.",
    howToReadIt:
      "Read line 8 as a floor, not an answer. It is the least you can owe. If lines 9, 10 and 11 " +
      "are all empty then line 8 is also the most you owe, and the two coincide — which is the " +
      "normal, well-run outcome and the one to aim for.",
    commonMistake:
      "Treating line 8 as the tax and stopping. On a return where the state tax was paid late, " +
      "line 10 adds to it; on a return where wages were excluded from state tax, line 9 multiplies " +
      "it by ten. A 940 that stops at line 8 is not finished, it is merely optimistic.",
    whatToDo:
      "Look immediately at lines 9, 10 and 11. If all three are blank, line 8 equals line 12 and " +
      "you are done. If any of them has a figure, read its lesson before you file.",
    examples: [
      {
        title: "The ten-to-one difference the credit makes",
        steps: [
          "Taxable FUTA wages (line 7) = $13,200.",
          "Line 8 at the after-credit rate: $13,200 × 0.006 = $79.20.",
          "The same wages at the full statutory rate: $13,200 × 0.060 = $792.00.",
          "The difference: $792.00 − $79.20 = $712.80.",
        ],
        answer: "$79.20",
        moral:
          "The state unemployment credit is worth $712.80 on this tiny payroll, and it is earned " +
          "by paying Washington on time. That is the highest-value routine task in the whole " +
          "payroll year, and it is done at the state, not the federal, level.",
      },
    ],
    quotes: [quoteOf(I940_LINE_8_BEFORE_ADJUSTMENTS), quoteOf(I940_RATE_AND_CREDIT)],
    tiesTo: [
      {
        formId: "form_940",
        box: "12",
        why:
          "Line 12 is lines 8, 9, 10 and 11 added. When 9, 10 and 11 are blank, line 12 equals " +
          "line 8 exactly, and that equality is worth confirming every year.",
      },
    ],
  },

  /* ── LINE 9 ─────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "9",
    headline: "The full 6% branch — and the trap that costs ten times the tax",
    plainEnglish:
      "Line 9 applies when ALL of your FUTA wages were excluded from state unemployment tax. In " +
      "that case you earned no credit at all, so line 9 adds back the whole 5.4% and you pay the " +
      "full 6.0%. For Greenway this line should always be blank.",
    whereItComesFrom:
      "Only from an explicit statement that employees' wages were excluded from state " +
      "unemployment tax. Nothing infers it, and the engine refuses rather than assuming 'no'.",
    howToReadIt:
      "A figure on line 9 means your federal unemployment tax just went up roughly tenfold. It is " +
      "the single most expensive box on the form, so treat any number here as something to prove " +
      "rather than something to accept.",
    commonMistake:
      "Confusing 'I paid Washington nothing because my experience rate was 0%' with 'my wages " +
      "were excluded from state tax'. They are completely different. A 0% experience rate still " +
      "earns you the FULL credit — the instructions say so explicitly. Ticking line 9 because " +
      "no money changed hands would multiply Greenway's federal unemployment tax by ten.",
    whatToDo:
      "Leave line 9 blank unless Washington has told you in writing that your employees' wages " +
      "are not subject to state unemployment tax. If line 9 has a figure, lines 10 and 11 must " +
      "both be empty — the form says so, and they describe situations that cannot both be true.",
    examples: [
      {
        title: "A 0% experience rate is not an exclusion",
        steps: [
          "Suppose Washington assigns a 0% experience rate, so no contribution is payable.",
          "The wages are still SUBJECT to state unemployment tax; the rate on them is simply zero.",
          "So the full 5.4% credit is earned and line 9 stays blank.",
          "Tax stays at line 8: $13,200 × 0.006 = $79.20.",
          "Had line 9 been ticked in error: $13,200 × 0.060 = $792.00.",
        ],
        answer: "blank",
        moral:
          "The distinction between 'taxed at zero' and 'not taxed' is worth $712.80 on this " +
          "payroll. It is a legal distinction, not an accounting one, and it is why the engine " +
          "refuses to guess.",
      },
    ],
    quotes: [quoteOf(I940_LINE_9_ALL_EXCLUDED)],
    tiesTo: [
      {
        formId: "form_940",
        box: "10",
        why:
          "Mutually exclusive with line 9. If line 9 is greater than zero, lines 10 and 11 must " +
          "be zero, because they describe circumstances that cannot both hold.",
      },
    ],
  },

  /* ── LINE 10 ────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "10",
    headline: "The price of paying Washington late",
    plainEnglish:
      "Line 10 is where credit is clawed back because some of your state unemployment tax was " +
      "paid after the Form 940 due date. Late money still earns credit, but only 90 cents on the " +
      "dollar. Money never paid at all earns nothing.",
    whereItComesFrom:
      "The worksheet in the instructions, driven by how much state tax was paid on time, how much " +
      "late, and the experience rate assigned. The worksheet is NOT filed — it is kept with your " +
      "records — but its answer lands here.",
    howToReadIt:
      "Line 10 is a scoreboard for one habit: paying the state on time. It is entirely avoidable " +
      "and it is the only line on the form you can reduce to zero purely by being organised.",
    commonMistake:
      "Measuring 'on time' against the STATE's deadline. The test is the FORM 940 due date — the " +
      "following 31 January — not Washington's quarterly deadline. A payment can be late for " +
      "Washington, attract state penalties, and still count as on time for this credit, which " +
      "surprises people in both directions.",
    whatToDo:
      "Before filing, list your four state unemployment payments with their dates and mark each " +
      "one against the Form 940 due date. That list is the worksheet input, and it is the only " +
      "way to fill line 10 in honestly.",
    examples: [
      {
        title: "What ten percent actually costs",
        steps: [
          "Suppose $2,000 of state unemployment contributions were paid after the 940 due date.",
          "Late payments earn 90% of the credit: $2,000 × 0.90 = $1,800 of credit survives.",
          "The credit lost is $2,000 − $1,800 = $200.",
          "That $200 is added to the federal tax through line 10.",
        ],
        answer: "$200.00",
        moral:
          "Ten percent of the late amount, not ten percent of the tax. Paying Washington a week " +
          "late costs real federal money on top of anything the state charges.",
      },
    ],
    quotes: [
      quoteOf(I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT),
      quoteOf(I940_ON_TIME_AND_LATE_DEFINED),
    ],
    tiesTo: [
      {
        formId: "esd_5208a",
        box: "esd-ui",
        why:
          "The state unemployment contributions prepared on the Washington quarterly screen are " +
          "the payments this credit depends on. Line 10 is the federal consequence of what " +
          "happened over there.",
      },
    ],
  },

  /* ── LINE 12 ────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "12",
    headline: "Your real federal unemployment tax for the year",
    plainEnglish:
      "Line 12 adds lines 8, 9, 10 and 11. Every adjustment on this form only ever ADDS — there " +
      "is no line that reduces the tax below line 8. So line 12 is the true annual FUTA cost, " +
      "and line 8 is the floor it could not go below.",
    whereItComesFrom:
      "Pure addition of four lines above it, computed by the engine.",
    howToReadIt:
      "Compare line 12 with line 8. If they are equal, you earned the full state credit and the " +
      "year was clean. Any gap is the cost of something that went wrong at the state level, and " +
      "the size of the gap tells you how much that habit cost.",
    commonMistake:
      "Filing with a figure on line 9 AND figures on lines 10 or 11. The instructions carry an " +
      "explicit caution: if line 9 is greater than zero, lines 10 and 11 must be zero. They " +
      "describe mutually exclusive situations and having both is a contradiction the IRS will see.",
    whatToDo:
      "Check line 12 against line 8 and understand any difference before filing. Then check line " +
      "12 against line 17 — the four quarters of Part 5 must add to exactly this figure.",
    examples: [
      {
        title: "A clean year and a late year, side by side",
        steps: [
          "Clean year: line 8 $79.20, lines 9-11 blank. Line 12 = $79.20.",
          "Late year: line 8 $79.20, line 10 $200.00, lines 9 and 11 blank. Line 12 = $279.20.",
          "The difference: $279.20 − $79.20 = $200.00.",
        ],
        answer: "$79.20 clean, $279.20 late",
        moral:
          "The tax more than tripled on identical wages. Nothing about the payroll changed — only " +
          "the date a state payment cleared.",
      },
      {
        title: "Greenway's own figure, added up line by line",
        steps: [
          "Line 8 (0.6% of the $13,200 taxable base) = $79.20.",
          "Line 9 is blank: Greenway's wages were not excluded from Washington's state tax.",
          "Line 10 is blank: the state unemployment tax was paid on time.",
          "Line 11 is blank: Washington is not a credit reduction state.",
          "Line 12 = $79.20 + nothing + nothing + nothing.",
        ],
        answer: "$79.20",
        moral:
          "When lines 9, 10 and 11 are all blank, line 12 equals line 8 and you have paid the " +
          "lowest federal unemployment tax the law allows. That is the target every year, and it " +
          "is won entirely by paying Washington on time.",
      },
    ],
    quotes: [quoteOf(I940_LINE_12_TOTAL)],
    tiesTo: [
      {
        formId: "form_940",
        box: "17",
        why:
          "Part 5 splits the year's liability across four quarters. Line 17 is those four added " +
          "up and it must equal line 12 to the cent. A mismatch is an arithmetic error the IRS " +
          "checks automatically.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "15b",
    headline:
      "Overpaid: carry it forward, or take it back",
    plainEnglish:
      "Line 15b appears only when line 15a shows an overpayment. It is a choice between applying " +
      "the money to next year's return and having it refunded. Check exactly one box. Check both, " +
      "or neither, and the IRS applies it to the next return by default.",
    whereItComesFrom:
      "From the comparison the form already made: line 13 deposits against line 12 tax. If 13 " +
      "exceeds 12, the difference is on 15a and this choice becomes live.",
    howToReadIt:
      "For a tax as small as FUTA usually is, applying it forward is almost always less work than a " +
      "refund — a refund needs bank details on 15c to 15e and creates a payment to reconcile. But " +
      "note the sentence about past-due accounts: whatever you tick, the IRS may take the " +
      "overpayment against any other liability under the same EIN, so an expected refund is not a " +
      "certainty.",
    commonMistake:
      "Ticking the refund box and leaving 15c to 15e empty. The instructions say plainly that the " +
      "refund may then be delayed, because there is nowhere to send it.",
    whatToDo:
      "Tick one box only. Choose \"apply to next return\" unless Greenway actually needs the cash, " +
      "and if you choose a refund, complete 15c, 15d and 15e in the same sitting.",
    examples: [
      {
        title: "A small overpayment on a small tax",
        steps: [
          "Line 12 shows the year's FUTA tax.",
          "Line 13 shows deposits that came to more than the tax.",
          "The difference lands on line 15a.",
          "Line 15b decides where it goes; ticking neither box sends it forward anyway.",
        ],
        answer: "one box, never two",
        moral:
          "The default is not neutral. Not choosing IS choosing to carry it forward.",
      },
    ],
    quotes: [quoteOf(I940_LINE_15B_APPLY_OR_REFUND)],
    tiesTo: [
      {
        formId: "form_941",
        box: "15b",
        why:
          "The 941 carries the identical choice with the identical default, and the wording is " +
          "nearly the same. Learning it once covers both forms, which is the payoff for reading the " +
          "pair together.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "15c",
    headline:
      "A bank routing number, with a validity check you can run yourself",
    plainEnglish:
      "Line 15c is the nine-digit routing number of the account a refund should be sent to. It is " +
      "used only when line 15b asked for a refund. Direct deposit of a Form 940 refund is new for " +
      "the 2025 revision of the form.",
    whereItComesFrom:
      "From the bank, and specifically from the bank's own advice rather than from a cheque. The " +
      "instructions warn that the number on a deposit slip can differ from the number on your " +
      "cheques, and that some cheques are payable through a different institution entirely.",
    howToReadIt:
      "Run the free check the IRS gives you: nine digits, and the first two must fall in 01 to 12 " +
      "or 21 to 32. Anything else is not a valid routing number and the deposit will fail. This is " +
      "a figure to verify before filing, not after — a rejected direct deposit becomes a paper " +
      "cheque and weeks of delay.",
    commonMistake:
      "Reading the routing number off a cheque for a savings account, or off a deposit slip. Both " +
      "are named in the instructions as sources that are commonly wrong.",
    whatToDo:
      "Ask the bank for the routing number to use for a direct deposit, confirm the first two " +
      "digits are in range, and leave 15c blank whenever no refund was requested.",
    examples: [
      {
        title: "The two-digit range check",
        steps: [
          "Count the digits: there must be exactly nine.",
          "Read the first two digits.",
          "They must be 01 through 12, or 21 through 32.",
          "If they are not, the number is not a routing number.",
        ],
        answer: "nine digits, first two in range",
        moral:
          "The IRS printed a validation rule in the instructions. Using it costs seconds and " +
          "prevents a failed refund.",
      },
    ],
    quotes: [quoteOf(I940_LINE_15C_ROUTING_NUMBER)],
    tiesTo: [
      {
        formId: "form_941",
        box: "15c",
        why:
          "The 941 carries the same routing-number box with the same nine-digit rule and the same " +
          "first-two-digit range. The bank details for both forms should be identical, and a " +
          "difference between them is a mistake on one of the two.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "15d",
    headline:
      "Checking or savings: one box, and getting it wrong kills the deposit",
    plainEnglish:
      "Line 15d is a tickbox for the type of account named on 15c and 15e. Check the correct one " +
      "and only one. The instructions are unusually blunt about why: the deposit is accepted or " +
      "rejected on the strength of it.",
    whereItComesFrom:
      "From the account itself. If there is any doubt about how the bank classifies the account, " +
      "the instructions say to ask the bank rather than guess.",
    howToReadIt:
      "Read it as part of a set with 15c and 15e. Either all three are completed because a refund " +
      "was requested, or all three are empty. One or two of the three filled in is always an error.",
    commonMistake:
      "Ticking both boxes to be safe, or assuming a business account is a checking account because " +
      "that is what most are. Both produce a rejected deposit and a paper cheque.",
    whatToDo:
      "Tick exactly one box, and ask the bank if the account type is not certain. Leave it blank " +
      "when no refund was requested.",
    examples: [
      {
        title: "The all-or-nothing set",
        steps: [
          "Line 15b asks for a refund.",
          "15c gets the routing number, 15d the account type, 15e the account number.",
          "If 15b does not ask for a refund, all three stay empty.",
          "A partly completed set is always wrong.",
        ],
        answer: "one box, or none at all",
        moral:
          "Three boxes that only make sense together are best checked together.",
      },
    ],
    quotes: [quoteOf(I940_LINE_15D_ACCOUNT_TYPE)],
    tiesTo: [
      {
        formId: "form_941",
        box: "15d",
        why:
          "The same tickbox exists on the 941 with the same consequence for a wrong answer. Both " +
          "forms should point at the same account, so both should tick the same type.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "15e",
    headline:
      "The account number, and the formatting rules that are easy to break",
    plainEnglish:
      "Line 15e is the bank account number for a refund, used only when line 15b asked for one. Up " +
      "to seventeen characters, letters allowed as well as numbers. Include hyphens but leave out " +
      "spaces and special symbols, and write it from left to right, leaving any unused boxes empty.",
    whereItComesFrom:
      "From the bank. Like 15c this is a credential rather than an accounting figure, which is why " +
      "the teaching screen shows no specimen value for it.",
    howToReadIt:
      "The formatting instructions are the substance here. Left-to-right with trailing boxes blank " +
      "is the opposite of how amounts are entered on this form, where figures are right-aligned — " +
      "which is exactly why it is worth reading twice.",
    commonMistake:
      "Right-aligning the account number the way every dollar figure on the form is aligned, or " +
      "copying spaces and symbols out of a bank statement. Either can send the refund to the wrong " +
      "account or cause the deposit to be rejected.",
    whatToDo:
      "Enter the account number from the left, keep hyphens, drop spaces and symbols, and leave 15e " +
      "blank unless a refund was actually requested.",
    examples: [
      {
        title: "Why the alignment rule is worth noticing",
        steps: [
          "Every money box on this form is filled from the right.",
          "The account number is filled from the LEFT.",
          "Unused boxes at the end are left blank.",
          "Hyphens stay; spaces and symbols are omitted.",
        ],
        answer: "left to right, unused boxes blank",
        moral:
          "One field on the form follows the opposite convention to all the others, and the " +
          "instructions say so explicitly.",
      },
    ],
    quotes: [quoteOf(I940_LINE_15E_ACCOUNT_NUMBER)],
    tiesTo: [
      {
        formId: "form_941",
        box: "15e",
        why:
          "The 941 has the identical box with the identical seventeen-character and left-to-right " +
          "rules. If Greenway ever requests refunds on both forms, the account details should match " +
          "exactly.",
      },
    ],
  },

  /* ── LINE 17 ────────────────────────────────────────────────────────── */
  {
    formId: "form_940",
    box: "17",
    headline: "The four quarters, which must add to the year exactly",
    plainEnglish:
      "Part 5 asks you to split the year's FUTA liability across the four quarters in which it " +
      "was INCURRED — not deposited. Line 17 is those four figures added together, and it must " +
      "equal line 12 exactly.",
    whereItComesFrom:
      "The quarterly liability figures you supply. The engine adds them; it does not invent the " +
      "split, because the split depends on when each person crossed the $7,000 ceiling.",
    howToReadIt:
      "Expect the first quarter to be by far the largest. The $7,000 ceiling is exhausted early " +
      "in the year for anyone working full time, so most of the annual FUTA is incurred in " +
      "January to March and the fourth quarter is often zero. A flat split across four quarters " +
      "is a sign the figures were estimated rather than computed.",
    commonMistake:
      "Entering deposits instead of liability. Part 5 asks what you INCURRED each quarter, not " +
      "what you paid. They differ whenever a deposit is made in the quarter after the one that " +
      "generated it, which is normal.",
    whatToDo:
      "Add the four quarters yourself and confirm the total equals line 12 to the cent. If it " +
      "does not, the quarterly split is wrong — line 12 is computed and the quarters are supplied, " +
      "so the quarters are the ones to fix.",
    examples: [
      {
        title: "Why Q1 carries almost everything",
        steps: [
          "Total FUTA for the year (line 12) = $79.20.",
          "Joan crosses $7,000 in February, so her whole $42.00 is incurred in Q1.",
          "Nicholas earns $6,200 spread evenly, incurring roughly $9.30 a quarter.",
          "Q1 ≈ $42.00 + $9.30 = $51.30; Q2, Q3, Q4 ≈ $9.30 each.",
          "Line 17 = $51.30 + $9.30 + $9.30 + $9.30 = $79.20.",
        ],
        answer: "$79.20",
        moral:
          "The front-loading is not an error, it is what the ceiling does. And the check is " +
          "absolute: line 17 must equal line 12 to the cent, every year, without exception.",
      },
    ],
    quotes: [quoteOf(I940_LINE_17_MUST_EQUAL_12)],
    tiesTo: [
      {
        formId: "form_940",
        box: "12",
        why: "Line 17 must equal line 12 exactly. This is the form's own internal arithmetic check.",
      },
    ],
  },
  /* ═══════════════════════════════════════════════════════════════════════
   * books-65 — THE FIFTEEN BOXES THAT STILL CARRIED THE MARKER
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Michael: "the boxes that dont have lessons, the boxes look like there is a
   * red squiggly line in it, but id rather they just open a box that says in
   * plain english what it is and why it doesn't need a lesson." And: "on the
   * 941 schedule b, every single box opens with an explanation. this is the
   * level of thoroughness i want."
   *
   * He asked for a second kind of panel. He does not need one: every box still
   * marked untaught had real instruction text sitting in the mirrored corpus,
   * so none of them was a box that needs no lesson — they were boxes nobody
   * had written. The marker is removed by removing its cause.
   *
   * The five identifier boxes at the top of the page are here for a second
   * reason as well. They are the boxes D-15 was hiding: until books-65 the
   * teaching specimen had no box carrying the ids `ein`, `name`, `tradeName`,
   * `address` or `cityStateZip`, so Michael's company profile — correctly
   * stored, green ticks and all — had nowhere on the paper to print.
   * ═══════════════════════════════════════════════════════════════════════ */

  {
    formId: "form_940",
    box: "ein",
    headline: "The nine digits the whole federal year hangs on \u2014 46-4217016",
    plainEnglish:
      "Greenway's Employer Identification Number, the federal account number for the business. " +
      "Form 940 asks for it at the top of page 1 and again at the top of page 2, and both must be " +
      "filled in. It is the number the IRS uses to match this annual return against the four " +
      "quarterly 941s and against the W-3, and it is the number ESD's records must agree with for " +
      "the FUTA credit on line 9 through 11 to hold up.",
    whereItComesFrom:
      "The company profile in Accounting \u2192 Company Info. Stored once for the entity and printed " +
      "on every form that asks. It is never typed onto a form here, deliberately: a number " +
      "entered once cannot be right on the 940 and wrong on the W-3.",
    howToReadIt:
      "Read it as the join key. Michael runs four entities, which means four EINs, and the risk " +
      "is not mistyping a digit \u2014 it is filing an entirely valid EIN that belongs to the wrong " +
      "company. Check the printed number is the one whose payroll this return reports.",
    commonMistake:
      "Using an SSN, an ITIN, or another entity's EIN. Each is a penalty in its own right rather " +
      "than an arithmetic error, and an electronically filed return with an invalid EIN is " +
      "rejected outright.",
    whatToDo:
      "Compare the printed EIN against the IRS confirmation letter for THIS entity, not against " +
      "memory. If it is wrong, correct Company Info; never correct it on the form.",
    examples: [
      {
        title: "Four entities, four EINs",
        steps: [
          "Greenway's payroll runs under LYMAN'S MARIJUANA L.L.C., EIN 46-4217016.",
          "The other three entities have their own EINs and their own filings.",
          "This Form 940 reports Greenway's FUTA wages, so 46-4217016 is the only correct number here.",
          "An EIN from a sibling entity would be a valid number attached to the wrong wages \u2014 the " +
            "hardest kind of error to spot, because nothing about it looks malformed.",
        ],
        answer: "46-4217016",
        moral:
          "With more than one entity, the danger is not a typo. It is a perfectly good EIN in the " +
          "wrong place.",
      },
    ],
    quotes: [quoteOf(I940_EIN_MUST_MATCH_EXACTLY)],
    tiesTo: [
      {
        formId: "form_941",
        box: "ein",
        why: "The same nine digits. The IRS matches this annual return to the four quarterly ones by this number.",
      },
      {
        formId: "form_w3",
        box: "e",
        why: "The W-3 carries the same EIN for the same year, and the year-end reconciliation depends on them agreeing.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "name",
    headline: "The legal name \u2014 the one on the SS-4, not the one on the sign",
    plainEnglish:
      "The business's legal name as given to the IRS on Form SS-4 when the EIN was applied for. " +
      "For Greenway that is LYMAN'S MARIJUANA L.L.C. \u2014 not what the shop is called and not what " +
      "customers know. The instructions are explicit: this line takes the name used on the EIN " +
      "application, and the trading name goes on the line below it.",
    whereItComesFrom:
      "The legal name field of the company profile, printed identically on page 1 and page 2 of " +
      "this return, on the 941s and on the W-3, because all of them ask the same question.",
    howToReadIt:
      "Read it as a matching exercise, not a description. The only question is whether these " +
      "characters are the ones in the IRS's file. A missing apostrophe or an \u201CLLC\u201D written where " +
      "the file says \u201CL.L.C.\u201D is enough to make an automated match fail, and a failed match " +
      "delays processing without announcing itself.",
    commonMistake:
      "Entering the trading name because it is the name everyone uses. The two lines exist so the " +
      "business can be IDENTIFIED by its legal name and RECOGNISED by its trading name, and " +
      "swapping them is the most common identifier error on the form.",
    whatToDo:
      "Check the printed name character for character against the EIN confirmation letter. If the " +
      "legal name has genuinely changed, write to the IRS office where the returns are filed \u2014 a " +
      "return cannot communicate a name change on its own.",
    examples: [
      {
        title: "Which name goes on which line",
        steps: [
          "Legal name on the SS-4: LYMAN'S MARIJUANA L.L.C.",
          "Trading name on the door: GREENWAY MARIJUANA.",
          "The Name line takes LYMAN'S MARIJUANA L.L.C.",
          "The Trade Name line takes GREENWAY MARIJUANA.",
          "The IRS's own example in the instructions is the identical shape: Ronald Smith on Name, " +
            "Ron's Cycles on Trade Name.",
        ],
        answer: "LYMAN'S MARIJUANA L.L.C.",
        moral:
          "The IRS wrote a worked example for this because it is the line people get wrong.",
      },
    ],
    quotes: [quoteOf(I940_ENTITY_TOP_OF_FORM), quoteOf(I940_PREPARER_MUST_USE_EXACT_NAME)],
    tiesTo: [
      {
        formId: "form_940",
        box: "tradeName",
        why: "The two are defined against each other: the trade name is blank precisely when it would repeat the legal name.",
      },
      {
        formId: "form_941",
        box: "name",
        why: "The same legal name appears on all four quarterly returns. A difference between them and this one is a mismatch the IRS can see.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "tradeName",
    headline: "The name on the door \u2014 and the rule about leaving it blank",
    plainEnglish:
      "The name Greenway actually trades under: GREENWAY MARIJUANA. It is here so a person can " +
      "recognise the business while the filing still happens under the legal name. The " +
      "instructions add a rule that surprises people \u2014 if the trade name is the same as the legal " +
      "name, this line is left BLANK rather than repeated.",
    whereItComesFrom:
      "The trade name field of the company profile. Greenway's differs from its legal name, so " +
      "the line prints rather than staying empty.",
    howToReadIt:
      "It carries no tax consequence of its own. What it carries is recognition: with four " +
      "entities' forms on one desk, the trade name is what tells a human at a glance which " +
      "company a page belongs to. That is worth having right even though nothing computes from it.",
    commonMistake:
      "Repeating the legal name here when there is no separate trading name. The instructions say " +
      "to leave it blank, and a duplicated name makes automated matching harder for no benefit.",
    whatToDo:
      "Confirm the printed trade name matches the name on the State's UBI record. If the business " +
      "ever trades under a single name, clear the field in Company Info rather than duplicating " +
      "the legal name.",
    examples: [
      {
        title: "When the line correctly prints nothing",
        steps: [
          "A company whose legal and trading names are both \u201CAcme Holdings LLC\u201D.",
          "The instruction: leave the Trade Name line blank if it is the same as your Name.",
          "So the line prints nothing \u2014 and blank is the correct entry, not an omission.",
          "Greenway is the opposite case: two genuinely different names, so both lines print.",
        ],
        answer: "GREENWAY MARIJUANA",
        moral:
          "An empty box on a tax form is sometimes the instruction rather than an oversight. This " +
          "is one of the few places the IRS says so outright.",
      },
    ],
    quotes: [quoteOf(I940_ENTITY_TOP_OF_FORM)],
    tiesTo: [
      {
        formId: "form_940",
        box: "name",
        why: "The pair. Each is defined by reference to the other, and the blank rule only makes sense with both in view.",
      },
      {
        formId: "form_941",
        box: "tradeName",
        why: "The same trade name prints on the quarterly returns. They should not disagree.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "address",
    headline: "Where the IRS writes to \u2014 and why a return cannot change it",
    plainEnglish:
      "The street address of the business: 4851 GEIGER RD SE. Every notice and every refund the " +
      "IRS sends about federal unemployment tax goes to the address it holds on file. Printing an " +
      "address on this return does NOT update that file, and that is the part worth knowing.",
    whereItComesFrom:
      "The address fields of the company profile, printed on every form that asks. Nothing about " +
      "this box is computed.",
    howToReadIt:
      "Read it as a delivery instruction with a deadline attached. An IRS notice sent to a stale " +
      "address is still legally delivered and the response clock still runs. So a wrong address " +
      "here is not a filing error \u2014 it is a letter you never see whose deadline has already " +
      "started counting.",
    commonMistake:
      "Assuming the return updates the address of record. It does not. The IRS requires Form " +
      "8822-B, filed separately, and Form 940 is annual \u2014 so a move in February would not even " +
      "be reported on a return until the following January.",
    whatToDo:
      "If Greenway moves, file Form 8822-B on its own as well as updating Company Info. Do not " +
      "wait for the next return to carry the message, and on an annual form that wait is a year.",
    examples: [
      {
        title: "Why the annual form makes this worse",
        steps: [
          "The business relocates in February and Company Info is updated the same week.",
          "The 941s for Q1 through Q4 print the new address as they are filed.",
          "This Form 940 is not filed until January of the following year.",
          "In the meantime the IRS still holds the old address, because no return changes an address of record.",
          "Form 8822-B, mailed on its own, is what would have prevented it.",
        ],
        answer: "Form 8822-B",
        moral:
          "Reporting an address and registering one are two different acts, and only one of them " +
          "happens by filing.",
      },
    ],
    quotes: [quoteOf(I940_ENTITY_TOP_OF_FORM)],
    tiesTo: [
      {
        formId: "form_940",
        box: "cityStateZip",
        why: "The other half of the same address. Two boxes on the paper, one fact in the books.",
      },
      {
        formId: "form_941",
        box: "address",
        why: "The same address prints on the quarterly returns, and the 8822-B rule is identical there.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "cityStateZip",
    headline: "City, state and ZIP \u2014 and the two letters that decide the whole tax",
    plainEnglish:
      "The second line of the address: PORT ORCHARD, WA 98366. On this form more than any other, " +
      "the state code is a tax fact rather than a postal one. WA is what makes Greenway subject " +
      "to Washington unemployment insurance, and paying that state tax on time is what earns the " +
      "5.4% credit that turns a 6.0% federal tax into 0.6%.",
    whereItComesFrom:
      "The city, state and postal code fields of the company profile, joined for printing. One " +
      "stored fact, one printed line.",
    howToReadIt:
      "Read the state code against line 1a. Line 1a asks which state's unemployment fund the wages " +
      "were paid into, and this line says where the business is. For a single-state employer like " +
      "Greenway they are the same two letters, and if they ever differ, one of them is wrong or " +
      "the return needs Schedule A.",
    commonMistake:
      "A ZIP+4 in a five-digit field, or a state spelled out rather than abbreviated. Neither " +
      "invalidates the return, but both make the automated address match fail \u2014 which is how a " +
      "business ends up on a stale address without knowing it.",
    whatToDo:
      "Check the state code reads WA and that the ZIP matches what ESD and the Department of " +
      "Revenue hold. Three agencies should share one address between them, not keep three.",
    examples: [
      {
        title: "Two characters, ten times the tax",
        steps: [
          "The address line reads PORT ORCHARD, WA 98366.",
          "WA means Greenway pays state unemployment tax to Washington ESD.",
          "Paying that on time earns the maximum 5.4% credit on this form.",
          "6.0% \u2212 5.4% = 0.6%. On $7,000 of wages per person that is $42 rather than $420.",
        ],
        answer: "0.6%",
        moral:
          "The state in the address box is the reason the FUTA credit exists. It is the least " +
          "decorative address line on any federal form.",
      },
    ],
    quotes: [quoteOf(I940_ENTITY_TOP_OF_FORM)],
    tiesTo: [
      {
        formId: "form_940",
        box: "1a",
        why: "Line 1a names the state whose unemployment fund the wages went to. For a single-state employer it must be the state in this address.",
      },
      {
        formId: "form_940",
        box: "address",
        why: "The first half of the same address, printed from the same stored profile.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "4",
    headline: "Money that was never FUTA wages \u2014 and the trap in the last sentence",
    plainEnglish:
      "Payments that went to people but are not subject to federal unemployment tax at all: " +
      "certain fringe benefits, group-term life insurance, employer retirement contributions, " +
      "dependent care, and a handful of others. This line SUBTRACTS from line 3. The trap is that " +
      "a payment only belongs here if it was already counted on line 3 \u2014 taking something out " +
      "that was never put in understates the tax.",
    whereItComesFrom:
      "The payroll records, classified by what each payment IS rather than by what it is called. " +
      "The engine reports zero for Greenway today because none of the exempt categories appears " +
      "in the current pay runs \u2014 and zero here is a measured result, not an assumption.",
    howToReadIt:
      "Read it beside the tick boxes 4a through 4e. A figure on line 4 with no box ticked is " +
      "incomplete on its face; a ticked box with no figure is the same error in reverse. And read " +
      "it against Michael's own situation: the company-paid health premium for a 2%-or-more " +
      "shareholder-employee IS wages on the 941 and IS reportable, so it is not automatically an " +
      "exempt payment here \u2014 which is exactly why this line needs deciding rather than assuming.",
    commonMistake:
      "Reporting a payment as exempt that was never included on line 3 in the first place. Line 3 " +
      "is ALL payments to all employees; line 4 removes the ones that are not FUTA wages. If a " +
      "payment skipped line 3, subtracting it here removes money from the base twice.",
    whatToDo:
      "Before entering anything on line 4, confirm the same payment is inside line 3. If it is " +
      "not, the error is on line 3 and fixing line 4 will hide it rather than solve it.",
    examples: [
      {
        title: "The double subtraction",
        steps: [
          "A $2,000 employer retirement contribution is made during the year.",
          "It was omitted from line 3, which should have shown ALL payments.",
          "Entering $2,000 on line 4 removes it a second time.",
          "Line 7 is therefore $2,000 too low and the FUTA tax is understated by $12 at 0.6%.",
          "The dollar amount is small; the error is a base error and it repeats every year.",
        ],
        answer: "$2,000 too low",
        moral:
          "Line 4 only works if line 3 is complete. The instruction saying so is the most " +
          "important sentence attached to this box.",
      },
    ],
    quotes: [quoteOf(I940_LINE_4_EXEMPT_MUST_BE_IN_LINE_3)],
    tiesTo: [
      {
        formId: "form_940",
        box: "3",
        why: "A payment may only be exempted here if it was included there. That is the instruction, and it is the error this line invites.",
      },
      {
        formId: "form_940",
        box: "6",
        why: "Line 4 is one of the two figures line 6 adds together.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "6",
    headline: "Everything that is NOT taxable, in one figure",
    plainEnglish:
      "Line 4 plus line 5. Two quite different kinds of money added together: line 4 is payments " +
      "that were never FUTA wages at all, and line 5 is payments that were, but sat above the " +
      "$7,000-per-person ceiling. Line 6 is the whole of what comes off line 3 to leave the " +
      "taxable base on line 7.",
    whereItComesFrom:
      "Added from lines 4 and 5. Nothing is computed independently for this box \u2014 deliberately, " +
      "because a subtotal calculated on its own can disagree with the two lines above it, and a " +
      "form that disagrees with itself is what a notice is written about.",
    howToReadIt:
      "Read the SPLIT, not the total. For Greenway line 6 is almost entirely line 5, because " +
      "every employee paid more than $7,000 in the year contributes their excess to it. A line 6 " +
      "that is mostly line 4 instead would mean large exempt payments, which for a cannabis " +
      "retailer with no retirement plan and no cafeteria plan would be a surprise worth chasing.",
    commonMistake:
      "Treating line 6 as \u201Cwages we do not pay tax on\u201D and reconciling it against something. It " +
      "is a mechanical subtotal of two unlike things, and it has no meaning outside the " +
      "subtraction on line 7.",
    whatToDo:
      "Add lines 4 and 5 yourself once and confirm you get this figure. If you do not, one of the " +
      "three lines is wrong and line 7 cannot be right.",
    examples: [
      {
        title: "Greenway's shape",
        steps: [
          "Line 3 (all payments): 44,000.00 for Joan and 6,200.00 for Nicholas \u2014 50,200.00.",
          "Line 4 (exempt payments): 0.00 \u2014 no fringe, pension, or dependent-care payments.",
          "Line 5 (payments over $7,000 per person): Joan is 37,000.00 over; Nicholas is under the " +
            "ceiling and contributes nothing. So 37,000.00.",
          "Line 6 = 0.00 + 37,000.00 = 37,000.00.",
          "Line 7 = 50,200.00 \u2212 37,000.00 = 13,200.00 of taxable FUTA wages.",
        ],
        answer: "37,000.00",
        moral:
          "For an employer with no exempt payments, line 6 is just the ceiling doing its work. The " +
          "line exists to keep the two reasons separate.",
      },
    ],
    quotes: [quoteOf(I940_LINE_6_SUBTOTAL)],
    tiesTo: [
      {
        formId: "form_940",
        box: "4",
        why: "One of the two figures added here.",
      },
      {
        formId: "form_940",
        box: "5",
        why: "The other, and for Greenway almost all of it \u2014 the $7,000 ceiling rather than any exemption.",
      },
      {
        formId: "form_940",
        box: "7",
        why: "Line 7 is line 3 less this figure. Line 6 exists only to be subtracted.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "11",
    headline: "Blank today, and the year it is not blank is not Greenway's fault",
    plainEnglish:
      "An extra amount of federal unemployment tax owed by employers in a \u201Ccredit reduction\u201D " +
      "state \u2014 a state that borrowed from the federal unemployment fund and has not repaid it. " +
      "Washington is not one, so this line is blank. The figure, when it applies, is not computed " +
      "on this form at all: it comes off Schedule A, a separate page listing the affected states.",
    whereItComesFrom:
      "Schedule A (Form 940), when one is required. The engine takes the credit reduction rate as " +
      "an INPUT rather than assuming zero, because \u201Cnot this year\u201D is a fact with an expiry date " +
      "and a hard-coded zero would silently understate the tax the year it changes.",
    howToReadIt:
      "Read the emptiness as current, not permanent. The U.S. Department of Labor publishes the " +
      "list of credit reduction states each November, and Washington has been off it for years \u2014 " +
      "but a recession that drains the state fund puts it back on, and the first sign would be " +
      "this line needing a figure and a Schedule A being required.",
    commonMistake:
      "Two opposite ones. Filling it in because a state tax was paid late \u2014 that is line 10 and " +
      "the worksheet, not this line. And leaving it blank in a year Washington IS on the list, " +
      "which understates the tax and omits a required schedule.",
    whatToDo:
      "Check the DOL credit reduction list once a year, in November, before the return is prepared. " +
      "If Washington appears, Schedule A must be completed and its total brought here.",
    examples: [
      {
        title: "What it would cost if Washington were on the list",
        steps: [
          "Assume 13,200.00 of taxable FUTA wages, as in the line 6 example.",
          "A credit reduction of 0.3% in the first year a state is on the list.",
          "13,200.00 \u00D7 0.003 = 39.60, which would go on line 11.",
          "Line 12 rises by the same 39.60, and Schedule A must be attached.",
          "The rate steps up 0.3% for each additional year the state stays on the list.",
        ],
        answer: "39.60",
        moral:
          "Small the first year and compounding after it. Worth checking annually rather than " +
          "assuming the blank is permanent.",
      },
    ],
    quotes: [quoteOf(I940_LINE_11_CREDIT_REDUCTION_AMOUNT), quoteOf(I940_CREDIT_REDUCTION_STATE)],
    tiesTo: [
      {
        formId: "form_940",
        box: "2",
        why: "The tick box that says a credit reduction state is involved. A figure here with that box unticked is inconsistent.",
      },
      {
        formId: "form_940",
        box: "12",
        why: "Line 11 is one of the four figures line 12 adds. Every adjustment on this form only ever increases the tax.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "13",
    headline: "The only line on this form that records money leaving the bank",
    plainEnglish:
      "The total FUTA tax Greenway actually deposited during the year, plus any overpayment " +
      "carried forward from the prior year. Everything above this line is a LIABILITY \u2014 what the " +
      "wages caused Greenway to owe. This is cash, and it is the answer to \u201Cwhat have we already " +
      "paid?\u201D",
    whereItComesFrom:
      "The federal tax deposits recorded in the books for the year, matched against what actually " +
      "cleared the bank through EFTPS. It is a cash figure, not a computed one: nothing above it " +
      "can produce it, which is precisely why it is capable of contradicting the form.",
    howToReadIt:
      "Read it against line 12 and nothing else. Equal means the year was deposited correctly. " +
      "Short means a balance due on line 14; over means an overpayment on line 15a. Note that for " +
      "an employer Greenway's size this line is often small or zero \u2014 FUTA only has to be " +
      "deposited once the accumulated liability passes $500, and under that it can simply be paid " +
      "with the return.",
    commonMistake:
      "Entering the liability instead of the deposits so the two lines agree by construction. That " +
      "defeats the entire bottom half of the form: line 13 exists to be an INDEPENDENT figure " +
      "taken from the bank, and one copied from line 12 will never catch the missed deposit it " +
      "was designed to catch.",
    whatToDo:
      "Pull the year's EFTPS payment history and total it from the payment records rather than " +
      "from this return. Then compare with line 12 and account for any difference before filing.",
    examples: [
      {
        title: "Why zero can be the right answer",
        steps: [
          "Line 12 for the year: 79.20 of FUTA tax.",
          "The deposit threshold is $500 of accumulated liability.",
          "79.20 never reaches it, so no deposit was ever required.",
          "Line 13 is therefore 0.00 and line 14 shows 79.20 to pay with the return.",
          "That is the ordinary, correct pattern for a business this size \u2014 one payment a year.",
        ],
        answer: "0.00",
        moral:
          "An empty line 13 is not a missed deposit when no deposit was ever due. The $500 " +
          "threshold is what tells the two apart.",
      },
    ],
    quotes: [quoteOf(I940_LINE_13_DEPOSITED), quoteOf(I940_DEPOSIT_THRESHOLD)],
    tiesTo: [
      {
        formId: "form_940",
        box: "12",
        why: "Line 13 is only meaningful next to line 12. Equal is clean; short is a balance due; over is an overpayment.",
      },
      {
        formId: "form_940",
        box: "14",
        why: "When line 13 falls short of line 12, the difference lands there as the amount to pay.",
      },
      {
        formId: "form_940",
        box: "15a",
        why: "When line 13 exceeds line 12, the difference lands there instead. Never both.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "14",
    headline: "The amount to pay \u2014 and three bands almost nobody knows",
    plainEnglish:
      "The gap, when line 12 (owed) exceeds line 13 (deposited). For a business Greenway's size " +
      "this is normally where the whole year's FUTA tax is paid, because the tax rarely reaches " +
      "the $500 deposit threshold. The instructions split it into three bands, and the bands " +
      "change what you are allowed to do rather than just how much you owe.",
    whereItComesFrom:
      "Line 12 minus line 13, when the difference is positive. Pure subtraction \u2014 nothing is " +
      "looked up, which is why an error anywhere on the form surfaces here rather than being " +
      "absorbed.",
    howToReadIt:
      "Find which band the figure is in, because the band is the real information. Under $1 and " +
      "the IRS says not to bother paying it. $500 or less and it may be paid however is " +
      "convenient, including with the return. More than $500 and it should have been DEPOSITED " +
      "during the year \u2014 paying it with the return instead can earn a penalty even though the IRS " +
      "ends up with the same money on the same day.",
    commonMistake:
      "Paying a balance over $500 with the return and treating the matter as closed. The offence " +
      "in that band is the missed deposit, not the unpaid tax, so the penalty survives the " +
      "payment. The other mistake is entering a figure on both line 14 and line 15a, which is a " +
      "return that contradicts itself.",
    whatToDo:
      "Check which band this figure falls in. If it is over $500, work out which quarter's " +
      "deposit was missed \u2014 lines 16a to 16d will show you \u2014 before paying, because next year " +
      "the same pattern will repeat unless the deposit schedule is fixed.",
    examples: [
      {
        title: "The three bands on real figures",
        steps: [
          "79.20 owed, nothing deposited: $500 or less, so pay it with the return. Correct.",
          "0.60 owed: under $1, so the instructions say you don't have to pay it at all.",
          "640.00 owed with nothing deposited: over $500, so a deposit was required during the " +
            "year and paying now may draw a penalty.",
          "640.00 owed with 500.00 already deposited: the balance is 140.00, in the payable band.",
        ],
        answer: "three bands",
        moral:
          "The same dollar figure is fine or penalised depending on what happened earlier in the " +
          "year. That is why the deposit history matters more than the balance.",
      },
    ],
    quotes: [quoteOf(I940_BALANCE_DUE_BANDS)],
    tiesTo: [
      {
        formId: "form_940",
        box: "12",
        why: "The larger of the two figures subtracted here. If line 12 is wrong the balance due is wrong.",
      },
      {
        formId: "form_940",
        box: "13",
        why: "The deposits. A balance over $500 means a deposit was missed rather than that the tax was miscomputed.",
      },
      {
        formId: "form_940",
        box: "15a",
        why: "The opposite case. A return can have one or the other, never both.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "15a",
    headline: "Paid too much \u2014 the mirror image of line 14",
    plainEnglish:
      "The difference when line 13 (deposited) exceeds line 12 (owed). One subtraction in the " +
      "opposite direction from line 14, and the two are mutually exclusive: a return cannot be " +
      "both short and over. A figure here means line 14 is blank and vice versa.",
    whereItComesFrom:
      "Line 13 minus line 12. Nothing else feeds it.",
    howToReadIt:
      "A figure here is usually not good news even though it means money is coming back. FUTA is " +
      "a small, predictable tax with a $500 deposit threshold, so a material overpayment normally " +
      "means either a deposit was made against the wrong form or the wage base was over-reported " +
      "during the year and corrected here. Both are worth understanding rather than banking.",
    commonMistake:
      "Ignoring it because the amount is small and the money will come back eventually. An " +
      "overpayment that came from a deposit posted to the wrong tax type leaves a SHORTFALL " +
      "somewhere else \u2014 typically on a 941 \u2014 and the two do not offset each other.",
    whatToDo:
      "Find out where the extra money came from before choosing between a refund and a carry " +
      "forward on line 15b. If it came from a misposted deposit, fix the posting rather than " +
      "accepting the refund.",
    examples: [
      {
        title: "An overpayment that is really a shortfall",
        steps: [
          "A 600.00 deposit is made in July intended for Form 941.",
          "It is coded to Form 940 by mistake.",
          "Line 13 shows 600.00 against a line 12 of 79.20.",
          "Line 15a therefore shows 520.80 as an overpayment.",
          "The Q3 941 is short by the same 600.00, and that shortfall carries trust-fund exposure " +
            "while this overpayment carries none.",
        ],
        answer: "520.80",
        moral:
          "An overpayment on one form and a shortfall on another are the same event seen twice. " +
          "The one that matters is the shortfall.",
      },
    ],
    quotes: [quoteOf(I940_LINE_15A_OVERPAYMENT)],
    tiesTo: [
      {
        formId: "form_940",
        box: "13",
        why: "The deposits figure this line subtracts from.",
      },
      {
        formId: "form_940",
        box: "14",
        why: "The opposite direction. One or the other, never both.",
      },
      {
        formId: "form_940",
        box: "15b",
        why: "Having established an overpayment, line 15b is where you choose refund or carry forward.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "16a",
    headline: "First quarter liability \u2014 blank for Greenway, and not what you deposited",
    plainEnglish:
      "Greenway does not fill this box in. Part 5 is only used when line 12 is more than $500, and the 2025 return came to 420.00, so all four quarter boxes were correctly left blank - blank, not zeroed. It is explained here because the threshold is not a permanent exemption: the first year the FUTA total crosses 500.00, these four boxes switch on and the form gives no warning that they did. " +
      "The FUTA tax that the wages of January, February and March caused Greenway to owe. The " +
      "single most misread instruction on the form is attached to this box and its three " +
      "siblings: \u201CDon't enter the amount you deposited.\u201D These four boxes are a liability diary, " +
      "the annual equivalent of what Schedule B does for the 941. If there was no liability for " +
      "the quarter, the line is left blank rather than zeroed.",
    whereItComesFrom:
      "The taxable FUTA wages paid in Q1, at 0.6% after the state credit. Because the $7,000 " +
      "per-person ceiling is reached early in the year, this is normally the LARGEST of the four " +
      "quarters by a wide margin.",
    howToReadIt:
      "Expect it to be front-loaded and be suspicious if it is not. Every employee's first $7,000 " +
      "is taxable, so for a stable workforce most of the year's FUTA is incurred in Q1 and the " +
      "later quarters trail off toward nothing. A Q1 that is small and a Q3 that is large means " +
      "new hires mid-year, which is worth knowing, or a base error, which is worth fixing.",
    commonMistake:
      "Entering the deposit made in April for the first quarter. The deposit is a payment and " +
      "belongs on line 13; this box is what was INCURRED. Confusing them breaks the check that " +
      "lines 16a through 16d sum to line 17, which must equal line 12.",
    whatToDo:
      "Confirm this figure came from Q1 WAGES and not from a Q1 or April payment, then check the " +
      "four boxes add to line 17.",
    examples: [
      {
        title: "Why Q1 carries most of the year",
        steps: [
          "Joan earns 44,000.00 across the year, paid evenly \u2014 about 11,000.00 a quarter.",
          "Only her first 7,000.00 is FUTA taxable, and she passes it inside Q1.",
          "So Joan's entire 42.00 of FUTA (7,000.00 \u00D7 0.006) is incurred in Q1.",
          "Nicholas earns 6,200.00 across the year and never reaches the ceiling, so his liability " +
            "spreads across all four quarters.",
          "Line 16a is therefore large and 16b through 16d are small.",
        ],
        answer: "front-loaded",
        moral:
          "The shape of these four boxes is dictated by the ceiling, not by when the work happened.",
      },
    ],
    quotes: [quoteOf(I940_PART5_ONLY_IF_OVER_500), quoteOf(I940_LINE_16_QUARTERLY_LIABILITY)],
    tiesTo: [
      {
        formId: "form_940",
        box: "16b",
        why: "The next quarter. Read the four together \u2014 the pattern is the information, not any single figure.",
      },
      {
        formId: "form_940",
        box: "17",
        why: "The four quarterly boxes must add to line 17, which must equal line 12. That is the form's own arithmetic check.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "16b",
    headline: "Second quarter liability \u2014 blank for Greenway, where the ceiling starts to bite",
    plainEnglish:
      "Greenway does not fill this box in. Part 5 is only used when line 12 is more than $500, and the 2025 return came to 420.00, so all four quarter boxes were correctly left blank - blank, not zeroed. It is explained here because the threshold is not a permanent exemption: the first year the FUTA total crosses 500.00, these four boxes switch on and the form gives no warning that they did. " +
      "The FUTA tax incurred on April, May and June wages. Liability, not deposits, and blank " +
      "rather than zero if there was none. By the second quarter most established employees have " +
      "already passed the $7,000 ceiling, so this figure is normally well below Q1.",
    whereItComesFrom:
      "Q2's taxable FUTA wages at 0.6% \u2014 which for a stable workforce means only the employees " +
      "who had not yet reached $7,000 by the end of March, plus anyone hired during the quarter.",
    howToReadIt:
      "Read it as a hiring signal. A Q2 that is close to Q1 means substantial new hiring in the " +
      "spring, because established staff have no taxable base left. A Q2 that is near zero means " +
      "a stable roster, which is what Greenway's two-employee shape produces.",
    commonMistake:
      "Assuming the four quarters should be roughly equal because the payroll is roughly equal. " +
      "FUTA liability is not proportional to wages \u2014 it is proportional to the part of each " +
      "person's wages still under $7,000, which runs out.",
    whatToDo:
      "Compare this figure with Q1 and ask whether the difference is explained by the ceiling or " +
      "by a hire. If neither explains it, the wage base is being recomputed somewhere it should " +
      "not be.",
    examples: [
      {
        title: "A spring hire showing up in Q2",
        steps: [
          "Q1 liability: 42.00, almost all of it Joan's ceiling being reached.",
          "A new employee starts in May at 3,000.00 for the quarter.",
          "Their whole 3,000.00 is under the ceiling, so all of it is taxable: 18.00 at 0.6%.",
          "Line 16b therefore shows about 18.00 where it would otherwise have shown a few cents.",
        ],
        answer: "18.00",
        moral:
          "A jump in a later quarter is almost always a hire. These four boxes are the only place " +
          "on the form where that is visible.",
      },
    ],
    quotes: [quoteOf(I940_PART5_ONLY_IF_OVER_500), quoteOf(I940_LINE_16_QUARTERLY_LIABILITY)],
    tiesTo: [
      {
        formId: "form_940",
        box: "16a",
        why: "The quarter before. The drop between them is the ceiling doing its work.",
      },
      {
        formId: "form_940",
        box: "17",
        why: "One of the four figures that must add to line 17, and therefore to line 12.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "16c",
    headline: "Third quarter liability \u2014 blank for Greenway, and usually the quietest box",
    plainEnglish:
      "Greenway does not fill this box in. Part 5 is only used when line 12 is more than $500, and the 2025 return came to 420.00, so all four quarter boxes were correctly left blank - blank, not zeroed. It is explained here because the threshold is not a permanent exemption: the first year the FUTA total crosses 500.00, these four boxes switch on and the form gives no warning that they did. " +
      "The FUTA tax incurred on July, August and September wages. Liability, not deposits, and " +
      "blank rather than zero if there was none. For a stable workforce this is frequently blank, " +
      "because everyone still employed passed the $7,000 ceiling months ago.",
    whereItComesFrom:
      "Q3's taxable FUTA wages at 0.6%. In practice, only employees hired in or after July, and " +
      "anyone whose year-to-date pay was still under $7,000 at the end of June.",
    howToReadIt:
      "A blank here is normal and correct, and the instruction says blank rather than a zero. A " +
      "figure here means somebody's wage base was still open in the summer \u2014 a mid-year hire, a " +
      "part-timer, or a seasonal worker. For Greenway, a Q3 figure with no summer hire would be " +
      "worth investigating.",
    commonMistake:
      "Writing 0.00 instead of leaving it blank. The instructions are explicit about the blank, " +
      "and while a zero is unlikely to cause a rejection, it makes an automated read of the form " +
      "ambiguous about whether the question was answered or the liability was genuinely nil.",
    whatToDo:
      "If this box has a figure, identify which employee generated it. If it does not, confirm " +
      "that everyone who worked in Q3 had already passed $7,000 \u2014 which is what makes the blank " +
      "true rather than merely empty.",
    examples: [
      {
        title: "The part-timer who keeps Q3 open",
        steps: [
          "Nicholas earns 6,200.00 across the whole year, paid evenly.",
          "By the end of June he has earned about 3,100.00 \u2014 still under 7,000.00.",
          "So his Q3 wages are entirely FUTA taxable.",
          "About 1,550.00 \u00D7 0.006 = 9.30 goes on line 16c.",
          "Joan contributes nothing, having passed the ceiling in Q1.",
        ],
        answer: "9.30",
        moral:
          "A low-paid employee is the reason a late quarter has any FUTA at all. The ceiling never " +
          "closes for someone who never reaches it.",
      },
    ],
    quotes: [quoteOf(I940_PART5_ONLY_IF_OVER_500), quoteOf(I940_LINE_16_QUARTERLY_LIABILITY)],
    tiesTo: [
      {
        formId: "form_940",
        box: "16b",
        why: "The quarter before. Read the four as a sequence.",
      },
      {
        formId: "form_940",
        box: "17",
        why: "One of the four figures that must add to line 17, and therefore to line 12.",
      },
    ],
  },

  {
    formId: "form_940",
    box: "16d",
    headline: "Fourth quarter \u2014 blank for Greenway, and computed differently from the other three",
    plainEnglish:
      "Greenway does not fill this box in. Part 5 is only used when line 12 is more than $500, and the 2025 return came to 420.00, so all four quarter boxes were correctly left blank - blank, not zeroed. It is explained here because the threshold is not a permanent exemption: the first year the FUTA total crosses 500.00, these four boxes switch on and the form gives no warning that they did. " +
      "The FUTA tax incurred on October, November and December wages \u2014 except that the " +
      "instructions do not have you compute it from those wages at all. Line 16d is a RESIDUAL: " +
      "complete the form through line 12, copy line 12 to line 17, then subtract 16a plus 16b " +
      "plus 16c from line 17. Whatever is left goes here. Almost nobody knows this, and it is why " +
      "16d sometimes looks slightly odd against Q4 payroll.",
    whereItComesFrom:
      "Line 17 minus the sum of lines 16a, 16b and 16c. Not from Q4 wages directly. This is what " +
      "GUARANTEES the four quarterly boxes add exactly to line 12 \u2014 any rounding drift across " +
      "the first three quarters is absorbed here by construction rather than left to disagree.",
    howToReadIt:
      "Read it as the balancing figure it is. If 16d comes out negative, that is not a Q4 refund " +
      "\u2014 it means the first three quarters have been overstated, and the error is above this box " +
      "rather than in it. A negative residual is the single clearest signal on the form that a " +
      "quarterly split is wrong.",
    commonMistake:
      "Computing 16d from fourth-quarter wages like the other three, then wondering why the four " +
      "boxes do not add to line 12. They will not, because the residual method exists precisely " +
      "to make them add. The other mistake is entering the February deposit here \u2014 these boxes " +
      "are liability, and the instruction says so in as many words.",
    whatToDo:
      "Add 16a, 16b and 16c, subtract from line 17, and confirm the result is what this box shows. " +
      "If the result is negative, stop and find the overstated quarter before filing.",
    examples: [
      {
        title: "The residual absorbing rounding",
        steps: [
          "Line 12 for the year: 79.20. Copy it to line 17.",
          "16a: 42.00. 16b: 18.00. 16c: 9.30. Those sum to 69.30.",
          "79.20 \u2212 69.30 = 9.90, which goes on line 16d.",
          "If Q4 wages had been computed directly they might have given 9.88 or 9.92 \u2014 and the " +
            "four boxes would then miss line 12 by a cent or two.",
          "The residual method makes the miss impossible.",
        ],
        answer: "9.90",
        moral:
          "The fourth quarter is where the form makes its own arithmetic come out even. That is a " +
          "feature, and it is documented.",
      },
    ],
    quotes: [
      quoteOf(I940_PART5_ONLY_IF_OVER_500),
      quoteOf(I940_LINE_16D_IS_A_RESIDUAL),
      quoteOf(I940_LINE_16_QUARTERLY_LIABILITY),
      quoteOf(I940_FOURTH_QUARTER),
    ],
    tiesTo: [
      {
        formId: "form_940",
        box: "16a",
        why: "One of the three figures subtracted from line 17 to produce this one.",
      },
      {
        formId: "form_940",
        box: "17",
        why: "This box is defined as line 17 less the other three quarters, so line 17 must be right first.",
      },
      {
        formId: "form_940",
        box: "12",
        why: "Line 17 is a copy of line 12, which makes this box ultimately a function of the year's total tax.",
      },
    ],
  },
];

/**
 * Who must file at all, quoted verbatim.
 *
 * Kept OUT of the lesson list on purpose. It is not about any single box — it
 * is the test that decides whether the form exists this year — and putting it
 * on an arbitrary line would teach that it belongs to that line. The page
 * renders it as its own panel.
 *
 * A second reason: `lessonFor` looks up by (formId, box), so a second lesson
 * carrying box "3" would shadow the real line 3 lesson and the click would
 * silently teach the wrong thing. The gate asserts the box numbers are unique.
 */
export const FORM_940_WHO_MUST_FILE_QUOTE: BoxQuote = quoteOf(I940_WHO_MUST_FILE);
