/**
 * src/lib/reports/cultivera-benchmark-store.ts  (CVB-5, server-only)
 *
 * Database + bucket side of the Cultivera archive and benchmark (migration 0337):
 *   - the private `cultivera-archive` bucket (list, upload with upsert:false, download)
 *   - cvb_register_archive_run / cvb_upsert_benchmark_days (service_role functions)
 *   - reads of cultivera_archive_runs / _files, cultivera_benchmark_days, cultivera_payback_entries
 *   - the insert-only payback ledger (a repeated entry_key is "already recorded", never a double credit)
 *
 * Every call reads its { error } (rule 15) and names its columns.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll } from "@/lib/supabase/chunked-in";
import {
  parseDaysResult,
  parseRegisterResult,
  type BenchmarkDayRow,
  type PaybackEntry,
  type PaybackKind,
  type RegisterFile,
  type RegisterResult,
} from "@/lib/reports/cultivera-benchmark-core";
import { contentTypeFor, storagePath, type BucketObject } from "@/lib/reports/cultivera-archive-core";

export const ARCHIVE_BUCKET = "cultivera-archive";
const MIGRATION = "supabase/migrations/0337_cultivera_benchmark_archive.sql";
const LIST_PAGE = 1000;

/** Plain meaning of a database / storage error (rule 15). */
export function explainCvbError(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = (e?.code ?? "").trim();
  const msg = (e?.message ?? "").trim();
  if (code === "42501") return `The server is not allowed to do this (${msg}). Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42883" || code === "PGRST202") return `The Cultivera benchmark functions are not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42P01" || code === "PGRST205" || code === "42703") return `The Cultivera benchmark tables are not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  if (/bucket not found/i.test(msg)) return `The private cultivera-archive bucket is missing. Run ${MIGRATION} in the Supabase SQL editor.`;
  return msg || code || "Unknown database error";
}

function admin() {
  if (!isSupabaseServiceConfigured) throw new Error("Supabase is not configured.");
  return createSupabaseAdminClient();
}

// ---------------------------------------------------------------------------
// bucket
// ---------------------------------------------------------------------------

/** Every object already stored under <runId>/ (name + size), paged. */
export async function listBucketRun(runId: string): Promise<BucketObject[]> {
  const bucket = admin().storage.from(ARCHIVE_BUCKET);
  const out: BucketObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(runId, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(explainCvbError(error));
    const page = (data ?? []) as { name: string; id?: string | null; metadata?: { size?: number } | null }[];
    for (const o of page) {
      if (!o.id) continue; // a folder placeholder, not a file
      const size = o.metadata?.size;
      out.push({ name: o.name, size: Number.isInteger(size) ? (size as number) : null });
    }
    if (page.length < LIST_PAGE) break;
  }
  return out;
}

/**
 * Store one verified file. upsert:false: an object already there is never replaced. "exists" means another
 * click stored it first; its size is checked on the next pass (planUploads), never assumed.
 */
export async function uploadArchiveFile(runId: string, name: string, bytes: Buffer): Promise<"uploaded" | "exists"> {
  const contentType = contentTypeFor(name);
  if (!contentType) throw new Error(`${name} is not an archive file name.`);
  const { error } = await admin().storage.from(ARCHIVE_BUCKET).upload(storagePath(runId, name), bytes, { contentType, upsert: false });
  if (!error) return "uploaded";
  if (/already exists|duplicate/i.test(error.message ?? "")) return "exists";
  throw new Error(`${name}: ${explainCvbError(error)}`);
}

/** Read one stored file back (used to rebuild the daily figures from the bucket, never from the crawler). */
export async function downloadArchiveFile(runId: string, name: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(ARCHIVE_BUCKET).download(storagePath(runId, name));
  if (error || !data) throw new Error(`${name}: ${explainCvbError(error ?? { message: "not found in the bucket" })}`);
  return Buffer.from(await data.arrayBuffer());
}

// ---------------------------------------------------------------------------
// register + daily figures
// ---------------------------------------------------------------------------

