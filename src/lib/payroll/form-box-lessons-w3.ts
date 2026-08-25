/**
 * src/lib/payroll/form-box-lessons-w3.ts   (books-55)
 *
 * ═══ THE W-3, BOX BY BOX ═══
 *
 * Michael, verbatim: "There should be a visual form for every single form in
 * its own tab." And, on the point that governs this whole module:
 *
 *   "it was me that produced all the w-2s and w-3 for my business, not my
 *    grandfather. It's very likely I did it wrong. Please deep research the
 *    proper way for me to fill them out so the teaching lessons are accurate
 *    and the forms are built based on legal authoritative text rather than
 *    trusting my bad accounting."
 *
 * ─── WHY THAT SENTENCE CHANGED HOW THIS FILE IS WRITTEN ────────────────────
 *
 * Standing rule 109: THE OWNER'S FILED DOCUMENTS ARE EVIDENCE. THEY ARE NEVER
 * AUTHORITY. Greenway's 2025 W-3 is quoted below in several worked examples,
 * because real figures teach and invented ones do not. But every figure taken
 * from it is labelled AS FILED, and no lesson below infers a rule from what the
 * form happens to say. The rule comes from the instructions; the form is then
 * measured AGAINST the rule. Where the two disagree, the lesson says so and
 * stops — it does not resolve a tax question Michael has an accountant for.
 *
 * That distinction is not academic here. Working through box 6 for this module
 * found a two-cent difference between what Greenway's W-3 reports and what the
 * statutory rate produces on the same wage base. It is explained in the box 6
 * lesson, and it turns out to be CORRECT — but it is only visibly correct
 * because the 941 was checked as well. Had the lesson been written by reading
 * the W-3 and describing it, the two cents would have been invisible.
 *
 * ─── WHAT A W-3 ACTUALLY IS, AND WHY IT IS EASY TO UNDERRATE ───────────────
 *
 * The W-3 is a transmittal: one page that totals every W-2 in the envelope. It
 * looks like the least interesting form in payroll, and it is the form the
 * government reconciles automatically against the four 941s already filed. The
 * W-2 goes to a person; the W-3 goes to a matching engine. Nobody reads it, and
 * everybody's computer checks it.
 *
 * So the failure mode is distinctive. A wrong W-2 produces a complaint from an
 * employee. A wrong W-3 produces silence, and then a letter, because the only
 * party comparing those numbers is a program that does it months later. The
 * instructions say "you will be contacted" — not "may be" — and that single
 * word is why this form is worth thirty-one lessons.
 *
 * ─── EVERY QUOTE WAS MACHINE-EXTRACTED, NOT TYPED (rule 24, rule 35) ───────
 *
 * Every `quote` below was pulled out of the mirrored corpus by a script and
 * round-tripped against it before being pasted here, and a gate re-reads the
 * file and asserts each one is present CHARACTER FOR CHARACTER. The embedded
 * newlines look wrong and are correct: they are where the IRS's two-column PDF
 * wraps. "Tidying" them breaks the verification, which is the only thing that
 * makes a citation worth more than a footnote.
 *
 * Two traps found while extracting, recorded because they are the shape of
 * mistake that survives review:
 *
 *   1. "Box 10—Dependent care benefits (not applicable to" appears TWICE in
 *      the corpus — once in the W-2 instructions as a long passage about
 *      section 129 plans, once in the W-3 instructions as a one-line "enter
 *      the total". A naive search returned 38,838 characters of the wrong
 *      section. It was perfectly verbatim and completely wrong. Verbatim is
 *      not the same as correct.
 *
 *   2. The W-3 authority records in `form-w2-authorities.ts` are verified by a
 *      script that NORMALISES whitespace. The lesson gate does not. So the
 *      same passage needs a different literal in the two places, and copying
 *      one into the other fails. Extract from the source, never from a
 *      neighbouring module.
 */

import type { BoxLesson } from "./form-box-core";

/** The mirrored corpus. The gate reads this file to verify every quote. */
export const FORM_W3_SOURCE_PATH = "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt";
/** Where Michael reads the real thing. Rendered as an href. */
export const FORM_W3_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf";

/**
 * ═══ GREENWAY'S 2025 W-3, AS FILED ═══
 *
 * Read out of `2025_FORM_W-3.pdf` with `pdftotext -layout`, not typed. Rule
 * 109 governs the naming: the `AS_FILED_` prefix is mandatory, and it exists
 * so that no future reader can mistake these for target values. They are what
 * happened, which is a different thing from what should have happened.
 *
 * These drive the worked examples. A lesson about a form Michael has never
 * seen filled in teaches half as much as a lesson about his own.
 */
export const AS_FILED_2025_W3_FORM_COUNT = 10;
export const AS_FILED_2025_W3_BOX_1_CENTS = 33_297_544;
export const AS_FILED_2025_W3_BOX_2_CENTS = 1_611_841;
export const AS_FILED_2025_W3_BOX_3_CENTS = 33_297_544;
export const AS_FILED_2025_W3_BOX_4_CENTS = 2_064_448;
export const AS_FILED_2025_W3_BOX_5_CENTS = 33_297_544;
export const AS_FILED_2025_W3_BOX_6_CENTS = 482_812;
/** The EIN as printed in box e. Formatted, because the format is the lesson. */
export const AS_FILED_2025_W3_EIN = "46-4217016";

/** Statutory employee-side rates, in basis points. Units per house rules. */
export const OASDI_EMPLOYEE_BPS = 620;
export const MEDICARE_EMPLOYEE_BPS = 145;

