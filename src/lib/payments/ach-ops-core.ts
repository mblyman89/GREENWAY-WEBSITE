/**
 * src/lib/payments/ach-ops-core.ts  (R39 S7 part 2)
 *
 * Pure rules for the day-to-day ACH operations that migration 0263 records:
 *
 *   1. Account checks (owner Q3): build the prenote file ($0, transaction code
 *      23/33, description PAYROLL so it looks like the live entry) or the test
 *      credit file (1-99 cents, description ACCTVERIFY), and work out the dates
 *      0263's ach_verification_mark_sent needs.
 *   2. What each open check is waiting for, in words.
 *   3. Employee hold release form (the same rules as ach_auth_release_hold).
 *   4. Annual review list (Nacha Phase 2: review at least once a year).
 *   5. Legal hold reason, and the retention line shown next to each record.
 *   6. Test-credit monitoring (Nacha Micro-Entries Phase 2: know forward and
 *      return volumes; watch account-number velocity).
 *   7. Every 0263 refusal in words Michael or Stephen can act on.
 *
 * No I/O here. ach-ops-store.ts moves rows; the database refuses anything out
 * of order even if this file is wrong (scripts/recon/ach-ops-0263-pg-check.sql).
 */

import {
  CALLBACK_METHODS,
  MICRO_ENTRY_DESCRIPTION,
  MIN_CALLBACK_NOTE_CHARS,
  PAYROLL_DESCRIPTION,
  addCalendarDays,
  daysBetween,
  isFedAchBankingDay,
  nextBankingDayOnOrAfter,
  retentionVerdict,
  validateMicroEntryCents,
  type CallbackMethod,
  type RetentionVerdict,
  type VerificationMethod,
} from "./ach-authorization-core";
import { buildNachaFile, isValidRouting, type AchEntry, type AchOriginator } from "./nacha-core";
import { checkEffectiveDateForTimberland, earliestEffectiveDate } from "./timberland-deadline-core";
import { PRENOTE_WAIT_WORDS, prenoteLiveUploadDay } from "./timberland-prenote-core";

// ---------------------------------------------------------------------------
// 1. Account-check files
// ---------------------------------------------------------------------------

export type FileMethod = Exclude<VerificationMethod, "voided_check_callback">;

/** One planned check, with the bank details already decrypted by the store. */
export type PlannedCheck = {
  verificationId: string;
  method: VerificationMethod;
  status: string;
  microCents: number | null;
  payeeName: string;
  payeeRef: string | null;
  accountType: "checking" | "savings";
  routing: string;
  accountNumber: string;
};

/** How far ahead an effective date may be set (a typo guard, not a rule). */
export const MAX_EFFECTIVE_DAYS_AHEAD = 30;

export type CheckFilePlan = {
  method: FileMethod;
  ids: readonly string[];
  file: string;
  filename: string;
  entryCount: number;
  totalCents: number;
  effective: string;
  /** A credit dated for a banking day settles that day (FedACH). */
  settlement: string;
  /** The day passed to mark_sent as p_eligible (prenote: Timberland section 6, 6 banking days after settlement; R41 S7). */
  eligible: string;
  /** Plain words for the page after the download. */
  next: string;
};

/**
 * R41 S5: the default effective date is the earliest one Timberland's
 * deadline still allows (Schedule A: uploaded and approved 2 usable banking
 * days before, by 4:00 pm Pacific). It was "the next banking day", which is
 * always too late.
 */
export function defaultCheckEffectiveDate(nowUtc: Date): string {
  return earliestEffectiveDate(nowUtc);
}

/**
 * R41 S5: the timed check, used where a file is RELEASED (the page and
 * releaseCheckFile; releaseLoop checks again). Not used by planCheckFile,
 * which is also re-run when the person confirms the upload, possibly after
 * the cutoff of a file that did go in on time.
 */
export function checkEffectiveDateForRelease(raw: string | null | undefined, nowUtc: Date): { ok: true; date: string; uploadBy: string; warning: string | null } | { ok: false; error: string } {
  const c = checkEffectiveDateForTimberland(raw, nowUtc);
  return c.ok ? { ok: true, date: c.date, uploadBy: c.deadline.text, warning: c.warning } : { ok: false, error: c.error };
}

export function checkEffectiveDate(raw: string | null | undefined, todayIso: string): { ok: true; date: string } | { ok: false; error: string } {
  const d = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    return { ok: false, error: "Pick the date the bank should post the entries." };
  }
  if (d <= todayIso) return { ok: false, error: "Pick a date after today; Timberland needs the file uploaded and approved at least 2 banking days ahead, by 4:00 pm Pacific (Schedule A)." };
  if (!isFedAchBankingDay(d)) return { ok: false, error: `${d} is not a banking day (weekend or Federal Reserve holiday). Try ${nextBankingDayOnOrAfter(d)}.` };
  if (daysBetween(todayIso, d) > MAX_EFFECTIVE_DAYS_AHEAD) return { ok: false, error: `That is more than ${MAX_EFFECTIVE_DAYS_AHEAD} days away. Check the date.` };
  return { ok: true, date: d };
}

/**
 * Build the prenote or test-credit file for the planned checks of ONE method.
 * Nacha: a prenote is $0 with code 23/33 and should look like the live entry
 * (so PAYROLL); a test credit is under $1 and must say ACCTVERIFY. A file never
 * mixes the two, and never carries a live payment (payroll builds its own file).
 */
