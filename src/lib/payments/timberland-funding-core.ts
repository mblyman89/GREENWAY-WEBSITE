/**
 * src/lib/payments/timberland-funding-core.ts   (R41 S9, plan point 4)
 *
 * The funding helper. Pure: no database, no clock of its own.
 *
 * What the contract says (verbatim, docs/authorities/ach/
 * timberland-ach-agreement-2026-10-14.redacted.txt):
 *   section 14: "Company shall provide Financial Institution with immediately
 *     available funds not later than 9:00 a.m. PST on each Settlement Date"
 *   section 14: "Financial Institution reserves the right to require that
 *     sufficient collected funds be in Company's Accounts prior to the time
 *     any Entry is processed"
 *   section 16: "Company will maintain in the Account immediately available
 *     funds sufficient to cover all credit Entries originated"
 *   Schedule B: "ACH Service Fee $ 50.00 per month" and
 *     "Return/NOC $ 5.00 per item"
 *
 * Q6 (ANSWERED, R41 S12, owner decision D-5). Brenda, Email 3 answer 5:
 * "Collected funds should be on the effective/settlement date, and we only do
 * pre-funding for customers that overdrawn their account." So the headline
 * asks for the money by 9:00 am Pacific on the settlement date (section 14),
 * not at upload time, and adds a plain warning never to let the account go
 * negative (overdrawing is what turns pre-funding on).
 *
 * The app cannot see the balance. There is no bank feed and none is assumed.
 * So the helper only SHOWS the amount and the deadline, and the owner records
 * what he saw (migration 0276, once per file, at least the file total). It
 * never blocks an upload, and it never blocks paying by check.
 *
 * Money is integer cents. Days are Pacific "YYYY-MM-DD".
 */
import { FEES, FUNDING_DEADLINE, centsToUsdText } from "@/lib/payments/timberland-profile-core";
import { settlementOf } from "@/lib/payments/timberland-limits-core";
import { shortDate } from "@/lib/payments/timberland-deadline-core";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

/** The largest amount the form accepts ($99,999,999.99): anything bigger is a typo. */
export const MAX_FUNDING_CENTS = 9_999_999_999;

/** The largest buffer the owner may add on top ($1,000,000.00). */
export const MAX_BUFFER_CENTS = 100_000_000;

/** "$50,000.00". Whole non-negative cents only. */
export function usd(cents: number): string {
  return `$${centsToUsdText(cents)}`;
}

/** "9:00 am". */
function clockText(h: number, m: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * A typed dollar amount to cents. Accepts "1234", "1234.5", "1,234.56",
 * "$1,234.56". Refuses blanks, negatives, more than two decimals, commas in
 * the wrong place, letters, and anything over MAX_FUNDING_CENTS. Uses string
 * arithmetic, never floating point.
 */
export function parseDollarsToCents(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/^\$\s*/, "");
  if (!s) return null;
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!.replace(/,/g, "");
  if (whole.length > 11) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents > MAX_FUNDING_CENTS) return null;
  return cents;
}

export type FundingLine = { key: "file" | "fee" | "buffer"; label: string; cents: number };

export type FundingPlan = {
  lines: FundingLine[];
  /** File total + monthly fee + buffer. */
  suggestedCents: number;
  /** The least the owner may confirm (the file total; 0276 refuses less). */
  minimumCents: number;
  settlementDay: string;
  deadlineUtc: Date;
  /** "9:00 am Pacific on Wed Oct 21". */
  deadlineText: string;
  /** The sentence shown above the form. */
  headline: string;
  /** Information line on return and NOC fees. */
  returnFeeNote: string;
};

/**
 * What the owner should see before upload. The $50 monthly fee is shown as
 * its own line because Schedule B lets Timberland debit it from the same
 * account; the buffer is the owner's own choice (default 0) and is labelled
 * as such. Nothing here is a balance the app read.
 */
