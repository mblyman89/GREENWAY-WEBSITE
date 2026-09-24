/**
 * scripts/recon/l33-board-breakage-probe.mts — SLICE L-33
 *
 * ===========================================================================
 * THE CLAIM THIS PROBE EXISTS TO PROVE OR DESTROY
 * ===========================================================================
 * I claimed, from reading `planLeaflyOrderActions()`, that auto-acknowledging
 * every arriving order will make L-32's stale-confirm rule fire on EVERY
 * order — replacing the owner's normal "Confirm order" workflow with a
 * diagnostic button for a failure that never happened.
 *
 * L-31's permanent lesson, paid for over eight slices:
 *
 *     A rule about what the UI does cannot be proven by reading the source.
 *     Render it and look at the output.
 *
 * So this does not read. It EXECUTES the real planner — the same function the
 * real board calls — against the exact row shape auto-acknowledge will create,
 * and prints the buttons a budtender would actually see.
 *
 * Run BEFORE the fix: it must print the breakage (and exit 0, because at that
 * point the breakage is the expected finding).
 * Run AFTER the fix: the assertions are inverted to pin the repair.
 *
 * Usage:  npx tsx scripts/recon/l33-board-breakage-probe.mts
 */
import {
  planLeaflyOrderActions,
  type PlannedAction,
} from "../../src/lib/leafly/order-ack-core";

