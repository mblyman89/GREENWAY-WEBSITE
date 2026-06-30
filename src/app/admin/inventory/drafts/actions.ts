"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { setCatalogDraftStatus, approveDraftWithPrice } from "@/lib/inventory/catalog-drafts";

export async function approveDraftAction(draftId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  // Price arrives in DOLLARS from the form; convert to minor units (cents).
  const raw = (formData.get("price") as string | null)?.trim() ?? "";
  const dollars = Number(raw);
  if (!raw || Number.isNaN(dollars) || dollars <= 0) {
    redirect("/admin/inventory/drafts?error=price");
  }
  const priceMinor = Math.round(dollars * 100);
  const result = await approveDraftWithPrice(draftId, priceMinor, session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    // Surface the floor-violation message.
    redirect(`/admin/inventory/drafts?error=floor&msg=${encodeURIComponent(result.error ?? "")}`);
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
