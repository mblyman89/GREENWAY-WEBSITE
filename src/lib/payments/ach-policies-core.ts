/**
 * R41 S18: Greenway's written ACH policies, the quarterly ACH access review
 * and the yearly key (credential) checks. PURE: no I/O, no clock (the caller
 * passes today's Pacific date). Records live in migration 0291
 * (ach_control_records), written by ach-policies-store.ts.
 *
 * Why written policies: the WA State Auditor's ACH guide opens with "Develop
 * a detailed ACH payment policy." Every policy below carries the reason in the
 * source's own words, quoted verbatim from the mirrors in docs/authorities/
 * (a vitest compares each quote with the mirror, whitespace flattened). The
 * one exception is the written-check backup, which is the owner's own
 * existing procedure (Round 16: "I already have a way to skip an ach payroll
 * and log it as being covered by written checks").
 *
 * Nothing here holds an account number, an email address or a phone number
 * other than Timberland's published 1-800-562-8761.
 */
import { createHash } from "node:crypto";

export const SAO_FILE = "ach/wa-sao-ach-best-practices.txt";
export const TIMBERLAND_FILE = "ach/timberland-ach-agreement-2026-10-14.redacted.txt";
export const TIMBERLAND_PHONE = "1-800-562-8761";

export type SourceQuote = { readonly text: string; readonly file: string; readonly where: string };

/** Every verbatim sentence the policies lean on, by id. */
export const POLICY_QUOTES = {
  saoPolicy: {
    text: "Develop a detailed ACH payment policy. Your policy should describe the procedures to initiate, approve, execute and reconcile ACH payments. It should include your key controls to prevent and detect ACH fraud and how employees should respond to known or suspected fraud.",
    file: SAO_FILE,
    where: "WA State Auditor, Best Practices for ACH Electronic Payments, p. 2",
  },
  saoNeedToKnow: { text: "Limit sharing this policy to those who need to know it.", file: SAO_FILE, where: "WA State Auditor, p. 2" },
  saoTraining: { text: "Require training after hiring and annually, thereafter.", file: SAO_FILE, where: "WA State Auditor, p. 2" },
  saoTwoPeople: { text: "Require two people to send ACH payments. Work with your bank to set this up.", file: SAO_FILE, where: "WA State Auditor, p. 4" },
  saoLimitAccess: {
    text: "Limit access to sensitive information. Securely store and protect banking information. Limit permissions to view or edit this sensitive information to those who need it to do their job.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 5",
  },
  saoReviewPeople: {
    text: "Review the people authorized to initiate and approve ACH payments and decide if you need to make changes.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 10 (Conduct an annual review)",
  },
  saoAnnual: {
    text: "Conduct an annual review. Review your internal controls, their design, operation and effectiveness. Review your policy.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 10",
  },
  saoDaily: { text: "Review your bank activity daily.", file: SAO_FILE, where: "WA State Auditor, p. 9" },
  saoVendorNotPaid: {
    text: "Follow up when a vendor reports they did not receive payment. If your records reflect you paid a vendor, but they report not receiving it, follow up immediately.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 10",
  },
  saoPasskeys: {
    text: "Use a bank that offers passkeys or tokens for authentication. These options offer more security than passwords and texted/ emailed codes:",
    file: SAO_FILE,
    where: "WA State Auditor, p. 9",
  },
  saoBankCheckIn: {
    text: "Check in with your bank every six months to identify new options or services that can help protect your government against ACH fraud.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 9",
  },
  saoComputer: {
    text: "Use a dedicated, secure computer.",
    file: SAO_FILE,
    where: "WA State Auditor, p. 8",
  },
  tbRetainEntries: {
    text: "Company shall retain data to permit remaking of entries for one calendar year following the date of their transmittal by Financial Institution as provided herein, and shall provide such data to Financial Institution upon its request.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 12 (Data Retention)",
  },
  tbRetainAuth: {
    text: "Company must retain the signed or authenticated authorization for a period of two calendar years following the termination or revocation of the authorization.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 5 (Authorizations)",
  },
  tbStatement: {
    text: "Company agrees to notify Financial Institution within a reasonable time not to exceed 30 calendar days (except where applicable law provides a 60 calendar day review period) after Company receives a periodic statement of any discrepancy between Company\u2019s records and the information in the periodic statement.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, section 17 (Settlement Discrepancies)",
  },
  tbConfidential: {
    text: "agrees to take reasonable steps to maintain the confidentiality of the security procedures and any passwords, codes, security devices, and related instructions provided by Financial Instituion.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule F (the agreement's own spelling kept)",
  },
  tbVerbalThenWritten: {
    text: "If Company believes or suspects that any such information has been accessed by an unauthorized individual, Company will verbally notify Financial Institution immediately, followed by written confirmation within 1 calendar day of verbal notice.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule F",
  },
  tbNetwork: {
    text: "Timberland Bank requires companies\u2019 use of a private secured internet connection and a network that is protected by Anti-virus, Anti-spyware, and a Firewall on all company computers that will be originating ACH files.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule F",
  },
  tbDualControl: {
    text: "Timberland Bank also recommends dual control approval for all file originations.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule F",
  },
  tbCredentials: {
    text: "agrees to notify Financial Institution at once if it believes any credentials have been compromised by an unauthorized person or if a Token has become lost, stolen, or defective.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule G",
  },
  tbPhone: { text: "You may contact Timberland Bank at 1-800-562-8761.", file: TIMBERLAND_FILE, where: "Timberland ACH agreement, Schedule G" },
  tbToken: {
    text: "Token devices are property of Timberland Bank and must be returned upon termination of this agreement. The replacement fee for a lost token is $25.00.",
    file: TIMBERLAND_FILE,
    where: "Timberland ACH agreement, Schedule G",
  },
} as const satisfies Record<string, SourceQuote>;

