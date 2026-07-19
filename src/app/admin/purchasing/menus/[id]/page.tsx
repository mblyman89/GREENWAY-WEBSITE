import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import { getSnapshot, getSnapshotItems } from "@/lib/purchasing/cultivera-store";
import {
  priceLabel,
  potencyLabel,
  filterMenuItems,
  filterByCategory,
  distinctCategories,
  snapshotSummary,
  saleFlagFromRaw,
  dohFlagFromRaw,
  fetchedVariantCountFromRaw,
  sizesAffordanceLabel,
  type SnapshotLike,
} from "@/lib/purchasing/cultivera-menus-ui-core";
import { remainingMediaCount, isHttpUrl } from "@/lib/purchasing/cultivera-media-core";
import { SaveItemMediaButton, SaveAllMediaButton } from "./media-buttons";

/** "Acme — 42 items · 3h ago" (repo pattern: Date.now() inside a helper). */
function summaryNow(snap: SnapshotLike): string {
  return snapshotSummary(snap, Date.now());
}

export const dynamic = "force-dynamic";

/**
 * Snapshot browser (CV-4): one fetched Cultivera menu, rendered as a product
 * grid — image, name, brand, category, size, potency, wholesale price (cents,
 * formatted), availability, and a COA link when the vendor published one.
 *
 * Filters (search text + category) ride in the URL via a GET form, so the
 * page stays a pure server component. Item selection for the PO builder and
 * "save to media library" layer on in CV-5/CV-6.
 */
