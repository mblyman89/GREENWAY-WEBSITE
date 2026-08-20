/**
 * src/lib/accounting/basis-aaa-authorities.ts   (books-19)
 *
 * STOCK BASIS, DEBT BASIS, AND THE ACCUMULATED ADJUSTMENTS ACCOUNT.
 *
 * Roadmap item 3 of 8. This slice answers the single most expensive question
 * an S corporation asks each year: **when Michael takes money out of the
 * company, is it tax-free or is it a capital gain?**
 *
 * The answer is not a matter of opinion. It is the output of two running
 * balances kept per shareholder (stock basis and debt basis) and one running
 * balance kept for the corporation as a whole (the AAA). Those three numbers
 * are adjusted in a **prescribed order** by regulation. Do the arithmetic in a
 * different order and you get a different, wrong, answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SLICE IS SHARP FOR A CANNABIS RETAILER SPECIFICALLY
 * ---------------------------------------------------------------------------
 *
 * §280E disallows most of Greenway's operating deductions. A disallowed
 * expense is a "noncapital, nondeductible expense" under §1367(a)(2)(D), which
 * is confirmed word-for-word by §1.1367-1(c)(2) below. That means every dollar
 * §280E takes away **also destroys stock basis** — Michael pays for those
 * expenses twice: once in cash, and once in the basis that would have let him
 * take money out tax-free later.
 *
 * Worse, the floors differ. Stock basis stops at zero (§1367(a)(2), "but not
 * below zero"). AAA does NOT stop at zero (§1.1368-2(a)(3)(ii), "may be
 * decreased ... below zero"). So for this company the two numbers will diverge
 * and are SUPPOSED to diverge. Any engine that keeps one number and calls it
 * both is wrong for Greenway on day one.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT REDECLARED HERE
 * ---------------------------------------------------------------------------
 *
 * `IRC_1367_STOCK_BASIS_ADJUSTMENTS` (§1367(a), the increase/decrease lists)
 * and `IRC_1368_DISTRIBUTIONS_AAA` (§1368(b),(d),(e)(1)(A)) already exist in
 * the registry from books-17 and are cited by id, never re-declared. A
 * citation that means two slightly different things in two places is worse
 * than no citation at all (standing rule 2).
 *
 * ---------------------------------------------------------------------------
 * SOURCING (standing rules 24 and 35)
 * ---------------------------------------------------------------------------
 *
 * Every quote below was retrieved 2026-08-20 from the primary publisher — the
 * eCFR renderer for the regulations, Cornell LII for the statutes — and pasted
 * rather than retyped. Unlike the ASC quotes in books-18, the IRC and CFR text
 * is NOT mirrored under `docs/authorities/`, so
 * `scripts/verify-verbatim-quotes.ts` cannot machine-verify these by substring
 * match. That gap is stated out loud here rather than hidden, per standing
 * rule 36, and is raised with Michael in the books-19 report.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

const LII_1366 = "26 U.S.C. §1366 (Cornell LII, retrieved 2026-08-20)";
const LII_1361 = "26 U.S.C. §1361 (Cornell LII, retrieved 2026-08-20)";
const ECFR_1367_1 = "eCFR, title 26, §1.1367-1 (retrieved 2026-08-20)";
const ECFR_1367_2 = "eCFR, title 26, §1.1367-2 (retrieved 2026-08-20)";
const ECFR_1368_2 = "eCFR, title 26, §1.1368-2 (retrieved 2026-08-20)";
const ECFR_1361_1 = "eCFR, title 26, §1.1361-1 (retrieved 2026-08-20)";

// ---------------------------------------------------------------------------
// 1) THE LOSS LIMITATION — the ceiling on what a shareholder may deduct
// ---------------------------------------------------------------------------

/**
 * The reason basis has to be tracked at all. A shareholder cannot deduct a
 * loss larger than what he has at stake.
 */
