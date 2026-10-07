/**
 * src/lib/compliance/obligation-waiver-core.ts  (CCRS Bible v2 slice S-12d)
 *
 * PURE rules for "stop nagging me about periods that are not mine to file, or
 * that I already handled outside this system". No I/O; tsx-testable.
 *
 * Michael, 2026-10-07 (verbatim, standing rule 1): "let me set the first week
 * of sales so the back log of weekly uploads I haven't uploaded stops
 * harassing me so much about them. Or a way to check it off the list with a
 * reason maybe. The first day of sales for us will hopefully be November 1st
 * 2026. Same goes for missed monthly excise and sales tax payments."
 *
 * TWO TOOLS, ONE RULE EACH.
 *
 *  1. The START DATE: the first day this back office is responsible for the
 *     store's filings. Until then Cultivera is the assigned integrator and
 *     uploads the weekly CCRS files (bible Part 07 A.1), and the monthly
 *     LIQ-1295 is filed from the current POS numbers outside this system.
 *       - CCRS week: not this system's job when the week ENDS before the start
 *         date. The week CONTAINING the start date is required (it has sales).
 *       - LIQ-1295 month: the LEGAL duty never pauses ("even if they have no
 *         sales", LCB Cannabis Tax Reporting Guide). So a sales month that ended
 *         before the start date keeps its due-soon and due-today reminders (a
 *         real deadline you still have to hit), and only goes quiet once its due
 *         date has PASSED. That is what removes the backlog without hiding the
 *         next real deadline. Example with start 2026-11-01: October 2026 sales
 *         are still reminded for the 2026-11-20 due date; July 2026 (due
 *         2026-08-20) stops being "OVERDUE" every morning.
 *
 *  2. DISMISS WITH A REASON: one specific week or month, checked off with a
 *     written reason (10 to 500 characters after trimming), who and when.
 *     Only a period that has ENDED can be dismissed: you cannot pre-excuse a
 *     week that has not happened. A dismissal can be undone; the history is
 *     kept (migration 0250, revoked_at).
 *
 * PRECEDENCE (one place, used by every screen and the reminder cron):
 *   recorded on the ledger (submitted / nothing to report / export on record)
 *   > before the start date (rule 1)
 *   > dismissed with a reason (rule 2)
 *   > the normal date-based status.
 */

export const WAIVABLE_OBLIGATIONS = ["ccrs_weekly", "liq1295"] as const;
export type WaivableObligation = (typeof WAIVABLE_OBLIGATIONS)[number];

export const REASON_MIN = 10;
export const REASON_MAX = 500;
/** Earliest start date accepted (sanity bound, not a legal date). */
export const START_MIN = "2020-01-01";
/** How far ahead a start date may be set, in days. */
export const START_MAX_AHEAD_DAYS = 730;

export type Waiver = {
  obligation: WaivableObligation;
  periodKey: string;
  reason: string;
  waivedAt: string;
  waivedByEmail: string | null;
  /** Row id (obligation_waivers.id) so the page can offer "undo". Optional in tests. */
  id?: string;
};

/** The context every deadline calculator receives. Empty = today's behaviour. */
export type ObligationContext = {
  /** ISO YYYY-MM-DD, or null when not set. */
  startDate: string | null;
  /** Live (not revoked) waivers keyed by `${obligation}:${periodKey}`. */
  waivers: ReadonlyMap<string, Waiver>;
};

export const EMPTY_CONTEXT: ObligationContext = { startDate: null, waivers: new Map() };

export function waiverKey(obligation: WaivableObligation, periodKey: string): string {
  return `${obligation}:${periodKey}`;
}

export function isWaivableObligation(x: unknown): x is WaivableObligation {
  return typeof x === "string" && (WAIVABLE_OBLIGATIONS as readonly string[]).includes(x);
}

