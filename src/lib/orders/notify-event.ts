// =============================================================================
// Order notification event recorder (server-only, best-effort).
//
// When the post-order email work (GW-024 / GW-025) detects that an email
// FAILED to send, we write a plain-English note onto the order's timeline
// (order_events) so staff reviewing the order in the back office can see
// "the customer/staff email for this order never went out" without digging
// through server logs.
//
// Design rules:
//   - NEVER throws. This runs inside `after()` on a hot checkout path; a
//     timeline-note failure must not cascade. Worst case we console.error.
//   - No-op when Supabase service credentials are not configured (local dev
//     without env vars) — the caller already logged the failure to console.
// =============================================================================

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/**
 * Best-effort: append a warning note to the order's timeline so staff can
 * see an email failure right on the order detail page.
 *
 * @param orderId internal orders.id (uuid) — never exposed to customers
 * @param note    plain-English warning produced by summarizeNotifyOutcomes()
 */
export async function recordOrderNotifyFailure(orderId: string, note: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  if (!orderId || !note) return;

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "note",
      note,
      actor_label: "system · email monitor",
    });
    if (error) {
      console.error(`[orders] could not record email-failure note for order ${orderId}: ${error.message}`);
    }
  } catch (err) {
    console.error(`[orders] could not record email-failure note for order ${orderId}:`, err);
  }
}
