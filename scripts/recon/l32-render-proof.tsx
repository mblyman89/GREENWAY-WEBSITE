/**
 * scripts/recon/l32-render-proof.mts
 *
 * SLICE L-32 — DOES THE REPAIR BUTTON ACTUALLY RENDER, AND DOES IT POST TO
 * THE RIGHT PLACE?
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * L-31 cost a slice to learn this, and the lesson was written down:
 *
 *   "A rule about what the UI does cannot be proven by reading the source.
 *    Render it and look at the output."
 *
 * In L-31 a 51-assertion suite that READ the component stayed green while the
 * component misbehaved, because reading source proves what the code says, not
 * what it does. The planner self-tests already prove the ACTION is produced.
 * They cannot prove a human can see it or press it.
 *
 * The specific hazard here is real and was nearly shipped: the form used to
 * choose its destination with `isAck ? acknowledgeAction : statusAction`. A
 * new third kind falls into the `else` of a two-way ternary silently. The
 * button would have rendered perfectly and posted to the STATUS action, which
 * requires a `nextStatus` the repair action deliberately does not send — so
 * the cure for the owner's error would have produced a fresh error.
 *
 * So: render it to HTML, and look at the output.
 */

import { renderToStaticMarkup } from "react-dom/server";
import {
  planLeaflyOrderActions,
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  LEAFLY_RECONCILE_ACTION_LABEL,
  LEAFLY_STALE_CONFIRM_NOTICE,
} from "../../src/lib/leafly/order-ack-core";
import { LeaflyOrderActions } from "../../src/components/admin/orders/LeaflyOrderActions";

let failures = 0;

function head(title: string): void {
  console.log("\n" + "═".repeat(75));
  console.log(title);
  console.log("═".repeat(75) + "\n");
}

function ok(cond: boolean, msg: string, detail = ""): boolean {
  if (cond) {
    console.log(`  ✅ ${msg}${detail ? `  [${detail}]` : ""}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${msg}${detail ? `  [${detail}]` : ""}`);
  }
  return cond;
}

const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const ACK_AT = "2025-09-24T04:00:00.000Z";

/**
 * ── AN HONEST LIMITATION, STATED RATHER THAN PAPERED OVER ──────────────────
 *
 * A first draft of this probe gave each action a distinctly NAMED function,
 * intending to read the destination back out of the rendered HTML. Running it
 * proved that does not work: React's server renderer replaces every function
 * form action with the same placeholder —
 *
 *   action="javascript:throw new Error('React form unexpectedly submitted.')"
 *
 * — so the markup is byte-identical whether the form was wired to the right
 * action or the wrong one. The idea was therefore abandoned rather than kept
 * as a check that looks meaningful and proves nothing. That is precisely the
 * inert-assertion failure L-31 was lost to, and writing it down is cheaper
 * than rediscovering it.
 *
 * WHAT THIS PROBE DOES PROVE: the button exists, is labelled, is pressable,
 * carries the order id, carries NO nextStatus, and is accompanied by its
 * explanation — and that none of that leaks into the healthy states.
 *
 * WHERE THE WIRING IS PROVEN INSTEAD (two independent mechanisms):
 *   1. THE TYPE SYSTEM. `reconcileAction` is a REQUIRED prop. Omitting it is
 *      a compile error — verified, not assumed: adding it broke
 *      tests/compliance/leafly-l31-dialog-render.test.tsx with TS2741 until
 *      that call site was updated.
 *   2. A BOUNDED SOURCE ASSERTION over the `formAction` selection itself, in
 *      tests/compliance/leafly-l32-stale-confirm.test.ts, which pins that the
 *      reconcile kind routes to `reconcileAction` and not to `statusAction`.
 */
function markers() {
  const noop = () => {};
  return { ack: noop, status: noop, reconcile: noop };
}