export const IRC_1366_D_LOSS_LIMITATION: GuidanceAuthority = {
  id: "IRC_1366_D_LOSS_LIMITATION",
  kind: "statute",
  cite: "26 U.S.C. §1366(d)(1)",
  quote:
    "The aggregate amount of losses and deductions taken into account by a shareholder under " +
    "subsection (a) for any taxable year shall not exceed the sum of— (A) the adjusted basis of the " +
    "shareholder's stock in the S corporation (determined with regard to paragraphs (1) and (2)(A) " +
    "of section 1367(a) for the taxable year), and (B) the shareholder's adjusted basis of any " +
    "indebtedness of the S corporation to the shareholder (determined without regard to any " +
    "adjustment under paragraph (2) of section 1367(b) for the taxable year).",
  soWhat:
    "This is the ceiling, and it is why we keep score at all. You may only deduct losses up to what " +
    "you actually have at stake — your stock basis PLUS money the company genuinely owes you. Note " +
    "the parenthetical in (A): basis is measured after this year's income and after distributions, " +
    "but BEFORE this year's losses. Note the one in (B): debt basis is measured before this year's " +
    "debt-basis reduction. Getting either parenthetical backwards silently changes how much you are " +
    "allowed to deduct, and neither the software nor the return will look wrong when it happens.",
  source: LII_1366,
};

/**
 * The loss you could not use is not lost. This matters enormously for a
 * company whose deductions are being crushed by §280E.
 */
export const IRC_1366_D_2_CARRYOVER: GuidanceAuthority = {
  id: "IRC_1366_D_2_CARRYOVER",
  kind: "statute",
  cite: "26 U.S.C. §1366(d)(2)(A)",
  quote:
    "Except as provided in subparagraph (B), any loss or deduction which is disallowed for any " +
    "taxable year by reason of paragraph (1) shall be treated as incurred by the corporation in the " +
    "succeeding taxable year with respect to that shareholder.",
  soWhat:
    "A loss blocked by low basis is SUSPENDED, not destroyed. It waits, indefinitely, until you have " +
    "basis again — which usually means a profitable year or you putting real money in. Read the " +
    "words carefully though: the suspended loss belongs to THAT SHAREHOLDER, not to the company. It " +
    "does not travel with the shares if they are sold. This is a number the system must carry " +
    "forward year over year per person; forget it and you permanently overpay tax on the first good " +
    "year you have.",
  source: LII_1366,
};

// ---------------------------------------------------------------------------
// 2) WHAT §280E ACTUALLY DOES TO BASIS — the definition that connects them
// ---------------------------------------------------------------------------

/**
 * The hinge of this entire slice for Greenway. §1367(a)(2)(D) reduces basis
 * for "noncapital, nondeductible expenses" without defining them. This does.
 */
export const REG_1_1367_1_C_2_NONCAPITAL_NONDEDUCTIBLE: GuidanceAuthority = {
  id: "REG_1_1367_1_C_2_NONCAPITAL_NONDEDUCTIBLE",
  kind: "regulation",
  cite: "26 CFR §1.1367-1(c)(2)",
  quote:
    "For purposes of section 1367(a)(2)(D), expenses of the corporation not deductible in computing " +
    "its taxable income and not properly chargeable to a capital account (noncapital, nondeductible " +
    "expenses) are only those items for which no loss or deduction is allowable and do not include " +
    "items the deduction for which is deferred to a later taxable year. Examples of noncapital, " +
    "nondeductible expenses include (but are not limited to) the following: Illegal bribes, " +
    "kickbacks, and other payments not deductible under section 162(c); fines and penalties not " +
    "deductible under section 162(f); expenses and interest relating to tax-exempt income under " +
    "section 265; losses for which the deduction is disallowed under section 267(a)(1); the portion " +
    "of meals and entertainment expenses disallowed under section 274; and the two-thirds portion " +
    "of treble damages paid for violating antitrust laws not deductible under section 162.",
  soWhat:
    "This is the sentence that makes §280E hurt twice. A noncapital, nondeductible expense is one " +
    "for which NO loss or deduction is allowable — ever, not merely postponed. Every dollar §280E " +
    "disallows fits that description exactly, so it reduces your stock basis even though you never " +
    "got a deduction for it. The distinction in the middle of the quote is the one to hold onto: " +
    "something merely DEFERRED to a later year (an accrual you have not paid yet, say) is NOT in " +
    "this bucket and must not reduce basis. Sweep deferred items in here and you understate your " +
    "basis, which later turns a tax-free distribution into an invented capital gain.",
  source: ECFR_1367_1,
};

