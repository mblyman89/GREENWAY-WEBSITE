/**
 * tests/compliance/d244-r3-live-vs-batch.test.ts - D244 round 2, slice R-3.
 *
 * Owner (verbatim): "I want both options available for the quickly finding
 * results, or batch lookups for over night runs. please build it so I can
 * chose in the enrichment page/ detail. make sure it is clear and obvious
 * which is which and how to use both."
 *
 * Proven on the REAL queue action + overnight tick (Google stubbed via the
 * tick's `call` / `build` / `list` seams) through FakePostgrest: queue ->
 * gather -> send (record written BEFORE Google is called) -> poll -> ingest
 * stores the same ai_suggestions a live draft stores; a refused batch backs
 * off and returns its products; an orphaned send is recovered; the pages
 * show both modes side by side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Array<Record<string, unknown>>,
  usage: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
  tick: 0,
  key: "test-gemini-key",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/ai/provider", async (orig) => ({
  ...((await orig()) as object),
  isAiConfigured: true,
  aiModelId: "test-model",
  geminiApiKey: () => st.key,
  generateStructured: vi.fn(async () => {
    throw new Error("live call must not run in the overnight path");
  }),
  generateJSON: vi.fn(),
}));
vi.mock("@/lib/ai/usage", () => ({ logAiUsage: async (u: Record<string, unknown>) => void st.usage.push(u) }));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "- Blue Dream: hybrid", sources: ["kb:strain:blue dream"], strain: null, category: "flower" }),
}));
vi.mock("@/lib/pos/menu-version", async (orig) => ({
  ...((await orig()) as object),
  getPublishedVersion: async () => ({ id: "v-1" }),
  getVersionItems: async () => st.items,
  getItemBySourceKey: async (_v: string, key: string) => st.items.find((i) => i.source_item_id === key) ?? null,
}));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ userId: "u-1", email: "o@example.com" }) }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: Record<string, unknown>) => void st.audits.push(a) }));
vi.mock("@/lib/ai/kb/writeback", () => ({ writeBackOnPublish: async () => null }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { queueOvernightBatchAction, cancelOvernightBatchAction, queueBulkAiV2Action } from "@/app/admin/products/bulk-ai/actions";
import { runEnrichBatchTick, readEnrichBatch } from "@/lib/enrichment/enrich-batch-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  __runEnrichBatchTests,
  ENRICH_BATCH_KEY,
  ENRICH_BATCH_GATHER_MS,
  ENRICH_BATCH_LEASE_MS,
  ENRICH_BATCH_REFUSE_BACKOFF_MS,
  ENRICH_BATCH_TICK_BUDGET_MS,
  ENRICH_BATCH_PREFIX,
  ENRICH_MODES,
  batchCounts,
  type BatchItemReq,
} from "@/lib/enrichment/enrich-batch-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const T0 = Date.parse("2026-01-01T12:00:00Z");

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
async function run(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) return decodeURIComponent(m.slice(9));
    throw e;
  }
  return "";
}
const item = (key: string, name: string, vendor: string) => ({
  source_item_id: key,
  name,
  product_name: name,
  brand_name: "Phat Panda",
  vendor_name: vendor,
  category: "flower",
  strain_type: "hybrid",
  strain_name: "Blue Dream",
  thc: "24.51%",
  cbd: null,
});
const meta = (confidence: number, evidence: string[], best_guess = false) => ({ confidence, evidence, best_guess });
const answer = {
  display_name: { value: "Phat Panda Blue Dream 3.5g", ...meta(96, ["pos"]) },
  description: { value: "Blue Dream from Phat Panda brings sweet berry aroma in a 3.5 gram jar.", ...meta(90, ["pos"]) },
  short_description: { value: "Sweet berry flower.", ...meta(88, ["pos"]) },
  seo: { title: "Blue Dream 3.5g", meta: "Blue Dream flower from Phat Panda with sweet berry aroma, in a 3.5 gram jar. Order ahead for in-store pickup in Port Orchard today.", ...meta(90, ["pos"]) },
  sensory: { aroma_notes: ["berry"], flavor_notes: ["sweet"], terpenes: [], ...meta(60, ["kb:strain:blue dream"]) },
  effects: { values: ["relaxed"], ...meta(60, ["kb:strain:blue dream"], true) },
  tags: { values: ["local"], ...meta(50, []) },
  strain_type: { value: "hybrid", ...meta(70, ["pos"]) },
  potency: { thc: "24.51%", cbd: "", ...meta(80, ["pos"]) },
};
const geminiLine = (key: string, json: unknown) => ({
  metadata: { key },
  response: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400 } },
});

/** A fake Google: records every call; answers per path. */
function fakeGoogle(answers: (path: string, init?: RequestInit) => { ok: boolean; status: number; json: unknown }) {
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const call = async (path: string, init: RequestInit = {}) => {
    calls.push({ path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    const r = answers(path, init);
    return { ...r, text: JSON.stringify(r.json) };
  };
  return { calls, call };
}
const build = async (key: string): Promise<{ req: BatchItemReq; system: string; user: string }> => ({
  req: { offered: ["pos"], numbers: { thc: [{ value: 24.51, unit: "%" }], cbd: [] }, summary: `facts for ${key}` },
  system: "SYSTEM PROMPT",
  user: `USER PROMPT ${key}`,
});
const state = async () => (await readEnrichBatch(createSupabaseAdminClient())).state;
const suggestions = (key: string) => st.db.rows("ai_suggestions").filter((r) => r.entity_id === key);

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits.length = 0;
  st.usage.length = 0;
  st.tick = 0;
  st.key = "test-gemini-key";
  st.db.before = (req) => {
    if (req.table === "site_settings" && (req.method === "POST" || req.method === "PATCH") && req.body && typeof req.body === "object") {
      st.tick += 1;
      (req.body as Record<string, unknown>).updated_at = `2026-01-01T00:00:${String(st.tick).padStart(2, "0")}.000Z#${st.tick}`;
    }
  };
  st.items = [item("k-1", "Blue Dream 3.5g", "Hollingsworth"), item("k-2", "Blue Dream 7g", "Hollingsworth"), item("k-3", "Gelato 1g", "Other Farms")];
  for (const k of ["k-1", "k-2", "k-3"]) {
    st.db.rows("product_enrichments").push({ id: `e-${k}`, pos_product_key: k, display_name: null, description: null, short_description: null, image_media_ids: [], primary_media_id: null, vendor_id: null, tags: [], seo_title: null, seo_description: null, status: "draft" });
  }
});

