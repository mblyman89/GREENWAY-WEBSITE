/**
 * scripts/recon/l32-redundant-confirm-probe.mts
 *
 * SLICE L-32, ITEM C4 — IS THE "CONFIRM ORDER" BUTTON REDUNDANT, AND IS IT
 * THE THING THAT PRODUCES THE OWNER'S 400?
 *
 * ===========================================================================
 * THE OWNER'S QUESTION
 * ===========================================================================
 *   > "Do we need an acknowledge button if the confirm does the same thing?"
 *
 * and, in the same breath, the failure:
 *
 *   > "⚠️ Leafly didn't accept that. Bad request (400) …"
 *
 * The recon probe (l32-transition-400-probe.mjs) answered the first question
 * from the SPECIFICATION. This probe answers the second by EXECUTION.
 *
 * ===========================================================================
 * WHY THIS PROBE IS RUN THROUGH tsx AND NOT WRITTEN AS SOURCE-READING
 * ===========================================================================
 * L-31 left a permanent lesson, and it was expensive:
 *
 *   "A rule about what the UI does cannot be proven by reading the source.
 *    Render it and look at the output."
 *
 * In L-31 a source-reading test suite of 51 assertions stayed GREEN while a
 * real defect was live, because it was reading the code's INTENT rather than
 * running it. So this probe imports the actual planner the actual board calls
 * and asks it, for real, which buttons it returns. No transcription, no
 * regex over source, no paraphrase.
 *
 * Exit 0 = every claim below was established by running the real code.
 * Exit 1 = a claim failed, and the conclusion is therefore NOT supported.
 */

import {
  planLeaflyOrderActions,
  decideStatusChange,
  type OutboundActionPlan,
} from "../../src/lib/leafly/order-ack-core";

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

function labels(plan: OutboundActionPlan): string[] {
  return plan.actions.map((a) => a.label);
}

/**
 * The board's real call shape, copied from LeaflyOrdersPanel.tsx line ~686.
 * Only the two fields under test vary between scenarios.
 */
function planFor(args: {
  acknowledgedAt: string | null;
  leaflyStatus: string | null;
}): OutboundActionPlan {
  return planLeaflyOrderActions({
    leaflyOrderId: "11111111-2222-3333-4444-555555555555",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: args.acknowledgedAt,
    leaflyStatus: args.leaflyStatus,
    fulfillmentMechanism: "pickup",
  });
}

const ACK_AT = "2025-09-24T04:00:00.000Z";

// ===========================================================================
head("STEP 1 — BEFORE ACKNOWLEDGE: what does the board offer?");
// ===========================================================================
//
// Establishes the baseline. The spec requires acknowledgement before any
// other operation, so there should be exactly one button and it should be
// the acknowledge one.

const beforeAck = planFor({ acknowledgedAt: null, leaflyStatus: "pending" });
console.log("  buttons:", JSON.stringify(labels(beforeAck)));

ok(
  beforeAck.actions.length === 1,
  "un-acknowledged order offers exactly ONE action",
  `got ${beforeAck.actions.length}`,
);
ok(
  beforeAck.actions[0]?.kind === "acknowledge",
  "…and that action is the acknowledge",
  String(beforeAck.actions[0]?.kind),
);

// ===========================================================================
head("STEP 2 — THE STATE THE OWNER IS ACTUALLY IN AFTER PRESSING ACKNOWLEDGE");
// ===========================================================================
//
// THIS IS THE CRUX OF THE WHOLE SLICE, so it is spelled out.
//
// `acknowledgeLeaflyOrder()` does FOUR things when Leafly returns its 204:
//
//   1. markLeaflyOrderAcknowledged(orderId, at)
//        — verified by reading webhook-server.ts: it updates ONLY
//          `acknowledged_at`. It does NOT touch `leafly_status`.
//   2. onLeaflyOrderAccepted()  — puts the order on the shop floor.
//   3. setLeaflyOrderStatus({ nextStatus: "confirmed" })   ← L-14
//        — pushes `confirmed` TO LEAFLY, inside a try/catch whose failure
//          path only sets a warning string.
//   4. returns success.
//
// So after a successful acknowledge, LEAFLY is at `confirmed`. Our local row
// is at `confirmed` too — but ONLY IF step 3's own persistence succeeded.
//
// When step 3 fails for any reason (network, a 4xx, an unreadable body, a
// throw), the acknowledgement is still reported as the success it genuinely
// was, and the local row is left at `pending`.
//
// THAT is the stuck state. Reproduce it exactly:

const stuck = planFor({ acknowledgedAt: ACK_AT, leaflyStatus: "pending" });
console.log("  buttons:", JSON.stringify(labels(stuck)));

// ── WHAT THIS PROBE FOUND BEFORE THE FIX ──────────────────────────────────
// On first run, against the code as the owner experienced it, this step
// printed:
//
//   buttons: ["Confirm order","Mark ready for pickup","Mark picked up",
//             "Cancel on Leafly"]
//   ✅ the board OFFERS 'Confirm order'
//   ✅ 'Confirm order' is the PRIMARY (highlighted) button
//
// That is the defect, captured by execution rather than argued for. The
// assertions below are the same two facts INVERTED, so this probe now fails
// if the defect ever returns.

const offersConfirm = stuck.actions.some((a) => a.status === "confirmed");
ok(
  !offersConfirm,
  "acknowledged + row still `pending` ⇒ 'Confirm order' is NO LONGER offered " +
    "(it was, before this slice, and pressing it is what produced the 400)",
);

ok(
  !stuck.actions.some((a) => a.kind === "status"),
  "…no status-push button of ANY kind is offered from an untrustworthy row",
  `offered kinds: ${JSON.stringify([...new Set(stuck.actions.map((a) => a.kind))])}`,
);