// ---------------------------------------------------------------------------
// 3) THE ORDER OF OPERATIONS — where most basis schedules go wrong
// ---------------------------------------------------------------------------

/**
 * The current ordering rule. Note what sits in position 2.
 */
export const REG_1_1367_1_F_ORDERING: GuidanceAuthority = {
  id: "REG_1_1367_1_F_ORDERING",
  kind: "regulation",
  cite: "26 CFR §1.1367-1(f)",
  quote:
    "For any taxable year of a corporation beginning on or after August 18, 1998, except as provided " +
    "in paragraph (g) of this section, the adjustments required by section 1367(a) are made in the " +
    "following order— (1) Any increase in basis attributable to the income items described in " +
    "section 1367(a)(1)(A) and (B), and the excess of the deductions for depletion described in " +
    "section 1367(a)(1)(C); (2) Any decrease in basis attributable to a distribution by the " +
    "corporation described in section 1367(a)(2)(A); (3) Any decrease in basis attributable to " +
    "noncapital, nondeductible expenses described in section 1367(a)(2)(D), and the oil and gas " +
    "depletion deduction described in section 1367(a)(2)(E); and (4) Any decrease in basis " +
    "attributable to items of loss or deduction described in section 1367(a)(2)(B) and (C).",
  soWhat:
    "Four steps, and the order is not optional. Income goes in FIRST — that is what stops a " +
    "profitable year's distribution from being taxed as a gain. Distributions come SECOND, ahead of " +
    "your nondeductible expenses and ahead of your losses. That sequencing is generous to you: it " +
    "means the §280E damage is applied to basis only AFTER your distribution has already been " +
    "measured against it. Run the steps in any other order — for instance by netting everything " +
    "together, which is what a spreadsheet naturally does — and you will manufacture capital gains " +
    "in years where none exist.",
  source: ECFR_1367_1,
};

/**
 * The election that reverses steps 3 and 4. Included because the system must
 * NOT assume it was made, and must not assume it was not.
 */
export const REG_1_1367_1_G_ELECTIVE_ORDERING: GuidanceAuthority = {
  id: "REG_1_1367_1_G_ELECTIVE_ORDERING",
  kind: "regulation",
  cite: "26 CFR §1.1367-1(g)",
  quote:
    "A shareholder may elect to decrease basis under paragraph (e)(3) or (f)(4) of this section, " +
    "whichever applies, prior to decreasing basis under paragraph (e)(2) or (f)(3) of this section, " +
    "whichever applies. If a shareholder makes this election, any amount described in paragraph " +
    "(e)(2) or (f)(3) of this section, whichever applies, that is in excess of the shareholder's " +
    "basis in stock and indebtedness is treated, solely for purposes of this section, as an amount " +
    "described in paragraph (e)(2) or (f)(3) of this section, whichever applies, in the succeeding " +
    "taxable year. A shareholder makes the election under this paragraph by attaching a statement to " +
    "the shareholder's timely filed original or amended return that states that the shareholder " +
    "agrees to the carryover rule of the preceding sentence. Once a shareholder makes an election " +
    "under this paragraph with respect to an S corporation, the shareholder must continue to use the " +
    "rules of this paragraph for that S corporation in future taxable years unless the shareholder " +
    "receives the permission of the Commissioner.",
  soWhat:
    "There is an option to take losses BEFORE nondeductible expenses. It can be attractive under " +
    "§280E because it lets deductible losses through first and pushes the disallowed expenses into " +
    "next year. Three catches. It requires a STATEMENT ATTACHED TO A FILED RETURN — it is not a " +
    "software toggle. Once made it is STICKY: you keep using it until the IRS lets you stop. And " +
    "whether it was ever made is a fact about a piece of paper, which this system will not guess " +
    "at. That is why the engine refuses to compute rather than quietly defaulting to the standard " +
    "order.",
  source: ECFR_1367_1,
};

// ---------------------------------------------------------------------------
// 4) DEBT BASIS — the second bucket, with its own rules
// ---------------------------------------------------------------------------

/**
 * Debt basis absorbs losses only after stock basis is exhausted.
 */
