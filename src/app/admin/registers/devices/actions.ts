"use server";

/**
 * POS device provisioning actions (Slice B5). Manager-gated
 * (staffing.manage — the same bar as employee/PIN management): provisioning a
 * device mints a credential that can ring sales, so floor staff cannot do it.
 * The plaintext key is returned ONCE to the page for display; only its scrypt
 * hash is stored (device-store).
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  provisionDevice,
  rotateDeviceKey,
  revokeDevice,
  bindDeviceToRegister,
  renameDevice,
  reactivateDevice,
} from "@/lib/pos/device-store";
import { isRevokeConfirmed, REVOKE_CONFIRM_WORD } from "@/lib/pos/device-pairing-core";

const BASE = "/admin/registers/devices";

export type ProvisionActionResult =
  | { ok: true; deviceId: string; deviceKey: string }
  | { ok: false; error: string };

export async function provisionDeviceAction(
  _prev: ProvisionActionResult | null,
  formData: FormData,
): Promise<ProvisionActionResult> {
  const session = await requirePermission("staffing.manage");
  const name = String(formData.get("name") ?? "").trim();
  const registerId = String(formData.get("register_id") ?? "").trim() || null;
  const result = await provisionDevice({
    name,
    registerId,
    createdBy: session.profile.id,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos_device.provisioned",
    entityType: "pos_device",
    entityId: result.deviceId,
    after: { name, registerId },
  });
  revalidatePath(BASE);
  return { ok: true, deviceId: result.deviceId, deviceKey: result.deviceKey };
}

export async function rotateDeviceKeyAction(
  _prev: ProvisionActionResult | null,
  formData: FormData,
): Promise<ProvisionActionResult> {
  const session = await requirePermission("staffing.manage");
  const deviceId = String(formData.get("device_id") ?? "").trim();
  if (!deviceId) return { ok: false, error: "Missing device." };
  const result = await rotateDeviceKey(deviceId);
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos_device.key_rotated",
    entityType: "pos_device",
    entityId: deviceId,
  });
  revalidatePath(BASE);
  return { ok: true, deviceId, deviceKey: result.deviceKey };
}

export type SimpleActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Revoke a device. Two-step on purpose (register rotation slice): the manager
 * must type the confirm word, checked HERE on the server, so a stray click in
 * the back office can never take a live till out of service.
 */
export async function revokeDeviceAction(
  _prev: SimpleActionResult | null,
  formData: FormData,
): Promise<SimpleActionResult> {
  const session = await requirePermission("staffing.manage");
  const deviceId = String(formData.get("device_id") ?? "").trim();
  if (!deviceId) return { ok: false, error: "Missing device." };
  if (!isRevokeConfirmed(formData.get("confirm"))) {
    return { ok: false, error: `Type ${REVOKE_CONFIRM_WORD} to confirm.` };
  }
  const result = await revokeDevice(deviceId);
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos_device.revoked",
    entityType: "pos_device",
    entityId: deviceId,
  });
  revalidatePath(BASE);
  return { ok: true, message: "Revoked. The iPad shows a re-pair screen on its next check (within about a minute)." };
}

/** Rename a device (active or revoked). The iPad picks it up on its next heartbeat. */
export async function renameDeviceAction(
  _prev: SimpleActionResult | null,
  formData: FormData,
): Promise<SimpleActionResult> {
  const session = await requirePermission("staffing.manage");
  const deviceId = String(formData.get("device_id") ?? "").trim();
  if (!deviceId) return { ok: false, error: "Missing device." };
  const result = await renameDevice(deviceId, String(formData.get("name") ?? ""));
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos_device.renamed",
    entityType: "pos_device",
    entityId: deviceId,
    after: { name: result.name },
  });
  revalidatePath(BASE);
  return { ok: true, message: "Renamed." };
}

/**
 * Reactivate a REVOKED device with a brand-new key (shown once). The old key
 * stays dead. Used to bring a retired iPad back, or to let unsynced sales
 * still held on a retired iPad sync under their original device id.
 */
export async function reactivateDeviceAction(
  _prev: ProvisionActionResult | null,
  formData: FormData,
): Promise<ProvisionActionResult> {
  const session = await requirePermission("staffing.manage");
  const deviceId = String(formData.get("device_id") ?? "").trim();
  if (!deviceId) return { ok: false, error: "Missing device." };
  const result = await reactivateDevice(deviceId);
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos_device.reactivated",
    entityType: "pos_device",
    entityId: deviceId,
  });
  revalidatePath(BASE);
  return { ok: true, deviceId, deviceKey: result.deviceKey };
}

export async function bindDeviceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const deviceId = String(formData.get("device_id") ?? "").trim();
  const registerId = String(formData.get("register_id") ?? "").trim() || null;
  if (!deviceId) return;
  const result = await bindDeviceToRegister(deviceId, registerId);
  if (result.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "pos_device.register_bound",
      entityType: "pos_device",
      entityId: deviceId,
      after: { registerId },
    });
  }
  revalidatePath(BASE);
}
