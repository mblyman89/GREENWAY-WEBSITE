// Centralized, safe access to Supabase environment configuration.
// The back office is "soft-disabled" when env vars are missing so the public
// site keeps building/deploying even before Supabase is wired up.

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when the public (browser-safe) Supabase config is present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** True when the server can use the privileged service-role client. */
export const isSupabaseServiceConfigured = Boolean(
  supabaseUrl && supabaseServiceRoleKey,
);

/** Emails auto-promoted to "owner" on first login (bootstrap admins). */
export const bootstrapAdminEmails = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
