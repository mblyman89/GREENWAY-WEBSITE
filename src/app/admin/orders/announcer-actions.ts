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
 * They revalidate the Orders page rather than returning data, matching the
 * existing form-action pattern on this screen. announcerTestAllAction() is the
 * one deliberate exception -- see the note above it.
 */
import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  normalizeDeviceName,
  normalizeVolume,
  POLL_HOLD_SECONDS,
} from "@/lib/announcer/announcer-core";
import { describeTestOutcome } from "@/lib/announcer/announcer-fanout-core";
import {
  removeDevice,
  updateAnnouncerSettings,
  updateDevice,
} from "@/lib/announcer/announcer-admin-store";
import { enqueueAnnouncement } from "@/lib/announcer/announcer-enqueue";
import { createPairing } from "@/lib/announcer/announcer-store";
import { contentTypeFor, formatBytes, validateUpload } from "@/lib/announcer/announcer-sounds-core";
import {
  createSound,
  deleteSound,
  renameSound,
} from "@/lib/announcer/announcer-sounds-store";

const ORDERS_PATH = "/admin/orders";

/** Read a single form field as a trimmed string. */
function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * What the Test button reports back to the screen.
 *
 * A type, not a value, so this stays legal to export from a "use server" file.
 */
export type AnnouncerTestResult = {
  /** Plain-English sentence for the person who just pressed the button. */
  message: string;
  /** True when the test was actually queued to at least one speaker. */
  sent: boolean;
  /** Lets the panel tell two identical messages apart and re-announce them. */
  at: number;
};

/**
 * Play a sound on every speaker right now.
 *
 * This is the single most important button on the panel: it turns "I think it
 * works" into "I just heard it". It bypasses quiet hours on purpose — you press
 * Test precisely to check the speaker works at this moment.
 *
 * WHY THIS ONE RETURNS A VALUE WHEN EVERY OTHER ACTION HERE RETURNS VOID
 * ---------------------------------------------------------------------
 * The owner reported this button "does nothing, it hangs". It was not hanging.
 * It queued the sound and returned — but it returned `void`, the button had no
 * pending state, and the panel said nothing afterwards, so pressing it produced
 * no visible change at all. The Pi then sits on a long-poll of up to
 * POLL_HOLD_SECONDS before it collects the sound, so even a perfectly healthy
 * shop can wait ~25 seconds for the chime.
 *
 * Silence for 25 seconds after pressing a button is indistinguishable from a
 * crash. Every other action on this panel changes something you can see (a name
 * changes, a card disappears); Test is the only one whose entire result is a
 * noise that happens somewhere else, later. So it is the only one that has to
 * say so in words.
 *
 * The shape is `(prevState, formData)` because it is consumed by
 * useActionState() in AnnouncerTestButton.
 */
// useActionState calls this as (previousState, formData). Neither is read: the
// test takes no input, and the previous result must never influence the next
// one. They exist to match the hook's call signature.
export async function announcerTestAllAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: AnnouncerTestResult | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _form: FormData,
): Promise<AnnouncerTestResult> {
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

  return {
    message: describeTestOutcome({
      queued: result.queued,
      skipped: result.skipped,
      ok: result.ok,
      holdSeconds: POLL_HOLD_SECONDS,
    }),
    sent: result.ok && result.queued > 0,
    at: Date.now(),
  };
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

/* ────────────────────────────────────────────────────────────────────────── */
/* SLICE 34 — the sound library                                               */
/*                                                                            */
/* Storage landed in Slice 31 but nothing could reach it: there was no upload  */
/* box and no way to pick an uploaded file. These three actions close that     */
/* gap. They follow the same shape as everything above — same permission,      */
/* same audit, same revalidate, always void.                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Upload a custom sound.
 *
 * Validation happens twice on purpose. validateUpload() checks the name and
 * size before a single byte is read, so an oversized file is rejected without
 * being pulled into memory; createSound() then re-checks the real byte length,
 * because the size a browser reports is not evidence.
 */
export async function announcerUploadSoundAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const file = form.get("file");
  const isFile = typeof File !== "undefined" && file instanceof File;
  const fileName = isFile ? file.name : "";
  const size = isFile ? file.size : 0;

  const typedLabel = field(form, "label");
  const verdict = validateUpload({ fileName, bytes: size, label: typedLabel });
  if (!verdict.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "announcer.sound_rejected",
      entityType: "announcer_sounds",
      entityId: null,
      after: { summary: verdict.error },
    });
    revalidatePath(ORDERS_PATH);
    return;
  }

  // validateUpload already picked the label: the typed one if given, otherwise
  // one derived from the filename. The content type is derived from the
  // extension it verified, never from what the browser claimed the file was.
  const result = await createSound({
    label: verdict.label,
    extension: verdict.extension,
    bytes: await (file as File).arrayBuffer(),
    contentType: contentTypeFor(`sound.${verdict.extension}`),
    uploadedBy: session.profile.id,
  });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.sound_uploaded",
    entityType: "announcer_sounds",
    entityId: result.ok ? result.id : null,
    after: {
      summary: result.ok
        ? `Uploaded "${result.label}" (${formatBytes(size)}) as ${result.storagePath}.`
        : result.error,
    },
  });

  revalidatePath(ORDERS_PATH);
}

/** Rename a custom sound. The file itself is untouched, so nothing goes quiet. */
export async function announcerRenameSoundAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = field(form, "soundId");
  const label = field(form, "label");
  if (id === "" || label === "") return;

  const result = await renameSound(id, label);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.sound_renamed",
    entityType: "announcer_sounds",
    entityId: id,
    after: { summary: result.ok ? `Renamed to "${label.slice(0, 60)}".` : result.error },
  });

  revalidatePath(ORDERS_PATH);
}

/**
 * Delete a custom sound.
 *
 * deleteSound() detaches any speaker and the shop default FIRST, so a delete
 * can never leave a speaker pointing at a file that no longer exists. The
 * panel warns about that before the click; this is the safety net behind it.
 */
export async function announcerDeleteSoundAction(form: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = field(form, "soundId");
  if (id === "") return;

  const result = await deleteSound(id);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "announcer.sound_deleted",
    entityType: "announcer_sounds",
    entityId: id,
    after: {
      summary: result.ok
        ? "Sound deleted. Anything using it was moved back to the shop default."
        : result.error,
    },
  });

  revalidatePath(ORDERS_PATH);
}
