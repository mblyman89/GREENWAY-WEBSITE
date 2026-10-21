/**
 * src/lib/payments/timberland-deadline-core.ts  (R41 S5, PURE: no I/O, no clock)
 *
 * The upload deadline for a Timberland ACH file. Every rule is quoted from
 * the signed agreement mirror (docs/authorities/ach/
 * timberland-ach-agreement-2026-10-14.redacted.txt) through
 * timberland-profile-core; none is typed again here.
 *
 *   Schedule A, Delivery Deadline: "All ACH input files must be received by
 *   Financial Institution no later than 4:00 p.m. PST to be processed on that
 *   same day. Input files containing credit transactions must be transmitted
 *   or delivered to Financial Institution at least 2 banking days prior to
 *   the Effective Entry Date of the Entries contained within the file."
 *   -> latest upload AND approval = 2 usable banking days before the
 *      effective date, 4:00 pm Pacific (Q5 strict: Pacific local time all
 *      year). Every file we send is a credit (debit limits are $0), prenotes
 *      ($0 credits, codes 23/33) included.
 *
 *   Schedule A, Effective Entry Date: "must be a future date and must not be
 *   a Saturday, a Sunday, or a holiday observed by the Federal Reserve Bank
 *   as listed in Schedule D."
 *
 *   Schedule D: "If the normal effective date falls on a holiday date, the
 *   effective day should be changed to the business day immediately prior to
 *   the holiday for credits" -> creditEffectiveDateFor(payday) moves a
 *   payday that is not a usable day to the PRIOR usable day (never later:
 *   the repo's nextBankingDayOnOrAfter would pay people late).
 *
 *   Q9 (ANSWERED, R41 S12, owner decision D-7): a Friday whose Saturday is a
 *   Federal Reserve holiday is a normal usable day again. Brenda, Email 3
 *   answer 8: "Yes however a file uploaded on Friday would have a Monday
 *   effective." The Fed is open those Fridays too (fedAchClosures), so
 *   isUsableDay is now exactly isFedAchBankingDay. isQ9Friday stays only so
 *   screens and tests can name those Fridays; it no longer blocks anything.
 *
 *   Greenway's own margin (SAFETY_MARGIN_MIN, 30 minutes, NOT a bank rule):
 *   our target is 3:30 pm. Between 3:30 and 4:00 a release is still allowed
 *   with a gold warning; at 4:00 pm or later it is refused (no time is left
 *   to upload and approve).
 *
 *   Same Day ACH is not enabled (Schedule C), so an effective date of today
 *   is always refused. More than MAX_DAYS_AHEAD (30) calendar days out is
 *   refused as a probable typo (Greenway policy, as ach-ops-core).
 */
import { addCalendarDays, isFedAchBankingDay, weekday, FRB_HOLIDAYS } from "@/lib/payments/ach-authorization-core";
import { CREDIT_LEAD_BANKING_DAYS, HOLIDAY_SHIFT_CREDITS, SAFETY_MARGIN_MIN, UPLOAD_CUTOFF } from "@/lib/payments/timberland-profile-core";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

/** Greenway policy: an effective date more than this many calendar days out is refused as a probable typo. */
export const MAX_DAYS_AHEAD = 30;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function assertIso(iso: string, fn: string): void {
  if (!ISO.test(iso) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`${fn}: bad date ${iso}`);
}

/** "2026-10-21" -> "Wed Oct 21". */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "15:30" -> "3:30 pm". */
function clock(h: number, m: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// ---------------------------------------------------------- usable days ---

/** Q9: a Friday whose Saturday is a Federal Reserve holiday. Information only since R41 S12 (D-7: usable). */
export function isQ9Friday(iso: string): boolean {
  if (weekday(iso) !== 5) return false;
  const sat = addCalendarDays(iso, 1);
  const list = FRB_HOLIDAYS[Number(sat.slice(0, 4))];
  if (!list) throw new Error(`timberland-deadline-core: no FRB holiday schedule mirrored for ${sat.slice(0, 4)}. Mirror it - do not guess.`);
  return list.includes(sat);
}

/** A FedACH banking day (Q9 Fridays included since R41 S12, Email 3 answer 8). */
export function isUsableDay(iso: string): boolean {
  return isFedAchBankingDay(iso);
}

/** The nth usable day BEFORE `iso` (n >= 0; `iso` itself never counts). */
export function subUsableDays(iso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`subUsableDays: n must be a whole number >= 0, got ${n}`);
  let d = iso;
  for (let left = n; left > 0; ) {
    d = addCalendarDays(d, -1);
    if (isUsableDay(d)) left -= 1;
  }
  return d;
}

