/**
 * src/lib/platform/db-vitals-core.ts   (D193 · DB HEALTH round slice B)
 *
 * The pure half of the database vital signs. The owner (2026-11-06):
 *   "Every few hours the database will become "unhealthy" and I can't use the
 *    back office. ... Please look for ways you can add to the ai partnership
 *    so that it can help me self heal these issues now. I want a healthy db
 *    always."
 *
 * The server half (db-vitals-store.ts) asks the database for its readings
 * (public.platform_db_vitals, 0345) every 10 minutes and stores them. This
 * file turns one reading (and the reading before it) into:
 *   - a status (ok / warn / fail) and plain-English findings, each with what
 *     it means and what to do;
 *   - whether the database RESTARTED since the last reading (the start time
 *     moved), which is what Supabase's "unhealthy" email is about;
 *   - whether there are STUCK app sessions the self-heal may clear.
 *
 * What the self-heal may do is decided here too (healPlan): only app sessions,
 * only past the floors, never the owner's SQL editor. It changes no data.
 */

// ---------------------------------------------------------------------------
// 1. The reading (shape of platform_db_vitals())
// ---------------------------------------------------------------------------

export type StuckSession = { pid: number; role: string; state: string; secs: number; query: string };

export type DbVitals = {
  startedAt: string;
  checkedAt: string;
  maxConnections: number;
  connections: number;
  active: number;
  idle: number;
  idleInTx: number;
  appConnections: number;
  oldestIdleInTxSecs: number;
  longestActiveSecs: number;
  waitingOnLock: number;
  cacheHitRatio: number | null;
  blocksRead: number;
  deadlocks: number;
  tempBytes: number;
  dbBytes: number;
  stuck: StuckSession[];
};

export const VITALS_RPC = "platform_db_vitals";
export const HEAL_RPC = "platform_db_heal_stuck";
export const VITALS_KIND = "db_vitals";
export const HEAL_KIND = "db_heal";

/** Self-heal floors. The database clamps to its own floors (2 and 5) too. */
export const HEAL_IDLE_TX_MINUTES = 5;
export const HEAL_ACTIVE_MINUTES = 10;

/** Thresholds (fractions of max_connections, seconds, ratios). */
export const T = {
  connWarn: 0.7,
  connFail: 0.9,
  idleTxWarnSecs: 120,
  activeWarnSecs: 120,
  lockWarn: 5,
  cacheWarn: 0.95,
  /** A start time this far behind the previous one is clock noise, not a restart. */
  restartToleranceSecs: 5,
  /** Readings older than this mean the 10-minute check itself stopped. */
  staleMinutes: 30,
} as const;

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : d;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Parse the RPC answer. Null when it is not the expected shape (said so, never guessed). */
export function parseVitals(raw: unknown): DbVitals | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.started_at) || typeof r.max_connections === "undefined") return null;
  const stuck = Array.isArray(r.stuck)
    ? (r.stuck as unknown[]).flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        return [{ pid: num(o.pid), role: str(o.role), state: str(o.state), secs: num(o.secs), query: str(o.query).slice(0, 80) }];
      })
    : [];
  return {
    startedAt: str(r.started_at),
    checkedAt: str(r.checked_at),
    maxConnections: num(r.max_connections, 1) || 1,
    connections: num(r.connections),
    active: num(r.active),
    idle: num(r.idle),
    idleInTx: num(r.idle_in_tx),
    appConnections: num(r.app_connections),
    oldestIdleInTxSecs: num(r.oldest_idle_in_tx_secs),
    longestActiveSecs: num(r.longest_active_secs),
    waitingOnLock: num(r.waiting_on_lock),
    cacheHitRatio: r.cache_hit_ratio === null || typeof r.cache_hit_ratio === "undefined" ? null : num(r.cache_hit_ratio),
    blocksRead: num(r.blocks_read),
    deadlocks: num(r.deadlocks),
    tempBytes: num(r.temp_bytes),
    dbBytes: num(r.db_bytes),
    stuck,
  };
}

// ---------------------------------------------------------------------------
// 2. Findings
// ---------------------------------------------------------------------------

export type VitalsStatus = "ok" | "warn" | "fail";
export type FindingCode =
  | "restarted"
  | "unreachable"
  | "connections_high"
  | "connections_full"
  | "stuck_sessions"
  | "long_idle_tx"
  | "long_query"
  | "lock_pileup"
  | "cache_low"
  | "deadlocks"
  | "check_stale";

