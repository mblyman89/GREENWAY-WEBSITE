import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import { getSnapshot, listSnapshotItems, type BudalertsMenuItemRow } from "@/lib/purchasing/budalerts-store";
import { BUDALERTS_INTERNAL_NOTE, brandPageUrl } from "@/lib/purchasing/budalerts-core";
import { ageLabel, money } from "@/lib/purchasing/vendor-menu-coverage-core";
import { SaveAllBudalertsImagesButton, SaveBudalertsImageButton } from "../../budalerts-controls";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * D242 — one Budalerts brand pull: every listing with its photo, retail price
 * (integer cents, formatted), price per gram, size, strain, the store that
 * lists it, and a link back to the Budalerts product page.
 *
 * INTERNAL USE ONLY (owner's permission from Budalerts): these are RETAIL
 * prices seen at other stores, not wholesale prices, so there is no
 * "add to purchase order" here. Photos save to the Media Library as drafts.
 * Budalerts pages carry no product descriptions today; the column fills if
 * they ever add one.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nowMs(): number {
  return Date.now();
}

function matches(it: BudalertsMenuItemRow, q: string): boolean {
  if (!q) return true;
  const hay = [it.name, it.brand, it.category, it.strain, it.seller_name, it.size_label].filter(Boolean).join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export default async function BudalertsSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; category?: string; back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();

  const snap = await getSnapshot(id);
  if (!snap) notFound();
  const items = await listSnapshotItems(id);
  const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))].sort();
  const visible = items.filter((i) => matches(i, q) && (!category || i.category === category));
  const photosLeft = items.filter((i) => i.image_url && !i.media_asset_id).length;
  const label = (snap.brand_name ?? "").trim() || snap.slug;
  const sourceUrl = brandPageUrl(snap.slug);
  const now = nowMs();

  return (
    <div>
      <AdminPageHeader
        title={label}
        subtitle={`Budalerts · ${snap.item_count} listing${snap.item_count === 1 ? "" : "s"} · ${snap.image_count} photos · ${ageLabel(snap.fetched_at, now)}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus", href: "/admin/purchasing/menus" },
              { label: label },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink
            fallback="/admin/purchasing/menus"
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Vendor Menus
          </BackLink>
          <Badge tone="gold">Budalerts · internal use only</Badge>
          <Badge tone="neutral">{snap.status}</Badge>
          {snap.listing_count !== null && (
            <span className="text-xs text-[var(--admin-text-faint)]">
              Budalerts says {snap.listing_count.toLocaleString("en-US")} in-stock listings
              {snap.dispensary_count !== null ? ` at ${snap.dispensary_count} dispensaries` : ""}
              {snap.checked_text ? ` · ${snap.checked_text.toLowerCase()}` : ""} · {snap.pages_fetched} page
              {snap.pages_fetched === 1 ? "" : "s"} read
            </span>
          )}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">
              Open on Budalerts ↗
            </a>
          )}
        </div>

        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          {BUDALERTS_INTERNAL_NOTE} Prices are <strong>retail</strong> prices other stores list, not wholesale costs.
        </div>

        {(snap.status === "error" || snap.status === "partial") && snap.error_message && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            {snap.status === "partial" ? "Some pages could not be read: " : "This pull failed: "}
            {snap.error_message}
          </div>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Save these product photos into the{" "}
              <Link href="/admin/media" className="text-[var(--admin-accent)] hover:underline">
                media library
              </Link>{" "}
              as drafts, tagged <span className="font-semibold">budalerts</span> + <span className="font-semibold">internal-only</span>. The
              same photo on many listings is saved once.
            </p>
            <SaveAllBudalertsImagesButton snapshotId={id} remaining={photosLeft} />
          </div>
        )}

        <Section
          title={`Listings (${visible.length}${visible.length === items.length ? "" : ` of ${items.length}`})`}
          description="One card per Budalerts listing: a product at one store, at that store's retail price."
        >
          <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, strain, store…"
              aria-label="Search listings"
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
            {sp.back && <input type="hidden" name="back" value={sp.back} />}
            <Button type="submit" variant="neutral" size="sm">
              Filter
            </Button>
            {(q || category) && (
              <Link href={`/admin/purchasing/menus/budalerts/${id}`} className="text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]">
                Clear
              </Link>
            )}
          </form>

          {items.length === 0 ? (
            <EmptyState icon="🌿" title="No listings in this pull" description="Budalerts listed nothing for this brand. Refetch from the Vendor Menus page later." />
          ) : visible.length === 0 ? (
            <EmptyState icon="🔍" title="Nothing matches those filters" description="Try a shorter search or clear the category filter." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((it) => (
                <div key={it.id} className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                  <div className="flex h-36 items-center justify-center bg-black/20">
                    {it.image_url ? (
                      // Remote product photos — plain <img> like the other menu browsers.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img loading="lazy" decoding="async" src={it.image_url} alt={it.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-3xl opacity-40">🌿</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-3">
                    <span className="text-sm font-semibold text-[var(--admin-text)]" title={it.name}>
                      {it.name}
                    </span>
                    <div className="text-xs text-[var(--admin-text-muted)]">
                      {[it.brand, it.category, it.size_label].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {it.strain && it.strain !== it.name && <Badge tone="neutral">{it.strain}</Badge>}
                      {it.below_similar_pct !== null && <Badge tone="green">{it.below_similar_pct}% below similar</Badge>}
                    </div>
                    {it.description && <p className="line-clamp-3 text-xs leading-relaxed text-[var(--admin-text-faint)]">{it.description}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="text-sm font-semibold text-[var(--admin-text)]">{money(it.price_minor)}</span>
                      <span className="text-xs text-[var(--admin-text-faint)]">{it.price_per_gram_minor !== null ? `${money(it.price_per_gram_minor)}/g` : ""}</span>
                    </div>
                    {it.seller_name && (
                      <div className="truncate text-xs text-[var(--admin-text-faint)]" title={it.seller_name}>
                        at {it.seller_name}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {it.product_url && (
                        <a href={it.product_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--admin-accent)] hover:underline">
                          Budalerts ↗
                        </a>
                      )}
                      {it.media_asset_id ? (
                        <Badge tone="green">photo in library</Badge>
                      ) : it.image_url ? (
                        <SaveBudalertsImageButton itemId={it.id} />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
