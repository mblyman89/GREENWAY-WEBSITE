/**
 * tests/compliance/form-w2-ui-core.test.ts   (books-46, slice A)
 *
 * THE GATE ON EVERY DECISION THE W-2 SCREEN MAKES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS BEING PROTECTED HERE, AND WHY IT IS NOT THE ARITHMETIC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `form-w2-core.ts` already has 85 tests proving the arithmetic. Nothing in
 * this file re-checks a box figure, because a second opinion about the same
 * number formed in a test file is how two answers to one question come into
 * existence.
 *
 * What this file protects is the JUDGEMENT: which colour, which sentence,
 * which of five states, and above all WHAT THE SCREEN TELLS MICHAEL TO DO. A
 * screen that computes correctly and advises wrongly is more dangerous than one
 * that fails, because it is trusted.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EVERY FIXTURE IS BUILT BY THE REAL ENGINE (rule 73)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Not one `W2Form` in this file is hand-written as an object literal. They are
 * all produced by `buildW2`, and the W-3s by `buildW3`. A hand-built fixture
 * lets a test keep passing after the engine's shape changes underneath it,
 * which is the exact failure this whole project keeps finding in other people's
 * suites: green ticks over a shape nothing produces any more.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT WOULD DO REAL DAMAGE, AND ARE THEREFORE TESTED HARDEST
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   1. TELLING MICHAEL TO MAKE BOX 1 AGREE WITH BOXES 3 AND 5. On his own W-2
 *      it legitimately does not, and every available "fix" is wrong. §5 asserts
 *      the panel is GREEN, cites the carve-out, and contains no instruction to
 *      make them match.
 *   2. LETTING "FILE IT, IT IS DUE" OUTRANK "THE TOTALS DISAGREE". §3 proves
 *      that a broken reconciliation beats an overdue deadline, which is the one
 *      genuine judgement call in the UI core.
 *   3. RENDERING A CORRECTLY-BLANK BOX 17 AS AN ERROR. §5 proves it is neutral
 *      and carries a reason, and that a NON-zero box 17 is red.
 */

import { describe, expect, it } from "vitest";

import {
  buildW2,
  buildW3,
  reconcileW3To941s,
  ALL_W2_REFUSAL_CODES,
  type ReconciliationResult,
  type W2Form,
  type W2Refusal,
  type W3Form,
} from "@/lib/payroll/form-w2-core";
import { emptyAccumulator } from "@/lib/payroll/ytd-core";
import {
  FORM_W2_WORKED_EXAMPLES,
  w2ChecksInOrder,
  w2RefusalLessonFor,
} from "@/lib/payroll/form-w2-mentor";
import {
  groupW2Refusals,
  reconRows,
  reconciliationTone,
  voidNote,
  w2BoxDifferenceNote,
  w2BoxRows,
  w2ButtonState,
  w2CheckRows,
  w2DaysUntil,
  w2EmptyStateFor,
  w2ExampleRows,
  w2NextAction,
  w2RefusalCard,
  w2RefusalCoverage,
  w2StatusLabel,
  w2StatusMeaning,
  w2StatusOf,
  w2StatusTone,
  w2UrgencyBand,
  w2UrgencyMeaning,
  w2UrgencyTone,
  w3Rows,
  type W2Status,
  type W2UrgencyBand,
} from "@/lib/payroll/form-w2-ui-core";
import {
  ALL_SCREEN_TONES,
  toneMeaning,
  toneSeverity,
  worstTone,
  type ScreenTone,
} from "@/lib/ui/screen-tone-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * FIXTURES - built by the engine, never by hand
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The 2026 filing deadline, from `IW2W3_2026_WHEN_TO_FILE`. */
const DUE = "2027-02-01";

function makeForm(args: {
  readonly id: string;
  readonly first: string;
  readonly last: string;
  readonly shareholder: boolean;
  readonly premiumCents: number;
  readonly wagesCents: number;
  readonly isVoid?: boolean;
}): W2Form {
  const base = emptyAccumulator(args.id, 2026);
  const result = buildW2({
    taxYear: 2026,
    employee: {
      employeeId: args.id,
      firstNameAndInitial: args.first,
      lastName: args.last,
      suffix: null,
      ssn: "123456789",
      isTwoPercentShareholder: args.shareholder,
      scorpHealthPremiumCents: args.premiumCents,
      box12: [],
      box14: [{ label: "WA PFML", amountCents: 12_345 }],
      retirementPlan: false,
      statutoryEmployee: false,
      thirdPartySickPay: false,
      isVoid: args.isVoid ?? false,
    },
    ytd: {
      ...base,
      wages: {
        ...base.wages,
        oasdiWagesCents: args.wagesCents,
        medicareWagesCents: args.wagesCents,
      },
      oasdiEmployeeCents: Math.round(args.wagesCents * 0.062),
      medicareEmployeeCents: Math.round(args.wagesCents * 0.0145),
      federalIncomeTaxCents: 400_000,
    },
    state: {
      stateCode: "WA",
      employerStateIdNumber: "000-073905-00-0",
      stateWagesCents: args.wagesCents,
      stateIncomeTaxCents: 0,
    },
  });
  /*
   * RULE 39 GUARD ON THE FIXTURE ITSELF. If `buildW2` starts refusing this
   * input, every test below would receive `undefined` and fail for a reason
   * that has nothing to do with what it is checking. Fail here, loudly, naming
   * the refusals.
   */
  if (!result.ok) {
    throw new Error(
      `fixture did not build: ${result.refusals.map((r) => r.code).join(", ")}. The test's ` +
        `assumptions about the engine's input shape are wrong - fix the fixture, not the test.`,
    );
  }
  return result;
}

