/**
 * src/lib/weedmaps/config.ts
 *
 * WeedMaps Menu API (2025-07) config. Grounded in the owner-supplied Weedmaps
 * developer documentation — see docs/weedmaps-menu-api.md.
 *
 * Verified facts:
 *   - Menu API base:   https://api-g.weedmaps.com/wm/2025-07/partners
 *   - Token endpoint:  https://api-g.weedmaps.com/auth/token  (POST, JSON body,
 *     grant_type=client_credentials, returns 201 with a 14-day JWT bearer token)
 *   - Auth: OAuth 2.0 Bearer token, HTTPS only.
 *   - Integration target is a MENU (by menu_id), not the legacy WMID listing id.
 *   - Required scopes: taxonomy:read brands:read products:read menu_items menus:write
 *
 * Env overrides are still honored (token URL / scope) so the owner can adjust without a
 * code change, but the verified defaults mean the integration works out of the box once
 * client credentials + menu id are set.
 */

import type { WeedmapsOverrides } from "@/lib/integrations/integration-credentials-core";

export type WeedmapsEnvironment = "sandbox" | "production";

/** Verified default OAuth token endpoint (Obtaining an Access Token). */
export const WEEDMAPS_TOKEN_URL_DEFAULT = "https://api-g.weedmaps.com/auth/token";

/** Verified default scopes for menu syndication (Obtaining an Access Token). */
export const WEEDMAPS_DEFAULT_SCOPE =
  "taxonomy:read brands:read products:read menu_items menus:write";

export type WeedmapsClientConfig = {
  environment: WeedmapsEnvironment;
  /** Weedmaps Menu ID (the 2025-07 integration target). Falls back to WM_ID. */
  menuId?: string;
  /** OAuth2 client credentials (token obtained at runtime via client_credentials). */
  clientId?: string;
  clientSecret?: string;
  /** Optional pre-provisioned bearer token (onboarding shortcut). */
  accessToken?: string;
  /** OAuth token endpoint URL. Defaults to the verified Weedmaps URL. */
  tokenUrl: string;
  /** OAuth scopes requested at token time. Defaults to the verified menu scopes. */
  scope: string;
};

/**
 * Back-office credentials (integration_credentials) may override the env
 * (Slice 60). A non-empty DB value wins. Because most call sites are sync, the
 * async loader (refreshWeedmapsConfig) installs DB overrides in this cache and
 * the sync getter reads it, falling back to raw env when the cache is empty.
 */
let overrideCache: WeedmapsOverrides | null = null;

/** Install DB-resolved overrides for this process (called by the loader). */
export function setWeedmapsOverrideCache(overrides: WeedmapsOverrides | null): void {
  overrideCache = overrides;
}

function envConfig(): WeedmapsClientConfig {
  return {
    environment: process.env.WEEDMAPS_ENVIRONMENT === "production" ? "production" : "sandbox",
    menuId: process.env.WEEDMAPS_MENU_ID || process.env.WEEDMAPS_WM_ID,
    clientId: process.env.WEEDMAPS_CLIENT_ID,
    clientSecret: process.env.WEEDMAPS_CLIENT_SECRET,
    accessToken: process.env.WEEDMAPS_ACCESS_TOKEN,
    tokenUrl: process.env.WEEDMAPS_TOKEN_URL || WEEDMAPS_TOKEN_URL_DEFAULT,
    scope: process.env.WEEDMAPS_SCOPE || WEEDMAPS_DEFAULT_SCOPE,
  };
}

export function getWeedmapsConfig(overrides?: WeedmapsOverrides | null): WeedmapsClientConfig {
  const o = overrides ?? overrideCache;
  if (!o) return envConfig();
  return {
    environment: o.environment,
    menuId: o.menuId,
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    accessToken: o.accessToken,
    // Verified defaults still apply when the DB/env leaves these empty.
    tokenUrl: o.tokenUrl || WEEDMAPS_TOKEN_URL_DEFAULT,
    scope: o.scope || WEEDMAPS_DEFAULT_SCOPE,
  };
}

// Verified from the docs: a single api-g host with a versioned partners path.
// The version segment is 2025-07 (supported until July 2027). The supplied docs do not
// describe a separate sandbox host, so the same base URL is used for both environments;
// the parameter is kept for call-site symmetry with Leafly.
export function getWeedmapsBaseUrl(
  environment: WeedmapsClientConfig["environment"] = "production",
): string {
  void environment;
  return "https://api-g.weedmaps.com/wm/2025-07/partners";
}
