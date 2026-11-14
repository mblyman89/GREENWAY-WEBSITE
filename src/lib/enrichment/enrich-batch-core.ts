/**
 * src/lib/enrichment/enrich-batch-core.ts  (D244 round 2, slice R-3)
 *
 * Owner (verbatim): "I want both options available for the quickly finding
 * results, or batch lookups for over night runs. please build it so I can
 * chose in the enrichment page/ detail. make sure it is clear and obvious
 * which is which and how to use both."
 *
 * Two ways to draft every field of a product with AI:
 *   LIVE       - the existing worker queue (bulk-ai-v2): one normal AI call
 *                per product, results in minutes, normal price.
 *   OVERNIGHT  - this file: the products go to Google's Gemini Batch API as
 *                ONE batch (about half price; Google answers within 24 h,
 *                usually a few hours). The answers are stored through the
 *                SAME re-clamp + compliance + store code as a live draft
 *                (storeAllFieldsResult), so both give identical drafts.
 *
 * State lives in ONE site_settings row (enrichment_batch_ai; no migration),
 * separate from the lookup engine's ai_batches table so its poller never
 * touches these replies. The every-minute worker (/api/cron/lookup-jobs, on
 * an idle tick; no new cron) runs one tick: recover -> poll -> ingest -> send.
 *
 * Safety:
 *   - compare-and-swap writes + one lease (token + 800 s) per tick;
 *   - products are CLAIMED (status "sent", batchId) and the batch record
 *     ("submitting") is written BEFORE Google is called; a run killed in
 *     between is recovered by finding the batch by its display name at
 *     Google (adopt it) or, if Google never got it, re-queuing the products;
 *   - Google refusing a batch puts its products back untouched and waits
 *     REFUSE_BACKOFF_MS before trying again (never a hot retry loop);
 *   - a product with no usable answer is re-queued once, then failed with
 *     the plain reason; an expired / cancelled batch saves what it has.
 * Nothing is accepted or published here: each field is a pending draft.
 *
 * Pure: no I/O. Self-tests registered in run-pure-selftests.ts.
 */

import type { PotencyReading } from "./lot-evidence-core";

export const ENRICH_BATCH_KEY = "enrichment_batch_ai";
export const ENRICH_BATCH_LABEL = "Product enrichment: overnight Gemini batch drafts (D244 R-3)";
export const ENRICH_BATCH_AUDIT = {
  queued: "product.enrich_batch_queued",
  canceled: "product.enrich_batch_canceled",
  sent: "product.enrich_batch_sent",
  ingested: "product.enrich_batch_ingested",
  stopped: "product.enrich_batch_stopped",
} as const;

/** Products one press may add (a whole vendor or more). */
export const ENRICH_BATCH_MAX_QUEUE = 1500;
/** Products per Gemini batch (inline requests; well under Google's 20 MB). */
export const ENRICH_BATCH_SEND_MAX = 200;
/** Batches waiting at Google at once. */
export const ENRICH_BATCH_MAX_OPEN = 3;
/** A press is gathered for this long so several presses go as one batch. */
export const ENRICH_BATCH_GATHER_MS = 2 * 60_000;
/** After Google refuses a batch, wait this long before sending again. */
export const ENRICH_BATCH_REFUSE_BACKOFF_MS = 30 * 60_000;
/** One tick holds the lease this long (>= the route's 800 s). */
export const ENRICH_BATCH_LEASE_MS = 800_000;
/** The worker's budget for one tick. */
export const ENRICH_BATCH_TICK_BUDGET_MS = 420_000;
/** Tries per product (a missing / unusable answer). */
export const ENRICH_BATCH_MAX_ATTEMPTS = 2;
/** Finished product rows kept for the page. */
export const ENRICH_BATCH_KEEP_DONE = 400;
/** Batch records kept for the page. */
export const ENRICH_BATCH_KEEP_RECORDS = 20;
/** Our batches at Google are named with this prefix (not the lookup engine's). */
export const ENRICH_BATCH_PREFIX = "greenway-enrich-";

/** The default overnight model (owner R-1 recommendation). */
export const ENRICH_BATCH_DEFAULT_MODEL = "gemini-4-carbon";
export const ENRICH_BATCH_MODEL_VAR = "AI_ENRICH_BATCH_MODEL";

