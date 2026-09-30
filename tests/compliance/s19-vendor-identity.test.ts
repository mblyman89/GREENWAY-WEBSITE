/**
 * tests/compliance/s19-vendor-identity.test.ts
 *
 * S19 - Vendor-id identity for restock merge + "will join live card" preview
 * (bible S19, findings F-066, F-072, F-071, F-059, F-068).
 *
 *   1. pure cores: exact self-test counts (a deleted check turns this red),
 *      the flag, the PACK_AXIS mirror pinned equal to the planner's.
 *   2. S19.5 / S19.6 on the REAL staging executor over a fake network:
 *      a different vendor spelling with the same vendor record MERGES; with
 *      the flag off (or a failed id read) the pre-S19 name rule stands.
 *   3. the latent carry-forward defect, fixed fail-closed: the live menu is
 *      read PAGED with a COUNT witness; a short read, a failed page or a
 *      failed published read stages NOTHING and says so on the timeline.
 *   4. the preview server: flag, named columns, caps, honest failure modes.
 *   5. the chip (render) + the Onboarding wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  VENDOR_ID_IDENTITY_ENV,
  vendorIdIdentityEnabled,
  vendorIdKey,
  restockChipCopy,
  restockChipFixHref,
  previewUnavailableCopy,
  __runVendorIdentityCoreTests,
  type RestockVerdict,
} from "@/lib/inventory/vendor-identity-core";
import { PACK_CATEGORY_AXIS, __runIntakeMasteringCoreTests } from "@/lib/pos/intake-mastering-core";
import {
  CARRY_FORWARD_INCOMPLETE_EVENT,
  CARRY_FORWARD_INCOMPLETE_REASON,
  carryForwardVerdict,
  carryForwardIncompleteNote,
  __runIntakeMenuStagingCoreTests,
} from "@/lib/pos/intake-menu-staging-core";
import { restockPreviewPlan, __runRestockPreviewViewTests } from "@/lib/inventory/restock-preview-view-core";
import { RestockPreviewChip, RestockPreviewUnavailable, restockFixLabel } from "@/components/admin/catalog/RestockPreviewChip";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// -- Fake network for the REAL postgrest client -------------------------------
type Req = { method: string; url: URL; body: unknown; headers: Headers };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown; headers: Headers }) => { status: number; body?: unknown; range?: string } | undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => undefined }));
vi.mock("@/lib/pos/menu-version", () => ({ archiveSupersededStaged: async () => 0 }));
vi.mock("@/lib/pos/cutover-guard", () => ({ shouldHoldForCutover: async () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) => lots.map(() => ({ websiteCategory: "flower" })),
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
const sel = (r: Req) => r.url.searchParams.get("select") ?? "";
const offset = (r: Req) => Number(r.url.searchParams.get("offset") ?? "0");
const limit = (r: Req) => Number(r.url.searchParams.get("limit") ?? "1000000");
/** Values of an `in.(a,b)` filter. */
const inList = (r: Req, col: string) => {
  const v = r.url.searchParams.get(col) ?? "";
  const m = v.match(/^in\.\((.*)\)$/);
  return m ? m[1].split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
};
const pageOf = <T,>(rows: T[], r: Req) => rows.slice(offset(r), offset(r) + limit(r));

beforeEach(() => {
  net.reqs.length = 0;
  net.route = null;
  delete process.env[VENDOR_ID_IDENTITY_ENV];
  process.env.INTAKE_BATCH_STAGING = "off";
});
afterEach(() => {
  delete process.env[VENDOR_ID_IDENTITY_ENV];
  delete process.env.INTAKE_BATCH_STAGING;
});

