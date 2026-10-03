/**
 * tests/compliance/r25-kb-slug-dashes.test.ts  (R25 B)
 *
 * Owner (R25, verbatim): "I also would like you to build the brand form use
 * dashes and other types of things like using dashes."
 *
 * Proven through the REAL store writers (upsertKbBrand,
 * upsertKbProductCategory, upsertKbFaq) and the REAL brand form action over
 * postgrest-js against FakePostgrest:
 *   A. pure core floor + spot checks;
 *   B. brand: a typed spaced slug and a blank slug both save DASHED (the key
 *      the intake writer reads); a legacy exact row keeps updating ITSELF; a
 *      failed existence read refuses (never forks); punctuation-only refused;
 *   C. product type + FAQ: same rule; every seeded slug is a fixed point;
 *   D. the form action reports the saved slug, audits typed vs saved, and
 *      shows a refusal as an error;
 *   E. source pins: no spaced brand slug left anywhere in the form; strains
 *      stay spaced.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Record<string, unknown>[],
  redirects: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.redirects.push(url);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ profile: { id: "00000000-0000-4000-8000-0000000000ac" } }) }));
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
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const store = await import("@/lib/ai/kb/store");
const actions = await import("@/app/admin/knowledge-base/actions");
const core = await import("@/lib/catalog/kb-slug-input-core");
const { PRODUCT_CATEGORIES } = await import("@/lib/ai/kb/product-categories-data");
const { SEED_FAQS } = await import("@/lib/ai/kb/seed");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000ac";

function fresh() {
  st.db = new FakePostgrest();
  st.db.uniques.push(
    { table: "kb_brands", columns: ["slug"], name: "kb_brands_slug_key" },
    { table: "kb_product_categories", columns: ["slug"], name: "kb_product_categories_slug_key" },
    { table: "kb_faqs", columns: ["slug"], name: "kb_faqs_slug_key" },
  );
  for (const t of ["kb_brands", "kb_product_categories", "kb_faqs"]) st.db.defaults.set(t, () => ({ id: st.db.nextId() }));
  st.audits = [];
  st.redirects = [];
}
beforeEach(fresh);

const slugs = (t: string) => st.db.rows(t).map((r) => r.slug).sort();
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function runAction(fn: (f: FormData) => Promise<void>, f: FormData): Promise<string> {
  await expect(fn(f)).rejects.toThrow("NEXT_REDIRECT");
  return decodeURIComponent(st.redirects.at(-1) ?? "");
}

// ─── A ──────────────────────────────────────────────────────────────────────
describe("R25 B - kb-slug-input-core", () => {
  it("embedded self-tests pass at the exact floor", () => {
    const r = core.__runKbSlugInputCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(38);
  });
});

// ─── B. brand ───────────────────────────────────────────────────────────────
describe("R25 B - kb_brands slugs are dashed", () => {
  it("blank slug -> dashed from the name (the key the intake writer reads)", async () => {
    const r = await store.upsertKbBrand({ slug: "", name: "Phat Panda" }, ACTOR);
    expect(r).toEqual({ slug: "phat-panda", via: "name_dashed", changed: false });
    expect(slugs("kb_brands")).toEqual(["phat-panda"]);
    expect(st.db.rows("kb_brands")[0].name).toBe("Phat Panda");
  });

  it("typed spaced slug -> dashed, and reported as changed", async () => {
    const r = await store.upsertKbBrand({ slug: "Phat Panda", name: "Phat Panda" }, ACTOR);
    expect(r).toEqual({ slug: "phat-panda", via: "typed_dashed", changed: true });
    expect(slugs("kb_brands")).toEqual(["phat-panda"]);
  });

  it("saving the same brand twice updates ONE row (no fork)", async () => {
    await store.upsertKbBrand({ slug: "", name: "Phat Panda", known_for: "a" }, ACTOR);
    await store.upsertKbBrand({ slug: "phat panda", name: "Phat Panda", known_for: "b" }, ACTOR);
    expect(st.db.rows("kb_brands")).toHaveLength(1);
    expect(st.db.rows("kb_brands")[0].known_for).toBe("b");
  });

  it("a LEGACY spaced row keeps updating itself (never silently forked)", async () => {
    st.db.rows("kb_brands").push({ id: "legacy", slug: "old brand", name: "Old Brand", known_for: null });
    const r = await store.upsertKbBrand({ slug: "old brand", name: "Old Brand", known_for: "kept" }, ACTOR);
    expect(r).toEqual({ slug: "old brand", via: "existing_exact", changed: false });
    expect(st.db.rows("kb_brands")).toHaveLength(1);
    expect(st.db.rows("kb_brands")[0].known_for).toBe("kept");
  });

  it("the existence read is exact (a near-miss is not a legacy match)", async () => {
    st.db.rows("kb_brands").push({ id: "legacy", slug: "old brand", name: "Old Brand" });
    const r = await store.upsertKbBrand({ slug: "Old Brand", name: "Old Brand" }, ACTOR);
    expect(r.slug).toBe("old-brand");
    const get = st.db.log.find((q) => q.method === "GET" && q.table === "kb_brands")!;
    expect(get.url.searchParams.get("slug")).toBe("eq.Old Brand");
  });

  it("a FAILED existence read refuses the save (could otherwise fork a legacy row)", async () => {
    st.db.before = (req) =>
      req.method === "GET" && req.table === "kb_brands" ? { status: 500, body: { code: "XX000", message: "db down", details: null, hint: null } } : undefined;
    await expect(store.upsertKbBrand({ slug: "phat panda", name: "Phat Panda" }, ACTOR)).rejects.toThrow(/db down/);
    expect(st.db.log.some((q) => q.method === "POST")).toBe(false);
  });

  it("blank slug never reads (nothing to match)", async () => {
    await store.upsertKbBrand({ slug: "  ", name: "Phat Panda" }, ACTOR);
    expect(st.db.log.filter((q) => q.method === "GET")).toHaveLength(0);
  });

  it("punctuation-only slug is refused, never replaced by a guess", async () => {
    await expect(store.upsertKbBrand({ slug: "!!!", name: "Phat Panda" }, ACTOR)).rejects.toThrow(/letters, numbers and dashes/);
    expect(st.db.rows("kb_brands")).toHaveLength(0);
  });

  it("the form slug equals the writer's key for a corpus of real brand names", async () => {
    const { dashedSlug } = await import("@/lib/catalog/slug-core");
    for (const name of ["Phat Panda", "Fifty-Fold & Co.", "2 Blunt Bros", "Mfused's Best", "  Sea_Side  Farms "]) {
      fresh();
      const r = await store.upsertKbBrand({ slug: "", name }, ACTOR);
      expect(r.slug, name).toBe(dashedSlug(name));
      expect(r.slug).not.toMatch(/\s/);
    }
  });
});

// ─── C. product type + FAQ ──────────────────────────────────────────────────
describe("R25 B - product type and FAQ slugs are dashed", () => {
  it("product type: typed spaced slug dashed; blank from name", async () => {
    expect((await store.upsertKbProductCategory({ slug: "Edible Gummies", name: "Gummies", group_key: "edible" }, ACTOR)).ok).toBe(true);
    expect((await store.upsertKbProductCategory({ slug: null, name: "Hash Rosin", group_key: "concentrate" }, ACTOR)).ok).toBe(true);
    expect(slugs("kb_product_categories")).toEqual(["edible-gummies", "hash-rosin"]);
  });

  it("product type: legacy exact row kept; refusal returns the reason", async () => {
    st.db.rows("kb_product_categories").push({ id: "c1", slug: "Old Cat", name: "Old", group_key: "edible" });
    expect((await store.upsertKbProductCategory({ slug: "Old Cat", name: "Old", group_key: "edible", summary: "x" }, ACTOR)).ok).toBe(true);
    expect(st.db.rows("kb_product_categories")).toHaveLength(1);
    const bad = await store.upsertKbProductCategory({ slug: "--", name: "X", group_key: "edible" }, ACTOR);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/letters, numbers and dashes/);
  });

  it("every SEEDED product type slug is a fixed point (nothing re-keyed)", () => {
    expect(PRODUCT_CATEGORIES.length).toBeGreaterThan(20);
    for (const c of PRODUCT_CATEGORIES) expect(core.isDashedDrift(c.slug), c.slug).toBe(false);
  });

  it("FAQ: typed slug dashed; edit of an existing slug kept; blank refused", async () => {
    expect((await store.upsertKbFaq({ slug: "Parking Info", question: "Q?", answer: "A." }, ACTOR)).ok).toBe(true);
    expect(slugs("kb_faqs")).toEqual(["parking-info"]);
    st.db.rows("kb_faqs").push({ id: "f0", slug: "Legacy FAQ", question: "Q", answer: "A" });
    expect((await store.upsertKbFaq({ slug: "Legacy FAQ", question: "Q2", answer: "A2" }, ACTOR)).ok).toBe(true);
    expect(st.db.rows("kb_faqs").filter((r) => r.slug === "Legacy FAQ")[0].question).toBe("Q2");
    expect(st.db.rows("kb_faqs")).toHaveLength(2);
    const blank = await store.upsertKbFaq({ slug: "  ", question: "Q", answer: "A" }, ACTOR);
    expect(blank).toEqual({ ok: false, message: "A slug is required." });
  });

  it("every SEEDED FAQ slug is a fixed point", () => {
    expect(SEED_FAQS.length).toBeGreaterThan(10);
    for (const f of SEED_FAQS) expect(core.isDashedDrift(f.slug), f.slug).toBe(false);
  });
});

// ─── D. the brand form action ───────────────────────────────────────────────
describe("R25 B - upsertBrandAction", () => {
  it("saves dashed, tells the person the saved slug, audits typed vs saved", async () => {
    const url = await runAction(actions.upsertBrandAction, fd({ name: "Phat Panda", slug: "phat panda", known_for: "", house_style: "", sensory_notes: "" }));
    expect(url).toContain("msg=");
    expect(url).toContain('slug saved as "phat-panda"');
    expect(slugs("kb_brands")).toEqual(["phat-panda"]);
    const a = st.audits.find((x) => x.action === "kb.brand.upsert")!;
    expect(a.entityId).toBe("phat-panda");
    expect(a.after).toEqual({ slug: "phat-panda", typed_slug: "phat panda", slug_via: "typed_dashed" });
  });

  it("blank slug: plain success message", async () => {
    const url = await runAction(actions.upsertBrandAction, fd({ name: "Phat Panda" }));
    expect(url).toContain('msg=Saved brand facts for "Phat Panda".');
    expect((st.audits[0].after as Row).typed_slug).toBeNull();
  });

  it("a refusal is shown as an error and nothing is saved or audited", async () => {
    const url = await runAction(actions.upsertBrandAction, fd({ name: "Phat Panda", slug: "???" }));
    expect(url).toContain("error=");
    expect(url).toMatch(/letters, numbers and dashes/);
    expect(st.db.rows("kb_brands")).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });
});

// ─── E. pins ────────────────────────────────────────────────────────────────
describe("R25 B - source pins", () => {
  it("the brand form no longer builds a SPACED slug", () => {
    const a = read("src/app/admin/knowledge-base/actions.ts");
    const fn = a.slice(a.indexOf("export async function upsertBrandAction"), a.indexOf("export async function updateBrandFactsAction"));
    expect(fn).not.toMatch(/replace\(\/\\s\+\/g, " "\)/);
    expect(fn).not.toMatch(/toLowerCase\(\)/);
  });
  it("the three dashed writers go through resolveDashedKbSlug; strains stay spaced", () => {
    const s = read("src/lib/ai/kb/store.ts");
    expect(s).toContain('resolveDashedKbSlug(admin, "kb_brands", input.slug, input.name)');
    expect(s).toContain('resolveDashedKbSlug(admin, "kb_product_categories", input.slug, input.name)');
    expect(s).toContain('resolveDashedKbSlug(admin, "kb_faqs", input.slug)');
    expect(s).toContain("const slug = strainSlug(input.slug?.trim() || name);");
    expect(s).not.toContain("slug: input.slug.trim().toLowerCase(),");
  });
  it("the drift report's SQL expression is dashedSlug and is read-only", () => {
    const r = read("scripts/recon/kb-slug-drift-report.sql");
    expect(r).toContain("regexp_replace(regexp_replace(lower(btrim(r.slug)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g')");
    expect(r).not.toMatch(/\b(update|delete|insert|alter|drop)\b\s/i);
  });
  it("the runner registers the core at the exact floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("kb-slug-input-core", __runKbSlugInputCoreTests(), 38);');
  });
});
