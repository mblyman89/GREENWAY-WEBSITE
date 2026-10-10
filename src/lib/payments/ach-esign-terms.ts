/**
 * src/lib/payments/ach-esign-terms.ts  (R39 S6, PURE, GENERATED)
 *
 * The exact words of form GW-ACH-E (Rev. 10/2026 v1.0) Parts 4, 5 and the
 * Part 6 acknowledgment, extracted from the form source
 * (/workspace/ach/employee-fillable.html, outside the repo) so the e-signed
 * record says the same thing as the paper form. Do not edit by hand: a change
 * to the terms is a new form revision, and ACH_E_TERMS_SHA256 pins this one
 * (tests/compliance/r39-ach-esign.test.ts recomputes it).
 */
export type TermsPara = { k: "h" | "p"; t: string };
export type FormTerms = { formId: string; formRev: string; wac: readonly string[]; terms: readonly TermsPara[]; acknowledgment: string };

export const ACH_E_TERMS: FormTerms = {
  "formId": "GW-ACH-E",
  "formRev": "Rev. 10/2026 v1.0",
  "wac": [
    "WAC 296-126-023(7), Payment interval",
    "Mailed paychecks shall be postmarked no later than the established pay day. If the established pay day falls on a weekend day or holiday when the business office is not open, mailed paychecks shall be postmarked no later than the next business day. Employers that pay employees by direct deposit or other electronic means shall ensure that such wage payments are made and available to employees on the established pay day.",
    "WAC 296-126-030(4) & (6), Adjustments for overpayments",
    "(4) An employer can recover an overpayment from an employee's paycheck provided the overpayment was infrequent and inadvertent. [...] The employer has ninety days from the initial overpayment to detect and implement a plan with the employee to collect the overpayment. If the overpayment is not detected within the ninety-day period, the employer cannot adjust an employee's current or future wages to recoup the overpayment. Recouping of overpayments is limited to the ninety-day detection period.",
    "(6) The employer must provide advance written notice to the employee before any adjustment is made. The notice must include the terms under which the overpayment will be recouped. For example: One adjustment or a series of adjustments.",
    "Source: apps.leg.wa.gov (WAC 296-126-023 and 296-126-030). \"[...]\" marks omitted definitions only. The full rules apply and, if amended, the amended rules control."
  ],
  "terms": [
    {
      "k": "p",
      "t": "These terms are part of this Authorization. Please read them before signing; you may keep a copy."
    },
    {
      "k": "h",
      "t": "1. Purpose; Your Choice of Bank"
    },
    {
      "k": "p",
      "t": "1.1 This Employee Direct Deposit Authorization (the \"Authorization\") is between you (\"Employee\") and Lyman's Marijuana d/b/a Greenway Marijuana (\"Greenway\"). It lets Greenway deposit your net wages electronically into the account or accounts you list in Part 3."
    },
    {
      "k": "p",
      "t": "1.2 You choose the bank or credit union. Greenway does not require you to use any particular financial institution. Any bank, credit union or other institution that can receive ACH deposits in your name is acceptable (12 C.F.R. 1005.10(e)(2))."
    },
    {
      "k": "h",
      "t": "2. Direct Deposit Is Greenway's Standard Method; Paper-Check Exception"
    },
    {
      "k": "p",
      "t": "2.1 Greenway pays employees by direct deposit. Direct deposit is the required method of payment for Greenway employees, subject to the paper-check exception below."
    },
    {
      "k": "p",
      "t": "2.2 Exception process. If you do not have, or cannot reasonably use, a deposit account, or have another good reason, you may request to be paid by paper check by checking the box in Part 2 and signing this form. Greenway will review the request and answer in writing before the next payday. If approved, you will receive your paper check on the payday, either handed to you at the store or postmarked no later than the payday (and, if the payday is a weekend or holiday when the office is closed, no later than the next business day), at no cost to you. Greenway will not take any adverse action against you for requesting the exception."
    },
    {
      "k": "p",
      "t": "2.3 You are paid either by ACH direct deposit or by paper check. Greenway does not use payroll cards or other pay methods."
    },
    {
      "k": "h",
      "t": "3. Authorization (Credit Only)"
    },
    {
      "k": "p",
      "t": "3.1 You authorize Greenway to initiate credit entries to the account(s) in Part 3 for your net pay on each payday, and you authorize your financial institution to post them. Greenway uses the Nacha \"PPD\" format and the entry description \"PAYROLL\", and the deposit will show Greenway Marijuana as the sender."
    },
    {
      "k": "p",
      "t": "3.2 Credits only. Greenway will not withdraw or debit money from your account, except for a limited reversing entry to correct an erroneous deposit as described in Section 9. This Authorization is not an authorization for any payroll deduction. Deductions are made only as the law requires or as you separately authorize in writing in advance (WAC 296-126-028)."
    },
    {
      "k": "h",
      "t": "4. Pay Schedule and Availability"
    },
    {
      "k": "p",
      "t": "4.1 Employees are paid every other Friday. Greenway will initiate each deposit early enough that funds are made and available to you on the payday, as WAC 296-126-023(7) requires. If a payday falls on a bank holiday, Greenway will deposit before the holiday where practical, or as the law allows."
    },
    {
      "k": "p",
      "t": "4.2 Greenway controls when it sends your deposit. Your bank controls how quickly its own systems post it, and Greenway cannot control a delay at your bank. If your deposit is missing or late because of a Greenway error, Greenway will correct it promptly, by replacement paper check or corrected deposit, and will not charge you for doing so."
    },
    {
      "k": "h",
      "t": "5. No Cost to You"
    },
    {
      "k": "p",
      "t": "Direct deposit costs you nothing. Greenway charges you no fee to enroll, change or cancel. Your own bank's fees (if any) are your responsibility under your account agreement. Greenway will not make you pay a cost to receive your wages."
    },
    {
      "k": "h",
      "t": "6. Pay Statements"
    },
    {
      "k": "p",
      "t": "Greenway will give you an itemized pay statement on each payday that shows your pay basis, rate(s), gross wages, deductions and pay period (WAC 296-126-040). A pay statement may be electronic only if you can access and copy it on the payday; if you cannot, Greenway will give you a written statement on the payday. Direct deposit does not replace the pay statement."
    },
    {
      "k": "h",
      "t": "7. Splitting Your Deposit"
    },
    {
      "k": "p",
      "t": "You may split your net pay among up to three (3) accounts. Each account except one receives a fixed dollar amount or percentage, and exactly one account receives the remainder. If the amounts you list are unclear or exceed your net pay, Greenway will deposit the full net pay to the remainder account and notify you."
    },
    {
      "k": "h",
      "t": "8. Changing or Canceling"
    },
    {
      "k": "p",
      "t": "8.1 To change your accounts, amounts or split, or to cancel direct deposit, submit a new signed form in person to Stephen Benoit or Michael Lyman, with a photo ID. Greenway will process a change or cancellation effective no later than one full pay cycle (14 days) after receipt, if received at least that long before the payday. Until the change is effective, deposits continue to the earlier account, so please keep it open until you see the first deposit in the new one."
    },
    {
      "k": "p",
      "t": "8.2 If you cancel, Greenway will pay you by paper check (see Section 2). If you leave Greenway, your final wages will be paid no later than the next regular payday, by direct deposit to your listed account(s) unless you request a paper check."
    },
    {
      "k": "h",
      "t": "9. Your Responsibilities"
    },
    {
      "k": "p",
      "t": "9.1 You confirm that: (a) each account is a deposit account in your own name (alone or jointly), at an institution of your choice; (b) the routing and account numbers you give are correct; (c) you will tell Greenway promptly, in writing, if an account is closed, frozen or changes; and (d) you will keep the account open until the first deposit posts."
    },
    {
      "k": "p",
      "t": "9.2 Account number controls. Greenway and the banks may rely on the routing and account numbers you give, even if the name on the account differs. If you give an incorrect number, Greenway will try to recover the funds but cannot guarantee it, and will pay the amount owed by paper check once the funds are returned or Greenway's recovery efforts are complete."
    },
    {
      "k": "h",
      "t": "10. Errors, Reversals and Overpayments"
    },
    {
      "k": "p",
      "t": "10.1 If Greenway sends you a deposit by mistake (a duplicate, the wrong account, the wrong amount or the wrong date), you authorize Greenway to send a reversing entry for only the erroneous amount, within the time allowed by the Nacha Rules (currently five (5) banking days after the settlement date). Greenway will make a reasonable attempt to tell you about the reversal and the reason no later than the date the reversal settles. If a reversal is not possible, Greenway will fix the error in the way described below."
    },
    {
      "k": "p",
      "t": "10.2 Overpayments of wages. Greenway recovers an overpayment of wages (more than your agreed rate or more than the hours you worked) only as Washington law allows under WAC 296-126-030: only if it was infrequent and inadvertent; only if Greenway detects it and implements a plan with you within 90 days of the original overpayment; and only after Greenway gives you advance written notice, with documentation of the overpayment and the terms of recovery (for example, one adjustment or a series of adjustments). Greenway records every adjustment openly in your payroll records. Greenway will never recoup an overpayment by an unauthorized debit to your account."
    },
    {
      "k": "p",
      "t": "10.3 Nothing in this Section limits any right you have under Washington wage laws (chapters 49.46, 49.48 and 49.52 RCW) or any other law."
    },
    {
      "k": "h",
      "t": "11. Returned Deposits; Closed Accounts"
    },
    {
      "k": "p",
      "t": "If your bank returns or rejects a deposit, Greenway will pay the amount owed by paper check, delivered or postmarked as soon as reasonably practical, and will ask you to update your information. Greenway may suspend direct deposit after repeated returns until your account is corrected."
    },
    {
      "k": "h",
      "t": "12. Protecting Your Pay From Fraud"
    },
    {
      "k": "p",
      "t": "Criminals try to redirect employees' pay by impersonating them. Greenway will never change your direct-deposit information based on an email, text message, social-media message or phone call alone. Changes are accepted only in person with a photo ID and a signed form. After a change, Greenway will confirm it with you directly. If you ever receive a message that appears to be from Greenway asking you to confirm or change your bank details, do not respond; call Stephen at 360-621-7977 or the store at 360-443-6988. Please tell Greenway immediately if you see a deposit you do not expect or do not receive one you do."
    },
    {
      "k": "h",
      "t": "13. Privacy and Data Security"
    },
    {
      "k": "p",
      "t": "Greenway uses your bank and identity information only to pay you, verify your identity, keep required records and comply with law. Greenway stores banking data in a restricted-access system with encryption at rest, limits access to authorized personnel, and does not sell or share it except with its bank, payroll and tax authorities, auditors, counsel and regulators, or as law requires. Greenway destroys records containing personal financial information when it no longer retains them (RCW 19.215.020) and will give notice of a security breach as RCW 19.255.010 requires. This form does not ask for your full Social Security number, only the last four digits."
    },
    {
      "k": "h",
      "t": "14. Records"
    },
    {
      "k": "p",
      "t": "Greenway keeps this signed Authorization for at least two (2) years after it ends, as the Nacha Rules require, and keeps payroll records as long as employment, tax and cannabis-licensing laws require. You may request a copy of your signed form at any time."
    },
    {
      "k": "h",
      "t": "15. Revocation"
    },
    {
      "k": "p",
      "t": "You may revoke this Authorization at any time by following Section 8. Revocation does not affect deposits already sent. Revocation does not change your right to be paid your wages on time; Greenway will pay you by paper check."
    },
    {
      "k": "h",
      "t": "16. Electronic Records and Signatures"
    },
    {
      "k": "p",
      "t": "You may sign this form by hand or by electronic signature, and you consent to use electronic records for this Authorization. Under the Washington Uniform Electronic Transactions Act (chapter 1.80 RCW) and the federal E-SIGN Act (15 U.S.C. 7001 et seq.), an electronic signature or a signed copy has the same effect as an original handwritten signature. You may receive a paper copy at no charge and may withdraw your consent to electronic records by written notice to Greenway."
    },
    {
      "k": "h",
      "t": "17. General"
    },
    {
      "k": "p",
      "t": "This Authorization is governed by Washington law and the Nacha Rules as to ACH entries. It is not a contract of employment and does not change your at-will status or any term of your employment. If any part is unenforceable, the rest stays in effect. If a law or rule conflicts with this form, the law or rule controls. This is the entire agreement about direct deposit and replaces any earlier direct-deposit form you signed. Greenway may update its procedures if the change does not reduce your rights, and will tell you."
    }
  ],
  "acknowledgment": "By signing, I confirm that: (1) I chose the bank(s) listed in Part 3 (or requested a paper check in Part 2); (2) the accounts are in my name and the information is correct; (3) I authorize Greenway to deposit my net pay by credit entries only, and to send a limited reversing entry only to fix an erroneous deposit; (4) I understand direct deposit costs me nothing and that I will receive an itemized pay statement each payday; (5) I understand how Greenway recovers an overpayment under WAC 296-126-030; and (6) I have read and agree to the Terms and consent to electronic signatures and records."
};

/** sha256 of the canonical JSON (keys sorted, no spaces) of ACH_E_TERMS. */
export const ACH_E_TERMS_SHA256 = "c8d7c3ebd44e769beaad9f61fb280ddfa2460a346a5bb134140a387d734caf13";
