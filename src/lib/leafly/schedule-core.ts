/**
 * src/lib/leafly/schedule-core.ts  (SLICE L-7)
 *
 * The PURE decision layer for automatic Leafly menu syncing.
 *
 * WHY THIS SLICE EXISTS
 * ---------------------
 * Slice L-4 measured that `vercel.json` declares exactly three crons (compliance
 * reminders, regulatory watch, ATM sync) and none of them touches Leafly. So
 * until now the ONLY thing that ever pushed the menu was a person clicking a
 * button. That is a certification blocker, not a nicety:
 *
 *   - Leafly's checklist criterion 3 grades "Sync cadence: (recommended) daily
 *     full POST + PUT/DELETE for intraday changes, or full POST several times
 *     per hour" (quoted from `certification-core.ts`, itself taken from
 *     Leafly's own checklist).
 *   - Criterion 4 disqualifies request signatures that look hand-driven.
 *
 * A button-only integration fails both. The owner asked for BOTH automation and
 * the manual button, which is exactly right: the schedule satisfies Leafly, and
 * the button is what you reach for when you have just changed a price and do not
 * want to wait.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It performs no I/O, reads no clock of its own, and sends nothing. Every
 * decision is a pure function of its inputs, including `now`, so the tests can
 * put the clock anywhere. The caller (`/api/cron/leafly-menu-sync`) supplies
 * reality; this file only ever decides.
 *
 * Rule 11 compliance: the schedule SETTINGS live on the existing
 * `LeaflySyncSettings` type in `src/lib/syndication/sync-settings-core.ts`, and
 * the actual pushing is done by the existing `pushLeaflyMenu()` in
 * `src/lib/leafly/push.ts`. Nothing here re-implements either. This file decides
 * *whether* and *which method*, and the rest is someone else's already-tested job.
 *
 * Rule 9 compliance: every schedule decision is made in Pacific wall-clock time
 * using the existing `pacificParts()` helper, because "the daily full sync runs
 * at 4am" means 4am in Ruston, Washington, not 4am UTC. This matters twice a
 * year, and the twice-a-year bug is the one nobody catches.
 */
import { pacificParts } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// 1. What a sync run is, and what can stop one
// ---------------------------------------------------------------------------

/**
 * The two HTTP methods Leafly's Menu Integration API v2 accepts for a menu
 * write, as already implemented by `pushLeaflyMenu()`:
 *
 *   POST = full sync. Leafly DELETES anything omitted from the payload. This is
 *          the authoritative "the menu is exactly this" statement.
 *   PUT  = upsert only. Creates and updates; omissions are left alone. Our push
 *          layer follows a PUT with an explicit DELETE for items that left the
 *          feed, so PUT is still correct, just narrower per request.
 */
export type SyncMethod = "POST" | "PUT";

/**
 * Why a scheduled tick did something, or refused to. This is a closed
 * vocabulary so the UI and the audit log cannot invent wording, and so a new
 * reason must be added here (and therefore tested) before it can be reported.
 */
export type ScheduledRunCode =
  // --- the run should proceed ---
  | "daily_full" // the once-a-day authoritative POST
  | "intraday_delta" // a PUT for changes since the last run
  // --- the run should not proceed, and this is normal ---
  | "disabled" // the owner has automation switched off
  | "not_due" // nothing is scheduled for this tick
  | "quiet_hours" // outside the owner's configured active window
  // --- the run should not proceed, and something is wrong ---
  | "not_configured" // no credentials, so a push would 401
  | "manual_in_flight" // a person is pushing right now
  | "run_in_flight" // a previous scheduled run has not finished
  | "cooldown" // too soon after the previous run
  | "backoff"; // consecutive failures; deliberately slowing down

export type ScheduledRunDecision = {
  /** Should the caller actually call `pushLeaflyMenu()`? */
  shouldRun: boolean;
  /** Which method, when `shouldRun`. `null` when not running. */
  method: SyncMethod | null;
  code: ScheduledRunCode;
  /**
   * One sentence, written for the owner rather than for a log file. Never
   * contains a value this module had to guess.
   */
  reason: string;
  /**
   * True when the decision reflects a problem the owner can fix, as opposed to
   * the schedule simply not being due. Drives whether the UI shows a warning
   * tone or a calm one. `disabled` is deliberately NOT a problem: switching
   * automation off is a legitimate choice, and nagging about a deliberate
   * setting trains people to ignore warnings.
   */
  needsAttention: boolean;
};

// ---------------------------------------------------------------------------
// 2. Bounds — every one of these is a clamp, not a guess
// ---------------------------------------------------------------------------

/**
 * How often the intraday delta may run, in minutes. The lower bound is not
 * arbitrary: Leafly's own documented cadence tops out at "full POST several
 * times per hour", so 15 minutes (4/hour) sits inside their recommendation
 * while still being responsive enough that a price change reaches shoppers
 * within a quarter of an hour.
 *
 * The upper bound of 24 hours exists so that "intraday" cannot be configured to
 * mean "less often than the daily full sync", which would be incoherent.
 */
export const INTRADAY_MINUTES_MIN = 15;
export const INTRADAY_MINUTES_MAX = 1440;
export const INTRADAY_MINUTES_DEFAULT = 60;

/**
 * The daily full POST hour, in Pacific time, 0-23.
 *
 * Default 4am: after the shop is closed (so the menu is stable and no staff
 * member is mid-edit), and before it opens (so shoppers see a fresh
 * authoritative menu). Deliberately NOT midnight, because midnight is when
 * every other system in the world runs its jobs and Leafly's API is shared
 * infrastructure.
 */
export const DAILY_HOUR_MIN = 0;
export const DAILY_HOUR_MAX = 23;
export const DAILY_HOUR_DEFAULT = 4;

/**
 * Minimum gap between ANY two scheduled runs, regardless of configuration.
 * This is a floor the owner cannot configure away, because the cost of getting
 * it wrong lands on Leafly's API and on our certification, not on us.
 */
export const MIN_RUN_GAP_MINUTES = 10;

/**
 * After this many consecutive failures the scheduler backs off. Chosen to be
 * larger than `maxRetries` (default 3 in `sync-settings-core.ts`) so that
 * transient retry-able failures are handled by the push layer, and this backoff
 * only engages for something genuinely persistent.
 */
export const BACKOFF_AFTER_FAILURES = 3;

/**
 * How long to back off, per consecutive failure beyond the threshold, capped.
 * Linear rather than exponential on purpose: an exponential backoff on a daily
 * menu sync reaches "next week" almost immediately, and a menu that is a week
 * stale is worse than one that retries hourly and logs loudly.
 */
export const BACKOFF_MINUTES_PER_FAILURE = 30;
export const BACKOFF_MINUTES_MAX = 240;

/**
 * If the authoritative full sync has not happened for this many hours, run it on
 * the very next tick WHATEVER the hour.
 *
 * THIS CONSTANT EXISTS BECAUSE OF A MEASURED PLATFORM LIMIT, NOT A PREFERENCE.
 *
 * Vercel's cron documentation (read 2026-09-18, page last updated 2026-07-15)
 * states that Hobby accounts are "limited to cron jobs that run once per day"
 * and that "cron expressions that would run more frequently will fail during
 * deployment". `docs/CRYPTO_PORTFOLIO_BIBLE.md` records this project as Vercel
 * Hobby, and all three existing crons in `vercel.json` are once-daily, which
 * corroborates it. So in production this scheduler gets ONE tick per day.
 *
 * SLICE L-34 UPDATE: the project is now on Vercel Pro and the menu-sync cron
 * ticks every fifteen minutes, so every Pacific hour is visited and the hour
 * preference below is normally what triggers the full sync. This constant is
 * KEPT, unchanged, as the safety net for the cases that remain: Vercel
 * describes cron delivery as best effort, a deployment or Instant Rollback
 * can interrupt ticks, and the owner may change the hour. The reasoning below
 * is the original Hobby-era record and is still correct as a worst case.
 *
 * With one tick per day, an `hour >= dailyFullHour` test is a trap:
 *
 *   - Vercel cron expressions are UTC, and Pacific is UTC-7 in summer but
 *     UTC-8 in winter. A fixed UTC hour therefore lands an hour EARLIER in
 *     Pacific each winter.
 *   - Hobby scheduling precision is documented as per-hour, "+-59 min", so the
 *     tick can arrive up to an hour late.
 *   - And the owner can set `dailyFullHour` to any hour he likes.
 *
 * Any of those three can put the single daily tick just BELOW the configured
 * hour. The hour test would then refuse, there would be no second tick to catch
 * it, and the daily full sync would silently never run again -- the menu would
 * quietly freeze while the UI reported everything as fine. That is the worst
 * class of bug this system could have.
 *
 * So the hour is treated as a PREFERENCE ("run at about 4am") and this is the
 * GUARANTEE ("but never let a day pass without the authoritative sync"). 20
 * hours rather than 24 so that a tick arriving slightly earlier than yesterday's
 * -- which DST and the +-59 min precision both cause -- still counts as due.
 */
export const DAILY_CATCHUP_HOURS = 20;

/**
 * A run older than this is treated as abandoned rather than in-flight. Vercel
 * serverless functions are killed at their `maxDuration`, and a process killed
 * mid-run cannot clear its own lock. Without a staleness cutoff, one crash would
 * disable automatic syncing permanently and silently — which is the exact
 * failure mode that makes people distrust automation.
 *
 * 30 minutes is far beyond any plausible menu push (the manual button completes
 * in seconds) while still being short enough that a crash self-heals within one
 * hourly cycle.
 */
export const STALE_RUN_MINUTES = 30;

/**
 * SLICE L-34. How early an intraday delta may run relative to its interval.
 *
 * Two minutes. Without it, a cron tick interval EQUAL to the owner's setting
 * (15-minute ticks, 15-minute setting) pushes only every OTHER tick: the
 * previous run's `started_at` is stamped a few seconds after its tick fired,
 * so the next tick measures 14m55s and refuses as "not due". Vercel documents
 * Pro cron precision as "within the minute specified", plus function start-up
 * latency on top — so a tolerance of two minutes absorbs both, measured
 * rather than guessed. It can never breach the hard floor: the smallest
 * interval the owner can choose (INTRADAY_MINUTES_MIN = 15) minus this is 13,
 * which is still above MIN_RUN_GAP_MINUTES (10), and that floor is checked
 * separately and first anyway.
 */
export const INTRADAY_DUE_TOLERANCE_MINUTES = 2;

/**
 * SLICE L-34. How often a ROUTINE refusal is written to the run log.
 *
 * Sixty minutes. On Vercel Hobby the cron ticked once a day, so writing one
 * "stood down" row per tick cost one row a day. On Pro it ticks every fifteen
 * minutes, and the same rule would write 96 rows a day — nearly all "not due
 * yet" — and the integrations page, which shows the last ten runs, would show
 * two and a half hours of "Stood down" and push every real sync off the screen.
 *
 * So a routine refusal (one the owner need not act on) is recorded only when
 * the newest row is older than this, or is a DIFFERENT refusal. A real run
 * younger than this already proves the cron is alive, so the "cooldown" and
 * "not due" ticks that follow it are not written. That keeps an HOURLY
 * HEARTBEAT — proof the cron is still alive, which is what the refusal row
 * was for — without drowning the history. Refusals that need attention (not
 * configured, backoff) are written as soon as they appear, then hourly.
 */
export const REFUSAL_HEARTBEAT_MINUTES = 60;

// ---------------------------------------------------------------------------
// 3. Settings, clamped
// ---------------------------------------------------------------------------

export type LeaflyScheduleSettings = {
  /** Master switch. Off = the cron does nothing and says so calmly. */
  enabled: boolean;
  /** Pacific hour (0-23) for the authoritative daily full POST. */
  dailyFullHour: number;
  /** Run a delta PUT between daily syncs. */
  intradayEnabled: boolean;
  /** Minutes between intraday delta runs. */
  intradayMinutes: number;
  /**
   * Optional active window in Pacific hours, inclusive start, exclusive end.
   * `null` means "all day". Intraday runs are skipped outside it; the daily
   * full sync is NOT, because it is the authoritative statement and is usually
   * configured for the small hours on purpose.
   */
  activeFromHour: number | null;
  activeToHour: number | null;
  /**
   * SLICE L-41. Apply the size repair before each automatic send -- the SAME
   * repair as the "Fix the size problem automatically before sending" tick
   * box on "Send my whole menu, hold back only the bad ones".
   *
   * Automatic runs build their payload exactly the way that panel does
   * (`buildFullMenuDecision`), so the owner's answer to "does the repair run"
   * has to be stored somewhere the cron can read without a person present.
   * OFF by default for the reason the panel gives: stage 2 of the repair can
   * show one product as several listings, which is a change to what shoppers
   * see, and that is the owner's call rather than a default to inherit.
   */
  repairSizes: boolean;
};

export const DEFAULT_SCHEDULE_SETTINGS: LeaflyScheduleSettings = {
  // Starts OFF. Turning on automation makes this system talk to a third party
  // without a human present; that is the owner's decision to make, not a
  // default to inherit. Same posture as `sendPickupAvailability` in L-3.
  enabled: false,
  dailyFullHour: DAILY_HOUR_DEFAULT,
  intradayEnabled: true,
  intradayMinutes: INTRADAY_MINUTES_DEFAULT,
  activeFromHour: null,
  activeToHour: null,
  repairSizes: false,
};

