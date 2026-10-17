/**
 * Who the shopper is buying from. Every fact here is either verified (the
 * legal name / dba the owner gave us) or read from an env var the owner sets
 * in the greenwaymerch.com Vercel project. NOTHING is guessed: if an env var
 * is missing the page shows nothing for that line instead of a made-up value.
 *
 * Card-network rules (e.g. Visa Core Rules 5.8.4.1) want the merchant name,
 * customer-service contact, the merchant's country, and refund / delivery /
 * privacy policies visible on the site - the footer + policy pages cover them.
 */
export const LEGAL_NAME = "Greenway Merchandising LLC";
export const DBA_NAME = "Greenway Glass & Goods";
export const SITE_NAME = "Greenway Merch";
export const COUNTRY = "United States";

const env = (k: string) => (process.env[k] ?? "").trim();

/** Canonical origin (no trailing slash). The owner's domain is greenwaymerch.com. */
export const siteUrl = () => (env("MERCH_SITE_URL") || "https://greenwaymerch.com").replace(/\/+$/, "");

/** Public business contact lines (set in Vercel; blank = hidden). */
export const contact = () => ({
  email: env("NEXT_PUBLIC_MERCH_CONTACT_EMAIL"),
  phone: env("NEXT_PUBLIC_MERCH_CONTACT_PHONE"),
  /** One line, e.g. "123 Main St, Olympia, WA 98501". */
  address: env("NEXT_PUBLIC_MERCH_BUSINESS_ADDRESS"),
});

/** Where the "Back to Greenway" link goes (the owner's main site). */
export const MAIN_SITE_URL = "https://greenwaymarijuana.com";
