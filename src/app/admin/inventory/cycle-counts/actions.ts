"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createCycleCount,
  recordLineCount,
  applyCycleCount,
  cancelCycleCount,
} from "@/lib/inventory/cycle-counts";

export async function createCycleCountAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const label = (formData.get("label") as string | null)?.trim() ?? "";
  const scopeNote = (formData.get("scope_note") as string | null)?.trim() || null;
  if (!label) redirect("/admin/inventory/cycle-counts?error=label");

  const result = await createCycleCount({ label, scopeNote }, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.create",
    entityType: "cycle_counts",
    entityId: result.id,
    after: { label },
  });
  revalidatePath("/admin/inventory/cycle-counts");
  redirect(`/admin/inventory/cycle-counts/${result.id}`);
}

export async function recordLineCountAction(countId: string, lineId: string, formData: FormData) {
  await requirePermission("inventory.manage");
  const raw = formData.get("counted_qty");
  const note = (formData.get("note") as string | null)?.trim() || null;
  const countedQty = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(countedQty) || countedQty < 0) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=qty`);
  }
  const result = await recordLineCount({ lineId, countedQty, note });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/admin/inventory/cycle-counts/${countId}?ok=counted`);
}

export async function applyCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await applyCycleCount(countId, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.apply",
    entityType: "cycle_counts",
    entityId: countId,
    after: { adjustments_posted: result.applied },
  });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  revalidatePath("/admin/inventory");
  redirect(`/admin/inventory/cycle-counts/${countId}?ok=applied`);
}

export async function cancelCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await cancelCycleCount(countId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.cancel",
    entityType: "cycle_counts",
    entityId: countId,
  });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  redirect("/admin/inventory/cycle-counts?ok=cancelled");
}
