/**
 * tests/compliance/r74-s15-category-gate.test.ts   (R74 S15)
 *
 * Owner, round 2 answer 3: "If Is Cannabis = true but the category is
 * non-cannabis, owner must pick a category before the manifest can finish
 * onboarding." Round 8: "Do each bullet point as its own slice."
 *
 * Behavioural, through the REAL postgrest-js client against FakePostgrest:
 *   A. approval: a draft whose live card is held (hidden_reason
 *      "needs_category") is refused without a person's category pick in the
 *      SAME submission - the placeholder category the resolver accepts does
 *      not count; with a pick it is approved and the pick is recorded; a card
 *      that is not held is approved as before.
 *   B. fail closed: an unreadable hold (menu_items or menu_versions) refuses
 *      even with a pick; "Approve all priced" skips held rows with the reason.
 *   C. the manifest is never "Done" while a held product is not approved; an
 *      unreadable hold read never shows Done.
 *   D. wiring: the page renders the required picker + note for held rows; the
 *      self-test pins.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Record<string, unknown>[],
  stageCalls: [] as string[],
  published: { id: "00000000-0000-4000-8000-0000000000f1" } as { id: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
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
// getPublishedVersion (the live-price read) is mocked; the S15 gate reads the
// version itself, strictly, through the fake database.
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => st.published,
  getItemBySourceKey: async () => null,
  archiveSupersededStaged: async () => 0,
}));
// The resolver says "paraphernalia" - the transform's placeholder for a held
// card - so the ordinary classification gate (SLICE 64) asks for nothing.
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) =>
    lots.map(() => ({ websiteCategory: "paraphernalia", label: "Paraphernalia", raw: null, source: "menu_item", unmapped: false })),
  resolveWebsiteCategoryForLot: async () => ({ websiteCategory: "paraphernalia", label: "Paraphernalia", raw: null, source: "menu_item", unmapped: false }),
  resolveWebsiteCategoriesWithLiveKeys: async () => [],
}));
vi.mock("@/lib/inventory/pricing", async (orig) => ({
  ...((await orig()) as object),
  getPricingSettings: async () => ({ min_markup_multiple: 2 }),
  getVelocityForProduct: async () => null,
  suggestPrice: () => ({ floorMinor: 1000, suggestedMinor: 2000, rationale: "computed" }),
  validatePrice: () => ({ ok: false, floorMinor: 999_999, error: "below the floor" }),
}));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async (id: string) => {
    st.stageCalls.push(id);
    return { versionId: null };
  },
}));

const { approveDraftWithPrice, approveAllPricedForManifest } = await import("@/lib/inventory/catalog-drafts");
const { loadCultiveraManifestSection } = await import("@/lib/inventory/cultivera-onboarding");
const { loadPublishedCategoryHoldKeys, loadAllPublishedCategoryHoldKeys, loadHeldKeysForPage } = await import(
  "@/lib/inventory/cultivera-category-gate"
);
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const core = await import("@/lib/inventory/cultivera-category-gate-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const M = "00000000-0000-4000-8000-00000000aa01"; // rebuilt
const V = "00000000-0000-4000-8000-0000000000f1";
const OLD_V = "00000000-0000-4000-8000-0000000000f0";
const D_HELD = "00000000-0000-4000-8000-00000000d001";
const D_FREE = "00000000-0000-4000-8000-00000000d002";
const DOWN = { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } };

function draft(id: string, key: string, extra: Row = {}): Row {
  return {
    id,
    manifest_id: M,
    pos_product_key: key,
    name: `Product ${key}`,
    brand_name: "Brand",
    vendor_name: "Vendor",
    inventory_type: "Usable Marijuana",
    category: "Paraphernalia",
    strain_name: null,
    lot_id: null,
    unit_cost_minor_units: 500,
    suggested_price_minor_units: 2000,
    status: "draft",
    created_at: id === D_HELD ? "2026-10-01T00:00:00Z" : "2026-10-02T00:00:00Z",
    ...extra,
  };
}

beforeEach(() => {
  const db = new FakePostgrest();
  st.db = db;
  st.audits = [];
  st.stageCalls = [];
  st.published = { id: V };
  delete process.env.CULTIVERA_CARD_REFRESH;
  delete process.env.INTAKE_BATCH_STAGING;
  db.rows("inbound_manifests").push({
    id: M,
    manifest_number: "CV-1001",
    vendor_label: "Phat Panda",
    transfer_date: "2026-09-02",
    accepted_at: "2026-09-02T17:00:00Z",
    accepted_lot_count: 2,
    status: "accepted",
    raw_payload: { kind: "cultivera-reconstructed" },
  });
  db.rows("menu_versions").push({ id: OLD_V, status: "archived" }, { id: V, status: "published" });
  db.rows("menu_items").push(
    { id: "i-held", menu_version_id: V, source_item_id: "held", hidden: true, hidden_reason: "needs_category" },
    { id: "i-free", menu_version_id: V, source_item_id: "free", hidden: false, hidden_reason: null },
    // An OLD version held "free" too: only the published version counts.
    { id: "i-old", menu_version_id: OLD_V, source_item_id: "free", hidden: true, hidden_reason: "needs_category" },
  );
  db.rows("menu_variants").push(
    { id: "v1", menu_item_id: "i-held", price_minor_units: 1500 },
    { id: "v2", menu_item_id: "i-free", price_minor_units: 2500 },
  );
  db.rows("catalog_product_drafts").push(draft(D_HELD, "held"), draft(D_FREE, "free"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const row = (id: string) => st.db.rows("catalog_product_drafts").find((d) => d.id === id)!;

describe("A. approval of a card held for a category", () => {
  it("refuses a held card without a pick, even though the resolver has a (placeholder) category", async () => {
    const res = await approveDraftWithPrice(D_HELD, 0, ACTOR);
    expect(res).toEqual({ ok: false, error: core.CATEGORY_HOLD_REQUIRED_ERROR });
    expect(row(D_HELD).status).toBe("draft");
    expect(st.stageCalls).toEqual([]);
  });

  it("a blank pick or the unresolved 'create new' option is not a pick", async () => {
    expect((await approveDraftWithPrice(D_HELD, 0, ACTOR, { chosenWebsiteCategory: "  " })).error).toBe(core.CATEGORY_HOLD_REQUIRED_ERROR);
    expect((await approveDraftWithPrice(D_HELD, 0, ACTOR, { chosenWebsiteCategory: "__new__" })).error).toBe(core.CATEGORY_HOLD_REQUIRED_ERROR);
    expect(row(D_HELD).status).toBe("draft");
  });

  it("with a person's pick it is approved and the pick is recorded (live price kept)", async () => {
    const res = await approveDraftWithPrice(D_HELD, 0, ACTOR, { chosenWebsiteCategory: "edible-solid", chosenHouseType: "Gummies" });
    expect(res).toEqual({ ok: true });
    expect(row(D_HELD).status).toBe("approved");
    expect(row(D_HELD).chosen_website_category).toBe("edible-solid");
    expect(row(D_HELD).price_minor_units).toBe(1500);
    // R74 S17: the gate's own read marks the pick so the next rebuild may release the hold.
    expect((row(D_HELD).chosen_classification_provenance as Record<string, unknown>)?.categoryHold).toBe("human");
  });

  it("a pick outside our categories is still refused by the vocabulary check", async () => {
    const res = await approveDraftWithPrice(D_HELD, 0, ACTOR, { chosenWebsiteCategory: "not-a-shelf" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is not one of our website categories");
    expect(row(D_HELD).status).toBe("draft");
  });

  it("a card that is not held is approved as before, with no pick (an old version's hold does not count)", async () => {
    const res = await approveDraftWithPrice(D_FREE, 0, ACTOR, { chosenHouseType: "Flower" });
    expect(res).toEqual({ ok: true });
    expect(row(D_FREE).status).toBe("approved");
    expect(row(D_FREE).chosen_website_category ?? null).toBeNull();
    // R74 S17: a card that was not held never carries the release marker.
    expect((row(D_FREE).chosen_classification_provenance as Record<string, unknown> | null)?.categoryHold).toBeUndefined();
  });

  it("a remembered pick for the same product does not satisfy the hold", async () => {
    // An earlier approved draft of the SAME product identity with a human pick.
    st.db.rows("catalog_product_drafts").push(
      draft("00000000-0000-4000-8000-00000000d0aa", "held-old", {
        name: "Product held",
        status: "approved",
        chosen_website_category: "edible-solid",
        chosen_classification_provenance: { website_category: "human" },
        updated_at: "2026-09-01T00:00:00Z",
      }),
    );
    const res = await approveDraftWithPrice(D_HELD, 0, ACTOR);
    expect(res).toEqual({ ok: false, error: core.CATEGORY_HOLD_REQUIRED_ERROR });
  });

  it("an ordinary (not rebuilt) delivery never reads the hold", async () => {
    const MN = "00000000-0000-4000-8000-00000000aa02";
    st.db.rows("inbound_manifests").push({ id: MN, raw_payload: { kind: "wcia" } });
    st.db.rows("catalog_product_drafts").push(draft("00000000-0000-4000-8000-00000000d003", "held", { manifest_id: MN }));
    st.db.log.length = 0;
    const res = await approveDraftWithPrice("00000000-0000-4000-8000-00000000d003", 3000, ACTOR);
    expect(res).toEqual({ ok: false, error: "below the floor" });
    expect(st.db.log.some((r) => r.table === "menu_items")).toBe(false);
  });
});

describe("B. fail closed", () => {
  it("an unreadable live card refuses, even with a pick", async () => {
    st.db.before = (req) => (req.table === "menu_items" && req.url.href.includes("hidden_reason") ? DOWN : undefined);
    const res = await approveDraftWithPrice(D_FREE, 0, ACTOR, { chosenWebsiteCategory: "accessories" });
    expect(res).toEqual({ ok: false, error: core.CATEGORY_HOLD_UNREAD_ERROR });
    expect(row(D_FREE).status).toBe("draft");
  });

  it("an unreadable published version refuses (never read as 'no hold')", async () => {
    st.db.before = (req) => (req.table === "menu_versions" ? DOWN : undefined);
    const res = await approveDraftWithPrice(D_FREE, 0, ACTOR);
    expect(res).toEqual({ ok: false, error: core.CATEGORY_HOLD_UNREAD_ERROR });
    expect(row(D_FREE).status).toBe("draft");
  });

  it("no published menu: nothing is live, so nothing is held", async () => {
    st.db.rows("menu_versions").forEach((v) => (v.status = "archived"));
    expect(await loadPublishedCategoryHoldKeys(createSupabaseAdminClient(), ["held"])).toEqual({ ok: true, held: new Set() });
  });

  it("'Approve all priced' approves the free card and skips the held one, saying why", async () => {
    // The batch carries no picks. An owner type that is the ONLY type on the
    // paraphernalia shelf types the free card (R32 one-type rule), so only
    // the category hold can refuse the held card.
    st.db.rows("inventory_types").push({ id: "t1", key: "pipe", label: "Pipe", website_category: "paraphernalia", is_active: true });
    const res = await approveAllPricedForManifest(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(res.result).toEqual(expect.objectContaining({ approved: 1, skipped: 1, why: core.CATEGORY_HOLD_REQUIRED_ERROR }));
    expect(row(D_HELD).status).toBe("draft");
    expect(row(D_FREE).status).toBe("approved");
  });

  it("page reader: held keys; a failed read is null (could not tell), never an empty set", async () => {
    expect([...((await loadHeldKeysForPage(["held", "free", null])) ?? [])]).toEqual(["held"]);
    expect(await loadHeldKeysForPage([null])).toEqual(new Set());
    st.db.before = (req) => (req.table === "menu_items" ? DOWN : undefined);
    expect(await loadHeldKeysForPage(["held"])).toBeNull();
  });

  it("all-holds reader: only the published version; errors are errors", async () => {
    const all = await loadAllPublishedCategoryHoldKeys(createSupabaseAdminClient());
    expect(all.ok && [...all.held]).toEqual(["held"]);
    st.db.before = (req) => (req.table === "menu_items" ? DOWN : undefined);
    expect((await loadAllPublishedCategoryHoldKeys(createSupabaseAdminClient())).ok).toBe(false);
  });
});

describe("C. the manifest cannot finish while a product is held", () => {
  it("free approved + held dismissed: not Done, and the section says what is left", async () => {
    row(D_FREE).status = "approved";
    row(D_HELD).status = "dismissed";
    const s = await loadCultiveraManifestSection(1);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.rows[0].state).toBe("in_review");
    expect(s.rows[0].stateLabel).toContain("1 product needs a category before this manifest can finish");
  });

  it("once the held product is approved with a pick, the manifest is Done", async () => {
    expect((await approveDraftWithPrice(D_HELD, 0, ACTOR, { chosenWebsiteCategory: "edible-solid", chosenHouseType: "Gummies" })).ok).toBe(true);
    expect((await approveDraftWithPrice(D_FREE, 0, ACTOR, { chosenHouseType: "Flower" })).ok).toBe(true);
    const s = await loadCultiveraManifestSection(1);
    expect(s.ok && s.rows[0].state).toBe("done");
  });

  it("an unreadable hold read never shows Done", async () => {
    row(D_FREE).status = "approved";
    row(D_HELD).status = "approved";
    st.db.before = (req) => (req.table === "menu_items" ? DOWN : undefined);
    const s = await loadCultiveraManifestSection(1);
    expect(s.ok && s.rows[0].state).toBe("in_review");
    expect(s.ok && s.rows[0].stateLabel).toContain("Not finished: category holds could not be read");
  });
});

describe("D. wiring", () => {
  it("the page forces the picker on held rows and explains why", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("loadHeldKeysForPage(");
    expect(page).toContain("|| heldForCategoryPick;");
    expect(page).toContain('data-testid="cultivera-category-hold"');
    expect(page).toContain("{CATEGORY_HOLD_ROW_NOTE}");
    expect(page).toContain('data-testid="cultivera-category-hold-unread"');
    // The SAME flag drives the required select and the row chip.
    expect(page).toContain("required={needsCategoryPick}");
    expect(page).toMatch(/rowAttention\(\{\s*needsCategoryPick,/);
  });

  it("the server gate sits inside the rebuilt-manifest branch of approveDraftWithPrice", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    const fn = src.slice(src.indexOf("export async function approveDraftWithPrice"), src.indexOf("export async function approveAllPricedForManifest"));
    const gate = fn.indexOf("categoryGate(holdRead");
    expect(gate).toBeGreaterThan(fn.indexOf("if (reonboarding) {"));
    expect(gate).toBeLessThan(fn.indexOf("resolveWebsiteCategoryForLot("));
    expect(fn).toContain("loadPublishedCategoryHoldKeys(admin, [key])");
  });

  it("Receiving's table reads the holds too (never Complete while one is held)", () => {
    const store = read("src/lib/inventory/receiving-cultivera-store.ts");
    expect(store).toContain("loadAllPublishedCategoryHoldKeys(admin)");
    expect(store).toContain("tallyCategoryHolds(drafts, read.held)");
  });

  it("self-tests are registered and pinned", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("cultivera-category-gate-core", __runCultiveraCategoryGateCoreTests(), 22)');
    expect(runner).toContain('assertRan("cultivera-onboarding-core", __runCultiveraOnboardingCoreTests(), 61)');
    expect(core.__runCultiveraCategoryGateCoreTests()).toEqual({ passed: 22, failed: 0 });
  });
});
