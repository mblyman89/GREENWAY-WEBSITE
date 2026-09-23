// Privileged service-role Supabase client. SERVER-ONLY.
// Bypasses RLS — only use in trusted server code (audit inserts, user admin,
// storage signing). Never import this into client components.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";
import { SUPABASE_DB_OPTIONS } from "./db-floor";

export function createSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Supabase service-role client requested but env is not configured.",
    );
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // SLICE L-26 — the floor. Every query made through this client aborts
    // rather than hanging forever.
    //
    // This is the client that nearly every reader in the application uses:
    // the announcer, the printer, loyalty, medical, the orders store and the
    // Leafly board all reach the database through here. The L-26 inventory
    // counted 300 reachable queries with no deadline of any kind, and an
    // unbounded query on the orders-page render is what keeps the Leafly
    // acknowledge spinner turning after the acknowledgement itself has
    // already succeeded (see `db-floor.ts` for the full chain of evidence,
    // including why `AbortSignal.any` could NOT be used here).
    //
    // A timeout surfaces through the ordinary `{ data, error }` channel, so
    // all 300 of those call sites handle it correctly without being edited.
    db: SUPABASE_DB_OPTIONS,
  });
}
