/**
 * tests/compliance/r66-batch-lookup.test.ts
 *
 * R66 - "Search all with Gemini" must find and show as much as the row's
 * AI Lookup. Drives the REAL cron tick + runOneItem through the real
 * postgrest-js client on the in-memory PostgREST (helpers/fake-postgrest.ts):
 *
 *   1. depth: the batch asks for thinking "high" and a 600 s deadline (env
 *      overrides, junk -> defaults); later items in a run get bounded time.
 *   2. retries: a timeout / 5xx / bad reply is requeued with a plain note,
 *      never retried in the same run, tried again one thinking step lower,
 *      failed after 3 tries; 429/401/403 fail at once; the paid-call count
 *      accumulates; a "Search again" marker survives a retry.
 *   3. snapshot: every finding is stored on the item and read back by the
 *      page into the row panel's result shape (no Search Suggestions ever).
 *   4. wiring pins: page -> AiLookupPanel props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";

import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import {
  LOOKUP_BATCH_MIN_USEFUL_MS,
  LOOKUP_ITEM_IO_MS,
  LOOKUP_RETRY_MAX_ATTEMPTS,
  LOOKUP_TICK_BUDGET_MS,
} from "@/lib/catalog/lookup-job-core";
import { AGAIN_MARKER } from "@/lib/catalog/lookup-history-core";
import { normalizeLookup, type RawLookupV2 } from "@/lib/inventory/lookup-facts-core";
import { __runLookupSnapshotCoreTests, parseLookupSnapshot, snapshotToLookupResult } from "@/lib/catalog/lookup-snapshot-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const BASE = "http://fake.supabase.local/rest/v1";
const M = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

const state = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  svc: true,
  ai: true,
  audits: [] as Array<{ action: string; entityId: unknown; after: unknown; actorEmail: unknown }>,
  calls: [] as string[],
  memory: null as unknown,
  recallCalls: 0,
  lookup: null as null | ((args: unknown) => Promise<unknown>),
  lookupCalls: 0,
  lookupArgs: [] as unknown[],
  attach: null as null | ((args: unknown) => Promise<unknown>),
  attachArgs: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    state.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    state.calls.push(`perm:${p}`);
    return { userId: "bbbbbbbb-0000-4000-8000-000000000001", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: unknown; after: unknown; actorEmail: unknown }) => {
    state.audits.push({ action: a.action, entityId: a.entityId, after: a.after, actorEmail: a.actorEmail });
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return state.svc;
    },
  };
});
vi.mock("@/lib/inventory/product-lookup-ai", () => ({
  get isAiConfigured() {
    return state.ai;
  },
  lookupProduct: async (args: unknown) => {
    state.lookupCalls += 1;
    state.lookupArgs.push(args);
    if (!state.lookup) throw new Error("no lookup stub");
    return state.lookup(args);
  },
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [] }));
vi.mock("@/lib/catalog/fact-memory", () => ({
  recallForDraft: async () => {
    state.recallCalls += 1;
    return state.memory;
  },
}));
vi.mock("@/lib/catalog/attach-facts", () => ({
  attachProductFacts: async (args: unknown) => {
    state.attachArgs.push(args);
    if (!state.attach) throw new Error("no attach stub");
    return state.attach(args);
  },
}));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async () => [],
  resolveWebsiteCategoryForLot: async () => null,
}));

import { loadManifestLookup, enqueueManifestLookup, runLookupJobsTick, runOneItem, type ItemRunOutcome } from "@/lib/catalog/lookup-job-server";

// --- fixtures (same shapes as s13) ---------------------------------------------
let clock = 0;
function freshDb(): FakePostgrest {
  const db = new FakePostgrest();
  db.uniques.push({ table: "lookup_jobs", columns: ["manifest_id"], where: (r) => r.status === "queued" || r.status === "running", name: "lookup_jobs_one_active_per_manifest" });
  db.uniques.push({ table: "lookup_job_items", columns: ["job_id", "draft_id"], name: "lookup_job_items_one_per_draft" });
  const stamp = () => {
    clock += 1;
    return new Date(T0 - 1_000_000 + clock * 1000).toISOString();
  };
  db.defaults.set("lookup_jobs", () => ({ status: "queued", total: 0, done: 0, created_by: null, created_at: stamp(), started_at: null, finished_at: null, lease_until: null, lease_token: null, updated_at: stamp() }));
  db.defaults.set("lookup_job_items", () => ({ position: 0, status: "queued", attempts: 0, ai_calls: 0, result_json: null, error: null, started_at: null, finished_at: null, updated_at: stamp() }));
  state.db = db;
  return db;
}
function admin() {
  return new PostgrestClient(BASE, { fetch: state.db.fetch as typeof fetch }) as unknown as Parameters<typeof runOneItem>[0];
}
function draftId(n: number): string {
  return `dddddddd-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
function seedDrafts(db: FakePostgrest, n: number): string[] {
  const ids: string[] = [];
  for (let k = 1; k <= n; k++) {
    const id = draftId(k);
    ids.push(id);
    db.rows("catalog_product_drafts").push({
      id, manifest_id: M, status: "draft", name: `Product ${k}`, brand_name: "Brand", vendor_name: "Vendor", pos_product_key: null,
      inventory_type: null, category: null, strain_name: null, chosen_website_category: null, created_at: new Date(T0 - 5_000_000 + k * 1000).toISOString(),
    });
  }
  return ids;
}
const items = (db: FakePostgrest): Row[] => db.rows("lookup_job_items").sort((a, b) => Number(a.position) - Number(b.position));
const jobs = (db: FakePostgrest): Row[] => db.rows("lookup_jobs");

type Opts = { refresh?: boolean; thinkingLevel?: string; timeoutMs?: number };
const okResult = (n = 2): ItemRunOutcome => ({
  aiCalls: 1,
  result: { outcome: "attached", attached: n, queued: 0, sentence: "Saved.", model: "gemini-3.8-flash", found: n },
});
/** Records every call: draft id + the options the tick passed. */
function runner(impl?: (id: string, opts: Opts, idx: number) => Promise<ItemRunOutcome> | ItemRunOutcome) {
  const calls: { id: string; opts: Opts }[] = [];
  const fn = (async (_a: unknown, id: string, _actor: unknown, opts: Opts = {}) => {
    calls.push({ id, opts });
    return impl ? impl(id, opts, calls.length - 1) : okResult();
  }) as unknown as typeof runOneItem;
  return { fn, calls };
}
function named(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const e = new Error(message);
  e.name = name;
  Object.assign(e, extra);
  return e;
}
const timeoutErr = () => named("AiLookupError", "gemini google_search timed out after 600000ms", { aiCalls: 1 });
const enqueue = () => enqueueManifestLookup(M, { userId: USER, email: "m@x" });
/** A run of the tick at a fixed clock (each run is a separate cron call). */
const tick = (fn: typeof runOneItem, at = T0) => runLookupJobsTick({ admin: admin(), runItem: fn, now: () => at });

