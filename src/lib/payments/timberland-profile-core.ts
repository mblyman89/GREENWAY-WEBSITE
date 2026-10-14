/**
 * src/lib/payments/timberland-profile-core.ts  (R41 S1)
 *
 * Timberland Bank's ACH terms for Greenway, in ONE place, each with the words
 * it came from. PURE: no I/O, no clock, no server-only imports.
 *
 * Two sources, both mirrored verbatim in docs/authorities/ach:
 *   - "timberland-ach-agreement-2026-10-09": the signed ACH Origination
 *     Agreement (company-signed 10/09/26), redacted for the public repo, PDF
 *     sha256 302132a2...58ce4. File: timberland-ach-agreement-2026-10-09.redacted.txt
 *   - "timberland-brenda-2026-10": Brenda's (Timberland Cash Management) two
 *     emails, as the owner pasted them. File: timberland-brenda-2026-10.txt
 *
 * Rules this file keeps (tests/compliance/r41-s1-timberland-profile.test.ts):
 *   - every `quote` is an exact substring of its mirror (whitespace flattened)
 *   - every fact's value is visible INSIDE its own quote (checked here, in
 *     __runTimberlandProfileCoreTests), so a value cannot drift from its words
 *   - a "greenway_policy" fact has no bank quote and says so; it is our own
 *     margin, never presented as Timberland's rule
 *   - the account is only ever its last four digits. The full number must
 *     never appear in this file or in the mirrors (the repo is public).
 *
 * This slice only RECORDS the terms. Later R41 slices (S2-S11) read them; no
 * file builder, limit check or clock changes behaviour in S1.
 *
 * NOT LEGAL ADVICE. Where the contract and Brenda differ, or a term is not
 * defined, the open question is listed in OPEN_QUESTIONS with the strict
 * default the later slices use until Brenda answers.
 */

import { dfiId8, isValidRouting } from "./nacha-fields-core";
import { PRENOTE_WAIT_BANKING_DAYS as NACHA_PRENOTE_WAIT_BANKING_DAYS } from "./ach-authorization-core";

// ───────────────────────────────────────────────────────────────────────────
// 1. Sources and citations
// ───────────────────────────────────────────────────────────────────────────

export type TimberlandSourceId = "timberland-ach-agreement-2026-10-09" | "timberland-brenda-2026-10";

/** Repo-relative path of each verbatim mirror. */
export const TIMBERLAND_SOURCE_FILES: Readonly<Record<TimberlandSourceId, string>> = {
  "timberland-ach-agreement-2026-10-09": "docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt",
  "timberland-brenda-2026-10": "docs/authorities/ach/timberland-brenda-2026-10.txt",
};

/** sha256 of the ORIGINAL signed PDF (kept by the owner, never committed). */
export const TIMBERLAND_AGREEMENT_PDF_SHA256 = "302132a284ad0ebfc83c3bbf6aa77fe002141b7ec8646efa4fd2bea129158ce4";

export type TimberlandCite = { source: TimberlandSourceId; section: string; quote: string };

export type TimberlandFact<T> = {
  value: T;
  /** "bank" = Timberland's words. "greenway_policy" = our own, stricter margin. */
  kind: "bank" | "greenway_policy";
  cites: readonly TimberlandCite[];
  /** Plain English for the owner. */
  label: string;
};

const A = "timberland-ach-agreement-2026-10-09" as const;
const B = "timberland-brenda-2026-10" as const;

/** Collapse every run of whitespace (incl. U+00A0 and newlines) to one space. */
export function flattenWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 5_000_000 -> "50,000.00". Integer cents only. */
export function centsToUsdText(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`centsToUsdText: not whole non-negative cents: ${cents}`);
  const d = Math.floor(cents / 100).toLocaleString("en-US");
  return `${d}.${String(cents % 100).padStart(2, "0")}`;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. The profile
// ───────────────────────────────────────────────────────────────────────────

export type ClockTime = { hour: number; minute: number; tz: "America/Los_Angeles" };
export type TimberlandUserOnFile = { name: string; enter: boolean; approve: boolean; limitCents: number };
export type TimberlandFees = { serviceMonthly: number; perReturnOrNoc: number; nachaCdYearly: number; lostTokenReplacement: number };