// ---------------------------------------------------------------------------
// The two modes, in words (ONE source for the Bulk AI page and the product page)
// ---------------------------------------------------------------------------

export type EnrichMode = "live" | "overnight";

export const ENRICH_MODES: Record<EnrichMode, { icon: string; name: string; button: string; when: string; speed: string; price: string; how: string[] }> = {
  live: {
    icon: "⚡",
    name: "Live (right now)",
    button: "⚡ Draft now (live)",
    when: "Use it when you are working on products today and want the drafts in front of you.",
    speed: "Drafts start within a minute; about a dozen products a minute.",
    price: "Normal AI price.",
    how: [
      "Pick a vendor or tick products, then press ⚡ Draft now (live).",
      "Keep working or close the tab; drafts appear in the review grid below within minutes.",
    ],
  },
  overnight: {
    icon: "🌙",
    name: "Overnight batch (cheaper, slower)",
    button: "🌙 Add to the overnight batch",
    when: "Use it for big runs - a whole vendor or the whole menu - that you will review tomorrow.",
    speed: "Google answers within 24 hours, usually a few hours.",
    price: "About half the live price (Google's Gemini Batch API).",
    how: [
      "Pick a vendor or tick products, then press 🌙 Add to the overnight batch.",
      "Products pressed within two minutes of each other go to Google as one batch. Close the tab and go home.",
      "Next morning the drafts are in the review grid below, exactly like live drafts.",
    ],
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type BatchItemStatus = "queued" | "sent" | "done" | "failed" | "canceled";

/** What the answer needs that is not the answer (kept while the product is at Google). */
export type BatchItemReq = { offered: string[]; numbers: { thc: PotencyReading[]; cbd: PotencyReading[] }; summary: string };

export type EnrichBatchItem = {
  key: string;
  name: string;
  vendor: string | null;
  status: BatchItemStatus;
  attempts: number;
  saved: number;
  error: string | null;
  /** When it was queued (ISO). */
  at: string | null;
  batchId: string | null;
  req: BatchItemReq | null;
};

export type BatchRecState = "submitting" | "pending" | "running" | "ingesting" | "done" | "refused" | "lost";

export type EnrichBatchRecord = {
  id: string;
  name: string | null;
  model: string;
  state: BatchRecState;
  /** Google's last word (succeeded / failed / canceled / expired), once final. */
  googleFinal: string | null;
  keys: string[];
  createdAt: string;
  sentAt: string | null;
  finishedAt: string | null;
  error: string | null;
  answered: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
};

export type EnrichBatchState = {
  v: 1;
  items: EnrichBatchItem[];
  batches: EnrichBatchRecord[];
  queuedBy: string | null;
  lastRunAt: string | null;
  lastNote: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  backoffUntil: string | null;
};

export function emptyEnrichBatch(): EnrichBatchState {
  return { v: 1, items: [], batches: [], queuedBy: null, lastRunAt: null, lastNote: null, leaseToken: null, leaseUntil: null, backoffUntil: null };
}

const ITEM_STATUSES: readonly BatchItemStatus[] = ["queued", "sent", "done", "failed", "canceled"];
const REC_STATES: readonly BatchRecState[] = ["submitting", "pending", "running", "ingesting", "done", "refused", "lost"];
const OPEN_REC: ReadonlySet<BatchRecState> = new Set(["submitting", "pending", "running", "ingesting"]);

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const nums = (v: unknown): PotencyReading[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is PotencyReading =>
          !!x &&
          typeof x === "object" &&
          typeof (x as PotencyReading).value === "number" &&
          Number.isFinite((x as PotencyReading).value) &&
          ((x as PotencyReading).unit === "%" || (x as PotencyReading).unit === "mg"),
      ).map((x) => ({ value: x.value, unit: x.unit }))
    : [];
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

function parseReq(v: unknown): BatchItemReq | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = (o.numbers && typeof o.numbers === "object" ? o.numbers : {}) as Record<string, unknown>;
  return { offered: strs(o.offered), numbers: { thc: nums(n.thc), cbd: nums(n.cbd) }, summary: typeof o.summary === "string" ? o.summary : "" };
}

/** Read a stored value defensively: junk -> empty state; bad rows dropped. */
export function parseEnrichBatch(raw: unknown): EnrichBatchState {
  const base = emptyEnrichBatch();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const items: EnrichBatchItem[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const key = str(o.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const status = ITEM_STATUSES.includes(o.status as BatchItemStatus) ? (o.status as BatchItemStatus) : "queued";
    items.push({ key, name: str(o.name) ?? key, vendor: str(o.vendor), status, attempts: int(o.attempts), saved: int(o.saved), error: str(o.error), at: str(o.at), batchId: str(o.batchId), req: parseReq(o.req) });
  }
  const batches: EnrichBatchRecord[] = [];
  for (const b of Array.isArray(r.batches) ? r.batches : []) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const id = str(o.id);
    if (!id) continue;
    batches.push({
      id,
      name: str(o.name),
      model: str(o.model) ?? ENRICH_BATCH_DEFAULT_MODEL,
      state: REC_STATES.includes(o.state as BatchRecState) ? (o.state as BatchRecState) : "pending",
      googleFinal: str(o.googleFinal),
      keys: strs(o.keys),
      createdAt: str(o.createdAt) ?? new Date(0).toISOString(),
      sentAt: str(o.sentAt),
      finishedAt: str(o.finishedAt),
      error: str(o.error),
      answered: int(o.answered),
      failed: int(o.failed),
      promptTokens: int(o.promptTokens),
      outputTokens: int(o.outputTokens),
    });
  }
  return {
    v: 1,
    items,
    batches,
    queuedBy: str(r.queuedBy),
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
    backoffUntil: str(r.backoffUntil),
  };
}

export type BatchQueueRequest = { key: string; name: string; vendor: string | null };

/**
 * Add products. One already queued or at Google is left alone ("already");
 * a finished one is queued again (a fresh draft). Old finished rows beyond
 * KEEP_DONE are trimmed, oldest first.
 */
export function enqueueEnrichBatch(
  s: EnrichBatchState,
  reqs: BatchQueueRequest[],
  actorId: string | null,
  nowIso: string,
): { state: EnrichBatchState; added: number; already: number; capped: boolean } {
  const items = s.items.map((i) => ({ ...i }));
  const byKey = new Map(items.map((i) => [i.key, i] as const));
  let added = 0;
  let already = 0;
  let capped = false;
  const fresh = new Set<string>();
  for (const r of reqs) {
    const key = String(r.key ?? "").trim();
    if (!key || fresh.has(key)) continue;
    fresh.add(key);
    const cur = byKey.get(key);
    if (cur && (cur.status === "queued" || cur.status === "sent")) {
      already += 1;
      continue;
    }
    if (added >= ENRICH_BATCH_MAX_QUEUE) {
      capped = true;
      break;
    }
    const row: EnrichBatchItem = { key, name: r.name || key, vendor: r.vendor ?? null, status: "queued", attempts: 0, saved: 0, error: null, at: nowIso, batchId: null, req: null };
    if (cur) Object.assign(cur, row);
    else {
      items.push(row);
      byKey.set(key, row);
    }
    added += 1;
  }
  const finished = items.filter((i) => i.status === "done" || i.status === "failed" || i.status === "canceled");
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - ENRICH_BATCH_KEEP_DONE)).map((i) => i.key));
  return { state: { ...s, items: items.filter((i) => !drop.has(i.key)), queuedBy: added ? actorId : s.queuedBy }, added, already, capped };
}

