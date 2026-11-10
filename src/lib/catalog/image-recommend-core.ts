/**
 * src/lib/catalog/image-recommend-core.ts — R51 (items 3, 4, 5).
 *
 * Owner, verbatim (R51 bible section 0): "I want the image assignment to
 * happen on onboarding, which means the kb needs to remember past attachments
 * to products. It needs to be able to recommend ones from the content media
 * page, both unpublished and published images, with a confidence level."
 *
 * The pure decision layer for the onboarding row's "Product images" panel:
 * which Content -> Media assets to recommend for ONE onboarding draft, in
 * what order, and with what confidence. No I/O; inputs are never mutated.
 *
 * Ladder (R51 bible D4), highest first:
 *   1. remembered - a person attached this asset to a product with the SAME
 *      identity key on onboarding before (product_image_memory, 0279). Shown
 *      at REMEMBERED_IMAGE_CONFIDENCE, the same 97 R32 gives a remembered
 *      onboarding pick (onboarding-recall-core REMEMBERED_PICK_CONFIDENCE).
 *   2. on record - the asset is already in the gallery of an enrichment or
 *      KB product that shares this identity key (the image was approved for
 *      this product before the memory table existed). ON_RECORD_CONFIDENCE.
 *   3. name match - the share of the product's own name words found in the
 *      asset's title / filename / alt text / tags (the Akeneo "product link
 *      rule" signal, bible R8), plus a brand bonus and a small category bonus.
 *      Without a brand word in the asset the score is capped below "High":
 *      a name alone can be shared by two brands' products.
 *
 * Drafts AND published assets are both recommended (owner: "both unpublished
 * and published"); archived and non-image assets never are (isPickableImage).
 * Nothing here attaches anything: a person clicks Attach (AGENTS.md
 * drafts-only rule).
 */
import { isPickableImage, type LibraryPickerAsset } from "@/lib/media/library-picker-core";
import { tokenize } from "@/lib/media/product-link-core";
import { productSourceOf } from "@/lib/media/folders-core";

/**
 * R65: provenance boost. A name-matched photo that came straight from the
 * vendor (their menu feed or their own website) is a more trustworthy pick
 * than a random web find, so it ranks a little higher — with the reason shown.
 * Never lifts a non-match (needs a name hit) and never passes NAME_MATCH_MAX.
 */
export const VENDOR_SOURCE_BOOST = 4;
export function provenanceBoost(tags: readonly string[] | null | undefined): { boost: number; reason: string | null } {
  const src = productSourceOf({ id: "", storage_key: "", filename: null, mime_type: null, size_bytes: null, alt_text: null, title: null, source: "x", usage_type: "product", tags: [...(tags ?? [])], status: null });
  const t = new Set((tags ?? []).map((x) => x.toLowerCase()));
  if (src === "menu") {
    const p = t.has("cultivera") ? "Cultivera" : t.has("growflow") ? "GrowFlow" : "LeafLink";
    return { boost: VENDOR_SOURCE_BOOST, reason: `Came straight from the vendor's ${p} menu.` };
  }
  if (src === "vendor-site") return { boost: VENDOR_SOURCE_BOOST, reason: "Came from the vendor's own website." };
  return { boost: 0, reason: null };
}

/** Same value as onboarding-recall-core REMEMBERED_PICK_CONFIDENCE (R32). */
export const REMEMBERED_IMAGE_CONFIDENCE = 97;
/** In an approved gallery of this identity, but not (yet) in the memory table. */
export const ON_RECORD_CONFIDENCE = 90;
/** Ceiling for a pure name match (never outranks a person's past decision). */
export const NAME_MATCH_MAX = 88;
/** Ceiling for a name match whose asset text names no brand/vendor word. */
export const NO_BRAND_CAP = 74;
/** Below this a recommendation is noise and is not shown. */
export const MIN_RECOMMEND_CONFIDENCE = 35;
/** Tiles shown per row. */
export const MAX_RECOMMENDATIONS = 8;

