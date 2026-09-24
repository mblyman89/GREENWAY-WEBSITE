/**
 * tests/compliance/leafly-l31-dialog-render.test.tsx
 *
 * SLICE L-31 — WHICH BUTTONS OPEN A DIALOG? RENDER THEM AND LOOK.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS, AND IT IS NOT A GOOD REASON
 * ===========================================================================
 * L-30 protected its central property — "the acknowledge button never opens a
 * dialog" — with a SOURCE-PATTERN assertion:
 *
 *     expect(actionsCode).toMatch(/const needsConfirm = action\.irreversible && !isAck/)
 *
 * When L-31 narrowed that rule to `= isCancel`, the test failed. Good: it
 * made somebody stop and think. So the assertion was rewritten to check the
 * PROPERTY instead of the spelling — parse out the right-hand side of
 * `needsConfirm`, and require that it either never mentions acknowledge or
 * explicitly negates it.
 *
 * That rewrite was then mutation-tested before being accepted, by putting
 * `const needsConfirm = action.irreversible;` into the component — which
 * REINTRODUCES THE ACKNOWLEDGE DIALOG, the exact defect L-30 spent a slice
 * removing.
 *
 * ****  THE MUTATION SURVIVED. THE SUITE STAYED GREEN AT 51/51.  ****
 *
 * The heuristic was unsound: `action.irreversible` does not mention "isAck"
 * or "acknowledge", so it passed the "never mentions acknowledge" arm — while
 * being true for the acknowledge action at runtime, because acknowledging IS
 * irreversible. A clever-looking source check had silently stopped protecting
 * anything.
 *
 * That is the L-29 failure mode returning in new clothes: a test that passes
 * for a reason unrelated to the behaviour. The lesson is worth more than the
 * fix, so it is written down rather than quietly corrected:
 *
 *     A RULE ABOUT WHAT THE UI DOES CANNOT BE PROVEN BY READING THE SOURCE.
 *     RENDER IT AND LOOK AT THE OUTPUT.
 *
 * So this file renders the real component with real planned actions and
 * asserts on the MARKUP. `renderToStaticMarkup` is the house pattern (see
 * leafly-helper-render.test.tsx): element in, string out, no jsdom, no
 * browser, no `window`.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 * ------------------------------
 * CAN: that a dialog element is or is not in the initial markup for a given
 *      action; that the button is a submit or a plain button; that the
 *      relocated warning text is actually present for a reader to see.
 * CANNOT: that clicking works, that the dialog animates, or that focus moves
 *      correctly. Those need a real browser, and L-30's
 *      `scripts/recon/l30-real-click-probe.mjs` is where that lives.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeaflyOrderActions } from "@/components/admin/orders/LeaflyOrderActions";
import {
  planLeaflyOrderActions,
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
} from "@/lib/leafly/order-ack-core";

/**
 * Render the real panel for one board state.
 *
 * Deliberately drives it through `planLeaflyOrderActions()` rather than
 * hand-built action objects: a fixture that invents its own `irreversible`
 * flag would be testing the fixture, and the whole point of this file is that
 * the component's behaviour must follow from the real plan.
 */
function renderFor(input: {
  acknowledgedAt: string | null;
  leaflyStatus: string | null;
}): string {
  const plan = planLeaflyOrderActions({
    leaflyOrderId: "11111111-2222-3333-4444-555555555555",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: input.acknowledgedAt,
    leaflyStatus: input.leaflyStatus,
    fulfillmentMechanism: "pickup",
  });

  // A state that produced no actions would make every assertion below
  // vacuously true, which is precisely the inert-test trap.
  expect(plan.actions.length, "fixture must produce at least one action").toBeGreaterThan(0);

  const noop = () => {};
  return renderToStaticMarkup(
    <LeaflyOrderActions
      actions={plan.actions}
      leaflyOrderId="11111111-2222-3333-4444-555555555555"
      acknowledgeAction={noop}
      statusAction={noop}
      irreversibleWarning={LEAFLY_ACK_IRREVERSIBLE_WARNING}
      defaultCancelReasonLabel="Store cancelled"
    />,
  );
}

/**
 * Does this markup contain a confirmation dialog?
 *
 * ConfirmDialog renders nothing at all when `open` is false, so its ABSENCE
 * from static markup is exactly the signal we want: a dialog that would only
 * appear after a click is, correctly, not here. What we are detecting is a
 * dialog rendered for a button that should not have one — and the reliable
 * tell is the button's own `type`.
 */
function hasConfirmFirstButton(html: string, label: string): boolean {
  // A confirm-first action renders `type="button"`; a direct action renders
  // `type="submit"`. Find the button bearing this label and read its type.
  const idx = html.indexOf(label);
  if (idx === -1) return false;
  // Walk back to the opening tag of the control that carries the label.
  const before = html.slice(0, idx);
  const tagStart = Math.max(before.lastIndexOf("<button"), before.lastIndexOf("<Button"));
  if (tagStart === -1) return false;
  const tag = html.slice(tagStart, idx);
  return /type="button"/.test(tag);
}

describe("L-31 · which actions open a dialog (rendered, not read)", () => {
  it("ACKNOWLEDGE renders as a direct submit, never a confirm-first button", () => {
    // THE REGRESSION THAT ESCAPED THE SOURCE CHECK. With
    // `needsConfirm = action.irreversible`, acknowledge becomes confirm-first
    // and this assertion fails — as it must.
    const html = renderFor({ acknowledgedAt: null, leaflyStatus: "pending" });

    const plan = planLeaflyOrderActions({
      leaflyOrderId: "11111111-2222-3333-4444-555555555555",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: null,
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });
    const ack = plan.actions.find((a) => a.kind === "acknowledge");
    expect(ack, "this state must offer an acknowledge action").toBeTruthy();

    // The acknowledgement IS irreversible — that is not in dispute, and the
    // warning must still be on screen. What must NOT happen is a dialog.
    expect(ack!.irreversible).toBe(true);
    expect(hasConfirmFirstButton(html, ack!.label)).toBe(false);
    expect(html).toContain('type="submit"');

    // The relocated protection must be visible to a reader.
    expect(html).toContain("leafly-ack-warning");
  });

  it("MARK PICKED UP renders as a direct submit — the popup the owner killed", () => {
    // The owner: "the mark picked up button produces a popup asking to
    // confirm the action... I want you to get rid of the confirmation pop up."
    const html = renderFor({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "ready",
    });

    expect(html).toContain("Mark picked up");
    expect(hasConfirmFirstButton(html, "Mark picked up")).toBe(false);

    // ...and the warning it used to carry is now standing text beside it.
    expect(html).toContain("leafly-terminal-note-picked_up");
    expect(html).toContain("Final step");
  });

  it("CANCEL ON LEAFLY still opens a dialog — the instruction was not that wide", () => {
    // Cancel destroys a sale, is pressed rarely, and unlike a pickup its
    // consequence has NOT already happened when the button is pressed.
    // Removing this guard too would be reading the request wider than given.
    const html = renderFor({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "ready",
    });

    expect(html).toContain("Cancel on Leafly");
    expect(hasConfirmFirstButton(html, "Cancel on Leafly")).toBe(true);
  });

  it("exactly ONE action on the board is confirm-first", () => {
    // Guards the property from both directions at once: if a future change
    // makes everything confirm-first (or nothing), this fails even if the
    // individual assertions above are somehow satisfied.
    const html = renderFor({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "ready",
    });
    const confirmFirst = (html.match(/type="button"/g) ?? []).length;
    expect(confirmFirst).toBe(1);
  });
});
