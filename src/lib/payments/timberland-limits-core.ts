/**
 * src/lib/payments/timberland-limits-core.ts  (R41 S4, PURE: no I/O)
 *
 * Timberland's exposure limits as HARD blocks. Every number comes from
 * timberland-profile-core (each quoted there from the signed agreement or
 * Brenda's emails); none is typed again here.
 *
 *   1. No single entry over LIMIT_PER_ENTRY_CENTS ($50,000; Brenda Email 1,
 *      Appendix B).
 *   2. No single file over LIMIT_PER_FILE_CENTS ($50,000; Schedule C "ACH
 *      Batch").
 *   3. Daily: for EVERY calendar day the new file is in process, the files
 *      in process that day plus this one stay at or under
 *      LIMIT_DAILY_IN_PROCESS_CENTS ($50,000). Schedule C "Maximum daily
 *      aggregate limit of all credit files"; section 26 defines it as the
 *      amount "of In-Process Entries permitted to be outstanding at any
 *      time". A file is in process from its upload day through its
 *      settlement date (it stops counting the day after). Until S6 records
 *      the real upload day, the release day (file_date, Pacific) is used:
 *      the earliest a file can be at the bank, so the window is never
 *      shorter than the truth.
 *   4. Monthly: LIMIT_MONTHLY_CENTS ($100,000). Open question Q3 (upload or
 *      effective month?) uses its strict default: a file counts in BOTH its
 *      upload month and its effective month.
 *
 * Settlement date: the agreement says the Effective Entry Date is the date
 * "on which it intends an Entry to be posted and settled", and must be a
 * banking day. So settlement = the stored settlement_date when S6 records
 * one, else the effective date (moved to the next banking day if it is not
 * one, which only makes the window longer: the strict reading).
 *
 * Prenotes never count (Brenda answer 6: "no pre-notes do not count as they
 * will process with a zero dollar limit"). Test credits (micro_entry) do.
 * Voided files never count.
 *
 * NOT overridable. Section 26: "Financial Institution will not process an
 * Over limit Entry" and may "suspend all In-Process Entries". The only ways
 * past a limit are a later date, a one-time higher limit from Timberland
 * (asked "at least 2 banking days prior to the date on which Company wishes
 * to initiate the Entry"), or paying by check.
 */
import {
  CREDIT_LEAD_BANKING_DAYS,
  LIMIT_DAILY_IN_PROCESS_CENTS,
  LIMIT_MONTHLY_CENTS,
  LIMIT_PER_ENTRY_CENTS,
  LIMIT_PER_FILE_CENTS,
  OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS,
  PRENOTES_COUNT,
  centsToUsdText,
} from "@/lib/payments/timberland-profile-core";
import { addBankingDays, addCalendarDays, isFedAchBankingDay, nextBankingDayOnOrAfter } from "@/lib/payments/ach-authorization-core";

/** Gold warning at 80% of the daily or monthly limit. */
export const WARN_AT_PERCENT = 80;
/** How far ahead "earliest date it would fit" looks (calendar days). */
export const FIT_SEARCH_DAYS = 62;

export type LimitKind = "payroll" | "vendor" | "prenote" | "micro_entry";

/** One ach_files row, as far as the limits care. */
export type LedgerFileForLimits = {
  id: string;
  kind: LimitKind;
  status: "released" | "uploaded" | "bank_approved" | "voided";
  fileDate: string; // YYYY-MM-DD, Pacific release day
  effectiveDate: string; // YYYY-MM-DD
  settlementDate: string | null;
  totalCents: number;
};

/** The file about to be released. */
export type NewFileForLimits = {
  kind: LimitKind;
  fileDate: string; // today, Pacific
  effectiveDate: string;
  totalCents: number;
  entryAmountsCents: readonly number[];
};

export type LimitWarning = { rule: "daily" | "monthly"; message: string };
export type LimitBlock = { rule: "entry" | "file" | "daily" | "monthly"; message: string };

