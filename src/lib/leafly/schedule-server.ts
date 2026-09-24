import "server-only";

/**
 * src/lib/leafly/schedule-server.ts  (SLICE L-7)
 *
 * The I/O half of automatic Leafly menu syncing. Every DECISION lives in
 * `schedule-core.ts`, which is pure and provable in CI without a database; this
 * file's only job is to read the facts that decision needs, hold the lock, call
 * the EXISTING `pushLeaflyMenu()`, and record what happened.
 *
 * If you find yourself writing an `if` about whether a sync is due, it belongs
 * in the core, not here. The one thing this file is allowed to decide is how to
 * behave when the database is unreachable, and the answer is always "report a
 * problem, never throw, never push".
 *
 * WHY THE LOCK IS A ROW AND NOT AN ADVISORY LOCK
 * ----------------------------------------------
 * A Postgres advisory lock (`pg_try_advisory_lock`) is the textbook answer and
 * is wrong here. Advisory locks are tied to the SESSION, and our server code
 * talks to Supabase over pooled HTTP connections with no session affinity
 * whatsoever -- there is no stable session to own the lock, and a lock acquired
 * on one request would be released the moment that pooled connection was
 * recycled. So the lock is an unfinished row in `leafly_sync_runs`, with a
 * staleness cutoff (`STALE_RUN_MINUTES`) for the case a serverless function is
 * killed mid-run and cannot clear its own lock.
 *
 * That staleness cutoff is not a nicety. Without it, ONE crash disables
 * automatic syncing permanently and silently, which is precisely the failure
 * mode that makes people stop trusting automation.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  decideScheduledRun,
  resolveScheduleSettings,
  FULL_SYNC_EVIDENCE_FILTER,
  shouldRecordRefusal,
  summarizeRunHistory,
  STALE_RUN_MINUTES,
  BACKOFF_AFTER_FAILURES,
  type LeaflyScheduleSettings,
  type ScheduledRunDecision,
  type SyncMethod,
} from "./schedule-core";
import { getSyncSettingsRaw } from "@/lib/syndication/engine-store";
import { pushLeaflyMenu, isLeaflyConfigured, describeLeaflyReadinessAsync } from "./push";

const RUNS_TABLE = "leafly_sync_runs";
const CHANNEL = "leafly";

/** How many recent runs the UI shows. Small on purpose: this is a health strip,
 *  not an archive browser. */
export const RECENT_RUNS_LIMIT = 10;

