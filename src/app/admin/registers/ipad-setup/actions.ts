"use server";

/**
 * /admin/registers/ipad-setup — server actions (D146 / D147).
 *
 * Owner, 2026-11-03: "make the iPad behavior set in stone and something only
 * I can undo." Both writes are gated by registers.lockdown, which is
 * ["owner"] alone, and both are audited with before/after values. Stored as
 * site_settings JSON rows (no migration).
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { applyChecklistToggle, checklistItem, validateLockdownDraft } from "@/lib/pos/ipad-setup-core";
import {
  getIpadChecklistState,
  getIpadLockdownPolicy,
  POS_IPAD_LOCKDOWN_KEY,
  POS_IPAD_SETUP_KEY,
  saveIpadChecklistState,
  saveIpadLockdownPolicy,
} from "@/lib/pos/ipad-setup-store";

const BASE = "/admin/registers/ipad-setup";

export type IpadSetupActionResult = { ok: true } | { ok: false; error: string };

export async function saveLockdownPolicyAction(input: {
  keepAwake: boolean;
  guidedAccess: string;
  staleDeviceDays: string | number;
}): Promise<IpadSetupActionResult> {
  const session = await requirePermission("registers.lockdown");
  const draft = validateLockdownDraft(input);
  if (!draft.ok) return { ok: false, error: draft.error };
  const before = await getIpadLockdownPolicy();
  const res = await saveIpadLockdownPolicy(draft.policy, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Save failed." };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.ipad_lockdown_saved",
    entityType: "site_setting",
    entityId: POS_IPAD_LOCKDOWN_KEY,
    before: { ...before },
    after: { ...draft.policy },
  });
  revalidatePath(BASE);
  return { ok: true };
}

export async function toggleChecklistItemAction(input: {
  deviceId: string;
  itemId: string;
  checked: boolean;
}): Promise<IpadSetupActionResult> {
  const session = await requirePermission("registers.lockdown");
  if (!checklistItem(input.itemId)) return { ok: false, error: "Unknown checklist item." };
  const state = await getIpadChecklistState();
  const next = applyChecklistToggle(state, {
    deviceId: input.deviceId,
    itemId: input.itemId,
    checked: input.checked,
    by: session.profile.full_name || session.email || "owner",
    at: new Date().toISOString(),
  });
  if (!next.ok) return { ok: false, error: next.error };
  const res = await saveIpadChecklistState(next.state, session.profile.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Save failed." };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: input.checked ? "pos.ipad_checklist_checked" : "pos.ipad_checklist_unchecked",
    entityType: "site_setting",
    entityId: POS_IPAD_SETUP_KEY,
    before: { deviceId: input.deviceId, itemId: input.itemId, checked: !input.checked },
    after: { deviceId: input.deviceId, itemId: input.itemId, checked: input.checked },
  });
  revalidatePath(BASE);
  return { ok: true };
}
