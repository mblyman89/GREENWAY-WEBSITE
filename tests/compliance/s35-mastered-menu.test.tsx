/**
 * tests/compliance/s35-mastered-menu.test.tsx   (bible S35 — Data-rich Product Masters page)
 *
 * "What is actually mastered on my live menu?" proven four ways:
 *   1. the pure core's embedded self-tests (exact count, registered);
 *   2. the STORE against FakePostgrest through the real postgrest-js client:
 *      only the PUBLISHED version is read, hidden cards are excluded, a
 *      version that claims cards but loads none is a read FAILURE (never
 *      "nothing mastered"), identity_key is opt-in and a missing column
 *      degrades to "not available", members are paged past the 1000 cap;
 *   3. the REAL page rendered end to end: Live cards is the default tab, the
 *      stat cards are the S35 four, the intake rule is stated once, an empty
 *      menu renders an EmptyState (not zeros presented as data), ListPager
 *      windows the list, manual masters list their members with live data;
 *   4. the presentational components (unknown stock never shown as 0).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  calls: [] as string[],
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
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u-owner", email: "o@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => {} }));

import {
  __runMasteredMenuCoreTests,
  MANUAL_MASTER_RULE,
  MASTERS_SUBTITLE,
  LIVE_CARDS_PAGE_SIZE,
  summarizeCard,
} from "@/lib/products/mastered-menu-core";
import { loadMasteredMenu, loadIdentityKeysForCards, listAllMasterMembers } from "@/lib/products/masters-store";
import MastersPage from "@/app/admin/products/masters/page";
import { LiveCardRow, MasterMembersList } from "@/components/admin/products/MasteredCards";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function seedVersion(over: Record<string, unknown> = {}) {
  st.db.rows("menu_versions").push(
    { id: "v-live", status: "published", item_count: 3, variant_count: 4, vendor_count: 1, hidden_count: 0, error_count: 0, warning_count: 0, ...over },
    { id: "v-old", status: "archived", item_count: 1 },
  );
}
let seq = 0;
function card(id: string, over: Record<string, unknown> = {}, version = "v-live") {
  seq += 1;
  st.db.rows("menu_items").push({
    id,
    menu_version_id: version,
    source_item_id: `K-${id}`,
    name: `Card ${id}`,
    product_name: null,
    brand_name: "Brand",
    vendor_name: "Vendor",
    category: "flower",
    hidden: false,
    sort_order: seq,
    price_minor_units: 1000,
    ...over,
  });
}
function size(itemId: string, id: string, label: string, price: number, level: number, medical = false) {
  st.db.rows("menu_variants").push({
    id,
    menu_item_id: itemId,
    source_variant_id: id,
    label,
    price_minor_units: price,
    inventory_level: level,
    medical,
    sort_order: 0,
  });
}
function seedMenu() {
  seedVersion();
  card("a", { product_name: "Gelato" });
  size("a", "LOT-7-onboarded", "3.5g", 2500, 4);
  size("a", "pos-a1", "1g", 1000, 0);
  card("b", { name: "Solo" });
  size("b", "pos-b1", "1g", 900, 2, true);
  card("h", { name: "Hidden", hidden: true });
  size("h", "pos-h1", "1g", 900, 2);
  card("old", { name: "Old version card" }, "v-old");
  size("old", "pos-o1", "1g", 900, 2);
}
async function renderPage(sp: Record<string, string> = {}) {
  const el = await MastersPage({ searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.calls = [];
  seq = 0;
});

// ---------------------------------------------------------------------------
describe("S35 mastered-menu-core self-tests", () => {
  it("runs exactly 55 assertions with none failing", () => {
    expect(__runMasteredMenuCoreTests()).toEqual({ passed: 55, failed: 0 });
  });
  it("is registered in the pure runner at its exact floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runMasteredMenuCoreTests } from "../../src/lib/products/mastered-menu-core"');
    expect(runner).toContain('assertRan("mastered-menu-core", __runMasteredMenuCoreTests(), 55);');
  });
  it("uses the exact bible S35.4 copy", () => {
    expect(MASTERS_SUBTITLE).toBe("What is mastered on your live menu today, and suggestions for what should be.");
    expect(MANUAL_MASTER_RULE).toBe(
      "Receiving already joins restocks to the live card with the same vendor, category and product family. Manual masters on this page do not change that rule.",
    );
  });
});

// ---------------------------------------------------------------------------
describe("S35 store — loadMasteredMenu", () => {
  it("reads only the published version and excludes hidden cards", async () => {
    seedMenu();
    const r = await loadMasteredMenu();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.versionId).toBe("v-live");
    expect(r.cards.map((c) => c.key)).toEqual(["K-a", "K-b"]);
    const gelato = r.cards[0];
    expect(gelato.name).toBe("Gelato");
    expect(gelato.sizes.map((s) => s.label)).toEqual(["1g", "3.5g"]);
    expect(gelato.priceRangeMinor).toEqual([1000, 2500]);
    expect(gelato.totalOnHand).toBe(4);
    expect(gelato.lotKeys).toEqual(["LOT-7"]);
    expect(r.cards[1].market).toBe("medical");
  });
  it("no published version → ok with no cards (the page shows 'No live menu yet')", async () => {
    expect(await loadMasteredMenu()).toEqual({ ok: true, versionId: null, cards: [] });
  });
  it("a version that claims cards but loads none is a read failure, not 'nothing mastered'", async () => {
    seedVersion({ item_count: 12 });
    st.db.missing.add("menu_items");
    const r = await loadMasteredMenu();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("says it has 12 cards but none could be read");
  });
  it("a truly empty published version is ok and empty", async () => {
    seedVersion({ item_count: 0 });
    expect(await loadMasteredMenu()).toEqual({ ok: true, versionId: "v-live", cards: [] });
  });
});

describe("S35 store — identity keys (opt-in) and members (paged)", () => {
  it("reads identity_key only for the given keys on the given version", async () => {
    seedVersion();
    st.db.rows("menu_items").push(
      { id: "1", menu_version_id: "v-live", source_item_id: "A", identity_key: "v|flower|a" },
      { id: "2", menu_version_id: "v-live", source_item_id: "B", identity_key: "  " },
      { id: "3", menu_version_id: "v-old", source_item_id: "A", identity_key: "stale" },
      { id: "4", menu_version_id: "v-live", source_item_id: "C", identity_key: "v|flower|c" },
    );
    const m = await loadIdentityKeysForCards("v-live", ["A", "B"]);
    expect([...m.entries()]).toEqual([["A", "v|flower|a"]]);
    const u = st.db.log.at(-1)!.url.searchParams;
    expect(u.get("select")).toBe("source_item_id,identity_key");
    expect(u.get("menu_version_id")).toBe("eq.v-live");
    expect(u.get("limit")).toBe("2");
  });
  it("no keys → no read; a missing column (pre-0234) → empty map, not a crash", async () => {
    expect((await loadIdentityKeysForCards("v-live", [])).size).toBe(0);
    expect(st.db.log).toHaveLength(0);
    st.db.before = () => ({ status: 400, body: { code: "42703", message: 'column menu_items.identity_key does not exist', details: null, hint: null } });
    expect((await loadIdentityKeysForCards("v-live", ["A"])).size).toBe(0);
  });
  it("pages members past PostgREST's 1000-row cap (ordered on id) and reports completeness", async () => {
    for (let i = 0; i < 1203; i += 1) {
      st.db.rows("product_master_members").push({
        id: `m-${String(i).padStart(5, "0")}`,
        master_id: "M1",
        pos_product_key: `K${i}`,
        variant_label: null,
        sort_order: i,
      });
    }
    const r = await listAllMasterMembers();
    expect(r.complete).toBe(true);
    expect(r.members).toHaveLength(1203);
    const reads = st.db.log.filter((x) => x.table === "product_master_members");
    expect(reads.length).toBeGreaterThan(1);
    expect(reads[0].url.searchParams.get("order")).toBe("id.asc");
  });
  it("a failed member read is reported incomplete", async () => {
    st.db.missing.add("product_master_members");
    expect(await listAllMasterMembers()).toEqual({ members: [], complete: false });
  });
});

// ---------------------------------------------------------------------------
describe("S35 the real Masters page", () => {
  it("defaults to Live cards: S35 stats, rule stated once, sizes/prices/stock/lots per card", async () => {
    seedMenu();
    const html = await renderPage();
    expect(st.calls).toContain("perm:inventory.manage");
    expect(html).toContain(MASTERS_SUBTITLE);
    expect(html.split(MANUAL_MASTER_RULE).length - 1).toBe(1);
    expect(html).toContain('data-testid="live-cards"');
    for (const label of ["Live cards", "Multi-size", "Sizes on menu", "Pending suggestions"]) expect(html).toContain(label);
    expect(html).not.toContain("AI grouping</");
    expect((html.match(/data-testid="live-card"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Old version card");
    expect(html).toContain("Gelato");
    expect(html).toContain("$10.00–$25.00");
    expect(html).toContain("4 on hand");
    expect(html).toContain("Lot LOT-7");
    expect(html).toContain('href="/admin/inventory?q=LOT-7"');
    expect(html).toContain("POS import");
    expect(html).toContain("Medical only");
    expect(html).toContain("Identity not available");
    expect(html).toContain('href="/admin/products/K-a');
  });

  it("an empty live menu renders an EmptyState, and the stats are not zeros presented as data", async () => {
    const html = await renderPage();
    expect(html).toContain("No live menu yet");
    expect(html).not.toContain('data-testid="live-card"');
  });

  it("a menu read failure is said plainly; stats show — instead of 0", async () => {
    seedVersion({ item_count: 5 });
    st.db.missing.add("menu_items");
    const html = await renderPage();
    expect(html).toContain('data-testid="live-cards-error"');
    expect(html).toContain("could not read the live menu");
    expect(html).not.toContain("No live menu yet");
  });

  it("filters to multi-size cards and windows long lists with ListPager", async () => {
    seedVersion({ item_count: LIVE_CARDS_PAGE_SIZE + 5 });
    for (let i = 0; i < LIVE_CARDS_PAGE_SIZE + 5; i += 1) {
      const id = `c${String(i).padStart(3, "0")}`;
      card(id);
      size(id, `${id}-1`, "1g", 1000, 1);
      if (i < 3) size(id, `${id}-2`, "3.5g", 2500, 1);
    }
    const page1 = await renderPage();
    expect((page1.match(/data-testid="live-card"/g) ?? []).length).toBe(LIVE_CARDS_PAGE_SIZE);
    expect(page1).toContain(`of ${LIVE_CARDS_PAGE_SIZE + 5}`);
    expect(page1).toContain("tab=live&amp;page=2");
    const page2 = await renderPage({ tab: "live", page: "2" });
    expect((page2.match(/data-testid="live-card"/g) ?? []).length).toBe(5);
    const multi = await renderPage({ tab: "live", show: "multi" });
    expect((multi.match(/data-testid="live-card"/g) ?? []).length).toBe(3);
    expect(multi).toMatch(/data-sizes="2"/);
    expect(multi).not.toMatch(/data-sizes="1"/);
  });

  it("Masters tab: each manual master lists its members with live sizes/prices/stock", async () => {
    seedMenu();
    st.db.rows("product_masters").push({
      id: "M1",
      display_name: "Acme Gelato",
      brand_name: null,
      category: null,
      status: "draft",
      created_origin: "manual",
      updated_at: "2026-01-01",
    });
    st.db.rows("product_master_members").push(
      { id: "mm1", master_id: "M1", pos_product_key: "K-a", variant_label: "3.5g", sort_order: 0 },
      { id: "mm2", master_id: "M1", pos_product_key: "GONE", variant_label: null, sort_order: 1 },
    );
    const html = await renderPage({ tab: "masters" });
    expect(html).toContain('data-testid="master-card"');
    expect((html.match(/data-testid="master-member"/g) ?? []).length).toBe(2);
    expect(html).toContain("1g · 3.5g");
    expect(html).toContain("Not on the live menu");
    expect(html).not.toContain('data-testid="live-cards"');
    // the Live cards tab says which manual master lists a card — shown only.
    const live = await renderPage();
    expect(live).toContain("Listed in manual master “Acme Gelato”");
  });

  it("Masters tab: an unreadable member list is flagged, never shown as a silently short list", async () => {
    seedMenu();
    st.db.rows("product_masters").push({
      id: "M1",
      display_name: "Acme Gelato",
      brand_name: null,
      category: null,
      status: "draft",
      created_origin: "manual",
      updated_at: "2026-01-01",
    });
    const ok = await renderPage({ tab: "masters" });
    expect(ok).not.toContain('data-testid="masters-partial"');
    st.db.missing.add("product_master_members");
    const html = await renderPage({ tab: "masters" });
    expect(html).toContain('data-testid="masters-partial"');
    expect(html).toContain("Some master members could not be read, so a list below may be incomplete.");
  });
});

// ---------------------------------------------------------------------------
describe("S35 components", () => {
  const base = {
    source_item_id: "K1",
    name: "N",
    product_name: null,
    brand_name: null,
    vendor_name: null,
    category: null,
    hidden: false,
  };
  it("unknown stock reads 'Unknown' / 'Stock unknown', never 0", () => {
    const c = summarizeCard({
      ...base,
      variants: [
        { source_variant_id: "a", label: "1g", price_minor_units: 1000, inventory_level: null, medical: false },
        { source_variant_id: "b", label: "2g", price_minor_units: 1800, inventory_level: 3, medical: false },
      ],
    });
    const html = renderToStaticMarkup(<LiveCardRow card={c} back="/admin/products/masters?tab=live" manualMaster={null} identityKey={null} />);
    expect(html).toContain("Stock unknown");
    expect(html).toContain(">Unknown<");
    expect(html).not.toContain("0 on hand");
    expect(html).toContain("Vendor not set");
  });
  it("prefers the opt-in identity key when supplied", () => {
    const c = summarizeCard({ ...base, variants: [] });
    const html = renderToStaticMarkup(<LiveCardRow card={c} back="/admin/x" manualMaster="M" identityKey="v|flower|n" />);
    expect(html).toContain("Identity v|flower|n");
    expect(html).toContain("This card has no sizes on the live menu.");
    expect(html).toContain("Listed in manual master “M”");
  });
  it("empty member list says so", () => {
    expect(renderToStaticMarkup(<MasterMembersList members={[]} back="/admin/x" />)).toContain("No members yet.");
  });
});
