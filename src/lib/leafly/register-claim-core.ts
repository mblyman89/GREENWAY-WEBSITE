/**
 * SLICE L-14 — the register claim, and what a cancellation does to an open till.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Slice L-10 built `decideCancelPlan` in `bridge-core.ts`. It takes a
 * `registerSaleOpen` flag and, when that flag is true, produces the collision
 * plan the owner asked about: do not touch the till, raise the alarm, demand a
 * human decision.
 *
 * It was called like this:
 *
 *     decideCancelPlan({ localStatus, registerSaleOpen: false, reasonCode })
 *                                     ^^^^^^^^^^^^^^^^^^^^^^^^
 *
 * A hardcoded `false`. The collision branch — written, reviewed, and covered by
 * its own self-tests — could not fire in production, because nothing in the
 * system recorded that a register was holding an order. This is the same class
 * of defect as the L-12 origin gap: correct code wired to a constant. Tests
 * pass; the feature does not exist.
 *
 * This file is the missing fact. It decides, as pure logic, whether a Leafly
 * order is currently claimed by a register, and it is deliberately separate
 * from `decideCancelPlan` rather than merged into it (house rule 11: never
 * re-implement a rule that has a shared core — so the cancellation POLICY stays
 * in exactly one place and this file only supplies it with a true input).
 *
 * ── WHY A CLAIM NEEDS AN EXPIRY ─────────────────────────────────────────────
 *
 * A claim is a lock, and every lock taken by a physical device needs an answer
 * to "what if the device never comes back?" A register can be switched off
 * mid-sale, lose its network, run out of battery, or be carried out of range.
 * If a claim could be permanent, one dead tablet would make an order
 * permanently uncancellable and permanently invisible to every other register —
 * a far worse failure than the one we are preventing.
 *
 * So a claim is a LEASE. It is held by a device, it is renewed by that device's
 * ordinary polling, and it goes stale on its own. The staleness window is
 * deliberately much longer than the poll interval, because the cost of the two
 * errors is not symmetric:
 *
 *   - Expiring too early: we treat a live sale as abandoned and auto-cancel an
 *     order a budtender is actively bagging. Product on the counter, order gone
 *     from the system. UNACCEPTABLE.
 *   - Expiring too late: a cancellation that could have been automatic is
 *     escalated to a human instead. Mildly annoying. SAFE.
 *
 * The ladder therefore fails towards "a human looks at it", which is the same
 * direction as the allowlist in `decideCancelPlan`.
 */

/**
 * How long a register's claim survives without being renewed, in minutes.
 *
 * The register polls every 45 seconds (`RegisterShell.tsx`, the pickup-count
 * effect). Ten minutes is more than thirteen consecutive missed polls, so a
 * claim never goes stale because of a slow network, a backgrounded tab, or a
 * device that briefly slept. It goes stale only when a device is genuinely gone.
 *
 * This number is OURS, not Leafly's. Leafly documents a fifteen-minute
 * acknowledgement window, and that is a different clock about a different
 * thing; the two are deliberately not derived from each other, because tying an
 * internal lease to an external deadline would mean a change at Leafly silently
 * changing how long our tills hold their locks.
 */
export const CLAIM_STALE_AFTER_MINUTES = 10;

/** A claim as stored: which device holds it, and when it last checked in. */
export type RegisterClaim = {
  /** The `pos_devices.id` holding the order. Null/blank means unclaimed. */
  deviceId?: string | null;
  /** Human label for the device, for the audit trail and the staff message. */
  deviceName?: string | null;
  /** The employee who loaded it, when known. */
  employeeName?: string | null;
  /** ISO timestamp of the last renewal. Null means never renewed. */
  claimedAt?: string | null;
};

export type ClaimState =
  /** No device has this order. */
  | "unclaimed"
  /** A device holds it and has checked in recently. */
  | "held"
  /** A device holds it but has not checked in; treat as abandoned. */
  | "stale";

export type ClaimAssessment = {
  state: ClaimState;
  /**
   * The device holding the claim, when one is held. Null when unclaimed.
   *
   * Carried on the assessment so callers can address an interrupt to the till
   * that actually has the order, without re-reading the row. Populated for
   * `stale` too: knowing WHICH register went quiet is exactly what an
   * investigation needs, even though a stale claim reports no open sale.
   */
  deviceId: string | null;
  /**
   * The answer `decideCancelPlan` actually needs. True ONLY for `held`.
   *
   * A stale claim deliberately reports false: if a device vanished ten minutes
   * ago, nobody is standing at that till, and escalating to "a human must
   * choose" would page a person about a sale that no longer exists.
   */
  registerSaleOpen: boolean;
  /** Minutes since the claim was last renewed. Null when never claimed. */
  ageMinutes: number | null;
  /** Where the order is, in words a person can act on. Empty when unclaimed. */
  whereItIs: string;
};

