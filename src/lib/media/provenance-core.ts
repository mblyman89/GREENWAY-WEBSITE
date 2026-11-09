/**
 * D221 M1+M2 - pure rules for media provenance, dedupe and auto-publish.
 *
 * Owner (D221): "the reason there are so many duplicates is because when I
 * scrape a vendor menu, it often uses the same image for all products on that
 * menu, so I save it for each item individually so the system knows to use it
 * for each one of them. if there is a smarter, better way to utilize the one
 * image for multiple products, then lets clean up all the duplicates".
 *
 * The smarter way: ONE media_assets row per file, and one media_usages row per
 * product that uses it. Migration 0352 folded the existing copies and made a
 * second live row for the same file impossible (unique content_hash). These
 * helpers are the app side of the same rules, kept pure so they are tested.
 *
 * Auto-publish (AGENTS.md rule 3, amended D221): a library asset is published
 * on save when it came from a vendor's own menu / website AND we know which
 * vendor. This only makes the picture available in the library; attaching it
 * to a live product is still a person's click.
 */

/** Sources that are the vendor's own material (their menu or website). */
export const VENDOR_SOURCE_PLATFORMS = ["cultivera", "growflow", "leaflink", "email", "website"] as const;
export type MediaPlatform =
  | (typeof VENDOR_SOURCE_PLATFORMS)[number]
  | "upload"
  | "ai"
  | "other";

export const AUTO_PUBLISH_REASON = "vendor-source-auto";

/** The 16-hex content hash embedded in a storage key (`<folder>/<hash16>-<name>`). */
export function contentHashFromStorageKey(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;
  const m = /\/([0-9a-f]{16})/.exec(storageKey);
  return m ? m[1] : null;
}

export type AutoPublishInput = {
  platform: string | null | undefined;
  vendorId: string | null | undefined;
  mimeType: string | null | undefined;
  status?: string | null;
  canonicalId?: string | null;
  reviewState?: string | null;
};

/** Same rule as public.media_auto_publish() in 0352. */
export function shouldAutoPublish(a: AutoPublishInput): boolean {
  if ((a.status ?? "draft") !== "draft") return false;
  if (a.canonicalId) return false;
  if ((a.reviewState ?? "ok") !== "ok") return false;
  if (!a.vendorId) return false;
  if (!a.platform || !(VENDOR_SOURCE_PLATFORMS as readonly string[]).includes(a.platform)) return false;
  const mime = a.mimeType ?? "";
  return mime.startsWith("image/") || mime === "application/pdf";
}

/** Where a harvested file came from, as the caller knows it. */
export type MediaProvenance = {
  platform?: MediaPlatform | null;
  vendorId?: string | null;
  brandId?: string | null;
  productName?: string | null;
  strainName?: string | null;
  category?: string | null;
  packSize?: string | null;
  menuItemRef?: string | null;
  sourceUrl?: string | null;
  sourcePageUrl?: string | null;
  role?: string | null;
  creditText?: string | null;
};

const PROVENANCE_COLUMNS: Record<keyof MediaProvenance, string> = {
  platform: "platform",
  vendorId: "vendor_id",
  brandId: "brand_id",
  productName: "product_name",
  strainName: "strain_name",
  category: "category",
  packSize: "pack_size",
  menuItemRef: "menu_item_ref",
  sourceUrl: "source_url",
  sourcePageUrl: "source_page_url",
  role: "role",
  creditText: "credit_text",
};

/**
 * The columns to write onto a row: only those that are empty on the row and
 * known from the caller. Gap-fill only - a value a person (or an earlier
 * save) already set is never overwritten. Returns {} when there is nothing to do.
 */
export function provenancePatch(
  existing: Record<string, unknown> | null | undefined,
  incoming: MediaProvenance | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!incoming) return out;
  for (const key of Object.keys(PROVENANCE_COLUMNS) as (keyof MediaProvenance)[]) {
    const v = incoming[key];
    if (typeof v !== "string") continue;
    const value = key === "category" ? v.trim().toLowerCase() : v.trim();
    if (!value) continue;
    const col = PROVENANCE_COLUMNS[key];
    const cur = existing?.[col];
    if (cur === null || cur === undefined || cur === "") out[col] = value.slice(0, 500);
  }
  return out;
}

type PgErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/** Postgres unique_violation - a second live row for the same file. */
export function isUniqueViolation(err: PgErrorLike): boolean {
  return !!err && (err.code === "23505" || /duplicate key value/i.test(err.message ?? ""));
}

/** The database does not have the 0352 columns yet (deploy before migrate). */
export function isMissingColumn(err: PgErrorLike): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(err.message ?? "");
}

type SearchableMedia = {
  title?: string | null;
  filename?: string | null;
  alt_text?: string | null;
  description?: string | null;
  source?: string | null;
  tags?: readonly string[] | null;
  product_name?: string | null;
  strain_name?: string | null;
  visible_text?: string | null;
  ai_caption?: string | null;
  ai_description?: string | null;
  ai_tags?: readonly string[] | null;
  seo_title?: string | null;
  seo_alt?: string | null;
  category?: string | null;
  pack_size?: string | null;
  credit_text?: string | null;
};

/**
 * D221 M1: the media page's search box. Every typed word must appear (AND) in
 * any of the asset's text - including what 0352 added (the product it came
 * with on the menu, the words on the package, the AI caption, the vendor
 * credit). Case-insensitive substring per word, so "gelat 3.5" finds
 * "Gelato Cake 3.5g".
 */
export function mediaMatchesQuery(m: SearchableMedia, query: string | null | undefined): boolean {
  const words = (query ?? "").toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    m.title,
    m.filename,
    m.alt_text,
    m.description,
    m.source,
    m.product_name,
    m.strain_name,
    m.visible_text,
    m.ai_caption,
    m.ai_description,
    m.seo_title,
    m.seo_alt,
    m.category,
    m.pack_size,
    m.credit_text,
    ...(m.tags ?? []),
    ...(m.ai_tags ?? []),
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" \u0001 ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}