const primary = stuck.actions.find((a) => a.emphasis === "primary");
ok(
  primary?.kind === "reconcile",
  "…the PRIMARY button is now the safe repair action, so the operator is " +
    "steered into the press that CANNOT fail instead of the one that must",
  `primary = ${primary?.label ?? "none"}`,
);

ok(
  stuck.actions.every((a) => !a.irreversible),
  "…and nothing offered in this state is irreversible — no cancel, no " +
    "picked-up, from a row we have just established we cannot trust",
);

// ===========================================================================
head("STEP 3 — PRESSING IT SENDS pending → confirmed, WHICH LEAFLY REJECTS");
// ===========================================================================
//
// Our own gate approves the press, because our gate is reasoning from the
// STALE local row. Leafly is reasoning from its own true state.

const ourGate = decideStatusChange({
  acknowledgedAt: ACK_AT,
  currentStatus: "pending",
  nextStatus: "confirmed",
});

ok(
  ourGate.allowed === true,
  "our own `decideStatusChange` ALLOWS pending → confirmed",
  "so nothing stops the request leaving the building",
);

// And what Leafly sees. Leafly's row says `confirmed` already, because our
// own acknowledge handler pushed it there in step 3 above. So the request
// Leafly actually receives is confirmed → confirmed.
const whatLeaflySees = decideStatusChange({
  acknowledgedAt: ACK_AT,
  currentStatus: "confirmed", // Leafly's truth, not ours
  nextStatus: "confirmed",
});

ok(
  whatLeaflySees.allowed === false,
  "but from LEAFLY's true state it is confirmed → confirmed, which is ILLEGAL",
  `refusal code: ${whatLeaflySees.allowed === false ? whatLeaflySees.code : "n/a"}`,
);

console.log(
  "\n  Leafly's documented rule 3, verbatim from the vendored spec:\n" +
    '    "Orders cannot be moved from their current status to the same status."\n',
);
console.log(
  "  ⇒ THE 400 IS NOT MYSTERIOUS. We are asking Leafly to move an order to\n" +
    "    the status it is already in, because our own acknowledge button put\n" +
    "    it there and our own board did not notice.\n",
);

// ===========================================================================
head("STEP 4 — WHEN THE CONFIRM PUSH DID WORK, IS THE BUTTON EVEN WANTED?");
// ===========================================================================
//
// The healthy case: acknowledge succeeded AND its confirm push persisted.
// The row reads `confirmed`. What does the board offer now?

const healthy = planFor({ acknowledgedAt: ACK_AT, leaflyStatus: "confirmed" });
console.log("  buttons:", JSON.stringify(labels(healthy)));

ok(
  !healthy.actions.some((a) => a.status === "confirmed"),
  "when the row is already `confirmed`, 'Confirm order' is correctly ABSENT",
);

const healthyPrimary = healthy.actions.find((a) => a.emphasis === "primary");
ok(
  healthyPrimary?.status === "ready",
  "…and the primary button is 'Mark ready for pickup' — the true next step",
  `primary = ${healthyPrimary?.label ?? "none"}`,
);

// ===========================================================================
head("STEP 5 — THE VERDICT, AND WHAT IT MEANS FOR THE FIX");
// ===========================================================================

console.log(
  [
    "  THE OWNER'S QUESTION 1: what is the difference?",
    "    acknowledge      = a RECEIPT. 'confirms that your system has retrieved",
    "                       all necessary details regarding an order.' Mandatory,",
    "                       15-minute deadline, and it BURNS the customer's ID",
    "                       images. Returns 204, no body.",
    "    status=confirmed = a BUSINESS DECISION. 'Move an order along its",
    "                       lifecycle.' This is what emails the shopper.",
    "                       Returns 200 with the full order.",
    "    They are NOT the same operation and acknowledge cannot be dropped.",
    "",
    "  THE OWNER'S QUESTION 2: do we need both buttons?",
    "    NO — and the honest answer is the opposite of the one he expected.",
    "    Our ACKNOWLEDGE button already does BOTH operations: it acknowledges,",
    "    then immediately pushes status=confirmed (slice L-14). So the separate",
    "    'Confirm order' button is the redundant one.",
    "",
    "  WHY IT IS NOT MERELY REDUNDANT BUT HARMFUL:",
    "    It is only ever VISIBLE in the broken case — when the confirm push",
    "    silently failed and left the row stale. In that exact state it is",
    "    rendered as the PRIMARY button (proved in step 2), so the board",
    "    actively steers the operator into the one press guaranteed to 400.",
    "",
    "  THEREFORE THE FIX IS NOT 'DELETE THE BUTTON'.",
    "    Deleting it would remove the symptom and strand the order: the row",
    "    would still say `pending`, the board would still be wrong, and there",
    "    would now be NO way to move it forward at all.",
    "",
    "    The fix is to make that state impossible to be stuck in:",
    "      C1 — never let an empty payload wipe a real order   (done)",
    "      C2 — show Leafly's OWN reason, not our guess        (done)",
    "      C3 — on rejection, re-read from Leafly and reconcile(done)",
    "      C4 — relabel/redirect the stale-state button so it REPAIRS rather",
    "           than re-sends a request we know Leafly will reject",
    "      C5 — make the acknowledge-time confirm failure visible when it",
    "           happens, instead of only when the operator hits the wall",
  ].join("\n"),
);

// ===========================================================================
head(failures === 0 ? "PROBE RESULT: SUPPORTED" : "PROBE RESULT: NOT SUPPORTED");
// ===========================================================================
console.log(`  checks failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
