/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  A BOX THAT HOLDS A NAME MUST NEVER BE CLASSIFIED AS MONEY (books-56)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. Mutation M16 of `scripts/mutate-books-56-lessons.py`
 * changed one word in `FORM_W2_WHOSE`:
 *
 *     e: { whose: "not_money",     ->    e: { whose: "employee_money",
 *
 * Box e is the employee's NAME. The mutation was predicted RED. Every one of the
 * repository's 11,000-odd tests stayed green.
 *
 * ═══ WHY THAT ONE WORD MATTERS MORE THAN IT LOOKS ═══
 *
 * `whose` is not a label. `resolveWhose` in form-box-teaching-core.ts derives the
 * UNIT from it:
 *
 *     measure: row.whose === "not_money" ? "count" : "money"
 *
 * So `not_money` is load-bearing. Flip box e and the teaching layer is told that
 * an employee's name is a monetary quantity belonging to the employee, and the
 * form viewer will present it as one. The docblock above `FORM_W2_WHOSE` already
 * said this in plain English - "without it box a would render Teri Becker's SSN
 * as a dollar amount" - and no test made it true. A claim in a comment is a
 * claim; this file is the check.
 *
 * The consequence is worse on the W-2 than almost anywhere else in the system,
 * for a reason specific to Michael's situation. He prepared all of Greenway's
 * W-2s and the W-3 himself and believes he may have got them wrong. Boxes a, e
 * and f are the SSN, the name and the address - the three fields the SSA matches
 * on. A wrong figure in box 1 is an arithmetic error the IRS queries. A wrong
 * NAME in box e is silent: the return is accepted, nothing on Greenway's side
 * looks wrong, and an employee's lifetime earnings record is short by a year.
 *
 * ═══ HOW THIS GATE DECIDES WHAT AN IDENTIFIER IS ═══
 *
 * Not from a hand-written list of box ids. A second hand-written list is what
 * books-49 already proved unsafe: the specimen's `whose` column was authored by
 * hand next to the caption and was wrong within hours.
 *
 * Instead the decision is read from the CAPTION - the form's own printed words,
 * which is the one description of a box that is not ours to choose. If the paper
 * calls a box "Employee's SSN", then whatever else is true, that box does not
 * hold money. The caption is matched against a list of NOUNS THAT ARE NEVER
 * AMOUNTS (name, number, address, ZIP, and so on), and any box whose caption is
 * built from those must resolve to `not_money` with measure "count".
 *
 * That inverts the drift risk in the right direction. If someone adds a new
 * identifier box and classifies it as money, the caption gives it away. If
 * someone renames a caption to dodge this gate, they have changed the form's
 * printed words, which `form-box-teaching-core.ts` gates separately against the
 * PDF.
 *
 * ═══ WHY IT ASKS `teachingBoxes` AND NOT THE TABLE ═══
 *
 * `resolveWhose` is deliberately PRIVATE to form-box-teaching-core. This gate
 * does not export it just to reach it - it calls `teachingBoxes(formId)`, the
 * same public function the form viewer calls, and reads the `whose` and
 * `measure` off the FormBox that comes back. So the derivation step is inside
 * the measurement, not beside it: a regression either in the table or in the
 * `not_money ? "count" : "money"` line is caught, and so is a regression in
 * anything the renderer would actually see.
 *
 * ═══ WHAT THIS GATE DOES NOT DO, SAID PLAINLY ═══
 *
 * It does not check that a money box is classified as the RIGHT kind of money -
 * employee, employer or shared. That is `assertW3MoneyBoxesMatchTheirW2Box` and
 * the L&I gates. This one closes a narrower hole: the boundary between "an
 * amount" and "not an amount at all". It also does not inspect the figures
 * overlaid by `w3Boxes`; it checks the classification every box is taught with.
 */

import { describe, it, expect } from "vitest";

import { ALL_WHOSE_MONEY, type BoxMeasure, type WhoseMoney } from "@/lib/payroll/form-box-core";
import {
  ALL_TAUGHT_FORM_IDS,
  FORM_W2_WHOSE,
  FORM_W3_WHOSE,
} from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";

/**
 * Caption words that can never describe a sum of money.
 *
 * Deliberately nouns for THINGS, not adjectives. "Total" and "amount" are not
 * here, obviously; but neither is "wages", because a caption can say "Wages,
 * tips, and other compensation" and be money, while a caption saying "Employer's
 * name, address, and ZIP code" cannot be money no matter what else it says.
 *
 * `routing number` and `account number` were added after the first draft of this
 * file MISSED them. Form 941 lines 15c and 15e and Form 940 lines 15c and 15e
 * carry Greenway's bank routing and account numbers for a refund deposit. They
 * are digits printed in a box on a tax return, which is exactly the shape of
 * thing this gate exists to keep out of the money column, and the first version
 * of this list walked straight past all four of them. They were found by
 * printing every caption instead of trusting the list (rule 39).
 */
const NEVER_AN_AMOUNT: readonly RegExp[] = [
  /\bname\b/i,
  /\bnames\b/i,
  /\baddress\b/i,
  /\bZIP\b/i,
  /\bsocial security number\b/i,
  /\bSSN\b/i,
  /\bEIN\b/i,
  /\bidentification number\b/i,
  /\bcontrol number\b/i,
  /\bestablishment number\b/i,
  /\brouting number\b/i,
  /\baccount number\b/i,
  /\binitial\b/i,
  /\bSuff\b/i,
  /\bemail\b/i,
  /\btelephone\b/i,
  /\bfax\b/i,
  /\bstate ID\b/i,
];

/**
 * Caption words that DO mean money (or another real quantity).
 *
 * Used only to detect a caption that names BOTH kinds of thing, which this gate
 * refuses to judge by itself - see `assertNoCaptionNamesBothKinds`.
 */
const IS_AN_AMOUNT: readonly RegExp[] = [
  /\bwages\b/i,
  /\btips\b/i,
  /\bcompensation\b/i,
  /\btax\b/i,
  /\btaxes\b/i,
  /\bpremium/i,
  /\bwithheld\b/i,
  /\bwithholding\b/i,
  /\bpay\b/i,
  /\bbenefits\b/i,
  /\bamount\b/i,
  /\btotal\b/i,
  /\bdeposit/i,
  /\bcontributions\b/i,
  /\bearnings\b/i,
  /\bpayments\b/i,
  /\bhours\b/i,
];

function namesAnIdentifier(caption: string): boolean {
  return NEVER_AN_AMOUNT.some((re) => re.test(caption));
}

function namesAnAmount(caption: string): boolean {
  return IS_AN_AMOUNT.some((re) => re.test(caption));
}

/**
 * ═══ THE ONE CONDITION THIS FILE ENFORCES ═══
 *
 * Extracted into a function on purpose, so the live walk over the real forms and
 * the mutation proof at the bottom exercise THE SAME predicate. If the proof
 * re-stated the condition in its own words, it would prove something about its
 * own copy and nothing about the gate (rule 39).
 */
function violatesTheRule(whose: WhoseMoney, measure: BoxMeasure): boolean {
  return whose !== "not_money" || measure !== "count";
}

/** Every taught box, flattened, with the form it came from. */
function everyTaughtBox(): readonly {
  formId: string;
  box: string;
  caption: string;
  whose: WhoseMoney;
  measure: BoxMeasure;
}[] {
  const out: {
    formId: string;
    box: string;
    caption: string;
    whose: WhoseMoney;
    measure: BoxMeasure;
  }[] = [];
  for (const formId of ALL_TAUGHT_FORM_IDS) {
    for (const b of teachingBoxes(formId)) {
      out.push({
        formId,
        box: b.box,
        caption: b.caption,
        whose: b.whose,
        measure: b.measure,
      });
    }
  }
  return out;
}

describe("identifier boxes are never money", () => {
  it("the population exists before anything is asserted about it", () => {
    /*
     * Rule 66d - assert existence before absence. Every floor below is only
     * meaningful if the thing being counted is really there. `teachingBoxes`
     * THROWS for an unknown form rather than returning [], so a form id that
     * stopped being taught fails here loudly instead of shrinking the sample.
     */
    expect(Object.keys(FORM_W2_WHOSE).length).toBeGreaterThan(20);
    expect(Object.keys(FORM_W3_WHOSE).length).toBeGreaterThan(10);
    expect(ALL_TAUGHT_FORM_IDS.length).toBeGreaterThan(4);

    const boxes = everyTaughtBox();
    expect(boxes.length, "no taught boxes at all").toBeGreaterThan(100);
    for (const formId of ALL_TAUGHT_FORM_IDS) {
      expect(
        boxes.filter((b) => b.formId === formId).length,
        `${formId} teaches no boxes, so including it proves nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("every box whose caption names an identifier is not_money, and measures a count", () => {
    const offences: string[] = [];
    const identifiers: string[] = [];

    for (const b of everyTaughtBox()) {
      if (!namesAnIdentifier(b.caption)) continue;
      if (namesAnAmount(b.caption)) continue; // judged by the next test instead
      identifiers.push(`${b.formId} ${b.box}`);

      if (violatesTheRule(b.whose, b.measure)) {
        offences.push(
          `${b.formId} box ${b.box} is captioned "${b.caption}" - which names an identifier, ` +
            `not an amount - but the engine resolves it to whose="${b.whose}", ` +
            `measure="${b.measure}". A box holding a name, a number or an address must be ` +
            'not_money: "measure" is derived from "whose", so classifying it as money makes ' +
            "the teaching layer present a person's name, SSN or bank account as a dollar " +
            "figure. This is mutation M16, which survived the books-56 campaign because " +
            "nothing checked it.",
        );
      }
    }

    expect(offences, offences.join("\n\n")).toEqual([]);

    /*
     * Rule 39: a gate that examined nothing reports success. This floor is a
     * MEASURED value. At the time of writing the walk finds 21 identifier boxes:
     * eight on the W-2 (a, b, c, d, e, f, 15, 20), eight on the W-3 (a, d, e, f,
     * g, h, 15, contact), the routing and account numbers on Form 941 lines 15c
     * and 15e and on Form 940 lines 15c and 15e, and the employee name/SSN
     * column of ESD 5208B. Twenty is a floor, not the count, so adding forms
     * cannot break it - but NEVER_AN_AMOUNT silently ceasing to match can.
     */
    expect(
      identifiers.length,
      `only ${identifiers.length} captions were recognised as identifiers (${identifiers.join(
        ", ",
      )}). Either the forms stopped printing names and numbers, or NEVER_AN_AMOUNT has stopped ` +
        "matching the captions - and in the second case this gate is green while checking nothing.",
    ).toBeGreaterThanOrEqual(20);

    console.log(
      `identifier-boxes: ${identifiers.length} identifier boxes, all not_money/count ` +
        `(${identifiers.join(", ")})`,
    );
  });

  /**
   * WHY THIS IS AN ASSERTION AND NOT A `continue` (rule 40, rule 48).
   *
   * The first draft of this file did something quieter: a caption naming both an
   * identifier and an amount was SKIPPED and counted, with the count asserted to
   * be small. Printing the real captions showed the count is ZERO on all eight
   * forms - so that branch could never execute. An unreachable branch is an
   * untested branch, and this one was a silent skip hiding in a gate whose whole
   * purpose is to refuse to be silent.
   *
   * So the same fact is asserted out loud instead. Today no form caption mixes
   * the two vocabularies. On the day one does, this fails and a person decides
   * which it is, rather than the box slipping through unjudged.
   */
  it("no form caption names both an identifier and an amount", () => {
    const both = everyTaughtBox()
      .filter((b) => namesAnIdentifier(b.caption) && namesAnAmount(b.caption))
      .map((b) => `${b.formId} box ${b.box}: "${b.caption}" (whose=${b.whose})`);

    expect(
      both,
      "These captions match BOTH the identifier vocabulary and the money vocabulary, so the " +
        "test above declined to judge them and they are currently checked by nothing:\n" +
        both.join("\n") +
        "\n\nDecide each one. If it is an identifier, narrow the IS_AN_AMOUNT pattern that " +
        "matched it. If it is money, narrow the NEVER_AN_AMOUNT pattern. Do not add a skip.",
    ).toEqual([]);
  });

  /**
   * THE PROOF THAT THIS GATE WOULD HAVE REFUSED M16 (rule 15).
   *
   * The walk above reads live data, so it passes today by construction, which is
   * not evidence that it can fail. This drives `violatesTheRule` - the very
   * function the walk uses - with the classification M16 produces, and with
   * every OTHER classification in the vocabulary too.
   *
   * It walks `ALL_WHOSE_MONEY` rather than naming "employee_money", per rule 43:
   * a test that hand-lists the members passes happily on the day a sixth
   * category is added and never mentions it again.
   */
  it("would have refused M16, and any other misclassification of an identifier box", () => {
    const boxE = everyTaughtBox().find((b) => b.formId === "form_w2" && b.box === "e");
    expect(boxE, "form_w2 box e is not taught, so M16's target no longer exists").toBeDefined();
    expect(
      namesAnIdentifier(boxE!.caption),
      `box e is captioned "${boxE!.caption}" and this gate no longer recognises it as an ` +
        "identifier, so the M16 hole is open again",
    ).toBe(true);

    // The real classification passes the rule.
    expect(violatesTheRule(boxE!.whose, boxE!.measure)).toBe(false);

    /*
     * `measure` is not free: form-box-teaching-core derives it from `whose` with
     * `whose === "not_money" ? "count" : "money"`. So a mutation of `whose` drags
     * `measure` with it, and the pair below is what the engine would really
     * produce - not a pair chosen to make the assertion pass.
     */
    const deriveMeasure = (whose: WhoseMoney): BoxMeasure =>
      whose === "not_money" ? "count" : "money";

    expect(ALL_WHOSE_MONEY.length).toBeGreaterThan(1);
    let rejected = 0;
    for (const whose of ALL_WHOSE_MONEY) {
      const caught = violatesTheRule(whose, deriveMeasure(whose));
      if (whose === "not_money") {
        expect(caught, "the correct classification must NOT be reported as an offence").toBe(false);
        continue;
      }
      expect(
        caught,
        `classifying the employee's name box as "${whose}" (which the engine turns into ` +
          `measure "${deriveMeasure(whose)}") was NOT reported as an offence, so this gate ` +
          "would let that mutation through",
      ).toBe(true);
      rejected += 1;
    }

    /*
     * M16 used "employee_money" specifically. Assert it is one of the values just
     * proved to be rejected, so this proof stays tied to the actual mutation
     * rather than to the vocabulary in general.
     */
    expect(ALL_WHOSE_MONEY).toContain("employee_money");
    expect(rejected, "no wrong classification was rejected").toBe(ALL_WHOSE_MONEY.length - 1);
  });
});
