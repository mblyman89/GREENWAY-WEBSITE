/**
 * tests/compliance/r33-lot-propagation.test.ts  (R33, T-329)
 *
 * Owner-reported: "I can edit the strain type, and save it. But it does not
 * stick. Nor does it update the customer facing website."
 *
 *   1. propagateLotCorrections (REAL store, REAL postgrest-js, in-memory
 *      FakePostgrest): the lot is stamped reviewer, the PUBLISHED card and
 *      the intake-STAGED card both change, an import-staged / archived card
 *      never does, the mastered card (via "<key>-onboarded") changes, the
 *      approved draft remembers, a disagreeing sibling lot blocks its card,
 *      vendor/brand/strain-name edits reach the card + draft, a failed read
 *      writes NOTHING, an unknown lot / no key is reported plainly.
 *   2. updateLotDetailsAction: runs the propagation only for a real change,
 *      writes both audits, refreshes the public surfaces only when a website
 *      card changed, and returns the plain banner in ?lot_msg=.
 *   3. pushLotStrainTypeAction ("Send to website"): refuses a lot with no
 *      type; re-pushes the lot's type; audit trigger send_to_website.
 *   4. loadLotWebsiteStrainCards: what the drift notice reads; [] on failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  calls: [] as string[],
  audits: [] as Array<{ action: string; entityId: string; before: unknown; after: unknown }>,
  vendors: new Map<string, { id: string; display_name: string }>(),
  brands: new Map<string, { id: string; display_name: string; vendor_id: string | null }>(),
  updateFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`),
  revalidateTag: (t: string) => st.calls.push(`tag:${t}`),
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; before: unknown; after: unknown }) => {
    st.audits.push({ action: a.action, entityId: a.entityId, before: a.before, after: a.after });
  },
}));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => st.calls.push("public-surfaces") }));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/vendors/store", () => ({
  getVendorById: async (id: string) => st.vendors.get(id) ?? null,
  getBrandById: async (id: string) => st.brands.get(id) ?? null,
}));
vi.mock("@/lib/inventory/store", async (orig) => {
  const real = (await orig()) as object;
  return {
    ...real,
    // The lot read, hydrated with vendor/brand names the way the page shows them.
    getLotById: async (id: string) => {
      const row = st.db.rows("inventory_lots").find((r) => r.id === id);
      if (!row) return null;
      return {
        ...row,
        vendor_name: row.vendor_id ? st.vendors.get(String(row.vendor_id))?.display_name ?? null : null,
        brand_name: row.brand_id ? st.brands.get(String(row.brand_id))?.display_name ?? null : null,
      };
    },
    updateLotDetails: async (id: string, patch: Record<string, unknown>) => {
      if (st.updateFails) return { ok: false };
      const row = st.db.rows("inventory_lots").find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return { ok: true };
    },
  };
});

import { propagateLotCorrections, loadLotWebsiteStrainCards } from "@/lib/inventory/lot-propagation-store";
import { updateLotDetailsAction, pushLotStrainTypeAction } from "@/app/admin/inventory/actions";
import { LOT_STRAIN_PROPAGATED_AUDIT } from "@/lib/inventory/lot-strain-propagation-core";
import { LOT_DETAILS_PROPAGATED_AUDIT } from "@/lib/inventory/lot-details-propagation-core";
import { boilerplateDescription } from "@/lib/catalog/golden-record-core";

const LOT = "11111111-1111-4111-8111-111111111111";
const SIB = "22222222-2222-4222-8222-222222222222";
const V_OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V_NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B_OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B_NEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEY = "LOT-BD-35";
const PUB = "v-pub";
const STAGED = "v-staged";
const IMPORT_STAGED = "v-import";
const ARCHIVED = "v-old";

function card(id: string, version: string, over: Record<string, unknown> = {}) {
  return {
    id,
    menu_version_id: version,
    source_item_id: KEY,
    name: "Blue Dream 3.5g",
    product_name: "Blue Dream 3.5g",
    brand_name: "Old Brand",
    vendor_name: "Old Farms",
    strain_name: "Blue Dream",
    strain_type: "hybrid",
    description: boilerplateDescription("Blue Dream 3.5g", "Old Brand"),
    fact_provenance: { thc_pct: "coa" },
    ...over,
  };
}

function seed() {
  st.db = new FakePostgrest();
  st.vendors = new Map([
    [V_OLD, { id: V_OLD, display_name: "Old Farms" }],
    [V_NEW, { id: V_NEW, display_name: "New Farms" }],
  ]);
  st.brands = new Map([
    [B_OLD, { id: B_OLD, display_name: "Old Brand", vendor_id: V_OLD }],
    [B_NEW, { id: B_NEW, display_name: "New Brand", vendor_id: V_NEW }],
  ]);
  st.db.rows("inventory_lots").push({
    id: LOT,
    pos_product_key: KEY,
    strain_type: "hybrid",
    strain_name: "Blue Dream",
    vendor_id: V_OLD,
    brand_id: B_OLD,
    fact_provenance: { package_thc_mg: "coa" },
  });
  st.db.rows("menu_versions").push(
    { id: PUB, status: "published", import_id: "imp-1" },
    { id: STAGED, status: "staged", import_id: null },
    { id: IMPORT_STAGED, status: "staged", import_id: "imp-2" },
    { id: ARCHIVED, status: "archived", import_id: null },
  );
  st.db.rows("menu_items").push(
    card("c-pub", PUB),
    card("c-staged", STAGED),
    card("c-import", IMPORT_STAGED),
    card("c-archived", ARCHIVED),
  );
  st.db.rows("menu_variants").push(
    { id: "mv1", menu_item_id: "c-pub", source_variant_id: `${KEY}-3.5g` },
    { id: "mv2", menu_item_id: "c-staged", source_variant_id: `${KEY}-3.5g` },
  );
  st.db.rows("catalog_product_drafts").push(
    {
      id: "d1",
      lot_id: LOT,
      status: "approved",
      chosen_strain_type: "hybrid",
      chosen_classification_provenance: { houseType: "remembered" },
      brand_name: "Old Brand",
      vendor_name: "Old Farms",
      strain_name: "Blue Dream",
    },
    { id: "d-pending", lot_id: LOT, status: "pending", chosen_strain_type: "hybrid", chosen_classification_provenance: {}, brand_name: null, vendor_name: null, strain_name: null },
  );
}

const cardRow = (id: string) => st.db.rows("menu_items").find((r) => r.id === id)!;
const lotRow = () => st.db.rows("inventory_lots").find((r) => r.id === LOT)!;
const draftRow = (id: string) => st.db.rows("catalog_product_drafts").find((r) => r.id === id)!;
const noNames = {};
const target = { strainName: "Blue Dream", vendorId: V_OLD, brandId: B_OLD };

beforeEach(() => {
  seed();
  st.calls.length = 0;
  st.audits.length = 0;
  st.updateFails = false;
});

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT;")) return d.slice("NEXT_REDIRECT;".length);
    throw e;
  }
  throw new Error("expected a redirect");
}

// === 1. The store ============================================================
describe("R33 propagateLotCorrections (real store over FakePostgrest)", () => {
  it("strain type reaches the lot (reviewer), the published + intake-staged cards and the approved draft", async () => {
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(out.strain?.errors).toEqual([]);
    expect(out.strain?.cardsUpdated).toEqual({ published: 1, staged: 1 });
    expect(out.websiteChanged).toBe(true);
    expect(out.details).toBeNull();

    expect(lotRow().strain_type).toBe("indica");
    expect(lotRow().fact_provenance).toEqual({ package_thc_mg: "coa", strain_type: "reviewer" });
    for (const id of ["c-pub", "c-staged"]) {
      expect(cardRow(id).strain_type).toBe("indica");
      expect(cardRow(id).fact_provenance).toEqual({ thc_pct: "coa", strain_type: "reviewer" });
    }
    // Never an import-staged or archived version.
    expect(cardRow("c-import").strain_type).toBe("hybrid");
    expect(cardRow("c-archived").strain_type).toBe("hybrid");
    // Onboarding memory: approved only, human provenance, other keys kept.
    expect(draftRow("d1").chosen_strain_type).toBe("indica");
    expect(draftRow("d1").chosen_classification_provenance).toEqual({ houseType: "remembered", strainType: "human" });
    expect(draftRow("d-pending").chosen_strain_type).toBe("hybrid");
    expect(out.strain?.draftsUpdated).toBe(1);
  });

  it("is idempotent: a second identical push writes nothing and says the website already shows it", async () => {
    await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    const before = st.db.log.filter((r) => r.method === "PATCH").length;
    const again = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(st.db.log.filter((r) => r.method === "PATCH").length).toBe(before);
    expect(again.websiteChanged).toBe(false);
    expect(again.strain?.cardsAlready).toBe(2);
    expect(again.strain?.lotWritten).toBe(false);
  });

  it("reaches a MASTERED card through the lot's own '<key>-onboarded' variant", async () => {
    st.db.rows("menu_items").push(card("c-master", PUB, { source_item_id: "MASTER-KEY", name: "Blue Dream (all sizes)" }));
    st.db.rows("menu_variants").push({ id: "mv9", menu_item_id: "c-master", source_variant_id: `${KEY}-onboarded` });
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "sativa" }, names: noNames, target });
    expect(cardRow("c-master").strain_type).toBe("sativa");
    expect(out.strain?.cardsUpdated.published).toBe(2);
  });

  it("a sibling lot on the same mastered card that DISAGREES blocks that card (never overwrites another lot's answer)", async () => {
    st.db.rows("menu_items").push(card("c-master", PUB, { source_item_id: "MASTER-KEY", name: "Blue Dream (all sizes)" }));
    st.db.rows("menu_variants").push(
      { id: "mv9", menu_item_id: "c-master", source_variant_id: `${KEY}-onboarded` },
      { id: "mv10", menu_item_id: "c-master", source_variant_id: "SIB-KEY-onboarded" },
    );
    st.db.rows("inventory_lots").push({ id: SIB, pos_product_key: "SIB-KEY", strain_type: "hybrid", strain_name: null, vendor_id: null, brand_id: null });
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(cardRow("c-master").strain_type).toBe("hybrid");
    expect(out.strain?.cardsSkipped.map((s) => s.id)).toEqual(["c-master"]);
    // The lot's own cards still change.
    expect(cardRow("c-pub").strain_type).toBe("indica");
  });

  it("vendor / brand / strain-name edits reach the cards (placeholder copy rebuilt) and the draft", async () => {
    const out = await propagateLotCorrections({
      lotId: LOT,
      strainType: null,
      names: {
        vendor: { from: "Old Farms", to: "New Farms", toId: V_NEW },
        brand: { from: "Old Brand", to: "New Brand", toId: B_NEW },
        strainName: { from: "Blue Dream", to: "Blue Dream #3" },
      },
      target: { strainName: "Blue Dream #3", vendorId: V_NEW, brandId: B_NEW },
    });
    expect(out.strain).toBeNull();
    expect(out.details?.errors).toEqual([]);
    expect(out.details?.fields).toEqual(["vendor", "brand", "strain name"]);
    expect(out.details?.cardsUpdated).toEqual({ published: 1, staged: 1 });
    const c = cardRow("c-pub");
    expect([c.vendor_name, c.brand_name, c.strain_name]).toEqual(["New Farms", "New Brand", "Blue Dream #3"]);
    expect(c.description).toBe(boilerplateDescription("Blue Dream 3.5g", "New Brand"));
    expect(cardRow("c-import").brand_name).toBe("Old Brand");
    expect([draftRow("d1").vendor_name, draftRow("d1").brand_name, draftRow("d1").strain_name]).toEqual(["New Farms", "New Brand", "Blue Dream #3"]);
  });

  it("real written copy is never rewritten by a brand change", async () => {
    cardRow("c-pub").description = "Hand-trimmed, slow-cured Blue Dream. Our budtenders' pick.";
    await propagateLotCorrections({
      lotId: LOT,
      strainType: null,
      names: { brand: { from: "Old Brand", to: "New Brand", toId: B_NEW } },
      target: { strainName: "Blue Dream", vendorId: V_OLD, brandId: B_NEW },
    });
    expect(cardRow("c-pub").brand_name).toBe("New Brand");
    expect(cardRow("c-pub").description).toBe("Hand-trimmed, slow-cured Blue Dream. Our budtenders' pick.");
  });

  it("a failed card read writes NOTHING (never a write from a partial view)", async () => {
    st.db.before = (req) => (req.method === "GET" && req.table === "menu_variants" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(st.db.log.some((r) => r.method === "PATCH")).toBe(false);
    expect(out.websiteChanged).toBe(false);
    expect(out.strain?.errors.join(" ")).toMatch(/could not be read/);
  });

  it("a failed SIBLING-lot read writes NOTHING (cannot prove no other lot disagrees)", async () => {
    st.db.rows("menu_items").push(card("c-master", PUB, { source_item_id: "MASTER-KEY", name: "Blue Dream (all sizes)" }));
    st.db.rows("menu_variants").push(
      { id: "mv9", menu_item_id: "c-master", source_variant_id: `${KEY}-onboarded` },
      { id: "mv10", menu_item_id: "c-master", source_variant_id: "SIB-KEY-onboarded" },
    );
    st.db.before = (req) =>
      req.method === "GET" && req.table === "inventory_lots" && req.url.searchParams.has("pos_product_key")
        ? { status: 500, body: { code: "XX000", message: "sibling read down" } }
        : undefined;
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(st.db.log.some((r) => r.method === "PATCH")).toBe(false);
    expect(out.strain?.errors.join(" ")).toMatch(/other lots on this card could not be read/);
    expect(out.websiteChanged).toBe(false);
  });

  it("a failed card write is reported; the rest still lands", async () => {
    st.db.before = (req) =>
      req.method === "PATCH" && req.table === "menu_items" && req.url.searchParams.get("id") === "eq.c-staged"
        ? { status: 500, body: { code: "XX000", message: "nope" } }
        : undefined;
    const out = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(out.strain?.cardsUpdated).toEqual({ published: 1, staged: 0 });
    expect(out.strain?.errors.join(" ")).toMatch(/staged card was not updated/);
    expect(cardRow("c-pub").strain_type).toBe("indica");
  });

  it("an unknown lot and a lot with no POS key are reported plainly", async () => {
    const gone = await propagateLotCorrections({ lotId: "99999999-9999-4999-8999-999999999999", strainType: { value: "indica" }, names: noNames, target });
    expect(gone.strain?.errors).toEqual(["the lot no longer exists"]);
    lotRow().pos_product_key = null;
    const nokey = await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    expect(nokey.strain?.noKey).toBe(true);
    expect(nokey.websiteChanged).toBe(false);
    expect(lotRow().strain_type).toBe("indica");
    expect(draftRow("d1").chosen_strain_type).toBe("indica");
  });

  it("clearing the type: card -> 'unknown' (NOT NULL column) and the reviewer stamp removed so the library may fill", async () => {
    await propagateLotCorrections({ lotId: LOT, strainType: { value: "indica" }, names: noNames, target });
    await propagateLotCorrections({ lotId: LOT, strainType: { value: null }, names: noNames, target });
    expect(cardRow("c-pub").strain_type).toBe("unknown");
    expect(cardRow("c-pub").fact_provenance).toEqual({ thc_pct: "coa" });
    expect(lotRow().strain_type).toBeNull();
  });

  it("nothing to do -> no database traffic at all", async () => {
    const out = await propagateLotCorrections({ lotId: LOT, strainType: null, names: noNames, target });
    expect(st.db.log.length).toBe(0);
    expect(out).toEqual({ strain: null, details: null, websiteChanged: false });
  });
});

// === 2. updateLotDetailsAction ===============================================
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const v = { vendor_id: V_OLD, brand_id: B_OLD, strain_name: "Blue Dream", strain_type: "hybrid", ...over };
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

describe("R33 updateLotDetailsAction pushes the edit to the website", () => {
  it("strain type change: propagates, audits both steps, refreshes public surfaces, plain banner", async () => {
    const url = await expectRedirect(updateLotDetailsAction(LOT, form({ strain_type: "indica" })));
    expect(url.startsWith(`/admin/inventory/${LOT}?saved=1&lot_msg=`)).toBe(true);
    const msg = decodeURIComponent(url.split("lot_msg=")[1]);
    expect(msg).toContain("Strain type is now Indica.");
    expect(msg).toContain("1 live website card and 1 staged card");
    expect(st.calls).toContain("public-surfaces");
    expect(st.calls).toContain(`revalidate:/admin/inventory/${LOT}`);
    const actions = st.audits.map((a) => a.action);
    expect(actions).toEqual(["inventory_lot.details_edited", LOT_STRAIN_PROPAGATED_AUDIT]);
    expect(cardRow("c-pub").strain_type).toBe("indica");
  });

  it("brand change: details audit + card brand updated", async () => {
    const url = await expectRedirect(updateLotDetailsAction(LOT, form({ vendor_id: V_NEW, brand_id: B_NEW })));
    expect(decodeURIComponent(url)).toContain("New vendor, brand sent to 1 live website card and 1 staged card.");
    expect(st.audits.map((a) => a.action)).toEqual(["inventory_lot.details_edited", LOT_DETAILS_PROPAGATED_AUDIT]);
    expect(cardRow("c-pub").brand_name).toBe("New Brand");
    expect(st.calls).toContain("public-surfaces");
  });

  it("no real change -> no propagation, no public refresh, no banner", async () => {
    const url = await expectRedirect(updateLotDetailsAction(LOT, form()));
    expect(url).toBe(`/admin/inventory/${LOT}?saved=1`);
    expect(st.calls).not.toContain("public-surfaces");
    expect(st.audits.map((a) => a.action)).toEqual(["inventory_lot.details_edited"]);
    expect(st.db.log.some((r) => r.table === "menu_items")).toBe(false);
  });

  it("case-only strain-type difference is NOT a change (canonical compare)", async () => {
    lotRow().strain_type = "Hybrid";
    await expectRedirect(updateLotDetailsAction(LOT, form({ strain_type: "hybrid" })));
    expect(st.audits.map((a) => a.action)).toEqual(["inventory_lot.details_edited"]);
  });

  it("a lot not on the website: propagated audit, NO public refresh, honest banner", async () => {
    st.db.rows("menu_items").length = 0;
    const url = await expectRedirect(updateLotDetailsAction(LOT, form({ strain_type: "sativa" })));
    expect(decodeURIComponent(url)).toContain("not on the website menu yet");
    expect(st.calls).not.toContain("public-surfaces");
  });

  it("an invalid strain type is refused before any write", async () => {
    const url = await expectRedirect(updateLotDetailsAction(LOT, form({ strain_type: "purple" })));
    expect(url).toContain("?error=");
    expect(st.audits).toEqual([]);
    expect(st.db.log.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("a failed lot save stops before propagation", async () => {
    st.updateFails = true;
    const url = await expectRedirect(updateLotDetailsAction(LOT, form({ strain_type: "indica" })));
    expect(url).toBe(`/admin/inventory/${LOT}?error=save`);
    expect(cardRow("c-pub").strain_type).toBe("hybrid");
  });
});

// === 3. pushLotStrainTypeAction ==============================================
describe("R33 pushLotStrainTypeAction (Send to website)", () => {
  it("re-pushes the lot's current type and audits trigger send_to_website", async () => {
    lotRow().strain_type = "sativa"; // saved before R33: the card never heard
    const url = await expectRedirect(pushLotStrainTypeAction(LOT));
    expect(decodeURIComponent(url)).toContain("Strain type is now Sativa.");
    expect(cardRow("c-pub").strain_type).toBe("sativa");
    expect(st.calls).toContain("public-surfaces");
    expect(st.audits[0].action).toBe(LOT_STRAIN_PROPAGATED_AUDIT);
    expect(st.audits[0].before).toEqual({ strain_type: "sativa", trigger: "send_to_website" });
  });

  it("refuses a lot with no strain type (never pushes a blank)", async () => {
    lotRow().strain_type = null;
    const url = await expectRedirect(pushLotStrainTypeAction(LOT));
    expect(decodeURIComponent(url)).toContain("Pick a strain type for this lot first");
    expect(st.db.log.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("requires inventory.manage", async () => {
    lotRow().strain_type = "indica";
    await expectRedirect(pushLotStrainTypeAction(LOT));
    expect(st.calls[0]).toBe("perm:inventory.manage");
  });
});

// === 4. The drift read =======================================================
describe("R33 loadLotWebsiteStrainCards", () => {
  it("returns published + intake-staged cards with their version status", async () => {
    const cards = await loadLotWebsiteStrainCards(KEY);
    expect(cards.map((c) => [c.versionStatus, c.strainType]).sort()).toEqual([
      ["published", "hybrid"],
      ["staged", "hybrid"],
    ]);
  });
  it("[] for a blank key or a failed read (a check that cannot read never claims drift)", async () => {
    expect(await loadLotWebsiteStrainCards("  ")).toEqual([]);
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    expect(await loadLotWebsiteStrainCards(KEY)).toEqual([]);
  });
});
