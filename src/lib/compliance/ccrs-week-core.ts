/**
 * src/lib/compliance/ccrs-week-core.ts  (Task W)
 *
 * PURE weekly CCRS reporting-deadline engine + reminder planner for the
 * Compliance Reporting Command Center. Zero I/O, no `server-only`; tsx-testable.
 *
 * VERIFIED FACTS (WSLCB CCRS FAQ + Upload User Guide, June 2025 — see
 * docs/CCRS_COMMAND_CENTER_RESEARCH.md §2):
 *   • The CCRS reporting week is SUNDAY through SATURDAY.
 *   • Each week's activity is due "no later than Sunday for the previous week"
 *     — i.e. the day AFTER the week ends (weekEnd + 1 day).
 *   • Reporting more frequently than weekly is allowed.
 *   • If there is NOTHING new to report, no upload is required and no
 *     "no change" report exists — so a week can be resolved EITHER by a
 *     submission OR by an explicit, logged "nothing to report" verification.
 *   • Deadlines are Pacific wall-clock dates (CCRS filenames reference PST);
 *     callers must pass `todayIso` derived from Pacific time
 *     (src/lib/reports/timezone.ts pacificToday()), never UTC.
 *
 * Week keys use the SAME `W-YYYY-MM-DD` (week-start Sunday) convention as the
 * S-18 compliance calendar (compliance-calendar-core.ts pendingPeriodFor), so a
 * sign-off recorded in either place can be correlated.
 */

// ── Plain ISO-date helpers (UTC-anchored math on Y-M-D strings) ─────────────

const DAY_MS = 86_400_000;