export const REG_1_1367_2_B_1_DEBT_REDUCTION: GuidanceAuthority = {
  id: "REG_1_1367_2_B_1_DEBT_REDUCTION",
  kind: "regulation",
  cite: "26 CFR §1.1367-2(b)(1)",
  quote:
    "If, after making the adjustments required by section 1367(a)(1) for any taxable year of the S " +
    "corporation, the amounts specified in section 1367(a)(2) (B), (C), (D), and (E) (relating to " +
    "losses, deductions, noncapital, nondeductible expenses, and certain oil and gas depletion " +
    "deductions) exceed the basis of a shareholder's stock in the corporation, the excess is applied " +
    "to reduce (but not below zero) the basis of any indebtedness of the S corporation to the " +
    "shareholder held by the shareholder at the close of the corporation's taxable year. Any such " +
    "indebtedness that has been satisfied by the corporation, or disposed of or forgiven by the " +
    "shareholder, during the taxable year, is not held by the shareholder at the close of that year " +
    "and is not subject to basis reduction.",
  soWhat:
    "Money you genuinely loaned the company is a second tank of basis, but it only starts draining " +
    "once stock basis hits zero. Two traps. First, DISTRIBUTIONS never touch debt basis — only " +
    "losses and nondeductible expenses do, which is why (A) is missing from that list of " +
    "subparagraphs. A distribution larger than stock basis is a capital gain even if the company " +
    "owes you a fortune. Second, the loan must still be outstanding AT YEAR END; repay yourself in " +
    "December and that debt basis is not there to absorb the year's losses.",
  source: ECFR_1367_2,
};

/**
 * Restoration, and the ordering trap inside it.
 */
export const REG_1_1367_2_C_1_DEBT_RESTORATION: GuidanceAuthority = {
  id: "REG_1_1367_2_C_1_DEBT_RESTORATION",
  kind: "regulation",
  cite: "26 CFR §1.1367-2(c)(1)",
  quote:
    "If, for any taxable year of an S corporation beginning after December 31, 1982, there has been " +
    "a reduction in the basis of an indebtedness of the S corporation to a shareholder under section " +
    "1367(b)(2)(A), any net increase in any subsequent taxable year of the corporation is applied to " +
    "restore that reduction. For purposes of this section, net increase with respect to a " +
    "shareholder means the amount by which the shareholder's pro rata share of the items described " +
    "in section 1367(a)(1) (relating to income items and excess deduction for depletion) exceed the " +
    "items described in section 1367(a)(2) (relating to losses, deductions, noncapital, " +
    "nondeductible expenses, certain oil and gas depletion deductions, and certain distributions) " +
    "for the taxable year. These restoration rules apply only to indebtedness held by a shareholder " +
    "as of the beginning of the taxable year in which the net increase arises. The reduction in " +
    "basis of indebtedness must be restored before any net increase is applied to restore the basis " +
    "of a shareholder's stock in an S corporation. In no event may the shareholder's basis of " +
    "indebtedness be restored above the adjusted basis of the indebtedness under section 1016(a), " +
    "excluding any adjustments under section 1016(a)(17) for prior taxable years, determined as of " +
    "the beginning of the taxable year in which the net increase arises.",
  soWhat:
    "When a good year finally arrives, the profit does NOT go where you would expect. \"The reduction " +
    "in basis of indebtedness must be restored BEFORE any net increase is applied to restore the " +
    "basis of a shareholder's stock.\" Debt basis heals first; stock basis only gets what is left " +
    "over. This matters because distributions can only be sheltered by STOCK basis. So the year " +
    "after a bad year, you can have a genuinely profitable company, feel entitled to take money out, " +
    "and still have almost no stock basis to take it against. And note the cap at the end: debt " +
    "basis can never be restored above what you actually loaned.",
  source: ECFR_1367_2,
};

// ---------------------------------------------------------------------------
// 5) THE AAA — corporate-level, and it behaves differently on purpose
// ---------------------------------------------------------------------------

/**
 * The AAA is one account for the whole company. It is NOT a per-shareholder
 * number, which is the most common misunderstanding of it.
 */