export const TIMBERLAND_PROFILE = {
  routing: {
    value: "325170754",
    kind: "bank",
    label: "Timberland's routing number for the ACH file header (Immediate Destination).",
    cites: [{ source: B, section: "Email 2, answer 3", quote: "3. Routing number \u2013 325170754" }],
  } as TimberlandFact<string>,
  odfi: {
    value: "32517075",
    kind: "bank",
    label: "Originating bank ID: the first 8 digits of Timberland's routing number (batch header).",
    cites: [{ source: B, section: "Email 2, answer 3", quote: "3. Routing number \u2013 325170754" }],
  } as TimberlandFact<string>,
  batchCompanyName: {
    value: "GREENWAY MARIJUA",
    kind: "bank",
    label: "Company Name in every batch header, exactly as Timberland set it up (16 characters).",
    cites: [{ source: B, section: "Email 2, answer 1", quote: "1. GREENWAY MARIJUA (that is all that will fit in this section)" }],
  } as TimberlandFact<string>,
  companyIdPrefix: {
    value: "1",
    kind: "bank",
    label: "Company ID is \"1\" followed by the 9-digit EIN.",
    cites: [{ source: B, section: "Email 2, answer 2", quote: "2. 1 + EIN" }],
  } as TimberlandFact<string>,
  contractLegalName: {
    value: "Lymans Marijuana LLC",
    kind: "bank",
    label: "The company name on the signed agreement (printed without an apostrophe).",
    cites: [{ source: A, section: "Preamble (p.1)", quote: "Lymans Marijuana LLC (Company) has requested that Timberland Bank (Financial Institution) permit it to initiate Entries" }],
  } as TimberlandFact<string>,
  accountLast4: {
    value: "6048",
    kind: "bank",
    label: "The company account at Timberland, last four digits only.",
    cites: [{ source: A, section: "Preamble (p.1)", quote: "to and/or from company account(s) [ACCOUNT ENDING 6048] maintained at Timberland Bank" }],
  } as TimberlandFact<string>,
  allowedSec: {
    value: ["PPD", "CCD"] as readonly string[],
    kind: "bank",
    label: "The only entry types Greenway may send: PPD (payroll to people) and CCD (to companies).",
    cites: [
      { source: A, section: "\u00a71 Types of Entries (p.1)", quote: "\u2612CCD \u2013 Corporate Credit or Debit" },
      { source: A, section: "\u00a71 Types of Entries (p.1)", quote: "\u2612PPD \u2013 Prearranged Payment and Deposit" },
    ],
  } as TimberlandFact<readonly string[]>,
  restrictedSec: {
    value: ["IAT", "CTX", "TEL", "POP", "BOC", "ARC", "RCK"] as readonly string[],
    kind: "bank",
    label: "Entry types Timberland restricts. The file builder must never produce any of them.",
    cites: [{ source: A, section: "Schedule E \u2013 Restricted ACH Transactions (p.11)", quote: "Financial Institution has identified the following ACH transaction restrictions: IAT, CTX, TEL, POP, BOC, ARC, RCK" }],
  } as TimberlandFact<readonly string[]>,
  debitsAllowed: {
    value: false,
    kind: "bank",
    label: "No debit files. ACH Collections is not ticked and the debit limits are $0.00.",
    cites: [{ source: A, section: "Schedule C \u2013 ACH Exposure Limits (p.10, verified transcription)", quote: "[ ] ACH Collections .......................................... $0.00" }],
  } as TimberlandFact<boolean>,
  debitLimitCents: {
    value: 0,
    kind: "bank",
    label: "Daily and monthly debit limit.",
    cites: [
      { source: A, section: "Schedule C (p.10, verified transcription)", quote: "Maximum daily aggregate limit of all debit files ............. $0.00" },
      { source: A, section: "Schedule C (p.10, verified transcription)", quote: "Maximum monthly aggregate limit of all debit files ........... $0.00" },
    ],
  } as TimberlandFact<number>,
  sameDayAllowed: {
    value: false,
    kind: "bank",
    label: "Same Day ACH is not enabled.",
    cites: [{ source: A, section: "Schedule C (p.10, verified transcription)", quote: "Same Day ACH [ ] Yes [X] No" }],
  } as TimberlandFact<boolean>,
  requireUnbalanced: {
    value: true,
    kind: "bank",
    label: "Files must be unbalanced: credits only, no offsetting settlement entry.",
    cites: [
      { source: B, section: "Email 1", quote: "Make sure that it\u2019s an unbalanced batch" },
      { source: A, section: "\u00a714 Form and Format (p.3)", quote: "Financial Institution shall notify Company whether Entries shall be in the form of balanced or unbalanced files." },
    ],
  } as TimberlandFact<boolean>,
  uploadCutoff: {
    value: { hour: 16, minute: 0, tz: "America/Los_Angeles" } as ClockTime,
    kind: "bank",
    label: "Upload AND approval at Timberland by 4:00 pm Pacific.",
    cites: [
      { source: A, section: "Schedule A \u2014 Delivery Specifications (p.9)", quote: "All ACH input files must be received by Financial Institution no later than 4:00 p.m. PST to be processed on that same day." },
      { source: B, section: "Email 2, answer 7", quote: "7. Upload and approvals by 4 pm" },
      { source: B, section: "Email 1", quote: "Cutoff time is 4 pm daily to have a file processed next day." },
    ],
  } as TimberlandFact<ClockTime>,
  creditLeadBankingDays: {
    value: 2,
    kind: "bank",
    label: "A credit file must reach Timberland at least 2 banking days before its effective date.",
    cites: [{ source: A, section: "Schedule A \u2014 Delivery Specifications (p.9)", quote: "Input files containing credit transactions must be transmitted or delivered to Financial Institution at least 2 banking days prior to the Effective Entry Date" }],
  } as TimberlandFact<number>,
  safetyMarginMinutes: {
    value: 30,
    kind: "greenway_policy",
    label: "Greenway's own margin: our deadline is 30 minutes before Timberland's (3:30 pm). Not a bank rule.",
    cites: [],
  } as TimberlandFact<number>,
  holidayShiftCredits: {
    value: "prior" as "prior" | "next",
    kind: "bank",
    label: "If the effective date is a holiday, credits move to the banking day BEFORE it.",
    cites: [{ source: A, section: "Schedule D \u2014 Standard Holidays (p.11)", quote: "the effective day should be changed to the business day immediately prior to the holiday for credits" }],
  } as TimberlandFact<"prior" | "next">,
  fundingDeadline: {
    value: { hour: 9, minute: 0, tz: "America/Los_Angeles" } as ClockTime,
    kind: "bank",
    label: "Money for a file must be in the account by 9:00 am Pacific on the settlement date.",
    cites: [{ source: A, section: "\u00a714 Entry Settlement (p.3)", quote: "Company shall provide Financial Institution with immediately available funds not later than 9:00 a.m. PST on each Settlement Date" }],
  } as TimberlandFact<ClockTime>,
  limitPerEntryCents: {
    value: 5_000_000,
    kind: "bank",
    label: "No single payment over $50,000.",
    cites: [
      { source: B, section: "Email 1", quote: "$50,000 per transaction, $100,000 per month." },
      { source: A, section: "Appendix B (p.8, verified transcription)", quote: "A. Michael Lyman | Rights: Enter [X] Approve [X] | Account(s): [ACCOUNT ENDING 6048] | Limits: $50,000" },
    ],
  } as TimberlandFact<number>,
  limitPerFileCents: {
    value: 5_000_000,
    kind: "bank",
    label: "No single file (ACH Batch) over $50,000.",
    cites: [{ source: A, section: "Schedule C (p.10, verified transcription)", quote: "[X] ACH Batch ................................................ $ 50,000.00" }],
  } as TimberlandFact<number>,
  limitDailyInProcessCents: {
    value: 5_000_000,
    kind: "bank",
    label: "No more than $50,000 of credit files in process on any day.",
    cites: [
      { source: A, section: "Schedule C (p.10, verified transcription)", quote: "Maximum daily aggregate limit of all credit files ............ $ 50,000.00" },
      { source: A, section: "\u00a726 Exposure Limits (p.5)", quote: "means the maximum daily aggregate amount of In-Process Entries permitted to be outstanding at any time" },
    ],
  } as TimberlandFact<number>,
  limitMonthlyCents: {
    value: 10_000_000,
    kind: "bank",
    label: "No more than $100,000 of credit files in a month.",
    cites: [
      { source: A, section: "Schedule C (p.10, verified transcription)", quote: "Maximum monthly aggregate limit of all credit files .......... $100,000.00" },
      { source: B, section: "Email 1", quote: "$50,000 per transaction, $100,000 per month." },
    ],
  } as TimberlandFact<number>,
  prenotesCount: {
    value: false,
    kind: "bank",
    label: "Prenotes ($0 test entries) do not count toward the monthly limit.",
    cites: [{ source: B, section: "Email 2, answer 6", quote: "6. Calendar days \u2013 no pre-notes do not count as they will process with a zero dollar limit" }],
  } as TimberlandFact<boolean>,
  overLimitRequestLeadBankingDays: {
    value: 2,
    kind: "bank",
    label: "A one-time higher limit must be asked for at least 2 banking days ahead.",
    cites: [{ source: A, section: "\u00a726 Exposure Limits (p.5)", quote: "Company must submit its request at least 2 banking days prior to the date on which Company wishes to initiate the Entry" }],
  } as TimberlandFact<number>,
  prenoteWaitBankingDays: {
    value: 6,
    kind: "bank",
    label: "After a prenote settles, wait 6 banking days before a live payment to that account.",
    cites: [
      { source: A, section: "\u00a76 Prenotification (p.2)", quote: "it agrees not to initiate live dollar Entries until at least 6 banking days following the settlement date of the prenotification Entry" },
      { source: B, section: "Email 2, answer 5", quote: "5. Banking days" },
      { source: B, section: "Email 1", quote: "You need 6 days to confirm if that account number is correct or not." },
    ],
  } as TimberlandFact<number>,
  prenoteWaitFrom: {
    value: "settlement" as const,
    kind: "bank",
    label: "The 6 days count from the prenote's settlement date.",
    cites: [{ source: A, section: "\u00a76 Prenotification (p.2)", quote: "until at least 6 banking days following the settlement date of the prenotification Entry" }],
  } as TimberlandFact<"settlement">,
  nocApplyBankingDays: {
    value: 6,
    kind: "bank",
    label: "Apply a bank correction (NOC) within 6 banking days.",
    cites: [{ source: A, section: "\u00a77 Notifications of Change (p.2)", quote: "Company agrees to make the changes submitted within 6 banking days of the receipt of the NOC information" }],
  } as TimberlandFact<number>,
  refusedNocCalendarDays: {
    value: 15,
    kind: "bank",
    label: "A wrong NOC must be refused within 15 calendar days.",
    cites: [{ source: A, section: "\u00a77 Notifications of Change (p.2)", quote: "Company will generate a Refused NOC and deliver it to Financial Institution within 15 calendar days" }],
  } as TimberlandFact<number>,
  returnNoticeBankingDays: {
    value: 1,
    kind: "bank",
    label: "Timberland tells us of a returned payment within 1 banking day of receiving it.",
    cites: [{ source: A, section: "\u00a720 Return Entries (p.4)", quote: "no later than 1 banking day after the banking day of such receipt" }],
  } as TimberlandFact<number>,
  reversalBankingDays: {
    value: 5,
    kind: "bank",
    label: "A reversal must be within 5 banking days of the original payment.",
    cites: [
      { source: A, section: "\u00a721 Reversals (p.4)", quote: "within 5 banking days of the original Entry or Entries and within 24 hours of discovery of the error" },
      { source: B, section: "Email 1", quote: "NACHA rules state that you can reverse a transaction up to 5 business days." },
    ],
  } as TimberlandFact<number>,
  reversalHoursFromDiscovery: {
    value: 24,
    kind: "bank",
    label: "... and within 24 hours of finding the mistake.",
    cites: [{ source: A, section: "\u00a721 Reversals (p.4)", quote: "within 5 banking days of the original Entry or Entries and within 24 hours of discovery of the error" }],
  } as TimberlandFact<number>,
  authCopyBankingDays: {
    value: 5,
    kind: "bank",
    label: "If Timberland asks for a payee's authorization, send a copy within 5 banking days.",
    cites: [{ source: A, section: "\u00a75 Authorizations (p.2)", quote: "Company, upon request, must present a copy of the Customer's authorization to Financial Institution within 5 banking days." }],
  } as TimberlandFact<number>,
  authRetainYearsAfterRevocation: {
    value: 2,
    kind: "bank",
    label: "Keep each authorization for 2 years after it ends.",
    cites: [{ source: A, section: "\u00a75 Authorizations (p.2)", quote: "for a period of two calendar years following the termination or revocation of the authorization" }],
  } as TimberlandFact<number>,
  entryDataRetainYears: {
    value: 1,
    kind: "bank",
    label: "Keep the data to remake a file for 1 year after it was sent.",
    cites: [{ source: A, section: "\u00a712 Data Retention (p.3)", quote: "Company shall retain data to permit remaking of entries for one calendar year following the date of their transmittal" }],
  } as TimberlandFact<number>,
  statementReviewCalendarDays: {
    value: 30,
    kind: "bank",
    label: "Report a statement error within 30 calendar days.",
    cites: [{ source: A, section: "\u00a717 Settlement Discrepancies (p.3)", quote: "Company agrees to notify Financial Institution within a reasonable time not to exceed 30 calendar days" }],
  } as TimberlandFact<number>,
  reserveBankingDays: {
    value: 10,
    kind: "bank",
    label: "If Timberland demands a reserve, fund it within 10 banking days.",
    cites: [{ source: A, section: "\u00a722 Reserves (p.4)", quote: "Company agrees to establish reserves as required by Financial Institution within 10 banking days" }],
  } as TimberlandFact<number>,
  terminationNoticeCalendarDays: {
    value: 3,
    kind: "bank",
    label: "Either side may end the agreement with 3 calendar days' written notice (Timberland may end it at once for a violation).",
    cites: [{ source: A, section: "\u00a730 Termination of Agreement (p.5)", quote: "Either party may terminate this Agreement upon 3 calendar days written notice" }],
  } as TimberlandFact<number>,
  compromiseWrittenConfirmCalendarDays: {
    value: 1,
    kind: "bank",
    label: "If a password or code may be stolen: phone Timberland at once, then confirm in writing within 1 calendar day.",
    cites: [{ source: A, section: "Schedule F - Security Procedures (p.11)", quote: "Company will verbally notify Financial Institution immediately, followed by written confirmation within 1 calendar day of verbal notice." }],
  } as TimberlandFact<number>,
  timberlandPhone: {
    value: "1-800-562-8761",
    kind: "bank",
    label: "Timberland Bank's published phone number (Schedule G).",
    cites: [{ source: A, section: "Schedule G: Token or Text Security (p.12)", quote: "You may contact Timberland Bank at 1-800-562-8761." }],
  } as TimberlandFact<string>,
  fees: {
    value: { serviceMonthly: 5000, perReturnOrNoc: 500, nachaCdYearly: 2400, lostTokenReplacement: 2500 } as TimberlandFees,
    kind: "bank",
    label: "Timberland's ACH fees, in cents.",
    cites: [
      { source: A, section: "Schedule B \u2013 Fees (p.9)", quote: "ACH Service Fee $ 50.00 per month" },
      { source: A, section: "Schedule B \u2013 Fees (p.9)", quote: "Return/NOC $ 5.00 per item" },
      { source: A, section: "Schedule B \u2013 Fees (p.9)", quote: "Corporate Nacha CD $ 24.00 per year" },
      { source: A, section: "Schedule G: Token or Text Security (p.12)", quote: "The replacement fee for a lost token is $25.00." },
    ],
  } as TimberlandFact<TimberlandFees>,
  bankDualApprovalOnFile: {
    value: false,
    kind: "bank",
    label: "Dual approval at Timberland is NOT turned on (the owner chose this; information only).",
    cites: [{ source: A, section: "Schedule C (p.10, verified transcription)", quote: "Dual Approval Required (Recommended by Bank) [ ] Yes [X] No" }],
  } as TimberlandFact<boolean>,
  bankCallbacks: {
    value: false,
    kind: "bank",
    label: "Timberland does not phone to confirm ACH files.",
    cites: [{ source: B, section: "Email 1", quote: "We do not do call-backs for ACH." }],
  } as TimberlandFact<boolean>,
  bankRejectsDuplicateFiles: {
    value: false,
    kind: "bank",
    label: "Timberland's portal will NOT stop a repeated file. Our own duplicate check is the only one.",
    cites: [{ source: B, section: "Email 2, answer 9 (to question 9 as drafted)", quote: "9. No they should not" }],
  } as TimberlandFact<boolean>,
  fileNameRequirements: {
    value: "none" as const,
    kind: "bank",
    label: "No required file name, extension or format beyond the standard ACH layout.",
    cites: [
      { source: B, section: "Email 2, answer 8", quote: "8. Nothing required" },
      { source: A, section: "Schedule A (p.9)", quote: "All ACH input files must be in the standard ACH format based on the NACHA Operating Rules." },
    ],
  } as TimberlandFact<"none">,
  testFileAccepted: {
    value: true,
    kind: "bank",
    label: "Timberland will accept a test file before the first live payroll.",
    cites: [{ source: B, section: "Email 2, answer 10", quote: "10. Yes" }],
  } as TimberlandFact<boolean>,
  timberlandUsersOnFile: {
    value: [{ name: "Michael Lyman", enter: true, approve: true, limitCents: 5_000_000 }] as readonly TimberlandUserOnFile[],
    kind: "bank",
    label: "The only Timberland portal user: Michael, who enters and approves (the intended setup, owner round 5).",
    cites: [{ source: A, section: "Appendix B (p.8, verified transcription)", quote: "A. Michael Lyman | Rights: Enter [X] Approve [X] | Account(s): [ACCOUNT ENDING 6048] | Limits: $50,000" }],
  } as TimberlandFact<readonly TimberlandUserOnFile[]>,
  achContactsOnFile: {
    value: ["Michael Lyman", "Alyssa Lyman"] as readonly string[],
    kind: "bank",
    label: "People Timberland may contact about ACH. Display only: this gives nobody access to the app.",
    cites: [
      { source: A, section: "Appendix B (p.8, verified transcription)", quote: "B. ACH contacts: Michael Lyman |" },
      { source: A, section: "Appendix B (p.8, verified transcription)", quote: "Alyssa Lyman |" },
    ],
  } as TimberlandFact<readonly string[]>,
} as const;

