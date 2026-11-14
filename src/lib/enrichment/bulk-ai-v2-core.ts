/**
 * src/lib/enrichment/bulk-ai-v2-core.ts  (D244 E-5 - Bulk AI v2)
 *
 * Owner (D244, verbatim): "Please complete another 3 slices. Follow the
 * standing rules."  Strategy doc slice E-5: "Draft with AI" for a selection
 * or a whole vendor queues a JOB that runs E-4's all-fields call per product
 * in the background (the every-minute worker, no new cron); progress and
 * failure reasons show on the page (F-10..F-12). Review grid v2: filter by
 * vendor and confidence, accept all high-confidence, Accept & publish (still a
 * person's click) (F-13..F-15).
 *
 * The queue is ONE site_settings row (no migration): a list of product keys
 * with per-key status. Every write is a compare-and-swap on updated_at; a run
 * holds a lease so two worker ticks never draft the same product twice.
 *
 * Owner Q6 (Batch API) is OPEN: this slice uses the live call only.
 * Pure: no I/O, no clock (now is passed in). Self-tests at the bottom.
 */
import { ACCEPT_ALL_THRESHOLD, isDraftFieldKey, parseEvidenceSource } from "./ai-draft-v2-core";

export const BULK_AI_V2_KEY = "enrichment_bulk_ai_v2";
export const BULK_AI_V2_LABEL = "Product enrichment: background all-fields AI drafts (D244 E-5)";
export const BULK_AI_V2_AUDIT = {
  queued: "product.bulk_ai_v2_queued",
  canceled: "product.bulk_ai_v2_canceled",
  ran: "product.bulk_ai_v2_ran",
} as const;

/** Most products one queue press may add (a vendor can be large; ~12 an 800 s tick). */
export const BULK_AI_V2_MAX_QUEUE = 300;
/** A worker run stops STARTING products after this (the route lives 800 s). */
export const BULK_AI_V2_BUDGET_MS = 540_000;
/** Worst case for one all-fields call + reads/writes; a product only starts if this fits. */
export const BULK_AI_V2_ITEM_WORST_MS = 150_000;
/** Lease = budget + slack = 800 s (the route's maxDuration): a live run is never overtaken. */
export const BULK_AI_V2_LEASE_SLACK_MS = 260_000;
/** Products drafted per run at most. */
export const BULK_AI_V2_MAX_PER_RUN = 12;
/** Tries per product before it is marked failed with its reason. */
export const BULK_AI_V2_MAX_ATTEMPTS = 2;
/** Finished rows kept so the page can show the last run's failures. */
export const BULK_AI_V2_KEEP_DONE = 300;

export type BulkItemStatus = "queued" | "running" | "done" | "failed" | "canceled";

export type BulkItem = {
  key: string;
  name: string;
  vendor: string | null;
  status: BulkItemStatus;
  attempts: number;
  saved: number;
  error: string | null;
};

export type BulkAiV2State = {
  v: 1;
  generation: number;
  items: BulkItem[];
  queuedBy: string | null;
  queuedAt: string | null;
  lastRunAt: string | null;
  lastNote: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
};

export function emptyBulkAiV2(): BulkAiV2State {
  return { v: 1, generation: 0, items: [], queuedBy: null, queuedAt: null, lastRunAt: null, lastNote: null, leaseToken: null, leaseUntil: null };
}

const STATUSES: readonly BulkItemStatus[] = ["queued", "running", "done", "failed", "canceled"];

