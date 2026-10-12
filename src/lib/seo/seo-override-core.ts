/**
 * R46-S2: SEO Editor -> public pages. PURE (no I/O).
 *
 * Until R46 the SEO Editor (/admin/content/seo) saved rows into seo_entries
 * that no public page ever read. This core decides, for one page, how a
 * saved entry overrides the code defaults, and which paths the sitemap must
 * leave out. Rules (Google Search Central guidance, read for this slice):
 *
 *  - Title: an empty/blank field keeps the default. A title that already
 *    names the brand is used AS-IS (title.absolute) so the layout template
 *    "%s | Greenway Marijuana" never doubles the brand
 *    ("Greenway Marijuana Port Orchard | Greenway Marijuana"). Otherwise the
 *    template appends the brand, exactly like the code defaults.
 *  - Description: blank keeps the default.
 *  - Canonical: only a same-site path ("/menu") or an absolute URL on the
 *    canonical origin is honoured. Anything else (another domain, a typo,
 *    "javascript:") is ignored and the page's own URL stays canonical: a bad
 *    canonical can de-index a page, so the safe failure is "do nothing".
 *  - No-index: "noindex, follow" (Google: links on a noindex page are still
 *    followed when allowed; nofollow is not needed to keep a page out).
 *  - Sitemap: a page is left out when it is noindex OR "Include in sitemap"
 *    is off (Google: only list canonical, indexable URLs).
 *  - Only status 'published' rows count.
 */

export const SEO_TITLE_MAX = 60;
export const SEO_DESC_MAX = 160;
export const BRAND = "Greenway Marijuana";
export const TITLE_TEMPLATE_SUFFIX = ` | ${BRAND}`;

export type SeoEntryLite = {
  path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical: string | null;
  noindex: boolean | null;
  sitemap_include: boolean | null;
  status: string | null;
  og_media_id?: string | null;
};

