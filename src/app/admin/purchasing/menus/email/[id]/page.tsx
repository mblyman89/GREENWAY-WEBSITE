import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Badge, Button, Section } from "@/components/admin/ui";
import {
  getEmailedMenu,
  getEmailedMenuItems,
  emailedSourceLabel,
} from "@/lib/purchasing/emailed-menu-store";
import {
  priceLabel,
  potencyLabel,
  filterByCategory,
  distinctCategories,
  agoLabel,
} from "@/lib/purchasing/cultivera-menus-ui-core";

export const dynamic = "force-dynamic";

/** "3h ago" for a receive timestamp (repo pattern: Date.now() inside a helper). */
function receivedAgoLabel(iso: string): string {
  return agoLabel(iso, Date.now());
}

/**
 * SLICE 83 — Emailed menu snapshot browser: one menu a vendor EMAILED to the
 * vendor_menu@ mailbox, rendered with the same professional product grid as
 * the Cultivera/GrowFlow browsers — image (when the email carried one), name,
 * brand, category, size, potency, wholesale price (integer cents, formatted),
 * availability, and the vendor's own description line.
 *
 * PO hand-off — tick items → GET to /admin/purchasing/new with
 * `fromEmailMenu=<snapshotId>` + `item=<id>` params; the builder reloads every
 * line from OUR saved snapshot rows (W11: the URL only carries ids, never
 * names/prices).
 *
 * Filters (search text + category) ride in the URL via a GET form, so the
 * page stays a pure server component.
 */
export default async function EmailedMenuSnapshotPage({
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

  const snap = await getEmailedMenu(id);
  if (!snap) notFound();

  const items = await getEmailedMenuItems(id);
  // Adapt to the shared MenuItemLike helpers (no total-cannabinoids/COA in email menus).
  const likeItems = items.map((it) => ({
    ...it,
    total_cannabinoids_pct: null as number | null,
    coa_url: null as string | null,
  }));
  const categories = distinctCategories(likeItems);
  const ql = q.toLowerCase();
  const searched = ql
    ? likeItems.filter((it) =>
        [it.name, it.brand, it.category, it.strain_type, it.size_label, it.description].some(
          (v) => typeof v === "string" && v.toLowerCase().includes(ql),
        ),
      )
    : likeItems;
  const visible = filterByCategory(searched, category);

  const senderLabel =
    (snap.from_name ?? "").trim() || (snap.from_address ?? "").trim() || "Unknown sender";
  const receivedAgo = receivedAgoLabel(snap.received_at);

  return (
    <div>
      <AdminPageHeader
        title={senderLabel}
        subtitle={`Emailed menu · ${snap.item_count} item${snap.item_count === 1 ? "" : "s"}${receivedAgo ? ` · ${receivedAgo}` : ""}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus", href: "/admin/purchasing/menus" },
              { label: senderLabel },
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
          <Badge tone="neutral">Email</Badge>
          <Badge tone="neutral">{emailedSourceLabel(snap.source, snap.parse_method)}</Badge>
          {snap.from_address && <Badge tone="neutral">{snap.from_address}</Badge>}
        </div>

        {/* Email provenance — the buyer always sees exactly what arrived. */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
          <span className="font-semibold text-[var(--admin-text)]">Subject:</span>{" "}
          {(snap.subject ?? "").trim() || "(no subject)"}
          <span className="mx-2 text-[var(--admin-text-faint)]">·</span>
          received {new Date(snap.received_at).toLocaleString()}
          {snap.vendor_id ? (
            <>
              <span className="mx-2 text-[var(--admin-text-faint)]">·</span>
              matched to a vendor on file — the purchase order builder will pre-select them
            </>
          ) : null}
        </div>

        {snap.status === "error" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            This snapshot hit an error while saving{snap.error_message ? `: ${snap.error_message}` : "."} Ask the
            vendor to re-send the menu.
          </div>
        )}

        <Section
          title={`Menu items (${visible.length}${visible.length === items.length ? "" : ` of ${items.length}`})`}
          description="Parsed from the vendor's email — body, attachments, and PDFs. Prices are wholesale as written by the vendor; confirm them in the purchase order builder."
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
                href={`/admin/purchasing/menus/email/${id}`}
                className="text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
              >
                Clear
              </Link>
            )}
          </form>

          {items.length === 0 ? (
            <EmptyState
              icon="📬"
              title="No items in this snapshot"
              description="The email parsed but produced no items. Ask the vendor to re-send the menu as text, CSV, or a PDF price sheet."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Nothing matches those filters"
              description="Try a shorter search or clear the category filter."
            />
          ) : (
            /* Tick items → GET to the PO builder. The form only carries row
               IDS (`fromEmailMenu` + `item`); the builder reloads every name,
               price, and vendor from OUR saved snapshot — never the URL. */
            <form method="get" action="/admin/purchasing/new">
              <input type="hidden" name="fromEmailMenu" value={id} />
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2.5">
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Tick items below, then start a purchase order — they&apos;re added as draft lines
                  (qty 1 at the emailed wholesale price) you confirm in the builder.
                </p>
                <Button type="submit" variant="save" size="sm">
                  Add selected to purchase order →
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((it) => {
                  const potency = potencyLabel(it);
                  const displayName = (it.name ?? "").trim() || "Menu item";
                  return (
                    <div
                      key={it.id}
                      className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
                    >
                      <div className="flex h-36 items-center justify-center bg-black/20">
                        {it.image_url ? (
                          // Emailed images live in our own media library or the
                          // vendor's host — plain <img> like the other browsers.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.image_url} alt={displayName} className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-3xl opacity-40">📬</span>
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