/** Michael. 2%-or-more shareholder with a company-paid premium: trap 1. */
const MICHAEL = makeForm({
  id: "mike",
  first: "Michael",
  last: "Lyman",
  shareholder: true,
  premiumCents: 1_800_000,
  wagesCents: 9_000_000,
});

/** An ordinary employee. Boxes 1, 3 and 5 all agree. */
const PLAIN = makeForm({
  id: "e2",
  first: "Jane A",
  last: "Doe",
  shareholder: false,
  premiumCents: 0,
  wagesCents: 5_000_000,
});

const VOIDED = makeForm({
  id: "e3",
  first: "Bob",
  last: "Smith",
  shareholder: false,
  premiumCents: 0,
  wagesCents: 1_000_000,
  isVoid: true,
});

/** A W-3 that agrees with its 941s, derived from the W-3 rather than typed. */
function agreeingRecon(w3: W3Form, quarters = 4): ReconciliationResult {
  return reconcileW3To941s({
    taxYear: 2026,
    w3,
    form941: {
      federalIncomeTaxWithheldCents: w3.box2Cents,
      socialSecurityWagesCents: w3.box3Cents,
      medicareWagesCents: w3.box5Cents,
      socialSecurityTaxCents: w3.box4Cents * 2,
      medicareTaxCents: w3.box6Cents * 2,
      quartersIncluded: quarters,
    },
    unmatchedAdditionalMedicareCents: 0,
  });
}

/** A W-3 that does NOT agree: one pay run reached the 941s and not the W-2s. */
function brokenRecon(w3: W3Form): ReconciliationResult {
  return reconcileW3To941s({
    taxYear: 2026,
    w3,
    form941: {
      federalIncomeTaxWithheldCents: w3.box2Cents + 250_000,
      socialSecurityWagesCents: w3.box3Cents,
      medicareWagesCents: w3.box5Cents,
      socialSecurityTaxCents: w3.box4Cents * 2,
      medicareTaxCents: w3.box6Cents * 2,
      quartersIncluded: 4,
    },
    unmatchedAdditionalMedicareCents: 0,
  });
}

const W3_ALL = buildW3([MICHAEL, PLAIN, VOIDED], 2026);
const W3_NO_VOIDS = buildW3([MICHAEL, PLAIN], 2026);

const NO_REFUSALS: readonly W2Refusal[] = [];

