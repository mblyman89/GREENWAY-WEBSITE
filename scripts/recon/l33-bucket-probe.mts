/**
 * SLICE L-33 — DOES AUTO-ACKNOWLEDGE BREAK THE *BOARD BUCKETS* TOO?
 * ============================================================================
 *
 * `l33-board-breakage-probe.mts` asked that question of the BUTTONS
 * (`planLeaflyOrderActions`) and found a real, shipping-blocking defect: after
 * auto-acknowledge, every healthy order would have shown one wrong button.
 *
 * Finding one defect in one reader of `acknowledged_at` is not permission to
 * assume the other readers are fine. There are two more:
 *
 *   placeLeaflyOrder()  — which BUCKET the card sits in (bridge-core)
 *   lifecycleView()     — the "what do I do next" strip (lifecycle-core)
 *
 * Both branch on `acknowledgedAt`, and Slice L-33 changes that column for
 * every order that ever arrives. This probe EXECUTES both against the exact
 * states auto-acknowledge produces, rather than reading them and forming an
 * opinion. Reading code and predicting its output is how the first version of
 * the sibling probe produced six false failures.
 *
 * ── WHAT THIS PROBE IS FOR ─────────────────────────────────────────────────
 * It is NOT a test and it asserts almost nothing about what SHOULD happen. It
 * is an instrument: it prints what the real functions really do, so that a
 * claim written in `docs/l33-auto-acknowledge-facts.md` can be re-checked by
 * running one command instead of trusting a sentence.
 *
 * The one thing it DOES assert is the single fact the whole feature stands on
 * (see THE LOAD-BEARING CASE below), because that one is worth failing over.
 *
 * Run:  npx tsx scripts/recon/l33-bucket-probe.mts
 */

import { placeLeaflyOrder } from "../../src/lib/leafly/bridge-core";
import { lifecycleView } from "../../src/lib/leafly/lifecycle-core";

const ACK = "2026-09-24T10:00:00.000Z";

let failures = 0;
function expect(condition: boolean, what: string): void {
  if (condition) {
    console.log(`   ✅ ${what}`);
  } else {
    failures += 1;
    console.log(`   ❌ ${what}`);
  }
}

console.log("=".repeat(78));
console.log("PART 1 — placeLeaflyOrder(): which bucket does the card land in?");
console.log("=".repeat(78));

const buckets: Array<[string, Parameters<typeof placeLeaflyOrder>[0]]> = [
  [
    "BEFORE L-33 — fresh arrival, nobody has pressed Accept",
    {
      leaflyOrderId: "o1",
      leaflyStatus: "pending",
      acknowledgedAt: null,
      canceledAt: null,
      localOrderId: null,
      announcedAt: ACK,
      printedAt: ACK,
    },
  ],
  [
    "BEFORE L-33 — human pressed Accept: acked + confirmed + register order",
    {
      leaflyOrderId: "o1",
      leaflyStatus: "confirmed",
      acknowledgedAt: ACK,
      canceledAt: null,
      localOrderId: "loc-1",
      announcedAt: ACK,
      printedAt: ACK,
    },
  ],
  [
    "AFTER L-33 — auto-acked, still pending, register order CREATED  <-- the norm",
    {
      leaflyOrderId: "o1",
      leaflyStatus: "pending",
      acknowledgedAt: ACK,
      canceledAt: null,
      localOrderId: "loc-1",
      announcedAt: ACK,
      printedAt: ACK,
    },
  ],
  [
    "AFTER L-33 — auto-acked, still pending, NO register order  <-- the danger",
    {
      leaflyOrderId: "o1",
      leaflyStatus: "pending",
      acknowledgedAt: ACK,
      canceledAt: null,
      localOrderId: null,
      announcedAt: ACK,
      printedAt: ACK,
    },
  ],
];

for (const [label, input] of buckets) {
  const p = placeLeaflyOrder(input);
  console.log(`\n${label}`);
  console.log(`   bucket : ${p.bucket}`);
  console.log(`   action : ${p.action}`);
  console.log(`   warn   : ${p.pipelineWarning ?? "(none)"}`);
}

