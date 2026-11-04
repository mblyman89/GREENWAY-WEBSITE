/**
 * src/lib/pos/offline-reversal-store.ts — D170 O2/O3: apply a void or a
 * return the register did while OFFLINE (queued `reversal` event, 0341).
 *
 * The REAL machinery runs (processVoidSale / processCounterReturn), judged
 * as of the time the cash moved (envelope.occurredAt), so a same-day void
 * that syncs the next morning is still same-day. The approver is re-checked
 * against who is an active manager or lead NOW; the approval is the control,
 * so a doubtful approver is refused (an exception for review), never applied.
 *
 * Idempotent: a replay finds its own audit row (void) or its tagged return
 * row (return) and stops. A void of a sale the server never accepted cancels
 * cleanly (nothing moved server-side) and is noted on that sale's exception.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { processVoidSale } from "./void-store";
import { lookupSaleByReceipt, processCounterReturn } from "./returns-store";
import { assignReturnRefund } from "@/lib/registers/drawer-figure-store";
import { OFFLINE_APPROVER_ROLES } from "./offline-unlock-core";
import { bookReceipt, matchOrderLine, reversalExceptionReason, reversalTag, validateReversalPayload } from "./offline-reversal-core";
import type { PosEventEnvelope } from "./sale-event-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type OfflineReversalOutcome = { ok: true } | { ok: false; reason: string };

export async function applyOfflineReversal(admin: Admin, envelope: PosEventEnvelope): Promise<OfflineReversalOutcome> {
  const v = validateReversalPayload(envelope.payload);
  if (!v.ok) return { ok: false, reason: `Invalid offline void/return: ${v.errors.join(" ")}` };
  const p = v.payload;
  const tag = reversalTag(envelope.clientUuid);
  const fail = (why: string): OfflineReversalOutcome => ({ ok: false, reason: reversalExceptionReason(p, why) });

  // ── Approver, judged NOW ────────────────────────────────────────────────
  const { data: emp } = await admin
    .from("employees")
    .select("id, full_name, staff_id, job_role, active")
    .eq("id", p.approver.employeeId)
    .maybeSingle<{ id: string; full_name: string; staff_id: string | null; job_role: string; active: boolean }>();
  if (!emp) return fail("the approving PIN belongs to an employee id the server does not know.");
  if (emp.active !== true) return fail(`${emp.full_name} is no longer an active employee.`);
  if (!OFFLINE_APPROVER_ROLES.includes(emp.job_role)) return fail(`${emp.full_name} is not a manager or lead now.`);

  // ── The sale behind it, as the server saw it ────────────────────────────
  const { data: saleRow } = await admin
    .from("pos_sale_events")
    .select("id, status, register_id, exception_reason")
    .eq("client_uuid", p.saleClientUuid)
    .maybeSingle<{ id: string; status: string; register_id: string; exception_reason: string | null }>();
  if (!saleRow) return fail("the sale it names never reached the server.");
  if (saleRow.register_id !== envelope.registerId) return fail("the sale was rung on another register.");

  // A sale the server never accepted: nothing moved (no order, stock or
  // points), so a void cancels it cleanly. A return of it cannot be applied.
  if (saleRow.status !== "processed") {
    if (p.kind === "return") return fail(`the sale itself is not accepted on the server (${saleRow.status}).`);
    const note = `VOIDED at the counter offline (${envelope.occurredAt}) by ${emp.full_name}, $${(p.refundMinor / 100).toFixed(2)} cash returned. ${tag}`;
    if (!(saleRow.exception_reason ?? "").includes(tag)) {
      await admin
        .from("pos_sale_events")
        .update({ exception_reason: `${note} ${saleRow.exception_reason ?? ""}`.trim().slice(0, 1000) })
        .eq("id", saleRow.id);
    }
    await recordAudit({
      actorId: emp.staff_id,
      actorEmail: emp.full_name,
      action: "register.offline_void_unsynced_sale",
      entityType: "register",
      entityId: envelope.registerId,
      after: { via: "register_offline", clientUuid: envelope.clientUuid, saleClientUuid: p.saleClientUuid, occurredAt: envelope.occurredAt, refundMinor: p.refundMinor, reason: p.reason ?? null, saleStatus: saleRow.status, drawerSessionId: p.drawerSessionId },
    });
    return { ok: true };
  }

  // The drawer the iPad paid from, only if it is this register's on the server.
  let drawerSessionId: string | null = null;
  if (p.drawerSessionId) {
    const { data: ds } = await admin
      .from("drawer_sessions")
      .select("id, register_id")
      .eq("id", p.drawerSessionId)
      .maybeSingle<{ id: string; register_id: string }>();
    if (ds && ds.register_id === envelope.registerId) drawerSessionId = ds.id;
  }
  const receipt = bookReceipt(p.saleClientUuid);

  if (p.kind === "void") {
    const { data: done } = await admin
      .from("audit_logs")
      .select("id")
      .eq("action", "register.sale_voided")
      .eq("after->>clientUuid", envelope.clientUuid)
      .limit(1);
    if (done && done.length > 0) return { ok: true };
    const r = await processVoidSale({
      receiptNumber: receipt,
      reason: p.reason ?? "",
      approver: { id: emp.id, fullName: emp.full_name },
      processedByName: p.processedByName || "Register",
      deviceId: envelope.deviceId,
      drawerSessionId,
      asOfIso: envelope.occurredAt,
      offlineClientUuid: envelope.clientUuid,
    });
    if (!r.ok) return fail(r.error);
    if (r.refundMinor !== p.refundMinor) {
      return fail(`the void went through, but the server's refund is $${(r.refundMinor / 100).toFixed(2)}, not the $${(p.refundMinor / 100).toFixed(2)} the iPad handed back.`);
    }
    return { ok: true };
  }

  // ── Return ──────────────────────────────────────────────────────────────
  const line = p.line!;
  const { data: dupe } = await admin.from("customer_returns").select("id").like("detail", `%${tag}%`).limit(1);
  if (dupe && dupe.length > 0) return { ok: true };
  const lookup = await lookupSaleByReceipt(receipt, envelope.occurredAt);
  if (!lookup.ok) return fail(lookup.errors.join(" "));
  const target = matchOrderLine(
    lookup.sale.lines.map((l) => ({ id: l.lineId, product_id: l.productId, variant_id: null, price_minor_units: l.priceMinorUnits, remaining: l.remainingReturnable })),
    line,
  );
  if (!target) return fail(`the item "${line.productName}" at that price is not on the sale.`);
  const r = await processCounterReturn(
    {
      receiptNumber: receipt,
      orderLineId: target.id,
      quantity: line.quantity,
      reason: p.returnReason!,
      detail: `${(p.detail ?? "").trim()} ${tag}`.trim(),
      disposition: p.disposition!,
      originalPackaging: p.originalPackaging === true,
      lotIdLegible: p.lotIdLegible === true,
      asOfIso: envelope.occurredAt,
    },
    emp.staff_id,
    p.processedByName || "Register",
  );
  if (!r.ok) return fail(r.error);
  let refundTie = "untied: the iPad's drawer is not on the server for this register";
  if (drawerSessionId) {
    const tie = await assignReturnRefund({ returnId: r.returnId, paidFrom: "drawer", drawerSessionId });
    refundTie = tie.ok ? "drawer" : `untied: ${tie.error}`;
  }
  await recordAudit({
    actorId: emp.staff_id,
    actorEmail: emp.full_name,
    action: "customer_return.counter",
    entityType: "customer_returns",
    entityId: r.returnId,
    after: {
      via: "register_offline",
      deviceId: envelope.deviceId,
      clientUuid: envelope.clientUuid,
      occurredAt: envelope.occurredAt,
      receipt_number: receipt,
      order_line_id: target.id,
      quantity: line.quantity,
      reason: p.returnReason,
      disposition: p.disposition,
      refund_minor: r.refundMinor,
      points_clawed: r.pointsClawed,
      correction_operation: r.correctionOperation,
      approved_by: emp.full_name,
      processed_by_name: p.processedByName,
      refund_drawer_session_id: drawerSessionId,
      refund_tie: refundTie,
    },
  });
  if (r.refundMinor !== p.refundMinor) {
    return fail(`the return went through, but the server's refund is $${(r.refundMinor / 100).toFixed(2)}, not the $${(p.refundMinor / 100).toFixed(2)} the iPad handed back.`);
  }
  return { ok: true };
}
