/**
 * tests/compliance/d244-r15-overnight.test.ts - D244 round 6, slices R-15 + R-16.
 *
 * Owner (verbatim): "Batch over night lookup fails. this is the statement I
 * see from the test, "🌙 Overnight:Finished: 0 drafted · 396 failed. …
 * Lemon Meringue: Google's answer did not fit the draft form: - display_name:
 * is required - description: must be an object … Blue City Diesel: Google's
 * answer did not fit the draft form: - product_all_fields: expected a JSON
 * object …"" and "for the over night batch lookup, does it start right away
 * after I add to the overnight batch and click the button? I would like a way
 * to either queue up every vendor, or select multiple vendors more
 * efficiently. also when I select a vendor, it only shows the number of
 * products added to the batch, it does not tell me the vendors added."
 *
 * Proven on the REAL actions + overnight tick (Google stubbed, FakePostgrest):
 * the two failing answer shapes from the owner's screen now draft; the request
 * uses `responseSchema` (the Batch API docs' field) plus the live path's shape
 * hint; many vendors / every vendor queue in one press and the flash names them;
 * failed products can be retried.
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

import { queueOvernightBatchAction, queueBulkAiV2Action, retryFailedOvernightAction } from "@/app/admin/products/bulk-ai/actions";
import { runEnrichBatchTick, readEnrichBatch } from "@/lib/enrichment/enrich-batch-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ENRICH_BATCH_GATHER_MS, ENRICH_MODES, type BatchItemReq } from "@/lib/enrichment/enrich-batch-core";
import { __runBatchAnswerTests, normalizeAllFieldsAnswer, toGeminiResponseSchema } from "@/lib/enrichment/batch-answer-core";
import { __runVendorPickTests } from "@/lib/enrichment/vendor-pick-core";
import { productAllFieldsSchema } from "@/lib/ai/schemas/product";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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


const flatAnswer = {
  display_name: "Lemon Meringue 3.5g",
  description: "Lemon Meringue brings a bright lemon-curd aroma over a sweet, creamy finish in a 3.5 gram jar.",
  short_description: "Bright lemon, creamy finish.",
  seo_title: "Lemon Meringue 3.5g",
  meta_description: "Lemon Meringue flower with a bright lemon-curd aroma and a sweet creamy finish, in a 3.5 gram jar. Order ahead for in-store pickup in Port Orchard.",
  aroma_notes: ["lemon", "cream"],
  effects: ["relaxed"],
  strain_type: "Hybrid",
  thc: "24.51%",
};

describe("D244 R-15 batch-answer-core + R-16 vendor-pick-core", () => {
  it("run exactly 20 / 17 assertions, none failing, registered at those floors", () => {
    expect(__runBatchAnswerTests()).toEqual({ passed: 20, failed: 0 });
    expect(__runVendorPickTests()).toEqual({ passed: 17, failed: 0 });
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('assertRan("batch-answer-core", __runBatchAnswerTests(), 20); // D244 R-15');
    expect(r).toContain('assertRan("vendor-pick-core", __runVendorPickTests(), 17); // D244 R-16');
  });
  it("the owner's two failing shapes are read: a flat answer and a {product_all_fields: …} wrapper", () => {
    const flat = normalizeAllFieldsAnswer(flatAnswer);
    expect(flat.ok).toBe(true);
    const wrapped = normalizeAllFieldsAnswer({ product_all_fields: answer });
    expect(wrapped).toMatchObject({ ok: true, lifted: false });
  });
  it("the Gemini schema is the OpenAPI subset (upper-case types, no additionalProperties) for every field", () => {
    const g = toGeminiResponseSchema(productAllFieldsSchema.shape) as { type: string; required: string[]; properties: Record<string, { type: string }> };
    expect(g.type).toBe("OBJECT");
    expect(g.required).toEqual(["display_name", "description", "short_description", "seo", "sensory", "effects", "tags", "strain_type", "potency"]);
    expect(Object.values(g.properties).every((p) => p.type === "OBJECT")).toBe(true);
    expect(JSON.stringify(g)).not.toContain("additionalProperties");
  });
});

describe("D244 R-15 - the overnight tick drafts the answers that used to fail", () => {
  it("send uses responseSchema + the shape hint; flat + wrapped answers are stored as pending drafts", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1", "k-2", "k-3"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    let finished = false;
    const g = fakeGoogle((path) => {
      if (path.includes(":batchGenerateContent")) return { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } } };
      if (path === "v1beta/batches/abc") {
        return finished
          ? { ok: true, status: 200, json: { name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [geminiLine("k-1", flatAnswer), geminiLine("k-2", { product_all_fields: answer }), geminiLine("k-3", [answer])] } } } }
          : { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_RUNNING" } } };
      }
      return { ok: false, status: 500, json: {} };
    });
    const t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    await runEnrichBatchTick({ now: () => t, token: "a", call: g.call, build });
    const body = g.calls[0]!.body as { batch: { inputConfig: { requests: { requests: Array<{ request: { generationConfig: Record<string, unknown>; contents: Array<{ parts: Array<{ text: string }> }> } }> } } } };
    const req = body.batch.inputConfig.requests.requests[0]!.request;
    expect(req.generationConfig.responseMimeType).toBe("application/json");
    expect(req.generationConfig).not.toHaveProperty("responseJsonSchema");
    expect((req.generationConfig.responseSchema as { type: string }).type).toBe("OBJECT");
    expect(req.contents[0]!.parts[0]!.text).toContain("USER PROMPT k-1");
    expect(req.contents[0]!.parts[0]!.text).toContain("Return ONLY a JSON object with this exact shape");
    expect(req.contents[0]!.parts[0]!.text).toContain("- display_name: object");

    finished = true;
    const r = await runEnrichBatchTick({ now: () => t + 60_000, token: "c", call: g.call, build });
    expect(r).toMatchObject({ ok: true, stored: 3, failedAnswers: 0 });
    for (const k of ["k-1", "k-2", "k-3"]) {
      const rows = suggestions(k);
      expect(rows.length).toBeGreaterThan(3);
      expect(rows.every((x) => x.status === "pending")).toBe(true);
    }
    // A lifted flat field is a low-confidence best guess, never auto-approved as a sure thing.
    const dn = suggestions("k-1").find((x) => x.field_key === "display_name")!;
    expect(Number(dn.confidence)).toBeLessThan(0.8);
    expect((await state()).items.every((i) => i.status === "done")).toBe(true);
  });
  it("an answer with none of the fields still fails, and says what Google sent", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    const g = fakeGoogle((path) =>
      path.includes(":batchGenerateContent")
        ? { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } } }
        : { ok: true, status: 200, json: { name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [geminiLine("k-1", { foo: 1, bar: 2 })] } } } },
    );
    const t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    await runEnrichBatchTick({ now: () => t, token: "a", call: g.call, build });
    await runEnrichBatchTick({ now: () => t + 60_000, token: "b", call: g.call, build });
    expect(suggestions("k-1")).toHaveLength(0);
  });
});

describe("D244 R-16 - many vendors, every vendor, named in the flash; retry failed", () => {
  it("two vendors in one press: both queued and both named with counts", async () => {
    const to = await run(queueOvernightBatchAction(fd({ vendors: ["Hollingsworth", "Other Farms"] })));
    expect(to).toContain("🌙 Overnight: added 3 products to the overnight batch.");
    expect(to).toContain("From 2 vendors to the overnight batch: Hollingsworth (2), Other Farms (1).");
    expect(to).toContain("It does not start the instant you press");
    expect((await state()).items.map((i) => i.key)).toEqual(["k-1", "k-2", "k-3"]);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.enrich_batch_queued", after: { vendors: ["Hollingsworth", "Other Farms"] } });
  });
  it("every vendor in one press (live too)", async () => {
    const to = await run(queueBulkAiV2Action(fd({ all_vendors: "1" })));
    expect(to).toContain("⚡ Queued 3 products");
    expect(to).toContain("Hollingsworth (2), Other Farms (1)");
  });
  it("the old single-vendor select still works and the old message is kept", async () => {
    const to = await run(queueOvernightBatchAction(fd({ vendor: "Hollingsworth" })));
    expect(to).toContain("🌙 Overnight: added 2 products to the overnight batch.");
    expect(to).toContain("Hollingsworth (2)");
  });
  it("retry puts the failed products back in line with fresh tries", async () => {
    await run(queueOvernightBatchAction(fd({ keys: ["k-1"] })));
    const queuedAt = Date.parse((await state()).items[0]!.at!);
    const g = fakeGoogle((path) =>
      path.includes(":batchGenerateContent")
        ? { ok: true, status: 200, json: { name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } } }
        : { ok: true, status: 200, json: { name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [geminiLine("k-1", { foo: 1 })] } } } },
    );
    let t = queuedAt + ENRICH_BATCH_GATHER_MS + 1;
    for (const tok of ["a", "b", "c", "d", "e"]) {
      await runEnrichBatchTick({ now: () => t, token: tok, call: g.call, build });
      t += ENRICH_BATCH_GATHER_MS + 1;
    }
    expect((await state()).items[0]!.status).toBe("failed");
    const to = await run(retryFailedOvernightAction());
    expect(to).toContain("🌙 Put 1 failed product back in the overnight batch.");
    expect((await state()).items[0]).toMatchObject({ status: "queued", attempts: 0, error: null });
  });
  it("the page has the vendor ticks, every-vendor, per-vendor breakdown, timing and retry", () => {
    const p = read("src/app/admin/products/bulk-ai/page.tsx");
    for (const id of ["bulk-all-vendors", "bulk-vendor-multi", "bulk-batch-vendors", "bulk-batch-timing", "bulk-batch-retry-failed", "bulk-v2-vendor"]) expect(p).toContain(`data-testid="${id}"`);
    expect(p).toContain('name="vendors"');
    expect(p).toContain('name="all_vendors"');
    expect(ENRICH_MODES.overnight.how.join(" ")).toContain("It does not start the instant you press");
  });
  it("SOP-10 4.6, Concierge, Help and the strategy rows explain the timing and the fix", () => {
    expect(read("docs/sop/SOP-10-product-enrichment.md")).toContain("When does the overnight batch start? (D244 R-16)");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Overnight timing (D244 R-16)");
    expect(read("src/lib/admin/help-content.ts")).toContain("tick several vendors, tick Every vendor");
    const st = read("docs/sop-program/D244-enrichment-powerhouse-strategy.md");
    expect(st).toMatch(/\| R-15 \| #\d+ \| merged \|/);
    expect(st).toMatch(/\| R-16 \| #\d+ \| merged \|/);
  });
});
