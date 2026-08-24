/**
 * src/lib/accounting/shareholder-roster-core.ts   (books-50)
 *
 * THE ONE PLACE THAT KNOWS WHO OWNS GREENWAY.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * Before this slice, eleven source files and six documents each carried their
 * own hand-typed copy of Greenway's shareholder roster, and they did not agree.
 * Most of them said THREE shareholders with Michael's mother at 10%. The filed   [SUPERSEDED-ROSTER]
 * Form 1120-S says FOUR shareholders at 85/5/5/5.
 *
 * That is not a cosmetic drift. Those strings are the `whatToDo` text shown
 * when the roster is missing or does not total 100 per cent - which is to say,
 * they are displayed at exactly the moment the operator is looking for the
 * right answer. We were handing him the wrong one.
 *
 * Worse, one of them was attached to money. `tax-penalty-core.ts` told him the
 * IRC 6699 late-filing exposure was "about $7,000 ... with Greenway's three   [SUPERSEDED-ROSTER]
 * shareholders". The statute multiplies by the number of shareholders, so the
 * true figure at the un-inflated statutory base is $9,360, not $7,020 - an   [SUPERSEDED-ROSTER]
 * understatement of $2,340. And `interest-core.ts` instructed him to ENTER
 * three into the calculator, which would have reproduced the error himself.
 *
 * Standing rule 23 says fix the class, not the instance. So: one exported
 * roster, one formatter, and a gate (in the test file) that fails the build if
 * any file in the tree ever again states a Greenway roster that disagrees with
 * this one.
 *
 * ---------------------------------------------------------------------------
 * THE TWO LEVELS, AND WHY COLLAPSING THEM CAUSED THE BUG
 * ---------------------------------------------------------------------------
 *
 * There are two true descriptions of who owns this company, and the original
 * error was using the second where the first was required.
 *
 *   LEGAL / AS FILED - four separate shareholders, 85 / 5 / 5 / 5.
 *     This is what appears on the four Schedule K-1s, and it is what IRC 6699
 *     counts when it multiplies a penalty "by ... the number of persons who
 *     were shareholders". Anything touching a return or a penalty uses this.
 *
 *   ECONOMIC / FAMILY UNIT - Michael 85, grandfather 5, and the Becker
 *     household 10 taken together. Washington is a community-property state,
 *     so Theresa's interest and James's interest are one marital economic
 *     unit. This is the honest explanation of why distributions to the Beckers
 *     move together while the grandfather's do not.
 *
 * Standing rule 7 said "mom 10%" because the ECONOMIC reading is genuinely   [SUPERSEDED-ROSTER]
 * true. It was not invented. The defect was that the economic figure was used
 * in places that needed the legal one - including a shareholder COUNT, where
 * the difference is a real dollar amount.
 *
 * Both readings are therefore exported. A caller must choose, by name, which
 * one it means. There is deliberately no default (standing rule 62d).
 *
 * ---------------------------------------------------------------------------
 * MICHAEL'S OWN WORDS, AND WHY THE ROSTER STILL SHOWS ONE NAME AT 85
 * ---------------------------------------------------------------------------
 *
 * Michael describes his own holding as "my wife and I: 85%". The filed K-1
 * shows a single holder, "Michael B Lyman", at 85 per cent; his wife Alyssa
 * does not appear on the return at all. Both statements are true for the same
 * community-property reason as the Beckers.
 *
 * IRC 1361(c)(1)(A)(i) does treat "a husband and wife (and their estates)" as
 * one shareholder - but read the opening words: "For purposes of subsection
 * (b)(1)(A)". That is the 100-shareholder eligibility ceiling and nothing
 * else. It does NOT collapse a couple into one person for IRC 6699 counting,
 * and it does not license adding a fifth name to the roster. The filed return
 * settles the point directly: box I of the 2024 Form 1120-S, "Enter the number
 * of shareholders who were shareholders during any part of the tax year",
 * reads 4.
 *
 * So the roster carries four entries, Michael's marked as a community-property
 * household. The fact is recorded; nothing is computed from it.
 *
 * ---------------------------------------------------------------------------
 * EVIDENCE (standing rule 1 - read the source, print the value)
 * ---------------------------------------------------------------------------
 *
 * Verified three independent ways against the filed returns, not against any
 * prior document in this repository (standing rule 73 - comparing two
 * documents is blind to both being wrong):
 *
 *   1. 2024 Form 1120-S, box I: "Enter the number of shareholders who were
 *      shareholders during any part of the tax year" = 4. This is the IRC 6699
 *      counting question itself, answered on the return by the preparer.
 *
 *   2. 2024 and 2025 Form 1120-S, four Schedule K-1s each, field G "Current
 *      year allocation percentage": 85.000000, 5.000000, 5.000000, 5.000000.
 *
 *   3. Arithmetic on the filed 2024 K-1 box 1 dollars, which is independent of
 *      the stated percentages: Michael $630,215 and $37,072 to each of the
 *      other three. Total $741,431. That is 84.9998 per cent and 5.0001 per
 *      cent - 85/5/5/5 to four decimal places.
 *
 * A NOTE ON AN ACCUSATION I MADE AND THEN HAD TO WITHDRAW, KEPT ON PURPOSE.
 * While building this file I concluded that
 * `docs/MICHAEL-books-48-what-your-documents-unlock.md` had the right answer
 * for the wrong reasons. It cites "box 1 of $34,151 x 2 = $68,302, against an
 * exact 10% share of $68,302.90". I could not find $34,151 as a box 1 on the
 * 2024 return, whose total is $741,431, and $68,302.90 implies a total of
 * $683,029 - so I wrote the doc up as arithmetically wrong.
 *
 * I was the one who was wrong. $683,029 is the 2025 company total (2025 Form
 * 1120-S, line 22), and $34,151 is each 5 per cent holder's 2025 box 1, which
 * appears three times on that return. books-48 was reasoning about 2025 while
 * I was checking it against 2024. Its arithmetic ties exactly.
 *
 * Recorded because the near miss is the lesson, and it is the same lesson as
 * the roster bug itself: a figure that "does not tie" may be tying to a
 * different period. Check WHICH YEAR before calling a number wrong. Two
 * documents agreeing proves little (standing rule 73), and so does one
 * document disagreeing with a year I chose myself.
 *
 * ---------------------------------------------------------------------------
 * UNITS (standing rule 4)
 * ---------------------------------------------------------------------------
 *
 * Ownership is INTEGER MILLI-PERCENT. 85% is 85_000. Four shareholders sum to
 * exactly 100_000 with no floating point anywhere. There is no rounding step
 * in this file at all, which is the point: 85 + 5 + 5 + 5 is exact in integers
 * and is not exact in IEEE 754 doubles.
 */

