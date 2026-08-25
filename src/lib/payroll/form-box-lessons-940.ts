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
