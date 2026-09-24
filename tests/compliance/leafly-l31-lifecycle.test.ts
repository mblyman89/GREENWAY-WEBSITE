/**
 * tests/compliance/leafly-l31-lifecycle.test.ts
 *
 * SLICE L-31 — THE ORDER THAT COULD NOT FINISH.
 *
 * ===========================================================================
 * WHAT WENT WRONG, IN THE OWNER'S WORDS
 * ===========================================================================
 *   > "I clicked confirm first, then ready for pick up, then picked up. but
 *   >  the order does not change from open to completed and stays visible in
 *   >  the table."
 *   > "the communication from leafly from going through the process only
 *   >  generated one email."
 *   > "the mark picked up button produces a popup asking to confirm the
 *   >  action... I want you to get rid of the confirmation pop up."
 *
 * Three complaints. TWO of them turned out to be the same defect, and that is
 * the finding worth recording: the missing emails and the stuck order have
 * one cause, because under Leafly's contract a status push and a customer
 * notification are the same event.
 *
 * ===========================================================================
 * THE THREE DEFECTS, ALL OMISSIONS, NONE OF WHICH RAISED AN ERROR
 * ===========================================================================
 * Proven by execution in `scripts/recon/l31-status-persistence-probe.mjs`
 * (exit 0) before a line of the fix was written:
 *
 *   D1. `setLeaflyOrderStatus()` called Leafly, got a 200, and recorded the
 *       attempt — but NEVER wrote `leafly_status` back to `leafly_orders`.
 *       `placeLeaflyOrder()` buckets the board exclusively on that column, so
 *       the card never moved; and `decideStatusChange(pending -> confirmed)`
 *       stayed legal from the stale value, so "Confirm order" was re-offered
 *       forever. That is precisely the owner's screenshot.
 *
 *   D2. Leafly responds to `POST /status` with **200 and the full Order**.
 *       We logged that body into `responseBody` and discarded it — while a
 *       tested parser (`normaliseFetchedOrder`) and a tested writer
 *       (`storeFetchedLeaflyOrder`) for that exact shape sat unused.
 *
 *   D3. `bridge-server.ts` exported arrived / accepted / canceled. There was
 *       NO completion stage at all. Nothing anywhere in the repository could
 *       move a Greenway order to `completed` in response to a pickup, so the
 *       order could not reach the hidden table because it could not reach the
 *       status the hidden table filters on.
 *
 * Every one of these is an OMISSION. Omissions produce no error, no failed
 * request and no log line — "nothing happened" rather than "something broke".
 * That is why this suite asserts on the PRESENCE OF WIRING, not merely on
 * behaviour: a behavioural test cannot fail for code that does not exist.
 *
 * ===========================================================================
 * THE COMMUNICATION ANSWER, FROM THE AUTHORITATIVE DOCUMENT
 * ===========================================================================
 * The owner asked us to go back to the docs rather than guess. We
 * re-downloaded the spec live this slice; it is BYTE-IDENTICAL to the
 * vendored copy (md5 daab7bcf6f77177de85425adf7f805f1). Under Expectations,
 * verbatim:
 *
 *   "Leafly will be the sole originator of automated consumer facing
 *    communications related to orders placed on the Leafly platform. That is,
 *    Leafly shoppers should receive no automated emails or text messages from
 *    a partner system with regard to order confirmation, status updates, etc."
 *
 * So: there is no notification endpoint we failed to call, and no template we
 * forgot to write. THE STATUS PUSH IS THE NOTIFICATION. One email arrived
 * because, thanks to D1, our board never advanced past the first step even
 * though Leafly had accepted every push. The fix for the stuck order IS the
 * fix for the missing emails.
 *
 * These spec facts are pinned as assertions below against the vendored JSON,
 * so a future contributor who "simplifies" the lifecycle into a single button
 * fails CI instead of silently un-notifying every customer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  lifecycleView,
  decideStatusWriteback,
  planLocalClose,
  runLifecycleCoreSelfTests,
  LEAFLY_PICKUP_STEP_STATUSES,
  LEAFLY_DELIVERY_STEP_STATUSES,
} from "@/lib/leafly/lifecycle-core";
import { LEAFLY_STATUS_ACTION_WORDING } from "@/lib/leafly/order-ack-core";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Strip comments before asserting on CODE.
 *
 * Not a nicety — this test suite caught itself with it. The assertion
 * "LeaflyOrderActions.tsx must not contain preventDefault" failed on the
 * FIRST run against a file that does not call preventDefault anywhere: the
 * three matches were all in the header comment EXPLAINING why it must never
 * be called. An unstripped source assertion cannot tell a prohibition from
 * its own documentation, so writing the reason down would have broken the
 * build and the "fix" would have been to delete the explanation.
 *
 * Local copy rather than an import: nine compliance suites already define
 * this privately, it is four lines of regex rather than a RULE, and house
 * rule 11 governs shared decision logic, not test scaffolding. Importing
 * across test files would also couple this suite's failure mode to an
 * unrelated suite's refactor.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SPEC_PATH = "docs/leafly-specs/order-api-v1.openapi.json";
const ACK_SERVER = "src/lib/leafly/order-ack-server.ts";
const BRIDGE_SERVER = "src/lib/leafly/bridge-server.ts";
const ACTIONS_TSX = "src/components/admin/orders/LeaflyOrderActions.tsx";
const STRIP_TSX = "src/components/admin/orders/LeaflyLifecycleStrip.tsx";
const PANEL_TSX = "src/components/admin/orders/LeaflyOrdersPanel.tsx";
const CORE = "src/lib/leafly/lifecycle-core.ts";

/* ========================================================================== *
 * 1. THE PURE CORE
 * ========================================================================== */

