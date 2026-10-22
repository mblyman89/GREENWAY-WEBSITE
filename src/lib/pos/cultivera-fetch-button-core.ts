/**
 * src/lib/pos/cultivera-fetch-button-core.ts — R50 S9 "Fetch It All, Fuck Cultivera" button logic (pure).
 *
 * The server action and the page are thin; every decision lives here so it is
 * tested and mutation-tested:
 *
 *   - runView(state)        crawler state.json → what the owner sees (stage rows,
 *                           progress, elapsed) and which buttons are enabled.
 *   - verifyFile(...)       every downloaded file must match manifest.json's
 *                           sha256 + byte count (enterprise cutover: a moved
 *                           file is a NO-GO, never "probably fine").
 *   - parseJsonl(text)      transfer_details / batches records; torn lines are
 *                           counted, never silently passed.
 *   - importDecision(...)   the gate in front of runImport:
 *                             real import  → needs GO, a fresh harvest, and the
 *                                            one-time cutover guard not tripped;
 *                             test import  → always allowed (labelled), so a
 *                                            NO-GO rehearsal can still be inspected.
 *
 * Reads nothing, writes nothing. Money is not touched here (no payables: every
 * Cultivera manifest is already paid — bible §3b).
 */

export const PHASE_A_STAGES = [
  "login",
  "export_inventories",
  "export_products",
  "inventory_list",
  "transfers_list",
  "transfer_details",
  "batches",
  "sales",
  "wcia_json",
] as const;
export type PhaseAStage = (typeof PHASE_A_STAGES)[number];

export const STAGE_LABEL: Record<PhaseAStage, string> = {
  login: "Log in to Cultivera POS",
  export_inventories: "Inventory export (xlsx)",
  export_products: "Product export (xlsx)",
  inventory_list: "Inventory list (record of truth)",
  transfers_list: "Incoming transfers list",
  transfer_details: "Manifest details (one per delivery)",
  batches: "Batch dates for lots the export drops",
  sales: "Sales since the count (Oct 30 count only)",
  wcia_json: "Vendor transfer files (lab results)",
};

/**
 * R50 S3b: stages the cutover never waits on (the crawler's ENRICHMENT_STAGES). The crawler marks a
 * miss "partial" and still finishes the run; here a partial enrichment stage still allows Import.
 * R74 S2: a partial wcia_json row is LOUD (red, `loud: true`) and a real import must acknowledge the
 * missing vendor files (importDecision `vendorFilesMissing` / `acknowledgeMissingVendorFiles`).
 */
export const ENRICHMENT_STAGES: ReadonlySet<PhaseAStage> = new Set<PhaseAStage>(["sales", "wcia_json"]);

/** Files the importer downloads from a finished run (all must verify). */
export const REQUIRED_FILES = ["export_inventories.xlsx", "export_products.xlsx", "inventories.json", "state.json", "manifest.json"] as const;
/** Present only when the stage had work; verified when listed in the manifest. */
export const OPTIONAL_FILES = ["batches.jsonl", "transfer_details.jsonl", "transfers.json", "wcia_json.jsonl", "sales.jsonl", "sales_summary.json"] as const;

/** A real import must use a harvest at most this old (a stale snapshot misses today's sales). */
export const MAX_HARVEST_AGE_MINUTES = 90;

export type CrawlerStage = {
  status?: string;
  seconds?: number;
  missing?: unknown[];
  wanted?: number;
  fetched_now?: number;
  rows?: number;
  bytes?: number;
  errors?: number;
  /** R50 S11: sales stage with no count date on the run. */
  skipped?: string;
  /** R50 S11: Pacific wall clock of the stage (crawler pacific_wall). */
  startedPacific?: string;
  endedPacific?: string;
  /** R74 S2: wcia_json coverage (crawler wcia_coverage). */
  coverage?: { expected?: unknown; saved?: unknown; missing?: unknown; refused?: unknown; errors?: unknown; stoppedForTime?: unknown; complete?: unknown };
  /** Enrichment stage error text (stage still "partial"). */
  error?: string;
};
export type CrawlerState = {
  status?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  seconds?: number;
  withinBudget?: boolean;
  stages?: Partial<Record<string, CrawlerStage>>;
  /** R74 S2: loud run-level warnings (e.g. vendor transfer files missing). */
  warnings?: unknown[];
};
export type CrawlerRun = { runId: string; active: boolean; state: CrawlerState | null };