/** Read a stored value defensively: junk -> empty state; bad rows dropped. */
export function parseBulkAiV2(raw: unknown): BulkAiV2State {
  const base = emptyBulkAiV2();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const items: BulkItem[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const key = str(o.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const status = STATUSES.includes(o.status as BulkItemStatus) ? (o.status as BulkItemStatus) : "queued";
    items.push({ key, name: str(o.name) ?? key, vendor: str(o.vendor), status, attempts: num(o.attempts), saved: num(o.saved), error: str(o.error) });
  }
  return {
    v: 1,
    generation: num(r.generation),
    items,
    queuedBy: str(r.queuedBy),
    queuedAt: str(r.queuedAt),
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
  };
}

export type QueueRequest = { key: string; name: string; vendor: string | null };

/**
 * Add products to the queue. A key already queued/running is left alone; a
 * finished one is re-queued (a fresh draft). Old finished rows beyond
 * BULK_AI_V2_KEEP_DONE are trimmed (oldest first). Caps at MAX_QUEUE adds.
 */
export function enqueueBulk(
  s: BulkAiV2State,
  reqs: QueueRequest[],
  actorId: string | null,
  nowIso: string,
): { state: BulkAiV2State; added: number; already: number; capped: boolean } {
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
    if (cur && (cur.status === "queued" || cur.status === "running")) {
      already += 1;
      continue;
    }
    if (added >= BULK_AI_V2_MAX_QUEUE) {
      capped = true;
      break;
    }
    const row: BulkItem = { key, name: r.name || key, vendor: r.vendor ?? null, status: "queued", attempts: 0, saved: 0, error: null };
    if (cur) Object.assign(cur, row);
    else {
      items.push(row);
      byKey.set(key, row);
    }
    added += 1;
  }
  // Trim old finished rows (keep open ones always).
  const finished = items.filter((i) => i.status !== "queued" && i.status !== "running");
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - BULK_AI_V2_KEEP_DONE)).map((i) => i.key));
  return {
    state: { ...s, items: items.filter((i) => !drop.has(i.key)), queuedBy: added ? actorId : s.queuedBy, queuedAt: added ? nowIso : s.queuedAt },
    added,
    already,
    capped,
  };
}

/** Cancel every queued product (a running one finishes). Bumps the generation. */
export function cancelBulk(s: BulkAiV2State): { state: BulkAiV2State; canceled: number } {
  let canceled = 0;
  const items = s.items.map((i) => {
    if (i.status !== "queued") return i;
    canceled += 1;
    return { ...i, status: "canceled" as const };
  });
  return { state: { ...s, items, generation: s.generation + 1 }, canceled };
}

export type BulkDecision = "go" | "idle" | "leased";

export function bulkDecision(s: BulkAiV2State, nowMs: number): BulkDecision {
  const open = s.items.some((i) => i.status === "queued" || i.status === "running");
  if (!open) return "idle";
  if (s.leaseToken && s.leaseUntil && Date.parse(s.leaseUntil) > nowMs) return "leased";
  return "go";
}

/**
 * Take the lease. Rows left "running" by a killed run are orphans: re-queued
 * when they have tries left, else failed with a plain reason.
 */
export function takeBulkLease(s: BulkAiV2State, token: string, nowMs: number, budgetMs = BULK_AI_V2_BUDGET_MS): BulkAiV2State {
  const items = s.items.map((i) => {
    if (i.status !== "running") return i;
    return i.attempts >= BULK_AI_V2_MAX_ATTEMPTS
      ? { ...i, status: "failed" as const, error: i.error ?? "The background run stopped while drafting this product (twice). Draft it from its page." }
      : { ...i, status: "queued" as const };
  });
  return { ...s, items, leaseToken: token, leaseUntil: new Date(nowMs + budgetMs + BULK_AI_V2_LEASE_SLACK_MS).toISOString() };
}

/**
 * The next queued product (queue order), or null. `skip` = keys this run
 * already tried: a product that failed waits for the NEXT run (a rate limit
 * or outage is not retried seconds later).
 */
export function nextBulkItem(s: BulkAiV2State, skip?: ReadonlySet<string>): BulkItem | null {
  return s.items.find((i) => i.status === "queued" && !skip?.has(i.key)) ?? null;
}

/** May a run START another product now? */
export function canStartAnother(startedMs: number, nowMs: number, ranThisRun: number, budgetMs = BULK_AI_V2_BUDGET_MS): boolean {
  if (ranThisRun >= BULK_AI_V2_MAX_PER_RUN) return false;
  return nowMs - startedMs + BULK_AI_V2_ITEM_WORST_MS <= budgetMs;
}

/** Mark one product running (only if this run still holds the lease and it is still queued). */
export function claimBulkItem(s: BulkAiV2State, key: string, token: string): BulkAiV2State | null {
  if (s.leaseToken !== token) return null;
  const it = s.items.find((i) => i.key === key);
  if (!it || it.status !== "queued") return null;
  return { ...s, items: s.items.map((i) => (i.key === key ? { ...i, status: "running" as const, attempts: i.attempts + 1 } : i)) };
}