console.log(`
── READING THE ABOVE ────────────────────────────────────────────────────────
The 'accept_now' bucket empties out after L-33. That is the FEATURE, not a
regression: that bucket exists solely to shout "press Accept before Leafly
cancels", and auto-acknowledge removes the reason to shout.

THE LOAD-BEARING CASE is the difference between the last two. Both are
auto-acknowledged and pending; they differ only in whether the register order
exists. 'onLeaflyOrderAccepted()' creates it INSIDE acknowledgeLeaflyOrder(),
BEFORE the L-14 confirm block that Slice L-33 gates. So the gate must not move
earlier. If it ever did, every order would land in 'needs_attention' with a red
"it never reached the register" warning describing a failure that never
happened.
`);

console.log("=".repeat(78));
console.log("PART 2 — lifecycleView(): what does the card tell the operator to do?");
console.log("=".repeat(78));

const lives: Array<[string, Parameters<typeof lifecycleView>[0]]> = [
  [
    "BEFORE L-33 — unacknowledged, pending",
    { acknowledgedAt: null, leaflyStatus: "pending", fulfillmentMechanism: "pickup" },
  ],
  [
    "AFTER L-33 — auto-acked, pending  <-- the new normal",
    { acknowledgedAt: ACK, leaflyStatus: "pending", fulfillmentMechanism: "pickup" },
  ],
  [
    "AFTER L-33 — human then confirmed it",
    { acknowledgedAt: ACK, leaflyStatus: "confirmed", fulfillmentMechanism: "pickup" },
  ],
];

for (const [label, input] of lives) {
  const v = lifecycleView(input);
  console.log(`\n${label}`);
  console.log(`   phase    : ${v.phase}`);
  console.log(`   headline : ${v.headline}`);
  console.log(`   next     : ${v.nextLabel ?? "(none)"} -> ${v.nextStatus ?? "(none)"}`);
  console.log(`   progress : ${v.progress}`);
  console.log(`   steps    : ${v.steps.map((s) => `${s.label}=${s.state}`).join(" | ")}`);
}

console.log(`
── READING THE ABOVE ────────────────────────────────────────────────────────
lifecycleView ALREADY describes Slice L-33 correctly, and it was written before
Slice L-33 existed. L-31 separated "what is LEGAL" from "what is NEXT" and in
doing so modelled acknowledged-but-not-confirmed as a legitimate waypoint with
its own honest sentence. Nothing here was changed. Verifying that something
already works is a result, and it is cheaper than a rewrite nobody needed.
`);

console.log("=".repeat(78));
console.log("PART 3 — the assertions worth failing over");
console.log("=".repeat(78));
console.log();

// The healthy post-L-33 row must NOT be treated as a pipeline failure. This is
// the whole feature: if this flips, every order on the board turns red.
const healthy = placeLeaflyOrder({
  leaflyOrderId: "o1",
  leaflyStatus: "pending",
  acknowledgedAt: ACK,
  canceledAt: null,
  localOrderId: "loc-1",
  announcedAt: ACK,
  printedAt: ACK,
});
expect(
  healthy.bucket === "to_build",
  "the healthy auto-acknowledged order sits in 'to_build', ready to pick",
);
expect(
  healthy.pipelineWarning === null,
  "…and carries NO pipeline warning (nothing has gone wrong)",
);

// And the operator must still be told to confirm — the human step the owner
// explicitly kept for himself.
const next = lifecycleView({
  acknowledgedAt: ACK,
  leaflyStatus: "pending",
  fulfillmentMechanism: "pickup",
});
expect(
  next.nextStatus === "confirmed",
  "the next step offered is still 'confirmed' — the human decision is preserved",
);
expect(
  next.phase === "in_progress",
  "…and the order reads as in progress, not as awaiting acknowledgement",
);

console.log();
if (failures > 0) {
  console.log(`RESULT: ${failures} assertion(s) FAILED.`);
  process.exit(1);
}
console.log("RESULT: all assertions passed.");
