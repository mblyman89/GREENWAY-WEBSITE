/**
 * src/components/admin/orders/LeaflyOrdersPanel.tsx
 *
 * SLICE L-6 — LEAFLY ORDERS, ON THE ONLINE ORDERS PAGE, WHERE THE OWNER ASKED.
 * SLICE L-40 — …AND NOW IDENTICAL TO OUR OWN PANEL ABOVE IT.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTIONS, VERBATIM
 * ===========================================================================
 *   L-6:  "I want the Leafly online order related stuff to live on the online
 *          orders page in the back office with our own online order stuff."
 *
 *   L-40: "I want the leafly section to look identical to our section above
 *          it … the search bar and sort and filters should look and behave
 *          identically … our system auto acknowledges leafly orders, so there
 *          is no 15 minute limit we need to obey, the system handles that part
 *          for us. so I want to remove the leafly section moving above our
 *          section."
 *
 * ===========================================================================
 * WHAT CHANGED IN L-40, AND WHY IT IS SAFE
 * ===========================================================================
 * Before L-40 this panel was its own design: workflow buckets ("Accept now",
 * "To build" …), its own Show/Sort/Find controls with their own vocabulary,
 * a "15 minutes" subtitle and an "awaiting acknowledgement" badge — and the
 * page moved it ABOVE our orders whenever one was unaccepted (L-22).
 *
 * Now it renders through `OrdersPanel`, the SAME component our own orders
 * use, so the header, the four cards, the status tabs (Active / New /
 * Acknowledged / Preparing / Ready / Completed / Cancelled / No-show / All),
 * the Search / Placed from / Placed to / Total min / Total max / Sort by
 * controls, Apply, Clear, the pager and the empty state are identical by
 * construction. Each Leafly order is mapped onto our status words by the pure
 * core (`leaflyPanelStatus` in order-panels-core.ts): once accepted, our copy
 * of the order is what the floor works from, so its status IS the status.
 *
 * What was NOT thrown away, because each one protects a real failure:
 *   - the outcome banners after a button press (a success, a warning, an error);
 *   - a read failure is never silent, and unfinished setup says so;
 *   - a till stopped by a Leafly cancellation (board-wide and on the row);
 *   - the "never announced / never printed / never reached the register"
 *     warning on the row (the one failure nobody can see);
 *   - the line saying the current view is hiding an order that needs a
 *     person (the L-28 guarantee, re-expressed in the new controls);
 *   - the acceptance clock on a row — but ONLY when an order has genuinely
 *     not been accepted for several minutes, i.e. auto-accept has visibly
 *     not happened. With auto-accept working that never shows, which is
 *     exactly what the owner described.
 *
 * ===========================================================================
 * WHY IT RENDERS NOTHING WHEN THERE IS NOTHING
 * ===========================================================================
 * Until Leafly order handling is set up and an order arrives, this panel
 * renders nothing at all (`leaflyBoardRendersNothing`, shared with the page
 * so the one-line pointer to the setup tab appears under exactly the same
 * conditions). It never hides a PROBLEM: a read failure or an outcome banner
 * always renders the panel.
 */

import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import {
  assessAckClock,
  leaflyStatusLabel,
  leaflyCancelReasonLabel,
} from "@/lib/leafly/order-ack-core";
// SLICE L-38 — the row→core translation (and its L-33 confirm-push rule)
// lives in ./leafly-workflow-row so the details page shares the same one.
import { toWorkflowRow, type WorkflowRow } from "./leafly-workflow-row";
import { leaflyDisplayLabel } from "@/lib/leafly/bridge-core";
import type { LeaflyBoardState } from "@/lib/leafly/order-board-server";
// SLICE L-14 — the classification of an interrupt is the pure core’s job,
// not this file’s. Both helpers are asserted in CI without a database.
import {
  summariseInterrupts,
  type InterruptRecord,
} from "@/lib/leafly/register-claim-core";
import type { BoardInterrupts } from "@/lib/leafly/register-claim-server";
import { leaflyBoardRendersNothing } from "@/lib/admin/orders-tabs-core";
// SLICE L-40 — the ONE set of rules both panels use.
import {
  buildLeaflyPanelView,
  hiddenNeedsPersonWarning,
  leaflyLoadCapNotice,
  leaflyPanelSubtitle,
  parseOrdersPanelQuery,
  toLeaflyPanelRows,
  type LeaflyPanelRow,
  type OrdersPanelQuery,
} from "@/lib/orders/order-panels-core";
import { OrdersPanel } from "./OrdersPanel";
import { OrderBoardRow } from "./OrderBoardRow";
import { OrderOriginBadge } from "./OrderOriginBadge";
import { OrderStatusFlow } from "./OrderStatusFlow";
import { OrderStatusPill } from "./OrderStatusPill";
import { LeaflyOutcomeBanners, URGENCY_STYLES, URGENCY_ICONS } from "./LeaflyOrderWorkflow";
import { leaflyDetailPath } from "@/lib/orders/order-board-split-core";
import { withBackParam, type SearchParamsShape } from "@/lib/admin/back-link-core";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { REGISTER_PICKED_UP_LABEL } from "@/lib/pos/pickup-progress-core";
import type { OrderRow } from "@/lib/orders/types";