/** Record one product's outcome. A failure with tries left goes back to the queue. */
export function finishBulkItem(
  s: BulkAiV2State,
  key: string,
  outcome: { ok: true; saved: number } | { ok: false; error: string },
): BulkAiV2State {
  return {
    ...s,
    items: s.items.map((i) => {
      if (i.key !== key || i.status !== "running") return i;
      if (outcome.ok) return { ...i, status: "done" as const, saved: outcome.saved, error: null };
      const err = outcome.error.slice(0, 240) || "The AI call failed.";
      return i.attempts >= BULK_AI_V2_MAX_ATTEMPTS ? { ...i, status: "failed" as const, error: err } : { ...i, status: "queued" as const, error: err };
    }),
  };
}

export function releaseBulkLease(s: BulkAiV2State, token: string, nowIso: string, note: string): BulkAiV2State {
  if (s.leaseToken !== token) return s;
  return { ...s, leaseToken: null, leaseUntil: null, lastRunAt: nowIso, lastNote: note };
}

export type BulkCounts = { queued: number; running: number; done: number; failed: number; canceled: number; total: number };

export function bulkCounts(s: BulkAiV2State): BulkCounts {
  const c: BulkCounts = { queued: 0, running: 0, done: 0, failed: 0, canceled: 0, total: s.items.length };
  for (const i of s.items) c[i.status] += 1;
  return c;
}

/** The progress line for the page. */
export function bulkProgressText(s: BulkAiV2State): string {
  const c = bulkCounts(s);
  if (c.total === 0) return "Nothing queued. Pick products or a vendor and press Draft with AI.";
  const open = c.queued + c.running;
  const parts = [`${c.done} drafted`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.canceled) parts.push(`${c.canceled} canceled`);
  return open > 0
    ? `${open} waiting (${c.running} drafting now) · ${parts.join(" · ")}. The worker runs every minute; you can close this tab.`
    : `Finished: ${parts.join(" · ")}.`;
}

/** Vendors with open/finished work, for the vendor strip ("Vendor: 3 of 10 drafted"). */
export function bulkVendorStrip(s: BulkAiV2State): { vendor: string; done: number; total: number; failed: number }[] {
  const m = new Map<string, { vendor: string; done: number; total: number; failed: number }>();
  for (const i of s.items) {
    if (i.status === "canceled") continue;
    const v = i.vendor || "No vendor";
    const row = m.get(v) ?? { vendor: v, done: 0, total: 0, failed: 0 };
    row.total += 1;
    if (i.status === "done") row.done += 1;
    if (i.status === "failed") row.failed += 1;
    m.set(v, row);
  }
  return [...m.values()].sort((a, b) => a.vendor.localeCompare(b.vendor));
}

export function bulkRunNote(r: { drafted: number; failed: number; left: number; stoppedBecause?: string | null }): string {
  const bits = [`Drafted ${r.drafted} product${r.drafted === 1 ? "" : "s"}`];
  if (r.failed) bits.push(`${r.failed} failed`);
  bits.push(r.left ? `${r.left} still waiting` : "the queue is empty");
  return `${bits.join(", ")}.${r.stoppedBecause ? ` Stopped: ${r.stoppedBecause}` : ""}`;
}

// ---------------------------------------------------------------------------
// Review grid v2 (filter + group)
// ---------------------------------------------------------------------------

export type ReviewMinConfidence = 0 | 50 | 70 | 85;

export function parseReviewMin(raw: unknown): ReviewMinConfidence {
  const n = Number(raw);
  return n === 50 || n === 70 || n === 85 ? n : 0;
}

export type ReviewRow = {
  id: string;
  entity_id: string;
  field_key: string;
  confidence?: number | null;
  source?: string | null;
  created_at: string;
};

/**
 * Group pending drafts by product for the grid. Filters: vendor (via the
 * key -> vendor map; "" = all), minimum confidence, and "high only" hides
 * best guesses. Only the newest draft per (product, field) is kept.
 */
