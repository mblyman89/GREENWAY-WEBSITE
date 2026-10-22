/**
 * R41 S19: the bank-side checklist for the owner's meeting with Brenda
 * (Timberland Cash Management) and the sourced ACH glossary.
 *
 * Pure, no I/O. Nothing here is guessed:
 *   - every quote is an exact substring (whitespace flattened) of a mirror in
 *     docs/authorities/ (tests/compliance/r41-s19-bank-setup.test.ts checks it);
 *   - an item is "confirmed" only when Brenda's own words on file say so;
 *     anything the mirrors do not answer is a question to ask, never an
 *     assumed answer (for example: whether Timberland offers an ACH filter,
 *     or what it costs, is not on record, so it is a question);
 *   - no account numbers, emails, EIN or surnames. The only phone is
 *     Timberland's published 1-800 number.
 */

export const SAO_FILE = "ach/wa-sao-ach-best-practices.txt";
export const TIMBERLAND_FILE = "ach/timberland-ach-agreement-2026-10-14.redacted.txt";
export const BRENDA_FILE = "ach/timberland-brenda-2026-10.txt";
export const BRENDA3_FILE = "ach/timberland-brenda-2026-10-19-email-3.txt";
export const FRB_FILE = "ach/frbservices-edi-encrypted-email-guide.txt";
export const NACHA_CED_FILE = "ach/nacha-company-entry-descriptions.txt";
export const TIMBERLAND_PHONE = "1-800-562-8761";

export const SOURCE_FILES = [SAO_FILE, TIMBERLAND_FILE, BRENDA_FILE, BRENDA3_FILE, FRB_FILE, NACHA_CED_FILE] as const;

export type SetupQuote = { readonly text: string; readonly file: (typeof SOURCE_FILES)[number]; readonly where: string };

