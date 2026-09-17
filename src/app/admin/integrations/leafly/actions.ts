"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  pushLeaflyMenu,
  getLeaflyStatus,
  isLeaflyConfigured,
  type LeaflyPushResult,
} from "@/lib/leafly/push";
import { draftLeaflyDescription } from "@/lib/leafly/ai";
import { recordSyndicationLog } from "@/lib/syndication/store";
import { AiNotConfiguredError } from "@/lib/ai/provider";
import { PreflightBlockedError } from "@/lib/syndication/preflight-core";
import {
  resolveLeaflySettings,
  type LeaflySyncSettings,
} from "@/lib/syndication/sync-settings-core";
import { getLeaflySyncSettings, resetSyncState, saveSyncSettings } from "@/lib/syndication/engine-store";

const BASE = "/admin/integrations/leafly";

export type PushActionResult =
  | { ok: true; result: LeaflyPushResult }
  | { ok: false; error: string };

/**
 * Live full menu sync (POST) to Leafly. Requires settings.manage, full credentials, and
 * explicit confirm=true from the form. Records to syndication_logs + audit either way.
 */
export async function pushLeaflyAction(formData: FormData): Promise<PushActionResult> {
  const session = await requirePermission("settings.manage");
  const confirm = formData.get("confirm") === "true";
  const method = formData.get("method") === "PUT" ? "PUT" : "POST";

  if (!confirm) {
    return { ok: false, error: "Confirmation required for a live Leafly push." };
  }
  if (!isLeaflyConfigured()) {
    return {
      ok: false,
      error: "Leafly is not configured. Set the menu integration key and OAuth credentials first.",
    };
  }

  try {
    const result = await pushLeaflyMenu({ confirm: true, method });
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.skipped ? "skipped" : result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message: result.message,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.skipped
        ? "leafly.push.skipped"
        : result.ok
          ? "leafly.push.success"
          : "leafly.push.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        method: result.method,
        itemCount: result.itemCount,
        httpStatus: result.httpStatus,
        plan: result.planSummary,
        skipped: result.skipped,
      },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const blocked = err instanceof PreflightBlockedError;
    const message = err instanceof Error ? err.message : "Leafly push failed.";
    await recordSyndicationLog({
      channel: "leafly",
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
  | { ok: true; settings: LeaflySyncSettings }
  | { ok: false; error: string };

/** Read the owner's resolved Leafly transmission parameters. */
export async function getLeaflySettingsAction(): Promise<SyncSettingsActionResult> {
  await requirePermission("settings.manage");
  return { ok: true, settings: await getLeaflySyncSettings() };
}

/**
 * Save the owner's Leafly transmission parameters (sync mode, retries, field
 * toggles, force-resend). Values are resolved + CLAMPED through the pure core
 * before storage, so out-of-range input can never break a sync. Audited.
 */
export async function saveLeaflySettingsAction(
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
    "syncMode",
    // SLICE L-3 (L-09). Without this key the owner's ordering toggle would post to a
    // server action that ignores it, and the form would silently revert every save.
    "sendPickupAvailability",
  ]) {
    const v = formData.get(key);
    if (v !== null) raw[key] = v;
  }
  const settings = resolveLeaflySettings(raw);
  const saved = await saveSyncSettings("leafly", settings, session.userId);
  if (!saved.ok) {
    return {
      ok: false,
      error: `Could not save settings: ${saved.error}. If migration 0119 has not been applied yet, apply it first.`,
    };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leafly.sync_settings.save",
    entityType: "syndication",
    entityId: "leafly",
    after: settings,
  });
  revalidatePath(BASE);
  return { ok: true, settings };
}

export type ResetStateActionResult = { ok: true } | { ok: false; error: string };

/**
 * Recovery tool: forget the last-successful-sync hashes so the NEXT push
 * resends every item (use when Leafly-side data is suspected out of sync).
 */
export async function resetLeaflySyncStateAction(): Promise<ResetStateActionResult> {
  const session = await requirePermission("settings.manage");
  try {
    await resetSyncState("leafly");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.sync_state.reset",
      entityType: "syndication",
      entityId: "leafly",
    });
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reset failed." };
  }
}

export type StatusActionResult =
  | { ok: true; httpStatus: number; body: unknown }
  | { ok: false; error: string };

export async function fetchLeaflyStatusAction(): Promise<StatusActionResult> {
  const session = await requirePermission("settings.manage");
  if (!isLeaflyConfigured()) {
    return { ok: false, error: "Leafly is not configured." };
  }
  try {
    const status = await getLeaflyStatus();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.status.fetch",
      entityType: "syndication",
      entityId: "leafly",
      after: { httpStatus: status.httpStatus },
    });
    return { ok: true, httpStatus: status.httpStatus, body: status.body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Status request failed." };
  }
}

export type DescriptionDraftResult =
  | { ok: true; description: string; flags: string[] }
  | { ok: false; error: string };

/** AI DRAFT a plain-text Leafly description. Drafts only — staff must approve before use. */
export async function draftLeaflyDescriptionAction(
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
    const { description, compliance } = await draftLeaflyDescription(input);
    return { ok: true, description, flags: compliance.flags };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return { ok: false, error: "AI is not configured. Add an AI provider key to enable drafting." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Drafting failed." };
  }
}