const ENV_KEYS = ["MANIFEST_BATCH_LOOKUP", "LOOKUP_ITEMS_PER_TICK", "ATTACH_FACTS_V2", "KB_FIRST_ONBOARDING", "AI_BATCH_TIMEOUT_MS", "AI_BATCH_THINKING_LEVEL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  freshDb();
  Object.assign(state, { svc: true, ai: true, audits: [], calls: [], memory: null, recallCalls: 0, lookup: null, lookupCalls: 0, attach: null, attachArgs: [] });
  state.lookupArgs = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// === 1. Depth: thinking + deadline ================================================
describe("R66 batch depth: the batch thinks deeper and waits longer than the row", () => {
  it("first product of a run: thinking 'low' (R74 S33) + the full 600 s deadline (defaults)", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    const r = runner();
    await tick(r.fn);
    expect(r.calls).toEqual([{ id: draftId(1), opts: { refresh: false, thinkingLevel: "low", timeoutMs: 600_000 } }]);
  });

  it("env overrides: AI_BATCH_THINKING_LEVEL / AI_BATCH_TIMEOUT_MS; junk -> defaults; out-of-range -> clamped", async () => {
    const cases: Array<[string | undefined, string | undefined, string, number]> = [
      ["medium", "300000", "medium", 300_000],
      ["LOW", "120000", "low", 120_000],
      ["ultra", "abc", "low", 600_000],
      ["", "-5", "low", 600_000],
      ["minimal", "5", "minimal", 60_000],
      ["high", "999999999", "high", 700_000],
    ];
    for (const [level, ms, wantLevel, wantMs] of cases) {
      freshDb();
      if (level === undefined) delete process.env.AI_BATCH_THINKING_LEVEL;
      else process.env.AI_BATCH_THINKING_LEVEL = level;
      if (ms === undefined) delete process.env.AI_BATCH_TIMEOUT_MS;
      else process.env.AI_BATCH_TIMEOUT_MS = ms;
      seedDrafts(state.db, 1);
      await enqueue();
      const r = runner();
      await tick(r.fn);
      expect(r.calls[0].opts, `${level}/${ms}`).toMatchObject({ thinkingLevel: wantLevel, timeoutMs: wantMs });
    }
  });

  it("a product started later in a run gets only what is left of the budget, and never less than the row's 290 s", async () => {
    seedDrafts(state.db, 5);
    await enqueue();
    let t = T0;
    const r = runner(() => {
      t += 400_000; // each lookup takes 400 s
      return okResult();
    });
    const out = await runLookupJobsTick({ admin: admin(), runItem: r.fn, now: () => t });
    // 0 s: full 600 s. 400 s: 760 - 400 - 10 = 350 s left (>= 290 s, so it starts). 800 s: no start.
    expect(r.calls.map((c) => c.opts.timeoutMs)).toEqual([600_000, LOOKUP_TICK_BUDGET_MS - 400_000 - LOOKUP_ITEM_IO_MS]);
    expect(r.calls[1].opts.timeoutMs).toBeGreaterThanOrEqual(LOOKUP_BATCH_MIN_USEFUL_MS);
    expect(out.started).toBe(2);
    expect(items(state.db).filter((i) => i.status === "queued")).toHaveLength(3);
  });

  it("the start rule follows the configured deadline: a 60 s deadline fits more products per run than the default", async () => {
    const run = async (ms?: string) => {
      freshDb();
      if (ms) process.env.AI_BATCH_TIMEOUT_MS = ms;
      else delete process.env.AI_BATCH_TIMEOUT_MS;
      seedDrafts(state.db, 12);
      await enqueue();
      let t = T0;
      const r = runner(() => {
        t += 100_000;
        return okResult();
      });
      await runLookupJobsTick({ admin: admin(), runItem: r.fn, now: () => t });
      return r.calls;
    };
    const dflt = await run();
    // default: needs 290 + 10 s to start -> starts at 0..400 s = 5 products.
    expect(dflt).toHaveLength(5);
    const short = await run("60000");
    // 60 s deadline: needs 60 + 10 s -> starts at 0..600 s = 7 products, each with a 60 s deadline.
    expect(short).toHaveLength(7);
    expect(short.every((c) => c.opts.timeoutMs === 60_000)).toBe(true);
  });
});

