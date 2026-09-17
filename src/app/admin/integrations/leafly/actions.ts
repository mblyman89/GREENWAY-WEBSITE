"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  pushLeaflyMenu,
  getLeaflyStatus,
  getLeaflyMenu,
  isLeaflyConfigured,
  type LeaflyPushResult,
} from "@/lib/leafly/push";
import type {
  LeaflyReconcileResult,
  ReadbackTimingVerdict,
} from "@/lib/leafly/readback-core";
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

export type MenuReadbackActionResult =
  | {
      ok: true;
      httpStatus: number;
      summary: string;
      reconcile: LeaflyReconcileResult | null;
      parseWarnings: string[];
      itemsAtLeafly: number;
      /**
       * Whether the comparison ran inside Leafly's documented ingest window
       * (finding L-19). Carried to the client so a premature comparison is labelled
       * as such instead of being read as a list of defects.
       */
      timing: ReadbackTimingVerdict;
    }
  | { ok: false; error: string };

/**
 * Read the menu back from Leafly's sandbox and compare it against what we would send
 * (finding L-14).
 *
 * This runs SERVER-SIDE inside the deployed app on purpose. Leafly's menu certification
 * checklist disqualifies retailers whose "request signatures indicate ... the use of
 * manual tools (e.g., postman or curl)" (readiness report §7, Risk 3). Every Leafly
 * request this business makes must therefore originate here, from the application, and
 * never from anybody's laptop. Driving it from a button in the back office is what makes
 * the resulting request log certifiable.
 *
 * Read-only: it cannot change the Leafly menu, so unlike a push it needs no confirm flag.
 * It is still audited, because "who looked, and when" is exactly what you want when
 * reconstructing a certification review.
 */
export async function fetchLeaflyMenuReadbackAction(): Promise<MenuReadbackActionResult> {
  const session = await requirePermission("settings.manage");
  if (!isLeaflyConfigured()) {
    return {
      ok: false,
      error:
        "Leafly is not configured. Enter the menu integration key and OAuth credentials first.",
    };
  }
  try {
    const result = await getLeaflyMenu();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.menu.readback",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        httpStatus: result.httpStatus,
        itemsAtLeafly: result.parse.ok ? result.parse.items.length : 0,
        reconcileOk: result.reconcile?.ok ?? null,
        errorCount:
          result.reconcile?.issues.filter((i) => i.severity === "error").length ?? null,
        // Audited too: a reviewer reconstructing "why did we think the menu was wrong"
        // needs to know whether the comparison was even run late enough to be valid.
        comparisonWasPremature: result.timing.tooSoon,
        secondsSinceLastPush: result.timing.secondsSincePush,
      },
    });
    // Recorded to syndication_logs as a "preview" mode entry: it contacted Leafly, but it
    // transmitted no menu data, so counting it as a live push would corrupt the channel
    // health figure that the dashboard computes from live attempts.
    await recordSyndicationLog({
      channel: "leafly",
      mode: "preview",
      status: result.ok ? "ok" : "error",
      itemCount: result.parse.ok ? result.parse.items.length : 0,
      payload: null,
      response: result.body,
      message: result.summary,
      createdBy: session.userId,
    });
    return {
      ok: true,
      httpStatus: result.httpStatus,
      summary: result.summary,
      reconcile: result.reconcile,
      parseWarnings: result.parse.ok ? result.parse.warnings : [result.parse.reason],
      itemsAtLeafly: result.parse.ok ? result.parse.items.length : 0,
      timing: result.timing,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Menu read-back failed.",
    };
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
