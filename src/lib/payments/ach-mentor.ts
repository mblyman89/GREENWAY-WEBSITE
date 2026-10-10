/**
 * ACH MENTOR - plain-English lessons for the direct-deposit screens.
 *
 * R39 S1. Pure data, safe in a client bundle (no node:fs - the coverage gates
 * that read source live in ach-mentor-gates.ts, standing rule 65b).
 *
 * Every lesson cites authorities by `AchAuthorityId`, so a mistyped citation
 * does not compile. Every exported function of ach-authorization-core.ts has
 * a lesson (or an explicit "plumbing" exemption with a reason) - enforced by
 * ach-mentor-gates.ts, which reads the engine's real export list from disk.
 */

import type { AchAuthorityId } from "./ach-authorities";
import { AUTHORIZATION_STATES, type AuthorizationState } from "./ach-authorization-core";

export type AchLesson = {
  readonly key: string;
  readonly title: string;
  /** What Michael reads. Short sentences, no jargon left unexplained. */
  readonly plain: string;
  readonly authorities: readonly AchAuthorityId[];
};

/**
 * Owner question Q3, answered in his words: "what is the difference between a
 * prenote and the $1 test credit, and which is easiest?"
 */
export const PRENOTE_VS_TEST_CREDIT: AchLesson = {
  key: "prenote-vs-test-credit",
  title: "Prenote or test credit - what is the difference?",
  plain:
    "Both are ways to make sure a bank account number is real before a paycheck or vendor payment goes to it. " +
    "A PRENOTE is a $0.00 practice entry. No money moves. Timberland sends it through the banking system, and if " +
    "the account number is wrong the other bank sends it back, usually within two banking days. If nothing comes " +
    "back after three banking days, you may send real money. A prenote proves the account EXISTS. It does not " +
    "prove the person who gave it to you OWNS it. " +
    "A TEST CREDIT (Nacha calls it a micro-entry) is a real deposit of less than $1.00 - say 23 cents - labelled " +
    "ACCTVERIFY on the payee's statement. The payee tells you the amount they saw. That proves the account exists " +
    "AND that the person can see into it. Greenway never takes the pennies back. " +
    "Easiest: the prenote, because the payee does nothing. Use it as the default once Timberland confirms it " +
    "accepts prenote files. Use a test credit when the account or the person is new to you or the change looks " +
    "unusual. Either way, a callback to a phone number already on file is still required for any CHANGE.",
  authorities: [
    "ach-prenote-zero-dollar-not-ownership",
    "ach-prenotes-optional",
    "ach-prenote-three-banking-days",
    "ach-micro-entry-definition",
    "ach-micro-entry-under-one-dollar",
    "ach-micro-entry-acctverify",
    "ach-prenote-vs-micro-formatting",
  ],
};

/**
 * One lesson per exported function of ach-authorization-core.ts. The KEY is
 * the function name. The gate fails if the core gains a function with no
 * lesson, or a lesson names a function the core no longer exports.
 */