// === 2. Retries ===================================================================
describe("R66 batch retries: a product that did not finish is tried again (deeper data, not a lost row)", () => {
  it("timeout -> requeued with a plain note, NOT retried in the same run; others keep moving; job stays open", async () => {
    seedDrafts(state.db, 3);
    await enqueue();
    const r = runner((id) => {
      if (id === draftId(1)) throw timeoutErr();
      return okResult();
    });
    const out = await tick(r.fn);
    expect(r.calls.map((c) => c.id)).toEqual([draftId(1), draftId(2), draftId(3)]);
    expect(out).toMatchObject({ started: 3, done: 2, failed: 0, retrying: 1, aiCalls: 3 });
    const [a, b, c] = items(state.db);
    expect(a).toMatchObject({ status: "queued", attempts: 1, ai_calls: 1, finished_at: null });
    expect(String(a.error)).toMatch(/^Try 1 did not finish \(.*timed out.*\)\. 2 more tries queued\.$/);
    expect(b.status).toBe("done");
    expect(c.status).toBe("done");
    expect(jobs(state.db)[0].status).not.toBe("done");
  });

  it("try 2 thinks 'medium', try 3 'low', then it fails with the plain error; paid calls add up across tries", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    const r = runner(() => {
      throw timeoutErr();
    });
    await tick(r.fn);
    expect(items(state.db)[0]).toMatchObject({ status: "queued", attempts: 1 });
    await tick(r.fn);
    expect(items(state.db)[0]).toMatchObject({ status: "queued", attempts: 2, ai_calls: 2 });
    expect(String(items(state.db)[0].error)).toMatch(/^Try 2 did not finish .*1 more try queued\.$/);
    const last = await tick(r.fn);
    expect(r.calls.map((c) => c.opts.thinkingLevel)).toEqual(["low", "low", "low"]); // R74 S33: default low; never below low
    expect(LOOKUP_RETRY_MAX_ATTEMPTS).toBe(3);
    expect(last).toMatchObject({ failed: 1, retrying: 0 });
    const it0 = items(state.db)[0];
    expect(it0).toMatchObject({ status: "failed", attempts: 3, ai_calls: 3 });
    expect(String(it0.error)).toMatch(/timed out/);
    expect(String(it0.error)).not.toMatch(/Try \d/);
    expect(it0.finished_at).not.toBeNull();
    expect(jobs(state.db)[0].status).toBe("done");
    // A 4th run has nothing left to do.
    await tick(r.fn);
    expect(r.calls).toHaveLength(3);
  });

  it("a retry that succeeds is stored as done with the summed paid calls and no leftover note", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    let n = 0;
    const r = runner(() => {
      n += 1;
      if (n === 1) throw named("AiLookupError", "gemini google_search HTTP 503: overloaded", { aiCalls: 1 });
      return okResult(4);
    });
    await tick(r.fn);
    await tick(r.fn);
    expect(items(state.db)[0]).toMatchObject({ status: "done", attempts: 2, ai_calls: 2, error: null });
    expect((items(state.db)[0].result_json as { found: number }).found).toBe(4);
  });

  it("401 / 403 / budget fail at once; a 429 pauses with the try given back (R74 S33)", async () => {
    freshDb();
    seedDrafts(state.db, 1);
    await enqueue();
    const paused = await tick(runner(() => {
      throw named("AiLookupError", "gemini google_search HTTP 429: quota", { aiCalls: 1 });
    }).fn);
    expect(paused).toMatchObject({ failed: 0, retrying: 1 });
    expect(items(state.db)[0]).toMatchObject({ status: "queued", attempts: 0 });
    const errs = [
      named("AiLookupError", "gemini google_search HTTP 401: bad key", { aiCalls: 1 }),
      named("AiLookupError", "gemini google_search HTTP 403: denied", { aiCalls: 1 }),
    ];
    for (const e of errs) {
      freshDb();
      seedDrafts(state.db, 1);
      await enqueue();
      const out = await tick(runner(() => {
        throw e;
      }).fn);
      expect(out, e.message).toMatchObject({ failed: 1, retrying: 0 });
      expect(items(state.db)[0], e.message).toMatchObject({ status: "failed", attempts: 1 });
    }
    freshDb();
    seedDrafts(state.db, 2);
    await enqueue();
    const out = await tick(runner(() => {
      throw named("AiBudgetExceededError", "budget", { aiCalls: 0 });
    }).fn);
    expect(out.retrying).toBe(0);
    expect(items(state.db).every((i) => i.status === "failed")).toBe(true);
  });

  it("a 'Search again' item that times out keeps its marker, so the retry still forces a fresh web search", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    items(state.db)[0].result_json = { ...AGAIN_MARKER };
    let n = 0;
    const r = runner(() => {
      n += 1;
      if (n === 1) throw timeoutErr();
      return okResult();
    });
    await tick(r.fn);
    expect(items(state.db)[0].result_json).toEqual(AGAIN_MARKER);
    await tick(r.fn);
    expect(r.calls.map((c) => c.opts.refresh)).toEqual([true, true]);
  });

  it("the page shows a retrying product as 'trying again', not as failed", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    await tick(runner(() => {
      throw timeoutErr();
    }).fn);
    const s = await loadManifestLookup(M);
    if (s.state !== "job") throw new Error(`expected job, got ${s.state}`);
    const v = s.job.items.get(draftId(1).toLowerCase());
    expect(v?.status).toBe("queued");
    expect(v?.error).toMatch(/^Try 1 did not finish/);
    expect(s.job.summary.finished).toBe(false);
  });
});

