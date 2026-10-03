/**
 * src/lib/catalog/lookup-job-core.ts   (bible SLICE S13, Phase 2, Ring 1)
 *
 * "Look up everything on this manifest" as a background job. PURE: no I/O,
 * no environment reads, no clock. The server runner
 * (lookup-job-server.ts) and the cron route (/api/cron/lookup-jobs) only do
 * reads and writes; every decision is here, where it can be proven.
 *
 * WHY A SERVER-SIDE JOB AND NOT A CLIENT LOOP. The bible's acceptance line is
 * "A 40-line manifest is fully looked up with one click and no browser tab
 * kept open". A client-driven chunk runner (the H12g pattern) needs the tab
 * open, so it cannot meet that line. A Vercel Pro cron can (AGENTS rule 12:
 * Pro crons may run once a minute; Vercel docs "Configuring Maximum Duration":
 * Pro maximum 800 s per function, read 2026-10-01).
 *
 * WHY THE CLAIMS. AGENTS rule 12: Vercel may deliver a tick twice, a run
 * that outlasts its interval overlaps the next, and a failed invocation is not
 * retried. So:
 *   - a run takes a LEASE on one job with a compare-and-swap (one runner per
 *     job; a second tick finds it leased and exits after one read);
 *   - each item is CLAIMED with a compare-and-swap on (status, attempts);
 *   - an item left "running" by a killed run is an ORPHAN: the next lease
 *     holder requeues it once, then fails it with a plain reason
 *     (orphanDecision). One skipped tick loses nothing.
 *
 * WHAT ONE ITEM DOES (the same path as the per-row AI Lookup + Save selected):
 *   KB-first recall (S09) -> if every field is on file, no web call at all;
 *   otherwise one web lookup asking only for the gaps -> attachProductFacts
 *   (S07) under the attach policy (S10): 90%+ facts attach in the act ring,
 *   everything else becomes a pending suggestion for a person. Nothing below
 *   90% is ever written to a record (bible 3.1).
 *
 * ROLLBACK (bible S13.7 "Feature flag; per-row lookup remains"):
 * MANIFEST_BATCH_LOOKUP=off hides the button and the progress panel, and the
 * cron returns before any database read. The per-row lookup never changed.
 */

// ─── Flag ────────────────────────────────────────────────────────────────────

/** Vercel env flag. Unset / anything else = ON; off/0/false/no/disabled = OFF. */
export const MANIFEST_BATCH_LOOKUP_ENV = "MANIFEST_BATCH_LOOKUP";

export function manifestBatchLookupEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// ─── Schema names (migration 0242) ───────────────────────────────────────────

export const LOOKUP_JOBS_TABLE = "lookup_jobs";
export const LOOKUP_JOB_ITEMS_TABLE = "lookup_job_items";