function clampIntLocal(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * Resolve raw owner-entered jsonb into a safe schedule. Every field is clamped
 * or defaulted; nothing is trusted. An hour of `null` stays `null` (meaning
 * "all day"), but an hour of `"banana"` becomes `null` too — an unparseable
 * window is treated as no window rather than as an accidental 0, because
 * defaulting to hour 0 would silently create a one-hour-wide active window and
 * make the scheduler look broken.
 */
export function resolveScheduleSettings(
  raw: Record<string, unknown> | null | undefined,
): LeaflyScheduleSettings {
  const r = raw ?? {};
  const fromRaw = r.activeFromHour;
  const toRaw = r.activeToHour;

  const from =
    fromRaw === null || fromRaw === undefined || !Number.isFinite(Number(fromRaw))
      ? null
      : clampIntLocal(fromRaw, DAILY_HOUR_MIN, DAILY_HOUR_MAX, DAILY_HOUR_MIN);
  const to =
    toRaw === null || toRaw === undefined || !Number.isFinite(Number(toRaw))
      ? null
      : clampIntLocal(toRaw, DAILY_HOUR_MIN, DAILY_HOUR_MAX, DAILY_HOUR_MIN);

  return {
    enabled: r.enabled === true,
    dailyFullHour: clampIntLocal(r.dailyFullHour, DAILY_HOUR_MIN, DAILY_HOUR_MAX, DAILY_HOUR_DEFAULT),
    intradayEnabled: r.intradayEnabled !== false, // default on when unspecified
    intradayMinutes: clampIntLocal(
      r.intradayMinutes,
      INTRADAY_MINUTES_MIN,
      INTRADAY_MINUTES_MAX,
      INTRADAY_MINUTES_DEFAULT,
    ),
    // A half-specified window is no window. Requiring BOTH ends prevents an
    // "active from 9" with no end from being read as a 1-hour window.
    activeFromHour: from !== null && to !== null ? from : null,
    activeToHour: from !== null && to !== null ? to : null,
    // Strictly `=== true`, like `enabled`: a stored "true" string, a 1, or a
    // missing key all read as OFF, because this setting changes what shoppers
    // see and must only ever be on because the owner turned it on.
    repairSizes: r.repairSizes === true,
  };
}

// ---------------------------------------------------------------------------
// 4. The active window
// ---------------------------------------------------------------------------

/**
 * Is `hour` inside the configured window? Handles a window that wraps past
 * midnight (e.g. 20 -> 2), which is the normal case for a shop that closes
 * late. A window with from === to is treated as ALL DAY rather than as a
 * zero-width window: the owner setting both ends to the same value most
 * plausibly means "no restriction", and a zero-width window would silently
 * disable intraday syncing forever.
 */
export function isWithinActiveWindow(
  hour: number,
  fromHour: number | null,
  toHour: number | null,
): boolean {
  if (fromHour === null || toHour === null) return true;
  if (fromHour === toHour) return true;
  if (fromHour < toHour) return hour >= fromHour && hour < toHour;
  // Wrapped window: active late evening through early morning.
  return hour >= fromHour || hour < toHour;
}

// ---------------------------------------------------------------------------
// 5. Time arithmetic helpers (pure, no clock read)
// ---------------------------------------------------------------------------

function minutesBetween(laterIso: string, earlierIso: string): number | null {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return (later - earlier) / 60000;
}

/**
 * Has the daily full sync already happened on `now`'s Pacific calendar day?
 *
 * Compared on the PACIFIC day key rather than on elapsed hours, deliberately.
 * "Once per day" means once per calendar day as the owner experiences it. An
 * elapsed-hours test would drift across a DST boundary and either skip a day or
 * double-run one, and the whole point of using the Pacific helper is that the
 * two days a year when this matters behave correctly without anyone noticing.
 */
export function dailyAlreadyRan(nowIso: string, lastFullSyncIso: string | null | undefined): boolean {
  if (!lastFullSyncIso) return false;
  const lastMs = Date.parse(lastFullSyncIso);
  if (!Number.isFinite(lastMs)) return false; // unparseable => treat as never
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return false;
  // A timestamp in the future is not evidence that today's run happened; it is
  // evidence of a clock problem. Treat it as "not yet run" so the scheduler
  // stays live rather than silently parking itself until the bad date passes.
  if (lastMs > nowMs) return false;
  const nowDay = pacificDayKeyOf(nowIso);
  const lastDay = pacificDayKeyOf(lastFullSyncIso);
  return nowDay !== null && nowDay === lastDay;
}

function pacificDayKeyOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const p = pacificParts(new Date(ms));
  const mm = p.month < 10 ? `0${p.month}` : `${p.month}`;
  const dd = p.day < 10 ? `0${p.day}` : `${p.day}`;
  return `${p.year}-${mm}-${dd}`;
}

/**
 * Is the authoritative full sync overdue outright, regardless of the clock?
 *
 * `true` when it has never run, or when it ran longer ago than
 * `DAILY_CATCHUP_HOURS`. See that constant for why this exists.
 */
export function dailyFullIsOverdue(
  nowIso: string,
  lastFullSyncIso: string | null | undefined,
): boolean {
  if (!lastFullSyncIso) return true; // never synced -- as overdue as it gets
  const mins = minutesBetween(nowIso, lastFullSyncIso);
  // An unparseable or future-dated last-sync is not evidence of a recent sync.
  // Treating a bad timestamp as "recent" would park the scheduler; treating it
  // as overdue at worst sends one extra full sync, which is harmless.
  if (mins === null) return true;
  if (mins < 0) return true;
  return mins >= DAILY_CATCHUP_HOURS * 60;
}

/**
 * How long to stay backed off given consecutive failures. Returns 0 when the
 * failure count is below the threshold, so ordinary transient failures do not
 * delay anything.
 */
export function backoffMinutes(consecutiveFailures: number): number {
  const n = Number.isFinite(consecutiveFailures) ? Math.trunc(consecutiveFailures) : 0;
  if (n < BACKOFF_AFTER_FAILURES) return 0;
  const over = n - BACKOFF_AFTER_FAILURES + 1;
  const mins = over * BACKOFF_MINUTES_PER_FAILURE;
  return mins > BACKOFF_MINUTES_MAX ? BACKOFF_MINUTES_MAX : mins;
}

// ---------------------------------------------------------------------------
// 6. The decision
// ---------------------------------------------------------------------------

export type ScheduledRunInput = {
  /** The instant the cron fired, ISO. Supplied by the caller, never read here. */
  nowIso: string;
  settings: LeaflyScheduleSettings;
  /** Are Leafly credentials complete? A push without them would 401. */
  configured: boolean;
  /** Last successful FULL (POST) sync, ISO, or null if never. */
  lastFullSyncIso: string | null | undefined;
  /** Last run of ANY kind (full or delta, success or failure), ISO, or null. */
  lastRunIso: string | null | undefined;
  /** Consecutive failures since the last success. */
  consecutiveFailures: number;
  /**
   * A scheduled run that started and has not recorded an end, ISO of its start,
   * or null. Guards against overlap when a run outlives its cron interval.
   */
  runInFlightSinceIso: string | null | undefined;
  /**
   * A human pressed the manual push button and it has not finished, ISO of the
   * start, or null. The scheduler yields to people.
   */
  manualInFlightSinceIso: string | null | undefined;
};

/**
 * Decide what this cron tick should do.
 *
 * Order of checks is deliberate and is itself part of the contract, asserted by
 * the self-tests below:
 *
 *   1. `enabled`        — the owner's switch wins over everything. If automation
 *                         is off, nothing else is even worth reporting.
 *   2. `configured`     — a push without credentials is a guaranteed 401. Better
 *                         to say "not configured" than to generate a failure and
 *                         then back off because of it.
 *   3. in-flight locks  — never run two pushes at once, and always yield to a
 *                         human. Checked BEFORE the schedule so that "is it due"
 *                         cannot override safety.
 *   4. backoff          — stop hammering a broken integration.
 *   5. hard gap floor   — the un-configurable minimum between runs.
 *   6. daily full POST  — the authoritative sync, which takes priority over a
 *                         delta because it supersedes it entirely.
 *   7. intraday delta   — the responsive PUT.
 *
 * Every refusal returns a reason written for a person, because this decision is
 * shown in the UI, not just logged.
 */
export function decideScheduledRun(input: ScheduledRunInput): ScheduledRunDecision {
  const s = input.settings;

  // 1. The owner's switch.
  if (!s.enabled) {
    return {
      shouldRun: false,
      method: null,
      code: "disabled",
      reason: "Automatic syncing is switched off. Your menu only goes to Leafly when you press the push button.",
      needsAttention: false,
    };
  }

  // 2. Credentials. A push here would be a guaranteed 401, which would then feed
  //    the failure counter and trigger a backoff for a problem that has nothing
  //    to do with Leafly being unwell.
  if (!input.configured) {
    return {
      shouldRun: false,
      method: null,
      code: "not_configured",
      reason:
        "Automatic syncing is on, but the Leafly credentials are not complete, so there is nothing to send with. Add them on the integrations page.",
      needsAttention: true,
    };
  }

  // 3a. Yield to a human. Checked before the run lock because if BOTH are
  //     somehow set, the more useful message is the one about the person.
  const manualAge =
    input.manualInFlightSinceIso != null
      ? minutesBetween(input.nowIso, input.manualInFlightSinceIso)
      : null;
  if (manualAge !== null && manualAge >= 0 && manualAge < STALE_RUN_MINUTES) {
    return {
      shouldRun: false,
      method: null,
      code: "manual_in_flight",
      reason:
        "Someone is pushing the menu by hand right now, so the scheduled sync stepped aside. It will pick up on the next check.",
      needsAttention: false,
    };
  }

  // 3b. Do not overlap with our own previous run. A run older than
  //     STALE_RUN_MINUTES is treated as abandoned — a serverless function killed
  //     at its duration limit cannot clear its own lock, and a permanent lock
  //     would silently disable automation forever.
  const runAge =
    input.runInFlightSinceIso != null
      ? minutesBetween(input.nowIso, input.runInFlightSinceIso)
      : null;
  if (runAge !== null && runAge >= 0 && runAge < STALE_RUN_MINUTES) {
    return {
      shouldRun: false,
      method: null,
      code: "run_in_flight",
      reason: "The previous scheduled sync is still running, so this check did nothing rather than send twice.",
      needsAttention: false,
    };
  }

  // 4. Backoff after persistent failure.
  const backoff = backoffMinutes(input.consecutiveFailures);
  if (backoff > 0) {
    const since =
      input.lastRunIso != null ? minutesBetween(input.nowIso, input.lastRunIso) : null;
    if (since === null || since < backoff) {
      return {
        shouldRun: false,
        method: null,
        code: "backoff",
        reason: `The last ${input.consecutiveFailures} syncs failed, so syncing has slowed to every ${backoff} minutes until one succeeds. Check the error on the integrations page.`,
        needsAttention: true,
      };
    }
  }

  // 5. The hard floor between runs, which no setting can shrink.
  const sinceLastRun =
    input.lastRunIso != null ? minutesBetween(input.nowIso, input.lastRunIso) : null;
  if (sinceLastRun !== null && sinceLastRun >= 0 && sinceLastRun < MIN_RUN_GAP_MINUTES) {
    return {
      shouldRun: false,
      method: null,
      code: "cooldown",
      reason: `A sync ran less than ${MIN_RUN_GAP_MINUTES} minutes ago. Leafly grades how often we call, so this check waited.`,
      needsAttention: false,
    };
  }

  const nowParts = pacificParts(new Date(Date.parse(input.nowIso)));
  const hour = nowParts.hour;

  // 6. The authoritative daily full POST. Checked before the delta because a
  //    full sync supersedes a delta completely — running a PUT and then a POST
  //    in the same hour would send the same data twice and read, to Leafly, as
  //    an integration that does not know what it is doing.
  const fullRanToday = dailyAlreadyRan(input.nowIso, input.lastFullSyncIso);
  const fullOverdue = dailyFullIsOverdue(input.nowIso, input.lastFullSyncIso);
  // Two independent triggers, and the OR between them is the whole point. The
  // first is the owner's preferred time of day. The second is the guarantee that
  // survives DST shifts, a misconfigured hour, and missed ticks. (On Hobby
  // there was only one tick per day to get it right; on Pro, since L-34,
  // there are 96, and this OR is the safety net rather than the main path.)
  // See DAILY_CATCHUP_HOURS.
  if ((hour >= s.dailyFullHour && !fullRanToday) || fullOverdue) {
    return {
      shouldRun: true,
      method: "POST",
      code: "daily_full",
      reason: fullOverdue && !(hour >= s.dailyFullHour && !fullRanToday)
        ? "Running the full menu sync now because a day has gone by without one. This is the authoritative copy, so Leafly's menu will match ours exactly."
        : "Running today's full menu sync — this is the authoritative copy, so Leafly's menu will match ours exactly.",
      needsAttention: false,
    };
  }

  // 7. The intraday delta.
  if (!s.intradayEnabled) {
    return {
      shouldRun: false,
      method: null,
      code: "not_due",
      reason: "Today's full sync is already done and between-times updates are switched off, so there is nothing to do.",
      needsAttention: false,
    };
  }

  if (!isWithinActiveWindow(hour, s.activeFromHour, s.activeToHour)) {
    return {
      shouldRun: false,
      method: null,
      code: "quiet_hours",
      reason: "Outside the hours you set for between-times updates, so this check did nothing.",
      needsAttention: false,
    };
  }

  // SLICE L-34: `- INTRADAY_DUE_TOLERANCE_MINUTES`, so a tick that lands a few
  // seconds short of the interval is not pushed a whole tick later.
  if (
    sinceLastRun !== null &&
    sinceLastRun >= 0 &&
    sinceLastRun < s.intradayMinutes - INTRADAY_DUE_TOLERANCE_MINUTES
  ) {
    return {
      shouldRun: false,
      method: null,
      code: "not_due",
      reason: `The next between-times update is not due yet (every ${s.intradayMinutes} minutes).`,
      needsAttention: false,
    };
  }

  return {
    shouldRun: true,
    method: "PUT",
    code: "intraday_delta",
    reason: "Sending any changes made since the last sync. Unchanged items are skipped automatically.",
    needsAttention: false,
  };
}

// ---------------------------------------------------------------------------
// 6b. Reading the run log for the decision (SLICE L-34)
//
// Before L-34 the server treated EVERY finished row as "a run": the newest one
// set `lastRunIso`, and the failure streak stopped at the first non-failure.
// But a refusal row is not a run — it is the scheduler writing down that it
// decided NOT to run. Counting it as one had three consequences, all measured
// by scripts/recon/l34-cadence-probe.mts rather than reasoned about:
//
//   1. INTRADAY STARVATION. Each "not due" refusal reset `lastRunIso`, so the
//      next tick measured the time since the REFUSAL, not since the last push.
//      With ticks every 15 minutes and a 60-minute setting, the delta never
//      became due again: one push in six trading hours instead of six.
//   2. BACKOFF THAT NEVER EXPIRES. The same reset applied to the backoff
//      clock, so once backing off, each "backoff" refusal restarted the wait.
//   3. BACKOFF THAT BARELY STARTS. The failure walk broke on the first
//      refusal, so after three failures one refused tick reset the streak to
//      zero and the very next tick hammered Leafly again.
//
// On a once-a-day cron none of this could show; on Pro all three would have.
// The fix is one rule, in one place: refusals are the log's commentary, not
// its history, and are skipped when reading timing and failure state.
// ---------------------------------------------------------------------------

export type RunHistoryRow = {
  disposition: string | null | undefined;
  startedAt: string | null | undefined;
};

/**
 * Derive `lastRunIso` and `consecutiveFailures` from finished rows, newest
 * first. Refused rows are SKIPPED — neither a run nor a streak breaker.
 * A 'skipped' row (the push layer found nothing to send) IS a run and DOES
 * break the streak: it proves the integration is healthy.
 */
export function summarizeRunHistory(rowsNewestFirst: readonly RunHistoryRow[]): {
  lastRunIso: string | null;
  consecutiveFailures: number;
} {
  let lastRunIso: string | null = null;
  let consecutiveFailures = 0;
  let streakOpen = true;
  for (const row of rowsNewestFirst) {
    if (row.disposition === "refused") continue;
    if (lastRunIso === null && typeof row.startedAt === "string" && row.startedAt !== "") {
      lastRunIso = row.startedAt;
    }
    if (streakOpen) {
      if (row.disposition === "failed") consecutiveFailures += 1;
      else streakOpen = false;
    }
    if (lastRunIso !== null && !streakOpen) break;
  }
  return { lastRunIso, consecutiveFailures };
}

/**
 * SLICE L-34 (Defect E). Does this finished row prove the day's full sync
 * happened?
 *
 * Before L-34 only `method = POST, disposition = success` counted. But when
 * nothing on the menu has changed, the push layer returns SKIPPED for the
 * daily POST — correctly, because our item hashes already match the last
 * state Leafly accepted — and closes the row with `method = null`. That
 * row never counted, so "has today's full sync run?" stayed false all day.
 *
 * At one tick a day this cost nothing (the next attempt was tomorrow anyway).
 * At Pro cadence the L-34 simulation measured it: on a quiet day EVERY tick
 * (49 of 49 between 3am and 3pm on a fifteen-minute cron) re-attempted the daily full sync,
 * rebuilt the whole menu to hash it, wrote a row, and the intraday PUT never
 * got a turn.
 *
 * A scheduled `daily_full` that was SKIPPED is therefore the day's full sync:
 * the check ran and proved Leafly already holds exactly what a POST would
 * send. A skipped row from any other decision is NOT (an intraday skip says
 * nothing about the full menu). The server query mirrors this predicate.
 */