export type LimitResult = {
  ok: boolean;
  blocks: LimitBlock[];
  warnings: LimitWarning[];
  /** The earliest upload day (with its effective date) on which this file would pass, or null if no date ever will. */
  earliestFit: { uploadDate: string; effectiveDate: string } | null;
  /** Asking Timberland today for a one-time higher limit covers uploads from this day on. */
  higherLimitEarliestUpload: string;
};

// ----------------------------------------------------------------- dates ---

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-21" -> "Wed Oct 21, 2026". */
export function friendlyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-10" -> "October 2026". */
export function friendlyMonth(key: string): string {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** The nth banking day BEFORE `iso` (n >= 1). `iso` itself never counts. */
export function subBankingDays(iso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`subBankingDays: n must be a whole number >= 0, got ${n}`);
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addCalendarDays(d, -1);
    if (isFedAchBankingDay(d)) left -= 1;
  }
  return d;
}

/** The last day a file counts toward the daily limit (its settlement date). */
export function settlementOf(f: { effectiveDate: string; settlementDate: string | null }): string {
  return f.settlementDate ?? nextBankingDayOnOrAfter(f.effectiveDate);
}

/** Every calendar day from `from` through `to`, both included. */
export function daysFromTo(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.push(d);
  return out;
}

function counts(f: { kind: LimitKind; status?: string }): boolean {
  if (f.status === "voided") return false;
  if (f.kind === "prenote") return PRENOTES_COUNT;
  return true;
}

/** Is a ledger file in process on `day`? (upload day through settlement date, both included) */
export function inProcessOn(f: LedgerFileForLimits, day: string): boolean {
  return counts(f) && f.fileDate <= day && day <= settlementOf(f);
}

/** Does a ledger file count in `month` (its upload month OR its effective month, Q3 strict)? */
export function countsInMonth(f: { kind: LimitKind; status?: string; fileDate: string; effectiveDate: string }, month: string): boolean {
  return counts(f) && (monthKey(f.fileDate) === month || monthKey(f.effectiveDate) === month);
}

export function inProcessTotal(ledger: readonly LedgerFileForLimits[], day: string): number {
  return ledger.reduce((s, f) => (inProcessOn(f, day) ? s + f.totalCents : s), 0);
}

export function monthTotal(ledger: readonly LedgerFileForLimits[], month: string): number {
  return ledger.reduce((s, f) => (countsInMonth(f, month) ? s + f.totalCents : s), 0);
}

const usd = (c: number) => `$${centsToUsdText(c)}`;
const atOrOver80 = (total: number, limit: number) => total * 100 >= limit * WARN_AT_PERCENT;

// ------------------------------------------------------------- the check ---

