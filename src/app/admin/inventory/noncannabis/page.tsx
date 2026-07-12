/**
 * /admin/inventory/noncannabis — the non-cannabis merchandise command center
 * (Task M). Professional playbook for mixed barcoded / non-barcoded retail:
 *
 *   • DUAL IDENTIFIER — items with a manufacturer UPC/EAN scan that code;
 *     items without one (most glass) get an in-house Code128 SKU label from
 *     the equipment-page label printer. Every sellable item is scannable.
 *   • REORDER NOW — out / below-min / near-min list from per-item reorder
 *     points, with suggested order quantities.
 *   • ADJUSTMENTS LIVE HERE — plain retail rules (no CCRS hoops): pick a
 *     reason, note required for theft/other, never below zero, every change
 *     in an append-only ledger.
 *   • SHRINK TELEMETRY — documented reductions in the last 30 days valued at
 *     cost, grouped by reason.
 *   • ABC BY RETAIL VALUE — attention goes where the money is.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  listNonCannabisAdjustments,
  listNonCannabisProducts,
  type NonCannabisProduct,
} from "@/lib/noncannabis/store";
import {
  MERCH_ADJUSTMENT_REASONS,
  buildReorderList,
  classifyMerchAbc,
  summarizeMerchShrink,
  valuateMerch,
  type MerchItem,
} from "@/lib/noncannabis/merch-intel-core";
import { nonCannabisTypeLabel } from "@/lib/naming/noncannabis-core";
import { NonCannabisIntakeForm } from "./NonCannabisIntakeForm";
import { MerchCatalog, type CatalogRow } from "./MerchCatalog";
import { activateNonCannabisAction, archiveNonCannabisAction } from "./actions";

export const dynamic = "force-dynamic";

function money(minor: number): string {
  return `$${(Math.max(0, minor) / 100).toFixed(2)}`;
}

const REASON_LABELS = new Map<string, string>(
  MERCH_ADJUSTMENT_REASONS.map((r) => [r.value, r.label]),
);

/** Map a DB row (0111 columns may be absent pre-migration) to the pure shape. */
function toMerchItem(p: NonCannabisProduct): MerchItem {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type,
    status: p.status,
    qtyOnHand: p.qty_on_hand ?? 0,
    priceMinorUnits: p.price_minor_units ?? 0,
    costMinorUnits: p.cost_minor_units ?? 0,
    barcode: p.barcode ?? null,
    reorderPoint: p.reorder_point ?? 0,
    reorderQty: p.reorder_qty ?? 0,
  };
}

