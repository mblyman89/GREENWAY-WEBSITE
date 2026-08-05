"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { saveExciseDraft, resolveExciseReturn, markExciseSent, type ExciseDraftInput } from "@/lib/compliance/excise-draft";
import { isPaymentMethod } from "@/lib/compliance/excise-payment-core";
import { buildLiq1295Xlsx, makeLiq1295FileName, logExciseReturnBatch } from "@/lib/compliance/excise-return";
import { sendEligibility } from "@/lib/compliance/excise-send-core";
import { sendExciseReturnEmail } from "@/lib/compliance/excise-send";

const BASE = "/admin/reports/excise";

/** Parse a dollar text field into MINOR units, or null when blank. */
function dollarsToMinorOrNull(formData: FormData, key: string): number | null {
  const raw = (formData.get(key) as string | null) ?? "";
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
}

/** Parse a plain string field, empty → undefined. */
function str(formData: FormData, key: string): string | undefined {
  const raw = (formData.get(key) as string | null) ?? "";
  return raw;
}

/** Save the editable LIQ-1295 draft for a reporting period. */
export async function saveExciseDraftAction(formData: FormData) {
  const session = await requirePermission("settings.manage");
  if (!can(session.profile.role, "settings.manage")) {
    redirect(`${BASE}?error=${encodeURIComponent("Editing the LIQ-1295 requires admin.")}`);
  }

  const month = Number(formData.get("month"));
  const year = Number(formData.get("year"));
  if (!(month >= 1 && month <= 12) || !(year >= 2014)) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid reporting period.")}`);
  }

  const methodRaw = ((formData.get("payment_method") as string | null) ?? "").trim();
  const paymentMethod = methodRaw && isPaymentMethod(methodRaw) ? methodRaw : null;
  const paymentStatus = formData.get("payment_status") === "paid" ? "paid" : "unpaid";
  const paidAtRaw = ((formData.get("paid_at") as string | null) ?? "").trim();

  const input: ExciseDraftInput = {
    month,
    year,
    licenseNumber: str(formData, "license_number"),
    tradeName: str(formData, "trade_name"),
    locationAddress: str(formData, "location_address"),
    city: str(formData, "city"),
    contactPhone: str(formData, "contact_phone"),
    contactEmail: str(formData, "contact_email"),
    isRevised: formData.get("is_revised") === "on",
    isNoSales: formData.get("is_no_sales") === "on",
    isFinal: formData.get("is_final") === "on",
    box1CannabisSalesMinor: dollarsToMinorOrNull(formData, "box1"),
    box2LessMedicalMinor: dollarsToMinorOrNull(formData, "box2"),
    box6AdditionalExciseMinor: dollarsToMinorOrNull(formData, "box6"),
    box8AssessedPenaltyMinor: dollarsToMinorOrNull(formData, "box8"),
    box9ApprovedCreditsMinor: dollarsToMinorOrNull(formData, "box9"),
    notes: str(formData, "notes") ?? null,
    paymentMethod,
    paymentStatus,
    paymentConfirmation: str(formData, "payment_confirmation") ?? null,
    amountPaidMinor: dollarsToMinorOrNull(formData, "amount_paid"),
    paidAt: paidAtRaw === "" ? null : new Date(paidAtRaw).toISOString(),
  };

  const result = await saveExciseDraft(input, session.userId);
  if (!result.ok) {
    redirect(`${BASE}?month=${month}&year=${year}&error=${encodeURIComponent(result.error)}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "excise.draft_saved",
    entityType: "excise_return_drafts",
    entityId: `${year}-${String(month).padStart(2, "0")}`,
    after: {
      month,
      year,
      is_revised: input.isRevised,
      is_no_sales: input.isNoSales,
      is_final: input.isFinal,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
    },
  });

  revalidatePath(BASE);
  redirect(`${BASE}?month=${month}&year=${year}&ok=1`);
}

/**
 * "Send to WSLCB": email the completed LIQ-1295 to cannabistaxes@lcb.wa.gov
 * (cc contact@greenwaymarijuana.com) with the filled .xlsx attached.
 *
 * Server-side we RE-RESOLVE the return and RE-CHECK eligibility (never trust the
 * client), require the perjury certification, then send via Resend. On success
 * we stamp sent_at (markExciseSent), log a batch row as "sent", and audit. If
 * email isn't configured, we report that so the UI can point to manual download.
 */
export async function sendExciseToWslcbAction(formData: FormData) {
  const session = await requirePermission("settings.manage");
  if (!can(session.profile.role, "settings.manage")) {
    redirect(`${BASE}?error=${encodeURIComponent("Sending the LIQ-1295 requires admin.")}`);
  }

  const month = Number(formData.get("month"));
  const year = Number(formData.get("year"));
  if (!(month >= 1 && month <= 12) || !(year >= 2014)) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid reporting period.")}`);
  }

  const certified = formData.get("certified") === "on";
  const qs = `month=${month}&year=${year}`;

  // Re-resolve from live data + saved draft, then re-check the gate server-side.
  const { data } = await resolveExciseReturn(month, year);
  const gate = sendEligibility(
    { identity: data.identity, boxes: data.boxes, dueDate: data.dueDate, warnings: data.warnings },
    certified,
  );
  if (!gate.canSend) {
    redirect(`${BASE}?${qs}&error=${encodeURIComponent(`Cannot send yet: ${gate.blockers[0]}`)}`);
  }

  const fileName = makeLiq1295FileName(data.identity.licenseNumber, month, year);
  const xlsx = await buildLiq1295Xlsx(data);

  const result = await sendExciseReturnEmail({
    email: {
      identity: data.identity,
      boxes: data.boxes,
      dueDate: data.dueDate,
      flags: data.flags,
      fileName,
    },
    xlsx,
    replyTo: data.identity.email || null,
  });

  if (!result.sent) {
    redirect(`${BASE}?${qs}&error=${encodeURIComponent(`Could not send: ${result.reason} You can still Download the form and email it manually.`)}`);
  }

  await markExciseSent({
    month,
    year,
    sentBy: session.profile.id,
    to: result.to,
    cc: result.cc,
    from: result.from,
    messageId: result.messageId,
    fileName,
  });

  // Log the batch as an actual SEND (distinct from a plain download "generated").
  await logExciseReturnBatch(data, fileName, session.profile.id);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "excise.sent_to_wslcb",
    entityType: "excise_return_drafts",
    entityId: `${year}-${String(month).padStart(2, "0")}`,
    after: {
      month,
      year,
      to: result.to,
      cc: result.cc,
      from: result.from,
      message_id: result.messageId,
      file_name: fileName,
      amount_to_pay: data.boxes.box10_amountToPay,
    },
  });

  revalidatePath(BASE);
  redirect(`${BASE}?${qs}&sent=1`);
}
