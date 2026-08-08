import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import { getLeaflinkSnapshot, getLeaflinkSnapshotItems } from "@/lib/purchasing/leaflink-store";
import {
  priceLabel,
  potencyLabel,
  filterMenuItems,
  filterByCategory,
  distinctCategories,
  agoLabel,
} from "@/lib/purchasing/cultivera-menus-ui-core";
import { remainingMediaCount, isHttpUrl } from "@/lib/purchasing/cultivera-media-core";
import { leaflinkCategoryDescription } from "@/lib/purchasing/leaflink-menu-core";
import { SAVE_ASSETS_ITEM_LABEL } from "@/lib/purchasing/save-assets-core";
import {
  resolveMenuDescription,
  DESCRIPTION_FALLBACK_BADGE,
  descriptionFallbackTitle,
} from "@/lib/purchasing/menu-description-core";
import { SaveLeaflinkItemMediaButton } from "./media-buttons";
import { AutoSaveAllButton } from "../../auto-save-all-button";
import { saveAllLeaflinkSnapshotMediaAction } from "../../actions";

export const dynamic = "force-dynamic";

/** "3h ago" for a fetch timestamp (repo pattern: Date.now() inside a helper). */
function fetchedAgoLabel(iso: string): string {
  return agoLabel(iso, Date.now());
}

/**
 * LeafLink snapshot browser (SLICE 84): one fetched LeafLink brand menu,
 * rendered with the SAME product grid as the Cultivera and GrowFlow browsers
 * — image, name, brand, category, size, potency, wholesale price (integer
 * cents, formatted), MSRP, availability. The saved row shapes are
 * structurally compatible, so the pure cultivera-menus-ui-core display
 * helpers are reused as-is; the media planner (cultivera-media-core) is
 * structural too.
 *
 * Full parity with the other browsers:
 *   • Save-to-media-library — per-item image/COA buttons plus a snapshot-wide
 *     bulk button (chunked runs, "leaflink" + vendor tags, drafts).
 *   • PO hand-off — tick items → GET to /admin/purchasing/new with
 *     `fromLeaflinkMenu=<snapshotId>` + `item=<id>` params; the builder
 *     reloads every line from OUR saved snapshot rows (W11: the URL only
 *     carries ids, never names/prices).
 *
 * LeafLink extra: each item may carry a `product_line` (LeafLink groups a
 * brand's menu into product lines) — shown as a small neutral badge.
 *
 * Filters (search text + category) ride in the URL via a GET form, so the
 * page stays a pure server component.
 */
