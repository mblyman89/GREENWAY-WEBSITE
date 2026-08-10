// Centralized, safe access to Plaid environment configuration.
//
// Mirrors src/lib/supabase/env.ts: the back office stays "soft-disabled" when
// the Plaid env vars are missing, so the site keeps building/deploying before
// Plaid is wired up. Nothing here throws; callers check `isPlaidConfigured`.
//
// Michael sets these three in Vercel → Settings → Environment Variables:
//   PLAID_CLIENT_ID  — one value (same across environments)
//   PLAID_SECRET     — the Sandbox OR Production secret (matches PLAID_ENV)
//   PLAID_ENV        — "sandbox" | "production"  (Plaid retired "development")
//
// SECURITY: PLAID_SECRET is server-only and must NEVER be exposed to the
// browser. There is deliberately no NEXT_PUBLIC_ variant.

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

/** True when the server can talk to Plaid (both credentials present). */
export const isPlaidConfigured = Boolean(plaidClientId && plaidSecret);
