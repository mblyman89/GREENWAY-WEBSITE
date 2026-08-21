/**
 * src/lib/accounting/payroll-cogs-core.ts — PAYROLL AND THE §280E LABOR QUESTION
 * (slice books-04). PURE core: no I/O, no network, no server-only imports.
 *
 * ===========================================================================
 * THE OWNER'S REQUEST, RECORDED VERBATIM (standing rule 1)
 * ===========================================================================
 *
 *   "I would like the ability to assign employees as cogs so I can write them
 *    off."   — Michael, August 2026
 *
 * And, later:
 *
 *   "I want push back... like if I loan my employees some money... I want to be
 *    able to make entries manually, but the system pushes back and try's to help
 *    me enter it correctly rather than rejecting it out right."
 *
 *   "I really think it's smart to not just block, but explain why, and even
 *    better, show me a way to do it properly."
 *
 *   "I would like all the help I can get and for it to be accurate and precise
 *    stated from actual verbatim text from authoritative sources."
 *
 * ===========================================================================
 * WHY THIS FILE PUSHES BACK ON THE REQUEST AS LITERALLY WRITTEN
 * ===========================================================================
 *
 * This is the most legally dangerous request in the whole project, and it is
 * dangerous in a way that feels safe: every cannabis operator has heard that
 * "you can put payroll in COGS." For a GROWER that is often true. For Greenway
 * it is mostly false, and the difference is not a matter of opinion.
 *
 * Greenway is an I-502 RETAILER. It buys finished, packaged product from
 * licensed producers/processors and resells it. In tax language that makes
 * Greenway a RESELLER, not a PRODUCER. The Internal Revenue Code writes two
 * completely different inventory rules for those two words:
 *
 *   Reg. §1.471-3(b)  RESELLER  — invoice price, less trade discounts, PLUS
 *                                 "transportation or other necessary charges
 *                                  incurred in acquiring possession of the
 *                                  goods."
 *                                 There is NO direct-labor clause. None.
 *
 *   Reg. §1.471-3(c)  PRODUCER  — raw materials, PLUS "expenditures for direct
 *                                 labor", PLUS indirect production costs
 *                                 "including... an appropriate portion of
 *                                  management expenses, but not including any
 *                                  cost of selling."
 *
 * The producer paragraph is the one everybody quotes. It is not Greenway's
 * paragraph. And note that even the producer paragraph refuses selling costs.
 *
 * Three Tax Court cases decided exactly this, against dispensaries that did far
 * more hands-on work than Greenway does:
 *
 *   Patients Mutual (Harborside), 151 T.C. 176 (2018) — reseller.
 *   Alternative Health Care Advocates, 151 T.C. 225 (2018) — reseller.
 *   Richmond Patients Group, T.C. Memo 2020-52 — reseller, even though it
 *     "inspected, sent out for testing, trimmed, dried and maintained the
 *      stock, and packaged and labeled marijuana."
 *
 * And §263A cannot rescue it, twice over: §263A(a)(2)'s flush language and
 * Reg. §1.263A-1(c)(2)(i) both say a cost that is not otherwise allowed cannot
 * become an inventory cost, and Reg. §1.263A-1(e)(2)(ii) sends a reseller
 * straight back to §1.471-3(b) anyway.
 *
 * ===========================================================================
 * SO WHAT DOES THIS FILE ACTUALLY GIVE MICHAEL?
 * ===========================================================================
 *
 * Not nothing. There IS a real, defensible door, and it is narrow:
 *
 *   "...transportation or OTHER NECESSARY CHARGES INCURRED IN ACQUIRING
 *    POSSESSION OF THE GOODS."     — Reg. §1.471-3(b)
 *
 * Time an employee spends receiving a delivery — meeting the transporter,
 * counting against the manifest, verifying the CCRS record, moving product into
 * the vault — is time spent acquiring possession. That is the same clause that
 * already lets inbound freight ride into inventory at account 60800.
 *
 * So this core does five things:
 *
 *   1. States the reseller finding out loud, with the citation, every time.
 *   2. Classifies each labor role. Selling labor is a HARD BLOCK with the
 *      verbatim "not including any cost of selling" text attached.
 *   3. Opens the acquisition-labor path — but only on EVIDENCE: contemporaneous
 *      time records, a written allocation study, and a plausibility ceiling.
 *   4. Builds the payroll journal correctly, including the part nobody thinks
 *      about: withheld tax is not Greenway's money at all (§7501).
 *   5. Shows the producer branch as "here is what would have to be true", so
 *      Michael can see the fork rather than being told "no".
 *
 * ===========================================================================
 * MONEY RULE (standing): integer CENTS, never a float.
 * RATE RULE (standing): integer MILLI-PERCENT (85% = 85000).
 * ===========================================================================
 */

import type { CostClass, EntityCode } from "./ledger-core";

// ===========================================================================
// 1) AUTHORITIES — verbatim, transcribed, never paraphrased.
// ===========================================================================

export type PayrollAuthorityKind =
  | "statute"
  | "regulation"
  | "case"
  | "irs_guidance"
  | "legislative_history"
  | "state_law";

export type PayrollAuthority = {
  /** Stable key referenced by findings and by the UI. */
  id: string;
  kind: PayrollAuthorityKind;
  /** Formal citation as it would appear in a memo. */
  cite: string;
  /** VERBATIM text. Transcribed from the source, never summarised. */
  quote: string;
  /** What it means for Greenway specifically, in plain English. */
  soWhat: string;
  /** Where to read it. */
  source: string;
};

export const PAYROLL_AUTHORITIES: readonly PayrollAuthority[] = [
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
      "Every dollar of wages you pay is an 'amount paid or incurred in carrying on' the store. So as a " +
      "DEDUCTION, payroll is dead on arrival. That is why the only conversation worth having is whether a " +
      "particular dollar of labor is an inventory COST instead — because inventory cost is not a deduction.",
    source: "26 U.S.C. §280E, enacted by the Tax Equity and Fiscal Responsibility Act of 1982, Pub. L. No. 97-248, §351.",
  },
  {
    id: "REG_1_471_3_B_RESELLER",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(b)",
    quote:
      "In the case of merchandise purchased since the beginning of the taxable year, the invoice price less " +
      "trade or other discounts, except strictly cash discounts approximating a fair interest rate, which " +
      "may be deducted or not at the option of the taxpayer, provided a consistent course is followed. To " +
      "this net invoice price should be added transportation or other necessary charges incurred in " +
      "acquiring possession of the goods.",
    soWhat:
      "THIS IS YOUR PARAGRAPH. Read what is in it and what is NOT. It gives you invoice price, minus trade " +
      "discounts, plus transportation and other charges to ACQUIRE POSSESSION. It does not contain the words " +
      "'direct labor' anywhere. The only labor that can ride in here is labor spent getting possession of the " +
      "goods — the receiving dock, not the sales floor.",
    source: "26 C.F.R. §1.471-3(b), Inventories at cost — merchandise purchased since the beginning of the taxable year.",
  },
  {
    id: "REG_1_471_3_C_PRODUCER",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(c)",
    quote:
      "In the case of merchandise produced by the taxpayer since the beginning of the taxable year, (1) the " +
      "cost of raw materials and supplies entering into or consumed in connection with the product, (2) " +
      "expenditures for direct labor, and (3) indirect production costs incident to and necessary for the " +
      "production of the particular article, including in such indirect production costs an appropriate " +
      "portion of management expenses, but not including any cost of selling or return on capital, whether " +
      "by way of interest or profit.",
    soWhat:
      "This is the paragraph everybody in the industry quotes at you, and it is the paragraph you do not get " +
      "to use, because you do not produce. Two things to notice anyway. First: 'expenditures for direct " +
      "labor' lives HERE, in the producer rule — that is the whole reason growers can do what you cannot. " +
      "Second: even a producer is told 'not including any cost of selling'. Nobody, anywhere, gets to put a " +
      "budtender's wages into inventory.",
    source: "26 C.F.R. §1.471-3(c), Inventories at cost — merchandise produced by the taxpayer.",
  },
  {
    id: "REG_1_471_3_F_DISALLOWED",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(f)",
    quote:
      "Notwithstanding the other rules of this section, cost shall not include an amount which is of a " +
      "type for which a deduction would be disallowed under section 162 (c), (f), or (g) and the regulations " +
      "thereunder in the case of a business expense.",
    soWhat:
      "The regulation itself has a firewall: some costs can never be inventory no matter how they are " +
      "labelled. It is the same idea §263A repeats. Calling something 'COGS' in your chart of accounts does " +
      "not make it COGS in law — the character of the dollar comes first, the account name comes second.",
    source: "26 C.F.R. §1.471-3(f).",
  },
  {
    id: "REG_1_263A_1_E_2_II_RESELLER",
    kind: "regulation",
    cite: "26 C.F.R. §1.263A-1(e)(2)(ii)",
    quote:
      "Resellers. Resellers must capitalize the acquisition costs of property acquired for resale. In the " +
      "case of inventory, the acquisition cost is the cost described in §1.471-3(b).",
    soWhat:
      "This is the sentence that closes the last escape hatch. Some advisers say 'fine, forget §471, use the " +
      "big uniform-capitalization rules in §263A instead.' Those rules answer: for a reseller, the cost IS " +
      "the §1.471-3(b) cost. You end up back in your own paragraph, with no direct-labor clause, no matter " +
      "which road you take.",
    source: "26 C.F.R. §1.263A-1(e)(2)(ii), Types of costs subject to capitalization — direct costs — resellers.",
  },
  {
    id: "REG_1_263A_1_E_2_I_B_LABOR",
    kind: "regulation",
    cite: "26 C.F.R. §1.263A-1(e)(2)(i)(B)",
    quote:
      "Direct labor costs include the costs of labor that can be identified or associated with particular " +
      "units or groups of units of specific property produced. For this purpose, labor encompasses full-time " +
      "and part-time employees, as well as contract employees and independent contractors. Direct labor " +
      "costs include all elements of compensation other than employee benefit costs described in paragraph " +
      "(e)(3)(ii)(D) of this section. Elements of direct labor costs include basic compensation, overtime " +
      "pay, vacation pay, holiday pay, sick leave pay (other than payments pursuant to a wage continuation " +
      "plan under section 105(d) as it existed prior to its repeal in 1983), shift differential, payroll " +
      "taxes, and payments to a supplemental unemployment benefit plan.",
    soWhat:
      "Worth reading for two reasons. One: it sits under the heading 'Producers', which is the point. Two: it " +
      "shows what a REAL labor-capitalisation rule looks like — labor tied to 'particular units or groups of " +
      "units of specific property'. That is the standard of proof. Not 'roughly a third of the staff'. If " +
      "the law ever gives you this paragraph, you will need records at that level, which is exactly what the " +
      "time-tracking in this system is being built toward.",
    source: "26 C.F.R. §1.263A-1(e)(2)(i)(B), Direct labor costs.",
  },
  {
    id: "IRC_263A_FLUSH",
    kind: "statute",
    cite: "26 U.S.C. §263A(a)(2) (flush language)",
    quote:
      "Any cost which (but for this subsection) could not be taken into account in computing taxable income " +
      "for any taxable year shall not be treated as a cost described in this paragraph.",
    soWhat:
      "Plain English: §263A cannot launder a disallowed cost into inventory. If §280E already killed a " +
      "dollar as a deduction, moving it to a COGS account does not resurrect it. This one sentence is why " +
      "the aggressive 'just put payroll in COGS' advice fails.",
    source: "26 U.S.C. §263A(a)(2), final sentence.",
  },
  {
    id: "REG_1_263A_1_C_2_I",
    kind: "regulation",
    cite: "26 C.F.R. §1.263A-1(c)(2)(i)",
    quote:
      "Any cost which (but for section 263A and the regulations thereunder) may not be taken into account in " +
      "computing taxable income for any taxable year is not treated as a cost properly allocable to property " +
      "produced or acquired for resale under section 263A and the regulations thereunder.",
    soWhat:
      "The regulation says the same thing the statute says, in case anyone hoped the regulation was softer. " +
      "It is not. Two independent sources, same answer.",
    source: "26 C.F.R. §1.263A-1(c)(2)(i), Otherwise deductible.",
  },
  {
    id: "CCA_201504011",
    kind: "irs_guidance",
    cite: "I.R.S. Chief Counsel Advice 201504011 (Jan. 23, 2015)",
    quote:
      "Section 263A is a timing provision. It does not change the character of any expense from " +
      "\"nondeductible\" to \"deductible,\" or vice versa. ... A taxpayer trafficking in a Schedule I or " +
      "Schedule II controlled substance determines COGS using the applicable inventory-costing regulations " +
      "under §471 as they existed when §280E was enacted.",
    soWhat:
      "The IRS put in writing which rulebook you are held to: §471 as it read in 1982. Not today's §263A, not " +
      "an industry newsletter. This is also the document that says a RESELLER's inventoriable costs are the " +
      "§1.471-3(b) list and nothing else.",
    source: "I.R.S. Chief Counsel Advice Memorandum 201504011.",
  },
  {
    id: "PATIENTS_MUTUAL_RESELLER",
    kind: "case",
    cite: "Patients Mutual Assistance Collective Corp. v. Commissioner, 151 T.C. 176, 213 & n.26 (2018)",
    quote:
      "Reinspection, packaging, and labeling are activities that resellers do without losing their character " +
      "as resellers.",
    soWhat:
      "Harborside was one of the largest dispensaries in America, with far more hands-on handling than " +
      "Greenway, and the Tax Court still called it a reseller. If reinspecting and repackaging did not make " +
      "Harborside a producer, nothing you do on Mile Hill Drive will make Greenway one.",
    source: "Patients Mutual Assistance Collective Corp. dba Harborside Health Center v. Commissioner, 151 T.C. 176 (2018).",
  },
  {
    id: "RICHMOND_PATIENTS",
    kind: "case",
    cite: "Richmond Patients Group v. Commissioner, T.C. Memo 2020-52",
    quote:
      "Richmond inspected, sent out for testing, trimmed, dried and maintained the stock, and packaged and " +
      "labeled marijuana. These activities are those of a reseller and not a producer... Therefore, Richmond " +
      "is not allowed to deduct additional indirect costs included in COGS.",
    soWhat:
      "This dispensary did MORE than you do — it trimmed and dried — and the court still said reseller, and " +
      "still threw out the extra costs it had loaded into COGS. This is the case to remember if anyone ever " +
      "tells you that handling product makes you a producer.",
    source: "Richmond Patients Group v. Commissioner, T.C. Memo. 2020-52 (May 4, 2020).",
  },
  {
    id: "ALT_HEALTH_CARE",
    kind: "case",
    cite: "Alternative Health Care Advocates v. Commissioner, 151 T.C. 225, 243 (2018)",
    quote:
      "The evidence establishes only that the dispensary, inspected, packaged, trimmed, dried, and " +
      "maintained the stock.",
    soWhat:
      "A third court, a third dispensary, the same answer. Three independent decisions is not bad luck; it " +
      "is settled law. Anyone selling you a 'labor in COGS' strategy for a retailer is selling you an audit.",
    source: "Alternative Health Care Advocates v. Commissioner, 151 T.C. 225 (2018).",
  },
  {
    id: "ALPENGLOW_EXCLUSION",
    kind: "case",
    cite: "Alpenglow Botanicals, LLC v. United States, 894 F.3d 1187, 1200 (10th Cir. 2018)",
    quote:
      "The cost of goods sold is a well-recognized exclusion from the calculation of gross income, while " +
      "ordinary and necessary business expenses are deductions.",
    soWhat:
      "The single most important distinction in your tax life, in one sentence. An EXCLUSION happens before " +
      "income is even measured, so §280E never reaches it. A DEDUCTION happens after, where §280E is waiting. " +
      "Everything this system does about classification is trying to put dollars on the correct side of that " +
      "line honestly — never to disguise one as the other.",
    source: "Alpenglow Botanicals, LLC v. United States, 894 F.3d 1187 (10th Cir. 2018).",
  },
  {
    id: "SENATE_REPORT_97_494",
    kind: "legislative_history",
    cite: "S. Rep. No. 97-494, at 309 (1982)",
    quote:
      "All deductions and credits for amounts paid or incurred in the illegal trafficking in drugs listed in " +
      "the Controlled Substances Act are disallowed. To preclude possible challenges on constitutional " +
      "grounds, the adjustment to gross receipts with respect to effective costs of goods sold is not " +
      "affected by this provision of the bill.",
    soWhat:
      "Congress said out loud that COGS survives §280E, and said why: taxing a business on gross receipts " +
      "with no allowance for what the goods cost might not be an income tax at all. Your COGS is not a " +
      "loophole. It is a carve-out written on purpose. Which is also why it must be claimed honestly.",
    source: "Senate Finance Committee report accompanying TEFRA 1982, reprinted at 1982 U.S.C.C.A.N. 781, 1050.",
  },
  {
    id: "IRC_7501_TRUST",
    kind: "statute",
    cite: "26 U.S.C. §7501(a)",
    quote:
      "Whenever any person is required to collect or withhold any internal revenue tax from any other person " +
      "and to pay over such tax to the United States, the amount of tax so collected or withheld shall be " +
      "held to be a special fund in trust for the United States. The amount of such fund shall be assessed, " +
      "collected, and paid in the same manner and subject to the same provisions and limitations (including " +
      "penalties) as are applicable with respect to the taxes from which such fund arose.",
    soWhat:
      "The tax you withhold from an employee's cheque was never your money — the law calls it a fund held IN " +
      "TRUST. It is a liability the moment you withhold it, not an expense and never revenue. In a cash " +
      "business this is the single easiest way to get personally ruined, because trust-fund taxes pierce the " +
      "corporation (§6672). The payroll journal in this file is built so that money lands in 31100 and sits " +
      "there visibly until it is paid over.",
    source: "26 U.S.C. §7501, Liability for taxes withheld or collected.",
  },
  {
    id: "IRC_6672_TRUST_PENALTY",
    kind: "statute",
    cite: "26 U.S.C. §6672(a)",
    quote:
      "Any person required to collect, truthfully account for, and pay over any tax imposed by this title " +
      "who willfully fails to collect such tax, or truthfully account for and pay over such tax, or " +
      "willfully attempts in any manner to evade or defeat any such tax or the payment thereof, shall, in " +
      "addition to other penalties provided by law, be liable to a penalty equal to the total amount of the " +
      "tax evaded, or not collected, or not accounted for and paid over.",
    soWhat:
      "This is why withheld payroll tax gets its own account and its own alarm. The penalty is 100% of the " +
      "money, it is assessed against a PERSON rather than the company, and an S-corp shell does not stop it. " +
      "Of everything in these books, this is the one that could reach your house.",
    source: "26 U.S.C. §6672, Failure to collect and pay over tax, or attempt to evade or defeat tax.",
  },
  {
    id: "IRC_6001_SUBSTANTIATION",
    kind: "statute",
    cite: "26 U.S.C. §6001",
    quote:
      "Every person liable for any tax imposed by this title, or for the collection thereof, shall keep such " +
      "records, render such statements, make such returns, and comply with such rules and regulations as the " +
      "Secretary may from time to time prescribe.",
    soWhat:
      "The burden of proof is yours, not the IRS's. An allocation you cannot document is an allocation you " +
      "do not have. This is why nothing in this file will move a wage into inventory on the strength of a " +
      "percentage typed into a box — it wants the time records that produced the percentage.",
    source: "26 U.S.C. §6001, Notice or regulations requiring records, statements, and special returns.",
  },
  {
    id: "COHAN_ESTIMATE_LIMIT",
    kind: "case",
    cite: "Cohan v. Commissioner, 39 F.2d 540, 543-44 (2d Cir. 1930)",
    quote:
      "Absolute certainty in such matters is usually impossible and is not necessary; the Board should make " +
      "as close an approximation as it can, bearing heavily if it chooses upon the taxpayer whose inexactitude " +
      "is of his own making. But to allow nothing at all appears to us inconsistent with saying that " +
      "something was spent.",
    soWhat:
      "The famous 'you can estimate' case — and notice the sting in the middle: the court will bear HEAVILY " +
      "against the taxpayer whose records are sloppy. An estimate is the worst outcome you can win, not a " +
      "plan. That is the whole argument for keeping the time records contemporaneously rather than " +
      "reconstructing them in an audit three years later.",
    source: "Cohan v. Commissioner, 39 F.2d 540 (2d Cir. 1930).",
  },
  {
    id: "SAVAGE_199A",
    kind: "case",
    cite: "Savage v. Commissioner, 165 T.C. No. 5 (2025)",
    quote:
      "Wages that are disqualified under section 280E are not properly allocable to qualified business " +
      "income for purposes of section 199A.",
    soWhat:
      "A recent reminder that the §280E disallowance follows the dollar around. A wage killed by §280E does " +
      "not quietly come back to life somewhere else on the return. Classification is not a game of moving a " +
      "number until it lands somewhere friendly.",
    source: "Savage v. Commissioner, 165 T.C. No. 5 (2025).",
  },
  {
    id: "CHAMP_SEPARATE_TRADE",
    kind: "case",
    cite: "Californians Helping to Alleviate Medical Problems, Inc. v. Commissioner, 128 T.C. 173, 183 (2007)",
    quote:
      "We hold that section 280E does not preclude petitioner from deducting expenses attributable to a trade " +
      "or business separate and apart from that of illegal trafficking in controlled substances.",
    soWhat:
      "This is the one genuinely good piece of news in §280E law, and it is why your ATM operation and the " +
      "Geiger rental keep their deductions. It is also a warning: the separation has to be REAL — separate " +
      "books, separate purpose, honest time records. A person who genuinely works part of the week for the " +
      "ATM business is a different question from a budtender relabelled on paper.",
    source: "Californians Helping to Alleviate Medical Problems, Inc. v. Commissioner, 128 T.C. 173 (2007).",
  },
  {
    id: "RCW_49_46_020_MINWAGE",
    kind: "state_law",
    // books-26: THIS QUOTE USED TO BE A PARAPHRASE. It read "the state minimum
    // hourly wage rate shall be increased by the rate of inflation as
    // calculated under this subsection", which is a fair summary and appears
    // nowhere in the statute. It survived because the RCW text was not mirrored
    // locally, so scripts/verify-verbatim-quotes.ts had nothing to check it
    // against and the id sat in KNOWN_UNMIRRORED_AUTHORITY_IDS. Mirroring
    // docs/authorities/state-wa/rcw-49.46.020.txt failed the check in
    // milliseconds. Rule 24: the quote is sacred, and a citation nobody can
    // check is a citation nobody should trust.
    cite: "RCW 49.46.020(2)",
    quote:
      "(2)(a) Beginning on January 1, 2021, and each following January 1st as set forth under (b) of " +
      "this subsection, every employer shall pay to each of his or her employees who has reached the " +
      "age of eighteen years wages at a rate of not less than the amount established under (b) of " +
      "this subsection. (b) On September 30, 2020, and on each following September 30th, the " +
      "department of labor and industries shall calculate an adjusted minimum wage rate to maintain " +
      "employee purchasing power by increasing the current year's minimum wage rate by the rate of " +
      "inflation. The adjusted minimum wage rate shall be calculated to the nearest cent using the " +
      "consumer price index for urban wage earners and clerical workers, CPI-W, or a successor index, " +
      "for the twelve months prior to each September 1st as calculated by the United States " +
      "department of labor. Each adjusted minimum wage rate calculated under this subsection (2)(b) " +
      "takes effect on the following January 1st.",
    soWhat:
      "Washington's minimum wage moves every January and it is one of the highest in the country. This file " +
      "does not hard-code the number — a hard-coded wage floor silently goes stale and then quietly approves " +
      "an illegal rate. Instead the check asks for the effective rate as an input and refuses if none is " +
      "supplied. Two phrases in the statute do real work: the new figure is only calculated on " +
      "September 30, so in January of a year with no announcement the honest answer is a refusal; and " +
      "it is 'calculated to the nearest cent', so the legal floor is always whole cents and a " +
      "fraction of a cent in a stored minimum wage means a unit was typed wrong.",
    source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.46.020",
  },
  {
    // WAC 314-55-083 is "Security and traceability requirements". Quoted here
    // for the two things payroll actually leans on: the state COMPELS the
    // security spend, and it COMPELS seed-to-sale tracking. Note the last
    // sentence -- Washington makes the licensee bear the cost, and §280E then
    // disallows it. That combination is the whole cruelty of the statute.
    id: "WAC_314_55_083_TRACEABILITY",
    kind: "state_law",
    cite: "WAC 314-55-083(2), (4)",
    quote:
      "(2) Alarm systems. At a minimum, each licensed premises must have a security alarm system on all " +
      "perimeter entry points and perimeter windows. ... (4) Traceability: To prevent diversion and to " +
      "promote public safety, cannabis licensees must track cannabis from seed to sale. Licensees must " +
      "provide the required information on a system specified by the LCB. All costs related to the " +
      "reporting requirements are borne by the licensee.",
    soWhat:
      "The state orders the alarm, the cameras and the seed-to-sale reporting, and says in the same breath " +
      "that you pay for all of it. None of that makes the spend deductible — §280E does not care that a " +
      "cost was legally compulsory. Track the time against these duties honestly, because the traceability " +
      "record is also the evidence that your receiving hours line up with real deliveries.",
    source:
      "WAC 314-55-083, Security and traceability requirements for cannabis licensees " +
      "(current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-083",
  },
  {
    // Added by books-09. The recordkeeping rule is 087, NOT 083, and since
    // WSR 24-19-040 (eff. 10/12/24) the period is FIVE years, not three.
    // Subsection (1)(e) names employee records explicitly, which is precisely
    // what a payroll-to-COGS allocation has to stand on.
    id: "WAC_314_55_087_EMPLOYEE_RECORDS",
    kind: "state_law",
    cite: "WAC 314-55-087(1), (1)(c), (1)(e)",
    quote:
      "Cannabis licensees are responsible to keep records that clearly reflect all financial transactions " +
      "and the financial condition of the business. The following records must be kept and maintained on " +
      "the licensed premises for a five-year period and must be made available for inspection if requested " +
      "by an employee of the LCB: ... (c) Accounting and tax records related to the licensed business and " +
      "each true party of interest; ... (e) All employee records to include, but not limited to, training, " +
      "payroll, and date of hire;",
    soWhat:
      "Washington already requires FIVE years of employee and payroll records that 'clearly reflect all " +
      "financial transactions'. So the time records this system asks for are not extra paperwork invented " +
      "by your bookkeeping software — the state expects them regardless. You may as well keep them in a " +
      "shape that also defends a federal tax position. Note the period changed from three years to five " +
      "with WSR 24-19-040, effective 10/12/2024; anything still saying three years is out of date.",
    source:
      "WAC 314-55-087, Recordkeeping requirements for cannabis licensees " +
      "(current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087",
  },
] as const;

