/**
 * src/lib/accounting/tax-penalty-authorities.ts   (slice books-16)
 *
 * THE SOURCE TEXT BEHIND EVERY PENALTY NUMBER THIS SYSTEM WILL EVER SHOW YOU.
 *
 * Michael asked for this directly, 2026-08-20:
 *
 *   "Keep adding in verbatim authoritative text to block and teach and guide
 *    me. From tax authorities and from a PhD cpa who will hold my hand every
 *    step of the way. ... Each function we build in the books production needs
 *    authoritative text verbatim so I know why and how."
 *
 * So the rule for this file is the same rule as payroll-tax-authorities.ts:
 * every `quote` below was transcribed from a PRIMARY government source during
 * the slice that added it. Not a blog. Not a vendor summary. Not memory. The
 * `source` field is the exact place it came from. If a number in
 * tax-penalty-core.ts cannot be traced to a quote in this file, that number is
 * a guess and it does not belong in the product (standing rule 1).
 *
 * ── WHY A SECOND AUTHORITIES FILE INSTEAD OF APPENDING TO THE PAYROLL ONE ───
 *
 * Because these are not payroll authorities. Four of the five agencies here
 * (DOR, LCB, and the two federal deductibility questions) have nothing to do
 * with a paycheck. Filing them under "payroll" would be a filing lie, and the
 * moment a citation is filed under the wrong heading somebody eventually cites
 * it for the wrong proposition.
 *
 * They still merge into the ONE registry in books-guidance-core.ts, under the
 * source tag "tax-penalty", for the reason that module exists: a citation must
 * mean exactly one thing on every screen in this application (standing rule 2).
 *
 * ── THE IDS HERE ARE LOAD-BEARING ──────────────────────────────────────────
 *
 * tax-penalty-core.ts references these by id and a test asserts that EVERY
 * authorityId emitted by the engine resolves to a real record. A refusal that
 * cites a citation which does not exist is worse than no refusal at all,
 * because it looks authoritative while being empty.
 *
 * PURE DATA. No I/O, no clock, no server imports.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) WASHINGTON DEPARTMENT OF REVENUE — sales tax and B&O
// ---------------------------------------------------------------------------

/**
 * ⭐ THE ONE THAT BREAKS SHARED CODE.
 *
 * Read the trigger language, not the percentages. ESD and L&I count "months or
 * part thereof of delinquency" — elapsed time. DOR counts "the last day of the
 * month following the due date" — a CALENDAR landmark. Those two clocks give
 * different answers on identical facts, which is why DOR gets its own function
 * in tax-penalty-core.ts and shares nothing with the ESD path.
 */
export const RCW_82_32_090_DOR_LATE: GuidanceAuthority = {
  id: "rcw-82-32-090-dor-late-penalty",
  kind: "state_law",
  cite: "RCW 82.32.090(1), (2), (3)",
  quote:
    "(1) If payment of any tax due on a return to be filed by a taxpayer is not received by the " +
    "department of revenue by the due date, there is assessed a penalty of nine percent of the amount " +
    "of the tax; and if the tax is not received on or before the last day of the month following the " +
    "due date, there is assessed a total penalty of 19 percent of the amount of the tax under this " +
    "subsection; and if the tax is not received on or before the last day of the second month " +
    "following the due date, there is assessed a total penalty of 29 percent of the amount of the tax " +
    "under this subsection. No penalty so added may be less than $5. ... (2) If the department of " +
    "revenue determines that any tax has been substantially underpaid, there is assessed a penalty of " +
    "five percent of the amount of the tax determined by the department to be due ... As used in this " +
    "subsection, 'substantially underpaid' means that the taxpayer has paid less than 80 percent of " +
    "the amount of tax determined by the department to be due for all of the types of taxes included " +
    "in, and for the entire period of time covered by, the department's examination, and the amount " +
    "of underpayment is at least $1,000. (3) If a warrant is issued by the department of revenue for " +
    "the collection of taxes, increases, and penalties, there is added thereto a penalty of 10 " +
    "percent of the amount of the tax, but not less than $10.",
  soWhat:
    "Two things here will cost you money if you skim them. First, 9/19/29 are RUNNING TOTALS, not " +
    "additions — at the worst tier you owe 29%, not 9+19+29=57%. Second, and this is the subtle one: " +
    "the Department of Revenue does NOT count months the way Employment Security does. ESD asks 'how " +
    "many months have gone by since the due date.' DOR asks 'has the last day of the following month " +
    "passed yet.' Take a return due January 25 and paid March 1. ESD is in its second tier. DOR has " +
    "already passed the last day of January AND the last day of February, so DOR is at 29%. Same " +
    "facts, same lateness, two different answers — which is exactly why this system refuses to run " +
    "both agencies through one shared calculation. Note the floor is $5 at DOR versus $10 at ESD and " +
    "L&I; even a trivial tax generates a real penalty.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=82.32.090",
};

