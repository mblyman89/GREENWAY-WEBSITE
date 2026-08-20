/**
 * src/lib/accounting/cogs-position-authorities.ts   (slice books-20)
 *
 * THE LAW BEHIND THE COST OF GOODS SOLD POSITION, AND BEHIND CHANGING IT.
 *
 * WHY THIS MODULE EXISTS, STATED PLAINLY.
 *
 * Michael has told this system, in writing and with his eyes open, that he
 * intends to keep classifying costs into COGS the way his grandfather has done
 * it for twelve years. He is entitled to make that call: standing rule 28 gives
 * the owner executive authority over his own return, and a bookkeeping system
 * that refuses to run because it disagrees with its owner is a system he will
 * simply stop using.
 *
 * But rule 28 has never meant that the system agrees. Michael also asked, in
 * the same breath, for "verbatim text that strongly suggests I follow proper
 * code conduct, and tells me why and how to do it properly by law," and said
 * he wants the system to "properly and aggressively tell me to do it the right
 * way and help me do it the right way."
 *
 * So this module is the aggressive half of that bargain. It is the actual
 * words of the actual law, pulled from actual government sources that are
 * mirrored in this repository so every quote below can be verified by machine
 * rather than trusted because someone typed carefully.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * The reseller-versus-producer authorities already exist. §1.471-3(b), (c) and
 * (f), §280E, the 1982 Senate Report, Harborside, Alterman, CHAMP and the rest
 * were registered by the payroll-COGS and vendor-bill slices, and standing rule
 * 2 forbids declaring a second copy of a citation that already has one. What
 * books-20 adds is the machinery NOBODY explains to small business owners: that
 * a wrong way of doing things, repeated long enough, stops being a mistake you
 * can quietly stop making and becomes a METHOD OF ACCOUNTING with a legal
 * procedure attached to leaving it.
 *
 * THE ONE THING TO READ IF YOU READ NOTHING ELSE.
 *
 * `REVPROC_2015_13_AUDIT_PROTECTION`. The intuition every owner has — that
 * filing a form to correct yourself is waving a flag at the IRS — is backwards.
 * Filing the form is what makes the IRS agree not to reach into your closed
 * years on that issue. Doing nothing is what leaves them open. That single
 * paragraph is the strongest argument for doing this properly, and it is an
 * argument from self-interest, not from virtue.
 */

import type { GuidanceAuthority } from "./books-guidance-core";

/**
 * Authorities new to books-20.
 *
 * Every `quote` here is an exact substring of a source text mirrored under
 * `docs/authorities/`, after whitespace normalisation, and is proven so by
 * `scripts/verify-verbatim-quotes.ts`. Nothing in this array was typed from
 * memory or from a secondary summary.
 */