/** Total ownership, in integer milli-percent. 100% = 100_000. */
export const OWNERSHIP_TOTAL_MILLI_PCT = 100_000;

/**
 * How a shareholder's interest is held.
 *
 * `community_property_household` records that Washington community-property
 * law gives a spouse an interest in what the named holder owns. It changes
 * NOTHING about the arithmetic - the interest is one K-1 and one roster entry.
 * It exists so the software can say the true thing out loud instead of
 * flattening it, and so nobody later "fixes" the roster by adding a spouse as
 * a fifth shareholder.
 */
export type HoldingForm = "individual" | "community_property_household";

export type Shareholder = {
  /** Exactly as spelled on the filed Schedule K-1. */
  readonly name: string;
  /** Relationship to Michael, in the words he uses. */
  readonly relationship: string;
  /** Integer milli-percent. 5% is 5_000. */
  readonly ownershipMilliPct: number;
  readonly holdingForm: HoldingForm;
  /**
   * Set when community-property law gives someone an interest in this entry
   * who is NOT separately named on the return. Recorded, never computed from.
   */
  readonly communityPropertySpouse: string | null;
};

/**
 * THE FILED ROSTER. Four shareholders, as reported on the Form 1120-S.
 *
 * Use this for anything that touches a return, a K-1, basis, the AAA, or a
 * penalty that counts shareholders. Order matches the K-1 sequence on the
 * filed return (Shareholder: 1 through 4).
 */