export type TimberlandFactKey = keyof typeof TIMBERLAND_PROFILE;

// Named constants (the names the R41 plan uses). They READ the profile, so a
// value has exactly one home and its quote travels with it.
export const TIMBERLAND_ROUTING = TIMBERLAND_PROFILE.routing.value;
export const TIMBERLAND_ODFI = TIMBERLAND_PROFILE.odfi.value;
export const BATCH_COMPANY_NAME = TIMBERLAND_PROFILE.batchCompanyName.value;
export const COMPANY_ID_PREFIX = TIMBERLAND_PROFILE.companyIdPrefix.value;
export const CONTRACT_LEGAL_NAME = TIMBERLAND_PROFILE.contractLegalName.value;
export const ACCOUNT_LAST4 = TIMBERLAND_PROFILE.accountLast4.value;
export const ALLOWED_SEC = TIMBERLAND_PROFILE.allowedSec.value;
export const RESTRICTED_SEC = TIMBERLAND_PROFILE.restrictedSec.value;
export const DEBITS_ALLOWED = TIMBERLAND_PROFILE.debitsAllowed.value;
export const DEBIT_LIMIT_CENTS = TIMBERLAND_PROFILE.debitLimitCents.value;
export const SAME_DAY_ALLOWED = TIMBERLAND_PROFILE.sameDayAllowed.value;
export const REQUIRE_UNBALANCED = TIMBERLAND_PROFILE.requireUnbalanced.value;
export const UPLOAD_CUTOFF = TIMBERLAND_PROFILE.uploadCutoff.value;
export const CREDIT_LEAD_BANKING_DAYS = TIMBERLAND_PROFILE.creditLeadBankingDays.value;
export const SAFETY_MARGIN_MIN = TIMBERLAND_PROFILE.safetyMarginMinutes.value;
export const HOLIDAY_SHIFT_CREDITS = TIMBERLAND_PROFILE.holidayShiftCredits.value;
export const FUNDING_DEADLINE = TIMBERLAND_PROFILE.fundingDeadline.value;
export const LIMIT_PER_ENTRY_CENTS = TIMBERLAND_PROFILE.limitPerEntryCents.value;
export const LIMIT_PER_FILE_CENTS = TIMBERLAND_PROFILE.limitPerFileCents.value;
export const LIMIT_DAILY_IN_PROCESS_CENTS = TIMBERLAND_PROFILE.limitDailyInProcessCents.value;
export const LIMIT_MONTHLY_CENTS = TIMBERLAND_PROFILE.limitMonthlyCents.value;
export const PRENOTES_COUNT = TIMBERLAND_PROFILE.prenotesCount.value;
export const OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS = TIMBERLAND_PROFILE.overLimitRequestLeadBankingDays.value;
export const PRENOTE_WAIT_BANKING_DAYS = TIMBERLAND_PROFILE.prenoteWaitBankingDays.value;
export const PRENOTE_WAIT_FROM = TIMBERLAND_PROFILE.prenoteWaitFrom.value;
export const NOC_APPLY_BANKING_DAYS = TIMBERLAND_PROFILE.nocApplyBankingDays.value;
export const REFUSED_NOC_CALENDAR_DAYS = TIMBERLAND_PROFILE.refusedNocCalendarDays.value;
export const RETURN_NOTICE_BANKING_DAYS = TIMBERLAND_PROFILE.returnNoticeBankingDays.value;
export const REVERSAL_BANKING_DAYS = TIMBERLAND_PROFILE.reversalBankingDays.value;
export const REVERSAL_HOURS_FROM_DISCOVERY = TIMBERLAND_PROFILE.reversalHoursFromDiscovery.value;
export const AUTH_COPY_BANKING_DAYS = TIMBERLAND_PROFILE.authCopyBankingDays.value;
export const AUTH_RETAIN_YEARS_AFTER_REVOCATION = TIMBERLAND_PROFILE.authRetainYearsAfterRevocation.value;
export const ENTRY_DATA_RETAIN_YEARS = TIMBERLAND_PROFILE.entryDataRetainYears.value;
export const STATEMENT_REVIEW_CALENDAR_DAYS = TIMBERLAND_PROFILE.statementReviewCalendarDays.value;
export const RESERVE_BANKING_DAYS = TIMBERLAND_PROFILE.reserveBankingDays.value;
export const TERMINATION_NOTICE_CALENDAR_DAYS = TIMBERLAND_PROFILE.terminationNoticeCalendarDays.value;
export const COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS = TIMBERLAND_PROFILE.compromiseWrittenConfirmCalendarDays.value;
export const TIMBERLAND_PHONE = TIMBERLAND_PROFILE.timberlandPhone.value;
export const FEES = TIMBERLAND_PROFILE.fees.value;
export const BANK_DUAL_APPROVAL_ON_FILE = TIMBERLAND_PROFILE.bankDualApprovalOnFile.value;
export const BANK_CALLBACKS = TIMBERLAND_PROFILE.bankCallbacks.value;
export const BANK_REJECTS_DUPLICATE_FILES = TIMBERLAND_PROFILE.bankRejectsDuplicateFiles.value;
export const TIMBERLAND_USERS_ON_FILE = TIMBERLAND_PROFILE.timberlandUsersOnFile.value;
export const ACH_CONTACTS_ON_FILE = TIMBERLAND_PROFILE.achContactsOnFile.value;

