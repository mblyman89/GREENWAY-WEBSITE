/**
 * tests/compliance/d244-e4-ai-drafting.test.ts - D244 E-4 (AI drafting v2).
 *
 * Owner (verbatim): "Please complete another 3 slices. Follow the standing
 * rules." Strategy doc slice E-4: one "Enrich this product" call drafts every
 * field with per-field confidence, evidence, a best-guess flag and a diff;
 * "Accept all >= 85%" (owner Q3 open -> one constant; Q4 open -> best guesses
 * are never auto-accepted). Round 2 (R-1) owner answers: "lets drop it to
 * 80%." and "best guesses should auto accepted, but flagged so we can take a
 * closer look once we have time to." Closes F-08 (vendor never reached the prompt),
 * F-09 (substring strain match) and F-09b (exact-only KB product slug).
 *
 * Proven on the REAL generator + REAL actions (provider stubbed) through
 * FakePostgrest.
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
  item: null as Record<string, unknown> | null,
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
  buildGroundedFacts: async () => ({
    block: "- Blue Dream: sweet berry, blueberry; hybrid",
    sources: ["kb:strain:blue dream", "kb:category:flower"],
    strain: null,
    category: "flower",
  }),
}));
vi.mock("@/lib/pos/menu-version", async (orig) => ({
  ...((await orig()) as object),
  getPublishedVersion: async () => ({ id: "v-1" }),
  getItemBySourceKey: async () => st.item,
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

import { generateProductAi, acceptAllHighConfidence, acceptSuggestion, markBestGuessCheckedAction } from "@/app/admin/products/actions";
import { listNeedsCloserLook } from "@/lib/enrichment/accept-drafts-server";
import { __runAiDraftV2Tests, ACCEPT_ALL_THRESHOLD, parseEvidenceSource } from "@/lib/enrichment/ai-draft-v2-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KEY = "pos-bd";

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
const meta = (confidence: number, evidence: string[], best_guess = false) => ({ confidence, evidence, best_guess });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls.length = 0;
  st.audits.length = 0;
  st.item = {
    name: "Phat Panda Blue Dream 3.5g",
    product_name: "Blue Dream",
    brand_name: "Phat Panda",
    vendor_name: "Hollingsworth Cannabis",
    category: "flower",
    strain_type: "hybrid",
    strain_name: "Blue Dream",
    thc: "24%",
    cbd: null,
  };
  st.db.rows("product_enrichments").push({
    id: "e-1",
    pos_product_key: KEY,
    display_name: null,
    description: "Old copy.",
    short_description: null,
    image_media_ids: ["m-1"],
    primary_media_id: "m-1",
    vendor_id: null,
    tags: [],
    seo_title: null,
    seo_description: null,
    status: "draft",
  });
  st.db.rows("media_assets").push({
    id: "m-1",
    ai_description: "A black jar with a blue label",
    ai_caption: null,
    visible_text: "PHAT PANDA BLUE DREAM 3.5G",
    product_name: "Blue Dream",
    pack_size: "3.5g",
  });
  st.reply = {
    display_name: { value: "Phat Panda Blue Dream 3.5g", ...meta(96, ["pos", "photo:1"]) },
    description: {
      value: "Blue Dream from Phat Panda brings sweet berry aroma over a smooth hybrid flower, packed in a 3.5 gram jar.",
      ...meta(0.9, ["pos", "kb:strain:blue dream", "invented:id"]),
    },
    short_description: { value: "Sweet berry hybrid flower from Phat Panda.", ...meta(88, ["pos"]) },
    seo: {
      title: "Blue Dream 3.5g by Phat Panda | Greenway Marijuana",
      meta: "Blue Dream hybrid flower from Phat Panda with sweet berry aroma and a smooth finish, in a 3.5 gram jar. Order ahead for in-store pickup in Port Orchard.",
      ...meta(90, ["pos"]),
    },
    sensory: { aroma_notes: ["berry", "sweet"], flavor_notes: ["blueberry"], terpenes: ["myrcene"], ...meta(80, ["kb:strain:blue dream"]) },
    effects: { values: ["relaxed", "cures everything", "uplifted"], ...meta(75, ["kb:strain:blue dream"], true) },
    tags: { values: ["local", "not-a-tag"], ...meta(50, []) },
  };
});

describe("D244 E-4 ai-draft-v2-core", () => {
  it("runs exactly 53 assertions, none failing, registered at that floor", () => {
    expect(__runAiDraftV2Tests()).toEqual({ passed: 53, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ai-draft-v2-core", __runAiDraftV2Tests(), 53); // D244 E-4');
  });
  it("Q3 is one constant (80, owner R-1); Q4 accepts best guesses and flags them", () => {
    expect(ACCEPT_ALL_THRESHOLD).toBe(80);
    expect(read("src/lib/enrichment/ai-draft-v2-core.ts")).toContain("if (ev.bestGuess) return opts.bestGuesses !== false;");
  });
});

describe("D244 E-4 - Enrich this product (all fields)", () => {
  it("ONE call drafts every field; vendor + photo facts are read on the server and offered as evidence", async () => {
    const to = await run(generateProductAi(fd({ key: KEY, kind: "all", posName: "FORGED name" })));
    expect(to).toBe(`/admin/products/${KEY}?ai=1#ai`);
    expect(st.calls).toHaveLength(1);
    const call = st.calls[0]!;
    expect(call.context).toMatchObject({ feature: "product.all_fields", entityId: KEY });
    const user = String(call.user);
    expect(user).toContain("[pos] Product name (POS): Phat Panda Blue Dream 3.5g");
    expect(user).toContain("[vendor] Vendor (who we buy it from): Hollingsworth Cannabis");
    expect(user).toContain('[photo:1] Attached photo 1: the package reads "PHAT PANDA BLUE DREAM 3.5G"');
    expect(user).toContain("[kb:strain:blue dream]");
    expect(user).toContain("best_guess MUST be true");
    expect(user).toContain("- description: Old copy.");
    expect(user).toMatch(/Never mention price/);
    expect(user).not.toContain("FORGED");

    const rows = st.db.rows("ai_suggestions");
    const by = (k: string) => rows.find((r) => r.field_key === k)!;
    expect(rows.map((r) => r.field_key).sort()).toEqual(
      ["description", "display_name", "effects", "seo", "sensory", "short_description", "tags"].sort(),
    );
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    // 0.9 -> 90%; the invented evidence id is dropped.
    expect(by("description").confidence).toBe(0.9);
    expect(by("description").source).toBe("ai2:pos,kb:strain:blue dream");
    // Strain-family only -> best guess, capped at 70.
    expect(parseEvidenceSource(String(by("sensory").source)).bestGuess).toBe(true);
    expect(by("sensory").confidence).toBe(0.7);
    // Effects are re-gated; the medical claim never lands.
    expect(by("effects").suggested_value).toBe("relaxed, uplifted");
    // No evidence -> capped at 40; disallowed tag dropped.
    expect(by("tags").suggested_value).toBe("local");
    expect(by("tags").confidence).toBe(0.4);
    // SEO re-cleaned: no store name, <= 39 chars.
    const seo = JSON.parse(String(by("seo").suggested_value));
    expect(seo.seo_title).not.toMatch(/greenway/i);
    expect(seo.seo_title.length).toBeLessThanOrEqual(39);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_generated", after: { kind: "all", photos: 1, vendor: true } });
  });

  it("Accept all >= 80% applies the high-confidence drafts plus best guesses (flagged)", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    const to = await run(acceptAllHighConfidence(fd({ key: KEY })));
    expect(to.startsWith(`/admin/products/${KEY}?saved=1&note=`)).toBe(true);
    const status = Object.fromEntries(st.db.rows("ai_suggestions").map((r) => [r.field_key, r.status]));
    expect(status).toMatchObject({
      display_name: "accepted",
      description: "accepted",
      short_description: "accepted",
      seo: "accepted",
      // D244 R-1 (owner: "best guesses should auto accepted, but flagged"):
      sensory: "accepted",
      effects: "accepted",
      tags: "accepted",
    });
    expect(decodeURIComponent(to)).toContain("3 best guesses are live and flagged for a closer look (sensory, effects, tags)");
    const flagged = await listNeedsCloserLook({ entityId: KEY });
    expect(flagged?.map((r) => r.field_key).sort()).toEqual(["effects", "sensory", "tags"]);
    // "Looks right" clears the flag; the best-guess badge stays.
    const sid = flagged!.find((r) => r.field_key === "sensory")!.id;
    const back = await run(markBestGuessCheckedAction(fd({ id: sid, return: "detail", key: KEY })));
    expect(back).toBe(`/admin/products/${KEY}?saved=1&note=${encodeURIComponent("Marked as checked.")}#closer-look`);
    const row = st.db.rows("ai_suggestions").find((r) => r.id === sid)!;
    expect(String(row.source)).toMatch(/\|best-guess\|checked$/);
    expect(parseEvidenceSource(String(row.source)).bestGuess).toBe(true);
    expect((await listNeedsCloserLook({ entityId: KEY }))?.map((r) => r.field_key).sort()).toEqual(["effects", "tags"]);
    expect(st.audits.at(-1)).toMatchObject({ action: "product.ai_best_guess_checked", entityId: KEY, after: { field: "sensory" } });
    const e = st.db.rows("product_enrichments")[0]!;
    expect(e.display_name).toBe("Phat Panda Blue Dream 3.5g");
    expect(e.short_description).toBe("Sweet berry hybrid flower from Phat Panda.");
    expect(String(e.description)).toContain("Blue Dream from Phat Panda");
    expect(e.seo_title).toBeTruthy();
    expect(st.audits.find((a) => a.action === "product.ai_accepted_all")).toMatchObject({ after: { threshold: 80, flagged_best_guesses: ["sensory", "effects", "tags"] } });
  });

  it("Accept all with nothing eligible says so and accepts nothing", async () => {
    // Raw 45 is under the calibration floor (50), so direct evidence does not lift it; no best guesses filed.
    st.reply = {
      ...st.reply,
      display_name: { value: "X", ...meta(45, ["pos"]) },
      description: { value: "Y copy here.", ...meta(45, ["pos"]) },
      short_description: { value: "Z", ...meta(10, ["pos"]) },
      seo: { title: "", meta: "", ...meta(10, ["pos"]) },
      sensory: { aroma_notes: [], flavor_notes: [], terpenes: [], ...meta(0, []) },
      effects: { values: [], ...meta(0, []) },
      tags: { values: [], ...meta(0, []) },
    };
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    const to = await run(acceptAllHighConfidence(fd({ key: KEY })));
    expect(decodeURIComponent(to)).toContain("No draft is at or above 80% and none is a best guess");
    expect(st.db.rows("ai_suggestions").every((r) => r.status === "pending")).toBe(true);
  });

  it("single Accept writes display_name / short_description too", async () => {
    await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    const id = String(st.db.rows("ai_suggestions").find((r) => r.field_key === "short_description")!.id);
    const to = await run(acceptSuggestion(fd({ id, key: KEY })));
    expect(to).toBe(`/admin/products/${KEY}?saved=1#ai`);
    expect(st.db.rows("product_enrichments")[0]!.short_description).toBe("Sweet berry hybrid flower from Phat Panda.");
  });

  it("a reply with nothing usable files nothing and flashes an error", async () => {
    st.reply = {
      display_name: { value: "", ...meta(0, []) },
      description: { value: "", ...meta(0, []) },
      short_description: { value: "", ...meta(0, []) },
      seo: { title: "", meta: "", ...meta(0, []) },
      sensory: { aroma_notes: [], flavor_notes: [], terpenes: [], ...meta(0, []) },
      effects: { values: [], ...meta(0, []) },
      tags: { values: [], ...meta(0, []) },
    };
    const to = await run(generateProductAi(fd({ key: KEY, kind: "all" })));
    expect(decodeURIComponent(to)).toContain("nothing usable for any field");
    expect(st.db.rows("ai_suggestions")).toHaveLength(0);
  });
});

describe("D244 E-4 wiring pins", () => {
  it("retrieval uses the fuzzy strain match (F-09) and slug candidates (F-09b)", () => {
    const r = read("src/lib/ai/kb/retrieval.ts");
    expect(r).toContain("strainMatchFromText(strains, { strainName: facts.strainName, name: facts.name })?.strain ?? null");
    expect(r).toContain('.in("product_slug", slugs)');
    expect(r).toContain("kbProductSlugCandidates(productName, facts.brand, facts.vendor)");
    expect(r).not.toContain("haystack.includes(c)");
  });
  it("the detail page has the all-fields button, accept-all, evidence chips, best-guess badge and diff", () => {
    const p = read("src/app/admin/products/[key]/page.tsx");
    expect(p).toContain('<input type="hidden" name="kind" value="all" />');
    expect(p).toContain('data-testid="ai-draft-all"');
    expect(p).toContain('data-testid="ai-accept-all"');
    expect(p).toContain('data-testid="ai-evidence"');
    expect(p).toContain('data-testid="ai-best-guess"');
    expect(p).toContain('data-testid="ai-diff"');
    // The older one-field drafts stay.
    expect(p).toContain('data-testid="ai-draft-seo"');
  });
});
