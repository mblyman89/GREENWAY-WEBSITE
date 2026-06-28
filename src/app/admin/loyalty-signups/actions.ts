"use server";

/**
 * Server actions for the Slice 8 loyalty queue. Each mutating action checks the
 * loyalty.manage permission, performs the change via the signups store, and
 * records an audit log entry.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  setLoyaltyStatus,
  updateLoyaltyNote,
  createLoyaltySignup,
  type LoyaltyStatus,
} from "@/lib/loyalty/signups-store";
import { readLoyaltySignups } from "@/lib/loyalty/store";

const VALID: LoyaltyStatus[] = ["new", "entered", "duplicate", "archived"];

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
  revalidatePath("/admin/loyalty-signups");
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
}
