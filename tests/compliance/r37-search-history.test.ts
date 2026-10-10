/**
 * R37 S6 - the "search the web for every product" bar knows what earlier
 * searches found (owner: "enhance the search all products using Google Gemini
 * feature so that it is aware of past searches for the products in the
 * invoice ... I want to know which products and what was found ... before
 * running the search again ... maybe the vendor added new info online ... it
 * may be worth rerunning the search ... make it more obvious it's there and
 * what it is meant to do. It should be run every time for the first while
 * until all facts have been harvested ... smart and connected and
 * informative.").
 *
 *   1. pure core: exact self-test count + runner pin + purity.
 *   2. loadDeliveryLookupHistory through the REAL postgrest-js client on an
 *      in-memory PostgREST: this row / another row of this delivery / the
 *      same product on an EARLIER delivery; row lookups from the audit log;
 *      found facts from gemini provenance only; missing tables are "no
 *      history", an outage is reported incomplete (never "no history");
 *      paging past 1000 rows is complete.
 *   3. Search again: queues ONLY the chosen products still in review on THIS
 *      delivery, bypasses the already-done skip, marks each item, keeps the
 *      one-active-job lock; the worker runs a marked item with refresh (a
 *      fresh web search, no memory short-cut, no already-known block).
 *   4. the action + page wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";

import { FakePostgrest } from "./helpers/fake-postgrest";
import { AGAIN_MARKER, __runLookupHistoryCoreTests, summarizeDeliveryHarvest } from "@/lib/catalog/lookup-history-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const M = "aaaaaaaa-0000-4000-8000-000000000001";
const M_OLD = "aaaaaaaa-0000-4000-8000-000000000009";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";
const D1 = "dddddddd-0000-4000-8000-000000000001";
const D2 = "dddddddd-0000-4000-8000-000000000002";
const D3 = "dddddddd-0000-4000-8000-000000000003";
const SIB = "dddddddd-0000-4000-8000-0000000000aa"; // same product, this delivery
const OLD = "dddddddd-0000-4000-8000-0000000000bb"; // same product, earlier delivery
const KEY = "acme|flower|gelato";
const KEY2 = "acme|vape|zkittlez";

const state = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  svc: true,
  audits: [] as Array<{ action: string; after: unknown }>,
  calls: [] as string[],
  memory: null as unknown,
  lookupArgs: [] as Array<{ alreadyKnown?: string }>,
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
  recordAudit: async (a: { action: string; after: unknown }) => {
    state.audits.push({ action: a.action, after: a.after });
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) };
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
  isAiConfigured: true,
  lookupProduct: async (args: { alreadyKnown?: string }) => {
    state.lookupArgs.push(args);
    return { result: { found: true, hasAnyFindings: true }, sources: [], model: "gemini-2.5-pro", usedWebSearch: true, facts: null };
  },
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [] }));
vi.mock("@/lib/catalog/fact-memory", () => ({ recallForDraft: async () => state.memory }));
vi.mock("@/lib/catalog/attach-facts", () => ({
  attachProductFacts: async () => ({ ok: true, receipt: { attached: [{ field: "aroma" }], queued: [] }, sentence: "Saved." }),
}));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async () => [],
  resolveWebsiteCategoryForLot: async () => null,
}));

import { HISTORY_CHUNK, loadDeliveryLookupHistory } from "@/lib/catalog/lookup-history-server";
import { AGAIN_NONE_COPY, enqueueManifestLookup, runLookupJobsTick, runOneItem } from "@/lib/catalog/lookup-job-server";

const iso = (daysAgo: number) => new Date(Date.parse("2026-06-01T19:00:00Z") - daysAgo * 86_400_000).toISOString();

function freshDb(): FakePostgrest {
  const db = new FakePostgrest();
  db.uniques.push({ table: "lookup_jobs", columns: ["manifest_id"], where: (r) => r.status === "queued" || r.status === "running", name: "lookup_jobs_one_active_per_manifest" });
  db.uniques.push({ table: "lookup_job_items", columns: ["job_id", "draft_id"], name: "lookup_job_items_one_per_draft" });
  let clock = 0;
  const stamp = () => new Date(Date.parse("2026-06-01T00:00:00Z") + ++clock * 1000).toISOString();
  db.defaults.set("lookup_jobs", () => ({ status: "queued", total: 0, done: 0, created_by: null, created_at: stamp(), started_at: null, finished_at: null, lease_until: null, lease_token: null, updated_at: stamp() }));
  db.defaults.set("lookup_job_items", () => ({ position: 0, status: "queued", attempts: 0, ai_calls: 0, result_json: null, error: null, started_at: null, finished_at: null, updated_at: stamp() }));
  state.db = db;
  return db;
}

function draft(db: FakePostgrest, id: string, manifest: string, key: string | null, status = "draft", n = 1) {
  db.rows("catalog_product_drafts").push({
    id,
    manifest_id: manifest,
    identity_key: key,
    status,
    name: `Product ${id.slice(-2)}`,
    brand_name: "Acme",
    vendor_name: "Acme Farms",
    pos_product_key: null,
    inventory_type: null,
    category: null,
    strain_name: null,
    chosen_website_category: null,
    created_at: iso(10 - n),
  });
}

function seedHistory(db: FakePostgrest) {
  draft(db, D1, M, KEY, "draft", 1);
  draft(db, D2, M, KEY2, "draft", 2);
  draft(db, SIB, M, KEY, "approved", 3);
  draft(db, OLD, M_OLD, KEY, "approved", 4);
  db.rows("lookup_jobs").push({ id: "job-old", manifest_id: M_OLD, status: "done", created_at: iso(120) });
  db.rows("lookup_jobs").push({ id: "job-now", manifest_id: M, status: "done", created_at: iso(2) });
  db.rows("lookup_job_items").push(
    { id: "i1", job_id: "job-old", draft_id: OLD, status: "done", result_json: { outcome: "attached", attached: 4, queued: 1 }, finished_at: iso(120) },
    { id: "i2", job_id: "job-now", draft_id: D1, status: "done", result_json: { outcome: "nothing_new", attached: 0, queued: 0 }, finished_at: iso(2) },
    { id: "i3", job_id: "job-now", draft_id: SIB, status: "failed", result_json: null, finished_at: iso(2) },
    { id: "i4", job_id: "job-now", draft_id: D2, status: "canceled", result_json: null, finished_at: iso(2) },
    { id: "i5", job_id: "job-now", draft_id: D2, status: "queued", result_json: AGAIN_MARKER, finished_at: null },
  );
  db.rows("audit_logs").push(
    { id: 1, action: "catalog_draft.ai_lookup", entity_type: "catalog_drafts", entity_id: D2, after_json: { found: false }, created_at: iso(5) },
    { id: 2, action: "catalog_draft.ai_lookup", entity_type: "catalog_drafts", entity_id: OLD, after_json: { found: true, memory: { skippedGemini: true } }, created_at: iso(130) },
    { id: 3, action: "catalog_draft.approved", entity_type: "catalog_drafts", entity_id: D1, after_json: { found: true }, created_at: iso(1) },
    { id: 4, action: "catalog_draft.ai_lookup", entity_type: "lots", entity_id: D1, after_json: { found: true }, created_at: iso(1) },
  );
  db.rows("product_fact_provenance").push(
    { id: "p1", identity_key: KEY, field: "effects", source: "gemini", created_at: iso(120) },
    { id: "p2", identity_key: KEY, field: "description", source: "gemini", created_at: iso(120) },
    { id: "p3", identity_key: KEY, field: "aroma", source: "human", created_at: iso(50) },
    { id: "p4", identity_key: KEY2, field: "flavor", source: "coa", created_at: iso(5) },
  );
}

const targets = () => [
  { draftId: D1, keys: [KEY] },
  { draftId: D2, keys: [KEY2, ""] },
];

const ENV_KEYS = ["MANIFEST_BATCH_LOOKUP", "ATTACH_FACTS_V2", "KB_FIRST_ONBOARDING"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  freshDb();
  state.svc = true;
  state.audits = [];
  state.calls = [];
  state.memory = null;
  state.lookupArgs = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// === 1 ===========================================================================
describe("R37 S6 pure core", () => {
  it("self-tests pass with the exact count", () => {
    const r = __runLookupHistoryCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(67);
  });
  it("the pure runner pins the same floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("lookup-history-core", __runLookupHistoryCoreTests(), 67)');
  });
  it("the core is pure (no imports, no env)", () => {
    const src = read("src/lib/catalog/lookup-history-core.ts");
    expect(src).not.toMatch(/process\.env/);
    expect(src.split("\n").filter((l) => /^\s*import\b/.test(l))).toEqual([]);
  });
});

// === 2 ===========================================================================
describe("R37 S6 loadDeliveryLookupHistory (real postgrest-js)", () => {
  it("joins this row, this delivery and an earlier delivery of the same product; row lookups from the audit; gemini facts only", async () => {
    seedHistory(state.db);
    const h = await loadDeliveryLookupHistory(M, targets());
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.complete).toBe(true);
    const a = h.byDraft.get(D1)!;
    const where = a.searches.map((s) => `${s.where}:${s.kind}:${s.outcome}`).sort();
    expect(where).toEqual([
      "earlier delivery:batch:found",
      "earlier delivery:row:known",
      "this delivery:batch:failed",
      "this row:batch:nothing_new",
    ]);
    expect(a.searches.find((s) => s.where === "earlier delivery" && s.kind === "batch")).toMatchObject({ attached: 4, queued: 1 });
    expect(a.found.map((f) => f.field).sort()).toEqual(["description", "effects"]); // the human aroma is NOT a web find
    const b = h.byDraft.get(D2)!;
    expect(b.searches.map((s) => `${s.where}:${s.kind}:${s.outcome}`)).toEqual(["this row:row:not_found"]); // canceled + queued items are not searches
    expect(b.found).toEqual([]); // a coa fact is not a web find
  });

  it("the verdict the page shows from that history (D1 saturated -> wait after 90 days; D2 never-productive -> recommended)", async () => {
    seedHistory(state.db);
    const h = await loadDeliveryLookupHistory(M, targets());
    if (!h.ok) throw new Error("read failed");
    const v = summarizeDeliveryHarvest(
      [
        { draftId: D1, name: "Gelato", ...h.byDraft.get(D1)!, missing: ["terpenes"] },
        { draftId: D2, name: "Zkittlez", ...h.byDraft.get(D2)!, missing: ["aroma"] },
      ],
      new Date("2026-06-01T19:00:00Z"),
      { doneInThisDelivery: new Set([D1.toLowerCase()]), complete: h.complete },
    );
    const p1 = v.products.find((p) => p.draftId === D1)!;
    const p2 = v.products.find((p) => p.draftId === D2)!;
    expect(p1.status).toBe("saturated");
    expect(p1.searchCount).toBe(4);
    expect(p1.line).toContain("the web has given: effects, description");
    expect(p2.status).toBe("saturated"); // its only search (5 days ago) found nothing
    expect(v.tone).toBe("wait");
    expect(v.againIds).toEqual([]);
  });

  it("a missing provenance / lookup table is 'no history of that kind', still complete", async () => {
    seedHistory(state.db);
    state.db.missing.add("product_fact_provenance");
    state.db.missing.add("lookup_job_items");
    const h = await loadDeliveryLookupHistory(M, targets());
    if (!h.ok) throw new Error("read failed");
    expect(h.complete).toBe(true);
    expect(h.byDraft.get(D1)!.found).toEqual([]);
    expect(h.byDraft.get(D1)!.searches.every((s) => s.kind === "row")).toBe(true);
  });

  it("an outage on the audit read is reported INCOMPLETE (never silently 'no history')", async () => {
    seedHistory(state.db);
    state.db.before = (req) => (req.table === "audit_logs" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const h = await loadDeliveryLookupHistory(M, targets());
    if (!h.ok) throw new Error("read failed");
    expect(h.complete).toBe(false);
  });

  it("a pre-0234 database (no identity_key column) reads own-row history only, complete", async () => {
    seedHistory(state.db);
    state.db.before = (req) =>
      req.table === "catalog_product_drafts" ? { status: 400, body: { code: "42703", message: 'column catalog_product_drafts.identity_key does not exist' } } : undefined;
    const h = await loadDeliveryLookupHistory(M, targets());
    if (!h.ok) throw new Error("read failed");
    expect(h.complete).toBe(true);
    expect(h.byDraft.get(D1)!.searches.map((s) => s.where)).toEqual(["this row"]);
  });

  it("pages past 1000 rows (never a silent cap) and chunks long id lists", async () => {
    draft(state.db, D1, M, KEY);
    for (let i = 0; i < 1203; i++) {
      state.db.rows("audit_logs").push({ id: 10 + i, action: "catalog_draft.ai_lookup", entity_type: "catalog_drafts", entity_id: D1, after_json: { found: false }, created_at: iso(3) });
    }
    const many = Array.from({ length: HISTORY_CHUNK + 5 }, (_, i) => ({ draftId: `eeeeeeee-0000-4000-8000-${String(i).padStart(12, "0")}`, keys: [] as string[] }));
    const h = await loadDeliveryLookupHistory(M, [{ draftId: D1, keys: [KEY] }, ...many]);
    if (!h.ok) throw new Error("read failed");
    expect(h.complete).toBe(true);
    expect(h.byDraft.get(D1)!.searches).toHaveLength(1203);
    const auditReads = state.db.log.filter((r) => r.table === "audit_logs");
    expect(auditReads.length).toBeGreaterThanOrEqual(3); // 2 pages for chunk 1 + chunk 2
    expect(auditReads.every((r) => r.url.searchParams.get("limit") !== null && r.url.searchParams.get("order") === "id.asc")).toBe(true);
  });

  it("not configured -> ok:false with no request; no targets -> empty, no request", async () => {
    state.svc = false;
    expect(await loadDeliveryLookupHistory(M, targets())).toEqual({ ok: false });
    state.svc = true;
    const r = await loadDeliveryLookupHistory(M, []);
    expect(r.ok && r.byDraft.size === 0).toBe(true);
    expect(state.db.log).toHaveLength(0);
  });
});

// === 3 ===========================================================================
describe("R37 S6 Search again (enqueue + worker)", () => {
  function seedDone() {
    draft(state.db, D1, M, KEY, "draft", 1);
    draft(state.db, D2, M, KEY2, "draft", 2);
    draft(state.db, D3, M, null, "approved", 3);
    state.db.rows("lookup_jobs").push({ id: "job-1", manifest_id: M, status: "done", created_at: iso(2) });
    state.db.rows("lookup_job_items").push(
      { id: "a", job_id: "job-1", draft_id: D1, status: "done", result_json: { outcome: "attached" }, finished_at: iso(2) },
      { id: "b", job_id: "job-1", draft_id: D2, status: "done", result_json: { outcome: "attached" }, finished_at: iso(2) },
    );
  }

  it("the plain press skips drafts already done (why Search again exists)", async () => {
    seedDone();
    const r = await enqueueManifestLookup(M, { userId: USER, email: null });
    expect(r).toMatchObject({ ok: false, code: "nothing" });
  });

  it("queues ONLY the chosen products still in review on this delivery, marked for a fresh search; audited as again", async () => {
    seedDone();
    const r = await enqueueManifestLookup(M, { userId: USER, email: "m@x" }, { againDraftIds: [D1, D3, "junk", D1.toUpperCase(), "ffffffff-0000-4000-8000-000000000000"] });
    expect(r).toMatchObject({ ok: true, kind: "created", total: 1 });
    const job = state.db.rows("lookup_jobs").find((j) => j.status === "queued")!;
    const items = state.db.rows("lookup_job_items").filter((i) => i.job_id === job.id);
    expect(items.map((i) => i.draft_id)).toEqual([D1]); // D3 approved, the stranger not on this delivery
    expect(items[0].result_json).toEqual({ again: true });
    expect(state.audits).toEqual([{ action: "catalog_draft.batch_lookup_enqueued", after: expect.objectContaining({ again: true, total: 1 }) }]);
  });

  it("nothing valid to search again -> plain copy, no request at all", async () => {
    seedDone();
    const r = await enqueueManifestLookup(M, { userId: USER, email: null }, { againDraftIds: ["x", 3] });
    expect(r).toEqual({ ok: false, code: "nothing", message: AGAIN_NONE_COPY });
    expect(state.db.log).toHaveLength(0);
    const r2 = await enqueueManifestLookup(M, { userId: USER, email: null }, { againDraftIds: [D3] });
    expect(r2).toEqual({ ok: false, code: "nothing", message: AGAIN_NONE_COPY });
  });

  it("still one active job per delivery: an active job is returned, nothing new written", async () => {
    seedDone();
    state.db.rows("lookup_jobs").push({ id: "job-live", manifest_id: M, status: "running", created_at: iso(0) });
    const before = state.db.log.length;
    const r = await enqueueManifestLookup(M, { userId: USER, email: null }, { againDraftIds: [D1] });
    expect(r).toEqual({ ok: true, kind: "exists", jobId: "job-live" });
    expect(state.db.log.slice(before).every((q) => q.method === "GET")).toBe(true);
  });

  it("the worker runs a marked item with refresh=true and a plain item with refresh=false", async () => {
    seedDone();
    await enqueueManifestLookup(M, { userId: USER, email: null }, { againDraftIds: [D1] });
    const seen: Array<{ id: string; refresh: unknown }> = [];
    const runItem = (async (_a: unknown, id: string, _actor: unknown, opts?: { refresh?: boolean }) => {
      seen.push({ id, refresh: opts?.refresh });
      return { aiCalls: 1, result: { outcome: "attached", attached: 1, queued: 0, sentence: "", model: "gemini-2.5-pro" } };
    }) as unknown as typeof runOneItem;
    const r = await runLookupJobsTick({ admin: new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never, runItem, now: () => Date.parse("2026-06-01T19:00:00Z") });
    expect(r).toMatchObject({ done: 1, finished: true });
    expect(seen).toEqual([{ id: D1, refresh: true }]);
    // the result replaced the marker (a finished item never reads as "again")
    const item = state.db.rows("lookup_job_items").find((i) => i.draft_id === D1 && i.status === "done" && i.id !== "a")!;
    expect((item.result_json as { outcome: string }).outcome).toBe("attached");
    expect("again" in (item.result_json as object)).toBe(false);
  });

  it("runOneItem refresh: a COMPLETE memory no longer short-cuts the web, and no already-known block is sent", async () => {
    draft(state.db, D1, M, KEY);
    const memory = { identityKey: KEY, complete: true, facts: [{ field: "aroma", value: "pine", covered: true }], covered: ["aroma"], missing: [], lastSeen: null };
    state.memory = memory;
    const plain = await runOneItem(new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never, D1, { userId: null, email: null });
    expect(plain.result.outcome).toBe("known");
    expect(state.lookupArgs).toHaveLength(0);
    state.memory = { ...memory, complete: false, missing: ["flavor"] };
    await runOneItem(new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never, D1, { userId: null, email: null });
    expect(state.lookupArgs[0].alreadyKnown).toContain("pine");
    state.memory = memory;
    const fresh = await runOneItem(new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) as never, D1, { userId: null, email: null }, { refresh: true });
    expect(fresh.aiCalls).toBe(1);
    expect(state.lookupArgs).toHaveLength(2);
    expect(state.lookupArgs[1].alreadyKnown).toBe("");
  });
});

// === 4 ===========================================================================
describe("R37 S6 action + page wiring", () => {
  it("lookupAgainAction: inventory.manage, passes every again_id, redirects with the shared lookup banner", async () => {
    draft(state.db, D1, M, KEY);
    state.db.rows("lookup_jobs").push({ id: "job-1", manifest_id: M, status: "done", created_at: iso(2) });
    state.db.rows("lookup_job_items").push({ id: "a", job_id: "job-1", draft_id: D1, status: "done", result_json: { outcome: "nothing_new" }, finished_at: iso(2) });
    const { lookupAgainAction } = await import("@/app/admin/inventory/drafts/actions");
    const fd = new FormData();
    fd.set("return_manifest", M);
    fd.append("again_id", D1);
    await expect(lookupAgainAction(M, fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.calls[0]).toBe("perm:inventory.manage");
    expect(state.calls.find((c) => c.startsWith("redirect:"))).toContain("lookup=started");
    const fd2 = new FormData();
    fd2.set("return_manifest", M);
    await expect(lookupAgainAction(M, fd2)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.calls.filter((c) => c.startsWith("redirect:")).pop()).toContain("lookup=nothing");
  });

  it("the page: the bar names its engine + purpose, shows the verdict, product history and Search again", () => {
    const src = read("src/app/admin/inventory/drafts/page.tsx");
    expect(src).toContain("harvestBarTitle(productLookupModelId)");
    expect(src).toContain('data-testid="batch-lookup-purpose"');
    expect(src).toContain('data-testid="harvest-verdict"');
    expect(src).toContain('data-testid="harvest-history"');
    expect(src).toContain('data-testid="harvest-again"');
    expect(src).toContain('name="again_id"');
    expect(src).toContain("lookupAgainAction.bind(null, focus.manifestId)");
    expect(src).toContain('data-testid="draft-row-search-history"');
    // Search again never offered while a batch runs (one active job)
    expect(src).toMatch(/harvest\.againIds\.length > 0 && !batchLookupActive/);
    // the bar and the row read the SAME fact view
    expect(src).toContain("const facts = factsByDraft.get(d.id) ?? null;");
    expect(src).toMatch(/missing: f \? f\.missing\.filter\(\(m\) => \(HARVEST_FIELDS as readonly string\[\]\)\.includes\(m\)\) : null/);
    // history read only where the bar shows
    expect(src).toMatch(/batchLookupOn && focus\.manifestId && drafts\.length > 0\s*\? await loadDeliveryLookupHistory/);
  });

  it("the history reader never uses .limit() and is server-only", () => {
    const src = read("src/lib/catalog/lookup-history-server.ts");
    expect(src).toMatch(/^import "server-only";/m);
    expect(src).not.toMatch(/\.limit\(/);
    expect(src.match(/\.range\(from, to\)/g)?.length).toBe(4);
  });
});
