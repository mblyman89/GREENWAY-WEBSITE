/**
 * src/lib/pos/pickup-progress-core.ts  (SLICE L-37)
 *
 * PURE rules for moving an online order along its steps FROM THE REGISTER,
 * and for the automatic "picked up" that happens when the register sale that
 * carried the order completes.
 *
 * The owner, verbatim:
 *
 *   "I want the ability to mark confirmed, mark ready for pick up, and mark
 *    picked up on the register ... I want the register to be intelligent and
 *    mark the order picked up automatically once the sale has been complete on
 *    the register. These actions need to update the online orders dashboard
 *    automatically ... please add the same functionality to the register for
 *    our own online orders."
 *
 * THREE STEPS, TWO BUTTONS, ONE AUTOMATIC
 * ---------------------------------------
 *   Confirm           new -> acknowledged      (Leafly: confirmed)   BUTTON
 *   Ready for pickup  -> ready                 (Leafly: ready)       BUTTON
 *   Picked up         when the register sale completes (Leafly: picked_up)
 *
 * "Picked up" is deliberately NOT a free-standing button. SLICE 17 closed the
 * checkbox door: the only way a cannabis handover completes is the register
 * sale, which runs the real ID gate (WAC 314-55-150) and takes the money. A
 * "Picked up" button that closed the order without that sale would re-open the
 * exact bypass SLICE 17 removed. So the picked-up step fires ITSELF, at the
 * one moment it is true: the sale completed. The register shows it as the
 * last step of the stepper, labelled "automatic when the sale completes".
 *
 * WHY THE ONLINE ORDER DOES NOT BECOME "completed"
 * ------------------------------------------------
 * The register sale materializes its OWN order, and THAT order is completed -
 * it is the sale of record: revenue (revenue-basis REVENUE_STATUS), the WA
 * excise return, CCRS Sale.csv, the WA tax report, the day ledger, the FIFO
 * inventory decrement and the loyalty accrual all count it. None of those
 * readers filter by origin. If the online order were ALSO moved to
 * "completed", every register pickup would be counted twice - revenue, tax,
 * stock and points. So the online order is closed with the non-revenue status
 * (the database's "cancelled", exactly as AM-D2 already did) but with a note
 * that starts with REGISTER_PICKED_UP_NOTE_PREFIX, and every screen that shows
 * the order reads that marker and says "Picked up" instead of "Cancelled".
 *
 * No I/O here. Registered in scripts/compliance/run-pure-selftests.ts.
 */

// ---------------------------------------------------------------------------
// Local (Greenway) order steps
// ---------------------------------------------------------------------------

/** The two statuses a register button may move an order TO. */
export const REGISTER_ADVANCE_TARGETS = ["acknowledged", "ready"] as const;
export type RegisterAdvanceTarget = (typeof REGISTER_ADVANCE_TARGETS)[number];

export function isRegisterAdvanceTarget(v: unknown): v is RegisterAdvanceTarget {
  return typeof v === "string" && (REGISTER_ADVANCE_TARGETS as readonly string[]).includes(v);
}

/** Active statuses in workflow order (mirrors ORDER_FORWARD_TRANSITIONS). */
const ACTIVE_SEQUENCE = ["new", "acknowledged", "preparing", "ready"] as const;

export function isActiveOrderStatus(status: string | null | undefined): boolean {
  return (ACTIVE_SEQUENCE as readonly string[]).includes((status ?? "").trim());
}

/** Button wording, shared by the register and the doc. */
export function registerAdvanceLabel(to: RegisterAdvanceTarget): string {
  return to === "acknowledged" ? "Confirm order" : "Mark ready for pickup";
}

export type RegisterAdvanceVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May the register move an order from `fromStatus` to `to`? Forward only, and
 * only while the order is active. Moving backwards is a reasoned reversal
 * (S-15) that belongs in the back office, not on a counter button.
 */