export default async function CultiveraSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();

  const snap = await getSnapshot(id);
  if (!snap) notFound();

  const items = await getSnapshotItems(id);
  const categories = distinctCategories(items);
  const visible = filterByCategory(filterMenuItems(items, q), category);
  const mediaRemaining = remainingMediaCount(items);

  const vendorLabel = snap.seller_name ?? snap.cultivera_market_slug ?? "Unknown vendor";

  return (
    <div>
      <AdminPageHeader
        title={vendorLabel}
        subtitle={summaryNow(snap)}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus", href: "/admin/purchasing/menus" },
              { label: vendorLabel },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <Link
            href="/admin/purchasing/menus"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Vendor Menus
          </Link>
        </div>

        {snap.status === "error" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            This snapshot hit an error while saving{snap.error_message ? `: ${snap.error_message}` : "."} Re-fetch the
            vendor from the Vendor Menus page.
          </div>
        )}

        {/* CV-5: snapshot-wide media save. Chunked runs; button shows what's left. */}
        {items.length > 0 && (
          <div className="flex items-center justify-between rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Save this menu&apos;s product photos and COAs into the{" "}
              <Link href="/admin/media" className="text-[var(--admin-accent)] hover:underline">media library</Link>{" "}
              — tagged <span className="font-semibold">cultivera</span> + vendor, stored as drafts with license
              pending review.
            </p>
            <SaveAllMediaButton snapshotId={id} remaining={mediaRemaining} />
          </div>
        )}

        <Section
          title={`Menu items (${visible.length}${visible.length === items.length ? "" : ` of ${items.length}`})`}
          description="A point-in-time copy of the vendor's live menu. Prices are wholesale, per listing."
        >
          {/* GET form keeps filters in the URL — server component stays pure. */}
          <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, brand, category, strain…"
              aria-label="Search menu items"
              className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none sm:max-w-sm"
            />
            <select
              name="category"
              defaultValue={category}
              aria-label="Filter by category"
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)] focus:border-[var(--admin-accent)] focus:outline-none"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button type="submit" variant="neutral" size="sm">
              Filter
            </Button>
            {(q || category) && (
              <Link
                href={`/admin/purchasing/menus/${id}`}
                className="text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
              >
                Clear
              </Link>
            )}
          </form>

          {items.length === 0 ? (
            <EmptyState
              icon="🌿"
              title="No items in this snapshot"
              description="The vendor's menu came back empty. Re-fetch from the Vendor Menus page to try again."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Nothing matches those filters"
              description="Try a shorter search or clear the category filter."
            />
          ) : (
            /* CV-6: tick items → GET to the PO builder. The form only carries
               row IDS (`fromMenu` + `item`); the builder reloads every name,
               price, and vendor from OUR saved snapshot — never from the URL. */
            <form method="get" action="/admin/purchasing/new">
              <input type="hidden" name="fromMenu" value={id} />
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2.5">
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Tick items below, then start a purchase order — they&apos;re added as draft lines
                  (qty 1 at the listed wholesale price) you confirm in the builder.
                </p>
                <Button type="submit" variant="save" size="sm">
                  Add selected to purchase order →
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((it) => {
                const potency = potencyLabel(it);
                const onSale = saleFlagFromRaw(it.raw);
                const dohOk = dohFlagFromRaw(it.raw);
                const variantCount = fetchedVariantCountFromRaw(it.raw);
                const sizesLabel = sizesAffordanceLabel(variantCount);
                return (
                  <div
                    key={it.id}
                    className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
                  >
                    <div className="relative flex h-36 items-center justify-center bg-black/20">
                      {it.image_url ? (
                        // Remote Cultivera CDN images — next/image needs domain allow-listing we can't
                        // pin until live creds exist, so plain <img> like the media library detail page.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_url} alt={it.name ?? ""} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-3xl opacity-40">🌿</span>
                      )}
                      {/* CH-3: mirror Cultivera's own storefront badges. */}
                      {onSale && (
                        <span className="absolute left-2 top-2">
                          <Badge tone="danger">SALE</Badge>
                        </span>
                      )}
                      {dohOk && (
                        <span className="absolute right-2 top-2">
                          <Badge tone="green">DOH COMPLIANT</Badge>
                        </span>
                      )}
                      {/* CH-3: signal that this card opens a per-size table.
                          Shows the real count once fetched, else a neutral hint. */}
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[0.65rem] font-semibold text-white backdrop-blur">
                        {variantCount > 0 ? `📐 ${sizesLabel}` : "📐 sizes & pricing"}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      {/* CV-6: selection for the PO hand-off (label = big tap target). */}
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          name="item"
                          value={it.id}
                          aria-label={`Select ${it.name ?? "menu item"} for purchase order`}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--admin-accent)]"
                        />
                        <span className="text-sm font-semibold text-[var(--admin-text)]" title={it.name ?? undefined}>
                          {it.name ?? "(unnamed item)"}
                        </span>
                      </label>
                      <div className="text-xs text-[var(--admin-text-muted)]">
                        {[it.brand, it.category, it.size_label].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {it.strain_type && <Badge tone="neutral">{it.strain_type}</Badge>}
                        {potency && <Badge tone="gold">{potency}</Badge>}
                      </div>
                      {it.description && (
                        <p className="line-clamp-3 text-xs leading-relaxed text-[var(--admin-text-faint)]">
                          {it.description}
                        </p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-sm font-semibold text-[var(--admin-text)]">
                          {/* Cultivera's list price is the line's MINIMUM across its
                              sizes (live-probed MinPrice) — label it like they do. */}
                          {it.wholesale_price_minor != null
                            ? `From ${priceLabel(it.wholesale_price_minor)}`
                            : priceLabel(it.wholesale_price_minor)}
                        </span>
                        <span className="text-xs text-[var(--admin-text-faint)]">
                          {it.available_qty != null ? `${it.available_qty} avail` : ""}
                        </span>
                      </div>
                      {/* CH-3: the per-size shopping view (variants table).
                          A prominent, full-width control so buyers know each
                          card opens into weights/prices/availability. Shows the
                          fetched size count once known. */}
                      <Link
                        href={`/admin/purchasing/menus/${id}/item/${it.id}`}
                        className="mt-1 inline-flex w-full items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-3 py-2 text-xs font-semibold text-[var(--admin-accent)] transition-colors hover:bg-[var(--admin-accent)]/20"
                      >
                        <span>{variantCount > 0 ? `View ${sizesLabel}` : sizesLabel}</span>
                        <span aria-hidden>→</span>
                      </Link>
                      {it.coa_url && (
                        <a
                          href={it.coa_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                        >
                          View COA ↗
                        </a>
                      )}
                      {/* CV-5: per-item saves. Linked assets show a badge instead. */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {it.media_asset_id ? (
                          <Badge tone="green">image in library</Badge>
                        ) : isHttpUrl(it.image_url) ? (
                          <SaveItemMediaButton snapshotId={id} itemId={it.id} kind="image" label="Save image" />
                        ) : null}
                        {it.coa_media_asset_id ? (
                          <Badge tone="green">COA in library</Badge>
                        ) : isHttpUrl(it.coa_url) ? (
                          <SaveItemMediaButton snapshotId={id} itemId={it.id} kind="coa" label="Save COA" />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </form>
          )}
        </Section>
      </div>
    </div>
  );
}
