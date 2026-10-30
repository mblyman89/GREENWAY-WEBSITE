/**
 * src/lib/compliance/ccrs-hub-view-core.ts  (W-2, 2026-10-30). PURE.
 *
 * The CCRS hub (/admin/compliance/ccrs) used to wait for EVERY read before it
 * showed anything: the week's full batch build, the 36-query test scoreboard,
 * every file's issues (paged), the migration clean-up scan and the medical
 * evidence scan. The owner: "It is ridiculously slow."
 *
 * W-2 splits the page in two:
 *   - the SHELL (env switch, deadline banner, week picker, CCRS emails, Step 3
 *     ledger facts) renders from small reads only;
 *   - the HEAVY panels stream in behind <Suspense>, each from a promise that
 *     never rejects (a failed panel says so; the page never goes blank).
 *
 * This file holds the decisions both halves share, so they are unit-tested
 * and mutation-guarded instead of living only in JSX.
 */

/* ------------------------------------------------------------------ *
 * Settled reads: a streamed panel never throws the whole page away.
 * ------------------------------------------------------------------ */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/** Resolve to ok/error. NEVER rejects (a rejected promise shared by several
 *  Suspense slots would blank the whole page through the error boundary). */
export function settle<T>(p: PromiseLike<T> | (() => PromiseLike<T>)): Promise<Settled<T>> {
  let run: PromiseLike<T>;
  try {
    run = typeof p === "function" ? p() : p;
  } catch (e) {
    return Promise.resolve({ ok: false, error: errorText(e) });
  }
  return Promise.resolve(run).then(
    (value) => ({ ok: true as const, value }),
    (e: unknown) => ({ ok: false as const, error: errorText(e) }),
  );
}

export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const t = m.trim();
  return t ? t.slice(0, 500) : "unknown error";
}

/* ------------------------------------------------------------------ *
 * Selected week: explicit ?week= -> most urgent unresolved -> last completed -> current.
 * ------------------------------------------------------------------ */
export type WeekLike = { week: { key: string } };

export function pickSelectedWeek<W extends WeekLike>(
  o: { current: W; weeks: readonly W[]; mostUrgent: W | null },
  requestedKey: string | null,
): W {
  if (requestedKey) {
    const hit = [...o.weeks, o.current].find((w) => w.week.key === requestedKey);
    if (hit) return hit;
  }
  return o.mostUrgent ?? o.weeks[0] ?? o.current;
}

/* ------------------------------------------------------------------ *
 * Waiting files of the env on screen (the "answer them first" warning).
 * The shell reads waiting files of BOTH envs in one light query (no issues);
 * the warning shows only this env's, the email picker filters per email.
 * ------------------------------------------------------------------ */
export type EnvFileLite = { env: string; state: string };
export const WAITING_STATES: readonly string[] = ["emitted", "uploaded"];

export function waitingFilesOfEnv<F extends EnvFileLite>(files: readonly F[], env: string): F[] {
  return files.filter((f) => f.env === env && WAITING_STATES.includes(f.state));
}

/* ------------------------------------------------------------------ *
 * RecreationalMedical rows in the Sale file (the enum literal only ever
 * appears in the SaleType column).
 * ------------------------------------------------------------------ */
export function medicalSaleRowCount(files: ReadonlyArray<{ type: string; csv: string }> | null | undefined): number {
  const sale = (files ?? []).find((f) => String(f.type) === "Sale");
  if (!sale) return 0;
  return (sale.csv.match(/RecreationalMedical/g) ?? []).length;
}

/* ------------------------------------------------------------------ *
 * Step 3 buttons. A week whose batch could not be built is NOT recordable
 * either way: we do not know whether it has records.
 * ------------------------------------------------------------------ */
