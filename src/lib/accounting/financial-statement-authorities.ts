/**
 * src/lib/accounting/financial-statement-authorities.ts   (books-17)
 *
 * THE AUTHORITY BEHIND EVERY LINE ON A FINANCIAL STATEMENT.
 *
 * Michael asked for the rules baked in VERBATIM (standing rule 24). Every quote
 * in this file was transcribed from the primary source and re-verified against
 * it; none of it is paraphrase, and none of it was typed from memory.
 *
 * ---------------------------------------------------------------------------
 * A HONEST NOTE ABOUT SOURCING, WHICH MATTERS MORE THAN IT LOOKS
 * ---------------------------------------------------------------------------
 *
 * The real GAAP authority for how a financial statement is presented is the
 * FASB Accounting Standards Codification — ASC 205 (presentation), ASC 210
 * (balance sheet), ASC 225/220 (income statement), ASC 230 (cash flows),
 * ASC 330 (inventory). The Codification is LICENSED, and for most of this
 * slice's life this file could only CITE it by number, never quote it.
 *
 * THAT CHANGED ON 2026-08-20. Michael obtained the Codification himself and
 * placed it in the workspace. The four ASC records in section 0 below are
 * therefore transcribed VERBATIM from the actual Codification text he
 * supplied — not from a summary, not from a textbook, not from memory. Each
 * one names the exact file it came from in its `source` field so any future
 * reader can re-verify the transcription against the same page.
 *
 * This matters beyond bookkeeping. Four rules in this engine were previously
 * supported only by the CONCEPTUAL framework (CON 8, which explains how the
 * FASB thinks) or by Regulation S-X (which does not bind Greenway at all).
 * They are now supported by BINDING GAAP. The conceptual records are kept
 * rather than deleted, because they explain the REASONING that the
 * Codification only states as a conclusion — but where the two overlap, the
 * ASC record is the authority and CON 8 is the commentary.
 *
 * Where the Codification is still the real authority for something this slice
 * does NOT yet implement, it remains CITED BY NUMBER and NOT quoted. A cite
 * without a quote is visibly a cite without a quote.
 *
 * Regulation S-X (federal regulation, public domain) is retained as a
 * PRESENTATION CANON only, for the reason given immediately below.
 *
 * REGULATION S-X DOES NOT BIND GREENWAY. Reg S-X governs financial statements
 * filed with the SEC by registrants. Greenway is a private Washington LLC taxed
 * as an S corporation and files nothing with the SEC. It is used here as a
 * PRESENTATION CANON — the most precise published government description of
 * what belongs on the face of a financial statement — and never as a
 * requirement. Saying that plainly is the difference between teaching Michael
 * and misleading him. `PRESENTATION_CANON_DISCLAIMER` below travels with these
 * records wherever they are displayed.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT REDECLARED HERE
 * ---------------------------------------------------------------------------
 *
 * The registry already held 147 authorities before this slice. §280E, the
 * §471/§263A inventory rules, Alpenglow, Harborside, Patients Mutual, Alterman,
 * CHAMP, the Senate Report and RCW 69.50.535 ALL ALREADY EXIST. They are CITED
 * by id from `AUTHORITY_IDS_OWNED_ELSEWHERE`, never re-declared, because two
 * copies of one authority is exactly how the two copies drift apart and a
 * citation stops meaning one thing (standing rule 2).
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

/**
 * Shown wherever a Regulation S-X record appears on screen.
 *
 * Michael is not an SEC registrant. He must never be left thinking a rule
 * applies to him when it does not — that is how an owner ends up either
 * frightened of an imaginary obligation or contemptuous of a real one.
 */
export const PRESENTATION_CANON_DISCLAIMER =
  "Regulation S-X governs companies that file with the SEC. You do not file with the SEC, so none of " +
  "it is binding on you. It is quoted because it is the clearest published description anywhere of " +
  "what a financial statement should look like — we use it as the house style guide, not as law. " +
  "The parts that ARE binding on you are the tax authorities, and those are marked as statutes and " +
  "regulations of Title 26.";

