"use server";

/**
 * Server actions for the Slice 8 loyalty queue. Each mutating action checks the
 * loyalty.manage permission, performs the change via the signups store, and
 * records an audit log entry.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  setLoyaltyStatus,
  updateLoyaltyNote,
  createLoyaltySignup,
  type LoyaltyStatus,
} from "@/lib/loyalty/signups-store";
import { connectSignupToCustomer } from "@/lib/loyalty/signup-customer-store";
import { readLoyaltySignups } from "@/lib/loyalty/store";

const VALID: LoyaltyStatus[] = ["new", "entered", "duplicate", "archived"];

/**
 * Create-or-link the customer record for a signup, audit the outcome, and
 * return a banner message for the queue UI. Shared by "Mark entered" (auto)
 * and the explicit "Add to customers" backfill button.
 */
async function connectAndAudit(
  signupId: string,
  session: { profile: { id: string }; email: string },
): Promise<string> {
  const result = await connectSignupToCustomer(signupId, session.profile.id);
  if (!result.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "loyalty.customer_connect_failed",
      entityType: "loyalty_signup",
      entityId: signupId,
      after: { error: result.error },
    });
    return `connect_error=${encodeURIComponent(result.error)}`;
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action:
      result.outcome === "created"
        ? "loyalty.customer_created"
        : "loyalty.customer_linked",
    entityType: "loyalty_signup",
    entityId: signupId,
    after: {
      customer_id: result.customerId,
      outcome: result.outcome,
      basis: result.basis,
      enrolled: result.enrolled,
    },
  });
  const qs = new URLSearchParams({
    connected: result.outcome,
    cid: result.customerId,
    cname: result.customerName,
  });
  if (result.basisLabel) qs.set("basis", result.basisLabel);
  if (result.enrolled) qs.set("enrolled", "1");
  return qs.toString();
}

export async function setLoyaltyStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as LoyaltyStatus;
  if (!id || !VALID.includes(status)) return;

  const ok = await setLoyaltyStatus(id, status, { actorId: session.profile.id });
  if (ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "loyalty.status_changed",
      entityType: "loyalty_signup",
      entityId: id,
      after: { status },
    });
  }

  // Marking a signup "entered" now automatically creates (or links to) the
  // customer record — the back office IS the POS, so validated signups land
  // in CRM → Customers without any manual re-entry.
  if (ok && status === "entered") {
    const qs = await connectAndAudit(id, session);
    revalidatePath("/admin/loyalty-signups");
    revalidatePath("/admin/customers");
    redirect(`/admin/loyalty-signups?${withReturnView(qs, formData)}`);
  }

  revalidatePath("/admin/loyalty-signups");
}

/** Preserve the queue's current filter + search across a redirect. */
function withReturnView(qs: string, formData: FormData): string {
  const params = new URLSearchParams(qs);
  const view = String(formData.get("view") ?? "").trim();
  const q = String(formData.get("view_q") ?? "").trim();
  if (view) params.set("status", view);
  if (q) params.set("q", q);
  return params.toString();
}

/**
 * Explicit backfill: create-or-link the customer for a signup that was marked
 * "entered" before auto-connection existed (or re-run a failed connect).
 * Idempotent — an already-connected signup just reports its customer.
 */
export async function connectSignupCustomerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const qs = await connectAndAudit(id, session);
  revalidatePath("/admin/loyalty-signups");
  revalidatePath("/admin/customers");
  redirect(`/admin/loyalty-signups?${withReturnView(qs, formData)}`);
}

export async function updateLoyaltyNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return;

  const ok = await updateLoyaltyNote(id, note);
  if (ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "loyalty.note_updated",
      entityType: "loyalty_signup",
      entityId: id,
      after: { note },
    });
  }
  revalidatePath("/admin/loyalty-signups");
}

/**
 * One-click migration: import any rows still in storage/loyalty-signups.jsonl
 * into the database queue. Idempotent on legacy_id, so it can be run safely
 * multiple times.
 */
export async function importLegacyLoyaltyAction(): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const legacy = await readLoyaltySignups();

  let imported = 0;
  for (const rec of legacy) {
    const result = await createLoyaltySignup({
      legacyId: rec.id,
      firstName: rec.firstName,
      lastName: rec.lastName,
      birthday: rec.birthday,
      mobilePhone: rec.mobilePhone,
      email: rec.email,
      // The JSONL reader doesn't expose consent/signature; default safely.
      consent: true,
      signature: null,
      notificationStatus:
        (rec.notificationStatus as
          | "email-not-configured"
          | "email-sent"
          | "email-failed") ?? "email-not-configured",
      submittedAt: rec.submittedAt,
    });
    if (result) imported += 1;
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "loyalty.legacy_import",
    entityType: "loyalty_signup",
    after: { attempted: legacy.length, imported },
  });

  revalidatePath("/admin/loyalty-signups");
  // Surface a clear result so a 0-row import isn't a silent no-op.
  redirect(`/admin/loyalty-signups?imported=${imported}&found=${legacy.length}`);
}