export type SyncRunRow = {
  id: string;
  triggerSource: "schedule" | "manual" | string;
  decisionCode: string;
  pushed: boolean;
  method: string | null;
  disposition: string | null;
  httpStatus: number | null;
  itemCount: number | null;
  planSummary: string | null;
  reason: string | null;
  errorDetail: string | null;
  consecutiveFailures: number;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Columns read for the UI. Enumerated rather than `select("*")` deliberately:
 * an explicit list means adding a column to the table cannot silently start
 * shipping it to a browser. Same posture as `order-board-server.ts`.
 */
const RUN_COLUMNS =
  "id, trigger_source, decision_code, pushed, method, disposition, http_status, item_count, plan_summary, reason, error_detail, consecutive_failures, started_at, finished_at";

function mapRow(r: Record<string, unknown>): SyncRunRow {
  return {
    id: String(r.id ?? ""),
    triggerSource: String(r.trigger_source ?? ""),
    decisionCode: String(r.decision_code ?? ""),
    pushed: r.pushed === true,
    method: r.method == null ? null : String(r.method),
    disposition: r.disposition == null ? null : String(r.disposition),
    httpStatus: typeof r.http_status === "number" ? r.http_status : null,
    itemCount: typeof r.item_count === "number" ? r.item_count : null,
    planSummary: r.plan_summary == null ? null : String(r.plan_summary),
    reason: r.reason == null ? null : String(r.reason),
    errorDetail: r.error_detail == null ? null : String(r.error_detail),
    consecutiveFailures:
      typeof r.consecutive_failures === "number" ? r.consecutive_failures : 0,
    startedAt: String(r.started_at ?? ""),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Read the schedule settings out of the EXISTING per-channel settings blob
 * (`syndication_sync_settings`, migration 0119). No new settings table: rule 11.
 * Always returns a fully-resolved, clamped object -- the resolver defaults
 * everything, so a pre-migration or unreadable blob yields the safe defaults
 * (automation OFF) rather than a partial object.
 */
export async function getLeaflyScheduleSettings(): Promise<LeaflyScheduleSettings> {
  const raw = await getSyncSettingsRaw(CHANNEL).catch(() => null);
  return resolveScheduleSettings(raw);
}

// ---------------------------------------------------------------------------
// Reading the facts the decision needs
// ---------------------------------------------------------------------------

export type SyncRunFacts = {
  lastFullSyncIso: string | null;
  lastRunIso: string | null;
  consecutiveFailures: number;
  runInFlightSinceIso: string | null;
  manualInFlightSinceIso: string | null;
  /**
   * SLICE L-34. The newest finished row of ANY disposition, refusals
   * included. NOT used for timing (see `summarizeRunHistory`) — only to decide
   * whether a routine refusal needs writing (`shouldRecordRefusal`).
   */
  lastRecorded: {
    decisionCode: string | null;
    disposition: string | null;
    startedAt: string | null;
  } | null;
  /** True when the facts could not be read. The caller must NOT push. */
  problem: string | null;
};

/**
 * Gather everything `decideScheduledRun()` needs, in as few round trips as is
 * reasonable.
 *
 * On ANY read failure this returns `problem` set. The caller must treat that as
 * "do not push" rather than as "no history, so push freely" -- an unreadable
 * log is not evidence that nothing is in flight, and treating it as such is how
 * you get two concurrent full syncs.
 */
export async function readSyncRunFacts(): Promise<SyncRunFacts> {
  const empty: SyncRunFacts = {
    lastFullSyncIso: null,
    lastRunIso: null,
    consecutiveFailures: 0,
    runInFlightSinceIso: null,
    manualInFlightSinceIso: null,
    lastRecorded: null,
    problem: null,
  };

  if (!isSupabaseServiceConfigured) {
    return { ...empty, problem: "Supabase is not configured on the server." };
  }

  try {
    const admin = createSupabaseAdminClient();

    // Most recent FULL-SYNC EVIDENCE. Drives "has today's authoritative sync
    // happened". A POST that was refused or failed did not make Leafly's menu
    // match ours, so it does not count.
    //
    // SLICE L-34: a scheduled daily_full that was SKIPPED (nothing changed, so
    // Leafly already holds exactly what the POST would send) now counts too.
    // Before, it did not, and at Pro cadence every tick of a quiet day
    // re-attempted the full sync. The predicate is `isFullSyncEvidence` in
    // schedule-core (tested there); this filter is its query form.
    const fullQ = await admin
      .from(RUNS_TABLE)
      .select("started_at")
      .eq("channel", CHANNEL)
      .or(FULL_SYNC_EVIDENCE_FILTER)
      .order("started_at", { ascending: false })
      .limit(1);
    if (fullQ.error) return { ...empty, problem: fullQ.error.message };

    // Most recent finished row of ANY kind, refusals included. SLICE L-34:
    // this no longer drives timing -- it only tells the refusal writer what
    // the log already says, so a routine refusal is not written 96 times a day.
    const lastQ = await admin
      .from(RUNS_TABLE)
      .select("decision_code, disposition, started_at")
      .eq("channel", CHANNEL)
      .not("finished_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (lastQ.error) return { ...empty, problem: lastQ.error.message };

    // In-flight runs: unfinished rows. Uses the partial index from 0227.
    const flightQ = await admin
      .from(RUNS_TABLE)
      .select("trigger_source, started_at")
      .eq("channel", CHANNEL)
      .is("finished_at", null)
      .order("started_at", { ascending: false })
      .limit(20);
    if (flightQ.error) return { ...empty, problem: flightQ.error.message };

    // Timing + consecutive failures, from recent FINISHED runs newest-first.
    //
    // SLICE L-34: REFUSALS ARE EXCLUDED, both here in the query and again in
    // the pure `summarizeRunHistory` (the query is the optimisation, the core
    // is the rule). A refusal is the scheduler recording that it did NOT run;
    // before L-34 it reset `lastRunIso` and broke the failure streak, which
    // the L-34 cadence probe measured starving intraday syncs to one in six
    // hours at a fifteen-minute cron. See schedule-core section 6b.
    //
    // 'skipped' deliberately BREAKS the failure streak: the push layer returns
    // skipped when nothing changed since the last successful sync, which means
    // the integration is healthy and simply had nothing to say. Counting that
    // as a failure would back the scheduler off for being efficient.
    const recentQ = await admin
      .from(RUNS_TABLE)
      .select("disposition, started_at")
      .eq("channel", CHANNEL)
      .not("finished_at", "is", null)
      .neq("disposition", "refused")
      .order("started_at", { ascending: false })
      .limit(50);
    if (recentQ.error) return { ...empty, problem: recentQ.error.message };

    const history = summarizeRunHistory(
      ((recentQ.data ?? []) as { disposition?: string | null; started_at?: string | null }[]).map(
        (r) => ({ disposition: r.disposition ?? null, startedAt: r.started_at ?? null }),
      ),
    );

    let runInFlight: string | null = null;
    let manualInFlight: string | null = null;
    for (const row of (flightQ.data ?? []) as {
      trigger_source?: string;
      started_at?: string;
    }[]) {
      const started = row.started_at ?? null;
      if (!started) continue;
      if (row.trigger_source === "manual" && manualInFlight === null) manualInFlight = started;
      if (row.trigger_source === "schedule" && runInFlight === null) runInFlight = started;
    }

    const fullRow = (fullQ.data ?? [])[0] as { started_at?: string } | undefined;
    const lastRow = (lastQ.data ?? [])[0] as
      | { decision_code?: string | null; disposition?: string | null; started_at?: string | null }
      | undefined;

    return {
      lastFullSyncIso: fullRow?.started_at ?? null,
      lastRunIso: history.lastRunIso,
      consecutiveFailures: history.consecutiveFailures,
      runInFlightSinceIso: runInFlight,
      manualInFlightSinceIso: manualInFlight,
      lastRecorded: lastRow
        ? {
            decisionCode: lastRow.decision_code ?? null,
            disposition: lastRow.disposition ?? null,
            startedAt: lastRow.started_at ?? null,
          }
        : null,
      problem: null,
    };
  } catch (e) {
    return { ...empty, problem: e instanceof Error ? e.message : "Unknown error reading sync history." };
  }
}

// ---------------------------------------------------------------------------
// Writing the log
// ---------------------------------------------------------------------------

type OpenRunArgs = {
  triggerSource: "schedule" | "manual";
  decisionCode: string;
  reason: string | null;
  consecutiveFailures: number;
  createdBy?: string | null;
};

/**
 * Record the START of a run and return its id. The returned id is the lock:
 * the row has `finished_at is null` until `closeRun()` is called.
 *
 * Returns null when the row could not be written -- and the caller MUST then
 * abandon the run. Pushing without a lock row is how two concurrent full syncs
 * happen, and a full sync deletes anything omitted from its payload, so two of
 * them racing is not a cosmetic problem.
 */
async function openRun(args: OpenRunArgs): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(RUNS_TABLE)
      .insert({
        channel: CHANNEL,
        trigger_source: args.triggerSource,
        decision_code: args.decisionCode,
        pushed: false,
        reason: args.reason,
        consecutive_failures: args.consecutiveFailures,
        // A scheduled run has no actor, and 0227's CHECK enforces that.
        created_by: args.triggerSource === "manual" ? (args.createdBy ?? null) : null,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return String((data as { id: unknown }).id);
  } catch {
    return null;
  }
}

type CloseRunArgs = {
  id: string;
  pushed: boolean;
  method: SyncMethod | "DELETE" | null;
  /**
   * FOUR values here, not the five on `ScheduledSyncOutcome`. This is
   * deliberate and load-bearing.
   *
   * 'blocked' is missing on purpose. It means "we could not establish that
   * pushing was safe" -- the run history was unreadable, or the lock row could
   * not be inserted -- and in BOTH of those cases no row exists to close. So
   * 'blocked' is an in-memory outcome reported to the caller and to the owner,
   * never a stored disposition, which is why migration 0227's CHECK lists only
   * these four.
   *
   * DO NOT "fix" the apparent mismatch by adding 'blocked' to the CHECK or by
   * widening this type. Widening it would let a blocked outcome reach an UPDATE
   * that the constraint then rejects, from inside a catch block -- destroying
   * the evidence at precisely the moment evidence matters most. The narrow type
   * is what makes that unrepresentable, and tsc enforces it at every call site.
   */
  disposition: "success" | "skipped" | "refused" | "failed";
  httpStatus?: number | null;
  itemCount?: number | null;
  planSummary?: string | null;
  errorDetail?: string | null;
};

/**
 * Stamp a run finished. Best-effort by design: if this write fails, the row is
 * left unfinished and the staleness cutoff in the core will release the lock
 * within STALE_RUN_MINUTES. That is a deliberate trade -- a lost close is a
 * delayed next sync, whereas throwing here would turn a logging hiccup into a
 * failed menu push.
 */
async function closeRun(args: CloseRunArgs): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from(RUNS_TABLE)
      .update({
        pushed: args.pushed,
        method: args.method,
        disposition: args.disposition,
        http_status: args.httpStatus ?? null,
        item_count: args.itemCount ?? null,
        plan_summary: args.planSummary ?? null,
        error_detail: args.errorDetail ? args.errorDetail.slice(0, 2000) : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", args.id);
  } catch {
    // Intentionally swallowed. See the doc comment.
  }
}

// ---------------------------------------------------------------------------
// The scheduled run
// ---------------------------------------------------------------------------

export type ScheduledSyncOutcome = {
  decision: ScheduledRunDecision;
  /** Did we actually call Leafly? */
  pushed: boolean;
  disposition: "success" | "skipped" | "refused" | "failed" | "blocked";
  httpStatus: number | null;
  planSummary: string | null;
  itemCount: number | null;
  message: string;
};

/**
 * Called by `/api/cron/leafly-menu-sync`. Decides, and only then acts.
 *
 * The sequence matters and is the reason this function is not two functions:
 *
 *   1. Read facts. If they are unreadable, STOP -- do not push blind.
 *   2. Let the pure core decide.
 *   3. If it says no, record the refusal (a row, not an absence) and stop.
 *   4. If it says yes, open the lock row FIRST, then push, then close.
 */
export async function runScheduledLeaflySync(nowIso?: string): Promise<ScheduledSyncOutcome> {
  const now = nowIso ?? new Date().toISOString();
  const settings = await getLeaflyScheduleSettings();
  const facts = await readSyncRunFacts();

  // An unreadable log is not permission to push. Report and stop.
  if (facts.problem) {
    return {
      decision: {
        shouldRun: false,
        method: null,
        code: "run_in_flight",
        reason: `Could not read the sync history, so nothing was sent: ${facts.problem}`,
        needsAttention: true,
      },
      pushed: false,
      disposition: "blocked",
      httpStatus: null,
      planSummary: null,
      itemCount: null,
      message: `Sync history unreadable: ${facts.problem}`,
    };
  }

  // `isLeaflyConfigured()` reads a module-level config cache, so refresh it
  // through the same path the push layer uses before trusting it.
  await describeLeaflyReadinessAsync().catch(() => null);
  const configured = isLeaflyConfigured();

  const decision = decideScheduledRun({
    nowIso: now,
    settings,
    configured,
    lastFullSyncIso: facts.lastFullSyncIso,
    lastRunIso: facts.lastRunIso,
    consecutiveFailures: facts.consecutiveFailures,
    runInFlightSinceIso: facts.runInFlightSinceIso,
    manualInFlightSinceIso: facts.manualInFlightSinceIso,
  });

  if (!decision.shouldRun || decision.method === null) {
    // Record the refusal. This is the row that distinguishes "the cron ran and
    // correctly did nothing" from "the cron never ran", which is the single
    // most useful thing this log does.
    //
    // 'disabled' is the one code we do NOT log, because logging it would write
    // a row every hour forever while the feature is switched off, and a log
    // that is 99% "switched off" is a log nobody reads.
    //
    // SLICE L-34: the same reasoning now applies to ROUTINE refusals at Pro
    // cadence. `shouldRecordRefusal` keeps an hourly heartbeat per refusal
    // code, and always records anything needing attention. The rule lives in
    // the pure core (schedule-core section 6b) where it is tested.
    if (
      shouldRecordRefusal({ decision, lastRecorded: facts.lastRecorded, nowIso: now })
    ) {
      const id = await openRun({
        triggerSource: "schedule",
        decisionCode: decision.code,
        reason: decision.reason,
        consecutiveFailures: facts.consecutiveFailures,
      });
      if (id) {
        await closeRun({ id, pushed: false, method: null, disposition: "refused" });
      }
    }
    return {
      decision,
      pushed: false,
      disposition: "refused",
      httpStatus: null,
      planSummary: null,
      itemCount: null,
      message: decision.reason,
    };
  }

  // Open the lock BEFORE pushing. If we cannot, do not push.
  const runId = await openRun({
    triggerSource: "schedule",
    decisionCode: decision.code,
    reason: decision.reason,
    consecutiveFailures: facts.consecutiveFailures,
  });
  if (!runId) {
    return {
      decision,
      pushed: false,
      disposition: "blocked",
      httpStatus: null,
      planSummary: null,
      itemCount: null,
      message:
        "Could not record the sync run, so nothing was sent. Without that record two syncs could overlap, and a full sync deletes anything left out.",
    };
  }

  try {
    const result = await pushLeaflyMenu({ confirm: true, method: decision.method });
    const disposition = result.skipped ? "skipped" : result.ok ? "success" : "failed";
    await closeRun({
      id: runId,
      pushed: !result.skipped,
      method: result.skipped ? null : result.method,
      disposition,
      httpStatus: result.httpStatus || null,
      itemCount: result.itemCount,
      planSummary: result.planSummary,
      errorDetail: result.ok ? null : (result.message ?? "Leafly rejected the sync."),
    });
    return {
      decision,
      pushed: !result.skipped,
      disposition,
      httpStatus: result.httpStatus || null,
      planSummary: result.planSummary,
      itemCount: result.itemCount,
      message:
        result.skipped
          ? (result.message ?? "Nothing had changed since the last sync, so nothing was sent.")
          : result.ok
            ? `${decision.method} sync accepted by Leafly.`
            : (result.message ?? "Leafly rejected the sync."),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error during the Leafly sync.";
    await closeRun({
      id: runId,
      pushed: false,
      method: null,
      disposition: "failed",
      errorDetail: msg,
    });
    return {
      decision,
      pushed: false,
      disposition: "failed",
      httpStatus: null,
      planSummary: null,
      itemCount: null,
      message: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Manual runs: the button the owner asked to keep
// ---------------------------------------------------------------------------

/**
 * Record that a human started a manual push, returning the run id to close.
 *
 * This exists so the SCHEDULER can see a person working and stand aside
 * (`manual_in_flight`). It deliberately does NOT gate the button: a person who
 * has pressed "push now" has already decided, and second-guessing them with the
 * scheduler's due-ness logic would make the button feel broken.
 *
 * Returns null when the row could not be written. The caller should still let
 * the push proceed in that case -- the worst outcome is the scheduler not
 * knowing, which the STALE/cooldown logic tolerates, whereas blocking the
 * owner's button because a log write failed would be a worse trade.
 */
export async function beginManualRun(staffId: string | null): Promise<string | null> {
  return openRun({
    triggerSource: "manual",
    decisionCode: "manual_requested",
    reason: "Manual push from the integrations page.",
    consecutiveFailures: 0,
    createdBy: staffId,
  });
}

export async function finishManualRun(args: {
  id: string | null;
  ok: boolean;
  skipped: boolean;
  method: SyncMethod | "DELETE" | null;
  httpStatus?: number | null;
  itemCount?: number | null;
  planSummary?: string | null;
  errorDetail?: string | null;
}): Promise<void> {
  if (!args.id) return;
  await closeRun({
    id: args.id,
    pushed: !args.skipped && args.ok,
    method: args.skipped ? null : args.method,
    disposition: args.skipped ? "skipped" : args.ok ? "success" : "failed",
    httpStatus: args.httpStatus ?? null,
    itemCount: args.itemCount ?? null,
    planSummary: args.planSummary ?? null,
    errorDetail: args.errorDetail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Reading history for the UI
// ---------------------------------------------------------------------------

export type SyncHealth = {
  settings: LeaflyScheduleSettings;
  runs: SyncRunRow[];
  facts: SyncRunFacts;
  /** The decision the NEXT tick would make right now, for a live preview. */
  nextDecision: ScheduledRunDecision | null;
  configured: boolean;
  problem: string | null;
  staleRunMinutes: number;
  backoffAfterFailures: number;
};

/**
 * Everything the integrations page needs to show the schedule's health.
 * Never throws: an unreadable table means the panel reports a problem, not a
 * 500 on a settings page.
 */
export async function loadLeaflySyncHealth(): Promise<SyncHealth> {
  const settings = await getLeaflyScheduleSettings();
  const facts = await readSyncRunFacts();

  let runs: SyncRunRow[] = [];
  let problem = facts.problem;

  if (!problem && isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from(RUNS_TABLE)
        .select(RUN_COLUMNS)
        .eq("channel", CHANNEL)
        .order("started_at", { ascending: false })
        .limit(RECENT_RUNS_LIMIT);
      if (error) problem = error.message;
      else runs = ((data ?? []) as Record<string, unknown>[]).map(mapRow);
    } catch (e) {
      problem = e instanceof Error ? e.message : "Could not read the sync history.";
    }
  }

  let configured = false;
  try {
    await describeLeaflyReadinessAsync();
    configured = isLeaflyConfigured();
  } catch {
    configured = false;
  }

  // A live preview of what the next tick would do. Shown so the owner can see
  // the schedule reasoning without waiting an hour to find out.
  const nextDecision = problem
    ? null
    : decideScheduledRun({
        nowIso: new Date().toISOString(),
        settings,
        configured,
        lastFullSyncIso: facts.lastFullSyncIso,
        lastRunIso: facts.lastRunIso,
        consecutiveFailures: facts.consecutiveFailures,
        runInFlightSinceIso: facts.runInFlightSinceIso,
        manualInFlightSinceIso: facts.manualInFlightSinceIso,
      });

  return {
    settings,
    runs,
    facts,
    nextDecision,
    configured,
    problem,
    staleRunMinutes: STALE_RUN_MINUTES,
    backoffAfterFailures: BACKOFF_AFTER_FAILURES,
  };
}