// ───────────────────────────────────────────────────────────────────────────
// 3. Open questions (R41 plan section 9; Q2 removed by the owner, round 5)
// ───────────────────────────────────────────────────────────────────────────

export type OpenQuestion = {
  id: string;
  /** Plain English, shown on screen. */
  label: string;
  /** What the later slices do until Timberland answers. Always the strict reading. */
  strictDefault: string;
  /** Profile facts this answer could change. Updated together with the mirror. */
  affects: readonly TimberlandFactKey[];
  infoOnly?: true;
};

export const OPEN_QUESTIONS: readonly OpenQuestion[] = [
  {
    id: "Q1",
    label: "Dual approval at Timberland is off and Michael is the only user. What form turns it on, if ever wanted?",
    strictDefault: "Information only. Nothing waits for a second Timberland user (owner round 5, D-1 and D-2).",
    affects: ["bankDualApprovalOnFile", "timberlandUsersOnFile"],
    infoOnly: true,
  },
  {
    id: "Q3",
    label: "Is the $50,000 daily limit counted by upload day, by effective date, or as the total not yet settled? Is the $100,000 month counted by upload or effective date?",
    strictDefault: "Every calendar day from upload to settlement must stay at or under $50,000 in flight, and the file counts in BOTH its upload month and its effective month.",
    affects: ["limitDailyInProcessCents", "limitMonthlyCents"],
  },
  {
    id: "Q4",
    label: "Schedule A says 2 banking days before the effective date by 4:00 pm. Brenda's email said 4 pm for next-day processing. Which applies?",
    strictDefault: "2 banking days before the effective date, by 4:00 pm Pacific.",
    affects: ["creditLeadBankingDays", "uploadCutoff"],
  },
  {
    id: "Q5",
    label: "Is \"4:00 p.m. PST\" Pacific local time all year (4:00 pm PDT in summer)?",
    strictDefault: "Pacific local time (America/Los_Angeles). In summer this is earlier than 4:00 pm PST, so it is the strict reading either way.",
    affects: ["uploadCutoff", "fundingDeadline"],
  },
  {
    id: "Q6",
    label: "Must collected funds be in the account at upload time, or only by 9:00 am on the settlement date?",
    strictDefault: "Collected funds in account ending 6048 before upload, and still there at 9:00 am Pacific on the settlement date.",
    affects: ["fundingDeadline"],
  },
  {
    id: "Q7",
    label: "After a prenote settles and 6 banking days pass, is that the earliest UPLOAD day for the live file, or the earliest EFFECTIVE date?",
    strictDefault: "The earliest upload day (the strict reading of \"initiate\").",
    affects: ["prenoteWaitBankingDays", "prenoteWaitFrom"],
  },
  {
    id: "Q8",
    label: "Our debit limits are $0, so we cannot send a reversal file. Is a reversal done by calling Timberland, and who do we ask for?",
    strictDefault: "No reversal files are ever built. The action is \"Call Timberland now\" at 1-800-562-8761, inside both clocks (24 hours, 5 banking days).",
    affects: ["debitsAllowed", "reversalBankingDays", "reversalHoursFromDiscovery", "timberlandPhone"],
  },
  {
    id: "Q9",
    label: "Is Timberland open for ACH on Fridays before a Saturday holiday (for example 12/24/2027 and 12/31/2027)?",
    strictDefault: "Treat those Fridays as NOT usable for upload or effective dates.",
    affects: ["holidayShiftCredits"],
  },
  {
    id: "Q10",
    label: "How will Timberland tell us about returns and NOCs (email, portal, phone), and to whom?",
    strictDefault: "Check the Timberland portal every banking day; do not rely on an email arriving.",
    affects: ["returnNoticeBankingDays", "achContactsOnFile"],
  },
  {
    id: "Q11",
    label: "The file header has a 23-character Immediate Origin Name. We send \"GREENWAY MARIJUANA\". Is that right, or \"LYMANS MARIJUANA LLC\"?",
    strictDefault: "Keep \"GREENWAY MARIJUANA\" (unchanged) and show all three names side by side so nobody \"fixes\" one to match another.",
    affects: ["batchCompanyName", "contractLegalName"],
  },
  {
    id: "Q12",
    label: "Please send a copy with Timberland's countersignature (their signature block is blank on our copy).",
    strictDefault: "The agreement shows as company-signed, bank countersignature NOT on file. The calendar task is never marked done without it.",
    affects: [],
  },
  {
    id: "Q13",
    label: "Sections 28 and 31 mention Schedules A through H, but our copy ends at G. Is there a Schedule H?",
    strictDefault: "Cite every schedule by its title, never by letter alone.",
    affects: [],
  },
  {
    id: "Q14",
    label: "Brenda's first email said Nacha \"requires PAYROLL be added in the discretionary data field\"; her later answer 4 said \"Company entry description is good\". Does she ALSO want PAYROLL in the discretionary data field?",
    strictDefault: "Recorded, not decided. Nothing in S1 changes the file: PAYROLL stays in the Company Entry Description. Found in R41 S1; ask Brenda before the file-builder slice.",
    affects: [],
  },
];