export function registerAdvanceVerdict(fromStatus: string, to: string): RegisterAdvanceVerdict {
  if (!isRegisterAdvanceTarget(to)) {
    return { allowed: false, reason: "The register can only confirm an order or mark it ready for pickup." };
  }
  const from = (fromStatus ?? "").trim();
  if (!isActiveOrderStatus(from)) {
    return {
      allowed: false,
      reason: `This order is already ${from || "closed"} - only an active order can be moved along.`,
    };
  }
  const fromIdx = ACTIVE_SEQUENCE.indexOf(from as (typeof ACTIVE_SEQUENCE)[number]);
  const toIdx = ACTIVE_SEQUENCE.indexOf(to);
  if (toIdx === fromIdx) {
    return { allowed: false, reason: `This order is already ${to === "ready" ? "ready for pickup" : "confirmed"}.` };
  }
  if (toIdx < fromIdx) {
    return {
      allowed: false,
      reason: "That would move the order backwards. Reopen or rewind an order from the back office, with a reason.",
    };
  }
  return { allowed: true };
}

/**
 * The next button the register should offer for an order in `status`, or null
 * when the only remaining step is the automatic pickup (or the order is closed).
 */
export function nextRegisterStep(status: string | null | undefined): RegisterAdvanceTarget | null {
  const s = (status ?? "").trim();
  if (s === "new") return "acknowledged";
  if (s === "acknowledged" || s === "preparing") return "ready";
  return null;
}

// ---------------------------------------------------------------------------
// Leafly
// ---------------------------------------------------------------------------

/** Local register target -> the Leafly status that means the same thing. */
export function leaflyStatusForTarget(to: RegisterAdvanceTarget): "confirmed" | "ready" {
  return to === "acknowledged" ? "confirmed" : "ready";
}

/** Leafly status reached -> the local status it corresponds to (null = none). */
export function localStatusForLeafly(leaflyStatus: string | null | undefined): RegisterAdvanceTarget | null {
  const s = (leaflyStatus ?? "").trim();
  if (s === "confirmed") return "acknowledged";
  if (s === "ready") return "ready";
  return null;
}

/** Leafly's pickup lifecycle, in order. Delivery-only statuses are not ours. */
const LEAFLY_PICKUP_STEPS = ["confirmed", "ready", "picked_up"] as const;
export type LeaflyPickupStep = (typeof LEAFLY_PICKUP_STEPS)[number];

const LEAFLY_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  ready: 2,
  out_for_delivery: 3,
  arrived_at_customer: 4,
};
const LEAFLY_TERMINAL = new Set(["picked_up", "canceled", "expired"]);

export type LeaflyPushPlan = {
  /** The status pushes to send, in order. Empty = nothing to send. */
  pushes: LeaflyPickupStep[];
  /** Leafly already has the order in a final state; nothing may be sent. */
  terminal: boolean;
  /** Leafly already is at (or past) the target. */
  alreadyThere: boolean;
};

/**
 * Which pushes take a Leafly order from `current` to `target`, one step at a
 * time. Leafly's spec: "supporting only direct movement to `picked_up` would
 * not be allowed ... result in a reasonably smooth and intuitive order
 * lifecycle for the end shopper." So a still-pending or merely confirmed order
 * is walked through every step (confirmed emails the shopper; ready tells them
 * to come in) rather than skipped straight to the end.
 */
export function planLeaflyPushes(current: string | null | undefined, target: LeaflyPickupStep): LeaflyPushPlan {
  const cur = (current ?? "").trim();
  if (LEAFLY_TERMINAL.has(cur)) {
    return { pushes: [], terminal: true, alreadyThere: cur === target };
  }
  const curRank = cur in LEAFLY_RANK ? LEAFLY_RANK[cur] : 0;
  const targetIdx = LEAFLY_PICKUP_STEPS.indexOf(target);
  const pushes = LEAFLY_PICKUP_STEPS.slice(0, targetIdx + 1).filter((step) => {
    const rank = step === "picked_up" ? 99 : LEAFLY_RANK[step];
    return rank > curRank;
  });
  return { pushes, terminal: false, alreadyThere: pushes.length === 0 };
}

// ---------------------------------------------------------------------------
// The automatic "picked up"
// ---------------------------------------------------------------------------

/** Every picked-up-at-the-register note starts with this. Screens key on it. */
export const REGISTER_PICKED_UP_NOTE_PREFIX = "PICKED UP AT THE REGISTER";

/** The label screens show for an online order closed this way. */
export const REGISTER_PICKED_UP_LABEL = "Picked up";