export function reviewGroups<T extends ReviewRow>(
  rows: T[],
  opts: { vendorByKey: Map<string, string | null>; vendor: string; min: ReviewMinConfidence },
): { key: string; vendor: string | null; rows: T[]; eligible: number }[] {
  const newest = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.entity_id}\u0000${r.field_key}`;
    const cur = newest.get(k);
    if (!cur || r.created_at > cur.created_at) newest.set(k, r);
  }
  const groups = new Map<string, { key: string; vendor: string | null; rows: T[]; eligible: number }>();
  for (const r of newest.values()) {
    const vendor = opts.vendorByKey.get(r.entity_id) ?? null;
    if (opts.vendor && (vendor ?? "") !== opts.vendor) continue;
    const pct = Math.round((r.confidence ?? 0) * 100);
    if (pct < opts.min) continue;
    const g = groups.get(r.entity_id) ?? { key: r.entity_id, vendor, rows: [], eligible: 0 };
    g.rows.push(r);
    const ev = parseEvidenceSource(r.source);
    if (ev.v2 && !ev.bestGuess && isDraftFieldKey(r.field_key) && pct >= ACCEPT_ALL_THRESHOLD) g.eligible += 1;
    groups.set(r.entity_id, g);
  }
  return [...groups.values()].sort((a, b) => (a.vendor ?? "~").localeCompare(b.vendor ?? "~") || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runBulkAiV2Tests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`bulk-ai-v2-core FAIL: ${label}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const T0 = Date.parse("2025-01-01T00:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  // parse
  eq(parseBulkAiV2(null), emptyBulkAiV2(), "parse null");
  eq(parseBulkAiV2({ items: [{ key: "a" }, { key: "a" }, { nope: 1 }, { key: "b", status: "weird" }] }).items.map((i) => [i.key, i.status]), [["a", "queued"], ["b", "queued"]], "parse dedupe + junk");

  // enqueue
  const s = enqueueBulk(emptyBulkAiV2(), [{ key: "a", name: "A", vendor: "V1" }, { key: "b", name: "B", vendor: "V2" }, { key: "a", name: "A", vendor: "V1" }], "u", iso(T0));
  eq([s.added, s.already, s.capped], [2, 0, false], "enqueue adds");
  eq(s.state.queuedBy, "u", "enqueue actor");
  const again = enqueueBulk(s.state, [{ key: "a", name: "A", vendor: "V1" }], "u", iso(T0));
  eq([again.added, again.already], [0, 1], "enqueue already queued");
  const big = enqueueBulk(emptyBulkAiV2(), Array.from({ length: BULK_AI_V2_MAX_QUEUE + 5 }, (_, i) => ({ key: `k${i}`, name: "", vendor: null })), null, iso(T0));
  eq([big.added, big.capped], [BULK_AI_V2_MAX_QUEUE, true], "enqueue cap");
  eq(enqueueBulk(emptyBulkAiV2(), [{ key: " ", name: "", vendor: null }], null, iso(T0)).added, 0, "enqueue blank key");

  // decide + lease
  eq(bulkDecision(emptyBulkAiV2(), T0), "idle", "idle");
  eq(bulkDecision(s.state, T0), "go", "go");
  let st = takeBulkLease(s.state, "t1", T0);
  eq(bulkDecision(st, T0 + 1000), "leased", "leased");
  eq(bulkDecision(st, T0 + BULK_AI_V2_BUDGET_MS + BULK_AI_V2_LEASE_SLACK_MS + 1), "go", "lease expires");
  eq(BULK_AI_V2_BUDGET_MS + BULK_AI_V2_LEASE_SLACK_MS, 800_000, "lease = 800 s");

  // claim + finish
  eq(nextBulkItem(st)?.key, "a", "next is queue order");
  eq(nextBulkItem(st, new Set(["a"]))?.key, "b", "a product tried this run waits for the next run");
  eq(claimBulkItem(st, "a", "other"), null, "claim needs lease");
  st = claimBulkItem(st, "a", "t1")!;
  eq([st.items[0].status, st.items[0].attempts], ["running", 1], "claimed");
  eq(claimBulkItem(st, "a", "t1"), null, "claim twice refused");
  st = finishBulkItem(st, "a", { ok: true, saved: 7 });
  eq([st.items[0].status, st.items[0].saved], ["done", 7], "done");
  st = claimBulkItem(st, "b", "t1")!;
  st = finishBulkItem(st, "b", { ok: false, error: "boom" });
  eq([st.items[1].status, st.items[1].error], ["queued", "boom"], "failure retried");
  st = claimBulkItem(st, "b", "t1")!;
  st = finishBulkItem(st, "b", { ok: false, error: "boom2" });
  eq([st.items[1].status, st.items[1].error], ["failed", "boom2"], "failure final");

  // orphans
  const orphan = parseBulkAiV2({ items: [{ key: "x", status: "running", attempts: 1 }, { key: "y", status: "running", attempts: 2 }] });
  const re = takeBulkLease(orphan, "t2", T0);
  eq(re.items.map((i) => i.status), ["queued", "failed"], "orphans requeue then fail");
  ok(String(re.items[1].error).includes("stopped while drafting"), "orphan reason");

  // budget
  ok(canStartAnother(T0, T0, 0), "can start at t0");
  ok(!canStartAnother(T0, T0 + BULK_AI_V2_BUDGET_MS - BULK_AI_V2_ITEM_WORST_MS + 1, 0), "no start near budget");
  ok(!canStartAnother(T0, T0, BULK_AI_V2_MAX_PER_RUN), "per-run cap");

  // cancel + counts + text
  const c = cancelBulk(enqueueBulk(st, [{ key: "c", name: "C", vendor: "V1" }], null, iso(T0)).state);
  eq(c.canceled, 1, "cancel");
  eq(bulkCounts(c.state), { queued: 0, running: 0, done: 1, failed: 1, canceled: 1, total: 3 }, "counts");
  eq(bulkProgressText(c.state), "Finished: 1 drafted · 1 failed · 1 canceled.", "finished text");
  ok(bulkProgressText(s.state).startsWith("2 waiting (0 drafting now)"), "waiting text");
  eq(bulkProgressText(emptyBulkAiV2()).startsWith("Nothing queued"), true, "empty text");
  eq(bulkVendorStrip(c.state), [{ vendor: "V1", done: 1, total: 1, failed: 0 }, { vendor: "V2", done: 0, total: 1, failed: 1 }], "vendor strip");
  eq(releaseBulkLease(st, "nope", iso(T0), "n"), st, "release needs token");
  eq(releaseBulkLease(st, "t1", iso(T0), "n").leaseToken, null, "release");
  eq(bulkRunNote({ drafted: 1, failed: 0, left: 0 }), "Drafted 1 product, the queue is empty.", "run note");

  // review grid
  eq([parseReviewMin("85"), parseReviewMin("x"), parseReviewMin(70)], [85, 0, 70], "parse min");
  const rows: ReviewRow[] = [
    { id: "1", entity_id: "p1", field_key: "description", confidence: 0.9, source: "ai2:pos", created_at: "2" },
    { id: "0", entity_id: "p1", field_key: "description", confidence: 0.2, source: "ai2:pos", created_at: "1" },
    { id: "2", entity_id: "p1", field_key: "tags", confidence: 0.4, source: "ai2:", created_at: "2" },
    { id: "3", entity_id: "p2", field_key: "seo", confidence: 0.95, source: "ai2:pos|best-guess", created_at: "2" },
  ];
  const vbk = new Map<string, string | null>([["p1", "V1"], ["p2", "V2"]]);
  const g = reviewGroups(rows, { vendorByKey: vbk, vendor: "", min: 0 });
  eq(g.map((x) => [x.key, x.rows.map((r) => r.id), x.eligible]), [["p1", ["1", "2"], 1], ["p2", ["3"], 0]], "groups newest + eligible");
  eq(reviewGroups(rows, { vendorByKey: vbk, vendor: "V2", min: 0 }).map((x) => x.key), ["p2"], "vendor filter");
  eq(reviewGroups(rows, { vendorByKey: vbk, vendor: "", min: 85 }).map((x) => x.rows.map((r) => r.id)), [["1"], ["3"]], "min filter");

  return { passed, failed };
}