/** The rules only (no "earliest fit" search). */
function check(newFile: NewFileForLimits, ledger: readonly LedgerFileForLimits[]): { blocks: LimitBlock[]; warnings: LimitWarning[] } {
  const blocks: LimitBlock[] = [];
  const warnings: LimitWarning[] = [];
  if (!counts(newFile)) return { blocks, warnings };
  const live = ledger.filter((f) => counts(f));

  const bigEntries = newFile.entryAmountsCents.filter((a) => a > LIMIT_PER_ENTRY_CENTS);
  if (bigEntries.length > 0) {
    blocks.push({
      rule: "entry",
      message: `${bigEntries.length === 1 ? "One payment is" : `${bigEntries.length} payments are`} over Timberland's ${usd(LIMIT_PER_ENTRY_CENTS)} per-payment limit (largest ${usd(Math.max(...bigEntries))}).`,
    });
  }
  if (newFile.totalCents > LIMIT_PER_FILE_CENTS) {
    blocks.push({ rule: "file", message: `This file is ${usd(newFile.totalCents)}, over Timberland's ${usd(LIMIT_PER_FILE_CENTS)} per-file limit (Schedule C, ACH Batch).` });
  }

  const settle = settlementOf({ effectiveDate: newFile.effectiveDate, settlementDate: null });
  let worstDay: { day: string; total: number } | null = null;
  for (const day of daysFromTo(newFile.fileDate, settle)) {
    const total = inProcessTotal(live, day) + newFile.totalCents;
    if (!worstDay || total > worstDay.total) worstDay = { day, total };
  }
  if (worstDay && worstDay.total > LIMIT_DAILY_IN_PROCESS_CENTS) {
    blocks.push({
      rule: "daily",
      message: `On ${friendlyDate(worstDay.day)} this file would put ${usd(worstDay.total)} in process at Timberland, over the ${usd(LIMIT_DAILY_IN_PROCESS_CENTS)} daily limit (Schedule C; section 26 counts files from upload until they settle).`,
    });
  } else if (worstDay && atOrOver80(worstDay.total, LIMIT_DAILY_IN_PROCESS_CENTS)) {
    warnings.push({
      rule: "daily",
      message: `On ${friendlyDate(worstDay.day)} this file puts ${usd(worstDay.total)} in process, ${WARN_AT_PERCENT}% or more of Timberland's ${usd(LIMIT_DAILY_IN_PROCESS_CENTS)} daily limit. Only ${usd(LIMIT_DAILY_IN_PROCESS_CENTS - worstDay.total)} of room is left that day.`,
    });
  }

  const months = [...new Set([monthKey(newFile.fileDate), monthKey(newFile.effectiveDate)])];
  for (const m of months) {
    const total = monthTotal(live, m) + newFile.totalCents;
    if (total > LIMIT_MONTHLY_CENTS) {
      blocks.push({
        rule: "monthly",
        message: `${friendlyMonth(m)} would reach ${usd(total)}, over Timberland's ${usd(LIMIT_MONTHLY_CENTS)} monthly limit (Schedule C). Until Timberland answers question Q3, a file counts in both its upload month and its effective month.`,
      });
    } else if (atOrOver80(total, LIMIT_MONTHLY_CENTS)) {
      warnings.push({
        rule: "monthly",
        message: `${friendlyMonth(m)} reaches ${usd(total)}, ${WARN_AT_PERCENT}% or more of Timberland's ${usd(LIMIT_MONTHLY_CENTS)} monthly limit. ${usd(LIMIT_MONTHLY_CENTS - total)} is left that month.`,
      });
    }
  }
  return { blocks, warnings };
}

/**
 * Check a new file against Timberland's limits and the files already
 * released. Blocks are final (no override).
 */
export function evaluateTimberlandLimits(newFile: NewFileForLimits, ledger: readonly LedgerFileForLimits[]): LimitResult {
  for (const d of [newFile.fileDate, newFile.effectiveDate]) {
    if (!ISO.test(d)) throw new Error(`evaluateTimberlandLimits: bad date ${d}`);
  }
  const { blocks, warnings } = check(newFile, ledger);
  const higherLimitEarliestUpload = addBankingDays(newFile.fileDate, OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS);
  if (blocks.length === 0) return { ok: true, blocks, warnings, earliestFit: null, higherLimitEarliestUpload };

  // Earliest fit: only date-driven limits can clear by waiting.
  let earliestFit: LimitResult["earliestFit"] = null;
  const neverFits = blocks.some((b) => b.rule === "entry" || b.rule === "file");
  if (!neverFits) {
    for (let i = 1; i <= FIT_SEARCH_DAYS; i++) {
      const upload = addCalendarDays(newFile.fileDate, i);
      if (!isFedAchBankingDay(upload)) continue;
      const minEffective = addBankingDays(upload, CREDIT_LEAD_BANKING_DAYS);
      const effective = newFile.effectiveDate >= minEffective && isFedAchBankingDay(newFile.effectiveDate) ? newFile.effectiveDate : minEffective;
      if (check({ ...newFile, fileDate: upload, effectiveDate: effective }, ledger).blocks.length === 0) {
        earliestFit = { uploadDate: upload, effectiveDate: effective };
        break;
      }
    }
  }
  return { ok: false, blocks, warnings, earliestFit, higherLimitEarliestUpload };
}