export function planCheckFile(input: {
  method: FileMethod;
  checks: readonly PlannedCheck[];
  originator: AchOriginator;
  effective: string;
  todayIso: string;
  createdAt: Date;
  /** R41 S3: the day's next free File ID Modifier, from the ach_files ledger (never a fixed letter). */
  fileIdModifier: string;
}): { ok: true; plan: CheckFilePlan } | { ok: false; error: string } {
  const { method, checks } = input;
  if (checks.length === 0) return { ok: false, error: `No ${method === "prenote" ? "prenotes" : "test credits"} are waiting to be sent.` };
  const eff = checkEffectiveDate(input.effective, input.todayIso);
  if (!eff.ok) return eff;
  const seen = new Set<string>();
  const entries: AchEntry[] = [];
  for (const c of checks) {
    if (c.method !== method) return { ok: false, error: `${c.payeeName}: a ${label(c.method)} cannot go in a ${label(method)} file.` };
    if (c.status !== "planned") return { ok: false, error: `${c.payeeName}: this check is already ${c.status}.` };
    if (seen.has(c.verificationId)) return { ok: false, error: `${c.payeeName}: listed twice.` };
    seen.add(c.verificationId);
    if (!isValidRouting(c.routing)) return { ok: false, error: `${c.payeeName}: the routing number on file fails the bank check digit. Fix the account before checking it.` };
    if (method === "micro_entry") {
      const v = validateMicroEntryCents(c.microCents ?? NaN);
      if (!v.ok) return { ok: false, error: `${c.payeeName}: ${v.error}` };
    } else if (c.microCents !== null) {
      return { ok: false, error: `${c.payeeName}: a prenote carries no amount.` };
    }
    entries.push({
      accountType: c.accountType,
      routing: c.routing,
      accountNumber: c.accountNumber,
      amountCents: method === "prenote" ? 0 : (c.microCents as number),
      name: c.payeeName,
      idNumber: c.payeeRef,
      prenote: method === "prenote",
    });
  }
  const built = buildNachaFile({
    originator: input.originator,
    entries,
    secCode: "PPD",
    companyEntryDescription: method === "prenote" ? PAYROLL_DESCRIPTION : MICRO_ENTRY_DESCRIPTION,
    effectiveDate: new Date(`${eff.date}T00:00:00Z`),
    createdAt: input.createdAt,
    fileIdModifier: input.fileIdModifier,
  });
  if (!built.ok) return { ok: false, error: built.error };
  const settlement = eff.date;
  const eligible = method === "prenote" ? prenoteLiveUploadDay(settlement) : addCalendarDays(settlement, 1);
  const next =
    method === "prenote"
      ? `Upload this file to Timberland. If no return or change notice comes back by ${eligible}, mark each prenote passed on or after that day.`
      : `Upload this file to Timberland. After ${settlement}, ask each person what amount (under $1) arrived, and type it in. Their real pay waits until they confirm it.`;
  return {
    ok: true,
    plan: {
      method,
      ids: checks.map((c) => c.verificationId),
      file: built.file,
      filename: `acctcheck_${method === "prenote" ? "prenote" : "testcredit"}_${eff.date}_${checks.length}.ach`,
      entryCount: built.entryCount,
      totalCents: built.totalCents,
      effective: eff.date,
      settlement,
      eligible,
      next,
    },
  };
}

function label(m: VerificationMethod): string {
  return m === "prenote" ? "prenote" : m === "micro_entry" ? "test credit" : "voided-check callback";
}

/** A test amount from a random source (crypto.randomInt in the store). 1..99. */
export function pickMicroCents(randomBelow: (n: number) => number): number {
  const c = 1 + randomBelow(99);
  if (!Number.isInteger(c) || c < 1 || c > 99) throw new Error(`pickMicroCents: random source returned ${c - 1}, outside 0..98.`);
  return c;
}

// ---------------------------------------------------------------------------
// 2. What a check is waiting for
// ---------------------------------------------------------------------------

export type CheckRow = {
  id: string;
  method: VerificationMethod;
  status: "planned" | "sent" | "passed" | "failed" | "cancelled";
  eligible_on: string | null;
  settlement_date: string | null;
};

export type CheckStep =
  | { kind: "download"; text: string }
  | { kind: "call"; text: string }
  | { kind: "wait"; until: string; text: string }
  | { kind: "pass_prenote"; text: string }
  | { kind: "ask_amount"; text: string }
  | { kind: "done"; text: string };

export function checkNextStep(r: CheckRow, todayIso: string): CheckStep {
  if (r.status === "passed" || r.status === "failed" || r.status === "cancelled") return { kind: "done", text: `This check ${r.status}.` };
  if (r.method === "voided_check_callback") return { kind: "call", text: "Call the person at a number on file and have them read back the account; then record it." };
  if (r.status === "planned") return { kind: "download", text: `Waiting to go in the next ${label(r.method)} file.` };
  if (!r.eligible_on) return { kind: "wait", until: "", text: "Sent; the dates are missing. Reload the page." };
  if (r.method === "prenote") {
    return todayIso >= r.eligible_on
      ? { kind: "pass_prenote", text: `No answer is needed for a prenote: if Timberland sent no return or change notice by ${r.eligible_on}, mark it passed.` }
      : { kind: "wait", until: r.eligible_on, text: `Sent. Wait until ${r.eligible_on} (${PRENOTE_WAIT_WORDS}) for any return.` };
  }
  return todayIso >= r.eligible_on
    ? { kind: "ask_amount", text: "Ask the person what amount (under $1) arrived and type it in. Silence is NOT a pass for a test credit." }
    : { kind: "wait", until: r.eligible_on, text: `Sent. From ${r.eligible_on}, ask the person what amount arrived.` };
}