// ---------------------------------------------------------------------------
// 0) BINDING GAAP — the FASB Accounting Standards Codification
// ---------------------------------------------------------------------------
//
// These four are the real thing. Everything in section 1 (Reg S-X) is style
// guidance that does not bind Greenway, and everything in section 2 (CON 8) is
// the FASB explaining its own reasoning. THESE are the accounting rules.

/**
 * Why the balance sheet, the income statement and the cash flow statement are
 * produced together as one set rather than one at a time on request.
 */
export const ASC_205_10_45_1A_FULL_SET: GuidanceAuthority = {
  id: "ASC_205_10_45_1A_FULL_SET",
  kind: "gaap",
  cite: "FASB ASC 205-10-45-1A",
  quote:
    "A full set of financial statements for a period shall show all of the following: a. Financial " +
    "position at the end of the period b. Earnings (net income) for the period, (which may be " +
    "presented as a separate statement or within a continuous statement of comprehensive income [see " +
    "paragraph 220-10-45-1A]) c. Comprehensive income (total nonowner changes in equity) for the " +
    "period in one statement or two separate but consecutive statements (if the reporting entity is " +
    "required to report comprehensive income, see paragraph 220-10-15-3)",
  soWhat:
    "This is why closing a month hands you a SET of statements and not a single page. A balance " +
    "sheet with no income statement cannot be checked, and an income statement with no balance " +
    "sheet cannot be tied out. Greenway has no comprehensive-income items — no foreign currency, no " +
    "securities portfolio — so for you comprehensive income equals net income, and the engine says " +
    "so rather than printing an empty statement to look thorough.",
  source: "FASB Accounting Standards Codification ASC 205-10-45, as supplied by the owner 2026-08-20 (fasb_codification_205.pdf, generated 8/19/2026); Copyright © 2026 Financial Accounting Foundation, all rights reserved.",
};

/**
 * The authority for showing last period beside this period.
 */
export const ASC_205_10_45_1_COMPARATIVES: GuidanceAuthority = {
  id: "ASC_205_10_45_1_COMPARATIVES",
  kind: "gaap",
  cite: "FASB ASC 205-10-45-1",
  quote:
    "The presentation of comparative financial statements in annual and other reports enhances the " +
    "usefulness of such reports and brings out more clearly the nature and trends of current changes " +
    "affecting the entity. Such presentation emphasizes the fact that statements for a series of " +
    "periods are far more significant than those for a single period and that the accounts for one " +
    "period are but an installment of what is essentially a continuous history.",
  soWhat:
    "\"An installment of what is essentially a continuous history\" is the sentence to remember. One " +
    "month of Greenway tells you almost nothing; June against May, and June against last June, tells " +
    "you everything. It is also the practical reason the comparison engine REFUSES to line up two " +
    "periods of different lengths — a 31-day month beside a 28-day month is not a trend, it is an " +
    "optical illusion.",
  source: "FASB Accounting Standards Codification ASC 205-10-45, as supplied by the owner 2026-08-20 (fasb_codification_205.pdf, generated 8/19/2026); Copyright © 2026 Financial Accounting Foundation, all rights reserved.",
};

/**
 * BINDING GAAP for the no-netting rule. CON 8 ¶PR33 says there is no consistent
 * conceptual basis for netting; this says what you must actually DO about it.
 */
