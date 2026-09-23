// Server-side helpers to load the current staff session + enforce access.
import "server-only";
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
export async function getStaffSession(): Promise<StaffSession | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
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
