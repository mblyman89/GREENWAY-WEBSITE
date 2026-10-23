/**
 * tests/compliance/r74-s17-category-hold-release.test.ts   (R74 S17)
 *
 * Owner, round 9: "please also include in this round the automatic go live
 * feature for products held back for no category. I think this would be a huge
 * efficiency boost and will make the process so much faster and smoother."
 *
 * Through the REAL staging executor (the R50 S3c parity harness: the owner's
 * real bytes edibles + real certificates over a fake PostgREST network):
 *   1. a card held for a category (hidden, "needs_category", placeholder shelf)
 *      whose draft was approved with a person's pick (S17 marker) goes LIVE on
 *      the picked shelf - price, sizes, stock, order unchanged; summary, notes,
 *      timeline and audit say so;
 *   2. no marker (Approve all priced / remembered / pre-S17) = stays hidden;
 *   3. any other hide reason is never touched;
 *   4. a product withheld for an unverified fact stays hidden (not rebuilt);
 *   5. switch off = S15 behaviour (stays hidden);
 *   6. visibility is the only change (card already rebuilt) = still staged;
 *   7. the approval writes the marker only when the gate saw a hold.
 * Plus wiring pins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { r28MakeExtract } from "../../scripts/r28/coa-fixture-extract";

const ROOT = join(__dirname, "..", "..");
const FXDIR = join(ROOT, "tests", "fixtures", "coa");
const stems: Record<string, string> = {};
for (const f of readdirSync(FXDIR)) {
  const m = f.match(/^(item\d\d\.(?:unpdf|layout|wcia)|transfer)\.(?:txt|json)$/);
  if (m) stems[m[1]] = readFileSync(join(FXDIR, f), "utf8");
}
const makeExtract = r28MakeExtract(stems);
const items = (JSON.parse(stems["transfer"]) as {
  inventory_transfer_items: { product_name: string; brand_name?: string; inventory_type: string; lab_result_data: { potency?: { type: string; value: number }[] } }[];
}).inventory_transfer_items;
const pot = (i: number, t: string) => items[i].lab_result_data.potency?.find((p) => p.type === t)?.value ?? null;

type Req = { method: string; url: URL; body: unknown; headers: Headers };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown; headers: Headers }) => { status: number; body?: unknown; range?: string } | undefined),
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => net.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    net.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    net.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) =>
    net.calls.push(`audit:${a.action}:${a.entityId}:${JSON.stringify(a.after)}`),
}));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => net.calls.push("public-surfaces") }));
vi.mock("@/lib/pos/menu-version", () => ({ archiveSupersededStaged: async () => 0 }));
vi.mock("@/lib/pos/cutover-guard", () => ({ shouldHoldForCutover: async () => false }));
// Spy that delegates to the real reader: pins WHETHER staging asks for vendor ids.
vi.mock("@/lib/inventory/restock-preview-server", async (orig) => {
  const real = await orig<typeof import("@/lib/inventory/restock-preview-server")>();
  return {
    ...real,
    loadVendorIdInputs: (...a: Parameters<typeof real.loadVendorIdInputs>) => {
      net.calls.push("vendor-id-read");
      return real.loadVendorIdInputs(...a);
    },
  };
});
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) => lots.map(() => ({ websiteCategory: "edibles" })),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null, headers: new Headers(init?.headers) };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (rep.range) headers["content-range"] = rep.range;
    const body = r.method === "HEAD" ? null : JSON.stringify(rep.body ?? []);
    return new Response(body, { status: rep.status, headers });
  };
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }),
  };
});

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
const offset = (r: Req) => Number(r.url.searchParams.get("offset") ?? "0");
const limit = (r: Req) => Number(r.url.searchParams.get("limit") ?? "1000000");
const pageOf = <T,>(rows: T[], r: Req) => rows.slice(offset(r), offset(r) + limit(r));

beforeEach(() => {
  net.reqs.length = 0;
  net.calls.length = 0;
  net.route = null;
  process.env.INTAKE_BATCH_STAGING = "off";
  delete process.env.INTAKE_FACT_WITHHOLD;
  delete process.env.CULTIVERA_CARD_REFRESH;
});
afterEach(() => {
  delete process.env.INTAKE_BATCH_STAGING;
  delete process.env.INTAKE_FACT_WITHHOLD;
});


const M = "11111111-1111-4111-8111-111111111111";
const D12 = "12121212-1212-4212-8212-121212121212";
const D13 = "13131313-1313-4313-8313-131313131313";
const LOT12 = "a1212121-1212-4212-8212-121212121212";
const LOT13 = "a1313131-1313-4313-8313-131313131313";
const LAB12 = "b1212121-1212-4212-8212-121212121212";
const LAB13 = "b1313131-1313-4313-8313-131313131313";

const draft = (i: number, id: string, lot: string, price: number | null) => ({
  id,
  pos_product_key: `LOT-${i}`,
  name: items[i].product_name,
  brand_name: "bytes",
  vendor_name: "bytes LLC",
  inventory_type: items[i].inventory_type,
  category: "Edibles",
  chosen_website_category: "edibles",
  strain_name: null,
  thc_pct: pot(i, "total-thc"),
  cbd_pct: pot(i, "total-cbd"),
  total_thc_pct: pot(i, "total-thc"),
  potency_json: null,
  price_minor_units: price,
  updated_at: "2026-01-01T00:00:00Z",
  lot_id: lot,
  chosen_house_type: null,
  chosen_strain_type: null,
});
const labRow = (i: number, id: string) => ({
  id,
  coa_extract_json: JSON.parse(JSON.stringify(makeExtract(i, "unpdf"))),
  total_thc_pct: pot(i, "total-thc"),
  total_cbd_pct: pot(i, "total-cbd"),
  cbd_pct: null,
});

/** A live card exactly as the Cultivera export left it (the "garbage" the owner means). */
const cultiveraCard = (i: number) => ({
  id: `live-${i}`,
  menu_version_id: "pub-1",
  source_item_id: `LOT-${i}`,
  name: items[i].product_name.toUpperCase(),
  product_name: items[i].product_name.toUpperCase(),
  brand_name: "BYTES",
  vendor_name: "bytes LLC",
  category: "edibles",
  filter_categories: [],
  pos_inventory_type: "Solid Edible",
  pos_inventory_category: "EDIBLE",
  strain_type: "unknown",
  strain_name: null,
  thc: "0.12mg",
  cbd: "0.22mg",
  total_thc_json: { type: "thc", value: "0.12", unit: "mg" },
  total_cbd_json: { type: "cbd", value: "0.22", unit: "mg" },
  compounds_json: [{ type: "thc", value: "0.12", unit: "mg" }],
  servings_per_pack: null,
  mg_per_serving: null,
  package_thc_mg: null,
  package_cbd_mg: null,
  ratio_label: null,
  net_weight_grams: null,
  net_volume_ml: null,
  fact_provenance: { thc: "cultivera" },
  low_thc_liquid: null,
  unit_thc_mg: null,
  otherwise_taken: null,
  units_per_package: null,
  effects: null,
  aroma_notes: null,
  description: "",
  price_label: "$18",
  price_minor_units: 1800,
  inventory_status: "available",
  hidden: false,
  hidden_reason: null,
  sort_order: i,
});
const liveVariant = (i: number) => ({
  id: `lv-${i}`,
  menu_item_id: `live-${i}`,
  source_variant_id: `LOT-${i}`,
  label: "10pk",
  price_minor_units: 1800,
  inventory_level: 7,
  medical: false,
  sort_order: 0,
});

