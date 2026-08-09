import "server-only";

/**
 * src/lib/plaid/client.ts — the server-only PlaidApi singleton (Slice P1).
 *
 * Env-driven basePath (sandbox/production) + the PLAID-CLIENT-ID / PLAID-SECRET
 * request headers. The secret lives ONLY here on the server (env.ts reads it
 * from process.env) and is never shipped to the browser.
 *
 * Nothing here performs a network call — it just constructs the client. The
 * actual API calls (linkTokenCreate, itemPublicTokenExchange, accountsGet,
 * transactionsSync, liabilitiesGet) arrive in later slices (P2–P5). Callers
 * must check isPlaidConfigured before using the client so an unconfigured
 * deploy fails gracefully instead of throwing.
 */
import { Configuration, PlaidApi, type PlaidEnvironments } from "plaid";
import {
  plaidClientId,
  plaidSecret,
  plaidBasePath,
  PLAID_API_VERSION,
  isPlaidConfigured,
} from "./env";

// Keep a reference to the SDK's env map type without needing a runtime import
// of a specific member (production/sandbox); we resolve the URL ourselves in
// env.ts so we don't depend on which keys exist in a given SDK version.
export type PlaidEnvironmentsType = typeof PlaidEnvironments;

let cached: PlaidApi | null = null;

/**
 * Get (or lazily build) the shared PlaidApi client. Returns null when Plaid is
 * not configured, so callers can degrade gracefully:
 *
 *   const plaid = getPlaidClient();
 *   if (!plaid) return { ok: false, error: "Plaid is not configured yet." };
 */
export function getPlaidClient(): PlaidApi | null {
  if (!isPlaidConfigured) return null;
  if (cached) return cached;

  const configuration = new Configuration({
    basePath: plaidBasePath(),
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": plaidClientId,
        "PLAID-SECRET": plaidSecret,
        "Plaid-Version": PLAID_API_VERSION,
      },
    },
  });

  cached = new PlaidApi(configuration);
  return cached;
}
