/**
 * tests/compliance/s13-lookup-jobs.test.ts
 *
 * R19 SLICE S13 - "Look up all N products on this manifest" (batch lookup job).
 *
 *   1. pure core: exact self-test count, runner pin, purity.
 *   2. enqueue through the REAL postgrest-js client on an in-memory PostgREST
 *      (helpers/fake-postgrest.ts): created / idempotent / already-done
 *      skipped / the 23505 race returns the winner / migration / an item
 *      insert failure never leaves a job blocking the button / the 200 cap.
 *   3. the cron tick (AGENTS rule 12: doubled, overlapping or skipped ticks):
 *      flag off = zero requests, the lease compare-and-swap, the item claim
 *      compare-and-swap, a doubled tick runs each product once, orphans,
 *      lease lost stops every write, budget stops the job, a person's Stop is
 *      never rewritten to done, the per-tick cap and the time budget.
 *   4. runOneItem: the paid-lookup accounting the cost line depends on.
 *   5. cancel + the page read (the button's count comes from the same plan).
 *   6. wiring: route maxDuration, vercel.json, actions, page, migration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";

import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import {
  ALL_DONE_COPY,
  DRAFT_GONE_COPY,
  LEFT_REVIEW_COPY,
  LOOKUP_MAX_JOB_ITEMS,
  LOOKUP_TICK_MAX_DURATION_S,
  NOTHING_IN_REVIEW_COPY,
  ORPHAN_FAIL_COPY,
  __runLookupJobCoreTests,
} from "@/lib/catalog/lookup-job-core";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const BASE = "http://fake.supabase.local/rest/v1";
const M = "aaaaaaaa-0000-4000-8000-000000000001";
const M2 = "aaaaaaaa-0000-4000-8000-000000000002";
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

import {
  __test,
  cancelManifestLookup,
  enqueueManifestLookup,
  loadManifestLookup,
  lookupQueryForDraft,
  runLookupJobsTick,
  runOneItem,
  type ItemRunOutcome,
} from "@/lib/catalog/lookup-job-server";

// --- fixtures ------------------------------------------------------------------

let clock = 0;
function freshDb(): FakePostgrest {
  const db = new FakePostgrest();
  db.uniques.push({
    table: "lookup_jobs",
    columns: ["manifest_id"],
    where: (r) => r.status === "queued" || r.status === "running",
    name: "lookup_jobs_one_active_per_manifest",
  });
  db.uniques.push({ table: "lookup_job_items", columns: ["job_id", "draft_id"], name: "lookup_job_items_one_per_draft" });
  const stamp = () => {
    clock += 1;
    return new Date(T0 - 1_000_000 + clock * 1000).toISOString();
  };
  db.defaults.set("lookup_jobs", () => ({
    status: "queued",
    total: 0,
    done: 0,
    created_by: null,
    created_at: stamp(),
    started_at: null,
    finished_at: null,
    lease_until: null,
    lease_token: null,
    updated_at: stamp(),
  }));
  db.defaults.set("lookup_job_items", () => ({
    position: 0,
    status: "queued",
    attempts: 0,
    ai_calls: 0,
    result_json: null,
    error: null,
    started_at: null,
    finished_at: null,
    updated_at: stamp(),
  }));
  state.db = db;
  return db;
}

function admin() {
  return new PostgrestClient(BASE, { fetch: state.db.fetch as typeof fetch }) as unknown as Parameters<typeof runOneItem>[0];
}

function draftId(n: number, prefix = "d"): string {
  const hex = n.toString(16).padStart(12, "0");
  return `${prefix === "d" ? "dddddddd" : "eeeeeeee"}-0000-4000-8000-${hex}`;
}

function seedDrafts(db: FakePostgrest, n: number, opts: { manifest?: string; status?: string; from?: number; prefix?: string } = {}): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = (opts.from ?? 1) + i;
    const id = draftId(k, opts.prefix);
    ids.push(id);
    db.rows("catalog_product_drafts").push({
      id,
      manifest_id: opts.manifest ?? M,
      status: opts.status ?? "draft",
      name: `Product ${k}`,
      brand_name: "Brand",
      vendor_name: "Vendor",
      pos_product_key: null,
      inventory_type: null,
      category: null,
      strain_name: null,
      chosen_website_category: null,
      created_at: new Date(T0 - 5_000_000 + k * 1000).toISOString(),
    });
  }
  return ids;
}

function jobs(db: FakePostgrest): Row[] {
  return db.rows("lookup_jobs");
}
function items(db: FakePostgrest, jobId?: string): Row[] {
  return db.rows("lookup_job_items").filter((r) => !jobId || r.job_id === jobId).sort((a, b) => Number(a.position) - Number(b.position));
}

const okResult = (n = 1): ItemRunOutcome => ({
  aiCalls: 1,
  result: { outcome: "attached", attached: n, queued: 0, sentence: "Saved.", model: "gemini-test" },
});

/** A fake item runner: records the draft ids it ran, in order. */
function runner(impl?: (draftId: string, idx: number) => Promise<ItemRunOutcome> | ItemRunOutcome) {
  const ran: string[] = [];
  const fn = (async (_a: unknown, id: string) => {
    ran.push(id);
    return impl ? impl(id, ran.length - 1) : okResult();
  }) as unknown as typeof runOneItem;
  return { fn, ran };
}

