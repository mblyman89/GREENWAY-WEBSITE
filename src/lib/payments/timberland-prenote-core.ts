/**
 * src/lib/payments/timberland-prenote-core.ts  (R41 S7, PURE: no I/O, no clock)
 *
 * Timberland's prenote wait, the first-file gate and the backwards plan for
 * the first live payroll. The rule is quoted from the signed agreement mirror
 * (docs/authorities/ach/timberland-ach-agreement-2026-10-14.redacted.txt):
 *
 *   section 6 Prenotification: "If Company chooses to originate non-dollar
 *   prenotification Entries to verify the accuracy of routing and account
 *   numbers, it agrees not to initiate live dollar Entries until at least 6
 *   banking days following the settlement date of the prenotification Entry."
 *
 * The number (6) and its start point ("settlement") come from
 * timberland-profile-core (S1); they are not typed again here.
 *
 *   Q7 (ANSWERED, R41 S12, owner decision D-6): Brenda, Email 3 answer 6:
 *   "Technically you could upload a live file prior to the 6 days however
 *   you are defeating the purpose of creating the pre-note file in the first
 *   place." -> the wait is still counted to the UPLOAD day: the live file may
 *   be UPLOADED no earlier than settlement + 6 days, so the prenote's
 *   eligible_on (0263) is that day.
 *
 *   Q20 (ANSWERED, D-1): the 6 days stay, exactly as signed (section 6).
 *
 *   Q9 (ANSWERED, R41 S12, D-7): Fridays before a Saturday Federal Reserve
 *   holiday are usable again, so the 6 days are counted in usable days
 *   (timberland-deadline-core.addUsableDays), which are now the Fed banking
 *   days.
 *
 * Nacha's own minimum is 3 banking days (ach-authorization-core
 * NACHA_MIN_PRENOTE_WAIT_BANKING_DAYS). Timberland's day is proven, for every
 * settlement date tested, to be at or after Nacha's.
 *
 * FIRST-FILE GATE (plan S7): live payroll and vendor files stay locked until
 * one prenote file Greenway released is recorded as approved at Timberland
 * (bank_approved, 0274), its 6-day wait has passed, and at least one prenote
 * that settled on that file's date has PASSED (0263 refuses a pass when the
 * bank answered with a return or change notice). So the first file Timberland
 * ever processes for Greenway moves no money.
 */

import { addBankingDays, nachaMinPrenoteLiveDate } from "./ach-authorization-core";
import { PRENOTE_WAIT_BANKING_DAYS, PRENOTE_WAIT_FROM } from "./timberland-profile-core";
import {
  addUsableDays,
  creditEffectiveDateFor,
  earliestEffectiveDate,
  latestUploadAndApproval,
  shortDate,
  subUsableDays,
} from "./timberland-deadline-core";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function assertIso(d: string, fn: string): void {
  if (!ISO.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error(`${fn}: not a YYYY-MM-DD date: ${JSON.stringify(d)}`);
}

function assertProfile(): void {
  if (PRENOTE_WAIT_FROM !== "settlement") throw new Error("timberland-prenote-core: section 6 counts from the SETTLEMENT date");
  if (!Number.isInteger(PRENOTE_WAIT_BANKING_DAYS) || PRENOTE_WAIT_BANKING_DAYS < 3) throw new Error("timberland-prenote-core: the prenote wait must be a whole number of days, at least Nacha's 3");
}

/**
 * The first day a live file may be UPLOADED to an account whose prenote
 * settled on `settlement` (section 6; Q7 counted to the upload day, D-6). This is the
 * prenote's eligible_on.
 */
export function prenoteLiveUploadDay(settlement: string): string {
  assertIso(settlement, "prenoteLiveUploadDay");
  assertProfile();
  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS);
}

/**
 * The database cannot see the Federal Reserve calendar, so migration 0275
 * enforces a calendar-day FLOOR that is always at or before the real day:
 * six weekdays cannot fit without crossing a weekend, so the sixth usable day
 * after any date is at least 8 calendar days later (holidays only push it
 * further). The self-test proves this for every day 2026-2028.
 * The app writes the exact day; the database refuses anything earlier than
 * the floor, so a bug or a hand-typed RPC can never shorten the wait to
 * Nacha's three days.
 */
export const PRENOTE_DB_FLOOR_CALENDAR_DAYS = 8;

/** Plain words for the wait, used by the Account checks page and the errors. */
export const PRENOTE_WAIT_WORDS = `${PRENOTE_WAIT_BANKING_DAYS} banking days after it settles (Timberland agreement section 6)`;

// ------------------------------------------------------- first-file gate ---

