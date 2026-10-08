/**
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

const draft = (i: number, id: string, lot: string) => ({
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
  price_minor_units: 2000,
  updated_at: "2026-01-01T00:00:00Z",
  lot_id: lot,
  chosen_house_type: null,
  chosen_strain_type: null,
});
const labRow = (i: number, id: string, read: boolean) => ({
  id,
  coa_extract_json: read ? JSON.parse(JSON.stringify(makeExtract(i, "unpdf"))) : null,
  total_thc_pct: pot(i, "total-thc"),
  total_cbd_pct: pot(i, "total-cbd"),
  cbd_pct: null,
});

function world(read: boolean) {
  net.route = (r) => {
    const t = table(r);
    if (t === "catalog_product_drafts") return { status: 200, body: [draft(12, D12, LOT12), draft(13, D13, LOT13)] };
    if (t === "inventory_lots" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("lab_result_id")) return { status: 200, body: pageOf([{ id: LOT12, lab_result_id: LAB12 }, { id: LOT13, lab_result_id: LAB13 }], r) };
      return { status: 200, body: [] };
    }
    if (t === "lab_results" && r.method === "GET") return { status: 200, body: pageOf([labRow(12, LAB12, read), labRow(13, LAB13, read)], r) };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") return { status: 200, body: [{ id: "pub-1" }] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.staged") return { status: 200, body: [] };
    if (t === "menu_items" && r.method === "HEAD") return { status: 200, range: "0-0/0" };
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
const diags = () => ((versionInsert()!.body as { summary_json: { diagnostics: Diag[] } }).summary_json.diagnostics);
const itemInserts = () => net.reqs.filter((r) => table(r) === "menu_items" && r.method === "POST").flatMap((r) => r.body as Record<string, unknown>[]);
async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}

describe("R28 a read certificate fills the facts the transfer never had (real staging)", () => {
  it("not read: both edibles held, nothing filled (the percent-as-mg cards)", async () => {
    world(false);
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: false, reason: "held-for-fact-review" });
    const holds = diags().filter((d) => d.code === FACT_FLAG_CODE).map((d) => d.context?.pos_product_key);
    expect(holds.sort()).toEqual(["LOT-12", "LOT-13"]);
    expect(diags().some((d) => d.code === "coa_facts_applied")).toBe(false);
    const c12 = itemInserts().find((i) => i.source_item_id === "LOT-12")!;
    expect(c12.package_thc_mg).toBeNull();
    expect(c12.mg_per_serving).toBeNull();
    expect(c12.thc).toBe("0.12mg");
  });

  it("read: Sour Mandarin publishes with the certificate's facts; ONLY Honeydew Melon is kept off, with the WA reason", async () => {
    world(true);
    const out = await stage();
    expect(out).toMatchObject({ staged: true, published: true, added: 1, withheld: 1 });
    const cards = itemInserts();
    expect(cards.map((c) => c.source_item_id)).toEqual(["LOT-12"]);
    expect(cards[0]).toMatchObject({ thc: "55mg", cbd: "100mg", package_thc_mg: 55, mg_per_serving: 5.5, servings_per_pack: 10 });
    expect(cards[0].fact_provenance).toMatchObject({ package_thc_mg: "coa", package_cbd_mg: "coa", mg_per_serving: "coa", servings_per_pack: "name" });
    const applied = diags().find((d) => d.code === "coa_facts_applied")!;
    expect(applied.context).toMatchObject({ pos_product_key: "LOT-12", servingWeightG: 4.54, thcMgPerServing: 5.5, packageThcMg: 55 });
    expect(diags().some((d) => d.code === "thc_package_total_override" && d.context?.pos_product_key === "LOT-12")).toBe(true);
    const holds = diags().filter((d) => d.code === FACT_FLAG_CODE);
    expect(holds.map((d) => d.context?.pos_product_key)).toEqual(["LOT-13"]);
    expect(holds[0].message).toContain("11 mg THC per serving");
    expect(holds[0].message).toContain("WAC 314-55-095");
    expect(diags().some((d) => d.code === FACT_FLAG_CODE && d.context?.pos_product_key === "LOT-12")).toBe(false);
  });

  it("the certificate read goes lots -> labs by id (never by name)", async () => {
    world(true);
    await stage();
    const lots = net.reqs.find((r) => table(r) === "inventory_lots" && (r.url.searchParams.get("select") ?? "").includes("lab_result_id"))!;
    expect(lots.url.searchParams.get("id")).toBe(`in.(${LOT12},${LOT13})`);
    const labs = net.reqs.find((r) => table(r) === "lab_results")!;
    expect(labs.url.searchParams.get("id")).toBe(`in.(${LAB12},${LAB13})`);
  });
});
