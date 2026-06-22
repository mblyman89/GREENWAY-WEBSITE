import type { LeaflyClientConfig } from "./types";

export function getLeaflyConfig(): LeaflyClientConfig {
  return {
    environment: process.env.LEAFLY_ENVIRONMENT === "production" ? "production" : "sandbox",
    menuIntegrationKey: process.env.LEAFLY_MENU_INTEGRATION_KEY,
    clientId: process.env.LEAFLY_CLIENT_ID,
    clientSecret: process.env.LEAFLY_CLIENT_SECRET,
  };
}

export function getLeaflyBaseUrl(environment: LeaflyClientConfig["environment"]) {
  return environment === "production"
    ? "https://api.leafly.com/v2/menu_integration"
    : "https://api-sandbox.leafly.io/v2/menu_integration";
}
