"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import {
  createVendorReturn,
  scheduleDestruction,
  completeDestruction,
  cancelDestruction,
  getDestructionEvent,
  updateDispositionSettings,
  updateVendorReturnManifest,
  updateVendorReturnTransport,
  cancelVendorReturn,
  getVendorReturn,
  dispositionSummary,
  listDestructionEvents,
  listVendorReturns,
  getDispositionSettings,
} from "@/lib/inventory/disposition";
import {
  VENDOR_RETURN_REASONS,
  DESTRUCTION_REASONS,
} from "@/lib/inventory/disposition-reasons";
import {
  VENDOR_RETURN_STATUSES,
  evaluateVendorReturnCancel,
  isLegacyReducedReturn,
  isOpenVendorReturn,
  pacificInputToIso,
  VENDOR_RETURN_CANCEL_AUDIT_ACTION,
  VENDOR_RETURN_DEPART_AUDIT_ACTION,
} from "@/lib/inventory/vendor-return-core";
import {
  evaluateDestructionCancel,
  DESTRUCTION_CANCEL_AUDIT_ACTION,
  DESTRUCTION_CANCEL_REFUSED_AUDIT_ACTION,
} from "@/lib/inventory/destruction-lot-status-core";
import {
  evaluateDestructionRecord,
  witnessLine,
  DESTRUCTION_COMPLETE_AUDIT_ACTION,
} from "@/lib/inventory/destruction-record-core";
import { listEmployees } from "@/lib/staffing/store";
import {
  generateDispositionAdvice,
  isAiConfigured,
  type DispositionAdvice,
} from "@/lib/inventory/disposition-advisor";

const RET = new Set<string>(VENDOR_RETURN_REASONS);
const DES = new Set<string>(DESTRUCTION_REASONS);
const MANIFEST = new Set<string>(VENDOR_RETURN_STATUSES);

const BASE = "/admin/inventory/disposition";

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

/** A positive number typed on the form, or null (blank = use the lot's own value). */
function posNum(v: string): number | null {
  const n = Number(v);
  return v !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

// ── Customer returns ─────────────────────────────────────────────────────
// Fix Phase 7.1 (G-45, owner D66: "Q4- remove it."): the back-office
// Customer return wizard and its two actions are gone. Customer returns go
// through the register's Return an item and the Returns desk
// (/admin/registers/returns) only; both run the store return policy and work
// out the refund (returns-store.ts processCounterReturn).

// ── Vendor returns ───────────────────────────────────────────────────────────

/**
 * Fix Phase 1.5 (G-42; F-15-1, F-15-2): logging RESERVES the units (D63 (4)).
 * RMA, vendor, processor license and detail are required (checked again in
 * createVendorReturn); a Recall return carries the LCB officer and date (D65).
 */
export async function createVendorReturnAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = str(formData, "lot_id");
  const reason = str(formData, "reason");
  const detail = str(formData, "detail") || null;
  const rma = str(formData, "rma_number") || null;
  const vendorId = str(formData, "vendor_id") || null;
  const processorLicense = str(formData, "processor_license") || null;
  const recallOfficer = str(formData, "recall_officer") || null;
  const recallContactDate = str(formData, "recall_contact_date") || null;
  const qty = Number(formData.get("quantity"));
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=${encodeURIComponent("Choose a lot and enter a quantity greater than zero.")}`);
  if (!RET.has(reason)) redirect(`${BASE}?error=${encodeURIComponent("Choose a reason for the vendor return.")}`);

  const result = await createVendorReturn(
    { lotId, vendorId, quantity: qty, reason, detail, rmaNumber: rma, processorLicense, recallOfficer, recallContactDate },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.create",
    entityType: "vendor_returns",
    entityId: result.id,
    after: {
      lot_id: lotId,
      vendor_id: vendorId,
      quantity: qty,
      reason,
      rma_number: rma,
      processor_license: processorLicense,
      reserved: qty,
      // Fix Phase 1.6c (G-42 req 6): the values the server took from the recall event.
      recall_officer: result.recallOfficer,
      recall_contact_date: result.recallContactDate,
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${lotId}`);
  await revalidatePublicMenuSurfaces();
  redirect(`${BASE}?ok=returned`);
}

