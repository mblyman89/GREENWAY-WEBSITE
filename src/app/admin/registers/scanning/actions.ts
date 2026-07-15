"use server";

/**
 * /admin/registers/scanning — server actions (POS Slice B41).
 *
 * One write: save the scan-required register mode (on / off). Stored as a
 * site_settings JSON row (no migration); normalization happens in the pure
 * core before the write, and the change is audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizePosScanRequiredConfig } from "@/lib/pos/scan-required-core";
import { savePosScanRequiredConfig } from "@/lib/pos/scan-required-store";

const BASE = "/admin/registers/scanning";

export type SaveScanRequiredResult = { ok: true } | { ok: false; error: string };

export async function saveScanRequiredAction(input: { enabled: boolean }): Promise<SaveScanRequiredResult> {
  const session = await requirePermission("settings.manage");

  const config = normalizePosScanRequiredConfig(input);
  const result = await savePosScanRequiredConfig(config, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.scan_required_saved",
    entityType: "site_setting",
    entityId: "pos_scan_required",
    after: { ...result.config },
  });
  revalidatePath(BASE);
  return { ok: true };
}