function renderFor(leaflyStatus: string, acknowledgedAt: string | null): string {
  const plan = planLeaflyOrderActions({
    leaflyOrderId: ORDER_ID,
    orderIntegrationKeyPresent: true,
    acknowledgedAt,
    leaflyStatus,
    fulfillmentMechanism: "pickup",
  });
  if (plan.actions.length === 0) {
    throw new Error(
      `fixture "${leaflyStatus}" produced no actions — the probe would be vacuous`,
    );
  }
  const m = markers();
  return renderToStaticMarkup(
    <LeaflyOrderActions
      actions={plan.actions}
      leaflyOrderId={ORDER_ID}
      acknowledgeAction={m.ack}
      statusAction={m.status}
      reconcileAction={m.reconcile}
      irreversibleWarning={LEAFLY_ACK_IRREVERSIBLE_WARNING}
      defaultCancelReasonLabel="Store cancelled"
    />,
  );
}

// ===========================================================================
head("STEP 1 — THE STALE STATE RENDERS THE REPAIR BUTTON, VISIBLY");
// ===========================================================================

const stale = renderFor("pending", ACK_AT);
console.log("  ── rendered HTML ──");
console.log("  " + stale.replace(/></g, ">\n  <"));
console.log();

ok(
  stale.includes(LEAFLY_RECONCILE_ACTION_LABEL),
  "the repair button's LABEL is present in the rendered output",
  LEAFLY_RECONCILE_ACTION_LABEL,
);

ok(
  !stale.includes("Confirm order"),
  "the 'Confirm order' button that produced the 400 is NOT rendered",
);

ok(
  !stale.includes('name="nextStatus"'),
  "no nextStatus is posted from this state — nothing can be pushed to Leafly",
);

ok(
  stale.includes(`value="${ORDER_ID}"`),
  "the order id IS posted, so the repair knows which order to re-read",
);

// ===========================================================================
head("STEP 2 — THE EXPLANATION IS ON SCREEN, NOT JUST IN OUR HEADS");
// ===========================================================================
//
// A missing button with no explanation reads as a broken page. The notice is
// the difference between "the screen is helping me" and "the screen is
// broken", and it is the thing the owner will actually read at 9pm.

ok(
  stale.includes("leafly-stale-confirm-notice"),
  "the explanatory notice is rendered with its stable test id",
);

// Checked on a distinctive fragment rather than the whole string, because the
// full constant contains curly quotes that HTML-escape in the output.
ok(
  stale.includes("this screen and Leafly may disagree"),
  "…and it explains the disagreement in the operator's own terms",
);

ok(
  !stale.includes("Final step"),
  "no irreversibility warning is shown — the repair takes nothing away",
);

// ===========================================================================
head("STEP 3 — THE HEALTHY STATE IS UNCHANGED");
// ===========================================================================
//
// The fix must be confined to the broken state. If it leaked into the normal
// path it would be a regression wearing a fix's clothes.

const healthy = renderFor("confirmed", ACK_AT);
console.log("  ── rendered HTML (confirmed) ──");
console.log("  " + healthy.replace(/></g, ">\n  <"));
console.log();

ok(
  healthy.includes("Mark ready for pickup"),
  "a healthy confirmed order still offers 'Mark ready for pickup'",
);
ok(
  !healthy.includes(LEAFLY_RECONCILE_ACTION_LABEL),
  "…and does NOT show the repair button",
);
ok(
  !healthy.includes("leafly-stale-confirm-notice"),
  "…nor the stale notice",
);
ok(
  healthy.includes('name="nextStatus"'),
  "…and it still posts a nextStatus, so the normal path is intact",
);

// ===========================================================================
head("STEP 4 — THE UNACKNOWLEDGED STATE IS UNCHANGED");
// ===========================================================================
//
// `pending` with NO acknowledgement is the ordinary new order. It must still
// get the acknowledge button — the stale-state rule keys on the PAIR of
// facts, and if it keyed on the status alone it would break every new order
// that arrives.

const fresh = renderFor("pending", null);
ok(
  fresh.includes("Acknowledge to Leafly"),
  "a brand-new unacknowledged order still offers 'Acknowledge to Leafly'",
);
ok(
  !fresh.includes(LEAFLY_RECONCILE_ACTION_LABEL),
  "…and is NOT diverted into the repair path",
  "proves the rule keys on acknowledged+pending, not on pending alone",
);

// ===========================================================================
head(failures === 0 ? "RENDER PROOF: PASSED" : "RENDER PROOF: FAILED");
// ===========================================================================
console.log(`  checks failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