export type StageRow = {
  stage: PhaseAStage;
  label: string;
  status: "done" | "partial" | "incomplete" | "pending" | "running";
  seconds: number | null;
  detail: string;
  /** R74 S2: shown red with a MISSING tag (a partial vendor-files stage). */
  loud: boolean;
};

export type RunView = {
  runId: string;
  status: "running" | "done" | "failed" | "cancelled" | "unknown";
  rows: StageRow[];
  doneStages: number;
  totalStages: number;
  percent: number;
  error: string | null;
  seconds: number | null;
  withinBudget: boolean | null;
  canCancel: boolean;
  canResume: boolean;
  canImport: boolean;
  /** Page should auto-refresh while true. */
  poll: boolean;
  /** R74 S2: loud warnings to show in red above the stages (crawler warnings + a loud row). */
  warnings: string[];
};

const KNOWN = new Set(["running", "done", "failed", "cancelled"]);

function stageDetail(s: CrawlerStage): string {
  const parts: string[] = [];
  if (typeof s.skipped === "string" && s.skipped) return "not needed (no count date)";
  if (typeof s.rows === "number") parts.push(`${s.rows.toLocaleString("en-US")} rows`);
  if (typeof s.bytes === "number") parts.push(`${Math.round(s.bytes / 1024).toLocaleString("en-US")} KB`);
  if (typeof s.wanted === "number") parts.push(`${s.wanted - (s.missing?.length ?? 0)} / ${s.wanted}`);
  if (s.missing && s.missing.length > 0) parts.push(`${s.missing.length} not fetched`);
  if (typeof s.errors === "number" && s.errors > 0) parts.push(`${s.errors} errors`);
  const refused = s.coverage && typeof s.coverage.refused === "number" ? s.coverage.refused : 0;
  if (refused > 0) parts.push(`${refused} refused`);
  if (s.coverage?.stoppedForTime === true) parts.push("stopped for time");
  if (typeof s.error === "string" && s.error) parts.push(`error: ${s.error}`);
  return parts.join(" · ");
}

/** crawler run → what the page shows. An active run is "running" whatever state.json says. */
export function runView(run: CrawlerRun): RunView {
  const st = run.state ?? {};
  const raw = String(st.status ?? "");
  const status: RunView["status"] = run.active ? "running" : KNOWN.has(raw) ? (raw as RunView["status"]) : "unknown";
  let firstOpen = true;
  const rows: StageRow[] = PHASE_A_STAGES.map((stage) => {
    const s = st.stages?.[stage];
    let rowStatus: StageRow["status"];
    if (s?.status === "done") rowStatus = "done";
    // R50 S11: a crawler deployed before the sales stage existed finishes without a "sales" record.
    // Sales are only for the Oct 30 count, so that run still imports (shown as not needed).
    else if (!s && stage === "sales" && status === "done") rowStatus = "done";
    else if (s?.status === "partial" && ENRICHMENT_STAGES.has(stage)) rowStatus = "partial";
    else if (s?.status === "incomplete") rowStatus = "incomplete";
    else if (status === "running" && firstOpen) rowStatus = "running";
    else rowStatus = "pending";
    if (rowStatus !== "done") firstOpen = false;
    // R74 S2: vendor files never go quiet - a partial is loud, so is a "done" whose coverage says incomplete.
    const loud = stage === "wcia_json" && (rowStatus === "partial" || (rowStatus === "done" && s?.coverage?.complete === false));
    return { stage, label: STAGE_LABEL[stage], status: rowStatus, seconds: typeof s?.seconds === "number" ? s.seconds : null, detail: s ? stageDetail(s) : stage === "sales" && rowStatus === "done" ? "not needed (no count date)" : "", loud };
  });
  const warnings = (Array.isArray(st.warnings) ? st.warnings : []).filter((w): w is string => typeof w === "string" && w.trim() !== "");
  const loudRow = rows.find((r) => r.loud);
  if (loudRow && !warnings.some((w) => w.startsWith("Vendor transfer files"))) {
    warnings.push(`Vendor transfer files: ${loudRow.detail || "incomplete"}. MISSING files mean missing lab results on those manifests.`);
  }
  const doneStages = rows.filter((r) => r.status === "done" || r.status === "partial").length;
  return {
    runId: run.runId,
    status,
    rows,
    doneStages,
    totalStages: rows.length,
    percent: Math.floor((doneStages * 100) / rows.length),
    error: st.error ? String(st.error) : null,
    seconds: typeof st.seconds === "number" ? st.seconds : null,
    withinBudget: typeof st.withinBudget === "boolean" ? st.withinBudget : null,
    canCancel: status === "running",
    canResume: status === "failed" || status === "cancelled",
    canImport: status === "done" && doneStages === rows.length,
    poll: status === "running",
    warnings,
  };
}

