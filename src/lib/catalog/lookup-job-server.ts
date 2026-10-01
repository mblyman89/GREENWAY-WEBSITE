/**
 * src/lib/catalog/lookup-job-server.ts   (bible SLICE S13, Phase 2, Ring 1)
 *
 * The I/O half of "Look up all N products on this manifest". Every decision
 * is in lookup-job-core.ts (pure, self-tested). This file only reads, writes
 * and calls the SAME functions the per-row AI Lookup + Save selected use:
 *
 *   recallForDraft (S09 KB-first) -> shouldSkipGemini -> lookupProduct (one
 *   paid web lookup, only for the gaps) -> attachProductFacts (S07 write door
 *   under the S10 attach policy: 90%+ attaches in the act ring, everything
 *   else becomes a pending suggestion for a person; bible rule 3.1).
 *
 * CONCURRENCY (AGENTS rule 12: a tick may arrive twice, overlap the next, or
 * not arrive at all):
 *   - enqueue: the partial unique index lookup_jobs_one_active_per_manifest
 *     is the lock. A losing insert (23505) re-reads and returns the winner.
 *   - a run takes the job LEASE with a compare-and-swap on lease_token (null
 *     or the token it read) AND lease_until (null or expired). A read-then-act
 *     check is not a lock; the conditional update is.
 *   - each item is CLAIMED with a compare-and-swap on (status='queued',
 *     attempts=<read>). Zero rows updated = someone else has it; skip.
 *   - an item still 'running' when a new lease is taken was left by a killed
 *     run: requeued once, then failed with a plain reason (orphanDecision).
 *   - every write after the claim is guarded by the lease token, so a run
 *     whose lease was taken over stops writing.
 *
 * FLAG: MANIFEST_BATCH_LOOKUP (default on). Off -> the cron returns before any
 * database read, and the page hides the button and the panel.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { lookupProduct, isAiConfigured } from "@/lib/inventory/product-lookup-ai";
import { postProcessLookup } from "@/lib/inventory/product-lookup-core";
import { fieldConfidenceForSave } from "@/lib/inventory/lookup-facts-core";
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { intakeDisplayName } from "@/lib/pos/intake-mastering-core";
import { attachProductFacts } from "@/lib/catalog/attach-facts";
import { factConfidenceFromFacts } from "@/lib/catalog/attach-plan-core";
import { attachFactsV2Enabled } from "@/lib/catalog/fact-attach-policy-server";
import { recallForDraft } from "@/lib/catalog/fact-memory";
import {
  KB_FIRST_ONBOARDING_ENV,
  MEMORY_MODEL_LABEL,
  alreadyKnownPromptBlock,
  kbFirstOnboardingEnabled,
  memoryRawLookup,
  shouldSkipGemini,
} from "@/lib/catalog/fact-memory-core";
import {
  DRAFT_GONE_COPY,
  LEFT_REVIEW_COPY,
  LOOKUP_JOBS_TABLE,
  LOOKUP_JOB_ITEMS_TABLE,
  LOOKUP_MAX_JOB_ITEMS,
  MANIFEST_BATCH_LOOKUP_ENV,
  ORPHAN_FAIL_COPY,
  aiCallsOf,
  canStartItem,
  classifyItem,
  isItemStatus,
  isJobStatus,
  isMissingLookupJobsTable,
  isNoSpendError,
  isUuid,
  itemErrorText,
  leaseIsFree,
  leaseUntilIso,
  manifestBatchLookupEnabled,
  orphanDecision,
  parseItemResult,
  planEnqueue,
  stopsWholeJob,
  summarizeJob,
  type ItemResult,
  type JobItemView,
  type JobStatus,
  type JobSummary,
} from "./lookup-job-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Vercel env: MANIFEST_BATCH_LOOKUP (unset = on). */
export function lookupJobsOn(): boolean {
  return manifestBatchLookupEnabled(process.env[MANIFEST_BATCH_LOOKUP_ENV]);
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export type EnqueueResult =
  | { ok: true; kind: "created"; jobId: string; total: number; skippedDone: number; truncated: number }
  | { ok: true; kind: "exists"; jobId: string }
  | { ok: false; code: "nothing" | "migration" | "invalid" | "db"; message: string };

/** Draft ids for the manifest that are still in Needs review (status 'draft'), oldest first. */
async function reviewDraftIds(admin: Admin, manifestId: string): Promise<string[] | null> {
  const ids: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await admin
      .from("catalog_product_drafts")
      .select("id")
      .eq("manifest_id", manifestId)
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error("[lookup-jobs] review drafts read failed:", error.message);
      return null;
    }
    const rows = (data as { id: string }[] | null) ?? [];
    for (const r of rows) ids.push(r.id);
    if (rows.length < page) return ids;
  }
}

