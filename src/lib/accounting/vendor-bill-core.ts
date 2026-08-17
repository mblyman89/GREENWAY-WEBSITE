/**
 * src/lib/accounting/vendor-bill-core.ts — Slice 3: vendor bills reach the ledger.
 *
 * PURE. No I/O, no database, no Supabase client, no clock, no `Date.now()`.
 * Every function is a total function of its arguments, so the whole §280E
 * decision surface can be swept and attacked in milliseconds.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * Greenway already had a lot of accounts-payable machinery before this slice:
 *
 *   * `public.vendors` + `vendor_aliases`  (0003) — who we buy from
 *   * `inbound_manifests`                  (0023) — cannabis transfers in
 *   * `noncannabis_invoices` + lines       (0112) — everything else
 *   * `vendor_manifest_payments`           (0067/0068) — what we paid
 *   * `payee_banking_vault`                (0143) — how we pay it
 *   * `/admin/vendor-payments/*`                  — the screens
 *
 * NOT ONE OF THOSE REACHED THE GENERAL LEDGER. Money went out of the building
 * and the books never heard about it. That is the identical failure that produced
 * "20009 LAZY INVENTORY ENTRY" holding +4,624,697.31 in Sage: when there is no
 * governed path from a document to a journal, somebody invents an ungoverned one.
 *
 * So this module does exactly one thing, and does it completely: it turns a
 * VENDOR BILL into a BALANCED, CLASSIFIED, CITED journal entry — or it refuses
 * and says why, in plain English, with the correct alternative spelled out.
 *
 * ============================================================================
 * THE ONE TAX IDEA THAT DECIDES EVERYTHING
 * ============================================================================
 * Greenway is a RESELLER (a retailer). It buys finished cannabis product from
 * licensed producers/processors and sells it. It does not grow and it does not
 * process. That single fact controls the entire tax analysis, because:
 *
 *   * §280E disallows DEDUCTIONS.
 *   * COST OF GOODS SOLD IS NOT A DEDUCTION. It is a subtraction made while
 *     computing gross income (Reg. §1.61-3(a)), so §280E never reaches it.
 *   * What may enter COGS for a reseller is fixed by Reg. §1.471-3(b): the
 *     invoice price less trade discounts, PLUS the cost of acquiring possession.
 *
 * Therefore, for every dollar Greenway pays a vendor, there is exactly one
 * question worth asking, and it is NOT "is this deductible?" — it is:
 *
 *        "Is this dollar part of the cost of getting saleable goods
 *         onto my shelf, or is it a cost of running a store?"
 *
 * Cost of getting goods on the shelf  → INVENTORY → COGS when sold → SURVIVES.
 * Cost of running the store           → operating expense          → DISALLOWED.
 *
 * The dividing line is drawn at the moment the bill is entered, by the person
 * holding the paper, with the reason recorded. It is never reconstructed in
 * April from a bank statement, because that reconstruction is an argument rather
 * than a record, and the taxpayer carries the burden of substantiation
 * (§6001; *Alterman*).
 *
 * ============================================================================
 * WHAT THIS MODULE DELIBERATELY REFUSES TO DO
 * ============================================================================
 * Michael asked for a system that is powerful AND holds his hand. The tempting
 * design is a classifier that silently books whatever it thinks is right. That
 * is rejected. A cost class is a TAX POSITION, and a tax position that nobody
 * chose is a tax position nobody can defend. So:
 *
 *   * The engine PROPOSES, with a confidence band and a citation.
 *   * A human ACCEPTS, and the acceptance is what gets recorded.
 *   * Anything the engine is not sure about lands in a quarantine account that
 *     is impossible to ignore, rather than a plausible-looking wrong account
 *     that is impossible to notice. (This is the whole lesson of 20009.)
 *
 * MONEY RULE (standing): integer CENTS. No floats, ever.
 * RATE RULE (standing): integer MILLI-PERCENT (85% = 85000).
 * CLOCK RULE (standing): Pacific is the business day; this module takes dates
 *   as ISO strings and never asks the host what time it is.
 */

import type { CostClass, EntityCode } from "./ledger-core";

// ===========================================================================
// 1) AUTHORITIES — verbatim, quoted, attributed.
// ===========================================================================
/**
 * Michael asked for "verbatim text with regard to policy regulation tax GAAP."
 * This is that. Every finding this module emits points at one of these entries,
 * so the reason a dollar landed where it landed is always traceable to a source
 * he (or his grandfather, or an examiner) can pull and read.
 *
 * RULE FOR MAINTAINERS: `quote` fields are TRANSCRIPTIONS. Do not paraphrase,
 * tidy, modernise, or "fix" them. A drift test asserts their exact content. If a
 * quote is wrong, fix it against the primary source and update the test — never
 * the other way around.
 */
export type AuthorityKind = "statute" | "regulation" | "case" | "irs_guidance" | "gaap" | "state_law";

export type Authority = {
  /** Stable key used by findings and by the UI. */
  id: string;
  kind: AuthorityKind;
  /** Formal citation as it would appear in a memo. */
  cite: string;
  /** VERBATIM text. Transcribed, never paraphrased. */
  quote: string;
  /** Why this matters to Greenway specifically, in Michael's language. */
  soWhat: string;
  /** Where to read it. */
  source: string;
};

export const AUTHORITIES: readonly Authority[] = [
  {
    id: "IRC_280E",
    kind: "statute",
    cite: "26 U.S.C. §280E",
    quote:
      "No deduction or credit shall be allowed for any amount paid or incurred during the taxable year " +
      "in carrying on any trade or business if such trade or business (or the activities which comprise " +
      "such trade or business) consists of trafficking in controlled substances (within the meaning of " +
      "schedule I and II of the Controlled Substances Act) which is prohibited by Federal law or the law " +
      "of any State in which such trade or business is conducted.",
    soWhat:
      "This is the whole problem in one sentence. Read it closely: it kills DEDUCTIONS and CREDITS. " +
      "It says nothing about cost of goods sold — and that silence is the only room you have to work in.",
    source: "26 U.S.C. §280E (Tax Equity and Fiscal Responsibility Act of 1982, Pub. L. No. 97-248, §351).",
  },
  {
    id: "SENATE_REPORT_97_494",
    kind: "statute",
    cite: "S. Rep. No. 97-494, at 309 (1982)",
    quote:
      "All deductions and credits for amounts paid or incurred in the illegal trafficking in drugs listed " +
      "in the Controlled Substances Act are disallowed. To preclude possible challenges on constitutional " +
      "grounds, the adjustment to gross receipts with respect to effective costs of goods sold is not " +
      "affected by this provision of the bill.",
    soWhat:
      "This is Congress itself saying COGS is off-limits to §280E, and saying WHY: taxing gross receipts " +
      "with no allowance for what the goods cost you might not be an income tax at all. Your COGS is not a " +
      "loophole somebody found — it is a carve-out Congress wrote on purpose.",
    source: "Senate Finance Committee report accompanying TEFRA 1982, reprinted at 1982 U.S.C.C.A.N. 781, 1050.",
  },
  {
    id: "REG_1_471_3_B",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(b)",
    quote:
      "In the case of merchandise purchased since the beginning of the taxable year, the invoice price less " +
      "trade or other discounts, except strictly cash discounts approximating a fair interest rate, which " +
      "may be deducted or not at the option of the taxpayer, provided a consistent course is followed. To " +
      "this net invoice price should be added transportation or other necessary charges incurred in " +
      "acquiring possession of the goods.",
    soWhat:
      "THIS IS YOUR RULE. You are a reseller, so this subsection — not the producer subsection — is the one " +
      "that governs your COGS. It gives you three things: (1) the invoice price, (2) minus trade discounts, " +
      "(3) PLUS transportation and other charges to get possession. That last clause is why inbound freight " +
      "goes to 60800 and capitalises instead of being expensed away.",
    source: "26 C.F.R. §1.471-3(b), Inventories at cost — merchandise purchased.",
  },
  {
    id: "REG_1_471_3_C",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(c)",
    quote:
      "In the case of merchandise produced by the taxpayer since the beginning of the taxable year, (1) the " +
      "cost of raw materials and supplies entering into or consumed in connection with the product, (2) " +
      "expenditures for direct labor, (3) indirect production costs incident to and necessary for the " +
      "production of the particular article, including in such indirect production costs an appropriate " +
      "portion of management expenses, but not including any cost of selling or return on capital, whether " +
      "by way of interest or profit.",
    soWhat:
      "This is the PRODUCER rule, and it is much more generous — it lets in labour and overhead. It is not " +
      "yours. Anyone who tells you a dispensary can capitalise its budtender wages under this subsection is " +
      "quoting the wrong paragraph, and Harborside is what happens next.",
    source: "26 C.F.R. §1.471-3(c), Inventories at cost — merchandise produced.",
  },
  {
    id: "REG_1_61_3_A",
    kind: "regulation",
    cite: "26 C.F.R. §1.61-3(a)",
    quote:
      "In a manufacturing, merchandising, or mining business, \"gross income\" means the total sales, less " +
      "the cost of goods sold, plus any income from investments and from incidental or outside operations " +
      "or sources.",
    soWhat:
      "The structural reason COGS survives §280E. Gross income is ALREADY net of COGS — the subtraction " +
      "happens before you ever get to the deductions §280E attacks. COGS is not a deduction you claim; it " +
      "is part of measuring what your income even is.",
    source: "26 C.F.R. §1.61-3(a), Gross income derived from business.",
  },
  {
    id: "REG_1_162_1_A",
    kind: "regulation",
    cite: "26 C.F.R. §1.162-1(a)",
    quote:
      "The cost of goods purchased for resale, with proper adjustment for opening and closing inventories, " +
      "is deducted from gross sales in computing gross income.",
    soWhat:
      "Says the same thing from the expense side: goods bought for resale come off gross SALES, not out of " +
      "the deduction bucket. Two independent regulations pointing the same direction is a strong position.",
    source: "26 C.F.R. §1.162-1(a), Business expenses.",
  },
  {
    id: "IRC_263A_FLUSH",
    kind: "statute",
    cite: "26 U.S.C. §263A(a)(2) (flush language)",
    quote:
      "Any cost which (but for this subsection) could not be taken into account in computing taxable income " +
      "for any taxable year shall not be treated as a cost described in this paragraph.",
    soWhat:
      "This is the trap door. §263A normally sweeps extra costs into inventory, and it is tempting to use it " +
      "to rescue disallowed expenses. This sentence slams it shut: if §280E already killed the cost, §263A " +
      "cannot resurrect it by relabelling it inventory. Anyone selling you that strategy is selling you an " +
      "adjustment plus penalties.",
    source: "26 U.S.C. §263A(a)(2), final sentence.",
  },
  {
    id: "CCA_201504011",
    kind: "irs_guidance",
    cite: "I.R.S. Chief Counsel Advice 201504011 (Jan. 23, 2015)",
    quote:
      "Section 263A is a timing provision. It does not change the character of any expense from " +
      "\"nondeductible\" to \"deductible,\" or vice versa.",
    soWhat:
      "The IRS's own stated position, and the one an examiner will arrive holding. Read with the sentence " +
      "above: a §280E taxpayer computes COGS under §471 as it stood in 1982, and §263A does not widen it. " +
      "Our engine follows the IRS's position deliberately — being right and audited is still expensive.",
    source: "I.R.S. Chief Couns. Adv. 201504011; cited in IRS Cannabis Industry FAQ (Apr. 25, 2025).",
  },
  {
    id: "IRS_CANNABIS_FAQ",
    kind: "irs_guidance",
    cite: "IRS, Cannabis Industry Frequently Asked Questions (Apr. 25, 2025)",
    quote:
      "The Internal Revenue Service takes the position that section 280E-affected taxpayers must calculate " +
      "their cost of goods sold pursuant to Internal Revenue Code section 471 and the associated Treasury " +
      "Regulations. Generally, this means taxpayers who sell marijuana may reduce their gross receipts by " +
      "the cost of acquiring or producing marijuana that they sell, and those costs will depend on the " +
      "nature of the business.",
    soWhat:
      "\"THE COST OF ACQUIRING\" — that is you. And \"those costs will depend on the nature of the business\" " +
      "is the IRS telling you that being a reseller rather than a grower changes your answer. It does.",
    source: "https://www.irs.gov/businesses/small-businesses-self-employed/cannabis-industry-frequently-asked-questions",
  },
  {
    id: "CHAMP",
    kind: "case",
    cite: "Californians Helping to Alleviate Med. Problems, Inc. v. Comm'r, 128 T.C. 173 (2007)",
    quote:
      "Section 280E and its legislative history express a congressional intent to disallow deductions " +
      "attributable to a trade or business of trafficking in controlled substances.",
    soWhat:
      "CHAMP is the good news case: the court let the taxpayer split ONE business into TWO, and deduct the " +
      "expenses of the non-cannabis one. That is precisely why your ATM operation and the Geiger rental are " +
      "kept in separate entities with their own books. Real separation is worth real money.",
    source: "128 T.C. 173, 181-86 (2007).",
  },
  {
    id: "CHAMP_TRAFFICKING",
    kind: "case",
    cite: "Alternative Health Care Advocates v. Comm'r, 151 T.C. 225, 236-37 (2018)",
    quote:
      "In [Californians Helping to Alleviate Medical Problems], we defined \"trafficking\" as the act of " +
      "engaging in a commercial activity — that is, to buy and sell regularly.",
    soWhat:
      "\"Buy and sell regularly\" is the definition, and it is you — which is why arguing you are not a " +
      "trafficker is a dead end. The winning ground is COGS and genuine separate businesses, not " +
      "definitional games.",
    source: "151 T.C. 225, 236-37 (2018).",
  },
  {
    id: "HARBORSIDE",
    kind: "case",
    cite: "Patients Mut. Assistance Collective Corp. v. Comm'r, 151 T.C. 176 (2018), aff'd 995 F.3d 671 (9th Cir. 2021)",
    quote:
      "Harborside dedicated the lion's share of its resources to selling marijuana and marijuana products. " +
      "Those sales accounted for over 99.5% of its revenue. Its other activities were neither economically " +
      "separate nor substantially different. We therefore hold that Harborside had a single trade or " +
      "business — the sale of marijuana.",
    soWhat:
      "The cautionary case, and the reason the engine is strict. Harborside sold t-shirts and lost anyway, " +
      "because a token side activity is not a separate business. It was also held to be a RESELLER, limited " +
      "to §471(a) costs. If you ever want a real second business inside Greenway, it needs its own revenue, " +
      "its own economics, and its own records — not a shelf of merch.",
    source: "151 T.C. 176, 204 (2018), aff'd, 995 F.3d 671 (9th Cir. 2021).",
  },
  {
    id: "ALTERMAN_COGS_FORMULA",
    kind: "case",
    cite: "Alterman v. Comm'r, T.C. Memo. 2018-83",
    quote:
      "Properly computed, cost of goods sold equals[:] the cost of merchandise on hand at the beginning of " +
      "the taxable year ('beginning inventory'), [26 C.F.R. §] 1.471-3(a)[;] plus the cost of merchandise " +
      "purchased since the beginning of the taxable year ('purchase costs'), [26 C.F.R. § 1.471-3](b)[;] " +
      "plus the direct and indirect cost of producing merchandise ('production costs'), [26 C.F.R. §§ " +
      "1.471-3](c), 1.471-11[;] minus the cost of inventory on hand at the end of the tax year ('ending " +
      "inventory'), [26 C.F.R. §] 1.471-1. Inventories must be recorded in a legible manner, properly " +
      "computed and summarized, and these inventory records must be preserved by the taxpayer.",
    soWhat:
      "The actual arithmetic of COGS, from a court, plus the sting in the tail: your inventory RECORDS have " +
      "to exist and be preserved. Our subledger and lot tracking is not bookkeeping neatness — it is the " +
      "evidence that makes the number claimable.",
    source: "Alterman v. Comm'r, T.C. Memo. 2018-83, 2018 WL 2980049, at *11.",
  },
  {
    id: "ALPENGLOW_EXCLUSION",
    kind: "case",
    cite: "Alpenglow Botanicals, LLC v. United States, 894 F.3d 1187 (10th Cir. 2018)",
    quote:
      "The cost of goods sold is a well-recognized exclusion from the calculation of gross income, while " +
      "ordinary and necessary business expenses are deductions.",
    soWhat:
      "A federal appeals court drawing the exact line this module is built on. EXCLUSION versus DEDUCTION. " +
      "Every classification decision here is really just deciding which side of that sentence a dollar is on.",
    source: "894 F.3d 1187, 1200 (10th Cir. 2018), cert. denied, 588 U.S. 907 (2019).",
  },
  {
    id: "RODRIGUEZ_NOT_A_DEDUCTION",
    kind: "case",
    cite: "Reading v. Comm'r, 70 T.C. 730 (1978), aff'd 614 F.2d 159 (8th Cir. 1980)",
    quote:
      "expenditures necessary to acquire, construct or extract a physical product which is to be sold",
    soWhat:
      "The courts' working definition of COGS. Notice every word is about the PRODUCT — acquire, construct, " +
      "extract. Nothing about selling it, marketing it, or keeping the lights on above it. That is the test " +
      "to apply when you are unsure: did this dollar touch the product before it hit the shelf?",
    source: "70 T.C. 730, 733 (1978); accord Lord v. Comm'r, T.C. Memo. 2022-14 (\"COGS is the cost of acquiring inventory, through either production or purchase.\").",
  },
  {
    id: "IRC_6001_SUBSTANTIATION",
    kind: "statute",
    cite: "26 U.S.C. §6001",
    quote:
      "Every person liable for any tax imposed by this title, or for the collection thereof, shall keep such " +
      "records, render such statements, make such returns, and comply with such rules and regulations as " +
      "the Secretary may from time to time prescribe.",
    soWhat:
      "The burden is on YOU to prove the number, not on the IRS to disprove it. This is why the engine will " +
      "not let a bill post without an invoice number and a vendor: an unsupported COGS figure is a figure " +
      "you lose on examination even when it is true.",
    source: "26 U.S.C. §6001; see also 26 C.F.R. §1.6001-1.",
  },
  {
    id: "ASC_330_10_30_1",
    kind: "gaap",
    cite: "FASB ASC 330-10-30-1 (Inventory — Initial Measurement)",
    quote:
      "The primary basis of accounting for inventories is cost, which has been defined generally as the " +
      "price paid or consideration given to acquire an asset. As applied to inventories, cost means in " +
      "principle the sum of the applicable expenditures and charges directly or indirectly incurred in " +
      "bringing an article to its existing condition and location.",
    soWhat:
      "The GAAP side, and the happy news: \"bringing an article to its existing condition and location\" " +
      "means GAAP and the tax rule are pointing the same way on freight-in. Your books can be right for the " +
      "bank and right for the IRS with ONE number, which is exactly what you want when your grandfather is " +
      "no longer here to reconcile two sets of thinking.",
    source: "FASB Accounting Standards Codification Topic 330, Inventory.",
  },
  {
    id: "IRC_448C_2026",
    kind: "statute",
    cite: "26 U.S.C. §448(c); Rev. Proc. 2025-32 §4.30",
    quote:
      "For taxable years beginning in 2026, a corporation or partnership meets the gross receipts test of " +
      "section 448(c) if its average annual gross receipts for the prior three-year period does not exceed " +
      "$32,000,000.",
    soWhat:
      "Greenway is far under $32,000,000, so it IS a small business taxpayer and §471(c) is technically " +
      "available. Some advisers push §471(c) as a §280E workaround. We do NOT build on it — see " +
      "CCA_202114019 below. The threshold is recorded here so the decision is informed rather than assumed.",
    source: "Rev. Proc. 2025-32, §4.30 (inflation-adjusted §448(c) amount for 2026).",
  },
  {
    id: "CCA_202114019",
    kind: "irs_guidance",
    cite: "I.R.S. Chief Counsel Advice 202114019 (Jan. 23, 2021)",
    quote:
      "[B]ecause Taxpayer is not using a method of accounting described in section 471(c) of the Code, this " +
      "Chief Counsel Advice neither expresses nor implies any opinion about what costs would be permitted or " +
      "required to be capitalized to the goods had Taxpayer applied the rules under section 471(c).",
    soWhat:
      "The IRS pointedly declining to bless §471(c) for cannabis. That is not permission — it is an open " +
      "question with your money on it. The engine therefore computes COGS the §471(a)/§1.471-3(b) way, " +
      "which is the position the IRS has actually stated. If you and your CPA later elect §471(c), that is a " +
      "documented owner decision, not a silent default the software chose for you.",
    source: "I.R.S. Chief Couns. Adv. 202114019.",
  },
  {
    id: "RCW_69_50_535",
    kind: "state_law",
    cite: "RCW 69.50.535(1)(a)",
    quote:
      "There is levied and collected a cannabis excise tax equal to thirty-seven percent of the selling " +
      "price on each retail sale in this state of cannabis concentrates, useable cannabis, and " +
      "cannabis-infused products. This tax is separate and in addition to general state and local sales and " +
      "use taxes that apply to retail sales of tangible personal property, and is not part of the total " +
      "retail price to which general state and local sales and use taxes apply.",
    soWhat:
      "The 37% you collect is the STATE'S money passing through your till. It is a liability (32000), never " +
      "revenue and never an expense. Booking it anywhere else is what created the twelve-year excise mess " +
      "in Sage — cleared by crediting REVENUE, which overstated income and hid the hole at the same time.",
    source: "RCW 69.50.535; see also WAC 314-55-089.",
  },
] as const;

