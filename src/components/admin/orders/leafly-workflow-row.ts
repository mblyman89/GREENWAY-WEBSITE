/**
 * src/components/admin/orders/leafly-workflow-row.ts
 *
 * The database row → pure-core input translation for a Leafly order.
 *
 * Moved out of LeaflyOrdersPanel.tsx in SLICE L-38, because two components
 * now need it: the dashboard panel (to place each row in a bucket) and the
 * details-page workflow (to plan the step buttons). One translation, two
 * readers — a second copy is exactly where the `?? null` bug below would
 * creep back in.
 */
import type { LeaflyWorkflowInput } from "@/lib/leafly/bridge-core";
import type { LeaflyBoardOrder } from "@/lib/leafly/order-board-server";
import { confirmPushFailedFromColumn } from "@/lib/leafly/auto-ack-core";

/**
 * SLICE L-33 widens this by exactly one field.
 *
 * `confirmPushFailed` is added HERE rather than on `LeaflyWorkflowInput`
 * because that type is bridge-core's input for deciding which COLUMN an order
 * belongs in, and a failed status push does not move an order between columns
 * — it changes which BUTTONS the order offers.
 *
 * `boolean | undefined` and not `boolean`: see `confirmPushFailedFromColumn`.
 */
export type WorkflowRow = LeaflyBoardOrder &
  LeaflyWorkflowInput & { confirmPushFailed?: boolean | undefined };

/**
 * Translate a database row into the core's input shape.
 *
 * `announced_at` and `printed_at` are passed THROUGH, including when they are
 * `undefined` — which is what a pre-0228 database produces, because the board
 * falls back to a column list that omits them. That `undefined` must survive
 * this function intact: the core treats it as "not tracked" and stays quiet,
 * whereas a `?? null` here would make the board accuse every order in the shop
 * of having never rung the bell. The temptation to "tidy" this line is exactly
 * the bug, so it is called out here and pinned by tests in bridge-core.
 */
export function toWorkflowRow(order: LeaflyBoardOrder): WorkflowRow {
  return {
    ...order,
    leaflyOrderId: order.leafly_order_id,
    leaflyStatus: order.leafly_status,
    acknowledgedAt: order.acknowledged_at,
    canceledAt: order.canceled_at,
    localOrderId: order.local_order_id,
    announcedAt: order.announced_at,
    printedAt: order.printed_at,
    // SLICE L-33. Translated by the pure core, not by an inline comparison:
    // the obvious one-liner (`order.confirm_push_failed_at !== null`) reports
    // EVERY order in a pre-0230 shop as having a failed confirm push, because
    // `undefined !== null`.
    confirmPushFailed: confirmPushFailedFromColumn(order.confirm_push_failed_at),
  };
}