import { CATEGORY_HOLD_PICK_KEY, CATEGORY_HOLD_PICK_VALUE } from "@/lib/inventory/cultivera-category-release-core";

const MARK = { websiteCategory: "human", [CATEGORY_HOLD_PICK_KEY]: CATEGORY_HOLD_PICK_VALUE };
type Opts = {
  /** live card overrides per item index */
  live?: Partial<Record<12 | 13, Record<string, unknown>>>;
  /** draft provenance per item index (undefined = no provenance column value) */
  prov?: Partial<Record<12 | 13, unknown>>;
  /** replace the live cards entirely (e.g. an already-refreshed snapshot) */
  liveRows?: Record<string, unknown>[];
};
function world(o: Opts = {}) {
  const live = o.liveRows ?? [
    { ...cultiveraCard(12), ...(o.live?.[12] ?? {}) },
    { ...cultiveraCard(13), ...(o.live?.[13] ?? {}) },
  ];
  const variants = [liveVariant(12), liveVariant(13)].map((v) => ({ ...v, menu_item_id: String(live.find((c) => c.source_item_id === v.source_variant_id)?.id ?? v.menu_item_id) }));
  net.route = (r) => {
    const t = table(r);
    if (t === "inbound_manifests" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("payload_kind")) return { status: 200, body: [{ id: M, payload_kind: "cultivera-reconstructed" }] };
      return { status: 200, body: [{ manifest_number: "M-1", vendor_label: "bytes LLC", received_at: null, transfer_date: "2026-09-01" }] };
    }
    if (t === "catalog_product_drafts") {
      const rows = [draft(12, D12, LOT12, null), draft(13, D13, LOT13, null)].map((d, k) => {
        const p = o.prov?.[k === 0 ? 12 : 13];
        return p === undefined ? d : { ...d, chosen_classification_provenance: p };
      });
      return { status: 200, body: rows };
    }
    if (t === "inventory_lots" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("lab_result_id")) return { status: 200, body: pageOf([{ id: LOT12, lab_result_id: LAB12 }, { id: LOT13, lab_result_id: LAB13 }], r) };
      if (sel.includes("fact_provenance")) return { status: 200, body: [] };
      return { status: 200, body: [] };
    }
    if (t === "lab_results" && r.method === "GET") return { status: 200, body: pageOf([labRow(12, LAB12), labRow(13, LAB13)], r) };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") return { status: 200, body: [{ id: "pub-1" }] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.staged") return { status: 200, body: [] };
    if (t === "menu_items" && r.method === "HEAD") return { status: 200, range: `0-${live.length - 1}/${live.length}` };
    if (t === "menu_items" && r.method === "GET") return { status: 200, body: pageOf(live, r) };
    if (t === "menu_variants" && r.method === "GET") return { status: 200, body: pageOf(variants, r) };
    if (t === "pos_fact_reviews" && r.method === "GET") return { status: 200, body: [] };
    if (t === "menu_versions" && r.method === "POST") return { status: 201, body: { id: "v-new", created_at: "2026-02-01T00:00:00Z", status: "staged" } };
    if (t === "menu_items" && r.method === "POST") {
      const rows = r.body as { source_item_id: string }[];
      return { status: 201, body: rows.map((x, k) => ({ id: `new-${k}-${x.source_item_id}`, source_item_id: x.source_item_id })) };
    }
    return undefined;
  };
}
const versionInsert = () => net.reqs.find((r) => table(r) === "menu_versions" && r.method === "POST");
const summary = () => versionInsert()!.body as { summary_json: Record<string, unknown>; notes: string };
const itemInserts = () => net.reqs.filter((r) => table(r) === "menu_items" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);
const variantInserts = () => net.reqs.filter((r) => table(r) === "menu_variants" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);
const events = () => net.reqs.filter((r) => table(r) === "manifest_events" && r.method === "POST").map((r) => r.body as { event_type: string; note: string });
const card = (key: string) => itemInserts().find((c) => c.source_item_id === key)!;
async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}
const HELD = { hidden: true, hidden_reason: "needs_category", category: "paraphernalia" };

