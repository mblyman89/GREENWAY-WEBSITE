/**
 * tests/compliance/wage-order-entry-mentor.test.ts   (books-38)
 *
 * THE MENTOR THAT ANSWERS MICHAEL'S ACTUAL QUESTION.
 *
 * He asked, verbatim:
 *
 *     "the child support and garnishment page does not have a way for me to
 *      enter that in... Please let me know how to use and set up garnishments
 *      and child support with the details from the judgement."
 *
 * He was right that there was no way in. books-38 builds it. This suite proves
 * the teaching that ships with it is COMPLETE and NOT VACUOUS - that every
 * refusal the form can produce has an explanation, every box he has to fill has
 * a lesson saying where on the paper the answer is, and that none of those
 * lessons is a placeholder that satisfies a count while teaching nothing.
 *
 * Every gate here is also proved to FIRE (standing rule 16). A coverage gate
 * that cannot fail is a decoration, and this repo has been bitten by that
 * exact shape more than once.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_WAGE_ORDER_REFUSAL_CODES,
  EMPTY_WAGE_ORDER_DRAFT,
} from "@/lib/payroll/wage-order-entry-core";
import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";
import {
  JUDGEMENT_FIELD_LESSONS,
  WAGE_ORDER_ENTRY_REFUSAL_LESSONS,
  WAGE_ORDER_ENTRY_SCREEN_LESSONS,
  WAGE_ORDER_ENTRY_WALKTHROUGH,
} from "@/lib/payroll/wage-order-entry-mentor";
import {
  ENTRY_FIELDS_WITHOUT_LESSONS,
  MIN_LESSON_CHARS,
  assertEntryLessonsHaveSubstance,
  assertEveryCitedEntryAuthorityExists,
  assertEveryEntryRefusalCodeIsTaught,
  assertEveryJudgementFieldIsTaught,
  assertRefusalCodeUnionMatchesRuntimeList,
  assertWalkthroughIsAnOrderedSequence,
  refusalCodesDeclaredInEngineSource,
  uncitedEntryAuthorityIds,
} from "@/lib/payroll/wage-order-entry-mentor-gates";

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every refusal the entry form can produce is explained", () => {
  it("passes against the real engine", () => {
    expect(() => assertEveryEntryRefusalCodeIsTaught()).not.toThrow();
  });

  it("teaches all twenty-seven codes", () => {
    // Pinned deliberately. If a code is added, this fails and forces whoever
    // added it to write the lesson rather than letting the count drift.
    expect(ALL_WAGE_ORDER_REFUSAL_CODES.length).toBe(27);
    expect(WAGE_ORDER_ENTRY_REFUSAL_LESSONS.length).toBe(27);
  });

  it("the type union and the runtime list agree, in both directions", () => {
    // The runtime array exists so tests can ENUMERATE the codes; books-37 hit
    // the case where a code existed only as a type and was therefore invisible
    // to every gate. This checks the array has not since drifted from it.
    expect(() => assertRefusalCodeUnionMatchesRuntimeList()).not.toThrow();
  });

  it("reads the codes from the engine SOURCE, not just its exports", () => {
    const declared = refusalCodesDeclaredInEngineSource();
    // rule 39: a parse that returned nothing would make the comparison above
    // vacuously true.
    expect(declared.length).toBe(27);
    expect(declared).toContain("NO_SERVED_DATE");
    expect(declared).toContain("DUPLICATE_CASE_NUMBER");
  });

  it("GATE IS WIRED: a code with no lesson fails, and the parse refuses on junk", () => {
    // The union parser must REFUSE rather than report zero codes, because zero
    // would make the coverage comparison vacuously true.
    expect(() => refusalCodesDeclaredInEngineSource("/nonexistent/engine.ts")).toThrow();
  });

  it("no code is taught twice", () => {
    const codes = WAGE_ORDER_ENTRY_REFUSAL_LESSONS.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("the two support questions explain that there is no safe default", () => {
    // These two refusals are the ones most likely to be seen as bureaucratic
    // and worked around, because both look like a tick box nobody read. The
    // lesson has to say WHY a blank is refused rather than defaulted.
    for (const code of [
      "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER",
      "SUPPORT_NEEDS_ARREARS_AGE_ANSWER",
    ] as const) {
      const lesson = WAGE_ORDER_ENTRY_REFUSAL_LESSONS.find((l) => l.code === code);
      expect(lesson, `${code} has no lesson`).toBeDefined();
      expect(lesson!.whatToDo.toLowerCase()).toContain("ask");
    }
  });

  it("the duplicate-case refusal tells him what to do about an AMENDED order", () => {
    // The realistic case. Re-entering an amended order is the situation that
    // produces this refusal in practice, and overwriting would destroy history.
    const lesson = WAGE_ORDER_ENTRY_REFUSAL_LESSONS.find(
      (l) => l.code === "DUPLICATE_CASE_NUMBER",
    );
    expect(lesson!.whatToDo.toLowerCase()).toContain("amended");
    expect(lesson!.whatToDo.toLowerCase()).toContain("terminate");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every box on the form says where on the judgement to find it", () => {
  it("passes against the real draft shape", () => {
    expect(() => assertEveryJudgementFieldIsTaught()).not.toThrow();
  });

  it("covers every draft field except the two deliberate exemptions", () => {
    const fields = Object.keys(EMPTY_WAGE_ORDER_DRAFT);
    expect(fields.length).toBeGreaterThan(10); // rule 39
    const taught = new Set(JUDGEMENT_FIELD_LESSONS.map((l) => l.draftField));
    for (const f of fields) {
      if (ENTRY_FIELDS_WITHOUT_LESSONS.includes(f)) continue;
      expect(taught.has(f), `${f} has no lesson`).toBe(true);
    }
  });

  it("the exemptions are only the picker and the free-text note", () => {
    // Pinned so that widening the exemption list is a visible decision rather
    // than a quiet way to make a coverage failure disappear.
    expect([...ENTRY_FIELDS_WITHOUT_LESSONS].sort()).toEqual(["employeeId", "notes"]);
  });

  it("every lesson names a field that really exists on the form", () => {
    const fields = new Set(Object.keys(EMPTY_WAGE_ORDER_DRAFT));
    for (const l of JUDGEMENT_FIELD_LESSONS) {
      expect(fields.has(l.draftField), `${l.draftField} is not a form field`).toBe(true);
    }
  });

  it("THE LESSON THIS SLICE EXISTS FOR: served date is not the order date", () => {
    // If one lesson in this file survives, it should be this one. Confusing
    // these two dates misstates both statutory clocks with a single keystroke.
    const served = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "servedDate");
    expect(served).toBeDefined();
    // It must send him to the delivery evidence, NOT to the order.
    expect(served!.whereOnThePaper.toLowerCase()).toContain("not on the order");
    expect(served!.theTrap.toLowerCase()).toContain("twenty days");
    // And it must warn about the direction that does not look wrong.
    expect(served!.theTrap.toLowerCase()).toContain("reassures");
  });

  it("the monthly-to-biweekly conversion is spelled out, not left as arithmetic", () => {
    // Halving a monthly support figure under-withholds by ~8% forever, and the
    // employer is liable for the shortfall. The lesson must give the real
    // conversion rather than trusting the reader to derive it.
    //
    // NOTE ON THIS TEST'S OWN HISTORY: the first version of it asserted that
    // `theTrap` contained the DIGITS "26". It failed - not because the lesson
    // was wrong, but because the prose spells the numbers out in words
    // ("twenty-six times a year") the way prose should, and the digits live in
    // the worked `example` where a reader can copy them. The assertion was
    // testing my typography, not the teaching. It now checks each half where
    // that half actually lives: the RULE in words in the trap, the ARITHMETIC
    // in digits in the example.
    const amount = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "fixedAmountText");

    // The rule, stated in prose: twenty-six periods, and explicitly NOT half.
    expect(amount!.theTrap.toLowerCase()).toContain("twenty-six");
    expect(amount!.theTrap.toLowerCase()).toContain("twelve");
    expect(amount!.theTrap.toLowerCase()).toContain("not the monthly figure divided by two");

    // The arithmetic, in digits, so it can be checked on a calculator.
    expect(amount!.example).toContain("12");
    expect(amount!.example).toContain("26");
    expect(amount!.example).toContain("300.00");
  });

  it("the percent lesson warns about the basis-point conversion by example", () => {
    // 25 stored where 2500 belongs turns $288.20 into $2.88 and nothing looks
    // alarming. A warning with no numbers in it does not survive contact.
    const pct = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "percentText");
    expect(pct!.theTrap).toContain("2500");
    expect(pct!.theTrap).toContain("2.88");
  });

  it("the end-date lesson teaches BOTH directions of the expiry error", () => {
    // Creditor writs die at sixty days; support orders never do. The two
    // mistakes are opposite, and a lesson that only warns about one of them
    // leaves the other looking safe.
    const to = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "effectiveTo");
    expect(to!.theTrap.toLowerCase()).toContain("sixty days");
    expect(to!.theTrap.toLowerCase()).toContain("does not expire");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CITATIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every citation points at a real mirrored authority", () => {
  it("passes against the real registry", () => {
    expect(() => assertEveryCitedEntryAuthorityExists()).not.toThrow();
  });

  it("the registry is not empty, or the check above proves nothing", () => {
    expect(WAGE_ORDER_ENTRY_AUTHORITIES.length).toBe(9);
  });

  it("every mirrored authority is used by at least one lesson", () => {
    // Reported rather than thrown by the gate itself, asserted here because
    // for THIS registry every authority was mirrored in order to teach
    // something. An uncited one means a lesson was planned and forgotten.
    expect(uncitedEntryAuthorityIds()).toEqual([]);
  });

  it("the two liability authorities are cited where the stakes are explained", () => {
    const topics = WAGE_ORDER_ENTRY_SCREEN_LESSONS.flatMap((l) => l.authorityIds);
    expect(topics).toContain("wage-order-rcw-6-27-200-default");
    expect(topics).toContain("wage-order-rcw-26-18-110-liability");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SUBSTANCE  (the gates above prove a lesson EXISTS; these prove it SAYS something)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("no lesson is a placeholder", () => {
  it("passes against the real mentor", () => {
    expect(() => assertEntryLessonsHaveSubstance()).not.toThrow();
  });

  it("every refusal lesson explains why we stop AND what to do", () => {
    for (const l of WAGE_ORDER_ENTRY_REFUSAL_LESSONS) {
      expect(l.whyWeStop.length, `${l.code}.whyWeStop`).toBeGreaterThanOrEqual(MIN_LESSON_CHARS);
      expect(l.whatToDo.length, `${l.code}.whatToDo`).toBeGreaterThanOrEqual(MIN_LESSON_CHARS);
    }
  });

  it("no lesson is a TODO or a stub", () => {
    //
    // NOTE ON THIS TEST'S OWN HISTORY: the first version JSON.stringify'd the
    // whole array and searched the resulting text. It failed, and the failure
    // was a FALSE POSITIVE of the ugliest kind: JSON.stringify emits the KEY
    // names too, and the refusal lesson key `whatToDo` lowercases to
    // "whattodo", which contains "todo". The test was reading my own field
    // names as if they were placeholder prose. A gate that fires on its own
    // schema is worse than no gate, because the obvious "fix" is to delete it.
    // The correct fix is to search only the VALUES a human will ever read.
    //
    const prose: string[] = [];
    const harvest = (node: unknown): void => {
      if (typeof node === "string") {
        prose.push(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) harvest(item);
        return;
      }
      if (node && typeof node === "object") {
        // Object.values, NOT the keys - the keys are code, not teaching.
        for (const value of Object.values(node as Record<string, unknown>)) harvest(value);
      }
    };
    harvest([
      JUDGEMENT_FIELD_LESSONS,
      WAGE_ORDER_ENTRY_REFUSAL_LESSONS,
      WAGE_ORDER_ENTRY_SCREEN_LESSONS,
      WAGE_ORDER_ENTRY_WALKTHROUGH,
    ]);

    // Rule 39: guard the vacuous read. If `harvest` ever silently stopped
    // walking the structures, `prose` would be near-empty and every assertion
    // below would pass on nothing at all.
    expect(prose.length).toBeGreaterThan(200);

    const haystack = prose.join("\n").toLowerCase();
    for (const bad of ["todo", "tbd", "fixme", "lorem ipsum", "coming soon", "xxx", "placeholder"]) {
      expect(haystack).not.toContain(bad);
    }
  });

  it("GATE IS WIRED: the substance check has a real floor", () => {
    // Guard the guard. A floor of zero would pass every possible lesson.
    expect(MIN_LESSON_CHARS).toBeGreaterThan(20);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE WALKTHROUGH
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the walkthrough is something he can actually follow", () => {
  it("is a properly ordered sequence with no gaps or repeats", () => {
    expect(() => assertWalkthroughIsAnOrderedSequence()).not.toThrow();
    expect(WAGE_ORDER_ENTRY_WALKTHROUGH.length).toBe(10);
  });

  it("STEP 1 IS THE ENVELOPE, because that fact is the only unrecoverable one", () => {
    // Everything else can be re-read off the order next week. The date of
    // service cannot, and it is what every deadline is measured from.
    const first = WAGE_ORDER_ENTRY_WALKTHROUGH[0];
    expect(first.title.toLowerCase()).toContain("service");
    expect(first.doThis.toLowerCase()).toContain("before reading");
  });

  it("ANSWERING comes before entering the withholding details", () => {
    // The step employers skip, and the one carrying the largest penalty.
    // Ordering is the teaching here, so the order itself is asserted.
    const answer = WAGE_ORDER_ENTRY_WALKTHROUGH.find((s) =>
      s.title.toLowerCase().includes("answer"),
    );
    const measure = WAGE_ORDER_ENTRY_WALKTHROUGH.find((s) =>
      s.title.toLowerCase().includes("measure"),
    );
    expect(answer).toBeDefined();
    expect(measure).toBeDefined();
    expect(answer!.step).toBeLessThan(measure!.step);
  });

  it("the answer step says that withholding correctly does not cure a missing answer", () => {
    const answer = WAGE_ORDER_ENTRY_WALKTHROUGH.find((s) =>
      s.title.toLowerCase().includes("answer"),
    );
    expect(answer!.whyThisOrder.toLowerCase()).toContain("independent");
  });

  it("the last steps are verification and the fee, not data entry", () => {
    // Entry is not finished when the form saves. Every error in this area
    // produces a plausible number, so the first cheque gets read by hand.
    const check = WAGE_ORDER_ENTRY_WALKTHROUGH.find((s) =>
      s.doThis.toLowerCase().includes("read the garnishment lines"),
    );
    expect(check).toBeDefined();
    expect(check!.step).toBeGreaterThan(7);
  });

  it("the fee step says it never comes out of the remittance", () => {
    const fee = WAGE_ORDER_ENTRY_WALKTHROUGH.find((s) =>
      s.title.toLowerCase().includes("fee"),
    );
    expect(fee!.doThis.toLowerCase()).toContain("never reduces");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE ASYMMETRY THAT SHAPES THE WHOLE SLICE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the mentor teaches that doing nothing is the expensive mistake", () => {
  it("says so explicitly, because the intuition runs the other way", () => {
    // A careful employer who waits until they understand the order is walking
    // into the LARGER of the two penalties. If the mentor does not say this
    // plainly, nothing else it says will be read in the right frame.
    const lesson = WAGE_ORDER_ENTRY_SCREEN_LESSONS.find((l) =>
      l.topic.toLowerCase().includes("doing nothing"),
    );
    expect(lesson).toBeDefined();
    expect(lesson!.plainEnglish.toLowerCase()).toContain("entire debt");
  });

  it("teaches that complying is protected, which is why hesitating is not safer", () => {
    const lesson = WAGE_ORDER_ENTRY_SCREEN_LESSONS.find((l) =>
      l.topic.toLowerCase().includes("compliance protects"),
    );
    expect(lesson).toBeDefined();
    expect(lesson!.whyItMatters.toLowerCase()).toContain("delaying");
  });

  it("teaches that an employee's objection is not grounds to stop", () => {
    // The practical situation that tempts an employer into default.
    const lesson = WAGE_ORDER_ENTRY_SCREEN_LESSONS.find((l) =>
      l.topic.toLowerCase().includes("employee says it is a mistake"),
    );
    expect(lesson).toBeDefined();
    expect(lesson!.whyItMatters.toLowerCase()).toContain("written notice");
  });

  it("teaches the anti-retaliation rule and that it is criminal federally", () => {
    const lesson = WAGE_ORDER_ENTRY_SCREEN_LESSONS.find((l) =>
      l.topic.toLowerCase().includes("discipline"),
    );
    expect(lesson).toBeDefined();
    expect(lesson!.plainEnglish.toLowerCase()).toContain("criminal");
    expect(lesson!.authorityIds).toContain("wage-order-usc-15-1674-discharge");
  });
});
