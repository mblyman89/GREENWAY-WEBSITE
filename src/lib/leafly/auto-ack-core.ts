/**
 * SLICE L-33 — AUTO-ACKNOWLEDGE: THE DECISION, WITH NOTHING ATTACHED TO IT
 * ============================================================================
 *
 * The owner, verbatim:
 *
 *   > "I feel like 15 minutes is not enough time for us to press that button.
 *   >  When we are busy, we can tell a customer, 'hang on, I have to go push a
 *   >  button in the office', that's lame. Surely our system is smart enough to
 *   >  push the acknowledge button for us right? ... So we should be able to
 *   >  acknowledge it automatically, print a receipt, make noise, then when we
 *   >  are ready, we confirm it and fill it and complete it. Please build me an
 *   >  auto acknowledge feature. It can't be acknowledge and confirm in the
 *   >  same step though. Just auto acknowledge."
 *
 * ── IS THIS EVEN ALLOWED? YES, AND NOT AS A MATTER OF OPINION ───────────────
 *
 * Leafly's Order API description, "Expectations" section, verbatim:
 *
 *   "Orders are acknowledged as having been retrieved in whole BY YOUR SYSTEM
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders not acknowledged by this deadline will be auto canceled."
 *
 * The subject of that sentence is *your system*. Not "your staff". The
 * acknowledge endpoint accepts no body, no actor and no staff identifier, so
 * Leafly could not tell a machine from a human even if it wanted to — there is
 * no field in which the difference could be expressed. The human gate was ours
 * all along. We are not working around the spec; we are doing the thing the
 * spec literally describes.
 *
 * ── WHY THIS IS A SEPARATE FILE, AND WHY IT IS PURE ─────────────────────────
 *
 * The acknowledgement is IRREVERSIBLE. Leafly revokes the order's media on
 * acknowledgement and there is no un-acknowledge endpoint. A rule that fires
 * an irreversible action automatically, with no human in the loop, is the
 * highest-stakes decision in this integration — and before this slice, every
 * such decision had a person's finger on it.
 *
 * So the decision is separated from the doing. Everything in this file is a
 * pure function of plain values: no clock it did not receive, no environment it
 * did not receive, no database, no network. That means the rule can be
 * exhaustively tested in CI, and it means the rule behaves identically in a
 * test and in front of the owner. The L-30 lesson, applied to the one place it
 * matters most.
 *
 * The side effects live in `auto-ack-server.ts`, which does nothing this file
 * has not already sanctioned.
 *
 * ── THE FOUR THINGS THIS RULE MUST NEVER DO ────────────────────────────────
 *
 *   1. Acknowledge twice. Leafly answers a second acknowledgement with 409,
 *      and more importantly a double-acknowledge means our idempotency is
 *      broken somewhere it also matters.
 *   2. Acknowledge something that is not a live, submitted order — a cancelled
 *      or expired order must never be "accepted" by a machine after the fact.
 *   3. Fire when the owner has switched it off. A kill switch that can be
 *      argued with is not a kill switch.
 *   4. Fail the webhook. A non-200 makes Leafly retry, and a retry storm during
 *      the fifteen-minute window is how a real customer's order gets
 *      auto-cancelled. Every refusal here is a VALUE, never a throw.
 */

import { LEAFLY_ACK_WINDOW_MINUTES } from "./order-ack-core";

/* ========================================================================== *
 * 1. THE KILL SWITCH
 * ========================================================================== */