export type PolicyQuoteId = keyof typeof POLICY_QUOTES;

export type AchPolicy = {
  readonly id: string;
  readonly title: string;
  /** One line for the hover help. */
  readonly hint: string;
  /** The policy itself, in plain words: what we do. */
  readonly rules: readonly string[];
  /** Why, in the source's own words (empty only for the owner's own procedure). */
  readonly why: readonly PolicyQuoteId[];
  /** Where the system does it (back-office links), if anywhere. */
  readonly links: readonly { readonly href: string; readonly label: string }[];
  /** Set when the policy is the owner's own procedure, not a rule from a source. */
  readonly ownerProcedure?: string;
};

export const ACH_POLICIES: readonly AchPolicy[] = [
  {
    id: "payments",
    title: "1. How an ACH payment is made (initiate, approve, send, reconcile)",
    hint: "The four steps the State Auditor says a policy must describe, and who does each one at Greenway.",
    rules: [
      "Initiate: payroll ACH files come only from a finished pay run; vendor ACH files come only from vendor payments in the back office. Nobody types bank details into a file by hand.",
      "Approve: Michael (owner) approves. Anything Stephen (admin) adds, changes, removes or releases in ACH waits for Michael's approval, and every change records who entered it and who approved it.",
      "Send: Michael uploads the file to Timberland and approves it there with his own login plus his token or text code. Timberland's dual approval is off by the owner's choice (signed Schedule C); our own approval step and call-backs are the second person.",
      "Reconcile: each monthly Timberland statement is checked against our ACH files, and anything we do not recognise is reported to Timberland the same day (never later than the 30 days the agreement allows).",
      "Every ACH change is logged in the Security Log. The written fraud procedure (12 items) on the Calendar page is part of this policy.",
    ],
    why: ["saoPolicy", "saoTwoPeople", "tbDualControl", "tbStatement"],
    links: [
      { href: "/admin/settings/banking/approvals", label: "Approvals" },
      { href: "/admin/settings/banking/operations", label: "ACH operations" },
      { href: "/admin/settings/banking/calendar#fraud-procedure", label: "Fraud procedure" },
    ],
  },
  {
    id: "retention",
    title: "2. How long ACH records are kept",
    hint: "Timberland's agreement sets two clocks: 1 year for file data, 2 years for authorizations after they end.",
    rules: [
      "ACH file data (enough to remake every payment) is kept at least one calendar year after the file was sent, and given to Timberland if they ask.",
      "Each signed payee authorization (employee or vendor) is kept at least two calendar years after it is revoked or ends.",
      "The back office does not delete ACH files, authorizations, approvals or call-back notes; they are kept as records. Paper copies go in the locked banking file.",
      "Once a year the retention review on the Calendar confirms the records are still there.",
    ],
    why: ["tbRetainEntries", "tbRetainAuth"],
    links: [
      { href: "/admin/settings/banking/calendar", label: "Calendar (retention review)" },
      { href: "/admin/settings/banking/files", label: "ACH files" },
    ],
  },
  {
    id: "incident",
    title: "3. If something looks wrong (incident response)",
    hint: `Call Timberland at once on ${TIMBERLAND_PHONE}, then confirm in writing within 1 calendar day.`,
    rules: [
      `Call Timberland right away on ${TIMBERLAND_PHONE} if a login, password, text code or token may have been seen or used by someone else, if the token is lost, stolen or broken, or if a payment went somewhere it should not.`,
      "Within 1 calendar day of the call, send Timberland written confirmation (secure message or letter) and keep a copy in the banking file.",
      "Put the affected payee or payees ON HOLD in the back office so nothing more is paid to that account.",
      "Change the passwords involved, then write down what happened, who you spoke to and when on the ACH operations log.",
      "If a vendor or employee says they were not paid when our records say they were, follow up the same day: it may be a stolen payment.",
      "Afterwards, look at what let it happen and update these policies if needed (the yearly review asks this).",
    ],
    why: ["tbVerbalThenWritten", "tbCredentials", "tbPhone", "saoVendorNotPaid"],
    links: [
      { href: "/admin/settings/banking/operations#holds", label: "Holds" },
      { href: "/admin/settings/banking/operations#notices", label: "Log a message from Timberland" },
    ],
  },
  {
    id: "access",
    title: "4. Who can touch ACH (access)",
    hint: "Only the people who need it, each with their own login, checked every quarter.",
    rules: [
      "Only Michael (owner) can make a live ACH change or release money. Stephen (admin) can gather and record; his changes wait for Michael. No other role sees bank details.",
      "Everyone uses their own login and passkey. Logins, passwords, text codes and tokens are never shared.",
      "When someone leaves or changes job, their back-office access is changed the same day.",
      "Every quarter Michael looks at the list of people with ACH access on this page and records that it is still right (or what he changed).",
      "Anyone given ACH access reads these policies first and again each year. The policies are shared only with the people who need them.",
    ],
    why: ["saoLimitAccess", "saoReviewPeople", "saoTraining", "saoNeedToKnow"],
    links: [
      { href: "/admin/settings/banking/policies#access", label: "Quarterly access review" },
      { href: "/admin/users", label: "Staff accounts" },
    ],
  },
  {
    id: "keys",
    title: "5. Looking after logins, the token and the encryption key",
    hint: "Keep them private, report a lost token at once, and check each one once a year.",
    rules: [
      "The Timberland token (or the phone that gets the text code) stays with Michael and is kept locked up when not in use. A lost, stolen or broken token is reported to Timberland at once (the replacement fee is $25.00).",
      "Passwords and text codes are never written in email, texts or chat. Passkeys are used for the back office wherever they are offered.",
      "The site's encryption key has one offline backup copy in a safe place, never in email or a shared drive.",
      "Once a year Michael checks each item on the key list on this page and records the check.",
    ],
    why: ["tbConfidential", "tbCredentials", "tbToken", "saoPasskeys"],
    links: [{ href: "/admin/settings/banking/policies#keys", label: "Yearly key checks" }],
  },
  {
    id: "monitoring",
    title: "6. Watching the account (daily and monthly)",
    hint: "The bank watch reads the Main account through Plaid every day; the monthly statement is checked within 30 days.",
    rules: [
      "Each business day, look at the Bank watch page (it reads the Timberland Main account through the Plaid bank feed) and explain any money out that nothing in the back office accounts for.",
      "Check the Fed's notice portal (and the Notice email page, if it is turned on) for returns and bank corrections, and log them the same day.",
      "Check each monthly statement against our ACH files and report any difference to Timberland well inside 30 calendar days.",
      "About every six months, ask Timberland whether they offer any new fraud protection (for example an ACH filter or debit block).",
    ],
    why: ["saoDaily", "tbStatement", "saoVendorNotPaid", "saoBankCheckIn"],
    links: [
      { href: "/admin/settings/banking/bank-watch", label: "Bank watch" },
      { href: "/admin/settings/banking/notice-email", label: "Notice email" },
    ],
  },
  {
    id: "computer",
    title: "7. The computer and connection used for banking",
    hint: "Timberland requires a private secured connection, anti-virus, anti-spyware and a firewall.",
    rules: [
      "ACH files are uploaded and approved only from a Greenway computer on a private, secured internet connection, never public or guest Wi-Fi.",
      "That computer has anti-virus, anti-spyware and a firewall turned on and up to date.",
      "Where possible, use one computer just for online banking, with no email on it.",
    ],
    why: ["tbNetwork", "saoComputer"],
    links: [{ href: "/admin/settings/banking/calendar", label: "Calendar (Schedule F self-check)" }],
  },
  {
    id: "backup",
    title: "8. If an ACH payroll cannot go out (written checks)",
    hint: "The owner's existing procedure: skip the ACH run and pay by written checks.",
    rules: [
      "If an ACH payroll file cannot be sent on time (bank, internet or system problem), payroll is paid by written checks instead, so nobody is paid late.",
      "The skipped ACH run is logged as covered by written checks, so it is never sent later by mistake as well.",
    ],
    why: [],
    links: [{ href: "/admin/payroll", label: "Payroll" }],
    ownerProcedure: "Greenway's own procedure (owner, Round 16): \"I already have a way to skip an ach payroll and log it as being covered by written checks.\"",
  },
];

