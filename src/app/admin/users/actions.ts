"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/session";
import { resolveSiteBase } from "@/lib/auth/set-password-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import {
  guardRoleChange,
  guardActiveChange,
  guardGrantRole,
  isKnownRole,
  BAN_PERMANENT,
  BAN_LIFT,
} from "@/lib/auth/user-guards-core";
import type { StaffRole } from "@/lib/supabase/types";

const BASE = "/admin/users";

function bounce(kind: "error" | "ok", message: string): never {
  revalidatePath(BASE);
  redirect(`${BASE}?${kind}=${encodeURIComponent(message)}`);
}

async function countActiveOwners(): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("staff_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("active", true);
  return count ?? 0;
}

/**
 * Task S-c: every guard here is enforced server-side via the pure core in
 * user-guards-core.ts (self-rule, rank rule, privilege ceiling, last-owner
 * rule) and every outcome — including refusals — is surfaced in the UI and
 * written to the audit log. Silent returns are gone.
 */
export async function updateUserRole(formData: FormData): Promise<void> {
  const session = await requirePermission("users.manage");

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId) bounce("error", "Missing user id.");
  if (!isKnownRole(role)) bounce("error", "Unknown role.");
  const newRole = role as StaffRole;

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("staff_profiles")
    .select("role, email, active")
    .eq("id", userId)
    .maybeSingle();
  if (!target) bounce("error", "That user no longer exists.");

  const guard = guardRoleChange({
    actorId: session.userId,
    actorRole: session.profile.role,
    targetId: userId,
    targetRole: target.role as StaffRole,
    targetActive: Boolean(target.active),
    newRole,
    activeOwnerCount: await countActiveOwners(),
  });
  if (!guard.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "user.role.update.blocked",
      entityType: "staff_profile",
      entityId: userId,
      before: { role: target.role },
      after: { attempted_role: newRole, reason: guard.reason },
    });
    bounce("error", guard.reason);
  }

  if (target.role === newRole) bounce("ok", "No change — they already have that role.");

  const { error } = await admin.from("staff_profiles").update({ role: newRole }).eq("id", userId);
  if (error) bounce("error", error.message);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "user.role.update",
    entityType: "staff_profile",
    entityId: userId,
    before: { role: target.role },
    after: { role: newRole },
  });

  bounce("ok", `${target.email ?? "User"} is now ${newRole}.`);
}

export async function setUserActive(formData: FormData): Promise<void> {
  const session = await requirePermission("users.manage");

  const userId = String(formData.get("userId") ?? "");
  const nextActive = String(formData.get("active") ?? "") === "true";
  if (!userId) bounce("error", "Missing user id.");

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("staff_profiles")
    .select("role, email, active")
    .eq("id", userId)
    .maybeSingle();
  if (!target) bounce("error", "That user no longer exists.");

  const guard = guardActiveChange({
    actorId: session.userId,
    actorRole: session.profile.role,
    targetId: userId,
    targetRole: target.role as StaffRole,
    targetActive: Boolean(target.active),
    nextActive,
    activeOwnerCount: await countActiveOwners(),
  });
  if (!guard.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: nextActive ? "user.activate.blocked" : "user.deactivate.blocked",
      entityType: "staff_profile",
      entityId: userId,
      after: { attempted_active: nextActive, reason: guard.reason },
    });
    bounce("error", guard.reason);
  }

  const { error } = await admin
    .from("staff_profiles")
    .update({ active: nextActive })
    .eq("id", userId);
  if (error) bounce("error", error.message);

  // Auth-layer enforcement, verified against @supabase/auth-js:
  //  - deactivate → permanent ban (blocks new sign-ins AND token refresh);
  //  - reactivate → lift the ban.
  // The admin panel itself locks them out on the very next request either way,
  // because getStaffSession() re-reads profile.active every time and RLS's
  // is_staff() requires active=true — the ban is defense-in-depth so even the
  // raw Supabase APIs go dark for them.
  let banApplied = true;
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: nextActive ? BAN_LIFT : BAN_PERMANENT,
  });
  if (banError) banApplied = false;

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: nextActive ? "user.activate" : "user.deactivate",
    entityType: "staff_profile",
    entityId: userId,
    before: { active: target.active },
    after: { active: nextActive, auth_ban: nextActive ? "lifted" : "applied", ban_ok: banApplied },
  });

  if (nextActive) {
    bounce(
      "ok",
      banApplied
        ? `${target.email ?? "User"} reactivated — they can sign in again.`
        : `${target.email ?? "User"} reactivated, but lifting the sign-in ban failed — check Supabase Auth.`,
    );
  }
  bounce(
    "ok",
    banApplied
      ? `${target.email ?? "User"} deactivated — access is cut off and sign-in is banned. If you're letting them go, run the offboarding checklist on their employee file too.`
      : `${target.email ?? "User"} deactivated — the back office is locked for them, but the auth ban failed; check Supabase Auth.`,
  );
}

export async function inviteUser(formData: FormData): Promise<void> {
  const session = await requirePermission("users.manage");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "readonly");
  if (!email || !email.includes("@")) bounce("error", "Enter a valid email address.");
  if (!isKnownRole(role)) bounce("error", "Unknown role.");
  const newRole = role as StaffRole;

  // Privilege ceiling applies to invites too: an admin cannot mint an owner.
  const grant = guardGrantRole(session.profile.role, newRole);
  if (!grant.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "user.invite.blocked",
      entityType: "staff_profile",
      entityId: email,
      after: { attempted_role: newRole, reason: grant.reason },
    });
    bounce("error", grant.reason);
  }

  // GW-017: point the invite email at the set-password page. Invite links use
  // Supabase's legacy token flow (PKCE unsupported for invites), so the tokens
  // arrive in the URL fragment — the set-password page is a client page that
  // reads the fragment, establishes the session, and lets the invitee choose
  // a password. Without redirectTo, the link lands on the dashboard Site URL
  // where the PKCE-only browser client can't finish the sign-in.
  const hdrs = await headers();
  const siteBase = resolveSiteBase({
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedProto: hdrs.get("x-forwarded-proto"),
    forwardedHost: hdrs.get("x-forwarded-host"),
    host: hdrs.get("host"),
  });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(
    email,
    siteBase ? { redirectTo: `${siteBase}/admin/account/set-password` } : {},
  );
  if (error || !data?.user) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "user.invite.failed",
      entityType: "staff_profile",
      entityId: email,
      after: { error: error?.message },
    });
    bounce("error", error?.message ?? "Invite failed — check the email and try again.");
  }

  const { error: upsertError } = await admin
    .from("staff_profiles")
    .upsert({ id: data.user.id, email, role: newRole, active: true }, { onConflict: "id" });
  if (upsertError) bounce("error", upsertError.message);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "user.invite",
    entityType: "staff_profile",
    entityId: data.user.id,
    after: { email, role: newRole },
  });

  bounce("ok", `Invite sent to ${email} as ${newRole}. They'll get an email to set a password.`);
}