export const SETUP_QUOTES = {
  // WA State Auditor, Best Practices for ACH Electronic Payments
  saoLimits: {
    text: "Set limits. You may set daily, monthly or transactional dollar limits by working with your bank.",
    file: SAO_FILE,
    where: "WA State Auditor, Best Practices for ACH Electronic Payments, p. 4",
  },
  saoBlocks: {
    text: "Use ACH blocks. Work with your bank to place blocks on any account not authorized for ACH transactions.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 4",
  },
  saoFilter: {
    text: "Use an ACH filter (also known as ACH positive pay). Use this tool to screen ACH activity and block incoming charges before the bank deducts them from your account.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 4",
  },
  saoFilterList: {
    text: "Set up a list of authorized vendors, dollar limits, start and end dates, and payment frequency.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 4",
  },
  saoTwoPeople: {
    text: "Require two people to send ACH payments. Work with your bank to set this up.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 4",
  },
  saoSeparateBanking: {
    text: "Employees who may add or edit ACH blocks or filters to bank accounts\u2014or are responsible for reconciling bank account activity\u2014should not play any role in the ACH payment process.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 5",
  },
  saoReadOnly: {
    text: "Use secure, read-only ACH payment files. Securely create, store and transmit ACH payment files to protect the sensitive data.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 6",
  },
  // Timberland ACH agreement (countersigned copy of 2026-10-14)
  tbDualBox: { text: "Dual Approval Required (Recommended by Bank)   [ ] Yes   [X] No", file: TIMBERLAND_FILE, where: "Timberland ACH agreement, Schedule C (as signed)" },
  tbSameDayBox: { text: "Same Day ACH   [ ] Yes   [X] No", file: TIMBERLAND_FILE, where: "Timberland ACH agreement, Schedule C (as signed)" },
  tbToken: {
    text: "Company will only transmit files using assigned Token Device or a code which can be sent to your phone by either text or phone call.. ACH file will not be transmitted if not approved with the code.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule F",
  },
  tbTokenLost: {
    text: "ACH Originator and/or Authorized user agrees to notify Financial Institution at once if it believes any credentials have been compromised by an unauthorized person or if a Token has become lost, stolen, or defective.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule G",
  },
  tbSupervision: {
    text: "Company warrants that no individual will be allowed to initiate transfers in the absence of proper supervision and safeguards",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 8",
  },
  tbPrenote: {
    text: "it agrees not to initiate live dollar Entries until at least 6 banking days following the settlement date of the prenotification Entry.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 6",
  },
  tbNoc: {
    text: "Company agrees to make the changes submitted within 6 banking days of the receipt of the NOC information or before the next \u201clive\u201d Entry, whichever is later.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 7",
  },
  tbReversal: {
    text: "Company also warrants that the account holder of a reversing Entry has been notified of the reversal, and the reason for the reversal, no later than the settlement day of the reversal.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 21",
  },
  tbReversalWindow: {
    text: "Company warrants that it has initiated the Entries or files within 5 banking days of the original Entry or Entries and within 24 hours of discovery of the error.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 21",
  },
  gAchNetwork: {
    text: "\u201cACH Network\u201d means the funds transfer system (network) governed by the NACHA Rules",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Appendix A (Glossary)",
  },
  gEffective: {
    text: "\u201cEffective Entry Date\u201d means the date placed on an ACH transaction by the Originator of the transaction or the ODFI \u2013 it is normally the date the Originator or ODFI intends the transfer to take place.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Appendix A",
  },
  gFile: { text: "\u201cFile\u201d means a group of ACH entries stored for delivery to an ACH receiving point.", file: TIMBERLAND_FILE, where: "Timberland ACH agreement, Appendix A" },
  gOdfi: {
    text: "\u201cODFI or Originating Depository Financial Institution\u201d means financial institutions that originate ACH transactions on behalf of its customers.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Appendix A",
  },
  gOriginator: { text: "\u201cOriginator\u201d means a company, individual or entity that initiates entries into the ACH Network.", file: TIMBERLAND_FILE, where: "Timberland ACH agreement, Appendix A" },
  gRdfi: {
    text: "\u201cRDFI or Receiving Depository Financial Institution\u201d means a financial institution qualified by NACHA to receive ACH transactions.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Appendix A",
  },
  gReturn: {
    text: "\u201cReturn Entry or Return Entries\u201d mean any item, which cannot be processed and is being returned by the RDFI to the ODFI for correction or re-initiation.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Appendix A",
  },
  gNocName: {
    text: "Financial Institution will notify Company of Correction Entries (COR), which are commonly referred to as Notification of Change (NOC) entries.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 7",
  },
  gPrenote: {
    text: "If Company chooses to originate non-dollar prenotification Entries to verify the accuracy of routing and account numbers",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 6",
  },
  gCcd: {
    text: "CCD \u2013 Corporate Credit or Debit - Either a credit or debit where funds are either distributed or consolidated between corporate entities.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 1",
  },
  gPpd: {
    text: "Direct Deposit - The transfer of funds into a consumer's account. Funds being deposited can represent a variety of products, such as payroll, interest, pension, dividends, etc.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 1 (PPD)",
  },
  gSameDay: {
    text: "Same Day ACH \u2014 An Entry for which the Effective Entry Date is the same Banking Day as the date on which the Entry is transmitted by the ODFI to its ACH Operator",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule A",
  },
  gPayroll: {
    text: "This rule requires Originators to use the standardized Company Entry Description \u201cPAYROLL\u201d for PPD credits for payment of wages, salaries and similar types of compensation.",
    file: NACHA_CED_FILE,
    where: "Nacha, Company Entry Descriptions (effective March 20, 2026)",
  },
  frbEncrypted: {
    text: "The reports are created, encrypted and sent to a password-protected internet portal, where they are retained for 60 calendar days.",
    file: FRB_FILE,
    where: "Federal Reserve, Payments Reporter Encrypted Email User Guide (rev. 06/26/24)",
  },
  frbDailyCheck: {
    text: "In case any notification emails are blocked, a best practice is to access the encrypted internet portal directly each day to check for reports.",
    file: FRB_FILE,
    where: "Federal Reserve, Encrypted Email User Guide",
  },
  // Brenda's own words (Timberland Cash Management)
  brUnbalanced: { text: "Make sure that it\u2019s an unbalanced batch", file: BRENDA_FILE, where: "Brenda, email 1" },
  brDualPrefer: { text: "We can set up dual approval and we prefer that.", file: BRENDA_FILE, where: "Brenda, email 1" },
  brLimits: { text: "We established limits in the ACH Agreement, $50,000 per transaction, $100,000 per month.", file: BRENDA_FILE, where: "Brenda, email 1" },
  brTestFile: { text: "10. Yes", file: BRENDA_FILE, where: "Brenda, email 2, answer 10 (a test file before the first live payroll)" },
  brDualOff: {
    text: "We have a change form that we would complete if you wish to turn on approvals. Currently this is not turned on.",
    file: BRENDA3_FILE,
    where: "Brenda, email 3, answer 1",
  },
  brLimitCount: { text: "The limit is by the day of the upload file and the monthly is by calendar month.", file: BRENDA3_FILE, where: "Brenda, email 3, answer 2" },
  brReverseCall: { text: "Yes you would call us to reverse a file.", file: BRENDA3_FILE, where: "Brenda, email 3, answer 7" },
  brNotices: {
    text: "Notices are delivered in 2 manners. The first is an email directly to you via the federal reserves website and it a secure encrypted email. The 2nd delivery method is under the reporting tab, electronic documents.",
    file: BRENDA3_FILE,
    where: "Brenda, email 3, answer 9",
  },
  brOfac: { text: "Yes we screen for OFAC for each person contained in a file. Cash Management would let you know.", file: BRENDA3_FILE, where: "Brenda, email 3, answer 21" },
  brTesting: {
    text: "Brenda has also told me she wants to discuss the details about our testing of the system with them.",
    file: BRENDA3_FILE,
    where: "Owner's note with email 3 (not Brenda's words)",
  },
  brUnbalancedOk: { text: "Total debits in the file are always $0.00. My software refuses to produce a file with a debit or a mixed (200) batch. That\u2019s good", file: BRENDA3_FILE, where: "Brenda, email 3, item 1c (her reply: That\u2019s good)" },
} as const satisfies Record<string, SetupQuote>;

