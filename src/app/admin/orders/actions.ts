"use server";

/**
 * Server actions for the Slice 7 order dashboard. Each mutating action checks
 * the staff permission, performs the change via the orders store, and records an
 * audit log entry. AI is not involved here — these are human-driven workflow
 * transitions.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { setOrderStatus, updateStaffNote } from "@/lib/orders/orders-store";
import type { OrderStatus } from "@/lib/orders/types";

const VALID_STATUSES: OrderStatus[] = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
];

function actorLabel(email: string, fullName: string | null): string {
  return fullName?.trim() ? `${fullName.trim()} (${email})` : email;
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const toStatus = String(formData.get("status") ?? "") as OrderStatus;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !VALID_STATUSES.includes(toStatus)) return;

  const updated = await setOrderStatus(id, toStatus, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
    note,
  });

  if (updated) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.status_changed",
      entityType: "order",
      entityId: id,
      after: { status: toStatus, order_number: updated.order_number, note },
    });
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

export async function updateOrderNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return;

  const ok = await updateStaffNote(id, note, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });

  if (ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.note_updated",
      entityType: "order",
      entityId: id,
      after: { note },
    });
  }

  revalidatePath(`/admin/orders/${id}`);
}
