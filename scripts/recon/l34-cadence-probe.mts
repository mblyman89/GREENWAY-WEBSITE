/**
 * scripts/recon/l34-cadence-probe.mts  (SLICE L-34)
 *
 * THE MEASUREMENT BEHIND THE CADENCE CHANGE. Run with:
 *
 *   npx tsx scripts/recon/l34-cadence-probe.mts
 *
 * Moving the Leafly crons from once a day (Vercel Hobby) to every few minutes
 * (Vercel Pro) is not just an edit to vercel.json: every piece of code those
 * crons call was written, and only ever exercised, at one tick per day. This
 * probe drives the REAL pure cores tick by tick at the new cadences and
 * prints what happens, BEFORE (the pre-L-34 read rules, re-implemented here
 * verbatim from the shipped server code) and AFTER (the L-34 code, imported).
 *
 * It found five defects; all five are fixed in L-34 and each is also pinned
 * by a permanent self-test in its own core:
 *
 *   A. menu sync   - refusal rows reset the clock -> intraday starved
 *   B. sweeper     - auto-cancelled orders reported "expired" forever
 *   C. sweeper     - 50 historic rows could hide a live order from the read
 *   D. webhooks    - the spec's `cancelReason` field was never read
 *   E. menu sync   - a SKIPPED daily POST never counted as the day's full
 *                    sync -> on a quiet day every tick re-attempted it
 *
 * (D is shown by webhook-parse-core's self-tests; this probe covers A-C, E
 * and the timing arithmetic behind the chosen cadence.)
 */
import {
  decideScheduledRun,
  DEFAULT_SCHEDULE_SETTINGS,
  isFullSyncEvidence,
  shouldRecordRefusal,
  summarizeRunHistory,
} from "../../src/lib/leafly/schedule-core";
import {
  decideSweepCandidate,
  SWEEP_DEADLINE_MARGIN_MS,
  SWEEP_EXPIRED_REPORT_MS,
  SWEEP_GRACE_MS,
  SWEEP_NULL_DEADLINE_MAX_AGE_MS,
  type SweepCandidate,
} from "../../src/lib/leafly/auto-ack-sweep-core";

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The PRE-L-34 sweep core, loaded byte-for-byte from the last commit before
 * this slice (fa2e3fbf, L-33 on main). A "before" that re-implements the old
 * rule from memory would be a guess; this is the shipped code.
 */
const BEFORE_REF = "fa2e3fbf";
const beforeDir = mkdtempSync(join(tmpdir(), "l34-before-"));
const beforePath = join(beforeDir, "auto-ack-sweep-core.ts");
writeFileSync(
  beforePath,
  execFileSync("git", ["show", `${BEFORE_REF}:src/lib/leafly/auto-ack-sweep-core.ts`]),
);
const beforeSweep = (await import(beforePath)) as {
  decideSweepCandidate: (c: SweepCandidate, nowMs: number) => { verdict: string };
};

const beforeSchedPath = join(beforeDir, "schedule-core.ts");
writeFileSync(
  beforeSchedPath,
  execFileSync("git", ["show", `${BEFORE_REF}:src/lib/leafly/schedule-core.ts`]),
);
const beforeSched = (await import(beforeSchedPath)) as {
  decideScheduledRun: typeof decideScheduledRun;
};

