/**
 * src/lib/catalog/lookup-progress-core.ts
 *
 * R66 - the batch lookup panel's progress bar, time estimate and
 * auto-refresh rules. PURE (no I/O, no process.env, no clock: `nowMs` is
 * passed in) so every branch is self-tested.
 *
 * The estimate is measured, never assumed:
 *   ms per product = (newest finish - when the job started) / products finished
 * That wall-clock rate already includes everything that really slows a
 * delivery down: the gap between cron runs, deep-thinking lookups, retries
 * (a retried product's first try costs time but finishes nothing). Until the
 * first product finishes there is nothing to measure, so the panel says
 * "estimating" instead of inventing a number.
 */

export type ProgressItemStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface ProgressItem {
  status: ProgressItemStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface BatchProgress {
  total: number;
  /** done + failed + canceled (canceled are skipped, so they count as settled). */
  settled: number;
  remaining: number;
  /** 0..100, whole number; 100 only when nothing is left. */
  percent: number;
  /** "eta" = measured; "estimating" = nothing finished yet; "finished" = none left. */
  kind: "finished" | "estimating" | "eta";
  etaMs: number | null;
  /** nowMs + etaMs, ISO (for "finishes around ..."). */
  finishAt: string | null;
  /** The measured wall-clock time per finished product. */
  msPerItem: number | null;
}

function ts(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * jobStartedAt: lookup_jobs.started_at (the first run that took the job).
 * Falls back to the earliest item start when the job time is missing.
 */
export function batchProgress(input: { items: readonly ProgressItem[]; jobStartedAt?: string | null; nowMs: number }): BatchProgress {
  const items = input.items ?? [];
  const now = Number.isFinite(input.nowMs) ? input.nowMs : 0;
  let settled = 0;
  let finished = 0;
  let lastFinish: number | null = null;
  let firstStart: number | null = ts(input.jobStartedAt);
  let earliestItemStart: number | null = null;
  for (const it of items) {
    if (it.status === "done" || it.status === "failed" || it.status === "canceled") settled += 1;
    const s = ts(it.startedAt);
    if (s !== null && (earliestItemStart === null || s < earliestItemStart)) earliestItemStart = s;
    if (it.status === "done" || it.status === "failed") {
      const f = ts(it.finishedAt);
      if (f !== null) {
        finished += 1;
        if (lastFinish === null || f > lastFinish) lastFinish = f;
      }
    }
  }
  if (firstStart === null) firstStart = earliestItemStart;
  const total = items.length;
  const remaining = total - settled;
  const percent = total === 0 ? 100 : remaining === 0 ? 100 : Math.min(99, Math.floor((settled / total) * 100));
  const base = { total, settled, remaining, percent };
  if (remaining === 0) return { ...base, kind: "finished", etaMs: 0, finishAt: null, msPerItem: null };
  if (finished === 0 || lastFinish === null || firstStart === null || lastFinish <= firstStart) {
    return { ...base, kind: "estimating", etaMs: null, finishAt: null, msPerItem: null };
  }
  const msPerItem = (lastFinish - firstStart) / finished;
  // Time already spent on the next product since the newest finish counts
  // toward it (never more than one product's worth).
  const sinceLast = Math.min(Math.max(0, now - lastFinish), msPerItem);
  const etaMs = Math.max(0, Math.round(remaining * msPerItem - sinceLast));
  return { ...base, kind: "eta", etaMs, finishAt: new Date(now + etaMs).toISOString(), msPerItem: Math.round(msPerItem) };
}

/** "under a minute" / "about 12 min" / "about 1 h 05 min". */
export function durationWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "under a minute";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${String(m).padStart(2, "0")} min`;
}

export function clockWords(iso: string, timeZone = "America/Los_Angeles"): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** The line under the progress bar. Null when the job is not running. */
export function etaLine(p: BatchProgress, active: boolean, timeZone = "America/Los_Angeles"): string | null {
  if (!active) return null;
  if (p.kind === "finished") return "Finishing up...";
  if (p.kind === "estimating") return "Time left: estimating - shown after the first product finishes.";
  const at = p.finishAt ? clockWords(p.finishAt, timeZone) : "";
  const per = p.msPerItem !== null ? ` (${durationWords(p.msPerItem)} per product so far)` : "";
  return `Time left: ${durationWords(p.etaMs ?? 0)}${at ? `, done around ${at}` : ""}${per}.`;
}

// ─── auto-refresh ─────────────────────────────────────────────────────────

/** How often the open page re-reads progress while a batch runs. */
export const BATCH_REFRESH_MS = 20_000;

/**
 * Re-read only when it helps and can never disturb work: the job is still
 * open, the operator has not paused it, the tab is visible, and they are not
 * typing in a field (a refresh mid-edit is never worth it).
 */
export function shouldAutoRefresh(input: { active: boolean; paused: boolean; visible: boolean; editing: boolean }): boolean {
  return input.active === true && input.paused !== true && input.visible === true && input.editing !== true;
}

/** Is this element one a person types into (focus inside a form field)? */
export function isEditingTag(tag: string | null | undefined, contentEditable?: boolean | null): boolean {
  if (contentEditable === true) return true;
  const t = String(tag ?? "").toUpperCase();
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
}

export const BATCH_REFRESH_ON_COPY = "Updates by itself every 20 seconds while this tab is open.";
export const BATCH_REFRESH_PAUSED_COPY = "Auto-update paused.";

// ─── self-tests ───────────────────────────────────────────────────────────

export function __runLookupProgressCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`lookup-progress-core FAIL: ${label}`);
    }
  };
  const T = Date.parse("2026-10-03T20:00:00.000Z");
  const iso = (ms: number) => new Date(T + ms).toISOString();
  const min = 60_000;

  // empty / finished
  const empty = batchProgress({ items: [], nowMs: T });
  ok(empty.total === 0 && empty.percent === 100 && empty.kind === "finished", "empty job is finished");
  const allDone = batchProgress({ items: [{ status: "done", startedAt: iso(0), finishedAt: iso(min) }, { status: "canceled" }], jobStartedAt: iso(0), nowMs: T + 2 * min });
  ok(allDone.kind === "finished" && allDone.percent === 100 && allDone.remaining === 0 && allDone.settled === 2, "done + canceled = finished");

  // estimating: nothing finished yet (never a made-up number)
  const est = batchProgress({ items: [{ status: "running", startedAt: iso(0) }, { status: "queued" }], jobStartedAt: iso(0), nowMs: T + 5 * min });
  ok(est.kind === "estimating" && est.etaMs === null && est.finishAt === null && est.percent === 0, "estimating before the first finish");
  ok(etaLine(est, true) === "Time left: estimating - shown after the first product finishes.", "estimating copy");
  const queuedOnly = batchProgress({ items: [{ status: "queued" }, { status: "queued" }], jobStartedAt: null, nowMs: T });
  ok(queuedOnly.kind === "estimating" && queuedOnly.percent === 0, "not started -> estimating");

  // measured: 2 finished in 10 min (job start -> newest finish) -> 5 min each; 3 left
  const items: ProgressItem[] = [
    { status: "done", startedAt: iso(0), finishedAt: iso(4 * min) },
    { status: "failed", startedAt: iso(4 * min), finishedAt: iso(10 * min) },
    { status: "running", startedAt: iso(10 * min) },
    { status: "queued" },
    { status: "queued" },
  ];
  const p = batchProgress({ items, jobStartedAt: iso(0), nowMs: T + 10 * min });
  ok(p.kind === "eta" && p.msPerItem === 5 * min, "ms per product = wall clock / finished");
  ok(p.remaining === 3 && p.settled === 2 && p.percent === 40, "remaining + percent");
  ok(p.etaMs === 15 * min, "eta = remaining x rate at the moment of the last finish");
  ok(p.finishAt === iso(25 * min), "finish time = now + eta");
  // time since the last finish counts toward the running product, capped at one product
  const p2 = batchProgress({ items, jobStartedAt: iso(0), nowMs: T + 12 * min });
  ok(p2.etaMs === 13 * min, "2 min into the next product -> 13 min left");
  const p3 = batchProgress({ items, jobStartedAt: iso(0), nowMs: T + 60 * min });
  ok(p3.etaMs === 10 * min, "a stalled product never counts as more than one product done");
  // a clock before the last finish does not inflate the estimate
  const p4 = batchProgress({ items, jobStartedAt: iso(0), nowMs: T + 5 * min });
  ok(p4.etaMs === 15 * min, "now before last finish -> no negative spend");
  // the job start falls back to the earliest item start
  const p5 = batchProgress({ items, jobStartedAt: null, nowMs: T + 10 * min });
  ok(p5.msPerItem === 5 * min, "fallback to earliest item start");
  // junk timestamps are ignored, never NaN
  const junk = batchProgress({ items: [{ status: "done", startedAt: "nope", finishedAt: "nope" }, { status: "queued" }], jobStartedAt: "bad", nowMs: T });
  ok(junk.kind === "estimating" && junk.percent === 50, "junk timestamps -> estimating");
  // retries slow the measured rate (the first try costs time, finishes nothing)
  const retry = batchProgress({
    items: [
      { status: "done", startedAt: iso(15 * min), finishedAt: iso(20 * min) },
      { status: "queued", startedAt: iso(0) },
    ],
    jobStartedAt: iso(0),
    nowMs: T + 20 * min,
  });
  ok(retry.msPerItem === 20 * min && retry.etaMs === 20 * min, "retry time is part of the measured rate");
  // a finish at the same instant as the start cannot divide by zero
  const zero = batchProgress({ items: [{ status: "done", startedAt: iso(0), finishedAt: iso(0) }, { status: "queued" }], jobStartedAt: iso(0), nowMs: T });
  ok(zero.kind === "estimating", "zero elapsed -> estimating");
  // percent never shows 100 while something is left
  const many: ProgressItem[] = Array.from({ length: 200 }, (_, i) => (i < 199 ? { status: "done", startedAt: iso(0), finishedAt: iso(min) } : { status: "queued" }));
  ok(batchProgress({ items: many, jobStartedAt: iso(0), nowMs: T + min }).percent === 99, "199/200 -> 99, not 100");

  // copy
  ok(durationWords(30_000) === "under a minute" && durationWords(Number.NaN) === "under a minute", "under a minute");
  ok(durationWords(12 * min) === "about 12 min", "minutes");
  ok(durationWords(65 * min) === "about 1 h 05 min" && durationWords(120 * min) === "about 2 h", "hours");
  ok(clockWords(iso(25 * min)) === "1:25 PM", "Pacific clock (PDT)");
  ok(clockWords("nope") === "", "junk clock");
  const line = etaLine(p, true);
  ok(line === "Time left: about 15 min, done around 1:25 PM (about 5 min per product so far).", "eta copy");
  ok(etaLine(p, false) === null, "no line when the job is not running");
  ok(etaLine(allDone, true) === "Finishing up...", "finishing copy");

  // auto-refresh rules
  ok(shouldAutoRefresh({ active: true, paused: false, visible: true, editing: false }), "refresh while running");
  ok(!shouldAutoRefresh({ active: false, paused: false, visible: true, editing: false }), "no refresh when finished");
  ok(!shouldAutoRefresh({ active: true, paused: true, visible: true, editing: false }), "no refresh when paused");
  ok(!shouldAutoRefresh({ active: true, paused: false, visible: false, editing: false }), "no refresh when the tab is hidden");
  ok(!shouldAutoRefresh({ active: true, paused: false, visible: true, editing: true }), "no refresh mid-edit");
  ok(isEditingTag("input") && isEditingTag("TEXTAREA") && isEditingTag("select") && isEditingTag("div", true), "editing tags");
  ok(!isEditingTag("BUTTON") && !isEditingTag(null) && !isEditingTag("A", false), "not editing");
  ok(BATCH_REFRESH_MS === 20_000 && BATCH_REFRESH_ON_COPY.includes("20 seconds"), "interval and its copy agree");

  return { passed, failed };
}
