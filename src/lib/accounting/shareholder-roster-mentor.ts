/**
 * src/lib/accounting/shareholder-roster-mentor.ts   (books-50)
 *
 * THE CPA WHO CHECKS WHO THE OWNERS ARE BEFORE CHECKING THAT THEY ADD UP.
 *
 * Standing rule 26: every engine ships with a mentor layer and every exported
 * function is taught.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE THEME, STATED ONCE AT THE TOP
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This whole slice exists because of one arithmetic accident. The roster that
 * had been sitting in these books for forty-nine slices said:
 *
 *     Michael Lyman    85%     [SUPERSEDED-ROSTER - the very bug this slice fixes]
 *     Mother           10%    [SUPERSEDED-ROSTER]
 *     Nicholas Mullan   5%    [SUPERSEDED-ROSTER]
 *
 * and the filed Form 1120-S says there are four shareholders at 85/5/5/5. The
 * seeded version is wrong. But look at what it does:
 *
 *     85 + 10 + 5 = 100          [SUPERSEDED-ROSTER: the filed roster is 85/5/5/5]
 *
 * It BALANCES. Perfectly. Which means every guard in this system - the
 * statement-level database trigger, the sum assertion in the engine, every test
 * that checked ownership totalled one hundred percent - passed it, correctly,
 * every single time. Nothing was wrong with those checks. They were asking
 * "do these shares add up", the answer was yes, and the question they were not
 * asking was "are these the right people".
 *
 * A wrong roster is not an unbalanced roster. It is a balanced roster
 * describing the wrong human beings. That is the lesson of the slice and it
 * generalises well past shareholders: a total is a very weak fingerprint. Two
 * completely different sets of facts can produce the same total, and when they
 * do, a total check is not a weak test - it is a test that will never fail no
 * matter how wrong the data gets.
 *
 * The second theme is scope clauses. There is a real sentence in the Internal
 * Revenue Code saying a husband and wife are one shareholder, and another
 * saying an entire family is one shareholder, and Greenway's four owners
 * genuinely are one family - a grandfather, his daughter, her husband, and his
 * grandson. Read those sentences without their first eight words and Greenway
 * has ONE shareholder. Read them as written and it has four. The eight words
 * are worth $7,020. [SUPERSEDED-ROSTER: $7,020 is what the WRONG three-shareholder count
 * produced; the correct twelve-month maximum on four shareholders is $9,360.]
 *
 * The third theme is that this module holds TWO TRUTHS ON PURPOSE. The legal
 * roster is four people. The economic picture is three households, because
 * Washington is a community-property state and the mother and step-father are
 * married to each other. The old "10%" row was not fabricated out of nothing -
 * it was the household figure written where the legal figure belonged. Deleting
 * that fact to fix the count would replace one error with a different one, so
 * both are exported, separately, and neither is the default.
 *
 * This module is PURE and browser-safe (standing rule 65b). The coverage gates
 * that read the engine off disk live in `shareholder-roster-mentor-gates.ts`,
 * because in books-33 a mentor that imported `node:fs` and was also rendered on
 * a screen made Turbopack refuse every Vercel deployment while CI stayed green.
 */

import type { MentorLesson } from "@/lib/accounting/basis-aaa-mentor";

