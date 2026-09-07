import type { MetadataRoute } from "next";
import { loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { getPublishedSlugs } from "@/lib/cms/blog-store";

const baseUrl = "https://www.greenwaymarijuana.com";

// Public, indexable routes (dev preview routes intentionally excluded; checkout
// and admin are excluded because they are transactional/internal).
const staticRoutes = [
  "",
  "/menu",
  "/specials",
  "/locations",
  "/about",
  "/loyalty",
  "/medical",
  "/price-match",
  "/vendor-delivery",
  "/blog",
  "/faq",
  "/privacy-policy",
  "/terms-of-use",
  "/consumer-health-data",
];

function priorityFor(route: string) {
  if (route === "") return 1;
  if (route === "/menu") return 0.9;
  if (route === "/specials" || route === "/locations" || route === "/loyalty") return 0.8;
  return 0.6;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries = staticRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" || route === "/menu" || route === "/specials" ? "daily" : "weekly",
    priority: priorityFor(route),
  })) satisfies MetadataRoute.Sitemap;

  // Product detail pages mirror the live menu (POS preview items),
  // de-duplicated by id.
  const seen = new Set<string>();
  const liveMenuItems = await loadLiveMenuItemsCached();
  const productEntries = [...liveMenuItems]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => ({
      url: `${baseUrl}/menu/products/${item.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.55,
    })) satisfies MetadataRoute.Sitemap;

  // SLICE 115: individual published blog/newsletter articles. getPublishedSlugs
  // is DB-backed with a built-in fallback to the starter posts, so this never
  // throws and the sitemap always lists the same articles the blog shows.
  const blogSlugs = await getPublishedSlugs();
  const blogEntries = blogSlugs.map((slug) => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  })) satisfies MetadataRoute.Sitemap;

  return [...staticEntries, ...productEntries, ...blogEntries];
}
