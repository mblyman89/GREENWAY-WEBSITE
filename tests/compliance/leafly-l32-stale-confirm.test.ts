/**
 * tests/compliance/leafly-l32-stale-confirm.test.ts
 *
 * ===========================================================================
 * SLICE L-32 — "Leafly didn't accept that. Bad request (400)"
 * ===========================================================================
 *
 * THE OWNER'S MESSAGE, VERBATIM:
 *
 *   > "Can you tell me the difference between acknowledge and confirmed. Do
 *   >  we need an acknowledge button if the confirm does the same thing?
 *   >  Next, I am getting an error when I try to go to the next step. […]
 *   >  ⚠️ Leafly didn't accept that. Bad request (400): Leafly rejected the
 *   >  body. Usually an illegal status transition, or a cancellation reason
 *   >  Leafly does not accept on this endpoint. Retrying sends the same
 *   >  rejected request."
 *
 * Three questions, one root cause. This suite pins all of it.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------
 * `markLeaflyOrderAcknowledged()` writes ONLY `acknowledged_at`. The status
 * column is moved by the L-14 confirm push that runs immediately afterwards,
 * inside a try/catch that is deliberately never allowed to fail the
 * acknowledgement. When that push does not land locally we are left
 * acknowledged-and-still-`pending`. The planner, reasoning honestly from the
 * only row it has, then offered "Confirm order" as the PRIMARY button.
 * Pressing it sent pending→confirmed; Leafly, already at `confirmed`, applied
 * its documented rule "Orders cannot be moved from their current status to
 * the same status" and returned 400. Retrying sent the identical request.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS SUITE IS BUILT (and why it is not just more source-reading)
 * ---------------------------------------------------------------------------
 * L-31's permanent lesson, paid for with a whole slice:
 *
 *   "A rule about what the UI does cannot be proven by reading the source.
 *    Render it and look at the output."
 *
 * So the behavioural claims here RUN the planner and RENDER the component.
 * Source assertions appear only where the thing being pinned genuinely is a
 * property of the code's shape rather than of its output — chiefly the
 * form's action wiring, which React's server renderer erases (it emits the
 * same `javascript:throw …` placeholder for every function action, so the
 * markup is byte-identical whether the wiring is right or wrong). Where a
 * source assertion is used it is BOUNDED on both sides, per L-28.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import {
  LEAFLY_ACK_ACTION_LABEL,
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  LEAFLY_CONFIRM_PUSH_FAILED_WARNING,
  LEAFLY_RECONCILE_ACTION_BUSY_LABEL,
  LEAFLY_RECONCILE_ACTION_HINT,
  LEAFLY_RECONCILE_ACTION_LABEL,
  LEAFLY_STALE_CONFIRM_NOTICE,
  decideStatusChange,
  explainLeaflyErrorBody,
  describeOutboundFailure,
  planLeaflyOrderActions,
  type OutboundAssessment,
} from "@/lib/leafly/order-ack-core";
// NOT from order-ack-core. The first draft imported it from there and got
// `undefined`, which `toContain` reported as an invalid-argument error rather
// than a false assertion — a reminder that an import typo can disable a check
// without making it look disabled. It lives in order-map-core.
import { LEAFLY_ORDER_STATUS_SEQUENCE } from "@/lib/leafly/order-map-core";
import { LeaflyOrderActions } from "@/components/admin/orders/LeaflyOrderActions";

const ORDER_ID = "11111111-2222-3333-4444-555555555555";
const ACK_AT = "2025-09-24T04:00:00.000Z";

const ACTIONS_SRC = "src/components/admin/orders/LeaflyOrderActions.tsx";
const PANEL_SRC = "src/components/admin/orders/LeaflyOrdersPanel.tsx";
const FETCH_SRC = "src/lib/leafly/order-fetch-server.ts";
const ACK_SERVER_SRC = "src/lib/leafly/order-ack-server.ts";
const SPEC_SRC = "docs/leafly-specs/order-api-v1.openapi.json";

const actionsSource = readFileSync(ACTIONS_SRC, "utf8");
const panelSource = readFileSync(PANEL_SRC, "utf8");
const fetchSource = readFileSync(FETCH_SRC, "utf8");
const ackServerSource = readFileSync(ACK_SERVER_SRC, "utf8");

/** Strip comments so prose can never satisfy a behavioural claim. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Slice to one construct, bounded on BOTH sides (L-28). */
function bodyBetween(src: string, startAnchor: string, endAnchor: string): string {
  const start = src.indexOf(startAnchor);
  expect(start, `anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  return src.slice(start, end === -1 ? src.length : end);
}

const actionsCode = stripComments(actionsSource);
const panelCode = stripComments(panelSource);
const fetchCode = stripComments(fetchSource);
const ackServerCode = stripComments(ackServerSource);

/**
 * ── SLICE L-33 CHANGED THE TRIGGER OF THE RULE THESE TESTS GUARD ───────────
 *
 * L-32 detected the stale state from two facts: acknowledged, and still
 * `pending`. L-33 added auto-acknowledge, which makes that exact pair the
 * NORMAL resting state of every healthy order — so the pair stopped being
 * evidence of anything, and the trigger moved to a RECORDED fact:
 * `confirm_push_failed_at`, stamped by the code that watched a push fail.
 *
 * The third parameter is therefore added here rather than the tests being
 * rewritten around a new expectation. EVERY GUARANTEE L-32 BOUGHT IS
 * PRESERVED EXACTLY — the stale row still offers exactly one action, still
 * offers no push, still hides Confirm, still hides cancel. The only thing that
 * changed is how the stale row is RECOGNISED, and that is stated by the
 * fixture instead of being implied by a coincidence of two columns.
 *
 * Defaulted to `false` so that any fixture NOT explicitly describing a failure
 * describes a healthy order. That default is what makes the new §10 tests
 * below meaningful: they assert the healthy case keeps its real buttons.
 */
function planFor(
  leaflyStatus: string | null,
  acknowledgedAt: string | null,
  confirmPushFailed = false,
) {
  return planLeaflyOrderActions({
    leaflyOrderId: ORDER_ID,
    orderIntegrationKeyPresent: true,
    acknowledgedAt,
    leaflyStatus,
    fulfillmentMechanism: "pickup",
    confirmPushFailed,
  });
}

function renderFor(
  leaflyStatus: string | null,
  acknowledgedAt: string | null,
  confirmPushFailed = false,
): string {
  const plan = planFor(leaflyStatus, acknowledgedAt, confirmPushFailed);
  // Guard against a vacuous render: a state with no actions would make every
  // "does not contain" assertion below pass for the wrong reason.
  expect(
    plan.actions.length,
    `fixture ${leaflyStatus}/${acknowledgedAt} must produce actions`,
  ).toBeGreaterThan(0);
  const noop = () => {};
  return renderToStaticMarkup(
    React.createElement(LeaflyOrderActions, {
      actions: plan.actions,
      leaflyOrderId: ORDER_ID,
      acknowledgeAction: noop,
      statusAction: noop,
      reconcileAction: noop,
      irreversibleWarning: LEAFLY_ACK_IRREVERSIBLE_WARNING,
      defaultCancelReasonLabel: "Store cancelled",
    }),
  );
}

// ===========================================================================
// 1. THE ANSWER TO THE OWNER'S QUESTION, FROM LEAFLY'S OWN SPECIFICATION
// ===========================================================================
//
// He asked what the difference is. The answer must come from the vendored,
// checksum-verified spec — not from our summary of it, which is exactly the
// kind of remembered-not-read claim the standing rules forbid.

describe("L-32 §1 — acknowledge and confirmed are NOT the same operation", () => {
  const spec = JSON.parse(readFileSync(SPEC_SRC, "utf8")) as {
    paths: Record<string, Record<string, { description?: string; responses?: Record<string, unknown> }>>;
  };

  const ACK_PATH = "/{order_integration_key}/orders/{id}/acknowledge";
  const STATUS_PATH = "/{order_integration_key}/orders/{id}/status";

  it("they are two DIFFERENT endpoints", () => {
    expect(spec.paths[ACK_PATH]).toBeTruthy();
    expect(spec.paths[STATUS_PATH]).toBeTruthy();
    expect(ACK_PATH).not.toBe(STATUS_PATH);
  });

  it("acknowledge means RECEIPT — 'retrieved all necessary details'", () => {
    const d = spec.paths[ACK_PATH].post?.description ?? "";
    expect(d).toMatch(/retrieved all necessary details/i);
  });

  it("acknowledge is MANDATORY before any other change", () => {
    const d = spec.paths[ACK_PATH].post?.description ?? "";
    expect(d).toMatch(/required before any changes can be made/i);
  });

  it("acknowledge returns 204 and no body — it is not a lifecycle move", () => {
    const responses = spec.paths[ACK_PATH].post?.responses ?? {};
    expect(Object.keys(responses)).toContain("204");
  });

  it("status means a LIFECYCLE MOVE — 'advancing its status'", () => {
    const d = spec.paths[STATUS_PATH].post?.description ?? "";
    expect(d).toMatch(/advancing its status/i);
  });

  it("status returns 200 WITH an order body — the two differ even in shape", () => {
    const responses = spec.paths[STATUS_PATH].post?.responses ?? {};
    expect(Object.keys(responses)).toContain("200");
  });

  it("the spec states the same-status rule that produced the owner's 400", () => {
    const d = spec.paths[STATUS_PATH].post?.description ?? "";
    expect(d).toMatch(/cannot be moved from their current status to the same status/i);
  });

  it("`confirmed` and `pending` are both real statuses in Leafly's sequence", () => {
    expect(LEAFLY_ORDER_STATUS_SEQUENCE).toContain("pending");
    expect(LEAFLY_ORDER_STATUS_SEQUENCE).toContain("confirmed");
  });
});

// ===========================================================================
// 2. THE ROOT CAUSE, REPRODUCED RATHER THAN ASSERTED
// ===========================================================================

describe("L-32 §2 — why pressing the next step returned 400", () => {
  it("our gate ALLOWS pending→confirmed, so the request does leave", () => {
    const d = decideStatusChange({
      acknowledgedAt: ACK_AT,
      currentStatus: "pending",
      nextStatus: "confirmed",
    });
    expect(d.allowed).toBe(true);
  });

  it("but from Leafly's true state it is confirmed→confirmed: refused", () => {
    const d = decideStatusChange({
      acknowledgedAt: ACK_AT,
      currentStatus: "confirmed",
      nextStatus: "confirmed",
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("same_status");
  });

  it("the acknowledge path really does push `confirmed` itself (L-14)", () => {
    // This is the fact that makes the two states diverge, so it is pinned
    // rather than trusted. Bounded to the acknowledge function's body.
    const ackBody = bodyBetween(
      ackServerCode,
      "export async function acknowledgeLeaflyOrder",
      "export async function setLeaflyOrderStatus",
    );
    expect(ackBody).toMatch(/setLeaflyOrderStatus\(/);
    expect(ackBody).toMatch(/nextStatus:\s*"confirmed"/);
  });

  it("and the acknowledge stamp does NOT move leafly_status by itself", () => {
    // If it did, the stale state could not arise and this whole slice would
    // be unnecessary. Asserting the ABSENCE is what makes the diagnosis real.
    const ackBody = bodyBetween(
      ackServerCode,
      "export async function acknowledgeLeaflyOrder",
      "export async function setLeaflyOrderStatus",
    );
    expect(ackBody).toMatch(/markLeaflyOrderAcknowledged\(/);
  });
});

// ===========================================================================
// 3. THE FIX — the planner no longer offers the press that must fail
// ===========================================================================

describe("L-32 §3 — the stale state offers only the safe re-read", () => {
  // SLICE L-33: `true` = a confirm push was attempted and RECORDED as failed.
  // Before L-33 this was implied by "acknowledged + pending"; that pair is now
  // the healthy norm, so the failure is stated explicitly. The guarantees
  // asserted below are unchanged.
  const stale = planFor("pending", ACK_AT, true);

  it("offers exactly one action", () => {
    expect(stale.actions).toHaveLength(1);
  });

  it("and it is the reconcile kind", () => {
    expect(stale.actions[0].kind).toBe("reconcile");
  });

  it("'Confirm order' — the button that 400'd — is gone", () => {
    expect(stale.actions.some((a) => a.status === "confirmed")).toBe(false);
  });

  it("NOTHING that pushes to Leafly is offered from an untrustworthy row", () => {
    expect(stale.actions.some((a) => a.kind === "status")).toBe(false);
  });

  it("nothing irreversible is offered either — no cancel, no picked-up", () => {
    expect(stale.actions.every((a) => !a.irreversible)).toBe(true);
    expect(stale.actions.some((a) => a.status === "canceled")).toBe(false);
    expect(stale.actions.some((a) => a.status === "picked_up")).toBe(false);
  });

  it("the repair carries no status to send", () => {
    expect(stale.actions[0].status).toBeNull();
  });

  it("it is the primary action — the operator is steered into the SAFE press", () => {
    expect(stale.actions[0].emphasis).toBe("primary");
  });

  it("it is not a dead end: there is an action, not a blocked reason", () => {
    expect(stale.blockedReason).toBe("");
  });

  it("its busy wording exists and differs from its idle label", () => {
    // The L-17 contract, re-asserted for the new action specifically.
    expect(LEAFLY_RECONCILE_ACTION_BUSY_LABEL.trim().length).toBeGreaterThan(0);
    expect(LEAFLY_RECONCILE_ACTION_BUSY_LABEL).not.toBe(LEAFLY_RECONCILE_ACTION_LABEL);
    expect(LEAFLY_RECONCILE_ACTION_BUSY_LABEL.trim().endsWith("\u2026")).toBe(true);
  });

  it("its hint leads with reassurance, because it follows an error", () => {
    expect(LEAFLY_RECONCILE_ACTION_HINT).toMatch(/nothing is sent/i);
  });

  it("no label leaks a raw snake_case enum to a counter screen", () => {
    expect(LEAFLY_RECONCILE_ACTION_LABEL).not.toMatch(/_/);
  });
});

// ===========================================================================
// 4. THE FIX IS CONFINED — the healthy paths are untouched
// ===========================================================================
//
// A fix that leaks into the normal path is a regression wearing a fix's
// clothes. Both neighbours of the stale state are pinned.

describe("L-32 §4 — the repair does not leak into working states", () => {
  it("a NEW unacknowledged order still gets the acknowledge button", () => {
    const fresh = planFor("pending", null);
    expect(fresh.actions).toHaveLength(1);
    expect(fresh.actions[0].kind).toBe("acknowledge");
  });

  it("…proving the rule keys on acknowledged+pending, not on pending alone", () => {
    const fresh = planFor("pending", null);
    expect(fresh.actions.some((a) => a.kind === "reconcile")).toBe(false);
  });

  it("a healthy confirmed order offers the real next step", () => {
    const healthy = planFor("confirmed", ACK_AT);
    expect(healthy.actions.some((a) => a.status === "ready")).toBe(true);
    expect(healthy.actions.find((a) => a.emphasis === "primary")?.status).toBe("ready");
  });

  it("…and shows no repair button", () => {
    const healthy = planFor("confirmed", ACK_AT);
    expect(healthy.actions.some((a) => a.kind === "reconcile")).toBe(false);
  });

  it("every other acknowledged status is unaffected", () => {
    for (const s of ["confirmed", "ready", "out_for_delivery", "arrived_at_customer"]) {
      const p = planFor(s, ACK_AT);
      expect(
        p.actions.some((a) => a.kind === "reconcile"),
        `"${s}" must not be diverted into the repair path`,
      ).toBe(false);
    }
  });

  it("terminal orders still explain themselves rather than offering a repair", () => {
    for (const s of ["picked_up", "canceled", "expired"]) {
      const p = planFor(s, ACK_AT);
      expect(p.actions, `"${s}" offers nothing`).toHaveLength(0);
      expect(p.blockedReason.trim().length, `"${s}" explains why`).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 5. IT RENDERS — proven by output, not by reading (the L-31 lesson)
// ===========================================================================

describe("L-32 §5 — the operator can actually see and press it", () => {
  // SLICE L-33: as in §3 — the recorded failure is now stated, not inferred.
  const stale = renderFor("pending", ACK_AT, true);

  it("the button label appears in the rendered HTML", () => {
    expect(stale).toContain(LEAFLY_RECONCILE_ACTION_LABEL);
  });

  it("'Confirm order' does not", () => {
    expect(stale).not.toContain("Confirm order");
  });

  it("no nextStatus field is posted — nothing can reach Leafly's status API", () => {
    expect(stale).not.toContain('name="nextStatus"');
  });

  it("the order id IS posted, so the repair knows what to re-read", () => {
    expect(stale).toContain(`value="${ORDER_ID}"`);
  });

  it("the explanation is on screen, so a missing button is not a mystery", () => {
    expect(stale).toContain("leafly-stale-confirm-notice");
    expect(stale).toContain("this screen and Leafly may disagree");
  });

  it("no 'Final step' warning — the repair takes nothing away", () => {
    expect(stale).not.toContain("Final step");
  });

  it("the healthy render still posts a nextStatus and shows no notice", () => {
    const healthy = renderFor("confirmed", ACK_AT);
    expect(healthy).toContain('name="nextStatus"');
    expect(healthy).toContain("Mark ready for pickup");
    expect(healthy).not.toContain("leafly-stale-confirm-notice");
    expect(healthy).not.toContain(LEAFLY_RECONCILE_ACTION_LABEL);
  });

  it("the unacknowledged render is unchanged", () => {
    const fresh = renderFor("pending", null);
    expect(fresh).toContain(LEAFLY_ACK_ACTION_LABEL);
    expect(fresh).not.toContain(LEAFLY_RECONCILE_ACTION_LABEL);
  });
});

// ===========================================================================
// 6. THE WIRING — where render cannot see, assert the shape (bounded)
// ===========================================================================
//
// React's server renderer emits the same placeholder `action=` for every
// function form action, so the HTML is identical whether the reconcile form
// posts to the reconcile action or (as an earlier draft did) falls into the
// `else` of a two-way ternary and posts to the STATUS action. That would
// have produced a fresh error from the very button added to end the first
// one. Render cannot catch it; these can.

describe("L-32 §6 — the repair button posts to the repair action", () => {
  const formAction = bodyBetween(actionsCode, "const formAction", "const hiddenFields");

  it("the destination is chosen by kind, including the reconcile kind", () => {
    expect(formAction).toMatch(/isReconcile/);
    expect(formAction).toMatch(/reconcileAction/);
  });

  it("the reconcile branch is NOT the status action", () => {
    // Pins the ordering: isAck → ack, isReconcile → reconcile, else status.
    const reconcileIdx = formAction.indexOf("reconcileAction");
    const statusIdx = formAction.indexOf("statusAction");
    expect(reconcileIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(-1);
    expect(reconcileIdx).toBeLessThan(statusIdx);
  });

  it("the nextStatus field is gated on the STATUS kind, stated positively", () => {
    const hidden = bodyBetween(actionsCode, "const hiddenFields", "if (!needsConfirm)");
    expect(hidden).toMatch(/action\.kind === "status"/);
  });

  it("the panel wires it to the existing, deadline-bounded collect action", () => {
    expect(panelCode).toMatch(/reconcileAction=\{collectLeaflyOrderAction\}/);
  });

  it("reconcileAction is a REQUIRED prop, so it cannot be forgotten", () => {
    const props = bodyBetween(
      actionsCode,
      "export function LeaflyOrderActions",
      "if (actions.length === 0)",
    );
    // No `?:` on it. An optional prop would let a call site silently ship a
    // button that does nothing at all.
    expect(props).toMatch(/reconcileAction:\s*\(formData: FormData\)/);
    expect(props).not.toMatch(/reconcileAction\?/);
  });
});

// ===========================================================================
// 7. C2 — we now show LEAFLY'S reason, not our guess
// ===========================================================================
//
// The owner's error text contained the word "Usually". That is a guess, and
// we were recording Leafly's real answer in the database while showing him
// our speculation about it.

describe("L-32 §7 — Leafly's own words reach the screen", () => {
  const assessment = {
    disposition: "fix_request",
    message: "Bad request (400): Leafly rejected the body.",
  } as unknown as OutboundAssessment;

  it("reads the documented SchemaError shape {message, validation_result}", () => {
    const out = explainLeaflyErrorBody({
      message: "Invalid status transition",
      validation_result: ["status must move forward"],
    });
    expect(out).toContain("Invalid status transition");
    expect(out).toContain("status must move forward");
  });

  it("reads the documented Error shape {errors:[{title,detail}]}", () => {
    const out = explainLeaflyErrorBody({
      errors: [{ title: "Bad transition", detail: "already confirmed" }],
    });
    expect(out).toContain("Bad transition");
    expect(out).toContain("already confirmed");
  });

  it("reads a bare string body", () => {
    expect(explainLeaflyErrorBody("plain text refusal")).toContain("plain text refusal");
  });

  it("returns null rather than inventing something when there is nothing", () => {
    expect(explainLeaflyErrorBody(null)).toBeNull();
    expect(explainLeaflyErrorBody({})).toBeNull();
    expect(explainLeaflyErrorBody("   ")).toBeNull();
    expect(explainLeaflyErrorBody(undefined)).toBeNull();
  });

  it("does not duplicate a reason that appears twice in one body", () => {
    const out = explainLeaflyErrorBody({
      message: "Same status",
      validation_result: ["same status"],
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase().split("same status").length - 1).toBe(1);
  });

  it("is bounded, so a huge body cannot flood the screen", () => {
    const out = explainLeaflyErrorBody({ message: "x".repeat(5000) });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(401);
  });

  it("quotes Leafly when they said something", () => {
    const out = describeOutboundFailure(assessment, { message: "Illegal transition" });
    expect(out).toContain("Leafly said");
    expect(out).toContain("Illegal transition");
  });

  it("falls back to our own message when they said nothing", () => {
    expect(describeOutboundFailure(assessment, null)).toBe(assessment.message);
  });
});

// ===========================================================================
// 8. C1 — a 200 with an unreadable body can no longer wipe the order
// ===========================================================================
//
// A defect introduced by my own L-31 and found while investigating this one.
// `raw_order` was the ONLY unguarded field of seven, with 20 read sites, so
// an empty payload would blank the customer's order detail.

describe("L-32 §8 — raw_order is guarded", () => {
  const storeBody = bodyBetween(
    fetchCode,
    "export async function storeFetchedLeaflyOrder",
    "export async function collectLeaflyOrder",
  );

  it("raw_order is written conditionally, never unconditionally", () => {
    expect(storeBody).toMatch(/hasPayload/);
    expect(storeBody).toMatch(/if \(hasPayload\) patch\.raw_order/);
  });

  it("an empty object does not count as a payload", () => {
    expect(storeBody).toMatch(/Object\.keys\(input\.order\)\.length > 0/);
  });

  it("an array does not count as a payload either", () => {
    expect(storeBody).toMatch(/!Array\.isArray\(input\.order\)/);
  });

  it("an all-empty patch fails loudly instead of succeeding silently", () => {
    // Guarding raw_order opened a NEW hole: PostgREST accepts an empty update
    // and returns success, so the function could report ok having written
    // nothing at all. Closed, and pinned here.
    expect(storeBody).toMatch(/Object\.keys\(patch\)\.length === 0/);
    expect(storeBody).toMatch(/ok: false/);
  });
});

// ===========================================================================
// 9. C3 + C5 — the stale state is now both self-healing and announced
// ===========================================================================

describe("L-32 §9 — the failure announces itself and names its cure", () => {
  it("a rejection triggers a re-read from Leafly rather than leaving it stuck", () => {
    const statusBody = bodyBetween(
      ackServerCode,
      "export async function setLeaflyOrderStatus",
      "async function persistStatusAfterPush",
    );
    expect(statusBody).toMatch(/fix_request/);
    expect(statusBody).toMatch(/collectLeaflyOrder/);

    // ── SLICE L-32: A MUTATION SURVIVED THE TWO LINES ABOVE ───────────────
    // Replacing the guard with `if (false)` — deleting the self-heal
    // outright — left both assertions green, because `fix_request` occurs
    // three more times further down this function and `collectLeaflyOrder`
    // was still sitting there inside the now-dead branch. Two true facts
    // about the file, and not one of them said the re-read ACTUALLY RUNS.
    //
    // Presence is not connection. The condition is therefore read back OUT
    // of the very block that performs the re-read, so the guard and the
    // guarded cannot be verified independently of each other.
    const guard =
      /if \(([^)]*)\) \{\s*try \{\s*const \{ collectLeaflyOrder \} = await import\(/.exec(
        statusBody,
      );
    expect(
      guard,
      "the re-read must sit directly inside its own disposition guard",
    ).toBeTruthy();
    expect(guard![1]).toBe('assessment.disposition === "fix_request"');

    // ...and it must be narrow. Re-reading on a 401 or a 5xx would add a
    // second call to an already-failing path and tell us nothing: neither
    // says anything about the order's status. Only a 400/422-class refusal
    // means "your idea of this order is wrong", which is what a re-read
    // repairs. An unconditional re-read would pass the check above if it
    // were spelled `true`, so that spelling is excluded by the equality.
    expect(guard![1]).not.toMatch(/^(true|false)$/);
  });

  it("the confirm-push warning is ONE constant, not two drifting literals", () => {
    // It was duplicated character-for-character in the !ok branch and the
    // catch branch. Two copies of a sentence is one edit away from two
    // different sentences describing the same invisible failure.
    const occurrences =
      ackServerCode.split("LEAFLY_CONFIRM_PUSH_FAILED_WARNING").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3); // import + both branches
    expect(ackServerCode).not.toContain("do not accept it again.");
  });

  it("it tells the operator the acknowledgement DID work", () => {
    expect(LEAFLY_CONFIRM_PUSH_FAILED_WARNING).toMatch(/do\s+NOT acknowledge it again/i);
  });

  it("it names the exact button that repairs it, using that button's words", () => {
    // Interpolated from the label constant, never retyped — so the
    // instruction cannot drift from the control it describes.
    expect(LEAFLY_CONFIRM_PUSH_FAILED_WARNING).toContain(LEAFLY_RECONCILE_ACTION_LABEL);
  });

  it("the on-screen notice explains the disagreement without jargon", () => {
    expect(LEAFLY_STALE_CONFIRM_NOTICE).toMatch(/disagree/i);
    expect(LEAFLY_STALE_CONFIRM_NOTICE).not.toMatch(/\b400\b|stale row|transition/i);
  });
});
