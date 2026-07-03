import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  listNonCannabisProducts,
  summarizeNonCannabis,
  type NonCannabisProduct,
} from "@/lib/noncannabis/store";
import { nonCannabisTypeLabel } from "@/lib/naming/noncannabis-core";
import { NonCannabisIntakeForm } from "./NonCannabisIntakeForm";
import { activateNonCannabisAction, archiveNonCannabisAction } from "./actions";

export const dynamic = "force-dynamic";

function money(minor: number): string {
  return `$${(Math.max(0, minor) / 100).toFixed(2)}`;
}

function statusTone(s: string): "green" | "gold" | "neutral" {
  return s === "active" ? "green" : s === "draft" ? "gold" : "neutral";
}

function ProductRow({ p }: { p: NonCannabisProduct }) {
  return (
    <tr className="border-t border-[var(--admin-border)]">
      <td className="px-4 py-3 font-mono text-xs text-[var(--admin-text-muted)]">{p.sku}</td>
      <td className="px-4 py-3 text-[var(--admin-text)]">{p.name}</td>
      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{nonCannabisTypeLabel(p.type)}</td>
      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{p.qty_on_hand}</td>
      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{money(p.price_minor_units)}</td>
      <td className="px-4 py-3 text-center">
        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/admin/inventory/noncannabis/${p.id}/label`}
            className="text-xs text-[var(--admin-accent)] underline"
          >
            🖨 Print SKU
          </Link>
          {p.status === "draft" ? (
            <form action={activateNonCannabisAction}>
              <input type="hidden" name="id" value={p.id} />
              <Button type="submit" size="sm" variant="confirm">
                Confirm
              </Button>
            </form>
          ) : null}
          {p.status !== "archived" ? (
            <form action={archiveNonCannabisAction}>
              <input type="hidden" name="id" value={p.id} />
              <Button type="submit" size="sm" variant="neutral">
                Archive
              </Button>
            </form>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default async function NonCannabisInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; activated?: string; archived?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const products = await listNonCannabisProducts();
  const summary = summarizeNonCannabis(products);
  const drafts = products.filter((p) => p.status === "draft");
  const active = products.filter((p) => p.status === "active");

  return (
    <div>
      <AdminPageHeader
        title="Non-cannabis inventory"
        subtitle="Glass, accessories, papers & devices — professionally tracked (not CCRS-reported)"
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Non-cannabis" }]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            Could not save: {decodeURIComponent(sp.error)}
          </div>
        ) : null}
        {sp.created ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            Staged draft <span className="font-mono">{decodeURIComponent(sp.created)}</span>. Confirm it below to make it active.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Total items" value={String(summary.total)} />
          <StatCard label="Active" value={String(summary.active)} />
          <StatCard label="Drafts" value={String(summary.draft)} />
          <StatCard label="Retail value" value={money(summary.retailValueMinor)} />
        </div>

        <HelpPanel id="noncannabis-intake-help" title="How non-cannabis intake works">
          Fill the form — the system auto-builds a consistent name
          (<code>{"{Brand} {Type} {Size} {Gender} {Color}"}</code>) and a smart
          SKU per type (e.g. <code>BONG-0001-12IN-BLUE-M</code>). Everything stages
          as a <strong>draft</strong> you confirm. Print the SKU as a barcode label
          from the equipment label printer. Non-cannabis items are NOT reported to
          CCRS.
        </HelpPanel>

        <Card>
          <div className="border-b border-[var(--admin-border)] px-5 py-4">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">Add a non-cannabis product</h2>
          </div>
          <div className="p-5">
            <NonCannabisIntakeForm />
          </div>
        </Card>

        {drafts.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
              Drafts awaiting confirmation ({drafts.length})
            </h3>
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-center">Qty</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((p) => (
                    <ProductRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
            Active catalog ({active.length})
          </h3>
          {active.length === 0 ? (
            <EmptyState title="No active non-cannabis products yet" description="Stage and confirm a draft above to get started." />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-center">Qty</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <ProductRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