/** SHA-256 of the exact policy wording (titles and rules), so an adoption shows when the words changed. */
export function policyTextFingerprint(policies: readonly AchPolicy[] = ACH_POLICIES): string {
  const lines: string[] = [];
  for (const p of policies) {
    lines.push(p.title);
    for (const r of p.rules) lines.push(`- ${r}`);
  }
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

// ─── periods ──────────────────────────────────────────────────────────────

export function quarterKeyOf(dateIso: string): string {
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function previousQuarterKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(-1));
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

// ─── the quarterly access review ─────────────────────────────────────────

export type StaffLite = { id: string; email: string | null; full_name: string | null; role: string; active: boolean; last_login_at: string | null };

/** What each role can do with ACH (mirrors src/lib/auth/roles.ts; a vitest pins it). */
export const ACH_ROLE_POWERS: Readonly<Record<string, readonly string[]>> = {
  owner: ["make and release ACH changes", "approve Stephen's requests", "see bank details", "read the Security Log"],
  admin: ["gather and record ACH information (waits for the owner)", "open the Banking pages"],
};

export type AccessPerson = { id: string; who: string; role: string; active: boolean; lastLogin: string | null; daysSinceLogin: number | null; powers: readonly string[] };
export type AccessFinding = { level: "warn" | "info"; text: string };
export type AccessReport = { people: AccessPerson[]; findings: AccessFinding[]; fingerprint: string };

export const STALE_LOGIN_DAYS = 90;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function buildAccessReport(staff: readonly StaffLite[], todayIso: string): AccessReport {
  const people: AccessPerson[] = staff
    .filter((s) => s.role in ACH_ROLE_POWERS)
    .map((s) => ({
      id: s.id,
      who: (s.full_name ?? "").trim() || s.email || "Unnamed account",
      role: s.role,
      active: s.active,
      lastLogin: s.last_login_at,
      daysSinceLogin: s.last_login_at ? daysBetween(s.last_login_at, todayIso) : null,
      powers: ACH_ROLE_POWERS[s.role],
    }))
    .sort((a, b) => (a.role === b.role ? a.who.localeCompare(b.who) : a.role === "owner" ? -1 : 1));

  const findings: AccessFinding[] = [];
  const active = people.filter((p) => p.active);
  const owners = active.filter((p) => p.role === "owner");
  if (owners.length === 0) findings.push({ level: "warn", text: "No active owner account. Nobody can approve or release ACH." });
  if (owners.length > 1) findings.push({ level: "warn", text: `${owners.length} active owner accounts. Each one can release money alone; check every one is still needed.` });
  for (const p of active) {
    if (p.daysSinceLogin === null) findings.push({ level: "warn", text: `${p.who} (${p.role}) has never signed in. Remove the access if it is not needed.` });
    else if (p.daysSinceLogin >= STALE_LOGIN_DAYS) findings.push({ level: "warn", text: `${p.who} (${p.role}) has not signed in for ${p.daysSinceLogin} days. Is the access still needed?` });
  }
  const inactive = people.filter((p) => !p.active);
  if (inactive.length) findings.push({ level: "info", text: `${inactive.length} switched-off account${inactive.length === 1 ? "" : "s"} still marked owner or admin (cannot sign in): ${inactive.map((p) => p.who).join(", ")}.` });

  const fpLines = [...people].sort((a, b) => a.id.localeCompare(b.id)).map((p) => `${p.id}|${p.role}|${p.active ? 1 : 0}`);
  const fingerprint = createHash("sha256").update(fpLines.join("\n"), "utf8").digest("hex");
  return { people, findings, fingerprint };
}

// ─── yearly key checks ────────────────────────────────────────────────────

export type KeyItem = { readonly id: string; readonly label: string; readonly check: string; readonly why: PolicyQuoteId };

export const KEY_ITEMS: readonly KeyItem[] = [
  { id: "timberland_token", label: "Timberland token or text-code phone", check: "It works, it is with Michael, and it is kept locked up when not in use.", why: "tbCredentials" },
  { id: "timberland_login", label: "Timberland online banking login", check: "Only Michael knows the password; it is not written in email or texts; it is not used for any other site.", why: "tbConfidential" },
  { id: "site_passkeys", label: "Back-office logins and passkeys (owner and admin)", check: "Each person signs in with their own account; passkeys are set up where offered; no shared logins.", why: "saoPasskeys" },
  { id: "encryption_key", label: "The site's encryption key (DATA_ENCRYPTION_KEY) backup", check: "One offline backup copy exists in a safe place and nobody new has seen it.", why: "tbConfidential" },
  { id: "google_workspace", label: "Google Workspace sign-in used by the email watchers", check: "The connected mailbox account still belongs to Greenway and has 2-step verification on.", why: "saoLimitAccess" },
  { id: "banking_computer", label: "The banking computer and connection", check: "Private secured connection; anti-virus, anti-spyware and firewall on and up to date.", why: "tbNetwork" },
];

export function keyItemFingerprint(item: KeyItem): string {
  return createHash("sha256").update(`${item.id}\n${item.label}\n${item.check}`, "utf8").digest("hex");
}

// ─── records (0291) ───────────────────────────────────────────────────────

export type ControlKind = "policy_adoption" | "access_review" | "key_check";

export type ControlRow = {
  id: string;
  kind: ControlKind;
  period_key: string;
  recorded_on: string;
  text_sha256: string;
  summary: string;
  item: string | null;
  item_set_on: string | null;
  created_by: string;
  created_at: string;
};

export type ControlInsert = { kind: ControlKind; periodKey: string; summary: string; item: string | null; itemSetOn: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Account-like digit runs are refused (1-800-562-8761 is allowed), as in 0291. */
export function hasLongDigitRun(s: string): boolean {
  return /[0-9]{7,}/.test(s.split(TIMBERLAND_PHONE).join(""));
}

/**
 * Check a record form. `get` reads a form field. Periods are worked out
 * here, never trusted from the browser beyond a choice between this quarter
 * and last quarter.
 */
export function checkControlForm(get: (k: string) => string | null, todayIso: string): { ok: true; row: ControlInsert } | { ok: false; error: string } {
  const kind = (get("kind") ?? "").trim();
  if (kind !== "policy_adoption" && kind !== "access_review" && kind !== "key_check") return { ok: false, error: "Choose what you are recording." };
  const summary = (get("summary") ?? "").trim();
  if (summary.length < 10) return { ok: false, error: "Write at least 10 characters about what you looked at." };
  if (summary.length > 2000) return { ok: false, error: "Keep it under 2,000 characters." };
  if (hasLongDigitRun(summary)) return { ok: false, error: "No account or routing numbers, please (a run of 7 or more digits was found)." };
  if (get("confirm") !== "1") return { ok: false, error: "Tick the box to confirm you did the check yourself." };
  const year = todayIso.slice(0, 4);

  if (kind === "policy_adoption") return { ok: true, row: { kind, periodKey: year, summary, item: null, itemSetOn: null } };

  if (kind === "access_review") {
    const now = quarterKeyOf(todayIso);
    const want = (get("period_key") ?? now).trim();
    if (want !== now && want !== previousQuarterKey(now)) return { ok: false, error: `Only this quarter (${now}) or last quarter (${previousQuarterKey(now)}) can be recorded.` };
    return { ok: true, row: { kind, periodKey: want, summary, item: null, itemSetOn: null } };
  }

  const item = (get("item") ?? "").trim();
  if (!KEY_ITEMS.some((k) => k.id === item)) return { ok: false, error: "Choose which key you checked." };
  const setOnRaw = (get("item_set_on") ?? "").trim();
  let itemSetOn: string | null = null;
  if (setOnRaw) {
    if (!ISO_DATE.test(setOnRaw) || Number.isNaN(Date.parse(`${setOnRaw}T00:00:00Z`))) return { ok: false, error: "The 'last changed' date is not a date." };
    if (setOnRaw > todayIso) return { ok: false, error: "The 'last changed' date cannot be in the future." };
    if (setOnRaw < "2000-01-01") return { ok: false, error: "The 'last changed' date is too far back." };
    itemSetOn = setOnRaw;
  }
  return { ok: true, row: { kind, periodKey: year, summary, item, itemSetOn } };
}

export function controlDbErrorMessage(raw: string): string {
  if (/ACH_OWNER_ONLY/.test(raw)) return "Only the owner can record this. Nothing was saved.";
  if (/ACH_CONTROL_DATE/.test(raw)) return "The date must be today. Nothing was saved.";
  if (/ACH_CONTROL_PERIOD/.test(raw)) return "That period cannot be recorded now (this quarter or last quarter only; adoptions and key checks for this year only). Nothing was saved.";
  if (/ACH_CONTROL_APPEND_ONLY/.test(raw)) return "A record is never changed. Record a new one instead.";
  if (/summary_check/.test(raw)) return "The note was refused (10 to 2,000 characters, no account numbers). Nothing was saved.";
  if (/acr_shape/.test(raw)) return "The record did not fit its kind. Nothing was saved.";
  if (/42P01|does not exist|PGRST205/.test(raw)) return "Migration 0291 has not been applied yet, so nothing can be recorded. See docs/MIGRATIONS_TO_RUN.md.";
  return "The database refused the record. Nothing was saved.";
}

// ─── status ───────────────────────────────────────────────────────────────

export type ControlStatus = {
  adoption: { current: ControlRow | null; textChanged: boolean };
  access: { thisQuarter: ControlRow | null; lastQuarter: ControlRow | null; quarterKey: string; listChanged: boolean };
  keys: { item: KeyItem; latest: ControlRow | null; checkedThisYear: boolean; ageDays: number | null }[];
  /** Open items in plain words, for the page header and the Calendar. */
  todo: string[];
};

function latestOf(rows: readonly ControlRow[]): ControlRow | null {
  let best: ControlRow | null = null;
  for (const r of rows) if (!best || r.created_at > best.created_at) best = r;
  return best;
}

export function controlStatus(rows: readonly ControlRow[], todayIso: string, policyFp: string, accessFp: string): ControlStatus {
  const year = todayIso.slice(0, 4);
  const qNow = quarterKeyOf(todayIso);
  const adoption = latestOf(rows.filter((r) => r.kind === "policy_adoption" && r.period_key === year));
  const thisQuarter = latestOf(rows.filter((r) => r.kind === "access_review" && r.period_key === qNow));
  const lastQuarter = latestOf(rows.filter((r) => r.kind === "access_review" && r.period_key === previousQuarterKey(qNow)));
  const keys = KEY_ITEMS.map((item) => {
    const latest = latestOf(rows.filter((r) => r.kind === "key_check" && r.item === item.id));
    return {
      item,
      latest,
      checkedThisYear: Boolean(latest && latest.period_key === year),
      ageDays: latest?.item_set_on ? daysBetween(latest.item_set_on, todayIso) : null,
    };
  });
  const todo: string[] = [];
  const textChanged = Boolean(adoption && adoption.text_sha256 !== policyFp);
  if (!adoption) todo.push(`Adopt the written ACH policies for ${year}.`);
  else if (textChanged) todo.push("The policy wording changed since you adopted it. Read it again and re-adopt.");
  const listChanged = Boolean(thisQuarter && thisQuarter.text_sha256 !== accessFp);
  if (!thisQuarter) todo.push(`Record the ACH access review for ${qNow}.`);
  else if (listChanged) todo.push(`Who has ACH access changed since the ${qNow} review. Look again and record it.`);
  const missing = keys.filter((k) => !k.checkedThisYear);
  if (missing.length) todo.push(`${missing.length} of ${keys.length} key check${keys.length === 1 ? "" : "s"} not done yet in ${year}.`);
  return { adoption: { current: adoption, textChanged }, access: { thisQuarter, lastQuarter, quarterKey: qNow, listChanged }, keys, todo };
}

// ─── printable packet ─────────────────────────────────────────────────────

export function policiesPacket(input: {
  generatedAt: Date;
  generatedBy: string;
  todayIso: string;
  rows: readonly ControlRow[];
  staff: readonly StaffLite[];
  nameOf: (id: string) => string;
}): string {
  const fp = policyTextFingerprint();
  const access = buildAccessReport(input.staff, input.todayIso);
  const st = controlStatus(input.rows, input.todayIso, fp, access.fingerprint);
  const out: string[] = [];
  const hr = "-".repeat(72);
  out.push("GREENWAY - WRITTEN ACH POLICIES");
  out.push(`Printed ${input.generatedAt.toISOString()} by ${input.generatedBy}. Policy text fingerprint (SHA-256): ${fp}`);
  out.push("Confidential: share only with the people who need it (WA State Auditor).");
  out.push(hr);
  for (const p of ACH_POLICIES) {
    out.push("");
    out.push(p.title.toUpperCase());
    for (const r of p.rules) out.push(`  - ${r}`);
    if (p.ownerProcedure) out.push(`  Source: ${p.ownerProcedure}`);
    for (const q of p.why) {
      const s = POLICY_QUOTES[q];
      out.push(`  Why: "${s.text}"`);
      out.push(`       (${s.where}; mirrored at docs/authorities/${s.file})`);
    }
  }
  out.push("");
  out.push(hr);
  out.push("ADOPTION");
  out.push(
    st.adoption.current
      ? `  Adopted for ${st.adoption.current.period_key} on ${st.adoption.current.recorded_on} by ${input.nameOf(st.adoption.current.created_by)}.${st.adoption.textChanged ? " NOTE: the wording has changed since; re-adoption needed." : ""}`
      : `  Not yet adopted for ${input.todayIso.slice(0, 4)}.`,
  );
  out.push("");
  out.push(`ACCESS REVIEW (${st.access.quarterKey})`);
  for (const p of access.people) out.push(`  ${p.who}: ${p.role}${p.active ? "" : " (switched off)"}; last sign-in ${p.lastLogin ? p.lastLogin.slice(0, 10) : "never"}; can ${p.powers.join(", ")}.`);
  if (access.people.length === 0) out.push("  Nobody holds owner or admin.");
  for (const f of access.findings) out.push(`  ${f.level === "warn" ? "CHECK" : "Note"}: ${f.text}`);
  out.push(
    st.access.thisQuarter
      ? `  Recorded ${st.access.thisQuarter.recorded_on} by ${input.nameOf(st.access.thisQuarter.created_by)}: ${st.access.thisQuarter.summary}`
      : "  Not yet recorded this quarter.",
  );
  out.push("");
  out.push(`KEY CHECKS (${input.todayIso.slice(0, 4)})`);
  for (const k of st.keys) {
    out.push(
      `  ${k.item.label}: ${k.checkedThisYear && k.latest ? `checked ${k.latest.recorded_on} by ${input.nameOf(k.latest.created_by)}` : "NOT checked this year"}${k.ageDays !== null ? `; last changed ${k.ageDays} days ago` : ""}.`,
    );
  }
  out.push("");
  out.push(hr);
  out.push(`If something looks wrong: call Timberland at ${TIMBERLAND_PHONE} at once, then confirm in writing within 1 calendar day.`);
  return out.join("\n") + "\n";
}

// ─── self-tests ───────────────────────────────────────────────────────────

export function __runAchPoliciesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (name: string, ok: boolean) => {
    if (ok) passed++;
    else {
      failed++;
      console.error(`ach-policies-core FAILED: ${name}`);
    }
  };
  const get = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
  const today = "2026-10-22";

  // policies
  t("eight policies", ACH_POLICIES.length === 8);
  t("unique ids", new Set(ACH_POLICIES.map((p) => p.id)).size === ACH_POLICIES.length);
  t("every policy but the owner's own has a sourced why", ACH_POLICIES.every((p) => (p.ownerProcedure ? p.why.length === 0 : p.why.length > 0)));
  t("every why id exists", ACH_POLICIES.every((p) => p.why.every((q) => q in POLICY_QUOTES)));
  t("incident names the phone", ACH_POLICIES.find((p) => p.id === "incident")!.rules.some((r) => r.includes(TIMBERLAND_PHONE)));
  t("incident: written within 1 calendar day", ACH_POLICIES.find((p) => p.id === "incident")!.rules.some((r) => r.includes("1 calendar day")));
  t("fingerprint is 64 hex", /^[0-9a-f]{64}$/.test(policyTextFingerprint()));
  t("fingerprint stable", policyTextFingerprint() === policyTextFingerprint());
  t("fingerprint moves with a rule", policyTextFingerprint([{ ...ACH_POLICIES[0], rules: ["x"] }]) !== policyTextFingerprint([ACH_POLICIES[0]]));
  t("no long digit run in policy text", ACH_POLICIES.every((p) => !hasLongDigitRun(p.rules.join(" ") + p.title + p.hint)));

  // periods
  t("Q4", quarterKeyOf("2026-10-22") === "2026-Q4");
  t("Q1", quarterKeyOf("2027-01-01") === "2027-Q1");
  t("Q3 end", quarterKeyOf("2026-09-30") === "2026-Q3");
  t("prev Q4->Q3", previousQuarterKey("2026-Q4") === "2026-Q3");
  t("prev Q1->Q4", previousQuarterKey("2027-Q1") === "2026-Q4");

  // digits
  t("phone allowed", !hasLongDigitRun(`Called ${TIMBERLAND_PHONE} today`));
  t("7 digits refused", hasLongDigitRun("acct 1234567"));
  t("6 digits fine", !hasLongDigitRun("ref 123456"));

  // forms
  const base = { summary: "Read every policy and agree.", confirm: "1" };
  const a = checkControlForm(get({ kind: "policy_adoption", ...base }), today);
  t("adoption ok", a.ok && a.row.periodKey === "2026" && a.row.item === null);
  t("adoption needs confirm", !checkControlForm(get({ kind: "policy_adoption", summary: base.summary }), today).ok);
  t("short summary refused", !checkControlForm(get({ kind: "policy_adoption", summary: "short", confirm: "1" }), today).ok);
  t("digits refused", !checkControlForm(get({ kind: "policy_adoption", summary: "acct 1234567 here", confirm: "1" }), today).ok);
  t("unknown kind refused", !checkControlForm(get({ kind: "other", ...base }), today).ok);
  const r1 = checkControlForm(get({ kind: "access_review", ...base }), today);
  t("access default this quarter", r1.ok && r1.row.periodKey === "2026-Q4");
  const r2 = checkControlForm(get({ kind: "access_review", period_key: "2026-Q3", ...base }), today);
  t("access last quarter ok", r2.ok && r2.row.periodKey === "2026-Q3");
  t("access two quarters back refused", !checkControlForm(get({ kind: "access_review", period_key: "2026-Q2", ...base }), today).ok);
  t("access next quarter refused", !checkControlForm(get({ kind: "access_review", period_key: "2027-Q1", ...base }), today).ok);
  const k1 = checkControlForm(get({ kind: "key_check", item: "timberland_token", ...base }), today);
  t("key ok", k1.ok && k1.row.item === "timberland_token" && k1.row.itemSetOn === null && k1.row.periodKey === "2026");
  t("key unknown item refused", !checkControlForm(get({ kind: "key_check", item: "nope", ...base }), today).ok);
  const k2 = checkControlForm(get({ kind: "key_check", item: "timberland_login", item_set_on: "2026-01-05", ...base }), today);
  t("key set-on ok", k2.ok && k2.row.itemSetOn === "2026-01-05");
  t("key set-on future refused", !checkControlForm(get({ kind: "key_check", item: "timberland_login", item_set_on: "2026-10-23", ...base }), today).ok);
  t("key set-on junk refused", !checkControlForm(get({ kind: "key_check", item: "timberland_login", item_set_on: "2026-13-45", ...base }), today).ok);
  t("key set-on ancient refused", !checkControlForm(get({ kind: "key_check", item: "timberland_login", item_set_on: "1999-12-31", ...base }), today).ok);

  // db errors
  t("err owner", /owner/.test(controlDbErrorMessage("P0001 ACH_OWNER_ONLY: x")));
  t("err migration", /0291/.test(controlDbErrorMessage("PGRST205 relation does not exist")));
  t("err period", /quarter/.test(controlDbErrorMessage("ACH_CONTROL_PERIOD: x")));

  // access report
  const staff: StaffLite[] = [
    { id: "b", email: null, full_name: "Stephen", role: "admin", active: true, last_login_at: "2026-10-20T10:00:00Z" },
    { id: "a", email: null, full_name: "Michael", role: "owner", active: true, last_login_at: "2026-10-22T01:00:00Z" },
    { id: "c", email: null, full_name: "Old Admin", role: "admin", active: false, last_login_at: null },
    { id: "d", email: null, full_name: "Budtender", role: "staff", active: true, last_login_at: null },
  ];
  const rep = buildAccessReport(staff, today);
  t("report lists owner and admins only", rep.people.length === 3 && !rep.people.some((p) => p.id === "d"));
  t("owner first", rep.people[0].role === "owner");
  t("no warn for fresh logins", !rep.findings.some((f) => f.level === "warn"));
  t("inactive noted", rep.findings.some((f) => f.level === "info" && f.text.includes("Old Admin")));
  const stale = buildAccessReport([{ ...staff[0], last_login_at: "2026-06-01T00:00:00Z" }, staff[1]], today);
  t("stale login warned", stale.findings.some((f) => f.level === "warn" && f.text.includes("Stephen")));
  const never = buildAccessReport([{ ...staff[0], last_login_at: null }, staff[1]], today);
  t("never signed in warned", never.findings.some((f) => f.text.includes("never signed in")));
  t("no owner warned", buildAccessReport([staff[0]], today).findings.some((f) => f.text.includes("No active owner")));
  t("two owners warned", buildAccessReport([staff[1], { ...staff[0], role: "owner" }], today).findings.some((f) => f.text.includes("2 active owner")));
  t("fingerprint order-free", buildAccessReport([...staff].reverse(), today).fingerprint === rep.fingerprint);
  t("fingerprint moves with a role", buildAccessReport([{ ...staff[0], role: "owner" }, ...staff.slice(1)], today).fingerprint !== rep.fingerprint);
  t("fingerprint ignores sign-in time", buildAccessReport([{ ...staff[0], last_login_at: "2026-10-21T00:00:00Z" }, ...staff.slice(1)], today).fingerprint === rep.fingerprint);

  // status
  const fp = policyTextFingerprint();
  const row = (o: Partial<ControlRow>): ControlRow => ({
    id: Math.random().toString(36).slice(2),
    kind: "policy_adoption",
    period_key: "2026",
    recorded_on: today,
    text_sha256: fp,
    summary: "Recorded for the test here.",
    item: null,
    item_set_on: null,
    created_by: "a",
    created_at: "2026-10-22T10:00:00Z",
    ...o,
  });
  const empty = controlStatus([], today, fp, rep.fingerprint);
  t("empty: three todos", empty.todo.length === 3 && !empty.adoption.current);
  const adopted = controlStatus([row({})], today, fp, rep.fingerprint);
  t("adopted", adopted.adoption.current !== null && !adopted.adoption.textChanged && adopted.todo.length === 2);
  t("adopted last year does not count", controlStatus([row({ period_key: "2025" })], today, fp, rep.fingerprint).adoption.current === null);
  t("text changed flagged", controlStatus([row({ text_sha256: "0".repeat(64) })], today, fp, rep.fingerprint).adoption.textChanged);
  const acc = controlStatus([row({ kind: "access_review", period_key: "2026-Q4", text_sha256: rep.fingerprint })], today, fp, rep.fingerprint);
  t("access this quarter", acc.access.thisQuarter !== null && !acc.access.listChanged);
  t("access list changed", controlStatus([row({ kind: "access_review", period_key: "2026-Q4", text_sha256: "1".repeat(64) })], today, fp, rep.fingerprint).access.listChanged);
  t("last quarter shown, not counted", (() => {
    const s = controlStatus([row({ kind: "access_review", period_key: "2026-Q3" })], today, fp, rep.fingerprint);
    return s.access.lastQuarter !== null && s.access.thisQuarter === null;
  })());
  const keyed = controlStatus([row({ kind: "key_check", item: "timberland_token", item_set_on: "2026-10-12" })], today, fp, rep.fingerprint);
  const tk = keyed.keys.find((k) => k.item.id === "timberland_token")!;
  t("key checked this year", tk.checkedThisYear && tk.ageDays === 10);
  t("other keys not checked", keyed.keys.filter((k) => !k.checkedThisYear).length === KEY_ITEMS.length - 1);
  t("old key check not this year", !controlStatus([row({ kind: "key_check", item: "timberland_token", period_key: "2025" })], today, fp, rep.fingerprint).keys[0].checkedThisYear);
  t("latest wins", controlStatus([row({ created_at: "2026-10-01T00:00:00Z", text_sha256: "0".repeat(64) }), row({ created_at: "2026-10-22T00:00:00Z" })], today, fp, rep.fingerprint).adoption.textChanged === false);

  // key items
  t("six key items", KEY_ITEMS.length === 6 && new Set(KEY_ITEMS.map((k) => k.id)).size === 6);
  t("key ids fit 0291", KEY_ITEMS.every((k) => /^[a-z_]{3,40}$/.test(k.id)));
  t("key why exists", KEY_ITEMS.every((k) => k.why in POLICY_QUOTES));
  t("key fp differs", keyItemFingerprint(KEY_ITEMS[0]) !== keyItemFingerprint(KEY_ITEMS[1]));

  // packet
  const pk = policiesPacket({ generatedAt: new Date("2026-10-22T18:00:00Z"), generatedBy: "Michael", todayIso: today, rows: [row({})], staff, nameOf: () => "Michael" });
  t("packet has every policy", ACH_POLICIES.every((p) => pk.includes(p.title.toUpperCase())));
  t("packet has adoption", pk.includes("Adopted for 2026"));
  t("packet has access review", pk.includes("ACCESS REVIEW (2026-Q4)") && pk.includes("Stephen: admin"));
  t("packet has key checks", pk.includes("NOT checked this year"));
  t("packet quotes are cited", pk.includes("mirrored at docs/authorities/ach/wa-sao-ach-best-practices.txt"));
  t("packet ends with the phone", pk.trim().endsWith("within 1 calendar day."));
  t("packet no long digits except phone", !hasLongDigitRun(pk.replace(/[0-9a-f]{64}/g, "").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")));

  return { passed, failed };
}
