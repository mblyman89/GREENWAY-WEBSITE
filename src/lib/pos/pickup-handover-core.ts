/**
 * src/lib/pos/pickup-handover-core.ts  (POS Slice 17)
 *
 * PURE policy for ONE DOOR out of the pickup queue.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (owner report, verbatim):
 *
 *   "Right now I open the order, and it gives me the option to complete the
 *    sale right there in that screen, or add the order to the register cart
 *    to add more items. I want this to be the only option. The latter
 *    requires going through the age gate scan id feature. The former is just
 *    a check box. I don't like that. Please remove that option."
 *
 * The owner is describing a real compliance asymmetry, and the code confirms
 * it exactly. B28 shipped the pickup queue with TWO ways to hand cannabis to
 * a human, and they were not equally gated:
 *
 *   DOOR 1 — "Complete pickup — $X cash"
 *     Gated by `evaluatePickupCompletion`, whose ID check was, in full:
 *         if (!input.idConfirmed) errors.push(...)
 *     `idConfirmed` was a plain React checkbox in PickupQueueModal. A tick.
 *     No barcode, no date of birth, no expiry, no document type, no record
 *     of what was actually inspected.
 *
 *   DOOR 2 — "Load into a sale"
 *     Loads the order into a register sale. RegisterShell's `onLoaded`
 *     deliberately clears any past-gate snapshot and sets `saleActive`, and
 *     `initialVerdict` is supplied ONLY from `resumeSnapshot?.verdict`. A
 *     loaded order therefore has no verdict, so SaleFlow's
 *         useState<Step>(initialVerdict ? "cart" : "idgate")
 *     lands on "idgate" and the customer goes through the REAL gate in
 *     id-scan-core.ts: AAMVA PDF417 parse, `ageOn` against
 *     MINIMUM_AGE_YEARS (RCW 69.50.357), `isExpired` (expired documents are
 *     not acceptable), the WAC 314-55-150 `ACCEPTABLE_ID_TYPES` list, the
 *     house rules (under-40 always scanned, vertical licenses always
 *     scanned), and an audit record on every manual verification.
 *
 * Same regulated act. Same legal duty. Two doors, one of which was a
 * checkbox. This module closes that door.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY IT IS CLOSED IN THE *CORE* AND NOT JUST IN THE UI
 *
 * Deleting the button would have satisfied the letter of the request while
 * leaving `POST /api/pos/pickup { complete: { idConfirmed: true } }` alive
 * and accepting. A removed button is a UI change; a removed capability is a
 * compliance change. The endpoint is device-authenticated but reachable from
 * anything holding device credentials, so the refusal belongs here, in pure
 * tested policy, where it can be proven by a test rather than asserted.
 *
 * `evaluatePickupCompletion` in pickup-core.ts is intentionally LEFT INTACT.
 * Its other gates (POS-materialized orders, non-active statuses, cash math)
 * are real and are still worth having. This module sits IN FRONT of it and
 * refuses the attestation route outright, so nothing that used to be checked
 * has stopped being checked.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT REPLACES IT
 *
 * The queue keeps every function it had. Opening an order still shows the
 * lines, the totals and the customer note. The single action is now "Start
 * the handover", which loads the order into a register sale and drops the
 * budtender onto the ID gate. Cash is then tendered in the normal sale
 * screen, through the normal completion gate, producing the normal receipt.
 * Nothing is lost except the ability to skip the scan.
 *
 * No React, no DB, no `server-only` — safe for the tsx self-test harness.
 */

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * The ONLY sanctioned route from the pickup queue to a completed handover.
 *
 * "load_into_sale" means: pull the website order into a register sale, run
 * the ID gate, ring it like any other sale. It is the sole member of this
 * union on purpose — adding a second one is a compliance decision that has
 * to be made deliberately, in code review, not by accident in a UI tweak.
 */
export type SanctionedHandoverRoute = "load_into_sale";

export const SANCTIONED_HANDOVER_ROUTE: SanctionedHandoverRoute = "load_into_sale";

/**
 * The message the register and the API both show when the retired
 * attestation route is attempted.
 *
 * It is written for a budtender standing in front of a customer, so it says
 * what to do next, not merely what went wrong. It is exported (rather than
 * typed twice) so the UI and the endpoint can never drift into telling the
 * same person two different stories.
 */
