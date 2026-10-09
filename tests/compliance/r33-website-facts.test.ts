/**
 * tests/compliance/r33-website-facts.test.ts  (R33, T-329)
 *
 * The customer-facing half of R33:
 *   1. product-facts-overlay-server: the REAL read over postgrest-js (narrow
 *      JSON-path select of the terpene fact, approved drafts only, the
 *      published version's reviewer-stamped cards via the JSON ->> filter),
 *      degrades to "no overlay" on any failure.
 *   2. withMenuProfile end-to-end: the product's OWN lab terpenes beat the
 *      strain library's list; a person's strain type is never replaced by
 *      the library; a library-typed card still gets the library's correction.
 *   3. withCategoryOverride: the owner's website TYPE re-file (house_type)
 *      now reaches the item, after the category re-file.
 *   4. ProductDetailPurchasePanel: brand-green Add to Cart; single-size line.
 *   5. productSchema weight (schema.org QuantitativeValue, GRM).
 *   6. Wiring pins: PDP / home / specials order, size chip, lot page form key
 *      + drift notice, /menu/[category] revalidation, facts-fix mirror refresh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Req = { method: string; url: URL };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL }>,
  route: null as null | ((r: { method: string; url: URL }) => { status: number; body?: unknown } | undefined),
  kb: [] as unknown[],
  overrides: new Map<string, { pos_product_key: string; website_category: string | null; house_type: string | null; note: string | null }>(),
  cart: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: <T,>(fn: T) => fn,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const r = { method: init?.method ?? "GET", url };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(rep.body ?? []), { status: rep.status, headers: { "content-type": "application/json" } });
  };
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }) };
});
vi.mock("@/lib/ai/kb/store", () => ({ listKbStrains: async () => net.kb }));
vi.mock("@/lib/pos/product-classification-overrides", () => ({
  getOverridesForKeys: async (keys: string[]) => new Map([...net.overrides].filter(([k]) => keys.includes(k))),
}));
vi.mock("@/components/cart/CartProvider", () => ({ useMockCart: () => ({ addItem: (x: unknown) => net.cart.push(x) }) }));
vi.mock("@/components/promotions/PublishedRulesProvider", () => ({ useActiveDealRules: () => undefined }));
vi.mock("@/lib/specials/useStoreWeekday", () => ({ useStoreWeekday: () => undefined }));

import { buildProductFactsOverlayUncached, withProductFacts } from "@/lib/menu/product-facts-overlay-server";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { withCategoryOverride } from "@/lib/menu/menu-category-override-server";
import { ProductDetailPurchasePanel } from "@/components/menu/ProductDetailPurchasePanel";
import { productSchema } from "@/lib/seo/seo";
import { productSchemaWeight } from "@/lib/menu/pdp-size-core";
import { PUBLIC_MENU_PAGE_PATTERNS } from "@/lib/site/public-surfaces";

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";

function item(over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return {
    id: "KEY-BD",
    name: "Blue Dream 3.5g",
    brand: "Brand",
    category: "flower",
    strainType: "indica",
    strainName: "Blue Dream",
    thc: "22",
    cbd: null,
    priceLabel: "$30.00",
    priceMinorUnits: 3000,
    variants: [{ id: "KEY-BD-3.5g", label: "3.5g", priceMinorUnits: 3000, inventoryLevel: 5, medical: false }],
    ...over,
  } as unknown as GreenwayMenuItem;
}

const coaTerps = (names: string[]) => ({ value: names, source: "coa", confidence: null });

/** The overlay's two reads: approved drafts (JSON-path select) + reviewer cards. */
function routeOverlay(opts: { drafts?: unknown[]; reviewer?: unknown[]; failDrafts?: boolean; noVersion?: boolean }) {
  net.route = (r) => {
    const t = table(r);
    if (t === "catalog_product_drafts") return opts.failDrafts ? { status: 500, body: { message: "down" } } : { status: 200, body: opts.drafts ?? [] };
    if (t === "menu_versions") return opts.noVersion ? { status: 406, body: { code: "PGRST116", message: "none" } } : { status: 200, body: { id: "v-pub" } };
    if (t === "menu_items") return { status: 200, body: opts.reviewer ?? [] };
    return undefined;
  };
}

beforeEach(() => {
  net.reqs.length = 0;
  net.route = null;
  net.kb = [];
  net.overrides = new Map();
  net.cart.length = 0;
});