/** Cancel every product not yet sent (one already at Google is answered and stored). */
export function cancelQueuedBatch(s: EnrichBatchState): { state: EnrichBatchState; canceled: number } {
  let canceled = 0;
  const items = s.items.map((i) => {
    if (i.status !== "queued") return i;
    canceled += 1;
    return { ...i, status: "canceled" as const };
  });
  return { state: { ...s, items }, canceled };
}

export function openBatches(s: EnrichBatchState): EnrichBatchRecord[] {
  return s.batches.filter((b) => OPEN_REC.has(b.state));
}

export type BatchTickDecision = "go" | "idle" | "leased";

/** Anything to do? (an idle state costs the worker one read) */
export function batchTickDecision(s: EnrichBatchState, nowMs: number): BatchTickDecision {
  const work = s.items.some((i) => i.status === "queued") || openBatches(s).length > 0;
  if (!work) return "idle";
  if (s.leaseToken && s.leaseUntil && Date.parse(s.leaseUntil) > nowMs) return "leased";
  return "go";
}

export function takeBatchLease(s: EnrichBatchState, token: string, nowMs: number): EnrichBatchState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + ENRICH_BATCH_LEASE_MS).toISOString() };
}

export function releaseBatchLease(s: EnrichBatchState, token: string, nowIso: string, note: string): EnrichBatchState {
  if (s.leaseToken !== token) return s;
  return { ...s, leaseToken: null, leaseUntil: null, lastRunAt: nowIso, lastNote: note };
}

