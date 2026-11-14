/**
 * tests/compliance/d244-e5-bulk-ai.test.ts - D244 E-5 (Bulk AI v2).
 *
 * Owner (verbatim): "Please complete another 3 slices. Follow the standing
 * rules." Strategy doc slice E-5: "Draft with AI" for a selection or a whole
 * vendor queues a background job (the every-minute worker, no new cron) that
 * runs E-4's all-fields call per product; progress and failure reasons show
 * on the page; the review grid filters by vendor and confidence, accepts all
 * high-confidence drafts per product, and "Accept & publish" is still a
 * person's click (publishes only a draft with a photo). Owner Q6 (Batch API)
 * open -> live calls only.
 *
 * Proven on the REAL queue/run/actions (provider stubbed) through FakePostgrest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  reply: {} as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
  tick: 0,
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
vi.mock("@/lib/ai/provider", () => ({
  isAiConfigured: true,
  aiModelId: "test-model",
  generateStructured: vi.fn(async (opts: Record<string, unknown>) => {
    st.calls.push(opts);
    if (st.reply.__throw) throw new Error(String(st.reply.__throw));
    return st.reply;
  }),
  generateJSON: vi.fn(),
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "- Blue Dream: sweet berry; hybrid", sources: ["kb:strain:blue dream"], strain: null, category: "flower" }),
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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { queueBulkAiV2Action, cancelBulkAiV2Action, bulkAcceptAllForProductAction } from "@/app/admin/products/bulk-ai/actions";
import { runBulkAiV2, readBulkAiV2, loadBulkAiV2Status } from "@/lib/enrichment/bulk-ai-v2-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  __runBulkAiV2Tests,
  BULK_AI_V2_BUDGET_MS,
  BULK_AI_V2_KEY,
  BULK_AI_V2_LEASE_SLACK_MS,
  bulkCounts,
} from "@/lib/enrichment/bulk-ai-v2-core";

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
    if (m.startsWith("REDIRECT:")) return m.slice(9);
    throw e;
  }
  return "";
}
const meta = (confidence: number, evidence: string[], best_guess = false) => ({ confidence, evidence, best_guess });
const item = (key: string, name: string, vendor: string | null) => ({
  source_item_id: key,
  name,
  product_name: name,
  brand_name: "Phat Panda",
  vendor_name: vendor,
  category: "flower",
  strain_type: "hybrid",
  strain_name: "Blue Dream",
  thc: "24%",
  cbd: null,
  description: null,
  price_minor_units: 3000,
  inventory_status: "in-stock",
});
const enrichment = (key: string, photo: boolean) => ({
  id: `e-${key}`,
  pos_product_key: key,
  display_name: null,
  description: null,
  short_description: null,
  image_media_ids: photo ? ["m-1"] : [],
  primary_media_id: photo ? "m-1" : null,
  vendor_id: null,
  tags: [],
  seo_title: null,
  seo_description: null,
  status: "draft",
});
const state = async () => (await readBulkAiV2(createSupabaseAdminClient())).state;

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls.length = 0;
  st.audits.length = 0;
  st.tick = 0;
  // site_settings.updated_at is bumped by a trigger in Postgres; the fake does it here.
  st.db.before = (req) => {
    if (req.table === "site_settings" && (req.method === "POST" || req.method === "PATCH") && req.body && typeof req.body === "object") {
      st.tick += 1;
      (req.body as Record<string, unknown>).updated_at = `2026-01-01T00:00:${String(st.tick).padStart(2, "0")}.000Z#${st.tick}`;
    }
  };
  st.items = [item("k-1", "Blue Dream 3.5g", "Hollingsworth"), item("k-2", "Blue Dream 7g", "Hollingsworth"), item("k-3", "Gelato 1g", "Other Farms")];
  st.db.rows("product_enrichments").push(enrichment("k-1", true), enrichment("k-2", false), enrichment("k-3", true));
  st.reply = {
    display_name: { value: "Phat Panda Blue Dream 3.5g", ...meta(96, ["pos"]) },
    description: { value: "Blue Dream from Phat Panda brings sweet berry aroma over a smooth hybrid flower.", ...meta(90, ["pos", "kb:strain:blue dream"]) },
    short_description: { value: "Sweet berry hybrid flower.", ...meta(88, ["pos"]) },
    seo: { title: "Blue Dream 3.5g by Phat Panda", meta: "Blue Dream hybrid flower from Phat Panda with sweet berry aroma and a smooth finish, in a 3.5 gram jar for pickup.", ...meta(90, ["pos"]) },
    sensory: { aroma_notes: ["berry"], flavor_notes: [], terpenes: [], ...meta(80, ["kb:strain:blue dream"]) },
    effects: { values: ["relaxed"], ...meta(75, ["kb:strain:blue dream"], true) },
    tags: { values: ["local"], ...meta(50, []) },
  };
});

describe("D244 E-5 bulk-ai-v2-core", () => {
  it("runs exactly 38 assertions, none failing, registered at that floor", () => {
    expect(__runBulkAiV2Tests()).toEqual({ passed: 38, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("bulk-ai-v2-core", __runBulkAiV2Tests(), 38); // D244 E-5');
  });
  it("the lease outlives the route: budget + slack = maxDuration 800 s", () => {
    expect(BULK_AI_V2_BUDGET_MS + BULK_AI_V2_LEASE_SLACK_MS).toBe(800_000);
  });
});

describe("D244 E-5 - queue (selection or a whole vendor)", () => {
  it("a vendor press queues every live product from that vendor; nothing is drafted yet", async () => {
    const to = await run(queueBulkAiV2Action(fd({ vendor: "Hollingsworth" })));
    expect(to.startsWith("/admin/products/bulk-ai?queued=")).toBe(true);
    expect(decodeURIComponent(to)).toContain("Queued 2 products");
    const s = await state();
    expect(s.items.map((i) => [i.key, i.vendor, i.status])).toEqual([
      ["k-1", "Hollingsworth", "queued"],
      ["k-2", "Hollingsworth", "queued"],
    ]);
    expect(st.calls).toHaveLength(0);
    expect(st.db.rows("site_settings")[0]).toMatchObject({ key: BULK_AI_V2_KEY });
    expect(st.audits.at(-1)).toMatchObject({ action: "product.bulk_ai_v2_queued", after: { added: 2 } });
  });
  it("ticked keys queue too; a second press does not double-queue; a forged key is ignored", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-3", "forged"] })));
    const to = await run(queueBulkAiV2Action(fd({ keys: ["k-3"] })));
    expect(decodeURIComponent(to)).toContain("1 already waiting");
    expect((await state()).items.map((i) => i.key)).toEqual(["k-3"]);
  });
  it("nothing ticked and no vendor -> a plain error", async () => {
    const to = await run(queueBulkAiV2Action(fd({})));
    expect(decodeURIComponent(to)).toContain("Tick at least one product, or pick a vendor.");
  });
  it("cancel stops everything still waiting", async () => {
    await run(queueBulkAiV2Action(fd({ vendor: "Hollingsworth" })));
    const to = await run(cancelBulkAiV2Action());
    expect(decodeURIComponent(to)).toContain("Canceled 2 waiting products.");
    expect(bulkCounts(await state())).toMatchObject({ queued: 0, canceled: 2 });
  });
});

describe("D244 E-5 - the background run", () => {
  it("an empty queue costs one read and drafts nothing", async () => {
    const r = await runBulkAiV2({ now: () => T0, token: "t" });
    expect(r).toMatchObject({ ok: true, skipped: "idle" });
    expect(st.db.log.filter((x) => x.table === "site_settings")).toHaveLength(1);
  });
  it("drafts each queued product with the E-4 all-fields call (real path), then releases the lease", async () => {
    await run(queueBulkAiV2Action(fd({ vendor: "Hollingsworth" })));
    const r = await runBulkAiV2({ now: () => T0, token: "t1" });
    expect(r).toMatchObject({ ok: true, drafted: 2, failed: 0, left: 0 });
    expect(st.calls).toHaveLength(2);
    expect(st.calls.map((c) => (c.context as Record<string, unknown>).entityId)).toEqual(["k-1", "k-2"]);
    expect(String(st.calls[0]!.user)).toContain("[vendor] Vendor (who we buy it from): Hollingsworth");
    const s = await state();
    expect(s.items.map((i) => [i.status, i.saved])).toEqual([
      ["done", 7],
      ["done", 7],
    ]);
    expect(s.leaseToken).toBeNull();
    expect(s.lastNote).toBe("Drafted 2 products, the queue is empty.");
    // Drafts only: nothing applied, everything pending.
    expect(st.db.rows("ai_suggestions").every((x) => x.status === "pending")).toBe(true);
    expect(st.db.rows("product_enrichments")[0]!.display_name).toBeNull();
    expect(st.audits.at(-1)).toMatchObject({ action: "product.bulk_ai_v2_ran", after: { drafted: 2, failed: 0 } });
  });
  it("a failing product keeps its reason; it is retried once, then marked failed (the page can say WHY)", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-3"] })));
    st.reply = { __throw: "429 Rate limit exceeded" };
    const r1 = await runBulkAiV2({ now: () => T0, token: "a" });
    expect(r1).toMatchObject({ ok: true, drafted: 0, failed: 1, left: 1 });
    // The failure waits for the NEXT run (never retried seconds later), its reason kept.
    expect((await state()).items[0]).toMatchObject({ status: "queued", attempts: 1 });
    expect((await state()).items[0]!.error).toBeTruthy();
    const r2 = await runBulkAiV2({ now: () => T0 + 60_000, token: "b" });
    expect(r2).toMatchObject({ ok: true, drafted: 0, failed: 1, left: 0 });
    const s = await state();
    const row = s.items[0]!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
    expect(row.error).toBeTruthy();
    const st2 = await loadBulkAiV2Status();
    expect(st2.ok && st2.state.items[0]!.error).toBe(row.error);
  });
  it("a live lease makes a second tick stand down (no double drafting)", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-1"] })));
    const raw = st.db.rows("site_settings")[0]!;
    raw.value_json = { ...(raw.value_json as object), leaseToken: "other", leaseUntil: new Date(T0 + 60_000).toISOString() };
    const r = await runBulkAiV2({ now: () => T0, token: "mine" });
    expect(r).toMatchObject({ ok: true, skipped: "leased" });
    expect(st.calls).toHaveLength(0);
  });
  it("an orphan left 'running' by a killed run is re-queued by the next lease and drafted", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-1"] })));
    const raw = st.db.rows("site_settings")[0]!;
    const v = raw.value_json as { items: Array<Record<string, unknown>> };
    v.items[0]!.status = "running";
    v.items[0]!.attempts = 1;
    const r = await runBulkAiV2({ now: () => T0, token: "n" });
    expect(r).toMatchObject({ ok: true, drafted: 1 });
    expect((await state()).items[0]).toMatchObject({ status: "done", attempts: 2 });
  });
  it("a run stops STARTING products when the budget is spent", async () => {
    await run(queueBulkAiV2Action(fd({ vendor: "Hollingsworth" })));
    let t = T0;
    const r = await runBulkAiV2({
      now: () => t,
      token: "b",
      draftOne: async () => {
        t += 400_000;
        return { saved: 7 };
      },
    });
    expect(r).toMatchObject({ ok: true, drafted: 1, left: 1 });
  });
});

describe("D244 E-5 - review grid: accept all >= 85% (and publish) per product", () => {
  it("accepts only the >= 85% non-best-guess drafts, then publishes a draft WITH a photo", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-1"] })));
    await runBulkAiV2({ now: () => T0, token: "x" });
    const to = await run(bulkAcceptAllForProductAction(fd({ key: "k-1", publish: "1", vendor_filter: "Hollingsworth", min: "70" })));
    expect(to.startsWith("/admin/products/bulk-ai?vendor=Hollingsworth&min=70&accepted_note=")).toBe(true);
    expect(decodeURIComponent(to)).toContain("Published.");
    const status = Object.fromEntries(st.db.rows("ai_suggestions").map((r) => [r.field_key, r.status]));
    expect(status).toMatchObject({ display_name: "accepted", description: "accepted", short_description: "accepted", seo: "accepted", sensory: "pending", effects: "pending", tags: "pending" });
    const e = st.db.rows("product_enrichments").find((r) => r.pos_product_key === "k-1")!;
    expect(e.status).toBe("published");
    expect(e.display_name).toBe("Phat Panda Blue Dream 3.5g");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.bulk_ai_accepted_all", entityId: "k-1", after: { threshold: 85, andPublish: true, published: true } });
  });
  it("Accept & publish never publishes a product without a photo (still accepts the drafts)", async () => {
    await run(queueBulkAiV2Action(fd({ keys: ["k-2"] })));
    await runBulkAiV2({ now: () => T0, token: "y" });
    const to = await run(bulkAcceptAllForProductAction(fd({ key: "k-2", publish: "1" })));
    expect(decodeURIComponent(to)).toContain("Not published: it has no photo yet.");
    expect(st.db.rows("product_enrichments").find((r) => r.pos_product_key === "k-2")!.status).toBe("draft");
  });
  it("nothing eligible -> says so, accepts nothing", async () => {
    st.reply = { ...st.reply, display_name: { value: "X", ...meta(60, ["pos"]) }, description: { value: "Y copy.", ...meta(60, ["pos"]) }, short_description: { value: "Z", ...meta(10, ["pos"]) }, seo: { title: "", meta: "", ...meta(10, ["pos"]) } };
    await run(queueBulkAiV2Action(fd({ keys: ["k-1"] })));
    await runBulkAiV2({ now: () => T0, token: "z" });
    const to = await run(bulkAcceptAllForProductAction(fd({ key: "k-1" })));
    expect(decodeURIComponent(to)).toContain("No draft for this product is at or above 85%");
    expect(st.db.rows("ai_suggestions").every((r) => r.status === "pending")).toBe(true);
  });
});

describe("D244 E-5 wiring", () => {
  it("the every-minute worker drafts only when it had nothing else to do; no new cron", () => {
    const s = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(s).toContain("if (result.ok && result.skipped && !(autoStart?.ok && autoStart.run) && !(mailRead?.ok && !mailRead.skipped)) {");
    expect(s).toContain('runBulkAiV2({ budgetMs: BULK_AI_V2_BUDGET_MS, trigger: "worker" })');
    expect(s).toContain("const batch = await runGeminiBatchTick({ budgetMs: 180_000 });");
    const v = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(v.crons).toHaveLength(23); // 23 since D232 M-6; this worker added none
  });
  it("the page shows the queue, progress, failures, filters and per-product accept; old pins kept", () => {
    const p = read("src/app/admin/products/bulk-ai/page.tsx");
    for (const id of ["bulk-v2-queue", "bulk-v2-progress", "bulk-v2-failures", "bulk-v2-cancel", "bulk-v2-draft", "bulk-v2-vendor", "bulk-v2-filter", "bulk-v2-group", "bulk-v2-accept-all", "bulk-v2-accept-publish", "bulk-v2-best-guess"]) {
      expect(p).toContain(`data-testid="${id}"`);
    }
    expect(p).toContain("loadBulkAiV2Status()");
    expect(p).toContain("First failure: {reason}");
    expect(p).toContain("export const maxDuration = 300;");
  });
  it("one accept path: the product page and the grid share accept-drafts-server; the gate runs first", () => {
    const a = read("src/app/admin/products/actions.ts");
    expect(a).toContain("await acceptHighConfidenceForKey(key, session.userId)");
    const b = read("src/app/admin/products/bulk-ai/actions.ts");
    expect(b).toContain("await acceptHighConfidenceForKey(key, session.userId)");
    const srv = read("src/lib/enrichment/accept-drafts-server.ts");
    expect(srv.indexOf("acceptWithComplianceGate(sugg)")).toBeLessThan(srv.indexOf("await applyAcceptedValue(key, sugg, userId)"));
    expect(srv).toContain('import "server-only";');
    expect(read("src/lib/enrichment/bulk-ai-v2-server.ts")).toContain('import "server-only";');
  });
});
