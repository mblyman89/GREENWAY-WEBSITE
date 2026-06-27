"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { ALL_ROLES } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

export async function updateUserRole(formData: FormData) {
  const session = await requirePermission("users.manage");

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as StaffRole;
  if (!userId || !ALL_ROLES.includes(role)) return;

  // Prevent the last owner from accidentally demoting themselves into lockout.
  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("staff_profiles")
    .select("role, email, active")
    .eq("id", userId)
    .maybeSingle();

  if (before?.role === "owner" && role !== "owner") {
    const { count } = await admin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("active", true);
    if ((count ?? 0) <= 1) return; // refuse to remove the last owner
  }

  await admin.from("staff_profiles").update({ role }).eq("id", userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "user.role.update",
    entityType: "staff_profile",
    entityId: userId,
    before: { role: before?.role },
    after: { role },
  });

  revalidatePath("/admin/users");
}

export async function setUserActive(formData: FormData) {
  const session = await requirePermission("users.manage");

  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!userId) return;

  const admin = createSupabaseAdminClient();
  const { data: before } = await admin
    .from("staff_profiles")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();

  // Don't deactivate the last active owner.
  if (before?.role === "owner" && !active) {
    const { count } = await admin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("active", true);
    if ((count ?? 0) <= 1) return;
  }

  await admin.from("staff_profiles").update({ active }).eq("id", userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: active ? "user.activate" : "user.deactivate",
    entityType: "staff_profile",
    entityId: userId,
    before: { active: before?.active },
    after: { active },
  });

  revalidatePath("/admin/users");
}

export async function inviteUser(formData: FormData) {
  const session = await requirePermission("users.manage");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "readonly") as StaffRole;
  if (!email || !ALL_ROLES.includes(role)) return;

  const admin = createSupabaseAdminClient();

  // Invite via email; the trigger creates the staff_profile on signup, then we
  // set the requested role.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error || !data?.user) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "user.invite.failed",
      entityType: "staff_profile",
      entityId: email,
      after: { error: error?.message },
    });
    return;
  }

  await admin
    .from("staff_profiles")
    .upsert(
      { id: data.user.id, email, role, active: true },
      { onConflict: "id" },
    );

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "user.invite",
    entityType: "staff_profile",
    entityId: data.user.id,
    after: { email, role },
  });

  revalidatePath("/admin/users");
}
