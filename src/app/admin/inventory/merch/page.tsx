/**
 * /admin/inventory/merch - R73 S7 merch inventory (Greenway Merchandising LLC,
 * sold on greenwaymerch.com; never on the cannabis POS or website).
 *
 * Every product published from Merch Studio lands here automatically. Per
 * product and per variant: live / hidden, Printful's live US stock (print on
 * demand: Printful makes each item after a sale), what the website shows,
 * price / Printful cost / profit / margin, units sold and revenue from
 * Printful orders. Actions: hide / show, remove, copy Printful stock onto the
 * website, CSV export. Reads are bounded by withRenderBudget.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux/Breadcrumbs";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { formatCents } from "@/lib/merch-studio/garment-catalog-core";
import { MERCH_STATUS_LABELS, STOCK_LABELS, inventoryView, salesByVariant, stockSellable, type StockStatus } from "@/lib/merch/merch-inventory-core";
import { readMerchCatalog } from "@/lib/merch/merch-inventory-store";
import { loadPrintfulStock } from "@/lib/merch/merch-inventory-server";
import { emptyMerchBoard, loadMerchOrderBoard } from "@/lib/orders/merch-orders-server";
import { withRenderBudget } from "@/lib/supabase/render-budget";
import { emptyCatalog } from "@/lib/merch/merch-inventory-core";
import { removeMerchAction, setMerchStatusAction, syncMerchStockAction } from "./actions";

export const dynamic = "force-dynamic";

const btn = "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-bold";
const day = (iso: string) => (iso ? iso.slice(0, 10) : "-");
const stockTone = (s: StockStatus) => (s === "in_stock" ? "green" : s === "stocked_on_demand" ? "gold" : s === "unknown" ? "neutral" : "danger") as "green" | "gold" | "neutral" | "danger";

export default async function MerchInventoryPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; q?: string; show?: string }> }) {
  const session = await requirePermission("inventory.manage");
  // Phase 4 (G-30A): only owner/admin see "Remove..." (the action re-checks).
  const canRemove = can(session.profile.role, "merch.remove");
  const sp = await searchParams;
  const { catalog, readError } = await withRenderBudget(readMerchCatalog(), { catalog: emptyCatalog(), readError: "The catalog read timed out." }, "merch-inventory catalog");
  const ids = catalog.items.map((i) => i.pkg.product.blank.printfulProductId);
  const [stock, board] = await Promise.all([
    withRenderBudget(loadPrintfulStock(ids), { map: new Map<number, StockStatus>(), problem: "Printful stock check timed out." }, "merch-inventory stock"),
    withRenderBudget(loadMerchOrderBoard(), emptyMerchBoard("Printful orders timed out."), "merch-inventory orders"),
  ]);
  const view = inventoryView(catalog, stock.map, salesByVariant(board.orders));
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = sp.show === "live" || sp.show === "hidden" || sp.show === "attention" ? sp.show : "all";
  const products = view.products.filter((p) =>
    (!q || `${p.title} ${p.handle} ${p.blank}`.toLowerCase().includes(q)) &&
    (show === "all" || (show === "attention" ? p.mismatches > 0 || p.outOfStock > 0 : p.status === show)));
  const t = view.totals;
  const profit = t.revenueCents - t.costCents;

  return (
    <div>
      <AdminPageHeader
        title="Merch inventory"
        subtitle="Greenway Glass & Goods apparel on greenwaymerch.com. Publishing in Merch Studio adds products here automatically."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Merch" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/merch-studio?tab=publish" className={`${btn} bg-[var(--admin-accent)] text-black`}>Publish a design</Link>
            <Link href="/admin/inventory/merch/export" prefetch={false} className={`${btn} bg-white/10 text-white`}>Download CSV</Link>
          </div>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">{String(sp.error).slice(0, 400)}</p> : null}
        {sp.done ? <p role="status" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-white">{String(sp.done).slice(0, 400)}</p> : null}
        {readError ? <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 px-4 py-3 text-sm text-[var(--admin-danger)]">Couldn&apos;t read the merch catalog: {readError}</p> : null}
        {stock.problem ? <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 px-4 py-3 text-sm text-white/80">Stock: {stock.problem}</p> : null}
        {board.problem ? <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 px-4 py-3 text-sm text-white/80">Sales: {board.problem}</p> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Products" value={t.products} hint={`${t.live} live, ${t.hidden} hidden`} accent="green" />
          <StatCard label="Variants" value={t.variants} hint="colour x size combinations" />
          <StatCard label="Need attention" value={t.mismatches + t.outOfStock} hint={`${t.outOfStock} out of stock at Printful, ${t.mismatches} website mismatch`} accent={t.mismatches + t.outOfStock ? "orange" : "muted"} />
          <StatCard label="Units sold" value={t.units} hint={board.configured ? `from ${board.orders.length} Printful orders` : "Printful not connected"} />
          <StatCard label="Revenue / gross profit" value={formatCents(t.revenueCents)} hint={`${formatCents(profit)} after Printful cost (before card fees, tax excluded)`} accent="gold" />
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] p-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-white/70">Search<input name="q" defaultValue={sp.q ?? ""} className="ml-2 rounded border border-white/15 bg-transparent px-2 py-1 text-sm text-white" /></label>
            <label className="text-xs text-white/70">Show
              <select name="show" defaultValue={show} className="ml-2 rounded border border-white/15 bg-[var(--admin-surface)] px-2 py-1 text-sm text-white">
                <option value="all">All</option><option value="live">Live</option><option value="hidden">Hidden</option><option value="attention">Needs attention</option>
              </select>
            </label>
            <button type="submit" className={`${btn} bg-white/10 text-white`}>Apply</button>
          </form>
          <form action={syncMerchStockAction} className="ml-auto">
            <button type="submit" className={`${btn} bg-[var(--admin-accent)] text-black`} disabled={!catalog.items.length}>Copy Printful stock to the website</button>
          </form>
        </div>

        {!catalog.items.length && !readError ? (
          <p className="rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border)] p-6 text-sm text-white/70">
            Nothing published yet. In <Link className="underline" href="/admin/merch-studio?tab=publish">Merch Studio, Publish &amp; Ads</Link>, pick a design and press <b className="text-white">Publish to greenwaymerch.com</b>. It appears here and on the merch website within about a minute.
          </p>
        ) : null}

        <div className="space-y-4">
          {products.map((p) => {
            const rows = view.variants.filter((r) => r.handle === p.handle);
            return (
              <section key={p.handle} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                <div className="flex flex-wrap items-start gap-3 p-4">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an owner-picked product photo
                    <img loading="lazy" decoding="async" src={p.image} alt="" className="h-16 w-16 rounded object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-white">{p.title}</h2>
                      <Badge tone={p.status === "live" ? "green" : "neutral"}>{MERCH_STATUS_LABELS[p.status]}</Badge>
                      {p.mismatches ? <Badge tone="orange">{p.mismatches} website mismatch</Badge> : null}
                      {p.outOfStock ? <Badge tone="danger">{p.outOfStock} out at Printful</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-white/60">
                      /{p.handle} - {p.blank} - {p.colors} colour{p.colors === 1 ? "" : "s"}, {p.sizes} size{p.sizes === 1 ? "" : "s"} - {p.sellable}/{p.variants} sellable - {p.minRetailCents === p.maxRetailCents ? formatCents(p.minRetailCents) : `${formatCents(p.minRetailCents)}-${formatCents(p.maxRetailCents)}`}
                    </p>
                    <p className="text-xs text-white/50">Published {day(p.publishedAt)}{p.byEmail ? ` by ${p.byEmail}` : ""} - updated {day(p.updatedAt)} - stock copied {day(p.stockSyncedAt)} - {p.units} sold, {formatCents(p.revenueCents)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setMerchStatusAction}>
                      <input type="hidden" name="handle" value={p.handle} />
                      <input type="hidden" name="status" value={p.status === "live" ? "hidden" : "live"} />
                      <button type="submit" className={`${btn} ${p.status === "live" ? "bg-white/10 text-white" : "bg-[var(--admin-accent)] text-black"}`}>{p.status === "live" ? "Hide from website" : "Put back on website"}</button>
                    </form>
                    {canRemove && (
                    <details className="text-xs text-white/70">
                      <summary className="cursor-pointer select-none">Remove...</summary>
                      <form action={removeMerchAction} className="mt-2 flex items-center gap-2">
                        <input type="hidden" name="handle" value={p.handle} />
                        <input name="confirm" placeholder={p.handle} aria-label={`Type ${p.handle} to confirm`} className="w-36 rounded border border-white/15 bg-transparent px-2 py-1 text-white" />
                        <button type="submit" className={`${btn} border border-[var(--admin-danger)]/60 text-white`}>Remove</button>
                      </form>
                    </details>
                    )}
                  </div>
                </div>
                <details className="border-t border-[var(--admin-border)]">
                  <summary className="cursor-pointer px-4 py-2 text-xs font-bold text-white/80">Variants ({rows.length})</summary>
                  <div className="max-h-96 overflow-auto px-4 pb-4">
                    <table className="w-full text-xs">
                      <thead className="text-left text-white/50"><tr><th className="py-1">Colour</th><th>Size</th><th>Printful stock</th><th>Website</th><th className="text-right">Retail</th><th className="text-right">Printful</th><th className="text-right">Profit</th><th className="text-right">Margin</th><th className="text-right">Sold</th><th className="text-right">Revenue</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.variantId} className="border-t border-[var(--admin-border)]">
                            <td className="py-1 text-white/85">{r.color}</td><td className="text-white/85">{r.size}</td>
                            <td><Badge tone={stockTone(r.stock)}>{STOCK_LABELS[r.stock]}</Badge></td>
                            <td className={r.mismatch ? "text-[var(--admin-orange)]" : "text-white/70"}>{r.onSite ? "Shown" : "Hidden"}{r.mismatch ? (stockSellable(r.stock) ? " (Printful has it)" : " (Printful is out)") : ""}</td>
                            <td className="text-right text-white">{formatCents(r.retailCents)}</td><td className="text-right text-white/70">{formatCents(r.printfulCents)}</td>
                            <td className={`text-right ${r.profitCents > 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>{formatCents(r.profitCents)}</td>
                            <td className="text-right text-white/70">{(r.marginBps / 100).toFixed(0)}%</td>
                            <td className="text-right text-white/85">{r.units}</td><td className="text-right text-white/85">{formatCents(r.revenueCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            );
          })}
        </div>
        <p className="text-xs text-white/45">
          Print on demand: Printful prints each item after it sells, so there are no shelves to count. &ldquo;Printful stock&rdquo; is whether Printful can get that blank in the US right now (Made to order = Printful restocks it on demand). Prices and costs are the Merch Studio estimate at publish time; Printful&apos;s order charge is the final word. Sales come from Printful orders (cancelled and failed are not counted).
        </p>
      </div>
    </div>
  );
}
