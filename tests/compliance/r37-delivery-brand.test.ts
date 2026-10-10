/**
 * R37 S5 - "Brand for this delivery" (owner: "add a brand field at the top of
 * the page in the ai section that lets me set a brand for the whole manifest,
 * or to set them individually in the product rows bellow. This feature should
 * update the vendor record in the vendors page. This field should be auto
 * filled after the first time the manifest comes in so we only have to set it
 * the one time. This fact should flow through to enrichment and the inventory
 * table and the menu and the customer facing product cards and Leafly.").
 *
 * Runs the REAL delivery-brand-store against an in-memory PostgREST-shaped
 * fake (every filter it uses is implemented and an unknown one THROWS, so the
 * fake cannot silently say yes). The R33 card push is mocked at its seam and
 * recorded, so the test proves WHAT is pushed to menu cards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** column names that do not exist yet (simulates a pre-0257 database) */
  missing: new Set<string>(),
  /** table -> fail every read after N rows (simulates a mid-read outage) */
  failAfter: {} as Record<string, number>,
  pushes: [] as { lotId: string; brand: { from: string | null; to: string | null; toId: string | null } | undefined; target: unknown }[],
  pushCards: 1,
  seq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/lot-propagation-store", () => ({
  propagateLotCorrections: async (input: { lotId: string; names: { brand?: { from: string | null; to: string | null; toId: string | null } }; target: unknown }) => {
    db.pushes.push({ lotId: input.lotId, brand: input.names.brand, target: input.target });
    return {
      strain: null,
      details: { fields: ["brand"], cardsUpdated: { published: db.pushCards, staged: 0 }, cardsSkipped: [], draftsUpdated: 0, errors: [] },
      websiteChanged: db.pushCards > 0,
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => {
  type Filter = (r: Row) => boolean;
  const missingErr = (col: string) => ({ code: "42703", message: `column "${col}" does not exist` });
  class Q {
    private filters: Filter[] = [];
    private op: "select" | "update" | "insert" = "select";
    private patch: Row | null = null;
    private cols: string[] = [];
    private from = 0;
    private to = Infinity;
    private orderCol: string | null = null;
    private returning = false;
    constructor(private table: string) {}
    private checkCols(cols: string[]) {
      for (const c of cols) if (db.missing.has(`${this.table}.${c}`)) return missingErr(c);
      return null;
    }
    select(cols?: string) {
      if (this.op === "select") this.cols = (cols ?? "*").split(",").map((s) => s.trim());
      else this.returning = true;
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    insert(p: Row) {
      this.op = "insert";
      this.patch = p;
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    is(c: string, v: null) {
      this.filters.push((r) => (r[c] ?? null) === v);
      return this;
    }
    order(c: string) {
      this.orderCol = c;
      return this;
    }
    range(a: number, b: number) {
      this.from = a;
      this.to = b;
      return this;
    }
    limit() {
      throw new Error("fake: .limit() is not allowed in this store");
    }
    private rows() {
      return (db.tables[this.table] ??= []);
    }
    private run(): { data: unknown; error: unknown } {
      if (this.op === "select") {
        const bad = this.checkCols(this.cols);
        if (bad) return { data: null, error: bad };
        const fa = db.failAfter[this.table];
        if (fa !== undefined && this.from >= fa) return { data: null, error: { code: "57014", message: "statement timeout" } };
        let out = this.rows().filter((r) => this.filters.every((f) => f(r)));
        if (this.orderCol) out = [...out].sort((x, y) => String(x[this.orderCol!]).localeCompare(String(y[this.orderCol!])));
        out = out.slice(this.from, this.to === Infinity ? undefined : this.to + 1);
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      const bad = this.checkCols(Object.keys(this.patch ?? {}));
      if (bad) return { data: null, error: bad };
      if (this.op === "insert") {
        const p = this.patch!;
        if (this.table === "brands" && this.rows().some((r) => r.slug === p.slug)) return { data: null, error: { code: "23505", message: "duplicate slug" } };
        const row = { id: `new-${++db.seq}`, ...p };
        this.rows().push(row);
        return { data: [{ ...row }], error: null };
      }
      const hit = this.rows().filter((r) => this.filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, this.patch);
      return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    maybeSingle() {
      const r = this.run();
      return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error });
    }
    single() {
      return this.maybeSingle();
    }
    then<T>(ok: (v: { data: unknown; error: unknown }) => T, bad?: (e: unknown) => T) {
      return Promise.resolve(this.run()).then(ok, bad);
    }
  }
  return { createSupabaseAdminClient: () => ({ from: (t: string) => new Q(t) }) };
});

const V1 = "vendor-1";
const V2 = "vendor-2";
const MAN = "man-1";

function seed() {
  db.tables = {
    vendors: [
      { id: V1, display_name: "Phat Panda LLC", default_brand_id: null },
      { id: V2, display_name: "Other Farm", default_brand_id: null },
    ],
    brands: [
      { id: "b-unlinked", display_name: "Grow Op Farms", slug: "grow-op-farms", vendor_id: null },
      { id: "b-other", display_name: "Sticky Frog", slug: "sticky-frog", vendor_id: V2 },
      { id: "b-own", display_name: "Phat Panda", slug: "phat-panda", vendor_id: V1 },
    ],
    inbound_manifests: [{ id: MAN, vendor_id: V1, brand_id: null }],
    inventory_lots: [
      { id: "lot-1", brand_id: null, vendor_id: V1, strain_name: "Blue Dream" },
      { id: "lot-2", brand_id: "b-other", vendor_id: V1, strain_name: "Gelato" },
      { id: "lot-3", brand_id: null, vendor_id: V1, strain_name: "OG" },
    ],
    catalog_product_drafts: [
      { id: "d1", manifest_id: MAN, lot_id: "lot-1", brand_id: null, brand_name: null, status: "draft", vendor_id: V1 },
      { id: "d2", manifest_id: MAN, lot_id: "lot-2", brand_id: "b-other", brand_name: "Sticky Frog", status: "draft", vendor_id: V1 },
      { id: "d3", manifest_id: MAN, lot_id: "lot-3", brand_id: null, brand_name: "", status: "approved", vendor_id: V1 },
      { id: "d4", manifest_id: MAN, lot_id: null, brand_id: null, brand_name: null, status: "dismissed", vendor_id: V1 },
    ],
  };
  db.missing = new Set();
  db.failAfter = {};
  db.pushes = [];
  db.pushCards = 1;
}
beforeEach(seed);

const store = () => import("@/lib/inventory/delivery-brand-store");
const draft = (id: string) => db.tables.catalog_product_drafts.find((d) => d.id === id)!;
const lot = (id: string) => db.tables.inventory_lots.find((l) => l.id === id)!;

describe("R37 S5 setDeliveryBrand (real store, fake database)", () => {
  it("fill: the vendor's own brand lands on every EMPTY row, its lot and its cards; other brands are kept; dismissed rows untouched", async () => {
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "  phat   PANDA ", mode: "fill", actorId: "u1" });
    expect(r.code).toBe("ok");
    expect(r.brand).toBe("Phat Panda");
    expect(r.brandId).toBe("b-own");
    expect(r.created).toBe(false);
    expect(r.changed).toBe(2);
    expect(r.kept).toBe(1);
    expect(draft("d1")).toMatchObject({ brand_name: "Phat Panda", brand_id: "b-own" });
    expect(draft("d3")).toMatchObject({ brand_name: "Phat Panda", brand_id: "b-own" });
    expect(draft("d2")).toMatchObject({ brand_name: "Sticky Frog", brand_id: "b-other" });
    expect(draft("d4").brand_name).toBeNull();
    expect(lot("lot-1").brand_id).toBe("b-own");
    expect(lot("lot-3").brand_id).toBe("b-own");
    expect(lot("lot-2").brand_id).toBe("b-other");
    expect(db.pushes.map((p) => p.lotId).sort()).toEqual(["lot-1", "lot-3"]);
    expect(db.pushes[0].brand).toEqual({ from: null, to: "Phat Panda", toId: "b-own" });
    expect(db.pushes[0].target).toMatchObject({ vendorId: V1, brandId: "b-own" });
    expect(r.cards).toBe(2);
    // memory: the delivery AND the vendor record
    expect(r.remembered).toBe(true);
    expect(db.tables.inbound_manifests[0].brand_id).toBe("b-own");
    expect(db.tables.vendors[0].default_brand_id).toBe("b-own");
    expect(db.tables.vendors[1].default_brand_id).toBeNull();
  });

  it("replace: overwrites every live row, including another brand", async () => {
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "replace", actorId: "u1" });
    expect(r.changed).toBe(3);
    expect(r.kept).toBe(0);
    expect(draft("d2")).toMatchObject({ brand_name: "Phat Panda", brand_id: "b-own" });
    expect(lot("lot-2").brand_id).toBe("b-own");
    expect(db.pushes.find((p) => p.lotId === "lot-2")!.brand).toEqual({ from: "Sticky Frog", to: "Phat Panda", toId: "b-own" });
  });

  it("a new brand is CREATED under the vendor as a draft brand", async () => {
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Panda Reserve", mode: "fill", actorId: "u1" });
    expect(r.code).toBe("ok");
    expect(r.created).toBe(true);
    const b = db.tables.brands.find((x) => x.display_name === "Panda Reserve")!;
    expect(b).toMatchObject({ slug: "panda-reserve", vendor_id: V1, status: "draft", created_by: "u1" });
    expect(draft("d1").brand_id).toBe(b.id);
    expect(db.tables.vendors[0].default_brand_id).toBe(b.id);
  });

  it("an UNLINKED brand is adopted by the vendor (not duplicated)", async () => {
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "grow-op farms", mode: "fill", actorId: "u1" });
    expect(r.adopted).toBe(true);
    expect(r.brandId).toBe("b-unlinked");
    expect(db.tables.brands.filter((b) => String(b.display_name).toLowerCase().includes("grow"))).toHaveLength(1);
    expect(db.tables.brands.find((b) => b.id === "b-unlinked")!.vendor_id).toBe(V1);
  });

  it("another vendor's brand is REFUSED by name and nothing is written", async () => {
    const { setDeliveryBrand } = await store();
    const before = JSON.stringify(db.tables);
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Sticky Frog", mode: "replace", actorId: "u1" });
    expect(r.code).toBe("refused");
    expect(r.reason).toContain("Other Farm");
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(db.pushes).toHaveLength(0);
  });

  it("before migration 0257: the brand is still applied; remembered is null (the banner warns)", async () => {
    db.missing = new Set(["inbound_manifests.brand_id", "vendors.default_brand_id"]);
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "fill", actorId: "u1" });
    expect(r.code).toBe("ok");
    expect(r.changed).toBe(2);
    expect(r.remembered).toBeNull();
    expect(db.tables.vendors[0].default_brand_id).toBeNull();
  });

  it("before 0234 (no drafts.brand_id): brand_name is still written", async () => {
    db.missing = new Set(["catalog_product_drafts.brand_id"]);
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "fill", actorId: "u1" });
    expect(r.code).toBe("ok");
    expect(draft("d1").brand_name).toBe("Phat Panda");
    expect(lot("lot-1").brand_id).toBe("b-own");
  });

  it("a PARTIAL product read is refused - never a half-branded delivery that looks done", async () => {
    // 1001 rows so a second page is needed, and the second page fails.
    for (let i = 0; i < 1001; i++) db.tables.catalog_product_drafts.push({ id: `x${String(i).padStart(5, "0")}`, manifest_id: MAN, lot_id: null, brand_id: null, brand_name: null, status: "draft" });
    db.failAfter = { catalog_product_drafts: 1000 };
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "fill", actorId: "u1" });
    expect(r.code).toBe("error");
    expect(draft("d1").brand_name).toBeNull();
  });

  it("more than 1000 rows are ALL branded when the read is complete (paged, not capped)", async () => {
    for (let i = 0; i < 1001; i++) db.tables.catalog_product_drafts.push({ id: `x${String(i).padStart(5, "0")}`, manifest_id: MAN, lot_id: null, brand_id: null, brand_name: null, status: "draft" });
    const { setDeliveryBrand } = await store();
    const r = await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "fill", actorId: "u1" });
    expect(r.changed).toBe(1003);
  });

  it("empty name / bad input / missing delivery are refusals", async () => {
    const { setDeliveryBrand } = await store();
    expect((await setDeliveryBrand({ manifestId: MAN, rawName: "   ", mode: "fill", actorId: null })).code).toBe("refused");
    expect((await setDeliveryBrand({ manifestId: MAN, rawName: "!!!", mode: "fill", actorId: null })).code).toBe("refused");
    expect((await setDeliveryBrand({ manifestId: "nope", rawName: "X", mode: "fill", actorId: null })).code).toBe("refused");
  });

  it("a lot already on the brand still gets its cards pushed (stale card brand_name is healed)", async () => {
    lot("lot-1").brand_id = "b-own";
    const { setDeliveryBrand } = await store();
    await setDeliveryBrand({ manifestId: MAN, rawName: "Phat Panda", mode: "fill", actorId: "u1" });
    expect(db.pushes.map((p) => p.lotId)).toContain("lot-1");
  });
});