async function activeJobId(admin: Admin, manifestId: string): Promise<{ id: string | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await admin
    .from(LOOKUP_JOBS_TABLE)
    .select("id")
    .eq("manifest_id", manifestId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (error) return { id: null, error };
  const rows = (data as { id: string }[] | null) ?? [];
  return { id: rows[0]?.id ?? null, error: null };
}

/** Drafts an earlier batch of THIS manifest already looked up (item status 'done'). */
async function alreadyDoneDraftIds(admin: Admin, manifestId: string): Promise<string[] | null> {
  const { data: jobs, error } = await admin.from(LOOKUP_JOBS_TABLE).select("id").eq("manifest_id", manifestId);
  if (error) return null;
  const jobIds = ((jobs as { id: string }[] | null) ?? []).map((j) => j.id);
  if (jobIds.length === 0) return [];
  const out: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error: e2 } = await admin
      .from(LOOKUP_JOB_ITEMS_TABLE)
      .select("draft_id")
      .in("job_id", jobIds)
      .eq("status", "done")
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (e2) return null;
    const rows = (data as { draft_id: string }[] | null) ?? [];
    for (const r of rows) out.push(r.draft_id);
    if (rows.length < page) return out;
  }
}

/**
 * "Look up all N products on this manifest". Idempotent: an active job is
 * returned, never doubled, and drafts an earlier batch already looked up are
 * skipped. Never throws.
 */
export async function enqueueManifestLookup(
  manifestId: string,
  actor: { userId: string | null; email: string | null },
): Promise<EnqueueResult> {
  if (!isUuid(manifestId)) return { ok: false, code: "invalid", message: "That delivery link is not valid. Pick the delivery again." };
  if (!isSupabaseServiceConfigured) return { ok: false, code: "db", message: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const active = await activeJobId(admin, manifestId);
    if (active.error) {
      if (isMissingLookupJobsTable(active.error)) return { ok: false, code: "migration", message: "" };
      return { ok: false, code: "db", message: "The batch lookup list could not be read just now. Try again." };
    }
    if (active.id) return { ok: true, kind: "exists", jobId: active.id };

    const [review, done] = await Promise.all([reviewDraftIds(admin, manifestId), alreadyDoneDraftIds(admin, manifestId)]);
    if (review === null || done === null) {
      return { ok: false, code: "db", message: "The products on this delivery could not be read just now. Try again." };
    }
    const plan = planEnqueue({ reviewDraftIds: review, alreadyDoneDraftIds: done, activeJobId: null });
    if (plan.kind === "nothing") return { ok: false, code: "nothing", message: plan.reason };
    if (plan.kind === "exists") return { ok: true, kind: "exists", jobId: plan.jobId };

    const ins = await admin
      .from(LOOKUP_JOBS_TABLE)
      .insert({ manifest_id: manifestId, status: "queued", total: plan.total, done: 0, created_by: actor.userId })
      .select("id")
      .single();
    if (ins.error) {
      // 23505 = the partial unique index: another press won the race. Return
      // the winner; never a second job.
      if (String(ins.error.code ?? "") === "23505") {
        const again = await activeJobId(admin, manifestId);
        if (again.id) return { ok: true, kind: "exists", jobId: again.id };
      }
      if (isMissingLookupJobsTable(ins.error)) return { ok: false, code: "migration", message: "" };
      return { ok: false, code: "db", message: "The batch lookup could not be started just now. Try again." };
    }
    const jobId = (ins.data as { id: string }).id;
    const rows = plan.draftIds.map((draftId, position) => ({ job_id: jobId, draft_id: draftId, position, status: "queued" }));
    const items = await admin.from(LOOKUP_JOB_ITEMS_TABLE).insert(rows);
    if (items.error) {
      // Never leave an empty active job blocking the button: cancel it.
      await admin.from(LOOKUP_JOBS_TABLE).update({ status: "canceled", finished_at: new Date().toISOString() }).eq("id", jobId);
      return { ok: false, code: "db", message: "The batch lookup could not be started just now. Try again." };
    }
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "catalog_draft.batch_lookup_enqueued",
      entityType: "inbound_manifests",
      entityId: manifestId,
      after: { jobId, total: plan.total, skippedDone: plan.skippedDone, truncated: plan.truncated },
    });
    return { ok: true, kind: "created", jobId, total: plan.total, skippedDone: plan.skippedDone, truncated: plan.truncated };
  } catch (err) {
    console.error("[lookup-jobs] enqueue failed:", err);
    return { ok: false, code: "db", message: "The batch lookup could not be started just now. Try again." };
  }
}

