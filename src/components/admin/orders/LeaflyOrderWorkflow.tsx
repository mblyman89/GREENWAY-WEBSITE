/**
 * src/components/admin/orders/LeaflyOrderWorkflow.tsx
 *
 * SLICE L-38 — THE LEAFLY STEPS, ON THE ORDER'S DETAILS PAGE.
 *
 * The owner, verbatim:
 *
 *   > "the details button should open up the details page with the options to
 *   >  move the order along its process to completion"
 *
 * Until L-38 everything below lived on the dashboard, inside one card per
 * Leafly order (`LeaflyOrderCard` in LeaflyOrdersPanel.tsx). The dashboard
 * now shows a slim row per order — identical to a website order row — and
 * the full workflow moved here, unchanged in substance, so it can be rendered
 * by BOTH detail pages:
 *
 *   - /admin/orders/<id>             a Leafly order we have acknowledged
 *                                    (it has a Greenway copy);
 *   - /admin/orders/leafly/<leafly>  one we have not (no Greenway copy yet).
 *
 * The slice history in the comments is kept, because every block here was
 * added for a reason the owner found the hard way, and the reason is what
 * stops the next person deleting it.
 *
 * Still decides nothing. Every judgement is read from a pure core.
 */
import Link from "next/link";
import { Card, CardHeader, Badge, type BadgeTone } from "@/components/admin/ui";
import {
  assessAckClock,
  leaflyStatusLabel,
  leaflyCancelReasonLabel,
  leaflyStatusTone,
  planLeaflyOrderActions,
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON,
  type AckUrgency,
  type LeaflyStatusTone,
} from "@/lib/leafly/order-ack-core";
import {
  acknowledgedByKindLabel,
  LEAFLY_AUTO_ACK_EXPLANATION,
} from "@/lib/leafly/auto-ack-core";
import { placeLeaflyOrder } from "@/lib/leafly/bridge-core";
import type { LeaflyBoardOrder } from "@/lib/leafly/order-board-server";
import { summariseInterrupt, type InterruptRecord } from "@/lib/leafly/register-claim-core";
import { ANNOUNCER_PANEL_ANCHOR } from "./AnnouncerPanel";
import { setupAnchorHref } from "@/lib/admin/orders-tabs-core";
import { RETURN_TO_DETAIL } from "@/lib/orders/order-board-split-core";
import { LeaflyOrderActions } from "./LeaflyOrderActions";
import { LeaflyLifecycleStrip } from "./LeaflyLifecycleStrip";
import { LeaflyOrderDetailPanel } from "./LeaflyOrderDetail";
import { toWorkflowRow } from "./leafly-workflow-row";
import {
  acknowledgeLeaflyOrderAction,
  collectLeaflyOrderAction,
  loadLeaflyOrderDetailAction,
  setLeaflyOrderStatusAction,
} from "@/app/admin/orders/leafly-actions";

/**
 * Urgency → the shop's own alert styling. Shared with the dashboard row so a
 * countdown looks the same in both places.
 */
export const URGENCY_STYLES: Record<AckUrgency, string> = {
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

export const URGENCY_ICONS: Record<AckUrgency, string> = {
  urgent: "🚨",
  expired: "🚨",
  unknown: "❓",
  soon: "⏳",
  comfortable: "⏱️",
  none: "✅",
};

/** Status tone → the Badge tones the back office already ships. */
export const TONE_BADGE: Record<LeaflyStatusTone, BadgeTone> = {
  waiting: "orange",
  progress: "green",
  done: "neutral",
  bad: "danger",
  unknown: "gold",
};

/**
 * The outcome of the last Leafly button press.
 *
 * Shared by the dashboard panel and both detail pages, because since L-38 a
 * step is pressed on a detail page and its answer must appear THERE — the
 * page the operator is looking at — not on a dashboard they have left.
 */
export function LeaflyOutcomeBanners({
  message,
  warning,
  error,
  errorCode,
}: {
  message?: string | null;
  warning?: string | null;
  error?: string | null;
  errorCode?: string | null;
}) {
  return (
    <>
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

      {warning ? (
        <div
          role="alert"
          className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]"
        >
          ⚠️ {warning}
        </div>
      ) : null}
    </>
  );
}

/**
 * The whole Leafly workflow for ONE order: the step buttons, which step we are
 * on, the order itself (customer, cart, ID), the acknowledgement clock, the
 * silent-arrival warning, any register cancellation, and the next action.
 */