function named(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const e = new Error(message);
  e.name = name;
  Object.assign(e, extra);
  return e;
}

async function enqueue(manifest = M) {
  return enqueueManifestLookup(manifest, { userId: USER, email: "m@x" });
}

const ENV_KEYS = ["MANIFEST_BATCH_LOOKUP", "LOOKUP_ITEMS_PER_TICK", "ATTACH_FACTS_V2", "KB_FIRST_ONBOARDING"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  freshDb();
  state.svc = true;
  state.ai = true;
  state.audits = [];
  state.calls = [];
  state.memory = null;
  state.recallCalls = 0;
  state.lookup = null;
  state.lookupCalls = 0;
  state.attach = null;
  state.attachArgs = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// === 1. Pure core ================================================================
describe("S13 pure core", () => {
  it("self-tests pass with the exact count (a deleted check turns this red)", () => {
    const r = __runLookupJobCoreTests();
    expect(r.failed).toBe(0);
    // R21: +25 for batchLookupEntry / lookupDeliveryChoices (the button is never silently absent).
    expect(r.passed).toBe(119);
  });
  it("the pure runner pins the same floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runLookupJobCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 119\)/);
  });
  it("the core is pure: no process.env, no server-only, no I/O imports", () => {
    const src = read("src/lib/catalog/lookup-job-core.ts");
    expect(src).not.toMatch(/process\.env/);
    const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    // Today the core imports nothing at all; anything added must stay pure.
    for (const l of imports) expect(l).not.toMatch(/server-only|@\/lib\/supabase|lookup-job-server|node:|\/audit|product-lookup-ai/);
    expect(imports).toEqual([]);
  });
});

// === 2. Enqueue ==================================================================
describe("S13 enqueue (real postgrest-js on an in-memory PostgREST)", () => {
  it("an invalid manifest id is refused before any request", async () => {
    const r = await enqueueManifestLookup("not-a-uuid", { userId: USER, email: null });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(state.db.log).toHaveLength(0);
  });

  it("creates ONE job with one item per Needs-review draft, oldest first; other manifests and other statuses untouched", async () => {
    const db = state.db;
    const ids = seedDrafts(db, 3);
    seedDrafts(db, 1, { status: "approved", from: 50 });
    seedDrafts(db, 2, { manifest: M2, from: 60 });
    const r = await enqueue();
    expect(r).toMatchObject({ ok: true, kind: "created", total: 3, skippedDone: 0, truncated: 0 });
    expect(jobs(db)).toHaveLength(1);
    const job = jobs(db)[0];
    expect(job).toMatchObject({ manifest_id: M, status: "queued", total: 3, done: 0, created_by: USER });
    expect(items(db).map((i) => i.draft_id)).toEqual(ids);
    expect(items(db).map((i) => i.position)).toEqual([0, 1, 2]);
    expect(items(db).every((i) => i.status === "queued" && i.job_id === job.id)).toBe(true);
    expect(state.audits.map((a) => a.action)).toEqual(["catalog_draft.batch_lookup_enqueued"]);
  });

  it("is idempotent: a second press returns the SAME active job and writes nothing", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    const a = await enqueue();
    const writesBefore = db.log.filter((r) => r.method !== "GET").length;
    const b = await enqueue();
    expect(a.ok && b.ok).toBe(true);
    expect(b).toMatchObject({ ok: true, kind: "exists", jobId: (a as { jobId: string }).jobId });
    expect(db.log.filter((r) => r.method !== "GET").length).toBe(writesBefore);
    expect(jobs(db)).toHaveLength(1);
  });

  it("the 23505 race (two presses at once) returns the winner, never a second job", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    let raced = false;
    db.before = (req) => {
      if (!raced && req.method === "POST" && req.table === "lookup_jobs") {
        raced = true;
        // The other press commits first.
        db.rows("lookup_jobs").push({ id: "cccccccc-0000-4000-8000-000000000001", manifest_id: M, status: "queued", created_at: new Date(T0).toISOString(), lease_until: null, lease_token: null });
      }
    };
    const r = await enqueue();
    expect(r).toEqual({ ok: true, kind: "exists", jobId: "cccccccc-0000-4000-8000-000000000001" });
    expect(jobs(db)).toHaveLength(1);
    expect(items(db)).toHaveLength(0);
  });

  it("drafts an earlier batch already looked up are skipped; all done -> the plain 'already looked up' copy", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    await enqueue();
    for (const i of items(db)) i.status = "done";
    jobs(db)[0].status = "done";
    const again = await enqueue();
    expect(again).toEqual({ ok: false, code: "nothing", message: ALL_DONE_COPY });
    seedDrafts(db, 1, { from: 9 });
    const more = await enqueue();
    expect(more).toMatchObject({ ok: true, kind: "created", total: 1, skippedDone: 3 });
    const newest = jobs(db).find((j) => j.status === "queued")!;
    expect(items(db, String(newest.id)).map((i) => i.draft_id)).toEqual([draftId(9)]);
  });

  it("nothing in Needs review -> the plain copy, no job", async () => {
    seedDrafts(state.db, 2, { status: "approved" });
    expect(await enqueue()).toEqual({ ok: false, code: "nothing", message: NOTHING_IN_REVIEW_COPY });
    expect(jobs(state.db)).toHaveLength(0);
  });

  it("caps one job at LOOKUP_MAX_JOB_ITEMS and reports the rest as truncated (paged reads past 1000 rows not needed here)", async () => {
    seedDrafts(state.db, LOOKUP_MAX_JOB_ITEMS + 5);
    const r = await enqueue();
    expect(r).toMatchObject({ ok: true, kind: "created", total: LOOKUP_MAX_JOB_ITEMS, truncated: 5 });
    expect(items(state.db)).toHaveLength(LOOKUP_MAX_JOB_ITEMS);
  });

  it("migration not applied (PGRST205) -> code 'migration', nothing written", async () => {
    state.db.missing.add("lookup_jobs");
    seedDrafts(state.db, 1);
    expect(await enqueue()).toEqual({ ok: false, code: "migration", message: "" });
    expect(state.db.log.filter((r) => r.method !== "GET")).toHaveLength(0);
  });

  it("an item insert failure cancels the empty job so the button is never blocked; the next press works", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    let fail = true;
    db.before = (req) => {
      if (fail && req.method === "POST" && req.table === "lookup_job_items") {
        fail = false;
        return { status: 500, body: { code: "XX000", message: "boom" } };
      }
    };
    const r = await enqueue();
    expect(r).toMatchObject({ ok: false, code: "db" });
    expect(jobs(db)).toHaveLength(1);
    expect(jobs(db)[0].status).toBe("canceled");
    const again = await enqueue();
    expect(again).toMatchObject({ ok: true, kind: "created", total: 2 });
  });

  it("database not configured -> plain refusal, no client", async () => {
    state.svc = false;
    expect(await enqueue()).toMatchObject({ ok: false, code: "db" });
    expect(state.db.log).toHaveLength(0);
  });
});

