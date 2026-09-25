/**
 * src/components/admin/orders/LeaflyOrdersPanel.tsx
 *
 * SLICE L-6 — LEAFLY ORDERS, ON THE ONLINE ORDERS PAGE, WHERE THE OWNER ASKED.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION, VERBATIM
 * ===========================================================================
 *   "I want the Leafly online order related stuff to live on the online orders
 *    page in the back office with our own online order stuff."
 *
 * So it does. This panel sits on /admin/orders above Greenway's own order
 * cards. It is NOT a separate page and NOT a separate tab, because a separate
 * tab has the same defect as a separate page: a Leafly order carries a
 * fifteen-minute deadline that auto-cancels a real customer's order, and a
 * deadline behind a tab is a deadline nobody sees. This is also what the
 * mature POS vendors do — Cova's own words: "Cova POS is your central order
 * dashboard, so there's no need to juggle multiple channels to track orders."
 *
 * Menu/catalog PUSHING stays on the Integrations page, which is where the
 * credentials live and where the mature push UI already exists. That split
 * (orders → operations dashboard, catalog → integrations settings) is the same
 * one Dutchie ships, where Leafly menu syndication is configured under
 * Settings > Integrations.
 *
 * ===========================================================================
 * WHAT THIS COMPONENT IS ALLOWED TO DECIDE: NOTHING
 * ===========================================================================
 * Which buttons appear, whether a deadline is urgent, what a status is called
 * in English — all of it is computed by `order-ack-core.ts` and asserted in CI
 * without a database or a Leafly account. This file maps those values onto the
 * shop's existing components and design tokens. If a Leafly rule appears in
 * this file as an `if`, it is in the wrong place.
 *
 * ===========================================================================
 * SLICE L-10 — WHY THIS IS NOW A WORKFLOW BOARD AND NOT A LIST
 * ===========================================================================
 * The owner asked, verbatim:
 *
 *   "is it possible to have a leafly dashboard that allows us to see the
 *    online orders and interact with them in our own back office platform
 *    rather than needing to go to leafly to manage the orders? ... if possible
 *    to do this, I think it would be worth adding that to the online orders
 *    dashboard in an organized and easy to work with well managed page that
 *    flows nicely for easy work flow."
 *
 * It is possible, and Leafly's own Order API spec says so outright: once a
 * software system is integrated, "The Leafly Order Dashboard will become
 * read-only, as your software system will become the source of truth." This
 * screen IS the source of truth. Nobody should need to open Leafly Biz.
 *
 * That raises the bar for this component. A flat list sorted by deadline was
 * adequate when it was a read-only mirror; it is not adequate as the primary
 * console. On a busy Friday a flat list interleaves an order that Leafly will
 * auto-cancel in four minutes with eleven that were picked up yesterday, and
 * asks a budtender to do the triage that the software should have done.
 *
 * So the orders are grouped into BUCKETS, one per physical activity, in the
 * sequence a budtender performs them — accept, rescue, build, hand over — and
 * each bucket states the single next action in the imperative. The grouping
 * and the wording are computed by `groupLeaflyWorkflow` in bridge-core.ts and
 * asserted in CI without a database or a Leafly account; this file only
 * decides what they look like. Empty buckets are omitted entirely, so a quiet
 * shop still sees a short page.
 *
 * ===========================================================================
 * WHY IT RENDERS NOTHING WHEN THERE IS NOTHING
 * ===========================================================================
 * Greenway is not live on Leafly orders yet. Until an order arrives, this panel
 * collapses to a single quiet line — or to nothing at all if the integration
 * has never been set up. The orders page is the busiest screen in the shop and
 * it must not grow a permanent empty section for a feature that is not in use.
 * The one thing it will NOT do is hide a PROBLEM: a read failure or a missing
 * integration key is always stated, because a silent empty list and a broken
 * integration look identical, and that is how a week goes by with orders being
 * auto-cancelled.
 */