/** Fix Phase 1.5 (G-42 v1.1 item 8): the transport details Manifest.CSV needs. */
export async function updateVendorReturnTransportAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const estDepartureAt = pacificInputToIso(str(formData, "est_departure_date"), str(formData, "est_departure_time"));
  const estArrivalAt = pacificInputToIso(str(formData, "est_arrival_date"), str(formData, "est_arrival_time"));
  const input = {
    id,
    transportationType: str(formData, "transportation_type"),
    transporterLicense: str(formData, "transporter_license") || null,
    driverName: str(formData, "driver_name") || null,
    vin: str(formData, "vehicle_vin") || null,
    plate: str(formData, "vehicle_plate") || null,
    make: str(formData, "vehicle_make") || null,
    model: str(formData, "vehicle_model") || null,
    color: str(formData, "vehicle_color") || null,
    estDepartureAt,
    estArrivalAt,
    weightPerUnitG: posNum(str(formData, "weight_per_unit_g")),
    servingsPerUnit: posNum(str(formData, "servings_per_unit")),
  };
  const result = await updateVendorReturnTransport(input);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.transport",
    entityType: "vendor_returns",
    entityId: id,
    after: { ...input, id: undefined },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=transport`);
}

/**
 * Fix Phase 1.5 (G-42 req 3, 4; F-15-3): one step at a time, checked on the
 * server. Departure takes the pickup date and time as Pacific wall time.
 */
export async function updateManifestAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const status = str(formData, "manifest_status");
  const manifestNumber = str(formData, "manifest_number") || null;
  const lcbEmailDate = str(formData, "lcb_email_date") || null;
  const pickupIso = pacificInputToIso(str(formData, "pickup_date"), str(formData, "pickup_time"));
  const driverName = str(formData, "driver_name") || null;
  if (!MANIFEST.has(status) || status === "cancelled") redirect(`${BASE}?error=${encodeURIComponent("Invalid manifest step.")}`);
  const before = await getVendorReturn(id);

  const result = await updateVendorReturnManifest(
    { id, manifestStatus: status, manifestNumber, lcbEmailDate, pickupIso, driverName },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: status === "picked_up" ? VENDOR_RETURN_DEPART_AUDIT_ACTION : "vendor_return.manifest",
    entityType: "vendor_returns",
    entityId: id,
    before: { manifest_status: before?.manifest_status ?? null, reserved_qty: before?.reserved_qty ?? null },
    after: {
      manifest_status: status,
      manifest_number: manifestNumber,
      lcb_email_date: lcbEmailDate,
      pickup_at: pickupIso,
      driver_name: driverName,
      adjustment_id: result.adjustmentId ?? null,
      legacy_reduced_at_logging: before ? isLegacyReducedReturn(before) : null,
    },
  });
  revalidatePath(BASE);
  if (status === "picked_up") {
    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/${result.lotId}`);
  }
  redirect(`${BASE}?ok=${status === "picked_up" ? "departed" : "manifest"}`);
}

