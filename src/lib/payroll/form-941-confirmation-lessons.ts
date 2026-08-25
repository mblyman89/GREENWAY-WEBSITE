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
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT MICHAEL'S 2025 W-2 ACTUALLY SAYS. EVIDENCE, NOT AUTHORITY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These figures were read off the PDF he uploaded. Every name below begins with
 * `AS_FILED_` and that prefix is doing real work — books-55 renamed all three
 * constants after Michael stopped the previous slice mid-flight to say:
 *
 *   "it was me that produced all the w-2s and w-3 for my business, not my
 *    grandfather. It's very likely I did it wrong... I want true accuracy, not
 *    taking my bad form filling and calling it source material."
 *
 * He had spotted something I had not. The old names were bare
 * (`MICHAEL_2025_SS_WAGES_CENTS`), and bare names invite a fatal slip: a figure
 * off a filed return starts as "what he reported", becomes "what he was paid",
 * and ends up as "what the correct figure is". Nothing in the code marks the
 * moment that happens. A FILED FORM IS EVIDENCE OF WHAT A TAXPAYER DID. It is
 * never evidence of what the law required. The prefix makes each use site
 * declare which of the two it means.
 *
 * WHAT THE FORM SHOWS, and it is unusual: boxes 1, 3 and 5 are ALL $53,530.16,
 * and box 14 reads HEALTH $30,980.16. So the shareholder health premium was run
 * through the Social Security and Medicare bases along with everything else.
 * 53,530.16 × 6.2% = 3,318.87 and × 1.45% = 776.19, both matching boxes 4 and 6
 * to the cent — confirming FICA was computed on the full amount.
 *
 * WHETHER THAT IS RIGHT IS NOT A QUESTION THIS FILE ANSWERS. §3121(a)(2) takes
 * the premium out of FICA wages only when it is paid "under a plan or system...
 * which makes provision for his employees generally... or for a class or classes
 * of his employees". Nobody has shown this software such a plan. If one exists,
 * about $4,740 of combined FICA was overpaid; if none exists, the return is
 * right as filed. See `IRC_3121_A_2_MEDICAL_EXCLUSION` in
 * `form-w2-authorities.ts` and the open question in `docs/OWNER_STATED_FACTS.md`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DOCBLOCK THAT LIED, AND WHAT REPLACED IT (books-55)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The text that used to sit here said, of these three constants:
 *
 *   "A gate multiplies these out and checks the answers, so changing a figure
 *    here without changing the example breaks the build."
 *
 * THERE WAS NO SUCH GATE. `grep -rn "MICHAEL_2025" --include=*.ts .` returned
 * exactly three lines: these three declarations. Nothing imported them, no test
 * read them, and the worked example below re-typed the same figures as prose
 * inside a string. The constants were dead code and the sentence describing
 * them was false — which is worse than either alone, because a reader who
 * believed the comment would conclude the arithmetic was machine-checked and
 * stop checking it themselves. That is standing rule 39 in its purest form: a
 * verifier that cannot see something has approved it.
 *
 * `assertAsFiledFiguresReconcile()` at the foot of this file is the gate the
 * comment promised. It recomputes the FICA from the wage figure at the statutory
 * rates and compares against the withheld amounts as filed, and it also parses
 * the dollar figures back OUT of the worked example's step strings so the prose
 * and the constants cannot drift. It is wired into
 * `assertForm941ConfirmationLessonsAreWellFormed()`, which the test suite calls.
 */
export const AS_FILED_2025_SS_WAGES_CENTS = 5_353_016;
export const AS_FILED_2025_BOX_4_CENTS = 331_887;
export const AS_FILED_2025_BOX_6_CENTS = 77_619;

/**
 * The premium in box 14 of the same W-2. Held here because it is the amount the
 * unanswered plan-or-system question is worth, and the lesson below now names
 * that figure as an open item rather than as a settled carve-out.
 */
export const AS_FILED_2025_BOX_14_HEALTH_CENTS = 3_098_016;

/**
 * Statutory rates, as basis points, so the gate below computes rather than
 * asserts. 6.2% employee OASDI (§3101(a)), 1.45% employee HI (§3101(b)).
 *
 * Written as constants rather than inline numbers because the gate must fail if
 * a rate is edited, and a magic number inside an expression is not a thing
 * anyone edits deliberately.
 */
