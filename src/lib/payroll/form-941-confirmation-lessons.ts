/**
 * src/lib/payroll/form-941-confirmation-lessons.ts   (books-48)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * TEACHING THE CONFIRMATION STEP — WHY YOU ARE TYPING NUMBERS THE SOFTWARE
 * ALREADY KNOWS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "if there are lessons to connect or use for the 941 confirmation step,
 *    please add them and make them easy to read and understand. explain why we
 *    are doing this. I want the cpa to guide me through ever aspect of the
 *    books. if there is an opportunity to teach, please take me to school."
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE THING THIS FILE HAS TO GET ACROSS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Every other screen in this system exists to save Michael work. This one asks
 * him to do work the computer appears to have already done — seven figures the
 * 941 screen is displaying right above the box he is typing them into.
 *
 * If he does not understand WHY, he will reasonably conclude it is a bug or a
 * missing feature, ask for it to be auto-filled, and be right to ask. The
 * answer is not obvious and it is not a technical limitation. It is the entire
 * point of the exercise, and it comes down to one idea:
 *
 *     A CHECK IS ONLY WORTH ANYTHING IF THE TWO SIDES COULD DISAGREE.
 *
 * That idea is the oldest one in auditing and it has a name — corroborating
 * evidence from an independent source. It is why a bank reconciliation uses the
 * bank's statement rather than a second copy of your own cash book. Two copies
 * of the same record agree perfectly and prove nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE `BoxLesson`s AND NOT A PARAGRAPH ON THE PAGE
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Because `BoxLesson` is the vocabulary slice D established for teaching, and
 * it carries fields a paragraph cannot: `commonMistake`, `whatToDo`, worked
 * `examples` with real arithmetic, verbatim `quotes`, and `tiesTo` — the links
 * to boxes on OTHER forms that must agree. That last field is what turns a
 * stack of forms into a system, and it is precisely what this step is about.
 *
 * Prose on a page also cannot be gated. A `BoxLesson` can: the verbatim gate
 * checks every quote against the transcribed source, and the wiring gate checks
 * every rendered box has a lesson.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY NOT ONE QUOTE IS TYPED OUT IN THIS FILE (standing rule 25)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Every `BoxQuote` below is built by `quoteOf()` from an authority that ALREADY
 * EXISTS in `form-w2-authorities.ts` or `form-941-authorities.ts` and that the
 * central verifier already checks against the mirrored corpus on every commit.
 *
 * THIS IS NOT TIDINESS. IT IS THE DIFFERENCE BETWEEN A CHECKED QUOTE AND AN
 * UNCHECKED ONE. `scripts/verify-verbatim-quotes.ts` walks the AUTHORITY
 * REGISTRY. A quotation typed directly into a lesson literal is not in that
 * registry, so the central gate never sees it — it would be verified only by
 * whatever this slice's own test happened to remember to check, which is
 * exactly the kind of coverage that decays.
 *
 * The first draft of this file DID type its quotes out by hand, and doing so
 * cost real time in a way worth recording, because the same mistake is cheap
 * to make again:
 *
 *   - One quote was attributed to the Form 941 instructions and transcribed
 *     with an ASCII hyphen in "lines 5a-5d". The source has an EN DASH. It did
 *     not match.
 *   - Another was trimmed to "Retain your reconciliation information for
 *     future reference." — which IS in the source, but as part of a longer Tip
 *     whose surrounding sentences are the ones that explain it.
 *
 * Both were caught by running the real matcher against the real file. Both
 * would have been impossible if the quotes had been reused from the registry
 * in the first place, which is what this file now does.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A DEFECT THIS FILE UNCOVERED, RECORDED BECAUSE IT IS THE BETTER LESSON
 * ──────────────────────────────────────────────────────────────────────────
 *
 * While hunting for the correct Form 941 quote above, all four line-level
 * Form 941 authorities turned out to have been UNVERIFIED SINCE THEY WERE
 * WRITTEN. Their citations read "IRS, Instructions for Form 941, line 7 (...)"
 * — a comma after "IRS" and no year — and the verifier routes on
 * `/^IRS Instructions for Forms? ... \((\d{4})\)/`. They matched nothing, so
 * they were counted as "no local copy to check against" and skipped, while the
 * mirrored file sat on disk. Two of the four quotes were in fact wrong.
 *
 * The full account is in the header of `form-941-authorities.ts`, where the fix
 * lives. It is mentioned here because of the causal order, which is the part
 * worth internalising: NOBODY WAS CARELESS TWICE. Somebody was careless once,
 * and the gate that existed to catch it had been silently switched off by a
 * punctuation mark.
 */