// === 1. Pure cores ============================================================
describe("S19 pure cores", () => {
  it("self-tests pass with exact counts (a deleted check turns this red)", () => {
    expect(__runVendorIdentityCoreTests().passed).toBe(74);
    expect(__runIntakeMasteringCoreTests().passed).toBe(182);
    expect(__runIntakeMenuStagingCoreTests().passed).toBe(74);
    expect(__runRestockPreviewViewTests().passed).toBe(11);
  });
  it("both self-test suites are registered in the pure runner (CI runs them)", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runVendorIdentityCoreTests } from "../../src/lib/inventory/vendor-identity-core";');
    expect(runner).toContain('import { __runRestockPreviewViewTests } from "../../src/lib/inventory/restock-preview-view-core";');
    expect(runner).toMatch(/\n\s+__runVendorIdentityCoreTests\(\);/);
    expect(runner).toMatch(/\n\s+__runRestockPreviewViewTests\(\);/);
  });
  it("the flag is INTAKE_VENDOR_ID_IDENTITY, on unless an off-word (S19.7 Flag)", () => {
    expect(VENDOR_ID_IDENTITY_ENV).toBe("INTAKE_VENDOR_ID_IDENTITY");
    expect(vendorIdIdentityEnabled(undefined)).toBe(true);
    expect(vendorIdIdentityEnabled("")).toBe(true);
    for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) expect(vendorIdIdentityEnabled(w)).toBe(false);
    expect(vendorIdIdentityEnabled("on")).toBe(true);
    expect(vendorIdIdentityEnabled("junk")).toBe(true);
  });
  it("the PACK_AXIS mirror equals the planner's PACK_CATEGORY_AXIS", () => {
    for (const [pack, single] of Object.entries(PACK_CATEGORY_AXIS)) {
      expect(vendorIdKey("V", pack, "f")).toBe(vendorIdKey("V", single, "f"));
    }
    // and nothing else folds
    expect(vendorIdKey("V", "flower", "f")).toBe("vid:V|flower|f");
    const src = read("src/lib/inventory/vendor-identity-core.ts");
    const mirror = src.match(/const PACK_AXIS: Record<string, string> = \{([^}]*)\}/)![1];
    const pairs = [...mirror.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(pairs)).toEqual(PACK_CATEGORY_AXIS);
  });
  it("S19.4 chip copy is the bible's, word for word", () => {
    const v: RestockVerdict = { kind: "joins", cardKey: "pos-1", cardName: "Blue Dream 3.5g", fromCultivera: true, matchedBy: "vendor_id", vendorRecordDiffers: false };
    expect(restockChipCopy(v)).toBe("Restock \u2192 joins live card 'Blue Dream 3.5g' (from Cultivera import)");
  });
  it("carry-forward verdict: complete only with no failure and rows == count", () => {
    expect(carryForwardVerdict({ readFailed: false, rowsRead: 5, expectedTotal: 5 })).toEqual({ complete: true, missing: 0 });
    expect(carryForwardVerdict({ readFailed: false, rowsRead: 2, expectedTotal: 5 }).complete).toBe(false);
    expect(carryForwardVerdict({ readFailed: true, rowsRead: 5, expectedTotal: 5 }).complete).toBe(false);
    expect(carryForwardVerdict({ readFailed: false, rowsRead: 5, expectedTotal: null }).complete).toBe(false);
    expect(CARRY_FORWARD_INCOMPLETE_REASON).toBe("carry-forward-incomplete");
    expect(CARRY_FORWARD_INCOMPLETE_EVENT).toBe("menu_carry_forward_incomplete");
  });
});

// === Fixtures for the executor ================================================
const M = "11111111-1111-4111-8111-111111111111";
const draftRow = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  pos_product_key: "LOT-A",
  name: "Blue Dream 1g",
  brand_name: "Fairwinds",
  vendor_name: "Fairwinds LLC",
  strain_name: "Blue Dream",
  thc_pct: 21.5,
  cbd_pct: 0.4,
  total_thc_pct: 24.1,
  potency_json: null,
  price_minor_units: 1200,
  updated_at: "2026-01-01T00:00:00Z",
  lot_id: null,
  inventory_type: "Usable Marijuana",
  category: "Flower",
  chosen_website_category: "flower",
  chosen_house_type: null,
  chosen_strain_type: null,
  ...over,
});
/** A Cultivera-born live card: vendor spelled from INVENTORIES `Vendor`. */
const cultItem = (i = 0, over: Record<string, unknown> = {}) => ({
  id: `mi-${i}`,
  source_item_id: i === 0 ? "pos-0123456789ab" : `pos-filler${String(i).padStart(6, "0")}`,
  name: i === 0 ? "Blue Dream" : `Filler ${i}`,
  product_name: null,
  brand_name: "Fairwinds",
  vendor_name: i === 0 ? "Fairwinds Manufacturing" : "Other Farm",
  category: i === 0 ? "flower" : "vape",
  strain_name: i === 0 ? "Blue Dream" : `Filler ${i}`,
  hidden: false,
  sort_order: i,
  price_minor_units: 3000,
  ...over,
});

