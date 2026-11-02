/**
 * src/lib/reports/cultivera-archive-runner.ts  (CVB-5, server-only)
 *
 * "Archive" for a finished Cultivera harvest, in the order that keeps the copy honest:
 *
 *   1. the manifest's file list must pass manifestToRegisterFiles (refused whole, never partial)
 *   2. every file not yet in the private bucket is downloaded from the crawler, checked against the
 *      manifest (bytes + sha256) and stored with upsert:false. A file already in the bucket with a different
 *      size stops the archive. The page has 300 s, so this stops starting new files after UPLOAD_BUDGET_MS and
 *      says how far it got; pressing Archive again continues (nothing is copied twice)
 *   3. the manifest's own bytes are stored as manifest.json and their sha256 registered with every file in one
 *      transaction (cvb_register_archive_run)
 *   4. Cultivera's daily figures are read back FROM THE BUCKET (not the crawler), checked against the
 *      registered sha256, converted to cents and stored (cvb_upsert_benchmark_days, batches of 1,000)
 *
 * Step 4 runs on its own too ("Rebuild daily figures"), so it keeps working after the crawler's copy is pruned
 * or the Cultivera account is closed.
 */
import "server-only";
import { gunzipSync } from "node:zlib";
import {
  dayBatches,
  manifestToRegisterFiles,
  normalizeDailySales,
  type CultiveraDailySalesRaw,
  type RegisterResult,
} from "@/lib/reports/cultivera-benchmark-core";
import { MANIFEST_FILE, UPLOAD_BUDGET_MS, dailySalesFiles, parseJsonlRows, planUploads } from "@/lib/reports/cultivera-archive-core";
import { getArchiveRun, manifestBytes, sha256Hex, verifiedArchiveFile } from "@/lib/reports/cultivera-archive-client";
import {
  downloadArchiveFile,
  getArchivedRun,
  listArchivedFiles,
  listBucketRun,
  registerArchiveRun,
  uploadArchiveFile,
  upsertBenchmarkDays,
} from "@/lib/reports/cultivera-benchmark-store";

export type ArchiveStepResult =
  | { kind: "partial"; uploaded: number; remaining: number; total: number }
  | { kind: "archived"; register: RegisterResult; uploaded: number; days: DaysIngestResult };

export async function archiveFinishedRun(runId: string, actorId: string | null, now: () => number = Date.now): Promise<ArchiveStepResult> {
  const started = now();
  const run = await getArchiveRun(runId);
  if (!run) throw new Error("The crawler does not know this run (it may have been pruned).");
  if (run.active || run.state?.status !== "done" || !run.manifest) throw new Error("The harvest has not finished yet.");
  const manifest = run.manifest;
  const capturedAt = manifest.finishedAt ?? run.state?.finishedAt ?? null;
  if (!capturedAt) throw new Error("The manifest has no finish time, so the capture date cannot be recorded. Not archived.");

  const already = await getArchivedRun(runId);
  if (already) {
    const days = await ingestDailyFigures(runId);
    return { kind: "archived", register: { status: "already", runId }, uploaded: 0, days };
  }

  const { files, problems } = manifestToRegisterFiles(manifest);
  if (problems.length) throw new Error(`The manifest cannot be archived: ${problems.slice(0, 5).join("; ")}`);

  const plan = planUploads(files, await listBucketRun(runId));
  if (plan.mismatched.length) {
    const m = plan.mismatched[0];
    throw new Error(
      `${m.name} is already in storage with ${m.bucketBytes ?? "an unknown number of"} bytes, but the manifest says ${m.manifestBytes}. Nothing was overwritten; ask for help before going on.`,
    );
  }
  let uploaded = 0;
  for (const name of plan.toUpload) {
    if (now() - started > UPLOAD_BUDGET_MS) {
      return { kind: "partial", uploaded, remaining: plan.toUpload.length - uploaded, total: files.length };
    }
    const bytes = await verifiedArchiveFile(runId, manifest, name);
    await uploadArchiveFile(runId, name, bytes);
    uploaded++;
  }
  // Re-check sizes of everything now in the bucket (catches a concurrent click that stored a different file).
  const recheck = planUploads(files, await listBucketRun(runId));
  if (recheck.mismatched.length || recheck.toUpload.length) {
    return { kind: "partial", uploaded, remaining: recheck.toUpload.length + recheck.mismatched.length, total: files.length };
  }

  const mb = await manifestBytes(runId, manifest);
  await uploadArchiveFile(runId, MANIFEST_FILE, mb);
  const register = await registerArchiveRun(runId, capturedAt, sha256Hex(mb), actorId, files);
  const days = await ingestDailyFigures(runId);
  return { kind: "archived", register, uploaded, days };
}

export type DaysIngestResult = {
  files: number;
  rawRows: number;
  badLines: number;
  stored: number;
  written: number;
  keptNewer: number;
  problems: number;
  problemSample: string[];
  conflicts: string[];
  first: string | null;
  last: string | null;
};

/** Cultivera's daily report from an ARCHIVED run (bucket copy, sha256-checked against the register) -> cents rows. */
export async function ingestDailyFigures(runId: string): Promise<DaysIngestResult> {
  const reg = await getArchivedRun(runId);
  if (!reg) throw new Error("This run is not archived yet; press Archive first.");
  const registered = await listArchivedFiles(runId);
  const parts = dailySalesFiles(registered);
  const raws: CultiveraDailySalesRaw[] = [];
  let badLines = 0;
  for (const f of parts) {
    const b = await downloadArchiveFile(runId, f.name);
    if (b.length !== f.bytes || sha256Hex(b) !== f.sha256) {
      throw new Error(`${f.name} in storage does not match its registered sha256. Nothing was stored.`);
    }
    const parsed = parseJsonlRows(gunzipSync(b).toString("utf8"));
    badLines += parsed.bad;
    raws.push(...(parsed.rows as CultiveraDailySalesRaw[]));
  }
  const norm = normalizeDailySales(raws);
  let written = 0;
  let keptNewer = 0;
  for (const batch of dayBatches(norm.rows)) {
    const r = await upsertBenchmarkDays(runId, batch);
    written += r.written;
    keptNewer += r.keptNewer;
  }
  return {
    files: parts.length,
    rawRows: raws.length,
    badLines,
    stored: norm.rows.length,
    written,
    keptNewer,
    problems: norm.problems.length,
    problemSample: norm.problems.slice(0, 5).map((p) => `row ${p.index + 1}: ${p.problem}`),
    conflicts: norm.conflicts,
    first: norm.rows[0]?.day ?? null,
    last: norm.rows[norm.rows.length - 1]?.day ?? null,
  };
}
