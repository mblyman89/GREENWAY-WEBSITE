/**
 * tests/compliance/d244-r1-owner-round2.test.ts - D244 round 2, slice R-1.
 *
 * Owner (verbatim): "I want to use a powerful ai modal that is best suited for
 * the task." / "a product should be publish once it has a picture." / "lets
 * drop it to 80%." / "if you can make it trust itself better would be great."
 * / "best guesses should auto accepted, but flagged so we can take a closer
 * look once we have time to." / "so long as the system thinks we have at
 * least 1 lot in stock, we should consider that to be what I mean by
 * "on-hand"."
 *
 * publishOnPhoto is proven on the REAL server module through FakePostgrest;
 * the rest are pure-core checks plus wiring pins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Array<Record<string, unknown>>,
  revalidated: 0,
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
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: Record<string, unknown>) => void st.audits.push(a) }));
vi.mock("@/lib/ai/kb/writeback", () => ({ writeBackOnPublish: async () => null }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => void st.revalidated++ }));

import { publishOnPhoto, PUBLISH_ON_PHOTO_REASON } from "@/lib/enrichment/publish-on-photo-server";
import { photoPublishDecision } from "@/lib/enrichment/bulk-publish-core";
import { resolveEnrichModel, enrichModelLine, ENRICH_RECOMMENDED, enrichMaxTokens } from "@/lib/ai/enrich-model-core";
import { calibrateConfidence, normalizeDraftField, ACCEPT_ALL_THRESHOLD, needsCloserLook, markCheckedSource } from "@/lib/enrichment/ai-draft-v2-core";
import { isOnHandCard } from "@/lib/enrichment/worklist-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ACTOR = { userId: "u-1", email: "o@example.com" };

function seed(status: string, mediaStatus: string | null) {
  st.db.rows("product_enrichments").push({ pos_product_key: "k-1", status, image_media_ids: mediaStatus ? ["m-1"] : [], primary_media_id: mediaStatus ? "m-1" : null });
  if (mediaStatus) st.db.rows("media_assets").push({ id: "m-1", status: mediaStatus });
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
  st.revalidated = 0;
  delete process.env.ENRICH_PUBLISH_ON_PHOTO;
});
afterEach(() => {
  delete process.env.ENRICH_PUBLISH_ON_PHOTO;
});

describe("D244 R-1 publish on photo", () => {
  it("a draft that now has a published photo goes live, audited with the reason", async () => {
    seed("draft", "published");
    const r = await publishOnPhoto("k-1", ACTOR);
    expect(r).toMatchObject({ decision: "publish", published: true });
    expect(st.db.rows("product_enrichments")[0]!.status).toBe("published");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.published", entityId: "k-1", after: { reason: PUBLISH_ON_PHOTO_REASON } });
    expect(st.revalidated).toBe(1);
  });
  it("an archived card stays archived; a draft-only photo does not publish", async () => {
    seed("archived", "published");
    expect((await publishOnPhoto("k-1", ACTOR)).published).toBe(false);
    expect(st.db.rows("product_enrichments")[0]!.status).toBe("archived");
    st.db = new FakePostgrest();
    seed("draft", "draft");
    const r = await publishOnPhoto("k-1", ACTOR);
    expect(r.decision).toBe("photo-not-public");
    expect(r.note).toContain("still a draft in the media library");
    expect(st.db.rows("product_enrichments")[0]!.status).toBe("draft");
    expect(st.audits).toHaveLength(0);
  });
  it("ENRICH_PUBLISH_ON_PHOTO=off turns it off", async () => {
    process.env.ENRICH_PUBLISH_ON_PHOTO = "off";
    seed("draft", "published");
    expect((await publishOnPhoto("k-1", ACTOR)).decision).toBe("off");
    expect(st.db.rows("product_enrichments")[0]!.status).toBe("draft");
  });
  it("pure decision table", () => {
    expect(photoPublishDecision({ enrichmentStatus: "draft", hasImage: false })).toBe("no-photo");
    expect(photoPublishDecision({ enrichmentStatus: "published", hasImage: true })).toBe("already-live");
    expect(photoPublishDecision({ enrichmentStatus: null, hasImage: true, hasPublicImage: true })).toBe("publish");
  });
  it("every person-attach path calls it", () => {
    const a = read("src/app/admin/products/actions.ts");
    expect(a.match(/await publishOnPhoto\(key, session\)/g)?.length).toBe(4);
    expect(read("src/app/admin/inventory/drafts/image-actions.ts")).toContain("merge.alreadyPresent ? null : await publishOnPhoto(key, opts.session)");
  });
});

describe("D244 R-1 model, threshold, calibration, best guesses, on hand", () => {
  it("the enrichment model is pinned by AI_ENRICH_MODEL and routes Gemini ids to Gemini", () => {
    const g = resolveEnrichModel({ enrichModel: "gemini-4-carbon", heavyModel: "gpt-4o", effort: "high" });
    expect(g).toMatchObject({ model: "gemini-4-carbon", provider: "gemini", effort: "high", source: "AI_ENRICH_MODEL" });
    expect(enrichMaxTokens(g, 1100)).toBeGreaterThanOrEqual(32000);
    const d = resolveEnrichModel({});
    expect(enrichModelLine(d)).toBe("gpt-4o · OpenAI (built-in default)");
    expect(ENRICH_RECOMMENDED.live.model).toBe("gpt-6.1-sol");
    expect(read("src/lib/ai/all-fields-draft.ts")).toMatch(/model: enrichModel.model,\s+reasoningEffort: enrichModel.effort,/);
    expect(read("src/lib/ai/provider.ts")).toContain("const sent = await postChat(payload, undefined, chatTargetFor(model));");
  });
  it("threshold 80; direct evidence lifts an under-confident field", () => {
    expect(ACCEPT_ALL_THRESHOLD).toBe(80);
    expect(calibrateConfidence(50, 1, false)).toBe(80);
    expect(calibrateConfidence(60, 3, false)).toBe(90);
    expect(calibrateConfidence(45, 2, false)).toBe(45);
    expect(calibrateConfidence(60, 2, true)).toBe(60);
    const m = normalizeDraftField("description", { confidence: 55, evidence: ["pos", "photo:1"], best_guess: false }, ["pos", "photo:1"]);
    expect(m.confidence).toBeGreaterThanOrEqual(85);
    expect(m.bestGuess).toBe(false);
  });
  it("an accepted best guess needs a closer look until it is checked", () => {
    const row = { status: "accepted", source: "ai2:kb:strain:x|best-guess" };
    expect(needsCloserLook(row)).toBe(true);
    expect(needsCloserLook({ ...row, source: markCheckedSource(row.source) })).toBe(false);
  });
  it("on hand = at least one lot in stock, or the menu says in/low stock", () => {
    expect(isOnHandCard("out-of-stock", 1)).toBe(true);
    expect(isOnHandCard("out-of-stock", 0)).toBe(false);
    expect(isOnHandCard("in-stock", null)).toBe(true);
  });
  it("both pages show the flagged list and Looks right; AGENTS.md records the owner words", () => {
    const d = read("src/app/admin/products/[key]/page.tsx");
    for (const id of ["detail-closer-look", "detail-closer-look-ok", "detail-enrich-model-line"]) expect(d).toContain(`data-testid="${id}"`);
    const b = read("src/app/admin/products/bulk-ai/page.tsx");
    for (const id of ["bulk-closer-look", "bulk-closer-look-ok", "enrich-model-line"]) expect(b).toContain(`data-testid="${id}"`);
    const agents = read("AGENTS.md");
    expect(agents).toContain("best guesses should auto accepted, but flagged so we can take a closer look once we have time to.");
    expect(agents).toContain("a product should be publish once it has a picture.");
  });
});
