import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button } from "@/components/admin/ui";
import { MissingInsight } from "@/components/admin/insight/MissingInsight";
import { listLots, computeInventoryStats, EXPIRING_SOON_DAYS } from "@/lib/inventory/store";
import { inventoryGapInsights } from "@/lib/insight/inventory";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "quarantine", label: "Quarantine" },
  { key: "recalled", label: "Recalled" },
  { key: "sold_out", label: "Sold out" },
  { key: "destroyed", label: "Destroyed" },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
    quarantine: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
    recalled: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]",
    sold_out: "bg-white/10 text-[var(--admin-text-muted)]",
    destroyed: "bg-white/10 text-[var(--admin-text-faint)]",
  };
  const cls = map[status] ?? "bg-white/10 text-[var(--admin-text-muted)]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { q, status } = await searchParams;
  const activeStatus = status ?? "all";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Inventory" subtitle="Lots, COAs & traceability." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator applies migration 0023,
            inventory lots will appear here.
          </div>
        </div>
      </div>
    );
  }

  const [lots, stats] = await Promise.all([
    listLots({ q, status: activeStatus }),
    computeInventoryStats(),
  ]);
  const gaps = inventoryGapInsights(stats);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <AdminPageHeader
        title="Inventory"
        subtitle="Every lot tied to its vendor, brand, COA, and manifest — the traceability backbone most WA retailers don't have. Compliance reports are built on top of this real data, never re-entered."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory" }]} />}
        action={
          <Button href="/admin/inventory/intake" variant="save" size="sm">
            + Import vendor JSON
          </Button>
        }
        help={
          <HelpPanel
            id="inventory"
            title="How inventory lots work"
            steps={[
              "Each received batch becomes a lot, linked to its vendor, brand, and COA (lab result).",
              "Lots carry an expiry date and a lifecycle status (active, quarantine, recalled, etc.).",
              "Use adjustments to record shrink, damage, samples, destructions, and cycle-counts.",
              "Vendor JSON intake (next slice) drafts lots + COAs for you to review and accept.",
            ]}
          >
            <p>
              The &quot;Needs attention&quot; panel surfaces recalls, expiring product, and lots missing a
              COA — the compliance + safety risks that matter most.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Top KPI band */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total lots" value={stats.total} accent="muted" />
          <StatCard label="Active lots" value={stats.active} accent="green" />
          <StatCard
            label="On-hand cost"
            value={fmtMoney(stats.onHandCostMinor)}
            hint="On-hand qty × unit cost"
            accent="gold"
          />
          <StatCard
            label="Needs attention"
            value={
              stats.recalled +
              stats.quarantine +
              stats.expired +
              stats.expiringSoon +
              stats.missingCoa
            }
            hint="Recalls, expiry, quarantine, missing COA"
            accent={
              stats.recalled + stats.quarantine + stats.expired + stats.missingCoa > 0
                ? "orange"
                : "muted"
            }
          />
        </div>

        {/* Needs-attention insight */}
        <MissingInsight
          title="Needs attention"
          subtitle={`Expiry window: ${EXPIRING_SOON_DAYS} days`}
          noun="lot"
          gaps={gaps}
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((t) => {
            const href =
              t.key === "all"
                ? "/admin/inventory"
                : `/admin/inventory?status=${t.key}`;
            const isActive = activeStatus === t.key;
            return (
              <Link
                key={t.key}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[var(--admin-accent)] text-black"
                    : "bg-white/5 text-[var(--admin-text-muted)] hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <form className="flex flex-wrap items-center gap-3" method="get">
          {activeStatus !== "all" && <input type="hidden" name="status" value={activeStatus} />}
          <div className="min-w-48 flex-1">
            <Input name="q" defaultValue={q ?? ""} placeholder="Search product, lot code, or POS key…" />
          </div>
          <Button type="submit" variant="neutral">
            Search
          </Button>
        </form>

        {stats.total === 0 && (
          <EmptyState
            icon="📦"
            title="No inventory lots yet"
            description="Lots will appear here once you import a vendor JSON manifest (next slice) or add one manually."
          />
        )}

        {lots.length > 0 && (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Product / lot</th>
                  <th className="px-4 py-3">Vendor · brand</th>
                  <th className="px-4 py-3 text-center">COA</th>
                  <th className="px-4 py-3 text-right">THC</th>
                  <th className="px-4 py-3 text-right">On hand</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {lots.map((l) => {
                  const expired = l.expires_on != null && l.expires_on < today;
                  return (
                    <tr
                      key={l.id}
                      className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/inventory/${l.id}`}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {l.product_name ?? "(unnamed lot)"}
                        </Link>
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          {l.lot_code ?? "no lot code"}
                          {!l.pos_product_key && (
                            <span className="ml-2 text-[var(--admin-orange)]">· unlinked</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {l.vendor_name ?? l.vendor_id ?? "—"}
                        {l.brand_name && (
                          <span className="text-[var(--admin-text-faint)]"> · {l.brand_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {l.lab ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {l.lab?.total_thc_pct != null ? `${l.lab.total_thc_pct}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--admin-text)]">
                        {fmtQty(l.on_hand_qty, l.unit)}
                        {l.is_sample && (
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                            sample
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {l.expires_on ? (
                          <span className={expired ? "font-semibold text-[var(--admin-danger)]" : ""}>
                            {l.expires_on}
                            {expired && " (expired)"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={l.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lots.length === 0 && stats.total > 0 && (
          <p className="text-sm text-white/50">No lots match your filter.</p>
        )}
      </div>
    </div>
  );
}
