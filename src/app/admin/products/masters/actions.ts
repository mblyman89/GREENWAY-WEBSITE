"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateGroupingSuggestions,
  acceptSuggestion,
  rejectSuggestion,
  setMasterStatus,
  removeMember,
  deleteMaster,
  AiNotConfiguredError,
} from "@/lib/products/masters-store";

const BASE = "/admin/products/masters";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Generate fresh DRAFT grouping suggestions from the live menu. */
export async function generateSuggestions(): Promise<void> {
  const session = await requirePermission("inventory.manage");
  try {
    const result = await generateGroupingSuggestions({ generatedBy: session.userId });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product_master.suggestions_generated",
      entityType: "product_master_suggestion",
      entityId: null,
    });
    revalidatePath(BASE);
    redirect(`${BASE}?tab=suggestions&generated=${result.created}&clusters=${result.clustersConsidered}`);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      // Deterministic suggestions still ran; AI just didn't. Re-run without AI is
      // already covered inside the service (it handles unconfigured AI), so this
      // branch only triggers if the whole call threw — surface a soft message.
      redirect(`${BASE}?tab=suggestions&error=` + encodeURIComponent("AI is not configured; only exact-name matches were suggested."));
    }
    throw err;
  }
}

export async function acceptSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?tab=suggestions&error=` + encodeURIComponent("Missing id."));
  const result = await acceptSuggestion(id, session.userId);
  if ("error" in result) {
    redirect(`${BASE}?tab=suggestions&error=` + encodeURIComponent(result.error));
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.suggestion_accepted",
    entityType: "product_master",
    entityId: result.masterId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${result.masterId}?accepted=1`);
}

export async function rejectSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?tab=suggestions&error=` + encodeURIComponent("Missing id."));
  await rejectSuggestion(id, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.suggestion_rejected",
    entityType: "product_master_suggestion",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?tab=suggestions&rejected=1`);
}

/** Create a master manually (empty, ready for members). */
export async function createMasterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const display = str(formData, "display_name");
  if (!display) redirect(`${BASE}?error=` + encodeURIComponent("A name is required."));
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("product_masters")
    .insert({
      display_name: display,
      brand_name: str(formData, "brand_name") || null,
      category: str(formData, "category") || null,
      status: "draft",
      created_origin: "manual",
      created_by: session.userId,
      updated_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) redirect(`${BASE}?error=` + encodeURIComponent(error?.message ?? "Failed."));
  const id = (data as { id: string }).id;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.created",
    entityType: "product_master",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?created=1`);
}

export async function updateMasterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing id."));
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("product_masters")
    .update({
      display_name: str(formData, "display_name"),
      brand_name: str(formData, "brand_name") || null,
      category: str(formData, "category") || null,
      strain_name: str(formData, "strain_name") || null,
      notes: str(formData, "notes") || null,
      updated_by: session.userId,
    })
    .eq("id", id);
  if (error) redirect(`${BASE}/${id}?error=` + encodeURIComponent(error.message));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.updated",
    entityType: "product_master",
    entityId: id,
  });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}?saved=1`);
}

export async function publishMasterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !["draft", "published", "archived"].includes(status)) {
    redirect(`${BASE}?error=` + encodeURIComponent("Bad request."));
  }
  await setMasterStatus(id, status as "draft" | "published" | "archived", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `product_master.${status}`,
    entityType: "product_master",
    entityId: id,
  });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}?saved=1`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const memberId = str(formData, "member_id");
  const masterId = str(formData, "master_id");
  if (!memberId) redirect(`${BASE}/${masterId}?error=` + encodeURIComponent("Missing member id."));
  await removeMember(memberId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.member_removed",
    entityType: "product_master",
    entityId: masterId,
  });
  revalidatePath(`${BASE}/${masterId}`);
  redirect(`${BASE}/${masterId}?saved=1`);
}

export async function deleteMasterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing id."));
  await deleteMaster(id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_master.deleted",
    entityType: "product_master",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?deleted=1`);
}
