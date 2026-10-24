/**
 * tests/compliance/r66-batch-progress.test.tsx
 *
 * R66 - the batch panel's progress bar, measured time left and auto-refresh.
 *
 *   A. lookup-progress-core: exact self-test count + runner pin + purity.
 *   B. BatchLookupAutoRefresh, behaviourally: the effect is run for real
 *      (useEffect is executed synchronously by a thin react mock), with fake
 *      timers and stubbed window/document: it refreshes every 20 s while the
 *      job is open, never while hidden / typing / paused / finished, and the
 *      cleanup stops the interval.
 *   C. the REAL page read carries the timestamps the estimate needs, and the
 *      page renders the bar, the time-left line and the auto-refresh.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BATCH_REFRESH_MS,
  BATCH_REFRESH_ON_COPY,
  __runLookupProgressCoreTests,
  batchProgress,
  etaLine,
} from "@/lib/catalog/lookup-progress-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const h = vi.hoisted(() => ({
  refreshes: 0,
  cleanups: [] as Array<() => void>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => (h.refreshes += 1) }),
}));
// Run effects synchronously during the server render so the interval logic
// is exercised without a DOM library (none is installed in this repo).
vi.mock("react", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("react");
  return {
    ...orig,
    useEffect: (fn: () => void | (() => void)) => {
      const c = fn();
      if (typeof c === "function") h.cleanups.push(c);
    },
  };
});

import { BatchLookupAutoRefresh } from "@/components/admin/catalog/BatchLookupAutoRefresh";

type Doc = { visibilityState: string; activeElement: { tagName: string; isContentEditable: boolean } | null };
let doc: Doc;

beforeEach(() => {
  vi.useFakeTimers();
  h.refreshes = 0;
  h.cleanups = [];
  doc = { visibilityState: "visible", activeElement: { tagName: "BODY", isContentEditable: false } };
  vi.stubGlobal("window", { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  for (const c of h.cleanups) c();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (active: boolean, everyMs?: number) =>
  renderToStaticMarkup(createElement(BatchLookupAutoRefresh, everyMs ? { active, everyMs } : { active }));

// === A. pure core =================================================================
describe("R66 lookup-progress-core", () => {
  it("self-tests pass with the exact count (a deleted check turns this red)", () => {
    const r = __runLookupProgressCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(33);
  });
  it("the pure runner pins the same floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runLookupProgressCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 33\)/);
  });
  it("pure: no process.env, no Date.now / new Date() clock reads, no imports", () => {
    const raw = read("src/lib/catalog/lookup-progress-core.ts");
    // Code only: the header comment may talk about what the core avoids.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src.length).toBeGreaterThan(2000);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    expect(src.split("\n").filter((l) => /^\s*import\b/.test(l))).toEqual([]);
  });
  it("from the outside: a delivery 3 of 10 through at 6 min per product -> 42 min left, 30%", () => {
    const T = Date.parse("2026-10-03T20:00:00.000Z");
    const iso = (m: number) => new Date(T + m * 60_000).toISOString();
    const items = [
      { status: "done" as const, startedAt: iso(0), finishedAt: iso(6) },
      { status: "done" as const, startedAt: iso(6), finishedAt: iso(12) },
      { status: "failed" as const, startedAt: iso(12), finishedAt: iso(18) },
      ...Array.from({ length: 7 }, () => ({ status: "queued" as const })),
    ];
    const p = batchProgress({ items, jobStartedAt: iso(0), nowMs: T + 18 * 60_000 });
    expect(p).toMatchObject({ total: 10, settled: 3, remaining: 7, percent: 30, kind: "eta", etaMs: 42 * 60_000, msPerItem: 6 * 60_000 });
    expect(etaLine(p, true, "UTC")).toBe("Time left: about 42 min, done around 9:00 PM (about 6 min per product so far).");
  });
});

// === B. auto-refresh, behaviourally =================================================
describe("R66 BatchLookupAutoRefresh", () => {
  it("while the job is open: refreshes every 20 s and says so", () => {
    const html = render(true);
    expect(html).toContain(BATCH_REFRESH_ON_COPY);
    expect(html).toContain(">Pause<");
    expect(h.refreshes).toBe(0);
    vi.advanceTimersByTime(BATCH_REFRESH_MS - 1);
    expect(h.refreshes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.refreshes).toBe(1);
    vi.advanceTimersByTime(BATCH_REFRESH_MS * 3);
    expect(h.refreshes).toBe(4);
  });

  it("finished job: renders nothing and never schedules a refresh", () => {
    expect(render(false)).toBe("");
    vi.advanceTimersByTime(BATCH_REFRESH_MS * 10);
    expect(h.refreshes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a hidden tab is not refreshed; it picks up again when visible", () => {
    render(true);
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(BATCH_REFRESH_MS * 3);
    expect(h.refreshes).toBe(0);
    doc.visibilityState = "visible";
    vi.advanceTimersByTime(BATCH_REFRESH_MS);
    expect(h.refreshes).toBe(1);
  });

  it("never refreshes while someone is typing in an input / textarea / select / contenteditable", () => {
    render(true);
    for (const el of [
      { tagName: "INPUT", isContentEditable: false },
      { tagName: "TEXTAREA", isContentEditable: false },
      { tagName: "SELECT", isContentEditable: false },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      doc.activeElement = el;
      vi.advanceTimersByTime(BATCH_REFRESH_MS);
    }
    expect(h.refreshes).toBe(0);
    doc.activeElement = { tagName: "BUTTON", isContentEditable: false };
    vi.advanceTimersByTime(BATCH_REFRESH_MS);
    expect(h.refreshes).toBe(1);
    doc.activeElement = null;
    vi.advanceTimersByTime(BATCH_REFRESH_MS);
    expect(h.refreshes).toBe(2);
  });

  it("the cleanup stops the interval (unmount / job finished / paused)", () => {
    render(true);
    expect(vi.getTimerCount()).toBe(1);
    for (const c of h.cleanups) c();
    h.cleanups = [];
    vi.advanceTimersByTime(BATCH_REFRESH_MS * 5);
    expect(h.refreshes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a custom interval is honoured", () => {
    render(true, 5_000);
    vi.advanceTimersByTime(15_000);
    expect(h.refreshes).toBe(3);
  });

  it("source: pause is real state in the effect deps; no setState in an effect body", () => {
    const src = read("src/components/admin/catalog/BatchLookupAutoRefresh.tsx");
    expect(src).toMatch(/\}, \[active, paused, everyMs, router\]\);/);
    expect(src).toMatch(/if \(!active \|\| paused\) return;/);
    expect(src).toMatch(/onClick=\{\(\) => setPaused\(\(p\) => !p\)\}/);
    expect(src).toMatch(/aria-pressed=\{paused\}/);
    const effect = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("}, [active, paused"));
    // A bare state setter (setPaused(...)), not window.setInterval(...).
    expect(effect).toMatch(/window\.setInterval\(/);
    expect(effect).not.toMatch(/(?<![.\w])set[A-Z]\w*\(/);
  });
});

// === C. page wiring =================================================================
describe("R66 page: bar, time left, auto-refresh", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  it("the progress block renders an accessible bar, the time-left line and the auto-refresh", () => {
    const block = page.slice(page.indexOf('data-testid="batch-lookup-progress"'), page.indexOf("{batchEntry.kind === \"reason\""));
    expect(block).toMatch(/role="progressbar"/);
    expect(block).toMatch(/aria-valuenow=\{batchLookupProgress\.percent\}/);
    expect(block).toMatch(/data-testid="batch-lookup-bar"/);
    expect(block).toMatch(/style=\{\{ width: `\$\{batchLookupProgress\.percent\}%` \}\}/);
    expect(block).toMatch(/data-testid="batch-lookup-eta"/);
    expect(block).toMatch(/<BatchLookupAutoRefresh active=\{batchLookupActive\} everyMs=\{batchSlowRefresh \? 120_000 : undefined\} \/>/);
  });
  it("the estimate is built from the real job read with the page's one clock", () => {
    expect(page).toMatch(/batchProgress\(\{ items: \[\.\.\.batchLookupJob\.items\.values\(\)\], jobStartedAt: batchLookupJob\.startedAt, nowMs: now\.getTime\(\) \}\)/);
  });
  it("the old 'Refresh to see progress' instruction is gone everywhere", () => {
    expect(page).not.toMatch(/Refresh to see progress/i);
    expect(read("src/lib/catalog/lookup-job-core.ts")).not.toMatch(/refresh to see progress/i);
  });
  it("the page read selects the timestamps the estimate needs", () => {
    const srv = read("src/lib/catalog/lookup-job-server.ts");
    expect(srv).toMatch(/\.select\("draft_id, status, result_json, error, ai_calls, position, started_at, finished_at"\)/);
    expect(srv).toMatch(/\.select\("id, status, created_at, started_at, finished_at"\)/);
    expect(srv).toMatch(/startedAt: row\.started_at \?\? null/);
  });
});