export const GREENWAY_SHAREHOLDERS: readonly Shareholder[] = [
  {
    name: "Michael B Lyman",
    relationship: "owner",
    ownershipMilliPct: 85_000,
    holdingForm: "community_property_household",
    communityPropertySpouse: "Alyssa Lyman",
  },
  {
    name: "Nicholas C Mullan",
    relationship: "grandfather",
    ownershipMilliPct: 5_000,
    holdingForm: "individual",
    communityPropertySpouse: null,
  },
  {
    name: "James H Becker",
    relationship: "step-father",
    ownershipMilliPct: 5_000,
    holdingForm: "community_property_household",
    communityPropertySpouse: "Theresa L Becker",
  },
  {
    name: "Theresa L Becker",
    relationship: "mother",
    ownershipMilliPct: 5_000,
    holdingForm: "community_property_household",
    communityPropertySpouse: "James H Becker",
  },
] as const;

/**
 * The number IRC 6699 multiplies by.
 *
 * IRC 6699(b): "the product of - (1) $195, multiplied by (2) the number of
 * persons who were shareholders in the S corporation during any part of the
 * taxable year." FOUR, not three. Confirmed against box I of the filed 2024
 * return, which reads 4.
 */
export const GREENWAY_SHAREHOLDER_COUNT = GREENWAY_SHAREHOLDERS.length;

/**
 * The economic family units, for explaining distribution behaviour only.
 *
 * NEVER use this to count shareholders and never put it on a return. The
 * Becker household appears here as a single 10 per cent unit because that is
 * why their distributions move together - and because it is the reading that
 * standing rule 7 was reaching for when it said "mom 10%".   [SUPERSEDED-ROSTER]
 */
export type FamilyUnit = {
  readonly label: string;
  readonly memberNames: readonly string[];
  readonly ownershipMilliPct: number;
};

export const GREENWAY_FAMILY_UNITS: readonly FamilyUnit[] = [
  { label: "Michael's household", memberNames: ["Michael B Lyman"], ownershipMilliPct: 85_000 },
  { label: "Nicholas C Mullan", memberNames: ["Nicholas C Mullan"], ownershipMilliPct: 5_000 },
  {
    label: "The Becker household",
    memberNames: ["James H Becker", "Theresa L Becker"],
    ownershipMilliPct: 10_000,
  },
] as const;

/** Format integer milli-percent for prose: 85_000 -> "85%", 2_375 -> "2.375%". */
export function formatOwnershipMilliPct(milliPct: number): string {
  if (!Number.isInteger(milliPct)) {
    throw new Error(
      `formatOwnershipMilliPct: ownership must be integer milli-percent, got ${String(milliPct)}. ` +
        "85% is 85000. A fractional milli-percent means somebody divided in floating point.",
    );
  }
  if (milliPct < 0) {
    throw new Error(`formatOwnershipMilliPct: ownership cannot be negative, got ${String(milliPct)}.`);
  }
  const whole = Math.trunc(milliPct / 1000);
  const frac = milliPct % 1000;
  if (frac === 0) return `${String(whole)}%`;
  return `${String(whole)}.${String(frac).padStart(3, "0").replace(/0+$/, "")}%`;
}

/**
 * Sum the roster in integers and prove it lands on exactly 100%.
 *
 * Throws rather than returning a boolean (standing rule 48): a roster that
 * does not total 100 per cent allocates income wrongly for every shareholder,
 * so there is no sensible way for a caller to carry on.
 */