const OASDI_EMPLOYEE_BPS = 620;
const MEDICARE_EMPLOYEE_BPS = 145;

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
          "These are the figures exactly as they appear on the W-2 you filed for yourself.",
          "Box 3, social security wages:            $53,530.16",
          "Box 4, the employee half withheld:       $53,530.16 x 6.2%  = $3,318.87",
          "Greenway's matching half:                $53,530.16 x 6.2%  = $3,318.87",
          "What the four 941s report for the year:  $53,530.16 x 12.4% = $6,637.74",
          "So $6,637.74 across the 941s against $3,318.87 on the W-2 - exactly double, " +
            "because nobody here is near the $200,000 threshold.",
          "Medicare, on the same wages:",
          "Box 6, the employee half:                $53,530.16 x 1.45% = $776.19",
          "What the four 941s report:               $53,530.16 x 2.9%  = $1,552.37",
          "Always take this figure from box 3, never from box 1. On most W-2s those two " +
            "boxes hold different numbers, because income tax and Social Security use two " +
            "different legal definitions of the word 'wages' - Congress wrote it that way, " +
            "section 3401(a) for box 1 and section 3121(a) for box 3.",
          "SOMETHING TO ASK YOUR CPA ABOUT, ON THIS FORM, THIS YEAR. On your 2025 W-2 " +
            "boxes 1, 3 and 5 are all the same $53,530.16, and box 14 shows HEALTH " +
            "$30,980.16. That means the health premium was included in the Social Security " +
            "and Medicare wages. Whether it should have been depends on one fact about " +
            "Greenway that this software has not been told: section 3121(a)(2) leaves the " +
            "premium out of FICA only when it is paid under a plan or system covering your " +
            "employees generally, or a class of them. If Greenway has such a plan, then " +
            "$30,980.16 x 15.3% = $4,739.96 of combined FICA was paid that did not have to " +
            "be - your half and the company's half together. If it does not, the " +
            "form is right as filed. Do not change anything on the strength of this note - " +
            "get the answer in writing from Nicholas Mullan first, because the same answer " +
            "also moves your 941s and your 940.",
        ],
        answer: "$6,637.74 social security and $1,552.37 Medicare, against $3,318.87 and $776.19",
        moral:
          "The doubling itself is exact rather than approximate for ordinary wages, and the one " +
          "thing that breaks it is Additional Medicare Tax, which is the next lesson. Notice what " +
          "this example did and did not do: it took your filed figures as a description of what " +
          "you reported, checked the arithmetic inside them, and then flagged one number as a " +
          "question rather than blessing it. A filed return is proof of what you did. It is never " +
          "proof that what you did was right.",
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

