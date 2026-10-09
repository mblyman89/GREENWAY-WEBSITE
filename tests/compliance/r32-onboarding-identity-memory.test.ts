/**
 * R32 (T-328) — Product Onboarding: truthful price fine print, identity
 * memory for Type / Strain type / Website category, and the inventory
 * table's onboarding join.
 *
 * Owner: "the AI price fine print … is inaccurate (it is 2x cost plus tax
 * rounded up to the next whole dollar)"; "I often see a yellow needs type
 * warning, even after I have received the same product before"; "strain type
 * … sometimes shows as blank after intaking products even though it was
 * set"; "the inventory table needs to display all data it has collected from
 * the onboarding process".
 *
 * A. pure cores at their exact floors (price-explain 66, onboarding-recall
 *    59, lot-onboarding 35, lot-table R32 cases).
 * B. mirrorStrainTypePickToLot machine FILL over the real postgrest-js
 *    client against FakePostgrest: fills an empty lot with machine
 *    provenance, never overwrites, human path unchanged, no pick + no fill =
 *    zero DB operations.
 * C. listPriorOnboardingPicks + loadLotOnboardingIndex are PAGED past the
 *    1,000-row PostgREST clamp and fail safe (no half memory; incomplete
 *    flagged).
 * D. source pins: the approval gate, the drafts card and the inventory page
 *    all read the same shared verdicts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import { PostgrestClient } from "@supabase/postgrest-js";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as Record<string, unknown>[],
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
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async () => ({}) }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));

const { mirrorStrainTypePickToLot, listPriorOnboardingPicks, LOT_STRAIN_TYPE_MIRROR_AUDIT_ACTION } = await import(
  "@/lib/inventory/catalog-drafts"
);
const { loadLotOnboardingIndex } = await import("@/lib/inventory/lot-onboarding-server");
const priceCore = await import("@/lib/inventory/price-explain-core");
const recallCore = await import("@/lib/inventory/onboarding-recall-core");
const lotCore = await import("@/lib/inventory/lot-onboarding-core");
const tableCore = await import("@/lib/inventory/lot-table-core");
const sortCore = await import("@/lib/inventory/inventory-sort-core");
const filterCore = await import("@/lib/inventory/inventory-filter-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const DRAFT = "00000000-0000-4000-8000-0000000000d1";
const L = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const admin = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as any;
const lotById = (id: string) => st.db.rows("inventory_lots").find((r) => r.id === id)!;
const lot = (id: string, over: Row = {}): Row => ({ id, strain_type: null, fact_provenance: {}, ...over });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
});

// ─── A. pure cores ─────────────────────────────────────────────────────────
describe("R32 A - pure cores at their exact floors", () => {
  it("price-explain-core: 66", () => {
    expect(priceCore.__runPriceExplainCoreTests()).toEqual({ passed: 66, failed: 0 });
  });
  it("onboarding-recall-core: 59", () => {
    expect(recallCore.__runOnboardingRecallCoreTests()).toEqual({ passed: 59, failed: 0 });
  });
  it("lot-onboarding-core: 35", () => {
    expect(lotCore.__runLotOnboardingCoreTests()).toEqual({ passed: 35, failed: 0 });
  });
  it("lot-table-core still passes with the R32 cases", () => {
    expect(() => tableCore.__runLotTableCoreTests()).not.toThrow();
  });

  it("the price rule is exactly 2x cost plus tax, rounded UP to the next whole dollar", () => {
    // $5.00 cost x 2 = $10.00; x 1.463 (37% excise + 9.3% sales) = $14.63 → $15.00.
    expect(priceCore.computePriceFloorMinor(500, 2, "flower")).toBe(1500);
    // Already a whole dollar stays put (never bumped a dollar higher).
    const e = priceCore.explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: null });
    expect(e.floorMinor).toBe(1500);
    expect(e.rationale.toLowerCase()).toContain("tax-inclusive");
    expect(e.steps.map((s) => s.key).slice(0, 4)).toEqual(["cost", "markup", "tax", "floor"]);
    // No cost → no price and an honest sentence (never a made-up number).
    const none = priceCore.explainPrice({ costMinor: null, multiple: 2, category: "flower", velocity: null });
    expect(none.floorMinor).toBeNull();
    expect(none.suggestedMinor).toBeNull();
  });

  it("your earlier decision outranks even a confident labeler verdict that disagrees", () => {
    const recalled = {
      value: "Flower",
      provenance: "remembered" as const,
      confidence: recallCore.REMEMBERED_PICK_CONFIDENCE,
      sourceText: "your pick on 2026-02-01",
      fromDraftId: "d-old",
      decidedAt: "2026-02-01T00:00:00Z",
    };
    const t = recallCore.effectiveHouseType({
      labeler: { houseType: "Pre-Roll", confidence: 95, autoAssigned: true },
      recalled,
      websiteCategory: "flower",
    });
    expect(t.value).toBe("Flower");
    expect(t.source).toBe("remembered");
    expect(t.needsTypePick).toBe(false);
    expect(t.persistProvenance).toBe("remembered");
  });

  it("demand uplift is really applied (a steady seller is priced above the floor)", () => {
    const e = priceCore.explainPrice({
      costMinor: 500,
      multiple: 2,
      category: "flower",
      velocity: { unitsSold: 60, windowDays: 30, basis: "product", deliveriesCounted: 3 },
    });
    // 2/day = steady (x1.12): $15.00 x 1.12 = $16.80 -> rounded up to $17.00.
    expect(e.band).toBe("steady");
    expect(e.suggestedMinor).toBe(1700);
    expect(e.rationale).toContain("across all 3 deliveries of this product");
  });

  it("the inventory sort + facet registries carry the R32 keys (append only)", () => {
    for (const k of ["price", "margin", "shelf", "onboarded", "cost"]) expect(sortCore.columnSortDef(k)).toBeTruthy();
    const params = filterCore.INVENTORY_FACETS.map((f) => f.param);
    expect(params).toContain("fShelf");
    expect(params).toContain("fOnboarded");
    // Append-only: the R32 facets come last so existing URLs keep meaning the same.
    expect(params.slice(-2)).toEqual(["fShelf", "fOnboarded"]);
  });

  it("joined lots sort by margin and fall back to the onboarding strain type", () => {
    const base = {
      id: "x",
      lot_id: "L1",
      status: "approved",
      chosen_strain_type: "indica",
      chosen_house_type: "Flower",
      chosen_website_category: "flower",
      price_minor_units: 1500,
      updated_at: "2026-03-01T00:00:00Z",
    };
    const joined = lotCore.attachLotOnboarding(
      [
        { id: "L1", strain_type: null, unit_cost_minor_units: 500, category: "EndProduct", inventory_type: "Usable Marijuana", product_name: "Blue Dream 3.5g" },
        { id: "L2", strain_type: "sativa", unit_cost_minor_units: 900, category: null, inventory_type: null, product_name: null },
      ],
      new Map([["L1", base], ["L2", { ...base, id: "y", lot_id: "L2" }]]),
    );
    expect(tableCore.lotStrainTypeLabel(joined[0])).toBe("Indica");
    expect(tableCore.lotStrainTypeLabel(joined[1])).toBe("Sativa");
    expect(tableCore.lotTypeLabel(joined[0])).toBe("Flower");
    expect(joined[0].onboarding_margin_pct).toBeGreaterThan(joined[1].onboarding_margin_pct as number);
  });
});

// ─── B. machine fill through the real client ───────────────────────────────
describe("R32 B - mirrorStrainTypePickToLot machine fill", () => {
  it("fills an EMPTY lot with the remembered value + 'remembered' provenance, keeps other provenance, audits", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { fact_provenance: { package_thc_mg: "name" } }));
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT,
      lotId: L(1),
      humanPick: null,
      actorId: ACTOR,
      machineFill: { value: "indica", lotProvenance: "remembered" },
    });
    expect(r).toEqual({ written: true, code: "filled" });
    const row = lotById(L(1));
    expect(row.strain_type).toBe("indica");
    expect(row.fact_provenance).toEqual({ package_thc_mg: "name", strain_type: "remembered" });
    expect(row.updated_by).toBe(ACTOR);
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0].action).toBe(LOT_STRAIN_TYPE_MIRROR_AUDIT_ACTION);
    expect((st.audits[0].after as Row).machine_fill).toBe(true);
  });

  it("treats a lot holding 'unknown' as empty", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "unknown" }));
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR,
      machineFill: { value: "hybrid", lotProvenance: "kb" },
    });
    expect(r.code).toBe("filled");
    expect(lotById(L(1)).strain_type).toBe("hybrid");
    expect(lotById(L(1)).fact_provenance).toEqual({ strain_type: "kb" });
  });

  it("NEVER overwrites a lot that already carries a value (one read, no write)", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "sativa", fact_provenance: { strain_type: "manifest" } }));
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR,
      machineFill: { value: "indica", lotProvenance: "remembered" },
    });
    expect(r).toEqual({ written: false, code: "lot_has_value" });
    expect(lotById(L(1)).strain_type).toBe("sativa");
    expect(lotById(L(1)).fact_provenance).toEqual({ strain_type: "manifest" });
    expect(st.db.log.map((q) => q.method)).toEqual(["GET"]);
  });

  it("a human pick still wins over any machine fill (reviewer provenance, overwrite allowed)", async () => {
    st.db.rows("inventory_lots").push(lot(L(1), { strain_type: "sativa" }));
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT, lotId: L(1), humanPick: "Indica", actorId: ACTOR,
      machineFill: { value: "hybrid", lotProvenance: "kb" },
    });
    expect(r).toEqual({ written: true, code: "written" });
    expect(lotById(L(1)).strain_type).toBe("indica");
    expect(lotById(L(1)).fact_provenance).toEqual({ strain_type: "reviewer" });
  });

  it("no pick and no fill -> ZERO database operations", async () => {
    st.db.rows("inventory_lots").push(lot(L(1)));
    for (const machineFill of [undefined, null, { value: null, lotProvenance: null }]) {
      const r = await mirrorStrainTypePickToLot(admin(), { draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR, machineFill });
      expect(r.written).toBe(false);
    }
    expect(st.db.log).toHaveLength(0);
    expect(lotById(L(1)).strain_type).toBeNull();
  });

  it("fill without a value-provenance is refused (never an unattributed write)", async () => {
    st.db.rows("inventory_lots").push(lot(L(1)));
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR,
      machineFill: { value: "indica", lotProvenance: null },
    });
    expect(r).toEqual({ written: false, code: "no_value" });
    expect(lotById(L(1)).strain_type).toBeNull();
  });

  it("a failed lot read never writes blind", async () => {
    st.db.rows("inventory_lots").push(lot(L(1)));
    st.db.before = (req) => (req.method === "GET" ? { status: 500, body: { message: "boom" } } : undefined);
    const r = await mirrorStrainTypePickToLot(admin(), {
      draftId: DRAFT, lotId: L(1), humanPick: null, actorId: ACTOR,
      machineFill: { value: "indica", lotProvenance: "remembered" },
    });
    expect(r).toEqual({ written: false, code: "lot_read_failed" });
    expect(st.db.log.some((q) => q.method === "PATCH")).toBe(false);
  });
});

// ─── C. paged reads past the 1,000-row clamp ───────────────────────────────
function seedDrafts(n: number, over: (i: number) => Row = () => ({})) {
  const rows = st.db.rows("catalog_product_drafts");
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Product ${i}`,
      brand_name: "Brand",
      vendor_name: "Vendor",
      category: "Usable Marijuana",
      status: "approved",
      lot_id: `lot-${i}`,
      chosen_website_category: "flower",
      chosen_house_type: "Flower",
      chosen_strain_type: "hybrid",
      chosen_classification_provenance: {},
      price_minor_units: 1500,
      updated_by: ACTOR,
      updated_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      ...over(i),
    });
  }
}

describe("R32 C - paged identity memory + inventory join", () => {
  it("listPriorOnboardingPicks reads EVERY approved draft past 1,000 rows (approved only)", async () => {
    seedDrafts(2300, (i) => (i % 10 === 0 ? { status: "dismissed" } : {}));
    const picks = await listPriorOnboardingPicks();
    expect(picks).toHaveLength(2070);
    expect(new Set(picks.map((p) => p.draftId)).size).toBe(2070);
    expect(st.db.log.filter((q) => q.table === "catalog_product_drafts").length).toBeGreaterThanOrEqual(3);
  });

  it("listPriorOnboardingPicks: a failed page = NO memory (never a half memory)", async () => {
    seedDrafts(1500);
    let n = 0;
    st.db.before = (req) => {
      if (req.table !== "catalog_product_drafts") return;
      n += 1;
      if (n === 2) return { status: 500, body: { message: "page 2 exploded" } };
    };
    expect(await listPriorOnboardingPicks()).toEqual([]);
  });

  it("loadLotOnboardingIndex joins every approved, lot-linked draft past 1,000 rows", async () => {
    seedDrafts(1800, (i) => (i % 3 === 0 ? { lot_id: null } : {}));
    const idx = await loadLotOnboardingIndex();
    expect(idx.complete).toBe(true);
    expect(idx.byLot.size).toBe(1200);
    expect(idx.byLot.get("lot-1")?.chosen_house_type).toBe("Flower");
  });

  it("loadLotOnboardingIndex: a failed page flags complete=false (the page then says so)", async () => {
    seedDrafts(1500);
    let n = 0;
    st.db.before = (req) => {
      if (req.table !== "catalog_product_drafts") return;
      n += 1;
      if (n === 2) return { status: 500, body: { message: "nope" } };
    };
    const idx = await loadLotOnboardingIndex();
    expect(idx.complete).toBe(false);
  });
});

// ─── D. wiring pins ────────────────────────────────────────────────────────
describe("R32 D - one verdict, three surfaces", () => {
  const drafts = read("src/lib/inventory/catalog-drafts.ts");
  const card = read("src/app/admin/inventory/drafts/page.tsx");
  const inv = read("src/app/admin/inventory/page.tsx");

  it("the approval gate uses the shared type verdict + remembered shelf", () => {
    expect(drafts).toMatch(/const priorPicks = await listPriorOnboardingPicks\(\);/);
    expect(drafts).toMatch(/needsTypePick: effectiveType\.needsTypePick,/);
    expect(drafts).toMatch(/needsCategoryPick: assessment\.needsCategoryPick && recall\.websiteCategory === null,/);
    expect(drafts).toMatch(/assessment: gateAssessment,/);
    expect(drafts).toMatch(/machineFill: effectiveStrain,/);
    // Provenance merged BEFORE the pinned write.
    const merge = drafts.indexOf("classificationProvenance = { ...classificationProvenance, ...onboardingProvenance };");
    const write = drafts.indexOf("update.chosen_classification_provenance = classificationProvenance;");
    expect(merge).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(merge);
  });

  it("the drafts card shows the same verdicts and their basis", () => {
    expect(card).toContain("listPriorOnboardingPicks()");
    expect(card).toMatch(/effectiveHouseType\(\{/);
    expect(card).toMatch(/effectiveStrainType\(\{/);
    expect(card).toContain('data-testid="draft-type-basis"');
    expect(card).toContain('data-testid="draft-strain-basis"');
    expect(card).toContain("<PriceExplainNote");
  });

  it("the inventory page joins onboarding and shows the new columns", () => {
    expect(inv).toContain("const onboardingPromise = loadLotOnboardingIndex();");
    expect(inv).toContain("attachLotOnboarding(allLots, onboardingIndex.byLot)");
    expect(inv).toContain("lots: joinedLots as PageLot[],");
    for (const k of ["cost", "price", "margin", "shelf", "onboarded"]) expect(inv).toContain(`columnKey="${k}"`);
    expect(inv).toContain('data-testid="inventory-onboarding-incomplete"');
    expect(inv).toContain('data-testid="inventory-identity-links"');
    expect(inv).toContain('data-testid="inventory-strain-type-basis"');
    expect(inv).toContain("{!onboardingIndex.complete && (");
    // Wide table scrolls instead of clipping.
    expect(inv).toContain('className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]"');
  });

  it("no migration: R32 adds none (provenance lives in the existing jsonb)", () => {
    expect(recallCore.ONBOARDING_PROVENANCE_KEYS).toEqual({ websiteCategory: "websiteCategory", houseType: "houseType", strainType: "strainType" });
  });
});