export const REG_1_1368_2_A_1_AAA_NOT_APPORTIONED: GuidanceAuthority = {
  id: "REG_1_1368_2_A_1_AAA_NOT_APPORTIONED",
  kind: "regulation",
  cite: "26 CFR §1.1368-2(a)(1)",
  quote:
    "The accumulated adjustments account is an account of the S corporation and is not apportioned " +
    "among shareholders. The AAA is relevant for all taxable years beginning on or after January 1, " +
    "1983, for which the corporation is an S corporation. On the first day of the first year for " +
    "which the corporation is an S corporation, the balance of the AAA is zero. The AAA is increased " +
    "in the manner provided in paragraph (a)(2) of this section and is decreased in the manner " +
    "provided in paragraph (a)(3) of this section.",
  soWhat:
    "Two facts worth memorising. The AAA belongs to the COMPANY and is never split three ways — " +
    "there is no such thing as \"Michael's share of AAA,\" even though there very much is such a " +
    "thing as Michael's stock basis. And it starts at exactly ZERO on day one of the S election, " +
    "which for Greenway is a genuinely useful anchor: there is no historical balance to reconstruct " +
    "or argue about. Basis is personal, AAA is corporate; keeping one number for both is the single " +
    "most common way small S-corp books go wrong.",
  source: ECFR_1368_2,
};

/**
 * The floor that is not there. This is the counterpart to §1367(a)(2)'s
 * "(but not below zero)".
 */
export const REG_1_1368_2_A_3_II_BELOW_ZERO: GuidanceAuthority = {
  id: "REG_1_1368_2_A_3_II_BELOW_ZERO",
  kind: "regulation",
  cite: "26 CFR §1.1368-2(a)(3)(ii)",
  quote:
    "The AAA may be decreased under paragraph (a)(3)(i) of this section below zero. The AAA is " +
    "decreased by noncapital, nondeductible expenses under paragraph (a)(3)(i)(C) of this section " +
    "even though a portion of the noncapital, nondeductible expenses is not taken into account by a " +
    "shareholder under § 1.1367-1(g) (relating to the elective ordering rule). The AAA is also " +
    "decreased by the entire amount of any loss or deduction even though a portion of the loss or " +
    "deduction is not taken into account by a shareholder under section 1366(d)(1) or is otherwise " +
    "not currently deductible under the Internal Revenue Code. However, in any subsequent taxable " +
    "year in which the loss, deduction, or noncapital, nondeductible expense is treated as incurred " +
    "by the corporation with respect to the shareholder under section 1366(d)(2) or § 1.1367-1(g) " +
    "(or in which the loss or deduction is otherwise allowed to the shareholder), no further " +
    "adjustment is made to the AAA.",
  soWhat:
    "This is where AAA and basis part company, and for Greenway they will part company badly. Stock " +
    "basis stops at zero. AAA keeps going down. Worse, AAA is reduced by the ENTIRE loss even the " +
    "part you were not allowed to deduct because you ran out of basis — and then, when that " +
    "suspended loss finally comes free in a later year, AAA is NOT reduced again. That last sentence " +
    "prevents a genuine double-count, and it means the AAA schedule and the basis schedule are two " +
    "different histories of the same events. Expect them to disagree; be suspicious when they agree " +
    "too neatly.",
  source: ECFR_1368_2,
};

/**
 * ...but distributions DO stop at zero. The asymmetry is the point.
 */
export const REG_1_1368_2_A_3_III_DISTRIBUTIONS_NOT_BELOW_ZERO: GuidanceAuthority = {
  id: "REG_1_1368_2_A_3_III_DISTRIBUTIONS_NOT_BELOW_ZERO",
  kind: "regulation",
  cite: "26 CFR §1.1368-2(a)(3)(iii)",
  quote:
    "The AAA is decreased (but not below zero) by any portion of a distribution to which section " +
    "1368 (b) or (c)(1) applies.",
  soWhat:
    "Read this immediately after the previous authority and notice the asymmetry, because it is easy " +
    "to miss and it is deliberate. LOSSES can push AAA below zero. DISTRIBUTIONS cannot. If AAA is " +
    "already negative, a distribution does not make it more negative — it simply gets no AAA at all " +
    "and is tested purely against your stock basis instead. An engine that treats a distribution " +
    "like any other reduction will drive AAA too far down and then misreport every later " +
    "distribution.",
  source: ECFR_1368_2,
};

/**
 * The AAA ordering rule, the sibling of §1.1367-1(f).
 */