export type SetupQuoteId = keyof typeof SETUP_QUOTES;

/** confirmed = Brenda's words on file settle it; ask = raise it at the meeting; decide = the owner's own choice. */
export type ChecklistStatus = "confirmed" | "ask" | "decide";

export type ChecklistItem = {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly status: ChecklistStatus;
  /** What is on record, in plain words. */
  readonly onRecord: string;
  /** Questions to ask Brenda (empty when nothing is left to ask). */
  readonly ask: readonly string[];
  /** Brenda's or the bank's own words that back onRecord. */
  readonly said: readonly SetupQuoteId[];
  /** Why it matters, in the source's own words. */
  readonly why: readonly SetupQuoteId[];
};

export const BANK_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "testing",
    title: "Testing the system with Timberland",
    hint: "Brenda asked to talk about testing. She has said yes to a test file before the first live payroll.",
    status: "ask",
    onRecord: "Brenda said yes to accepting a test file before the first live payroll, and has asked to discuss how the testing will go.",
    ask: [
      "How should the test file be sent: uploaded in the portal as normal, or another way?",
      "What will you check in it, and how will you tell us it passed?",
      "Should the test be a prenote ($0) file, a live file to the owner's own account, or both?",
      "After the test passes, is anything else needed before the first live payroll file?",
    ],
    said: ["brTestFile", "brTesting"],
    why: [],
  },
  {
    id: "portal",
    title: "Cash management login and the release code",
    hint: "Files are released with a token or a text/phone code. Confirm which one is set up for the owner.",
    status: "ask",
    onRecord: "The agreement says files are only released with a token or a code sent by text or phone call.",
    ask: [
      "Is the owner's login set up for a text code, a phone-call code, or a token?",
      "Who do we call to turn off the login quickly if a phone or token is lost? (The agreement gives " + TIMBERLAND_PHONE + ".)",
    ],
    said: ["tbToken"],
    why: ["tbTokenLost"],
  },
  {
    id: "dual",
    title: "Dual approval (two people to release a file)",
    hint: "Off today. Timberland prefers it on. Turning it on needs a second person with a login, so it is the owner's choice.",
    status: "decide",
    onRecord: "Dual approval is off and the owner is the only user. Timberland prefers it on and has a change form to turn it on.",
    ask: ["If Greenway turns dual approval on later, can you send the change form, and does the second person need their own token or text code?"],
    said: ["brDualOff", "brDualPrefer", "tbDualBox"],
    why: ["saoTwoPeople", "tbSupervision"],
  },
  {
    id: "debit-block",
    title: "ACH debit block on accounts that should never be debited",
    hint: "A block stops ACH charges on an account that should not receive them. Whether Timberland offers it is not on record yet.",
    status: "ask",
    onRecord: "Nothing on record. The State Auditor recommends blocks on any account not authorized for ACH.",
    ask: [
      "Does Timberland offer an ACH debit block? Which Greenway accounts could have one?",
      "Is there a fee, and what form turns it on?",
    ],
    said: [],
    why: ["saoBlocks"],
  },
  {
    id: "filter",
    title: "ACH filter (ACH positive pay) on the Main account",
    hint: "A filter lets only listed companies debit the account; anything else waits for review. Bank watch already catches unknown debits after they post; a bank filter stops them first.",
    status: "ask",
    onRecord: "Nothing on record. Greenway's Bank watch tab already reports unknown debits after they post. A bank filter would stop them before they post.",
    ask: [
      "Does Timberland offer an ACH filter or ACH positive pay? Is there a fee?",
      "Can it allow the regular payees (power, phone, card processor) by company ID and a dollar limit?",
      "How are flagged debits shown to the owner, and how long does the owner have to decide?",
    ],
    said: [],
    why: ["saoFilter", "saoFilterList", "saoSeparateBanking"],
  },
  {
    id: "notices",
    title: "Return and NOC notices: Fed encrypted email and electronic documents",
    hint: "Notices come by the Fed's encrypted email and under Reporting > electronic documents. Check both, every day.",
    status: "ask",
    onRecord: "Brenda said notices come two ways: the Federal Reserve's encrypted email, and the Reporting tab (electronic documents). She also emails the first time.",
    ask: [
      "Is the owner's email already registered for the Fed's encrypted email, or will an invitation come?",
      "Where exactly is Reporting > electronic documents in the new cash management login?",
    ],
    said: ["brNotices"],
    why: ["frbEncrypted", "frbDailyCheck", "tbNoc"],
  },
  {
    id: "limits",
    title: "Dollar limits",
    hint: "$50,000 per transaction and $100,000 per month, counted by upload day and calendar month.",
    status: "confirmed",
    onRecord: "$50,000 per transaction and $100,000 per month (Schedule C). Daily is by upload day; monthly is by calendar month.",
    ask: [],
    said: ["brLimits", "brLimitCount"],
    why: ["saoLimits"],
  },
  {
    id: "credits-only",
    title: "Credits only (unbalanced batch, no debits)",
    hint: "Greenway only sends money out. Brenda confirmed the unbalanced, credit-only file.",
    status: "confirmed",
    onRecord: "Every batch is credits only with no offsetting debit, and Brenda confirmed that is right.",
    ask: [],
    said: ["brUnbalanced", "brUnbalancedOk"],
    why: ["saoReadOnly"],
  },
  {
    id: "same-day",
    title: "Same Day ACH",
    hint: "Not signed up (Schedule C: No). Payroll is uploaded ahead, so it is not needed.",
    status: "confirmed",
    onRecord: "Schedule C says No. Greenway uploads ahead of the effective date, so Same Day ACH is not needed.",
    ask: [],
    said: ["tbSameDayBox"],
    why: [],
  },
  {
    id: "reversal",
    title: "Reversing a wrong file",
    hint: "Greenway's debit limit is $0, so a reversal is a phone call to Timberland. The 5-banking-day and 24-hour clock still applies.",
    status: "confirmed",
    onRecord: "Reversals are done by calling Timberland. Section 21's window still applies.",
    ask: [],
    said: ["brReverseCall"],
    why: ["tbReversalWindow", "tbReversal"],
  },
  {
    id: "ofac",
    title: "OFAC screening",
    hint: "Greenway screens every payee daily; Timberland also screens each person in a file.",
    status: "confirmed",
    onRecord: "Timberland screens each person in a file too, and Cash Management would call if one matched.",
    ask: [],
    said: ["brOfac"],
    why: [],
  },
];

