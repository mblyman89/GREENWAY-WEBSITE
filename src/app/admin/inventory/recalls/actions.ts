"use server";

/**
 * Fix Phase 1.6c (G-25; F-05a-15, F-05a-16): the recall event log (form 8.5).
 *
 * A manager opens the event and adds the affected lots the hour the notice
 * arrives (SOP-05a §4.10). Adding a lot sets it Recalled through the G-22
 * audited path: evaluateLotLifecycleChange then updateLotStatus, with the same
 * audit row setLotStatusAction writes, then the public menu is refreshed.
 * The LCB notification, the weekly rows and the close-out are the recall
 * coordinator's (the admin, D37) and the owner's: inventory.recall.release.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { can } from "@/lib/auth/roles";
import {
  evaluateLotLifecycleChange,
  LOT_STATUS_AUDIT_ACTION,
  LOT_STATUS_REFUSED_AUDIT_ACTION,
} from "@/lib/inventory/lot-lifecycle-core";
import { getLotGateFacts, updateLotStatus } from "@/lib/inventory/store";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { pacificInputToIso } from "@/lib/inventory/vendor-return-core";
import { pacificToday } from "@/lib/reports/timezone";
import {
  evaluateRecallEventCreate,
  evaluateLcbNotification,
  evaluateWeeklyRow,
  evaluateRecallClose,
  RECALL_EVENT_AUDIT,
} from "@/lib/inventory/recall-event-core";
import {
  createRecallEvent,
  getRecallEvent,
  linkLotToRecallEvent,
  recordLcbNotification,
  addRecallWeeklyRow,
  closeRecallEvent,
} from "@/lib/inventory/recall-event-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const BASE = "/admin/inventory/recalls";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? 0 : Number(v);
};
const back = (path: string, msg: string): never => redirect(`${path}?error=${encodeURIComponent(msg.slice(0, 900))}`);

export async function createRecallEventAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const input = {
    type: str(formData, "type"),
    product: str(formData, "product"),
    vendorName: str(formData, "vendor_name") || null,
    lotNumbersGiven: str(formData, "lot_numbers_given") || null,
    reason: str(formData, "reason"),
    recallReference: str(formData, "recall_reference") || null,
    noticeSource: str(formData, "notice_source"),
    noticeMethod: str(formData, "notice_method"),
    receivedAtIso: pacificInputToIso(str(formData, "received_date"), str(formData, "received_time")),
  };
  const v = evaluateRecallEventCreate({ ...input, nowIso: new Date().toISOString() });
  if (!v.ok) back(BASE, v.refusals.map((r) => r.message).join(" "));
  const res = await createRecallEvent({ ...input, receivedAtIso: input.receivedAtIso as string }, session.profile.id);
  if (!res.ok) back(BASE, res.error);
  const id = (res as { ok: true; id: string }).id;
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.create,
    entityType: "recall_event",
    entityId: id,
    after: { type: input.type, product: input.product, reason: input.reason, received_at: input.receivedAtIso, source: input.noticeSource },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${BASE}/${id}?saved=created`);
}

/**
 * Add one lot to the event and set it Recalled (G-22 audited path). A lot
 * that is already Recalled is linked without a status change.
 */
export async function addLotToRecallEventAction(eventId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const page = `${BASE}/${eventId}`;
  const lotId = str(formData, "lot_id");
  if (!lotId) back(page, "Choose the affected lot.");
  const detail = await getRecallEvent(eventId);
  if (!detail) back(BASE, "Recall event not found.");
  const ev = detail!.event;
  if (ev.status !== "open") back(page, "This recall event is closed.");

  const current = await getLotGateFacts(lotId);
  if (!current) back(page, "Lot not found.");
  const admin = createSupabaseAdminClient();
  const { data: lotRow } = await admin.from("inventory_lots").select("on_hand_qty").eq("id", lotId).maybeSingle();
  const onHand = lotRow ? Number((lotRow as { on_hand_qty: number | null }).on_hand_qty ?? 0) : null;
  const reference = (ev.recall_reference || `Recall event #${ev.event_number ?? ev.id}`).slice(0, 200);
  const reason = `${ev.type === "market_withdrawal" ? "Market withdrawal" : "Recall"} event #${ev.event_number ?? ""}: ${ev.reason}`.slice(0, 500);

  if (current!.status !== "recalled") {
    const decision = evaluateLotLifecycleChange({
      fromStatus: current!.status,
      toStatus: "recalled",
      reason,
      reference,
      canReleaseRecall: can(session.profile.role, "inventory.recall.release"),
      gateFacts: current!.facts,
    });
    if (!decision.ok) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: LOT_STATUS_REFUSED_AUDIT_ACTION,
        entityType: "inventory_lot",
        entityId: lotId,
        before: { status: current!.status },
        after: { requested: "recalled", reason, reference, refusals: decision.refusals.map((r) => r.code), recall_event_id: eventId },
      });
      back(page, decision.refusals.map((r) => r.message).join(" "));
    }
    const d = decision as Extract<typeof decision, { ok: true }>;
    const upd = await updateLotStatus(lotId, d.from, d.to, session.userId);
    if (!upd.ok) back(page, upd.error);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: LOT_STATUS_AUDIT_ACTION,
      entityType: "inventory_lot",
      entityId: lotId,
      before: { status: d.from },
      after: { status: d.to, reason: d.reason, reference: d.reference, releases_recall: false, go_live_checked: false, recall_event_id: eventId },
    });
  }
  const link = await linkLotToRecallEvent(eventId, lotId, onHand, current!.status, session.profile.id);
  if (!link.ok) back(page, link.error);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.addLot,
    entityType: "recall_event",
    entityId: eventId,
    after: { lot_id: lotId, previous_status: current!.status, on_hand: onHand },
  });
  // The lot now holds its product off the register, the website and online ordering.
  revalidatePublicMenuSurfaces();
  revalidatePath(page);
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  redirect(`${page}?saved=lot`);
}

