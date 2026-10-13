/**
 * tests/compliance/r50-s3c-cultivera-parity.test.ts   (R50 S3c)
 *
 * Owner follow-up #4: "make certain that every manifest created by the
 * migration behaves like it was received by us ... show up on the menu in the
 * same way ... completely rebuilt by our superior system".
 *
 * Parity validation (dbSeer layer 2: business-rule parity against a known-good
 * baseline). The baseline is a delivery RECEIVED natively. The same products
 * (the owner's REAL bytes edibles + REAL certificates, the R28 fixtures) are
 * then approved on a manifest REBUILT from Cultivera whose live cards carry
 * Cultivera's data. Through the REAL staging executor, the rebuilt cards must
 * equal the received cards on every customer-facing field, and keep their
 * live price, sizes, stock and visibility (sellable stays sellable).
 *
 * Header of the R28 harness follows (same fake network).
 *
 * --- original R28 header ---
 * tests/compliance/r28-coa-staging-e2e.test.ts
 *
 * R28 end to end: the REAL staging executor over a fake PostgREST network,
 * with two of the owner's REAL bytes edibles (items 12 and 13 of the real
 * transfer) and their REAL certificates (lab JSON + the PDF's text layer,
 * built exactly as the server builds them).
 *
 * Measured on this executor (never assumed), then pinned:
 *   - certificates NOT read: both are held for fact review; the cards would
 *     print the lab PERCENT as mg ("0.12mg") - the bug R28 exists to fix.
 *   - certificates read: Sour Mandarin publishes by itself with 55 mg THC /
 *     100 mg CBD per package, 5.5 mg per serving, 10 servings, provenance
 *     "coa"; Honeydew Melon alone is kept off because its certificate prints
 *     11 mg THC per serving (WAC 314-55-095 10 mg limit), with that reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { r28MakeExtract } from "../../scripts/r28/coa-fixture-extract";
import { FACT_FLAG_CODE } from "@/lib/pos/intake-fact-review-core";

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

type Mode = "received" | "rebuilt";
function world(mode: Mode, kindOverride?: string) {
  const live = mode === "rebuilt" ? [cultiveraCard(12), cultiveraCard(13)] : [];
  const variants = mode === "rebuilt" ? [liveVariant(12), liveVariant(13)] : [];
  const price = mode === "rebuilt" ? null : 2000; // a rebuilt sizes-differ draft may carry no price (S3 rule)
  net.route = (r) => {
    const t = table(r);
    if (t === "inbound_manifests" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("payload_kind")) return { status: 200, body: [{ id: M, payload_kind: kindOverride ?? (mode === "rebuilt" ? "cultivera-reconstructed" : "wcia") }] };
      return { status: 200, body: [{ manifest_number: "M-1", vendor_label: "bytes LLC", received_at: null, transfer_date: "2026-09-01" }] };
    }
    if (t === "catalog_product_drafts") return { status: 200, body: [draft(12, D12, LOT12, price), draft(13, D13, LOT13, price)] };
    if (t === "inventory_lots" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("lab_result_id")) return { status: 200, body: pageOf([{ id: LOT12, lab_result_id: LAB12 }, { id: LOT13, lab_result_id: LAB13 }], r) };
      if (sel.includes("fact_provenance")) return { status: 200, body: [{ id: LOT12, fact_provenance: { net_volume_ml: "human" } }] };
      return { status: 200, body: [] };
    }
    if (t === "lab_results" && r.method === "GET") return { status: 200, body: pageOf([labRow(12, LAB12), labRow(13, LAB13)], r) };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") return { status: 200, body: [{ id: "pub-1" }] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.staged") return { status: 200, body: [] };
    if (t === "menu_items" && r.method === "HEAD") return { status: 200, range: live.length ? `0-${live.length - 1}/${live.length}` : "*/0" };
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
type Diag = { code: string; severity: string; message: string; context?: Record<string, unknown> };
const summary = () => (versionInsert()!.body as { summary_json: Record<string, unknown>; notes: string });
const diags = () => summary().summary_json.diagnostics as Diag[];
const itemInserts = () => net.reqs.filter((r) => table(r) === "menu_items" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);
const variantInserts = () => net.reqs.filter((r) => table(r) === "menu_variants" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);
const lotWrites = () => net.reqs.filter((r) => table(r) === "inventory_lots" && r.method === "PATCH");
const events = () => net.reqs.filter((r) => table(r) === "manifest_events" && r.method === "POST").map((r) => r.body as { event_type: string; note: string });
async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}