/** The one message shown when a file is refused. */
export function limitRefusalMessage(r: LimitResult): string {
  const parts = [`Timberland limit: this file was NOT released. ${r.blocks.map((b) => b.message).join(" ")}`];
  parts.push("Timberland will not process an over-limit file (section 26), so this cannot be overridden.");
  if (r.earliestFit) {
    parts.push(`It would fit if uploaded on ${friendlyDate(r.earliestFit.uploadDate)} with effective date ${friendlyDate(r.earliestFit.effectiveDate)}.`);
  } else if (r.blocks.some((b) => b.rule === "entry" || b.rule === "file")) {
    parts.push("No date fixes this: split it into smaller files on different days, or pay the large amounts by check.");
  } else {
    parts.push(`It does not fit on any day in the next ${FIT_SEARCH_DAYS} days.`);
  }
  parts.push(
    `Other options: ask Timberland for a one-time higher limit (at least ${OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS} banking days before the upload day, section 26; asked today, it can cover an upload on ${friendlyDate(r.higherLimitEarliestUpload)} or later), or pay by check.`,
  );
  return parts.join(" ");
}

/** How many calendar days before the release day a file's effective date can be while it still settles on or after that day (Sat + Sun + a Monday holiday is 3; 7 leaves room). */
export const LEDGER_LOOKBACK_DAYS = 7;

/**
 * The oldest date a ledger row must touch (upload, effective or settlement
 * on or after it) to matter for a file released on `fileDate`: the first of
 * that month (monthly limit) or a week back (daily window), whichever is
 * earlier. Rows that touch nothing on or after it can count toward no day
 * and no month the check (or its earliest-fit search) looks at.
 */
export function ledgerWindowStart(fileDate: string): string {
  if (!ISO.test(fileDate)) throw new Error(`ledgerWindowStart: bad date ${fileDate}`);
  const first = `${fileDate.slice(0, 7)}-01`;
  const back = addCalendarDays(fileDate, -LEDGER_LOOKBACK_DAYS);
  return back < first ? back : first;
}

/** "Timberland room left" for today and this month. */
export function roomLeft(ledger: readonly LedgerFileForLimits[], today: string): {
  todayInProcessCents: number;
  todayRoomCents: number;
  monthUsedCents: number;
  monthRoomCents: number;
  month: string;
  todayWarn: boolean;
  monthWarn: boolean;
} {
  const t = inProcessTotal(ledger, today);
  const m = monthTotal(ledger, monthKey(today));
  return {
    todayInProcessCents: t,
    todayRoomCents: Math.max(0, LIMIT_DAILY_IN_PROCESS_CENTS - t),
    monthUsedCents: m,
    monthRoomCents: Math.max(0, LIMIT_MONTHLY_CENTS - m),
    month: monthKey(today),
    todayWarn: atOrOver80(t, LIMIT_DAILY_IN_PROCESS_CENTS),
    monthWarn: atOrOver80(m, LIMIT_MONTHLY_CENTS),
  };
}

/** Entry amounts read from a built Nacha file (each type-6 record, positions 30-39). */
export function entryAmountsFromFile(file: string): number[] {
  return file
    .split(/\r?\n/)
    .filter((r) => r[0] === "6" && r.length === 94)
    .map((r) => Number(r.slice(29, 39)));
}

// ------------------------------------------------------------ self-tests ---