export function fundingPlan(f: { totalCents: number; effectiveDate: string; settlementDate: string | null }, bufferCents = 0): FundingPlan {
  if (!Number.isSafeInteger(f.totalCents) || f.totalCents < 0) throw new Error(`fundingPlan: bad total ${f.totalCents}`);
  if (!Number.isSafeInteger(bufferCents) || bufferCents < 0 || bufferCents > MAX_BUFFER_CENTS) throw new Error(`fundingPlan: bad buffer ${bufferCents}`);
  const settlementDay = settlementOf({ effectiveDate: f.effectiveDate, settlementDate: f.settlementDate });
  const deadlineUtc = new Date(pacificWallTimeToUtcISO(settlementDay, { h: FUNDING_DEADLINE.hour, m: FUNDING_DEADLINE.minute, s: 0, ms: 0 }));
  const deadlineText = `${clockText(FUNDING_DEADLINE.hour, FUNDING_DEADLINE.minute)} Pacific on ${shortDate(settlementDay)}`;
  const lines: FundingLine[] = [
    { key: "file", label: "This file (every payment in it)", cents: f.totalCents },
    { key: "fee", label: "Timberland's ACH Service Fee (Schedule B, $50.00 per month, from the same account)", cents: FEES.serviceMonthly },
  ];
  if (bufferCents > 0) lines.push({ key: "buffer", label: "Your own extra cushion (your choice, not a bank rule)", cents: bufferCents });
  const suggestedCents = lines.reduce((s, l) => s + l.cents, 0);
  return {
    lines,
    suggestedCents,
    minimumCents: f.totalCents,
    settlementDay,
    deadlineUtc,
    deadlineText,
    headline: `Make sure at least ${usd(suggestedCents)} is collected in account ending 6048 by ${deadlineText}. Never let the account go negative: Timberland only asks for pre-funding from customers who overdraw.`,
    returnFeeNote: `Each return or notification of change costs ${usd(FEES.perReturnOrNoc)} (Schedule B), debited later.`,
  };
}

export type FundingForm = { ok: true; amountCents: number } | { ok: false; error: string };

/** The confirm form: the box ticked, an amount typed, at least the file total. */
export function checkFundingForm(i: { totalCents: number; amount: string | null | undefined; confirm: string | null | undefined }): FundingForm {
  if (i.confirm !== "yes") return { ok: false, error: "Tick the box to confirm you looked at the account balance yourself." };
  const cents = parseDollarsToCents(i.amount);
  if (cents === null) return { ok: false, error: "Type the balance you saw, for example 12,345.67." };
  if (cents < i.totalCents) {
    return { ok: false, error: `The balance you saw (${usd(cents)}) is less than this file (${usd(i.totalCents)}). Move money in first, or do not upload; pay by check if needed.` };
  }
  return { ok: true, amountCents: cents };
}

export type FundingFileState = {
  id: string;
  filename: string;
  kind: string;
  status: string;
  totalCents: number;
  effectiveDate: string;
  settlementDate: string | null;
  fundingConfirmedAt: string | null;
  fundingConfirmedAmountCents: number | null;
};

export type FundingBadge =
  | { tone: "ok"; text: string }
  | { tone: "warn"; text: string }
  | { tone: "danger"; text: string }
  | { tone: "none"; text: "" };

/**
 * The line under each file on Operations. Voided files show nothing. A
 * confirmed file shows the amount. An unconfirmed released or uploaded file
 * shows amber, red on its settlement day. A bank-approved file that was never
 * confirmed (it can no longer be, 0276) still gets the 9:00 am reminder.
 */
export function fundingBadge(f: FundingFileState, nowUtc: Date): FundingBadge {
  if (f.status === "voided") return { tone: "none", text: "" };
  if (f.fundingConfirmedAt && f.fundingConfirmedAmountCents !== null) {
    return { tone: "ok", text: `Funding checked: ${usd(f.fundingConfirmedAmountCents)} seen in the account.` };
  }
  const plan = fundingPlan(f);
  const today = pacificDayKey(nowUtc);
  if (today > plan.settlementDay) return { tone: "none", text: "" };
  const urgent = today === plan.settlementDay;
  if (f.status === "bank_approved") {
    return urgent
      ? { tone: "danger", text: `Funding was not recorded. ${usd(f.totalCents)} must be in the account by ${plan.deadlineText}.` }
      : { tone: "warn", text: `Funding was not recorded. Keep ${usd(f.totalCents)} in the account through ${plan.deadlineText}.` };
  }
  return urgent
    ? { tone: "danger", text: `Funding not checked. ${usd(f.totalCents)} must be in the account by ${plan.deadlineText}.` }
    : { tone: "warn", text: `Funding not checked yet. The money must be in the account by ${plan.deadlineText}.` };
}

// ------------------------------------------------------------ reminders ---

/** The settlement-morning reminder fires from 8:00 am Pacific (plan S9 point 4). */
export const FUNDING_REMINDER = { hour: 8, minute: 0 } as const;

export type FundingReminder = { dedupeKey: string; stage: "funding_morning"; subject: string; body: string; urgency: "critical" };