export const JOB_STATUSES = ["queued", "running", "done", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ITEM_STATUSES = ["queued", "running", "done", "failed", "canceled"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
/** A job in one of these blocks a second job for the same manifest (partial unique index). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "running"];

// ─── Time budget (Vercel Pro) ────────────────────────────────────────────────

/** The cron route's maxDuration (Vercel Pro maximum, docs read 2026-10-01). */
export const LOOKUP_TICK_MAX_DURATION_S = 800;
/** Work stops being STARTED after this; leaves 40 s to write the last result. */
export const LOOKUP_TICK_BUDGET_MS = 760_000;
/**
 * The longest one item can take: the web lookup's own abort (provider.ts
 * AI_WEBSEARCH_TIMEOUT_MS default 290 000 ms) plus ~10 s of reads/writes.
 * An item is only started when it can finish inside the budget.
 */
export const LOOKUP_ITEM_WORST_MS = 300_000;
/** Hard cap per run, even when lookups are fast (rate-limit courtesy, S13.8). */
export const LOOKUP_MAX_ITEMS_PER_TICK = 12;

/**
 * Bible S13.8: "Gemini rate limits/timeouts - chunk size configurable".
 * LOOKUP_ITEMS_PER_TICK lowers the per-run cap (1..12). Unset, junk, zero or
 * negative = 12; above 12 is clamped to 12 (the time budget is the real cap).
 */
export const LOOKUP_ITEMS_PER_TICK_ENV = "LOOKUP_ITEMS_PER_TICK";

export function lookupItemsPerTick(raw: string | undefined | null): number {
  const v = String(raw ?? "").trim();
  if (!/^\d+$/.test(v)) return LOOKUP_MAX_ITEMS_PER_TICK;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) return LOOKUP_MAX_ITEMS_PER_TICK;
  return Math.min(n, LOOKUP_MAX_ITEMS_PER_TICK);
}
/** The job lease outlives the function (800 s) so a live run is never overtaken. */
export const LOOKUP_LEASE_MS = 840_000;
/** An item a killed run left "running" is retried once, then failed. */
export const LOOKUP_MAX_ATTEMPTS = 2;
/** One manifest's job never holds more than this many items. */
export const LOOKUP_MAX_JOB_ITEMS = 200;

/** May this run start another item? The first one always may. */
export function canStartItem(input: { elapsedMs: number; startedThisTick: number; maxPerTick?: number }): boolean {
  const started = Number.isFinite(input.startedThisTick) ? Math.max(0, Math.floor(input.startedThisTick)) : 0;
  if (started === 0) return true;
  const cap =
    typeof input.maxPerTick === "number" && Number.isFinite(input.maxPerTick) && input.maxPerTick >= 1
      ? Math.min(Math.floor(input.maxPerTick), LOOKUP_MAX_ITEMS_PER_TICK)
      : LOOKUP_MAX_ITEMS_PER_TICK;
  if (started >= cap) return false;
  const elapsed = Number.isFinite(input.elapsedMs) ? Math.max(0, input.elapsedMs) : Number.POSITIVE_INFINITY;
  return elapsed + LOOKUP_ITEM_WORST_MS <= LOOKUP_TICK_BUDGET_MS;
}

/** Is a job's lease free at `nowMs`? Null / junk / past = free. */
export function leaseIsFree(leaseUntil: string | null | undefined, nowMs: number): boolean {
  if (!leaseUntil) return true;
  const t = Date.parse(leaseUntil);
  if (!Number.isFinite(t)) return true;
  return t <= nowMs;
}

export function leaseUntilIso(nowMs: number): string {
  return new Date(nowMs + LOOKUP_LEASE_MS).toISOString();
}

export const ORPHAN_FAIL_COPY =
  "The lookup was stopped twice before it finished (the server ran out of time). Use AI Lookup on this row instead.";

/** An item still "running" when a run takes the job lease was left by a killed run. */
export function orphanDecision(attempts: unknown): "requeue" | "fail" {
  const n = typeof attempts === "number" && Number.isFinite(attempts) ? attempts : 0;
  return n >= LOOKUP_MAX_ATTEMPTS ? "fail" : "requeue";
}

// ─── Enqueue plan ────────────────────────────────────────────────────────────

export type EnqueuePlan =
  | { kind: "exists"; jobId: string }
  | { kind: "nothing"; reason: string }
  | { kind: "create"; draftIds: string[]; total: number; skippedDone: number; truncated: number };

export const NOTHING_IN_REVIEW_COPY = "Nothing on this manifest is waiting in Needs review, so there is nothing to look up.";
export const ALL_DONE_COPY = "Every product on this manifest waiting in Needs review was already looked up by an earlier batch. Use AI Lookup on a row to ask again.";

/**
 * Which drafts a new job holds. Idempotent by construction:
 *  - an ACTIVE job for the manifest is returned, never doubled (the partial
 *    unique index enforces the same in the database);
 *  - a draft an earlier batch already looked up ("done") is skipped, so
 *    pressing the button again only spends on what is left.
 * Order is the caller's (stable), ids are de-duplicated case-insensitively.
 */
export function planEnqueue(input: {
  reviewDraftIds: readonly unknown[];
  alreadyDoneDraftIds: readonly unknown[];
  activeJobId: string | null | undefined;
}): EnqueuePlan {
  if (input.activeJobId) return { kind: "exists", jobId: input.activeJobId };
  const done = new Set(input.alreadyDoneDraftIds.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()));
  const seen = new Set<string>();
  const ids: string[] = [];
  let skippedDone = 0;
  let any = false;
  for (const raw of input.reviewDraftIds) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const id = raw.trim();
    const k = id.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    any = true;
    if (done.has(k)) {
      skippedDone += 1;
      continue;
    }
    ids.push(id);
  }
  if (!any) return { kind: "nothing", reason: NOTHING_IN_REVIEW_COPY };
  if (ids.length === 0) return { kind: "nothing", reason: ALL_DONE_COPY };
  const kept = ids.slice(0, LOOKUP_MAX_JOB_ITEMS);
  return { kind: "create", draftIds: kept, total: kept.length, skippedDone, truncated: ids.length - kept.length };
}

// ─── One item's result ───────────────────────────────────────────────────────

export type ItemOutcome = "attached" | "review" | "known" | "not_found" | "nothing_new";
export const ITEM_OUTCOMES: readonly ItemOutcome[] = ["attached", "review", "known", "not_found", "nothing_new"];

export interface ItemResult {
  outcome: ItemOutcome;
  /** Facts that landed on a live record (act ring, 90%+). */
  attached: number;
  /** Facts listed for a person (suggestions / review band). */
  queued: number;
  /** The receipt sentence (or the memory notice). */
  sentence: string;
  model: string;
}

/** Decide the outcome from what the lookup and the write door reported. */
export function classifyItem(input: {
  skippedWeb: boolean;
  found: boolean;
  attached: number;
  queued: number;
}): ItemOutcome {
  if (input.skippedWeb) return "known";
  if (input.attached > 0) return "attached";
  if (input.queued > 0) return "review";
  if (!input.found) return "not_found";
  return "nothing_new";
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** Defensive read of result_json (never trusts the stored shape). */
export function parseItemResult(raw: unknown): ItemResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const outcome = typeof r.outcome === "string" && (ITEM_OUTCOMES as readonly string[]).includes(r.outcome) ? (r.outcome as ItemOutcome) : null;
  if (!outcome) return null;
  return {
    outcome,
    attached: count(r.attached),
    queued: count(r.queued),
    sentence: typeof r.sentence === "string" ? r.sentence.slice(0, 600) : "",
    model: typeof r.model === "string" ? r.model.slice(0, 80) : "",
  };
}

