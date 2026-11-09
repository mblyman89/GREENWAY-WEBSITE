/**
 * tests/compliance/crawl-campaigns-core.test.ts — D220 S6.
 *
 * Pure rules behind the Crawl Campaigns board, the Website Finder review, and
 * the Image Catalog (src/lib/kb/crawl-campaigns-core.ts).
 */
import { describe, expect, it } from "vitest";
import {
  bestCandidatePerVendor,
  buildCurrentVendorTargets,
  campaignProgress,
  hostOf,
  isOwnSiteHost,
  normalizeWebsite,
  parseImageFilters,
  planCandidateApproval,
  planImageDecision,
  siteProgress,
  type CatalogImage,
  type VendorCard,
  type WebsiteCandidate,
} from "@/lib/kb/crawl-campaigns-core";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const F = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function v(id: string, name: string, website: string | null, over: Partial<VendorCard> = {}): VendorCard {
  return { id, display_name: name, website, status: "published", merged_into_id: null, ...over };
}

describe("normalizeWebsite / hostOf / isOwnSiteHost", () => {
  it("adds https, keeps paths, refuses junk", () => {
    expect(normalizeWebsite("acme.com")).toBe("https://acme.com/");
    expect(normalizeWebsite(" https://www.Acme.com/shop#x ")).toBe("https://www.acme.com/shop");
    expect(normalizeWebsite("not a url")).toBe("");
    expect(normalizeWebsite("ftp://acme.com")).toBe("");
    expect(normalizeWebsite("localhost")).toBe("");
    expect(normalizeWebsite("")).toBe("");
    expect(normalizeWebsite(null)).toBe("");
  });
  it("hosts drop www and port", () => {
    expect(hostOf("https://www.acme.com:8443/a")).toBe("acme.com");
    expect(hostOf("nope")).toBe("");
  });
  it("menus, marketplaces and social are not a vendor's own site", () => {
    expect(isOwnSiteHost("leafly.com")).toBe(false);
    expect(isOwnSiteHost("shop.weedmaps.com")).toBe(false);
    expect(isOwnSiteHost("instagram.com")).toBe(false);
    expect(isOwnSiteHost("acme.com")).toBe(true);
    expect(isOwnSiteHost("")).toBe(false);
  });
});

describe("buildCurrentVendorTargets (Harvest all current vendors)", () => {
  const vendors = [
    v(A, "Acme Farms", "acme.com"),
    v(B, "Acme Extracts", "https://www.acme.com/extracts"), // same host as A
    v(C, "Bravo", null, { license_number: "412345", shipping_city: "Spokane", legal_name: "Bravo LLC" }),
    v(D, "Old Card", "https://old.example", { status: "archived" }),
    v(E, "Merged Card", "https://merged.example", { merged_into_id: A }),
    v(F, "Insta Only", "https://instagram.com/insta"),
  ];
  it("targets stocked live vendors with a website, deduped by host", () => {
    const plan = buildCurrentVendorTargets(vendors, [A, B, C, D, E, F, A, "unknown-id"]);
    expect(plan.targets.map((t) => t.entity_id)).toEqual([B]); // "Acme Extracts" sorts before "Acme Farms"
    expect(plan.targets[0]).toMatchObject({ entity_type: "vendor", vendor_id: B, url: "https://www.acme.com/extracts" });
    expect(plan.sharedHost).toEqual([{ vendor_id: A, display_name: "Acme Farms", host: "acme.com", covered_by: "Acme Extracts" }]);
    expect(plan.needWebsite.map((n) => n.vendor_id).sort()).toEqual([C, F].sort());
    expect(plan.needWebsite.find((n) => n.vendor_id === C)).toMatchObject({
      name: "Bravo",
      legal_name: "Bravo LLC",
      license_number: "412345",
      city: "Spokane",
    });
    expect(plan.notLive.sort()).toEqual([D, E, "unknown-id"].sort());
    expect(plan.stockedVendors).toBe(4);
  });
  it("vendors without stock are never targeted", () => {
    const plan = buildCurrentVendorTargets(vendors, []);
    expect(plan.targets).toEqual([]);
    expect(plan.stockedVendors).toBe(0);
  });
});

describe("progress", () => {
  it("crawl is 80% of the bar, analysis 90%, terminal 100%", () => {
    expect(siteProgress({ id: "1", status: "queued", pages_read: 0, pages_pending: 0 })).toBe(0);
    expect(siteProgress({ id: "1", status: "running", pages_read: 50, pages_pending: 50 })).toBe(40);
    expect(siteProgress({ id: "1", status: "analyzing", pages_read: 90, pages_pending: 0 })).toBe(90);
    expect(siteProgress({ id: "1", status: "partial", pages_read: 9, pages_pending: 99 })).toBe(100);
    expect(siteProgress({ id: "1", status: "failed", pages_read: 0, pages_pending: 0 })).toBe(100);
  });
  it("campaign progress averages sites and counts finished ones", () => {
    const p = campaignProgress([
      { id: "1", status: "complete", pages_read: 10, pages_pending: 0 },
      { id: "2", status: "queued", pages_read: 0, pages_pending: 0 },
    ]);
    expect(p).toEqual({ pct: 50, done: 1, total: 2 });
    expect(campaignProgress([])).toEqual({ pct: 0, done: 0, total: 0 });
  });
});