/**
 * The environment variable that turns auto-acknowledge off.
 *
 * ── WHY THE DEFAULT IS *ON* ────────────────────────────────────────────────
 *
 * This was the hardest call in the slice and it is deliberately not the
 * cautious-looking one, so the reasoning is recorded rather than implied.
 *
 * The instinct with an irreversible automatic action is to default it OFF and
 * make someone opt in. That instinct is wrong here, and the reason is that
 * BOTH choices are dangerous — there is no safe default, only two different
 * failure modes:
 *
 *   default OFF, flag not set → the owner deploys, believes the feature he
 *     asked for is live, walks away from the office, and Leafly auto-cancels a
 *     real customer's order fifteen minutes later. The failure is SILENT, it
 *     costs a paying customer, and it looks exactly like the bug he has been
 *     reporting for three slices.
 *
 *   default ON, flag not set → orders are acknowledged on arrival, which is
 *     precisely what he asked for in writing. If he ever wants it stopped, one
 *     environment variable stops it.
 *
 * A default that quietly does nothing while appearing to be installed is not
 * "safe", it is deceptive. The safe default is the one that does what the
 * owner asked and can be switched off in one move.
 *
 * ── AND THE OFF SWITCH IS DELIBERATELY BLUNT ───────────────────────────────
 *
 * Any of "0", "false", "off" or "no" (case-insensitive, trimmed) disables it.
 * Not one magic spelling. Somebody reaching for this switch is probably having
 * a bad day and should not also have to remember which word we chose.
 */
export const LEAFLY_AUTO_ACK_ENV_VAR = "LEAFLY_AUTO_ACKNOWLEDGE";

/** The spellings that mean "off". Compared lowercased and trimmed. */
const OFF_VALUES: readonly string[] = ["0", "false", "off", "no"];

/**
 * Is auto-acknowledge enabled?
 *
 * Takes the raw value rather than reading `process.env` itself, so the rule is
 * pure and so CI can prove every spelling behaves as documented without
 * mutating global state.
 *
 * @param raw the value of LEAFLY_AUTO_ACKNOWLEDGE, or undefined when unset.
 */
export function isAutoAcknowledgeEnabled(
  raw: string | null | undefined,
): boolean {
  if (raw === null || raw === undefined) return true; // unset → on. See above.
  const v = raw.trim().toLowerCase();
  if (v === "") return true; // set-but-empty is indistinguishable from unset.
  return !OFF_VALUES.includes(v);
}

/* ========================================================================== *
 * 2. THE DECISION
 * ========================================================================== */

/** Why auto-acknowledge did or did not fire. Every branch is named. */
export type AutoAckDecisionCode =
  /** Fire. */
  | "acknowledge"
  /** The owner switched it off. */
  | "disabled"
  /** Already acknowledged — by anyone, at any time. */
  | "already_acknowledged"
  /** The order is cancelled, expired or otherwise finished. */
  | "not_live"
  /** We have no Leafly order id, so there is nothing to acknowledge. */
  | "no_order_id"
  /** The delivery was not an order submission. */
  | "not_a_submission";

export type AutoAckDecision = {
  /** True only for `acknowledge`. */
  shouldAcknowledge: boolean;
  code: AutoAckDecisionCode;
  /**
   * A sentence for the webhook's `notes` array and the server log.
   *
   * Written for whoever is reading the logs at 9pm trying to work out why an
   * order was or was not acknowledged. Never a bare enum, and never blank:
   * a silent skip is indistinguishable from a crash.
   */
  reason: string;
};

/**
 * Statuses that mean the order is over. Acknowledging any of these would be a
 * machine "accepting" an order that no longer exists.
 *
 * `pending` is the ONLY status an arriving order should have, but the check is
 * written as a deny-list of terminal states rather than an allow-list of
 * `pending`, on purpose: if Leafly ever introduces a new live status, an
 * allow-list would silently stop acknowledging real orders and they would
 * auto-cancel. A deny-list fails towards acting, and acting is what prevents
 * the loss. The consequence of being wrong in the other direction — a status
 * we did not anticipate — is one acknowledgement that Leafly answers with an
 * error we record.
 */
const FINISHED_STATUSES: readonly string[] = [
  "canceled",
  "cancelled",
  "expired",
  "picked_up",
];

/**
 * Decide whether to acknowledge this arrival automatically.
 *
 * PURE. Every input is a plain value supplied by the caller.
 *
 * @param eventType         the webhook event type, e.g. "order_submit".
 * @param leaflyOrderId     the order id from the delivery.
 * @param acknowledgedAt    our row's existing stamp, or null.
 * @param leaflyStatus      our row's status after the upsert, or null.
 * @param autoAckEnvValue   raw LEAFLY_AUTO_ACKNOWLEDGE, or undefined.
 */