export const CHECKBOX_HANDOVER_RETIRED_MESSAGE =
  "Pickup orders are handed over through the register now: load the order into a sale and scan the customer's ID. " +
  "The ID checkbox was removed because age verification at handover must be a real ID check (WAC 314-55-150).";

/**
 * True when a completion request is the retired checkbox route.
 *
 * Deliberately NOT `idConfirmed === true`. The route is identified by the
 * *shape* of the request — an attempt to complete the pickup directly from
 * the queue — so flipping the checkbox to false cannot smuggle the request
 * past the guard. There is no longer any value of `idConfirmed` that
 * completes a pickup.
 */
export function isRetiredAttestationCompletion(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return "complete" in (body as Record<string, unknown>);
}

export type HandoverRouteVerdict =
  | { allowed: true; route: SanctionedHandoverRoute }
  | { allowed: false; error: string };

/**
 * Decide whether a requested pickup-queue action may proceed.
 *
 * Only the load route is allowed. Everything else — most importantly the
 * checkbox completion — is refused with the same message the UI shows.
 */
export function evaluateHandoverRoute(requested: string | null | undefined): HandoverRouteVerdict {
  if (requested === SANCTIONED_HANDOVER_ROUTE) {
    return { allowed: true, route: SANCTIONED_HANDOVER_ROUTE };
  }
  return { allowed: false, error: CHECKBOX_HANDOVER_RETIRED_MESSAGE };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runPickupHandoverCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // ── The retired route is detected by SHAPE, not by the flag's value ──────
  ok(
    isRetiredAttestationCompletion({ orderId: "o1", complete: { idConfirmed: true } }),
    "a complete{} request is the retired route",
  );
  ok(
    isRetiredAttestationCompletion({ orderId: "o1", complete: { idConfirmed: false } }),
    "idConfirmed:false does NOT sneak past — the route is refused by shape",
  );
  ok(
    isRetiredAttestationCompletion({ orderId: "o1", complete: {} }),
    "an empty complete{} is still the retired route",
  );
  ok(
    !isRetiredAttestationCompletion({ orderId: "o1", load: { employeeName: "Casey" } }),
    "the load route is not the retired route",
  );
  ok(!isRetiredAttestationCompletion({ orderId: "o1" }), "a plain detail request is not the retired route");
  ok(!isRetiredAttestationCompletion(null), "null is not the retired route");
  ok(!isRetiredAttestationCompletion("complete"), "a bare string is not the retired route");
  ok(!isRetiredAttestationCompletion(42), "a number is not the retired route");

  // ── Only the load route is sanctioned ───────────────────────────────────
  const load = evaluateHandoverRoute("load_into_sale");
  ok(load.allowed === true, "load_into_sale is allowed");
  ok(load.allowed && load.route === "load_into_sale", "the allowed verdict names the route");

  const complete = evaluateHandoverRoute("complete");
  ok(complete.allowed === false, "the checkbox completion route is refused");
  ok(
    !complete.allowed && complete.error === CHECKBOX_HANDOVER_RETIRED_MESSAGE,
    "the refusal uses the shared message (UI and API cannot drift)",
  );
  ok(evaluateHandoverRoute(null).allowed === false, "null route is refused");
  ok(evaluateHandoverRoute(undefined).allowed === false, "undefined route is refused");
  ok(evaluateHandoverRoute("").allowed === false, "empty route is refused");
  ok(evaluateHandoverRoute("LOAD_INTO_SALE").allowed === false, "the route match is case-sensitive, not fuzzy");
  ok(evaluateHandoverRoute("load_into_sale ").allowed === false, "no whitespace tolerance on a compliance route");

  // ── The message must actually help the person holding the bag ───────────
  ok(CHECKBOX_HANDOVER_RETIRED_MESSAGE.includes("scan"), "the message says to scan the ID");
  ok(CHECKBOX_HANDOVER_RETIRED_MESSAGE.includes("WAC 314-55-150"), "the message cites the rule");
  ok(
    CHECKBOX_HANDOVER_RETIRED_MESSAGE.includes("load the order into a sale"),
    "the message says what to do next, not just what failed",
  );

  // ── There is exactly ONE sanctioned route (guards against a quiet re-add)
  ok(SANCTIONED_HANDOVER_ROUTE === "load_into_sale", "the single sanctioned route is the scanned one");

  if (fail > 0) throw new Error(`pickup-handover-core: ${fail} assertion(s) failed`);
  console.log(`pickup-handover-core: PASSED ${pass} assertions`);
}
