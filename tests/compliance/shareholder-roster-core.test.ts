/**
 * tests/compliance/shareholder-roster-core.test.ts   (books-50)
 *
 * The roster is who owns Greenway, and it was wrong in eleven source files and
 * six documents. This suite does two jobs.
 *
 *   1. Tests the engine: the roster matches the filed Form 1120-S, the sum is
 *      exact in integers, and both guards refuse what they are supposed to.
 *
 *   2. GATES THE WHOLE TREE. A unit test on one module cannot stop the next
 *      slice from hand-typing "Michael 85%, his mother 10%" into a new file, and
 *      hand-typing is exactly how this bug spread. So the last block reads every
 *      .ts and .md file in the repository and fails if any of them states a
 *      Greenway roster that disagrees with the filed return.
 *
 * WHY A SUM CHECK WOULD NOT HAVE CAUGHT THIS, which is the point of the slice:
 * the wrong roster was Michael 85, mother 10, grandfather 5, and
 * 85_000 + 10_000 + 5_000 = 100_000 EXACTLY. It balances. Every ownership
 * assertion in the codebase passed it for forty-nine slices. The invariant that
 * matters is IDENTITY - the names and their percentages - not the total.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { SHAREHOLDER_ROSTER_AUTHORITIES } from "@/lib/accounting/shareholder-roster-authorities";
import { taughtShareholderRosterFunctionNames } from "@/lib/accounting/shareholder-roster-mentor";
import {
  exportedShareholderRosterFunctionNames,
  assertEveryShareholderRosterFunctionIsTaught,
  assertNoLessonTeachesAPhantomFunction,
  assertEveryShareholderRosterLessonIsSubstantive,
  assertEveryCitedAuthorityResolves,
} from "@/lib/accounting/shareholder-roster-mentor-gates";
import {
  GREENWAY_SHAREHOLDERS,
  GREENWAY_SHAREHOLDER_COUNT,
  GREENWAY_FAMILY_UNITS,
  OWNERSHIP_TOTAL_MILLI_PCT,
  formatOwnershipMilliPct,
  assertRosterTotalsOneHundred,
  assertIsFiledGreenwayRoster,
  describeRoster,
  describeRosterMilliPctSum,
  describeFamilyUnits,
  __runShareholderRosterCoreTests,
  type Shareholder,
} from "@/lib/accounting/shareholder-roster-core";

// ---------------------------------------------------------------------------
// 1) THE ROSTER, AGAINST THE FILED RETURN
// ---------------------------------------------------------------------------
// Every expected value below is hand-typed from the 2024 and 2025 Form 1120-S,
// never read back out of the module under test (standing rule 22c).

describe("the filed Greenway roster", () => {
  it("has FOUR shareholders, which is what box I of the 1120-S reports", () => {
    expect(GREENWAY_SHAREHOLDERS).toHaveLength(4);
    expect(GREENWAY_SHAREHOLDER_COUNT).toBe(4);
  });

  it("matches the four Schedule K-1s name for name and percentage", () => {
    // Field G, "Current year allocation percentage", on each K-1.
    expect(GREENWAY_SHAREHOLDERS.map((s) => [s.name, s.ownershipMilliPct])).toEqual([
      ["Michael B Lyman", 85_000],
      ["Nicholas C Mullan", 5_000],
      ["James H Becker", 5_000],
      ["Theresa L Becker", 5_000],
    ]);
  });

  it("has NOBODY at 10% - the pre-books-50 error - and exactly three 5% holders", () => {
    // Presence asserted alongside absence, so the absence means something
    // (standing rule 87 read with 66d).
    expect(GREENWAY_SHAREHOLDERS.filter((s) => s.ownershipMilliPct === 5_000)).toHaveLength(3);
    expect(GREENWAY_SHAREHOLDERS.filter((s) => s.ownershipMilliPct === 10_000)).toHaveLength(0);
  });

  it("totals exactly 100% in integers", () => {
    expect(assertRosterTotalsOneHundred(GREENWAY_SHAREHOLDERS)).toBe(100_000);
    expect(OWNERSHIP_TOTAL_MILLI_PCT).toBe(100_000);
  });

  it("names no spouse as a separate shareholder", () => {
    // IRC 1361(c)(1)(A)(i) treats a husband and wife as one shareholder only
    // "for purposes of subsection (b)(1)(A)" - the 100-shareholder ceiling.
    // It does not add a name to the roster and does not merge them for 6699.
    expect(GREENWAY_SHAREHOLDERS.some((s) => s.name === "Alyssa Lyman")).toBe(false);
    expect(GREENWAY_SHAREHOLDERS[0].communityPropertySpouse).toBe("Alyssa Lyman");
    expect(GREENWAY_SHAREHOLDERS[0].holdingForm).toBe("community_property_household");
  });

  it("records the Becker marriage on both entries", () => {
    expect(GREENWAY_SHAREHOLDERS[2].communityPropertySpouse).toBe("Theresa L Becker");
    expect(GREENWAY_SHAREHOLDERS[3].communityPropertySpouse).toBe("James H Becker");
  });
});

describe("the economic family units", () => {
  it("collapses the Beckers into one 10% unit and still totals 100%", () => {
    expect(GREENWAY_FAMILY_UNITS.map((u) => [u.label, u.ownershipMilliPct])).toEqual([
      ["Michael's household", 85_000],
      ["Nicholas C Mullan", 5_000],
      ["The Becker household", 10_000],
    ]);
    expect(GREENWAY_FAMILY_UNITS.reduce((a, u) => a + u.ownershipMilliPct, 0)).toBe(100_000);
  });

  it("keeps the Becker unit traceable to TWO named shareholders", () => {
    // This is where standing rule 7's "mom 10%" came from. It is a true
    // reading; it is simply not the one a shareholder COUNT may use.
    const beckers = GREENWAY_FAMILY_UNITS.find((u) => u.label === "The Becker household");
    expect(beckers?.memberNames).toEqual(["James H Becker", "Theresa L Becker"]);
  });

  it("does not offer the economic count as a shareholder count", () => {
    expect(GREENWAY_FAMILY_UNITS).toHaveLength(3);
    expect(GREENWAY_SHAREHOLDER_COUNT).toBe(4);
    expect(GREENWAY_FAMILY_UNITS.length).not.toBe(GREENWAY_SHAREHOLDER_COUNT);
  });
});

// ---------------------------------------------------------------------------
// 2) THE GUARDS MUST REFUSE - BROKEN INPUT FIRST (standing rule 83)
// ---------------------------------------------------------------------------

describe("assertRosterTotalsOneHundred refuses", () => {
  const s = (name: string, pct: number): Shareholder => ({
    name,
    relationship: "test",
    ownershipMilliPct: pct,
    holdingForm: "individual",
    communityPropertySpouse: null,
  });

  it("an empty roster", () => {
    expect(() => assertRosterTotalsOneHundred([])).toThrow(/roster is empty/);
  });

  it("a roster short of 100%, naming the shortfall", () => {
    expect(() => assertRosterTotalsOneHundred([s("A", 85_000), s("B", 5_000)])).toThrow(
      /totals 90000 milli-percent, not 100000\. Off by 10000/,
    );
  });

  it("a roster over 100%, naming the excess", () => {
    expect(() => assertRosterTotalsOneHundred([s("A", 85_000), s("B", 20_000)])).toThrow(
      /totals 105000 milli-percent, not 100000\. Off by 5000/,
    );
  });

  it("a zero-percent holder", () => {
    expect(() => assertRosterTotalsOneHundred([s("A", 100_000), s("B", 0)])).toThrow(
      /is not a shareholder/,
    );
  });

  it("a fractional milli-percent, which means somebody used a float", () => {
    expect(() => assertRosterTotalsOneHundred([s("A", 99_999.5), s("B", 0.5)])).toThrow(
      /non-integer ownership/,
    );
  });

  it("but ACCEPTS the wrong-shaped roster that happens to total 100", () => {
    // THE FINDING OF THIS SLICE. The superseded 85/10/5 register balances, so
    // this function - the only ownership guard the codebase had - cannot see
    // it. Asserted so nobody ever again reads a passing sum as a right roster.
    expect(assertRosterTotalsOneHundred([s("A", 85_000), s("B", 10_000), s("C", 5_000)])).toBe(
      100_000,
    );
    expect(assertRosterTotalsOneHundred([s("A", 50_000), s("B", 50_000)])).toBe(100_000);
  });
});

describe("assertIsFiledGreenwayRoster refuses", () => {
  const clone = (i: number, over: Partial<Shareholder> = {}): Shareholder => ({
    ...GREENWAY_SHAREHOLDERS[i],
    ...over,
  });

  it("the superseded three-person 85/10/5 roster, on count", () => {
    expect(() =>
      assertIsFiledGreenwayRoster([
        clone(0),
        clone(3, { ownershipMilliPct: 10_000 }),
        clone(1),
      ]),
    ).toThrow(/carries 4 Schedule K-1s/);
  });

  it("four correct names at the wrong split", () => {
    expect(() =>
      assertIsFiledGreenwayRoster([
        clone(0, { ownershipMilliPct: 80_000 }),
        clone(1),
        clone(2),
        clone(3, { ownershipMilliPct: 10_000 }),
      ]),
    ).toThrow(/Current year allocation percentage/);
  });

  it("a stranger substituted for a filed shareholder", () => {
    expect(() =>
      assertIsFiledGreenwayRoster([
        clone(0),
        clone(1),
        clone(2),
        { ...clone(3), name: "Alyssa Lyman" },
      ]),
    ).toThrow(/is not a Greenway shareholder/);
  });

  it("the same shareholder listed twice", () => {
    expect(() =>
      assertIsFiledGreenwayRoster([clone(0), clone(1), clone(1), clone(1)]),
    ).toThrow(/appears twice/);
  });

  it("four correct names that do not total 100%", () => {
    expect(() =>
      assertIsFiledGreenwayRoster([clone(0), clone(1), clone(2), clone(3, { ownershipMilliPct: 4_000 })]),
    ).toThrow(/totals 99000 milli-percent/);
  });

  it("and ACCEPTS the filed roster, or it is just a wall", () => {
    expect(() => assertIsFiledGreenwayRoster(GREENWAY_SHAREHOLDERS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3) FORMATTING AND THE GENERATED SENTENCES
// ---------------------------------------------------------------------------

describe("formatOwnershipMilliPct", () => {
  it("formats whole and fractional percentages", () => {
    expect(formatOwnershipMilliPct(85_000)).toBe("85%");
    expect(formatOwnershipMilliPct(5_000)).toBe("5%");
    expect(formatOwnershipMilliPct(10_000)).toBe("10%");
    expect(formatOwnershipMilliPct(0)).toBe("0%");
    expect(formatOwnershipMilliPct(2_375)).toBe("2.375%");
    expect(formatOwnershipMilliPct(10_500)).toBe("10.5%");
    expect(formatOwnershipMilliPct(100_000)).toBe("100%");
  });

  it("refuses a float or a negative", () => {
    expect(() => formatOwnershipMilliPct(1.5)).toThrow(/integer milli-percent/);
    expect(() => formatOwnershipMilliPct(-1)).toThrow(/cannot be negative/);
  });
});

describe("the generated sentences", () => {
  it("produce the canonical roster prose", () => {
    expect(describeRoster()).toBe(
      "Michael B Lyman at 85%, Nicholas C Mullan at 5%, James H Becker at 5%, and Theresa L Becker at 5%",
    );
    expect(describeRosterMilliPctSum()).toBe("85000 + 5000 + 5000 + 5000");
    expect(describeFamilyUnits()).toBe(
      "Michael's household 85%, Nicholas C Mullan 5%, The Becker household 10%",
    );
  });

  it("never says 10% in the legal roster sentence", () => {
    expect(describeRoster()).not.toContain("10%");
    expect(describeRosterMilliPctSum()).not.toContain("10000");
  });

  it("refuses to describe a roster that does not total 100%", () => {
    // The formatter is not a place to launder a bad roster.
    expect(() =>
      describeRoster([
        { ...GREENWAY_SHAREHOLDERS[0], ownershipMilliPct: 1 },
      ]),
    ).toThrow(/totals 1 milli-percent/);
  });
});

describe("integer exactness", () => {
  it("uses integers because allocation in floats drifts off the cent", () => {
    // Demonstrated, not assumed. An earlier draft of this suite asserted that
    // 0.85+0.05+0.05+0.05 !== 1, which is FALSE - they sum to exactly 1. The
    // trap is in ALLOCATION, not in the addition (standing rule 22a).
    expect(0.85 + 0.05 + 0.05 + 0.05).toBe(1);
    expect(0.1 + 0.2).not.toBe(0.3);

    const shares = [0.85, 0.05, 0.05, 0.05].map((p) => 100_001 * p);
    expect(shares[0]).toBe(85000.84999999999);
    expect(shares.every((x) => Number.isInteger(x))).toBe(false);

    const ints = [85_000, 5_000, 5_000, 5_000].map((p) => Math.floor((100_001 * p) / 100_000));
    expect(ints).toEqual([85_000, 5_000, 5_000, 5_000]);
    expect(100_001 - ints.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("the pure self-test runs under vitest too", () => {
  it("passes", () => {
    expect(() => __runShareholderRosterCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4) THE TREE-WIDE GATE
// ---------------------------------------------------------------------------
// A unit test cannot stop the next slice from typing the wrong roster into a
// brand-new file, and typing is how this defect spread to seventeen places. So
// scan the tree.
//
// The gate looks for the SPECIFIC false claims, not for the digits "10". A gate
// that banned "10%" outright would fire on the L&I rate, the 10% type-size
// advertising rule, and a hundred honest sentences, and a gate that cries wolf
// gets switched off (standing rule 83's companion problem).

const REPO_ROOT = join(__dirname, "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".probe",
]);

/**
 * Files allowed to contain the superseded roster ANYWHERE in them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIST IS DELIBERATELY TINY, AND WHY IT USED TO BE BIGGER
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A whole-file exemption switches the gate off for that file FOREVER, including
 * for text nobody has written yet. The first draft of this gate exempted every
 * file that legitimately discusses the old roster, and then the gate caught the
 * files I wrote in this very slice - the mentor, the migration, the registry
 * comment - all of which must quote "85000 + 10000 + 5000" in order to explain
 * why it balanced and therefore why it survived.
 *
 * Exempting those four files would have been the easy fix and it would have
 * gutted the gate: `shareholder-roster-mentor.ts` is exactly the kind of file a
 * future slice will copy a roster claim into, and it would have been blind.
 *
 * So the escape hatch is PER LINE instead (see NARRATION_MARKER). A line may
 * quote the superseded roster only if it says on that same line that it is
 * doing so. The two entries left below are the only files where a per-line
 * marker is impossible or wrong:
 *
 *   - this test file, which must contain the banned strings as PATTERNS and as
 *     specimens, in code, where a prose marker would be meaningless;
 *   - todo.md, the standing rules, which are APPEND-ONLY. Rule 7 keeps its
 *     original wrong text verbatim and rule 101 supersedes it. Editing rule 7
 *     to add a marker is forbidden by the rules themselves.
 */
