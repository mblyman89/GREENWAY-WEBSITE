"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseDenoms } from "@/lib/registers/cash";
import {
  openDrawer,
  closeDrawerBlind,
  recordDrop,
  reconcileDrawer,
  verifyTill,
} from "@/lib/registers/store";

const BASE = "/admin/registers";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function dollarsToMinor(raw: string): number {
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Open a drawer (count-in). Any active staff can count their own drawer. */
export async function openDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const registerId = str(formData, "register_id");
  const employeeId = str(formData, "employee_id") || null;
  const shiftId = str(formData, "shift_id") || null;
  if (!registerId) redirect(`${BASE}?error=` + encodeURIComponent("Missing register."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  const result = await openDrawer({ registerId, employeeId, shiftId, denoms });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.opened",
    entityType: "drawer_session",
    entityId: result.sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?opened=1`);
}

/** Record a cash drop. */
export async function recordDropAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const window = str(formData, "drop_window");
  const result = await recordDrop({
    sessionId,
    amountMinor: dollarsToMinor(str(formData, "amount")),
    window: (["afternoon", "night", "other"].includes(window) ? window : "other") as "afternoon" | "night" | "other",
    droppedBy: str(formData, "dropped_by") || null,
    witnessedBy: str(formData, "witnessed_by") || null,
    notes: str(formData, "notes") || null,
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.drop",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?dropped=1`);
}

/** Close a drawer (BLIND count-out). */
export async function closeDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const sessionId = str(formData, "session_id");
  const employeeId = str(formData, "employee_id") || null;
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  const result = await closeDrawerBlind({ sessionId, employeeId, denoms });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.closed_blind",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?closed=1`);
}

/** Reconcile (manager): reveal over/short. */
export async function reconcileDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const result = await reconcileDrawer({
    sessionId,
    cashSalesMinor: dollarsToMinor(str(formData, "cash_sales")),
    reconciledBy: str(formData, "reconciled_by") || null,
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.reconciled",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?reconciled=${result.overShortMinor ?? 0}`);
}

/** Manager till next-morning verify/validate. */
export async function verifyTillAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  const result = await verifyTill({
    sessionId,
    verifiedBy: str(formData, "verified_by") || null,
    denoms,
    agrees: formData.get("agrees") === "on" || formData.get("agrees") === "true",
    notes: str(formData, "notes") || null,
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "till.verified",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?verified=${result.varianceMinor ?? 0}`);
}
