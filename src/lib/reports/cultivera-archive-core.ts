/**
 * src/lib/reports/cultivera-archive-core.ts  (CVB-5, pure)
 *
 * The decisions behind Admin -> Cultivera Archive, kept out of the page so they can be tested:
 *
 *   archiveRunSummary  the crawler's state.json -> one plain line, what the owner can press, and the
 *                      progress of every stage (the same eight stages crawler/app/cultivera_archive.py runs)
 *   planUploads        manifest files vs. what is already in the private bucket -> what still has to be
 *                      copied. A bucket object whose size differs from the manifest is a STOP, never an
 *                      overwrite (the bucket is upsert:false; nothing in it is ever replaced)
 *   contentTypeFor     the three mime types the 0337 bucket accepts
 *   datasetRollup      files -> one line per dataset (files, rows, bytes) for the "browse" table
 *   dailySalesFiles    which archived files hold Cultivera's daily figures (dataset daily_sales)
 *   parseJsonlRows     JSONL text -> objects, counting (never hiding) unreadable lines
 *
 * Owner request 2026-11-01 (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md): "This will also
 * allow me to retain Cultivera historical data safely in our system. This will be owner only access."
 */
import { ARCHIVE_FILE_NAME_RE, type RegisterFile } from "@/lib/reports/cultivera-benchmark-core";

/** crawler/app/cultivera_archive.py STAGES, in run order (a vitest pins the agreement). */
export const ARCHIVE_STAGES = [
  "login",
  "lookups",
  "summaries",
  "keyless",
  "paged",
  "orders",
  "cycle_count_details",
  "valuation_snapshots",
] as const;
export type ArchiveStage = (typeof ARCHIVE_STAGES)[number];

export const STAGE_LABELS: Record<ArchiveStage, string> = {
  login: "Sign in (read-only)",
  lookups: "Lookup lists",
  summaries: "Report summaries",
  keyless: "Roll-up reports (daily, weekly, monthly sales ...)",
  paged: "Every list (products, vendors, samples, shrink, sales lines ...)",
  orders: "Every order, month by month",
  cycle_count_details: "Cycle count details",
  valuation_snapshots: "Inventory valuation snapshots",
};

/** The bucket path of a file, the same rule as the 0337 check (run_id || '/' || file_name). */
export function storagePath(runId: string, name: string): string {
  return `${runId}/${name}`;
}

/** The manifest itself is stored beside the files; its sha256 is cultivera_archive_runs.manifest_sha256. */
export const MANIFEST_FILE = "manifest.json";

/** Leave headroom under the page's 300 s limit: stop starting new uploads after this long. */
export const UPLOAD_BUDGET_MS = 200_000;

export type ArchiveDatasetState = { status?: string; rows?: number; count?: number | null; parts?: { name: string; rows: number }[] };
export type ArchiveState = {
  status?: string;
  stages?: Record<string, { status?: string; seconds?: number } | undefined>;
  datasets?: Record<string, ArchiveDatasetState | undefined>;
  window?: { from?: string; to?: string } | null;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  calls?: number;
};

export type StageProgress = { stage: ArchiveStage; label: string; status: "done" | "running" | "waiting"; seconds: number | null };

export type ArchiveRunSummary = {
  line: string;
  /** The harvest finished: its files can be copied into our bucket. */
  canArchive: boolean;
  /** It stopped part-way: Continue picks up where it stopped (the crawler skips finished work). */
  canResume: boolean;
  running: boolean;
  stages: StageProgress[];
  datasetsDone: number;
  datasetsTotal: number;
  rows: number;
};

/** state.json -> what the page says. Every status the crawler writes has a plain sentence. */
export function archiveRunSummary(active: boolean, s: ArchiveState | null): ArchiveRunSummary {
  const st = s?.status ?? "pending";
  const running = active || st === "running";
  const ds = Object.values(s?.datasets ?? {}).filter((d): d is ArchiveDatasetState => Boolean(d));
  const datasetsDone = ds.filter((d) => d.status === "done").length;
  const rows = ds.reduce((a, d) => a + (Number.isInteger(d.rows) ? (d.rows as number) : 0), 0);
  let firstOpen = true;
  const stages: StageProgress[] = ARCHIVE_STAGES.map((stage) => {
    const x = s?.stages?.[stage];
    if (x?.status === "done") return { stage, label: STAGE_LABELS[stage], status: "done", seconds: typeof x.seconds === "number" ? x.seconds : null };
    const status = running && firstOpen ? "running" : "waiting";
    firstOpen = false;
    return { stage, label: STAGE_LABELS[stage], status, seconds: null };
  });
  const doneStages = stages.filter((x) => x.status === "done").length;
  const of = `${doneStages} of ${ARCHIVE_STAGES.length} stages, ${datasetsDone} datasets, ${rows.toLocaleString("en-US")} rows`;
  const base = { stages, datasetsDone, datasetsTotal: ds.length, rows, running };
  if (running) return { ...base, line: `Running: ${of}. It reads slowly on purpose; you can leave this page.`, canArchive: false, canResume: false };
  if (st === "done") return { ...base, line: `Finished: ${of}. Press Archive to copy every file into our storage.`, canArchive: true, canResume: false };
  if (st === "paused") return { ...base, line: `Paused at its time limit: ${of}. Press Continue to pick up where it stopped.`, canArchive: false, canResume: true };
  if (st === "cancelled") return { ...base, line: `Stopped: ${of}. Press Continue to pick up where it stopped.`, canArchive: false, canResume: true };
  if (st === "failed") return { ...base, line: `Stopped with a problem: ${s?.error ?? "unknown"}. ${of}. Press Continue to retry the rest.`, canArchive: false, canResume: true };
  return { ...base, line: "Not started.", canArchive: false, canResume: false };
}

