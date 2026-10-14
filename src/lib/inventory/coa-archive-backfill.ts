/**
 * src/lib/inventory/coa-archive-backfill.ts   (R50 S13)
 *
 * The I/O half of "Save a copy of every lab certificate". Walks lab_results
 * that have a `coa_url` (the link from the vendor's transfer file) and NO
 * stored copy yet, in id order (keyset `id > cursor`), a few at a time;
 * downloads each PDF (https only, never a private host - checked again on
 * every redirect), refuses anything that is not really a PDF, uploads it to
 * the private `coa` bucket at the SAME path delivery intake uses, and records
 * the copy with a compare-and-set on an EMPTY coa_storage_path. Stops before
 * the time budget and returns the checkpoint. One audit row per click. Never
 * throws to the caller.
 *
 * Writes: storage object coa/<labId>/<name>.pdf, and on that lab_results row
 * ONLY coa_storage_path / coa_file_bytes / coa_archived_at (when empty). Never
 * a potency, a lot, stock, status, cost, CCRS field, price, menu card, draft
 * or accounting row.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import {
  COA_BACKFILL_AUDIT,
  COA_BACKFILL_BUDGET_MS,
  COA_BACKFILL_FETCH_TIMEOUT_MS,
  COA_BACKFILL_MAX_BYTES,
  COA_BACKFILL_PAGE,
  COA_BACKFILL_PARALLEL,
  COA_BUCKET,
  addCoaOutcome,
  checkCoaUrl,
  coaCanStartNext,
  coaStoragePath,
  emptyCoaTotals,
  looksLikePdf,
  parseCoaCursor,
  type CoaBackfillRun,
  type CoaOutcome,
} from "@/lib/inventory/coa-archive-backfill-core";
import { planCoaPreview, type CoaPreviewRow, type CoaPreviewRun } from "@/lib/inventory/bulk-preview-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

type LabRow = { id: string; labtest_external_identifier: string | null; coa_url: string | null };

export type CoaBackfillOptions = {
  admin?: Admin;
  now?: () => number;
  budgetMs?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
};

const MAX_REDIRECTS = 3;

type Fetched = { outcome: Exclude<CoaOutcome, "archived" | "upload-failed" | "changed">; detail: string | null } | { bytes: Uint8Array };

/** Download one certificate. Redirects are followed by hand so every hop passes the same URL check. */
async function download(rawUrl: string | null, fetchImpl: typeof fetch): Promise<Fetched> {
  let check = checkCoaUrl(rawUrl);
  if (!check.ok) return { outcome: "bad-link", detail: check.reason };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COA_BACKFILL_FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(check.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "application/pdf,*/*" },
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { outcome: "fetch-failed", detail: `redirect without a target` };
        let nextUrl: string;
        try {
          nextUrl = new URL(loc, check.url).toString();
        } catch {
          return { outcome: "bad-link", detail: "malformed redirect" };
        }
        check = checkCoaUrl(nextUrl);
        if (!check.ok) return { outcome: "bad-link", detail: `redirect ${check.reason}` };
        continue;
      }
      if (!res.ok) return { outcome: "fetch-failed", detail: `HTTP ${res.status}` };
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > COA_BACKFILL_MAX_BYTES) return { outcome: "too-big", detail: null };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > COA_BACKFILL_MAX_BYTES) return { outcome: "too-big", detail: null };
      if (!looksLikePdf(bytes)) return { outcome: "not-pdf", detail: (res.headers.get("content-type") ?? "").slice(0, 40) || null };
      return { bytes };
    } catch (err) {
      return { outcome: "fetch-failed", detail: controller.signal.aborted ? "timed out" : short(err) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { outcome: "fetch-failed", detail: "too many redirects" };
}

async function archiveOne(
  admin: Admin,
  lab: LabRow,
  fetchImpl: typeof fetch,
): Promise<{ outcome: CoaOutcome; detail: string | null; bytes: number }> {
  const got = await download(lab.coa_url, fetchImpl);
  if (!("bytes" in got)) return { ...got, bytes: 0 };
  const path = coaStoragePath(lab.id, lab.labtest_external_identifier);
  try {
    const { error } = await admin.storage
      .from(COA_BUCKET)
      .upload(path, Buffer.from(got.bytes), { contentType: "application/pdf", upsert: true });
    if (error) return { outcome: "upload-failed", detail: short(error), bytes: 0 };
  } catch (err) {
    return { outcome: "upload-failed", detail: short(err), bytes: 0 };
  }
  // Compare-and-set: only a row that still has no stored copy is written.
  const { data, error } = await admin
    .from("lab_results")
    .update({ coa_storage_path: path, coa_file_bytes: got.bytes.byteLength, coa_archived_at: new Date().toISOString() })
    .eq("id", lab.id)
    .is("coa_storage_path", null)
    .select("id");
  if (error) return { outcome: "upload-failed", detail: `saved, but not recorded (${short(error)})`, bytes: 0 };
  if (!data || (data as unknown[]).length === 0) return { outcome: "changed", detail: null, bytes: 0 };
  return { outcome: "archived", detail: null, bytes: got.bytes.byteLength };
}

export async function runCoaArchiveBackfill(cursorIn: unknown, actorId: string | null, opts: CoaBackfillOptions = {}): Promise<CoaBackfillRun> {
  let totals = emptyCoaTotals();
  const cursor = parseCoaCursor(cursorIn);
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: false, error: "the database is not configured", next: cursor, totals };
  const admin = opts.admin ?? createSupabaseAdminClient();
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? COA_BACKFILL_BUDGET_MS;
  const pageSize = opts.pageSize ?? COA_BACKFILL_PAGE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const t0 = now();
  let last = cursor;

  const finish = async (run: CoaBackfillRun): Promise<CoaBackfillRun> => {
    try {
      await recordAudit({
        actorId,
        action: COA_BACKFILL_AUDIT,
        entityType: "lab_result",
        entityId: null,
        after: {
          from: cursor,
          next: run.next,
          done: run.ok ? run.done : false,
          error: run.ok ? null : run.error,
          checked: run.totals.checked,
          bytes: run.totals.bytes,
          ...run.totals.outcomes,
        },
      });
    } catch (err) {
      console.error("[coa-backfill] audit failed:", err);
    }
    return run;
  };

  for (;;) {
    if (!coaCanStartNext(now() - t0, budget)) return finish({ ok: true, done: false, next: last, totals, elapsedMs: now() - t0 });
    let q = admin
      .from("lab_results")
      .select("id, labtest_external_identifier, coa_url")
      .not("coa_url", "is", null)
      .is("coa_storage_path", null);
    if (last) q = q.gt("id", last);
    const { data, error } = await q.order("id", { ascending: true }).limit(pageSize);
    if (error) return finish({ ok: false, error: `the lab results could not be read (${short(error)})`, next: last, totals });
    const rows = (data as LabRow[] | null) ?? [];
    for (let i = 0; i < rows.length; i += COA_BACKFILL_PARALLEL) {
      if (!coaCanStartNext(now() - t0, budget)) return finish({ ok: true, done: false, next: last, totals, elapsedMs: now() - t0 });
      const batch = rows.slice(i, i + COA_BACKFILL_PARALLEL);
      const results = await Promise.all(
        batch.map((lab) =>
          archiveOne(admin, lab, fetchImpl).catch((reason: unknown) => ({ outcome: "fetch-failed" as CoaOutcome, detail: short(reason), bytes: 0 })),
        ),
      );
      batch.forEach((lab, k) => {
        const r = results[k];
        totals = addCoaOutcome(totals, lab.labtest_external_identifier || lab.id.slice(0, 8), r.outcome, r.detail, r.bytes);
      });
      last = batch[batch.length - 1].id.toLowerCase();
    }
    if (rows.length < pageSize) return finish({ ok: true, done: true, next: null, totals, elapsedMs: now() - t0 });
  }
}

