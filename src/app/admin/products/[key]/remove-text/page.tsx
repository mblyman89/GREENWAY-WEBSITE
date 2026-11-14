/**
 * src/app/admin/products/[key]/remove-text/page.tsx  (D244 round 3, slice R-9)
 *
 * Owner (verbatim): "I need a way to remove text on a product picture. I want
 * to drag a box over the text, then click a button to remove it. Maybe on the
 * product image card in the main enrichment table, that has the attach and
 * attach as cover buttons, add a remove text button."
 *
 * Opened from a Recommended photo tile or a gallery photo ("Remove text").
 * Reads the product (name, brand, strain, vendor, type) so the AI can tell
 * which text names a DIFFERENT product. Only the editor's buttons do work.
 */
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";
import { getEnrichment } from "@/lib/enrichment/store";
import { getMedia } from "@/lib/media/store";
import { cleanBack, detailUrl } from "@/lib/enrichment/detail-nav-core";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { cardIdentityKeys } from "@/lib/enrichment/image-recommend-v3-server";
import { mediaPublicUrl, textEraseReady } from "@/lib/enrichment/text-erase-server";
import { otherNameOnPhoto, type EraseProduct } from "@/lib/enrichment/text-erase-core";
import { RemoveTextEditor } from "./RemoveTextEditor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function RemoveTextPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ media?: string; back?: string }>;
}) {
  await requirePermission("products.enrich");
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const listBack = cleanBack(sp.back);
  const mediaId = typeof sp.media === "string" && /^[0-9a-f-]{8,64}$/i.test(sp.media.trim()) ? sp.media.trim() : "";

  const published = await getPublishedVersion();
  if (!published) notFound();
  const item = await getItemBySourceKey(published.id, key);
  if (!item) notFound();
  const [enrichment, asset, ready] = await Promise.all([getEnrichment(key).catch(() => null), mediaId ? getMedia(mediaId).catch(() => null) : Promise.resolve(null), textEraseReady()]);
  const imageUrl = asset ? mediaPublicUrl(asset) : null;
  const productBack = detailUrl(key, listBack, "", "#recommended-photos");

  const product: EraseProduct = {
    name: item.product_name?.trim() || item.name,
    brand: item.brand_name || null,
    strainName: item.strain_name ?? null,
    vendor: item.vendor_name ?? null,
    category: formatWebsiteCategory(item.category) || item.category || null,
  };
  const other = asset ? otherNameOnPhoto(asset.visible_text, product) : null;
  const hint = other ? `This photo’s label reads “${(asset?.visible_text ?? "").slice(0, 80)}” — “${other}” is not this product. Press “Find the text” and the AI will box it for you.` : null;
  const identityKey = cardIdentityKeys({ item, enrichment })[0] ?? "";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Remove text from a photo"
        subtitle={`For ${product.name}${product.brand ? ` · ${product.brand}` : ""}${product.category ? ` · ${product.category}` : ""}`}
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Product Enrichment", href: "/admin/products" }, { label: product.name.slice(0, 60), href: productBack }, { label: "Remove text" }]} />
        }
        help={
          <HelpPanel
            id="remove-text"
            title="How Remove text works"
            steps={[
              "Drag a box over the text you want gone. Draw as many boxes as you need.",
              "Or press “Find the text”: the AI photo reader boxes every piece of text and ticks the ones that name a different product, size or brand, with the reason. Untick any you want to keep.",
              "Optional: say what is under the text (for example “black jar label”) so the fill matches.",
              "Press “Remove text”. FLUX Fill repaints only inside the boxes. It takes about 10–30 seconds.",
              "Compare Before and After, then press Attach as cover or Attach to gallery. The original photo is never changed; the new one is saved in the media library.",
            ]}
          />
        }
      />
      {!asset || !imageUrl ? (
        <p className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-orange)]" data-testid="remove-text-missing">
          That photo is not in the media library any more. Go back and pick another.
        </p>
      ) : (
        <RemoveTextEditor
          productKey={key}
          back={listBack || null}
          mediaId={asset.id}
          imageUrl={imageUrl}
          product={product}
          identityKey={identityKey}
          visionReady={ready.vision}
          fluxReady={ready.flux}
          hint={hint}
        />
      )}
    </div>
  );
}
