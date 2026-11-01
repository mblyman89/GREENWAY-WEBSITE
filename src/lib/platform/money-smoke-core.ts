/**
 * src/lib/platform/money-smoke-core.ts  (slice G-71c, owner message 12)
 *
 * Owner (verbatim): "Let's build 1-4 first. I see real value in all of them."
 * Item 3: a daily test run of a sale, a return and the till that undoes
 * everything.
 *
 * PURE. Reads the answer of 0332 platform_money_smoke_test() (or the error
 * from calling it) and turns it into plain problems with the exact fix, then
 * folds them into the G-71a daily report so staff still get ONE email a day.
 *
 * The 0332 function does, as the server role, a till open, a register sale,
 * the stock decrement, a draft ledger entry, a customer return, a cash drop
 * and a till close, then rolls all of it back. A failure names the step, the
 * Postgres error code (SQLSTATE) and the message.
 */
import {
  GRANTS_MIGRATION,
  type HealthProblem,
  type HealthReport,
  type HealthStatus,
} from "./db-contract-core";

export const MONEY_SMOKE_MIGRATION = "0332_money_path_smoke_test.sql";
export const MONEY_SMOKE_RPC = "platform_money_smoke_test";

export const SMOKE_STEPS = [
  "register",
  "drawer_open",
  "lot",
  "sale_order",
  "sale_lines",
  "sale_event",
  "sale_complete",
  "decrement",
  "ledger",
  "return",
  "cash_drop",
  "drawer_close",
  "verify",
] as const;
export type SmokeStep = (typeof SMOKE_STEPS)[number];

/** What each step means at the counter, in staff words. */
export const STEP_LABELS: Record<SmokeStep, { label: string; breaks: string }> = {
  register: { label: "Set up a test register", breaks: "adding or changing registers" },
  drawer_open: { label: "Open a till with a starting count", breaks: "opening a till at the start of a shift" },
  lot: { label: "Add test stock", breaks: "receiving and adding inventory" },
  sale_order: { label: "Ring up a sale", breaks: "every register sale" },
  sale_lines: { label: "Add the item to the sale", breaks: "every register sale" },
  sale_event: { label: "Record the sale on the order history", breaks: "every register sale" },
  sale_complete: { label: "Complete the sale", breaks: "completing register and pickup sales" },
  decrement: { label: "Take the item out of stock", breaks: "stock counts after a sale" },
  ledger: { label: "Write the sale to the books", breaks: "posting sales to the books" },
  return: { label: "Take a customer return", breaks: "customer returns" },
  cash_drop: { label: "Drop cash to the safe", breaks: "cash drops" },
  drawer_close: { label: "Close the till with a count", breaks: "closing a till at the end of a shift" },
  verify: { label: "Check the numbers add up", breaks: "the stock and sale numbers" },
};

export type SmokeResult = {
  ok: boolean;
  passed: SmokeStep[];
  failed: { step: string; sqlstate: string; message: string } | null;
  ms: number;
};

function isStep(x: unknown): x is SmokeStep {
  return typeof x === "string" && (SMOKE_STEPS as readonly string[]).includes(x);
}

/** Parse the function's jsonb answer; null when the shape is wrong. */
export function parseSmokeResult(raw: unknown): SmokeResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.ok !== "boolean" || !Array.isArray(o.passed)) return null;
  const passed = o.passed.filter(isStep);
  let failed: SmokeResult["failed"] = null;
  if (o.failed && typeof o.failed === "object" && !Array.isArray(o.failed)) {
    const f = o.failed as Record<string, unknown>;
    failed = {
      step: typeof f.step === "string" ? f.step : "unknown",
      sqlstate: typeof f.sqlstate === "string" ? f.sqlstate : "",
      message: typeof f.message === "string" ? f.message : "",
    };
  }
  // ok must agree with the evidence: every step passed and nothing failed.
  const ok = o.ok && failed === null && passed.length === SMOKE_STEPS.length;
  return { ok, passed, failed: ok ? null : (failed ?? { step: "unknown", sqlstate: "", message: "The test did not finish every step." }), ms: typeof o.ms === "number" ? o.ms : 0 };
}

