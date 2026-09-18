"use client";

/**
 * src/components/admin/orders/LeaflyOrderActions.tsx
 *
 * SLICE L-6 — THE BUTTONS, AND THE DOOR THAT ONLY OPENS ONE WAY.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT WHEN ALMOST NOTHING ELSE ON THE PAGE IS
 * ===========================================================================
 * The Leafly orders panel is a server component, like the rest of
 * /admin/orders. This one small piece is not, for exactly one reason: two of
 * these actions cannot be undone, and confirming an action requires state.
 *
 *   * ACKNOWLEDGE destroys our access to the customer's ID images. Leafly's
 *     spec, verbatim: "Once an order has been acknowledged, access to an
 *     order's associated media is revoked."
 *   * PICKED UP and CANCELLED are terminal. Leafly's spec, verbatim: "Orders
 *     cannot be moved out of a terminal status."
 *
 * A plain `<form action={serverAction}>` submit on a phone at the counter is
 * one accidental thumb away from any of those. So the irreversible ones are
 * gated behind the shop's existing ConfirmDialog (house rule 11: reuse what
 * exists — this is the same dialog used for deleting a FAQ and for a
 * compliance-critical tax deviation), and the reversible ones submit directly,
 * because confirming everything trains people to click through confirmations
 * without reading them, which is worse than not having them.
 *
 * WHICH actions are irreversible is NOT decided here. It arrives on the
 * `irreversible` flag from `planLeaflyOrderActions()` in
 * `order-ack-core.ts`, where it is asserted in CI. A component that decided
 * this for itself would be a second, untested copy of Leafly's rules.
 *
 * ===========================================================================
 * THE FORMS ARE REAL FORMS
 * ===========================================================================
 * Every action is a real `<form>` posting to a real server action, and the
 * dialog works by calling `requestSubmit()` on it. That means the buttons still
 * function if the confirmation JavaScript fails to hydrate — they just submit
 * without the extra question, the same as any other form in the back office.
 * The alternative (fetch-on-click) would leave a dead button on a screen whose
 * job is time-critical.
 */

import { useRef, useState } from "react";
import { Button, CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import type { PlannedAction } from "@/lib/leafly/order-ack-core";

/**
 * A single planned action, rendered as a form + (maybe) a confirmation.
 *
 * One component per action rather than one dialog shared across the list: a
 * shared dialog needs to track WHICH action is pending, and getting that wrong
 * means confirming "cancel the order" and sending "picked up". Per-action state
 * makes that mistake unrepresentable.
 */
function ActionForm({
  action,
  leaflyOrderId,
  acknowledgeAction,
  statusAction,
  /** Shown inside the acknowledge confirmation, verbatim from the core. */
  irreversibleWarning,
  /** Shown inside the cancel confirmation so the reason is no surprise. */
  defaultCancelReasonLabel,
}: {
  action: PlannedAction;
  leaflyOrderId: string;
  acknowledgeAction: (formData: FormData) => void | Promise<void>;
  statusAction: (formData: FormData) => void | Promise<void>;
  irreversibleWarning: string;
  defaultCancelReasonLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isAck = action.kind === "acknowledge";
  const isCancel = action.status === "canceled";

  // Visual weight follows the plan's `emphasis`, which the core guarantees has
  // exactly one `primary` per order. The cancel action is the shop's existing
  // `danger` variant; everything else is a tinted chip, per the density rule
  // documented in Button.tsx ("many tinted chips per screen, at most ONE solid
  // orange primary per page region").
  const button =
    action.emphasis === "primary" ? (
      <Button type="submit" variant="primary" size="sm">
        {action.label}
      </Button>
    ) : action.emphasis === "danger" ? (
      <Button type="submit" variant="danger" size="sm">
        {action.label}
      </Button>
    ) : (
      <button type="submit" className={action.irreversible ? CHIP_NEUTRAL : CHIP_ACTION}>
        {action.label}
      </button>
    );

  return (
    <>
      <form
        ref={formRef}
        action={isAck ? acknowledgeAction : statusAction}
        onSubmit={(e) => {
          // Intercept ONLY the irreversible ones, and only while we still need
          // an answer. Once confirmed, the dialog calls requestSubmit() and
          // this handler must let it through — hence the `confirming` check
          // rather than a blanket preventDefault.
          if (action.irreversible && !confirming) {
            e.preventDefault();
            setConfirming(true);
          }
        }}
        className="inline"
      >
        <input type="hidden" name="leaflyOrderId" value={leaflyOrderId} />
        {!isAck && action.status ? (
          <input type="hidden" name="nextStatus" value={action.status} />
        ) : null}
        {/* No cancelationReasonCode is posted. Leafly documents that an absent
            reason defaults to `dispensary`, and sending a value we were told we
            do not need to send would be inventing data. The default is DISPLAYED
            in the confirmation instead, so it is informed rather than hidden. */}
        {button}
      </form>

      {action.irreversible ? (
        <ConfirmDialog
          open={confirming}
          title={
            isAck
              ? "Acknowledge this order to Leafly?"
              : isCancel
                ? "Cancel this order on Leafly?"
                : `${action.label}?`
          }
          description={
            isAck
              ? irreversibleWarning
              : isCancel
                ? `This tells Leafly the order is cancelled and notifies the shopper. Leafly does not allow a cancelled order to be moved again. Leafly will record the reason as “${defaultCancelReasonLabel}”.`
                : "Leafly does not allow an order to be moved again once it reaches this status."
          }
          confirmLabel={action.label}
          cancelLabel="Not yet"
          // `warning` (gold) for the acknowledgement, `danger` (red) for a
          // cancellation. The acknowledgement is not destructive — it is
          // REQUIRED, and the shop must not be discouraged from doing it
          // quickly — it simply cannot be undone. Painting it red would push
          // staff to hesitate on the one action that has a fifteen-minute clock.
          tone={isCancel ? "danger" : "warning"}
          onConfirm={() => {
            setConfirming(false);
            // Deferred to a microtask so React has applied `confirming: false`
            // before the submit re-enters onSubmit above; submitting first
            // would hit the guard again and reopen the dialog.
            Promise.resolve().then(() => formRef.current?.requestSubmit());
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

export function LeaflyOrderActions({
  actions,
  leaflyOrderId,
  acknowledgeAction,
  statusAction,
  irreversibleWarning,
  defaultCancelReasonLabel,
}: {
  actions: PlannedAction[];
  leaflyOrderId: string;
  acknowledgeAction: (formData: FormData) => void | Promise<void>;
  statusAction: (formData: FormData) => void | Promise<void>;
  irreversibleWarning: string;
  defaultCancelReasonLabel: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <ActionForm
          key={`${action.kind}:${action.status ?? "ack"}`}
          action={action}
          leaflyOrderId={leaflyOrderId}
          acknowledgeAction={acknowledgeAction}
          statusAction={statusAction}
          irreversibleWarning={irreversibleWarning}
          defaultCancelReasonLabel={defaultCancelReasonLabel}
        />
      ))}
    </div>
  );
}
