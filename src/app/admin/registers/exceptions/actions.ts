"use server";

/**
 * /admin/registers/exceptions — server actions (POS Slice B12).
 *
 * Resolution is the ONLY write: a manager reviews an exception's full
 * payload, does whatever the reason instructs (intake the card, apply the
 * migration, fix the price, re-ring the sale…), and records a written note.
 * Resolution NEVER replays the event — the register re-sends anything that
 * should be retried, and the durable row keeps the whole story.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { replayStrandedCartAdjustments, resolvePosException } from "@/lib/pos/sync-store";

const BASE = "/admin/registers/exceptions";

export async function resolvePosExceptionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const id = String(formData.get("exception_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing exception id."));

  const result = await resolvePosException(id, { resolvedBy: session.profile.id, note });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.exception_resolved",
    entityType: "pos_sale_event",
    entityId: id,
    after: { note },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?resolved=1`);
}

/**
 * R-CART-1 — record every cart adjustment the old "variantId must be a UUID"
 * rule stranded here, and resolve each with a fixed note. Safe to press
 * twice: the insert is idempotent and the resolve is compare-and-set.
 */
export async function recordStrandedCartAdjustmentsAction(): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const result = await replayStrandedCartAdjustments(session.profile.id);
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "pos.cart_adjustments_replayed",
    entityType: "pos_sale_event",
    entityId: null,
    after: { recorded: result.recorded, left: result.left, failed: result.failed },
  });
  revalidatePath(BASE);
  const problems = [...result.failed, ...result.left];
  if (problems.length > 0) {
    const first = problems[0];
    redirect(
      `${BASE}?error=` +
        encodeURIComponent(
          `Recorded ${result.recorded}. ${problems.length} could not be recorded and are still open (first: ${first.clientUuid.slice(0, 8)}: ${first.why})`,
        ),
    );
  }
  redirect(`${BASE}?replayed=${result.recorded}`);
}