/** A REAL calendar date in strict ISO form (rejects 2026-02-30, 2026-13-01). */
export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function lastDayOfMonthIso(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type Check = { ok: true; value: string } | { ok: false; error: string };

/** Validate the start date the owner types. Empty string clears it (value ""). */
export function validateStartDate(raw: unknown, todayIso: string): Check {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") return { ok: true, value: "" };
  if (!isRealIsoDate(s)) return { ok: false, error: "Enter a real date as YYYY-MM-DD (for example 2026-11-01)." };
  if (s < START_MIN) return { ok: false, error: `The start date cannot be before ${START_MIN}.` };
  const max = addDays(todayIso, START_MAX_AHEAD_DAYS);
  if (s > max) return { ok: false, error: `The start date cannot be more than two years ahead (latest ${max}).` };
  return { ok: true, value: s };
}

/** Validate the written reason. Trimmed; 10 to 500 characters. */
export function validateReason(raw: unknown): Check {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length < REASON_MIN) {
    return { ok: false, error: `Write a reason of at least ${REASON_MIN} characters (who filed it, or why it was not required).` };
  }
  if (s.length > REASON_MAX) return { ok: false, error: `Keep the reason under ${REASON_MAX} characters.` };
  return { ok: true, value: s };
}

/**
 * Validate a period key for an obligation, and that the period has ENDED by
 * `todayIso` (Pacific). Weekly: "W-YYYY-MM-DD" whose date is a Sunday, ended
 * once today is after its Saturday. Monthly: "YYYY-MM", ended once today is
 * after its last day.
 */
