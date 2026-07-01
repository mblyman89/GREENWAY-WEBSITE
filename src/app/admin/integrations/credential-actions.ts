"use server";

/**
 * Server actions for entering integration credentials from the back office
 * (Slice 60). settings.manage-gated (owner/admin). Secret fields submitted as a
 * mask (••••1234) are left unchanged; blank clears; a typed value replaces.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { updateIntegrationCredentials } from "@/lib/integrations/integration-credentials-store";
import type { CredentialsFormInput } from "@/lib/integrations/integration-credentials-core";

export type SaveCredentialsResult = { ok: true } | { ok: false; error: string };

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (v === null) return undefined;
  return typeof v === "string" ? v : undefined;
}

/** Save Leafly credentials only (leaves WeedMaps fields untouched). */
export async function saveLeaflyCredentialsAction(
  fd: FormData,
): Promise<SaveCredentialsResult> {
  const session = await requirePermission("settings.manage");
  const form: CredentialsFormInput = {
    leaflyEnvironment: str(fd, "leaflyEnvironment"),
    leaflyMenuIntegrationKey: str(fd, "leaflyMenuIntegrationKey"),
    leaflyClientId: str(fd, "leaflyClientId"),
    leaflyClientSecret: str(fd, "leaflyClientSecret"),
  };
  const res = await updateIntegrationCredentials(form);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "integration.credentials.update",
    entityType: "integration_credentials",
    entityId: "leafly",
    after: { service: "leafly", environment: form.leaflyEnvironment ?? null },
  });
  return { ok: true };
}

/** Save WeedMaps credentials only (leaves Leafly fields untouched). */
export async function saveWeedmapsCredentialsAction(
  fd: FormData,
): Promise<SaveCredentialsResult> {
  const session = await requirePermission("settings.manage");
  const form: CredentialsFormInput = {
    weedmapsEnvironment: str(fd, "weedmapsEnvironment"),
    weedmapsMenuId: str(fd, "weedmapsMenuId"),
    weedmapsClientId: str(fd, "weedmapsClientId"),
    weedmapsClientSecret: str(fd, "weedmapsClientSecret"),
    weedmapsAccessToken: str(fd, "weedmapsAccessToken"),
    weedmapsTokenUrl: str(fd, "weedmapsTokenUrl"),
    weedmapsScope: str(fd, "weedmapsScope"),
  };
  const res = await updateIntegrationCredentials(form);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "integration.credentials.update",
    entityType: "integration_credentials",
    entityId: "weedmaps",
    after: { service: "weedmaps", environment: form.weedmapsEnvironment ?? null },
  });
  return { ok: true };
}
