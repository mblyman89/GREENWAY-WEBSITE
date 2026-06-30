"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { fetchTransferJson } from "@/lib/inventory/transfer-fetch";
import {
  stageManifest,
  acceptManifest,
  rejectManifest,
} from "@/lib/inventory/intake-store";

/** Shared: parse + stage a JSON payload, redirect on each failure mode. */
async function stageJsonText(
  jsonText: string,
  actorId: string,
  sourceUrl: string | null,
) {
  const parsed = parseVendorJson(jsonText);
  if (!parsed.ok) {
    redirect(`/admin/inventory/intake?error=parse`);
  }
  if (parsed.manifest.lines.length === 0) {
    redirect(`/admin/inventory/intake?error=nolines`);
  }

  let rawPayload: unknown = jsonText;
  try {
    rawPayload = JSON.parse(jsonText);
  } catch {
    rawPayload = jsonText;
  }

  const staged = await stageManifest(parsed.manifest, rawPayload, actorId, {
    sourceUrl,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect(`/admin/inventory/intake?error=save`);
  }
  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1`);
}

export async function importManifestAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const jsonText = (formData.get("json_text") as string | null)?.trim() ?? "";
  if (!jsonText) {
    redirect("/admin/inventory/intake?error=empty");
  }
  await stageJsonText(jsonText, session.userId, null);
}

/**
 * Import by pasting the WCIA "Transfer Data Link" URL from the order email.
 * We fetch the JSON server-side (collapsing the doubled-prefix link bug) so the
 * employee never has to open and copy the raw JSON — and never has to click each
 * per-product COA link, since the transfer JSON already embeds them all.
 */
export async function importManifestFromUrlAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const url = (formData.get("transfer_url") as string | null)?.trim() ?? "";
  if (!url) {
    redirect("/admin/inventory/intake?error=emptyurl");
  }

  const fetched = await fetchTransferJson(url);
  if (!fetched.ok) {
    redirect(`/admin/inventory/intake?error=fetch`);
  }

  await stageJsonText(fetched.jsonText, session.userId, fetched.finalUrl);
}

export async function acceptManifestAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await acceptManifest(manifestId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=accept`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?accepted=${result.activated}`);
}

export async function rejectManifestAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await rejectManifest(manifestId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=reject`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?rejected=1`);
}
