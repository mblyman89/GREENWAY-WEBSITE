/**
 * src/lib/kb/crawl-campaigns-core.ts — D220 S6 (PURE, unit-tested).
 *
 * Owner: "help me finish merging all the vendors. then get to work making the
 * new vendor crawler so much more amazing … please do your best to tag and
 * label and catalog everything so it is easy to match images to product cards."
 *
 * The logic behind the Crawl Campaigns board, the Website Finder review, and
 * the Image Catalog — no I/O here, so every rule is tested:
 *
 *   • buildCurrentVendorTargets — "Harvest all current vendors": live cards
 *     (not archived, not merged) that have stock on hand, split into the ones
 *     with a usable website (targets, deduped by host so two cards sharing a
 *     site crawl once) and the ones WITHOUT (fed to the Website Finder).
 *   • normalizeWebsite / hostOf — tolerant URL cleanup ("acme.com" → https).
 *   • campaignProgress — one honest progress number + phase label per site.
 *   • planCandidateApproval — approving one website candidate supersedes the
 *     vendor's other pending candidates (never touches human rejections).
 *   • planImageDecision — confirm / reject / re-pick for a catalogued image;
 *     never auto-attaches a non-product role.
 */

export type VendorCard = {
  id: string;
  display_name: string;
  website: string | null;
  status?: string | null;
  merged_into_id?: string | null;
  legal_name?: string | null;
  dba?: string | null;
  license_number?: string | null;
  shipping_city?: string | null;
  billing_city?: string | null;
};

export type CampaignTarget = {
  entity_type: "vendor";
  entity_id: string;
  vendor_id: string;
  display_name: string;
  url: string;
};

export type WebsiteFinderVendor = {
  vendor_id: string;
  name: string;
  legal_name: string;
  dba: string;
  license_number: string;
  city: string;
};

/** Hosts that are never a vendor's own website (menus, marketplaces, social). */
const NOT_OWN_SITE = [
  "leafly.com",
  "weedmaps.com",
  "dutchie.com",
  "iheartjane.com",
  "leaflink.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linktr.ee",
  "google.com",
  "yelp.com",
];

/** "acme.com/shop " → "https://acme.com/shop"; returns "" when unusable. */
export function normalizeWebsite(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.toLowerCase();
  if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)) return "";
  u.hash = "";
  return u.toString();
}

/** Bare host for dedupe: lowercase, no www., no port. */
export function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

export function isOwnSiteHost(host: string): boolean {
  return !!host && !NOT_OWN_SITE.some((h) => host === h || host.endsWith("." + h));
}

export function isLiveCard(v: VendorCard): boolean {
  return (v.status ?? "").toLowerCase() !== "archived" && !(v.merged_into_id ?? "").trim();
}

export type CurrentVendorPlan = {
  targets: CampaignTarget[];
  /** Live vendors with stock but no usable own website → Website Finder. */
  needWebsite: WebsiteFinderVendor[];
  /** Cards skipped because another stocked vendor already covers the host. */
  sharedHost: { vendor_id: string; display_name: string; host: string; covered_by: string }[];
  /** Stocked vendor ids whose card is archived/merged (stock lands on the survivor). */
  notLive: string[];
  stockedVendors: number;
};

/**
 * Everything "Harvest all current vendors" needs. `stockedIds` = vendor ids
 * with on_hand_qty > 0 (already resolved to survivors by the caller is fine;
 * merged/archived cards are reported in notLive and skipped either way).
 */