export type GlossaryEntry = {
  readonly id: string;
  readonly term: string;
  /** Plain words, one or two sentences, used for the hover help. */
  readonly plain: string;
  /** The source's own definition or rule. */
  readonly source: SetupQuoteId;
  /** Where Greenway's system deals with it, if anywhere. */
  readonly href?: string;
};

export const ACH_GLOSSARY: readonly GlossaryEntry[] = [
  { id: "ach", term: "ACH Network", plain: "The bank-to-bank system that moves payroll and vendor payments electronically, run under the Nacha rules.", source: "gAchNetwork" },
  { id: "originator", term: "Originator", plain: "The company that sends the payments. For Greenway's payroll and vendor files, that is Greenway.", source: "gOriginator" },
  { id: "odfi", term: "ODFI", plain: "The sending bank: Timberland, which takes Greenway's file into the ACH Network.", source: "gOdfi" },
  { id: "rdfi", term: "RDFI", plain: "The receiving bank: the employee's or vendor's own bank.", source: "gRdfi" },
  { id: "file", term: "ACH file", plain: "The batch of payments Greenway's system builds and the owner uploads to Timberland.", source: "gFile", href: "/admin/settings/banking/operations#files" },
  { id: "effective", term: "Effective Entry Date", plain: "The day the money is meant to arrive. It must be a banking day, and Greenway uploads ahead of it.", source: "gEffective", href: "/admin/settings/banking/calendar" },
  { id: "ppd", term: "PPD", plain: "The code for payments to a person's own account, such as payroll direct deposit.", source: "gPpd" },
  { id: "ccd", term: "CCD", plain: "The code for payments between businesses, such as paying a vendor.", source: "gCcd" },
  { id: "payroll", term: "PAYROLL (Company Entry Description)", plain: "Since March 20, 2026, payroll credits must say PAYROLL in the batch header. Greenway's files do.", source: "gPayroll" },
  { id: "unbalanced", term: "Unbalanced batch", plain: "A batch with only the payments going out and no matching debit line. It is what Timberland asked for.", source: "brUnbalanced" },
  { id: "prenote", term: "Prenote", plain: "A $0 test entry that checks an account number before real money goes to it.", source: "gPrenote", href: "/admin/settings/banking/operations" },
  { id: "return", term: "Return (R code)", plain: "A payment the receiving bank sends back, for example a closed account. Greenway logs it the same day and holds that payee.", source: "gReturn", href: "/admin/settings/banking/operations" },
  { id: "noc", term: "NOC (C code)", plain: "A notice from the receiving bank saying a detail (such as an account number) must be corrected before the next payment.", source: "gNocName", href: "/admin/settings/banking/operations" },
  { id: "reversal", term: "Reversal", plain: "Undoing a wrong or duplicate payment. For Greenway it is a call to Timberland, within 5 banking days and 24 hours of finding the error.", source: "tbReversalWindow" },
  { id: "sameday", term: "Same Day ACH", plain: "A payment that settles the day it is sent. Greenway is not signed up for it.", source: "gSameDay" },
  { id: "dual", term: "Dual approval", plain: "A second person has to approve a file before the bank releases it. Off today at Timberland; the owner decides.", source: "saoTwoPeople", href: "/admin/settings/banking/approvals" },
  { id: "token", term: "Token or text code", plain: "The one-time code that releases a file at Timberland. Report a lost phone or token at once.", source: "tbToken" },
  { id: "block", term: "ACH debit block", plain: "A bank setting that refuses ACH charges on an account that should never be debited.", source: "saoBlocks" },
  { id: "filter", term: "ACH filter (ACH positive pay)", plain: "A bank setting that only lets listed companies debit the account; anything else waits for the owner's review.", source: "saoFilter", href: "/admin/settings/banking/bank-watch" },
  { id: "fedmail", term: "Fed encrypted email", plain: "The Federal Reserve's secure email that delivers return and NOC reports. Reports stay in its portal for 60 days.", source: "frbEncrypted", href: "/admin/settings/banking/notice-email" },
];