export type ImageConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(confidence: number): ImageConfidenceBand {
  if (confidence >= 80) return "high";
  if (confidence >= 55) return "medium";
  return "low";
}

export const BAND_LABEL: Record<ImageConfidenceBand, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** One product_image_memory row (named columns the server reads). */
export type ImageMemoryRow = {
  media_asset_id: string;
  times_confirmed: number | null;
  last_confirmed_at: string | null;
  source: string | null;
};

export type ImageRecommendInput = {
  assets: readonly LibraryPickerAsset[];
  product: {
    name: string | null | undefined;
    brand?: string | null;
    vendor?: string | null;
    /** Website category word (e.g. "flower", "edibles"). */
    category?: string | null;
    /** D221: the vendor / brand cards, for the same-vendor boost. */
    vendorId?: string | null;
    brandId?: string | null;
  };
  /** Memory rows for THIS identity key. */
  memory?: readonly ImageMemoryRow[];
  /** Asset ids in galleries of enrichments / KB products sharing the identity key. */
  onRecordIds?: readonly string[];
  /** Asset ids already in the gallery this draft attaches to. */
  galleryIds?: readonly string[];
  limit?: number;
};

export type ImageRecommendation = {
  id: string;
  url: string | null;
  label: string;
  alt: string;
  /** 0..100 */
  confidence: number;
  band: ImageConfidenceBand;
  /** Plain-English why, for the tooltip/caption. */
  reasons: string[];
  /** D221 M6: short "why" chips under the tile ("Same vendor", "Label reads 'blue dream'", "3.5g"). */
  chips: string[];
  remembered: boolean;
  onRecord: boolean;
  /** Already in this product's gallery (shown, but no Attach button). */
  attached: boolean;
  /** media_assets.status = draft (unpublished). */
  draft: boolean;
  /** license_status = pending-review. */
  rightsPending: boolean;
};

export type ImageRecommendView = {
  items: ImageRecommendation[];
  /** Pickable images considered. */
  considered: number;
  /** Recommendations above the floor (before the cap). */
  matched: number;
  /** Honest line when nothing is recommended; null otherwise. */
  emptyText: string | null;
};

export const NO_LIBRARY_COPY =
  "Your media library has no images yet. Import one from the web below, or upload on Content \u2192 Media.";
export const NO_MATCH_COPY =
  "No library image looks like this product yet. Import one from the web below, or pick from the full library.";

/**
 * Words that carry identity. Size/count tokens ("3.5g" -> "5g", "100mg",
 * "10pk") are dropped: the identity key carries no size (0234), and one photo
 * serves every size of a product.
 */
function idTokens(s: string | null | undefined): string[] {
  return tokenize(s).filter((t) => !/^\d+[a-z]{0,3}$/.test(t));
}

function assetWords(a: LibraryPickerAsset): Set<string> {
  // D221 M1: the product the picture came with on the vendor's menu and the
  // words printed on the package count as much as the title.
  return new Set(
    idTokens(
      `${a.title ?? ""} ${a.filename ?? ""} ${a.alt_text ?? ""} ${(a.tags ?? []).join(" ")} ${a.product_name ?? ""} ${a.visible_text ?? ""} ${a.ai_caption ?? ""}`,
    ),
  );
}

/**
 * D221 M1: the picture is on file under this product's own vendor / brand
 * card (0352 provenance). Owner: suggestions were "not even the same vendor".
 * A same-vendor image is lifted and may pass the no-brand cap (we KNOW whose
 * picture it is); an image filed under a DIFFERENT vendor is held below High.
 */
export const SAME_VENDOR_BOOST = 8;
export const OTHER_VENDOR_CAP = 60;
export function vendorMatch(
  a: Pick<LibraryPickerAsset, "vendor_id" | "brand_id">,
  product: { vendorId?: string | null; brandId?: string | null },
): "same" | "other" | "unknown" {
  const av = (a.vendor_id ?? "").trim();
  const ab = (a.brand_id ?? "").trim();
  const pv = (product.vendorId ?? "").trim();
  const pb = (product.brandId ?? "").trim();
  if ((av && pv && av === pv) || (ab && pb && ab === pb)) return "same";
  if (av && pv && av !== pv && !(ab && pb && ab === pb)) return "other";
  return "unknown";
}

