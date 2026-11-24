"use client";

/**
 * USAGE-10c: the site-wide Organization / WebSite / Store JSON-LD.
 *
 * Built here from the (small) store-hours input instead of on the server, so
 * the layout's RSC payload carries `{hours, today}` rather than ~3.6 KB of
 * serialized JSON strings on every page. The SSR HTML is byte-identical: the
 * same builders run during server rendering of this client component, so
 * crawlers see the same <script type="application/ld+json"> blocks.
 */
import { organizationSchema, storeSchema, websiteSchema } from "@/lib/seo/seo";
import type { StoreHours } from "@/lib/seo/store-hours-core";
import { JsonLd } from "./JsonLd";

export function SiteJsonLd({ hours, today }: { hours: StoreHours; today: string }) {
  return <JsonLd data={[organizationSchema(), websiteSchema(), storeSchema(hours, today)]} id="site" />;
}
