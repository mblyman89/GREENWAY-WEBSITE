/**
 * tests/compliance/s14-onboarding-list.test.ts
 *
 * S14 — "Onboarding list: manifest filter, pagination, condensed rows"
 * (bible S14; findings F-001, F-006, F-034, F-080; requests R-ENRICH-FILTER,
 * R-ONBOARD-UX).
 *
 * Four layers, each against REAL code:
 *   1. the pure core: the bible's S14.5 "query builder pure tests for filter
 *      combinations", URL parsing, paging copy, the exact S14.4 header copy,
 *      the picker label / filter, the condensed-row chips;
 *   2. the REAL listCatalogDraftsPage / listCatalogDrafts / loadOnboardingPicker
 *      running through the REAL supabase-js + postgrest-js client, with only
 *      `fetch` faked — so what is asserted is the actual HTTP request PostgREST
 *      receives (path, query string, Prefer header) and the real parsing of its
 *      reply (content-range total, 416 past-the-end);
 *   3. structural pins on the drafts page (condensed <details>, filter bar,
 *      pager, header, S02 pins intact);
 *   4. registration in the pure self-test runner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DRAFT_LEGACY_LIMIT,
  DRAFT_MAX_PAGE,
  DRAFT_PAGE_SIZE_DEFAULT,
  DRAFT_SEARCH_COLUMNS,
  DRAFT_SEARCH_MAX_CHARS,
  PICKER_MAX_MANIFESTS,
  PICKER_WINDOW_DAYS,
  VENDOR_JOIN_COLUMN,
  VENDOR_JOIN_SELECT,
  __runOnboardingListCoreTests,
  buildDraftListPlan,
  deliveryWhen,
  draftSearchFilter,
  isPastEndError,
  manifestPickerLabel,
  onboardingHeaderTitle,
  onboardingListHref,
  pageWindow,
  parseOnboardingListParams,
  pickerManifestFilter,
  pickerSinceIso,
  pickerVendors,
  rowAttention,
  rowStartsOpen,
  shortDeliveryDate,
  summarizeManifestDrafts,
  type PickerManifestRow,
} from "@/lib/catalog/onboarding-list-core";

// ── The REAL client, fake network ─────────────────────────────────────────
type Req = { method: string; url: URL; prefer: string };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const reqs: Req[] = [];
let replies: ((r: Req) => Reply)[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null }));
vi.mock("@/lib/supabase/admin", async () => {
  // The REAL query builder: SupabaseClient.from() delegates to exactly this
  // PostgrestClient (supabase-js skips its realtime socket, which Node 20
  // cannot open in tests).
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init?.headers);
    const r: Req = { method: init?.method ?? "GET", url, prefer: h.get("Prefer") ?? "" };
    reqs.push(r);
    const next = replies.shift();
    const rep = next ? next(r) : { status: 200, body: [] };
    return new Response(JSON.stringify(rep.body), {
      status: rep.status,
      headers: { "content-type": "application/json", ...(rep.headers ?? {}) },
    });
  };
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }),
  };
});

const A = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const V = "11111111-2222-4333-8444-555555555555";
const V2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = new Date("2025-03-20T19:00:00Z");
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
/** Every value of one query param, decoded. */
const all = (r: Req, k: string) => r.url.searchParams.getAll(k);
const one = (r: Req, k: string) => r.url.searchParams.get(k);

const manifest = (over: Partial<PickerManifestRow> = {}): PickerManifestRow => ({
  id: M,
  manifest_number: "0421",
  vendor_id: V,
  vendor_label: "Phat Panda",
  transfer_date: "2025-03-11",
  received_at: "2025-03-12T18:30:00Z",
  accepted_at: "2025-03-12T18:45:00Z",
  status: "accepted",
  ...over,
});

// ═══ 1. Pure core ═════════════════════════════════════════════════════════

describe("S14 pure core — embedded self-tests", () => {
  it("pass with no failures", () => {
    const r = __runOnboardingListCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(77);
  });
});

