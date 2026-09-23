// Refreshes the Supabase auth session cookie on admin routes so Server
// Components always see a valid session. Page-level guards (requireStaff)
// enforce actual access; this only keeps the session fresh.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_GLOBAL_OPTIONS } from "@/lib/supabase/fetch-floor";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // SLICE L-27 — the middleware builds its OWN client, so it needs the
    // floor spelled out here too; it does not inherit the one in
    // `lib/supabase/server.ts`.
    //
    // This matters more here than almost anywhere else: middleware runs
    // BEFORE the page or server action on every `/admin/*` request, and it
    // performs the same unbounded `auth.getUser()`. A stall here hangs the
    // request before any route code exists to be bounded — the earliest
    // possible version of the acknowledge hang. See `fetch-floor.ts`.
    global: SUPABASE_GLOBAL_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touch the session so it refreshes if needed.
  //
  // SLICE L-27 — swallowed deliberately, and only now that it is BOUNDED.
  //
  // Before this slice the call could not fail fast; it could only hang, so
  // there was nothing to catch. Now that the transport floor aborts it at
  // 20s, it can reject — and an unhandled rejection in middleware fails the
  // request for EVERY `/admin/*` route, turning a slow auth server into a
  // total blackout of the back office.
  //
  // Swallowing is the correct posture because of what this line is FOR: the
  // comment above is accurate, it only refreshes the session cookie
  // opportunistically. It is not a guard. Access is enforced downstream by
  // `requireStaff()` / `requirePermission()` on the page itself, which
  // redirect to the login screen when there is no session. So if the refresh
  // does not happen, the worst case is that the operator is asked to sign in
  // again — a page with a sentence on it, rather than a 500 or a spinner.
  await supabase.auth.getUser().catch(() => undefined);

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