beforeEach(() => {
  delete process.env.CULTIVERA_CATEGORY_RELEASE;
});
afterEach(() => {
  delete process.env.CULTIVERA_CATEGORY_RELEASE;
});

describe("R74 S17: a card held for a category goes live once a person picked it", () => {
  it("held + picked (marker) + rebuilt onto the picked shelf: visible, nothing else protected changes", async () => {
    world({ live: { 12: HELD }, prov: { 12: MARK } });
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: true, added: 0, merged: 0, carried: 2 });
    const c = card("LOT-12");
    expect(c).toMatchObject({ hidden: false, hidden_reason: null, category: "edibles" });
    // price, label, stock status, order untouched
    expect(c).toMatchObject({ price_label: "$18", price_minor_units: 1800, inventory_status: "available", sort_order: 0 });
    expect(variantInserts().filter((v) => v.source_variant_id === "LOT-12").map((v) => [v.label, v.price_minor_units, v.inventory_level])).toEqual([["10pk", 1800, 7]]);
    // the other card is untouched
    expect(card("LOT-13")).toMatchObject({ hidden: false, hidden_reason: null });
  });

  it("says so: summary, version notes, timeline (and the refresh note no longer claims visibility unchanged), audit", async () => {
    world({ live: { 12: HELD }, prov: { 12: MARK } });
    await stage();
    const s = summary();
    expect(s.summary_json.cultivera_category_release).toEqual({ released: ["LOT-12"], skipped: [] });
    expect(s.notes).toContain("1 card held for a category now visible (category picked at onboarding).");
    const ev = events().find((e) => e.event_type === "cultivera_category_holds_released")!;
    expect(ev.note).toBe(
      "1 product that was held for a category is now visible on the live menu, on the category you picked. Prices, sizes and stock did not change.",
    );
    const refreshed = events().find((e) => e.event_type === "cultivera_cards_refreshed")!;
    expect(refreshed.note).not.toContain("visibility");
    const audit = net.calls.find((c) => c.startsWith("audit:cultivera_category_hold.released:v-new:"));
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!.split(":v-new:")[1])).toMatchObject({ manifest_id: M, released: ["LOT-12"], skipped: [], published: true });
  });

  it("no marker (Approve all priced, a remembered pick, an approval before S17): stays hidden, nothing reported", async () => {
    for (const prov of [undefined, null, { websiteCategory: "human" }, { websiteCategory: "remembered" }, { [CATEGORY_HOLD_PICK_KEY]: "remembered" }]) {
      net.reqs.length = 0;
      net.calls.length = 0;
      world({ live: { 12: HELD }, prov: { 12: prov } });
      await stage();
      expect(card("LOT-12"), JSON.stringify(prov)).toMatchObject({ hidden: true, hidden_reason: "needs_category" });
      expect(summary().summary_json.cultivera_category_release).toBeUndefined();
      expect(events().some((e) => e.event_type === "cultivera_category_holds_released")).toBe(false);
      expect(net.calls.some((c) => c.includes("cultivera_category_hold.released"))).toBe(false);
    }
  });

  it("any other hide reason is never touched, even with the marker", async () => {
    for (const reason of ["owner", "reviewer_rejected", "no_product_master", "no_inventory"]) {
      net.reqs.length = 0;
      world({ live: { 12: { hidden: true, hidden_reason: reason } }, prov: { 12: MARK } });
      await stage();
      expect(card("LOT-12"), reason).toMatchObject({ hidden: true, hidden_reason: reason });
    }
  });

  it("a product withheld for an unverified fact stays hidden and the timeline says why", async () => {
    // Honeydew Melon (item 13) prints 11 mg THC per serving: its refresh is withheld.
    world({ live: { 13: HELD }, prov: { 13: MARK } });
    await stage();
    expect(card("LOT-13")).toMatchObject({ hidden: true, hidden_reason: "needs_category" });
    expect(summary().summary_json.cultivera_category_release).toEqual({ released: [], skipped: [{ key: "LOT-13", reason: "not_rebuilt" }] });
    const ev = events().find((e) => e.event_type === "cultivera_category_holds_released")!;
    expect(ev.note).toContain("1 picked product stays hidden");
  });

  it("switch off: the S15 behaviour (stays hidden, nothing reported)", async () => {
    process.env.CULTIVERA_CATEGORY_RELEASE = "off";
    world({ live: { 12: HELD }, prov: { 12: MARK } });
    await stage();
    expect(card("LOT-12")).toMatchObject({ hidden: true, hidden_reason: "needs_category" });
    expect(summary().summary_json.cultivera_category_release).toBeUndefined();
    expect(events().find((e) => e.event_type === "cultivera_cards_refreshed")!.note).toContain("Prices, sizes, stock and visibility did not change.");
  });

  it("visibility is the only change (the card was already rebuilt earlier): still staged and released", async () => {
    // First staging WITHOUT the release (switch off) rebuilds the card but keeps it hidden.
    process.env.CULTIVERA_CATEGORY_RELEASE = "off";
    world({ live: { 12: HELD }, prov: { 12: MARK } });
    await stage();
    const rebuilt = itemInserts().map((c, k) => ({ ...c, id: `live-r${k}`, menu_version_id: "pub-1" }));
    expect(rebuilt.find((c) => (c as Record<string, unknown>).source_item_id === "LOT-12")).toMatchObject({ hidden: true, category: "edibles" });
    // Now the switch is on and nothing else would change.
    delete process.env.CULTIVERA_CATEGORY_RELEASE;
    net.reqs.length = 0;
    world({ liveRows: rebuilt, prov: { 12: MARK } });
    const out = await stage();
    expect(out).toMatchObject({ staged: true });
    expect(card("LOT-12")).toMatchObject({ hidden: false, hidden_reason: null });
    expect((summary().summary_json.cultivera_refresh as { unchanged: string[] }).unchanged).toContain("LOT-12");
  });

  it("a held card still on the placeholder shelf (our build could not decide a shelf) stays hidden", async () => {
    // The draft's pick is blank in the database (marker present but no category): no release.
    world({ live: { 12: HELD }, prov: { 12: MARK } });
    const prev = net.route!;
    net.route = (r) => {
      if (table(r) === "catalog_product_drafts") {
        const rep = prev(r)!;
        return { ...rep, body: (rep.body as Record<string, unknown>[]).map((d) => (d.id === D12 ? { ...d, chosen_website_category: null } : d)) };
      }
      return prev(r);
    };
    await stage();
    expect(card("LOT-12")).toMatchObject({ hidden: true, hidden_reason: "needs_category" });
  });
});