export type BucketObject = { name: string; size: number | null };

export type UploadPlan = {
  /** Files still to copy, in manifest order. */
  toUpload: string[];
  /** Files already in the bucket with the manifest's size. */
  present: string[];
  /** Files in the bucket with a DIFFERENT size: archiving stops and says so. */
  mismatched: { name: string; bucketBytes: number | null; manifestBytes: number }[];
};

/**
 * What is left to copy. Only the manifest's files count; an object in the bucket that is not in the manifest is
 * ignored (it cannot be registered, because cvb_register_archive_run takes the manifest's list).
 */
export function planUploads(files: readonly RegisterFile[], bucket: readonly BucketObject[]): UploadPlan {
  const have = new Map<string, number | null>();
  for (const o of bucket) if (o && typeof o.name === "string") have.set(o.name, Number.isInteger(o.size) ? (o.size as number) : null);
  const plan: UploadPlan = { toUpload: [], present: [], mismatched: [] };
  for (const f of files) {
    if (!have.has(f.name)) plan.toUpload.push(f.name);
    else if (have.get(f.name) === f.bytes) plan.present.push(f.name);
    else plan.mismatched.push({ name: f.name, bucketBytes: have.get(f.name) ?? null, manifestBytes: f.bytes });
  }
  return plan;
}

/** The mime type the 0337 bucket allows for a file name, or null (never uploaded). */
export function contentTypeFor(name: string): "application/gzip" | "application/json" | "application/x-ndjson" | null {
  if (!ARCHIVE_FILE_NAME_RE.test(name)) return null;
  if (name.endsWith(".jsonl.gz")) return "application/gzip";
  if (name.endsWith(".jsonl")) return "application/x-ndjson";
  if (name.endsWith(".json")) return "application/json";
  return null;
}

/** The dataset of a file: the part of its name before the first dot (the 0337 rule). */
export function datasetOf(name: string): string {
  return name.split(".")[0] ?? name;
}

export type DatasetRollup = { dataset: string; files: number; rows: number | null; bytes: number };

/** One line per dataset, sorted by name. rows is null when no file of the dataset reports rows. */
export function datasetRollup(files: readonly { name: string; bytes: number; rows: number | null }[]): DatasetRollup[] {
  const by = new Map<string, DatasetRollup>();
  for (const f of files) {
    const d = datasetOf(f.name);
    const cur = by.get(d) ?? { dataset: d, files: 0, rows: null, bytes: 0 };
    cur.files++;
    cur.bytes += Number.isInteger(f.bytes) ? f.bytes : 0;
    if (Number.isInteger(f.rows)) cur.rows = (cur.rows ?? 0) + (f.rows as number);
    by.set(d, cur);
  }
  return [...by.values()].sort((a, b) => (a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : 0));
}