/**
 * The stacking rule. Written into the statute in as many words, which is
 * unusual and therefore worth quoting: most penalty regimes leave you to argue
 * about whether two penalties can hit the same dollar. Washington says yes.
 */
export const RCW_82_32_090_8_STACKING: GuidanceAuthority = {
  id: "rcw-82-32-090-8-penalties-stack",
  kind: "state_law",
  cite: "RCW 82.32.090(7), (8)",
  quote:
    "(7) If the department finds that all or any part of the deficiency resulted from an intent to " +
    "evade the tax payable hereunder, a further penalty of 50 percent of the additional tax found to " +
    "be due must be added. (8) The penalties imposed under subsections (1) through (4) of this " +
    "section can each be imposed on the same tax found to be due. This subsection does not prohibit " +
    "or restrict the application of other penalties authorized by law.",
  soWhat:
    "Subsection (8) is the sentence that should make you set a calendar reminder. The late-payment " +
    "penalty, the substantial-underpayment penalty, the warrant penalty and the unregistered penalty " +
    "are not alternatives — the statute expressly says they 'can each be imposed on the same tax.' " +
    "Stack the realistic worst case on one deficiency and you get 29 + 25 + 10 + 5 = 69 percent " +
    "BEFORE interest and before the 50% evasion penalty in subsection (7). This is why the engine " +
    "adds penalty components together and never quietly takes the largest one: taking a max() here " +
    "would understate a real assessment by tens of thousands of dollars and look perfectly reasonable " +
    "while doing it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=82.32.090",
};

/**
 * DOR interest. Quoted mainly for the SPREAD and the RESET CADENCE, both of
 * which differ from the federal rule and neither of which the system is
 * allowed to compute for itself.
 */
export const RCW_82_32_050_DOR_INTEREST: GuidanceAuthority = {
  id: "rcw-82-32-050-dor-interest",
  kind: "state_law",
  cite: "RCW 82.32.050(1), (2)",
  quote:
    "For the purposes of this section, the rate of interest to be charged to the taxpayer shall be an " +
    "average of the federal short-term rate as defined in 26 U.S.C. Sec. 1274(d) plus two percentage " +
    "points. The rate set for each new year shall be computed by taking an arithmetical average to " +
    "the nearest percentage point of the federal short-term rate, compounded annually. That average " +
    "shall be calculated using the rates from four months: January, April, and July of the calendar " +
    "year immediately preceding the new year, and October of the previous preceding year.",
  soWhat:
    "Three differences from the IRS, all of which matter if one late balance straddles a year end. " +
    "The spread is federal short-term PLUS TWO at Revenue but PLUS THREE at the IRS. Revenue fixes " +
    "the rate once on January 1 and holds it all year; the IRS resets every quarter. Revenue rounds " +
    "'to the nearest percentage point' so its rate is always a whole number. The practical " +
    "consequence: this system will never calculate the DOR rate for you. Doing so would require four " +
    "historical federal short-term rates that we would have to go source anyway, and a rate we " +
    "derived ourselves is a rate nobody can check. It goes into the rate registry as a dated, " +
    "evidenced row, and if the row for your date is missing the engine refuses rather than guessing.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=82.32.050",
};

/**
 * Legislative intent. Not operative law, weighted accordingly (rank 1), but
 * kept because it is the legislature saying out loud WHY the penalty exists —
 * and that framing is the entire justification for the alerting slice Michael
 * asked for next.
 */
export const RCW_82_32_050_INTENT: GuidanceAuthority = {
  id: "rcw-82-32-050-legislative-intent",
  kind: "legislative_history",
  cite: "Laws of 1996, ch. 149, § 1 (Findings — Intent, note to RCW 82.32.050)",
  quote:
    "The legislature finds that a consistent application of interest and penalties is in the best " +
    "interest of the residents of the state of Washington. The legislature also finds that the goal " +
    "of the department of revenue's interest and penalty system should be to encourage taxpayers to " +
    "voluntarily comply with Washington's tax code in a timely manner. The administration of tax " +
    "programs requires that there be consequences for those taxpayers who do not timely satisfy their " +
    "reporting and tax obligations, but these consequences should not be so severe as to discourage " +
    "taxpayers from voluntarily satisfying their tax obligations.",
  soWhat:
    "This is the legislature admitting the penalty is not really about revenue — it exists 'to " +
    "encourage taxpayers to voluntarily comply ... in a timely manner.' Which means the penalty is " +
    "aimed at exactly your stated problem: you told us you pay biweekly and you forget. The state " +
    "designed a fine to fix forgetting. A reminder is cheaper than the fine, and that is the whole " +
    "argument for the scheduling and alerting work you asked for next. Weighted 'persuasive only' " +
    "because a findings-and-intent section is not operative law — but it is the best possible " +
    "statement of what the alerting feature is FOR.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=82.32.050",
};

