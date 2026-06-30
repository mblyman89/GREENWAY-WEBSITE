"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createAuthorization,
  setAuthorizationStatus,
  recordMcrValidation,
} from "@/lib/medical/store";

function bool(form: FormData, key: string): boolean {
  return String(form.get(key) ?? "") === "on" || String(form.get(key) ?? "") === "true";
}

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export async function issueCardAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const customerId = str(form, "customer_id");
  if (!customerId) return;

  const checklist = {
    formCompleteSigned: bool(form, "chk_form"),
    tamperResistantVerified: bool(form, "chk_tamper"),
    identityVerified: bool(form, "chk_identity"),
    embossedSealVerified: bool(form, "chk_seal"),
  };

  const res = await createAuthorization(
    {
      customerId,
      authorizationId: str(form, "authorization_id") || null,
      uniquePatientIdentifier: str(form, "unique_patient_identifier") || null,
      holderType: str(form, "holder_type") === "designated_provider" ? "designated_provider" : "patient",
      effectiveOn: str(form, "effective_on") || null,
      expiresOn: str(form, "expires_on") || null,
      inDohDatabase: bool(form, "in_doh_database"),
      checklist,
      notes: str(form, "notes") || null,
    },
    session.userId,
  );

  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "medical.card.issue",
      entityType: "patient_authorization",
      entityId: res.id,
    });
    revalidatePath(`/admin/customers/${customerId}`);
  } else {
    revalidatePath(`/admin/customers/${customerId}?med_error=${encodeURIComponent(res.error)}`);
  }
}

export async function setCardStatusAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const id = str(form, "authorization_row_id");
  const customerId = str(form, "customer_id");
  const statusRaw = str(form, "status");
  const status = (["active", "expired", "revoked"].includes(statusRaw) ? statusRaw : "revoked") as
    | "active"
    | "expired"
    | "revoked";
  if (!id) return;
  await setAuthorizationStatus(id, status, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "medical.card.status",
    entityType: "patient_authorization",
    entityId: id,
    after: { status },
  });
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

export async function validateMcrAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const id = str(form, "authorization_row_id");
  const customerId = str(form, "customer_id");
  if (!id) return;
  await recordMcrValidation(id, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "medical.card.mcr_validated",
    entityType: "patient_authorization",
    entityId: id,
  });
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}
