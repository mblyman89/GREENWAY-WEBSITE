import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Section } from "@/components/admin/ui";
import { isCultiveraClientConfigured } from "@/lib/purchasing/cultivera-client";
import { listSnapshots } from "@/lib/purchasing/cultivera-store";
import { listGrowflowSnapshots } from "@/lib/purchasing/growflow-store";
import { agoLabel } from "@/lib/purchasing/cultivera-menus-ui-core";
import {
  mergeSnapshotRows,
  distinctVendorCount,
  platformLabel,
  platformTone,
} from "@/lib/purchasing/unified-menus-ui-core";
import { listEmailedMenus } from "@/lib/purchasing/emailed-menu-store";
import { sortEmailedRows } from "@/lib/purchasing/email-menu-core";
import { VendorSearch } from "./vendor-search";

export const dynamic = "force-dynamic";

/**
 * Unified Vendor Menus command center (GF-5, evolving CV-4).
 *
 * The buyer's cockpit for live wholesale menus across BOTH marketplaces —
 * Cultivera and GrowFlow. ONE search box runs the smart sequential search
 * (remembered platform first), every result and snapshot carries a platform
 * badge, and fetched menus are saved as immutable snapshots with provenance.
 */

function statusTone(s: string): "green" | "gold" | "danger" | "neutral" {
  if (s === "fetched" || s === "parsed") return "green";
  if (s === "empty" || s === "partial") return "gold";
  if (s === "error") return "danger";
  return "neutral";
}

/** "3h ago" for a fetch timestamp (repo pattern: Date.now() inside a helper). */
function fetchedAgo(iso: string): string {
  return agoLabel(iso, Date.now());
}

export default async function VendorMenusPage() {
  await requirePermission("inventory.manage");

  // Both platforms ride the same crawler gate (base URL + shared secret);
  // per-platform credentials degrade inside the search itself (worker 503s).
  const configured = isCultiveraClientConfigured();

  const [cultiveraSnaps, growflowSnaps, emailedSnaps] = await Promise.all([
    listSnapshots({ limit: 50 }),
    listGrowflowSnapshots({ limit: 50 }),
    listEmailedMenus({ limit: 50 }),
  ]);
  const rows = mergeSnapshotRows(cultiveraSnaps, growflowSnaps);
  // SLICE 83: menus that arrived by email (vendor_menu@), newest first.
  const emailedRows = sortEmailedRows(emailedSnaps);

  const vendorsSeen = distinctVendorCount(rows);
  const latest = rows[0] ?? null;
  const totalItems = rows.reduce((sum, r) => sum + r.itemCount, 0);

  return (
    <div>
      <AdminPageHeader
        title="Vendor Menus"
        subtitle="Live wholesale menus from Cultivera + GrowFlow — one search, smart platform memory, snapshots for your next PO"
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
          id="vendor-menus-help"
          title="How vendor menus work"
          steps={[
            "Type a vendor's name in the ONE search box. We search the platform their menu last came from FIRST (smart memory), and only check the other marketplace if they're not found.",
            "Every result shows a platform badge — Cultivera or GrowFlow — so you always know where a menu lives.",
            "Click 'Fetch menu' to pull that vendor's LIVE menu. It's saved as a snapshot — a dated copy with every product, price, and potency number.",
            "Open a snapshot to browse the items: photos, descriptions, THC/CBD, wholesale prices, case sizes — identical for both platforms.",
          ]}
        >
          <p>
            Fetches run through your own authenticated buyer logins on the crawler worker —
            politely paced, one vendor at a time, one marketplace at a time. Snapshots are permanent
            records, so you can compare a vendor&apos;s menu over time. Purchase orders themselves still live in{" "}
            <Link href="/admin/purchasing" className="text-[var(--admin-accent)] hover:underline">Purchasing</Link>.
          </p>
        </HelpPanel>

        {/* KPIs — computed from real saved snapshots across BOTH platforms. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Saved snapshots" value={String(rows.length)} accent={rows.length > 0 ? "green" : "muted"} />
          <StatCard label="Vendors seen" value={String(vendorsSeen)} accent={vendorsSeen > 0 ? "gold" : "muted"} />
          <StatCard
            label="Latest fetch"
            value={latest ? fetchedAgo(latest.fetchedAt) || "—" : "—"}
            hint={latest ? `${latest.vendorLabel} · ${totalItems} items on file` : "no menus pulled yet"}
            accent="muted"
          />
        </div>

        <Section
          title="Find a vendor"
          description="One box, both marketplaces. We remember which platform each vendor's menu came from and search there first. A first fetch can take up to a minute while the worker signs in."
        >
          {configured ? (
            <VendorSearch />
          ) : (
            <EmptyState
              icon="🔌"
              title="The crawler isn't connected yet"
              description="Set CRAWLER_BASE_URL and CRAWLER_SHARED_SECRET on the site, plus CULTIVERA_EMAIL/PASSWORD and GROWFLOW_EMAIL/PASSWORD on the crawler worker. Saved snapshots below remain browsable either way."
            />
          )}
        </Section>

        <Section
          title="Saved menu snapshots"
          description="Every menu you've pulled from either marketplace, newest first. Click one to browse its items."
        >
          {rows.length === 0 ? (
            <EmptyState
              icon="🌿"
              title="No menus pulled yet"
              description="Search a vendor above and click 'Fetch menu' — the live menu is saved here as a browsable snapshot."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Platform</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3">Fetched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {rows.map((r) => (
                    <tr key={`${r.platform}:${r.id}`} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                      <td className="px-4 py-3">
                        <Link
                          href={r.href}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {r.vendorLabel}
                        </Link>
                        {r.subLabel && (
                          <span className="ml-2 align-middle text-xs text-[var(--admin-text-faint)]">
                            {r.subLabel}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={platformTone(r.platform)}>{platformLabel(r.platform)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{r.itemCount}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-faint)]">
                        {fetchedAgo(r.fetchedAt) || new Date(r.fetchedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* SLICE 83 — menus that vendors EMAIL to the vendor_menu@ mailbox. The
            fetcher scrapes the body, HTML tables, CSV/TXT sheets, and PDFs
            (AI-assisted only when needed, always re-validated), links any
            emailed photos, and saves the result here as a browsable snapshot. */}
        <Section
          title="Emailed vendor menus"
          description="Menus vendors send straight to your vendor_menu@ address. Each email is scraped — body, attachments, and PDFs — and saved here automatically. Spam never makes this list."
        >
          {emailedRows.length === 0 ? (
            <EmptyState
              icon="📬"
              title="No emailed menus yet"
              description="Point vendors at your vendor_menu@ address. When a menu lands there it's parsed and appears here automatically — click one to browse its items and start a purchase order."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Sender</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Parsed from</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {emailedRows.map((r) => (
                    <tr key={r.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                      <td className="px-4 py-3">
                        <Link
                          href={r.href}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {r.senderLabel}
                        </Link>
                        {r.senderSub && (
                          <span className="ml-2 align-middle text-xs text-[var(--admin-text-faint)]">
                            {r.senderSub}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-3 text-[var(--admin-text-muted)]" title={r.subject}>
                        {r.subject}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{r.sourceLabel}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{r.itemCount}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-faint)]">
                        {fetchedAgo(r.receivedAt) || new Date(r.receivedAt).toLocaleDateString()}
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
