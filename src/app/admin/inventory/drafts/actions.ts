"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { setCatalogDraftStatus, approveDraftWithPrice } from "@/lib/inventory/catalog-drafts";
// SLICE 78: create a website category during onboarding ("__new__" pick).
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWebsiteCategoryTypes } from "@/lib/pos/types-store";
import { validateCategoryDraft } from "@/lib/pos/category-registry-core";

export async function approveDraftAction(draftId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  // Price arrives in DOLLARS from the form; convert to minor units (cents).
  const raw = (formData.get("price") as string | null)?.trim() ?? "";
  const dollars = Number(raw);
  if (!raw || Number.isNaN(dollars) || dollars <= 0) {
    redirect("/admin/inventory/drafts?error=price");
  }
  const priceMinor = Math.round(dollars * 100);
  // SLICE 64: the approver's classification picks. The server re-derives what
  // was actually REQUIRED (resolver + labeler) and validates every pick
  // against the closed vocabularies inside approveDraftWithPrice - the form
  // is never trusted.
  let chosenWebsiteCategory = (formData.get("website_category") as string | null)?.trim() || null;
  const chosenHouseType = (formData.get("house_type") as string | null)?.trim() || null;

  // SLICE 78: "__new__" = create the category right here, mid-onboarding.
  // Same pure gatekeeper as Settings → Types (label required, slug derivation,
  // duplicate refusal), same audit trail, then the new value becomes the pick.
  if (chosenWebsiteCategory === "__new__") {
    const newLabel = (formData.get("new_category_label") as string | null)?.trim() || "";
    const registry = await listWebsiteCategoryTypes({ includeInactive: true });
    const parsed = validateCategoryDraft({
      label: newLabel,
      existingValues: registry.map((r) => r.value),
    });
    if (!parsed.ok) {
      redirect(`/admin/inventory/drafts?error=floor&msg=${encodeURIComponent(parsed.error)}`);
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("website_category_types").insert({
      value: parsed.value,
      label: parsed.label,
      helper: "",
      sort_order: parsed.sort_order,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(`/admin/inventory/drafts?error=floor&msg=${encodeURIComponent(error.message)}`);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "website_category.created",
      entityType: "website_category_type",
      entityId: parsed.value,
      after: { value: parsed.value, label: parsed.label, created_during: "draft_onboarding" },
    });
    chosenWebsiteCategory = parsed.value;
  }
  const result = await approveDraftWithPrice(draftId, priceMinor, session.userId, {
    chosenWebsiteCategory,
    chosenHouseType,
  });
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    // Surface the floor-violation / classification-gate message.
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
