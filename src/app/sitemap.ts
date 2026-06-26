import type { MetadataRoute } from "next";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { mockMenuItems } from "@/lib/leafly/mock-menu";

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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries = staticRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" || route === "/menu" || route === "/specials" ? "daily" : "weekly",
    priority: priorityFor(route),
  })) satisfies MetadataRoute.Sitemap;

  // Product detail pages mirror the live menu (POS preview items) plus any mock
  // items still routed, de-duplicated by id.
  const seen = new Set<string>();
  const productEntries = [...posMenuPreviewItems, ...mockMenuItems]
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

  return [...staticEntries, ...productEntries];
}
