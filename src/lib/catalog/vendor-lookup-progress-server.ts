/**
 * src/lib/catalog/vendor-lookup-progress-server.ts  (R74 S44)
 *
 * Reads every Cultivera onboarding row (all rebuilt manifests, every status
 * but dismissed) and every lookup_job_items row for them, then hands both to
 * the pure rollup (vendor-lookup-progress-core). Read-only. Paged reads only
 * (never .limit >= 1000); the jsonb bits are pulled as narrow paths so the
 * big snapshot text never crosses the wire.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadCultiveraVendors } from "@/lib/inventory/cultivera-vendor";
import { OPEN_BATCH_STATES } from "@/lib/ai/gemini-batch-explain-core";
import { vendorProgress, type ProgressDraft, type ProgressItem, type VendorProgress } from "@/lib/catalog/vendor-lookup-progress-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const CHUNK = 100;
const PAGE = 500;

const ITEM_COLS =
  "draft_id, job_id, status, error, finished_at, updated_at, outcome:result_json->>outcome, found:result_json->found, attached:result_json->attached, queued:result_json->queued, model:result_json->>model, asked:result_json->>asked, web:result_json->snapshot->usedWebSearch, srcs:result_json->snapshot->sources, sfound:result_json->snapshot->found";

type ItemRow = {
  draft_id: string;
  job_id: string;
  status: string;
  batch_id?: string | null;
  error: string | null;
  finished_at: string | null;
  updated_at: string | null;
  outcome: string | null;
  found: unknown;
  attached: unknown;
  queued: unknown;
  model: string | null;
  asked: string | null;
  web: unknown;
  srcs: unknown;
  sfound: unknown;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function readDrafts(admin: Admin, manifestVendor: Map<string, string>): Promise<ProgressDraft[]> {
  const ids = [...manifestVendor.keys()];
  const out: ProgressDraft[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select("id, name, manifest_id, brand_name, status")
        .in("manifest_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`onboarding rows: ${error.message}`);
      const rows = (data as { id: string; name: string | null; manifest_id: string; brand_name: string | null; status: string | null }[] | null) ?? [];
      for (const r of rows) {
        out.push({ id: r.id, name: r.name ?? "(no name)", manifestId: r.manifest_id, vendor: manifestVendor.get(r.manifest_id) ?? "Unknown vendor", brand: r.brand_name, status: r.status ?? "draft" });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

async function readItems(admin: Admin, draftIds: string[]): Promise<ProgressItem[]> {
  const out: ProgressItem[] = [];
  let withBatch = true;
  for (let i = 0; i < draftIds.length; i += CHUNK) {
    const chunk = draftIds.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const run = (cols: string) =>
        admin.from("lookup_job_items").select(cols).in("draft_id", chunk).order("id", { ascending: true }).range(from, from + PAGE - 1);
      let res = await run(withBatch ? `${ITEM_COLS}, batch_id` : ITEM_COLS);
      if (res.error && withBatch) {
        // Before migration 0295 there is no batch_id: read without it.
        withBatch = false;
        res = await run(ITEM_COLS);
      }
      if (res.error) throw new Error(`lookup history: ${res.error.message}`);
      const rows = (res.data as unknown as ItemRow[] | null) ?? [];
      for (const r of rows) {
        out.push({
          draftId: r.draft_id,
          status: r.status,
          batchId: r.batch_id ?? null,
          error: r.error,
          finishedAt: r.finished_at,
          updatedAt: r.updated_at,
          outcome: r.outcome,
          found: num(r.found),
          attached: num(r.attached),
          queued: num(r.queued),
          model: r.model,
          asked: r.asked,
          usedWebSearch: typeof r.web === "boolean" ? r.web : null,
          sources: Array.isArray(r.srcs) ? r.srcs.length : null,
          answerFound: typeof r.sfound === "boolean" ? r.sfound : null,
          jobId: r.job_id,
        } as ProgressItem & { jobId: string });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/**
 * R74 S49: an open row (queued / running) is an ORPHAN when nothing will ever
 * send it: its lookup job is closed, or it sits in a Gemini batch that is no
 * longer open. Those show red "Stuck" (not blue) and Unstick & re-ask frees
 * them. Bounded reads; on any error nothing is marked (the old view).
 */
async function markOrphans(admin: Admin, items: (ProgressItem & { jobId?: string })[]): Promise<void> {
  const open = items.filter((i) => i.status === "queued" || i.status === "running");
  if (open.length === 0) return;
  const jobIds = [...new Set(open.map((i) => i.jobId).filter((x): x is string => !!x))];
  const openJobs = new Set<string>();
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data, error } = await admin.from("lookup_jobs").select("id").in("id", jobIds.slice(i, i + CHUNK)).in("status", ["queued", "running"]);
    if (error) return;
    for (const r of (data as { id: string }[] | null) ?? []) openJobs.add(r.id);
  }
  const { data: b, error: be } = await admin.from("ai_batches").select("id").in("state", [...OPEN_BATCH_STATES]).limit(300);
  const openBatches = be ? null : new Set(((b as { id: string }[] | null) ?? []).map((r) => r.id));
  for (const it of open) {
    if (it.jobId && !openJobs.has(it.jobId)) it.orphan = true;
    else if (openBatches && it.status === "running" && it.batchId && !openBatches.has(it.batchId)) it.orphan = true;
  }
}

export type VendorProgressLoad = { ok: true; vendors: VendorProgress[] } | { ok: false; error: string };

/** Every Cultivera vendor with every product's lookup story. */
export async function loadVendorLookupProgress(): Promise<VendorProgressLoad> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const load = await loadCultiveraVendors();
  if (!load.ok) return { ok: false, error: load.error };
  const manifestVendor = new Map<string, string>();
  for (const r of load.rows) manifestVendor.set(r.id, r.vendor);
  try {
    const admin = createSupabaseAdminClient();
    const drafts = await readDrafts(admin, manifestVendor);
    const items = await readItems(admin, drafts.map((d) => d.id));
    await markOrphans(admin, items as (ProgressItem & { jobId?: string })[]);
    return { ok: true, vendors: vendorProgress(drafts, items) };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}
