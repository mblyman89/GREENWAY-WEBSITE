"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import {
  createVendorReturn,
  createCustomerReturn,
  scheduleDestruction,
  completeDestruction,
  cancelDestruction,
  getDestructionEvent,
  updateDispositionSettings,
  updateVendorReturnManifest,
  findReturnableOrderLines,
  dispositionSummary,
  listDestructionEvents,
  listVendorReturns,
  getDispositionSettings,
  type ReturnableOrderLine,
} from "@/lib/inventory/disposition";
import {
  VENDOR_RETURN_REASONS,
  DESTRUCTION_REASONS,
} from "@/lib/inventory/disposition-reasons";
import {
  CUSTOMER_RETURN_REASONS,
  MANIFEST_STATUSES,
} from "@/lib/inventory/disposition-core";
import {
  evaluateDestructionCancel,
  DESTRUCTION_CANCEL_AUDIT_ACTION,
  DESTRUCTION_CANCEL_REFUSED_AUDIT_ACTION,
} from "@/lib/inventory/destruction-lot-status-core";
import {
  generateDispositionAdvice,
  isAiConfigured,
  type DispositionAdvice,
} from "@/lib/inventory/disposition-advisor";

const RET = new Set<string>(VENDOR_RETURN_REASONS);
const DES = new Set<string>(DESTRUCTION_REASONS);
const CUST = new Set<string>(CUSTOMER_RETURN_REASONS);
const MANIFEST = new Set<string>(MANIFEST_STATUSES);

const BASE = "/admin/inventory/disposition";

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

// ── Customer returns (Task Q) ────────────────────────────────────────────────

export type FindReturnableResult =
  | { ok: true; lines: ReturnableOrderLine[] }
  | { ok: false; error: string };

/** Client-callable search for the return wizard (completed orders only). */
export async function findReturnableLinesAction(search: string): Promise<FindReturnableResult> {
  await requirePermission("inventory.manage");
  const q = (search ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters." };
  try {
    const lines = await findReturnableOrderLines(q, 8);
    return { ok: true, lines };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Search failed." };
  }
}

export async function createCustomerReturnAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const orderId = str(formData, "order_id");
  const orderLineId = str(formData, "order_line_id");
  const lotId = str(formData, "lot_id") || null;
  const qty = Number(formData.get("quantity"));
  const disposition = str(formData, "disposition") === "restock" ? "restock" : "destroy";
  const reason = str(formData, "reason") || "other";
  const detail = str(formData, "detail") || null;
  const refundDollars = Number(formData.get("refund_dollars"));
  const refundMinor = Number.isFinite(refundDollars) ? Math.max(0, Math.round(refundDollars * 100)) : 0;
  const originalPackaging = formData.get("original_packaging") === "on";
  const lotIdLegible = formData.get("lot_id_legible") === "on";

  if (!orderId || !orderLineId) redirect(`${BASE}?error=${encodeURIComponent("Pick a completed sale line first.")}`);
  if (!Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=qty`);
  if (!CUST.has(reason)) redirect(`${BASE}?error=reason`);

  const result = await createCustomerReturn(
    {
      orderId,
      orderLineId,
      lotId,
      quantity: qty,
      disposition,
      reason,
      detail,
      refundMinor,
      originalPackaging,
      lotIdLegible,
    },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "customer_return.create",
    entityType: "customer_returns",
    entityId: result.id,
    after: { order_id: orderId, order_line_id: orderLineId, quantity: qty, disposition, reason, refund_minor: refundMinor },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=customer_return`);
}

// ── Vendor returns ───────────────────────────────────────────────────────────

export async function createVendorReturnAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = str(formData, "lot_id");
  const reason = str(formData, "reason") || "other";
  const detail = str(formData, "detail") || null;
  const rma = str(formData, "rma_number") || null;
  const manifestNumber = str(formData, "manifest_number") || null;
  const processorLicense = str(formData, "processor_license") || null;
  const qty = Number(formData.get("quantity"));
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=qty`);
  if (!RET.has(reason)) redirect(`${BASE}?error=reason`);

  const result = await createVendorReturn(
    { lotId, quantity: qty, reason, detail, rmaNumber: rma, manifestNumber, processorLicense },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.create",
    entityType: "vendor_returns",
    entityId: result.id,
    after: { lot_id: lotId, quantity: qty, reason, rma_number: rma, manifest_number: manifestNumber },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=returned`);
}

