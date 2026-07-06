"use server";

/**
 * Server actions for the Slice 7 order dashboard. Each mutating action checks
 * the staff permission, performs the change via the orders store, and records an
 * audit log entry. AI is not involved here — these are human-driven workflow
 * transitions.
 *
 * Phase A (GAP H-1 / H-2): the → completed transition is now a COMPLIANCE
 * GATE. Before an order can complete:
 *   - the stored money is recomputed from the lines (server truth; S-2b), and
 *   - the cart is re-evaluated against the WAC 314-55-095 sales limits with a
 *     HARD BLOCK when over (S-1b). A manager override requires the separate
 *     `sales_limit.override` permission + a written reason, and is logged to
 *     `sales_limit_events` for the owner's audit panel.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, getStaffSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { setOrderStatus, updateStaffNote, getOrder } from "@/lib/orders/orders-store";
import { verifyStoredOrderForCompletion } from "@/lib/orders/order-pricing";
import { enforceSalesLimitForSale } from "@/lib/compliance/sales-limits";
import type { OrderStatus } from "@/lib/orders/types";

const VALID_STATUSES: OrderStatus[] = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
];

function actorLabel(email: string, fullName: string | null): string {
  return fullName?.trim() ? `${fullName.trim()} (${email})` : email;
}

/**
 * The → completed compliance gate. Returns null when the order may complete,
 * or a human-readable refusal message when it must not.
 */
async function runCompletionGate(opts: {
  orderId: string;
  actorId: string;
  overridePermitted: boolean;
  overrideReason: string | null;
}): Promise<string | null> {
  const order = await getOrder(opts.orderId);
  if (!order) return "Order not found.";
  if (order.status === "completed") return null; // idempotent re-complete

  // ── S-2b: money recompute gate ─────────────────────────────────────────
  const check = await verifyStoredOrderForCompletion(order);
  if (!check.ok) {
    return `Money check failed — fix the order first. ${check.problems.join(" ")}`;
  }

  // ── S-1b: sales-limit HARD gate ────────────────────────────────────────
  // Online guests are recreational; medical status is verified in store and
  // handled by the in-store POS path when it lands.
  const { verdict } = await enforceSalesLimitForSale(check.limitLines, "recreational", {
    orderId: opts.orderId,
    actorId: opts.actorId,
    override: opts.overridePermitted
      ? { permitted: true, reason: opts.overrideReason }
      : null,
  });

  if (!verdict.allowed) {
    const reasons = verdict.reasons.length ? verdict.reasons.join(" ") : "Cart exceeds a statutory limit.";
    return `Sale blocked by WAC 314-55-095 limits: ${reasons} Reduce quantities, or a manager can apply a logged override with a reason.`;
  }
  return null;
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const toStatus = String(formData.get("status") ?? "") as OrderStatus;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !VALID_STATUSES.includes(toStatus)) return;

  // ── COMPLETION COMPLIANCE GATE (S-1b + S-2b) ───────────────────────────
  if (toStatus === "completed") {
    // Manager override: requires the SEPARATE permission + a written reason.
    const overrideRequested = String(formData.get("override") ?? "") === "1";
    const overrideReason = String(formData.get("overrideReason") ?? "").trim() || null;
    const fullSession = await getStaffSession();
    const overridePermitted =
      overrideRequested &&
      !!overrideReason &&
      !!fullSession &&
      can(fullSession.profile.role, "sales_limit.override");

    const refusal = await runCompletionGate({
      orderId: id,
      actorId: session.profile.id,
      overridePermitted,
      overrideReason,
    });

    if (refusal) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "order.completion_blocked",
        entityType: "order",
        entityId: id,
        after: { reason: refusal, overrideRequested },
      });
      revalidatePath(`/admin/orders/${id}`);
      redirect(`/admin/orders/${id}?blocked=${encodeURIComponent(refusal.slice(0, 500))}`);
    }

    if (overridePermitted) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "order.limit_override_applied",
        entityType: "order",
        entityId: id,
        after: { reason: overrideReason },
      });
    }
  }

  const updated = await setOrderStatus(id, toStatus, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
    note,
  });

  if (updated) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.status_changed",
      entityType: "order",
      entityId: id,
      after: { status: toStatus, order_number: updated.order_number, note },
    });
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

export async function updateOrderNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return;

  const ok = await updateStaffNote(id, note, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });

  if (ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.note_updated",
      entityType: "order",
      entityId: id,
      after: { note },
    });
  }

  revalidatePath(`/admin/orders/${id}`);
}
