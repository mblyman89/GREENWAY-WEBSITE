/**
 * src/lib/weedmaps/client.ts
 *
 * WeedMaps runtime status helper. Exposes a safe status descriptor for the integrations
 * dashboard so staff can see whether the WeedMaps credentials are present.
 *
 * Grounded in the owner-supplied Weedmaps developer docs (see docs/weedmaps-menu-api.md):
 *   - Integration target is a MENU (by menu_id).
 *   - Auth is OAuth 2.0 client-credentials against the verified token endpoint
 *     (https://api-g.weedmaps.com/auth/token) OR a pre-provisioned bearer token.
 *   - Because the token URL now defaults to the verified Weedmaps endpoint, OAuth
 *     client id + secret are sufficient (no separate token-URL env required).
 */
import { getWeedmapsBaseUrl, getWeedmapsConfig } from "./config";

export function describeWeedmapsRuntime() {
  const config = getWeedmapsConfig();
  const hasMenuId = Boolean(config.menuId);
  const hasOAuthCredentials = Boolean(config.clientId && config.clientSecret);
  const hasAccessToken = Boolean(config.accessToken);
  return {
    environment: config.environment,
    baseUrl: getWeedmapsBaseUrl(config.environment),
    tokenUrl: config.tokenUrl,
    scope: config.scope,
    hasMenuId,
    hasOAuthCredentials,
    hasAccessToken,
    /** OAuth client-credentials (token URL is built-in) OR a directly provisioned token. */
    hasAuth: hasOAuthCredentials || hasAccessToken,
  };
}

/** Whether WeedMaps is configured enough to attempt a live menu push. */
export function isWeedmapsConfigured(): boolean {
  const s = describeWeedmapsRuntime();
  return s.hasMenuId && s.hasAuth;
}