function parseIsoDate(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add whole days to a YYYY-MM-DD date. PURE. */
export function addDaysIso(iso: string, days: number): string {
  const t = parseIsoDate(iso);
  if (t === null) return iso;
  return toIso(t + days * DAY_MS);
}

/** Day-of-week 0=Sunday … 6=Saturday for a YYYY-MM-DD date. PURE. */
export function isoWeekday(iso: string): number {
  const t = parseIsoDate(iso);
  return t === null ? 0 : new Date(t).getUTCDay();
}

/** Signed whole-day difference a − b. PURE. */
export function isoDayDiff(aIso: string, bIso: string): number {
  const a = parseIsoDate(aIso);
  const b = parseIsoDate(bIso);
  if (a === null || b === null) return 0;
  return Math.round((a - b) / DAY_MS);
}

// ── Reporting weeks ─────────────────────────────────────────────────────────

/** A Sunday–Saturday CCRS reporting week. All fields are YYYY-MM-DD. */
export type CcrsWeek = {
  /** Sunday the week starts. */
  start: string;
  /** Saturday the week ends. */
  end: string;
  /** Statutory latest submission day: the Sunday AFTER `end` (end + 1). */
  due: string;
  /** Stable key, `W-YYYY-MM-DD` of the week-start Sunday (calendar-compatible). */
  key: string;
};

/** The Sunday on/before the given date. PURE. */
export function weekStartFor(dateIso: string): string {
  return addDaysIso(dateIso, -isoWeekday(dateIso));
}

/** Build the CcrsWeek whose start-Sunday is `startIso` (must be a Sunday). PURE. */
export function weekFromStart(startIso: string): CcrsWeek {
  const start = weekStartFor(startIso); // normalize defensively
  const end = addDaysIso(start, 6);
  return { start, end, due: addDaysIso(end, 1), key: `W-${start}` };
}

/** The week CONTAINING `dateIso` (may still be in progress). PURE. */
export function weekContaining(dateIso: string): CcrsWeek {
  return weekFromStart(weekStartFor(dateIso));
}

/**
 * The most recently COMPLETED Sun–Sat week as of `todayIso` — the week whose
 * report is currently owed. On a Sunday this is the week that ended yesterday
 * (its report is due TODAY). PURE.
 */
export function lastCompletedWeek(todayIso: string): CcrsWeek {
  return weekFromStart(addDaysIso(weekStartFor(todayIso), -7));
}

/** `W-YYYY-MM-DD` key → CcrsWeek (null when malformed). PURE. */
export function weekFromKey(key: string): CcrsWeek | null {
  if (!/^W-\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const start = key.slice(2);
  if (parseIsoDate(start) === null || isoWeekday(start) !== 0) return null;
  return weekFromStart(start);
}

// ── Week status ─────────────────────────────────────────────────────────────

/**
 * How a completed week was resolved. Per the LCB FAQ, a week with no new
 * activity requires NO upload — but recording that someone VERIFIED there was
 * nothing to report is what makes the ledger audit-defensible.
 */
export type WeekResolution = "submitted" | "nothing_to_report";

export type WeekStatus =
  | "in_progress" // the week is still running (its report isn't owed yet)
  | "open" // completed, before the due day (early submission window)
  | "due_today" // today IS the due Sunday and the week is unresolved
  | "overdue" // past the due Sunday and unresolved
  | "submitted" // resolved: files uploaded to CCRS
  | "nothing_to_report"; // resolved: verified no new activity that week

export type WeekDeadline = {
  week: CcrsWeek;
  status: WeekStatus;
  /** Signed days from today to the due date (negative once overdue). */
  daysUntilDue: number;
  resolution: WeekResolution | null;
};

/**
 * Status of one week relative to `todayIso` given its resolution (or null).
 * PURE.
 */
export function weekDeadline(
  week: CcrsWeek,
  todayIso: string,
  resolution: WeekResolution | null,
): WeekDeadline {
  const daysUntilDue = isoDayDiff(week.due, todayIso);
  let status: WeekStatus;
  if (resolution === "submitted") status = "submitted";
  else if (resolution === "nothing_to_report") status = "nothing_to_report";
  else if (todayIso <= week.end) status = "in_progress";
  else if (daysUntilDue > 0) status = "open";
  else if (daysUntilDue === 0) status = "due_today";
  else status = "overdue";
  return { week, status, daysUntilDue, resolution };
}

export type WeeklyOverview = {
  /** The in-progress week (today inside it) — informational, never owed yet. */
  current: WeekDeadline;
  /** Completed weeks, newest first (`lookbackWeeks` of them). */
  weeks: WeekDeadline[];
  /** The single most urgent unresolved completed week (oldest overdue first). */
  mostUrgent: WeekDeadline | null;
  overdueCount: number;
  allClear: boolean;
};

/**
 * Deadline picture for the last `lookbackWeeks` completed weeks plus the
 * in-progress week. `resolutions` maps week key → how it was resolved. The
 * most urgent unresolved week is the one overdue the LONGEST (deepest
 * compliance exposure), mirroring the monthly engine's convention. PURE.
 */
export function weeklyDeadlineOverview(
  todayIso: string,
  resolutions: ReadonlyMap<string, WeekResolution> | Record<string, WeekResolution>,
  opts?: { lookbackWeeks?: number },
): WeeklyOverview {
  const lookback = Math.max(1, Math.min(26, opts?.lookbackWeeks ?? 4));
  const get = (key: string): WeekResolution | null => {
    if (resolutions instanceof Map) return resolutions.get(key) ?? null;
    return (resolutions as Record<string, WeekResolution>)[key] ?? null;
  };

  const current = weekDeadline(weekContaining(todayIso), todayIso, get(weekContaining(todayIso).key));

  const weeks: WeekDeadline[] = [];
  let start = addDaysIso(weekStartFor(todayIso), -7);
  for (let i = 0; i < lookback; i += 1) {
    const wk = weekFromStart(start);
    weeks.push(weekDeadline(wk, todayIso, get(wk.key)));
    start = addDaysIso(start, -7);
  }

  const unresolved = weeks.filter(
    (w) => w.status === "open" || w.status === "due_today" || w.status === "overdue",
  );
  // Oldest (most-negative daysUntilDue) first.
  const mostUrgent =
    unresolved.length > 0
      ? unresolved.reduce((a, b) => (b.daysUntilDue < a.daysUntilDue ? b : a))
      : null;
  const overdueCount = weeks.filter((w) => w.status === "overdue").length;

  return { current, weeks, mostUrgent, overdueCount, allClear: unresolved.length === 0 };
}

// ── Reminder planner ────────────────────────────────────────────────────────

/**
 * The reminder cadence the owner asked for ("no way we could ever miss the
 * upload deadlines"). Evaluated once per day (cron) against Pacific `todayIso`:
 *   • thursday_heads_up — Thursday of the in-progress week: deadline preview.
 *   • saturday_wrap     — Saturday: the reporting week closes tonight.
 *   • sunday_due        — the due Sunday while the owed week is unresolved.
 *   • overdue_daily     — EVERY day after the due date while unresolved.
 * Each reminder carries a dedupe key so a re-run cron can never double-send.
 */
export type ReminderStage = "thursday_heads_up" | "saturday_wrap" | "sunday_due" | "overdue_daily";

export type PlannedReminder = {
  stage: ReminderStage;
  /** Week the reminder is about. */
  weekKey: string;
  /** Unique send-once key. overdue_daily includes the date so it repeats daily. */
  dedupeKey: string;
  /** Plain-language subject line seed. */
  subject: string;
  /** Plain-language body seed (the sender may add links/formatting). */
  body: string;
  urgency: "info" | "warning" | "critical";
};

/**
 * Which weekly reminders should fire on `todayIso` given the resolution map.
 * Deterministic + idempotent per day. PURE.
 */
export function planWeeklyReminders(
  todayIso: string,
  resolutions: ReadonlyMap<string, WeekResolution> | Record<string, WeekResolution>,
  opts?: { lookbackWeeks?: number },
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const dow = isoWeekday(todayIso);
  const overview = weeklyDeadlineOverview(todayIso, resolutions, opts);

  if (dow === 4) {
    // Thursday heads-up about the running week.
    const wk = overview.current.week;
    out.push({
      stage: "thursday_heads_up",
      weekKey: wk.key,
      dedupeKey: `thursday_heads_up:${wk.key}`,
      subject: `CCRS heads-up: reporting week ends Saturday ${wk.end}`,
      body:
        `The current CCRS reporting week (${wk.start} – ${wk.end}) closes Saturday. ` +
        `The upload deadline is Sunday ${wk.due}. You can generate and upload the batch early from the Compliance Command Center.`,
      urgency: "info",
    });
  }

  if (dow === 6) {
    // Saturday wrap — the week closes tonight.
    const wk = overview.current.week;
    out.push({
      stage: "saturday_wrap",
      weekKey: wk.key,
      dedupeKey: `saturday_wrap:${wk.key}`,
      subject: `CCRS reporting week closes tonight (${wk.end})`,
      body:
        `Tonight ends the CCRS reporting week ${wk.start} – ${wk.end}. ` +
        `Upload the week's CSVs to CCRS by Sunday ${wk.due}, or record "nothing to report" in the Command Center if there was no new activity.`,
      urgency: "warning",
    });
  }

  for (const w of overview.weeks) {
    if (w.status === "due_today") {
      out.push({
        stage: "sunday_due",
        weekKey: w.week.key,
        dedupeKey: `sunday_due:${w.week.key}`,
        subject: `CCRS weekly report DUE TODAY (week ${w.week.start} – ${w.week.end})`,
        body:
          `Today (${w.week.due}) is the deadline for the CCRS week ${w.week.start} – ${w.week.end}. ` +
          `Generate, validate and upload the batch at cannabisreporting.lcb.wa.gov, then record the submission — ` +
          `or record "nothing to report" if there was no new activity.`,
        urgency: "critical",
      });
    } else if (w.status === "overdue") {
      out.push({
        stage: "overdue_daily",
        weekKey: w.week.key,
        dedupeKey: `overdue_daily:${w.week.key}:${todayIso}`,
        subject: `⚠ CCRS weekly report OVERDUE by ${Math.abs(w.daysUntilDue)} day(s) — week ${w.week.start} – ${w.week.end}`,
        body:
          `The CCRS report for week ${w.week.start} – ${w.week.end} was due ${w.week.due} and is not on record. ` +
          `Upload it immediately, then record the submission in the Command Center. ` +
          `If there was genuinely nothing to report, record that instead so the ledger is complete.`,
        urgency: "critical",
      });
    }
  }

  return out;
}

// ── Self-tests (tsx / vitest) ───────────────────────────────────────────────

export function __runCcrsWeekTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // Date helpers.
  ok(addDaysIso("2026-01-31", 1) === "2026-02-01", "addDaysIso rolls month");
  ok(addDaysIso("2024-02-28", 1) === "2024-02-29", "addDaysIso leap Feb");
  ok(isoWeekday("2026-01-11") === 0, "2026-01-11 is a Sunday");
  ok(isoWeekday("2026-01-10") === 6, "2026-01-10 is a Saturday");
  ok(isoDayDiff("2026-01-11", "2026-01-10") === 1, "day diff");

  // Week construction.
  {
    const wk = weekContaining("2026-01-14"); // Wednesday
    ok(wk.start === "2026-01-11" && wk.end === "2026-01-17", `week containing Wed (got ${wk.start}..${wk.end})`);
    ok(wk.due === "2026-01-18", `due is Sunday AFTER week end (got ${wk.due})`);
    ok(wk.key === "W-2026-01-11", "week key format");
  }
  // A Sunday belongs to the week it STARTS.
  {
    const wk = weekContaining("2026-01-11");
    ok(wk.start === "2026-01-11", "Sunday starts its own week");
  }
  // A Saturday belongs to the week it ENDS.
  {
    const wk = weekContaining("2026-01-17");
    ok(wk.start === "2026-01-11" && wk.end === "2026-01-17", "Saturday ends its week");
  }

  // lastCompletedWeek: on Wednesday 2026-01-14, the owed week is Jan 4–10, due Jan 11.
  {
    const wk = lastCompletedWeek("2026-01-14");
    ok(wk.start === "2026-01-04" && wk.end === "2026-01-10" && wk.due === "2026-01-11", "lastCompletedWeek midweek");
  }
  // On the due Sunday itself (Jan 11), the owed week ended yesterday (Jan 10) — due TODAY.
  {
    const wk = lastCompletedWeek("2026-01-11");
    ok(wk.end === "2026-01-10" && wk.due === "2026-01-11", "on Sunday the owed week is due today");
  }

  // weekFromKey round-trip + rejection.
  ok(weekFromKey("W-2026-01-11")?.end === "2026-01-17", "weekFromKey round-trips");
  ok(weekFromKey("W-2026-01-12") === null, "weekFromKey rejects a non-Sunday start");
  ok(weekFromKey("2026-01-11") === null, "weekFromKey rejects missing prefix");
  ok(weekFromKey("W-2026-13-99") === null, "weekFromKey rejects garbage date");

  // Status transitions for week Jan 4–10 (due Sunday Jan 11).
  {
    const wk = weekFromStart("2026-01-04");
    ok(weekDeadline(wk, "2026-01-07", null).status === "in_progress", "in progress midweek");
    ok(weekDeadline(wk, "2026-01-10", null).status === "in_progress", "in progress on closing Saturday");
    ok(weekDeadline(wk, "2026-01-11", null).status === "due_today", "due on the following Sunday");
    ok(weekDeadline(wk, "2026-01-12", null).status === "overdue", "overdue Monday");
    ok(weekDeadline(wk, "2026-01-12", null).daysUntilDue === -1, "overdue by 1 day");
    ok(weekDeadline(wk, "2026-01-12", "submitted").status === "submitted", "submitted overrides");
    ok(
      weekDeadline(wk, "2026-01-12", "nothing_to_report").status === "nothing_to_report",
      "nothing_to_report overrides",
    );
  }

  // Overview: Wednesday Jan 14; last week (Jan 4–10) unresolved = overdue by 3;
  // older week (Dec 28–Jan 3) submitted.
  {
    const o = weeklyDeadlineOverview(
      "2026-01-14",
      { "W-2025-12-28": "submitted" },
      { lookbackWeeks: 3 },
    );
    ok(o.current.week.start === "2026-01-11" && o.current.status === "in_progress", "current week in progress");
    ok(o.weeks[0].week.start === "2026-01-04" && o.weeks[0].status === "overdue", "newest completed week overdue");
    ok(o.weeks[1].status === "submitted", "prior week submitted");
    ok(o.weeks[2].status === "overdue", "oldest lookback week unresolved = overdue");
    ok(o.mostUrgent?.week.start === "2025-12-21", "most urgent = OLDEST overdue");
    ok(o.overdueCount === 2 && !o.allClear, "overdue count + not all clear");
  }
  // All clear when every completed week is resolved.
  {
    const o = weeklyDeadlineOverview(
      "2026-01-14",
      {
        "W-2026-01-04": "submitted",
        "W-2025-12-28": "nothing_to_report",
        "W-2025-12-21": "submitted",
        "W-2025-12-14": "submitted",
      },
      { lookbackWeeks: 4 },
    );
    ok(o.allClear && o.mostUrgent === null && o.overdueCount === 0, "all clear");
  }
  // Resolutions accepted as a Map too.
  {
    const m = new Map<string, WeekResolution>([["W-2026-01-04", "submitted"]]);
    const o = weeklyDeadlineOverview("2026-01-14", m, { lookbackWeeks: 1 });
    ok(o.weeks[0].status === "submitted", "Map resolutions work");
  }

  // Reminder planner.
  // Thursday 2026-01-15 → heads-up about current week (Jan 11–17) + overdue_daily for Jan 4–10.
  {
    const r = planWeeklyReminders("2026-01-15", {}, { lookbackWeeks: 2 });
    ok(r.some((x) => x.stage === "thursday_heads_up" && x.weekKey === "W-2026-01-11"), "Thursday heads-up fires");
    ok(r.some((x) => x.stage === "overdue_daily" && x.weekKey === "W-2026-01-04"), "overdue reminder fires Thursday");
    ok(!r.some((x) => x.stage === "sunday_due"), "no due-today on Thursday");
  }
  // Saturday 2026-01-17 → wrap.
  {
    const r = planWeeklyReminders("2026-01-17", { "W-2026-01-04": "submitted", "W-2025-12-28": "submitted" }, { lookbackWeeks: 2 });
    ok(r.length === 1 && r[0].stage === "saturday_wrap" && r[0].weekKey === "W-2026-01-11", "Saturday wrap only");
  }
  // Sunday 2026-01-18 → due_today for the week that just ended (Jan 11–17).
  {
    const r = planWeeklyReminders("2026-01-18", { "W-2026-01-04": "submitted" }, { lookbackWeeks: 2 });
    ok(r.some((x) => x.stage === "sunday_due" && x.weekKey === "W-2026-01-11"), "Sunday due-today fires");
    ok(r.find((x) => x.stage === "sunday_due")?.urgency === "critical", "due-today is critical");
  }
  // Resolved week ⇒ silent Sunday.
  {
    const r = planWeeklyReminders(
      "2026-01-18",
      { "W-2026-01-11": "nothing_to_report", "W-2026-01-04": "submitted" },
      { lookbackWeeks: 2 },
    );
    ok(!r.some((x) => x.stage === "sunday_due"), "no due-today when resolved");
  }
  // overdue_daily dedupe key includes the date (repeats daily); others don't.
  {
    const a = planWeeklyReminders("2026-01-19", {}, { lookbackWeeks: 1 });
    const b = planWeeklyReminders("2026-01-20", {}, { lookbackWeeks: 1 });
    const ka = a.find((x) => x.stage === "overdue_daily")?.dedupeKey ?? "";
    const kb = b.find((x) => x.stage === "overdue_daily")?.dedupeKey ?? "";
    ok(ka !== "" && kb !== "" && ka !== kb, "overdue_daily dedupe key varies by day");
    ok(ka.includes("2026-01-19"), "dedupe key embeds the date");
  }

  if (failed === 0) console.log(`ccrs-week-core: all ${passed} tests passed`);
  return { passed, failed };
}
