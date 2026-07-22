import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import { getSnapshot, getSnapshotItem } from "@/lib/purchasing/cultivera-store";
import { detailFromItemRaw } from "@/lib/purchasing/cultivera-menu-core";
import { strainImagesToSave } from "@/lib/purchasing/cultivera-kb-link-core";
import { priceLabel } from "@/lib/purchasing/cultivera-menus-ui-core";
import { VARIANT_QTY_PARAM_PREFIX } from "@/lib/purchasing/cultivera-po-core";
import { FetchSizesButton } from "./fetch-sizes-button";
import { SaveImageToKbButton } from "./save-to-kb-button";

export const dynamic = "force-dynamic";

/**
 * CH-3 — one menu item's SIZES table, mirroring Cultivera's own product page:
 * every per-size variant with image, clean name, size, strain, price (integer
 * cents, formatted), live availability, order caps, and a quantity input.
 * Chosen quantities submit as a GET to the PO builder (W11: the URL carries
 * only OUR row ids + quantities; names/prices rebuild from OUR stored detail).
 *
 * The variants come from the detail payload stored on OUR item row (raw jsonb,
 * saved by fetchCultiveraProductDetailAction) — browsing here never re-hits
 * Cultivera; only the explicit fetch button does.
 */
export default async function CultiveraItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; itemId: string }>;
  searchParams?: Promise<{ back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id, itemId } = await params;
  const sp = searchParams ? await searchParams : {};

  const snap = await getSnapshot(id);
  if (!snap) notFound();
  const item = await getSnapshotItem(id, itemId);
  if (!item) notFound();

  const detail = detailFromItemRaw(item.raw);
  const variants = detail?.variants ?? [];
  // CV-7b: distinct strains on THIS detail page that have a saveable image
  // (own photo, else the product-card image as a flagged fallback). This is the
  // exact set the "Save all strain images to KB" button will save.
  const saveableStrains = strainImagesToSave(variants, {
    brand: item.brand ?? null,
    lineImageUrl: item.image_url ?? null,
  });
  const vendorLabel = snap.seller_name ?? snap.cultivera_market_slug ?? "Unknown vendor";
  const itemLabel = item.name ?? detail?.name ?? "(unnamed item)";
  const canFetch = Boolean((snap.cultivera_market_id ?? "").trim() && (item.cultivera_item_id ?? "").trim());
  const description = detail?.description ?? item.description;

  return (
    <div>
      <AdminPageHeader
        title={itemLabel}
        subtitle={`${vendorLabel} — per-size pricing & availability`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus", href: "/admin/purchasing/menus" },
              { label: vendorLabel, href: `/admin/purchasing/menus/${id}` },
              { label: itemLabel },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback={`/admin/purchasing/menus/${id}`}
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to {vendorLabel}
          </BackLink>
        </div>

        {/* Product-line header card: image + description + fetch/refresh. */}
        <div className="flex flex-col gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:flex-row">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--admin-radius)] bg-black/20">
            {item.image_url ? (
              // Remote Cultivera CDN — plain <img>, matching the snapshot grid.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt={itemLabel} className="h-full w-full object-contain" />
            ) : (
              <span className="text-3xl opacity-40">🌿</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {detail?.isDohCompliant && <Badge tone="green">DOH COMPLIANT</Badge>}
              {item.category && <Badge tone="neutral">{item.category}</Badge>}
            </div>
            {description && (
              <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">{description}</p>
            )}
            <p className="text-xs text-[var(--admin-text-faint)]">
              Sizes come from Cultivera&apos;s live listing the moment you fetch them, then stay saved
              here — browse and build orders without re-hitting the marketplace.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {canFetch ? (
              <FetchSizesButton
                snapshotId={id}
                itemId={itemId}
                label={variants.length > 0 ? "Refresh sizes & pricing" : "Fetch sizes & pricing"}
              />
            ) : (
              <p className="max-w-[14rem] text-xs text-[var(--admin-text-faint)]">
                This snapshot has no Cultivera market/product ids — re-fetch the vendor&apos;s menu to
                enable per-size pricing.
              </p>
            )}
            {/* CV-7b: ONE button saves one image per DISTINCT strain on this
                detail page to the media library and binds each to the durable
                KB product backbone (every size variant inherits it). */}
            <SaveImageToKbButton
              snapshotId={id}
              itemId={itemId}
              strainCount={saveableStrains.length}
              disabled={saveableStrains.length === 0}
            />
            {saveableStrains.length === 0 && (
              <p className="max-w-[14rem] text-right text-[0.65rem] text-[var(--admin-text-faint)]">
                {variants.length === 0
                  ? "Fetch sizes first, then save strain images."
                  : "No strain images to save yet."}
              </p>
            )}
          </div>
        </div>

        <Section
          title={`Sizes & pricing (${variants.length})`}
          description={
            'Wholesale price per unit, live availability, and any per-order caps — exactly as the vendor lists them. ' +
            'A "placeholder image" tag means that size has no photo of its own, so the product-card image is shown as a stand-in — source a strain-specific image when you can.'
          }
        >
          {variants.length === 0 ? (
            <EmptyState
              icon="📏"
              title="No sizes fetched yet"
              description="Use “Fetch sizes & pricing” above to pull this product's per-size variants from Cultivera."
            />
          ) : (
            /* W11: the form carries only OUR ids (fromMenuDetail + detailItem)
               plus vq_<variantId> quantities. The builder rebuilds every name,
               price, and cap from OUR stored detail payload. */
            <form method="get" action="/admin/purchasing/new">
              <input type="hidden" name="fromMenuDetail" value={id} />
              <input type="hidden" name="detailItem" value={itemId} />
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2.5">
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Enter quantities below, then start a purchase order — each size becomes a draft line
                  at the listed wholesale price (order caps respected).
                </p>
                <Button type="submit" variant="save" size="sm">
                  Add sizes to purchase order →
                </Button>
              </div>
              <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                      <th className="px-3 py-2.5 font-semibold">Product</th>
                      <th className="px-3 py-2.5 font-semibold">Size</th>
                      <th className="px-3 py-2.5 font-semibold">Strain</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Available</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v) => {
                      const soldOut = v.availableQty !== null && v.availableQty <= 0;
                      const inputMax = Math.min(
                        v.maxOrderLimit ?? Number.MAX_SAFE_INTEGER,
                        v.availableQty ?? Number.MAX_SAFE_INTEGER,
                      );
                      return (
                        <tr
                          key={v.variantId ?? `pos-${v.position}`}
                          className="border-b border-[var(--admin-border)] last:border-b-0"
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-black/20">
                                {v.effectiveImageUrl ? (
                                  <>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={v.effectiveImageUrl}
                                      alt={v.cleanName ?? ""}
                                      className="h-full w-full object-contain"
                                    />
                                    {v.imageIsFallback && (
                                      // Stand-in (product-line) image — flag it so the buyer
                                      // knows to source a strain-specific photo later.
                                      <span
                                        className="absolute bottom-0 right-0 rounded-tl bg-[var(--admin-gold,#b8860b)] px-1 text-[0.5rem] font-bold leading-tight text-black"
                                        title="Placeholder: this size has no photo of its own, so the product-card image is shown. Source a strain-specific image when you can."
                                      >
                                        FB
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-base opacity-40">🌿</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-[var(--admin-text)]" title={v.name ?? undefined}>
                                  {v.cleanName ?? v.name ?? "(unnamed)"}
                                </div>
                                {v.description && (
                                  <div className="truncate text-xs text-[var(--admin-text-faint)]" title={v.description}>
                                    {v.description}
                                  </div>
                                )}
                              </div>
                              {v.isDohCompliant && <Badge tone="green">DOH</Badge>}
                              {v.imageIsFallback && (
                                <span title="This size has no photo of its own — showing the product-card image as a placeholder. Source a strain-specific image when available.">
                                  <Badge tone="gold">placeholder image</Badge>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-[var(--admin-text-muted)]">
                            {v.sizeLabel ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            {v.strainType !== "unknown" ? (
                              <Badge tone="neutral">{v.strainType}</Badge>
                            ) : (
                              <span className="text-[var(--admin-text-faint)]">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-semibold text-[var(--admin-text)]">
                                {priceLabel(v.unitPriceMinor)}
                              </span>
                              {v.onSale && v.wasPriceMinor != null && (
                                <span className="text-[0.7rem] text-[var(--admin-text-faint)] line-through">
                                  {priceLabel(v.wasPriceMinor)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-[var(--admin-text-muted)]">
                            {v.availableQty ?? "—"}
                            {v.maxOrderLimit != null && (
                              <div className="text-[0.65rem] text-[var(--admin-text-faint)]">
                                max {v.maxOrderLimit}/order
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {soldOut ? (
                              <Badge tone="danger">sold out</Badge>
                            ) : (
                              <input
                                type="number"
                                name={`${VARIANT_QTY_PARAM_PREFIX}${v.variantId ?? ""}`}
                                min={0}
                                max={Number.isFinite(inputMax) ? inputMax : undefined}
                                step={1}
                                placeholder="0"
                                aria-label={`Quantity for ${v.cleanName ?? v.name ?? "variant"}${v.sizeLabel ? ` ${v.sizeLabel}` : ""}`}
                                className="w-20 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-right text-sm text-[var(--admin-text)] focus:border-[var(--admin-accent)] focus:outline-none"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </Section>
      </div>
    </div>
  );
}
