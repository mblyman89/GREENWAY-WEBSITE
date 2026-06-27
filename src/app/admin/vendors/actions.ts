"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, recordUsage } from "@/lib/media/store";
import type { SocialLinks } from "@/lib/vendors/types";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"]);

function socialFromForm(formData: FormData): SocialLinks {
  const s: SocialLinks = {};
  const ig = String(formData.get("instagram") ?? "").trim();
  const fb = String(formData.get("facebook") ?? "").trim();
  if (ig) s.instagram = ig;
  if (fb) s.facebook = fb;
  return s;
}

/** Update a vendor profile (text fields + optional logo upload). */
export async function updateVendor(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));

  const admin = createSupabaseAdminClient();

  const update: Record<string, unknown> = {
    display_name: String(formData.get("display_name") ?? "").trim(),
    legal_name: orNull(formData.get("legal_name")),
    mission_statement: orNull(formData.get("mission_statement")),
    about: orNull(formData.get("about")),
    website: orNull(formData.get("website")),
    email: orNull(formData.get("email")),
    phone: orNull(formData.get("phone")),
    vendor_day_notes: orNull(formData.get("vendor_day_notes")),
    internal_notes: orNull(formData.get("internal_notes")),
    social_json: socialFromForm(formData),
    updated_by: session.userId,
  };

  // Optional logo upload.
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!IMAGE_MIME.has(logo.type)) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Logo must be PNG, JPG, WEBP, SVG, or GIF."));
    }
    if (logo.size > MAX_LOGO_BYTES) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Logo exceeds 5 MB."));
    }
    const buffer = Buffer.from(await logo.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: logo.name,
      mimeType: logo.type,
      usageType: "vendor-logo",
      title: `${update.display_name} logo`,
      altText: `${update.display_name} logo`,
      uploadedBy: session.userId,
      status: "published", // logos are meant to be displayed
    });
    update.logo_media_id = asset.id;
    await recordUsage(asset.id, "vendor", id, "logo");
  }

  const { error } = await admin.from("vendors").update(update).eq("id", id);
  if (error) redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.updated",
    entityType: "vendor",
    entityId: id,
  });

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${id}`);
  redirect(`/admin/vendors/${id}?saved=1`);
}

/** Publish or unpublish (draft) a vendor. */
export async function setVendorStatus(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "draft");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("vendors").update({ status, updated_by: session.userId }).eq("id", id);
  if (error) redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: status === "published" ? "vendor.published" : "vendor.unpublished",
    entityType: "vendor",
    entityId: id,
  });

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${id}`);
  revalidatePath("/vendors");
  redirect(`/admin/vendors/${id}?saved=1`);
}

/** Update a brand profile (text + optional logo). */
export async function updateBrand(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing brand id."));

  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = {
    display_name: String(formData.get("display_name") ?? "").trim(),
    about: orNull(formData.get("about")),
    mission_statement: orNull(formData.get("mission_statement")),
    product_philosophy: orNull(formData.get("product_philosophy")),
    website: orNull(formData.get("website")),
    status: String(formData.get("status") ?? "draft"),
    updated_by: session.userId,
  };

  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!IMAGE_MIME.has(logo.type)) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand logo must be an image."));
    }
    if (logo.size > MAX_LOGO_BYTES) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand logo exceeds 5 MB."));
    }
    const buffer = Buffer.from(await logo.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: logo.name,
      mimeType: logo.type,
      usageType: "brand-logo",
      title: `${update.display_name} logo`,
      altText: `${update.display_name} logo`,
      uploadedBy: session.userId,
      status: "published",
    });
    update.logo_media_id = asset.id;
    await recordUsage(asset.id, "brand", id, "logo");
  }

  const { error } = await admin.from("brands").update(update).eq("id", id);
  if (error) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "brand.updated",
    entityType: "brand",
    entityId: id,
  });

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#brand-${id}`);
}

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}