export function glossaryTerm(id: string): GlossaryEntry | undefined {
  return ACH_GLOSSARY.find((g) => g.id === id);
}

/** Hover text for a glossary term: the plain words. Unknown ids return an empty string (never a guess). */
export function glossaryHint(id: string): string {
  const g = glossaryTerm(id);
  return g ? `${g.term}: ${g.plain}` : "";
}

export function checklistCounts(items: readonly ChecklistItem[] = BANK_CHECKLIST): Record<ChecklistStatus, number> {
  const out: Record<ChecklistStatus, number> = { confirmed: 0, ask: 0, decide: 0 };
  for (const i of items) out[i.status]++;
  return out;
}

/** Items in meeting order: questions first, then the owner's decisions, then what is already settled. */
export function meetingOrder(items: readonly ChecklistItem[] = BANK_CHECKLIST): ChecklistItem[] {
  const rank: Record<ChecklistStatus, number> = { ask: 0, decide: 1, confirmed: 2 };
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => rank[a.it.status] - rank[b.it.status] || a.idx - b.idx)
    .map((x) => x.it);
}

export function hasLongDigitRun(s: string): boolean {
  return /[0-9]{7,}/.test(s.split(TIMBERLAND_PHONE).join(""));
}

const STATUS_LABEL: Record<ChecklistStatus, string> = { ask: "ASK BRENDA", decide: "OWNER DECIDES", confirmed: "CONFIRMED" };
export function statusLabel(s: ChecklistStatus): string {
  return STATUS_LABEL[s];
}