export const ASC_210_20_45_4_NO_NETTING: GuidanceAuthority = {
  id: "ASC_210_20_45_4_NOT_FAITHFUL",
  kind: "gaap",
  cite: "FASB ASC 210-20-45-4",
  quote:
    "If a party does not intend to set off even though the ability to set off exists, an offsetting " +
    "presentation in the statement of financial position is not representationally faithful.",
  soWhat:
    "You are allowed to net two amounts against each other only when you have a legal right to do " +
    "it AND you actually intend to. Short of that, netting makes the statement untrue — those are " +
    "the FASB's words, not a preference. This is the binding rule behind the engine surfacing a " +
    "backwards account instead of quietly cancelling it against something else. A vendor you owe " +
    "$5,000 and who owes you a $2,000 credit is $5,000 and $2,000, not $3,000, unless you are " +
    "genuinely going to settle them as one.",
  source: "FASB Accounting Standards Codification ASC 210-20-45, as supplied by the owner 2026-08-20 (fasb_codification_210.pdf, generated 8/19/2026); Copyright © 2026 Financial Accounting Foundation, all rights reserved.",
};

/**
 * Gross beats net in the cash flow statement.
 */
export const ASC_230_10_45_7_GROSS_CASH_FLOWS: GuidanceAuthority = {
  id: "ASC_230_10_45_7_GROSS_NOT_NET",
  kind: "gaap",
  cite: "FASB ASC 230-10-45-7",
  quote:
    "Generally, information about the gross amounts of cash receipts and cash payments during a " +
    "period is more relevant than information about the net amounts of cash receipts and payments. " +
    "However, the net amount of related receipts and payments provides sufficient information not " +
    "only for cash equivalents, as noted in paragraph 230-10-45-5, but also for certain other " +
    "classes of cash flows specified in paragraphs 230-10-45-8 through 45-9 and paragraph " +
    "230-10-45-28.",
  soWhat:
    "For a cash-only business this is the difference between a useful report and a shrug. " +
    "\"Cash went up $12,000\" hides that $400,000 came in the door and $388,000 went out of it. The " +
    "engine reports the flows gross for exactly this reason — and in your case the gross figures " +
    "are also the ones that have to agree with the deposits, the excise payment and the till.",
  source: "FASB Accounting Standards Codification ASC 230-10-45, as supplied by the owner 2026-08-20 (fasb_codification_230.pdf, generated 8/19/2026); Copyright © 2026 Financial Accounting Foundation, all rights reserved.",
};

/**
 * What "cost" means for inventory — the GAAP half of the §471/§263A story.
 */
export const ASC_330_10_30_1_INVENTORY_COST: GuidanceAuthority = {
  id: "ASC_330_10_30_1_INVENTORY_COST",
  kind: "gaap",
  cite: "FASB ASC 330-10-30-1",
  quote:
    "The primary basis of accounting for inventories is cost, which has been defined generally as " +
    "the price paid or consideration given to acquire an asset. As applied to inventories, cost " +
    "means in principle the sum of the applicable expenditures and charges directly or indirectly " +
    "incurred in bringing an article to its existing condition and location. It is understood to " +
    "mean acquisition and production cost, and its determination involves many considerations.",
  soWhat:
    "\"Bringing an article to its existing condition and location\" is the whole test. The invoice " +
    "price of the flower is inventory; so is the freight to get it to Port Orchard. The budtender " +
    "who sells it is not, and neither is the rent on the retail floor — those come AFTER the " +
    "product reached its condition and location. Under §280E that distinction is not academic: " +
    "what lands in inventory eventually becomes cost of goods sold and reduces your taxable " +
    "income, and what does not is disallowed. Note carefully that GAAP cost and §471 tax cost are " +
    "NOT always the same number, which is why this engine keeps the book figure and the tax figure " +
    "side by side instead of pretending one is the other.",
  source: "FASB Accounting Standards Codification ASC 330-10-30, as supplied by the owner 2026-08-20 (fasb_codification_330.pdf, generated 8/19/2026); Copyright © 2026 Financial Accounting Foundation, all rights reserved.",
};

// ---------------------------------------------------------------------------
// 1) THE PRESENTATION CANON — Regulation S-X
// ---------------------------------------------------------------------------

/**
 * The anti-footnote rule. This is the regulatory twin of standing rule 27:
 * a disclosure does not rescue a statement that is wrong.
 */