// ---------------------------------------------------------------------------
// 2) WASHINGTON LIQUOR AND CANNABIS BOARD — the 37% excise tax
// ---------------------------------------------------------------------------

/**
 * ⭐⭐ THE SINGLE MOST IMPORTANT SENTENCE IN THIS ENTIRE SLICE FOR A CASH-ONLY
 * CANNABIS RETAILER. If Michael reads exactly one authority in this file, this
 * is the one.
 */
export const RCW_69_50_535_EXCISE_TRUST: GuidanceAuthority = {
  id: "rcw-69-50-535-excise-trust",
  kind: "state_law",
  cite: "RCW 69.50.535(1)(a), (4)",
  quote:
    "(1)(a) There is levied and collected a cannabis excise tax equal to thirty-seven percent of the " +
    "selling price on each retail sale in this state of cannabis concentrates, useable cannabis, and " +
    "cannabis-infused products. This tax is separate and in addition to general state and local sales " +
    "and use taxes that apply to retail sales of tangible personal property, and is not part of the " +
    "total retail price to which general state and local sales and use taxes apply. ... (4) The tax " +
    "imposed in this section must be paid by the buyer to the seller. Each seller must collect from " +
    "the buyer the full amount of the tax payable on each taxable sale. The tax collected as required " +
    "by this section is deemed to be held in trust by the seller until paid to the board. If any " +
    "seller fails to collect the tax imposed in this section or, having collected the tax, fails to " +
    "pay it as prescribed by the board, whether such failure is the result of the seller's own acts " +
    "or the result of acts or conditions beyond the seller's control, the seller is, nevertheless, " +
    "personally liable to the state for the amount of the tax.",
  soWhat:
    "Thirty-seven cents of every dollar of cannabis you sell was never your money. The statute says " +
    "it is 'held in trust by the seller' — the identical legal character as the federal payroll " +
    "withholding you already hold under IRC §7501. You are a custodian of state funds who happens to " +
    "run a store. Now read the clause most people skip: liability attaches 'whether such failure is " +
    "the result of the seller's own acts or the result of acts or conditions beyond the seller's " +
    "control.' There is no bad-luck defence. If your cash is stolen, if a vault fails, if an employee " +
    "walks off with the deposit — you still owe the state every cent, PERSONALLY. That word " +
    "'personally' means the liability reaches past LYMAN'S MARIJUANA LLC and lands on you. For a " +
    "business that operates entirely in cash, holding the trust money in the same drawer as the " +
    "operating money is the single largest uninsured risk in the whole operation.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.535",
};

export const WAC_314_55_089_DUE_DATE: GuidanceAuthority = {
  id: "wac-314-55-089-lcb-due-date",
  kind: "state_law",
  cite: "WAC 314-55-089(1)(b)(i), (1)(c)",
  quote:
    "Filed every month, including months with no activity or payment due ... Submitted, with payment " +
    "due, to the LCB on or before the 20th day of each month, for the previous month. (For example, a " +
    "report summarizing transactions for the month of January is due by February 20th.) When the 20th " +
    "day of the month falls on a Saturday, Sunday, or a legal holiday, the filing must be postmarked " +
    "by the U.S. Postal Service no later than the next postal business day",
  soWhat:
    "Two operational facts. One: the 20th, every month, for the month before — so January's sales are " +
    "due February 20. Two: you file even in a month where you owe nothing. A zero month with no " +
    "report is still a missed filing. Notice also that the rule writes the weekend roll-forward into " +
    "itself, which matches Washington's general timing statute (RCW 1.12.040) — a due date landing on " +
    "a Saturday moves to the next business day and no penalty accrues in between. The engine rolls " +
    "the date BEFORE it counts lateness, because counting first would invent penalties that do not " +
    "legally exist.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-089",
};

/**
 * The LCB late penalty. Note what is NOT here: no cap, no floor, no interest
 * provision, and an ambiguity the rule never resolves. See `soWhat`.
 */
