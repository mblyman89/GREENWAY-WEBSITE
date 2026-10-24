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

async function gemini(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { "x-goog-api-key": geminiApiKey(), "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
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

async function submitOne(admin: Admin): Promise<{ families: number; items: number } | null> {
  // Oldest queued products of open jobs; never a job whose live lease is held.
  const { data: jobs } = await admin.from("lookup_jobs").select("id, lease_until").in("status", ["queued", "running"]).order("created_at").limit(200);
  const now = Date.now();
  const jobIds = ((jobs as { id: string; lease_until: string | null }[] | null) ?? []).filter((j) => !j.lease_until || Date.parse(j.lease_until) < now).map((j) => j.id);
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
    await admin.from("ai_batches").update({ state: "failed", error: `create HTTP ${res.status}: ${res.text.slice(0, 200)}`, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", batchId);
    throw new Error(`Gemini batch create failed (HTTP ${res.status}).`);
  }
  await admin.from("ai_batches").update({ name: op.name, state: op.state === "unknown" ? "pending" : op.state, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", batchId);
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
    for (let i = 0; i < rows.length; i += 1) {
      const it = rows[i];
      jobs.push(it.job_id);
      // The family's paid call is counted once (on its first lot).
      const calls = (it.ai_calls ?? 0) + (a && i === 0 ? 1 : 0);
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
  await logAiUsage({ feature: "inventory.product_lookup.batch", entityType: "ai_batches", entityId: b.id, model: b.model, promptTokens: usage.promptTokens, completionTokens: usage.outputTokens, totalTokens: usage.promptTokens + usage.outputTokens, estimated: false, ok: final === "succeeded", errorNote: `batch ${b.name}: ${answered} answered, ${failed} failed, ${usage.searchQueries} searches, ~$${(cost / 100).toFixed(2)}` });
  await settleJobs(admin, jobs);
  return answered;
}

async function pollAll(admin: Admin, out: BatchTickResult, deadline: number): Promise<void> {
  const { data } = await admin.from("ai_batches").select("id, name, model, state, request_keys, lease_until, created_at, answered, failed").in("state", ["pending", "running", "succeeded", "failed", "canceled", "expired", "ingesting"]).order("created_at").limit(50);
  for (const b of (data as { id: string; name: string | null; model: string; state: string; request_keys: unknown; lease_until: string | null; created_at: string; answered: number; failed: number }[] | null) ?? []) {
    if (Date.now() > deadline) return;
    if (!b.name) continue;
    if (b.lease_until && Date.parse(b.lease_until) > Date.now()) continue;
    const res = await gemini(`v1beta/${b.name}`);
    out.polled += 1;
    if (!res.ok) continue;
    const op = parseBatchOperation(res.json);
    // An ingest a killed run left behind is picked up again once its lease ends.
    if (!isFinalBatchState(op.state)) {
      if (op.state !== b.state && op.state !== "unknown") await admin.from("ai_batches").update({ state: op.state, updated_at: new Date().toISOString() }).eq("id", b.id);
      continue;
    }
    // Lease the ingest (CAS on the state we read) so two runs never attach twice.
    const { data: won } = await admin.from("ai_batches").update({ state: "ingesting", lease_until: new Date(Date.now() + LEASE_MS).toISOString(), ...(b.state === "ingesting" ? {} : { finished_at: new Date().toISOString(), error: op.error }), updated_at: new Date().toISOString() }).eq("id", b.id).eq("state", b.state).select("id");
    if (((won as unknown[] | null) ?? []).length !== 1) continue;
    let answers = op.inlined;
    if (answers.length === 0 && op.responsesFile) {
      const f = await gemini(`download/v1beta/${op.responsesFile}:download?alt=media`);
      if (f.ok) answers = parseJsonl(f.text);
    }
    out.ingested += await ingest(admin, { id: b.id, name: b.name, model: b.model, request_keys: b.request_keys, answered: b.answered ?? 0, failed: b.failed ?? 0 }, answers, op.state, deadline);
  }
}

export async function runGeminiBatchTick(deps: { budgetMs?: number } = {}): Promise<BatchTickResult> {
  const out: BatchTickResult = { ok: true, submitted: 0, families: 0, items: 0, polled: 0, ingested: 0 };
  if (!batchEngineOn()) return { ...out, skipped: "engine_live" };
  if (!isSupabaseServiceConfigured || !geminiApiKey()) return { ...out, skipped: "not_configured" };
  const deadline = Date.now() + (deps.budgetMs ?? 600_000);
  try {
    const admin = createSupabaseAdminClient();
    await pollAll(admin, out, deadline);
    const { count } = await admin.from("ai_batches").select("id", { count: "exact", head: true }).in("state", ["submitting", "pending", "running"]);
    let open = count ?? 0;
    const cap = batchMaxInflight(process.env[AI_BATCH_MAX_INFLIGHT_ENV]);
    while (open < cap && Date.now() < deadline) {
      const s = await submitOne(admin);
      if (!s || s.items === 0) {
        if (!s) break;
        continue;
      }
      out.submitted += 1;
      out.families += s.families;
      out.items += s.items;
      open += 1;
    }
    return out;
  } catch (err) {
    console.error("[gemini-batch] tick failed:", err);
    return { ...out, ok: false, error: itemErrorText(err) };
  }
}