// === 3. Snapshot: the row panel sees what the batch found ===========================
describe("R66 snapshot: runOneItem keeps every finding and the page hands it to the row panel", () => {
  const facts = () =>
    normalizeLookup({
      found: true,
      overall_confidence: 86,
      strain_type: { value: "hybrid", confidence: 90, sources: ["https://brand.example/p"] },
      category: { value: "Flower", confidence: 95 },
      description: { value: "A bright, citrus-forward flower.", confidence: 75, sources: ["https://brand.example/p"] },
      terpenes: { value: ["Myrcene", "Limonene"], confidence: 65 },
    } as RawLookupV2);
  const lookupOk = async () => ({
    result: {
      found: true, confidence: 86, hasAnyFindings: true, strainType: "hybrid", strainTypeConfidence: 90, autofillStrainType: true,
      summary: "Citrus.", effects: ["relaxed"], rejectedEffects: [], aromaNotes: ["citrus"], flavorNotes: ["lemon"], lineage: "A x B",
      terpenes: ["myrcene", "limonene"], hasKbDraft: false, description: "A bright, citrus-forward flower.", shortDescription: "Bright.",
      category: "flower", potencyRatio: "", size: "3.5g", imageCandidates: ["https://cdn.example/a.jpg"], hasEnrichmentDraft: true,
    },
    sources: ["https://brand.example/p"],
    model: "gemini-3.8-flash",
    usedWebSearch: true,
    facts: facts(),
    schema: "v2",
    searchSuggestions: ["<div class=\"SEARCH-SUGGESTION-CHIP\">blue dream</div>"],
    citations: [],
  });
  const attachOk = async () => ({ ok: true, receipt: { attached: [{ field: "description" }], queued: [] }, sentence: "Saved." });

  it("the REAL runOneItem passes the batch thinking + deadline to lookupProduct and counts what it found", async () => {
    seedDrafts(state.db, 1);
    state.lookup = lookupOk;
    state.attach = attachOk;
    const r = await runOneItem(admin(), draftId(1), { userId: USER, email: null }, { thinkingLevel: "high", timeoutMs: 600_000 });
    expect(state.lookupArgs[0]).toMatchObject({ thinkingLevel: "high", timeoutMs: 600_000 });
    // v2: counts the gated facts with a value (strain type, category, description, terpenes).
    expect(r.result.found).toBe(4);
    expect(r.snapshot).toBeTruthy();
    // No options -> the provider's own defaults (the row lookup's behaviour).
    await runOneItem(admin(), draftId(1), { userId: USER, email: null });
    const plain = state.lookupArgs[1] as Record<string, unknown>;
    expect("thinkingLevel" in plain).toBe(false);
    expect("timeoutMs" in plain).toBe(false);
  });

  it("a whole tick with the real runner stores the snapshot; the page reads it back into the row panel's result", async () => {
    seedDrafts(state.db, 1);
    await enqueue();
    state.lookup = lookupOk;
    state.attach = attachOk;
    const out = await runLookupJobsTick({ admin: admin(), now: () => T0 });
    expect(out).toMatchObject({ done: 1, aiCalls: 1 });
    expect(state.lookupArgs[0]).toMatchObject({ thinkingLevel: "low", timeoutMs: 600_000, bulk: true });
    const rj = items(state.db)[0].result_json as Record<string, unknown>;
    expect(rj.outcome).toBe("attached");
    expect(rj.snapshot).toBeTruthy();
    // Google Grounding terms: Search Suggestions are never stored.
    const raw = JSON.stringify(rj);
    expect(raw).not.toMatch(/SEARCH-SUGGESTION-CHIP|searchSuggestions/);
    expect(raw.length).toBeLessThan(48_000);

    const s = await loadManifestLookup(M);
    if (s.state !== "job") throw new Error(`expected job, got ${s.state}`);
    const snap = s.job.snapshots.get(draftId(1).toLowerCase());
    expect(snap).toBeTruthy();
    expect(parseLookupSnapshot(rj.snapshot)).toEqual(snap);
    const view = snapshotToLookupResult(snap!, { honestMiss: "none", name: "Product 1", posProductKey: "" });
    expect(view).toMatchObject({ ok: true, searchSuggestions: [], citations: [] });
    // The same fields the row action returns, so the panel draws them unchanged.
    expect(view).toMatchObject({
      found: true, strainType: "hybrid", description: "A bright, citrus-forward flower.", shortDescription: "Bright.",
      aromaNotes: ["citrus"], flavorNotes: ["lemon"], lineage: "A x B", terpenes: ["myrcene", "limonene"], size: "3.5g",
      imageCandidates: ["https://cdn.example/a.jpg"], sources: ["https://brand.example/p"], model: "gemini-3.8-flash", schema: "v2",
      policy: null, memory: null,
    });
    expect(view.facts?.fields.description.value).toBe("A bright, citrus-forward flower.");
    expect(view.draft).toMatchObject({ name: "Product 1", description: "A bright, citrus-forward flower." });
    expect(Object.keys(view.draft.fieldConfidence).length).toBeGreaterThan(0);
  });

  it("lookup-snapshot-core self-tests: exact count, and the runner pins the same floor", () => {
    const r = __runLookupSnapshotCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(48);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runLookupSnapshotCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 48\)/);
  });

  it("Grounding terms: a snapshot older than two years is never handed to the panel again", async () => {
    seedDrafts(state.db, 2);
    await enqueue();
    state.lookup = lookupOk;
    state.attach = attachOk;
    await runLookupJobsTick({ admin: admin(), now: () => T0 });
    const [a, b] = items(state.db);
    const snapA = (a.result_json as { snapshot: Record<string, unknown> }).snapshot;
    const snapB = (b.result_json as { snapshot: Record<string, unknown> }).snapshot;
    const day = 24 * 60 * 60 * 1000;
    snapA.at = new Date(Date.now() - 731 * day).toISOString();
    snapB.at = new Date(Date.now() - 729 * day).toISOString();
    const s = await loadManifestLookup(M);
    if (s.state !== "job") throw new Error(`expected job, got ${s.state}`);
    expect(s.job.snapshots.has(draftId(1).toLowerCase())).toBe(false);
    expect(s.job.snapshots.has(draftId(2).toLowerCase())).toBe(true);
    // The item itself (counts, outcome) is still shown; only the findings expire.
    expect(s.job.items.get(draftId(1).toLowerCase())?.status).toBe("done");
  });

  it("a failed or still-queued item never gives the panel a snapshot", async () => {
    seedDrafts(state.db, 2);
    await enqueue();
    await tick(runner((id) => {
      if (id === draftId(1)) throw timeoutErr();
      throw named("AiLookupError", "gemini google_search HTTP 429: quota", { aiCalls: 1 });
    }).fn);
    const s = await loadManifestLookup(M);
    if (s.state !== "job") throw new Error(`expected job, got ${s.state}`);
    expect(s.job.snapshots.size).toBe(0);
  });
});