/**
 * Score one asset by name. Exported for the self-test and the panel's
 * tooltip; returns 0..NAME_MATCH_MAX and the reasons.
 */
export function nameMatchScore(
  a: LibraryPickerAsset,
  product: ImageRecommendInput["product"],
): { confidence: number; reasons: string[] } {
  const words = assetWords(a);
  const brandTokens = [...new Set(idTokens(`${product.brand ?? ""} ${product.vendor ?? ""}`))];
  const brandSet = new Set(brandTokens);
  // The product's OWN words: the name without the brand/vendor words, so a
  // brand photo that merely names the brand is not a "name match".
  let nameTokens = [...new Set(idTokens(product.name))].filter((t) => !brandSet.has(t));
  if (nameTokens.length === 0) nameTokens = [...new Set(idTokens(product.name))];
  const reasons: string[] = [];
  if (nameTokens.length === 0 || words.size === 0) return { confidence: 0, reasons: ["Not enough text to compare."] };

  const hits = nameTokens.filter((t) => words.has(t));
  if (hits.length === 0) return { confidence: 0, reasons: ["No product-name words in this image's title, filename, alt text or tags."] };
  let score = hits.length / nameTokens.length;
  reasons.push(`Product name: ${hits.join(", ")} (${hits.length}/${nameTokens.length} words).`);

  const brandHit = brandTokens.filter((t) => words.has(t));
  if (brandHit.length > 0) {
    score += 0.2;
    reasons.push(`Brand/vendor: ${brandHit.join(", ")}.`);
  }
  const cat = idTokens(product.category ?? "");
  if (cat.length > 0 && cat.some((t) => words.has(t))) {
    score += 0.05;
    reasons.push("Category word matches.");
  }
  let confidence = Math.round(Math.min(1, score) * 100);
  confidence = Math.min(confidence, NAME_MATCH_MAX);
  const vm = vendorMatch(a, product);
  if (vm === "same") {
    confidence = Math.min(NAME_MATCH_MAX, confidence + SAME_VENDOR_BOOST);
    reasons.push("Filed under this product's own vendor.");
  } else if (vm === "other" && confidence > OTHER_VENDOR_CAP) {
    confidence = OTHER_VENDOR_CAP;
    reasons.push("Filed under a different vendor, so it stays below High.");
  }
  if (vm !== "same" && brandTokens.length > 0 && brandHit.length === 0 && confidence > NO_BRAND_CAP) {
    confidence = NO_BRAND_CAP;
    reasons.push("No brand word in the image text, so it stays below High.");
  }
  return { confidence, reasons };
}

/**
 * D221 M6 (recommender v2). A logo or banner is not a product photo: when
 * the picture is classified as one (0352 role) a name match drops by
 * ROLE_PENALTY, so a real product photo of the same product wins. A person's
 * past pick (remembered / on record) is never penalised.
 */
export const ROLE_PENALTY = 25;
export const NOT_PRODUCT_ROLES = new Set(["logo", "banner", "menu", "coa", "marketing"]);

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(mg|g|ml|oz|pk|ct|pack)\b/gi;

/** Pack sizes named in a text ("3.5g", "1 g", "100mg", "10pk"), normalised ("3.5g"). */
export function packSizes(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(SIZE_RE)) {
    const unit = m[2]!.toLowerCase() === "pack" ? "pk" : m[2]!.toLowerCase();
    out.add(`${Number(m[1])}${unit}`);
  }
  return [...out];
}

