/**
 * src/lib/payments/vendor-ach-enrollment-store.ts — R39 S4 (server-only)
 *
 * Reads and writes the 0258 vendor ACH flags (needs bank info / opted out).
 * The decision is made by planVendorAchFlagChange(); this file only does I/O.
 *
 * Writes are compare-and-set: the UPDATE matches the flag values we just read,
 * so if two people press buttons at the same time the second one gets "this
 * changed, reload" instead of silently overwriting the first.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isMissingColumn } from "@/lib/payments/payee-banking-store";
import {
  patchSatisfiesConstraints,
  planVendorAchFlagChange,
  readVendorAchFlags,
  type VendorAchFlags,
  type VendorAchFlagPatch,
} from "@/lib/payments/vendor-ach-enrollment-core";

const FLAG_COLS = "id, display_name, ach_needs_bank_info, ach_opted_out, ach_opted_out_reason, ach_opted_out_by, ach_opted_out_at";

export async function getVendorAchFlags(vendorId: string): Promise<{ found: boolean; name: string; flags: VendorAchFlags }> {
  const notReady = readVendorAchFlags(null);
  if (!isSupabaseServiceConfigured) return { found: false, name: "", flags: notReady };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("vendors").select(FLAG_COLS).eq("id", vendorId).maybeSingle();
  if (error) {
    if (isMissingColumn(error)) {
      const { data: v, error: e2 } = await admin.from("vendors").select("id, display_name").eq("id", vendorId).maybeSingle();
      if (e2) throw new Error(`Could not read vendor: ${e2.message}`);
      return { found: Boolean(v), name: String((v as { display_name?: string } | null)?.display_name ?? ""), flags: notReady };
    }
    throw new Error(`Could not read vendor ACH flags: ${error.message}`);
  }
  if (!data) return { found: false, name: "", flags: notReady };
  const row = data as Record<string, unknown>;
  return { found: true, name: String(row.display_name ?? ""), flags: readVendorAchFlags(row) };
}

/** All vendors' flags for list views. Empty map + ready:false before 0258. */
export async function listVendorAchFlags(): Promise<{ ready: boolean; byVendor: Map<string, VendorAchFlags> }> {
  const byVendor = new Map<string, VendorAchFlags>();
  if (!isSupabaseServiceConfigured) return { ready: false, byVendor };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("vendors").select(FLAG_COLS);
  if (error) {
    if (isMissingColumn(error)) return { ready: false, byVendor };
    throw new Error(`Could not read vendor ACH flags: ${error.message}`);
  }
  for (const row of (data ?? []) as Record<string, unknown>[]) byVendor.set(String(row.id), readVendorAchFlags(row));
  return { ready: true, byVendor };
}

export async function changeVendorAchFlag(params: {
  vendorId: string;
  action: string;
  reason: string;
  actorId: string;
  nowIso: string;
}): Promise<
  | { ok: true; before: VendorAchFlags; patch: VendorAchFlagPatch; summary: string; vendorName: string }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const cur = await getVendorAchFlags(params.vendorId);
  if (!cur.found) return { ok: false, error: "Vendor not found." };
  const plan = planVendorAchFlagChange({ current: cur.flags, action: params.action, reason: params.reason, actorId: params.actorId, nowIso: params.nowIso });
  if (!plan.ok) return plan;
  if (!patchSatisfiesConstraints(plan.patch)) return { ok: false, error: "Internal check failed: this change would break the database rules. Nothing was saved." };

  const admin = createSupabaseAdminClient();
  let q = admin
    .from("vendors")
    .update(plan.patch)
    .eq("id", params.vendorId)
    .eq("ach_needs_bank_info", cur.flags.needsBankInfo)
    .eq("ach_opted_out", cur.flags.optedOut);
  q = cur.flags.optedOutAt === null ? q.is("ach_opted_out_at", null) : q.eq("ach_opted_out_at", cur.flags.optedOutAt);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  if (!data || data.length !== 1) return { ok: false, error: "Someone else changed this vendor's ACH settings just now. Reload the page and try again." };
  return { ok: true, before: cur.flags, patch: plan.patch, summary: plan.summary, vendorName: cur.name };
}