export function __runTimberlandLimitsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  FAIL timberland-limits-core: ${n}`);
    }
  };
  let seq = 0;
  const row = (o: Partial<LedgerFileForLimits>): LedgerFileForLimits => ({
    id: `f${++seq}`,
    kind: "payroll",
    status: "released",
    fileDate: "2026-10-19",
    effectiveDate: "2026-10-21",
    settlementDate: null,
    totalCents: 0,
    ...o,
  });
  const nf = (o: Partial<NewFileForLimits>): NewFileForLimits => ({
    kind: "vendor",
    fileDate: "2026-10-19",
    effectiveDate: "2026-10-21",
    totalCents: 0,
    entryAmountsCents: [],
    ...o,
  });
  const ev = (n: NewFileForLimits, l: LedgerFileForLimits[] = []) => evaluateTimberlandLimits(n, l);

  // the limits come from the profile, not typed here
  ok(LIMIT_PER_ENTRY_CENTS === 5_000_000 && LIMIT_PER_FILE_CENTS === 5_000_000, "per entry / per file $50,000 (profile)");
  ok(LIMIT_DAILY_IN_PROCESS_CENTS === 5_000_000 && LIMIT_MONTHLY_CENTS === 10_000_000, "daily $50,000 / monthly $100,000 (profile)");
  ok(PRENOTES_COUNT === false, "prenotes do not count (Brenda answer 6)");

  // per entry: 49,999.99 / 50,000.00 / 50,000.01
  ok(ev(nf({ totalCents: 4_999_999, entryAmountsCents: [4_999_999] })).ok, "entry $49,999.99 allowed");
  ok(ev(nf({ totalCents: 5_000_000, entryAmountsCents: [5_000_000] })).ok, "entry $50,000.00 allowed (at the limit)");
  const e1 = ev(nf({ totalCents: 5_000_001, entryAmountsCents: [5_000_001] }));
  ok(!e1.ok && e1.blocks.some((b) => b.rule === "entry"), "entry $50,000.01 blocked");
  ok(e1.earliestFit === null, "an over-size payment has no date that fits");
  ok(/No date fixes this/.test(limitRefusalMessage(e1)), "the refusal says no date fixes it");

  // per file
  ok(ev(nf({ totalCents: 5_000_000, entryAmountsCents: [2_500_000, 2_500_000] })).ok, "file $50,000.00 allowed");
  const f1 = ev(nf({ totalCents: 5_000_001, entryAmountsCents: [2_500_000, 2_500_001] }));
  ok(!f1.ok && f1.blocks.some((b) => b.rule === "file") && !f1.blocks.some((b) => b.rule === "entry"), "file $50,000.01 blocked by the file rule only");

  // daily: two overlapping $30k files -> the second refused
  const a = row({ totalCents: 3_000_000 });
  const d1 = ev(nf({ totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [a]);
  ok(!d1.ok && d1.blocks.length === 1 && d1.blocks[0]!.rule === "daily", "overlapping $30k + $30k: the second is refused (daily)");
  ok(/Mon Oct 19, 2026/.test(d1.blocks[0]!.message) && /\$60,000\.00/.test(d1.blocks[0]!.message), "daily refusal names the day and the total");
  // non-overlapping: first settles Oct 21; a new file uploaded Oct 22 is clear
  ok(ev(nf({ fileDate: "2026-10-22", effectiveDate: "2026-10-26", totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [a]).ok, "non-overlapping $30k files: both allowed");
  // settled file stops counting the DAY AFTER settlement: uploaded on the settlement day still overlaps
  ok(!ev(nf({ fileDate: "2026-10-21", effectiveDate: "2026-10-23", totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [a]).ok, "a file still counts on its settlement day");
  ok(inProcessOn(a, "2026-10-21") && !inProcessOn(a, "2026-10-22"), "in process through settlement, not the day after");
  ok(!inProcessOn(a, "2026-10-18"), "not in process before its upload day");
  // stored settlement date wins
  const late = row({ totalCents: 3_000_000, settlementDate: "2026-10-23" });
  ok(inProcessOn(late, "2026-10-23") && !inProcessOn(late, "2026-10-24"), "a recorded settlement date is used");
  // a non-banking effective date settles the next banking day
  ok(settlementOf({ effectiveDate: "2026-10-24", settlementDate: null }) === "2026-10-26", "Saturday effective -> settles Monday");
  ok(settlementOf({ effectiveDate: "2026-11-11", settlementDate: null }) === "2026-11-12", "Veterans Day effective -> settles the next banking day");
  // exactly at the daily limit allowed, one cent over refused
  ok(ev(nf({ totalCents: 2_000_000, entryAmountsCents: [2_000_000] }), [a]).ok, "$30k + $20k = $50,000.00 allowed");
  ok(!ev(nf({ totalCents: 2_000_001, entryAmountsCents: [2_000_001] }), [a]).ok, "$30k + $20,000.01 refused");
  // the whole window is checked, not just the upload day
  const later = row({ fileDate: "2026-10-21", effectiveDate: "2026-10-23", totalCents: 3_000_000 });
  ok(!ev(nf({ totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [later]).ok, "a file released later that overlaps the window's end is counted");

  // voided and prenote excluded; test credits count
  ok(ev(nf({ totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [row({ totalCents: 3_000_000, status: "voided" })]).ok, "a voided file is excluded");
  ok(ev(nf({ totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [row({ totalCents: 3_000_000, kind: "prenote" })]).ok, "a prenote is excluded (even with an amount recorded)");
  ok(!ev(nf({ totalCents: 4_999_990, entryAmountsCents: [4_999_990] }), [row({ totalCents: 37, kind: "micro_entry" })]).ok, "a test credit counts");
  ok(ev(nf({ kind: "prenote", totalCents: 0 }), [row({ totalCents: 5_000_000 })]).ok, "a prenote file is never blocked");

  // monthly: Oct 30 -> Nov 2 counts in both months
  const octFull = [row({ fileDate: "2026-10-01", effectiveDate: "2026-10-05", totalCents: 5_000_000 }), row({ fileDate: "2026-10-12", effectiveDate: "2026-10-14", totalCents: 4_000_000 })];
  const straddle = nf({ fileDate: "2026-10-30", effectiveDate: "2026-11-02", totalCents: 1_500_000, entryAmountsCents: [1_500_000] });
  const m1 = ev(straddle, octFull);
  ok(!m1.ok && m1.blocks.some((b) => b.rule === "monthly" && /October 2026/.test(b.message)), "Oct 30 upload counts in October ($90k + $15k)");
  const novFull = [row({ fileDate: "2026-11-02", effectiveDate: "2026-11-04", totalCents: 5_000_000 }), row({ fileDate: "2026-11-16", effectiveDate: "2026-11-18", totalCents: 4_000_000 })];
  const m2 = ev(straddle, novFull);
  ok(!m2.ok && m2.blocks.some((b) => b.rule === "monthly" && /November 2026/.test(b.message)), "Nov 2 effective counts in November");
  ok(countsInMonth(row({ fileDate: "2026-10-30", effectiveDate: "2026-11-02" }), "2026-10") && countsInMonth(row({ fileDate: "2026-10-30", effectiveDate: "2026-11-02" }), "2026-11"), "a straddling file counts in both months");
  ok(monthTotal([row({ fileDate: "2026-10-30", effectiveDate: "2026-11-02", totalCents: 100 })], "2026-10") === 100, "counted once per month, not twice");
  ok(ev(nf({ fileDate: "2026-10-26", effectiveDate: "2026-10-28", totalCents: 1_000_000, entryAmountsCents: [1_000_000] }), octFull).ok, "$90k + $10k = $100,000.00 in October allowed");
  ok(!ev(nf({ fileDate: "2026-10-26", effectiveDate: "2026-10-28", totalCents: 1_000_001, entryAmountsCents: [1_000_001] }), octFull).ok, "$90k + $10,000.01 refused");

  // gold warning at 80%
  const w1 = ev(nf({ totalCents: 1_000_000, entryAmountsCents: [1_000_000] }), [a]);
  ok(w1.ok && w1.warnings.some((w) => w.rule === "daily"), "$40k in process (80%) warns");
  ok(ev(nf({ totalCents: 999_999, entryAmountsCents: [999_999] }), [a]).warnings.length === 0, "$39,999.99 (under 80%) does not warn");
  const w2 = ev(nf({ fileDate: "2026-10-26", effectiveDate: "2026-10-28", totalCents: 100, entryAmountsCents: [100] }), [row({ fileDate: "2026-10-01", effectiveDate: "2026-10-05", totalCents: 4_000_000 }), row({ fileDate: "2026-10-12", effectiveDate: "2026-10-14", totalCents: 3_999_900 })]);
  ok(w2.ok && w2.warnings.some((w) => w.rule === "monthly"), "$80,000 in a month warns");

  // earliest fit
  ok(d1.earliestFit !== null && d1.earliestFit.uploadDate === "2026-10-22", "earliest fit: the banking day after the other file settles");
  ok(d1.earliestFit !== null && d1.earliestFit.effectiveDate === addBankingDays("2026-10-22", CREDIT_LEAD_BANKING_DAYS), "earliest fit moves the effective date to keep the lead time");
  ok(/It would fit if uploaded on Thu Oct 22, 2026/.test(limitRefusalMessage(d1)), "the refusal names the earliest fit");
  const farEff = ev(nf({ effectiveDate: "2026-10-30", totalCents: 3_000_000, entryAmountsCents: [3_000_000] }), [row({ fileDate: "2026-10-19", effectiveDate: "2026-10-21", totalCents: 3_000_000 })]);
  ok(farEff.earliestFit !== null && farEff.earliestFit.effectiveDate === "2026-10-30", "earliest fit keeps a later effective date the user chose");
  const monthBlocked = ev(nf({ fileDate: "2026-10-26", effectiveDate: "2026-10-28", totalCents: 2_000_000, entryAmountsCents: [2_000_000] }), octFull);
  ok(monthBlocked.earliestFit !== null && monthBlocked.earliestFit.uploadDate === "2026-11-02", "a full month: the earliest fit is the first November banking day");

  // the over-limit request lead and the message
  ok(e1.higherLimitEarliestUpload === "2026-10-21", "asked Mon Oct 19, a higher limit covers uploads from Wed Oct 21 (2 banking days)");
  ok(ev(nf({ fileDate: "2026-10-09", totalCents: 5_000_001, entryAmountsCents: [5_000_001] })).higherLimitEarliestUpload === "2026-10-14", "the lead skips Columbus Day and the weekend");
  const msg = limitRefusalMessage(d1);
  ok(/NOT released/.test(msg) && /cannot be overridden/.test(msg) && /pay by check/.test(msg) && /one-time higher limit/.test(msg), "the refusal: not released, no override, higher limit, check");

  // helpers
  ok(subBankingDays("2026-10-14", 2) === "2026-10-09", "subBankingDays skips Columbus Day and the weekend");
  ok(daysFromTo("2026-10-30", "2026-11-02").length === 4, "daysFromTo includes both ends");
  ok(friendlyDate("2026-10-21") === "Wed Oct 21, 2026", "friendly date");
  ok(friendlyMonth("2026-11") === "November 2026", "friendly month");
  const r = roomLeft([a, row({ totalCents: 37, kind: "micro_entry" })], "2026-10-20");
  ok(r.todayInProcessCents === 3_000_037 && r.todayRoomCents === 1_999_963 && r.monthRoomCents === 10_000_000 - 3_000_037, "room left today and this month");
  ok(roomLeft([row({ totalCents: 4_000_000 })], "2026-10-20").todayWarn, "room left warns at 80%");
  ok(roomLeft([], "2026-10-20").todayRoomCents === 5_000_000, "an empty ledger has all the room");
  const line = (amt: number) => "6" + "22" + "12100035" + "8" + "12345678901234567" + String(amt).padStart(10, "0") + "E".padEnd(15) + "NAME".padEnd(22) + "  " + "0" + "325170750000001";
  ok(line(5).length === 94, "fixture entry line is 94 characters");
  ok(entryAmountsFromFile([line(5), line(5_000_001), "9".padEnd(94, "0")].join("\r\n")).join() === "5,5000001", "entry amounts read from type-6 records only");
  let threw = false;
  try {
    ev(nf({ fileDate: "10/19/2026" }));
  } catch {
    threw = true;
  }
  ok(threw, "a malformed date throws");
  ok(ledgerWindowStart("2026-10-19") === "2026-10-01", "window start: the first of the month when that is earlier");
  ok(ledgerWindowStart("2026-10-03") === "2026-09-26", "window start: a week back early in the month");
  ok(ledgerWindowStart("2026-10-08") === "2026-10-01", "window start: the 8th reaches the 1st either way");
  // A row effective Sat Oct 10 settles Tue Oct 13 (Columbus Day Mon Oct 12): still in process on the 13th,
  // and its effective date is inside the window read for a file released on the 13th.
  const sat = row({ fileDate: "2026-10-08", effectiveDate: "2026-10-10", totalCents: 1 });
  ok(settlementOf(sat) === "2026-10-13" && inProcessOn(sat, "2026-10-13") && sat.effectiveDate >= ledgerWindowStart("2026-10-13"), "window start covers a weekend + holiday settlement");

  return { passed, failed };
}