// === 1. The overlay read ======================================================
describe("R33 product-facts overlay server read", () => {
  it("asks for ONLY the terpene fact of APPROVED drafts, paged in a stable order", async () => {
    routeOverlay({ drafts: [{ id: "d1", pos_product_key: "KEY-BD", terpenes: coaTerps(["limonene 0.5%"]), updated_at: "2026-01-01" }] });
    const ov = await buildProductFactsOverlayUncached();
    const q = net.reqs.find((r) => table(r) === "catalog_product_drafts")!;
    expect(q.url.searchParams.get("select")).toBe("id,pos_product_key,terpenes:attached_facts->terpenes,updated_at");
    expect(q.url.searchParams.get("status")).toBe("eq.approved");
    expect(q.url.searchParams.get("order")).toBe("id.asc");
    expect(q.url.searchParams.get("offset")).toBe("0");
    expect(ov.terpenes).toEqual([["KEY-BD", ["limonene"]]]);
  });

  it("reads reviewer-stamped cards of the PUBLISHED version through the JSON ->> filter", async () => {
    routeOverlay({ reviewer: [{ id: "c1", source_item_id: "KEY-BD" }, { id: "c2", source_item_id: null }] });
    const ov = await buildProductFactsOverlayUncached();
    const v = net.reqs.find((r) => table(r) === "menu_versions")!;
    expect(v.url.searchParams.get("status")).toBe("eq.published");
    const q = net.reqs.find((r) => table(r) === "menu_items")!;
    expect(q.url.searchParams.get("menu_version_id")).toBe("eq.v-pub");
    expect(q.url.searchParams.get("fact_provenance->>strain_type")).toBe("eq.reviewer");
    expect(ov.reviewerStrain).toEqual(["KEY-BD"]);
  });

  it("no published version -> no reviewer read; failed draft read -> no terpenes; never throws", async () => {
    routeOverlay({ noVersion: true, failDrafts: true });
    const ov = await buildProductFactsOverlayUncached();
    expect(ov).toEqual({ terpenes: [], reviewerStrain: [] });
    expect(net.reqs.some((r) => table(r) === "menu_items")).toBe(false);
  });

  it("an unreadable database leaves items untouched (identity)", async () => {
    net.route = () => ({ status: 500, body: { message: "down" } });
    const items = [item()];
    const out = await withProductFacts(items);
    expect(out[0]).toBe(items[0]);
  });
});

// === 2. withMenuProfile end-to-end ===========================================
describe("R33 withMenuProfile: the product's own facts beat the strain library", () => {
  const kbBlueDream = { id: "k1", slug: "blue-dream", name: "Blue Dream", strain_type: "sativa", aroma_notes: null, flavor_notes: null, terpenes: ["myrcene", "pinene"], active: true, aliases: [] };

  it("own COA terpenes win; reviewer strain type is never replaced by the library", async () => {
    net.kb = [kbBlueDream];
    routeOverlay({
      drafts: [{ id: "d1", pos_product_key: "KEY-BD", terpenes: coaTerps(["terpinolene 0.9%", "ocimene 0.3%"]), updated_at: "2026-02-01" }],
      reviewer: [{ id: "c1", source_item_id: "KEY-BD" }],
    });
    const [out] = await withMenuProfile([item()]);
    expect(out.terpenes).toEqual(["terpinolene", "ocimene"]);
    expect(out.strainType).toBe("indica");
    expect(out.strainTypeSource).toBe("reviewer");
  });

  it("CONTROL: without the reviewer stamp the library still corrects the type (unchanged behaviour)", async () => {
    net.kb = [kbBlueDream];
    routeOverlay({});
    const [out] = await withMenuProfile([item()]);
    expect(out.strainType).toBe("sativa");
    expect(out.terpenes).toEqual(["myrcene", "pinene"]);
  });

  it("a product whose strain is NOT in the library now shows its own lab terpenes (the missing pills)", async () => {
    routeOverlay({ drafts: [{ id: "d1", pos_product_key: "KEY-X", terpenes: coaTerps(["limonene 1.1%", "linalool 0.2%"]), updated_at: "2026-02-01" }] });
    const [out] = await withMenuProfile([item({ id: "KEY-X", strainName: "Totally Unlisted Cut #7" })]);
    expect(out.terpenes).toEqual(["limonene", "linalool"]);
  });

  it("a mastered card picks up a lot's terpenes through its '<key>-onboarded' variant", async () => {
    routeOverlay({ drafts: [{ id: "d1", pos_product_key: "LOT-9", terpenes: coaTerps(["humulene"]), updated_at: "2026-02-01" }] });
    const [out] = await withMenuProfile([
      item({ id: "MASTER", strainName: "Unlisted", variants: [{ id: "LOT-9-onboarded", label: "1g", priceMinorUnits: 1000, inventoryLevel: 1, medical: false }] }),
    ]);
    expect(out.terpenes).toEqual(["humulene"]);
  });
});

