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
  wcia_json: "Vendor transfer files (lab results; optional)",
};

/**
 * R50 S3b: stages the cutover never waits on (the crawler's ENRICHMENT_STAGES). The crawler marks a
 * miss "partial" and still finishes the run; here a partial enrichment stage still allows Import.
 */
export const ENRICHMENT_STAGES: ReadonlySet<PhaseAStage> = new Set<PhaseAStage>(["wcia_json"]);

/** Files the importer downloads from a finished run (all must verify). */
export const REQUIRED_FILES = ["export_inventories.xlsx", "export_products.xlsx", "inventories.json", "state.json", "manifest.json"] as const;
/** Present only when the stage had work; verified when listed in the manifest. */
export const OPTIONAL_FILES = ["batches.jsonl", "transfer_details.jsonl", "transfers.json", "wcia_json.jsonl"] as const;

/** A real import must use a harvest at most this old (a stale snapshot misses today's sales). */
export const MAX_HARVEST_AGE_MINUTES = 90;

export type CrawlerStage = { status?: string; seconds?: number; missing?: unknown[]; wanted?: number; fetched_now?: number; rows?: number; bytes?: number; errors?: number };
export type CrawlerState = {
  status?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  seconds?: number;
  withinBudget?: boolean;
  stages?: Partial<Record<string, CrawlerStage>>;
};
export type CrawlerRun = { runId: string; active: boolean; state: CrawlerState | null };

export type StageRow = { stage: PhaseAStage; label: string; status: "done" | "partial" | "incomplete" | "pending" | "running"; seconds: number | null; detail: string };

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
};

const KNOWN = new Set(["running", "done", "failed", "cancelled"]);

function stageDetail(s: CrawlerStage): string {
  const parts: string[] = [];
  if (typeof s.rows === "number") parts.push(`${s.rows.toLocaleString("en-US")} rows`);
  if (typeof s.bytes === "number") parts.push(`${Math.round(s.bytes / 1024).toLocaleString("en-US")} KB`);
  if (typeof s.wanted === "number") parts.push(`${s.wanted - (s.missing?.length ?? 0)} / ${s.wanted}`);
  if (s.missing && s.missing.length > 0) parts.push(`${s.missing.length} not fetched`);
  if (typeof s.errors === "number" && s.errors > 0) parts.push(`${s.errors} errors`);
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
    else if (s?.status === "partial" && ENRICHMENT_STAGES.has(stage)) rowStatus = "partial";
    else if (s?.status === "incomplete") rowStatus = "incomplete";
    else if (status === "running" && firstOpen) rowStatus = "running";
    else rowStatus = "pending";
    if (rowStatus !== "done") firstOpen = false;
    return { stage, label: STAGE_LABEL[stage], status: rowStatus, seconds: typeof s?.seconds === "number" ? s.seconds : null, detail: s ? stageDetail(s) : "" };
  });
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

  // ---- runView ----
  const doneStages = Object.fromEntries(PHASE_A_STAGES.map((s) => [s, { status: "done", seconds: 1 }]));
  const done = runView({ runId: "r", active: false, state: { status: "done", stages: doneStages, seconds: 478.3, withinBudget: true } });
  ok(done.status === "done" && done.doneStages === 8 && done.percent === 100 && done.canImport && !done.canCancel && !done.canResume && !done.poll, "done run → import enabled, no poll");
  ok(done.rows.every((r) => r.status === "done") && done.seconds === 478.3 && done.withinBudget === true, "done rows + seconds + budget");

  const mid = runView({ runId: "r", active: true, state: { status: "running", stages: { login: { status: "done" }, export_inventories: { status: "done", bytes: 647118 } } } });
  ok(mid.status === "running" && mid.poll && mid.canCancel && !mid.canImport && !mid.canResume, "active run → poll + cancel only");
  ok(mid.rows[2].status === "running" && mid.rows[3].status === "pending" && mid.rows[1].detail === "632 KB", "first open stage is running, later pending, bytes shown");
  ok(mid.doneStages === 2 && mid.percent === 25, "2 of 8 stages = 25%");
  // R50 S3b: a partial enrichment stage still imports; a partial CORE stage never counts.
  const partial = runView({ runId: "r", active: false, state: { status: "done", stages: { ...doneStages, wcia_json: { status: "partial", wanted: 619, missing: [1] } } } });
  ok(partial.canImport && partial.rows[7].status === "partial" && partial.rows[7].detail === "618 / 619 · 1 not fetched", "partial vendor files still import");
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
  ok(importDecision({ ...real, go: false, cutoverDone: true }).reasons.length === 2, "every failing reason listed");

  return { passed, failed: 0 };
}