/** The short why-chips for one recommendation. PURE. */
export function recommendChips(
  a: LibraryPickerAsset,
  product: ImageRecommendInput["product"],
  flags: { remembered: boolean; onRecord: boolean },
): string[] {
  const chips: string[] = [];
  if (flags.remembered) chips.push("You picked this before");
  else if (flags.onRecord) chips.push("On this product's card");
  const vm = vendorMatch(a, product);
  if (vm === "same") chips.push("Same vendor");
  else if (vm === "other") chips.push("Other vendor");
  const label = idTokens(a.visible_text ?? "");
  if (label.length) {
    const brandSet = new Set(idTokens(`${product.brand ?? ""} ${product.vendor ?? ""}`));
    const own = [...new Set(idTokens(product.name))].filter((t) => !brandSet.has(t));
    const hits = own.filter((t) => label.includes(t)).slice(0, 3);
    if (hits.length) chips.push(`Label reads '${hits.join(" ")}'`);
  }
  const want = packSizes(product.name);
  if (want.length) {
    const have = new Set([...packSizes(a.pack_size ?? ""), ...packSizes(a.visible_text ?? ""), ...packSizes(a.title ?? "")]);
    const same = want.filter((w) => have.has(w));
    if (same.length) chips.push(`Pack ${same[0]}`);
    else if (have.size) chips.push(`Pack ${[...have][0]} (product ${want[0]})`);
  }
  const role = (a.role ?? "").toLowerCase();
  if (role && NOT_PRODUCT_ROLES.has(role)) chips.push(role === "logo" ? "Logo, not a product photo" : `A ${role}, not a product photo`);
  else if (role === "product" || role === "packaging" || role === "flower") chips.push("Product photo");
  if (a.status === "draft") chips.push("Draft");
  return chips;
}

/** Plain words for the 0354 media_similar reasons ("same-vendor" → "Same vendor"). */
export const SIMILAR_REASON_LABEL: Record<string, string> = {
  "same-file": "Same file",
  "same-vendor": "Same vendor",
  "same-brand": "Same brand",
  "similar-name": "Similar name",
  "same-strain": "Same strain",
  "similar-label": "Similar label text",
  "same-category": "Same category",
};
export function similarReasonLabel(reason: string): string {
  return SIMILAR_REASON_LABEL[reason] ?? reason;
}

export function recommendImages(input: ImageRecommendInput): ImageRecommendView {
  const limit = typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0 ? input.limit : MAX_RECOMMENDATIONS;
  const gallery = new Set((input.galleryIds ?? []).map((g) => String(g).trim()));
  const onRecord = new Set((input.onRecordIds ?? []).map((g) => String(g).trim()));
  const memory = new Map<string, ImageMemoryRow>();
  for (const m of input.memory ?? []) {
    const id = String(m?.media_asset_id ?? "").trim();
    if (id) memory.set(id, m);
  }

  const seen = new Set<string>();
  const out: (ImageRecommendation & { _t: string })[] = [];
  let considered = 0;
  for (const a of input.assets ?? []) {
    if (!isPickableImage(a)) continue;
    const id = a.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    considered += 1;

    const name = nameMatchScore(a, input.product);
    if (name.confidence > 0) {
      const prov = provenanceBoost(a.tags);
      if (prov.boost > 0) {
        name.confidence = Math.min(NAME_MATCH_MAX, name.confidence + prov.boost);
        name.reasons.push(prov.reason!);
      }
    }
    // D221 M6: a logo / banner is not a product photo.
    const role = (a.role ?? "").toLowerCase();
    if (name.confidence > 0 && NOT_PRODUCT_ROLES.has(role)) {
      name.confidence = Math.max(0, name.confidence - ROLE_PENALTY);
      name.reasons.push(`Classified as a ${role}, not a product photo, so it ranks lower.`);
    }
    const reasons: string[] = [];
    let confidence = name.confidence;
    const mem = memory.get(id);
    const remembered = Boolean(mem);
    const isOnRecord = onRecord.has(id);
    if (remembered) {
      confidence = REMEMBERED_IMAGE_CONFIDENCE;
      const n = Math.max(1, Number(mem!.times_confirmed ?? 1));
      reasons.push(`You attached this to this product before (${n} time${n === 1 ? "" : "s"}).`);
    } else if (isOnRecord) {
      confidence = Math.max(confidence, ON_RECORD_CONFIDENCE);
      reasons.push("Already approved on this product's card.");
    }
    reasons.push(...(confidence === name.confidence || name.confidence > 0 ? name.reasons : []));
    const attached = gallery.has(id);
    if (!attached && confidence < MIN_RECOMMEND_CONFIDENCE) continue;

    const title = (a.title ?? "").trim();
    const filename = (a.filename ?? "").trim();
    const label = title || filename || "(untitled image)";
    out.push({
      id,
      url: a.url ?? null,
      label,
      alt: (a.alt_text ?? "").trim() || label,
      confidence,
      band: confidenceBand(confidence),
      reasons: reasons.filter((r, i) => r && reasons.indexOf(r) === i),
      chips: recommendChips(a, input.product, { remembered, onRecord: isOnRecord }),
      remembered,
      onRecord: isOnRecord,
      attached,
      draft: a.status === "draft",
      rightsPending: a.license_status === "pending-review",
      _t: mem?.last_confirmed_at ?? a.created_at ?? "",
    });
  }

  out.sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence;
    if (x._t !== y._t) return x._t < y._t ? 1 : -1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  const items = out.slice(0, limit).map(({ _t: _drop, ...r }) => {
    void _drop;
    return r;
  });
  return {
    items,
    considered,
    matched: out.length,
    emptyText: items.length > 0 ? null : considered === 0 ? NO_LIBRARY_COPY : NO_MATCH_COPY,
  };
}