export type GatePrenoteFile = { id: string; status: string; effectiveDate: string; filename: string };
export type GatePassedPrenote = { settlementDate: string };

export type FirstFileGate =
  | { open: true; fileId: string; filename: string; openedOn: string; line: string }
  | { open: false; stage: "no_file" | "not_approved" | "waiting" | "no_pass"; until: string | null; line: string };

export const FIRST_FILE_LOCKED_PREFIX = "Live ACH is locked until Timberland has processed your first prenote file.";

/**
 * Is the first-file test done? Given every prenote file in the ledger and the
 * settlement dates of every PASSED prenote check. The earliest file that
 * qualifies opens the gate; otherwise the most advanced stage is reported, so
 * the owner sees exactly the next step.
 */
export function firstFileGate(todayIso: string, files: readonly GatePrenoteFile[], passed: readonly GatePassedPrenote[]): FirstFileGate {
  assertIso(todayIso, "firstFileGate");
  const passedOn = new Set(passed.map((p) => p.settlementDate));
  const live = files.filter((f) => f.status !== "voided").slice().sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : a.id < b.id ? -1 : 1));
  for (const f of live) {
    if (f.status !== "bank_approved") continue;
    const openedOn = prenoteLiveUploadDay(f.effectiveDate);
    if (todayIso >= openedOn && passedOn.has(f.effectiveDate)) {
      return { open: true, fileId: f.id, filename: f.filename, openedOn, line: `First-file test passed: prenote file ${f.filename} was approved at Timberland and its wait ended ${shortDate(openedOn)}.` };
    }
  }
  const approved = live.filter((f) => f.status === "bank_approved");
  if (approved.length > 0) {
    const waiting = approved.map((f) => ({ f, on: prenoteLiveUploadDay(f.effectiveDate) })).filter((x) => todayIso < x.on);
    if (waiting.length > 0) {
      const soonest = waiting.reduce((a, b) => (b.on < a.on ? b : a));
      return {
        open: false,
        stage: "waiting",
        until: soonest.on,
        line: `${FIRST_FILE_LOCKED_PREFIX} Prenote file ${soonest.f.filename} is approved; the wait ends ${shortDate(soonest.on)} (${PRENOTE_WAIT_WORDS}). Pay by check until then.`,
      };
    }
    return {
      open: false,
      stage: "no_pass",
      until: null,
      line: `${FIRST_FILE_LOCKED_PREFIX} The wait is over, but no prenote from that file is marked passed yet. Open Account checks and mark the prenotes that had no return or change notice. Pay by check until then.`,
    };
  }
  if (live.length > 0) {
    return {
      open: false,
      stage: "not_approved",
      until: null,
      line: `${FIRST_FILE_LOCKED_PREFIX} A prenote file is released but not recorded as approved at Timberland. Upload and approve it in Timberland's portal, then record both steps on the ACH files page. Pay by check until then.`,
    };
  }
  return {
    open: false,
    stage: "no_file",
    until: null,
    line: `${FIRST_FILE_LOCKED_PREFIX} Start a prenote for at least one person on Account checks, release the prenote file and upload it. Pay by check until then.`,
  };
}

// ------------------------------------------------- backwards plan (3.7) ---

export type FirstPayrollPlan = {
  payday: string;
  /** Schedule D: the bank date for the live credits. */
  liveEffective: string;
  /** Schedule A: the live file is uploaded and approved by 4 pm Pacific this day. */
  liveUploadBy: string;
  /** Section 6: the prenote must have SETTLED by this day. */
  prenoteSettleBy: string;
  /** Schedule A again: the prenote file is uploaded and approved by 4 pm Pacific this day. */
  prenoteUploadBy: string;
  lines: readonly string[];
};

/**
 * Working backwards from the first live payday (plan section 3.7):
 * payday -> live effective (prior usable day) -> live upload (2 usable days
 * before) -> prenote settled at least 6 usable days before the live upload
 * -> prenote upload (2 usable days before its settlement = effective date).
 */
export function firstPayrollPlan(payday: string): FirstPayrollPlan {
  assertIso(payday, "firstPayrollPlan");
  assertProfile();
  const liveEffective = creditEffectiveDateFor(payday);
  const liveUploadBy = latestUploadAndApproval(liveEffective).day;
  const prenoteSettleBy = subUsableDays(liveUploadBy, PRENOTE_WAIT_BANKING_DAYS);
  const prenoteUploadBy = latestUploadAndApproval(prenoteSettleBy).day;
  return {
    payday,
    liveEffective,
    liveUploadBy,
    prenoteSettleBy,
    prenoteUploadBy,
    lines: [
      `1. Upload AND approve the prenote file at Timberland by ${shortDate(prenoteUploadBy)}, 4:00 pm Pacific (aim for 3:30). Its effective date: ${shortDate(prenoteSettleBy)}.`,
      `2. The prenote settles ${shortDate(prenoteSettleBy)}. Watch for a return or change notice.`,
      `3. From ${shortDate(liveUploadBy)} (${PRENOTE_WAIT_BANKING_DAYS} banking days later), mark the prenotes passed on Account checks.`,
      `4. Release, upload AND approve the payroll file by ${shortDate(liveUploadBy)}, 4:00 pm Pacific, for bank date ${shortDate(liveEffective)}${liveEffective !== payday ? ` (payday ${shortDate(payday)} is not a banking day)` : ""}.`,
    ],
  };
}

