/**
 * R74 S35 - everything the Batch Lookups console shows, read in a few
 * parallel, paged queries (never .limit(>=1000)): the pause switch, Gemini
 * batches, recent lookup jobs + their products (one pass feeds progress,
 * failures, activity and the cost ledger), and the products still waiting in
 * Needs review grouped into families for the smart-batch plan.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { geminiApiKey } from "@/lib/ai/provider";
import { readBatchControl } from "@/lib/ai/batch-control-server";
import { AI_BATCH_MAX_INFLIGHT_ENV, AI_LOOKUP_ENGINE_ENV, BATCH_MAX_FAMILIES, batchMaxInflight, lookupEngine, productFamilyKey } from "@/lib/ai/gemini-batch-core";
import { AI_BATCH_THINKING_LEVEL_ENV, batchThinkingLevel } from "@/lib/catalog/lookup-job-core";
import { createBackoffUntil, recentBatchEvents, type BatchEvent } from "@/lib/ai/batch-events-server";
import { BATCH_LOST_NOTE, BATCH_STOPPED_NOTE } from "@/lib/ai/gemini-batch-explain-core";
import { ALREADY_ANSWERED_NOTE, HANDLED_ITEM_STATUSES, pickRequeue } from "@/lib/ai/batch-requeue-core";
import { OPEN_CONTROL, addLedger, itemLedgerCents, isRateLimitFailure, measurePace, type BatchControl, type BatchRowLite, type LedgerRow, type Pace, type PlanManifest } from "@/lib/ai/batch-console-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const PAGE = 1000;
const MAX_PAGES = 30;
const DAYS = 120;

export type BatchRow = BatchRowLite & {
  id: string;
  name: string | null;
  model: string;
  error: string | null;
  updated_at: string;
  lease_until: string | null;
  // R74 S41 (0299): Google's own view, saved on every check.
  google_state?: string | null;
  batch_stats?: { total: number; succeeded: number; failed: number; pending: number } | null;
  last_polled_at?: string | null;
  poll_status?: number | null;
  poll_error?: string | null;
};
export type JobRow = { id: string; manifestId: string; label: string; vendor: string; status: string; total: number; queued: number; running: number; done: number; failed: number; canceled: number; paidCalls: number; createdAt: string; startedAt: string | null; finishedAt: string | null; paused: boolean };
export type FailRow = { itemId: string; jobId: string; draftId: string; label: string; vendor: string; error: string; at: string | null; rateLimited: boolean };
export type ActivityRow = { at: string; kind: "done" | "failed" | "canceled" | "batch"; text: string };

export type BatchConsole = {
  ok: boolean;
  error: string | null;
  control: BatchControl;
  engine: "live" | "batch";
  inflightCap: number;
  thinking: string;
  keySet: boolean;
  batches: BatchRow[];
  jobs: JobRow[];
  failures: FailRow[];
  rateFailures: number;
  activity: ActivityRow[];
  pace: Pace;
  plan: PlanManifest[];
  waiting: { lots: number; families: number; manifests: number; vendors: number; inQueue: number };
  ledgerVendor: LedgerRow[];
  ledgerJob: LedgerRow[];
  totals: { cents: number; batches: number; families: number; searches: number; promptTokens: number; outputTokens: number; answered: number; failed: number };
  lastTickAt: string | null;
  liveUsage30d: { calls: number; tokens: number };
  /** R74 S41: is migration 0299 (Mission Control) applied? */
  missionReady: boolean;
  /** Products set aside by a stop / a lost batch (wait for Re-run stopped). */
  held: number;
  events: BatchEvent[];
  backoff: { until: string | null; streak: number };
};