export const ACH_FUNCTION_LESSONS: readonly AchLesson[] = [
  {
    key: "isFedAchBankingDay",
    title: "What counts as a banking day",
    plain:
      "Monday to Friday, except the eleven Federal Reserve holidays. Columbus Day and Veterans Day count as holidays " +
      "even though many businesses are open. When a holiday lands on Saturday the Fed is open Friday; when it lands " +
      "on Sunday the Fed is closed Monday. This is a different calendar from the IRS tax-deposit one.",
    authorities: ["ach-fedach-saturday-sunday"],
  },
  {
    key: "fedAchClosures",
    title: "Which weekdays the Fed is closed this year",
    plain:
      "The list of weekdays this year when no ACH moves. If the year is past the Fed calendar we have on file the " +
      "system stops and says so rather than guessing, because guessing would mis-date a payment.",
    authorities: ["ach-fedach-saturday-sunday"],
  },
  {
    key: "addBankingDays",
    title: "Counting banking days",
    plain:
      "Every ACH deadline is counted in banking days, never calendar days. The starting day never counts. A prenote " +
      "that settles the Tuesday before Thanksgiving is not ready until the following Monday.",
    authorities: ["ach-fedach-saturday-sunday", "ach-prenote-three-banking-days"],
  },
  {
    key: "nextBankingDayOnOrAfter",
    title: "Moving a date to the next banking day",
    plain: "If the date you picked is a weekend or Fed holiday, the payment settles on the next banking day instead.",
    authorities: ["ach-fedach-saturday-sunday"],
  },
  {
    key: "prenoteLiveEligibleDate",
    title: "When a prenoted account can be paid",
    plain:
      "Three banking days after the prenote settles. Before 2021 the rule was six days; Nacha shortened it. If a " +
      "return or a correction notice comes back, the account is not ready at all until it is fixed.",
    authorities: ["ach-prenote-three-banking-days", "ach-prenote-wait-history"],
  },
  {
    key: "prenoteOutcome",
    title: "Is this prenote done?",
    plain:
      "Waiting, ready, or blocked. A return means the account number is wrong: get new details from the payee. A " +
      "correction notice (NOC) means the bank told us the right numbers: apply them, call the payee, then release.",
    authorities: ["ach-prenote-three-banking-days", "ach-noc-no-new-authorization"],
  },
  {
    key: "returnWindowCloses",
    title: "When a return would have arrived",
    plain:
      "The other bank has until the opening of business on the second banking day after settlement to send a " +
      "payment back. After that, a payment that has not bounced has almost certainly landed.",
    authorities: ["ach-returns-second-banking-day"],
  },
  {
    key: "nocApplyBy",
    title: "Deadline to apply a correction notice",
    plain:
      "Six banking days after it arrives, or before the next payment to that person, whichever comes first. The " +
      "system puts the account on hold as soon as the notice is logged, so the next payment cannot slip out wrong.",
    authorities: ["ach-noc-six-banking-days", "ach-noc-no-new-authorization"],
  },
  {
    key: "reversalDeadline",
    title: "Deadline to reverse a mistake",
    plain:
      "Wrong amount, duplicate, or wrong person: a reversal must go out within five banking days of the mistake " +
      "settling, labelled REVERSAL, and you must tell the person why.",
    authorities: ["ach-reversal-five-banking-days", "ach-reversal-description"],
  },
  {
    key: "transactionCodeFor",
    title: "The two-digit code on every payment",
    plain:
      "22 is a deposit to checking, 32 to savings. 23 and 33 are the $0 prenote versions. Greenway only sends " +
      "money, so the debit codes are not even available in this system.",
    authorities: ["ach-prenote-codes"],
  },
  {
    key: "isAllowedTransactionCode",
    title: "Refusing any code that would pull money",
    plain:
      "Anything other than 22, 23, 32 or 33 is refused before a payment file is built, so a debit code can never " +
      "reach Timberland even by accident or by a bad import.",
    authorities: ["ach-prenote-codes"],
  },
  {
    key: "validateMicroEntryCents",
    title: "Test credit amount",
    plain: "Between 1 and 99 cents. A dollar or more is not a test credit under the Nacha rule and is refused.",
    authorities: ["ach-micro-entry-under-one-dollar"],
  },
  {
    key: "microEntryFileConflicts",
    title: "No real payment in the same file as a test credit",
    plain:
      "The real money waits until the payee confirms the test amount. The file builder refuses a file that has a " +
      "test credit and a live payment to the same account.",
    authorities: ["ach-micro-entry-no-simultaneous-live"],
  },
  {
    key: "microEntryConfirmed",
    title: "Checking the amount the payee reports",
    plain:
      "The payee must report exactly the amount that was sent, to the cent. Close is not good enough, and a " +
      "wrong answer leaves the account unverified.",
    authorities: ["ach-micro-entry-definition"],
  },
  {
    key: "validateSplits",
    title: "Splitting a paycheck across accounts",
    plain:
      "Up to three accounts. Each one gets a fixed dollar amount or a percentage, and exactly one account gets " +
      "whatever is left over, so every cent always lands somewhere.",
    authorities: ["ach-payroll-description"],
  },
  {
    key: "allocateSplit",
    title: "How the split is worked out",
    plain:
      "Fixed amounts and percentages are paid in the order the employee chose. If the check is smaller than the " +
      "fixed amounts, the first accounts are filled and the rest get zero. Leftover cents always go to the " +
      "remainder account, so the parts always add up to the net pay exactly.",
    authorities: ["ach-payroll-description"],
  },
  {
    key: "canTransition",
    title: "The life of an authorization",
    plain:
      "Draft, signed, verifying, active. A bank change, return or correction moves it to on hold. Revoked and " +
      "archived are permanent: nothing is ever deleted, it is archived and kept for the retention period.",
    authorities: ["ach-fraud-phase-2-change-controls", "ach-authorization-two-years-united"],
  },
  {
    key: "payable",
    title: "Can this person be paid by direct deposit?",
    plain: "Only when the authorization is active. Every other state comes with a plain reason saying what to do next.",
    authorities: ["ach-fraud-phase-2-change-controls"],
  },
  {
    key: "stateAfterBankChange",
    title: "Changing bank details puts the account on hold",
    plain:
      "Any change to routing, account number or account type - no matter who asks or how - puts the account on " +
      "hold until someone calls the payee and releases it. This is the control Nacha now expects of every " +
      "business that sends ACH, however small.",
    authorities: ["ach-fraud-phase-2-change-controls", "ach-fraud-phase-2-all-originators", "ach-false-pretenses"],
  },
  {
    key: "releaseVerdict",
    title: "Releasing a hold",
    plain:
      "Michael or Stephen may release. Ideally the person who did NOT enter the change releases it. Either of you " +
      "may release your own change alone when needed, but you must write why, and the other person is told " +
      "automatically. In every case you must first call the payee at a number that has been on file for at least " +
      "90 days - never a number from the change request itself.",
    authorities: ["ach-sao-verify-by-phone", "ach-sao-segregate-duties", "ach-verify-with-contact-on-file", "ach-callback-manipulation"],
  },
  {
    key: "callbackEligibleContacts",
    title: "Which phone numbers are safe to call back",
    plain:
      "Only numbers on file for 90 days or more. Fraudsters often change the phone number first and the bank " +
      "details a few weeks later, so the callback reaches them. There is no industry-standard window; 90 days is " +
      "Greenway policy, padded well past a monthly cycle.",
    authorities: ["ach-callback-manipulation", "ach-sao-verify-by-phone"],
  },
  {
    key: "retentionVerdict",
    title: "How long the signed form is kept",
    plain:
      "While it is in effect, forever. After it ends, the longest of: Nacha's 2 years, the cannabis board's 5 years " +
      "for employee and payroll records, and Greenway's 6-year policy. A legal hold stops the clock. The system " +
      "never deletes on its own; it only tells you when disposal would first be allowed.",
    authorities: ["ach-authorization-two-years-united", "ach-authorization-two-years-campus", "ach-wac-087-five-years", "ach-wac-087-employee-records"],
  },
  {
    key: "classifyAchCode",
    title: "What a return or correction code means",
    plain:
      "Each code the bank sends back is translated into what to do: get new details, apply the correction, or " +
      "treat it as possible fraud. An unfamiliar code is treated as possible fraud until Timberland explains it.",
    authorities: ["ach-returns-second-banking-day", "ach-noc-no-new-authorization"],
  },
  {
    key: "resolveNotifyContacts",
    title: "Who gets told",
    plain:
      "Stephen and Michael by phone and email, and the store line. The personal cell numbers are kept in the " +
      "server settings, not in the code, because the code is public. If one is missing, the notice still goes by " +
      "email and the settings page shows the gap.",
    authorities: ["ach-fraud-phase-2-change-controls"],
  },
  {
    key: "soloReleaseRecipients",
    title: "Who hears about a solo release",
    plain: "The other of you two, plus the store line. A change one person entered and released alone never goes unnoticed.",
    authorities: ["ach-sao-segregate-duties"],
  },
  {
    key: "normalizeAccountKey",
    title: "Spotting the same account twice",
    plain:
      "Dashes, spaces and leading zeros are ignored when comparing accounts, so the same account cannot be listed " +
      "twice in a split or quietly shared by two employees without the system noticing.",
    authorities: ["ach-false-pretenses"],
  },
  {
    key: "daysBetween",
    title: "Counting calendar days",
    plain: "Used for the 90-day phone-number rule, which is counted in calendar days, not banking days.",
    authorities: ["ach-callback-manipulation"],
  },
];