describe("S14.5 query builder — filter combinations", () => {
  const eq = (column: string, value: string) => ({ op: "eq", column, value });

  it("legacy (no page) is EXACTLY the S02 query: status, newest first, limit 500, no count", () => {
    const p = buildDraftListPlan({ status: "draft" });
    expect(p).toMatchObject({
      mode: "legacy",
      select: "*",
      count: false,
      filters: [eq("status", "draft")],
      order: [{ column: "created_at", ascending: false }],
      range: null,
      limit: DRAFT_LEGACY_LIMIT,
      ignored: [],
    });
    expect(DRAFT_LEGACY_LIMIT).toBe(500);
  });

  it("legacy + manifest keeps S02's two eq filters in order", () => {
    expect(buildDraftListPlan({ status: "approved", manifestId: M }).filters).toEqual([eq("status", "approved"), eq("manifest_id", M)]);
  });

  it("legacy never silently applies search/vendor — it reports them as ignored", () => {
    const p = buildDraftListPlan({ status: "draft", q: "gummy", vendorId: V });
    expect(p.filters).toEqual([eq("status", "draft")]);
    expect(p.ignored).toEqual(["q", "vendor"]);
  });

  it("paged, no filters: status only, count on, stable order, range 0-49", () => {
    const p = buildDraftListPlan({ status: "draft", page: 1, pageSize: 50 });
    expect(p).toMatchObject({
      mode: "paged",
      select: "*",
      count: true,
      filters: [eq("status", "draft")],
      order: [
        { column: "created_at", ascending: false },
        { column: "id", ascending: false },
      ],
      range: { from: 0, to: 49 },
      limit: null,
      page: 1,
      pageSize: 50,
      ignored: [],
    });
  });

  it("paged + manifest", () => {
    expect(buildDraftListPlan({ status: "draft", manifestId: M, page: 1 }).filters).toEqual([eq("status", "draft"), eq("manifest_id", M)]);
  });

  it("paged + vendor joins through the manifest FK (not drafts.vendor_id, which needs 0234)", () => {
    const p = buildDraftListPlan({ status: "draft", vendorId: V, page: 1 });
    expect(p.select).toBe("*, inbound_manifests!inner(vendor_id)");
    expect(p.select).toBe(VENDOR_JOIN_SELECT);
    expect(p.filters).toEqual([eq("status", "draft"), eq("inbound_manifests.vendor_id", V)]);
    expect(VENDOR_JOIN_COLUMN).toBe("inbound_manifests.vendor_id");
  });

  it("paged + search: ONE or() over the five text columns", () => {
    const p = buildDraftListPlan({ status: "draft", q: "blue dream", page: 1 });
    expect(p.filters).toEqual([
      eq("status", "draft"),
      {
        op: "or",
        filter:
          "name.ilike.%blue dream%,brand_name.ilike.%blue dream%,vendor_name.ilike.%blue dream%,strain_name.ilike.%blue dream%,pos_product_key.ilike.%blue dream%",
      },
    ]);
    expect([...DRAFT_SEARCH_COLUMNS]).toEqual(["name", "brand_name", "vendor_name", "strain_name", "pos_product_key"]);
  });

  it("paged + manifest + vendor + search: all four, in that order", () => {
    const p = buildDraftListPlan({ status: "dismissed", manifestId: M, vendorId: V, q: "x", page: 3, pageSize: 25 });
    expect(p.filters.map((f) => (f.op === "eq" ? `eq:${f.column}` : "or"))).toEqual([
      "eq:status",
      "eq:manifest_id",
      `eq:${VENDOR_JOIN_COLUMN}`,
      "or",
    ]);
    expect(p.view).toBe("dismissed");
    expect(p.range).toEqual({ from: 50, to: 74 });
  });

  it("pinned (?draft=) is S02's single or() and ignores search/vendor/page — with the reason recorded", () => {
    const p = buildDraftListPlan({ status: "draft", manifestId: M, draftId: A, vendorId: V, q: "x", page: 4 });
    expect(p).toMatchObject({
      mode: "pinned",
      select: "*",
      count: false,
      filters: [{ op: "or", filter: `and(status.eq.draft,manifest_id.eq.${M}),id.eq.${A}` }],
      range: null,
      limit: 500,
      ignored: ["q", "vendor", "page"],
    });
    expect(buildDraftListPlan({ draftId: A }).filters).toEqual([{ op: "or", filter: `status.eq.draft,id.eq.${A}` }]);
  });

  it("bad ids and statuses never reach a filter", () => {
    const p = buildDraftListPlan({ status: "'; drop", manifestId: "nope", draftId: "x,id.eq.y", vendorId: "1", page: 1 });
    expect(p.mode).toBe("paged");
    expect(p.view).toBe("draft");
    expect(p.filters).toEqual([eq("status", "draft")]);
    expect(p.select).toBe("*");
  });

  it("uppercase UUIDs are normalized", () => {
    expect(buildDraftListPlan({ manifestId: M.toUpperCase(), page: 1 }).filters[1]).toEqual(eq("manifest_id", M));
  });

  it("page arithmetic: size fallback, page clamps, range is inclusive", () => {
    expect(buildDraftListPlan({ page: 2, pageSize: 100 }).range).toEqual({ from: 100, to: 199 });
    expect(buildDraftListPlan({ page: 2, pageSize: 37 }).range).toEqual({ from: 50, to: 99 });
    expect(buildDraftListPlan({ page: 0 }).range).toEqual({ from: 0, to: DRAFT_PAGE_SIZE_DEFAULT - 1 });
    expect(buildDraftListPlan({ page: -5 }).page).toBe(1);
    expect(buildDraftListPlan({ page: 99999 }).page).toBe(DRAFT_MAX_PAGE);
    expect(buildDraftListPlan({ page: 2.9 }).page).toBe(2);
  });

  it("search is GW-021 escaped: or() grammar and wildcards cannot break out", () => {
    const f = draftSearchFilter("a,b(c)%_");
    expect(f).not.toBeNull();
    // Five clauses exactly: the user's commas/parens did not add a sixth.
    expect(f!.split(",")).toHaveLength(5);
    expect(f!.split(",")[0]).toBe("name.ilike.%a b c \\%\\_%");
    expect(draftSearchFilter("  ")).toBeNull();
    expect(draftSearchFilter(",,()")).toBeNull();
    expect(draftSearchFilter(null)).toBeNull();
    expect(draftSearchFilter("x".repeat(200))).toContain(`%${"x".repeat(DRAFT_SEARCH_MAX_CHARS)}%`);
    expect(draftSearchFilter("x".repeat(200))).not.toContain("x".repeat(DRAFT_SEARCH_MAX_CHARS + 1));
  });
});

