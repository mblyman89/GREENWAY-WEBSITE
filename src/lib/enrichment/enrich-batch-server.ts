/**
 * src/lib/enrichment/enrich-batch-server.ts  (D244 round 2, slice R-3)
 *
 * The I/O side of enrich-batch-core.ts: the OVERNIGHT way to draft every
 * field of many products with AI (Google's Gemini Batch API, about half
 * price, answers within 24 h). The LIVE way is bulk-ai-v2-server.
 *
 * One worker tick (/api/cron/lookup-jobs on an idle minute; no new cron):
 *   1. RECOVER  a batch left "submitting" by a killed run: found at Google
 *               by its display name -> adopted; not found -> its products go
 *               back in line (Google never charged for it).
 *   2. POLL     each batch at Google. A finished one (succeeded / failed /
 *               cancelled / expired) is INGESTED: each product's answer is
 *               parsed, validated against the all-fields schema and stored
 *               through storeAllFieldsResult - the SAME re-clamp, effect
 *               gate, SEO clean, potency evidence check and compliance flags
 *               as a live draft. A product without a usable answer is queued
 *               again once, then failed with the reason.
 *   3. SEND     the queued products (after a 2-minute gather) as ONE batch:
 *               each request is built by buildAllFieldsRequestForProduct
 *               (the live prompt and evidence), constrained to the JSON
 *               schema, no web search.
 * Every state write is a compare-and-swap on site_settings.updated_at; the
 * tick holds one lease. Products are claimed and the batch record written
 * BEFORE Google is called (see the core's safety notes).
 * Nothing is accepted or published here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { logAiUsage } from "@/lib/ai/usage";
import { geminiApiKey } from "@/lib/ai/provider";
import { gemini, listGoogleBatches } from "@/lib/ai/gemini-http";
import { parseBatchOperation, parseJsonl, isFinalBatchState, batchModelPath, buildBatchCreateBody, addUsage, ZERO_USAGE, type KeyedAnswer } from "@/lib/ai/gemini-batch-core";
import { explainGemini } from "@/lib/ai/gemini-batch-explain-core";
import { clampThinkingLevel, effectiveMaxOutputTokens, parseThinkingWanted, resolveGeminiModel } from "@/lib/ai/gemini-models-core";
import { enrichModel } from "@/lib/ai/enrich-model";
import { toResponseFormat, validate, formatErrors } from "@/lib/ai/schema";
import { productAllFieldsSchema, type ProductAllFieldsResult } from "@/lib/ai/schemas/product";
import { ALL_FIELDS_ANSWER_TOKENS, storeAllFieldsResult } from "@/lib/ai/all-fields-draft";
import { buildAllFieldsRequestForProduct, type DraftItem } from "@/lib/enrichment/ai-draft-v2-server";
import { getItemBySourceKey, getPublishedVersion } from "@/lib/pos/menu-version";
import {
  ENRICH_BATCH_AUDIT,
  ENRICH_BATCH_KEY,
  ENRICH_BATCH_LABEL,
  ENRICH_BATCH_MODEL_VAR,
  ENRICH_BATCH_TICK_BUDGET_MS,
  batchPendingKeys,
  batchRunNote,
  batchTickDecision,
  buildEnrichBatchRequest,
  cancelQueuedBatch,
  claimForSend,
  closeBatchIfDrained,
  enqueueEnrichBatch,
  enrichBatchDisplayName,
  failBeforeSend,
  finishBatchItem,
  markBatchAccepted,
  markBatchIngesting,
  markBatchProgress,
  openBatches,
  parseAnswerJson,
  parseEnrichBatch,
  pickToSend,
  releaseBatchLease,
  resolveBatchModel,
  returnBatchItems,
  takeBatchLease,
  type BatchItemReq,
  type BatchQueueRequest,
  type EnrichBatchState,
} from "@/lib/enrichment/enrich-batch-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Snapshot = { state: EnrichBatchState; updatedAt: string | null };

const CAS_TRIES = 4;
/** Leave this much of the budget for the last writes. */
const SAFETY_MS = 30_000;

const short = (e: unknown) =>
  (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 200);

/** The overnight model (AI_ENRICH_BATCH_MODEL, else a Gemini live model, else gemini-4-carbon). */
export function enrichBatchModel(): string {
  return resolveBatchModel(process.env[ENRICH_BATCH_MODEL_VAR], enrichModel.model);
}

/** True when a Gemini key is set (the overnight batch needs one). */
export function enrichBatchConfigured(): boolean {
  return Boolean(geminiApiKey());
}

