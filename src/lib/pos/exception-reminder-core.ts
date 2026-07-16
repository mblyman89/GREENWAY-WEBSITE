/**
 * exception-reminder-core.ts (Task AN-6)
 *
 * PURE planner for the daily "POS exceptions need review" reminder plus the
 * nav-badge count formatter. No imports, no I/O — unit-testable with tsx and
 * safe to import from client components (the badge formatter is used by the
 * admin top nav, which is "use client").
 *
 * WHY THIS EXISTS
 * ---------------
 * When the register syncs a sale the back office cannot record (unknown
 * loyalty code, missing product, malformed envelope…), the event is parked as
 * status="exception" instead of being processed. Every parked exception is a
 * sale whose money and traceability data are MISSING from reports, X/Z slips,
 * and CCRS extracts until a manager resolves it. Today the only surface is
 * the /admin/registers/exceptions page — if nobody opens it, exceptions age
 * silently. AN-6 adds:
 *   1. A daily reminder (email + push, riding the Task W engine) while ANY
 *      exception remains unresolved. Dedupe key is per Pacific day, so the
 *      reminder re-fires each day until the queue is empty, then goes quiet.
 *   2. A count badge on the admin nav so the queue is visible on every admin
 *      page, not just when someone thinks to look.
 *
 * CADENCE / DEDUPE
 * ----------------
 * dedupeKey = "pos-exceptions:<YYYY-MM-DD>" (Pacific). The Task W engine's
 * compliance_reminder_log has a UNIQUE constraint on dedupe_key, so a day's
 * reminder sends at most once no matter how often the cron re-runs. A new day
 * means a new key — unresolved exceptions nag daily, by design.
 *
 * URGENCY
 * -------
 * "warning" normally; "critical" once the OLDEST unresolved exception is
 * CRITICAL_AGE_DAYS (3) or more Pacific calendar days old — a sale that has
 * been off the books for days is a real compliance/accounting problem.
 *
 * NEVER GUESS: garbage counts collapse to "no reminder"; a malformed oldest
 * date is treated as unknown age (stays "warning", body omits the age) rather
 * than inventing a number.
 */

/** Deep-link target for both the email button and the push notification. */
export const POS_EXCEPTIONS_PATH = "/admin/registers/exceptions";

/** Oldest-exception age (Pacific calendar days) at which urgency escalates. */
export const CRITICAL_AGE_DAYS = 3;

export type PosExceptionSnapshot = {
  /** Unresolved exception count (status="exception", resolved_at null). */
  count: number;
  /**
   * Pacific day key (YYYY-MM-DD) of the OLDEST unresolved exception's
   * occurred_at, or null when unknown. The caller converts the timestamptz
   * with pacificDayKey() so this module stays pure.
   */
  oldestDayKey: string | null;
};

export type PosExceptionReminder = {
  dedupeKey: string;
  stage: "pos_exceptions_daily";
  weekKey: null;
  subject: string;
  body: string;
  urgency: "warning" | "critical";
  /** Overrides the Task W engine's default CCRS deep link. */
  linkPath: string;
  linkLabel: string;
  footnote: string;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function intOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0
    ? v
    : 0;
}

/**
 * Calendar-day difference between two YYYY-MM-DD labels (today - old).
 * Returns null when either label is malformed or the result would be
 * negative (an "oldest" date in the future is garbage — never guess).
 */
export function calendarDaysBetween(oldYmd: string, todayYmd: string): number | null {
  if (!YMD_RE.test(oldYmd) || !YMD_RE.test(todayYmd)) return null;
  const [oy, om, od] = oldYmd.split("-").map(Number);
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(oy, om - 1, od)) / 86400000);
  return diff >= 0 ? diff : null;
}

/**
 * Plan today's POS-exception reminder. Returns null when there is nothing
 * unresolved (or the inputs are garbage) — the engine simply plans nothing.
 */
export function planPosExceptionReminder(
  todayIso: string,
  snapshot: PosExceptionSnapshot,
): PosExceptionReminder | null {
  const count = intOrZero(snapshot?.count);
  if (count <= 0) return null;
  if (!YMD_RE.test(todayIso)) return null; // malformed clock — refuse to plan

  const ageDays =
    snapshot.oldestDayKey != null
      ? calendarDaysBetween(snapshot.oldestDayKey, todayIso)
      : null;

  const critical = ageDays != null && ageDays >= CRITICAL_AGE_DAYS;
  const plural = count === 1 ? "" : "s";
  const ageSentence =
    ageDays == null
      ? ""
      : ageDays === 0
        ? " The oldest arrived today."
        : ` The oldest has been waiting ${ageDays} day${ageDays === 1 ? "" : "s"}.`;

  return {
    dedupeKey: `pos-exceptions:${todayIso}`,
    stage: "pos_exceptions_daily",
    weekKey: null,
    subject: critical
      ? `OVERDUE: ${count} register exception${plural} awaiting manager review`
      : `${count} register exception${plural} awaiting manager review`,
    body:
      `${count} register sale event${plural} could not be recorded by the back office ` +
      `and ${count === 1 ? "is" : "are"} parked as exception${plural}.` +
      ageSentence +
      ` Until each one is resolved, that sale's money and traceability data are missing ` +
      `from reports, X/Z slips, and CCRS extracts. Open Register Activity → Exceptions ` +
      `to review and resolve them.`,
    urgency: critical ? "critical" : "warning",
    linkPath: POS_EXCEPTIONS_PATH,
    linkLabel: "Open the Exception Queue",
    footnote:
      "This is an automated Greenway register reminder; it repeats daily until every " +
      "exception is resolved.",
  };
}

