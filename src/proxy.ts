// Refreshes the Supabase auth session cookie on admin routes so Server
// Components always see a valid session. Page-level guards (requireStaff)
// enforce actual access; this only keeps the session fresh.
//
// PERF-S1 — renamed from `middleware.ts` to `proxy.ts`. Next 16 deprecates the
// `middleware` file convention (node_modules/next/dist/docs/01-app/02-guides/
// upgrading/version-16.md, "middleware to proxy": "mv middleware.ts proxy.ts").
// Proxy always runs on the Node.js runtime.
//
// PERF-S1 — `getClaims()` instead of `getUser()`. `getUser()` ALWAYS makes a
// network round trip to Supabase Auth; this ran on every /admin request. The
// Supabase SSR guide for Next.js (docs/guides/auth/server-side/nextjs) uses
// `getClaims()` in proxy: it refreshes the token when close to expiry and, on
// projects with asymmetric JWT signing keys, verifies locally against a cached
// JWKS. On a legacy symmetric secret it falls back to an Auth call, so it is
// never slower than before.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_GLOBAL_OPTIONS } from "@/lib/supabase/fetch-floor";

// PERF2-P5: same key order as src/lib/supabase/env.ts (new publishable key
// first, legacy anon JWT as the fallback). Kept literal for Next inlining.
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  ""
);

export async function proxy(request: NextRequest) {
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
    // performs the same unbounded auth call (now `auth.getClaims()`). A stall here hangs the
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
  await supabase.auth.getClaims().catch(() => undefined);

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