/**
 * A cron tick is a request to consider, never a command (AGENTS.md rule 12).
 * Plans one reminder per non-voided file whose settlement day is today in
 * Pacific time, only from 8:00 am up to (not including) the 9:00 am deadline.
 * Files that already had their funding confirmed still get it (the money must
 * STILL be there at 9:00 am, section 14), worded as a check rather than an
 * alarm. Dedupe is per file.
 */
export function planFundingReminders(nowUtc: Date, files: readonly FundingFileState[]): FundingReminder[] {
  const today = pacificDayKey(nowUtc);
  const from = new Date(pacificWallTimeToUtcISO(today, { h: FUNDING_REMINDER.hour, m: FUNDING_REMINDER.minute, s: 0, ms: 0 }));
  const out: FundingReminder[] = [];
  for (const f of files) {
    if (f.status !== "released" && f.status !== "uploaded" && f.status !== "bank_approved") continue;
    const plan = fundingPlan(f);
    if (plan.settlementDay !== today || nowUtc < from || nowUtc >= plan.deadlineUtc) continue;
    const confirmed = f.fundingConfirmedAt !== null && f.fundingConfirmedAmountCents !== null;
    out.push({
      dedupeKey: `ach-funding:${f.id}:settle`,
      stage: "funding_morning",
      subject: `By 9:00 am today: ${usd(f.totalCents)} for ${f.filename} must be in the account`,
      body:
        `${f.filename} (${f.kind}) settles today. Timberland's agreement (section 14) needs the money in account ending 6048 by ${plan.deadlineText}. ` +
        (confirmed
          ? `You recorded seeing ${usd(f.fundingConfirmedAmountCents!)} earlier. Check it is still there.`
          : `No balance check was recorded for this file. Look at the account now.`) +
        ` If it is short, move money in now and call Timberland at 1-800-562-8761.`,
      urgency: "critical",
    });
  }
  return out;
}

/** The note sent when the ledger cannot be read on a reminder tick (never silence). */
export function fundingReadFailedReminder(nowUtc: Date, error: string): { dedupeKey: string; stage: "funding_read_failed"; subject: string; body: string } {
  const today = pacificDayKey(nowUtc);
  return {
    dedupeKey: `ach-funding:read-failed:${today}`,
    stage: "funding_read_failed",
    subject: "The 8 am funding check could not read the ACH files",
    body: `The app could not read the ACH file list (${error.slice(0, 300)}). If a file settles today, its money must be in account ending 6048 by 9:00 am Pacific. Check Operations and the account yourself.`,
  };
}

// ------------------------------------------------------------ self-tests ---