describe("S14 URL params", () => {
  it("defaults", () => {
    expect(parseOnboardingListParams({})).toEqual({ q: "", vendorId: null, page: 1, pageSize: 50, rows: "condensed" });
  });
  it("valid values", () => {
    expect(parseOnboardingListParams({ q: "  blue   dream ", vendor: V2.toUpperCase(), page: "3", size: "100", rows: "Expanded" })).toEqual({
      q: "blue dream",
      vendorId: V2,
      page: 3,
      pageSize: 100,
      rows: "expanded",
    });
  });
  it("junk falls back, arrays are ignored, caps hold", () => {
    expect(parseOnboardingListParams({ q: ["a", "b"], vendor: "x", page: "2abc", size: "7", rows: "all" })).toEqual({
      q: "",
      vendorId: null,
      page: 1,
      pageSize: 50,
      rows: "condensed",
    });
    expect(parseOnboardingListParams({ page: "999999" }).page).toBe(DRAFT_MAX_PAGE);
    expect(parseOnboardingListParams({ page: "0" }).page).toBe(1);
    expect(parseOnboardingListParams({ page: "-2" }).page).toBe(1);
    expect(parseOnboardingListParams({ q: "y".repeat(300) }).q).toHaveLength(DRAFT_SEARCH_MAX_CHARS);
  });
});

describe("S14 paging copy", () => {
  it("middle page", () => {
    expect(pageWindow(132, 2, 50, 50)).toMatchObject({ label: "Showing 51–100 of 132", hasPrev: true, hasNext: true, lastPage: 3, pastEnd: false });
  });
  it("last page", () => {
    expect(pageWindow(132, 3, 50, 32)).toMatchObject({ label: "Showing 101–132 of 132", hasPrev: true, hasNext: false });
  });
  it("first and only page", () => {
    expect(pageWindow(7, 1, 50, 7)).toMatchObject({ label: "Showing 1–7 of 7", hasPrev: false, hasNext: false });
  });
  it("past the end", () => {
    const w = pageWindow(132, 9, 50, 0);
    expect(w.pastEnd).toBe(true);
    expect(w.label).toBe("That page is past the end — there are 132 in this list.");
    expect(pageWindow(1, 2, 50, 0).label).toBe("That page is past the end — there is 1 in this list.");
  });
  it("empty list is not 'past the end' — on any page", () => {
    expect(pageWindow(0, 1, 50, 0)).toMatchObject({ pastEnd: false, label: "", hasNext: false });
    expect(pageWindow(0, 2, 50, 0)).toMatchObject({ pastEnd: false, label: "" });
  });
  it("the server's 416 verdict makes a total-less page 'past the end' (never 'No drafts')", () => {
    expect(pageWindow(null, 20, 50, 0, true)).toMatchObject({ pastEnd: true, total: null, label: "That page is past the end of the list." });
    expect(pageWindow(null, 20, 50, 0, false).pastEnd).toBe(false);
    expect(pageWindow(null, 1, 50, 0, true).pastEnd).toBe(false);
  });
  it("unknown total: never printed as 0; a full page may have a next", () => {
    expect(pageWindow(null, 1, 50, 50)).toMatchObject({ total: null, label: "Showing 1–50", hasNext: true });
    expect(pageWindow(undefined, 2, 50, 10)).toMatchObject({ label: "Showing 51–60", hasNext: false, hasPrev: true });
    expect(pageWindow(-1, 1, 50, 3).total).toBeNull();
    expect(pageWindow(1.5, 1, 50, 3).total).toBeNull();
  });
  it("isPastEndError", () => {
    expect(isPastEndError({ code: "PGRST103" })).toBe(true);
    expect(isPastEndError({ message: "Requested range not satisfiable" })).toBe(true);
    expect(isPastEndError({ code: "PGRST116", message: "x" })).toBe(false);
    expect(isPastEndError(null)).toBe(false);
  });
});

describe("S14.4 header copy (exact)", () => {
  it("the bible's example, word for word", () => {
    expect(onboardingHeaderTitle(manifest(), { total: 14, inReview: 12, needsPrice: 9 }, NOW)).toBe(
      "Product Onboarding — Phat Panda · manifest 0421 · received Mar 12 · 14 products (9 need a price)",
    );
  });
  it("singulars and no-price-needed", () => {
    expect(onboardingHeaderTitle(manifest(), { total: 1, inReview: 1, needsPrice: 1 }, NOW)).toBe(
      "Product Onboarding — Phat Panda · manifest 0421 · received Mar 12 · 1 product (1 needs a price)",
    );
    expect(onboardingHeaderTitle(manifest(), { total: 3, inReview: 0, needsPrice: 0 }, NOW)).toBe(
      "Product Onboarding — Phat Panda · manifest 0421 · received Mar 12 · 3 products",
    );
  });
  it("unknown counts are left out, never invented", () => {
    expect(onboardingHeaderTitle(manifest(), null, NOW)).toBe("Product Onboarding — Phat Panda · manifest 0421 · received Mar 12");
  });
  it("no delivery → the plain title (the old copy)", () => {
    expect(onboardingHeaderTitle(null, null, NOW)).toBe("Product Onboarding");
    expect(onboardingHeaderTitle(manifest({ vendor_label: null, manifest_number: null, received_at: null, accepted_at: null, transfer_date: null }), null, NOW)).toBe(
      "Product Onboarding",
    );
  });
  it("the verb is honest about which date it used", () => {
    expect(deliveryWhen({ received_at: null, accepted_at: "2025-03-13T20:00:00Z", transfer_date: "2025-03-10" }, NOW)).toBe("accepted Mar 13");
    expect(deliveryWhen({ received_at: null, accepted_at: null, transfer_date: "2025-03-10" }, NOW)).toBe("shipped Mar 10");
    expect(deliveryWhen({ received_at: "junk", accepted_at: null, transfer_date: null }, NOW)).toBeNull();
  });
  it("store-time day for timestamps; calendar day for DATE columns; year only when different", () => {
    // 2025-03-13 03:00Z is still Mar 12 in Los Angeles.
    expect(shortDeliveryDate("2025-03-13T03:00:00Z", NOW)).toBe("Mar 12");
    // A DATE never slides a day.
    expect(shortDeliveryDate("2025-03-01", NOW)).toBe("Mar 1");
    expect(shortDeliveryDate("2024-12-30", NOW)).toBe("Dec 30, 2024");
    expect(shortDeliveryDate("", NOW)).toBeNull();
  });
});