export default async function NonCannabisInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    activated?: string;
    archived?: string;
    adjusted?: string;
    ops?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const [products, adjustments] = await Promise.all([
    listNonCannabisProducts(),
    listNonCannabisAdjustments({ days: 30 }),
  ]);

  const items = products.map(toMerchItem);
  const valuation = valuateMerch(items);
  const abc = classifyMerchAbc(items);
  const reorder = buildReorderList(items);
  const shrink = summarizeMerchShrink(
    adjustments.map((a) => ({ productId: a.product_id, qtyDelta: a.qty_delta, reason: a.reason })),
    new Map(items.map((i) => [i.id, i.costMinorUnits])),
  );

  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const drafts = products.filter((p) => p.status === "draft");
  const active = products.filter((p) => p.status === "active");

  const catalogRows: CatalogRow[] = active.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    type: p.type,
    typeLabel: nonCannabisTypeLabel(p.type),
    status: p.status,
    qtyOnHand: p.qty_on_hand ?? 0,
    priceMinorUnits: p.price_minor_units ?? 0,
    barcode: p.barcode ?? null,
    reorderPoint: p.reorder_point ?? 0,
    reorderQty: p.reorder_qty ?? 0,
    location: p.location ?? null,
    abc: abc.get(p.id) ?? null,
  }));

  const recentAdjustments = adjustments.slice(0, 12);

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
        {sp.adjusted ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            Adjustment posted for <span className="font-mono">{decodeURIComponent(sp.adjusted)}</span> — it&apos;s in the ledger below.
          </div>
        ) : null}
        {sp.ops ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            Settings saved for <span className="font-mono">{decodeURIComponent(sp.ops)}</span>.
          </div>
        ) : null}

        {/* KPI band */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label="Active items" value={String(valuation.activeItems)} />
          <StatCard label="Units on hand" value={String(valuation.totalUnits)} />
          <StatCard label="Retail value" value={money(valuation.retailValueMinor)} hint="price × on hand" />
          <StatCard
            label="Margin on hand"
            value={money(valuation.marginMinor)}
            hint="retail − cost"
            accent="green"
          />
          <StatCard
            label="Reorder now"
            value={String(reorder.length)}
            hint="out / below / near min"
            accent={reorder.length > 0 ? "orange" : "muted"}
          />
          <StatCard
            label="Need SKU labels"
            value={String(valuation.needsLabel)}
            hint="no manufacturer barcode"
            accent="muted"
          />
        </div>

        <HelpPanel id="noncannabis-playbook-help" title="How this page manages merch like a pro">
          <strong>Every item is scannable one of two ways.</strong> Items that ship with a
          manufacturer barcode (lighters, papers) store that UPC/EAN — the check digit is
          validated so typos can&apos;t sneak in — and staff scan the package itself. Items
          without one (pipes, bongs, glass) get an in-house Code128 <em>SKU label</em> printed
          on the label printer from the Equipment page. Set a <strong>reorder point</strong> per
          item and the &ldquo;Reorder now&rdquo; list tells you what to buy before pegs go empty.
          <strong> Quantity adjustments live right here</strong> — pick the item, hit Adjust,
          choose a reason. No CCRS hoops (this is not cannabis), but every change is logged with
          who/why/when, so shrink stays visible instead of mysterious.
        </HelpPanel>

        {/* Reorder now */}
        {reorder.length > 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-surface)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">
                Reorder now ({reorder.length})
              </h2>
              <p className="text-xs text-[var(--admin-text-faint)]">
                out first, then below min, then near min
              </p>
            </div>
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-center">On hand</th>
                    <th className="px-4 py-2 text-center">Min</th>
                    <th className="px-4 py-2 text-center">Suggested order</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reorder.slice(0, 10).map((l) => (
                    <tr key={l.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-2">
                        <span className="text-[var(--admin-text)]">{l.name}</span>{" "}
                        <span className="font-mono text-xs text-[var(--admin-text-faint)]">{l.sku}</span>
                      </td>
                      <td className="px-4 py-2 text-center font-semibold text-[var(--admin-text)]">
                        {l.qtyOnHand}
                      </td>
                      <td className="px-4 py-2 text-center text-[var(--admin-text-muted)]">{l.reorderPoint}</td>
                      <td className="px-4 py-2 text-center font-semibold text-[var(--admin-text)]">
                        {l.suggestedQty}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Badge tone={l.status === "out" ? "danger" : l.status === "below" ? "orange" : "gold"}>
                          {l.status === "out" ? "OUT" : l.status === "below" ? "Below min" : "Near min"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reorder.length > 10 ? (
              <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
                +{reorder.length - 10} more below min — see the catalog table.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Shrink telemetry (30d) */}
        <Card>
          <div className="border-b border-[var(--admin-border)] px-5 py-4">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">
              Documented reductions — last 30 days
            </h2>
            <p className="text-xs text-[var(--admin-text-faint)]">
              What left the shelves outside a sale, valued at cost. A pro shop documents every unit.
            </p>
          </div>
          <div className="p-5">
            {shrink.totalUnitsRemoved === 0 ? (
              <p className="text-sm text-[var(--admin-text-faint)]">
                No reductions recorded in the last 30 days.
              </p>
            ) : (
              <div className="flex flex-wrap gap-4">
                <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">Total</p>
                  <p className="text-lg font-bold text-[var(--admin-text)]">
                    {shrink.totalUnitsRemoved} units · {money(shrink.totalValueRemovedMinor)}
                  </p>
                </div>
                {[...shrink.unitsByReason.entries()].map(([reason, units]) => (
                  <div
                    key={reason}
                    className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-4 py-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                      {REASON_LABELS.get(reason) ?? reason}
                    </p>
                    <p className="text-sm font-semibold text-[var(--admin-text)]">
                      {units} units · {money(shrink.valueByReasonMinor.get(reason) ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Catalog workbench */}
        <div>
          <h3 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
            Active catalog ({active.length})
          </h3>
          <MerchCatalog rows={catalogRows} />
        </div>

        {/* Recent adjustments ledger */}
        {recentAdjustments.length > 0 ? (
          <Card>
            <div className="border-b border-[var(--admin-border)] px-5 py-4">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">Recent adjustments</h2>
              <p className="text-xs text-[var(--admin-text-faint)]">
                Append-only ledger — newest first (last 30 days).
              </p>
            </div>
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-center">Change</th>
                    <th className="px-4 py-2">Reason</th>
                    <th className="px-4 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAdjustments.map((a) => (
                    <tr key={a.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-2 text-xs text-[var(--admin-text-faint)]">
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text)]">
                        {nameById.get(a.product_id) ?? a.product_id.slice(0, 8)}
                      </td>
                      <td
                        className={`px-4 py-2 text-center font-semibold ${
                          a.qty_delta < 0 ? "text-[var(--admin-danger)]" : "text-[var(--admin-green)]"
                        }`}
                      >
                        {a.qty_delta > 0 ? `+${a.qty_delta}` : a.qty_delta}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">
                        {REASON_LABELS.get(a.reason) ?? a.reason}
                      </td>
                      <td className="px-4 py-2 text-xs text-[var(--admin-text-faint)]">{a.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {/* Intake */}
        <Card>
          <div className="border-b border-[var(--admin-border)] px-5 py-4">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">Add a non-cannabis product</h2>
            <p className="text-xs text-[var(--admin-text-faint)]">
              Auto-built name + smart SKU. Scan the manufacturer barcode if the package has one;
              otherwise print the SKU label after confirming.
            </p>
          </div>
          <div className="p-5">
            <NonCannabisIntakeForm />
          </div>
        </Card>

        {/* Drafts */}
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
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--admin-text-muted)]">{p.sku}</td>
                      <td className="px-4 py-3 text-[var(--admin-text)]">{p.name}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {nonCannabisTypeLabel(p.type)}
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{p.qty_on_hand}</td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {money(p.price_minor_units)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/inventory/noncannabis/${p.id}/label`}
                            className="text-xs text-[var(--admin-accent)] underline"
                          >
                            🖨 Print SKU
                          </Link>
                          <form action={activateNonCannabisAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <Button type="submit" size="sm" variant="confirm">
                              Confirm
                            </Button>
                          </form>
                          <form action={archiveNonCannabisAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <Button type="submit" size="sm" variant="neutral">
                              Archive
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
