"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { enrollCustomer, adjustPoints, issueRedemption } from "@/lib/loyalty/loyalty-store";

function intFromForm(form: FormData, key: string): number {
  const raw = String(form.get(key) ?? "").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function enrollCustomerAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const customerId = String(form.get("customer_id") ?? "").trim();
  if (!customerId) return;
  const res = await enrollCustomer(customerId, session.userId);
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.enroll",
      entityType: "loyalty_account",
      entityId: res.account.id,
    });
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function adjustPointsAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const accountId = String(form.get("account_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  const points = intFromForm(form, "points");
  const note = String(form.get("note") ?? "").trim() || "Manual adjustment";
  if (!accountId || points === 0) return;
  const res = await adjustPoints({ accountId, points, note, actorId: session.userId });
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.adjust",
      entityType: "loyalty_account",
      entityId: accountId,
      after: { points, note },
    });
  }
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

export async function issueRedemptionAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const accountId = String(form.get("account_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  const points = intFromForm(form, "points");
  const channelRaw = String(form.get("channel") ?? "both").trim();
  const channel = (["sms", "email", "both"].includes(channelRaw) ? channelRaw : "both") as
    | "sms"
    | "email"
    | "both";
  if (!accountId || points <= 0) return;
  const res = await issueRedemption({ accountId, points, channel, actorId: session.userId });
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.redeem",
      entityType: "loyalty_account",
      entityId: accountId,
      after: { points, code: res.code, valueMinor: res.valueMinor },
    });
  }
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}
