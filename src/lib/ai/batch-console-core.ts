/**
 * R74 S35 - the Batch Lookups console (pure). Smart batching (manifests
 * packed into "gift-wrapped" batches of BATCH_MAX_FAMILIES product
 * families, sent BATCH_WAVE at a time), the pause switch stored in
 * site_settings, pace / ETA / vendor schedule, search health and the cost
 * roll-ups. No I/O here; the page and actions call these.
 */
import { BATCH_MAX_FAMILIES, BATCH_MAX_INFLIGHT_DEFAULT } from "@/lib/ai/gemini-batch-core";

export const BATCH_CONSOLE_PATH = "/admin/inventory/batch-lookups";
export const BATCH_CONTROL_KEY = "ai_batch_control";
export const BATCH_CONTROL_LABEL = "AI batch lookups: pause switch and paused jobs";
/** One wave = the in-flight cap: 4 batches of 200 families. */
export const BATCH_WAVE = BATCH_MAX_INFLIGHT_DEFAULT;
/** Used until real ingested batches give a measured cost per family. */
export const FALLBACK_CENTS_PER_FAMILY = 6;
/** Used until real batches give a measured turnaround (Google's target is < 24 h; most finish far sooner). */
export const FALLBACK_TURNAROUND_MIN = 6 * 60;
export const DEFAULT_TARGET_DATE = "2026-11-30";

// ─── Pause switch ─────────────────────────────────────────────────────────

export type BatchControl = { paused: boolean; pausedJobIds: string[]; note: string | null; at: string | null; by: string | null };
export const OPEN_CONTROL: BatchControl = { paused: false, pausedJobIds: [], note: null, at: null, by: null };

export function parseBatchControl(raw: unknown): BatchControl {
  if (!raw || typeof raw !== "object") return { ...OPEN_CONTROL };
  const o = raw as Record<string, unknown>;
  const ids = Array.isArray(o.pausedJobIds) ? o.pausedJobIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : [];
  return {
    paused: o.paused === true,
    pausedJobIds: [...new Set(ids)].slice(0, 500),
    note: typeof o.note === "string" ? o.note.slice(0, 200) : null,
    at: typeof o.at === "string" ? o.at : null,
    by: typeof o.by === "string" ? o.by : null,
  };
}

export function withJobPaused(c: BatchControl, jobId: string, paused: boolean): BatchControl {
  const set = new Set(c.pausedJobIds);
  if (paused) set.add(jobId);
  else set.delete(jobId);
  return { ...c, pausedJobIds: [...set] };
}

// ─── Smart batching ───────────────────────────────────────────────────────

export type PlanManifest = { manifestId: string; vendor: string; label: string; lots: number; families: number };
export type PlannedBatch = { n: number; families: number; lots: number; manifests: { manifestId: string; vendor: string; label: string; families: number; lots: number }[] };

/**
 * Pack manifests (vendor order kept) into batches of at most `cap` families.
 * A manifest bigger than the room left starts a fresh batch; one bigger than
 * `cap` is split across batches (the engine sends 200 at a time anyway).
 */
export function planBatches(ms: readonly PlanManifest[], cap = BATCH_MAX_FAMILIES): PlannedBatch[] {
  const out: PlannedBatch[] = [];
  let cur: PlannedBatch | null = null;
  for (const m of ms) {
    if (m.families <= 0) continue;
    let fams = m.families;
    let lots = m.lots;
    if (cur && cur.families + fams > cap && cur.families > 0 && fams <= cap) cur = null;
    while (fams > 0) {
      if (!cur || cur.families >= cap) {
        cur = { n: out.length + 1, families: 0, lots: 0, manifests: [] };
        out.push(cur);
      }
      const take = Math.min(fams, cap - cur.families);
      const takeLots = fams === take ? lots : Math.max(1, Math.round((lots * take) / fams));
      cur.families += take;
      cur.lots += takeLots;
      const prev = cur.manifests.find((x) => x.manifestId === m.manifestId);
      if (prev) {
        prev.families += take;
        prev.lots += takeLots;
      } else cur.manifests.push({ manifestId: m.manifestId, vendor: m.vendor, label: m.label, families: take, lots: takeLots });
      fams -= take;
      lots -= takeLots;
    }
  }
  return out;
}

