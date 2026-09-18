/**
 * src/lib/leafly/token.ts
 *
 * ONE OAuth2 client-credentials token cache, shared by every Leafly API.
 *
 * WHY THIS FILE EXISTS (slice L-6)
 * --------------------------------
 * This code was not written for L-6. It was LIFTED, unchanged in behaviour, out
 * of `push.ts`, where it had been a private function with a module-private
 * cache. L-6 added a second caller (the Order API), and at that moment the
 * private cache became a defect waiting to happen, for a reason that is worth
 * writing down because it is not obvious:
 *
 *   The Order API and the Menu API are on DIFFERENT HOSTS but share the SAME
 *   token endpoint and the SAME (empty) scope set.
 *
 * That is not an assumption. It is read directly out of the two vendored specs:
 *
 *   docs/leafly-specs/order-api-v1.openapi.json
 *     components.securitySchemes.OAuth2ClientCredentials.flows
 *       .clientCredentials.tokenUrl  = "https://sso.leafly.com/token"
 *       .clientCredentials.scopes    = {}   (empty object)
 *
 *   docs/leafly-specs/menu-integration-v2.openapi.json
 *     components.securitySchemes.OAuth2ClientCredentials.flows
 *       .clientCredentials.tokenUrl  = "https://sso.leafly.com/token"
 *       .clientCredentials.scopes    = {}   (empty object)
 *
 * Identical token URL, identical empty scopes. So a token minted for a menu
 * push is the very same bearer token the Order API wants, and there is no scope
 * to differentiate. Had L-6 copied the token function next to the new Order
 * client -- the path of least resistance -- the result would have been two
 * caches of the same credential, each unaware of the other. The failure mode is
 * the nasty kind: nothing breaks, so nobody looks. We would simply request
 * twice as many tokens as necessary, and a `resetLeaflyTokenCache()` issued
 * after a 401 on one API would leave the OTHER API happily using the token that
 * had just been declared suspect.
 *
 * Hence one cache, in one file, imported by both.
 *
 * WHAT IS DELIBERATELY *NOT* SHARED
 * ---------------------------------
 * The BASE URL. `getLeaflyBaseUrl()` returns the MENU host
 * (api-sandbox.leafly.io/v2/menu_integration). The Order API lives on
 * reservations-api-sandbox.leafly.io/v1/order_integration. Sharing the token
 * while NOT sharing the base URL is exactly the right split, and this comment
 * sits here so that the next person to notice "these two clients look similar"
 * does not go one step further and unify the host too. Unifying the host
 * produces a 404 that reads like a missing order rather than like a
 * misconfiguration -- see `leaflyOrderApiBaseUrl` in order-ack-core.ts, where
 * the distinction is pinned by assertions.
 */
import "server-only";

import { getLeaflyConfig, getLeaflyTokenUrl } from "./config";

type CachedToken = { token: string; expiresAt: number };

let tokenCache: CachedToken | null = null;

/**
 * Safety margin subtracted from the advertised lifetime before the cached token
 * is considered reusable. Preserved from the original push.ts implementation
 * (30 seconds). It exists because `expires_in` is measured from Leafly's clock,
 * not ours, and a token that expires in transit produces a 401 that looks like
 * a credentials problem.
 */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

/**
 * Fallback lifetime when Leafly omits `expires_in`. Also preserved from the
 * original. One hour is a guess about a FALLBACK, not about the protocol, and
 * it is safe because the margin above plus the caller's single 401-retry
 * recover from being wrong.
 */
const TOKEN_DEFAULT_TTL_SECONDS = 3600;

/**
 * Get a bearer token for ANY Leafly API, from cache when still fresh.
 *
 * Throws when credentials are absent rather than attempting an unauthenticated
 * call, so the operator sees "credentials are not configured" instead of a 401
 * that they will reasonably interpret as "my credentials are wrong".
 */
export async function getLeaflyAccessToken(): Promise<string> {
  const config = getLeaflyConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Leafly OAuth credentials are not configured.");
  }
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + TOKEN_EXPIRY_MARGIN_MS) {
    return tokenCache.token;
  }

  const tokenUrl = getLeaflyTokenUrl(config.environment);
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Leafly token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Leafly token response missing access_token.");
  }
  const ttlMs = (json.expires_in ?? TOKEN_DEFAULT_TTL_SECONDS) * 1000;
  tokenCache = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

/**
 * Clear the cached token (e.g. after a 401 that may mean "expired/rotated").
 *
 * Because the cache is now shared, clearing it from the Order API path also
 * protects the Menu API path, which is the entire point of the extraction.
 */
export function resetLeaflyTokenCache(): void {
  tokenCache = null;
}