// === 3. The cron tick ============================================================
describe("S13 cron tick: early exits", () => {
  it("flag off -> returns before ANY database request", async () => {
    process.env.MANIFEST_BATCH_LOOKUP = "off";
    seedDrafts(state.db, 1);
    await enqueue();
    state.db.log.length = 0;
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn });
    expect(r).toMatchObject({ ok: true, skipped: "flag_off", started: 0 });
    expect(state.db.log).toHaveLength(0);
  });
  it("ATTACH_FACTS_V2 off -> attach_v2_off before any request (the S10 policy is the write door)", async () => {
    process.env.ATTACH_FACTS_V2 = "off";
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn });
    expect(r.skipped).toBe("attach_v2_off");
    expect(state.db.log).toHaveLength(0);
  });
  it("AI not configured (and no injected runner) -> ai_off before any request", async () => {
    state.ai = false;
    const r = await runLookupJobsTick({ admin: admin() });
    expect(r.skipped).toBe("ai_off");
    expect(state.db.log).toHaveLength(0);
  });
  it("database not configured -> not_configured", async () => {
    state.svc = false;
    const r = await runLookupJobsTick({ runItem: runner().fn });
    expect(r.skipped).toBe("not_configured");
    expect(state.db.log).toHaveLength(0);
  });
  it("migration not applied -> skipped 'migration', ok (not an error page in the cron log)", async () => {
    state.db.missing.add("lookup_jobs");
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn });
    expect(r).toMatchObject({ ok: true, skipped: "migration" });
  });
  it("no open job -> no_job, and no writes", async () => {
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn });
    expect(r).toMatchObject({ ok: true, skipped: "no_job" });
    expect(state.db.log.filter((x) => x.method !== "GET")).toHaveLength(0);
  });
});

describe("S13 cron tick: the happy path", () => {
  it("works every product once, records results + cost, finishes the job, releases the lease, audits once", async () => {
    const db = state.db;
    const ids = seedDrafts(db, 3);
    db.rows("staff_profiles").push({ id: USER, email: "owner@greenway.test" });
    await enqueue();
    const seenActors: unknown[] = [];
    const r0 = runner();
    const runItem = (async (a: unknown, id: string, actor: unknown) => {
      seenActors.push(actor);
      return r0.fn(a as never, id, actor as never);
    }) as unknown as typeof runOneItem;
    const r = await runLookupJobsTick({ admin: admin(), runItem, now: () => T0, token: "11111111-0000-4000-8000-00000000000a" });
    expect(r).toMatchObject({ ok: true, started: 3, done: 3, failed: 0, aiCalls: 3, finished: true });
    expect(r0.ran).toEqual(ids);
    expect(seenActors[0]).toEqual({ userId: USER, email: "owner@greenway.test" });
    const job = jobs(db)[0];
    expect(job).toMatchObject({ status: "done", done: 3, lease_until: null, lease_token: null });
    expect(job.started_at).toBe(new Date(T0).toISOString());
    expect(job.finished_at).toBe(new Date(T0).toISOString());
    for (const it of items(db)) {
      expect(it).toMatchObject({ status: "done", attempts: 1, ai_calls: 1, error: null });
      expect((it.result_json as { outcome: string }).outcome).toBe("attached");
    }
    expect(state.audits.filter((a) => a.action === "catalog_draft.batch_lookup_finished")).toHaveLength(1);
    // A tick after the finish finds nothing to do.
    const again = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(again.skipped).toBe("no_job");
    expect(r0.ran).toHaveLength(3);
  });

  it("the oldest open job goes first", async () => {
    const db = state.db;
    seedDrafts(db, 1);
    seedDrafts(db, 1, { manifest: M2, from: 40 });
    const first = await enqueue(M);
    await enqueue(M2);
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn, now: () => T0 });
    expect(r.jobId).toBe((first as { jobId: string }).jobId);
  });
});