/** Stop a running batch: queued items become 'canceled'; the one in flight finishes. */
export async function cancelManifestLookup(
  jobId: string,
  actor: { userId: string | null; email: string | null },
): Promise<{ ok: boolean; message: string }> {
  if (!isUuid(jobId)) return { ok: false, message: "That batch lookup is not valid." };
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const j = await admin
      .from(LOOKUP_JOBS_TABLE)
      .update({ status: "canceled", finished_at: now, updated_at: now })
      .eq("id", jobId)
      .in("status", ["queued", "running"])
      .select("id, manifest_id");
    if (j.error) return { ok: false, message: "The batch lookup could not be stopped just now. Try again." };
    const changed = ((j.data as { id: string; manifest_id: string }[] | null) ?? [])[0];
    if (!changed) return { ok: true, message: "That batch lookup had already finished." };
    await admin
      .from(LOOKUP_JOB_ITEMS_TABLE)
      .update({ status: "canceled", finished_at: now, updated_at: now })
      .eq("job_id", jobId)
      .eq("status", "queued");
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "catalog_draft.batch_lookup_canceled",
      entityType: "inbound_manifests",
      entityId: changed.manifest_id,
      after: { jobId },
    });
    return { ok: true, message: "Batch lookup stopped." };
  } catch (err) {
    console.error("[lookup-jobs] cancel failed:", err);
    return { ok: false, message: "The batch lookup could not be stopped just now. Try again." };
  }
}

// ─── Page read ───────────────────────────────────────────────────────────────

export interface ManifestLookupView {
  jobId: string;
  status: JobStatus;
  summary: JobSummary;
  /** draft id (lower case) -> that row's item. */
  items: Map<string, JobItemView>;
  /** The web lookup model, from the first item that recorded one. */
  model: string | null;
  createdAt: string | null;
  finishedAt: string | null;
}

export type ManifestLookupState =
  | { state: "off" }
  | { state: "migration" }
  | { state: "error" }
  | { state: "none"; doneDraftIds: Set<string> }
  | { state: "job"; job: ManifestLookupView; doneDraftIds: Set<string> };

async function readItems(admin: Admin, jobId: string): Promise<JobItemView[] | null> {
  const out: JobItemView[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await admin
      .from(LOOKUP_JOB_ITEMS_TABLE)
      .select("draft_id, status, result_json, error, ai_calls, position")
      .eq("job_id", jobId)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) return null;
    const rows = (data as { draft_id: string; status: unknown; result_json: unknown; error: string | null; ai_calls: unknown }[] | null) ?? [];
    for (const r of rows) {
      if (!isItemStatus(r.status)) continue;
      out.push({ draftId: r.draft_id, status: r.status, result: parseItemResult(r.result_json), error: r.error, aiCalls: aiCallsOf(r.ai_calls) });
    }
    if (rows.length < page) return out;
  }
}