export const REG_1_1368_2_A_5_AAA_ORDERING: GuidanceAuthority = {
  id: "REG_1_1368_2_A_5_AAA_ORDERING",
  kind: "regulation",
  cite: "26 CFR §1.1368-2(a)(5)",
  quote:
    "For any taxable year of the S corporation beginning on or after August 18, 1998, the " +
    "adjustments to the AAA are made in the following order— (i) The AAA is increased under " +
    "paragraph (a)(2) of this section before it is decreased under paragraph (a)(3)(i) of this " +
    "section for the taxable year; (ii) The AAA is decreased under paragraph (a)(3)(i) of this " +
    "section (without taking into account any net negative adjustment (as defined in section " +
    "1368(e)(1)(C)(ii)) before it is decreased under paragraph (a)(3)(iii) of this section; (iii) " +
    "The AAA is decreased (but not below zero) by any portion of an ordinary distribution to which " +
    "section 1368(b) or (c)(1) applies; (iv) The AAA is decreased by any net negative adjustment (as " +
    "defined in section 1368(e)(1)(C)(ii)); and (v) The AAA is adjusted (whether negative or " +
    "positive) for redemption distributions under paragraph (d)(1) of this section.",
  soWhat:
    "Compare this list to the basis ordering rule and notice they are NOT the same shape. For basis, " +
    "distributions come second, ahead of expenses and losses. For AAA, losses and expenses come " +
    "second and distributions come THIRD — except that if the year is a net loss year, that net " +
    "negative adjustment is skipped over and applied last, at step (iv), after the distribution has " +
    "been measured. That skip is a deliberate kindness: a bad year does not retroactively poison the " +
    "distributions you already took. Two different orderings for two different accounts is exactly " +
    "the sort of thing a human doing this by hand gets wrong, and exactly why it belongs in code " +
    "with the rule quoted next to it.",
  source: ECFR_1368_2,
};

// ---------------------------------------------------------------------------
// 6) THE ONE-CLASS-OF-STOCK QUESTION — surfaced, and stated accurately
// ---------------------------------------------------------------------------

/**
 * The statutory requirement itself.
 */
export const IRC_1361_B_1_D_ONE_CLASS: GuidanceAuthority = {
  id: "IRC_1361_B_1_D_ONE_CLASS",
  kind: "statute",
  cite: "26 U.S.C. §1361(b)(1)(D)",
  // Quoted whole rather than jumping straight to (D). The other three
  // conditions are the ones Greenway must also keep satisfying, and a quote
  // that shows only the clause of the moment invites forgetting them.
  quote:
    "For purposes of this subchapter, the term \"small business corporation\" means a domestic " +
    "corporation which is not an ineligible corporation and which does not— (A) have more than 100 " +
    "shareholders, (B) have as a shareholder a person (other than an estate, a trust described in " +
    "subsection (c)(2), or an organization described in subsection (c)(6)) who is not an individual, " +
    "(C) have a nonresident alien as a shareholder, and (D) have more than 1 class of stock.",
  soWhat:
    "This is the tripwire under every S corporation, and tripping it is catastrophic rather than " +
    "merely expensive: the S election terminates and the company is taxed as a C corporation, " +
    "retroactively. For a §280E business that is the worst tax outcome available. It is short, it is " +
    "absolute, and the interesting question is entirely in what \"class of stock\" means — which the " +
    "next authority answers, and answers more narrowly than most people assume.",
  source: LII_1361,
};

/**
 * The operative test, and the reason a disproportionate distribution is a
 * QUESTION rather than an automatic disaster.
 */
export const REG_1_1361_1_L_1_IDENTICAL_RIGHTS: GuidanceAuthority = {
  id: "REG_1_1361_1_L_1_IDENTICAL_RIGHTS",
  kind: "regulation",
  cite: "26 CFR §1.1361-1(l)(1)",
  quote:
    "A corporation that has more than one class of stock does not qualify as a small business " +
    "corporation. Except as provided in paragraph (l)(4) of this section (relating to instruments, " +
    "obligations, or arrangements treated as a second class of stock), a corporation is treated as " +
    "having only one class of stock if all outstanding shares of stock of the corporation confer " +
    "identical rights to distribution and liquidation proceeds. Differences in voting rights among " +
    "shares of stock of a corporation are disregarded in determining whether a corporation has more " +
    "than one class of stock.",
  soWhat:
    "The test is about RIGHTS, not about what actually got paid. If every share carries the same " +
    "right to distributions and to liquidation proceeds, there is one class of stock — full stop. " +
    "Voting differences are explicitly ignored. So the question the software must ask is not \"were " +
    "the cheques proportionate\" but \"do the governing documents give everyone identical rights.\" " +
    "That is a documents question, and the software does not have your documents.",
  source: ECFR_1361_1,
};