export const SHAREHOLDER_ROSTER_LESSONS: readonly MentorLesson[] = [
  {
    fn: "formatOwnershipMilliPct",
    plainEnglish:
      "Turns the stored whole number into the percentage a person reads, so 85000 becomes " +
      "\u201c85%\u201d and 5000 becomes \u201c5%\u201d, and refuses outright if it is handed something that is not " +
      "a whole number of milli-percent.",
    whyItExists:
      "Ownership is stored as an integer in thousandths of a percent rather than as 0.85, for the " +
      "same reason money is stored in cents: a percentage is going to be multiplied by a dollar " +
      "figure, and binary floating point cannot hold 0.85 exactly. The engine's own self-test " +
      "demonstrates the failure rather than describing it - allocating 100001 cents by floating " +
      "point gives Michael 85000.84999999999 cents, and every naive rounding of that is a cent " +
      "adrift from the total. Integers make the arithmetic exact and this function exists so that " +
      "storing them exactly does not mean displaying them unreadably.",
    theTrap:
      "Accepting a fraction. Somebody will eventually pass 0.85 here, meaning eighty-five percent, " +
      "and a permissive formatter would render \u201c0.00085%\u201d or silently multiply it. It looks like a " +
      "display bug and it is not - it means the caller is holding the wrong units, and the same " +
      "wrong units are about to be multiplied by an income figure. That is why this throws instead " +
      "of coping. The related trap is negative ownership, which is not a small share, it is a " +
      "corrupted record.",
    whatIWouldDo:
      "Whenever a percentage appears on a screen next to a dollar figure, check that the two came " +
      "from the same units. Michael can do this without reading any code: the four percentages on " +
      "his K-1s must read 85, 5, 5, 5 and total exactly 100. If a screen ever shows 84.99 or " +
      "100.01, stop and find out why before using the number for anything.",
    authorityIds: ["irc-6699-s-corp-failure-to-file"],
  },
  {
    fn: "assertRosterTotalsOneHundred",
    plainEnglish:
      "Adds up the ownership percentages and throws if they do not come to exactly one hundred " +
      "percent, returning the total when they do.",
    whyItExists:
      "One class of stock means the shares are the whole company and nothing more, so anything but " +
      "exactly 100% is a recording error rather than an unusual arrangement. A roster totalling " +
      "95% means somebody was left off, and a roster totalling 105% means income is about to be " +
      "allocated twice. It returns the total rather than a boolean so a caller cannot ignore it by " +
      "forgetting to check a return value (standing rule 48).",
    theTrap:
      "Believing this function protects the roster. IT DOES NOT, AND THAT IS THE ENTIRE POINT OF " +
      "THIS SLICE. The roster it failed to catch for forty-nine slices - 85% plus 10% plus 5% - " +
      "totals exactly 100000 milli-percent. This check passed it every time, and was right to. I " +
      "started this slice about to write a test asserting that this function refuses the old " +
      "three-person roster, and when I actually ran it the function returned 100000 without " +
      "complaint. My assertion was false, not the code. A sum is a very weak fingerprint: " +
      "different sets of people produce identical totals, so a total check cannot see identity and " +
      "no amount of tightening will make it.",
    whatIWouldDo:
      "Keep this check, because an unbalanced roster is a real and different bug, and never let it " +
      "be the only check. When something must be right about a LIST, ask separately whether it " +
      "adds up and whether it is the right list - they are two questions and only one of them is " +
      "arithmetic. In Michael's terms: the shares adding to 100% does not tell you your mother is " +
      "on the return, it only tells you nobody's slice is missing.",
    authorityIds: ["IRC_1361_B_1_D_ONE_CLASS", "REG_1_1361_1_L_1_IDENTICAL_RIGHTS"],
  },
  {
    fn: "assertIsFiledGreenwayRoster",
    plainEnglish:
      "Checks that a roster IS the four people on Greenway's filed Schedule K-1s, by name and by " +
      "percentage, and throws a different message for each way it can be wrong.",
    whyItExists:
      "Because the total check cannot see identity, and something has to. This is the guard the " +
      "books did not have. It checks four things in order - the count, then that every name " +
      "belongs, then that no name repeats, then that each holder's percentage matches what was " +
      "filed - so the failure tells you WHICH kind of wrong it is. The count comes first because " +
      "a fifth entry is the most likely future mistake: somebody adding Alyssa Lyman as a " +
      "shareholder in good faith, because Michael quite reasonably describes the 85% as \u201cmy wife " +
      "and I\u201d.",
    theTrap:
      "The order of the checks is itself a trap, and it caught me while I was writing the tests. I " +
      "wrote a case that added a fifth holder to prove the NAME check would reject an unknown " +
      "person, and it passed - but for the wrong reason, because five entries fail the count " +
      "check first and never reach the name comparison. The test was green and proved nothing " +
      "about the thing I thought I was testing. It had to be split into two shapes: one that adds " +
      "an entry, and one that SUBSTITUTES a name while keeping four. The general trap: when guards " +
      "run in sequence, an early one can shadow a later one, and a passing test does not tell you " +
      "which guard fired.",
    whatIWouldDo:
      "Hold the position that the filed return is the record until an amended return says " +
      "otherwise. Michael's own words and the K-1s agree here, which is the comfortable case; when " +
      "they disagree, the answer is to ask his grandfather what was actually filed, not to average " +
      "the two. And keep the community-property fact where it belongs - Alyssa's interest in the " +
      "85% is real Washington property law, and it still does not put a fifth name on a K-1.",
    authorityIds: [
      "irc-1361-c-1-a-family-treated-as-one-shareholder",
      "irc-6699-s-corp-failure-to-file",
    ],
  },
  {
    fn: "describeRoster",
    plainEnglish:
      "Writes the roster out as one readable sentence, so guidance text can state who the " +
      "shareholders are instead of having a list typed into it by hand.",
    whyItExists:
      "This is how the bug spread, and how it is stopped from spreading again. The wrong roster " +
      "did not live only in the database - it had been TYPED into guidance prose in a dozen " +
      // SUPERSEDED-ROSTER: the phrases quoted next are the WRONG claims, named so the lesson can
      // warn about them. The filed roster is 85/5/5/5 and the figure is $9,360.
      "places: \u201cGreenway has three shareholders\u201d, \u201cyour mother is a 10% shareholder\u201d, " + // [SUPERSEDED-ROSTER]
      "\u201cabout $7,000\u201d. None of those sentences were computed from anything, so none of them " +
      "changed when the facts did, and each one had to be found and fixed by hand. Every one of " +
      "them now calls this function, which means the next correction is one edit rather than " +
      "twelve.",
    theTrap:
      "Thinking prose is harmless because it is only words. The sentence \u201cyou have three " +
      // SUPERSEDED-ROSTER: \u201cthree shareholders ... about $7,000\u201d is the sentence that shipped.
      "shareholders, so the maximum \u00a76699 penalty is about $7,000\u201d is not commentary - it is a " + // [SUPERSEDED-ROSTER]
      "dollar figure Michael would act on, and it was understated by $2,340. A hardcoded sentence " +
      "is a hardcoded fact with no test watching it. The subtler trap is a formatter that quietly " +
      "renders an empty roster as an empty string, producing \u201cthe shareholders are \u201d and reading " +
      "like a display glitch rather than missing data.",
    whatIWouldDo:
      "Treat any sentence containing a name or a number as data, not decoration, and generate it. " +
      "When reading guidance in this system, Michael should be able to assume that if a screen " +
      "names his shareholders it got them from the same place the tax forms do - and where it " +
      "cannot, the screen should say so rather than guess.",
    authorityIds: ["irc-6699-s-corp-failure-to-file"],
  },
  {
    fn: "describeRosterMilliPctSum",
    plainEnglish:
      "Writes out the addition itself - each holder's milli-percent, added up, with the total - so " +
      "the arithmetic can be checked by eye rather than trusted.",
    whyItExists:
      "Because \u201c85000 + 5000 + 5000 + 5000 = 100000\u201d had been typed into comments and prose as " +
      // SUPERSEDED-ROSTER: the superseded sum is quoted next on purpose - the lesson is that it
      // is ALSO true arithmetic. The filed roster is 85000 + 5000 + 5000 + 5000.
      "\u201c85000 + 10000 + 5000 = 100000\u201d, and both sentences are TRUE arithmetic. That is what made " + // [SUPERSEDED-ROSTER]
      "the old one so hard to spot: it was not a broken sum, it was a correct sum of the wrong " +
      "numbers. Generating the string means the arithmetic on the screen is the arithmetic the " +
      "engine performs, and cannot describe a roster the system does not hold.",
    theTrap:
      "Writing a comment that shows the maths. It feels like the responsible thing to do and it " +
      "creates a second copy of the facts that no test reads. Standing rule 73 is the general " +
      "form: comparing two documents is blind to both being wrong, and a comment agreeing with " +
      "itself is worse - it agrees with a version of reality from whenever it was typed.",
    whatIWouldDo:
      "When a figure is checkable, show the working, and make the working come from the data. If " +
      "Michael ever sees this sentence not ending in 100000, that is a real finding and worth a " +
      "phone call, because the database trigger should have refused whatever produced it.",
    authorityIds: ["IRC_1361_B_1_D_ONE_CLASS"],
  },
  {
    fn: "describeFamilyUnits",
    plainEnglish:
      "Describes the roster the other way - as three households rather than four individuals - " +
      "because the mother and step-father are married to each other and their 5% shares are one " +
      "10% family interest.",
    whyItExists:
      "To keep a true fact that the correction would otherwise have destroyed. The old \u201cMother " +
      "10%\u201d row was not invented; it was the Becker household's combined interest, which is real, " +
      "and Washington community-property law is why. It was simply recorded where the LEGAL roster " +
      "belonged. Michael does the same thing himself, accurately, when he says \u201cmy wife and I: " +
      "85%\u201d. Both levels are true at once and they answer different questions: the legal roster " +
      "answers what goes on a return and what \u00a76699 counts; the household view answers why the " +
      "distributions look uneven and who is actually affected by a decision.",
    theTrap:
      "Fixing a bug by deleting the fact that caused it. It would have been easy - and would have " +
      "looked like rigour - to erase every mention of 10% and declare the roster clean. That " +
      "replaces a misfiled truth with a missing one, and the next person to notice that the " +
      "Beckers are married would have no record that anyone had ever thought about it. The " +
      "opposite trap is letting the household view become the default and quietly renumbering the " +
      "roster to three, which is exactly how this started. Standing rule 62d: never invent a " +
      "default. Neither view is the default here; a caller must say which one it wants.",
    whatIWouldDo:
      "Say which level you mean, every time, out loud. \u201cFour shareholders\u201d for anything the IRS " +
      "counts; \u201cthree households\u201d when discussing distributions or who to talk to. And flag the " +
      "consequences nobody has confirmed yet - whether the two Becker interests receive " +
      "distributions is recorded as unconfirmed rather than assumed, because guessing it would " +
      "misstate a one-class-of-stock question.",
    authorityIds: [
      "irc-1361-c-1-b-i-members-of-a-family-defined",
      "irc-1361-c-1-a-family-treated-as-one-shareholder",
      "REG_1_1361_1_L_1_IDENTICAL_RIGHTS",
    ],
  },
  {
    fn: "__runShareholderRosterCoreTests",
    plainEnglish:
      "Runs the engine's own assertions in a plain Node process, with no test framework involved, " +
      "so the guarantees are checked even where vitest never runs.",
    whyItExists:
      "Standing rule 22c territory. The compliance suite transpiles TypeScript without " +
      "type-checking it, so a self-test that executes in bare Node is a second, independent " +
      "witness that the module actually works rather than merely compiles. This one is registered " +
      "in `scripts/compliance/run-pure-selftests.ts`, which is a gate in CI; an unregistered " +
      "self-test is dead code wearing a green check.",
    theTrap:
      "Trusting your own assertions. Standing rule 22a says the test is a suspect, not a witness, " +
      "and this slice proved it twice. I wrote that 0.85 + 0.05 + 0.05 + 0.05 does not equal 1 in " +
      "floating point, to justify integer storage - I ran it, and those four particular doubles DO " +
      "sum to exactly 1. Then I wrote that the sum check would refuse the old 85/10/5 roster, and " + // [SUPERSEDED-ROSTER]
      // SUPERSEDED-ROSTER: quoting the superseded sum is the point of this lesson.
      "it does not, because 85000 + 10000 + 5000 is exactly 100000. Two confident assertions, both " + // [SUPERSEDED-ROSTER]
      "false, and both would have passed review as obviously correct. They were replaced with " +
      "traps that were verified to actually spring.",
    whatIWouldDo:
      "Run the assertion before writing it down. If a test is meant to prove something is refused, " +
      "watch it be refused first, and if it passes for a reason other than the one intended, that " +
      "is a broken test even though it is green. A mutation campaign on this module caught a real " +
      "hole this way: disabling the total comparison entirely survived every test, because every " +
      "failing fixture tripped some other guard before reaching it.",
    authorityIds: ["IRC_1361_B_1_D_ONE_CLASS"],
  },
];

/** Look up the lesson for one exported function. Undefined, never a throw. */
export function findShareholderRosterLesson(fn: string): MentorLesson | undefined {
  return SHAREHOLDER_ROSTER_LESSONS.find((l) => l.fn === fn);
}

/** Every function name this mentor claims to teach. */
export function taughtShareholderRosterFunctionNames(): readonly string[] {
  return SHAREHOLDER_ROSTER_LESSONS.map((l) => l.fn);
}