export const REG_SX_4_01_FORM_AND_ORDER: GuidanceAuthority = {
  id: "REG_SX_210_4_01_NOT_MISLEADING",
  kind: "regulation",
  cite: "17 C.F.R. §210.4-01(a), (a)(1), (c)",
  quote:
    "(a) Financial statements should be filed in such form and order, and should use such generally " +
    "accepted terminology, as will best indicate their significance and character in the light of the " +
    "provisions applicable thereto. The information required with respect to any statement shall be " +
    "furnished as a minimum requirement to which shall be added such further material information as " +
    "is necessary to make the required statements, in the light of the circumstances under which they " +
    "are made, not misleading. (1) Financial statements filed with the Commission which are not " +
    "prepared in accordance with generally accepted accounting principles will be presumed to be " +
    "misleading or inaccurate, despite footnote or other disclosures, unless the Commission has " +
    "otherwise provided. ... (c) Negative amounts (red figures) shall be shown in a manner which " +
    "clearly distinguishes the negative attribute.",
  soWhat:
    "Read the four words 'despite footnote or other disclosures'. A statement built on the wrong " +
    "numbers is still wrong even if a note underneath admits it. That is why this system REFUSES to " +
    "print a report that does not tie instead of printing one with a warning on it — a warning is a " +
    "footnote, and a footnote does not fix a number. The last sentence is why negatives are shown in " +
    "parentheses everywhere in this app rather than with a minus sign that is easy to miss.",
  source: "eCFR, title 17, part 210, §210.4-01 (retrieved 2026-08-20)",
};

/**
 * Income statement caption order — and the 1% excise rule, which is the single
 * most useful sentence in Regulation S-X for a cannabis retailer.
 */
export const REG_SX_5_03_INCOME_CAPTIONS: GuidanceAuthority = {
  id: "REG_SX_210_5_03_CAPTION_ORDER",
  kind: "regulation",
  cite: "17 C.F.R. §210.5-03(b), captions 1 and 2",
  quote:
    "1. Net sales and gross revenues. State separately: (a) Net sales of tangible products (gross " +
    "sales less discounts, returns and allowances), (b) operating revenues of public utilities or " +
    "others; (c) income from rentals; (d) revenues from services; and (e) other revenues. ... If the " +
    "total of sales and revenues reported under this caption includes excise taxes in an amount equal " +
    "to 1 percent or more of such total, the amount of such excise taxes shall be shown on the face of " +
    "the statement parenthetically or otherwise. 2. Costs and expenses applicable to sales and " +
    "revenues. State separately the amount of (a) cost of tangible goods sold, (b) operating expenses " +
    "of public utilities or others, (c) expenses applicable to rental income, (d) cost of services, " +
    "and (e) expenses applicable to other revenues. Merchandising organizations, both wholesale and " +
    "retail, may include occupancy and buying costs under caption 2(a).",
  soWhat:
    "The threshold is ONE PERCENT. Washington's cannabis excise is THIRTY-SEVEN percent. You are " +
    "thirty-seven times over the line, so the excise tax belongs on the FACE of your income statement " +
    "where you can see it every month — not buried in a note. This matters because it is the second " +
    "largest number on your whole statement and it is the one most often recorded in the wrong place. " +
    "Notice also that caption 2(a) lets a RETAILER put occupancy and buying costs into cost of goods " +
    "sold; that permission is real, but it collides with §280E and with Patients Mutual, so it is " +
    "never applied automatically here.",
  source: "eCFR, title 17, part 210, §210.5-03 (retrieved 2026-08-20)",
};

/**
 * Balance sheet caption order, and the 5% breakout tests. Note that the rule
 * says "in excess of", which makes exactly 5% NOT a breakout — arithmetic, not
 * judgment, so the engine computes it rather than asking anyone.
 */