describe("S13 cron tick: concurrency (AGENTS rule 12)", () => {
  it("a job leased by a live run is left alone (no writes at all)", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    await enqueue();
    Object.assign(jobs(db)[0], { status: "running", lease_until: new Date(T0 + 60_000).toISOString(), lease_token: "99999999-0000-4000-8000-000000000001" });
    db.log.length = 0;
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r).toMatchObject({ ok: true, skipped: "leased", started: 0 });
    expect(r0.ran).toHaveLength(0);
    expect(db.log.filter((x) => x.method !== "GET")).toHaveLength(0);
  });

  it("an EXPIRED lease is taken over with a compare-and-swap on the token that was read", async () => {
    const db = state.db;
    seedDrafts(db, 1);
    await enqueue();
    const old = "99999999-0000-4000-8000-000000000002";
    Object.assign(jobs(db)[0], { status: "running", started_at: "2026-10-01T11:00:00.000Z", lease_until: new Date(T0 - 1).toISOString(), lease_token: old });
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn, now: () => T0 });
    expect(r).toMatchObject({ ok: true, started: 1, finished: true });
    const claim = db.log.find((x) => x.method === "PATCH" && x.table === "lookup_jobs" && (x.body as Row).status === "running")!;
    expect(claim.url.searchParams.get("lease_token")).toBe(`eq.${old}`);
    // started_at is only stamped when the job was still queued.
    expect(jobs(db)[0].started_at).toBe("2026-10-01T11:00:00.000Z");
  });

  it("losing the lease CAS (another run took it between read and write) -> skipped, no product touched", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    await enqueue();
    db.before = (req) => {
      if (req.method === "PATCH" && req.table === "lookup_jobs" && (req.body as Row).status === "running") {
        // The racing run commits its claim first.
        Object.assign(jobs(db)[0], { status: "running", lease_token: "99999999-0000-4000-8000-000000000003", lease_until: new Date(T0 + 60_000).toISOString() });
      }
    };
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r).toMatchObject({ ok: true, skipped: "leased", started: 0 });
    expect(r0.ran).toHaveLength(0);
    expect(items(db).every((i) => i.status === "queued" && i.attempts === 0)).toBe(true);
    expect(jobs(db)[0].lease_token).toBe("99999999-0000-4000-8000-000000000003");
  });

  it("a DOUBLED tick (two runs at once) works each product exactly once; one run stands down", async () => {
    const db = state.db;
    const ids = seedDrafts(db, 4);
    await enqueue();
    const r0 = runner(async () => {
      await new Promise((res) => setTimeout(res, 1));
      return okResult();
    });
    db.log.length = 0;
    const [a, b] = await Promise.all([
      runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0, token: "11111111-0000-4000-8000-0000000000a1" }),
      runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0, token: "11111111-0000-4000-8000-0000000000b2" }),
    ]);
    expect([...r0.ran].sort()).toEqual([...ids].sort());
    expect(a.started + b.started).toBe(4);
    expect([a.skipped, b.skipped].filter((s) => s === "leased")).toHaveLength(1);
    // Both read the free job before either claimed it, so the CAS (not the read) decided.
    const firstPatch = db.log.findIndex((x) => x.method === "PATCH");
    const jobReads = db.log.slice(0, firstPatch).filter((x) => x.method === "GET" && x.table === "lookup_jobs" && x.url.searchParams.get("status") === "in.(queued,running)");
    expect(jobReads.length).toBe(2);
    expect(jobs(db)[0].status).toBe("done");
  });

  it("an item claimed by someone else is skipped; repeated claim misses stop the loop (no spin)", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    await enqueue();
    let claimAttempts = 0;
    db.before = (req) => {
      if (req.method === "PATCH" && req.table === "lookup_job_items" && (req.body as Row).status === "running") {
        claimAttempts += 1;
        // Another writer bumps the row's attempts first: our CAS on attempts must miss.
        const target = items(db).find((i) => req.url.searchParams.get("id") === `eq.${i.id}`)!;
        target.attempts = Number(target.attempts) + 5;
      }
    };
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r0.ran).toHaveLength(0);
    expect(r.started).toBe(0);
    expect(claimAttempts).toBe(3);
    expect(r.ok).toBe(true);
    // The lease is released so the next tick can try again.
    expect(jobs(db)[0].lease_token).toBeNull();
  });

  it("orphans left by a killed run: requeued once, failed with the plain reason on the second strike", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    await enqueue();
    const its = items(db);
    Object.assign(its[0], { status: "running", attempts: 1 });
    Object.assign(its[1], { status: "running", attempts: 2 });
    Object.assign(jobs(db)[0], { status: "running", lease_until: new Date(T0 - 1).toISOString(), lease_token: "99999999-0000-4000-8000-000000000004" });
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r.requeued).toBe(1);
    expect(r.failed).toBe(1);
    expect(items(db)[1]).toMatchObject({ status: "failed", error: ORPHAN_FAIL_COPY });
    // The requeued one is worked again in this tick (attempt 2), and the never-started one.
    expect(r0.ran).toEqual([its[0].draft_id, its[2].draft_id]);
    expect(items(db)[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(r.finished).toBe(true);
    // done = finished items (looked up incl. failed + canceled): 2 done + 1 failed.
    expect(jobs(db)[0]).toMatchObject({ status: "done", done: 3 });
  });

  it("the lease RELEASE clears only OUR lease: a run that took over just before the release keeps its lease", async () => {
    const db = state.db;
    seedDrafts(db, 1);
    await enqueue();
    const thief = "99999999-0000-4000-8000-000000000006";
    const until = new Date(T0 + 99_000).toISOString();
    db.before = (req) => {
      const body = req.body as Row | null;
      const release = req.method === "PATCH" && req.table === "lookup_jobs" && body && body.lease_token === null;
      if (release) Object.assign(jobs(db)[0], { lease_token: thief, lease_until: until });
    };
    await runLookupJobsTick({ admin: admin(), runItem: runner().fn, now: () => T0 });
    expect(jobs(db)[0].lease_token).toBe(thief);
    expect(jobs(db)[0].lease_until).toBe(until);
  });

  it("the orphan sweep is a compare-and-swap on attempts: an orphan another run already re-claimed is left alone", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    await enqueue();
    const its = items(db);
    Object.assign(its[0], { status: "running", attempts: 1 });
    Object.assign(jobs(db)[0], { status: "running", lease_until: new Date(T0 - 1).toISOString(), lease_token: "99999999-0000-4000-8000-000000000007" });
    db.before = (req) => {
      const body = req.body as Row | null;
      if (req.method === "PATCH" && req.table === "lookup_job_items" && body?.status === "queued" && req.url.searchParams.get("status") === "eq.running") {
        its[0].attempts = 2; // re-claimed by another run between our read and our write
      }
    };
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r.requeued).toBe(0);
    expect(items(db)[0]).toMatchObject({ status: "running", attempts: 2 });
    expect(r0.ran).toEqual([its[1].draft_id]);
    expect(r.finished).toBe(false);
  });

  it("lease LOST mid-run (a later run took over) -> stops writing: the item is not overwritten and no more products start", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    await enqueue();
    const thief = "99999999-0000-4000-8000-000000000005";
    db.before = (req) => {
      const body = req.body as Row | null;
      const heartbeat = req.method === "PATCH" && req.table === "lookup_jobs" && body && "lease_until" in body && !("status" in body) && body.lease_until !== null;
      if (heartbeat) jobs(db)[0].lease_token = thief;
    };
    const r0 = runner();
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r.error).toBe("lease lost");
    expect(r0.ran).toHaveLength(1);
    const its = items(db);
    expect(its[0].status).toBe("running"); // left for the new lease holder's orphan sweep
    expect(its[0].result_json).toBeNull();
    expect(its.slice(1).every((i) => i.status === "queued")).toBe(true);
    expect(jobs(db)[0].lease_token).toBe(thief);
    expect(jobs(db)[0].status).toBe("running");
  });
});

