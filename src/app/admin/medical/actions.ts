"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { redirect } from "next/navigation";
import {
  createAuthorization,
  setAuthorizationStatus,
  recordMcrValidation,
  attachFormScan,
  markCardPrinted,
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

/**
 * Slice 85 — streamlined authorization intake. Issues the recognition card AND
 * (if a scanned form file is attached) uploads the scan to private storage, in a
 * single step from the /admin/medical/intake page. Redirects back with a status.
 */
export async function intakeAuthorizationAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const customerId = str(form, "customer_id");
  if (!customerId) redirect("/admin/medical/intake?err=nocustomer");

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
      holderType:
        str(form, "holder_type") === "designated_provider" ? "designated_provider" : "patient",
      effectiveOn: str(form, "effective_on") || null,
      expiresOn: str(form, "expires_on") || null,
      inDohDatabase: bool(form, "in_doh_database"),
      checklist,
      notes: str(form, "notes") || null,
    },
    session.userId,
  );

  if (!res.ok) {
    redirect(`/admin/medical/intake?customer=${customerId}&err=${encodeURIComponent(res.error)}`);
  }

  // Optional scanned form (from the Canon flatbed).
  const file = form.get("form_scan");
  if (file instanceof File && file.size > 0) {
    const bytes = await file.arrayBuffer();
    const up = await attachFormScan(
      res.id,
      { bytes, filename: file.name, contentType: file.type },
      session.userId,
    );
    if (!up.ok) {
      redirect(`/admin/medical/intake?ok=${res.id}&scanerr=${encodeURIComponent(up.error)}`);
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "medical.card.issue",
    entityType: "patient_authorization",
    entityId: res.id,
  });
  revalidatePath("/admin/medical/intake");
  redirect(`/admin/medical/intake?ok=${res.id}`);
}

/** Attach a scanned form to an EXISTING authorization row. */
export async function attachScanAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const id = str(form, "authorization_row_id");
  if (!id) return;
  const file = form.get("form_scan");
  if (file instanceof File && file.size > 0) {
    const bytes = await file.arrayBuffer();
    await attachFormScan(id, { bytes, filename: file.name, contentType: file.type }, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "medical.card.scan_attached",
      entityType: "patient_authorization",
      entityId: id,
    });
  }
  revalidatePath("/admin/medical/intake");
}

/** Stamp that the physical recognition card was printed (before laminating). */
export async function markCardPrintedAction(form: FormData): Promise<void> {
  const session = await requirePermission("medical.manage");
  const id = str(form, "authorization_row_id");
  if (!id) return;
  await markCardPrinted(id, session.userId);
  revalidatePath("/admin/medical/intake");
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