/** Trim helper that treats null/undefined/blank identically. */
function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Assess a claim against a moment in time.
 *
 * `now` is injected rather than read from the clock so this is a pure function
 * and so the self-tests below can exercise the boundary exactly. House rule 5.
 */
export function assessRegisterClaim(
  claim: RegisterClaim | null | undefined,
  now: Date,
): ClaimAssessment {
  const deviceId = text(claim?.deviceId);
  const claimedAt = text(claim?.claimedAt);

  // No holder. Note that a claimedAt WITHOUT a deviceId is also unclaimed:
  // a timestamp alone identifies nobody, so there is no till to protect.
  if (deviceId === "") {
    return {
      state: "unclaimed",
      deviceId: null,
      registerSaleOpen: false,
      ageMinutes: null,
      whereItIs: "",
    };
  }

  const deviceName = text(claim?.deviceName) || "a register";
  const employee = text(claim?.employeeName);

  // A claim with a holder but no readable timestamp. We cannot prove it is
  // fresh, and we cannot prove it is stale. Treat it as HELD: the cost of a
  // false "held" is an unnecessary human decision, and the cost of a false
  // "stale" is auto-cancelling a live sale. Fail towards the person.
  const when = claimedAt === "" ? null : new Date(claimedAt);
  if (when === null || Number.isNaN(when.getTime())) {
    return {
      state: "held",
      deviceId,
      registerSaleOpen: true,
      ageMinutes: null,
      whereItIs: employee
        ? `${deviceName} (${employee}) has it open.`
        : `${deviceName} has it open.`,
    };
  }

  const ageMs = now.getTime() - when.getTime();
  const ageMinutes = Math.floor(ageMs / 60_000);

  // A claim timestamped in the FUTURE. Clock skew between a register tablet
  // and the server is real and is not the budtender's fault. A future stamp
  // cannot be stale, so it is held — again failing towards the person.
  if (ageMs < 0) {
    return {
      state: "held",
      deviceId,
      registerSaleOpen: true,
      ageMinutes,
      whereItIs: employee
        ? `${deviceName} (${employee}) has it open.`
        : `${deviceName} has it open.`,
    };
  }

  if (ageMinutes >= CLAIM_STALE_AFTER_MINUTES) {
    return {
      state: "stale",
      deviceId,
      registerSaleOpen: false,
      ageMinutes,
      whereItIs: `${deviceName} loaded it ${ageMinutes} minutes ago but has not checked in since.`,
    };
  }

  return {
    state: "held",
    deviceId,
    registerSaleOpen: true,
    ageMinutes,
    whereItIs: employee
      ? `${deviceName} (${employee}) has it open.`
      : `${deviceName} has it open.`,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE INTERRUPT: what the register shows when Leafly cancels a live sale.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The two dispositions, and ONLY these two.
 *
 * The owner's Q-B answer named both, and the enterprise standard requires that
 * a human choose between them rather than the system choosing. They are modelled
 * as a closed union rather than free text so that a third option cannot be added
 * at a call site without coming through this file — which is where the rules
 * about what each one means are written down.
 */
export type CancelDisposition = "void" | "walk_in";

export type RegisterInterrupt = {
  /** Stable id so the register can tell two interrupts apart and dedupe. */
  id: string;
  /** The local order this is about. */
  orderId: string;
  /** Order number, for the human. */
  orderNumber: string;
  /** Headline. Short, unambiguous, readable across a counter. */
  title: string;
  /** The full instruction. This is the text a budtender acts on. */
  message: string;
  /** Leafly's verbatim reason code, when they sent one. */
  reasonCode: string | null;
  /** Must a human choose a disposition before the sale can continue? */
  dispositionRequired: boolean;
  /** The choices offered. Empty when no decision is needed. */
  dispositions: CancelDisposition[];
  /** ISO timestamp the interrupt was raised. */
  raisedAt: string;
};

/**
 * Turn Leafly's cancellation reason code into something a budtender can say
 * out loud to the customer standing in front of them.
 *
 * The codes are Leafly's, verbatim from the `CancelReason` enum in
 * `docs/leafly-specs/order-api-v1.openapi.json`:
 *
 *     not_picked_up | customer | dispensary | pos | delivery_partner |
 *     ecommerce_partner | order_api_unacknowledged
 *
 * An unknown code is NEVER swallowed. Leafly can add one at any time, and a
 * cancellation we cannot explain is still a cancellation that must be obeyed —
 * so the raw code is shown rather than replaced with a comfortable guess.
 * (House rule 3: never silently invent a value.)
 */
export function explainCancelReason(code: string | null | undefined): string {
  const raw = text(code);
  if (raw === "") return "Leafly did not give a reason.";
  switch (raw.toLowerCase()) {
    case "customer":
      return "The customer cancelled it on Leafly.";
    case "dispensary":
      return "It was cancelled from the dispensary side (Leafly Biz, or one of us).";
    case "not_picked_up":
      return "Leafly closed it out as not picked up.";
    case "pos":
      return "It was cancelled by a point-of-sale system.";
    case "delivery_partner":
      return "The delivery partner cancelled it.";
    case "ecommerce_partner":
      return "The e-commerce partner cancelled it.";
    case "order_api_unacknowledged":
      return "Leafly auto-cancelled it because it was not accepted within their fifteen-minute window.";
    default:
      // Unknown code: show it, do not guess at it.
      return `Leafly's reason code was "${raw}", which we do not have a description for.`;
  }
}

/**
 * Build the interrupt the register must show.
 *
 * Takes the plan `decideCancelPlan` already produced rather than re-deciding
 * anything — house rule 11. This function is presentation, not policy: if it
 * started deciding whether a disposition was required, there would be two
 * places in the codebase that answer that question and they would drift.
 */
export function buildRegisterInterrupt(input: {
  orderId: string;
  orderNumber: string;
  /** Straight from `decideCancelPlan`. */
  plan: {
    dispositionRequired: boolean;
    alertFloor: boolean;
    staffMessage: string;
    severity: string;
  };
  reasonCode?: string | null;
  raisedAt: string;
}): RegisterInterrupt | null {
  // Nothing to interrupt anybody about. Returning null rather than an
  // "empty" interrupt keeps the caller's check honest: an object with a blank
  // title would still render a modal.
  if (!input.plan.alertFloor) return null;

  const reason = text(input.reasonCode) || null;
  const explanation = explainCancelReason(reason);

  // The staff message from the core is the authoritative instruction. The
  // reason explanation is appended, not substituted, because the budtender
  // needs BOTH: what to do, and what to tell the customer.
  const message = `${input.plan.staffMessage.trim()} ${explanation}`.trim();

  return {
    id: `leafly-cancel:${input.orderId}`,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    // The order number is part of the TITLE, not buried in the body, because
    // this modal blocks the till and asks for an irreversible choice. The
    // interrupt can be raised against an order the cashier is not looking at
    // (the poll is deliberately not gated on the home screen), and a store can
    // have several Leafly orders live at once. "Void this sale" without saying
    // WHICH sale is how the wrong one gets voided. Falls back to the plain
    // wording when we have no number, rather than printing a gap.
    title: input.plan.dispositionRequired
      ? text(input.orderNumber)
        ? `Leafly cancelled order ${text(input.orderNumber)}`
        : "Leafly cancelled this order"
      : text(input.orderNumber)
        ? `Leafly cancelled order ${text(input.orderNumber)}`
        : "A Leafly order was cancelled",
    message,
    reasonCode: reason,
    dispositionRequired: input.plan.dispositionRequired === true,
    // Both dispositions, always, when a decision is required. We do not
    // pre-judge which one applies: only the person at the counter can see
    // whether the customer is standing there.
    dispositions: input.plan.dispositionRequired ? ["void", "walk_in"] : [],
    raisedAt: input.raisedAt,
  };
}

/** What each disposition means, written once, for the modal and the audit log. */
export function describeDisposition(d: CancelDisposition): {
  label: string;
  detail: string;
} {
  switch (d) {
    case "void":
      return {
        label: "Void this sale",
        detail:
          "The customer is not taking it. Clear the sale and restock anything already bagged.",
      };
    case "walk_in":
      return {
        label: "Keep it as a walk-in sale",
        detail:
          "The customer is here and still wants the products. Ring it up as a normal sale — it is no longer a Leafly order.",
      };
  }
}

/**
 * Validate a disposition arriving from the register.
 *
 * An ALLOWLIST, matching the direction of `SAFE_TO_AUTO_CANCEL_STATUSES` in
 * `bridge-core.ts`. A value we do not recognise is rejected rather than passed
 * through to the database, because the only thing a tablet can send that is not
 * one of these two is a bug or a tampered request.
 */
const VALID_DISPOSITIONS: ReadonlySet<string> = new Set<CancelDisposition>(["void", "walk_in"]);

export function toCancelDisposition(v: unknown): CancelDisposition | null {
  const raw = text(v).toLowerCase();
  if (VALID_DISPOSITIONS.has(raw)) return raw as CancelDisposition;
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE BACK-OFFICE VIEW
 *
 * Everything above serves the REGISTER, which needs one question answered:
 * "must I stop?". The back office needs a different one: "what happened, and
 * is anybody still stuck?". Different question, separate function — not a
 * flag threaded through the register path.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One interrupt row as the back office needs to read it. */
export type InterruptRecord = {
  rowId: string;
  title: string;
  message: string;
  cancelReasonCode: string | null;
  dispositionRequired: boolean;
  raisedAt: string;
  resolvedAt: string | null;
  disposition: string | null;
  resolvedByEmployee: string | null;
};

export type InterruptSummary = {
  /**
   * BLOCKING     — still open, so a till is (or was) held up by it.
   * ANSWERED     — resolved, with a decision recorded.
   * CLOSED_NO_OP — resolved, and nothing needed deciding (nothing was bagged).
   */
  state: "BLOCKING" | "ANSWERED" | "CLOSED_NO_OP";
  /** One line of plain English, safe to render on an admin screen. */
  headline: string;
  /** Why Leafly cancelled, via explainCancelReason. Never re-worded here. */
  reason: string;
  /**
   * What the employee decided, via describeDisposition, or null when no
   * recognised decision was recorded. NOT a guess: a resolved row carrying an
   * unrecognised disposition yields null and says so, rather than quietly
   * displaying whichever option happens to be first.
   */
  decision: { label: string; detail: string } | null;
  /** True when somebody in the back office needs to chase this. */
  needsAttention: boolean;
};

/**
 * Summarise one interrupt for the back office.
 *
 * Pure, total, and never throws — it renders inside an admin page that must
 * not blank out because one row is odd.
 */
export function summariseInterrupt(row: InterruptRecord): InterruptSummary {
  const reason = explainCancelReason(row.cancelReasonCode);
  const resolved = text(row.resolvedAt) !== "";

  if (!resolved) {
    // STILL OPEN. Never aged out — see the note above on the asymmetry with
    // CLAIM_STALE_AFTER_MINUTES. Expiring this would destroy the only evidence
    // that a question about physical product went unanswered.
    return {
      state: "BLOCKING",
      headline: row.dispositionRequired
        ? "Still waiting on the register — nobody has said what happened to the product yet."
        : "Still showing on the register — nobody has dismissed it yet.",
      reason,
      decision: null,
      needsAttention: true,
    };
  }

  // RESOLVED. toCancelDisposition IS the allowlist, reused rather than
  // re-spelled, so an unrecognised value can never render as a real choice.
  const d = toCancelDisposition(row.disposition);
  const who = text(row.resolvedByEmployee);

  if (!row.dispositionRequired && d === null) {
    return {
      state: "CLOSED_NO_OP",
      headline: who
        ? `Dismissed by ${who}. Nothing had been bagged, so there was nothing to decide.`
        : "Dismissed at the register. Nothing had been bagged, so there was nothing to decide.",
      reason,
      decision: null,
      needsAttention: false,
    };
  }

  if (d === null) {
    // Marked resolved, but the recorded disposition is not one we offer.
    // Reported rather than smoothed over (house rule 3): it means the row was
    // written by something other than the register, and the product it
    // describes is unaccounted for.
    return {
      state: "ANSWERED",
      headline:
        "Marked resolved, but the recorded decision is not one the register offers — check what happened to the product.",
      reason,
      decision: null,
      needsAttention: true,
    };
  }

  const described = describeDisposition(d);
  return {
    state: "ANSWERED",
    headline: who ? `${described.label} — ${who}` : described.label,
    reason,
    decision: described,
    needsAttention: false,
  };
}

/**
 * Roll a list up for the panel header.
 *
 * `openCount` is what the board badges. Counted rather than taken from the
 * list length, because the list a page shows is clipped and a clipped list
 * that badges its own length under-reports the backlog — the same rule
 * LEAFLY_BOARD_LIMIT already follows.
 */
export function summariseInterrupts(rows: InterruptRecord[]): {
  openCount: number;
  needsAttentionCount: number;
  worst: "BLOCKING" | "ANSWERED" | "CLOSED_NO_OP" | "NONE";
} {
  let openCount = 0;
  let needsAttentionCount = 0;
  let sawAnswered = false;
  let sawNoOp = false;

  for (const row of rows) {
    const s = summariseInterrupt(row);
    if (s.state === "BLOCKING") openCount += 1;
    if (s.state === "ANSWERED") sawAnswered = true;
    if (s.state === "CLOSED_NO_OP") sawNoOp = true;
    if (s.needsAttention) needsAttentionCount += 1;
  }

  const worst =
    openCount > 0 ? "BLOCKING" : sawAnswered ? "ANSWERED" : sawNoOp ? "CLOSED_NO_OP" : "NONE";
  return { openCount, needsAttentionCount, worst };
}

/* ────────────────────────────────────────────────────────────────────────────
 * SELF-TESTS (house rule 5)
 * ──────────────────────────────────────────────────────────────────────────── */

export function __runRegisterClaimCoreTests(): void {
  let n = 0;
  const fails: string[] = [];
  const ok = (msg: string, cond: boolean): void => {
    n += 1;
    if (!cond) fails.push(msg);
  };
  const eq = (msg: string, got: unknown, want: unknown): void => {
    n += 1;
    if (got !== want) fails.push(`${msg} (got ${String(got)}, want ${String(want)})`);
  };

  const T0 = new Date("2026-09-18T20:00:00.000Z");
  const at = (min: number): Date => new Date(T0.getTime() + min * 60_000);

  // ── unclaimed ────────────────────────────────────────────────────────────
  for (const empty of [null, undefined, {}, { deviceId: null }, { deviceId: "   " }]) {
    const a = assessRegisterClaim(empty as RegisterClaim | null, T0);
    eq("no device is unclaimed", a.state, "unclaimed");
    ok("...and reports no open till", a.registerSaleOpen === false);
    eq("...with no age", a.ageMinutes, null);
    eq("...and says nothing about where it is", a.whereItIs, "");
  }

  // A timestamp with no device identifies nobody.
  eq(
    "a timestamp without a device is still unclaimed",
    assessRegisterClaim({ claimedAt: T0.toISOString() }, T0).state,
    "unclaimed",
  );

  // ── held ─────────────────────────────────────────────────────────────────
  const fresh = { deviceId: "d1", deviceName: "Register 2", employeeName: "Sam", claimedAt: T0.toISOString() };
  const held = assessRegisterClaim(fresh, T0);
  eq("a fresh claim is held", held.state, "held");
  ok("...and that is what decideCancelPlan needs", held.registerSaleOpen === true);
  eq("...aged zero minutes", held.ageMinutes, 0);
  ok("...and names the device", held.whereItIs.includes("Register 2"));
  ok("...and names the employee", held.whereItIs.includes("Sam"));

  // ── the staleness boundary, exactly ──────────────────────────────────────
  // One minute before the cutoff: still held.
  const justInside = assessRegisterClaim(fresh, at(CLAIM_STALE_AFTER_MINUTES - 1));
  eq("one minute inside the window is still held", justInside.state, "held");
  ok("...still an open till", justInside.registerSaleOpen === true);

  // Exactly at the cutoff: stale. (>= is the documented boundary.)
  const exactly = assessRegisterClaim(fresh, at(CLAIM_STALE_AFTER_MINUTES));
  eq("exactly at the cutoff is stale", exactly.state, "stale");
  ok("...and reports NO open till", exactly.registerSaleOpen === false);
  eq("...with the age in minutes", exactly.ageMinutes, CLAIM_STALE_AFTER_MINUTES);
  ok("...and explains the silence", exactly.whereItIs.includes("has not checked in"));

  // Long gone.
  eq("an hour later is stale", assessRegisterClaim(fresh, at(60)).state, "stale");

  // ── the two asymmetric failure modes ─────────────────────────────────────
  // Unreadable timestamp: fail towards the human.
  for (const bad of ["", "   ", "not-a-date", "2026-13-45T99:99:99Z"]) {
    const a = assessRegisterClaim({ deviceId: "d1", deviceName: "R1", claimedAt: bad }, T0);
    eq(`an unreadable timestamp (${bad || "blank"}) is HELD, not stale`, a.state, "held");
    ok("...because auto-cancelling a live sale is the worse error", a.registerSaleOpen === true);
  }

  // Future timestamp (clock skew): held, never stale.
  const future = assessRegisterClaim(
    { deviceId: "d1", deviceName: "R1", claimedAt: at(30).toISOString() },
    T0,
  );
  eq("a future claim is held (clock skew is not the budtender's fault)", future.state, "held");
  ok("...and never stale", future.registerSaleOpen === true);

  // The device name is optional; the message must still be a sentence.
  const anon = assessRegisterClaim({ deviceId: "d1", claimedAt: T0.toISOString() }, T0);
  ok("a nameless device still produces a usable sentence", anon.whereItIs.trim() !== "");
  ok("...and does not print 'undefined'", !anon.whereItIs.includes("undefined"));
  ok("...and does not print 'null'", !anon.whereItIs.includes("null"));

  // ── the device travels with the assessment (L-14) ────────────────────────
  // The interrupt has to be addressed to the till that actually holds the
  // order. If the assessment did not carry the device, the caller would have
  // to re-read the row -- and could read a DIFFERENT claim than the one it
  // just assessed.
  eq("a held claim names its device", held.deviceId, "d1");
  eq(
    "a STALE claim still names its device (an investigation needs to know who went quiet)",
    assessRegisterClaim(fresh, at(60)).deviceId,
    "d1",
  );
  eq("an unclaimed order has no device", assessRegisterClaim(null, T0).deviceId, null);
  eq(
    "a blank device id normalises to null rather than an empty string",
    assessRegisterClaim({ deviceId: "   ", claimedAt: T0.toISOString() }, T0).deviceId,
    null,
  );
  eq(
    "the device id is trimmed",
    assessRegisterClaim({ deviceId: "  d9  ", claimedAt: T0.toISOString() }, T0).deviceId,
    "d9",
  );

  // ── cancel reasons: every documented code, plus the unknown case ─────────
  const CODES = [
    "not_picked_up",
    "customer",
    "dispensary",
    "pos",
    "delivery_partner",
    "ecommerce_partner",
    "order_api_unacknowledged",
  ];
  for (const c of CODES) {
    const s = explainCancelReason(c);
    ok(`${c} has an explanation`, s.trim() !== "");
    ok(`${c} does not leak the raw code as the whole answer`, s !== c);
    ok(`${c} reads as a sentence`, /[.!]$/.test(s));
  }
  // Case-insensitivity: Leafly sends lowercase, but a stored value may not be.
  eq(
    "reason codes are matched case-insensitively",
    explainCancelReason("CUSTOMER"),
    explainCancelReason("customer"),
  );
  // The auto-cancel reason is the one staff will see most; it must name the window.
  ok(
    "the auto-cancel reason explains the fifteen-minute window",
    /fifteen/i.test(explainCancelReason("order_api_unacknowledged")),
  );
  // Unknown codes are shown, not guessed at.
  const unknown = explainCancelReason("something_leafly_added_in_2027");
  ok("an unknown code is surfaced verbatim", unknown.includes("something_leafly_added_in_2027"));
  ok("...and is not silently described as a customer cancellation", !/customer cancelled/i.test(unknown));
  // Blank.
  ok("a missing reason says so", explainCancelReason(null).trim() !== "");
  ok("...without inventing one", !/customer|dispensary/i.test(explainCancelReason(null)));

  // ── the interrupt ────────────────────────────────────────────────────────
  const collisionPlan = {
    dispositionRequired: true,
    alertFloor: true,
    severity: "urgent",
    staffMessage: "Leafly has CANCELLED this order, but it is already being worked on. Do not complete this sale.",
  };
  const iv = buildRegisterInterrupt({
    orderId: "o-1",
    orderNumber: "GW-1001",
    plan: collisionPlan,
    reasonCode: "customer",
    raisedAt: T0.toISOString(),
  });
  ok("a collision produces an interrupt", iv !== null);
  if (iv) {
    ok("...that demands a decision", iv.dispositionRequired);
    eq("...offering exactly two choices", iv.dispositions.length, 2);
    ok("...void", iv.dispositions.includes("void"));
    ok("...and walk-in", iv.dispositions.includes("walk_in"));
    ok("...carrying the instruction", iv.message.includes("Do not complete this sale"));
    ok("...and what to tell the customer", iv.message.includes("cancelled it on Leafly"));
    eq("...with Leafly's verbatim code", iv.reasonCode, "customer");
    ok("...and a stable id for deduping", iv.id.includes("o-1"));
    ok("...naming the order", iv.orderNumber === "GW-1001");
    // The number must be ON SCREEN, not merely carried in the payload. The
    // modal renders the title; a cashier being asked to void a sale has to be
    // told which sale.
    ok("...and the TITLE names the order", iv.title.includes("GW-1001"));
  }

  // The fallback: no order number must not produce a title with a hole in it.
  const noNumber = buildRegisterInterrupt({
    orderId: "o-1b",
    orderNumber: "",
    plan: collisionPlan,
    reasonCode: "customer",
    raisedAt: T0.toISOString(),
  });
  ok("a missing order number still produces an interrupt", noNumber !== null);
  if (noNumber) {
    ok("...with no double space", !noNumber.title.includes("  "));
    // The defect this guards is the interpolated form with an empty number,
    // i.e. "Leafly cancelled order ". NOT merely "ends in the word order" --
    // the correct fallback ("Leafly cancelled this order") does that too.
    ok("...and no dangling word", !/cancelled order\s*$/i.test(noNumber.title));
    ok("...falling back to the plain wording", noNumber.title === "Leafly cancelled this order");
  }
  // Whitespace is not an order number.
  const blankish = buildRegisterInterrupt({
    orderId: "o-1c",
    orderNumber: "   ",
    plan: collisionPlan,
    raisedAt: T0.toISOString(),
  });
  if (blankish) {
    ok("whitespace is treated as no number", blankish.title === "Leafly cancelled this order");
  }

  // A notice-level cancel (nothing started) still informs, but demands nothing.
  const noticePlan = {
    dispositionRequired: false,
    alertFloor: true,
    severity: "notice",
    staffMessage: "Leafly cancelled this order. No action needed.",
  };
  const notice = buildRegisterInterrupt({
    orderId: "o-2",
    orderNumber: "GW-1002",
    plan: noticePlan,
    reasonCode: "order_api_unacknowledged",
    raisedAt: T0.toISOString(),
  });
  ok("a notice still reaches the floor", notice !== null);
  if (notice) {
    ok("...but demands no decision", !notice.dispositionRequired);
    eq("...and offers no choices", notice.dispositions.length, 0);
    ok("...and the title is not alarming", !/CANCELLED THIS/i.test(notice.title));
  }

  // Silence when the core says silence. This is the guard that stops the
  // register popping a modal for every cancellation of an order nobody touched.
  eq(
    "no alert means no interrupt",
    buildRegisterInterrupt({
      orderId: "o-3",
      orderNumber: "GW-1003",
      plan: { dispositionRequired: false, alertFloor: false, severity: "none", staffMessage: "" },
      raisedAt: T0.toISOString(),
    }),
    null,
  );

  // ── dispositions ─────────────────────────────────────────────────────────
  for (const d of ["void", "walk_in"] as CancelDisposition[]) {
    const desc = describeDisposition(d);
    ok(`${d} has a label`, desc.label.trim() !== "");
    ok(`${d} has a detail that tells staff what happens next`, desc.detail.trim() !== "");
  }
  ok(
    "the two dispositions do not read the same",
    describeDisposition("void").label !== describeDisposition("walk_in").label,
  );
  ok(
    "void mentions restocking",
    /restock/i.test(describeDisposition("void").detail),
  );
  ok(
    "walk-in makes clear it stops being a Leafly order",
    /leafly/i.test(describeDisposition("walk_in").detail),
  );

  // The allowlist.
  eq("void is accepted", toCancelDisposition("void"), "void");
  eq("walk_in is accepted", toCancelDisposition("walk_in"), "walk_in");
  eq("case is normalised", toCancelDisposition("VOID"), "void");
  eq("whitespace is trimmed", toCancelDisposition("  walk_in  "), "walk_in");
  for (const bad of [null, undefined, "", "   ", "delete", "complete", "cancel", 42, {}, []]) {
    eq(`${JSON.stringify(bad)} is rejected`, toCancelDisposition(bad), null);
  }

  // ── summariseInterrupt (the back-office view) ─────────────────────────

  const openRow: InterruptRecord = {

    rowId: "r1",

    title: "Leafly cancelled order GW-1001",

    message: "m",

    cancelReasonCode: "customer",

    dispositionRequired: true,

    raisedAt: "2026-01-01T00:00:00.000Z",

    resolvedAt: null,

    disposition: null,

    resolvedByEmployee: null,

  };


  const openSum = summariseInterrupt(openRow);

  eq("an unresolved interrupt is BLOCKING", openSum.state, "BLOCKING");

  ok("...and needs attention", openSum.needsAttention === true);

  eq("...and carries no decision", openSum.decision, null);

  eq(

    "...and takes its reason from explainCancelReason, not a second wording",

    openSum.reason,

    explainCancelReason("customer"),

  );


  // Whitespace must not close an interrupt: a stray value would otherwise

  // silently clear a real question about product.

  eq(

    "whitespace in resolved_at does NOT resolve an interrupt",

    summariseInterrupt({ ...openRow, resolvedAt: "   " }).state,

    "BLOCKING",

  );


  // A blocking interrupt that needs no disposition still blocks, but says so

  // differently — the register only has to dismiss it.

  ok(

    "an open no-disposition interrupt still blocks",

    summariseInterrupt({ ...openRow, dispositionRequired: false }).state === "BLOCKING",

  );


  // ANSWERED, with the label taken from describeDisposition (rule 11).

  const voided = summariseInterrupt({

    ...openRow,

    resolvedAt: "2026-01-01T00:05:00.000Z",

    disposition: "void",

    resolvedByEmployee: "Sam",

  });

  eq("a resolved interrupt with a decision is ANSWERED", voided.state, "ANSWERED");

  ok("...and needs no chasing", voided.needsAttention === false);

  ok("...and names who answered", voided.headline.includes("Sam"));

  eq(

    "...and takes its label from describeDisposition",

    voided.decision?.label,

    describeDisposition("void").label,

  );


  // Case and padding must not lose a real decision.

  eq(

    "a padded upper-cased disposition still resolves through the allowlist",

    summariseInterrupt({

      ...openRow,

      resolvedAt: "2026-01-01T00:05:00.000Z",

      disposition: " WALK_IN ",

      resolvedByEmployee: "Sam",

    }).decision?.label,

    describeDisposition("walk_in").label,

  );


  // Resolved with nothing to decide = a dismissal, not a decision.

  const dismissed = summariseInterrupt({

    ...openRow,

    dispositionRequired: false,

    resolvedAt: "2026-01-01T00:05:00.000Z",

    disposition: null,

    resolvedByEmployee: "Ada",

  });

  eq("a dismissal with nothing to decide is CLOSED_NO_OP", dismissed.state, "CLOSED_NO_OP");

  ok("...and needs no chasing", dismissed.needsAttention === false);

  ok("...and names who dismissed it", dismissed.headline.includes("Ada"));


  // An UNKNOWN disposition must be flagged, never smoothed over (rule 3).

  const weird = summariseInterrupt({

    ...openRow,

    resolvedAt: "2026-01-01T00:05:00.000Z",

    disposition: "complete",

    resolvedByEmployee: "Sam",

  });

  eq("an unknown disposition is still resolved", weird.state, "ANSWERED");

  eq("...but yields NO decision object", weird.decision, null);

  ok("...and demands a human look at it", weird.needsAttention === true);


  // An unknown reason code is surfaced, not swallowed.

  ok(

    "an unknown cancel reason code appears verbatim",

    summariseInterrupt({ ...openRow, cancelReasonCode: "invented_2027" }).reason.includes(

      "invented_2027",

    ),

  );


  // Never throws on a degenerate row — an admin page must not blank out.

  for (const odd of [null, undefined, "", "   "]) {

    const r = summariseInterrupt({

      ...openRow,

      cancelReasonCode: odd as string | null,

      resolvedByEmployee: odd as string | null,

    });

    ok(`a degenerate row still summarises (${JSON.stringify(odd)})`, r.headline.length > 0);

  }


  // ── summariseInterrupts (the rollup) ────────────────────────────────

  const rollup = summariseInterrupts([

    openRow,

    { ...openRow, rowId: "r2", resolvedAt: "2026-01-01T00:05:00.000Z", disposition: "void" },

  ]);

  eq("the rollup counts only the open ones", rollup.openCount, 1);

  eq("one open interrupt makes the list BLOCKING", rollup.worst, "BLOCKING");

  eq("the rollup counts what needs attention", rollup.needsAttentionCount, 1);


  const emptyRollup = summariseInterrupts([]);

  eq("an empty list has no open interrupts", emptyRollup.openCount, 0);

  eq("an empty list is NONE, not BLOCKING", emptyRollup.worst, "NONE");

  eq("an empty list needs no attention", emptyRollup.needsAttentionCount, 0);


  // A fully answered list must NOT be reported as blocking. A board that

  // cries wolf is a board staff stop reading.

  eq(

    "a fully answered list is not blocking",

    summariseInterrupts([

      { ...openRow, resolvedAt: "2026-01-01T00:05:00.000Z", disposition: "void" },

    ]).worst,

    "ANSWERED",

  );


  const summary = `register-claim-core: ${n - fails.length}/${n} passed (${n} assertions)`;
  if (fails.length > 0) {
    throw new Error(`register-claim-core FAILED:\n  - ${fails.join("\n  - ")}\n${summary}`);
  }
  console.log(summary);
}
