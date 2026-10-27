// Centralized, safe access to Supabase environment configuration.
// The back office is "soft-disabled" when env vars are missing so the public
// site keeps building/deploying even before Supabase is wired up.

//
// PERF2-P5 (owner: "i use the publishable key and secret key from the main
// api keys menu. however, i originally set it up with the legacy anon and
// service role keys. they are still active"). Supabase's NEW keys are read
// FIRST, the legacy JWT keys are the fallback:
//
//   browser-safe:  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...)
//                  -> NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy anon JWT)
//   server-only:   SUPABASE_SECRET_KEY (sb_secret_...)
//                  -> SUPABASE_SERVICE_ROLE_KEY (legacy service_role JWT)
//
// supabase-js / @supabase/ssr accept either form unchanged (the new keys are
// sent as `apikey`; the platform swaps in a short-lived JWT). Once the app is
// deployed reading the new keys, the legacy keys can be DISABLED in
// Supabase -> Settings -> API Keys without a code change. `.trim()` drops a
// stray newline pasted into the Vercel field (a classic silent 401).
// NOTE: process.env.NEXT_PUBLIC_* must be referenced literally so Next can
// inline it into the browser bundle - do not refactor into a lookup helper.
const firstKey = (...values: (string | undefined)[]): string => {
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
};
export const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
export const supabaseAnonKey = firstKey(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
export const supabaseServiceRoleKey = firstKey(
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