import Link from "next/link";
import { Card, CardHeader, Badge, type BadgeTone } from "@/components/admin/ui";
import {
  assessAckClock,
  leaflyStatusLabel,
  leaflyCancelReasonLabel,
  leaflyStatusTone,
  LEAFLY_ACK_WINDOW_MINUTES,
} from "@/lib/leafly/order-ack-core";
// SLICE L-33 — the auto-acknowledge vocabulary and the one translation rule
// this component needs. All of it is pure and self-tested; none of it is
// decided here.
// SLICE L-38 — the row→core translation (and its L-33 confirm-push rule)
// moved to ./leafly-workflow-row so the details page shares the same one.
import { toWorkflowRow, type WorkflowRow } from "./leafly-workflow-row";
import {
  groupLeaflyWorkflow,
  // SLICE L-28 — the bucket is computed once in the panel and shared between
  // the filter and the headings, so the two cannot disagree.
  placeLeaflyOrder,
  type LeaflyWorkflowPlacement,
  type LeaflyWorkflowBucket,
} from "@/lib/leafly/bridge-core";
import type { LeaflyBoardState } from "@/lib/leafly/order-board-server";
// SLICE L-28 — the filter/sort/search decisions are made in a pure core so CI
// can prove them without a database. See that file's header for the invariant
// that a filter may never silently hide an order that needs a human.
import {
  BOARD_FILTERS,
  BOARD_SORTS,
  boardEmptyMessage,
  boardFilterLabel,
  boardHiddenWarning,
  boardSortLabel,
  buildBoardView,
  type BoardFilter,
  type BoardSort,
} from "@/lib/leafly/board-view-core";
// SLICE L-14 — the classification of an interrupt is the pure core’s job,
// not this file’s. Both helpers are asserted in CI without a database.
import {
  summariseInterrupts,
  type InterruptRecord,
} from "@/lib/leafly/register-claim-core";
import type { BoardInterrupts } from "@/lib/leafly/register-claim-server";
// SLICE L-21: the announcer now lives on the setup tab. The panel still asks
// the same predicate whether to render at all.
import { leaflyBoardRendersNothing } from "@/lib/admin/orders-tabs-core";
// SLICE L-38 — THE DASHBOARD SHOWS ROWS; THE STEPS LIVE ON THE DETAILS PAGE.
//
// The owner: "restyle the Leafly panel to look identical to the online orders
// rows ... the details button should open up the details page with the
// options to move the order along its process to completion." So each order
// is now an OrderBoardRow (the SAME component the website rows use), and the
// full workflow — step buttons (LeaflyOrderActions), which-step strip
// (LeaflyLifecycleStrip), the order itself (LeaflyOrderDetailPanel), the
// register cancellation record — moved to LeaflyOrderWorkflow, rendered by
// the details pages. The row keeps only the alarms that must be seen WITHOUT
// opening anything: the countdown, the silent-arrival warning, and a stopped
// till.
import { OrderBoardRow } from "./OrderBoardRow";
import { OrderOriginBadge } from "./OrderOriginBadge";
import { OrderStatusFlow } from "./OrderStatusFlow";
import { LeaflyOutcomeBanners, TONE_BADGE, URGENCY_STYLES, URGENCY_ICONS } from "./LeaflyOrderWorkflow";
import { leaflyDetailPath, leaflySearchTerms } from "@/lib/orders/order-board-split-core";
import { withBackParam, type SearchParamsShape } from "@/lib/admin/back-link-core";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { OrderRow } from "@/lib/orders/types";

/**
 * How each workflow bucket looks.
 *
 * Two buckets are styled as alarms and three are not, and that ratio is the
 * point: if everything shouts, nothing does. `accept_now` shouts because a
 * countdown is running against a real customer's order. `needs_attention`
 * shouts because something already failed silently. The rest are ordinary
 * work and are styled as ordinary work.
 */
const BUCKET_STYLES: Record<
  LeaflyWorkflowBucket,
  { icon: string; badge: BadgeTone; blurb: string }
> = {
  accept_now: {
    icon: "🚨",
    badge: "danger",
    blurb:
      "Leafly cancels these automatically if nobody accepts them in time. Work this list first.",
  },
  needs_attention: {
    icon: "⚠️",
    badge: "danger",
    blurb:
      "Something went wrong quietly on these. They will not fix themselves — read each one.",
  },
  to_build: {
    icon: "📦",
    badge: "orange",
    blurb: "Accepted and waiting to be picked and bagged.",
  },
  awaiting_pickup: {
    icon: "🛍️",
    badge: "green",
    blurb: "Bagged and ready. Hand these over when the customer walks in.",
  },
  closed: {
    icon: "✅",
    badge: "neutral",
    blurb: "Picked up, cancelled or expired. Kept for reference only.",
  },
};

