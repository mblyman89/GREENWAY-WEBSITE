import "server-only";

/**
 * src/lib/plaid/client.ts — the server-only PlaidApi clients (Slice P1, extended
 * by the credential-sets slice).
 *
 * Each CREDENTIAL SET ({clientId, secret, env}, owned by a person) gets its OWN
 * PlaidApi client, because every Plaid call about an Item must use the SAME
 * credentials that Item was linked under. Clients are cached per set key. The
 * secrets live ONLY here on the server (env.ts reads them from process.env) and
 * are never shipped to the browser.
 *
 * Nothing here performs a network call — it just constructs clients. Callers
 * check the set is configured (getPlaidClient returns null otherwise) so an
 * unconfigured deploy fails gracefully instead of throwing.
 *
 * BACK-COMPAT: getPlaidClient() with no argument returns the PRIMARY set's
 * client — identical behavior to before this slice.
 */
import { Configuration, PlaidApi, type PlaidEnvironments } from "plaid";
import { plaidCredentialSets, PLAID_API_VERSION } from "./env";
import {
  plaidBasePathFor,
  getCredentialSet,
  type CredentialSetKey,
} from "./plaid-credentials-core";

// Keep a reference to the SDK's env map type without needing a runtime import
// of a specific member (production/sandbox); we resolve the URL ourselves in
// plaid-credentials-core so we don't depend on which keys exist in a given SDK.
export type PlaidEnvironmentsType = typeof PlaidEnvironments;

const cache = new Map<CredentialSetKey, PlaidApi>();

/**
 * Get (or lazily build) the PlaidApi client for a credential set. Returns null
 * when that set is not configured, so callers can degrade gracefully:
 *
 *   const plaid = getPlaidClient(item.credentialSet);
 *   if (!plaid) return { ok: false, error: "Plaid is not configured yet." };
 */
export function getPlaidClient(setKey: CredentialSetKey = "primary"): PlaidApi | null {
  const set = getCredentialSet(plaidCredentialSets, setKey);
  if (!set || !set.configured) return null;

  const hit = cache.get(setKey);
  if (hit) return hit;

  const configuration = new Configuration({
    basePath: plaidBasePathFor(set.env),
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": set.clientId,
        "PLAID-SECRET": set.secret,
        "Plaid-Version": PLAID_API_VERSION,
      },
    },
  });

  const client = new PlaidApi(configuration);
  cache.set(setKey, client);
  return client;
}

/** True when the given credential set can talk to Plaid. */
export function isPlaidClientConfigured(setKey: CredentialSetKey = "primary"): boolean {
  const set = getCredentialSet(plaidCredentialSets, setKey);
  return Boolean(set && set.configured);
}