type World = {
  drafts?: unknown[];
  published?: { id: string } | null;
  publishedErr?: boolean;
  items?: ReturnType<typeof cultItem>[];
  itemsErrAtOffset?: number;
  count?: number | null;
  countErr?: boolean;
  variantsErr?: boolean;
  variantMedical?: boolean;
  lotVendors?: { pos_product_key: string; vendor_id: string | null }[];
  lotVendorsErr?: boolean;
};

function world(w: World) {
  const items = w.items ?? [cultItem(0)];
  net.route = (r) => {
    const t = table(r);
    if (t === "catalog_product_drafts") return { status: 200, body: w.drafts ?? [draftRow()] };
    if (t === "menu_versions" && r.method === "GET" && r.url.searchParams.get("status") === "eq.published") {
      if (w.publishedErr) return { status: 500, body: { message: "pub read boom" } };
      return { status: 200, body: w.published === null ? [] : [w.published ?? { id: "pub-1" }] };
    }
    if (t === "menu_items" && r.method === "HEAD") {
      if (w.countErr) return { status: 500, body: { message: "count boom" } };
      const n = w.count === undefined ? items.length : w.count;
      return { status: 200, range: n === null ? undefined : `0-0/${n}` };
    }
    if (t === "menu_items" && r.method === "GET") {
      if (w.itemsErrAtOffset !== undefined && offset(r) >= w.itemsErrAtOffset) return { status: 500, body: { message: "items boom" } };
      const cats = inList(r, "category");
      const rows = cats.length ? items.filter((it) => cats.includes(String(it.category))) : items;
      return { status: 200, body: pageOf(rows, r) };
    }
    if (t === "menu_variants" && r.method === "GET") {
      if (w.variantsErr) return { status: 500, body: { message: "variants boom" } };
      const ids = inList(r, "menu_item_id");
      const rows = ids.includes("mi-0")
        ? [{ id: "mv-0", menu_item_id: "mi-0", source_variant_id: "pos-0123456789ab-aa11", label: "3.5g", price_minor_units: 3000, inventory_level: 5, medical: w.variantMedical === true, sort_order: 0 }]
        : [];
      return { status: 200, body: pageOf(rows, r) };
    }
    if (t === "inventory_lots" && r.method === "GET" && sel(r) === "pos_product_key,vendor_id") {
      if (w.lotVendorsErr) return { status: 500, body: { message: "lots boom" } };
      const keys = inList(r, "pos_product_key");
      const rows = (w.lotVendors ?? []).filter((l) => keys.includes(l.pos_product_key));
      return { status: 200, body: pageOf(rows, r) };
    }
    if (t === "menu_versions" && r.method === "POST") return { status: 201, body: { id: "v-new", created_at: "2026-02-01T00:00:00Z", status: "staged" } };
    if (t === "menu_items" && r.method === "POST") {
      const rows = r.body as { source_item_id: string }[];
      return { status: 201, body: rows.map((x, k) => ({ id: `new-${k}-${x.source_item_id}`, source_item_id: x.source_item_id })) };
    }
    return undefined;
  };
}

const versionInsert = () => net.reqs.find((r) => table(r) === "menu_versions" && r.method === "POST");
const summary = () => (versionInsert()!.body as { summary_json: Record<string, unknown> }).summary_json;
const events = () =>
  net.reqs.filter((r) => table(r) === "manifest_events" && r.method === "POST").map((r) => r.body as { event_type: string; note: string });
const vendorReads = () => net.reqs.filter((r) => table(r) === "inventory_lots" && sel(r) === "pos_product_key,vendor_id");

async function stage() {
  const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
  return stageIntakeMenuVersionForManifest(M, "u1");
}