export async function readEnrichBatch(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", ENRICH_BATCH_KEY).maybeSingle();
  if (error) throw new Error(`The overnight batch could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseEnrichBatch(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

async function casWrite(admin: Admin, snap: Snapshot, next: EnrichBatchState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: ENRICH_BATCH_KEY, label: ENRICH_BATCH_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The overnight batch could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin.from("site_settings").update({ value_json: next, updated_by: actorId }).eq("key", ENRICH_BATCH_KEY).eq("updated_at", snap.updatedAt).select("key");
  if (error) throw new Error(`The overnight batch could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** read -> change -> CAS write, retried; `change` returning null = do not write. */
async function mutate<R>(admin: Admin, actorId: string | null, change: (s: EnrichBatchState) => { next: EnrichBatchState; out: R } | null): Promise<R | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readEnrichBatch(admin);
    const r = change(snap.state);
    if (!r) return null;
    if (await casWrite(admin, snap, r.next, actorId)) return r.out;
  }
  throw new Error("The overnight batch kept changing while it was being saved. Try again.");
}

export type EnrichBatchQueueOutcome = { added: number; already: number; capped: boolean };

export async function queueEnrichBatch(reqs: BatchQueueRequest[], actorId: string | null, deps: { admin?: Admin; nowIso?: string } = {}): Promise<EnrichBatchQueueOutcome> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const out = await mutate(admin, actorId, (cur) => {
    const r = enqueueEnrichBatch(cur, reqs, actorId, nowIso);
    return { next: r.state, out: { added: r.added, already: r.already, capped: r.capped } };
  });
  const o = out ?? { added: 0, already: 0, capped: false };
  await recordAudit({ actorId, action: ENRICH_BATCH_AUDIT.queued, entityType: "product", entityId: reqs.length === 1 ? reqs[0]!.key : null, after: { ...o, keys: reqs.slice(0, 50).map((r) => r.key) } }).catch(() => {});
  return o;
}

export async function cancelEnrichBatch(actorId: string | null, deps: { admin?: Admin } = {}): Promise<number> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const n = (await mutate(admin, actorId, (cur) => {
    const r = cancelQueuedBatch(cur);
    return r.canceled ? { next: r.state, out: r.canceled } : null;
  })) ?? 0;
  if (n) await recordAudit({ actorId, action: ENRICH_BATCH_AUDIT.canceled, entityType: "product", entityId: null, after: { canceled: n } }).catch(() => {});
  return n;
}

/** `readAtMs` = when the row was read (the page renders ages from it, not a render-time clock). */
export type EnrichBatchStatus = { ok: true; state: EnrichBatchState; readAtMs: number } | { ok: false; error: string };

export async function loadEnrichBatchStatus(deps: { admin?: Admin } = {}): Promise<EnrichBatchStatus> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    return { ok: true, state: (await readEnrichBatch(deps.admin ?? createSupabaseAdminClient())).state, readAtMs: Date.now() };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export type EnrichBatchTickResult =
  | { ok: true; skipped: "idle" | "leased" | "not_configured"; note: string }
  | { ok: true; skipped?: undefined; sent: number; stored: number; failedAnswers: number; polled: number; note: string }
  | { ok: false; error: string };

/** Build one product's request from the live menu row (same reader as a live draft). */
async function defaultBuild(key: string): Promise<{ req: BatchItemReq; system: string; user: string }> {
  const published = await getPublishedVersion();
  if (!published) throw new Error("There is no live menu, so this product's facts could not be read.");
  const row = await getItemBySourceKey(published.id, key);
  if (!row) throw new Error("This product is not on the live menu any more.");
  const item: DraftItem = { name: row.name, product_name: row.product_name, brand_name: row.brand_name, vendor_name: row.vendor_name, category: row.category, strain_type: row.strain_type, strain_name: row.strain_name, thc: row.thc, cbd: row.cbd };
  const r = await buildAllFieldsRequestForProduct(key, item);
  return { req: { offered: r.offered, numbers: r.numbers, summary: r.summary }, system: r.system, user: r.user };
}

/** One answer -> a validated all-fields result, or the plain reason it is unusable. */
function readAnswer(a: KeyedAnswer | undefined): { ok: true; value: ProductAllFieldsResult } | { ok: false; error: string } {
  if (!a) return { ok: false, error: "Google sent no answer for this product." };
  if (a.error) return { ok: false, error: `Google could not answer: ${a.error}` };
  if (a.truncated) return { ok: false, error: "Google's answer was cut off (too long)." };
  const json = parseAnswerJson(a.text);
  if (json === null) return { ok: false, error: "Google's answer was not readable JSON." };
  const v = validate(productAllFieldsSchema, json);
  return v.ok ? { ok: true, value: v.value } : { ok: false, error: `Google's answer did not fit the draft form: ${formatErrors(v.errors).slice(0, 160)}` };
}