describe("R74 S17 wiring", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  it("the approval writes the marker only from the S15 gate's own read, in the rebuilt branch", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    const gate = src.indexOf("const hold = categoryGate(holdRead");
    const mark = src.indexOf("heldPickedNow = holdRead.ok && holdRead.held;");
    expect(gate).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(gate);
    expect(src.indexOf("if (!hold.ok) {", gate)).toBeLessThan(mark); // only after the gate passed
    expect(src).toContain("...categoryHoldPickProvenance(heldPickedNow) }");
    expect(src.match(/^\s*heldPickedNow = /gm)).toHaveLength(1);
  });
  it("staging reads the provenance with the compliance tier and releases from the FINAL refresh plan", () => {
    const src = read("src/lib/pos/intake-menu-staging.ts");
    expect(src).toContain('", chosen_classification_provenance"');
    const final = src.indexOf("const refreshPlan = refreshMode ? refreshOfPlan(plan) : null;");
    const rel = src.indexOf("applyCategoryHoldReleases({");
    expect(rel).toBeGreaterThan(final);
    expect(src).toContain("rebuiltKeys: new Set([...refreshPlan.refreshed, ...refreshPlan.unchanged])");
  });
  it("the card refresh itself still never writes visibility", async () => {
    const core = await import("@/lib/inventory/cultivera-card-refresh-core");
    expect(core.PROTECTED_FIELDS).toEqual(expect.arrayContaining(["hidden", "hidden_reason"]));
  });
  it("self-tests are registered and pinned", async () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("cultivera-category-release-core", __runCultiveraCategoryReleaseCoreTests(), 33)');
    expect(runner).toContain('assertRan("cultivera-card-refresh-core", __runCultiveraCardRefreshCoreTests(), 84)');
    const { __runCultiveraCategoryReleaseCoreTests } = await import("@/lib/inventory/cultivera-category-release-core");
    expect(__runCultiveraCategoryReleaseCoreTests()).toEqual({ passed: 33, failed: 0 });
  });
});
