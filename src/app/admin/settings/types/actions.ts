"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  countInventoryTypeUsage,
  getInventoryType,
  getWebsiteCategoryType,
  normalizeInventoryTypeKey,
} from "@/lib/pos/types-store";
import { INVENTORY_TYPE_CATALOG, inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";
// SLICE 78: pure validation + real cross-surface counts + audited bulk moves.
import { buildReassignPlan, validateCategoryDraft } from "@/lib/pos/category-registry-core";
import { countCategoryUsage, executeReassign } from "@/lib/pos/category-registry";
import { listWebsiteCategoryTypes } from "@/lib/pos/types-store";

const BASE = "/admin/settings/types";

/** True when an id is a synthetic catalog preset (not yet a real DB row). */
function isCatalogPresetId(id: string): boolean {
  return id.startsWith("catalog:");
}

/** Look up a catalog preset by its synthetic `catalog:<key>` id. */
function catalogPresetById(id: string): { key: string; label: string; website_category: string } | null {
  const key = id.slice("catalog:".length);
  const entry = INVENTORY_TYPE_CATALOG.find((e) => inventoryTypeKey(e.label) === key);
  if (!entry) return null;
  return { key, label: entry.label, website_category: entry.websiteCategory };
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function orNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v === "" ? null : v;
}

// ---------------------------------------------------------------------------
// Website category types
// ---------------------------------------------------------------------------

/** Create a new website category. Value is slugified from the label if blank. */
export async function createWebsiteCategory(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  // SLICE 78: the pure gatekeeper validates the submission against the LIVE
  // registry (label required + length cap, slug derivation, duplicate refusal,
  // junk sort order defaulted) — one brain shared with the self-tests.
  const registry = await listWebsiteCategoryTypes({ includeInactive: true });
  const parsed = validateCategoryDraft({
    label: str(formData, "label"),
    value: str(formData, "value"),
    sort_order: str(formData, "sort_order"),
    existingValues: registry.map((r) => r.value),
  });
  if (!parsed.ok) redirect(`${BASE}?error=` + encodeURIComponent(parsed.error));

  const { error } = await admin.from("website_category_types").insert({
    value: parsed.value,
    label: parsed.label,
    helper: str(formData, "helper"),
    sort_order: parsed.sort_order,
    is_active: true,
    is_system: false,
  });
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "website_category.created",
    entityType: "website_category_type",
    entityId: parsed.value,
    after: { value: parsed.value, label: parsed.label, sort_order: parsed.sort_order },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=category`);
}

/** Update label / helper / sort order / active flag of a website category. */
export async function updateWebsiteCategory(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const value = str(formData, "value");
  if (!value) redirect(`${BASE}?error=` + encodeURIComponent("Missing category value."));

  const update: Record<string, unknown> = {
    label: str(formData, "label"),
    helper: str(formData, "helper"),
    sort_order: Number(str(formData, "sort_order")) || 999,
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };

  const { error } = await admin
    .from("website_category_types")
    .update(update)
    .eq("value", value);
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "website_category.updated",
    entityType: "website_category_type",
    entityId: value,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=category`);
}

/**
 * Delete a website category. Guard: system categories and in-use categories are
 * deactivated rather than hard-deleted, so historical references keep resolving.
 */
export async function deleteWebsiteCategory(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const value = str(formData, "value");
  if (!value) redirect(`${BASE}?error=` + encodeURIComponent("Missing category value."));

  const existing = await getWebsiteCategoryType(value);
  if (!existing) redirect(`${BASE}?error=` + encodeURIComponent("Category not found."));

  // SLICE 78: the guard now counts ALL four surfaces (live menu, staged menu
  // drafts, onboarding picks, type mappings) — the old count missed staged
  // drafts and onboarding picks, so a "safe" hard delete could orphan them.
  const detailed = await countCategoryUsage(value);
  const usage =
    detailed.publishedItems + detailed.stagedItems + detailed.draftPicks + detailed.typeMappings;

  if (existing.is_system || usage > 0) {
    // Soft delete (deactivate) to protect historical data + built-ins.
    const { error } = await admin
      .from("website_category_types")
      .update({ is_active: false })
      .eq("value", value);
    if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message));

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "website_category.deactivated",
      entityType: "website_category_type",
      entityId: value,
    });
    revalidatePath(BASE);
    const reason = existing.is_system ? "system" : `in-use-${usage}`;
    redirect(`${BASE}?saved=deactivated&reason=${reason}`);
  }

  // Safe hard delete: non-system, never used.
  const { error } = await admin.from("website_category_types").delete().eq("value", value);
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "website_category.deleted",
    entityType: "website_category_type",
    entityId: value,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=deleted`);
}

// ---------------------------------------------------------------------------
// Inventory types
// ---------------------------------------------------------------------------

/** Create a canonical inventory type. */
export async function createInventoryType(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const label = str(formData, "label");
  if (!label) redirect(`${BASE}?error=` + encodeURIComponent("A label is required.") + "&tab=inventory");

  const rawKey = str(formData, "key") || label;
  const key = normalizeInventoryTypeKey(rawKey);
  if (!key) redirect(`${BASE}?error=` + encodeURIComponent("Could not derive a key.") + "&tab=inventory");

  const { error } = await admin.from("inventory_types").insert({
    key,
    label,
    notes: orNull(formData, "notes"),
    website_category: orNull(formData, "website_category"),
    is_active: true,
    is_system: false,
  });
  if (error) {
    const msg = error.code === "23505" ? `An inventory type with key "${key}" already exists.` : error.message;
    redirect(`${BASE}?error=` + encodeURIComponent(msg) + "&tab=inventory");
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_type.created",
    entityType: "inventory_type",
    entityId: key,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=inventory&tab=inventory`);
}