/**
 * Which queued products to send now (queue order), or [] with the reason.
 * Gathers presses for GATHER_MS unless a full batch is already waiting.
 */
export function pickToSend(s: EnrichBatchState, nowMs: number): { keys: string[]; why: string } {
  if (s.backoffUntil && Date.parse(s.backoffUntil) > nowMs) return { keys: [], why: "Google refused the last batch; waiting before trying again." };
  if (openBatches(s).length >= ENRICH_BATCH_MAX_OPEN) return { keys: [], why: `${ENRICH_BATCH_MAX_OPEN} batches are already at Google.` };
  const queued = s.items.filter((i) => i.status === "queued");
  if (queued.length === 0) return { keys: [], why: "Nothing is waiting to be sent." };
  const oldest = Math.min(...queued.map((i) => (i.at ? Date.parse(i.at) : 0)));
  if (queued.length < ENRICH_BATCH_SEND_MAX && nowMs - oldest < ENRICH_BATCH_GATHER_MS) return { keys: [], why: "Gathering products for one batch (two minutes)." };
  return { keys: queued.slice(0, ENRICH_BATCH_SEND_MAX).map((i) => i.key), why: "" };
}

/** A product whose facts could not be read is failed with the reason (it never reaches Google). */
export function failBeforeSend(s: EnrichBatchState, key: string, error: string): EnrichBatchState {
  return { ...s, items: s.items.map((i) => (i.key === key && i.status === "queued" ? { ...i, status: "failed" as const, error: error.slice(0, 240) || "Its facts could not be read.", req: null } : i)) };
}

/**
 * Claim the built products for one batch and write its record ("submitting")
 * - BEFORE Google is called. Only still-queued products are claimed. Returns
 * null when nothing could be claimed or the lease was lost.
 */
export function claimForSend(
  s: EnrichBatchState,
  token: string,
  batchId: string,
  model: string,
  built: Map<string, BatchItemReq>,
  nowIso: string,
): { state: EnrichBatchState; keys: string[] } | null {
  if (s.leaseToken !== token) return null;
  const keys: string[] = [];
  const items = s.items.map((i) => {
    const req = built.get(i.key);
    if (!req || i.status !== "queued") return i;
    keys.push(i.key);
    return { ...i, status: "sent" as const, attempts: i.attempts + 1, batchId, req, error: null };
  });
  if (keys.length === 0) return null;
  const rec: EnrichBatchRecord = { id: batchId, name: null, model, state: "submitting", googleFinal: null, keys, createdAt: nowIso, sentAt: null, finishedAt: null, error: null, answered: 0, failed: 0, promptTokens: 0, outputTokens: 0 };
  const batches = [...s.batches, rec].slice(-ENRICH_BATCH_KEEP_RECORDS);
  return { state: { ...s, items, batches }, keys };
}