// === 2. S19.5 / S19.6 on the real executor ====================================
describe("S19.5 restock merge by vendor record (real staging, fake network)", () => {
  const ids = [
    { pos_product_key: "LOT-A", vendor_id: "V-FW" },
    { pos_product_key: "pos-0123456789ab", vendor_id: "V-FW" },
  ];

  it("different vendor spelling + same vendor_id -> merges onto the Cultivera card (no duplicate)", async () => {
    world({ lotVendors: ids });
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(out.added).toBe(0);
    expect(out.merged).toBe(1);
    const restock = (summary().diagnostics as { code: string; context?: Record<string, unknown> }[]).find((d) => d.code === "intake_master_restock");
    expect(restock?.context?.matched_by).toBe("vendor_id");
  });

  it("vendor-id reads name their two columns, page with a range, and ask only for the lots that matter", async () => {
    world({ lotVendors: ids, items: [cultItem(0), cultItem(1)] });
    await stage();
    const reads = vendorReads();
    expect(reads.length).toBe(2);
    for (const r of reads) {
      expect(sel(r)).toBe("pos_product_key,vendor_id");
      expect(r.url.searchParams.get("offset")).toBe("0");
      expect(r.url.searchParams.get("order")).toBe("id.asc");
    }
    expect(inList(reads[0], "pos_product_key")).toEqual(["LOT-A"]);
    // the vape filler card is never asked about (different axis/family)
    expect(inList(reads[1], "pos_product_key")).toEqual(["pos-0123456789ab"]);
  });

  it("flag off -> ZERO vendor-id reads and the pre-S19 name rule (a second card)", async () => {
    process.env[VENDOR_ID_IDENTITY_ENV] = "off";
    world({ lotVendors: ids });
    const out = await stage();
    expect(vendorReads()).toHaveLength(0);
    expect(out.added).toBe(1);
    expect(out.merged).toBe(0);
  });

  it("a failed vendor-id read -> the name rule, never a partial id set", async () => {
    world({ lotVendors: ids, lotVendorsErr: true });
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(out.added).toBe(1);
    expect(out.merged).toBe(0);
  });

  it("different vendor records -> still a new card (never guessed)", async () => {
    world({ lotVendors: [{ pos_product_key: "LOT-A", vendor_id: "V-X" }, { pos_product_key: "pos-0123456789ab", vendor_id: "V-FW" }] });
    const out = await stage();
    expect(out.added).toBe(1);
    expect(out.merged).toBe(0);
  });

  it("S19.8: a blank-vendor Cultivera card never merges, even with a matching id", async () => {
    world({ lotVendors: ids, items: [cultItem(0, { vendor_name: "" })] });
    const out = await stage();
    expect(out.added).toBe(1);
    expect(out.merged).toBe(0);
  });

  it("nothing live -> no vendor-id reads at all", async () => {
    world({ published: null, lotVendors: ids });
    const out = await stage();
    expect(out.staged).toBe(true);
    expect(vendorReads()).toHaveLength(0);
  });
});