import type { BoxLesson, BoxQuote } from "./form-box-core";
import {
  FORM_941_SOURCE_PATH,
  FORM_941_SOURCE_URL,
  I941_LINE_7_FRACTIONS_OF_CENTS,
} from "./form-941-authorities";
import {
  FORM_W2_SOURCE_PATH,
  FORM_W2_SOURCE_URL,
  IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE,
  IW2W3_2026_RECONCILE_W3_TO_941S,
  IW2W3_2026_W3_AMOUNTS_SHOULD_AGREE,
} from "./form-w2-authorities";

/**
 * The form id these lessons hang off.
 *
 * NOT "form_941". The 941 screen already has a full set of lessons keyed to
 * `form_941`, one per line of the return, and `lessonFor(formId, box)` returns
 * the FIRST match. Reusing that id would put these four lessons in the same
 * namespace as the line lessons, where a future `box: "3"` on either side would
 * shadow the other silently — the dead-content-behind-a-green-check failure of
 * standing rule 50.
 *
 * These lessons are about a DIFFERENT artefact: not line 3 of the return we
 * compute, but the return Michael actually filed. A separate id says so.
 */
export const FILED_941_FORM_ID = "filed_941" as const;

/**
 * Turn a verified authority into the quote shape the lesson panel renders.
 *
 * `sourcePath` and `sourceUrl` are passed in rather than hard-coded inside,
 * because these lessons quote TWO documents — the W-2/W-3 general instructions
 * and the Form 941 instructions — and a single baked-in path would silently
 * mis-attribute one of them. The gate reads `sourcePath` to decide which file
 * to check the quote against, so a wrong path there does not fail: it checks
 * the right words against the wrong book and reports a mismatch that sends the
 * reader hunting for a transcription error that does not exist.
 */
function quoteOf(
  a: { readonly cite: string; readonly quote: string; readonly soWhat: string },
  sourcePath: string,
  sourceUrl: string,
  soWhat?: string,
): BoxQuote {
  return {
    cite: a.cite,
    quote: a.quote,
    sourcePath,
    sourceUrl,
    // The registry's `soWhat` is written for a reader of the authority panel.
    // A lesson may need the same words explained for a reader of THIS panel,
    // so an override is allowed - but the CITE and the QUOTE never are.
    soWhat: soWhat ?? a.soWhat,
  };
}

/** Quote helper bound to the W-2/W-3 general instructions. */
function w2Quote(
  a: { readonly cite: string; readonly quote: string; readonly soWhat: string },
  soWhat?: string,
): BoxQuote {
  return quoteOf(a, FORM_W2_SOURCE_PATH, FORM_W2_SOURCE_URL, soWhat);
}

/** Quote helper bound to the Form 941 instructions. */
function f941Quote(
  a: { readonly cite: string; readonly quote: string; readonly soWhat: string },
  soWhat?: string,
): BoxQuote {
  return quoteOf(a, FORM_941_SOURCE_PATH, FORM_941_SOURCE_URL, soWhat);
}

/**
 * Michael's REAL 2025 W-2, used in the doubling example below.
 *
 * These are not illustrative round numbers. They were read off the PDF he
 * uploaded this slice, and they are held as named constants for one reason:
 * the prose in the lesson and the arithmetic in the worked example must not be
 * able to drift apart. A gate multiplies these out and checks the answers, so
 * changing a figure here without changing the example breaks the build.
 *
 * Box 3 (social security wages) is used rather than box 1, because box 1
 * INCLUDES the $30,980.16 of shareholder health insurance and box 3 does not —
 * that carve-out is the §3121(a)(2)(B) trap documented at length in
 * `form-w2-authorities.ts`. Using box 1 here would produce a FICA figure that
 * is simply wrong, and it is the exact mistake the doubling check is meant to
 * catch, so getting it wrong in the teaching material would be unfortunate.
 */