export async function recordLcbNotificationAction(eventId: string, formData: FormData) {
  const session = await requirePermission("inventory.recall.release");
  const page = `${BASE}/${eventId}`;
  const detail = await getRecallEvent(eventId);
  if (!detail) back(BASE, "Recall event not found.");
  const ev = detail!.event;
  const input = {
    officer: str(formData, "lcb_officer"),
    method: str(formData, "lcb_method"),
    notifiedAtIso: pacificInputToIso(str(formData, "lcb_date"), str(formData, "lcb_time")),
    notes: str(formData, "lcb_notes") || null,
  };
  const v = evaluateLcbNotification({
    ...input,
    receivedAtIso: ev.received_at,
    nowIso: new Date().toISOString(),
    alreadyNotified: !!ev.lcb_notified_at,
    eventOpen: ev.status === "open",
  });
  if (!v.ok) back(page, v.refusals.map((r) => r.message).join(" "));
  const res = await recordLcbNotification(eventId, { ...input, notifiedAtIso: input.notifiedAtIso as string }, session.profile.id);
  if (!res.ok) back(page, res.error);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.lcbNotified,
    entityType: "recall_event",
    entityId: eventId,
    after: { officer: input.officer, method: input.method, notified_at: input.notifiedAtIso },
  });
  revalidatePath(page);
  revalidatePath("/admin/inventory");
  redirect(`${page}?saved=lcb`);
}

export async function addRecallWeeklyRowAction(eventId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const page = `${BASE}/${eventId}`;
  const detail = await getRecallEvent(eventId);
  if (!detail) back(BASE, "Recall event not found.");
  const row = {
    weekOf: str(formData, "week_of"),
    held: num(formData, "held"),
    returnedByCustomers: num(formData, "returned_by_customers"),
    returnedToVendor: num(formData, "returned_to_vendor"),
    destroyed: num(formData, "destroyed"),
    soldBeforeHold: num(formData, "sold_before_hold"),
    reportedToLcbOn: str(formData, "reported_to_lcb_on"),
    notes: str(formData, "notes") || null,
  };
  const v = evaluateWeeklyRow({
    ...row,
    todayPacific: pacificToday(),
    eventOpen: detail!.event.status === "open",
    existingWeeks: detail!.weekly.map((w) => w.week_of),
  });
  if (!v.ok) back(page, v.refusals.map((r) => r.message).join(" "));
  const res = await addRecallWeeklyRow(eventId, { ...row, reportedToLcbOn: row.reportedToLcbOn || null }, session.profile.id);
  if (!res.ok) back(page, res.error);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.weekly,
    entityType: "recall_event",
    entityId: eventId,
    after: row,
  });
  revalidatePath(page);
  revalidatePath("/admin/inventory");
  redirect(`${page}?saved=weekly`);
}

export async function closeRecallEventAction(eventId: string, formData: FormData) {
  const session = await requirePermission("inventory.recall.release");
  const page = `${BASE}/${eventId}`;
  const detail = await getRecallEvent(eventId);
  if (!detail) back(BASE, "Recall event not found.");
  const outcome = str(formData, "outcome");
  const clearanceReference = str(formData, "clearance_reference");
  const lots = detail!.lots.map((l) => l.lot).filter((l): l is NonNullable<typeof l> => !!l);
  const stillRecalled = lots.filter((l) => l.status === "recalled");
  const v = evaluateRecallClose({
    outcome,
    clearanceReference,
    lcbNotified: !!detail!.event.lcb_notified_at,
    eventOpen: detail!.event.status === "open",
    lotsStillHeld: stillRecalled.filter((l) => Number(l.on_hand_qty ?? 0) > 0).length,
    lotsStillRecalled: stillRecalled.length,
  });
  if (!v.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: RECALL_EVENT_AUDIT.refused,
      entityType: "recall_event",
      entityId: eventId,
      after: { step: "close", outcome, refusals: v.refusals.map((r) => r.code) },
    });
    back(page, v.refusals.map((r) => r.message).join(" "));
  }
  const res = await closeRecallEvent(
    eventId,
    { outcome, clearanceReference: clearanceReference || null, planDepartures: str(formData, "plan_departures") || null },
    session.profile.id,
  );
  if (!res.ok) back(page, res.error);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.close,
    entityType: "recall_event",
    entityId: eventId,
    after: { outcome, clearance_reference: clearanceReference || null },
  });
  revalidatePath(page);
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  redirect(`${page}?saved=closed`);
}
