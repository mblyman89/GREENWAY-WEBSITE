/**
 * tests/compliance/d244-r4-embeddings.test.ts - D244 round 2, slice R-4.
 *
 * Owner (verbatim): "for the embeddings question, I am not sure. is this the
 * professional enterprise grade solution? please use your expert judgement to
 * implement this properly, the right way, not the easy way."
 *
 * Proven on the REAL background indexer (runMediaEmbedTick) through
 * FakePostgrest with Google stubbed via the tick's `call` / `fetchImage`
 * seams: an idle tick is one read; a run takes a lease, embeds words and
 * pictures, skips non-PNG/JPEG pictures, records failures with attempts,
 * never re-embeds an unchanged photo, and goes quiet when everything is done.
 * Plus the wiring: migration guard, no new cron, the admin card, the actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  usage: [] as Array<Record<string, unknown>>,
  tick: 0,
  cap: { vector_available: true, vector_installed: true, vector_version: "0.8.0", column_ready: true } as Record<string, unknown> | null,
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
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/ai/provider", async (orig) => ({
  ...((await orig()) as object),
  geminiApiKey: () => "test-gemini-key",
}));
vi.mock("@/lib/ai/usage", async (orig) => ({
  ...((await orig()) as object),
  logAiUsage: async (u: Record<string, unknown>) => void st.usage.push(u),
}));
vi.mock("@/lib/media/store", () => ({ publicUrlForKey: (k: string) => `https://cdn.example/${k}` }));

import { runMediaEmbedTick } from "@/lib/media/media-embed-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  __runMediaEmbedTests,
  EMBED_DIMS,
  EMBED_MAX_ATTEMPTS,
  EMBED_RESWEEP_MS,
  MEDIA_EMBED_LEASE_MS,
  MEDIA_EMBED_STATE_KEY,
  MEDIA_EMBED_TICK_BUDGET_MS,
  RRF_K,
  SEMANTIC_MAX,
  embedQueryText,
  embedDocumentText,
  rrfFuse,
  semanticConfidence,
  parseEmbedState,
} from "@/lib/media/media-embed-core";
import { __runImageRecommendCoreTests } from "@/lib/catalog/image-recommend-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const T0 = Date.parse("2026-01-01T12:00:00Z");
const vec = (x: number) => Array.from({ length: EMBED_DIMS }, (_, i) => (i === 0 ? x : 0.001));

type Body = { requests: Array<{ content: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }> };
const calls: Body[] = [];
let failImages = false;
const call = (async (_path: string, init: { method: string; body: string }) => {
  const b = JSON.parse(init.body) as Body;
  calls.push(b);
  const isImage = Boolean(b.requests[0]?.content.parts[0]?.inlineData);
  if (isImage && failImages) return { ok: false, status: 500, json: { error: { message: "boom" } }, text: "" };
  return { ok: true, status: 200, json: { embeddings: b.requests.map((_, i) => ({ values: vec(0.1 + i / 100) })) }, text: "" };
}) as unknown as NonNullable<Parameters<typeof runMediaEmbedTick>[0]>["call"];
const fetchImage = async (url: string) => ({ ok: true, mime: "image/png", data: Buffer.from(url).toString("base64"), note: "" });

const asset = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  status: "active",
  mime_type: "image/png",
  storage_key: `media/${n}.png`,
  public_url: null,
  content_hash: `h${n}`,
  title: null,
  product_name: `Blue Dream ${n}g jar`,
  strain_name: "Blue Dream",
  seo_title: null,
  ai_caption: null,
  visible_text: null,
  alt_text: null,
  seo_alt: null,
  ai_description: "A glass jar of green flower with a purple label.",
  description: null,
  tags: [],
  ai_tags: [],
  category: "flower",
  subcategory: null,
  role: "product",
  pack_size: null,
  vendor_id: "v-1",
  brand_id: null,
  ...over,
});

const stateRow = () => st.db.rows("site_settings").find((r) => r.key === MEDIA_EMBED_STATE_KEY);
const state = () => parseEmbedState(stateRow()?.value_json ?? null);
const tick = (nowMs: number, token = "tok-1") => runMediaEmbedTick({ admin: createSupabaseAdminClient(), now: () => nowMs, token, call, fetchImage, model: "gemini-embedding-2" });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.usage.length = 0;
  st.tick = 0;
  st.cap = { vector_available: true, vector_installed: true, vector_version: "0.8.0", column_ready: true };
  calls.length = 0;
  failImages = false;
  st.db.before = (req) => {
    if (req.table === "media_embedding_capability") {
      if (st.cap === null) return { status: 404, body: { code: "PGRST202", message: "Could not find the function public.media_embedding_capability without parameters in the schema cache" } };
      return { status: 200, body: st.cap };
    }
    if (req.table === "site_settings" && (req.method === "POST" || req.method === "PATCH") && req.body && typeof req.body === "object") {
      st.tick += 1;
      (req.body as Record<string, unknown>).updated_at = `2026-01-01T00:00:${String(st.tick).padStart(2, "0")}.000Z#${st.tick}`;
    }
  };
  st.db.rows("vendors").push({ id: "v-1", display_name: "Phat Panda" });
  st.db.rows("media_assets").push(asset(1), asset(2), asset(3, { mime_type: "image/webp", storage_key: "media/3.webp" }), asset(4, { status: "archived" }));
});

describe("D244 R-4 media-embed-core (pure)", () => {
  it("runs exactly 55 assertions, none failing, registered at that floor", () => {
    expect(__runMediaEmbedTests()).toEqual({ passed: 55, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("media-embed-core", __runMediaEmbedTests(), 55); // D244 R-4');
  });
  it("image-recommend-core grew by 5 semantic tests, registered at 40", () => {
    expect(__runImageRecommendCoreTests()).toEqual({ passed: 40, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain("__runImageRecommendCoreTests(), 40);");
  });
  it("task-prefixed text for queries and documents (asymmetric retrieval)", () => {
    expect(embedQueryText("purple jar")).toBe("task: search result | query: purple jar");
    const doc = embedDocumentText({ product_name: "Blue Dream 3.5g", vendor_name: "Phat Panda" } as Parameters<typeof embedDocumentText>[0]);
    expect(doc.startsWith("title: ")).toBe(true);
    expect(doc).toContain("| text: ");
  });
  it("RRF k=60 rewards agreement between lists", () => {
    expect(RRF_K).toBe(60);
    const fused = rrfFuse([["a", "b", "c"], ["b", "a"]]);
    expect(fused[0].id === "a" || fused[0].id === "b").toBe(true);
    expect(fused.map((f) => f.id)).toContain("c");
  });
  it("meaning alone is honest: never High (capped at 74), floor below 0.55", () => {
    expect(semanticConfidence(0.99)).toBeLessThanOrEqual(SEMANTIC_MAX);
    expect(SEMANTIC_MAX).toBe(74);
    expect(semanticConfidence(0.4)).toBe(0);
  });
  it("lease covers the tick budget; re-sweep is 15 minutes", () => {
    expect(MEDIA_EMBED_TICK_BUDGET_MS).toBeLessThan(MEDIA_EMBED_LEASE_MS);
    expect(EMBED_RESWEEP_MS).toBe(15 * 60_000);
  });
});

describe("D244 R-4 the background indexer (runMediaEmbedTick)", () => {
  it("first run: leases, embeds words for 3 live photos and pictures for the 2 PNGs, skips the WebP picture, ignores archived", async () => {
    const r = await tick(T0);
    expect(r).toMatchObject({ ok: true, embedded: 5, failed: 0, skippedImages: 1, passDone: true });
    const rows = st.db.rows("media_embeddings");
    expect(rows.filter((x) => x.kind === "text" && x.status === "done")).toHaveLength(3);
    expect(rows.filter((x) => x.kind === "image" && x.status === "done")).toHaveLength(2);
    expect(rows.find((x) => x.kind === "image" && x.status === "skipped")?.media_id).toBe(asset(3).id);
    expect(rows.some((x) => x.media_id === asset(4).id)).toBe(false);
    const done = rows.find((x) => x.status === "done")!;
    expect(done.dims).toBe(768);
    expect(String(done.embedding).startsWith("[")).toBe(true);
    // the words carry the vendor name, the request asks for 768 numbers
    const textCall = calls.find((c) => c.requests[0].content.parts[0].text)!;
    expect(textCall.requests[0].content.parts[0].text).toContain("Phat Panda");
    expect(st.usage.map((u) => u.feature)).toEqual(expect.arrayContaining(["media.embed.text", "media.embed.image"]));
    const s = state();
    expect(s.leaseToken).toBeNull();
    expect(s.cursor).toBeNull();
    expect(s.embedded).toBe(5);
  });

  it("unchanged photos are never embedded twice; the pass goes quiet and the next tick is ONE read", async () => {
    await tick(T0);
    const before = calls.length;
    const r2 = await tick(T0 + 60_000, "tok-2");
    expect(r2).toMatchObject({ ok: true, embedded: 0, failed: 0 });
    expect(calls.length).toBe(before);
    expect(state().quietSince).not.toBeNull();
    const reqs = st.db.log.length;
    const r3 = await tick(T0 + 120_000, "tok-3");
    expect(r3).toMatchObject({ ok: true, skipped: "quiet" });
    expect(st.db.log.length - reqs).toBe(1);
    // after the re-sweep window a changed photo is picked up
    (st.db.rows("media_assets")[0] as Record<string, unknown>).ai_description = "Now a tin, not a jar.";
    const r4 = await tick(T0 + 120_000 + EMBED_RESWEEP_MS + 1, "tok-4");
    expect(r4).toMatchObject({ ok: true, embedded: 1 });
  });

  it("a failed picture is recorded with attempts and retried up to the limit, then left alone", async () => {
    failImages = true;
    await tick(T0);
    const img = () => st.db.rows("media_embeddings").filter((x) => x.kind === "image" && x.status === "failed");
    expect(img()).toHaveLength(2);
    expect(img()[0].attempts).toBe(1);
    expect(String(img()[0].note)).toContain("Gemini answered 500");
    for (let i = 2; i <= EMBED_MAX_ATTEMPTS; i += 1) await tick(T0 + i * (EMBED_RESWEEP_MS + 1), `t-${i}`);
    expect(img()[0].attempts).toBe(EMBED_MAX_ATTEMPTS);
    const n = calls.length;
    await tick(T0 + 10 * (EMBED_RESWEEP_MS + 1), "t-last");
    expect(calls.length).toBe(n);
  });

  it("paused or leased: nothing is read beyond the state row, nothing is called", async () => {
    st.db.rows("site_settings").push({ key: MEDIA_EMBED_STATE_KEY, value_json: { v: 1, paused: true }, updated_at: "u0" });
    expect(await tick(T0)).toMatchObject({ ok: true, skipped: "paused" });
    stateRow()!.value_json = { v: 1, paused: false, leaseToken: "other", leaseUntil: new Date(T0 + 60_000).toISOString() };
    expect(await tick(T0)).toMatchObject({ ok: true, skipped: "leased" });
    expect(calls).toHaveLength(0);
    expect(st.db.rows("media_embeddings")).toHaveLength(0);
  });

  it("without 0365 or without pgvector it says so, calls nothing and goes quiet", async () => {
    st.cap = null;
    expect(await tick(T0)).toMatchObject({ ok: true, skipped: "not_migrated" });
    expect(state().quietSince).not.toBeNull();
    st.cap = { vector_available: true, vector_installed: false, column_ready: false };
    expect(await tick(T0 + EMBED_RESWEEP_MS + 1)).toMatchObject({ ok: true, skipped: "no_vector" });
    expect(calls).toHaveLength(0);
  });
});

describe("D244 R-4 wiring", () => {
  it("migration 0365 guards pgvector, so it applies on a database without it", () => {
    const m = read("supabase/migrations/0365_media_embeddings.sql");
    expect(m).toContain("pg_available_extensions");
    expect(m).toContain("create table if not exists public.media_embeddings");
    expect(m).toMatch(/using hnsw/i);
    expect(m).toContain("vector_cosine_ops");
    expect(m).toContain("enable row level security");
    expect(read("supabase/rollbacks/0365_media_embeddings.rollback.sql")).toContain("drop table if exists public.media_embeddings");
    expect(read("supabase/migrations/editor-safe/0365_media_embeddings.EDITOR_SAFE.sql")).not.toContain("--");
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("MEDIA EMBEDDINGS 0365 CHECK PASSED");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0365_media_embeddings.sql");
  });
  it("runs on the idle tick of /api/cron/lookup-jobs within the route's time - no new cron", () => {
    const route = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(route).toContain("runMediaEmbedTick({ budgetMs: embedBudgetMs })");
    expect(route).toContain("if (idle && !enrichWorked && embedBudgetMs >= 30_000)");
    expect(route).toContain("const ROUTE_END_MS = 780_000;");
    const vercel = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(vercel.crons).toHaveLength(23);
  });
  it("search, find-similar and the recommended photos panel use it", () => {
    const picker = read("src/lib/media/library-picker-server.ts");
    expect(picker).toContain("semanticSearch");
    expect(picker).toContain("semanticNeighbors");
    expect(picker).toContain("rrfFuse");
    expect(picker).toContain("Matches by meaning");
    expect(read("src/lib/enrichment/image-recommend-v3-server.ts")).toContain("semanticSearch");
  });
  it("the admin card on /admin/media, buttons guarded by media.manage and audited", () => {
    const page = read("src/app/admin/media/page.tsx");
    expect(page).toContain("<MediaEmbedPanel panel={embedPanel}");
    expect(page).toContain("loadEmbedPanel()");
    const panel = read("src/components/admin/media/MediaEmbedPanel.tsx");
    for (const id of ["media-embed-panel", "media-embed-status", "media-embed-pause", "media-embed-retry"]) expect(panel).toContain(`data-testid="${id}"`);
    const actions = read("src/app/admin/media/embed-actions.ts");
    expect(actions.match(/requirePermission\("media\.manage"\)/g)).toHaveLength(2);
    expect(actions).toContain("media.embed_paused");
    expect(actions).toContain("media.embed_retry_failed");
  });
  it("the model is configurable and documented", () => {
    expect(read(".env.example")).toContain("# AI_EMBED_MODEL=gemini-embedding-2");
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain('{ table: "media_embeddings", disposition: "KEEP"');
  });
});
