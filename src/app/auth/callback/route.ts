/**
 * src/app/auth/callback/route.ts
 *
 * The auth callback that finishes a Supabase sign-in started by a magic link,
 * one-time code email, or password-reset email. Without this route the link in
 * the email lands on /admin with no session, so the middleware bounces the user
 * straight back to the login page (the "login loop").
 *
 * Supports BOTH flows the Supabase email templates can use:
 *   1. PKCE / code flow      -> ?code=...        -> exchangeCodeForSession()
 *   2. Token-hash OTP flow   -> ?token_hash=...&type=...  -> verifyOtp()
 *
 * On success we set the auth cookies on the redirect response and send the user
 * to `next` (default /admin). On failure we return to the login page with a
 * readable error.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

function safeNext(raw: string | null): string {
  // Only allow same-origin relative paths to avoid open-redirects.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin";
  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  // Build the redirect response up front so the Supabase client can write the
  // session cookies onto it.
  const redirectTo = new URL(next, url.origin);
  const response = NextResponse.redirect(redirectTo);

  if (!supabaseUrl || !supabaseAnonKey) {
    const fail = new URL("/admin/login", url.origin);
    fail.searchParams.set("error", "Supabase is not configured.");
    return NextResponse.redirect(fail);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let errorMessage: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) errorMessage = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) errorMessage = error.message;
  } else {
    errorMessage = "Invalid or expired sign-in link. Please request a new one.";
  }

  if (errorMessage) {
    const fail = new URL("/admin/login", url.origin);
    fail.searchParams.set("error", errorMessage);
    return NextResponse.redirect(fail);
  }

  return response;
}