export function isRegisterPickedUpNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.startsWith(REGISTER_PICKED_UP_NOTE_PREFIX);
}

/**
 * The order_events note written when the register sale that carried this
 * online order completes. Says loudly where the money went, so nobody hunts
 * for a missing sale on the online order.
 */
export function registerPickedUpNote(input: {
  deviceName: string;
  employeeName: string;
  registerOrderNumber: string | null;
}): string {
  const sale = (input.registerOrderNumber ?? "").trim();
  return (
    `${REGISTER_PICKED_UP_NOTE_PREFIX} - the customer collected this order at ${input.deviceName}, ` +
    `handed over by ${input.employeeName}` +
    (sale ? `, as register sale ${sale}` : "") +
    `. The ID check, the payment, the receipt and the books all live on that register sale; ` +
    `this online order is closed without revenue so the sale is never counted twice.`
  );
}

/** Actor label for an order-events row written by a register button. */
export function registerAdvanceActorLabel(employeeName: string, deviceName: string): string {
  return `${employeeName} at ${deviceName} (register)`;
}

// ---------------------------------------------------------------------------
// Register stepper
// ---------------------------------------------------------------------------

export type PickupStepState = "done" | "current" | "todo";
export type PickupStep = { key: "placed" | "confirmed" | "ready" | "picked_up"; label: string; hint: string; state: PickupStepState };

/**
 * The four-step strip on the register's order pane. `current` marks the step
 * the order is AT (the last one completed); the step after it is what the
 * button does. Picked up is only ever done by the sale.
 */
