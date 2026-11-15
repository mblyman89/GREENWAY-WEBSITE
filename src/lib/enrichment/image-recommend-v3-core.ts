/**
 * D244 E-3 — Image recommender v3 for the Enrichment detail page (PURE, no I/O).
 *
 * Before E-3 the detail page's "From the media library" suggestions scored
 * only the newest 400 product-purpose pictures by title/alt/tags (F-30), and
 * never used the two strongest signals the onboarding panel already had:
 * image memory (0279, a person's past pick for this product identity) and
 * pictures already approved on another card with the same identity (F-37).
 *
 * v3 = the D221 recommender (`recommendImages`, unchanged) fed a wider pool,
 * then re-ordered here:
 *   1. pool: search hits for the full name AND for each of the product's own
 *      name words on their own (so one wrong word in a title no longer hides
 *      the photo: media_search is AND-of-terms, F-34), the vendor's and the
 *      brand's whole shelf, the remembered / on-record pictures by id, then
 *      the newest pictures of the whole library (not only "product" usage).
 *   2. order: remembered > on this product's card > everything else; inside
 *      a tier, the recommender's confidence plus small tie-breaks for the
 *      same pack size and a real product photo. Pictures already in this
 *      gallery go last. The confidence shown is the recommender's own — the
 *      tie-breaks never change the number a person sees.
 *   3. at most RECOMMEND_PANEL_LIMIT tiles.
 *
 * D244 R-22 — owner (round 9, verbatim): "I need every product image I
 * remove text from to be the second highest suggested item behind exact
 * matches. The removed text gives me the ability to use a generic version
 * of their product as a representation. ... Please also expand the list of
 * suggestions on the copilot page to be every image from that vendor."
 *   Tiers now: picked before > on this card > exact match (High, 80%+) >
 *   a PUBLISHED text-removed photo of this vendor / brand > everything else.
 *   recommendExtras adds the photos the recommender dropped under its floor:
 *   always this vendor's published text-removed photos; on the Copilot
 *   (wholeVendor) every photo of this vendor / brand. The confidence shown
 *   stays the recommender's own number.
 *
 * Embeddings / vision confirmation are NOT here (owner Q5 still open).
 */
import {
  MIN_RECOMMEND_CONFIDENCE,
  NOT_PRODUCT_ROLES,
  packSizes,
  vendorMatch,
  type ImageRecommendView,
  type ImageRecommendation,
} from "@/lib/catalog/image-recommend-core";
import { isPickableImage, type LibraryPickerAsset } from "@/lib/media/library-picker-core";

export const RECOMMEND_PANEL_LIMIT = 12;
/** How many name words get their own one-word search. */
export const MAX_WORD_SEARCHES = 3;
/** The recommender runs wide, then this file orders and trims. */
export const RECOMMEND_WIDE_LIMIT = 60;
export const PACK_MATCH_NUDGE = 3;
export const PRODUCT_ROLE_NUDGE = 2;
/** D244 R-22: an "exact match" is High (80%+) or a person's own past pick. */
export const EXACT_MATCH_MIN = 80;
/** D244 R-22: the Copilot shows every photo of the vendor (more than the 3000-row shelf read can return). */
export const COPILOT_PANEL_LIMIT = 4000;
/** D244 R-22: the chip a text-removed photo carries. */
export const TEXT_REMOVED_CHIP = "Text removed \u00b7 generic";
/** The tag every FLUX text-removed photo carries (text-erase-core ERASE_TAGS). */
export const TEXT_REMOVED_TAG = "text-removed";

const PRODUCT_ROLES = new Set(["product", "packaging", "flower"]);
const STOP = new Set(["the", "and", "for", "with", "pre", "roll", "rolls", "pack", "flower", "cart", "cartridge", "infused", "gram", "grams"]);

