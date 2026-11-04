"use server";

/**
 * /admin/registers/ipad-setup — offline PIN unlock server actions (D161).
 *
 * Owner, 2026-11-04: "please now build for me something that allows my
 * employees to unlock the ipad registers in offline mode ... use every
 * enterprise grade solution to make this the most robust, hardened feature
 * possible."
 *
 * Two owner-only writes (registers.lockdown), both audited with before/after:
 *   - save the offline policy (on/off, offline window, online re-check days,
 *     offline manager approval);
 *   - RESET: bump the key epoch, which changes every iPad's offline key, so
 *     every stored verifier on every iPad is erased at its next check-in
 *     (lost iPad, suspected PIN sharing, an employee leaving on bad terms).
 *
 * Kept apart from actions.ts on purpose: the D142 compliance test pins that
 * file to exactly its two lockdown writes.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revokedPolicy, validateOfflinePolicyDraft, offlineKeyId } from "@/lib/pos/offline-unlock-core";
import { getOfflinePolicyStrict, POS_OFFLINE_POLICY_KEY, saveOfflinePolicy } from "@/lib/pos/offline-unlock-store";

const BASE = "/admin/registers/ipad-setup";

export type OfflineActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveOfflinePolicyAction(input: {
  enabled: boolean;
  maxOfflineHours: string | number;
  armTtlDays: string | number;
  allowOfflineApproval: boolean;
}): Promise<OfflineActionResult> {
  const session = await requirePermission("registers.lockdown");
  const before = await getOfflinePolicyStrict();
  if (!before) return { ok: false, error: "Could not read the current offline policy. Nothing was changed. Try again." };
  const draft = validateOfflinePolicyDraft(input, before);
  if (!draft.ok) return { ok: false, error: draft.error };
  const res = await saveOfflinePolicy(draft.policy, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Save failed." };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.offline_unlock_policy_saved",
    entityType: "site_setting",
    entityId: POS_OFFLINE_POLICY_KEY,
    before: { ...before },
    after: { ...draft.policy },
  });
  revalidatePath(BASE);
  return {
    ok: true,
    message: draft.policy.enabled
      ? "Offline unlock policy saved. Each iPad picks it up at its next check-in (within about 10 minutes online)."
      : "Offline unlock turned OFF. Each iPad erases its offline PINs at its next check-in. A locked iPad then needs the internet to unlock.",
  };
}

export async function resetOfflineUnlockAction(input: { confirm: string }): Promise<OfflineActionResult> {
  const session = await requirePermission("registers.lockdown");
  if ((input.confirm ?? "").trim().toUpperCase() !== "RESET") {
    return { ok: false, error: 'Type RESET to confirm. Every employee will need to unlock each iPad online once again.' };
  }
  const before = await getOfflinePolicyStrict();
  if (!before) return { ok: false, error: "Could not read the current offline policy. Nothing was reset. Try again." };
  const next = revokedPolicy(before);
  if (next.epoch === before.epoch) return { ok: false, error: "The reset counter is at its limit. Contact support." };
  const res = await saveOfflinePolicy(next, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Reset failed." };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.offline_unlock_reset",
    entityType: "site_setting",
    entityId: POS_OFFLINE_POLICY_KEY,
    before: { epoch: before.epoch, keyId: offlineKeyId(before.epoch) },
    after: { epoch: next.epoch, keyId: offlineKeyId(next.epoch) },
  });
  revalidatePath(BASE);
  return {
    ok: true,
    message:
      "Offline PINs reset. Each iPad erases its old offline PINs at its next check-in (within about 10 minutes online). Any offline use of an old PIN before then is flagged for review when it syncs.",
  };
}
