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
      action: result.ok ? "leafly.push.success" : "leafly.push.error",
      entityType: "syndication",
      entityId: "leafly",
      after: { method, itemCount: result.itemCount, httpStatus: result.httpStatus },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Leafly push failed.";
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: "error",
      itemCount: 0,
      message,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
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