export function isFullSyncEvidence(row: {
  method: string | null | undefined;
  disposition: string | null | undefined;
  decisionCode: string | null | undefined;
}): boolean {
  if (row.method === "POST" && row.disposition === "success") return true;
  // SLICE L-41. A SUCCESSFUL scheduled daily_full is the day's full sync
  // whatever verb it used. When products are held back the daily run sends
  // the whole passing menu as a PUT (a POST would delete the held-back
  // products from Leafly) -- it is still today's authoritative send. Without
  // this, that run would not count, and every fifteen-minute tick would
  // rebuild and resend the whole menu all day (Defect E again, by another
  // road).
  if (row.decisionCode === "daily_full" && row.disposition === "success") return true;
  return row.decisionCode === "daily_full" && row.disposition === "skipped";
}

/** The PostgREST `or=` filter equivalent of `isFullSyncEvidence`. */
export const FULL_SYNC_EVIDENCE_FILTER =
  "and(method.eq.POST,disposition.eq.success),and(decision_code.eq.daily_full,disposition.eq.success),and(decision_code.eq.daily_full,disposition.eq.skipped)";

/**
 * SLICE L-34 — WHO WINS WHEN TWO SCHEDULED RUNS START AT ONCE.
 *
 * The run lock is "an unfinished row in leafly_sync_runs". The server reads
 * the in-flight rows, lets the core decide, and only then inserts its own
 * row. That read-then-insert is not atomic: if Vercel delivers the same tick
 * twice (its documentation says this can happen), both invocations can read
 * "nothing in flight" and both insert. On a once-a-day cron that needed a
 * duplicate delivery on the one tick of the day; at a tick every fifteen
 * minutes it is ninety-six chances a day.
 *
 * The fix is the standard insert-then-verify tie-break. After inserting its
 * row, each run re-reads the unfinished SCHEDULED rows. Every insert has
 * committed by then (each PostgREST request is its own transaction), so both
 * runs see both rows and apply the same deterministic rule: the earliest
 * non-stale row by (started_at, id) wins. Exactly one proceeds; the other
 * closes its row as refused with code `run_in_flight`.
 *
 * Returns true when `ownId` is the winner. Fails towards PROCEEDING when its
 * own row is missing from what it read (a lagging read must not make every
 * run stand down, which would silently stop syncing), matching the existing
 * posture of `openRun`: a lock row we hold is permission to push.
 */
export function wonRunStartRace(input: {
  ownId: string;
  rows: readonly { id: string | null | undefined; startedAt: string | null | undefined }[];
  nowIso: string;
}): boolean {
  const own = input.rows.find((r) => r.id === input.ownId);
  if (!own) return true;
  const live = input.rows.filter((r) => {
    if (typeof r.id !== "string" || r.id === "") return false;
    if (typeof r.startedAt !== "string") return false;
    const age = minutesBetween(input.nowIso, r.startedAt);
    // Unparseable or future timestamps are kept (conservative: they compete).
    if (age === null) return true;
    return age < STALE_RUN_MINUTES;
  });
  if (!live.some((r) => r.id === input.ownId)) return true;
  const key = (r: { id: string | null | undefined; startedAt: string | null | undefined }) => {
    const t = Date.parse(String(r.startedAt));
    return { t: Number.isFinite(t) ? t : Number.POSITIVE_INFINITY, id: String(r.id) };
  };
  const winner = [...live].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.t !== kb.t) return ka.t - kb.t;
    return ka.id < kb.id ? -1 : ka.id > kb.id ? 1 : 0;
  })[0]!;
  return winner.id === input.ownId;
}

/**
 * Should this refusal be written to the run log? See REFUSAL_HEARTBEAT_MINUTES.
 *
 * `lastRecorded` is the newest finished row of ANY disposition, or null.
 * 'disabled' is never recorded (the pre-L-34 rule, kept). A refusal that needs
 * the owner's attention is recorded whenever it is not simply a repeat of the
 * newest row within the heartbeat. A routine refusal is recorded when
 * the log is empty, when the newest row is older than the heartbeat, or when
 * the newest row is a refusal with a DIFFERENT code (the reason changed, e.g.
 * quiet hours began). It is NOT recorded when the newest row is a recent real
 * run or the same refusal. Unknown or unparseable timing records — when in
 * doubt, leave evidence.
 */
export function shouldRecordRefusal(input: {
  decision: Pick<ScheduledRunDecision, "code" | "needsAttention">;
  lastRecorded: {
    decisionCode: string | null | undefined;
    disposition: string | null | undefined;
    startedAt: string | null | undefined;
  } | null;
  nowIso: string;
}): boolean {
  if (input.decision.code === "disabled") return false;
  const last = input.lastRecorded;
  if (!last) return true;
  if (typeof last.startedAt !== "string") return true;
  const age = minutesBetween(input.nowIso, last.startedAt);
  if (age === null || age < 0) return true;
  if (age >= REFUSAL_HEARTBEAT_MINUTES) return true;
  if (input.decision.needsAttention) {
    // A problem refusal is written the first time it appears after anything
    // else (so a backoff that starts right after a failure is visible at
    // once), and then hourly while it persists — NOT on every tick, or an
    // unconfigured integration would write 96 identical rows a day and push
    // every useful row off the ten-row history on the integrations page.
    return !(last.disposition === "refused" && last.decisionCode === input.decision.code);
  }
  // Young newest row. A refusal whose reason CHANGED is news; anything else
  // (a recent real run, or the same refusal again) is not.
  return last.disposition === "refused" && last.decisionCode !== input.decision.code;
}

// ---------------------------------------------------------------------------
// 7. Human wording for the UI
// ---------------------------------------------------------------------------

/**
 * An hour 0-23 as a 12-hour Pacific label.
 *
 * EXPORTED (it was private until the L-7 UI landed) because the schedule form
 * renders a 24-entry hour dropdown and must label those entries with exactly
 * the same words `describeSchedule()` uses in its summary sentence. Two
 * formatters would eventually disagree, and an owner reading "runs at 4am" over
 * a dropdown that says "04:00" has been given two facts to reconcile for no
 * reason. Rule 11: one rule, one home.
 *
 * Defensive modulo: a caller passing 24 or -1 gets a real hour rather than
 * "24am". The resolver already clamps, so this is belt and braces.
 */
export function formatPacificHour(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

/**
 * An interval in minutes, in words. Extracted from `describeSchedule()` so the
 * interval dropdown can label its options identically.
 *
 * "every hour" rather than "every 60 minutes", and "every 2 hours" rather than
 * "every 120 minutes", because that is how people say it.
 */
export function describeIntradayInterval(minutes: number): string {
  const m = Math.trunc(minutes);
  if (m === 60) return "every hour";
  if (m === 1440) return "every 24 hours";
  if (m % 60 === 0) return `every ${m / 60} hours`;
  return `every ${m} minutes`;
}

/**
 * The intervals the form offers.
 *
 * A dropdown rather than a free number box on purpose. The resolver clamps any
 * number to [15, 1440], but clamping is a silent correction: an owner who types
 * 5 gets 15 and is never told. Offering only valid choices means the clamp is a
 * safety net for stored data rather than a routine part of using the screen.
 *
 * Asserted in the self-tests to be sorted, in range, and to contain the
 * default -- so this list cannot drift away from the bounds above it.
 */
export const INTRADAY_CHOICES: readonly number[] = [15, 30, 60, 120, 180, 240, 360, 720, 1440];

/**
 * One sentence describing the schedule as configured, for the settings screen.
 * Deliberately describes what WILL happen rather than echoing the field values,
 * because "intradayMinutes: 60" is not a sentence anyone should have to read.
 */
export function describeSchedule(s: LeaflyScheduleSettings): string {
  if (!s.enabled) {
    return "Automatic syncing is off. Your menu goes to Leafly only when you press the push button.";
  }
  const daily = `A full menu sync runs every day at ${formatPacificHour(s.dailyFullHour)} Pacific`;
  // SLICE L-41. Automatic runs hold back products that fail Leafly's checks
  // exactly like "Send my whole menu, hold back only the bad ones", and the
  // owner's size-repair choice is part of what the schedule does, so it is
  // said here -- the same sentence appears before and after saving.
  const repair = s.repairSizes
    ? " The size fix is applied first, and anything still failing Leafly's checks is held back."
    : " Anything failing Leafly's checks is held back; the size fix is not applied.";
  if (!s.intradayEnabled) {
    return `${daily}. Between those, nothing is sent automatically — use the push button after a change.${repair}`;
  }
  const every = describeIntradayInterval(s.intradayMinutes);
  const window =
    s.activeFromHour !== null && s.activeToHour !== null
      ? `, between ${formatPacificHour(s.activeFromHour)} and ${formatPacificHour(s.activeToHour)}`
      : "";
  return `${daily}, and changes are sent ${every}${window}. Unchanged items are never resent.${repair}`;
}

/** Tone for the UI. Never invents a value for an unknown code. */
export type ScheduleTone = "good" | "waiting" | "off" | "bad";

export function scheduleToneForCode(code: string | null | undefined): ScheduleTone {
  switch (code) {
    case "daily_full":
    case "intraday_delta":
      return "good";
    case "not_due":
    case "quiet_hours":
    case "cooldown":
    case "manual_in_flight":
    case "run_in_flight":
      return "waiting";
    case "disabled":
      return "off";
    case "not_configured":
    case "backoff":
      return "bad";
    default:
      // A code this module does not know about is a problem worth surfacing,
      // not something to paint green. Same posture as `leaflyStatusTone`.
      return "bad";
  }
}

/**
 * Short label per code, for a badge. Returns `null` — never a prettified
 * version of the raw code — when the code is unrecognised, so a new code cannot
 * leak to the owner as snake_case.
 */
export function scheduleCodeLabel(code: string | null | undefined): string | null {
  switch (code) {
    case "daily_full":
      return "Full sync";
    case "intraday_delta":
      return "Update sent";
    case "disabled":
      return "Off";
    case "not_due":
      return "Not due";
    case "quiet_hours":
      return "Quiet hours";
    case "not_configured":
      return "Needs credentials";
    case "manual_in_flight":
      return "Waiting for manual push";
    case "run_in_flight":
      return "Already running";
    case "cooldown":
      return "Cooling down";
    case "backoff":
      return "Slowed after failures";
    default:
      return null;
  }
}

/** Every code this module can emit. The tests iterate this, so it cannot rot. */
export const ALL_SCHEDULED_RUN_CODES: readonly ScheduledRunCode[] = [
  "daily_full",
  "intraday_delta",
  "disabled",
  "not_due",
  "quiet_hours",
  "not_configured",
  "manual_in_flight",
  "run_in_flight",
  "cooldown",
  "backoff",
];

// ---------------------------------------------------------------------------
// 7b. Reading the run log back to the owner
//
// The schedule panel is a `.tsx` file, and a `.tsx` file is the worst possible
// place to keep a rule: it cannot be unit tested cheaply, it cannot be
// sabotaged by the mutation sweep, and it tempts every future contributor to
// add "just one" inline ternary. So the component below owns layout and
// nothing else; every word it shows comes from this section.
// ---------------------------------------------------------------------------

/**
 * How a finished run turned out, as recorded in `leafly_sync_runs.disposition`.
 *
 * `null` in the database means the run is still in flight -- that NULL is the
 * lock (migration 0227), so it is a real state and not missing data.
 */
export type RunDisposition = "success" | "skipped" | "refused" | "failed" | "blocked";

/**
 * Label for one row of run history. Returns `null` for a disposition this
 * module does not recognise, exactly like `scheduleCodeLabel`, so a value added
 * to the database without coming through here surfaces as an obvious gap rather
 * than leaking a raw enum to the owner.
 *
 * `in flight` is returned for `null`, which is the only case where absence of a
 * value is itself the answer.
 */
export function dispositionLabel(disposition: string | null | undefined): string | null {
  if (disposition === null || disposition === undefined) return "Running now";
  switch (disposition) {
    case "success":
      return "Sent";
    case "skipped":
      // Deliberately not "Skipped". The engine returns skipped when nothing
      // changed since the last successful sync, which is the system working
      // well; "skipped" reads like a miss.
      return "Nothing to send";
    case "refused":
      return "Stood down";
    case "failed":
      return "Failed";
    case "blocked":
      return "Blocked";
    default:
      return null;
  }
}

/**
 * Tone for a run row.
 *
 * `skipped` is GOOD, not neutral: it is the no-op that proves change detection
 * is working. `refused` is `waiting`, because a refusal is the scheduler
 * obeying its own safety rules (cooldown, quiet hours, a manual push in
 * progress) and painting that orange would train the owner to ignore orange.
 * `blocked` is bad -- it means the run log could not be read, so the scheduler
 * could not prove it was safe to push and stood down blind.
 */
export function dispositionTone(disposition: string | null | undefined): ScheduleTone {
  if (disposition === null || disposition === undefined) return "waiting";
  switch (disposition) {
    case "success":
    case "skipped":
      return "good";
    case "refused":
      return "waiting";
    case "failed":
    case "blocked":
      return "bad";
    default:
      return "bad";
  }
}

/**
 * Every disposition the UI can be asked to render.
 *
 * NOTE the asymmetry with migration 0227, whose `disposition` CHECK lists only
 * the first four. 'blocked' is never STORED -- it is returned when no run row
 * could be opened at all (unreadable history, or a failed lock insert), so
 * there is nothing to write it to. It is in this list because the "Run the
 * check now" button can return it live and the panel must have a word for it.
 * See `CloseRunArgs` in schedule-server.ts for why widening the writer's type
 * to match this list would be a mistake.
 */
export const ALL_RUN_DISPOSITIONS: readonly RunDisposition[] = [
  "success",
  "skipped",
  "refused",
  "failed",
  "blocked",
];

/**
 * "4 minutes ago" / "in 2 hours" / "never".
 *
 * Pure, and it takes `nowIso` as an argument rather than reading the clock.
 * That is not just testability: the panel is a client component, and a relative
 * time computed during render from `Date.now()` produces a different string on
 * the server than in the browser, which React reports as a hydration error.
 * Passing the server's `now` down as a prop makes the first paint agree with
 * itself.
 *
 * Returns "never" for null so callers cannot accidentally render "Invalid Date"
 * or, worse, the epoch.
 */
export function describeElapsed(iso: string | null | undefined, nowIso: string): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "unknown";

  const deltaMs = now - then;
  const future = deltaMs < 0;
  const mins = Math.floor(Math.abs(deltaMs) / 60000);

  let magnitude: string;
  if (mins < 1) magnitude = "less than a minute";
  else if (mins === 1) magnitude = "1 minute";
  else if (mins < 60) magnitude = `${mins} minutes`;
  else {
    const hours = Math.floor(mins / 60);
    if (hours === 1) magnitude = "1 hour";
    else if (hours < 48) magnitude = `${hours} hours`;
    else magnitude = `${Math.floor(hours / 24)} days`;
  }
  return future ? `in ${magnitude}` : `${magnitude} ago`;
}

/**
 * The one-line verdict at the top of the panel.
 *
 * WHY THIS IS NOT JUST `nextDecision.reason`
 * ------------------------------------------
 * `nextDecision` answers "what would the next tick do", which is a question
 * about the next sixty seconds. The owner's actual question is "is my Leafly
 * menu being kept up to date", which is a question about the last day. Those
 * differ in the case that matters most: a schedule can be perfectly healthy
 * *as a schedule* -- not due, nothing to do, calm green reason -- while the
 * authoritative full sync has not landed for two days because every attempt
 * failed. Reporting only the next decision would show "Not due" over a frozen
 * menu.
 *
 * So the order below is by CONSEQUENCE, not by mechanism:
 *   1. the history cannot be read       -> we know nothing; say so
 *   2. the owner switched it off        -> calm, not a fault
 *   3. no credentials                   -> nothing can ever work
 *   4. the schedule has backed off      -> repeated real failures
 *   5. no full sync has ever run        -> waiting for the first one
 *   6. the full sync is overdue         -> THE SILENT-FREEZE CASE
 *   7. otherwise                        -> healthy, with the next step
 */