export const WAC_314_55_092_LCB_LATE: GuidanceAuthority = {
  id: "wac-314-55-092-lcb-late-excise",
  kind: "state_law",
  cite: "WAC 314-55-092(1), (2)",
  quote:
    "(1) Penalties: A penalty of two percent per month will be assessed on the outstanding balance " +
    "for any payments postmarked after the 20th day of the month following the month of sale. When " +
    "the 20th day of the month falls on a Saturday, Sunday, or a legal holiday, the filing must be " +
    "postmarked by the U.S. Postal Service no later than the next postal business day. Absent a " +
    "postmark, the date received at the LCB or authorized designee, will be used to assess the " +
    "penalty of two percent per month on the outstanding balance after the 20th day of the month " +
    "following the month of sale. (2) Failure to make a report and/or pay the license taxes and/or " +
    "penalties in the manner and dates outlined in WAC 314-55-089 will be sufficient grounds for the " +
    "LCB to suspend or revoke a cannabis license.",
  soWhat:
    "Structurally this is the odd one out. Revenue, Employment Security and L&I all publish a table " +
    "that TOPS OUT — 29%, 20%, 20%. The LCB publishes a RATE with no stated ceiling: two percent per " +
    "month, forever. Four months late is 8%; a year late is 24% and still climbing. There is also no " +
    "dollar floor and no separate interest charge — the 2% per month IS the whole charge. Now the " +
    "honest part: the rule says 'on the outstanding balance' and never defines whether last month's " +
    "unpaid penalty is itself part of that balance. Simple or compounding? The text does not say. " +
    "Rather than quietly pick the cheaper reading and present it as fact, this system computes the " +
    "SIMPLE version, marks the answer as an estimate, and tells you the question exists so you can " +
    "call the LCB and get a real answer. And subsection (2) is the part that is not about money at " +
    "all: the consequence of not paying is that they can take your licence.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-092",
};

/**
 * Directly targeted at Greenway's operating reality: CASH ONLY.
 */
export const WAC_314_55_089_CASH_PENALTY: GuidanceAuthority = {
  id: "wac-314-55-089-cash-payment-penalty",
  kind: "state_law",
  cite: "WAC 314-55-089(8)",
  quote:
    "If a licensee tenders payment of the cannabis excise tax in cash without applying for and " +
    "receiving a waiver or after denial of a waiver, the licensee may be assessed a 10 percent " +
    "penalty.",
  soWhat:
    "This one is aimed squarely at you, because Greenway operates in cash. Walking excise tax to the " +
    "LCB in cash WITHOUT a waiver on file is a 10 percent penalty — on a month with $60,000 of excise " +
    "that is $6,000 for using the only payment method you have. The waiver pathway exists precisely " +
    "for the cannabis banking problem and contemplates a licensee that cannot obtain a bank account. " +
    "Action item, and it is a one-time piece of paperwork: confirm a cash-payment waiver is on file " +
    "and note its expiry, because the penalty is not for being late — it is for how you paid.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-089",
};

// ---------------------------------------------------------------------------
// 3) HOW TIME IS COUNTED IN WASHINGTON
// ---------------------------------------------------------------------------

export const RCW_1_12_040_TIME: GuidanceAuthority = {
  id: "rcw-1-12-040-time-computation",
  kind: "state_law",
  cite: "RCW 1.12.040",
  quote:
    "The time within which an act is to be done, as herein provided, shall be computed by excluding " +
    "the first day, and including the last, unless the last day is a holiday, Saturday, or Sunday, " +
    "and then it is also excluded.",
  soWhat:
    "Washington's general timing rule, and the reason every due date in this engine gets rolled " +
    "forward before anything is counted. If a payment falls due on a Saturday, Saturday is 'also " +
    "excluded' and the deadline becomes the next business day — you are not late on Sunday. Get this " +
    "wrong and the software invents penalties that do not exist, which erodes trust in every other " +
    "number it shows you. One honest limitation you should know about: this statute also excludes " +
    "LEGAL HOLIDAYS, and the engine does not carry a holiday calendar yet. So it rolls weekends " +
    "correctly and flags on every single result that holidays were not checked. It tells you what it " +
    "does not know instead of pretending the gap is not there.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=1.12.040",
};