/* ═══════════════════════════════════════════════════════════════════════════
 * §0  THE FIXTURES ARE WHAT THIS FILE THINKS THEY ARE
 *
 * Rule 39: a test suite whose fixtures silently stopped representing the case
 * they were built for passes vacuously forever. Every claim the rest of the
 * file leans on is asserted here, once, at the top.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the fixtures represent the cases they are named for", () => {
  it("Michael's form really does have box 1 above boxes 3 and 5", () => {
    const box = (f: W2Form, b: string) => f.boxes.find((x) => x.box === b)?.amountCents ?? -1;
    expect(box(MICHAEL, "1")).toBeGreaterThan(box(MICHAEL, "3"));
    expect(box(MICHAEL, "1")).toBeGreaterThan(box(MICHAEL, "5"));
    expect(MICHAEL.box1MinusBox3Cents).toBe(1_800_000);
    expect(MICHAEL.box1ExceedsFicaExplanation).not.toBeNull();
  });

  it("the ordinary employee's boxes 1, 3 and 5 all agree - the negative control", () => {
    const box = (b: string) => PLAIN.boxes.find((x) => x.box === b)?.amountCents ?? -1;
    expect(box("1")).toBe(box("3"));
    expect(box("3")).toBe(box("5"));
    expect(PLAIN.box1MinusBox3Cents).toBe(0);
  });

  it("the voided form is excluded from the W-3, which is why the counts differ", () => {
    expect(VOIDED.isVoid).toBe(true);
    expect(W3_ALL.formCount).toBe(2);
    expect(W3_ALL.voidedCount).toBe(1);
    expect(W3_NO_VOIDS.voidedCount).toBe(0);
  });

  it("the agreeing and broken reconciliations really do differ in verdict", () => {
    expect(agreeingRecon(W3_ALL).allAgree).toBe(true);
    expect(brokenRecon(W3_ALL).allAgree).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE SHARED TONE VOCABULARY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the consolidated tone vocabulary", () => {
  /**
   * Every tone has a meaning. Walks `ALL_SCREEN_TONES` rather than a list typed
   * here, so a sixth tone cannot be added without this failing (rule 43).
   */
  it("every tone in the vocabulary has a real sentence explaining it", () => {
    expect(ALL_SCREEN_TONES.length).toBe(5);
    for (const t of ALL_SCREEN_TONES) {
      expect(toneMeaning(t).length, `${t} has no meaning`).toBeGreaterThan(30);
    }
  });

  /**
   * THE SENTENCE THAT MAKES GOLD USABLE. Gold and orange both mean "correct,
   * pay attention". If either sentence stops saying so, Michael will read warm
   * colours as errors and the whole four-colour scheme collapses into two.
   */
  it("gold and orange both say out loud that nothing is wrong", () => {
    expect(toneMeaning("gold").toLowerCase()).toContain("nothing is wrong");
    expect(toneMeaning("orange").toLowerCase()).toContain("not a mistake");
    // And red is the only one that claims something IS wrong.
    expect(toneMeaning("danger").toLowerCase()).toContain("actually wrong");
  });

  it("severity escalates, and neutral is outside the scale", () => {
    expect(toneSeverity("neutral")).toBe(0);
    expect(toneSeverity("green")).toBeLessThan(toneSeverity("gold"));
    expect(toneSeverity("gold")).toBeLessThan(toneSeverity("orange"));
    expect(toneSeverity("orange")).toBeLessThan(toneSeverity("danger"));
  });

  /**
   * ═══ AN EMPTY LIST IS NOT "ALL CLEAR". ═══
   *
   * This is rule 39 rendered in colour. `worstTone([])` returning green would
   * paint a screen that assessed nothing as though everything passed.
   */
  it("the worst of nothing is neutral, not green", () => {
    expect(worstTone([])).toBe("neutral");
    expect(worstTone(["green", "gold"])).toBe("gold");
    expect(worstTone(["green", "danger", "gold"])).toBe("danger");
  });

  /**
   * THE CONSOLIDATION ITSELF, ASSERTED. The four legacy names must remain
   * ASSIGNABLE to `ScreenTone` - that is what proves they are aliases rather
   * than four independent unions that merely happen to agree today.
   */
  it("the four legacy tone names are aliases of the one vocabulary", () => {
    const asScreen: ScreenTone = "gold";
    // If any of these were still an independent union, one of these lines
    // would be a compile error rather than a passing assignment.
    const fromPayRun: import("@/lib/payroll/pay-run-ui-core").PayRunTone = asScreen;
    const from941: import("@/lib/payroll/form-941-ui-core").Form941Tone = fromPayRun;
    const fromWa: import("@/lib/payroll/wa-quarterly-ui-core").WaQuarterTone = from941;
    const fromFs: import("@/lib/accounting/financial-statements-ui-core").FsTone = fromWa;
    expect(fromFs).toBe("gold");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  DEADLINES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the deadline arithmetic", () => {
  it("counts whole days in UTC, and refuses a date it cannot parse", () => {
    expect(w2DaysUntil("2027-01-25", DUE)).toBe(7);
    expect(w2DaysUntil(DUE, DUE)).toBe(0);
    expect(w2DaysUntil("2027-02-05", DUE)).toBe(-4);
    // Rule 27: refuse rather than default. A silently-wrong date on a deadline
    // screen is worse than a crash.
    expect(() => w2DaysUntil("25/01/2027", DUE)).toThrow(/not an ISO date/);
    expect(() => w2DaysUntil("2027-01-25", "next tuesday")).toThrow(/not an ISO date/);
  });

  /**
   * ═══ THE FIVE BANDS, INCLUDING THE ONE THIS SCREEN ADDED. ═══
   *
   * Driven through `w2DaysUntil` from real calendar dates rather than by
   * passing day counts directly, so the boundary arithmetic and the banding are
   * proved together. Every band is reached - rule 43.
   */
  it("bands every date, and October gets its own band", () => {
    const bandOn = (today: string): W2UrgencyBand =>
      w2UrgencyBand(w2DaysUntil(today, DUE));

    expect(bandOn("2027-02-02")).toBe("overdue");
    expect(bandOn("2027-01-28")).toBe("due-now");
    expect(bandOn("2027-01-25")).toBe("due-now"); // exactly 7 days
    expect(bandOn("2027-01-24")).toBe("due-soon"); // 8 days
    expect(bandOn("2027-01-02")).toBe("due-soon"); // exactly 30 days
    expect(bandOn("2027-01-01")).toBe("reconcile-season"); // 31 days
    expect(bandOn("2026-10-05")).toBe("reconcile-season");
    expect(bandOn("2026-09-30")).toBe("comfortable"); // beyond 120
  });

  it("every band has a tone and a sentence, and none is empty", () => {
    const bands: readonly W2UrgencyBand[] = [
      "overdue",
      "due-now",
      "due-soon",
      "reconcile-season",
      "comfortable",
    ];
    for (const b of bands) {
      expect(ALL_SCREEN_TONES).toContain(w2UrgencyTone(b));
      expect(w2UrgencyMeaning(b, 10, DUE).length, `${b} has no sentence`).toBeGreaterThan(60);
    }
  });

  /**
   * THE OVERDUE SENTENCE MUST NAME BOTH PENALTIES. An owner who has missed the
   * date has almost certainly missed both duties, and a screen that names only
   * IRC 6721 leaves him to discover 6722 from a notice.
   */
  it("the overdue sentence names both penalty sections and says 'per form'", () => {
    const s = w2UrgencyMeaning("overdue", -4, DUE);
    expect(s).toContain("6721");
    expect(s).toContain("6722");
    expect(s.toLowerCase()).toContain("per form");
  });

  /**
   * THE RECONCILE-SEASON SENTENCE IS THE POINT OF THE WHOLE SCREEN. It must
   * frame October as an opportunity, and it must name the three filings that a
   * January discovery costs - because that contrast is the entire argument for
   * doing the work early.
   */
  it("the reconcile-season sentence sells the cheap month", () => {
    const s = w2UrgencyMeaning("reconcile-season", 90, DUE);
    expect(s).toContain("941-X");
    expect(s).toContain("W-2c");
    expect(s).toContain("W-3c");
    expect(s.toLowerCase()).toContain("cheapest");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  STATUS AND THE ONE NEXT ACTION - the judgement calls
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the status of the year", () => {
  const forms = [MICHAEL, PLAIN];

  /** Every status is reachable from real input. Rule 43. */
  it("produces all five statuses from real input", () => {
    const seen = new Set<W2Status>();

    seen.add(w2StatusOf([], 0, null)); // no forms at all
    seen.add(w2StatusOf(forms, 2, null)); // refusals present
    seen.add(w2StatusOf(forms, 0, null)); // never reconciled
    seen.add(w2StatusOf(forms, 0, brokenRecon(W3_NO_VOIDS)));
    seen.add(w2StatusOf(forms, 0, agreeingRecon(W3_NO_VOIDS, 3)));
    seen.add(w2StatusOf(forms, 0, agreeingRecon(W3_NO_VOIDS, 4)));

    expect([...seen].sort()).toEqual(
      [
        "blocked",
        "not-reconciled",
        "reconciliation-broken",
        "reconciliation-incomplete",
        "ready",
      ].sort(),
    );
  });

  /**
   * ═══ REFUSALS OUTRANK A BROKEN RECONCILIATION. ═══
   *
   * A batch with a missing form has a W-3 that is wrong BY CONSTRUCTION, so
   * reconciling it would produce a confident answer about a total that was
   * never complete. Sending Michael to chase a variance caused by his own
   * missing form is sending him in a circle.
   */
  it("a missing form outranks a broken comparison", () => {
    expect(w2StatusOf(forms, 1, brokenRecon(W3_NO_VOIDS))).toBe("blocked");
  });

  /**
   * "NOT RUN" AND "RAN WITH THREE QUARTERS" ARE DIFFERENT FACTS.
   *
   * Collapsing them would let a batch reach February having never been compared
   * to anything, while the screen showed the same reassuring gold as a
   * deliberately partial October check.
   */
  it("never-reconciled is distinct from reconciled-with-three-quarters", () => {
    expect(w2StatusOf(forms, 0, null)).toBe("not-reconciled");
    expect(w2StatusOf(forms, 0, agreeingRecon(W3_NO_VOIDS, 3))).toBe(
      "reconciliation-incomplete",
    );
  });

  it("every status has a tone, a label and a real sentence", () => {
    const all: readonly W2Status[] = [
      "blocked",
      "reconciliation-broken",
      "reconciliation-incomplete",
      "not-reconciled",
      "ready",
    ];
    for (const s of all) {
      expect(ALL_SCREEN_TONES).toContain(w2StatusTone(s));
      expect(w2StatusLabel(s).length, `${s} label`).toBeGreaterThan(8);
      expect(w2StatusMeaning(s).length, `${s} meaning`).toBeGreaterThan(80);
    }
  });

  /**
   * ═══ THE GOLD STATES MUST OPEN BY SAYING THEY ARE CORRECT. ═══
   *
   * `reconciliation-incomplete` is the state Michael will be in every October,
   * which is exactly when he is doing the right thing. If that panel reads like
   * a problem, the screen punishes the behaviour it exists to encourage.
   */
  it("the incomplete-comparison state is framed as a good result", () => {
    const m = w2StatusMeaning("reconciliation-incomplete").toLowerCase();
    expect(m).toContain("agree");
    expect(m).toMatch(/good result|not a problem/);
    expect(w2StatusTone("reconciliation-incomplete")).toBe("gold");
    // And the label must not read as a failure.
    expect(w2StatusLabel("reconciliation-incomplete").toLowerCase()).not.toContain("error");
  });

  /** Only two states are red, and both genuinely block filing. */
  it("exactly two states are red", () => {
    const all: readonly W2Status[] = [
      "blocked",
      "reconciliation-broken",
      "reconciliation-incomplete",
      "not-reconciled",
      "ready",
    ];
    expect(all.filter((s) => w2StatusTone(s) === "danger").sort()).toEqual([
      "blocked",
      "reconciliation-broken",
    ]);
  });
});

describe("books-46: the one next action", () => {
  const forms = [MICHAEL, PLAIN];

  it("a refusal sends him to the missing item, using the mentor's fix", () => {
    const refusals: readonly W2Refusal[] = [
      { code: "W2_NAME_INCOMPLETE", message: "no name", remedy: "specific remedy" },
    ];
    const a = w2NextAction({ forms, refusals, recon: null, today: "2027-01-05", due: DUE });
    expect(a.tone).toBe("danger");
    expect(a.headline).toContain("One thing is missing");
    // The mentor's general fix is preferred over the engine's terse remedy,
    // because the card below already shows the specific one.
    const lesson = w2RefusalLessonFor("W2_NAME_INCOMPLETE");
    expect(a.detail).toBe(lesson?.howToFix);
  });

  it("pluralises the refusal headline rather than saying '1 things'", () => {
    const two: readonly W2Refusal[] = [
      { code: "W2_NAME_INCOMPLETE", message: "a", remedy: "a" },
      { code: "W2_SSN_NOT_NINE_DIGITS", message: "b", remedy: "b" },
    ];
    const a = w2NextAction({ forms, refusals: two, recon: null, today: "2027-01-05", due: DUE });
    expect(a.headline).toContain("2 things are missing");
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * THE MOST IMPORTANT TEST IN THIS FILE.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * A BROKEN RECONCILIATION OUTRANKS AN OVERDUE DEADLINE.
   *
   * An urgency-first screen - which is what almost every filing product ships -
   * would shout "OVERDUE, FILE NOW" here. Following that advice converts one
   * cheap problem into an expensive one: filing a wrong W-2 costs a W-2c, a
   * W-3c, a 941-X and a letter to answer, where filing a right one four days
   * late costs a bounded per-form penalty.
   *
   * So the action must still say DO NOT FILE, and it must acknowledge the
   * lateness rather than pretending the deadline does not exist - otherwise
   * Michael cannot tell whether the screen has noticed.
   */
  it("says do-not-file even when the deadline has already passed", () => {
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: brokenRecon(W3_NO_VOIDS),
      today: "2027-02-05", // four days LATE
      due: DUE,
    });
    expect(a.tone).toBe("danger");
    expect(a.headline.toLowerCase()).toContain("do not file");
    // It must NOT tell him to file.
    expect(a.headline.toLowerCase()).not.toMatch(/file (it|them|now|today)/);
    // And it must acknowledge the lateness so he knows the screen has noticed.
    expect(a.detail.toLowerCase()).toContain("already late");
    expect(a.detail).toContain("941-X");
  });

  /**
   * THE CONTROL FOR THE TEST ABOVE (rule 55). If the reconciliation AGREES, an
   * overdue deadline must produce the ordinary overdue action. Without this,
   * the assertion above is equally satisfied by a function that always says
   * "do not file", which would be useless in a different direction.
   */
  it("but an overdue batch that reconciles IS sent to be filed", () => {
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: agreeingRecon(W3_NO_VOIDS),
      today: "2027-02-05",
      due: DUE,
    });
    expect(a.tone).toBe("danger");
    expect(a.headline.toLowerCase()).toContain("overdue");
    expect(a.detail.toLowerCase()).toContain("today");
    expect(a.detail).toContain("6721");
    expect(a.detail).toContain("6722");
  });

  it("names the specific figures when the comparison breaks", () => {
    const recon = brokenRecon(W3_NO_VOIDS);
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon,
      today: "2026-10-05",
      due: DUE,
    });
    const broken = recon.lines.filter((l) => !l.agrees);
    expect(broken.length).toBeGreaterThan(0);
    // The label of the first disagreement must appear, so the reader knows
    // WHERE to start rather than being told "something is wrong".
    expect(a.detail).toContain(broken[0]!.label);
    expect(a.detail).toContain("$2,500.00");
  });

  it("an unreconciled batch is told to run the comparison, in gold", () => {
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: null,
      today: "2026-10-05",
      due: DUE,
    });
    expect(a.tone).toBe("gold");
    expect(a.ctaLabel.toLowerCase()).toContain("comparison");
    // The reason must be the one that matters: the engine cannot know whether
    // the figures it copied were right in the first place.
    expect(a.detail.toLowerCase()).toContain("internally correct");
  });

  it("a three-quarter comparison says how many are left and why now is right", () => {
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: agreeingRecon(W3_NO_VOIDS, 3),
      today: "2026-10-05",
      due: DUE,
    });
    expect(a.tone).toBe("gold");
    expect(a.headline).toContain("3 of 4");
    expect(a.detail).toContain("1 quarter");
    expect(a.detail.toLowerCase()).toContain("nothing is wrong");
  });

  it("a clean, complete year is the only case that reads as finished", () => {
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: agreeingRecon(W3_NO_VOIDS),
      today: "2027-01-10",
      due: DUE,
    });
    expect(a.headline).toContain("all four 941s");
    expect(a.tone).toBe("gold"); // due-soon
    expect(a.ctaLabel.toLowerCase()).toContain("file");
  });

  it("an empty year says so instead of showing a blank screen", () => {
    const a = w2NextAction({
      forms: [],
      refusals: NO_REFUSALS,
      recon: null,
      today: "2027-01-10",
      due: DUE,
    });
    expect(a.headline.toLowerCase()).toContain("no w-2s");
    /*
     * An empty screen must name the LIKELY CAUSE, not just the emptiness.
     * "There is nothing here" sends Michael looking for a bug; "the pay runs
     * have probably not been posted yet" sends him to the one screen that can
     * actually fix it.
     */
    expect(a.detail.toLowerCase()).toContain("posted");
  });

  /**
   * Singular/plural, because "The forms are overdue" on a one-employee shop
   * reads as a bug and makes Michael doubt every other number on the screen.
   *
   * This is a PAIR, not a single assertion (rule 55): a sentence that always
   * said "form is" would pass the singular half and fail the plural half, and
   * a sentence that always said "forms are" would do the reverse. Only correct
   * agreement passes both.
   */
  it("uses singular agreement for a one-employee shop", () => {
    const a = w2NextAction({
      forms: [MICHAEL],
      refusals: NO_REFUSALS,
      recon: agreeingRecon(buildW3([MICHAEL], 2026)),
      today: "2027-02-05",
      due: DUE,
    });
    expect(a.headline).toContain("form is overdue");
    expect(a.headline).not.toContain("forms are");
  });

  it("uses plural agreement once a second employee exists", () => {
    const forms = [MICHAEL, PLAIN];
    const a = w2NextAction({
      forms,
      refusals: NO_REFUSALS,
      recon: agreeingRecon(buildW3(forms, 2026)),
      today: "2027-02-05",
      due: DUE,
    });
    expect(a.headline).toContain("forms are overdue");
    expect(a.headline).not.toContain("form is");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE BUTTON
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the button never claims to file anything", () => {
  /**
   * ═══ THE BOUNDARY OF THIS ENTIRE PROJECT, ASSERTED. ═══
   *
   * We replace the data-preparation half of Aatrix. We are NOT a filing agent.
   * The honesty note must appear whether the button is enabled or not, because
   * the disabled case is exactly when somebody might assume the system would
   * have filed if only it could.
   */
  it("says it is not a filing agent in every state", () => {
    const states = [
      w2ButtonState(NO_REFUSALS, 2),
      w2ButtonState(NO_REFUSALS, 0),
      w2ButtonState([{ code: "W2_NAME_INCOMPLETE", message: "x", remedy: "y" }], 2),
    ];
    for (const s of states) {
      expect(s.honestyNote.toLowerCase()).toContain("does not transmit");
      expect(s.honestyNote.toLowerCase()).toContain("filing agent");
      expect(s.honestyNote.toLowerCase()).toContain("sign it yourself");
    }
  });

  it("never labels the button 'File'", () => {
    for (const n of [0, 1, 5]) {
      expect(w2ButtonState(NO_REFUSALS, n).label.toLowerCase()).not.toMatch(/^file\b/);
    }
  });

  it("is disabled by refusals and by an empty year, with a reason", () => {
    const blocked = w2ButtonState(
      [{ code: "W2_NAME_INCOMPLETE", message: "x", remedy: "y" }],
      2,
    );
    expect(blocked.enabled).toBe(false);
    expect(blocked.disabledReason).toContain("One item");

    const empty = w2ButtonState(NO_REFUSALS, 0);
    expect(empty.enabled).toBe(false);
    expect(empty.disabledReason).toContain("year-to-date");
  });

  /**
   * ═══ A BROKEN COMPARISON MUST NOT DISABLE THE BUTTON. ═══
   *
   * Tempting, and wrong. The forms are worth LOOKING AT precisely when the
   * totals disagree, because looking at them is how the cause gets found.
   * Blocking the view would leave Michael with a red banner and no way to
   * investigate it. The next action already tells him not to file.
   *
   * Proven by signature: the function cannot even see the reconciliation.
   */
  it("stays enabled when the comparison is broken, so he can investigate", () => {
    expect(w2ButtonState(NO_REFUSALS, 2).enabled).toBe(true);
    expect(w2ButtonState.length).toBe(2);
  });

  it("counts the forms in the label, singular and plural", () => {
    expect(w2ButtonState(NO_REFUSALS, 1).label).toBe("Show the form");
    expect(w2ButtonState(NO_REFUSALS, 4).label).toBe("Show all 4 forms");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE TWO TRAPS - the tests that stop a correct form being "fixed"
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: trap 1 - box 1 above boxes 3 and 5 is CORRECT", () => {
  /**
   * ═══ GREEN. NOT GOLD, AND CERTAINLY NOT RED. ═══
   *
   * This is the single most consequential colour choice on the screen. Michael
   * is a visual learner; if this panel is warm-coloured he will read it as a
   * problem, and every available "fix" is wrong.
   */
  it("is presented as correct, in green, with the authority attached", () => {
    const note = w2BoxDifferenceNote(MICHAEL);
    expect(note).not.toBeNull();
    expect(note!.tone).toBe("green");
    expect(note!.headline.toLowerCase()).toContain("that is correct");
    expect(note!.authorityId).toBe("iw2w3-2026-box-3-scorp-health-carve-out");
    expect(note!.headline).toContain("$18,000.00");
  });

  /**
   * ═══ THE PANEL MUST NEVER ADVISE MAKING THE BOXES AGREE. ═══
   *
   * The failure this guards against is a well-meaning edit, six months from
   * now, by somebody who thinks the form does not foot. Phrased as a search for
   * the ADVICE rather than for a keyword, because "match" appears legitimately
   * in the sentence explaining what NOT to do.
   */
  it("never advises making the boxes match", () => {
    const note = w2BoxDifferenceNote(MICHAEL)!;
    const text = `${note.headline} ${note.body}`.toLowerCase();
    expect(text).not.toMatch(/(should|must|need to|try to) (make|force)[^.]*(match|agree)/);
    expect(text).toMatch(/do not (make|force)/);
    // And it must give the REASON the difference is legitimate, not just say so.
    expect(text).toMatch(/overpay|understate/);
  });

  /**
   * THE 1040 CONSEQUENCE. The deduction on his personal return is only
   * available BECAUSE the premium went on the W-2 first. Without that sentence
   * the panel explains a curiosity; with it, it explains money.
   */
  it("explains that the personal deduction depends on this appearing here", () => {
    const note = w2BoxDifferenceNote(MICHAEL)!;
    expect(note.body.toLowerCase()).toContain("personal return");
  });

  /**
   * ═══ THE NEGATIVE CONTROL, AND WHY NULL RATHER THAN A REASSURANCE. ═══
   *
   * Showing "these boxes agree, which is correct" on every ordinary employee's
   * form would teach Michael to skim past the panel - and then it would be
   * invisible on the one form where it matters. Silence on the ordinary case is
   * what keeps the panel loud on his own.
   */
  it("says nothing at all on an ordinary employee's form", () => {
    expect(w2BoxDifferenceNote(PLAIN)).toBeNull();
  });
});

describe("books-46: trap 2 - box 17 must be blank in Washington", () => {
  it("renders a correctly-zero box 17 as neutral with a reason, never as an error", () => {
    const row = w2BoxRows(PLAIN).find((r) => r.box === "17");
    expect(row).toBeDefined();
    expect(row!.tone).toBe("neutral");
    expect(row!.blankOnPurpose).not.toBeNull();
    expect(row!.blankOnPurpose!.toLowerCase()).toContain("no personal income tax");
    // The destination must be named. "Not here" without "box 14" is half an
    // instruction, and the half that is missing is the actionable half.
    expect(row!.blankOnPurpose).toContain("box 14");
  });

  /**
   * THE OTHER DIRECTION. A box 17 that is NOT zero is a real error - PFML or WA
   * Cares has been put in the wrong box - and it must be red. Without this, the
   * test above is satisfied by a function that paints box 17 neutral always.
   */
  it("but a non-zero box 17 is red on the W-3", () => {
    const clean = w3Rows(W3_NO_VOIDS).find((r) => r.box === "17")!;
    expect(clean.tone).toBe("neutral");
    expect(clean.note.toLowerCase()).toContain("must be");

    const dirty = w3Rows({ ...W3_NO_VOIDS, box17Cents: 12_345 }).find((r) => r.box === "17")!;
    expect(dirty.tone).toBe("danger");
    expect(dirty.note).toContain("MUST BE ZERO");
    expect(dirty.note).toContain("box 14");
  });

  it("emphasises boxes 1, 3 and 5 - the three the W-3 totals", () => {
    const rows = w2BoxRows(MICHAEL);
    expect(rows.filter((r) => r.emphasise).map((r) => r.box).sort()).toEqual(["1", "3", "5"]);
  });

  it("every box row carries the engine's derivation, so nothing is unexplained", () => {
    for (const r of w2BoxRows(MICHAEL)) {
      expect(r.derivation.length, `box ${r.box} has no derivation`).toBeGreaterThan(10);
      expect(r.display).toMatch(/^\$[\d,]+\.\d{2}$/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE W-3, ITS ONE NON-TOTAL BOX, AND THE VOIDS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the W-3", () => {
  /**
   * ═══ BOX 12a IS THE ONLY BOX ON THE W-3 THAT IS NOT A TOTAL. ═══
   *
   * Only deferral codes carry up; DD and C are dropped. Summing all of box 12
   * into 12a is the easiest W-3 error a generator can make. The note must say
   * so in capitals, and the box must be gold - the "read this twice" colour -
   * rather than neutral.
   */
  it("marks box 12a as the one box that is not a total", () => {
    const row = w3Rows(W3_NO_VOIDS).find((r) => r.box === "12a");
    expect(row).toBeDefined();
    expect(row!.tone).toBe("gold");
    expect(row!.note).toContain("NOT A TOTAL");
    expect(row!.note).toContain("DD");
  });

  /**
   * THE FILTER MUST BE SHOWN DOING SOMETHING. A check whose effect nobody can
   * see is a check nobody trusts. When an excluded code is present, the note
   * must state the exact amount a naive total would have overstated by.
   */
  it("shows what the box 12a filter actually excluded", () => {
    const withExclusion = w3Rows({ ...W3_NO_VOIDS, box12ExcludedFromW3Cents: 550_000 }).find(
      (r) => r.box === "12a",
    )!;
    expect(withExclusion.note).toContain("$5,500.00");
    expect(withExclusion.note.toLowerCase()).toContain("overstated");

    // And when nothing was excluded it says THAT, rather than implying a filter
    // ran on nothing.
    const none = w3Rows({ ...W3_NO_VOIDS, box12ExcludedFromW3Cents: 0 }).find(
      (r) => r.box === "12a",
    )!;
    expect(none.note.toLowerCase()).toContain("nothing was excluded");
  });

  it("explains that box 4 is the employee half only", () => {
    const row = w3Rows(W3_NO_VOIDS).find((r) => r.box === "4")!;
    expect(row.note.toLowerCase()).toContain("employee half only");
    expect(row.note.toLowerCase()).toContain("double");
  });

  it("explains why the 941 is only APPROXIMATELY double box 6", () => {
    const row = w3Rows(W3_NO_VOIDS).find((r) => r.box === "6")!;
    expect(row.note).toContain("0.9%");
    expect(row.note.toLowerCase()).toContain("no employer match");
  });

  /**
   * ═══ THE VOID GAP MUST BE EXPLAINED, NOT LEFT TO BE "FIXED". ═══
   *
   * A voided form still exists as a row but must not reach the totals. That
   * correct behaviour produces a display that looks broken: three forms on
   * screen, a W-3 that counts two. If the screen does not explain the gap,
   * somebody eventually "fixes" it by including the voids, which overstates
   * every total on the form.
   */
  it("explains the gap between the form count and the W-3 count", () => {
    const note = voidNote(W3_ALL);
    expect(note).not.toBeNull();
    expect(note!.tone).toBe("gold");
    expect(note!.body).toContain("2 forms rather than 3");
    expect(note!.body.toLowerCase()).toContain("not a correction");
    expect(note!.body.toLowerCase()).toContain('do not "fix"');
  });

  /**
   * NULL WHEN THERE ARE NO VOIDS. A panel that says "0 voided" every year is
   * noise, and noise trains the eye to skip the area where the real message
   * will eventually appear.
   */
  it("says nothing when there are no voids", () => {
    expect(voidNote(W3_NO_VOIDS)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  THE COMPARISON ROWS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the reconciliation panel", () => {
  it("is gold when never run - an opinion, not a shrug", () => {
    // Neutral would say "no opinion". This screen HAS an opinion about an
    // unchecked year: it is the one thing worth doing before filing.
    expect(reconciliationTone(null)).toBe("gold");
    expect(reconciliationTone(brokenRecon(W3_NO_VOIDS))).toBe("danger");
    expect(reconciliationTone(agreeingRecon(W3_NO_VOIDS, 3))).toBe("gold");
    expect(reconciliationTone(agreeingRecon(W3_NO_VOIDS, 4))).toBe("green");
  });

  /**
   * THE DIFFERENCE COLUMN IS ALWAYS PRESENT AND ALWAYS SIGNED.
   *
   * A column that appears only on failure trains the reader to look for its
   * presence instead of reading it. An unsigned difference hides the most
   * diagnostic fact available: WHICH SIDE is short.
   */
  it("always shows a signed difference, including zero", () => {
    for (const r of reconRows(agreeingRecon(W3_NO_VOIDS))) {
      expect(r.differenceDisplay).toBe("$0.00");
      expect(r.tone).toBe("green");
      expect(r.agrees).toBe(true);
    }

    const broken = reconRows(brokenRecon(W3_NO_VOIDS));
    const bad = broken.filter((r) => !r.agrees);
    expect(bad.length).toBeGreaterThan(0);
    for (const r of bad) {
      expect(r.tone).toBe("danger");
      expect(r.differenceDisplay).toMatch(/^[+-]\$/);
    }
  });

  it("carries the engine's explanation on every line", () => {
    for (const r of reconRows(agreeingRecon(W3_NO_VOIDS))) {
      expect(r.plain.length, `${r.label} has no explanation`).toBeGreaterThan(40);
      expect(r.w3Display).toMatch(/^\$/);
      expect(r.form941Display).toMatch(/^\$/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §8  REFUSALS, CHECKS, EXAMPLES, EMPTY STATE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-46: the screen can teach every refusal it can show", () => {
  /**
   * RULE 43, IN THE FORM THAT ACTUALLY CATCHES THINGS. The list comes from the
   * ENGINE's exported array, never from a list typed in this test, so a new
   * code with no lesson fails here on the day it is added.
   */
  it("every engine refusal code has a lesson", () => {
    const cov = w2RefusalCoverage();
    expect(cov.length).toBe(ALL_W2_REFUSAL_CODES.length);
    expect(cov.length).toBeGreaterThan(0);
    const untaught = cov.filter((c) => !c.taught).map((c) => c.code);
    expect(untaught, `these codes can be shown but not explained: ${untaught.join(", ")}`).toEqual(
      [],
    );
  });

  it("builds a card that carries both the specific fact and the general lesson", () => {
    const refusal: W2Refusal = {
      code: "W2_BOX_17_MUST_BE_BLANK_IN_WA",
      message: "Jane Doe has $123.45 in box 17.",
      remedy: "Move it to box 14.",
    };
    const card = w2RefusalCard(refusal);
    const lesson = w2RefusalLessonFor("W2_BOX_17_MUST_BE_BLANK_IN_WA")!;

    // The engine's sentence, because it names the person and the figure.
    expect(card.whatHappened).toBe(refusal.message);
    expect(card.howToFix).toBe(refusal.remedy);
    // The mentor's teaching, because it explains the class of problem.
    expect(card.headline).toBe(lesson.headline);
    expect(card.whyWeRefuse).toBe(lesson.whyWeRefuse);
    expect(card.tone).toBe("danger");
  });

  /**
   * THE DEGRADED PATH IS REACHABLE AND HONEST. If a code ever ships without a
   * lesson, the card must still render AND must say the gap is itself a defect
   * rather than quietly showing an empty panel.
   */
  it("degrades honestly when a lesson is missing", () => {
    const card = w2RefusalCard({
      code: "W2_NOT_A_REAL_CODE" as W2Refusal["code"],
      message: "something",
      remedy: "do something",
    });
    expect(card.whyWeRefuse.toLowerCase()).toContain("defect");
    expect(card.headline).toBe("something");
  });

  it("groups repeated codes so five people missing one field are one card", () => {
    const grouped = groupW2Refusals([
      { code: "W2_NAME_INCOMPLETE", message: "a", remedy: "x" },
      { code: "W2_SSN_NOT_NINE_DIGITS", message: "b", remedy: "y" },
      { code: "W2_NAME_INCOMPLETE", message: "c", remedy: "z" },
    ]);
    expect(grouped.length).toBe(2);
    // First-seen order is preserved, so the list does not reshuffle between
    // renders for no visible reason.
    expect(grouped[0]!.code).toBe("W2_NAME_INCOMPLETE");
    expect(grouped[0]!.items.length).toBe(2);
    expect(groupW2Refusals([]).length).toBe(0);
  });
});

describe("books-46: the checklist and the worked examples reach the screen", () => {
  /**
   * ═══ THE ORDER IS THE TEACHING, SO THE SCREEN MUST NOT RE-SORT IT. ═══
   *
   * Item 1 is first because it is the only item whose cost depends on the DATE
   * you do it. A screen that sorted the list alphabetically, or by anything
   * else, would silently destroy that argument while still showing all eight
   * items.
   */
  it("passes the checklist through in the mentor's order, unchanged", () => {
    const rows = w2CheckRows();
    const source = w2ChecksInOrder();
    expect(rows.length).toBe(source.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.key)).toEqual(source.map((c) => c.key));
    // And the order field really is ascending, so "in order" is not a claim
    // resting on insertion order alone.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.order).toBeGreaterThan(rows[i - 1]!.order);
    }
  });

  it("the first check is the one whose cost depends on the date", () => {
    const first = w2CheckRows()[0]!;
    expect(first.key).toBe("reconcile-in-october");
    expect(first.whyThisOrder.toLowerCase()).toContain("date");
  });

  it("every check row carries all four fields with real content", () => {
    for (const r of w2CheckRows()) {
      expect(r.question.length, `${r.key}: question`).toBeGreaterThan(20);
      expect(r.whyThisOrder.length, `${r.key}: whyThisOrder`).toBeGreaterThan(20);
      expect(r.howToCheck.length, `${r.key}: howToCheck`).toBeGreaterThan(20);
      expect(r.ifItFails.length, `${r.key}: ifItFails`).toBeGreaterThan(20);
    }
  });

  /**
   * MICHAEL IS A VISUAL LEARNER AND SAID THE VERBATIM PANELS ARE "hard to
   * digest as there is a wall of words and color". A worked example is the
   * antidote - the same information as the statute, arranged so the eye can
   * follow it - but only if it actually has STEPS. An example with one step is
   * a paragraph wearing a list's clothing.
   */
  it("every worked example has multiple steps and a stated lesson", () => {
    const rows = w2ExampleRows();
    expect(rows.length).toBe(FORM_W2_WORKED_EXAMPLES.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const e of rows) {
      expect(e.steps.length, `${e.key} is not worked - it has ${e.steps.length} step(s)`)
        .toBeGreaterThan(1);
      for (const s of e.steps) expect(s.trim().length).toBeGreaterThan(0);
      expect(e.theLesson.length, `${e.key}: theLesson`).toBeGreaterThan(30);
      expect(e.setup.length, `${e.key}: setup`).toBeGreaterThan(20);
    }
  });

  /** The two examples that carry Michael's own traps must survive. */
  it("keeps the examples that teach Michael's own two traps", () => {
    const keys = w2ExampleRows().map((e) => e.key);
    expect(keys).toContain("michael-premium");
    expect(keys).toContain("approximately-twice");
  });
});

describe("books-46: the empty state explains itself", () => {
  /**
   * A blank screen is a bug report waiting to happen: the reader cannot tell
   * whether there is nothing to show or whether something failed. The body must
   * name the likely cause - a draft pay run contributes nothing to anybody's
   * year-to-date figures, which is exactly what this screen reads.
   */
  it("names the year and the most likely cause", () => {
    const s = w2EmptyStateFor(2026);
    expect(s.title).toContain("2026");
    expect(s.body.toLowerCase()).toContain("draft");
    expect(s.body.toLowerCase()).toContain("year-to-date");
    expect(s.body.length).toBeGreaterThan(150);
  });
});