/**
 * D221 M6: "Search for a better picture" / "Find similar". The pool is
 * already what the person asked for (a media_search hit list or the
 * media_similar list), so nothing is dropped below the floor: every pickable
 * image is shown, in the pool's own order, with the same confidence, badges
 * and why-chips as a recommendation. PURE.
 */
export const SEARCH_RESULTS_MAX = 24;
export function rankSearchResults(
  assets: readonly LibraryPickerAsset[],
  product: ImageRecommendInput["product"],
  opts: { galleryIds?: readonly string[]; limit?: number; extraChips?: ReadonlyMap<string, string[]> } = {},
): ImageRecommendation[] {
  const gallery = new Set((opts.galleryIds ?? []).map((g) => String(g).trim()));
  const limit = opts.limit && opts.limit > 0 ? opts.limit : SEARCH_RESULTS_MAX;
  const seen = new Set<string>();
  const out: ImageRecommendation[] = [];
  for (const a of assets) {
    if (!isPickableImage(a)) continue;
    const id = a.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const name = nameMatchScore(a, product);
    const role = (a.role ?? "").toLowerCase();
    let confidence = name.confidence;
    if (confidence > 0 && NOT_PRODUCT_ROLES.has(role)) confidence = Math.max(0, confidence - ROLE_PENALTY);
    const label = (a.title ?? "").trim() || (a.filename ?? "").trim() || "(untitled image)";
    const chips = [...(opts.extraChips?.get(id) ?? []), ...recommendChips(a, product, { remembered: false, onRecord: false })];
    out.push({
      id,
      url: a.url ?? null,
      label,
      alt: (a.alt_text ?? "").trim() || label,
      confidence,
      band: confidenceBand(confidence),
      reasons: name.reasons,
      chips: chips.filter((c, i) => chips.indexOf(c) === i),
      remembered: false,
      onRecord: false,
      attached: gallery.has(id),
      draft: a.status === "draft",
      rightsPending: a.license_status === "pending-review",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** The "search for a better picture" scope chips. */
export type ImageSearchScope = "vendor" | "brand" | "all";
export function parseImageSearchScope(raw: unknown): ImageSearchScope {
  return raw === "brand" || raw === "all" ? raw : "vendor";
}

/** "97% · High" */
export function confidenceText(r: Pick<ImageRecommendation, "confidence" | "band">): string {
  return `${r.confidence}% \u00b7 ${BAND_LABEL[r.band]}`;
}

/** Memory `source` values the 0279 check constraint allows. */
export type ImageMemorySource = "library" | "import" | "memory";
export function parseImageMemorySource(raw: unknown): ImageMemorySource {
  return raw === "import" || raw === "memory" ? raw : "library";
}

/** True when a Supabase error means 0279 is not applied yet (read degrades). */
export function isImageMemoryTableMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  const msg = String(err.message ?? "");
  return (code === "PGRST205" || code === "42P01") && /product_image_memory/.test(msg);
}

// ---------------------------------------------------------------------------
// Self-test (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

/** The Attach / Import result banner (?img=&img_msg= from image-actions). */
export function imageResultBanner(code: unknown, msg: unknown): { tone: "ok" | "info" | "error"; text: string } | null {
  if (code !== "attached" && code !== "already" && code !== "error") return null;
  const m = typeof msg === "string" ? msg.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (code === "attached") return { tone: "ok", text: m || "Photo attached to this product." };
  if (code === "already") return { tone: "info", text: m || "That photo was already on this product." };
  return { tone: "error", text: m || "That photo could not be attached just now. Try again." };
}

export function __runImageRecommendCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL image-recommend-core:", m);
    }
  };
  const A = (id: string, over: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
    id,
    filename: `${id}.jpg`,
    title: null,
    alt_text: null,
    tags: null,
    usage_type: "product",
    status: "published",
    mime_type: "image/jpeg",
    license_status: null,
    created_at: "2026-10-01T00:00:00Z",
    url: `https://cdn.example/${id}.jpg`,
    ...over,
  });
  const product = { name: "Blue Dream 3.5g", brand: "Phat Panda", vendor: null, category: "flower" };
  const assets = [
    A("exact", { title: "Phat Panda Blue Dream", status: "draft", license_status: "pending-review" }),
    A("nobrand", { title: "Blue Dream nug" }),
    A("brandonly", { title: "Phat Panda logo" }),
    A("other", { title: "Gelato 41" }),
    A("arch", { title: "Phat Panda Blue Dream", status: "archived" }),
    A("vid", { title: "Blue Dream", mime_type: "video/mp4" }),
    A("mem", { title: "IMG_2231" }),
    A("rec", { title: "IMG_9" }),
  ];
  const v = recommendImages({
    assets,
    product,
    memory: [{ media_asset_id: "mem", times_confirmed: 3, last_confirmed_at: "2026-10-10T00:00:00Z", source: "library" }],
    onRecordIds: ["rec"],
    galleryIds: ["nobrand"],
  });
  const ids = v.items.map((i) => i.id);
  ok(ids[0] === "mem" && v.items[0]!.confidence === 97 && v.items[0]!.remembered, "memory ranks first at 97");
  ok(ids[1] === "rec" && v.items[1]!.confidence === 90, "on-record second at 90");
  const exact = v.items.find((i) => i.id === "exact");
  ok(Boolean(exact) && exact!.confidence === 88 && exact!.band === "high", "name+brand match capped at 88, High");
  ok(Boolean(exact?.draft) && Boolean(exact?.rightsPending), "draft (unpublished) asset recommended with honest badges");
  const nb = v.items.find((i) => i.id === "nobrand");
  ok(Boolean(nb) && nb!.confidence === 74 && nb!.attached, "no brand word capped at 74; attached flagged");
  ok(!ids.includes("brandonly"), "brand-only photo is not a name match");
  ok(!ids.includes("other") && !ids.includes("arch") && !ids.includes("vid"), "unrelated, archived, non-image excluded");
  ok(v.considered === 6, "considered counts pickable images only");
  ok(REMEMBERED_IMAGE_CONFIDENCE === 97, "same constant as R32 remembered picks");
  ok(confidenceText({ confidence: 97, band: "high" }) === "97% \u00b7 High", "confidence text");
  ok(confidenceBand(80) === "high" && confidenceBand(55) === "medium" && confidenceBand(54) === "low", "bands");
  ok(recommendImages({ assets: [], product }).emptyText === NO_LIBRARY_COPY, "empty library copy");
  ok(recommendImages({ assets: [A("x", { title: "Gelato" })], product }).emptyText === NO_MATCH_COPY, "no match copy");
  ok(parseImageMemorySource("import") === "import" && parseImageMemorySource("x") === "library", "memory source parse");
  ok(isImageMemoryTableMissing({ code: "PGRST205", message: "Could not find the table 'public.product_image_memory'" }), "missing table detect");
  ok(!isImageMemoryTableMissing({ code: "23505", message: "product_image_memory dup" }), "other error is real");
  const lim = recommendImages({ assets: Array.from({ length: 20 }, (_, i) => A(`b${i}`, { title: "Phat Panda Blue Dream" })), product });
  ok(lim.items.length === MAX_RECOMMENDATIONS && lim.matched === 20, "cap + matched count");
  ok(imageResultBanner("attached", "")?.tone === "ok" && imageResultBanner("nope", "x") === null, "result banner codes");
  ok(provenanceBoost(["growflow", "product-image", "acme"]).boost === VENDOR_SOURCE_BOOST, "menu photo gets provenance boost");
  ok(provenanceBoost(["harvested", "product"]).reason === "Came from the vendor's own website.", "vendor-site reason");
  ok(provenanceBoost(["web-research", "harvested"]).boost === 0 && provenanceBoost(null).boost === 0, "no boost for web finds / untagged");
  // D221 M6: recommender v2 (role penalty, pack size, why-chips).
  const pv = { ...product, vendorId: "v1" };
  const r2 = recommendImages({
    assets: [
      A("photo", { title: "Phat Panda Blue Dream", role: "product", vendor_id: "v1", visible_text: "BLUE DREAM 3.5g", pack_size: "3.5 g" }),
      A("logo", { title: "Phat Panda Blue Dream", role: "logo", vendor_id: "v1" }),
    ],
    product: pv,
  });
  ok(r2.items[0]?.id === "photo", "product photo outranks the same-named logo");
  const lg = r2.items.find((i) => i.id === "logo");
  ok(!lg || lg.confidence <= r2.items[0]!.confidence - ROLE_PENALTY, "logo loses ROLE_PENALTY");
  const ch = r2.items[0]!.chips;
  ok(ch.includes("Same vendor"), "same-vendor chip");
  ok(ch.some((c) => c.startsWith("Label reads 'blue dream")), "label-read chip");
  ok(ch.includes("Pack 3.5g"), "pack-size chip");
  ok(ch.includes("Product photo"), "product-photo chip");
  ok(!lg || lg.chips.includes("Logo, not a product photo"), "logo chip");
  ok(packSizes("Blue Dream 3.5g + 1 G pre-roll 10 pack").join(",") === "3.5g,1g,10pk", "pack sizes parsed");
  const memLogo = recommendImages({ assets: [A("m", { title: "x", role: "logo" })], product, memory: [{ media_asset_id: "m", times_confirmed: 1, last_confirmed_at: null, source: "library" }] });
  ok(memLogo.items[0]?.confidence === 97 && memLogo.items[0]!.chips[0] === "You picked this before", "a person's pick is never penalised");
  const other = recommendChips(A("o", { vendor_id: "v2", pack_size: "1g" }), pv, { remembered: false, onRecord: false });
  ok(other.includes("Other vendor") && other.includes("Pack 1g (product 3.5g)"), "other-vendor + pack-mismatch chips");
  ok(similarReasonLabel("same-strain") === "Same strain" && similarReasonLabel("x") === "x", "similar reason labels");
  const sr = rankSearchResults([A("s1", { title: "Gelato" }), A("s2", { title: "Phat Panda Blue Dream" }), A("s1"), A("sv", { mime_type: "video/mp4" })], product, { galleryIds: ["s2"], extraChips: new Map([["s1", ["Same strain"]]]) });
  ok(sr.length === 2 && sr[0]!.id === "s1" && sr[0]!.confidence === 0, "search results keep the pool order, no floor, de-duplicated, pickable only");
  ok(sr[0]!.chips[0] === "Same strain" && sr[1]!.attached, "search results carry extra chips + attached flag");
  ok(parseImageSearchScope("brand") === "brand" && parseImageSearchScope("x") === "vendor", "search scope parse");
  return { passed, failed };
}