export const RCW_50_12_220_6_WAIVER: GuidanceAuthority = {
  id: "rcw-50-12-220-6-penalty-waiver",
  kind: "state_law",
  cite: "RCW 50.12.220(6)",
  quote:
    "Where adequate information has been furnished to the department and the department has failed to " +
    "act or has advised the employer of no liability or inability to decide the issue, penalties shall " +
    "be waived by the commissioner. Penalties may also be waived for good cause if the commissioner " +
    "determines that the failure to file timely, complete, and correctly formatted reports or pay " +
    "timely contributions was not due to the employer's fault.",
  soWhat:
    "Read the two verbs, because they are doing very different jobs. If the DEPARTMENT dropped the " +
    "ball, penalties 'SHALL be waived' — that is mandatory and you are entitled to it. For anything " +
    "else, penalties 'MAY be waived for good cause ... not due to the employer's fault.' That is " +
    "discretionary, it has to be asked for, and 'I forgot' is not good cause; it is the textbook " +
    "definition of the employer's own fault. This is why the engine always computes the full penalty " +
    "and never nets out a hoped-for waiver. A waiver is something you might win later, not a number " +
    "you get to assume today.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.12.220",
};

// ---------------------------------------------------------------------------
// 4) FEDERAL — IS IT DEDUCTIBLE? (the question books-15 left open)
// ---------------------------------------------------------------------------

export const IRC_162_F_PENALTIES: GuidanceAuthority = {
  id: "irc-162-f-penalties-not-deductible",
  kind: "statute",
  cite: "26 U.S.C. § 162(f)(1), (f)(4)",
  quote:
    "(f)(1) In general.—Except as provided in the following paragraphs of this subsection, no " +
    "deduction otherwise allowable shall be allowed under this chapter for any amount paid or " +
    "incurred (whether by suit, agreement, or otherwise) to, or at the direction of, a government or " +
    "governmental entity in relation to the violation of any law or the investigation or inquiry by " +
    "such government or entity into the potential violation of any law. ... (f)(4) Exception for " +
    "taxes due.—Paragraph (1) shall not apply to any amount paid or incurred as taxes due.",
  soWhat:
    "The tax itself is deductible. The PENALTY on top of it is not — not to any government, federal " +
    "or state, and it does not matter that you paid it out of the business account. The money really " +
    "does leave the bank, so it is a genuine book expense; it just gets added back on Schedule M-1 " +
    "when the return is prepared. The practical consequence for how we keep your books: penalties " +
    "live in their own expense account, never mixed with interest and never mixed with the tax. Do " +
    "that and the M-1 add-back falls straight out of the ledger in April. Fail to do it and somebody " +
    "spends a day reconstructing the split from a shoebox of agency notices.",
  source: "https://www.law.cornell.edu/uscode/text/26/162",
};

export const IRC_163_H_PERSONAL_INTEREST: GuidanceAuthority = {
  id: "irc-163-h-personal-interest",
  kind: "statute",
  cite: "26 U.S.C. § 163(a), (h)(1)",
  quote:
    "(a) General rule.—There shall be allowed as a deduction all interest paid or accrued within the " +
    "taxable year on indebtedness. ... (h)(1) In general.—In the case of a taxpayer other than a " +
    "corporation, no deduction shall be allowed under this chapter for personal interest paid or " +
    "accrued during the taxable year.",
  soWhat:
    "Interest starts out fully deductible under subsection (a) — and then subsection (h) takes it " +
    "back for anyone who is not a corporation. That phrase 'other than a corporation' is why your " +
    "S-corp status matters here in a way most owners never notice: an S corporation's income lands on " +
    "YOUR personal 1040, so the personal-interest disallowance is live for you in situations where a " +
    "C corporation would sail through. Which interest is 'personal' is not defined here — it is " +
    "defined in the regulation quoted next, and the answer is genuinely split depending on WHICH tax " +
    "was paid late.",
  source: "https://www.law.cornell.edu/uscode/text/26/163",
};

/**
 * ⭐ THE REGULATION'S OWN WORKED EXAMPLE IS LITERALLY MICHAEL'S FACT PATTERN:
 * an individual who owns stock of an S corporation. Quoted in full for that
 * reason — it is not analogous, it is identical.
 */
