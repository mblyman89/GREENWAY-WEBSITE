// Centralized, safe access to Plaid environment configuration.
//
// Mirrors src/lib/supabase/env.ts: the back office stays "soft-disabled" when
// the Plaid env vars are missing, so the site keeps building/deploying before
// Plaid is wired up. Nothing here throws; callers check `isPlaidConfigured`.
//
// Michael sets the PRIMARY set (his own Plaid) in Vercel → Settings → Env Vars:
//   PLAID_CLIENT_ID  — one value (same across environments)
//   PLAID_SECRET     — the Sandbox OR Production secret (matches PLAID_ENV)
//   PLAID_ENV        — "sandbox" | "production"  (Plaid retired "development")
//   PLAID_OWNER_NAME — (optional) label for grouping, e.g. "Michael"
//
// SECOND Plaid account (his wife's own Hobby account, for the accounts that
// don't fit under the first) uses a parallel "_2" set — same meaning:
//   PLAID_CLIENT_ID_2 / PLAID_SECRET_2 / PLAID_ENV_2 / PLAID_OWNER_NAME_2
// Leave the "_2" vars unset and the app behaves exactly as before (one set).
//
// All the selection logic lives in the PURE plaid-credentials-core; this file
// just feeds it process.env. SECURITY: secrets are server-only and must NEVER
// be exposed to the browser. There is deliberately no NEXT_PUBLIC_ variant.
import {
  resolveCredentialSets,
  anySetConfigured,
  getCredentialSet,
  type CredentialSet,
  type PlaidEnvInput,
} from "./plaid-credentials-core";

// .trim() defends against the single most common cause of a "Plaid rejected
// the account keys" error: an invisible trailing space or newline accidentally
// pasted into the Vercel env var. Plaid compares the key EXACTLY, so " abc\n"
// != "abc". We trim both credentials (resolvePlaidEnv already trims PLAID_ENV).
export const plaidClientId = (process.env.PLAID_CLIENT_ID ?? "").trim();
export const plaidSecret = (process.env.PLAID_SECRET ?? "").trim();

/** Raw PLAID_ENV, normalized to a value the SDK understands. */
export type PlaidEnvName = "sandbox" | "production";

/**
 * Normalize PLAID_ENV. Unknown/missing → "sandbox" (the safe default: it can
 * never touch a real bank account). "development" (Plaid's retired env) also
 * folds to sandbox so a stale value can't point at nothing.
 */
export function resolvePlaidEnv(raw: string | null | undefined): PlaidEnvName {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "production" ? "production" : "sandbox";
}

export const plaidEnv: PlaidEnvName = resolvePlaidEnv(process.env.PLAID_ENV);

/** Base URL for the resolved environment (matches PlaidEnvironments in the SDK). */
export function plaidBasePath(env: PlaidEnvName = plaidEnv): string {
  return env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
}

/**
 * Plaid API version pin. Pinning avoids surprise schema changes when Plaid
 * ships a new default version. (Mirror of the header Plaid recommends.)
 */
export const PLAID_API_VERSION = "2020-09-14";

/**
 * Read all credential sets from process.env via the pure resolver. Computed
 * once at module load (env vars don't change at runtime). The PRIMARY set here
 * is the same PLAID_CLIENT_ID/SECRET/ENV above — kept in sync by construction.
 */
function readPlaidEnvInput(): PlaidEnvInput {
  return {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_ENV: process.env.PLAID_ENV,
    PLAID_OWNER_NAME: process.env.PLAID_OWNER_NAME,
    PLAID_CLIENT_ID_2: process.env.PLAID_CLIENT_ID_2,
    PLAID_SECRET_2: process.env.PLAID_SECRET_2,
    PLAID_ENV_2: process.env.PLAID_ENV_2,
    PLAID_OWNER_NAME_2: process.env.PLAID_OWNER_NAME_2,
  };
}

/** All credential sets (both keys always present; check `.configured`). */
export const plaidCredentialSets: CredentialSet[] = resolveCredentialSets(readPlaidEnvInput());

/** One resolved set by key, or null if unknown. */
export function credentialSet(key: "primary" | "secondary"): CredentialSet | null {
  return getCredentialSet(plaidCredentialSets, key);
}

/**
 * True when the server can talk to Plaid at all (ANY set configured). Kept
 * backward-compatible: with only the original PLAID_* vars set, this is exactly
 * the old `Boolean(clientId && secret)` for the primary set.
 */
export const isPlaidConfigured = anySetConfigured(plaidCredentialSets);