/** Plain, short, single-line error for the row (never a stack). */
export function itemErrorText(err: unknown): string {
  const friendly = err && typeof err === "object" && "friendly" in err && typeof (err as { friendly: unknown }).friendly === "string"
    ? (err as { friendly: string }).friendly
    : null;
  const text = friendly ?? (err instanceof Error ? err.message : String(err ?? ""));
  const one = text.replace(/\s+/g, " ").trim();
  return (one || "The lookup could not finish.").slice(0, 240);
}

// ─── Job summary + copy ──────────────────────────────────────────────────────

export interface JobItemView {
  draftId: string;
  status: ItemStatus;
  result: ItemResult | null;
  error: string | null;
  /**
   * Paid AI web lookups this item made (column ai_calls). Stored apart from
   * the result so a lookup that was paid for and then failed still counts.
   */
  aiCalls: number;
}

/** 0 when memory covered the product (or nothing was started), else 1 per web lookup. */
export function aiCallsOf(v: unknown): number {
  return count(v);
}

export interface JobSummary {
  total: number;
  lookedUp: number;
  queued: number;
  running: number;
  failed: number;
  canceled: number;
  attached: number;
  needsEye: number;
  aiCalls: number;
  known: number;
  finished: boolean;
}

/** Does this row need a person? A failure, a not-found, or facts waiting for review. */
export function itemNeedsEye(item: Pick<JobItemView, "status" | "result">): boolean {
  if (item.status === "failed") return true;
  if (item.status !== "done" || !item.result) return false;
  return item.result.queued > 0 || item.result.outcome === "not_found";
}

export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
}
export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);
}