export async function runEnrichBatchTick(
  opts: {
    budgetMs?: number;
    admin?: Admin;
    now?: () => number;
    token?: string;
    /** Tests: replace the Gemini HTTP call / the per-product request builder. */
    call?: typeof gemini;
    build?: typeof defaultBuild;
    list?: () => Promise<{ ok: boolean; rows: { name: string; displayName: string }[] }>;
  } = {},
): Promise<EnrichBatchTickResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const deadline = t0 + (opts.budgetMs ?? ENRICH_BATCH_TICK_BUDGET_MS) - SAFETY_MS;
  const token = opts.token ?? crypto.randomUUID();
  const call = opts.call ?? gemini;
  const build = opts.build ?? defaultBuild;
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // Decide + lease.
  let actorId: string | null = null;
  try {
    const snap = await readEnrichBatch(admin);
    const d = batchTickDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "leased" ? "Another run is working on the overnight batch." : "Nothing in the overnight batch." };
    if (!opts.call && !enrichBatchConfigured()) return { ok: true, skipped: "not_configured", note: "No Gemini key (AI_GEMINI_API_KEY), so the overnight batch cannot run." };
    actorId = snap.state.queuedBy;
    if (!(await casWrite(admin, snap, takeBatchLease(snap.state, token, t0), null))) return { ok: true, skipped: "leased", note: "Another run is working on the overnight batch." };
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  let sent = 0;
  let stored = 0;
  let failedAnswers = 0;
  let polled = 0;
  let why = "";
  let stoppedBecause: string | null = null;
  const mine = (s: EnrichBatchState) => s.leaseToken === token;

  try {
    // 1. RECOVER: a "submitting" record outside a live lease is an orphan.
    const cur0 = (await readEnrichBatch(admin)).state;
    const orphans = cur0.batches.filter((b) => b.state === "submitting");
    if (orphans.length) {
      const listed = await (opts.list ?? (() => listGoogleBatches(3)))();
      for (const b of orphans) {
        const hit = listed.ok ? listed.rows.find((r) => r.displayName === enrichBatchDisplayName(b.id)) : undefined;
        if (!listed.ok && !hit) continue; // cannot tell yet: try again next tick
        await mutate(admin, null, (s) => (mine(s) ? { next: hit ? markBatchAccepted(s, b.id, hit.name, new Date(now()).toISOString()) : returnBatchItems(s, b.id, "lost", "The send was interrupted before Google got it.", now()), out: true } : null));
      }
    }

    // 2. POLL + INGEST every batch at Google.
    for (const b of openBatches((await readEnrichBatch(admin)).state)) {
      if (now() > deadline) break;
      if (!b.name || b.state === "submitting") continue;
      const res = await call(`v1beta/${b.name}`);
      polled += 1;
      if (!res.ok) {
        if (res.status === 404) await mutate(admin, null, (s) => (mine(s) ? { next: returnBatchItems(s, b.id, "lost", "Google no longer has this batch (404).", now()), out: true } : null));
        continue; // any other error: try again next tick
      }
      const op = parseBatchOperation(res.json);
      if (!isFinalBatchState(op.state)) {
        if ((op.state === "pending" || op.state === "running") && op.state !== b.state) await mutate(admin, null, (s) => (mine(s) ? { next: markBatchProgress(s, b.id, op.state as "pending" | "running"), out: true } : null));
        continue;
      }
      let answers = op.inlined;
      if (answers.length === 0 && op.responsesFile) {
        const f = await call(`download/v1beta/${op.responsesFile}:download?alt=media`);
        if (!f.ok) continue; // the file comes next tick
        answers = parseJsonl(f.text);
      }
      const usage = answers.reduce((u, a) => addUsage(u, a.usage), { ...ZERO_USAGE });
      const firstIngest = b.state !== "ingesting";
      await mutate(admin, null, (s) => (mine(s) ? { next: markBatchIngesting(s, b.id, op.state, usage, new Date(now()).toISOString(), op.error), out: true } : null));
      const byKey = new Map(answers.map((a) => [a.key, a] as const));
      const snapNow = (await readEnrichBatch(admin)).state;
      const queuedBy = snapNow.queuedBy;
      let doneHere = 0;
      let failedHere = 0;
      for (const key of batchPendingKeys(snapNow, b.id)) {
        if (now() > deadline) break;
        const item = snapNow.items.find((i) => i.key === key);
        const got = readAnswer(byKey.get(key));
        let outcome: { ok: true; saved: number } | { ok: false; error: string };
        if (!got.ok || !item?.req) {
          outcome = { ok: false, error: got.ok ? "The saved request for this product was missing." : got.error };
        } else {
          try {
            const r = await storeAllFieldsResult(key, item.req, got.value, queuedBy, b.model, " · overnight batch");
            outcome = r.saved.length ? { ok: true, saved: r.saved.length } : { ok: false, error: "Google's answer had nothing usable for any field." };
          } catch (err) {
            outcome = { ok: false, error: `The drafts could not be saved: ${short(err)}` };
          }
        }
        if (outcome.ok) doneHere += 1;
        else failedHere += 1;
        await mutate(admin, null, (s) => (mine(s) ? { next: finishBatchItem(s, b.id, key, outcome), out: true } : null));
      }
      stored += doneHere;
      failedAnswers += failedHere;
      const closed = await mutate(admin, null, (s) => {
        if (!mine(s)) return null;
        const next = closeBatchIfDrained(s, b.id);
        return { next, out: next.batches.find((x) => x.id === b.id)?.state === "done" };
      });
      if (firstIngest) {
        await logAiUsage({ feature: "product.all_fields.batch", entityType: "enrich_batch", entityId: b.id, model: b.model, promptTokens: usage.promptTokens, completionTokens: usage.outputTokens, totalTokens: usage.promptTokens + usage.outputTokens, estimated: false, ok: op.state === "succeeded", errorNote: `overnight batch ${b.name}: ${op.state}, ${answers.length} answers` }).catch(() => {});
      }
      if (closed) {
        const fin = (await readEnrichBatch(admin)).state.batches.find((x) => x.id === b.id);
        await recordAudit({ actorId: queuedBy, action: ENRICH_BATCH_AUDIT.ingested, entityType: "product", entityId: null, after: { batch: b.name, google: op.state, answered: fin?.answered ?? doneHere, failed: fin?.failed ?? failedHere, promptTokens: usage.promptTokens, outputTokens: usage.outputTokens } }).catch(() => {});
      }
    }

    // 3. SEND the queued products as one batch.
    if (now() < deadline) {
      const pick = pickToSend((await readEnrichBatch(admin)).state, now());
      why = pick.why;
      if (pick.keys.length) {
        const model = enrichBatchModel();
        const profile = resolveGeminiModel(model);
        const level = clampThinkingLevel(profile, parseThinkingWanted(process.env.AI_ENRICH_REASONING_EFFORT) ?? "medium");
        const jsonSchema = toResponseFormat(productAllFieldsSchema).json_schema.schema;
        const built = new Map<string, BatchItemReq>();
        const entries: { key: string; request: Record<string, unknown> }[] = [];
        for (const key of pick.keys) {
          if (now() > deadline) break;
          try {
            const r = await build(key);
            built.set(key, r.req);
            entries.push({ key, request: buildEnrichBatchRequest({ system: r.system, user: r.user, jsonSchema, maxOutputTokens: effectiveMaxOutputTokens(profile, ALL_FIELDS_ANSWER_TOKENS), thinkingLevel: level }) });
          } catch (err) {
            await mutate(admin, null, (s) => (mine(s) ? { next: failBeforeSend(s, key, short(err)), out: true } : null));
          }
        }
        if (entries.length) {
          const batchId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const claimed = await mutate(admin, null, (s) => {
            const c = claimForSend(s, token, batchId, profile.id, built, new Date(now()).toISOString());
            return c ? { next: c.state, out: c.keys } : null;
          });
          const claimedSet = new Set(claimed ?? []);
          const send = entries.filter((e) => claimedSet.has(e.key));
          if (send.length) {
            const res = await call(`v1beta/${batchModelPath(profile.id)}`, { method: "POST", body: JSON.stringify(buildBatchCreateBody(enrichBatchDisplayName(batchId), send)) });
            const op = parseBatchOperation(res.json);
            if (res.ok && op.name) {
              await mutate(admin, null, (s) => ({ next: markBatchAccepted(s, batchId, op.name, new Date(now()).toISOString()), out: true }));
              sent = send.length;
              await recordAudit({ actorId, action: ENRICH_BATCH_AUDIT.sent, entityType: "product", entityId: null, after: { batch: op.name, model: profile.id, products: send.length, thinking: level } }).catch(() => {});
            } else {
              const x = explainGemini(res.status, res.json ?? res.text);
              await mutate(admin, null, (s) => ({ next: returnBatchItems(s, batchId, "refused", `${x.title}: ${x.fix}`, now()), out: true }));
              why = `Google refused the batch: ${x.title}`;
              await recordAudit({ actorId, action: ENRICH_BATCH_AUDIT.stopped, entityType: "product", entityId: null, after: { status: res.status, title: x.title, products: send.length } }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (err) {
    stoppedBecause = short(err);
  }

  const note = batchRunNote({ sent, stored, failedAnswers, why, stoppedBecause });
  try {
    await mutate(admin, null, (s) => ({ next: releaseBatchLease(s, token, new Date(now()).toISOString(), note), out: true }));
  } catch (err) {
    stoppedBecause = stoppedBecause ?? short(err);
  }
  if (stoppedBecause && sent === 0 && stored === 0 && polled === 0) return { ok: false, error: stoppedBecause };
  return { ok: true, sent, stored, failedAnswers, polled, note };
}