type PanelRow = LeaflyPanelRow<WorkflowRow, OrderRow>;

export function LeaflyOrdersPanel({
  board,
  /**
   * SLICE L-14 — register cancellation interrupts, keyed by local order id.
   * Optional so an un-updated caller renders rather than crashing the page.
   */
  interrupts,
  /** Injected so the panel is deterministic and the clock is testable. */
  now,
  /** Outcome of the last action, lifted from the URL by the page. */
  message,
  /** SLICE L-35 — a success that still needs a human's attention. */
  warning,
  error,
  errorCode,
  /**
   * SLICE L-38 — our copies of the linked orders, by local id. Gives each row
   * the same customer / items / total line a Greenway row has, and makes the
   * search box find a name, a phone or an order number.
   */
  linkedOrders,
  /** The page's query: this panel's view (l-prefixed) and the other panel's. */
  searchParams,
  /**
   * SLICE L-40 — this panel's validated view. Optional: when absent it is read
   * from `searchParams` through the same grammar, so a missing prop can never
   * mean "show nothing".
   */
  query,
  /** Is LEAFLY_AUTO_ACKNOWLEDGE on? Drives one honest subtitle. Default: on. */
  autoAcknowledge = true,
  /** The loader's row cap, so a capped list says so. */
  loadCap,
  /** Our copies collected at the register (their status stays "cancelled"). */
  pickedUpAtRegister,
}: {
  board: LeaflyBoardState;
  interrupts?: BoardInterrupts;
  now: Date;
  message?: string | null;
  warning?: string | null;
  error?: string | null;
  errorCode?: string | null;
  linkedOrders?: ReadonlyMap<string, OrderRow>;
  searchParams?: SearchParamsShape;
  query?: OrdersPanelQuery;
  autoAcknowledge?: boolean;
  loadCap?: number;
  pickedUpAtRegister?: ReadonlySet<string>;
}) {
  const hasOrders = board.orders.length > 0;
  // SLICE L-14 — one tally for the whole board, computed ONCE here rather
  // than per row, so the banner and the rows cannot disagree about how many
  // tills are stopped. The counting itself is the pure core’s.
  const allInterrupts: InterruptRecord[] = interrupts
    ? Array.from(interrupts.byOrderId.values()).flat()
    : [];
  const interruptTally = summariseInterrupts(allInterrupts);
  const hasProblem = board.problem.trim().length > 0;
  const hasOutcome = Boolean(message || warning || error);

  // Nothing set up, nothing received, nothing wrong, nothing to report →
  // render nothing (see the file header, and SLICE M-2 / L-21 in
  // orders-tabs-core for why this predicate is shared with the page).
  if (
    leaflyBoardRendersNothing({
      hasOrders,
      hasProblem,
      hasOutcome,
      orderIntegrationKeyPresent: board.orderIntegrationKeyPresent,
    })
  ) {
    return null;
  }

  // ── SLICE L-40. The operator's chosen view, computed by the pure core ────
  // The same tabs, search, dates, totals, sort and paging as our panel,
  // applied in memory to the Leafly orders the board loaded.
  const q = query ?? parseOrdersPanelQuery(searchParams, "leafly");
  const rows = toLeaflyPanelRows<WorkflowRow, OrderRow>(board.orders.map(toWorkflowRow), linkedOrders);
  const view = buildLeaflyPanelView(rows, q);
  // SLICE L-28's guarantee, kept: a view may never SILENTLY hide an order a
  // person has to act on.
  const hiddenWarning = hiddenNeedsPersonWarning(view.hiddenNeedsPerson);
  const capNotice = leaflyLoadCapNotice(board.orders.length, loadCap);

  const notices = (
    <>
      {/* ── The outcome of the last button press ─────────────────────────
          Shown before anything else. Somebody just pressed a button and is
          waiting to find out what happened. SLICE L-38: one banner
          component, shared with the details pages. */}
      <LeaflyOutcomeBanners message={message} warning={warning} error={error} errorCode={errorCode} />

      {/* ── A read failure is never silent ─────────────────────────────── */}
      {hasProblem ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          {board.problem}
        </div>
      ) : null}

      {/* ── Setup not finished ─────────────────────────────────────────── */}
      {!board.orderIntegrationKeyPresent ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          <p className="font-bold">Leafly order handling isn’t live yet.</p>
          <p className="mt-1">
            No Leafly store key is saved (Leafly uses your Menu integration key for orders
            too), so nothing can be sent back to Leafly. Orders they send us will still be
            recorded here.
          </p>
          <p className="mt-2">
            <Link href="/admin/integrations/leafly" className="font-bold underline underline-offset-2">
              Finish Leafly setup →
            </Link>
          </p>
        </div>
      ) : null}

      {/* ── SLICE L-14: tills stopped by a Leafly cancellation ─────────────
          A register is STOPPED right now and a cashier is waiting to be told
          what to do with product that is already in a bag. The count is the
          pure core's true count, not the length of a clipped list. */}
      {interruptTally.openCount > 0 ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          <p className="font-black">
            🚨 {interruptTally.openCount === 1
              ? "A register is waiting on a cancelled order."
              : `${interruptTally.openCount} registers are waiting on cancelled orders.`}
          </p>
          <p className="mt-1 font-normal">
            Leafly cancelled {interruptTally.openCount === 1 ? "an order" : "orders"} that
            {" "}{interruptTally.openCount === 1 ? "was" : "were"} already being built. Until
            somebody at the till says what happened to the product, it is neither back in
            stock nor sold — so the count on the shelf is wrong either way.
          </p>
        </div>
      ) : null}

      {/* A read failure here is stated, never silent: an empty list and an
          unreadable table look identical, and that is how a stopped till goes
          unnoticed for a shift. */}
      {hasOrders && interrupts?.degraded ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
          Register cancellation alerts aren’t available yet — migration 0229 hasn’t been
          applied. Orders below are accurate; only the cancellation alerts are missing.
        </div>
      ) : null}
      {hasOrders && interrupts?.problem ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
          {interrupts.problem}
        </div>
      ) : null}
    </>
  );

  const beforeList =
    hiddenWarning || capNotice ? (
      <>
        {/* ── THE LINE THAT MAKES THE FILTER SAFE (L-28, kept) ──────────── */}
        {hiddenWarning ? (
          <div
            role="status"
            className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-xs font-semibold text-[var(--admin-danger)]"
          >
            {hiddenWarning}
          </div>
        ) : null}
        {capNotice ? <p className="mt-2 text-xs text-[var(--admin-text-faint)]">{capNotice}</p> : null}
      </>
    ) : null;

  return (
    <OrdersPanel
      panel="leafly"
      title="Leafly orders"
      subtitle={
        board.orderIntegrationKeyPresent
          ? leaflyPanelSubtitle(autoAcknowledge)
          : "Leafly order handling isn’t finished being set up yet."
      }
      icon="🌿"
      counts={view.counts}
      query={q}
      searchParams={searchParams}
      window={view.window}
      total={view.total}
      notices={notices}
      beforeList={beforeList}
      emptyDescription={
        hasOrders
          ? "No Leafly orders match these filters. Choose “All” or press Clear to see the rest."
          : "When a Leafly shopper places an order it will show up here automatically — newest first."
      }
    >
      {view.rows.map((row) => {
        const order = row.order;
        return (
          <LeaflyOrderRow
            key={order.id}
            row={row}
            now={now}
            searchParams={searchParams}
            // L-14: an order with no local id gets UNDEFINED, never a lookup on
            // a blank key (a Map keyed by "" would hand every such order the
            // same rows).
            interrupts={
              order.local_order_id
                ? interrupts?.byOrderId.get(order.local_order_id)
                : undefined
            }
            pickedUpAtRegister={
              order.local_order_id && pickedUpAtRegister
                ? pickedUpAtRegister.has(order.local_order_id)
                : false
            }
          />
        );
      })}
    </OrdersPanel>
  );
}

