/**
 * tests/compliance/r23-seo-draft.test.ts - R23 owner fix 4.
 *
 *   "I would like an ai suggestion for the seo title and the seo meta
 *    description in the product enrichment page."
 *
 * Proven on the REAL generator (provider stubbed), the REAL accept action
 * and the REAL public-page enrichment read, through FakePostgrest:
 *   - "Draft SEO title & meta" files ONE pending suggestion (field_key "seo")
 *     whose title is cleaned to the 39-character product part (the layout
 *     adds " | Greenway Marijuana") and whose meta is <= 160 characters;
 *   - the prompt is grounded in the card's OWN description read on the
 *     server (never a form value) and carries no price;
 *   - Accept writes seo_title + seo_description to the enrichment; the
 *     compliance re-scan refuses a draft with a blocking claim and writes
 *     nothing; an unreadable draft is refused;
 *   - the public product page serves a PUBLISHED card's SEO (own key, else
 *     the product's published survivor), never a draft's, and never breaks.
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
  redirects: [] as string[],
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
    return st.reply;
  }),
  generateJSON: vi.fn(),
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [],
  buildGroundedFacts: async () => ({ block: "", sources: [] }),
}));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ userId: "u-1", email: "o@example.com" }) }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: Record<string, unknown>) => void st.audits.push(a) }));
vi.mock("@/lib/ai/kb/writeback", () => ({ writeBackOnPublish: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.redirects.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { generateProductSeo } from "@/lib/ai/suggestions";
import { acceptSuggestion, generateProductAi } from "@/app/admin/products/actions";
import { getEnrichmentForPublicItem } from "@/lib/enrichment/store";
import {
  __runSeoDraftCoreTests,
  SEO_TITLE_MAX,
  SEO_META_MAX,
  productSeoMetadata,
  parseSeoSuggestion,
} from "@/lib/enrichment/seo-draft-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KEY = "pos-bcp";

function seedEnrichment(over: Record<string, unknown> = {}) {
  st.db.rows("product_enrichments").push({
    id: "e-1",
    pos_product_key: KEY,
    description: "Sweet banana and vanilla cream over a soft hybrid flower.",
    short_description: null,
    image_media_ids: [],
    primary_media_id: null,
    seo_title: null,
    seo_description: null,
    status: "published",
    ...over,
  });
}
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
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

const LONG_META =
  "Sweet banana and vanilla cream notes over a soft, smooth hybrid flower from Easy Peasy, grown in Washington and ready for in-store pickup at Greenway in Port Orchard.";

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls.length = 0;
  st.audits.length = 0;
  st.redirects.length = 0;
  st.reply = {
    seo_title: "Banana Cream Pie Hybrid Flower by Easy Peasy | Greenway Marijuana",
    seo_description: LONG_META,
    confidence: 0.8,
  };
});

describe("R23 seo-draft-core", () => {
  it("runs exactly 51 assertions, none failing, registered at that floor", () => {
    expect(__runSeoDraftCoreTests()).toEqual({ passed: 51, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("seo-draft-core", __runSeoDraftCoreTests(), 51);');
  });
});

describe("R23 fix 4 - Draft SEO title & meta", () => {
  it("files ONE pending 'seo' suggestion, cleaned to the length rules", async () => {
    const g = await generateProductSeo(KEY, { name: "Banana Cream Pie", brand: "Easy Peasy", category: "flower" }, "u-1");
    const rows = st.db.rows("ai_suggestions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: "product", entity_id: KEY, field_key: "seo", status: "pending", source: "model" });
    const d = parseSeoSuggestion(rows[0]!.suggested_value)!;
    expect(d.title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(d.title).not.toMatch(/greenway/i); // the layout appends it once
    expect(d.title.startsWith("Banana Cream Pie")).toBe(true);
    expect(d.description.length).toBeLessThanOrEqual(SEO_META_MAX);
    expect(g.blockingFlags).toEqual([]);
    expect(st.calls[0]!.context).toMatchObject({ feature: "product.seo", entityId: KEY });
  });

  it("an empty reply files nothing and says so", async () => {
    st.reply = { seo_title: "  ", seo_description: LONG_META, confidence: 0.2 };
    await expect(generateProductSeo(KEY, { name: "X" }, null)).rejects.toThrow("no usable SEO title");
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
  });

  it("the action grounds the prompt in the card's OWN description (server read) and the shown aroma/flavor", async () => {
    seedEnrichment();
    const to = await run(
      generateProductAi(
        fd({
          key: KEY,
          kind: "seo",
          posName: "Banana Cream Pie",
          posBrand: "Easy Peasy",
          posCategory: "flower",
          posAroma: "banana, cream",
          posFlavor: "vanilla",
          // A forged form description must never reach the prompt.
          description: "FORGED cures anxiety",
        }),
      ),
    );
    expect(to).toBe(`/admin/products/${KEY}?ai=1#ai`);
    const user = String(st.calls[0]!.user);
    expect(user).toContain("Our description: Sweet banana and vanilla cream over a soft hybrid flower.");
    expect(user).toContain("Aroma: banana, cream");
    expect(user).toContain("Flavor: vanilla");
    expect(user).not.toContain("FORGED");
    expect(user).toMatch(/Never mention price/);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_generated", after: { kind: "seo" } });
  });

  it("Accept writes seo_title + seo_description to the enrichment and marks the draft accepted", async () => {
    seedEnrichment();
    await generateProductSeo(KEY, { name: "Banana Cream Pie" }, "u-1");
    const id = String(st.db.rows("ai_suggestions")[0]!.id);
    const to = await run(acceptSuggestion(fd({ id, key: KEY })));
    expect(to).toBe(`/admin/products/${KEY}?saved=1#ai`);
    const e = st.db.rows("product_enrichments")[0]!;
    expect(e.seo_title).toBe(parseSeoSuggestion(st.db.rows("ai_suggestions")[0]!.suggested_value)!.title);
    expect(String(e.seo_description).length).toBeLessThanOrEqual(SEO_META_MAX);
    expect(st.db.rows("ai_suggestions")[0]!.status).toBe("accepted");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_accepted", after: { field: "seo" } });
  });

  it("the accept-time compliance re-scan refuses a blocking claim and writes nothing", async () => {
    seedEnrichment();
    st.db.rows("ai_suggestions").push({
      id: "s-bad",
      entity_type: "product",
      entity_id: KEY,
      field_key: "seo",
      status: "pending",
      suggested_value: JSON.stringify({ seo_title: "Pie that cures cancer", seo_description: "This flower cures cancer and treats pain." }),
    });
    const to = await run(acceptSuggestion(fd({ id: "s-bad", key: KEY })));
    expect(to).toContain("error=");
    expect(st.db.rows("product_enrichments")[0]!.seo_title).toBeNull();
    expect(st.db.rows("ai_suggestions")[0]!.status).toBe("pending");
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_accept_blocked" });
  });

  it("an unreadable 'seo' draft is refused, nothing written", async () => {
    seedEnrichment();
    st.db.rows("ai_suggestions").push({ id: "s-x", entity_type: "product", entity_id: KEY, field_key: "seo", status: "pending", suggested_value: "{nope" });
    const to = await run(acceptSuggestion(fd({ id: "s-x", key: KEY })));
    expect(decodeURIComponent(to)).toContain("That SEO draft could not be read");
    expect(st.db.rows("product_enrichments")[0]!.seo_title).toBeNull();
    expect(st.db.rows("ai_suggestions")[0]!.status).toBe("pending");
  });
});

describe("R23 fix 4 - the public product page serves the accepted SEO", () => {
  it("own published row -> its SEO; a draft row -> the defaults", async () => {
    seedEnrichment({ seo_title: "Banana Cream Pie", seo_description: "Ours." });
    const row = await getEnrichmentForPublicItem({ posKey: KEY, identityKey: null });
    expect(productSeoMetadata({ enrichment: row, defaultTitle: "D", defaultDescription: "DD" })).toMatchObject({ title: "Banana Cream Pie", description: "Ours." });
    st.db.rows("product_enrichments")[0]!.status = "draft";
    const draft = await getEnrichmentForPublicItem({ posKey: KEY, identityKey: null });
    expect(productSeoMetadata({ enrichment: draft, defaultTitle: "D", defaultDescription: "DD" })).toMatchObject({ title: "D", description: "DD" });
  });

  it("no own row: the product's published survivor (S20 identity) is served", async () => {
    vi.stubEnv("ENRICHMENT_FOLLOWS_IDENTITY", "1");
    try {
      st.db.rows("product_enrichments").push({
        id: "e-old",
        pos_product_key: "pos-old-lot",
        identity_key: "easy-peasy|flower|banana-cream-pie",
        description: "Earlier lot copy.",
        image_media_ids: [],
        primary_media_id: null,
        seo_title: "Banana Cream Pie",
        seo_description: "Survivor meta.",
        status: "published",
        updated_at: "2026-01-01T00:00:00Z",
      });
      const row = await getEnrichmentForPublicItem({ posKey: "pos-new-lot", identityKey: "easy-peasy|flower|banana-cream-pie" });
      expect(row?.pos_product_key).toBe("pos-old-lot");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a failed read never breaks the page (null -> defaults)", async () => {
    st.db.missing.add("product_enrichments");
    const row = await getEnrichmentForPublicItem({ posKey: KEY, identityKey: "x" });
    expect(row).toBeNull();
    expect(productSeoMetadata({ enrichment: row, defaultTitle: "D", defaultDescription: "DD" }).title).toBe("D");
  });

  it("generateMetadata reads it, merch skipped; the enrichment page offers the button + length help", () => {
    const pub = read("src/app/menu/products/[id]/page.tsx");
    expect(pub).toContain("isMerchItem(item) ? null : await getEnrichmentForPublicItem({ posKey: item.id, identityKey: item.identityKey })");
    expect(pub).toMatch(/title: seo\.title,\s*description: seo\.description,/);
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain('<input type="hidden" name="kind" value="seo" />');
    expect(page).toContain('data-testid="ai-draft-seo"');
    expect(page).toContain('data-testid="seo-title-help"');
    expect(page).toContain('data-testid="seo-meta-help"');
    expect(page).toContain("seoSuggestionDisplay(s.suggested_value)");
    const actions = read("src/app/admin/products/actions.ts");
    // The SEO accept still runs through the shared compliance gate first.
    expect(actions.indexOf("acceptWithComplianceGate(sugg!)")).toBeLessThan(actions.indexOf("sugg!.field_key === SEO_FIELD_KEY"));
  });
});
