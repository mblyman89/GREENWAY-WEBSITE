import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import { getGrowflowSnapshot, getGrowflowSnapshotItems } from "@/lib/purchasing/growflow-store";
import {
  priceLabel,
  potencyLabel,
  filterByCategory,
  distinctCategories,
  agoLabel,
} from "@/lib/purchasing/cultivera-menus-ui-core";
import { remainingMediaCount, isHttpUrl } from "@/lib/purchasing/cultivera-media-core";
import {
  sortGrowflowRows,
  filterGrowflowRows,
  growflowDisplayName,
  growflowListingSubtitle,
} from "@/lib/purchasing/growflow-menu-ui-core";
import { SaveGrowflowItemMediaButton } from "./media-buttons";
import { AutoSaveAllButton } from "../../auto-save-all-button";
import { saveAllGrowflowSnapshotMediaAction } from "../../actions";

export const dynamic = "force-dynamic";

/** "3h ago" for a fetch timestamp (repo pattern: Date.now() inside a helper). */
function fetchedAgoLabel(iso: string): string {
  return agoLabel(iso, Date.now());
}

/**
 * GrowFlow snapshot browser (GF-5, completed in GF-6): one fetched GrowFlow
 * menu, rendered with the SAME product grid as the Cultivera browser — image,
 * name, brand, category, size, potency, wholesale price (integer cents,
 * formatted), MSRP, availability. The saved row shapes are structurally
 * compatible, so the pure cultivera-menus-ui-core display helpers are reused
 * as-is; the media planner (cultivera-media-core) is structural too.
 *
 * GF-6 adds full parity with the Cultivera browser:
 *   • Save-to-media-library — per-item image/COA buttons plus a snapshot-wide
 *     bulk button (chunked runs, "growflow" + vendor tags, drafts).
 *   • PO hand-off — tick items → GET to /admin/purchasing/new with
 *     `fromGrowflowMenu=<snapshotId>` + `item=<id>` params; the builder
 *     reloads every line from OUR saved snapshot rows (W11: the URL only
 *     carries ids, never names/prices).
 *
 * Filters (search text + category) ride in the URL via a GET form, so the
 * page stays a pure server component.
 */
export default async function GrowflowSnapshotPage({
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

  const snap = await getGrowflowSnapshot(id);
  if (!snap) notFound();

  const items = await getGrowflowSnapshotItems(id);
  const categories = distinctCategories(items);
  // GF-8: search matches the real strain name too, then sort the grid
  // alphabetically by strain/product name, then size ascending (1g→3.5g→7g).
  const visible = sortGrowflowRows(filterByCategory(filterGrowflowRows(items, q), category));
  const mediaRemaining = remainingMediaCount(items);

  const vendorLabel = (snap.store_name ?? "").trim() || (snap.license_number ?? "").trim() || "Unknown vendor";
  const fetchedAgo = fetchedAgoLabel(snap.fetched_at);

  return (
    <div>
      <AdminPageHeader
        title={vendorLabel}
        subtitle={`GrowFlow · ${snap.item_count} item${snap.item_count === 1 ? "" : "s"}${fetchedAgo ? ` · ${fetchedAgo}` : ""}`}
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
          <Link
            href="/admin/purchasing/menus"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Vendor Menus
          </Link>
          <Badge tone="gold">GrowFlow</Badge>
          {snap.license_number && <Badge tone="neutral">license {snap.license_number}</Badge>}
        </div>

        {snap.status === "error" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            This snapshot hit an error while saving{snap.error_message ? `: ${snap.error_message}` : "."} Re-fetch the
            vendor from the Vendor Menus page.
          </div>
        )}

        {/* GF-6: snapshot-wide media save. Chunked runs; button shows what's left. */}
        {items.length > 0 && (
          <div className="flex items-center justify-between rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Save this menu&apos;s product photos and COAs into the{" "}
              <Link href="/admin/media" className="text-[var(--admin-accent)] hover:underline">media library</Link>{" "}
              — tagged <span className="font-semibold">growflow</span> + vendor, stored as drafts with license
              pending review.
            </p>
            <AutoSaveAllButton
              snapshotId={id}
              remaining={mediaRemaining}
              action={saveAllGrowflowSnapshotMediaAction}
            />
          </div>
        )}

        <Section
          title={`Menu items (${visible.length}${visible.length === items.length ? "" : ` of ${items.length}`})`}
          description="A point-in-time copy of the vendor's live GrowFlow menu. Prices are wholesale, per listing."
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
                href={`/admin/purchasing/menus/growflow/${id}`}
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
            /* GF-6: tick items → GET to the PO builder. The form only carries
               row IDS (`fromGrowflowMenu` + `item`); the builder reloads every
               name, price, and vendor from OUR saved snapshot — never the URL. */
            <form method="get" action="/admin/purchasing/new">
              <input type="hidden" name="fromGrowflowMenu" value={id} />
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
                // GF-8: card title is the real strain name (raw.StrainName),
                // falling back to the listing name; the package label shows as a
                // secondary line so nothing is lost.
                const displayName = growflowDisplayName(it);
                const listingSubtitle = growflowListingSubtitle(it);
                return (
                  <div
                    key={it.id}
                    className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
                  >
                    <div className="flex h-36 items-center justify-center bg-black/20">
                      {it.image_url ? (
                        // Remote GrowFlow Azure-blob images — next/image needs domain
                        // allow-listing, so plain <img> like the Cultivera browser.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_url} alt={displayName} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-3xl opacity-40">🌿</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      {/* GF-6: selection for the PO hand-off (label = big tap target). */}
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
                      {listingSubtitle && (
                        <div className="text-xs font-medium text-[var(--admin-text-muted)]" title={listingSubtitle}>
                          {listingSubtitle}
                        </div>
                      )}
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
                      {/* GF-6: per-item saves. Linked assets show a badge instead. */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {it.media_asset_id ? (
                          <Badge tone="green">image in library</Badge>
                        ) : isHttpUrl(it.image_url) ? (
                          <SaveGrowflowItemMediaButton snapshotId={id} itemId={it.id} kind="image" label="Save image" />
                        ) : null}
                        {it.coa_media_asset_id ? (
                          <Badge tone="green">COA in library</Badge>
                        ) : isHttpUrl(it.coa_url) ? (
                          <SaveGrowflowItemMediaButton snapshotId={id} itemId={it.id} kind="coa" label="Save COA" />
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
