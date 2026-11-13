"use server";

/**
 * /admin/registers/switches — server action (D241).
 *
 * One write: save the two owner register switches (browser registers on/off,
 * swap dual approval on/off). One site_settings JSON row (no migration);
 * normalized in the pure core before the write; the change is audited with
 * the before and after values.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizeRegisterSwitches } from "@/lib/pos/register-switches-core";
import {
  getRegisterSwitches,
  POS_REGISTER_SWITCHES_KEY,
  saveRegisterSwitches,
} from "@/lib/pos/register-switches-store";

const BASE = "/admin/registers/switches";

export type SaveRegisterSwitchesResult = { ok: true } | { ok: false; error: string };

export async function saveRegisterSwitchesAction(input: {
  webRegistersAllowed: boolean;
  swapApprovalRequired: boolean;
}): Promise<SaveRegisterSwitchesResult> {
  const session = await requirePermission("settings.manage");

  const before = await getRegisterSwitches();
  const switches = normalizeRegisterSwitches(input);
  const result = await saveRegisterSwitches(switches, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.register_switches_saved",
    entityType: "site_setting",
    entityId: POS_REGISTER_SWITCHES_KEY,
    before: { ...before },
    after: { ...result.switches },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/registers");
  return { ok: true };
}