describe("R37 S5 setDraftBrand (one row)", () => {
  it("sets one row only and pushes its lot", async () => {
    const { setDraftBrand } = await store();
    const r = await setDraftBrand({ draftId: "d2", rawName: "Phat Panda", actorId: "u1" });
    expect(r.code).toBe("ok");
    expect(r.manifestId).toBe(MAN);
    expect(draft("d2").brand_id).toBe("b-own");
    expect(draft("d1").brand_id).toBeNull();
    expect(db.pushes.map((p) => p.lotId)).toEqual(["lot-2"]);
    // a single row never rewrites the vendor's memory
    expect(db.tables.vendors[0].default_brand_id).toBeNull();
  });
  it("an empty name CLEARS the row brand (lot too)", async () => {
    const { setDraftBrand } = await store();
    const r = await setDraftBrand({ draftId: "d2", rawName: "", actorId: "u1" });
    expect(r.code).toBe("cleared");
    expect(draft("d2")).toMatchObject({ brand_name: null, brand_id: null });
    expect(lot("lot-2").brand_id).toBeNull();
    expect(db.pushes[0].brand).toEqual({ from: "Sticky Frog", to: null, toId: null });
  });
  it("a dismissed row is refused", async () => {
    const { setDraftBrand } = await store();
    expect((await setDraftBrand({ draftId: "d4", rawName: "Phat Panda", actorId: "u1" })).code).toBe("refused");
  });
});

