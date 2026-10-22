/**
 * src/lib/pos/cultivera-run-report-core.ts — R74 S3 "one-click crawler report" (pure).
 *
 * Owner (R74 round 3): "Please walk me through the steps to getting you the crawler data you need.
 * Baby steps, plain English ... I use railway to deploy the crawler if that matters."
 *
 * The data the build needs from a Fetch It All harvest lives on the crawler (Railway), in the run
 * folder: state.json (every stage's numbers, incl. the R74 S2 wcia_json coverage block and the loud
 * warnings), errors.jsonl (one line per failed fetch, tagged with its stage) and manifest.json (the
 * file list with byte counts + sha256). Instead of digging in Railway, the owner presses ONE button
 * on the run page and gets ONE plain-text file to hand over:
 *
 *   - buildRunReport(...)   state + manifest + errors.jsonl text → the report text. Plain summary
 *                           first (status, Pacific times, warnings, every stage, vendor-file
 *                           coverage, errors grouped by stage), then the raw state.json and the
 *                           raw errors.jsonl lines (capped, the cap is SAID, never silent).
 *   - redactSecrets(...)    defensive: any key that looks like a credential is replaced before it
 *                           can leave the site (the crawler never writes one; this keeps it so).
 *   - summarizeErrors(...)  errors.jsonl → per-stage counts + reasons; unreadable lines counted.
 *   - reportFilename(...)   cultivera-run-<runId>-report.txt
 *   - RAW_REPORT_FILES      the only raw crawler files the route will pass through.
 *
 * Reads nothing, writes nothing. No money. Times shown in Pacific (rule: Pacific times) with the
 * crawler's UTC stamp beside them so nothing is reinterpreted.
 */

import { pacificParts } from "@/lib/reports/timezone";

/** The raw run files the report route may pass straight through (allowlist; everything else 400s). */
export const RAW_REPORT_FILES = ["state.json", "errors.jsonl", "manifest.json"] as const;
export type RawReportFile = (typeof RAW_REPORT_FILES)[number];

export function isRawReportFile(name: string): name is RawReportFile {
  return (RAW_REPORT_FILES as readonly string[]).includes(name);
}

/** How many raw errors.jsonl lines the report copies in (the rest are counted, and the cap is said). */
export const MAX_RAW_ERROR_LINES = 2000;
/** How many example ids per (stage, reason) the summary lists. */
export const MAX_IDS_PER_REASON = 25;

const SECRET_KEY_RE = /pass(word)?|secret|token|cookie|authorization|api[-_]?key|session/i;

/** Deep copy with credential-looking keys replaced by "[redacted]". Pure. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[too deep]";
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type ErrorGroup = { stage: string; reason: string; count: number; ids: string[] };
export type ErrorSummary = { total: number; unreadable: number; groups: ErrorGroup[]; byStage: Record<string, number> };

function reasonOf(rec: Record<string, unknown>): string {
  if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
  if (typeof rec.status === "number") return `HTTP ${rec.status}`;
  if (typeof rec.status === "string" && rec.status.trim()) return `HTTP ${rec.status.trim()}`;
  return "unspecified";
}

/** errors.jsonl text → per-stage, per-reason groups (sorted by stage then count desc). Pure. */
export function summarizeErrors(text: string | null): ErrorSummary {
  const groups = new Map<string, ErrorGroup>();
  const byStage: Record<string, number> = {};
  let total = 0;
  let unreadable = 0;
  for (const line of (text ?? "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(t);
    } catch {
      unreadable += 1;
      continue;
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
      unreadable += 1;
      continue;
    }
    const r = rec as Record<string, unknown>;
    const stage = typeof r.stage === "string" && r.stage.trim() ? r.stage.trim() : "unknown";
    const reason = reasonOf(r);
    const key = `${stage}\u0000${reason}`;
    const g = groups.get(key) ?? { stage, reason, count: 0, ids: [] };
    g.count += 1;
    if (r.id !== undefined && r.id !== null && g.ids.length < MAX_IDS_PER_REASON) g.ids.push(String(r.id));
    groups.set(key, g);
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    total += 1;
  }
  const sorted = [...groups.values()].sort((a, b) => (a.stage === b.stage ? b.count - a.count : a.stage < b.stage ? -1 : 1));
  return { total, unreadable, groups: sorted, byStage };
}