export const COGS_POSITION_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  // -------------------------------------------------------------------------
  // 1) YOU MAY NOT SIMPLY STOP. THE STATUTE.
  // -------------------------------------------------------------------------
  {
    id: "IRC_446_E_CONSENT_REQUIRED",
    kind: "statute",
    cite: "26 U.S.C. §446(e)",
    quote:
      "Except as otherwise expressly provided in this chapter, a taxpayer who changes the method of " +
      "accounting on the basis of which he regularly computes his income in keeping his books shall, " +
      "before computing his taxable income under the new method, secure the consent of the Secretary.",
    soWhat:
      "Read the word BEFORE. This is the sentence that kills the plan everybody has, which is 'we will just " +
      "start doing it right next year and not mention the old years.' You are not allowed to change how you " +
      "compute income and then tell the IRS about it on the return. Consent comes first. In practice consent " +
      "for most changes is automatic and is obtained by filing Form 3115 with a timely return, so this is a " +
      "procedure and not a permission slip you might be denied — but it is a procedure you must actually " +
      "follow, and skipping it is its own separate problem on top of whatever you were fixing.",
    source: "26 U.S.C. §446(e). Mirrored at docs/authorities/federal/usc-446.txt.",
  },
  {
    id: "IRC_446_F_NO_SHELTER",
    kind: "statute",
    cite: "26 U.S.C. §446(f)",
    quote:
      "If the taxpayer does not file with the Secretary a request to change the method of accounting, the " +
      "absence of the consent of the Secretary to a change in the method of accounting shall not be taken " +
      "into account— (1) to prevent the imposition of any penalty, or the addition of any amount to tax, " +
      "under this title, or (2) to diminish the amount of such penalty or addition to tax.",
    soWhat:
      "Congress saw the clever argument coming and closed it in 1984. The argument was: 'I never got consent " +
      "to change, so my change never legally happened, so you cannot penalise me for it.' Subsection (f) says " +
      "that not asking gets you nothing — no shield, and not even a discount on the penalty. Put (e) and (f) " +
      "together and the shape is clear: not filing is not a neutral act of caution. It is the one path with " +
      "no protection at either end.",
    source: "26 U.S.C. §446(f), added by Pub. L. 98-369. Mirrored at docs/authorities/federal/usc-446.txt.",
  },

  // -------------------------------------------------------------------------
  // 2) "BUT MY METHOD IS WRONG, SO SURELY I CAN JUST STOP." NO. THE REGULATION.
  // -------------------------------------------------------------------------
  {
    id: "REG_1_446_1_E_2_I_PROPER_OR_NOT",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(e)(2)(i)",
    quote:
      "a taxpayer who changes the method of accounting employed in keeping his books shall, before computing " +
      "his income upon such new method for purposes of taxation, secure the consent of the Commissioner. " +
      "Consent must be secured whether or not such method is proper or is permitted under the Internal " +
      "Revenue Code or the regulations thereunder.",
    soWhat:
      "This is the single most important sentence in the whole slice, and it is the one that surprises " +
      "everybody. The second sentence says consent is required WHETHER OR NOT THE OLD METHOD WAS PROPER. So " +
      "the fact that a method is wrong does not give you the right to walk away from it unilaterally. It is " +
      "genuinely counter-intuitive: being wrong does not free you, it binds you to a procedure. This is why " +
      "'we will quietly clean it up next year' is not available to you as an option.",
    source:
      "26 C.F.R. §1.446-1(e)(2)(i). Mirrored at docs/authorities/federal/cfr-1.446-1.txt.",
  },
  {
    id: "REG_1_446_1_E_2_II_A_IS_A_METHOD",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(e)(2)(ii)(a)",
    quote:
      "A change in the method of accounting includes a change in the overall plan of accounting for gross " +
      "income or deductions or a change in the treatment of any material item used in such overall plan. " +
      "Although a method of accounting may exist under this definition without the necessity of a pattern of " +
      "consistent treatment of an item, in most instances a method of accounting is not established for an " +
      "item without such consistent treatment.",
    soWhat:
      "This tells you whether your situation is a METHOD (needs Form 3115) or an ERROR (just fix it). The " +
      "hinge is consistent treatment of a material item. Twelve straight years of classifying the same kinds " +
      "of cost the same way is about as consistent as treatment gets, so the honest reading is that your " +
      "grandfather's approach is a method, not a slip. That is not a criticism of him — it is a description " +
      "of which door you have to walk through to change it. A one-off miscoding in March would be an error " +
      "and you would simply correct it.",
    source:
      "26 C.F.R. §1.446-1(e)(2)(ii)(a). Mirrored at docs/authorities/federal/cfr-1.446-1.txt.",
  },
  {
    id: "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(e)(2)(ii)(a) (inventory clause)",
    quote:
      "Changes in method of accounting include a change from the cash receipts and disbursement method to an " +
      "accrual method, or vice versa, a change involving the method or basis used in the valuation of " +
      "inventories (see sections 471 and 472 and the regulations under sections 471 and 472)",
    soWhat:
      "Here is the same regulation naming your exact situation out loud. What goes into the cost of inventory " +
      "IS the valuation of inventories, and changing it IS listed by name as a change in method of " +
      "accounting. So there is no room to argue that moving costs in or out of COGS is merely a " +
      "reclassification or a bookkeeping tidy-up. The regulation put it on the list.",
    source:
      "26 C.F.R. §1.446-1(e)(2)(ii)(a). Mirrored at docs/authorities/federal/cfr-1.446-1.txt.",
  },

  // -------------------------------------------------------------------------
  // 3) WHAT IT COSTS TO CORRECT. §481(a) AND ITS ARITHMETIC.
  // -------------------------------------------------------------------------
  {
    id: "IRC_481_A_ADJUSTMENT",
    kind: "statute",
    cite: "26 U.S.C. §481(a)",
    quote:
      "In computing the taxpayer's taxable income for any taxable year (referred to in this section as the " +
      "\"year of the change\")— (1) if such computation is under a method of accounting different from the " +
      "method under which the taxpayer's taxable income for the preceding taxable year was computed, then " +
      "(2) there shall be taken into account those adjustments which are determined to be necessary solely " +
      "by reason of the change in order to prevent amounts from being duplicated or omitted",
    soWhat:
      "This is the true-up, and understanding it removes most of the fear. When you change methods you do " +
      "NOT go back and amend twelve years of returns. Instead you compute one number — the cumulative " +
      "difference between what you did and what you should have done — and you put that single number on the " +
      "return for the year you change. The purpose is stated right in the text: so that no dollar gets " +
      "counted twice and no dollar falls through the cracks. One number, one year, one form.",
    source: "26 U.S.C. §481(a). Mirrored at docs/authorities/federal/usc-481.txt.",
  },
  {
    id: "REVPROC_2015_13_ADJUSTMENT_PERIOD",
    kind: "irs_guidance",
    cite: "Rev. Proc. 2015-13, §7.03(1)",
    quote:
      "the § 481(a) adjustment period is one taxable year (year of change) for a negative § 481(a) " +
      "adjustment and four taxable years (year of change and next three taxable years) for a positive " +
      "§ 481(a) adjustment",
    soWhat:
      "The asymmetry here is in your favour and it is worth understanding before you decide anything. If the " +
      "true-up goes AGAINST you — meaning correcting the method increases your taxable income — you get to " +
      "spread that pain over four years, a quarter at a time. If it goes IN YOUR FAVOUR you take the whole " +
      "benefit immediately in one year. The rule is deliberately built to make correcting yourself " +
      "affordable. Nobody is trying to bankrupt you for fixing your books.",
    source:
      "Rev. Proc. 2015-13, 2015-5 I.R.B. 419, §7.03(1). Mirrored at " +
      "docs/authorities/federal/revproc-2015-13.txt.",
  },
  {
    id: "REVPROC_2015_13_DE_MINIMIS",
    kind: "irs_guidance",
    cite: "Rev. Proc. 2015-13, §7.03(3)(c)",
    quote:
      "De minimis election. A taxpayer may elect a one-year § 481(a) adjustment period (year of change) for " +
      "a positive § 481(a) adjustment that is less than $50,000. To make this election, the taxpayer must " +
      "complete the appropriate line on the Form 3115 and take the entire § 481(a) adjustment into account " +
      "in the year of change when it implements the change in method of accounting.",
    soWhat:
      "An option, not an obligation, and for a business Greenway's size it may well be the practical one. If " +
      "the whole cumulative true-up comes in under $50,000 you may simply take it all in one year and be " +
      "completely finished, rather than carrying a schedule for four years and having to remember it every " +
      "January. Whether that is smart depends on your income in the change year — this system will show you " +
      "the number, and that is a conversation to have with your grandfather once the number exists.",
    source:
      "Rev. Proc. 2015-13, 2015-5 I.R.B. 419, §7.03(3)(c). Mirrored at " +
      "docs/authorities/federal/revproc-2015-13.txt.",
  },

  // -------------------------------------------------------------------------
  // 4) THE ARGUMENT THAT ACTUALLY MATTERS: PROTECTION FOR THE OLD YEARS.
  // -------------------------------------------------------------------------
  {
    id: "REVPROC_2015_13_AUDIT_PROTECTION",
    kind: "irs_guidance",
    cite: "Rev. Proc. 2015-13, §8.01",
    quote:
      "In general. Except as provided in SECTION 8.02 or under any other guidance published in the IRB, when " +
      "a taxpayer timely files a Form 3115 under this revenue procedure, the IRS will not require the " +
      "taxpayer to change its method of accounting for the same item for a taxable year prior to the " +
      "requested year of change.",
    soWhat:
      "READ THIS TWICE. It is the exact opposite of what instinct says. Instinct says filing a form is " +
      "raising your hand and inviting scrutiny of the past. The actual rule is that filing the form is what " +
      "makes the IRS agree NOT to go back and change that item in your earlier years. Your current position " +
      "— saying nothing — is the one that leaves every open year exposed on this issue for as long as it " +
      "stays open. The correction is not the risky path. Staying put is. If a single sentence in this system " +
      "changes your mind about how to handle the COGS question, it should be this one.",
    source:
      "Rev. Proc. 2015-13, 2015-5 I.R.B. 419, §8.01. Mirrored at " +
      "docs/authorities/federal/revproc-2015-13.txt.",
  },
  {
    id: "REVPROC_2015_13_PROTECTION_LOST_IF_UNDER_EXAM",
    kind: "irs_guidance",
    cite: "Rev. Proc. 2015-13, §8.02(1)",
    quote:
      "No audit protection for taxpayers under examination. Except as provided in SECTIONS 8.02(1)(a) " +
      "through (f), the IRS may require the taxpayer to change its method of accounting for the same item " +
      "that is the subject of a Form 3115 filed under this revenue procedure for taxable years prior to the " +
      "requested year of change if the taxpayer is under examination as of the date the taxpayer files the " +
      "Form 3115.",
    soWhat:
      "This is the clock on the protection above, and it is why timing is not a detail. The shield in §8.01 " +
      "is available to a taxpayer who is NOT under examination. Once an examination opens, it is largely " +
      "gone. You mentioned the IRS has contacted you several times about other issues over the years and has " +
      "never raised COGS. Every one of those contacts was a moment when this door could have closed. The " +
      "protection is not a permanent feature of the landscape — it is something you currently have and could " +
      "lose in a single piece of mail, without warning, on a Tuesday.",
    source:
      "Rev. Proc. 2015-13, 2015-5 I.R.B. 419, §8.02(1). Mirrored at " +
      "docs/authorities/federal/revproc-2015-13.txt.",
  },
  {
    id: "REVPROC_2015_13_PROTECTION_NOT_UNIVERSAL",
    kind: "irs_guidance",
    cite: "Rev. Proc. 2015-13, §8.02(2)",
    quote:
      "Change lacking audit protection. The IRS may change a taxpayer's method of accounting for the same " +
      "item that is the subject of a Form 3115 filed under this revenue procedure for taxable years prior to " +
      "the requested year of change if the description of the change in the List of Automatic Changes, or " +
      "other guidance published in the IRB, provides that the change is not subject to the audit protection " +
      "provisions of SECTION 8.01.",
    soWhat:
      "Presented here so that nobody oversells §8.01 to you, including this system. Audit protection is the " +
      "general rule, not a guarantee: some specific automatic changes are published WITHOUT it, and you only " +
      "learn which by reading the description of the particular change in the current List of Automatic " +
      "Changes at the time you file. That is a question for whoever signs the Form 3115, and it is the " +
      "reason this system tells you to ask it rather than promising you an answer it cannot know in advance.",
    source:
      "Rev. Proc. 2015-13, 2015-5 I.R.B. 419, §8.02(2). Mirrored at " +
      "docs/authorities/federal/revproc-2015-13.txt.",
  },

  // -------------------------------------------------------------------------
  // 5) THE ARGUMENT ON MICHAEL'S SIDE. IT IS REAL AND IT IS QUOTED IN FULL.
  // -------------------------------------------------------------------------
  {
    id: "REG_1_471_2_A_TWO_TESTS",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(a)",
    quote:
      "Section 471 provides two tests to which each inventory must conform: (1) It must conform as nearly as " +
      "may be to the best accounting practice in the trade or business, and (2) It must clearly reflect the " +
      "income.",
    soWhat:
      "The bar an inventory has to clear, and notice that it is two tests joined by AND, not a menu. Matching " +
      "what everyone else in the trade does is not enough on its own if the result does not clearly reflect " +
      "income. And clearly reflecting income is judged by the Commissioner, not by the taxpayer and not by " +
      "the taxpayer's accountant.",
    source: "26 C.F.R. §1.471-2(a). Mirrored at docs/authorities/federal/cfr-1.471-2.txt.",
  },
  {
    id: "REG_1_471_2_B_CONSISTENCY_WEIGHT",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(b)",
    quote:
      "In order to clearly reflect income, the inventory practice of a taxpayer should be consistent from " +
      "year to year, and greater weight is to be given to consistency than to any particular method of " +
      "inventorying or basis of valuation so long as the method or basis used is in accord with §§ 1.471-1 " +
      "through 1.471-11.",
    soWhat:
      "This one cuts YOUR way and you are entitled to know it exists. The regulation itself says consistency " +
      "gets greater weight than any particular method. Twelve unbroken years is exactly the consistency it " +
      "is talking about, and that is a real argument, not a fig leaf. But read the last clause, because it " +
      "is the whole condition: the protection applies SO LONG AS the method used is in accord with §§1.471-1 " +
      "through 1.471-11 — and §1.471-3 is inside that range. Consistency shelters a permissible method " +
      "chosen among alternatives. It does not launder a method the regulations do not allow in the first " +
      "place. That is the honest reading, and you should hear it from your own software rather than from an " +
      "examiner.",
    source: "26 C.F.R. §1.471-2(b). Mirrored at docs/authorities/federal/cfr-1.471-2.txt.",
  },
  {
    id: "REG_1_471_1_A_INVENTORIES_REQUIRED",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-1(a)",
    quote:
      "in order to reflect taxable income correctly, inventories at the beginning and end of each taxable " +
      "year are necessary in every case in which the production, purchase, or sale of merchandise is an " +
      "income-producing factor",
    soWhat:
      "Why Form 1125-A begins and ends with an inventory figure at all. Greenway buys and sells merchandise, " +
      "so inventories are not optional and the beginning and ending numbers are not estimates you may " +
      "smooth. Line 1 and line 7 of that form are the two ends of a physical fact, which is exactly why this " +
      "system ties them to counted quantities rather than to a plug.",
    source: "26 C.F.R. §1.471-1(a). Mirrored at docs/authorities/federal/cfr-1.471-1.txt.",
  },

  // -------------------------------------------------------------------------
  // 6) WHY GREENWAY CANNOT BE A PRODUCER. STATE LAW, NOT OPINION.
  // -------------------------------------------------------------------------
  {
    id: "RCW_69_50_328_NO_CROSS_OWNERSHIP",
    kind: "state_law",
    cite: "RCW 69.50.328",
    quote:
      "Neither a licensed cannabis producer nor a licensed cannabis processor shall have a direct or " +
      "indirect financial interest in a licensed cannabis retailer.",
    soWhat:
      "This settles the reseller-or-producer question for Greenway as a matter of law rather than as a " +
      "judgment call, and it settles it permanently. The generous producer rules in §1.471-3(c) — the ones " +
      "that allow direct labour and production overhead into inventory — are available only to a taxpayer " +
      "who actually produces. Washington forbids a retail licensee from having any interest in production. " +
      "So Greenway is not a producer, cannot become one while it holds a retail licence, and the reseller " +
      "paragraph §1.471-3(b) is the only one available to it. Any adviser who suggests otherwise has not " +
      "read this statute.",
    source:
      "RCW 69.50.328 (2022 c 16 s 57; 2013 c 3 s 5, Initiative Measure No. 502). Mirrored at " +
      "docs/authorities/state-wa/rcw-69.50.328.txt.",
  },
];
