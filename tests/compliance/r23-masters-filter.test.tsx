/**
 * tests/compliance/r23-masters-filter.test.tsx — R23 owner fixes 7, 8, 9.
 *
 *   7  "add a vendor and manifest filter for mastering, so I can narrow down
 *       what masters per vendor we have."
 *      Proven on the REAL Masters page through FakePostgrest: the vendor
 *      facet, the manifest facet (via the manifest's lots, including restock
 *      "-onboarded" lot keys), AND-intersection, the Masters tab filtered by
 *      member cards, links that keep the facets, and an unreadable manifest
 *      that shows NOTHING (never silently everything).
 *   8  the one pipeline bar on Master and Accounts Payable (source checks).
 *   9  the home + specials pages resolve enrichment images the way Shop does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/admin/products/masters",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u-owner", email: "o@x", profile: { role: "owner" } }),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => {} }));

import { __runMastersFilterCoreTests } from "@/lib/products/masters-filter-core";
import { loadManifestLotKeys, listMasterableManifests } from "@/lib/products/masters-store";
import MastersPage from "@/app/admin/products/masters/page";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAN = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MAN2 = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

let seq = 0;
function card(id: string, vendor: string, sizes: string[]) {
  seq += 1;
  st.db.rows("menu_items").push({
    id,
    menu_version_id: "v-live",
    source_item_id: `K-${id}`,
    name: `Card ${id}`,
    product_name: null,
    brand_name: "Brand",
    vendor_name: vendor,
    category: "flower",
    hidden: false,
    sort_order: seq,
    price_minor_units: 1000,
  });
  sizes.forEach((sid, i) =>
    st.db.rows("menu_variants").push({
      id: sid,
      menu_item_id: id,
      source_variant_id: sid,
      label: `${i + 1}g`,
      price_minor_units: 1000,
      inventory_level: 2,
      medical: false,
      sort_order: i,
    }),
  );
}
function seed() {
  st.db.rows("menu_versions").push({ id: "v-live", status: "published", item_count: 3, variant_count: 3, vendor_count: 2, hidden_count: 0, error_count: 0, warning_count: 0 });
  card("a", "Phat Panda", ["pos-a1"]);
  card("b", "phat  panda", ["LOT-9-onboarded"]);
  card("c", "Agro Couture", ["pos-c1"]);
  st.db.rows("inbound_manifests").push(
    { id: MAN, manifest_number: "M-100", vendor_label: "Phat Panda", transfer_date: "2026-04-02", invoice_number_override: null, status: "accepted", created_at: "2026-04-02" },
    { id: MAN2, manifest_number: "M-200", vendor_label: "Agro Couture", transfer_date: "2026-03-01", invoice_number_override: "INV-7", status: "partially_accepted", created_at: "2026-03-01" },
    { id: "pending-1", manifest_number: "M-300", vendor_label: "Agro Couture", transfer_date: "2026-04-05", invoice_number_override: null, status: "pending", created_at: "2026-04-05" },
  );
  // Card b was restocked on MAN under its onboarded lot key.
  st.db.rows("inventory_lots").push(
    { id: "l1", manifest_id: MAN, pos_product_key: "LOT-9-onboarded", lot_code: "LOT-9" },
    { id: "l2", manifest_id: MAN2, pos_product_key: "K-c", lot_code: "C-1" },
  );
}
async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await MastersPage({ searchParams: Promise.resolve(sp) }));
}
const cardCount = (html: string) => (html.match(/data-testid="live-card"/g) ?? []).length;

beforeEach(() => {
  st.db = new FakePostgrest();
  seq = 0;
});

describe("R23 fix 7 — masters-filter-core", () => {
  it("runs exactly 39 assertions, none failing, and is registered at that floor", () => {
    expect(__runMastersFilterCoreTests()).toEqual({ passed: 39, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("masters-filter-core", __runMastersFilterCoreTests(), 39)',
    );
  });
});

describe("R23 fix 7 — store reads", () => {
  it("reads only the chosen manifest's lots, and only accepted manifests as options", async () => {
    seed();
    const lots = await loadManifestLotKeys(MAN);
    expect(lots.ok).toBe(true);
    expect(lots.lots.map((l) => l.pos_product_key)).toEqual(["LOT-9-onboarded"]);
    const opts = await listMasterableManifests();
    expect(opts.map((m) => m.id).sort()).toEqual([MAN, MAN2].sort());
  });
  it("an unreadable lot table is reported ok:false", async () => {
    seed();
    st.db.missing.add("inventory_lots");
    expect((await loadManifestLotKeys(MAN)).ok).toBe(false);
  });
});

describe("R23 fix 7 — the real Masters page", () => {
  it("unfiltered: every card, the facet form with both selects, accepted manifests only", async () => {
    seed();
    const html = await render();
    expect(cardCount(html)).toBe(3);
    expect(html).toContain('data-testid="masters-facets"');
    expect(html).toContain('data-testid="masters-vendor-select"');
    expect(html).toContain('data-testid="masters-manifest-select"');
    // vendor spellings merged into one option with a count
    expect(html).toMatch(/<option value="phat panda">Phat Panda \(2\)<\/option>/);
    expect(html).toContain("2026-04-02 · Phat Panda · #M-100");
    expect(html).toContain("2026-03-01 · Agro Couture · #INV-7");
    expect(html).not.toContain("M-300");
    expect(html).not.toContain('data-testid="masters-facets-clear"');
  });

  it("vendor facet narrows, says how many of how many, keeps the facet on links, offers Clear", async () => {
    seed();
    const html = await render({ tab: "live", vendor: "Phat Panda" });
    expect(cardCount(html)).toBe(2);
    expect(html).not.toContain("Card c");
    expect(html).toContain("Showing 2 of 3 live cards from Phat Panda.");
    expect(html).toContain("vendor=phat+panda");
    expect(html).toContain('data-testid="masters-facets-clear"');
    // the manifest select only offers that vendor's deliveries
    expect(html).toContain("#M-100");
    expect(html).not.toContain("#INV-7");
  });

  it("manifest facet finds a card by its restock lot key; facets intersect", async () => {
    seed();
    const html = await render({ tab: "live", manifest: MAN });
    expect(cardCount(html)).toBe(1);
    expect(html).toContain("Card b");
    expect(html).toContain("received on 2026-04-02 · Phat Panda · #M-100");
    const both = await render({ tab: "live", manifest: MAN2, vendor: "phat panda" });
    expect(cardCount(both)).toBe(0);
    expect(both).toContain("No cards match this filter");
  });

  it("an unreadable manifest shows nothing and says so — never everything", async () => {
    seed();
    st.db.missing.add("inventory_lots");
    const html = await render({ tab: "live", manifest: MAN });
    expect(cardCount(html)).toBe(0);
    expect(html).toContain('data-testid="masters-manifest-read-failed"');
  });

  it("a non-uuid manifest value is ignored (any), not passed to the database", async () => {
    seed();
    const html = await render({ tab: "live", manifest: "1 or 1=1" });
    expect(cardCount(html)).toBe(3);
  });

  it("Masters tab: only masters with a member card that passes the facet", async () => {
    seed();
    st.db.rows("product_masters").push(
      { id: "M1", display_name: "Panda Master", brand_name: null, category: null, status: "draft", created_origin: "manual", updated_at: "2026-01-02" },
      { id: "M2", display_name: "Agro Master", brand_name: null, category: null, status: "draft", created_origin: "manual", updated_at: "2026-01-01" },
    );
    st.db.rows("product_master_members").push(
      { id: "mm1", master_id: "M1", pos_product_key: "K-a", variant_label: null, sort_order: 0 },
      { id: "mm2", master_id: "M2", pos_product_key: "K-c", variant_label: null, sort_order: 0 },
    );
    const all = await render({ tab: "masters" });
    expect((all.match(/data-testid="master-card"/g) ?? []).length).toBe(2);
    const panda = await render({ tab: "masters", vendor: "phat panda" });
    expect((panda.match(/data-testid="master-card"/g) ?? []).length).toBe(1);
    expect(panda).toContain("Panda Master");
    expect(panda).not.toContain("Agro Master");
    const none = await render({ tab: "masters", vendor: "nobody" });
    expect(none).toContain("No masters for this vendor / manifest");
  });
});

describe("R23 fix 8 — the pipeline bar on Master and Accounts Payable", () => {
  it("both pages render CatalogStageStrip at their own stage", () => {
    expect(read("src/app/admin/products/masters/page.tsx")).toContain('<CatalogStageStrip current="master" />');
    expect(read("src/app/admin/vendor-payments/page.tsx")).toContain('<CatalogStageStrip current="pay" />');
  });
  it("the rendered Masters page shows all nine stages in order", async () => {
    seed();
    const html = (await render()).replace(/<[^>]+>/g, " ");
    const order = ["Discover", "Order", "Receive", "Onboard", "Publish", "Enrich", "Master", "Inventory", "Pay"];
    let at = -1;
    for (const label of order) {
      const i = html.indexOf(label, at + 1);
      expect(i, label).toBeGreaterThan(at);
      at = i;
    }
  });
});

describe("R23 fix 9 — home + specials resolve enrichment images like Shop", () => {
  for (const p of ["src/app/page.tsx", "src/app/specials/page.tsx"]) {
    it(`${p} pipes the live menu through withResolvedImages`, () => {
      const s = read(p);
      expect(s).toContain('import { withResolvedImages } from "@/lib/enrichment/image-resolver";');
      // R33: the owner's category/type re-file (withCategoryOverride) sits
      // between the profile and the image resolve; images still resolve last.
      expect(s).toMatch(/withMenuProfile\(items\)\)\.then\(\(items\) => withCategoryOverride\(items\)\)\.then\(\(items\) => withResolvedImages\(items\)\)/);
    });
  }
});