/**
 * Lessons for rules that are not a single core function: e-signature (S6),
 * the annual review, and why Plaid is not used. Keyed by topic.
 */
export const ACH_TOPIC_LESSONS: readonly AchLesson[] = [
  {
    key: "e-sign-is-a-signature",
    title: "Is an e-signed form as good as paper?",
    plain:
      "Yes. Washington and federal law both say a signature cannot be refused just because it is electronic. Two " +
      "conditions: the signer agrees to sign electronically (they tick a box first, and can choose paper instead), " +
      "and they act with intent to sign (they type their name next to a sentence saying that typing it is their " +
      "signature). The system also records a one-time code sent to contact details on file, the time, the device, " +
      "and a fingerprint of the exact document, so it can be proven later who signed.",
    authorities: [
      "ach-rcw-1-80-040-agreement",
      "ach-rcw-1-80-060-signature",
      "ach-rcw-1-80-080-attribution",
      "ach-usc-7001-a",
      "ach-usc-7006-5",
    ],
  },
  {
    key: "credit-authorization-form",
    title: "Why everyone signs even though Greenway only sends money",
    plain:
      "Nacha only strictly requires a signed paper for pulling money out of a consumer's account, which Greenway " +
      "never does. A deposit can be authorized any way the law allows. Greenway still has everyone sign, because " +
      "the signed form is the evidence of who gave which account, and that is what protects you if a fraudster " +
      "later claims to be the employee or vendor.",
    authorities: ["ach-only-consumer-debits-need-signed-writing", "ach-false-pretenses"],
  },
  {
    key: "annual-review",
    title: "Review these procedures once a year",
    plain:
      "Nacha now expects every business that sends ACH to review its fraud procedures at least once a year. The " +
      "system will remind Michael each year and keep a record that the review was done.",
    authorities: ["ach-fraud-phase-2-annual-review", "ach-fraud-phase-2-all-originators"],
  },
  {
    key: "why-not-plaid",
    title: "Why Plaid is not used",
    plain:
      "Plaid's quick checks ask the person to log in to their own bank through Plaid's screen. Its fallback, " +
      "Same-Day Micro-deposits, is a small deposit that posts in one to two business days and that the person " +
      "then confirms - the same kind of test credit Greenway can send itself through Timberland. So Plaid would " +
      "add a vendor, a contract and a third party holding bank details, without adding a check Greenway cannot " +
      "already do. You also mentioned your Plaid plan is the hobby tier.",
    authorities: ["ach-plaid-same-day", "ach-micro-entry-definition"],
  },
];