export type AutomationSummary = {
  tone: ScheduleTone;
  /** Short enough for a badge. */
  headline: string;
  /** One sentence for underneath it. Never contains a guessed value. */
  detail: string;
  needsAttention: boolean;
};

export function summarizeAutomation(input: {
  nowIso: string;
  settings: LeaflyScheduleSettings;
  configured: boolean;
  nextDecision: ScheduledRunDecision | null;
  lastFullSyncIso: string | null;
  lastRunIso: string | null;
  consecutiveFailures: number;
  /** Non-null when the run history could not be read at all. */
  problem: string | null;
}): AutomationSummary {
  if (input.problem) {
    return {
      tone: "bad",
      headline: "Cannot check",
      detail:
        `The automatic sync history could not be read, so this page cannot tell you ` +
        `whether syncing is working: ${input.problem}`,
      needsAttention: true,
    };
  }

  if (!input.settings.enabled) {
    return {
      tone: "off",
      headline: "Off",
      detail:
        "Automatic syncing is switched off. Your Leafly menu changes only when you " +
        "press the push button, which still works exactly as it always has.",
      needsAttention: false,
    };
  }

  if (!input.configured) {
    return {
      tone: "bad",
      headline: "Needs credentials",
      detail:
        "Automatic syncing is on, but Leafly credentials are not set, so every run " +
        "will stand down without sending anything. Add them above.",
      needsAttention: true,
    };
  }

  if (input.consecutiveFailures >= BACKOFF_AFTER_FAILURES) {
    return {
      tone: "bad",
      headline: "Failing",
      detail:
        `The last ${input.consecutiveFailures} runs failed, so the schedule has ` +
        `deliberately slowed itself down rather than hammering Leafly. See the run ` +
        `history below for what Leafly said.`,
      needsAttention: true,
    };
  }

  if (!input.lastFullSyncIso) {
    return {
      tone: "waiting",
      headline: "Waiting for the first sync",
      detail:
        "Automatic syncing is on, but no full menu sync has completed yet. " +
        `${describeSchedule(input.settings)} You can also run it now with the button below.`,
      needsAttention: false,
    };
  }

  // 6. The case this whole design exists to prevent. See DAILY_CATCHUP_HOURS.
  if (dailyFullIsOverdue(input.nowIso, input.lastFullSyncIso)) {
    return {
      tone: "bad",
      headline: "Overdue",
      detail:
        `The last full menu sync was ${describeElapsed(input.lastFullSyncIso, input.nowIso)}, ` +
        `which is longer than the ${DAILY_CATCHUP_HOURS} hours this system allows. The next ` +
        `run will send a full sync whatever the hour, but if this keeps happening the ` +
        `schedule is not being reached at all.`,
      needsAttention: true,
    };
  }

  const next = input.nextDecision;
  const nextSentence = next
    ? next.shouldRun
      ? `The next run is due now (${next.method}).`
      : `Right now: ${next.reason}`
    : "";
  return {
    tone: "good",
    headline: "Running",
    detail:
      `Last full sync ${describeElapsed(input.lastFullSyncIso, input.nowIso)}. ` +
      `${describeSchedule(input.settings)} ${nextSentence}`.trim(),
    needsAttention: false,
  };
}

/**
 * Does the configured schedule match what Leafly actually asks for?
 *
 * The recommendation quoted below is not invented and not paraphrased from
 * memory. It is the exact wording already vendored in
 * `src/lib/leafly/certification-core.ts` for menu-certification criterion 3,
 * which was itself taken from Leafly's published checklist.
 *
 * This is shown to the owner because "is my cadence good enough for Leafly"
 * is a question he would otherwise have to ask Leafly -- and because the
 * certification card elsewhere on the page grades whether a schedule EXISTS,
 * not whether the one he has chosen is the one Leafly recommends. An owner who
 * turns the daily sync on but the intraday updates off has a schedule that
 * passes our gate and only half-satisfies theirs, and nothing was telling him.
 */
export const LEAFLY_CADENCE_RECOMMENDATION =
  "daily full POST + PUT/DELETE for intraday changes, or full POST several times per hour";

export type CadenceVerdict = {
  /** True only when the configuration satisfies Leafly's recommended pattern. */
  meetsRecommendation: boolean;
  /** What Leafly asks for, verbatim. */
  recommendation: string;
  /** What we are actually configured to do about it. */
  finding: string;
};

export function assessCadenceAgainstLeafly(s: LeaflyScheduleSettings): CadenceVerdict {
  const recommendation = LEAFLY_CADENCE_RECOMMENDATION;

  if (!s.enabled) {
    return {
      meetsRecommendation: false,
      recommendation,
      finding:
        "Automatic syncing is off, so there is no cadence for Leafly to see — only " +
        "hand-pressed pushes, which is the request pattern their checklist marks down.",
    };
  }
  if (!s.intradayEnabled) {
    return {
      meetsRecommendation: false,
      recommendation,
      finding:
        `The daily full sync is scheduled for ${formatPacificHour(s.dailyFullHour)} Pacific, ` +
        "which is the first half of what Leafly recommends. Intraday updates are off, so " +
        "a price or stock change made at 9am is not sent until tomorrow. Turning them on " +
        "completes the recommended pattern.",
    };
  }
  const windowNote =
    s.activeFromHour !== null && s.activeToHour !== null
      ? ` Updates pause outside ${formatPacificHour(s.activeFromHour)}–${formatPacificHour(
          s.activeToHour,
        )}, and the daily full sync still runs regardless.`
      : "";
  return {
    meetsRecommendation: true,
    recommendation,
    finding:
      `A full sync at ${formatPacificHour(s.dailyFullHour)} Pacific plus update-only syncs ` +
      `${describeIntradayInterval(s.intradayMinutes)} matches Leafly's recommended pattern ` +
      `exactly.${windowNote}`,
  };
}