export function pickupSteps(status: string | null | undefined): PickupStep[] {
  const s = (status ?? "").trim();
  const reached = s === "new" ? 0 : s === "acknowledged" || s === "preparing" ? 1 : s === "ready" ? 2 : -1;
  const base: Omit<PickupStep, "state">[] = [
    { key: "placed", label: "Placed", hint: "Order received" },
    { key: "confirmed", label: "Confirmed", hint: "Tap Confirm order" },
    { key: "ready", label: "Ready for pickup", hint: "Tap Mark ready when bagged" },
    { key: "picked_up", label: "Picked up", hint: "Automatic when the sale completes" },
  ];
  return base.map((b, i) => ({
    ...b,
    state: reached < 0 ? "todo" : i < reached ? "done" : i === reached ? "current" : "todo",
  }));
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runPickupProgressCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // Targets
  ok(isRegisterAdvanceTarget("acknowledged") && isRegisterAdvanceTarget("ready"), "two targets");
  ok(!isRegisterAdvanceTarget("completed"), "completed is NOT a register button (SLICE 17)");
  ok(!isRegisterAdvanceTarget("cancelled") && !isRegisterAdvanceTarget("preparing"), "no other targets");
  ok(!isRegisterAdvanceTarget(null) && !isRegisterAdvanceTarget(1), "non-strings refused");

  // Verdict
  ok(registerAdvanceVerdict("new", "acknowledged").allowed, "new -> confirmed");
  ok(registerAdvanceVerdict("new", "ready").allowed, "new -> ready (skip is forward)");
  ok(registerAdvanceVerdict("preparing", "ready").allowed, "preparing -> ready");
  ok(!registerAdvanceVerdict("ready", "acknowledged").allowed, "backwards refused");
  ok(!registerAdvanceVerdict("ready", "ready").allowed, "same refused");
  ok(!registerAdvanceVerdict("completed", "ready").allowed, "closed refused");
  ok(!registerAdvanceVerdict("cancelled", "acknowledged").allowed, "cancelled refused");
  ok(!registerAdvanceVerdict("new", "completed").allowed, "completed target refused");
  const back = registerAdvanceVerdict("ready", "acknowledged");
  ok(!back.allowed && back.reason.includes("backwards"), "backwards reason names it");

  // Next step
  ok(nextRegisterStep("new") === "acknowledged", "next from new");
  ok(nextRegisterStep("acknowledged") === "ready", "next from acknowledged");
  ok(nextRegisterStep("preparing") === "ready", "next from preparing");
  ok(nextRegisterStep("ready") === null, "ready -> only the automatic pickup remains");
  ok(nextRegisterStep("completed") === null && nextRegisterStep(null) === null, "closed/none -> null");

  // Leafly mapping
  ok(leaflyStatusForTarget("acknowledged") === "confirmed", "ack -> confirmed");
  ok(leaflyStatusForTarget("ready") === "ready", "ready -> ready");
  ok(localStatusForLeafly("confirmed") === "acknowledged", "confirmed -> ack");
  ok(localStatusForLeafly("ready") === "ready", "ready -> ready (local)");
  ok(localStatusForLeafly("pending") === null && localStatusForLeafly(null) === null, "pending -> none");

  // Push plans
  ok(same(planLeaflyPushes("pending", "confirmed").pushes, ["confirmed"]), "pending -> confirmed");
  ok(same(planLeaflyPushes("pending", "ready").pushes, ["confirmed", "ready"]), "pending -> ready walks confirmed first");
  ok(same(planLeaflyPushes("confirmed", "ready").pushes, ["ready"]), "confirmed -> ready");
  ok(same(planLeaflyPushes("ready", "picked_up").pushes, ["picked_up"]), "ready -> picked_up");
  ok(same(planLeaflyPushes("confirmed", "picked_up").pushes, ["ready", "picked_up"]), "never jump straight to picked_up");
  ok(same(planLeaflyPushes("pending", "picked_up").pushes, ["confirmed", "ready", "picked_up"]), "full walk from pending");
  ok(same(planLeaflyPushes(null, "picked_up").pushes, ["confirmed", "ready", "picked_up"]), "unknown treated as pending");
  const at = planLeaflyPushes("ready", "ready");
  ok(at.alreadyThere && at.pushes.length === 0 && !at.terminal, "already ready -> nothing");
  const past = planLeaflyPushes("ready", "confirmed");
  ok(past.alreadyThere && past.pushes.length === 0, "past target -> nothing (never backwards)");
  const term = planLeaflyPushes("canceled", "picked_up");
  ok(term.terminal && term.pushes.length === 0 && !term.alreadyThere, "canceled is terminal");
  const done = planLeaflyPushes("picked_up", "picked_up");
  ok(done.terminal && done.alreadyThere, "already picked up");
  ok(planLeaflyPushes("expired", "ready").terminal, "expired terminal");
  ok(same(planLeaflyPushes("out_for_delivery", "picked_up").pushes, ["picked_up"]), "delivery states rank past ready");

  // Note
  const note = registerPickedUpNote({ deviceName: "Front iPad", employeeName: "Casey", registerOrderNumber: "GWY-ABC123" });
  ok(isRegisterPickedUpNote(note), "note carries the marker");
  ok(note.includes("Front iPad") && note.includes("Casey") && note.includes("GWY-ABC123"), "note names device, person, sale");
  ok(note.includes("never counted twice"), "note says why it is not completed");
  const noSale = registerPickedUpNote({ deviceName: "D", employeeName: "E", registerOrderNumber: null });
  ok(!noSale.includes("as register sale"), "no sale number -> clause omitted");
  ok(!isRegisterPickedUpNote("SUPERSEDED - loaded into a register sale"), "old supersede note is not the marker");
  ok(!isRegisterPickedUpNote(null) && !isRegisterPickedUpNote("picked up at the register"), "case-sensitive, null-safe");
  ok(registerAdvanceActorLabel("Casey", "Front iPad") === "Casey at Front iPad (register)", "actor label");
  ok(registerAdvanceLabel("acknowledged") === "Confirm order" && registerAdvanceLabel("ready") === "Mark ready for pickup", "labels");

  // Stepper
  const st = (s: string) => pickupSteps(s).map((x) => x.state).join(",");
  ok(st("new") === "current,todo,todo,todo", "stepper new");
  ok(st("acknowledged") === "done,current,todo,todo", "stepper confirmed");
  ok(st("preparing") === "done,current,todo,todo", "stepper preparing reads as confirmed");
  ok(st("ready") === "done,done,current,todo", "stepper ready");
  ok(st("completed") === "todo,todo,todo,todo", "stepper closed -> nothing claimed");
  ok(pickupSteps("new")[3].hint.includes("Automatic"), "pickup step says automatic");
  ok(pickupSteps("new").length === 4, "four steps");

  console.log(`pickup-progress-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`pickup-progress-core: ${fail} failing assertions`);
}
