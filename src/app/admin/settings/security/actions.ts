"use server";

// Passkey management actions. These are scoped to the CURRENT signed-in user —
// every action re-derives the user from the session and passes user_id to the
// store, so one staffer can never touch another's passkeys.
import { revalidatePath } from "next/cache";
import { getStaffSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { renameCredential, deleteCredential } from "@/lib/auth/webauthn-store";

export async function renamePasskeyAction(formData: FormData): Promise<void> {
  const session = await getStaffSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!id || !label) return;
  await renameCredential(session.userId, id, label);
  await recordAudit({
    actorId: session.profile.id,
    action: "auth.passkey.rename",
    entityType: "webauthn_credential",
    entityId: id,
  }).catch(() => {});
  revalidatePath("/admin/settings/security");
}

export async function deletePasskeyAction(formData: FormData): Promise<void> {
  const session = await getStaffSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await deleteCredential(session.userId, id);
  await recordAudit({
    actorId: session.profile.id,
    action: "auth.passkey.delete",
    entityType: "webauthn_credential",
    entityId: id,
  }).catch(() => {});
  revalidatePath("/admin/settings/security");
}
