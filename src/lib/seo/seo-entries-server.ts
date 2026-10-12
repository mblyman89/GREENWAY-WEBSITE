/**
 * R46-S2: apply the SEO Editor's saved values (seo_entries) to public pages.
 *
 * Each public page keeps its hand-written metadata as the DEFAULT and calls
 * withSeoOverride(base, path) from generateMetadata. The decisions (title
 * template, safe canonical, noindex) live in seo-override-core.ts.
 *
 * One read per path per request (React cache, as the Next.js
 * generateMetadata docs recommend when the data source is not `fetch`).
 * Never throws: any error means "no override", so a database hiccup can
 * never blank a page's title or de-index it.
 */
import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { resolveMediaUrls } from "@/lib/media/store";
import { CANONICAL_ORIGIN } from "@/lib/site/site-domain-core";
import {
  normalizeSeoPath,
  resolveSeoOverride,
  sitemapExclusions,
  type SeoEntryLite,
  type SeoOverride,
} from "./seo-override-core";

const COLS = "path,seo_title,seo_description,canonical,noindex,sitemap_include,status,og_media_id";

/** The saved, published entry for one path (null when none / on error). */
export const getSeoOverride = cache(async (path: string): Promise<SeoOverride> => {
  const p = normalizeSeoPath(path);
  if (!p || !isSupabaseServiceConfigured) return { noindex: false };
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("seo_entries")
      .select(COLS)
      .eq("path", p)
      .eq("status", "published")
      .maybeSingle();
    if (error || !data) return { noindex: false };
    return resolveSeoOverride(data as SeoEntryLite, CANONICAL_ORIGIN);
  } catch {
    return { noindex: false };
  }
});

/** Paths the sitemap must leave out. Empty on any error. */
export async function getSitemapExclusions(): Promise<Set<string>> {
  if (!isSupabaseServiceConfigured) return new Set();
  try {
    const { data, error } = await createSupabaseAdminClient().from("seo_entries").select(COLS).eq("status", "published").limit(1000);
    if (error || !data) return new Set();
    return sitemapExclusions(data as SeoEntryLite[]);
  } catch {
    return new Set();
  }
}

/**
 * Merge the override onto a page's default metadata. Next.js replaces a
 * parent's openGraph/twitter objects wholesale, so both are rebuilt from the
 * page's own values plus the override (never partially).
 */
export async function withSeoOverride(base: Metadata, path: string): Promise<Metadata> {
  const o = await getSeoOverride(path);
  if (!o.title && !o.description && !o.canonical && !o.noindex && !o.ogMediaId) return base;

  const out: Metadata = { ...base };
  const plainTitle = o.title?.text;
  if (o.title) out.title = o.title.absolute ? { absolute: o.title.text } : o.title.text;
  if (o.description) out.description = o.description;
  if (o.canonical) out.alternates = { ...(base.alternates ?? {}), canonical: o.canonical };
  if (o.noindex) out.robots = { index: false, follow: true, googleBot: { index: false, follow: true } };

  let ogImage: string | undefined;
  if (o.ogMediaId) {
    try {
      ogImage = (await resolveMediaUrls([o.ogMediaId])).get(o.ogMediaId);
    } catch {
      ogImage = undefined;
    }
  }

  const og = base.openGraph ?? {};
  out.openGraph = {
    ...og,
    ...(plainTitle ? { title: plainTitle } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.canonical ? { url: o.canonical } : {}),
    ...(ogImage ? { images: [{ url: ogImage }] } : {}),
  };
  const tw = base.twitter ?? {};
  out.twitter = {
    ...tw,
    ...(plainTitle ? { title: plainTitle } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(ogImage ? { images: [ogImage] } : {}),
  } as Metadata["twitter"];
  return out;
}
