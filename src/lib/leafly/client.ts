import { getLeaflyBaseUrl, getLeaflyConfig } from "./config";
import { mockMenuItems } from "./mock-menu";

export async function getGreenwayMenuPreview() {
  // First milestone intentionally returns mock data. Do not call Leafly until credentials,
  // sandbox access, and the certification plan are confirmed.
  return mockMenuItems;
}

/**
 * Synchronous runtime descriptor (reads the current config cache). Prefer
 * describeLeaflyRuntimeAsync() when you need DB-entered credentials reflected.
 */
export function describeLeaflyRuntime() {
  const config = getLeaflyConfig();
  return {
    environment: config.environment,
    baseUrl: getLeaflyBaseUrl(config.environment),
    hasMenuIntegrationKey: Boolean(config.menuIntegrationKey),
    hasOAuthCredentials: Boolean(config.clientId && config.clientSecret),
  };
}

/**
 * Load back-office-entered credentials (integration_credentials) then describe
 * the Leafly runtime. Used by the integrations dashboard so DB-entered keys are
 * reflected in the status. Server-only via the runtime import.
 */
export async function describeLeaflyRuntimeAsync() {
  const { refreshLeaflyConfig } = await import("./runtime");
  await refreshLeaflyConfig();
  return describeLeaflyRuntime();
}