export const MICHAEL_2025_SS_WAGES_CENTS = 5_353_016;
export const MICHAEL_2025_BOX_4_CENTS = 331_887;
export const MICHAEL_2025_BOX_6_CENTS = 77_619;

export const FORM_941_CONFIRMATION_LESSONS: readonly BoxLesson[] = [
  /* ══════════════════════════════════════════════════════════════════════
   * THE FIRST LESSON IS THE WHOLE ARGUMENT.
   *
   * It goes first and it is the longest, because everything else on this panel
   * is meaningless if this one does not land. It answers the question Michael
   * will actually have, phrased the way he will actually phrase it.
   * ══════════════════════════════════════════════════════════════════════ */
  {
    formId: FILED_941_FORM_ID,
    box: "why",
    headline: "Why am I typing in numbers the software already knows?",
    plainEnglish:
      "This is the fair question, and the answer is the reason the whole feature exists. The " +
      "figures on the screen above come from your pay runs. If this box were filled in from " +
      "those same pay runs, then later, when January's W-2s are compared against the year's four " +
      "941s, the comparison would be comparing one calculation against a copy of itself. It " +
      "would agree every single time - including the quarter where something went wrong. Green " +
      "ticks forever, telling you nothing. What you type here comes from a different place: a " +
      "piece of paper the government has already received. That is what makes the comparison " +
      "capable of catching something, and a check that cannot fail is not a check.",
    whereItComesFrom:
      "From the filed return itself, in your hand or on screen from whatever you filed with. Not " +
      "from this system, and not from your own spreadsheet - from the document that went to the " +
      "IRS. If you filed through Aatrix, it is the confirmation copy Aatrix produced. If you " +
      "filed on paper, it is your retained copy.",
    howToReadIt:
      "Think of it exactly like reconciling your bank account. You do not check your cash book " +
      "against a second copy of your cash book - you check it against the bank's statement, " +
      "because the bank is a separate party who counted the same money independently. Here the " +
      "IRS is the bank and the filed 941 is the statement. Accountants call this corroborating " +
      "evidence from an independent source, and it is the oldest idea in auditing precisely " +
      "because it is the only kind of evidence that can contradict you.",
    commonMistake:
      "Assuming this step is a missing feature and waiting for it to be automated. It will not " +
      "be, and if someone ever automates it, the correct response is to take it out again. The " +
      "second mistake is entering the figures from this screen rather than from the return - " +
      "which produces exactly the worthless self-comparison the design avoids, while looking " +
      "identical from the outside. Nobody would ever know.",
    whatToDo:
      "Put the filed return next to the keyboard. Type each figure from the PAPER, reading it " +
      "off the return rather than off this screen. Do it once a quarter, right after you file, " +
      "while the return is still in front of you - not in January when it is a scavenger hunt " +
      "through four folders.",
    examples: [
      {
        title: "The quarter this catches, and what it costs when nothing catches it",
        steps: [
          "Q2 2027. A pay run dated 30 June is posted on 2 July, after the return was filed.",
          "The 941 that went to the IRS is therefore short by one fortnight of wages.",
          "Return as filed:      line 3 = $8,400.00",
          "This system computes: line 3 = $9,150.00  (it can see the late-posted run)",
          "Difference:                     $750.00",
          "WITH this step: the difference shows in July, on this screen, in red. You file a " +
            "941-X for Q2 and the year closes clean.",
          "WITHOUT this step: nothing is compared. In January the W-2s carry $9,150 of " +
            "withholding for that quarter while the filed 941s carry $8,400.",
          "The W-3 goes to the SSA disagreeing with the 941s by $750, and the IRS " +
            "instructions say you WILL be contacted - not may be.",
          "That letter arrives around eighteen months later, by which time nobody " +
            "remembers a pay run posted on 2 July 2027.",
        ],
        answer: "$750.00 found in July, or $750.00 explained in 2029",
        moral:
          "The difference is $750 either way. What changes is whether you find it in five minutes " +
          "with the paperwork in front of you, or in a year and a half with none of it. That gap " +
          "is what this five-minute step buys.",
      },
      {
        title: "Why auto-filling would have hidden exactly that error",
        steps: [
          "The same quarter, but imagine the confirmation box helpfully pre-filled.",
          "Pre-filled 'as filed' figure: $9,150.00  (copied from the computation)",
          "Computed figure:              $9,150.00",
          "Difference:                       $0.00   - agrees",
          "The screen shows green. The actual return said $8,400.",
          "The error is still there, undetected, and now there is a green tick over the " +
            "top of it saying somebody checked.",
        ],
        answer: "$0.00 — and the $750 error is still there",
        moral:
          "A check that always passes is worse than no check, because it consumes the attention " +
          "you would otherwise have spent looking. This is the failure mode the design is built " +
          "against, and it is why the tedious version is the correct version.",
      },
    ],
    quotes: [
      w2Quote(
        IW2W3_2026_RECONCILE_W3_TO_941S,
        "Read the verb: you WILL be contacted, not may be. This comparison is run whether or " +
          "not you run it yourself, so the only question is whether you see the difference first " +
          "or the IRS does. This step is how you see it first. Note also WHICH four figures the " +
          "IRS names - boxes 2, 3, 5 and 7 - because those are exactly the figures this panel " +
          "asks you for.",
      ),
    ],
    tiesTo: [
      {
        formId: "form_w3",
        box: "2",
        why:
          "Box 2 of the W-3 totals every W-2's income tax withheld for the year, and it must equal " +
          "line 3 of the four 941s added together. This step supplies the 941 side of that " +
          "comparison, one quarter at a time.",
      },
      {
        formId: "form_w3",
        box: "3",
        why:
          "Box 3 is the year's social security wages and must equal line 5a column 1 of the four " +
          "941s. Both are wages after the annual cap, so they must match exactly - not " +
          "approximately.",
      },
      {
        formId: "form_w3",
        box: "5",
        why:
          "Box 5 is Medicare wages and must equal line 5c column 1 of the four 941s. Medicare is " +
          "uncapped on both forms, so there is nothing that could legitimately make them differ.",
      },
    ],
  },

  /* ══════════════════════════════════════════════════════════════════════
   * THE DOUBLING. This is the lesson that prevents the most common data-entry
   * error on the panel, and the arithmetic is worth showing rather than
   * asserting.
   * ══════════════════════════════════════════════════════════════════════ */
  {
    formId: FILED_941_FORM_ID,
    box: "doubling",
    headline: "Why the 941 figures are about double the W-2 figures",
    plainEnglish:
      "Social security and Medicare are matched taxes. The employee pays 6.2% and 1.45%, and " +
      "Greenway pays the same again out of its own pocket. A W-2 reports only what came out of " +
      "the employee's cheque, because that is what the employee needs for their own return. The " +
      "941 reports BOTH halves together, because the 941 is how the total gets paid over to the " +
      "government. So the same wages produce 6.2% on a W-2 and 12.4% on a 941, and 1.45% on a " +
      "W-2 against 2.9% on a 941. Nothing is being double-counted - they are answering two " +
      "different questions.",
    whereItComesFrom:
      "Line 5a column 2 and lines 5c/5d column 2 of the filed return. Copy them exactly as " +
      "printed, including the employer half. Do not halve them to 'match' the W-2, and do not " +
      "double them because you think the return only shows the employee share - the return " +
      "already shows both.",
    howToReadIt:
      "This gives you a check you can do in your head, and it is worth doing every quarter. Take " +
      "the social security tax on the return and halve it. That should be roughly what actually " +
      "came out of the paycheques. If the figure on the return equals what came out of the " +
      "cheques rather than double it, the employer half was left off. If it is four times, " +
      "something was counted twice.",
    commonMistake:
      "Entering the employee half only. It is the single most common error on this panel, and it " +
      "has a recognisable shape: the difference is almost exactly 50%. The screen names that " +
      "shape explicitly when it happens, rather than just saying the numbers do not match, " +
      "because 'these differ by $3,318.87' sends you hunting and 'this looks like half' tells " +
      "you the answer.",
    whatToDo:
      "Copy column 2 of lines 5a and 5c straight off the return without adjusting anything. Then " +
      "sanity-check it: halve the social security figure and see whether it looks like a " +
      "quarter's worth of employee withholding. If it looks like a whole quarter's worth rather " +
      "than half, you have entered the employee share by mistake.",
    examples: [
      {
        title: "Your own 2025 W-2, run through the doubling",
        steps: [
          "These are your real figures, off the W-2 you uploaded.",
          "Box 3, social security wages:            $53,530.16",
          "Box 4, the employee half withheld:       $53,530.16 x 6.2%  = $3,318.87",
          "Greenway's matching half:                $53,530.16 x 6.2%  = $3,318.87",
          "What the four 941s report for the year:  $53,530.16 x 12.4% = $6,637.74",
          "So $6,637.74 across the 941s against $3,318.87 on the W-2 - exactly double, " +
            "because nobody here is near the $200,000 threshold.",
          "Medicare, on the same wages:",
          "Box 6, the employee half:                $53,530.16 x 1.45% = $776.19",
          "What the four 941s report:               $53,530.16 x 2.9%  = $1,552.37",
          "Note box 3 is used, NOT box 1. Box 1 is larger because it includes the " +
            "$30,980.16 of shareholder health insurance, which is income-taxable but " +
            "carved out of FICA. Using box 1 here would overstate the tax.",
        ],
        answer: "$6,637.74 social security and $1,552.37 Medicare, against $3,318.87 and $776.19",
        moral:
          "Both figures were verified against your actual filed W-2 to the cent. The doubling is " +
          "not an approximation for ordinary wages - it is exact, and the one thing that breaks " +
          "it is Additional Medicare Tax, which is the next lesson.",
      },
    ],
    quotes: [
      w2Quote(
        IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE,
        "The IRS says 'approximately twice' rather than 'twice' for one specific reason, and it " +
          "is not rounding. Additional Medicare Tax has no employer match, so once anybody is " +
          "paid over $200,000 the true ratio drops slightly below two. That is why line 5d is " +
          "captured separately on this panel instead of being folded into the Medicare total.",
      ),
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "4",
        why:
          "Box 4 is the employee's social security tax only. Line 5a column 2 of the 941 should be " +
          "exactly double the sum of every employee's box 4 - and the annual comparison computes " +
          "that doubling rather than allowing a fuzzy tolerance.",
      },
      {
        formId: "form_w2",
        box: "6",
        why:
          "Box 6 is the employee's Medicare tax. Lines 5c/5d of the 941 should be double it, EXCEPT " +
          "for the Additional Medicare Tax portion, which has no employer match and is therefore " +
          "counted once.",
      },
    ],
  },

  /* ══════════════════════════════════════════════════════════════════════
   * LINE 5d. On Greenway's numbers this is 0.00 every quarter, which is
   * exactly why it needs a lesson: a box that is always zero is a box that
   * gets skipped, and the day it should not be zero is the day it will be.
   * ══════════════════════════════════════════════════════════════════════ */
  {
    formId: FILED_941_FORM_ID,
    box: "5d",
    headline: "Line 5d — the one FICA figure that does not double",
    plainEnglish:
      "There is an extra Medicare tax of 0.9% on wages above $200,000 a year, called Additional " +
      "Medicare Tax. It is the only payroll tax on this form the employer does NOT match: the " +
      "employee pays it and Greenway pays nothing. It sits on line 5d of the 941. Right now this " +
      "is zero for you every quarter - nobody at Greenway is paid over $200,000 - so you will be " +
      "typing 0.00 into this box for the foreseeable future.",
    whereItComesFrom:
      "Line 5d column 2 of the filed return, on its own. Note that the box above it asks for " +
      "lines 5c AND 5d added together - so if line 5d is not zero, its amount goes in BOTH " +
      "boxes: once inside the combined total, and once here by itself.",
    howToReadIt:
      "If it is not zero, somebody crossed $200,000 of wages during the year, and two things " +
      "follow. First, the neat doubling between the W-2 and the 941 stops being exact for that " +
      "year. Second, the annual comparison has to count this part once instead of twice, which " +
      "is why it is captured separately rather than being buried in the Medicare total.",
    commonMistake:
      "Leaving it blank because it is zero. A blank and a zero look the same to a person and are " +
      "completely different to the software: a zero you typed is a fact you confirmed, and a " +
      "blank is an absence the system would have to fill in by guessing. This form refuses a " +
      "blank rather than assuming zero, and that refusal is deliberate - it is the same rule that " +
      "stops it inventing any other figure it was not given.",
    whatToDo:
      "Type 0.00 when line 5d on the return is empty, which for now is every quarter. The day it " +
      "is not empty, enter it in both boxes: inside the combined 5c+5d total and here on its own.",
    examples: [
      {
        title: "What happens to the doubling when somebody crosses the threshold",
        steps: [
          "Suppose a future year in which one person earns $250,000, the year's Medicare " +
            "wages total $400,000 across everybody, and the extra 0.9% bites on the " +
            "$50,000 above the threshold.",
          "Medicare on all wages, both halves:  $400,000 x 2.9%  = $11,600.00",
          "Additional Medicare, employee only:   $50,000 x 0.9%  =    $450.00",
          "Lines 5c + 5d across the four 941s:                     $12,050.00",
          "Now the W-2 side. Box 6 for everybody:",
          "Employee Medicare half:              $400,000 x 1.45% =  $5,800.00",
          "Additional Medicare, the same $450:                        $450.00",
          "Total box 6 across all W-2s:                             $6,250.00",
          "Is $12,050 exactly double $6,250? No - double would be $12,500.",
          "The gap is $450: the Additional Medicare, which appears ONCE on each form " +
            "rather than twice, because Greenway does not match it.",
          "So the annual comparison computes: (6,250 - 450) x 2 + 450 = 5,800 x 2 + 450",
        ],
        answer: "$12,050.00 — which agrees, once the $450 is doubled zero times",
        moral:
          "This is why line 5d is a required field rather than an optional one. Fold it into the " +
          "Medicare total and the annual comparison would report a $450 difference on a perfectly " +
          "correct set of returns - a false alarm, which is expensive in a particular way: it " +
          "teaches you the red line is usually wrong, and the day it is right you will not " +
          "believe it.",
      },
    ],
    quotes: [
      f941Quote(
        I941_LINE_7_FRACTIONS_OF_CENTS,
        "This is the IRS acknowledging that the tax computed on the quarter's total wage base " +
          "will not exactly equal the sum of what was rounded off each individual paycheque, and " +
          "line 7 exists to absorb the difference. It is why the plausibility check on this panel " +
          "allows a dollar of drift before it says anything - and why it raises a WARNING rather " +
          "than refusing your entry. The return is a historical fact; our opinion of it is not.",
      ),
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "6",
        why:
          "Box 6 of the W-2 contains BOTH ordinary Medicare tax and Additional Medicare Tax added " +
          "together. The annual comparison has to pull them apart again to double one and not the " +
          "other, and line 5d is where the un-matched part is identified.",
      },
    ],
  },

  /* ══════════════════════════════════════════════════════════════════════
   * THE SOURCE NOTE. A free-text field with a mandatory-looking asterisk
   * invites a single character to shut it up. This lesson exists to make the
   * field feel worth filling in properly, because in eighteen months it is
   * the most valuable thing in the row.
   * ══════════════════════════════════════════════════════════════════════ */
  {
    formId: FILED_941_FORM_ID,
    box: "source",
    headline: "The note about where the figures came from — why it is required",
    plainEnglish:
      "A short sentence saying which document you read these numbers off. It is required, not " +
      "optional, and it is the field most likely to feel like paperwork for its own sake. It is " +
      "not. This row is evidence, and evidence with no provenance is just a number - " +
      "indistinguishable from a number somebody made up.",
    whereItComesFrom:
      "From you. Something like: \"Aatrix Q1 2027, filed 2027-04-28, confirmation " +
      "0-053-958-352\". Whatever identifies the exact document, well enough that somebody could " +
      "find it again without asking you.",
    howToReadIt:
      "Imagine a letter arriving in eighteen months saying your W-3 and your 941s differ by $312. " +
      "The question you will have to answer is 'where did these figures come from?'. If the note " +
      "says which return, filed when, with what confirmation number, the answer takes ten " +
      "minutes. If it is blank, it takes a week of going through folders - and you will be doing " +
      "that a year and a half after you last thought about the quarter.",
    commonMistake:
      "Typing a single character to get past the validation. It passes, and it converts the row " +
      "from evidence into a number of unknown origin. Nobody notices until the one moment the " +
      "field would have mattered.",
    whatToDo:
      "Name the source, the filing date, and any confirmation number. Ten seconds. If you filed " +
      "through Aatrix, the confirmation number is on the acknowledgement. If you filed on paper, " +
      "write \"paper return, retained copy in the 2027 payroll binder\" - a location is " +
      "provenance too.",
    examples: [
      {
        title: "The July 2026 excise return, as a model of what good provenance looks like",
        steps: [
          "Your filed Washington excise return for July 2026 carries confirmation number " +
            "0-053-958-352. That one string is what makes the filing findable and provable.",
          "A useless note: \"filed\"",
          "A weak note:    \"from Aatrix\"",
          "A good note:    \"Aatrix Q1 2027, filed 2027-04-28, conf 0-053-958-352\"",
          "The good one answers all three questions a letter would ask: which document, " +
            "when it went, and how to prove it went.",
        ],
        answer: "\"Aatrix Q1 2027, filed 2027-04-28, conf 0-053-958-352\"",
        moral:
          "Provenance costs ten seconds now and saves days later. It is the cheapest insurance in " +
          "the whole system.",
      },
    ],
    quotes: [
      w2Quote(
        IW2W3_2026_W3_AMOUNTS_SHOULD_AGREE,
        "The last sentence is the instruction, and it is an instruction rather than a suggestion: " +
          "retain your reconciliation INFORMATION, not just your conclusion. The IRS is telling " +
          "you to keep the working. This note is the working. It is also why the figures go into " +
          "a table rather than being shown on screen and forgotten.",
      ),
    ],
    tiesTo: [],
  },
];