// === 3. house_type override ===================================================
describe("R33 withCategoryOverride applies the website TYPE re-file", () => {
  it("house_type becomes the item's type label (website category unchanged)", async () => {
    net.overrides.set("KEY-BD", { pos_product_key: "KEY-BD", website_category: null, house_type: "Popcorn Bud", note: null });
    const [out] = await withCategoryOverride([item({ posInventoryCategory: "Flower" })]);
    expect(out.posInventoryCategory).toBe("Popcorn Bud");
    expect(out.category).toBe("flower");
  });
  it("a raw-label type re-derives the cross-listing filters (Blunt -> blunt)", async () => {
    net.overrides.set("KEY-BD", { pos_product_key: "KEY-BD", website_category: null, house_type: "Blunt", note: null });
    const [out] = await withCategoryOverride([item({ posInventoryCategory: "Flower", filterCategories: ["flower"] })]);
    expect([...(out.filterCategories ?? [])].sort()).toEqual(["blunt", "flower"]);
  });
  it("category AND type together: category first, then the type label on top", async () => {
    net.overrides.set("KEY-BD", { pos_product_key: "KEY-BD", website_category: "preroll", house_type: "Blunt", note: null });
    const [out] = await withCategoryOverride([item({ posInventoryCategory: "Flower" })]);
    expect(out.category).toBe("preroll");
    expect(out.posInventoryCategory).toBe("Blunt");
    expect([...(out.filterCategories ?? [])].sort()).toEqual(["blunt", "preroll"]);
  });
  it("no override -> identity", async () => {
    const items = [item()];
    expect((await withCategoryOverride(items))[0]).toBe(items[0]);
  });
});

// === 4. Purchase panel =======================================================
describe("R33 ProductDetailPurchasePanel", () => {
  const html = (i: GreenwayMenuItem) => renderToStaticMarkup(createElement(ProductDetailPurchasePanel, { item: i }));

  it("Add to Cart is the brand green (var(--greenway)), disabled styles kept, old pale green gone", () => {
    const out = html(item());
    const btn = out.slice(out.lastIndexOf("<button"));
    expect(btn).toContain("Add to Cart - $30.00");
    expect(btn).toContain("bg-[var(--greenway)]");
    expect(btn).toContain("disabled:bg-zinc-700");
    expect(btn).not.toContain("#d8e6c4");
  });

  it("a single-size flower shows its size (no size buttons render for one size)", () => {
    const out = html(item());
    expect(out).toContain('data-testid="pdp-single-size"');
    expect(out).toContain("3.5 g (1/8 oz)");
    expect(out).not.toContain('aria-label="Select package size"');
  });

  it("several sizes: the buttons show them; no single-size line", () => {
    const out = html(
      item({
        variants: [
          { id: "a", label: "1g", priceMinorUnits: 1000, inventoryLevel: 5, medical: false },
          { id: "b", label: "3.5g", priceMinorUnits: 3000, inventoryLevel: 5, medical: false },
        ],
      }),
    );
    expect(out).toContain('aria-label="Select package size"');
    expect(out).not.toContain("pdp-single-size");
  });

  it("no real size ('each', or the synthetic default variant) -> nothing invented", () => {
    expect(html(item({ variants: [{ id: "e", label: "each", priceMinorUnits: 1000, inventoryLevel: 5, medical: false }] }))).not.toContain("pdp-single-size");
    expect(html(item({ variants: [], priceLabel: "$30.00 3.5g" }))).not.toContain("pdp-single-size");
  });

  it("a single-size liquid keeps the SLICE 98 fl oz display", () => {
    const out = html(item({ category: "edible-liquid", variants: [{ id: "l", label: "355ml", priceMinorUnits: 800, inventoryLevel: 5, medical: false }] }));
    expect(out).toContain("12 fl oz");
  });

  it("the merch detail button is green too", () => {
    const src = read("src/components/merch/MerchDetailPanel.tsx");
    expect(src).toContain("bg-[var(--greenway)] px-5");
    expect(src).not.toContain("#d8e6c4");
  });
});