function words(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * The one-word searches for a product: its OWN name words (brand / vendor
 * words removed, pack sizes and filler removed), 3+ letters, longest first,
 * at most MAX_WORD_SEARCHES. A one-word name gives no extra searches (the
 * full-name search already covers it).
 */
export function recommendSearchWords(p: { name: string | null | undefined; brand?: string | null; vendor?: string | null }): string[] {
  const brand = new Set(words(`${p.brand ?? ""} ${p.vendor ?? ""}`));
  const own: string[] = [];
  for (const t of words(p.name)) {
    if (t.length < 3 || /^\d/.test(t) || STOP.has(t) || brand.has(t) || own.includes(t)) continue;
    own.push(t);
  }
  if (own.length < 2) return [];
  return [...own].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_WORD_SEARCHES);
}

/** The full-name search text: the name without pack sizes. "" when too short. */
export function recommendFullQuery(name: string | null | undefined): string {
  const q = words(name)
    .filter((t) => !/^\d+(\.\d+)?[a-z]{0,3}$/.test(t))
    .join(" ")
    .trim();
  return q.length >= 2 ? q.slice(0, 120) : "";
}

/** Merge pools in order, first copy of each id wins. */
export function mergeRecommendPools(pools: readonly (readonly LibraryPickerAsset[] | null | undefined)[]): LibraryPickerAsset[] {
  const seen = new Set<string>();
  const out: LibraryPickerAsset[] = [];
  for (const pool of pools) {
    for (const a of pool ?? []) {
      const id = (a?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(a);
    }
  }
  return out;
}

export type PackFit = "same" | "other" | "unknown";

/** Does the picture show the same pack size as the product name? */
export function packFit(a: Pick<LibraryPickerAsset, "pack_size" | "visible_text" | "title">, productName: string | null | undefined): PackFit {
  const want = packSizes(productName);
  if (want.length === 0) return "unknown";
  const have = new Set([...packSizes(a.pack_size ?? ""), ...packSizes(a.visible_text ?? ""), ...packSizes(a.title ?? "")]);
  if (have.size === 0) return "unknown";
  return want.some((w) => have.has(w)) ? "same" : "other";
}

export type RecommendTile = ImageRecommendation & { pack: PackFit; productPhoto: boolean; textRemoved: boolean };

/** D244 R-22: a photo made by "Remove text" (tag text-removed). */
export function isTextRemovedPhoto(a: Pick<LibraryPickerAsset, "tags"> | null | undefined): boolean {
  return Boolean(a && (a.tags ?? []).some((t) => String(t).trim().toLowerCase() === TEXT_REMOVED_TAG));
}

export type RecommendProductRef = { vendorId?: string | null; brandId?: string | null };

/**
 * D244 R-22: does this text-removed photo earn the "generic photo" tier?
 * Published (a draft waits for the person's Publish), and this vendor's /
 * brand's photo, or a recommender match not filed under another vendor.
 */
export function genericTierFits(a: LibraryPickerAsset | undefined, confidence: number, product: RecommendProductRef | null | undefined): boolean {
  if (!a || !isTextRemovedPhoto(a) || a.status !== "published") return false;
  const vm = vendorMatch(a, product ?? {});
  if (vm === "same") return true;
  return vm === "unknown" && confidence >= MIN_RECOMMEND_CONFIDENCE;
}

/**
 * D244 R-22: pool photos the recommender left out that still belong in the
 * list: this vendor's / brand's published text-removed photos always, and
 * (wholeVendor, the Copilot) every pickable photo of this vendor / brand.
 * Pool order kept; ids already in the view skipped.
 */
export function recommendExtras(
  pool: readonly LibraryPickerAsset[],
  view: Pick<ImageRecommendView, "items">,
  product: RecommendProductRef,
  wholeVendor: boolean,
): LibraryPickerAsset[] {
  const have = new Set(view.items.map((r) => r.id));
  const out: LibraryPickerAsset[] = [];
  for (const a of pool) {
    if (!a || have.has(a.id) || !isPickableImage(a)) continue;
    if (vendorMatch(a, product) !== "same") continue;
    if (!wholeVendor && !(isTextRemovedPhoto(a) && a.status === "published")) continue;
    have.add(a.id);
    out.push(a);
  }
  return out;
}

export type RecommendPanel = {
  tiles: RecommendTile[];
  considered: number;
  matched: number;
  emptyText: string | null;
};

/** D244 R-22: 4 picked before, 3 on this card, 2 exact (High), 1 generic text-removed, 0 the rest. */
function tier(r: ImageRecommendation, generic: boolean): number {
  if (r.remembered) return 4;
  if (r.onRecord) return 3;
  if (r.confidence >= EXACT_MATCH_MIN) return 2;
  return generic ? 1 : 0;
}

/**
 * Order the recommender's wide view for the panel. `assets` supplies the
 * role / pack fields the view does not carry.
 */
export function orderRecommendPanel(
  view: ImageRecommendView,
  assets: readonly LibraryPickerAsset[],
  productName: string | null | undefined,
  limit: number = RECOMMEND_PANEL_LIMIT,
  product: RecommendProductRef | null = null,
): RecommendPanel {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const rows = view.items.map((r, i) => {
    const a = byId.get(r.id);
    const pack = a ? packFit(a, productName) : "unknown";
    const role = (a?.role ?? "").toLowerCase();
    const productPhoto = PRODUCT_ROLES.has(role);
    let score = r.confidence;
    if (pack === "same") score += PACK_MATCH_NUDGE;
    if (pack === "other") score -= PACK_MATCH_NUDGE;
    if (productPhoto) score += PRODUCT_ROLE_NUDGE;
    if (NOT_PRODUCT_ROLES.has(role)) score -= PRODUCT_ROLE_NUDGE;
    const textRemoved = isTextRemovedPhoto(a);
    const generic = genericTierFits(a, r.confidence, product);
    const chips = generic && !r.chips.includes(TEXT_REMOVED_CHIP) ? [TEXT_REMOVED_CHIP, ...r.chips] : r.chips;
    const reasons = generic ? [...r.reasons, "Text removed: a generic photo of this vendor's product, ranked just behind exact matches."] : r.reasons;
    return { tile: { ...r, chips, reasons, pack, productPhoto, textRemoved } as RecommendTile, score, i, t: tier(r, generic) };
  });
  rows.sort((x, y) => {
    if (x.tile.attached !== y.tile.attached) return x.tile.attached ? 1 : -1;
    const t = y.t - x.t;
    if (t !== 0) return t;
    if (y.score !== x.score) return y.score - x.score;
    return x.i - y.i;
  });
  const n = Number.isInteger(limit) && limit > 0 ? limit : RECOMMEND_PANEL_LIMIT;
  const tiles = rows.slice(0, n).map((r) => r.tile);
  return { tiles, considered: view.considered, matched: view.matched, emptyText: tiles.length > 0 ? null : view.emptyText };
}

/** "Attach" or "Attach as cover" — the panel's two buttons post `cover`. */
export function parseCoverIntent(raw: unknown): boolean {
  return raw === "1" || raw === "on" || raw === "true";
}

/** One plain line under the panel heading. */
export function recommendPanelSummary(p: Pick<RecommendPanel, "tiles" | "considered" | "matched">, memoryMissing: boolean): string {
  const fresh = p.tiles.filter((t) => !t.attached).length;
  const parts = [
    p.considered === 0
      ? "No pictures in the library to compare yet."
      : `Compared ${p.considered} picture${p.considered === 1 ? "" : "s"}; ${p.matched} look${p.matched === 1 ? "s" : ""} like this product.`,
  ];
  if (fresh > 0) parts.push(`Showing the best ${fresh}.`);
  if (memoryMissing) parts.push("Picks are not remembered yet (database update 0279 is not applied).");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Self-test (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runImageRecommendV3Tests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL image-recommend-v3: ${name}`);
    }
  };
  const eq = (name: string, a: unknown, b: unknown) => ok(name, JSON.stringify(a) === JSON.stringify(b));

  // recommendSearchWords
  eq("own words, brand dropped, longest first", recommendSearchWords({ name: "Phat Panda Blue Dream 3.5g", brand: "Phat Panda" }), ["dream", "blue"]);
  eq("one-word name -> none", recommendSearchWords({ name: "Gelato 1g" }), []);
  eq("filler dropped", recommendSearchWords({ name: "Infused Pre Roll Wedding Cake" }), ["wedding", "cake"]);
  eq("capped at 3", recommendSearchWords({ name: "Alpha Bravo Charlie Delta Echo" }).length, 3);
  eq("vendor words dropped", recommendSearchWords({ name: "Sweet Sour Kush", vendor: "Sweet Co" }), ["kush", "sour"]);
  eq("dupes once", recommendSearchWords({ name: "Kush Kush Mints" }), ["mints", "kush"]);
  eq("blank", recommendSearchWords({ name: null }), []);

  // recommendFullQuery
  eq("sizes dropped", recommendFullQuery("Blue Dream 3.5g"), "blue dream");
  eq("blank query", recommendFullQuery("  "), "");
  eq("one letter -> blank", recommendFullQuery("a"), "");
  ok("long clamp", recommendFullQuery("x".repeat(300)).length === 120);

  // mergeRecommendPools
  const A = (id: string, extra: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
    id, filename: null, title: null, alt_text: null, tags: null, usage_type: "product", status: "published",
    mime_type: "image/jpeg", license_status: null, created_at: null, url: `u/${id}`, ...extra,
  });
  eq("merge keeps first", mergeRecommendPools([[A("a"), A("b")], [A("b"), A("c")], null]).map((x) => x.id), ["a", "b", "c"]);
  eq("merge skips blank id", mergeRecommendPools([[A(""), A("z")]]).map((x) => x.id), ["z"]);

  // packFit
  eq("pack same", packFit(A("p", { pack_size: "3.5 g" }), "Blue Dream 3.5g"), "same");
  eq("pack other", packFit(A("p", { title: "Blue Dream 7g" }), "Blue Dream 3.5g"), "other");
  eq("pack unknown (product)", packFit(A("p", { pack_size: "1g" }), "Blue Dream"), "unknown");
  eq("pack unknown (picture)", packFit(A("p"), "Blue Dream 1g"), "unknown");

  // orderRecommendPanel
  const R = (id: string, confidence: number, f: Partial<ImageRecommendation> = {}): ImageRecommendation => ({
    id, url: null, label: id, alt: id, confidence, band: confidence >= 80 ? "high" : confidence >= 55 ? "medium" : "low",
    reasons: [], chips: [], remembered: false, onRecord: false, attached: false, draft: false, rightsPending: false, ...f,
  });
  const view: ImageRecommendView = {
    items: [R("n1", 80), R("n2", 80), R("rec", 90, { onRecord: true }), R("mem", 97, { remembered: true }), R("att", 99, { attached: true }), R("logo", 82)],
    considered: 40,
    matched: 6,
    emptyText: null,
  };
  const assets = [A("n1", { pack_size: "7g" }), A("n2", { pack_size: "3.5g", role: "product" }), A("logo", { role: "logo" })];
  const panel = orderRecommendPanel(view, assets, "Blue Dream 3.5g");
  eq("order: memory, record, pack+photo, logo, other pack, attached last", panel.tiles.map((t) => t.id), ["mem", "rec", "n2", "logo", "n1", "att"]);
  eq("confidence unchanged", panel.tiles.find((t) => t.id === "n2")!.confidence, 80);
  eq("pack flag", panel.tiles.find((t) => t.id === "n1")!.pack, "other");
  ok("product photo flag", panel.tiles.find((t) => t.id === "n2")!.productPhoto);
  eq("limit", orderRecommendPanel(view, assets, "x", 2).tiles.length, 2);
  eq("bad limit -> default", orderRecommendPanel(view, assets, "x", 0).tiles.length, 6);
  eq("counts pass through", [panel.considered, panel.matched], [40, 6]);
  eq("empty passes text", orderRecommendPanel({ items: [], considered: 3, matched: 0, emptyText: "none" }, [], "x").emptyText, "none");
  eq("stable on ties", orderRecommendPanel({ ...view, items: [R("b", 50), R("a", 50)] }, [], "x").tiles.map((t) => t.id), ["b", "a"]);

  // D244 R-22: text-removed photos rank second, behind exact matches
  const TR = ["text-removed", "flux-fill"];
  const prod = { vendorId: "v1", brandId: null };
  ok("text-removed tag seen", isTextRemovedPhoto(A("x", { tags: ["Text-Removed"] })) && !isTextRemovedPhoto(A("y", { tags: ["flux"] })) && !isTextRemovedPhoto(null));
  ok("generic: published same vendor", genericTierFits(A("g", { tags: TR, vendor_id: "v1" }), 0, prod));
  ok("generic: draft waits for Publish", !genericTierFits(A("g", { tags: TR, vendor_id: "v1", status: "draft" }), 90, prod));
  ok("generic: other vendor never", !genericTierFits(A("g", { tags: TR, vendor_id: "v2" }), 70, prod));
  ok("generic: unknown vendor needs a match", genericTierFits(A("g", { tags: TR }), 40, prod) && !genericTierFits(A("g", { tags: TR }), 10, prod));
  ok("generic: plain photo no", !genericTierFits(A("g", { vendor_id: "v1" }), 70, prod));
  const gView: ImageRecommendView = {
    items: [R("low", 40), R("tr", 20), R("hi", 84), R("rec", 90, { onRecord: true }), R("mem", 60, { remembered: true }), R("trd", 70), R("mid", 74)],
    considered: 9,
    matched: 7,
    emptyText: null,
  };
  const gAssets = [A("tr", { tags: TR, vendor_id: "v1" }), A("trd", { tags: TR, vendor_id: "v1", status: "draft" })];
  const gp = orderRecommendPanel(gView, gAssets, "x", 12, prod);
  eq("order: memory, record, exact, text-removed, rest", gp.tiles.map((t) => t.id), ["mem", "rec", "hi", "tr", "mid", "trd", "low"]);
  ok("text-removed chip first, confidence kept", gp.tiles[3]!.chips[0] === TEXT_REMOVED_CHIP && gp.tiles[3]!.confidence === 20 && gp.tiles[3]!.textRemoved);
  ok("draft text-removed: flagged, no chip", gp.tiles.find((t) => t.id === "trd")!.textRemoved && !gp.tiles.find((t) => t.id === "trd")!.chips.includes(TEXT_REMOVED_CHIP));
  eq("no product: no generic tier", orderRecommendPanel(gView, gAssets, "x", 12).tiles.map((t) => t.id).indexOf("tr"), 6);
  // recommendExtras
  const pool = [A("in", { vendor_id: "v1" }), A("tr2", { tags: TR, vendor_id: "v1" }), A("plain", { vendor_id: "v1" }), A("far", { vendor_id: "v2" }), A("trd2", { tags: TR, vendor_id: "v1", status: "draft" }), A("pdf", { vendor_id: "v1", mime_type: "application/pdf" })];
  const inView = { items: [R("in", 50)] };
  eq("extras: published text-removed only", recommendExtras(pool, inView, prod, false).map((a) => a.id), ["tr2"]);
  eq("extras: whole vendor (Copilot)", recommendExtras(pool, inView, prod, true).map((a) => a.id), ["tr2", "plain", "trd2"]);
  eq("extras: no vendor -> none", recommendExtras(pool, inView, {}, true).length, 0);
  ok("copilot limit beyond the shelf read", COPILOT_PANEL_LIMIT >= 3000);

  // parseCoverIntent
  ok("cover 1", parseCoverIntent("1"));
  ok("cover absent", !parseCoverIntent(null));
  ok("cover junk", !parseCoverIntent("yes please"));

  // recommendPanelSummary
  ok("summary counts", recommendPanelSummary(panel, false).startsWith("Compared 40 pictures; 6 look like this product. Showing the best 5."));
  ok("summary empty library", recommendPanelSummary({ tiles: [], considered: 0, matched: 0 }, false) === "No pictures in the library to compare yet.");
  ok("summary memory missing said", recommendPanelSummary(panel, true).includes("0279"));
  ok("summary singular", recommendPanelSummary({ tiles: [], considered: 1, matched: 1 }, false) === "Compared 1 picture; 1 looks like this product.");

  return { passed, failed };
}
