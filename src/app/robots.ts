import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://www.greenwaymarijuana.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/checkout", "/checkout/confirmation"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
