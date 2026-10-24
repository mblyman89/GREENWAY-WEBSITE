/**
 * R74 S34 - Gemini Batch API lookups (pure core; no I/O).
 *
 * Owner (round 15): "Ideally I'd like to get them all done before the price
 * doubles in January ... I have about 95 vendors I think, 2700 unique lots
 * ... several are the same product, just a use second or third, or is a
 * variant in size so the same product with the same facts."
 *
 * What this core decides:
 *   1. productFamilyKey - lots of the same product (a 2nd/3rd lot, or a size
 *      variant: 1g / 3.5g / 28g, 2pk / 10pk) share ONE key, so ONE Gemini
 *      question answers them all (the answer fans out to every lot).
 *   2. buildBatchRequest / buildBatchCreateBody - a generateContent request
 *      (google_search only, low thinking) and the inline batch body
 *      (models/{model}:batchGenerateContent, < 20 MB inline).
 *   3. parseBatchOperation / readGenerateContentResponse - the batch state
 *      (JOB_STATE_* or BATCH_STATE_*) and each keyed answer: text (thought
 *      parts skipped), grounded source URLs, search query count, tokens.
 *   4. batchCostCents - the estimate at Batch prices (half of standard):
 *      $0.375 / 1M input, $1.875 / 1M output + thinking, $14 / 1,000 search
 *      queries (the free 5,000 a month are not subtracted - an upper bound).
 *   5. lookupEngine - AI_LOOKUP_ENGINE=batch switches the background lookup
 *      from one live call per product to the Batch API. Default "live".
 */

export const AI_LOOKUP_ENGINE_ENV = "AI_LOOKUP_ENGINE";
export const AI_BATCH_MAX_INFLIGHT_ENV = "AI_BATCH_MAX_INFLIGHT";
export type LookupEngine = "live" | "batch";

export function lookupEngine(raw: unknown): LookupEngine {
  return typeof raw === "string" && raw.trim().toLowerCase() === "batch" ? "batch" : "live";
}

/** Products (families) per submitted batch. ~6 KB each -> ~1.2 MB inline, far under 20 MB. */
export const BATCH_MAX_FAMILIES = 200;
/** Queued products read per submit (they collapse into <= BATCH_MAX_FAMILIES families). */
export const BATCH_SCAN_ITEMS = 900;
export const BATCH_MAX_INFLIGHT_DEFAULT = 4;

export function batchMaxInflight(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : BATCH_MAX_INFLIGHT_DEFAULT;
  return Math.min(50, Math.max(1, n));
}

// ─── 1. Product families ────────────────────────────────────────────────────

const SIZE_RE =
  /\b\d+(?:\.\d+)?\s*(?:g|gr|gram|grams|mg|ml|oz|ounce|ounces|lb|kg|pk|pack|ct|count|pc|pcs|piece|pieces|x)\b|\b(?:eighth|quarter|half|ounce|single|multi|2-?pack|pre-?pack)\b|\b\d+\s*\/\s*\d+\b|\b\d+\s*x\s*\d+(?:\.\d+)?\s*g?\b/gi;