export function decideAutoAcknowledge(input: {
  eventType: string | null | undefined;
  leaflyOrderId: string | null | undefined;
  acknowledgedAt: string | null | undefined;
  leaflyStatus: string | null | undefined;
  autoAckEnvValue: string | null | undefined;
}): AutoAckDecision {
  const refuse = (code: AutoAckDecisionCode, reason: string): AutoAckDecision => ({
    shouldAcknowledge: false,
    code,
    reason,
  });

  // ── ORDER OF CHECKS IS DELIBERATE ────────────────────────────────────────
  // The kill switch is FIRST. If the owner has turned this off, no other fact
  // about the order is relevant, and the log line should say "off" rather than
  // some incidental detail of an order we were never going to touch.
  if (!isAutoAcknowledgeEnabled(input.autoAckEnvValue)) {
    return refuse(
      "disabled",
      `Auto-acknowledge is switched off (${LEAFLY_AUTO_ACK_ENV_VAR}). ` +
        `This order must be acknowledged by hand within ` +
        `${LEAFLY_ACK_WINDOW_MINUTES} minutes or Leafly will cancel it.`,
    );
  }

  // Only an order SUBMISSION starts the clock. An order_cancel delivery must
  // never be answered with an acknowledgement — that would be a machine
  // accepting an order the customer already walked away from.
  const event = (input.eventType ?? "").trim();
  if (event !== "order_submit") {
    return refuse(
      "not_a_submission",
      `Not an order submission (${event === "" ? "no event type" : event}), ` +
        `so there is nothing to acknowledge.`,
    );
  }

  const id = (input.leaflyOrderId ?? "").trim();
  if (id === "") {
    return refuse(
      "no_order_id",
      "This delivery carried no Leafly order id, so there is nothing to acknowledge.",
    );
  }

  // IDEMPOTENCY. Leafly retries deliveries, and a retry after a successful
  // acknowledgement is ordinary, not exceptional. Checked against our own
  // stamp rather than by catching Leafly's 409, because the cheapest way to
  // handle a duplicate is to never send it.
  //
  // Note this refuses regardless of WHO acknowledged it. A human who got to
  // the button first is just as good a reason not to send a second one.
  const acked = (input.acknowledgedAt ?? "").trim();
  if (acked !== "") {
    return refuse(
      "already_acknowledged",
      "Already acknowledged, so no second acknowledgement is sent.",
    );
  }

  const status = (input.leaflyStatus ?? "").trim().toLowerCase();
  if (FINISHED_STATUSES.includes(status)) {
    return refuse(
      "not_live",
      `This order is already "${status}", so acknowledging it would be ` +
        `claiming to accept an order that is over.`,
    );
  }

  return {
    shouldAcknowledge: true,
    code: "acknowledge",
    reason:
      "Acknowledged automatically on arrival, stopping Leafly's " +
      `${LEAFLY_ACK_WINDOW_MINUTES}-minute cancellation clock. ` +
      "Not confirmed — that is still a human decision.",
  };
}

/* ========================================================================== *
 * 3. WHAT THE OPERATOR IS TOLD
 * ========================================================================== */

/**
 * The badge wording for an order the machine acknowledged.
 *
 * Exists because of a specific, foreseeable confusion. The board's "Accepted"
 * step will now be ticked on every order the instant it lands, and a budtender
 * who does not know a machine did it has two wrong conclusions available:
 * "somebody else is already working this" (so nobody works it), or "I must
 * have pressed something". Both end with an order nobody builds.
 *
 * Deliberately short enough for a card. The full explanation belongs in the
 * order detail, not on a chip.
 */
export const LEAFLY_AUTO_ACK_BADGE = "Accepted automatically";