describe("S14 picker", () => {
  it("label: number · vendor · date · n drafts", () => {
    expect(manifestPickerLabel(manifest(), { total: 14, inReview: 9, needsPrice: 2 }, NOW)).toBe("0421 · Phat Panda · Mar 12 · 14 drafts");
    expect(manifestPickerLabel(manifest(), { total: 1, inReview: 1, needsPrice: 0 }, NOW)).toBe("0421 · Phat Panda · Mar 12 · 1 draft");
    expect(manifestPickerLabel(manifest({ manifest_number: " ", vendor_label: null }), null, NOW)).toBe("No manifest # · Mar 12");
  });
  it("counts: every tab in total; in-review; needs a price = in review with no suggested price", () => {
    const c = summarizeManifestDrafts([
      { manifest_id: M, status: "draft", suggested_price_minor_units: null },
      { manifest_id: M, status: "draft", suggested_price_minor_units: 2500 },
      { manifest_id: M.toUpperCase(), status: "draft" },
      { manifest_id: M, status: "approved", suggested_price_minor_units: null },
      { manifest_id: M, status: "dismissed", suggested_price_minor_units: null },
      { manifest_id: null, status: "draft", suggested_price_minor_units: null },
      { manifest_id: V, status: "draft", suggested_price_minor_units: 0 },
    ]);
    expect(c.get(M)).toEqual({ total: 5, inReview: 3, needsPrice: 2 });
    // A price of 0 cents is still a price.
    expect(c.get(V)).toEqual({ total: 1, inReview: 1, needsPrice: 0 });
    expect(c.size).toBe(2);
    expect(summarizeManifestDrafts(null).size).toBe(0);
  });
  it("vendors: distinct, labelled, valid ids only, A-Z", () => {
    expect(
      pickerVendors([
        manifest({ vendor_id: V, vendor_label: "phat panda" }),
        manifest({ vendor_id: V, vendor_label: "Phat Panda (dup)" }),
        manifest({ vendor_id: V2, vendor_label: "Agro Couture" }),
        manifest({ vendor_id: "bad", vendor_label: "Nope" }),
        manifest({ vendor_id: "22222222-2222-4222-8222-222222222222", vendor_label: "  " }),
      ]),
    ).toEqual([
      { id: V2, label: "Agro Couture" },
      { id: V, label: "phat panda" },
    ]);
  });
  it("filter: accepted in the last 30 days, OR the focused delivery", () => {
    const since = pickerSinceIso(NOW);
    expect(since).toBe("2025-02-18T19:00:00.000Z");
    expect(PICKER_WINDOW_DAYS).toBe(30);
    expect(pickerManifestFilter(since, null)).toBe(`and(status.in.(accepted,partially_accepted),accepted_at.gte.${since})`);
    expect(pickerManifestFilter(since, M.toUpperCase())).toBe(`and(status.in.(accepted,partially_accepted),accepted_at.gte.${since}),id.eq.${M}`);
    expect(pickerManifestFilter(since, "x),id.gt.(0")).toBe(`and(status.in.(accepted,partially_accepted),accepted_at.gte.${since})`);
  });
});

describe("S14 condensed rows", () => {
  it("chips mirror the pickers, in order; the low-THC prompt is not blocking", () => {
    expect(
      rowAttention({
        needsCategoryPick: true,
        needsTypePick: true,
        needsOtherwiseTakenPick: true,
        needsVolumePick: true,
        promptsLowThcLiquid: true,
        suggestedPriceMinor: null,
      }),
    ).toEqual([
      { key: "category", label: "Pick a category", blocking: true },
      { key: "type", label: "Pick a type", blocking: true },
      { key: "otherwise_taken", label: "Compliance question", blocking: true },
      { key: "volume", label: "Enter the volume", blocking: true },
      { key: "low_thc", label: "Low-THC question", blocking: false },
      { key: "price", label: "Needs a price", blocking: true },
    ]);
  });
  it("a priced, classified draft needs nothing", () => {
    expect(rowAttention({ suggestedPriceMinor: 2500 })).toEqual([]);
    expect(rowAttention({ suggestedPriceMinor: 0 })).toEqual([]);
    expect(rowAttention({})).toEqual([{ key: "price", label: "Needs a price", blocking: true }]);
  });
  it("starts open only when expanded or pinned", () => {
    expect(rowStartsOpen({ rows: "condensed", pinned: false })).toBe(false);
    expect(rowStartsOpen({ rows: "expanded", pinned: false })).toBe(true);
    expect(rowStartsOpen({ rows: "condensed", pinned: true })).toBe(true);
  });
});

