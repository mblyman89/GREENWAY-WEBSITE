/**
 * src/lib/merch/merch-autoconfirm-server.ts  (D232 slice M-7, Q-11-7)
 * Server-only read / write of the auto-confirm switch (site_settings
 * merch_auto_confirm). Rules: merch-autoconfirm-core.ts. Never throws.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadMerchOrderBoard } from "@/lib/orders/merch-orders-server";
import { AUTO_CONFIRM_KEY, AUTO_CONFIRM_OFF, countCleanOrders, normalizeAutoConfirm, type AutoConfirmSetting } from "./merch-autoconfirm-core";

export async function readAutoConfirm(): Promise<{ setting: AutoConfirmSetting; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { setting: AUTO_CONFIRM_OFF, error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", AUTO_CONFIRM_KEY).maybeSingle();
    if (error) return { setting: AUTO_CONFIRM_OFF, error: error.message };
    return { setting: normalizeAutoConfirm(data?.value_json ?? null), error: null };
  } catch (e) {
    return { setting: AUTO_CONFIRM_OFF, error: e instanceof Error ? e.message : "read failed" };
  }
}

export async function saveAutoConfirm(next: AutoConfirmSetting, updatedBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await createSupabaseAdminClient()
      .from("site_settings")
      .upsert({ key: AUTO_CONFIRM_KEY, label: "Merch auto-confirm", value_json: normalizeAutoConfirm(next) as unknown as Record<string, unknown>, updated_by: updatedBy }, { onConflict: "key" });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Fulfilled greenwaymerch.com orders at Printful (null when Printful could not be read). */
export async function cleanOrderCount(): Promise<{ count: number | null; problem: string }> {
  const board = await loadMerchOrderBoard();
  if (!board.configured) return { count: null, problem: "Printful isn't connected (PRINTFUL_API_TOKEN)." };
  if (board.problem) return { count: null, problem: board.problem };
  return { count: countCleanOrders(board.orders), problem: "" };
}
