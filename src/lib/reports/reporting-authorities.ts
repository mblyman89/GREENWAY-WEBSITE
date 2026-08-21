/**
 * src/lib/reports/reporting-authorities.ts   (books-27)
 *
 * THE AUTHORITY BEHIND HOW A REPORT IS *PRESENTED*, not what it computes.
 *
 * Michael's directive for this slice, recorded verbatim (standing rule 1):
 *
 *   "I don't want ours to be ugly with headers that are stacked in that weird
 *    way making the data impossible to read and understand. I want the same
 *    amount of power Sage has, but displayed in a way that is significantly
 *    easier to read and understand."
 *   "I want verbatim text from authoritative sources."
 *   "I want to know how a real world enterprise grade reporting solution would
 *    use and read and learn from these reports."
 *
 * And the sentence that started it, from the Sage baseline (§8.3):
 *
 *   "I don't use any of the reports in the screenshot really because I don't
 *    understand fully what it is showing me."
 *
 * ---------------------------------------------------------------------------
 * WHY AN "AUTHORITY" FILE FOR *LAYOUT*
 * ---------------------------------------------------------------------------
 *
 * It would be easy to treat readability as taste, and taste cannot be tested.
 * If readability is only my opinion, then the next person to touch this engine
 * has an equally valid opinion, and Michael ends up back at thirty-three
 * columns wrapped over eight lines.
 *
 * It is not taste. The FASB's conceptual framework has an entire qualitative
 * characteristic named UNDERSTANDABILITY, and Chapter 7 has a section named
 * "Line Items, Subtotals, and Summary Information" that says, in terms, that
 * too little aggregation drowns the reader and too much destroys information.
 * That is a DESIGN SPEC, published by the body that writes GAAP, and it maps
 * exactly onto what is wrong with Michael's current reports.
 *
 * So every layout decision this engine makes cites a document. Not because a
 * quote makes a layout pretty, but because it makes the layout ARGUABLE — and
 * therefore testable, reviewable, and hard to quietly undo.
 *
 * ---------------------------------------------------------------------------
 * HONEST SOURCING NOTE (standing rules 11, 24, 35)
 * ---------------------------------------------------------------------------
 *
 * Every quote below was extracted MECHANICALLY from a primary source sitting in
 * `docs/authorities/`, by substring match after whitespace normalisation, in
 * the same session that wrote this file. None was typed from memory. The
 * `scripts/verify-verbatim-quotes.ts` gate re-proves each of them on every CI
 * run, and books-27 EXTENDED that gate to cover the FASB Concepts corpus —
 * which it had never checked before, even though the file was on disk. Three
 * pre-existing CON 8 quotes had therefore been unverified since books-17.
 *
 * WEIGHT, STATED PLAINLY. The conceptual framework is NOT binding GAAP. It is
 * the FASB explaining its own reasoning, and the Codification is what actually
 * binds. CON 8 records here are `kind: "gaap"` because they come from the FASB,
 * but `CONCEPTUAL_FRAMEWORK_DISCLAIMER` below travels with them wherever they
 * are shown, so Michael is never left thinking a design principle is a legal
 * requirement. Saying that out loud is the difference between teaching him and
 * misleading him.
 *
 * WHAT IS DELIBERATELY NOT RE-DECLARED. §280E, §471, ASC 330, the payroll rate
 * authorities and the 26 CFR employment-tax regulations ALL ALREADY EXIST in
 * the registry. They are referenced by id from `REPORTING_AUTHORITY_IDS_OWNED_ELSEWHERE`
 * and never re-typed, because two copies of one authority is exactly how the
 * two copies drift apart (standing rule 2).
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

/**
 * Shown wherever a CON 8 record appears on screen.
 *
 * The Concepts Statements are not authoritative GAAP. They explain the thinking
 * behind it. That distinction matters here more than usual, because this file
 * uses CON 8 to justify LAYOUT — and a reader who mistakes a design principle
 * for a rule will either follow it superstitiously or dismiss the whole file
 * when he finds out.
 */
export const CONCEPTUAL_FRAMEWORK_DISCLAIMER =
  "The FASB Concepts Statements are not binding accounting rules. They are the FASB explaining how it " +
  "thinks — the reasoning underneath the rules. We quote them here because they are the clearest " +
  "published description anywhere of what makes a financial report readable, and readability is exactly " +
  "what you told us was broken. Where a Concepts Statement and the Codification overlap, the " +
  "Codification wins and the Concepts Statement is the commentary.";