/** The printable meeting sheet (plain text). */
export function meetingSheet(todayIso: string): string {
  const hr = "-".repeat(72);
  const c = checklistCounts();
  const out: string[] = [];
  out.push("GREENWAY MARIJUANA - ACH BANK-SIDE CHECKLIST FOR THE MEETING WITH TIMBERLAND CASH MANAGEMENT");
  out.push(`Printed ${todayIso} (Pacific). ${c.ask} to ask, ${c.decide} for the owner to decide, ${c.confirmed} already confirmed.`);
  out.push(`Timberland Bank: ${TIMBERLAND_PHONE}. No account numbers are printed on this sheet.`);
  out.push("");
  let n = 0;
  for (const it of meetingOrder()) {
    n++;
    out.push(hr);
    out.push(`${n}. [${statusLabel(it.status)}] ${it.title}`);
    out.push(`   On record: ${it.onRecord}`);
    for (const q of it.said) out.push(`   Said: "${SETUP_QUOTES[q].text}" (${SETUP_QUOTES[q].where})`);
    for (const q of it.why) out.push(`   Why: "${SETUP_QUOTES[q].text}" (${SETUP_QUOTES[q].where})`);
    for (const a of it.ask) out.push(`   [ ] ASK: ${a}`);
    if (it.ask.length) out.push("   Answer: ______________________________________________________________");
  }
  out.push(hr);
  out.push("GLOSSARY");
  for (const g of ACH_GLOSSARY) out.push(`  ${g.term}: ${g.plain}`);
  out.push("");
  out.push("Every quote above is verbatim from the mirrors in docs/authorities/ach/.");
  return out.join("\n") + "\n";
}

