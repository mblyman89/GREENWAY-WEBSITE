/**
 * src/lib/media/taxonomy.ts
 *
 * Slice 6 — "smart metadata" model for the Media Library. Gives non-technical
 * staff a consistent, guard-railed way to describe every asset:
 *
 *   • WHAT  — title + description (free text, but length-checked)
 *   • WHY   — purpose: a CANONICAL category (logo, hero, banner, product, …)
 *             stored in media_assets.usage_type. No more free-typed values that
 *             fragment the library.
 *   • WHERE — placement: human-friendly tags (e.g. "home-hero", "menu-banner")
 *             stored in media_assets.tags, plus the real "Where used" links from
 *             media_usages.
 *
 * Everything here is pure data + validators — no DB, no migration. The existing
 * columns (title, description, usage_type, tags, alt_text, width, height) carry
 * all of it.
 */

/** Canonical purpose categories (the "why"). id is what we store in usage_type. */
export type MediaPurpose = {
  id: string;
  label: string;
  hint: string;
};

export const MEDIA_PURPOSES: MediaPurpose[] = [
  { id: "logo", label: "Logo", hint: "Greenway or partner logos / wordmarks." },
  { id: "hero", label: "Hero / Carousel", hint: "Large top-of-page rotating images." },
  { id: "banner", label: "Section banner", hint: "Wide banner inside a page section." },
  { id: "product", label: "Product image", hint: "A specific product photo." },
  { id: "brand-logo", label: "Brand logo", hint: "A product brand's logo." },
  { id: "vendor-logo", label: "Vendor logo", hint: "A delivery/vendor partner logo." },
  { id: "blog", label: "Blog cover", hint: "Cover image for a blog post." },
  { id: "newsletter", label: "Newsletter", hint: "Newsletter PDF or its cover." },
  { id: "icon", label: "Icon / badge", hint: "Small UI icon, badge, or seal." },
  { id: "background", label: "Background", hint: "Decorative background texture." },
  { id: "document", label: "Document", hint: "A PDF or downloadable file." },
  { id: "other", label: "Other", hint: "Anything that doesn't fit above." },
];

const PURPOSE_IDS = new Set(MEDIA_PURPOSES.map((p) => p.id));

export function purposeLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return MEDIA_PURPOSES.find((p) => p.id === id)?.label ?? id;
}

export function isValidPurpose(id: string | null | undefined): boolean {
  return Boolean(id) && PURPOSE_IDS.has(id as string);
}

/**
 * Suggested placement tags (the "where"). These are just convenient presets —
 * staff can still add their own — but offering a canonical list keeps the
 * library searchable. Stored in media_assets.tags.
 */
export const PLACEMENT_SUGGESTIONS: string[] = [
  "home-hero",
  "home-section",
  "menu-banner",
  "loyalty-banner",
  "specials-banner",
  "vendors-banner",
  "faq-banner",
  "about-banner",
  "locations-banner",
  "price-match-banner",
  "header",
  "footer",
  "blog",
  "newsletter",
];

/** Normalise a placement/tag to the kebab-case convention we store. */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function normalizeTags(raw: string[] | string): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(",");
  const out: string[] = [];
  for (const t of arr) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 12); // sane ceiling
}

// ---------------------------------------------------------------------------
// Guardrails — format / convention checks. These produce WARNINGS (advisory),
// never hard blocks, so staff are never stuck. The upload action still hard-
// blocks on unsupported MIME and >10MB; these add gentle "best practice" nudges.
// ---------------------------------------------------------------------------

export type MediaWarning = { field: "title" | "description" | "alt_text" | "purpose" | "filename" | "tags"; text: string };

export type MediaMetaForCheck = {
  filename?: string | null;
  title?: string | null;
  description?: string | null;
  alt_text?: string | null;
  usage_type?: string | null;
  tags?: string[] | null;
  mime_type?: string | null;
};

/** Recommended raster formats for site imagery (WEBP preferred). */
const PREFERRED_IMAGE_MIME = new Set(["image/webp"]);
const ACCEPTABLE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/svg+xml"]);

export function checkMediaMeta(meta: MediaMetaForCheck): MediaWarning[] {
  const warnings: MediaWarning[] = [];
  const mime = (meta.mime_type ?? "").toLowerCase();
  const isImage = mime.startsWith("image/");

  // WHAT — title
  const title = (meta.title ?? "").trim();
  if (!title) {
    warnings.push({ field: "title", text: "Add a short, descriptive title so staff can find this later." });
  } else if (/\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(title)) {
    warnings.push({ field: "title", text: "Title looks like a filename — use plain words (e.g. “Spring Sale Hero”)." });
  } else if (title.length > 80) {
    warnings.push({ field: "title", text: "Title is long — keep it under ~80 characters." });
  }

  // WHAT — description (optional, but nudge for non-icons)
  const desc = (meta.description ?? "").trim();
  if (desc && desc.length > 300) {
    warnings.push({ field: "description", text: "Description is long — a sentence or two is plenty." });
  }

  // WHY — purpose
  if (!isValidPurpose(meta.usage_type ?? null)) {
    warnings.push({ field: "purpose", text: "Pick a purpose so this asset is categorised correctly." });
  }

  // Accessibility — alt text for images
  if (isImage && !(meta.alt_text ?? "").trim()) {
    warnings.push({ field: "alt_text", text: "Images should have alt text for accessibility & SEO (use ✨ Suggest)." });
  }

  // Format convention — prefer WEBP for raster site imagery
  if (isImage && !PREFERRED_IMAGE_MIME.has(mime) && ACCEPTABLE_IMAGE_MIME.has(mime) && mime !== "image/svg+xml") {
    warnings.push({ field: "filename", text: "Tip: WEBP loads faster than PNG/JPG for web imagery." });
  }

  // WHERE — tags convention
  const tags = meta.tags ?? [];
  const badTag = tags.find((t) => t !== normalizeTag(t));
  if (badTag) {
    warnings.push({ field: "tags", text: `Tag “${badTag}” isn't in our naming convention — it'll be tidied to “${normalizeTag(badTag)}”.` });
  }

  return warnings;
}