export const REG_SX_5_02_BALANCE_CAPTIONS: GuidanceAuthority = {
  id: "REG_SX_210_5_02_BALANCE_SHEET_ORDER",
  kind: "regulation",
  cite: "17 C.F.R. §210.5-02, captions 8 and 20",
  quote:
    "8. Other current assets. State separately, in the balance sheet or in a note thereto, any amounts " +
    "in excess of five percent of total current assets. ... [Accrued liabilities:] State separately, " +
    "in the balance sheet or in a note thereto, any item in excess of 5 percent of total current " +
    "liabilities. Such items may include, but are not limited to, accrued payrolls, accrued interest, " +
    "taxes, indicating the current portion of deferred income taxes, and the current portion of " +
    "long-term debt. Remaining items may be shown in one amount.",
  soWhat:
    "'In excess of' means exactly five percent is NOT a breakout — the engine tests strictly greater " +
    "than, and there is a test that proves it. The rule names accrued payrolls and taxes specifically, " +
    "which for you means the excise tax payable and the payroll accruals are the two items most likely " +
    "to trip the test. When something is big enough to matter it gets its own line, because a big " +
    "number hidden inside 'other' is a big number nobody looks at.",
  source: "eCFR, title 17, part 210, §210.5-02 (retrieved 2026-08-20)",
};

// ---------------------------------------------------------------------------
// 2) THE CONCEPTUAL FRAMEWORK — FASB CON 8, Chapter 7
// ---------------------------------------------------------------------------

export const CON8_PR33_NO_NETTING: GuidanceAuthority = {
  id: "CON8_CH7_PR33_NETTING",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR33",
  quote:
    "There is confusion about the term netting when it comes to financial statement items because " +
    "there are many potential circumstances in which netting is considered to have been applied in all " +
    "financial statements. There is no consistent conceptual basis for netting assets and liabilities " +
    "on the balance sheet.",
  soWhat:
    "This is the authority for a rule this system applies everywhere: when an account is backwards — " +
    "a negative inventory, a cash account in credit — it gets SURFACED on the report, not quietly " +
    "cancelled against something else. Netting is where errors go to hide. Your negative-inventory " +
    "months were only visible because nothing netted them away.",
  source: "storage.fasb.org, Concepts Statement 8 Chapter 7 (Presentation), PDF (retrieved 2026-08-20)",
};

export const CON8_PR39_HOMOGENEITY: GuidanceAuthority = {
  id: "CON8_CH7_PR39_HOMOGENEITY",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR39",
  quote:
    "Subtotals represent broad classes of often heterogeneous items. In contrast, line items can " +
    "reflect more homogeneous classes of items and usually are more useful to resource providers in " +
    "faithfully representing the differences in effects of transactions, events, and circumstances. " +
    "Therefore, creating line items that include classes of items that are as nearly homogeneous as " +
    "possible is a critical aspect of presentation. Homogeneity enhances the ability to faithfully " +
    "represent a line item.",
  soWhat:
    "Do not mix unlike things on one line. For you the sharpest example is the §280E wall: costs that " +
    "reduce your taxable income and costs that do not are NOT the same kind of thing, so they never " +
    "share a line, no matter how similar they look in the checkbook.",
  source: "storage.fasb.org, Concepts Statement 8 Chapter 7 (Presentation), PDF (retrieved 2026-08-20)",
};

export const CON8_PR12_NOTE_IS_NOT_RECOGNITION: GuidanceAuthority = {
  id: "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE",
  kind: "gaap",
  cite: "FASB Concepts Statement No. 8, Chapter 7, ¶PR12",
  quote:
    "The distinction between information that should be depicted in line items, subtotals, and totals " +
    "on the face of a financial statement and information that should be provided by other means is " +
    "based on the definitions of the elements of financial statements and the related recognition and " +
    "measurement concepts. Providing information only in a note, parenthetically on the face of a " +
    "financial statement, in a supplementary schedule, or by other means of financial reporting is not " +
    "an acceptable alternative to recognizing an element of financial statements that meets the " +
    "recognition criteria.",
  soWhat:
    "A note is not a substitute for a number. This is why the §280E wall is drawn ON the face of your " +
    "income statement as a real line rather than explained in a paragraph underneath it, and why a " +
    "liability you actually owe gets recorded rather than merely mentioned.",
  source: "storage.fasb.org, Concepts Statement 8 Chapter 7 (Presentation), PDF (retrieved 2026-08-20)",
};