/** The typed amount: "0.37", "$.37", "37" (cents) all mean 37 cents. */
export function parseConfirmedCents(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/^\$/, "");
  if (/^\d{1,2}$/.test(s)) return Number(s);
  const m = /^0?\.(\d{2})$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}

export function checkFinishForm(i: {
  method: VerificationMethod;
  outcome: string;
  confirmed: string | null | undefined;
  note: string | null | undefined;
}): { ok: true; outcome: "passed" | "failed" | "cancelled"; cents: number | null; note: string } | { ok: false; error: string } {
  if (i.outcome !== "passed" && i.outcome !== "failed" && i.outcome !== "cancelled") return { ok: false, error: "Choose passed, failed or cancelled." };
  const note = String(i.note ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (/\d{7,}/.test(note.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the note." };
  let cents: number | null = null;
  if (i.outcome === "passed") {
    if (i.method === "micro_entry") {
      cents = parseConfirmedCents(i.confirmed);
      if (cents === null || cents < 1) return { ok: false, error: "Type the amount the person says arrived, for example 0.37." };
    }
    if (i.method === "voided_check_callback" && note.length < MIN_CALLBACK_NOTE_CHARS) {
      return { ok: false, error: `Say who confirmed the account and how (at least ${MIN_CALLBACK_NOTE_CHARS} characters).` };
    }
  } else if (note.length < 5) {
    return { ok: false, error: "Say why (at least 5 characters)." };
  }
  return { ok: true, outcome: i.outcome, cents, note };
}

// ---------------------------------------------------------------------------
// 3. Employee hold release (same rules as ach_auth_release_hold)
// ---------------------------------------------------------------------------

/**
 * R41 S0 (D-6 option B): only the owner releases an employee hold, alone and
 * with no written reason (0271 ach_auth_release_hold, mode 'owner'). The
 * reason field is optional text that is stored when written.
 */
export function checkHoldReleaseForm(i: {
  actorIsOwner: boolean;
  method: string | null | undefined;
  note: string | null | undefined;
  reason: string | null | undefined;
}): { ok: true; method: CallbackMethod; note: string; reason: string } | { ok: false; error: string } {
  if (!i.actorIsOwner) return { ok: false, error: "Only Michael (the owner) releases an employee banking hold. Stephen's release goes to Michael for approval." };
  const method = String(i.method ?? "");
  if (!(CALLBACK_METHODS as readonly string[]).includes(method)) return { ok: false, error: "Say how the employee confirmed: by phone or in person." };
  const note = String(i.note ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (note.length < MIN_CALLBACK_NOTE_CHARS) return { ok: false, error: `Write who confirmed what (at least ${MIN_CALLBACK_NOTE_CHARS} characters).` };
  const reason = String(i.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  for (const t of [note, reason]) if (/\d{7,}/.test(t.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the note." };
  return { ok: true, method: method as CallbackMethod, note, reason };
}

// ---------------------------------------------------------------------------
// 4. Annual review (Nacha Phase 2)
// ---------------------------------------------------------------------------

export const REVIEW_SOON_DAYS = 30;

export type ReviewRow = { id: string; payee: string; state: string; annual_review_due_on: string | null };
export type ReviewItem = ReviewRow & { status: "overdue" | "due_soon" | "missing_date"; days: number | null };

/** Active authorizations that are overdue, due within 30 days, or have no date. Most urgent first. */
export function reviewList(rows: readonly ReviewRow[], todayIso: string): readonly ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const r of rows) {
    if (r.state !== "active") continue;
    if (!r.annual_review_due_on) {
      out.push({ ...r, status: "missing_date", days: null });
      continue;
    }
    const days = daysBetween(todayIso, r.annual_review_due_on);
    if (days < 0) out.push({ ...r, status: "overdue", days });
    else if (days <= REVIEW_SOON_DAYS) out.push({ ...r, status: "due_soon", days });
  }
  const rank = { missing_date: 0, overdue: 1, due_soon: 2 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.days ?? 0) - (b.days ?? 0) || a.payee.localeCompare(b.payee));
}

export function checkReviewNote(raw: string | null | undefined): { ok: true; note: string } | { ok: false; error: string } {
  const note = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (note.length < 10) return { ok: false, error: 'Say what was checked (at least 10 characters), for example "Called on file number; account and split unchanged".' };
  if (/\d{7,}/.test(note.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the note." };
  return { ok: true, note };
}

// ---------------------------------------------------------------------------
// 5. Legal hold and retention
// ---------------------------------------------------------------------------

export function checkLegalHoldReason(raw: string | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (reason.length < 10) return { ok: false, error: "Give the reason (at least 10 characters), for example the matter, or who asked and when." };
  if (/\d{7,}/.test(reason.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the reason." };
  return { ok: true, reason };
}

/** One line for the page next to an authorization. Never says "delete". */
export function retentionLine(i: { signedOn: string | null; endedOn: string | null; legalHold: boolean; todayIso: string }): string {
  if (!i.signedOn) return i.legalHold ? "Kept: a legal hold is in place." : "Kept: not signed yet.";
  const v: RetentionVerdict = retentionVerdict({ signedOn: i.signedOn, endedOn: i.endedOn, legalHold: i.legalHold, today: i.todayIso });
  if (v.kind === "keep_indefinitely") return `Kept: ${v.reason}`;
  if (v.kind === "keep_until") return `Kept until at least ${v.until} (${v.drivers.join("; ")}).`;
  return `The keep period ended ${v.since}. It stays archived; nothing is deleted automatically.`;
}

// ---------------------------------------------------------------------------
// 6. Test-credit monitoring (Nacha Micro-Entries Phase 2)
// ---------------------------------------------------------------------------

export type MonitorRow = {
  method: VerificationMethod;
  status: string;
  /** created_at (or sent date) as YYYY-MM-DD, Pacific. */
  on: string;
  result_code: string | null;
  /** The account's keyed hash (no bank numbers). */
  account_key: string;
  /** employee:<id> or vendor:<id>. */
  payee: string;
};

/** More than this many test credits to one account is worth a look. */
export const MAX_TESTS_PER_ACCOUNT = 2;

export type MonitorReport = {
  sent30: number;
  returned30: number;
  sent365: number;
  returned365: number;
  flags: readonly string[];
};

/**
 * Counts and flags for the banking page. A test credit counts as sent once
 * it left planned (sent, passed, failed with an R code). "Returned" = the
 * bank answered it with an R code. Flags are reasons to look, not verdicts.
 */
export function microEntryMonitor(rows: readonly MonitorRow[], todayIso: string): MonitorReport {
  const micro = rows.filter((r) => r.method === "micro_entry" && r.status !== "planned" && !(r.status === "cancelled" && !r.result_code));
  const d30 = addCalendarDays(todayIso, -30);
  const d365 = addCalendarDays(todayIso, -365);
  const returned = (r: MonitorRow) => /^R\d{2}$/.test(r.result_code ?? "");
  const in30 = micro.filter((r) => r.on > d30 && r.on <= todayIso);
  const in365 = micro.filter((r) => r.on > d365 && r.on <= todayIso);
  const flags: string[] = [];
  const ret365 = in365.filter(returned);
  if (ret365.length) flags.push(`${ret365.length} test credit${ret365.length === 1 ? "" : "s"} came back in the last year (${[...new Set(ret365.map((r) => r.result_code))].join(", ")}). Find out why before sending more.`);
  const perAcct = new Map<string, number>();
  for (const r of in365) perAcct.set(r.account_key, (perAcct.get(r.account_key) ?? 0) + 1);
  const busy = [...perAcct.values()].filter((n) => n > MAX_TESTS_PER_ACCOUNT).length;
  if (busy) flags.push(`${busy} account${busy === 1 ? " was" : "s were"} sent more than ${MAX_TESTS_PER_ACCOUNT} test credits in the last year.`);
  // Same account given by two different payees: across ALL checks, any method.
  const payeesByAcct = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = payeesByAcct.get(r.account_key) ?? new Set<string>();
    s.add(r.payee);
    payeesByAcct.set(r.account_key, s);
  }
  const shared = [...payeesByAcct.values()].filter((s) => s.size > 1).length;
  if (shared) flags.push(`${shared} bank account${shared === 1 ? " is" : "s are"} on file for more than one person. That can be a household, or a fraud sign; check it.`);
  return { sent30: in30.length, returned30: in30.filter(returned).length, sent365: in365.length, returned365: ret365.length, flags };
}

// ---------------------------------------------------------------------------
// 7. Database refusals (0263) in words
// ---------------------------------------------------------------------------

const OPS_FUNCTIONS = /ach_notice_log|ach_notice_resolve|ach_auth_release_hold|ach_verification_start|ach_verification_mark_sent|ach_verification_finish|ach_auth_set_legal_hold|ach_auth_review_done|hold_entered_by|payee_type/;

export const OPS_ERROR_TABLE: readonly (readonly [RegExp, string])[] = [
  [/ACH_NOTICE_ACTOR|ACH_RELEASE_ACTOR|ACH_VERIFICATION_ACTOR/, "Sign in again: who did this must be recorded."],
  [/ACH_NOTICE_PAYEE/, "Pick the employee or vendor the payment was for."],
  [/ACH_NOTICE_CODE/, "The code is R or C and two digits, for example R03 or C01."],
  [/ACH_NOTICE_DATE/, "Check the dates: the notice is from the last 400 days, and the payment settled before the notice came."],
  [/ACH_NOTICE_NOC/, "A change notice (C-code) needs the corrected information; a return (R-code) has none."],
  [/ACH_NOTICE_REASON/, "Write a little more (at least 10 characters)."],
  [/ACH_NOTICE_VERIFICATION/, "That account check is not waiting for an answer, or belongs to someone else. Reload the page."],
  [/ACH_NOTICE_NOT_FOUND/, "That notice no longer exists. Reload the page."],
  [/ACH_NOTICE_FINAL/, "That notice is already resolved."],
  [/ACH_NOTICE_KEEP|ACH_VERIFICATION_KEEP/, "This is a payment record; it is kept and cannot be deleted."],
  [/ACH_NOTICE_IMMUTABLE/, "The facts of a logged notice cannot be changed. Resolve it with a note that explains the mistake, and log the right one."],
  [/ACH_RELEASE_NOT_FOUND/, "That authorization no longer exists. Reload the page."],
  [/ACH_RELEASE_PAYEE/, "Vendor holds are released on the Vault tab (with the callback)."],
  [/ACH_RELEASE_STATE/, "It is not on hold any more. Reload the page."],
  [/ACH_RELEASE_CALLBACK/, "Record how the employee confirmed (phone or in person) and a note of at least 10 characters."],
  [/ACH_OWNER_ONLY/, "Only Michael (the owner) can do this. Stephen's version goes to Michael for approval."],
  // Raised only by the R39 0263 function, before 0271 replaces it.
  [/ACH_RELEASE_SOLO/, "You put this hold on, so releasing it alone needs a written reason of at least 20 characters."],
  [/ACH_VERIFICATION_METHOD/, "Choose prenote, test credit or voided-check callback."],
  [/ACH_VERIFICATION_ACCOUNT/, "That account is archived or already verified. Reload the page."],
  [/ach_ver_one_open_per_account/, "That account already has a check in progress. Finish or cancel it first."],
  [/ACH_VERIFICATION_STATE/, "The authorization is on hold, revoked or not signed. Release the hold first, then check the account."],
  [/ACH_VERIFICATION_EMPTY/, "Nothing was selected."],
  [/ACH_VERIFICATION_DATES|ach_ver_sent_shape/, "The file dates are out of order. Pick the effective date again."],
  [/ACH_VERIFICATION_NOT_FOUND/, "That check no longer exists. Reload the page."],
  [/ACH_VERIFICATION_OUTCOME/, "Choose passed, failed or cancelled."],
  [/ACH_VERIFICATION_FINAL/, "That check is already finished."],
  [/ACH_VERIFICATION_TRANSITION/, "That check cannot move that way (a file check must be sent before it passes)."],
  [/ACH_VERIFICATION_IMMUTABLE/, "The account, method, amount and sent dates of a check cannot change. Cancel it and start a new one."],
  [/ACH_VERIFICATION_NOTE|ach_ver_note_shape/, "Write a short note: who confirmed and how (a pass by callback needs 10+ characters; a fail or cancel needs 5+)."],
  [/ACH_VERIFICATION_NOTICE/, "The bank answered this check with a return or change notice, so it cannot pass. Fix the account and start a new check."],
  [/ACH_VERIFICATION_AMOUNT/, "That is not the amount that was sent. Ask the person to look again; do not guess."],
  [/ACH_VERIFICATION_EARLY/, `Too early: a prenote passes only on or after its wait day (${PRENOTE_WAIT_WORDS}).`],
  [/ACH_LEGAL_HOLD/, "Legal hold: give a reason of at least 10 characters (or it is already in that state; reload)."],
  [/ACH_REVIEW/, "Only an active authorization is reviewed, and the note needs at least 10 characters."],
  [/ACH_AUTH_TRANSITION|ach_auth_guard/, "The authorization cannot move that way. Reload the page."],
  [/VAULT_/, "The vault refused the change (0259). Check the hold on the Vault tab."],
];

export function opsDbErrorMessage(message: string | null | undefined): string {
  const m = String(message ?? "");
  if (OPS_FUNCTIONS.test(m) && /does not exist|Could not find|PGRST20[25]|42P01|42883|42703/.test(m)) {
    return "One-time setup needed: apply migration 0263 (docs/MIGRATIONS_TO_RUN.md), then try again.";
  }
  for (const [re, text] of OPS_ERROR_TABLE) if (re.test(m)) return text;
  return `The database refused the change: ${m.slice(0, 300)}`;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAchOpsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ach-ops-core:", msg);
    }
  };
  const ORIG: AchOriginator = {
    destinationRouting: "325170754",
    destinationName: "TIMBERLAND BANK",
    immediateOrigin: "1911234567",
    companyName: "GREENWAY MARIJUANA",
    companyId: "1911234567",
    originatingDfi: "32517075",
    companyEin: "911234567", // R41 S2: Timberland shape (test EIN, not Greenway's)
  };
  const chk = (over: Partial<PlannedCheck> = {}): PlannedCheck => ({
    verificationId: "v1",
    method: "prenote",
    status: "planned",
    microCents: null,
    payeeName: "Ann Lee",
    payeeRef: "E1",
    accountType: "checking",
    routing: "125000024",
    accountNumber: "000123456789",
    ...over,
  });
  const T = "2026-10-09"; // Friday
  const at = new Date("2026-10-09T17:00:00Z");

  // effective dates
  // R41 S5: Fri Oct 9 10:00 PT -> upload today, 2 usable days on = Tue Oct 13 is only 1 (Columbus Day Mon 10-12), so Wed Oct 14.
  ok(defaultCheckEffectiveDate(at) === "2026-10-14", "default = earliest Timberland allows: Fri 10:00 -> Wed 10-14 (skips the weekend and Columbus Day)");
  ok(defaultCheckEffectiveDate(new Date("2026-10-09T23:00:00Z")) === "2026-10-15", "after the 4:00 pm cutoff Friday the default moves a day: Thu 10-15");
  ok(!checkEffectiveDateForRelease("2026-10-13", at).ok, "release check: Tue 10-13 is 1 banking day out -> refused");
  const relS5 = checkEffectiveDateForRelease("2026-10-14", at);
  ok(relS5.ok && relS5.uploadBy === "Fri Oct 9, 3:30 pm Pacific (bank cutoff 4:00 pm)" && relS5.warning === null, "release check: Wed 10-14 ok, upload by Fri 3:30 pm");
  ok(/2 banking days ahead, by 4:00 pm Pacific \(Schedule A\)/.test((checkEffectiveDate("2026-10-09", T) as { error: string }).error ?? ""), "the old 'a day ahead' wording is gone");
  ok(checkEffectiveDate("2026-10-09", T).ok === false, "today refused");
  ok(checkEffectiveDate("2026-10-10", T).ok === false, "Saturday refused");
  ok(checkEffectiveDate("2026-10-12", T).ok === false, "FRB holiday refused");
  ok(checkEffectiveDate("2026-10-13", T).ok === true, "Tue accepted");
  ok(checkEffectiveDate("2026-02-30", T).ok === false, "impossible date refused");
  ok(checkEffectiveDate("2026-11-30", T).ok === false, "more than 30 days refused");
  ok(checkEffectiveDate("2026-11-06", T).ok === true, "28 days accepted");
  // Date.parse rolls 2026-11-31 over to Tue 2026-12-01 (a banking day within 30 days of 11-20).
  const imp = checkEffectiveDate("2026-11-31", "2026-11-20");
  ok(!imp.ok && imp.error.startsWith("Pick the date"), "impossible future date refused as a date, not rolled over");

  // prenote file
  const p = planCheckFile({ method: "prenote", checks: [chk(), chk({ verificationId: "v2", accountNumber: "555", accountType: "savings" })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" });
  ok(p.ok, "prenote file builds");
  if (p.ok) {
    const lines = p.plan.file.split("\n");
    const batch = lines.find((l) => l.startsWith("5")) ?? "";
    const e6 = lines.filter((l) => l.startsWith("6"));
    ok(batch.slice(53, 63).trim() === "PAYROLL", "prenote batch says PAYROLL (looks like the live entry)");
    ok(batch.slice(50, 53) === "PPD", "PPD");
    ok(e6.length === 2 && e6[0].slice(1, 3) === "23" && e6[1].slice(1, 3) === "33", "codes 23 / 33");
    ok(e6.every((l) => l.slice(29, 39) === "0000000000"), "amount zero");
    ok(p.plan.totalCents === 0 && p.plan.entryCount === 2, "totals");
    ok(p.plan.settlement === "2026-10-13" && p.plan.eligible === "2026-10-21", "eligible = 6 banking days after settlement (Timberland section 6)");
    ok(p.plan.eligible > p.plan.settlement && p.plan.settlement >= p.plan.effective, "dates satisfy 0263's order");
    ok(p.plan.ids.join() === "v1,v2", "ids carried");
    ok(/^acctcheck_prenote_2026-10-13_2\.ach$/.test(p.plan.filename), "filename");
    ok(lines[0].slice(33, 34) === "A", "R41 S3: the File ID Modifier is the one passed in");
  }
  // R41 S3: no fixed "P"/"M" letter: the ledger's next letter goes in position 34.
  const pc = planCheckFile({ method: "prenote", checks: [chk()], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "C" });
  ok(pc.ok && pc.plan.file.split("\n")[0].slice(33, 34) === "C", "prenote takes the given modifier C");
  const mc = planCheckFile({ method: "micro_entry", checks: [chk({ method: "micro_entry", microCents: 5 })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "7" });
  ok(mc.ok && mc.plan.file.split("\n")[0].slice(33, 34) === "7", "test credit takes the given modifier 7");
  ok(!planCheckFile({ method: "prenote", checks: [chk()], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "p" }).ok, "a lower-case modifier is refused (nacha-core)");
  // micro file
  const m = planCheckFile({ method: "micro_entry", checks: [chk({ method: "micro_entry", microCents: 37 })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" });
  ok(m.ok, "micro file builds");
  if (m.ok) {
    const lines = m.plan.file.split("\n");
    ok((lines.find((l) => l.startsWith("5")) ?? "").slice(53, 63).trim() === MICRO_ENTRY_DESCRIPTION, "ACCTVERIFY");
    const e6 = lines.filter((l) => l.startsWith("6"));
    ok(e6[0].slice(1, 3) === "22" && e6[0].slice(29, 39) === "0000000037", "live credit code, 37 cents");
    ok(m.plan.eligible === "2026-10-14", "micro eligible = settlement + 1 (matches 0263)");
  }
  // Each refusal is checked by its OWN words: nacha-core would refuse some of these too, with less useful words.
  const err = (r: ReturnType<typeof planCheckFile>) => (r.ok ? "" : r.error);
  const base = { originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" };
  ok(err(planCheckFile({ method: "prenote", checks: [], ...base })) === "No prenotes are waiting to be sent.", "empty refused in words");
  ok(err(planCheckFile({ method: "micro_entry", checks: [], ...base })) === "No test credits are waiting to be sent.", "empty micro refused in words");
  ok(err(planCheckFile({ method: "prenote", checks: [chk({ method: "micro_entry", microCents: 5 })], ...base })).includes("a test credit cannot go in a prenote file"), "mixed method refused");
  ok(err(planCheckFile({ method: "micro_entry", checks: [chk({ method: "prenote" })], ...base })).includes("a prenote cannot go in a test credit file"), "mixed method refused (other way)");
  ok(err(planCheckFile({ method: "prenote", checks: [chk({ status: "sent" })], ...base })).includes("already sent"), "not planned refused");
  ok(err(planCheckFile({ method: "prenote", checks: [chk(), chk()], ...base })).endsWith("listed twice."), "same check twice refused");
  ok(err(planCheckFile({ method: "prenote", checks: [chk({ routing: "125000025" })], ...base })).includes("Fix the account before checking it"), "bad routing refused");
  ok(!planCheckFile({ method: "micro_entry", checks: [chk({ method: "micro_entry", microCents: 100 })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" }).ok, "$1.00 test refused");
  ok(!planCheckFile({ method: "micro_entry", checks: [chk({ method: "micro_entry", microCents: null })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" }).ok, "missing cents refused");
  ok(!planCheckFile({ method: "prenote", checks: [chk({ microCents: 5 })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" }).ok, "prenote with amount refused");
  ok(!planCheckFile({ method: "prenote", checks: [chk()], originator: ORIG, effective: "2026-10-10", todayIso: T, createdAt: at, fileIdModifier: "A" }).ok, "weekend effective refused");
  const dup = planCheckFile({ method: "prenote", checks: [chk(), chk({ verificationId: "v2" })], originator: ORIG, effective: "2026-10-13", todayIso: T, createdAt: at, fileIdModifier: "A" });
  ok(!dup.ok, "same account prenoted twice refused (nacha-core)");

  // micro cents
  ok(pickMicroCents(() => 0) === 1 && pickMicroCents(() => 98) === 99, "pickMicroCents range 1..99");
  let threw = false;
  try {
    pickMicroCents(() => 99);
  } catch {
    threw = true;
  }
  ok(threw, "pickMicroCents refuses a bad random source");

  // next step
  const row = (o: Partial<CheckRow>): CheckRow => ({ id: "x", method: "prenote", status: "sent", eligible_on: "2026-10-16", settlement_date: "2026-10-13", ...o });
  ok(checkNextStep(row({}), "2026-10-15").kind === "wait", "prenote waits");
  ok(checkNextStep(row({}), "2026-10-16").kind === "pass_prenote", "prenote passable on eligible day");
  ok(checkNextStep(row({ method: "micro_entry", eligible_on: "2026-10-14" }), "2026-10-14").kind === "ask_amount", "micro asks");
  ok(checkNextStep(row({ method: "micro_entry", eligible_on: "2026-10-14" }), "2026-10-13").kind === "wait", "micro waits");
  ok(checkNextStep(row({ status: "planned" }), T).kind === "download", "planned -> download");
  ok(checkNextStep(row({ method: "voided_check_callback", status: "planned" }), T).kind === "call", "callback -> call");
  ok(checkNextStep(row({ status: "failed" }), T).kind === "done", "finished -> done");

  // confirmed cents
  ok(parseConfirmedCents("0.37") === 37 && parseConfirmedCents("$.37") === 37 && parseConfirmedCents("37") === 37 && parseConfirmedCents("7") === 7, "amount forms");
  ok(parseConfirmedCents("100") === null && parseConfirmedCents("150") === null, "three digits is not a test amount");
  ok(parseConfirmedCents("1.00") === null && parseConfirmedCents("0.3") === null && parseConfirmedCents("") === null && parseConfirmedCents("abc") === null, "bad amounts");

  // finish form
  ok(checkFinishForm({ method: "micro_entry", outcome: "passed", confirmed: "0.37", note: "" }).ok, "micro pass with amount");
  ok(!checkFinishForm({ method: "micro_entry", outcome: "passed", confirmed: "", note: "" }).ok, "micro pass needs amount");
  ok(!checkFinishForm({ method: "voided_check_callback", outcome: "passed", confirmed: null, note: "short" }).ok, "callback pass needs 10");
  ok(checkFinishForm({ method: "voided_check_callback", outcome: "passed", confirmed: null, note: "Ann read back 4821" }).ok, "callback pass ok");
  ok(checkFinishForm({ method: "prenote", outcome: "passed", confirmed: null, note: "" }).ok, "prenote pass needs no note");
  ok(!checkFinishForm({ method: "prenote", outcome: "failed", confirmed: null, note: "no" }).ok, "fail needs 5");
  ok(!checkFinishForm({ method: "prenote", outcome: "maybe", confirmed: null, note: "whatever" }).ok, "bad outcome");
  ok(!checkFinishForm({ method: "prenote", outcome: "cancelled", confirmed: null, note: "acct 123456789" }).ok, "no account numbers in note");

  // release form
  const rel = (o: Partial<Parameters<typeof checkHoldReleaseForm>[0]>) =>
    checkHoldReleaseForm({ actorIsOwner: true, method: "phone", note: "Ann confirmed 4821", reason: "", ...o });
  ok(rel({}).ok, "owner release ok without a reason (R41 S0)");
  ok(!rel({ actorIsOwner: false }).ok, "non-owner refused");
  ok(!rel({ actorIsOwner: false, reason: "Stephen is away until Monday; payroll Friday" }).ok, "a reason never lets a non-owner release");
  const withR = rel({ reason: "Called Ann at the number on file" });
  ok(withR.ok && withR.reason === "Called Ann at the number on file", "an optional reason is kept");
  ok(!rel({ method: "email" }).ok, "email is not a callback");
  ok(!rel({ note: "ok" }).ok, "short note refused");
  ok(!rel({ note: "new acct 123456789" }).ok, "numbers refused");

  // review list
  const rv = reviewList(
    [
      { id: "a", payee: "B", state: "active", annual_review_due_on: "2026-10-01" },
      { id: "b", payee: "A", state: "active", annual_review_due_on: "2026-10-30" },
      { id: "c", payee: "C", state: "active", annual_review_due_on: "2027-01-01" },
      { id: "d", payee: "D", state: "on_hold", annual_review_due_on: "2026-01-01" },
      { id: "e", payee: "E", state: "active", annual_review_due_on: null },
      { id: "f", payee: "F", state: "active", annual_review_due_on: "2026-11-08" },
    ],
    T,
  );
  ok(rv.map((r) => r.id).join() === "e,a,b,f", "review order: missing, overdue, due soon by days; far and not-active skipped");
  ok(rv[1].days === -8 && rv[2].days === 21 && rv[3].days === 30, "days counted (30 is inside the window)");
  const edge = reviewList([{ id: "y", payee: "Y", state: "active", annual_review_due_on: "2026-10-08" }, { id: "z", payee: "Z", state: "active", annual_review_due_on: "2026-10-09" }], T);
  ok(edge[0].id === "y" && edge[0].status === "overdue" && edge[0].days === -1, "due yesterday is overdue");
  ok(edge[1].id === "z" && edge[1].status === "due_soon" && edge[1].days === 0, "due today is due soon, not overdue");
  ok(!checkReviewNote("ok").ok && checkReviewNote("Called on file; unchanged").ok, "review note");

  // legal hold, retention
  ok(!checkLegalHoldReason("short").ok && checkLegalHoldReason("L&I audit letter 10/1").ok, "legal hold reason");
  ok(retentionLine({ signedOn: "2026-01-01", endedOn: null, legalHold: false, todayIso: T }).startsWith("Kept: The authorization is still in effect"), "live -> kept");
  ok(retentionLine({ signedOn: "2026-01-01", endedOn: "2026-06-01", legalHold: true, todayIso: T }).includes("legal hold"), "legal hold -> kept");
  ok(retentionLine({ signedOn: "2026-01-01", endedOn: "2026-06-01", legalHold: false, todayIso: T }).includes("2032-06-01"), "ended -> 6 years after end");
  ok(retentionLine({ signedOn: "2010-01-01", endedOn: "2012-01-01", legalHold: false, todayIso: T }).includes("nothing is deleted automatically"), "past -> archived, never auto-deleted");
  ok(!/delete it|deleted now/i.test(retentionLine({ signedOn: "2010-01-01", endedOn: "2012-01-01", legalHold: false, todayIso: T })), "never invites deletion");

  // monitor
  const mr = (o: Partial<MonitorRow>): MonitorRow => ({ method: "micro_entry", status: "passed", on: "2026-10-01", result_code: null, account_key: "k1", payee: "employee:1", ...o });
  const rep = microEntryMonitor(
    [
      mr({}),
      mr({ status: "failed", result_code: "R03", on: "2026-09-20", account_key: "k2", payee: "employee:2" }),
      mr({ on: "2026-01-15" }),
      mr({ on: "2025-12-01" }),
      mr({ status: "planned" }),
      mr({ status: "cancelled" }),
      mr({ method: "prenote", account_key: "k2", payee: "employee:3" }),
      mr({ on: "2024-01-01" }),
    ],
    T,
  );
  ok(rep.sent30 === 2 && rep.returned30 === 1, `30-day counts (${rep.sent30}/${rep.returned30})`);
  ok(rep.sent365 === 4 && rep.returned365 === 1, `365-day counts (${rep.sent365}/${rep.returned365})`);
  ok(rep.flags.some((f) => f.includes("came back") && f.includes("R03")), "returned flag names the code");
  ok(rep.flags.some((f) => f.includes("more than 2 test credits")), "velocity flag (k1 tested 3 times in a year)");
  ok(rep.flags.some((f) => f.includes("more than one person")), "shared account flag (k2: employee 2 and 3)");
  // Window edges: 30 days before 2026-10-09 is 2026-09-09 (out); 09-10 is in.
  const e30 = microEntryMonitor([mr({ on: "2026-09-09", account_key: "a" }), mr({ on: "2026-09-10", account_key: "b" })], T);
  ok(e30.sent30 === 1 && e30.sent365 === 2, `30-day window is the last 30 days, not 31 (${e30.sent30})`);
  const quiet = microEntryMonitor([mr({}), mr({ on: "2026-09-01" })], T);
  ok(quiet.flags.length === 0 && quiet.sent365 === 2, "quiet month: no flags");

  // errors
  ok(opsDbErrorMessage('Could not find the function public.ach_notice_log(p_actor, ...)').includes("migration 0263"), "missing fn -> setup");
  ok(opsDbErrorMessage('column "hold_entered_by" does not exist (42703)').includes("migration 0263"), "missing column -> setup");
  ok(opsDbErrorMessage("ACH_VERIFICATION_EARLY: a prenote passes only on or after").includes("Too early"), "EARLY mapped");
  ok(opsDbErrorMessage("ACH_RELEASE_SOLO: ...").includes("20 characters"), "SOLO mapped");
  ok(opsDbErrorMessage("23514 ACH_OWNER_ONLY: only the owner releases an employee banking hold.").startsWith("Only Michael (the owner)"), "R41 0271 OWNER_ONLY mapped in plain words");
  ok(opsDbErrorMessage('duplicate key value violates unique constraint "ach_ver_one_open_per_account"').includes("already has a check"), "unique mapped");
  ok(opsDbErrorMessage("something else").startsWith("The database refused"), "fallback");
  ok(opsDbErrorMessage("ACH_VERIFICATION_FINAL: x").includes("already finished"), "FINAL not swallowed by a broader pattern");

  return { passed, failed };
}