export function assertRosterTotalsOneHundred(roster: readonly Shareholder[]): number {
  if (roster.length === 0) {
    throw new Error(
      "assertRosterTotalsOneHundred: the roster is empty. An S corporation has at least one " +
        "shareholder by definition.",
    );
  }
  let total = 0;
  for (const s of roster) {
    if (!Number.isInteger(s.ownershipMilliPct)) {
      throw new Error(
        `assertRosterTotalsOneHundred: ${s.name} has non-integer ownership ` +
          `${String(s.ownershipMilliPct)}. Ownership is integer milli-percent.`,
      );
    }
    if (s.ownershipMilliPct <= 0) {
      throw new Error(
        `assertRosterTotalsOneHundred: ${s.name} owns ${String(s.ownershipMilliPct)}. A ` +
          "shareholder owning nothing is not a shareholder.",
      );
    }
    total += s.ownershipMilliPct;
  }
  if (total !== OWNERSHIP_TOTAL_MILLI_PCT) {
    throw new Error(
      `assertRosterTotalsOneHundred: roster totals ${String(total)} milli-percent, not ` +
        `${String(OWNERSHIP_TOTAL_MILLI_PCT)}. Off by ` +
        `${String(Math.abs(OWNERSHIP_TOTAL_MILLI_PCT - total))}.`,
    );
  }
  return total;
}

/**
 * The canonical one-line roster sentence, generated rather than typed.
 *
 * Every `whatToDo` string that used to hand-type the roster now calls this, so
 * there is exactly one place for it to be wrong and one place to fix it.
 *
 * -> "Michael B Lyman at 85%, Nicholas C Mullan at 5%, James H Becker at 5%,
 *     and Theresa L Becker at 5%"
 */