export default async function LeaflinkSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; category?: string; back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();

  const snap = await getLeaflinkSnapshot(id);
  if (!snap) notFound();

  const items = await getLeaflinkSnapshotItems(id);
  const categories = distinctCategories(items);
  const visible = filterByCategory(filterMenuItems(items, q), category);
  const mediaRemaining = remainingMediaCount(items);

  const vendorLabel = (snap.brand_name ?? "").trim() || (snap.company_name ?? "").trim() || "Unknown vendor";
  const companyLabel = (snap.company_name ?? "").trim();
  const fetchedAgo = fetchedAgoLabel(snap.fetched_at);

  return (
    <div>
      <AdminPageHeader
        title={vendorLabel}
        subtitle={`LeafLink · ${snap.item_count} item${snap.item_count === 1 ? "" : "s"}${fetchedAgo ? ` · ${fetchedAgo}` : ""}`}
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
        <div className="flex items-center gap-3">
          <BackLink
            fallback="/admin/purchasing/menus"
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Vendor Menus
          </BackLink>
          <Badge tone="orange">LeafLink</Badge>
          {companyLabel && companyLabel !== vendorLabel && <Badge tone="neutral">{companyLabel}</Badge>}
        </div>

        {snap.status === "error" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            This snapshot hit an error while saving{snap.error_message ? `: ${snap.error_message}` : "."} Re-fetch the
            vendor from the Vendor Menus page.
          </div>
        )}

        {/* Snapshot-wide media save. Chunked runs; button shows what's left. */}
        {items.length > 0 && (
          <div className="flex items-center justify-between rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Save this menu&apos;s product photos and COAs into the{" "}
              <Link href="/admin/media" className="text-[var(--admin-accent)] hover:underline">media library</Link>{" "}
              — tagged <span className="font-semibold">leaflink</span> + vendor, stored as drafts with license
              pending review.
            </p>
            <AutoSaveAllButton
              snapshotId={id}
              remaining={mediaRemaining}
              action={saveAllLeaflinkSnapshotMediaAction}
            />
          </div>
        )}

        <Section
          title={`Menu items (${visible.length}${visible.length === items.length ? "" : ` of ${items.length}`})`}
          description="A point-in-time copy of the brand's live LeafLink menu. Prices are wholesale, per listing."
        >
          {/* GET form keeps filters in the URL — server component stays pure. */}
          <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, brand, category…"
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
                href={`/admin/purchasing/menus/leaflink/${id}`}
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
              description="The brand's menu came back empty. Re-fetch from the Vendor Menus page to try again."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Nothing matches those filters"
              description="Try a shorter search or clear the category filter."
            />
          ) : (
            /* Tick items → GET to the PO builder. The form only carries
               row IDS (`fromLeaflinkMenu` + `item`); the builder reloads every
               name, price, and vendor from OUR saved snapshot — never the URL. */
            <form method="get" action="/admin/purchasing/new">
              <input type="hidden" name="fromLeaflinkMenu" value={id} />
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
                const displayName = (it.name ?? "").trim() || "Unnamed item";
                // SLICE 85 — own description first; when the product has none,
                // the pinned category description (raw.category.description)
                // stands in with a flagged badge, mirroring the image fallback.
                const desc = resolveMenuDescription(
                  it.description,
                  leaflinkCategoryDescription(it.raw),
                  // PR-D2 — the item name lets the smart picker prefer the
                  // category description when the item's own text is its name.
                  it.name ?? null,
                );
                return (
                  <div
                    key={it.id}
                    className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
                  >
                    <div className="flex h-36 items-center justify-center bg-black/20">
                      {it.image_url ? (
                        // Remote LeafLink CloudFront images — next/image needs domain
                        // allow-listing, so plain <img> like the other browsers.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_url} alt={displayName} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-3xl opacity-40">🌿</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      {/* Selection for the PO hand-off (label = big tap target). */}
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          name="item"
                          value={it.id}
                          aria-label={`Select ${displayName} for purchase order`}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--admin-accent)]"
                        />
                        <span className="text-sm font-semibold text-[var(--admin-text)]" title={displayName}>
                          {displayName}
                        </span>
                      </label>
                      <div className="text-xs text-[var(--admin-text-muted)]">
                        {[it.brand, it.category, it.size_label].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {it.product_line && <Badge tone="neutral">{it.product_line}</Badge>}
                        {it.strain_type && <Badge tone="neutral">{it.strain_type}</Badge>}
                        {potency && <Badge tone="gold">{potency}</Badge>}
                      </div>
                      {desc.text && (
                        <div className="space-y-1">
                          {desc.isFallback && (
                            <span title={descriptionFallbackTitle(desc.fallbackReason)}>
                              <Badge tone="gold">{DESCRIPTION_FALLBACK_BADGE}</Badge>
                            </span>
                          )}
                          <p className="line-clamp-3 text-xs leading-relaxed text-[var(--admin-text-faint)]">
                            {desc.text}
                          </p>
                        </div>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-sm font-semibold text-[var(--admin-text)]">
                          {priceLabel(it.wholesale_price_minor)}
                        </span>
                        <span className="text-xs text-[var(--admin-text-faint)]">
                          {it.available_qty != null ? `${it.available_qty} avail` : ""}
                        </span>
                      </div>
                      {it.msrp_minor != null && (
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          MSRP {priceLabel(it.msrp_minor)}
                        </div>
                      )}
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
                      {/* Per-item saves. Linked assets show a badge instead. */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {it.media_asset_id ? (
                          <Badge tone="green">image in library</Badge>
                        ) : isHttpUrl(it.image_url) ? (
                          <SaveLeaflinkItemMediaButton snapshotId={id} itemId={it.id} kind="image" label={SAVE_ASSETS_ITEM_LABEL} />
                        ) : null}
                        {it.coa_media_asset_id ? (
                          <Badge tone="green">COA in library</Badge>
                        ) : isHttpUrl(it.coa_url) ? (
                          <SaveLeaflinkItemMediaButton snapshotId={id} itemId={it.id} kind="coa" label="Save COA" />
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