// ---------------------------------------------------------------------------
// 3) THE EXCISE TAX — where the 37% actually goes
// ---------------------------------------------------------------------------

/**
 * CCA 201531016. Addressed to Associate Area Counsel in SEATTLE, about the
 * STATE OF WASHINGTON marijuana excise tax. That is Greenway's exact fact
 * pattern, which is why it is here despite being non-precedential.
 *
 * TWO DELIBERATE EDITORIAL DECISIONS, both of which matter:
 *
 *   1. The non-precedential disclaimer is INCLUDED IN THE QUOTE. It travels
 *      with the holding so it can never be shown without it.
 *
 *   2. The memorandum's rate discussion is OMITTED. It was written in 2015 and
 *      refers to the old 25% rate; Washington moved to 37% (RCW 69.50.535).
 *      Quoting the stale rate would put an obsolete number in the registry
 *      where somebody could read it back out as if it were current law.
 */
export const CCA_201531016_EXCISE_REDUCES_REALIZED: GuidanceAuthority = {
  id: "CCA_201531016_EXCISE_AMOUNT_REALIZED",
  kind: "irs_guidance",
  cite: "CCA 201531016 (June 9, 2015), released July 31, 2015",
  quote:
    "This advice may not be used or cited as precedent. ... We interpret the State of Washington " +
    "marijuana excise tax to be a tax paid or accrued in connection with the disposition of property " +
    "by a trade or business. Accordingly, pursuant to §164(a), a taxpayer who paid the marijuana " +
    "excise tax should treat the expenditure as a reduction in the amount realized on the sale of the " +
    "property rather than as either a part of the inventoriable cost of that property or a deduction " +
    "from gross income. Though §280E prohibits deductions and credits for these businesses, this " +
    "excise tax is neither a deduction from gross income nor a tax credit. Consequently, §280E does " +
    "not preclude a taxpayer from accounting for this excise tax as a reduction in the amount realized " +
    "on the sale of the property.",
  soWhat:
    "This is written about YOUR tax, to an IRS lawyer in Seattle. It says the 37% excise is three " +
    "things it is NOT — not a deduction, not a credit, and not part of inventory cost — and one thing " +
    "it IS: a reduction in what you realized on the sale. In practice that puts it between gross sales " +
    "and net sales, ABOVE the §280E wall, where it does you good. The tempting mistake is to bury it " +
    "in cost of goods sold; this says do not. Note the first sentence: the IRS can decline to follow " +
    "this in your case, so it is support, not a guarantee. Independently of it, Regulation S-X caption " +
    "1 puts any excise over 1% of sales on the face of the statement, and you are at 37%.",
  source: "https://www.irs.gov/pub/irs-wd/201531016.pdf (retrieved 2026-08-20)",
};

/**
 * The accrual trap that footnote 1 of the CCA points at. This is not a
 * presentation rule — it is a live book-to-tax difference for Greenway.
 */
export const REG_1_461_4_G_6_ECONOMIC_PERFORMANCE: GuidanceAuthority = {
  id: "REG_1_461_4_G_6_TAX_ECONOMIC_PERFORMANCE",
  kind: "regulation",
  cite: "26 C.F.R. §1.461-4(g)(6)(i)",
  quote:
    "Taxes — (i) In general. Except as otherwise provided in this paragraph (g)(6), if the liability of " +
    "a taxpayer is to pay a tax, economic performance occurs as the tax is paid to the governmental " +
    "authority that imposed the tax. For purposes of this paragraph (g)(6), payment includes payments " +
    "of estimated income tax and payments of tax where the taxpayer subsequently files a claim for " +
    "credit or refund.",
  soWhat:
    "Your books are kept on the accrual basis, but for TAX purposes a tax is generally not incurred " +
    "until it is actually PAID. So the excise or B&O you accrue in December but pay in January can be " +
    "a book expense in one year and a tax expense in the next. That gap is real and it belongs in the " +
    "book-to-tax bridge rather than being discovered on a return. There is an exception — the " +
    "recurring item rule of §1.461-5 — but whether you have adopted it is a question about a filed " +
    "return, and this system will not guess at it.",
  source: "eCFR, title 26, §1.461-4 (retrieved 2026-08-20)",
};