/**
 * Exported core functions that are pure date plumbing with no rule of their
 * own. Listed explicitly (with the reason) so the gate can tell "exempt" from
 * "forgotten".
 */
export const ACH_PLUMBING_FUNCTIONS: Readonly<Record<string, string>> = {
  addCalendarDays: "Date arithmetic; every rule that uses it has its own lesson.",
  addYears: "Date arithmetic for retention; taught under retentionVerdict.",
  weekday: "Day-of-week helper; taught under isFedAchBankingDay.",
  __runAchAuthorizationCoreTests: "Self-test entry point, not behaviour.",
};

export const ACH_STATE_LESSONS: Readonly<Record<AuthorizationState, string>> = {
  draft: "Entered but not signed. Nothing can be paid.",
  signed: "Signed form on file. The account still has to be checked (prenote or test credit).",
  verifying: "The prenote or test credit is on its way. Usually three banking days.",
  active: "Ready. Payments may go to this account.",
  on_hold: "Something changed or bounced. Call the payee at a number on file, then release.",
  revoked: "The payee withdrew permission. Pay by check until a new form is signed.",
  archived: "No longer in use. Kept for the retention period, then eligible for disposal - never deleted automatically.",
};

export function achLesson(key: string): AchLesson | null {
  if (key === PRENOTE_VS_TEST_CREDIT.key) return PRENOTE_VS_TEST_CREDIT;
  return [...ACH_FUNCTION_LESSONS, ...ACH_TOPIC_LESSONS].find((l) => l.key === key) ?? null;
}

/** States without a lesson. Must be empty; asserted by test. */
export function untaughtStates(): readonly AuthorizationState[] {
  return AUTHORIZATION_STATES.filter((s) => !ACH_STATE_LESSONS[s]);
}