export const FORM_W3_BOX_LESSONS: readonly BoxLesson[] = [
  /* ═══════════════════════════════════════════════════════════════════════
   * THE LETTERED HEADER BOXES — who is filing, and for how many people
   * ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: "form_w3",
    box: "a",
    headline: "An optional reference number that is yours, not the government's",
    plainEnglish:
      "A control number you may use to number the whole transmittal. It is optional in the " +
      "fullest sense: the SSA does not require it, does not validate it, and does not care what " +
      "you put there. Greenway leaves it empty.",
    whereItComesFrom:
      "Nowhere in this system. There is no figure to compute. If Michael ever files for several " +
      "entities in one season and wants his own numbering, this is the box for it.",
    howToReadIt:
      "An empty box a tells you nothing is wrong. This is worth stating because the instinct on " +
      "a tax form is that a blank is a mistake, and on this form several blanks are the correct " +
      "answer.",
    commonMistake:
      "Putting the EIN here because the box is empty and the EIN is at hand. It is harmless but " +
      "it teaches the wrong habit: box e is the EIN, and a number in two places is a number that " +
      "can disagree with itself.",
    whatToDo:
      "Leave it blank. Revisit only if Greenway files multiple transmittals in one year and needs " +
      "to tell them apart.",
    examples: [
      {
        title: "Greenway's 2025 transmittal",
        steps: [
          "One transmittal was filed for the year, covering all ten W-2s.",
          "There is nothing to distinguish it from, so no control number is needed.",
          "As filed, box a is empty — which matches the instruction rather than contradicting it.",
        ],
        answer: "(blank)",
        moral:
          "Optional means optional. The value of knowing that is not having to wonder about it " +
          "again next January.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box a—Control number",
        quote:
          "Box a\u2014Control number. This is an optional box that you\nmay use for numbering the whole transmittal.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The IRS says 'optional' in its own words, so a blank box a is provably deliberate " +
          "rather than an oversight. That is the whole point of quoting a one-sentence " +
          "instruction: it converts 'I think this is fine' into 'the instructions say so'.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "b-kind-of-payer",
    headline: "Which return you file — and Greenway files the 941",
    plainEnglish:
      "A row of checkboxes declaring which employment tax return the wages on these W-2s were " +
      "reported on. Greenway files quarterly Forms 941, so the '941' box is ticked and no other. " +
      "The instructions are explicit that you check ONLY ONE.",
    whereItComesFrom:
      "It follows from the filing regime, not from a figure. Greenway is a quarterly 941 filer, " +
      "which is what the four returns already in this system establish.",
    howToReadIt:
      "This box tells the reconciliation engine which returns to compare against. Tick '941' and " +
      "the government adds up four quarterly returns. Tick '944' and it looks for one annual " +
      "return that does not exist. The tick is a routing instruction.",
    commonMistake:
      "Ticking more than one box because more than one looks plausible. If you genuinely have " +
      "two kinds of W-2, the instructions require a SEPARATE W-3 for each type — not two ticks " +
      "on one form.",
    whatToDo:
      "Tick 941 and nothing else. Confirm it matches the returns actually filed for the year " +
      "before signing.",
    examples: [
      {
        title: "Greenway's 2025 transmittal, as filed",
        steps: [
          "Greenway filed Forms 941 for Q1 through Q4 of 2025.",
          "No Form 943, 944, CT-1 or Schedule H was filed.",
          "So exactly one box applies.",
        ],
        answer: "941 ticked",
        moral:
          "The tick has to agree with what was actually filed. It is the one place on the form " +
          "where a wrong answer misdirects the entire comparison rather than changing a figure.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box b—Kind of Payer",
        quote:
          "Box b\u2014Kind of Payer. Check the box that applies to\nyou. Check only one box. If you have more than one type\nof Form W-2, send each type with a separate Form W-3.\nNote: The \u201cThird-party sick pay\u201d indicator box does not\ndesignate a separate kind of payer.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'Check only one box' is an instruction, not a style preference, and the Note closes " +
          "the loophole a careful reader would otherwise find: the third-party sick pay tick " +
          "lives in its own row and does not count as a second kind of payer.",
      },
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box b—Kind of Payer, 941",
        quote:
          "941. Check this box if you file Forms 941 and no other\ncategory applies. A church or church organization should\ncheck this box even if it is not required to file Forms 941 or\n944. If you are a railroad employer sending Forms W-2 for\nemployees covered under the Railroad Retirement Tax Act\n(RRTA), check the \u201cCT-1\u201d box.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "This is the sentence that puts Greenway in the 941 box: it files Forms 941 and none of " +
          "the other categories apply. Quoted in full because the carve-outs it mentions are how " +
          "you prove the ordinary case is the right one.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "1",
        why:
          "Ticking '941' is a promise that four quarterly returns exist for this year and that " +
          "their wages are the wages totalled on this transmittal. Line 1 of those returns is " +
          "the headcount that tells you whether all four were actually filed.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "b-kind-of-employer",
    headline: "What kind of organisation you are — an ordinary company ticks 'None apply'",
    plainEnglish:
      "A second row of checkboxes, describing the ORGANISATION rather than the return. The " +
      "options are all forms of tax-exempt or governmental entity. Greenway is an ordinary " +
      "for-profit corporation, so the correct answer is 'None apply'.",
    whereItComesFrom:
      "The entity's legal character, not a figure. Greenway Marijuana is a Washington " +
      "for-profit S corporation and none of the 501(c) or governmental categories fit.",
    howToReadIt:
      "'None apply' being ticked is a positive statement, not an omission. The instructions " +
      "provide that box precisely so a plain company has something to tick.",
    commonMistake:
      "Leaving the whole row blank because none of the interesting-sounding options apply. A " +
      "blank row is an unanswered question; 'None apply' is the answer.",
    whatToDo:
      "Tick 'None apply'. Confirm no second box is ticked unless it is the third-party sick pay " +
      "indicator, which the instructions permit alongside it.",
    examples: [
      {
        title: "Greenway's 2025 transmittal, as filed",
        steps: [
          "Greenway is not a 501(c) organisation, a state or local government, or a federal entity.",
          "The instructions supply 'None apply' for exactly this situation.",
          "As filed: 'None apply' was ticked.",
        ],
        answer: "None apply ticked",
        moral:
          "A form with a box for 'none of the above' is telling you that silence is not an " +
          "acceptable answer.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box b—Kind of Employer",
        quote:
          "Box b\u2014Kind of Employer. Check the box that applies to\nyou. Check only one box unless the second checked box\nis \u201cThird-party sick pay.\u201d See Pub. 557, Tax-Exempt Status\nfor Your Organization, for information about 501(c)(3)\ntax-exempt organizations.\nNone apply. Check this box if none of the checkboxes\ndiscussed next apply to you.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Two things in one passage: the single-tick rule with its one stated exception, and the " +
          "explicit existence of 'None apply' for employers who are none of the listed kinds. " +
          "That second sentence is the authority for Greenway's answer.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "b-third-party-sick-pay",
    headline: "A single flag for sick pay paid by an insurer — not Greenway's situation",
    plainEnglish:
      "One checkbox, ticked only by a third-party payer of sick pay, or by an employer reporting " +
      "sick pay that a third party paid. It is the one tick that may accompany another, because " +
      "it describes a reporting situation rather than a kind of payer.",
    whereItComesFrom:
      "It would come from an insurer's statement of sick pay paid on Greenway's behalf. No such " +
      "arrangement exists, so there is nothing to report and the box stays clear.",
    howToReadIt:
      "If this is ticked, some of the money on the W-2s underneath was paid by somebody other " +
      "than the employer, and box 14 of this form should have a figure in it. Ticked with box 14 " +
      "empty is a contradiction worth investigating.",
    commonMistake:
      "Confusing this with Washington Paid Family and Medical Leave. PFML benefits are paid by " +
      "the State to the employee and are not third-party sick pay reported on a W-2 by Greenway. " +
      "Ticking this box because the business has paid-leave withholding would be wrong.",
    whatToDo:
      "Leave it clear unless an insurance company sends a statement of sick pay it paid to a " +
      "Greenway employee. If one ever arrives, this box and box 14 are handled together.",
    examples: [
      {
        title: "Why Washington PFML does not tick this box",
        steps: [
          "Greenway withholds PFML premiums from employee pay and remits them to ESD.",
          "When an employee takes leave, ESD pays them directly.",
          "That payment is not wages Greenway reports on a W-2, so no W-2 has the box 13 " +
            "third-party sick pay tick.",
          "The instruction conditions this box on filing W-2s with that box 13 tick.",
        ],
        answer: "(not ticked)",
        moral:
          "The condition is a cross-reference to another box on another form. Read the condition, " +
          "not the box title — 'sick pay' sounds like it covers far more than it does.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box b—Third-party sick pay",
        quote:
          "Box b\u2014Third-party sick pay. Check this box if you are a\nthird-party sick pay payer (or are reporting sick pay\npayments made by a third party) filing Forms W-2 with the\n\u201cThird-party sick pay\u201d checkbox in box 13 checked. File a\nsingle Form W-3 for the regular and \u201cThird-party sick pay\u201d\nForms W-2. See 941.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The tick is conditioned on actually filing W-2s that have box 13's sick pay checkbox " +
          "ticked. No such W-2 exists at Greenway, so the condition fails and the box stays " +
          "clear. Note the last sentence too: this situation does NOT split the filing into two " +
          "transmittals, which is the opposite of the kind-of-payer rule above.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w3",
        box: "14",
        why:
          "These two travel together. This tick says third-party sick pay is present; box 14 " +
          "carries the income tax the third party withheld. One without the other is an " +
          "inconsistency the SSA can see.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "c",
    headline: "How many W-2s are in the envelope — a count of forms, never a sum of money",
    plainEnglish:
      "The number of completed individual Forms W-2 being transmitted with this W-3. Greenway's " +
      "2025 transmittal reports 10. The instruction adds one condition that catches software as " +
      "often as people: do not count W-2s marked VOID.",
    whereItComesFrom:
      "A count of the W-2 records generated for the year, EXCLUDING any marked void. This system " +
      "derives it from the same query that produces the money totals, so the count and the " +
      "amounts cannot be computed from different populations.",
    howToReadIt:
      "Compare it against the headcount you expect. Ten forms for a business with ten people who " +
      "were paid is right; ten forms when eleven people were paid means somebody is missing a " +
      "W-2 and will notice in April.",
    commonMistake:
      "Counting voided forms. A voided W-2 still exists in the payroll system, and a totals " +
      "query that forgets to exclude it produces a count one too high AND money totals that " +
      "overstate wages — while every individual W-2 underneath is perfectly correct. That is a " +
      "miserable error to trace in February, because nothing on any single form is wrong.",
    whatToDo:
      "Count the forms you are actually sending, ignore anything voided, and check the number " +
      "against your own list of people paid during the year before signing.",
    examples: [
      {
        title: "Greenway's 2025 count, as filed",
        steps: [
          "Ten W-2s were prepared for people paid during 2025.",
          "No form was voided, so no exclusion applied.",
          "Box c as filed: 10.",
        ],
        answer: "10",
        moral:
          "This is the only box on the form where the right answer is a number of PEOPLE. If it " +
          "ever renders with a dollar sign, the classifier is wrong, which is precisely why the " +
          "ownership table marks it as not money.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box c—Total number of Forms W-2",
        quote:
          "Box c\u2014Total number of Forms W-2. Show the number\nof completed individual Forms W-2 that you are\ntransmitting with this Form W-3. Do not count \u201cVOID\u201d\nForms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Two conditions in one short instruction: the forms must be COMPLETED, and they must be " +
          "ones you are actually TRANSMITTING. Voided forms fail both. The exclusion is the " +
          "sentence to remember, because it is the one a query forgets.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "d",
    headline: "An establishment number for splitting one EIN across sites",
    plainEnglish:
      "An optional identifier letting an employer separate establishments within one business. " +
      "You may file a separate W-3 for each establishment even though they share an EIN, or one " +
      "W-3 for all of them. Greenway files one transmittal for one location, so this is blank.",
    whereItComesFrom:
      "Nothing in this system. It would be a label Michael chose if Greenway ever ran multiple " +
      "sites under a single EIN and wanted the wage reports separated.",
    howToReadIt:
      "A blank means one establishment. If it is ever populated, the number of W-3s filed for the " +
      "year is no longer one, and every reconciliation against the 941s has to add them up first.",
    commonMistake:
      "Reading it as a required site or licence identifier and entering the state cannabis " +
      "licence number. It is a free-form internal label with no connection to any state register.",
    whatToDo:
      "Leave it blank while Greenway operates from one location. If a second retail site opens " +
      "under the same EIN, decide deliberately between one transmittal and several — the " +
      "instruction permits either.",
    examples: [
      {
        title: "One location, one transmittal",
        steps: [
          "Greenway operates from a single address in Port Orchard.",
          "The instructions permit a single W-3 for all W-2s of the same type.",
          "So no establishment split is needed and box d stays empty.",
        ],
        answer: "(blank)",
        moral:
          "Where the instructions offer a choice, the file should record which choice was made " +
          "and why. 'Blank because we chose one transmittal' is a decision; 'blank' alone is not.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box d—Establishment number",
        quote:
          "Box d\u2014Establishment number. You may use this box\nto identify separate establishments in your business. You\nmay file a separate Form W-3, with Forms W-2, for each\nestablishment even if they all have the same EIN; or you\nmay use a single Form W-3 for all Forms W-2 of the same\ntype.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'You may' twice in one instruction: this is a permission, not a requirement. The " +
          "sentence also quietly confirms that several W-3s can share one EIN, which is worth " +
          "knowing before assuming a one-to-one relationship between EIN and transmittal.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "e",
    headline: "The EIN — and it must match the 941s exactly, unmasked",
    plainEnglish:
      "Greenway's nine-digit Employer Identification Number, in the format 00-0000000. It must be " +
      "the same EIN shown on the Forms 941, and the instructions specifically forbid truncating " +
      "it. Greenway's is " +
      AS_FILED_2025_W3_EIN +
      ".",
    whereItComesFrom:
      "The company record. It is entered once and reused, so the risk is not typing it wrong here " +
      "but having it differ from what was used on the quarterly returns.",
    howToReadIt:
      "This is the join key. Everything the government does with this form starts by matching " +
      "this EIN to the 941s. Get it wrong and the wage report does not fail — it succeeds against " +
      "nothing, and the 941s appear to have no matching W-2s at all.",
    commonMistake:
      "Masking it the way SSNs are masked on employee copies. Truncation is permitted for an " +
      "employee's SSN on some copies; it is explicitly prohibited for the employer's EIN. The " +
      "second mistake is using a prior owner's EIN after an acquisition, which the instruction " +
      "also forbids and which box h exists to handle.",
    whatToDo:
      "Read the EIN off a filed 941 rather than from memory, and compare it character by " +
      "character against box e before filing. Nine digits, one hyphen, no asterisks.",
    examples: [
      {
        title: "Greenway's EIN across the year's filings",
        steps: [
          "The 2025 W-3 box e as filed: " + AS_FILED_2025_W3_EIN + ".",
          "The same EIN appears on the quarterly Forms 941 for the year.",
          "Format check: two digits, hyphen, seven digits, nothing masked.",
        ],
        answer: AS_FILED_2025_W3_EIN,
        moral:
          "An identifier is either identical or it is useless. There is no 'close enough' on a " +
          "matching key.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box e—Employer identification number (EIN)",
        quote:
          "Box e\u2014Employer identification number (EIN). Enter\nthe 9-digit EIN assigned to you by the IRS. The number\nshould be the same as shown on your Forms 941, 943,\n944, CT-1, or Schedule H (Form 1040) and in the\nfollowing format: 00-0000000. Do not truncate your EIN.\nSee Regulations section 31.6051-1(a)(1)(i)(A) and\n301.6109-4(b)(2)(iv). Do not use a prior owner\u2019s EIN.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Four separate requirements in one instruction: nine digits, same as the 941s, that " +
          "exact hyphenated format, and no truncation. The regulation cites are there because " +
          "the truncation rule is a regulation rather than a preference — it is the same body of " +
          "rules that PERMITS masking an employee's SSN, which is why people assume the EIN can " +
          "be masked too.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "1",
        why:
          "The EIN here must be the EIN on the quarterly returns. If they differ, the automatic " +
          "comparison between this transmittal and those returns finds nothing to compare, and " +
          "the mismatch surfaces as a notice rather than as an error message.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "f",
    headline: "The employer's name — the same name as on the 941s",
    plainEnglish:
      "Greenway's name as the employer. The instruction is short and specific: enter the SAME " +
      "name shown on your Forms 941. Not the trading name, not the licence name — the same name.",
    whereItComesFrom:
      "The company record. As with the EIN, the risk is divergence from the quarterly returns " +
      "rather than a typing error here.",
    howToReadIt:
      "Together with the EIN, this is how the filing is identified. A name that differs from the " +
      "941s is a soft failure: it usually still matches on EIN, and it still generates queries.",
    commonMistake:
      "Using a different form of the name than the 941s use — a DBA, an abbreviation, or the " +
      "name on the state licence. Greenway's filed 2025 W-3 shows this exact hazard in " +
      "practice: box f as filed reads a trading form of the name rather than anything derived " +
      "from this system, which is why this lesson exists at all.",
    whatToDo:
      "Copy the employer name from a filed 941, not from a letterhead. If the two have already " +
      "diverged, raise it with the accountant before changing either — a name change on a wage " +
      "report is not a cosmetic edit.",
    examples: [
      {
        title: "Why the name is checked against the 941 and not against the licence",
        steps: [
          "The instruction names one comparison: the Forms 941.",
          "It does not mention state licences, trade names, or signage.",
          "So the test is 'does it match the 941', and any other resemblance is irrelevant.",
        ],
        answer: "the name as shown on the Forms 941",
        moral:
          "When an instruction names its comparison, that comparison is the whole test. Adding " +
          "your own is how a correct form starts looking wrong.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box f—Employer's name",
        quote:
          "Box f\u2014Employer\u2019s name. Enter the same name as\nshown on your Forms 941, 943, 944, CT-1, or Schedule H\n(Form 1040).",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'The same name as shown on your Forms 941' is the entire rule. It makes the quarterly " +
          "returns the reference copy, which means this box can be checked mechanically rather " +
          "than argued about.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "1",
        why:
          "Same requirement as the EIN, and the same failure mode: the name on this transmittal " +
          "is compared against the name on the quarterly returns, so the returns are the " +
          "authority for what it should say.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "g",
    headline: "The employer's address",
    plainEnglish:
      "Greenway's address and ZIP code. The instruction is one sentence: enter your address. " +
      "There is no matching requirement and no format rule beyond being an address.",
    whereItComesFrom:
      "The company record. Unlike the name and EIN, the instructions attach no comparison to it.",
    howToReadIt:
      "This is where correspondence about the filing goes, so an out-of-date address turns a " +
      "letter that could have been answered into a deadline that was missed silently.",
    commonMistake:
      "Treating it as unimportant because it is not reconciled. Nothing checks it, which is " +
      "exactly why a stale address is dangerous: the failure is invisible until a notice does " +
      "not arrive.",
    whatToDo:
      "Confirm it is the address where post is actually opened. If it differs from the 941s, that " +
      "is permitted — but know which one the government will use.",
    examples: [
      {
        title: "Why an unreconciled box still matters",
        steps: [
          "The instructions attach no matching rule to box g.",
          "The SSA and IRS use it to reach the employer about this filing.",
          "A wrong address therefore produces no error and no letter.",
        ],
        answer: "the address where post is opened",
        moral:
          "Some boxes are checked by a computer and some are checked by reality. This one is the " +
          "second kind.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box g—Employer's address and ZIP code",
        quote: "Box g\u2014Employer\u2019s address and ZIP code. Enter your\naddress.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Quoted precisely because of how little it says. There is no matching requirement here, " +
          "and knowing that an instruction is silent is as useful as knowing what it demands — it " +
          "stops you inventing a rule and then worrying about breaking it.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "h",
    headline: "Another EIN used during the year — including a prior owner's",
    plainEnglish:
      "If any 941 filed for the year used a DIFFERENT EIN from the one in box e, that other EIN " +
      "goes here. It is how a mid-year change of EIN — typically an acquisition — is declared. " +
      "Greenway's EIN has not changed, so this is blank.",
    whereItComesFrom:
      "Nothing in this system today. It would come from the filing history if Greenway's EIN " +
      "ever changed mid-year.",
    howToReadIt:
      "A populated box h means the year's wages were reported to the IRS under two different " +
      "EINs, and the reconciliation has to consider both. A blank means one EIN all year.",
    commonMistake:
      "Leaving it blank after an acquisition while the earlier quarters were filed under the " +
      "seller's EIN. The wages then appear to have come from nowhere, because the 941s under the " +
      "old EIN have no transmittal pointing at them. Box e's instruction and this box are two " +
      "halves of one rule: do not use a prior owner's EIN in box e, declare it here instead.",
    whatToDo:
      "Leave blank. If Greenway's EIN ever changes, or an entity is acquired, populate this and " +
      "raise the whole year's filings with the accountant.",
    examples: [
      {
        title: "The acquisition case, spelled out",
        steps: [
          "Suppose a business is bought on 1 July and Q1 and Q2 941s were filed under the " +
            "seller's EIN.",
          "Box e carries the buyer's EIN, because box e's instruction forbids using a prior " +
            "owner's.",
          "Box h then carries the seller's EIN, so the earlier quarters can be matched.",
          "Greenway has had no such event, so both halves are simply: box e populated, box h blank.",
        ],
        answer: "(blank)",
        moral:
          "Two boxes that look independent are one rule. Reading box e's 'do not use a prior " +
          "owner's EIN' without box h leaves you with nowhere to put a fact that still needs " +
          "reporting.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box h—Other EIN used this year",
        quote:
          "Box h\u2014Other EIN used this year. If you have used an\nEIN (including a prior owner\u2019s EIN) on Forms 941, 943,\n944, or CT-1 submitted for 2026 that is different from the\nEIN reported on Form W-3 in box e, enter the other EIN\nused. Agents generally report the employer\u2019s EIN in box h.\nSee Agent reporting.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The trigger is precise: an EIN used on a 941 for this year that differs from box e. " +
          "That is a checkable condition rather than a judgement call. The sentence about agents " +
          "matters if a payroll bureau ever files on Greenway's behalf under its own EIN.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w3",
        box: "e",
        why:
          "These two are one rule in two boxes. Box e forbids a prior owner's EIN; box h is where " +
          "that EIN goes instead. Reading either alone leaves a real fact with nowhere to go.",
      },
    ],
  },

  /* ═══════════════════════════════════════════════════════════════════════
   * THE MONEY BOXES — every one a total of the W-2s underneath
   * ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: "form_w3",
    box: "1",
    headline: "Total taxable wages across every W-2 in the envelope",
    plainEnglish:
      "Box 1 of every W-2 being transmitted, added up. Nothing is recomputed at this level: if " +
      "the individual box 1s are right, this is right, and if one of them is wrong, this is wrong " +
      "in exactly that amount. Greenway's 2025 transmittal reports $332,975.44 across ten forms.",
    whereItComesFrom:
      "A sum over the same W-2 records the individual forms are printed from, excluding any marked " +
      "VOID. It is deliberately not a separate calculation — a second computation of the same " +
      "figure is a second chance to disagree.",
    howToReadIt:
      "Add box 2 of the four quarterly 941s and compare. Those two numbers describe the same " +
      "wages, once quarterly to the IRS and once annually to the SSA. A difference is not a " +
      "rounding matter; it means one of the five filings has the wrong wage figure in it.",
    commonMistake:
      "Including voided W-2s. Every individual form remains correct while this total overstates " +
      "wages, so the error cannot be found by checking the W-2s — only by re-running the total " +
      "with the exclusion applied.",
    whatToDo:
      "Before filing, total box 1 across the W-2s you are actually sending and compare it against " +
      "this box, then against the four 941s. Do it in January while a correction is still a " +
      "redraft rather than a W-2c plus a W-3c.",
    examples: [
      {
        title: "Greenway's 2025 box 1, as filed",
        steps: [
          "Ten W-2s were transmitted, none voided.",
          "Box 1 as filed: $332,975.44.",
          "Boxes 1, 3 and 5 as filed are all the same figure: $332,975.44.",
          "That equality is possible and common in a business with no pre-tax retirement " +
            "deferrals and nobody above the Social Security wage base.",
        ],
        answer: "$332,975.44",
        moral:
          "Three boxes agreeing is not proof of correctness and not evidence of error. It is a " +
          "fact that needs an explanation, and 'no deferrals, nobody near the wage base' is one.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Tip: The amounts to enter in boxes 1 through 19",
        quote:
          "Tip: The amounts to enter in boxes 1 through 19,\ndescribed next, are totals from only the Forms W-2\n(excluding any Forms W-2 marked \u201cVOID\u201d) that you are\nsending with this Form W-3.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "This single Tip governs every money box on the form, which is why it is quoted here " +
          "rather than repeated nineteen times. Two conditions: totals from the forms you are " +
          "SENDING, and VOID forms excluded. Both are the kind of thing a totals query gets " +
          "wrong silently.",
      },
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'Enter the totals reported' — reported on the W-2s, not recalculated from payroll. " +
          "That wording is the authority for treating this form as arithmetic over the W-2s. It " +
          "also means a W-2 error propagates here unchanged rather than being caught.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "1",
        why:
          "This box is the sum of that one across every W-2 in the envelope. The relationship is " +
          "addition, so it can be checked with a calculator rather than reasoned about.",
      },
      {
        formId: "form_941",
        box: "2",
        why:
          "The four quarterly line 2s report the same wages to the IRS that this box reports to " +
          "the SSA. The two agencies compare them, so they must agree.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "2",
    headline: "Total federal income tax withheld — one of the four boxes the IRS reconciles",
    plainEnglish:
      "Box 2 of every W-2, added up: all the federal income tax taken out of employees' pay " +
      "during the year. Greenway's 2025 transmittal reports $16,118.41. This is one of the FOUR " +
      "boxes the instructions single out for reconciliation against the 941s.",
    whereItComesFrom:
      "A sum of the withheld federal income tax on every W-2 in the envelope. It is employees' " +
      "money throughout — Greenway held it briefly and paid it over.",
    howToReadIt:
      "Add line 3 of the four quarterly 941s and compare. If the annual total here exceeds what " +
      "the quarterly returns reported, tax was withheld that was never deposited, which is a " +
      "considerably more serious problem than a reporting mismatch.",
    commonMistake:
      "Adding the employer's own tax payments into this box. Nothing Greenway pays out of its own " +
      "funds belongs here — this box is exclusively money withheld from other people's wages.",
    whatToDo:
      "Total line 3 across all four 941s and check it equals this box. Because it is one of the " +
      "four reconciled figures, a mismatch here produces a letter automatically.",
    examples: [
      {
        title: "Greenway's 2025 box 2, as filed",
        steps: [
          "Box 2 as filed: $16,118.41.",
          "This is the sum of federal income tax withheld across all ten W-2s.",
          "The check: line 3 of Q1 + Q2 + Q3 + Q4 of the 941s should equal it.",
        ],
        answer: "$16,118.41",
        moral:
          "Unlike boxes 1, 3 and 5, there is no rate that predicts this figure — withholding " +
          "depends on each employee's W-4. So the only available check is against the 941s, " +
          "which makes that check the whole of the assurance.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Reconciling Forms W-2, W-3, 941, 943, 944, CT-1, and Schedule H (Form 1040)",
        quote:
          "Reconcile the amounts shown in boxes 2, 3, 5, and 7 from\nall 2026 Forms W-3 with their respective amounts from the\n2026 yearly totals from the quarterly Forms 941 or annual\nForms 943, 944, CT-1 (box 2 only), and Schedule H (Form\n1040). When there are discrepancies between amounts\nreported on Forms W-2 and W-3 filed with the SSA and on\nForms 941, 943, 944, CT-1, or Schedule H (Form 1040)\nfiled with the IRS, you will be contacted to resolve the\ndiscrepancies.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Read the last clause: 'you WILL be contacted', not 'may be'. Four boxes — 2, 3, 5 and " +
          "7 — are compared automatically against the year's 941s. Both sides of that comparison " +
          "are already in this system, so it costs nothing to run it in October, when the quarter " +
          "that caused a difference can still be amended calmly.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "2",
        why: "This box is the sum of that one across every W-2 being transmitted.",
      },
      {
        formId: "form_941",
        box: "3",
        why:
          "One of the four explicitly reconciled figures. The four quarterly line 3s must total " +
          "to this box, and the government checks it without being asked.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "3",
    headline: "Total Social Security wages — reconciled, and capped per person before it gets here",
    plainEnglish:
      "Box 3 of every W-2, added up. Each individual box 3 was already capped at that year's " +
      "Social Security wage base before being totalled, so this figure can be smaller than box 1 " +
      "even though it is a total of the same people's pay. Greenway's 2025 transmittal reports " +
      "$332,975.44 — the same as box 1.",
    whereItComesFrom:
      "A sum of the Social Security wage figures on the W-2s. The per-person cap is applied on " +
      "each W-2, never at this level: capping a total would be wrong, because the ceiling is per " +
      "employee.",
    howToReadIt:
      "Compare with box 1. Lower than box 1 usually means somebody was paid above the wage base, " +
      "or there are pre-tax deferrals that reduce income tax but not Social Security wages. Equal " +
      "to box 1, as Greenway's is, means neither applies. Then add line 5a column 1 across the " +
      "four 941s and compare.",
    commonMistake:
      "Applying the wage base to this total rather than to each W-2. Ten people at $40,000 are " +
      "nowhere near the cap individually while their total is far above it, so capping here would " +
      "understate Social Security wages by a very large amount and look plausible while doing so.",
    whatToDo:
      "Check this box equals the sum of box 3 across the W-2s, then check it against line 5a of " +
      "the four 941s. It is one of the four reconciled boxes, so the comparison is not optional.",
    examples: [
      {
        title: "Why the cap is per person and not per form",
        steps: [
          "Greenway's box 3 as filed: $332,975.44 across ten W-2s.",
          "The 2025 Social Security wage base was far below that total.",
          "If the cap applied to the total, box 3 would have been reported at the wage base.",
          "It was not, and that is correct: no single employee exceeded the base, so no W-2 was " +
            "capped, so the total is simply the sum.",
        ],
        answer: "$332,975.44",
        moral:
          "A limit that applies per person cannot be tested against a total. The total being " +
          "above a per-person ceiling means nothing at all.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'The totals reported... on the Forms W-2' is what makes the per-person cap the W-2's " +
          "problem and not this form's. This box adds up figures that have already had every " +
          "individual limit applied to them.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "3",
        why:
          "This box totals that one. The wage base ceiling lives there, per person, and is " +
          "already inside the numbers being added here.",
      },
      {
        formId: "form_941",
        box: "5a",
        why:
          "One of the four reconciled figures. Four quarters of line 5a column 1 must equal this " +
          "box.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "4",
    headline: "Total Social Security tax withheld — the employees' halves only",
    plainEnglish:
      "Box 4 of every W-2, added up: the 6.2% withheld from employees. Greenway's matching 6.2% " +
      "appears on no W-2, so it appears nowhere on this form either. Greenway's 2025 transmittal " +
      "reports $20,644.48.",
    whereItComesFrom:
      "A sum of Social Security tax withheld across the W-2s. Employer-side tax is not part of " +
      "it, at any point.",
    howToReadIt:
      "Divide by box 3 and expect roughly 6.2%. Then compare against the 941s and expect " +
      "APPROXIMATELY DOUBLE this figure there, because the 941 reports both halves while the W-3 " +
      "reports one. A ratio far from 2 is worth understanding rather than accepting.",
    commonMistake:
      "Expecting box 4 of this form to equal the Social Security tax on the 941. It should be " +
      "about half of it. Treating the 941 figure as the target is how the employer's share ends " +
      "up double-counted as employee withholding.",
    whatToDo:
      "Check box 4 against box 3 at 6.2% as an order-of-magnitude test, then check the 941 " +
      "relationship. Both checks are cheap and they fail in different ways.",
    examples: [
      {
        title: "Greenway's 2025 box 4 recomputed from box 3",
        steps: [
          "Box 3 as filed: $332,975.44.",
          "Employee Social Security rate: 6.2%.",
          "$332,975.44 x 6.2% = $20,644.477, which rounds to $20,644.48.",
          "Box 4 as filed: $20,644.48. It agrees exactly.",
        ],
        answer: "$20,644.48",
        moral:
          "Where a statutory rate governs, the box can be recomputed rather than trusted. This " +
          "one recomputes to the cent, which is real assurance rather than a plausible-looking " +
          "number.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The instruction sends you to the W-2s, and the W-2's own box 4 instruction says " +
          "'(not your share)'. Following the chain is what establishes that the employer half is " +
          "absent here — this form never says so itself.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "4",
        why:
          "This box totals that one, and that one carries the IRS's parenthetical '(not your " +
          "share)'. The exclusion of the employer half is inherited from there.",
      },
      {
        formId: "form_941",
        box: "5a",
        why:
          "Line 5a column 2 reports BOTH halves of Social Security tax for the quarter. Four " +
          "quarters of it should be approximately twice this box — the check is a ratio, not an " +
          "equality.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "5",
    headline: "Total Medicare wages — uncapped, which is why it can exceed box 3",
    plainEnglish:
      "Box 5 of every W-2, added up. Medicare wages have no ceiling, unlike Social Security " +
      "wages, so once anybody is paid above the Social Security wage base this figure rises above " +
      "box 3. Greenway's 2025 transmittal reports $332,975.44 — equal to boxes 1 and 3.",
    whereItComesFrom:
      "A sum of the Medicare wage figures across the W-2s. No cap is applied at any level, " +
      "because none exists.",
    howToReadIt:
      "Box 5 below box 3 is close to impossible and should be investigated immediately: it would " +
      "mean an uncapped base came out smaller than a capped one. Box 5 above box 3 is normal and " +
      "means somebody crossed the wage base. Equal, as here, means nobody did.",
    commonMistake:
      "Applying the Social Security wage base to this box because it was applied to box 3. There " +
      "is no Medicare wage base. The tax rate is lower and the base is unlimited, which is why " +
      "the two boxes are reported separately at all.",
    whatToDo:
      "Confirm box 5 is at least box 3, and check it against line 5c of the four 941s. It is the " +
      "third of the four reconciled figures.",
    examples: [
      {
        title: "Why boxes 3 and 5 are equal on Greenway's 2025 W-3",
        steps: [
          "Box 3 as filed: $332,975.44. Box 5 as filed: $332,975.44.",
          "Box 5 exceeds box 3 only when an individual's pay passes the Social Security wage base.",
          "No Greenway employee's 2025 pay approached that base.",
          "So the two bases contain the same wages and the totals are identical.",
        ],
        answer: "$332,975.44",
        moral:
          "Two boxes being equal is a CONSEQUENCE of the facts, not a rule about the form. The " +
          "day Greenway pays someone above the wage base, they stop being equal and nothing has " +
          "gone wrong.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Same one-line rule governs boxes 1 through 8: this form totals what the W-2s report. " +
          "The absence of a Medicare cap is a fact about the underlying wage rules, not " +
          "something this instruction addresses — which is exactly why it must not be invented " +
          "here.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "5",
        why: "This box totals that one across every W-2 in the envelope.",
      },
      {
        formId: "form_941",
        box: "5c",
        why:
          "One of the four reconciled figures. Four quarters of line 5c column 1 must equal this " +
          "box.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "6",
    headline: "Total Medicare tax withheld — and the two cents that prove the check works",
    plainEnglish:
      "Box 6 of every W-2, added up: the employees' 1.45% Medicare withholding, plus any " +
      "Additional Medicare Tax, which has no employer match. Greenway's 2025 transmittal reports " +
      "$4,828.12. Recomputing 1.45% of box 5 gives $4,828.14 — two cents more.",
    whereItComesFrom:
      "A sum of Medicare tax withheld across the W-2s. Because each W-2's figure is itself a sum " +
      "of per-paycheque roundings, the annual total is not required to equal the annual wage base " +
      "times the annual rate.",
    howToReadIt:
      "Recompute 1.45% of box 5 and expect a difference of a few cents, not zero. Each payroll " +
      "run rounds to the cent, and those roundings accumulate. A difference of a few cents is " +
      "ordinary; a difference of dollars is not.",
    commonMistake:
      "'Correcting' box 6 to match a rate calculation. The withheld figure is the sum of what was " +
      "actually withheld, and overwriting it with a recomputation makes it disagree with the " +
      "W-2s, the payroll records and the employees' pay stubs all at once — to fix a two-cent " +
      "difference that the 941 already accounts for.",
    whatToDo:
      "When the recomputation differs by cents, look at line 7 of the 941s — the fractions-of-" +
      "cents adjustment — before touching anything. That line exists for this. If it explains " +
      "the difference, the forms are consistent and nothing needs changing.",
    examples: [
      {
        title: "The two-cent difference on Greenway's 2025 filings, traced end to end",
        steps: [
          "Box 5 as filed: $332,975.44. Employee Medicare rate: 1.45%.",
          "$332,975.44 x 1.45% = $4,828.1439, which rounds to $4,828.14.",
          "Box 6 as filed: $4,828.12. The difference is $0.02, with the form LOWER.",
          "Greenway's Q1 2025 Form 941, line 7 (current quarter's adjustment for fractions of " +
            "cents), as filed: -$0.02.",
          "The same two cents, disclosed on the quarterly return in the box the IRS provides " +
            "for it.",
          "So the withheld total, the W-2s and the 941s are consistent with each other.",
        ],
        answer: "$4,828.12 as filed, and the $0.02 is explained by 941 line 7",
        moral:
          "This is why a lesson is written from the instructions and then CHECKED against the " +
          "filings, rather than written from the filings. Describing the form would have said " +
          "'box 6 is $4,828.12' and taught nothing. Recomputing it raised a two-cent question, " +
          "and following that question to 941 line 7 is what turned a discrepancy into evidence " +
          "that the system is coherent. A difference you can explain is worth more than an " +
          "agreement you cannot.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The instruction says total what the W-2s REPORT — the amounts actually withheld. It " +
          "does not say compute 1.45% of box 5. That distinction is the entire content of the " +
          "two-cent example above, and it is the reason overwriting box 6 with a rate " +
          "calculation would be a defect rather than a tidy-up.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "6",
        why:
          "This box totals that one, including any Additional Medicare Tax, which has no " +
          "employer match and so breaks the neat doubling relationship with the 941.",
      },
      {
        formId: "form_941",
        box: "7",
        why:
          "Line 7 is the fractions-of-cents adjustment, and it is where a small difference " +
          "between withheld tax and computed tax is disclosed. Greenway's Q1 2025 line 7 of " +
          "-$0.02 is the counterpart of the two cents in this box.",
      },
      {
        formId: "form_941",
        box: "5c",
        why:
          "Line 5c column 2 carries both halves of Medicare tax for the quarter, so four " +
          "quarters of it should be approximately twice this box. Additional Medicare Tax, if " +
          "any, moves the ratio below 2 legitimately.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "7",
    headline: "Total Social Security tips — the fourth reconciled box, and blank for Greenway",
    plainEnglish:
      "Box 7 of every W-2, added up: tips employees reported to the employer that are subject to " +
      "Social Security tax. Greenway is a retailer that does not take tips, so this is blank — and " +
      "a blank here is a reported figure of zero for reconciliation purposes.",
    whereItComesFrom:
      "A sum of reported Social Security tips across the W-2s. Greenway's payroll has no tip " +
      "category, so every W-2's box 7 is empty and so is the total.",
    howToReadIt:
      "This is the fourth of the four boxes the IRS reconciles automatically. Blank is a perfectly " +
      "good answer, but it is an answer: it says no tips were reported, and the 941s must say the " +
      "same.",
    commonMistake:
      "Assuming a blank box is exempt from reconciliation. It is one of the four compared figures. " +
      "If any 941 reported tips on line 5b for the year while this box is blank, that is a " +
      "discrepancy in exactly the way a wrong number would be.",
    whatToDo:
      "Leave blank while Greenway has no tips, and confirm line 5b of every 941 for the year is " +
      "also blank. Two blanks that agree are a completed check, not a skipped one.",
    examples: [
      {
        title: "A blank box that still gets reconciled",
        steps: [
          "Greenway takes no tips, so no W-2 has a box 7 figure.",
          "Box 7 of the W-3 is therefore blank.",
          "The instructions name boxes 2, 3, 5 and 7 as the reconciled set.",
          "So the check is: 941 line 5b, all four quarters, must also be nil.",
        ],
        answer: "(blank)",
        moral:
          "'Nothing to report' and 'nothing to check' are different statements. The reconciliation " +
          "list does not skip a box because its value is zero.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Reconciling Forms W-2, W-3, 941, 943, 944, CT-1, and Schedule H (Form 1040)",
        quote:
          "Reconcile the amounts shown in boxes 2, 3, 5, and 7 from\nall 2026 Forms W-3 with their respective amounts from the\n2026 yearly totals from the quarterly Forms 941 or annual\nForms 943, 944, CT-1 (box 2 only), and Schedule H (Form\n1040). When there are discrepancies between amounts\nreported on Forms W-2 and W-3 filed with the SSA and on\nForms 941, 943, 944, CT-1, or Schedule H (Form 1040)\nfiled with the IRS, you will be contacted to resolve the\ndiscrepancies.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Box 7 is named explicitly in the reconciled set, alongside boxes 2, 3 and 5. That is " +
          "the authority for checking a box that will be empty every year Greenway operates as " +
          "it does now — the check is cheap and its absence is invisible.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "7",
        why: "This box totals that one across every W-2 in the envelope.",
      },
      {
        formId: "form_941",
        box: "5b",
        why:
          "The fourth reconciled figure. Four quarters of taxable Social Security tips must " +
          "equal this box — including when both sides are nil.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "8",
    headline: "Total allocated tips — a figure that feeds nothing, and only large restaurants file it",
    plainEnglish:
      "Box 8 of every W-2, added up. Allocated tips are amounts a large food or beverage " +
      "establishment must attribute to employees when reported tips fall short of a statutory " +
      "percentage of receipts. Greenway is not such an establishment, so this is blank.",
    whereItComesFrom:
      "A sum across the W-2s. There is no Greenway source for it, and there will not be one " +
      "unless the business becomes a large food or beverage establishment.",
    howToReadIt:
      "Allocated tips are deliberately excluded from boxes 1, 3, 5 and 7. So a figure here does " +
      "NOT flow into any tax base on this form — it is reported to the employee so they can deal " +
      "with it on their own return.",
    commonMistake:
      "Adding box 8 into the wage totals because it looks like compensation. It is reported " +
      "separately precisely because it is not included in the other boxes, and adding it would " +
      "overstate every wage base on the form.",
    whatToDo:
      "Leave blank. If Greenway ever operates a food or beverage business, this box and the tip " +
      "allocation rules come as a set and need looking at properly.",
    examples: [
      {
        title: "A wage-shaped figure that is not in any wage base",
        steps: [
          "Allocated tips exist only for large food or beverage establishments.",
          "They are excluded from boxes 1, 3, 5 and 7 by design.",
          "So even a populated box 8 changes no tax computed on this form.",
          "Greenway has none, so the box is blank.",
        ],
        answer: "(blank)",
        moral:
          "Not every number on a tax form feeds a tax. Knowing which figures are informational is " +
          "what stops them being swept into a total that matters.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
        quote: "Boxes 1 through 8. Enter the totals reported in boxes 1\nthrough 8 on the Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Box 8 is inside the 'boxes 1 through 8' range, so the same totalling rule applies. " +
          "Note what the instruction does NOT do: it does not add box 8 into any other box. The " +
          "separation is structural.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "8",
        why: "This box totals that one, and that one is excluded from the wage boxes by design.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "9",
    headline: "A retired box — the instruction is 'do not enter an amount'",
    plainEnglish:
      "Box 9 is not used. The instruction is a single sentence: do not enter an amount in box 9. " +
      "It is printed on the form without a caption, which is what makes it look like an omission " +
      "rather than a closure.",
    whereItComesFrom:
      "Nothing. There is no figure and there is no longer a purpose. It formerly carried an " +
      "advance earned income credit that no longer exists.",
    howToReadIt:
      "An empty box 9 is compliance, not incompleteness. Anything in it is wrong regardless of " +
      "what it is.",
    commonMistake:
      "Filling it because it is blank and unlabelled, and a blank unlabelled box on a tax form " +
      "looks like something forgotten. Some accounting software has historically put a total " +
      "here on the theory that an empty box must want a number.",
    whatToDo:
      "Leave it empty, and if any software populates it, that is a defect in the software rather " +
      "than a figure to reconcile.",
    examples: [
      {
        title: "The clearest instruction on the form",
        steps: [
          "The instruction reads: do not enter an amount in box 9.",
          "There is no condition and no exception attached to it.",
          "So the correct entry is nothing, in every case, for every filer.",
        ],
        answer: "(nothing)",
        moral:
          "A prohibition is easier to satisfy than a computation, and easier to get wrong, " +
          "because the box looks like it is waiting for something.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 9",
        quote: "Box 9. Do not enter an amount in box 9.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "Unconditional. No 'unless', no 'except'. This is the authority for the ownership table " +
          "classifying box 9 as not money at all: the instructions forbid an amount, so there is " +
          "no amount that could belong to anybody.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "10",
    headline: "Total dependent care benefits — reported so employees can claim an exclusion",
    plainEnglish:
      "Box 10 of every W-2, added up: benefits provided under a dependent care assistance " +
      "programme. Greenway has no such programme, so this is blank. The figure is informational — " +
      "no tax on this form is computed from it.",
    whereItComesFrom:
      "A sum across the W-2s. Greenway operates no section 129 plan, so every underlying box 10 " +
      "is empty.",
    howToReadIt:
      "A figure here tells employees what to put on their own returns when working out how much " +
      "of the benefit is excludable. It changes no total on this form.",
    commonMistake:
      "Confusing it with health insurance. Dependent care means childcare and similar; health " +
      "premiums are an entirely different rule and appear elsewhere. Greenway's health premiums " +
      "are reported in box 14 of the individual W-2s and do not touch box 10.",
    whatToDo:
      "Leave blank unless a dependent care assistance programme is actually established, which " +
      "is a plan document rather than a payroll setting.",
    examples: [
      {
        title: "Why Greenway's health premiums are not in box 10",
        steps: [
          "Box 10 covers dependent care assistance under section 129.",
          "Health insurance premiums are governed by different rules entirely.",
          "Greenway's 2025 W-2s report health amounts in box 14, not box 10.",
          "So box 10 on the transmittal is blank and that is correct.",
        ],
        answer: "(blank)",
        moral:
          "Two benefits that both feel like 'employer looks after the family' are two unrelated " +
          "boxes. The names on the form are narrower than the words suggest.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 10—Dependent care benefits",
        quote:
          "Box 10\u2014Dependent care benefits (not applicable to\nForms W-2AS, W-2CM, W-2GU, and W-2VI). Enter the\ntotal reported in box 10 on Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "On the W-3 this is a one-line totalling instruction, and that is the whole of it. Worth " +
          "flagging: the same heading appears in the W-2 instructions attached to a long passage " +
          "about section 129 plans. The rules about WHAT is a dependent care benefit live there; " +
          "the rule about what goes in this box is only this sentence.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "10",
        why: "This box totals that one, where the substantive dependent care rules apply.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "11",
    headline: "Total nonqualified plan distributions — a timing signal for the SSA",
    plainEnglish:
      "Box 11 of every W-2, added up. Its purpose is to tell the SSA whether part of the wages " +
      "reported was actually EARNED in an earlier year, so the earnings test is applied to the " +
      "right year. Greenway has no nonqualified plan, so this is blank.",
    whereItComesFrom:
      "A sum across the W-2s. There is no Greenway source and no plan.",
    howToReadIt:
      "This box is about WHEN money was earned, not how much tax is due. That is unusual on a tax " +
      "form and it is why the box exists at all.",
    commonMistake:
      "Using it for accrued or deferred pay generally. It is specific to nonqualified deferred " +
      "compensation and nongovernmental section 457(b) plans; accumulated sick pay and vacation " +
      "pay are explicitly not reported here.",
    whatToDo:
      "Leave blank. If a deferred compensation arrangement is ever set up for Michael or family " +
      "members, this box becomes relevant and the rules are involved enough to need the " +
      "accountant.",
    examples: [
      {
        title: "A box that reports a date, not an amount of tax",
        steps: [
          "The SSA applies an earnings test based on the year wages were EARNED.",
          "Deferred compensation is PAID in a later year than it was earned.",
          "Box 11 flags that mismatch so benefits are computed correctly.",
          "Greenway has no such arrangement, so the box is blank.",
        ],
        answer: "(blank)",
        moral:
          "Understanding why a box exists is what tells you whether it applies. 'Do we have a " +
          "nonqualified plan?' is answerable; 'does box 11 apply?' is not, until you know what it " +
          "is for.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 11—Nonqualified plans",
        quote: "Box 11\u2014Nonqualified plans. Enter the total reported in\nbox 11 on Forms W-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "A pure totalling instruction, like most of this form. The substantive rules — what a " +
          "nonqualified plan is, and the caution about not completing box 11 when also reporting " +
          "deferrals in boxes 3 and 5 — live in the W-2 instructions, and that is where to go " +
          "before ever putting a figure here.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "11",
        why: "This box totals that one, where the nonqualified plan rules actually operate.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "12a",
    headline: "The one money box that is a FILTER, not a total",
    plainEnglish:
      "Every other money box on this form adds up the same box across the W-2s. Box 12a does not. " +
      "It carries only the deferral codes — D through H, S, Y, AA, BB and EE — and deliberately " +
      "leaves out everything else in box 12, including code DD for the cost of health coverage. " +
      "Greenway has no deferrals, so this is blank.",
    whereItComesFrom:
      "A FILTERED sum over the W-2s' box 12 entries, keeping only the listed codes. The filter is " +
      "the whole content of the box.",
    howToReadIt:
      "If box 12a is populated, retirement deferrals happened, and box 13's Retirement plan " +
      "checkbox on the underlying W-2s should generally be ticked. A figure here with no " +
      "retirement plan anywhere is a contradiction.",
    commonMistake:
      "Totalling all of box 12 and putting it here. This is the single most likely place for " +
      "generating software to be wrong, because every neighbouring box IS a straight total. " +
      "Sweeping in code DD reports health coverage costs as deferred compensation — a figure the " +
      "IRS is not expecting, in a box it watches.",
    whatToDo:
      "If Greenway ever starts a 401(k), check that only the listed codes reach this box, and " +
      "check it by looking at what code DD does NOT do to it. The Caution in the instructions " +
      "lists the excluded codes explicitly.",
    examples: [
      {
        title: "What would go wrong if box 12a were treated as a total",
        steps: [
          "Suppose an employee's W-2 had code DD of $12,000 for health coverage and no deferrals.",
          "Box 12a as a straight total would report $12,000 of deferred compensation.",
          "The instruction's Caution names code DD among the codes NOT reported on Form W-3.",
          "So the correct box 12a in that scenario is blank, not $12,000.",
          "Greenway has no deferrals in 2025, so the box is blank either way — but for the right " +
            "reason.",
        ],
        answer: "(blank)",
        moral:
          "The right answer for the wrong reason breaks the first time the facts change. Knowing " +
          "box 12a is a filter matters most on the day Greenway starts a retirement plan.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12a—Deferred compensation",
        quote:
          "Box 12a\u2014Deferred compensation. Enter the total of all\namounts reported with codes D through H, S, Y, AA, BB,\nand EE in box 12 on Forms W-2. Do not enter a code.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "An enumerated list of codes, which is what makes this a filter rather than a total. " +
          "Also note 'Do not enter a code' — the W-2 pairs a code with an amount, and this box " +
          "takes the amount alone.",
      },
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12a—Deferred compensation, Caution",
        quote:
          "Caution: The total of Form W-2 box 12 amounts reported\nwith codes A through C, J through R, T through W, Z, DD,\nFF through II, TA, TP, and TT is not reported on Form W-3.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The IRS lists the EXCLUDED codes explicitly, which is unusually helpful and makes the " +
          "filter testable in both directions: the included set is enumerated above and the " +
          "excluded set is enumerated here. Code DD sits in this list, and it is the one most " +
          "likely to be large.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "12",
        why:
          "This box draws from that one, but only for the enumerated deferral codes. The " +
          "relationship is a filter, so a straight comparison of totals should NOT match unless " +
          "every box 12 entry happens to be a deferral.",
      },
      {
        formId: "form_w2",
        box: "13",
        why:
          "Deferrals reaching box 12a generally mean the Retirement plan checkbox in box 13 of " +
          "the underlying W-2 should be ticked. A figure here with no tick there is worth checking.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "12b",
    headline: "A printed slot the instructions never describe — and we will not invent a rule for it",
    plainEnglish:
      "The form as generated prints a second slot beneath box 12a labelled 12b. The IRS General " +
      "Instructions for Forms W-2 and W-3 contain NO heading for a W-3 box 12b — searching all " +
      "4,216 lines of the mirrored instructions for it returns nothing. Greenway's 2025 W-3 " +
      "prints the label with nothing in it.",
    whereItComesFrom:
      "Nothing, and that is the honest answer. No instruction describes what would belong here, " +
      "so this system computes nothing for it.",
    howToReadIt:
      "Treat it as empty. It is classified as not money in the ownership table for the same " +
      "reason: no authority says an amount belongs here, and a box with no rule cannot be given " +
      "one by inference.",
    commonMistake:
      "Assuming it mirrors the W-2, where boxes 12a through 12d are four slots for four coded " +
      "items. The W-3 has ONE deferred compensation box, and the instruction for it says 'Do not " +
      "enter a code' — so the multi-slot logic of the W-2 does not carry over.",
    whatToDo:
      "Leave it empty. This is a documented gap rather than a solved problem: if it ever needs to " +
      "carry something, the instruction authorising it has to be found first. Nothing is entered " +
      "on the strength of it looking like a box that wants a number.",
    examples: [
      {
        title: "What was actually searched, and what was found",
        steps: [
          "The mirrored IRS General Instructions for Forms W-2 and W-3 run to 4,216 lines.",
          "There is no 'Box 12b' heading anywhere in the Form W-3 section.",
          "The only box 12 instruction for the W-3 is box 12a, which says 'Do not enter a code'.",
          "Greenway's 2025 W-3 prints 12b empty.",
          "Conclusion recorded: printed, undocumented, left blank, no authority fabricated.",
        ],
        answer: "(blank — no instruction exists)",
        moral:
          "The honest answer to 'what goes here' is sometimes 'the instructions do not say'. " +
          "Writing a confident sentence to fill the gap would be the one thing worse than the gap.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12a—Deferred compensation",
        quote:
          "Box 12a\u2014Deferred compensation. Enter the total of all\namounts reported with codes D through H, S, Y, AA, BB,\nand EE in box 12 on Forms W-2. Do not enter a code.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "This is the ONLY box 12 instruction in the Form W-3 section, and it is quoted here " +
          "precisely to show what is absent: there is no 12b counterpart. 'Do not enter a code' " +
          "also rules out the natural guess that 12b is a second code-and-amount pair like the " +
          "W-2's. The quote is evidence of a gap, which is the only honest citation available.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w3",
        box: "12a",
        why:
          "12a is the only documented box 12 on this form. This slot is tied to it because 12a's " +
          "instruction — a single filtered figure, no code — is the evidence that no second slot " +
          "was contemplated.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "13",
    headline: "For third-party sick pay use only — the instruction is 'leave this box blank'",
    plainEnglish:
      "Reserved for third-party sick pay filers. The instruction to everyone else is two words: " +
      "leave blank. Greenway leaves it blank.",
    whereItComesFrom:
      "Nothing in Greenway's payroll maps to this box. It would be fed by a statement from an " +
      "insurer or other third party who paid sick pay on Greenway's behalf, and no such party " +
      "exists, so there is no figure to carry here.",
    howToReadIt:
      "Blank is the instructed value. Note that this is a different box from the third-party sick " +
      "pay CHECKBOX in the box b group — one is a tick, this one is a reserved field.",
    commonMistake:
      "Confusing it with box 13 of the W-2, which is a row of three checkboxes (statutory " +
      "employee, retirement plan, third-party sick pay). Same number, different form, completely " +
      "different content. The W-3's box 13 is not a checkbox at all.",
    whatToDo:
      "Leave blank, and do not attempt to mirror the W-2's box 13 checkboxes onto it.",
    examples: [
      {
        title: "Same box number, different form, different thing",
        steps: [
          "W-2 box 13: three checkboxes about the employee.",
          "W-3 box 13: a field reserved for third-party sick pay filers, to be left blank.",
          "The transmittal does not total checkboxes, and it does not carry them up.",
        ],
        answer: "(blank)",
        moral:
          "Box numbers are not a shared language across forms. Reading 'box 13' and assuming it " +
          "means what it meant on the last form is a reliable way to fill in the wrong thing.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 13—For third-party sick pay use only",
        quote: "Box 13\u2014For third-party sick pay use only. Leave this\nbox blank. See Form 8922.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'Leave this box blank' is as direct as instructions get. The reference to Form 8922 is " +
          "where third-party sick pay reporting actually happens, which confirms this box is not " +
          "the mechanism for it.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w3",
    box: "14",
    headline: "Income tax withheld by a third-party sick pay payer — already inside box 2",
    plainEnglish:
      "Federal income tax that a third-party payer of sick pay withheld from payments to " +
      "Greenway's employees. The instruction is explicit that this amount is ALREADY included in " +
      "the box 2 total and must nonetheless be shown separately here. Greenway has no third-party " +
      "sick pay, so it is blank.",
    whereItComesFrom:
      "It would come from a statement provided by the third-party payer. Nothing in Greenway's " +
      "payroll produces it.",
    howToReadIt:
      "This is a DISCLOSURE, not an addition. Box 2 already contains it. Adding box 14 to box 2 " +
      "would double-count the same withholding.",
    commonMistake:
      "Adding it into box 2 as well, or subtracting it out. Neither: box 2 is the whole of the " +
      "withheld income tax, and box 14 identifies the part of that total a third party withheld.",
    whatToDo:
      "Leave blank. If an insurer ever provides such a statement, the figure goes here AND stays " +
      "inside box 2, and the third-party sick pay checkbox in box b is ticked at the same time.",
    examples: [
      {
        title: "A figure that is reported twice on purpose",
        steps: [
          "Suppose an insurer withheld $500 of income tax on sick pay to a Greenway employee.",
          "Box 2 would include that $500 within the total federal income tax withheld.",
          "Box 14 would ALSO show $500, separately.",
          "The instruction says exactly this: although included in the box 2 total, it must be " +
            "separately shown here.",
        ],
        answer: "(blank for Greenway)",
        moral:
          "The same money legitimately appearing in two boxes is normal on tax forms. Assuming " +
          "every figure is reported once is how a correct form gets 'corrected'.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 14—Income tax withheld by payer of third-party sick pay",
        quote:
          "Box 14\u2014Income tax withheld by payer of third-party\nsick pay. Complete this box only if you are the employer\nand have employees who had federal income tax withheld\non third-party payments of sick pay. Show the total income\ntax withheld by third-party payers on payments to all of\nyour employees. Although this tax is included in the box 2\ntotal, it must be separately shown here.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The final sentence settles the double-counting question outright: the tax IS in box 2 " +
          "and must ALSO appear here. 'Complete this box only if' at the start is the condition " +
          "that keeps it blank for Greenway.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w3",
        box: "2",
        why:
          "Box 14 is a subset of box 2, not an addition to it. The instruction says so directly, " +
          "and it is the sentence that stops the same withholding being counted twice.",
      },
      {
        formId: "form_w3",
        box: "b-third-party-sick-pay",
        why:
          "A figure in box 14 and an unticked third-party sick pay box are inconsistent. The two " +
          "are populated together or not at all.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "15",
    headline: "The state and the state ID — 'WA', and the X rule for multi-state filers",
    plainEnglish:
      "The two-letter state abbreviation and Greenway's state-assigned ID number. For a " +
      "single-state employer this is simply WA. If the W-2s covered more than one state, the " +
      "instruction requires an 'X' under State and NO state ID number at all.",
    whereItComesFrom:
      "The company's state registration. It is text, not an amount — which is why the ownership " +
      "table classifies it as not money: 'WA' rendered as a dollar figure would be nonsense.",
    howToReadIt:
      "An X here means the transmittal spans states and every state figure below is a combined " +
      "sum. A two-letter code means one state and the figures below are that state's.",
    commonMistake:
      "Entering a state ID number alongside an X. The instruction forbids it — when you report " +
      "multiple states you must NOT enter a state ID, because there is more than one and no way " +
      "to say which.",
    whatToDo:
      "Enter WA and Greenway's Washington ID. If Greenway ever employs someone working in another " +
      "state, revisit this box first, because it changes how boxes 16 through 19 are read.",
    examples: [
      {
        title: "Why Greenway's single-state assumption is stated rather than assumed",
        steps: [
          "Greenway operates only in Washington and all W-2s report Washington only.",
          "So box 15 carries WA and a Washington ID rather than an X.",
          "The X rule is recorded anyway, because it is the box that would have to change first.",
        ],
        answer: "WA and the Washington ID",
        moral:
          "An assumption written down is a decision that can be revisited. An assumption left " +
          "implicit is a bug waiting for a new hire in Oregon.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 15—State/Employer's state ID number",
        quote:
          "Box 15\u2014State/Employer\u2019s state ID number (territorial\nID number for Forms W-2AS, W-2CM, W-2GU, and\nW-2VI). Enter the two-letter abbreviation for the name of\nthe state or territory being reported on Form(s) W-2. Also\nenter your state- or territory-assigned ID number. If the\nForms W-2 being submitted with this Form W-3 contain\nwage and income tax information from more than one\nstate or territory, enter an \u201cX\u201d under \u201cState\u201d and do not\nenter any state or territory ID number.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The multi-state rule is not guessable, which is why it is quoted even though Greenway " +
          "will never use it: an X REPLACES the state code and the ID is omitted entirely. The " +
          "instinct would be to list the states or keep the home-state ID, and both are wrong.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "15",
        why:
          "This box summarises the state identification appearing on the W-2s. If those W-2s " +
          "carry more than one state, this box changes shape entirely.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "16",
    headline: "Total state wages — blank in Washington because there is no state income tax",
    plainEnglish:
      "Box 16 of every W-2, added up: wages subject to state income tax. Washington levies no " +
      "personal income tax, so every W-2's box 16 is empty and so is this total.",
    whereItComesFrom:
      "A sum across the W-2s. There is no Washington state income tax wage base to report.",
    howToReadIt:
      "Blank here is a consequence of Washington law, not an omission. It is the single most " +
      "frequently questioned blank on the form, because in most states it would be populated.",
    commonMistake:
      "Copying box 1 into box 16 on the theory that wages are wages. That reports a state income " +
      "tax wage base to a state that has no income tax. It also makes the form disagree with " +
      "every W-2 underneath it.",
    whatToDo:
      "Leave blank. When someone asks why the state section is empty, the answer is that " +
      "Washington has no personal income tax — and note that Paid Leave, WA Cares and L&I are " +
      "withheld under different statutes and are not state income tax.",
    examples: [
      {
        title: "The blank that is required rather than permitted",
        steps: [
          "The instruction says to enter the total of state wages shown on the W-2s.",
          "Washington has no personal income tax, so no W-2 shows a state wage figure.",
          "The total of nothing is nothing.",
          "So box 16 is blank by operation of law.",
        ],
        answer: "(blank)",
        moral:
          "The instruction and the state statute both have to be read to know what belongs here. " +
          "The form alone cannot tell you that a blank is correct.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 16 through 19",
        quote:
          "Boxes 16 through 19 (not applicable to Forms\nW-2AS, W-2CM, W-2GU, and W-2VI). Enter the total of\nstate/local wages and income tax shown in their\ncorresponding boxes on the Forms W-2 included with this\nForm W-3. If the Forms W-2 show amounts from more\nthan one state or locality, report them as one sum in the\nappropriate box on Form W-3. Verify that the amount\nreported in each box is an accurate total of the Forms\nW-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "One instruction governs all four state and local boxes. The last sentence is an " +
          "instruction to VERIFY, which is the IRS asking for the check this system performs " +
          "automatically. Note that the multi-state rule collapses several states into ONE sum " +
          "rather than reporting them separately.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "16",
        why: "This box totals that one, which is empty for every Washington-only employee.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "17",
    headline: "Total state income tax withheld — nil in Washington, and not the same as PFML",
    plainEnglish:
      "Box 17 of every W-2, added up: state income tax withheld from employees. Washington " +
      "withholds no state income tax, so this is blank. Paid Family and Medical Leave and WA " +
      "Cares premiums ARE withheld from Washington pay, but they are not income tax and do not " +
      "belong here.",
    whereItComesFrom:
      "A sum across the W-2s. Greenway withholds PFML and WA Cares, and neither is state income " +
      "tax, so neither reaches this box.",
    howToReadIt:
      "Blank does not mean nothing was withheld from employees at state level. It means no state " +
      "INCOME TAX was withheld. That is a narrower statement and the distinction matters, because " +
      "Greenway does withhold state-mandated amounts.",
    commonMistake:
      "Reporting PFML or WA Cares withholding here because it is money withheld under state law. " +
      "It is not income tax, this box is specifically state income tax, and misreporting it puts " +
      "a state income tax figure on a form filed for a state with no such tax.",
    whatToDo:
      "Leave blank. PFML and WA Cares are reported to ESD on the Paid Leave and WA Cares return, " +
      "which is a different filing with a different format entirely.",
    examples: [
      {
        title: "Three kinds of state-mandated withholding, one empty box",
        steps: [
          "Greenway withholds PFML premiums from employee pay under Title 50A RCW.",
          "Greenway withholds WA Cares premiums under Chapter 50B.04 RCW.",
          "Neither statute imposes an income tax; both create separate premium schemes.",
          "Box 17 asks for state INCOME TAX withheld, of which there is none.",
          "So the box is blank while real state withholding is happening elsewhere.",
        ],
        answer: "(blank)",
        moral:
          "'Withheld under state law' and 'state income tax withheld' are different categories. " +
          "The box name is narrower than it first reads, and the reporting home for the other " +
          "amounts is a different agency altogether.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 16 through 19",
        quote:
          "Boxes 16 through 19 (not applicable to Forms\nW-2AS, W-2CM, W-2GU, and W-2VI). Enter the total of\nstate/local wages and income tax shown in their\ncorresponding boxes on the Forms W-2 included with this\nForm W-3. If the Forms W-2 show amounts from more\nthan one state or locality, report them as one sum in the\nappropriate box on Form W-3. Verify that the amount\nreported in each box is an accurate total of the Forms\nW-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The instruction says 'state/local wages and income tax'. INCOME TAX is the operative " +
          "term, and it is what excludes premium-based withholding like PFML and WA Cares. The " +
          "instruction also ties this box to the corresponding box on the W-2s, so if those are " +
          "empty this must be too.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "17",
        why: "This box totals that one, which is empty for Washington employees.",
      },
      {
        formId: "pfml_wa_cares",
        box: "pfml-employee",
        why:
          "The employee-side PFML premium is real state-mandated withholding that does NOT " +
          "belong in box 17. The tie exists to make the boundary visible: that figure is " +
          "reported to ESD, not to the SSA.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "18",
    headline: "Total local wages — Washington has no local income tax",
    plainEnglish:
      "Box 18 of every W-2, added up: wages subject to a city or county income tax. No Washington " +
      "jurisdiction levies one, so this is blank.",
    whereItComesFrom:
      "A sum across the W-2s. There is no local income tax wage base in Washington.",
    howToReadIt:
      "Blank for the same reason as box 16, one level of government further down. Local income " +
      "taxes are ordinary in some states and absent here.",
    commonMistake:
      "Reporting the local Business and Occupation tax or a city licence fee here. Those are " +
      "business taxes on Greenway, not income taxes withheld from employees, and no employee " +
      "withholding is involved.",
    whatToDo:
      "Leave blank. If Greenway ever employs someone working in a jurisdiction with a local " +
      "income tax, this box and box 19 change together.",
    examples: [
      {
        title: "Business taxes are not employee income taxes",
        steps: [
          "Washington cities levy B&O and licence taxes on businesses.",
          "Those are taxes on Greenway's own activity, not withheld from wages.",
          "Box 18 concerns wages subject to a LOCAL INCOME TAX on the employee.",
          "No such tax exists in Washington, so the box is blank.",
        ],
        answer: "(blank)",
        moral:
          "Whose tax it is decides which form it goes on. A tax Greenway pays never appears in " +
          "the state or local boxes of a wage report.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 16 through 19",
        quote:
          "Boxes 16 through 19 (not applicable to Forms\nW-2AS, W-2CM, W-2GU, and W-2VI). Enter the total of\nstate/local wages and income tax shown in their\ncorresponding boxes on the Forms W-2 included with this\nForm W-3. If the Forms W-2 show amounts from more\nthan one state or locality, report them as one sum in the\nappropriate box on Form W-3. Verify that the amount\nreported in each box is an accurate total of the Forms\nW-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The same instruction covers local as well as state, and it ties each box to its " +
          "counterpart on the W-2s. Empty W-2 boxes make an empty total — the verification the " +
          "last sentence asks for is satisfied trivially, but it is still satisfied deliberately.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "18",
        why: "This box totals that one, which is empty in Washington.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "19",
    headline: "Total local income tax withheld — nil, for the same reason as box 18",
    plainEnglish:
      "Box 19 of every W-2, added up: local income tax withheld from employees' pay. There is no " +
      "local income tax in Washington, so nothing is withheld and this is blank.",
    whereItComesFrom:
      "A sum across the W-2s. No local income tax withholding exists.",
    howToReadIt:
      "Blank, and it should stay blank. Read alongside box 18: a figure in one and not the other " +
      "would be a contradiction, because tax cannot be withheld on a wage base that does not " +
      "exist.",
    commonMistake:
      "Filling all four state and local boxes with the federal figures so the section 'looks " +
      "complete'. That reports state and local income taxes to jurisdictions that levy none, and " +
      "it breaks agreement with every W-2 underneath.",
    whatToDo:
      "Leave blank. Confirm boxes 16 through 19 are all empty together — they are consistent as " +
      "a set, not individually.",
    examples: [
      {
        title: "The four state and local boxes as a set",
        steps: [
          "Box 16 state wages: blank. Box 17 state income tax: blank.",
          "Box 18 local wages: blank. Box 19 local income tax: blank.",
          "All four are blank for the same underlying reason: Washington levies no personal " +
            "income tax at state or local level.",
          "A figure in any one of them would need explaining against the other three.",
        ],
        answer: "(blank)",
        moral:
          "Checking these four together is faster and stronger than checking them one at a time, " +
          "because their relationship is what makes them checkable at all.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 16 through 19",
        quote:
          "Boxes 16 through 19 (not applicable to Forms\nW-2AS, W-2CM, W-2GU, and W-2VI). Enter the total of\nstate/local wages and income tax shown in their\ncorresponding boxes on the Forms W-2 included with this\nForm W-3. If the Forms W-2 show amounts from more\nthan one state or locality, report them as one sum in the\nappropriate box on Form W-3. Verify that the amount\nreported in each box is an accurate total of the Forms\nW-2.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'Verify that the amount reported in each box is an accurate total of the Forms W-2' is " +
          "the closing instruction for all four boxes, and it is an instruction to CHECK rather " +
          "than merely to enter. Four blanks that were verified are a different thing from four " +
          "blanks that were never looked at.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "19",
        why: "This box totals that one, which is empty in Washington.",
      },
    ],
  },
  {
    formId: "form_w3",
    box: "contact",
    headline: "Who the SSA calls — and the one part of this form that decides whether you hear about a problem",
    plainEnglish:
      "The contact person, telephone number, fax number and email address the SSA uses if a " +
      "question arises while processing the filing. Greenway's 2025 W-3 as filed names Michael " +
      "Lyman with the business telephone number. The instructions add a Caution aimed squarely at " +
      "payroll bureaux: enter the CLIENT's information, not your own.",
    whereItComesFrom:
      "The company record. It is not computed and not reconciled — which is exactly why it is easy " +
      "to leave stale.",
    howToReadIt:
      "This determines who finds out when something is wrong. Everything else on the form is about " +
      "the numbers being right; this is about the message arriving if they are not.",
    commonMistake:
      "Leaving a former bookkeeper or a payroll bureau's details here. The SSA then raises a " +
      "question with someone who no longer acts for the business, and the first Michael hears of " +
      "it is a later, less friendly letter. The instructions' Caution exists because this is " +
      "common enough to warrant one.",
    whatToDo:
      "Confirm the name, phone and email are Michael's own and currently monitored, every year " +
      "before filing. It takes seconds and it is the cheapest insurance on the form.",
    examples: [
      {
        title: "Greenway's 2025 contact details, as filed",
        steps: [
          "Box: Employer's contact person, as filed: MICHAEL LYMAN.",
          "Employer's telephone number, as filed: 360 443-6988.",
          "The instruction's purpose: for use by the SSA if any questions arise during processing.",
          "So a question about this filing reaches Michael directly rather than a third party.",
        ],
        answer: "Michael Lyman, with the business telephone number",
        moral:
          "The only box on this form that has nothing to do with arithmetic is the one that " +
          "decides whether an arithmetic problem ever gets fixed.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Employer's contact person",
        quote:
          "Employer\u2019s contact person, Employer\u2019s telephone\nnumber, Employer\u2019s fax number, and Employer\u2019s\nemail address. Include this information for use by the\nSSA if any questions arise during processing.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "'Include this information' — it is not optional, and its stated purpose is so the SSA " +
          "can raise a question. That is the whole justification for treating these fields as " +
          "load-bearing rather than administrative.",
      },
      {
        cite: "IRS Instructions for Forms W-2 and W-3 (2026), Employer's contact person, Caution",
        quote:
          "Caution: Payroll service providers, enter your client\u2019s\ninformation for these fields.",
        sourcePath: FORM_W3_SOURCE_PATH,
        sourceUrl: FORM_W3_SOURCE_URL,
        soWhat:
          "The IRS specifically warns bureaux not to put themselves here. If Greenway ever moves " +
          "payroll to a service, this is the field to check on the first filing — the default " +
          "behaviour of such software is frequently the opposite of what this Caution requires.",
      },
    ],
    tiesTo: [],
  },
];
