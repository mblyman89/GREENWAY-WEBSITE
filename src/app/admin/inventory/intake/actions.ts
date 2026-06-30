"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import {
  stageManifest,
  acceptManifest,
  rejectManifest,
} from "@/lib/inventory/intake-store";

export async function importManifestAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const jsonText = (formData.get("json_text") as string | null)?.trim() ?? "";
  if (!jsonText) {
    redirect("/admin/inventory/intake?error=empty");
  }

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

  const staged = await stageManifest(parsed.manifest, rawPayload, session.userId);
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect(`/admin/inventory/intake?error=save`);
  }
  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1`);
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
