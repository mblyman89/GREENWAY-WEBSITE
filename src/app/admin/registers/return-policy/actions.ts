"use server";

/**
 * /admin/registers/return-policy — server action (Fix Phase 6F, G-67 / G-68).
 *
 * One write: save the owner's customer-return policy (loyalty-only toggle,
 * return window in days, product types that may NOT be returned). Stored as
 * a site_settings JSON row (no migration); validated in the pure core before
 * the write, and the change is audited with the before/after values.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { validateReturnPolicyDraft } from "@/lib/pos/return-policy-core";
import { getPosReturnPolicy, savePosReturnPolicy } from "@/lib/pos/return-policy-store";

const BASE = "/admin/registers/return-policy";

export type SaveReturnPolicyResult = { ok: true } | { ok: false; error: string };

export async function saveReturnPolicyAction(input: {
  loyaltyRequired: boolean;
  windowDays: string | number;
  excludedCategories: string[];
}): Promise<SaveReturnPolicyResult> {
  const session = await requirePermission("settings.manage");

  const draft = validateReturnPolicyDraft(input);
  if (!draft.ok) return { ok: false, error: draft.error };

  const before = await getPosReturnPolicy();
  const result = await savePosReturnPolicy(draft.config, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.return_policy_saved",
    entityType: "site_setting",
    entityId: "pos_return_policy",
    before: { ...before },
    after: { ...result.config },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/registers/returns");
  return { ok: true };
}
