// Server-side Supabase client bound to the request's auth cookies.
// Use in Server Components, Route Handlers, and Server Actions.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
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
