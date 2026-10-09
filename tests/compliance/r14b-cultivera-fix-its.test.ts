/**
 * tests/compliance/r14b-cultivera-fix-its.test.ts
 *
 * R14b -- the remaining Cultivera fix-its (owner, Round 14, verbatim):
 *   "Things like fixing the types and categories, which by the way, Cultivera
 *    uses the CCRS types for their type column, but their category column
 *    closely matches our category column, so we will need to reverse engineer
 *    the type based on the category."
 *   "Make sure the cycle counts redirect fix it feature actually loads in the
 *    product it says needs fixed."
 *
 *   1. The real Cultivera workbook (INVENTORIES.xlsx, 3917 rows) proves the
 *      category -> CCRS-type table: every category's majority type is an
 *      accepted type, and the report totals are pinned.
 *   2. "Count these products" (behavioural, fake PostgREST + the REAL planner):
 *      exactly the flagged cards' active lots load, nothing else, nothing
 *      deferred -- even across the 1000-row page cap.
 *   3. Unknown categories (Dab Rig) prefill the Types page with a grounded
 *      suggestion.
 *   4. Fact Review: one reason at a time, focus kept after save, values read
 *      from the product name.
 *   5. Wiring: page test ids, the re-file action's guards, the runner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  acceptedCcrsTypesFor,
  assessCultiveraType,
  buildTypeCheckReport,
  parseTypeCheckRefile,
  suggestForUnknownCategory,
  typeCheckAdvice,
  typeCheckReturnHref,
  TYPE_CHECK_ANCHOR,
  TYPE_CHECK_REFILE_AUDIT,
} from "@/lib/pos/cultivera-type-from-category-core";
import {
  factsGroupHref,
  filterByFocus,
  parseFactFocus,
  savedRedirectSuffix,
  suggestFactsFromName,
} from "@/lib/pos/fact-review-focus-core";
import { countFlaggedProductsHref, typeFocusHref } from "@/lib/pos/pos-import-fix-core";
import { mixedSizeKeysFromDiagnostics, scopeFromProductKeys } from "@/lib/inventory/flagged-count-scope-core";
import { buildAuditPlan, type AuditLot } from "@/lib/inventory/inventory-audit-core";
import { planImportLots, type ImportLotSource } from "@/lib/pos/import-lot-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─── 1. the real workbook ────────────────────────────────────────────────────

type Row = { Product: string; Category: string; InventoryType: string };
function workbookRows(): Row[] {
  const wb = XLSX.read(readFileSync(join(ROOT, "back-office/GREENWAY WEBSITE/transformer/inputs/INVENTORIES.xlsx")));
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: "" }).map((r) => ({
    Product: String(r.Product ?? ""),
    Category: String(r.Category ?? ""),
    InventoryType: String(r.InventoryType ?? ""),
  }));
}

describe("R14b — the category → CCRS type table, proven on the real Cultivera export", () => {
  const rows = workbookRows();

  it("reads the full export", () => {
    expect(rows.length).toBe(3917);
  });

  it("every known category's MAJORITY CCRS type is one the table accepts (Panda Candies is a known data error)", () => {
    const byCat = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const c = r.Category.trim();
      if (!c) continue;
      const m = byCat.get(c) ?? new Map<string, number>();
      m.set(r.InventoryType.trim(), (m.get(r.InventoryType.trim()) ?? 0) + 1);
      byCat.set(c, m);
    }
    const failures: string[] = [];
    let checked = 0;
    for (const [cat, counts] of byCat) {
      const accepted = acceptedCcrsTypesFor(cat);
      if (accepted.length === 0) continue; // unknown to the catalog, or Trim (no expectation)
      checked += 1;
      const [majority] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!accepted.includes(majority)) failures.push(`${cat}: ${majority}`);
    }
    // Panda Candies has ONE row, typed Usable Marijuana — the name and category
    // both say candy. That is the Cultivera garbage the panel surfaces.
    expect(failures).toEqual(["Panda Candies: Usable Marijuana"]);
    expect(checked).toBeGreaterThan(20);
  });

  it("the report on the real rows: 3790 agree, 127 flagged, and only two name-backed suspects", () => {
    const rep = buildTypeCheckReport(
      rows.map((r, i) => ({ sourceItemId: `r${i}`, name: r.Product, productName: r.Product, category: r.Category, inventoryType: r.InventoryType })),
    );
    expect(rep.checked).toBe(3917);
    expect(rep.agree).toBe(3790);
    expect(rep.flagged).toBe(127);
    expect(rep.noCategory).toBe(0);
    expect(rep.agree + rep.flagged + rep.noCategory).toBe(rep.checked);
    const suspects = rep.groups.filter((g) => g.verdict === "category_suspect");
    expect(suspects.map((g) => `${g.category}×${g.count}`).sort()).toEqual(["Panda Candies×1", "Roll On×1"]);
    const rollOn = suspects.find((g) => g.category === "Roll On")!;
    expect(rollOn.rows[0].suggestion).toMatchObject({ houseType: "Infused Pre-roll", websiteCategory: "infused-preroll" });
    // Suspects are listed first so the fixable ones are on top.
    expect(rep.groups[0].verdict).toBe("category_suspect");
    // The biggest type mismatch is the Infused Pre-roll filed as Usable Marijuana.
    const mm = rep.groups.filter((g) => g.verdict === "type_mismatch");
    expect(mm[0]).toMatchObject({ category: "Infused Pre-roll", actualCcrsType: "Usable Marijuana", count: 85 });
    expect(mm.reduce((s, g) => s + g.count, 0) + suspects.reduce((s, g) => s + g.count, 0)).toBe(127);
  });
});

describe("R14b — the type check never rewrites the regulator's value", () => {
  it("agrees when the type fits, mismatches when it does not", () => {
    expect(assessCultiveraType({ category: "Flower", inventoryType: "Usable Marijuana" }).verdict).toBe("agree");
    const a = assessCultiveraType({ category: "Cartridge", inventoryType: "Usable Marijuana", productName: "Acme Cart 1g" });
    expect(a.verdict).toBe("type_mismatch");
    expect(a.ourType).toBe("Cartridge");
    expect(a.expectedCcrsType).toBe("Concentrate for Inhalation");
    expect(a.actualCcrsType).toBe("Usable Marijuana");
  });
  it("a re-file is offered only with two witnesses; a name that also supports the category vetoes it", () => {
    const rollOn = assessCultiveraType({ category: "Roll On", inventoryType: "Usable Marijuana", productName: "Canna Organix Infused Pre-roll Forbidden Fruit" });
    expect(rollOn.verdict).toBe("category_suspect");
    // "Live Resin" (a concentrate, same CCRS type as Rosin) is in the name too:
    // the name is ambiguous, so it stays a plain type mismatch.
    const ambiguous = assessCultiveraType({ category: "Rosin", inventoryType: "Usable Marijuana", productName: "Live Resin Infused Pre-roll" });
    expect(ambiguous.verdict).toBe("type_mismatch");
    expect(ambiguous.suggestion).toBeNull();
    // The type alone (no name witness) never re-files.
    expect(assessCultiveraType({ category: "Roll On", inventoryType: "Usable Marijuana", productName: "Forbidden Fruit" }).verdict).toBe("type_mismatch");
  });
  it("the mismatch advice sends the fix to Cultivera and names a unit change only when there is one", () => {
    const same = typeCheckAdvice({ verdict: "type_mismatch", category: "Cartridge", ourType: "Cartridge", actualCcrsType: "Usable Marijuana", expectedCcrsType: "Concentrate for Inhalation" });
    expect(same).toContain("never rewritten here");
    expect(same).toContain("correct it in Cultivera and upload again");
    expect(same).not.toContain("instead of");
    const diff = typeCheckAdvice({ verdict: "type_mismatch", category: "Edible", ourType: "Edible", actualCcrsType: "Usable Marijuana", expectedCcrsType: "Solid Edible" });
    expect(diff).toContain("% instead of mg");
  });
  it("re-file is validated against closed registries and refuses contradictions", () => {
    const reg = { validCategoryValues: ["preroll", "topical", "paraphernalia"], validTypeLabels: ["Pre-roll", "Topical"] };
    expect(parseTypeCheckRefile({ website_category: "preroll", house_type: "pre-roll" }, reg)).toEqual({ ok: true, websiteCategory: "preroll", houseType: "Pre-roll" });
    expect(parseTypeCheckRefile({ website_category: "", house_type: "" }, reg).ok).toBe(false);
    expect(parseTypeCheckRefile({ website_category: "not-a-cat" }, reg).ok).toBe(false);
    expect(parseTypeCheckRefile({ website_category: "preroll", house_type: "Made Up" }, reg).ok).toBe(false);
    const contra = parseTypeCheckRefile({ website_category: "topical", house_type: "Pre-roll" }, reg);
    expect(contra.ok).toBe(false);
    expect(contra.ok ? "" : contra.error).toContain("belongs under");
  });
  it("the return link lands on the panel", () => {
    expect(typeCheckReturnHref("imp-1", "Done.")).toBe("/admin/menu-imports/imp-1?refiled=Done.#type-check");
    expect(typeCheckReturnHref("imp-1", "No.", true)).toBe("/admin/menu-imports/imp-1?error=No.#type-check");
    expect(TYPE_CHECK_ANCHOR).toBe("type-check");
    expect(TYPE_CHECK_REFILE_AUDIT).toBe("menu_import.type_check_refiled");
  });
});

describe("R14b — unknown categories get a grounded placement, prefilled on the Types page", () => {
  it("Dab Rig → paraphernalia (WAC 314-55-010(34)); Cured Resin Cartridge → Cartridge; nonsense → nothing", () => {
    expect(suggestForUnknownCategory("Dab Rig")).toMatchObject({ websiteCategory: "paraphernalia", houseType: null });
    expect(suggestForUnknownCategory("Dab Rig")!.why).toContain("WAC 314-55-010(34)");
    expect(suggestForUnknownCategory("Cured Resin Cartridge")).toMatchObject({ websiteCategory: "cartridge", houseType: "Cartridge" });
    expect(suggestForUnknownCategory("Zzqx")).toBeNull();
  });
  it("the Types link carries the suggestion only when it is a clean slug", () => {
    expect(typeFocusHref("Dab Rig", "paraphernalia")).toContain("&suggest=paraphernalia");
    expect(typeFocusHref("Dab Rig", "../evil")).not.toContain("suggest=");
    expect(typeFocusHref("Dab Rig")).not.toContain("suggest=");
  });
});

describe("R14b — Fact Review, one reason at a time", () => {
  it("focus is parsed strictly and kept through a save", () => {
    expect(parseFactFocus({ group: "missing-thc", q: "  blue   dream " })).toEqual({ group: "missing-thc", q: "blue dream" });
    expect(parseFactFocus({ group: "../x", q: "" }).group).toBeNull();
    expect(savedRedirectSuffix(parseFactFocus({ group: "g1", q: "" }))).toBe("&group=g1#one-at-a-time");
    expect(savedRedirectSuffix(parseFactFocus({ group: null, q: null }))).toBe("");
    expect(factsGroupHref("imp", "g1")).toBe("/admin/menu-imports/imp/facts?group=g1#one-at-a-time");
  });
  it("filterByFocus keeps only the chosen reason and the search", () => {
    const rows = [
      { sourceItemId: "p1", name: "Blue Dream" },
      { sourceItemId: "p2", name: "OG Kush" },
      { sourceItemId: "p3", name: "Blue Dream" },
    ];
    const groupOf = new Map([["p1", "a"], ["p2", "a"], ["p3", "b"]]);
    const out = filterByFocus(rows, { group: "a", q: "blue" }, (id) => groupOf.get(id));
    expect(out.map((r) => r.sourceItemId)).toEqual(["p1"]);
    expect(filterByFocus(rows, { group: null, q: null }, (id) => groupOf.get(id)).length).toBe(3);
  });
  it("name values are read only when attributed, and a contradiction withholds the total", () => {
    const ok = suggestFactsFromName("Gummies 10 x 10mg 100mg THC");
    expect(ok.conflicts).toEqual([]);
    expect(ok.suggestions.map((x) => `${x.field}=${x.value}`)).toEqual(["servingsPerPack=10", "mgPerServing=10", "packageThcMg=100"]);
    const bad = suggestFactsFromName("Gummies 10 x 10mg 50mg THC");
    expect(bad.conflicts.length).toBe(1);
    expect(bad.suggestions.some((x) => x.field === "packageThcMg")).toBe(false);
    // Two THC doses in one name: which is the package? Neither is offered.
    expect(suggestFactsFromName("Duo Pack 100mg THC + 50mg THC").suggestions).toEqual([]);
    expect(suggestFactsFromName("Chocolate 100mg THC").suggestions.map((x) => `${x.field}=${x.value}`)).toEqual(["packageThcMg=100"]);
    // A bare "10mg" says nothing about which cannabinoid.
    expect(suggestFactsFromName("Mystery 10mg").suggestions.filter((s) => /thc|cbd/i.test(s.field))).toEqual([]);
  });
});

// ─── 2. "Count these products" loads exactly the flagged products ────────────

const st = vi.hoisted(() => ({
  diagnostics: [] as Array<{ id: number; import_id: string; code: string; context_json: unknown }>,
  lots: [] as Array<Record<string, unknown>>,
  queries: [] as string[],
  failLots: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (rows: unknown[]) => rows.map(() => ({ websiteCategory: "flower", unmapped: false })),
}));
vi.mock("@/lib/supabase/books-client", () => ({
  createBooksClient: async () => ({
    from(table: string) {
      const f: { eq: Array<[string, unknown]>; in: Array<[string, readonly unknown[]]>; range: [number, number] | null } = { eq: [], in: [], range: null };
      const run = () => {
        let src: Array<Record<string, unknown>> =
          table === "pos_import_diagnostics" ? (st.diagnostics as Array<Record<string, unknown>>) : table === "inventory_lots" ? st.lots : [];
        if (table === "inventory_lots" && st.failLots) return { data: null, error: { message: "boom" } };
        for (const [c, v] of f.eq) src = src.filter((r) => r[c] === v);
        for (const [c, vs] of f.in) src = src.filter((r) => vs.includes(r[c]));
        if (f.range) src = src.slice(f.range[0], f.range[1] + 1);
        st.queries.push(`${table} eq=${JSON.stringify(f.eq)} in=${f.in.map(([c, v]) => `${c}:${v.length}`).join(",")}`);
        return { data: src, error: null };
      };
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (f.eq.push([c, v]), b),
        in: (c: string, v: readonly unknown[]) => (f.in.push([c, v]), b),
        order: () => b,
        range: (a: number, z: number) => ((f.range = [Math.min(a, a + 999), Math.min(z, a + 999)]), b),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  }),
}));

const IMPORT = "11111111-2222-4333-8444-555555555555";
const OTHER_IMPORT = "99999999-2222-4333-8444-555555555555";

function dbLot(id: string, key: string, status = "active"): Record<string, unknown> {
  return {
    id,
    lot_code: `LC-${id}`,
    pos_product_key: key,
    product_name: `Product ${key}`,
    vendor_id: null,
    on_hand_qty: 5,
    unit_cost_minor_units: 100,
    // Counted yesterday: NOT due. The flagged scope must still include it.
    last_counted_at: new Date(Date.now() - 86_400_000).toISOString(),
    status,
    inventory_type: "Usable Marijuana",
    category: "Flower",
  };
}

describe("R14b — “Count these products” loads exactly the products the import flagged", () => {
  beforeEach(() => {
    st.diagnostics = [];
    st.lots = [];
    st.queries = [];
    st.failLots = false;
  });

  it("the import planner writes EVERY flagged card key into the warning", () => {
    const base = (over: Partial<ImportLotSource>): ImportLotSource => ({
      posProductKey: "pos-a", itemName: "A", barcode: "B1", productName: "A 3.5g", category: "Flower", inventoryType: "Usable Marijuana",
      strainName: "A", strainType: "hybrid", brand: "Acme", vendor: "ACME", units: 3, costRaw: "$5.00", receivedDateRaw: "06/17/2026",
      expirationDateRaw: "", coaRaw: "Y", isMedical: false, isSample: false, unitWeight: 3.5, unitWeightUom: "g", ...over,
    });
    const src: ImportLotSource[] = [];
    // 12 mixed cards (more than the 10 names the old context kept) + 1 uniform card.
    for (let i = 0; i < 12; i++) {
      src.push(base({ posProductKey: `pos-m${i}`, barcode: `M${i}a`, unitWeight: 3.5 }));
      src.push(base({ posProductKey: `pos-m${i}`, barcode: `M${i}b`, unitWeight: 7 }));
    }
    src.push(base({ posProductKey: "pos-u", barcode: "U1" }), base({ posProductKey: "pos-u", barcode: "U2" }));
    const plan = planImportLots(src);
    const keys = mixedSizeKeysFromDiagnostics(plan.diagnostics.map((d) => ({ code: d.code, context_json: d.context })));
    expect(keys).toEqual(Array.from({ length: 12 }, (_, i) => `pos-m${i}`));
  });

  it("every active lot of every flagged card is on the sheet; nothing else; nothing deferred", async () => {
    st.diagnostics = [
      { id: 1, import_id: IMPORT, code: "import_lots_mixed_size_cards", context_json: { cards: ["A"], total: 2, keys: ["pos-a", "pos-b", "pos-gone"] } },
      { id: 2, import_id: OTHER_IMPORT, code: "import_lots_mixed_size_cards", context_json: { keys: ["pos-other"] } },
      { id: 3, import_id: IMPORT, code: "some_other_code", context_json: { keys: ["pos-x"] } },
    ];
    st.lots = [
      dbLot("a1", "pos-a"), dbLot("a2", "pos-a"), dbLot("a3", "pos-a"),
      dbLot("b1", "pos-b"),
      dbLot("b-old", "pos-b", "archived"),
      dbLot("o1", "pos-other"), dbLot("x1", "pos-x"), dbLot("n1", "pos-not-flagged"),
    ];
    const { proposeFlaggedScope } = await import("@/lib/inventory/audit-hub-store");
    const r = await proposeFlaggedScope(IMPORT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lotIds = r.data.plan.groups.flatMap((g) => g.lots.map((l) => l.lot.lotId)).sort();
    expect(lotIds).toEqual(["a1", "a2", "a3", "b1"]);
    expect(r.data.plan.groups.map((g) => g.productKey).sort()).toEqual(["pos-a", "pos-b"]);
    expect(r.data.plan.deferredGroups).toBe(0);
    expect(r.data.plan.lotCount).toBe(4);
    expect(r.data.flaggedKeys).toBe(3);
    expect(r.data.keysWithoutActiveLots).toBe(1); // pos-gone sold through
    expect(r.data.found).toBe(true);
    // Only active lots were asked for.
    expect(st.queries.some((q) => q.startsWith("inventory_lots") && q.includes('["status","active"]'))).toBe(true);
  });

  it("scales past the 1000-row cap: 1200 flagged cards, 2400 lots, all loaded", async () => {
    const keys = Array.from({ length: 1200 }, (_, i) => `pos-k${i}`);
    st.diagnostics = [{ id: 1, import_id: IMPORT, code: "import_lots_mixed_size_cards", context_json: { keys } }];
    st.lots = keys.flatMap((k) => [dbLot(`${k}-1`, k), dbLot(`${k}-2`, k)]);
    const { proposeFlaggedScope } = await import("@/lib/inventory/audit-hub-store");
    const r = await proposeFlaggedScope(IMPORT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.plan.lotCount).toBe(2400);
    expect(r.data.plan.groups.length).toBe(1200);
    expect(r.data.plan.deferredGroups).toBe(0);
    expect(r.data.keysWithoutActiveLots).toBe(0);
  });

  it("a failed lot page refuses; it never becomes a silently smaller count", async () => {
    st.diagnostics = [{ id: 1, import_id: IMPORT, code: "import_lots_mixed_size_cards", context_json: { keys: ["pos-a"] } }];
    st.lots = [dbLot("a1", "pos-a")];
    st.failLots = true;
    const { proposeFlaggedScope } = await import("@/lib/inventory/audit-hub-store");
    const r = await proposeFlaggedScope(IMPORT);
    expect(r.ok).toBe(false);
  });

  it("an import with no key list says so (found=false) and loads nothing", async () => {
    st.diagnostics = [{ id: 1, import_id: IMPORT, code: "import_lots_mixed_size_cards", context_json: { cards: ["A"], total: 1 } }];
    st.lots = [dbLot("a1", "pos-a")];
    const { proposeFlaggedScope } = await import("@/lib/inventory/audit-hub-store");
    const r = await proposeFlaggedScope(IMPORT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.found).toBe(false);
    expect(r.data.plan.lotCount).toBe(0);
  });

  it("the pure scope ignores due-ness and the budget (the planner's defaults would drop fresh lots)", () => {
    const lot = (id: string, key: string): AuditLot => ({
      lotId: id, lotCode: id, posProductKey: key, productName: key, categorySlug: "flower", vendorId: null, vendorName: null,
      onHandQty: 1, unitCostMinorUnits: 1, lastCountedAt: new Date().toISOString(), priorVarianceCount: 0, status: "active",
    });
    const lots = Array.from({ length: 60 }, (_, i) => lot(`l${i}`, `k${i % 30}`));
    const scope = scopeFromProductKeys(Array.from({ length: 30 }, (_, i) => `k${i}`), lots);
    const plan = buildAuditPlan(lots, new Date(), scope.planOptions);
    expect(plan.lotCount).toBe(60);
    expect(plan.deferredGroups).toBe(0);
    // Contrast: the ordinary due-only plan would count none of them.
    expect(buildAuditPlan(lots, new Date(), { maxLots: 40 }).lotCount).toBe(0);
  });

  it("the fix link and the New Count page are wired to each other", () => {
    expect(countFlaggedProductsHref(IMPORT)).toBe(`/admin/inventory/audits/new?fromImport=${IMPORT}`);
    const page = read("src/app/admin/inventory/audits/new/page.tsx");
    expect(page).toContain("fromImport?: string");
    expect(page).toContain("proposeFlaggedScope(fromImport)");
    expect(page).toContain('data-testid="flagged-scope-banner"');
    const actions = read("src/app/admin/inventory/audits/actions.ts");
    expect(actions).toContain("isImportId(fromImportRaw)");
    expect(actions).toContain('path.includes("?") ? "&" : "?"');
  });
});

// ─── 5. wiring ───────────────────────────────────────────────────────────────

describe("R14b — wiring", () => {
  it("the import page renders the Type & category check with its actions", () => {
    const page = read("src/app/admin/menu-imports/[id]/page.tsx");
    for (const id of ["type-check", "type-check-group", "type-check-add-type", "type-check-refile", "type-check-open", "type-check-refiled"]) {
      expect(page).toContain(`data-testid="${id}"`);
    }
    expect(page).toContain("inventoryType: i.pos_inventory_type");
    expect(page).toContain("category: i.pos_inventory_category");
    expect(page).toContain('const canRefile = can(session.profile.role, "inventory.manage");');
    expect(page).toContain('g.verdict === "category_suspect" && r.suggestion && canRefile');
  });
  it("the re-file action is guarded, scoped to the import, validated, audited and refreshes the live menu", () => {
    const a = read("src/app/admin/menu-imports/actions.ts");
    const fn = a.slice(a.indexOf("export async function refileFromTypeCheck"));
    expect(fn).toContain('requirePermission("inventory.manage")');
    expect(fn).toContain('.from("menu_versions").select("id").eq("import_id", importId)');
    expect(fn).toContain('.eq("source_item_id", sourceItemId)');
    expect(fn).toContain("That product is not part of this import.");
    expect(fn).toContain("isValidWebsiteCategory(v)");
    expect(fn).toContain("listInventoryTypes({ includeInactive: false })");
    expect(fn).toContain("note: current?.note ?? null");
    expect(fn).toContain("action: TYPE_CHECK_REFILE_AUDIT");
    expect(fn).toContain("revalidatePublicMenuSurfaces()");
    // The audit row comes after a successful write, never before.
    expect(fn.indexOf("if (!result.ok)")).toBeLessThan(fn.indexOf("await recordAudit("));
  });
  it("the fact decision keeps the focus after saving", () => {
    const a = read("src/app/admin/menu-imports/actions.ts");
    expect(a.replace(/\s+/g, " ")).toContain('savedRedirectSuffix( parseFactFocus({ group: formData.get("focusGroup"), q: formData.get("focusQ") }), )');
    // R35 #4: the serving-limit warning param sits before the focus anchor
    // (the "#..." fragment must stay last or the param is lost).
    expect(a).toContain('if (focusSuffix) redirect(dest + "?saved=1" + warnSuffix + focusSuffix);');
    const facts = read("src/app/admin/menu-imports/[id]/facts/page.tsx");
    expect(facts).toContain("group?: string");
    expect(facts).toContain("q?: string");
    for (const id of ["facts-group-one-at-a-time", "facts-focus-form", "facts-focus-clear", "facts-focus-reason", "facts-name-suggestions", "facts-use-name-values"]) {
      expect(facts).toContain(`data-testid="${id}"`);
    }
  });
  it("the Types page reads the suggestion and only prefills an active category", () => {
    const t = read("src/app/admin/settings/types/page.tsx");
    expect(t).toContain("suggest?: string");
    expect(t).toContain('data-testid="type-focus-suggest"');
    expect(t).toContain('defaultValue={prefill?.label ?? ""}');
    expect(t).toContain('defaultValue={prefill?.category ?? ""}');
    // The suggestion is trusted only when it is an ACTIVE registry category, and only for a type not yet listed.
    expect(t).toContain('category: activeCategories.some((c) => c.value === suggestCategory) ? suggestCategory : "",');
    expect(t).toContain("focusType && !focusFound");
  });
  it("the three new cores are in the pure runner with floors", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runFlaggedCountScopeCoreTests } from "../../src/lib/inventory/flagged-count-scope-core";');
    expect(runner).toContain('import { __runCultiveraTypeFromCategoryCoreTests } from "../../src/lib/pos/cultivera-type-from-category-core";');
    expect(runner).toContain('import { __runFactReviewFocusCoreTests } from "../../src/lib/pos/fact-review-focus-core";');
    expect(runner).toContain("r.passed < 18) throw new Error(`flagged-count-scope-core");
    expect(runner).toContain("r.passed < 132) throw new Error(`cultivera-type-from-category-core");
    expect(runner).toContain("r.passed < 33) throw new Error(`fact-review-focus-core");
  });
  it("the env ledger records R14b as adding no variable", () => {
    const ledger = read("docs/INTAKE_PIPELINE_ENV_LEDGER.md");
    expect(ledger).toContain("S33 (and the Round 14 change sets R14a and R14b). Their bible");
    expect(ledger).toContain("- (R14b needs nothing set.");
  });
});
