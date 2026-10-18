/**
 * R73 S1 - "Greenway Merch orders", the LAST panel on /admin/orders.
 *
 * The owner asked for this table to be "identical to the other two on there",
 * so it renders through the SAME shell (OrdersPanel: header, four stat cards,
 * nine tabs, search / dates / totals / sort, pager, empty state) and the SAME
 * row (OrderBoardRow with the status pill and progress strip, Details on the
 * far right). Only the rows' source differs: Printful, via merch-orders-core.
 */
import { OrdersPanel } from "@/components/admin/orders/OrdersPanel";
import { OrderBoardRow } from "@/components/admin/orders/OrderBoardRow";
import { OrderStatusPill } from "@/components/admin/orders/OrderStatusPill";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { Badge } from "@/components/admin/ui/Badge";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { withBackParam, type SearchParamsShape } from "@/lib/admin/back-link-core";
import type { OrdersPanelQuery } from "@/lib/orders/order-panels-core";
import {
  buildMerchPanelView,
  merchHiddenWarning,
  merchLoadCapNotice,
  merchOrderHandle,
  merchStatusLabel,
} from "@/lib/orders/merch-orders-core";
import type { MerchBoard } from "@/lib/orders/merch-orders-server";

function shortAgo(iso: string, now: Date): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function MerchOrdersPanel({
  board,
  query,
  searchParams,
  now,
}: {
  board: MerchBoard;
  query: OrdersPanelQuery;
  searchParams: SearchParamsShape;
  now: Date;
}) {
  const view = buildMerchPanelView(board.orders, query);
  const hidden = merchHiddenWarning(view.hiddenNeedsPerson);
  const cap = merchLoadCapNotice(board.orders.length, board.totalAtPrintful);

  const notices =
    !board.configured || board.problem ? (
      <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
        {!board.configured
          ? "Printful isn’t connected on this site yet: add PRINTFUL_API_TOKEN (Greenway Merchandising LLC’s token, the same one Merch Studio uses) in Vercel, then redeploy."
          : board.problem}
      </div>
    ) : null;

  const beforeList =
    hidden || cap ? (
      <>
        {hidden ? (
          <div
            role="status"
            className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-xs font-semibold text-[var(--admin-danger)]"
          >
            {hidden}
          </div>
        ) : null}
        {cap ? <p className="mt-2 text-xs text-[var(--admin-text-faint)]">{cap}</p> : null}
      </>
    ) : null;

  return (
    <OrdersPanel
      panel="merch"
      title="Greenway Merch orders"
      subtitle="Apparel orders from greenwaymerch.com, made and shipped by Printful. Open a draft to confirm it for production."
      icon="👕"
      counts={view.counts}
      query={query}
      searchParams={searchParams}
      window={view.window}
      total={view.total}
      notices={notices}
      beforeList={beforeList}
      emptyDescription={
        board.orders.length
          ? "No merch orders match these filters. Choose “All” or press Clear to see the rest."
          : "When someone buys from greenwaymerch.com the order shows up here automatically — newest first."
      }
    >
      {view.rows.map((o) => {
        const href = withBackParam(`/admin/orders/merch/${encodeURIComponent(merchOrderHandle(o))}`, searchParams);
        return (
          <OrderBoardRow
            key={o.id}
            href={href}
            accent={o.needsPerson ? "orange" : undefined}
            title={o.name || (o.ours ? o.ref : `Printful #${o.id}`)}
            badges={
              <>
                <OrderStatusPill status={o.status} label={merchStatusLabel(o.printfulStatus)} title={`Printful status: ${o.printfulStatus}`} />
                <Badge tone="neutral">Merch</Badge>
                {o.address.state && o.address.state !== "WA" ? <Badge tone="orange">Ships to {o.address.state}</Badge> : null}
              </>
            }
            reference={`${o.ours ? o.ref : "no gm- ref"} · Printful #${o.id}`}
            customer={
              <>
                {[o.address.city, o.address.state].filter(Boolean).join(", ") || "Address on the Details page"}
                {o.email ? ` · ${o.email}` : ""}
              </>
            }
            meta={
              <>
                {o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.paid.total === null ? "total n/a" : formatMinorCurrency(o.paid.total)}
                {o.marginCents !== null ? ` · margin ${formatMinorCurrency(o.marginCents)}` : ""} · placed {shortAgo(o.placedAt, now)}
              </>
            }
            alerts={
              o.confirmable ? (
                <p className="text-xs font-bold text-[var(--admin-orange)]">Paid — waiting for you to confirm it for production.</p>
              ) : o.printfulStatus === "failed" || o.printfulStatus === "onhold" ? (
                <p className="text-xs font-bold text-[var(--admin-danger)]">Printful flagged this order — open Details.</p>
              ) : null
            }
            footer={<OrderStatusFlow status={o.status} />}
          />
        );
      })}
    </OrdersPanel>
  );
}
