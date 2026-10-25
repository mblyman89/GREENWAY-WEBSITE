/**
 * R74 S34 - the Gemini Batch API engine for background product lookups.
 *
 * On with AI_LOOKUP_ENGINE=batch (Vercel env). Every cron minute
 * (/api/cron/lookup-jobs) runs runGeminiBatchTick:
 *   1. POLL  - each open ai_batches row: GET batches/{name}. A finished batch
 *      is INGESTED: every keyed answer goes through the same parse + gate +
 *      post-process as a live lookup (finishProductLookup) and the same
 *      attach + snapshot path (completeItem) for EVERY lot of that product
 *      family. A product with no usable answer is requeued (no attempt used
 *      up; after LOOKUP_RETRY_MAX_ATTEMPTS it fails with the plain reason).
 *   2. SUBMIT - while fewer than AI_BATCH_MAX_INFLIGHT batches wait at
 *      Google, the oldest queued products (any job, any vendor) are grouped
 *      into product families and up to BATCH_MAX_FAMILIES families go out as
 *      ONE inline batch (google_search only, low thinking).
 * Products claimed by a batch are 'running' with batch_id set, so the live
 * runner never touches them. Cost lands in ai_batches (tokens, searches,
 * estimated cents at Batch prices) and one ai_usage row per batch.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { geminiApiKey, aiWebSearchModelId } from "@/lib/ai/provider";
import { logAiUsage } from "@/lib/ai/usage";
import { resolveGeminiModel, effectiveMaxOutputTokens } from "@/lib/ai/gemini-models-core";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { buildProductLookupPrompt, finishProductLookup } from "@/lib/inventory/product-lookup-ai";
import { postProcessLookup } from "@/lib/inventory/product-lookup-core";
import { recallForDraft } from "@/lib/catalog/fact-memory";
import { KB_FIRST_ONBOARDING_ENV, alreadyKnownPromptBlock, kbFirstOnboardingEnabled, memoryRawLookup, MEMORY_MODEL_LABEL, shouldSkipGemini } from "@/lib/catalog/fact-memory-core";
import { completeItem, lookupQueryForDraft, SkipItem } from "@/lib/catalog/lookup-job-server";
import { DRAFT_GONE_COPY, LEFT_REVIEW_COPY, LOOKUP_RETRY_MAX_ATTEMPTS, batchThinkingLevel, AI_BATCH_THINKING_LEVEL_ENV, itemErrorText, summarizeJob } from "@/lib/catalog/lookup-job-core";
import { isAgainMarker } from "@/lib/catalog/lookup-history-core";
import { readBatchControl } from "@/lib/ai/batch-control-server";
import { createBackoffUntil, logBatchEvent } from "@/lib/ai/batch-events-server";
import {
  BATCH_LOST_NOTE,
  BATCH_STOPPED_NOTE,
  GOOGLE_STATES,
  OPEN_BATCH_STATES,
  POLL_BATCH_STATES,
  curlFor,
  explainGemini,
  googleBatchRow,
  googleStateKey,
  parseBatchList,
  sendDecision,
  type GoogleBatchRow,
} from "@/lib/ai/gemini-batch-explain-core";
import {
  AI_BATCH_MAX_INFLIGHT_ENV,
  AI_LOOKUP_ENGINE_ENV,
  BATCH_MAX_FAMILIES,
  BATCH_REQUEUE_NOTE,
  BATCH_SCAN_ITEMS,
  ZERO_USAGE,
  addUsage,
  batchCostCents,
  batchMaxInflight,
  batchModelPath,
  buildBatchCreateBody,
  buildBatchRequest,
  groupFamilies,
  isFinalBatchState,
  lookupEngine,
  parseBatchOperation,
  parseJsonl,
  productFamilyKey,
  type KeyedAnswer,
} from "@/lib/ai/gemini-batch-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const API = "https://generativelanguage.googleapis.com";
const LEASE_MS = 10 * 60_000;

export function batchEngineOn(): boolean {
  return lookupEngine(process.env[AI_LOOKUP_ENGINE_ENV]) === "batch";
}

export type BatchTickResult = { ok: boolean; skipped?: string; submitted: number; families: number; items: number; polled: number; ingested: number; error?: string };

/** One call to the Gemini API. Never throws: a network failure is status 0. */
export async function gemini(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  try {
    const res = await fetch(`${API}/${path}`, { ...init, headers: { "x-goog-api-key": geminiApiKey(), "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, text };
  }
}

type Actor = { userId: string | null; email: string | null };
type QueuedItem = { id: string; job_id: string; draft_id: string; attempts: number | null; result_json: unknown };
type Draft = { id: string; name: string | null; brand_name: string | null; vendor_name: string | null; pos_product_key: string | null; inventory_type: string | null; category: string | null; strain_name: string | null; chosen_website_category: string | null; status: string | null };

async function actorFor(admin: Admin, jobId: string, cache: Map<string, Actor>): Promise<Actor> {
  const hit = cache.get(jobId);
  if (hit) return hit;
  const { data: job } = await admin.from("lookup_jobs").select("created_by").eq("id", jobId).maybeSingle();
  const uid = ((job as { created_by: string | null } | null) ?? null)?.created_by ?? null;
  let email: string | null = null;
  if (uid) {
    const { data: s } = await admin.from("staff_profiles").select("email").eq("id", uid).maybeSingle();
    email = ((s as { email: string | null } | null) ?? null)?.email ?? null;
  }
  const a = { userId: uid, email };
  cache.set(jobId, a);
  return a;
}

async function finishItem(admin: Admin, itemId: string, patch: Record<string, unknown>, requeue = false): Promise<void> {
  const at = new Date().toISOString();
  await admin
    .from("lookup_job_items")
    .update(requeue ? { ...patch, batch_id: null, updated_at: at } : { ...patch, batch_id: null, finished_at: at, updated_at: at })
    .eq("id", itemId)
    .eq("status", "running");
}

/**
 * R74 S37: this product's own cost (0296 lookup_job_items.cost_cents), added
 * to any earlier try. Best-effort and separate from the status write, so a
 * database without 0296 still ingests (the ledger then estimates).
 */
async function addItemCost(admin: Admin, itemId: string, cents: number): Promise<void> {
  if (!(cents > 0)) return;
  try {
    const { data, error } = await admin.from("lookup_job_items").select("cost_cents").eq("id", itemId).maybeSingle();
    if (error) return;
    const prior = Number((data as { cost_cents: unknown } | null)?.cost_cents ?? 0) || 0;
    await admin.from("lookup_job_items").update({ cost_cents: Math.round((prior + cents) * 1000) / 1000 }).eq("id", itemId);
  } catch {
    /* the ledger estimates this product instead */
  }
}

/** Progress + finish for each touched job (the same rule as the live tick). */
async function settleJobs(admin: Admin, jobIds: Iterable<string>): Promise<void> {
  for (const jobId of new Set(jobIds)) {
    const rows: { draft_id: string; status: string; result_json: unknown; error: string | null; ai_calls: unknown }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("lookup_job_items").select("draft_id, status, result_json, error, ai_calls").eq("job_id", jobId).order("id").range(from, from + 999);
      if (error) return;
      const page = (data as typeof rows | null) ?? [];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    const s = summarizeJob(rows.map((r) => ({ draftId: r.draft_id, status: r.status as "queued", result: null, error: r.error, aiCalls: r.ai_calls as number })));
    const at = new Date().toISOString();
    await admin.from("lookup_jobs").update({ done: s.lookedUp + s.canceled, updated_at: at }).eq("id", jobId);
    if (s.finished) await admin.from("lookup_jobs").update({ status: "done", finished_at: at, updated_at: at }).eq("id", jobId).in("status", ["queued", "running"]);
  }
}

// ─── Submit ─────────────────────────────────────────────────────────────────

async function submitOne(admin: Admin, pausedJobs: ReadonlySet<string> = new Set()): Promise<{ families: number; items: number; refused?: boolean } | null> {
  // Oldest queued products of open jobs; never a job whose live lease is held.
  const { data: jobs } = await admin.from("lookup_jobs").select("id, lease_until").in("status", ["queued", "running"]).order("created_at").limit(200);
  const now = Date.now();
  const jobIds = ((jobs as { id: string; lease_until: string | null }[] | null) ?? []).filter((j) => (!j.lease_until || Date.parse(j.lease_until) < now) && !pausedJobs.has(j.id)).map((j) => j.id);
  if (jobIds.length === 0) return null;
  const { data: q } = await admin
    .from("lookup_job_items")
    .select("id, job_id, draft_id, attempts, result_json")
    .in("job_id", jobIds)
    .eq("status", "queued")
    .is("batch_id", null)
    .order("job_id")
    .order("position")
    .limit(BATCH_SCAN_ITEMS);
  const queued = (q as QueuedItem[] | null) ?? [];
  if (queued.length === 0) return null;

  const draftIds = [...new Set(queued.map((i) => i.draft_id))];
  const drafts = new Map<string, Draft>();
  for (let i = 0; i < draftIds.length; i += 200) {
    const { data } = await admin
      .from("catalog_product_drafts")
      .select("id, name, brand_name, vendor_name, pos_product_key, inventory_type, category, strain_name, chosen_website_category, status")
      .in("id", draftIds.slice(i, i + 200));
    for (const d of (data as Draft[] | null) ?? []) drafts.set(d.id, d);
  }

  const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);
  const banned = await loadBannedPhrases();
  const actors = new Map<string, Actor>();
  const keyed: { itemId: string; key: string; item: QueuedItem; draft: Draft; refresh: boolean }[] = [];
  const touched: string[] = [];
  for (const it of queued) {
    const d = drafts.get(it.draft_id);
    if (!d || d.status !== "draft") {
      await admin.from("lookup_job_items").update({ status: "canceled", error: d ? LEFT_REVIEW_COPY : DRAFT_GONE_COPY, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", it.id).eq("status", "queued");
      touched.push(it.job_id);
      continue;
    }
    const refresh = isAgainMarker(it.result_json);
    // KB first: a product whose facts are all on file never reaches Gemini.
    if (kbFirst && !refresh) {
      const memory = await recallForDraft(d.id);
      if (shouldSkipGemini({ enabled: true, refresh: false, memory }) && memory) {
        const { data: got } = await admin.from("lookup_job_items").update({ status: "running", attempts: (it.attempts ?? 0) + 1, started_at: new Date().toISOString() }).eq("id", it.id).eq("status", "queued").select("id");
        if (((got as unknown[] | null) ?? []).length !== 1) continue;
        try {
          const r = await completeItem(admin, d.id, await actorFor(admin, it.job_id, actors), { safe: postProcessLookup(memoryRawLookup(memory), banned), outcome: null, memory, skipWeb: true, model: MEMORY_MODEL_LABEL, aiCalls: 0 });
          await finishItem(admin, it.id, { status: "done", result_json: { ...r.result, snapshot: r.snapshot }, ai_calls: 0, error: null });
        } catch (err) {
          await finishItem(admin, it.id, { status: "failed", error: itemErrorText(err) });
        }
        touched.push(it.job_id);
        continue;
      }
    }
    const q2 = await lookupQueryForDraft(d);
    keyed.push({ itemId: it.id, key: refresh ? "" : productFamilyKey({ brand: d.brand_name, vendor: d.vendor_name, productName: q2.productName, category: d.chosen_website_category ?? d.category }), item: it, draft: d, refresh });
  }
  if (touched.length) await settleJobs(admin, touched);
  if (keyed.length === 0) return { families: 0, items: 0 };

  const fams = [...groupFamilies(keyed).values()].slice(0, BATCH_MAX_FAMILIES);
  const model = resolveGeminiModel(aiWebSearchModelId);
  const level = batchThinkingLevel(process.env[AI_BATCH_THINKING_LEVEL_ENV]);
  const entries: { key: string; request: Record<string, unknown> }[] = [];
  const requestKeys: Record<string, string[]> = {};
  for (let i = 0; i < fams.length; i += 1) {
    const lead = fams[i][0];
    const q3 = await lookupQueryForDraft(lead.draft);
    const memory = kbFirst && !lead.refresh ? await recallForDraft(lead.draft.id) : null;
    const p = buildProductLookupPrompt({ query: q3.query, productName: q3.productName, vendorOrBrand: q3.vendorOrBrand, alreadyKnown: lead.refresh ? "" : alreadyKnownPromptBlock(memory) });
    const key = `f${i}`;
    entries.push({ key, request: buildBatchRequest({ system: p.system, user: p.user, maxOutputTokens: effectiveMaxOutputTokens(model, p.maxTokens), thinkingLevel: level === "minimal" ? "low" : level }) });
    requestKeys[key] = fams[i].map((m) => m.itemId);
  }
  const itemIds = Object.values(requestKeys).flat();

  // The row first (the claim), then Google, then the products.
  const { data: row, error: insErr } = await admin.from("ai_batches").insert({ model: model.id, state: "submitting", families: entries.length, items: itemIds.length, request_keys: requestKeys }).select("id").single();
  if (insErr || !row) throw new Error("The batch record could not be written (is migration 0295 applied?).");
  const batchId = (row as { id: string }).id;
  const claimed: string[] = [];
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await admin.from("lookup_job_items").update({ status: "running", batch_id: batchId, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", itemIds.slice(i, i + 200)).eq("status", "queued").select("id");
    claimed.push(...((data as { id: string }[] | null) ?? []).map((r) => r.id));
  }
  const res = await gemini(`v1beta/${batchModelPath(model.id)}`, { method: "POST", body: JSON.stringify(buildBatchCreateBody(`greenway-lookups-${batchId.slice(0, 8)}`, entries)) });
  const op = parseBatchOperation(res.json);
  if (!res.ok || !op.name) {
    // Nothing went out: hand the products back untouched.
    for (let i = 0; i < claimed.length; i += 200) await admin.from("lookup_job_items").update({ status: "queued", batch_id: null, updated_at: new Date().toISOString() }).in("id", claimed.slice(i, i + 200)).eq("batch_id", batchId);
    const x = explainGemini(res.status, res.json ?? res.text);
    await admin.from("ai_batches").update({ state: "failed", error: `${x.title} (${x.googleWord}): ${res.text.slice(0, 200)}`, poll_status: res.status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", batchId);
    await logBatchEvent(admin, { kind: "create", batchId, severity: x.severity === "ok" ? "bad" : x.severity, httpStatus: res.status, title: `Google refused the new batch: ${x.title}`, plain: `${x.plain} The ${claimed.length} products went back in line untouched; nothing was charged.`, fix: x.fix, command: `POST ${API}/v1beta/${batchModelPath(model.id)}`, raw: res.text.slice(0, 4000) });
    return { families: 0, items: 0, refused: true };
  }
  const g = googleBatchRow(res.json);
  await admin.from("ai_batches").update({ name: op.name, state: op.state === "unknown" ? "pending" : op.state, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", batchId);
  await recordGoogle(admin, batchId, g, res.status, null);
  await logBatchEvent(admin, { kind: "create", batchId, batchName: op.name, severity: "ok", httpStatus: res.status, googleState: g ? `BATCH_STATE_${g.state}` : null, title: `Batch sent to Google: ${entries.length} questions covering ${claimed.length} products`, plain: `Google accepted the batch and named it ${op.name}. ${GOOGLE_STATES[g?.state ?? "PENDING"].meaning}`, fix: "Nothing to do. Watch it move along the steps below.", command: curlFor("get", op.name) });
  return { families: entries.length, items: claimed.length };
}

// ─── Poll + ingest ──────────────────────────────────────────────────────────

async function ingest(admin: Admin, b: { id: string; name: string; model: string; request_keys: unknown; answered: number; failed: number }, answers: KeyedAnswer[], final: string, deadline: number): Promise<number> {
  const keys = (b.request_keys && typeof b.request_keys === "object" ? b.request_keys : {}) as Record<string, string[]>;
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const banned = await loadBannedPhrases();
  const v2On = buildProductLookupPrompt({ query: "x" }).v2On;
  const actors = new Map<string, Actor>();
  let usage = { ...ZERO_USAGE };
  let answered = 0;
  let failed = 0;
  const jobs: string[] = [];
  let outOfTime = false;
  for (const a of answers) if (keys[a.key]) usage = addUsage(usage, a.usage);
  for (const [key, itemIds] of Object.entries(keys)) {
    // Out of time: stop between families; the next run carries on with the
    // products still waiting on this batch (done ones have left it).
    if (Date.now() > deadline) {
      outOfTime = true;
      break;
    }
    const a = byKey.get(key);
    const { data } = await admin.from("lookup_job_items").select("id, job_id, draft_id, attempts, ai_calls").in("id", itemIds).eq("batch_id", b.id).eq("status", "running");
    const rows = (data as { id: string; job_id: string; draft_id: string; attempts: number | null; ai_calls: number | null }[] | null) ?? [];
    const outcome = a && !a.error && a.text ? finishProductLookup({ text: a.text, sources: a.sources, model: b.model, usedWebSearch: a.usage.searchQueries > 0 || a.sources.length > 0, ...(a.truncated ? { incomplete: true } : {}) }, v2On, banned) : null;
    // The family's tokens + searches, priced once, land on its first lot.
    if (a && rows[0]) await addItemCost(admin, rows[0].id, batchCostCents(a.usage));
    for (let i = 0; i < rows.length; i += 1) {
      const it = rows[i];
      jobs.push(it.job_id);
      // The family's paid call is counted once (on its first lot).
      const calls = (it.ai_calls ?? 0) + (a && i === 0 ? 1 : 0);
      if (!outcome && final === "canceled" && !a) {
        // R74 S41: a batch you stopped keeps its products aside (never resent by itself).
        await finishItem(admin, it.id, { status: "canceled", error: BATCH_STOPPED_NOTE, ai_calls: calls });
        continue;
      }
      if (!outcome) {
        const n = (it.attempts ?? 0) + 1;
        const reason = a?.error ? `Gemini batch: ${a.error}` : final === "succeeded" ? "Gemini returned no answer for this product." : `Gemini batch ${final}.`;
        if (n >= LOOKUP_RETRY_MAX_ATTEMPTS) {
          await finishItem(admin, it.id, { status: "failed", attempts: n, error: reason.slice(0, 240), ai_calls: calls });
          failed += 1;
        } else {
          await finishItem(admin, it.id, { status: "queued", attempts: n, error: BATCH_REQUEUE_NOTE, ai_calls: calls }, true);
        }
        continue;
      }
      try {
        const memory = await recallForDraft(it.draft_id);
        const r = await completeItem(admin, it.draft_id, await actorFor(admin, it.job_id, actors), { safe: outcome.result, outcome, memory, skipWeb: false, model: b.model, aiCalls: i === 0 ? 1 : 0 });
        await finishItem(admin, it.id, { status: "done", attempts: (it.attempts ?? 0) + 1, result_json: { ...r.result, snapshot: r.snapshot }, ai_calls: calls, error: null });
        answered += 1;
      } catch (err) {
        await finishItem(admin, it.id, err instanceof SkipItem ? { status: "canceled", error: err.copy } : { status: "failed", error: itemErrorText(err), ai_calls: calls });
        failed += 1;
      }
    }
  }
  if (outOfTime) {
    await admin.from("ai_batches").update({ answered: b.answered + answered, failed: b.failed + failed, lease_until: null, updated_at: new Date().toISOString() }).eq("id", b.id);
    await settleJobs(admin, jobs);
    return answered;
  }
  answered += b.answered;
  failed += b.failed;
  const cost = batchCostCents(usage);
  await admin
    .from("ai_batches")
    .update({ state: "ingested", answered, failed, prompt_tokens: usage.promptTokens, output_tokens: usage.outputTokens, search_queries: usage.searchQueries, cost_cents: cost, ingested_at: new Date().toISOString(), lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", b.id);
  await logBatchEvent(admin, { kind: "ingest", batchId: b.id, batchName: b.name, severity: final === "succeeded" ? "ok" : "warn", googleState: `BATCH_STATE_${googleStateKey(final)}`, title: final === "succeeded" ? `Facts saved: ${answered} products answered, ${failed} with no usable answer` : `Batch closed (${GOOGLE_STATES[googleStateKey(final)].plain}): ${answered} answered`, plain: `${final === "succeeded" ? "Every answer Google sent back is now on its product." : GOOGLE_STATES[googleStateKey(final)].meaning} Google used ${usage.searchQueries} web searches and ${usage.promptTokens + usage.outputTokens} tokens (about $${(cost / 100).toFixed(2)}).`, fix: final === "succeeded" ? "Nothing. Review the products on Product Onboarding." : GOOGLE_STATES[googleStateKey(final)].todo });
  await logAiUsage({ feature: "inventory.product_lookup.batch", entityType: "ai_batches", entityId: b.id, model: b.model, promptTokens: usage.promptTokens, completionTokens: usage.outputTokens, totalTokens: usage.promptTokens + usage.outputTokens, estimated: false, ok: final === "succeeded", errorNote: `batch ${b.name}: ${answered} answered, ${failed} failed, ${usage.searchQueries} searches, ~$${(cost / 100).toFixed(2)}` });
  await settleJobs(admin, jobs);
  return answered;
}

/** R74 S41: Google's own view of one batch, saved on our row (needs 0299; best effort). */
async function recordGoogle(admin: Admin, batchId: string, g: GoogleBatchRow | null, status: number, pollError: string | null): Promise<void> {
  try {
    await admin
      .from("ai_batches")
      .update({
        ...(g ? { google_state: `BATCH_STATE_${g.state}`, batch_stats: g.stats, google_create_time: g.createTime, google_update_time: g.updateTime } : {}),
        last_polled_at: new Date().toISOString(),
        poll_status: status,
        poll_error: pollError,
      })
      .eq("id", batchId);
  } catch {
    /* 0299 not applied: the engine still runs */
  }
}

/** Products still riding on a batch that will never answer: set aside with a note. */
async function holdBatchItems(admin: Admin, batchId: string, note: string): Promise<number> {
  const at = new Date().toISOString();
  const { data } = await admin.from("lookup_job_items").update({ status: "canceled", error: note, batch_id: null, finished_at: at, updated_at: at }).eq("batch_id", batchId).eq("status", "running").select("job_id");
  const rows = (data as { job_id: string }[] | null) ?? [];
  if (rows.length) await settleJobs(admin, rows.map((r) => r.job_id));
  return rows.length;
}

type PollRow = { id: string; name: string | null; model: string; state: string; request_keys: unknown; lease_until: string | null; created_at: string; answered: number; failed: number; poll_status?: number | null };

async function pollAll(admin: Admin, out: BatchTickResult, deadline: number): Promise<void> {
  let res0: { data: unknown; error: unknown } = await admin.from("ai_batches").select("id, name, model, state, request_keys, lease_until, created_at, answered, failed, poll_status").in("state", [...POLL_BATCH_STATES]).order("created_at").limit(50);
  if (res0.error) res0 = await admin.from("ai_batches").select("id, name, model, state, request_keys, lease_until, created_at, answered, failed").in("state", [...POLL_BATCH_STATES]).order("created_at").limit(50);
  for (const b of (res0.data as PollRow[] | null) ?? []) {
    if (Date.now() > deadline) return;
    if (!b.name) continue;
    if (b.lease_until && Date.parse(b.lease_until) > Date.now()) continue;
    const res = await gemini(`v1beta/${b.name}`);
    out.polled += 1;
    if (!res.ok) {
      // R74 S41: never silent. Saved on the row; logged once per new status.
      const x = explainGemini(res.status, res.json ?? res.text);
      await recordGoogle(admin, b.id, null, res.status, `${x.title}: ${res.text.slice(0, 200)}`);
      if (b.poll_status !== res.status) await logBatchEvent(admin, { kind: "poll", batchId: b.id, batchName: b.name, severity: x.severity, httpStatus: res.status, title: `Checking ${b.name}: ${x.title}`, plain: x.plain, fix: x.fix, command: curlFor("get", b.name), raw: res.text.slice(0, 4000) });
      if (res.status === 404 && b.state !== "ingesting") {
        await admin.from("ai_batches").update({ state: "lost", error: "Google no longer has this batch (404).", finished_at: new Date().toISOString(), lease_until: null, updated_at: new Date().toISOString() }).eq("id", b.id).eq("state", b.state);
        await holdBatchItems(admin, b.id, BATCH_LOST_NOTE);
      }
      continue;
    }
    const op = parseBatchOperation(res.json);
    const g = googleBatchRow(res.json);
    await recordGoogle(admin, b.id, g, res.status, null);
    // An ingest a killed run left behind is picked up again once its lease ends.
    if (!isFinalBatchState(op.state)) {
      if (op.state !== b.state && op.state !== "unknown") {
        await admin.from("ai_batches").update({ state: op.state, updated_at: new Date().toISOString() }).eq("id", b.id);
        const k = googleStateKey(op.state);
        await logBatchEvent(admin, { kind: "poll", batchId: b.id, batchName: b.name, severity: "info", httpStatus: res.status, googleState: `BATCH_STATE_${k}`, title: `${b.name}: ${GOOGLE_STATES[k].plain}`, plain: GOOGLE_STATES[k].meaning, fix: GOOGLE_STATES[k].todo, command: curlFor("get", b.name) });
      }
      continue;
    }
    // Lease the ingest (CAS on the state we read) so two runs never attach twice.
    const { data: won } = await admin.from("ai_batches").update({ state: "ingesting", lease_until: new Date(Date.now() + LEASE_MS).toISOString(), ...(b.state === "ingesting" ? {} : { finished_at: new Date().toISOString(), error: op.error }), updated_at: new Date().toISOString() }).eq("id", b.id).eq("state", b.state).select("id");
    if (((won as unknown[] | null) ?? []).length !== 1) continue;
    if (b.state !== "ingesting") {
      const k = googleStateKey(op.state);
      await logBatchEvent(admin, { kind: "poll", batchId: b.id, batchName: b.name, severity: GOOGLE_STATES[k].severity, httpStatus: res.status, googleState: `BATCH_STATE_${k}`, title: `${b.name}: ${GOOGLE_STATES[k].plain}${g?.stats ? ` (${g.stats.succeeded} answered, ${g.stats.failed} failed of ${g.stats.total})` : ""}`, plain: `${GOOGLE_STATES[k].meaning}${op.error ? ` Google said: "${op.error}"` : ""}`, fix: GOOGLE_STATES[k].todo, command: curlFor("get", b.name) });
    }
    let answers = op.inlined;
    if (answers.length === 0 && op.responsesFile) {
      const f = await gemini(`download/v1beta/${op.responsesFile}:download?alt=media`);
      if (f.ok) answers = parseJsonl(f.text);
      else {
        const x = explainGemini(f.status, f.json ?? f.text);
        await logBatchEvent(admin, { kind: "ingest", batchId: b.id, batchName: b.name, severity: "warn", httpStatus: f.status, title: `Could not download the answers file: ${x.title}`, plain: x.plain, fix: "Nothing. The app tries again in 10 minutes.", raw: f.text.slice(0, 2000) });
        await admin.from("ai_batches").update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString() }).eq("id", b.id);
        continue;
      }
    }
    out.ingested += await ingest(admin, { id: b.id, name: b.name, model: b.model, request_keys: b.request_keys, answered: b.answered ?? 0, failed: b.failed ?? 0 }, answers, op.state, deadline);
  }
}

/**
 * R74 S35/S41: ask Google to stop a batch (POST batches/{id}:cancel). The
 * next poll sees CANCELLED, saves any answers Google already made, and sets
 * the rest of its products aside (never resent by itself).
 */
export async function cancelGeminiBatch(name: string, actorEmail: string | null = null): Promise<{ ok: boolean; message: string }> {
  if (!/^batches\/[A-Za-z0-9_-]+$/.test(name)) return { ok: false, message: "That batch name is not valid." };
  const res = await gemini(`v1beta/${name}:cancel`, { method: "POST" });
  const x = explainGemini(res.status, res.json ?? res.text);
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("ai_batches").select("id").eq("name", name).maybeSingle();
    await logBatchEvent(admin, { kind: "cancel", batchId: (data as { id: string } | null)?.id ?? null, batchName: name, severity: res.ok ? "ok" : x.severity, httpStatus: res.status, title: res.ok ? `Cancel sent for ${name}` : `Cancel refused for ${name}: ${x.title}`, plain: res.ok ? "Google stops the batch within a few minutes. Anything it already answered is still saved; the rest of its products are set aside, not resent." : x.plain, fix: res.ok ? "Nothing. Watch it turn Cancelled." : x.fix, command: curlFor("cancel", name), raw: res.text.slice(0, 2000), actorEmail });
  }
  return res.ok
    ? { ok: true, message: `Cancel sent to Google for ${name}. Within a few minutes it shows Cancelled; its unanswered products are set aside (not resent).` }
    : { ok: false, message: `${x.title}. ${x.fix}` };
}

/**
 * R74 S41: delete a FINISHED batch at Google (DELETE batches/{id}). Google
 * then forgets it (and its results). Only for batches already ended; to stop
 * a running one use cancel.
 */
export async function deleteGeminiBatch(name: string, actorEmail: string | null = null): Promise<{ ok: boolean; message: string }> {
  if (!/^batches\/[A-Za-z0-9_-]+$/.test(name)) return { ok: false, message: "That batch name is not valid." };
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("ai_batches").select("id, state").eq("name", name).maybeSingle();
    const row = data as { id: string; state: string } | null;
    if (row && (OPEN_BATCH_STATES as readonly string[]).includes(row.state)) return { ok: false, message: "That batch is still open, so its answers are not saved yet. Cancel it first (or let it finish), then delete." };
  }
  const res = await gemini(`v1beta/${name}`, { method: "DELETE" });
  const x = explainGemini(res.status, res.json ?? res.text);
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("ai_batches").select("id").eq("name", name).maybeSingle();
    await logBatchEvent(admin, { kind: "delete", batchId: (data as { id: string } | null)?.id ?? null, batchName: name, severity: res.ok ? "ok" : x.severity, httpStatus: res.status, title: res.ok ? `Deleted ${name} at Google` : `Delete refused for ${name}: ${x.title}`, plain: res.ok ? "Google no longer keeps this batch or its results. Facts already saved on your products are untouched." : x.plain, fix: res.ok ? "Nothing." : x.fix, command: curlFor("delete", name), raw: res.text.slice(0, 2000), actorEmail });
  }
  return res.ok ? { ok: true, message: `Google deleted ${name}. Facts already saved on your products are untouched.` } : { ok: false, message: `${x.title}. ${x.fix}` };
}

/** R74 S41: the Check now button. Ask Google about every open batch right away (no sending). */
export async function checkBatchesNow(): Promise<BatchTickResult> {
  const out: BatchTickResult = { ok: true, submitted: 0, families: 0, items: 0, polled: 0, ingested: 0 };
  if (!isSupabaseServiceConfigured || !geminiApiKey()) return { ...out, ok: false, skipped: "not_configured" };
  const admin = createSupabaseAdminClient();
  try {
    await pollAll(admin, out, Date.now() + 200_000);
    return out;
  } catch (err) {
    return { ...out, ok: false, error: itemErrorText(err) };
  }
}

/** R74 S41: every page of GET v1beta/batches (Google's own list). */
export async function listGoogleBatches(maxPages = 10): Promise<{ ok: boolean; status: number; rows: GoogleBatchRow[]; raw: string; error: string | null }> {
  const rows: GoogleBatchRow[] = [];
  let token: string | null = null;
  let raw = "";
  for (let p = 0; p < maxPages; p += 1) {
    const res = await gemini(`v1beta/batches?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    if (p === 0) raw = res.text;
    if (!res.ok) {
      const x = explainGemini(res.status, res.json ?? res.text);
      return { ok: false, status: res.status, rows, raw: res.text, error: `${x.title}. ${x.fix}` };
    }
    const page = parseBatchList(res.json);
    rows.push(...page.rows);
    token = page.nextPageToken;
    if (!token) break;
  }
  return { ok: true, status: 200, rows, raw, error: null };
}

/**
 * R74 S41: one cron minute. Poll every open batch (always, even when paused:
 * those are paid for). Then, holding the ONE sender lease, send at most one
 * new batch if sendDecision allows it (pause, manual budget, the cap counted
 * as every batch not yet saved, the back-off after Google refused a send).
 */
export async function runGeminiBatchTick(deps: { budgetMs?: number } = {}): Promise<BatchTickResult> {
  const out: BatchTickResult = { ok: true, submitted: 0, families: 0, items: 0, polled: 0, ingested: 0 };
  if (!batchEngineOn()) return { ...out, skipped: "engine_live" };
  if (!isSupabaseServiceConfigured || !geminiApiKey()) return { ...out, skipped: "not_configured" };
  const deadline = Date.now() + (deps.budgetMs ?? 600_000);
  const holder = `tick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let leased = false;
  const admin = createSupabaseAdminClient();
  try {
    await pollAll(admin, out, deadline);
    const control = await readBatchControl(admin);
    if (control.paused) return { ...out, skipped: "paused" };
    if (control.mode === "manual" && control.budget <= 0) return { ...out, skipped: "manual_no_budget" };
    const lease = await admin.rpc("ai_batch_send_lease", { p_holder: holder, p_seconds: 300 });
    if (lease.error || lease.data !== true) return { ...out, skipped: lease.error ? "no_lease_migration_0299" : "another_sender" };
    leased = true;
    const { count } = await admin.from("ai_batches").select("id", { count: "exact", head: true }).in("state", [...OPEN_BATCH_STATES]);
    const backoff = await createBackoffUntil(admin);
    const cap = batchMaxInflight(process.env[AI_BATCH_MAX_INFLIGHT_ENV]);
    const d = sendDecision({ paused: control.paused, mode: control.mode, budget: control.budget, open: count ?? 0, cap, backoffUntil: backoff.until, now: Date.now(), queued: 1 });
    if (!d.send) return { ...out, skipped: d.why };
    const pausedJobs = new Set(control.pausedJobIds);
    for (let tries = 0; tries < 10 && Date.now() < deadline; tries += 1) {
      const s = await submitOne(admin, pausedJobs);
      if (!s || s.refused) break;
      if (s.items === 0) continue; // every product was already known (KB first): look further
      out.submitted += 1;
      out.families += s.families;
      out.items += s.items;
      if (control.mode === "manual") await admin.rpc("ai_batch_budget_spend");
      break;
    }
    return out;
  } catch (err) {
    console.error("[gemini-batch] tick failed:", err);
    await logBatchEvent(admin, { kind: "error", severity: "bad", title: "The batch engine hit an error", plain: itemErrorText(err), fix: "It tries again next minute. If this repeats, copy it to your developer." });
    return { ...out, ok: false, error: itemErrorText(err) };
  } finally {
    if (leased) await admin.rpc("ai_batch_send_release", { p_holder: holder });
  }
}
