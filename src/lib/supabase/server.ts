// Server-side Supabase client bound to the request's auth cookies.
// Use in Server Components, Route Handlers, and Server Actions.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";
import { SUPABASE_DB_OPTIONS } from "./db-floor";
import { SUPABASE_GLOBAL_OPTIONS } from "./fetch-floor";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    // SLICE L-26 — the floor, on the cookie-bound client too.
    //
    // This client resolves the session at the top of EVERY page render and
    // EVERY server action in the product. A stall here hangs the request
    // before any feature code runs, so no feature-level deadline can rescue
    // it — which is why the floor belongs on both clients and not only on
    // the admin one. See `db-floor.ts` for the measurements and for the
    // reason `AbortSignal.any` was rejected.
    db: SUPABASE_DB_OPTIONS,
    // SLICE L-27 — THE CLIENT THIS ACTUALLY FIXES.
    //
    // `getStaffSession()` calls `supabase.auth.getUser()` on THIS client as
    // the first await of every page render and every server action. That call
    // had no timeout: `db.timeout` reaches PostgREST only, and
    // `auth-js/lib/fetch.js:109` issues its request with no `signal` at all.
    //
    // It is also upstream of L-25's 240s action deadline — `requirePermission`
    // is the first statement of `acknowledgeLeaflyOrderAction`, so a stall
    // here happens before that race is armed and no deadline of ours can
    // fire. The result is the owner's exact report: a spinner that runs until
    // Vercel kills the function at `maxDuration = 300`, i.e. "5 minutes then
    // quit". See `fetch-floor.ts` for the measurements and the upstream
    // issues (supabase/supabase#35754, supabase-js#2111).
    global: SUPABASE_GLOBAL_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` may be called from a Server Component where mutating
          // cookies is not allowed. Middleware refreshes the session instead.
        }
      },
    },
  });
}
