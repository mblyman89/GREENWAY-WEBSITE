/**
 * ACH AUTHORIZATION CORE - pure rules for direct-deposit authorizations.
 *
 * R39 S1. No I/O, no clock, no crypto, no database. Every function takes the
 * facts it needs and returns a verdict, so each rule is testable in isolation
 * and the store/UI layers (S3-S7) cannot each grow their own copy.
 *
 * Every timing rule below names the authority it implements by id; the quote
 * itself lives in ach-authorities.ts and is verbatim-checked.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   - Debits. Greenway originates CREDITS ONLY (owner answer Q4). There is no
 *     debit transaction code in this file and `transactionCodeFor` cannot
 *     produce one.
 *   - Plaid. Owner answer Q3: prenote and the sub-$1 test credit are the two
 *     verification methods; Plaid is not wired.
 *   - Self-service. Owner answer Q12: employees and vendors never edit their
 *     own banking; a person with settings.manage enters it.
 *
 * DATES are ISO "YYYY-MM-DD" strings, computed in UTC so a server in any time
 * zone gets the same banking day. (The store converts Pacific wall-clock "now"
 * to a date before calling in.)
 */

import type { AchAuthorityId } from "./ach-authorities";

// ───────────────────────────────────────────────────────────────────────────
// 1. Date helpers (UTC, ISO dates)
// ───────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): Date {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`ach-authorization-core: not an ISO date: "${iso}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== iso) {
    throw new Error(`ach-authorization-core: impossible date: "${iso}"`);
  }
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Add whole years; Feb 29 + 1y lands on Feb 28 (never rolls into March). */
export function addYears(iso: string, years: number): string {
  const d = parseIso(iso);
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(iso: string): number {
  return parseIso(iso).getUTCDay();
}

function maxIso(dates: readonly string[]): string {
  return [...dates].sort().at(-1)!;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. FedACH banking days
// ───────────────────────────────────────────────────────────────────────────

/**
 * The FRB holiday table, copied from docs/authorities/ach/
 * frbservices-holiday-schedule.txt (2026-2030 columns). A test re-reads that
 * file and checks every date below, and checks the file's own * / ** markers
 * (Saturday / Sunday) against the computed weekday.
 *
 * NOT the payroll deposit schedule's DC calendar: FedACH does not close for
 * DC Emancipation Day, and it DOES close for Columbus Day and Veterans Day.
 */
export const FRB_HOLIDAYS: Readonly<Record<number, readonly string[]>> = {
  2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-04", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"],
  2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-19", "2027-07-04", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-25"],
  2028: ["2028-01-01", "2028-01-17", "2028-02-21", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-10-09", "2028-11-11", "2028-11-23", "2028-12-25"],
  2029: ["2029-01-01", "2029-01-15", "2029-02-19", "2029-05-28", "2029-06-19", "2029-07-04", "2029-09-03", "2029-10-08", "2029-11-11", "2029-11-22", "2029-12-25"],
  2030: ["2030-01-01", "2030-01-21", "2030-02-18", "2030-05-27", "2030-06-19", "2030-07-04", "2030-09-02", "2030-10-14", "2030-11-11", "2030-11-28", "2030-12-25"],
};

export const FEDACH_RULE_AUTHORITY: AchAuthorityId = "ach-fedach-saturday-sunday";

/**
 * Weekday closures for a year, applying the FRB footnotes verbatim-cited in
 * FEDACH_RULE_AUTHORITY: a Saturday holiday leaves the Fed OPEN the preceding
 * Friday (so no weekday closure at all); a Sunday holiday closes the
 * following Monday.
 *
 * Throws outside the mirrored years. Rule 48: a banking-day calculator that
 * guesses a future holiday calendar would silently mis-date a prenote; a loud
 * error tells whoever is maintaining this to mirror the new FRB schedule.
 */
export function fedAchClosures(year: number): readonly string[] {
  const list = FRB_HOLIDAYS[year];
  if (!list) {
    throw new Error(
      `ach-authorization-core: no FRB holiday schedule mirrored for ${year}. ` +
        `Mirror the current https://www.frbservices.org/about/holiday-schedules into ` +
        `docs/authorities/ach/ and extend FRB_HOLIDAYS - do not guess.`,
    );
  }
  const out: string[] = [];
  for (const h of list) {
    const w = weekday(h);
    if (w === 6) continue; // Saturday: open the preceding Friday
    if (w === 0) out.push(addCalendarDays(h, 1)); // Sunday: closed Monday
    else out.push(h);
  }
  return out;
}

export function isFedAchBankingDay(iso: string): boolean {
  const w = weekday(iso);
  if (w === 0 || w === 6) return false;
  const year = Number(iso.slice(0, 4));
  return !fedAchClosures(year).includes(iso);
}

/** The nth banking day AFTER `iso` (n >= 1). `iso` itself never counts. */
export function addBankingDays(iso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addBankingDays: n must be a whole number >= 0, got ${n}`);
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addCalendarDays(d, 1);
    if (isFedAchBankingDay(d)) left -= 1;
  }
  return d;
}

/** `iso` if it is a banking day, else the next one. */
export function nextBankingDayOnOrAfter(iso: string): string {
  return isFedAchBankingDay(iso) ? iso : addBankingDays(iso, 1);
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Timing rules
// ───────────────────────────────────────────────────────────────────────────

export const PRENOTE_WAIT_BANKING_DAYS = 3; // ach-prenote-three-banking-days
export const RETURN_WINDOW_BANKING_DAYS = 2; // ach-returns-second-banking-day
export const NOC_DEADLINE_BANKING_DAYS = 6; // ach-noc-six-banking-days
export const REVERSAL_WINDOW_BANKING_DAYS = 5; // ach-reversal-five-banking-days

/**
 * Earliest date a LIVE credit may be sent to an account that was prenoted,
 * given the prenote's settlement date: three banking days after settlement,
 * and only if no return or NOC arrived. Counted as banking days AFTER the
 * settlement date (settlement day itself is day 0).
 */
export function prenoteLiveEligibleDate(prenoteSettlementDate: string): string {
  return addBankingDays(prenoteSettlementDate, PRENOTE_WAIT_BANKING_DAYS);
}

export type PrenoteOutcome =
  | { kind: "wait"; eligibleOn: string }
  | { kind: "eligible" }
  | { kind: "blocked_return"; code: string }
  | { kind: "blocked_noc"; code: string };

export function prenoteOutcome(input: {
  settlementDate: string;
  today: string;
  returnCode?: string | null;
  nocCode?: string | null;
}): PrenoteOutcome {
  if (input.returnCode) return { kind: "blocked_return", code: input.returnCode };
  if (input.nocCode) return { kind: "blocked_noc", code: input.nocCode };
  const eligibleOn = prenoteLiveEligibleDate(input.settlementDate);
  return input.today >= eligibleOn ? { kind: "eligible" } : { kind: "wait", eligibleOn };
}

/** Last day a return is expected for an entry settled on `settlementDate`. */
export function returnWindowCloses(settlementDate: string): string {
  return addBankingDays(settlementDate, RETURN_WINDOW_BANKING_DAYS);
}

/**
 * When a NOC must be applied. The bank summary says "before processing the
 * next payment or within six banking days". This takes the EARLIER of the two
 * - the conservative reading - and it costs nothing here, because a NOC puts
 * the account on hold anyway (section 6), so the next payment to it cannot go
 * until the correction is released.
 */
export function nocApplyBy(receivedDate: string, nextScheduledEntryDate: string | null): string {
  const six = addBankingDays(receivedDate, NOC_DEADLINE_BANKING_DAYS);
  return nextScheduledEntryDate && nextScheduledEntryDate < six ? nextScheduledEntryDate : six;
}

/** Last day a reversal of an erroneous entry may be transmitted. */
export function reversalDeadline(erroneousSettlementDate: string): string {
  return addBankingDays(erroneousSettlementDate, REVERSAL_WINDOW_BANKING_DAYS);
}

export const REVERSAL_DESCRIPTION = "REVERSAL"; // ach-reversal-description
export const PAYROLL_DESCRIPTION = "PAYROLL"; // ach-payroll-description
export const MICRO_ENTRY_DESCRIPTION = "ACCTVERIFY"; // ach-micro-entry-acctverify
export const VENDOR_DESCRIPTION = "VENDOR PAY"; // existing vendor-ach-core convention (not a Nacha rule)

// ───────────────────────────────────────────────────────────────────────────
// 4. Transaction codes and verification entries (credits only)
// ───────────────────────────────────────────────────────────────────────────

export type AccountType = "checking" | "savings";

/** ach-prenote-codes. Credits only: 22/32 live, 23/33 prenote. */
export function transactionCodeFor(accountType: AccountType, prenote: boolean): "22" | "32" | "23" | "33" {
  if (accountType === "checking") return prenote ? "23" : "22";
  return prenote ? "33" : "32";
}

export const ALLOWED_TRANSACTION_CODES = ["22", "23", "32", "33"] as const;

export function isAllowedTransactionCode(code: string): boolean {
  return (ALLOWED_TRANSACTION_CODES as readonly string[]).includes(code);
}

export type VerificationMethod = "prenote" | "micro_entry" | "voided_check_callback";

/**
 * Micro-entry ("test credit") validation. ach-micro-entry-under-one-dollar:
 * strictly LESS than $1.00, so 1..99 cents. A credit only - Greenway never
 * sends the offsetting debit, so the payee keeps the pennies.
 */
export function validateMicroEntryCents(cents: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(cents)) return { ok: false, error: "Test credit must be a whole number of cents." };
  if (cents < 1) return { ok: false, error: "Test credit must be at least 1 cent." };
  if (cents >= 100) return { ok: false, error: "Test credit must be less than $1.00 (Nacha micro-entry rule)." };
  return { ok: true };
}

/**
 * ach-micro-entry-no-simultaneous-live: a file carrying a test credit to an
 * account may not also carry a live credit to that same account.
 */
export function microEntryFileConflicts(
  entries: readonly { accountKey: string; kind: "micro_entry" | "live" | "prenote" }[],
): readonly string[] {
  const micro = new Set(entries.filter((e) => e.kind === "micro_entry").map((e) => e.accountKey));
  return [...new Set(entries.filter((e) => e.kind === "live" && micro.has(e.accountKey)).map((e) => e.accountKey))];
}

/** Payee typed back the amounts they saw. Exact match only, order-free. */
export function microEntryConfirmed(sentCents: readonly number[], typedCents: readonly number[]): boolean {
  if (sentCents.length === 0 || sentCents.length !== typedCents.length) return false;
  const a = [...sentCents].sort((x, y) => x - y);
  const b = [...typedCents].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Split deposits (owner answer Q11: up to 3 accounts)
// ───────────────────────────────────────────────────────────────────────────

export const MAX_ACCOUNTS_PER_PAYEE = 3;

export type SplitRule =
  | { kind: "fixed"; cents: number }
  | { kind: "percent"; basisPoints: number } // 1% = 100 bp
  | { kind: "remainder" };

export type SplitAccount = { accountKey: string; priority: number; rule: SplitRule };

export function validateSplits(accounts: readonly SplitAccount[]): readonly string[] {
  const errs: string[] = [];
  if (accounts.length === 0) errs.push("At least one account is required.");
  if (accounts.length > MAX_ACCOUNTS_PER_PAYEE) errs.push(`At most ${MAX_ACCOUNTS_PER_PAYEE} accounts are allowed.`);
  const rem = accounts.filter((a) => a.rule.kind === "remainder").length;
  if (rem !== 1) errs.push(`Exactly one account must receive the remainder (found ${rem}).`);
  const keys = accounts.map((a) => a.accountKey);
  if (new Set(keys).size !== keys.length) errs.push("The same account is listed twice.");
  const pr = accounts.map((a) => a.priority);
  if (new Set(pr).size !== pr.length) errs.push("Two accounts share a priority.");
  let bp = 0;
  for (const a of accounts) {
    if (a.rule.kind === "fixed" && (!Number.isInteger(a.rule.cents) || a.rule.cents <= 0)) {
      errs.push("A fixed amount must be a positive whole number of cents.");
    }
    if (a.rule.kind === "percent") {
      if (!Number.isInteger(a.rule.basisPoints) || a.rule.basisPoints <= 0 || a.rule.basisPoints >= 10000) {
        errs.push("A percentage must be more than 0% and less than 100%.");
      }
      bp += a.rule.basisPoints;
    }
  }
  if (bp >= 10000) errs.push("Percentages add up to 100% or more, leaving nothing for the remainder account.");
  return errs;
}

/**
 * Allocate one net payment across the accounts.
 *
 * Order: non-remainder accounts by priority (fixed and percent alike), each
 * capped at what is left; then the remainder account takes everything else.
 * Percentages are of the WHOLE net, floored to the cent, so a fraction of a
 * cent always falls to the remainder. The result always sums to net exactly.
 * Zero-cent allocations are returned (so the stub can show them) but flagged
 * `send: false` - a $0 live credit is never put in a file.
 */
export function allocateSplit(
  netCents: number,
  accounts: readonly SplitAccount[],
): { ok: true; lines: { accountKey: string; cents: number; send: boolean }[] } | { ok: false; errors: readonly string[] } {
  const errors = validateSplits(accounts);
  if (errors.length) return { ok: false, errors };
  if (!Number.isInteger(netCents) || netCents < 0) return { ok: false, errors: ["Net pay must be a whole number of cents, not negative."] };
  let left = netCents;
  const lines: { accountKey: string; cents: number; send: boolean }[] = [];
  const ordered = [...accounts].sort((a, b) => a.priority - b.priority);
  for (const a of ordered) {
    if (a.rule.kind === "remainder") continue;
    const want = a.rule.kind === "fixed" ? a.rule.cents : Math.floor((netCents * a.rule.basisPoints) / 10000);
    const take = Math.min(want, left);
    left -= take;
    lines.push({ accountKey: a.accountKey, cents: take, send: take > 0 });
  }
  const r = ordered.find((a) => a.rule.kind === "remainder")!;
  lines.push({ accountKey: r.accountKey, cents: left, send: left > 0 });
  return { ok: true, lines };
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Lifecycle
// ───────────────────────────────────────────────────────────────────────────

export const AUTHORIZATION_STATES = [
  "draft", // entered, not yet signed
  "signed", // signed form on file, not yet verified
  "verifying", // prenote or test credit in flight
  "active", // may be paid
  "on_hold", // a change, return or NOC is waiting for release
  "revoked", // payee withdrew authorization; kept for retention
  "archived", // superseded or ended; never deleted (owner answer Q7)
] as const;
export type AuthorizationState = (typeof AUTHORIZATION_STATES)[number];

const TRANSITIONS: Readonly<Record<AuthorizationState, readonly AuthorizationState[]>> = {
  draft: ["signed", "archived"],
  signed: ["verifying", "active", "on_hold", "revoked", "archived"],
  verifying: ["active", "on_hold", "revoked", "archived"],
  active: ["on_hold", "revoked", "archived"],
  on_hold: ["verifying", "active", "revoked", "archived"],
  revoked: ["archived"],
  archived: [],
};

export function canTransition(from: AuthorizationState, to: AuthorizationState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Only `active` pays. Everything else is a refusal with a reason a person can act on. */
export function payable(state: AuthorizationState): { ok: true } | { ok: false; reason: string } {
  switch (state) {
    case "active":
      return { ok: true };
    case "draft":
      return { ok: false, reason: "The authorization has not been signed yet." };
    case "signed":
      return { ok: false, reason: "Signed, but the account has not been verified." };
    case "verifying":
      return { ok: false, reason: "Account verification (prenote or test credit) is still in progress." };
    case "on_hold":
      return { ok: false, reason: "On hold: a bank change, return or correction is waiting for release by Michael or Stephen." };
    case "revoked":
      return { ok: false, reason: "The payee revoked this authorization." };
    case "archived":
      return { ok: false, reason: "This authorization is archived and can no longer be used." };
  }
}

/**
 * ach-fraud-phase-2-change-controls. Any change to routing, account number or
 * account type puts the authorization ON HOLD. There is no "minor edit" path.
 */
export function stateAfterBankChange(current: AuthorizationState): AuthorizationState {
  if (current === "revoked" || current === "archived") {
    throw new Error(`Cannot change banking on a ${current} authorization; start a new one.`);
  }
  return current === "draft" ? "draft" : "on_hold";
}

// ───────────────────────────────────────────────────────────────────────────
// 7. Release (owner answer Q1: Michael and Stephen may do everything)
// ───────────────────────────────────────────────────────────────────────────

export const MIN_SOLO_REASON_CHARS = 20;
/** Who was spoken to, and when: "Spoke with Maria in AR, she read back ...4821". */
export const MIN_CALLBACK_NOTE_CHARS = 10;

/**
 * How the payee confirmed the details. "phone": a call to a number on file for
 * the look-back window (ach-sao-verify-by-phone). "in_person": the payee
 * confirmed face to face (UNC Finance, 2020: validate "verbally (in person or
 * by telephone) with a known contact"); no phone number is involved, so the
 * look-back does not apply, but the note is still required.
 */
export const CALLBACK_METHODS = ["phone", "in_person"] as const;
export type CallbackMethod = (typeof CALLBACK_METHODS)[number];

export type ReleaseInput = {
  actorUserId: string;
  actorCanManage: boolean; // holds settings.manage (owner or admin)
  /** null for legacy holds entered before the change log existed. */
  changeEnteredByUserId: string | null;
  callback: { done: boolean; method?: CallbackMethod; numberUnchangedForDays: number | null; note?: string };
  reason: string;
};

export type ReleaseVerdict =
  | { ok: true; mode: "dual"; notifyOther: false }
  | { ok: true; mode: "solo"; notifyOther: true }
  | { ok: false; refusal: string };

/**
 * Releasing a hold. A second person is preferred (dual control); the same
 * person who entered the change MAY release it alone, because the owner said
 * either of them can do any action, but only with a written reason and a
 * notice to the other (Stephen <-> Michael). In BOTH modes the callback must
 * have been made to a number that has been on file for the look-back window
 * (ach-sao-verify-by-phone, ach-callback-manipulation).
 */
export function releaseVerdict(input: ReleaseInput, lookBackDays: number = CONTACT_LOOKBACK_DAYS): ReleaseVerdict {
  if (!input.actorCanManage) return { ok: false, refusal: "Only Michael or Stephen (settings.manage) can release a banking hold." };
  if (!input.callback.done) return { ok: false, refusal: "Call the payee first, at a number already on file, and record the call." };
  if ((input.callback.note ?? "").trim().length < MIN_CALLBACK_NOTE_CHARS) {
    return {
      ok: false,
      refusal: `Write who confirmed the details and how (at least ${MIN_CALLBACK_NOTE_CHARS} characters), e.g. "Maria in AR read back the last 4".`,
    };
  }
  const method: CallbackMethod = input.callback.method ?? "phone";
  if (
    method === "phone" &&
    (input.callback.numberUnchangedForDays === null || input.callback.numberUnchangedForDays < lookBackDays)
  ) {
    return {
      ok: false,
      refusal: `The number you called changed within the last ${lookBackDays} days. Verify in person or by a number on file longer than that.`,
    };
  }
  // Unknown author (a hold from before the change log) is treated as the
  // strict case: a reason and a notice, never a silent dual release.
  if (input.changeEnteredByUserId !== null && input.actorUserId !== input.changeEnteredByUserId) {
    return { ok: true, mode: "dual", notifyOther: false };
  }
  if (input.reason.trim().length < MIN_SOLO_REASON_CHARS) {
    return { ok: false, refusal: `Releasing your own change needs a written reason (at least ${MIN_SOLO_REASON_CHARS} characters).` };
  }
  return { ok: true, mode: "solo", notifyOther: true };
}

// ───────────────────────────────────────────────────────────────────────────
// 8. Contact-change look-back (owner Q13)
// ───────────────────────────────────────────────────────────────────────────

/**
 * IOFM states there is no industry-standard window; this is POLICY, padded
 * well beyond a typical 30-60 day pay cycle so that a fraudster who changes a
 * phone number first and the bank details a month later is still caught.
 */
export const CONTACT_LOOKBACK_DAYS = 90;

export type ContactRecord = { kind: "phone" | "email"; value: string; onFileSince: string };

/** Contacts usable for a callback on `today`: on file at least the look-back window. */
export function callbackEligibleContacts(
  contacts: readonly ContactRecord[],
  today: string,
  lookBackDays: number = CONTACT_LOOKBACK_DAYS,
): readonly ContactRecord[] {
  const cutoff = addCalendarDays(today, -lookBackDays);
  return contacts.filter((c) => c.onFileSince <= cutoff);
}

export function daysBetween(fromIso: string, toIsoDate: string): number {
  return Math.round((parseIso(toIsoDate).getTime() - parseIso(fromIso).getTime()) / 86_400_000);
}

// ───────────────────────────────────────────────────────────────────────────
// 9. Retention (owner Q8)
// ───────────────────────────────────────────────────────────────────────────

export const NACHA_RETENTION_YEARS = 2; // ach-authorization-two-years-*: after termination
export const WAC_RETENTION_YEARS = 5; // ach-wac-087-five-years: employee/payroll records
export const POLICY_RETENTION_YEARS = 6; // Greenway policy: padding over both

export type RetentionVerdict =
  | { kind: "keep_indefinitely"; reason: string }
  | { kind: "keep_until"; until: string; drivers: readonly string[] }
  | { kind: "may_dispose"; since: string };

/**
 * How long a signed authorization (and its evidence) must be kept. While the
 * authorization is live, or under legal hold, it is kept indefinitely. After
 * it ends, the latest of: Nacha 2y after end, WAC 5y after end, policy 6y
 * after end, and policy 6y after signing. Disposal is never automatic; this
 * only says when it would first be ALLOWED.
 */
export function retentionVerdict(input: {
  signedOn: string;
  endedOn: string | null;
  legalHold: boolean;
  today: string;
}): RetentionVerdict {
  if (input.legalHold) return { kind: "keep_indefinitely", reason: "A legal hold is in place." };
  if (!input.endedOn) return { kind: "keep_indefinitely", reason: "The authorization is still in effect." };
  const candidates: [string, string][] = [
    [addYears(input.endedOn, NACHA_RETENTION_YEARS), "Nacha: 2 years after the authorization ends"],
    [addYears(input.endedOn, WAC_RETENTION_YEARS), "WAC 314-55-087: 5 years"],
    [addYears(input.endedOn, POLICY_RETENTION_YEARS), "Greenway policy: 6 years after it ends"],
    [addYears(input.signedOn, POLICY_RETENTION_YEARS), "Greenway policy: 6 years after signing"],
  ];
  const until = maxIso(candidates.map((c) => c[0]));
  if (input.today > until) return { kind: "may_dispose", since: until };
  return { kind: "keep_until", until, drivers: candidates.filter((c) => c[0] === until).map((c) => c[1]) };
}

// ───────────────────────────────────────────────────────────────────────────
// 10. Return and NOC codes
// ───────────────────────────────────────────────────────────────────────────

export type AchCodeAction = "hold_get_new_info" | "hold_investigate_fraud" | "hold_unexpected_for_credit" | "apply_correction_then_release";

/**
 * Labels copied from docs/authorities/ach/odfi-peoples-bank-2026-originators-
 * newsletter.txt (a test re-finds each "CODE label" pair in that file). Only
 * codes that file lists are catalogued; anything else is `unknownCodeAction`.
 */
export const ACH_CODES: Readonly<Record<string, { label: string; action: AchCodeAction; plain: string }>> = {
  R01: { label: "Insufficient funds", action: "hold_unexpected_for_credit", plain: "A debit code. Greenway only sends credits, so this should never happen - hold and call Timberland." },
  R02: { label: "Account closed", action: "hold_get_new_info", plain: "The payee closed this account. Get a new signed form with new details." },
  R03: { label: "No account or unable to locate account", action: "hold_get_new_info", plain: "The account number does not exist at that bank. Get correct details." },
  R04: { label: "Invalid account number", action: "hold_get_new_info", plain: "The account number is malformed. Get correct details." },
  R05: { label: "Unauthorized debit to a consumer account using a corporate SEC code", action: "hold_unexpected_for_credit", plain: "A debit code. Hold and call Timberland." },
  R06: { label: "Returned per ODFI’s request", action: "hold_investigate_fraud", plain: "Timberland itself asked for this back. Call them before anything else." },
  R07: { label: "Authorization revoked by a consumer accountholder", action: "hold_investigate_fraud", plain: "The payee says they revoked authorization. Treat as a fraud red flag until confirmed." },
  R08: { label: "Payment stopped or stop payment on item", action: "hold_unexpected_for_credit", plain: "Unusual for a credit. Hold and ask the payee." },
  R09: { label: "Uncollected funds", action: "hold_unexpected_for_credit", plain: "A debit code. Hold and call Timberland." },
  R10: { label: "Customer/accountholder advises not authorized", action: "hold_investigate_fraud", plain: "Someone at the receiving bank says this was not authorized. Fraud red flag." },
  R11: { label: "Customer/accountholder advises entry not in accordance with the terms of the authorization", action: "hold_investigate_fraud", plain: "Fraud red flag. Investigate before re-sending." },
  R16: { label: "Account frozen", action: "hold_get_new_info", plain: "The account is frozen. Pay another way and get new details." },
  R23: { label: "Credit entry refused by receiver", action: "hold_get_new_info", plain: "The payee refused the deposit. Talk to them." },
  R29: { label: "Corporate customer/accountholder advises not authorized", action: "hold_investigate_fraud", plain: "A business says this was not authorized. Fraud red flag." },
  C01: { label: "Incorrect bank account number", action: "apply_correction_then_release", plain: "The bank sent the correct account number. Apply it (puts the account on hold) and release after a callback." },
  C02: { label: "Incorrect routing/transit number", action: "apply_correction_then_release", plain: "The bank sent the correct routing number. Apply and release after a callback." },
  C03: { label: "Incorrect routing/transit number and bank account number", action: "apply_correction_then_release", plain: "Both numbers were wrong. Apply and release after a callback." },
  C05: { label: "Incorrect transaction code", action: "apply_correction_then_release", plain: "Checking vs. savings was wrong. Apply and release." },
  C06: { label: "Incorrect bank account number and transaction code", action: "apply_correction_then_release", plain: "Account number and type were wrong. Apply and release after a callback." },
  C07: { label: "Incorrect routing/transit number, bank account number and transaction code", action: "apply_correction_then_release", plain: "All three were wrong. Apply and release after a callback." },
};

export const UNKNOWN_CODE_PLAIN =
  "This code is not in the list this system knows. The account is on hold. Call Timberland and ask what it means before doing anything.";

export function classifyAchCode(code: string): { known: boolean; isNoc: boolean; action: AchCodeAction; plain: string } {
  const c = code.trim().toUpperCase();
  const hit = ACH_CODES[c];
  if (hit) return { known: true, isNoc: c.startsWith("C"), action: hit.action, plain: hit.plain };
  return { known: false, isNoc: c.startsWith("C"), action: "hold_investigate_fraud", plain: UNKNOWN_CODE_PLAIN };
}

// ───────────────────────────────────────────────────────────────────────────
// 11. Account key and who gets told (owner Q9)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalised routing+account key, used to detect the same account appearing
 * twice (split duplicates, two employees with one account). The store HMACs
 * it before storing; this core never sees a raw key on disk.
 */
export function normalizeAccountKey(routing: string, account: string, type: AccountType): string {
  const r = routing.replace(/\D/g, "");
  const a = account.replace(/[\s-]/g, "").toUpperCase().replace(/^0+(?=.)/, "");
  return `${r}:${a}:${type}`;
}

export type NotifyContact = { name: string; phone: string | null; email: string };

/**
 * Owner answer Q9: Stephen and Michael, by phone and email, or the store.
 *
 * PERSONAL PHONE NUMBERS ARE NOT IN THIS FILE, DELIBERATELY. This repository
 * is public on GitHub. The two work emails and the store line are already
 * published (site footer, setup-status.ts, filed returns); Stephen's and
 * Michael's cell numbers are not, and committing them would publish them.
 * They are supplied at runtime from the environment (ACH_NOTIFY_STEPHEN_PHONE,
 * ACH_NOTIFY_MICHAEL_PHONE). The values were given by the owner in an earlier
 * round's answer D17 and are printed on the paper ACH forms, which live
 * outside the repo.
 */
export const ACH_NOTIFY_PUBLIC: Readonly<Record<"stephen" | "michael" | "store", NotifyContact>> = {
  stephen: { name: "Stephen", phone: null, email: "stephen@greenwaymarijuana.com" },
  michael: { name: "Michael", phone: null, email: "michael@greenwaymarijuana.com" },
  store: { name: "Greenway store", phone: "360-443-6988", email: "contact@greenwaymarijuana.com" },
};

const US_PHONE = /^\d{3}-\d{3}-\d{4}$/;

/**
 * Resolve the full contact list from configuration. A missing or malformed
 * personal phone is reported, not silently dropped (rule 48): the caller gets
 * the email-only contact AND a list of problems to surface on the settings
 * screen, so a notice still goes out by email while the gap is visible.
 */
export function resolveNotifyContacts(env: Readonly<Record<string, string | undefined>>): {
  contacts: Readonly<Record<"stephen" | "michael" | "store", NotifyContact>>;
  problems: readonly string[];
} {
  const problems: string[] = [];
  const phone = (key: string): string | null => {
    const v = (env[key] ?? "").trim();
    if (!v) {
      problems.push(`${key} is not set; notices will go by email only.`);
      return null;
    }
    if (!US_PHONE.test(v)) {
      problems.push(`${key} must look like 360-555-0100.`);
      return null;
    }
    return v;
  };
  return {
    contacts: {
      stephen: { ...ACH_NOTIFY_PUBLIC.stephen, phone: phone("ACH_NOTIFY_STEPHEN_PHONE") },
      michael: { ...ACH_NOTIFY_PUBLIC.michael, phone: phone("ACH_NOTIFY_MICHAEL_PHONE") },
      store: ACH_NOTIFY_PUBLIC.store,
    },
    problems,
  };
}

/** Who hears about a solo release: the OTHER owner/admin, plus the store line. */
export function soloReleaseRecipients(
  releasedBy: "stephen" | "michael",
  contacts: Readonly<Record<"stephen" | "michael" | "store", NotifyContact>> = ACH_NOTIFY_PUBLIC,
): readonly NotifyContact[] {
  return [releasedBy === "stephen" ? contacts.michael : contacts.stephen, contacts.store];
}

// ───────────────────────────────────────────────────────────────────────────
// Self-tests
// ───────────────────────────────────────────────────────────────────────────

export function __runAchAuthorizationCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ach-authorization-core:", msg);
    }
  };
  const throws = (fn: () => unknown, msg: string) => {
    try {
      fn();
      ok(false, `${msg} (did not throw)`);
    } catch {
      ok(true, msg);
    }
  };

  // dates
  ok(addYears("2028-02-29", 1) === "2029-02-28", "Feb 29 + 1y clamps");
  ok(addYears("2026-07-31", 2) === "2028-07-31", "addYears plain");
  throws(() => parseIso("2026-02-30"), "impossible date rejected");
  ok(daysBetween("2026-01-01", "2026-04-01") === 90, "daysBetween");

  // FedACH
  ok(fedAchClosures(2026).length === 10, "2026: 11 holidays, Jul 4 is Saturday -> 10 closures");
  ok(!fedAchClosures(2026).includes("2026-07-03"), "Saturday holiday: preceding Friday OPEN");
  ok(fedAchClosures(2027).includes("2027-07-05"), "2027 Jul 4 Sunday -> Monday closed");
  ok(fedAchClosures(2029).includes("2029-11-12"), "2029 Nov 11 Sunday -> Monday closed");
  ok(isFedAchBankingDay("2026-04-16"), "DC Emancipation Day is NOT a FedACH holiday");
  ok(!isFedAchBankingDay("2026-10-12"), "Columbus Day closed");
  ok(!isFedAchBankingDay("2026-11-11"), "Veterans Day closed");
  ok(!isFedAchBankingDay("2026-06-20"), "Saturday never a banking day");
  throws(() => isFedAchBankingDay("2031-03-03"), "unmirrored year fails loudly");
  ok(addBankingDays("2026-06-18", 1) === "2026-06-22", "Thu Jun 18 +1 skips Juneteenth + weekend");
  ok(nextBankingDayOnOrAfter("2026-11-26") === "2026-11-27", "Thanksgiving -> Friday");

  // timing
  ok(prenoteLiveEligibleDate("2026-11-24") === "2026-11-30", "prenote Tue Nov 24 +3 skips Thanksgiving/weekend");
  ok(prenoteOutcome({ settlementDate: "2026-11-24", today: "2026-11-27" }).kind === "wait", "prenote waits");
  ok(prenoteOutcome({ settlementDate: "2026-11-24", today: "2026-11-30" }).kind === "eligible", "prenote eligible on day 3");
  ok(prenoteOutcome({ settlementDate: "2026-11-24", today: "2027-01-01", returnCode: "R03" }).kind === "blocked_return", "return blocks forever");
  ok(prenoteOutcome({ settlementDate: "2026-11-24", today: "2027-01-01", nocCode: "C01" }).kind === "blocked_noc", "NOC blocks");
  ok(returnWindowCloses("2026-12-24") === "2026-12-29", "returns: Dec 24 +2 skips Christmas");
  ok(nocApplyBy("2026-03-02", null) === "2026-03-10", "NOC +6 banking days");
  ok(nocApplyBy("2026-03-02", "2026-03-06") === "2026-03-06", "NOC: earlier next entry wins");
  ok(reversalDeadline("2026-01-15") === "2026-01-23", "reversal +5 skips MLK");

  // codes
  ok(transactionCodeFor("checking", false) === "22" && transactionCodeFor("savings", false) === "32", "live codes");
  ok(transactionCodeFor("checking", true) === "23" && transactionCodeFor("savings", true) === "33", "prenote codes");
  ok(!isAllowedTransactionCode("27") && !isAllowedTransactionCode("37") && !isAllowedTransactionCode("28"), "no debit codes");
  ok(validateMicroEntryCents(99).ok && !validateMicroEntryCents(100).ok && !validateMicroEntryCents(0).ok, "micro bounds");
  ok(!validateMicroEntryCents(12.5).ok, "micro whole cents");
  ok(microEntryFileConflicts([{ accountKey: "a", kind: "micro_entry" }, { accountKey: "a", kind: "live" }, { accountKey: "b", kind: "live" }]).join() === "a", "micro + live same account conflicts");
  ok(microEntryConfirmed([7, 31], [31, 7]) && !microEntryConfirmed([7, 31], [7, 13]) && !microEntryConfirmed([], []), "micro confirm");

  // splits
  const s3: SplitAccount[] = [
    { accountKey: "sav", priority: 1, rule: { kind: "fixed", cents: 10000 } },
    { accountKey: "hsa", priority: 2, rule: { kind: "percent", basisPoints: 1000 } },
    { accountKey: "chk", priority: 3, rule: { kind: "remainder" } },
  ];
  const al = allocateSplit(123457, s3);
  ok(al.ok && al.lines.map((l) => l.cents).join() === "10000,12345,101112", "split fixed/percent/remainder");
  ok(al.ok && al.lines.reduce((t, l) => t + l.cents, 0) === 123457, "split sums to net");
  const short = allocateSplit(5000, s3);
  ok(short.ok && short.lines.map((l) => l.cents).join() === "5000,0,0", "short net: fixed capped, rest zero");
  ok(short.ok && short.lines.filter((l) => l.send).length === 1, "zero lines not sent");
  ok(validateSplits([...s3, { accountKey: "x", priority: 4, rule: { kind: "fixed", cents: 1 } }]).length > 0, "4 accounts rejected");
  ok(validateSplits([{ accountKey: "a", priority: 1, rule: { kind: "fixed", cents: 1 } }]).length > 0, "no remainder rejected");
  ok(validateSplits([{ accountKey: "a", priority: 1, rule: { kind: "remainder" } }, { accountKey: "b", priority: 2, rule: { kind: "remainder" } }]).length > 0, "two remainders rejected");
  ok(validateSplits([{ accountKey: "a", priority: 1, rule: { kind: "percent", basisPoints: 10000 } }, { accountKey: "b", priority: 2, rule: { kind: "remainder" } }]).length > 0, "100% rejected");
  ok(validateSplits([{ accountKey: "a", priority: 1, rule: { kind: "remainder" } }]).length === 0, "single remainder ok");

  // lifecycle and release
  ok(payable("active").ok && !payable("on_hold").ok && !payable("verifying").ok, "only active pays");
  ok(!canTransition("archived", "active") && !canTransition("revoked", "active"), "no resurrection");
  ok(stateAfterBankChange("active") === "on_hold", "change -> hold");
  throws(() => stateAfterBankChange("archived"), "cannot edit archived");
  const base: ReleaseInput = { actorUserId: "m", actorCanManage: true, changeEnteredByUserId: "s", callback: { done: true, numberUnchangedForDays: 400, note: "Maria in AR read back 4821" }, reason: "" };
  ok(!releaseVerdict({ ...base, callback: { ...base.callback, note: "ok" } }).ok, "callback without a real note refused");
  ok(releaseVerdict({ ...base, callback: { done: true, method: "in_person", numberUnchangedForDays: null, note: "Vendor rep at the store, ID seen" } }).ok, "in-person needs no phone look-back");
  ok(!releaseVerdict({ ...base, callback: { done: true, method: "phone", numberUnchangedForDays: null, note: "Called the number in the email" } }).ok, "phone with unknown number age refused");
  const unknownAuthor = releaseVerdict({ ...base, changeEnteredByUserId: null });
  ok(!unknownAuthor.ok, "unknown author without reason refused (treated as solo)");
  const unknownWithReason = releaseVerdict({ ...base, changeEnteredByUserId: null, reason: "Legacy hold from before the change log" });
  ok(unknownWithReason.ok && unknownWithReason.mode === "solo", "unknown author with reason = solo + notify");
  ok(releaseVerdict(base).ok && (releaseVerdict(base) as { mode: string }).mode === "dual", "other person releases");
  ok(!releaseVerdict({ ...base, changeEnteredByUserId: "m" }).ok, "solo without reason refused");
  const solo = releaseVerdict({ ...base, changeEnteredByUserId: "m", reason: "Stephen is on vacation until the 20th" });
  ok(solo.ok && solo.mode === "solo" && solo.notifyOther, "solo with reason ok + notify");
  ok(!releaseVerdict({ ...base, callback: { done: true, numberUnchangedForDays: 30 } }).ok, "recently changed number refused");
  ok(!releaseVerdict({ ...base, callback: { done: false, numberUnchangedForDays: 400 } }).ok, "no callback refused");
  ok(!releaseVerdict({ ...base, actorCanManage: false }).ok, "manager cannot release");

  // look-back
  const contacts: ContactRecord[] = [
    { kind: "phone", value: "old", onFileSince: "2025-01-01" },
    { kind: "phone", value: "new", onFileSince: "2026-05-01" },
  ];
  ok(callbackEligibleContacts(contacts, "2026-06-01").map((c) => c.value).join() === "old", "look-back excludes new number");
  ok(callbackEligibleContacts([{ kind: "email", value: "e", onFileSince: "2026-03-03" }], "2026-06-01").length === 1, "exactly 90 days is eligible");

  // retention
  ok(retentionVerdict({ signedOn: "2020-01-01", endedOn: null, legalHold: false, today: "2040-01-01" }).kind === "keep_indefinitely", "active kept");
  ok(retentionVerdict({ signedOn: "2020-01-01", endedOn: "2021-01-01", legalHold: true, today: "2040-01-01" }).kind === "keep_indefinitely", "legal hold kept");
  const rv = retentionVerdict({ signedOn: "2026-01-01", endedOn: "2026-06-30", legalHold: false, today: "2027-01-01" });
  ok(rv.kind === "keep_until" && rv.until === "2032-06-30", "retention = ended + 6y");
  const rv2 = retentionVerdict({ signedOn: "2026-01-01", endedOn: "2026-06-30", legalHold: false, today: "2032-07-01" });
  ok(rv2.kind === "may_dispose", "after retention may dispose");

  // codes
  ok(classifyAchCode("r03").action === "hold_get_new_info", "R03 new info");
  ok(classifyAchCode("C01").isNoc && classifyAchCode("C01").action === "apply_correction_then_release", "C01 NOC");
  ok(!classifyAchCode("R99").known && classifyAchCode("R99").action === "hold_investigate_fraud", "unknown -> hold");
  ok(Object.keys(ACH_CODES).length === 20, "20 catalogued codes");

  // account key + contacts
  ok(normalizeAccountKey("125-000-105", "00012 345-6", "checking") === "125000105:123456:checking", "account key normalised");
  ok(normalizeAccountKey("125000105", "0", "savings") === "125000105:0:savings", "all-zero account keeps one zero");
  ok(soloReleaseRecipients("michael")[0].name === "Stephen" && soloReleaseRecipients("stephen")[0].name === "Michael", "other person notified");
  const rc = resolveNotifyContacts({ ACH_NOTIFY_STEPHEN_PHONE: "360-555-0100" });
  ok(rc.contacts.stephen.phone === "360-555-0100" && rc.contacts.michael.phone === null, "phone from env; missing -> null");
  ok(rc.problems.length === 1 && rc.problems[0].includes("ACH_NOTIFY_MICHAEL_PHONE"), "missing phone reported");
  ok(resolveNotifyContacts({ ACH_NOTIFY_STEPHEN_PHONE: "3605550100", ACH_NOTIFY_MICHAEL_PHONE: "360-555-0101" }).problems.length === 1, "malformed phone reported");

  return { passed, failed };
}