/**
 * Self-check: no duplicate box keys, nothing structurally empty.
 *
 * Throws rather than returning a boolean (rule 48). Called by the gate, which
 * would otherwise be asserting that a list it never exercised is well-formed.
 */
export function assertForm941ConfirmationLessonsAreWellFormed(): void {
  const seen = new Set<string>();
  for (const l of FORM_941_CONFIRMATION_LESSONS) {
    if (l.formId !== FILED_941_FORM_ID) {
      throw new Error(
        `form-941-confirmation-lessons: lesson "${l.box}" has formId "${l.formId}", expected ` +
          `"${FILED_941_FORM_ID}". A mismatched formId makes the lesson unfindable by lessonFor.`,
      );
    }
    if (seen.has(l.box)) {
      throw new Error(
        `form-941-confirmation-lessons: box "${l.box}" appears twice. lessonFor returns the first ` +
          `match, so the second would be dead content wearing a green check (rule 50).`,
      );
    }
    seen.add(l.box);
    if (l.examples.length === 0) {
      throw new Error(
        `form-941-confirmation-lessons: box "${l.box}" has no worked example. This panel exists to ` +
          `explain something counter-intuitive, and an explanation with no arithmetic behind it is ` +
          `an assertion.`,
      );
    }
    if (l.quotes.length === 0) {
      throw new Error(
        `form-941-confirmation-lessons: box "${l.box}" cites no authority. Standing rule 24 is ` +
          `verbatim authority or no feature, and a teaching panel that tells Michael what the IRS ` +
          `expects without showing him the words is asking to be believed.`,
      );
    }
    for (const q of l.quotes) {
      if (q.sourcePath !== FORM_W2_SOURCE_PATH && q.sourcePath !== FORM_941_SOURCE_PATH) {
        throw new Error(
          `form-941-confirmation-lessons: box "${l.box}" quotes sourcePath "${q.sourcePath}", ` +
            `which is neither of the two mirrored files this module cites. The gate reads this ` +
            `field to choose which file to verify against, so a wrong path checks the right words ` +
            `against the wrong book.`,
        );
      }
    }
  }
}