export type VitalsFinding = {
  code: FindingCode;
  severity: "warn" | "fail";
  /** What happened, one sentence. */
  what: string;
  /** What to do, one sentence. */
  todo: string;
  /** True when the Partner's "Clear stuck sessions" fix applies. */
  healable: boolean;
};

export type VitalsReport = {
  status: VitalsStatus;
  summary: string;
  findings: VitalsFinding[];
  restarted: boolean;
  vitals: DbVitals | null;
};

function mins(secs: number): string {
  const m = Math.round(secs / 60);
  return m <= 1 ? "about a minute" : `${m} minutes`;
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** Did the database start again since the previous reading? */
export function didRestart(prevStartedAt: string | null | undefined, startedAt: string): boolean {
  if (!prevStartedAt) return false;
  const a = ms(prevStartedAt);
  const b = ms(startedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b - a > T.restartToleranceSecs * 1000;
}

export const UPGRADE_TODO =
  "If this repeats, the database computer is too small for the traffic: in Supabase, Project Settings > Compute and Disk, move from Micro (1 GB) to Small (2 GB). Ask the Partner to check the numbers first.";

/** Build the report for one reading. `prevStartedAt` is the start time from the previous stored reading. */
export function buildVitalsReport(v: DbVitals | null, prevStartedAt: string | null, callError: string | null = null): VitalsReport {
  if (!v) {
    const what = callError
      ? `The database did not answer the vital-signs check: ${callError.slice(0, 200)}`
      : "The vital-signs check answered in an unexpected shape.";
    const missing = callError && /platform_db_vitals|PGRST202|42883/.test(callError);
    return {
      status: "fail",
      summary: missing ? "Vital signs are not installed yet (run migration 0345)." : "The database did not answer the vital-signs check.",
      findings: [
        {
          code: "unreachable",
          severity: "fail",
          what,
          todo: missing
            ? "Run supabase/migrations/0345_db_vitals.sql in the Supabase SQL editor."
            : "Open Supabase and look at the project status. If it says unhealthy or restarting, wait 3 minutes and run the check again. " + UPGRADE_TODO,
          healable: false,
        },
      ],
      restarted: false,
      vitals: null,
    };
  }

  const f: VitalsFinding[] = [];
  const restarted = didRestart(prevStartedAt, v.startedAt);
  if (restarted) {
    f.push({
      code: "restarted",
      severity: "fail",
      what: `The database restarted at ${v.startedAt.slice(0, 16).replace("T", " ")} UTC. For a few minutes before that the back office could not reach it (this is the Supabase "unhealthy" email).`,
      todo: "Nothing to undo: Postgres recovers on its own. The website now reads one shared copy instead of hammering the database. " + UPGRADE_TODO,
      healable: false,
    });
  }

  const share = v.connections / Math.max(1, v.maxConnections);
  if (share >= T.connFail) {
    f.push({
      code: "connections_full",
      severity: "fail",
      what: `${v.connections} of ${v.maxConnections} database connections are in use. New requests will be refused soon.`,
      todo: v.stuck.length ? "Press the Partner's \"Clear stuck sessions\" fix. If it stays full, check Supabase for a runaway job." : "Check Supabase > Database > Roles for who holds the connections. " + UPGRADE_TODO,
      healable: v.stuck.length > 0,
    });
  } else if (share >= T.connWarn) {
    f.push({
      code: "connections_high",
      severity: "warn",
      what: `${v.connections} of ${v.maxConnections} database connections are in use (normal is under half).`,
      todo: "Watch it. If it climbs, the Partner will offer to clear stuck sessions.",
      healable: v.stuck.length > 0,
    });
  }

  if (v.stuck.length > 0) {
    const oldest = Math.max(...v.stuck.map((s) => s.secs));
    f.push({
      code: "stuck_sessions",
      severity: "warn",
      what: `${v.stuck.length} app connection(s) are stuck (oldest ${mins(oldest)}): a request that stopped half way and kept its hold on the database.`,
      todo: "The 10-minute check clears these by itself. You can also press the Partner's \"Clear stuck sessions\" fix now. No data changes; an unfinished step is rolled back.",
      healable: true,
    });
  } else if (v.oldestIdleInTxSecs >= T.idleTxWarnSecs) {
    f.push({
      code: "long_idle_tx",
      severity: "warn",
      what: `A connection has been paused in the middle of a transaction for ${mins(v.oldestIdleInTxSecs)}.`,
      todo: "If it is your own SQL editor tab, finish or close it. Otherwise the check clears app connections after 5 minutes.",
      healable: false,
    });
  }
  if (v.stuck.length === 0 && v.longestActiveSecs >= T.activeWarnSecs) {
    f.push({
      code: "long_query",
      severity: "warn",
      what: `One database query has been running for ${mins(v.longestActiveSecs)}.`,
      todo: "If it is a report or a migration you started, let it finish. App queries are cancelled after 10 minutes.",
      healable: false,
    });
  }
  if (v.waitingOnLock >= T.lockWarn) {
    f.push({
      code: "lock_pileup",
      severity: "warn",
      what: `${v.waitingOnLock} requests are waiting for another one to let go of a row.`,
      todo: "Usually clears in seconds. If it does not, a stuck connection is holding the row: clear stuck sessions.",
      healable: v.stuck.length > 0,
    });
  }
  if (v.cacheHitRatio !== null && v.cacheHitRatio < T.cacheWarn && v.blocksRead > 100_000) {
    f.push({
      code: "cache_low",
      severity: "warn",
      what: `Only ${(v.cacheHitRatio * 100).toFixed(1)}% of reads come from memory (healthy is over 99%). The database is short of memory.`,
      todo: UPGRADE_TODO,
      healable: false,
    });
  }

  const status: VitalsStatus = f.some((x) => x.severity === "fail") ? "fail" : f.length ? "warn" : "ok";
  const pct = Math.round(share * 100);
  const summary =
    status === "ok"
      ? `Database healthy: ${v.connections}/${v.maxConnections} connections (${pct}%), nothing stuck, up since ${v.startedAt.slice(0, 16).replace("T", " ")} UTC.`
      : `${f[0]!.what}`.slice(0, 300);
  return { status, summary, findings: f, restarted, vitals: v };
}

/** True when the newest stored reading is too old (the 10-minute check itself stopped). */
export function isStale(lastCheckedAt: string | null, nowMs: number): boolean {
  if (!lastCheckedAt) return true;
  const t = ms(lastCheckedAt);
  return !Number.isFinite(t) || nowMs - t > T.staleMinutes * 60_000;
}

// ---------------------------------------------------------------------------
// 3. Self-heal plan
// ---------------------------------------------------------------------------

/** Roles the heal may touch. Mirrors v_app_roles in 0345; postgres (the owner's SQL editor) is never here. */
export const APP_ROLES: readonly string[] = ["authenticator", "anon", "authenticated", "service_role"];

export type HealPlan = { pids: number[]; idleTxMinutes: number; activeMinutes: number; sentence: string } | null;

/** Which stuck sessions the heal would clear. Null = nothing to do. */
export function healPlan(v: DbVitals | null): HealPlan {
  if (!v) return null;
  const pids = v.stuck
    .filter((s) => APP_ROLES.includes(s.role))
    .filter((s) => (s.state.startsWith("idle in transaction") ? s.secs >= HEAL_IDLE_TX_MINUTES * 60 : s.state === "active" && s.secs >= HEAL_ACTIVE_MINUTES * 60))
    .map((s) => s.pid)
    .sort((a, b) => a - b);
  if (!pids.length) return null;
  return {
    pids,
    idleTxMinutes: HEAL_IDLE_TX_MINUTES,
    activeMinutes: HEAL_ACTIVE_MINUTES,
    sentence: `Clear ${pids.length} stuck app connection(s). Unfinished steps are rolled back; no saved data changes.`,
  };
}

export type HealResult = { ended: number; cancelled: number; failed: number };

export function parseHealResult(raw: unknown): HealResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.ended) || !Array.isArray(r.cancelled)) return null;
  return { ended: r.ended.length, cancelled: r.cancelled.length, failed: num(r.failed) };
}