/**
 * One Leafly order, as a ROW — SLICE L-38, restyled in L-40.
 *
 * Rendered through OrderBoardRow — the same component our own rows use — with
 * the same status pill, so the two lists look identical: title and badges on
 * the left, customer / items / total / placed-ago under it, the progress strip
 * at the bottom, and "Details" on the far right.
 *
 * The step buttons are on the details page (LeaflyOrderWorkflow), as the owner
 * asked. What stays on the row is only what must be seen without opening
 * anything, because each one is costing time right now.
 */
function LeaflyOrderRow({
  row,
  now,
  searchParams,
  pickedUpAtRegister,
  /** SLICE L-14 — this order’s interrupts, newest first. */
  interrupts,
}: {
  row: PanelRow;
  now: Date;
  searchParams?: SearchParamsShape;
  pickedUpAtRegister: boolean;
  interrupts?: InterruptRecord[];
}) {
  const order = row.order;
  const local = row.local;
  const placement = row.placement;
  // ── Everything below is READ from the pure cores, never decided here.
  const clock = assessAckClock({
    acknowledgedAt: order.acknowledged_at,
    acknowledgeBy: order.acknowledge_by,
    now,
  });
  // With auto-accept working an order is accepted within seconds, so the
  // clock is only worth a line once it NEEDS attention (a few minutes
  // unaccepted, a passed deadline, or no deadline at all) — the moment
  // automatic acceptance has visibly not happened.
  const showClock = clock.needsAttention;
  const leaflyWords = leaflyStatusLabel(order.leafly_status);
  const cancelLabel = leaflyCancelReasonLabel(order.cancelation_reason_code);
  const fullId = (order.leafly_order_id ?? "").trim();
  const receiptLabel = leaflyDisplayLabel(fullId);
  const detailPath = leaflyDetailPath({
    leaflyOrderId: fullId,
    localOrderId: order.local_order_id,
  });
  const href = detailPath ? withBackParam(detailPath, searchParams) : null;
  // The core's own tally — the row never classifies an interrupt itself.
  const blockingCount = summariseInterrupts(interrupts ?? []).openCount;

  const customerName = local
    ? [local.customer_first_name, local.customer_last_name].filter((s) => (s ?? "").trim()).join(" ")
    : "";

  return (
    <OrderBoardRow
      href={href}
      accent={showClock || placement.pipelineWarning || blockingCount > 0 ? "orange" : undefined}
      title={
        local ? (
          resolveOrderDisplay(local.display_name, local.order_number)
        ) : (
          // The same LF- label printed on the arrival ticket and used as our
          // copy's name once accepted, so the handle never changes.
          <span title={fullId || undefined}>{receiptLabel}</span>
        )
      }
      badges={
        <>
          <OrderStatusPill
            status={row.status}
            styleAs={pickedUpAtRegister ? "completed" : undefined}
            label={pickedUpAtRegister ? `${REGISTER_PICKED_UP_LABEL} (register)` : undefined}
            title={
              pickedUpAtRegister
                ? "Collected at the register — the register sale holds the payment and the books."
                : undefined
            }
          />
          <OrderOriginBadge origin="leafly" />
          {order.marketplace === "uberEats" ? <Badge tone="gold">Uber Eats</Badge> : null}
          {order.medical_status === "medical" ? <Badge tone="green">Medical</Badge> : null}
          {order.fulfillment_mechanism && order.fulfillment_mechanism !== "pickup" ? (
            <Badge tone="orange">{order.fulfillment_mechanism}</Badge>
          ) : null}
        </>
      }
      reference={
        <span title={fullId || undefined}>
          {local ? `#${local.order_number} · ` : ""}
          {/* What Leafly itself says, so a mismatch between their screen and
              ours is visible here. An unrecognised value is shown raw rather
              than given an invented friendly name. */}
          Leafly: {leaflyWords ?? `unrecognised status “${order.leafly_status ?? "none"}”`}
        </span>
      }
      customer={
        local ? (
          <>
            {customerName || "Customer"}
            {local.customer_phone ? ` · ${local.customer_phone}` : ""}
          </>
        ) : row.status === "new" ? (
          // No copy yet = not accepted yet. Say so rather than leave a blank.
          "Not accepted yet — open Details to read the order and accept it."
        ) : (
          "Customer details are on the Details page."
        )
      }
      meta={
        local ? (
          <>
            {local.item_count} item{local.item_count === 1 ? "" : "s"} ·{" "}
            {formatMinorCurrency(local.total_minor_units)} · placed {shortAgo(local.placed_at, now)}
          </>
        ) : (
          <>placed {shortAgo(order.first_seen_at, now)}</>
        )
      }
      alerts={
        showClock || placement.pipelineWarning || blockingCount > 0 || cancelLabel ? (
          <>
            {showClock ? (
              <div
                className={`flex items-start gap-2 rounded-[var(--admin-radius-lg)] border px-3 py-1.5 text-xs font-bold ${URGENCY_STYLES[clock.urgency]}`}
              >
                <span aria-hidden>{URGENCY_ICONS[clock.urgency]}</span>
                <span>Not accepted automatically. {clock.label}</span>
              </div>
            ) : null}
            {/* The pipeline warning: the one failure nobody can see. */}
            {placement.pipelineWarning ? (
              <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-3 py-1.5 text-xs font-bold text-[var(--admin-danger)]">
                ⚠️ {placement.pipelineWarning}
              </p>
            ) : null}
            {blockingCount > 0 ? (
              <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-3 py-1.5 text-xs font-bold text-[var(--admin-danger)]">
                🛑 A register is waiting on this cancelled order — open Details.
              </p>
            ) : null}
            {cancelLabel ? <p className="text-xs font-bold text-[var(--admin-danger)]">{cancelLabel}</p> : null}
          </>
        ) : null
      }
      footer={<OrderStatusFlow status={row.status} />}
    />
  );
}

/** "5m ago" — the same coarse clock our rows use. */
function shortAgo(iso: string | null | undefined, now: Date): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
