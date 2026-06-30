"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { setCatalogDraftStatus } from "@/lib/inventory/catalog-drafts";

export async function approveDraftAction(draftId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "approved", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect("/admin/inventory/drafts?error=update");
  }
  redirect("/admin/inventory/drafts?approved=1");
}

export async function dismissDraftAction(draftId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "dismissed", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect("/admin/inventory/drafts?error=update");
  }
  redirect("/admin/inventory/drafts?dismissed=1");
}

export async function restoreDraftAction(draftId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "draft", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect("/admin/inventory/drafts?error=update");
  }
  redirect("/admin/inventory/drafts?restored=1");
}
