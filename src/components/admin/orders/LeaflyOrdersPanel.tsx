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
  planLeaflyOrderActions,
  LEAFLY_ACK_WINDOW_MINUTES,
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON,
  type AckUrgency,
  type LeaflyStatusTone,
} from "@/lib/leafly/order-ack-core";
import {
  groupLeaflyWorkflow,
  // SLICE L-28 — the bucket is computed once in the panel and shared between
  // the filter and the headings, so the two cannot disagree.
  placeLeaflyOrder,
  type LeaflyWorkflowInput,
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
  summariseInterrupt,
  summariseInterrupts,
  type InterruptRecord,
} from "@/lib/leafly/register-claim-core";
import type { BoardInterrupts } from "@/lib/leafly/register-claim-server";
import { ANNOUNCER_PANEL_ANCHOR } from "./AnnouncerPanel";
// SLICE L-21: the announcer now lives on the setup tab, so the jump link below
// must cross tabs rather than scroll within this page. See setupAnchorHref().
import { leaflyBoardRendersNothing, setupAnchorHref } from "@/lib/admin/orders-tabs-core";
import { LeaflyOrderActions } from "./LeaflyOrderActions";
import { LeaflyLifecycleStrip } from "./LeaflyLifecycleStrip";
// SLICE L-24 — the detail panel the acknowledge hint has always pointed at.
import { LeaflyOrderDetailPanel } from "./LeaflyOrderDetail";
import {
  acknowledgeLeaflyOrderAction,
  // SLICE L-25 — the recovery path for an order we never downloaded.
  collectLeaflyOrderAction,
  loadLeaflyOrderDetailAction,
  setLeaflyOrderStatusAction,
} from "@/app/admin/orders/leafly-actions";

/**
 * Urgency → the shop's own alert styling.
 *
 * The mapping lives here (a presentation concern) while the JUDGEMENT of which
 * urgency a deadline has lives in the core (a domain concern, asserted in CI).
 * Only the two token families the back office already uses for alarm are used,
 * so a Leafly warning looks like every other warning in the building rather
 * than like a bolted-on integration.
 */
const URGENCY_STYLES: Record<AckUrgency, string> = {
  urgent:
    "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  expired:
    "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  // "unknown" is styled as an alarm on purpose: not knowing how long is left
  // on a clock that auto-cancels a customer's order is an urgent condition,
  // not a neutral one.
  unknown:
    "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  soon: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  comfortable:
    "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
  none: "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
};

const URGENCY_ICONS: Record<AckUrgency, string> = {
  urgent: "🚨",
  expired: "🚨",
  unknown: "❓",
  soon: "⏳",
  comfortable: "⏱️",
  none: "✅",
};

/** Status tone → the Badge tones the back office already ships. */
const TONE_BADGE: Record<LeaflyStatusTone, BadgeTone> = {
  waiting: "orange",
  progress: "green",
  done: "neutral",
  bad: "danger",
  unknown: "gold",
};

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

/** One board row, plus the flat camelCase shape the pure core reads. */
type BoardRow = LeaflyBoardState["orders"][number];
type WorkflowRow = BoardRow & LeaflyWorkflowInput;

/**
 * Translate a database row into the core's input shape.
 *
 * `announced_at` and `printed_at` are passed THROUGH, including when they are
 * `undefined` — which is what a pre-0228 database produces, because the board
 * falls back to a column list that omits them. That `undefined` must survive
 * this function intact: the core treats it as "not tracked" and stays quiet,
 * whereas a `?? null` here would make the board accuse every order in the shop
 * of having never rung the bell. The temptation to "tidy" this line is exactly
 * the bug, so it is called out here and pinned by tests in bridge-core.
 */