describe("R37 S5 memory: context + vendor default", () => {
  it("loadDeliveryBrandContext returns the delivery brand, the vendor default and the vendor's brands", async () => {
    db.tables.inbound_manifests[0].brand_id = "b-own";
    db.tables.vendors[0].default_brand_id = "b-own";
    const { loadDeliveryBrandContext } = await store();
    const c = await loadDeliveryBrandContext(MAN);
    expect(c).toMatchObject({ vendorId: V1, vendorName: "Phat Panda LLC", deliveryBrand: "Phat Panda", vendorDefault: "Phat Panda", migrated: true });
    expect(c.vendorBrands).toEqual(["Phat Panda"]);
  });
  it("context says migrated:false before 0257", async () => {
    db.missing = new Set(["inbound_manifests.brand_id"]);
    const { loadDeliveryBrandContext } = await store();
    expect((await loadDeliveryBrandContext(MAN)).migrated).toBe(false);
  });
  it("readVendorDefaultBrand: id+name, null when unset or unmigrated", async () => {
    const { readVendorDefaultBrand } = await store();
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const admin = createSupabaseAdminClient();
    expect(await readVendorDefaultBrand(admin, V1)).toBeNull();
    db.tables.vendors[0].default_brand_id = "b-own";
    expect(await readVendorDefaultBrand(admin, V1)).toEqual({ id: "b-own", name: "Phat Panda" });
    db.missing = new Set(["vendors.default_brand_id"]);
    expect(await readVendorDefaultBrand(admin, V1)).toBeNull();
    expect(await readVendorDefaultBrand(admin, null)).toBeNull();
  });
  it("setVendorDefaultBrand refuses another vendor's brand, accepts its own or an unlinked one, clears with null", async () => {
    const { setVendorDefaultBrand } = await store();
    expect(await setVendorDefaultBrand(V1, "b-other")).toMatchObject({ ok: false });
    expect(db.tables.vendors[0].default_brand_id).toBeNull();
    expect(await setVendorDefaultBrand(V1, "b-own")).toEqual({ ok: true });
    expect(db.tables.vendors[0].default_brand_id).toBe("b-own");
    expect(await setVendorDefaultBrand(V1, null)).toEqual({ ok: true });
    expect(db.tables.vendors[0].default_brand_id).toBeNull();
    db.missing = new Set(["vendors.default_brand_id"]);
    expect(await setVendorDefaultBrand(V1, "b-own")).toMatchObject({ ok: false, migration: true });
  });
});

