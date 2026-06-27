// Privileged service-role Supabase client. SERVER-ONLY.
// Bypasses RLS — only use in trusted server code (audit inserts, user admin,
// storage signing). Never import this into client components.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

export function createSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Supabase service-role client requested but env is not configured.",
    );
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