describe("S13 cron tick: failures, Stop, caps", () => {
  it("one product failing never fails the job; a paid failure is counted in the cost", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    await enqueue();
    const r0 = runner((_id, idx) => {
      if (idx === 1) throw named("AiLookupError", "technical detail", { friendly: "The AI lookup timed out.", aiCalls: 1 });
      return okResult();
    });
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r).toMatchObject({ ok: true, started: 3, done: 2, failed: 1, aiCalls: 3, finished: true });
    expect(items(db)[1]).toMatchObject({ status: "failed", error: "The AI lookup timed out.", ai_calls: 1 });
    expect(items(db)[2].status).toBe("done");
    expect(jobs(db)[0]).toMatchObject({ status: "done", done: 3 });
  });

  it("the AI budget cap stops the WHOLE job (every later product would be refused): 0 spend, the rest failed with the same reason", async () => {
    const db = state.db;
    seedDrafts(db, 4);
    await enqueue();
    const r0 = runner(() => {
      throw named("AiBudgetExceededError", "The monthly AI budget is used up.", { aiCalls: 0 });
    });
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r0.ran).toHaveLength(1);
    expect(r.aiCalls).toBe(0);
    expect(items(db).every((i) => i.status === "failed" && i.error === "The monthly AI budget is used up.")).toBe(true);
    expect(items(db).every((i) => i.ai_calls === 0)).toBe(true);
    expect(r.finished).toBe(true);
    expect(jobs(db)[0].status).toBe("done");
  });

  it("a product approved / dismissed before its turn is recorded as canceled with plain copy, not a failure", async () => {
    const db = state.db;
    seedDrafts(db, 2);
    await enqueue();
    const r0 = runner((_id, idx) => {
      if (idx === 0) throw new __test.SkipItem(LEFT_REVIEW_COPY);
      return okResult();
    });
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r).toMatchObject({ failed: 0, done: 1 });
    expect(items(db)[0]).toMatchObject({ status: "canceled", error: LEFT_REVIEW_COPY, ai_calls: 0 });
    expect(jobs(db)[0]).toMatchObject({ status: "done", done: 2 });
  });

  it("a person's Stop while a product is in flight stays 'canceled' (never rewritten to done, no finished audit)", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    await enqueue();
    const jobId = String(jobs(db)[0].id);
    const r0 = runner(async (_id, idx) => {
      if (idx === 0) {
        const c = await cancelManifestLookup(jobId, { userId: USER, email: "m@x" });
        expect(c).toEqual({ ok: true, message: "Batch lookup stopped." });
      }
      return okResult();
    });
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(r0.ran).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, done: 1, finished: true });
    expect(items(db).map((i) => i.status)).toEqual(["done", "canceled", "canceled"]);
    expect(jobs(db)[0].status).toBe("canceled");
    expect(jobs(db)[0].lease_token).toBeNull();
    expect(state.audits.map((a) => a.action)).toContain("catalog_draft.batch_lookup_canceled");
    expect(state.audits.map((a) => a.action)).not.toContain("catalog_draft.batch_lookup_finished");
  });

  it("LOOKUP_ITEMS_PER_TICK=2 -> 2 per tick, the lease released between ticks, the job finishes over 3 ticks", async () => {
    process.env.LOOKUP_ITEMS_PER_TICK = "2";
    const db = state.db;
    seedDrafts(db, 5);
    await enqueue();
    const r0 = runner();
    const t1 = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(t1).toMatchObject({ started: 2, finished: false });
    expect(jobs(db)[0]).toMatchObject({ status: "running", done: 2, lease_token: null, lease_until: null });
    const t2 = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(t2.started).toBe(2);
    const t3 = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => T0 });
    expect(t3).toMatchObject({ started: 1, finished: true });
    expect(new Set(r0.ran).size).toBe(5);
    expect(jobs(db)[0].status).toBe("done");
  });

  it("unset / junk LOOKUP_ITEMS_PER_TICK -> the safe default 12", async () => {
    process.env.LOOKUP_ITEMS_PER_TICK = "lots";
    seedDrafts(state.db, 15);
    await enqueue();
    const r = await runLookupJobsTick({ admin: admin(), runItem: runner().fn, now: () => T0 });
    expect(r.started).toBe(12);
  });

  it("the time budget: no product STARTS when a worst-case lookup could outrun maxDuration", async () => {
    seedDrafts(state.db, 5);
    await enqueue();
    let t = T0;
    const r0 = runner(() => {
      t += 300_000; // each product takes the worst case (300 s)
      return okResult();
    });
    const r = await runLookupJobsTick({ admin: admin(), runItem: r0.fn, now: () => t });
    // 0 s -> start; 300 s + 300 s <= 760 s -> start; 600 s + 300 s > 760 s -> stop.
    expect(r.started).toBe(2);
    expect(jobs(db_()).at(0)?.status).toBe("running");
  });
});

