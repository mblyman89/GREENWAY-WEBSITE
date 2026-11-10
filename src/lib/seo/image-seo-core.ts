/**
 * D221 M8 - image SEO (pure).
 *
 *   - storageKeyFromPublicUrl: the media bucket key behind a public image URL,
 *     so the PDP can read that exact picture's seo_alt / seo_title /
 *     seo_description / credit_text.
 *   - pickImageAlt: seo_alt, then the library alt text, then the product name.
 *     Never empty, clamped to 160 characters.
 *   - imageObjectSchema: a schema.org ImageObject for the product's own photo
 *     (contentUrl, name, description, creditText). Only for the product's
 *     exact photo; a representative (fallback) picture gets no ImageObject.
 *   - sitemapImages: the image-sitemap list for one product page (exact
 *     photos only, absolute http(s) URLs, de-duplicated).
 *
 * Self-tests: __runImageSeoCoreTests (scripts/compliance/run-pure-selftests.ts).
 */

export type ImageSeoFields = {
  seo_alt?: string | null;
  alt_text?: string | null;
  seo_title?: string | null;
  title?: string | null;
  seo_description?: string | null;
  credit_text?: string | null;
};

export const IMAGE_ALT_MAX = 160;
const MEDIA_PUBLIC_MARKER = "/storage/v1/object/public/media/";

function clean(v: unknown, max: number): string {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

/** "https://x.supabase.co/storage/v1/object/public/media/a/b.jpg?v=1" -> "a/b.jpg" */
export function storageKeyFromPublicUrl(url: unknown): string | null {
  const s = String(url ?? "");
  const i = s.indexOf(MEDIA_PUBLIC_MARKER);
  if (i < 0) return null;
  let key = s.slice(i + MEDIA_PUBLIC_MARKER.length).split(/[?#]/)[0] ?? "";
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!key || key.includes("..") || key.length > 512) return null;
  return key;
}

export function pickImageAlt(fields: ImageSeoFields | null | undefined, productName: string): string {
  const alt = clean(fields?.seo_alt, IMAGE_ALT_MAX) || clean(fields?.alt_text, IMAGE_ALT_MAX);
  return alt || clean(productName, IMAGE_ALT_MAX) || "Product photo";
}

export type ImageObjectInput = {
  contentUrl: string;
  name: string;
  description?: string | null;
  creditText?: string | null;
};

/** Build the ImageObject input for productSchema from the exact photo's fields. */
export function imageObjectFor(url: string | null | undefined, fields: ImageSeoFields | null | undefined, productName: string): ImageObjectInput | null {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) return null;
  const name = clean(fields?.seo_title, 120) || clean(fields?.title, 120) || clean(productName, 120);
  if (!name) return null;
  const description = clean(fields?.seo_description, 300) || clean(fields?.seo_alt, 300) || null;
  const creditText = clean(fields?.credit_text, 120) || null;
  return { contentUrl: u, name, ...(description ? { description } : {}), ...(creditText ? { creditText } : {}) };
}

export function imageObjectSchema(input: ImageObjectInput, absolute: (path: string) => string) {
  return {
    "@type": "ImageObject",
    contentUrl: /^https?:\/\//i.test(input.contentUrl) ? input.contentUrl : absolute(input.contentUrl),
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.creditText ? { creditText: input.creditText } : {}),
  };
}

/** Image-sitemap URLs for one product page: exact photos only, http(s), unique. */
export function sitemapImages(images: readonly { url?: string | null; isFallback?: boolean | null }[]): string[] {
  const out: string[] = [];
  for (const img of images) {
    if (!img || img.isFallback) continue;
    const u = String(img.url ?? "").trim();
    if (!/^https?:\/\//i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export function __runImageSeoCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`image-seo-core: ${label}`);
    passed++;
  };
  const url = "https://abc.supabase.co/storage/v1/object/public/media/products/blue%20dream.jpg?v=2";
  ok(storageKeyFromPublicUrl(url) === "products/blue dream.jpg", "key from public url");
  ok(storageKeyFromPublicUrl("https://cdn.example.com/x.jpg") === null, "foreign url has no key");
  ok(storageKeyFromPublicUrl("https://a/storage/v1/object/public/media/../secret") === null, "no traversal");
  ok(storageKeyFromPublicUrl(null) === null, "null url");
  ok(pickImageAlt({ seo_alt: "  Blue Dream 3.5g jar  ", alt_text: "x" }, "Blue Dream") === "Blue Dream 3.5g jar", "seo_alt wins");
  ok(pickImageAlt({ seo_alt: "", alt_text: "Jar" }, "Blue Dream") === "Jar", "alt_text next");
  ok(pickImageAlt(null, "Blue Dream") === "Blue Dream", "product name last");
  ok(pickImageAlt(null, "") === "Product photo", "never empty");
  ok(pickImageAlt({ seo_alt: "a".repeat(400) }, "x").length === IMAGE_ALT_MAX, "alt clamped");
  const io = imageObjectFor("https://x/y.jpg", { seo_title: "Blue Dream jar", seo_description: "A jar", credit_text: "Acme Farms" }, "Blue Dream");
  ok(io?.name === "Blue Dream jar" && io?.description === "A jar" && io?.creditText === "Acme Farms", "image object fields");
  const bare = imageObjectFor("https://x/y.jpg", null, "Blue Dream");
  ok(bare?.name === "Blue Dream" && !("description" in (bare ?? {})) && !("creditText" in (bare ?? {})), "bare image object");
  ok(imageObjectFor("javascript:alert(1)", null, "x") === null, "bad url refused");
  ok(imageObjectFor(null, null, "x") === null, "no url");
  const s = imageObjectSchema({ contentUrl: "/a.jpg", name: "n" }, (p) => `https://site${p}`);
  ok(s["@type"] === "ImageObject" && s.contentUrl === "https://site/a.jpg", "schema absolutises");
  ok(
    JSON.stringify(sitemapImages([{ url: "https://a/1.jpg" }, { url: "https://a/1.jpg" }, { url: "https://a/2.jpg", isFallback: true }, { url: "/rel.jpg" }])) === '["https://a/1.jpg"]',
    "sitemap images exact + unique + absolute",
  );
  return { passed, failed: 0 };
}
