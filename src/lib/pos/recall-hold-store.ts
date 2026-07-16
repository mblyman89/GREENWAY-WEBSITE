/**
 * recall-hold-store.ts (Task AN-7)
 *
 * Server wrapper for the pure recall-hold core: loads the recalled lots'
 * product keys once per call site.
 *
 * FAIL POSTURE — asymmetric on purpose:
 *   - MENU BUNDLE (advisory filter): best-effort. A read failure ships an
 *     un-filtered menu rather than an empty one — the completion gate below
 *     is the real stop, and an outage must never blank every register.
 *   - COMPLETION GATE (the statutory stop): the gate calls
 *     `recalledProductKeys({ failClosed: true })`; a read FAILURE throws and
 *     the gate refuses the sale ("cannot verify recall status") rather than
 *     letting a possibly-recalled product through. Unconfigured Supabase is
 *     NOT a failure (dev/build contexts have no lots at all).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { buildRecallHoldIndex, HOLD_LOT_STATUS, type LotStatusRow } from "./recall-hold-core";

/**
 * Product keys (pos_product_key) with at least one lot in `recalled` status.
 *
 * @param opts.failClosed  When true (completion gate), a query error THROWS so
 *   the caller can refuse the sale. When false (menu bundle), errors collapse
 *   to an empty set — advisory only.
 */
export async function recalledProductKeys(opts?: { failClosed?: boolean }): Promise<Set<string>> {
  if (!isSupabaseServiceConfigured) return new Set();
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inventory_lots")
      .select("pos_product_key, status")
      .eq("status", HOLD_LOT_STATUS)
      .limit(5000);
    if (error) throw new Error(`inventory_lots recall query failed: ${error.message}`);
    const rows: LotStatusRow[] = (
      (data as { pos_product_key: string | null; status: string | null }[] | null) ?? []
    ).map((r) => ({ posProductKey: r.pos_product_key, status: r.status }));
    return buildRecallHoldIndex(rows);
  } catch (e) {
    if (opts?.failClosed) throw e;
    return new Set();
  }
}
