"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  createVendorReturn,
  scheduleDestruction,
  completeDestruction,
  cancelDestruction,
  updateSampleSettings,
  VENDOR_RETURN_REASONS,
  DESTRUCTION_REASONS,
} from "@/lib/inventory/disposition";

const RET = new Set<string>(VENDOR_RETURN_REASONS);
const DES = new Set<string>(DESTRUCTION_REASONS);

const BASE = "/admin/inventory/disposition";

export async function createVendorReturnAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = (formData.get("lot_id") as string | null)?.trim() ?? "";
  const reason = (formData.get("reason") as string | null)?.trim() ?? "other";
  const detail = (formData.get("detail") as string | null)?.trim() || null;
  const rma = (formData.get("rma_number") as string | null)?.trim() || null;
  const qty = Number(formData.get("quantity"));
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=qty`);
  if (!RET.has(reason)) redirect(`${BASE}?error=reason`);

  const result = await createVendorReturn(
    { lotId, quantity: qty, reason, detail, rmaNumber: rma },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.create",
    entityType: "vendor_returns",
    entityId: result.id,
    after: { lot_id: lotId, quantity: qty, reason },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=returned`);
}

export async function scheduleDestructionAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = (formData.get("lot_id") as string | null)?.trim() ?? "";
  const reason = (formData.get("reason") as string | null)?.trim() ?? "other";
  const detail = (formData.get("detail") as string | null)?.trim() || null;
  const qty = Number(formData.get("quantity"));
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=qty`);
  if (!DES.has(reason)) redirect(`${BASE}?error=reason`);

  const result = await scheduleDestruction({ lotId, quantity: qty, reason, detail }, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "destruction.schedule",
    entityType: "destruction_events",
    entityId: result.id,
    after: { lot_id: lotId, quantity: qty, reason },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=scheduled`);
}

export async function completeDestructionAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const method = (formData.get("method") as string | null)?.trim() || null;
  const witnessedBy = (formData.get("witnessed_by") as string | null)?.trim() || null;

  const result = await completeDestruction({ id, method, witnessedBy }, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "destruction.complete",
    entityType: "destruction_events",
    entityId: id,
    after: { method, witnessed_by: witnessedBy },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=destroyed`);
}

export async function cancelDestructionAction(id: string) {
  const session = await requirePermission("inventory.manage");
  const result = await cancelDestruction(id, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "destruction.cancel",
    entityType: "destruction_events",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=cancelled`);
}

export async function updateSampleSettingsAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  if (!can(session.profile.role, "settings.manage")) {
    redirect(`${BASE}?error=${encodeURIComponent("Changing sample settings requires admin.")}`);
  }
  const dollars = Number(formData.get("nominal_price_dollars"));
  const nominalPriceMinor = Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 1;
  const requireNominalPrice = formData.get("require_nominal_price") === "on";
  const blockPublicSale = formData.get("block_public_sale") === "on";

  const result = await updateSampleSettings(
    { nominalPriceMinor, requireNominalPrice, blockPublicSale },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "sample_settings.update",
    entityType: "sample_settings",
    entityId: "singleton",
    after: { nominalPriceMinor, requireNominalPrice, blockPublicSale },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=samples`);
}