/**
 * The longer sentence, for the order detail panel.
 *
 * Says three things on purpose: WHAT happened, WHY it is not finished, and
 * WHAT the person should do. The middle one is the one the owner specifically
 * needs, because the whole point of this slice is that acknowledgement and
 * confirmation are now different moments.
 */
export const LEAFLY_AUTO_ACK_EXPLANATION =
  "This order was acknowledged automatically the moment it arrived, so " +
  "Leafly will not cancel it while you are busy. The shopper has NOT been " +
  "told you are making it yet — that happens when you press Confirm.";

/**
 * Wording for the kind stored in `acknowledged_by_kind`.
 *
 * A function over the stored value rather than a lookup at each call site, so
 * that a null (a row that predates the column) reads as an honest "not
 * recorded" instead of silently rendering as "human" — which would be
 * inventing an audit trail.
 */
export function acknowledgedByKindLabel(
  kind: string | null | undefined,
): string | null {
  const v = (kind ?? "").trim().toLowerCase();
  if (v === "auto") return LEAFLY_AUTO_ACK_BADGE;
  if (v === "human") return "Accepted by staff";
  return null;
}

/**
 * Translate the stored `confirm_push_failed_at` column into the tri-state the
 * action planner reads.
 *
 * This looks like a line of glue and is in fact the whole of slice B2's
 * correctness, which is why it lives in a tested core rather than inline in a
 * component. There are THREE distinct inputs and they must map to three
 * distinct outputs:
 *
 *   `undefined`  the column does not exist yet -- migration 0230 is applied by
 *                hand (AGENTS rule 6) and there is a real window where this
 *                code is deployed and the column is not there. The board's
 *                fallback drops the column, the row arrives without the key,
 *                and the honest answer is "I do not know". It must stay
 *                `undefined` so the planner behaves exactly as it did before
 *                L-33 existed.
 *
 *   `null`       the column exists and is empty: a push failure was never
 *                recorded, or was recorded and then CLEARED by a later
 *                success. This is `false` -- a positive statement that the
 *                order is healthy.
 *
 *   a timestamp  a `status=confirmed` push was attempted and failed. `true`.
 *
 * The tempting one-liner is `order.confirm_push_failed_at !== null`, and it is
 * wrong in the first case: `undefined !== null` is `true`, so every order in a
 * pre-0230 shop would be reported as having a FAILED PUSH. The board would
 * then hide the ordinary Confirm button behind "Check this order with Leafly"
 * for the entire shop -- the exact failure B1 was opened to prevent, delivered
 * by the fix for it. Collapsing the other way (`?? null` first) is just as
 * wrong in the opposite direction, and silently.
 *
 * Mirrors the reasoning already pinned on `toWorkflowRow`'s pass-through of
 * `announced_at` / `printed_at` in LeaflyOrdersPanel.
 */
export function confirmPushFailedFromColumn(
  confirmPushFailedAt: string | null | undefined,
): boolean | undefined {
  if (confirmPushFailedAt === undefined) return undefined;
  return confirmPushFailedAt !== null;
}

/* ========================================================================== *
 * 4. SELF-TESTS
 * ========================================================================== */

/**
 * Exhaustive self-tests for the rule above.
 *
 * Registered in `tests/compliance/pure-selftests.test.ts` alongside the other
 * cores. Written here, next to the code, because a rule that fires an
 * irreversible action should not be able to change without its justification
 * and its proof both being in the diff.
 */