/** Look an authority up by id. Returns undefined for an unknown id. */
export function findPayrollAuthority(id: string): PayrollAuthority | undefined {
  return PAYROLL_AUTHORITIES.find((a) => a.id === id);
}

/**
 * Render a list of authority ids as a citation string.
 *
 * An UNKNOWN id renders visibly as "[unknown authority: X]" rather than being
 * silently dropped. A citation that quietly disappears is how a finding ends up
 * looking authoritative while resting on nothing.
 */
export function citePayrollAuthorities(ids: readonly string[]): string {
  const parts: string[] = [];
  for (const id of ids) {
    const a = findPayrollAuthority(id);
    parts.push(a ? a.cite : `[unknown authority: ${id}]`);
  }
  return parts.join("; ");
}

// ===========================================================================
// 2) RESELLER vs PRODUCER — the determination everything else hangs off.
// ===========================================================================

/**
 * The activities the Tax Court actually examined in the dispensary cases. Each
 * one records whether doing it makes a taxpayer a PRODUCER, because the
 * intuition ("we handle the product, so we must be producing") is exactly
 * backwards and cost three dispensaries their COGS.
 */
export type ProductionActivity = {
  code: string;
  label: string;
  /** True only if the activity, standing alone, would make you a producer. */
  makesYouAProducer: boolean;
  /** Plain-English note, with the case that decided it where one exists. */
  note: string;
  authorityIds: readonly string[];
};

/**
 * NOTE ON COMPLETENESS: this list covers what an I-502 RETAILER can physically
 * do. Growing, extracting and infusing are included precisely BECAUSE Greenway
 * cannot lawfully do them under its licence — they are the contrast that makes
 * the answer obvious, and they are the branch that would light up if Michael
 * ever added a producer/processor licence.
 */
export const PRODUCTION_ACTIVITIES: readonly ProductionActivity[] = [
  {
    code: "receive_manifest",
    label: "Receiving a delivery and checking it against the manifest",
    makesYouAProducer: false,
    note:
      "This is acquiring possession, not producing. It is the one activity whose labor has a real path " +
      "into inventory cost — through the 'other necessary charges incurred in acquiring possession' clause.",
    authorityIds: ["REG_1_471_3_B_RESELLER"],
  },
  {
    code: "inspect",
    label: "Inspecting product on arrival",
    makesYouAProducer: false,
    note:
      "Harborside inspected. Richmond inspected. Alternative Health Care inspected. All three were resellers.",
    authorityIds: ["PATIENTS_MUTUAL_RESELLER", "RICHMOND_PATIENTS", "ALT_HEALTH_CARE"],
  },
  {
    code: "test_send_out",
    label: "Sending product out for lab testing",
    makesYouAProducer: false,
    note: "Richmond 'sent out for testing' and remained a reseller. Paying a third party to test is a service, not production.",
    authorityIds: ["RICHMOND_PATIENTS"],
  },
  {
    code: "repackage",
    label: "Repackaging or relabelling",
    makesYouAProducer: false,
    note:
      "The Tax Court said this in as many words: reinspection, packaging and labeling are things 'resellers " +
      "do without losing their character as resellers.'",
    authorityIds: ["PATIENTS_MUTUAL_RESELLER"],
  },
  {
    code: "trim_dry",
    label: "Trimming or drying product",
    makesYouAProducer: false,
    note:
      "Counter-intuitive but decided: Richmond trimmed and dried and was still held a reseller. This is the " +
      "high-water mark — if trimming and drying did not do it, nothing a retailer does will.",
    authorityIds: ["RICHMOND_PATIENTS"],
  },
  {
    code: "store_maintain",
    label: "Storing and maintaining stock in the vault",
    makesYouAProducer: false,
    note: "'Maintained the stock' appears in both Richmond and Alternative Health Care on the reseller side of the line.",
    authorityIds: ["RICHMOND_PATIENTS", "ALT_HEALTH_CARE"],
  },
  {
    code: "display_sell",
    label: "Displaying, advising customers and selling",
    makesYouAProducer: false,
    note:
      "This is selling, which is excluded from inventory cost even for a producer: 'not including any cost " +
      "of selling'. There is no version of the law in which budtender wages become COGS.",
    authorityIds: ["REG_1_471_3_C_PRODUCER"],
  },
  {
    code: "cultivate",
    label: "Growing / cultivating cannabis",
    makesYouAProducer: true,
    note:
      "This WOULD make you a producer — and Greenway's I-502 retail licence does not permit it. Shown here " +
      "so the fork in the road is visible, not because it is available.",
    authorityIds: ["REG_1_471_3_C_PRODUCER"],
  },
  {
    code: "extract",
    label: "Extracting concentrate from raw material",
    makesYouAProducer: true,
    note: "Processing activity. Requires a processor licence, which a retailer does not hold.",
    authorityIds: ["REG_1_471_3_C_PRODUCER"],
  },
  {
    code: "infuse_manufacture",
    label: "Manufacturing infused product from ingredients",
    makesYouAProducer: true,
    note: "Processing activity. Requires a processor licence, which a retailer does not hold.",
    authorityIds: ["REG_1_471_3_C_PRODUCER"],
  },
] as const;

export function findProductionActivity(code: string): ProductionActivity | undefined {
  return PRODUCTION_ACTIVITIES.find((a) => a.code === code);
}

export type TaxpayerCharacter = "reseller" | "producer";

export type CharacterDetermination = {
  character: TaxpayerCharacter;
  /** The inventory-cost paragraph that governs, given the character. */
  governingRule: "REG_1_471_3_B_RESELLER" | "REG_1_471_3_C_PRODUCER";
  /** True when direct labor may be capitalised at all. */
  directLaborCapitalisable: boolean;
  /** Activity codes that were supplied but do not change the answer. */
  resellerActivities: readonly string[];
  /** Activity codes that WOULD make the taxpayer a producer. */
  producerActivities: readonly string[];
  /** Codes supplied that this core does not recognise. Never silently ignored. */
  unknownActivities: readonly string[];
  /** Plain-English statement of the finding. */
  explanation: string;
  authorityIds: readonly string[];
};

/**
 * Decide whether the taxpayer is a reseller or a producer FROM THE ACTIVITIES,
 * not from what anybody wishes.
 *
 * This is deliberately not a setting. A boolean called `isProducer` sitting in a
 * config table is a boolean somebody eventually flips at 11pm in April. Making
 * it a function of the activity list means the answer always comes with its
 * reasons attached, and the reasons are what an examiner asks for.
 */
export function determineCharacter(activityCodes: readonly string[]): CharacterDetermination {
  const reseller: string[] = [];
  const producer: string[] = [];
  const unknown: string[] = [];

  for (const code of activityCodes) {
    const activity = findProductionActivity(code);
    if (!activity) {
      unknown.push(code);
      continue;
    }
    if (activity.makesYouAProducer) producer.push(code);
    else reseller.push(code);
  }

  const isProducer = producer.length > 0;

  const explanation = isProducer
    ? "These activities include production. Reg. §1.471-3(c) would govern, which does allow " +
      "'expenditures for direct labor' into inventory cost — but note that even that paragraph excludes " +
      "'any cost of selling'. This branch is shown for completeness: an I-502 RETAIL licence does not " +
      "permit cultivating, extracting or manufacturing, so reaching this answer means either the licence " +
      "changed or something was entered that did not actually happen."
    : "Every activity listed is one the Tax Court has already placed on the RESELLER side of the line — " +
      "including trimming and drying, which Richmond Patients Group did and was still held a reseller. " +
      "So Reg. §1.471-3(b) governs: invoice price, less trade discounts, plus transportation and other " +
      "necessary charges incurred in acquiring possession. There is no direct-labor clause in that " +
      "paragraph, which is the whole answer to 'can I put my employees in COGS'.";

  return {
    character: isProducer ? "producer" : "reseller",
    governingRule: isProducer ? "REG_1_471_3_C_PRODUCER" : "REG_1_471_3_B_RESELLER",
    directLaborCapitalisable: isProducer,
    resellerActivities: reseller,
    producerActivities: producer,
    unknownActivities: unknown,
    explanation,
    authorityIds: isProducer
      ? ["REG_1_471_3_C_PRODUCER", "REG_1_263A_1_E_2_I_B_LABOR"]
      : [
          "REG_1_471_3_B_RESELLER",
          "REG_1_263A_1_E_2_II_RESELLER",
          "PATIENTS_MUTUAL_RESELLER",
          "RICHMOND_PATIENTS",
          "ALT_HEALTH_CARE",
        ],
  };
}

// ===========================================================================
// 3) THE LABOR TAXONOMY — what each kind of work can and cannot become.
// ===========================================================================

/**
 * How a dollar of labor is treated for §280E purposes.
 *
 *   acquisition — spent acquiring possession of goods. The ONE narrow path into
 *                 inventory for a reseller, and only on evidence.
 *   selling     — the sales floor. Excluded from inventory cost even for a
 *                 producer. Hard block, no exceptions, ever.
 *   admin       — running the cannabis business. §280E disallows it. Honest and
 *                 unavoidable; not a failure of bookkeeping.
 *   production  — only meaningful for a producer. Unavailable to a retailer.
 *   separate    — genuinely a different trade or business (CHAMP). Deductible
 *                 against that business, on real evidence.
 *   owner       — owner/officer compensation. Its own trap; see the note.
 */
export type LaborTreatment = "acquisition" | "selling" | "admin" | "production" | "separate" | "owner";

export type LaborRole = {
  code: string;
  label: string;
  treatment: LaborTreatment;
  /** Where wages for this role are posted. Must exist in the chart (0173). */
  accountCode: string;
  costClass: CostClass;
  /** True when this role may NEVER reach inventory, whatever evidence exists. */
  neverInventoriable: boolean;
  /** Plain-English explanation shown to Michael. */
  plainEnglish: string;
  authorityIds: readonly string[];
};

/**
 * ACCOUNT CODES USED HERE ARE VERIFIED AGAINST migration 0173, not invented:
 *   61000  Payroll — Inventory Handling (allocable)   cogs / cogs_allocable
 *   71010  Wages & Salaries                           expense / nondeductible_280e
 *   71020  Overtime                                   expense / nondeductible_280e
 *   71030  Paid Sick & Leave                          expense / nondeductible_280e
 *   71040  Employer Payroll Taxes                     expense / nondeductible_280e
 *
 * 61000 already exists and 0173's own comment calls it a "REVIEW ITEM for the
 * owner's CPA... Requires a documented allocation study". This core is the thing
 * that finally enforces that sentence instead of trusting it.
 */
export const WAGE_EXPENSE_ACCOUNT = "71010";
export const OVERTIME_EXPENSE_ACCOUNT = "71020";
export const PAID_LEAVE_ACCOUNT = "71030";
export const EMPLOYER_TAX_EXPENSE_ACCOUNT = "71040";
export const PAYROLL_COGS_ACCOUNT = "61000";
export const ACCRUED_PAYROLL_ACCOUNT = "31000";
export const WITHHELD_TAX_ACCOUNT = "31100";
export const EMPLOYER_TAX_PAYABLE_ACCOUNT = "31200";
export const GARNISHMENT_ACCOUNT = "31300";
export const EMPLOYEE_ADVANCE_ACCOUNT = "12100";
export const OPERATING_BANK_ACCOUNT = "10200";