// ---------------------------------------------------------------------------
// 1) UNDERSTANDABILITY — the FASB's own name for Michael's complaint
// ---------------------------------------------------------------------------

/**
 * The one-sentence design brief for this entire slice.
 *
 * Note what it says the job IS: classifying, characterizing, and presenting.
 * Not "computing". A report can be arithmetically perfect and still fail this
 * sentence, which is precisely the state Michael's Sage reports are in — every
 * number in them is right, and he does not open them.
 */
export const CON8_QC30_UNDERSTANDABILITY: GuidanceAuthority = {
  id: "CON8_QC30_UNDERSTANDABILITY",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 3, ¶QC30",
  quote:
    "Classifying, characterizing, and presenting information clearly and concisely makes it understandable.",
  soWhat:
    "This is the whole brief for our reports engine in one sentence, written by the people who write the " +
    "accounting rules. Note the three verbs: CLASSIFYING (putting the number in the right group), " +
    "CHARACTERIZING (naming it so a human knows what it is), and PRESENTING (laying it out). Your Sage " +
    "earnings report does the arithmetic perfectly and fails all three — thirty-three columns named things " +
    "like SUI2_COGS_C, wrapped over eight lines per person. Correct and unreadable is not a pass.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 3, QC30)",
};

/**
 * The rebuttal to "just leave the hard parts out."
 *
 * This is the guard rail on the whole readability project. The failure mode of
 * a simplification effort is that it simplifies away something load-bearing,
 * and then the report is easy to read and wrong.
 */
export const CON8_QC31_OMISSION_MISLEADS: GuidanceAuthority = {
  id: "CON8_QC31_OMISSION_MISLEADS",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 3, ¶QC31",
  quote:
    "Some phenomena are inherently complex and cannot be made easy to understand. Excluding information " +
    "about those phenomena from financial reports might make the information in those financial reports " +
    "easier to understand. However, those reports would be incomplete and therefore potentially misleading.",
  soWhat:
    "This is the limit on how far we are allowed to simplify for you. You asked for the same POWER as Sage " +
    "with far better presentation — this paragraph is why those are the correct instructions. We may " +
    "reorganise, rename, group and hide-behind-a-click. We may not drop a number because it is awkward. " +
    "§280E is genuinely complicated and pretending otherwise would make your reports easier to read and " +
    "more dangerous to rely on.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 3, QC31)",
};

/**
 * The direct answer to Michael's complaint, from the FASB's own basis for
 * conclusions: hard things must be presented and explained AS CLEARLY AS
 * POSSIBLE. Not "as clearly as the software vendor managed."
 */
export const CON8_BC342_EXPLAIN_AS_CLEARLY_AS_POSSIBLE: GuidanceAuthority = {
  id: "CON8_BC342_EXPLAIN_CLEARLY",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 3, ¶BC3.42",
  quote:
    "Classifying understandability as an enhancing qualitative characteristic is intended to indicate that " +
    "information that is difficult to understand should be presented and explained as clearly as possible.",
  soWhat:
    "Two words carry this whole slice: PRESENTED and EXPLAINED. Presented is the layout. Explained is the " +
    "mentor sitting next to it telling you what you are looking at and what to do about it. A vendor who " +
    "ships the table and skips the explanation has done half the job — which is why you have thirteen Sage " +
    "reports and open none of them.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 3, BC3.42)",
};

/**
 * Who the report is FOR. This is the paragraph that stops us dumbing anything
 * down: Michael has a Master's in accounting from UW. He is the diligent,
 * reasonably-knowledgeable user this paragraph describes.
 */
export const CON8_QC32_REASONABLE_KNOWLEDGE: GuidanceAuthority = {
  id: "CON8_QC32_REASONABLE_KNOWLEDGE",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 3, ¶QC32",
  quote:
    "Financial reports are prepared for users who have a reasonable knowledge of business and economic " +
    "activities and who review and analyze the information diligently.",
  soWhat:
    "You are exactly this reader — a Master's in accounting and twelve years running the place. So the " +
    "problem with your Sage reports was never that they were too advanced for you. They were badly laid " +
    "out. This paragraph is our licence to keep the full detail and our instruction not to patronise you: " +
    "plain English is not the same thing as simplified content.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 3, QC32)",
};

