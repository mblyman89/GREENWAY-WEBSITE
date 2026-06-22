import { getLeaflyBaseUrl, getLeaflyConfig } from "./config";
import { mockMenuItems } from "./mock-menu";

export async function getGreenwayMenuPreview() {
  // First milestone intentionally returns mock data. Do not call Leafly until credentials,
  // sandbox access, and the certification plan are confirmed.
  return mockMenuItems;
}

export function describeLeaflyRuntime() {
  const config = getLeaflyConfig();
  return {
    environment: config.environment,
    baseUrl: getLeaflyBaseUrl(config.environment),
    hasMenuIntegrationKey: Boolean(config.menuIntegrationKey),
    hasOAuthCredentials: Boolean(config.clientId && config.clientSecret),
  };
}