export function summarizeJob(items: readonly JobItemView[]): JobSummary {
  const s: JobSummary = { total: 0, lookedUp: 0, queued: 0, running: 0, failed: 0, canceled: 0, attached: 0, needsEye: 0, aiCalls: 0, known: 0, finished: false };
  for (const it of items) {
    s.total += 1;
    if (it.status === "queued") s.queued += 1;
    else if (it.status === "running") s.running += 1;
    else if (it.status === "canceled") s.canceled += 1;
    else {
      s.lookedUp += 1;
      if (it.status === "failed") s.failed += 1;
    }
    s.aiCalls += aiCallsOf(it.aiCalls);
    if (it.status === "done" && it.result) {
      s.attached += it.result.attached;
      if (it.result.outcome === "known") s.known += 1;
    }
    if (itemNeedsEye(it)) s.needsEye += 1;
  }
  s.finished = s.queued === 0 && s.running === 0;
  return s;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Bible S13.4: "9 of 14 looked up · 31 facts attached · 6 need your eye". */
export function progressLine(s: JobSummary): string {
  const eye = s.needsEye === 1 ? "1 needs your eye" : `${s.needsEye} need your eye`;
  return `${s.lookedUp} of ${s.total} looked up \u00b7 ${plural(s.attached, "fact", "facts")} attached \u00b7 ${eye}`;
}

/** Bible S13.6: "Costs visible: job shows total Gemini calls." */
export function costLine(s: JobSummary, model: string | null): string {
  const who = model && model.trim() ? ` (${model.trim()})` : "";
  const calls = `${plural(s.aiCalls, "paid AI web lookup", "paid AI web lookups")}${who}`;
  return s.known > 0
    ? `${calls} \u00b7 ${plural(s.known, "product was", "products were")} already on file, so no lookup was paid for`
    : calls;
}

/** Bible S13.4 button copy (exact count only; the caller hides the button when unknown). */
export function lookupAllButtonLabel(eligible: number, skippedDone: number): string {
  if (skippedDone > 0) {
    return eligible === 1 ? "Look up the 1 product not looked up yet" : `Look up the ${eligible} products not looked up yet`;
  }
  return eligible === 1 ? "Look up the 1 product on this manifest" : `Look up all ${eligible} products on this manifest`;
}

export const LOOKUP_ALL_HELP =
  "Runs on the server, one product at a time. You can close this tab; refresh to see progress. Facts at 90% or better attach under your attach setting, everything else waits for you.";

export function jobHeadline(status: JobStatus, s: JobSummary): string {
  if (status === "canceled") return "Batch lookup stopped";
  if (status === "done" || s.finished) return "Batch lookup finished";
  if (s.running > 0 || s.lookedUp > 0) return "Batch lookup running";
  return "Batch lookup waiting to start (it starts within a minute)";
}

/** The per-row line on the onboarding table. */
export function itemRowCopy(item: JobItemView): string {
  if (item.status === "queued") return "Batch lookup: waiting";
  if (item.status === "running") return "Batch lookup: looking up now";
  if (item.status === "canceled") return "Batch lookup: stopped";
  if (item.status === "failed") return `Batch lookup failed: ${item.error ?? "unknown reason"}`;
  const r = item.result;
  if (!r) return "Batch lookup: done";
  switch (r.outcome) {
    case "known":
      return "Batch lookup: already on file (no lookup paid)";
    case "attached":
      return `Batch lookup: ${plural(r.attached, "fact", "facts")} attached${r.queued > 0 ? `, ${r.queued} waiting for you` : ""}`;
    case "review":
      return `Batch lookup: ${plural(r.queued, "fact", "facts")} waiting for you - attach them below`;
    case "not_found":
      return "Batch lookup: nothing found on the web";
    default:
      return "Batch lookup: nothing new to add";
  }
}

// ─── Errors and plain copy ──────────────────────────────────────────────────────

export const LOOKUP_MIGRATION_COPY =
  "Batch lookup turns on once migration 0242_lookup_jobs.sql is applied (docs/MIGRATIONS_TO_RUN.md). Until then, use AI Lookup on each row.";
export const LOOKUP_AI_OFF_COPY =
  "AI isn't set up yet, so there is nothing to look up with. Add an AI_API_KEY (or OPENAI_API_KEY) to turn on lookups.";
export const LOOKUP_ATTACH_V2_OFF_COPY =
  "Batch lookup saves through the new fact door, which is turned off (ATTACH_FACTS_V2=off). Use AI Lookup on each row, or turn ATTACH_FACTS_V2 back on.";
export const LOOKUP_FLAG_OFF_COPY = "Batch lookup is turned off (MANIFEST_BATCH_LOOKUP=off). AI Lookup on each row still works.";
export const LEFT_REVIEW_COPY = "Approved or dismissed before its turn, so it was not looked up.";
export const DRAFT_GONE_COPY = "This product draft no longer exists, so it was not looked up.";

// R21 (owner: "I was not able to find the look up all products from a
// manifest on the onboard page. Is the button wired up?"). The button WAS
// wired (lookupAllAction -> lookup_jobs -> /api/cron/lookup-jobs), but the
// section only rendered with ?manifest= in the URL and rendered NOTHING for
// six other states. batchLookupEntry is the one decision: every state either
// shows the button or says in plain words why not and what to do.

export const LOOKUP_UNKNOWN_COUNT_COPY =
  "We could not count this delivery's products just now, so the button is hidden rather than guessing a number. Refresh to try again; AI Lookup on each row still works.";
export const LOOKUP_READ_ERROR_COPY =
  "The batch lookup could not be read just now. Refresh to try again; AI Lookup on each row still works.";
export const LOOKUP_CHOOSE_COPY =
  "Batch lookup works one delivery at a time. Open a delivery below and press \u201cLook up all\u201d at the top of its list.";
export const LOOKUP_CHOOSE_NONE_COPY =
  "No recent delivery has products waiting in Needs review, so there is nothing to look up in bulk right now.";

export type BatchLookupEntryInput = {
  /** A delivery is focused (?manifest=<uuid>). */
  focused: boolean;
  /** The onboarding tab: only Needs review ("draft") can be looked up. */
  view: string;
  flagOn: boolean;
  aiOn: boolean;
  attachOn: boolean;
  /** loadManifestLookup(...).state, or null when it was not read. */
  state: "off" | "migration" | "error" | "none" | "job" | null;
  /** The newest job is queued or running. */
  jobActive: boolean;
  eligible: { count: number; skippedDone: number; truncated: number } | null;
};

export type BatchLookupEntry =
  | { kind: "hidden" }
  | { kind: "choose" }
  | { kind: "reason"; text: string }
  | { kind: "stop" }
  | { kind: "button"; label: string };

export function batchLookupEntry(i: BatchLookupEntryInput): BatchLookupEntry {
  if (i.view !== "draft") return { kind: "hidden" };
  if (!i.flagOn) return { kind: "reason", text: LOOKUP_FLAG_OFF_COPY };
  if (!i.aiOn) return { kind: "reason", text: LOOKUP_AI_OFF_COPY };
  if (!i.focused) return { kind: "choose" };
  if (i.state === "migration") return { kind: "reason", text: LOOKUP_MIGRATION_COPY };
  if (i.state === "off") return { kind: "reason", text: LOOKUP_FLAG_OFF_COPY };
  if (i.state !== "none" && i.state !== "job") return { kind: "reason", text: LOOKUP_READ_ERROR_COPY };
  if (!i.attachOn) return { kind: "reason", text: LOOKUP_ATTACH_V2_OFF_COPY };
  if (i.jobActive) return { kind: "stop" };
  const e = i.eligible;
  if (!e || !Number.isFinite(e.count) || e.count < 0) return { kind: "reason", text: LOOKUP_UNKNOWN_COUNT_COPY };
  if (e.count > 0) return { kind: "button", label: lookupAllButtonLabel(e.count, e.skippedDone) };
  return { kind: "reason", text: e.skippedDone > 0 ? ALL_DONE_COPY : NOTHING_IN_REVIEW_COPY };
}

export type LookupDeliveryChoiceInput = { id: string; label: string; inReview: number | null };
export type LookupDeliveryChoice = LookupDeliveryChoiceInput & { countText: string };
export const LOOKUP_CHOICES_MAX = 8;

/**
 * The unfocused strip: recent deliveries (picker order, newest first) that
 * still have products in Needs review. A delivery whose count could not be
 * read is kept and says so (never hidden, never given an invented number).
 */
export function lookupDeliveryChoices(
  rows: readonly LookupDeliveryChoiceInput[] | null | undefined,
  max: number = LOOKUP_CHOICES_MAX,
): LookupDeliveryChoice[] {
  const out: LookupDeliveryChoice[] = [];
  const seen = new Set<string>();
  const cap = Number.isInteger(max) && max > 0 ? max : LOOKUP_CHOICES_MAX;
  for (const r of rows ?? []) {
    if (out.length >= cap) break;
    if (!r || !isUuid(r.id)) continue;
    const id = r.id.trim().toLowerCase();
    if (seen.has(id)) continue;
    const n = typeof r.inReview === "number" && Number.isFinite(r.inReview) ? r.inReview : null;
    if (n !== null && n <= 0) continue;
    seen.add(id);
    out.push({ id: r.id, label: r.label, inReview: n, countText: n === null ? "count not available" : `${n} in Needs review` });
  }
  return out;
}

// The batch-lookup result travels back in the redirect as ?lookup=<code>
// (&lookup_msg=<plain sentence> for "nothing" / "error"). Closed set: an
// unknown or forged code shows nothing, and the message is length-capped.
export const LOOKUP_RESULT_CODES = ["started", "exists", "nothing", "migration", "error", "stopped", "stop_error"] as const;
export type LookupResultCode = (typeof LOOKUP_RESULT_CODES)[number];

export function lookupBanner(code: unknown, msg: unknown): { tone: "ok" | "info" | "error"; text: string } | null {
  if (typeof code !== "string" || !(LOOKUP_RESULT_CODES as readonly string[]).includes(code)) return null;
  const m = typeof msg === "string" ? msg.trim().slice(0, 300) : "";
  switch (code as LookupResultCode) {
    case "started":
      return { tone: "ok", text: "Batch lookup started. It runs on the server; you can close this tab and come back." };
    case "exists":
      return { tone: "info", text: "A batch lookup is already running for this delivery, so a second one was not started." };
    case "nothing":
      return { tone: "info", text: m || NOTHING_IN_REVIEW_COPY };
    case "migration":
      return { tone: "info", text: LOOKUP_MIGRATION_COPY };
    case "stopped":
      return { tone: "ok", text: m || "Batch lookup stopped." };
    case "stop_error":
      return { tone: "error", text: m || "The batch lookup could not be stopped just now. Try again." };
    default:
      return { tone: "error", text: m || "The batch lookup could not be started just now. Try again." };
  }
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/**
 * True only when the error says one of 0242's tables does not exist (the
 * owner has not applied the migration yet). Word-bounded, so another table's
 * error is never mistaken for ours.
 */
export function isMissingLookupJobsTable(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const tableSignal = MISSING_TABLE_CODES.has(code) || /relation .* does not exist|could not find the table/.test(msg);
  if (!tableSignal) return false;
  return /(^|[^a-z0-9_])lookup_job(s|_items)([^a-z0-9_]|$)/.test(msg);
}

/**
 * Errors the AI layer throws BEFORE any paid request goes out (provider.ts
 * generateWebSearch: the not-configured check and the budget guard run
 * first). Every other lookup failure may have been paid for, so it counts.
 * Matched by name so this file stays free of server imports.
 */
export function isNoSpendError(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "AiBudgetExceededError" || name === "AiNotConfiguredError";
}

/** The budget cap stops the WHOLE job: every later product would be refused the same way. */
export function stopsWholeJob(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "AiBudgetExceededError" || name === "AiNotConfiguredError";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// ─── Self-tests ──────────────────────────────────────────────────────────────

export function __runLookupJobCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`lookup-job-core FAIL: ${label}`);
    }
  };

  // flag idiom
  ok(manifestBatchLookupEnabled(undefined) === true, "unset = on");
  ok(manifestBatchLookupEnabled("") === true, "empty = on");
  for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) ok(manifestBatchLookupEnabled(w) === false, `off word ${w}`);
  ok(manifestBatchLookupEnabled("on") === true && manifestBatchLookupEnabled("banana") === true, "junk = on");

  // time budget
  ok(canStartItem({ elapsedMs: 9_999_999, startedThisTick: 0 }) === true, "first item always starts");
  ok(canStartItem({ elapsedMs: 460_000, startedThisTick: 1 }) === true, "460s + 300s = 760s fits");
  ok(canStartItem({ elapsedMs: 460_001, startedThisTick: 1 }) === false, "one ms over does not fit");
  ok(canStartItem({ elapsedMs: 0, startedThisTick: LOOKUP_MAX_ITEMS_PER_TICK }) === false, "per-tick cap");
  ok(canStartItem({ elapsedMs: 0, startedThisTick: LOOKUP_MAX_ITEMS_PER_TICK - 1 }) === true, "under cap");
  ok(canStartItem({ elapsedMs: Number.NaN, startedThisTick: 2 }) === false, "NaN elapsed never starts a second");
  // S13.8 chunk size
  ok(lookupItemsPerTick(undefined) === 12 && lookupItemsPerTick("") === 12 && lookupItemsPerTick("abc") === 12, "unset/junk = 12");
  ok(lookupItemsPerTick("0") === 12 && lookupItemsPerTick("-3") === 12 && lookupItemsPerTick("2.5") === 12, "zero/negative/fraction = 12");
  ok(lookupItemsPerTick("3") === 3 && lookupItemsPerTick(" 1 ") === 1, "lower cap honoured");
  ok(lookupItemsPerTick("99") === 12 && lookupItemsPerTick("99999999999999999999") === 12, "clamped to 12");
  ok(canStartItem({ elapsedMs: 0, startedThisTick: 3, maxPerTick: 3 }) === false && canStartItem({ elapsedMs: 0, startedThisTick: 2, maxPerTick: 3 }) === true, "configured cap");
  ok(canStartItem({ elapsedMs: 0, startedThisTick: 0, maxPerTick: 1 }) === true && canStartItem({ elapsedMs: 0, startedThisTick: 1, maxPerTick: 1 }) === false, "cap 1 = one per run");
  ok(canStartItem({ elapsedMs: 0, startedThisTick: 12, maxPerTick: 50 }) === false && canStartItem({ elapsedMs: 0, startedThisTick: 5, maxPerTick: Number.NaN }) === true, "cap cannot exceed 12; NaN = 12");
  ok(LOOKUP_TICK_BUDGET_MS < LOOKUP_TICK_MAX_DURATION_S * 1000, "budget inside maxDuration");
  ok(LOOKUP_LEASE_MS > LOOKUP_TICK_MAX_DURATION_S * 1000, "lease outlives the function");
  ok(LOOKUP_TICK_MAX_DURATION_S <= 800, "Pro maximum");

  // lease
  ok(leaseIsFree(null, 0) && leaseIsFree(undefined, 0) && leaseIsFree("junk", 0), "null/junk lease free");
  ok(leaseIsFree("2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00.000Z")) === true, "expiry instant is free");
  ok(leaseIsFree("2026-01-01T00:00:01.000Z", Date.parse("2026-01-01T00:00:00.000Z")) === false, "future lease held");
  ok(leaseUntilIso(0) === new Date(LOOKUP_LEASE_MS).toISOString(), "lease until");

  // orphans
  ok(orphanDecision(0) === "requeue" && orphanDecision(1) === "requeue", "first orphan requeued");
  ok(orphanDecision(2) === "fail" && orphanDecision(5) === "fail", "second orphan fails");
  ok(orphanDecision("x") === "requeue", "junk attempts = 0");

  // enqueue
  const ex = planEnqueue({ reviewDraftIds: ["a"], alreadyDoneDraftIds: [], activeJobId: "J" });
  ok(ex.kind === "exists" && ex.jobId === "J", "active job reused (idempotent)");
  const none = planEnqueue({ reviewDraftIds: [], alreadyDoneDraftIds: [], activeJobId: null });
  ok(none.kind === "nothing" && none.reason === NOTHING_IN_REVIEW_COPY, "nothing in review");
  const allDone = planEnqueue({ reviewDraftIds: ["A", "b"], alreadyDoneDraftIds: ["a", "B"], activeJobId: null });
  ok(allDone.kind === "nothing" && allDone.reason === ALL_DONE_COPY, "all done (case-insensitive)");
  const cr = planEnqueue({ reviewDraftIds: ["a", "b", "a", 3, " ", "c"], alreadyDoneDraftIds: ["b"], activeJobId: null });
  ok(cr.kind === "create" && cr.draftIds.join(",") === "a,c" && cr.total === 2 && cr.skippedDone === 1, "create skips done + dupes + junk");
  const big = planEnqueue({ reviewDraftIds: Array.from({ length: LOOKUP_MAX_JOB_ITEMS + 5 }, (_, i) => `d${i}`), alreadyDoneDraftIds: [], activeJobId: null });
  ok(big.kind === "create" && big.total === LOOKUP_MAX_JOB_ITEMS && big.truncated === 5, "capped");

  // classify
  ok(classifyItem({ skippedWeb: true, found: true, attached: 3, queued: 0 }) === "known", "memory skip = known");
  ok(classifyItem({ skippedWeb: false, found: true, attached: 2, queued: 1 }) === "attached", "attached");
  ok(classifyItem({ skippedWeb: false, found: true, attached: 0, queued: 4 }) === "review", "review");
  ok(classifyItem({ skippedWeb: false, found: false, attached: 0, queued: 0 }) === "not_found", "not found");
  ok(classifyItem({ skippedWeb: false, found: true, attached: 0, queued: 0 }) === "nothing_new", "nothing new");

  // parse
  ok(parseItemResult(null) === null && parseItemResult([]) === null && parseItemResult({ outcome: "x" }) === null, "junk result");
  const pr = parseItemResult({ outcome: "attached", attached: 2.7, queued: -1, sentence: "s", model: "m" });
  ok(pr?.attached === 2 && pr.queued === 0 && pr.sentence === "s" && pr.model === "m", "result normalised");
  ok(aiCallsOf(1) === 1 && aiCallsOf(-3) === 0 && aiCallsOf("2") === 0 && aiCallsOf(2.9) === 2, "ai calls normalised");

  // errors
  ok(itemErrorText({ friendly: "Out of AI credits." }) === "Out of AI credits.", "friendly wins");
  ok(itemErrorText(new Error("a\n  b")) === "a b", "one line");
  ok(itemErrorText("") === "The lookup could not finish.", "empty error");
  ok(itemErrorText("x".repeat(500)).length === 240, "truncated");

  // summary
  const R = (o: Partial<ItemResult>): ItemResult => ({ outcome: "attached", attached: 0, queued: 0, sentence: "", model: "", ...o });
  const items: JobItemView[] = [
    { draftId: "1", status: "done", result: R({ outcome: "attached", attached: 3 }), error: null, aiCalls: 1 },
    { draftId: "2", status: "done", result: R({ outcome: "review", queued: 2 }), error: null, aiCalls: 1 },
    { draftId: "3", status: "done", result: R({ outcome: "known" }), error: null, aiCalls: 0 },
    { draftId: "4", status: "done", result: R({ outcome: "not_found" }), error: null, aiCalls: 1 },
    { draftId: "5", status: "failed", result: null, error: "x", aiCalls: 1 },
    { draftId: "6", status: "queued", result: null, error: null, aiCalls: 0 },
    { draftId: "7", status: "running", result: null, error: null, aiCalls: 0 },
  ];
  const s = summarizeJob(items);
  ok(s.total === 7 && s.lookedUp === 5 && s.queued === 1 && s.running === 1 && s.failed === 1, "counts");
  ok(s.attached === 3 && s.aiCalls === 4 && s.known === 1, "attached + calls (a paid failure counts) + known");
  ok(s.needsEye === 3, "needs eye = review + not found + failed");
  ok(s.finished === false, "not finished while queued/running");
  ok(summarizeJob(items.slice(0, 5)).finished === true, "finished");
  ok(summarizeJob([]).finished === true && summarizeJob([]).total === 0, "empty");
  ok(itemNeedsEye({ status: "done", result: R({ outcome: "attached", attached: 1, queued: 1 }) }) === true, "attached with leftovers needs eye");
  ok(itemNeedsEye({ status: "done", result: R({ outcome: "nothing_new" }) }) === false, "nothing new is fine");
  ok(itemNeedsEye({ status: "canceled", result: null }) === false, "canceled not counted");

  // copy
  ok(progressLine({ ...s, lookedUp: 9, total: 14, attached: 31, needsEye: 6 }) === "9 of 14 looked up \u00b7 31 facts attached \u00b7 6 need your eye", "bible progress copy");
  ok(progressLine({ ...s, lookedUp: 1, total: 1, attached: 1, needsEye: 1 }) === "1 of 1 looked up \u00b7 1 fact attached \u00b7 1 needs your eye", "singular copy");
  ok(lookupAllButtonLabel(14, 0) === "Look up all 14 products on this manifest", "bible button copy");
  ok(lookupAllButtonLabel(1, 0) === "Look up the 1 product on this manifest", "singular button");
  ok(lookupAllButtonLabel(3, 2) === "Look up the 3 products not looked up yet", "rerun button");
  ok(costLine({ ...s, aiCalls: 8, known: 0 }, "gemini-3-pro") === "8 paid AI web lookups (gemini-3-pro)", "cost copy");
  ok(costLine({ ...s, aiCalls: 1, known: 2 }, null).endsWith("2 products were already on file, so no lookup was paid for"), "cost known copy");
  ok(jobHeadline("canceled", s) === "Batch lookup stopped" && jobHeadline("done", s) === "Batch lookup finished", "headline");
  ok(jobHeadline("queued", summarizeJob([{ draftId: "1", status: "queued", result: null, error: null, aiCalls: 0 }])).startsWith("Batch lookup waiting"), "waiting headline");
  ok(jobHeadline("running", s) === "Batch lookup running", "running headline");
  ok(itemRowCopy(items[0]) === "Batch lookup: 3 facts attached", "row attached");
  ok(itemRowCopy(items[1]) === "Batch lookup: 2 facts waiting for you - attach them below", "row review");
  ok(itemRowCopy(items[2]) === "Batch lookup: already on file (no lookup paid)", "row known");
  ok(itemRowCopy(items[4]) === "Batch lookup failed: x", "row failed");
  ok(itemRowCopy(items[5]) === "Batch lookup: waiting" && itemRowCopy(items[6]) === "Batch lookup: looking up now", "row pending");
  ok(isItemStatus("done") && !isItemStatus("DONE") && isJobStatus("canceled") && !isJobStatus("failed"), "status guards");

  // errors + copy
  ok(isMissingLookupJobsTable({ code: "42P01", message: 'relation "public.lookup_jobs" does not exist' }), "42P01 jobs");
  ok(isMissingLookupJobsTable({ code: "PGRST205", message: "Could not find the table 'public.lookup_job_items' in the schema cache" }), "PGRST205 items");
  ok(!isMissingLookupJobsTable({ code: "42P01", message: 'relation "public.kb_products" does not exist' }), "another table is not ours");
  ok(!isMissingLookupJobsTable({ code: "42P01", message: 'relation "public.lookup_jobs_archive" does not exist' }), "word-bounded");
  ok(!isMissingLookupJobsTable({ code: "23505", message: "duplicate key lookup_jobs_one_active_per_manifest" }), "unique violation is not missing");
  ok(!isMissingLookupJobsTable(null), "null");
  ok(isNoSpendError({ name: "AiBudgetExceededError" }) && isNoSpendError({ name: "AiNotConfiguredError" }), "no-spend errors");
  ok(!isNoSpendError({ name: "AiLookupError" }) && !isNoSpendError(new Error("x")) && !isNoSpendError(null), "a timeout may have been paid for");
  ok(stopsWholeJob({ name: "AiBudgetExceededError" }) && !stopsWholeJob({ name: "AiLookupError" }), "budget stops the job, a timeout does not");
  ok(isUuid("123e4567-e89b-12d3-a456-426614174000") && !isUuid("x") && !isUuid(null), "uuid");
  ok(LOOKUP_MIGRATION_COPY.includes("0242_lookup_jobs.sql"), "migration copy names the file");

  // result banner (closed set)
  ok(lookupBanner("started", "")?.tone === "ok", "banner started");
  ok(lookupBanner("exists", "")?.text.includes("already running") === true, "banner exists");
  ok(lookupBanner("nothing", ALL_DONE_COPY)?.text === ALL_DONE_COPY, "banner nothing carries the reason");
  ok(lookupBanner("nothing", "")?.text === NOTHING_IN_REVIEW_COPY, "banner nothing default");
  ok(lookupBanner("migration", "x")?.text === LOOKUP_MIGRATION_COPY, "banner migration ignores msg");
  ok(lookupBanner("error", "")?.tone === "error" && lookupBanner("stop_error", "")?.tone === "error", "banner errors");
  ok(lookupBanner("stopped", "")?.text === "Batch lookup stopped.", "banner stopped");
  ok(lookupBanner("hacked", "x") === null && lookupBanner(undefined, "x") === null && lookupBanner(["started"], "") === null, "unknown code shows nothing");
  ok((lookupBanner("error", "y".repeat(5000))?.text.length ?? 0) === 300, "message capped");

  // R21: the entry decision (every state says something)
  const base: BatchLookupEntryInput = { focused: true, view: "draft", flagOn: true, aiOn: true, attachOn: true, state: "none", jobActive: false, eligible: { count: 14, skippedDone: 0, truncated: 0 } };
  const ent = (o: Partial<BatchLookupEntryInput>) => batchLookupEntry({ ...base, ...o });
  const btn = ent({});
  ok(btn.kind === "button" && btn.label === "Look up all 14 products on this manifest", "focused + eligible = button");
  const btn2 = ent({ eligible: { count: 3, skippedDone: 2, truncated: 0 } });
  ok(btn2.kind === "button" && btn2.label === "Look up the 3 products not looked up yet", "skipped label");
  ok(ent({ view: "approved" }).kind === "hidden" && ent({ view: "dismissed", focused: false }).kind === "hidden", "other tabs hidden");
  ok(ent({ focused: false }).kind === "choose", "unfocused = choose a delivery");
  const r = (o: Partial<BatchLookupEntryInput>) => { const x = ent(o); return x.kind === "reason" ? x.text : `<${x.kind}>`; };
  ok(r({ flagOn: false }) === LOOKUP_FLAG_OFF_COPY && r({ flagOn: false, focused: false }) === LOOKUP_FLAG_OFF_COPY, "flag off says so (focused or not)");
  ok(r({ aiOn: false }) === LOOKUP_AI_OFF_COPY && r({ aiOn: false, focused: false }) === LOOKUP_AI_OFF_COPY, "AI off says so (focused or not)");
  ok(r({ flagOn: false, aiOn: false }) === LOOKUP_FLAG_OFF_COPY, "flag reason first");
  ok(r({ state: "migration" }) === LOOKUP_MIGRATION_COPY, "migration");
  ok(r({ state: "error" }) === LOOKUP_READ_ERROR_COPY && r({ state: null }) === LOOKUP_READ_ERROR_COPY, "error / unread");
  ok(r({ state: "off" }) === LOOKUP_FLAG_OFF_COPY, "server says off");
  ok(r({ attachOn: false }) === LOOKUP_ATTACH_V2_OFF_COPY, "attach off");
  ok(r({ attachOn: false, state: "migration" }) === LOOKUP_MIGRATION_COPY, "migration before attach");
  ok(ent({ state: "job", jobActive: true }).kind === "stop", "active job = stop");
  ok(ent({ state: "job", jobActive: true, eligible: null }).kind === "stop", "active job wins over unknown count");
  ok(r({ eligible: null }) === LOOKUP_UNKNOWN_COUNT_COPY, "unknown count is said, never guessed");
  ok(r({ eligible: { count: Number.NaN, skippedDone: 0, truncated: 0 } }) === LOOKUP_UNKNOWN_COUNT_COPY, "NaN count = unknown");
  ok(r({ eligible: { count: 0, skippedDone: 0, truncated: 0 } }) === NOTHING_IN_REVIEW_COPY, "nothing in review");
  ok(r({ eligible: { count: 0, skippedDone: 5, truncated: 0 } }) === ALL_DONE_COPY, "all done");
  ok(r({ state: "job", eligible: { count: 0, skippedDone: 5, truncated: 0 } }) === ALL_DONE_COPY, "finished job, all done");
  ok(ent({ state: "job", eligible: { count: 1, skippedDone: 0, truncated: 0 } }).kind === "button", "finished job, new arrivals = button");
  // R21: the choose-a-delivery strip
  const U1 = "123e4567-e89b-12d3-a456-426614174001";
  const U2 = "123e4567-e89b-12d3-a456-426614174002";
  const U3 = "123e4567-e89b-12d3-a456-426614174003";
  const ch = lookupDeliveryChoices([
    { id: U1, label: "A", inReview: 4 },
    { id: U2, label: "B", inReview: 0 },
    { id: U3, label: "C", inReview: null },
    { id: U1.toUpperCase(), label: "A again", inReview: 4 },
    { id: "nope", label: "bad", inReview: 3 },
  ]);
  ok(ch.length === 2 && ch[0].id === U1 && ch[1].id === U3, "keeps in-review + unknown, drops zero / dupes / non-uuid");
  ok(ch[0].countText === "4 in Needs review" && ch[1].countText === "count not available", "count text never invented");
  ok(lookupDeliveryChoices([{ id: U1, label: "A", inReview: 1 }, { id: U3, label: "C", inReview: 2 }], 1).length === 1, "cap");
  ok(lookupDeliveryChoices(null).length === 0 && lookupDeliveryChoices([], 0).length === 0, "empty");
  ok(lookupDeliveryChoices([{ id: U1, label: "A", inReview: -2 }]).length === 0, "negative = none");

  return { passed, failed };
}