/** Look up an authority by id. Returns undefined for an unknown id. */
export function findAuthority(id: string): Authority | undefined {
  return AUTHORITIES.find((a) => a.id === id);
}

/**
 * Render one or more authorities as a citation string for a finding.
 * Unknown ids are dropped rather than silently rendered as "undefined" — a
 * finding with a broken citation is worse than one with none, because Michael
 * would go looking for a source that does not exist.
 */
export function citeAuthorities(ids: readonly string[]): string {
  const parts: string[] = [];
  for (const id of ids) {
    const a = findAuthority(id);
    if (a) parts.push(a.cite);
  }
  return parts.join("; ");
}

// ===========================================================================
// 2) THE PURCHASE TAXONOMY — what Greenway actually buys.
// ===========================================================================
/**
 * Every line on every vendor bill is one of these kinds. The list is closed on
 * purpose: an open-ended "other" field is how 511 of 595 purchase lines ended up
 * in one junk account. If something genuinely new arrives, it gets added here,
 * with a citation, in a reviewed change — not typed into a free-text box at
 * 11pm.
 *
 * `treatment` is the §280E answer:
 *   inventory  — capitalises into inventory, becomes COGS when sold. SURVIVES.
 *   expense    — operating cost of the cannabis trade. DISALLOWED by §280E.
 *   asset      — long-lived property; capitalise and depreciate (still §280E
 *                on the depreciation, but the basis is real and follows the asset).
 *   trust      — somebody else's money passing through. Never P&L at all.
 *   quarantine — the engine will not guess. A human decides.
 */
export type PurchaseTreatment = "inventory" | "expense" | "asset" | "trust" | "quarantine";

export type PurchaseKind = {
  /** Stable code, used in the DB and by tests. */
  code: string;
  /** What Michael would call it. */
  label: string;
  treatment: PurchaseTreatment;
  /** Account this posts to for the greenway entity. Verified against 0173/0178. */
  debitAccountCode: string;
  /** The §280E class the line carries. Must agree with the account's rules. */
  costClass: CostClass;
  /** Authority ids justifying the treatment. Never empty. */
  authorityIds: readonly string[];
  /** Plain-English WHY, written for Michael. */
  why: string;
  /**
   * The trap: the plausible-but-wrong place this cost often gets booked, and
   * what it costs. Populated where a real trap exists.
   */
  commonMistake?: string;
  /** True when this kind is cannabis product itself (drives category mapping). */
  isCannabisProduct?: boolean;
};

/**
 * ORDERED, closed taxonomy. Account codes are cross-checked against migration
 * 0173/0178 by a self-test below, so a typo here fails the gate rather than
 * silently creating a phantom account reference.
 */
export const PURCHASE_KINDS: readonly PurchaseKind[] = [
  // ---------------------------------------------------------------- inventory
  {
    code: "cannabis_product",
    label: "Cannabis product for resale",
    treatment: "inventory",
    debitAccountCode: "20000", // control; the category subaccount is resolved per line
    costClass: "none", // balance-sheet line: no 280E character until it becomes COGS
    authorityIds: ["REG_1_471_3_B", "IRS_CANNABIS_FAQ", "REG_1_61_3_A"],
    why:
      "This is the invoice price of goods you will resell. Under Reg. §1.471-3(b) it is the core of your " +
      "inventory cost, and it becomes COGS when the product sells — which is the one big number §280E " +
      "cannot touch.",
    commonMistake:
      "Expensing the purchase when you pay for it. That overstates this year's cost, understates inventory, " +
      "and destroys the beginning/ending inventory figures the COGS formula in Alterman depends on.",
    isCannabisProduct: true,
  },
  {
    code: "freight_in",
    label: "Inbound freight / delivery on a purchase",
    treatment: "inventory",
    debitAccountCode: "60800",
    costClass: "cogs_direct",
    authorityIds: ["REG_1_471_3_B", "ASC_330_10_30_1"],
    why:
      "Reg. §1.471-3(b) says it in so many words: \"To this net invoice price should be added transportation " +
      "or other necessary charges incurred in acquiring possession of the goods.\" Freight to GET the goods " +
      "is part of what the goods cost. GAAP agrees (ASC 330: cost includes bringing the article to its " +
      "existing condition and location), so one number serves both sets of books.",
    commonMistake:
      "Dropping delivery fees into 76030 Postage & Shipping. That converts a cost §280E cannot reach into " +
      "one it disallows outright — you pay tax on a dollar you were entitled to keep. Outbound shipping IS " +
      "76030; inbound on a purchase is 60800.",
  },
  {
    code: "purchase_discount",
    label: "Trade discount received from a vendor",
    treatment: "inventory",
    debitAccountCode: "60900", // contra-COGS; carries a CREDIT in practice
    costClass: "cogs_direct",
    authorityIds: ["REG_1_471_3_B"],
    why:
      "A trade discount REDUCES inventoriable cost — \"the invoice price less trade or other discounts.\" It " +
      "is not income. Booking it as income inflates both revenue and COGS and makes gross margin " +
      "meaningless.",
    commonMistake:
      "Booking vendor discounts to a revenue account. Note the regulation's careful exception for " +
      "\"strictly cash discounts approximating a fair interest rate,\" which you may elect to treat " +
      "differently — but you must follow \"a consistent course.\" Pick one treatment and never drift.",
  },
  {
    code: "product_packaging",
    label: "Packaging that goes out with the product",
    treatment: "inventory",
    debitAccountCode: "60800",
    costClass: "cogs_direct",
    authorityIds: ["REG_1_471_3_B", "ASC_330_10_30_1"],
    why:
      "Packaging that becomes part of what the customer carries out is a cost of putting saleable goods on " +
      "the shelf, not a cost of running the store. Exit bags required by WSLCB before a product can legally " +
      "leave are the clearest example.",
    commonMistake:
      "Sweeping all packaging into 76020 Store Supplies. Register tape and cleaning supplies belong there; " +
      "the child-resistant exit bag that legally must accompany the product does not. Split the invoice.",
  },
  {
    code: "testing_on_purchase",
    label: "Lab testing required to receive specific goods",
    treatment: "quarantine",
    debitAccountCode: "20890", // Inventory — UNCLASSIFIED (quarantine)
    costClass: "none",
    authorityIds: ["REG_1_471_3_B", "IRC_263A_FLUSH", "CCA_201504011"],
    why:
      "This one is genuinely unsettled, so the engine refuses to pretend. If YOU paid for a test that was " +
      "necessary to take possession of a specific lot, there is a real §1.471-3(b) argument that it is a " +
      "\"necessary charge incurred in acquiring possession.\" If it is routine compliance testing of goods " +
      "you already own, it looks like an operating cost §280E disallows.",
    commonMistake:
      "Picking whichever answer is more favourable and never writing down why. The position is defensible " +
      "either way with contemporaneous reasoning and indefensible without it (§6001). Decide per lot, in " +
      "writing, and be consistent.",
  },
  // ------------------------------------------------------------------ expense
  {
    code: "rent",
    label: "Rent",
    treatment: "expense",
    debitAccountCode: "70010",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E", "CHAMP", "REG_1_471_3_C"],
    why:
      "Rent on a retail store is a cost of carrying on the business, not a cost of acquiring goods. §280E " +
      "disallows it. Note that even the generous PRODUCER rule in §1.471-3(c) reaches only production " +
      "overhead — and it explicitly excludes \"any cost of selling.\"",
    commonMistake:
      "Allocating store rent to COGS by square footage. That is a producer/§263A move, and §263A(a)(2)'s " +
      "flush language plus CCA 201504011 shut it down for a reseller. It is one of the first things an " +
      "examiner tests.",
  },
  {
    code: "utilities",
    label: "Utilities",
    treatment: "expense",
    debitAccountCode: "70020",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "A cost of keeping the store open. Disallowed by §280E for the cannabis entity.",
  },
  {
    code: "security",
    label: "Security & alarm",
    treatment: "expense",
    debitAccountCode: "70050",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why:
      "Washington REQUIRES this (WAC 314-55), and it is still not deductible. That is genuinely unfair, and " +
      "it is also the law: §280E has no exception for costs the state forces you to incur.",
    commonMistake:
      "Assuming mandatory means deductible. It does not. Every §280E case where a taxpayer argued " +
      "\"but the state made me\" lost that point.",
  },
  {
    code: "professional_fees",
    label: "Accounting, legal & consulting",
    treatment: "expense",
    debitAccountCode: "74010",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why:
      "Professional fees for the cannabis business are disallowed. Worth knowing precisely because you are " +
      "buying advice about the tax you cannot deduct the advice against.",
  },
  {
    code: "software",
    label: "Software & subscriptions",
    treatment: "expense",
    debitAccountCode: "73010",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "Operating cost of the trade. Disallowed for greenway; genuinely deductible in the ATM/landholding entities.",
  },
  {
    code: "pos_traceability",
    label: "POS & traceability systems",
    treatment: "expense",
    debitAccountCode: "73020",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "Compliance software is an operating cost. Required, and still disallowed.",
  },
  {
    code: "advertising",
    label: "Advertising & promotion",
    treatment: "expense",
    debitAccountCode: "72010",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E", "REG_1_471_3_C"],
    why:
      "Selling cost — the one category every authority agrees can never be inventoried. §1.471-3(c) " +
      "excludes \"any cost of selling\" even for producers, so there is no route for a reseller.",
    commonMistake: "Treating menu-listing fees as a cost of the product. They sell the product; they are not part of it.",
  },
  {
    code: "store_supplies",
    label: "Store supplies (not product packaging)",
    treatment: "expense",
    debitAccountCode: "76020",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E", "REG_1_471_3_B"],
    why:
      "Register tape, cleaning supplies, bags that are a customer convenience rather than part of the " +
      "product. Store operation, not product cost.",
    commonMistake:
      "The reverse of the packaging trap: burying required exit packaging in here and losing an " +
      "inventoriable cost. If it must legally accompany the product, it is product_packaging.",
  },
  {
    code: "licences",
    label: "Licences & permits",
    treatment: "expense",
    debitAccountCode: "75010",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "The privilege of operating the business, not the cost of the goods.",
  },
  {
    code: "insurance",
    label: "Insurance",
    treatment: "expense",
    debitAccountCode: "76060",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "Operating cost. One insurance account only — the old chart had two both named INSURANCE.",
  },
  {
    code: "bank_fees",
    label: "Bank & cash-handling fees",
    treatment: "expense",
    debitAccountCode: "76040",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "Cost of banking a cash business. Disallowed for greenway.",
  },
  {
    code: "repairs",
    label: "Repairs & maintenance",
    treatment: "expense",
    debitAccountCode: "70030",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why:
      "A genuine repair keeps existing property working and is expensed. If it BETTERS or restores the " +
      "property, it is a capital improvement instead — see the capitalisation check below.",
  },
  {
    code: "waste_disposal",
    label: "Janitorial & waste removal",
    treatment: "expense",
    debitAccountCode: "70060",
    costClass: "nondeductible_280e",
    authorityIds: ["IRC_280E"],
    why: "Includes compliant cannabis waste disposal. Operating cost of the trade.",
  },
  // -------------------------------------------------------------------- asset
  {
    code: "equipment",
    label: "Equipment, fixtures & furniture",
    treatment: "asset",
    debitAccountCode: "21600",
    costClass: "none",
    authorityIds: ["IRC_280E"],
    why:
      "Something with a life beyond this year is an ASSET, not an expense. It goes on the balance sheet and " +
      "depreciates. §280E still disallows the depreciation for greenway, but the basis is real, it follows " +
      "the asset, and it matters on disposal and on any future rescheduling.",
    commonMistake:
      "Expensing a $6,000 display case because it feels like a store cost. That misstates the balance sheet " +
      "and throws away basis you may need later.",
  },
  {
    code: "leasehold_improvement",
    label: "Leasehold improvements",
    treatment: "asset",
    debitAccountCode: "21500",
    costClass: "none",
    authorityIds: ["IRC_280E"],
    why:
      "Improvements to premises you lease. Kept separate from building improvements because the recovery " +
      "period differs and a leasehold improvement can be abandoned when the lease ends.",
  },
  {
    code: "vehicle",
    label: "Vehicle",
    treatment: "asset",
    debitAccountCode: "21700",
    costClass: "none",
    authorityIds: ["IRC_280E"],
    why: "Capitalise and depreciate. WHICH vehicle is a dimension, never its own account.",
  },
  // -------------------------------------------------------------------- trust
  {
    code: "excise_remittance",
    label: "Cannabis excise remittance to WSLCB",
    treatment: "trust",
    debitAccountCode: "32000",
    costClass: "none",
    authorityIds: ["RCW_69_50_535"],
    why:
      "The 37% is never yours. Collecting it creates a liability in 32000 and paying it clears that " +
      "liability. It touches the P&L on neither leg.",
    commonMistake:
      "Booking excise as an expense (inflating disallowed costs) or clearing it against REVENUE. The second " +
      "is what happened in Sage for twelve years and it hid a multi-million-dollar hole.",
  },
  {
    code: "sales_tax_remittance",
    label: "Retail sales tax remittance to DOR",
    treatment: "trust",
    debitAccountCode: "32100",
    costClass: "none",
    authorityIds: ["RCW_69_50_535"],
    why: "Same logic as excise: collected for the state, held as a liability, paid out. Never P&L.",
  },
  // ---------------------------------------------------------------- quarantine
  {
    code: "unknown",
    label: "Not yet classified",
    treatment: "quarantine",
    debitAccountCode: "20890",
    costClass: "none",
    authorityIds: ["IRC_6001_SUBSTANTIATION"],
    why:
      "The engine could not tell what this is, so it says so LOUDLY instead of guessing. A visible " +
      "quarantine balance gets fixed; a plausible wrong account never does. This account exists because " +
      "\"20009 LAZY INVENTORY ENTRY\" was the alternative.",
    commonMistake:
      "Leaving a balance here past month end. Quarantine is a waiting room, not a home. The close checklist " +
      "in a later slice will refuse to close a period with anything sitting in it.",
  },
] as const;