const NOON_PDT = Date.parse("2026-06-15T19:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

// ── PROBE 1: menu sync, six trading hours ──────────────────────────────────
type Row = { decisionCode: string; disposition: string; startedAt: string };

function simulateMenu(tickMin: number, intradayMinutes: number, mode: "before" | "after") {
  const log: Row[] = []; // newest first
  const start = NOON_PDT - 3 * 3_600_000; // 9am PDT
  const lastFull = iso(start - 5 * 3_600_000); // 4am full sync done
  let pushes = 0;
  let rows = 0;
  for (let t = 0; t <= 6 * 60; t += tickMin) {
    const nowIso = iso(start + t * 60_000 + 3_000); // +3 s cold-start latency
    let lastRunIso: string | null;
    let fails: number;
    if (mode === "before") {
      // Pre-L-34 schedule-server.readSyncRunFacts (server I/O, so its READ
      // RULE is restated here; the decision itself is the fa2e3fbf core):
      // lastRunIso = newest finished row of ANY disposition; the failure walk
      // breaks on the first non-failure.
      lastRunIso = log[0]?.startedAt ?? null;
      fails = 0;
      for (const r of log) {
        if (r.disposition === "failed") fails += 1;
        else break;
      }
    } else {
      const h = summarizeRunHistory(log);
      lastRunIso = h.lastRunIso;
      fails = h.consecutiveFailures;
    }
    const decide = mode === "before" ? beforeSched.decideScheduledRun : decideScheduledRun;
    const d = decide({
      nowIso,
      settings: { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, intradayMinutes },
      configured: true,
      lastFullSyncIso: lastFull,
      lastRunIso: lastRunIso ?? lastFull,
      consecutiveFailures: fails,
      runInFlightSinceIso: null,
      manualInFlightSinceIso: null,
    });
    if (d.shouldRun) {
      pushes += 1;
      rows += 1;
      log.unshift({ decisionCode: d.code, disposition: "success", startedAt: nowIso });
    } else {
      const write =
        mode === "before"
          ? d.code !== "disabled"
          : shouldRecordRefusal({ decision: d, lastRecorded: log[0] ?? null, nowIso });
      if (write) {
        rows += 1;
        log.unshift({ decisionCode: d.code, disposition: "refused", startedAt: nowIso });
      }
    }
  }
  return { pushes, rows };
}

console.log("PROBE 1 - menu sync, 9am-3pm PDT, daily full already done at 4am");
console.log("  tick  setting |  BEFORE pushes/rows |  AFTER pushes/rows");
for (const [tick, setting] of [
  [1440, 60],
  [60, 60],
  [15, 60],
  [15, 15],
  [15, 30],
  [5, 60],
  [5, 15],
] as const) {
  const b = simulateMenu(tick, setting, "before");
  const a = simulateMenu(tick, setting, "after");
  console.log(
    `  ${String(tick).padStart(4)}m ${String(setting).padStart(5)}m  | ` +
      `${String(b.pushes).padStart(9)} / ${String(b.rows).padStart(3)}     | ` +
      `${String(a.pushes).padStart(8)} / ${String(a.rows).padStart(3)}`,
  );
}

// ── PROBE 1b: a QUIET day - nothing changes, so every push is SKIPPED ─────
function quietDay(mode: "before" | "after") {
  type QRow = Row & { method: string | null };
  const log: QRow[] = [];
  const start = Date.parse("2026-06-15T10:00:00.000Z"); // 3am PDT
  let lastFull: string | null = iso(start - 23 * 3_600_000);
  const codes: Record<string, number> = {};
  for (let t = 0; t <= 12 * 60; t += 15) {
    const nowIso = iso(start + t * 60_000 + 3_000);
    const lastRunIso =
      mode === "before" ? (log[0]?.startedAt ?? null) : summarizeRunHistory(log).lastRunIso;
    const decide = mode === "before" ? beforeSched.decideScheduledRun : decideScheduledRun;
    const d = decide({
      nowIso,
      settings: { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true },
      configured: true,
      lastFullSyncIso: lastFull,
      lastRunIso,
      consecutiveFailures: 0,
      runInFlightSinceIso: null,
      manualInFlightSinceIso: null,
    });
    codes[d.code] = (codes[d.code] ?? 0) + 1;
    if (d.shouldRun) {
      const row = { decisionCode: d.code, disposition: "skipped", startedAt: nowIso, method: null };
      log.unshift(row);
      // BEFORE: only method=POST + success counted (pre-L-34 fullQ).
      if (mode === "after" && isFullSyncEvidence(row)) lastFull = nowIso;
    } else if (
      mode === "before"
        ? d.code !== "disabled"
        : shouldRecordRefusal({ decision: d, lastRecorded: log[0] ?? null, nowIso })
    ) {
      log.unshift({ decisionCode: d.code, disposition: "refused", startedAt: nowIso, method: null });
    }
  }
  return { codes, rows: log.length };
}
console.log("\nPROBE 1b - quiet day (menu unchanged, every push SKIPPED), */15, 3am-3pm PDT");
console.log("  BEFORE:", JSON.stringify(quietDay("before")));
console.log("  AFTER: ", JSON.stringify(quietDay("after")));

// ── PROBE 2: a historic auto-cancelled order, seen by every sweep tick ─────
console.log("\nPROBE 2 - a day-old order Leafly auto-cancelled (spec cancel webhook has no status)");
const historic: SweepCandidate = {
  leaflyOrderId: "historic",
  acknowledgedAt: null,
  acknowledgeBy: iso(NOON_PDT - 24 * 3_600_000),
  firstSeenAt: iso(NOON_PDT - 24 * 3_600_000 - 15 * 60_000),
  leaflyStatus: "pending",
  canceledAt: iso(NOON_PDT - 24 * 3_600_000 + 60_000),
};
const before2 = beforeSweep.decideSweepCandidate(historic, NOW());
const after2 = decideSweepCandidate(historic, NOW());
console.log(`  BEFORE (${BEFORE_REF} core):  ${before2.verdict}  -> the route returns 502 on EVERY tick`);
console.log(`  AFTER  (L-34 core):     ${after2.verdict}`);
let beforeAlarms = 0;
let afterAlarms = 0;
for (let t = 0; t < 1440; t += 2) {
  const now = NOON_PDT + t * 60_000;
  const lostJustNow: SweepCandidate = {
    ...historic,
    canceledAt: null,
    acknowledgeBy: iso(NOON_PDT),
    firstSeenAt: iso(NOON_PDT - 15 * 60_000),
  };
  if (beforeSweep.decideSweepCandidate(lostJustNow, now).verdict === "expired") beforeAlarms += 1;
  if (decideSweepCandidate(lostJustNow, now).verdict === "expired") afterAlarms += 1;
}
console.log(`  one order lost at noon, no cancel webhook, */2 for 24 h: BEFORE ${beforeAlarms} alarms, AFTER ${afterAlarms}`);
const noCancelRow = decideSweepCandidate({ ...historic, canceledAt: null }, NOW());
console.log(`  AFTER, even if the cancel webhook never arrived: ${noCancelRow.verdict} (reported window ${SWEEP_EXPIRED_REPORT_MS / 60_000} min)`);

function NOW() {
  return NOON_PDT;
}

// ── PROBE 3: can historic rows crowd a live order out of the read? ─────────
console.log("\nPROBE 3 - LIMIT 50, oldest deadline first; one LIVE order among N historic expired rows");
const LIMIT = 50;
for (const n of [8, 49, 50, 200]) {
  const rows: SweepCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const dl = NOON_PDT - (i + 1) * 3_600_000;
    rows.push({
      leaflyOrderId: `old-${i}`,
      acknowledgedAt: null,
      acknowledgeBy: iso(dl),
      firstSeenAt: iso(dl - 15 * 60_000),
      leaflyStatus: "pending",
      canceledAt: null,
    });
  }
  const live: SweepCandidate = {
    leaflyOrderId: "LIVE",
    acknowledgedAt: null,
    acknowledgeBy: iso(NOON_PDT + 10 * 60_000),
    firstSeenAt: iso(NOON_PDT - 5 * 60_000),
    leaflyStatus: "pending",
    canceledAt: null,
  };
  const all = [...rows, live].sort(
    (a, b) => Date.parse(a.acknowledgeBy!) - Date.parse(b.acknowledgeBy!),
  );
  const beforeRead = all.slice(0, LIMIT);
  // AFTER: the same predicate the L-34 query sends to PostgREST.
  const floorDl = NOON_PDT - SWEEP_EXPIRED_REPORT_MS;
  const floorSeen = NOON_PDT - SWEEP_NULL_DEADLINE_MAX_AGE_MS;
  const afterRead = all
    .filter((r) => r.canceledAt == null)
    .filter((r) =>
      r.acknowledgeBy != null
        ? Date.parse(r.acknowledgeBy) >= floorDl
        : Date.parse(r.firstSeenAt!) >= floorSeen,
    )
    .slice(0, LIMIT);
  const seen = (xs: SweepCandidate[]) => xs.some((r) => r.leaflyOrderId === "LIVE");
  console.log(
    `  ${String(n).padStart(3)} historic | BEFORE live order read: ${seen(beforeRead) ? "yes" : "NO - auto-cancelled"}` +
      ` | AFTER: ${seen(afterRead) ? "yes" : "NO"} (rows read ${afterRead.length})`,
  );
}

// ── PROBE 4: how many chances does each cadence get per order? ─────────────
console.log("\nPROBE 4 - sweeper chances inside one order's actionable window (worst-case phase)");
const windowMs = 15 * 60_000 - SWEEP_GRACE_MS - SWEEP_DEADLINE_MARGIN_MS;
console.log(`  actionable window = 15 min - ${SWEEP_GRACE_MS / 60_000} min grace - ${SWEEP_DEADLINE_MARGIN_MS / 1000} s margin = ${windowMs / 60_000} min`);
for (const m of [1, 2, 3, 5, 10, 1440]) {
  const worst = Math.floor(windowMs / (m * 60_000));
  console.log(
    `  every ${String(m).padStart(4)} min -> ${String(worst).padStart(2)} chances per order, ${String(Math.round(1440 / m)).padStart(4)} invocations/day`,
  );
}
