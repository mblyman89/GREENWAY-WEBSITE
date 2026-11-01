/**
 * src/lib/platform/db-contract-core.ts  (G-71a, owner messages 11 and 12)  PURE.
 *
 * Owner (message 11, verbatim excerpt): "should we be monitoring supabase and
 * vercel for issues like this that could cause real issues due to us not
 * knowing about it until we run into the problem in production."
 * Owner (message 12, verbatim excerpt): "Let's build 1-4 first ... Update the
 * standing rules so we don't rely on the database to do things for us and we
 * are more deliberate about how we communicate with the database."
 *
 * The database contract is the list of public tables/views and functions the
 * server code names (generated, db-contract.generated.json). Every morning the
 * platform-health cron asks production, through platform_db_contract_check
 * (migration 0331), whether the server role can still reach each one, and
 * whether anything else in `public` is out of its reach. This module turns
 * that answer into a plain report and decides what to send.
 *
 * Severity, grounded on what actually breaks the store:
 *   - FAIL: an object exists but the server role cannot use it. This is the
 *     R-RET incident (Supabase 2026-10-30 grant change): every call fails 42501.
 *   - FAIL: the check itself could not run (function missing, permission
 *     denied, database unreachable). A monitor that cannot look must say so.
 *   - WARN: an object the code names does not exist. Usually a migration that
 *     has not been applied yet; the screen that needs it says so too.
 *   - WARN: the 0330 default privileges are gone. New objects then rely on
 *     each migration's explicit grant (standing rule 15), which CI enforces.
 */

export type DbContract = { tables: string[]; functions: string[] };

export type ContractCheckResult = {
  missing_tables: string[];
  unreachable_tables: string[];
  missing_functions: string[];
  unreachable_functions: string[];
  /** Any other public object the server role cannot reach ("table x", "function y(int)"). */
  public_unreachable: string[];
  default_privileges_ok: boolean;
  checked_tables: number;
  checked_functions: number;
};

export type HealthSeverity = "fail" | "warn";
export type HealthProblem = { severity: HealthSeverity; title: string; detail: string; fix: string };
export type HealthStatus = "ok" | "warn" | "fail";
export type HealthReport = { status: HealthStatus; problems: HealthProblem[]; summary: string };

export const PLATFORM_HEALTH_MIGRATION = "0331_platform_health.sql";
export const GRANTS_MIGRATION = "0330_service_role_grants.sql";
/** The most names one problem line lists before "and N more". */
export const LIST_LIMIT = 12;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export function normalizeContract(c: { tables: Iterable<string>; functions: Iterable<string> }): DbContract {
  const clean = (xs: Iterable<string>) => [...new Set([...xs].map((x) => x.trim()).filter((x) => IDENT_RE.test(x)))].sort();
  return { tables: clean(c.tables), functions: clean(c.functions) };
}

export function listNames(xs: readonly string[], limit = LIST_LIMIT): string {
  if (xs.length <= limit) return xs.join(", ");
  return `${xs.slice(0, limit).join(", ")} and ${xs.length - limit} more`;
}

/** Defensive parse of the jsonb the SQL function returns. Unknown shape -> null. */
export function parseContractCheck(raw: unknown): ContractCheckResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const arr = (k: string): string[] | null => {
    const v = o[k];
    if (v == null) return [];
    if (!Array.isArray(v)) return null;
    return v.filter((x): x is string => typeof x === "string");
  };
  const keys = ["missing_tables", "unreachable_tables", "missing_functions", "unreachable_functions", "public_unreachable"] as const;
  const out: Partial<ContractCheckResult> = {};
  for (const k of keys) {
    const v = arr(k);
    if (v === null) return null;
    out[k] = [...v].sort();
  }
  if (typeof o.default_privileges_ok !== "boolean") return null;
  out.default_privileges_ok = o.default_privileges_ok;
  out.checked_tables = typeof o.checked_tables === "number" ? o.checked_tables : 0;
  out.checked_functions = typeof o.checked_functions === "number" ? o.checked_functions : 0;
  return out as ContractCheckResult;
}

export type CheckCallError = { code?: string | null; message?: string | null } | null;

/** The report when the check could not run at all. Always FAIL. */
export function reportForCallError(err: CheckCallError): HealthReport {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").trim();
  let problem: HealthProblem;
  if (code === "42883" || code === "PGRST202" || /could not find the function|does not exist/i.test(msg)) {
    problem = {
      severity: "fail",
      title: "The daily database check is not installed",
      detail: `The database has no platform_db_contract_check function (${msg || code || "not found"}).`,
      fix: `Run ${PLATFORM_HEALTH_MIGRATION} in the Supabase SQL editor.`,
    };
  } else if (code === "42501" || /permission denied/i.test(msg)) {
    problem = {
      severity: "fail",
      title: "The server is locked out of the database check",
      detail: `The database refused the server (permission denied): ${msg || code}. This is the same failure that stopped customer returns on 2026-10-30.`,
      fix: `Run ${GRANTS_MIGRATION}, then ${PLATFORM_HEALTH_MIGRATION}, in the Supabase SQL editor.`,
    };
  } else {
    problem = {
      severity: "fail",
      title: "The daily database check could not run",
      detail: msg || code || "No answer from the database.",
      fix: "Check the Supabase status page and the project's API keys in Vercel; run the check again from Platform health.",
    };
  }
  return { status: "fail", problems: [problem], summary: problem.title };
}