export const REG_1_163_9T_PERSONAL: GuidanceAuthority = {
  id: "treas-reg-1-163-9t-personal-interest",
  kind: "regulation",
  cite: "Treas. Reg. § 1.163-9T(b)(2)(i)(A), (b)(2)(ii) Example",
  quote:
    "Except as provided in paragraph (b)(2)(iii) of this section, personal interest includes " +
    "interest— (A) Paid on underpayments of individual Federal, State or local income taxes and on " +
    "indebtedness used to pay such taxes (within the meaning of §1.163-8T), regardless of the source " +
    "of the income generating the tax liability ... Example. A, an individual, owns stock of an S " +
    "corporation. On its return for 1987, the corporation underreports its taxable income. " +
    "Consequently, A underreports A's share of that income on A's tax return. In 1989, A pays the " +
    "resulting deficiency plus interest to the Internal Revenue Service. The interest paid by A in " +
    "1989 on the tax deficiency is personal interest, notwithstanding the fact that the additional " +
    "tax liability may have arisen out of income from a trade or business. The result would be the " +
    "same if A's business had been operated as a sole proprietorship.",
  soWhat:
    "Read the example again slowly, because the Treasury Department wrote it about you. 'A, an " +
    "individual, owns stock of an S corporation.' The S corporation underreports. A's K-1 is wrong. A " +
    "pays the deficiency plus interest. And the regulation's answer is that the interest is PERSONAL " +
    "interest and NOT deductible — 'notwithstanding the fact that the additional tax liability may " +
    "have arisen out of income from a trade or business.' Note the phrase 'regardless of the source " +
    "of the income' in the rule itself. So if a Greenway audit ever pushes income onto your 1040 and " +
    "you pay interest on that, the interest is dead money: not deductible on the 1040, not deductible " +
    "at Greenway. That is a different answer from the interest on a late payroll or excise deposit, " +
    "which is why this system classifies every interest charge by WHICH TAX it relates to instead of " +
    "dumping them all in one account.",
  source: "https://www.law.cornell.edu/cfr/text/26/1.163-9T",
};

export const REG_1_163_9T_BUSINESS_CARVEOUT: GuidanceAuthority = {
  id: "treas-reg-1-163-9t-business-tax-carveout",
  kind: "regulation",
  cite: "Treas. Reg. § 1.163-9T(b)(2)(iii)(A)",
  quote:
    "Certain other taxes. Personal interest does not include interest— (A) Paid with respect to " +
    "sales, excise and similar taxes that are incurred in connection with a trade or business or an " +
    "investment activity",
  soWhat:
    "This is the other half of the split, and it is good news. Interest on a late SALES tax, a late " +
    "cannabis EXCISE tax, a late payroll deposit, a late L&I premium — those are 'sales, excise and " +
    "similar taxes ... incurred in connection with a trade or business,' so that interest is NOT " +
    "personal interest and it stays deductible. Put the two regulations side by side and you get " +
    "three different answers on a single agency notice: the tax is deductible, the penalty is not, " +
    "and the interest depends entirely on which tax was late. One 'penalties and interest' account " +
    "gets that wrong in two directions simultaneously. One caveat that is not this regulation's " +
    "fault: at the Greenway entity §280E then disallows the deductible half anyway because it is not " +
    "cost of goods sold. That is a separate switch in a separate layer — the ATM and the landholding " +
    "activity are not cannabis businesses, so for those the deduction is real. Same statute, " +
    "different answer per entity, which is precisely why the engine reports the classification and " +
    "lets the §280E layer act on it rather than pre-collapsing the two questions into one.",
  source: "https://www.law.cornell.edu/cfr/text/26/1.163-9T",
};

/**
 * ⭐ The interaction nearly every penalty calculator on the internet gets
 * wrong, including some commercial ones.
 */
export const IRC_6651_C1_INTERACTION: GuidanceAuthority = {
  id: "irc-6651-c-1-file-pay-interaction",
  kind: "statute",
  cite: "26 U.S.C. § 6651(a)(2), (c)(1)",
  quote:
    "(a)(2) ... there shall be added to the amount shown as tax on such return 0.5 percent of the " +
    "amount of such tax if the failure is for not more than 1 month, with an additional 0.5 percent " +
    "for each additional month or fraction thereof during which such failure continues, not exceeding " +
    "25 percent in the aggregate ... (c)(1) With respect to any return, the amount of the addition " +
    "under paragraph (1) of subsection (a) shall be reduced by the amount of the addition under " +
    "paragraph (2) of subsection (a) for any month (or fraction thereof) to which an addition to tax " +
    "applies under both paragraphs (1) and (2).",
  soWhat:
    "If you file late AND pay late in the same month, the combined federal bite is 5.0 percent, NOT " +
    "5.5 percent. The failure-to-file 5% is expressly REDUCED by the failure-to-pay 0.5%, so the " +
    "month costs 4.5% + 0.5%. Adding the two published schedules together — which is the obvious " +
    "thing to do and what most calculators do — overstates the penalty by ten percent of itself every " +
    "single month it runs. We implement the offset and there is a specific test that fails if anyone " +
    "ever 'simplifies' it back to a sum. A related point worth knowing: the two caps are separate " +
    "25% ceilings, not one shared 25%, so a very long delinquency can reach 47.5% of the tax in " +
    "additions alone before a dollar of interest.",
  source: "https://www.law.cornell.edu/uscode/text/26/6651",
};

