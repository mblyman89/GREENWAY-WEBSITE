/**
 * tests/compliance/r50-s3-cultivera-onboarding.test.ts   (R50 S3)
 *
 * Owner: "as I work through each Cultivera manifest, it should save
 * everything to the kb as we do for intaking and onboarding products ... so
 * everything is cataloged and reusable."
 *
 * Behavioural, through the REAL postgrest-js client against FakePostgrest:
 *   A. seedDraftsForManifest({reonboard}) - one draft per live card key, the
 *      live price (agreeing sizes only), no floor; skips open/approved/same
 *      card/keyless; the ordinary mode is unchanged (every key "matches").
 *   B. staging guard - a rebuilt manifest never builds a menu version; an
 *      unreadable kind builds nothing (fail closed); an ordinary manifest
 *      goes on to read its approved drafts.
 *   C. startCultiveraManifestOnboarding - refuses a non-rebuilt manifest;
 *      runs the native chain in order; attaches the Cultivera potency as a
 *      source "cultivera" fact with provenance; never writes a lot's status,
 *      qty, cost or CCRS fields; re-running seeds nothing new.
 *   D. approveDraftWithPrice - a rebuilt-manifest draft records the LIVE
 *      price (never the form's), skips the floor, never stages; an unreadable
 *      kind refuses; an ordinary draft still needs a positive price.
 *   E. section loader + wiring.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Record<string, unknown>[],
  calls: [] as string[],
  stageCalls: [] as string[],
  published: { id: "00000000-0000-4000-8000-0000000000f1" } as { id: string } | null,
  /** When set, `from(table)` on the admin client throws synchronously for this table. */
  throwOnTable: null as string | null,
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
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
      const from = client.from.bind(client);
      client.from = ((table: string) => {
        if (st.throwOnTable === table) throw new Error("socket hang up");
        return from(table);
      }) as typeof client.from;
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => st.published,
  getItemBySourceKey: async () => null,
  archiveSupersededStaged: async () => 0,
}));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) =>
    lots.map(() => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false })),
  resolveWebsiteCategoryForLot: async () => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false }),
  resolveWebsiteCategoriesWithLiveKeys: async () => [],
}));
vi.mock("@/lib/inventory/pricing", async (orig) => ({
  ...((await orig()) as object),
  getPricingSettings: async () => ({ min_markup_multiple: 2 }),
  getVelocityForProduct: async () => null,
  suggestPrice: () => ({ floorMinor: 1000, suggestedMinor: 2000, rationale: "computed" }),
  // The floor ALWAYS refuses here: a re-onboarding approval that succeeds
  // proves the floor was skipped, not passed.
  validatePrice: () => ({ ok: false, floorMinor: 999_999, error: "below the floor" }),
}));
// The heavy chores: spies that record the ORDER the native chain runs in.
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => void st.calls.push("archive") }));
vi.mock("@/lib/inventory/coa-extract", () => ({
  extractCoasForManifest: async () => {
    st.calls.push("extract");
    return { read: 0, ok: 0, partial: 0, failed: 0, deferred: 0, kbFilled: 0, errors: [] };
  },
}));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({
  promoteManifestToKb: async () => {
    st.calls.push("promote");
    return { ok: true, outcome: { promoted: 2, skipped: 0, strainsEnriched: 0, vendorLicenseFilled: false } };
  },
}));
vi.mock("@/lib/inventory/kb-link-store", () => ({
  linkKbProductsToDrafts: async (_m: string, ids: unknown[]) => {
    st.calls.push(`link:${ids.length}`);
    return { status: "linked", note: "", products: 2, linkedProducts: 2, linkedLots: 3, failedWrites: 0 };
  },
}));
vi.mock("@/lib/catalog/lab-facts-attach", () => ({
  attachLabFactsToManifestDrafts: async () => {
    st.calls.push("labfacts");
    return { drafts: 2, attached: 0, facts: 0, noPanel: 0, kept: 0, strainsUpdated: 0, strainTerpenesAdded: 0, unmigrated: false, errors: [] };
  },
}));
vi.mock("@/lib/pos/intake-menu-staging", async (orig) => {
  const real = (await orig()) as typeof import("@/lib/pos/intake-menu-staging");
  return {
    ...real,
    stageIntakeMenuVersionForManifest: async (id: string, ...rest: unknown[]) => {
      st.stageCalls.push(id);
      return (real.stageIntakeMenuVersionForManifest as (...a: unknown[]) => unknown)(id, ...rest);
    },
  };
});

