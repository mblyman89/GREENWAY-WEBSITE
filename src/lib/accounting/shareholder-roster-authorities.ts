/**
 * src/lib/accounting/shareholder-roster-authorities.ts   (books-50)
 *
 * THE SENTENCES THAT DECIDE HOW MANY SHAREHOLDERS GREENWAY HAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A SLICE ABOUT A DATA CORRECTION NEEDS AUTHORITIES AT ALL
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Because "how many shareholders are there" is not an opinion, and because the
 * wrong answer is worth money. The seeded roster said three. The filed returns
 * say four. Three is not a rounding difference from four - IRC 6699 multiplies
 * a penalty BY the number of shareholders, so the difference between three and
 * four is $2,340 of unrecognised exposure on a twelve-month failure.
 *
 * But the interesting part is not that the count was wrong. It is that there is
 * a real sentence in the Code that says a husband and wife are ONE shareholder,
 * and another that says an entire FAMILY is one shareholder - and Greenway's
 * four holders are a husband, a wife, a mother and a grandfather, which is to
 * say a family. Read carelessly, those sentences say Greenway has one
 * shareholder. Read as written, they say nothing of the kind, because both are
 * expressly scoped to a single subsection. The whole point of this file is that
 * the scope clause is not decoration.
 *
 * Standing rule 21c: authorities are quoted VERBATIM and live apart from the
 * engine. Standing rule 24: the quote is sacred. Every `quote` below is checked
 * character-for-character against docs/authorities/federal/usc-1361.txt by
 * `scripts/verify-verbatim-quotes.ts`, which is why the em dashes and curly
 * quotation marks are the ones the statute actually uses.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

const LII_1361 = "https://www.law.cornell.edu/uscode/text/26/1361";

// ---------------------------------------------------------------------------
// 1) THE SENTENCE THAT IS ALMOST ALWAYS MISREAD
// ---------------------------------------------------------------------------

/**
 * The one that makes a married couple a single shareholder - and ONLY for the
 * hundred-shareholder ceiling.
 *
 * Michael describes his own stake as "my wife and I: 85%", and he is telling
 * the truth about his household. Washington is a community-property state, so
 * Alyssa's interest in that 85% is real property law, not sentiment. And here
 * is a statute that appears to bless collapsing the two of them into one line.
 *
 * It does not, and the reason is the first eight words.
 */
export const IRC_1361_C_1_A_ONE_SHAREHOLDER: GuidanceAuthority = {
  id: "irc-1361-c-1-a-family-treated-as-one-shareholder",
  kind: "statute",
  cite: "26 U.S.C. \u00a71361(c)(1)(A)",
  // Quoted with BOTH clauses, deliberately. Clause (i) is the one people reach
  // for; clause (ii) is the one that shows how far this would go if the scope
  // clause were ignored - it would make Greenway's grandfather, mother,
  // step-father and Michael a single shareholder between them.
  quote:
    "For purposes of subsection (b)(1)(A), there shall be treated as one shareholder\u2014 (i) a " +
    "husband and wife (and their estates), and (ii) all members of a family (and their estates).",
  soWhat:
    "Read the first eight words and the rest of the sentence stops being dangerous. \u201cFor purposes " +
    "of subsection (b)(1)(A)\u201d limits this to ONE job: counting heads against the hundred-shareholder " +
    "ceiling for S-corporation eligibility. It is a rule about whether the company may be an S " +
    "corporation at all, and Greenway is nowhere near a hundred holders, so in practice it never " +
    "does any work here. What it does NOT do is renumber the roster for any other purpose. It does " +
    "not merge Michael and Alyssa into one line on a Schedule K-1, and it does not reduce the " +
    "number \u00a76699 multiplies by. Take the scope clause away and clause (ii) would say Greenway has " +
    "ONE shareholder \u2014 a grandfather is a common ancestor, and a mother, a step-father and a " +
    "grandson are his family \u2014 which would put the \u00a76699 twelve-month exposure at $2,340 instead of " +
    "$9,360. That is the size of the error available from skipping eight words. The roster in this " +
    "system therefore carries four legal entries, and records the household relationships " +
    "separately as the economic facts they are.",
  source: LII_1361,
};