/** Plain explanation and fix for a SQLSTATE at a step. */
export function explainFailure(step: string, sqlstate: string, message: string): HealthProblem {
  const meta = isStep(step) ? STEP_LABELS[step] : { label: `Step ${step}`, breaks: "part of the money path" };
  const msg = message.trim() || sqlstate || "no detail";
  const base = `The daily test failed at "${meta.label}". At the counter this means ${meta.breaks} may be failing right now.`;
  let fix: string;
  if (sqlstate === "42501") {
    fix = `The database refused the server (permission denied). Run ${GRANTS_MIGRATION} in the Supabase SQL editor (safe to re-run), then press Run check now. If it still fails, a migration is missing a grant (standing rule 15).`;
  } else if (sqlstate === "42883" || sqlstate === "42P01" || sqlstate === "42703") {
    fix = "A function, table or column the register uses is missing or changed. Open docs/MIGRATIONS_TO_RUN.md and apply any unticked migration, oldest first, then press Run check now.";
  } else if (sqlstate === "23514" || sqlstate === "23502" || sqlstate === "23503" || sqlstate === "22P02") {
    fix = "A database rule refused the write the register makes. A recent migration or platform change no longer matches the code. Send this message to the developer; do not change the database by hand.";
  } else if (sqlstate === "57014" || sqlstate === "55P03") {
    fix = "The database was too slow or busy (time limit reached). Check status.supabase.com; press Run check now in a few minutes.";
  } else {
    fix = "Send this message to the developer, and press Run check now to see whether it repeats.";
  }
  return { severity: "fail", title: `Money-path test failed: ${meta.label.toLowerCase()}`, detail: `${base} Database said (${sqlstate || "?"}): ${msg}`, fix };
}

export type SmokeCallError = { code?: string | null; message?: string | null } | null;

/** Problems for the smoke part of the report ([] = passed). */
export function smokeProblems(result: SmokeResult | null, callError: SmokeCallError): HealthProblem[] {
  if (callError) {
    const code = callError.code ?? "";
    const msg = (callError.message ?? "").trim();
    if (code === "42883" || code === "PGRST202" || /could not find the function/i.test(msg)) {
      return [
        {
          severity: "warn",
          title: "The daily money-path test is not installed",
          detail: `The database has no ${MONEY_SMOKE_RPC} function yet (${msg || code}).`,
          fix: `Run ${MONEY_SMOKE_MIGRATION} in the Supabase SQL editor.`,
        },
      ];
    }
    return [explainFailure("call", code, msg || "The test could not be started.")];
  }
  if (!result) {
    return [
      {
        severity: "fail",
        title: "The money-path test answered in an unexpected shape",
        detail: "The test ran but its answer could not be read.",
        fix: `Re-run ${MONEY_SMOKE_MIGRATION} in the Supabase SQL editor, then press Run check now.`,
      },
    ];
  }
  if (result.ok) return [];
  const f = result.failed ?? { step: "unknown", sqlstate: "", message: "" };
  return [explainFailure(f.step, f.sqlstate, f.message)];
}

/**
 * Fold the smoke result into the G-71a report: one status, one summary, one
 * email. The worse status wins.
 */
export function mergeSmokeIntoReport(db: HealthReport, result: SmokeResult | null, callError: SmokeCallError): HealthReport {
  const extra = smokeProblems(result, callError);
  const problems = [...db.problems, ...extra];
  const rank: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };
  const extraStatus: HealthStatus = extra.some((p) => p.severity === "fail") ? "fail" : extra.length > 0 ? "warn" : "ok";
  const status: HealthStatus = rank[extraStatus] > rank[db.status] ? extraStatus : db.status;
  const smokeLine =
    extra.length === 0 && result?.ok
      ? `A test sale, return and till ran end to end and were undone (${SMOKE_STEPS.length} steps).`
      : extra[0]?.title ?? "";
  const summary = `${db.summary} ${smokeLine}`.trim();
  return { status, problems, summary };
}

