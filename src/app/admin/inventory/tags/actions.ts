"use server";

/**
 * src/app/admin/inventory/tags/actions.ts  (R49 S5)
 *
 * Create / edit / delete owner tags and apply / remove them on products.
 * Every write is audited and clears the public menu cache
 * (revalidatePublicMenuSurfaces) so the shop shows the change on the next
 * request instead of after the 60-second cache window.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { NEW_TAG_SLUG, validateTagForm } from "@/lib/menu/product-tags-core";
import {
  applyTagToProducts,
  createTagDefinition,
  deleteTagDefinition,
  listTagDefinitions,
  removeTagFromProducts,
  updateTagDefinition,
} from "@/lib/menu/product-tags-store";

const BASE = "/admin/inventory/tags";

function back(params: Record<string, string>): never {
  const q = new URLSearchParams(params);
  redirect(`${BASE}?${q.toString()}`);
}

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function afterWrite(): void {
  revalidatePath(BASE);
  revalidatePublicMenuSurfaces();
}

export async function createTagAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const list = await listTagDefinitions();
  if (!list.ok) back({ error: list.error });
  const v = validateTagForm(
    {
      label: str(formData, "label"),
      color: str(formData, "color"),
      sortOrder: str(formData, "sort_order") || "100",
      enabled: true,
      showOnMenu: formData.get("show_on_menu") === "on",
    },
    list.defs,
  );
  if (!v.ok) back({ error: v.error });
  const r = await createTagDefinition(v.value, session.userId);
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_tag.created",
    entityType: "tag_definition",
    entityId: r.value.id,
    before: null,
    after: r.value,
  });
  afterWrite();
  back({ created: r.value.label, tag: r.value.id });
}

export async function updateTagAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  const list = await listTagDefinitions();
  if (!list.ok) back({ error: list.error });
  const before = list.defs.find((d) => d.id === id);
  if (!before) back({ error: "That tag no longer exists." });
  const v = validateTagForm(
    {
      label: str(formData, "label"),
      color: str(formData, "color"),
      autoRule: before.autoRule,
      windowDays: str(formData, "window_days") || before.windowDays,
      sortOrder: str(formData, "sort_order") || before.sortOrder,
      enabled: formData.get("enabled") === "on",
      showOnMenu: formData.get("show_on_menu") === "on",
    },
    list.defs.filter((d) => d.id !== id),
    before.slug,
  );
  if (!v.ok) back({ error: `${before.label}: ${v.error}` });
  const r = await updateTagDefinition(id, v.value);
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_tag.updated",
    entityType: "tag_definition",
    entityId: id,
    before,
    after: r.value,
  });
  afterWrite();
  back({ updated: r.value.label });
}

export async function deleteTagAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const id = str(formData, "id");
  if (formData.get("confirm") !== "on") back({ error: "Tick \"Yes, delete\" to delete a tag." });
  const r = await deleteTagDefinition(id);
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product_tag.deleted",
    entityType: "tag_definition",
    entityId: id,
    before: r.value,
    after: null,
  });
  afterWrite();
  back({ deleted: r.value.label });
}

/** Apply or remove one tag on the ticked products. */
export async function assignTagAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const tagId = str(formData, "tag_id");
  const mode = str(formData, "mode") === "remove" ? "remove" : "apply";
  const keys = formData.getAll("key").map((k) => String(k)).filter(Boolean).slice(0, 2000);
  const q = str(formData, "q");
  const carry: Record<string, string> = { tag: tagId };
  if (q) carry.q = q;
  if (keys.length === 0) back({ ...carry, error: "Tick at least one product first." });
  const list = await listTagDefinitions();
  if (!list.ok) back({ ...carry, error: list.error });
  const tag = list.defs.find((d) => d.id === tagId);
  if (!tag) back({ error: "That tag no longer exists." });
  const r = mode === "apply" ? await applyTagToProducts(tagId, keys, session.userId) : await removeTagFromProducts(tagId, keys);
  if (!r.ok) back({ ...carry, error: r.error });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: mode === "apply" ? "product_tag.applied" : "product_tag.removed",
    entityType: "tag_definition",
    entityId: tagId,
    before: null,
    after: { tag: tag.slug, label: tag.label, products: keys.slice(0, 200), count: keys.length },
  });
  afterWrite();
  const note =
    tag.slug === NEW_TAG_SLUG && mode === "remove"
      ? " (products inside the automatic New window keep showing New until the window ends or you turn the New tag off)"
      : "";
  back({ ...carry, [mode === "apply" ? "applied" : "removed"]: String(keys.length), note });
}
