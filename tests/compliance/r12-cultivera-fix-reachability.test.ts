/**
 * tests/compliance/r12-cultivera-fix-reachability.test.ts  (Round 12)
 *
 * Owner, Round 12: "make sure that the products from the Cultivera upload
 * specifically can reach the fix pages. These are the products that will need
 * the fix pages and logic … Please make sure they will be included in what I
 * can fix."
 *
 * Proven here, behaviourally where possible:
 *   1. The product-page Visibility control now changes the LIVE menu rows
 *      (menu_items.hidden) on the published + staged versions — the thing the
 *      website, the register feed and the sellability report read. Before,
 *      it wrote only product_enrichments.hidden_override, which nothing on the
 *      live path reads (mergeForDisplay has no callers), so the hidden_card
 *      fix link "Un-hide on the product page" did nothing for the Cultivera
 *      cards the importer hid (no_product_master / no_inventory).
 *   2. "Inherit POS" restores EXACTLY what the importer wrote, and an owner
 *      override never drops a product off the missing-product-master rep sheet.
 *   3. The lot-gap issue rows for the three import-blank fields offer Bulk fill
 *      with the field preselected, and Bulk fill really accepts those lots.
 *   4. The lot page gives a Cultivera-import lot a callout whose links land on
 *      Bulk fill for exactly its blank fields, plus a real manifest link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  rows: [] as { id: string; menu_version_id: string; source_item_id: string; hidden: boolean; hidden_reason: string | null }[],
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  selectFilters: [] as string[],
  published: { id: "v-pub" } as { id: string } | null,
  staged: [{ id: "v-stg" }] as { id: string }[],
  failUpdate: false,
  configured: true,
}));

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return h.configured;
  },
}));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => h.published,
  listIntakeStagedVersions: async () => h.staged,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("menu_items");
      return {
        select: () => {
          let versions: string[] = [];
          let key = "";
          const q = {
            in(col: string, vals: string[]) {
              h.selectFilters.push(`in:${col}`);
              versions = vals;
              return q;
            },
            eq(col: string, val: string) {
              h.selectFilters.push(`eq:${col}`);
              key = val;
              return q;
            },
            then(res: (v: unknown) => void) {
              res({
                data: h.rows.filter((r) => versions.includes(r.menu_version_id) && r.source_item_id === key),
                error: null,
              });
            },
          };
          return q;
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (col: string, id: string) => {
            expect(col).toBe("id");
            if (h.failUpdate) return { error: { message: "boom" } };
            h.updates.push({ id, patch });
            const row = h.rows.find((r) => r.id === id);
            if (row) Object.assign(row, patch);
            return { error: null };
          },
        }),
      };
    },
  }),
}));

const { applyProductVisibility } = await import("@/lib/enrichment/product-visibility-store");
import {
  __runProductVisibilityCoreTests,
  posStateOf,
} from "@/lib/enrichment/product-visibility-core";
import { __runMigrationLotFixCoreTests, migrationLotCallout, lotManifestHref } from "@/lib/inventory/migration-lot-fix-core";
import { buildInventoryIssues } from "@/lib/admin/issues-core";
import { planBulkFill, MIGRATION_MARKER } from "@/lib/inventory/bulk-fill-core";
import { buildMissingProductMasterWorklist, menuItemRowToMissingMasterItem } from "@/lib/pos/missing-product-master-core";
import { hiddenReasonText } from "@/lib/pos/fact-review-core";
import { fixLinkForLot } from "@/lib/inventory/blocked-stock-fix-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

beforeEach(() => {
  h.rows = [
    // A Cultivera card the importer hid (no Products-file row), on both versions.
    { id: "i-pub", menu_version_id: "v-pub", source_item_id: "pos-abc", hidden: true, hidden_reason: "no_product_master" },
    { id: "i-stg", menu_version_id: "v-stg", source_item_id: "pos-abc", hidden: true, hidden_reason: "no_product_master" },
    // A different product and an archived version that must never be touched.
    { id: "i-other", menu_version_id: "v-pub", source_item_id: "pos-zzz", hidden: true, hidden_reason: "no_inventory" },
    { id: "i-arch", menu_version_id: "v-old", source_item_id: "pos-abc", hidden: true, hidden_reason: "no_product_master" },
  ];
  h.updates = [];
  h.selectFilters = [];
  h.published = { id: "v-pub" };
  h.staged = [{ id: "v-stg" }];
  h.failUpdate = false;
  h.configured = true;
});

describe("R12 — pure cores (pinned counts, registered in the runner)", () => {
  it("product-visibility-core", () => {
    expect(__runProductVisibilityCoreTests()).toEqual({ passed: 37, failed: 0 });
  });
  it("migration-lot-fix-core", () => {
    expect(__runMigrationLotFixCoreTests()).toEqual({ passed: 25, failed: 0 });
  });
  it("both are registered", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("const r = __runProductVisibilityCoreTests();");
    expect(src).toContain("const r = __runMigrationLotFixCoreTests();");
  });
});

describe("R12 — Visibility now changes the live menu (the hidden_card fix works)", () => {
  it("Always show un-hides the Cultivera card on the published AND staged versions only", async () => {
    const r = await applyProductVisibility("pos-abc", "show");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rowsSeen).toBe(2);
    expect(r.changed.map((c) => [c.itemId, c.versionStatus]).sort()).toEqual([
      ["i-pub", "published"],
      ["i-stg", "staged"],
    ]);
    expect(h.rows.find((x) => x.id === "i-pub")).toMatchObject({ hidden: false, hidden_reason: "owner_override_show:no_product_master" });
    expect(h.rows.find((x) => x.id === "i-stg")?.hidden).toBe(false);
    // Never another product, never an archived version.
    expect(h.rows.find((x) => x.id === "i-other")?.hidden).toBe(true);
    expect(h.rows.find((x) => x.id === "i-arch")?.hidden_reason).toBe("no_product_master");
    expect(h.selectFilters).toEqual(["in:menu_version_id", "eq:source_item_id"]);
  });

  it("Inherit POS puts back exactly what the importer wrote", async () => {
    await applyProductVisibility("pos-abc", "show");
    const r = await applyProductVisibility("pos-abc", "inherit");
    expect(r.ok && r.changed.length).toBe(2);
    expect(h.rows.find((x) => x.id === "i-pub")).toMatchObject({ hidden: true, hidden_reason: "no_product_master" });
    expect(h.rows.find((x) => x.id === "i-stg")).toMatchObject({ hidden: true, hidden_reason: "no_product_master" });
  });

  it("Inherit on a never-overridden card writes nothing (no churn)", async () => {
    const r = await applyProductVisibility("pos-abc", "inherit");
    expect(r.ok && r.changed.length).toBe(0);
    expect(h.updates).toEqual([]);
  });

  it("works with no staged versions, and with nothing published", async () => {
    h.staged = [];
    let r = await applyProductVisibility("pos-abc", "show");
    expect(r.ok && r.changed.map((c) => c.itemId)).toEqual(["i-pub"]);
    h.published = null;
    h.staged = [];
    r = await applyProductVisibility("pos-abc", "hide");
    expect(r).toEqual({ ok: true, changed: [], rowsSeen: 0 });
  });

  it("reports failures instead of throwing, and refuses a blank key / unconfigured DB", async () => {
    h.failUpdate = true;
    const r = await applyProductVisibility("pos-abc", "show");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("boom");
    expect(await applyProductVisibility("  ", "show")).toEqual({ ok: false, error: "Missing product key." });
    h.failUpdate = false;
    h.configured = false;
    const u = await applyProductVisibility("pos-abc", "show");
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.error).toContain("isn't configured");
  });

  it("the save action calls the live write, audits it and refreshes the public menu", () => {
    const src = code("src/app/admin/products/actions.ts");
    const save = src.slice(src.indexOf("export async function updateProductEnrichment"), src.indexOf("export async function setEnrichmentStatus"));
    expect(save).toContain("const visResult = await applyProductVisibility(key, vis);");
    expect(save).toContain('action: "product.visibility_changed"');
    expect(save).toContain("revalidatePublicMenuSurfaces();");
    expect(save).toContain("update.hidden_override = hiddenOverrideFor(vis);");
    // The live write happens BEFORE the success redirect.
    expect(save.indexOf("applyProductVisibility(")).toBeLessThan(save.indexOf("?saved=1"));
  });

  it("the product page shows the live state read from menu_items", () => {
    const src = read("src/app/admin/products/[key]/page.tsx");
    expect(src).toContain('data-testid="visibility-live-state"');
    expect(src).toContain("liveVisibilityText({ hidden: item.hidden === true, hidden_reason: item.hidden_reason ?? null })");
  });

  it("the hidden_card fix link still lands on that control", () => {
    expect(fixLinkForLot("hidden_card", "lot-1", "pos-abc").href).toBe("/admin/products/pos-abc");
  });
});

describe("R12 — overrides never corrupt the other readers of hidden_reason", () => {
  const worklistCount = (hidden: boolean, reason: string | null) =>
    buildMissingProductMasterWorklist([
      menuItemRowToMissingMasterItem(
        {
          source_item_id: "pos-x", name: "X", product_name: null, brand_name: "B", category: "flower",
          pos_inventory_type: null, pos_inventory_category: null, strain_name: null, strain_type: "hybrid",
          hidden, hidden_reason: reason,
        },
        [],
      ),
    ]).rows.length;

  it("an owner-shown master-less product stays on the Cultivera rep sheet", () => {
    expect(worklistCount(true, "no_product_master")).toBe(1);
    expect(worklistCount(false, "owner_override_show:no_product_master")).toBe(1);
    expect(worklistCount(true, "owner_override_hide:")).toBe(0);
  });

  it("the facts page counts by the importer's state too", () => {
    const src = read("src/app/admin/menu-imports/[id]/facts/page.tsx");
    expect(src).toContain("const pos = posStateOf({ hidden: i.hidden, hidden_reason: i.hidden_reason });");
    expect(src).toContain("return pos.hidden && pos.hidden_reason === NO_PRODUCT_MASTER;");
    expect(src).not.toContain("return i.hidden && i.hidden_reason === NO_PRODUCT_MASTER;");
  });

  it("the reviewer un-hide still only matches its own reason", () => {
    const src = code("src/lib/pos/fact-review-store.ts");
    expect(src).toContain('.eq("hidden_reason", "reviewer_rejected");');
  });

  it("an owner hide is explained in plain English", () => {
    expect(hiddenReasonText("owner_override_hide:no_inventory")).toBe(
      "Hidden by the owner on the product page (the import had: In the products file but has no inventory rows -- nothing to sell yet.).",
    );
    expect(hiddenReasonText("owner_override_hide:")).toBe("Hidden by the owner on the product page.");
    expect(hiddenReasonText("owner_override_hide:~")).toBe("Hidden by the owner on the product page.");
    expect(posStateOf({ hidden: false, hidden_reason: "owner_override_show:~" })).toEqual({ hidden: true, hidden_reason: null });
  });
});

describe("R12 — gap rows open Bulk fill, and Bulk fill accepts Cultivera lots", () => {
  const issues = buildInventoryIssues({
    blockedByCause: null,
    receivedDateFlag: null,
    receivedMissingWithStock: 0,
    intelExpiredRows: 0,
    restorableCount: 0,
    gaps: [
      { key: "missingExpiry", label: "no expiry", count: 3, href: "/admin/inventory?status=active&missingExpiry=1", weight: 2 },
      { key: "unknownCost", label: "no cost", count: 3, href: "/admin/inventory?status=active&unknownCost=1", weight: 2 },
      { key: "missingProductLink", label: "no link", count: 3, href: "/admin/inventory?status=active&missingProductLink=1", weight: 1 },
      { key: "missingCoa", label: "no coa", count: 3, href: "/admin/inventory?status=active&coa=no", weight: 3 },
    ],
  } as Parameters<typeof buildInventoryIssues>[0]);

  const lot = {
    id: "l1",
    notes: `${MIGRATION_MARKER} Received 2026-09-01.`,
    status: "active",
    expires_on: null,
    unit_cost_minor_units: null,
    pos_product_key: "",
    product_name: "Blue Dream",
  };

  it.each([
    ["missingExpiry", "expires_on", "2027-06-01"],
    ["unknownCost", "unit_cost_minor_units", "4.50"],
    ["missingProductLink", "pos_product_key", "pos-abc"],
  ] as const)("%s → Bulk fill %s, and a Cultivera lot is fillable", (gap, field, raw) => {
    const extra = issues.find((i) => i.code === `gap_${gap}`)?.extra?.[0];
    expect(extra?.href).toBe(`/admin/inventory?status=active&${gap}=1&bulk=1&bulkField=${field}`);
    const url = new URL(extra!.href, "http://x");
    expect(url.searchParams.get("bulkField")).toBe(field);
    const plan = planBulkFill({ field, rawValue: raw, lots: [lot], todayPacific: "2026-09-10" });
    expect(plan.ok && plan.apply.map((a) => a.lotId)).toEqual(["l1"]);
  });

  it("missing COA stays honest (no bulk link; roadmap named)", () => {
    const coa = issues.find((i) => i.code === "gap_missingCoa");
    expect(coa?.extra).toBeUndefined();
    expect(coa?.meaning).toContain("COA spreadsheet import for them is on the roadmap");
  });

  it("the Inventory page reads every param these links carry", () => {
    const src = read("src/app/admin/inventory/page.tsx");
    for (const k of ["bulk?: string", "bulkField?: string", "missingExpiry?: string", "unknownCost?: string", "missingProductLink?: string", "q?: string", "status?: string"]) {
      expect(src).toContain(k);
    }
  });
});

describe("R12 — the lot page points a Cultivera lot at its fixes", () => {
  it("renders the callout and a real manifest link", () => {
    const src = read("src/app/admin/inventory/[id]/page.tsx");
    expect(src).toContain("const migrationCallout = migrationLotCallout(lot);");
    expect(src).toContain('data-testid="migration-lot-callout"');
    expect(src).toContain('data-testid="migration-lot-fix"');
    expect(src).toContain('data-testid="lot-manifest-link"');
    expect(src).toContain("href={lotManifestHref(lot.manifest_id)!}");
  });

  it("a typical Cultivera lot gets expiry + cost links that Bulk fill accepts", () => {
    const c = migrationLotCallout({
      id: "l1",
      notes: `${MIGRATION_MARKER} x`,
      status: "active",
      lot_code: "WA1",
      pos_product_key: "pos-abc",
      expires_on: null,
      unit_cost_minor_units: null,
      lab_result_id: null,
      product_name: "P",
    })!;
    expect(c.links.map((l) => l.field)).toEqual(["expires_on", "unit_cost_minor_units"]);
    for (const l of c.links) {
      const u = new URL(l.href, "http://x");
      expect(u.pathname).toBe("/admin/inventory");
      expect(u.searchParams.get("bulk")).toBe("1");
      expect(u.searchParams.get("q")).toBe("WA1");
    }
    expect(lotManifestHref("m-9")).toBe("/admin/inventory/intake/m-9");
  });
});