export function validateDismissal(obligation: unknown, periodKey: unknown, todayIso: string): Check {
  if (!isWaivableObligation(obligation)) return { ok: false, error: "Unknown obligation." };
  const key = typeof periodKey === "string" ? periodKey.trim() : "";
  if (obligation === "ccrs_weekly") {
    const m = /^W-(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m || !isRealIsoDate(m[1])) return { ok: false, error: "Invalid week." };
    if (weekdayOf(m[1]) !== 0) return { ok: false, error: "A CCRS week starts on a Sunday." };
    const end = addDays(m[1], 6);
    if (todayIso <= end) return { ok: false, error: "This week has not ended yet. A week can be dismissed after its Saturday." };
    return { ok: true, value: key };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return { ok: false, error: "Invalid month." };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return { ok: false, error: "Invalid month." };
  if (todayIso <= lastDayOfMonthIso(y, mo)) {
    return { ok: false, error: "This sales month has not ended yet. It can be dismissed after its last day." };
  }
  return { ok: true, value: key };
}

/** Rule 1, weekly: the week ends before the start date. */
export function weekBeforeStart(weekEndIso: string, startDate: string | null): boolean {
  return startDate !== null && weekEndIso < startDate;
}

/**
 * Rule 1, monthly: the sales month ended before the start date AND its due
 * date has passed. Before the due date the real deadline is still reminded.
 */
export function monthBeforeStartAndPastDue(
  year: number,
  month: number,
  dueDateIso: string,
  todayIso: string,
  startDate: string | null,
): boolean {
  if (startDate === null) return false;
  return lastDayOfMonthIso(year, month) < startDate && todayIso > dueDateIso;
}

/** Build the context from raw store rows (drops junk and revoked rows). */
export function buildContext(
  startRaw: unknown,
  rows: readonly {
    id?: unknown;
    obligation?: unknown;
    period_key?: unknown;
    reason?: unknown;
    waived_at?: unknown;
    waived_by_email?: unknown;
    revoked_at?: unknown;
  }[],
): ObligationContext {
  const startDate = isRealIsoDate(startRaw) ? startRaw : null;
  const waivers = new Map<string, Waiver>();
  for (const r of rows) {
    if (!r || r.revoked_at) continue;
    if (!isWaivableObligation(r.obligation)) continue;
    if (typeof r.period_key !== "string" || typeof r.reason !== "string") continue;
    waivers.set(waiverKey(r.obligation, r.period_key), {
      obligation: r.obligation,
      periodKey: r.period_key,
      reason: r.reason,
      waivedAt: typeof r.waived_at === "string" ? r.waived_at : "",
      waivedByEmail: typeof r.waived_by_email === "string" ? r.waived_by_email : null,
      ...(typeof r.id === "string" ? { id: r.id } : {}),
    });
  }
  return { startDate, waivers };
}

/** Read the start date out of the site_settings value_json shape. */
export function startDateFromSetting(valueJson: unknown): string | null {
  if (!valueJson || typeof valueJson !== "object") return null;
  const v = (valueJson as Record<string, unknown>).startDate;
  return isRealIsoDate(v) ? v : null;
}

// ── Self-tests (tsx / vitest) ──────────────────────────────────────────────

export function __runObligationWaiverTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // Real dates.
  ok(isRealIsoDate("2026-11-01"), "2026-11-01 is real");
  ok(!isRealIsoDate("2026-02-29"), "2026-02-29 is not real");
  ok(isRealIsoDate("2028-02-29"), "2028-02-29 is real");
  ok(!isRealIsoDate("2026-13-01"), "month 13 rejected");
  ok(!isRealIsoDate("2026-00-10"), "month 0 rejected");
  ok(!isRealIsoDate("2026-04-31"), "April 31 rejected");
  ok(!isRealIsoDate("2026-4-01"), "loose format rejected");
  ok(!isRealIsoDate(20261101), "non-string rejected");

  // Start date.
  ok(validateStartDate("2026-11-01", "2026-10-07").ok, "Nov 1 2026 accepted");
  ok(validateStartDate(" 2026-11-01 ", "2026-10-07").ok, "trimmed");
  {
    const c = validateStartDate("", "2026-10-07");
    ok(c.ok && c.value === "", "empty clears");
  }
  ok(!validateStartDate("2019-12-31", "2026-10-07").ok, "before 2020 rejected");
  ok(validateStartDate("2020-01-01", "2026-10-07").ok, "2020-01-01 accepted (bound)");
  ok(validateStartDate("2028-10-06", "2026-10-07").ok, "exactly 730 days ahead accepted");
  ok(!validateStartDate("2028-10-07", "2026-10-07").ok, "731 days ahead rejected");
  ok(!validateStartDate("2026-11-31", "2026-10-07").ok, "Nov 31 rejected");

  // Reason.
  ok(!validateReason("too short").ok, "9 chars rejected");
  ok(validateReason("Cultivera ").ok === false, "trailing space does not count (9 after trim)");
  ok(validateReason("Cultivera!").ok, "10 chars accepted");
  ok(!validateReason("x".repeat(501)).ok, "501 rejected");
  ok(validateReason("x".repeat(500)).ok, "500 accepted");
  ok(!validateReason(null).ok, "null rejected");
  {
    const c = validateReason("  filed by Cultivera  ");
    ok(c.ok && c.value === "filed by Cultivera", "reason is stored trimmed");
  }

  // Dismissal validity: weekly. Week W-2026-10-04 runs Oct 4-10.
  ok(!validateDismissal("ccrs_weekly", "W-2026-10-04", "2026-10-10").ok, "week not dismissable on its Saturday");
  ok(validateDismissal("ccrs_weekly", "W-2026-10-04", "2026-10-11").ok, "week dismissable the Sunday after");
  ok(!validateDismissal("ccrs_weekly", "W-2026-10-05", "2026-12-01").ok, "Monday-start week rejected");
  ok(!validateDismissal("ccrs_weekly", "W-2026-02-30", "2026-12-01").ok, "unreal week date rejected");
  ok(!validateDismissal("ccrs_weekly", "2026-10", "2026-12-01").ok, "monthly key on weekly rejected");
  // Monthly.
  ok(!validateDismissal("liq1295", "2026-10", "2026-10-31").ok, "month not dismissable on its last day");
  ok(validateDismissal("liq1295", "2026-10", "2026-11-01").ok, "month dismissable the day after");
  ok(!validateDismissal("liq1295", "2026-13", "2027-06-01").ok, "month 13 rejected");
  ok(!validateDismissal("liq1295", "2026-00", "2027-06-01").ok, "month 0 rejected");
  ok(!validateDismissal("liq1295", "W-2026-10-04", "2027-06-01").ok, "weekly key on monthly rejected");
  ok(!validateDismissal("dor_sales_tax", "2026-10", "2027-06-01").ok, "unknown obligation rejected");
  ok(validateDismissal("liq1295", "2024-02", "2024-03-01").ok, "leap Feb 2024 ends on the 29th");
  ok(!validateDismissal("liq1295", "2024-02", "2024-02-29").ok, "leap Feb 2024 not over on the 29th");

  // Rule 1 weekly.
  ok(weekBeforeStart("2026-10-31", "2026-11-01"), "week ending Oct 31 is before a Nov 1 start");
  ok(!weekBeforeStart("2026-11-07", "2026-11-01"), "week containing the start is required");
  ok(!weekBeforeStart("2026-11-07", "2026-11-04"), "week containing a midweek start is required");
  ok(!weekBeforeStart("2026-10-31", null), "no start date = required");
  ok(!weekBeforeStart("2026-11-01", "2026-11-01"), "week ending ON the start date is required");

  // Rule 1 monthly: July 2026 due 2026-08-20.
  ok(monthBeforeStartAndPastDue(2026, 7, "2026-08-20", "2026-10-07", "2026-11-01"), "July backlog quiet");
  ok(!monthBeforeStartAndPastDue(2026, 9, "2026-10-20", "2026-10-07", "2026-11-01"), "September still reminded before its due date");
  ok(!monthBeforeStartAndPastDue(2026, 9, "2026-10-20", "2026-10-20", "2026-11-01"), "due date itself still reminded");
  ok(monthBeforeStartAndPastDue(2026, 9, "2026-10-20", "2026-10-21", "2026-11-01"), "quiet the day after the due date");
  ok(!monthBeforeStartAndPastDue(2026, 11, "2026-12-21", "2027-01-05", "2026-11-01"), "first live month is never quiet");
  ok(!monthBeforeStartAndPastDue(2026, 10, "2026-11-20", "2026-11-25", "2026-10-31"), "month ending ON the start is required");
  ok(!monthBeforeStartAndPastDue(2026, 7, "2026-08-20", "2026-10-07", null), "no start date = never quiet");

  // Context building.
  {
    const ctx = buildContext("2026-11-01", [
      { id: "u-1", obligation: "ccrs_weekly", period_key: "W-2026-09-06", reason: "Filed by Cultivera", waived_at: "t", waived_by_email: "m@x" },
      { obligation: "ccrs_weekly", period_key: "W-2026-09-13", reason: "Revoked one", revoked_at: "t2" },
      { obligation: "bogus", period_key: "x", reason: "nope nope nope" },
      { obligation: "liq1295", period_key: 7, reason: "bad key type" },
    ]);
    ok(ctx.startDate === "2026-11-01", "start date read");
    ok(ctx.waivers.size === 1, `only the live valid waiver kept (got ${ctx.waivers.size})`);
    ok(ctx.waivers.get("ccrs_weekly:W-2026-09-06")?.waivedByEmail === "m@x", "waiver keyed by obligation:period");
    ok(!ctx.waivers.has("ccrs_weekly:W-2026-09-13"), "revoked waiver ignored");
    ok(ctx.waivers.get("ccrs_weekly:W-2026-09-06")?.id === "u-1", "row id carried for undo");
  }
  ok(buildContext("2026-02-30", []).startDate === null, "unreal start date ignored");
  ok(startDateFromSetting({ startDate: "2026-11-01" }) === "2026-11-01", "setting shape read");
  ok(startDateFromSetting({ startDate: "nope" }) === null, "bad setting ignored");
  ok(startDateFromSetting(null) === null, "missing setting ignored");
  ok(waiverKey("liq1295", "2026-07") === "liq1295:2026-07", "waiver key format");

  return { passed, failed };
}