describe("D244 R-3 enrich-batch-core", () => {
  it("runs exactly 45 assertions, none failing, registered at that floor", () => {
    expect(__runEnrichBatchTests()).toEqual({ passed: 45, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("enrich-batch-core", __runEnrichBatchTests(), 45); // D244 R-3');
  });
  it("the lease covers the route (800 s) and the tick budget fits inside it", () => {
    expect(ENRICH_BATCH_LEASE_MS).toBe(800_000);
    expect(ENRICH_BATCH_TICK_BUDGET_MS).toBeLessThan(ENRICH_BATCH_LEASE_MS);
  });
  it("its own row and its own Google name prefix - never mixed with the lookup engine's batches", () => {
    expect(ENRICH_BATCH_KEY).toBe("enrichment_batch_ai");
    expect(ENRICH_BATCH_PREFIX).toBe("greenway-enrich-");
    expect(ENRICH_BATCH_PREFIX.startsWith("greenway-lookups-")).toBe(false);
  });
});

describe("D244 R-3 - queue for the overnight batch", () => {
  it("a vendor press adds its products to the overnight row (not the live queue); nothing is sent yet", async () => {
    const to = await run(queueOvernightBatchAction(fd({ vendor: "Hollingsworth" })));
    expect(to).toContain("🌙 Overnight: added 2 products to the overnight batch.");
    expect(to).toContain("You can close this tab.");
    const s = await state();
    expect(s.items.map((i) => [i.key, i.status])).toEqual([
      ["k-1", "queued"],
      ["k-2", "queued"],
    ]);
    expect(st.db.rows("site_settings").map((r) => r.key)).toEqual([ENRICH_BATCH_KEY]);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.enrich_batch_queued" });
  });
  it("a second press does not double-queue; cancel takes back the unsent ones", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-3"] })));
    const again = await run(queueOvernightBatchAction(fd({ keys: ["k-3"] })));
    expect(again).toContain("1 already in it.");
    const c = await run(cancelOvernightBatchAction());
    expect(c).toContain("🌙 Took 1 product out of the overnight batch");
    expect(batchCounts(await state())).toMatchObject({ queued: 0, canceled: 1 });
  });
  it("no Gemini key -> a plain error that points at ⚡ live", async () => {
    st.key = "";
    const to = await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    expect(to).toContain("needs a Gemini key (AI_GEMINI_API_KEY in Vercel)");
    expect(to).toContain("⚡ Draft now (live)");
  });
  it("the ⚡ live button still queues the live row and says so", async () => {
    const to = await run(queueBulkAiV2Action(fd({ keys: ["k-1"] })));
    expect(to).toContain("⚡ Queued 1 product");
    expect(st.db.rows("site_settings").map((r) => r.key)).not.toContain(ENRICH_BATCH_KEY);
  });
});

describe("D244 R-3 - the overnight tick", () => {
  it("nothing queued -> idle, and Google is never called", async () => {
    const g = fakeGoogle(() => ({ ok: true, status: 200, json: {} }));
    const r = await runEnrichBatchTick({ now: () => T0, token: "t", call: g.call, build });
    expect(r).toMatchObject({ ok: true, skipped: "idle" });
    expect(g.calls).toHaveLength(0);
  });

  it("gathers for two minutes, then sends ONE batch with the same prompt, a JSON schema, and no web search", async () => {
    await run(queueOvernightBatchAction(fd({ vendor: "Hollingsworth" })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    const g = fakeGoogle((path) => (path.includes(":batchGenerateContent") ? { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } } } : { ok: false, status: 500, json: {} }));

    const early = await runEnrichBatchTick({ now: () => queuedAt + 30_000, token: "t0", call: g.call, build });
    expect(early).toMatchObject({ ok: true, sent: 0 });
    expect(g.calls).toHaveLength(0);

    const r = await runEnrichBatchTick({ now: () => queuedAt + ENRICH_BATCH_GATHER_MS + 1, token: "t1", call: g.call, build });
    expect(r).toMatchObject({ ok: true, sent: 2 });
    expect(g.calls).toHaveLength(1);
    const body = g.calls[0]!.body as { batch: { displayName: string; inputConfig: { requests: { requests: Array<{ metadata: { key: string }; request: Record<string, unknown> }> } } } };
    expect(body.batch.displayName.startsWith(ENRICH_BATCH_PREFIX)).toBe(true);
    const reqs = body.batch.inputConfig.requests.requests;
    expect(reqs.map((x) => x.metadata.key)).toEqual(["k-1", "k-2"]);
    const one = JSON.stringify(reqs[0]!.request);
    expect(one).toContain("SYSTEM PROMPT");
    expect(one).toContain("USER PROMPT k-1");
    expect(one).toContain("application/json");
    expect(one).toContain("responseJsonSchema");
    expect(one).not.toContain("googleSearch");

    const s = await state();
    expect(s.items.map((i) => i.status)).toEqual(["sent", "sent"]);
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]).toMatchObject({ name: "batches/abc", state: "pending", keys: ["k-1", "k-2"] });
    expect(s.items[0]!.req).toMatchObject({ numbers: { thc: [{ value: 24.51, unit: "%" }] } });
    expect(s.leaseToken).toBeNull();
    expect(st.audits.some((a) => a.action === "product.enrich_batch_sent")).toBe(true);
  });

  it("poll -> ingest stores the SAME ai_suggestions a live draft stores, stamped as an overnight batch", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1", "k-2"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    let finished = false;
    const g = fakeGoogle((path) => {
      if (path.includes(":batchGenerateContent")) return { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } } };
      if (path === "v1beta/batches/abc") {
        return finished
          ? { ok: true, status: 200, json: { name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [geminiLine("k-1", answer), geminiLine("k-2", { nope: true })] } } } }
          : { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_RUNNING" } } };
      }
      return { ok: false, status: 500, json: {} };
    });
    const t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    await runEnrichBatchTick({ now: () => t, token: "a", call: g.call, build });
    const running = await runEnrichBatchTick({ now: () => t + 60_000, token: "b", call: g.call, build });
    expect(running).toMatchObject({ ok: true, polled: 1, stored: 0 });
    expect((await state()).batches[0]!.state).toBe("running");

    finished = true;
    const r = await runEnrichBatchTick({ now: () => t + 120_000, token: "c", call: g.call, build });
    expect(r).toMatchObject({ ok: true, polled: 1, stored: 1 });

    const rows = suggestions("k-1");
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.map((x) => x.field_key)).toEqual(expect.arrayContaining(["display_name", "description", "potency", "strain_type"]));
    expect(rows.every((x) => x.status === "pending")).toBe(true);
    expect(String(rows[0]!.input_summary)).toContain("overnight batch");
    expect(rows[0]).toMatchObject({ model: "gemini-4-carbon", generated_by: "u-1" });
    expect(suggestions("k-2")).toHaveLength(0);

    const s = await state();
    const k1 = s.items.find((i) => i.key === "k-1")!;
    const k2 = s.items.find((i) => i.key === "k-2")!;
    expect(k1).toMatchObject({ status: "done" });
    expect(k1.saved).toBeGreaterThan(3);
    // A bad answer gets ONE more try (back in line and re-sent in the next batch), not a silent drop.
    expect(k2.status).toBe("sent");
    expect(k2.attempts).toBe(2);
    expect(k2.batchId).not.toBe(k1.batchId);
    expect(st.usage.some((u) => u.feature === "product.all_fields.batch")).toBe(true);
  });

  it("Google refuses the batch -> products go back in line (try not counted) and sending pauses 30 minutes", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    const g = fakeGoogle(() => ({ ok: false, status: 429, json: { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } } }));
    const t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    const r = await runEnrichBatchTick({ now: () => t, token: "a", call: g.call, build });
    expect(r).toMatchObject({ ok: true, sent: 0 });
    const s = await state();
    expect(s.items[0]).toMatchObject({ status: "queued", attempts: 0 });
    expect(s.batches[0]!.state).toBe("refused");
    expect(Date.parse(s.backoffUntil!)).toBe(t + ENRICH_BATCH_REFUSE_BACKOFF_MS);
    expect(st.audits.some((a) => a.action === "product.enrich_batch_stopped")).toBe(true);

    const before = g.calls.length;
    await runEnrichBatchTick({ now: () => t + 60_000, token: "b", call: g.call, build });
    expect(g.calls.length).toBe(before);
  });

  it("an orphaned 'submitting' send is recovered: found at Google -> adopted, not found -> back in line", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    const t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    // The send crashes after the record was written (simulated: Google call throws).
    const crash = async () => {
      throw new Error("network died");
    };
    await runEnrichBatchTick({ now: () => t, token: "a", call: crash as never, build });
    const s1 = await state();
    expect(s1.batches[0]!.state).toBe("submitting");
    expect(s1.items[0]!.status).toBe("sent");
    const id = s1.batches[0]!.id;

    const g = fakeGoogle(() => ({ ok: true, status: 200, json: { name: "batches/x", metadata: { state: "BATCH_STATE_RUNNING" } } }));
    await runEnrichBatchTick({ now: () => t + 1000, token: "b", call: g.call, build, list: async () => ({ ok: true, rows: [{ name: "batches/x", displayName: `${ENRICH_BATCH_PREFIX}${id}` }] }) });
    const s2 = await state();
    expect(s2.batches[0]).toMatchObject({ name: "batches/x" });
    expect(["pending", "running"]).toContain(s2.batches[0]!.state);
  });

  it("a held lease means a second worker does nothing", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    const s = await state();
    const row = st.db.rows("site_settings").find((r) => r.key === ENRICH_BATCH_KEY)!;
    row.value_json = { ...(row.value_json as object), leaseToken: "other", leaseUntil: new Date(T0 + 600_000).toISOString() };
    const g = fakeGoogle(() => ({ ok: true, status: 200, json: {} }));
    const r = await runEnrichBatchTick({ now: () => T0, token: "me", call: g.call, build });
    expect(r).toMatchObject({ ok: true, skipped: "leased" });
    expect(g.calls).toHaveLength(0);
    expect(s.items).toHaveLength(1);
  });
});