export const LABOR_ROLES: readonly LaborRole[] = [
  {
    code: "budtender",
    label: "Budtender / sales associate",
    treatment: "selling",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: true,
    plainEnglish:
      "Serving customers is selling, and selling is the one cost the inventory rules exclude by name — " +
      "even for a grower. Reg. §1.471-3(c) says indirect production costs may include management expenses " +
      "'but not including any cost of selling'. There is no reading of the law in which a budtender's hour " +
      "becomes cost of goods sold. This is the single most common way cannabis retailers lose an audit.",
    authorityIds: ["REG_1_471_3_C_PRODUCER", "IRC_280E", "SAVAGE_199A"],
  },
  {
    code: "receiving",
    label: "Receiving / intake — meeting deliveries, checking manifests, vaulting product",
    treatment: "acquisition",
    accountCode: PAYROLL_COGS_ACCOUNT,
    costClass: "cogs_allocable",
    neverInventoriable: false,
    plainEnglish:
      "THIS IS THE ONE. Meeting the transporter, counting cases against the manifest, confirming the CCRS " +
      "record and moving product into the vault is time spent ACQUIRING POSSESSION of the goods — the exact " +
      "words in Reg. §1.471-3(b). It rides the same clause inbound freight rides. But it is narrow: it is " +
      "the receiving dock only, it stops when the product is put away, and it only counts if you can show " +
      "the minutes.",
    authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_6001_SUBSTANTIATION", "COHAN_ESTIMATE_LIMIT"],
  },
  {
    code: "inventory_count",
    label: "Physical inventory counts and CCRS reconciliation",
    treatment: "admin",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: false,
    plainEnglish:
      "Counting inventory you already own is not acquiring it. This is storage and record-keeping — real, " +
      "necessary work, and §280E disallows it anyway. A producer could argue some of it as an indirect " +
      "production cost; a reseller has no such paragraph. Classified honestly here rather than quietly " +
      "swept into 61000 where it would be the first thing an examiner samples.",
    authorityIds: ["REG_1_471_3_B_RESELLER", "CCA_201504011", "IRC_280E"],
  },
  {
    code: "security",
    label: "Security / door staff",
    treatment: "admin",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: true,
    plainEnglish:
      "Washington requires it, and §280E disallows it anyway — that combination is the cruelty of this " +
      "statute in one line. Being legally compelled to spend money has never made a cost deductible for a " +
      "§280E business. Do not let anyone talk you into calling the guard 'inventory protection'.",
    authorityIds: ["IRC_280E", "WAC_314_55_083_TRACEABILITY"],
  },
  {
    code: "management",
    label: "Store manager / assistant manager",
    treatment: "admin",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: false,
    plainEnglish:
      "Management is 'management expenses', which Reg. §1.471-3(c) allows into indirect PRODUCTION costs — " +
      "for a producer. You are a reseller, so §1.471-3(b) governs and it has no indirect-cost clause at all. " +
      "If a manager genuinely spends time on the receiving dock, that specific time can go in as receiving " +
      "labor — but it has to be recorded as receiving time when it happens, not carved out afterwards.",
    authorityIds: ["REG_1_471_3_C_PRODUCER", "REG_1_471_3_B_RESELLER", "IRC_6001_SUBSTANTIATION"],
  },
  {
    code: "compliance",
    label: "Compliance / traceability administration",
    treatment: "admin",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: false,
    plainEnglish:
      "Keeping the state's records is a cost of being licensed, not a cost of acquiring goods. §280E " +
      "disallows it. Worth doing well anyway: WAC 314-55-087(1) requires FIVE years of records that " +
      "'clearly reflect all financial transactions', and those same records are what defends everything " +
      "else here.",
    authorityIds: ["IRC_280E", "WAC_314_55_087_EMPLOYEE_RECORDS", "WAC_314_55_083_TRACEABILITY"],
  },
  {
    code: "delivery_driver",
    label: "Driver collecting product from a supplier",
    treatment: "acquisition",
    accountCode: PAYROLL_COGS_ACCOUNT,
    costClass: "cogs_allocable",
    neverInventoriable: false,
    plainEnglish:
      "If your own person drives to collect goods, that trip is transportation to acquire possession — the " +
      "first clause of the same sentence that gives you freight-in. Treated like receiving labor, on the " +
      "same evidence. Note this is INBOUND only: driving product to a customer is delivery of a sale, which " +
      "is selling.",
    authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_6001_SUBSTANTIATION"],
  },
  {
    code: "marketing",
    label: "Marketing, menus and promotions",
    treatment: "selling",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: true,
    plainEnglish:
      "Selling cost, by definition. Excluded by name from inventory cost even in the producer paragraph. " +
      "§280E disallows it as a deduction. There is nowhere for this dollar to go, and pretending otherwise " +
      "is how a small mistake becomes a fraud allegation.",
    authorityIds: ["REG_1_471_3_C_PRODUCER", "IRC_280E"],
  },
  {
    code: "atm_operation",
    label: "Work on the ATM business",
    treatment: "separate",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "separate_business",
    neverInventoriable: true,
    plainEnglish:
      "The ATM operation is a genuinely separate trade or business, so CHAMP says §280E does not reach it " +
      "and this wage is an ordinary deduction there. That is real and valuable — and it is exactly the kind " +
      "of split the IRS examines hardest, because it is the easiest to fake. Keep hours by business, keep " +
      "the books separate, and never allocate a budtender to the ATM to be helpful.",
    authorityIds: ["CHAMP_SEPARATE_TRADE", "IRC_6001_SUBSTANTIATION"],
  },
  {
    code: "landholding",
    label: "Work on the Geiger rental property",
    treatment: "separate",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "separate_business",
    neverInventoriable: true,
    plainEnglish:
      "The rental activity is its own trade or business under CHAMP, so wages for genuine work on it are " +
      "deductible there. Same warning as the ATM: the separation must be real, documented, and consistent " +
      "with how the person actually spends the week.",
    authorityIds: ["CHAMP_SEPARATE_TRADE", "IRC_6001_SUBSTANTIATION"],
  },
  {
    code: "cultivation_labor",
    label: "Growing / cultivating plants",
    treatment: "production",
    accountCode: PAYROLL_COGS_ACCOUNT,
    costClass: "cogs_allocable",
    neverInventoriable: false,
    plainEnglish:
      "This is the role everybody wishes applied. For an actual GROWER, Reg. §1.471-3(c) capitalises " +
      "'expenditures for direct labor', and this is that labor. Greenway's I-502 RETAIL licence does not " +
      "permit cultivating, so selecting this role on Greenway's books is refused outright — not to be " +
      "difficult, but because claiming producer treatment without producing is the exact position that " +
      "lost Harborside, Richmond and Alternative Health Care. It exists here so the fork is visible, and " +
      "so it works immediately if a producer licence is ever added.",
    authorityIds: ["REG_1_471_3_C_PRODUCER", "REG_1_263A_1_E_2_I_B_LABOR", "PATIENTS_MUTUAL_RESELLER"],
  },
  {
    code: "processing_labor",
    label: "Extracting or manufacturing infused product",
    treatment: "production",
    accountCode: PAYROLL_COGS_ACCOUNT,
    costClass: "cogs_allocable",
    neverInventoriable: false,
    plainEnglish:
      "Processing labor for a licensed PROCESSOR is direct labor under Reg. §1.471-3(c) and capitalises " +
      "into inventory. A retail licence does not permit it. Same reasoning as cultivation: the branch is " +
      "real, it is simply not Greenway's branch today.",
    authorityIds: ["REG_1_471_3_C_PRODUCER", "REG_1_263A_1_E_2_I_B_LABOR"],
  },
  {
    code: "owner_officer",
    label: "Owner / officer compensation",
    treatment: "owner",
    accountCode: WAGE_EXPENSE_ACCOUNT,
    costClass: "nondeductible_280e",
    neverInventoriable: true,
    plainEnglish:
      "This one is a vice. As an S-corporation you are REQUIRED to pay yourself reasonable compensation, " +
      "and §280E then disallows the deduction for it — so the payroll tax is real money out while the " +
      "deduction is worth nothing. Paying yourself too little to dodge that is its own well-trodden audit " +
      "adjustment. There is no clever answer; there is only paying a defensible wage and recording it " +
      "plainly. Your CPA sets the number, not this software.",
    authorityIds: ["IRC_280E", "SAVAGE_199A"],
  },
] as const;

export function findLaborRole(code: string): LaborRole | undefined {
  return LABOR_ROLES.find((r) => r.code === code);
}

/** Role codes whose wages can never reach inventory, whatever the evidence. */
export function neverInventoriableRoleCodes(): string[] {
  return LABOR_ROLES.filter((r) => r.neverInventoriable).map((r) => r.code);
}

/** Role codes that CAN reach inventory for a reseller, given proof. */
export function acquisitionRoleCodes(): string[] {
  return LABOR_ROLES.filter((r) => r.treatment === "acquisition").map((r) => r.code);
}

// ===========================================================================
// 4) SUBSTANTIATION — what proof an allocation must carry before it moves.
// ===========================================================================

/**
 * The plausibility ceiling on acquisition labor, in milli-percent of an
 * employee's paid time.
 *
 * WHY A CEILING EXISTS AT ALL. Harborside did not lose because its idea was
 * illegal; it lost because its numbers were not supported. A retailer claiming
 * that half the payroll was spent acquiring possession is making a claim that
 * fails the smell test before anyone opens a single record: a store open sixty
 * hours a week that receives two deliveries does not spend half its labor on
 * the loading dock.
 *
 * 25% is a REFUSAL THRESHOLD, not a target and not a safe harbour. There is no
 * safe harbour in the law. Anything at or above this is refused outright by this
 * core, and everything below it still has to be proved minute by minute. Set
 * high enough that a genuinely delivery-heavy week is not blocked; low enough
 * that the "just call a third of payroll COGS" idea cannot get through.
 */
export const ACQUISITION_LABOR_CEILING_MILLI_PCT = 25000;

/**
 * The point at which an allocation stops being routine and starts needing a
 * conversation. Below this, evidence is still required; above it, the system
 * says out loud that this is the number an examiner samples first.
 */
export const ACQUISITION_LABOR_SCRUTINY_MILLI_PCT = 10000;

/** Minimum days of contemporaneous time records behind an allocation study. */
export const MIN_SUBSTANTIATION_DAYS = 30;

export type TimeSubstantiation = {
  /** Days of contemporaneous records supporting the allocation. */
  daysOfRecords: number;
  /** True when the minutes were recorded as they happened, not reconstructed. */
  contemporaneous: boolean;
  /** True when time is attributed to a TASK, not just clocked in and out. */
  taskLevelDetail: boolean;
  /** True when receiving time can be tied to specific manifests/deliveries. */
  tiedToManifests: boolean;
  /** Reference to the written allocation study (gl_allocation_configs.document_ref). */
  documentRef: string | null;
  /** Written basis for the percentage (gl_allocation_configs.basis_note). */
  basisNote: string | null;
  /** Who reviewed it, e.g. "Nicholas Mullan, CPA". */
  approvedBy: string | null;
};

export type SubstantiationGap = {
  code: string;
  requirement: string;
  whyItMatters: string;
  howToFix: string;
  authorityIds: readonly string[];
};

/**
 * List everything missing before an acquisition-labor allocation may be posted.
 *
 * Returns an EMPTY array when the evidence is complete. Empty means "go", which
 * matches the gl_audit_*() convention used everywhere else in these books: the
 * function reports problems, and silence is the good outcome.
 */