/** R50 A3: rows read for a preview at most (a keyset walk; the real run pages the same way). */
export const COA_PREVIEW_MAX = 20_000;
const COA_PREVIEW_PAGE = 1000;

/**
 * R50 A3 - "Preview first": the SAME candidate query the real run walks
 * (coa_url set, no stored copy, id order) and the SAME URL check, read-only.
 * Nothing is downloaded, uploaded, recorded or audited.
 */
export async function previewCoaArchiveBackfill(opts: { admin?: Admin; max?: number; pageSize?: number } = {}): Promise<CoaPreviewRun> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: false, error: "the database is not configured" };
  const admin = opts.admin ?? createSupabaseAdminClient();
  const max = opts.max ?? COA_PREVIEW_MAX;
  const pageSize = opts.pageSize ?? COA_PREVIEW_PAGE;
  const rows: CoaPreviewRow[] = [];
  let last: string | null = null;
  for (;;) {
    let q = admin.from("lab_results").select("id, coa_url").not("coa_url", "is", null).is("coa_storage_path", null);
    if (last) q = q.gt("id", last);
    const { data, error } = await q.order("id", { ascending: true }).limit(pageSize);
    if (error) return { ok: false, error: `the lab results could not be read (${short(error)})` };
    const page = (data as CoaPreviewRow[] | null) ?? [];
    for (const r of page) {
      if (rows.length >= max) return { ok: true, preview: planCoaPreview(rows), capped: true };
      rows.push(r);
    }
    if (page.length < pageSize) return { ok: true, preview: planCoaPreview(rows), capped: false };
    last = page[page.length - 1].id;
  }
}