/** The newest job for a manifest (active or finished), for the page. Never throws. */
export async function loadManifestLookup(manifestId: string): Promise<ManifestLookupState> {
  if (!lookupJobsOn()) return { state: "off" };
  if (!isUuid(manifestId) || !isSupabaseServiceConfigured) return { state: "error" };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(LOOKUP_JOBS_TABLE)
      .select("id, status, created_at, finished_at")
      .eq("manifest_id", manifestId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return isMissingLookupJobsTable(error) ? { state: "migration" } : { state: "error" };
    const done = await alreadyDoneDraftIds(admin, manifestId);
    const doneDraftIds = new Set((done ?? []).map((d) => d.toLowerCase()));
    const row = ((data as { id: string; status: unknown; created_at: string | null; finished_at: string | null }[] | null) ?? [])[0];
    if (!row || !isJobStatus(row.status)) return { state: "none", doneDraftIds };
    const items = await readItems(admin, row.id);
    if (items === null) return { state: "error" };
    const byDraft = new Map<string, JobItemView>();
    for (const it of items) byDraft.set(it.draftId.toLowerCase(), it);
    const model = items.find((i) => i.result?.model && i.result.model !== MEMORY_MODEL_LABEL)?.result?.model ?? null;
    return {
      state: "job",
      doneDraftIds,
      job: { jobId: row.id, status: row.status, summary: summarizeJob(items), items: byDraft, model, createdAt: row.created_at, finishedAt: row.finished_at },
    };
  } catch (err) {
    console.error("[lookup-jobs] page read failed:", err);
    return { state: "error" };
  }
}

// ─── The tick ────────────────────────────────────────────────────────────────

export interface TickResult {
  ok: boolean;
  /** Why nothing ran, when nothing ran. */
  skipped?: "flag_off" | "not_configured" | "ai_off" | "attach_v2_off" | "migration" | "no_job" | "leased";
  jobId?: string;
  started: number;
  done: number;
  failed: number;
  requeued: number;
  aiCalls: number;
  finished: boolean;
  error?: string;
}

const EMPTY: Omit<TickResult, "ok"> = { started: 0, done: 0, failed: 0, requeued: 0, aiCalls: 0, finished: false };

/** One product, end to end. Returns what to store, or throws (the caller records the failure). */
export interface ItemRunOutcome {
  result: ItemResult;
  aiCalls: number;
}

interface DraftForLookup {
  id: string;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  pos_product_key: string | null;
  inventory_type: string | null;
  category: string | null;
  strain_name: string | null;
  chosen_website_category?: string | null;
  status: string | null;
}

/**
 * The query the row panel would prefill (AiLookupPanel: [productName,
 * vendorOrBrand]), built from the server's own read of the draft.
 */
export async function lookupQueryForDraft(d: DraftForLookup): Promise<{ query: string; productName: string; vendorOrBrand: string }> {
  const resolution = await resolveWebsiteCategoryForLot({
    posProductKey: d.pos_product_key,
    productName: d.name ?? "",
    inventoryType: d.inventory_type,
    category: d.category,
  });
  const displayCategory = d.chosen_website_category ?? resolution?.websiteCategory ?? null;
  const built = displayCategory
    ? intakeDisplayName({
        name: d.name || "",
        product_name: d.name || null,
        brand_name: d.brand_name ?? "",
        vendor_name: d.vendor_name,
        category: displayCategory,
        strain_name: d.strain_name,
      })
    : null;
  const productName = built ?? (d.name || "");
  const vendorOrBrand = [d.brand_name, d.vendor_name].filter(Boolean).join(" ") || "";
  return { query: [productName, vendorOrBrand].filter(Boolean).join(" ").trim(), productName, vendorOrBrand };
}

/** Thrown when a product left Needs review before its turn (not an error; recorded as canceled). */
class SkipItem extends Error {
  constructor(readonly copy: string) {
    super(copy);
    this.name = "SkipItem";
  }
}

