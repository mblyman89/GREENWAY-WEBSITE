/**
 * src/lib/pos/pickup-leafly-close.ts  (SLICE L-37)
 *
 * After a register sale that carried a LEAFLY order completes, tell Leafly the
 * shopper has their bag (`picked_up`), walking through `ready` first if Leafly
 * is still at `confirmed` - Leafly's spec forbids treating a direct jump to
 * `picked_up` as the lifecycle.
 *
 * ORDER OF OPERATIONS (the caller guarantees it): our copy of the order has
 * ALREADY been closed as "picked up at the register" (non-revenue) before this
 * runs. That matters because a successful `picked_up` push runs Leafly's own
 * close path (onLeaflyOrderClosed), which maps picked_up -> "completed". Had
 * our order still been open, it would have become a SECOND completed order
 * beside the register sale - double revenue, double excise, double CCRS.
 * Closed first, the bridge finds it already settled and leaves it alone (and
 * recognises the register pickup marker, so it does not raise a false alarm).
 *
 * Best-effort and never throws: the sale is complete and paid for. Any
 * failure leaves a loud audit row (`order.leafly_picked_up_failed`) so a
 * manager can finish it from the back-office Leafly board.
 */
import "server-only";

import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { planLeaflyPushes } from "@/lib/pos/pickup-progress-core";

/**
 * Run `task` after the HTTP response is sent (Next's `after()`), so a slow
 * Leafly (12s timeout x 2 attempts per push) never holds the register's sync
 * open. Outside a request scope `after` throws; then the task simply runs now.
 * Errors are swallowed - the task already reports its own failures.
 */
export function scheduleAfterResponse(task: () => Promise<unknown>): void {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

export type LeaflyPickedUpOutcome = { ok: boolean; pushed: string[]; message: string };

export async function pushLeaflyPickedUp(input: {
  localOrderId: string;
  deviceLabel: string;
}): Promise<LeaflyPickedUpOutcome> {
  const fail = async (message: string, pushed: string[] = []): Promise<LeaflyPickedUpOutcome> => {
    try {
      await recordAudit({
        actorId: null,
        actorEmail: input.deviceLabel,
        action: "order.leafly_picked_up_failed",
        entityType: "order",
        entityId: input.localOrderId,
        after: { message, pushed },
      });
    } catch {
      /* the audit is best-effort too */
    }
    return { ok: false, pushed, message };
  };

  try {
    if (!isSupabaseServiceConfigured) return { ok: false, pushed: [], message: "Database not configured." };
    const { data: lf } = await createSupabaseAdminClient()
      .from("leafly_orders")
      .select("leafly_order_id, leafly_status, acknowledged_at")
      .eq("local_order_id", input.localOrderId)
      .limit(1)
      .maybeSingle<{ leafly_order_id: string; leafly_status: string | null; acknowledged_at: string | null }>();
    if (!lf) return fail("No Leafly record is linked to this order, so Leafly was not told it was picked up.");
    if ((lf.acknowledged_at ?? "").trim() === "") {
      return fail("Leafly never acknowledged this order, so it would not accept 'picked up'. Mark it on the back-office Leafly board.");
    }

    const plan = planLeaflyPushes(lf.leafly_status, "picked_up");
    if (plan.alreadyThere) return { ok: true, pushed: [], message: "Leafly already has this order as picked up." };
    if (plan.terminal) {
      return fail(`Leafly has this order as "${lf.leafly_status}", which is final, so it could not be marked picked up.`);
    }

    const { setLeaflyOrderStatus } = await import("@/lib/leafly/order-ack-server");
    const pushed: string[] = [];
    let current = lf.leafly_status;
    for (const step of plan.pushes) {
      const res = await setLeaflyOrderStatus({
        order: { leafly_order_id: lf.leafly_order_id, leafly_status: current, acknowledged_at: lf.acknowledged_at },
        nextStatus: step,
        staffId: null,
      });
      if (!res.ok) return fail(`Leafly did not accept "${step}": ${res.message}`, pushed);
      pushed.push(step);
      current = step;
    }

    await recordAudit({
      actorId: null,
      actorEmail: input.deviceLabel,
      action: "order.leafly_picked_up_pushed",
      entityType: "order",
      entityId: input.localOrderId,
      after: { leaflyOrderId: lf.leafly_order_id, from: lf.leafly_status, pushed },
    });
    return { ok: true, pushed, message: `Leafly: ${pushed.join(" -> ")}.` };
  } catch (err) {
    return fail(`Unexpected failure telling Leafly: ${err instanceof Error ? err.message : "unknown"}`);
  }
}
