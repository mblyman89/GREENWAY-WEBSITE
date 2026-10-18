import type { MetadataRoute } from "next";
import { allProducts } from "@/lib/catalog";
import { CATEGORY_SLUGS } from "@/lib/catalog-core";
import { siteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  return [
    { url: `${base}/` },
    ...CATEGORY_SLUGS.map((s) => ({ url: `${base}/${s}` })),
    ...(await allProducts()).map((p) => ({ url: `${base}/${p.category}/${p.handle}` })),
    ...["shipping", "returns", "privacy", "terms", "contact"].map((s) => ({ url: `${base}/${s}` })),
  ];
}
