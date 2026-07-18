import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Section } from "@/components/admin/ui";
import { isCultiveraClientConfigured } from "@/lib/purchasing/cultivera-client";
import { listSnapshots, type CultiveraSnapshotRow } from "@/lib/purchasing/cultivera-store";
import { agoLabel } from "@/lib/purchasing/cultivera-menus-ui-core";
import { VendorSearch } from "./vendor-search";

export const dynamic = "force-dynamic";

/**
 * Cultivera Vendor Menus command center (CV-4).
 *
 * The buyer's cockpit for live wholesale menus: search the marketplace's
 * vendors, pull a vendor's LIVE menu (saved as an immutable snapshot with
 * provenance), then browse items — photos, descriptions, potency, pricing —
 * on the snapshot page. Selection → PO handoff and save-to-media-library
 * arrive in CV-5/CV-6.
 */

function statusTone(s: string): "green" | "gold" | "danger" | "neutral" {
  if (s === "fetched") return "green";
  if (s === "empty") return "gold";
  if (s === "error") return "danger";
  return "neutral";
}

function vendorLabel(s: CultiveraSnapshotRow): string {
  return (s.seller_name ?? "").trim() || (s.cultivera_market_slug ?? "").trim() || "Unknown vendor";
}

/** "3h ago" for a fetch timestamp (repo pattern: Date.now() inside a helper). */
function fetchedAgo(iso: string): string {
  return agoLabel(iso, Date.now());
}

export default async function CultiveraMenusPage() {
  await requirePermission("inventory.manage");

  const configured = isCultiveraClientConfigured();
  const snapshots = await listSnapshots({ limit: 50 });

  const vendorsSeen = new Set(snapshots.map((s) => vendorLabel(s))).size;
  const latest = snapshots[0] ?? null;
  const totalItems = snapshots.reduce((sum, s) => sum + s.item_count, 0);

  return (
    <div>
      <AdminPageHeader
        title="Vendor Menus"
        subtitle="Live Cultivera wholesale menus — search vendors, pull menus, browse products for your next PO"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="cultivera-menus-help"
          title="How vendor menus work"
          steps={[
            "Search a vendor by name (or leave the box empty to list every vendor your Cultivera buyer account can see).",
            "Click ‘Fetch menu’ to pull that vendor's LIVE menu. It's saved as a snapshot — a dated copy with every product, price, and potency number.",
            "Open a snapshot to browse the items: photos, descriptions, THC/CBD, wholesale prices, case sizes.",
            "Coming next: select items to start a purchase order, and save product photos + COAs into your media library.",
          ]}
        >
          <p>
            Fetches run through your own authenticated Cultivera buyer login on the crawler worker —
            politely paced, one vendor at a time. Snapshots are permanent records, so you can compare a
            vendor&apos;s menu over time. Purchase orders themselves still live in{" "}
            <Link href="/admin/purchasing" className="text-[var(--admin-accent)] hover:underline">Purchasing</Link>.
          </p>
        </HelpPanel>

        {/* KPIs — computed from real saved snapshots. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Saved snapshots" value={String(snapshots.length)} accent={snapshots.length > 0 ? "green" : "muted"} />
          <StatCard label="Vendors seen" value={String(vendorsSeen)} accent={vendorsSeen > 0 ? "gold" : "muted"} />
          <StatCard
            label="Latest fetch"
            value={latest ? fetchedAgo(latest.fetched_at) || "—" : "—"}
            hint={latest ? `${vendorLabel(latest)} · ${totalItems} items on file` : "no menus pulled yet"}
            accent="muted"
          />
        </div>

        <Section
          title="Find a vendor"
          description="Search the marketplace by vendor name, then pull their live menu. A first fetch can take up to a minute while the worker signs in."
        >
          {configured ? (
            <VendorSearch />
          ) : (
            <EmptyState
              icon="🔌"
              title="Cultivera isn't connected yet"
              description="Set CRAWLER_BASE_URL and CRAWLER_SHARED_SECRET on the site, and CULTIVERA_EMAIL + CULTIVERA_PASSWORD on the crawler worker. Saved snapshots below remain browsable either way."
            />
          )}
        </Section>

        <Section
          title="Saved menu snapshots"
          description="Every menu you've pulled, newest first. Click one to browse its items."
        >
          {snapshots.length === 0 ? (
            <EmptyState
              icon="🌿"
              title="No menus pulled yet"
              description="Search a vendor above and click ‘Fetch menu’ — the live menu is saved here as a browsable snapshot."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3">Fetched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {snapshots.map((s) => (
                    <tr key={s.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/purchasing/menus/${s.id}`}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {vendorLabel(s)}
                        </Link>
                        {s.cultivera_market_slug && (
                          <span className="ml-2 align-middle text-xs text-[var(--admin-text-faint)]">
                            {s.cultivera_market_slug}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{s.item_count}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-faint)]">
                        {fetchedAgo(s.fetched_at) || new Date(s.fetched_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
