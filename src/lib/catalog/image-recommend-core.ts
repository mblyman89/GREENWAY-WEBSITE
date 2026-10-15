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
  return new Set(idTokens(`${a.title ?? ""} ${a.filename ?? ""} ${a.alt_text ?? ""} ${(a.tags ?? []).join(" ")}`));
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
  if (brandTokens.length > 0 && brandHit.length === 0 && confidence > NO_BRAND_CAP) {
    confidence = NO_BRAND_CAP;
    reasons.push("No brand word in the image text, so it stays below High.");
  }
  return { confidence, reasons };
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
  return { passed, failed };
}
