"use server";

/**
 * D243 E-1 (SOP-22 G-121): the locked newsletter brand frame.
 * Only the owner or an admin may change it (decision 2, D243): it is the
 * same header and footer on every newsletter.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { MEDIA_UPLOAD_MAX_BYTES, tooLargeMessage } from "@/lib/media/gif-core";
import { frameDiff, type BrandFrame } from "@/lib/cms/newsletter-frame-core";
import { loadBrandFrame, saveBrandFrame } from "@/lib/cms/newsletter-frame-server";

type Fail = { ok: false; error: string };
const OWNER_ONLY = "Only the owner or an admin can change the brand frame.";

export async function saveBrandFrameAction(raw: unknown): Promise<{ ok: true; frame: BrandFrame } | Fail> {
  const session = await requirePermission("blog.manage");
  if (!isAdminRole(session.profile.role)) return { ok: false, error: OWNER_ONLY };
  const before = await loadBrandFrame();
  const res = await saveBrandFrame(raw, session.userId);
  if (!res.ok) return res;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.frame.save",
    entityType: "site_setting",
    entityId: "newsletter_brand_frame",
    before: before as unknown as Record<string, unknown>,
    after: { changed: frameDiff(before, res.frame), style: res.frame.style, enabled: res.frame.enabled },
  });
  revalidatePath("/admin/newsletter");
  revalidatePath("/admin/newsletter/frame");
  return res;
}

export async function uploadFrameLogoAction(formData: FormData): Promise<{ ok: true; src: string } | Fail> {
  const session = await requirePermission("blog.manage");
  if (!isAdminRole(session.profile.role)) return { ok: false, error: OWNER_ONLY };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a picture." };
  if (file.type !== "image/png" && file.type !== "image/jpeg") return { ok: false, error: "Use a PNG (best, keeps the see-through background) or a JPEG." };
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) return { ok: false, error: tooLargeMessage(file.name, file.size) };
  try {
    const asset = await uploadMedia({
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type,
      usageType: "newsletter",
      tags: ["newsletter", "brand-frame", "logo"],
      title: `Newsletter logo: ${file.name}`,
      uploadedBy: session.userId,
      status: "published",
      // Outlook for Windows does not show WebP: keep PNG/JPEG.
      optimize: false,
    });
    const src = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!src) return { ok: false, error: "Stored, but the picture has no public link." };
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.frame.logo", entityType: "media_asset", entityId: asset.id, after: { bytes: file.size } });
    return { ok: true, src };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}