/** Every customer-facing card field (menu_items columns the site + register read), minus the protected ones. */
const PARITY_FIELDS = [
  "description", "name", "product_name", "brand_name", "vendor_name", "category", "filter_categories",
  "pos_inventory_type", "pos_inventory_category", "strain_type", "strain_name",
  "thc", "cbd", "total_thc_json", "total_cbd_json", "compounds_json",
  "servings_per_pack", "mg_per_serving", "package_thc_mg", "package_cbd_mg", "ratio_label",
  "net_weight_grams", "net_volume_ml", "fact_provenance",
  "low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package", "effects", "aroma_notes",
] as const;
const PROTECTED = ["price_label", "price_minor_units", "inventory_status", "hidden", "hidden_reason"] as const;
const pick = (row: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));

describe("R50 S3c parity: a rebuilt Cultivera manifest's cards == a received delivery's cards", () => {
  it("baseline (received natively): Sour Mandarin goes live as a NEW card; Honeydew Melon kept off", async () => {
    world("received");
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: true, added: 1, withheld: 1 });
    expect(itemInserts().map((c) => c.source_item_id)).toEqual(["LOT-12"]);
  });

  it("rebuilt: the live card is refreshed to the received card on EVERY customer-facing field", async () => {
    world("received");
    await stage();
    const received = itemInserts().find((c) => c.source_item_id === "LOT-12")!;
    net.reqs.length = 0;
    world("rebuilt");
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: true, added: 0, merged: 0, carried: 2, withheld: 1 });
    const rebuilt = itemInserts().find((c) => c.source_item_id === "LOT-12")!;
    expect(pick(rebuilt, PARITY_FIELDS)).toEqual(pick(received, PARITY_FIELDS));
    // the facts the certificate proved, not Cultivera's percent-as-mg
    expect(rebuilt).toMatchObject({ thc: "55mg", cbd: "100mg", package_thc_mg: 55, mg_per_serving: 5.5, servings_per_pack: 10 });
  });

  it("rebuilt: the description is the received card's too (Cultivera left it blank)", async () => {
    world("received");
    await stage();
    const received = itemInserts().find((c) => c.source_item_id === "LOT-12")!;
    net.reqs.length = 0;
    world("rebuilt");
    await stage();
    const rebuilt = itemInserts().find((c) => c.source_item_id === "LOT-12")!;
    expect(String(received.description).length).toBeGreaterThan(0);
    expect(rebuilt.description).toBe(received.description);
  });

  it("rebuilt: sellable stays sellable - price, sizes, stock, visibility and order are the live ones", async () => {
    world("rebuilt");
    await stage();
    const cards = itemInserts();
    expect(cards.map((c) => c.source_item_id)).toEqual(["LOT-12", "LOT-13"]); // no new card, none dropped
    for (const c of cards) {
      const n = Number(String(c.source_item_id).split("-")[1]);
      expect(pick(c, PROTECTED)).toEqual(pick(cultiveraCard(n), PROTECTED));
    }
    expect(cards.map((c) => c.sort_order)).toEqual([0, 1]);
    const vs = variantInserts();
    expect(vs.map((v) => [v.source_variant_id, v.label, v.price_minor_units, v.inventory_level, v.medical])).toEqual([
      ["LOT-12", "10pk", 1800, 7, false],
      ["LOT-13", "10pk", 1800, 7, false],
    ]);
  });

  it("rebuilt: an unverified product (Honeydew Melon, 11 mg/serving) KEEPS its live card on sale, unchanged", async () => {
    world("rebuilt");
    await stage();
    const c13 = itemInserts().find((c) => c.source_item_id === "LOT-13")!;
    const live13 = cultiveraCard(13) as Record<string, unknown>;
    const { id: _id, menu_version_id: _v, sort_order: _s, ...rest } = live13;
    void _id; void _v; void _s;
    expect(pick(c13, Object.keys(rest))).toEqual(pick(rest, Object.keys(rest)));
    expect(diags().some((d) => d.code === FACT_FLAG_CODE && d.context?.pos_product_key === "LOT-13")).toBe(true);
    const w = events().find((e) => e.event_type === "menu_published_some_withheld")!;
    expect(w.note).toContain("still on sale");
    expect(w.note).not.toContain("kept off");
  });

  it("rebuilt: the lot's golden record gets the verified facts, never wiping and never touching stock", async () => {
    world("rebuilt");
    await stage();
    const w = lotWrites();
    expect(w).toHaveLength(1);
    expect(w[0].url.searchParams.get("id")).toBe(`eq.${LOT12}`);
    const patch = w[0].body as Record<string, unknown>;
    expect(patch).toMatchObject({ package_thc_mg: 55, mg_per_serving: 5.5, servings_per_pack: 10 });
    for (const k of Object.keys(patch)) expect(k).not.toMatch(/status|qty|cost|ccrs|disposition/);
    for (const [k, v] of Object.entries(patch)) if (k !== "fact_provenance") expect(v).not.toBeNull();
    expect((patch.fact_provenance as Record<string, string>).net_volume_ml).toBe("human"); // prior provenance kept
    expect(patch.net_volume_ml).toBeUndefined(); // a fact we did not verify is never written
    expect((patch.fact_provenance as Record<string, string>).package_thc_mg).toBe("coa");
  });

  it("rebuilt: the update says what it did (summary, notes, timeline)", async () => {
    world("rebuilt");
    await stage();
    const s = summary();
    expect(s.summary_json.origin).toBe("intake");
    expect(s.summary_json.cultivera_refresh).toEqual({ refreshed: ["LOT-12"], unchanged: [], not_live: [] });
    expect(s.notes).toMatch(/no new products, 2 live items carried\. 1 live card rebuilt from onboarding \(received via Cultivera\); prices, sizes and visibility unchanged\.$/);
    const ev = events().find((e) => e.event_type === "cultivera_cards_refreshed")!;
    expect(ev.note).toContain("Prices, sizes, stock and visibility did not change.");
    expect(ev.note).toContain("The update is live.");
  });

  it("rebuilt: the vendor-id restock match is never asked for (a refresh never matches or merges)", async () => {
    const prev = process.env.INTAKE_VENDOR_ID_IDENTITY;
    process.env.INTAKE_VENDOR_ID_IDENTITY = "on";
    try {
      world("rebuilt");
      await stage();
      expect(net.calls).not.toContain("vendor-id-read");
      // Control: the SAME world (cards live) as a native delivery does ask (the spy is live).
      net.calls.length = 0;
      world("rebuilt", "wcia");
      await stage();
      expect(net.calls).toContain("vendor-id-read");
    } finally {
      if (prev === undefined) delete process.env.INTAKE_VENDOR_ID_IDENTITY;
      else process.env.INTAKE_VENDOR_ID_IDENTITY = prev;
    }
  });

  it("switch off: a rebuilt manifest builds nothing (the S3 rule), and the menu is never written", async () => {
    process.env.CULTIVERA_CARD_REFRESH = "off";
    world("rebuilt");
    const out = await stage();
    expect(out).toMatchObject({ staged: false, reason: "migration-manifest" });
    expect(net.reqs.some((r) => r.method !== "GET" && r.method !== "HEAD")).toBe(false);
  });

  it("re-approving an already refreshed card builds no redundant version", async () => {
    world("rebuilt");
    await stage();
    const refreshed = itemInserts().map((c, k) => ({ ...c, id: `live-r${k}`, menu_version_id: "pub-1" }));
    const vs = variantInserts();
    net.reqs.length = 0;
    world("rebuilt");
    const prev = net.route!;
    net.route = (r) => {
      const t = table(r);
      if (t === "menu_items" && r.method === "GET") return { status: 200, body: pageOf(refreshed, r) };
      if (t === "menu_variants" && r.method === "GET") return { status: 200, body: pageOf(vs.map((v, k) => ({ ...v, id: `vv${k}`, menu_item_id: `live-r${k}` })), r) };
      return prev(r);
    };
    const out = await stage();
    // Sour Mandarin already matches; Honeydew Melon's refresh is still
    // withheld (its fact is unverified). Nothing to publish, nothing held,
    // and the timeline says the card keeps selling.
    expect(out).toMatchObject({ staged: false, reason: "no-new-items" });
    expect(net.reqs.some((r) => table(r) === "menu_versions" && r.method === "POST")).toBe(false);
    const w = events().find((e) => e.event_type === "menu_published_some_withheld")!;
    expect(w.note).toMatch(/^No menu update was needed\. 1 product from Cultivera keeps its current card \(still on sale\)/);
  });

  it("withhold switched off: the flag holds the whole update (native rule), never auto-published", async () => {
    process.env.INTAKE_FACT_WITHHOLD = "off";
    world("rebuilt");
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: false, reason: "held-for-fact-review" });
    expect(net.reqs.some((r) => r.method === "POST" && r.url.pathname.endsWith("/rpc/publish_menu_version"))).toBe(false);
  });
});