/** Fix Phase 1.5 (G-42 req 5): the owner cancels with a reason; the reserved units are released. */
export async function cancelVendorReturnAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const reason = str(formData, "cancel_reason");
  const current = await getVendorReturn(id);
  const decision = evaluateVendorReturnCancel({
    status: current?.manifest_status ?? null,
    canCancel: can(session.profile.role, "inventory.vendor_return.cancel"),
    legacyReduced: current ? isLegacyReducedReturn(current) : false,
    reason,
  });
  if (!current || !decision.ok) {
    const msg = !current ? "Vendor return not found." : decision.ok ? "" : decision.refusals.map((r) => r.message).join(" ");
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: `${VENDOR_RETURN_CANCEL_AUDIT_ACTION}_refused`,
      entityType: "vendor_returns",
      entityId: id,
      after: { reason: reason.slice(0, 500) || null, message: msg.slice(0, 500) },
    });
    redirect(`${BASE}?error=${encodeURIComponent(msg.slice(0, 900))}`);
  }
  const result = await cancelVendorReturn(id, session.userId, decision.reason);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: VENDOR_RETURN_CANCEL_AUDIT_ACTION,
    entityType: "vendor_returns",
    entityId: id,
    before: { manifest_status: current.manifest_status ?? null, reserved_qty: current.reserved_qty ?? null },
    after: { manifest_status: "cancelled", reason: decision.reason, released: result.released, lot_id: result.lotId },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${result.lotId}`);
  if (result.released > 0) await revalidatePublicMenuSurfaces();
  redirect(`${BASE}?ok=vr_cancelled&held=${encodeURIComponent(String(result.released))}`);
}

// ── Destructions ─────────────────────────────────────────────────────────────

export async function scheduleDestructionAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = str(formData, "lot_id");
  const reason = str(formData, "reason") || "other";
  const detail = str(formData, "detail") || null;
  const qty = Number(formData.get("quantity"));
  // G-46 (F-15-13): codes the page turns into sentences (disposition-messages-core).
  if (!lotId || !Number.isFinite(qty) || qty <= 0) redirect(`${BASE}?error=destroy_qty`);
  if (!DES.has(reason)) redirect(`${BASE}?error=destroy_reason`);

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
  const renderingMethod = str(formData, "rendering_method") || null;
  // Fix Phase 1.6a (G-43; D64: "anyone may witness the destruction. It has to
  // be done on camera as well."): a second person from the roster, not the
  // one completing, and a camera reference, checked here on the server.
  const witnessEmployeeId = str(formData, "witness_employee_id") || null;
  const cameraName = str(formData, "camera_name") || null;
  const cameraDate = str(formData, "camera_date");
  const cameraStartAt = pacificInputToIso(cameraDate, str(formData, "camera_start"));
  const cameraEndAt = pacificInputToIso(cameraDate, str(formData, "camera_end"));
  const otherApprovalRef = str(formData, "other_approval_ref") || null;
  const otherApprovalDate = str(formData, "other_approval_date") || null;
  const roster = await listEmployees();
  const actorName = session.profile.full_name ?? session.email ?? null;
  const record = evaluateDestructionRecord({
    witnessEmployeeId,
    roster,
    actorUserId: session.userId,
    actorName,
    cameraName,
    cameraStartIso: cameraStartAt,
    cameraEndIso: cameraEndAt,
    renderingMethod: renderingMethod ?? "",
    otherApprovalRef,
    otherApprovalDate,
    nowMs: Date.now(),
  });
  if (!record.ok) {
    const msg = record.refusals.map((r) => r.message).join(" ");
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: `${DESTRUCTION_COMPLETE_AUDIT_ACTION}_refused`,
      entityType: "destruction_events",
      entityId: id,
      after: { codes: record.refusals.map((r) => r.code), message: msg.slice(0, 500) },
    });
    redirect(`${BASE}?error=${encodeURIComponent(msg.slice(0, 900))}`);
  }
  const witnessedBy = witnessLine({
    witnessName: record.witness.full_name,
    actorName,
    cameraName: cameraName as string,
    cameraStartIso: cameraStartAt as string,
    cameraEndIso: cameraEndAt as string,
  });
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
      record: {
        witnessEmployeeId: record.witness.id,
        witnessName: record.witness.full_name,
        cameraName: cameraName as string,
        cameraStartAt: cameraStartAt as string,
        cameraEndAt: cameraEndAt as string,
        otherApprovalRef,
        otherApprovalDate,
      },
    },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: DESTRUCTION_COMPLETE_AUDIT_ACTION,
    entityType: "destruction_events",
    entityId: id,
    after: {
      rendering_method: renderingMethod,
      mix_material: mixMaterial,
      final_destination: finalDestination,
      disposal_facility: disposalFacility,
      witnessed_by: witnessedBy,
      witness_employee_id: record.witness.id,
      camera_name: cameraName,
      camera_start_at: cameraStartAt,
      camera_end_at: cameraEndAt,
      other_method_approval_ref: otherApprovalRef,
      other_method_approval_date: otherApprovalDate,
      lcb_coordinated: lcbCoordinated,
      lcb_officer: lcbOfficer,
      lcb_contact_date: lcbContactDate,
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
      held_released: result.heldReleased,
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${result.lotId}`);
  if (result.lotAfter !== result.lotBefore || result.heldReleased > 0) await revalidatePublicMenuSurfaces();
  const heldPart = result.heldReleased > 0 ? `&held=${encodeURIComponent(String(result.heldReleased))}` : "";
  redirect(`${BASE}?ok=cancelled&lotmsg=${encodeURIComponent(result.lotAction.why)}${heldPart}`);
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
    // Fix Phase 1.5: a cancelled return is closed too.
    const awaitingManifest = vendorReturns.filter((r) => isOpenVendorReturn(r.manifest_status));
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