function updateRec(s: EnrichBatchState, id: string, patch: Partial<EnrichBatchRecord>): EnrichBatchState {
  return { ...s, batches: s.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** Google accepted the batch. */
export function markBatchAccepted(s: EnrichBatchState, id: string, name: string, nowIso: string): EnrichBatchState {
  return updateRec(s, id, { name, state: "pending", sentAt: nowIso });
}

/**
 * Google refused (or never got) the batch: its products go back in line
 * untouched (the try is not counted) and sending waits REFUSE_BACKOFF_MS.
 */
export function returnBatchItems(s: EnrichBatchState, id: string, state: "refused" | "lost", error: string, nowMs: number): EnrichBatchState {
  const items = s.items.map((i) =>
    i.batchId === id && i.status === "sent" ? { ...i, status: "queued" as const, attempts: Math.max(0, i.attempts - 1), batchId: null, req: null, error: null } : i,
  );
  const next = updateRec({ ...s, items }, id, { state, error: error.slice(0, 300), finishedAt: new Date(nowMs).toISOString() });
  return state === "refused" ? { ...next, backoffUntil: new Date(nowMs + ENRICH_BATCH_REFUSE_BACKOFF_MS).toISOString() } : next;
}

/** Google's state while it works (pending / running). */
export function markBatchProgress(s: EnrichBatchState, id: string, state: "pending" | "running"): EnrichBatchState {
  return updateRec(s, id, { state });
}

/** Google finished (any final state): ingest starts. */
export function markBatchIngesting(s: EnrichBatchState, id: string, googleFinal: string, usage: { promptTokens: number; outputTokens: number }, nowIso: string, error: string | null): EnrichBatchState {
  const b = s.batches.find((x) => x.id === id);
  return updateRec(s, id, { state: "ingesting", googleFinal, finishedAt: b?.finishedAt ?? nowIso, promptTokens: usage.promptTokens, outputTokens: usage.outputTokens, error: error ? error.slice(0, 300) : (b?.error ?? null) });
}

export type ItemOutcome = { ok: true; saved: number } | { ok: false; error: string };

/**
 * One product's answer was stored (or was unusable). An unusable answer is
 * re-queued while tries are left, else failed with the reason.
 */
export function finishBatchItem(s: EnrichBatchState, batchId: string, key: string, outcome: ItemOutcome): EnrichBatchState {
  let answered = 0;
  let failedN = 0;
  const items = s.items.map((i) => {
    if (i.key !== key || i.batchId !== batchId || i.status !== "sent") return i;
    if (outcome.ok) {
      answered += 1;
      return { ...i, status: "done" as const, saved: outcome.saved, error: null, req: null };
    }
    failedN += 1;
    const err = outcome.error.slice(0, 240) || "Google sent no usable answer.";
    return i.attempts >= ENRICH_BATCH_MAX_ATTEMPTS
      ? { ...i, status: "failed" as const, error: err, req: null, batchId }
      : { ...i, status: "queued" as const, error: err, req: null, batchId: null };
  });
  const b = s.batches.find((x) => x.id === batchId);
  return b ? updateRec({ ...s, items }, batchId, { answered: b.answered + answered, failed: b.failed + failedN }) : { ...s, items };
}

/** Products of a batch still waiting to be stored. */
export function batchPendingKeys(s: EnrichBatchState, batchId: string): string[] {
  return s.items.filter((i) => i.batchId === batchId && i.status === "sent").map((i) => i.key);
}

/** All of a batch's products are stored or set aside: the record is done. */
export function closeBatchIfDrained(s: EnrichBatchState, batchId: string): EnrichBatchState {
  const b = s.batches.find((x) => x.id === batchId);
  if (!b || b.state !== "ingesting" || batchPendingKeys(s, batchId).length > 0) return s;
  return updateRec(s, batchId, { state: "done" });
}

// ---------------------------------------------------------------------------
// Requests and answers
// ---------------------------------------------------------------------------

export function enrichBatchDisplayName(batchId: string): string {
  return `${ENRICH_BATCH_PREFIX}${batchId}`.slice(0, 120);
}

/** The model for the overnight batch: a Gemini id, else the recommended default. */
export function resolveBatchModel(raw: unknown, liveModel: string): string {
  const pinned = typeof raw === "string" ? raw.trim().replace(/^models\//, "") : "";
  if (/^gemini-/i.test(pinned)) return pinned;
  if (/^gemini-/i.test(liveModel.trim())) return liveModel.trim();
  return ENRICH_BATCH_DEFAULT_MODEL;
}

/**
 * One Gemini generateContent request: the SAME system + user text as the
 * live call, JSON constrained to the all-fields schema, no web search (the
 * draft uses only the evidence we give it), thinking at the given level.
 */
export function buildEnrichBatchRequest(o: { system: string; user: string; jsonSchema: unknown; maxOutputTokens: number; thinkingLevel: string | null }): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema: o.jsonSchema,
    maxOutputTokens: Math.max(1024, Math.floor(o.maxOutputTokens)),
  };
  if (o.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: o.thinkingLevel };
  return {
    contents: [{ role: "user", parts: [{ text: o.user }] }],
    systemInstruction: { parts: [{ text: o.system }] },
    generationConfig,
  };
}

/** The reply text -> JSON (code fences / stray prose around the object tolerated), or null. */
export function parseAnswerJson(text: string): unknown {
  const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Words for the page
// ---------------------------------------------------------------------------

export type BatchCounts = { queued: number; sent: number; done: number; failed: number; canceled: number; total: number };

export function batchCounts(s: EnrichBatchState): BatchCounts {
  const c: BatchCounts = { queued: 0, sent: 0, done: 0, failed: 0, canceled: 0, total: s.items.length };
  for (const i of s.items) c[i.status] += 1;
  return c;
}

export function batchProgressText(s: EnrichBatchState): string {
  const c = batchCounts(s);
  if (c.total === 0) return "Nothing in the overnight batch. Pick products or a vendor and press 🌙 Add to the overnight batch.";
  const parts = [`${c.done} drafted`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.canceled) parts.push(`${c.canceled} canceled`);
  if (c.queued + c.sent === 0) return `Finished: ${parts.join(" · ")}.`;
  const head = [c.queued ? `${c.queued} waiting to be sent` : null, c.sent ? `${c.sent} at Google` : null].filter(Boolean).join(" · ");
  return `${head} · ${parts.join(" · ")}. Google answers within 24 hours (usually a few); you can close this tab.`;
}

function ago(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return "";
  const m = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

/** One line per batch record. */
export function batchRecordLine(b: EnrichBatchRecord, nowMs: number): string {
  const n = `${b.keys.length} product${b.keys.length === 1 ? "" : "s"}`;
  switch (b.state) {
    case "submitting":
      return `Sending ${n} to Google…`;
    case "pending":
      return `${n} sent ${ago(b.sentAt, nowMs)} · waiting in Google's line (${b.model}).`;
    case "running":
      return `${n} sent ${ago(b.sentAt, nowMs)} · Google is drafting them now (${b.model}).`;
    case "ingesting":
      return `Google finished (${b.googleFinal ?? "done"}) · saving the drafts: ${b.answered} saved so far.`;
    case "done":
      return `${n}: ${b.answered} drafted${b.failed ? `, ${b.failed} without a usable answer` : ""}${b.googleFinal && b.googleFinal !== "succeeded" ? ` (Google: ${b.googleFinal})` : ""}.`;
    case "refused":
      return `Google refused ${n}: ${b.error ?? "no reason given"}. They went back in line.`;
    case "lost":
      return `${n} never reached Google (the send was interrupted). They went back in line.`;
  }
}

/** The product page line: where this product is in the overnight batch (null = not in it). */
export function productBatchLine(s: EnrichBatchState, key: string): string | null {
  const i = s.items.find((x) => x.key === key);
  if (!i) return null;
  if (i.status === "queued") return "🌙 In the overnight batch: waiting to be sent to Google (within a few minutes).";
  if (i.status === "sent") return "🌙 In the overnight batch: at Google now. The drafts appear below when Google answers (within 24 hours).";
  if (i.status === "done") return `🌙 The overnight batch drafted this product (${i.saved} field${i.saved === 1 ? "" : "s"}). Review them below.`;
  if (i.status === "failed") return `🌙 The overnight batch could not draft this product: ${i.error ?? "no reason recorded"}.`;
  return null;
}

export function batchRunNote(r: { sent: number; stored: number; failedAnswers: number; why?: string; stoppedBecause?: string | null }): string {
  const bits: string[] = [];
  if (r.sent) bits.push(`sent ${r.sent} product${r.sent === 1 ? "" : "s"} to Google`);
  if (r.stored) bits.push(`saved drafts for ${r.stored}`);
  if (r.failedAnswers) bits.push(`${r.failedAnswers} without a usable answer`);
  const head = bits.length ? bits.join(", ") : r.why || "nothing to do";
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}.${r.stoppedBecause ? ` Stopped: ${r.stoppedBecause}` : ""}`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runEnrichBatchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`enrich-batch-core FAIL: ${label}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const T0 = Date.parse("2026-02-01T02:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const req: BatchItemReq = { offered: ["pos"], numbers: { thc: [{ value: 24.5, unit: "%" }], cbd: [] }, summary: "s" };

  // parse
  eq(parseEnrichBatch(null), emptyEnrichBatch(), "parse null");
  eq(parseEnrichBatch({ items: [{ key: "a" }, { key: "a" }, { x: 1 }, { key: "b", status: "zzz" }] }).items.map((i) => [i.key, i.status]), [["a", "queued"], ["b", "queued"]], "parse dedupe + junk");
  eq(parseEnrichBatch({ items: [{ key: "a", req: { offered: ["pos", 3], numbers: { thc: [{ value: 1, unit: "%" }, "x", { value: 2, unit: "oz" }, 3] } } }] }).items[0].req, { offered: ["pos"], numbers: { thc: [{ value: 1, unit: "%" }], cbd: [] }, summary: "" }, "parse req defensively");
  eq(parseEnrichBatch({ batches: [{ id: "b1", state: "weird", keys: ["a"] }, { nope: 1 }] }).batches.map((b) => [b.id, b.state]), [["b1", "pending"]], "parse records");

  // enqueue + cancel
  const q = enqueueEnrichBatch(emptyEnrichBatch(), [{ key: "a", name: "A", vendor: "V" }, { key: "b", name: "B", vendor: null }, { key: "a", name: "A", vendor: "V" }], "u", iso(T0));
  eq([q.added, q.already, q.capped, q.state.queuedBy], [2, 0, false, "u"], "enqueue");
  eq(enqueueEnrichBatch(q.state, [{ key: "a", name: "A", vendor: "V" }], "u", iso(T0)).already, 1, "already queued");
  const big = enqueueEnrichBatch(emptyEnrichBatch(), Array.from({ length: ENRICH_BATCH_MAX_QUEUE + 3 }, (_, i) => ({ key: `k${i}`, name: "", vendor: null })), null, iso(T0));
  eq([big.added, big.capped], [ENRICH_BATCH_MAX_QUEUE, true], "queue cap");
  eq(cancelQueuedBatch(q.state).canceled, 2, "cancel queued");

  // decision + lease
  eq(batchTickDecision(emptyEnrichBatch(), T0), "idle", "idle");
  eq(batchTickDecision(q.state, T0), "go", "go");
  let s = takeBatchLease(q.state, "t", T0);
  eq(batchTickDecision(s, T0 + 1000), "leased", "leased");
  eq(batchTickDecision(s, T0 + ENRICH_BATCH_LEASE_MS + 1), "go", "lease expires");
  ok(ENRICH_BATCH_LEASE_MS >= 800_000, "lease outlives the route");

  // gather + pick
  eq(pickToSend(s, T0 + 1000).keys, [], "gathering");
  ok(pickToSend(s, T0 + 1000).why.startsWith("Gathering"), "gathering why");
  eq(pickToSend(s, T0 + ENRICH_BATCH_GATHER_MS).keys, ["a", "b"], "sent after gather");
  eq(pickToSend({ ...s, backoffUntil: iso(T0 + ENRICH_BATCH_GATHER_MS + 5) }, T0 + ENRICH_BATCH_GATHER_MS).keys, [], "back-off holds");

  // claim -> accepted -> ingest
  const T1 = T0 + ENRICH_BATCH_GATHER_MS;
  eq(claimForSend(s, "other", "B1", "gemini-4-carbon", new Map([["a", req]]), iso(T1)), null, "claim needs the lease");
  s = failBeforeSend(s, "b", "This product is not on the live menu any more.");
  eq(s.items[1].status, "failed", "build failure fails before send");
  const c = claimForSend(s, "t", "B1", "gemini-4-carbon", new Map([["a", req], ["b", req]]), iso(T1))!;
  eq(c.keys, ["a"], "only queued products are claimed");
  s = c.state;
  eq([s.items[0].status, s.items[0].attempts, s.items[0].batchId, s.batches[0].state], ["sent", 1, "B1", "submitting"], "claimed before Google");
  ok(batchRecordLine(s.batches[0], T1).startsWith("Sending 1 product"), "submitting line");
  eq(productBatchLine(s, "a")?.includes("at Google now"), true, "product line at Google");
  s = markBatchAccepted(s, "B1", "batches/xyz", iso(T1));
  eq([s.batches[0].name, s.batches[0].state], ["batches/xyz", "pending"], "accepted");
  ok(batchRecordLine(s.batches[0], T1 + 90 * 60_000).includes("1 h 30 min ago"), "pending line ago");
  eq(pickToSend(enqueueEnrichBatch(s, [{ key: "z", name: "Z", vendor: null }], null, iso(T0)).state, T1).keys, ["z"], "a new product can go while a batch waits");
  s = markBatchIngesting(s, "B1", "succeeded", { promptTokens: 10, outputTokens: 5 }, iso(T1 + 1), null);
  s = finishBatchItem(s, "B1", "a", { ok: true, saved: 9 });
  eq([s.items[0].status, s.items[0].saved, s.items[0].req, s.batches[0].answered], ["done", 9, null, 1], "stored");
  s = closeBatchIfDrained(s, "B1");
  eq(s.batches[0].state, "done", "drained -> done");
  eq(batchTickDecision(s, T1 + ENRICH_BATCH_LEASE_MS + 1), "idle", "all done -> idle");

  // a bad answer is retried once, then failed
  let r = claimForSend(takeBatchLease(enqueueEnrichBatch(emptyEnrichBatch(), [{ key: "p", name: "P", vendor: null }], null, iso(T0)).state, "t", T0), "t", "B2", "m", new Map([["p", req]]), iso(T0))!.state;
  r = finishBatchItem(markBatchIngesting(r, "B2", "succeeded", { promptTokens: 0, outputTokens: 0 }, iso(T0), null), "B2", "p", { ok: false, error: "no answer" });
  eq([r.items[0].status, r.items[0].batchId, r.items[0].error], ["queued", null, "no answer"], "first bad answer re-queued");
  r = claimForSend(r, "t", "B3", "m", new Map([["p", req]]), iso(T0))!.state;
  r = finishBatchItem(markBatchIngesting(r, "B3", "expired", { promptTokens: 0, outputTokens: 0 }, iso(T0), null), "B3", "p", { ok: false, error: "expired" });
  eq([r.items[0].status, r.items[0].attempts], ["failed", 2], "second bad answer fails");

  // refused / lost -> back in line, try not counted
  let f = claimForSend(takeBatchLease(enqueueEnrichBatch(emptyEnrichBatch(), [{ key: "p", name: "P", vendor: null }], null, iso(T0)).state, "t", T0), "t", "B4", "m", new Map([["p", req]]), iso(T0))!.state;
  f = returnBatchItems(f, "B4", "refused", "quota", T0);
  eq([f.items[0].status, f.items[0].attempts, f.batches[0].state, f.backoffUntil], ["queued", 0, "refused", iso(T0 + ENRICH_BATCH_REFUSE_BACKOFF_MS)], "refused -> back + back-off");
  eq(returnBatchItems(claimForSend(f, "t", "B5", "m", new Map([["p", req]]), iso(T0))!.state, "B5", "lost", "x", T0).backoffUntil, f.backoffUntil, "lost does not add back-off");

  // requests + answers + words
  const b = buildEnrichBatchRequest({ system: "S", user: "U", jsonSchema: { type: "object" }, maxOutputTokens: 500, thinkingLevel: "medium" });
  eq(b.generationConfig, { responseMimeType: "application/json", responseJsonSchema: { type: "object" }, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "medium" } }, "request config");
  ok(!("tools" in b), "no web search in an enrichment draft");
  eq(parseAnswerJson('```json\n{"a":1}\n```'), { a: 1 }, "fenced json");
  eq(parseAnswerJson('Here: {"a":2} thanks'), { a: 2 }, "json in prose");
  eq(parseAnswerJson("nope"), null, "not json");
  eq([resolveBatchModel(" models/gemini-3.8-flash ", "gpt-6.1-sol"), resolveBatchModel("", "gemini-4-argon"), resolveBatchModel("gpt-6", "gpt-6.1-sol")], ["gemini-3.8-flash", "gemini-4-argon", ENRICH_BATCH_DEFAULT_MODEL], "batch model");
  eq(enrichBatchDisplayName("abc"), "greenway-enrich-abc", "display name");
  ok(!enrichBatchDisplayName("abc").startsWith("greenway-lookups-"), "never the lookup engine's prefix");
  ok(batchProgressText(q.state).startsWith("2 waiting to be sent"), "progress text");
  eq(batchRunNote({ sent: 3, stored: 0, failedAnswers: 0 }), "Sent 3 products to Google.", "run note");
  eq(batchRunNote({ sent: 0, stored: 0, failedAnswers: 0, why: "gathering products" }), "Gathering products.", "run note why");
  ok(ENRICH_MODES.live.name !== ENRICH_MODES.overnight.name && ENRICH_MODES.overnight.price.includes("half"), "two clearly different modes");

  return { passed, failed };
}