export type ManifestFile = { name: string; bytes: number; sha256: string };
export type Manifest = { kind?: string; status?: string; files?: ManifestFile[]; finishedAt?: string };

/** A downloaded file must be byte-for-byte the one the harvester recorded. */
export function verifyFile(manifest: Manifest, name: string, bytes: number, sha256Hex: string): { ok: boolean; reason: string } {
  const f = (manifest.files ?? []).find((x) => x.name === name);
  if (!f) return { ok: false, reason: `${name} is not in the run manifest` };
  if (f.bytes !== bytes) return { ok: false, reason: `${name}: ${bytes} bytes downloaded, manifest says ${f.bytes}` };
  if (f.sha256.toLowerCase() !== sha256Hex.toLowerCase()) return { ok: false, reason: `${name}: checksum differs from the manifest` };
  return { ok: true, reason: "" };
}

/** Which optional files the importer must fetch (and verify) — exactly those the manifest lists. */
export function optionalFilesToFetch(manifest: Manifest): string[] {
  const listed = new Set((manifest.files ?? []).map((f) => f.name));
  return OPTIONAL_FILES.filter((n) => listed.has(n));
}

/** JSONL → records. Blank lines ignored; unparsable or non-object lines are counted as bad. */
export function parseJsonl<T = Record<string, unknown>>(text: string): { records: T[]; bad: number } {
  const records: T[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) records.push(v as T);
      else bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { records, bad };
}

/** Minutes since the harvest finished (null if the timestamp is missing or junk). */
export function harvestAgeMinutes(finishedAt: string | null | undefined, nowMs: number): number | null {
  if (!finishedAt) return null;
  const t = Date.parse(finishedAt);
  if (Number.isNaN(t)) return null;
  return (nowMs - t) / 60000;
}

export type ImportDecisionInput = {
  isTest: boolean;
  go: boolean;
  cutoverDone: boolean;
  /** harvestAgeMinutes(...) */
  ageMinutes: number | null;
  /** Every verifyFile() passed and no JSONL line was bad. */
  filesVerified: boolean;
  /**
   * R74 S2: vendor transfer files the run is missing (cultivera-wcia-coverage-core missingToAcknowledge).
   * A real import with any missing needs `acknowledgeMissingVendorFiles` (the owner ticks "stage
   * without them"); the obtained files still stage. A test import never needs it.
   */
  vendorFilesMissing?: number;
  acknowledgeMissingVendorFiles?: boolean;
};

export type ImportDecision = { allowed: boolean; reasons: string[]; label: "real" | "test" };

/**
 * The gate in front of runImport. Real imports need every check; a test import
 * is always allowed (it is flagged and Clean Slate removes it) so a NO-GO run
 * can still be opened and inspected — but never verified-less files.
 */
