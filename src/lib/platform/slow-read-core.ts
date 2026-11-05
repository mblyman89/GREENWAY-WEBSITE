/**
 * slow-read-core.ts - PERF P5 (owner 2026-11-05: "I want optimization and efficiency to be
 * paramount now that we are in live production"; AGENTS.md rule 18 "when you are unsure, measure").
 *
 * PURE. Decides whether a timed server read was slow and formats ONE greppable log line for the
 * Vercel runtime logs ("[slow-read] cockpit:sales-today 1840ms (budget 800ms) ok"). A slow
 * section then names itself in production instead of being guessed at.
 *
 * Budgets are deliberately generous: a log line per slow read, never per read, so the logs stay
 * quiet on a healthy day and loud only when something regresses.
 */

/** Default budget for one back-office read (a cache miss, not a cached hit). */
export const SLOW_READ_BUDGET_MS = 800;

/** Line prefix - grep the Vercel logs for this. */
export const SLOW_READ_TAG = "[slow-read]";

export type SlowReadVerdict = { slow: false } | { slow: true; line: string };

function cleanName(name: string): string {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return n === "" ? "unnamed" : n;
}

/**
 * `ms` is the measured duration; `ok` is whether the read succeeded. A FAILED read is always
 * reported when it was slow (a timeout is the most important line to see); a fast failure is the
 * caller's own error path, not a speed problem, so it is not logged here.
 */
export function judgeRead(name: string, ms: number, ok: boolean, budgetMs: number = SLOW_READ_BUDGET_MS): SlowReadVerdict {
  const dur = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? Math.round(budgetMs) : SLOW_READ_BUDGET_MS;
  if (dur <= budget) return { slow: false };
  return { slow: true, line: `${SLOW_READ_TAG} ${cleanName(name)} ${dur}ms (budget ${budget}ms) ${ok ? "ok" : "failed"}` };
}

export function __runSlowReadTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      messages.push(msg);
      console.error(`  FAIL slow-read-core: ${msg}`);
    }
  };

  ok(judgeRead("a", 10, true).slow === false, "fast read is quiet");
  ok(judgeRead("a", SLOW_READ_BUDGET_MS, true).slow === false, "exactly on budget is quiet");
  const v = judgeRead("cockpit:sales-today", 1840.4, true);
  ok(v.slow === true && v.line === "[slow-read] cockpit:sales-today 1840ms (budget 800ms) ok", "slow line format");
  const f = judgeRead("x", 5000, false);
  ok(f.slow === true && f.line.endsWith(" failed"), "slow failure says failed");
  ok(judgeRead("x", 5000, false).slow === true, "a slow timeout is always reported");
  ok(judgeRead("x", 100, false).slow === false, "a fast failure is not a speed problem");
  ok(judgeRead("x", 900, true, 1000).slow === false, "custom budget respected");
  const c = judgeRead("x", 900, true, -1);
  ok(c.slow === true && c.line.includes("budget 800ms"), "bad budget falls back to default");
  ok(judgeRead("x", Number.NaN, true).slow === false, "NaN duration is quiet");
  ok(judgeRead("x", -5, true).slow === false, "negative duration is quiet");
  const n = judgeRead("  a\n b  ", 900, true);
  ok(n.slow === true && n.line.startsWith("[slow-read] a b 900ms"), "name whitespace collapsed");
  const e = judgeRead("", 900, true);
  ok(e.slow === true && e.line.includes(" unnamed "), "empty name labelled");
  const long = judgeRead("y".repeat(500), 900, true);
  ok(long.slow === true && long.line.length < 200, "name length bounded");

  return { passed, failed, messages };
}