export function LeaflyOrdersPanel({
  board,
  pendingAckCount,
  /**
   * SLICE L-14 — register cancellation interrupts, keyed by local order id.
   *
   * Optional so that any caller that has not been updated renders exactly as
   * it did before this slice, rather than crashing a page the shop runs its
   * own orders on.
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
   * SLICE L-28 — the view the operator chose, lifted from the URL by the page.
   *
   * All three are optional and default to the core's defaults, so any caller
   * that has not been updated renders the board exactly as this slice
   * intends: open orders only, most urgent first. A missing prop must never
   * mean "show nothing".
   */
  filter,
  sort,
  search,
  /**
   * SLICE L-38 — the Greenway copies of the linked orders, by local id. Gives
   * each row the same customer / items / total line a website row has, and
   * makes the search box find "Jane" or "1042". Optional: without it a row
   * shows Leafly's own fields and the search matches ids only, as before.
   */
  linkedOrders,
  /** SLICE L-38 — the page's query, carried to the details page as `back`. */
  searchParams,
}: {
  board: LeaflyBoardState;
  pendingAckCount: number | null;
  interrupts?: BoardInterrupts;
  now: Date;
  message?: string | null;
  warning?: string | null;
  error?: string | null;
  errorCode?: string | null;
  filter?: BoardFilter;
  sort?: BoardSort;
  search?: string | null;
  linkedOrders?: ReadonlyMap<string, OrderRow>;
  searchParams?: SearchParamsShape;
}) {
  const hasOrders = board.orders.length > 0;
  // SLICE L-14 — one tally for the whole board, computed ONCE here rather
  // than per card, so the banner and the cards cannot disagree about how many
  // tills are stopped. The counting itself is the pure core’s.
  const allInterrupts: InterruptRecord[] = interrupts
    ? Array.from(interrupts.byOrderId.values()).flat()
    : [];
  const interruptTally = summariseInterrupts(allInterrupts);
  const hasProblem = board.problem.trim().length > 0;
  const hasOutcome = Boolean(message || warning || error);

  // Nothing set up, nothing received, nothing wrong, nothing to report → render
  // nothing. See the file header: the orders page does not grow a permanent
  // empty section for a feature that is not in use.
  //
  // ── SLICE M-2: WHY THIS RULE NOW HAS A COMPANION, AND WHY IT SURVIVED ──
  //
  // The owner placed a real Leafly order and reported four silences at once:
  // no row, no receipt, no sound, and "there is nothing in the online orders
  // dashboard page that has a Leafly orders section". That last symptom was
  // THIS LINE, behaving exactly as designed — proven by executing this very
  // predicate against his state (no order integration key saved, no orders
  // yet, no problem, no outcome → null).
  //
  // The rule is not wrong; it is incomplete. "Do not grow a permanent empty
  // section for an unused feature" is correct, but it is at its most silent
  // precisely when somebody is HALFWAY through setup and needs to be told what
  // is missing. A screen that hides during setup cannot be debugged, and a bug
  // nobody can see is a bug nobody can report.
  //
  // The fix deliberately does NOT weaken this condition. Loosening it would
  // put a permanently empty "Leafly orders" card on the orders page of a shop
  // that does not use Leafly — trading one defect for the one this rule was
  // written to prevent. Instead, `LeaflyOrderSetupPanel` owns the empty state:
  // it renders the reason, the remaining steps and the six webhook addresses,
  // and `assessOrderReadiness().showPanel` decides when (any setup progress at
  // all, or any order ever received). So this list still renders nothing when
  // there is nothing to list, and the PAGE is no longer blank.
  //
  // SLICE L-21 — the condition itself now lives in orders-tabs-core, because
  // the orders PAGE has to ask the same question. The setup panel that
  // explains this blank space moved to the setup tab, so the orders tab shows
  // a one-line pointer in its place — and that pointer must appear under
  // exactly these conditions, never approximately these conditions. Two
  // copies of this line would drift; one copy cannot.
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

  // ── SLICE L-28. The operator's chosen view, computed by the pure core ────
  //
  // `groupLeaflyWorkflow` needs the bucket for each row, and so does the
  // filter — so the placement is computed ONCE here and handed to both,
  // rather than each deciding independently. Two independent placements is
  // how a filter and a heading end up disagreeing about which pile an order
  // is in, which is indistinguishable from the order having vanished.
  const workflowRows = board.orders.map(toWorkflowRow);
  const view = buildBoardView(
    workflowRows.map((r) => ({
      ...r,
      bucket: placeLeaflyOrder(r).bucket,
      acknowledgeBy: r.acknowledge_by,
      updatedAt: r.updated_at,
      // SLICE L-38 — this panel is now the ONLY place on the dashboard a
      // Leafly order can be searched for, so it matches what staff quote.
      searchTerms: leaflySearchTerms(
        r.local_order_id ? linkedOrders?.get(r.local_order_id) : null,
      ),
    })),
    { filter, sort, search },
  );
  const hiddenWarning = boardHiddenWarning(view);
  const emptyMessage = boardEmptyMessage(view);

  return (
    <div className="mt-4">
      <Card padding="sm" accent="green" className="sm:p-5">
        <CardHeader
          title="Leafly orders"
          subtitle={
            board.orderIntegrationKeyPresent
              ? `Orders that arrived through Leafly. Leafly gives you ${LEAFLY_ACK_WINDOW_MINUTES} minutes to acknowledge each one, or they cancel it automatically.`
              : "Leafly order handling isn’t finished being set up yet."
          }
          icon="🌿"
          action={
            pendingAckCount !== null && pendingAckCount > 0 ? (
              <Badge tone="danger">
                {pendingAckCount} awaiting acknowledgement
              </Badge>
            ) : null
          }
        />

        {/* ── The outcome of the last button press ─────────────────────────
            Shown before anything else. Somebody just pressed a button and is
            waiting to find out what happened; making them hunt for it in a
            list is how a failed acknowledgement gets missed. */}
        {/* SLICE L-38 — one banner component, shared with the details pages,
            so an outcome looks the same wherever the button was pressed. */}
        <LeaflyOutcomeBanners
          message={message}
          warning={warning}
          error={error}
          errorCode={errorCode}
        />

        {/* ── A read failure is never silent ──────────────────────────────── */}
        {hasProblem ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            {board.problem}
          </div>
        ) : null}

        {/* ── Setup not finished ──────────────────────────────────────────── */}
        {!board.orderIntegrationKeyPresent ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            <p className="font-bold">Leafly order handling isn’t live yet.</p>
            <p className="mt-1">
              Your Leafly order integration key hasn’t been entered, so nothing can be
              sent back to Leafly. Orders they send us will still be recorded here.
            </p>
            <p className="mt-2">
              <Link
                href="/admin/integrations/leafly"
                className="font-bold underline underline-offset-2"
              >
                Finish Leafly setup →
              </Link>
            </p>
          </div>
        ) : null}

        {/* ── The orders ──────────────────────────────────────────────────── */}
        {!hasOrders ? (
          board.orderIntegrationKeyPresent && !hasProblem ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              No Leafly orders yet. When a Leafly shopper places an order it will appear
              here within seconds, with a countdown showing how long you have to
              acknowledge it.
            </p>
          ) : null
        ) : (
          <div className="mt-4 space-y-5">
            {/* ── SLICE L-14: tills stopped by a Leafly cancellation ─────────
                Above the buckets because it outranks them. A bucket says what
                to do next; this says that a register is STOPPED right now and
                a cashier is standing there waiting to be told what to do with
                product that is already in a bag.

                The count comes from the pure core and is a true count, not the
                length of a clipped list. */}
            {interruptTally.openCount > 0 ? (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
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

            {/* A read failure here is stated, never silent: an empty list and
                an unreadable table look identical on screen, and that is how a
                stopped till goes unnoticed for a shift. */}
            {interrupts?.degraded ? (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
                Register cancellation alerts aren’t available yet — migration 0229 hasn’t been
                applied. Orders below are accurate; only the cancellation alerts are missing.
              </div>
            ) : null}
            {interrupts?.problem ? (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
                {interrupts.problem}
              </div>
            ) : null}
            {/* ── The workflow buckets ──────────────────────────────────
                Grouped by the pure core and rendered in the order a budtender
                actually works: accept the ones on a countdown, rescue the ones
                that broke silently, build, then hand over.

                Empty buckets are dropped rather than rendered as empty
                headings. Five "0 orders" headings on a quiet Tuesday is noise,
                and noise is what stops people reading the one heading that
                matters. */}
            {/* ── SLICE L-28: the filter, sort and search controls ────────
                A plain GET <form>, not a client component. The board is a
                server component that already re-renders from the URL on
                every acknowledge, so the view belongs in the URL too: it
                survives the redirect after a button press, it survives a
                refresh, and it can be bookmarked or sent to another member
                of staff. Making this interactive would have meant shipping
                the whole board to the browser to change one dropdown.

                `submit`-on-change is handled without JavaScript by the
                submit button, which remains visible and usable; the form
                works with scripting disabled, which matters on a shop
                tablet with an aggressive battery saver. */}
            <form
              method="get"
              className="flex flex-wrap items-end gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-line)] bg-[var(--admin-surface-2)] px-3 py-3"
            >
              {/* The anchor keeps the browser on the Leafly panel after the
                  form submits, instead of jumping to the top of a long page. */}
              <input type="hidden" name="tab" value="orders" />
              <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-faint)]">
                Show
                <select
                  name="lfilter"
                  defaultValue={view.filter}
                  className="rounded-[var(--admin-radius-md)] border border-[var(--admin-line)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                >
                  {BOARD_FILTERS.map((f) => (
                    <option key={f} value={f}>
                      {boardFilterLabel(f)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-faint)]">
                Sort
                <select
                  name="lsort"
                  defaultValue={view.sort}
                  className="rounded-[var(--admin-radius-md)] border border-[var(--admin-line)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                >
                  {BOARD_SORTS.map((s) => (
                    <option key={s} value={s}>
                      {boardSortLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-faint)]">
                Find an order
                <input
                  type="search"
                  name="lq"
                  defaultValue={view.search ?? ""}
                  placeholder="Order #, name or phone"
                  className="rounded-[var(--admin-radius-md)] border border-[var(--admin-line)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                />
              </label>
              <button
                type="submit"
                className="rounded-[var(--admin-radius-md)] border border-[var(--admin-line)] bg-[var(--admin-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--admin-text)] hover:bg-[var(--admin-surface-3)]"
              >
                Apply
              </button>
              {/* Escape hatch back to the default view, so an operator who
                  has filtered himself into a corner is one click from the
                  board he started with. */}
              <Link
                href="/admin/orders?tab=orders"
                className="px-2 py-1.5 text-xs font-semibold text-[var(--admin-text-faint)] underline hover:text-[var(--admin-text)]"
              >
                Reset
              </Link>
            </form>

            {/* ── SLICE L-28: THE LINE THAT MAKES THE FILTER SAFE ─────────
                A view that can hide an order needing acknowledgement is the
                bug this slice fixed, rebuilt in the UI. Leafly auto-cancels
                after fifteen minutes, so the operator is told — every time,
                unmissably — when his chosen view is concealing live work.
                The count comes from the pure core and is asserted in CI. */}
            {hiddenWarning ? (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-xs font-semibold text-[var(--admin-danger)]">
                {hiddenWarning}
              </div>
            ) : null}

            {/* An empty view explains WHICH emptiness it is: nothing has
                arrived, nothing matches the search, or nothing is open. Three
                causes, three remedies, never one vague "no orders". */}
            {emptyMessage ? (
              <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-line)] bg-[var(--admin-surface-2)] px-4 py-3 text-sm text-[var(--admin-text-faint)]">
                {emptyMessage}
              </p>
            ) : null}

            {groupLeaflyWorkflow(view.rows)
              .filter((group) => group.orders.length > 0)
              .map((group) => {
                const style = BUCKET_STYLES[group.bucket];
                return (
                  <section key={group.bucket} aria-label={group.heading}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-hidden>{style.icon}</span>
                      <h3 className="text-sm font-black uppercase tracking-wide text-[var(--admin-text)]">
                        {group.heading}
                      </h3>
                      {/* A badge rather than prose, so the eye can find "how
                          many" without reading a sentence. */}
                      <Badge tone={style.badge}>{group.orders.length}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
                      {style.blurb}
                    </p>

                    <div className="mt-3 grid gap-3">
                      {group.orders.map(({ order, placement }) => (
                        <LeaflyOrderRow
                          key={order.id}
                          order={order}
                          placement={placement}
                          now={now}
                          local={order.local_order_id ? linkedOrders?.get(order.local_order_id) : undefined}
                          searchParams={searchParams}
                          interrupts={
                            order.local_order_id
                              ? interrupts?.byOrderId.get(order.local_order_id)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * One Leafly order, as a ROW — SLICE L-38.
 *
 * Rendered through OrderBoardRow, the same component the website orders use,
 * so the two lists look identical by construction: title and badges on the
 * left, customer / items / total / placed-ago under it, the progress strip
 * at the bottom, and "Details" on the far right.
 *
 * What is NOT here any more, and where it went: the step buttons, the
 * which-step strip, the order contents and the register cancellation record
 * are on the details page (LeaflyOrderWorkflow). The owner asked for the
 * steps to be pressed there and only there.
 *
 * What STAYS on the row, and why: three alarms that must be seen without
 * opening anything, because each one is costing time right now —
 *   1. the acknowledgement countdown (Leafly auto-cancels at fifteen minutes);
 *   2. the silent-arrival warning (the speaker never rang, nobody knows);
 *   3. a till stopped by a Leafly cancellation.
 * Each is one line; the full explanation is on the details page.
 */
function LeaflyOrderRow({
  order,
  placement,
  now,
  local,
  searchParams,
  /** SLICE L-14 — this order’s interrupts, newest first. */
  interrupts,
}: {
  order: WorkflowRow;
  placement: LeaflyWorkflowPlacement;
  now: Date;
  local?: OrderRow;
  searchParams?: SearchParamsShape;
  interrupts?: InterruptRecord[];
}) {
  // ── Everything below is READ from the pure cores, never decided here.
  const clock = assessAckClock({
    acknowledgedAt: order.acknowledged_at,
    acknowledgeBy: order.acknowledge_by,
    now,
  });
  const statusLabel = leaflyStatusLabel(order.leafly_status);
  const tone = leaflyStatusTone(order.leafly_status);
  const cancelLabel = leaflyCancelReasonLabel(order.cancelation_reason_code);
  // Leafly's order id is a uuid. The last six characters are the handle, so
  // two orders are distinguishable at a glance; the full value is in the
  // title attribute for copying.
  const fullId = (order.leafly_order_id ?? "").trim();
  const handle = fullId ? fullId.slice(-6).toUpperCase() : "unknown";
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
      accent={clock.urgency === "urgent" || clock.urgency === "expired" || clock.urgency === "unknown" ? "orange" : undefined}
      title={
        local ? (
          resolveOrderDisplay(local.display_name, local.order_number)
        ) : (
          <span className="font-mono" title={fullId || undefined}>
            Leafly ·{handle}
          </span>
        )
      }
      badges={
        <>
          {/* An unrecognised status shows the raw value with a plain warning
              rather than an invented friendly name. */}
          <Badge tone={TONE_BADGE[tone]}>
            {statusLabel ?? `Unrecognised status: ${order.leafly_status ?? "none"}`}
          </Badge>
          <OrderOriginBadge origin="leafly" />
          {order.marketplace === "uberEats" ? <Badge tone="gold">Uber Eats</Badge> : null}
          {order.medical_status === "medical" ? <Badge tone="green">Medical</Badge> : null}
          {order.fulfillment_mechanism && order.fulfillment_mechanism !== "pickup" ? (
            <Badge tone="orange">{order.fulfillment_mechanism}</Badge>
          ) : null}
        </>
      }
      reference={
        local ? (
          <span title={fullId || undefined}>
            #{local.order_number} · Leafly ·{handle}
          </span>
        ) : null
      }
      customer={
        local ? (
          <>
            {customerName || "Customer"}
            {local.customer_phone ? ` · ${local.customer_phone}` : ""}
          </>
        ) : (
          // No Greenway copy yet = not acknowledged yet. Say so rather than
          // leave a blank where the customer would be.
          "Not accepted yet — open Details to read the order and accept it."
        )
      }
      meta={
        local ? (
          <>
            {local.item_count} item{local.item_count === 1 ? "" : "s"} ·{" "}
            {formatMinorCurrency(local.total_minor_units)} · placed{" "}
            {shortAgo(local.placed_at, now)}
          </>
        ) : order.first_seen_at ? (
          <>arrived {shortAgo(order.first_seen_at, now)}</>
        ) : null
      }
      alerts={
        clock.urgency !== "none" ||
        placement.pipelineWarning ||
        blockingCount > 0 ||
        cancelLabel ? (
          <>
            {clock.urgency !== "none" ? (
              <div
                className={`flex items-start gap-2 rounded-[var(--admin-radius-lg)] border px-3 py-1.5 text-xs font-bold ${URGENCY_STYLES[clock.urgency]}`}
              >
                <span aria-hidden>{URGENCY_ICONS[clock.urgency]}</span>
                <span>{clock.label}</span>
              </div>
            ) : null}
            {/* The pipeline warning: the one failure nobody can see. Full
                explanation and the announcer link are on the details page. */}
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
            {cancelLabel ? (
              <p className="text-xs font-bold text-[var(--admin-danger)]">{cancelLabel}</p>
            ) : null}
          </>
        ) : null
      }
      footer={
        local ? (
          <OrderStatusFlow status={local.status} />
        ) : (
          <p className="text-xs font-bold text-[var(--admin-text-muted)]">{placement.action}</p>
        )
      }
    />
  );
}

/** "5m ago" — the same coarse clock the website rows use. */
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