/** The manifest ids a wave of the first `n` batches needs queued. */
export function waveManifestIds(batches: readonly PlannedBatch[], n = BATCH_WAVE): string[] {
  const ids: string[] = [];
  for (const b of batches.slice(0, n)) for (const m of b.manifests) if (!ids.includes(m.manifestId)) ids.push(m.manifestId);
  return ids;
}

// ─── Pace, ETA, schedule ─────────────────────────────────────────────────

const median = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type BatchRowLite = {
  state: string;
  families: number;
  items: number;
  answered: number;
  failed: number;
  prompt_tokens: number;
  output_tokens: number;
  search_queries: number;
  cost_cents: number | string | null;
  created_at: string;
  submitted_at: string | null;
  finished_at: string | null;
  ingested_at: string | null;
};

export type Pace = {
  turnaroundMin: number;
  measured: boolean;
  centsPerFamily: number;
  costMeasured: boolean;
  familiesPerDay: number;
  searchesPerFamily: number | null;
  answerRate: number | null;
  searchHealth: "good" | "low" | "none" | "unknown";
};

/** Turnaround, cost per family, daily capacity and search health from finished batches. */
export function measurePace(rows: readonly BatchRowLite[], inflight = BATCH_WAVE, cap = BATCH_MAX_FAMILIES): Pace {
  const done = rows.filter((r) => r.state === "ingested");
  const turns = done.map((r) => (r.finished_at && (r.submitted_at ?? r.created_at) ? (Date.parse(r.finished_at) - Date.parse(r.submitted_at ?? r.created_at)) / 60_000 : NaN));
  const t = median(turns);
  const fam = done.reduce((s, r) => s + (r.families || 0), 0);
  const cents = done.reduce((s, r) => s + Number(r.cost_cents || 0), 0);
  const searches = done.reduce((s, r) => s + (r.search_queries || 0), 0);
  const answered = done.reduce((s, r) => s + (r.answered || 0), 0);
  const tried = done.reduce((s, r) => s + (r.answered || 0) + (r.failed || 0), 0);
  const turnaroundMin = Math.max(5, Math.round(t ?? FALLBACK_TURNAROUND_MIN));
  const spf = fam > 0 ? searches / fam : null;
  return {
    turnaroundMin,
    measured: t !== null,
    centsPerFamily: fam > 0 && cents > 0 ? cents / fam : FALLBACK_CENTS_PER_FAMILY,
    costMeasured: fam > 0 && cents > 0,
    // inflight batches turn over once per turnaround (plus a minute of cron slack).
    familiesPerDay: Math.round(((24 * 60) / (turnaroundMin + 1)) * inflight * cap),
    searchesPerFamily: spf,
    answerRate: tried > 0 ? answered / tried : null,
    searchHealth: spf === null ? "unknown" : spf === 0 ? "none" : spf < 0.5 ? "low" : "good",
  };
}

/** Minutes left for an open batch (never below 1 while open). */
export function batchEtaMin(row: Pick<BatchRowLite, "state" | "created_at" | "submitted_at">, turnaroundMin: number, nowMs: number): number | null {
  if (!["submitting", "pending", "running"].includes(row.state)) return null;
  const since = (nowMs - Date.parse(row.submitted_at ?? row.created_at)) / 60_000;
  return Math.max(1, Math.round(turnaroundMin - since));
}