describe("R37 S5 wiring (source pins)", () => {
  it("intake applies the vendor default ONLY through intakeBrandForLine and logs the event", () => {
    const src = read("src/lib/inventory/intake-store.ts");
    expect(src).toContain("readVendorDefaultBrand(admin, vendorId)");
    expect(src).toMatch(/intakeBrandForLine\(/);
    expect(src).toContain("DELIVERY_BRAND_DEFAULT_EVENT");
  });
  it("the store pushes cards only through the R33 propagateLotCorrections path and never uses .limit()", () => {
    const src = read("src/lib/inventory/delivery-brand-store.ts");
    expect(src).toContain("propagateLotCorrections(");
    expect(src).not.toMatch(/\.limit\(/);
    expect(src).toContain('.is("vendor_id", null)');
  });
  it("the actions require inventory.manage / vendors.manage and audit", () => {
    const a = read("src/app/admin/inventory/drafts/actions.ts");
    const s = a.slice(a.indexOf("export async function setDeliveryBrandAction"));
    expect(s).toContain("core.DELIVERY_BRAND_AUDIT");
    expect(s).toContain("core.VENDOR_DEFAULT_BRAND_AUDIT");
    expect(s).toContain("core.DRAFT_BRAND_AUDIT");
    expect(s).toContain("revalidatePublicMenuSurfaces()");
    const v = read("src/app/admin/vendors/actions.ts");
    const vs = v.slice(v.indexOf("export async function setVendorDefaultBrandAction"));
    expect(vs).toContain('requirePermission("vendors.manage")');
    expect(vs).toContain("VENDOR_DEFAULT_BRAND_AUDIT");
  });
  it("the onboarding page shows the field inside the AI batch-lookup section, the row form, and the banner", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    const sec = page.slice(page.indexOf('id="batch-lookup"'));
    expect(sec).toContain("setDeliveryBrandAction.bind(null, focus.manifestId)");
    expect(sec).toContain('data-testid="delivery-brand-input"');
    expect(page).toContain("setDraftBrandAction.bind(null,");
    expect(page).toContain('data-testid="row-brand"');
    expect(page).toContain("deliveryBrandBanner(sp as Record<string, unknown>)");
    expect(page).toContain("deliveryBrandPrefill(");
  });
  it("the vendor page has the remembered-brand form and the migration notice", () => {
    const p = read("src/app/admin/vendors/[id]/page.tsx");
    expect(p).toContain('id="default-brand"');
    expect(p).toContain("setVendorDefaultBrandAction");
    expect(p).toContain('data-testid="vendor-default-brand-migration"');
  });
});
