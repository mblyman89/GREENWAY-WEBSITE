import { BROWSER_COOKIE } from "@/lib/payments/vendor-esign-core";

/** The browser-binding cookie name (scoped to /vendor-ach). */
export const VENDOR_COOKIE = BROWSER_COOKIE;

/** Built only from a token that already passed isTokenShape. */
export function vendorPath(token: string): string {
  return `/vendor-ach/${token}`;
}