// === 3. Carry-forward: paged, witnessed, fail-closed ==========================
describe("S19 carry-forward is the WHOLE live menu or nothing", () => {
  it("reads past PostgREST's 1,000-row cap: pages by sort_order+id and carries all 1,001", async () => {
    const items = [cultItem(0), ...Array.from({ length: 1000 }, (_, i) => cultItem(i + 1))];
    world({ items, lotVendors: [] });
    const out = await stage();
    expect(out.staged).toBe(true);
    const pages = net.reqs.filter((r) => table(r) === "menu_items" && r.method === "GET" && sel(r) === "*");
    expect(pages.map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(pages[0].url.searchParams.get("order")).toBe("sort_order.asc,id.asc");
    expect(out.carried).toBe(1001);
    const head = net.reqs.find((r) => table(r) === "menu_items" && r.method === "HEAD")!;
    expect(head.headers.get("Prefer")).toContain("count=exact");
  });

  it("a short read (count says more) stages NOTHING and says how many were missing", async () => {
    world({ count: 5 });
    const out = await stage();
    expect(out).toMatchObject({ staged: false, reason: CARRY_FORWARD_INCOMPLETE_REASON });
    expect(versionInsert()).toBeUndefined();
    const ev = events().find((e) => e.event_type === CARRY_FORWARD_INCOMPLETE_EVENT)!;
    expect(ev.note).toBe(carryForwardIncompleteNote({ missing: 4 }));
  });

  it("a failed items page stages nothing", async () => {
    world({ itemsErrAtOffset: 0 });
    const out = await stage();
    expect(out.reason).toBe(CARRY_FORWARD_INCOMPLETE_REASON);
    expect(versionInsert()).toBeUndefined();
  });

  it("a failed LATER items page stages nothing even when the count happens to match the rows read", async () => {
    // 1,001 rows, page 2 fails, the witness says 1,000 (a row added between
    // the count and the read): only the failure flag can catch this one.
    const items = [cultItem(0), ...Array.from({ length: 1000 }, (_, i) => cultItem(i + 1))];
    world({ items, itemsErrAtOffset: 1000, count: 1000, lotVendors: [] });
    const out = await stage();
    expect(out.reason).toBe(CARRY_FORWARD_INCOMPLETE_REASON);
    expect(versionInsert()).toBeUndefined();
  });

  it("a failed variants read stages nothing (cards without sizes would be published)", async () => {
    world({ variantsErr: true });
    const out = await stage();
    expect(out.reason).toBe(CARRY_FORWARD_INCOMPLETE_REASON);
    expect(versionInsert()).toBeUndefined();
  });

  it("an unknown count (failed HEAD) stages nothing", async () => {
    world({ countErr: true });
    const out = await stage();
    expect(out.reason).toBe(CARRY_FORWARD_INCOMPLETE_REASON);
    expect(versionInsert()).toBeUndefined();
  });

  it("a failed published-version read is NOT 'nothing live': stages nothing, notes the timeline", async () => {
    world({ publishedErr: true });
    const out = await stage();
    expect(out.reason).toBe(CARRY_FORWARD_INCOMPLETE_REASON);
    expect(versionInsert()).toBeUndefined();
    expect(net.reqs.some((r) => table(r) === "menu_items")).toBe(false);
    expect(events().map((e) => e.event_type)).toEqual([CARRY_FORWARD_INCOMPLETE_EVENT]);
    expect(events()[0].note).toBe(carryForwardIncompleteNote({ missing: null }));
  });
});

// === 4. Preview server ========================================================
describe("S19.2 preview server (loadRestockPreview)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "d1",
    pos_product_key: "LOT-A",
    name: "Blue Dream 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "Blue Dream",
    category: "flower",
    ...over,
  });
  const load = async (rows = [row()]) => {
    const { loadRestockPreview } = await import("@/lib/inventory/restock-preview-server");
    return loadRestockPreview(rows);
  };
  const ids = [
    { pos_product_key: "LOT-A", vendor_id: "V-FW" },
    { pos_product_key: "pos-0123456789ab", vendor_id: "V-FW" },
  ];

  it("flag off -> says so and makes ZERO requests", async () => {
    process.env[VENDOR_ID_IDENTITY_ENV] = "off";
    world({});
    expect(await load()).toEqual({ ok: false, reason: "flag_off" });
    expect(net.reqs).toHaveLength(0);
  });

  it("joins the Cultivera card via the vendor record, reading NAMED columns of only this category", async () => {
    world({ lotVendors: ids, items: [cultItem(0), cultItem(1)] });
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.matchedByVendorId).toBe(true);
    expect(restockChipCopy(res.verdicts.get("d1")!)).toBe("Restock \u2192 joins live card 'Blue Dream' (from Cultivera import)");
    const itemsReq = net.reqs.find((r) => table(r) === "menu_items")!;
    expect(sel(itemsReq)).toBe("id,source_item_id,name,brand_name,vendor_name,category,strain_name,hidden");
    expect(inList(itemsReq, "category")).toEqual(["flower"]);
    expect(itemsReq.url.searchParams.get("menu_version_id")).toBe("eq.pub-1");
    const vReq = net.reqs.find((r) => table(r) === "menu_variants")!;
    expect(sel(vReq)).toBe("menu_item_id,source_variant_id,medical");
    expect(net.reqs.every((r) => r.method === "GET")).toBe(true);
  });

  it("without ids the preview is the name rule (a new card) - it never over-promises", async () => {
    world({ lotVendors: [] });
    const res = await load();
    expect(res.ok && res.verdicts.get("d1")?.kind).toBe("new");
  });

  it("nothing published -> every usable row is a New card", async () => {
    world({ published: null });
    const res = await load();
    expect(res.ok && res.verdicts.get("d1")?.kind).toBe("new");
    expect(net.reqs.some((r) => table(r) === "menu_items")).toBe(false);
  });

  it("F-068 before Approve: a row whose key is already a live card says so", async () => {
    world({ lotVendors: [] });
    const res = await load([row({ pos_product_key: "pos-0123456789ab" })]);
    expect(res.ok && res.verdicts.get("d1")).toEqual({ kind: "already_live", cardKey: "pos-0123456789ab", asSize: false });
  });

  it("no categories -> no reads, empty verdicts", async () => {
    world({});
    const res = await load([row({ category: null })]);
    expect(res).toEqual({ ok: true, verdicts: new Map(), matchedByVendorId: false });
    expect(net.reqs).toHaveLength(0);
  });

  it("more live cards than the cap -> 'too many', never a verdict built on part of the menu", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => cultItem(i + 1, { category: "flower" }));
    world({ items: many });
    expect(await load()).toEqual({ ok: false, reason: "too_many" });
  });

  it("a failed vendor-id read -> the name rule, and the result says ids were NOT used", async () => {
    world({ lotVendors: ids, lotVendorsErr: true, items: [cultItem(0)] });
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.matchedByVendorId).toBe(false);
    expect(res.verdicts.get("d1")?.kind).toBe("new");
  });

  it("more live lot keys than VENDOR_ID_LIVE_KEY_CAP -> no vendor-id reads at all (never a partial id set)", async () => {
    // 2,001 same-family flower cards under another spelling: an id could
    // matter for each, so the plan is over the cap and skips ids entirely.
    const many = Array.from({ length: 2001 }, (_, i) =>
      cultItem(0, { id: `mi-x${i}`, source_item_id: `pos-${i.toString(16).padStart(12, "0")}` }),
    );
    world({ lotVendors: ids, items: many });
    const res = await load();
    expect(net.reqs.some((r) => table(r) === "inventory_lots")).toBe(false);
    expect(res.ok && res.matchedByVendorId).toBe(false);
  });

  it("a hidden live card is never a merge target", async () => {
    world({ lotVendors: ids, items: [cultItem(0, { hidden: true })] });
    const res = await load();
    expect(res.ok && res.verdicts.get("d1")?.kind).toBe("new");
  });

  it("a medical-only live card is never a merge target", async () => {
    world({ lotVendors: ids, items: [cultItem(0)], variantMedical: true });
    const res = await load();
    expect(res.ok && res.verdicts.get("d1")?.kind).toBe("new");
  });

  it("previewCategories reads the pack twin of a single form (packs fold onto the same axis)", async () => {
    const { previewCategories } = await import("@/lib/inventory/restock-preview-server");
    expect(previewCategories(["preroll"])).toEqual(["preroll", "preroll-pack"]);
    expect(previewCategories(["infused-preroll-pack"])).toEqual(["infused-preroll", "infused-preroll-pack"]);
    expect(previewCategories([" flower ", null, undefined, ""])).toEqual(["flower"]);
  });

  it("a failed read (published / items / variants) -> read_incomplete", async () => {
    world({ publishedErr: true });
    expect(await load()).toEqual({ ok: false, reason: "read_incomplete" });
    world({ itemsErrAtOffset: 0 });
    expect(await load()).toEqual({ ok: false, reason: "read_incomplete" });
    world({ variantsErr: true });
    expect(await load()).toEqual({ ok: false, reason: "read_incomplete" });
  });
});

