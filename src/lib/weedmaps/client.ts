/**
 * src/lib/weedmaps/client.ts
 *
 * Slice 36 (Feature Q) — WeedMaps runtime status helper. Like Leafly, we do NOT
 * push to WeedMaps until credentials, sandbox access, and the certification plan
 * are confirmed. This exposes a safe status descriptor for the integrations
 * dashboard so staff can see whether the WeedMaps credentials are present.
 */
import { getWeedmapsBaseUrl, getWeedmapsConfig } from "./config";

export function describeWeedmapsRuntime() {
  const config = getWeedmapsConfig();
  return {
    environment: config.environment,
    baseUrl: getWeedmapsBaseUrl(config.environment),
    hasWmId: Boolean(config.wmId),
    hasApiKey: Boolean(config.apiKey),
    hasOAuthCredentials: Boolean(config.clientId && config.clientSecret),
  };
}

/** Whether WeedMaps is configured enough to attempt a live menu push. */
export function isWeedmapsConfigured(): boolean {
  const s = describeWeedmapsRuntime();
  return s.hasWmId && (s.hasApiKey || s.hasOAuthCredentials);
}