export function buildHealthReport(r: ContractCheckResult): HealthReport {
  const problems: HealthProblem[] = [];
  const unreachable = [...r.unreachable_tables.map((t) => `table ${t}`), ...r.unreachable_functions.map((f) => `function ${f}`)];
  if (unreachable.length > 0) {
    problems.push({
      severity: "fail",
      title: `The server cannot use ${unreachable.length} database object(s) the app needs`,
      detail: `Permission denied for: ${listNames(unreachable)}. Every screen that uses them fails until this is fixed.`,
      fix: `Run ${GRANTS_MIGRATION} in the Supabase SQL editor (it is safe to re-run), then press Run check now.`,
    });
  }
  const others = r.public_unreachable.filter((x) => !unreachable.includes(x));
  if (others.length > 0) {
    problems.push({
      severity: "fail",
      title: `${others.length} other database object(s) are out of the server's reach`,
      detail: `Not named in the app's contract, but locked: ${listNames(others)}.`,
      fix: `Run ${GRANTS_MIGRATION} in the Supabase SQL editor, then press Run check now.`,
    });
  }
  const missing = [...r.missing_tables.map((t) => `table ${t}`), ...r.missing_functions.map((f) => `function ${f}`)];
  if (missing.length > 0) {
    problems.push({
      severity: "warn",
      title: `${missing.length} database object(s) the app names do not exist`,
      detail: `Missing: ${listNames(missing)}. Usually a migration that has not been applied yet.`,
      fix: "Open docs/MIGRATIONS_TO_RUN.md and apply any unticked migration, oldest first.",
    });
  }
  if (!r.default_privileges_ok) {
    problems.push({
      severity: "warn",
      title: "The server's default grants for new objects are missing",
      detail: "New tables and functions will only work if their migration grants the server role (standing rule 15; CI checks it).",
      fix: `Re-run ${GRANTS_MIGRATION} in the Supabase SQL editor.`,
    });
  }
  const status: HealthStatus = problems.some((p) => p.severity === "fail") ? "fail" : problems.length > 0 ? "warn" : "ok";
  const checked = `${r.checked_tables} tables/views and ${r.checked_functions} functions`;
  const summary =
    status === "ok"
      ? `All clear: the server can reach all ${checked} the app uses.`
      : `${problems.filter((p) => p.severity === "fail").length} failure(s), ${problems.filter((p) => p.severity === "warn").length} warning(s) across ${checked}.`;
  return { status, problems, summary };
}

/** One daily email per Pacific day, whatever the status (owner asked for a green "all clear" too). */
export function dailyAlertKey(pacificDay: string): string {
  return `platform-health:daily:${pacificDay}`;
}

/**
 * Send-once decision for a claim row (compliance_reminder_log, UNIQUE dedupe_key).
 * "taken" (23505) = already sent today -> skip. A claim that ERRORED is still
 * sent: the alert may be about the very grants the claim needs, and a
 * duplicate email is better than a silent outage.
 */
export function shouldSend(claim: "claimed" | "taken" | "error"): boolean {
  return claim !== "taken";
}

