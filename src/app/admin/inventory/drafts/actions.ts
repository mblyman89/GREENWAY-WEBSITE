"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { setCatalogDraftStatus, approveDraftWithPrice } from "@/lib/inventory/catalog-drafts";
// SLICE 78: create a website category during onboarding ("__new__" pick).
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { validateCategoryDraft } from "@/lib/pos/category-registry-core";
// SLICE 92: create a product TYPE during onboarding ("__new_type__" pick) -
// same registry (inventory_types) the Types & Categories settings page manages.
import { validateInventoryTypeDraft } from "@/lib/pos/type-registry-core";

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
  let chosenHouseType = (formData.get("house_type") as string | null)?.trim() || null;
  // SLICE 93: the approver's strain-type pick (empty = keep auto / none).
  // Validated server-side against the canonical taxonomy in
  // approveDraftWithPrice - the form is never trusted.
  const chosenStrainType = (formData.get("strain_type") as string | null)?.trim() || null;
  // SLICE 18-0: the approver's COMPLIANCE picks. Passed through as RAW form
  // strings on purpose - approveDraftWithPrice re-derives what was actually
  // required and validates/refuses every value there. Parsing them here would
  // duplicate the rules, and duplicated compliance rules drift.
  const otherwiseTaken = (formData.get("otherwise_taken") as string | null) ?? null;
  const unitsPerPackage = (formData.get("units_per_package") as string | null) ?? null;
  const lowThcLiquid = (formData.get("low_thc_liquid") as string | null) ?? null;
  const unitThcMg = (formData.get("unit_thc_mg") as string | null) ?? null;
  // SLICE L5: the approver's MEASURED package volume. Raw strings for the same
  // reason as above — approveDraftWithPrice re-derives whether a measurement
  // was required and refuses anything it cannot trust, including a bare "oz".
  const volumeQuantity = (formData.get("net_volume_quantity") as string | null) ?? null;
  const volumeUnit = (formData.get("net_volume_unit") as string | null) ?? null;

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

  // SLICE 92: "__new_type__" = create the product type right here, mid-
  // onboarding. Same pure gatekeeper the registry demands (name required,
  // canonical-key derivation, duplicate refusal against catalog + DB), the
  // same inventory_types table the Types & Categories page manages, the same
  // audit trail as the settings page's create - then the new label becomes
  // the pick. It is mapped to the website category this approval resolves to,
  // so the new type is grouped correctly everywhere from day one.
  if (chosenHouseType === "__new_type__") {
    const newLabel = (formData.get("new_type_label") as string | null)?.trim() || "";
    const existing = await listInventoryTypes({ includeInactive: true });
    const parsed = validateInventoryTypeDraft({
      label: newLabel,
      existingKeys: existing.map((t) => t.key),
    });
    if (!parsed.ok) {
      redirect(`/admin/inventory/drafts?error=floor&msg=${encodeURIComponent(parsed.error)}`);
    }
    const admin = createSupabaseAdminClient();
    // Map the new type to the category this approval files under: the human's
    // pick when made, otherwise the resolver's verdict for THIS draft (a
    // "Keep auto" approval submits no category override). Verified, never
    // guessed - when neither exists the type is created unmapped and can be
    // mapped later at Settings -> Types & Categories.
    let mappedCategory = chosenWebsiteCategory;
    if (!mappedCategory) {
      const { data: draftRow } = await admin
        .from("catalog_product_drafts")
        .select("pos_product_key, name, inventory_type, category")
        .eq("id", draftId)
        .maybeSingle();
      if (draftRow) {
        const d = draftRow as {
          pos_product_key: string | null;
          name: string;
          inventory_type: string | null;
          category: string | null;
        };
        const { resolveWebsiteCategoryForLot } = await import(
          "@/lib/inventory/website-category-resolver-server"
        );
        const resolution = await resolveWebsiteCategoryForLot({
          posProductKey: d.pos_product_key,
          productName: d.name,
          inventoryType: d.inventory_type,
          category: d.category,
        });
        mappedCategory = resolution.websiteCategory;
      }
    }
    const { error } = await admin.from("inventory_types").insert({
      key: parsed.key,
      label: parsed.label,
      notes: "Created during product onboarding.",
      website_category: mappedCategory,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(`/admin/inventory/drafts?error=floor&msg=${encodeURIComponent(error.message)}`);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.created",
      entityType: "inventory_type",
      entityId: parsed.key,
      after: {
        key: parsed.key,
        label: parsed.label,
        website_category: mappedCategory,
        created_during: "draft_onboarding",
      },
    });
    chosenHouseType = parsed.label;
  }
  const result = await approveDraftWithPrice(draftId, priceMinor, session.userId, {
    chosenWebsiteCategory,
    chosenHouseType,
    chosenStrainType,
    otherwiseTaken,
    unitsPerPackage,
    lowThcLiquid,
    unitThcMg,
    volumeQuantity,
    volumeUnit,
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
