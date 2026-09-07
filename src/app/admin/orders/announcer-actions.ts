"use server";

/**
 * src/app/admin/orders/announcer-actions.ts
 *
 * SLICE 30 — the buttons on the Announcer panel.
 *
 * Every action here is guarded by the same permission the receipt-printer
 * controls use (`settings.manage`) and audited the same way, so the announcer
 * is not a side door into shop configuration.
 *
 * All of them return void and revalidate the Orders page rather than returning
 * data, matching the existing form-action pattern on this screen.
 */
import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizeDeviceName, normalizeVolume } from "@/lib/announcer/announcer-core";
import {
  removeDevice,
  updateAnnouncerSettings,
  updateDevice,
} from "@/lib/announcer/announcer-admin-store";
import { enqueueAnnouncement } from "@/lib/announcer/announcer-enqueue";
import { createPairing } from "@/lib/announcer/announcer-store";

const ORDERS_PATH = "/admin/orders";

/** Read a single form field as a trimmed string. */
function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Play a sound on every speaker right now.
 *
 * This is the single most important button on the panel: it turns "I think it
 * works" into "I just heard it". It bypasses quiet hours on purpose — you press
 * Test precisely to check the speaker works at this moment.
 */
export async function announcerTestAllAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const result = await enqueueAnnouncement({
    orderId: null,
    orderNumber: null,
    isTest: true,
  });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.test",
    entityType: "announcer_queue",
    entityId: null,
    after: { summary: result.summary },
  });

  revalidatePath(ORDERS_PATH);
}

/** Turn one speaker on or off without unpairing it. */
export async function announcerToggleDeviceAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = field(form, "deviceId");
  if (!id) return;
  const enabled = field(form, "enabled") === "true";

  const result = await updateDevice({ id, enabled });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: enabled ? "announcer.device_enabled" : "announcer.device_disabled",
    entityType: "announcer_devices",
    entityId: id,
    after: { summary: result.message },
  });

  revalidatePath(ORDERS_PATH);
}

/** Rename a speaker, change its sound, or change its volume. */
export async function announcerUpdateDeviceAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = field(form, "deviceId");
  if (!id) return;

  const rawName = field(form, "name");
  const rawVolume = field(form, "volume");
  const rawSound = field(form, "soundId");

  const patch: Parameters<typeof updateDevice>[0] = { id };
  if (rawName !== "") patch.name = normalizeDeviceName(rawName);
  if (rawVolume !== "") patch.volume = normalizeVolume(rawVolume);
  if (rawSound !== "") {
    // "__default" means "follow the shop default", stored as NULL.
    patch.soundId = rawSound === "__default" ? null : rawSound;
    // Choosing a built-in clears any custom upload on this device, otherwise
    // the custom path would keep winning and the change would look ignored.
    patch.customSoundPath = null;
  }

  const result = await updateDevice(patch);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.device_updated",
    entityType: "announcer_devices",
    entityId: id,
    after: { summary: result.message },
  });

  revalidatePath(ORDERS_PATH);
}

/** Unpair a speaker for good. */
export async function announcerRemoveDeviceAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = field(form, "deviceId");
  if (!id) return;

  const result = await removeDevice(id);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.device_removed",
    entityType: "announcer_devices",
    entityId: id,
    after: { summary: result.message },
  });

  revalidatePath(ORDERS_PATH);
}

/** Shop-wide switches: master on/off, quiet hours, default sound and volume. */
export async function announcerUpdateSettingsAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const patch: Record<string, unknown> = {
    enabled: field(form, "enabled") === "true",
    quiet_hours_enabled: field(form, "quietHoursEnabled") === "true",
  };

  const start = field(form, "quietStart");
  const end = field(form, "quietEnd");
  if (start !== "") patch.quiet_start = start;
  if (end !== "") patch.quiet_end = end;

  const defaultSound = field(form, "defaultSoundId");
  if (defaultSound !== "") patch.default_sound_id = defaultSound;

  const defaultVolume = field(form, "defaultVolume");
  if (defaultVolume !== "") patch.default_volume = normalizeVolume(defaultVolume);

  const result = await updateAnnouncerSettings(patch);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.settings_updated",
    entityType: "announcer_settings",
    entityId: "1",
    after: { summary: result.message },
  });

  revalidatePath(ORDERS_PATH);
}

/**
 * Start pairing a new speaker.
 *
 * Produces the short code the installer types into the Pi. The code is shown
 * once on the panel; the device key it becomes is never stored in readable
 * form. See createPairing() and redeemPairing() in announcer-store.ts.
 */
export async function announcerCreatePairingAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const name = normalizeDeviceName(field(form, "name"));

  const result = await createPairing(name, session.profile.id);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.pairing_created",
    entityType: "announcer_pairings",
    entityId: null,
    after: { summary: result.ok ? `Pairing code issued for "${name}".` : result.error },
  });

  revalidatePath(ORDERS_PATH);
}
