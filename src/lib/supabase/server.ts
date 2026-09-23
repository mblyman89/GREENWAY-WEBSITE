// Server-side Supabase client bound to the request's auth cookies.
// Use in Server Components, Route Handlers, and Server Actions.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";
import { SUPABASE_DB_OPTIONS } from "./db-floor";

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