export function LeaflyOrderWorkflow({
  order: boardOrder,
  orderIntegrationKeyPresent,
  now,
  /** SLICE L-14 — this order’s interrupts, newest first. */
  interrupts,
  /** The dashboard view to restore from "Back to orders" after a press. */
  back,
}: {
  order: LeaflyBoardOrder;
  orderIntegrationKeyPresent: boolean;
  now: Date;
  interrupts?: InterruptRecord[];
  back?: string;
}) {
  const order = toWorkflowRow(boardOrder);
  const placement = placeLeaflyOrder(order);
  // ── Everything below is READ from the pure core, never decided here.
  const clock = assessAckClock({
    acknowledgedAt: order.acknowledged_at,
    acknowledgeBy: order.acknowledge_by,
    now,
  });
  const plan = planLeaflyOrderActions({
    leaflyOrderId: order.leafly_order_id,
    orderIntegrationKeyPresent,
    acknowledgedAt: order.acknowledged_at,
    leaflyStatus: order.leafly_status,
    fulfillmentMechanism: order.fulfillment_mechanism,
    // SLICE L-33. THE LINE THAT KEEPS THE BOARD USABLE AFTER AUTO-ACKNOWLEDGE.
    //
    // Before this slice, "acknowledged but still pending at Leafly" was a
    // contradiction — the only way to reach it was a confirm push that had
    // silently failed, so the planner replaced the ordinary buttons with a
    // single diagnostic ("Check this order with Leafly"). After this slice it
    // is the NORMAL resting state of every order in the shop: the machine
    // acknowledges on arrival and deliberately does not confirm, because the
    // owner said "it can't be acknowledge and confirm in the same step".
    //
    // Without this argument the planner would keep reading that state as
    // breakage and would show the whole shop a diagnostic instead of the
    // Confirm button — turning the feature into an outage. With it, the
    // planner keys on a RECORDED failure instead of an inference.
    confirmPushFailed: order.confirmPushFailed,
  });
  const statusLabel = leaflyStatusLabel(order.leafly_status);
  // SLICE L-33 (C6) — who pressed the button. Null when unrecorded, which is
  // every row that predates migration 0230; the page then says nothing rather
  // than inventing an audit trail.
  const ackKindLabel = acknowledgedByKindLabel(order.acknowledged_by_kind);
  const tone = leaflyStatusTone(order.leafly_status);
  const cancelLabel = leaflyCancelReasonLabel(order.cancelation_reason_code);
  const fullId = (order.leafly_order_id ?? "").trim();
  const handle = fullId ? fullId.slice(-6).toUpperCase() : "unknown";

  return (
    <Card padding="sm" accent="green" className="sm:p-5">
      <CardHeader
        title="Leafly steps"
        subtitle="This order came through Leafly. Move it along here — each step is sent to Leafly, so the customer’s Leafly app shows the same step."
        icon="🌿"
      />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-sm font-black text-[var(--admin-text)]"
              title={fullId || undefined}
            >
              Leafly ·{handle}
            </span>
            {/* An unrecognised status shows the raw value with a plain warning
                rather than an invented friendly name. */}
            <Badge tone={TONE_BADGE[tone]}>
              {statusLabel ?? `Unrecognised status: ${order.leafly_status ?? "none"}`}
            </Badge>
            {order.marketplace === "uberEats" ? <Badge tone="gold">Uber Eats</Badge> : null}
            {order.medical_status === "medical" ? <Badge tone="green">Medical</Badge> : null}
            {order.fulfillment_mechanism && order.fulfillment_mechanism !== "pickup" ? (
              <Badge tone="orange">{order.fulfillment_mechanism}</Badge>
            ) : null}
            {/* SLICE L-33 (C6) — WHO pressed acknowledge, only when RECORDED. */}
            {ackKindLabel ? (
              <Badge tone="neutral">
                <span title={LEAFLY_AUTO_ACK_EXPLANATION}>{ackKindLabel}</span>
              </Badge>
            ) : null}
          </div>

          {cancelLabel ? (
            <p className="mt-1.5 text-xs font-bold text-[var(--admin-danger)]">{cancelLabel}</p>
          ) : null}

          {order.payment_preference ? (
            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
              Customer expects to pay by {order.payment_preference}. Leafly doesn’t process
              payments — collect at the counter.
            </p>
          ) : null}
        </div>

        {/* The buttons. Generated from the plan, so the screen can never offer
            an action Leafly would refuse. `returnTo` brings the operator back
            to THIS page after a press (L-38). */}
        {fullId ? (
          <LeaflyOrderActions
            actions={plan.actions}
            leaflyOrderId={fullId}
            acknowledgeAction={acknowledgeLeaflyOrderAction}
            statusAction={setLeaflyOrderStatusAction}
            // SLICE L-32 — the same collect action the detail panel uses.
            reconcileAction={collectLeaflyOrderAction}
            irreversibleWarning={LEAFLY_ACK_IRREVERSIBLE_WARNING}
            defaultCancelReasonLabel={
              leaflyCancelReasonLabel(LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON) ??
              LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON
            }
            returnTo={RETURN_TO_DETAIL}
            back={back}
          />
        ) : null}
      </div>

      {/* ── SLICE L-31: WHICH STEP ARE WE ON? ─────────────────────────────
          Rendered directly UNDER the buttons, so the answer to "which one do
          I press?" sits with the buttons themselves. */}
      {fullId ? (
        <LeaflyLifecycleStrip
          acknowledgedAt={order.acknowledged_at}
          leaflyStatus={order.leafly_status}
          fulfillmentMechanism={order.fulfillment_mechanism}
          canceledAt={order.canceled_at}
        />
      ) : null}

      {/* ── SLICE L-24: the order, openable ───────────────────────────────
          "open the order and read what you need FIRST" — so the order is
          offered before the clock and the action list. On the details page it
          opens by itself (L-38): reading it is the point of the page. */}
      {fullId ? (
        <LeaflyOrderDetailPanel
          leaflyOrderId={fullId}
          load={loadLeaflyOrderDetailAction}
          collect={collectLeaflyOrderAction}
          returnTo={RETURN_TO_DETAIL}
          back={back}
          defaultOpen
        />
      ) : null}

      {/* ── The acknowledgement clock ───────────────────────────────────── */}
      {clock.urgency !== "none" ? (
        <div
          className={`mt-3 flex items-start gap-2 rounded-[var(--admin-radius-lg)] border px-3 py-2 text-xs font-bold ${URGENCY_STYLES[clock.urgency]}`}
        >
          <span aria-hidden>{URGENCY_ICONS[clock.urgency]}</span>
          <span>{clock.label}</span>
        </div>
      ) : null}

      {/* ── The pipeline warning (SLICE L-10) ─────────────────────────────
          The only warning here about a failure that is INVISIBLE: the order
          arrived, but the speaker never rang and the ticket never printed. */}
      {placement.pipelineWarning ? (
        <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--admin-danger)]">
          <p>⚠️ {placement.pipelineWarning}</p>
          <p className="mt-1 font-normal">
            The order itself is fine — this is about the alert not reaching you.{" "}
            {/* SLICE L-21 — a cross-tab URL, never a bare fragment. */}
            <a
              href={setupAnchorHref(ANNOUNCER_PANEL_ANCHOR)}
              className="font-bold underline underline-offset-2"
            >
              Open the order announcer →
            </a>
          </p>
        </div>
      ) : null}

      {/* ── SLICE L-14: what the till was asked, and what it answered ───────
          Resolved rows are shown as well as open ones: the answer is the only
          record of what happened to product already in a bag. */}
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
                  <span aria-hidden>{blocking ? "🛑" : "📋"}</span> {summary.headline}
                </p>
                <p className="mt-1 font-normal">{summary.reason}</p>
                {summary.decision ? (
                  <p className="mt-1 font-normal">
                    <span className="font-bold">{summary.decision.label}:</span>{" "}
                    {summary.decision.detail}
                    {row.resolvedByEmployee ? ` — ${row.resolvedByEmployee}` : ""}
                  </p>
                ) : null}
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

      {/* ── The single next action, imperative and singular, from the core. */}
      <p className="mt-2 text-xs font-bold text-[var(--admin-text-muted)]">{placement.action}</p>

      {/* Why there is nothing to do, when there is nothing to do. */}
      {plan.actions.length === 0 && plan.blockedReason ? (
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">{plan.blockedReason}</p>
      ) : null}

      {/* The hint for each offered action, listed rather than as tooltips: a
          tooltip is invisible on the tablet at the counter. */}
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