export function substantiationGaps(sub: TimeSubstantiation): SubstantiationGap[] {
  const gaps: SubstantiationGap[] = [];

  if (!sub.contemporaneous) {
    gaps.push({
      code: "SUB_NOT_CONTEMPORANEOUS",
      requirement: "Time records must be made as the work happens.",
      whyItMatters:
        "A number reconstructed from memory in an audit is worth very little. Cohan lets a court estimate, " +
        "but it says the court may bear 'heavily... upon the taxpayer whose inexactitude is of his own " +
        "making'. Winning by estimate is the worst way to win.",
      howToFix:
        "Have staff clock the receiving task when they start it and end it when the product is put away. " +
        "The time clock in this system already records punches; what is missing is the task on the punch.",
      authorityIds: ["COHAN_ESTIMATE_LIMIT", "IRC_6001_SUBSTANTIATION"],
    });
  }

  if (!sub.taskLevelDetail) {
    gaps.push({
      code: "SUB_NO_TASK_DETAIL",
      requirement: "Time must be attributed to a task, not just to a shift.",
      whyItMatters:
        "A clock-in and a clock-out prove somebody was at work. They prove nothing about whether the hour " +
        "was spent on the receiving dock or behind the counter, and the counter is the hour that can never " +
        "be inventoried.",
      howToFix:
        "Record receiving as its own task with its own start and stop, separate from the general shift.",
      authorityIds: ["IRC_6001_SUBSTANTIATION", "REG_1_263A_1_E_2_I_B_LABOR"],
    });
  }

  if (!sub.tiedToManifests) {
    gaps.push({
      code: "SUB_NOT_TIED_TO_DELIVERIES",
      requirement: "Receiving time should tie to specific deliveries.",
      whyItMatters:
        "The claim is that the time was spent acquiring possession of GOODS. The manifest is the proof that " +
        "goods actually arrived at that moment. Receiving time on a day with no delivery is the first thing " +
        "an examiner will notice, and it undermines the honest hours too.",
      howToFix:
        "Link each receiving task to the manifest it belongs to. Greenway already records inbound manifests; " +
        "the link is the missing piece.",
      authorityIds: [
        "IRC_6001_SUBSTANTIATION",
        "REG_1_471_3_B_RESELLER",
        "WAC_314_55_083_TRACEABILITY",
        "WAC_314_55_087_EMPLOYEE_RECORDS",
      ],
    });
  }

  if (!Number.isFinite(sub.daysOfRecords) || sub.daysOfRecords < MIN_SUBSTANTIATION_DAYS) {
    gaps.push({
      code: "SUB_TOO_FEW_DAYS",
      requirement: `At least ${MIN_SUBSTANTIATION_DAYS} days of records behind the percentage.`,
      whyItMatters:
        "A percentage taken from three days is a guess wearing a decimal point. Deliveries cluster; a short " +
        "window can easily be double or half a normal month.",
      howToFix:
        `Keep recording. At ${MIN_SUBSTANTIATION_DAYS} days the study can be written; until then the wages ` +
        "post as ordinary payroll and nothing is lost — the classification can be revisited, because every " +
        "line is tagged rather than merged.",
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  if (!sub.documentRef || sub.documentRef.trim().length < 3) {
    gaps.push({
      code: "SUB_NO_STUDY_DOCUMENT",
      requirement: "A written allocation study must exist and be referenced.",
      whyItMatters:
        "The database will not store an allocation without a document reference — gl_allocation_configs " +
        "makes document_ref and basis_note NOT NULL on purpose. That constraint exists because an " +
        "unsupported allocation is the Harborside fact pattern.",
      howToFix:
        "Write one page: what was measured, over what period, by whom, and the arithmetic. Save it, and put " +
        "its reference on the allocation.",
      authorityIds: ["IRC_6001_SUBSTANTIATION", "PATIENTS_MUTUAL_RESELLER"],
    });
  }

  if (!sub.basisNote || sub.basisNote.trim().length < 3) {
    gaps.push({
      code: "SUB_NO_BASIS_NOTE",
      requirement: "The percentage must be explained in words.",
      whyItMatters:
        "In three years nobody will remember why the number was what it was — including you. A sentence " +
        "written today is worth more than an afternoon of reconstruction later.",
      howToFix:
        "One sentence: 'Receiving averaged X minutes per delivery across Y deliveries in [month], against " +
        "Z paid minutes, giving N%.'",
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  return gaps;
}

// ===========================================================================
// 5) THE PAYROLL RUN — inputs.
// ===========================================================================

export type PayrollAllocationInput = {
  /** Role code from LABOR_ROLES. */
  roleCode: string;
  /** Share of this employee's paid time, in milli-percent (10% = 10000). */
  shareMilliPct: number;
};

export type PayrollEmployeeInput = {
  employeeId: string;
  employeeName: string;
  /** Gross wages for the period, in integer cents. Must be >= 0. */
  grossWagesCents: number;
  /** Overtime portion of gross, in cents. Included IN grossWagesCents. */
  overtimeCents?: number;
  /** Paid sick / leave portion of gross, in cents. Included IN grossWagesCents. */
  paidLeaveCents?: number;
  /** Tax withheld from the employee. Trust money (§7501). */
  employeeWithholdingCents: number;
  /** Employer-side payroll taxes. Greenway's own cost. */
  employerTaxCents: number;
  /** Garnishments / child support withheld. Trust money for a third party. */
  garnishmentCents?: number;
  /** Repayment of an employee advance withheld from this cheque. */
  advanceRepaymentCents?: number;
  /** Net pay actually deposited. */
  netPayCents: number;
  /** How this person's time is split across roles. */
  allocations: readonly PayrollAllocationInput[];
  /** Hours worked in the period, when known — enables the wage-floor check. */
  hoursWorked?: number | null;
};

export type PayrollRunInput = {
  entityCode: EntityCode;
  /** ISO date (YYYY-MM-DD) the run is recorded on. */
  payDate: string;
  /** ISO date the pay period starts. */
  periodStart: string;
  /** ISO date the pay period ends. */
  periodEnd: string;
  employees: readonly PayrollEmployeeInput[];
  /** Activities the business actually performs — drives the character finding. */
  activityCodes: readonly string[];
  /** Evidence behind any acquisition-labor allocation. */
  substantiation?: TimeSubstantiation | null;
};

export type PayrollContext = {
  /** True when the period is closed in gl_periods. */
  periodClosed?: boolean;
  /**
   * Washington minimum wage for this pay date, in cents per hour. NOT hard-coded:
   * the rate changes every January under RCW 49.46.020, and a stale constant
   * silently blesses an illegal rate. Undefined means "cannot check".
   */
  minimumWageCentsPerHour?: number | null;
};

// ===========================================================================
// 6) FINDINGS — the push-back, with the reason and the fix attached.
// ===========================================================================

export type PayrollSeverity = "block" | "confirm" | "advise";

export type PayrollFinding = {
  code: string;
  severity: PayrollSeverity;
  /** What is wrong, in one sentence. */
  concern: string;
  /** Why it matters — the teaching. */
  why: string;
  /** What to do instead. Never just "no". */
  fix: string;
  /** Employee ids this concerns. Empty = the whole run. */
  employeeIds: readonly string[];
  authorityIds: readonly string[];
  /** A worked example, because Michael learns visually. */
  workedExample?: readonly string[];
};

/**
 * The complete list of reasons a payroll run is REFUSED outright. Exported so a
 * test can assert it has not quietly grown: the promise is that the system
 * teaches and pushes back, and only these are hard law.
 */
export const PAYROLL_HARD_BLOCKS: readonly string[] = [
  "PAY_NO_EMPLOYEES",
  "PAY_BAD_DATE",
  "PAY_PERIOD_BACKWARDS",
  "PAY_NEGATIVE_AMOUNT",
  "PAY_NET_MISMATCH",
  "PAY_ALLOCATION_NOT_100",
  "PAY_UNKNOWN_ROLE",
  "PAY_SELLING_LABOR_TO_COGS",
  "PAY_PRODUCER_CLAIM_BY_RESELLER",
  "PAY_PRODUCTION_LABOR_RETAIL_LICENCE",
  "PAY_ACQUISITION_OVER_CEILING",
  "PAY_ACQUISITION_UNSUBSTANTIATED",
  "PAY_PERIOD_CLOSED",
  "PAY_CANNABIS_LABOR_WRONG_ENTITY",
] as const;

export type PayrollVerdict = {
  /** False when at least one "block" finding exists. */
  postable: boolean;
  /** True when a "confirm" finding must be acknowledged first. */
  needsAcknowledgement: boolean;
  findings: readonly PayrollFinding[];
  character: CharacterDetermination;
  /** Gross wages across the run, in cents. */
  totalGrossCents: number;
  /** Wages that reach inventory as acquisition labor, in cents. */
  acquisitionLaborCents: number;
  /** Wages §280E disallows, in cents. */
  disallowedLaborCents: number;
  /** Wages belonging to a separate trade or business (CHAMP), in cents. */
  separateBusinessLaborCents: number;
  /**
   * Wages classified as PRODUCTION labor, in cents. On Greenway's retail books
   * this is always accompanied by a hard block; it is reported separately so the
   * amount at stake is visible rather than buried inside the disallowed total.
   */
  productionLaborCents: number;
  /** Employee withholding held in trust, in cents. */
  trustWithholdingCents: number;
  /** Employer-side payroll taxes, in cents. */
  employerTaxCents: number;
  /** Net pay to be deposited, in cents. */
  netPayCents: number;
};

// ===========================================================================
// 7) SMALL PURE HELPERS
// ===========================================================================

/** Format integer cents as "$1,234.56". Negative renders as "-$1,234.56". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/**
 * Format integer milli-percent as "12.5%".
 *
 * The sign is written explicitly rather than relying on `Math.trunc`. For a
 * value like -500, `Math.trunc(-500/1000)` is -0, and `${-0}` renders as "0",
 * so the naive version prints "0.5%" for MINUS half a percent. A dropped
 * minus sign on a percentage in a tax working paper is exactly the kind of
 * quiet error nobody catches by reading.
 */
export function formatMilliPct(milli: number): string {
  if (!Number.isFinite(milli)) return "0%";
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.trunc(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}%`;
  const trimmed = String(frac).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}.${trimmed}%`;
}

/**
 * True for a real YYYY-MM-DD calendar date. Rejects 2026-02-30 and friends.
 *
 * The month length is computed arithmetically rather than with
 * `new Date(Date.UTC(y, m, 0))`, because JavaScript maps two-digit years onto
 * 1900: `Date.UTC(26, 2, 0)` is 1926, not 2026. Those two years disagree about
 * February, so a typo'd year could silently change whether a date is valid.
 * Pure integer arithmetic has no such surprise.
 */
export function isValidIsoDate(value: string): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const lengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (lengths[m - 1] ?? 0);
}

/**
 * Split an amount across shares given in milli-percent, using the
 * LARGEST-REMAINDER method so the parts sum EXACTLY to the whole.
 *
 * Naive rounding loses or invents cents, and a one-cent drift in a payroll
 * journal is an unbalanced journal the ledger will refuse. Doing this with
 * integers throughout also means there is no float anywhere near the money.
 */
export function splitCentsByMilliPct(
  totalCents: number,
  shares: readonly number[],
): number[] {
  if (shares.length === 0) return [];
  if (!Number.isFinite(totalCents)) return shares.map(() => 0);

  // A non-finite or negative share is treated as zero rather than allowed to
  // poison the sort. NaN comparisons are always false, which silently scrambles
  // a comparator and would make the split non-deterministic -- the one thing a
  // PURE money function may never be.
  const clean = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const totalShare = clean.reduce((a, b) => a + b, 0);
  if (totalShare <= 0) return shares.map(() => 0);

  // Integer-exact largest remainder. The quotient and the remainder are derived
  // with integer arithmetic rather than by taking the fractional part of a
  // float, so ranking never depends on binary rounding. Math.floor is correct
  // for negative totals too: the leftover is always in [0, shares.length), so
  // the distribution loop below still terminates and still sums exactly.
  const base: number[] = [];
  const remNumer: number[] = [];
  for (const s of clean) {
    const numer = totalCents * s;
    const q = Math.floor(numer / totalShare);
    base.push(q);
    remNumer.push(numer - q * totalShare);
  }

  let remainder = totalCents - base.reduce((a, b) => a + b, 0);

  // Ties break on the lowest index so the same input always yields the same
  // split. An unstable tie-break would mean the same payroll run could produce
  // two different journals on two different days.
  const order = remNumer
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r || a.i - b.i);

  const out = base.slice();
  let k = 0;
  while (remainder > 0 && k < order.length) {
    out[order[k].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return out;
}

/** Sum of allocation shares for an employee, in milli-percent. */
export function totalAllocationMilliPct(
  allocations: readonly PayrollAllocationInput[],
): number {
  return allocations.reduce((sum, a) => sum + (Number.isFinite(a.shareMilliPct) ? a.shareMilliPct : 0), 0);
}

/** Share of an employee's time, in milli-percent, whose role is acquisition. */
export function acquisitionShareMilliPct(
  allocations: readonly PayrollAllocationInput[],
): number {
  let share = 0;
  for (const a of allocations) {
    const role = findLaborRole(a.roleCode);
    if (role && role.treatment === "acquisition") share += a.shareMilliPct;
  }
  return share;
}

// ===========================================================================
// 8) THE ENGINE — evaluate a payroll run and push back where it must.
// ===========================================================================

/**
 * Evaluate a whole payroll run. PURE: same input, same verdict, forever.
 *
 * Order matters. Structural problems come first — there is no point debating the
 * §280E character of a run whose net pay does not reconcile. Then character.
 * Then the labor classification, which is where the real teaching lives.
 */
export function evaluatePayrollRun(
  run: PayrollRunInput,
  ctx: PayrollContext = {},
): PayrollVerdict {
  const findings: PayrollFinding[] = [];
  const character = determineCharacter(run.activityCodes);

  // ---- STRUCTURE ---------------------------------------------------------
  if (run.employees.length === 0) {
    findings.push({
      code: "PAY_NO_EMPLOYEES",
      severity: "block",
      concern: "This payroll run has no employees on it.",
      why:
        "An empty run cannot be checked against anything and would post a journal describing nothing. Blank " +
        "entries are how a ledger fills up with rows nobody can explain later.",
      fix: "Add the employees and the amounts from the paystubs, then submit again.",
      employeeIds: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  for (const field of [
    ["payDate", run.payDate],
    ["periodStart", run.periodStart],
    ["periodEnd", run.periodEnd],
  ] as const) {
    if (!isValidIsoDate(field[1])) {
      findings.push({
        code: "PAY_BAD_DATE",
        severity: "block",
        concern: `The ${field[0]} "${field[1]}" is not a real date.`,
        why:
          "Every entry lands in an accounting period, and a period is chosen by date. A bad date either " +
          "refuses to post or, worse, posts into the wrong month and quietly moves income between years.",
        fix: "Use the YYYY-MM-DD form, for example 2026-11-13.",
        employeeIds: [],
        authorityIds: [],
      });
    }
  }

  if (
    isValidIsoDate(run.periodStart) &&
    isValidIsoDate(run.periodEnd) &&
    run.periodEnd < run.periodStart
  ) {
    findings.push({
      code: "PAY_PERIOD_BACKWARDS",
      severity: "block",
      concern: "The pay period ends before it starts.",
      why:
        "A backwards period makes every downstream report wrong — hours per week, overtime, and which month " +
        "the wage belongs to. It is almost always a typo, and it is cheap to catch here.",
      fix: "Check the two dates. The end date must be on or after the start date.",
      employeeIds: [],
      authorityIds: [],
    });
  }

  if (ctx.periodClosed === true) {
    findings.push({
      code: "PAY_PERIOD_CLOSED",
      severity: "block",
      concern: "That accounting period is already closed.",
      why:
        "A closed period has been reported. Writing into it changes a number somebody already relied on — a " +
        "tax return, an excise filing, a statement. Closing a period is a promise that it will not move.",
      fix:
        "Post the correction in the current open period instead, with a memo saying which period it relates " +
        "to. That leaves an honest trail, which is the point.",
      employeeIds: [],
      authorityIds: ["IRC_6001_SUBSTANTIATION"],
    });
  }

  // ---- PER EMPLOYEE ------------------------------------------------------
  let totalGross = 0;
  let acquisitionCents = 0;
  let disallowedCents = 0;
  let separateCents = 0;
  let productionCents = 0;
  let trustWithholding = 0;
  let employerTax = 0;
  let netPay = 0;

  for (const emp of run.employees) {
    const ids = [emp.employeeId];

    // Negative money is never right on a payroll run.
    const moneyFields: readonly (readonly [string, number | undefined])[] = [
      ["gross wages", emp.grossWagesCents],
      ["overtime", emp.overtimeCents],
      ["paid leave", emp.paidLeaveCents],
      ["employee withholding", emp.employeeWithholdingCents],
      ["employer payroll tax", emp.employerTaxCents],
      ["garnishment", emp.garnishmentCents],
      ["advance repayment", emp.advanceRepaymentCents],
      ["net pay", emp.netPayCents],
    ];
    for (const [label, value] of moneyFields) {
      if (value == null) continue;
      if (!Number.isInteger(value) || value < 0) {
        findings.push({
          code: "PAY_NEGATIVE_AMOUNT",
          severity: "block",
          concern: `${emp.employeeName}: ${label} is ${String(value)}, which is not a whole number of cents at or above zero.`,
          why:
            "Money in this system is always integer cents. A fraction of a cent means a float crept in, and " +
            "floats drift. A negative wage means a correction is being disguised as a payroll run.",
          fix:
            "Enter the amount from the paystub in whole cents. To reverse a previous run, post a reversing " +
            "entry so both the original and the correction stay visible.",
          employeeIds: ids,
          authorityIds: [],
        });
      }
    }

    const gross = Math.max(0, emp.grossWagesCents || 0);
    const withheld = Math.max(0, emp.employeeWithholdingCents || 0);
    const garnish = Math.max(0, emp.garnishmentCents || 0);
    const advance = Math.max(0, emp.advanceRepaymentCents || 0);
    const net = Math.max(0, emp.netPayCents || 0);

    // Net pay must reconcile. This is the arithmetic Sage was never asked to do.
    const expectedNet = gross - withheld - garnish - advance;
    if (expectedNet !== net) {
      findings.push({
        code: "PAY_NET_MISMATCH",
        severity: "block",
        concern:
          `${emp.employeeName}: gross ${formatCents(gross)} less withholding ${formatCents(withheld)}` +
          (garnish > 0 ? `, garnishment ${formatCents(garnish)}` : "") +
          (advance > 0 ? `, advance repayment ${formatCents(advance)}` : "") +
          ` comes to ${formatCents(expectedNet)}, but net pay is entered as ${formatCents(net)}.`,
        why:
          "If these do not tie, one of the numbers is wrong, and every one of them matters: gross drives the " +
          "wage expense, withholding is trust money you owe the government, and net is what actually leaves " +
          "the bank. A run that does not reconcile will not balance in the ledger either.",
        fix:
          `Re-read the paystub. The difference is ${formatCents(Math.abs(expectedNet - net))}, which is ` +
          "usually a deduction that was entered on one line but not the other.",
        employeeIds: ids,
        authorityIds: ["IRC_7501_TRUST"],
        workedExample: [
          "Gross wages              1,600.00",
          "  less tax withheld        320.00   -> owed to the government, not yours",
          "  less garnishment           0.00",
          "  less advance repaid      100.00   -> repays account 12100",
          "  = net pay              1,180.00   -> the amount deposited",
        ],
      });
    }

    // ---- ALLOCATION SHAPE ------------------------------------------------
    const totalShare = totalAllocationMilliPct(emp.allocations);
    if (emp.allocations.length === 0 || totalShare !== 100000) {
      findings.push({
        code: "PAY_ALLOCATION_NOT_100",
        severity: "block",
        concern:
          `${emp.employeeName}: the time split adds to ${formatMilliPct(totalShare)}, not 100%.`,
        why:
          "Every paid hour has to land somewhere. A split that adds to less than 100% leaves wages " +
          "unclassified; more than 100% double-counts them. Either way the §280E answer is wrong, and the " +
          "journal will not balance.",
        fix:
          "Adjust the shares until they total 100%. If most of the week is ordinary floor work, that is a " +
          "large share on the sales role — which is honest and costs you nothing you were entitled to.",
        employeeIds: ids,
        authorityIds: ["IRC_6001_SUBSTANTIATION"],
      });
    }

    // Classify this employee's gross using the SAME largest-remainder split the
    // journal builder uses. An earlier version rounded each share independently
    // here while the journal used largest-remainder, so the figure Michael was
    // shown could differ by a cent or two from the figure actually posted to
    // 61000. A report that disagrees with the ledger it describes is worse than
    // no report, because it is believed.
    const empPortions = splitCentsByMilliPct(
      gross,
      emp.allocations.map((a) => (Number.isFinite(a.shareMilliPct) && a.shareMilliPct > 0 ? a.shareMilliPct : 0)),
    );

    emp.allocations.forEach((alloc, idx) => {
      const role = findLaborRole(alloc.roleCode);
      if (!role) {
        findings.push({
          code: "PAY_UNKNOWN_ROLE",
          severity: "block",
          concern: `${emp.employeeName}: "${alloc.roleCode}" is not a labor role this system knows.`,
          why:
            "An unrecognised role has no §280E treatment, so the wage cannot be classified. Guessing a " +
            "treatment is precisely what this system exists to stop.",
          fix:
            `Choose one of: ${LABOR_ROLES.map((r) => r.code).join(", ")}. If the work genuinely does not fit ` +
            "any of them, that is worth a conversation before payroll posts, not after.",
          employeeIds: ids,
          authorityIds: [],
        });
        return;
      }

      const portion = empPortions[idx] ?? 0;

      if (role.treatment === "acquisition") acquisitionCents += portion;
      else if (role.treatment === "separate") separateCents += portion;
      else if (role.treatment === "production") productionCents += portion;
      else disallowedCents += portion;
    });

    totalGross += gross;
    trustWithholding += withheld;
    employerTax += Math.max(0, emp.employerTaxCents || 0);
    netPay += net;

    // ---- WAGE FLOOR ------------------------------------------------------
    if (
      ctx.minimumWageCentsPerHour != null &&
      ctx.minimumWageCentsPerHour > 0 &&
      emp.hoursWorked != null &&
      emp.hoursWorked > 0
    ) {
      const effectiveRate = Math.floor(gross / emp.hoursWorked);
      if (effectiveRate < ctx.minimumWageCentsPerHour) {
        findings.push({
          code: "PAY_BELOW_MINIMUM_WAGE",
          severity: "confirm",
          concern:
            `${emp.employeeName}: ${formatCents(gross)} over ${emp.hoursWorked} hours works out to ` +
            `${formatCents(effectiveRate)} an hour, below the ${formatCents(ctx.minimumWageCentsPerHour)} ` +
            "minimum in force for this pay date.",
          why:
            "Washington's minimum wage rises every January under RCW 49.46.020 and is among the highest in " +
            "the country. Underpaying is a wage claim, and wage claims in a cash business attract exactly " +
            "the kind of attention nobody wants.",
          fix:
            "Check the hours and the gross. If both are right, the rate needs to come up before this run is " +
            "paid. If the hours include unpaid break time, correct the hours instead.",
          employeeIds: ids,
          authorityIds: ["RCW_49_46_020_MINWAGE"],
        });
      }
    }

    if (advance > 0) {
      findings.push({
        code: "PAY_ADVANCE_REPAYMENT",
        severity: "advise",
        concern: `${emp.employeeName}: ${formatCents(advance)} is being withheld to repay an advance.`,
        why:
          "This is the case you asked about — lending an employee money. Handled correctly it is not an " +
          "expense at all: the loan created a receivable in 12100, and the repayment reduces it. Handled " +
          "carelessly it becomes a wage deduction that §280E disallows twice over, once going out and once " +
          "coming back.",
        fix:
          "Nothing to change — the entry below already credits 12100 rather than touching wage expense. Keep " +
          "the written loan terms with the employee file.",
        employeeIds: ids,
        authorityIds: ["IRC_6001_SUBSTANTIATION"],
        workedExample: [
          "When the advance is made:",
          "  Dr 12100 Employee Advances Receivable   500.00",
          "     Cr 10200 Bank — Operating                    500.00",
          "",
          "When it is repaid out of a cheque:",
          "  Dr 31000 Accrued Payroll                500.00",
          "     Cr 12100 Employee Advances Receivable        500.00",
          "",
          "Wage expense is never touched. The loan was never an expense.",
        ],
      });
    }
  }

  // ---- THE BIG ONE: selling labor pointed at COGS ------------------------
  for (const emp of run.employees) {
    for (const alloc of emp.allocations) {
      const role = findLaborRole(alloc.roleCode);
      if (!role) continue;
      if (role.neverInventoriable && role.accountCode === PAYROLL_COGS_ACCOUNT) {
        // Defensive: no LABOR_ROLES row should be shaped this way. If one ever
        // is, refuse loudly rather than post it.
        findings.push({
          code: "PAY_SELLING_LABOR_TO_COGS",
          severity: "block",
          concern: `${emp.employeeName}: the role "${role.code}" is pointed at the COGS payroll account but can never be inventoried.`,
          why:
            "Reg. §1.471-3(c) allows indirect production costs into inventory 'but not including any cost of " +
            "selling'. That exclusion binds even a grower. A retailer has no direct-labor clause at all.",
          fix: "Post these wages to 71010 as ordinary payroll. The deduction is disallowed either way; the difference is whether the return is defensible.",
          employeeIds: [emp.employeeId],
          authorityIds: ["REG_1_471_3_C_PRODUCER", "REG_1_471_3_B_RESELLER"],
        });
      }
    }
  }

  // ---- ACQUISITION LABOR: the narrow door, and its lock -------------------
  // Weight the ceiling test by DOLLARS, not by headcount.
  //
  // The earlier version averaged each employee's percentage, which is the
  // classic Simpson's-paradox trap: a part-time receiver at 100% receiving and
  // four full-time budtenders at 0% averages to 20% and passes, even though the
  // receiver might be 3% of the payroll. Conversely one small cheque at 100%
  // could block an otherwise modest run. The question the ceiling is really
  // asking is "what share of the MONEY is being moved into inventory", so that
  // is what is measured.
  const runAcquisitionShare =
    totalGross <= 0 ? 0 : Math.round((acquisitionCents * 100000) / totalGross);

  if (acquisitionCents > 0) {
    if (character.character === "reseller") {
      findings.push({
        code: "PAY_ACQUISITION_LABOR_CLAIMED",
        severity: "confirm",
        concern:
          `${formatCents(acquisitionCents)} of wages is being treated as the cost of acquiring possession of goods.`,
        why:
          "This is a real position with a real basis — Reg. §1.471-3(b) adds to invoice price 'transportation " +
          "or other necessary charges incurred in acquiring possession of the goods', and receiving labor is " +
          "such a charge. It is also the number an examiner will go to first, because it is the only labor " +
          "dollar a retailer can defend at all. So it must be right, and it must be provable.",
        fix:
          "Confirm that every minute in this figure was spent taking delivery of goods — meeting the " +
          "transporter, counting against the manifest, moving product to the vault — and that it stops when " +
          "the product is put away. Time spent selling that product later is a different thing entirely.",
        employeeIds: [],
        authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_6001_SUBSTANTIATION", "PATIENTS_MUTUAL_RESELLER"],
        workedExample: [
          "A delivery arrives. Two people spend 40 minutes each receiving it.",
          "",
          "  80 minutes x $22/hour = $29.33",
          "    Dr 61000 Payroll — Inventory Handling (allocable)   29.33",
          "",
          "Those same two people then spend the rest of the shift on the floor:",
          "    Dr 71010 Wages & Salaries                          <the rest>",
          "",
          "The first line rides into inventory and comes out as COGS when the",
          "product sells. The second is disallowed by §280E. Same people, same",
          "day, different dollars — which is exactly why the minutes matter.",
        ],
      });
    }

    if (runAcquisitionShare >= ACQUISITION_LABOR_CEILING_MILLI_PCT) {
      findings.push({
        code: "PAY_ACQUISITION_OVER_CEILING",
        severity: "block",
        concern:
          `Acquisition labor averages ${formatMilliPct(runAcquisitionShare)} of paid time, at or above the ` +
          `${formatMilliPct(ACQUISITION_LABOR_CEILING_MILLI_PCT)} limit this system will post.`,
        why:
          "A retail store that receives a handful of deliveries a week does not spend a quarter of its payroll " +
          "on the receiving dock, and a number that large fails the smell test before anyone opens a record. " +
          "Harborside did not lose because its theory was illegal; it lost because its numbers were not " +
          "supported. An overstated allocation also poisons the honest part of the claim.",
        fix:
          "Bring the percentage back to what the time records actually show. If the records genuinely show " +
          "this much receiving time, that is a conversation to have with your CPA with the study in hand — " +
          "not something to push through software.",
        employeeIds: [],
        authorityIds: ["PATIENTS_MUTUAL_RESELLER", "RICHMOND_PATIENTS", "IRC_6001_SUBSTANTIATION"],
      });
    } else if (runAcquisitionShare >= ACQUISITION_LABOR_SCRUTINY_MILLI_PCT) {
      findings.push({
        code: "PAY_ACQUISITION_HIGH_SHARE",
        severity: "confirm",
        concern:
          `Acquisition labor is ${formatMilliPct(runAcquisitionShare)} of paid time, which is high for a retailer.`,
        why:
          "Not wrong, but conspicuous. Above roughly ten percent, the allocation stops looking like a rounding " +
          "detail and starts looking like a tax position — which means it needs to be able to stand on its own " +
          "in an examination.",
        fix:
          "Make sure the study behind it names the deliveries and the minutes. If this month was unusually " +
          "delivery-heavy, say so in the basis note; a documented reason for an unusual month is worth more " +
          "than a smooth number nobody can explain.",
        employeeIds: [],
        authorityIds: ["IRC_6001_SUBSTANTIATION", "COHAN_ESTIMATE_LIMIT"],
      });
    }

    const gaps = substantiationGaps(
      run.substantiation ?? {
        daysOfRecords: 0,
        contemporaneous: false,
        taskLevelDetail: false,
        tiedToManifests: false,
        documentRef: null,
        basisNote: null,
        approvedBy: null,
      },
    );
    if (gaps.length > 0) {
      findings.push({
        code: "PAY_ACQUISITION_UNSUBSTANTIATED",
        severity: "block",
        concern:
          `${formatCents(acquisitionCents)} is being moved into inventory cost, but ${gaps.length} piece` +
          `${gaps.length === 1 ? "" : "s"} of the supporting evidence ${gaps.length === 1 ? "is" : "are"} missing.`,
        why:
          "Under §6001 the burden of proof is yours. The database agrees: gl_allocation_configs will not even " +
          "store an allocation without a document reference and a written basis. An allocation you cannot " +
          "document is an allocation you do not have — that is the Harborside fact pattern in one line.",
        fix: gaps.map((g) => `${g.requirement} ${g.howToFix}`).join(" "),
        employeeIds: [],
        authorityIds: ["IRC_6001_SUBSTANTIATION", "PATIENTS_MUTUAL_RESELLER", "COHAN_ESTIMATE_LIMIT"],
      });
    }
  }

  // ---- PRODUCER CLAIM BY A RESELLER --------------------------------------
  for (const emp of run.employees) {
    for (const alloc of emp.allocations) {
      const role = findLaborRole(alloc.roleCode);
      if (!role) continue;
      if (role.treatment === "production" && character.character === "reseller") {
        findings.push({
          code: "PAY_PRODUCER_CLAIM_BY_RESELLER",
          severity: "block",
          concern: `${emp.employeeName}: production labor is claimed, but the activities listed are all reseller activities.`,
          why:
            "Only Reg. §1.471-3(c) lets 'expenditures for direct labor' into inventory, and it applies to " +
            "merchandise 'produced by the taxpayer'. Richmond Patients Group trimmed and dried product and " +
            "was still a reseller. Claiming production labor without producing is the aggressive position " +
            "that lost three Tax Court cases.",
          fix:
            "If Greenway really has started producing — a processor licence, actual manufacturing — record " +
            "those activities and the answer here changes on its own. If not, reclassify this time.",
          employeeIds: [emp.employeeId],
          authorityIds: ["REG_1_471_3_C_PRODUCER", "RICHMOND_PATIENTS", "PATIENTS_MUTUAL_RESELLER"],
        });
      } else if (role.treatment === "production" && run.entityCode === "greenway") {
        // The licence governs, not the activity list.
        //
        // Without this branch there was a way through: type "cultivate" into the
        // activity list, become a "producer" in the eyes of determineCharacter,
        // and the block above stops firing — so production labor capitalises on
        // a RETAIL licensee's books. The activity list is self-reported, and a
        // self-reported field must never be the only thing standing between a
        // taxpayer and an aggressive position. Greenway holds an I-502 retail
        // licence; it cannot lawfully cultivate or process, so production labor
        // on Greenway's books is refused however the activities were entered.
        findings.push({
          code: "PAY_PRODUCTION_LABOR_RETAIL_LICENCE",
          severity: "block",
          concern: `${emp.employeeName}: production labor is being capitalised on Greenway's books, but Greenway holds a retail licence.`,
          why:
            "Reg. §1.471-3(c) capitalises direct labor for merchandise 'produced by the taxpayer'. A I-502 " +
            "RETAIL licence does not permit cultivating, extracting or manufacturing, so there is no " +
            "production for that labor to attach to. Recording cultivation activities on a retailer's books " +
            "does not create the licence — it just moves the problem from the tax return to the licence " +
            "file, where the consequence is worse than money.",
          fix:
            "Reclassify this time to the role that describes what actually happened — receiving if it was " +
            "taking delivery, otherwise ordinary payroll. If Greenway has genuinely obtained a producer or " +
            "processor licence, that is a real change worth telling your CPA about, and this system should " +
            "be updated deliberately rather than worked around.",
          employeeIds: [emp.employeeId],
          authorityIds: ["REG_1_471_3_C_PRODUCER", "WAC_314_55_083_TRACEABILITY", "PATIENTS_MUTUAL_RESELLER"],
        });
      }
    }
  }

  // ---- ENTITY SANITY ------------------------------------------------------
  if (run.entityCode !== "greenway" && acquisitionCents > 0) {
    findings.push({
      code: "PAY_CANNABIS_LABOR_WRONG_ENTITY",
      severity: "block",
      concern: `Acquisition labor for cannabis inventory is being posted to the "${run.entityCode}" books.`,
      why:
        "Only Greenway holds cannabis inventory. Putting cannabis costs into the ATM or landholding books " +
        "destroys the separation that keeps those businesses deductible under CHAMP — and that separation is " +
        "worth far more than the allocation being attempted.",
      fix: "Post this run to the greenway entity, or reclassify the time to a role that fits the entity doing the work.",
      employeeIds: [],
      authorityIds: ["CHAMP_SEPARATE_TRADE"],
    });
  }

  // ---- ALWAYS SAY THE HARD THING OUT LOUD --------------------------------
  if (character.character === "reseller" && disallowedCents > 0) {
    findings.push({
      code: "PAY_280E_DISALLOWANCE_EXPLAINED",
      severity: "advise",
      concern: `${formatCents(disallowedCents)} of this payroll is disallowed by §280E.`,
      why:
        "This is not a mistake in the bookkeeping and it is not something better software can fix. §280E " +
        "denies the deduction for wages paid in a cannabis trade, and as a reseller you have no direct-labor " +
        "clause to move them through. Recording it plainly is the correct outcome — the alternative is a " +
        "position that cannot survive being looked at.",
      fix:
        "Nothing to change. The one lever that is real is making sure genuine receiving time is captured as " +
        "receiving time, and that the ATM and rental work is kept separate and documented.",
      employeeIds: [],
      authorityIds: ["IRC_280E", "SENATE_REPORT_97_494", "ALPENGLOW_EXCLUSION"],
    });
  }

  if (trustWithholding > 0) {
    findings.push({
      code: "PAY_TRUST_FUND_REMINDER",
      severity: "advise",
      concern: `${formatCents(trustWithholding)} withheld from employees is trust money, not Greenway's.`,
      why:
        "§7501 says withheld tax 'shall be held to be a special fund in trust for the United States'. It sits " +
        "in 31100 as a liability until it is paid over. If it is ever spent on something else, §6672 imposes a " +
        "penalty equal to 100% of the money — assessed against a PERSON, which the corporation does not shield " +
        "you from. In a cash business this is the one that can reach your house.",
      fix:
        "Pay it over on schedule and watch 31100 go back to zero every cycle. A balance that keeps growing " +
        "there is the earliest warning sign this system can give you.",
      employeeIds: [],
      authorityIds: ["IRC_7501_TRUST", "IRC_6672_TRUST_PENALTY"],
    });
  }

  if (character.unknownActivities.length > 0) {
    findings.push({
      code: "PAY_UNKNOWN_ACTIVITY",
      severity: "confirm",
      concern: `These activities are not recognised: ${character.unknownActivities.join(", ")}.`,
      why:
        "The reseller-or-producer answer is built from the activity list, so an activity the system does not " +
        "understand is a hole in the reasoning. It is reported rather than ignored, because a silently " +
        "dropped input is how a wrong answer looks confident.",
      fix: `Use one of: ${PRODUCTION_ACTIVITIES.map((a) => a.code).join(", ")}.`,
      employeeIds: [],
      authorityIds: [],
    });
  }

  const blocked = findings.some((f) => f.severity === "block");
  return {
    postable: !blocked,
    needsAcknowledgement: findings.some((f) => f.severity === "confirm"),
    findings,
    character,
    totalGrossCents: totalGross,
    acquisitionLaborCents: acquisitionCents,
    disallowedLaborCents: disallowedCents,
    separateBusinessLaborCents: separateCents,
    productionLaborCents: productionCents,
    trustWithholdingCents: trustWithholding,
    employerTaxCents: employerTax,
    netPayCents: netPay,
  };
}

// ===========================================================================
// 9) THE JOURNAL — turning a verdict into balanced double-entry.
// ===========================================================================

export type PayrollJournalLine = {
  accountCode: string;
  /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit. */
  amountCents: number;
  costClass: CostClass;
  description: string;
};

export type PayrollJournal = {
  entityCode: EntityCode;
  journalDate: string;
  sourceKind: "payroll";
  /** Idempotency reference. The same run submitted twice makes ONE journal. */
  sourceRef: string;
  memo: string;
  lines: readonly PayrollJournalLine[];
};

/**
 * Build the idempotency reference for a payroll run.
 *
 * Payroll is the entry most likely to be submitted twice — a slow save, a
 * double-click, a re-run after a browser refresh. Two payroll journals in one
 * period doubles wage expense and doubles the trust liability, and the second is
 * the kind of error that is only found when the IRS notices the deposits do not
 * match the return.
 */
export function payrollSourceRef(run: PayrollRunInput): string {
  const entity = (run.entityCode ?? "").trim().toLowerCase();
  return `payroll:${entity}:${run.periodStart}:${run.periodEnd}:${run.payDate}`;
}

/**
 * A short, stable fingerprint of what a payroll run actually CONTAINS.
 *
 * `payrollSourceRef` deliberately keys only on entity + period + pay date, so a
 * double-click cannot post payroll twice. That is the right default, but it has
 * a sharp edge worth naming: if a run is submitted, then corrected, then
 * submitted again for the SAME period and pay date, the reference is identical
 * and the ledger's idempotency will treat the corrected figures as a duplicate
 * and silently keep the ORIGINAL, wrong numbers.
 *
 * This fingerprint lets the caller detect exactly that case — same reference,
 * different content — and say so out loud instead of losing the correction.
 *
 * It is a plain deterministic string hash (FNV-1a, 32-bit, in hex). It is not
 * cryptography and is not used for anything security-bearing; it only has to be
 * stable and to change when the money changes. Written with `Math.imul` and
 * `>>> 0` so it stays inside 32-bit integer arithmetic, and with no BigInt,
 * which this repo forbids.
 */
export function payrollContentFingerprint(run: PayrollRunInput): string {
  const parts: string[] = [
    (run.entityCode ?? "").trim().toLowerCase(),
    run.periodStart,
    run.periodEnd,
    run.payDate,
  ];

  // Employees are sorted so that re-ordering the same people does not look like
  // a different payroll run.
  const rows = run.employees
    .map((e) => {
      const allocs = e.allocations
        .map((a) => `${a.roleCode}@${a.shareMilliPct}`)
        .slice()
        .sort()
        .join(",");
      return [
        e.employeeId,
        e.grossWagesCents,
        e.employeeWithholdingCents,
        e.employerTaxCents,
        e.garnishmentCents ?? 0,
        e.advanceRepaymentCents ?? 0,
        e.netPayCents,
        allocs,
      ].join("|");
    })
    .slice()
    .sort();

  const text = parts.concat(rows).join(";");

  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Turn an evaluated payroll run into a balanced journal.
 *
 * Returns null when the verdict is not postable, so a refused run cannot
 * accidentally become an entry. A null return keeps the function total and makes
 * "did we check first?" visible at every call site.
 *
 * THE SHAPE, and why each line is where it is:
 *
 *   Dr 61000  Payroll — Inventory Handling      acquisition labor only, proved
 *   Dr 71010  Wages & Salaries                  everything else, §280E disallowed
 *   Dr 71040  Employer Payroll Taxes            Greenway's own cost
 *      Cr 31100  Payroll Taxes Payable — Withheld    §7501 trust money
 *      Cr 31200  Payroll Taxes Payable — Employer
 *      Cr 31300  Garnishments & Child Support        someone else's money
 *      Cr 12100  Employee Advances Receivable        repayment, NOT an expense
 *      Cr 31000  Accrued Payroll                     net pay owed to staff
 *
 * The debits are the cost of employing people. The credits are every different
 * person that money is owed to. Gross wages are split between 61000 and 71010
 * using the largest-remainder method, so the pennies always add up exactly.
 */
export function buildPayrollJournal(
  run: PayrollRunInput,
  verdict: PayrollVerdict,
): PayrollJournal | null {
  if (!verdict.postable) return null;

  const lines: PayrollJournalLine[] = [];

  let acquisitionTotal = 0;
  let separateTotal = 0;
  let productionTotal = 0;
  let ordinaryTotal = 0;
  let withheldTotal = 0;
  let employerTaxTotal = 0;
  let garnishTotal = 0;
  let advanceTotal = 0;
  let netTotal = 0;

  for (const emp of run.employees) {
    const gross = Math.max(0, emp.grossWagesCents || 0);

    // Split gross across the roles with largest-remainder, so the parts sum to
    // gross EXACTLY. Rounding each share independently loses cents, and a lost
    // cent is an unbalanced journal the ledger will refuse.
    const shares = emp.allocations.map((a) => Math.max(0, a.shareMilliPct));
    const portions = splitCentsByMilliPct(gross, shares);

    emp.allocations.forEach((alloc, i) => {
      const role = findLaborRole(alloc.roleCode);
      const portion = portions[i] ?? 0;
      if (!role || portion === 0) return;
      if (role.treatment === "acquisition") acquisitionTotal += portion;
      else if (role.treatment === "separate") separateTotal += portion;
      else if (role.treatment === "production") productionTotal += portion;
      else ordinaryTotal += portion;
    });

    withheldTotal += Math.max(0, emp.employeeWithholdingCents || 0);
    employerTaxTotal += Math.max(0, emp.employerTaxCents || 0);
    garnishTotal += Math.max(0, emp.garnishmentCents || 0);
    advanceTotal += Math.max(0, emp.advanceRepaymentCents || 0);
    netTotal += Math.max(0, emp.netPayCents || 0);
  }

  const period = `${run.periodStart} to ${run.periodEnd}`;

  if (acquisitionTotal > 0) {
    lines.push({
      accountCode: PAYROLL_COGS_ACCOUNT,
      amountCents: acquisitionTotal,
      costClass: "cogs_allocable",
      description: `Receiving / intake labor — acquiring possession of goods — ${period}`,
    });
  }

  if (separateTotal > 0) {
    lines.push({
      accountCode: WAGE_EXPENSE_ACCOUNT,
      amountCents: separateTotal,
      costClass: "separate_business",
      description: `Wages — separate trade or business (CHAMP) — ${period}`,
    });
  }

  // Production labor. On Greenway's retail books this is unreachable, because
  // PAY_PRODUCTION_LABOR_RETAIL_LICENCE blocks the run before it can be built.
  // The line exists so that a genuine producer entity still produces a BALANCED
  // journal: a bucket that is counted in the split but has no line to land on
  // would silently break the double entry, and "unreachable today" is not a
  // reason to leave an arithmetic hole in a money function.
  if (productionTotal > 0) {
    lines.push({
      accountCode: PAYROLL_COGS_ACCOUNT,
      amountCents: productionTotal,
      costClass: "cogs_allocable",
      description: `Direct production labor — Reg. §1.471-3(c) — ${period}`,
    });
  }

  if (ordinaryTotal > 0) {
    lines.push({
      accountCode: WAGE_EXPENSE_ACCOUNT,
      amountCents: ordinaryTotal,
      costClass: "nondeductible_280e",
      description: `Wages & salaries — ${period}`,
    });
  }

  if (employerTaxTotal > 0) {
    lines.push({
      accountCode: EMPLOYER_TAX_EXPENSE_ACCOUNT,
      amountCents: employerTaxTotal,
      costClass: "nondeductible_280e",
      description: `Employer payroll taxes (FICA, FUTA, SUTA, L&I, PFML) — ${period}`,
    });
  }

  if (withheldTotal > 0) {
    lines.push({
      accountCode: WITHHELD_TAX_ACCOUNT,
      amountCents: -withheldTotal,
      costClass: "none",
      description: `Tax withheld from employees — held in trust under §7501 — ${period}`,
    });
  }

  if (employerTaxTotal > 0) {
    lines.push({
      accountCode: EMPLOYER_TAX_PAYABLE_ACCOUNT,
      amountCents: -employerTaxTotal,
      costClass: "none",
      description: `Employer payroll taxes payable — ${period}`,
    });
  }

  if (garnishTotal > 0) {
    lines.push({
      accountCode: GARNISHMENT_ACCOUNT,
      amountCents: -garnishTotal,
      costClass: "none",
      description: `Garnishments withheld for remittance — ${period}`,
    });
  }

  if (advanceTotal > 0) {
    lines.push({
      accountCode: EMPLOYEE_ADVANCE_ACCOUNT,
      amountCents: -advanceTotal,
      costClass: "none",
      description: `Employee advances repaid out of pay — reduces the receivable, not an expense — ${period}`,
    });
  }

  if (netTotal > 0) {
    lines.push({
      accountCode: ACCRUED_PAYROLL_ACCOUNT,
      amountCents: -netTotal,
      costClass: "none",
      description: `Net pay owed to employees — ${period}`,
    });
  }

  return {
    entityCode: run.entityCode,
    journalDate: run.payDate,
    sourceKind: "payroll",
    sourceRef: payrollSourceRef(run),
    memo: `Payroll — ${period} — paid ${run.payDate}`,
    lines,
  };
}

/** A journal is balanced when its signed amounts sum to exactly zero. */
export function payrollJournalIsBalanced(journal: PayrollJournal): boolean {
  let sum = 0;
  for (const l of journal.lines) sum += l.amountCents;
  return sum === 0;
}

/**
 * The SECOND journal: paying the net wages out of the bank.
 *
 * Kept separate from the accrual on purpose. Greenway is on the accrual basis,
 * so the wage belongs to the period it was EARNED, while the cash leaves when
 * the ACH settles — often a different month. Collapsing the two into one entry
 * is how an accrual-basis set of books quietly becomes cash-basis without anyone
 * deciding to change method.
 */
export function buildPayrollPaymentJournal(
  run: PayrollRunInput,
  paymentDate: string,
  bankAccountCode: string = OPERATING_BANK_ACCOUNT,
): PayrollJournal | null {
  const net = run.employees.reduce((sum, e) => sum + Math.max(0, e.netPayCents || 0), 0);
  if (net <= 0) return null;
  if (!isValidIsoDate(paymentDate)) return null;

  return {
    entityCode: run.entityCode,
    journalDate: paymentDate,
    sourceKind: "payroll",
    sourceRef: `${payrollSourceRef(run)}:paid:${paymentDate}`,
    memo: `Payroll paid — ${run.periodStart} to ${run.periodEnd}`,
    lines: [
      {
        accountCode: ACCRUED_PAYROLL_ACCOUNT,
        amountCents: net,
        costClass: "none",
        description: "Clearing net pay previously accrued",
      },
      {
        accountCode: bankAccountCode,
        amountCents: -net,
        costClass: "none",
        description: `Direct deposit for pay period ${run.periodStart} to ${run.periodEnd}`,
      },
    ],
  };
}

// ===========================================================================
// 10) THE DECISION TREE — the visual version of all of the above.
// ===========================================================================
/**
 * Michael: "I learn best visually... I have always needed a mentor, a cpa or
 * cfo to shadow, I want our platform to be that mentor."
 *
 * So the same rules are also expressed as a walkable question tree. Same logic,
 * different door: the engine answers "is this run OK?", the tree answers "why,
 * and what would have to be different?".
 */
export type LaborDecisionBranch = {
  answer: boolean;
  /** Next question id, or null when this branch reaches an answer. */
  next: string | null;
  /** The outcome when next is null. */
  outcome?: string;
  explanation: string;
  authorityIds: readonly string[];
};

export type LaborDecisionNode = {
  id: string;
  question: string;
  /** Why this question is asked at all. */
  whyAsked: string;
  yes: LaborDecisionBranch;
  no: LaborDecisionBranch;
};

export const LABOR_DECISION_TREE: readonly LaborDecisionNode[] = [
  {
    id: "q1_selling",
    question: "Was this time spent selling — serving customers, advising them, marketing, or running promotions?",
    whyAsked:
      "Selling is asked FIRST because it is the only answer that is final. Everything else has nuance; this " +
      "does not.",
    yes: {
      answer: true,
      next: null,
      outcome: "Ordinary payroll expense (71010). §280E disallows it. This can never be inventory.",
      explanation:
        "Reg. §1.471-3(c) permits indirect production costs into inventory 'but not including any cost of " +
        "selling'. That exclusion applies even to growers, who otherwise get the generous rule. There is no " +
        "version of the law where a budtender's hour is cost of goods sold, and claiming it is the fastest " +
        "way to lose credibility on the parts of your return that ARE defensible.",
      authorityIds: ["REG_1_471_3_C_PRODUCER", "IRC_280E"],
    },
    no: {
      answer: false,
      next: "q2_separate_business",
      explanation: "Not selling. Next question: was it even for the cannabis business?",
      authorityIds: [],
    },
  },
  {
    id: "q2_separate_business",
    question: "Was this time spent on the ATM operation or the Geiger rental property?",
    whyAsked:
      "CHAMP is the one genuinely good rule in §280E law, and it is worth checking before anything else — " +
      "a dollar that belongs to a separate business is fully deductible there.",
    yes: {
      answer: true,
      next: null,
      outcome: "Wages of a separate trade or business. Deductible against THAT business.",
      explanation:
        "CHAMP holds that §280E 'does not preclude petitioner from deducting expenses attributable to a trade " +
        "or business separate and apart from' the cannabis business. Your ATM and rental activities qualify. " +
        "The catch is that the separation must be real: genuine hours, separate books, consistent treatment. " +
        "An examiner will test this before believing it.",
      authorityIds: ["CHAMP_SEPARATE_TRADE", "IRC_6001_SUBSTANTIATION"],
    },
    no: {
      answer: false,
      next: "q3_producer",
      explanation: "Cannabis business time. Next question: does Greenway produce, or resell?",
      authorityIds: [],
    },
  },
  {
    id: "q3_producer",
    question: "Does Greenway grow, extract, or manufacture the product it sells?",
    whyAsked:
      "This single fact decides which inventory paragraph governs, and therefore whether direct labor can be " +
      "capitalised at all. It is the fork the whole question turns on.",
    yes: {
      answer: true,
      next: null,
      outcome: "Producer rules would apply — Reg. §1.471-3(c), which DOES allow direct labor.",
      explanation:
        "A producer capitalises 'expenditures for direct labor' and indirect production costs. Greenway's " +
        "I-502 retail licence does not permit producing, so this branch is shown to make the fork visible, " +
        "not because it is available. If the licence ever changes, this is the branch that opens — and the " +
        "time records this system asks for are exactly what would be needed to use it.",
      authorityIds: ["REG_1_471_3_C_PRODUCER", "REG_1_263A_1_E_2_I_B_LABOR"],
    },
    no: {
      answer: false,
      next: "q4_acquiring_possession",
      explanation:
        "Reseller. Reg. §1.471-3(b) governs, and it has no direct-labor clause. One narrow door remains.",
      authorityIds: ["REG_1_471_3_B_RESELLER", "PATIENTS_MUTUAL_RESELLER", "RICHMOND_PATIENTS"],
    },
  },
  {
    id: "q4_acquiring_possession",
    question:
      "Was this time spent taking delivery of goods — meeting the transporter, counting against the manifest, moving product into the vault?",
    whyAsked:
      "This is the only labor question a reseller can answer 'yes' to and still reach inventory. It is worth " +
      "asking precisely, because a loose 'yes' here is the thing that would not survive examination.",
    yes: { answer: true, next: "q5_evidence", explanation: "Possibly inventoriable. Now: can you prove it?", authorityIds: ["REG_1_471_3_B_RESELLER"] },
    no: {
      answer: false,
      next: null,
      outcome: "Ordinary payroll expense (71010). §280E disallows it.",
      explanation:
        "Storage, counting stock you already own, compliance paperwork, security, management — all real work, " +
        "all disallowed. A producer could argue some of it as indirect production cost; §1.471-3(b) gives a " +
        "reseller no indirect-cost clause at all. Recording it honestly is the correct answer.",
      authorityIds: ["REG_1_471_3_B_RESELLER", "CCA_201504011", "IRC_280E"],
    },
  },
  {
    id: "q5_evidence",
    question:
      "Do contemporaneous time records show these minutes, attributed to the receiving task and tied to specific deliveries?",
    whyAsked:
      "§6001 puts the burden of proof on you. This is the question an examiner asks, so it is better asked " +
      "now, while the answer can still be changed.",
    yes: {
      answer: true,
      next: null,
      outcome: "Inventoriable as acquisition labor (61000), within the plausibility ceiling.",
      explanation:
        "Reg. §1.471-3(b) adds to invoice price 'transportation or other necessary charges incurred in " +
        "acquiring possession of the goods'. Receiving labor is such a charge, it rides the same clause as " +
        "inbound freight, and with contemporaneous records it is a position you can actually defend.",
      authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_6001_SUBSTANTIATION"],
    },
    no: {
      answer: false,
      next: null,
      outcome: "Ordinary payroll expense (71010) until the records exist.",
      explanation:
        "The idea may well be right, but an allocation you cannot document is an allocation you do not have — " +
        "that is precisely what Harborside was told. Cohan allows a court to estimate while bearing 'heavily... " +
        "upon the taxpayer whose inexactitude is of his own making', which is a poor plan. Start recording the " +
        "task today; every line here is tagged rather than merged, so the classification can be revisited " +
        "later without rebuilding anything.",
      authorityIds: ["IRC_6001_SUBSTANTIATION", "COHAN_ESTIMATE_LIMIT", "PATIENTS_MUTUAL_RESELLER"],
    },
  },
] as const;

export function findLaborDecisionNode(id: string): LaborDecisionNode | undefined {
  return LABOR_DECISION_TREE.find((n) => n.id === id);
}

/**
 * Walk the tree with a map of answers. Stops at the first unanswered question so
 * the UI can ask it, rather than guessing.
 */
export function walkLaborDecisionTree(answers: Readonly<Record<string, boolean>>): {
  path: readonly string[];
  outcome: string | null;
  explanation: string | null;
  authorityIds: readonly string[];
  pendingQuestionId: string | null;
} {
  const path: string[] = [];
  let currentId: string | null = "q1_selling";
  const guard = new Set<string>();

  while (currentId) {
    if (guard.has(currentId)) break;
    guard.add(currentId);

    const node = findLaborDecisionNode(currentId);
    if (!node) break;

    const answer = answers[node.id];
    if (answer === undefined) {
      return { path, outcome: null, explanation: null, authorityIds: [], pendingQuestionId: node.id };
    }

    path.push(node.id);
    const branch = answer ? node.yes : node.no;
    if (branch.next === null) {
      return {
        path,
        outcome: branch.outcome ?? null,
        explanation: branch.explanation,
        authorityIds: branch.authorityIds,
        pendingQuestionId: null,
      };
    }
    currentId = branch.next;
  }

  return { path, outcome: null, explanation: null, authorityIds: [], pendingQuestionId: null };
}

// ===========================================================================
// 11) THE PICTURE — where every payroll dollar went.
// ===========================================================================

export type PayrollBar = {
  label: string;
  cents: number;
  /** Integer milli-percent of gross. Sums to exactly 100000 across all bars. */
  milliPct: number;
  tone: "good" | "bad" | "neutral";
  plainEnglish: string;
};

/**
 * Break the run into bars for the UI, with percentages that sum to EXACTLY 100%.
 *
 * Percentages that add to 99.9% make a reader distrust everything else on the
 * page, so the largest-remainder method is used here too.
 */
export function payrollBars(verdict: PayrollVerdict): PayrollBar[] {
  const rows: readonly { label: string; cents: number; tone: "good" | "bad" | "neutral"; plainEnglish: string }[] = [
    {
      label: "Rides into inventory (survives §280E)",
      cents: verdict.acquisitionLaborCents,
      tone: "good",
      plainEnglish:
        "Receiving labor, capitalised under the 'acquiring possession' clause. It becomes cost of goods sold " +
        "when the product sells, and §280E cannot touch it.",
    },
    {
      label: "Separate business (deductible there)",
      cents: verdict.separateBusinessLaborCents,
      tone: "good",
      plainEnglish:
        "Work on the ATM or rental activity. CHAMP keeps this deductible against that business — provided the " +
        "separation is real and documented.",
    },
    {
      label: "Direct production labor",
      cents: verdict.productionLaborCents,
      tone: "neutral",
      plainEnglish:
        "Labor on product the taxpayer produced, capitalised under Reg. §1.471-3(c). Greenway's retail " +
        "licence does not permit producing, so on these books this bar should always read zero — if it " +
        "does not, the run was refused and something needs correcting.",
    },
    {
      label: "Disallowed by §280E",
      cents: verdict.disallowedLaborCents,
      tone: "bad",
      plainEnglish:
        "Wages of the cannabis trade. No deduction, by statute. Not a bookkeeping failure — the honest answer.",
    },
  ];

  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  if (total <= 0) {
    return rows.map((r) => ({ ...r, milliPct: 0 }));
  }

  const pcts = splitCentsByMilliPct(100000, rows.map((r) => r.cents));
  return rows.map((r, i) => ({ ...r, milliPct: pcts[i] ?? 0 }));
}

// ===========================================================================
// 12) SELF-TESTS — the module proves itself, every gate, every time.
// ===========================================================================
/**
 * Michael: "Please test it, break it, fix it to be better, and test the tests."
 *
 * These run in the pure self-test runner AND under vitest. They are written to
 * fail LOUDLY and specifically: a message that names the accounting rule that
 * broke is worth more than a stack trace, because the person reading it in two
 * years may be Michael rather than an engineer.
 */

function ok(cond: boolean, label: string): void {
  if (!cond) throw new Error(`payroll-cogs-core self-test FAILED: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `payroll-cogs-core self-test FAILED: ${label} — expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

/** A clean, fully-substantiated evidence package used as a baseline. */
function __fixtureSubstantiation(): TimeSubstantiation {
  return {
    daysOfRecords: 45,
    contemporaneous: true,
    taskLevelDetail: true,
    tiedToManifests: true,
    documentRef: "ALLOC-2026-11",
    basisNote: "Receiving averaged 38 minutes per delivery across 22 deliveries in October 2026.",
    approvedBy: "Nicholas Mullan, CPA",
  };
}

function __fixtureEmployee(over: Partial<PayrollEmployeeInput> = {}): PayrollEmployeeInput {
  const base: PayrollEmployeeInput = {
    employeeId: "e1",
    employeeName: "Test Employee",
    grossWagesCents: 160000,
    employeeWithholdingCents: 32000,
    employerTaxCents: 12240,
    netPayCents: 128000,
    allocations: [{ roleCode: "budtender", shareMilliPct: 100000 }],
  };
  return { ...base, ...over };
}

function __fixtureRun(over: Partial<PayrollRunInput> = {}): PayrollRunInput {
  const base: PayrollRunInput = {
    entityCode: "greenway",
    payDate: "2026-11-13",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
    employees: [__fixtureEmployee()],
    activityCodes: ["receive_manifest", "display_sell"],
    substantiation: null,
  };
  return { ...base, ...over };
}

export function __runPayrollCogsCoreTests(): void {
  // ── AUTHORITIES: the verbatim text is the product ───────────────────────
  ok(PAYROLL_AUTHORITIES.length >= 20, "the authority library is populated");
  {
    const ids = new Set<string>();
    for (const a of PAYROLL_AUTHORITIES) {
      ok(!ids.has(a.id), `authority id ${a.id} is unique`);
      ids.add(a.id);
      ok(a.cite.trim().length > 0, `${a.id} has a citation`);
      ok(a.quote.trim().length > 20, `${a.id} has substantive quoted text`);
      ok(a.soWhat.trim().length > 20, `${a.id} explains why it matters`);
      ok(a.source.trim().length > 0, `${a.id} says where to read it`);
    }
  }

  // The two paragraphs this entire slice turns on. If an edit ever paraphrases
  // either one, the legal basis for the feature evaporates — so assert the
  // exact words, not the gist.
  {
    const reseller = findPayrollAuthority("REG_1_471_3_B_RESELLER");
    ok(!!reseller, "the reseller inventory rule is present");
    ok(
      reseller!.quote.includes("transportation or other necessary charges incurred in acquiring possession of the goods"),
      "1.471-3(b) keeps the possession clause verbatim — the ONLY door to capitalising labor",
    );
    ok(
      !reseller!.quote.includes("direct labor"),
      "1.471-3(b) contains NO direct-labor clause — that absence IS the legal finding",
    );
  }
  {
    const producer = findPayrollAuthority("REG_1_471_3_C_PRODUCER");
    ok(!!producer, "the producer inventory rule is present");
    ok(producer!.quote.includes("direct labor"), "1.471-3(c) does allow direct labor");
    ok(
      producer!.quote.includes("but not including any cost of selling"),
      "1.471-3(c) excludes selling cost even for a producer — why budtenders can never be COGS",
    );
  }
  {
    const resellerA = findPayrollAuthority("REG_1_263A_1_E_2_II_RESELLER");
    ok(!!resellerA, "the §263A reseller rule is present");
    ok(
      resellerA!.quote.includes("Resellers must capitalize the acquisition costs of property acquired for resale"),
      "1.263A-1(e)(2)(ii) sends resellers straight back to 1.471-3(b)",
    );
  }
  {
    const trust = findPayrollAuthority("IRC_7501_TRUST");
    ok(!!trust, "the trust-fund statute is present");
    ok(
      trust!.quote.includes("special fund in trust for the United States"),
      "§7501 keeps the 'special fund in trust' language verbatim",
    );
  }

  // Unknown ids must be VISIBLE, never silently dropped. A citation list that
  // quietly shrinks is how a document loses its support unnoticed.
  {
    const rendered = citePayrollAuthorities(["IRC_280E", "NOT_A_REAL_AUTHORITY"]);
    ok(rendered.includes("[unknown authority: NOT_A_REAL_AUTHORITY]"), "unknown authority ids render visibly");
    eq(citePayrollAuthorities([]), "", "an empty citation list renders empty");
  }

  // Every authority id referenced anywhere must actually exist. This catches a
  // typo in a citation, which otherwise only surfaces when a reader goes
  // looking for the source and cannot find it.
  {
    const known = new Set(PAYROLL_AUTHORITIES.map((a) => a.id));
    const check = (ids: readonly string[], where: string) => {
      for (const id of ids) ok(known.has(id), `${where} cites a real authority (${id})`);
    };
    for (const r of LABOR_ROLES) check(r.authorityIds, `role ${r.code}`);
    for (const a of PRODUCTION_ACTIVITIES) check(a.authorityIds, `activity ${a.code}`);
    for (const n of LABOR_DECISION_TREE) {
      check(n.yes.authorityIds, `tree ${n.id} yes`);
      check(n.no.authorityIds, `tree ${n.id} no`);
    }
    check(determineCharacter([]).authorityIds, "reseller determination");
    check(determineCharacter(["cultivate"]).authorityIds, "producer determination");
    const gapSub: TimeSubstantiation = {
      daysOfRecords: 0, contemporaneous: false, taskLevelDetail: false,
      tiedToManifests: false, documentRef: null, basisNote: null, approvedBy: null,
    };
    for (const g of substantiationGaps(gapSub)) check(g.authorityIds, `gap ${g.code}`);
  }

  // ── CHARACTER: reseller vs producer, derived from activities ────────────
  {
    const d = determineCharacter(["receive_manifest", "inspect", "repackage", "trim_dry", "store_maintain"]);
    eq(d.character, "reseller", "trimming and drying does NOT make you a producer (Richmond Patients Group)");
    eq(d.governingRule, "REG_1_471_3_B_RESELLER", "the reseller paragraph governs");
    eq(d.directLaborCapitalisable, false, "a reseller cannot capitalise direct labor");
  }
  {
    const d = determineCharacter(["receive_manifest", "cultivate"]);
    eq(d.character, "producer", "cultivating DOES make you a producer");
    eq(d.directLaborCapitalisable, true, "a producer can capitalise direct labor");
  }
  {
    const d = determineCharacter(["receive_manifest", "teleportation"]);
    eq(d.unknownActivities.length, 1, "an unrecognised activity is reported, never ignored");
    eq(d.unknownActivities[0], "teleportation", "and it is named");
  }
  eq(determineCharacter([]).character, "reseller", "no activities defaults to the SAFE answer, not the useful one");

  // ── ROLES ───────────────────────────────────────────────────────────────
  {
    const codes = new Set<string>();
    for (const r of LABOR_ROLES) {
      ok(!codes.has(r.code), `role code ${r.code} is unique`);
      codes.add(r.code);
      ok(r.plainEnglish.trim().length > 40, `${r.code} explains itself in plain English`);
      ok(r.authorityIds.length > 0, `${r.code} carries authority`);
      // THE STRUCTURAL INVARIANT: a role that can never be inventoried must
      // never point at the COGS account. This is the guarantee behind the
      // promise that selling labor cannot reach inventory.
      if (r.neverInventoriable) {
        ok(
          r.accountCode !== PAYROLL_COGS_ACCOUNT,
          `${r.code} is never-inventoriable so it must NOT post to ${PAYROLL_COGS_ACCOUNT}`,
        );
      }
      if (r.treatment === "selling") {
        ok(r.neverInventoriable, `selling role ${r.code} must be flagged never-inventoriable`);
      }
      // Cost class must agree with where the money lands.
      if (r.accountCode === PAYROLL_COGS_ACCOUNT) {
        eq(r.costClass, "cogs_allocable", `${r.code} posts to COGS so it must be cogs_allocable, never cogs_direct`);
      }
    }
  }
  ok(neverInventoriableRoleCodes().includes("budtender"), "budtenders can never be inventoried");
  ok(neverInventoriableRoleCodes().includes("marketing"), "marketing can never be inventoried");
  ok(acquisitionRoleCodes().includes("receiving"), "receiving is the acquisition role");
  ok(!acquisitionRoleCodes().includes("budtender"), "budtending is NOT an acquisition role");
  eq(findLaborRole("nope"), undefined, "an unknown role code returns undefined");

  // ── MONEY HELPERS ───────────────────────────────────────────────────────
  eq(formatCents(0), "$0.00", "zero formats");
  eq(formatCents(5), "$0.05", "nickels format");
  eq(formatCents(160000), "$1,600.00", "thousands get a separator");
  eq(formatCents(-2550), "-$25.50", "negatives keep the sign outside the dollar mark");
  eq(formatMilliPct(100000), "100%", "whole percentages have no decimal point");
  eq(formatMilliPct(12500), "12.5%", "fractional percentages render");
  eq(formatMilliPct(0), "0%", "zero percent renders");
  // The -0 trap: Math.trunc(-500/1000) is -0, which stringifies as "0".
  eq(formatMilliPct(-500), "-0.5%", "a negative fraction of a percent KEEPS its minus sign");

  ok(isValidIsoDate("2026-11-13"), "a real date is valid");
  ok(!isValidIsoDate("2026-02-30"), "February 30th is rejected");
  ok(!isValidIsoDate("2026-13-01"), "month 13 is rejected");
  ok(!isValidIsoDate("2026-00-10"), "month 0 is rejected");
  ok(!isValidIsoDate("11/13/2026"), "US-format dates are rejected");
  ok(!isValidIsoDate(""), "the empty string is rejected");
  ok(isValidIsoDate("2024-02-29"), "2024 is a leap year");
  ok(!isValidIsoDate("2100-02-29"), "2100 is NOT a leap year (the century rule)");
  ok(isValidIsoDate("2000-02-29"), "2000 IS a leap year (the 400-year rule)");
  // The two-digit-year trap: Date.UTC(26, ...) means 1926, not 2026.
  ok(isValidIsoDate("0026-02-28"), "a four-digit year below 100 is handled arithmetically");

  // ── THE SPLIT: integer-exact, always ─────────────────────────────────────
  {
    eq(splitCentsByMilliPct(100, []).length, 0, "an empty split returns nothing");
    const even = splitCentsByMilliPct(100, [50000, 50000]);
    eq(even[0] + even[1], 100, "an even split is exact");
    // 100 / 3 is the classic penny-loss case.
    const thirds = splitCentsByMilliPct(100, [33333, 33333, 33334]);
    eq(thirds.reduce((a, b) => a + b, 0), 100, "thirds still sum to exactly 100 cents");
    const zero = splitCentsByMilliPct(1000, [0, 0]);
    eq(zero[0] + zero[1], 0, "a zero-share split yields zeroes rather than dividing by zero");
    eq(splitCentsByMilliPct(0, [50000, 50000]).reduce((a, b) => a + b, 0), 0, "splitting zero yields zero");
    // Determinism: the same input must always give the same split.
    const a1 = splitCentsByMilliPct(10, [33333, 33333, 33334]);
    const a2 = splitCentsByMilliPct(10, [33333, 33333, 33334]);
    eq(a1.join(","), a2.join(","), "the split is deterministic — same input, same answer, forever");
    // NaN must not scramble the comparator.
    const withNaN = splitCentsByMilliPct(100, [Number.NaN, 100000]);
    eq(withNaN.reduce((a, b) => a + b, 0), 100, "a NaN share cannot break the sum");
    eq(withNaN[0], 0, "a NaN share receives nothing");
    // Exhaustive: every total from 0..300 across three uneven shares is exact.
    for (let total = 0; total <= 300; total += 1) {
      const parts = splitCentsByMilliPct(total, [16667, 33333, 50000]);
      eq(parts.reduce((a, b) => a + b, 0), total, `split of ${total} cents is penny-exact`);
      for (const p of parts) ok(Number.isInteger(p), `every part of ${total} is a whole cent`);
    }
  }

  // ── SUBSTANTIATION ──────────────────────────────────────────────────────
  {
    eq(substantiationGaps(__fixtureSubstantiation()).length, 0, "complete evidence yields NO gaps (empty means go)");

    const none = substantiationGaps({
      daysOfRecords: 0, contemporaneous: false, taskLevelDetail: false,
      tiedToManifests: false, documentRef: null, basisNote: null, approvedBy: null,
    });
    eq(none.length, 6, "no evidence yields all six gaps");
    for (const g of none) {
      ok(g.requirement.trim().length > 10, `${g.code} states its requirement`);
      ok(g.whyItMatters.trim().length > 20, `${g.code} explains why it matters`);
      ok(g.howToFix.trim().length > 20, `${g.code} says how to fix it — never just 'no'`);
    }
    // Each gap must be independently reachable.
    const shortWindow = substantiationGaps({ ...__fixtureSubstantiation(), daysOfRecords: 5 });
    eq(shortWindow.length, 1, "too few days is caught on its own");
    eq(shortWindow[0].code, "SUB_TOO_FEW_DAYS", "and named correctly");
    eq(
      substantiationGaps({ ...__fixtureSubstantiation(), documentRef: "  " })[0].code,
      "SUB_NO_STUDY_DOCUMENT",
      "a whitespace-only document reference is not a document reference",
    );
    eq(
      substantiationGaps({ ...__fixtureSubstantiation(), basisNote: "x" })[0].code,
      "SUB_NO_BASIS_NOTE",
      "a one-character basis note is not an explanation",
    );
    eq(
      substantiationGaps({ ...__fixtureSubstantiation(), daysOfRecords: MIN_SUBSTANTIATION_DAYS }).length,
      0,
      "exactly the minimum number of days is enough (the boundary is inclusive)",
    );
    eq(
      substantiationGaps({ ...__fixtureSubstantiation(), daysOfRecords: MIN_SUBSTANTIATION_DAYS - 1 }).length,
      1,
      "one day short is not enough",
    );
    eq(
      substantiationGaps({ ...__fixtureSubstantiation(), daysOfRecords: Number.NaN })[0].code,
      "SUB_TOO_FEW_DAYS",
      "NaN days is treated as insufficient, not as passing",
    );
  }

  // ── THE ENGINE: structural refusals ─────────────────────────────────────
  {
    const v = evaluatePayrollRun(__fixtureRun({ employees: [] }));
    eq(v.postable, false, "an empty run is refused");
    ok(v.findings.some((f) => f.code === "PAY_NO_EMPLOYEES"), "and says why");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({ payDate: "2026-02-30" }));
    eq(v.postable, false, "an impossible pay date is refused");
    ok(v.findings.some((f) => f.code === "PAY_BAD_DATE"), "and names the bad date");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({ periodStart: "2026-11-15", periodEnd: "2026-11-01" }));
    eq(v.postable, false, "a backwards period is refused");
    ok(v.findings.some((f) => f.code === "PAY_PERIOD_BACKWARDS"), "and says so");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun(), { periodClosed: true });
    eq(v.postable, false, "a closed period is refused");
    ok(v.findings.some((f) => f.code === "PAY_PERIOD_CLOSED"), "and explains the promise a close makes");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({ employees: [__fixtureEmployee({ netPayCents: 999 })] }));
    eq(v.postable, false, "a run whose net pay does not tie is refused");
    const f = v.findings.find((x) => x.code === "PAY_NET_MISMATCH");
    ok(!!f, "and names the mismatch");
    ok(!!f!.workedExample && f!.workedExample.length > 0, "with a worked example, because Michael learns visually");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({ employees: [__fixtureEmployee({ grossWagesCents: -100 })] }));
    eq(v.postable, false, "negative gross wages are refused");
    ok(v.findings.some((f) => f.code === "PAY_NEGATIVE_AMOUNT"), "and named");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({ employees: [__fixtureEmployee({ grossWagesCents: 1600.5 })] }));
    eq(v.postable, false, "a fractional cent is refused — floats never touch money here");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({
      employees: [__fixtureEmployee({ allocations: [{ roleCode: "budtender", shareMilliPct: 90000 }] })],
    }));
    eq(v.postable, false, "a time split that does not reach 100% is refused");
    ok(v.findings.some((f) => f.code === "PAY_ALLOCATION_NOT_100"), "and says which employee");
  }
  {
    const v = evaluatePayrollRun(__fixtureRun({
      employees: [__fixtureEmployee({ allocations: [{ roleCode: "wizard", shareMilliPct: 100000 }] })],
    }));
    eq(v.postable, false, "an unknown role is refused");
    const f = v.findings.find((x) => x.code === "PAY_UNKNOWN_ROLE");
    ok(!!f && f.fix.includes("budtender"), "and lists the roles that ARE valid");
  }

  // ── THE ENGINE: the §280E teaching, which is the point of the slice ──────
  {
    // The ordinary, honest case: everyone on the floor, nothing capitalised.
    const v = evaluatePayrollRun(__fixtureRun());
    eq(v.postable, true, "an ordinary all-selling payroll run POSTS — the system is not obstructive");
    eq(v.acquisitionLaborCents, 0, "nothing rides into inventory");
    eq(v.disallowedLaborCents, 160000, "and the whole wage is honestly disallowed");
    ok(v.findings.some((f) => f.code === "PAY_280E_DISALLOWANCE_EXPLAINED"), "the hard truth is said out loud");
    ok(v.findings.some((f) => f.code === "PAY_TRUST_FUND_REMINDER"), "and the trust-fund warning is given");
  }
  {
    // The narrow door, fully proved: 10% receiving with complete evidence.
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    }));
    eq(v.postable, true, "PROVED receiving labor is allowed through — the door is real");
    eq(v.acquisitionLaborCents, 16000, "10% of $1,600 rides into inventory");
    eq(v.disallowedLaborCents, 144000, "and the rest is disallowed");
    eq(v.acquisitionLaborCents + v.disallowedLaborCents, v.totalGrossCents, "the buckets reconcile to gross");
    ok(v.needsAcknowledgement, "but it must be acknowledged, not slipped through");
    ok(v.findings.some((f) => f.code === "PAY_ACQUISITION_LABOR_CLAIMED"), "and the claim is stated");
  }
  {
    // The same claim WITHOUT evidence. This is the Harborside fact pattern.
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: null,
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    }));
    eq(v.postable, false, "UNPROVED receiving labor is refused — evidence is the price of the door");
    ok(v.findings.some((f) => f.code === "PAY_ACQUISITION_UNSUBSTANTIATED"), "and the missing evidence is itemised");
  }
  {
    // The ceiling. 30% receiving is not credible for a retail store.
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 30000 },
          { roleCode: "budtender", shareMilliPct: 70000 },
        ],
      })],
    }));
    eq(v.postable, false, "an implausible allocation is refused even WITH paperwork");
    ok(v.findings.some((f) => f.code === "PAY_ACQUISITION_OVER_CEILING"), "the plausibility ceiling holds");
  }
  {
    // The ceiling is weighted by DOLLARS, not headcount. One tiny cheque at
    // 100% receiving must not blow up an otherwise modest run.
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [
        __fixtureEmployee({
          employeeId: "tiny", employeeName: "Part-timer",
          grossWagesCents: 10000, employeeWithholdingCents: 2000, netPayCents: 8000, employerTaxCents: 765,
          allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }],
        }),
        __fixtureEmployee({ employeeId: "a", employeeName: "Floor A" }),
        __fixtureEmployee({ employeeId: "b", employeeName: "Floor B" }),
        __fixtureEmployee({ employeeId: "c", employeeName: "Floor C" }),
      ],
    }));
    // $100 of $4,900 is ~2%, comfortably under both thresholds.
    eq(v.postable, true, "the ceiling is measured on MONEY, so one small receiving cheque does not block a run");
    eq(v.acquisitionLaborCents, 10000, "and only that cheque is capitalised");
  }
  {
    // Boundary: exactly at the ceiling must BLOCK (the threshold is inclusive).
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: ACQUISITION_LABOR_CEILING_MILLI_PCT },
          { roleCode: "budtender", shareMilliPct: 100000 - ACQUISITION_LABOR_CEILING_MILLI_PCT },
        ],
      })],
    }));
    eq(v.postable, false, "exactly at the ceiling is refused — the boundary is inclusive");
  }
  {
    // Production labor claimed on a RETAIL licence, with honest activities.
    const v = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }],
      })],
    }));
    eq(v.postable, false, "a reseller claiming production labor is refused");
    ok(v.findings.some((f) => f.code === "PAY_PRODUCER_CLAIM_BY_RESELLER"), "with the Richmond citation");
    eq(v.productionLaborCents, 160000, "and the amount at stake is reported, not hidden");
  }
  {
    // THE BYPASS ATTEMPT: claim cultivation activities to become a "producer",
    // then capitalise production labor on a retail licensee's books.
    const v = evaluatePayrollRun(__fixtureRun({
      activityCodes: ["cultivate"],
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }],
      })],
    }));
    eq(v.character.character, "producer", "the self-reported activities do say 'producer'");
    eq(v.postable, false, "but the RETAIL LICENCE still refuses it — a self-reported field is not a licence");
    ok(
      v.findings.some((f) => f.code === "PAY_PRODUCTION_LABOR_RETAIL_LICENCE"),
      "the licence-level block is what closes the bypass",
    );
  }
  {
    // Cannabis acquisition labor pointed at the wrong entity's books.
    const v = evaluatePayrollRun(__fixtureRun({
      entityCode: "atm",
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    }));
    eq(v.postable, false, "cannabis acquisition labor cannot be posted to the ATM books");
    ok(v.findings.some((f) => f.code === "PAY_CANNABIS_LABOR_WRONG_ENTITY"), "because CHAMP separation is worth more");
  }
  {
    // CHAMP: genuinely separate business work is preserved as deductible.
    const v = evaluatePayrollRun(__fixtureRun({
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "atm_operation", shareMilliPct: 50000 },
          { roleCode: "budtender", shareMilliPct: 50000 },
        ],
      })],
    }));
    eq(v.postable, true, "split work between the ATM and the store posts");
    eq(v.separateBusinessLaborCents, 80000, "and half is preserved as separate-business labor");
    eq(v.disallowedLaborCents, 80000, "while the cannabis half is disallowed");
  }
  {
    // The employee-loan case Michael asked about by name.
    const v = evaluatePayrollRun(__fixtureRun({
      employees: [__fixtureEmployee({ advanceRepaymentCents: 10000, netPayCents: 118000 })],
    }));
    eq(v.postable, true, "repaying an advance does not block payroll — it is advice, not a refusal");
    const f = v.findings.find((x) => x.code === "PAY_ADVANCE_REPAYMENT");
    ok(!!f, "the advance is noticed");
    eq(f!.severity, "advise", "and treated as guidance");
    ok(f!.workedExample!.join(" ").includes("12100"), "with both halves of the entry shown");
  }
  {
    // Minimum wage: pushes back, does not refuse.
    const v = evaluatePayrollRun(
      __fixtureRun({ employees: [__fixtureEmployee({ hoursWorked: 100 })] }),
      { minimumWageCentsPerHour: 2000 },
    );
    // $1,600 / 100h = $16.00/h, below a $20.00 floor.
    ok(v.findings.some((f) => f.code === "PAY_BELOW_MINIMUM_WAGE"), "an underpayment is flagged");
    eq(v.postable, true, "but it is a confirm, not a block — Michael can still record what happened");
  }
  {
    const v = evaluatePayrollRun(
      __fixtureRun({ employees: [__fixtureEmployee({ hoursWorked: 40 })] }),
      { minimumWageCentsPerHour: 2000 },
    );
    // $1,600 / 40h = $40.00/h, comfortably above.
    ok(!v.findings.some((f) => f.code === "PAY_BELOW_MINIMUM_WAGE"), "a fair wage raises nothing");
  }
  {
    // No wage floor supplied = cannot check. It must not guess.
    const v = evaluatePayrollRun(__fixtureRun({ employees: [__fixtureEmployee({ hoursWorked: 1000 })] }));
    ok(!v.findings.some((f) => f.code === "PAY_BELOW_MINIMUM_WAGE"), "with no rate supplied the check is skipped, never guessed");
  }

  // ── EVERY BLOCK CODE IS DECLARED, AND EVERY FINDING TEACHES ─────────────
  {
    // Nothing may refuse a payroll run unless it is on the frozen list. This is
    // the promise that the system teaches rather than obstructs.
    const scenarios: PayrollRunInput[] = [
      __fixtureRun(),
      __fixtureRun({ employees: [] }),
      __fixtureRun({ payDate: "bad" }),
      __fixtureRun({ periodStart: "2026-11-15", periodEnd: "2026-11-01" }),
      __fixtureRun({ employees: [__fixtureEmployee({ netPayCents: 1 })] }),
      __fixtureRun({ employees: [__fixtureEmployee({ grossWagesCents: -5 })] }),
      __fixtureRun({ employees: [__fixtureEmployee({ allocations: [] })] }),
      __fixtureRun({ employees: [__fixtureEmployee({ allocations: [{ roleCode: "zzz", shareMilliPct: 100000 }] })] }),
      __fixtureRun({
        substantiation: __fixtureSubstantiation(),
        employees: [__fixtureEmployee({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })],
      }),
      __fixtureRun({
        employees: [__fixtureEmployee({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })],
      }),
      __fixtureRun({
        activityCodes: ["cultivate"],
        substantiation: __fixtureSubstantiation(),
        employees: [__fixtureEmployee({ allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }] })],
      }),
      __fixtureRun({
        substantiation: __fixtureSubstantiation(),
        employees: [__fixtureEmployee({ allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }] })],
      }),
      __fixtureRun({
        entityCode: "atm",
        substantiation: __fixtureSubstantiation(),
        employees: [__fixtureEmployee({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })],
      }),
    ];
    const seen = new Set<string>();
    for (const s of scenarios) {
      for (const ctx of [{}, { periodClosed: true }]) {
        const v = evaluatePayrollRun(s, ctx);
        for (const f of v.findings) {
          ok(f.concern.trim().length > 0, `${f.code} states a concern`);
          ok(f.why.trim().length > 20, `${f.code} explains WHY — never a bare refusal`);
          ok(f.fix.trim().length > 10, `${f.code} offers a way forward`);
          if (f.severity === "block") {
            ok(PAYROLL_HARD_BLOCKS.includes(f.code), `block code ${f.code} is on the frozen hard-block list`);
            seen.add(f.code);
          }
        }
        // The postable flag must always agree with the findings.
        eq(v.postable, !v.findings.some((f) => f.severity === "block"), "postable always agrees with the findings");
        eq(
          v.needsAcknowledgement,
          v.findings.some((f) => f.severity === "confirm"),
          "needsAcknowledgement always agrees with the findings",
        );
      }
    }
    ok(seen.size >= 11, `the scenarios exercise most of the hard-block list (saw ${seen.size})`);
    // Every hard-block code that is reachable must be spelled correctly: the
    // frozen list is only a promise if the codes on it actually appear.
    for (const code of ["PAY_NO_EMPLOYEES", "PAY_BAD_DATE", "PAY_PERIOD_BACKWARDS", "PAY_NET_MISMATCH",
      "PAY_NEGATIVE_AMOUNT", "PAY_ALLOCATION_NOT_100", "PAY_UNKNOWN_ROLE", "PAY_PERIOD_CLOSED",
      "PAY_ACQUISITION_UNSUBSTANTIATED", "PAY_ACQUISITION_OVER_CEILING", "PAY_PRODUCER_CLAIM_BY_RESELLER",
      "PAY_PRODUCTION_LABOR_RETAIL_LICENCE", "PAY_CANNABIS_LABOR_WRONG_ENTITY"]) {
      ok(PAYROLL_HARD_BLOCKS.includes(code), `${code} is declared on the frozen list`);
    }
  }

  // ── THE JOURNAL ─────────────────────────────────────────────────────────
  {
    const run = __fixtureRun();
    const v = evaluatePayrollRun(run);
    const j = buildPayrollJournal(run, v);
    ok(!!j, "a clean run builds a journal");
    ok(payrollJournalIsBalanced(j!), "THE JOURNAL BALANCES — debits equal credits");
    eq(j!.sourceKind, "payroll", "it is tagged as payroll");
    eq(j!.journalDate, run.payDate, "and dated on the pay date");
    // Wages must NOT land in COGS for an all-selling run.
    ok(!j!.lines.some((l) => l.accountCode === PAYROLL_COGS_ACCOUNT), "no selling wage reaches account 61000");
    ok(j!.lines.some((l) => l.accountCode === WAGE_EXPENSE_ACCOUNT && l.amountCents > 0), "wages are debited to 71010");
    ok(j!.lines.some((l) => l.accountCode === WITHHELD_TAX_ACCOUNT && l.amountCents < 0), "withheld tax is a credit (a liability)");
    ok(j!.lines.some((l) => l.accountCode === ACCRUED_PAYROLL_ACCOUNT && l.amountCents < 0), "net pay is owed to staff");
  }
  {
    // A refused run must NEVER produce a journal.
    const run = __fixtureRun({ employees: [] });
    eq(buildPayrollJournal(run, evaluatePayrollRun(run)), null, "a refused run cannot become a journal");
  }
  {
    // The proved acquisition case posts to 61000 with the right cost class.
    const run = __fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    });
    const v = evaluatePayrollRun(run);
    const j = buildPayrollJournal(run, v)!;
    ok(payrollJournalIsBalanced(j), "the acquisition journal balances");
    const cogs = j.lines.find((l) => l.accountCode === PAYROLL_COGS_ACCOUNT);
    ok(!!cogs, "receiving labor reaches 61000");
    eq(cogs!.amountCents, 16000, "at exactly the evaluated amount");
    eq(cogs!.costClass, "cogs_allocable", "tagged allocable, never cogs_direct");
    // THE CONSISTENCY INVARIANT: what the verdict says must equal what posts.
    eq(cogs!.amountCents, v.acquisitionLaborCents, "the journal agrees with the report shown to Michael");
  }
  {
    // Cost classes on every line must be legitimate for the account.
    const run = __fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        garnishmentCents: 5000, advanceRepaymentCents: 10000, netPayCents: 113000,
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "atm_operation", shareMilliPct: 20000 },
          { roleCode: "budtender", shareMilliPct: 70000 },
        ],
      })],
    });
    const v = evaluatePayrollRun(run);
    const j = buildPayrollJournal(run, v)!;
    ok(payrollJournalIsBalanced(j), "a journal with garnishment and an advance still balances");
    ok(j.lines.some((l) => l.accountCode === GARNISHMENT_ACCOUNT && l.amountCents === -5000), "garnishment is held for the court");
    ok(j.lines.some((l) => l.accountCode === EMPLOYEE_ADVANCE_ACCOUNT && l.amountCents === -10000), "the advance repayment reduces the receivable");
    // Balance-sheet lines carry no §280E character.
    for (const l of j.lines) {
      if ([WITHHELD_TAX_ACCOUNT, EMPLOYER_TAX_PAYABLE_ACCOUNT, GARNISHMENT_ACCOUNT,
        EMPLOYEE_ADVANCE_ACCOUNT, ACCRUED_PAYROLL_ACCOUNT].includes(l.accountCode)) {
        eq(l.costClass, "none", `${l.accountCode} is a balance-sheet line and carries no 280E class`);
      }
      ok(Number.isInteger(l.amountCents), `${l.accountCode} posts a whole number of cents`);
      ok(l.description.trim().length > 0, `${l.accountCode} explains itself`);
      ok(l.amountCents !== 0, `${l.accountCode} does not post a zero line`);
    }
  }
  {
    // Idempotency: the same run always yields the same reference.
    const run = __fixtureRun();
    eq(payrollSourceRef(run), payrollSourceRef(run), "the source reference is stable");
    eq(payrollSourceRef(run), "payroll:greenway:2026-11-01:2026-11-15:2026-11-13", "and has the documented shape");
    ok(payrollSourceRef(run) !== payrollSourceRef(__fixtureRun({ payDate: "2026-11-27" })),
      "a different pay date is a different run");
  }
  {
    // The content fingerprint catches a CORRECTION hiding behind the same key.
    const run = __fixtureRun();
    const corrected = __fixtureRun({
      employees: [__fixtureEmployee({ grossWagesCents: 170000, employeeWithholdingCents: 34000, netPayCents: 136000 })],
    });
    eq(payrollSourceRef(run), payrollSourceRef(corrected), "same period and pay date share a reference");
    ok(
      payrollContentFingerprint(run) !== payrollContentFingerprint(corrected),
      "but the fingerprint differs, so a silently-swallowed correction can be detected",
    );
    eq(payrollContentFingerprint(run), payrollContentFingerprint(__fixtureRun()), "the fingerprint is deterministic");
    // Re-ordering the same employees is NOT a change.
    const e1 = __fixtureEmployee({ employeeId: "a", employeeName: "A" });
    const e2 = __fixtureEmployee({ employeeId: "b", employeeName: "B" });
    eq(
      payrollContentFingerprint(__fixtureRun({ employees: [e1, e2] })),
      payrollContentFingerprint(__fixtureRun({ employees: [e2, e1] })),
      "re-ordering the same people is not a different payroll run",
    );
    ok(/^[0-9a-f]{8}$/.test(payrollContentFingerprint(run)), "the fingerprint is eight hex characters");
  }
  {
    // The payment journal is SEPARATE, to protect the accrual basis.
    const run = __fixtureRun();
    const p = buildPayrollPaymentJournal(run, "2026-11-20")!;
    ok(!!p, "the payment journal builds");
    ok(payrollJournalIsBalanced(p), "and balances");
    eq(p.lines.length, 2, "it is a simple two-line cash entry");
    eq(p.journalDate, "2026-11-20", "dated when the cash actually moved, not when it was earned");
    ok(p.lines.some((l) => l.accountCode === OPERATING_BANK_ACCOUNT && l.amountCents < 0), "the bank is credited");
    ok(p.lines.some((l) => l.accountCode === ACCRUED_PAYROLL_ACCOUNT && l.amountCents > 0), "and the accrual is cleared");
    ok(p.sourceRef !== payrollSourceRef(run), "the payment has its own reference so it cannot collide with the accrual");
    eq(buildPayrollPaymentJournal(run, "not-a-date"), null, "a bad payment date builds nothing");
    eq(buildPayrollPaymentJournal(__fixtureRun({ employees: [] }), "2026-11-20"), null, "nothing to pay builds nothing");
  }

  // ── FUZZ: no input may ever produce an unbalanced journal ────────────────
  {
    let seed = 20261117;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const roleCodes = LABOR_ROLES.map((r) => r.code);
    let built = 0;

    for (let i = 0; i < 800; i += 1) {
      const count = 1 + Math.floor(rnd() * 3);
      const employees: PayrollEmployeeInput[] = [];
      for (let e = 0; e < count; e += 1) {
        const gross = Math.floor(rnd() * 500000);
        const withheld = Math.floor(gross * (rnd() * 0.4));
        const garnish = rnd() > 0.8 ? Math.floor(rnd() * 5000) : 0;
        const advance = rnd() > 0.8 ? Math.floor(rnd() * 5000) : 0;
        // Random allocation across 1..3 roles, normalised to exactly 100000.
        const n = 1 + Math.floor(rnd() * 3);
        const raw: number[] = [];
        for (let k = 0; k < n; k += 1) raw.push(1 + Math.floor(rnd() * 1000));
        const norm = splitCentsByMilliPct(100000, raw);
        const allocations = norm
          .map((share) => ({
            roleCode: roleCodes[Math.floor(rnd() * roleCodes.length)] ?? "budtender",
            shareMilliPct: share,
          }))
          .filter((a) => a.shareMilliPct > 0);
        const total = allocations.reduce((s, a) => s + a.shareMilliPct, 0);
        if (allocations.length > 0 && total !== 100000) {
          allocations[0] = { ...allocations[0], shareMilliPct: allocations[0].shareMilliPct + (100000 - total) };
        }
        employees.push({
          employeeId: `f${i}-${e}`,
          employeeName: `Fuzz ${i}-${e}`,
          grossWagesCents: gross,
          employeeWithholdingCents: withheld,
          employerTaxCents: Math.floor(gross * 0.0765),
          garnishmentCents: garnish,
          advanceRepaymentCents: advance,
          netPayCents: gross - withheld - garnish - advance,
          allocations,
        });
      }

      const run: PayrollRunInput = {
        entityCode: "greenway",
        payDate: "2026-11-13",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-15",
        employees,
        activityCodes: ["receive_manifest", "display_sell"],
        substantiation: rnd() > 0.5 ? __fixtureSubstantiation() : null,
      };

      const v = evaluatePayrollRun(run);

      // INVARIANT 1: the buckets always reconcile to gross, exactly.
      eq(
        v.acquisitionLaborCents + v.disallowedLaborCents + v.separateBusinessLaborCents + v.productionLaborCents,
        v.totalGrossCents,
        `fuzz ${i}: every wage dollar is classified exactly once`,
      );

      // INVARIANT 2: any journal that gets built, balances.
      const j = buildPayrollJournal(run, v);
      if (j) {
        built += 1;
        ok(payrollJournalIsBalanced(j), `fuzz ${i}: journal balances`);
        for (const l of j.lines) ok(Number.isInteger(l.amountCents), `fuzz ${i}: whole cents only`);
        // INVARIANT 3: the ledger must agree with the report.
        const cogs = j.lines
          .filter((l) => l.accountCode === PAYROLL_COGS_ACCOUNT)
          .reduce((s, l) => s + l.amountCents, 0);
        eq(cogs, v.acquisitionLaborCents + v.productionLaborCents,
          `fuzz ${i}: what posts to COGS equals what the report says`);
      }

      // INVARIANT 4: the picture always sums to exactly 100%.
      const bars = payrollBars(v);
      const pct = bars.reduce((s, b) => s + b.milliPct, 0);
      ok(pct === 100000 || pct === 0, `fuzz ${i}: the bars sum to exactly 100% (or 0% for an empty run)`);
      eq(bars.reduce((s, b) => s + b.cents, 0), v.totalGrossCents, `fuzz ${i}: the bars account for every dollar`);
    }
    ok(built > 50, `the fuzz run actually built a meaningful number of journals (built ${built})`);
  }

  // ── THE DECISION TREE ───────────────────────────────────────────────────
  {
    const ids = new Set<string>();
    for (const n of LABOR_DECISION_TREE) {
      ok(!ids.has(n.id), `tree node ${n.id} is unique`);
      ids.add(n.id);
      ok(n.question.trim().length > 10, `${n.id} asks a real question`);
      ok(n.whyAsked.trim().length > 20, `${n.id} explains why it is asked`);
      for (const b of [n.yes, n.no]) {
        ok(b.explanation.trim().length > 20, `${n.id} explains its branch`);
        if (b.next === null) ok(!!b.outcome, `${n.id} terminal branch states an outcome`);
        else ok(!!findLaborDecisionNode(b.next), `${n.id} points at a real next question (${b.next})`);
      }
    }
  }
  {
    // Selling is asked first and is final.
    const r = walkLaborDecisionTree({ q1_selling: true });
    eq(r.pendingQuestionId, null, "answering 'selling' ends the walk immediately");
    ok(r.outcome!.includes("71010"), "selling lands in ordinary payroll expense");
    ok(r.outcome!.includes("280E"), "and says §280E disallows it");
  }
  {
    // The full happy path to capitalisation.
    const r = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: true,
    });
    ok(r.outcome!.includes("61000"), "proved receiving labor reaches 61000");
    eq(r.path.length, 5, "and the walk visited every question");
  }
  {
    // Same path, no evidence.
    const r = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: false,
    });
    ok(r.outcome!.includes("71010"), "without records the same work is ordinary payroll");
  }
  {
    // A partial walk must ASK, not guess.
    const r = walkLaborDecisionTree({ q1_selling: false });
    eq(r.pendingQuestionId, "q2_separate_business", "an unanswered tree asks the next question");
    eq(r.outcome, null, "and refuses to guess an outcome");
    eq(walkLaborDecisionTree({}).pendingQuestionId, "q1_selling", "an empty walk starts at the beginning");
  }
  {
    // The tree and the engine must AGREE. Two sources of truth that disagree
    // would be worse than one, because Michael would be taught one thing and
    // charged another.
    const treeSays = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: true,
    });
    const engineSays = evaluatePayrollRun(__fixtureRun({
      substantiation: __fixtureSubstantiation(),
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    }));
    ok(treeSays.outcome!.includes(PAYROLL_COGS_ACCOUNT), "the tree routes proved receiving labor to 61000");
    ok(engineSays.acquisitionLaborCents > 0, "and the engine capitalises it too — the two agree");

    const treeNoEvidence = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: false,
    });
    const engineNoEvidence = evaluatePayrollRun(__fixtureRun({
      substantiation: null,
      employees: [__fixtureEmployee({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    }));
    ok(treeNoEvidence.outcome!.includes(WAGE_EXPENSE_ACCOUNT), "without evidence the tree says ordinary payroll");
    eq(engineNoEvidence.postable, false, "and the engine refuses to post it — the two agree again");
  }
  {
    // Fuzz the tree: it must always terminate.
    let seed = 424242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 500; i += 1) {
      const answers: Record<string, boolean> = {};
      for (const n of LABOR_DECISION_TREE) if (rnd() > 0.2) answers[n.id] = rnd() > 0.5;
      const r = walkLaborDecisionTree(answers);
      ok(r.path.length <= LABOR_DECISION_TREE.length, "a tree walk never exceeds the tree depth");
      ok(r.outcome !== null || r.pendingQuestionId !== null, "a walk always either answers or asks");
    }
  }

  // ── THE PICTURE ─────────────────────────────────────────────────────────
  {
    const v = evaluatePayrollRun(__fixtureRun());
    const bars = payrollBars(v);
    eq(bars.reduce((s, b) => s + b.milliPct, 0), 100000, "the bars sum to exactly 100%");
    for (const b of bars) ok(b.plainEnglish.trim().length > 30, `${b.label} explains itself in plain English`);
  }
  {
    const bars = payrollBars(evaluatePayrollRun(__fixtureRun({ employees: [] })));
    eq(bars.reduce((s, b) => s + b.milliPct, 0), 0, "an empty run shows 0%, not a division by zero");
  }

  console.log("payroll-cogs-core self-tests: all passed");
}
