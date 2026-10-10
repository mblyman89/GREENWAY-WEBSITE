/**
 * src/lib/payments/vendor-esign-terms.ts  (R39 S7, PURE, GENERATED)
 *
 * The exact words of vendor form GW-ACH-V (Rev. 10/2026 v1.0): the intro, Part 3
 * (credit-only authorization), Part 4 (WAC 314-55-115 verbatim), Part 5 terms
 * and the Part 6 certification, extracted from the form source
 * (/workspace/ach/vendor-fillable.html, outside the repo) by
 * scripts/r39/gen-vendor-esign-terms.py. Do not edit by hand: a change to the
 * terms is a new form revision, and ACH_V_TERMS_SHA256 pins this one
 * (tests/compliance/r39-vendor-esign-core.test.ts recomputes it).
 */
export type VendorTermsPara = { k: "h" | "p"; t: string };
export type VendorFormTerms = {
  formId: string;
  formRev: string;
  intro: string;
  part3: readonly string[];
  wac: readonly string[];
  wacMeans: string;
  terms: readonly VendorTermsPara[];
  certification: string;
  acceptance: string;
};

export const ACH_V_TERMS: VendorFormTerms = {
  "formId": "GW-ACH-V",
  "formRev": "Rev. 10/2026 v1.0",
  "intro": "Use this form to authorize Greenway Marijuana to pay your invoices by direct deposit (ACH credit) to your business bank account. It is also the written EFT agreement required before any cannabis payment is made electronically (WAC 314-55-115(3)(b)). ACH is optional. Paper check remains available, and no vendor is disadvantaged for choosing checks.",
  "part3": [
    "This form lets Greenway send money to you. It never lets anyone take money from Greenway's account or from yours. Greenway will never ask you to change bank details by email or to send money to Greenway. Verify anything unusual by phoning one of the numbers on page 1.",
    "By signing in Part 6, Vendor authorizes Lyman's Marijuana d/b/a Greenway Marijuana to initiate credit entries for amounts due on Vendor's invoices to the account in Part 2, and authorizes Vendor's bank to deposit them. This authorization stays in effect until revoked or terminated under Section 13 of the Terms. It does not authorize any debit.",
    "Greenway never debits your account. Only a narrow reversal of an erroneous entry is permitted (Terms §10).",
    "No one can pull money from Greenway. You get no debit access to any Greenway account.",
    "Greenway releases each payment personally, after dual-control checks on any new or changed account."
  ],
  "wac": [
    "A cannabis licensee must pay cash for cannabis prior to or at the time of delivery. The LCB will recognize the following forms of payment as cash payment for the purpose of this section.",
    "(1) Checks, under the following provisions:",
    "(a) A sale must be initiated by an irrevocable invoice or sale order before or at the time of delivery.",
    "(b) Both parties must maintain records of transactions, including relevant proof of mailing, and have the records readily available for the LCB review.",
    "(c) The check must be sent, delivered, or mailed by the cannabis licensee no later than the first business day following delivery and must be deposited as promptly as is reasonably practical, and in no event later than five business days following delivery. Any attempt by a cannabis licensee to delay payment on checks for any period of time beyond the minimum as is reasonably practical will be considered an unlawful attempt to purchase products on credit.",
    "[subsection (2), credit/debit cards, omitted as not applicable to this Agreement]",
    "(3) Electronic funds transfer (EFT), under the following provisions:",
    "(a) The EFT agreement must be voluntary on the part of both the licensees, and there must be no discrimination for nonparticipation in EFT.",
    "(b) Prior to any EFT transaction, the cannabis licensee must enter into a written agreement specifying the terms and conditions for EFT as payment for cannabis.",
    "(c) A sale must be initiated by an irrevocable invoice or sale order before or at the time of delivery.",
    "(d) Both parties must bear their respective banking costs or other costs associated with EFT service.",
    "(e) Both parties must maintain records of transactions and have the records readily available for the LCB review.",
    "(f) The electronic funds transfer must be initiated by the cannabis licensee no later than the first business day following delivery and must be paid as promptly as is reasonably practical, and in no event later than five business days following delivery. Any attempt by a cannabis licensee to delay payment on EFT transactions for any period of time beyond the minimum as is reasonably practical will be considered an unlawful attempt to purchase products on credit.",
    "[subsections (4) and (5), prepaid accounts and money transmitters, omitted as not applicable to this Agreement]",
    "(6) Any transaction reported as having nonsufficient funds (NSF) will be considered an extension of credit. If a transaction is reported as NSF:",
    "(a) The purchaser must pay the full amount of the transaction to the seller by 3:00 p.m. on the first business day following receipt of the NSF report.",
    "(b) Until the NSF transaction is paid: (i) The cannabis licensee who received the NSF transaction will not deliver any cannabis to the purchaser; and (ii) It is the responsibility of the purchaser to not receive additional cannabis from any other cannabis licensee.",
    "(7) As used in this section, \"delivery\" refers to delivery of cannabis.",
    "(8) All records must be kept and maintained consistent with WAC 314-55-087.",
    "Source: Washington Administrative Code, apps.leg.wa.gov/WAC/default.aspx?cite=314-55-115 (Statutory Authority: RCW 69.50.342 and 69.50.345; WSR 24-20-055, effective 10/26/24). Bracketed notes mark omitted subsections only; all quoted text is unaltered. If the WAC is later amended, the amended rule controls."
  ],
  "wacMeans": "(1) Keep your account details current and tell us at least 5 business days before a change. (2) If your information is on hold or unverified when we receive goods, we pay by paper check on the same legal clock, so you are never paid late. (3) Greenway does not treat the \"24 hours\" practice as a different legal rule; the legal deadlines above always govern.",
  "terms": [
    {
      "k": "p",
      "t": "The following terms are part of this Agreement. Please read them before signing. You may keep a copy. Cross-references to \"Section\" are to these Terms."
    },
    {
      "k": "h",
      "t": "1. Parties, Definitions and Scope"
    },
    {
      "k": "p",
      "t": "1.1 This Vendor Payment Authorization and Electronic Funds Transfer Agreement (the \"Agreement\") is between Lyman's Marijuana d/b/a Greenway Marijuana, a retail licensee of the Washington State Liquor and Cannabis Board (WSLCB License No. 413541) (\"Greenway\"), and the vendor identified in Part 1 (\"Vendor\"). It takes effect on the date Greenway countersigns after completing its internal verification and dual approval (the \"Effective Date\")."
    },
    {
      "k": "p",
      "t": "1.2 \"ACH\" means the Automated Clearing House network. \"Nacha Rules\" means the Nacha Operating Rules and Guidelines as in effect from time to time. \"Entry\" means a single ACH credit to the Account. \"Account\" means the Vendor deposit account in Part 2. \"Business Day\" means a day other than a Saturday, Sunday or day on which the Federal Reserve Banks or Greenway's bank are closed. \"Invoice\" includes any sale order. \"LCB\" means the Washington State Liquor and Cannabis Board."
    },
    {
      "k": "p",
      "t": "1.3 This Agreement governs only the method of payment. It does not change any price, quantity, product, delivery or return term in an Invoice or in any separate supply agreement, which remain in force."
    },
    {
      "k": "h",
      "t": "2. Voluntary Participation; No Discrimination"
    },
    {
      "k": "p",
      "t": "Participation is voluntary for both parties. Greenway has paid, and will continue to pay, Vendor by paper check unless Vendor elects ACH. No Vendor will be treated less favorably in pricing, ordering, delivery, scheduling or any other dealing for declining or ending ACH participation (WAC 314-55-115(3)(a))."
    },
    {
      "k": "h",
      "t": "3. Irrevocable Invoice or Sale Order"
    },
    {
      "k": "p",
      "t": "For each sale of cannabis paid under this Agreement, the sale is initiated by an irrevocable Invoice or sale order issued before or at the time of delivery (WAC 314-55-115(3)(c)). Greenway pays against the Invoice; Vendor will not treat an Entry as a payment of any amount not shown on a valid Invoice."
    },
    {
      "k": "h",
      "t": "4. Authorization; Credit-Only"
    },
    {
      "k": "p",
      "t": "4.1 Vendor authorizes Greenway to initiate credit Entries only to the Account, in amounts due on Invoices, using the corporate credit or debit (CCD) format of the Nacha Rules, and authorizes the financial institution holding the Account to post those Entries."
    },
    {
      "k": "p",
      "t": "4.2 Greenway will not initiate any ACH debit to the Account to collect money from Vendor. The only exception is a limited reversing Entry for an erroneous Entry, as described in Section 10. Greenway initiates every Entry itself, by manual release by an authorized Greenway signer; Vendor has no authority to initiate, request or schedule any transfer from Greenway's account, and no ACH debit, pull, draft or similar access to any Greenway account is granted by this Agreement or by any Greenway payment. Vendor will not attempt to originate any debit against Greenway; any such attempt is unauthorized."
    },
    {
      "k": "p",
      "t": "4.3 This Agreement grants no authority to any person other than Vendor and Greenway. Greenway will not send Entries to a third party's account (including a factor, assignee, lender, accountant or payment processor) unless Greenway has separately accepted a written direction under Section 7.4."
    },
    {
      "k": "h",
      "t": "5. Timing of Payment"
    },
    {
      "k": "p",
      "t": "5.1 Greenway's standing practice is to initiate payment within twenty-four (24) hours after receiving the goods. This is Greenway's operating commitment and is in addition to, not in place of, the legal requirements below."
    },
    {
      "k": "p",
      "t": "5.2 For cannabis, Greenway will initiate each EFT no later than the first business day following delivery and in no event later than five business days following delivery, as the WAC quoted in Part 4 requires. For non-cannabis goods, WAC 314-55-115 does not apply by its terms; Greenway will follow the same practice unless the Invoice states different payment terms."
    },
    {
      "k": "p",
      "t": "5.3 Greenway controls when an Entry is initiated. Posting and availability of funds are controlled by Vendor's bank and the ACH Operator under the Nacha Rules and Regulation CC, and Greenway is not responsible for delay by them."
    },
    {
      "k": "p",
      "t": "5.4 Paper-check safeguard. If an Entry cannot lawfully or reliably be sent (for example, because verification is incomplete, a change is on hold, the Account is closed, or an Entry is returned), Greenway will pay by paper check, sent, delivered or mailed within the same time limits, so that a payment is never late because of the ACH method."
    },
    {
      "k": "h",
      "t": "6. Costs"
    },
    {
      "k": "p",
      "t": "Each party bears its own banking and other costs of EFT service (WAC 314-55-115(3)(d)). Greenway charges Vendor no fee for ACH payment and will not deduct bank fees from the amount of any Invoice. Vendor's bank may charge Vendor its own fees, which Greenway does not reimburse."
    },
    {
      "k": "h",
      "t": "7. Vendor Representations, Account Accuracy and Ownership"
    },
    {
      "k": "p",
      "t": "7.1 Vendor represents and warrants that: (a) all information on this form is true, complete and current; (b) Vendor owns the Account, which is a business deposit account titled in Vendor's legal or registered trade name; (c) the signer is an owner, officer, member, partner or other person with authority to bind Vendor and to direct where Vendor's payments are sent; and (d) if Vendor is a cannabis producer or processor, it holds an active WSLCB license at the number stated and will notify Greenway immediately of any suspension, revocation or change in licensed status."
    },
    {
      "k": "p",
      "t": "7.2 Vendor will notify Greenway, as stated in Section 8, at least five (5) Business Days before any change to the Account, Vendor's legal name, ownership or authorized contacts, and within two (2) Business Days after learning that the Account is closed, frozen, restricted or unable to receive credits."
    },
    {
      "k": "p",
      "t": "7.3 Account number controls. Greenway and every bank in the transfer may rely on the routing and account numbers on this form, even if the name on the Account differs from the name on the form or Invoice. Under Washington law (RCW 62A.4A-207), a bank may rely on the number alone. Vendor therefore bears the risk of loss from any error in the numbers Vendor supplies, except as stated in Section 18."
    },
    {
      "k": "p",
      "t": "7.4 Greenway does not accept payment instructions that direct funds to any account not owned by Vendor (including assignments, factoring or third-party remittance), unless Vendor and the assignee sign a separate written direction, which Greenway may refuse, and which Greenway will verify under Section 8 before acting on it."
    },
    {
      "k": "h",
      "t": "8. Verification, Changes and Fraud Prevention"
    },
    {
      "k": "p",
      "t": "8.1 Greenway verifies by calling you. Before the first Entry, and before acting on any change, Greenway will verify the request by telephone using a number that Greenway already has on file or has obtained independently (such as the LCB licensee list or a prior Invoice), never solely a number or email address supplied in the request itself. Greenway will confirm the Vendor's authentication detail (the last four digits of Vendor's tax identification number shown in Part 1) and the last four digits of the Account number."
    },
    {
      "k": "p",
      "t": "8.2 Any change to Account information requires a new signed form, verification by callback to a second authorized Vendor contact, and approval by two Greenway signers. Greenway does not act on a change requested only by email, text message or telephone call. A change of Vendor contact information shortly before a change of bank information will receive additional scrutiny."
    },
    {
      "k": "p",
      "t": "8.3 Hold. Greenway may hold the first Entry and any Entry after a change until verification is complete, and may send a small test credit (and require Vendor to confirm the amount). While a hold applies, Greenway will pay by paper check under Section 5.4."
    },
    {
      "k": "p",
      "t": "8.4 Fraud warning. Criminals impersonate vendors and customers to redirect payments. Greenway will never ask Vendor to send money to Greenway, to change Vendor's bank details by email, or to confirm account details in reply to an unsolicited message. Vendor should treat any such message, including one that appears to come from Greenway, as suspicious and call Greenway at a number printed in Part 1 or Section 22. Each party will promptly report suspected fraud or unauthorized activity to the other."
    },
    {
      "k": "h",
      "t": "9. Test Credits"
    },
    {
      "k": "p",
      "t": "Greenway may send one or more credit Entries of one dollar ($1.00) or less to confirm the Account. Any test credit is a payment on account to Vendor, is not recoverable, and will be credited against the next Invoice."
    },
    {
      "k": "h",
      "t": "10. Erroneous Entries and Reversals"
    },
    {
      "k": "p",
      "t": "10.1 Greenway may initiate a reversing Entry, or request the return of funds through its bank, only to correct an Entry that was a duplicate, was sent to the wrong account, was for the wrong amount (more than the Invoice amount), or was made on the wrong date, and only within the time allowed by the Nacha Rules (currently five (5) banking days after the settlement date of the erroneous Entry). Greenway will make a reasonable attempt to notify Vendor of the reversal and the reason no later than the settlement date of the reversing Entry."
    },
    {
      "k": "p",
      "t": "10.2 Vendor authorizes those limited reversing Entries. If a reversal is not possible, Vendor will return any funds received in error, up to the excess amount, within five (5) Business Days after written notice. A reversal is never used to resolve a dispute over price, quantity, quality, returns or credits; those are handled by credit memo or Invoice adjustment."
    },
    {
      "k": "h",
      "t": "11. Returned or Rejected Entries; Closed Accounts"
    },
    {
      "k": "p",
      "t": "If Vendor's bank returns or rejects an Entry, Greenway will pay the Invoice by paper check under Section 5.4, without interest or penalty. Greenway may suspend ACH payment after repeated returns. Greenway is not responsible for any decision by Vendor's bank to refuse, delay, hold or return an Entry, or to close or restrict an account."
    },
    {
      "k": "h",
      "t": "12. Records and Retention"
    },
    {
      "k": "p",
      "t": "12.1 Each party will maintain records of every transaction paid under this Agreement and keep them readily available for LCB review (WAC 314-55-115(3)(e)), consistent with WAC 314-55-087 (five years, on the licensed premises)."
    },
    {
      "k": "p",
      "t": "12.2 Greenway will keep this signed Agreement and related verification records for at least two (2) years after the Agreement is terminated or revoked, as the Nacha Rules require, and longer where other law requires. Vendor authorizes Greenway to provide this Agreement and related records to the LCB, to Greenway's bank and as otherwise required by law."
    },
    {
      "k": "h",
      "t": "13. Term, Revocation and Termination"
    },
    {
      "k": "p",
      "t": "13.1 This Agreement continues until terminated. Vendor may revoke this authorization at any time by signed written notice under Section 22, effective five (5) Business Days after Greenway receives it and verifies it under Section 8, which gives Greenway a reasonable opportunity to act. Greenway may terminate or suspend ACH payment to Vendor on written notice, and immediately if Greenway suspects fraud or an unauthorized change, or if Vendor's WSLCB license is suspended or revoked."
    },
    {
      "k": "p",
      "t": "13.2 On revocation or termination, Greenway will pay by paper check. Revocation does not affect an Entry already initiated or an Invoice already issued, and does not affect any right or obligation arising before it takes effect."
    },
    {
      "k": "h",
      "t": "14. Confidentiality and Data Security"
    },
    {
      "k": "p",
      "t": "14.1 Greenway will use Vendor's bank and tax information only to pay Vendor, verify identity, keep required records and comply with law. Greenway stores banking data in a restricted-access system with encryption at rest, limits access to authorized personnel, holds changes for verification, and does not sell or share the data except with its bank, the ACH Operator, auditors, counsel, regulators (including the LCB) or as law requires."
    },
    {
      "k": "p",
      "t": "14.2 Greenway will dispose of records containing personal financial information by destroying them when no longer retained (RCW 19.215.020), and will give notice of any security breach as required by RCW 19.255.010. Vendor should not email full bank details on an unprotected channel and will protect any credentials and information it receives from Greenway."
    },
    {
      "k": "h",
      "t": "15. Nonsufficient Funds"
    },
    {
      "k": "p",
      "t": "As the WAC quoted in Part 4 provides, a transaction reported as nonsufficient funds (NSF) is treated as an extension of credit. If a Greenway Entry is reported NSF, Greenway will pay the full amount by 3:00 p.m. on the first business day after receiving the NSF report; until it is paid, the Vendor will not deliver cannabis to Greenway, and Greenway will not receive cannabis from any other cannabis licensee (WAC 314-55-115(6))."
    },
    {
      "k": "h",
      "t": "16. No Extension of Credit; Compliance with Law"
    },
    {
      "k": "p",
      "t": "16.1 The parties intend that every payment under this Agreement is a cash-equivalent payment under WAC 314-55-115 and no part of it is an extension of credit. Nothing in this Agreement permits either party to delay payment, and no term extends credit."
    },
    {
      "k": "p",
      "t": "16.2 Each party will comply with the Nacha Rules, applicable federal and Washington law, and the rules of the LCB. If any law or rule conflicts with this Agreement, the law or rule controls. Nothing in this Agreement is a representation about the legality of cannabis under federal law."
    },
    {
      "k": "h",
      "t": "17. Taxpayer Information"
    },
    {
      "k": "p",
      "t": "Vendor will, on request, provide a current IRS Form W-9, and Greenway may report payments if and to the extent the law requires. Providing a W-9 is not a condition of receiving payment by check."
    },
    {
      "k": "h",
      "t": "18. Allocation of Responsibility; Limitation of Liability"
    },
    {
      "k": "p",
      "t": "18.1 Each party is responsible for losses to the extent caused by its own breach of this Agreement, negligence or misconduct. Vendor is responsible for loss caused by incorrect or unauthorized information supplied in Vendor's name, by a compromise of Vendor's own systems, email, credentials or personnel, or by Vendor's failure to give the notices required in Section 7.2. Greenway is responsible for an Entry that does not match its authorized instruction, if the error arises from Greenway's own negligence or misconduct."
    },
    {
      "k": "p",
      "t": "18.2 To the extent the law allows, neither party is liable to the other for indirect, special, consequential or punitive damages, and Greenway's liability for a payment error is limited to correcting or reissuing the affected payment, plus any direct loss. Greenway is not liable for delay or failure caused by Vendor's bank, a Federal Reserve Bank or other ACH Operator, an act of God, outage, or other event beyond its reasonable control. Nothing here limits a party's obligations to pay valid Invoices, or liability that cannot be limited by law."
    },
    {
      "k": "h",
      "t": "19. Electronic Records and Signatures"
    },
    {
      "k": "p",
      "t": "The parties agree that this Agreement may be signed by electronic signature and delivered electronically, and consent to conduct this transaction electronically. Under the Washington Uniform Electronic Transactions Act (chapter 1.80 RCW) and the federal E-SIGN Act (15 U.S.C. 7001 et seq.), an electronic signature, a signed PDF or a photocopy of a signed copy has the same effect as an original handwritten signature. Vendor may obtain a paper copy at no charge, and may withdraw its consent to electronic records by notice under Section 22. This Agreement may be signed in counterparts."
    },
    {
      "k": "h",
      "t": "20. Governing Law and Venue"
    },
    {
      "k": "p",
      "t": "This Agreement is governed by the laws of the State of Washington, without regard to conflict-of-laws principles, and by the Nacha Rules as to ACH Entries. The parties submit to the exclusive jurisdiction and venue of the state courts in Kitsap County, Washington, except that either party may seek emergency relief to stop a fraudulent or unauthorized transfer in any court of competent jurisdiction. Each party bears its own attorney fees unless a court orders otherwise."
    },
    {
      "k": "h",
      "t": "21. General Provisions"
    },
    {
      "k": "p",
      "t": "Entire agreement. This Agreement is the entire agreement on the method of payment and supersedes prior understandings on that subject. It does not replace any supply agreement or Invoice. Amendment. Amendments are valid only in a writing signed by both parties, except that Greenway may update its contact details by notice and may change administrative procedures that do not reduce Vendor's rights. Severability. If any provision is unenforceable, the rest remains in effect and the provision is enforced to the fullest extent allowed. No waiver. A delay in enforcing a right is not a waiver. Assignment. Neither party may assign this Agreement or any right to payment under it without the other's written consent; an assignment of Vendor's right to payment is subject to Section 7.4. Survival. Sections 7, 10, 12, 14, 18 and 20 survive termination. Interpretation. Headings are for convenience; \"including\" means \"including without limitation\"; this Agreement is to be read as a whole and not construed against its drafter."
    },
    {
      "k": "h",
      "t": "22. Notices and Contacts"
    },
    {
      "k": "p",
      "t": "A notice to Greenway must be in writing, signed, and delivered by hand or U.S. Mail to: Greenway Marijuana, Attn: Stephen Benoit, 4851 Geiger Rd SE, Port Orchard, WA 98366, or by a method Greenway confirms in writing. An emailed notice is effective only after Greenway verifies it by callback under Section 8. A notice to Vendor goes to the Vendor address in Part 1, or to the contact in Part 1 by email. Each party will update the other of any contact change in the manner stated in Section 8."
    }
  ],
  "certification": "By signing, I certify that I am authorized to sign for Vendor; that the information above is true and complete; that the Account is Vendor's own business account; that I have read and agree to the Terms (including the credit-only authorization and the written EFT terms required by WAC 314-55-115(3)); and that participation is voluntary. I understand Greenway will verify this request by calling a second authorized contact before the first payment.",
  "acceptance": "Greenway signs only after completing its internal verification and dual approval (Form GW-ACH-V-INT, kept by Greenway). This Agreement takes effect on the date of Greenway's countersignature."
};

/** sha256 of the canonical JSON (keys sorted, no spaces) of ACH_V_TERMS. */
export const ACH_V_TERMS_SHA256 = "b447f6fccf3c9841c3aad9dc97fc689b6b7a54229a58016c2603f8db472daa6d";