/** Render integer cents the way the worked example writes them: $53,530.16 */
function centsToDollarString(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = String(Math.abs(cents % 100)).padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${frac}`;
}

/**
 * Cents at a basis-point rate, rounded half-up — the rule the payroll engine
 * uses and the rule the withheld figures on the filed W-2 actually follow.
 */
function centsAtBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GATE THE DOCBLOCK PROMISED AND NOBODY WROTE (books-55).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until this slice, the comment above the `AS_FILED_*` constants claimed "a gate
 * multiplies these out and checks the answers". No such gate existed and the
 * constants were referenced nowhere. This is it, and it checks three distinct
 * things, because the interesting failures are different in each case.
 *
 * 1. THE ARITHMETIC IS RECOMPUTED, NOT RESTATED. The gate multiplies the wage
 *    figure by the statutory rates and compares the result against the withheld
 *    amounts as filed. If either disagrees, then the figures transcribed from
 *    the PDF are internally inconsistent and one of them was mistyped.
 *
 * 2. THE PROSE IS PARSED BACK OUT OF THE LESSON. The worked example writes its
 *    dollar amounts inside strings, which is what let the constants rot unread
 *    in the first place: two copies of a figure, only one of which anything
 *    looked at. So the gate scans the step strings for the rendered forms of
 *    each constant and requires them to be present. Edit a constant without
 *    editing the prose and the build stops.
 *
 * 3. THE LESSON MUST NOT SAY IT KNOWS WHAT IT DOES NOT KNOW. This is the part
 *    that exists because of Michael's correction, and it is the only assertion
 *    here about MEANING rather than arithmetic. The premium's FICA treatment
 *    turns on a plan-or-system condition nobody has evidenced, so the lesson is
 *    required to name that open question and forbidden to describe the premium
 *    as simply "carved out of FICA". A previous draft did exactly that, in the
 *    indicative, next to a form where the opposite had been filed.
 *
 * Throws rather than returning a boolean (rule 48).
 */
export function assertAsFiledFiguresReconcile(): void {
  const doubling = FORM_941_CONFIRMATION_LESSONS.find((l) => l.box === "doubling");
  if (!doubling) {
    throw new Error(
      `form-941-confirmation-lessons: the "doubling" lesson has gone. It is the lesson that ` +
        `carries the worked example built from the AS_FILED_* constants, so its removal would ` +
        `leave those constants unread again - which is the exact defect books-55 fixed.`,
    );
  }
  checkAsFiledFigures(
    {
      ssWagesCents: AS_FILED_2025_SS_WAGES_CENTS,
      box4Cents: AS_FILED_2025_BOX_4_CENTS,
      box6Cents: AS_FILED_2025_BOX_6_CENTS,
      box14HealthCents: AS_FILED_2025_BOX_14_HEALTH_CENTS,
    },
    doubling.examples.flatMap((e) => [...e.steps, e.answer, e.moral]).join(" \u0001 "),
  );
}

/** The four figures read off the filed 2025 W-2, as integer cents. */
export type AsFiledW2Figures = {
  readonly ssWagesCents: number;
  readonly box4Cents: number;
  readonly box6Cents: number;
  readonly box14HealthCents: number;
};

/**
 * ═══ THE GATE ITSELF, TAKING ITS INPUTS AS ARGUMENTS. ═══
 *
 * SPLIT OUT FROM THE WRAPPER ABOVE FOR ONE REASON, AND IT IS STANDING RULE 15.
 *
 * The first draft of this gate read the module's own constants directly. It
 * passed, and there was no way to make it fail without editing the shipping
 * source file, running the suite, and editing it back. I did exactly that nine
 * times while writing it — and two of those nine "mutations" turned out to have
 * struck a DOCBLOCK COMMENT rather than the lesson text, so they proved nothing
 * while appearing to prove the gate was weak. One of them sent me looking for a
 * hole that was not there; the other hid a hole that WAS.
 *
 * A gate whose failure modes can only be demonstrated by temporarily breaking
 * the product is a gate whose failure modes are not in the test suite. So the
 * logic takes its figures and its prose as parameters, the wrapper supplies the
 * real ones, and `form-941-confirmation.test.ts` supplies deliberately broken
 * ones. Every branch below has a test that watches it throw.
 */
export function checkAsFiledFigures(f: AsFiledW2Figures, prose: string): void {
  // ---- 1. recompute ------------------------------------------------------
  const expectedBox4 = centsAtBps(f.ssWagesCents, OASDI_EMPLOYEE_BPS);
  if (expectedBox4 !== f.box4Cents) {
    throw new Error(
      `form-941-confirmation-lessons: the figures transcribed from the filed 2025 W-2 do not ` +
        `reconcile. Box 3 of ${centsToDollarString(f.ssWagesCents)} at 6.2% is ` +
        `${centsToDollarString(expectedBox4)}, but box 4 was transcribed as ` +
        `${centsToDollarString(f.box4Cents)}. Either a figure was mistyped from the ` +
        `PDF, or the filed return itself does not foot - and those are very different problems. ` +
        `Re-read the PDF before changing a constant.`,
    );
  }
  const expectedBox6 = centsAtBps(f.ssWagesCents, MEDICARE_EMPLOYEE_BPS);
  if (expectedBox6 !== f.box6Cents) {
    throw new Error(
      `form-941-confirmation-lessons: box 5 of ` +
        `${centsToDollarString(f.ssWagesCents)} at 1.45% is ` +
        `${centsToDollarString(expectedBox6)}, but box 6 was transcribed as ` +
        `${centsToDollarString(f.box6Cents)}.`,
    );
  }
  // The premium is a fact off the form, so it gets the same treatment: it must
  // be positive, because the whole open question is meaningless at zero and a
  // silently-zeroed constant would make the lesson's flag read as boilerplate.
  if (f.box14HealthCents <= 0) {
    throw new Error(
      `form-941-confirmation-lessons: the box 14 health premium is ` +
        `${f.box14HealthCents} cents. The section 3121(a)(2) question this module ` +
        `raises only exists because the premium is a real, positive amount.`,
    );
  }

  // ---- 2. the prose must carry the same figures --------------------------

  /**
   * EVERY money figure the example is allowed to contain, each DERIVED here
   * rather than transcribed.
   *
   * The first version of this check asked only whether each figure appeared
   * SOMEWHERE in the prose, and a mutation test broke it in seconds: the wage
   * figure is written seven times in this example, so corrupting one copy left
   * six intact and the gate went green on a lesson that now contradicted
   * itself on screen. "At least one copy is right" is not the property worth
   * having when Michael is reading all seven.
   *
   * So the check runs in BOTH directions. Every figure below must appear, and
   * every dollars-and-cents figure in the prose must be one of these. A typo in
   * any copy is then caught, because the typo is itself an unrecognised figure.
   */
  const derived: readonly (readonly [string, number])[] = [
    ["box 3 / box 5 social security and Medicare wages, as filed", f.ssWagesCents],
    ["box 4 social security withheld = wages x 6.2%", f.box4Cents],
    ["box 6 Medicare withheld = wages x 1.45%", f.box6Cents],
    ["box 14 health premium, as filed", f.box14HealthCents],
    ["both halves of social security = wages x 12.4%", centsAtBps(f.ssWagesCents, OASDI_EMPLOYEE_BPS * 2)],
    ["both halves of Medicare = wages x 2.9%", centsAtBps(f.ssWagesCents, MEDICARE_EMPLOYEE_BPS * 2)],
    [
      "combined FICA riding on the plan-or-system question = premium x 15.3%",
      centsAtBps(f.box14HealthCents, (OASDI_EMPLOYEE_BPS + MEDICARE_EMPLOYEE_BPS) * 2),
    ],
  ];

  const allowed = new Map<string, string>();
  for (const [label, cents] of derived) allowed.set(centsToDollarString(cents), label);

  for (const [rendered, label] of allowed) {
    if (!prose.includes(rendered)) {
      throw new Error(
        `form-941-confirmation-lessons: the worked example no longer mentions ${rendered} ` +
          `(${label}). The constant and the prose are two copies of one fact, and this gate ` +
          `exists precisely because they were allowed to drift once already. Update both.`,
      );
    }
  }

  // The other direction. A figure with cents that this gate cannot derive is
  // either a new fact that belongs in `derived` above with a label saying where
  // it came from, or it is a typo. Both must stop the build; neither may be
  // guessed at here (rule 62d).
  //
  // Deliberately requires the decimal cents. Round figures like "$200,000" and
  // "$7,000" are thresholds quoted from statute, not amounts computed from
  // Michael's payroll, so they are not this gate's business - and the statutory
  // ones are verified where they belong, against the mirrored source text.
  for (const m of prose.matchAll(/\$\d[\d,]*\.\d{2}/g)) {
    const found = m[0];
    if (!allowed.has(found)) {
      throw new Error(
        `form-941-confirmation-lessons: the worked example contains ${found}, which this gate ` +
          `cannot derive from the AS_FILED_* constants at statutory rates. Either it is a typo in ` +
          `one of the several places a figure is repeated - the exact failure this direction of ` +
          `the check was added to catch - or it is a genuinely new figure, in which case add it to ` +
          `\`derived\` with a label stating how it is computed. Do not delete the figure to make ` +
          `this pass. Derivable amounts: ${[...allowed.keys()].join(", ")}.`,
      );
    }
  }

  // ---- 3. the open question must stay open -------------------------------
  //
  // A filed form is evidence, never authority. The lesson may report what the
  // W-2 shows; it may not decide the legal question the form leaves open. These
  // two checks pin both halves of that.
  const lower = prose.toLowerCase();
  if (!lower.includes("3121(a)(2)") || !lower.includes("plan or system")) {
    throw new Error(
      `form-941-confirmation-lessons: the worked example must name section 3121(a)(2) AND the ` +
        `words "plan or system". The premium's FICA treatment depends entirely on that condition, ` +
        `and a lesson that omits it teaches a conclusion in place of a rule. Michael filed these ` +
        `forms himself and asked for the law rather than a description of his paperwork.`,
    );
  }
  if (lower.includes("carved out of fica")) {
    throw new Error(
      `form-941-confirmation-lessons: the worked example says the premium is "carved out of FICA" ` +
        `as a plain statement of fact. It is not a plain fact. Section 3121(a)(2) removes the ` +
        `premium from FICA wages only where a qualifying plan or system exists, no such plan has ` +
        `been evidenced for Greenway, and the 2025 W-2 as filed put the premium THROUGH FICA. ` +
        `State the condition or state nothing.`,
    );
  }
}

/**
 * Self-check: no duplicate box keys, nothing structurally empty.
 *
 * Throws rather than returning a boolean (rule 48). Called by the gate, which
 * would otherwise be asserting that a list it never exercised is well-formed.
 */
export function assertForm941ConfirmationLessonsAreWellFormed(): void {
  // books-55: run the figure reconciliation FIRST. If the numbers underneath the
  // teaching are wrong, the structural checks below are checking the shape of
  // something untrue, and a well-formed lesson full of wrong arithmetic is the
  // most dangerous artefact this module could produce.
  assertAsFiledFiguresReconcile();
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