export async function registerArchiveRun(
  runId: string,
  capturedAt: string,
  manifestSha256: string,
  actorId: string | null,
  files: RegisterFile[],
): Promise<RegisterResult> {
  const { data, error } = await admin().rpc("cvb_register_archive_run", {
    p_run_id: runId,
    p_captured_at: capturedAt,
    p_manifest_sha256: manifestSha256,
    p_actor: actorId,
    p_files: files,
  });
  if (error) {
    if (error.code === "23505") throw new Error(`Run ${runId} is already archived from a different manifest; it was not changed.`);
    throw new Error(explainCvbError(error));
  }
  const r = parseRegisterResult(data);
  if (!r) throw new Error("cvb_register_archive_run answered in an unexpected shape.");
  return r;
}

export async function upsertBenchmarkDays(runId: string, rows: BenchmarkDayRow[]): Promise<{ rows: number; written: number; keptNewer: number }> {
  const { data, error } = await admin().rpc("cvb_upsert_benchmark_days", { p_run_id: runId, p_rows: rows });
  if (error) throw new Error(explainCvbError(error));
  const r = parseDaysResult(data);
  if (!r) throw new Error("cvb_upsert_benchmark_days answered in an unexpected shape.");
  return r;
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export type ArchivedRun = {
  runId: string;
  capturedAt: string;
  manifestSha256: string;
  fileCount: number;
  totalBytes: number;
  totalRows: number;
  archivedAt: string;
};

export async function listArchivedRuns(limit = 20): Promise<ArchivedRun[]> {
  if (!isSupabaseServiceConfigured) return [];
  const { data, error } = await admin()
    .from("cultivera_archive_runs")
    .select("run_id, captured_at, manifest_sha256, file_count, total_bytes, total_rows, archived_at")
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(explainCvbError(error));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    runId: String(r.run_id),
    capturedAt: String(r.captured_at),
    manifestSha256: String(r.manifest_sha256),
    fileCount: Number(r.file_count),
    totalBytes: Number(r.total_bytes),
    totalRows: Number(r.total_rows),
    archivedAt: String(r.archived_at),
  }));
}

export async function getArchivedRun(runId: string): Promise<ArchivedRun | null> {
  if (!isSupabaseServiceConfigured) return null;
  const { data, error } = await admin()
    .from("cultivera_archive_runs")
    .select("run_id, captured_at, manifest_sha256, file_count, total_bytes, total_rows, archived_at")
    .eq("run_id", runId)
    .maybeSingle();
  if (error) throw new Error(explainCvbError(error));
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    runId: String(r.run_id),
    capturedAt: String(r.captured_at),
    manifestSha256: String(r.manifest_sha256),
    fileCount: Number(r.file_count),
    totalBytes: Number(r.total_bytes),
    totalRows: Number(r.total_rows),
    archivedAt: String(r.archived_at),
  };
}

export type ArchivedFile = { name: string; dataset: string; bytes: number; sha256: string; rows: number | null };

export async function listArchivedFiles(runId: string): Promise<ArchivedFile[]> {
  if (!isSupabaseServiceConfigured) return [];
  const out: ArchivedFile[] = [];
  for (let from = 0; ; from += LIST_PAGE) {
    const { data, error } = await admin()
      .from("cultivera_archive_files")
      .select("file_name, dataset, bytes, sha256, row_count")
      .eq("run_id", runId)
      .order("file_name", { ascending: true })
      .range(from, from + LIST_PAGE - 1);
    if (error) throw new Error(explainCvbError(error));
    const page = (data ?? []) as Record<string, unknown>[];
    for (const r of page) {
      out.push({
        name: String(r.file_name),
        dataset: String(r.dataset),
        bytes: Number(r.bytes),
        sha256: String(r.sha256),
        rows: r.row_count === null || r.row_count === undefined ? null : Number(r.row_count),
      });
    }
    if (page.length < LIST_PAGE) break;
  }
  return out;
}