// ---------------------------------------------------------------------------
// 4) S-CORPORATION EQUITY — the two accounts with different floors
// ---------------------------------------------------------------------------

export const IRC_1367_BASIS_ADJUSTMENTS: GuidanceAuthority = {
  id: "IRC_1367_STOCK_BASIS_ADJUSTMENTS",
  kind: "statute",
  cite: "26 U.S.C. §1367(a)",
  quote:
    "(a) General rule. (1) Increases in basis. The basis of each shareholder's stock in an S " +
    "corporation shall be increased for any period by the sum of the following items determined with " +
    "respect to that shareholder for such period: (A) the items of income described in subparagraph " +
    "(A) of section 1366(a)(1), (B) any nonseparately computed income determined under subparagraph " +
    "(B) of section 1366(a)(1), and (C) the excess of the deductions for depletion over the basis of " +
    "the property subject to depletion. (2) Decreases in basis. The basis of each shareholder's stock " +
    "in an S corporation shall be decreased for any period (but not below zero) by the sum of the " +
    "following items determined with respect to the shareholder for such period: (A) distributions by " +
    "the corporation which were not includible in the income of the shareholder by reason of section " +
    "1368, (B) the items of loss and deduction described in subparagraph (A) of section 1366(a)(1), " +
    "(C) any nonseparately computed loss determined under subparagraph (B) of section 1366(a)(1), " +
    "(D) any expense of the corporation not deductible in computing its taxable income and not " +
    "properly chargeable to capital account, and (E) the amount of the shareholder's deduction for " +
    "depletion for any oil and gas property held by the S corporation.",
  soWhat:
    "Subparagraph (D) is the one that hurts. Every dollar §280E disallows is 'an expense not deductible " +
    "in computing taxable income and not properly chargeable to capital account' — so it eats your " +
    "stock basis even though you never got a deduction for it. You pay for those expenses twice: once " +
    "in cash, and once in lost basis. Note the four words 'but not below zero': stock basis stops at " +
    "zero and cannot go negative. Remember that, because the next authority is the same rule with the " +
    "floor removed.",
  source: "26 U.S.C. §1367 (Cornell LII, retrieved 2026-08-20)",
};

