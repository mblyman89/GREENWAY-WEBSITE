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
import type { LeaflyBoardState } from "@/lib/leafly/order-board-server";
import { LeaflyOrderActions } from "./LeaflyOrderActions";
import {
  acknowledgeLeaflyOrderAction,
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

export function LeaflyOrdersPanel({
  board,
  pendingAckCount,
  /** Injected so the panel is deterministic and the clock is testable. */
  now,
  /** Outcome of the last action, lifted from the URL by the page. */
  message,
  error,
  errorCode,
}: {
  board: LeaflyBoardState;
  pendingAckCount: number | null;
  now: Date;
  message?: string | null;
  error?: string | null;
  errorCode?: string | null;
}) {
  const hasOrders = board.orders.length > 0;
  const hasProblem = board.problem.trim().length > 0;
  const hasOutcome = Boolean(message || error);

  // Nothing set up, nothing received, nothing wrong, nothing to report → render
  // nothing. See the file header: the orders page does not grow a permanent
  // empty section for a feature that is not in use.
  if (!hasOrders && !hasProblem && !hasOutcome && !board.orderIntegrationKeyPresent) {
    return null;
  }

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
          <div className="mt-4 grid gap-3">
            {board.orders.map((order) => {
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
                        irreversibleWarning={LEAFLY_ACK_IRREVERSIBLE_WARNING}
                        defaultCancelReasonLabel={
                          leaflyCancelReasonLabel(
                            LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON,
                          ) ?? LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON
                        }
                      />
                    ) : null}
                  </div>

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
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