// ---------------------------------------------------------------------------
// Self-tests (PURE; registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMoneySmokeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`money-smoke-core FAIL: ${name}`);
    }
  };

  const all = [...SMOKE_STEPS];
  const good = { ok: true, passed: all, failed: null, steps_total: 13, rolled_back: true, ms: 18 };
  const r = parseSmokeResult(good);
  ok(r !== null && r.ok && r.passed.length === 13 && r.ms === 18, "parse: healthy answer");
  ok(parseSmokeResult(null) === null, "parse: null");
  ok(parseSmokeResult([]) === null, "parse: array");
  ok(parseSmokeResult({ ok: "yes", passed: [] }) === null, "parse: ok must be boolean");
  ok(parseSmokeResult({ ok: true }) === null, "parse: passed required");
  const lying = parseSmokeResult({ ok: true, passed: all.slice(0, 5), failed: null });
  ok(lying !== null && !lying.ok && lying.failed !== null, "parse: ok with missing steps is NOT ok");
  const junk = parseSmokeResult({ ok: true, passed: [...all, "nope"], failed: null });
  ok(junk !== null && junk.ok && junk.passed.length === 13, "parse: unknown step names ignored");
  const rret = parseSmokeResult({
    ok: false,
    passed: all.slice(0, 9),
    failed: { step: "return", sqlstate: "42501", message: "permission denied for function record_customer_return" },
  });
  ok(rret !== null && !rret.ok && rret.failed?.step === "return", "parse: R-RET failure");

  // explain
  const e1 = explainFailure("return", "42501", "permission denied for function record_customer_return");
  ok(e1.severity === "fail", "42501 is a failure");
  ok(e1.title.includes("customer return"), "title names the step in staff words");
  ok(e1.detail.includes("customer returns may be failing"), "detail says what breaks at the counter");
  ok(e1.fix.includes(GRANTS_MIGRATION), "42501 -> run 0330");
  ok(e1.detail.includes("42501") && e1.detail.includes("record_customer_return"), "detail carries code and message");
  ok(explainFailure("sale_lines", "42703", "column x does not exist").fix.includes("MIGRATIONS_TO_RUN"), "42703 -> apply migrations");
  ok(explainFailure("lot", "23514", "violates check").fix.includes("developer"), "23514 -> developer, not by hand");
  ok(explainFailure("ledger", "57014", "canceling statement due to statement timeout").fix.includes("status.supabase.com"), "timeout -> status page");
  ok(explainFailure("weird", "XX000", "boom").title.includes("step weird"), "unknown step named");
  ok(explainFailure("cash_drop", "", "").detail.includes("no detail"), "empty message handled");

  // smokeProblems
  ok(smokeProblems(r, null).length === 0, "healthy -> no problems");
  const notInstalled = smokeProblems(null, { code: "PGRST202", message: "Could not find the function public.platform_money_smoke_test" });
  ok(notInstalled.length === 1 && notInstalled[0].severity === "warn" && notInstalled[0].fix.includes(MONEY_SMOKE_MIGRATION), "not installed -> warn, run 0332");
  ok(smokeProblems(null, { code: "42883", message: "function does not exist" })[0].severity === "warn", "42883 -> not installed");
  const denied = smokeProblems(null, { code: "42501", message: "permission denied for function platform_money_smoke_test" });
  ok(denied[0].severity === "fail" && denied[0].fix.includes(GRANTS_MIGRATION), "cannot call the test -> fail, grants");
  ok(smokeProblems(null, null)[0].title.includes("unexpected shape"), "unreadable answer -> fail");
  ok(smokeProblems(rret, null)[0].fix.includes(GRANTS_MIGRATION), "R-RET -> run 0330");

  // merge
  const dbOk: HealthReport = { status: "ok", problems: [], summary: "All clear: the server can reach all 300 tables/views and 81 functions the app uses." };
  const m1 = mergeSmokeIntoReport(dbOk, r, null);
  ok(m1.status === "ok" && m1.problems.length === 0, "merge: ok + ok = ok");
  ok(m1.summary.includes("All clear") && m1.summary.includes("test sale, return and till"), "merge: summary says both");
  const m2 = mergeSmokeIntoReport(dbOk, rret, null);
  ok(m2.status === "fail" && m2.problems.length === 1, "merge: ok + smoke fail = fail");
  ok(m2.summary.includes("customer return"), "merge: summary names the broken step");
  const m3 = mergeSmokeIntoReport(dbOk, null, { code: "PGRST202", message: "Could not find the function" });
  ok(m3.status === "warn", "merge: ok + not installed = warn");
  const dbFail: HealthReport = { status: "fail", problems: [{ severity: "fail", title: "x", detail: "y", fix: "z" }], summary: "1 failure(s)" };
  ok(mergeSmokeIntoReport(dbFail, r, null).status === "fail", "merge: db fail stays fail when smoke passes");
  ok(mergeSmokeIntoReport(dbFail, null, { code: "PGRST202", message: "" }).status === "fail", "merge: worse status wins");
  ok(mergeSmokeIntoReport(dbFail, rret, null).problems.length === 2, "merge: both problems kept");
  ok(Object.keys(STEP_LABELS).length === SMOKE_STEPS.length, "every step has a label");

  console.log(`money-smoke-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