export function findPurchaseKind(code: string): PurchaseKind | undefined {
  return PURCHASE_KINDS.find((k) => k.code === code);
}

/** All purchase kinds whose cost SURVIVES §280E (inventory → COGS). */
export function inventoriableKindCodes(): string[] {
  return PURCHASE_KINDS.filter((k) => k.treatment === "inventory").map((k) => k.code);
}

/** All purchase kinds §280E disallows. */
export function disallowedKindCodes(): string[] {
  return PURCHASE_KINDS.filter((k) => k.treatment === "expense").map((k) => k.code);
}

// ===========================================================================
// 3) DE MINIMIS / CAPITALISATION THRESHOLD
// ===========================================================================
/**
 * Treas. Reg. §1.263(a)-1(f) de minimis safe harbour. For a taxpayer WITHOUT an
 * applicable financial statement the ceiling is $2,500 per invoice (or per item
 * as substantiated by the invoice), and it requires an ELECTED written
 * accounting procedure in place at the start of the year.
 *
 * Kept at $2,500 = 250000 cents, matching DE_MINIMIS_CAPITALISATION_CENTS in
 * journal-advisor-core so the two engines cannot disagree. A self-test asserts
 * they stay equal, because two thresholds that drift apart mean the advisor
 * blesses what the bill engine refuses.
 */
export const DE_MINIMIS_CAPITALISATION_CENTS = 250000;

// ===========================================================================
// 4) INPUT TYPES — a bill as the application knows it.
// ===========================================================================

export type VendorBillLineInput = {
  /** 1-based line number as shown to the user. */
  lineNo: number;
  /** Purchase kind code from PURCHASE_KINDS, or null when unknown. */
  purchaseKindCode: string | null;
  /** Signed integer cents. POSITIVE = a cost to us. Negative = a credit/discount. */
  amountCents: number;
  /** Free text off the invoice. Used for keyword hints only, never for authority. */
  description?: string | null;
  /**
   * House inventory category slug for cannabis product lines (e.g. "flower").
   * Drives the 20xxx subaccount. Required when the kind is cannabis product.
   */
  categorySlug?: string | null;
};

export type VendorBillInput = {
  /** Which set of books. Only 'greenway' is exposed to §280E. */
  entityCode: EntityCode;
  /** Vendor display name as it appears on the paper. */
  vendorName: string;
  /** Resolved vendor id, when the name matched the vendor master. */
  vendorId?: string | null;
  /** The number printed on the vendor's invoice. Required for substantiation. */
  invoiceNumber: string;
  /** ISO yyyy-mm-dd, Pacific business day. */
  invoiceDate: string;
  /** Grand total in cents as printed on the invoice. */
  statedTotalCents: number;
  lines: readonly VendorBillLineInput[];
  /**
   * True when this bill came from an accepted inbound cannabis manifest, i.e.
   * the goods were physically received and recorded in the traceability system.
   */
  fromAcceptedManifest?: boolean;
  /** Manifest number when fromAcceptedManifest. Becomes the idempotency ref. */
  manifestNumber?: string | null;
};

// ===========================================================================
// 5) FINDINGS — pushback that teaches instead of just blocking.
// ===========================================================================
/**
 * Michael: "I really think it's smart to not just block, but explain why, and
 * even better, show me a way to do it properly."
 *
 * So every finding carries FOUR things, and the type will not let you omit the
 * important ones:
 *   concern   — what is wrong
 *   why       — the reasoning, in plain English
 *   fix       — the specific correct action (never "review this")
 *   authority — the source, so it can be checked and taken to his grandfather
 *
 * `severity`:
 *   block   — will not post. Reserved for things that make the books WRONG.
 *   confirm — will post once acknowledged. A judgment Michael is allowed to make.
 *   advise  — posts freely; teaching note attached to the entry forever.
 */
export type BillSeverity = "block" | "confirm" | "advise";

export type BillFinding = {
  code: string;
  severity: BillSeverity;
  concern: string;
  why: string;
  fix: string;
  /** Line numbers this is about. Empty = the whole bill. */
  lines: readonly number[];
  /** Authority ids. Rendered via citeAuthorities(). */
  authorityIds: readonly string[];
  /**
   * A worked correct example, when one helps. Michael is a visual learner, so
   * showing the right journal beats describing it.
   */
  workedExample?: readonly string[];
};

/**
 * The ONLY reasons a bill is refused outright. Exported so a test can assert the
 * list has not grown: the promise to Michael is that the system pushes back and
 * teaches, and only these few things are hard law.
 */
export const BILL_HARD_BLOCKS: readonly string[] = [
  "BILL_TOTAL_MISMATCH",
  "BILL_NO_LINES",
  "BILL_NO_INVOICE_NUMBER",
  "BILL_NO_VENDOR",
  "BILL_BAD_DATE",
  "BILL_ZERO_LINE",
  "BILL_CANNABIS_NO_CATEGORY",
  "BILL_UNKNOWN_KIND",
  // Posting into a closed period silently rewrites a month already reported.
  "BILL_PERIOD_CLOSED",
  // Cannabis inventory in a non-licensed entity's books destroys the CHAMP
  // separation that keeps the ATM and rental activities deductible.
  "BILL_CANNABIS_WRONG_ENTITY",
] as const;

// ===========================================================================
// 6) SMALL PURE HELPERS
// ===========================================================================

/** Sum of line amounts in cents. Total function; empty sums to 0. */
export function sumLineCents(lines: readonly VendorBillLineInput[]): number {
  let total = 0;
  for (const l of lines) total += l.amountCents;
  return total;
}

/** Format integer cents as US currency. Sign outside the dollar sign. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const withSeparators = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withSeparators}.${String(rest).padStart(2, "0")}`;
}

/**
 * Strict ISO yyyy-mm-dd validity, including real calendar days.
 * Rejects "2026-02-29" and "2026-11-31" rather than rolling them over, because a
 * silently rolled date puts a journal in the wrong period.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1];
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** The 5-digit inventory account for a category slug, or null if unknown. */
export function inventoryAccountForCategory(slug: string): string | null {
  const found = CATEGORY_SLOTS.find((c) => c.slug === slug);
  return found ? `2${String(found.slot).padStart(4, "0")}` : null;
}

/**
 * Category slug → slot. MIRRORED from coa-core.INVENTORY_CATEGORIES, which is
 * itself lifted from the POS taxonomy. Duplicated here rather than imported so
 * this module stays a leaf with no accounting-internal dependencies; a self-test
 * asserts the two lists agree exactly, so drift fails the gate.
 */
export const CATEGORY_SLOTS: readonly { slug: string; slot: number }[] = [
  { slug: "flower", slot: 10 },
  { slug: "popcorn-bud", slot: 20 },
  { slug: "infused-flower", slot: 30 },
  { slug: "trim", slot: 40 },
  { slug: "preroll", slot: 50 },
  { slug: "preroll-pack", slot: 60 },
  { slug: "blunt", slot: 70 },
  { slug: "infused-preroll", slot: 80 },
  { slug: "infused-preroll-pack", slot: 90 },
  { slug: "infused-blunt", slot: 100 },
  { slug: "cartridge", slot: 120 },
  { slug: "disposable-cartridge", slot: 130 },
  { slug: "concentrate", slot: 140 },
  { slug: "rso", slot: 150 },
  { slug: "edible-solid", slot: 160 },
  { slug: "edible-liquid", slot: 170 },
  { slug: "tincture", slot: 180 },
  { slug: "topical", slot: 190 },
  { slug: "accessories", slot: 200 },
  { slug: "paraphernalia", slot: 210 },
  { slug: "merch", slot: 220 },
] as const;

/**
 * Whole-word keyword match. Substring matching is a bug factory: "drawer"
 * contains "draw", "current" contains "rent". journal-advisor-core learned this
 * the hard way and the same discipline applies here.
 */
export function mentionsAny(text: string, words: readonly string[]): boolean {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return words.some((w) => haystack.includes(` ${w.toLowerCase()} `));
}

// ===========================================================================
// 7) CLASSIFICATION — propose, with confidence and a citation.
// ===========================================================================

export const FREIGHT_WORDS: readonly string[] = [
  "freight", "delivery", "shipping", "courier", "transport", "haul", "mileage", "fuel surcharge",
] as const;

export const DISCOUNT_WORDS: readonly string[] = [
  "discount", "rebate", "credit", "allowance", "markdown",
] as const;

export const PACKAGING_WORDS: readonly string[] = [
  "exit bag", "exit bags", "child resistant", "child-resistant", "mylar", "packaging", "label", "labels",
] as const;

export const EQUIPMENT_WORDS: readonly string[] = [
  "display case", "safe", "vault", "shelving", "counter", "cooler", "camera", "computer", "printer", "scale",
] as const;

export type ConfidenceBand = "certain" | "likely" | "unsure";

export type LineClassification = {
  lineNo: number;
  /** The kind the engine believes this is. Never null — falls back to "unknown". */
  kindCode: string;
  treatment: PurchaseTreatment;
  /** Resolved 5-digit account. For cannabis product this is the category subaccount. */
  accountCode: string;
  costClass: CostClass;
  band: ConfidenceBand;
  /** Why the engine chose this, in plain English. */
  rationale: string;
  authorityIds: readonly string[];
};

/**
 * Classify ONE line.
 *
 * Deliberate design: an EXPLICIT kind from the user always wins. The keyword
 * hints only run when nothing was chosen. An engine that silently overrides a
 * human's stated classification is an engine that grades its own homework —
 * exactly the pattern posting-core refused to build for tolerances.
 */
export function classifyLine(
  line: VendorBillLineInput,
  ctx: { entityCode: EntityCode; vendorIsLicensedCannabis?: boolean } = { entityCode: "greenway" },
): LineClassification {
  const text = `${line.description ?? ""}`;

  // (a) Explicit wins.
  if (line.purchaseKindCode) {
    const kind = findPurchaseKind(line.purchaseKindCode);
    if (!kind) {
      return {
        lineNo: line.lineNo,
        kindCode: "unknown",
        treatment: "quarantine",
        accountCode: "20890",
        costClass: "none",
        band: "unsure",
        rationale:
          `"${line.purchaseKindCode}" is not a purchase kind this system knows. Rather than guess, the ` +
          `line is quarantined so you can see it and choose.`,
        authorityIds: ["IRC_6001_SUBSTANTIATION"],
      };
    }
    return resolveKind(kind, line, ctx, "certain", "You chose this classification.");
  }

  // (b) Hints, most specific first. Order matters: a "delivery discount" is a
  //     discount, so discounts are tested before freight.
  if (mentionsAny(text, DISCOUNT_WORDS) && line.amountCents < 0) {
    return resolveKind(
      findPurchaseKind("purchase_discount")!, line, ctx, "likely",
      "The description mentions a discount/rebate and the amount is negative, which is what a trade discount looks like.",
    );
  }
  if (mentionsAny(text, PACKAGING_WORDS)) {
    return resolveKind(
      findPurchaseKind("product_packaging")!, line, ctx, "likely",
      "The description mentions packaging that typically leaves with the product, which is inventoriable rather than a store supply.",
    );
  }
  if (mentionsAny(text, FREIGHT_WORDS)) {
    return resolveKind(
      findPurchaseKind("freight_in")!, line, ctx, "likely",
      "The description mentions transportation. On a PURCHASE that is inventoriable under Reg. §1.471-3(b). Confirm it is inbound, not outbound.",
    );
  }
  if (mentionsAny(text, EQUIPMENT_WORDS) && line.amountCents >= DE_MINIMIS_CAPITALISATION_CENTS) {
    return resolveKind(
      findPurchaseKind("equipment")!, line, ctx, "likely",
      `The description looks like equipment and the amount is at or above the ${formatCents(DE_MINIMIS_CAPITALISATION_CENTS)} de minimis threshold, so it looks like an asset rather than an expense.`,
    );
  }
  if (ctx.vendorIsLicensedCannabis && line.amountCents > 0) {
    return resolveKind(
      findPurchaseKind("cannabis_product")!, line, ctx, "likely",
      "The vendor is a licensed cannabis producer/processor, so a positive charge is most likely product for resale.",
    );
  }

  // (c) Nothing matched. Say so.
  return {
    lineNo: line.lineNo,
    kindCode: "unknown",
    treatment: "quarantine",
    accountCode: "20890",
    costClass: "none",
    band: "unsure",
    rationale:
      "Nothing in this line told the engine what it is. It is parked in quarantine, visibly, rather than " +
      "being guessed into a plausible account where a mistake would never be noticed.",
    authorityIds: ["IRC_6001_SUBSTANTIATION"],
  };
}

/** Resolve a kind into a concrete account + cost class for an entity. */
function resolveKind(
  kind: PurchaseKind,
  line: VendorBillLineInput,
  ctx: { entityCode: EntityCode; vendorIsLicensedCannabis?: boolean },
  band: ConfidenceBand,
  rationale: string,
): LineClassification {
  let accountCode = kind.debitAccountCode;

  // Cannabis product resolves to the CATEGORY subaccount, never the control
  // account. 0173 marks 20000 as a control account and posting to a control
  // account by hand is what makes the ledger and the subledger disagree.
  if (kind.isCannabisProduct) {
    const slug = line.categorySlug ?? null;
    const resolved = slug ? inventoryAccountForCategory(slug) : null;
    accountCode = resolved ?? "20890"; // no/unknown category => quarantine, visibly
  }

  // The 280E cost class depends on the ENTITY, not only the account. Only
  // greenway is exposed to §280E; the ATM and landholding activities are
  // separate trades or businesses (CHAMP) and their costs are ordinary.
  let costClass = kind.costClass;
  if (costClass === "nondeductible_280e") {
    if (ctx.entityCode === "personal") costClass = "personal";
    else if (ctx.entityCode === "atm" || ctx.entityCode === "landholding") costClass = "separate_business";
  }

  const treatment: PurchaseTreatment =
    kind.isCannabisProduct && accountCode === "20890" ? "quarantine" : kind.treatment;

  return {
    lineNo: line.lineNo,
    kindCode: kind.code,
    treatment,
    accountCode,
    costClass,
    band: treatment === "quarantine" ? "unsure" : band,
    rationale,
    authorityIds: kind.authorityIds,
  };
}

// ===========================================================================
// 8) EVALUATION — the pushback engine.
// ===========================================================================

export type BillVerdict = {
  /** False when at least one "block" finding exists. */
  postable: boolean;
  /** True when at least one "confirm" finding must be acknowledged first. */
  needsAcknowledgement: boolean;
  findings: readonly BillFinding[];
  classifications: readonly LineClassification[];
  /** Sum of the lines, in cents. */
  computedTotalCents: number;
  /** How much of this bill survives §280E as inventory/COGS. */
  inventoriableCents: number;
  /** How much §280E disallows. */
  disallowedCents: number;
  /** How much is capitalised as a long-lived asset. */
  capitalisedCents: number;
  /** How much is somebody else's money passing through. */
  trustCents: number;
  /** How much the engine refused to classify. */
  quarantinedCents: number;
};

/**
 * Evaluate a whole bill. PURE: same input, same verdict, forever.
 *
 * The ordering of checks is deliberate — structural problems (does this bill
 * even hang together?) come before tax judgment, because there is no point
 * discussing the §280E character of a bill whose lines do not add up.
 */
