/**
 * src/lib/weedmaps/config.ts
 *
 * Slice 36 (Feature Q) — WeedMaps menu-integration config. Mirrors the Leafly
 * config shape. The owner has WeedMaps API access; credentials come from env so
 * nothing is committed. Until certification is confirmed the client returns a
 * mock/preview (drafts-only standing rule), exactly like Leafly's first
 * milestone.
 */

export type WeedmapsEnvironment = "sandbox" | "production";

export type WeedmapsClientConfig = {
  environment: WeedmapsEnvironment;
  /** WeedMaps WM ID / listing id for this dispensary. */
  wmId?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
};

export function getWeedmapsConfig(): WeedmapsClientConfig {
  return {
    environment: process.env.WEEDMAPS_ENVIRONMENT === "production" ? "production" : "sandbox",
    wmId: process.env.WEEDMAPS_WM_ID,
    apiKey: process.env.WEEDMAPS_API_KEY,
    clientId: process.env.WEEDMAPS_CLIENT_ID,
    clientSecret: process.env.WEEDMAPS_CLIENT_SECRET,
  };
}

export function getWeedmapsBaseUrl(environment: WeedmapsClientConfig["environment"]) {
  // WeedMaps publishes its API under api-g.weedmaps.com; a sandbox host is used
  // during onboarding. Adjust once WeedMaps confirms the exact endpoints.
  return environment === "production"
    ? "https://api-g.weedmaps.com/discovery/v1"
    : "https://api-g.weedmaps.com/discovery/v1";
}
