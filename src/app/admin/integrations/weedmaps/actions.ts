"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  pushWeedmapsMenu,
  verifyWeedmapsMenuAccess,
  isWeedmapsConfigured,
  type WeedmapsPushResult,
} from "@/lib/weedmaps/push";
import { draftWeedmapsDescription } from "@/lib/weedmaps/ai";
import { recordSyndicationLog } from "@/lib/syndication/store";
import { AiNotConfiguredError } from "@/lib/ai/provider";
import { PreflightBlockedError } from "@/lib/syndication/preflight-core";
import {
  resolveWeedmapsSettings,
  type WeedmapsSyncSettings,
} from "@/lib/syndication/sync-settings-core";
import { getWeedmapsSyncSettings, resetSyncState, saveSyncSettings } from "@/lib/syndication/engine-store";

const BASE = "/admin/integrations/weedmaps";

export type PushActionResult =
  | { ok: true; result: WeedmapsPushResult }
  | { ok: false; error: string };

/**
 * Live menu push (POST /partners/menus/{menu_id}/items) to WeedMaps. Requires
 * settings.manage, full credentials, and explicit confirm=true from the form.
 * Records to syndication_logs (channel: "weedmaps") + audit either way.
 */
export async function pushWeedmapsAction(formData: FormData): Promise<PushActionResult> {
  const session = await requirePermission("settings.manage");
  const confirm = formData.get("confirm") === "true";

  if (!confirm) {
    return { ok: false, error: "Confirmation required for a live WeedMaps push." };
  }
  if (!isWeedmapsConfigured()) {
    return {
      ok: false,
      error: "WeedMaps is not configured. Set the menu id and OAuth credentials (or access token) first.",
    };
  }

  try {
    const result = await pushWeedmapsMenu({ confirm: true });
    await recordSyndicationLog({
      channel: "weedmaps",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message: result.message,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok ? "weedmaps.push.success" : "weedmaps.push.error",
      entityType: "syndication",
      entityId: "weedmaps",
      after: {
        itemCount: result.itemCount,
        httpStatus: result.httpStatus,
        plan: result.planSummary,
        sent: result.sent,
        skipped: result.skippedUnchanged,
        deleted: result.deleted,
        failed: result.failed,
      },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const blocked = err instanceof PreflightBlockedError;
    const message = err instanceof Error ? err.message : "WeedMaps push failed.";
    await recordSyndicationLog({
      channel: "weedmaps",
      mode: "live",
      // Preflight blocks are "skipped" (nothing was transmitted), not channel errors.
      status: blocked ? "skipped" : "error",
      itemCount: 0,
      payload: blocked ? { preflight: (err as PreflightBlockedError).report } : undefined,
      message,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
  }
}

export type SyncSettingsActionResult =
  | { ok: true; settings: WeedmapsSyncSettings }
  | { ok: false; error: string };

/** Read the owner's resolved Weedmaps transmission parameters. */
export async function getWeedmapsSettingsAction(): Promise<SyncSettingsActionResult> {
  await requirePermission("settings.manage");
  return { ok: true, settings: await getWeedmapsSyncSettings() };
}

/**
 * Save the owner's Weedmaps transmission parameters (pacing, retries, field
 * toggles, unpublish behavior, force-resend). Values are resolved + CLAMPED
 * through the pure core before storage, so out-of-range input can never break
 * a sync. Audited.
 */
export async function saveWeedmapsSettingsAction(
  formData: FormData,
): Promise<SyncSettingsActionResult> {
  const session = await requirePermission("settings.manage");
  const raw: Record<string, unknown> = {};
  for (const key of [
    "pacingMs",
    "maxRetries",
    "sendDescriptions",
    "sendCannabinoids",
    "sendImages",
    "sendStrains",
    "forceResend",
    "unpublishWhenOutOfStock",
  ]) {
    const v = formData.get(key);
    if (v !== null) raw[key] = v;
  }
  const settings = resolveWeedmapsSettings(raw);
  const saved = await saveSyncSettings("weedmaps", settings, session.userId);
  if (!saved.ok) {
    return {
      ok: false,
      error: `Could not save settings: ${saved.error}. If migration 0119 has not been applied yet, apply it first.`,
    };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "weedmaps.sync_settings.save",
    entityType: "syndication",
    entityId: "weedmaps",
    after: settings,
  });
  revalidatePath(BASE);
  return { ok: true, settings };
}

export type ResetStateActionResult = { ok: true } | { ok: false; error: string };

/**
 * Recovery tool: forget the last-successful-sync hashes so the NEXT push
 * resends every item (use when Weedmaps-side data is suspected out of sync).
 */
export async function resetWeedmapsSyncStateAction(): Promise<ResetStateActionResult> {
  const session = await requirePermission("settings.manage");
  try {
    await resetSyncState("weedmaps");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "weedmaps.sync_state.reset",
      entityType: "syndication",
      entityId: "weedmaps",
    });
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reset failed." };
  }
}

export type AccessActionResult =
  | { ok: true; httpStatus: number; state: string; body: unknown }
  | { ok: false; error: string };

/** Verify access to the configured menu: GET /partners/menus/{menu_id}. */
export async function verifyWeedmapsAccessAction(): Promise<AccessActionResult> {
  const session = await requirePermission("settings.manage");
  if (!isWeedmapsConfigured()) {
    return { ok: false, error: "WeedMaps is not configured." };
  }
  try {
    const access = await verifyWeedmapsMenuAccess();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "weedmaps.access.verify",
      entityType: "syndication",
      entityId: "weedmaps",
      after: { httpStatus: access.httpStatus, state: access.state },
    });
    return { ok: true, httpStatus: access.httpStatus, state: access.state, body: access.body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Access check failed." };
  }
}

export type DescriptionDraftResult =
  | { ok: true; description: string; flags: string[] }
  | { ok: false; error: string };

/** AI DRAFT a plain-text WeedMaps description. Drafts only — staff must approve before use. */
export async function draftWeedmapsDescriptionAction(
  input: {
    name: string;
    brand?: string | null;
    category: string;
    strainType?: string | null;
    strainName?: string | null;
    thc?: string | null;
    cbd?: string | null;
    existing?: string | null;
  },
): Promise<DescriptionDraftResult> {
  await requirePermission("settings.manage");
  if (!input.name || !input.category) {
    return { ok: false, error: "Product name and category are required." };
  }
  try {
    const { description, compliance } = await draftWeedmapsDescription(input);
    return { ok: true, description, flags: compliance.flags };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return { ok: false, error: "AI is not configured. Add an AI provider key to enable drafting." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Drafting failed." };
  }
}
