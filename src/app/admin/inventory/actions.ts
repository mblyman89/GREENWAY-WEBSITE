"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createAdjustment, updateLotStatus } from "@/lib/inventory/store";

const VALID_REASONS = new Set([
  "receive",
  "shrink",
  "damage",
  "sample",
  "destruction",
  "count",
  "recall",
  "other",
]);

const VALID_STATUSES = new Set([
  "active",
  "quarantine",
  "recalled",
  "sold_out",
  "destroyed",
]);

export async function adjustLotAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const rawQty = formData.get("qty_delta");
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  const note = (formData.get("note") as string | null)?.trim() || null;

  const qtyDelta = typeof rawQty === "string" ? Number(rawQty) : NaN;
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    redirect(`/admin/inventory/${lotId}?error=qty`);
  }
  if (!VALID_REASONS.has(reason)) {
    redirect(`/admin/inventory/${lotId}?error=reason`);
  }

  const result = await createAdjustment(
    { lotId, qtyDelta, reason, note },
    session.userId,
  );
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=save`);
  }
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

export async function setLotStatusAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const status = (formData.get("status") as string | null)?.trim() ?? "";
  if (!VALID_STATUSES.has(status)) {
    redirect(`/admin/inventory/${lotId}?error=status`);
  }
  const result = await updateLotStatus(lotId, status, session.userId);
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=save`);
  }
  redirect(`/admin/inventory/${lotId}?saved=1`);
}
