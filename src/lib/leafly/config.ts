import type { LeaflyClientConfig } from "./types";
import type { LeaflyOverrides } from "@/lib/integrations/integration-credentials-core";

/**
 * Leafly config resolution (Slice 60).
 *
 * Credentials may now be entered from the back office (integration_credentials
 * table) OR provided via environment variables. A non-empty DB value overrides
 * the env value. Because most call sites are synchronous, DB overrides are
 * fetched by an async loader (refreshLeaflyConfigCache) at the start of each
 * public Leafly operation and cached in-process; the synchronous getters then
 * read that cache, falling back to raw env when the cache is empty.
 */

let overrideCache: LeaflyOverrides | null = null;

/** Called by the store loader to install DB-resolved overrides for this process. */
export function setLeaflyOverrideCache(overrides: LeaflyOverrides | null): void {
  overrideCache = overrides;
}

function envConfig(): LeaflyClientConfig {
  return {
    environment: process.env.LEAFLY_ENVIRONMENT === "production" ? "production" : "sandbox",
    menuIntegrationKey: process.env.LEAFLY_MENU_INTEGRATION_KEY,
    clientId: process.env.LEAFLY_CLIENT_ID,
    clientSecret: process.env.LEAFLY_CLIENT_SECRET,
  };
}

/**
 * Resolve the effective Leafly config. If DB overrides have been installed
 * (via setLeaflyOverrideCache, populated from the back office), they win;
 * otherwise the environment variables are used directly.
 *
 * Optionally accepts explicit overrides (used by the async loader path).
 */
export function getLeaflyConfig(overrides?: LeaflyOverrides | null): LeaflyClientConfig {
  const o = overrides ?? overrideCache;
  if (!o) return envConfig();
  return {
    environment: o.environment,
    menuIntegrationKey: o.menuIntegrationKey,
    clientId: o.clientId,
    clientSecret: o.clientSecret,
  };
}

export function getLeaflyBaseUrl(environment: LeaflyClientConfig["environment"]) {
  return environment === "production"
    ? "https://api.leafly.com/v2/menu_integration"
    : "https://api-sandbox.leafly.io/v2/menu_integration";
}

// OAuth2 client-credentials token endpoints. Verified from the Leafly Menu
// Integration API v2.0 OpenAPI spec (securitySchemes.OAuth2ClientCredentials).
export function getLeaflyTokenUrl(environment: LeaflyClientConfig["environment"]) {
  return environment === "production"
    ? "https://sso.leafly.com/token"
    : "https://sso-sandbox.leafly.io/token";
}