async function paged<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p += 1) {
    const { data, error } = await run(p * PAGE, p * PAGE + PAGE - 1);
    if (error) break;
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function manifestsById(admin: Admin, ids: string[]): Promise<Map<string, { label: string; vendor: string }>> {
  const m = new Map<string, { label: string; vendor: string }>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const res = await Promise.all(chunks.map((c) => admin.from("inbound_manifests").select("id, manifest_number, vendor_label").in("id", c)));
  for (const r of res) for (const x of (r.data as { id: string; manifest_number: string | null; vendor_label: string | null }[] | null) ?? []) m.set(x.id, { label: x.manifest_number || x.id.slice(0, 8), vendor: (x.vendor_label || "Unknown vendor").trim() });
  return m;
}

const EMPTY_PACE = measurePace([]);

export async function loadBatchConsole(): Promise<BatchConsole> {
  const control0 = { ...OPEN_CONTROL };
  const base: BatchConsole = {
    ok: false,
    error: null,
    control: control0,
    engine: lookupEngine(process.env[AI_LOOKUP_ENGINE_ENV]),
    inflightCap: batchMaxInflight(process.env[AI_BATCH_MAX_INFLIGHT_ENV]),
    thinking: batchThinkingLevel(process.env[AI_BATCH_THINKING_LEVEL_ENV]),
    keySet: Boolean(geminiApiKey()),
    batches: [],
    jobs: [],
    failures: [],
    rateFailures: 0,
    activity: [],
    pace: EMPTY_PACE,
    plan: [],
    waiting: { lots: 0, families: 0, manifests: 0, vendors: 0, inQueue: 0 },
    ledgerVendor: [],
    ledgerJob: [],
    totals: { cents: 0, batches: 0, families: 0, searches: 0, promptTokens: 0, outputTokens: 0, answered: 0, failed: 0 },
    lastTickAt: null,
    liveUsage30d: { calls: 0, tokens: 0 },
    missionReady: false,
    held: 0,
    events: [],
    backoff: { until: null, streak: 0 },
  };
  if (!isSupabaseServiceConfigured) return { ...base, error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const BATCH_COLS = "id, name, model, state, families, items, answered, failed, prompt_tokens, output_tokens, search_queries, cost_cents, error, lease_until, created_at, submitted_at, finished_at, ingested_at, updated_at";
    const [control, batchesRes1, jobsRes, drafts, usage, costProbe, ev, heldRes, backoff, handledAll] = await Promise.all([
      readBatchControl(admin),
      admin.from("ai_batches").select(`${BATCH_COLS}, google_state, batch_stats, last_polled_at, poll_status, poll_error`).order("created_at", { ascending: false }).limit(300),
      admin.from("lookup_jobs").select("id, manifest_id, status, total, done, created_at, started_at, finished_at").gte("created_at", since).order("created_at", { ascending: false }).limit(600),
      paged<{ id: string; manifest_id: string | null; name: string | null; brand_name: string | null; vendor_name: string | null; category: string | null }>((a, b) =>
        admin.from("catalog_product_drafts").select("id, manifest_id, name, brand_name, vendor_name, category").eq("status", "draft").not("manifest_id", "is", null).order("id").range(a, b),
      ),
      paged<{ total_tokens: number | null }>((a, b) => admin.from("ai_usage").select("total_tokens").like("feature", "inventory.product_lookup%").neq("feature", "inventory.product_lookup.batch").gte("created_at", since30).order("created_at").range(a, b)),
      // R74 S37: is 0296 (per-product cost) applied? Without it the ledger estimates.
      admin.from("lookup_job_items").select("cost_cents").limit(1),
      recentBatchEvents(admin, 80),
      admin.from("lookup_job_items").select("id", { count: "exact", head: true }).eq("status", "canceled").in("error", [BATCH_STOPPED_NOTE, BATCH_LOST_NOTE]),
      createBackoffUntil(admin),
      // R74 S45: answered / in-line products across ALL jobs (not only recent ones),
      // so the plan never offers a product the send-time planner will skip.
      paged<{ draft_id: string }>((a, b) => admin.from("lookup_job_items").select("draft_id").in("status", [...HANDLED_ITEM_STATUSES]).order("id").range(a, b)),
    ]);
    // Before 0299 the Google columns do not exist: read the old ones.
    const missionReady = !batchesRes1.error && ev.ok;
    const batchesRes = batchesRes1.error ? await admin.from("ai_batches").select(BATCH_COLS).order("created_at", { ascending: false }).limit(300) : batchesRes1;
    const hasCost = !costProbe.error;
    if (batchesRes.error && /ai_batches/.test(String(batchesRes.error.message))) return { ...base, control, error: "Migration 0295 (ai_batches) is not applied yet." };
    const batches = ((batchesRes.data as BatchRow[] | null) ?? []).map((b) => ({ ...b, cost_cents: Number(b.cost_cents ?? 0) }));
    const jobs0 = (jobsRes.data as { id: string; manifest_id: string; status: string; total: number; done: number; created_at: string; started_at: string | null; finished_at: string | null }[] | null) ?? [];
    const jobIds = jobs0.map((j) => j.id);

    // One pass over the products of recent jobs.
    type Item = { id: string; job_id: string; draft_id: string; status: string; ai_calls: number | null; error: string | null; finished_at: string | null; updated_at: string; cost_cents?: unknown };
    const items: Item[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < jobIds.length; i += 100) chunks.push(jobIds.slice(i, i + 100));
    const parts = await Promise.all(chunks.map((c) => paged<Item>((a, b) => admin.from("lookup_job_items").select(`id, job_id, draft_id, status, ai_calls, error, finished_at, updated_at${hasCost ? ", cost_cents" : ""}`).in("job_id", c).order("id").range(a, b))));
    for (const p of parts) items.push(...p);

    const manifestIds = [...new Set([...jobs0.map((j) => j.manifest_id), ...drafts.map((d) => d.manifest_id as string)])];
    const mans = await manifestsById(admin, manifestIds);
    const man = (id: string) => mans.get(id) ?? { label: id.slice(0, 8), vendor: "Unknown vendor" };

    // Jobs + per-job counts.
    const held = new Set(control.pausedJobIds);
    const byJob = new Map<string, JobRow>();
    for (const j of jobs0) {
      const m = man(j.manifest_id);
      byJob.set(j.id, { id: j.id, manifestId: j.manifest_id, label: m.label, vendor: m.vendor, status: j.status, total: j.total, queued: 0, running: 0, done: 0, failed: 0, canceled: 0, paidCalls: 0, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at, paused: held.has(j.id) });
    }
    const handled = new Set<string>(handledAll.map((r) => r.draft_id));
    const failures: FailRow[] = [];
    const activity: ActivityRow[] = [];
    const ledgerJob = new Map<string, LedgerRow>();
    const ledgerVendor = new Map<string, LedgerRow>();
    const pace = measurePace(batches);
    for (const it of items) {
      const j = byJob.get(it.job_id);
      if (!j) continue;
      const k = it.status as "queued" | "running" | "done" | "failed" | "canceled";
      if (k in j) j[k] += 1;
      j.paidCalls += it.ai_calls ?? 0;
      if (k === "done" || k === "queued" || k === "running") handled.add(it.draft_id);
      if (k === "failed") failures.push({ itemId: it.id, jobId: j.id, draftId: it.draft_id, label: j.label, vendor: j.vendor, error: it.error ?? "", at: it.finished_at ?? it.updated_at, rateLimited: isRateLimitFailure(it.error) });
      if ((k === "done" || k === "failed" || k === "canceled") && it.finished_at) activity.push({ at: it.finished_at, kind: k, text: `${j.vendor} \u00b7 ${j.label}${k === "failed" ? ` \u00b7 ${String(it.error ?? "").slice(0, 90)}` : ""}` });
      const cost = itemLedgerCents(it.cost_cents, it.ai_calls ?? 0, pace.centsPerFamily);
      const add = { items: 1, families: it.ai_calls ?? 0, answered: k === "done" ? 1 : 0, failed: k === "failed" ? 1 : 0, cents: cost.cents, measured: cost.measured };
      addLedger(ledgerJob, j.id, `${j.vendor} \u00b7 ${j.label}`, add);
      addLedger(ledgerVendor, j.vendor, j.vendor, add);
    }
    for (const b of batches) {
      for (const [at, t] of [[b.created_at, `Batch sent: ${b.families} products (${b.items} lots)`], [b.finished_at, `Batch ${b.state === "ingested" ? "finished" : b.state} at Gemini`], [b.ingested_at, `Batch filed: ${b.answered} answered, ${b.failed} failed, ${b.search_queries} searches, $${(Number(b.cost_cents) / 100).toFixed(2)}`]] as const) {
        if (at) activity.push({ at, kind: "batch", text: t });
      }
    }
    activity.sort((a, b) => (a.at < b.at ? 1 : -1));
    failures.sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));

    // Smart-batch plan: review products not already done / waiting, in families per manifest.
    const fam = new Map<string, { lots: number; keys: Set<string> }>();
    const vendors = new Set<string>();
    let lots = 0;
    const allKeys = new Set<string>();
    for (const d of drafts) {
      if (handled.has(d.id) || !d.manifest_id) continue;
      const f = fam.get(d.manifest_id) ?? { lots: 0, keys: new Set<string>() };
      const key = productFamilyKey({ brand: d.brand_name, vendor: d.vendor_name, productName: d.name, category: d.category });
      f.lots += 1;
      f.keys.add(key);
      allKeys.add(key);
      fam.set(d.manifest_id, f);
      lots += 1;
    }
    const plan: PlanManifest[] = [...fam.entries()]
      .map(([id, f]) => {
        const m = man(id);
        vendors.add(m.vendor);
        return { manifestId: id, vendor: m.vendor, label: m.label, lots: f.lots, families: f.keys.size };
      })
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.label.localeCompare(b.label));
    const inQueue = items.filter((i) => i.status === "queued" || i.status === "running").length;

    const totals = { ...base.totals };
    for (const b of batches) {
      totals.batches += 1;
      totals.cents += Number(b.cost_cents || 0);
      totals.families += b.families || 0;
      totals.searches += b.search_queries || 0;
      totals.promptTokens += b.prompt_tokens || 0;
      totals.outputTokens += b.output_tokens || 0;
      totals.answered += b.answered || 0;
      totals.failed += b.failed || 0;
    }
    const lastTickAt = [batches[0]?.updated_at, ...items.map((i) => i.updated_at)].filter(Boolean).sort().pop() ?? null;

    return {
      ...base,
      ok: true,
      control,
      batches,
      jobs: [...byJob.values()],
      failures: failures.slice(0, 200),
      rateFailures: failures.filter((f) => f.rateLimited).length,
      activity: activity.slice(0, 60),
      pace,
      plan,
      waiting: { lots, families: allKeys.size, manifests: plan.length, vendors: vendors.size, inQueue },
      ledgerVendor: [...ledgerVendor.values()].sort((a, b) => b.cents - a.cents),
      ledgerJob: [...ledgerJob.values()].sort((a, b) => b.cents - a.cents).slice(0, 60),
      totals,
      lastTickAt,
      liveUsage30d: { calls: usage.length, tokens: usage.reduce((s, u) => s + (u.total_tokens ?? 0), 0) },
      missionReady,
      held: heldRes.count ?? 0,
      events: ev.events,
      backoff: { until: backoff.until, streak: backoff.streak },
    };
  } catch (err) {
    console.error("[batch-console] load failed:", err);
    return { ...base, error: "The batch lookup data could not be read just now. Refresh to try again." };
  }
}