export function healSentence(h: HealResult): string {
  if (h.ended + h.cancelled === 0) return h.failed ? `Could not clear ${h.failed} connection(s).` : "Nothing was stuck any more.";
  const parts: string[] = [];
  if (h.ended) parts.push(`ended ${h.ended} stuck connection(s)`);
  if (h.cancelled) parts.push(`stopped ${h.cancelled} runaway quer${h.cancelled === 1 ? "y" : "ies"}`);
  return `Cleared: ${parts.join(" and ")}.${h.failed ? ` ${h.failed} could not be cleared.` : ""}`;
}

/** Restarts in a list of stored readings (newest first), for "restarts this week". */
export function countRestarts(startTimesNewestFirst: readonly string[]): { count: number; at: string[] } {
  const at: string[] = [];
  for (let i = 0; i < startTimesNewestFirst.length - 1; i++) {
    const cur = startTimesNewestFirst[i]!;
    const prev = startTimesNewestFirst[i + 1]!;
    if (didRestart(prev, cur) && !at.includes(cur)) at.push(cur);
  }
  return { count: at.length, at };
}

/** One-line digest for the Partner's grounding. */
export function vitalsLine(r: VitalsReport): string {
  if (!r.vitals) return `DATABASE: ${r.summary}`;
  const v = r.vitals;
  return `DATABASE: ${r.status.toUpperCase()}. ${v.connections}/${v.maxConnections} connections, ${v.idleInTx} paused mid-transaction, ${v.stuck.length} stuck, longest query ${v.longestActiveSecs}s, cache ${v.cacheHitRatio === null ? "?" : (v.cacheHitRatio * 100).toFixed(1) + "%"}, size ${Math.round(v.dbBytes / 1_048_576)} MB, up since ${v.startedAt.slice(0, 16)} UTC.`;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runDbVitalsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`db-vitals-core FAIL: ${m}`);
    }
  };

  const raw = {
    started_at: "2026-11-06T02:28:36.92+00:00",
    checked_at: "2026-11-06T04:00:00+00:00",
    max_connections: 60,
    connections: 12,
    active: 2,
    idle: 10,
    idle_in_tx: 0,
    app_connections: 8,
    oldest_idle_in_tx_secs: 0,
    longest_active_secs: 1,
    waiting_on_lock: 0,
    cache_hit_ratio: 0.9991,
    blocks_read: 5000,
    deadlocks: 0,
    temp_bytes: 0,
    db_bytes: 541_000_000,
    stuck: [],
  };
  const v = parseVitals(raw)!;
  ok(v !== null && v.maxConnections === 60 && v.connections === 12, "parses the RPC answer");
  ok(parseVitals(null) === null && parseVitals([]) === null && parseVitals({ x: 1 }) === null, "bad shapes are null");
  ok(parseVitals({ ...raw, cache_hit_ratio: null })!.cacheHitRatio === null, "null cache ratio stays null");
  ok(parseVitals({ ...raw, max_connections: "60", connections: "7" })!.connections === 7, "numeric strings parse");

  const healthy = buildVitalsReport(v, "2026-11-06T02:28:36.92+00:00");
  ok(healthy.status === "ok" && healthy.findings.length === 0, "healthy reading is ok");
  ok(healthy.summary.startsWith("Database healthy"), "healthy summary");
  ok(!healthy.restarted, "same start time: no restart");

  const restarted = buildVitalsReport(v, "2026-11-05T21:09:55+00:00");
  ok(restarted.restarted && restarted.status === "fail", "a later start time is a restart (fail)");
  ok(restarted.findings[0]!.code === "restarted" && restarted.findings[0]!.todo.includes("Small"), "restart says what to do (upgrade)");
  ok(!didRestart(null, v.startedAt), "first reading ever: no restart");
  ok(!didRestart("2026-11-06T02:28:38+00:00", "2026-11-06T02:28:36+00:00"), "earlier/same start: no restart");
  ok(!didRestart("garbage", v.startedAt), "bad date: no restart claimed");

  const full = buildVitalsReport(parseVitals({ ...raw, connections: 56 })!, null);
  ok(full.status === "fail" && full.findings.some((x) => x.code === "connections_full"), "56/60 is full");
  const high = buildVitalsReport(parseVitals({ ...raw, connections: 45 })!, null);
  ok(high.status === "warn" && high.findings.some((x) => x.code === "connections_high"), "45/60 is high");

  const stuckRaw = {
    ...raw,
    idle_in_tx: 2,
    oldest_idle_in_tx_secs: 900,
    stuck: [
      { pid: 41, role: "authenticator", state: "idle in transaction", secs: 900, query: "select 1" },
      { pid: 42, role: "authenticator", state: "active", secs: 700, query: "select pg_sleep(1000)" },
      { pid: 43, role: "authenticator", state: "idle in transaction", secs: 200, query: "young" },
      { pid: 44, role: "postgres", state: "idle in transaction", secs: 9000, query: "owner editor" },
    ],
  };
  const sv = parseVitals(stuckRaw)!;
  const sr = buildVitalsReport(sv, null);
  ok(sr.findings.some((x) => x.code === "stuck_sessions" && x.healable), "stuck sessions are healable");
  ok(!sr.findings.some((x) => x.code === "long_idle_tx"), "stuck replaces the generic idle finding");
  const plan = healPlan(sv)!;
  ok(plan !== null && plan.pids.join() === "41,42", `heal plan picks only old app sessions: ${plan?.pids.join()}`);
  ok(!plan.pids.includes(44), "never the owner's SQL editor (postgres)");
  ok(!plan.pids.includes(43), "never a session under the floor");
  ok(healPlan(v) === null && healPlan(null) === null, "nothing stuck: no plan");
  ok(!APP_ROLES.includes("postgres") && !APP_ROLES.includes("supabase_admin"), "app roles exclude owner and platform roles");

  const idleOnly = buildVitalsReport(parseVitals({ ...raw, idle_in_tx: 1, oldest_idle_in_tx_secs: 200 })!, null);
  ok(idleOnly.findings.some((x) => x.code === "long_idle_tx" && !x.healable), "paused session (not yet stuck) is a warning only");
  const longQ = buildVitalsReport(parseVitals({ ...raw, longest_active_secs: 300 })!, null);
  ok(longQ.findings.some((x) => x.code === "long_query"), "long query warns");
  const locks = buildVitalsReport(parseVitals({ ...raw, waiting_on_lock: 7 })!, null);
  ok(locks.findings.some((x) => x.code === "lock_pileup"), "lock pile-up warns");
  const cache = buildVitalsReport(parseVitals({ ...raw, cache_hit_ratio: 0.9, blocks_read: 500_000 })!, null);
  ok(cache.findings.some((x) => x.code === "cache_low" && x.todo.includes("Small")), "low cache says upgrade");
  ok(!buildVitalsReport(parseVitals({ ...raw, cache_hit_ratio: 0.5, blocks_read: 10 })!, null).findings.length, "low cache on tiny volume is noise");

  const down = buildVitalsReport(null, "x", "fetch failed: connect ETIMEDOUT");
  ok(down.status === "fail" && down.findings[0]!.code === "unreachable", "no answer is fail/unreachable");
  const missing = buildVitalsReport(null, null, "Could not find the function public.platform_db_vitals (PGRST202)");
  ok(missing.summary.includes("0345") && missing.findings[0]!.todo.includes("0345_db_vitals.sql"), "missing function points at 0345");

  ok(isStale(null, Date.now()), "no reading is stale");
  ok(!isStale(new Date(Date.now() - 5 * 60_000).toISOString(), Date.now()), "5 minutes old is fresh");
  ok(isStale(new Date(Date.now() - 45 * 60_000).toISOString(), Date.now()), "45 minutes old is stale");

  ok(parseHealResult({ ended: [{}], cancelled: [], failed: 0 })!.ended === 1, "heal result parses");
  ok(parseHealResult({}) === null, "bad heal result is null");
  ok(healSentence({ ended: 1, cancelled: 2, failed: 0 }) === "Cleared: ended 1 stuck connection(s) and stopped 2 runaway queries.", "heal sentence");
  ok(healSentence({ ended: 0, cancelled: 0, failed: 0 }) === "Nothing was stuck any more.", "nothing-left sentence");

  const rs = countRestarts(["2026-11-06T02:28:36Z", "2026-11-06T02:28:36Z", "2026-11-05T21:09:55Z", "2026-11-05T21:09:55Z", "2026-11-01T00:00:00Z"]);
  ok(rs.count === 2 && rs.at[0] === "2026-11-06T02:28:36Z", `counts restarts across readings: ${rs.count}`);
  ok(vitalsLine(healthy).startsWith("DATABASE: OK. 12/60"), "partner line");
  ok(vitalsLine(down).startsWith("DATABASE: "), "partner line when down");

  return { passed, failed };
}