describe("L-31 · the lifecycle core", () => {
  it("passes its own self-tests", () => {
    // The core carries ~23 deterministic assertions covering every phase,
    // both fulfilment mechanisms and the writeback fallback. Running them
    // here means they gate CI rather than only running when somebody
    // remembers to call them.
    const result = runLifecycleCoreSelfTests();
    expect(result.passed).toBeGreaterThanOrEqual(20);
  });

  it("reproduces the owner's exact stuck state and names ONE next action", () => {
    // Acknowledged, Leafly still says `pending`: the state in the screenshot.
    const view = lifecycleView({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });

    expect(view.phase).toBe("in_progress");
    expect(view.nextStatus).toBe("confirmed");
    expect(view.isClosed).toBe(false);

    // The heart of the owner's request: exactly one step is "current". Four
    // equally-weighted buttons with no current step is what made him say
    // "I THINK the process worked end to end".
    const current = view.steps.filter((s) => s.state === "current");
    expect(current).toHaveLength(1);
    expect(current[0]!.key).toBe("confirmed");
  });

  it("marks the order closed once Leafly says picked_up", () => {
    const view = lifecycleView({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "picked_up",
      fulfillmentMechanism: "pickup",
    });
    expect(view.phase).toBe("complete");
    expect(view.isClosed).toBe(true);
    expect(view.nextStatus).toBeNull();
    expect(view.nextLabel).toBeNull();
    expect(view.steps.every((s) => s.state === "done")).toBe(true);
    expect(view.progress).toBe(1);
  });

  it("never shows more than one current step, in any reachable state", () => {
    const statuses = [
      "",
      "pending",
      "confirmed",
      "ready",
      "out_for_delivery",
      "arrived_at_customer",
      "picked_up",
      "canceled",
      "expired",
      "nonsense_value_from_the_future",
    ];
    for (const ack of [null, "2026-01-01T00:00:00Z"]) {
      for (const mech of ["pickup", "delivery", null, "curbside"]) {
        for (const status of statuses) {
          const view = lifecycleView({
            acknowledgedAt: ack,
            leaflyStatus: status,
            fulfillmentMechanism: mech,
          });
          const current = view.steps.filter((s) => s.state === "current");
          expect(
            current.length,
            `ack=${ack} mech=${mech} status=${status}`,
          ).toBeLessThanOrEqual(1);
          expect(view.progress).toBeGreaterThanOrEqual(0);
          expect(view.progress).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("does not offer delivery steps for a pickup order", () => {
    // Washington does not permit cannabis delivery. Padding a pickup order
    // with two steps it can never complete would make a finished order look
    // permanently two-thirds done.
    const view = lifecycleView({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "ready",
      fulfillmentMechanism: "pickup",
    });
    const keys = view.steps.map((s) => s.key);
    expect(keys).not.toContain("out_for_delivery");
    expect(keys).not.toContain("arrived_at_customer");

    // ...and an UNKNOWN mechanism must fall back to pickup, never unlock
    // delivery. Defaulting the other way would invent an illegal workflow.
    const unknown = lifecycleView({
      acknowledgedAt: "2026-01-01T00:00:00Z",
      leaflyStatus: "ready",
      fulfillmentMechanism: "something_new",
    });
    expect(unknown.steps.map((s) => s.key)).not.toContain("out_for_delivery");
  });

  it("shows no raw enum values as labels", () => {
    // `picked_up` on a screen is a developer's word, not a budtender's.
    for (const mech of ["pickup", "delivery"]) {
      const view = lifecycleView({
        acknowledgedAt: "2026-01-01T00:00:00Z",
        leaflyStatus: "confirmed",
        fulfillmentMechanism: mech,
      });
      for (const step of view.steps) {
        expect(step.label).not.toMatch(/_/);
        expect(step.label).not.toBe(step.key);
      }
    }
  });
});

/* ========================================================================== *
 * 2. THE WRITEBACK (D1 + D2)
 * ========================================================================== */

describe("L-31 · what a successful push writes back", () => {
  it("prefers Leafly's own response body over what we asked for", () => {
    const w = decideStatusWriteback({
      requestedStatus: "ready",
      responseStatus: "ready",
    });
    expect(w.status).toBe("ready");
    expect(w.source).toBe("response_body");
    expect(w.usedResponseBody).toBe(true);
  });

  it("trusts the body even when it DISAGREES with the request", () => {
    // If Leafly normalised or clamped the transition, the body is the truth
    // and our intent is not. Believing our intent over their confirmation is
    // the exact class of bug this slice exists to fix.
    const w = decideStatusWriteback({
      requestedStatus: "ready",
      responseStatus: "confirmed",
    });
    expect(w.status).toBe("confirmed");
    expect(w.source).toBe("response_body");
  });

  it("falls back to the requested status when the body is unusable", () => {
    // A 200 with an unreadable body still means the transition HAPPENED.
    // Refusing to record it would leave the row stale for the very reason
    // we are fixing.
    for (const bad of [null, undefined, "", "   "]) {
      const w = decideStatusWriteback({
        requestedStatus: "picked_up",
        responseStatus: bad,
      });
      expect(w.status).toBe("picked_up");
      expect(w.source).toBe("requested");
      expect(w.usedResponseBody).toBe(false);
    }
  });

  it("the status push actually persists — the wiring exists (D1/D2)", () => {
    const src = read(ACK_SERVER);
    // A behavioural test cannot catch a missing write, so assert the wiring.
    expect(src).toContain("persistStatusAfterPush");
    expect(src).toContain("decideStatusWriteback");
    expect(src).toContain("storeFetchedLeaflyOrder");
    expect(src).toContain("normaliseFetchedOrder");

    // It must be gated on SUCCESS. Persisting after a 400 would write a
    // status Leafly never accepted — worse than not writing at all.
    expect(src).toMatch(
      /assessment\.disposition === "success"[\s\S]{0,400}persistStatusAfterPush/,
    );
  });

  it("reuses the existing parser and writer rather than inventing new ones", () => {
    // House rule 11. A second reader of the Order shape is a second thing to
    // keep in sync with the spec, and the one that drifts is always the one
    // nobody remembered existed.
    const src = read(ACK_SERVER);
    expect(src).toContain('await import("./order-fetch-core")');
    expect(src).toContain('await import("./order-fetch-server")');
  });
});

/* ========================================================================== *
 * 3. CLOSING THE LOCAL ORDER (D3)
 * ========================================================================== */

describe("L-31 · closing the register order", () => {
  it("picked_up closes the Greenway order as completed", () => {
    const plan = planLocalClose({
      leaflyStatus: "picked_up",
      localOrderId: "abc-123",
    });
    expect(plan.shouldClose).toBe(true);
    expect(plan.localStatus).toBe("completed");
  });

  it("canceled and expired close it as cancelled — with TWO Ls", () => {
    // The spelling trap that will bite somebody one day: Leafly spells it
    // `canceled` (one L), Greenway's own CHECK constraint from migration 0007
    // spells it `cancelled` (two Ls). Writing Leafly's spelling into our
    // column violates the constraint.
    for (const status of ["canceled", "expired"]) {
      const plan = planLocalClose({ leaflyStatus: status, localOrderId: "abc" });
      expect(plan.shouldClose).toBe(true);
      expect(plan.localStatus).toBe("cancelled");
    }
  });

  it("does NOT close on a mid-lifecycle status", () => {
    for (const status of ["pending", "confirmed", "ready", "out_for_delivery"]) {
      const plan = planLocalClose({ leaflyStatus: status, localOrderId: "abc" });
      expect(plan.shouldClose).toBe(false);
      expect(plan.localStatus).toBeNull();
    }
  });

  it("does nothing when no register order is linked, and says why", () => {
    for (const id of [null, undefined, "", "   "]) {
      const plan = planLocalClose({ leaflyStatus: "picked_up", localOrderId: id });
      expect(plan.shouldClose).toBe(false);
      // A silent no-op is indistinguishable from a bug. The reason is the
      // difference between "nothing to do" and "something failed".
      expect(plan.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("the completion bridge exists and is wired (D3)", () => {
    const bridge = read(BRIDGE_SERVER);
    expect(bridge).toContain("export async function onLeaflyOrderClosed");
    expect(bridge).toContain("planLocalClose");
    // The caller must actually call it, or the stage is decoration.
    expect(read(ACK_SERVER)).toContain("onLeaflyOrderClosed");
  });

  it("refuses to re-close an order a human already settled", () => {
    const bridge = read(BRIDGE_SERVER);
    // A remote event must not silently overwrite a settled till. The
    // closeable-from list must exclude every terminal Greenway status.
    const match = bridge.match(/CLOSEABLE_FROM\s*=\s*\[([^\]]*)\]/);
    expect(match, "CLOSEABLE_FROM must exist").toBeTruthy();
    const list = match![1]!;
    expect(list).toContain("new");
    expect(list).toContain("ready");
    expect(list).not.toContain("completed");
    expect(list).not.toContain("cancelled");
    expect(list).not.toContain("no_show");
  });

  it("does not fabricate a paid sale from a Leafly pickup", () => {
    // Leafly does not process payments; money is taken at the counter under
    // WAC 314-55-095. `picked_up` means "the customer has their bag", which
    // is NOT the same as "the till recorded a sale".
    const bridge = read(BRIDGE_SERVER);
    const stage = bridge.slice(bridge.indexOf("export async function onLeaflyOrderClosed"));
    expect(stage).not.toMatch(/register_sales|createSale|insert\(\s*\{[^}]*total_cents/);
  });

  it("distinguishes 'not asked to act' from 'asked and failed'", () => {
    // Collapsing these into one boolean is how a harmless no-op starts
    // reporting itself as a failure, which trains operators to ignore
    // warnings that matter.
    const bridge = read(BRIDGE_SERVER);
    expect(bridge).toMatch(/attempted:\s*boolean/);
    expect(read(ACK_SERVER)).toContain("closed.attempted");
  });
});

/* ========================================================================== *
 * 4. THE POPUP THE OWNER ASKED US TO REMOVE
 * ========================================================================== */

describe("L-31 · the 'Mark picked up' confirmation is gone", () => {
  const src = read(ACTIONS_TSX);

  it("only the cancel action confirms", () => {
    // It used to be `action.irreversible && !isAck`, which swept in
    // `picked_up` because that status is terminal in Leafly's spec too.
    expect(src).toContain("const needsConfirm = isCancel;");
    expect(src).not.toContain("const needsConfirm = action.irreversible && !isAck;");
  });

  it("keeps the CANCEL confirmation — the instruction was not that wide", () => {
    // Cancel destroys a sale, is pressed rarely, and its consequence has NOT
    // already happened when the button is pressed. Removing its guard would
    // be reading the owner's request wider than he gave it.
    expect(src).toContain("ConfirmDialog");
    expect(src).toContain("Cancel this order on Leafly?");
  });

  it("relocates the warning rather than deleting the protection", () => {
    // The L-30 pattern: a modal is answered from muscle memory; standing
    // text next to the button is legible every time.
    expect(src).toContain("leafly-terminal-note-");
    expect(src).toMatch(/Final step/);
  });

  it("still never submits a form in order to ask a question", () => {
    // The L-30 invariant, which cost four slices to learn: a submit event in
    // this admin ALWAYS means a real save. The dialog opens from a plain
    // button click, never from a cancelled submit.
    //
    // Asserted against COMMENT-STRIPPED source. The header of that file
    // discusses preventDefault at length precisely because it must never be
    // called; matching raw text would make documenting the rule break it.
    const code = stripComments(src);
    expect(code).not.toMatch(/preventDefault/);
    expect(code).not.toMatch(/onSubmit/);
    expect(code).toContain('type="button"');
  });
});

/* ========================================================================== *
 * 5. THE STEP STRIP
 * ========================================================================== */

describe("L-31 · the operator can see which step they are on", () => {
  it("the strip exists and is rendered on the order card", () => {
    expect(existsSync(join(ROOT, STRIP_TSX))).toBe(true);
    const panel = stripComments(read(PANEL_TSX));

    // MUTATION SWEEP FINDING. The first version of this test asserted only
    // `panel.toContain("LeaflyLifecycleStrip")`, and the mutation "rename the
    // JSX tag to <LeaflyLifecycleStripRemoved>" SURVIVED it — because the
    // import line still contained the substring. The strip could be deleted
    // from the card entirely while the test stayed green: the exact "passes
    // for a reason unrelated to the behaviour" failure that L-29 shipped.
    //
    // Assert the IMPORT and the ELEMENT separately, and anchor the element on
    // its opening-tag boundary so a rename cannot satisfy it.
    expect(panel).toMatch(
      /import\s*\{\s*LeaflyLifecycleStrip\s*\}\s*from\s*["']\.\/LeaflyLifecycleStrip["']/,
    );
    expect(panel).toMatch(/<LeaflyLifecycleStrip[\s/>]/);

    // ...and it must be fed the real order fields, not placeholders.
    const element = panel.slice(panel.indexOf("<LeaflyLifecycleStrip"));
    expect(element).toContain("acknowledgedAt={order.acknowledged_at}");
    expect(element).toContain("leaflyStatus={order.leafly_status}");
    expect(element).toContain("fulfillmentMechanism={order.fulfillment_mechanism}");
  });

  it("the strip decides nothing — it only renders lifecycleView()", () => {
    const strip = read(STRIP_TSX);
    expect(strip).toContain("lifecycleView");
    // No second copy of Leafly's transition rules living in a component.
    expect(strip).not.toMatch(/decideStatusChange|LEAFLY_ORDER_STATUS_SEQUENCE/);
  });

  it("is a server component — it cannot fail to hydrate", () => {
    const strip = read(STRIP_TSX);
    expect(strip.startsWith('"use client"')).toBe(false);
    expect(strip).not.toContain("useState");
    expect(strip).not.toContain("useEffect");
  });

  it("marks the current step with aria-current, not colour alone", () => {
    // A strip whose only signal is colour is unreadable to a colour-blind
    // operator and useless on a washed-out phone screen at a counter.
    //
    // MUTATION SWEEP FINDING. The first version of this test said only
    // `expect(strip).toContain("aria-current")`, and the mutation that
    // renamed the attribute to `data-current` SURVIVED — because the phrase
    // "aria-current" still appeared in the explanatory comment above it. A
    // source assertion that matches its own documentation is not an
    // assertion. Strip comments, and bind the attribute to the step state it
    // must depend on.
    const code = stripComments(read(STRIP_TSX));
    expect(code).toMatch(/aria-current=\{\s*step\.state === "current"/);
    // The glyph carries the meaning too, so the strip survives greyscale.
    expect(code).toMatch(/glyph/);
  });

  it("states that LEAFLY sends the customer messages, not Greenway", () => {
    // The owner lost a whole slice to this question. An operator who thinks
    // our system sends these will debug the wrong system forever.
    const strip = read(STRIP_TSX);
    expect(strip).toContain("leafly-lifecycle-comms-note");
    expect(strip).toMatch(/Leafly sends every customer message/);
  });
});

/* ========================================================================== *
 * 6. THE STRIP AND THE BUTTONS MUST NOT DRIFT APART
 * ========================================================================== */

describe("L-31 · one vocabulary", () => {
  it("every 'Next:' label is EXACTLY the label on the button that does it", () => {
    // The strip says "Next: Mark ready for pickup" and the button says
    // something else -> the operator hunts for a control that does not
    // exist. These live in two different modules, so nothing but this test
    // stops them drifting.
    const statuses = [
      "confirmed",
      "ready",
      "out_for_delivery",
      "arrived_at_customer",
      "picked_up",
    ] as const;

    for (const status of statuses) {
      const mech =
        status === "out_for_delivery" || status === "arrived_at_customer"
          ? "delivery"
          : "pickup";
      // Drive the view to the state whose NEXT action is `status`.
      const priorIndex = [
        "confirmed",
        "ready",
        "out_for_delivery",
        "arrived_at_customer",
        "picked_up",
      ].indexOf(status);
      const prior =
        priorIndex === 0
          ? "pending"
          : (["confirmed", "ready", "out_for_delivery", "arrived_at_customer"] as const)[
              priorIndex - 1
            ]!;

      const view = lifecycleView({
        acknowledgedAt: "2026-01-01T00:00:00Z",
        leaflyStatus: prior,
        fulfillmentMechanism: mech,
      });

      expect(view.nextStatus, `next after ${prior} (${mech})`).toBe(status);
      expect(view.nextLabel).toBe(LEAFLY_STATUS_ACTION_WORDING[status]!.label);
    }
  });
});

/* ========================================================================== *
 * 7. SPEC FACTS, PINNED
 * ========================================================================== */

describe("L-31 · the vendored Leafly spec still says what we built on", () => {
  const spec = JSON.parse(read(SPEC_PATH)) as Record<string, unknown>;
  const text = read(SPEC_PATH);

  it("declares exactly the eight statuses the core sequences", () => {
    // Read the SCHEMA, not a regex over the serialised document. The first
    // draft of this test globbed `"OrderStatus"[\s\S]{0,600}` and matched the
    // first *reference* to the name — a `$ref` list of request examples in
    // the status path — rather than the enum itself. It failed, correctly,
    // and the lesson is the L-28 one again: an unscoped source match is a
    // much weaker claim wearing the same clothes.
    const schemas = (spec.components as Record<string, unknown>)
      .schemas as Record<string, { enum?: string[] }>;
    const values = schemas.OrderStatus?.enum;
    expect(values, "components.schemas.OrderStatus.enum must exist").toBeTruthy();
    expect(values).toEqual([
      "pending",
      "confirmed",
      "ready",
      "out_for_delivery",
      "arrived_at_customer",
      "picked_up",
      "canceled",
      "expired",
    ]);
  });

  it("says Leafly is the SOLE originator of customer communications", () => {
    // THE answer to the owner's question, pinned so a future contributor
    // cannot "helpfully" add a Greenway confirmation email and put us in
    // breach of the integration contract.
    //
    // NOTE the `_no_`: the sentence is markdown inside a JSON string and the
    // word is emphasised. The first draft of this assertion searched for a
    // plain "no" and failed — which is exactly the kind of near-miss that,
    // written the other way round (a regex loose enough to pass), would have
    // let the clause be edited out of the spec without anyone noticing.
    expect(text).toMatch(/sole originator of automated consumer facing communications/i);
    expect(text).toMatch(/shoppers should receive _?no_? automated emails or text messages/i);
    expect(text).toMatch(/order confirmation, status updates/i);
  });

  it("responds to a status change with 200 and the full Order, not 204", () => {
    // This is what made D2 a defect rather than a missed nicety: the truth
    // was already in our hands and we were throwing it away.
    const statusPath = JSON.stringify(
      (spec.paths as Record<string, unknown>)[
        "/{order_integration_key}/orders/{id}/status"
      ],
    );
    expect(statusPath).toContain('"200"');
    expect(statusPath).toContain("OrderResponse");
  });

  it("forbids collapsing the lifecycle into a single button", () => {
    // The tempting "one button that just marks it picked up" is explicitly
    // illegal, which is why the strip walks the operator through the steps
    // instead of shortcutting them.
    expect(text).toMatch(/supporting only direct movement to .?picked_up.? would not be allowed/i);
  });

  it("the step lists match what the spec permits", () => {
    expect([...LEAFLY_PICKUP_STEP_STATUSES]).toEqual(["confirmed", "ready", "picked_up"]);
    expect([...LEAFLY_DELIVERY_STEP_STATUSES]).toEqual([
      "confirmed",
      "ready",
      "out_for_delivery",
      "arrived_at_customer",
      "picked_up",
    ]);
  });

  it("the core cites the spec checksum it was written against", () => {
    // If somebody re-vendors the spec, this is the breadcrumb that tells them
    // which document the rules in the core were derived from.
    expect(read(CORE)).toContain("daab7bcf6f77177de85425adf7f805f1");
  });
});