const NOISE_RE = /\b(?:lot|batch|harvest|sku|test|retail|sample|qa|units?)\b\s*[#:]?\s*[\w-]*/gi;

export function normalizeFamilyText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(NOISE_RE, " ")
    .replace(SIZE_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One key per real product: brand (or vendor) + the name without size / lot noise. "" = cannot group. */
export function productFamilyKey(o: { brand?: unknown; vendor?: unknown; productName?: unknown; category?: unknown }): string {
  const name = normalizeFamilyText(o.productName);
  if (name.length < 2) return "";
  const who = normalizeFamilyText(o.brand) || normalizeFamilyText(o.vendor);
  const cat = normalizeFamilyText(o.category).split(" ")[0] ?? "";
  return `${who}|${cat}|${name}`.slice(0, 240);
}

/** Group keyed items; an empty key stands alone (its own family, keyed by the item). */
export function groupFamilies<T extends { itemId: string; key: string }>(items: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = it.key ? `f:${it.key}` : `i:${it.itemId}`;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

// ─── 2. Requests ────────────────────────────────────────────────────────────

export type BatchRequest = Record<string, unknown>;

export function buildBatchRequest(o: { system: string; user: string; maxOutputTokens: number; thinkingLevel: string }): BatchRequest {
  return {
    contents: [{ role: "user", parts: [{ text: o.user }] }],
    systemInstruction: { parts: [{ text: o.system }] },
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: Math.max(1024, Math.floor(o.maxOutputTokens)), thinkingConfig: { thinkingLevel: o.thinkingLevel } },
  };
}

export function buildBatchCreateBody(displayName: string, entries: readonly { key: string; request: BatchRequest }[]): Record<string, unknown> {
  return {
    batch: {
      displayName: displayName.slice(0, 120),
      inputConfig: { requests: { requests: entries.map((e) => ({ request: e.request, metadata: { key: e.key } })) } },
    },
  };
}

export function batchModelPath(model: string): string {
  const m = model.trim().replace(/^models\//, "");
  return `models/${m}:batchGenerateContent`;
}

// ─── 3. Responses ───────────────────────────────────────────────────────────

export type BatchState = "pending" | "running" | "succeeded" | "failed" | "canceled" | "expired" | "unknown";

export function normalizeBatchState(raw: unknown): BatchState {
  const s = typeof raw === "string" ? raw.toUpperCase().replace(/^(JOB_STATE_|BATCH_STATE_)/, "") : "";
  if (s === "PENDING" || s === "QUEUED") return "pending";
  if (s === "RUNNING") return "running";
  if (s === "SUCCEEDED") return "succeeded";
  if (s === "FAILED") return "failed";
  if (s === "CANCELLED" || s === "CANCELED") return "canceled";
  if (s === "EXPIRED") return "expired";
  return "unknown";
}

export function isFinalBatchState(s: BatchState): boolean {
  return s === "succeeded" || s === "failed" || s === "canceled" || s === "expired";
}

export type BatchUsage = { promptTokens: number; outputTokens: number; searchQueries: number };
export type KeyedAnswer = { key: string; text: string; sources: string[]; usage: BatchUsage; error: string | null; truncated: boolean };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** One generateContent response -> text (no thought parts), grounded URLs, usage. */
export function readGenerateContentResponse(resp: unknown): Omit<KeyedAnswer, "key" | "error"> {
  const r = obj(resp);
  const cand = obj(Array.isArray(r.candidates) ? r.candidates[0] : null);
  const parts = Array.isArray(obj(cand.content).parts) ? (obj(cand.content).parts as unknown[]) : [];
  const text = parts
    .map(obj)
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => String(p.text))
    .join("")
    .trim();
  const gm = obj(cand.groundingMetadata);
  const sources: string[] = [];
  for (const c of Array.isArray(gm.groundingChunks) ? gm.groundingChunks : []) {
    const uri = obj(obj(c).web).uri;
    if (typeof uri === "string" && /^https?:\/\//.test(uri) && !sources.includes(uri)) sources.push(uri);
  }
  const u = obj(r.usageMetadata);
  return {
    text,
    sources: sources.slice(0, 40),
    usage: {
      promptTokens: num(u.promptTokenCount) + num(u.toolUsePromptTokenCount),
      outputTokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
      searchQueries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.length : 0,
    },
    truncated: cand.finishReason === "MAX_TOKENS",
  };
}

/** One inline / JSONL result line ({ key | metadata.key, response | error }). */
export function readKeyedLine(line: unknown): KeyedAnswer | null {
  const l = obj(line);
  const key = typeof l.key === "string" ? l.key : typeof obj(l.metadata).key === "string" ? String(obj(l.metadata).key) : "";
  if (!key) return null;
  if (l.error) {
    const e = obj(l.error);
    return { key, text: "", sources: [], usage: { promptTokens: 0, outputTokens: 0, searchQueries: 0 }, error: String(e.message ?? e.status ?? "error").slice(0, 200), truncated: false };
  }
  return { key, error: null, ...readGenerateContentResponse(l.response) };
}

export type BatchOperation = { name: string; state: BatchState; inlined: KeyedAnswer[]; responsesFile: string | null; error: string | null };

/** GET batches/{id} (or the create reply) -> name, state, inline answers or the results file. */
export function parseBatchOperation(payload: unknown): BatchOperation {
  const p = obj(payload);
  const meta = obj(p.metadata);
  const out = obj(p.response ?? meta.output ?? p.output);
  const name = typeof p.name === "string" ? p.name : typeof meta.name === "string" ? String(meta.name) : "";
  const state = normalizeBatchState(meta.state ?? p.state);
  const inl = obj(out.inlinedResponses);
  const lines = Array.isArray(inl.inlinedResponses) ? inl.inlinedResponses : Array.isArray(out.inlinedResponses) ? (out.inlinedResponses as unknown[]) : [];
  const inlined = lines.map(readKeyedLine).filter((x): x is KeyedAnswer => x !== null);
  const responsesFile = typeof out.responsesFile === "string" ? out.responsesFile : null;
  const err = p.error ? String(obj(p.error).message ?? "batch failed").slice(0, 300) : null;
  return { name, state: p.done === true && state === "unknown" ? (err ? "failed" : "succeeded") : state, inlined, responsesFile, error: err };
}

export function parseJsonl(text: string): KeyedAnswer[] {
  const out: KeyedAnswer[] = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    try {
      const a = readKeyedLine(JSON.parse(t));
      if (a) out.push(a);
    } catch {
      /* a broken line is skipped; its products are requeued by the ingest */
    }
  }
  return out;
}

// ─── 4. Cost ────────────────────────────────────────────────────────────────

export const BATCH_PRICE = { inputPerM: 0.375, outputPerM: 1.875, searchPerK: 14 } as const;

/** Estimated cents at Batch prices (an upper bound: the monthly free searches are not subtracted). */
export function batchCostCents(u: BatchUsage): number {
  const usd = (u.promptTokens / 1e6) * BATCH_PRICE.inputPerM + (u.outputTokens / 1e6) * BATCH_PRICE.outputPerM + (u.searchQueries / 1000) * BATCH_PRICE.searchPerK;
  return Math.round(usd * 10000) / 100;
}

export function addUsage(a: BatchUsage, b: BatchUsage): BatchUsage {
  return { promptTokens: a.promptTokens + b.promptTokens, outputTokens: a.outputTokens + b.outputTokens, searchQueries: a.searchQueries + b.searchQueries };
}

export const ZERO_USAGE: BatchUsage = { promptTokens: 0, outputTokens: 0, searchQueries: 0 };

/** A batch that ended without answers: its products go back in the queue. */
export const BATCH_REQUEUE_NOTE = "The Gemini batch did not finish this product. It is queued again.";

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runGeminiBatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`gemini-batch-core FAIL: ${label}`);
    }
  };
  ok(lookupEngine("batch") === "batch" && lookupEngine(" BATCH ") === "batch" && lookupEngine(undefined) === "live" && lookupEngine("x") === "live", "engine switch");
  ok(batchMaxInflight(undefined) === 4 && batchMaxInflight("9") === 9 && batchMaxInflight("0") === 1 && batchMaxInflight("999") === 50 && batchMaxInflight("x") === 4, "inflight");
  const k1 = productFamilyKey({ brand: "Phat Panda", productName: "Gelato 3.5g", category: "Flower" });
  const k2 = productFamilyKey({ brand: "Phat Panda", productName: "Gelato - 28g (Lot #A12)", category: "flower" });
  const k3 = productFamilyKey({ brand: "Phat Panda", productName: "Gelato 1g", category: "Flower" });
  ok(k1 !== "" && k1 === k2 && k2 === k3, "size / lot variants share a family");
  ok(productFamilyKey({ brand: "Phat Panda", productName: "Gelato 3.5g", category: "Pre-Roll" }) !== k1, "category splits families");
  ok(productFamilyKey({ brand: "Other", productName: "Gelato 3.5g", category: "Flower" }) !== k1, "brand splits families");
  ok(productFamilyKey({ brand: "Phat Panda", productName: "Blue Dream 3.5g", category: "Flower" }) !== k1, "strain splits families");
  ok(productFamilyKey({ vendor: "V", productName: "Gummies 10pk 100mg" }) === productFamilyKey({ vendor: "V", productName: "Gummies 2pk 20mg" }), "pack + mg variants share");
  ok(productFamilyKey({ brand: "B", productName: "" }) === "" && productFamilyKey({ brand: "B", productName: "3.5g" }) === "", "no name = no family");
  const g = groupFamilies([{ itemId: "a", key: k1 }, { itemId: "b", key: k2 }, { itemId: "c", key: "" }, { itemId: "d", key: "" }]);
  ok(g.size === 3 && g.get(`f:${k1}`)?.length === 2 && g.has("i:c") && g.has("i:d"), "grouping; ungroupable stand alone");
  const rq = buildBatchRequest({ system: "S", user: "U", maxOutputTokens: 500, thinkingLevel: "low" });
  ok(JSON.stringify(rq.tools) === '[{"googleSearch":{}}]', "search only (no url_context)");
  ok((rq.generationConfig as { maxOutputTokens: number; thinkingConfig: { thinkingLevel: string } }).maxOutputTokens === 1024 && (rq.generationConfig as { thinkingConfig: { thinkingLevel: string } }).thinkingConfig.thinkingLevel === "low", "floor + thinking");
  const body = buildBatchCreateBody("x".repeat(300), [{ key: "f1", request: rq }]) as { batch: { displayName: string; inputConfig: { requests: { requests: { metadata: { key: string } }[] } } } };
  ok(body.batch.displayName.length === 120 && body.batch.inputConfig.requests.requests[0].metadata.key === "f1", "create body");
  ok(batchModelPath("models/gemini-3.8-flash") === "models/gemini-3.8-flash:batchGenerateContent" && batchModelPath(" gemini-x ") === "models/gemini-x:batchGenerateContent", "model path");
  ok(normalizeBatchState("JOB_STATE_SUCCEEDED") === "succeeded" && normalizeBatchState("BATCH_STATE_RUNNING") === "running" && normalizeBatchState("JOB_STATE_CANCELLED") === "canceled" && normalizeBatchState(5) === "unknown", "states");
  ok(isFinalBatchState("expired") && !isFinalBatchState("running") && !isFinalBatchState("unknown"), "final states");
  const resp = {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking", thought: true }, { text: '{"a":' }, { text: "1}" }] }, groundingMetadata: { webSearchQueries: ["q1", "q2"], groundingChunks: [{ web: { uri: "https://a.com/x" } }, { web: { uri: "https://a.com/x" } }, { web: { uri: "javascript:1" } }] } }],
    usageMetadata: { promptTokenCount: 1000, toolUsePromptTokenCount: 500, candidatesTokenCount: 300, thoughtsTokenCount: 200 },
  };
  const r = readGenerateContentResponse(resp);
  ok(r.text === '{"a":1}' && r.sources.length === 1 && r.usage.searchQueries === 2, "answer text, deduped sources, queries");
  ok(r.usage.promptTokens === 1500 && r.usage.outputTokens === 500 && r.truncated === false, "usage");
  const op = parseBatchOperation({ name: "batches/1", metadata: { state: "JOB_STATE_SUCCEEDED" }, done: true, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: "f1" }, response: resp }, { metadata: { key: "f2" }, error: { message: "bad" } }, { response: resp }] } } });
  ok(op.name === "batches/1" && op.state === "succeeded" && op.inlined.length === 2 && op.inlined[0].text === '{"a":1}' && op.inlined[1].error === "bad", "operation parse");
  ok(parseBatchOperation({ name: "batches/2", metadata: { state: "BATCH_STATE_SUCCEEDED", output: { responsesFile: "files/abc" } } }).responsesFile === "files/abc", "results file");
  ok(parseBatchOperation({ name: "b", done: true, error: { message: "boom" } }).state === "failed" && parseBatchOperation(null).state === "unknown", "error / junk");
  const jl = parseJsonl(`${JSON.stringify({ key: "f1", response: resp })}\n\nnot json\n${JSON.stringify({ key: "f2", error: { status: "X" } })}`);
  ok(jl.length === 2 && jl[0].key === "f1" && jl[1].error === "X", "jsonl");
  ok(batchCostCents({ promptTokens: 1_000_000, outputTokens: 1_000_000, searchQueries: 1000 }) === 1625, "cost at batch prices");
  ok(batchCostCents(ZERO_USAGE) === 0 && addUsage({ promptTokens: 1, outputTokens: 2, searchQueries: 3 }, { promptTokens: 1, outputTokens: 1, searchQueries: 1 }).searchQueries === 4, "zero + add");
  return { passed, failed };
}
