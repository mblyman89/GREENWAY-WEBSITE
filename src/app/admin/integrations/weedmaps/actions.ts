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
      after: { itemCount: result.itemCount, httpStatus: result.httpStatus },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "WeedMaps push failed.";
    await recordSyndicationLog({
      channel: "weedmaps",
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