export function __runLeaflyAutoAckTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`  ✗ leafly-auto-ack: ${label}`);
    }
  };

  // --- 1. THE KILL SWITCH --------------------------------------------------
  ok(
    isAutoAcknowledgeEnabled(undefined),
    "UNSET means ON — the owner asked for this feature; a flag he was never " +
      "told about must not silently withhold it",
  );
  ok(isAutoAcknowledgeEnabled(null), "null is treated exactly like unset");
  ok(
    isAutoAcknowledgeEnabled(""),
    "set-but-empty is indistinguishable from unset, so it means ON too",
  );
  ok(isAutoAcknowledgeEnabled("   "), "whitespace-only is still ON");

  for (const off of ["0", "false", "off", "no"]) {
    ok(!isAutoAcknowledgeEnabled(off), `"${off}" switches it OFF`);
    ok(
      !isAutoAcknowledgeEnabled(off.toUpperCase()),
      `"${off.toUpperCase()}" switches it off too — case must not matter to a kill switch`,
    );
    ok(
      !isAutoAcknowledgeEnabled(`  ${off}  `),
      `"${off}" with stray whitespace still switches it off`,
    );
  }

  for (const on of ["1", "true", "on", "yes", "enabled"]) {
    ok(isAutoAcknowledgeEnabled(on), `"${on}" leaves it ON`);
  }

  // A value nobody anticipated must not accidentally disable the feature.
  ok(
    isAutoAcknowledgeEnabled("maybe"),
    "an unrecognised value fails towards ON, because the failure mode of OFF " +
      "is a real customer's order being auto-cancelled",
  );

  // --- 2. THE HAPPY PATH ---------------------------------------------------
  const live = decideAutoAcknowledge({
    eventType: "order_submit",
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
    autoAckEnvValue: undefined,
  });
  ok(live.shouldAcknowledge, "a fresh submitted order IS acknowledged automatically");
  ok(live.code === "acknowledge", "…and says so with the acknowledge code");
  ok(
    live.reason.includes(String(LEAFLY_ACK_WINDOW_MINUTES)),
    "…and the reason names Leafly's own window rather than a number we invented",
  );
  ok(
    /not confirmed/i.test(live.reason),
    "…and states that confirmation did NOT happen — the owner's hard constraint, " +
      "visible in the log line itself",
  );

  // --- 3. EVERY REFUSAL ----------------------------------------------------
  const disabled = decideAutoAcknowledge({
    eventType: "order_submit",
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
    autoAckEnvValue: "0",
  });
  ok(!disabled.shouldAcknowledge, "the kill switch really stops it");
  ok(disabled.code === "disabled", "…with the disabled code");
  ok(
    disabled.reason.includes(LEAFLY_AUTO_ACK_ENV_VAR),
    "…and the message names the exact variable to change, so nobody has to " +
      "go looking through the source for it",
  );
  ok(
    /by hand|cancel/i.test(disabled.reason),
    "…and warns that the clock is now a human's problem again",
  );

  const cancelEvent = decideAutoAcknowledge({
    eventType: "order_cancel",
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    leaflyStatus: "canceled",
    autoAckEnvValue: undefined,
  });
  ok(
    !cancelEvent.shouldAcknowledge,
    "a cancellation delivery NEVER triggers an acknowledgement",
  );
  ok(cancelEvent.code === "not_a_submission", "…named as the wrong event");

  const noId = decideAutoAcknowledge({
    eventType: "order_submit",
    leaflyOrderId: "   ",
    acknowledgedAt: null,
    leaflyStatus: "pending",
    autoAckEnvValue: undefined,
  });
  ok(!noId.shouldAcknowledge, "a blank order id is refused, not sent as an empty path");
  ok(noId.code === "no_order_id", "…with the missing-id code");

  const dupe = decideAutoAcknowledge({
    eventType: "order_submit",
    leaflyOrderId: "ord-1",
    acknowledgedAt: "2026-09-24T10:00:00.000Z",
    leaflyStatus: "pending",
    autoAckEnvValue: undefined,
  });
  ok(
    !dupe.shouldAcknowledge,
    "an already-acknowledged order is never acknowledged twice — Leafly " +
      "retries deliveries, so this is the ordinary case, not an exotic one",
  );
  ok(dupe.code === "already_acknowledged", "…with the duplicate code");

  for (const dead of ["canceled", "cancelled", "expired", "picked_up"]) {
    const over = decideAutoAcknowledge({
      eventType: "order_submit",
      leaflyOrderId: "ord-1",
      acknowledgedAt: null,
      leaflyStatus: dead,
      autoAckEnvValue: undefined,
    });
    ok(
      !over.shouldAcknowledge,
      `a "${dead}" order is not acknowledged — accepting a finished order is a lie`,
    );
    ok(over.code === "not_live", `…"${dead}" is named as not live`);
  }
  // Case and padding must not smuggle a dead order past the check.
  ok(
    decideAutoAcknowledge({
      eventType: "order_submit",
      leaflyOrderId: "ord-1",
      acknowledgedAt: null,
      leaflyStatus: "  CANCELED  ",
      autoAckEnvValue: undefined,
    }).code === "not_live",
    "the finished-status check is case- and whitespace-insensitive",
  );

  // --- 4. PRECEDENCE -------------------------------------------------------
  // When several refusals apply at once, the reported one must be the most
  // USEFUL, not whichever branch happened to be written first.
  ok(
    decideAutoAcknowledge({
      eventType: "order_cancel",
      leaflyOrderId: "",
      acknowledgedAt: "x",
      leaflyStatus: "canceled",
      autoAckEnvValue: "off",
    }).code === "disabled",
    "the kill switch outranks every other refusal — if it is off, nothing " +
      "else about the order is relevant",
  );
  ok(
    decideAutoAcknowledge({
      eventType: "order_cancel",
      leaflyOrderId: "",
      acknowledgedAt: "x",
      leaflyStatus: "canceled",
      autoAckEnvValue: undefined,
    }).code === "not_a_submission",
    "…then the event type, because a non-submission is not our business at all",
  );

  // --- 5. TOTALITY ---------------------------------------------------------
  // Every reachable combination must produce a decision with a real sentence,
  // and `shouldAcknowledge` must agree with `code` in BOTH directions. A
  // refusal that forgets to say why is a silent skip wearing a return type.
  let acknowledgedCount = 0;
  let refusedCount = 0;
  for (const eventType of ["order_submit", "order_cancel", "", null]) {
    for (const idValue of ["ord-1", "", null]) {
      for (const ackedAt of [null, "2026-09-24T10:00:00.000Z"]) {
        for (const status of ["pending", "confirmed", "canceled", "expired", null]) {
          for (const env of [undefined, "0", "1"]) {
            const d = decideAutoAcknowledge({
              eventType,
              leaflyOrderId: idValue,
              acknowledgedAt: ackedAt,
              leaflyStatus: status,
              autoAckEnvValue: env,
            });
            ok(
              typeof d.reason === "string" && d.reason.trim().length > 0,
              "every decision explains itself",
            );
            ok(
              d.shouldAcknowledge === (d.code === "acknowledge"),
              "shouldAcknowledge and code can never disagree",
            );
            if (d.shouldAcknowledge) {
              acknowledgedCount += 1;
              // The four preconditions, restated as a guarantee rather than
              // trusted from the branch order above.
              ok(eventType === "order_submit", "only a submission is ever acknowledged");
              ok(idValue === "ord-1", "only a real order id is ever acknowledged");
              ok(ackedAt === null, "only an unacknowledged order is ever acknowledged");
              ok(env !== "0", "never acknowledged while the kill switch is off");
              ok(
                status === "pending" || status === "confirmed" || status === null,
                "only a live order is ever acknowledged",
              );
            } else {
              refusedCount += 1;
            }
          }
        }
      }
    }
  }
  // Guard against a vacuous matrix. If a refactor made the rule refuse
  // everything, every assertion above would still pass by never entering the
  // positive branch — the exact class of silent pass this codebase has been
  // bitten by before.
  ok(
    acknowledgedCount > 0,
    `the matrix actually reached the acknowledge branch (${acknowledgedCount} times)`,
  );
  ok(
    refusedCount > 0,
    `…and actually reached the refusal branches (${refusedCount} times)`,
  );

  // --- 6. THE WORDING ------------------------------------------------------
  ok(
    acknowledgedByKindLabel("auto") === LEAFLY_AUTO_ACK_BADGE,
    "an automatically acknowledged order is labelled as such",
  );
  ok(
    acknowledgedByKindLabel("human") !== acknowledgedByKindLabel("auto"),
    "a human acknowledgement is never described the same way as a machine one",
  );
  ok(
    acknowledgedByKindLabel(null) === null,
    "a row that predates the column says NOTHING rather than guessing 'human' — " +
      "inventing an audit trail is worse than admitting we did not record one",
  );
  ok(
    acknowledgedByKindLabel("robot") === null,
    "an unrecognised kind yields no invented label",
  );
  ok(
    acknowledgedByKindLabel("  AUTO ") === LEAFLY_AUTO_ACK_BADGE,
    "the label lookup tolerates case and padding, as stored values sometimes do",
  );
  ok(
    /not been told|not.*confirm/i.test(LEAFLY_AUTO_ACK_EXPLANATION),
    "the operator explanation states that the shopper has NOT been told yet — " +
      "the single fact that distinguishes acknowledge from confirm",
  );
  ok(
    /confirm/i.test(LEAFLY_AUTO_ACK_EXPLANATION),
    "…and names the button that does tell them",
  );

  // ── confirmPushFailedFromColumn ─────────────────────────────────────────
  // The three-way mapping, asserted on IDENTITY rather than truthiness,
  // because the bug this function prevents is precisely a three-way value
  // being flattened to two. `expect(x).toBeFalsy()` would pass for both
  // `undefined` and `false` and would therefore have caught nothing.
  ok(
    confirmPushFailedFromColumn(undefined) === undefined,
    "an ABSENT column stays undefined — a pre-0230 database says 'I do not know', " +
      "and the planner behaves exactly as it did before L-33 existed",
  );
  ok(
    confirmPushFailedFromColumn(null) === false,
    "an EMPTY column is a positive statement of health, not an absence",
  );
  ok(
    confirmPushFailedFromColumn("2024-01-01T00:00:00.000Z") === true,
    "a recorded timestamp means a confirm push was attempted and FAILED",
  );
  ok(
    confirmPushFailedFromColumn("") === true,
    "any present-but-odd string is still a PRESENT value; it is not silently " +
      "reinterpreted as healthy, because a stored value we cannot parse is a " +
      "reason to show the diagnostic, not to hide it",
  );
  // The trap, stated as an executable assertion so it cannot be reintroduced
  // by someone 'simplifying' the function body back to one line.
  ok(
    confirmPushFailedFromColumn(undefined) !== (undefined !== (null as unknown)),
    "the naive one-liner `x !== null` would report EVERY order in a pre-0230 " +
      "shop as having a failed push, hiding the ordinary Confirm button behind " +
      "'Check this order with Leafly' for the whole shop — B1's failure, " +
      "delivered by B1's fix. This asserts the two disagree.",
  );
  {
    // Totality: every input this function can receive, and proof that the
    // outputs are genuinely three distinct values rather than three spellings
    // of two. A counter prevents a vacuous pass if the loop body is skipped.
    const inputs: Array<string | null | undefined> = [
      undefined,
      null,
      "2024-01-01T00:00:00.000Z",
      "not-a-date",
      "",
    ];
    const seen = new Set<string>();
    let checked = 0;
    for (const input of inputs) {
      const out = confirmPushFailedFromColumn(input);
      checked += 1;
      ok(
        out === undefined || out === true || out === false,
        `confirmPushFailedFromColumn(${JSON.stringify(input)}) returns a ` +
          "member of the declared tri-state and never throws",
      );
      ok(
        (input === undefined) === (out === undefined),
        `undefined-ness is PRESERVED exactly for ${JSON.stringify(input)} — ` +
          "absence in, absence out; never invented, never erased",
      );
      seen.add(String(out));
    }
    ok(checked === inputs.length, "the totality loop actually ran every input");
    ok(
      seen.size === 3,
      "all three outcomes are reachable — the mapping is genuinely tri-state " +
        "and has not been collapsed to a boolean",
    );
  }

  if (failed === 0) {
    console.log(`leafly-auto-ack: ${passed} assertions passed, 0 failed`);
  } else {
    console.error(`leafly-auto-ack: ${passed} passed, ${failed} FAILED`);
  }
  return { passed, failed };
}
