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
 *
 * ===========================================================================
 * SLICE L-17 -- WHY THE BUTTON NOW SAYS WHAT IT IS DOING
 * ===========================================================================
 * The owner reported, about this exact control:
 *
 *   > "for the leafly orders specifically, i can click the acknowledge
 *   >  button, confirm the action, then it sits waiting forever stuck."
 *
 * There were TWO defects behind that one sentence, and fixing either alone
 * would have left him with the same complaint:
 *
 *   1. THE SERVER GENUINELY COULD HANG. Every outbound Leafly fetch was
 *      untimed (`grep AbortController src/lib/leafly/` returned nothing),
 *      including the token mint that runs BEFORE the acknowledge POST. That
 *      is fixed in `src/lib/leafly/deadline-fetch.ts`; the request now gives
 *      up in a bounded time and returns a sentence.
 *
 *   2. THE BUTTON LOOKED IDENTICAL THE WHOLE TIME. This is the half fixed
 *      here. `AnnouncerPanel.tsx:175` already documents the same bug class
 *      in this very folder, in the owner's words: "as a plain server form it
 *      had no pending state and its action returned void, so pressing it
 *      changed nothing on screen ... the owner reasonably read that as 'the
 *      button does nothing, it hangs'." The Leafly buttons had exactly that
 *      shape -- a real <form>, a void-returning server action, no pending
 *      state -- so between the click and the redirect the screen said
 *      nothing at all.
 *
 * `useFormStatus` is the right hook here rather than `useActionState` (which
 * AnnouncerTestButton uses): these actions end in `redirect()`, so they have
 * no return value to render, and the result is communicated by the page the
 * operator lands on. All that is needed is the pending flag -- and it must
 * be read from a CHILD of the form, which is why SubmitButton exists as a
 * separate component below rather than as markup inside ActionForm.
 *
 * Disabling while pending is a safety property, not a nicety. Acknowledge is
 * the one-way door; a second click during a slow first request is exactly
 * how a double submit happens, and it is the scenario the deadline core
 * refuses to call safe (`safeToRetry === false` for an acknowledge whose
 * outcome is unknown).
 */

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import type { PlannedAction } from "@/lib/leafly/order-ack-core";

/**
 * The submit control, split out purely so it can call `useFormStatus()`.
 *
 * The hook reports the status of the nearest ANCESTOR form, so it returns
 * `{ pending: false }` forever if it is called in the same component that
 * renders the <form>. That is not a style preference -- calling it one level
 * up is simply broken, and it is broken silently, which is why this split is
 * documented rather than looking like indirection for its own sake.
 *
 * The three visual weights mirror what the plan asked for, unchanged. The
 * only thing added is what the control does while the request is in flight:
 * it names the wait, spins, and refuses a second press.
 */
function SubmitButton({
  action,
}: {
  action: PlannedAction;
}) {
  const { pending } = useFormStatus();

  // The verb is the action's own label turned into a present participle by
  // the core's wording, NOT by string surgery here. `busyLabel` arrives from
  // planLeaflyOrderActions(), so the sentence an operator reads under stress
  // is the same reviewed, self-tested wording as the idle label.
  const label = pending ? action.busyLabel : action.label;

  const spinner = (
    <span
      aria-hidden
      className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
    />
  );

  // aria-busy, not just a spinner: the spinner is invisible to a screen
  // reader and this panel is used one-handed at a counter.
  const content = pending ? (
    <>
      {spinner}
      {label}
    </>
  ) : (
    label
  );

  if (action.emphasis === "primary" || action.emphasis === "danger") {
    return (
      <Button
        type="submit"
        variant={action.emphasis}
        size="sm"
        disabled={pending}
        aria-busy={pending}
      >
        {content}
      </Button>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${action.irreversible ? CHIP_NEUTRAL : CHIP_ACTION} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {content}
    </button>
  );
}

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
  /**
   * SLICE L-29 — permission to submit, held in a ref rather than in state.
   *
   * The previous version gated the confirmed submit on the `confirming` STATE
   * flag, read through the render closure that `onSubmit` was created in.
   * That made correctness depend on React not having re-rendered yet when
   * `requestSubmit()` ran on a microtask — and React flushes discrete-event
   * updates synchronously at the end of the handler, i.e. BEFORE queued
   * microtasks. Under that (actual) ordering the handler saw
   * `confirming === false`, cancelled the submit, and re-opened the dialog:
   * the acknowledgement would never be sent.
   *
   * It was invisible only because a second bug hid it — PendingKeeper's stale
   * `gwBusy` flag swallowed the submit with stopPropagation() before this
   * handler ever ran. Fixing the keeper alone would have swapped a phantom
   * spinner for a dialog that reopens forever, which to the owner is the same
   * complaint. Both are fixed together; see
   * scripts/recon/l29-confirm-reentry-probe.mjs, which runs this logic under
   * both flush orderings and shows the state version disagreeing with itself.
   *
   * A ref is read live, so it does not care when React renders. It is
   * one-shot: consumed on use, so a later stray submit asks again rather than
   * silently inheriting an old yes on a one-way door.
   */
  const confirmedRef = useRef(false);

  const isAck = action.kind === "acknowledge";
  const isCancel = action.status === "canceled";

  // Visual weight follows the plan's `emphasis`, which the core guarantees has
  // exactly one `primary` per order. The cancel action is the shop's existing
  // `danger` variant; everything else is a tinted chip, per the density rule
  // documented in Button.tsx ("many tinted chips per screen, at most ONE solid
  // orange primary per page region"). The rendering moved into SubmitButton
  // (see its header) because the pending flag can only be read from inside
  // the form.

  return (
    <>
      <form
        ref={formRef}
        action={isAck ? acknowledgeAction : statusAction}
        onSubmit={(e) => {
          // Intercept ONLY the irreversible ones, and only while we still
          // need an answer. Once confirmed, the dialog calls requestSubmit()
          // and this handler must let it through.
          //
          // SLICE L-29: the permission is read from a REF, not from the
          // `confirming` state flag. State is captured by this closure at
          // render time, and React has already flushed `confirming: false`
          // by the time the confirmed submit arrives — so the state version
          // cancelled the very submit it was meant to allow. See the note on
          // `confirmedRef` above.
          if (!action.irreversible) return;
          if (confirmedRef.current) {
            confirmedRef.current = false; // one-shot: consume the permission
            return; // let the real submit through
          }
          e.preventDefault();
          setConfirming(true);
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
        <SubmitButton action={action} />
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
            // Grant permission BEFORE submitting. The ref is read live by the
            // onSubmit handler above, so this is not sensitive to when React
            // re-renders — which is exactly the bug this replaced.
            confirmedRef.current = true;
            setConfirming(false);
            formRef.current?.requestSubmit();
          }}
          onCancel={() => {
            // Revoke any permission on the way out. Nothing should be able to
            // leave a standing "yes" behind on a one-way door.
            confirmedRef.current = false;
            setConfirming(false);
          }}
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
