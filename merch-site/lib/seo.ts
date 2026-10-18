/** R73 S4: server-side inputs for seo-core (env lives here, never in the pure core). */
import { parseShippingConfig } from "./checkout-core";
import { contact, DBA_NAME, LEGAL_NAME, SITE_NAME, siteUrl } from "./site";
import type { SeoShipping, SeoSite } from "./seo-core";

export function seoSite(): SeoSite {
  const c = contact();
  return { url: siteUrl(), name: SITE_NAME, dba: DBA_NAME, legalName: LEGAL_NAME, email: c.email, phone: c.phone, address: c.address };
}

/** The owner-set shipping (same env checkout uses). Missing -> null, so no shipping claim is made. */
export function seoShipping(): SeoShipping | null {
  const cfg = parseShippingConfig(process.env).config;
  return cfg ? { rateCents: cfg.flatCents, minDays: cfg.minDays, maxDays: cfg.maxDays, freeOverCents: cfg.freeOverCents } : null;
}