export function describeRoster(roster: readonly Shareholder[] = GREENWAY_SHAREHOLDERS): string {
  assertRosterTotalsOneHundred(roster);
  const parts = roster.map((s) => `${s.name} at ${formatOwnershipMilliPct(s.ownershipMilliPct)}`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * The roster as a milli-percent sum, for the "must total 100" refusal text.
 *
 * -> "85000 + 5000 + 5000 + 5000"
 */
export function describeRosterMilliPctSum(
  roster: readonly Shareholder[] = GREENWAY_SHAREHOLDERS,
): string {
  assertRosterTotalsOneHundred(roster);
  return roster.map((s) => String(s.ownershipMilliPct)).join(" + ");
}

/**
 * Refuse any roster that is not the one on the filed return.
 *
 * WHY THIS EXISTS, AND WHY THE SUM CHECK IS NOT ENOUGH.
 * The pre-books-50 error was Michael 85, mother 10, grandfather 5. Add it up:
 * 85_000 + 10_000 + 5_000 = 100_000. It totals exactly one hundred per cent.   [SUPERSEDED-ROSTER]
 * `assertRosterTotalsOneHundred` accepts it without complaint, and did so for
 * forty-nine slices. That is precisely how a wrong roster survives in a
 * codebase that checks its arithmetic: the arithmetic was never the problem.
 * A wrong roster is not an unbalanced roster - it is a balanced roster
 * describing the wrong people.
 *
 * So this compares IDENTITY, not just the total: four names, each at the
 * milli-percent shown on its Schedule K-1. Order is not significant, because
 * the K-1 sequence is a filing artefact and not a fact about ownership.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertIsFiledGreenwayRoster(roster: readonly Shareholder[]): void {
  assertRosterTotalsOneHundred(roster);

  if (roster.length !== GREENWAY_SHAREHOLDERS.length) {
    throw new Error(
      `assertIsFiledGreenwayRoster: got ${String(roster.length)} shareholders, but the filed ` +
        `Form 1120-S carries ${String(GREENWAY_SHAREHOLDERS.length)} Schedule K-1s and box I ` +
        `reads ${String(GREENWAY_SHAREHOLDERS.length)}. The roster is ${describeRoster()}. ` +
        // SUPERSEDED-ROSTER: the superseded roster is named deliberately below.
        "Note that a wrong roster can still total 100%: the superseded 85/10/5 reading did.", // [SUPERSEDED-ROSTER]
    );
  }

  const expected = new Map(GREENWAY_SHAREHOLDERS.map((s) => [s.name, s.ownershipMilliPct]));
  const seen = new Set<string>();
  for (const s of roster) {
    const want = expected.get(s.name);
    if (want === undefined) {
      throw new Error(
        `assertIsFiledGreenwayRoster: "${s.name}" is not a Greenway shareholder. The filed ` +
          `roster is ${describeRoster()}. A spouse holding a community-property interest is ` +
          "NOT a separate shareholder - IRC 1361(c)(1)(A)(i) is scoped to subsection (b)(1)(A), " +
          "the 100-shareholder ceiling, and nothing else.",
      );
    }
    if (seen.has(s.name)) {
      throw new Error(`assertIsFiledGreenwayRoster: "${s.name}" appears twice in the roster.`);
    }
    seen.add(s.name);
    if (s.ownershipMilliPct !== want) {
      throw new Error(
        `assertIsFiledGreenwayRoster: ${s.name} is shown at ` +
          `${formatOwnershipMilliPct(s.ownershipMilliPct)} but the filed Schedule K-1 field G ` +
          `"Current year allocation percentage" reads ${formatOwnershipMilliPct(want)}.`,
      );
    }
  }
}

/** The economic reading, spelled out. Never for counting shareholders. */
export function describeFamilyUnits(
  units: readonly FamilyUnit[] = GREENWAY_FAMILY_UNITS,
): string {
  return units
    .map((u) => `${u.label} ${formatOwnershipMilliPct(u.ownershipMilliPct)}`)
    .join(", ");
}

/**
 * Pure self-test (standing rule 5). Registered in the pure-selftest runner.
 *
 * Every expected value here is hand-computed from the filed return and written
 * as a literal. Nothing is derived from the functions under test and nothing
 * is derived from a constant this module exports (standing rule 22c).
 */
export function __runShareholderRosterCoreTests(): void {
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`shareholder-roster-core self-test FAILED: ${msg}`);
  };
  const throws = (fn: () => unknown, needle: string, msg: string): void => {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
      const text = e instanceof Error ? e.message : String(e);
      if (!text.includes(needle)) {
        throw new Error(`${msg}: threw, but message lacked "${needle}". Got: ${text}`);
      }
    }
    if (!threw) throw new Error(`${msg}: expected a throw, got none.`);
  };

  // ---- the roster itself, against the filed return -----------------------
  ok(GREENWAY_SHAREHOLDERS.length === 4, "the filed 1120-S carries FOUR K-1s");
  ok(GREENWAY_SHAREHOLDER_COUNT === 4, "box I of the filed 2024 return reads 4");

  // Hand-typed from the return, not read back out of the array.
  ok(GREENWAY_SHAREHOLDERS[0].name === "Michael B Lyman", "K-1 1 name");
  ok(GREENWAY_SHAREHOLDERS[0].ownershipMilliPct === 85_000, "K-1 1 is 85.000000%");
  ok(GREENWAY_SHAREHOLDERS[1].name === "Nicholas C Mullan", "K-1 2 name");
  ok(GREENWAY_SHAREHOLDERS[1].ownershipMilliPct === 5_000, "K-1 2 is 5.000000%");
  ok(GREENWAY_SHAREHOLDERS[2].name === "James H Becker", "K-1 3 name");
  ok(GREENWAY_SHAREHOLDERS[2].ownershipMilliPct === 5_000, "K-1 3 is 5.000000%");
  ok(GREENWAY_SHAREHOLDERS[3].name === "Theresa L Becker", "K-1 4 name");
  ok(GREENWAY_SHAREHOLDERS[3].ownershipMilliPct === 5_000, "K-1 4 is 5.000000%");

  // NOBODY is at 10%. This is the whole bug, asserted as an absence (rule 87).
  ok(
    GREENWAY_SHAREHOLDERS.every((s) => s.ownershipMilliPct !== 10_000),
    "no shareholder is at 10% - that was the pre-books-50 error",
  );
  // And assert the presence side first, so the absence means something (66d).
  ok(
    GREENWAY_SHAREHOLDERS.filter((s) => s.ownershipMilliPct === 5_000).length === 3,
    "there are exactly THREE 5% holders",
  );

  // ---- integer exactness -------------------------------------------------
  ok(assertRosterTotalsOneHundred(GREENWAY_SHAREHOLDERS) === 100_000, "85000+5000+5000+5000");

  // The float trap, DEMONSTRATED by execution rather than assumed.
  //
  // An earlier draft of this test asserted `0.85+0.05+0.05+0.05 !== 1`. That
  // assertion is FALSE: those four doubles do sum to exactly 1, and the test
  // failed when run. The concept was right and my example was wrong (standing
  // rule 22a - the test is a suspect, not a witness). Kept as a comment
  // because the near miss is the lesson: "it worked on my percentages" is not
  // a floating-point safety argument.
  ok(0.85 + 0.05 + 0.05 + 0.05 === 1, "these four doubles DO sum to 1 - the trap is elsewhere");
  ok(0.1 + 0.2 !== 0.3, "0.1+0.2 is 0.30000000000000004 - doubles do not hold decimal exactly");

  // The trap that actually bites a roster: ALLOCATING a stubborn amount.
  // Splitting 100001 by these very percentages in floating point yields
  // 85000.84999999999 - not a whole cent, and not even the 85000.85 a human
  // would write. Integer milli-percent instead floors to whole cents and
  // leaves a remainder of exactly 1 that must be assigned deliberately.
  const stubborn = 100_001;
  const byFloat = [0.85, 0.05, 0.05, 0.05].map((p) => stubborn * p);
  ok(byFloat[0] === 85000.84999999999, "float allocation of 100001 drifts off the cent");
  ok(!byFloat.every((x) => Number.isInteger(x)), "and none of the float shares are whole cents");
  const byInt = [85_000, 5_000, 5_000, 5_000].map((p) => Math.floor((stubborn * p) / 100_000));
  ok(byInt.join(",") === "85000,5000,5000,5000", "integer floors are exact whole cents");
  ok(
    stubborn - byInt.reduce((a, b) => a + b, 0) === 1,
    "and leave a visible remainder of 1 cent to assign on purpose, not by luck",
  );

  // ---- the community-property facts, recorded not computed ---------------
  ok(
    GREENWAY_SHAREHOLDERS[0].communityPropertySpouse === "Alyssa Lyman",
    "Michael's 85% is a community-property household - his words: 'my wife and I'",
  );
  ok(
    GREENWAY_SHAREHOLDERS[0].holdingForm === "community_property_household",
    "and it is marked as such",
  );
  // Alyssa is NOT a fifth shareholder. IRC 1361(c)(1) is scoped to (b)(1)(A).
  ok(
    !GREENWAY_SHAREHOLDERS.some((s) => s.name === "Alyssa Lyman"),
    "Alyssa is not separately named on the return, so not a roster entry",
  );
  ok(
    GREENWAY_SHAREHOLDERS[2].communityPropertySpouse === "Theresa L Becker" &&
      GREENWAY_SHAREHOLDERS[3].communityPropertySpouse === "James H Becker",
    "the Beckers are each other's community-property spouse",
  );

  // ---- the economic reading ---------------------------------------------
  ok(GREENWAY_FAMILY_UNITS.length === 3, "three economic units");
  const beckers = GREENWAY_FAMILY_UNITS.find((u) => u.label === "The Becker household");
  ok(beckers !== undefined && beckers.ownershipMilliPct === 10_000, "Becker household is 10%");
  ok(beckers !== undefined && beckers.memberNames.length === 2, "made of TWO named shareholders");
  // The economic units also total 100%, by a different route.
  ok(
    GREENWAY_FAMILY_UNITS.reduce((a, u) => a + u.ownershipMilliPct, 0) === 100_000,
    "85000 + 5000 + 10000 = 100000",
  );

  // ---- formatting -------------------------------------------------------
  ok(formatOwnershipMilliPct(85_000) === "85%", "85000 -> 85%");
  ok(formatOwnershipMilliPct(5_000) === "5%", "5000 -> 5%");
  ok(formatOwnershipMilliPct(2_375) === "2.375%", "2375 -> 2.375%");
  ok(formatOwnershipMilliPct(10_500) === "10.5%", "10500 -> 10.5% (trailing zeros trimmed)");
  ok(formatOwnershipMilliPct(0) === "0%", "0 -> 0%");
  throws(() => formatOwnershipMilliPct(1.5), "integer milli-percent", "fractional milli-percent");
  throws(() => formatOwnershipMilliPct(-1), "cannot be negative", "negative ownership");

  // ---- the generated sentences ------------------------------------------
  const sentence = describeRoster();
  ok(
    sentence ===
      "Michael B Lyman at 85%, Nicholas C Mullan at 5%, James H Becker at 5%, and Theresa L Becker at 5%",
    `roster sentence drifted, got: ${sentence}`,
  );
  ok(!sentence.includes("10%"), "the roster sentence must never say 10%");
  ok(describeRosterMilliPctSum() === "85000 + 5000 + 5000 + 5000", "milli-percent sum sentence");
  ok(
    describeFamilyUnits() ===
      "Michael's household 85%, Nicholas C Mullan 5%, The Becker household 10%",
    "family-unit sentence",
  );

  // ---- the guard must be able to REFUSE (rule 15: prove it can fail) ----
  //
  // START WITH THE BROKEN INPUT (standing rule 83). The historical wrong
  // roster is Michael 85, mother 10, grandfather 5. Reconstruct it exactly.
  const supersededThree: readonly Shareholder[] = [
    { ...GREENWAY_SHAREHOLDERS[0] },
    { ...GREENWAY_SHAREHOLDERS[3], ownershipMilliPct: 10_000 },
    { ...GREENWAY_SHAREHOLDERS[1] },
  ];

  // FIRST, the finding that made this whole class of bug possible: the wrong
  // roster BALANCES. 85000 + 10000 + 5000 = 100000.  [SUPERSEDED-ROSTER]
  // The sum check cannot see
  // it and never could. Asserted here so nobody ever again believes that
  // totalling 100% means the roster is right.
  ok(
    // SUPERSEDED-ROSTER: the superseded roster is named deliberately below.
    supersededThree.reduce((a, s) => a + s.ownershipMilliPct, 0) === 100_000,
    "the superseded 85/10/5 roster sums to exactly 100% - which is why it survived", // [SUPERSEDED-ROSTER]
  );
  ok(
    assertRosterTotalsOneHundred(supersededThree) === 100_000,
    "and assertRosterTotalsOneHundred ACCEPTS it - the sum check is not the gate",
  );

  // So the SHAPE gate is what must refuse it, on identity rather than total.
  throws(
    // SUPERSEDED-ROSTER: the superseded roster is named deliberately below.
    () => assertIsFiledGreenwayRoster(supersededThree),
    "carries 4 Schedule K-1s",
    "the superseded three-person 85/10/5 roster must be REFUSED on its shape", // [SUPERSEDED-ROSTER]
  );
  // Right count, wrong percentage: Theresa at 10 and Nicholas dropped to 0 is
  // caught by the sum check, so use a swap that still totals 100.
  throws(
    () =>
      assertIsFiledGreenwayRoster([
        { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 80_000 },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
        { ...GREENWAY_SHAREHOLDERS[3], ownershipMilliPct: 10_000 },
      ]),
    'field G "Current year allocation percentage"',
    "four names totalling 100 but at the wrong split must be REFUSED",
  );
  // A spouse added as a shareholder is the exact mistake this file warns
  // about. It has TWO shapes, and they trip different checks - the length
  // check runs first, so a fifth entry never reaches the name check. Both are
  // asserted, each with the message it actually produces, because an assertion
  // that passes for the wrong reason teaches the wrong lesson.
  //
  // Shape A: Alyssa added as a FIFTH entry -> caught on count.
  const alyssa: Shareholder = {
    name: "Alyssa Lyman",
    relationship: "wife",
    ownershipMilliPct: 40_000,
    holdingForm: "individual",
    communityPropertySpouse: null,
  };
  throws(
    () =>
      assertIsFiledGreenwayRoster([
        { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 45_000 },
        alyssa,
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
        { ...GREENWAY_SHAREHOLDERS[3] },
      ]),
    "carries 4 Schedule K-1s",
    "a spouse added as a FIFTH shareholder must be REFUSED on count",
  );
  // Shape B: Alyssa SUBSTITUTED for a real holder, so the count is still four
  // and the total is still 100. Only identity can catch this one.
  throws(
    () =>
      assertIsFiledGreenwayRoster([
        { ...GREENWAY_SHAREHOLDERS[0] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
        { ...alyssa, ownershipMilliPct: 5_000 },
      ]),
    "is not a Greenway shareholder",
    "a spouse SUBSTITUTED for a filed shareholder must be REFUSED on identity",
  );
  // The same name twice, totalling 100, must not slip through.
  throws(
    () =>
      assertIsFiledGreenwayRoster([
        { ...GREENWAY_SHAREHOLDERS[0] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[1] },
      ]),
    "appears twice",
    "a duplicated shareholder must be REFUSED",
  );
  // And the real roster must PASS, or the gate is just a wall (rule 66d).
  assertIsFiledGreenwayRoster(GREENWAY_SHAREHOLDERS);

  throws(() => assertRosterTotalsOneHundred([]), "roster is empty", "empty roster");

  // The plain "does not add up" case. Found by mutation testing: disabling the
  // total comparison in `assertRosterTotalsOneHundred` SURVIVED the entire
  // suite, because every other failing fixture above trips a different guard
  // first - the empty check, the zero check, the integer check, or the shape
  // gate. A function named "assertRosterTotalsOneHundred" had no test in which
  // a roster failed to total one hundred (standing rule 22c).
  throws(
    () =>
      assertRosterTotalsOneHundred([
        { ...GREENWAY_SHAREHOLDERS[0] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
      ]),
    "roster totals 95000 milli-percent, not 100000. Off by 5000",
    "a roster short of 100% must be REFUSED",
  );
  throws(
    () =>
      assertRosterTotalsOneHundred([
        { ...GREENWAY_SHAREHOLDERS[0] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
        { ...GREENWAY_SHAREHOLDERS[3] },
        { ...GREENWAY_SHAREHOLDERS[3], name: "Somebody Else" },
      ]),
    "roster totals 105000 milli-percent, not 100000. Off by 5000",
    "a roster over 100% must be REFUSED",
  );
  // And the same defect reached through the shape gate, which delegates the
  // total check rather than repeating it.
  throws(
    () =>
      assertIsFiledGreenwayRoster([
        { ...GREENWAY_SHAREHOLDERS[0] },
        { ...GREENWAY_SHAREHOLDERS[1] },
        { ...GREENWAY_SHAREHOLDERS[2] },
        { ...GREENWAY_SHAREHOLDERS[3], ownershipMilliPct: 4_000 },
      ]),
    "roster totals 99000 milli-percent",
    "four correct names that do not total 100% must be REFUSED",
  );
  throws(
    () =>
      assertRosterTotalsOneHundred([
        { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 100_000 },
        { ...GREENWAY_SHAREHOLDERS[1], ownershipMilliPct: 0 },
      ]),
    "is not a shareholder",
    "a 0% holder",
  );
  throws(
    () =>
      assertRosterTotalsOneHundred([
        { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 99_999.5 },
        { ...GREENWAY_SHAREHOLDERS[1], ownershipMilliPct: 0.5 },
      ]),
    "non-integer ownership",
    "float ownership",
  );

  // A roster that sums to 100 but has the WRONG SHAPE passes the sum check and
  // is stopped only by the shape gate. Both halves asserted together so the
  // division of labour between the two functions is documented by execution.
  const fiftyFifty: readonly Shareholder[] = [
    { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 50_000 },
    { ...GREENWAY_SHAREHOLDERS[1], ownershipMilliPct: 50_000 },
  ];
  ok(
    assertRosterTotalsOneHundred(fiftyFifty) === 100_000,
    "a 50/50 roster sums fine - the sum check alone cannot police the shape",
  );
  throws(
    () => assertIsFiledGreenwayRoster(fiftyFifty),
    "carries 4 Schedule K-1s",
    "but the shape gate refuses it",
  );
}