/**
 * The sentence that decides how loudly the engine should speak. It is
 * quoted in full because the second half is what most summaries drop.
 */
export const REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS: GuidanceAuthority = {
  id: "REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS",
  kind: "regulation",
  cite: "26 CFR §1.1361-1(l)(2)(i)",
  quote:
    "The determination of whether all outstanding shares of stock confer identical rights to " +
    "distribution and liquidation proceeds is made based on the corporate charter, articles of " +
    "incorporation, bylaws, applicable state law, and binding agreements relating to distribution " +
    "and liquidation proceeds (collectively, the governing provisions). A commercial contractual " +
    "agreement, such as a lease, employment agreement, or loan agreement, is not a binding agreement " +
    "relating to distribution and liquidation proceeds and thus is not a governing provision unless " +
    "a principal purpose of the agreement is to circumvent the one class of stock requirement of " +
    "section 1361(b)(1)(D) and this paragraph (l). Although a corporation is not treated as having " +
    "more than one class of stock so long as the governing provisions provide for identical " +
    "distribution and liquidation rights, any distributions (including actual, constructive, or " +
    "deemed distributions) that differ in timing or amount are to be given appropriate tax effect in " +
    "accordance with the facts and circumstances.",
  soWhat:
    "This is the authority that keeps the system honest in BOTH directions, which is why it is " +
    "quoted to the end. It does NOT say unequal distributions terminate your S election — the " +
    "regulation's own Example 2 has one shareholder paid a year before the other and concludes there " +
    "is still one class of stock. But the last sentence refuses to let it go entirely: unequal " +
    "distributions \"are to be given appropriate tax effect,\" meaning they get recharacterised as " +
    "something — a loan, compensation, a gift. So the honest output for Greenway is neither \"fine\" " +
    "nor \"your election is dead.\" It is: your governing documents decide the class question, and " +
    "the gap between 85/10/5 and what was actually paid still has to be characterised. Both halves " +
    "get reported.",
  source: ECFR_1361_1,
};

// ---------------------------------------------------------------------------
// 7) EXPORTS
// ---------------------------------------------------------------------------

/** Everything this slice ADDS to the registry. */
export const BASIS_AAA_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  IRC_1366_D_LOSS_LIMITATION,
  IRC_1366_D_2_CARRYOVER,
  REG_1_1367_1_C_2_NONCAPITAL_NONDEDUCTIBLE,
  REG_1_1367_1_F_ORDERING,
  REG_1_1367_1_G_ELECTIVE_ORDERING,
  REG_1_1367_2_B_1_DEBT_REDUCTION,
  REG_1_1367_2_C_1_DEBT_RESTORATION,
  REG_1_1368_2_A_1_AAA_NOT_APPORTIONED,
  REG_1_1368_2_A_3_II_BELOW_ZERO,
  REG_1_1368_2_A_3_III_DISTRIBUTIONS_NOT_BELOW_ZERO,
  REG_1_1368_2_A_5_AAA_ORDERING,
  IRC_1361_B_1_D_ONE_CLASS,
  REG_1_1361_1_L_1_IDENTICAL_RIGHTS,
  REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS,
] as const;

export function findBasisAaaAuthority(id: string): GuidanceAuthority | undefined {
  return BASIS_AAA_AUTHORITIES_NEW.find((a) => a.id === id);
}

/**
 * Authorities this slice CITES but does NOT own.
 *
 * Every id was verified to resolve in the shared registry. A test asserts they
 * still do, so deleting one elsewhere fails loudly here rather than silently
 * turning a cited rule into a dead string.
 */
export const BASIS_AAA_AUTHORITY_IDS_OWNED_ELSEWHERE: readonly string[] = [
  "IRC_1367_STOCK_BASIS_ADJUSTMENTS",
  "IRC_1368_DISTRIBUTIONS_AAA",
  "IRC_280E",
] as const;