describe("S14 URLs", () => {
  it("defaults leave the canonical URL", () => {
    expect(onboardingListHref()).toBe("/admin/inventory/drafts");
    expect(onboardingListHref({ status: "draft", page: 1, pageSize: 50, rows: "condensed", q: " " })).toBe("/admin/inventory/drafts");
  });
  it("keeps every filter, S02 params first", () => {
    expect(onboardingListHref({ status: "approved", manifestId: M, q: "blue dream", vendorId: V, page: 2, pageSize: 25, rows: "expanded" })).toBe(
      `/admin/inventory/drafts?status=approved&manifest=${M}&q=blue+dream&vendor=${V}&size=25&page=2&rows=expanded`,
    );
  });
  it("drops invalid values", () => {
    expect(onboardingListHref({ vendorId: "x", pageSize: 7, page: 0 })).toBe("/admin/inventory/drafts");
    expect(onboardingListHref({ page: 5000 })).toBe(`/admin/inventory/drafts?page=${DRAFT_MAX_PAGE}`);
  });
  it("round-trips through the parser", () => {
    const href = onboardingListHref({ q: "a b", vendorId: V, page: 4, pageSize: 100, rows: "expanded" });
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams.entries());
    expect(parseOnboardingListParams(sp)).toEqual({ q: "a b", vendorId: V, page: 4, pageSize: 100, rows: "expanded" });
  });
});

// ═══ 2. The REAL queries over the REAL client ═════════════════════════════

describe("S14 listCatalogDraftsPage — the actual PostgREST request", () => {
  beforeEach(() => {
    reqs.length = 0;
    replies = [];
  });

  it("paged + every filter: ONE request, count=exact, filters, order, offset/limit; total from content-range", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({
      status: 206,
      body: [{ id: A, status: "draft", name: "Blue Dream 1g", inbound_manifests: { vendor_id: V } }],
      headers: { "content-range": "25-49/132" },
    }));
    const res = await listCatalogDraftsPage({ status: "draft", manifestId: M, vendorId: V, q: "blue", page: 2, pageSize: 25 });
    expect(reqs).toHaveLength(1);
    const r = reqs[0];
    expect(r.method).toBe("GET");
    expect(r.url.pathname).toBe("/rest/v1/catalog_product_drafts");
    expect(r.prefer).toContain("count=exact");
    expect(one(r, "select")).toBe("*,inbound_manifests!inner(vendor_id)");
    expect(all(r, "status")).toEqual(["eq.draft"]);
    expect(all(r, "manifest_id")).toEqual([`eq.${M}`]);
    expect(all(r, "inbound_manifests.vendor_id")).toEqual([`eq.${V}`]);
    expect(all(r, "or")).toEqual([
      "(name.ilike.%blue%,brand_name.ilike.%blue%,vendor_name.ilike.%blue%,strain_name.ilike.%blue%,pos_product_key.ilike.%blue%)",
    ]);
    expect(one(r, "order")).toBe("created_at.desc,id.desc");
    expect(one(r, "offset")).toBe("25");
    expect(one(r, "limit")).toBe("25");
    expect(res.total).toBe(132);
    expect(res.pastEnd).toBe(false);
    expect(res.error).toBeNull();
    // The embedded join is stripped: the row is a draft, nothing more.
    expect(res.rows).toEqual([{ id: A, status: "draft", name: "Blue Dream 1g" }]);
  });

  it("no vendor → plain select (no join), still ONE request with its count", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [], headers: { "content-range": "*/0" } }));
    const res = await listCatalogDraftsPage({ status: "approved", page: 1 });
    expect(reqs).toHaveLength(1);
    expect(one(reqs[0], "select")).toBe("*");
    expect(all(reqs[0], "or")).toEqual([]);
    expect(one(reqs[0], "offset")).toBe("0");
    expect(one(reqs[0], "limit")).toBe("50");
    expect(res.total).toBe(0);
  });

  it("a page past the end (PostgREST 416 / PGRST103) is reported, not logged as a failure", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies.push(() => ({
      status: 416,
      body: { code: "PGRST103", message: "Requested range not satisfiable", details: "An offset of 950 was requested, but there are only 132 rows.", hint: null },
    }));
    const res = await listCatalogDraftsPage({ status: "draft", page: 20 });
    expect(res).toMatchObject({ rows: [], total: null, pastEnd: true, error: null });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("any other error: empty rows, total unknown (never 0), error surfaced", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies.push(() => ({ status: 500, body: { code: "57014", message: "canceling statement due to statement timeout" } }));
    const res = await listCatalogDraftsPage({ status: "draft", page: 1 });
    expect(res.rows).toEqual([]);
    expect(res.total).toBeNull();
    expect(res.pastEnd).toBe(false);
    expect(res.error).toContain("statement timeout");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a missing content-range total is unknown, not 0", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [{ id: A, status: "draft" }] }));
    const res = await listCatalogDraftsPage({ status: "draft", page: 1 });
    expect(res.total).toBeNull();
    expect(res.rows).toHaveLength(1);
  });

  it("pinned: S02's single or(), no count, limit 500 — search/vendor/page never sent", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [], headers: { "content-range": "0-0/99" } }));
    const res = await listCatalogDraftsPage({ status: "draft", manifestId: M, draftId: A, vendorId: V, q: "zzz", page: 3 });
    expect(reqs).toHaveLength(1);
    const r = reqs[0];
    expect(r.prefer).not.toContain("count=");
    expect(one(r, "select")).toBe("*");
    expect(all(r, "or")).toEqual([`(and(status.eq.draft,manifest_id.eq.${M}),id.eq.${A})`]);
    expect(all(r, "status")).toEqual([]);
    expect(all(r, "inbound_manifests.vendor_id")).toEqual([]);
    expect(one(r, "offset")).toBeNull();
    expect(one(r, "limit")).toBe("500");
    expect(one(r, "order")).toBe("created_at.desc");
    // Not counted, so no total even if a header came back.
    expect(res.total).toBeNull();
    expect(res.plan.ignored).toEqual(["q", "vendor", "page"]);
  });

  it("the legacy listCatalogDrafts is byte-for-byte the S02 request", async () => {
    const { listCatalogDrafts } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [{ id: A, status: "approved" }] }));
    const rows = await listCatalogDrafts("approved", { manifestId: M });
    expect(rows).toEqual([{ id: A, status: "approved" }]);
    const r = reqs[0];
    expect(r.prefer).not.toContain("count=");
    expect([...r.url.searchParams.keys()].sort()).toEqual(["limit", "manifest_id", "order", "select", "status"]);
    expect(one(r, "select")).toBe("*");
    expect(one(r, "status")).toBe("eq.approved");
    expect(one(r, "manifest_id")).toBe(`eq.${M}`);
    expect(one(r, "order")).toBe("created_at.desc");
    expect(one(r, "limit")).toBe("500");
  });

  it("a hostile search term cannot add a filter clause on the wire", async () => {
    const { listCatalogDraftsPage } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [] }));
    await listCatalogDraftsPage({ status: "draft", q: "x),status.eq.approved,(y", page: 1 });
    const or = all(reqs[0], "or");
    expect(or).toHaveLength(1);
    // The text survives only INSIDE each %...% pattern (a harmless literal);
    // it never becomes its own clause.
    const clauses = or[0].replace(/^\(|\)$/g, "").split(",");
    expect(clauses).toEqual(DRAFT_SEARCH_COLUMNS.map((c) => `${c}.ilike.%x status.eq.approved y%`));
    expect(all(reqs[0], "status")).toEqual(["eq.draft"]);
  });
});