// === 4. Wiring pins =================================================================
describe("R66 wiring: page -> AiLookupPanel", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const panel = read("src/app/admin/inventory/drafts/AiLookupPanel.tsx");
  it("the page reads the batch snapshot per row and hands it to the panel", () => {
    expect(page).toMatch(/batchLookupJob\?\.snapshots\.get\(d\.id\.toLowerCase\(\)\)/);
    expect(page).toMatch(/initialResult=\{\s*batchSnap\s*\?\s*snapshotToLookupResult\(batchSnap/);
    expect(page).toMatch(/initialNote=\{batchSnap \? snapshotNote\(/);
    expect(page).toMatch(/closedLabel=\{snapshotButtonLabel\(batchSnap\)\}/);
    expect(page).toMatch(/data-testid="batch-lookup-found"/);
  });
  it("the panel opens pre-filled from the batch, says so, and a new lookup clears that note", () => {
    expect(panel).toMatch(/initialResult\?: Ok \| null;/);
    expect(panel).toMatch(/useState<Ok \| null>\(initialResult\)/);
    expect(panel).toMatch(/data-testid="lookup-from-batch"/);
    expect(panel).toMatch(/setFromBatch\(false\)/);
    expect(panel).toMatch(/\{closedLabel\}/);
  });
  it("the tick passes thinking + deadline per attempt and requeues without finished_at", () => {
    const srv = read("src/lib/catalog/lookup-job-server.ts");
    expect(srv).toMatch(/thinkingLevel: thinkingForAttempt\(level, attemptNo\)/);
    expect(srv).toMatch(/timeoutMs: itemTimeoutMs\(\{ configuredMs, elapsedMs: now\(\) - t0 \}\)/);
    expect(srv).toMatch(/requeue \? \{ \.\.\.patch, updated_at: finishedAt \}/);
  });
});