export async function updateManifestAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const status = str(formData, "manifest_status");
  const manifestNumber = str(formData, "manifest_number") || null;
  const pickupAt = str(formData, "pickup_at") || null;
  if (!MANIFEST.has(status)) redirect(`${BASE}?error=${encodeURIComponent("Invalid manifest status.")}`);

  const result = await updateVendorReturnManifest(
    { id, manifestStatus: status, manifestNumber, pickupAt },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.manifest",
    entityType: "vendor_returns",
    entityId: id,
    after: { manifest_status: status, manifest_number: manifestNumber, pickup_at: pickupAt },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=manifest`);
}

// ── Destructions ─────────────────────────────────────────────────────────────

export async function scheduleDestructionAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = str(formData, "lot_id");
  const reason = str(formData, "reason") || "other";
  const detail = str(formData, "detail") || null;
  const qty = Number(formData.get("quantity"));
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=qty`);
  if (!DES.has(reason)) redirect(`${BASE}?error=reason`);

  const result = await scheduleDestruction({ lotId, quantity: qty, reason, detail }, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "destruction.schedule",
    entityType: "destruction_events",
    entityId: result.id,
    after: { lot_id: lotId, quantity: qty, reason },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${lotId}`);
  // Fix Phase 1.3 (G-28): an Active lot just moved to Quarantine, so the
  // register and the website must stop offering it.
  await revalidatePublicMenuSurfaces();
  redirect(`${BASE}?ok=scheduled`);
}

export async function completeDestructionAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const witnessedBy = str(formData, "witnessed_by") || null;
  const renderingMethod = str(formData, "rendering_method") || null;
  const mixMaterial = str(formData, "mix_material") || null;
  const fiftyPercentAttested = formData.get("fifty_percent") === "on";
  const finalDestination = str(formData, "final_destination") || null;
  const disposalFacility = str(formData, "disposal_facility") || null;
  const lcbCoordinated = formData.get("lcb_coordinated") === "on";
  const lcbOfficer = str(formData, "lcb_officer") || null;
  const lcbContactDate = str(formData, "lcb_contact_date") || null;

  const result = await completeDestruction(
    {
      id,
      witnessedBy,
      renderingMethod,
      mixMaterial,
      fiftyPercentAttested,
      finalDestination,
      disposalFacility,
      lcbCoordinated,
      lcbOfficer,
      lcbContactDate,
    },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "destruction.complete",
    entityType: "destruction_events",
    entityId: id,
    after: {
      rendering_method: renderingMethod,
      mix_material: mixMaterial,
      final_destination: finalDestination,
      disposal_facility: disposalFacility,
      witnessed_by: witnessedBy,
      lcb_coordinated: lcbCoordinated,
      lcb_officer: lcbOfficer,
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}?ok=destroyed`);
}

/**
 * Fix Phase 1.3 (G-28 req 3 + 6; F-05a-19, F-15-9). Before: any manager
 * could cancel, no reason was asked, and the lot was always set Active. Now:
 * the owner only (inventory.destruction.cancel; SOP-15 §2 rule 3), a written
 * reason is required, the lot goes back to the status it had before
 * scheduling (never blindly Active; a customer-return event never touches
 * the lot), and the audit row keeps the reason and the lot status before and
 * after. A refused cancel is audited too.
 */
export async function cancelDestructionAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const reason = (formData.get("cancel_reason") as string | null) ?? "";
  const event = await getDestructionEvent(id);
  const decision = evaluateDestructionCancel({
    eventStatus: event?.status ?? null,
    canCancel: can(session.profile.role, "inventory.destruction.cancel"),
    reason,
  });
  if (!decision.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: DESTRUCTION_CANCEL_REFUSED_AUDIT_ACTION,
      entityType: "destruction_events",
      entityId: id,
      after: { reason: reason.trim().slice(0, 500) || null, refusals: decision.refusals.map((r) => r.code) },
    });
    const msg = decision.refusals.map((r) => r.message).join(" ");
    redirect(`${BASE}?error=${encodeURIComponent(msg.slice(0, 900))}`);
  }
  const result = await cancelDestruction(id, session.userId, decision.reason);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: DESTRUCTION_CANCEL_AUDIT_ACTION,
    entityType: "destruction_events",
    entityId: id,
    before: { event_status: event?.status ?? null, lot_status: result.lotBefore, previous_lot_status: result.previousLotStatus },
    after: {
      event_status: "cancelled",
      reason: decision.reason,
      lot_id: result.lotId,
      lot_status: result.lotAfter,
      lot_outcome: result.lotAction.why,
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${result.lotId}`);
  if (result.lotAfter !== result.lotBefore) await revalidatePublicMenuSurfaces();
  redirect(`${BASE}?ok=cancelled&lotmsg=${encodeURIComponent(result.lotAction.why)}`);
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function updateDispositionSettingsAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  if (!can(session.profile.role, "settings.manage")) {
    redirect(`${BASE}?error=${encodeURIComponent("Changing the hold policy requires admin.")}`);
  }
  const holdHours = Number(formData.get("hold_hours"));
  const result = await updateDispositionSettings({ holdHours }, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "disposition_settings.update",
    entityType: "disposition_settings",
    entityId: "singleton",
    after: { hold_hours: holdHours },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=settings`);
}

// ── AI advisor (drafts-only) ─────────────────────────────────────────────────

export type DispositionAdvisorResult =
  | { ok: true; advice: DispositionAdvice }
  | { ok: false; error: string };

export async function generateDispositionAdviceAction(
  question?: string,
): Promise<DispositionAdvisorResult> {
  await requirePermission("inventory.manage");
  if (!isAiConfigured) return { ok: false, error: "AI is not configured (set AI_API_KEY)." };
  try {
    const [summary, destructions, vendorReturns, settings] = await Promise.all([
      dispositionSummary(),
      listDestructionEvents(200),
      listVendorReturns(200),
      getDispositionSettings(),
    ]);
    const open = destructions.filter((d) => d.status === "pending_quarantine" || d.status === "ready");
    const ready = open.filter((d) => d.hold_elapsed);
    const recallsOpen = open.filter((d) => d.reason === "recall");
    const awaitingManifest = vendorReturns.filter((r) => {
      const s = (r.manifest_status ?? "none") as string;
      return s !== "picked_up";
    });
    const advice = await generateDispositionAdvice({
      summary,
      holdHours: settings.holdHours,
      destructionsReadyToComplete: ready.length,
      destructionsStillHeld: open.length - ready.length,
      recallDestructionsOpen: recallsOpen.length,
      vendorReturnsAwaitingManifest: awaitingManifest.length,
      aiQuestion: question ?? null,
    });
    return { ok: true, advice };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Advisor failed." };
  }
}