function toWorkflowRow(order: BoardRow): WorkflowRow {
  return {
    ...order,
    leaflyOrderId: order.leafly_order_id,
    leaflyStatus: order.leafly_status,
    acknowledgedAt: order.acknowledged_at,
    canceledAt: order.canceled_at,
    localOrderId: order.local_order_id,
    announcedAt: order.announced_at,
    printedAt: order.printed_at,
  };
}

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
}: {
  board: LeaflyBoardState;
  pendingAckCount: number | null;
  interrupts?: BoardInterrupts;
  now: Date;
  message?: string | null;
  error?: string | null;
  errorCode?: string | null;
  filter?: BoardFilter;
  sort?: BoardSort;
  search?: string | null;
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
  const hasOutcome = Boolean(message || error);

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
        {error ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            <p className="font-bold">⚠️ Leafly didn’t accept that.</p>
            <p className="mt-1">{error}</p>
            {/* The remedy, chosen from the code the pure core produced. A bare
                error with no next step is what makes staff stop reading them. */}
            {errorCode === "missing_integration_key" ? (
              <p className="mt-2">
                <Link
                  href="/admin/integrations/leafly"
                  className="font-bold underline underline-offset-2"
                >
                  Enter your Leafly order integration key →
                </Link>
              </p>
            ) : null}
            {errorCode === "fix_config" ? (
              <p className="mt-2">
                <Link
                  href="/admin/integrations/leafly"
                  className="font-bold underline underline-offset-2"
                >
                  Check your Leafly credentials →
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {message ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            ✅ {message}
          </div>
        ) : null}

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
                  placeholder="Order number"
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
                        <LeaflyOrderCard
                          key={order.id}
                          order={order}
                          placement={placement}
                          board={board}
                          now={now}
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
 * One Leafly order, as a card.
 *
 * Extracted from the panel in slice L-10 when the flat list became a set of
 * workflow buckets: the same markup now renders inside five different
 * sections, and a card duplicated per section is a card that drifts per
 * section. The CONTENTS are unchanged from L-6 apart from the pipeline
 * warning, which is new.
 *
 * Still decides nothing. `placement` arrives already computed by
 * `placeLeaflyOrder` in the pure core.
 */
function LeaflyOrderCard({
  order,
  placement,
  board,
  now,
  /** SLICE L-14 — this order’s interrupts, newest first. */
  interrupts,
}: {
  order: WorkflowRow;
  placement: LeaflyWorkflowPlacement;
  board: LeaflyBoardState;
  now: Date;
  interrupts?: InterruptRecord[];
}) {
  // ── Everything below is READ from the pure core, never decided here.
  const clock = assessAckClock({
    acknowledgedAt: order.acknowledged_at,
    acknowledgeBy: order.acknowledge_by,
    now,
  });
  const plan = planLeaflyOrderActions({
    leaflyOrderId: order.leafly_order_id,
    orderIntegrationKeyPresent: board.orderIntegrationKeyPresent,
    acknowledgedAt: order.acknowledged_at,
    leaflyStatus: order.leafly_status,
    fulfillmentMechanism: order.fulfillment_mechanism,
  });
  const statusLabel = leaflyStatusLabel(order.leafly_status);
  const tone = leaflyStatusTone(order.leafly_status);
  const cancelLabel = leaflyCancelReasonLabel(
    order.cancelation_reason_code,
  );
  // Leafly's order id is a uuid. The last six characters are shown
  // as a handle so two orders are distinguishable at a glance
  // without printing a 36-character identifier across a phone
  // screen. The full value is in the title attribute for copying.
  const fullId = (order.leafly_order_id ?? "").trim();
  const handle = fullId ? fullId.slice(-6).toUpperCase() : "unknown";

  return (
    <Card key={order.id} padding="sm" raised>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-sm font-black text-[var(--admin-text)]"
              title={fullId || undefined}
            >
              Leafly ·{handle}
            </span>
            {/* An unrecognised status shows the raw value with a
                plain warning rather than an invented friendly name.
                The core returns null for unknown values precisely
                so this case is visible instead of smoothed over. */}
            <Badge tone={TONE_BADGE[tone]}>
              {statusLabel ??
                `Unrecognised status: ${order.leafly_status ?? "none"}`}
            </Badge>
            {order.marketplace === "uberEats" ? (
              <Badge tone="gold">Uber Eats</Badge>
            ) : null}
            {order.medical_status === "medical" ? (
              <Badge tone="green">Medical</Badge>
            ) : null}
            {order.fulfillment_mechanism &&
            order.fulfillment_mechanism !== "pickup" ? (
              <Badge tone="orange">{order.fulfillment_mechanism}</Badge>
            ) : null}
            {order.local_order_id ? (
              <Badge tone="neutral">Linked to a Greenway order</Badge>
            ) : null}
          </div>

          {cancelLabel ? (
            <p className="mt-1.5 text-xs font-bold text-[var(--admin-danger)]">
              {cancelLabel}
            </p>
          ) : null}

          {order.payment_preference ? (
            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
              Customer expects to pay by {order.payment_preference}. Leafly
              doesn’t process payments — collect at the counter.
            </p>
          ) : null}
        </div>

        {/* The buttons. Generated from the plan, so the screen can
            never offer an action Leafly would refuse. */}
        {fullId ? (
          <LeaflyOrderActions
            actions={plan.actions}
            leaflyOrderId={fullId}
            acknowledgeAction={acknowledgeLeaflyOrderAction}
            statusAction={setLeaflyOrderStatusAction}
            // SLICE L-32 — the same collect action the detail panel already
            // uses (see below). Reused deliberately rather than written
            // again: it is already bounded by `withActionDeadline`, already
            // audited, and already proven in production by the L-25 slice.
            // A second, near-identical re-read path would be a second thing
            // to keep correct.
            reconcileAction={collectLeaflyOrderAction}
            irreversibleWarning={LEAFLY_ACK_IRREVERSIBLE_WARNING}
            defaultCancelReasonLabel={
              leaflyCancelReasonLabel(
                LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON,
              ) ?? LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON
            }
          />
        ) : null}
      </div>

      {/* ── SLICE L-31: WHICH STEP ARE WE ON? ─────────────────────
          The owner: "I think we need to make it much more obvious
          which step we are on, and then we will know we are finished
          because the order will be marked complete and moved to the
          hidden table."

          Rendered directly UNDER the buttons, so the answer to "which
          one do I press?" sits with the buttons themselves rather than
          somewhere else on the card. Decides nothing — the whole view
          comes from `lifecycleView()` in lifecycle-core.ts, which is
          pure and proven by self-tests in CI. */}
      {fullId ? (
        <LeaflyLifecycleStrip
          acknowledgedAt={order.acknowledged_at}
          leaflyStatus={order.leafly_status}
          fulfillmentMechanism={order.fulfillment_mechanism}
          canceledAt={order.canceled_at}
        />
      ) : null}

      {/* ── SLICE L-24: the order, openable ───────────────────────
          The acknowledge hint has always ended with "so open the order
          and read what you need FIRST". Until this slice there was no
          way to do that, which the owner found the hard way:

            "But there is no way to click the order and see the order
             details, or customer id image."

          Placed ABOVE the clock and the action list deliberately. An
          instruction to read first only works if reading is offered
          before the button that permanently ends it. */}
      {fullId ? (
        <LeaflyOrderDetailPanel
          leaflyOrderId={fullId}
          load={loadLeaflyOrderDetailAction}
          collect={collectLeaflyOrderAction}
        />
      ) : null}

      {/* ── The acknowledgement clock ─────────────────────────────
          Rendered for every unacknowledged order and suppressed
          once acknowledged (the core returns urgency "none" and a
          null countdown in that case, so there is no ticking
          deadline on an order that no longer has one). */}
      {clock.urgency !== "none" ? (
        <div
          className={`mt-3 flex items-start gap-2 rounded-[var(--admin-radius-lg)] border px-3 py-2 text-xs font-bold ${URGENCY_STYLES[clock.urgency]}`}
        >
          <span aria-hidden>{URGENCY_ICONS[clock.urgency]}</span>
          <span>{clock.label}</span>
        </div>
      ) : null}

      {/* ── The pipeline warning ────────────────────────────────────
          The most important few lines on this screen, and the reason slice
          L-10 exists. Every other warning here describes something a human
          can already see: a countdown, a cancellation, a status. This one
          describes a failure that is INVISIBLE — the order arrived, the row
          looks perfectly healthy, and the only symptom is that the speaker
          never rang and the ticket never printed, so nobody in the building
          knows the order exists. Left alone it auto-cancels and the shop
          never learns why.

          It renders only when the core says so. A pre-0228 database reports
          `undefined` rather than null for these columns, and the core stays
          silent in that case rather than accusing every order at once. */}
      {placement.pipelineWarning ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--admin-danger)]">
          <p>⚠️ {placement.pipelineWarning}</p>
          <p className="mt-1 font-normal">
            The order itself is fine — this is about the alert not reaching you.{" "}
            {/* SLICE L-21 — this WAS an in-page jump. It is not any more.
                The announcer panel used to be rendered above this one on the
                same page, so a bare "#order-announcer" worked and the arrow
                pointed up. L-21 moved that panel to the "Setup & equipment"
                tab, which means the element is no longer in this document at
                all -- and a bare fragment pointing at an element that does not
                exist scrolls NOWHERE and reports nothing. It would have become
                a link that silently does nothing, on the one banner that only
                ever appears when an order arrived and nobody heard it.

                setupAnchorHref() builds the cross-tab URL, so the click
                changes tab AND lands on the panel. Both halves -- the anchor
                name and the tab href -- are imported rather than typed, so a
                rename is a compile error instead of a dead link. */}
            <a
              href={setupAnchorHref(ANNOUNCER_PANEL_ANCHOR)}
              className="font-bold underline underline-offset-2"
            >
              Open the order announcer →
            </a>
          </p>
        </div>
      ) : null}

      {/* ── SLICE L-14: what the till was asked, and what it answered ────────
          The ONLY record anywhere of what happened to product that was already
          bagged when Leafly cancelled. Resolved rows are shown as well as open
          ones, quietly, because a manager reconciling the shelf tomorrow needs
          the answer as much as a manager watching a stopped till needs the
          question.

          Every word of state below is read from summariseInterrupt in the pure
          core. This block chooses colours, nothing else. */}
      {(interrupts ?? []).length > 0 ? (
        <div className="mt-3 space-y-2">
          {(interrupts ?? []).map((row) => {
            const summary = summariseInterrupt(row);
            const blocking = summary.state === "BLOCKING";
            return (
              <div
                key={row.rowId}
                className={`rounded-[var(--admin-radius-lg)] border px-3 py-2 text-xs ${
                  blocking
                    ? "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
                    : "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]"
                }`}
              >
                <p className="font-bold">
                  <span aria-hidden>{blocking ? "🛑" : "📋"}</span>{" "}
                  {summary.headline}
                </p>
                <p className="mt-1 font-normal">{summary.reason}</p>
                {summary.decision ? (
                  <p className="mt-1 font-normal">
                    <span className="font-bold">{summary.decision.label}:</span>{" "}
                    {summary.decision.detail}
                    {row.resolvedByEmployee ? ` — ${row.resolvedByEmployee}` : ""}
                  </p>
                ) : null}
                {/* Stated rather than hidden. A resolved row whose recorded
                    decision is not one this software recognises is a real
                    reconciliation problem, and showing whichever option
                    happened to be first would be a guess. */}
                {summary.needsAttention && !blocking ? (
                  <p className="mt-1 font-bold text-[var(--admin-gold)]">
                    Needs a look — no recognised decision was recorded for this one.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── The single next action ─────────────────────────────────
          Imperative and singular, from the core. The buttons above say what
          the software CAN do; this says what the person should do next. On a
          tablet held by somebody four orders behind, that distinction is the
          difference between a screen that helps and a screen to interpret. */}
      <p className="mt-2 text-xs font-bold text-[var(--admin-text-muted)]">
        {placement.action}
      </p>

      {/* Why there is nothing to do, when there is nothing to do.
          An order with no buttons and no explanation reads as a
          broken screen. */}
      {plan.actions.length === 0 && plan.blockedReason ? (
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
          {plan.blockedReason}
        </p>
      ) : null}

      {/* The hint for each offered action, listed under the buttons
          rather than as tooltips: a tooltip is invisible on the
          tablet at the counter, which is the device this screen is
          actually used on. */}
      {plan.actions.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {plan.actions.map((a) => (
            <li
              key={`${a.kind}:${a.status ?? "ack"}`}
              className="text-[0.7rem] leading-relaxed text-[var(--admin-text-faint)]"
            >
              <span className="font-bold">{a.label}:</span> {a.hint}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