/** Update an inventory type's label / notes / mapping / active flag. */
export async function updateInventoryType(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing id.") + "&tab=inventory");

  const isActive = formData.get("is_active") === "on" || formData.get("is_active") === "true";

  // Materialize (adopt) path: catalog presets aren't real DB rows yet. The first
  // time a built-in preset is edited we upsert it into inventory_types by key so
  // it becomes a real, editable row — grounded in the canonical catalog.
  if (isCatalogPresetId(id)) {
    const preset = catalogPresetById(id);
    if (!preset) redirect(`${BASE}?error=` + encodeURIComponent("Unknown built-in type.") + "&tab=inventory");

    const { error } = await admin
      .from("inventory_types")
      .upsert(
        {
          key: preset.key,
          label: str(formData, "label") || preset.label,
          notes: orNull(formData, "notes"),
          website_category: orNull(formData, "website_category"),
          is_active: isActive,
          is_system: true,
        },
        { onConflict: "key" },
      );
    if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message) + "&tab=inventory");

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.adopted",
      entityType: "inventory_type",
      entityId: preset.key,
    });
    revalidatePath(BASE);
    redirect(`${BASE}?saved=inventory&tab=inventory`);
  }

  const update: Record<string, unknown> = {
    label: str(formData, "label"),
    notes: orNull(formData, "notes"),
    website_category: orNull(formData, "website_category"),
    is_active: isActive,
  };

  const { error } = await admin.from("inventory_types").update(update).eq("id", id);
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message) + "&tab=inventory");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_type.updated",
    entityType: "inventory_type",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=inventory&tab=inventory`);
}

/**
 * Delete an inventory type. Guard: in-use or system types are deactivated;
 * never-used custom types may be hard-deleted.
 */
export async function deleteInventoryType(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const admin = createSupabaseAdminClient();

  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing id.") + "&tab=inventory");

  // Catalog presets are built-in (is_system): "delete" means hide. We materialize
  // the preset into the DB as an inactive row (upsert by key) so it stays hidden.
  if (isCatalogPresetId(id)) {
    const preset = catalogPresetById(id);
    if (!preset) redirect(`${BASE}?error=` + encodeURIComponent("Unknown built-in type.") + "&tab=inventory");

    const { error } = await admin
      .from("inventory_types")
      .upsert(
        {
          key: preset.key,
          label: preset.label,
          website_category: preset.website_category,
          is_active: false,
          is_system: true,
        },
        { onConflict: "key" },
      );
    if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message) + "&tab=inventory");

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.deactivated",
      entityType: "inventory_type",
      entityId: preset.key,
    });
    revalidatePath(BASE);
    redirect(`${BASE}?saved=deactivated&reason=system&tab=inventory`);
  }

  const existing = await getInventoryType(id);
  if (!existing) redirect(`${BASE}?error=` + encodeURIComponent("Inventory type not found.") + "&tab=inventory");

  const usage = await countInventoryTypeUsage(existing.key);

  if (existing.is_system || usage > 0) {
    const { error } = await admin.from("inventory_types").update({ is_active: false }).eq("id", id);
    if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message) + "&tab=inventory");

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.deactivated",
      entityType: "inventory_type",
      entityId: id,
    });
    revalidatePath(BASE);
    const reason = existing.is_system ? "system" : `in-use-${usage}`;
    redirect(`${BASE}?saved=deactivated&reason=${reason}&tab=inventory`);
  }

  const { error } = await admin.from("inventory_types").delete().eq("id", id);
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message) + "&tab=inventory");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_type.deleted",
    entityType: "inventory_type",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=deleted&tab=inventory`);
}

// ---------------------------------------------------------------------------
// SLICE 78: bulk reassign — move every product from one category to another
// ---------------------------------------------------------------------------

/**
 * Move ALL products from one website category to another, across every
 * surface at once: the LIVE menu, staged menu drafts, onboarding draft picks,
 * and inventory-type mappings (so future intake follows). The pure planner
 * (buildReassignPlan) validates the move against the live registry and REAL
 * per-surface counts; historical (archived) menu versions are never touched.
 */
export async function reassignCategoryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const from = str(formData, "from");
  const to = str(formData, "to");

  const registry = await listWebsiteCategoryTypes({ includeInactive: true });
  const counts = await countCategoryUsage(from);
  const plan = buildReassignPlan({ from, to, registry, counts });
  if (!plan.ok) redirect(`${BASE}?error=` + encodeURIComponent(plan.error) + "&tab=website");

  const result = await executeReassign(from, to);
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error) + "&tab=website");

  const moved =
    result.moved.publishedItems + result.moved.stagedItems + result.moved.draftPicks + result.moved.typeMappings;

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "website_category.reassigned",
    entityType: "website_category_type",
    entityId: from,
    before: { from, counts },
    after: { to, moved: result.moved },
  });

  revalidatePath(BASE);
  revalidatePath("/menu");
  redirect(`${BASE}?saved=reassigned&reason=${moved}&tab=website`);
}