const ALLOWED = new Set<string>([
  "tests/compliance/shareholder-roster-core.test.ts",
  "todo.md",
]);

/**
 * THE PER-LINE ESCAPE HATCH.
 *
 * A line that states the superseded roster is permitted if and only if it also
 * carries this marker. That makes every exemption:
 *
 *   - VISIBLE, to a reader of that line rather than a reader of this test;
 *   - LOCAL, so the rest of the file stays gated;
 *   - DELIBERATE, because it cannot be inherited by text written later.
 *
 * The marker names the correct roster, so a line claiming to be narration while
 * quoting the wrong facts still has the right answer sitting next to it. This
 * is standing rule 17: correct visibly, do not quietly drop.
 */
const NARRATION_MARKER = "SUPERSEDED-ROSTER";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|md|sql)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The banned claims. Each is a regex for a sentence that asserts the WRONG
 * roster, phrased the way the codebase actually phrased it.
 */
const BANNED: ReadonlyArray<{ readonly why: string; readonly re: RegExp }> = [
  {
    // The optional article matters: an earlier draft missed
    // "his mother is a 10% shareholder" in form-w2-store.ts because of the "a".
    // Found by testing the GATE against the real sentence, not by reading it.
    why: "states the mother owns 10% (she owns 5%; the 10% is the Becker household, two people)",
    re: /(?:mother|mom)(?:'s|\u2019s)?\s+(?:is\s+|at\s+|owns\s+|was\s+)?(?:a\s+|an\s+|the\s+)?10\s?(?:%|per ?cent)/i,
  },
  {
    why: "states Greenway has three shareholders (the filed 1120-S box I reports four)",
    re: /(?:Greenway(?:'s)?|company(?:'s)?)\s+(?:has\s+|with\s+)?three\s+shareholders/i,
  },
  {
    why: "states the ownership split as 85/10/5 (it is 85/5/5/5)",
    re: /85\s*\/\s*10\s*\/\s*5/,
  },
  {
    why: "states the roster sum as 85000 + 10000 + 5000 (it is 85000 + 5000 + 5000 + 5000)",
    re: /85[_,]?000\s*\+\s*10[_,]?000\s*\+\s*5[_,]?000/,
  },
  {
    // SCOPED DELIBERATELY. An earlier version of this rule banned "$7,000"
    // outright and fired on eleven innocent files: $7,000 is the FUTA wage
    // base (IRC 3306(b)(1)), and it is quoted correctly all over the payroll
    // engine. A gate that cries wolf gets switched off, so this one only fires
    // when the figure sits near a §6699 / shareholder-count claim.
    why: "quotes the understated §6699 exposure of $7,000 or $7,020 (four shareholders is $9,360)",
    re: /\$7[,_]020\b|(?:6699|shareholders)[^.]{0,120}?\$7[,_]000|\$7[,_]000[^.]{0,120}?(?:6699|shareholders)/i,
  },
];

describe("TREE GATE: no file may state a roster the filed return does not support", () => {
  const files = walk(REPO_ROOT);

  it("scans a plausible number of files, or the walker is broken", () => {
    // A gate that silently scans nothing passes forever (standing rule 16).
    expect(files.length).toBeGreaterThan(500);
  });

  it("can actually detect the banned claims", () => {
    // Prove the patterns fire BEFORE trusting that they found nothing
    // (standing rule 15). These are the real sentences that were in the tree.
    const specimens = [
      "Greenway that is Michael at 85%, his mother at 10%, and Nicholas Mullan at 5%.",
      "With Greenway's three shareholders that is about $7,000 for a year",
      "For Greenway the roster is 85000 + 10000 + 5000.",
      "Michael's mother is a 10% shareholder who is allocated income",
      "your mother\u2019s 10% is allocated but not paid",
      "the 85/10/5 split is irrelevant",
      "at the statutory base the exposure is $7,020 for a year",
    ];
    for (const text of specimens) {
      expect(BANNED.some((b) => b.re.test(text))).toBe(true);
    }
  });

  it("does not fire on honest, unrelated sentences", () => {
    // A gate with false positives gets disabled, so prove it is discriminating.
    const innocent = [
      "the 10% type-size rule applies to social posts",
      "Paid Leave and WA Cares: both are rates on wages, so both rise by 10% too.",
      "three of the four funds are split between employer and employee",
      "Three of the four statements need information the database does not hold",
      "a $7,500 deposit was recorded on the 14th",
      // The real false positives an earlier draft of this gate produced.
      "Federal unemployment stops at $7,000",
      "starts Additional Medicare at $200,000, and stops FUTA at $7,000.",
      "security at the wage base, leaves Medicare uncapped, and stops FUTA at $7,000",
      "Michael B Lyman at 85%, Nicholas C Mullan at 5%, James H Becker at 5%, and Theresa L Becker at 5%",
    ];
    for (const text of innocent) {
      const hit = BANNED.find((b) => b.re.test(text));
      expect(hit?.why ?? "no match").toBe("no match");
    }
  });

  it("finds no banned roster claim anywhere in the tree (the gate itself)", () => {
    // Scans LINE BY LINE, not file by file, for two reasons.
    //
    // 1. It is what makes the per-line NARRATION_MARKER possible at all.
    // 2. `re.exec(wholeFile)` reports only the FIRST match of each pattern in
    //    each file, so a file with three wrong roster claims showed one and the
    //    other two stayed hidden until the first was fixed. That is a gate that
    //    lies about the size of the problem, and I only noticed because this
    //    slice touched files with several offences each.
    const offences: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes(NARRATION_MARKER)) continue;
        for (const { why, re } of BANNED) {
          const m = new RegExp(re.source, re.flags.replace("g", "")).exec(line);
          if (m === null) continue;
          offences.push(`${rel}:${i + 1} ${why}\n      matched: ${JSON.stringify(m[0])}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("the per-line marker exempts only the line it is on", () => {
    // Rule 16: the escape hatch is itself a gate, so drive it both ways. If a
    // marker on one line silenced the whole file, the gate would be one comment
    // away from useless.
    const banned = "the 85/10/5 split";
    const marked = `${banned}  // ${NARRATION_MARKER}: actually 85/5/5/5`;
    const fires = (text: string): boolean =>
      text.split("\n").some(
        (l) => !l.includes(NARRATION_MARKER) && BANNED.some((b) => b.re.test(l)),
      );
    // Unmarked: caught.
    expect(fires(banned)).toBe(true);
    // Marked: allowed.
    expect(fires(marked)).toBe(false);
    // Marked line followed by an UNMARKED one: still caught. This is the whole
    // point - the exemption must not leak downward.
    expect(fires(`${marked}\n${banned}`)).toBe(true);
    // And the marker must not be so loose that it exempts by accident: a line
    // merely mentioning the roster without the marker is still caught.
    expect(fires("superseded roster: 85/10/5")).toBe(true);
  });

  it("reports EVERY offending line, not just the first per file", () => {
    // The bug this test locks down: `re.exec(wholeFileText)` returns one match.
    // A file stating the wrong roster three times reported one offence, so
    // fixing it appeared to reveal a "new" problem each time.
    const text = ["85/10/5 here", "innocent line", "and again 85/10/5", "85/10/5 once more"].join(
      "\n",
    );
    const hits = text
      .split("\n")
      .filter((l) => !l.includes(NARRATION_MARKER) && BANNED.some((b) => b.re.test(l)));
    expect(hits.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5) THE MENTOR LAYER, AND THE STEP BOOKS-27 FORGOT
// ---------------------------------------------------------------------------
//
// Standing rule 21c gives every slice three files - authorities, core, mentor -
// and standing rule 26 says every exported function is taught. Neither of those
// is self-enforcing, so this block enforces them.
//
// The important test in here is not the coverage count. It is
// "every cited authority resolves in the MERGED registry". books-27 shipped an
// authorities module with twenty-one passing tests that was never merged, and
// every screen citing it rendered an unresolved id for four slices. The tests
// were green throughout, because they tested the leaf array rather than the
// registry the UI actually reads. This suite tests the registry.
describe("books-50: the mentor layer and the guidance registry", () => {
  it("teaches every exported function of the core module", () => {
    expect(() => assertEveryShareholderRosterFunctionIsTaught()).not.toThrow();
  });

  it("reads the real engine, and reads something", () => {
    // Rule 39: a gate that parses nothing approves everything. Prove it parsed.
    const exported = exportedShareholderRosterFunctionNames();
    expect(exported.length).toBeGreaterThanOrEqual(7);
    // And prove it found the two functions this slice is actually about, so a
    // regex that silently stopped matching cannot pass this test.
    expect(exported).toContain("assertIsFiledGreenwayRoster");
    expect(exported).toContain("assertRosterTotalsOneHundred");
  });

  it("the coverage gate can actually fail (rule 16: drive it with a broken input)", () => {
    // Point it at a fixture that exports a function nobody has taught. If this
    // does NOT throw, the gate is decoration.
    const fixture = join(REPO_ROOT, ".vitest-roster-gate-fixture.ts");
    writeFileSync(
      fixture,
      "export function aFunctionNobodyTaught(): void {}\n" +
        "export function formatOwnershipMilliPct(): void {}\n",
      "utf8",
    );
    try {
      expect(() => assertEveryShareholderRosterFunctionIsTaught(fixture)).toThrow(
        // `[\s\S]*` rather than `.*` with the `s` flag: this project targets
        // ES2017 and `tsc` rejects the flag. Vitest transpiles WITHOUT type
        // checking, so the suite was green while `tsc --noEmit` exited 2 -
        // which is exactly why the typecheck is a separate gate.
        /ROSTER MENTOR COVERAGE GAP[\s\S]*aFunctionNobodyTaught/,
      );
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  it("refuses to pass vacuously when it parses no exports at all", () => {
    // The failure mode that hid a books-18 mutation: a gate reading an empty
    // list finds no untaught functions and reports success.
    const empty = join(REPO_ROOT, ".vitest-roster-empty-fixture.ts");
    writeFileSync(empty, "// nothing exported here at all\n", "utf8");
    try {
      expect(() => assertEveryShareholderRosterFunctionIsTaught(empty)).toThrow(
        /COVERAGE GATE BROKEN/,
      );
    } finally {
      rmSync(empty, { force: true });
    }
  });

  it("catches a lesson that teaches a function which no longer exists", () => {
    // Rule 66d: assert presence alongside absence. The coverage gate only asks
    // whether the taught set COVERS the exported set, so a lesson left behind
    // by a rename is invisible to it. Drive the mirror gate with a fixture that
    // exports only ONE of the taught functions.
    const partial = join(REPO_ROOT, ".vitest-roster-phantom-fixture.ts");
    writeFileSync(partial, "export function describeRoster(): void {}\n", "utf8");
    try {
      expect(() => assertNoLessonTeachesAPhantomFunction(partial)).toThrow(
        /PHANTOM LESSONS[\s\S]*assertIsFiledGreenwayRoster/,
      );
    } finally {
      rmSync(partial, { force: true });
    }
    // And it passes against the real engine.
    expect(() => assertNoLessonTeachesAPhantomFunction()).not.toThrow();
  });

  it("every lesson is substantive, and the thinness gate can fail", () => {
    expect(() => assertEveryShareholderRosterLessonIsSubstantive()).not.toThrow();
    expect(() =>
      assertEveryShareholderRosterLessonIsSubstantive([
        {
          fn: "describeRoster",
          plainEnglish: "does stuff",
          whyItExists: "because",
          theTrap: "n/a",
          whatIWouldDo: "nothing",
          authorityIds: [],
        },
      ]),
    ).toThrow(/LESSONS TOO THIN/);
    // Rule 22c: and an empty list must not pass either.
    expect(() => assertEveryShareholderRosterLessonIsSubstantive([])).toThrow(/GATE BROKEN/);
  });

  it("teaches a lesson for all seven exported functions, including the self-test", () => {
    // An exemption list is where coverage gaps hide, so __run... is taught too.
    const taught = taughtShareholderRosterFunctionNames();
    expect(taught).toContain("__runShareholderRosterCoreTests");
    expect(new Set(taught).size).toBe(taught.length); // no duplicate lessons
  });

  // -------------------------------------------------------------------------
  // THE BOOKS-27 GATE
  // -------------------------------------------------------------------------

  it("every authority this slice declares is reachable through the MERGED registry", () => {
    // NOT through SHAREHOLDER_ROSTER_AUTHORITIES - that is the leaf array, and
    // testing it is precisely the mistake books-27 made. Resolve through the
    // registry the UI reads.
    for (const a of SHAREHOLDER_ROSTER_AUTHORITIES) {
      const found = findGuidanceAuthority(a.id);
      expect(found, `${a.id} is not in the merged guidance registry`).toBeDefined();
      expect(found!.cite).toBe(a.cite);
      expect(found!.quote).toBe(a.quote);
    }
    expect(SHAREHOLDER_ROSTER_AUTHORITIES.length).toBe(2);
  });

  it("every authority cited by a lesson resolves in the merged registry", () => {
    expect(() => assertEveryCitedAuthorityResolves(findGuidanceAuthority)).not.toThrow();
  });

  it("the citation gate can actually fail (rule 16)", () => {
    // A resolver that finds nothing must produce a loud failure naming the
    // lesson and the id, not a quiet pass.
    expect(() => assertEveryCitedAuthorityResolves(() => undefined)).toThrow(
      /UNRESOLVED CITATIONS/,
    );
    // And a mentor with no citations at all must not sail through.
    expect(() =>
      assertEveryCitedAuthorityResolves(findGuidanceAuthority, [
        {
          fn: "describeRoster",
          plainEnglish: "x".repeat(50),
          whyItExists: "x".repeat(50),
          theTrap: "x".repeat(50),
          whatIWouldDo: "x".repeat(50),
          authorityIds: [],
        },
      ]),
    ).toThrow(/CITATION GATE BROKEN/);
  });

  it("cites the statutes that already exist rather than re-declaring them", () => {
    // Rule 73: two copies of a statute can drift apart while both look
    // authoritative. The lessons cite 6699 and 1361(b)(1) by their EXISTING
    // ids, contributed by earlier slices. Prove those ids still resolve - if a
    // later slice renames one, this fails instead of a screen going blank.
    for (const id of ["irc-6699-s-corp-failure-to-file", "IRC_1361_B_1_D_ONE_CLASS"]) {
      expect(findGuidanceAuthority(id), `${id} vanished`).toBeDefined();
    }
    // And prove this slice did NOT ship a second copy of either one.
    const mine = new Set(SHAREHOLDER_ROSTER_AUTHORITIES.map((a) => a.id));
    expect(mine.has("irc-6699-s-corp-failure-to-file")).toBe(false);
    expect(mine.has("IRC_1361_B_1_D_ONE_CLASS")).toBe(false);
  });

  it("quotes the scope clause that makes the answer four rather than one", () => {
    // The whole legal point of the slice, asserted against the record itself.
    // 1361(c)(1)(A) says a husband and wife are one shareholder, and that all
    // members of a family are one shareholder - and Greenway's four holders ARE
    // one family. It is confined to subsection (b)(1)(A), and that confinement
    // is the only reason the roster is four entries.
    const a = findGuidanceAuthority("irc-1361-c-1-a-family-treated-as-one-shareholder")!;
    expect(a.quote.startsWith("For purposes of subsection (b)(1)(A)")).toBe(true);
    expect(a.quote).toContain("a husband and wife (and their estates)");
    expect(a.quote).toContain("all members of a family (and their estates)");
    // The scope clause must not have been paraphrased away into "for purposes
    // of this section" or dropped entirely - either would invert the meaning.
    expect(a.quote).not.toContain("For purposes of this section");
    expect(a.quote).not.toContain("For purposes of this title");
    // And the record must explain the consequence in Michael's terms, because a
    // verbatim quote with no soWhat is a citation nobody can act on.
    expect(a.soWhat).toContain("$9,360");
  });

  it("the family definition really does cover all four Greenway holders", () => {
    // Not a claim in prose: the roster and the definition are checked together.
    // Nicholas is the common ancestor, Theresa and Michael are his lineal
    // descendants, James is the spouse of a lineal descendant.
    const def = findGuidanceAuthority("irc-1361-c-1-b-i-members-of-a-family-defined")!;
    expect(def.quote).toContain("a common ancestor");
    expect(def.quote).toContain("any lineal descendant of such common ancestor");
    expect(def.quote).toContain("any spouse or former spouse");
    // The relationships the roster records are exactly the ones the definition
    // names, which is why the aggregation rule applies to Greenway at all.
    const relationships = GREENWAY_SHAREHOLDERS.map((s) => s.relationship).sort();
    expect(relationships).toEqual(["grandfather", "mother", "owner", "step-father"]);
  });
});