// ---------------------------------------------------------------------------
// 2) AGGREGATION — the measured cure for a thirty-three-column report
// ---------------------------------------------------------------------------

/**
 * WHY SUMMARISE AT ALL. The FASB's answer: because the raw mass of data is
 * unusable. This authorises the summary layer.
 */
export const CON8_PR35_AGGREGATION_REQUIRED: GuidanceAuthority = {
  id: "CON8_PR35_AGGREGATION_REQUIRED",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR35",
  quote:
    "Nearly all reporting entities would find it excessively difficult and expensive to provide full " +
    "information about every detail of their activities during a reporting period. Even if that were " +
    "feasible, the resulting masses of data would be very difficult for resource providers to understand " +
    "and use. Consequently, preparing financial statements for all but the simplest and smallest entities " +
    "requires simplifying, condensing, and aggregating data into meaningful line items, subtotals, and " +
    "totals.",
  soWhat:
    'Read "the resulting masses of data would be very difficult to understand and use" and then look at a ' +
    "Sage earnings report: thirty-three value columns per employee, wrapped over eight physical lines. That " +
    "is the failure this paragraph predicts. The cure it names is not deletion — it is SIMPLIFYING, " +
    "CONDENSING and AGGREGATING into meaningful subtotals. That is what our engine does: same numbers, " +
    "grouped into a handful of lines a person can actually hold in their head.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 7, PR35)",
};

/**
 * THE OTHER DITCH. Summarise too hard and you have destroyed the information.
 * This is why every summary line in our engine must be expandable to the detail
 * it came from, and why the detail is never thrown away.
 */
export const CON8_PR36_OVER_AGGREGATION: GuidanceAuthority = {
  id: "CON8_PR36_OVER_AGGREGATION",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR36",
  quote:
    "Conversely, too high a level of aggregation would result in the loss of useful information.",
  soWhat:
    "The guard rail on the previous paragraph, and the reason our reports are not just four big numbers. " +
    'Every summary line in this engine can be opened to show the rows underneath it. You get "Employer ' +
    'payroll taxes: $2,265.69" as the headline, and one click gets you the six components. Summary first, ' +
    "detail on demand, nothing discarded.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 7, PR36)",
};

/**
 * The sentence that decides WHO gets to aggregate. A reader can always add up;
 * he cannot take apart what you have already merged. That asymmetry is the
 * entire argument for keeping detail available.
 */
export const CON8_PR13_DETAIL_CANNOT_BE_RECOVERED: GuidanceAuthority = {
  id: "CON8_PR13_DETAIL_ASYMMETRY",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR13",
  quote:
    "Resource providers can aggregate line items on financial statements or create their own subtotals, " +
    "but without the underlying details, they may have no way to disaggregate information provided in a " +
    "single line item.",
  soWhat:
    "The most practical sentence in the whole framework. Adding up is easy; taking apart is impossible. So " +
    "when we are unsure whether to show a breakdown, we show it (behind a click), because you can always " +
    "ignore detail you did not need — and you can never recover detail we decided not to give you. This is " +
    "why our engine never rolls two different taxes into one line just because they are both taxes.",
  source: "docs/authorities/fasb-concepts/conceptual-framework.txt (FASB CON 8, Ch. 7, PR13)",
};

// ---------------------------------------------------------------------------
// 3) BINDING GAAP — comparatives, from the Codification itself
// ---------------------------------------------------------------------------

/**
 * This is BINDING, unlike everything in sections 1 and 2. ASC 205-10-45-1 is
 * the authority for showing a prior period next to the current one — the single
 * highest-value change we can make to a report, and the one Sage's payroll
 * reports mostly do not make.
 */
export const ASC_205_10_45_1_COMPARATIVES: GuidanceAuthority = {
  id: "ASC_205_10_45_1_COMPARATIVE",
  kind: "gaap",
  cite: "FASB ASC 205-10-45-1 (Presentation of Financial Statements — Comparative Financial Statements)",
  quote:
    "The presentation of comparative financial statements in annual and other reports enhances the " +
    "usefulness of such reports and brings out more clearly the nature and trends of current changes " +
    "affecting the entity. Such presentation emphasizes the fact that statements for a series of periods " +
    "are far more significant than those for a single period and that the accounts for one period are but " +
    "an installment of what is essentially a continuous history.",
  soWhat:
    'This is binding GAAP, not a design opinion, and it is the reason every report we build shows you a ' +
    'comparison instead of a lonely column of numbers. "$68,923.45 of wages" tells you almost nothing. ' +
    '"$68,923.45, up 12.0% from $61,531.21 last quarter" tells you something you can act on. The last ' +
    'clause is the one to remember: one period is "but an installment of what is essentially a continuous ' +
    'history."',
  source: "docs/authorities/fasb-codification/asc-205.txt (FASB ASC 205-10-45-1)",
};

