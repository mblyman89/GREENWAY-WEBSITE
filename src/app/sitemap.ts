import type { MetadataRoute } from "next";
import { mockMenuItems } from "@/lib/leafly/mock-menu";

const baseUrl = "https://www.greenwaymarijuana.com";

const staticRoutes = [
  "",
  "/menu",
  "/specials",
  "/locations",
  "/about",
  "/blog",
  "/faq",
  "/privacy-policy",
  "/terms-of-use",
  "/consumer-health-data",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticEntries = staticRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" || route === "/menu" ? "daily" : "weekly",
    priority: route === "" ? 1 : route === "/menu" ? 0.9 : 0.7,
  })) satisfies MetadataRoute.Sitemap;

  const productEntries = mockMenuItems.map((item) => ({
    url: `${baseUrl}/menu/products/${item.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.55,
  })) satisfies MetadataRoute.Sitemap;

  return [...staticEntries, ...productEntries];
}