export function evaluateVendorBill(
  bill: VendorBillInput,
  ctx: { vendorIsLicensedCannabis?: boolean; periodClosed?: boolean } = {},
): BillVerdict {
  const findings: BillFinding[] = [];
  const classifications = bill.lines.map((l) =>
    classifyLine(l, { entityCode: bill.entityCode, vendorIsLicensedCannabis: ctx.vendorIsLicensedCannabis }),
  );

  // ---- STRUCTURE ---------------------------------------------------------
  if (bill.lines.length === 0) {
    findings.push({
      code: "BILL_NO_LINES",
      severity: "block",
      concern: "This bill has no lines.",
      why:
        "A bill with no detail cannot be classified, so its §280E character is unknowable and its total " +
        "cannot be substantiated.",
      fix: "Add at least one line describing what was purchased and for how much.",
      lines: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  const computedTotalCents = sumLineCents(bill.lines);
  if (bill.lines.length > 0 && computedTotalCents !== bill.statedTotalCents) {
    const diff = bill.statedTotalCents - computedTotalCents;
    findings.push({
      code: "BILL_TOTAL_MISMATCH",
      severity: "block",
      concern:
        `The lines add up to ${formatCents(computedTotalCents)} but the invoice total says ` +
        `${formatCents(bill.statedTotalCents)} — a difference of ${formatCents(diff)}.`,
      why:
        "If the detail and the total disagree, one of them is wrong, and posting either one puts a number " +
        "in your books that no document supports. This is precisely how a small unexplained difference " +
        "becomes a plug entry, and a plug entry is how the old inventory accounts ended up " +
        `${formatCents(-438834806)} in the wrong direction.`,
      fix:
        "Re-read the paper invoice. Usually it is a missing freight line, a discount not entered, or a " +
        "typo in one amount. Fix whichever is wrong — do NOT add a balancing line to make it tie.",
      lines: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
      workedExample: [
        "Say the invoice reads $1,000.00 and your lines total $965.00.",
        "Look for a $35.00 delivery charge you have not entered yet.",
        "Enter it as its own line, kind = freight_in (account 60800).",
        "Now the lines tie AND you have captured an inventoriable cost instead of losing it.",
      ],
    });
  }

  if (!bill.invoiceNumber || bill.invoiceNumber.trim() === "") {
    findings.push({
      code: "BILL_NO_INVOICE_NUMBER",
      severity: "block",
      concern: "There is no invoice number on this bill.",
      why:
        "The invoice number is the thread from the journal back to the paper. Without it you cannot prove " +
        "the cost, and §6001 puts that burden on you. It is also what makes re-entry safe: the same invoice " +
        "submitted twice must produce ONE journal, and the number is the key that makes that possible.",
      fix:
        "Type the number printed on the vendor's invoice. If the vendor genuinely issues no number, use a " +
        "stable one of your own (e.g. VENDORNAME-2026-11-01-1) and write it on the paper copy too.",
      lines: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  if (!bill.vendorName || bill.vendorName.trim() === "") {
    findings.push({
      code: "BILL_NO_VENDOR",
      severity: "block",
      concern: "There is no vendor on this bill.",
      why:
        "Who you paid is half the substantiation. It also drives the classification default and, for " +
        "cannabis purchases, the traceability tie-out.",
      fix: "Choose the vendor from the vendor list, or add them to it first.",
      lines: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  if (!isValidIsoDate(bill.invoiceDate)) {
    findings.push({
      code: "BILL_BAD_DATE",
      severity: "block",
      concern: `"${bill.invoiceDate}" is not a real calendar date.`,
      why:
        "The date decides which period, which quarter and which tax year this cost lands in. A rolled-over " +
        "or malformed date silently moves money between years.",
      fix: "Enter the invoice date as yyyy-mm-dd, using the date printed on the invoice, in Pacific time.",
      lines: [],
      authorityIds: [],
    });
  }

  // ---- LINE-LEVEL --------------------------------------------------------
  for (const c of classifications) {
    const line = bill.lines.find((l) => l.lineNo === c.lineNo)!;

    if (line.amountCents === 0) {
      findings.push({
        code: "BILL_ZERO_LINE",
        severity: "block",
        concern: `Line ${c.lineNo} is for ${formatCents(0)}.`,
        why:
          "A zero line records nothing but takes up space in the audit trail, and it usually means an " +
          "amount was never typed in.",
        fix: "Enter the real amount, or delete the line.",
        lines: [c.lineNo],
        authorityIds: [],
      });
    }

    if (line.purchaseKindCode && !findPurchaseKind(line.purchaseKindCode)) {
      findings.push({
        code: "BILL_UNKNOWN_KIND",
        severity: "block",
        concern: `Line ${c.lineNo} names a purchase kind ("${line.purchaseKindCode}") this system does not know.`,
        why:
          "The list of purchase kinds is closed on purpose. Every kind carries a tax treatment and a " +
          "citation; an unknown kind carries neither, so there is no defensible place to post it.",
        fix:
          "Pick the closest kind from the list. If nothing genuinely fits, use 'unknown' — it quarantines " +
          "the line visibly — and tell me, so a new kind can be added properly with its authority.",
        lines: [c.lineNo],
        authorityIds: ["IRC_6001_SUBSTANTIATION"],
      });
    }

    const kind = findPurchaseKind(c.kindCode);
    if (kind?.isCannabisProduct && c.accountCode === "20890") {
      findings.push({
        code: "BILL_CANNABIS_NO_CATEGORY",
        severity: "block",
        concern: `Line ${c.lineNo} is cannabis product for resale but has no product category.`,
        why:
          "Inventory is broken out by the 21 house categories so that gross margin by category is a " +
          "subtraction rather than a project, and so COGS can be proved category by category. Posting to " +
          "the 20000 control account by hand is what makes the ledger and the inventory subledger disagree.",
        fix:
          "Choose the category (flower, preroll, cartridge, edible-solid, …). If one invoice covers several " +
          "categories, split it into one line per category — the vendor's invoice almost always already " +
          "shows that breakdown.",
        lines: [c.lineNo],
        authorityIds: ["ALTERMAN_COGS_FORMULA", "REG_1_471_3_B"],
        workedExample: [
          "Invoice from a licensed producer, $4,200.00, covering two product types:",
          "  Line 1  Flower       $3,000.00  → 20010 Inventory — Flower",
          "  Line 2  Concentrate  $1,200.00  → 20140 Inventory — Concentrate",
          "  (credit) Accounts Payable 30000  $4,200.00",
          "Now each category's COGS is provable on its own, and margin by category is just 50xxx − 60xxx.",
        ],
      });
    }

    // ---- TEACHING / JUDGMENT FINDINGS ----------------------------------
    if (c.treatment === "quarantine" && c.kindCode === "unknown") {
      findings.push({
        code: "BILL_UNCLASSIFIED",
        severity: "confirm",
        concern: `Line ${c.lineNo} (${formatCents(line.amountCents)}) could not be classified.`,
        why:
          "Under §280E the single most valuable thing you do with each dollar is decide whether it is a " +
          "cost of goods or a cost of operating. The engine will not make that decision for you when it " +
          "cannot see the answer, because a wrong guess in a plausible account is invisible and a " +
          "quarantined balance is not.",
        fix:
          "Pick a purchase kind for this line. The question to ask is simple: did this dollar help get " +
          "saleable goods onto my shelf (inventory), or did it help me run a store (expense)?",
        lines: [c.lineNo],
        authorityIds: ["RODRIGUEZ_NOT_A_DEDUCTION", "REG_1_471_3_B"],
        workedExample: [
          "Ask the question in this order:",
          "  1. Is it the product itself?              → cannabis_product (inventory)",
          "  2. Did it get the product here?           → freight_in (inventory, 60800)",
          "  3. Does it leave with the product?        → product_packaging (inventory)",
          "  4. Will it last more than a year?         → equipment / leasehold_improvement (asset)",
          "  5. Is it the state's money passing through? → excise/sales tax remittance (trust)",
          "  6. Otherwise it is a cost of running the store → expense (§280E disallows it)",
        ],
      });
    }

    if (c.kindCode === "testing_on_purchase") {
      findings.push({
        code: "BILL_TESTING_JUDGMENT",
        severity: "confirm",
        concern: `Line ${c.lineNo} is lab testing, and its tax treatment genuinely depends on the facts.`,
        why:
          "If the test was necessary for you to take possession of a specific lot, Reg. §1.471-3(b)'s " +
          "\"other necessary charges incurred in acquiring possession\" language reaches it and it is " +
          "inventoriable. If it is routine compliance testing of goods you already own, it looks like an " +
          "operating cost that §280E disallows. Both positions are defensible with reasoning recorded, and " +
          "neither is defensible without it.",
        fix:
          "Say which it was, and the note is stored with the journal permanently. If it was required before " +
          "you could accept the lot, classify inventoriable and reference the manifest. If it was routine " +
          "post-receipt testing, classify it as an expense (75020 Product Testing).",
        lines: [c.lineNo],
        authorityIds: ["REG_1_471_3_B", "IRC_263A_FLUSH", "CCA_201504011", "IRC_6001_SUBSTANTIATION"],
      });
    }

    // Capitalisation pushback: a big "expense" that smells like an asset.
    if (
      c.treatment === "expense" &&
      line.amountCents >= DE_MINIMIS_CAPITALISATION_CENTS &&
      mentionsAny(line.description ?? "", EQUIPMENT_WORDS)
    ) {
      findings.push({
        code: "BILL_LOOKS_CAPITAL",
        severity: "confirm",
        concern:
          `Line ${c.lineNo} is ${formatCents(line.amountCents)} coded as an expense, but the description ` +
          `sounds like equipment.`,
        why:
          "Something with a useful life beyond this year is an asset, not an expense. It belongs on the " +
          "balance sheet and depreciates over its life. Expensing it misstates both the balance sheet and " +
          "this year's result — and throws away basis that still matters on disposal and if the law changes.",
        fix:
          `If it is equipment, fixtures or a leasehold improvement, classify it as an asset. If it is ` +
          `genuinely a consumable or a true repair, expensing is correct — the de minimis safe harbour ` +
          `ceiling is ${formatCents(DE_MINIMIS_CAPITALISATION_CENTS)} per invoice and requires a written ` +
          `election in place at the start of the year.`,
        lines: [c.lineNo],
        authorityIds: ["IRC_280E"],
        workedExample: [
          "A $6,000.00 display case:",
          "  WRONG   debit 76020 Store Supplies        $6,000.00",
          "  RIGHT   debit 21600 Furniture, Fixtures & Equipment  $6,000.00",
          "          credit 30000 Accounts Payable               $6,000.00",
          "Then the fixed-asset schedule depreciates it, and the asset shows on your balance sheet where a",
          "bank (or a buyer) can see it.",
        ],
      });
    }

    // Freight-in that was coded to outbound shipping. The most expensive
    // classification error available to a reseller, and the easiest to make.
    if (
      c.kindCode !== "freight_in" &&
      c.treatment === "expense" &&
      mentionsAny(line.description ?? "", FREIGHT_WORDS)
    ) {
      findings.push({
        code: "BILL_FREIGHT_AS_EXPENSE",
        severity: "confirm",
        concern:
          `Line ${c.lineNo} mentions transportation but is classified as an operating expense.`,
        why:
          "This is the most expensive small mistake available to you. Reg. §1.471-3(b) says inbound " +
          "transportation is ADDED to inventory cost — so freight-in survives §280E as part of COGS. " +
          "Coded to 76030 Postage & Shipping instead, the very same dollar becomes non-deductible. You pay " +
          "tax on money you were entitled to keep, and nothing in the books ever flags it.",
        fix:
          "If this freight brought goods TO you, classify it freight_in (60800) so it capitalises. Only " +
          "OUTBOUND shipping belongs in 76030.",
        lines: [c.lineNo],
        authorityIds: ["REG_1_471_3_B", "ASC_330_10_30_1"],
        workedExample: [
          "A $250.00 delivery fee on a product purchase:",
          "  WRONG   debit 76030 Postage & Shipping   $250.00   → §280E disallows it entirely",
          "  RIGHT   debit 60800 Freight-In           $250.00   → rides with inventory into COGS",
          "          credit 30000 Accounts Payable    $250.00",
        ],
      });
    }
  }

  // ---- BILL-LEVEL JUDGMENT ----------------------------------------------
  if (ctx.periodClosed) {
    findings.push({
      code: "BILL_PERIOD_CLOSED",
      severity: "block",
      concern: `The period containing ${bill.invoiceDate} is closed.`,
      why:
        "A closed period is a promise that its numbers will not change. Posting into it silently rewrites " +
        "a month you already reported, and every downstream figure that referenced it becomes wrong.",
      fix:
        "Post it in the current open period with a memo explaining the delay, or reopen the period " +
        "deliberately (which is recorded, with a reason) if it truly belongs there.",
      lines: [],
      authorityIds: [],
    });
  }

  // Cannabis product without a manifest: a traceability AND substantiation gap.
  const hasCannabisProduct = classifications.some((c) => c.kindCode === "cannabis_product");
  if (hasCannabisProduct && !bill.fromAcceptedManifest) {
    findings.push({
      code: "BILL_CANNABIS_NO_MANIFEST",
      severity: "confirm",
      concern: "This bill buys cannabis product but is not linked to an accepted inbound manifest.",
      why:
        "Two separate problems. In tax terms, your COGS rests on inventory records that must be preserved " +
        "(Alterman; §6001) — the manifest IS that record. In regulatory terms, cannabis cannot lawfully " +
        "arrive without a transfer record, so a purchase with no manifest is either a data-entry gap or a " +
        "compliance problem, and you want to know which today rather than at an audit.",
      fix:
        "Link the accepted manifest. If the goods physically arrived but the manifest was never accepted in " +
        "the system, accept it first — then the bill, the manifest and the ledger all tell one story.",
      lines: [],
      authorityIds: ["ALTERMAN_COGS_FORMULA", "IRC_6001_SUBSTANTIATION"],
    });
  }

  // Entity guard: 280E only applies to greenway. Buying store inventory in the
  // wrong set of books is both a tax error and a drift error.
  if (bill.entityCode !== "greenway" && hasCannabisProduct) {
    findings.push({
      code: "BILL_CANNABIS_WRONG_ENTITY",
      severity: "block",
      concern: `This bill buys cannabis product but is posted to the "${bill.entityCode}" books.`,
      why:
        "Only Greenway holds the I-502 licence and only Greenway sells product. Cannabis inventory in " +
        "another entity's books breaks the entity separation that CHAMP makes valuable — and that " +
        "separation is what keeps the ATM and rental activities deductible.",
      fix: "Post this bill in the greenway books.",
      lines: [],
      authorityIds: ["CHAMP", "HARBORSIDE"],
    });
  }

  // The teaching moment. Not a problem — a fact worth seeing on every bill.
  const buckets = summariseBuckets(bill, classifications);
  if (buckets.disallowedCents > 0) {
    findings.push({
      code: "BILL_280E_SUMMARY",
      severity: "advise",
      concern:
        `${formatCents(buckets.disallowedCents)} of this bill is an operating cost that §280E disallows, ` +
        `and ${formatCents(buckets.inventoriableCents)} rides with inventory into COGS.`,
      why:
        "COGS is subtracted while computing gross income (Reg. §1.61-3(a)), so §280E never reaches it. " +
        "Deductions are taken after gross income, which is exactly where §280E bites. Same dollars out the " +
        "door, very different tax outcome — decided by classification.",
      fix:
        "Nothing to fix if the split is right. Just confirm the inventoriable side captured everything it " +
        "is entitled to: invoice price, less trade discounts, PLUS freight and other costs of getting " +
        "possession.",
      lines: [],
      authorityIds: ["REG_1_61_3_A", "ALPENGLOW_EXCLUSION", "REG_1_471_3_B", "SENATE_REPORT_97_494"],
    });
  }

  const postable = !findings.some((f) => f.severity === "block");
  const needsAcknowledgement = findings.some((f) => f.severity === "confirm");

  return {
    postable,
    needsAcknowledgement,
    findings,
    classifications,
    computedTotalCents,
    ...buckets,
  };
}

/** Split a bill's money into the five §280E buckets. */
function summariseBuckets(
  bill: VendorBillInput,
  classifications: readonly LineClassification[],
): {
  inventoriableCents: number;
  disallowedCents: number;
  capitalisedCents: number;
  trustCents: number;
  quarantinedCents: number;
} {
  let inventoriableCents = 0;
  let disallowedCents = 0;
  let capitalisedCents = 0;
  let trustCents = 0;
  let quarantinedCents = 0;

  for (const c of classifications) {
    const line = bill.lines.find((l) => l.lineNo === c.lineNo);
    if (!line) continue;
    switch (c.treatment) {
      case "inventory": inventoriableCents += line.amountCents; break;
      case "expense": disallowedCents += line.amountCents; break;
      case "asset": capitalisedCents += line.amountCents; break;
      case "trust": trustCents += line.amountCents; break;
      case "quarantine": quarantinedCents += line.amountCents; break;
    }
  }

  return { inventoriableCents, disallowedCents, capitalisedCents, trustCents, quarantinedCents };
}

// ===========================================================================
// 9) JOURNAL CONSTRUCTION — the balanced entry, or nothing.
// ===========================================================================

export type BillJournalLine = {
  accountCode: string;
  /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit. */
  amountCents: number;
  costClass: CostClass;
  description: string;
};

export type BillJournal = {
  entityCode: EntityCode;
  journalDate: string;
  sourceKind: "purchase";
  /** Idempotency reference. Manifest number when present, else vendor+invoice. */
  sourceRef: string;
  memo: string;
  lines: readonly BillJournalLine[];
};

/**
 * The AP control account. 0173 seeds 30000 as a control account for the 'ap'
 * subledger, which is exactly right: bills post here through this one door and
 * nothing hand-keys it.
 */
export const AP_ACCOUNT_CODE = "30000";

/**
 * Build the idempotency reference. The same invoice submitted twice — a retry, a
 * double-click, a re-run of the November cut-over — must produce exactly ONE
 * journal. Manifest number wins when present because it is the strongest
 * external key; otherwise vendor+invoice number.
 */
export function billSourceRef(bill: VendorBillInput): string {
  if (bill.fromAcceptedManifest && bill.manifestNumber && bill.manifestNumber.trim() !== "") {
    return `manifest:${bill.manifestNumber.trim()}`;
  }
  const vendor = (bill.vendorName ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const inv = (bill.invoiceNumber ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `bill:${vendor}:${inv}`;
}

/**
 * Turn an evaluated bill into a balanced journal.
 *
 * Returns null when the verdict is not postable — the caller must not be able to
 * accidentally build a journal from a refused bill. Making this a null return
 * rather than a thrown error keeps the function total and testable, and makes
 * the "did we check first?" question visible at every call site.
 *
 * SHAPE: each cost line is a DEBIT; one CREDIT to accounts payable for the
 * total. Discounts arrive as negative cost lines, which correctly reduces both
 * the debit side and the payable.
 */
export function buildBillJournal(bill: VendorBillInput, verdict: BillVerdict): BillJournal | null {
  if (!verdict.postable) return null;

  const lines: BillJournalLine[] = [];

  for (const c of verdict.classifications) {
    const line = bill.lines.find((l) => l.lineNo === c.lineNo);
    if (!line) continue;
    const kind = findPurchaseKind(c.kindCode);
    lines.push({
      accountCode: c.accountCode,
      amountCents: line.amountCents,
      costClass: c.costClass,
      description: line.description?.trim() || kind?.label || "Vendor bill line",
    });
  }

  const total = sumLineCents(bill.lines);
  lines.push({
    accountCode: AP_ACCOUNT_CODE,
    amountCents: -total,
    costClass: "none",
    description: `Accounts payable — ${bill.vendorName.trim()} invoice ${bill.invoiceNumber.trim()}`,
  });

  return {
    entityCode: bill.entityCode,
    journalDate: bill.invoiceDate,
    sourceKind: "purchase",
    sourceRef: billSourceRef(bill),
    memo: `Bill — ${bill.vendorName.trim()} — invoice ${bill.invoiceNumber.trim()}`,
    lines,
  };
}

/** A journal is balanced when its signed amounts sum to exactly zero. */
export function journalIsBalanced(journal: BillJournal): boolean {
  let sum = 0;
  for (const l of journal.lines) sum += l.amountCents;
  return sum === 0;
}

// ===========================================================================
// 10) THREE-WAY MATCH — the only route to automatic posting.
// ===========================================================================
/**
 * posting-core lists `purchase` as autopostable, but ONLY "when a PO, a receipt
 * and an invoice already agree". This is that test, and it is deliberately
 * strict: automation is earned by evidence, never by confidence.
 *
 * For Greenway the three documents are:
 *   ordered  — what was ordered (or, with no PO discipline, the manifest total)
 *   received — what physically arrived, per the accepted manifest
 *   invoiced — what the vendor is billing
 */
export type ThreeWayMatchInput = {
  orderedCents: number | null;
  receivedCents: number | null;
  invoicedCents: number;
  /** Allowed absolute difference in cents. Owner-set, never self-widening. */
  toleranceCents: number;
};

export type ThreeWayMatchResult = {
  matched: boolean;
  /** Machine code for the UI and tests. */
  code: string;
  /** Plain English. */
  reason: string;
  /** Largest absolute gap found, in cents. */
  worstGapCents: number;
};

export function threeWayMatch(input: ThreeWayMatchInput): ThreeWayMatchResult {
  const { orderedCents, receivedCents, invoicedCents, toleranceCents } = input;

  if (toleranceCents < 0) {
    return {
      matched: false,
      code: "MATCH_BAD_TOLERANCE",
      reason: "A negative tolerance is not a tolerance. Nothing can match.",
      worstGapCents: 0,
    };
  }
  if (orderedCents === null && receivedCents === null) {
    return {
      matched: false,
      code: "MATCH_NO_EVIDENCE",
      reason:
        "There is neither an order nor a receipt to compare the invoice against, so there is nothing to " +
        "match. A human has to look at this one — that is not a failure, it is the system refusing to " +
        "pretend it checked something.",
      worstGapCents: 0,
    };
  }

  const gaps: number[] = [];
  if (orderedCents !== null) gaps.push(Math.abs(invoicedCents - orderedCents));
  if (receivedCents !== null) gaps.push(Math.abs(invoicedCents - receivedCents));
  if (orderedCents !== null && receivedCents !== null) gaps.push(Math.abs(orderedCents - receivedCents));

  const worstGapCents = gaps.reduce((a, b) => (b > a ? b : a), 0);

  if (worstGapCents <= toleranceCents) {
    return {
      matched: true,
      code: "MATCH_OK",
      reason:
        `Order, receipt and invoice agree within ${formatCents(toleranceCents)} ` +
        `(largest gap ${formatCents(worstGapCents)}). This is derived from evidence already in the system, ` +
        `so it may post without a human.`,
      worstGapCents,
    };
  }

  return {
    matched: false,
    code: "MATCH_OUT_OF_TOLERANCE",
    reason:
      `The largest gap is ${formatCents(worstGapCents)}, over the ${formatCents(toleranceCents)} tolerance. ` +
      `Something real disagrees — a short shipment, a price change, or a billing error. It becomes a draft ` +
      `for you to look at, which is exactly what you want: this is the check that catches being overbilled.`,
    worstGapCents,
  };
}

// ===========================================================================
// 11) THE VISUAL MODEL — because Michael learns visually.
// ===========================================================================
/**
 * Michael: "I learn best visually, so if we can add visual elements and helpers
 * that explain things visually that'd be great."
 *
 * The DECISION TREE lives here as DATA, not as JSX, for three reasons:
 *   1. It can be unit-tested (every node reachable, every leaf cited).
 *   2. The UI, a PDF and a future AI explainer all render the SAME tree, so the
 *      picture on screen can never drift from the logic that actually runs.
 *   3. The tree is the teaching artefact. If Michael internalises this one
 *      diagram, he can classify any bill in the country without the software.
 */
/**
 * One edge out of a decision node. Either it CONCLUDES (leafTreatment set) or
 * it CONTINUES (nextId set). Named separately so walkDecisionTree can annotate
 * its locals explicitly — without the name, TypeScript sees the recursive
 * findDecisionNode → DecisionNode → branch cycle and gives up (TS7022).
 */
export type DecisionBranch = {
  leafTreatment?: PurchaseTreatment;
  leafKindCode?: string;
  nextId?: string;
  label: string;
};

export type DecisionNode = {
  id: string;
  /** The question, in Michael's words. */
  question: string;
  /** Why this question comes at THIS point in the tree. */
  whyHere: string;
  /** Answer yes → this leaf treatment, or next node. */
  yes: DecisionBranch;
  no: DecisionBranch;
  authorityIds: readonly string[];
};

/**
 * The §280E decision tree, in the order a human should actually ask the
 * questions. Order is not arbitrary: trust money is tested FIRST because it
 * never belongs on the P&L at all, and mixing it in poisons every ratio after.
 */
export const DECISION_TREE: readonly DecisionNode[] = [
  {
    id: "q1_trust",
    question: "Is this money the state's, just passing through my till?",
    whyHere:
      "Asked first because trust money is not income and not expense — it is a liability. Getting this " +
      "wrong contaminates revenue, margin and the tax return all at once, which is exactly what happened " +
      "for twelve years in the old books.",
    yes: { leafTreatment: "trust", label: "Liability (32000 / 32100). Never touches the P&L." },
    no: { nextId: "q2_product", label: "It is genuinely our money." },
    authorityIds: ["RCW_69_50_535"],
  },
  {
    id: "q2_product",
    question: "Is this the product itself — goods I will resell?",
    whyHere:
      "The easiest and biggest bucket. Invoice price of goods for resale is the core of inventory cost " +
      "under Reg. §1.471-3(b).",
    yes: { leafTreatment: "inventory", leafKindCode: "cannabis_product", label: "Inventory (20xxx by category) → COGS when sold. SURVIVES §280E." },
    no: { nextId: "q3_possession", label: "Not the goods themselves." },
    authorityIds: ["REG_1_471_3_B", "IRS_CANNABIS_FAQ"],
  },
  {
    id: "q3_possession",
    question: "Did this cost help me TAKE POSSESSION of specific goods?",
    whyHere:
      "This is the clause most retailers leave money on the table with. §1.471-3(b) adds \"transportation " +
      "or other necessary charges incurred in acquiring possession of the goods\" to inventory cost. " +
      "Freight-in is the classic example.",
    yes: { leafTreatment: "inventory", leafKindCode: "freight_in", label: "Inventory (60800 Freight-In). SURVIVES §280E." },
    no: { nextId: "q4_with_product", label: "It did not bring goods to me." },
    authorityIds: ["REG_1_471_3_B", "ASC_330_10_30_1"],
  },
  {
    id: "q4_with_product",
    question: "Does it physically LEAVE with the product the customer buys?",
    whyHere:
      "Required exit packaging becomes part of the article sold, so it is a product cost. A paper towel " +
      "used to clean the counter is not. The test is whether the customer carries it out.",
    yes: { leafTreatment: "inventory", leafKindCode: "product_packaging", label: "Inventory (60800). SURVIVES §280E." },
    no: { nextId: "q5_long_lived", label: "It stays in the store." },
    authorityIds: ["REG_1_471_3_B", "ASC_330_10_30_1"],
  },
  {
    id: "q5_long_lived",
    question: "Will it still be useful to me a year from now?",
    whyHere:
      "Separates assets from expenses. This is not a §280E question at all — it is ordinary capitalisation " +
      "— but getting it wrong distorts the balance sheet and discards basis.",
    yes: { leafTreatment: "asset", leafKindCode: "equipment", label: "Asset (21xxx). Capitalise and depreciate." },
    no: { nextId: "q6_separate_business", label: "It is consumed now." },
    authorityIds: ["IRC_280E"],
  },
  {
    id: "q6_separate_business",
    question: "Is this a cost of a genuinely SEPARATE business (ATM, the Geiger rental)?",
    whyHere:
      "CHAMP allows a taxpayer with two real trades or businesses to deduct the non-cannabis one's " +
      "expenses. Harborside is the warning: a token side activity does not count. Real separation means " +
      "its own revenue, its own economics, its own records — which is why those live in their own entities.",
    yes: { leafTreatment: "expense", label: "Ordinary deductible expense in that entity's books. §280E does not apply." },
    no: { leafTreatment: "expense", label: "Operating cost of the cannabis trade. §280E DISALLOWS it. Record it correctly anyway." },
    authorityIds: ["CHAMP", "HARBORSIDE", "IRC_280E"],
  },
] as const;

export function findDecisionNode(id: string): DecisionNode | undefined {
  return DECISION_TREE.find((n) => n.id === id);
}

/**
 * Walk the tree with a set of yes/no answers and report the leaf.
 * Used by the UI's interactive explainer AND by tests that prove every leaf is
 * reachable — an unreachable branch in a teaching diagram is a lie.
 */
export function walkDecisionTree(answers: Readonly<Record<string, boolean>>): {
  path: readonly string[];
  leafTreatment: PurchaseTreatment | null;
  leafLabel: string;
} {
  const path: string[] = [];
  let current: DecisionNode | undefined = DECISION_TREE[0];
  let guard = 0;

  while (current && guard < 100) {
    guard += 1;
    path.push(current.id);
    const node: DecisionNode = current;
    const answer: boolean | undefined = answers[node.id];
    if (answer === undefined) {
      return { path, leafTreatment: null, leafLabel: `Unanswered: ${node.question}` };
    }
    const branch: DecisionBranch = answer ? node.yes : node.no;
    if (branch.leafTreatment) {
      return { path, leafTreatment: branch.leafTreatment, leafLabel: branch.label };
    }
    current = branch.nextId ? findDecisionNode(branch.nextId) : undefined;
  }

  return { path, leafTreatment: null, leafLabel: "No conclusion reached." };
}

// ===========================================================================
// 12) THE MONEY PICTURE — bucket geometry for a bar chart, computed purely.
// ===========================================================================
/**
 * A stacked bar showing where a bill's money went, in §280E terms. The
 * GEOMETRY is computed here, in integers, so the picture is testable and the
 * component stays dumb. Widths are integer MILLI-PERCENT (100% = 100000) to
 * match the repo's rate rule and to avoid floats in a visual that Michael will
 * use to make decisions.
 */
export type BucketBar = {
  key: "inventoriable" | "disallowed" | "capitalised" | "trust" | "quarantined";
  label: string;
  cents: number;
  /** Integer milli-percent of the absolute total. Sums to 100000 (or 0). */
  milliPercent: number;
  /** Plain-English one-liner for the legend. */
  meaning: string;
};

export function bucketBars(verdict: BillVerdict): BucketBar[] {
  const raw: { key: BucketBar["key"]; label: string; cents: number; meaning: string }[] = [
    {
      key: "inventoriable",
      label: "Rides with inventory → COGS",
      cents: verdict.inventoriableCents,
      meaning: "§280E cannot touch this. It reduces income when the goods sell.",
    },
    {
      key: "disallowed",
      label: "Operating cost — §280E disallows",
      cents: verdict.disallowedCents,
      meaning: "Real money out the door that federal tax will not let you deduct.",
    },
    {
      key: "capitalised",
      label: "Asset — capitalise & depreciate",
      cents: verdict.capitalisedCents,
      meaning: "On the balance sheet. Basis stays with the asset.",
    },
    {
      key: "trust",
      label: "Trust money — the state's",
      cents: verdict.trustCents,
      meaning: "Never income, never expense. A liability moving.",
    },
    {
      key: "quarantined",
      label: "Not yet classified",
      cents: verdict.quarantinedCents,
      meaning: "Waiting on your decision. Do not leave this past month end.",
    },
  ];

  const totalAbs = raw.reduce((a, b) => a + Math.abs(b.cents), 0);

  // Largest-remainder apportionment so the bar always sums to exactly 100000.
  // Naive rounding leaves a 1-milli-percent gap that renders as a hairline
  // sliver, and a chart that does not add up teaches the wrong lesson about
  // books that must add up.
  if (totalAbs === 0) {
    return raw.map((r) => ({ ...r, milliPercent: 0 }));
  }

  const scaled = raw.map((r) => {
    const exact = (Math.abs(r.cents) * 100000) / totalAbs;
    const floor = Math.floor(exact);
    return { ...r, milliPercent: floor, remainder: exact - floor };
  });

  let shortfall = 100000 - scaled.reduce((a, b) => a + b.milliPercent, 0);
  const order = [...scaled].sort((a, b) => b.remainder - a.remainder);
  for (const item of order) {
    if (shortfall <= 0) break;
    item.milliPercent += 1;
    shortfall -= 1;
  }

  return scaled.map(({ key, label, cents, milliPercent, meaning }) => ({
    key, label, cents, milliPercent, meaning,
  }));
}

// ===========================================================================
// 13) SELF-TESTS
// ===========================================================================

function ok(cond: boolean, label: string): void {
  if (!cond) throw new Error(`vendor-bill-core self-test FAILED: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`vendor-bill-core self-test FAILED: ${label} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function __runVendorBillCoreTests(): void {
  // ── AUTHORITIES ────────────────────────────────────────────────────────
  ok(AUTHORITIES.length >= 18, "the authority library is populated");
  {
    const ids = new Set<string>();
    for (const a of AUTHORITIES) {
      ok(!ids.has(a.id), `authority id ${a.id} is unique`);
      ids.add(a.id);
      ok(a.cite.trim().length > 0, `${a.id} has a citation`);
      ok(a.quote.trim().length > 20, `${a.id} has substantive quoted text`);
      ok(a.soWhat.trim().length > 20, `${a.id} explains why it matters`);
      ok(a.source.trim().length > 0, `${a.id} says where to read it`);
    }
  }

  // The §280E text is the single most important string in the module. If a
  // well-meaning edit ever paraphrases it, this fails loudly.
  {
    const s280e = findAuthority("IRC_280E")!;
    ok(s280e.quote.startsWith("No deduction or credit shall be allowed"), "§280E opens verbatim");
    ok(s280e.quote.includes("trafficking in controlled substances"), "§280E includes the trafficking clause");
    ok(s280e.quote.includes("prohibited by Federal law or the law of any State"), "§280E includes the federal-OR-state clause");
    ok(!s280e.quote.includes("cost of goods"), "§280E says nothing about COGS — that silence is the point");
  }
  {
    // The reseller rule. Every word of the possession clause earns money.
    const r = findAuthority("REG_1_471_3_B")!;
    ok(r.quote.includes("the invoice price less trade or other discounts"), "1.471-3(b) has the invoice-price rule");
    ok(r.quote.includes("strictly cash discounts approximating a fair interest rate"), "1.471-3(b) has the cash-discount exception");
    ok(r.quote.includes("transportation or other necessary charges incurred in acquiring possession of the goods"),
      "1.471-3(b) has the possession clause — the freight-in authority");
    ok(r.quote.includes("provided a consistent course is followed"), "1.471-3(b) has the consistency requirement");
  }
  {
    const c = findAuthority("REG_1_471_3_C")!;
    ok(c.quote.includes("but not including any cost of selling or return on capital"),
      "1.471-3(c) excludes selling costs even for producers");
  }
  {
    const flush = findAuthority("IRC_263A_FLUSH")!;
    ok(flush.quote.includes("could not be taken into account in computing taxable income"),
      "the 263A flush language is verbatim");
  }
  {
    const cca = findAuthority("CCA_201504011")!;
    ok(cca.quote.includes("Section 263A is a timing provision"), "CCA 201504011 timing-provision holding");
    ok(cca.quote.includes("does not change the character of any expense"), "CCA 201504011 character holding");
  }
  {
    const sen = findAuthority("SENATE_REPORT_97_494")!;
    ok(sen.quote.includes("To preclude possible challenges on constitutional grounds"),
      "the Senate report's constitutional-avoidance sentence is present");
  }
  {
    const alp = findAuthority("ALPENGLOW_EXCLUSION")!;
    ok(alp.quote.includes("well-recognized exclusion"), "Alpenglow exclusion-vs-deduction line present");
  }
  {
    const gaap = findAuthority("ASC_330_10_30_1")!;
    ok(gaap.quote.includes("bringing an article to its existing condition and location"),
      "ASC 330 condition-and-location language present");
    eq(gaap.kind, "gaap", "ASC 330 is tagged as GAAP");
  }
  {
    const rcw = findAuthority("RCW_69_50_535")!;
    ok(rcw.quote.includes("thirty-seven percent"), "RCW 69.50.535 states the 37% rate");
    ok(rcw.quote.includes("not part of the total retail price"), "RCW 69.50.535 excise-is-not-retail-price clause");
  }
  eq(findAuthority("NOPE_NOT_REAL"), undefined, "unknown authority id returns undefined");

  // citeAuthorities drops unknown ids rather than emitting "undefined".
  eq(citeAuthorities(["IRC_280E"]), "26 U.S.C. §280E", "single citation renders");
  ok(citeAuthorities(["IRC_280E", "GARBAGE"]) === "26 U.S.C. §280E", "unknown ids are dropped, not rendered");
  eq(citeAuthorities([]), "", "no ids renders empty");
  eq(citeAuthorities(["GARBAGE"]), "", "only-unknown renders empty, never 'undefined'");
  ok(citeAuthorities(["IRC_280E", "REG_1_471_3_B"]).includes("; "), "multiple citations are separated");

  // ── PURCHASE TAXONOMY ─────────────────────────────────────────────────
  {
    const codes = new Set<string>();
    for (const k of PURCHASE_KINDS) {
      ok(!codes.has(k.code), `purchase kind ${k.code} is unique`);
      codes.add(k.code);
      ok(k.label.trim().length > 2, `${k.code} has a label`);
      ok(k.why.trim().length > 20, `${k.code} explains itself`);
      ok(k.authorityIds.length > 0, `${k.code} cites at least one authority`);
      for (const id of k.authorityIds) {
        ok(findAuthority(id) !== undefined, `${k.code} cites a REAL authority (${id})`);
      }
      ok(/^[1-9][0-9]{4}$/.test(k.debitAccountCode), `${k.code} names a 5-digit account (${k.debitAccountCode})`);
    }
  }

  // Account codes must exist in the seeded chart. These are transcribed from
  // migrations 0173 and 0178 — a typo here would create a phantom account
  // reference that only fails in production.
  {
    const SEEDED = new Set([
      "20000", "20010", "20020", "20030", "20040", "20050", "20060", "20070", "20080", "20090",
      "20100", "20120", "20130", "20140", "20150", "20160", "20170", "20180", "20190",
      "20200", "20210", "20220", "20800", "20810", "20890",
      "21500", "21600", "21700",
      "30000", "32000", "32100",
      "60800", "60810", "60900",
      "70010", "70020", "70030", "70050", "70060",
      "72010", "73010", "73020", "74010", "75010", "75020", "76020", "76040", "76060",
    ]);
    for (const k of PURCHASE_KINDS) {
      ok(SEEDED.has(k.debitAccountCode), `${k.code} posts to a seeded account (${k.debitAccountCode})`);
    }
    ok(SEEDED.has(AP_ACCOUNT_CODE), "the AP account is seeded");
  }

  // COGS accounts may only ever carry a COGS cost class — mirrors
  // gl_accounts_cogs_cost_class_chk in 0173. A kind that violated this would be
  // rejected by the database at post time, which is a terrible place to find out.
  for (const k of PURCHASE_KINDS) {
    if (k.debitAccountCode.startsWith("6")) {
      ok(k.costClass === "cogs_direct" || k.costClass === "cogs_allocable",
        `${k.code} posts to a 6xxxx COGS account so it must carry a COGS cost class (has ${k.costClass})`);
    }
    if (k.debitAccountCode.startsWith("2") || k.debitAccountCode.startsWith("3")) {
      eq(k.costClass, "none", `${k.code} posts to a balance-sheet account so it carries no 280E class`);
    }
    if (k.debitAccountCode.startsWith("7")) {
      eq(k.costClass, "nondeductible_280e", `${k.code} is a 7xxxx operating expense, default 280E class`);
    }
  }

  eq(findPurchaseKind("freight_in")!.treatment, "inventory", "freight-in is inventoriable");
  eq(findPurchaseKind("freight_in")!.debitAccountCode, "60800", "freight-in posts to 60800");
  eq(findPurchaseKind("rent")!.treatment, "expense", "rent is a disallowed operating expense");
  eq(findPurchaseKind("excise_remittance")!.treatment, "trust", "excise is trust money");
  eq(findPurchaseKind("excise_remittance")!.debitAccountCode, "32000", "excise clears the 32000 liability");
  eq(findPurchaseKind("equipment")!.treatment, "asset", "equipment capitalises");
  eq(findPurchaseKind("unknown")!.debitAccountCode, "20890", "unknown quarantines to 20890");
  eq(findPurchaseKind("testing_on_purchase")!.treatment, "quarantine", "contested testing is quarantined, not guessed");
  eq(findPurchaseKind("nope"), undefined, "unknown kind code returns undefined");

  ok(inventoriableKindCodes().includes("cannabis_product"), "product is in the inventoriable list");
  ok(inventoriableKindCodes().includes("freight_in"), "freight is in the inventoriable list");
  ok(!inventoriableKindCodes().includes("rent"), "rent is NOT inventoriable");
  ok(disallowedKindCodes().includes("advertising"), "advertising is disallowed");
  ok(!disallowedKindCodes().includes("cannabis_product"), "product is not in the disallowed list");

  // The trap documentation is the teaching layer. These specific traps are the
  // ones that cost real money, so their presence is asserted, not hoped for.
  ok(findPurchaseKind("freight_in")!.commonMistake!.includes("76030"),
    "the freight trap names the wrong account explicitly");
  ok(findPurchaseKind("rent")!.commonMistake!.includes("263A"),
    "the rent-allocation trap cites the 263A problem");
  ok(findPurchaseKind("excise_remittance")!.commonMistake!.includes("REVENUE"),
    "the excise trap names the historical revenue-credit error");

  // ── DE MINIMIS PARITY ─────────────────────────────────────────────────
  eq(DE_MINIMIS_CAPITALISATION_CENTS, 250000, "de minimis threshold is $2,500 in cents");

  // ── CATEGORY MIRROR ───────────────────────────────────────────────────
  eq(CATEGORY_SLOTS.length, 21, "all 21 house categories are present");
  eq(inventoryAccountForCategory("flower"), "20010", "flower maps to 20010");
  eq(inventoryAccountForCategory("concentrate"), "20140", "concentrate maps to 20140");
  eq(inventoryAccountForCategory("infused-blunt"), "20100", "slot 100 zero-pads to 20100 not 2100");
  eq(inventoryAccountForCategory("merch"), "20220", "merch maps to 20220");
  eq(inventoryAccountForCategory("not-a-category"), null, "unknown category returns null, never a guess");
  eq(inventoryAccountForCategory(""), null, "empty category returns null");
  {
    const slots = new Set<number>();
    for (const c of CATEGORY_SLOTS) {
      ok(!slots.has(c.slot), `category slot ${c.slot} is unique`);
      slots.add(c.slot);
      ok(/^2[0-9]{4}$/.test(inventoryAccountForCategory(c.slug)!), `${c.slug} yields a block-2 account`);
    }
  }

  // ── MONEY FORMATTING ──────────────────────────────────────────────────
  eq(formatCents(0), "$0.00", "zero formats");
  eq(formatCents(5), "$0.05", "five cents formats");
  eq(formatCents(4523), "$45.23", "dollars and cents");
  eq(formatCents(100000), "$1,000.00", "thousands separator");
  eq(formatCents(123456789), "$1,234,567.89", "millions separators");
  eq(formatCents(-4523), "-$45.23", "negative sign sits outside the dollar sign");
  eq(formatCents(-438834806), "-$4,388,348.06", "the real Sage inventory hole formats");

  // ── DATES ─────────────────────────────────────────────────────────────
  ok(isValidIsoDate("2026-11-01"), "cut-over date is valid");
  ok(isValidIsoDate("2024-02-29"), "2024 leap day valid");
  ok(!isValidIsoDate("2026-02-29"), "2026 has no 29 February");
  ok(!isValidIsoDate("2026-11-31"), "November has 30 days");
  ok(!isValidIsoDate("2026-13-01"), "month 13 invalid");
  ok(!isValidIsoDate("2026-00-10"), "month 0 invalid");
  ok(!isValidIsoDate("2026-01-00"), "day 0 invalid");
  ok(!isValidIsoDate("11/01/2026"), "US format rejected");
  ok(!isValidIsoDate(""), "empty rejected");
  ok(isValidIsoDate("2000-02-29"), "2000 is a leap year");
  ok(!isValidIsoDate("1900-02-29"), "1900 is not a leap year");

  // ── WHOLE-WORD MATCHING (the "drawer"/"draw" class of bug) ────────────
  ok(mentionsAny("Freight charge", FREIGHT_WORDS), "freight is detected");
  ok(mentionsAny("FREIGHT", FREIGHT_WORDS), "detection is case-insensitive");
  ok(mentionsAny("inbound delivery, 2 pallets", FREIGHT_WORDS), "delivery is detected inside a phrase");
  ok(!mentionsAny("freighted", FREIGHT_WORDS), "'freighted' is not 'freight'");
  ok(!mentionsAny("transportation", ["transport"]), "'transportation' is not the word 'transport'");
  ok(!mentionsAny("current rent statement", ["curren"]), "partial words do not match");
  ok(mentionsAny("Volume discount", DISCOUNT_WORDS), "discount is detected");
  ok(!mentionsAny("discounted", DISCOUNT_WORDS), "'discounted' is not 'discount'");
  ok(mentionsAny("child-resistant exit bags", PACKAGING_WORDS), "hyphenated packaging terms match");
  ok(mentionsAny("Display Case, oak", EQUIPMENT_WORDS), "multi-word equipment terms match");
  ok(!mentionsAny("", FREIGHT_WORDS), "empty text matches nothing");

  // ── CLASSIFICATION ────────────────────────────────────────────────────
  {
    // Explicit choice always wins over keywords, even contradictory ones.
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: "rent", amountCents: 500000, description: "freight delivery shipping" },
      { entityCode: "greenway" },
    );
    eq(c.kindCode, "rent", "an explicit kind is never overridden by keywords");
    eq(c.treatment, "expense", "explicit rent stays an expense");
    eq(c.band, "certain", "an explicit choice is certain");
  }
  {
    const c = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 25000, description: "Freight" }, { entityCode: "greenway" });
    eq(c.kindCode, "freight_in", "freight keyword classifies to freight_in");
    eq(c.accountCode, "60800", "freight resolves to 60800");
    eq(c.costClass, "cogs_direct", "freight carries cogs_direct");
    eq(c.band, "likely", "a keyword match is 'likely', never 'certain'");
  }
  {
    // Negative + discount word => discount. Positive + discount word must NOT,
    // because a positive "discount" line is more likely a mislabelled charge.
    const neg = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: -5000, description: "Volume discount" }, { entityCode: "greenway" });
    eq(neg.kindCode, "purchase_discount", "a negative discount line classifies as a trade discount");
    const pos = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 5000, description: "Volume discount" }, { entityCode: "greenway" });
    ok(pos.kindCode !== "purchase_discount", "a POSITIVE 'discount' line is not treated as a discount");
  }
  {
    // Discounts are tested before freight: "delivery discount" is a discount.
    const c = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: -2500, description: "delivery discount" }, { entityCode: "greenway" });
    eq(c.kindCode, "purchase_discount", "discount beats freight when both words appear");
  }
  {
    const c = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 12000, description: "exit bags" }, { entityCode: "greenway" });
    eq(c.kindCode, "product_packaging", "exit bags are product packaging, not store supplies");
    eq(c.treatment, "inventory", "product packaging is inventoriable");
  }
  {
    // Equipment only when it clears the de minimis threshold.
    const big = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 600000, description: "display case" }, { entityCode: "greenway" });
    eq(big.kindCode, "equipment", "a $6,000 display case is equipment");
    const small = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 9900, description: "display case" }, { entityCode: "greenway" });
    ok(small.kindCode !== "equipment", "a $99 display-case item does not auto-capitalise");
    // Boundary: exactly at the threshold capitalises (>= not >).
    const exact = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: DE_MINIMIS_CAPITALISATION_CENTS, description: "safe" }, { entityCode: "greenway" });
    eq(exact.kindCode, "equipment", "exactly at the de minimis ceiling capitalises");
    const justUnder = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: DE_MINIMIS_CAPITALISATION_CENTS - 1, description: "safe" }, { entityCode: "greenway" });
    ok(justUnder.kindCode !== "equipment", "one cent under the ceiling does not capitalise");
  }
  {
    // Licensed cannabis vendor is a signal, but only for positive amounts.
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: null, amountCents: 300000, description: "Blue Dream", categorySlug: "flower" },
      { entityCode: "greenway", vendorIsLicensedCannabis: true },
    );
    eq(c.kindCode, "cannabis_product", "a licensed vendor's positive charge is product");
    eq(c.accountCode, "20010", "product resolves to the CATEGORY account, not the control account");
    eq(c.costClass, "none", "inventory carries no 280E class on the balance sheet");
  }
  {
    // No category => quarantine, NOT the control account. This is the 20009 lesson.
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 300000, description: "Blue Dream" },
      { entityCode: "greenway" },
    );
    eq(c.accountCode, "20890", "product with no category quarantines rather than hitting 20000");
    eq(c.treatment, "quarantine", "and its treatment degrades to quarantine");
    eq(c.band, "unsure", "and confidence degrades to unsure even though the kind was explicit");
  }
  {
    const c = classifyLine({ lineNo: 1, purchaseKindCode: null, amountCents: 4200, description: "misc" }, { entityCode: "greenway" });
    eq(c.kindCode, "unknown", "an unrecognisable line is 'unknown'");
    eq(c.accountCode, "20890", "and goes to quarantine");
    eq(c.band, "unsure", "and says it is unsure");
  }
  {
    const c = classifyLine({ lineNo: 1, purchaseKindCode: "not_a_real_kind", amountCents: 100, description: "" }, { entityCode: "greenway" });
    eq(c.kindCode, "unknown", "an invalid explicit kind degrades to unknown");
    eq(c.treatment, "quarantine", "and quarantines");
  }
  {
    // ENTITY ASYMMETRY: the same rent line is disallowed for greenway and
    // ordinary for the separate businesses. This is CHAMP, in code.
    const gw = classifyLine({ lineNo: 1, purchaseKindCode: "rent", amountCents: 100000 }, { entityCode: "greenway" });
    eq(gw.costClass, "nondeductible_280e", "greenway rent is disallowed");
    const atm = classifyLine({ lineNo: 1, purchaseKindCode: "rent", amountCents: 100000 }, { entityCode: "atm" });
    eq(atm.costClass, "separate_business", "ATM rent is a separate business cost");
    const land = classifyLine({ lineNo: 1, purchaseKindCode: "rent", amountCents: 100000 }, { entityCode: "landholding" });
    eq(land.costClass, "separate_business", "landholding rent is a separate business cost");
    const pers = classifyLine({ lineNo: 1, purchaseKindCode: "rent", amountCents: 100000 }, { entityCode: "personal" });
    eq(pers.costClass, "personal", "personal rent is personal");
    // But a balance-sheet class is NEVER rewritten by entity.
    const frt = classifyLine({ lineNo: 1, purchaseKindCode: "freight_in", amountCents: 1000 }, { entityCode: "atm" });
    eq(frt.costClass, "cogs_direct", "a COGS class is not rewritten by entity");
    const exc = classifyLine({ lineNo: 1, purchaseKindCode: "excise_remittance", amountCents: 1000 }, { entityCode: "personal" });
    eq(exc.costClass, "none", "trust money carries no class in any entity");
  }

  // ── HARD BLOCK LIST IS SMALL AND STABLE ───────────────────────────────
  eq(BILL_HARD_BLOCKS.length, 10, "there are exactly 10 hard blocks — pushback is advice, blocks are law");
  ok(BILL_HARD_BLOCKS.includes("BILL_TOTAL_MISMATCH"), "a bill that does not tie is refused");
  ok(!BILL_HARD_BLOCKS.includes("BILL_UNCLASSIFIED"), "an unclassified line is a CONFIRM, not a block");
  ok(!BILL_HARD_BLOCKS.includes("BILL_FREIGHT_AS_EXPENSE"), "the freight warning teaches, it does not block");
  ok(!BILL_HARD_BLOCKS.includes("BILL_LOOKS_CAPITAL"), "the capitalisation warning teaches, it does not block");
  ok(new Set(BILL_HARD_BLOCKS).size === BILL_HARD_BLOCKS.length, "no duplicate hard-block codes");
  // DRIFT GUARD (both directions). The sweep below proves every block the engine
  // RAISES is registered. This proves every code registered is one the engine can
  // actually RAISE — a registry entry nothing emits is a lie in the docs, and a
  // block the engine emits but the registry omits is how this list rotted the
  // first time. Source-of-truth: the emit sites themselves.
  {
    const emitted = [
      "BILL_NO_LINES", "BILL_TOTAL_MISMATCH", "BILL_NO_INVOICE_NUMBER", "BILL_NO_VENDOR",
      "BILL_BAD_DATE", "BILL_ZERO_LINE", "BILL_UNKNOWN_KIND", "BILL_CANNABIS_NO_CATEGORY",
      "BILL_PERIOD_CLOSED", "BILL_CANNABIS_WRONG_ENTITY",
    ];
    for (const code of emitted) {
      ok(BILL_HARD_BLOCKS.includes(code), `engine block ${code} is registered in BILL_HARD_BLOCKS`);
    }
    for (const code of BILL_HARD_BLOCKS) {
      ok(emitted.includes(code), `registered block ${code} is actually emitted by the engine`);
    }
  }

  // ── EVALUATION: a clean, realistic bill ───────────────────────────────
  const cleanBill: VendorBillInput = {
    entityCode: "greenway",
    vendorName: "Cascade Cannabis Co",
    invoiceNumber: "INV-88231",
    invoiceDate: "2026-11-03",
    statedTotalCents: 425000,
    fromAcceptedManifest: true,
    manifestNumber: "M-2026-11-03-004",
    lines: [
      { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 300000, description: "Blue Dream 1/8", categorySlug: "flower" },
      { lineNo: 2, purchaseKindCode: "cannabis_product", amountCents: 100000, description: "Live resin", categorySlug: "concentrate" },
      { lineNo: 3, purchaseKindCode: "freight_in", amountCents: 25000, description: "Inbound freight" },
    ],
  };
  {
    const v = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    ok(v.postable, "a clean, tying, manifested bill is postable");
    eq(v.computedTotalCents, 425000, "the computed total matches the stated total");
    eq(v.inventoriableCents, 425000, "ALL of this bill is inventoriable — product plus freight-in");
    eq(v.disallowedCents, 0, "nothing on this bill is disallowed");
    eq(v.quarantinedCents, 0, "nothing is quarantined");
    ok(!v.findings.some((f) => f.severity === "block"), "no blocks on a clean bill");
    eq(v.classifications[0].accountCode, "20010", "line 1 → flower inventory");
    eq(v.classifications[1].accountCode, "20140", "line 2 → concentrate inventory");
    eq(v.classifications[2].accountCode, "60800", "line 3 → freight-in");
  }

  // ── EVALUATION: total mismatch blocks, and teaches ────────────────────
  {
    const bad: VendorBillInput = { ...cleanBill, statedTotalCents: 460000 };
    const v = evaluateVendorBill(bad, { vendorIsLicensedCannabis: true });
    ok(!v.postable, "a bill whose lines do not tie is refused");
    const f = v.findings.find((x) => x.code === "BILL_TOTAL_MISMATCH")!;
    ok(f !== undefined, "the mismatch is reported");
    eq(f.severity, "block", "and it is a hard block");
    ok(f.concern.includes("$4,250.00"), "the finding shows the computed total in dollars");
    ok(f.concern.includes("$4,600.00"), "and the stated total");
    ok(f.concern.includes("$350.00"), "and the difference");
    ok(f.workedExample !== undefined && f.workedExample.length > 0, "and it SHOWS how to fix it");
    ok(f.fix.includes("do NOT add a balancing line"), "and warns against the plug entry specifically");
  }

  // ── EVALUATION: substantiation blocks ─────────────────────────────────
  {
    const v = evaluateVendorBill({ ...cleanBill, invoiceNumber: "   " }, {});
    ok(!v.postable, "a bill with a blank invoice number is refused");
    ok(v.findings.some((f) => f.code === "BILL_NO_INVOICE_NUMBER"), "and says why");
  }
  {
    const v = evaluateVendorBill({ ...cleanBill, vendorName: "" }, {});
    ok(!v.postable, "a bill with no vendor is refused");
    ok(v.findings.some((f) => f.code === "BILL_NO_VENDOR"), "and says why");
  }
  {
    const v = evaluateVendorBill({ ...cleanBill, invoiceDate: "2026-02-30" }, {});
    ok(!v.postable, "an impossible date is refused");
    ok(v.findings.some((f) => f.code === "BILL_BAD_DATE"), "and named");
  }
  {
    const v = evaluateVendorBill({ ...cleanBill, lines: [], statedTotalCents: 0 }, {});
    ok(!v.postable, "an empty bill is refused");
    ok(v.findings.some((f) => f.code === "BILL_NO_LINES"), "and named");
  }
  {
    const v = evaluateVendorBill(
      { ...cleanBill, statedTotalCents: 425000, lines: [...cleanBill.lines, { lineNo: 4, purchaseKindCode: "rent", amountCents: 0 }] },
      {},
    );
    ok(!v.postable, "a zero-amount line is refused");
    ok(v.findings.some((f) => f.code === "BILL_ZERO_LINE"), "and named");
  }
  {
    const v = evaluateVendorBill(
      {
        ...cleanBill,
        statedTotalCents: 300000,
        lines: [{ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 300000, description: "flower" }],
      },
      {},
    );
    ok(!v.postable, "cannabis product with no category is refused");
    const f = v.findings.find((x) => x.code === "BILL_CANNABIS_NO_CATEGORY")!;
    ok(f !== undefined, "and named");
    ok(f.workedExample!.some((l) => l.includes("20010")), "and the example shows real account codes");
  }
  {
    const v = evaluateVendorBill(
      {
        ...cleanBill,
        statedTotalCents: 100,
        lines: [{ lineNo: 1, purchaseKindCode: "wharrgarbl", amountCents: 100, description: "x" }],
      },
      {},
    );
    ok(!v.postable, "an unknown purchase kind is refused");
    ok(v.findings.some((f) => f.code === "BILL_UNKNOWN_KIND"), "and named");
  }
  {
    // Wrong entity for cannabis product.
    const v = evaluateVendorBill({ ...cleanBill, entityCode: "atm" }, { vendorIsLicensedCannabis: true });
    ok(!v.postable, "cannabis product in the ATM books is refused");
    const f = v.findings.find((x) => x.code === "BILL_CANNABIS_WRONG_ENTITY")!;
    ok(f !== undefined, "and named");
    ok(f.authorityIds.includes("CHAMP"), "and cites CHAMP, because entity separation is what CHAMP protects");
  }
  {
    const v = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true, periodClosed: true });
    ok(!v.postable, "posting into a closed period is refused");
    ok(v.findings.some((f) => f.code === "BILL_PERIOD_CLOSED"), "and named");
  }

  // ── EVALUATION: confirms teach rather than block ───────────────────────
  {
    // Freight mis-coded to outbound shipping: warn, cite, show the fix, POST.
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Puget Freight",
      invoiceNumber: "PF-1",
      invoiceDate: "2026-11-05",
      statedTotalCents: 25000,
      lines: [{ lineNo: 1, purchaseKindCode: "store_supplies", amountCents: 25000, description: "inbound delivery" }],
    };
    const v = evaluateVendorBill(bill, {});
    ok(v.postable, "the freight warning does NOT block — Michael stays in control");
    ok(v.needsAcknowledgement, "but it must be acknowledged");
    const f = v.findings.find((x) => x.code === "BILL_FREIGHT_AS_EXPENSE")!;
    ok(f !== undefined, "the freight mis-coding is caught");
    eq(f.severity, "confirm", "as a confirm");
    ok(f.authorityIds.includes("REG_1_471_3_B"), "citing the reseller rule");
    ok(f.workedExample!.some((l) => l.includes("60800")), "and showing 60800 as the right home");
    ok(f.workedExample!.some((l) => l.includes("WRONG")), "with the wrong way shown for contrast");
    ok(f.workedExample!.some((l) => l.includes("RIGHT")), "and the right way");
  }
  {
    // Big equipment coded as an expense: warn and show the correct journal.
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Store Fixtures Inc",
      invoiceNumber: "SF-9",
      invoiceDate: "2026-11-05",
      statedTotalCents: 600000,
      lines: [{ lineNo: 1, purchaseKindCode: "store_supplies", amountCents: 600000, description: "oak display case" }],
    };
    const v = evaluateVendorBill(bill, {});
    ok(v.postable, "the capitalisation warning does not block");
    const f = v.findings.find((x) => x.code === "BILL_LOOKS_CAPITAL")!;
    ok(f !== undefined, "a large equipment-shaped expense is questioned");
    ok(f.workedExample!.some((l) => l.includes("21600")), "and 21600 is shown as the right account");
  }
  {
    // Contested lab testing: confirm, with BOTH positions explained.
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Confidence Analytics",
      invoiceNumber: "CA-77",
      invoiceDate: "2026-11-06",
      statedTotalCents: 18000,
      lines: [{ lineNo: 1, purchaseKindCode: "testing_on_purchase", amountCents: 18000, description: "potency panel" }],
    };
    const v = evaluateVendorBill(bill, {});
    const f = v.findings.find((x) => x.code === "BILL_TESTING_JUDGMENT")!;
    ok(f !== undefined, "contested testing raises a judgment finding");
    eq(f.severity, "confirm", "as a confirm, not a block — it is Michael's call");
    ok(f.why.includes("acquiring possession"), "explaining the inventoriable argument");
    ok(f.why.includes("already own"), "and the expense argument");
    ok(f.authorityIds.includes("IRC_263A_FLUSH"), "and citing the 263A trap door");
    eq(v.quarantinedCents, 18000, "and the money sits in quarantine until decided");
  }
  {
    // Cannabis purchase with no manifest: confirm, both reasons given.
    const v = evaluateVendorBill({ ...cleanBill, fromAcceptedManifest: false, manifestNumber: null }, { vendorIsLicensedCannabis: true });
    const f = v.findings.find((x) => x.code === "BILL_CANNABIS_NO_MANIFEST")!;
    ok(f !== undefined, "a manifest-less cannabis purchase is questioned");
    eq(f.severity, "confirm", "as a confirm");
    ok(f.why.includes("preserved"), "citing the record-preservation requirement");
  }
  {
    // The always-on teaching summary appears whenever there is disallowed money.
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Kitsap Power",
      invoiceNumber: "KP-3",
      invoiceDate: "2026-11-07",
      statedTotalCents: 80000,
      lines: [{ lineNo: 1, purchaseKindCode: "utilities", amountCents: 80000, description: "November power" }],
    };
    const v = evaluateVendorBill(bill, {});
    ok(v.postable, "a plain utility bill posts");
    const f = v.findings.find((x) => x.code === "BILL_280E_SUMMARY")!;
    ok(f !== undefined, "the 280E summary is attached");
    eq(f.severity, "advise", "as advice, never a blocker");
    ok(f.concern.includes("$800.00"), "showing the disallowed amount");
    ok(f.authorityIds.includes("SENATE_REPORT_97_494"), "and citing why COGS is carved out at all");
    eq(v.disallowedCents, 80000, "and the bucket math is right");
  }
  {
    // No disallowed money => no summary noise. Signal discipline matters: a
    // warning that appears on every entry is a warning nobody reads.
    const v = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    ok(!v.findings.some((f) => f.code === "BILL_280E_SUMMARY"), "no 280E summary when nothing is disallowed");
  }

  // ── EVERY FINDING IS WELL-FORMED ──────────────────────────────────────
  {
    const scenarios: [VendorBillInput, { vendorIsLicensedCannabis?: boolean; periodClosed?: boolean }][] = [
      [cleanBill, { vendorIsLicensedCannabis: true }],
      [{ ...cleanBill, statedTotalCents: 1 }, {}],
      [{ ...cleanBill, invoiceNumber: "" }, {}],
      [{ ...cleanBill, vendorName: "" }, {}],
      [{ ...cleanBill, invoiceDate: "nope" }, {}],
      [{ ...cleanBill, lines: [], statedTotalCents: 0 }, {}],
      [{ ...cleanBill, entityCode: "atm" }, { vendorIsLicensedCannabis: true }],
      [cleanBill, { periodClosed: true, vendorIsLicensedCannabis: true }],
      [{ ...cleanBill, fromAcceptedManifest: false }, { vendorIsLicensedCannabis: true }],
      [{
        entityCode: "greenway", vendorName: "V", invoiceNumber: "1", invoiceDate: "2026-11-01",
        statedTotalCents: 4200, lines: [{ lineNo: 1, purchaseKindCode: null, amountCents: 4200, description: "mystery" }],
      }, {}],
    ];
    for (const [bill, ctx] of scenarios) {
      const v = evaluateVendorBill(bill, ctx);
      for (const f of v.findings) {
        ok(f.code.startsWith("BILL_"), `finding code ${f.code} is namespaced`);
        ok(["block", "confirm", "advise"].includes(f.severity), `${f.code} has a valid severity`);
        ok(f.concern.trim().length > 10, `${f.code} states a concern`);
        ok(f.why.trim().length > 20, `${f.code} EXPLAINS WHY — Michael's standing requirement`);
        ok(f.fix.trim().length > 10, `${f.code} SHOWS THE FIX — never just "review this"`);
        for (const id of f.authorityIds) {
          ok(findAuthority(id) !== undefined, `${f.code} cites a real authority (${id})`);
        }
        if (f.severity === "block") {
          ok(BILL_HARD_BLOCKS.includes(f.code), `${f.code} blocks, so it must be in BILL_HARD_BLOCKS`);
        }
      }
      // postable must be exactly "no blocks present".
      eq(v.postable, !v.findings.some((f) => f.severity === "block"), "postable is exactly 'no blocks'");
      eq(v.needsAcknowledgement, v.findings.some((f) => f.severity === "confirm"), "needsAcknowledgement is exactly 'has confirms'");
    }
  }

  // ── BUCKET MATH IS EXHAUSTIVE ─────────────────────────────────────────
  {
    // Every dollar must land in exactly one bucket. If the buckets do not sum to
    // the bill total, money is being invented or lost.
    const mixed: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Mixed Supply Co",
      invoiceNumber: "MS-1",
      invoiceDate: "2026-11-10",
      statedTotalCents: 1_000_00 + 250_00 + 600_000 + 80_000 + 4200 - 5000,
      lines: [
        { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, description: "flower", categorySlug: "flower" },
        { lineNo: 2, purchaseKindCode: "freight_in", amountCents: 25000, description: "freight" },
        { lineNo: 3, purchaseKindCode: "equipment", amountCents: 600000, description: "safe" },
        { lineNo: 4, purchaseKindCode: "utilities", amountCents: 80000, description: "power" },
        { lineNo: 5, purchaseKindCode: null, amountCents: 4200, description: "mystery item" },
        { lineNo: 6, purchaseKindCode: "purchase_discount", amountCents: -5000, description: "volume discount" },
      ],
    };
    const v = evaluateVendorBill(mixed, {});
    const bucketSum =
      v.inventoriableCents + v.disallowedCents + v.capitalisedCents + v.trustCents + v.quarantinedCents;
    eq(bucketSum, v.computedTotalCents, "the five buckets account for every cent of the bill");
    eq(v.inventoriableCents, 100000 + 25000 - 5000, "product + freight − discount is the inventoriable total");
    eq(v.capitalisedCents, 600000, "the safe capitalises");
    eq(v.disallowedCents, 80000, "power is disallowed");
    eq(v.quarantinedCents, 4200, "the mystery line is quarantined");
    eq(v.trustCents, 0, "no trust money here");
  }
  {
    // Trust money bucket, on its own.
    const bill: VendorBillInput = {
      entityCode: "greenway", vendorName: "WSLCB", invoiceNumber: "EX-2026-10",
      invoiceDate: "2026-11-20", statedTotalCents: 4500000,
      lines: [{ lineNo: 1, purchaseKindCode: "excise_remittance", amountCents: 4500000, description: "October excise" }],
    };
    const v = evaluateVendorBill(bill, {});
    eq(v.trustCents, 4500000, "excise remittance is trust money");
    eq(v.disallowedCents, 0, "and is NOT an expense");
    eq(v.inventoriableCents, 0, "and is NOT inventory");
    ok(!v.findings.some((f) => f.code === "BILL_280E_SUMMARY"), "trust money triggers no 280E summary");
  }

  // ── JOURNAL CONSTRUCTION ──────────────────────────────────────────────
  {
    const v = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    const j = buildBillJournal(cleanBill, v)!;
    ok(j !== null, "a postable bill produces a journal");
    eq(j.sourceKind, "purchase", "vendor bills post as source_kind 'purchase'");
    eq(j.entityCode, "greenway", "in the greenway books");
    eq(j.journalDate, "2026-11-03", "on the invoice date");
    eq(j.lines.length, 4, "three cost lines plus one AP credit");
    ok(journalIsBalanced(j), "THE JOURNAL BALANCES — debits equal credits");
    const ap = j.lines[j.lines.length - 1];
    eq(ap.accountCode, AP_ACCOUNT_CODE, "the last line is accounts payable");
    eq(ap.amountCents, -425000, "credited for the full invoice total");
    eq(ap.costClass, "none", "AP carries no 280E class");
    ok(ap.description.includes("INV-88231"), "and names the invoice for traceability");
    // Manifest wins as the idempotency key.
    eq(j.sourceRef, "manifest:M-2026-11-03-004", "the manifest number is the idempotency ref");
  }
  {
    // A refused bill must NOT produce a journal. This is the guard that stops a
    // caller from posting something the engine rejected.
    const bad: VendorBillInput = { ...cleanBill, statedTotalCents: 999999 };
    const v = evaluateVendorBill(bad, { vendorIsLicensedCannabis: true });
    eq(buildBillJournal(bad, v), null, "a refused bill yields NO journal, ever");
  }
  {
    // No manifest => vendor:invoice key, slugified and stable.
    const bill: VendorBillInput = {
      entityCode: "greenway", vendorName: "  Kitsap Power Co. ", invoiceNumber: " KP/2026-11 ",
      invoiceDate: "2026-11-07", statedTotalCents: 80000,
      lines: [{ lineNo: 1, purchaseKindCode: "utilities", amountCents: 80000, description: "power" }],
    };
    eq(billSourceRef(bill), "bill:kitsap-power-co:kp-2026-11", "the fallback ref is slugified and trimmed");
    const v = evaluateVendorBill(bill, {});
    const j = buildBillJournal(bill, v)!;
    ok(journalIsBalanced(j), "a single-line bill still balances");
    eq(j.lines.length, 2, "one expense line plus AP");
    eq(j.lines[0].accountCode, "70020", "utilities → 70020");
    eq(j.lines[0].costClass, "nondeductible_280e", "and carries the 280E tag");
    // Idempotency must be stable across identical submissions.
    eq(billSourceRef(bill), billSourceRef({ ...bill }), "the ref is deterministic");
  }
  {
    // A discount line makes the journal net correctly on BOTH sides.
    const bill: VendorBillInput = {
      entityCode: "greenway", vendorName: "Cascade", invoiceNumber: "D-1",
      invoiceDate: "2026-11-08", statedTotalCents: 95000,
      lines: [
        { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, description: "flower", categorySlug: "flower" },
        { lineNo: 2, purchaseKindCode: "purchase_discount", amountCents: -5000, description: "volume discount" },
      ],
    };
    const v = evaluateVendorBill(bill, {});
    ok(v.postable, "a bill with a discount posts");
    const j = buildBillJournal(bill, v)!;
    ok(journalIsBalanced(j), "and balances");
    eq(j.lines[1].accountCode, "60900", "the discount hits contra-COGS 60900");
    eq(j.lines[2].amountCents, -95000, "AP is credited NET of the discount");
    eq(v.inventoriableCents, 95000, "and inventoriable cost is net of the trade discount, per 1.471-3(b)");
  }
  {
    // Every postable bill in a spread of shapes must balance. Balance is the one
    // property that can never be traded away.
    const shapes: VendorBillInput[] = [
      cleanBill,
      {
        entityCode: "greenway", vendorName: "A", invoiceNumber: "1", invoiceDate: "2026-11-01",
        statedTotalCents: 1, lines: [{ lineNo: 1, purchaseKindCode: "utilities", amountCents: 1, description: "x" }],
      },
      {
        entityCode: "landholding", vendorName: "B", invoiceNumber: "2", invoiceDate: "2026-12-31",
        statedTotalCents: 123456789,
        lines: [
          { lineNo: 1, purchaseKindCode: "repairs", amountCents: 123456789, description: "roof patch" },
        ],
      },
      {
        entityCode: "greenway", vendorName: "C", invoiceNumber: "3", invoiceDate: "2026-11-15",
        statedTotalCents: 0 + 100 - 100 + 500,
        lines: [
          { lineNo: 1, purchaseKindCode: "freight_in", amountCents: 100, description: "freight" },
          { lineNo: 2, purchaseKindCode: "purchase_discount", amountCents: -100, description: "discount" },
          { lineNo: 3, purchaseKindCode: "bank_fees", amountCents: 500, description: "wire fee" },
        ],
      },
    ];
    for (const s of shapes) {
      const v = evaluateVendorBill(s, {});
      if (!v.postable) continue;
      const j = buildBillJournal(s, v)!;
      ok(journalIsBalanced(j), `journal balances for ${s.vendorName}`);
      ok(j.lines.length >= 2, `journal for ${s.vendorName} has at least two lines — double entry is not optional`);
      eq(j.sourceRef.length > 5, true, `journal for ${s.vendorName} carries an idempotency ref`);
    }
  }

  // ── THREE-WAY MATCH ───────────────────────────────────────────────────
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100000, toleranceCents: 0 }).matched, true,
    "an exact three-way agreement matches at zero tolerance");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100050, toleranceCents: 100 }).matched, true,
    "a 50c gap inside a $1 tolerance matches");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100050, toleranceCents: 49 }).matched, false,
    "a 50c gap outside a 49c tolerance does not match");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100050, toleranceCents: 50 }).matched, true,
    "the tolerance boundary is inclusive");
  eq(threeWayMatch({ orderedCents: null, receivedCents: null, invoicedCents: 100000, toleranceCents: 500 }).code,
    "MATCH_NO_EVIDENCE", "no order and no receipt means no match is possible");
  eq(threeWayMatch({ orderedCents: null, receivedCents: 100000, invoicedCents: 100000, toleranceCents: 0 }).matched, true,
    "a receipt alone can support a match");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: null, invoicedCents: 100000, toleranceCents: 0 }).matched, true,
    "an order alone can support a match");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 90000, invoicedCents: 100000, toleranceCents: 500 }).matched, false,
    "a short shipment is caught even when the invoice matches the order");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 90000, invoicedCents: 100000, toleranceCents: 500 }).worstGapCents, 10000,
    "and the worst gap is reported");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100000, toleranceCents: -1 }).code,
    "MATCH_BAD_TOLERANCE", "a negative tolerance is refused rather than treated as zero");
  eq(threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 99000, toleranceCents: 500 }).matched, false,
    "being UNDER-billed also breaks the match — a gap is a gap");
  {
    const r = threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 120000, toleranceCents: 500 });
    ok(r.reason.includes("$200.00"), "the out-of-tolerance reason quantifies the gap in dollars");
    ok(r.reason.includes("overbilled"), "and names the thing this check protects against");
  }

  // ── DECISION TREE (the visual explainer) ──────────────────────────────
  eq(DECISION_TREE.length, 6, "the decision tree has six questions");
  {
    const ids = new Set<string>();
    for (const n of DECISION_TREE) {
      ok(!ids.has(n.id), `node ${n.id} is unique`);
      ids.add(n.id);
      ok(n.question.trim().endsWith("?"), `${n.id} actually asks a question`);
      ok(n.whyHere.trim().length > 20, `${n.id} explains why it is asked here`);
      ok(n.authorityIds.length > 0, `${n.id} is grounded in authority`);
      for (const a of n.authorityIds) ok(findAuthority(a) !== undefined, `${n.id} cites a real authority (${a})`);
      for (const branch of [n.yes, n.no]) {
        ok(branch.label.trim().length > 5, `${n.id} branch has a label`);
        ok(branch.leafTreatment !== undefined || branch.nextId !== undefined,
          `${n.id} branch either concludes or continues — no dead ends`);
        if (branch.nextId) ok(findDecisionNode(branch.nextId) !== undefined, `${n.id} points at a real next node (${branch.nextId})`);
        if (branch.leafKindCode) ok(findPurchaseKind(branch.leafKindCode) !== undefined, `${n.id} names a real purchase kind`);
      }
    }
  }
  {
    // Walk every path. A teaching diagram with an unreachable branch is a lie,
    // and a diagram that disagrees with the engine is worse than none.
    const trust = walkDecisionTree({ q1_trust: true });
    eq(trust.leafTreatment, "trust", "yes at question 1 lands on trust money");
    eq(trust.path.length, 1, "and stops immediately");

    const product = walkDecisionTree({ q1_trust: false, q2_product: true });
    eq(product.leafTreatment, "inventory", "the product path lands on inventory");

    const freight = walkDecisionTree({ q1_trust: false, q2_product: false, q3_possession: true });
    eq(freight.leafTreatment, "inventory", "the possession path lands on inventory");

    const packaging = walkDecisionTree({ q1_trust: false, q2_product: false, q3_possession: false, q4_with_product: true });
    eq(packaging.leafTreatment, "inventory", "the goes-out-with-product path lands on inventory");

    const asset = walkDecisionTree({
      q1_trust: false, q2_product: false, q3_possession: false, q4_with_product: false, q5_long_lived: true,
    });
    eq(asset.leafTreatment, "asset", "the long-lived path lands on an asset");

    const separate = walkDecisionTree({
      q1_trust: false, q2_product: false, q3_possession: false, q4_with_product: false,
      q5_long_lived: false, q6_separate_business: true,
    });
    eq(separate.leafTreatment, "expense", "a separate business is a deductible expense");
    ok(separate.leafLabel.includes("does not apply"), "and the label says 280E does not reach it");

    const disallowed = walkDecisionTree({
      q1_trust: false, q2_product: false, q3_possession: false, q4_with_product: false,
      q5_long_lived: false, q6_separate_business: false,
    });
    eq(disallowed.leafTreatment, "expense", "the last no lands on a disallowed expense");
    ok(disallowed.leafLabel.includes("DISALLOWS"), "and says so plainly");
    eq(disallowed.path.length, 6, "the longest path visits all six questions");

    // Unanswered stops cleanly instead of guessing.
    const partial = walkDecisionTree({ q1_trust: false });
    eq(partial.leafTreatment, null, "an unanswered question yields no conclusion");
    ok(partial.leafLabel.startsWith("Unanswered:"), "and says which question is unanswered");
    eq(walkDecisionTree({}).leafTreatment, null, "no answers at all yields no conclusion");

    // Every treatment except quarantine is reachable from the tree, and the tree
    // agrees with the taxonomy about what those treatments mean.
    const reached = new Set<PurchaseTreatment>();
    for (const a of [true, false]) for (const b of [true, false]) for (const c of [true, false])
      for (const d of [true, false]) for (const e of [true, false]) for (const f of [true, false]) {
        const r = walkDecisionTree({
          q1_trust: a, q2_product: b, q3_possession: c, q4_with_product: d, q5_long_lived: e, q6_separate_business: f,
        });
        if (r.leafTreatment) reached.add(r.leafTreatment);
      }
    ok(reached.has("trust"), "trust is reachable");
    ok(reached.has("inventory"), "inventory is reachable");
    ok(reached.has("asset"), "asset is reachable");
    ok(reached.has("expense"), "expense is reachable");
    eq(reached.size, 4, "exactly four treatments are reachable — quarantine is a fallback, not an answer");
  }
  eq(findDecisionNode("not_a_node"), undefined, "an unknown node id returns undefined");

  // ── BUCKET BAR GEOMETRY ───────────────────────────────────────────────
  {
    const v = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    const bars = bucketBars(v);
    eq(bars.length, 5, "there are five buckets");
    const sum = bars.reduce((a, b) => a + b.milliPercent, 0);
    eq(sum, 100000, "the bar sums to EXACTLY 100% — a chart that does not add up teaches the wrong lesson");
    eq(bars.find((b) => b.key === "inventoriable")!.milliPercent, 100000, "an all-inventory bill is 100% inventoriable");
    for (const b of bars) {
      ok(b.label.trim().length > 5, `${b.key} has a label`);
      ok(b.meaning.trim().length > 10, `${b.key} explains itself in the legend`);
      ok(Number.isInteger(b.milliPercent), `${b.key} width is an integer — no floats in money visuals`);
    }
  }
  {
    // The classic thirds case: naive rounding leaves a gap; largest-remainder
    // must close it exactly.
    const bill: VendorBillInput = {
      entityCode: "greenway", vendorName: "Thirds", invoiceNumber: "T-1", invoiceDate: "2026-11-01",
      statedTotalCents: 3,
      lines: [
        { lineNo: 1, purchaseKindCode: "freight_in", amountCents: 1, description: "freight" },
        { lineNo: 2, purchaseKindCode: "utilities", amountCents: 1, description: "power" },
        { lineNo: 3, purchaseKindCode: "equipment", amountCents: 1, description: "thing" },
      ],
    };
    const v = evaluateVendorBill(bill, {});
    const bars = bucketBars(v);
    eq(bars.reduce((a, b) => a + b.milliPercent, 0), 100000, "three equal thirds still sum to exactly 100%");
  }
  {
    // A zero bill must not divide by zero.
    const empty: BillVerdict = {
      postable: true, needsAcknowledgement: false, findings: [], classifications: [],
      computedTotalCents: 0, inventoriableCents: 0, disallowedCents: 0, capitalisedCents: 0,
      trustCents: 0, quarantinedCents: 0,
    };
    const bars = bucketBars(empty);
    eq(bars.reduce((a, b) => a + b.milliPercent, 0), 0, "an empty verdict yields a zero bar, not NaN");
    for (const b of bars) ok(Number.isFinite(b.milliPercent), `${b.key} width is finite`);
  }
  {
    // Negative amounts (a credit memo) must not produce negative widths.
    const bill: VendorBillInput = {
      entityCode: "greenway", vendorName: "Credit", invoiceNumber: "C-1", invoiceDate: "2026-11-01",
      statedTotalCents: 95000,
      lines: [
        { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, description: "flower", categorySlug: "flower" },
        { lineNo: 2, purchaseKindCode: "purchase_discount", amountCents: -5000, description: "discount" },
      ],
    };
    const v = evaluateVendorBill(bill, {});
    const bars = bucketBars(v);
    for (const b of bars) ok(b.milliPercent >= 0, `${b.key} width is never negative`);
    eq(bars.reduce((a, b) => a + b.milliPercent, 0), 100000, "and still sums to 100%");
  }

  // ── PURITY / DETERMINISM ──────────────────────────────────────────────
  {
    // Same input, same output — twice, deeply. A core that is not deterministic
    // cannot be trusted to produce the same tax answer next April.
    const a = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    const b = evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    eq(JSON.stringify(a), JSON.stringify(b), "evaluateVendorBill is deterministic");
    const ja = buildBillJournal(cleanBill, a);
    const jb = buildBillJournal(cleanBill, b);
    eq(JSON.stringify(ja), JSON.stringify(jb), "buildBillJournal is deterministic");
  }
  {
    // Evaluation must not mutate its input.
    const snapshot = JSON.stringify(cleanBill);
    evaluateVendorBill(cleanBill, { vendorIsLicensedCannabis: true });
    eq(JSON.stringify(cleanBill), snapshot, "evaluateVendorBill does not mutate the bill it is given");
  }

  // ── HOSTILE INPUT SURVIVAL ────────────────────────────────────────────────
  // Promoted from an adversarial probe run against this core. Every case below
  // is an input a real day can produce (or an attacker can type). None of them
  // may throw, produce NaN, invent money, or emit an unbalanced journal. A
  // bookkeeping core that crashes on a weird invoice is a core Michael cannot
  // trust at 11pm on the 31st.
  {
    const base = (over: Partial<VendorBillInput>): VendorBillInput => ({
      entityCode: "greenway", vendorName: "Probe", invoiceNumber: "P-1", invoiceDate: "2026-11-15",
      statedTotalCents: 1000, lines: [{ lineNo: 1, purchaseKindCode: "rent", amountCents: 1000 }],
      ...over,
    });

    const hostile: VendorBillInput[] = [
      base({ lines: [] }),
      base({ vendorName: "", invoiceNumber: "" }),
      base({ vendorName: "   ", invoiceNumber: "   " }),
      base({ invoiceDate: "not-a-date" }),
      base({ invoiceDate: "2026-02-30" }),   // a date that looks real and is not
      base({ invoiceDate: "2026-13-01" }),
      base({ invoiceDate: "" }),
      base({ statedTotalCents: Number.MAX_SAFE_INTEGER }),
      base({ statedTotalCents: 0, lines: [{ lineNo: 1, purchaseKindCode: "rent", amountCents: 0 }] }),
      base({ entityCode: "atm", lines: [{ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 1000, categorySlug: "flower" }] }),
      base({ lines: [{ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 1000 }] }),
      base({ lines: [{ lineNo: 1, purchaseKindCode: "no_such_kind_at_all", amountCents: 1000 }] }),
      base({ lines: [{ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 1000, categorySlug: "not-a-category" }] }),
      // A 500-line bill. Big distributor invoices really are this long.
      base({ statedTotalCents: 50000, lines: Array.from({ length: 500 }, (_, i) => ({ lineNo: i + 1, purchaseKindCode: "rent", amountCents: 100 })) }),
      // Unicode and injection-shaped text must be data, never behaviour.
      base({ vendorName: "Ünïcödé 株式会社 <script>", lines: [{ lineNo: 1, purchaseKindCode: "unknown", amountCents: 1000, description: "'; drop table gl; -- freight 🚚" }] }),
      // Duplicate line numbers — a real import bug.
      base({ statedTotalCents: 2000, lines: [{ lineNo: 1, purchaseKindCode: "rent", amountCents: 1000 }, { lineNo: 1, purchaseKindCode: "rent", amountCents: 1000 }] }),
    ];

    for (const b of hostile) {
      const v = evaluateVendorBill(b, {});
      ok(Number.isFinite(v.computedTotalCents), "hostile input still yields a finite total");
      ok(!Number.isNaN(v.inventoriableCents) && !Number.isNaN(v.disallowedCents), "no NaN buckets");
      ok(typeof v.postable === "boolean", "postable is always a real boolean");

      // Money conservation: every cent lands in exactly one bucket.
      eq(
        v.inventoriableCents + v.disallowedCents + v.capitalisedCents + v.trustCents + v.quarantinedCents,
        v.computedTotalCents,
        "buckets account for every cent — money is never invented or lost",
      );

      const bars = bucketBars(v);
      const width = bars.reduce((a, x) => a + x.milliPercent, 0);
      ok(width === 0 || width === 100000, "bar widths total exactly 0% or 100%, never 99.9%");
      for (const bar of bars) ok(bar.milliPercent >= 0 && Number.isInteger(bar.milliPercent), "widths are non-negative integers");

      const j = buildBillJournal(b, v);
      if (j) {
        ok(v.postable, "a journal is built ONLY when the bill is postable");
        ok(journalIsBalanced(j), "every journal that is built balances to zero");
        ok(j.lines.length > 0, "a built journal always has lines");
        for (const l of j.lines) {
          ok(Number.isInteger(l.amountCents), "journal amounts are integer cents — never floats");
          ok(/^\d{5}$/.test(l.accountCode), `journal posts to a 5-digit account (${l.accountCode})`);
        }
      } else {
        ok(!v.postable, "no journal is produced unless the bill passed every block");
      }
      ok(billSourceRef(b).length > 0, "an idempotency key always exists");
    }
  }
  {
    // Every kind in the taxonomy must classify to a real 5-digit account and
    // explain itself. A kind that cannot be classified is dead weight.
    for (const k of PURCHASE_KINDS) {
      const c = classifyLine(
        { lineNo: 1, purchaseKindCode: k.code, amountCents: 10000, categorySlug: k.isCannabisProduct ? "flower" : undefined },
        { entityCode: "greenway" },
      );
      ok(/^\d{5}$/.test(c.accountCode), `${k.code} maps to a 5-digit account (${c.accountCode})`);
      ok(c.rationale.trim().length > 10, `${k.code} explains its own classification`);
    }
  }
  {
    // Tolerance can never manufacture evidence. Even an absurd tolerance must
    // not auto-post a bill with nothing to match against.
    const noEvidence = threeWayMatch({ orderedCents: null, receivedCents: null, invoicedCents: 100000, toleranceCents: 99999999 });
    eq(noEvidence.matched, false, "an enormous tolerance still cannot match against nothing");
    eq(noEvidence.code, "MATCH_NO_EVIDENCE", "and it says so honestly");
  }
  {
    // Fuzz the decision tree: partial and random answers must always terminate
    // with a usable label and never loop.
    let seed = 20261115;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 500; i++) {
      const answers: Record<string, boolean> = {};
      for (const node of DECISION_TREE) if (rnd() > 0.15) answers[node.id] = rnd() > 0.5;
      const r = walkDecisionTree(answers);
      ok(r.path.length <= DECISION_TREE.length, "a tree walk never exceeds the tree's depth");
      ok(typeof r.leafLabel === "string" && r.leafLabel.length > 0, "a tree walk always returns a usable label");
    }
  }

  console.log("vendor-bill-core self-tests: all passed");
}