/** Families the engine still has to send (BATCH_MAX_FAMILIES each). */
export function batchesLeft(families: number): number {
  return Math.ceil(families / BATCH_MAX_FAMILIES);
}

/** R74 S41: every product a stop / lost batch set aside (paged ids). */
export async function stoppedItemIds(): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const rows = await paged<{ id: string }>((a, b) => admin.from("lookup_job_items").select("id").eq("status", "canceled").in("error", [BATCH_STOPPED_NOTE, BATCH_LOST_NOTE]).order("id").range(a, b));
  return rows.map((r) => r.id);
}

/** Re-run failed products: back to queued with a fresh try count; their finished jobs re-open. */
export async function requeueFailedItems(itemIds: readonly string[], fromStatus: "failed" | "canceled" = "failed"): Promise<{ items: number; jobs: number; reopened: number; skipped: number }> {
  const admin = createSupabaseAdminClient();
  const at = new Date().toISOString();
  // R74 S45: never resend a product another lookup already answered (or is
  // asking right now) - those are closed with a note instead. Saves credits.
  const rows: { id: string; draft_id: string }[] = [];
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data } = await admin.from("lookup_job_items").select("id, draft_id").in("id", itemIds.slice(i, i + 100)).eq("status", fromStatus);
    rows.push(...((data as { id: string; draft_id: string }[] | null) ?? []));
  }
  const busy = new Set<string>();
  const draftIds = [...new Set(rows.map((r) => r.draft_id))];
  for (let i = 0; i < draftIds.length; i += 100) {
    const { data } = await admin.from("lookup_job_items").select("draft_id").in("draft_id", draftIds.slice(i, i + 100)).in("status", [...HANDLED_ITEM_STATUSES]);
    for (const r of (data as { draft_id: string }[] | null) ?? []) busy.add(String(r.draft_id).toLowerCase());
  }
  const { keep, skipped } = pickRequeue(rows, busy);
  const drop = rows.map((r) => r.id).filter((id) => !keep.includes(id));
  for (let i = 0; i < drop.length; i += 100) {
    await admin.from("lookup_job_items").update({ status: "canceled", error: ALREADY_ANSWERED_NOTE, finished_at: at, updated_at: at }).in("id", drop.slice(i, i + 100)).eq("status", fromStatus);
  }
  let items = 0;
  const jobs = new Set<string>();
  for (let i = 0; i < keep.length; i += 100) {
    const { data } = await admin.from("lookup_job_items").update({ status: "queued", attempts: 0, error: null, batch_id: null, finished_at: null, updated_at: at }).in("id", keep.slice(i, i + 100)).eq("status", fromStatus).select("job_id");
    for (const r of (data as { job_id: string }[] | null) ?? []) {
      items += 1;
      jobs.add(r.job_id);
    }
  }
  // A manifest with another open lookup keeps this job closed (one active job
  // per manifest); its products are picked up when that one finishes.
  let reopened = 0;
  for (const id of jobs) {
    const { data } = await admin.from("lookup_jobs").update({ status: "queued", finished_at: null, lease_until: null, lease_token: null, updated_at: at }).eq("id", id).in("status", ["done", "canceled"]).select("id");
    reopened += ((data as unknown[] | null) ?? []).length;
  }
  return { items, jobs: jobs.size, reopened, skipped };
}