export function fmtMinutes(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "-";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.round(h / 24)} days`;
}

export function fmtCents(c: number): string {
  return `$${(c / 100).toFixed(c >= 10_000 ? 0 : 2)}`;
}

export function daysUntil(targetIso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(`${targetIso}T23:59:59Z`) - nowMs) / 86_400_000));
}

export type VendorLoad = { vendor: string; families: number; lots: number; manifests: number };
export type ScheduledVendor = VendorLoad & { day: number; date: string; cents: number };

/**
 * Spread vendors across the days left so the daily load is even (biggest
 * vendors first, so a slow day never leaves a large vendor for the end).
 */
export function scheduleVendors(vs: readonly VendorLoad[], perDay: number, startMs: number, centsPerFamily: number): ScheduledVendor[] {
  const cap = Math.max(1, perDay);
  const sorted = [...vs].filter((v) => v.families > 0).sort((a, b) => b.families - a.families || a.vendor.localeCompare(b.vendor));
  let day = 0;
  let used = 0;
  const out: ScheduledVendor[] = [];
  for (const v of sorted) {
    if (used > 0 && used + v.families > cap) {
      day += Math.max(1, Math.floor((used + v.families) / cap));
      used = 0;
    }
    used += v.families;
    out.push({ ...v, day, date: new Date(startMs + day * 86_400_000).toISOString().slice(0, 10), cents: Math.round(v.families * centsPerFamily) });
  }
  return out;
}

// ─── Re-run, ledger ──────────────────────────────────────────────────────

/**
 * R74 S37: one product's ledger cost. Measured (0296 cost_cents) when the
 * batch ingest priced it; otherwise its paid calls x the average per product.
 */
export function itemLedgerCents(costCents: unknown, paidCalls: number, centsPerFamily: number): { cents: number; measured: number } {
  const c = costCents === null || costCents === undefined || costCents === "" ? NaN : Number(costCents);
  if (Number.isFinite(c) && c >= 0) return { cents: c, measured: c };
  return { cents: Math.max(0, paidCalls) * centsPerFamily, measured: 0 };
}

/** "exact", "partly estimated" or "estimated" for a ledger line. */
export function ledgerBasis(r: Pick<LedgerRow, "cents" | "measured">): "exact" | "mixed" | "estimate" {
  if (r.cents <= 0 || r.measured >= r.cents - 1e-9) return "exact";
  return r.measured > 0 ? "mixed" : "estimate";
}

/** A failure the 429 / spend-limit storm caused (safe to run again). */
export function isRateLimitFailure(error: string | null | undefined): boolean {
  const e = String(error ?? "").toLowerCase();
  return /\b429\b|resource_exhausted|rate.?limit|spend-per-10-minutes|quota|too many requests/.test(e);
}

/** cents = measured + estimated; `measured` = the part Google's own usage numbers priced (R74 S37). */
export type LedgerRow = { key: string; label: string; batches: number; families: number; items: number; answered: number; failed: number; searches: number; cents: number; measured: number };

export function addLedger(map: Map<string, LedgerRow>, key: string, label: string, add: Partial<Omit<LedgerRow, "key" | "label">>): void {
  const r = map.get(key) ?? { key, label, batches: 0, families: 0, items: 0, answered: 0, failed: 0, searches: 0, cents: 0, measured: 0 };
  r.batches += add.batches ?? 0;
  r.families += add.families ?? 0;
  r.items += add.items ?? 0;
  r.answered += add.answered ?? 0;
  r.failed += add.failed ?? 0;
  r.searches += add.searches ?? 0;
  r.cents += add.cents ?? 0;
  r.measured += add.measured ?? 0;
  map.set(key, r);
}

// ─── Self-tests ──────────────────────────────────────────────────────────

export function __runBatchConsoleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("batch-console-core FAIL:", m);
    }
  };
  const id = "11111111-1111-1111-1111-111111111111";
  ok(parseBatchControl(null).paused === false, "no row = running");
  ok(parseBatchControl({ paused: true, pausedJobIds: [id, id, "x"] }).pausedJobIds.length === 1, "ids deduped and validated");
  ok(withJobPaused(OPEN_CONTROL, id, true).pausedJobIds[0] === id && withJobPaused({ ...OPEN_CONTROL, pausedJobIds: [id] }, id, false).pausedJobIds.length === 0, "job pause toggles");

  const m = (id: string, f: number, v = "V") => ({ manifestId: id, vendor: v, label: id, lots: f, families: f });
  const p = planBatches([m("a", 120), m("b", 120), m("c", 60), m("d", 450), m("e", 0)]);
  ok(p.length === 5, `5 batches (got ${p.length})`);
  ok(p[0].families === 120 && p[1].manifests[0].manifestId === "b" && p[1].manifests[1].manifestId === "c", "b starts a fresh batch, c joins it");
  ok(p[1].families === 200 && p[2].families === 200 && p[3].families === 200 && p[4].families === 30, "a 450 manifest tops up, then 200/200/30");
  ok(p.every((b) => b.families <= 200), "never over 200");
  ok(waveManifestIds(p, 4).join(",") === "a,b,c,d", "first wave manifests");
  ok(planBatches([]).length === 0, "nothing to plan");

  const now = Date.parse("2026-10-24T00:00:00Z");
  const row = (o: Partial<BatchRowLite>): BatchRowLite => ({ state: "ingested", families: 200, items: 260, answered: 190, failed: 10, prompt_tokens: 0, output_tokens: 0, search_queries: 600, cost_cents: 1000, created_at: "2026-10-23T00:00:00Z", submitted_at: "2026-10-23T00:00:00Z", finished_at: "2026-10-23T01:00:00Z", ingested_at: null, ...o });
  const pace = measurePace([row({}), row({ finished_at: "2026-10-23T03:00:00Z" })]);
  ok(pace.measured && pace.turnaroundMin === 120, `median turnaround (got ${pace.turnaroundMin})`);
  ok(pace.centsPerFamily === 5 && pace.costMeasured, "cost per family measured");
  ok(pace.searchHealth === "good" && pace.searchesPerFamily === 3, "searches healthy");
  ok(Math.abs((pace.answerRate ?? 0) - 0.95) < 1e-9, "answer rate");
  ok(measurePace([row({ search_queries: 0 })]).searchHealth === "none", "zero searches flagged");
  ok(!measurePace([]).measured && measurePace([]).centsPerFamily === FALLBACK_CENTS_PER_FAMILY, "fallbacks before any batch");
  ok(batchEtaMin({ state: "running", created_at: "2026-10-23T23:00:00Z", submitted_at: null }, 120, now) === 60, "eta = turnaround - age");
  ok(batchEtaMin({ state: "ingested", created_at: "x", submitted_at: null }, 120, now) === null, "no eta when done");
  ok(fmtMinutes(45) === "45 min" && fmtMinutes(125) === "2 h 5 min" && fmtMinutes(null) === "-", "minutes format");
  ok(fmtCents(1234) === "$12.34", "cents format");
  ok(daysUntil("2026-11-30", now) === 38, `days until (got ${daysUntil("2026-11-30", now)})`);
  const s = scheduleVendors([{ vendor: "A", families: 300, lots: 300, manifests: 2 }, { vendor: "B", families: 500, lots: 600, manifests: 3 }, { vendor: "C", families: 100, lots: 100, manifests: 1 }], 600, now, 5);
  ok(s[0].vendor === "B" && s[0].day === 0 && s[1].day === 1 && s[2].day === 1, "biggest first, spread by day");
  ok(s[0].cents === 2500 && s[0].date === "2026-10-24", "vendor cost + date");
  ok(isRateLimitFailure("HTTP 429 RESOURCE_EXHAUSTED") && !isRateLimitFailure("Draft left review"), "429 failures found");
  const L = new Map<string, LedgerRow>();
  addLedger(L, "v", "V", { cents: 5, batches: 1 });
  addLedger(L, "v", "V", { cents: 7 });
  ok(L.get("v")?.cents === 12 && L.get("v")?.batches === 1, "ledger adds");
  ok(itemLedgerCents("4.5", 1, 6).measured === 4.5 && itemLedgerCents(null, 1, 6).cents === 6 && itemLedgerCents(null, 1, 6).measured === 0, "measured cost wins; else estimate");
  ok(itemLedgerCents(0, 0, 6).cents === 0 && ledgerBasis({ cents: 10, measured: 10 }) === "exact" && ledgerBasis({ cents: 10, measured: 4 }) === "mixed" && ledgerBasis({ cents: 10, measured: 0 }) === "estimate", "ledger basis");
  return { passed, failed };
}