export function alertSubject(rep: HealthReport, pacificDay: string): string {
  const tag = rep.status === "ok" ? "All clear" : rep.status === "warn" ? "Warning" : "ACTION NEEDED";
  return `Greenway platform health ${pacificDay}: ${tag}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function alertText(rep: HealthReport): string {
  const lines = [rep.summary];
  for (const p of rep.problems) lines.push(`${p.severity === "fail" ? "FAIL" : "WARN"}: ${p.title}. ${p.detail} Fix: ${p.fix}`);
  return lines.join("\n");
}

export function alertHtml(rep: HealthReport, pageUrl: string): string {
  const color = rep.status === "ok" ? "#166534" : rep.status === "warn" ? "#92400e" : "#991b1b";
  const items = rep.problems
    .map(
      (p) =>
        `<li style="margin-bottom:8px"><strong>${p.severity === "fail" ? "FAIL" : "Warning"}: ${esc(p.title)}</strong><br>${esc(p.detail)}<br><em>Fix:</em> ${esc(p.fix)}</li>`,
    )
    .join("");
  return `<p style="color:${color};font-weight:bold">${esc(rep.summary)}</p>${items ? `<ul>${items}</ul>` : ""}<p><a href="${esc(pageUrl)}">Open Platform health</a></p>`;
}

// ---------------------------------------------------------------------------
// Self-tests (PURE)
// ---------------------------------------------------------------------------

export function __runDbContractCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log("FAIL:", msg);
    }
  };
  const clean: ContractCheckResult = {
    missing_tables: [],
    unreachable_tables: [],
    missing_functions: [],
    unreachable_functions: [],
    public_unreachable: [],
    default_privileges_ok: true,
    checked_tables: 400,
    checked_functions: 64,
  };

  // normalizeContract
  const n = normalizeContract({ tables: ["orders", "orders", " lots ", "Bad-Name", ""], functions: ["b_fn", "a_fn"] });
  ok(n.tables.join() === "lots,orders", "dedupe, trim, sort, drop invalid names");
  ok(n.functions.join() === "a_fn,b_fn", "functions sorted");

  // parse
  ok(parseContractCheck(null) === null, "null is not a result");
  ok(parseContractCheck({ ...clean, missing_tables: "x" }) === null, "non-array list rejected");
  ok(parseContractCheck({ ...clean, default_privileges_ok: "yes" }) === null, "non-boolean flag rejected");
  const p = parseContractCheck({ ...clean, unreachable_functions: ["z", "a"] });
  ok(p !== null && p.unreachable_functions.join() === "a,z", "lists sorted on parse");
  ok(parseContractCheck({ default_privileges_ok: true }) !== null, "absent lists read as empty");

  // all clear
  const okRep = buildHealthReport(clean);
  ok(okRep.status === "ok" && okRep.problems.length === 0, "clean result is all clear");
  ok(okRep.summary.includes("400") && okRep.summary.includes("64"), "summary says how much was checked");

  // the R-RET incident
  const incident = buildHealthReport({ ...clean, unreachable_functions: ["record_customer_return"] });
  ok(incident.status === "fail", "an unreachable function is a failure");
  ok(incident.problems[0].detail.includes("record_customer_return"), "names the function");
  ok(incident.problems[0].fix.includes(GRANTS_MIGRATION), "says to run 0330");

  // unreachable outside the contract, not double counted
  const other = buildHealthReport({ ...clean, unreachable_tables: ["a"], public_unreachable: ["table a", "table b"] });
  ok(other.problems.length === 2 && other.problems[1].detail.includes("table b") && !other.problems[1].detail.includes("table a"), "other locked objects listed once");

  // missing = warn
  const miss = buildHealthReport({ ...clean, missing_tables: ["checklist_runs"] });
  ok(miss.status === "warn", "a missing object is a warning");
  ok(miss.problems[0].fix.includes("MIGRATIONS_TO_RUN"), "points at the migrations checklist");

  // default privileges = warn
  ok(buildHealthReport({ ...clean, default_privileges_ok: false }).status === "warn", "missing default grants is a warning");
  // fail outranks warn
  ok(buildHealthReport({ ...clean, missing_tables: ["x"], unreachable_tables: ["y"] }).status === "fail", "fail outranks warn");

  // call errors
  ok(reportForCallError({ code: "42883", message: "function does not exist" }).problems[0].fix.includes(PLATFORM_HEALTH_MIGRATION), "missing check function -> run 0331");
  ok(reportForCallError({ code: "PGRST202", message: "Could not find the function" }).problems[0].title.includes("not installed"), "PostgREST not found -> not installed");
  const denied = reportForCallError({ code: "42501", message: "permission denied for function platform_db_contract_check" });
  ok(denied.status === "fail" && denied.problems[0].fix.includes(GRANTS_MIGRATION), "permission denied on the check -> run 0330 then 0331");
  ok(reportForCallError(null).status === "fail", "no answer is a failure, never silence");
  ok(reportForCallError({ message: "fetch failed" }).problems[0].detail === "fetch failed", "network error passed through");

  // list limit
  const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
  ok(listNames(many).endsWith("and 8 more"), "long lists are shortened");
  ok(listNames(["a", "b"]) === "a, b", "short lists are whole");

  // send once
  ok(dailyAlertKey("2026-11-01") === "platform-health:daily:2026-11-01", "one key per Pacific day");
  ok(shouldSend("claimed") === true, "claimed -> send");
  ok(shouldSend("taken") === false, "already sent today -> skip");
  ok(shouldSend("error") === true, "claim failed -> still send (better twice than never)");

  // message
  ok(alertSubject(okRep, "2026-11-01").includes("All clear"), "green subject");
  ok(alertSubject(incident, "2026-11-01").includes("ACTION NEEDED"), "red subject");
  ok(alertSubject(miss, "2026-11-01").includes("Warning"), "amber subject");
  ok(alertText(incident).includes("FAIL: "), "text lists failures");
  const html = alertHtml(buildHealthReport({ ...clean, unreachable_tables: ["<script>"] }), "https://x/y");
  ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "html is escaped");
  ok(html.includes('href="https://x/y"'), "html links to the page");

  console.log(`db-contract-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