// ---------------------------------------------------------------------------
// 5) WA CARES — from the authoritative documents Michael uploaded 2026-08-20
//
// Extracted from the agency's own FAQ toolkit PDF ("Updated Aug. 18, 2026"),
// text at /workspace/evidence-books-16/wacares-faq.txt. Kind is state_manual:
// an agency FAQ is the department telling you what it will do, which is worth
// knowing and is not law. Ranked accordingly (persuasive, weight 1).
// ---------------------------------------------------------------------------

/**
 * ⭐ DIRECTLY ON POINT FOR MICHAEL. He is the 85% shareholder, an officer, and
 * on payroll. There is no owner exemption.
 */
export const WA_CARES_OFFICERS_ARE_EMPLOYEES: GuidanceAuthority = {
  id: "wa-cares-corporate-officers-are-employees",
  kind: "state_manual",
  cite: "WA Cares Fund toolkit — Frequently asked questions (Updated Aug. 18, 2026), 'Are business owners automatically included in WA Cares?'",
  quote:
    "Business owners who are considered in a 'partnership,' limited liability company, sole " +
    "proprietors or independent contractors are considered self-employed and will need to elect to " +
    "participate. Corporate officers of a corporation (including S corporations), even if they are " +
    "the owner, are paid wages from the company they work for and are considered employees. Premiums " +
    "are assessed on these employees.",
  soWhat:
    "This is about you personally, so read it twice. The first sentence describes owners who get to " +
    "CHOOSE — partnerships, LLC members, sole proprietors, contractors. The second sentence describes " +
    "you: a corporate officer of a corporation, 'including S corporations,' 'even if they are the " +
    "owner,' who is paid wages. You are an employee for WA Cares and 'premiums are assessed on these " +
    "employees.' There is no owner opt-out. The trap here is subtle and it is a Greenway trap " +
    "specifically: Greenway is an LLC by state filing but is TAXED as an S corporation, and you draw " +
    "officer wages. Someone reading only the first sentence would see 'limited liability company' and " +
    "conclude you may elect. Wrong — the tax classification and the officer wages put you squarely in " +
    "the second sentence. Guess wrong and you have under-withheld on every paycheck you have written " +
    "yourself, with interest.",
  source: "https://wacaresfund.wa.gov/toolkit",
};

export const WA_CARES_ONE_REPORT_TWO_PAYMENTS: GuidanceAuthority = {
  id: "wa-cares-one-report-two-payments",
  kind: "state_manual",
  cite: "WA Cares Fund toolkit — Frequently asked questions (Updated Aug. 18, 2026), 'How do employers report premiums?'",
  quote:
    "Employers submit one report to the Employment Security Department for both Paid Leave and WA " +
    "Cares but make two separate payments — one for each program — because each program has a " +
    "separate trust fund. A No Payroll report is required for any quarter where an employer has no " +
    "payroll expenses.",
  soWhat:
    "One report, TWO payments. This is a genuine operational trap and it is exactly the shape of " +
    "mistake you told us you make: you file, you feel finished, and one of the two transfers never " +
    "goes out. The report being accepted does not mean both funds got paid, because Paid Leave and WA " +
    "Cares are legally separate trust funds. So 'did I file' and 'did I pay' are two different " +
    "questions here, and the second one has two answers. Also note the last line: a quarter with no " +
    "payroll still needs a No Payroll report. Silence is not a filing.",
  source: "https://wacaresfund.wa.gov/toolkit",
};

export const WA_CARES_EXEMPTION_TIMING: GuidanceAuthority = {
  id: "wa-cares-exemption-effective-following-quarter",
  kind: "state_manual",
  cite: "WA Cares Fund toolkit — Frequently asked questions (Updated Aug. 18, 2026), 'When will the exemption go into effect?' and 'What if I didn't give my employer a copy of my exemption approval letter?'",
  quote:
    "Exemptions are effective the quarter following approval. The approval letter you'll receive from " +
    "the Employment Security Department will include the date the exemption becomes effective. You " +
    "must provide your approval letter to your employer to prevent premiums from being withheld. ... " +
    "If you don't give your employer a copy of your exemption approval letter, they will withhold WA " +
    "Cares premiums from your wages. You will not be entitled to a refund of your premiums, and we " +
    "cannot count these hours or wages toward qualification.",
  soWhat:
    "Two rules that protect YOU as the employer. First, an exemption starts the quarter AFTER " +
    "approval, never retroactively — so an employee waving an approval letter mid-quarter does not " +
    "let you stop withholding today. Second, and this is the one that ends arguments: until the " +
    "employee hands you the letter, you keep withholding, and 'you will not be entitled to a refund.' " +
    "That is the state telling you in writing that you were right to withhold. The system therefore " +
    "requires the approval letter on file with its effective date before it will stop the deduction " +
    "for anyone, and it refuses to backdate. Worth telling any exempt employee out loud, because the " +
    "money is genuinely gone and they will ask you for it, not the state.",
  source: "https://wacaresfund.wa.gov/toolkit",
};

