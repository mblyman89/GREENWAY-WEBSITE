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
import { buildDesignGif } from "@/lib/cms/newsletter-motion-server";
import { DESIGN_GIF_MAX_FRAMES } from "@/lib/cms/newsletter-polish-core";

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

export type DesignGifOut = { ok: true; src: string; w: number; h: number; bytes: number; frames: number } | { ok: false; error: string };

/**
 * D243 E-6 (G-126): store a moving design section. The browser uploads the
 * frames of the design's entrance (frame0..frameN, PNG or JPEG) and their
 * timings; the server joins them into a GIF in the Media Library.
 */
export async function saveDesignGifAction(formData: FormData): Promise<DesignGifOut> {
  const session = await requirePermission("blog.manage");
  const title = String(formData.get("title") ?? "").slice(0, 200);
  const blockId = String(formData.get("blockId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  let delays: unknown;
  try {
    delays = JSON.parse(String(formData.get("delays") ?? "[]"));
  } catch {
    return { ok: false, error: "The frame timings are missing." };
  }
  const frames: Buffer[] = [];
  let total = 0;
  for (let i = 0; i <= DESIGN_GIF_MAX_FRAMES; i++) {
    const f = formData.get(`frame${i}`);
    if (!(f instanceof File)) break;
    if (f.type !== "image/png" && f.type !== "image/jpeg") return { ok: false, error: "Each frame must be a PNG or JPEG." };
    total += f.size;
    if (f.size === 0 || total > DESIGN_UPLOAD_MAX_BYTES * 2) return { ok: false, error: "The frames are empty or too big to store." };
    frames.push(Buffer.from(await f.arrayBuffer()));
  }
  const r = await buildDesignGif({ frames, delays, title, uploadedBy: session.userId });
  if (!r.ok) return r;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.design.gif",
    entityType: "media_asset",
    entityId: r.mediaId,
    after: { blockId, src: r.url.slice(0, 300), w: r.width, h: r.height, bytes: r.bytes, frames: r.frames },
  });
  return { ok: true, src: r.url, w: r.width, h: r.height, bytes: r.bytes, frames: r.frames };
}
