"use server";

/**
 * R41 S10 (0277): the Timberland communications log.
 *
 * Add entry: a message from Timberland (or an event like a compromise phone
 * call) that starts a contract clock. Mark done: closes one item, once.
 *
 * Owner only through achGate (Michael at once with a receipt; Stephen's entry
 * becomes a request for Michael, replayed as Michael when he approves, so the
 * row is always the owner's record). The 0277 trigger checks the owner again
 * (ach_write_by_owner), refuses future dates and never lets a row change.
 *
 * The form is checked here (checkCommsForm / checkCloseForm) and again by the
 * database; the database is the last word.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { addTimberlandComms, closeTimberlandComms } from "@/lib/payments/timberland-comms-store";
import { checkCloseForm, checkCommsForm, COMMS_TYPE_SPECS } from "@/lib/payments/timberland-obligations-core";

const OPS = "/admin/settings/banking/operations";

function back(qs: { msg?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(OPS);
  revalidatePath("/admin/settings/banking/guide");
  redirect(`${OPS}?${p.toString()}#clocks`);
}

const reply = (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message });

export async function addTimberlandCommsAction(fd: FormData): Promise<void> {
  return achGate("timberland_comms.log", fd, { reply }, (session) => addBody(session, fd));
}

async function addBody(session: StaffSession, fd: FormData): Promise<void> {
  const form = checkCommsForm((k) => fd.get(k) as string | null, pacificToday(), new Date());
  if (!form.ok) back({ error: form.error });
  const r = await addTimberlandComms({ row: form.row, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.timberland_comms.logged",
    entityType: "ach_timberland_comms",
    entityId: r.id,
    after: { entry_type: form.row.entryType, received_on: form.row.receivedOn, effective_on: form.row.effectiveOn, amount_cents: form.row.amountCents },
  }).catch(() => {});
  const spec = COMMS_TYPE_SPECS[form.row.entryType];
  back({ msg: spec.clock ? `Logged: ${spec.label}. Its deadline is in the clocks list below.` : `Logged: ${spec.label}.` });
}

export async function closeTimberlandCommsAction(fd: FormData): Promise<void> {
  return achGate("timberland_comms.done", fd, { reply }, (session) => closeBody(session, fd));
}

async function closeBody(session: StaffSession, fd: FormData): Promise<void> {
  const form = checkCloseForm((k) => fd.get(k) as string | null, pacificToday());
  if (!form.ok) back({ error: form.error });
  const r = await closeTimberlandComms({ closesId: form.closesId, summary: form.summary, receivedOn: form.receivedOn, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.timberland_comms.done",
    entityType: "ach_timberland_comms",
    entityId: form.closesId,
    after: { done_id: r.id, closed_type: r.closedType },
  }).catch(() => {});
  back({ msg: "Marked done. The clock is closed; the entry and your note stay in the log." });
}