export function importDecision(i: ImportDecisionInput): ImportDecision {
  const reasons: string[] = [];
  if (!i.filesVerified) reasons.push("The downloaded files do not match the harvest manifest. Run the fetch again.");
  if (!i.isTest) {
    if (i.cutoverDone) reasons.push("The one-time Cultivera import already went live. Only a test import is allowed now.");
    if (!i.go) reasons.push("The go/no-go report is NO-GO. Fix the failing checks (usually: fetch again) before a real import.");
    if (i.ageMinutes === null) reasons.push("The harvest has no finish time. Fetch again.");
    else if (i.ageMinutes > MAX_HARVEST_AGE_MINUTES) reasons.push(`The harvest is ${Math.round(i.ageMinutes)} minutes old (limit ${MAX_HARVEST_AGE_MINUTES}). Fetch again so today's sales are in it.`);
    else if (i.ageMinutes < -5) reasons.push("The harvest finish time is in the future. Check the server clock and fetch again.");
    const missing = i.vendorFilesMissing ?? 0;
    if (missing > 0 && !i.acknowledgeMissingVendorFiles)
      reasons.push(`${missing} vendor transfer file${missing === 1 ? " is" : "s are"} MISSING (lab results). Fetch again to get them, or tick \u201cStage without the missing vendor files\u201d. The files it did get still stage.`);
  }
  return { allowed: reasons.length === 0, reasons, label: i.isTest ? "test" : "real" };
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraFetchButtonCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-fetch-button-core: " + msg);
    passed += 1;
  };

  const salesPartialLoud = () =>
    runView({ runId: "r", active: false, state: { status: "done", stages: Object.fromEntries(PHASE_A_STAGES.map((s) => [s, s === "sales" ? { status: "partial" } : { status: "done" }])) } }).rows.some((r) => r.loud);
  // ---- runView ----
  const doneStages = Object.fromEntries(PHASE_A_STAGES.map((s) => [s, { status: "done", seconds: 1 }]));
  const done = runView({ runId: "r", active: false, state: { status: "done", stages: doneStages, seconds: 478.3, withinBudget: true } });
  ok(done.status === "done" && done.doneStages === 9 && done.percent === 100 && done.canImport && !done.canCancel && !done.canResume && !done.poll, "done run → import enabled, no poll");
  ok(done.rows.every((r) => r.status === "done") && done.seconds === 478.3 && done.withinBudget === true, "done rows + seconds + budget");

  const mid = runView({ runId: "r", active: true, state: { status: "running", stages: { login: { status: "done" }, export_inventories: { status: "done", bytes: 647118 } } } });
  ok(mid.status === "running" && mid.poll && mid.canCancel && !mid.canImport && !mid.canResume, "active run → poll + cancel only");
  ok(mid.rows[2].status === "running" && mid.rows[3].status === "pending" && mid.rows[1].detail === "632 KB", "first open stage is running, later pending, bytes shown");
  ok(mid.doneStages === 2 && mid.percent === 22, "2 of 9 stages = 22%");
  // R50 S3b: a partial enrichment stage still imports; a partial CORE stage never counts.
  const partial = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, wcia_json: { status: "partial", wanted: 619, missing: [1] } } } });
  ok(partial.canImport && partial.rows[8].status === "partial" && partial.rows[8].detail === "618 / 619 · 1 not fetched", "partial vendor files still import");
  // R74 S2: …but never silently.
  ok(partial.rows[8].loud && partial.warnings.length === 1 && partial.warnings[0].startsWith("Vendor transfer files: 618 / 619 · 1 not fetched"), "partial vendor files are LOUD (row + warning)");
  ok(!done.rows.some((r) => r.loud) && done.warnings.length === 0, "a complete run is quiet");
  const crawlerWarn = runView({ runId: "r", active: false, state: { status: "done", warnings: ["Vendor transfer files: 1 of 619 MISSING (1 errors). The 618 saved still stage.", 7, ""], stages: { ...doneStages, wcia_json: { status: "partial", wanted: 619, missing: [1], errors: 1, coverage: { refused: 2, stoppedForTime: true, complete: false } } } } });
  ok(crawlerWarn.warnings.length === 1 && crawlerWarn.warnings[0].includes("1 of 619 MISSING"), "crawler warning used as-is (no duplicate), junk entries dropped");
  ok(crawlerWarn.rows[8].detail === "618 / 619 · 1 not fetched · 1 errors · 2 refused · stopped for time", "detail names errors, refused, time");
  const doneButIncomplete = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, wcia_json: { status: "done", coverage: { complete: false } } } } });
  ok(doneButIncomplete.rows[8].loud && doneButIncomplete.warnings.length === 1, "coverage incomplete on a done row is still loud");
  ok(!salesPartialLoud(), "a partial SALES row is not the vendor-files alarm");
  const corePartial = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, batches: { status: "partial" } } } });
  ok(!corePartial.canImport && corePartial.rows[6].status === "pending", "\"partial\" on a core stage is not accepted");
  ok(optionalFilesToFetch({ files: [{ name: "wcia_json.jsonl", bytes: 1, sha256: "x" }] }).join() === "wcia_json.jsonl", "vendor files fetched when listed");

  const staleActive = runView({ runId: "r", active: true, state: { status: "done", stages: doneStages } });
  ok(staleActive.status === "running" && !staleActive.canImport, "active wins over a done state.json (resume in flight)");

  const failed = runView({ runId: "r", active: false, state: { status: "failed", error: "transfer_details: 3 ids not fetched", stages: { ...doneStages, transfer_details: { status: "incomplete", wanted: 644, missing: [1, 2, 3] }, batches: {} } } });
  ok(failed.canResume && !failed.canImport && !failed.poll && failed.error === "transfer_details: 3 ids not fetched", "failed → resume, never import");
  ok(failed.rows[5].status === "incomplete" && failed.rows[5].detail === "641 / 644 · 3 not fetched" && failed.rows[6].status === "pending", "incomplete stage detail");

  const cancelled = runView({ runId: "r", active: false, state: { status: "cancelled" } });
  ok(cancelled.canResume && !cancelled.canCancel && cancelled.rows.every((r) => r.status === "pending"), "cancelled → resume");
  const junk = runView({ runId: "r", active: false, state: { status: "weird" } });
  ok(junk.status === "unknown" && !junk.canImport && !junk.canResume && !junk.canCancel, "unknown status enables nothing");
  const nullState = runView({ runId: "r", active: false, state: null });
  ok(nullState.status === "unknown" && nullState.doneStages === 0, "missing state is unknown");
  const doneButShort = runView({ runId: "r", active: false, state: { status: "done", stages: { login: { status: "done" } } } });
  ok(!doneButShort.canImport, "done with a stage missing never imports");
  // R50 S11: sales stage — skipped (no count date) and absent (older crawler) both still import.
  const noSales = Object.fromEntries(Object.entries(doneStages).filter(([k]) => k !== "sales"));
  const oldCrawler = runView({ runId: "r", active: false, state: { status: "done", stages: noSales } });
  ok(oldCrawler.canImport && oldCrawler.rows[7].stage === "sales" && oldCrawler.rows[7].detail === "not needed (no count date)", "a crawler without the sales stage still imports");
  const oldRunning = runView({ runId: "r", active: true, state: { status: "running", stages: noSales } });
  ok(oldRunning.rows[7].status === "running" && !oldRunning.canImport, "an active run never treats sales as done early");
  const skipped = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, sales: { status: "done", skipped: "no count date on this run" } } } });
  ok(skipped.canImport && skipped.rows[7].detail === "not needed (no count date)", "skipped sales shown as not needed");
  const salesPartial = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, sales: { status: "partial", rows: 4577, missing: ["x"] } } } });
  ok(salesPartial.canImport && salesPartial.rows[7].status === "partial", "a sales miss never blocks the cutover import (count page refuses it instead)");
  ok(optionalFilesToFetch({ files: [{ name: "sales.jsonl", bytes: 1, sha256: "x" }, { name: "sales_summary.json", bytes: 1, sha256: "y" }] }).join() === "sales.jsonl,sales_summary.json", "sales files fetched when listed");
  const rows = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, inventory_list: { status: "done", rows: 3824 } } } });
  ok(rows.rows[3].detail === "3,824 rows", "row count formatted");

  // ---- verifyFile ----
  const m: Manifest = { files: [{ name: "a.xlsx", bytes: 10, sha256: "ABC" }] };
  ok(verifyFile(m, "a.xlsx", 10, "abc").ok, "matching file (case-insensitive hex) verifies");
  ok(!verifyFile(m, "a.xlsx", 11, "abc").ok && verifyFile(m, "a.xlsx", 11, "abc").reason.includes("11 bytes"), "byte count mismatch refused");
  ok(!verifyFile(m, "a.xlsx", 10, "abd").ok && verifyFile(m, "a.xlsx", 10, "abd").reason.includes("checksum"), "sha mismatch refused");
  ok(!verifyFile(m, "b.xlsx", 10, "abc").ok && !verifyFile({}, "a.xlsx", 10, "abc").ok, "unlisted file refused");
  ok(optionalFilesToFetch({ files: [{ name: "batches.jsonl", bytes: 1, sha256: "x" }, { name: "export_products.xlsx", bytes: 1, sha256: "y" }] }).join() === "batches.jsonl", "optional files = only those listed");
  ok(optionalFilesToFetch({}).length === 0, "no manifest files → none");

  // ---- parseJsonl ----
  const pj = parseJsonl('{"Id":1}\n\n{"Id":2}\n{"Id":3\n[1]\n7\n');
  ok(pj.records.length === 2 && pj.bad === 3, "2 records, torn + array + scalar lines counted bad");
  ok(parseJsonl("").records.length === 0 && parseJsonl("").bad === 0, "empty file");

  // ---- harvestAgeMinutes ----
  const now = Date.parse("2026-11-01T14:00:00Z");
  ok(harvestAgeMinutes("2026-11-01T13:30:00Z", now) === 30, "30 minutes old");
  ok(harvestAgeMinutes("", now) === null && harvestAgeMinutes("nope", now) === null && harvestAgeMinutes(null, now) === null, "missing/junk time → null");

  // ---- importDecision ----
  const real = { isTest: false, go: true, cutoverDone: false, ageMinutes: 20, filesVerified: true };
  ok(importDecision(real).allowed && importDecision(real).label === "real", "real GO fresh verified → allowed");
  ok(!importDecision({ ...real, go: false }).allowed, "real NO-GO refused");
  ok(!importDecision({ ...real, cutoverDone: true }).allowed, "real after cutover refused (refuseUpload semantics)");
  ok(!importDecision({ ...real, ageMinutes: 91 }).allowed && importDecision({ ...real, ageMinutes: 90 }).allowed, "age limit is 90 minutes inclusive");
  ok(!importDecision({ ...real, ageMinutes: null }).allowed, "real with no finish time refused");
  ok(!importDecision({ ...real, ageMinutes: -6 }).allowed && importDecision({ ...real, ageMinutes: -4 }).allowed, "future time beyond 5 min clock skew refused");
  ok(!importDecision({ ...real, filesVerified: false }).allowed, "unverified files refused");
  const t = { isTest: true, go: false, cutoverDone: true, ageMinutes: 9999, filesVerified: true };
  ok(importDecision(t).allowed && importDecision(t).label === "test", "test import allowed even NO-GO / stale / after cutover");
  ok(!importDecision({ ...t, filesVerified: false }).allowed, "test import still needs verified files");
  // R74 S2: missing vendor files need an explicit acknowledgment on a real import only.
  const miss = importDecision({ ...real, vendorFilesMissing: 3 });
  ok(!miss.allowed && miss.reasons.length === 1 && miss.reasons[0].startsWith("3 vendor transfer files are MISSING"), "real import with missing vendor files refused until acknowledged");
  ok(importDecision({ ...real, vendorFilesMissing: 1 }).reasons[0].startsWith("1 vendor transfer file is MISSING"), "singular wording");
  ok(importDecision({ ...real, vendorFilesMissing: 3, acknowledgeMissingVendorFiles: true }).allowed, "acknowledged → allowed (obtained files stage)");
  ok(importDecision({ ...real, vendorFilesMissing: 0 }).allowed, "none missing → no acknowledgment needed");
  ok(importDecision({ ...t, vendorFilesMissing: 9 }).allowed, "test import never needs the acknowledgment");
  ok(importDecision({ ...real, go: false, cutoverDone: true }).reasons.length === 2, "every failing reason listed");

  return { passed, failed: 0 };
}