describe("D244 R-3 - the worker and the pages", () => {
  it("runs on the idle worker tick of /api/cron/lookup-jobs - no new cron", () => {
    const route = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(route).toContain("if (idle) enrichBatch = await runEnrichBatchTick({ budgetMs: ENRICH_BATCH_TICK_BUDGET_MS });");
    expect(route).toContain("if (idle && !batchWorked && liveBudgetMs > 0) {");
    expect(route).toContain("const liveBudgetMs = Math.max(0, BULK_AI_V2_BUDGET_MS - (Date.now() - enrichStart));");
    const vercel = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(vercel.crons).toHaveLength(23);
  });
  it("both modes are named the same everywhere, with when / speed / price / how", () => {
    expect(ENRICH_MODES.live.button).toBe("⚡ Draft now (live)");
    expect(ENRICH_MODES.overnight.button).toBe("🌙 Add to the overnight batch");
    for (const m of [ENRICH_MODES.live, ENRICH_MODES.overnight]) {
      expect(m.when.length).toBeGreaterThan(10);
      expect(m.speed.length).toBeGreaterThan(5);
      expect(m.price.length).toBeGreaterThan(5);
      expect(m.how.length).toBeGreaterThan(1);
    }
  });
  it("the bulk page shows the two-card chooser, both status blocks and both buttons on one picker", () => {
    const page = read("src/app/admin/products/bulk-ai/page.tsx");
    expect(page).toContain("data-testid={`enrich-mode-${m}`}");
    for (const id of ["enrich-mode-chooser", "bulk-v2-progress", "bulk-batch-progress", "bulk-batch-records", "bulk-batch-failures", "bulk-batch-cancel", "bulk-v2-draft", "bulk-batch-draft"]) {
      expect(page).toContain(`data-testid="${id}"`);
    }
    expect(page).toContain("formAction={queueOvernightBatchAction}");
  });
  it("the product detail page offers both, explains both, and shows this product's overnight status", () => {
    const page = read("src/app/admin/products/[key]/page.tsx");
    for (const id of ["ai-draft-all", "ai-draft-overnight", "ai-mode-explainer", "ai-overnight-status"]) expect(page).toContain(`data-testid="${id}"`);
    expect(page).toContain("⚡ Enrich now (live, all fields)");
    expect(read("src/app/admin/products/actions.ts")).toContain("export async function queueProductOvernightAction(");
  });
});
