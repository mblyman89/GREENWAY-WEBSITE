import type { MetadataRoute } from "next";
import { CANONICAL_ORIGIN } from "@/lib/site/site-domain-core";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = CANONICAL_ORIGIN; // R40: one source of truth

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/checkout",
          "/checkout/confirmation",
          "/admin",
          "/admin/loyalty-signups",
          "/api/",
          "/menu/pos-preview",
          "/vendor-ach",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
