/**
 * src/lib/enrichment/match-core.ts — SLICE 38 (Enrichment Powerhouse).
 *
 * PURE matching + guidance logic for the Product Enrichment command center.
 * Given the POS product being enriched, these scorers rank candidate matches
 * from three asset sources so the editor can SUGGEST (never auto-apply):
 *   • kb_products rows        (validated descriptions/sensory/images),
 *   • media_assets rows       (the media library),
 *   • vendor menu lines       (Cultivera/GrowFlow snapshots with image_url).
 *
 * Matching is deliberately conservative token overlap — the same philosophy
 * as the proven src/lib/media/product-link-core.ts (H10d): no fuzzy magic
 * that could silently misfile an asset onto the wrong SKU. Every match
 * carries a 0..1 score plus human-readable reasons the enricher sees before
 * clicking Apply. Nothing here reads a database or writes anything.
 *
 * buildAssetGuidance() produces the owner-requested "no assets? here's how to
 * get them" checklist, ordered by effort, including the approved-substitute
 * fallback offer when one is available.
 *
 * SLICE 73 adds buildGuidanceActions(): the jump-to buttons for that
 * checklist. Owner: "If we don't have the details we need for a product, I
 * want jump to buttons added to the detail page that takes me to where I
 * need to be to fetch/scrape that info." Each missing detail maps to a real
 * admin destination (vendor menus, media library pre-searched, KB harvest,
 * fallback manager) or an in-page anchor (#upload, #ai, #brand, #matches).
 */

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/** Words too generic to prove a product match on their own. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "of", "with", "by", "for", "or", "to",
  "mg", "thc", "cbd", "pack", "single", "new", "each",
  "product", "products", "image", "photo", "img", "gram", "grams", "oz",
]);

/** Lowercase word tokens (kebab/space/underscore split), stop-words removed. */
export function tokenizeEnrichment(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// The POS product being enriched (the ground truth to cover).
// ---------------------------------------------------------------------------

export type PosProductSignals = {
  /** menu_items.name (or enrichment last_seen_name). */
  name: string;
  /** POS brand name, when known. */
  brand?: string | null;
  /** POS category, when known. */
  category?: string | null;
};

export type MatchReason = string;

export type ScoredMatch<T> = {
  candidate: T;
  /** 0..1 — fraction-of-POS-name-covered, with brand/category adjustments. */
  score: number;
  reasons: MatchReason[];
};

/** Minimum score a candidate needs before we bother the enricher with it. */
export const MIN_MATCH_SCORE = 0.5;

/**
 * Shared scoring skeleton. Direction matters: the POS product name is the
 * ground truth to cover; candidate text often carries extra junk.
 *   coverage = |POS-name tokens found in candidate text| / |POS-name tokens|
 * Brand agreement adds +0.2 (capped at 1); brand disagreement halves.
 */
function scoreAgainst(
  pos: PosProductSignals,
  candidateText: string,
  candidateBrand: string | null | undefined,
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  const posTokens = [...new Set(tokenizeEnrichment(pos.name))];
  const candTokens = new Set(tokenizeEnrichment(candidateText));

  if (posTokens.length === 0 || candTokens.size === 0) {
    return { score: 0, reasons: ["Not enough text to compare."] };
  }

  const hits = posTokens.filter((t) => candTokens.has(t));
  let score = hits.length / posTokens.length;
  if (hits.length > 0) {
    reasons.push(`Name overlap: ${hits.join(", ")} (${hits.length}/${posTokens.length} product words).`);
  }

  const posBrand = new Set(tokenizeEnrichment(pos.brand));
  const candBrand = tokenizeEnrichment(candidateBrand);
  if (posBrand.size > 0 && candBrand.length > 0) {
    const brandHit = candBrand.some((t) => posBrand.has(t));
    if (brandHit) {
      score = Math.min(1, score + 0.2);
      reasons.push(`Brand matches (${(candidateBrand ?? "").trim()}).`);
    } else {
      score = score * 0.5;
      reasons.push(`Brand differs (product: ${pos.brand}; candidate: ${candidateBrand}).`);
    }
  }

  return { score: Number(score.toFixed(2)), reasons };
}

// ---------------------------------------------------------------------------
// 1) KB product candidates (kb_products subset).
// ---------------------------------------------------------------------------

export type KbCandidate = {
  id: string;
  display_name: string;
  brand_slug: string;
  variant_label: string;
  category: string | null;
  status: string;
  /** True when the KB row has a usable image (primary or gallery). */
  hasImage: boolean;
  hasDescription: boolean;
};

export function scoreKbCandidate(pos: PosProductSignals, kb: KbCandidate): ScoredMatch<KbCandidate> {
  const text = `${kb.display_name} ${kb.variant_label}`;
  const { score, reasons } = scoreAgainst(pos, text, kb.brand_slug.replace(/-/g, " "));
  const extras: MatchReason[] = [];
  if (kb.hasImage) extras.push("Has a product image.");
  if (kb.hasDescription) extras.push("Has a validated description.");
  if (kb.status === "published") extras.push("Published KB entry.");
  return { candidate: kb, score, reasons: [...reasons, ...extras] };
}

// ---------------------------------------------------------------------------
// 2) Media-library candidates (media_assets subset).
// ---------------------------------------------------------------------------

export type MediaCandidate = {
  id: string;
  title: string | null;
  alt_text: string | null;
  tags: string[];
  usage_type: string | null;
  status: string;
};

export function scoreMediaCandidate(pos: PosProductSignals, m: MediaCandidate): ScoredMatch<MediaCandidate> {
  const text = `${m.title ?? ""} ${m.alt_text ?? ""} ${m.tags.join(" ")}`;
  // Media assets rarely carry a clean brand field; brand tokens (if any) live
  // in the tags/title, so pass null and let name coverage carry the score.
  const { score, reasons } = scoreAgainst(pos, text, null);
  const extras: MatchReason[] = [];
  if (m.status === "published") extras.push("Published in the media library.");
  if (m.usage_type === "product") extras.push("Tagged as a product image.");
  return { candidate: m, score, reasons: [...reasons, ...extras] };
}

// ---------------------------------------------------------------------------
// 3) Vendor menu-line candidates (Cultivera/GrowFlow snapshot rows).
// ---------------------------------------------------------------------------

export type VendorItemCandidate = {
  id: string;
  platform: "cultivera" | "growflow";
  name: string | null;
  brand: string | null;
  category: string | null;
  /** Vendor-hosted image URL on the menu line (importable). */
  image_url: string | null;
  /** Already-imported media asset, when the buyer saved it. */
  media_asset_id: string | null;
  description: string | null;
};

export function scoreVendorCandidate(
  pos: PosProductSignals,
  v: VendorItemCandidate,
): ScoredMatch<VendorItemCandidate> {
  const { score, reasons } = scoreAgainst(pos, v.name ?? "", v.brand);
  const extras: MatchReason[] = [];
  if (v.media_asset_id) extras.push("Image already saved to the media library.");
  else if (v.image_url) extras.push("Vendor image available to import.");
  if (v.description) extras.push("Vendor description available.");
  return { candidate: v, score, reasons: [...reasons, ...extras] };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Gate by MIN_MATCH_SCORE, best first, capped. Stable for equal scores. */
export function rankMatches<T>(matches: ScoredMatch<T>[], limit = 5): ScoredMatch<T>[] {
  return matches
    .filter((m) => m.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// "No assets" guidance (owner: suggest methods for getting the assets needed,
// or ask if we'd like to use a fallback image instead).
// ---------------------------------------------------------------------------

export type GuidanceInput = {
  hasDescription: boolean;
  hasImage: boolean;
  /** Counts of ranked (≥ MIN_MATCH_SCORE) suggestions available in the UI. */
  kbMatches: number;
  mediaMatches: number;
  vendorMatches: number;
  /** An approved substitute image exists for this category/brand/type. */
  substituteAvailable: boolean;
  /** POS brand, to personalise the "ask the rep" line. */
  brand?: string | null;
};

/**
 * Ordered plain-English next steps. Empty when the product already has both
 * a description and an image (nothing to chase).
 */
export function buildAssetGuidance(g: GuidanceInput): string[] {
  const out: string[] = [];
  if (g.hasDescription && g.hasImage) return out;

  if (g.kbMatches > 0 || g.mediaMatches > 0 || g.vendorMatches > 0) {
    out.push("Review the suggested matches below — applying one takes a single click.");
  }
  if (!g.hasImage) {
    if (g.vendorMatches === 0) {
      out.push("Harvest the vendor's Cultivera/GrowFlow menu (Purchasing → Vendor Menus) — product photos import straight into the media library.");
    }
    out.push(
      g.brand
        ? `Ask your ${g.brand} rep for official product photography — brand assets are usually free for retail partners.`
        : "Ask the brand rep for official product photography — brand assets are usually free for retail partners.",
    );
    out.push("Photograph the product in store (natural light, neutral background) and upload it below.");
    if (g.substituteAvailable) {
      out.push("Or use the approved fallback image for this category so the menu card is never blank — you can swap in a real photo later.");
    }
  }
  if (!g.hasDescription) {
    out.push("Generate a compliant AI description draft below, or copy the vendor/KB description if one matched.");
  }
  return out;
}

// ---------------------------------------------------------------------------
// SLICE 73 — jump-to actions. Each plain-English guidance line above tells the
// owner WHAT to do; these give a BUTTON that jumps straight to WHERE to do it
// (an admin page or an in-page anchor). Additive: buildAssetGuidance keeps its
// string[] shape so every existing consumer and test stays valid.
// ---------------------------------------------------------------------------

export type GuidanceAction = {
  /** Short button text, e.g. "Harvest vendor menus". */
  label: string;
  /** Internal admin route ("/admin/…") or in-page anchor ("#ai"). */
  href: string;
  /** Plain-English tooltip: why this jump helps. */
  hint: string;
};

export type GuidanceActionInput = GuidanceInput & {
  /** Enrichment brand link state; omit (undefined) to skip the brand action. */
  hasBrandLink?: boolean;
  /** Tags state (SLICE 75 checklist); omit (undefined) to skip the tags row. */
  hasTags?: boolean;
  /** Pre-fill for the media-library search (usually the product-name tokens). */
  searchQuery?: string | null;
};

/**
 * Ordered jump-to buttons for the "How to finish enriching" panel. Mirrors the
 * priority order of buildAssetGuidance. Empty when nothing is missing.
 * Pure: only string building — no I/O, inputs never mutated.
 */
export function buildGuidanceActions(g: GuidanceActionInput): GuidanceAction[] {
  const out: GuidanceAction[] = [];
  const brandMissing = g.hasBrandLink === false;
  const tagsMissing = g.hasTags === false;
  if (g.hasDescription && g.hasImage && !brandMissing && !tagsMissing) return out;

  if (g.kbMatches > 0 || g.mediaMatches > 0 || g.vendorMatches > 0) {
    out.push({
      label: "Review suggested matches",
      href: "#matches",
      hint: "Ranked matches from your knowledge base, media library and vendor menus — applying one takes a single click.",
    });
  }
  if (!g.hasImage) {
    if (g.vendorMatches === 0) {
      out.push({
        label: "Harvest vendor menus",
        href: "/admin/purchasing/menus",
        hint: "Import product photos straight from the vendor's Cultivera/GrowFlow menu into the media library.",
      });
    }
    const q = (g.searchQuery ?? "").trim();
    out.push({
      label: "Search the media library",
      href: q ? `/admin/media?q=${encodeURIComponent(q)}` : "/admin/media",
      hint: "The photo may already be uploaded — the search box is pre-filled with this product's name.",
    });
    out.push({
      label: "Run the KB harvest",
      href: "/admin/knowledge-base/harvest",
      hint: "The crawler chases brand and product images/descriptions from the web, worst-covered first.",
    });
    out.push({
      label: "Upload a photo",
      href: "#upload",
      hint: "Jump to the Add image field — a phone photo on a neutral background works great.",
    });
    if (g.substituteAvailable) {
      out.push({
        label: "Manage fallback images",
        href: "/admin/knowledge-base/images",
        hint: "The approved category fallback already covers this card — swap or tune it here.",
      });
    }
  }
  if (!g.hasDescription) {
    out.push({
      label: "Draft an AI description",
      href: "#ai",
      hint: "Jump to the AI drafting panel — every draft is a suggestion you approve before it goes live.",
    });
  }
  if (brandMissing) {
    out.push({
      label: "Link the brand",
      href: "#brand",
      hint: "Jump to the Brand link panel — linked brands unlock knowledge-base copy and vendor context.",
    });
  }
  if (tagsMissing) {
    out.push({
      label: "Pick tags",
      href: "#tags",
      hint: "Jump to the Tags picker — tags power search and filtering on the public menu.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SLICE 75 — permanent enrichment checklist. The owner asked for the "How to
// finish enriching this product" panel to STAY on the page forever, so the
// panel now always renders and this pure helper turns the real gap flags into
// ✓/○ checklist rows (done items confirm the work; open items link to the
// guidance + jump-to buttons below). Additive: buildAssetGuidance and
// buildGuidanceActions keep their shapes and their "empty when satisfied"
// contracts — the PAGE decides to render the panel unconditionally.
// ---------------------------------------------------------------------------

export type ChecklistItem = {
  /** Plain-English name of the detail, e.g. "Photo". */
  label: string;
  /** True when the live data already has this detail. */
  done: boolean;
  /** One-line plain-English status shown next to the label. */
  detail: string;
};

export type ChecklistInput = {
  hasDescription: boolean;
  hasImage: boolean;
  /** Omit (undefined) to hide the brand row (legacy callers). */
  hasBrandLink?: boolean;
  /** Omit (undefined) to hide the tags row (legacy callers). */
  hasTags?: boolean;
};

/**
 * The always-visible enrichment scorecard. Pure: only string building — no
 * I/O, inputs never mutated. Order mirrors the worklist gap weights
 * (image > description > brand > tags).
 */
export function buildEnrichmentChecklist(g: ChecklistInput): ChecklistItem[] {
  const out: ChecklistItem[] = [
    {
      label: "Photo",
      done: g.hasImage,
      detail: g.hasImage
        ? "The menu card shows this product's own photo."
        : "No photo yet — the menu falls back to a category image or mockup.",
    },
    {
      label: "Description",
      done: g.hasDescription,
      detail: g.hasDescription
        ? "Shoppers see real copy on the product page."
        : "No description yet — the product page reads bare.",
    },
  ];
  if (g.hasBrandLink !== undefined) {
    out.push({
      label: "Brand link",
      done: g.hasBrandLink,
      detail: g.hasBrandLink
        ? "Connected to its brand page."
        : "Not linked — brand page and KB copy stay disconnected.",
    });
  }
  if (g.hasTags !== undefined) {
    out.push({
      label: "Tags",
      done: g.hasTags,
      detail: g.hasTags
        ? "Tagged for search and filtering."
        : "No tags yet — harder to find in search and filters.",
    });
  }
  return out;
}

/** True when every checklist row is done (drives the "fully enriched" state). */
export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.every((i) => i.done);
}

// ---------------------------------------------------------------------------
// Worklist sorting + status filter (the list page's controls).
// ---------------------------------------------------------------------------

export type EnrichmentSortKey =
  | "gaps"
  | "name"
  | "brand"
  | "category"
  | "status"
  // SLICE 72 — worklist intelligence.
  | "priority"
  | "priceHigh"
  | "priceLow";
export const ENRICHMENT_SORT_KEYS: readonly EnrichmentSortKey[] = [
  "gaps", "name", "brand", "category", "status", "priority", "priceHigh", "priceLow",
];

export function parseEnrichmentSort(raw: string | null | undefined): EnrichmentSortKey {
  return (ENRICHMENT_SORT_KEYS as readonly string[]).includes(raw ?? "") ? (raw as EnrichmentSortKey) : "gaps";
}

export type EnrichmentStatusFilter = "" | "none" | "draft" | "published" | "archived";

export function parseEnrichmentStatusFilter(raw: string | null | undefined): EnrichmentStatusFilter {
  return raw === "none" || raw === "draft" || raw === "published" || raw === "archived" ? raw : "";
}

/** SLICE 72 — stock filter for the worklist (POS inventory_status values). */
export type EnrichmentStockFilter = "" | "in-stock" | "low-stock" | "unavailable";

export function parseEnrichmentStockFilter(raw: string | null | undefined): EnrichmentStockFilter {
  return raw === "in-stock" || raw === "low-stock" || raw === "unavailable" ? raw : "";
}

/**
 * The gap-flag subset the sorter needs (matches store.ts GapFlags).
 * SLICE 72 fields are OPTIONAL so older callers/tests stay valid; sorts that
 * need them treat missing values defensively.
 */
export type SortableGapRow = {
  name: string;
  brand: string;
  category: string;
  hasDescription: boolean;
  hasImage: boolean;
  hasBrandLink: boolean;
  enrichmentStatus: string | null;
  hasTags?: boolean;
  priceMinorUnits?: number;
  inventoryStatus?: string;
};

/** How many enrichment gaps a row has (image weighted first for ties). */
export function gapCount(g: SortableGapRow): number {
  return (g.hasDescription ? 0 : 1) + (g.hasImage ? 0 : 1) + (g.hasBrandLink ? 0 : 1);
}

const STATUS_ORDER: Record<string, number> = { published: 0, draft: 1, archived: 2 };

/**
 * SLICE 72 — worklist PRIORITY score. "What should I enrich next?" answered
 * with shopkeeper logic: a product that shoppers can actually BUY right now
 * and that looks broken online outranks everything else.
 *
 *   • each gap counts (image weighted heaviest — it hurts the card most,
 *     then description, then brand link, then tags),
 *   • in-stock products outrank low-stock, which outrank sold-out (fixing a
 *     card nobody can buy helps nobody today),
 *   • pricier products get a small nudge (more revenue per fix).
 *
 * Pure and defensive: missing SLICE 72 fields degrade gracefully.
 */
export function enrichmentPriorityScore(g: SortableGapRow): number {
  let score = 0;
  if (!g.hasImage) score += 40;
  if (!g.hasDescription) score += 30;
  if (!g.hasBrandLink) score += 15;
  if (g.hasTags === false) score += 10;
  const stock = g.inventoryStatus ?? "";
  if (stock === "in-stock") score += 20;
  else if (stock === "low-stock") score += 10;
  // Price nudge: 0–5 points, capped at $100 (10000 cents). Never dominates.
  const price = Math.max(0, Math.trunc(Number(g.priceMinorUnits) || 0));
  score += Math.min(5, Math.round((Math.min(price, 10000) / 10000) * 5));
  return score;
}

/**
 * Sort the worklist. "gaps" (default) puts the most-broken products first —
 * the enricher's actual to-do order; the rest are stable alphabetical views.
 * Pure: returns a new array.
 */
export function sortEnrichmentList<T extends SortableGapRow>(rows: T[], sort: EnrichmentSortKey): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const copy = [...rows];
  switch (sort) {
    case "name":
      return copy.sort(byName);
    case "brand":
      return copy.sort((a, b) => a.brand.localeCompare(b.brand) || byName(a, b));
    case "category":
      return copy.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
    case "status":
      return copy.sort(
        (a, b) =>
          (STATUS_ORDER[a.enrichmentStatus ?? ""] ?? 3) - (STATUS_ORDER[b.enrichmentStatus ?? ""] ?? 3) || byName(a, b),
      );
    case "priority":
      // SLICE 72: sellable + broken first (see enrichmentPriorityScore).
      return copy.sort((a, b) => enrichmentPriorityScore(b) - enrichmentPriorityScore(a) || byName(a, b));
    case "priceHigh":
      return copy.sort((a, b) => (b.priceMinorUnits ?? 0) - (a.priceMinorUnits ?? 0) || byName(a, b));
    case "priceLow":
      return copy.sort((a, b) => (a.priceMinorUnits ?? 0) - (b.priceMinorUnits ?? 0) || byName(a, b));
    case "gaps":
    default:
      return copy.sort((a, b) => gapCount(b) - gapCount(a) || Number(a.hasImage) - Number(b.hasImage) || byName(a, b));
  }
}

/** Apply the enrichment-status filter ("" = all, "none" = never enriched). */
export function filterByEnrichmentStatus<T extends SortableGapRow>(rows: T[], f: EnrichmentStatusFilter): T[] {
  if (!f) return rows;
  if (f === "none") return rows.filter((r) => r.enrichmentStatus === null);
  return rows.filter((r) => r.enrichmentStatus === f);
}

/** SLICE 72 — apply the stock filter ("" = all). Unknown statuses never match. */
export function filterByStock<T extends SortableGapRow>(rows: T[], f: EnrichmentStockFilter): T[] {
  if (!f) return rows;
  return rows.filter((r) => (r.inventoryStatus ?? "") === f);
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runEnrichmentMatchCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  FAIL enrichment-match-core: ${label}`);
    }
  };

  // Tokeniser.
  ok(tokenizeEnrichment("Blue Dream 3.5g Flower").join(",") === "blue,dream,5g,flower", "tokenize strips numbers + keeps 5g");
  ok(tokenizeEnrichment("THC 100mg Pack of 10").join(",") === "100mg", "stop words + pure numbers removed (100mg kept)");
  ok(tokenizeEnrichment(null).length === 0, "null-safe tokenize");

  const pos: PosProductSignals = { name: "Blue Dream Flower 3.5g", brand: "Phat Panda", category: "flower" };

  // KB scoring — exact-ish name + brand agreement.
  const kbHit = scoreKbCandidate(pos, {
    id: "k1", display_name: "Blue Dream Flower", brand_slug: "phat-panda", variant_label: "3.5g",
    category: "flower", status: "published", hasImage: true, hasDescription: true,
  });
  ok(kbHit.score >= 0.9, `KB exact match scores high (got ${kbHit.score})`);
  ok(kbHit.reasons.some((r) => r.startsWith("Brand matches")), "KB brand agreement reason present");
  ok(kbHit.reasons.includes("Has a product image."), "KB image extra reason present");

  // KB scoring — brand disagreement halves.
  const kbMiss = scoreKbCandidate(pos, {
    id: "k2", display_name: "Blue Dream Flower", brand_slug: "other-farms", variant_label: "3.5g",
    category: "flower", status: "draft", hasImage: false, hasDescription: false,
  });
  ok(kbMiss.score < kbHit.score, "brand disagreement scores lower than agreement");
  ok(kbMiss.reasons.some((r) => r.startsWith("Brand differs")), "brand-differs reason present");

  // Media scoring — token coverage from title/tags.
  const media = scoreMediaCandidate(pos, {
    id: "m1", title: "blue-dream-flower.jpg", alt_text: null,
    tags: ["phat panda"], usage_type: "product", status: "published",
  });
  ok(media.score >= MIN_MATCH_SCORE, `media title match clears gate (got ${media.score})`);
  ok(media.reasons.includes("Tagged as a product image."), "media usage reason present");

  // Vendor scoring — import availability reasons.
  const vend = scoreVendorCandidate(pos, {
    id: "v1", platform: "cultivera", name: "Blue Dream Flower 3.5g", brand: "Phat Panda",
    category: "Flower", image_url: "https://cdn.example/bd.jpg", media_asset_id: null,
    description: "A classic sativa-leaning favorite.",
  });
  ok(vend.score >= 0.9, `vendor exact match scores high (got ${vend.score})`);
  ok(vend.reasons.includes("Vendor image available to import."), "vendor importable-image reason");
  ok(vend.reasons.includes("Vendor description available."), "vendor description reason");

  // Empty text handling.
  const empty = scoreVendorCandidate(pos, {
    id: "v2", platform: "growflow", name: null, brand: null, category: null,
    image_url: null, media_asset_id: null, description: null,
  });
  ok(empty.score === 0 && empty.reasons[0] === "Not enough text to compare.", "empty candidate scores 0");

  // Ranking — gate + order + cap.
  const ranked = rankMatches([
    { candidate: 1, score: 0.4, reasons: [] },
    { candidate: 2, score: 0.9, reasons: [] },
    { candidate: 3, score: 0.6, reasons: [] },
  ]);
  ok(ranked.length === 2 && ranked[0]?.candidate === 2 && ranked[1]?.candidate === 3, "rank gates at 0.5 and sorts best-first");
  ok(rankMatches([{ candidate: 1, score: 1, reasons: [] }], 0).length === 0, "rank respects limit 0");

  // Guidance — fully enriched → nothing to chase.
  ok(
    buildAssetGuidance({
      hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: true,
    }).length === 0,
    "no guidance when description + image both present",
  );

  // Guidance — nothing anywhere → full acquisition checklist + fallback offer.
  const bare = buildAssetGuidance({
    hasDescription: false, hasImage: false, kbMatches: 0, mediaMatches: 0,
    vendorMatches: 0, substituteAvailable: true, brand: "Phat Panda",
  });
  ok(bare.some((l) => l.includes("Harvest the vendor")), "guidance suggests harvesting vendor menu");
  ok(bare.some((l) => l.includes("Phat Panda rep")), "guidance personalises the brand-rep ask");
  ok(bare.some((l) => l.includes("approved fallback image")), "guidance offers the approved fallback");
  ok(bare.some((l) => l.includes("AI description")), "guidance covers the missing description");

  // Guidance — matches exist → review-first line; no harvest line when vendor matched.
  const matched = buildAssetGuidance({
    hasDescription: true, hasImage: false, kbMatches: 1, mediaMatches: 0,
    vendorMatches: 2, substituteAvailable: false,
  });
  ok(matched[0]?.includes("suggested matches") === true, "guidance leads with review-matches when suggestions exist");
  ok(!matched.some((l) => l.includes("Harvest the vendor")), "no harvest suggestion when vendor matches already found");
  ok(!matched.some((l) => l.includes("fallback image")), "no fallback offer when no substitute available");

  // Sorting + status filtering.
  const rows: SortableGapRow[] = [
    { name: "Alpha", brand: "Z Farms", category: "edible", hasDescription: true, hasImage: true, hasBrandLink: true, enrichmentStatus: "published" },
    { name: "Bravo", brand: "A Farms", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null },
    { name: "Charlie", brand: "M Farms", category: "flower", hasDescription: true, hasImage: false, hasBrandLink: true, enrichmentStatus: "draft" },
  ];
  ok(parseEnrichmentSort("bogus") === "gaps", "sort parser defaults to gaps");
  ok(parseEnrichmentSort("brand") === "brand", "sort parser accepts brand");
  ok(parseEnrichmentStatusFilter("published") === "published", "status parser accepts published");
  ok(parseEnrichmentStatusFilter("junk") === "", "status parser defaults to all");
  ok(gapCount(rows[1]!) === 3 && gapCount(rows[0]!) === 0, "gapCount counts all three gaps");
  const gapsFirst = sortEnrichmentList(rows, "gaps");
  ok(gapsFirst[0]?.name === "Bravo" && gapsFirst[2]?.name === "Alpha", "gaps sort puts most-broken first");
  ok(sortEnrichmentList(rows, "brand")[0]?.brand === "A Farms", "brand sort alphabetical");
  ok(sortEnrichmentList(rows, "status")[0]?.enrichmentStatus === "published", "status sort: published first, never-enriched last");
  ok(sortEnrichmentList(rows, "name")[0]?.name === "Alpha", "name sort alphabetical");
  ok(filterByEnrichmentStatus(rows, "none").length === 1 && filterByEnrichmentStatus(rows, "none")[0]?.name === "Bravo", "status filter 'none' = never enriched");
  ok(filterByEnrichmentStatus(rows, "").length === 3, "empty status filter keeps all");
  ok(rows[0]?.name === "Alpha", "sortEnrichmentList does not mutate input");

  // SLICE 72 — priority score, price sorts, stock filter.
  const worklist: SortableGapRow[] = [
    // Fully broken but SOLD OUT — fixing it helps nobody today.
    { name: "Dead", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null, hasTags: false, priceMinorUnits: 4000, inventoryStatus: "unavailable" },
    // Fully broken and IN STOCK — the top priority.
    { name: "Hot", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null, hasTags: false, priceMinorUnits: 4000, inventoryStatus: "in-stock" },
    // Complete and in stock — bottom of the pile.
    { name: "Done", brand: "B", category: "flower", hasDescription: true, hasImage: true, hasBrandLink: true, enrichmentStatus: "published", hasTags: true, priceMinorUnits: 9000, inventoryStatus: "in-stock" },
  ];
  ok(enrichmentPriorityScore(worklist[1]!) > enrichmentPriorityScore(worklist[0]!), "priority: in-stock broken beats sold-out broken");
  ok(enrichmentPriorityScore(worklist[0]!) > enrichmentPriorityScore(worklist[2]!), "priority: any broken beats complete");
  const prio = sortEnrichmentList(worklist, "priority");
  ok(prio[0]?.name === "Hot" && prio[2]?.name === "Done", "priority sort: sellable+broken first, complete last");
  ok(sortEnrichmentList(worklist, "priceHigh")[0]?.name === "Done", "priceHigh sort: dearest first");
  ok(sortEnrichmentList(worklist, "priceLow")[0]?.priceMinorUnits === 4000, "priceLow sort: cheapest first");
  ok(parseEnrichmentSort("priority") === "priority" && parseEnrichmentSort("priceHigh") === "priceHigh", "sort parser accepts SLICE 72 keys");
  ok(filterByStock(worklist, "in-stock").length === 2, "stock filter: in-stock");
  ok(filterByStock(worklist, "unavailable")[0]?.name === "Dead", "stock filter: unavailable");
  ok(filterByStock(worklist, "").length === 3, "stock filter: empty keeps all");
  ok(parseEnrichmentStockFilter("junk") === "" && parseEnrichmentStockFilter("low-stock") === "low-stock", "stock parser defensive");
  // Defensive: legacy rows without SLICE 72 fields still sort without throwing.
  const legacy: SortableGapRow[] = [
    { name: "Old", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null },
  ];
  ok(sortEnrichmentList(legacy, "priority").length === 1 && sortEnrichmentList(legacy, "priceHigh").length === 1, "legacy rows: SLICE 72 sorts degrade gracefully");
  ok(Number.isFinite(enrichmentPriorityScore(legacy[0]!)), "legacy rows: priority score stays finite");

  // SLICE 73 — jump-to actions mirror the guidance priorities with real hrefs.
  ok(
    buildGuidanceActions({
      hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: true, hasBrandLink: true,
    }).length === 0,
    "actions: fully enriched + brand linked → no buttons",
  );
  const bareActs = buildGuidanceActions({
    hasDescription: false, hasImage: false, kbMatches: 0, mediaMatches: 0,
    vendorMatches: 0, substituteAvailable: true, hasBrandLink: false,
    searchQuery: "Grape Gas 3.5g",
  });
  ok(bareActs.some((a) => a.href === "/admin/purchasing/menus"), "actions: no vendor matches → harvest vendor menus button");
  ok(bareActs.some((a) => a.href === "/admin/media?q=Grape%20Gas%203.5g"), "actions: media search pre-filled with the product name");
  ok(bareActs.some((a) => a.href === "/admin/knowledge-base/harvest"), "actions: KB harvest button offered for missing image");
  ok(bareActs.some((a) => a.href === "#upload"), "actions: in-page jump to the upload field");
  ok(bareActs.some((a) => a.href === "/admin/knowledge-base/images"), "actions: fallback manager offered when substitute exists");
  ok(bareActs.some((a) => a.href === "#ai"), "actions: missing description → jump to AI panel");
  ok(bareActs[bareActs.length - 1]?.href === "#brand", "actions: unlinked brand → jump to brand panel, last");
  ok(bareActs.every((a) => a.label.length > 0 && a.hint.length > 0), "actions: every button carries a label and a plain-English hint");
  const withMatches = buildGuidanceActions({
    hasDescription: false, hasImage: false, kbMatches: 2, mediaMatches: 0,
    vendorMatches: 1, substituteAvailable: false,
  });
  ok(withMatches[0]?.href === "#matches", "actions: suggestions exist → review-matches button leads");
  ok(!withMatches.some((a) => a.href === "/admin/purchasing/menus"), "actions: vendor matches present → no harvest nag");
  ok(!withMatches.some((a) => a.href === "/admin/knowledge-base/images"), "actions: no substitute → no fallback-manager button");
  ok(!withMatches.some((a) => a.href === "#brand"), "actions: hasBrandLink undefined → brand action skipped (legacy callers safe)");
  const noQuery = buildGuidanceActions({
    hasDescription: true, hasImage: false, kbMatches: 0, mediaMatches: 0,
    vendorMatches: 0, substituteAvailable: false, searchQuery: "   ",
  });
  ok(noQuery.some((a) => a.href === "/admin/media"), "actions: blank search query → plain media-library link (no dangling ?q=)");
  ok(!noQuery.some((a) => a.href === "#ai"), "actions: description present → no AI button");

  // SLICE 75 — tags action + the permanent checklist.
  const tagsOnly = buildGuidanceActions({
    hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
    vendorMatches: 0, substituteAvailable: false, hasBrandLink: true, hasTags: false,
  });
  ok(tagsOnly.length === 1 && tagsOnly[0]?.href === "#tags", "actions: only tags missing → single jump to the tags picker");
  ok(
    buildGuidanceActions({
      hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: false, hasBrandLink: true, hasTags: true,
    }).length === 0,
    "actions: everything satisfied incl. tags → still zero buttons",
  );
  ok(
    !buildGuidanceActions({
      hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: false, hasBrandLink: true,
    }).some((a) => a.href === "#tags"),
    "actions: hasTags undefined → tags action skipped (legacy callers safe)",
  );
  const listFull = buildEnrichmentChecklist({ hasDescription: true, hasImage: true, hasBrandLink: true, hasTags: true });
  ok(listFull.length === 4 && checklistComplete(listFull), "checklist: all four rows done → complete");
  ok(listFull[0]?.label === "Photo" && listFull[1]?.label === "Description",
    "checklist: order mirrors gap weights (photo first, then description)");
  const listBare = buildEnrichmentChecklist({ hasDescription: false, hasImage: false, hasBrandLink: false, hasTags: false });
  ok(listBare.every((i) => !i.done) && !checklistComplete(listBare), "checklist: bare product → nothing done");
  ok(listBare.every((i) => i.detail.length > 0), "checklist: every row carries a plain-English status line");
  const listLegacy = buildEnrichmentChecklist({ hasDescription: true, hasImage: false });
  ok(listLegacy.length === 2, "checklist: brand/tags omitted → rows hidden (legacy callers safe)");
  ok(!checklistComplete(listLegacy) && checklistComplete([]), "checklist: one open row blocks complete; empty list is trivially complete");

  if (fail > 0) throw new Error(`enrichment-match-core: ${fail} failure(s)`);
  console.log(`enrichment-match-core: ${pass} checks passed`);
}
