/**
 * D243 E-2 (SOP-22 G-122): server side of the email Design section.
 *
 *  • storeDesignPicture — the browser draws the design (offscreen
 *    <DesignedBanner> + modern-screenshot) and sends the PNG here; sharp
 *    checks it, keeps it at most 1200 px wide (2x the email column),
 *    re-encodes it (PNG when it has see-through parts or few colours, else a
 *    high-quality JPEG; never WebP, which Outlook for Windows can't show) and
 *    files it in the Media Library "newsletter" folder as a NEW file.
 *  • searchMenuProducts — live menu items (in stock, not hidden) for the
 *    "Menu products" rows; the price stays live HTML in the email.
 */
import "server-only";
import { greenwayBusiness } from "@/content/business";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { EMAIL_DESIGN_RENDER_W, matchMenuProducts, productFromMenu, type DesignProduct } from "./newsletter-design-core";

export const DESIGN_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const SITE = greenwayBusiness.website.replace(/\/$/, "");

export type StoredPicture = { ok: true; src: string; w: number; h: number; bytes: number; mime: string } | { ok: false; error: string };

export async function storeDesignPicture(p: { buffer: Buffer; title: string; uploadedBy: string | null }): Promise<StoredPicture> {
  if (p.buffer.length === 0) return { ok: false, error: "The picture came out empty. Try again." };
  if (p.buffer.length > DESIGN_UPLOAD_MAX_BYTES) return { ok: false, error: "The picture is too big to store. Make the design simpler and try again." };
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(p.buffer, { limitInputPixels: 8192 * 8192 });
    const meta = await img.metadata();
    if (meta.format !== "png" && meta.format !== "jpeg") return { ok: false, error: "The picture must be a PNG or JPEG." };
    const resized = img.resize({ width: EMAIL_DESIGN_RENDER_W, withoutEnlargement: true });
    const stats = await sharp(p.buffer).stats();
    const alpha = !stats.isOpaque;
    let out: Buffer;
    let mime: string;
    if (alpha) {
      out = await resized.png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 }).toBuffer();
      mime = "image/png";
    } else {
      const [png, jpg] = await Promise.all([
        resized.clone().png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 }).toBuffer(),
        resized.clone().flatten({ background: "#000000" }).jpeg({ quality: 86, mozjpeg: true, progressive: true }).toBuffer(),
      ]);
      // Flat artwork compresses best as a palette PNG; photos as JPEG.
      if (png.length <= jpg.length * 1.1) {
        out = png;
        mime = "image/png";
      } else {
        out = jpg;
        mime = "image/jpeg";
      }
    }
    const info = await sharp(out).metadata();
    const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "design";
    const ext = mime === "image/png" ? "png" : "jpg";
    const asset = await uploadMedia({
      buffer: out,
      filename: `newsletter-design-${slug}.${ext}`,
      mimeType: mime,
      usageType: "newsletter",
      tags: ["newsletter", "design-section"],
      title: `Newsletter design: ${p.title.slice(0, 120) || "section"}`,
      altText: p.title.slice(0, 200),
      uploadedBy: p.uploadedBy,
      status: "published",
      optimize: false,
    });
    const src = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!src) return { ok: false, error: "Stored, but the picture has no public link." };
    return { ok: true, src, w: info.width ?? 0, h: info.height ?? 0, bytes: out.length, mime };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Could not store the picture." };
  }
}

export async function searchMenuProducts(query: string): Promise<DesignProduct[]> {
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const { loadLiveMenuItemsCached } = await import("@/lib/pos/live-menu");
  const { withResolvedImages } = await import("@/lib/enrichment/image-resolver");
  const items = await loadLiveMenuItemsCached();
  const hits = matchMenuProducts(items, q, 12);
  const withImages = await withResolvedImages(hits).catch(() => hits);
  return withImages.map((it) => productFromMenu(it, SITE));
}