function db_() {
  return state.db;
}

// === 4. runOneItem =================================================================
describe("S13 runOneItem: same doors as the row panel, honest cost accounting", () => {
  const attachOk = (attached: number, queued = 0) => async () => ({
    ok: true,
    receipt: { attached: Array.from({ length: attached }, (_, i) => ({ field: `f${i}` })), queued: Array.from({ length: queued }, (_, i) => ({ field: `q${i}` })) },
    sentence: "Saved.",
  });
  const lookupOk = async () => ({
    result: { found: true, hasAnyFindings: true },
    sources: ["https://example.test/a"],
    model: "gemini-2.5-flash",
    usedWebSearch: true,
    facts: null,
  });

  it("a draft that is gone / left review is a SkipItem with plain copy (no lookup, no spend)", async () => {
    await expect(runOneItem(admin(), draftId(1), { userId: USER, email: null })).rejects.toMatchObject({ name: "SkipItem", copy: DRAFT_GONE_COPY });
    seedDrafts(state.db, 1, { status: "approved" });
    const err = await runOneItem(admin(), draftId(1), { userId: USER, email: null }).catch((e) => e);
    expect(err).toBeInstanceOf(__test.SkipItem);
    expect(err.copy).toBe(LEFT_REVIEW_COPY);
    expect(state.lookupCalls).toBe(0);
  });

  it("a paid lookup counts 1 and goes through attachProductFacts with the onboarding suggestion source", async () => {
    seedDrafts(state.db, 1);
    state.lookup = lookupOk;
    state.attach = attachOk(3, 1);
    const r = await runOneItem(admin(), draftId(1), { userId: USER, email: "m@x" });
    expect(r.aiCalls).toBe(1);
    expect(r.result).toMatchObject({ outcome: "attached", attached: 3, queued: 1, model: "gemini-2.5-flash", sentence: "Saved." });
    const a = state.attachArgs[0] as { context: unknown; suggestionSource: string; sources: string[]; actor: unknown };
    expect(a.context).toEqual({ kind: "draft", draftId: draftId(1) });
    expect(a.suggestionSource).toBe("model:onboarding-lookup");
    expect(a.sources).toEqual(["https://example.test/a"]);
    expect(a.actor).toEqual({ userId: USER, email: "m@x" });
  });

  it("nothing attached but queued for a person -> 'review'", async () => {
    seedDrafts(state.db, 1);
    state.lookup = lookupOk;
    state.attach = attachOk(0, 2);
    expect((await runOneItem(admin(), draftId(1), { userId: null, email: null })).result.outcome).toBe("review");
  });

  it("budget / not-configured refusals are counted 0 (refused BEFORE any request); any other failure counts 1", async () => {
    seedDrafts(state.db, 1);
    for (const [name, calls] of [["AiBudgetExceededError", 0], ["AiNotConfiguredError", 0], ["AiLookupError", 1], ["Error", 1]] as const) {
      state.lookup = async () => {
        throw named(name, "x");
      };
      const err = await runOneItem(admin(), draftId(1), { userId: null, email: null }).catch((e) => e);
      expect(err.aiCalls, name).toBe(calls);
    }
  });

  it("an attach failure AFTER a paid lookup still carries aiCalls=1 (the cost line never under-counts)", async () => {
    seedDrafts(state.db, 1);
    state.lookup = lookupOk;
    state.attach = async () => ({ ok: false, error: "The product could not be saved just now." });
    const err = await runOneItem(admin(), draftId(1), { userId: null, email: null }).catch((e) => e);
    expect(err.message).toBe("The product could not be saved just now.");
    expect(err.aiCalls).toBe(1);
  });

  it("KB-first: a COMPLETE memory skips the paid lookup (0 calls, outcome 'known'); KB_FIRST_ONBOARDING=off never recalls", async () => {
    seedDrafts(state.db, 1);
    state.memory = {
      identityKey: "k",
      facts: [
        { field: "description", value: "A bright flower.", covered: true, source: "kb_published", origin: "kb-exact", confidence: 100, reason: "" },
      ],
      covered: ["description", "short_description", "effects", "aroma", "flavor"],
      missing: [],
      complete: true,
      lastSeen: null,
    };
    state.lookup = lookupOk;
    state.attach = attachOk(0);
    const r = await runOneItem(admin(), draftId(1), { userId: null, email: null });
    expect(state.lookupCalls).toBe(0);
    expect(r.aiCalls).toBe(0);
    expect(r.result.outcome).toBe("known");
    expect(state.recallCalls).toBe(1);

    process.env.KB_FIRST_ONBOARDING = "off";
    state.recallCalls = 0;
    await runOneItem(admin(), draftId(1), { userId: null, email: null });
    expect(state.recallCalls).toBe(0);
    expect(state.lookupCalls).toBe(1);
  });

  it("the query is what the row panel would prefill: [product name, brand + vendor]", async () => {
    const q = await lookupQueryForDraft({
      id: draftId(1), name: "Blue Dream 3.5g", brand_name: "Acme", vendor_name: "Acme Farms", pos_product_key: null,
      inventory_type: null, category: null, strain_name: null, status: "draft",
    });
    expect(q).toEqual({ query: "Blue Dream 3.5g Acme Acme Farms", productName: "Blue Dream 3.5g", vendorOrBrand: "Acme Acme Farms" });
  });
});

