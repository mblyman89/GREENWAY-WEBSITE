/**
 * src/lib/weedmaps/config.ts
 *
 * WeedMaps Menu API (2025-07) config. Grounded in the owner-supplied Weedmaps
 * developer documentation — see docs/weedmaps-menu-api.md.
 *
 * Verified facts:
 *   - Menu API base: https://api-g.weedmaps.com/wm/2025-07/partners
 *   - Auth: OAuth 2.0 Bearer token, HTTPS only.
 *   - Integration target is a MENU (by menu_id), not the legacy WMID listing id.
 *
 * NOT inlined in the supplied docs (so read from env, do not hardcode/guess):
 *   - The OAuth token endpoint URL + client-credentials params live on the
 *     partner portal page /docs/obtaining-an-access-token. We read the token URL
 *     from env so it can be set once the owner confirms it, and also accept a
 *     directly-provisioned bearer token (WEEDMAPS_ACCESS_TOKEN) for onboarding.
 */

export type WeedmapsEnvironment = "sandbox" | "production";

export type WeedmapsClientConfig = {
  environment: WeedmapsEnvironment;
  /** Weedmaps Menu ID (the 2025-07 integration target). Falls back to WM_ID. */
  menuId?: string;
  /** OAuth2 client credentials (token obtained at runtime). */
  clientId?: string;
  clientSecret?: string;
  /** Optional pre-provisioned bearer token (onboarding shortcut). */
  accessToken?: string;
  /** OAuth token endpoint URL (not inlined in docs; configured by owner). */
  tokenUrl?: string;
};

export function getWeedmapsConfig(): WeedmapsClientConfig {
  return {
    environment: process.env.WEEDMAPS_ENVIRONMENT === "production" ? "production" : "sandbox",
    menuId: process.env.WEEDMAPS_MENU_ID || process.env.WEEDMAPS_WM_ID,
    clientId: process.env.WEEDMAPS_CLIENT_ID,
    clientSecret: process.env.WEEDMAPS_CLIENT_SECRET,
    accessToken: process.env.WEEDMAPS_ACCESS_TOKEN,
    tokenUrl: process.env.WEEDMAPS_TOKEN_URL,
  };
}

// Verified from the docs: a single api-g host with a versioned partners path.
// The version segment is 2025-07 (docs note no schema change 2025-01 -> 2025-07).
// The supplied docs do not describe a separate sandbox host, so the same base URL is
// used for both environments; the parameter is kept for call-site symmetry with Leafly.
export function getWeedmapsBaseUrl(
  environment: WeedmapsClientConfig["environment"] = "production",
): string {
  void environment;
  return "https://api-g.weedmaps.com/wm/2025-07/partners";
}