// === 5. The chip + the Onboarding wiring ======================================
describe("S19.4 chip (render) and Onboarding wiring", () => {
  const html = (v: RestockVerdict) => renderToStaticMarkup(createElement(RestockPreviewChip, { verdict: v }));

  it("joins: the bible's copy, the reason in plain sight, no fix link", () => {
    const out = html({ kind: "joins", cardKey: "pos-1", cardName: "Blue Dream 3.5g", fromCultivera: true, matchedBy: "vendor_id", vendorRecordDiffers: false });
    expect(out).toContain("Restock \u2192 joins live card &#x27;Blue Dream 3.5g&#x27; (from Cultivera import)");
    expect(out).toContain("does not create a second card");
    expect(out).not.toContain("restock-fix");
    expect(out).toContain('data-kind="joins"');
  });

  it("every chip that asks for a fix carries the link that fixes it", () => {
    // F-096: Product Mastering is never read by the merge - no dead-end link.
    // The owner gets the matching live cards to compare (published keys, so
    // /admin/products/[key] resolves).
    const amb = html({ kind: "ambiguous", cardKeys: ["pos-0123456789ab", "LOT 7/b"] });
    expect(amb).not.toContain("/admin/products/masters");
    expect(amb).not.toContain("Mastering");
    expect(amb).not.toContain("restock-fix");
    expect(amb).toContain('data-testid="restock-compare"');
    expect(amb).toContain('href="/admin/products/pos-0123456789ab"');
    expect(amb).toContain('href="/admin/products/LOT%207%2Fb"');
    expect(amb).toContain(">Live card 1</a>");
    expect(amb).toContain(">Live card 2</a>");
    expect(amb).toContain("Nothing blocks Approve");
    const diff = html({ kind: "joins", cardKey: "c", cardName: "X", fromCultivera: false, matchedBy: "name", vendorRecordDiffers: true });
    expect(diff).toContain('href="/admin/vendors/merge"');
    expect(diff).toContain("Combine the vendor records");
    for (const v of [{ kind: "new" }, { kind: "no_vendor" }, { kind: "vague_name" }, { kind: "already_live", cardKey: "k", asSize: true }] as RestockVerdict[]) {
      expect(restockChipFixHref(v)).toBeNull();
      expect(html(v)).not.toContain("<a ");
    }
    expect(restockFixLabel("/admin/vendors/merge")).toBe("Combine the vendor records");
    expect(restockFixLabel("/admin/anything-else")).toBe("Fix");
    expect(html({ kind: "joins", cardKey: "c", cardName: "X", fromCultivera: false, matchedBy: "name", vendorRecordDiffers: false })).not.toContain("restock-compare");
  });

  it("every link the chip can emit lands on a real page that can act (S26-style, F-096)", () => {
    // Fix link: the vendor-merge page exists and posts the real merge action.
    const merge = read("src/app/admin/vendors/merge/page.tsx");
    expect(merge).toContain("mergeVendorsAction");
    // ...and the merge RPC moves the lots' vendor_id - the thing the id match reads.
    expect(read("supabase/migrations/0104_merge_vendors.sql")).toContain(
      "update public.inventory_lots set vendor_id = survivor_id where vendor_id = any(duplicate_ids);",
    );
    // Compare links: /admin/products/[key] resolves any key on the PUBLISHED
    // version, and the preview only ever reads live cards from that version.
    const product = read("src/app/admin/products/[key]/page.tsx");
    expect(product).toContain("const published = await getPublishedVersion();");
    expect(product).toContain("const item = await getItemBySourceKey(published.id, key);");
    expect(product).toContain('name="visibility"');
    const server = read("src/lib/inventory/restock-preview-server.ts");
    expect(server).toContain('.eq("status", "published")');
    expect(server).toContain('.eq("menu_version_id", publishedId)');
    // No emitted href points at Product Mastering (never read by the merge).
    const core = read("src/lib/inventory/vendor-identity-core.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
      .join("\n");
    expect(core).not.toContain('return "/admin/products/masters"');
  });

  it("the unavailable line renders the core copy", () => {
    const out = renderToStaticMarkup(createElement(RestockPreviewUnavailable, { text: previewUnavailableCopy("too_many") }));
    expect(out).toContain("too many live cards to preview");
    expect(out).toContain('data-testid="restock-preview-unavailable"');
  });

  it("the page loads the preview only per the pure plan, with the staging's category rule", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("restockPreviewPlan({ view, manifestId: focus.manifestId, rows: drafts.length })");
    expect(page).toContain("previewPlan.load");
    expect(page).toContain("category: d.chosen_website_category?.trim() || resolutions[i]?.websiteCategory || null");
    const staging = read("src/lib/pos/intake-menu-staging.ts");
    expect(staging).toContain("category: d.chosen_website_category?.trim() || resolutions[i]?.websiteCategory || null");
    expect(page).toContain("<RestockPreviewChip verdict={previewVerdicts.get(d.id)!} />");
    expect(page).toContain("<RestockPreviewUnavailable text={previewNote} />");
    expect(restockPreviewPlan({ view: "draft", manifestId: null, rows: 2 }).unavailable).toBe("no_delivery");
  });

  it("the preview server reads only - no insert/update/delete/upsert/rpc", () => {
    const full = read("src/lib/inventory/restock-preview-server.ts");
    // executable lines only (the header comment names what is forbidden)
    const src = full.split("\n").filter((l) => !/^\s*(\*|\/\*\*|\/\/)/.test(l)).join("\n");
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(src).not.toMatch(/select\("\*"\)/);
    expect(src).toContain('import "server-only"');
    expect(src).toContain(".select(LOT_VENDOR_COLUMNS)");
    expect(src).toContain(".select(PREVIEW_ITEM_COLUMNS)");
    expect(src).toContain(".select(PREVIEW_VARIANT_COLUMNS)");
  });
});