// ---------------------------------------------------------------------------
// 8. Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyScheduleTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  function ok(label: string, cond: boolean): void {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`[leafly-schedule-core] FAILED: ${label}`);
    }
  }

  // A fixed instant, well away from any DST boundary, expressed so that the
  // Pacific hour is unambiguous. 2026-06-15T19:00:00Z = 12:00 PDT (UTC-7).
  const NOON_PDT = "2026-06-15T19:00:00.000Z";

  const base: ScheduledRunInput = {
    nowIso: NOON_PDT,
    settings: { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true },
    configured: true,
    lastFullSyncIso: null,
    lastRunIso: null,
    consecutiveFailures: 0,
    runInFlightSinceIso: null,
    manualInFlightSinceIso: null,
  };

  // --- the Pacific helper actually behaves as the tests assume -------------
  ok("noon PDT resolves to hour 12", pacificParts(new Date(Date.parse(NOON_PDT))).hour === 12);

  // --- 1. the master switch -----------------------------------------------
  {
    const d = decideScheduledRun({ ...base, settings: { ...base.settings, enabled: false } });
    ok("disabled does not run", d.shouldRun === false);
    ok("disabled reports disabled", d.code === "disabled");
    ok("disabled has no method", d.method === null);
    // Nagging about a deliberate setting trains people to ignore warnings.
    ok("disabled is NOT flagged as a problem", d.needsAttention === false);
  }

  // --- 2. credentials ------------------------------------------------------
  {
    const d = decideScheduledRun({ ...base, configured: false });
    ok("unconfigured does not run", d.shouldRun === false);
    ok("unconfigured reports not_configured", d.code === "not_configured");
    ok("unconfigured needs attention", d.needsAttention === true);
    ok("unconfigured points at the fix", /integrations page/i.test(d.reason));
  }
  {
    // The switch outranks credentials: if automation is off, "you are missing
    // credentials" is noise about a feature the owner is not using.
    const d = decideScheduledRun({
      ...base,
      settings: { ...base.settings, enabled: false },
      configured: false,
    });
    ok("disabled outranks not_configured", d.code === "disabled");
  }

  // --- 3. locks: never two pushes at once, always yield to a human --------
  {
    const d = decideScheduledRun({
      ...base,
      manualInFlightSinceIso: "2026-06-15T18:58:00.000Z", // 2 minutes ago
    });
    ok("yields to a manual push", d.shouldRun === false);
    ok("manual lock reports manual_in_flight", d.code === "manual_in_flight");
    ok("yielding is not an error", d.needsAttention === false);
  }
  {
    const d = decideScheduledRun({
      ...base,
      runInFlightSinceIso: "2026-06-15T18:58:00.000Z",
    });
    ok("does not overlap its own run", d.shouldRun === false);
    ok("run lock reports run_in_flight", d.code === "run_in_flight");
  }
  {
    // A serverless function killed at its duration limit cannot clear its lock.
    // If a stale lock blocked forever, one crash would silently kill automation.
    const d = decideScheduledRun({
      ...base,
      runInFlightSinceIso: "2026-06-15T18:00:00.000Z", // 60 min > STALE_RUN_MINUTES
    });
    ok("a stale run lock self-heals", d.shouldRun === true);
  }
  {
    const d = decideScheduledRun({
      ...base,
      manualInFlightSinceIso: "2026-06-15T18:00:00.000Z",
    });
    ok("a stale manual lock self-heals", d.shouldRun === true);
  }
  {
    // Both locks set: the message about the person is the more useful one.
    const d = decideScheduledRun({
      ...base,
      manualInFlightSinceIso: "2026-06-15T18:58:00.000Z",
      runInFlightSinceIso: "2026-06-15T18:58:00.000Z",
    });
    ok("manual lock is reported ahead of the run lock", d.code === "manual_in_flight");
  }
  {
    // A lock timestamp in the future is a clock fault, not a real lock. It must
    // not wedge the scheduler.
    const d = decideScheduledRun({
      ...base,
      runInFlightSinceIso: "2026-06-16T19:00:00.000Z", // tomorrow
    });
    ok("a future run lock does not wedge the scheduler", d.shouldRun === true);
  }

  // --- 4. backoff ----------------------------------------------------------
  ok("no backoff below the threshold", backoffMinutes(BACKOFF_AFTER_FAILURES - 1) === 0);
  ok("backoff engages at the threshold", backoffMinutes(BACKOFF_AFTER_FAILURES) > 0);
  ok(
    "backoff grows with failures",
    backoffMinutes(BACKOFF_AFTER_FAILURES + 1) > backoffMinutes(BACKOFF_AFTER_FAILURES),
  );
  ok("backoff is capped", backoffMinutes(9999) === BACKOFF_MINUTES_MAX);
  ok("backoff handles nonsense input", backoffMinutes(Number.NaN) === 0);
  // MUTATION GAP M27. The four assertions above are all written RELATIVE to
  // BACKOFF_AFTER_FAILURES, which is precisely the form that cannot notice the
  // constant moving -- they move with it, so lowering the threshold to 1 left
  // every one of them true. These are absolute, because "a single failed sync
  // must not delay anything" is a fixed promise to the owner and not a function
  // of whatever the constant currently says. Leafly's API having one bad minute
  // is an ordinary event; parking the schedule for half an hour over it is not.
  ok("one isolated failure does not back off", backoffMinutes(1) === 0);
  ok("two failures still do not back off", backoffMinutes(2) === 0);
  ok("three failures DO back off", backoffMinutes(3) > 0);
  ok("the third failure's backoff is the smallest step", backoffMinutes(3) === BACKOFF_MINUTES_PER_FAILURE);
  ok("a negative failure count cannot conjure a backoff", backoffMinutes(-5) === 0);
  {
    const d = decideScheduledRun({
      ...base,
      consecutiveFailures: 5,
      lastRunIso: "2026-06-15T18:55:00.000Z", // 5 minutes ago
    });
    ok("persistent failure backs off", d.shouldRun === false);
    ok("backoff reports backoff", d.code === "backoff");
    ok("backoff needs attention", d.needsAttention === true);
    // Must be actionable: a slowed integration the owner cannot diagnose is
    // just a silent outage with extra steps.
    ok("backoff says where to look", /integrations page/i.test(d.reason));
  }
  {
    // Once enough time has passed the backoff must RELEASE. A backoff that
    // never releases is an outage.
    const d = decideScheduledRun({
      ...base,
      consecutiveFailures: 5,
      lastRunIso: "2026-06-14T19:00:00.000Z", // 24h ago
      lastFullSyncIso: "2026-06-14T19:00:00.000Z",
    });
    ok("backoff releases after its window", d.shouldRun === true);
  }

  {
    // MUTATION GAP M33. The backoff guard reads
    //   if (since === null || since < backoff)
    // and the `=== null` half had no test. Flipping it to `!== null &&` makes an
    // UNKNOWN last-run time defeat the backoff completely -- and that is the
    // fail-OPEN direction, so it is the edit somebody makes while wondering why
    // the scheduler seems stuck. It is also not a rare state: right after a
    // deploy, or after the run log is trimmed, `lastRunIso` is null while the
    // failure counter is not, which is exactly when hammering a failing Leafly
    // endpoint is least excusable (their checklist grades request patterns).
    const d = decideScheduledRun({
      ...base,
      consecutiveFailures: 5,
      lastRunIso: null,
    });
    ok("a failing schedule with an unknown last run still backs off", d.code === "backoff");
    ok("and it does not push", d.shouldRun === false);
    ok("and it asks for attention", d.needsAttention === true);
  }
  {
    // The same hole reached through an unparseable timestamp rather than a null
    // one, because `minutesBetween` returns null for both and only one of those
    // two paths would be exercised otherwise.
    const d = decideScheduledRun({
      ...base,
      consecutiveFailures: 5,
      lastRunIso: "not-a-date",
    });
    ok("an unparseable last run does not defeat the backoff", d.code === "backoff");
  }

  // --- 5. the hard floor ---------------------------------------------------
  {
    const d = decideScheduledRun({
      ...base,
      lastRunIso: "2026-06-15T18:55:00.000Z", // 5 min < MIN_RUN_GAP_MINUTES
      lastFullSyncIso: "2026-06-15T18:55:00.000Z",
    });
    ok("the hard gap floor holds", d.shouldRun === false);
    ok("the floor reports cooldown", d.code === "cooldown");
  }
  {
    // The floor must not be shrinkable by configuration. Intraday minutes are
    // clamped at 15, but even a hand-written 1 must not get through.
    const d = decideScheduledRun({
      ...base,
      settings: { ...base.settings, intradayMinutes: 1 },
      lastRunIso: "2026-06-15T18:58:00.000Z", // 2 min
      lastFullSyncIso: "2026-06-15T18:58:00.000Z",
    });
    ok("config cannot shrink the hard floor", d.code === "cooldown");
  }

  // --- 6. the daily full POST ---------------------------------------------
  {
    const d = decideScheduledRun({ ...base, lastFullSyncIso: null });
    ok("never-synced runs the full sync", d.shouldRun === true);
    ok("the full sync uses POST", d.method === "POST");
    ok("the full sync reports daily_full", d.code === "daily_full");
  }
  {
    // Same Pacific day => already done.
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-15T11:05:00.000Z", // 04:05 PDT same day
      lastRunIso: "2026-06-15T11:05:00.000Z",
    });
    ok("the daily full sync does not run twice in a day", d.code !== "daily_full");
  }
  {
    // Previous Pacific day => due again.
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-14T11:05:00.000Z",
      lastRunIso: "2026-06-14T11:05:00.000Z",
    });
    ok("the daily full sync runs again the next day", d.code === "daily_full");
  }
  {
    // Before the configured hour, with today's not yet done, the daily must NOT
    // fire early. 2026-06-15T13:00Z = 06:00 PDT, hour 6 < 8.
    //
    // NOTE ON THIS FIXTURE. It originally used a `lastFullSyncIso` of
    // 2026-06-14T15:05Z, which is 21h55m before `now`. Once DAILY_CATCHUP_HOURS
    // was introduced that fixture became OVERDUE, so the catch-up rule fired and
    // this assertion failed -- correctly. The assertion itself is still worth
    // keeping (the hour preference must be honoured when nothing is overdue), so
    // the fixture moved to 11 hours ago, which is inside the catch-up window and
    // therefore actually exercises the hour gate. The overdue case is asserted
    // separately, and deliberately, further down.
    const d = decideScheduledRun({
      ...base,
      nowIso: "2026-06-15T13:00:00.000Z",
      settings: { ...base.settings, dailyFullHour: 8 },
      // 2026-06-15T02:00Z = 19:00 PDT on 06-14: a DIFFERENT Pacific day, so
      // "already ran today" is false, but only 11 hours ago, so not overdue.
      lastFullSyncIso: "2026-06-15T02:00:00.000Z",
      lastRunIso: "2026-06-15T02:00:00.000Z",
    });
    ok("the daily full sync does not fire before its hour", d.code !== "daily_full");
    ok("and the reason given is about the schedule, not a failure", d.needsAttention === false);
  }
  {
    // The full sync outranks the delta: sending a PUT and then a POST in the
    // same window transmits the same data twice.
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-14T11:05:00.000Z", // yesterday => full is due
      lastRunIso: "2026-06-15T18:00:00.000Z", // an hour ago => delta also due
    });
    ok("the full sync outranks the delta", d.method === "POST");
  }
  {
    // MUTATION GAP M10. Every fixture above is either never-synced or more than
    // DAILY_CATCHUP_HOURS stale, so `fullOverdue` is true in all of them and the
    // left half of the OR -- the owner's chosen hour -- was never what decided
    // the outcome. Dropping the hour gate entirely therefore changed nothing any
    // assertion could see, while in production it means the daily sync stops
    // happening at 4am and instead drifts about twenty hours later every time.
    //
    // This fixture is deliberately the one case that isolates the hour gate:
    // 2026-06-15T02:00Z is 19:00 PDT on 06-14, so it is a DIFFERENT Pacific day
    // ("not run today" is true) but only 17 hours ago, so `fullOverdue` is
    // FALSE. The only thing that can fire the daily sync here is hour 12 >= 4.
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-15T02:00:00.000Z",
      lastRunIso: "2026-06-15T02:00:00.000Z",
    });
    ok(
      "the fixture isolates the hour gate: it is NOT overdue",
      dailyFullIsOverdue(base.nowIso, "2026-06-15T02:00:00.000Z") === false,
    );
    ok(
      "the fixture isolates the hour gate: today's full sync has not run",
      dailyAlreadyRan(base.nowIso, "2026-06-15T02:00:00.000Z") === false,
    );
    ok("past the configured hour, the daily full sync fires on the hour gate alone", d.code === "daily_full");
    ok("and it is a full POST, not a delta", d.method === "POST");
  }

  // --- the Pacific day boundary, which is the whole reason rule 9 exists ---
  {
    // 2026-06-15T06:30:00Z is 23:30 PDT on the 14th — the PREVIOUS Pacific day,
    // even though it is the 15th in UTC. A naive UTC comparison would call this
    // "today" and skip a day's authoritative sync.
    ok(
      "the day key is Pacific, not UTC",
      dailyAlreadyRan("2026-06-15T19:00:00.000Z", "2026-06-15T06:30:00.000Z") === false,
    );
    ok(
      "the same Pacific day is recognised",
      dailyAlreadyRan("2026-06-15T19:00:00.000Z", "2026-06-15T11:05:00.000Z") === true,
    );
  }
  {
    // MUTATION GAP M21. Both fixtures above sit in the same month, so a day key
    // that dropped its month ("2026-06-15" -> "2026-15") still compared
    // correctly in every case the suite tried. Across months it collides, and
    // the consequence is the worst kind: on the 15th of July the scheduler would
    // believe June's sync was today's and skip the authoritative push, silently,
    // once a month.
    ok(
      "the same day of a DIFFERENT month is not 'already ran'",
      dailyAlreadyRan("2026-06-15T19:00:00.000Z", "2026-05-15T19:00:00.000Z") === false,
    );
    // And the same day of a different YEAR, which a key of just the day-of-month
    // would also collide on.
    ok(
      "the same date of a DIFFERENT year is not 'already ran'",
      dailyAlreadyRan("2026-06-15T19:00:00.000Z", "2025-06-15T19:00:00.000Z") === false,
    );
  }
  ok("no previous full sync is not 'already ran'", dailyAlreadyRan(NOON_PDT, null) === false);
  ok("unparseable previous sync is not 'already ran'", dailyAlreadyRan(NOON_PDT, "banana") === false);
  ok(
    "a future previous sync is not 'already ran'",
    dailyAlreadyRan(NOON_PDT, "2026-06-16T19:00:00.000Z") === false,
  );

  // --- 7. the intraday delta ----------------------------------------------
  {
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-15T11:05:00.000Z",
      lastRunIso: "2026-06-15T17:55:00.000Z", // 65 min ago, > 60
    });
    ok("the delta runs when due", d.shouldRun === true);
    ok("the delta uses PUT", d.method === "PUT");
    ok("the delta reports intraday_delta", d.code === "intraday_delta");
  }
  {
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-15T11:05:00.000Z",
      lastRunIso: "2026-06-15T18:40:00.000Z", // 20 min ago, < 60
    });
    ok("the delta waits until due", d.shouldRun === false);
    ok("a waiting delta reports not_due", d.code === "not_due");
  }
  {
    const d = decideScheduledRun({
      ...base,
      settings: { ...base.settings, intradayEnabled: false },
      lastFullSyncIso: "2026-06-15T11:05:00.000Z",
      lastRunIso: "2026-06-15T11:05:00.000Z",
    });
    ok("intraday off means nothing between full syncs", d.shouldRun === false);
    ok("intraday off reports not_due", d.code === "not_due");
    ok("intraday off explains the button remains", /push button/i.test(describeSchedule(d0Settings())));
  }

  // --- 7b. SLICE L-34: the intraday boundary, pinned for the first time -----
  //
  // Before L-34 no test pinned WHERE the delta becomes due; the two cases above
  // are 65 and 20 minutes, far from the edge. That left the tolerance below
  // (and any off-by-one in it) completely unguarded. Mutation-checked in
  // scripts/recon/l34-mutation-check.sh.
  {
    const lastFull = "2026-06-15T11:05:00.000Z";
    const at = (minsAgo: number) =>
      decideScheduledRun({
        ...base,
        lastFullSyncIso: lastFull,
        lastRunIso: new Date(Date.parse(NOON_PDT) - minsAgo * 60_000).toISOString(),
      });
    const edge = INTRADAY_MINUTES_DEFAULT - INTRADAY_DUE_TOLERANCE_MINUTES;
    ok("L-34: exactly (interval - tolerance) after the last run IS due", at(edge).shouldRun === true);
    ok(
      "L-34: one second short of (interval - tolerance) is NOT due",
      at(edge - 1 / 60).shouldRun === false,
    );
    ok(
      "L-34: a tick landing 5 seconds short of the interval is due (the Pro " +
        "precision case that would otherwise push only every other tick)",
      at(INTRADAY_MINUTES_DEFAULT - 5 / 60).shouldRun === true,
    );
    ok(
      "L-34: the tolerance is small next to the smallest interval",
      INTRADAY_DUE_TOLERANCE_MINUTES > 0 &&
        INTRADAY_DUE_TOLERANCE_MINUTES * 5 <= INTRADAY_MINUTES_MIN,
    );
    ok(
      "L-34: even the smallest interval minus the tolerance stays ABOVE the " +
        "hard floor, so the tolerance can never let two runs come closer " +
        "than MIN_RUN_GAP_MINUTES",
      INTRADAY_MINUTES_MIN - INTRADAY_DUE_TOLERANCE_MINUTES > MIN_RUN_GAP_MINUTES,
    );
  }

  // --- 7c. SLICE L-34: refusals are not runs (summarizeRunHistory) ----------
  {
    const h = (d: string, m: number) => ({
      disposition: d,
      startedAt: new Date(Date.parse(NOON_PDT) - m * 60_000).toISOString(),
    });
    const empty = summarizeRunHistory([]);
    ok("L-34: an empty log has no last run", empty.lastRunIso === null);
    ok("L-34: an empty log has no failures", empty.consecutiveFailures === 0);

    const r1 = summarizeRunHistory([h("refused", 1), h("refused", 16), h("success", 31)]);
    ok(
      "L-34: REFUSALS DO NOT RESET THE CLOCK - the last run is the success " +
        "31 min ago, not the refusal 1 min ago (Defect A)",
      r1.lastRunIso === h("success", 31).startedAt,
    );
    const r2 = summarizeRunHistory([
      h("failed", 5),
      h("refused", 10),
      h("failed", 40),
      h("refused", 50),
      h("failed", 70),
      h("success", 100),
    ]);
    ok(
      "L-34: REFUSALS DO NOT BREAK THE FAILURE STREAK - three failures with " +
        "refusals between them are three, so backoff actually engages",
      r2.consecutiveFailures === 3,
    );
    ok("L-34: ...and the last run is the newest failure", r2.lastRunIso === h("failed", 5).startedAt);
    const r3 = summarizeRunHistory([h("failed", 5), h("skipped", 20), h("failed", 40)]);
    ok(
      "L-34: 'skipped' still BREAKS the streak (nothing to send = healthy)",
      r3.consecutiveFailures === 1,
    );
    ok("L-34: 'skipped' IS a run for timing", summarizeRunHistory([h("skipped", 7)]).lastRunIso !== null);
    ok(
      "L-34: a log of only refusals has NO last run - so the next due check " +
        "is not blocked by the scheduler's own commentary",
      summarizeRunHistory([h("refused", 1), h("refused", 2)]).lastRunIso === null,
    );
    ok(
      "L-34: an unknown future disposition counts as a run and breaks the " +
        "streak (fail towards NOT hammering Leafly)",
      summarizeRunHistory([h("mystery", 3), h("failed", 9)]).consecutiveFailures === 0 &&
        summarizeRunHistory([h("mystery", 3)]).lastRunIso !== null,
    );
  }

  // --- 7d. SLICE L-34: refusal log heartbeat (shouldRecordRefusal) ----------
  {
    const rec = (code: string, disp: string, minsAgo: number) => ({
      decisionCode: code,
      disposition: disp,
      startedAt: new Date(Date.parse(NOON_PDT) - minsAgo * 60_000).toISOString(),
    });
    const routine = { code: "not_due" as const, needsAttention: false };
    const want = (d: typeof routine | { code: ScheduledRunCode; needsAttention: boolean }, last: ReturnType<typeof rec> | null) =>
      shouldRecordRefusal({ decision: d, lastRecorded: last, nowIso: NOON_PDT });
    ok("L-34: 'disabled' is never recorded", !want({ code: "disabled", needsAttention: false }, null));
    ok("L-34: first refusal ever is recorded", want(routine, null));
    ok("L-34: same routine refusal 15 min later is NOT recorded", !want(routine, rec("not_due", "refused", 15)));
    ok(
      "L-34: same routine refusal at the heartbeat IS recorded (proof of life)",
      want(routine, rec("not_due", "refused", REFUSAL_HEARTBEAT_MINUTES)),
    );
    ok("L-34: a DIFFERENT refusal code is recorded", want(routine, rec("quiet_hours", "refused", 5)));
    ok(
      "L-34: a routine refusal 5 min after a REAL RUN is not recorded - the " +
        "run itself proves the cron is alive",
      !want(routine, rec("intraday_delta", "success", 5)),
    );
    ok(
      "L-34: ...but once the run is heartbeat-old, the refusal IS recorded",
      want(routine, rec("intraday_delta", "success", REFUSAL_HEARTBEAT_MINUTES)),
    );
    ok(
      "L-34: a refusal after a FAILED run within the hour is not duplicated " +
        "(the failure row is the evidence)",
      !want(routine, rec("intraday_delta", "failed", 5)),
    );
    ok(
      "L-34: a problem refusal right after a failure IS recorded at once",
      want({ code: "backoff", needsAttention: true }, rec("intraday_delta", "failed", 1)),
    );
    ok(
      "L-34: ...but the SAME problem refusal 15 min later is not duplicated",
      !want({ code: "backoff", needsAttention: true }, rec("backoff", "refused", 15)),
    );
    ok(
      "L-34: ...and is re-recorded hourly while it persists",
      want({ code: "backoff", needsAttention: true }, rec("backoff", "refused", REFUSAL_HEARTBEAT_MINUTES)),
    );
    ok(
      "L-34: a DIFFERENT problem refusal is recorded at once",
      want({ code: "not_configured", needsAttention: true }, rec("backoff", "refused", 1)),
    );
    {
      // An integration left enabled but unconfigured, ticking every 15 min.
      let n = 0;
      let last: ReturnType<typeof rec> | null = null;
      for (let t = 0; t < 1440; t += 15) {
        const nowIso = new Date(Date.parse(NOON_PDT) + t * 60_000).toISOString();
        const d = { code: "not_configured" as const, needsAttention: true };
        if (shouldRecordRefusal({ decision: d, lastRecorded: last, nowIso })) {
          n += 1;
          last = { decisionCode: "not_configured", disposition: "refused", startedAt: nowIso };
        }
      }
      ok(`L-34: a day unconfigured at */15 writes 24 rows, not 96 (got ${n})`, n === 24);
    }
    ok(
      "L-34: unparseable timing records (when in doubt, leave evidence)",
      want(routine, { decisionCode: "not_due", disposition: "refused", startedAt: "banana" }),
    );
    // Rows written per day at a 15-minute tick, all "not_due": 24, not 96.
    let written = 0;
    let last: ReturnType<typeof rec> | null = null;
    for (let t = 0; t < 1440; t += 15) {
      const nowIso = new Date(Date.parse(NOON_PDT) + t * 60_000).toISOString();
      if (shouldRecordRefusal({ decision: routine, lastRecorded: last, nowIso })) {
        written += 1;
        last = { decisionCode: "not_due", disposition: "refused", startedAt: nowIso };
      }
    }
    ok(`L-34: a day of routine refusals at */15 writes 24 rows, not 96 (got ${written})`, written === 24);
  }

  // --- 7f. SLICE L-34: concurrent scheduled-run start race ----------------
  {
    const N = "2026-06-15T19:00:10.000Z";
    const r = (id: string, startedAt: string) => ({ id, startedAt });
    const a = r("aaa", "2026-06-15T19:00:00.100Z");
    const b = r("bbb", "2026-06-15T19:00:00.200Z");
    ok("L-34 race: the earlier row wins", wonRunStartRace({ ownId: "aaa", rows: [a, b], nowIso: N }));
    ok("L-34 race: the later row stands down", !wonRunStartRace({ ownId: "bbb", rows: [a, b], nowIso: N }));
    ok("L-34 race: order of the rows read does not matter",
      !wonRunStartRace({ ownId: "bbb", rows: [b, a], nowIso: N }) &&
        wonRunStartRace({ ownId: "aaa", rows: [b, a], nowIso: N }));
    const t = "2026-06-15T19:00:00.000Z";
    ok("L-34 race: identical timestamps are broken by id, deterministically",
      wonRunStartRace({ ownId: "aaa", rows: [r("bbb", t), r("aaa", t)], nowIso: N }) &&
        !wonRunStartRace({ ownId: "bbb", rows: [r("bbb", t), r("aaa", t)], nowIso: N }));
    ok("L-34 race: alone, a run always proceeds", wonRunStartRace({ ownId: "aaa", rows: [a], nowIso: N }));
    ok("L-34 race: own row missing from the read = proceed (never all stand down)",
      wonRunStartRace({ ownId: "zzz", rows: [a, b], nowIso: N }));
    const stale = r("old", "2026-06-15T18:00:00.000Z");
    ok("L-34 race: a STALE abandoned row does not beat a live run",
      wonRunStartRace({ ownId: "bbb", rows: [stale, b], nowIso: N }));
    ok("L-34 race: rows with no id or time are ignored",
      wonRunStartRace({ ownId: "bbb", rows: [{ id: null, startedAt: t }, { id: "x", startedAt: null }, b], nowIso: N }));
    // Exhaustive: for every set of 1..4 concurrent runs, in every read order,
    // exactly ONE run proceeds.
    const ids = ["r1", "r2", "r3", "r4"];
    const times = ["2026-06-15T19:00:00.000Z", "2026-06-15T19:00:00.000Z", "2026-06-15T19:00:00.300Z", "2026-06-15T19:00:01.000Z"];
    let sets = 0;
    let allOne = true;
    for (let n = 1; n <= 4; n++) {
      const rows = ids.slice(0, n).map((id, i) => r(id, times[i]!));
      const perms: (typeof rows)[] = [];
      const permute = (arr: typeof rows, acc: typeof rows) => {
        if (arr.length === 0) { perms.push(acc); return; }
        arr.forEach((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...acc, x]));
      };
      permute(rows, []);
      for (const view of perms) {
        sets += 1;
        const winners = rows.filter((x) => wonRunStartRace({ ownId: x.id, rows: view, nowIso: N })).length;
        if (winners !== 1) allOne = false;
      }
    }
    ok("L-34 race: exactly one winner for every run count and read order (33 cases)", allOne && sets === 33);
  }

  // --- 7d2. SLICE L-34: a skipped daily POST is the day's full sync (Defect E)
  {
    ok("L-34: a successful POST is full-sync evidence", isFullSyncEvidence({ method: "POST", disposition: "success", decisionCode: "daily_full" }));
    ok("L-34: a manual successful POST is evidence", isFullSyncEvidence({ method: "POST", disposition: "success", decisionCode: "manual_requested" }));
    ok(
      "L-34: a SKIPPED scheduled daily_full IS evidence - Leafly already holds " +
        "exactly what the POST would send",
      isFullSyncEvidence({ method: null, disposition: "skipped", decisionCode: "daily_full" }),
    );
    ok(
      "L-34: a skipped INTRADAY run is not evidence of a full sync",
      !isFullSyncEvidence({ method: null, disposition: "skipped", decisionCode: "intraday_delta" }),
    );
    ok("L-34: a failed POST is not evidence", !isFullSyncEvidence({ method: "POST", disposition: "failed", decisionCode: "daily_full" }));
    ok("L-34: a refused daily_full is not evidence", !isFullSyncEvidence({ method: null, disposition: "refused", decisionCode: "daily_full" }));
    ok("L-34: a successful intraday PUT is not evidence", !isFullSyncEvidence({ method: "PUT", disposition: "success", decisionCode: "intraday_delta" }));
    ok("L-41: a manual PUT is not evidence", !isFullSyncEvidence({ method: "PUT", disposition: "success", decisionCode: "manual_requested" }));
    ok(
      "L-41: a successful scheduled daily_full sent as PUT (products held back) IS evidence",
      isFullSyncEvidence({ method: "PUT", disposition: "success", decisionCode: "daily_full" }),
    );
    ok("L-41: a FAILED daily_full PUT is not evidence", !isFullSyncEvidence({ method: "PUT", disposition: "failed", decisionCode: "daily_full" }));
    ok("L-41: a failed daily_full with no verb (refused plan) is not evidence", !isFullSyncEvidence({ method: null, disposition: "failed", decisionCode: "daily_full" }));
    // The query string and the predicate must describe the same three cases.
    ok(
      "L-41: the server filter names the three evidence cases and nothing else",
      FULL_SYNC_EVIDENCE_FILTER.split("),and(").length === 3 &&
        /method\.eq\.POST,disposition\.eq\.success/.test(FULL_SYNC_EVIDENCE_FILTER) &&
        /decision_code\.eq\.daily_full,disposition\.eq\.success/.test(FULL_SYNC_EVIDENCE_FILTER) &&
        /decision_code\.eq\.daily_full,disposition\.eq\.skipped/.test(FULL_SYNC_EVIDENCE_FILTER),
    );
    // And they agree row-by-row over every combination the table allows.
    {
      const methods = [null, "POST", "PUT", "DELETE"];
      const dispositions = ["success", "skipped", "refused", "failed"];
      const codes = ["daily_full", "intraday_delta", "manual_requested", "not_due"];
      const groups = FULL_SYNC_EVIDENCE_FILTER.replace(/^and\(/, "").replace(/\)$/, "").split("),and(");
      const matchFilter = (r: { method: string | null; disposition: string; decisionCode: string }) =>
        groups.some((g) =>
          g.split(",").every((c) => {
            const [col, , val] = c.split(".");
            const v = col === "method" ? r.method : col === "disposition" ? r.disposition : r.decisionCode;
            return v === val;
          }),
        );
      let agree = 0;
      let total = 0;
      for (const method of methods)
        for (const disposition of dispositions)
          for (const decisionCode of codes) {
            total += 1;
            if (matchFilter({ method, disposition, decisionCode }) === isFullSyncEvidence({ method, disposition, decisionCode })) agree += 1;
          }
      ok(`L-41: the filter and the predicate agree on all ${total} row shapes`, agree === total && total === 64);
    }
  }

  // --- 7e. SLICE L-34: END-TO-END TICK SIMULATION (Defect A, reproduced) ----
  //
  // Drives the REAL decideScheduledRun + summarizeRunHistory + shouldRecord-
  // Refusal through six trading hours of cron ticks, writing rows exactly as
  // runScheduledLeaflySync does. This is the probe that found Defect A,
  // folded into the permanent self-tests so it can never silently return.
  {
    let lastRows = 0;
    const simulate = (tickMin: number, intradayMinutes: number): number => {
      type Row = { decisionCode: string; disposition: string; startedAt: string };
      const log: Row[] = []; // newest first
      const startMs = Date.parse(NOON_PDT) - 3 * 3_600_000; // 9am PDT
      const lastFull = new Date(startMs - 5 * 3_600_000).toISOString(); // 4am
      let pushes = 0;
      for (let t = 0; t <= 6 * 60; t += tickMin) {
        const nowIso = new Date(startMs + t * 60_000 + 3_000).toISOString(); // +3s latency
        const hist = summarizeRunHistory(log);
        const d = decideScheduledRun({
          nowIso,
          settings: { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, intradayMinutes },
          configured: true,
          lastFullSyncIso: lastFull,
          lastRunIso: hist.lastRunIso ?? lastFull,
          consecutiveFailures: hist.consecutiveFailures,
          runInFlightSinceIso: null,
          manualInFlightSinceIso: null,
        });
        if (d.shouldRun) {
          pushes += 1;
          log.unshift({ decisionCode: d.code, disposition: "success", startedAt: nowIso });
        } else if (shouldRecordRefusal({ decision: d, lastRecorded: log[0] ?? null, nowIso })) {
          log.unshift({ decisionCode: d.code, disposition: "refused", startedAt: nowIso });
        }
      }
      lastRows = log.length;
      return pushes;
    };
    const p15_60 = simulate(15, 60);
    const rows15_60 = lastRows;
    ok(
      `L-34: 15-min ticks with the default 60-min setting push about hourly ` +
        `over 6 trading hours (got ${p15_60}; before L-34 it was 1)`,
      p15_60 >= 6 && p15_60 <= 7,
    );
    const p15_15 = simulate(15, 15);
    ok(
      `L-34: 15-min ticks with a 15-min setting push on EVERY tick (got ${p15_15} of 25)`,
      p15_15 === 25,
    );
    const p5_60 = simulate(5, 60);
    ok(
      `L-34: even 5-min ticks keep the owner's hourly cadence (got ${p5_60})`,
      p5_60 >= 6 && p5_60 <= 7,
    );
    const p5_15 = simulate(5, 15);
    ok(
      `L-34: the log stays readable at 15-min ticks - no more rows than ` +
        `pushes plus one heartbeat per hour (got ${rows15_60} rows)`,
      rows15_60 <= 7 + 6,
    );
    ok(
      `L-34: the 10-minute hard floor still holds at 5-min ticks - 15-min ` +
        `setting never pushes more than every 15 (got ${p5_15})`,
      p5_15 <= 25,
    );
    // A QUIET DAY: nothing on the menu changes, so every push is SKIPPED.
    // 3am-3pm PDT at */15, yesterday's full sync at 4am. The full-sync
    // evidence is derived with isFullSyncEvidence, exactly as the server does.
    {
      type QRow = { decisionCode: string; disposition: string; startedAt: string; method: string | null };
      const log: QRow[] = [];
      const start = Date.parse("2026-06-15T10:00:00.000Z"); // 3am PDT
      let lastFull: string | null = new Date(start - 23 * 3_600_000).toISOString();
      let fulls = 0;
      let deltas = 0;
      for (let t = 0; t <= 12 * 60; t += 15) {
        const nowIso = new Date(start + t * 60_000 + 3_000).toISOString();
        const hist = summarizeRunHistory(log);
        const d = decideScheduledRun({
          nowIso,
          settings: { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true },
          configured: true,
          lastFullSyncIso: lastFull,
          lastRunIso: hist.lastRunIso,
          consecutiveFailures: hist.consecutiveFailures,
          runInFlightSinceIso: null,
          manualInFlightSinceIso: null,
        });
        if (d.shouldRun) {
          if (d.code === "daily_full") fulls += 1;
          else deltas += 1;
          const row = { decisionCode: d.code, disposition: "skipped", startedAt: nowIso, method: null };
          log.unshift(row);
          if (isFullSyncEvidence(row)) lastFull = nowIso;
        } else if (shouldRecordRefusal({ decision: d, lastRecorded: log[0] ?? null, nowIso })) {
          log.unshift({ decisionCode: d.code, disposition: "refused", startedAt: nowIso, method: null });
        }
      }
      ok(
        `L-34 (Defect E): on a quiet day the daily full sync is attempted ONCE ` +
          `(got ${fulls}; before L-34 every tick re-attempted it: 49 of 49)`,
        fulls === 1,
      );
      ok(
        `L-34 (Defect E): ...and the hourly update check still runs after it ` +
          `(got ${deltas} between ~4am and 3pm)`,
        deltas >= 9 && deltas <= 12,
      );
    }
    const p60_60 = simulate(60, 60);
    ok(`L-34: hourly ticks with an hourly setting push every tick (got ${p60_60})`, p60_60 === 7);
  }

  function d0Settings(): LeaflyScheduleSettings {
    return { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, intradayEnabled: false };
  }

  // --- the active window ---------------------------------------------------
  ok("no window means always active", isWithinActiveWindow(3, null, null) === true);
  ok("a half-specified window is no window", isWithinActiveWindow(3, 9, null) === true);
  ok("inside a simple window", isWithinActiveWindow(10, 9, 17) === true);
  ok("outside a simple window", isWithinActiveWindow(8, 9, 17) === false);
  ok("the start hour is inclusive", isWithinActiveWindow(9, 9, 17) === true);
  ok("the end hour is exclusive", isWithinActiveWindow(17, 9, 17) === false);
  // A shop open late needs a window that wraps past midnight.
  ok("a wrapped window includes late evening", isWithinActiveWindow(22, 20, 2) === true);
  ok("a wrapped window includes early morning", isWithinActiveWindow(1, 20, 2) === true);
  ok("a wrapped window excludes the afternoon", isWithinActiveWindow(14, 20, 2) === false);
  // from === to must mean ALL DAY, not a zero-width window that silently
  // disables intraday syncing forever.
  ok("from === to means all day", isWithinActiveWindow(5, 12, 12) === true);
  {
    const d = decideScheduledRun({
      ...base,
      settings: { ...base.settings, activeFromHour: 20, activeToHour: 23 },
      lastFullSyncIso: "2026-06-15T11:05:00.000Z",
      lastRunIso: "2026-06-15T17:00:00.000Z",
    });
    ok("quiet hours suppress the delta", d.shouldRun === false);
    ok("quiet hours report quiet_hours", d.code === "quiet_hours");
    ok("quiet hours are not an error", d.needsAttention === false);
  }
  {
    // The DAILY full sync must NOT be suppressed by the active window: it is
    // usually configured for the small hours deliberately, so a daytime window
    // would silently cancel the authoritative sync — exactly the kind of
    // interaction bug that only shows up in production.
    const d = decideScheduledRun({
      ...base,
      nowIso: "2026-06-15T11:30:00.000Z", // 04:30 PDT
      settings: {
        ...base.settings,
        dailyFullHour: 4,
        activeFromHour: 9,
        activeToHour: 17,
      },
      lastFullSyncIso: "2026-06-14T11:05:00.000Z",
      lastRunIso: "2026-06-14T11:05:00.000Z",
    });
    ok("the active window never suppresses the daily full sync", d.code === "daily_full");
  }

  // --- settings resolution -------------------------------------------------
  {
    const r = resolveScheduleSettings(null);
    ok("null settings resolve to the defaults", r.enabled === DEFAULT_SCHEDULE_SETTINGS.enabled);
    ok("automation defaults OFF", r.enabled === false);
    ok("the default daily hour is applied", r.dailyFullHour === DAILY_HOUR_DEFAULT);
  }
  {
    // Only a literal `true` enables automation. A truthy string must not.
    ok("the string 'true' does not enable automation", resolveScheduleSettings({ enabled: "true" }).enabled === false);
    ok("the number 1 does not enable automation", resolveScheduleSettings({ enabled: 1 }).enabled === false);
    ok("a literal true enables automation", resolveScheduleSettings({ enabled: true }).enabled === true);
  }
  {
    const r = resolveScheduleSettings({ intradayMinutes: 1 });
    ok("intraday minutes clamp UP to the minimum", r.intradayMinutes === INTRADAY_MINUTES_MIN);
  }
  {
    const r = resolveScheduleSettings({ intradayMinutes: 99999 });
    ok("intraday minutes clamp DOWN to the maximum", r.intradayMinutes === INTRADAY_MINUTES_MAX);
  }
  {
    const r = resolveScheduleSettings({ intradayMinutes: "banana" });
    ok("unparseable intraday minutes fall back", r.intradayMinutes === INTRADAY_MINUTES_DEFAULT);
  }
  {
    const r = resolveScheduleSettings({ dailyFullHour: 99 });
    ok("the daily hour clamps to 23", r.dailyFullHour === DAILY_HOUR_MAX);
  }
  {
    const r = resolveScheduleSettings({ dailyFullHour: -5 });
    ok("a negative daily hour clamps to 0", r.dailyFullHour === DAILY_HOUR_MIN);
  }
  {
    const r = resolveScheduleSettings({ intradayEnabled: false });
    ok("intraday can be switched off explicitly", r.intradayEnabled === false);
    ok("intraday defaults on when unspecified", resolveScheduleSettings({}).intradayEnabled === true);
  }
  {
    // A half-specified window must resolve to NO window, so that "from 9" with
    // no end cannot become a 1-hour window.
    const r = resolveScheduleSettings({ activeFromHour: 9 });
    ok("a half window resolves to no window (from)", r.activeFromHour === null && r.activeToHour === null);
    const r2 = resolveScheduleSettings({ activeToHour: 17 });
    ok("a half window resolves to no window (to)", r2.activeFromHour === null && r2.activeToHour === null);
    const r3 = resolveScheduleSettings({ activeFromHour: 9, activeToHour: 17 });
    ok("a full window survives", r3.activeFromHour === 9 && r3.activeToHour === 17);
    const r4 = resolveScheduleSettings({ activeFromHour: "x", activeToHour: 17 });
    ok("an unparseable window end resolves to no window", r4.activeFromHour === null);
  }

  // --- wording -------------------------------------------------------------
  {
    const off = describeSchedule({ ...DEFAULT_SCHEDULE_SETTINGS, enabled: false });
    ok("off wording says it is off", /off/i.test(off));
    // The owner explicitly asked for BOTH. When automation is off the wording
    // must still point at the button, so the screen never reads as "no way to
    // sync".
    ok("off wording still points at the manual button", /push button/i.test(off));
  }
  {
    const on = describeSchedule({ ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, dailyFullHour: 4 });
    ok("on wording names the daily time", /4am/.test(on));
    ok("on wording says Pacific", /Pacific/.test(on));
    ok("on wording mentions hourly updates", /every hour/.test(on));
    ok("on wording promises no needless resends", /never resent/i.test(on));
  }
  // SLICE L-41: the repair choice is part of the sentence, so toggling it
  // makes the form "dirty" and the owner sees what he is about to change.
  {
    const base = { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, dailyFullHour: 4 };
    const without = describeSchedule(base);
    const withFix = describeSchedule({ ...base, repairSizes: true });
    ok("L41: repair on and off read differently", without !== withFix);
    ok("L41: repair off says the fix is not applied", /size fix is not applied/.test(without));
    ok("L41: repair on says the fix is applied first", /size fix is applied first/.test(withFix));
    ok("L41: both wordings promise failures are held back", /held back/.test(without) && /held back/.test(withFix));
    const dailyOnly = describeSchedule({ ...base, intradayEnabled: false, repairSizes: true });
    ok("L41: daily-only wording also carries the repair sentence", /size fix is applied first/.test(dailyOnly));
    ok("L41: off wording never mentions the repair", !/size fix/.test(describeSchedule({ ...base, enabled: false, repairSizes: true })));
  }
  {
    ok("L41: repairSizes defaults OFF", DEFAULT_SCHEDULE_SETTINGS.repairSizes === false);
    ok("L41: missing repairSizes resolves OFF", resolveScheduleSettings({}).repairSizes === false);
    ok("L41: true resolves ON", resolveScheduleSettings({ repairSizes: true }).repairSizes === true);
    ok("L41: the string 'true' does not turn it on", resolveScheduleSettings({ repairSizes: "true" }).repairSizes === false);
    ok("L41: 1 does not turn it on", resolveScheduleSettings({ repairSizes: 1 }).repairSizes === false);
  }
  {
    const w = describeSchedule({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      activeFromHour: 9,
      activeToHour: 17,
    });
    ok("window wording names both ends", /9am/.test(w) && /5pm/.test(w));
  }
  {
    const s2 = describeSchedule({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      intradayMinutes: 120,
    });
    ok("a 2-hour cadence reads as hours", /every 2 hours/.test(s2));
    const s3 = describeSchedule({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      intradayMinutes: 90,
    });
    ok("a 90-minute cadence reads as minutes", /every 90 minutes/.test(s3));
  }
  ok("midnight reads as 12am", describeSchedule({ ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, dailyFullHour: 0 }).includes("12am"));
  ok("noon reads as 12pm", describeSchedule({ ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, dailyFullHour: 12 }).includes("12pm"));

  // --- every code has a label and a tone, iterated over the OWN enum -------
  // Iterating the exported list rather than a hand-written copy means adding a
  // code without wording fails here instead of leaking snake_case to the owner.
  {
    let labelled = 0;
    for (const code of ALL_SCHEDULED_RUN_CODES) {
      const label = scheduleCodeLabel(code);
      ok(`code ${code} has a human label`, typeof label === "string" && label.length > 0);
      ok(`code ${code} label is not raw snake_case`, label !== null && !label.includes("_"));
      const tone = scheduleToneForCode(code);
      ok(
        `code ${code} has a known tone`,
        tone === "good" || tone === "waiting" || tone === "off" || tone === "bad",
      );
      labelled += 1;
    }
    // Non-vacuity guard: a loop that iterates zero times "passes" while
    // asserting nothing. This is the L-6 lesson, applied here deliberately.
    ok("the code sweep actually ran", labelled === ALL_SCHEDULED_RUN_CODES.length && labelled >= 10);
  }
  // Unknown values must never be prettified into something reassuring.
  ok("an unknown code has no label", scheduleCodeLabel("order_teleport") === null);
  ok("an unknown code is not painted good", scheduleToneForCode("order_teleport") === "bad");
  ok("a null code has no label", scheduleCodeLabel(null) === null);
  ok("an empty code has no label", scheduleCodeLabel("") === null);
  ok("only the two running codes are 'good'", ALL_SCHEDULED_RUN_CODES.filter((c) => scheduleToneForCode(c) === "good").length === 2);
  // MUTATION GAP M59. The sweep above asserted that every code has SOME known
  // tone, and the line above that exactly two are "good". Both stay true when a
  // genuine fault is repainted from "bad" to "waiting" -- so the two codes that
  // mean "this will never work until a human acts" could be downgraded to the
  // same calm colour as "not due yet", and nothing went red. That matters more
  // than it sounds: the panel's whole colour vocabulary depends on "waiting"
  // being ignorable. If real faults leak into it, the owner learns to ignore the
  // one colour that was supposed to mean "look at me".
  ok("missing credentials is a fault, not a wait", scheduleToneForCode("not_configured") === "bad");
  ok("a backed-off schedule is a fault, not a wait", scheduleToneForCode("backoff") === "bad");
  ok("disabled is its own tone, not a fault", scheduleToneForCode("disabled") === "off");
  // The whole partition, pinned by size. A code moving between classes now has
  // to break one of these four, whichever direction it moves in.
  {
    const byTone = (t: ScheduleTone) =>
      ALL_SCHEDULED_RUN_CODES.filter((c) => scheduleToneForCode(c) === t).length;
    ok("exactly two codes are good", byTone("good") === 2);
    ok("exactly five codes are waiting", byTone("waiting") === 5);
    ok("exactly one code is off", byTone("off") === 1);
    ok("exactly two codes are bad", byTone("bad") === 2);
    ok(
      "the four tone classes account for every code",
      byTone("good") + byTone("waiting") + byTone("off") + byTone("bad") ===
        ALL_SCHEDULED_RUN_CODES.length,
    );
  }

  // --- the cross-cutting invariant ----------------------------------------
  // Sweep a wide grid and assert the shape contract holds everywhere, so a new
  // branch cannot return an inconsistent decision.
  {
    let ran = 0;
    let sawRun = 0;
    let sawRefuse = 0;
    const hours = [0, 3, 4, 5, 9, 12, 17, 20, 23];
    for (const hour of hours) {
      // Build an instant at this Pacific hour on 2026-06-15 (PDT, UTC-7).
      const utcHour = (hour + 7) % 24;
      const day = hour + 7 >= 24 ? 16 : 15;
      const iso = `2026-06-${day}T${String(utcHour).padStart(2, "0")}:00:00.000Z`;
      for (const enabled of [true, false]) {
        for (const configured of [true, false]) {
          for (const intraday of [true, false]) {
            for (const fails of [0, 5]) {
              for (const lastFull of [null, "2026-06-15T11:05:00.000Z", "2026-06-14T11:05:00.000Z"]) {
                const d = decideScheduledRun({
                  nowIso: iso,
                  settings: {
                    ...DEFAULT_SCHEDULE_SETTINGS,
                    enabled,
                    intradayEnabled: intraday,
                  },
                  configured,
                  lastFullSyncIso: lastFull,
                  lastRunIso: lastFull,
                  consecutiveFailures: fails,
                  runInFlightSinceIso: null,
                  manualInFlightSinceIso: null,
                });
                ran += 1;
                // Shape contract: a method IFF running.
                if (d.shouldRun) {
                  sawRun += 1;
                  if (d.method === null) {
                    ok("running decisions always carry a method", false);
                  }
                  if (d.code !== "daily_full" && d.code !== "intraday_delta") {
                    ok("only the two run codes can run", false);
                  }
                } else {
                  sawRefuse += 1;
                  if (d.method !== null) {
                    ok("refusing decisions never carry a method", false);
                  }
                  if (d.code === "daily_full" || d.code === "intraday_delta") {
                    ok("run codes never appear on a refusal", false);
                  }
                }
                // Every decision must be explainable to a person.
                if (d.reason.trim().length === 0) {
                  ok("every decision carries a reason", false);
                }
                // A decision must never report a code this module cannot label.
                if (scheduleCodeLabel(d.code) === null) {
                  ok(`every emitted code is labelled (${d.code})`, false);
                }
              }
            }
          }
        }
      }
    }
    // Non-vacuity guards in BOTH directions: the sweep must have exercised
    // genuine runs AND genuine refusals, or it proves nothing.
    ok("the invariant sweep ran a meaningful number of cases", ran > 400);
    ok("the sweep saw real runs", sawRun > 10);
    ok("the sweep saw real refusals", sawRefuse > 10);
    ok("the shape contract held across the sweep", true);
  }

  // --- the Hobby-plan catch-up guarantee ----------------------------------
  // Measured platform limit: Vercel Hobby runs a cron AT MOST once per day, so
  // if an hour comparison can refuse the single daily tick, the menu freezes
  // forever. These assertions are the ones that stop that.
  {
    ok("never synced is overdue", dailyFullIsOverdue(NOON_PDT, null) === true);
    ok(
      "synced an hour ago is not overdue",
      dailyFullIsOverdue(NOON_PDT, "2026-06-15T18:00:00.000Z") === false,
    );
    ok(
      "synced 21 hours ago IS overdue",
      dailyFullIsOverdue(NOON_PDT, "2026-06-14T22:00:00.000Z") === true,
    );
    ok(
      "an unparseable last-sync counts as overdue, not as recent",
      dailyFullIsOverdue(NOON_PDT, "not-a-date") === true,
    );
    ok(
      "a future-dated last-sync counts as overdue, not as recent",
      dailyFullIsOverdue(NOON_PDT, "2027-01-01T00:00:00.000Z") === true,
    );
  }
  {
    // THE BUG THIS PREVENTS. The tick lands at 3am Pacific (winter drift of a
    // cron pinned to a UTC hour) while the owner asked for 4am. The hour test
    // alone would refuse, and on Hobby there is no second tick to recover --
    // the daily sync would never run again.
    const threeAmPst = "2026-01-15T11:00:00.000Z"; // 03:00 PST (UTC-8)
    ok("the winter tick really is hour 3 Pacific", pacificParts(new Date(Date.parse(threeAmPst))).hour === 3);
    const d = decideScheduledRun({
      ...base,
      nowIso: threeAmPst,
      settings: { ...base.settings, dailyFullHour: 4 },
      lastFullSyncIso: "2026-01-14T12:00:00.000Z", // ~23h earlier
      lastRunIso: "2026-01-14T12:00:00.000Z",
    });
    ok("a tick below the configured hour still runs the overdue full sync", d.shouldRun === true);
    ok("and it runs it as a full POST", d.method === "POST");
    ok("and reports it as the daily full sync", d.code === "daily_full");
    ok("and says WHY it ran off-schedule", /a day has gone by/i.test(d.reason));
  }
  {
    // The catch-up must not become a second daily sync. A full sync that
    // happened recently today must still be respected.
    const d = decideScheduledRun({
      ...base,
      lastFullSyncIso: "2026-06-15T18:00:00.000Z", // an hour ago
      lastRunIso: "2026-06-15T18:00:00.000Z",
      settings: { ...base.settings, intradayEnabled: false },
    });
    ok("a recent full sync is not re-run by the catch-up", d.code !== "daily_full");
    ok("and nothing is pushed", d.shouldRun === false);
  }
  {
    // The catch-up must never outrank the SAFETY checks. Being overdue is not a
    // licence to double-push, to ignore a person, or to hammer a broken API.
    const overdue = { ...base, lastFullSyncIso: "2026-06-13T12:00:00.000Z" };
    ok(
      "overdue still yields to a manual push",
      decideScheduledRun({ ...overdue, manualInFlightSinceIso: "2026-06-15T18:55:00.000Z" }).shouldRun === false,
    );
    ok(
      "overdue still yields to a run in flight",
      decideScheduledRun({ ...overdue, runInFlightSinceIso: "2026-06-15T18:55:00.000Z" }).shouldRun === false,
    );
    ok(
      "overdue still respects backoff",
      decideScheduledRun({ ...overdue, consecutiveFailures: 5, lastRunIso: "2026-06-15T18:55:00.000Z" }).shouldRun === false,
    );
    ok(
      "overdue still respects the hard gap floor",
      decideScheduledRun({ ...overdue, lastRunIso: "2026-06-15T18:56:00.000Z" }).shouldRun === false,
    );
    ok(
      "overdue is still refused when automation is off",
      decideScheduledRun({ ...overdue, settings: { ...overdue.settings, enabled: false } }).shouldRun === false,
    );
    ok(
      "overdue is still refused without credentials",
      decideScheduledRun({ ...overdue, configured: false }).shouldRun === false,
    );
  }
  {
    // A single daily tick, whatever hour it lands on, must ALWAYS produce the
    // full sync when yesterday's is stale. This is the Hobby guarantee stated
    // as a sweep over every hour of the day.
    let missed = 0;
    let ranFull = 0;
    for (let h = 0; h < 24; h += 1) {
      // Build an instant at Pacific hour h by walking UTC hours and checking.
      const iso = new Date(Date.UTC(2026, 5, 16, (h + 7) % 24, 30)).toISOString();
      const d = decideScheduledRun({
        ...base,
        nowIso: iso,
        // Yesterday-ish: more than the catch-up window.
        lastFullSyncIso: new Date(Date.parse(iso) - 25 * 3600 * 1000).toISOString(),
        lastRunIso: new Date(Date.parse(iso) - 25 * 3600 * 1000).toISOString(),
        settings: { ...base.settings, dailyFullHour: 4 },
      });
      if (d.code === "daily_full") ranFull += 1;
      else missed += 1;
    }
    ok("every hour of the day can carry the overdue full sync", missed === 0);
    ok("the hour sweep was not vacuous", ranFull === 24);
  }

  // --- the two halves of the owner's request coexist ----------------------
  // "Can we have both automation and a manual push button?" The scheduler must
  // never be the reason a manual push cannot happen, and vice versa. The
  // manual-yield test above covers one direction; this asserts the other: the
  // schedule being mid-cooldown is a decision about the SCHEDULE only, and is
  // reported without ever claiming the button is unavailable.
  {
    const d = decideScheduledRun({
      ...base,
      lastRunIso: "2026-06-15T18:58:00.000Z",
      lastFullSyncIso: "2026-06-15T11:05:00.000Z",
    });
    ok("a cooling-down schedule does not claim the button is blocked", !/cannot|unavailable|disabled/i.test(d.reason));
  }

  // =========================================================================
  // The presentation layer (section 7b).
  //
  // These are tested as hard as the decision logic, because a wrong WORD on
  // this panel is nearly as bad as a wrong decision: the owner acts on what he
  // reads. The specific failure being guarded against is a panel that says
  // something reassuring while the menu is frozen.
  // =========================================================================

  // --- formatPacificHour ---------------------------------------------------
  ok("hour 0 is 12am, not 0am", formatPacificHour(0) === "12am");
  ok("hour 12 is 12pm, not 0pm", formatPacificHour(12) === "12pm");
  ok("hour 4 is 4am", formatPacificHour(4) === "4am");
  ok("hour 13 is 1pm", formatPacificHour(13) === "1pm");
  ok("hour 23 is 11pm", formatPacificHour(23) === "11pm");
  // Defensive wrap: nothing should ever render "24am" or "-1am".
  ok("hour 24 wraps to 12am", formatPacificHour(24) === "12am");
  ok("hour -1 wraps to 11pm", formatPacificHour(-1) === "11pm");
  {
    // Non-vacuity: every legal hour must produce a label ending am or pm, and
    // the 24 labels must be distinct. A formatter that returned the same string
    // twice would make two dropdown entries indistinguishable.
    const labels = new Set<string>();
    for (let h = DAILY_HOUR_MIN; h <= DAILY_HOUR_MAX; h += 1) {
      labels.add(formatPacificHour(h));
    }
    ok("all 24 hour labels are distinct", labels.size === 24);
    let wellFormed = 0;
    for (const l of labels) if (/^(1[0-2]|[1-9])(am|pm)$/.test(l)) wellFormed += 1;
    ok("all 24 hour labels are well formed", wellFormed === 24);
  }

  // --- describeIntradayInterval + INTRADAY_CHOICES -------------------------
  ok("60 minutes reads as every hour", describeIntradayInterval(60) === "every hour");
  ok("120 minutes reads as every 2 hours", describeIntradayInterval(120) === "every 2 hours");
  ok("1440 minutes reads as every 24 hours", describeIntradayInterval(1440) === "every 24 hours");
  ok("15 minutes stays in minutes", describeIntradayInterval(15) === "every 15 minutes");
  ok("90 minutes stays in minutes", describeIntradayInterval(90) === "every 90 minutes");
  {
    // The offered choices must all survive the resolver unchanged. If any choice
    // were outside the clamp the dropdown would silently save a different value
    // than the one the owner picked -- the exact silent-correction problem the
    // dropdown exists to avoid.
    let unchanged = 0;
    for (const m of INTRADAY_CHOICES) {
      const r = resolveScheduleSettings({ intradayMinutes: m });
      if (r.intradayMinutes === m) unchanged += 1;
    }
    ok("every offered interval survives the resolver", unchanged === INTRADAY_CHOICES.length);
    ok("the interval choice list is not empty", INTRADAY_CHOICES.length >= 5);
    ok(
      "the interval choices are sorted ascending",
      INTRADAY_CHOICES.every((m, i) => i === 0 || m > INTRADAY_CHOICES[i - 1]!),
    );
    ok("the interval choices include the default", INTRADAY_CHOICES.includes(INTRADAY_MINUTES_DEFAULT));
    ok("the interval choices start at the floor", INTRADAY_CHOICES[0] === INTRADAY_MINUTES_MIN);
    ok(
      "the interval choices end at the ceiling",
      INTRADAY_CHOICES[INTRADAY_CHOICES.length - 1] === INTRADAY_MINUTES_MAX,
    );
  }

  // --- dispositionLabel / dispositionTone ----------------------------------
  ok("a null disposition means the run is still going", dispositionLabel(null) === "Running now");
  ok("an in-flight run is not painted as a failure", dispositionTone(null) === "waiting");
  ok("success reads as Sent", dispositionLabel("success") === "Sent");
  ok(
    "a no-op sync is not called skipped",
    dispositionLabel("skipped") === "Nothing to send",
  );
  // The important one: a skipped sync is the change detection WORKING.
  ok("a no-op sync is good news", dispositionTone("skipped") === "good");
  ok("a refusal is not an error", dispositionTone("refused") === "waiting");
  ok("a failure is bad", dispositionTone("failed") === "bad");
  ok("a blocked run is bad", dispositionTone("blocked") === "bad");
  // An unknown value must never be prettified or painted green.
  ok("an unknown disposition has no label", dispositionLabel("banana") === null);
  ok("an unknown disposition is treated as bad", dispositionTone("banana") === "bad");
  {
    let labelled = 0;
    for (const d of ALL_RUN_DISPOSITIONS) {
      const label = dispositionLabel(d);
      if (label !== null && label.length > 0 && !label.includes("_")) labelled += 1;
    }
    ok("every disposition has a human label", labelled === ALL_RUN_DISPOSITIONS.length);
    ok("the disposition list is not vacuous", ALL_RUN_DISPOSITIONS.length === 5);
  }
  {
    // Same guarantee for the decision codes, re-asserted here because the panel
    // renders them through these two functions and nothing else.
    let good = 0;
    for (const c of ALL_SCHEDULED_RUN_CODES) {
      const label = scheduleCodeLabel(c);
      if (label !== null && !label.includes("_")) good += 1;
    }
    ok("every decision code has a human label", good === ALL_SCHEDULED_RUN_CODES.length);
    ok("the decision code list is not vacuous", ALL_SCHEDULED_RUN_CODES.length === 10);
  }

  // --- describeElapsed -----------------------------------------------------
  {
    const now = "2026-06-15T19:00:00.000Z";
    ok("no timestamp reads as never", describeElapsed(null, now) === "never");
    ok("an empty timestamp reads as never", describeElapsed("", now) === "never");
    ok(
      "an unparseable timestamp is not rendered as a date",
      describeElapsed("banana", now) === "unknown",
    );
    ok(
      "seconds ago is not rendered as 0 minutes",
      describeElapsed("2026-06-15T18:59:40.000Z", now) === "less than a minute ago",
    );
    ok("one minute is singular", describeElapsed("2026-06-15T18:59:00.000Z", now) === "1 minute ago");
    ok("45 minutes ago", describeElapsed("2026-06-15T18:15:00.000Z", now) === "45 minutes ago");
    ok("one hour is singular", describeElapsed("2026-06-15T18:00:00.000Z", now) === "1 hour ago");
    ok("five hours ago", describeElapsed("2026-06-15T14:00:00.000Z", now) === "5 hours ago");
    ok("47 hours stays in hours", describeElapsed("2026-06-13T20:00:00.000Z", now) === "47 hours ago");
    ok("48 hours becomes days", describeElapsed("2026-06-13T19:00:00.000Z", now) === "2 days ago");
    // Future timestamps happen: a run row is written with started_at from the
    // server clock and read back by a browser whose clock is a minute behind.
    // "in 1 minute" is odd but honest; "-1 minutes ago" is a bug report.
    ok(
      "a future timestamp reads forwards, not negatively",
      describeElapsed("2026-06-15T19:30:00.000Z", now) === "in 30 minutes",
    );
    let negative = 0;
    for (const offset of [-90, -30, -1, 0, 1, 30, 90, 1500, 5000]) {
      const iso = new Date(Date.parse(now) + offset * 60000).toISOString();
      if (describeElapsed(iso, now).includes("-")) negative += 1;
    }
    ok("no elapsed string ever contains a minus sign", negative === 0);
  }

  // --- summarizeAutomation -------------------------------------------------
  {
    const NOW = "2026-06-15T19:00:00.000Z"; // noon PDT
    const on: LeaflyScheduleSettings = { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true };
    const healthy = {
      nowIso: NOW,
      settings: on,
      configured: true,
      nextDecision: null as ScheduledRunDecision | null,
      lastFullSyncIso: "2026-06-15T11:05:00.000Z", // 4am PDT today
      lastRunIso: "2026-06-15T18:00:00.000Z",
      consecutiveFailures: 0,
      problem: null as string | null,
    };

    // 1. Unreadable history outranks everything, including "off". If we cannot
    //    read the log we do not know the owner's setting was honoured either.
    const blind = summarizeAutomation({
      ...healthy,
      settings: DEFAULT_SCHEDULE_SETTINGS,
      problem: "connection refused",
    });
    ok("an unreadable history is reported as such", blind.headline === "Cannot check");
    ok("an unreadable history needs attention", blind.needsAttention);
    ok("an unreadable history quotes the actual error", blind.detail.includes("connection refused"));

    // 2. Off is calm, and must promise the button still works -- that is the
    //    owner's explicit requirement ("both automation and a manual push
    //    button"), and an owner who reads "Off" and panics has been failed.
    const off = summarizeAutomation({ ...healthy, settings: DEFAULT_SCHEDULE_SETTINGS });
    ok("automation off is reported as off", off.headline === "Off");
    ok("automation off is not an alarm", off.tone === "off" && !off.needsAttention);
    ok("automation off still mentions the push button", /push button/i.test(off.detail));

    // 3. On without credentials can never work, and says so.
    const noCreds = summarizeAutomation({ ...healthy, configured: false });
    ok("on without credentials needs attention", noCreds.needsAttention);
    ok("on without credentials is bad", noCreds.tone === "bad");

    // 4. Backoff.
    const failing = summarizeAutomation({
      ...healthy,
      consecutiveFailures: BACKOFF_AFTER_FAILURES,
    });
    ok("repeated failures are reported", failing.headline === "Failing");
    ok("repeated failures need attention", failing.needsAttention);
    ok("the failure count is stated, not vague", failing.detail.includes(String(BACKOFF_AFTER_FAILURES)));

    // 5. First run not yet done is WAITING, not broken. A brand-new install
    //    must not open on a red panel.
    const fresh = summarizeAutomation({ ...healthy, lastFullSyncIso: null });
    ok("a never-synced schedule is waiting, not failing", fresh.tone === "waiting");
    ok("a never-synced schedule does not need attention", !fresh.needsAttention);

    // 6. THE SILENT-FREEZE CASE. This is the assertion the whole panel exists
    //    for: the schedule is enabled, configured, nothing has failed, and the
    //    next tick is calmly "not due" -- but the authoritative sync has not
    //    landed for two days. A summary built from nextDecision alone would say
    //    "Not due" in green over a frozen menu.
    const calmNotDue: ScheduledRunDecision = {
      shouldRun: false,
      method: null,
      code: "not_due",
      reason: "Nothing is due right now.",
      needsAttention: false,
    };
    const frozen = summarizeAutomation({
      ...healthy,
      nextDecision: calmNotDue,
      lastFullSyncIso: new Date(Date.parse(NOW) - 50 * 3600 * 1000).toISOString(),
    });
    ok("a frozen menu is reported as overdue", frozen.headline === "Overdue");
    ok("a frozen menu needs attention", frozen.needsAttention);
    ok("a frozen menu is not painted green", frozen.tone === "bad");
    ok("a frozen menu says how long it has been", /days ago/.test(frozen.detail));
    // And prove the guard is not vacuous: the SAME calm decision over a fresh
    // sync must read healthy. Without this, the test above would also pass for
    // a function that returned "Overdue" unconditionally.
    const fine = summarizeAutomation({ ...healthy, nextDecision: calmNotDue });
    ok("a healthy schedule with nothing due is not overdue", fine.headline === "Running");
    ok("a healthy schedule does not need attention", !fine.needsAttention);
    ok("a healthy schedule is green", fine.tone === "good");
    ok("a healthy schedule explains what is next", fine.detail.includes("Nothing is due right now."));
    ok("a healthy schedule states when the last full sync was", /ago/.test(fine.detail));

    // 7. The overdue threshold is the constant, not a coincidence. One hour
    //    inside the window is healthy; one hour outside it is overdue.
    const justInside = summarizeAutomation({
      ...healthy,
      nextDecision: calmNotDue,
      lastFullSyncIso: new Date(Date.parse(NOW) - (DAILY_CATCHUP_HOURS - 1) * 3600 * 1000).toISOString(),
    });
    const justOutside = summarizeAutomation({
      ...healthy,
      nextDecision: calmNotDue,
      lastFullSyncIso: new Date(Date.parse(NOW) - (DAILY_CATCHUP_HOURS + 1) * 3600 * 1000).toISOString(),
    });
    ok("just inside the catch-up window is healthy", justInside.headline === "Running");
    ok("just outside the catch-up window is overdue", justOutside.headline === "Overdue");

    // 8. No summary may ever render a raw field name or a snake_case code.
    const everySummary = [blind, off, noCreds, failing, fresh, frozen, fine, justInside, justOutside];
    let leaked = 0;
    for (const sm of everySummary) {
      if (/intradayMinutes|dailyFullHour|activeFromHour|not_due|daily_full|undefined|NaN/.test(
          `${sm.headline} ${sm.detail}`,
        )) {
        leaked += 1;
      }
    }
    ok("no summary leaks a field name, a raw code, undefined or NaN", leaked === 0);
    ok("the leak sweep was not vacuous", everySummary.length === 9);
    let complete = 0;
    for (const sm of everySummary) {
      if (sm.headline.length > 0 && sm.detail.length > 20 && sm.detail.trim() === sm.detail) {
        complete += 1;
      }
    }
    ok("every summary has a headline and a real sentence", complete === everySummary.length);
    // needsAttention and tone must agree: an attention-needing summary painted
    // green, or a green one demanding attention, is a UI that contradicts itself.
    let incoherent = 0;
    for (const sm of everySummary) {
      if (sm.needsAttention && sm.tone !== "bad") incoherent += 1;
      if (!sm.needsAttention && sm.tone === "bad") incoherent += 1;
    }
    ok("tone and needsAttention never contradict each other", incoherent === 0);
  }

  // --- assessCadenceAgainstLeafly -----------------------------------------
  {
    const off = assessCadenceAgainstLeafly(DEFAULT_SCHEDULE_SETTINGS);
    ok("cadence with automation off does not meet the recommendation", !off.meetsRecommendation);
    ok("cadence off explains why hand pushes are the problem", /hand-pressed|checklist/i.test(off.finding));

    const dailyOnly = assessCadenceAgainstLeafly({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      intradayEnabled: false,
    });
    ok("daily-only is half the recommendation", !dailyOnly.meetsRecommendation);
    ok("daily-only names the missing half", /intraday/i.test(dailyOnly.finding));
    ok("daily-only states the configured hour in words", dailyOnly.finding.includes("4am"));

    const full = assessCadenceAgainstLeafly({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      intradayEnabled: true,
      intradayMinutes: 60,
    });
    ok("daily plus intraday meets the recommendation", full.meetsRecommendation);
    ok("the met verdict quotes the interval in words", full.finding.includes("every hour"));

    const windowed = assessCadenceAgainstLeafly({
      ...DEFAULT_SCHEDULE_SETTINGS,
      enabled: true,
      intradayEnabled: true,
      intradayMinutes: 120,
      activeFromHour: 8,
      activeToHour: 21,
    });
    ok("an active window still meets the recommendation", windowed.meetsRecommendation);
    ok("an active window is disclosed", windowed.finding.includes("8am"));
    ok(
      "an active window says the daily sync is unaffected",
      /regardless/i.test(windowed.finding),
    );

    // The quoted recommendation must be identical in every verdict and must be
    // the vendored constant -- never re-typed per branch.
    let quoted = 0;
    for (const v of [off, dailyOnly, full, windowed]) {
      if (v.recommendation === LEAFLY_CADENCE_RECOMMENDATION) quoted += 1;
    }
    ok("every cadence verdict quotes Leafly identically", quoted === 4);
    ok(
      "the vendored recommendation still matches the certification wording",
      LEAFLY_CADENCE_RECOMMENDATION ===
        "daily full POST + PUT/DELETE for intraday changes, or full POST several times per hour",
    );
  }

  return { passed, failed };
}