/**
 * The trap attached to the paragraph above. A comparison between two periods
 * that were measured differently is worse than no comparison, because it looks
 * like information.
 */
export const ASC_205_10_45_3_COMPARABILITY: GuidanceAuthority = {
  id: "ASC_205_10_45_3_COMPARABILITY",
  kind: "gaap",
  cite: "FASB ASC 205-10-45-3 (Presentation of Financial Statements — Comparative Financial Statements)",
  quote:
    "Prior-year figures shown for comparative purposes shall in fact be comparable with those shown for the " +
    "most recent period. Any exceptions to comparability shall be clearly brought out as described in " +
    "Topic 250.",
  soWhat:
    'Note the word "shall" twice — this is a requirement, not advice. It is also the reason our engine ' +
    "refuses to print a percentage change across a boundary where something material changed underneath. " +
    "Your unemployment rate moved from 0.64% to 0.37%: a chart of unemployment tax that trends down across " +
    "that boundary is not showing you a business improvement, it is showing you a rate change, and a report " +
    "that does not say so is actively lying to you.",
  source: "docs/authorities/fasb-codification/asc-205.txt (FASB ASC 205-10-45-3)",
};

// ---------------------------------------------------------------------------
// 4) THE FEDERAL RECORDKEEPING FLOOR — why a report must be reproducible
// ---------------------------------------------------------------------------

/**
 * Why a report is not a screen. It is a record you may have to reproduce years
 * later, which is an argument for storing the INPUTS and the RATES, not the
 * rendered output.
 */
export const PUB15_RECORDKEEPING_4_YEARS: GuidanceAuthority = {
  id: "PUB15_RECORDKEEPING_4_YEARS",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), Recordkeeping",
  quote:
    "Keep all records of employment taxes for at least 4 years. These should be available for IRS review.",
  soWhat:
    'This is why our reports are reproducible rather than merely printable. Four years from now the IRS can ' +
    "ask you to support a number on a 2026 return. If our report simply recalculated with today's rates it " +
    "would produce a DIFFERENT answer than the one you filed, and you would have no way to show your " +
    "work. So every report records the rates it used and the date it was run — the reason the rate registry " +
    "stores dated rows instead of current values.",
  source: "docs/authorities/federal/irs-pub-15-2026.txt (IRS Pub. 15 (2026), Recordkeeping)",
};

// ---------------------------------------------------------------------------
// 5) THE EXPORTED SET
// ---------------------------------------------------------------------------

/**
 * Registered into the shared registry by `books-guidance-core.ts`. Declared
 * here once; imported there whole, never re-typed (standing rule 2).
 */
export const REPORTING_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  CON8_QC30_UNDERSTANDABILITY,
  CON8_QC31_OMISSION_MISLEADS,
  CON8_BC342_EXPLAIN_AS_CLEARLY_AS_POSSIBLE,
  CON8_QC32_REASONABLE_KNOWLEDGE,
  CON8_PR35_AGGREGATION_REQUIRED,
  CON8_PR36_OVER_AGGREGATION,
  CON8_PR13_DETAIL_CANNOT_BE_RECOVERED,
  ASC_205_10_45_1_COMPARATIVES,
  ASC_205_10_45_3_COMPARABILITY,
  PUB15_RECORDKEEPING_4_YEARS,
] as const;

/**
 * Authorities this engine RELIES ON but does not own. Cited by id so a screen
 * can resolve them, never re-declared. If one of these ids ever stops resolving
 * the wiring test fails, which is how we learn that a registry stopped being
 * merged (the exact bug that hid 36 payroll authorities until books-16).
 */
export const REPORTING_AUTHORITY_IDS_OWNED_ELSEWHERE: readonly string[] = [
  "IRC_280E",
  "REG_1_61_3_A",
  "CON8_CH7_PR33_NETTING",
] as const;