describe("website candidates", () => {
  const cand = (id: string, over: Partial<WebsiteCandidate> = {}): WebsiteCandidate => ({
    id,
    vendor_id: A,
    url: `https://${id}.example/`,
    host: `${id}.example`,
    status: "pending",
    verify_status: "likely",
    confidence: 0.5,
    ...over,
  });
  it("approving one supersedes the vendor's other PENDING candidates only", () => {
    const chosen = cand("c1");
    const plan = planCandidateApproval(chosen, [
      chosen,
      cand("c2"),
      cand("c3", { status: "rejected" }),
      cand("c4", { vendor_id: B }),
    ]);
    expect(plan).toEqual({ approveId: "c1", website: "https://c1.example/", supersedeIds: ["c2"] });
  });
  it("refuses unusable or rejected candidates", () => {
    expect(planCandidateApproval(cand("x", { url: "nope nope" }), [])).toEqual({ error: expect.stringContaining("usable") });
    expect(planCandidateApproval(cand("x", { status: "rejected" }), [])).toEqual({ error: expect.stringContaining("rejected") });
  });
  it("best per vendor prefers confidence, then verified", () => {
    const best = bestCandidatePerVendor([
      cand("a", { confidence: 0.6 }),
      cand("b", { confidence: 0.9 }),
      cand("c", { confidence: 0.9, verify_status: "verified" }),
      cand("d", { confidence: 0.99, status: "rejected" }),
    ]);
    expect(best.get(A)?.id).toBe("c");
  });
});

describe("image decisions", () => {
  const img = (over: Partial<CatalogImage> = {}): CatalogImage => ({
    id: "i1",
    role: "packaging",
    match_status: "suggested",
    matched_kb_product_id: "p1",
    match_candidates: [
      { id: "p1", name: "Strain 1", score: 0.82, reason: "name in alt" },
      { id: "p2", name: "Strain 2", score: 0.7, reason: "filename" },
    ],
    ...over,
  });
  const opts = { actorId: "u1", nowIso: "2026-01-01T00:00:00.000Z" };

  it("confirm keeps the suggestion and stamps the reviewer", () => {
    const d = planImageDecision(img(), "confirm", opts);
    expect(d).toEqual({
      kind: "confirm",
      productId: "p1",
      patch: { match_status: "confirmed", matched_kb_product_id: "p1", reviewed_by: "u1", reviewed_at: opts.nowIso },
    });
  });
  it("confirm with a different candidate records its score and why", () => {
    const d = planImageDecision(img(), "confirm", { ...opts, productId: "p2" });
    expect(d.kind).toBe("confirm");
    if (d.kind === "confirm") {
      expect(d.productId).toBe("p2");
      expect(d.patch).toMatchObject({ matched_kb_product_id: "p2", match_score: 0.7, match_reason: "reviewer picked: filename" });
    }
  });
  it("a hand-picked product outside the candidates is allowed", () => {
    const d = planImageDecision(img(), "confirm", { ...opts, productId: "p9" });
    expect(d.kind === "confirm" && d.patch.match_reason).toBe("reviewer picked manually");
  });
  it("logos and banners never land on a card without the override", () => {
    expect(planImageDecision(img({ role: "logo" }), "confirm", opts).kind).toBe("error");
    expect(planImageDecision(img({ role: "logo" }), "confirm", { ...opts, force: true }).kind).toBe("confirm");
    expect(planImageDecision(img({ role: "unknown" }), "confirm", opts).kind).toBe("confirm");
  });
  it("confirm needs a product", () => {
    expect(planImageDecision(img({ matched_kb_product_id: null }), "confirm", opts)).toEqual({
      kind: "error",
      error: "Pick the product this image belongs to.",
    });
  });
  it("reject stamps the reviewer", () => {
    expect(planImageDecision(img(), "reject", opts)).toEqual({
      kind: "reject",
      patch: { match_status: "rejected", reviewed_by: "u1", reviewed_at: opts.nowIso },
    });
  });
});

describe("parseImageFilters", () => {
  it("accepts only known values", () => {
    expect(parseImageFilters({ role: "packaging", match: "suggested", vendor: A, page: "3", q: "  blue dream " })).toEqual({
      role: "packaging",
      match: "suggested",
      vendorId: A,
      siteId: null,
      q: "blue dream",
      page: 3,
    });
    expect(parseImageFilters({ role: "drop table", match: "x", vendor: "1; --", site: "bad", page: "-4" })).toEqual({
      role: null,
      match: null,
      vendorId: null,
      siteId: null,
      q: "",
      page: 1,
    });
  });
});