/** The archived files that hold Cultivera's daily report (dataset daily_sales), in part order. */
export function dailySalesFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((f) => datasetOf(f.name) === "daily_sales" && f.name.endsWith(".jsonl.gz")).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** JSONL -> objects. Blank lines skipped; anything that is not one JSON object is counted as bad. */
export function parseJsonlRows(text: string): { rows: Record<string, unknown>[]; bad: number } {
  const rows: Record<string, unknown>[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v as Record<string, unknown>);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

/** "1.2 MB" style sizes for the browse table. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "not available";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runCultiveraArchiveCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`cultivera-archive-core: ${m}`);
    n++;
  };
  ok(ARCHIVE_STAGES.length === 8 && ARCHIVE_STAGES[0] === "login" && ARCHIVE_STAGES[7] === "valuation_snapshots", "eight stages in crawler order");
  ok(ARCHIVE_STAGES.every((s) => STAGE_LABELS[s].length > 0), "every stage labelled");

  const none = archiveRunSummary(false, null);
  ok(none.line === "Not started." && !none.canArchive && !none.canResume, "no state");
  const running = archiveRunSummary(true, {
    status: "running",
    stages: { login: { status: "done", seconds: 1.2 }, lookups: { status: "done" } },
    datasets: { a: { status: "done", rows: 10 }, b: { status: "running", rows: 5 } },
  });
  ok(running.running && running.line.startsWith("Running: 2 of 8 stages, 1 datasets, 15 rows"), "running line");
  ok(running.stages[2].status === "running" && running.stages[3].status === "waiting", "only the first open stage is running");
  ok(running.stages[0].seconds === 1.2 && running.stages[1].seconds === null, "seconds only when recorded");
  ok(!running.canArchive && !running.canResume, "cannot archive or resume while running");
  const done = archiveRunSummary(false, { status: "done" });
  ok(done.canArchive && !done.canResume && done.stages.every((s) => s.status === "waiting"), "done can archive");
  for (const st of ["paused", "cancelled", "failed"]) {
    const x = archiveRunSummary(false, { status: st, error: "boom" });
    ok(x.canResume && !x.canArchive, `${st} resumes`);
  }
  ok(archiveRunSummary(false, { status: "failed", error: "HTTP 504" }).line.includes("HTTP 504"), "failed shows its error");
  ok(archiveRunSummary(false, { status: "running" }).running, "running status without the active flag (crawler restart) still counts as running");

  const files = [
    { name: "a.p0001.jsonl.gz", bytes: 10, sha256: "a".repeat(64), rows: 3 },
    { name: "b.json", bytes: 20, sha256: "b".repeat(64), rows: null },
    { name: "c.jsonl", bytes: 30, sha256: "c".repeat(64), rows: 2 },
  ];
  const p = planUploads(files, [{ name: "a.p0001.jsonl.gz", size: 10 }, { name: "b.json", size: 21 }, { name: "zzz.json", size: 1 }]);
  ok(p.toUpload.join() === "c.jsonl" && p.present.join() === "a.p0001.jsonl.gz", "plan: present vs to upload");
  ok(p.mismatched.length === 1 && p.mismatched[0].name === "b.json" && p.mismatched[0].bucketBytes === 21, "a size mismatch is reported, never overwritten");
  ok(planUploads(files, []).toUpload.length === 3, "empty bucket uploads all");
  ok(planUploads(files, [{ name: "c.jsonl", size: null }]).mismatched.length === 1, "unknown bucket size is a mismatch");

  ok(contentTypeFor("orders.2025-01.jsonl.gz") === "application/gzip", "gz mime");
  ok(contentTypeFor("lookups.json") === "application/json", "json mime");
  ok(contentTypeFor("errors.jsonl") === "application/x-ndjson", "jsonl mime");
  ok(contentTypeFor("../x.json") === null && contentTypeFor("a.txt") === null, "bad names get no mime");
  ok(storagePath("20261101T120000Z-0123abcd", "x.json") === "20261101T120000Z-0123abcd/x.json", "storage path rule");

  const roll = datasetRollup([
    { name: "orders.2025-01.jsonl.gz", bytes: 5, rows: 2 },
    { name: "orders.2025-02.jsonl.gz", bytes: 6, rows: 3 },
    { name: "lookups.json", bytes: 7, rows: null },
  ]);
  ok(roll.length === 2 && roll[0].dataset === "lookups" && roll[0].rows === null, "rollup: rows null when unknown");
  ok(roll[1].dataset === "orders" && roll[1].files === 2 && roll[1].rows === 5 && roll[1].bytes === 11, "rollup sums");

  const ds = dailySalesFiles([{ name: "daily_sales.p0002.jsonl.gz" }, { name: "daily_sales.p0001.jsonl.gz" }, { name: "weekly_sales.p0001.jsonl.gz" }, { name: "daily_sales.json" }]);
  ok(ds.map((f) => f.name).join() === "daily_sales.p0001.jsonl.gz,daily_sales.p0002.jsonl.gz", "daily sales parts only, in order");

  const j = parseJsonlRows('{"Day":1}\n\n[1]\nnot json\n{"Day":2}\n');
  ok(j.rows.length === 2 && j.bad === 2, "jsonl rows counted, bad lines counted");
  ok(formatBytes(512) === "512 B" && formatBytes(2048) === "2.0 KB" && formatBytes(5 * 1024 * 1024) === "5.0 MB", "bytes format");
  ok(formatBytes(-1) === "not available", "bad bytes");
  return { passed: n, failed: 0 };
}