const { seedDraftsForManifest, approveDraftWithPrice } = await import("@/lib/inventory/catalog-drafts");
const { startCultiveraManifestOnboarding, loadCultiveraManifestSection, loadRebuiltManifestIds } = await import(
  "@/lib/inventory/cultivera-onboarding"
);
const realStaging = await vi.importActual<typeof import("@/lib/pos/intake-menu-staging")>("@/lib/pos/intake-menu-staging");
const core = await import("@/lib/inventory/cultivera-onboarding-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const M = "00000000-0000-4000-8000-00000000aa01"; // rebuilt
const MN = "00000000-0000-4000-8000-00000000aa02"; // ordinary delivery
const V = "00000000-0000-4000-8000-0000000000f1";
const BRAND = "00000000-0000-4000-8000-0000000000b1";
const lotId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function lot(n: number, key: string | null, extra: Row = {}): Row {
  return {
    id: lotId(n),
    manifest_id: M,
    // inventory_lots.is_sample is NOT NULL DEFAULT false (migration 0024);
    // Fix Phase 0.2 (G-51) filters on it, so the fake row carries it too.
    is_sample: false,
    pos_product_key: key,
    product_name: `Blue Dream 3.5g #${n}`,
    strain_name: "Blue Dream",
    strain_type: null,
    category: "Flower",
    inventory_type: "Usable Marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    unit_cost_minor_units: 800,
    lab_result_id: null,
    vendor_id: null,
    brand_id: BRAND,
    lot_code: `LC${n}`,
    status: "active",
    disposition: "accepted",
    qty_on_hand: 10,
    ccrs_inventory_id: `CCRS-${n}`,
    pos_thc: 23.456,
    pos_cbd: 0.2,
    pos_potency_unit: "%",
    ...extra,
  };
}

function seedWorld(): void {
  const db = st.db;
  db.rows("inbound_manifests").push(
    {
      id: M,
      manifest_number: "CV-1001",
      vendor_label: "Phat Panda",
      transfer_date: "2026-09-02",
      accepted_at: "2026-09-02T17:00:00Z",
      accepted_lot_count: 6,
      status: "accepted",
      raw_payload: { kind: "cultivera-reconstructed" },
    },
    {
      id: MN,
      manifest_number: "WCIA-77",
      vendor_label: "Real Vendor",
      transfer_date: "2026-10-01",
      accepted_at: "2026-10-01T17:00:00Z",
      accepted_lot_count: 1,
      status: "accepted",
      raw_payload: { kind: "wcia" },
    },
  );
  db.rows("inventory_lots").push(
    lot(1, "pos-a"),
    lot(2, "pos-a"), // same card, second batch
    lot(3, "pos-b"),
    lot(4, "pos-c"), // already onboarded
    lot(5, "pos-d"), // open draft elsewhere
    lot(6, null), // keyless
  );
  db.rows("brands").push({ id: BRAND, display_name: "Phat Panda", name: "Phat Panda" });
  db.rows("menu_versions").push({ id: V, status: "published" });
  db.rows("menu_items").push(
    { id: "i-a", menu_version_id: V, source_item_id: "pos-a" },
    { id: "i-b", menu_version_id: V, source_item_id: "pos-b" },
    { id: "i-c", menu_version_id: V, source_item_id: "pos-c" },
    { id: "i-d", menu_version_id: V, source_item_id: "pos-d" },
  );
  db.rows("menu_variants").push(
    { id: "v1", menu_item_id: "i-a", price_minor_units: 2500 },
    { id: "v2", menu_item_id: "i-a", price_minor_units: 2500 },
    { id: "v3", menu_item_id: "i-b", price_minor_units: 1000 },
    { id: "v4", menu_item_id: "i-b", price_minor_units: 1800 },
  );
  db.rows("catalog_product_drafts").push(
    { id: "00000000-0000-4000-8000-00000000dd0c", pos_product_key: "pos-c", status: "approved", manifest_id: null, name: "old" },
    { id: "00000000-0000-4000-8000-00000000dd0d", pos_product_key: "pos-d", status: "draft", manifest_id: null, name: "open" },
  );
}

const lotSnapshot = () =>
  st.db.rows("inventory_lots").map((l) => ({
    id: l.id,
    status: l.status,
    qty_on_hand: l.qty_on_hand,
    unit_cost_minor_units: l.unit_cost_minor_units,
    ccrs_inventory_id: l.ccrs_inventory_id,
    disposition: l.disposition,
    pos_product_key: l.pos_product_key,
  }));
const menuSnapshot = () => JSON.stringify([st.db.rows("menu_versions"), st.db.rows("menu_items"), st.db.rows("menu_variants")]);
const newDrafts = () => st.db.rows("catalog_product_drafts").filter((d) => d.manifest_id === M);

beforeEach(() => {
  st.db = new FakePostgrest();
  st.throwOnTable = null;
  st.audits = [];
  st.calls = [];
  st.stageCalls = [];
  st.published = { id: V };
  delete process.env.INTAKE_IDENTITY_STAMP;
  delete process.env.CULTIVERA_CARD_REFRESH;
  seedWorld();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("A. re-onboarding seed", () => {
  it("one draft per live card key, live price only when every size agrees, no floor", async () => {
    const res = await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    expect(res.draftsCreated).toBe(2);
    expect(res.draftsFailed).toBe(0);
    expect(res.reonboard).toEqual({ skippedOpen: 1, skippedOnboarded: 1, sameCard: 1, noKey: 1, seededOnMenu: 2 });
    const byKey = new Map(newDrafts().map((d) => [d.pos_product_key, d] as const));
    expect([...byKey.keys()].sort()).toEqual(["pos-a", "pos-b"]);
    const a = byKey.get("pos-a")!;
    expect(a.suggested_price_minor_units).toBe(2500);
    expect(a.price_floor_minor_units).toBeNull();
    expect(a.price_rationale).toBe(core.LIVE_PRICE_RATIONALE);
    expect(a.lot_id).toBe(lotId(1)); // the FIRST lot of the card
    expect(a.status).toBe("draft");
    const b = byKey.get("pos-b")!;
    expect(b.suggested_price_minor_units).toBeNull();
    expect(b.price_rationale).toBe(core.NO_LIVE_PRICE_RATIONALE);
    // identity for the KB link: every non-destroyed lot, as in a finalize
    expect(res.lotIdentities?.length).toBe(6);
  });

  it("ordinary mode is unchanged: every keyed lot 'matches' the menu (only the keyless lot seeds, as before)", async () => {
    const res = await seedDraftsForManifest(M, ACTOR);
    expect(res.draftsCreated).toBe(1);
    expect(newDrafts().map((d) => d.pos_product_key)).toEqual([null]);
    expect(res.reonboard).toBeUndefined();
    expect(res.matched).toBe(5);
    // the live-price read is re-onboarding only
    expect(st.db.log.some((r) => r.table === "menu_variants")).toBe(false);
  });

  it("a failed live-price read seeds nothing and says why (never a guessed price)", async () => {
    st.db.before = (req) =>
      req.table === "menu_variants" ? { status: 500, body: { code: "XX000", message: "variants down", details: null, hint: null } } : undefined;
    const res = await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    expect(res.draftsCreated).toBe(0);
    expect(res.firstError).toContain("variants down");
    expect(newDrafts()).toHaveLength(0);
  });

  it("a failed approved-drafts read seeds nothing (would otherwise re-seed onboarded cards)", async () => {
    st.db.before = (req) =>
      req.table === "catalog_product_drafts" && req.method === "GET" && req.url.searchParams.get("status") === "eq.approved"
        ? { status: 500, body: { code: "XX000", message: "drafts down", details: null, hint: null } }
        : undefined;
    const res = await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    expect(res.draftsCreated).toBe(0);
    expect(res.firstError).toContain("drafts down");
  });

  it("no published menu: drafts still seeded, with no price", async () => {
    st.published = null;
    const res = await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    expect(res.draftsCreated).toBe(2);
    expect(newDrafts().every((d) => d.suggested_price_minor_units === null)).toBe(true);
  });
});

describe("B. staging guard", () => {
  // R50 S3c (pin updated on purpose, owner follow-up #4): a rebuilt manifest
  // now stages in REFRESH mode by default (tests/compliance/r50-s3c-*.test.ts).
  // The S3 rule is still what CULTIVERA_CARD_REFRESH=off gives, pinned here.
  it("switch off: a rebuilt manifest never builds a menu version (no draft read, no write)", async () => {
    process.env.CULTIVERA_CARD_REFRESH = "off";
    const before = menuSnapshot();
    const out = await realStaging.stageIntakeMenuVersionForManifest(M, ACTOR);
    expect(out.staged).toBe(false);
    expect(out.reason).toBe(core.MIGRATION_STAGING_SKIP);
    expect(st.db.log.some((r) => r.table === "catalog_product_drafts")).toBe(false);
    expect(menuSnapshot()).toBe(before);
  });

  it("the POS-import migration manifest is skipped too", async () => {
    st.db.rows("inbound_manifests")[1].raw_payload = { kind: "pos-import-migration" };
    const out = await realStaging.stageIntakeMenuVersionForManifest(MN, ACTOR);
    expect(out.reason).toBe(core.MIGRATION_STAGING_SKIP);
  });

  it("an unreadable kind builds nothing (fail closed)", async () => {
    st.db.before = (req) =>
      req.table === "inbound_manifests" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const out = await realStaging.stageIntakeMenuVersionForManifest(MN, ACTOR);
    expect(out.reason).toBe("manifest-kind-read-failed");
    expect(st.db.log.some((r) => r.table === "catalog_product_drafts")).toBe(false);
  });

  it("a kind read that THROWS builds nothing either (fail closed)", async () => {
    st.throwOnTable = "inbound_manifests";
    const out = await realStaging.stageIntakeMenuVersionForManifest(MN, ACTOR);
    st.throwOnTable = null;
    expect(out.reason).toBe("manifest-kind-read-failed");
    expect(st.db.log.some((r) => r.table === "catalog_product_drafts")).toBe(false);
  });

  it("switch on (default): a rebuilt manifest goes on to read its approved drafts (refresh mode)", async () => {
    const out = await realStaging.stageIntakeMenuVersionForManifest(M, ACTOR);
    expect(out.reason).toBe("no-approved-drafts");
    expect(st.db.log.some((r) => r.table === "catalog_product_drafts" && r.url.searchParams.get("manifest_id") === `eq.${M}`)).toBe(true);
  });

  it("an ordinary delivery goes on to read its approved drafts", async () => {
    const out = await realStaging.stageIntakeMenuVersionForManifest(MN, ACTOR);
    expect(out.reason).toBe("no-approved-drafts");
    expect(st.db.log.some((r) => r.table === "catalog_product_drafts" && r.url.searchParams.get("manifest_id") === `eq.${MN}`)).toBe(true);
  });
});

describe("C. start a Cultivera manifest", () => {
  it("refuses a manifest that was not rebuilt from the export (and a missing one)", async () => {
    const r1 = await startCultiveraManifestOnboarding(MN, ACTOR);
    expect(r1.ok).toBe(false);
    const r2 = await startCultiveraManifestOnboarding("00000000-0000-4000-8000-00000000ffff", ACTOR);
    expect(r2.ok).toBe(false);
    expect(st.calls).toEqual([]);
    expect(st.db.rows("catalog_product_drafts")).toHaveLength(2);
  });

  it("refuses when the manifest cannot be read (never guesses the rules)", async () => {
    st.db.before = (req) =>
      req.table === "inbound_manifests" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(false);
    expect(st.calls).toEqual([]);
  });

  it("runs the native chain, attaches the Cultivera potency, never touches stock or the menu", async () => {
    const lotsBefore = lotSnapshot();
    const menuBefore = menuSnapshot();
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.seeded).toBe(2);
    // fan-out first (any order inside), then link, then lab facts
    expect(new Set(st.calls.slice(0, 3))).toEqual(new Set(["archive", "promote", "extract"]));
    expect(st.calls.indexOf("archive")).toBeLessThan(st.calls.indexOf("extract"));
    expect(st.calls.indexOf("link:6")).toBeGreaterThan(st.calls.indexOf("promote"));
    expect(st.calls.indexOf("labfacts")).toBeGreaterThan(st.calls.indexOf("link:6"));
    // Cultivera potency: shown-not-counted source, on both new drafts
    for (const d of newDrafts()) {
      const f = (d.attached_facts as Record<string, { value: string; source: string }>).potency;
      expect(f).toEqual(expect.objectContaining({ value: "23.46% THC", source: "cultivera" }));
      expect((d.attached_facts_provenance as Record<string, { source: string }>).potency.source).toBe("cultivera");
    }
    const prov = st.db.rows("product_fact_provenance");
    expect(prov).toHaveLength(2);
    expect(prov.every((p) => p.source === "cultivera" && p.field === "potency")).toBe(true);
    // timeline + audit
    const ev = st.db.rows("manifest_events").find((e) => e.event_type === core.CULTIVERA_ONBOARDING_EVENT);
    expect(ev?.note).toContain("2 products added to Onboarding");
    expect(ev?.note).toContain("The live menu was not changed.");
    const audit = st.audits.find((a) => a.action === core.CULTIVERA_ONBOARDING_AUDIT);
    expect((audit?.after as Record<string, unknown>).live_menu_changed).toBe(false);
    // sellable stays sellable
    expect(lotSnapshot()).toEqual(lotsBefore);
    expect(menuSnapshot()).toBe(menuBefore);
    expect(st.db.log.some((r) => r.table === "inventory_lots" && r.method !== "GET")).toBe(false);
    expect(st.db.log.some((r) => r.table.startsWith("menu_") && r.method !== "GET")).toBe(false);
  });

  it("re-running seeds nothing new and does not re-write an unchanged fact", async () => {
    await startCultiveraManifestOnboarding(M, ACTOR);
    const provBefore = st.db.rows("product_fact_provenance").length;
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok && r.seeded).toBe(0);
    expect(newDrafts()).toHaveLength(2);
    expect(st.db.rows("product_fact_provenance").length).toBe(provBefore);
  });

  it("a person's potency is never replaced by the Cultivera figure", async () => {
    await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    const d = newDrafts().find((x) => x.pos_product_key === "pos-a")!;
    d.attached_facts = { potency: { value: "25% THC", source: "human", confidence: null, at: "2026-10-01T00:00:00Z" } };
    d.attached_facts_provenance = { potency: { source: "human", confidence: null, at: "2026-10-01T00:00:00Z", by: ACTOR, urls: [] } };
    await startCultiveraManifestOnboarding(M, ACTOR);
    expect((d.attached_facts as Record<string, { value: string }>).potency.value).toBe("25% THC");
  });
});

describe("D. approval of an already-selling card", () => {
  async function seededDraft(key: string) {
    await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    return newDrafts().find((d) => d.pos_product_key === key)!;
  }

  it("switch off: records the LIVE price (not the form's), skips the floor, never stages", async () => {
    process.env.CULTIVERA_CARD_REFRESH = "off";
    const d = await seededDraft("pos-a");
    // a live price change since seeding: the approval re-reads it
    st.db.rows("menu_variants").forEach((v) => {
      if (v.menu_item_id === "i-a") v.price_minor_units = 2700;
    });
    const menuBefore = menuSnapshot();
    const res = await approveDraftWithPrice(d.id as string, 1, ACTOR);
    expect(res).toEqual({ ok: true });
    expect(d.status).toBe("approved");
    expect(d.price_minor_units).toBe(2700);
    expect(st.stageCalls).toEqual([]);
    expect(menuSnapshot()).toBe(menuBefore);
  });

  it("switch off: a card whose sizes differ is approved with no price recorded", async () => {
    process.env.CULTIVERA_CARD_REFRESH = "off";
    const d = await seededDraft("pos-b");
    const res = await approveDraftWithPrice(d.id as string, 0, ACTOR);
    expect(res.ok).toBe(true);
    expect(d.price_minor_units).toBeNull();
    expect(st.stageCalls).toEqual([]);
  });

  it("switch on (default): the LIVE price is still recorded, the floor skipped, and the card refresh is staged", async () => {
    const d = await seededDraft("pos-a");
    st.db.rows("menu_variants").forEach((v) => {
      if (v.menu_item_id === "i-a") v.price_minor_units = 2700;
    });
    const res = await approveDraftWithPrice(d.id as string, 1, ACTOR);
    expect(res).toEqual({ ok: true });
    expect(d.price_minor_units).toBe(2700);
    expect(st.stageCalls).toEqual([M]);
  });

  it("switch on: a sizes-differ card is approved with no price and still staged", async () => {
    const d = await seededDraft("pos-b");
    const res = await approveDraftWithPrice(d.id as string, 0, ACTOR);
    expect(res.ok).toBe(true);
    expect(d.price_minor_units).toBeNull();
    expect(st.stageCalls).toEqual([M]);
  });

  it("an unreadable delivery kind refuses the approval (fail closed)", async () => {
    const d = await seededDraft("pos-a");
    st.db.before = (req) =>
      req.table === "inbound_manifests" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const res = await approveDraftWithPrice(d.id as string, 2500, ACTOR);
    expect(res.ok).toBe(false);
    // refused for THIS reason (not by the ordinary floor it would fall through to)
    expect(res.error).toContain("Could not read this product's delivery");
    expect(d.status).toBe("draft");
  });

  it("an unreadable live price refuses the approval", async () => {
    const d = await seededDraft("pos-a");
    st.db.before = (req) =>
      req.table === "menu_variants" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const res = await approveDraftWithPrice(d.id as string, 2500, ACTOR);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Could not read the live menu price");
    expect(d.status).toBe("draft");
  });

  it("an ordinary draft still needs a positive price and still meets the floor", async () => {
    st.db.rows("catalog_product_drafts").push({
      id: "00000000-0000-4000-8000-00000000dd99",
      manifest_id: MN,
      pos_product_key: "real-1",
      name: "Real 1g",
      status: "draft",
      unit_cost_minor_units: 500,
      category: "Flower",
    });
    const zero = await approveDraftWithPrice("00000000-0000-4000-8000-00000000dd99", 0, ACTOR);
    expect(zero.ok).toBe(false);
    expect(zero.error).toContain("greater than $0");
    const low = await approveDraftWithPrice("00000000-0000-4000-8000-00000000dd99", 600, ACTOR);
    expect(low).toEqual({ ok: false, error: "below the floor" });
  });
});

describe("E. section loader + wiring", () => {
  it("lists rebuilt manifests only, with their onboarding progress", async () => {
    await seedDraftsForManifest(M, ACTOR, { reonboard: true });
    const s = await loadCultiveraManifestSection(1);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.rows.map((r) => r.id)).toEqual([M]);
    expect(s.rows[0]).toEqual(expect.objectContaining({ number: "CV-1001", state: "in_review", inReview: 2 }));
  });

  it("a failed draft tally shows Unknown, never Not started", async () => {
    st.db.before = (req) =>
      req.table === "catalog_product_drafts" ? { status: 500, body: { code: "XX000", message: "down", details: null, hint: null } } : undefined;
    const s = await loadCultiveraManifestSection(1);
    expect(s.ok && s.rows[0].stateLabel).toContain("Unknown");
  });

  it("loadRebuiltManifestIds: only rebuilt ids; a read failure is null (not 'none')", async () => {
    expect([...((await loadRebuiltManifestIds([M, MN, null])) ?? [])]).toEqual([M]);
    st.db.before = () => ({ status: 500, body: { code: "XX000", message: "down", details: null, hint: null } });
    expect(await loadRebuiltManifestIds([M])).toBeNull();
  });

  it("wiring: the action requires inventory.manage and revalidates the real page; the approve form passes reonboard", () => {
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    const body = actions.slice(actions.indexOf("export async function startCultiveraOnboardingAction"));
    expect(body).toContain('requirePermission("inventory.manage")');
    expect(body).toContain('revalidatePath("/admin/inventory/drafts")');
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain('<input type="hidden" name="reonboard" value="1" />');
    expect(page).toContain('data-testid="cultivera-manifests"');
    // S3c: the row copy follows the refresh switch (approval now rebuilds the card).
    expect(page).toContain("cultiveraApproveCopy(");
    expect(page).toContain("process.env[CARD_REFRESH_ENV]");
    expect(page).not.toContain("approving keeps it and does not change the menu.");
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("cultivera-onboarding-core"');
  });
});