/**
 * Whether the two emails disagree about PAYROLL placement (Q14). Exposed so a
 * later slice must look at it, and so a test pins that both sentences exist.
 */
export const PAYROLL_PLACEMENT_QUOTES: readonly TimberlandCite[] = [
  { source: B, section: "Email 1", quote: "This is a new NACHA rule that yes requires PAYROLL be added in the discretionary data field." },
  { source: B, section: "Email 2, answer 4", quote: "4. Company entry description is good" },
];

/** Every cite in the profile, plus the Q14 quotes, for the mirror test. */
export function allTimberlandCites(): { key: string; cite: TimberlandCite }[] {
  const out: { key: string; cite: TimberlandCite }[] = [];
  for (const [key, fact] of Object.entries(TIMBERLAND_PROFILE) as [string, TimberlandFact<unknown>][]) {
    for (const cite of fact.cites) out.push({ key, cite });
  }
  for (const cite of PAYROLL_PLACEMENT_QUOTES) out.push({ key: "Q14", cite });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Value-in-quote checks (pure). Each returns problems; [] = consistent.
// ───────────────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Readonly<Record<number, string>> = { 1: "one", 2: "two", 3: "three" };

function clockText(t: ClockTime): string[] {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const ap = t.hour < 12 ? "a.m." : "p.m.";
  const mm = String(t.minute).padStart(2, "0");
  return [`${h12}:${mm} ${ap} PST`, t.minute === 0 ? `${h12} ${t.hour < 12 ? "am" : "pm"}` : `${h12}:${mm}`];
}

/**
 * The consistency rules: every fact's value must be readable in its own words.
 * Returned as messages so the vitest file can print exactly what drifted.
 */
export function timberlandProfileProblems(p: typeof TIMBERLAND_PROFILE = TIMBERLAND_PROFILE): string[] {
  const bad: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) bad.push(msg);
  };
  const q = (key: TimberlandFactKey) => (p[key] as TimberlandFact<unknown>).cites.map((c) => flattenWs(c.quote));
  const has = (key: TimberlandFactKey, s: string) => q(key).some((x) => x.includes(s));
  const days = (key: TimberlandFactKey, unit: string) => {
    const v = (p[key] as TimberlandFact<number>).value;
    return has(key, `${v} ${unit}`) || (NUMBER_WORDS[v] !== undefined && has(key, `${NUMBER_WORDS[v]} ${unit}`));
  };

  need(isValidRouting(p.routing.value), "routing fails the ABA check digit");
  need(has("routing", p.routing.value), "routing value not in its quote");
  need(p.odfi.value === dfiId8(p.routing.value), "ODFI is not the first 8 digits of the routing number");
  need(has("batchCompanyName", p.batchCompanyName.value) && p.batchCompanyName.value.length <= 16, "batch Company Name not in its quote or longer than 16");
  need(has("companyIdPrefix", `${p.companyIdPrefix.value} + EIN`), "Company ID prefix not in its quote");
  need(has("contractLegalName", p.contractLegalName.value), "legal name not in its quote");
  need(/^\d{4}$/.test(p.accountLast4.value) && has("accountLast4", `[ACCOUNT ENDING ${p.accountLast4.value}]`), "last four not in its quote");
  for (const sec of p.allowedSec.value) need(has("allowedSec", `\u2612${sec} \u2013`), `allowed SEC ${sec} not ticked in its quote`);
  need(p.allowedSec.value.length === p.allowedSec.cites.length, "one ticked-box quote per allowed SEC");
  need(has("restrictedSec", p.restrictedSec.value.join(", ")), "restricted SEC list not exactly its quote");
  need(!p.allowedSec.value.some((s) => p.restrictedSec.value.includes(s)), "an SEC code is both allowed and restricted");
  need(p.debitsAllowed.value === false && has("debitsAllowed", "[ ] ACH Collections"), "debits: value or box disagree");
  need(q("debitLimitCents").length === 2 && q("debitLimitCents").every((x) => x.endsWith(`$${centsToUsdText(p.debitLimitCents.value)}`)), "debit limit not in both quotes");
  need(p.sameDayAllowed.value === false && has("sameDayAllowed", "[ ] Yes [X] No"), "same day: value or box disagree");
  need(p.requireUnbalanced.value === true && has("requireUnbalanced", "unbalanced batch"), "unbalanced: value or quote disagree");
  for (const t of clockText(p.uploadCutoff.value)) need(has("uploadCutoff", t), `upload cutoff "${t}" not in its quotes`);
  need(has("fundingDeadline", clockText(p.fundingDeadline.value)[0]!), "funding deadline not in its quote");
  need(days("creditLeadBankingDays", "banking days prior"), "credit lead days not in its quote");
  need(p.safetyMarginMinutes.kind === "greenway_policy" && p.safetyMarginMinutes.cites.length === 0, "the safety margin must be labelled Greenway policy, with no bank quote");
  need(has("holidayShiftCredits", `immediately ${p.holidayShiftCredits.value} to the holiday for credits`), "holiday shift direction not in its quote");
  need(has("limitPerEntryCents", `$${centsToUsdText(p.limitPerEntryCents.value).replace(/\.00$/, "")} per transaction`), "per-entry limit not in Brenda's quote");
  need(has("limitPerEntryCents", `Limits: $${centsToUsdText(p.limitPerEntryCents.value).replace(/\.00$/, "")}`), "per-entry limit not in Appendix B");
  need(has("limitPerFileCents", `[X] ACH Batch`) && q("limitPerFileCents")[0]!.endsWith(`$ ${centsToUsdText(p.limitPerFileCents.value)}`), "per-file limit not in its quote");
  need(q("limitDailyInProcessCents")[0]!.endsWith(`$ ${centsToUsdText(p.limitDailyInProcessCents.value)}`), "daily limit not in its quote");
  need(q("limitMonthlyCents")[0]!.endsWith(`$${centsToUsdText(p.limitMonthlyCents.value)}`), "monthly limit not in Schedule C");
  need(has("limitMonthlyCents", `$${centsToUsdText(p.limitMonthlyCents.value).replace(/\.00$/, "")} per month`), "monthly limit not in Brenda's quote");
  need(p.limitDailyInProcessCents.value <= p.limitMonthlyCents.value, "daily limit above the monthly limit");
  need(p.limitPerEntryCents.value <= p.limitPerFileCents.value && p.limitPerFileCents.value <= p.limitDailyInProcessCents.value, "entry <= file <= daily ordering broken");
  need(p.prenotesCount.value === false && has("prenotesCount", "no pre-notes do not count"), "prenotes-count value or quote disagree");
  need(days("overLimitRequestLeadBankingDays", "banking days prior"), "over-limit request lead not in its quote");
  need(days("prenoteWaitBankingDays", "banking days following the settlement date"), "prenote wait not in the contract quote");
  need(has("prenoteWaitBankingDays", `You need ${p.prenoteWaitBankingDays.value} days`), "prenote wait not in Brenda's quote");
  need(p.prenoteWaitBankingDays.value >= NACHA_PRENOTE_WAIT_BANKING_DAYS, "Timberland's prenote wait is shorter than Nacha's minimum");
  need(has("prenoteWaitFrom", `following the ${p.prenoteWaitFrom.value} date`), "prenote start not in its quote");
  need(days("nocApplyBankingDays", "banking days of the receipt"), "NOC days not in its quote");
  need(days("refusedNocCalendarDays", "calendar days"), "refused NOC days not in its quote");
  need(days("returnNoticeBankingDays", "banking day after"), "return notice not in its quote");
  need(days("reversalBankingDays", "banking days of the original"), "reversal days not in the contract quote");
  need(has("reversalBankingDays", `up to ${p.reversalBankingDays.value} business days`), "reversal days not in Brenda's quote");
  need(has("reversalHoursFromDiscovery", `within ${p.reversalHoursFromDiscovery.value} hours of discovery`), "reversal hours not in its quote");
  need(days("authCopyBankingDays", "banking days."), "authorization copy days not in its quote");
  need(days("authRetainYearsAfterRevocation", "calendar years following"), "authorization retention not in its quote");
  need(days("entryDataRetainYears", "calendar year following"), "entry data retention not in its quote");
  need(days("statementReviewCalendarDays", "calendar days"), "statement review days not in its quote");
  need(days("reserveBankingDays", "banking days"), "reserve days not in its quote");
  need(days("terminationNoticeCalendarDays", "calendar days written notice"), "termination notice not in its quote");
  need(days("compromiseWrittenConfirmCalendarDays", "calendar day of verbal notice"), "compromise confirmation not in its quote");
  need(has("timberlandPhone", p.timberlandPhone.value) && /^1-800-\d{3}-\d{4}$/.test(p.timberlandPhone.value), "phone not in its quote, or not the bank's 1-800 line");
  const f = p.fees.value;
  need(has("fees", `ACH Service Fee $ ${centsToUsdText(f.serviceMonthly)} per month`), "service fee not in its quote");
  need(has("fees", `Return/NOC $ ${centsToUsdText(f.perReturnOrNoc)} per item`), "return fee not in its quote");
  need(has("fees", `Nacha CD $ ${centsToUsdText(f.nachaCdYearly)} per year`), "Nacha CD fee not in its quote");
  need(has("fees", `lost token is $${centsToUsdText(f.lostTokenReplacement)}`), "lost token fee not in its quote");
  need(p.bankDualApprovalOnFile.value === false && has("bankDualApprovalOnFile", "[ ] Yes [X] No"), "dual approval: value or box disagree");
  need(p.bankCallbacks.value === false && has("bankCallbacks", "We do not do call-backs"), "callbacks: value or quote disagree");
  need(p.bankRejectsDuplicateFiles.value === false && has("bankRejectsDuplicateFiles", "No they should not"), "duplicate files: value or quote disagree");
  need(p.testFileAccepted.value === true && has("testFileAccepted", "10. Yes"), "test file: value or quote disagree");
  for (const u of p.timberlandUsersOnFile.value) {
    need(
      has("timberlandUsersOnFile", `${u.name} | Rights: Enter [${u.enter ? "X" : " "}] Approve [${u.approve ? "X" : " "}]`) &&
        has("timberlandUsersOnFile", `Limits: $${centsToUsdText(u.limitCents).replace(/\.00$/, "")}`),
      `user ${u.name} rights or limit not in Appendix B`,
    );
  }
  need(p.timberlandUsersOnFile.value.length === 1, "Appendix B lists exactly one Timberland user (the other rows are blank)");
  for (const n of p.achContactsOnFile.value) need(has("achContactsOnFile", `${n} |`), `ACH contact ${n} not in Appendix B`);
  // every bank fact is cited; every cite names a section
  for (const [key, fact] of Object.entries(p) as [string, TimberlandFact<unknown>][]) {
    if (fact.kind === "bank") need(fact.cites.length > 0, `${key}: a bank fact with no quote`);
    for (const c of fact.cites) need(c.section.trim().length > 0 && c.quote.trim().length >= 4, `${key}: empty section or quote`);
    need(fact.label.trim().length > 0, `${key}: no plain-English label`);
  }
  return bad;
}

