/**
 * src/lib/accounting/period-close-authorities.ts   (books-18)
 *
 * WHY A MONTH GETS SEALED, AND WHAT IT COSTS TO UNSEAL IT.
 *
 * Roadmap item 2 of 8. The database already knows HOW to close a period
 * (`gl_close_period` / `gl_reopen_period`, migration 0172). What it does not
 * know is WHETHER a period deserves to be closed. That judgement is this
 * slice, and every part of it is anchored to something quotable.
 *
 * ---------------------------------------------------------------------------
 * THE SOURCING POSITION, WHICH IS BETTER THAN IT WAS
 * ---------------------------------------------------------------------------
 *
 * books-17 had to say out loud that the FASB Codification was licensed and
 * could not be quoted. Michael read that and obtained it. Every ASC record
 * below is therefore transcribed VERBATIM from the copy now living in
 * `docs/authorities/fasb-codification/`, and
 * `scripts/verify-verbatim-quotes.ts` proves it by exact substring match
 * rather than asking anyone to trust careful typing (standing rules 24, 35).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT REDECLARED HERE
 * ---------------------------------------------------------------------------
 *
 * §6001 permanent books, §1.446-1(a)(4) the books-to-return reconciliation,
 * §1.446-1(a)(2) clearly reflect income, and the whole §280E/§471 apparatus
 * ALREADY EXIST in the registry. They are cited by id and never re-declared,
 * because a citation that means two slightly different things is worse than no
 * citation at all (standing rule 2).
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) WHY CLOSING MATTERS — the cost of being wrong after the fact
// ---------------------------------------------------------------------------

const ASC250 =
  "FASB Accounting Standards Codification ASC 250-10, as supplied by the owner 2026-08-20 " +
  "(docs/authorities/fasb-codification/asc-250.txt); Copyright \u00a9 2026 Financial Accounting " +
  "Foundation, all rights reserved.";

/**
 * The definition that decides whether a mistake is an "error" at all.
 *
 * This is load-bearing for the close screen because it draws the line between
 * a correction you post today and a restatement of a month already reported.
 */
export const ASC_250_ERROR_DEFINITION: GuidanceAuthority = {
  id: "ASC_250_10_20_ERROR_DEFINED",
  kind: "gaap",
  cite: "FASB ASC 250-10-20 (glossary: Error in Previously Issued Financial Statements)",
  quote:
    "An error in recognition, measurement, presentation, or disclosure in financial statements " +
    "resulting from mathematical mistakes, mistakes in the application of generally accepted " +
    "accounting principles (GAAP), or oversight or misuse of facts that existed at the time the " +
    "financial statements were prepared. A change from an accounting principle that is not " +
    "generally accepted to one that is generally accepted is a correction of an error.",
  soWhat:
    "Read the last clause slowly: \"facts that existed at the time.\" If the fact was knowable when " +
    "you closed June and nobody looked, that is an ERROR. If the fact came into existence in July, " +
    "it is just July's news. That distinction decides whether you quietly post an entry this month " +
    "or have to go back and restate a month you already reported \u2014 and it is the entire reason this " +
    "screen makes you check things BEFORE sealing a month rather than after.",
  source: ASC250,
};

/**
 * The expensive consequence. This is the sentence that justifies the whole
 * checklist: get it wrong and you do not adjust, you RESTATE.
 */
export const ASC_250_RESTATEMENT_REQUIRED: GuidanceAuthority = {
  id: "ASC_250_10_45_23_RESTATE",
  kind: "gaap",
  cite: "FASB ASC 250-10-45-23",
  quote:
    "Any error in the financial statements of a prior period discovered after the financial " +
    "statements are issued or are available to be issued (as discussed in Section 855-10-25) shall " +
    "be reported as an error correction, by restating the prior-period financial statements. " +
    "Restatement requires all of the following:",
  soWhat:
    "\"Shall be reported... by restating\" is not a suggestion and it is not a choice. Once a month " +
    "has been reported and an error is found in it, the fix is not a tidy entry in the current " +
    "month \u2014 you reissue the earlier statements. That is expensive, it is visible to anyone who " +
    "saw the first version, and for a business under \u00a7280E it can move a tax number. Ten minutes of " +
    "checking before a close is the cheapest insurance available against it.",
  source: ASC250,
};

/**
 * Errors do NOT get swept into this month's income. This is why a close is a
 * real boundary rather than a formality.
 */
export const ASC_250_NOT_IN_CURRENT_INCOME: GuidanceAuthority = {
  id: "ASC_250_10_45_22_NOT_CURRENT_INCOME",
  kind: "gaap",
  cite: "FASB ASC 250-10-45-22",
  quote:
    "As indicated in paragraph 220-10-45-7A, net income for the period shall include all items of " +
    "profit and loss recognized during the period, including accruals of estimated losses from " +
    "loss contingencies, but shall not include corrections of errors from prior periods. As used " +
    "in this Subtopic, the term period refers to both annual and interim reporting periods.",
  soWhat:
    "The tempting shortcut when you find last month's mistake is to book it this month and move on. " +
    "GAAP says you may not: this month's income \"shall not include corrections of errors from prior " +
    "periods.\" Doing it anyway makes BOTH months wrong instead of one, and it hides the mistake " +
    "from exactly the person who most needs to see it. Note the last sentence \u2014 this applies to " +
    "months, not just years, so it governs every close you do.",
  source: ASC250,
};

/**
 * If you do have to restate, you must SAY SO. Relevant here because it prices
 * the consequence honestly rather than making a close sound merely tidy.
 */
export const ASC_250_MUST_DISCLOSE_RESTATEMENT: GuidanceAuthority = {
  id: "ASC_250_10_50_7_DISCLOSE_RESTATEMENT",
  kind: "gaap",
  cite: "FASB ASC 250-10-50-7",
  quote:
    "When financial statements are restated to correct an error, the entity shall disclose that its " +
    "previously issued financial statements have been restated, along with a description of the " +
    "nature of the error. The entity also shall disclose both of the following:",
  soWhat:
    "A restatement cannot be done quietly. You must state that the earlier statements were wrong and " +
    "describe how. If a bank, a buyer, or the Board has seen the first version, they get told. This " +
    "is the real reason the close checklist refuses rather than warns \u2014 a warning you can click " +
    "past becomes, months later, a disclosure you cannot.",
  source: ASC250,
};

// ---------------------------------------------------------------------------
// 2) EXPORTS
// ---------------------------------------------------------------------------

/** Everything this slice ADDS to the registry. */
export const PERIOD_CLOSE_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  ASC_250_ERROR_DEFINITION,
  ASC_250_RESTATEMENT_REQUIRED,
  ASC_250_NOT_IN_CURRENT_INCOME,
  ASC_250_MUST_DISCLOSE_RESTATEMENT,
] as const;

export function findPeriodCloseAuthority(id: string): GuidanceAuthority | undefined {
  return PERIOD_CLOSE_AUTHORITIES_NEW.find((a) => a.id === id);
}

/**
 * Authorities this slice CITES but does NOT own.
 *
 * Every id was verified to resolve in the shared registry. A test asserts they
 * still do, so deleting one elsewhere fails loudly here rather than silently
 * turning a cited rule into a dead string.
 */
export const CLOSE_AUTHORITY_IDS_OWNED_ELSEWHERE: readonly string[] = [
  "REG_1_6001_1_A_PERMANENT_BOOKS",
  "REG_1_446_1_A_4_RECONCILIATION",
  "REG_1_446_1_A_2_CLEARLY_REFLECT",
  "REG_1_471_2_D_VERIFY_BY_COUNT",
  "IRC_280E",
] as const;