export type RecordGate = {
  /** "Record as SUBMITTED" may be pressed */
  submitted: boolean;
  /** "Record as NOTHING TO REPORT" may be pressed */
  nothing: boolean;
  /** why the submitted button is off (null = it is on) */
  submittedWhy: "build-failed" | "not-submittable" | "zero-records" | null;
  /** why the nothing button is off (null = it is on) */
  nothingWhy: "build-failed" | "has-records" | null;
};

export function recordGate(v: { built: boolean; submittable: boolean; totalRecords: number; nothingToReport: boolean }): RecordGate {
  if (!v.built) return { submitted: false, nothing: false, submittedWhy: "build-failed", nothingWhy: "build-failed" };
  const submittedWhy = !v.submittable ? "not-submittable" : v.nothingToReport ? "zero-records" : null;
  const nothingWhy = v.totalRecords > 0 ? "has-records" : null;
  return { submitted: submittedWhy === null, nothing: nothingWhy === null, submittedWhy, nothingWhy };
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in tests/compliance/pure-selftests.test.ts
 * and scripts/compliance/run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsHubViewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`ccrs-hub-view-core FAIL: ${name}`);
    }
  };
  const w = (k: string) => ({ week: { key: k } });
  const cur = w("W-2026-11-01");
  const a = w("W-2026-10-25");
  const b = w("W-2026-10-18");
  ok(pickSelectedWeek({ current: cur, weeks: [a, b], mostUrgent: b }, "W-2026-10-25") === a, "requested week wins");
  ok(pickSelectedWeek({ current: cur, weeks: [a, b], mostUrgent: b }, "W-2026-11-01") === cur, "requested current week");
  ok(pickSelectedWeek({ current: cur, weeks: [a, b], mostUrgent: b }, "W-2020-01-05") === b, "unknown -> most urgent");
  ok(pickSelectedWeek({ current: cur, weeks: [a, b], mostUrgent: null }, null) === a, "no urgent -> last completed");
  ok(pickSelectedWeek({ current: cur, weeks: [], mostUrgent: null }, null) === cur, "nothing -> current");

  const files = [
    { env: "preprod", state: "uploaded", n: 1 },
    { env: "prod", state: "uploaded", n: 2 },
    { env: "preprod", state: "emitted", n: 3 },
    { env: "preprod", state: "succeeded", n: 4 },
  ];
  ok(waitingFilesOfEnv(files, "preprod").map((f) => f.n).join() === "1,3", "waiting preprod only");
  ok(waitingFilesOfEnv(files, "prod").map((f) => f.n).join() === "2", "waiting prod only");

  ok(medicalSaleRowCount([{ type: "Sale", csv: "x,RecreationalMedical\ny,RecreationalRetail\nz,RecreationalMedical" }]) === 2, "medical rows counted");
  ok(medicalSaleRowCount([{ type: "Inventory", csv: "RecreationalMedical" }]) === 0, "only the Sale file");
  ok(medicalSaleRowCount(null) === 0, "no batch -> 0");

  const g1 = recordGate({ built: false, submittable: true, totalRecords: 0, nothingToReport: true });
  ok(!g1.submitted && !g1.nothing && g1.nothingWhy === "build-failed", "failed build blocks both");
  const g2 = recordGate({ built: true, submittable: true, totalRecords: 5, nothingToReport: false });
  ok(g2.submitted && !g2.nothing && g2.nothingWhy === "has-records", "records -> submit only");
  const g3 = recordGate({ built: true, submittable: true, totalRecords: 0, nothingToReport: true });
  ok(!g3.submitted && g3.nothing && g3.submittedWhy === "zero-records", "zero -> nothing only");
  const g4 = recordGate({ built: true, submittable: false, totalRecords: 3, nothingToReport: false });
  ok(!g4.submitted && g4.submittedWhy === "not-submittable" && !g4.nothing, "failing gate blocks submit");

  ok(errorText(new Error("  boom ")) === "boom", "error text trimmed");
  ok(errorText(undefined) === "unknown error", "unknown error text");
  ok(errorText("x".repeat(900)).length === 500, "error text capped");
  return { passed, failed };
}
