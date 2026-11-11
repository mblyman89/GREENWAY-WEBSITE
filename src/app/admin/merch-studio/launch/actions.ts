"use server";

/**
 * /admin/merch-studio/launch: server actions (D232 slice M-3a, G-78).
 * Owner & admin (settings.manage, the same gate as Merch Health). Audited.
 *   - setLaunchTickAction: tick / untick a step the owner checked himself.
 *   - saveLaunchNoteAction: a form 8.1 note (store name, certificate status,
 *     live date, analytics token expiry, signature).
 *   - The Printful token expiry is saved by Merch Health's saveTokenExpiryAction
 *     (one date, one place: it drives H-3).
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { LAUNCH_NOTE_KEYS, LAUNCH_STEP_IDS, MERCH_LAUNCH_PAGE, MERCH_LAUNCH_RECORD_PAGE, setNote, setTick, type LaunchNoteKey, type LaunchStepId } from "@/lib/merch/merch-launch-core";
import { updateLaunchProgress } from "@/lib/merch/merch-launch-server";

export type LaunchActionResult = { ok: true } | { ok: false; error: string };

export async function setLaunchTickAction(stepId: string, done: boolean): Promise<LaunchActionResult> {
  const session = await requirePermission("settings.manage");
  const id = LAUNCH_STEP_IDS.find((s) => s === stepId) as LaunchStepId | undefined;
  if (!id) return { ok: false, error: "Unknown step." };
  const r = await updateLaunchProgress((p) => setTick(p, id, done, { at: new Date().toISOString(), by: session.email ?? null }), session.profile.id);
  if (!r.ok) return r;
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: done ? "merch.launch_step_ticked" : "merch.launch_step_unticked", entityType: "site_settings", entityId: `merch_launch_progress:${id}` });
  revalidatePath(MERCH_LAUNCH_PAGE);
  revalidatePath(MERCH_LAUNCH_RECORD_PAGE);
  revalidatePath("/admin/merch-studio");
  return { ok: true };
}

export async function saveLaunchNoteAction(key: string, value: string): Promise<LaunchActionResult> {
  const session = await requirePermission("settings.manage");
  const k = LAUNCH_NOTE_KEYS.find((x) => x === key) as LaunchNoteKey | undefined;
  if (!k) return { ok: false, error: "Unknown field." };
  const r = await updateLaunchProgress((p) => setNote(p, k, value), session.profile.id);
  if (!r.ok) return r;
  if (value.trim() && !r.progress.notes[k]) return { ok: false, error: "That value wasn't accepted (dates look like 2027-01-31)." };
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "merch.launch_note_saved", entityType: "site_settings", entityId: `merch_launch_progress:${k}`, after: { [k]: r.progress.notes[k] ?? "" } });
  revalidatePath(MERCH_LAUNCH_PAGE);
  revalidatePath(MERCH_LAUNCH_RECORD_PAGE);
  return { ok: true };
}
