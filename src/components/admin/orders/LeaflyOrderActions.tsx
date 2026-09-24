"use client";

/**
 * src/components/admin/orders/LeaflyOrderActions.tsx
 *
 * SLICE L-6 — THE BUTTONS, AND THE DOOR THAT ONLY OPENS ONE WAY.
 * SLICE L-30 — THE DOOR NOW OPENS IN ONE CLICK.
 *
 * ===========================================================================
 * SLICE L-30 — WHY THE ACKNOWLEDGE CONFIRMATION IS GONE
 * ===========================================================================
 * The owner, after the fourth failed attempt to fix this one button:
 *
 *   > "again, is it required by leafly to have this double click for
 *   >  acknowledging? if not, please get rid of it. ... I say just get rid
 *   >  of it. one click to acknowledge."
 *
 * He asked a question of fact, so it was answered from Leafly's own published
 * specification rather than from memory. `docs/leafly-specs/order-api-v1.
 * openapi.json` was re-downloaded live from Leafly's docs host and is
 * BYTE-IDENTICAL to the vendored copy (md5 daab7bcf6f77177de85425adf7f805f1),
 * so the following is current, not historical.
 *
 * The complete specification of the acknowledge operation is:
 *
 *   POST /{order_integration_key}/orders/{id}/acknowledge
 *   "This endpoint confirms that your system has retrieved all necessary
 *    details regarding an order, including any associated media...
 *    - Acknowledgement of order receipt is required before any changes can be
 *      made to that order through other API operations
 *    - Once an order has been acknowledged, access to an order's associated
 *      media is revoked."
 *
 * No request body. No confirmation parameter. No two-step handshake. The
 * requirements table marks "Acknowledge Order | Endpoint | Successful
 * requests | Required" — the ENDPOINT is required; Leafly says nothing
 * whatsoever about how a retailer's own screen should ask for it.
 *
 * And Leafly's stated expectation actively argues AGAINST a modal:
 *
 *   "Orders are acknowledged as having been retrieved in whole by your system
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders not acknowledged by this deadline will be auto canceled."
 *
 * ANSWER: no, Leafly does not require it. The confirmation was this
 * codebase's own invention, and a dialog that waits on a human being is a
 * liability when the action it guards has a fifteen-minute clock. It is
 * removed. Acknowledging is one click.
 *
 * WHAT WAS PROTECTING, AND WHERE IT WENT. The dialog existed for a real
 * reason: acknowledging destroys our access to the customer's ID images, and
 * a thumb on a phone at the counter is one tap from that. The protection is
 * not deleted, it is MOVED to where it actually works — the warning is now
 * printed ON THE SCREEN, next to the button, before the press, where it can
 * be read without dismissing anything. That is strictly better than a modal
 * for the failure mode that matters: a modal is answered reflexively, whereas
 * standing text is present every time the operator looks at the order. The
 * owner is the one carrying this risk and he has asked for it twice; the
 * wording is unchanged and still comes from the core.
 *
 * THE SECOND, LARGER REASON IT HAD TO GO. The dialog was implemented by
 * letting the form submit and then CANCELLING that submit with
 * preventDefault() to open the modal. That made "a submit event happened"
 * stop meaning "a save started" for every listener in the admin, and
 * PendingKeeper — which watches all forms — had no sound way to tell the two
 * apart. L-29 tried to tell them apart with `defaultPrevented` and failed,
 * because react-dom also calls preventDefault() on SUCCESSFUL server-action
 * submits. Measured, not assumed:
 * `scripts/recon/l30-real-click-probe.mjs` drives this exact component in
 * real Chromium with a real trusted click and reports, for the old version,
 * `serverActionCalls: 0` — the acknowledgement never left the browser. That
 * is the whole mystery of "it spins forever and gives me no error": there was
 * never a request to fail.
 *
 * So the rule now, and it is the important line in this file:
 * ******** A SUBMIT EVENT IN THIS ADMIN ALWAYS MEANS A REAL SAVE. ********
 * A form must never submit in order to ask a question. The two remaining
 * confirm-first actions (picked up / cancelled — both genuinely terminal in
 * Leafly, and neither on a clock) now open their dialog from a plain
 * `type="button"` click and submit exactly once, AFTER the answer. That is
 * the same pattern the content panels have always used.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT WHEN ALMOST NOTHING ELSE ON THE PAGE IS
 * ===========================================================================
 * The Leafly orders panel is a server component, like the rest of
 * /admin/orders. This one small piece is not, because two of these actions
 * cannot be undone and confirming an action requires state:
 *
 *   * PICKED UP and CANCELLED are terminal. Leafly's spec, verbatim: "Orders
 *     cannot be moved out of a terminal status."
 *
 * Those stay behind the shop's existing ConfirmDialog (house rule 11: reuse
 * what exists). The reversible ones submit directly, because confirming
 * everything trains people to click through confirmations without reading
 * them, which is worse than not having them — and that same argument is
 * exactly why the acknowledgement, which is REQUIRED and time-limited, should
 * never have been confirmed in the first place.
 *
 * WHICH actions are irreversible is NOT decided here. It arrives on the
 * `irreversible` flag from `planLeaflyOrderActions()` in `order-ack-core.ts`,
 * where it is asserted in CI. A component that decided this for itself would
 * be a second, untested copy of Leafly's rules. L-30 does NOT change that
 * flag — acknowledging is still irreversible, and still says so. What changed
 * is only what the UI DOES about it: it warns in place instead of
 * interrupting.
 *
 * ===========================================================================
 * THE FORMS ARE REAL FORMS
 * ===========================================================================
 * Every action is a real `<form>` posting to a real server action. For the
 * confirm-first ones the dialog works by calling `requestSubmit()`. That
 * means the buttons still function if the confirmation JavaScript fails to
 * hydrate — they just submit without the extra question, the same as any
 * other form in the back office. The alternative (fetch-on-click) would leave
 * a dead button on a screen whose job is time-critical. The acknowledge
 * button is now the purest version of this: a plain submit, nothing
 * intercepting it, which works with or without JavaScript.
 *
 * ===========================================================================
 * SLICE L-17 -- WHY THE BUTTON SAYS WHAT IT IS DOING
 * ===========================================================================
 * The owner reported, about this exact control:
 *
 *   > "for the leafly orders specifically, i can click the acknowledge
 *   >  button, confirm the action, then it sits waiting forever stuck."
 *
 * There were TWO defects behind that one sentence:
 *
 *   1. THE SERVER GENUINELY COULD HANG. Every outbound Leafly fetch was
 *      untimed, including the token mint that runs BEFORE the acknowledge
 *      POST. Fixed in `src/lib/leafly/deadline-fetch.ts`.
 *
 *   2. THE BUTTON LOOKED IDENTICAL THE WHOLE TIME. `AnnouncerPanel.tsx:175`
 *      documents the same bug class in this very folder: a real <form>, a
 *      void-returning server action, no pending state — so between the click
 *      and the redirect the screen said nothing at all.
 *
 * `useFormStatus` is the right hook here rather than `useActionState` (which
 * AnnouncerTestButton uses): these actions end in `redirect()`, so they have
 * no return value to render. All that is needed is the pending flag -- and it
 * must be read from a CHILD of the form, which is why SubmitButton exists as
 * a separate component below rather than as markup inside ActionForm.
 *
 * Disabling while pending is a safety property, not a nicety. Acknowledge is
 * the one-way door; a second click during a slow first request is exactly how
 * a double submit happens, and it is the scenario the deadline core refuses
 * to call safe (`safeToRetry === false` for an acknowledge whose outcome is
 * unknown). With the dialog gone this is now the ONLY thing standing between
 * a jittery thumb and a duplicate acknowledge, so it matters more than it
 * did, not less.
 */

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import {
  LEAFLY_STALE_CONFIRM_NOTICE,
  type PlannedAction,
} from "@/lib/leafly/order-ack-core";

