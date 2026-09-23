// Server-side helpers to load the current staff session + enforce access.
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bootstrapAdminEmails, isSupabaseConfigured, isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { queryDeadline, SESSION_READ_TIMEOUT_MS } from "@/lib/supabase/query-deadline";
import type { StaffProfile } from "@/lib/supabase/types";
import { can, type Permission } from "./roles";

export type StaffSession = {
  userId: string;
  email: string;
  profile: StaffProfile;
};

/**
 * Returns the current staff session, or null if not authenticated / not staff.
 * Also performs first-login bootstrap: promotes configured bootstrap emails to
 * "owner" and stamps last_login_at.
 */
/**
 * SLICE L-27 — how "we could not check" travels without widening the guard.
 *
 * A module-level `let` would be shared between every concurrent request on the
 * same server instance, which is how one budtender ends up seeing another's
 * error. `cache()` from React is per-REQUEST in the App Router: the same
 * mutable box is returned for every call within one render or action, and a
 * different one for the next request. That gives exactly the scope this needs.
 */
const authFailureBox = cache((): { failed: boolean } => ({ failed: false }));

/**
 * Did the auth check FAIL (as opposed to simply finding nobody signed in)
 * during this request?
 *
 * Read by the login page so it can tell an operator whose session is fine that
 * the problem is ours, not their password. Deliberately NOT consulted by any
 * access guard — see the note inside `getStaffSession`.
 */
export function authCheckUnavailable(): boolean {
  return authFailureBox().failed;
}

export async function getStaffSession(): Promise<StaffSession | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();

  // ── SLICE L-27 — THE LINE THE ACKNOWLEDGE BUTTON WAS HANGING ON ──────────
  //
  // `auth.getUser()` is not a PostgREST request, so L-26's `db: { timeout }`
  // floor never covered it, and `auth-js` issues it with no `signal` of any
  // kind. It is also the FIRST await of `requirePermission`, which is the
  // FIRST statement of `acknowledgeLeaflyOrderAction` — upstream of L-25's
  // 240s action deadline, so that race was never even armed. An unreachable
  // auth server therefore parked the request until Vercel killed it at
  // `maxDuration = 300`: the owner's "spun for 5 minutes then quit".
  //
  // The transport floor in `lib/supabase/fetch-floor.ts` now aborts it at
  // 20s. That converts a hang into a THROW, which must be handled here or it
  // becomes a 500 on every page in the back office.
  //
  // ── WHY THE FAILURE IS DISTINGUISHED FROM "NOT SIGNED IN" ────────────────
  // Returning plain `null` would be the smallest change and the wrong one. It
  // means "this person is not staff", and the caller acts on that by sending
  // them to the login screen — where a budtender who IS signed in would type
  // correct credentials, succeed, and land back on a page that fails the same
  // way. The screen would be blaming them for an outage.
  //
  // ── WHY THIS FUNCTION'S SIGNATURE DOES NOT CHANGE ────────────────────────
  // The obvious move is to widen the return type to
  // `StaffSession | null | { unavailable: true }`. It was rejected, and the
  // reason is a security one worth writing down.
  //
  // There are 26 call sites, and the overwhelmingly common shape is
  // `const session = await getStaffSession(); if (session) { ...allow... }`.
  // A returned OBJECT is truthy. Widening the type would silently flip every
  // one of those guards to ALLOW on an auth outage — turning an availability
  // bug into an authentication bypass across the entire back office. The
  // compiler would not have caught the ones that only test truthiness.
  //
  // So the failure stays `null` here: unverified is unverified, and the fail
  // CLOSED behaviour is preserved exactly. The distinction between "not
  // signed in" and "we could not check" is carried separately, by
  // `authCheckUnavailable()` above, which the login screen uses to explain
  // itself without any guard ever depending on it.
  let user: { id: string; email?: string | null } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    authFailureBox().failed = true;
    return null;
  }
  if (!user) return null;

  let { data: profile } = await supabase
    .from("staff_profiles")
    .select("*")
    .eq("id", user.id)
    // SLICE L-25. Bounded. This is the single most-executed query in the
    // product — every page render and every server action resolves the
    // session before it does anything else. If it stalls, the request hangs
    // before reaching any feature code, so no feature-level deadline can
    // rescue it and the spinner never stops.
    .abortSignal(queryDeadline(SESSION_READ_TIMEOUT_MS))
    .maybeSingle<StaffProfile>();

  // Bootstrap: if this email is a configured owner and the profile isn't owner
  // yet (or is inactive), promote it using the service-role client.
  const email = (user.email ?? "").toLowerCase();
  const shouldBootstrap =
    isSupabaseServiceConfigured &&
    bootstrapAdminEmails.includes(email) &&
    (!profile || profile.role !== "owner" || !profile.active);

  if (shouldBootstrap) {
    try {
      const admin = createSupabaseAdminClient();
      await admin
        .from("staff_profiles")
        .upsert(
          {
            id: user.id,
            email: user.email ?? email,
            full_name: profile?.full_name ?? user.email ?? email,
            role: "owner",
            active: true,
          },
          { onConflict: "id" },
        )
        // SLICE L-25. Bounded. Bootstrap is best-effort (see the catch
        // below) but a best-effort write still must not block forever.
        .abortSignal(queryDeadline(SESSION_READ_TIMEOUT_MS));
      const { data: refreshed } = await admin
        .from("staff_profiles")
        .select("*")
        .eq("id", user.id)
        .abortSignal(queryDeadline(SESSION_READ_TIMEOUT_MS))
        .maybeSingle<StaffProfile>();
      if (refreshed) profile = refreshed;
    } catch {
      // bootstrap is best-effort
    }
  }

  if (!profile || !profile.active) return null;

  return { userId: user.id, email: user.email ?? email, profile };
}

/** Require an authenticated staff session or redirect to login. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** Require a specific permission or redirect to the admin home. */
export async function requirePermission(permission: Permission): Promise<StaffSession> {
  const session = await requireStaff();
  if (!can(session.profile.role, permission)) redirect("/admin?denied=1");
  return session;
}
