"use server";

/**
 * /admin/registers/rounding — server actions (POS Slice B33).
 *
 * One write: save the cash-rounding policy (off / nearest / up / down).
 * Stored as a site_settings JSON row (no migration); normalization happens
 * in the pure core before the write, and the change is audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizePosCashRoundingConfig } from "@/lib/pos/cash-rounding-core";
import { savePosCashRoundingConfig } from "@/lib/pos/cash-rounding-store";

const BASE = "/admin/registers/rounding";

export type SaveCashRoundingResult = { ok: true } | { ok: false; error: string };

export async function saveCashRoundingAction(input: { mode: string }): Promise<SaveCashRoundingResult> {
  const session = await requirePermission("settings.manage");

  const config = normalizePosCashRoundingConfig(input);
  const result = await savePosCashRoundingConfig(config, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.cash_rounding_saved",
    entityType: "site_setting",
    entityId: "pos_cash_rounding",
    after: { ...result.config },
  });
  revalidatePath(BASE);
  return { ok: true };
}