/**
 * Look one product up the same way the row panel + Save selected does. A
 * thrown error carries `aiCalls` when a paid request may already have gone
 * out, so the cost line never under-counts.
 */
export async function runOneItem(
  admin: Admin,
  draftId: string,
  actor: { userId: string | null; email: string | null },
): Promise<ItemRunOutcome> {
  const { data, error } = await admin
    .from("catalog_product_drafts")
    .select("id, name, brand_name, vendor_name, pos_product_key, inventory_type, category, strain_name, chosen_website_category, status")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error("The product could not be read just now.");
  const d = data as DraftForLookup | null;
  if (!d) throw new SkipItem(DRAFT_GONE_COPY);
  if (d.status !== "draft") throw new SkipItem(LEFT_REVIEW_COPY);

  const banned = await loadBannedPhrases();
  const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);
  const memory = kbFirst ? await recallForDraft(draftId) : null;
  const skipWeb = shouldSkipGemini({ enabled: kbFirst, refresh: false, memory });

  let aiCalls = 0;
  let outcome: Awaited<ReturnType<typeof lookupProduct>> | null = null;
  let safe;
  let model: string;
  if (skipWeb && memory) {
    safe = postProcessLookup(memoryRawLookup(memory), banned);
    model = MEMORY_MODEL_LABEL;
  } else {
    const q = await lookupQueryForDraft(d);
    try {
      outcome = await lookupProduct({
        query: q.query,
        productName: q.productName,
        vendorOrBrand: q.vendorOrBrand,
        extraBanned: banned,
        context: { entityType: "catalog_drafts", entityId: draftId, actorId: actor.userId, actorEmail: actor.email },
        alreadyKnown: alreadyKnownPromptBlock(memory),
      });
    } catch (err) {
      // Budget / not-configured are refused BEFORE any request (provider.ts).
      // Anything else (a timeout included) may have been paid for.
      (err as { aiCalls?: number }).aiCalls = isNoSpendError(err) ? 0 : 1;
      throw err;
    }
    aiCalls = 1;
    safe = outcome.result;
    model = outcome.model;
  }

  const res = await attachProductFacts({
    context: { kind: "draft", draftId },
    safe,
    sources: outcome ? outcome.sources : [],
    factConfidence: outcome ? factConfidenceFromFacts(outcome.facts) : {},
    suggestionConfidence: outcome ? (fieldConfidenceForSave(outcome.facts) as Record<string, unknown>) : {},
    suggestionSource: "model:onboarding-lookup",
    actor,
  });
  if (!res.ok) {
    const e = new Error(res.error) as Error & { aiCalls?: number };
    e.aiCalls = aiCalls;
    throw e;
  }
  const attached = res.receipt.attached.length;
  const queued = res.receipt.queued.length;
  return {
    aiCalls,
    result: {
      outcome: classifyItem({ skippedWeb: Boolean(skipWeb && memory), found: safe.found || safe.hasAnyFindings, attached, queued }),
      attached,
      queued,
      sentence: res.sentence,
      model,
    },
  };
}

type ItemRow = { id: string; draft_id: string; status: string; attempts: number | null };

/**
 * One cron tick. Picks the oldest open job, takes its lease by CAS, sweeps
 * orphans, then works items one at a time inside the time budget. Never
 * throws. `deps` exists for tests (fake clock, fake item runner).
 */