export function buildCurrentVendorTargets(vendors: VendorCard[], stockedIds: Iterable<string>): CurrentVendorPlan {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const stocked = [...new Set(stockedIds)];
  const plan: CurrentVendorPlan = { targets: [], needWebsite: [], sharedHost: [], notLive: [], stockedVendors: 0 };
  const hostOwner = new Map<string, string>();
  const ordered = stocked
    .map((id) => byId.get(id))
    .filter((v): v is VendorCard => !!v)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  for (const id of stocked) if (!byId.has(id)) plan.notLive.push(id);
  for (const v of ordered) {
    if (!isLiveCard(v)) {
      plan.notLive.push(v.id);
      continue;
    }
    plan.stockedVendors += 1;
    const url = normalizeWebsite(v.website);
    const host = url ? hostOf(url) : "";
    if (!url || !isOwnSiteHost(host)) {
      plan.needWebsite.push({
        vendor_id: v.id,
        name: v.display_name,
        legal_name: v.legal_name ?? "",
        dba: v.dba ?? "",
        license_number: v.license_number ?? "",
        city: v.shipping_city ?? v.billing_city ?? "",
      });
      continue;
    }
    const owner = hostOwner.get(host);
    if (owner) {
      plan.sharedHost.push({ vendor_id: v.id, display_name: v.display_name, host, covered_by: owner });
      continue;
    }
    hostOwner.set(host, v.display_name);
    plan.targets.push({ entity_type: "vendor", entity_id: v.id, vendor_id: v.id, display_name: v.display_name, url });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export type SiteRow = {
  id: string;
  status: string;
  pages_read: number;
  pages_pending: number;
  pages_failed?: number;
  images_found?: number;
  images_tagged?: number;
  images_matched?: number;
  products_found?: number;
  slices?: number;
  attempts?: number;
  coverage_assessment?: string | null;
  last_error?: string | null;
  stopped_reason?: string | null;
};

/** Mirrors the kb_crawl_sites.status check constraint (migration 0351). */
export const SITE_PHASE: Record<string, string> = {
  queued: "Waiting",
  running: "Crawling pages",
  analyzing: "AI: reading pages, tagging images, matching",
  complete: "Complete — every page read",
  partial: "Partial — page cap reached",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export const SITE_DONE = new Set(["complete", "partial", "failed", "skipped", "cancelled"]);

/** 0..100 for one site. Crawl = 80% of the bar (pages read / discovered); the rest is AI + matching. */
export function siteProgress(s: SiteRow): number {
  if (s.status === "complete" || s.status === "partial") return 100;
  if (s.status === "failed" || s.status === "cancelled" || s.status === "skipped") return 100;
  const known = Math.max(1, (s.pages_read ?? 0) + (s.pages_pending ?? 0));
  const crawl = Math.min(1, (s.pages_read ?? 0) / known);
  if (s.status === "analyzing") return 90;
  if (s.status === "queued") return 0;
  return Math.round(crawl * 80);
}

export function campaignProgress(sites: SiteRow[]): { pct: number; done: number; total: number } {
  if (sites.length === 0) return { pct: 0, done: 0, total: 0 };
  const sum = sites.reduce((a, s) => a + siteProgress(s), 0);
  return {
    pct: Math.round(sum / sites.length),
    done: sites.filter((s) => SITE_DONE.has(s.status)).length,
    total: sites.length,
  };
}

// ---------------------------------------------------------------------------
// Website candidates
// ---------------------------------------------------------------------------
export type WebsiteCandidate = {
  id: string;
  vendor_id: string;
  url: string;
  host: string;
  status: string;
  verify_status: string;
  confidence: number;
};

export type CandidateApprovalPlan = {
  approveId: string;
  website: string;
  supersedeIds: string[];
};

/** Approve one candidate: its URL becomes the vendor website; the vendor's other PENDING candidates are superseded. */
export function planCandidateApproval(
  chosen: WebsiteCandidate,
  siblings: WebsiteCandidate[],
): CandidateApprovalPlan | { error: string } {
  const website = normalizeWebsite(chosen.url);
  if (!website) return { error: "That candidate URL isn't a usable website." };
  if (chosen.status === "rejected") return { error: "That candidate was rejected — reopen it first." };
  return {
    approveId: chosen.id,
    website,
    supersedeIds: siblings
      .filter((c) => c.vendor_id === chosen.vendor_id && c.id !== chosen.id && c.status === "pending")
      .map((c) => c.id),
  };
}

/** Best pending candidate per vendor, highest confidence first (verified > likely > rest on ties). */
export function bestCandidatePerVendor(cands: WebsiteCandidate[]): Map<string, WebsiteCandidate> {
  const rank: Record<string, number> = { verified: 3, likely: 2, unverified: 1 };
  const out = new Map<string, WebsiteCandidate>();
  for (const c of cands) {
    if (c.status !== "pending") continue;
    const cur = out.get(c.vendor_id);
    const better =
      !cur ||
      c.confidence > cur.confidence ||
      (c.confidence === cur.confidence && (rank[c.verify_status] ?? 0) > (rank[cur.verify_status] ?? 0));
    if (better) out.set(c.vendor_id, c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image catalog decisions
// ---------------------------------------------------------------------------
/** Roles that may land on a product card without an override. */
export const PRODUCT_IMAGE_ROLES = new Set(["product", "packaging", "lifestyle", "flower_closeup"]);

export type MatchCandidate = { id: string; name: string; score: number; reason?: string };

export type CatalogImage = {
  id: string;
  role: string;
  match_status: string;
  matched_kb_product_id: string | null;
  match_candidates: MatchCandidate[] | null;
};

export type ImageDecision =
  | { kind: "confirm"; productId: string; patch: Record<string, unknown> }
  | { kind: "reject"; patch: Record<string, unknown> }
  | { kind: "error"; error: string };

/**
 * confirm (optionally a different candidate / any product id the reviewer
 * picked) or reject. Confirm requires a product-like role unless the reviewer
 * explicitly overrides (force) — logos/banners never land on product cards by accident.
 */
export function planImageDecision(
  img: CatalogImage,
  decision: "confirm" | "reject",
  opts: { productId?: string | null; actorId: string | null; nowIso: string; force?: boolean },
): ImageDecision {
  const reviewed = { reviewed_by: opts.actorId, reviewed_at: opts.nowIso };
  if (decision === "reject") {
    return { kind: "reject", patch: { match_status: "rejected", ...reviewed } };
  }
  const pid = (opts.productId ?? img.matched_kb_product_id ?? "").trim();
  if (!pid) return { kind: "error", error: "Pick the product this image belongs to." };
  if (!PRODUCT_IMAGE_ROLES.has(img.role) && img.role !== "unknown" && img.role !== "other" && !opts.force) {
    return { kind: "error", error: `This image is tagged "${img.role}", not a product photo. Tick "it really is" to confirm anyway.` };
  }
  const cand = (img.match_candidates ?? []).find((c) => c.id === pid);
  const patch: Record<string, unknown> = { match_status: "confirmed", matched_kb_product_id: pid, ...reviewed };
  if (pid !== img.matched_kb_product_id) {
    patch.match_score = cand ? cand.score : null;
    patch.match_reason = cand ? `reviewer picked: ${cand.reason ?? cand.name}` : "reviewer picked manually";
  }
  return { kind: "confirm", productId: pid, patch };
}

/** Mirrors the kb_crawl_images.role check constraint (migration 0351) and crawler/app/catalog.py IMAGE_ROLES. */
export const ROLE_LABEL: Record<string, string> = {
  product: "Product shot",
  packaging: "Packaging",
  flower_closeup: "Flower close-up",
  lifestyle: "Lifestyle",
  logo: "Logo",
  banner: "Banner",
  team: "Team / people",
  facility: "Facility",
  lab_result: "Lab result",
  icon: "Icon",
  other: "Other",
  unknown: "Untagged",
};

/** Image-catalog filter parsing (query-string → safe values). */
export function parseImageFilters(sp: Record<string, string | undefined>): {
  role: string | null;
  match: string | null;
  vendorId: string | null;
  siteId: string | null;
  q: string;
  page: number;
} {
  const role = sp.role && ROLE_LABEL[sp.role] ? sp.role : null;
  const match = sp.match && ["unmatched", "suggested", "confirmed", "rejected"].includes(sp.match) ? sp.match : null;
  const uuid = /^[0-9a-f-]{36}$/i;
  return {
    role,
    match,
    vendorId: sp.vendor && uuid.test(sp.vendor) ? sp.vendor : null,
    siteId: sp.site && uuid.test(sp.site) ? sp.site : null,
    q: (sp.q ?? "").trim().slice(0, 80),
    page: Math.max(1, Math.min(500, Number.parseInt(sp.page ?? "1", 10) || 1)),
  };
}