export function __runAchBankSetupCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (name: string, ok: boolean) => {
    if (ok) passed++;
    else {
      failed++;
      console.error(`ach-bank-setup-core FAILED: ${name}`);
    }
  };
  const ids = Object.keys(SETUP_QUOTES);
  t("eleven checklist items", BANK_CHECKLIST.length === 11);
  t("unique checklist ids", new Set(BANK_CHECKLIST.map((i) => i.id)).size === BANK_CHECKLIST.length);
  t("every said/why id exists", BANK_CHECKLIST.every((i) => [...i.said, ...i.why].every((q) => ids.includes(q))));
  t("confirmed needs Brenda's or the bank's words", BANK_CHECKLIST.every((i) => i.status !== "confirmed" || i.said.length > 0));
  t("confirmed has nothing left to ask", BANK_CHECKLIST.every((i) => i.status !== "confirmed" || i.ask.length === 0));
  t("ask items have questions", BANK_CHECKLIST.every((i) => i.status !== "ask" || i.ask.length > 0));
  t("no unanswered item is marked confirmed: block", BANK_CHECKLIST.find((i) => i.id === "debit-block")!.status === "ask");
  t("no unanswered item is marked confirmed: filter", BANK_CHECKLIST.find((i) => i.id === "filter")!.status === "ask");
  t("dual approval is the owner's call", BANK_CHECKLIST.find((i) => i.id === "dual")!.status === "decide");
  t("dual cites Brenda's off", BANK_CHECKLIST.find((i) => i.id === "dual")!.said.includes("brDualOff"));
  t("portal names the phone", BANK_CHECKLIST.find((i) => i.id === "portal")!.ask.some((a) => a.includes(TIMBERLAND_PHONE)));
  const cc = checklistCounts();
  t("counts add up", cc.ask + cc.decide + cc.confirmed === BANK_CHECKLIST.length);
  t("counts ask", cc.ask === 5);
  t("counts decide", cc.decide === 1);
  t("counts confirmed", cc.confirmed === 5);
  const mo = meetingOrder();
  t("meeting order keeps all", mo.length === BANK_CHECKLIST.length);
  t("meeting order asks first", mo[0].status === "ask" && mo[4].status === "ask");
  t("meeting order decide next", mo[5].status === "decide");
  t("meeting order confirmed last", mo[mo.length - 1].status === "confirmed");
  t("meeting order stable", mo[0].id === "testing" && mo[6].id === "limits");
  const sample: ChecklistItem[] = [
    { ...BANK_CHECKLIST[6], id: "c1" },
    { ...BANK_CHECKLIST[2], id: "d1" },
    { ...BANK_CHECKLIST[0], id: "a1" },
  ];
  t("meeting order sorts a sample", meetingOrder(sample).map((i) => i.id).join(",") === "a1,d1,c1");
  t("twenty glossary terms", ACH_GLOSSARY.length === 20);
  t("unique glossary ids", new Set(ACH_GLOSSARY.map((g) => g.id)).size === ACH_GLOSSARY.length);
  t("glossary sources exist", ACH_GLOSSARY.every((g) => ids.includes(g.source)));
  t("glossary links are banking pages", ACH_GLOSSARY.every((g) => !g.href || g.href.startsWith("/admin/settings/banking")));
  t("hint known", glossaryHint("noc").startsWith("NOC (C code): "));
  t("hint unknown is empty", glossaryHint("nope") === "");
  t("term lookup", glossaryTerm("odfi")?.term === "ODFI");
  t("quote files are mirrors", Object.values(SETUP_QUOTES).every((q) => (SOURCE_FILES as readonly string[]).includes(q.file)));
  t("label ask", statusLabel("ask") === "ASK BRENDA");
  t("label decide", statusLabel("decide") === "OWNER DECIDES");
  t("label confirmed", statusLabel("confirmed") === "CONFIRMED");
  const sheet = meetingSheet("2026-10-22");
  t("sheet header", sheet.startsWith("GREENWAY MARIJUANA - ACH BANK-SIDE CHECKLIST"));
  t("sheet date", sheet.includes("Printed 2026-10-22 (Pacific)"));
  t("sheet counts", sheet.includes("5 to ask, 1 for the owner to decide, 5 already confirmed"));
  t("sheet first item", sheet.includes("1. [ASK BRENDA] Testing the system with Timberland"));
  t("sheet answer lines", sheet.split("Answer: ").length - 1 === BANK_CHECKLIST.filter((i) => i.ask.length).length);
  t("sheet tick boxes", sheet.split("[ ] ASK: ").length - 1 === BANK_CHECKLIST.reduce((a, i) => a + i.ask.length, 0));
  t("sheet glossary", sheet.includes("GLOSSARY") && sheet.includes("  ODFI: "));
  t("sheet has no long digit run", !hasLongDigitRun(sheet));
  t("sheet ends with newline", sheet.endsWith("\n"));
  t("digit run caught", hasLongDigitRun("acct 12345678"));
  t("phone allowed", !hasLongDigitRun(`call ${TIMBERLAND_PHONE}`));
  t("six digits allowed", !hasLongDigitRun("123456"));
  return { passed, failed };
}
