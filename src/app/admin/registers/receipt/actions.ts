"use server";

/**
 * /admin/registers/receipt — server actions (POS Slice B13).
 *
 * One write: save the register-receipt customization (header, address block,
 * footer, display toggles). Stored as a site_settings JSON row (no
 * migration); normalization/clamping happens in the pure core before the
 * write, and the change is audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizePosReceiptConfig } from "@/lib/pos/receipt-config-core";
import { savePosReceiptConfig } from "@/lib/pos/receipt-config-store";

const BASE = "/admin/registers/receipt";

export type SaveReceiptConfigResult = { ok: true } | { ok: false; error: string };

export async function saveReceiptConfigAction(input: {
  headerText: string;
  addressText: string;
  footerText: string;
  showEmployee: boolean;
  showSavings: boolean;
  showLoyalty: boolean;
  // -- Slice 22b ---------------------------------------------------------
  showTaxBreakdown: boolean;
  showLogo: boolean;
  logoWidth: number;
  showReturnPolicy: boolean;
  returnPolicyText: string;
  showItemDetail: boolean;
  showBarcode: boolean;
  showSaleSummary: boolean;
  // -- Slice 23 ----------------------------------------------------------
  useQrCode: boolean;
  bottomLogoDataUri: string;
  bottomLogoWidth: number;
}): Promise<SaveReceiptConfigResult> {
  const session = await requirePermission("settings.manage");

  const config = normalizePosReceiptConfig(input);
  const result = await savePosReceiptConfig(config, session.profile.id);
  if (!result.ok) return { ok: false, error: result.error ?? "Save failed." };

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.receipt_config_saved",
    entityType: "site_setting",
    entityId: "pos_receipt_config",
    after: { ...result.config },
  });
  revalidatePath(BASE);
  return { ok: true };
}