export type SeoOverride = {
  /** Set when the editor supplied a title. `absolute` = do not append the brand. */
  title?: { text: string; absolute: boolean };
  description?: string;
  /** Root-relative canonical path (or absolute same-origin URL). */
  canonical?: string;
  noindex: boolean;
  ogMediaId?: string;
};

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** "/menu/", "menu", "/Menu?x" -> "/menu". Null when not a usable site path. */
export function normalizeSeoPath(v: unknown): string | null {
  let s = clean(v);
  if (!s) return null;
  s = s.split(/[?#]/)[0];
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, "");
  if (!/^\/[a-z0-9\-._~/%]*$/i.test(s) || s.includes("//")) return null;
  return s.toLowerCase();
}

/** True when the title already contains the brand (so no template suffix). */
export function titleHasBrand(title: string): boolean {
  return /greenway/i.test(title);
}

/** What Google will show as the <title> for an entered title. */
export function finalTitle(entered: string | null | undefined, fallback?: string): string {
  const t = clean(entered);
  if (!t) return fallback ?? BRAND;
  return titleHasBrand(t) ? t : `${t}${TITLE_TEMPLATE_SUFFIX}`;
}

/**
 * A canonical the site will actually emit, or null to keep the default.
 * Accepts "/path" or "https://www.greenwaymarijuana.com/path".
 */
export function safeCanonical(v: unknown, origin: string): string | null {
  const s = clean(v);
  if (!s) return null;
  if (s.startsWith("/")) return normalizeSeoPath(s);
  try {
    const u = new URL(s);
    const o = new URL(origin);
    if (u.protocol !== "https:" || u.host !== o.host) return null;
    return normalizeSeoPath(u.pathname);
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turn one saved row into the overrides to apply (empty when unpublished). */
export function resolveSeoOverride(entry: SeoEntryLite | null | undefined, origin: string): SeoOverride {
  if (!entry || entry.status !== "published") return { noindex: false };
  const out: SeoOverride = { noindex: entry.noindex === true };
  const t = clean(entry.seo_title);
  if (t) out.title = { text: t, absolute: titleHasBrand(t) };
  const d = clean(entry.seo_description);
  if (d) out.description = d;
  const c = safeCanonical(entry.canonical, origin);
  if (c) out.canonical = c;
  if (entry.og_media_id && UUID.test(entry.og_media_id)) out.ogMediaId = entry.og_media_id;
  return out;
}

/** Paths the sitemap must NOT list (noindex, or sitemap switched off). */
export function sitemapExclusions(entries: readonly SeoEntryLite[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.status !== "published") continue;
    if (e.noindex === true || e.sitemap_include === false) {
      const p = normalizeSeoPath(e.path);
      if (p) out.add(p);
    }
  }
  return out;
}

/** Path part of a sitemap URL ("https://x/menu" -> "/menu", origin -> "/"). */
export function pathOfUrl(url: string): string {
  try {
    return normalizeSeoPath(new URL(url).pathname) ?? "/";
  } catch {
    return "/";
  }
}

export function __runSeoOverrideCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) passed++;
    else {
      failed++;
      console.error(`seo-override-core: ${name}: got ${g}, want ${w}`);
    }
  };
  const O = "https://www.greenwaymarijuana.com";
  const row = (p: Partial<SeoEntryLite>): SeoEntryLite => ({
    path: "/menu",
    seo_title: null,
    seo_description: null,
    canonical: null,
    noindex: false,
    sitemap_include: true,
    status: "published",
    ...p,
  });

  eq("path plain", normalizeSeoPath("/menu"), "/menu");
  eq("path slash", normalizeSeoPath("/menu/"), "/menu");
  eq("path no lead", normalizeSeoPath("menu"), "/menu");
  eq("path query", normalizeSeoPath("/Menu?x=1#y"), "/menu");
  eq("path root", normalizeSeoPath("/"), "/");
  eq("path empty", normalizeSeoPath(" "), null);
  eq("path double", normalizeSeoPath("//evil.com"), null);
  eq("path bad char", normalizeSeoPath("/a b<"), null);

  eq("brand yes", titleHasBrand("Greenway Marijuana Port Orchard"), true);
  eq("brand no", titleHasBrand("Daily Deals"), false);
  eq("final branded", finalTitle("Greenway Deals"), "Greenway Deals");
  eq("final plain", finalTitle("Daily Deals"), "Daily Deals | Greenway Marijuana");
  eq("final blank", finalTitle("  ", "X | Greenway Marijuana"), "X | Greenway Marijuana");

  eq("canon path", safeCanonical("/menu/", O), "/menu");
  eq("canon same origin", safeCanonical(`${O}/specials`, O), "/specials");
  eq("canon other host", safeCanonical("https://evil.com/menu", O), null);
  eq("canon apex host", safeCanonical("https://greenwaymarijuana.com/menu", O), null);
  eq("canon http", safeCanonical("http://www.greenwaymarijuana.com/menu", O), null);
  eq("canon js", safeCanonical("javascript:alert(1)", O), null);
  eq("canon blank", safeCanonical("", O), null);

  eq("ov none", resolveSeoOverride(null, O), { noindex: false });
  eq("ov draft ignored", resolveSeoOverride(row({ status: "draft", seo_title: "X", noindex: true }), O), { noindex: false });
  eq("ov empty fields", resolveSeoOverride(row({ seo_title: " ", seo_description: "" }), O), { noindex: false });
  eq(
    "ov full",
    resolveSeoOverride(row({ seo_title: "Shop  Flower", seo_description: " Fresh deals ", canonical: "/menu", noindex: true }), O),
    { noindex: true, title: { text: "Shop Flower", absolute: false }, description: "Fresh deals", canonical: "/menu" },
  );
  eq("ov branded absolute", resolveSeoOverride(row({ seo_title: "Greenway Marijuana | Menu" }), O).title, { text: "Greenway Marijuana | Menu", absolute: true });
  eq("ov bad canonical dropped", resolveSeoOverride(row({ canonical: "https://other.com/" }), O).canonical, undefined);
  eq("ov og uuid", resolveSeoOverride(row({ og_media_id: "123e4567-e89b-12d3-a456-426614174000" }), O).ogMediaId, "123e4567-e89b-12d3-a456-426614174000");
  eq("ov og junk", resolveSeoOverride(row({ og_media_id: "nope" }), O).ogMediaId, undefined);

  const ex = sitemapExclusions([
    row({ path: "/menu" }),
    row({ path: "/about/", noindex: true }),
    row({ path: "/faq", sitemap_include: false }),
    row({ path: "/blog", sitemap_include: false, status: "draft" }),
  ]);
  eq("sitemap excl", [...ex].sort(), ["/about", "/faq"]);
  eq("url path", pathOfUrl(`${O}/menu/products/1`), "/menu/products/1");
  eq("url root", pathOfUrl(O), "/");
  eq("url bad", pathOfUrl("nope"), "/");

  return { passed, failed };
}