export type FirstPayrollCheck =
  | { ok: true; plan: FirstPayrollPlan; warning: string | null }
  | { ok: false; plan: FirstPayrollPlan | null; earliestPayday: string; error: string };

/**
 * Can a first live payday still be made, given now? The prenote file must
 * still be releasable for its effective date (Schedule A cutoff). If not, the
 * earliest workable first payday is given: the earliest bank date a live
 * file could carry (any usable banking day; Greenway's Friday paydays are
 * typed by the owner, never picked by the site).
 */
export function checkFirstPayday(raw: string | null | undefined, nowUtc: Date): FirstPayrollCheck {
  const earliestPrenoteEffective = earliestEffectiveDate(nowUtc);
  const earliestLiveUpload = prenoteLiveUploadDay(earliestPrenoteEffective);
  const earliestLiveEffective = addUsableDays(earliestLiveUpload, 2);
  const earliestPayday = earliestLiveEffective;
  const d = String(raw ?? "").trim();
  if (!ISO.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    return { ok: false, plan: null, earliestPayday, error: `Type the first payday you want paid by direct deposit (YYYY-MM-DD). The earliest that still works is ${shortDate(earliestPayday)}.` };
  }
  let plan: FirstPayrollPlan;
  try {
    plan = firstPayrollPlan(d);
  } catch (e) {
    return { ok: false, plan: null, earliestPayday, error: `${d} cannot be checked against the bank calendar: ${(e as Error).message}` };
  }
  if (plan.prenoteSettleBy < earliestPrenoteEffective) {
    return {
      ok: false,
      plan,
      earliestPayday,
      error: `Too late for ${shortDate(d)} by direct deposit: the prenote had to be uploaded by ${shortDate(plan.prenoteUploadBy)}. Pay that day by check. The earliest first payday that still works is ${shortDate(earliestPayday)}.`,
    };
  }
  const warning = plan.prenoteSettleBy === earliestPrenoteEffective ? `No slack: the prenote file must be uploaded and approved by ${shortDate(plan.prenoteUploadBy)}, 4:00 pm Pacific.` : null;
  return { ok: true, plan, warning };
}

// ------------------------------------------------------------- self-test ---