/** "2026-10-22T19:04:05Z" → "2026-10-22 12:04:05 Pacific (2026-10-22T19:04:05Z UTC)"; junk → as-is. */
export function pacificStamp(iso: unknown): string {
  if (typeof iso !== "string" || !iso.trim()) return "(not recorded)";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return `${iso} (unreadable time)`;
  const p = pacificParts(new Date(t));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} Pacific (${iso} UTC)`;
}

export function reportFilename(runId: string): string {
  const safe = runId.replace(/[^0-9A-Za-z-]/g, "");
  return `cultivera-run-${safe || "unknown"}-report.txt`;
}

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One stage's numbers in plain words (only what the crawler wrote; nothing inferred). */
export function stageLine(name: string, s: unknown): string {
  if (!isRec(s)) return `${name}: (no record — the stage never ran on this harvest)`;
  const parts: string[] = [];
  parts.push(`status ${typeof s.status === "string" ? s.status.toUpperCase() : "UNKNOWN"}`);
  if (typeof s.skipped === "string" && s.skipped) parts.push(`skipped (${s.skipped})`);
  if (num(s.rows) !== null) parts.push(`${num(s.rows)} rows`);
  if (num(s.bytes) !== null) parts.push(`${num(s.bytes)} bytes`);
  const wanted = num(s.wanted);
  const missing = Array.isArray(s.missing) ? s.missing.length : null;
  if (wanted !== null) parts.push(`wanted ${wanted}`);
  if (num(s.fetched_now) !== null) parts.push(`fetched this pass ${num(s.fetched_now)}`);
  if (missing !== null) parts.push(`not fetched ${missing}`);
  if (num(s.errors) !== null) parts.push(`errors ${num(s.errors)}`);
  if (num(s.refused) !== null) parts.push(`refused ${num(s.refused)}`);
  if (num(s.seconds) !== null) parts.push(`${num(s.seconds)} s`);
  if (typeof s.error === "string" && s.error) parts.push(`error: ${s.error}`);
  return `${name}: ${parts.join(" · ")}`;
}

export type RunReportInput = {
  runId: string;
  /** state.json parsed (null = could not be read; the report says so). */
  state: unknown;
  /** manifest.json parsed (null = not there yet, e.g. a run still going). */
  manifest: unknown;
  /** errors.jsonl text (null = the crawler never wrote one = no fetch errors). */
  errorsText: string | null;
  /** Problems reading any of the three (shown at the top, never swallowed). */
  readProblems: readonly string[];
  /** When the report was made (ISO). */
  generatedAtIso: string;
  /** The stage order to print (PHASE_A_STAGES); stages not in it are printed after. */
  stageOrder: readonly string[];
};

/** state + manifest + errors.jsonl → the plain-text report the owner hands over. Pure. */
export function buildRunReport(input: RunReportInput): string {
  const L: string[] = [];
  const state = isRec(input.state) ? (redactSecrets(input.state) as AnyRec) : null;
  const manifest = isRec(input.manifest) ? (redactSecrets(input.manifest) as AnyRec) : null;
  const errs = summarizeErrors(input.errorsText);

  L.push("GREENWAY — CULTIVERA FETCH IT ALL — CRAWLER RUN REPORT");
  L.push("=".repeat(56));
  L.push(`Run id:        ${input.runId}`);
  L.push(`Report made:   ${pacificStamp(input.generatedAtIso)}`);
  if (input.readProblems.length > 0) {
    L.push("");
    L.push("PROBLEMS READING THE RUN (the sections below may be partial):");
    for (const p of input.readProblems) L.push(`  ! ${p}`);
  }

  L.push("");
  L.push("1. RUN");
  if (!state) {
    L.push("  state.json could not be read, so there is no stage data in this report.");
  } else {
    L.push(`  Status:      ${typeof state.status === "string" ? state.status.toUpperCase() : "UNKNOWN"}`);
    L.push(`  Started:     ${pacificStamp(state.startedAt)}`);
    L.push(`  Finished:    ${pacificStamp(state.finishedAt)}`);
    if (num(state.seconds) !== null) L.push(`  Took:        ${num(state.seconds)} s`);
    if (typeof state.withinBudget === "boolean") L.push(`  Within time budget: ${state.withinBudget ? "yes" : "NO"}`);
    if (typeof state.salesFrom === "string") L.push(`  Sales from:  ${state.salesFrom}`);
    if (typeof state.error === "string" && state.error) L.push(`  Run error:   ${state.error}`);
  }

  L.push("");
  L.push("2. WARNINGS (loud)");
  const warnings = state && Array.isArray(state.warnings) ? state.warnings.filter((w): w is string => typeof w === "string" && w.trim() !== "") : [];
  if (warnings.length === 0) L.push("  none");
  for (const w of warnings) L.push(`  ⚠ ${w}`);

  L.push("");
  L.push("3. STAGES");
  const stages = state && isRec(state.stages) ? state.stages : {};
  const names = [...input.stageOrder, ...Object.keys(stages).filter((k) => !input.stageOrder.includes(k)).sort()];
  for (const n of names) L.push(`  ${stageLine(n, stages[n])}`);

  L.push("");
  L.push("4. VENDOR TRANSFER FILES (WCIA JSON) COVERAGE");
  const w = isRec(stages.wcia_json) ? stages.wcia_json : null;
  const cov = w && isRec(w.coverage) ? w.coverage : null;
  if (!w) {
    L.push("  The vendor-files stage has no record on this run.");
  } else if (!cov) {
    L.push("  No coverage block: this crawler was deployed before R74 S2. Redeploy the crawler on Railway, then run a fresh harvest.");
  } else {
    L.push(`  Transfers with a vendor file: ${String(cov.expected ?? "?")}`);
    L.push(`  Saved:                        ${String(cov.saved ?? "?")}`);
    L.push(`  MISSING:                      ${String(cov.missing ?? "?")}`);
    L.push(`  Refused paths:                ${String(cov.refused ?? "?")}`);
    L.push(`  Fetch errors:                 ${String(cov.errors ?? "?")}`);
    L.push(`  Stopped for time:             ${cov.stoppedForTime === true ? "YES" : cov.stoppedForTime === false ? "no" : "?"}`);
    L.push(`  Complete:                     ${cov.complete === true ? "yes" : "NO"}`);
  }
  const missingIds = w && Array.isArray(w.missing) ? w.missing.map(String) : [];
  if (missingIds.length > 0) {
    const shown = missingIds.slice(0, 200);
    L.push(`  Missing transfer ids (${missingIds.length}${missingIds.length > shown.length ? `, first ${shown.length} shown` : ""}): ${shown.join(", ")}`);
  }

  L.push("");
  L.push("5. FETCH ERRORS (errors.jsonl)");
  if (input.errorsText === null) {
    L.push("  No errors.jsonl on this run (the crawler only writes it when a fetch fails).");
  } else {
    L.push(`  ${errs.total} error lines${errs.unreadable > 0 ? `, ${errs.unreadable} UNREADABLE lines` : ""}.`);
    for (const g of errs.groups) {
      L.push(`  [${g.stage}] ${g.reason}: ${g.count}${g.ids.length > 0 ? ` — ids ${g.ids.join(", ")}${g.count > g.ids.length ? ", …" : ""}` : ""}`);
    }
  }

  L.push("");
  L.push("6. FILES IN THE RUN (manifest.json)");
  const files = manifest && Array.isArray(manifest.files) ? manifest.files.filter(isRec) : [];
  if (!manifest) L.push("  manifest.json not available (a run still going has none yet).");
  else if (files.length === 0) L.push("  manifest.json lists no files.");
  for (const f of files) {
    const sha = typeof f.sha256 === "string" ? f.sha256.slice(0, 16) : "?";
    L.push(`  ${String(f.name ?? "?")} — ${String(f.bytes ?? "?")} bytes — sha256 ${sha}…`);
  }

  L.push("");
  L.push("7. RAW state.json");
  L.push(state ? JSON.stringify(state, null, 2) : "(not available)");

  L.push("");
  L.push("8. RAW errors.jsonl");
  if (input.errorsText === null) {
    L.push("(none)");
  } else {
    const lines = input.errorsText.split("\n").filter((l) => l.trim() !== "");
    for (const l of lines.slice(0, MAX_RAW_ERROR_LINES)) L.push(l);
    if (lines.length > MAX_RAW_ERROR_LINES) L.push(`… ${lines.length - MAX_RAW_ERROR_LINES} more lines not copied (download errors.jsonl from the run page for all of them).`);
  }
  L.push("");
  L.push("END OF REPORT");
  return L.join("\n") + "\n";
}

// ─── self-tests ──────────────────────────────────────────────────────────────

export function __runCultiveraRunReportCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-run-report-core: " + msg);
    passed += 1;
  };

  // allowlist
  ok(isRawReportFile("state.json") && isRawReportFile("errors.jsonl") && isRawReportFile("manifest.json"), "allowlist has the three files");
  ok(!isRawReportFile("export_inventories.xlsx") && !isRawReportFile("../state.json") && !isRawReportFile(""), "anything else is refused");

  // redaction
  const red = redactSecrets({ a: 1, password: "x", nested: { CULTIVERA_POS_PASSWORD: "y", list: [{ token: "z", ok: "k" }] }, sessionCookie: "c" }) as AnyRec;
  ok(red.password === "[redacted]" && red.sessionCookie === "[redacted]", "top-level secrets redacted");
  const nested = red.nested as AnyRec;
  ok(nested.CULTIVERA_POS_PASSWORD === "[redacted]", "nested env-style secret redacted");
  ok(((nested.list as AnyRec[])[0].token === "[redacted]") && (nested.list as AnyRec[])[0].ok === "k", "array members redacted, others kept");
  ok(red.a === 1, "plain values kept");

  // errors summary
  const errText = [
    JSON.stringify({ stage: "wcia_json", id: 11, status: 500 }),
    JSON.stringify({ stage: "wcia_json", id: 12, status: 500 }),
    JSON.stringify({ stage: "wcia_json", id: 13, error: "not a WCIA document" }),
    JSON.stringify({ stage: "transfer_details", id: 7, error: "Id mismatch" }),
    "{torn",
    "[1,2]",
    "",
  ].join("\n");
  const s = summarizeErrors(errText);
  ok(s.total === 4 && s.unreadable === 2, "counts lines and unreadable lines");
  ok(s.byStage.wcia_json === 3 && s.byStage.transfer_details === 1, "per-stage counts");
  const http = s.groups.find((g) => g.stage === "wcia_json" && g.reason === "HTTP 500");
  ok(Boolean(http) && http!.count === 2 && http!.ids.join(",") === "11,12", "groups by reason with ids");
  ok(s.groups[0].stage === "transfer_details" && s.groups[1].reason === "HTTP 500", "sorted by stage then count desc");
  ok(summarizeErrors(null).total === 0 && summarizeErrors(JSON.stringify({ id: 1 })).groups[0].stage === "unknown", "no text = empty; no stage = unknown");
  const many = Array.from({ length: 40 }, (_, i) => JSON.stringify({ stage: "batches", id: i, status: 404 })).join("\n");
  ok(summarizeErrors(many).groups[0].ids.length === MAX_IDS_PER_REASON && summarizeErrors(many).groups[0].count === 40, "ids capped, count kept");

  // Pacific stamp (PDT: UTC-7 on Oct 22)
  ok(pacificStamp("2026-10-22T19:04:05Z").startsWith("2026-10-22 12:04:05 Pacific"), "UTC → Pacific wall clock");
  ok(pacificStamp(undefined) === "(not recorded)" && pacificStamp("junk").includes("unreadable"), "missing / junk time said plainly");

  ok(reportFilename("20261022T190405Z-abcdef12") === "cultivera-run-20261022T190405Z-abcdef12-report.txt", "filename");
  ok(reportFilename("../../x") === "cultivera-run-x-report.txt", "filename strips path characters");

  // stage line
  ok(stageLine("wcia_json", undefined).includes("never ran"), "missing stage said");
  ok(stageLine("transfer_details", { status: "done", wanted: 10, missing: [1, 2], errors: 2, seconds: 3.5 }) === "transfer_details: status DONE · wanted 10 · not fetched 2 · errors 2 · 3.5 s", "stage line exact");

  // full report
  const order = ["login", "transfer_details", "wcia_json"];
  const state = {
    status: "done",
    startedAt: "2026-10-22T19:00:00Z",
    finishedAt: "2026-10-22T19:04:05Z",
    seconds: 245,
    withinBudget: true,
    warnings: ["Vendor transfer files: 2 of 10 MISSING (2 errors). The 8 saved still stage."],
    stages: {
      login: { status: "done", seconds: 1 },
      transfer_details: { status: "done", wanted: 10, missing: [], seconds: 30 },
      wcia_json: { status: "partial", wanted: 10, missing: [11, 12], errors: 2, refused: 0, coverage: { expected: 10, saved: 8, missing: 2, refused: 0, errors: 2, stoppedForTime: false, complete: false } },
      extra_stage: { status: "done" },
    },
    password: "should-not-leak",
  };
  const manifest = { files: [{ name: "state.json", bytes: 123, sha256: "a".repeat(64) }] };
  const rep = buildRunReport({ runId: "20261022T190405Z-abcdef12", state, manifest, errorsText: errText, readProblems: [], generatedAtIso: "2026-10-22T20:00:00Z", stageOrder: order });
  ok(rep.includes("Status:      DONE") && rep.includes("Finished:    2026-10-22 12:04:05 Pacific"), "run section");
  ok(rep.includes("⚠ Vendor transfer files: 2 of 10 MISSING"), "warnings copied");
  ok(rep.includes("MISSING:                      2") && rep.includes("Complete:                     NO"), "coverage section");
  ok(rep.includes("Missing transfer ids (2): 11, 12"), "missing ids listed");
  ok(rep.includes("[wcia_json] HTTP 500: 2 — ids 11, 12"), "errors grouped");
  ok(rep.includes("2 UNREADABLE lines"), "unreadable lines said");
  ok(rep.indexOf("  login:") < rep.indexOf("  transfer_details:") && rep.indexOf("  wcia_json:") < rep.indexOf("  extra_stage:"), "stage order then extras");
  ok(rep.includes("state.json — 123 bytes — sha256 aaaaaaaaaaaaaaaa…"), "files listed");
  ok(!rep.includes("should-not-leak") && rep.includes("\"password\": \"[redacted]\""), "secrets never leave");
  ok(rep.includes("{torn"), "raw errors copied verbatim");
  ok(rep.trimEnd().endsWith("END OF REPORT"), "ends with marker");

  const bare = buildRunReport({ runId: "r", state: null, manifest: null, errorsText: null, readProblems: ["state.json: crawler responded 404"], generatedAtIso: "2026-10-22T20:00:00Z", stageOrder: order });
  ok(bare.includes("! state.json: crawler responded 404") && bare.includes("state.json could not be read"), "read problems shown, not swallowed");
  ok(bare.includes("No errors.jsonl on this run") && bare.includes("manifest.json not available"), "absent files said plainly");
  const oldCrawler = buildRunReport({ runId: "r", state: { status: "done", stages: { wcia_json: { status: "done", wanted: 3, missing: [] } } }, manifest, errorsText: null, readProblems: [], generatedAtIso: "2026-10-22T20:00:00Z", stageOrder: order });
  ok(oldCrawler.includes("deployed before R74 S2. Redeploy the crawler on Railway"), "old crawler → redeploy hint");
  const bigErr = Array.from({ length: MAX_RAW_ERROR_LINES + 5 }, (_, i) => JSON.stringify({ stage: "batches", id: i, status: 404 })).join("\n");
  const capped = buildRunReport({ runId: "r", state, manifest, errorsText: bigErr, readProblems: [], generatedAtIso: "2026-10-22T20:00:00Z", stageOrder: order });
  ok(capped.includes("… 5 more lines not copied") && capped.includes(`${MAX_RAW_ERROR_LINES + 5} error lines`), "raw cap said, summary counts all");

  return { passed, failed: 0 };
}
