/**
 * src/lib/weedmaps/client.ts
 *
 * WeedMaps runtime status helper. Like Leafly, we do NOT push to WeedMaps until
 * credentials, menu access, and the write schema are confirmed against the live API.
 * This exposes a safe status descriptor for the integrations dashboard so staff can
 * see whether the WeedMaps credentials are present.
 *
 * Grounded in the owner-supplied Weedmaps developer docs (see docs/weedmaps-menu-api.md):
 *   - Integration target is a MENU (by menu_id).
 *   - Auth is OAuth 2.0 (client credentials) OR a pre-provisioned bearer token.
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
    hasMenuId,
    hasOAuthCredentials,
    hasAccessToken,
    hasTokenUrl: Boolean(config.tokenUrl),
    /** Either OAuth client-credentials + token URL, or a directly provisioned token. */
    hasAuth: (hasOAuthCredentials && Boolean(config.tokenUrl)) || hasAccessToken,
  };
}

/** Whether WeedMaps is configured enough to attempt a live menu push. */
export function isWeedmapsConfigured(): boolean {
  const s = describeWeedmapsRuntime();
  return s.hasMenuId && s.hasAuth;
}