// === 5. Cancel + page read ===========================================================
describe("S13 cancel + the page read", () => {
  it("cancel: queued items canceled, done items kept, audited once; a second Stop says it already finished", async () => {
    const db = state.db;
    seedDrafts(db, 3);
    const e = (await enqueue()) as { jobId: string };
    items(db)[0].status = "done";
    const r = await cancelManifestLookup(e.jobId, { userId: USER, email: "m@x" });
    expect(r).toEqual({ ok: true, message: "Batch lookup stopped." });
    expect(items(db).map((i) => i.status)).toEqual(["done", "canceled", "canceled"]);
    expect(jobs(db)[0].status).toBe("canceled");
    const again = await cancelManifestLookup(e.jobId, { userId: USER, email: "m@x" });
    expect(again).toEqual({ ok: true, message: "That batch lookup had already finished." });
    expect(state.audits.filter((a) => a.action === "catalog_draft.batch_lookup_canceled")).toHaveLength(1);
    expect((await cancelManifestLookup("nope", { userId: null, email: null })).ok).toBe(false);
  });

  it("no job yet: the button's count is the SAME plan the press would queue", async () => {
    seedDrafts(state.db, 4);
    seedDrafts(state.db, 1, { status: "approved", from: 30 });
    const s = await loadManifestLookup(M);
    expect(s).toMatchObject({ state: "none", eligible: { count: 4, skippedDone: 0, truncated: 0 } });
    const press = await enqueue();
    expect(press).toMatchObject({ total: 4 });
  });

  it("after a finished job: rows map by draft id, done drafts are excluded from the next count", async () => {
    const db = state.db;
    const ids = seedDrafts(db, 2);
    await enqueue();
    await runLookupJobsTick({ admin: admin(), runItem: runner().fn, now: () => T0 });
    seedDrafts(db, 1, { from: 7 });
    const s = await loadManifestLookup(M);
    if (s.state !== "job") throw new Error(`expected job, got ${s.state}`);
    expect(s.job.status).toBe("done");
    expect(s.job.summary).toMatchObject({ total: 2, lookedUp: 2, aiCalls: 2, finished: true });
    expect([...s.job.items.keys()].sort()).toEqual(ids.map((i) => i.toLowerCase()).sort());
    expect(s.job.model).toBe("gemini-test");
    expect(s.eligible).toEqual({ count: 1, skippedDone: 2, truncated: 0 });
  });

  it("migration missing -> 'migration'; flag off -> 'off' without a request", async () => {
    state.db.missing.add("lookup_jobs");
    expect((await loadManifestLookup(M)).state).toBe("migration");
    process.env.MANIFEST_BATCH_LOOKUP = "off";
    state.db.log.length = 0;
    expect((await loadManifestLookup(M)).state).toBe("off");
    expect(state.db.log).toHaveLength(0);
  });
});

