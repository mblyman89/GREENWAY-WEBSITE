"use server";
/**
 * R73 S1 - the two steps a person takes on a Greenway Merch order, from its
 * back-office details page (/admin/orders/merch/<ref>):
 *
 *   Confirm  POST /orders/{id}/confirm - "Approves for fulfillment an order
 *            that was saved as a draft. Store owner's credit card is charged
 *            when the order is submitted for fulfillment." (Printful v1 OpenAPI)
 *   Cancel   DELETE /orders/{id} - "Cancels pending order or draft. Charged
 *            amount is returned to the store owner's credit card."
 *            The CUSTOMER's Stripe payment is NOT refunded by this; the page
 *            says so and links to the Stripe dashboard.
 *
 * Both re-read the order first and refuse unless Printful's CURRENT status
 * allows the step (a stale page can never confirm twice or cancel a shipped
 * order). Permission: orders.manage, same as every other order step.
 */
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { printful } from "@/lib/merch-studio/printful-client";
import { getMerchOrder } from "@/lib/orders/merch-orders-server";
import { MERCH_CANCELLABLE, MERCH_CONFIRMABLE, isMerchOrderRef, printfulIdFromHandle } from "@/lib/orders/merch-orders-core";
import { movePayment } from "@/lib/merch/merch-payments-server";

function back(handle: string, backParam: string, key: "merchMsg" | "merchErr", text: string): never {
  const qs = new URLSearchParams();
  if (backParam) qs.set("back", backParam.slice(0, 1500));
  qs.set(key, text.slice(0, 400));
  redirect(`/admin/orders/merch/${encodeURIComponent(handle)}?${qs.toString()}`);
}

async function step(formData: FormData, kind: "confirm" | "cancel"): Promise<void> {
  const session = await requirePermission("orders.manage");
  const handle = String(formData.get("handle") ?? "").trim();
  const backParam = String(formData.get("back") ?? "");
  const id = printfulIdFromHandle(handle);
  if (!id) redirect("/admin/orders#merch-orders");

  const current = await getMerchOrder(handle);
  if (!current.ok) back(handle, backParam, "merchErr", current.error);
  const status = current.order.printfulStatus;
  const allowed = kind === "confirm" ? MERCH_CONFIRMABLE.has(status) : MERCH_CANCELLABLE.has(status);
  if (!allowed) {
    back(handle, backParam, "merchErr", `Printful now says this order is "${status}", so it can't be ${kind === "confirm" ? "confirmed" : "cancelled"} from here. Nothing was changed.`);
  }

  const res = kind === "confirm" ? await printful<unknown>("POST", `/orders/${id}/confirm`) : await printful<unknown>("DELETE", `/orders/${id}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: kind === "confirm" ? "merch.order_confirm" : "merch.order_cancel",
    entityType: "merch_order",
    entityId: handle,
    before: { status },
    after: res.ok ? { ok: true } : { ok: false, error: res.error },
  });
  if (!res.ok) back(handle, backParam, "merchErr", res.error);
  back(
    handle,
    backParam,
    "merchMsg",
    kind === "confirm"
      ? "Confirmed. Printful has charged the card on file and will start production (usually 2-5 business days). The customer is emailed tracking automatically when it ships."
      : "Cancelled at Printful (any Printful charge goes back to the LLC's card). Now do the Stripe half below: refund the customer, or release the card hold.",
  );
}

export async function confirmMerchOrderAction(formData: FormData): Promise<void> {
  await step(formData, "confirm");
}

export async function cancelMerchOrderAction(formData: FormData): Promise<void> {
  await step(formData, "cancel");
}

/**
 * D232 M-7 (G-86, SOP-11 Q-11-4). Owner, verbatim: "Q4: guidance first, but
 * build the button too please and all that goes with it."
 *
 * Refund in Stripe (full amount) or Release the card hold, through the shop's
 * POST /api/payments (MERCH_PAYMENTS_TOKEN). Owner/admin only (merch.refund).
 * The person must type the order reference to confirm; the shop re-reads
 * Stripe and refuses unless the step still applies, and its fixed
 * Idempotency-Key means a double press can never refund twice. Audited
 * (merch.payment_refund / merch.payment_release) with before/after.
 */
export async function moveMerchPaymentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("merch.refund");
  const handle = String(formData.get("handle") ?? "").trim();
  const backParam = String(formData.get("back") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const typed = String(formData.get("confirmRef") ?? "").trim();
  if (!isMerchOrderRef(handle)) redirect("/admin/orders#merch-orders");
  if (kind !== "refund" && kind !== "release") back(handle, backParam, "merchErr", "Unknown payment step. Nothing was changed.");
  if (typed !== handle) back(handle, backParam, "merchErr", `Type the order reference (${handle}) exactly to confirm. Nothing was changed.`);

  const res = await movePayment(handle, kind);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: kind === "refund" ? "merch.payment_refund" : "merch.payment_release",
    entityType: "merch_order",
    entityId: handle,
    before: res.ok ? { status: res.before.status, capturedCents: res.before.capturedCents, refundedCents: res.before.refundedCents, paymentIntent: res.before.id } : null,
    after: res.ok ? { ok: true, status: res.after.status, refundedCents: res.after.refundedCents, stripeId: res.stripeId } : { ok: false, error: res.problem },
  });
  if (!res.ok) back(handle, backParam, "merchErr", res.problem);
  back(
    handle,
    backParam,
    "merchMsg",
    kind === "refund"
      ? `Refunded in Stripe (${(res.after.refundedCents / 100).toFixed(2)} USD). The customer sees it in 5 to 10 business days.`
      : "The card hold was released. The customer was not charged.",
  );
}