/**
 * Nav-badge label for a pending count. Null when there is nothing to show
 * (zero / negative / garbage — the badge simply doesn't render). Caps at
 * "99+" so the chip can't blow up the tab bar.
 */
export function formatBadgeCount(count: unknown): string | null {
  const n = intOrZero(count);
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runExceptionReminderCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // calendarDaysBetween
  eq(calendarDaysBetween("2026-02-10", "2026-02-13"), 3, "3 days apart");
  eq(calendarDaysBetween("2026-02-13", "2026-02-13"), 0, "same day");
  eq(calendarDaysBetween("2026-02-14", "2026-02-13"), null, "future oldest is garbage");
  eq(calendarDaysBetween("garbage", "2026-02-13"), null, "malformed old");
  eq(calendarDaysBetween("2026-01-31", "2026-02-02"), 2, "month boundary");

  // planPosExceptionReminder — nothing pending / garbage inputs
  eq(planPosExceptionReminder("2026-02-13", { count: 0, oldestDayKey: null }), null, "zero count");
  eq(
    planPosExceptionReminder("2026-02-13", { count: -4 as number, oldestDayKey: null }),
    null,
    "negative count",
  );
  eq(
    planPosExceptionReminder("2026-02-13", { count: 2.5 as number, oldestDayKey: null }),
    null,
    "fractional count",
  );
  eq(
    planPosExceptionReminder("not-a-date", { count: 3, oldestDayKey: null }),
    null,
    "malformed today refuses to plan",
  );

  // Fresh exception (same day) → warning, daily dedupe key, deep link
  const fresh = planPosExceptionReminder("2026-02-13", {
    count: 1,
    oldestDayKey: "2026-02-13",
  });
  ok(fresh != null, "fresh plans");
  eq(fresh!.dedupeKey, "pos-exceptions:2026-02-13", "daily dedupe key");
  eq(fresh!.urgency, "warning", "fresh is warning");
  eq(fresh!.stage, "pos_exceptions_daily", "stage");
  eq(fresh!.linkPath, POS_EXCEPTIONS_PATH, "deep link to exceptions queue");
  ok(fresh!.subject.includes("1 register exception awaiting"), "singular subject");
  ok(fresh!.body.includes("oldest arrived today"), "same-day age sentence");
  ok(fresh!.body.includes("missing"), "explains money is off the books");

  // Aged ≥3 days → critical + OVERDUE subject
  const aged = planPosExceptionReminder("2026-02-13", {
    count: 4,
    oldestDayKey: "2026-02-10",
  });
  eq(aged!.urgency, "critical", "3-day-old is critical");
  ok(aged!.subject.startsWith("OVERDUE:"), "overdue subject prefix");
  ok(aged!.subject.includes("4 register exceptions"), "plural subject");
  ok(aged!.body.includes("waiting 3 days"), "age sentence");

  // 2 days old → still warning (threshold is ≥3)
  const twoDays = planPosExceptionReminder("2026-02-13", {
    count: 2,
    oldestDayKey: "2026-02-11",
  });
  eq(twoDays!.urgency, "warning", "2 days is still warning");

  // Unknown oldest → warning, no invented age
  const unknownAge = planPosExceptionReminder("2026-02-13", {
    count: 7,
    oldestDayKey: "garbage",
  });
  eq(unknownAge!.urgency, "warning", "unknown age never escalates");
  ok(!unknownAge!.body.includes("waiting"), "no invented age sentence");

  // formatBadgeCount
  eq(formatBadgeCount(0), null, "badge hidden at zero");
  eq(formatBadgeCount(-3), null, "badge hidden negative");
  eq(formatBadgeCount("7"), null, "badge hidden for non-number garbage");
  eq(formatBadgeCount(1), "1", "badge 1");
  eq(formatBadgeCount(99), "99", "badge 99");
  eq(formatBadgeCount(100), "99+", "badge caps at 99+");

  console.log(`exception-reminder-core: PASSED ${passed} assertions`);
}