/** Cultivera's stored daily figures between two Pacific days (inclusive). */
export async function benchmarkDays(from: string, to: string): Promise<BenchmarkDayRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const out: BenchmarkDayRow[] = [];
  for (let off = 0; ; off += LIST_PAGE) {
    const { data, error } = await admin()
      .from("cultivera_benchmark_days")
      .select(
        "day, gross_sales_minor, discounts_minor, taxes_minor, returns_minor, net_sales_minor, cost_minor, gross_profit_minor, net_profit_minor, cash_redemption_minor",
      )
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: true })
      .range(off, off + LIST_PAGE - 1);
    if (error) throw new Error(explainCvbError(error));
    const page = (data ?? []) as Record<string, unknown>[];
    for (const r of page) {
      out.push({
        day: String(r.day),
        gross_sales_minor: Number(r.gross_sales_minor),
        discounts_minor: Number(r.discounts_minor),
        taxes_minor: Number(r.taxes_minor),
        returns_minor: Number(r.returns_minor),
        net_sales_minor: Number(r.net_sales_minor),
        cost_minor: Number(r.cost_minor),
        gross_profit_minor: Number(r.gross_profit_minor),
        net_profit_minor: Number(r.net_profit_minor),
        cash_redemption_minor: Number(r.cash_redemption_minor),
      });
    }
    if (page.length < LIST_PAGE) break;
  }
  return out;
}

/** First and last day Cultivera figures are stored for, and how many days. */
export async function benchmarkDaysSpan(): Promise<{ first: string | null; last: string | null; days: number }> {
  if (!isSupabaseServiceConfigured) return { first: null, last: null, days: 0 };
  const db = admin();
  const first = await db.from("cultivera_benchmark_days").select("day").order("day", { ascending: true }).limit(1).maybeSingle();
  if (first.error) throw new Error(explainCvbError(first.error));
  const last = await db.from("cultivera_benchmark_days").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (last.error) throw new Error(explainCvbError(last.error));
  const count = await db.from("cultivera_benchmark_days").select("day", { count: "exact", head: true });
  if (count.error) throw new Error(explainCvbError(count.error));
  return {
    first: first.data ? String((first.data as { day: string }).day) : null,
    last: last.data ? String((last.data as { day: string }).day) : null,
    days: count.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// payback ledger (insert-only)
// ---------------------------------------------------------------------------

export type StoredPaybackEntry = PaybackEntry & { basis: Record<string, unknown>; createdAt: string };

export async function paybackEntries(): Promise<StoredPaybackEntry[]> {
  if (!isSupabaseServiceConfigured) return [];
  const db = admin();
  // Paged on the unique entry_key (stable order), never a single capped read.
  const rows = await pagedAll<Record<string, unknown>>(async (from, to) => {
    const { data, error } = await db
      .from("cultivera_payback_entries")
      .select("entry_key, entry_date, kind, amount_minor, note, basis, created_at")
      .order("entry_key", { ascending: true })
      .range(from, to);
    if (error) throw new Error(explainCvbError(error));
    return (data ?? []) as Record<string, unknown>[];
  });
  rows.sort(
    (a, b) =>
      String(a.entry_date).localeCompare(String(b.entry_date)) ||
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.entry_key).localeCompare(String(b.entry_key)),
  );
  return rows.map((r) => ({
    entryKey: String(r.entry_key),
    entryDate: String(r.entry_date),
    kind: String(r.kind) as PaybackKind,
    amountMinor: Number(r.amount_minor),
    note: String(r.note),
    basis: (r.basis && typeof r.basis === "object" ? r.basis : {}) as Record<string, unknown>,
    createdAt: String(r.created_at),
  }));
}

/** Insert one ledger row. A repeated entry_key returns "already" and changes nothing. */
export async function insertPaybackEntry(
  e: PaybackEntry & { basis: Record<string, unknown> },
  actorId: string | null,
): Promise<"inserted" | "already"> {
  const { error } = await admin().from("cultivera_payback_entries").insert({
    entry_key: e.entryKey,
    entry_date: e.entryDate,
    kind: e.kind,
    amount_minor: e.amountMinor,
    note: e.note,
    basis: e.basis,
    created_by: actorId,
  });
  if (!error) return "inserted";
  if (error.code === "23505") return "already";
  throw new Error(explainCvbError(error));
}