export function __runTimberlandFundingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`timberland-funding-core FAIL: ${n}`);
    }
  };
  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // parseDollarsToCents
  ok(parseDollarsToCents("1234") === 123400, "whole dollars");
  ok(parseDollarsToCents("1234.5") === 123450, "one decimal is tens of cents");
  ok(parseDollarsToCents("1,234.56") === 123456, "thousands comma");
  ok(parseDollarsToCents("$1,234.56") === 123456, "dollar sign");
  ok(parseDollarsToCents(" $ 12,345,678.09 ") === 1234567809, "spaces and two commas");
  ok(parseDollarsToCents("0.07") === 7, "cents only");
  ok(parseDollarsToCents("") === null && parseDollarsToCents(null) === null && parseDollarsToCents(undefined) === null, "blank is null");
  ok(parseDollarsToCents("-5") === null, "negative refused");
  ok(parseDollarsToCents("1.234") === null, "three decimals refused");
  ok(parseDollarsToCents("1,23") === null && parseDollarsToCents("12,34.00") === null && parseDollarsToCents(",123") === null, "misplaced commas refused");
  ok(parseDollarsToCents("12a") === null && parseDollarsToCents("1e5") === null && parseDollarsToCents(".5") === null, "letters, exponents, bare decimals refused");
  ok(parseDollarsToCents("99999999.99") === MAX_FUNDING_CENTS, "the cap itself is allowed");
  ok(parseDollarsToCents("100000000.00") === null, "over the cap refused");
  ok(parseDollarsToCents("999999999999999") === null, "absurd length refused");
  ok(parseDollarsToCents("0.10") === 10 && parseDollarsToCents("0.1") === 10, "string arithmetic, no float drift");
  ok(parseDollarsToCents("1.005") === null, "no rounding of a third decimal");

  // usd
  ok(usd(5000) === "$50.00" && usd(123456) === "$1,234.56" && usd(0) === "$0.00", "usd formatting");
  ok(throws(() => usd(-1)) && throws(() => usd(1.5)), "usd refuses negative and fractional cents");

  // fundingPlan: Wed 2026-10-21 effective, settlement same day (a banking day)
  const p = fundingPlan({ totalCents: 1_234_567, effectiveDate: "2026-10-21", settlementDate: null });
  ok(p.settlementDay === "2026-10-21", "settlement is the effective date when it is a banking day");
  ok(p.deadlineUtc.toISOString() === "2026-10-21T16:00:00.000Z", "9:00 am PDT is 16:00 UTC");
  ok(p.deadlineText === "9:00 am Pacific on Wed Oct 21", "deadline text");
  ok(p.lines.length === 2 && p.lines[0]!.key === "file" && p.lines[1]!.key === "fee", "file and fee lines, no buffer by default");
  ok(p.lines[1]!.cents === 5000, "fee line is the Schedule B $50.00");
  ok(p.suggestedCents === 1_239_567, "suggested = file + $50");
  ok(p.minimumCents === 1_234_567, "minimum is the file total");
  ok(
    p.headline ===
      "Make sure at least $12,395.67 is collected in account ending 6048 by 9:00 am Pacific on Wed Oct 21. Never let the account go negative: Timberland only asks for pre-funding from customers who overdraw.",
    "headline words (Q6 answered, D-5: by 9:00 am on the settlement date; never overdraw)",
  );
  ok(!/before you upload/.test(p.headline), "the headline no longer asks for the money at upload time (Email 3 answer 5)");
  ok(/\$5\.00/.test(p.returnFeeNote) && /Schedule B/.test(p.returnFeeNote), "return/NOC fee note");
  const pb = fundingPlan({ totalCents: 100, effectiveDate: "2026-10-21", settlementDate: null }, 25_000);
  ok(pb.lines.length === 3 && pb.lines[2]!.key === "buffer" && /your choice/.test(pb.lines[2]!.label), "buffer is its own labelled line");
  ok(pb.suggestedCents === 100 + 5000 + 25_000, "buffer is added");
  // PST: Dec 1 2026 is a Tuesday
  const pw = fundingPlan({ totalCents: 1, effectiveDate: "2026-12-01", settlementDate: null });
  ok(pw.deadlineUtc.toISOString() === "2026-12-01T17:00:00.000Z", "9:00 am PST is 17:00 UTC");
  // A stored settlement date wins
  const ps = fundingPlan({ totalCents: 1, effectiveDate: "2026-10-21", settlementDate: "2026-10-22" });
  ok(ps.settlementDay === "2026-10-22", "stored settlement date wins");
  // A Saturday effective date settles the next banking day (Mon)
  const psat = fundingPlan({ totalCents: 1, effectiveDate: "2026-10-24", settlementDate: null });
  ok(psat.settlementDay === "2026-10-26", "weekend effective date settles Monday");
  ok(throws(() => fundingPlan({ totalCents: -1, effectiveDate: "2026-10-21", settlementDate: null })), "negative total refused");
  ok(throws(() => fundingPlan({ totalCents: 1, effectiveDate: "2026-10-21", settlementDate: null }, -1)), "negative buffer refused");
  ok(throws(() => fundingPlan({ totalCents: 1, effectiveDate: "2026-10-21", settlementDate: null }, MAX_BUFFER_CENTS + 1)), "huge buffer refused");

  // checkFundingForm
  ok(!checkFundingForm({ totalCents: 100, amount: "5", confirm: null }).ok, "unticked refused");
  const f1 = checkFundingForm({ totalCents: 100, amount: "abc", confirm: "yes" });
  ok(!f1.ok && /Type the balance/.test(f1.error), "bad amount refused in words");
  const f2 = checkFundingForm({ totalCents: 100_000, amount: "999.99", confirm: "yes" });
  ok(!f2.ok && /less than this file/.test(f2.error) && /pay by check/.test(f2.error), "short amount refused, check named");
  const f3 = checkFundingForm({ totalCents: 100_000, amount: "1,000.00", confirm: "yes" });
  ok(f3.ok && f3.amountCents === 100_000, "exact total accepted");
  const f4 = checkFundingForm({ totalCents: 100_000, amount: "$25,000", confirm: "yes" });
  ok(f4.ok && f4.amountCents === 2_500_000, "more than total accepted");

  // fundingBadge
  const base: FundingFileState = {
    id: "f1",
    filename: "GW-PAY.ach",
    kind: "payroll",
    status: "released",
    totalCents: 50_000,
    effectiveDate: "2026-10-21",
    settlementDate: null,
    fundingConfirmedAt: null,
    fundingConfirmedAmountCents: null,
  };
  const before = new Date("2026-10-19T18:00:00Z");
  const onDay = new Date("2026-10-21T15:10:00Z"); // 8:10 am PDT
  const after = new Date("2026-10-22T18:00:00Z");
  ok(fundingBadge(base, before).tone === "warn", "unconfirmed before settlement is amber");
  ok(fundingBadge(base, onDay).tone === "danger", "unconfirmed on settlement day is red");
  ok(fundingBadge(base, after).tone === "none", "after settlement nothing");
  ok(fundingBadge({ ...base, status: "voided" }, onDay).tone === "none", "voided shows nothing");
  const conf = fundingBadge({ ...base, fundingConfirmedAt: "2026-10-19T18:00:00Z", fundingConfirmedAmountCents: 70_000 }, onDay);
  ok(conf.tone === "ok" && /\$700\.00/.test(conf.text), "confirmed shows the amount seen");
  const ba = fundingBadge({ ...base, status: "bank_approved" }, onDay);
  ok(ba.tone === "danger" && /not recorded/.test(ba.text), "approved but never confirmed is red on the day");
  ok(fundingBadge({ ...base, status: "bank_approved" }, before).tone === "warn", "approved but never confirmed is amber before");
  ok(fundingBadge({ ...base, fundingConfirmedAt: "x", fundingConfirmedAmountCents: null }, before).tone === "warn", "half a stamp is not a confirmation");

  // planFundingReminders
  const at = (iso: string, files: FundingFileState[]) => planFundingReminders(new Date(iso), files);
  ok(at("2026-10-21T14:59:00Z", [base]).length === 0, "7:59 am PDT: nothing yet");
  ok(at("2026-10-21T15:00:00Z", [base]).length === 1, "8:00 am PDT exactly: sent");
  ok(at("2026-10-21T15:59:59Z", [base]).length === 1, "8:59:59 am PDT: sent");
  ok(at("2026-10-21T16:00:00Z", [base]).length === 0, "9:00 am PDT: too late, not sent (the 16:00 UTC tick in summer)");
  ok(at("2026-10-20T15:30:00Z", [base]).length === 0, "the day before: nothing");
  const pstFile = { ...base, effectiveDate: "2026-12-01" };
  ok(at("2026-12-01T15:00:00Z", [pstFile]).length === 0, "15:00 UTC in winter is 7:00 am PST: nothing");
  ok(at("2026-12-01T16:00:00Z", [pstFile]).length === 1, "16:00 UTC in winter is 8:00 am PST: sent");
  const r = at("2026-10-21T15:00:00Z", [base])[0]!;
  ok(r.dedupeKey === "ach-funding:f1:settle" && r.stage === "funding_morning" && r.urgency === "critical", "dedupe key per file");
  ok(/\$500\.00/.test(r.subject) && /9:00 am/.test(r.subject) && /GW-PAY\.ach/.test(r.subject), "subject names amount, file, 9:00 am");
  ok(/No balance check was recorded/.test(r.body) && /1-800-562-8761/.test(r.body) && /section 14/.test(r.body), "unconfirmed body");
  const rc = at("2026-10-21T15:00:00Z", [{ ...base, fundingConfirmedAt: "2026-10-19T18:00:00Z", fundingConfirmedAmountCents: 60_000 }])[0]!;
  ok(/\$600\.00 earlier/.test(rc.body) && /still there/.test(rc.body), "confirmed body asks to re-check");
  ok(at("2026-10-21T15:00:00Z", [{ ...base, status: "bank_approved" }]).length === 1, "approved files still reminded");
  ok(at("2026-10-21T15:00:00Z", [{ ...base, status: "uploaded" }]).length === 1, "uploaded files reminded");
  ok(at("2026-10-21T15:00:00Z", [{ ...base, status: "voided" }]).length === 0, "voided never reminded");
  ok(at("2026-10-21T15:00:00Z", [base, { ...base, id: "f2", effectiveDate: "2026-10-22" }]).length === 1, "only today's settlements");

  // fundingReadFailedReminder
  const rf = fundingReadFailedReminder(new Date("2026-10-21T15:00:00Z"), "boom");
  ok(rf.dedupeKey === "ach-funding:read-failed:2026-10-21" && /boom/.test(rf.body) && /9:00 am/.test(rf.body), "read failure note, once a day");

  console.log(`timberland-funding-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