/**
 * The submit control, split out purely so it can call `useFormStatus()`.
 *
 * The hook reports the status of the nearest ANCESTOR form, so it returns
 * `{ pending: false }` forever if it is called in the same component that
 * renders the <form>. That is not a style preference -- calling it one level
 * up is simply broken, and it is broken silently, which is why this split is
 * documented rather than looking like indirection for its own sake.
 *
 * SLICE L-30: `type` is a prop now. A confirm-first action renders this as a
 * `type="button"` that opens its dialog; only the confirmed press submits.
 * Making the button NOT a submit control is the entire fix for the class of
 * bug that produced four failed slices: a form that never submits to ask a
 * question can never be mistaken for a form that is saving.
 */
function SubmitButton({
  action,
  type = "submit",
  onClick,
}: {
  action: PlannedAction;
  type?: "submit" | "button";
  onClick?: () => void;
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
        type={type}
        onClick={onClick}
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
      type={type}
      onClick={onClick}
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
 *
 * SLICE L-30 — three properties this component now guarantees, all pinned in
 * tests/compliance/leafly-l30-one-click-acknowledge.test.ts:
 *
 *   1. The acknowledge action has NO dialog and NO onSubmit handler at all.
 *      One click, one submit, straight to the server action.
 *   2. No form here calls preventDefault() on submit, ever. The dialog for
 *      terminal statuses opens from a button click, not from a cancelled
 *      submit, so a submit event always means a real save.
 *   3. Consequently there is no `confirming` flag read across a render
 *      closure and no permission ref — the L-29 hazards are not fixed, they
 *      are structurally absent.
 */
function ActionForm({
  action,
  leaflyOrderId,
  acknowledgeAction,
  statusAction,
  reconcileAction,
  /** Shown inside the cancel confirmation so the reason is no surprise. */
  defaultCancelReasonLabel,
}: {
  action: PlannedAction;
  leaflyOrderId: string;
  acknowledgeAction: (formData: FormData) => void | Promise<void>;
  statusAction: (formData: FormData) => void | Promise<void>;
  /**
   * SLICE L-32 — the re-read. Injected like the other two rather than
   * imported, because this file is a client component and the actions are
   * server actions; importing them here would drag server-only code into
   * the browser bundle.
   */
  reconcileAction: (formData: FormData) => void | Promise<void>;
  defaultCancelReasonLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isAck = action.kind === "acknowledge";
  const isReconcile = action.kind === "reconcile";
  const isCancel = action.status === "canceled";

  // SLICE L-32 — which server action this form posts to.
  //
  // Written as an explicit three-way rather than the old ternary on `isAck`.
  // A ternary would have silently routed the new `reconcile` kind to the
  // STATUS action, which posts no `nextStatus`, fails validation, and would
  // have produced a second confusing error on the very button added to end
  // the first one. The kinds are named, so a fourth kind is a type error
  // rather than a wrong destination.
  const formAction = isAck
    ? acknowledgeAction
    : isReconcile
      ? reconcileAction
      : statusAction;

  // ── SLICE L-31 ───────────────────────────────────────────────────────────
  // Only CANCEL asks a question now. It used to be `action.irreversible &&
  // !isAck`, which silently swept in "Mark picked up" too, because
  // `planLeaflyOrderActions()` sets `irreversible: isTerminalForOutbound()`
  // and `picked_up` is terminal in Leafly's spec just as `canceled` is.
  //
  // The owner, after eight slices were lost to a dialog nobody could see was
  // the problem:
  //
  //   > "the mark picked up button produces a popup asking to confirm the
  //   >  action. since we wasted like 8 slices trying to figure out how to
  //   >  talk to leafly only to find out it was the confirm the action pop up
  //   >  the whole time, I want you to get rid of the confirmation pop up."
  //
  // Removed. The two actions are terminal in the same technical sense but not
  // in the same human sense, and that distinction is the whole justification:
  //
  //   MARK PICKED UP is the SUCCESS path. It is pressed while the customer is
  //   standing at the counter with the bag in their hand, so by the time it is
  //   pressed the fact it records has already happened in the real world. A
  //   dialog cannot prevent a mistake that is already true, and it is pressed
  //   often enough to be answered from muscle memory — which is precisely the
  //   state in which a confirmation stops protecting anything and becomes one
  //   more thing between a budtender and a queue.
  //
  //   CANCEL ON LEAFLY destroys a sale, is pressed rarely, and is the only
  //   one of the two whose consequence has NOT already happened when the
  //   button is pressed. It keeps its dialog. The owner asked for the pickup
  //   popup to go; deleting the cancel guard as well would be reading an
  //   instruction wider than it was given.
  //
  // Following L-30: the protection is RELOCATED, not deleted. The terminal
  // warning for picked up is now printed next to the button (see
  // `terminalNote` below) where it is legible before the press instead of
  // interrupting it.
  const needsConfirm = isCancel;

  const hiddenFields = (
    <>
      <input type="hidden" name="leaflyOrderId" value={leaflyOrderId} />
      {/* SLICE L-32: `!isAck` alone used to be the guard. It is now
          `action.kind === "status"`, stated positively, because the reconcile
          action is also "not an acknowledge" and must NOT post a nextStatus —
          it sends nothing to Leafly at all. */}
      {action.kind === "status" && action.status ? (
        <input type="hidden" name="nextStatus" value={action.status} />
      ) : null}
      {/* No cancelationReasonCode is posted. Leafly documents that an absent
          reason defaults to `dispensary`, and sending a value we were told we
          do not need to send would be inventing data. The default is DISPLAYED
          in the confirmation instead, so it is informed rather than hidden. */}
    </>
  );

  // ── The ordinary case, and now the acknowledge case: a plain form ────────
  // No onSubmit. Nothing to intercept it. This is the shape the whole
  // back office uses, and the shape PendingKeeper is built for.
  if (!needsConfirm) {
    // SLICE L-31 — the relocated protection for "Mark picked up".
    //
    // It lost its dialog above; it must not lose the warning the dialog was
    // carrying. Rendered BEFORE the button in DOM order so a screen reader
    // reaches it first, and `title` so it is available on hover too.
    // SLICE L-32: `action.kind === "status"` rather than `!isAck`. The
    // reconcile action is never irreversible, so this could not fire for it
    // today — but relying on that would make the guard correct by accident.
    const terminalNote =
      action.irreversible && action.kind === "status" ? (
        <span
          data-testid={`leafly-terminal-note-${action.status ?? "unknown"}`}
          className="mr-2 text-[11px] leading-tight text-[var(--admin-gold)]"
        >
          <span aria-hidden className="mr-1">
            ⚠️
          </span>
          Final step — Leafly will not let this order move again.
        </span>
      ) : null;

    return (
      <form
        ref={formRef}
        action={formAction}
        className="inline-flex items-center"
      >
        {hiddenFields}
        {terminalNote}
        <SubmitButton action={action} />
      </form>
    );
  }

  // ── Terminal status changes: ask first, then submit exactly once ─────────
  return (
    <>
      <form
        ref={formRef}
        action={statusAction}
        className="inline"
      >
        {hiddenFields}
        {/* type="button": pressing this does NOT submit. It opens the
            question. The form submits once, later, from onConfirm. */}
        <SubmitButton
          action={action}
          type="button"
          onClick={() => setConfirming(true)}
        />
      </form>

      <ConfirmDialog
        open={confirming}
        title={
          isCancel
            ? "Cancel this order on Leafly?"
            : `${action.label}?`
        }
        description={
          isCancel
            ? `This tells Leafly the order is cancelled and notifies the shopper. Leafly does not allow a cancelled order to be moved again. Leafly will record the reason as “${defaultCancelReasonLabel}”.`
            : "Leafly does not allow an order to be moved again once it reaches this status."
        }
        confirmLabel={action.label}
        cancelLabel="Not yet"
        tone={isCancel ? "danger" : "warning"}
        onConfirm={() => {
          // Close first, then submit. There is no permission flag to grant:
          // the form has no onSubmit to talk out of cancelling, because it
          // never cancels anything. This is the whole point of L-30.
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function LeaflyOrderActions({
  actions,
  leaflyOrderId,
  acknowledgeAction,
  statusAction,
  reconcileAction,
  irreversibleWarning,
  defaultCancelReasonLabel,
}: {
  actions: PlannedAction[];
  leaflyOrderId: string;
  acknowledgeAction: (formData: FormData) => void | Promise<void>;
  statusAction: (formData: FormData) => void | Promise<void>;
  /** SLICE L-32 — the safe re-read offered when this screen and Leafly disagree. */
  reconcileAction: (formData: FormData) => void | Promise<void>;
  irreversibleWarning: string;
  defaultCancelReasonLabel: string;
}) {
  if (actions.length === 0) return null;

  // SLICE L-30 — the warning the dialog used to carry, now standing on the
  // screen instead of interrupting it.
  //
  // This is not a downgrade of the protection, it is a relocation of it. A
  // modal is answered from muscle memory after the third time you see it; a
  // sentence sitting next to the button is legible every time the operator
  // looks at the order, INCLUDING before they have decided to press anything.
  // It is rendered ABOVE the buttons for the same reason the detail panel is
  // rendered above the clock (see LeaflyOrdersPanel): an instruction to read
  // the ID first only works if it appears before the control that ends your
  // ability to.
  //
  // The text is `LEAFLY_ACK_IRREVERSIBLE_WARNING`, passed in unchanged from
  // the core, where its content is asserted in CI. It is deliberately the
  // SAME STRING the dialog used, so nothing the owner already learned to
  // recognise has changed wording.
  const showAckWarning = actions.some(
    (a) => a.kind === "acknowledge" && a.irreversible,
  );

  // SLICE L-32 — say WHY the expected button is missing.
  //
  // An operator who acknowledged an order and then came back to find no
  // "Confirm order" button, and no explanation, would reasonably conclude the
  // screen is broken — which is the same loss of trust the planner's own
  // header comment warns about. So the repair state explains itself in the
  // operator's terms before they press anything.
  const showStaleNotice = actions.some((a) => a.kind === "reconcile");

  return (
    <div className="flex flex-col items-end gap-2">
      {showAckWarning ? (
        <p
          // role="note" rather than "alert": it must not be announced as an
          // interruption every render, but it must be reachable and obviously
          // not decoration.
          role="note"
          data-testid="leafly-ack-warning"
          className="max-w-[34rem] text-right text-xs leading-relaxed text-[var(--admin-gold)]"
        >
          <span aria-hidden className="mr-1">
            ⚠️
          </span>
          {irreversibleWarning}
        </p>
      ) : null}
      {showStaleNotice ? (
        <p
          role="note"
          data-testid="leafly-stale-confirm-notice"
          className="max-w-[34rem] text-right text-xs leading-relaxed text-[var(--admin-gold)]"
        >
          <span aria-hidden className="mr-1">
            ⚠️
          </span>
          {LEAFLY_STALE_CONFIRM_NOTICE}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions.map((action) => (
          <ActionForm
            key={`${action.kind}:${action.status ?? "ack"}`}
            action={action}
            leaflyOrderId={leaflyOrderId}
            acknowledgeAction={acknowledgeAction}
            statusAction={statusAction}
            reconcileAction={reconcileAction}
            defaultCancelReasonLabel={defaultCancelReasonLabel}
          />
        ))}
      </div>
    </div>
  );
}
