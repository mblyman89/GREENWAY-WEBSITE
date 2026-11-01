"use server";

/**
 * /admin/registers/cash-drawer — server action (R-DRAWER-1).
 *
 * Saves "open the cash drawer with a printed receipt / without a receipt".
 * site_settings JSON row (no migration); audited with before and after.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isDrawerOnSaleMode, normalizePosDrawerOnSaleConfig } from "@/lib/pos/drawer-on-sale-core";
import {
  POS_DRAWER_ON_SALE_KEY,
  getPosDrawerOnSaleConfig,
  savePosDrawerOnSaleConfig,
} from "@/lib/pos/drawer-on-sale-store";

const BASE = "/admin/registers/cash-drawer";

export type SaveDrawerOnSaleResult = { ok: true } | { ok: false; error: string };

export async function saveDrawerOnSaleAction(input: { mode: string }): Promise<SaveDrawerOnSaleResult> {
  const session = await requirePermission("settings.manage");
  if (!isDrawerOnSaleMode(input?.mode)) return { ok: false, error: "Choose one of the two options." };

  const before = await getPosDrawerOnSaleConfig();
  const config = normalizePosDrawerOnSaleConfig({ mode: input.mode });
  const result = await savePosDrawerOnSaleConfig(config, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.drawer_on_sale_saved",
    entityType: "site_setting",
    entityId: POS_DRAWER_ON_SALE_KEY,
    before: { ...before },
    after: { ...result.config },
  });
  revalidatePath(BASE);
  return { ok: true };
}
