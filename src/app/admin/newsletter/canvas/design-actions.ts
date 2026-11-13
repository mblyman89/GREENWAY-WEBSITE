"use server";

/**
 * D243 E-2 (SOP-22 G-122): actions for the email Design section. Anyone who
 * can build a newsletter (blog.manage) can save a design picture and search
 * the menu for product rows.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { searchMenuProducts, storeDesignPicture, DESIGN_UPLOAD_MAX_BYTES } from "@/lib/cms/newsletter-design-server";
import type { DesignProduct } from "@/lib/cms/newsletter-design-core";

export type DesignPictureOut = { ok: true; src: string; w: number; h: number; bytes: number; mime: string } | { ok: false; error: string };

/** Store the picture the browser drew for a design section (a new Media file each time). */
export async function saveDesignPictureAction(formData: FormData): Promise<DesignPictureOut> {
  const session = await requirePermission("blog.manage");
  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").slice(0, 200);
  const blockId = String(formData.get("blockId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "The picture came out empty. Try again." };
  if (file.size > DESIGN_UPLOAD_MAX_BYTES) return { ok: false, error: "The picture is too big to store." };
  if (file.type !== "image/png" && file.type !== "image/jpeg") return { ok: false, error: "The picture must be a PNG or JPEG." };
  const r = await storeDesignPicture({ buffer: Buffer.from(await file.arrayBuffer()), title, uploadedBy: session.userId });
  if (r.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "newsletter.design.render",
      entityType: "media_asset",
      entityId: null,
      after: { blockId, src: r.src.slice(0, 300), w: r.w, h: r.h, bytes: r.bytes, mime: r.mime },
    });
  }
  return r;
}

export type ProductSearchOut = { ok: true; products: DesignProduct[] } | { ok: false; error: string };

/** Live menu products for the "Menu products" rows (in stock, not hidden). */
export async function searchDesignProductsAction(query: string): Promise<ProductSearchOut> {
  await requirePermission("blog.manage");
  try {
    return { ok: true, products: await searchMenuProducts(String(query ?? "")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Could not search the menu." };
  }
}