/** The nth usable day AFTER `iso` (n >= 0; `iso` itself never counts). */
export function addUsableDays(iso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addUsableDays: n must be a whole number >= 0, got ${n}`);
  let d = iso;
  for (let left = n; left > 0; ) {
    d = addCalendarDays(d, 1);
    if (isUsableDay(d)) left -= 1;
  }
  return d;
}

/** `iso` if usable, else the usable day before it. */
export function prevUsableDayOnOrBefore(iso: string): string {
  return isUsableDay(iso) ? iso : subUsableDays(iso, 1);
}

/** `iso` if usable, else the usable day after it. */
export function nextUsableDayOnOrAfter(iso: string): string {
  return isUsableDay(iso) ? iso : addUsableDays(iso, 1);
}

// ------------------------------------------------------------- deadline ---

/**
 * Schedule D for credits: a payday that is a weekend or a holiday moves to
 * the PRIOR usable day.
 */
export function creditEffectiveDateFor(payday: string): string {
  assertIso(payday, "creditEffectiveDateFor");
  if (HOLIDAY_SHIFT_CREDITS !== "prior") throw new Error("creditEffectiveDateFor: Schedule D says credits move to the PRIOR business day");
  return prevUsableDayOnOrBefore(payday);
}

export type UploadDeadline = {
  /** The Pacific day the file must be uploaded AND approved at Timberland. */
  day: string;
  /** Timberland's cutoff: 4:00 pm Pacific that day, as a UTC instant. */
  cutoffUtc: Date;
  /** Greenway's target: 30 minutes earlier (3:30 pm Pacific). */
  targetUtc: Date;
  /** "Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)". */
  text: string;
};

/** Latest upload and approval for a credit file with this effective date. */
export function latestUploadAndApproval(effective: string): UploadDeadline {
  assertIso(effective, "latestUploadAndApproval");
  if (UPLOAD_CUTOFF.tz !== "America/Los_Angeles") throw new Error("latestUploadAndApproval: the cutoff must be Pacific (Q5)");
  const day = subUsableDays(effective, CREDIT_LEAD_BANKING_DAYS);
  const cutoffUtc = new Date(pacificWallTimeToUtcISO(day, { h: UPLOAD_CUTOFF.hour, m: UPLOAD_CUTOFF.minute, s: 0, ms: 0 }));
  const targetUtc = new Date(cutoffUtc.getTime() - SAFETY_MARGIN_MIN * 60_000);
  const tMin = UPLOAD_CUTOFF.hour * 60 + UPLOAD_CUTOFF.minute - SAFETY_MARGIN_MIN;
  const text = `${shortDate(day)}, ${clock(Math.floor(tMin / 60), tMin % 60)} Pacific (bank cutoff ${clock(UPLOAD_CUTOFF.hour, UPLOAD_CUTOFF.minute)})`;
  return { day, cutoffUtc, targetUtc, text };
}

/**
 * The earliest effective date a file released at `nowUtc` can still make:
 * upload today if today is usable and it is before 4:00 pm Pacific, else the
 * next usable day; then 2 usable days later.
 */
export function earliestEffectiveDate(nowUtc: Date): string {
  const today = pacificDayKey(nowUtc);
  for (let i = 0; i < 40; i++) {
    const eff = addUsableDays(today, CREDIT_LEAD_BANKING_DAYS + i);
    if (nowUtc.getTime() < latestUploadAndApproval(eff).cutoffUtc.getTime()) return eff;
  }
  throw new Error("earliestEffectiveDate: no date found in 40 usable days");
}

export type EffectiveCheck =
  | { ok: true; date: string; deadline: UploadDeadline; warning: string | null }
  | { ok: false; error: string; earliest: string; rule: "format" | "not_usable" | "same_day" | "past" | "too_late" | "too_far" };

/**
 * May a credit file with this effective date be released at `nowUtc`?
 * Refuses: not a date; not a banking day; today or earlier
 * (Same Day ACH is off); its deadline (4:00 pm Pacific, 2 usable days
 * before) has passed; more than 30 days out. Each refusal names the
 * earliest effective date that still works.
 */
export function checkEffectiveDateForTimberland(raw: string | null | undefined, nowUtc: Date): EffectiveCheck {
  const earliest = earliestEffectiveDate(nowUtc);
  const try_ = `The earliest effective date that still works is ${shortDate(earliest)} (${earliest}).`;
  const d = String(raw ?? "").trim();
  if (!ISO.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    return { ok: false, rule: "format", earliest, error: `Pick the date the bank should post the entries. ${try_}` };
  }
  const today = pacificDayKey(nowUtc);
  if (d < today) return { ok: false, rule: "past", earliest, error: `${shortDate(d)} has already passed. ${try_}` };
  if (d === today) return { ok: false, rule: "same_day", earliest, error: `Timberland does not do Same Day ACH for us (Schedule C), so the effective date cannot be today. ${try_}` };
  // Before the calendar is asked (a typo like 2099 has no mirrored holidays).
  const daysOut = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (daysOut > MAX_DAYS_AHEAD) return { ok: false, rule: "too_far", earliest, error: `${shortDate(d)} is more than ${MAX_DAYS_AHEAD} days away. Check the date.` };
  if (!isFedAchBankingDay(d)) return { ok: false, rule: "not_usable", earliest, error: `${shortDate(d)} is not a banking day (weekend or Federal Reserve holiday, Schedule D). ${try_}` };
  const deadline = latestUploadAndApproval(d);
  if (nowUtc.getTime() >= deadline.cutoffUtc.getTime()) {
    return {
      ok: false,
      rule: "too_late",
      earliest,
      error: `Too late for ${shortDate(d)}: Timberland needs the file uploaded and approved at least ${CREDIT_LEAD_BANKING_DAYS} banking days before, by 4:00 pm Pacific on ${shortDate(deadline.day)} (Schedule A). ${try_}`,
    };
  }
  const warning =
    nowUtc.getTime() >= deadline.targetUtc.getTime()
      ? `Past our ${SAFETY_MARGIN_MIN}-minute safety margin: upload AND approve at Timberland right now. The bank cutoff is 4:00 pm Pacific today (${shortDate(deadline.day)}).`
      : null;
  return { ok: true, date: d, deadline, warning };
}

/** The payroll wording for a payday whose deadline has passed. */
export const PAYROLL_TOO_LATE = "Too late for direct deposit on payday. Pay this run by check.";

/** Payday -> effective date and the deadline line for the payroll form. */
export function payrollDeadlineFor(payday: string, nowUtc: Date): { effective: string; moved: boolean; check: EffectiveCheck; line: string } {
  const effective = creditEffectiveDateFor(payday);
  const check = checkEffectiveDateForTimberland(effective, nowUtc);
  const moved = effective !== payday;
  const why = moved ? ` Payday ${shortDate(payday)} is not a banking day, so the bank date is the day before: ${shortDate(effective)} (Schedule D).` : "";
  const line = check.ok
    ? `Upload and approve at Timberland by ${check.deadline.text}.${why}`
    : check.rule === "too_late" || check.rule === "past" || check.rule === "same_day"
      ? `${PAYROLL_TOO_LATE}${why}`
      : `${check.error}${why}`;
  return { effective, moved, check, line };
}

// ------------------------------------------------------------ reminders ---

export type DeadlineFile = { id: string; kind: string; status: string; filename: string; effectiveDate: string };
export type DeadlineReminder = { dedupeKey: string; stage: "deadline_today" | "deadline_missed"; subject: string; body: string; urgency: "warning" | "critical" };

/**
 * One reminder per released-but-not-approved file: on its deadline day
 * (morning run), and once if the deadline passed while it is still not
 * bank_approved. Files already approved or voided are skipped.
 */
export function planDeadlineReminders(todayIso: string, files: readonly DeadlineFile[]): DeadlineReminder[] {
  const out: DeadlineReminder[] = [];
  for (const f of files) {
    if (f.status !== "released" && f.status !== "uploaded") continue;
    const dl = latestUploadAndApproval(f.effectiveDate);
    if (dl.day === todayIso) {
      out.push({
        dedupeKey: `ach-deadline:${f.id}:today`,
        stage: "deadline_today",
        subject: `TODAY: upload and approve ${f.filename} at Timberland by 3:30 pm`,
        body: `${f.filename} (${f.kind}, effective ${shortDate(f.effectiveDate)}) must be uploaded AND approved at Timberland by ${dl.text}. It is still marked ${f.status} here.`,
        urgency: "warning",
      });
    } else if (dl.day < todayIso && f.effectiveDate >= todayIso) {
      out.push({
        dedupeKey: `ach-deadline:${f.id}:missed`,
        stage: "deadline_missed",
        subject: `Deadline passed: ${f.filename} was not marked approved at Timberland`,
        body: `${f.filename} (${f.kind}, effective ${shortDate(f.effectiveDate)}) had to be uploaded and approved by ${dl.text}. If it was not, it will not be paid on time: void it and pay by check${f.kind === "payroll" ? " (payday never waits)" : ""}. If it was, mark it approved.`,
        urgency: "critical",
      });
    }
  }
  return out;
}

/** The 1 pm Pacific nudge on deadline day (plan S5: "remind on deadline-day morning and at 1 pm"). */
export const AFTERNOON_REMINDER = { hour: 13, minute: 0 } as const;

export type AfternoonReminder = { dedupeKey: string; stage: "deadline_1pm"; subject: string; body: string; urgency: "critical" };

/**
 * The afternoon pass. A cron tick is a request to consider, never a command
 * (AGENTS.md rule 12): this plans a reminder only when it is the file's
 * deadline day in Pacific time, at or after 1:00 pm Pacific and before the
 * 4:00 pm cutoff, for files still released or uploaded (not bank_approved,
 * not voided). The dedupe key is per file, so a second tick is a no-op.
 */
export function planAfternoonDeadlineReminders(nowUtc: Date, files: readonly DeadlineFile[]): AfternoonReminder[] {
  const today = pacificDayKey(nowUtc);
  const from = new Date(pacificWallTimeToUtcISO(today, { h: AFTERNOON_REMINDER.hour, m: AFTERNOON_REMINDER.minute, s: 0, ms: 0 }));
  const out: AfternoonReminder[] = [];
  for (const f of files) {
    if (f.status !== "released" && f.status !== "uploaded") continue;
    const dl = latestUploadAndApproval(f.effectiveDate);
    if (dl.day !== today || nowUtc < from || nowUtc >= dl.cutoffUtc) continue;
    out.push({
      dedupeKey: `ach-deadline:${f.id}:1pm`,
      stage: "deadline_1pm",
      subject: `1 pm check: ${f.filename} must be approved at Timberland by 3:30 pm`,
      body: `${f.filename} (${f.kind}, effective ${shortDate(f.effectiveDate)}) is still marked ${f.status} here. Upload AND approve it at Timberland by ${dl.text}, then mark it here. After 4:00 pm it will not be paid on time.`,
      urgency: "critical",
    });
  }
  return out;
}

// ------------------------------------------------------------ self-tests ---

export function __runTimberlandDeadlineCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  FAIL timberland-deadline-core: ${n}`);
    }
  };
  const pt = (day: string, h: number, m: number) => new Date(pacificWallTimeToUtcISO(day, { h, m, s: 0, ms: 0 }));

  // The plan's section 3.7 table (probe p3): payday -> effective -> upload-and-approve day.
  const table: [string, string, string][] = [
    ["2026-10-23", "2026-10-23", "2026-10-21"],
    ["2026-11-06", "2026-11-06", "2026-11-04"],
    ["2026-11-11", "2026-11-10", "2026-11-06"], // Veterans Day
    ["2026-11-26", "2026-11-25", "2026-11-23"], // Thanksgiving
    ["2026-12-25", "2026-12-24", "2026-12-22"], // Christmas
    ["2027-01-01", "2026-12-31", "2026-12-29"], // New Year's
    ["2027-01-18", "2027-01-15", "2027-01-13"], // MLK
    ["2027-07-05", "2027-07-02", "2027-06-30"], // Independence Day observed (Sun 7/4 -> Mon 7/5)
  ];
  for (const [pay, eff, up] of table) {
    ok(creditEffectiveDateFor(pay) === eff, `3.7: payday ${pay} -> effective ${eff}`);
    ok(latestUploadAndApproval(eff).day === up, `3.7: effective ${eff} -> upload by ${up}`);
  }
  // Q9 Fridays (plan 3.7): 2026-07-03, 2027-06-18, 2027-12-24, 2027-12-31, 2028-11-10.
  // R41 S12 (Email 3 answer 8, D-7): usable again.
  for (const f of ["2026-07-03", "2027-06-18", "2027-12-24", "2027-12-31", "2028-11-10"]) ok(isQ9Friday(f) && isUsableDay(f) && isFedAchBankingDay(f), `Q9 Friday ${f} is usable (D-7)`);
  ok(!isQ9Friday("2026-10-23") && isUsableDay("2026-10-23"), "an ordinary Friday is usable");
  ok(!isUsableDay("2027-12-25") && !isUsableDay("2028-01-01"), "the Saturday holidays themselves are still never usable");
  ok(creditEffectiveDateFor("2027-12-24") === "2027-12-24", "a Q9 Friday payday stays on Friday (D-7)");
  ok(creditEffectiveDateFor("2027-12-25") === "2027-12-24", "a Saturday-holiday payday moves to the Friday before");
  ok(creditEffectiveDateFor("2026-10-24") === "2026-10-23", "a Saturday payday moves to Friday (prior, never Monday)");
  ok(latestUploadAndApproval("2027-12-28").day === "2027-12-24", "a Q9 Friday counts as an upload day (D-7): Tue 12-28 -> Fri 12-24");
  ok(subUsableDays("2026-10-14", 2) === "2026-10-09" && addUsableDays("2026-10-09", 2) === "2026-10-14", "usable-day arithmetic skips Columbus Day and the weekend");

  // 4:00 pm Pacific across DST: PDT (UTC-7) and PST (UTC-8).
  ok(latestUploadAndApproval("2026-10-23").cutoffUtc.toISOString() === "2026-10-21T23:00:00.000Z", "PDT: 4:00 pm = 23:00Z");
  ok(latestUploadAndApproval("2026-11-06").cutoffUtc.toISOString() === "2026-11-05T00:00:00.000Z", "PST (after Nov 1): 4:00 pm = 00:00Z next day");
  ok(latestUploadAndApproval("2026-11-03").day === "2026-10-30" && latestUploadAndApproval("2026-11-03").cutoffUtc.toISOString() === "2026-10-30T23:00:00.000Z", "DST-end week: Fri Oct 30 is still PDT");
  ok(latestUploadAndApproval("2026-11-04").cutoffUtc.toISOString() === "2026-11-03T00:00:00.000Z", "DST-end week: Mon Nov 2 is PST");
  ok(latestUploadAndApproval("2027-03-17").cutoffUtc.toISOString() === "2027-03-15T23:00:00.000Z", "DST-start week: Mon Mar 15 2027 is PDT");
  ok(latestUploadAndApproval("2027-03-16").cutoffUtc.toISOString() === "2027-03-13T00:00:00.000Z", "DST-start week: Fri Mar 12 2027 is PST");
  ok(latestUploadAndApproval("2026-10-23").targetUtc.toISOString() === "2026-10-21T22:30:00.000Z", "target is 3:30 pm (30-minute Greenway margin)");
  ok(latestUploadAndApproval("2026-10-23").text === "Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)", "deadline text");

  // 3:29 / 3:31 / 4:00 / 4:01 pm on the deadline day (Wed Oct 21 for Fri Oct 23).
  const c329 = checkEffectiveDateForTimberland("2026-10-23", pt("2026-10-21", 15, 29));
  ok(c329.ok && c329.warning === null, "3:29 pm: allowed, no warning");
  const c331 = checkEffectiveDateForTimberland("2026-10-23", pt("2026-10-21", 15, 31));
  ok(c331.ok && !!c331.warning && c331.warning.includes("right now"), "3:31 pm: allowed with the margin warning");
  const c400 = checkEffectiveDateForTimberland("2026-10-23", pt("2026-10-21", 16, 0));
  ok(!c400.ok && c400.rule === "too_late", "4:00 pm exactly: refused (no time left to upload and approve)");
  const c401 = checkEffectiveDateForTimberland("2026-10-23", pt("2026-10-21", 16, 1));
  ok(!c401.ok && c401.rule === "too_late" && c401.error.includes("by 4:00 pm Pacific on Wed Oct 21") && c401.earliest === "2026-10-26", "4:01 pm: refused, earliest Mon Oct 26");
  ok(checkEffectiveDateForTimberland("2026-10-23", pt("2026-10-20", 23, 59)).ok, "the day before at 11:59 pm: allowed");
  // UTC is already the next day at 5 pm Pacific: the Pacific clock decides.
  ok(!checkEffectiveDateForTimberland("2026-10-23", new Date("2026-10-21T23:30:00Z")).ok, "4:30 pm PDT (23:30Z) refused");
  ok(checkEffectiveDateForTimberland("2026-10-23", new Date("2026-10-21T22:00:00Z")).ok, "3:00 pm PDT (22:00Z) allowed");

  // Refusal kinds.
  const mon = pt("2026-10-19", 10, 0);
  const r = (d: string) => checkEffectiveDateForTimberland(d, mon);
  const rule = (d: string) => {
    const x = r(d);
    return x.ok ? "ok" : x.rule;
  };
  ok(rule("2026-10-19") === "same_day", "today refused (no Same Day ACH)");
  ok(rule("2026-10-16") === "past", "a past date refused");
  ok(rule("2026-10-20") === "too_late", "tomorrow is under 2 banking days: refused");
  ok(rule("2026-10-21") === "ok", "2 banking days out, before 4 pm: allowed");
  ok(rule("2026-10-24") === "not_usable", "Saturday refused");
  ok(rule("2026-11-11") === "not_usable", "Veterans Day refused");
  ok(rule("2026-11-20") === "too_far", "more than 30 days refused");
  ok(rule("2026-11-18") === "ok", "30 days allowed");
  ok(rule("2026-02-30") === "format" && rule("") === "format" && rule("10/21/2026") === "format", "not a date refused");
  ok(checkEffectiveDateForTimberland("2027-12-24", pt("2027-12-15", 10, 0)).ok === true, "a Q9 Friday effective date is allowed (D-7)");
  ok(checkEffectiveDateForTimberland("2027-12-25", pt("2027-12-15", 10, 0)).ok === false, "the Saturday holiday itself is still refused");
  ok(!r("2026-10-20").ok && (r("2026-10-20") as { earliest: string }).earliest === "2026-10-21", "refusal names the earliest that works");

  // earliestEffectiveDate
  ok(earliestEffectiveDate(pt("2026-10-19", 15, 59)) === "2026-10-21", "Mon 3:59 pm -> Wed");
  ok(earliestEffectiveDate(pt("2026-10-19", 16, 0)) === "2026-10-22", "Mon 4:00 pm -> Thu");
  ok(earliestEffectiveDate(pt("2026-10-09", 11, 0)) === "2026-10-14", "Fri before Columbus Day -> Wed Oct 14");
  ok(earliestEffectiveDate(pt("2026-10-10", 11, 0)) === "2026-10-15", "Saturday -> uploads Tue (Columbus Day Mon) -> Thu Oct 15");

  // Payroll wording
  const p1 = payrollDeadlineFor("2026-10-23", pt("2026-10-19", 9, 0));
  ok(p1.line === "Upload and approve at Timberland by Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm).", "payroll line, on time");
  const p2 = payrollDeadlineFor("2026-10-23", pt("2026-10-21", 16, 5));
  ok(p2.line === PAYROLL_TOO_LATE, "payroll line, too late");
  const p3 = payrollDeadlineFor("2026-11-11", pt("2026-11-02", 9, 0));
  ok(p3.effective === "2026-11-10" && p3.moved && p3.line.includes("Fri Nov 6") && p3.line.includes("the day before: Tue Nov 10"), "payroll line, holiday payday moved earlier");

  // Reminders
  const files: DeadlineFile[] = [
    { id: "a", kind: "payroll", status: "released", filename: "p.ach", effectiveDate: "2026-10-23" },
    { id: "b", kind: "vendor", status: "bank_approved", filename: "v.ach", effectiveDate: "2026-10-23" },
    { id: "c", kind: "vendor", status: "uploaded", filename: "u.ach", effectiveDate: "2026-10-22" },
    { id: "d", kind: "vendor", status: "voided", filename: "x.ach", effectiveDate: "2026-10-23" },
  ];
  const rem = planDeadlineReminders("2026-10-21", files);
  ok(rem.length === 2 && rem[0].dedupeKey === "ach-deadline:a:today" && rem[0].subject.includes("by 3:30 pm"), "deadline-day reminder for a released file");
  ok(rem[1].dedupeKey === "ach-deadline:c:missed" && rem[1].urgency === "critical", "missed deadline for a file still only uploaded");
  ok(planDeadlineReminders("2026-10-24", files).length === 0, "no reminder after the effective date");
  // Afternoon (1 pm) pass: Wed Oct 21 2026 is file a's deadline day (PDT).
  const aft = (h: number, m: number, day = "2026-10-21") => planAfternoonDeadlineReminders(pt(day, h, m), files);
  ok(aft(12, 59).length === 0, "1 pm pass: 12:59 Pacific plans nothing");
  ok(aft(13, 0).length === 1 && aft(13, 0)[0].dedupeKey === "ach-deadline:a:1pm" && aft(13, 0)[0].urgency === "critical", "1 pm pass: 1:00 pm Pacific plans the released file only");
  ok(aft(15, 59).length === 1 && aft(16, 0).length === 0, "1 pm pass: stops at the 4:00 pm cutoff");
  ok(aft(13, 0, "2026-10-20").map((r) => r.dedupeKey).join() === "ach-deadline:c:1pm" && aft(13, 0, "2026-10-22").length === 0, "1 pm pass: only on each file's own deadline day (c is due Tue Oct 20, a on Wed Oct 21)");
  // PST week: effective Wed Nov 4 -> deadline Mon Nov 2 (after the Nov 1 change).
  const pst: DeadlineFile[] = [{ id: "n", kind: "vendor", status: "uploaded", filename: "n.ach", effectiveDate: "2026-11-04" }];
  ok(planAfternoonDeadlineReminders(new Date("2026-11-02T20:00:00Z"), pst).length === 0, "1 pm pass, PST: the 20:00 UTC tick is noon Pacific: nothing");
  ok(planAfternoonDeadlineReminders(new Date("2026-11-02T21:00:00Z"), pst).length === 1, "1 pm pass, PST: the 21:00 UTC tick is 1 pm Pacific: sent");
  ok(planAfternoonDeadlineReminders(new Date("2026-10-21T20:00:00Z"), files).length === 1, "1 pm pass, PDT: the 20:00 UTC tick is 1 pm Pacific: sent");

  let threw = false;
  try {
    creditEffectiveDateFor("2026-13-01");
  } catch {
    threw = true;
  }
  ok(threw, "a bad payday throws");
  ok(rule("2099-10-21") === "too_far", "a far-off typo is refused as too far, not thrown on a missing holiday table");
  return { passed, failed };
}