let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? `  [${detail}]` : ""}`);
  }
}

function line(title: string): void {
  console.log(`\n${"═".repeat(76)}\n${title}\n${"═".repeat(76)}\n`);
}

function describe(actions: PlannedAction[]): string {
  if (actions.length === 0) return "(no buttons at all)";
  return actions
    .map((a) => `${a.label}${a.emphasis === "primary" ? " [PRIMARY]" : ""}`)
    .join(" | ");
}

line("SLICE L-33 — WILL AUTO-ACKNOWLEDGE BREAK THE BOARD?");

// ─────────────────────────────────────────────────────────────────────────────
// STATE 1 — the state auto-acknowledge will create on EVERY order.
//
// This is not a hypothetical. After L-33 the webhook acknowledges on arrival
// and deliberately does NOT confirm (the owner: "It can't be acknowledge and
// confirm in the same step though."). Leafly's own status therefore stays
// `pending` until a human decides. So every healthy order rests here.
// ─────────────────────────────────────────────────────────────────────────────
// ── A NOTE ON THIS FIXTURE, BECAUSE THE FIRST VERSION OF IT WAS WRONG ───────
// The first draft passed `{ acknowledgedAt, leaflyStatus, localOrderId }` —
// two real fields and one that does not exist — and omitted the two that are
// REQUIRED: `leaflyOrderId` and `orderIntegrationKeyPresent`. The planner
// correctly refused with "This record has no Leafly order id", produced no
// buttons at all, and the probe reported six failures.
//
// Read carelessly, that looks like proof of an even worse breakage. It is
// nothing of the sort: it is a broken instrument measuring itself. Had I taken
// that output as the finding, I would have "fixed" a defect that does not
// exist and built the slice on a fiction.
//
// L-31's lesson was that probes must execute rather than read. Its companion,
// learned the hard way in L-30 when a probe pointed the owner at a code fault
// while his Pi sat unplugged:
//
//     A PROBE IS SOFTWARE AND CAN BE WRONG IN EXACTLY THE WAY THE CODE IT
//     AUDITS CAN BE WRONG. "Test the tests" includes testing the instruments.
//
// Fixture now matches the real signature of `planLeaflyOrderActions`, verified
// by reading it, and TypeScript now type-checks this file so the same mistake
// becomes a compile error rather than a misleading result.
const autoAcknowledged = {
  leaflyOrderId: "ord-l33-normal",
  orderIntegrationKeyPresent: true,
  acknowledgedAt: "2026-09-24T10:00:00.000Z",
  leaflyStatus: "pending",
  fulfillmentMechanism: "pickup",
};

const planned = planLeaflyOrderActions(autoAcknowledged);

console.log("THE NORMAL POST-L-33 ORDER — acknowledged by the machine,");
console.log("deliberately not confirmed, waiting for a human:\n");
console.log(`  row      : acknowledged_at=set, leafly_status="pending"`);
console.log(`  buttons  : ${describe(planned.actions)}`);
console.log(`  blocked  : ${planned.blockedReason || "(nothing)"}\n`);

const kinds = planned.actions.map((a) => a.kind);
const labels = planned.actions.map((a) => a.label);

// ─────────────────────────────────────────────────────────────────────────────
// THE ASSERTIONS.
//
// Written to describe the REPAIRED world, so this probe is RED until L-33's
// fix lands and GREEN afterwards. The pre-fix output is preserved verbatim
// below, exactly as the L-32 probe preserved its own.
// ─────────────────────────────────────────────────────────────────────────────
line("WHAT THE BUDTENDER MUST SEE ON A NORMAL AUTO-ACKNOWLEDGED ORDER");

check(
  "the board offers a real next step, not a diagnostic",
  kinds.includes("status"),
  `kinds=${JSON.stringify(kinds)}`,
);

check(
  "'Confirm order' is available — this is the owner's whole workflow",
  labels.some((l) => /confirm/i.test(l)),
  `labels=${JSON.stringify(labels)}`,
);

check(
  "the stale-confirm repair button is NOT forced onto a healthy order",
  !kinds.includes("reconcile"),
  kinds.includes("reconcile")
    ? "THE BREAKAGE: every healthy order is being treated as a failure"
    : "",
);

check(
  "the operator is not blocked from acting",
  planned.blockedReason === "",
  planned.blockedReason,
);

// ─────────────────────────────────────────────────────────────────────────────
// STATE 2 — the state L-32 was actually built for must STILL be caught.
//
// A fix that simply deletes the stale rule would pass every assertion above
// and silently undo last slice's work. The genuine failure — a confirm push
// that was attempted and REJECTED — must still produce the repair button.
// ─────────────────────────────────────────────────────────────────────────────
line("...AND THE REAL FAILURE L-32 FIXED MUST STILL BE CAUGHT");

const genuinelyStale = {
  leaflyOrderId: "ord-l33-stale",
  orderIntegrationKeyPresent: true,
  acknowledgedAt: "2026-09-24T10:00:00.000Z",
  leaflyStatus: "pending",
  fulfillmentMechanism: "pickup",
  // The discriminator this slice introduces: a recorded, failed confirm push.
  // Not inferred from the status columns — those can no longer tell the two
  // states apart, because after L-33 they are identical in both.
  confirmPushFailed: true,
};

// `confirmPushFailed` is a real field on the input type as of this slice, so
// this fixture is fully type-checked with no cast. The pre-fix run used a
// narrowed cast purely so the baseline could be recorded before the field
// existed; it has been removed now that the type carries it.


const stalePlan = planLeaflyOrderActions(genuinelyStale);
console.log(`  row      : acknowledged + pending + a RECORDED failed confirm push`);
console.log(`  buttons  : ${describe(stalePlan.actions)}\n`);

check(
  "a recorded push failure still offers the repair",
  stalePlan.actions.some((a) => a.kind === "reconcile"),
  `kinds=${JSON.stringify(stalePlan.actions.map((a) => a.kind))}`,
);

check(
  "and the repair is still the primary thing to do",
  stalePlan.actions.some((a) => a.kind === "reconcile" && a.emphasis === "primary"),
);

check(
  "the repair still sends nothing to Leafly",
  stalePlan.actions.every((a) => a.kind !== "reconcile" || a.status === null),
);

// ─────────────────────────────────────────────────────────────────────────────
// STATE 3 — a brand new order must be unaffected in either world.
// ─────────────────────────────────────────────────────────────────────────────
line("AND A BRAND-NEW UNACKNOWLEDGED ORDER IS UNCHANGED");

const fresh = planLeaflyOrderActions({
  leaflyOrderId: "ord-l33-fresh",
  orderIntegrationKeyPresent: true,
  acknowledgedAt: null,
  leaflyStatus: "pending",
  fulfillmentMechanism: "pickup",
});
console.log(`  buttons  : ${describe(fresh.actions)}\n`);

check(
  "an unacknowledged order still offers the acknowledge action",
  fresh.actions.some((a) => a.kind === "acknowledge"),
  `kinds=${JSON.stringify(fresh.actions.map((a) => a.kind))}`,
);

check(
  "...and is never diverted into the repair path",
  !fresh.actions.some((a) => a.kind === "reconcile"),
);

// ═══════════════════════════════════════════════════════════════════════════
// THE PRE-FIX OUTPUT, PRESERVED VERBATIM.
//
// Recorded on the L-32 baseline (main @ 4241126f) BEFORE any L-33 code was
// written, by running this exact file. Kept because a probe whose defect has
// been repaired otherwise loses the evidence that the defect was ever real —
// which is how a fix quietly becomes folklore.
//
//   THE NORMAL POST-L-33 ORDER — acknowledged by the machine,
//   deliberately not confirmed, waiting for a human:
//
//     row      : acknowledged_at=set, leafly_status="pending"
//     buttons  : Check this order with Leafly [PRIMARY]
//     blocked  : (nothing)
//
//     ❌ the board offers a real next step, not a diagnostic  [kinds=["reconcile"]]
//     ❌ 'Confirm order' is available — this is the owner's whole workflow
//     ❌ the stale-confirm repair button is NOT forced onto a healthy order
//        [THE BREAKAGE: every healthy order is being treated as a failure]
//
// One button. The wrong one. On every order that ever arrives.
// ═══════════════════════════════════════════════════════════════════════════

line(failed === 0 ? "PROBE: PASSED" : "PROBE: FAILED");
console.log(`  checks failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
