"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import {
  createNonCannabisProduct,
  activateNonCannabisProduct,
  archiveNonCannabisProduct,
  previewSkuAndName,
  type NonCannabisDraftInput,
} from "@/lib/noncannabis/store";

/** Parse a dollar string ("25", "25.00", "$25") into integer minor units. */
function dollarsToMinor(raw: FormDataEntryValue | null): number {
  const s = String(raw ?? "").replace(/[^0-9.]/g, "").trim();
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function intVal(raw: FormDataEntryValue | null): number {
  const n = Number.parseInt(String(raw ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function draftFromForm(formData: FormData): NonCannabisDraftInput {
  const gender = String(formData.get("gender") ?? "").trim();
  return {
    brand: String(formData.get("brand") ?? "").trim() || null,
    type: String(formData.get("type") ?? "other").trim(),
    size: String(formData.get("size") ?? "").trim() || null,
    gender: gender === "male" || gender === "female" ? gender : null,
    color: String(formData.get("color") ?? "").trim() || null,
    price_minor_units: dollarsToMinor(formData.get("price")),
    cost_minor_units: dollarsToMinor(formData.get("cost")),
    qty_on_hand: intVal(formData.get("qty")),
    notes: String(formData.get("notes") ?? "").trim() || null,
    kb_category_slug: String(formData.get("kb_category_slug") ?? "").trim() || null,
    nameOverride: String(formData.get("name_override") ?? "").trim() || null,
  };
}

/** Stage a non-cannabis product as a DRAFT (staff confirm it to active). */
export async function createNonCannabisDraftAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const input = draftFromForm(formData);
  if (!input.type) redirect("/admin/inventory/noncannabis?error=type");
  const res = await createNonCannabisProduct(input, session.userId, "draft");
  revalidatePath("/admin/inventory/noncannabis");
  if (!res.ok) {
    redirect(`/admin/inventory/noncannabis?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/admin/inventory/noncannabis?created=${encodeURIComponent(res.sku)}`);
}

export async function activateNonCannabisAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const id = String(formData.get("id") ?? "");
  if (id) await activateNonCannabisProduct(id, session.userId);
  revalidatePath("/admin/inventory/noncannabis");
  redirect("/admin/inventory/noncannabis?activated=1");
}

export async function archiveNonCannabisAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const id = String(formData.get("id") ?? "");
  if (id) await archiveNonCannabisProduct(id, session.userId);
  revalidatePath("/admin/inventory/noncannabis");
  redirect("/admin/inventory/noncannabis?archived=1");
}

/** Preview the SKU + convention name for the current form (no write). */
export async function previewNonCannabisAction(
  input: NonCannabisDraftInput,
): Promise<{ sku: string; name: string; nameOk: boolean; nameIssues: string[] }> {
  await requirePermission("inventory.manage");
  return previewSkuAndName(input);
}
