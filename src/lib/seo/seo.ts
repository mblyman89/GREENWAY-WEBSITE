import type { Metadata } from "next";
import { greenwayBusiness } from "@/content/business";

/**
 * Centralized, expert-grade SEO configuration + helpers.
 *
 * - `pageMetadata()` produces consistent per-page Next.js Metadata with canonical
 *   URLs, Open Graph, and Twitter cards.
 * - The schema builders below emit schema.org JSON-LD used across the site
 *   (Organization, WebSite, Store/LocalBusiness, BreadcrumbList, Product, FAQPage).
 */

export const SITE_URL = greenwayBusiness.website; // https://www.greenwaymarijuana.com
export const SITE_NAME = greenwayBusiness.name;
export const DEFAULT_OG_IMAGE = greenwayBusiness.assets.wordmark; // existing brand asset (no new graphics)

// Verified store geo-coordinates (from Google Business listing).
export const STORE_GEO = { latitude: 47.5046205, longitude: -122.6384447 } as const;

type PageMetaInput = {
  title: string;
  description: string;
  /** Path beginning with "/" — used to build the canonical URL. */
  path: string;
  /** Optional OG image override (absolute or root-relative path). */
  image?: string;
  /** Set true to keep the page out of the index (e.g. transactional pages). */
  noindex?: boolean;
  /** Optional OG type (defaults to "website"). */
  ogType?: "website" | "article";
};

function absoluteUrl(pathOrUrl: string) {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export function pageMetadata({ title, description, path, image, noindex, ogType = "website" }: PageMetaInput): Metadata {
  const canonical = absoluteUrl(path);
  const ogImage = absoluteUrl(image ?? DEFAULT_OG_IMAGE);
  return {
    title,
    description,
    alternates: { canonical },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: {
      type: ogType,
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      locale: "en_US",
      images: [{ url: ogImage, alt: SITE_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

// ---------------------------------------------------------------------------
// schema.org JSON-LD builders
// ---------------------------------------------------------------------------

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl(greenwayBusiness.assets.wordmark),
    email: greenwayBusiness.email,
    telephone: greenwayBusiness.phone.formatted,
    address: {
      "@type": "PostalAddress",
      streetAddress: greenwayBusiness.address.line1,
      addressLocality: greenwayBusiness.address.city,
      addressRegion: greenwayBusiness.address.state,
      postalCode: greenwayBusiness.address.postalCode,
      addressCountry: greenwayBusiness.address.country,
    },
    sameAs: [
      greenwayBusiness.social.facebook.url,
      greenwayBusiness.social.instagram.url,
      greenwayBusiness.social.yelp.url,
      greenwayBusiness.social.google.url,
      greenwayBusiness.social.leafly.url,
    ],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    publisher: { "@id": `${SITE_URL}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/menu?search={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function storeSchema() {
  return {
    "@context": "https://schema.org",
    "@type": ["Store", "LocalBusiness"],
    "@id": `${SITE_URL}/#store`,
    name: SITE_NAME,
    image: absoluteUrl(greenwayBusiness.assets.storefront),
    url: SITE_URL,
    telephone: greenwayBusiness.phone.formatted,
    email: greenwayBusiness.email,
    priceRange: "$$",
    currenciesAccepted: "USD",
    address: {
      "@type": "PostalAddress",
      streetAddress: greenwayBusiness.address.line1,
      addressLocality: greenwayBusiness.address.city,
      addressRegion: greenwayBusiness.address.state,
      postalCode: greenwayBusiness.address.postalCode,
      addressCountry: greenwayBusiness.address.country,
    },
    geo: { "@type": "GeoCoordinates", latitude: STORE_GEO.latitude, longitude: STORE_GEO.longitude },
    hasMap: greenwayBusiness.address.directionsUrl,
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "08:00",
        closes: "23:00",
      },
    ],
    sameAs: [
      greenwayBusiness.social.facebook.url,
      greenwayBusiness.social.instagram.url,
      greenwayBusiness.social.yelp.url,
      greenwayBusiness.social.google.url,
      greenwayBusiness.social.leafly.url,
    ],
  };
}

export type BreadcrumbItem = { name: string; path: string };

export function breadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

type ProductSchemaInput = {
  id: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  priceMinorUnits?: number;
  inStock?: boolean;
  image?: string;
};

export function productSchema(item: ProductSchemaInput) {
  const url = absoluteUrl(`/menu/products/${item.id}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.name,
    description: item.description?.trim() || `${item.name} available at ${SITE_NAME} in ${greenwayBusiness.address.city}, ${greenwayBusiness.address.state}.`,
    sku: item.id,
    category: item.category,
    ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
    ...(item.image ? { image: absoluteUrl(item.image) } : {}),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "USD",
      price: ((item.priceMinorUnits ?? 0) / 100).toFixed(2),
      availability: item.inStock === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      seller: { "@id": `${SITE_URL}/#store` },
    },
  };
}

export type FaqEntry = { question: string; answer: string };

export function faqSchema(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}