export function __runTimberlandPrenoteCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  FAIL timberland-prenote-core: ${n}`);
    }
  };
  const throws = (f: () => unknown, n: string) => {
    try {
      f();
      ok(false, n);
    } catch {
      ok(true, n);
    }
  };

  // section 6 forward: settle -> first live upload day (6 usable days).
  ok(PRENOTE_WAIT_BANKING_DAYS === 6 && PRENOTE_WAIT_FROM === "settlement", "profile: 6 from settlement");
  ok(prenoteLiveUploadDay("2026-10-20") === "2026-10-28", "Tue 10-20 + 6 -> Wed 10-28");
  ok(prenoteLiveUploadDay("2026-11-02") === "2026-11-10", "Mon 11-02 + 6 skips Veterans Day -> Tue 11-10");
  ok(prenoteLiveUploadDay("2026-11-20") === "2026-12-01", "Fri 11-20 + 6 skips Thanksgiving -> Tue 12-01");
  ok(prenoteLiveUploadDay("2027-12-20") === "2027-12-28", "D-7: Fri 12-24 now counts -> Tue 12-28");
  ok(prenoteLiveUploadDay("2027-12-20") === addBankingDays("2027-12-20", 6), "usable days are the Fed banking days since D-7");
  throws(() => prenoteLiveUploadDay("2026-13-01"), "bad date refused");
  for (const s of ["2026-10-13", "2026-11-24", "2026-12-24", "2027-07-02", "2027-12-20"]) {
    ok(prenoteLiveUploadDay(s) > nachaMinPrenoteLiveDate(s), `Timberland day is after Nacha's floor (${s})`);
  }

  // the 0275 database floor is never later than the real day (every day 2026-01-01 .. 2028-12-15).
  let floorOk = true;
  let tightest = 99;
  for (let t = Date.parse("2026-01-01T00:00:00Z"); t <= Date.parse("2028-12-15T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const gap = Math.round((Date.parse(`${prenoteLiveUploadDay(d)}T00:00:00Z`) - t) / 86_400_000);
    if (gap < PRENOTE_DB_FLOOR_CALENDAR_DAYS) floorOk = false;
    tightest = Math.min(tightest, gap);
  }
  ok(floorOk, "0275 floor (8 calendar days) never refuses a correct Timberland day");
  ok(tightest === PRENOTE_DB_FLOOR_CALENDAR_DAYS, "the floor is tight (some settlement day is exactly 8 days from its live day)");

  // section 3.7 backwards table.
  const table: [string, string, string, string][] = [
    ["2026-10-30", "2026-10-28", "2026-10-20", "2026-10-16"],
    ["2026-11-06", "2026-11-04", "2026-10-27", "2026-10-23"],
    ["2026-11-13", "2026-11-10", "2026-11-02", "2026-10-29"],
    ["2026-11-20", "2026-11-18", "2026-11-09", "2026-11-05"],
  ];
  for (const [pay, up, settle, pre] of table) {
    const p = firstPayrollPlan(pay);
    ok(p.liveUploadBy === up && p.prenoteSettleBy === settle && p.prenoteUploadBy === pre, `3.7: ${pay}`);
    ok(prenoteLiveUploadDay(p.prenoteSettleBy) <= p.liveUploadBy, `3.7 round trip ${pay}`);
  }
  const hol = firstPayrollPlan("2026-11-26");
  ok(hol.liveEffective === "2026-11-25" && hol.lines[3].includes("not a banking day"), "holiday payday moves prior and says so");
  ok(firstPayrollPlan("2026-10-30").lines.length === 4, "four steps");

  // checkFirstPayday against a fixed now (Wed 2026-10-14, 10:00 Pacific = 17:00 UTC).
  const now = new Date("2026-10-14T17:00:00Z");
  const c1 = checkFirstPayday("2026-10-30", now);
  ok(c1.ok, "10-30 still works on 10-14 morning");
  const c2 = checkFirstPayday("2026-10-23", now);
  ok(!c2.ok && /Too late/.test(c2.error) && /by check/.test(c2.error), "10-23 too late, pay by check");
  ok(!checkFirstPayday("x", now).ok, "garbage refused");
  ok(!c2.ok && c2.earliestPayday <= "2026-10-30", "earliest payday given");
  const e = checkFirstPayday("x", now);
  ok(!e.ok && checkFirstPayday(e.earliestPayday, now).ok, "the earliest payday offered itself works");

  // first-file gate.
  const F = (o: Partial<GatePrenoteFile>): GatePrenoteFile => ({ id: "f1", status: "bank_approved", effectiveDate: "2026-10-20", filename: "acctcheck_prenote_2026-10-20_1.ach", ...o });
  ok(firstFileGate("2026-10-28", [], []).open === false, "no file -> locked");
  const g0 = firstFileGate("2026-10-28", [], []);
  ok(!g0.open && g0.stage === "no_file", "stage no_file");
  const g1 = firstFileGate("2026-10-28", [F({ status: "uploaded" })], [{ settlementDate: "2026-10-20" }]);
  ok(!g1.open && g1.stage === "not_approved", "uploaded only -> not_approved");
  const g2 = firstFileGate("2026-10-27", [F({})], [{ settlementDate: "2026-10-20" }]);
  ok(!g2.open && g2.stage === "waiting" && g2.until === "2026-10-28", "day before -> waiting until 10-28");
  const g3 = firstFileGate("2026-10-28", [F({})], [{ settlementDate: "2026-10-20" }]);
  ok(g3.open && g3.openedOn === "2026-10-28", "opens on the day");
  const g4 = firstFileGate("2026-10-28", [F({})], [{ settlementDate: "2026-10-21" }]);
  ok(!g4.open && g4.stage === "no_pass", "no pass on that settlement -> no_pass");
  const g5 = firstFileGate("2026-12-01", [F({ status: "voided" })], [{ settlementDate: "2026-10-20" }]);
  ok(!g5.open && g5.stage === "no_file", "a voided file never counts");
  const g6 = firstFileGate("2026-10-28", [F({ id: "a", status: "released", effectiveDate: "2026-10-27" }), F({ id: "b" })], [{ settlementDate: "2026-10-20" }]);
  ok(g6.open && g6.fileId === "b", "any qualifying file opens it");
  ok(!g2.open && g2.line.startsWith(FIRST_FILE_LOCKED_PREFIX) && /by check/.test(g2.line), "locked line says pay by check");

  return { passed, failed };
}