// === 5. JSON-LD weight =======================================================
describe("R33 productSchema weight", () => {
  it("single size -> schema.org QuantitativeValue in grams (GRM)", () => {
    const s = productSchema({ id: "KEY-BD", name: "Blue Dream", category: "flower", priceMinorUnits: 3000, weight: productSchemaWeight(item()) } as Parameters<typeof productSchema>[0]);
    expect(s.weight).toEqual({ "@type": "QuantitativeValue", value: 3.5, unitCode: "GRM" });
  });
  it("several sizes -> no single JSON-LD weight (the buttons carry each size)", () => {
    const multi = item({
      variants: [
        { id: "a", label: "1g", priceMinorUnits: 1000, inventoryLevel: 5, medical: false },
        { id: "b", label: "3.5g", priceMinorUnits: 3000, inventoryLevel: 5, medical: false },
      ],
    });
    expect(productSchemaWeight(multi)).toBeNull();
  });
  it("no weight -> the key is absent (never a null in JSON-LD)", () => {
    const s = productSchema({ id: "KEY-BD", name: "Blue Dream", category: "flower", priceMinorUnits: 3000, weight: null } as Parameters<typeof productSchema>[0]);
    expect("weight" in s).toBe(false);
  });
});

// === 6. Wiring pins ==========================================================
describe("R33 wiring", () => {
  const pdp = read("src/app/menu/products/[id]/page.tsx");
  it("PDP: category/type override + DOH + profile on the item and the related rail", () => {
    expect(pdp).toContain("await withCategoryOverride(await withDohCompliance(await withMenuProfile(await withResolvedImages([baseItem]))))");
    expect(pdp).toContain("withCategoryOverride(await withMenuProfile(await loadLiveMenuItemsCached()))");
  });
  it("PDP: size chip only when the ratio-led net-weight chip is absent; JSON-LD weight never for non-cannabis", () => {
    expect(pdp).toContain("showCannabinoids && !detailNetWeightLine ? pdpSizeLine(item) : null");
    expect(pdp).toContain('data-testid="pdp-size-chip"');
    expect(pdp).toContain("weight: isNonCannabisItem(item) ? null : productSchemaWeight(item)");
  });
  it("home + specials apply the override after the profile", () => {
    for (const f of ["src/app/page.tsx", "src/app/specials/page.tsx"]) {
      expect(read(f)).toContain(".then((items) => withMenuProfile(items)).then((items) => withCategoryOverride(items))");
    }
  });
  it("lot page: the details form is keyed on the saved facts (React 19 form reset) + drift notice", () => {
    const page = read("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain("<form key={detailsFormKey} action={detailsAction}");
    expect(page).toMatch(/detailsFormKey = \[lot\.vendor_id[^\n]*lot\.strain_type[^\n]*lot\.updated_at\]\.join/);
    expect(page).toContain('data-testid="lot-strain-drift"');
    expect(page).toContain("pushLotStrainTypeAction");
  });
  it("inventory actions never refresh only /menu any more", () => {
    const src = read("src/app/admin/inventory/actions.ts");
    expect(src).not.toMatch(/revalidatePath\(\s*["']\/menu["']\s*\)/);
    expect(src).toContain("revalidatePublicMenuSurfaces()");
  });
  it("/menu/[category] is a revalidated page pattern", () => {
    expect(PUBLIC_MENU_PAGE_PATTERNS).toContain("/menu/[category]");
    expect(PUBLIC_MENU_PAGE_PATTERNS).toContain("/menu/products/[id]");
  });
  it("the Product facts fix mirror refreshes the public site when it wrote a live card", () => {
    const src = read("src/app/admin/inventory/drafts/actions.ts");
    expect(src).toContain("if (mirror.items > 0) revalidatePublicMenuSurfaces();");
  });
  it("onboarding stamps a person's strain pick as reviewer on the card", () => {
    const src = read("src/lib/pos/draft-injection-core.ts");
    expect(src).toMatch(/if \(\(golden\.source === "human" \|\| golden\.source === "attached_human"\) && golden\.value !== "unknown"\) \{\s*factProvenance\.strain_type = "reviewer";/);
  });
});
