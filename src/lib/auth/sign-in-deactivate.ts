/**
 * sign-in-deactivate.ts - Phase 5 (G-54, owner D71 "yes."). Deactivate a
 * back-office sign-in from somewhere other than the Users page (Terminate on
 * the employee file), with EXACTLY the rules Users -> Deactivate enforces
 * (`users/actions.ts` setUserActive): the four guard rails in
 * user-guards-core.ts (not yourself, not someone ranked above you, never the
 * last active owner), staff_profiles.active = false, then the permanent
 * sign-in ban, then a `user.deactivate` audit row with before/after. Refusals
 * are audited as `user.deactivate.blocked` too, like the Users page.
 *
 * Writes staff_profiles only - never employees (books-87).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { guardActiveChange, BAN_PERMANENT } from "@/lib/auth/user-guards-core";
import type { StaffRole } from "@/lib/supabase/types";

export type DeactivateResult =
  | { kind: "already_inactive"; email: string }
  | { kind: "deactivated"; email: string; banOk: boolean }
  | { kind: "refused"; email: string; reason: string }
  | { kind: "failed"; email: string; error: string };

export async function deactivateSignIn(input: {
  actorId: string;
  actorEmail: string | null;
  actorRole: StaffRole;
  targetId: string;
  /** Where the request came from, kept on the audit row (e.g. "terminate:<employeeId>"). */
  via: string;
}): Promise<DeactivateResult> {
  if (!isSupabaseServiceConfigured) return { kind: "failed", email: "", error: "Database not configured" };
  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("staff_profiles")
    .select("role, email, active")
    .eq("id", input.targetId)
    .maybeSingle();
  if (!target) return { kind: "failed", email: "", error: "that sign-in no longer exists" };
  const email = String((target as { email?: string }).email ?? "");
  if (!(target as { active?: boolean }).active) return { kind: "already_inactive", email };

  const { count } = await admin
    .from("staff_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("active", true);

  const guard = guardActiveChange({
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: input.targetId,
    targetRole: (target as { role: StaffRole }).role,
    targetActive: true,
    nextActive: false,
    activeOwnerCount: count ?? 0,
  });
  if (!guard.ok) {
    await recordAudit({
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      action: "user.deactivate.blocked",
      entityType: "staff_profile",
      entityId: input.targetId,
      after: { attempted_active: false, reason: guard.reason, via: input.via },
    });
    return { kind: "refused", email, reason: guard.reason };
  }

  const { error } = await admin.from("staff_profiles").update({ active: false }).eq("id", input.targetId);
  if (error) return { kind: "failed", email, error: error.message };

  let banOk = true;
  const { error: banError } = await admin.auth.admin.updateUserById(input.targetId, { ban_duration: BAN_PERMANENT });
  if (banError) banOk = false;

  await recordAudit({
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: "user.deactivate",
    entityType: "staff_profile",
    entityId: input.targetId,
    before: { active: true },
    after: { active: false, auth_ban: "applied", ban_ok: banOk, via: input.via },
  });
  return { kind: "deactivated", email, banOk };
}