export const IRC_1368_DISTRIBUTIONS_AND_AAA: GuidanceAuthority = {
  id: "IRC_1368_DISTRIBUTIONS_AAA",
  kind: "statute",
  cite: "26 U.S.C. §1368(b), (d), (e)(1)(A)",
  quote:
    "(b) S corporation having no earnings and profits. In the case of a distribution described in " +
    "subsection (a) by an S corporation which has no accumulated earnings and profits — (1) Amount " +
    "applied against basis. The distribution shall not be included in gross income to the extent that " +
    "it does not exceed the adjusted basis of the stock. (2) Amount in excess of basis. If the amount " +
    "of the distribution exceeds the adjusted basis of the stock, such excess shall be treated as gain " +
    "from the sale or exchange of property. ... (d) Certain adjustments taken into account. Subsections " +
    "(b) and (c) shall be applied by taking into account (to the extent proper) — (1) the adjustments " +
    "to the basis of the shareholder's stock described in section 1367, and (2) the adjustments to the " +
    "accumulated adjustments account which are required by subsection (e)(1). ... (e)(1)(A) In general. " +
    "Except as otherwise provided in this paragraph, the term 'accumulated adjustments account' means " +
    "an account of the S corporation which is adjusted for the S period in a manner similar to the " +
    "adjustments under section 1367 (except that no adjustment shall be made for income (and related " +
    "expenses) which is exempt from tax under this title and the phrase '(but not below zero)' shall " +
    "be disregarded in section 1367(a)(2)) ...",
  soWhat:
    "Two things, and they are the two most commonly confused numbers in an S corporation. FIRST: the " +
    "phrase '(but not below zero)' IS DISREGARDED for the accumulated adjustments account. Stock basis " +
    "has a floor at zero; AAA does not and can go deeply negative. For a cannabis retailer that is not " +
    "a footnote — your disallowed §280E expenses drive AAA below zero while basis stops at zero, so " +
    "the two numbers will not agree and are not supposed to. SECOND: under (b)(2), a distribution " +
    "larger than your basis is a CAPITAL GAIN you owe tax on, in a year you may have taken no salary. " +
    "Subsection (d) sets the order: this year's income goes into basis BEFORE distributions are tested " +
    "against it. Test them in the wrong order and you invent a gain that does not exist.",
  source: "26 U.S.C. §1368 (Cornell LII, retrieved 2026-08-20)",
};

// ---------------------------------------------------------------------------
// 5) EXPORTS
// ---------------------------------------------------------------------------

/** Everything this slice ADDS to the registry. */
export const FINANCIAL_STATEMENT_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  ASC_205_10_45_1A_FULL_SET,
  ASC_205_10_45_1_COMPARATIVES,
  ASC_210_20_45_4_NO_NETTING,
  ASC_230_10_45_7_GROSS_CASH_FLOWS,
  ASC_330_10_30_1_INVENTORY_COST,
  REG_SX_4_01_FORM_AND_ORDER,
  REG_SX_5_03_INCOME_CAPTIONS,
  REG_SX_5_02_BALANCE_CAPTIONS,
  CON8_PR33_NO_NETTING,
  CON8_PR39_HOMOGENEITY,
  CON8_PR12_NOTE_IS_NOT_RECOGNITION,
  CCA_201531016_EXCISE_REDUCES_REALIZED,
  REG_1_461_4_G_6_ECONOMIC_PERFORMANCE,
  IRC_1367_BASIS_ADJUSTMENTS,
  IRC_1368_DISTRIBUTIONS_AND_AAA,
] as const;

export function findFinancialStatementAuthority(id: string): GuidanceAuthority | undefined {
  return FINANCIAL_STATEMENT_AUTHORITIES_NEW.find((a) => a.id === id);
}

/**
 * Authorities this slice CITES but does NOT own.
 *
 * Every id here was verified to resolve in the shared registry before being
 * listed. Re-declaring any of them would create a second copy that could drift
 * from the first, and a citation that means two things is worse than no
 * citation at all (standing rule 2). A test asserts every id below still
 * resolves, so deleting one elsewhere fails loudly here.
 */
export const AUTHORITY_IDS_OWNED_ELSEWHERE: readonly string[] = [
  "IRC_280E",
  "IRC_280E_TRAFFICKING",
  "REG_1_61_3_A",
  "REG_1_471_3_B",
  "REG_1_471_3_B_RESELLER",
  "REG_1_471_3_B_RESELLER_COST",
  "REG_1_471_3_C",
  "REG_1_471_3_F_DISALLOWED",
  "REG_1_471_2_D_VERIFY_BY_COUNT",
  "IRC_263A_FLUSH",
  "REG_1_263A_1_C_2_I",
  "REG_1_162_1_A",
  "ALPENGLOW_EXCLUSION",
  "HARBORSIDE",
  "PATIENTS_MUTUAL_RESELLER",
  "ALTERMAN_COGS_FORMULA",
  "CHAMP",
  "SENATE_REPORT_97_494",
  "RCW_69_50_535",
] as const;
