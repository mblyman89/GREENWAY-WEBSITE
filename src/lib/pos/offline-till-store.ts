/**
 * src/lib/pos/offline-till-store.ts — D170 O1: apply a drawer action the
 * register did while OFFLINE (queued `till_action` event, migration 0340).
 *
 * Every write is idempotent on the event's clientUuid / the iPad-minted
 * drawer id, so a replayed flush never doubles a drop or re-opens a drawer.
 * Times are the time the cash actually moved (envelope.occurredAt), so the
 * drawer story matches what happened, not when the internet came back.
 * Anything the server cannot honor is returned as an exception reason for a
 * manager; nothing is silently dropped.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { denomTotalMinor } from "@/lib/registers/cash";
import { getRegister, insertDrawerDropRow } from "@/lib/registers/store";
import { atmWitnessCheck, buildDropInsertRows } from "@/lib/registers/atm-drop-core";
import { addBillsToDropRows, dropBillsWords } from "@/lib/registers/drop-bills-core";
import { getAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";
import { floatCheck } from "@/lib/registers/shift-end-core";
import { COUNT_BLANK_BOX_AUDIT, countGapAudit } from "@/lib/registers/count-gap-core";
import { compactDenoms, denomWords } from "@/lib/registers/little-safe-core";
import { POP_AUDIT_ACTION } from "@/lib/registers/drawer-pop-store";
import { businessDayFor } from "@/lib/staffing/time";
import { offlineKeyId } from "./offline-unlock-core";
import { getOfflinePolicy } from "./offline-unlock-store";
import { judgeTillPins, offlineTillNote, validateTillPayload, type TillPinPerson } from "./offline-till-core";
import type { PosEventEnvelope } from "./sale-event-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type EmpRow = { id: string; full_name: string; staff_id: string | null; job_role: string; active: boolean };

export type OfflineTillOutcome = { ok: true } | { ok: false; reason: string };

export async function applyOfflineTill(admin: Admin, envelope: PosEventEnvelope): Promise<OfflineTillOutcome> {
  const v = validateTillPayload(envelope.payload, envelope.employeeId);
  if (!v.ok) return { ok: false, reason: `Invalid offline drawer action: ${v.errors.join(" ")}` };
  const p = v.payload;
  const req = v.req;

  const ids = [p.actor.employeeId, p.witness?.employeeId, p.approver?.employeeId].filter((x): x is string => !!x);
  const { data: empData } = await admin.from("employees").select("id, full_name, staff_id, job_role, active").in("id", ids);
  const emps = new Map(((empData as EmpRow[] | null) ?? []).map((e) => [e.id, e]));
  const people: Record<string, TillPinPerson> = {};
  for (const id of ids) {
    const e = emps.get(id);
    people[id] = e ? { active: e.active === true, jobRole: e.job_role } : null;
  }
  const policy = await getOfflinePolicy();
  const verdict = judgeTillPins({ payload: p, people, currentKeyId: offlineKeyId(policy.epoch) });
  const actor = emps.get(p.actor.employeeId) ?? null;
  const at = envelope.occurredAt;
  const audit = (action: string, after: Record<string, unknown>) =>
    recordAudit({
      actorId: actor?.staff_id ?? null,
      actorEmail: actor?.full_name ?? `pos-device:${envelope.deviceId}`,
      action,
      entityType: "drawer_session",
      entityId: p.drawerRef,
      after: { via: "register_offline", deviceId: envelope.deviceId, clientUuid: envelope.clientUuid, occurredAt: at, reason: p.reason, ...after },
    });
  // The cash already moved: a doubtful PIN still records the action (the
  // drawer story must match the room) AND raises an exception for review.
  // Except the swap, whose approval IS the control — that one is refused.
  if (!verdict.ok && p.action === "swap") return { ok: false, reason: verdict.reason };

  const { data: session } = await admin
    .from("drawer_sessions")
    .select("id, register_id, status, opened_at, closed_at")
    .eq("id", p.drawerRef)
    .maybeSingle<{ id: string; register_id: string; status: string; opened_at: string | null; closed_at: string | null }>();

  if (req.action === "open") {
    if (session) {
      if (session.register_id !== envelope.registerId) return { ok: false, reason: "Offline count-in reused a drawer id from another register." };
    } else {
      const { data: other } = await admin
        .from("drawer_sessions")
        .select("id, opened_at")
        .eq("register_id", envelope.registerId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle<{ id: string; opened_at: string | null }>();
      if (other) {
        return {
          ok: false,
          reason: `Offline count-in at ${at}, but the server already had an open drawer on this register (opened ${other.opened_at ?? "?"}). Close or reconcile that drawer, then resolve this exception; the sales rung on the offline drawer wait here until then.`,
        };
      }
      const openingMinor = denomTotalMinor(req.denoms);
      const { error } = await admin.from("drawer_sessions").insert({
        id: p.drawerRef,
        register_id: envelope.registerId,
        opened_by: p.actor.employeeId,
        shift_id: null,
        business_day: businessDayFor(at),
        status: "open",
        opening_count_minor: openingMinor,
        opened_at: at,
        device_id: envelope.deviceId,
      });
      if (error) return { ok: false, reason: `Offline count-in could not be saved: ${error.message}` };
      await admin.from("drawer_counts").insert({ session_id: p.drawerRef, count_type: "open", counted_by: p.actor.employeeId, ...req.denoms, total_minor: openingMinor });
      const reg = await getRegister(envelope.registerId);
      const fc = floatCheck(openingMinor, reg?.default_float_minor ?? null);
      await audit("drawer.opened", { employeeId: p.actor.employeeId, openingMinor, standardFloatMinor: reg?.default_float_minor ?? null, floatCheck: fc.state, floatDiffMinor: fc.diffMinor });
      if (fc.state === "over" || fc.state === "short") await audit("drawer.float_warning", { employeeId: p.actor.employeeId, diffMinor: fc.diffMinor });
      // D216: a count-in saved with a normal box empty.
      const gap = countGapAudit(req.denoms, "open", reg?.default_float_minor ?? null, req.recountConfirmed === true);
      if (gap) await audit(COUNT_BLANK_BOX_AUDIT, { employeeId: p.actor.employeeId, ...gap });
    }
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }

  if (!session || session.register_id !== envelope.registerId) {
    return { ok: false, reason: `Offline drawer ${req.action}: the drawer it names is not on the server for this register. Review it.` };
  }

  if (req.action === "drop" || req.action === "swap") {
    const table = req.action === "drop" ? "drawer_drops" : "safe_swaps";
    const tag = `[offline ${envelope.clientUuid}]`;
    const { data: dupe } = await admin.from(table).select("id").eq("session_id", session.id).like("notes", `%${tag}%`).limit(1);
    if (!dupe || dupe.length === 0) {
      if (req.action === "drop") {
        // D198: an ATM drop keeps its $20 count + the ATM it went into (0346 columns, or the note
        // tag on an older database). The ATM terminal is the owner's setting at sync time.
        const isAtm = req.destination === "atm";
        const atmSettings = isAtm ? await getAtmDropSettings() : null;
        const saved = await insertDrawerDropRow(
          admin,
          addBillsToDropRows(buildDropInsertRows(
            {
              session_id: session.id,
              amount_minor: req.amountMinor,
              drop_window: req.window,
              dropped_by: p.actor.employeeId,
              witnessed_by: p.witness?.employeeId ?? null,
              notes: offlineTillNote(envelope.clientUuid, req.notes),
              dropped_at: at,
            },
            {
              destination: isAtm ? "atm" : "safe",
              twentiesCount: isAtm ? (req.twentiesCount ?? null) : null,
              terminalId: atmSettings?.terminalId ?? null,
              deviceId: envelope.deviceId,
              recordedVia: "offline",
            },
          ), isAtm ? null : (req.bills ?? null)),
        );
        if (!saved.ok) return { ok: false, reason: `Offline drop could not be saved: ${saved.error ?? "unknown error"}` };
        await audit("drawer.drop", {
          amountMinor: req.amountMinor,
          window: req.window,
          witnessed: !!p.witness,
          destination: isAtm ? "atm" : "safe",
          dropId: saved.id ?? null,
          // D217: a safe drop's bills (false = an older build typed the amount).
          ...(isAtm ? {} : { billsCounted: !!req.bills, bills: req.bills ?? null, billsWords: req.bills ? dropBillsWords(req.bills) : null, billsStoredAs: req.bills ? (saved.storedAs ?? null) : null }),
        });
        if (isAtm && atmSettings) {
          const w = atmWitnessCheck(atmSettings.witness, !!p.witness);
          await audit("drawer.atm_drop", {
            dropId: saved.id ?? null,
            sessionId: session.id,
            registerId: envelope.registerId,
            employeeId: p.actor.employeeId,
            employeeName: actor?.full_name ?? null,
            twentiesCount: req.twentiesCount ?? null,
            amountMinor: req.amountMinor,
            atmTerminalId: atmSettings.terminalId,
            window: req.window,
            witnessedBy: p.witness?.employeeId ?? null,
            witnessPolicy: atmSettings.witness,
            // Offline the iPad cannot enforce "required": record it and flag it loud for the owner.
            flaggedNoWitness: w.flag || !w.allowed,
            witnessRequiredButMissing: !w.allowed,
            storedAs: saved.storedAs ?? null,
          });
        }
      } else {
        const base = {
          session_id: session.id,
          device_id: envelope.deviceId,
          amount_minor: req.amountMinor,
          performed_by: p.actor.employeeId,
          approved_by: p.approver?.employeeId ?? null,
          notes: offlineTillNote(envelope.clientUuid, req.notes),
          occurred_at: at,
        };
        const withBills = req.inDenoms && req.outDenoms ? { ...base, in_denoms: compactDenoms(req.inDenoms), out_denoms: compactDenoms(req.outDenoms) } : base;
        let { error } = await admin.from("safe_swaps").insert(withBills);
        if (error && withBills !== base) ({ error } = await admin.from("safe_swaps").insert(base));
        if (error) return { ok: false, reason: `Offline swap could not be saved: ${error.message}` };
        await audit("safe.swap", {
          amountMinor: req.amountMinor,
          approvedBy: p.approver?.employeeId ?? null,
          bills_in: req.inDenoms ? denomWords(req.inDenoms) : null,
          bills_out: req.outDenoms ? denomWords(req.outDenoms) : null,
        });
      }
    }
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }

  if (req.action === "pop") {
    await audit(POP_AUDIT_ACTION, { employeeId: p.actor.employeeId, popNumber: p.popNumber ?? 1, repeat: (p.popNumber ?? 1) > 1, ...(p.popReason ? { reason: p.popReason } : {}) });
    if ((p.popNumber ?? 1) > 1) await audit("drawer.pop_repeat_warning", { employeeId: p.actor.employeeId, popNumber: p.popNumber, reason: p.popReason ?? null });
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }

  // close — BLIND, one person (D121). Compare-and-swap on status 'open'; a
  // replay that finds it already closed by THIS event is a no-op.
  if (session.status !== "open") {
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }
  const closingMinor = denomTotalMinor(req.denoms);
  const { data: changed, error } = await admin
    .from("drawer_sessions")
    .update({ status: "closed", closed_by: p.actor.employeeId, closing_count_minor: closingMinor, closed_at: at })
    .eq("id", session.id)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, reason: `Offline close could not be saved: ${error.message}` };
  if (changed && changed.length > 0) {
    if (req.tipsMinor !== undefined) {
      try {
        await admin.from("drawer_sessions").update({ tips_minor: req.tipsMinor }).eq("id", session.id);
      } catch {
        // 0134 unapplied — tips skipped, nothing else.
      }
    }
    await admin.from("drawer_counts").insert({ session_id: session.id, count_type: "close", counted_by: p.actor.employeeId, ...req.denoms, total_minor: closingMinor });
    await audit("drawer.closed_blind", {
      employeeId: p.actor.employeeId,
      ...(req.tipsMinor !== undefined ? { tipsMinor: req.tipsMinor } : {}),
      ...(req.tipPool ? { tipPool: req.tipPool } : {}),
      secondCount: "back_office",
      ...(req.confirmedEmpty ? { confirmedEmpty: true } : {}),
    });
    // D216: a blind close saved with a coin or $1 box empty (box names only).
    const gap = countGapAudit(req.denoms, "close", null, req.recountConfirmed === true);
    if (gap) await audit(COUNT_BLANK_BOX_AUDIT, { employeeId: p.actor.employeeId, ...gap });
  }
  return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
}
