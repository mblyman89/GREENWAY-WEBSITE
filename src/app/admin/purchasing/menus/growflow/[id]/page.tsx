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
  filterMenuItems,
  filterByCategory,
  distinctCategories,
  agoLabel,
} from "@/lib/purchasing/cultivera-menus-ui-core";

export const dynamic = "force-dynamic";

/** "3h ago" for a fetch timestamp (repo pattern: Date.now() inside a helper). */
function fetchedAgoLabel(iso: string): string {
  return agoLabel(iso, Date.now());
}

/**
 * GrowFlow snapshot browser (GF-5): one fetched GrowFlow menu, rendered with
 * the SAME product grid as the Cultivera browser — image, name, brand,
 * category, size, potency, wholesale price (integer cents, formatted), MSRP,
 * availability. The saved row shapes are structurally compatible, so the
 * pure cultivera-menus-ui-core display helpers are reused as-is.
 *
 * Filters (search text + category) ride in the URL via a GET form, so the
 * page stays a pure server component. Save-to-media-library and the PO
 * hand-off arrive in GF-6.
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
  const visible = filterByCategory(filterMenuItems(items, q), category);

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((it) => {
                const potency = potencyLabel(it);
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
                        <img src={it.image_url} alt={it.name ?? ""} className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-3xl opacity-40">🌿</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      <span className="text-sm font-semibold text-[var(--admin-text)]" title={it.name ?? undefined}>
                        {it.name ?? "(unnamed item)"}
                      </span>
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