describe("S14 loadOnboardingPicker — the actual PostgREST requests", () => {
  beforeEach(() => {
    reqs.length = 0;
    replies = [];
  });

  it("two bounded, named-column reads; counts folded per delivery", async () => {
    const { loadOnboardingPicker } = await import("@/lib/inventory/catalog-drafts");
    const M2 = "33333333-3333-4333-8333-333333333333";
    replies.push(() => ({ status: 200, body: [manifest(), manifest({ id: M2, manifest_number: "0400", vendor_id: V2, vendor_label: "Agro Couture" })] }));
    replies.push(() => ({
      status: 200,
      body: [
        { manifest_id: M, status: "draft", suggested_price_minor_units: null },
        { manifest_id: M, status: "draft", suggested_price_minor_units: 1999 },
        { manifest_id: M, status: "approved", suggested_price_minor_units: 1999 },
      ],
    }));
    const p = await loadOnboardingPicker(null, NOW);
    expect(reqs).toHaveLength(2);
    const [m, d] = reqs;
    expect(m.url.pathname).toBe("/rest/v1/inbound_manifests");
    expect(one(m, "select")).toBe("id,manifest_number,vendor_id,vendor_label,transfer_date,received_at,accepted_at,status");
    expect(all(m, "or")).toEqual([`(${pickerManifestFilter(pickerSinceIso(NOW), null)})`]);
    expect(one(m, "order")).toBe("accepted_at.desc.nullslast");
    expect(one(m, "limit")).toBe(String(PICKER_MAX_MANIFESTS));
    expect(m.prefer).not.toContain("count=");
    expect(d.url.pathname).toBe("/rest/v1/catalog_product_drafts");
    expect(one(d, "select")).toBe("manifest_id,status,suggested_price_minor_units");
    expect(one(d, "manifest_id")).toBe(`in.(${M},${M2})`);
    expect(one(d, "limit")).toBe("5000");
    expect(p).not.toBeNull();
    expect(p!.countsComplete).toBe(true);
    expect(p!.manifests.map((x) => x.id)).toEqual([M, M2]);
    expect(p!.counts.get(M)).toEqual({ total: 3, inReview: 2, needsPrice: 1 });
    // A delivery with no drafts simply has no entry (the page shows 0 drafts
    // only when the read was complete).
    expect(p!.counts.has(M2)).toBe(false);
  });

  it("the focused delivery rides in the SAME manifest read", async () => {
    const { loadOnboardingPicker } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [] }));
    const p = await loadOnboardingPicker(M, NOW);
    expect(reqs).toHaveLength(1); // no deliveries → no draft read
    expect(all(reqs[0], "or")[0]).toContain(`,id.eq.${M})`);
    expect(p).toEqual({ manifests: [], counts: new Map(), countsComplete: true });
  });

  it("manifest read fails → null (picker hidden; list unaffected)", async () => {
    const { loadOnboardingPicker } = await import("@/lib/inventory/catalog-drafts");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies.push(() => ({ status: 500, body: { message: "boom" } }));
    expect(await loadOnboardingPicker(null, NOW)).toBeNull();
    expect(reqs).toHaveLength(1);
    spy.mockRestore();
  });

  it("count read fails → counts hidden, never a false 0", async () => {
    const { loadOnboardingPicker } = await import("@/lib/inventory/catalog-drafts");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    replies.push(() => ({ status: 200, body: [manifest()] }));
    replies.push(() => ({ status: 500, body: { message: "timeout" } }));
    const p = await loadOnboardingPicker(null, NOW);
    expect(p!.manifests).toHaveLength(1);
    expect(p!.countsComplete).toBe(false);
    expect(p!.counts.size).toBe(0);
    spy.mockRestore();
  });

  it("count read hits its cap → counts hidden (could be short)", async () => {
    const { loadOnboardingPicker } = await import("@/lib/inventory/catalog-drafts");
    replies.push(() => ({ status: 200, body: [manifest()] }));
    replies.push(() => ({ status: 200, body: Array.from({ length: 5000 }, () => ({ manifest_id: M, status: "draft", suggested_price_minor_units: 1 })) }));
    const p = await loadOnboardingPicker(null, NOW);
    expect(p!.countsComplete).toBe(false);
    expect(p!.counts.size).toBe(0);
    // One short of the cap is complete.
    reqs.length = 0;
    replies.push(() => ({ status: 200, body: [manifest()] }));
    replies.push(() => ({ status: 200, body: Array.from({ length: 4999 }, () => ({ manifest_id: M, status: "draft", suggested_price_minor_units: 1 })) }));
    const q = await loadOnboardingPicker(null, NOW);
    expect(q!.countsComplete).toBe(true);
    expect(q!.counts.get(M)).toEqual({ total: 4999, inReview: 4999, needsPrice: 0 });
  });
});