// === 6. Wiring ========================================================================
describe("S13 wiring", () => {
  it("the route's maxDuration equals LOOKUP_TICK_MAX_DURATION_S (800 s, Vercel Pro max with Fluid compute)", async () => {
    const route = await import("@/app/api/cron/lookup-jobs/route");
    expect(route.maxDuration).toBe(LOOKUP_TICK_MAX_DURATION_S);
    expect(LOOKUP_TICK_MAX_DURATION_S).toBe(800);
    expect(route.dynamic).toBe("force-dynamic");
    const src = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/runLookupJobsTick\(\)/);
  });
  it("vercel.json runs the tick every minute", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(v.crons.filter((c) => c.path === "/api/cron/lookup-jobs")).toEqual([{ path: "/api/cron/lookup-jobs", schedule: "* * * * *" }]);
  });
  it("the actions never read process.env and require inventory.manage", () => {
    const src = read("src/app/admin/inventory/drafts/actions.ts");
    const body = src.slice(src.indexOf("export async function lookupAllAction"));
    expect(body).not.toMatch(/process\.env/);
    // R37 S4: rereadDeliveryCoasAction (appended after these two) also requires it.
    // R37 S5: setDeliveryBrandAction + setDraftBrandAction too (5 in total).
    expect(body.match(/requirePermission\("inventory\.manage"\)/g)?.length).toBe(5);
  });
  it("lookupAllAction (behavioural): enqueues and redirects with lookup=started, then lookup=exists", async () => {
    seedDrafts(state.db, 2);
    const { lookupAllAction } = await import("@/app/admin/inventory/drafts/actions");
    const fd = new FormData();
    fd.set("return_manifest", M);
    await expect(lookupAllAction(M, fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.calls).toContain("perm:inventory.manage");
    const r1 = state.calls.find((c) => c.startsWith("redirect:"))!;
    expect(r1).toMatch(/lookup=started/);
    state.calls = [];
    await expect(lookupAllAction(M, fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.calls.find((c) => c.startsWith("redirect:"))).toMatch(/lookup=exists/);
    expect(jobs(state.db)).toHaveLength(1);
  });
  it("cancelLookupAction (behavioural): lookup=stopped", async () => {
    seedDrafts(state.db, 1);
    const e = (await enqueue()) as { jobId: string };
    const { cancelLookupAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(cancelLookupAction(e.jobId)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.calls.find((c) => c.startsWith("redirect:"))).toMatch(/lookup=stopped/);
    expect(jobs(state.db)[0].status).toBe("canceled");
  });
  it("the page shows the panel, the button, the per-row line and the result banner", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    for (const id of ["batch-lookup", "batch-lookup-button", "batch-lookup-progress", "batch-lookup-row", "lookup-result", "batch-lookup-choose", "batch-lookup-choice"]) {
      expect(page, id).toContain(`data-testid="${id}"`);
    }
    // R21: the migration / reason line shares one <p>; its testid is chosen by state.
    expect(page).toContain('data-testid={batchLookup?.state === "migration" ? "batch-lookup-migration" : "batch-lookup-reason"}');
    expect(page).toMatch(/lookupAllAction/);
    expect(page).toMatch(/cancelLookupAction/);
  });
  it("migration 0242 + rollback: zero SQL-editor transit hazards; the partial unique index is the enqueue lock", () => {
    const MIG = "supabase/migrations/0242_lookup_jobs.sql";
    const RB = "supabase/rollbacks/0242_lookup_jobs.rollback.sql";
    for (const f of [MIG, RB]) {
      const h = transitHazards(read(f));
      expect(h.oddApostrophe, f).toBe(0);
      expect(h.withSemicolon, f).toBe(0);
      expect(h.bareRelationWord, f).toBe(0);
      expect(h.nonAscii, f).toBe(0);
      expect(h.semicolonInString, f).toBe(0);
    }
    const sql = read(MIG);
    expect(sql).toMatch(/create unique index if not exists lookup_jobs_one_active_per_manifest\s+on public\.lookup_jobs \(manifest_id\)\s+where status in \('queued', 'running'\)/);
    expect(sql).toMatch(/constraint lookup_job_items_one_per_draft unique \(job_id, draft_id\)/);
    const rb = read(RB);
    expect(rb).toMatch(/drop table if exists public\.lookup_job_items/);
    expect(rb).toMatch(/drop table if exists public\.lookup_jobs/);
  });
});