export const WA_CARES_CONDITIONAL_90_DAYS: GuidanceAuthority = {
  id: "wa-cares-conditional-exemption-90-days",
  kind: "state_manual",
  cite: "WA Cares Fund toolkit — Frequently asked questions (Updated Aug. 18, 2026), 'What happens if I no longer qualify for my conditional exemption?'",
  quote:
    "If your situation changes and you no longer qualify for a conditional exemption, you must notify " +
    "both the Employment Security Department and your employer(s) within 90 days. You will begin " +
    "paying premiums and earning coverage for WA Cares Fund benefits the first day of the next " +
    "quarter after your exemption is discontinued. ... If you fail to notify the Employment Security " +
    "Department and your employer(s) within 90 days, you will be assessed the balance of your unpaid " +
    "premiums with interest at the rate of 1% per month.",
  soWhat:
    "Conditional exemptions — out-of-state workers, military spouses, temporary visa holders — expire " +
    "when the condition does, and the clock to tell you is 90 days. Miss it and the unpaid premiums " +
    "come back with 1% per month interest, the same monthly rate Employment Security charges on late " +
    "unemployment contributions. The exposure lands on the employee here rather than on you, but the " +
    "practical burden is yours: you are the one who has to start withholding again on the first day " +
    "of the right quarter. That means a conditional exemption is not a set-and-forget flag in a " +
    "payroll file — it needs a review date attached to it, which is another item for the alerting " +
    "work you asked for next.",
  source: "https://wacaresfund.wa.gov/toolkit",
};

// ---------------------------------------------------------------------------
// 6) THE REGISTRY
// ---------------------------------------------------------------------------

/**
 * Every authority this slice introduced, grouped the way a human would read
 * them: state agency first (nearest to daily operations), then the federal
 * deductibility question, then WA Cares.
 */
export const TAX_PENALTY_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  // Washington Department of Revenue
  RCW_82_32_090_DOR_LATE,
  RCW_82_32_090_8_STACKING,
  RCW_82_32_050_DOR_INTEREST,
  RCW_82_32_050_INTENT,
  // Washington Liquor and Cannabis Board
  RCW_69_50_535_EXCISE_TRUST,
  WAC_314_55_089_DUE_DATE,
  WAC_314_55_092_LCB_LATE,
  WAC_314_55_089_CASH_PENALTY,
  // how time is counted, and when a penalty can be forgiven
  RCW_1_12_040_TIME,
  RCW_50_12_220_6_WAIVER,
  // federal: is it deductible?
  IRC_162_F_PENALTIES,
  IRC_163_H_PERSONAL_INTEREST,
  REG_1_163_9T_PERSONAL,
  REG_1_163_9T_BUSINESS_CARVEOUT,
  IRC_6651_C1_INTERACTION,
  // WA Cares, from the documents Michael uploaded
  WA_CARES_OFFICERS_ARE_EMPLOYEES,
  WA_CARES_ONE_REPORT_TWO_PAYMENTS,
  WA_CARES_EXEMPTION_TIMING,
  WA_CARES_CONDITIONAL_90_DAYS,
] as const;

/** Look up one authority introduced by this slice. Undefined, never a throw. */
export function findTaxPenaltyAuthority(id: string): GuidanceAuthority | undefined {
  return TAX_PENALTY_AUTHORITIES_NEW.find((a) => a.id === id);
}

/**
 * Ids that tax-penalty-core.ts is allowed to cite but which live in OTHER
 * registries (payroll, mostly, from books-13 and books-15). Listed explicitly
 * so the wiring test can tell the difference between "cites a record in another
 * module" — fine — and "cites a record that exists nowhere" — a defect.
 *
 * Every id here was verified present in payroll-tax-authorities.ts during
 * books-16. If one is ever removed there, the wiring test fails here, which is
 * the entire point of writing them down instead of assuming.
 */
export const AUTHORITY_IDS_OWNED_ELSEWHERE: readonly string[] = [
  "rcw-50-12-220-esd-late-penalty",
  "rcw-50-24-040-esd-interest",
  "rcw-51-48-210-lni-late-penalty",
  "rcw-51-16-150-lni-injunction",
  "irc-6656-deposit-penalty",
  "irc-6651-failure-to-file",
  "irc-7501-trust-fund-payroll",
] as const;