export async function runLookupJobsTick(deps: {
  now?: () => number;
  runItem?: typeof runOneItem;
  admin?: Admin;
  token?: string;
} = {}): Promise<TickResult> {
  if (!lookupJobsOn()) return { ok: true, skipped: "flag_off", ...EMPTY };
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", ...EMPTY };
  if (!isAiConfigured && !deps.runItem) return { ok: true, skipped: "ai_off", ...EMPTY };
  if (!attachFactsV2Enabled()) return { ok: true, skipped: "attach_v2_off", ...EMPTY };
  const now = deps.now ?? (() => Date.now());
  const runItem = deps.runItem ?? runOneItem;
  const t0 = now();
  const out: TickResult = { ok: true, ...EMPTY };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();

    // 1. The oldest open job.
    const { data: jobs, error: jErr } = await admin
      .from(LOOKUP_JOBS_TABLE)
      .select("id, manifest_id, status, created_by, lease_until, lease_token")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (jErr) {
      if (isMissingLookupJobsTable(jErr)) return { ok: true, skipped: "migration", ...EMPTY };
      return { ok: false, ...EMPTY, error: "The batch lookup list could not be read." };
    }
    const job = ((jobs as { id: string; manifest_id: string; status: string; created_by: string | null; lease_until: string | null; lease_token: string | null }[] | null) ?? [])[0];
    if (!job) return { ok: true, skipped: "no_job", ...EMPTY };
    out.jobId = job.id;
    if (!leaseIsFree(job.lease_until, t0)) return { ...out, skipped: "leased" };

    // 2. Take the lease (compare-and-swap on the token we read).
    const token = deps.token ?? crypto.randomUUID();
    const startedAt = new Date(t0).toISOString();
    let claim = admin
      .from(LOOKUP_JOBS_TABLE)
      .update({ status: "running", lease_until: leaseUntilIso(t0), lease_token: token, updated_at: startedAt, ...(job.status === "queued" ? { started_at: startedAt } : {}) })
      .eq("id", job.id)
      .in("status", ["queued", "running"]);
    claim = job.lease_token === null ? claim.is("lease_token", null) : claim.eq("lease_token", job.lease_token);
    const { data: won, error: cErr } = await claim.select("id");
    if (cErr) return { ...out, ok: false, error: "The batch lookup could not be claimed." };
    if (((won as { id: string }[] | null) ?? []).length !== 1) return { ...out, skipped: "leased" };

    // The actor is the person who pressed the button (audit + suggestions).
    let actor: { userId: string | null; email: string | null } = { userId: job.created_by, email: null };
    if (job.created_by) {
      const { data: staff } = await admin.from("staff_profiles").select("email").eq("id", job.created_by).maybeSingle();
      actor = { userId: job.created_by, email: ((staff as { email: string | null } | null) ?? null)?.email ?? null };
    }

    // 3. Orphans: 'running' items left by a killed run.
    const { data: orphans } = await admin
      .from(LOOKUP_JOB_ITEMS_TABLE)
      .select("id, draft_id, status, attempts")
      .eq("job_id", job.id)
      .eq("status", "running");
    for (const o of (orphans as ItemRow[] | null) ?? []) {
      const decision = orphanDecision(o.attempts);
      const patch =
        decision === "requeue"
          ? { status: "queued", updated_at: new Date(now()).toISOString() }
          : { status: "failed", error: ORPHAN_FAIL_COPY, finished_at: new Date(now()).toISOString(), updated_at: new Date(now()).toISOString() };
      const { data: moved } = await admin
        .from(LOOKUP_JOB_ITEMS_TABLE)
        .update(patch)
        .eq("id", o.id)
        .eq("status", "running")
        .eq("attempts", o.attempts ?? 0)
        .select("id");
      if (((moved as { id: string }[] | null) ?? []).length === 1) {
        if (decision === "requeue") out.requeued += 1;
        else out.failed += 1;
      }
    }

    // 4. Work items inside the budget.
    let stopAll: string | null = null;
    // A claim that keeps missing (another run, or a failing write) must not
    // spin until the time budget runs out.
    let claimMisses = 0;
    while (canStartItem({ elapsedMs: now() - t0, startedThisTick: out.started })) {
      const { data: next, error: nErr } = await admin
        .from(LOOKUP_JOB_ITEMS_TABLE)
        .select("id, draft_id, status, attempts")
        .eq("job_id", job.id)
        .eq("status", "queued")
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);
      if (nErr) break;
      const item = ((next as ItemRow[] | null) ?? [])[0];
      if (!item) break;
      const attempts = item.attempts ?? 0;
      const { data: got } = await admin
        .from(LOOKUP_JOB_ITEMS_TABLE)
        .update({ status: "running", attempts: attempts + 1, started_at: new Date(now()).toISOString(), updated_at: new Date(now()).toISOString() })
        .eq("id", item.id)
        .eq("status", "queued")
        .eq("attempts", attempts)
        .select("id");
      if (((got as { id: string }[] | null) ?? []).length !== 1) {
        claimMisses += 1; // someone else has it, or the write failed
        if (claimMisses >= 3) break;
        continue;
      }
      out.started += 1;

      let patch: Record<string, unknown>;
      try {
        const r = await runItem(admin, item.draft_id, actor);
        out.aiCalls += r.aiCalls;
        out.done += 1;
        patch = { status: "done", result_json: r.result, ai_calls: r.aiCalls, error: null };
      } catch (err) {
        if (err instanceof SkipItem) {
          patch = { status: "canceled", error: err.copy, ai_calls: 0 };
        } else {
          const calls = aiCallsOf((err as { aiCalls?: unknown } | null)?.aiCalls);
          out.aiCalls += calls;
          out.failed += 1;
          patch = { status: "failed", error: itemErrorText(err), ai_calls: calls };
          if (stopsWholeJob(err)) stopAll = itemErrorText(err);
        }
      }
      const finishedAt = new Date(now()).toISOString();
      // Lease-guarded: if another run took the job over, stop writing.
      const { data: stillOurs } = await admin
        .from(LOOKUP_JOBS_TABLE)
        .update({ lease_until: leaseUntilIso(now()), updated_at: finishedAt })
        .eq("id", job.id)
        .eq("lease_token", token)
        .select("id");
      if (((stillOurs as { id: string }[] | null) ?? []).length !== 1) return { ...out, error: "lease lost" };
      await admin
        .from(LOOKUP_JOB_ITEMS_TABLE)
        .update({ ...patch, finished_at: finishedAt, updated_at: finishedAt })
        .eq("id", item.id)
        .eq("status", "running");
      if (stopAll) break;
    }

    // 5. The budget cap stops the job: every later product would be refused the same way.
    if (stopAll) {
      const at = new Date(now()).toISOString();
      await admin
        .from(LOOKUP_JOB_ITEMS_TABLE)
        .update({ status: "failed", error: stopAll, finished_at: at, updated_at: at })
        .eq("job_id", job.id)
        .eq("status", "queued");
    }

    // 6. Progress + finish + release.
    const all = await readItems(admin, job.id);
    const summary = all ? summarizeJob(all) : null;
    const at = new Date(now()).toISOString();
    const finish = summary?.finished === true;
    // Release the lease (only if it is still ours) and record progress.
    await admin
      .from(LOOKUP_JOBS_TABLE)
      .update({
        ...(summary ? { done: summary.lookedUp + summary.canceled } : {}),
        lease_until: null,
        lease_token: null,
        updated_at: at,
      })
      .eq("id", job.id)
      .eq("lease_token", token);
    // Finish, guarded on status: a person who pressed Stop while the last
    // product was in flight keeps 'canceled'; it is never rewritten to 'done'.
    let finishedNow = false;
    if (finish) {
      const { data: fin } = await admin
        .from(LOOKUP_JOBS_TABLE)
        .update({ status: "done", finished_at: at, updated_at: at })
        .eq("id", job.id)
        .in("status", ["queued", "running"])
        .select("id");
      finishedNow = ((fin as { id: string }[] | null) ?? []).length === 1;
    }
    out.finished = finish;
    if (finishedNow) {
      await recordAudit({
        actorId: actor.userId,
        actorEmail: actor.email,
        action: "catalog_draft.batch_lookup_finished",
        entityType: "inbound_manifests",
        entityId: job.manifest_id,
        after: summary
          ? { jobId: job.id, total: summary.total, lookedUp: summary.lookedUp, failed: summary.failed, attached: summary.attached, needsEye: summary.needsEye, aiCalls: summary.aiCalls }
          : { jobId: job.id },
      });
    }
    return out;
  } catch (err) {
    console.error("[lookup-jobs] tick failed:", err);
    return { ...out, ok: false, error: itemErrorText(err) };
  }
}

export const __test = { SkipItem, LOOKUP_MAX_JOB_ITEMS };