// ═══ 3. The page uses all of the above ════════════════════════════════════

describe("S14 drafts page wiring", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");

  it("reads the new params and fetches page + picker in the same Promise.all", () => {
    expect(page).toMatch(/q\?: string; vendor\?: string; page\?: string; size\?: string; rows\?: string/);
    expect(page).toContain("const list = parseOnboardingListParams(sp);");
    const pa = page.slice(page.indexOf("await Promise.all(["), page.indexOf("]);", page.indexOf("await Promise.all([")));
    expect(pa).toContain("listCatalogDraftsPage({");
    expect(pa).toContain("loadOnboardingPicker(focus.manifestId, now)");
    for (const k of ["status: focus.view", "manifestId: focus.manifestId", "draftId: focus.draftId", "vendorId: list.vendorId", "q: list.q", "page: list.page", "pageSize: list.pageSize"]) {
      expect(pa, k).toContain(k);
    }
    expect(page).not.toMatch(/\blistCatalogDrafts\(/);
  });

  it("header is the S14.4 title, counts only when complete", () => {
    expect(page).toContain("title={headerTitle}");
    // The only literal title left is the "Supabase not configured" fallback.
    expect(page.match(/title="Product Onboarding"/g) ?? []).toHaveLength(1);
    expect(page).toMatch(/<AdminPageHeader title="Product Onboarding" subtitle="Review and approve new products onto the menu." \/>/);
    expect(page).toMatch(/focusManifest && picker\?\.countsComplete \? picker\.counts\.get\(focusManifest\.id\)/);
  });

  it("filter bar: GET form, delivery / vendor / search / size, hidden while a draft is pinned", () => {
    const at = page.indexOf('data-testid="onboarding-filter-bar"');
    expect(at).toBeGreaterThan(-1);
    const before = page.slice(at - 400, at);
    expect(before).toContain("{!focus.draftId && (");
    expect(before).toContain('method="get"');
    expect(before).toContain('action="/admin/inventory/drafts"');
    const bar = page.slice(at, page.indexOf("</form>", at));
    for (const name of ['name="manifest"', 'name="vendor"', 'name="q"', 'name="size"']) expect(bar, name).toContain(name);
    expect(bar).toContain('<input type="hidden" name="status" value={view} />');
    expect(bar).toContain('<input type="hidden" name="rows" value="expanded" />');
    expect(bar).toContain("manifestPickerLabel(m, picker.countsComplete ?");
    expect(bar).toContain("Clear search");
    expect(bar).toMatch(/Collapse every row" : "Expand every row"/);
  });

  it("the pinned-draft note is driven by the plan's ignored list", () => {
    expect(page).toContain("listPage.plan.ignored.length > 0");
  });

  it("F-006 (re-pinned by S41, bible S41.3): the approve form is only visible while the row's <details> is open; Dismiss stays in the summary row", () => {
    // R23: the FIRST draft-row-details is the review tab's (the Approved tab's toggle follows it).
    const d = page.indexOf('data-testid="draft-row-details"');
    expect(d).toBeGreaterThan(-1);
    const detailsOpen = page.lastIndexOf("<details", d);
    expect(page.slice(detailsOpen, d)).toContain("open={rowStartsOpen({ rows: list.rows, pinned: pinned?.id === d.id })}");
    // ONE approve form per row, built once as approveForm ...
    expect(page.match(/<form action=\{approve\}/g)?.length).toBe(1);
    expect(page.indexOf("<form action={approve}")).toBeGreaterThan(page.indexOf("const approveForm = ("));
    // ... mounted in exactly two mutually exclusive places: inside <details>
    // (flag off, the previous row) or in the S41 detail row (flag on), which
    // globals.css shows only while that <details> is open.
    const close = page.indexOf("</details>", d);
    const inDetails = page.slice(d, close);
    expect(inDetails).toContain("{!v2Row && approveForm}");
    expect(page.match(/approveForm\}/g)?.length).toBe(2);
    const detailRow = page.indexOf("<OnboardingDetailRow", close);
    // R23 (item 5): the detail row also opens on the Approved tab, whose third zone is the read-only summary.
    expect(page.slice(close, detailRow)).toContain("{v2Row && rowsOpen && (");
    expect(page).toContain('const rowsOpen = view === "draft" || view === "approved";');
    const approveProp = 'approve={view === "approved" ? approvedZone : approveForm}';
    expect(page.slice(detailRow, page.indexOf("/>", page.indexOf(approveProp, detailRow)))).toContain(approveProp);
    const css = read("src/app/globals.css");
    expect(css).toContain("tr.draft-detail-row {\n    display: none;");
    expect(css).toContain('tr:has(details[data-testid="draft-row-details"][open]) + tr.draft-detail-row {\n    display: table-row;');
    expect(css).toContain("@supports selector(tr:has(details[open]))");
    const dismiss = page.indexOf("<form action={dismiss}", d);
    expect(dismiss).toBeGreaterThan(close);
    expect(dismiss).toBeLessThan(detailRow);
    const summary = page.slice(page.indexOf("<summary", d), page.indexOf("</summary>", d));
    expect(summary).toContain("rowChips.map");
    expect(summary).toContain("Ready to approve");
    expect(summary).toContain('Review & approve{" \\u25be"}');
  });

  it("chips use the SAME flags that render the pickers", () => {
    const at = page.indexOf("const rowChips = rowAttention({");
    expect(at).toBeGreaterThan(-1);
    const call = page.slice(at, page.indexOf("});", at));
    for (const k of [
      "needsCategoryPick,",
      "needsTypePick,",
      "needsOtherwiseTakenPick: Boolean(ca?.needsOtherwiseTakenPick)",
      "promptsLowThcLiquid: Boolean(ca?.promptsLowThcLiquid)",
      "needsVolumePick: Boolean(va?.needsVolumePick)",
      "suggestedPriceMinor: d.suggested_price_minor_units",
    ]) {
      expect(call, k).toContain(k);
    }
  });

  it("pager: labelled nav with prev/next that keep the filters; past-end recovery", () => {
    const at = page.indexOf('data-testid="onboarding-pager"');
    expect(at).toBeGreaterThan(-1);
    expect(page.slice(at - 300, at)).toContain("{paged && (pager.hasPrev || pager.hasNext || pager.label) && !pager.pastEnd && (");
    expect(page).toContain("onboardingListHref({ ...listFilters, page: list.page - 1 })");
    expect(page).toContain("onboardingListHref({ ...listFilters, page: list.page + 1 })");
    expect(page).toContain("onboardingListHref({ ...listFilters, page: 1 })");
    expect(page).toContain("pageWindow(listPage.total, list.page, list.pageSize, drafts.length, listPage.pastEnd)");
    expect(page).toContain('"That page is past the end of the list"');
    expect(page).toContain('"Nothing matches that search"');
  });

  it("S02 is intact: tabs keep the delivery, the pinned row still anchors", () => {
    expect(page).toContain("draftsHref({ status: s, manifestId: focus.manifestId })");
    expect(page).toContain("Show every delivery");
    expect(page).toContain("parseDraftFocus(sp)");
  });

  it("no literal \\u escapes leak into JSX text", () => {
    expect(page).not.toMatch(/>[^<{]*\\u[0-9a-f]{4}[^<]*</i);
  });

  it("F-080: finalize still lands on ?manifest= (S02's link, which S14 relies on)", () => {
    const intake = read("src/app/admin/inventory/intake/[id]/page.tsx");
    // R23: one merged finalize banner → one link (plus the import).
    expect((intake.match(/draftsForManifestHref\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

// ═══ 4. Runner ════════════════════════════════════════════════════════════

describe("S14 runner registration", () => {
  it("the pure core is registered with a floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("onboarding-list-core", __runOnboardingListCoreTests(), 77);');
    expect(runner).toMatch(/import \{ __runOnboardingListCoreTests \} from "\.\.\/\.\.\/src\/lib\/catalog\/onboarding-list-core"/);
  });
  it("the core is pure (no server-only / supabase / env)", () => {
    const core = read("src/lib/catalog/onboarding-list-core.ts");
    expect(core).not.toMatch(/from "server-only"|@\/lib\/supabase\/(admin|env)|process\.env/);
  });
});
