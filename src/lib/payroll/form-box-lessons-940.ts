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
  I940_LINE_17_MUST_EQUAL_12,
  I940_LINE_3_ALL_PAYMENTS,
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