/**
 * The definition of "members of a family", quoted because the clause above is
 * meaningless without it and because it shows the reach is genuinely wide.
 *
 * Nicholas C Mullan is Michael's grandfather. Theresa L Becker is Michael's
 * mother. Under this definition Nicholas is a common ancestor, Theresa and
 * Michael are his lineal descendants, and James H Becker is a spouse of a
 * lineal descendant. All four of Greenway's shareholders are one family - which
 * is exactly why the scope clause in (c)(1)(A) matters so much here.
 */
export const IRC_1361_C_1_B_I_MEMBERS_OF_A_FAMILY: GuidanceAuthority = {
  id: "irc-1361-c-1-b-i-members-of-a-family-defined",
  kind: "statute",
  cite: "26 U.S.C. \u00a71361(c)(1)(B)(i)",
  quote:
    "The term \u201cmembers of a family\u201d means a common ancestor, any lineal descendant of such common " +
    "ancestor, and any spouse or former spouse of such common ancestor or any such lineal " +
    "descendant.",
  soWhat:
    "This is the definition that makes the previous authority a live question rather than a " +
    "curiosity, because Greenway's four shareholders satisfy it completely. Nicholas C Mullan is " +
    "the common ancestor; Theresa L Becker and Michael B Lyman are lineal descendants of his; " +
    "James H Becker is the spouse of a lineal descendant. There is no one on the roster who falls " +
    "outside it. So the family-aggregation rule genuinely applies to Greenway \u2014 and still changes " +
    "nothing about the count, purely because \u00a71361(c)(1)(A) confines it to subsection (b)(1)(A). " +
    "This is worth knowing rather than guessing at, for a practical reason: it means that if " +
    "Greenway ever brought in outside investors, the family would count as ONE against the hundred " +
    "limit, leaving far more room than a headcount suggests. Useful, and still not a reason to " +
    "write three names where four were filed.",
  source: LII_1361,
};

// ---------------------------------------------------------------------------
// 2) THE SENTENCE THAT DOES THE COUNTING FOR REAL
// ---------------------------------------------------------------------------
//
// NOT DUPLICATED HERE, ON PURPOSE. The counting sentence is IRC 6699(b)(1) -
// "$195 ... multiplied by the number of persons who were shareholders in the S
// corporation during any part of the taxable year" - and it is ALREADY in the
// registry as `irc-6699-s-corp-failure-to-file`, contributed by books-21's
// interest slice.
//
// Standing rule 73 territory: a second copy of a quote is a second thing that
// can drift, and drift between two copies of the same statute is invisible
// because both look authoritative. The lessons in the mentor cite the EXISTING
// id. If that record is ever wrong it is wrong in one place.
//
// The same reasoning applies to IRC 1361(b)(1) (the hundred-shareholder ceiling
// that (c)(1)(A) is scoped to), which books-19 already contributed as
// `IRC_1361_B_1_D_ONE_CLASS` - it quotes subsection (b)(1) whole, including
// clause (A). The scope clause above therefore resolves to a record already in
// the registry, and the mentor cites it.

// ---------------------------------------------------------------------------
// 3) THE SLICE'S REGISTRY CONTRIBUTION
// ---------------------------------------------------------------------------

/**
 * Everything this slice adds to the ONE shared registry.
 *
 * This array is not decoration and it is not optional. `books-guidance-core.ts`
 * warns at length about the failure it is preventing: books-27 shipped a
 * beautifully written authorities module with twenty-one tests that was never
 * merged into the registry, so every screen citing it showed an unresolved id.
 * An exported registry that nothing merges is dead code wearing a green check
 * (standing rule 50). `tests/compliance/shareholder-roster-core.test.ts`
 * asserts that both records below are reachable through the MERGED registry,
 * so this file cannot become orphaned without a red test.
 */
export const SHAREHOLDER_ROSTER_AUTHORITIES: readonly GuidanceAuthority[] = [
  IRC_1361_C_1_A_ONE_SHAREHOLDER,
  IRC_1361_C_1_B_I_MEMBERS_OF_A_FAMILY,
] as const;

/** Look up one authority introduced by this slice. Undefined, never a throw. */
export function findShareholderRosterAuthority(id: string): GuidanceAuthority | undefined {
  return SHAREHOLDER_ROSTER_AUTHORITIES.find((a) => a.id === id);
}