/** A 9-or-more digit run that is not the bank's routing number: a possible full account number. */
export function findLongDigitRuns(text: string, allowed: readonly string[] = [TIMBERLAND_PROFILE.routing.value]): string[] {
  return (text.match(/\d{9,}/g) ?? []).filter((m) => !allowed.includes(m));
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ───────────────────────────────────────────────────────────────────────────

export function __runTimberlandProfileCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL timberland-profile-core: ${msg}`);
    }
  };

  const problems = timberlandProfileProblems();
  ok(problems.length === 0, `profile is self-consistent (${problems.join("; ")})`);

  // The named constants are the profile values (one home per value).
  ok(TIMBERLAND_ROUTING === "325170754" && TIMBERLAND_ODFI === "32517075", "routing and ODFI");
  ok(isValidRouting(TIMBERLAND_ROUTING), "routing check digit");
  ok(BATCH_COMPANY_NAME === "GREENWAY MARIJUA" && BATCH_COMPANY_NAME.length === 16, "batch name is 16 characters");
  ok(CREDIT_LEAD_BANKING_DAYS === 2 && HOLIDAY_SHIFT_CREDITS === "prior", "lead 2, holiday prior");
  ok(UPLOAD_CUTOFF.hour === 16 && UPLOAD_CUTOFF.minute === 0 && UPLOAD_CUTOFF.tz === "America/Los_Angeles", "cutoff 4:00 pm Pacific");
  ok(FUNDING_DEADLINE.hour === 9 && FUNDING_DEADLINE.minute === 0, "funding 9:00 am");
  ok(LIMIT_PER_ENTRY_CENTS === 5_000_000 && LIMIT_PER_FILE_CENTS === 5_000_000 && LIMIT_DAILY_IN_PROCESS_CENTS === 5_000_000 && LIMIT_MONTHLY_CENTS === 10_000_000, "limits in cents");
  ok(LIMIT_DAILY_IN_PROCESS_CENTS <= LIMIT_MONTHLY_CENTS, "daily <= monthly");
  ok(PRENOTE_WAIT_BANKING_DAYS === 6 && PRENOTE_WAIT_BANKING_DAYS >= NACHA_PRENOTE_WAIT_BANKING_DAYS && NACHA_PRENOTE_WAIT_BANKING_DAYS === 3, "6 >= Nacha's 3");
  ok(!ALLOWED_SEC.some((s) => RESTRICTED_SEC.includes(s)) && ALLOWED_SEC.length === 2 && RESTRICTED_SEC.length === 7, "SEC lists are disjoint");
  ok(DEBITS_ALLOWED === false && DEBIT_LIMIT_CENTS === 0 && SAME_DAY_ALLOWED === false, "credits only, never same day");
  ok(FEES.serviceMonthly === 5000 && FEES.perReturnOrNoc === 500 && FEES.nachaCdYearly === 2400 && FEES.lostTokenReplacement === 2500, "fees in cents");
  ok(Object.values(FEES).every((c) => Number.isInteger(c)), "fees are whole cents");
  ok(SAFETY_MARGIN_MIN === 30 && TIMBERLAND_PROFILE.safetyMarginMinutes.kind === "greenway_policy", "safety margin is OUR policy");
  ok(ACCOUNT_LAST4 === "6048" && ACH_CONTACTS_ON_FILE.length === 2 && TIMBERLAND_USERS_ON_FILE.length === 1, "account last 4, contacts, users");
  ok(BANK_DUAL_APPROVAL_ON_FILE === false && BANK_CALLBACKS === false && BANK_REJECTS_DUPLICATE_FILES === false, "bank-side controls are off");

  // Helpers
  ok(flattenWs(" a\u00a0\u00a0b\n c ") === "a b c", "flattenWs folds NBSP and newlines");
  ok(centsToUsdText(5_000_000) === "50,000.00" && centsToUsdText(10_000_000) === "100,000.00" && centsToUsdText(0) === "0.00" && centsToUsdText(2501) === "25.01", "centsToUsdText");
  let threw = false;
  try {
    centsToUsdText(1.5);
  } catch {
    threw = true;
  }
  ok(threw, "centsToUsdText refuses fractional cents");
  ok(findLongDigitRuns("routing 325170754, ending 6048").length === 0, "routing and last-4 are allowed");
  // Built at run time so this public file never holds a 9+ digit literal itself.
  ok(findLongDigitRuns(`acct ${"12345".repeat(2)}6048`).length === 1, "a long digit run is flagged");

  // The consistency rules catch drift (each mutant must produce a problem).
  const P = TIMBERLAND_PROFILE;
  const mut = <K extends TimberlandFactKey>(key: K, patch: Partial<TimberlandFact<unknown>>): typeof TIMBERLAND_PROFILE =>
    ({ ...P, [key]: { ...P[key], ...patch } }) as unknown as typeof TIMBERLAND_PROFILE;
  ok(timberlandProfileProblems(mut("creditLeadBankingDays", { value: 1 })).length > 0, "lead 2 -> 1 is caught");
  ok(timberlandProfileProblems(mut("holidayShiftCredits", { value: "next" })).length > 0, "prior -> next is caught");
  ok(timberlandProfileProblems(mut("limitDailyInProcessCents", { value: 5_000_001 })).length > 0, "daily limit +1 cent is caught");
  ok(timberlandProfileProblems(mut("limitMonthlyCents", { value: 9_999_999 })).length > 0, "monthly limit -1 cent is caught");
  ok(timberlandProfileProblems(mut("odfi", { value: "32517076" })).length > 0, "ODFI drift is caught");
  ok(timberlandProfileProblems(mut("routing", { value: TIMBERLAND_ROUTING.slice(0, 8) + "5" })).length > 0, "bad routing check digit is caught");
  ok(timberlandProfileProblems(mut("prenoteWaitBankingDays", { value: 2 })).length > 0, "prenote wait below Nacha is caught");
  ok(timberlandProfileProblems(mut("allowedSec", { value: ["PPD", "CCD", "CTX"] })).length > 0, "a restricted SEC in the allow list is caught");
  ok(timberlandProfileProblems(mut("safetyMarginMinutes", { kind: "bank" })).length > 0, "policy dressed as a bank rule is caught");
  ok(timberlandProfileProblems(mut("authRetainYearsAfterRevocation", { value: 1 })).length > 0, "number-word retention drift is caught");
  ok(timberlandProfileProblems(mut("fees", { value: { ...FEES, perReturnOrNoc: 501 } })).length > 0, "fee drift is caught");
  ok(timberlandProfileProblems(mut("uploadCutoff", { value: { hour: 17, minute: 0, tz: "America/Los_Angeles" } })).length > 0, "cutoff drift is caught");
  ok(timberlandProfileProblems(mut("bankCallbacks", { value: true })).length > 0, "callbacks flip is caught");
  ok(timberlandProfileProblems(mut("routing", { cites: [] })).length > 0, "a bank fact with no quote is caught");

  // Open questions
  const ids = OPEN_QUESTIONS.map((x) => x.id);
  ok(JSON.stringify(ids) === JSON.stringify(["Q1", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14"]), "Q1, Q3-Q13 (Q2 removed) plus Q14");
  ok(OPEN_QUESTIONS.every((x) => x.label.length > 10 && x.strictDefault.length > 10), "every question has a label and a strict default");
  ok(OPEN_QUESTIONS.every((x) => x.affects.every((k) => k in TIMBERLAND_PROFILE)), "every affected fact exists");
  ok(OPEN_QUESTIONS.filter((x) => x.infoOnly).map((x) => x.id).join() === "Q1", "only Q1 is information only");
  ok(PAYROLL_PLACEMENT_QUOTES.length === 2, "both PAYROLL sentences recorded for Q14");
  ok(allTimberlandCites().length > 50, "cites collected for the mirror test");

  return { passed, failed };
}
