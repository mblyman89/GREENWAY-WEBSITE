/**
 * tests/compliance/leafly-l30-one-click-acknowledge.test.ts
 *
 * SLICE L-30 — "one click to acknowledge."
 *
 * ===========================================================================
 * THIS FILE REPLACES tests/compliance/leafly-l29-phantom-pending.test.ts
 * ===========================================================================
 * That file contained 37 passing tests for a fix that did not work. It is
 * deleted rather than extended, and the reason is the single most important
 * lesson of this slice:
 *
 *   ITS TESTS WERE NOT MERELY INCOMPLETE. THEY WERE STRUCTURALLY INCAPABLE
 *   OF FAILING.
 *
 * L-29's DOM-level probe delivered clicks with `dispatchEvent(new Event(...))`.
 * Per the HTML specification the microtask checkpoint runs when the JavaScript
 * execution context stack becomes EMPTY. A scripted dispatch holds the entire
 * listener chain inside one stack frame, so a microtask queued by the first
 * listener does not run until the last listener has finished. A REAL user
 * click is dispatched by the browser from a task; each listener is its own
 * callback; the stack empties between them; so the microtask runs BETWEEN
 * listeners.
 *
 * L-29's whole fix rested on `queueMicrotask()` settling AFTER every handler
 * had spoken. That is true under `dispatchEvent()` and false under a real
 * click. The suite proved the fix works in the one world where the bug does
 * not exist. `scripts/recon/l30-real-click-probe.mjs` runs the identical
 * component tree both ways in real Chromium and prints the divergence.
 *
 * A second fact, from `scripts/recon/l30-plain-form-regression-probe.mjs`,
 * finished the idea off: react-dom calls `preventDefault()` ITSELF on every
 * SUCCESSFUL server-action submit — that is how it replaces the native form
 * POST. So `defaultPrevented` is true for "cancelled to ask a question" AND
 * true for "worked perfectly". It never carried the information L-29 read out
 * of it, and no amount of re-timing could have fixed an ambiguous signal.
 *
 * ===========================================================================
 * WHAT THIS SLICE ACTUALLY DOES
 * ===========================================================================
 * The owner: "is it required by leafly to have this double click for
 * acknowledging? if not, please get rid of it. ... one click to acknowledge."
 *
 * Answered from Leafly's own vendored, freshly re-verified specification
 * (md5 daab7bcf6f77177de85425adf7f805f1, byte-identical to the live
 * download). The acknowledge operation takes no body, no confirmation
 * parameter, and no handshake; the requirements table marks the ENDPOINT
 * required and says nothing about a retailer's UI; and Leafly expects
 * acknowledgement within fifteen minutes or the order is auto-cancelled.
 *
 * So: the confirmation was ours, not Leafly's, and it guarded the one action
 * on a clock. It is removed, and its warning now stands permanently on the
 * screen instead of interrupting once.
 *
 * The structural fix underneath: NO FORM MAY SUBMIT IN ORDER TO ASK A
 * QUESTION. That is what made "a submit event happened" stop meaning "a save
 * started", which is the ambiguity four slices have now tripped over.
 *
 * These tests hold all of it: the pure rule, the component shapes, the
 * Leafly-contract facts the decision rests on, and every H12f behaviour the
 * change must not break.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PENDING_FORM_SAFETY_TIMEOUT_MS,
  PENDING_OPT_OUT_ATTR,
  PENDING_SAFETY_TIMEOUT_MS,
  PENDING_STILL_WORKING_MS,
  isEligibleNavClick,
  isServerActionForm,
  pendingHint,
  shouldClearPending,
  submitShouldShowPending,
} from "@/lib/admin/pending-core";
import {
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  planLeaflyOrderActions,
} from "@/lib/leafly/order-ack-core";

const KEEPER_SRC = "src/components/admin/ux/PendingKeeper.tsx";
const ACTIONS_SRC = "src/components/admin/orders/LeaflyOrderActions.tsx";
const CORE_SRC = "src/lib/admin/pending-core.ts";
const SPEC_SRC = "docs/leafly-specs/order-api-v1.openapi.json";

const keeperSource = readFileSync(KEEPER_SRC, "utf8");
const actionsSource = readFileSync(ACTIONS_SRC, "utf8");
const coreSource = readFileSync(CORE_SRC, "utf8");

/** Strip comments so a prose mention can never satisfy a behavioural claim. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Slice the source to one construct, bounded on BOTH sides.
 *
 * L-28 taught this twice in a single slice: an unscoped source assertion
 * silently degrades into "this string appears somewhere in this file", which
 * is a much weaker claim wearing the same clothes. One of its mutations
 * survived for exactly that reason.
 */
function bodyBetween(src: string, startAnchor: string, endAnchor: string): string {
  const start = src.indexOf(startAnchor);
  expect(start, `anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  return src.slice(start, end === -1 ? src.length : end);
}

const keeperCode = stripComments(keeperSource);
const actionsCode = stripComments(actionsSource);
const coreCode = stripComments(coreSource);

const KEEPER_ON_SUBMIT = bodyBetween(
  keeperCode,
  "function onSubmit(e: Event)",
  "document.addEventListener",
);

// ===========================================================================
// 1. THE QUESTION HE ASKED — answered against Leafly's own specification
// ===========================================================================
describe("L-30 — does Leafly require a confirmation before acknowledging?", () => {
  const spec = JSON.parse(readFileSync(SPEC_SRC, "utf8")) as {
    info: { description: string };
    paths: Record<string, Record<string, unknown>>;
  };
  const ACK_PATH = "/{order_integration_key}/orders/{id}/acknowledge";
  const ackPath = spec.paths[ACK_PATH] as Record<string, unknown>;
  const ackPost = ackPath.post as {
    description: string;
    requestBody?: unknown;
    parameters?: unknown[];
  };

  it("the acknowledge endpoint exists exactly where we call it", () => {
    expect(ackPost).toBeTruthy();
    expect(ackPost.description).toMatch(/Acknowledgement of order receipt is required/i);
  });

  it("takes NO request body — there is no confirmation flag to send", () => {
    // The strongest possible form of the answer: if Leafly wanted a two-step
    // acknowledgement there would have to be somewhere to put the second step.
    expect(ackPost.requestBody).toBeUndefined();
  });

  it("takes NO operation-level parameters beyond the path identifiers", () => {
    // Path-level params are the integration key and the order id. The POST
    // itself adds nothing — no ?confirmed=true, no idempotency handshake.
    expect(ackPost.parameters).toBeUndefined();
  });

  it("the spec never asks for a confirmation step anywhere in the order flow", () => {
    const body = JSON.stringify(spec).toLowerCase();
    // Leafly's document does contain the word "confirmed" — it is an order
    // STATUS in the lifecycle, which is a different thing entirely and is
    // handled by the status endpoint. What it never does is require a
    // retailer to double-confirm the acknowledgement.
    expect(body).not.toMatch(/double[- ]confirm/);
    expect(body).not.toMatch(/confirmation (dialog|prompt|step) (is )?required/);
  });

  it("Leafly instead demands SPEED: 15 minutes or the order is auto-cancelled", () => {
    // This is the affirmative case for removing the modal, not merely the
    // absence of a case for keeping it. A dialog that waits on a human being
    // is a liability against a fifteen-minute clock.
    expect(spec.info.description).toMatch(
      /within fifteen minutes[\s\S]*?auto canceled/i,
    );
  });

  it("the ENDPOINT is required; nothing about a retailer's screen is", () => {
    expect(spec.info.description).toMatch(/\|\s*Acknowledge Order\s*\|\s*Endpoint/);
  });

  it("acknowledging really does revoke the ID images — so the warning stays", () => {
    // The risk the dialog guarded is real. L-30 relocates the warning; it
    // does not pretend the hazard went away.
    expect(ackPost.description).toMatch(/access to an order's associated media is revoked/i);
  });
});

// ===========================================================================
// 2. THE PURE RULE — and why it cannot repeat L-29's mistake
// ===========================================================================
describe("L-30 — submitShouldShowPending: the replacement rule", () => {
  const real = { serverAction: true, formConnected: true, optedOut: false };

  it("a genuine server-action save shows the bar", () => {
    expect(submitShouldShowPending(real)).toBe(true);
  });

  it("a client panel's own form is left alone", () => {
    expect(submitShouldShowPending({ ...real, serverAction: false })).toBe(false);
  });

  it("a form that left the document is not pending — nothing to spin on", () => {
    expect(submitShouldShowPending({ ...real, formConnected: false })).toBe(false);
  });

  it("an explicit opt-out is honoured", () => {
    expect(submitShouldShowPending({ ...real, optedOut: true })).toBe(false);
  });

  it("is pure — same input, same answer, no hidden state", () => {
    const runs = Array.from({ length: 5 }, () => submitShouldShowPending(real));
    expect(new Set(runs).size).toBe(1);
  });

  it("THE LESSON: the rule has no input that differs between a scripted and a real click", () => {
    // This is the test that would have prevented L-29 from shipping.
    //
    // Every field of SubmitStart is a fact about the DOM — is it a server
    // action, is it connected, does it carry the marker. None of them depend
    // on event-dispatch timing, on microtask ordering, or on who called
    // preventDefault(). That is precisely the property L-29's rule lacked:
    // it read `defaultPrevented`, whose value at the moment of reading
    // depended entirely on how the click was delivered.
    const ruleBody = bodyBetween(
      coreCode,
      "export function submitShouldShowPending",
      "\n}",
    );
    expect(ruleBody).not.toMatch(/defaultPrevented/);
    expect(ruleBody).not.toMatch(/queueMicrotask|setTimeout|Promise/);
  });

  it("the ambiguous signal is gone from the core entirely", () => {
    // Not merely unused — removed. A dead export invites a future caller.
    expect(coreCode).not.toMatch(/export function submitDidStart/);
    expect(coreCode).not.toMatch(/\bSubmitSettle\b/);
  });

  it("the opt-out marker is a shared constant, not a hand-typed string", () => {
    // A silently misspelled data attribute is exactly how this class of bug
    // comes back: the form opts out, the keeper never notices, and the
    // phantom spinner returns with no failing test.
    expect(PENDING_OPT_OUT_ATTR).toBe("data-gw-no-pending");
    expect(keeperCode).toMatch(/PENDING_OPT_OUT_ATTR/);
    expect(keeperCode).not.toMatch(/"data-gw-no-pending"/);
  });
});

// ===========================================================================
// 3. THE KEEPER — decides immediately, reads no event flags
// ===========================================================================
describe("L-30 — PendingKeeper stops inferring", () => {
  it("still listens in the capture phase (it must see every admin form)", () => {
    expect(keeperCode).toMatch(/addEventListener\("submit", onSubmit, true\)/);
  });

  it("the SUBMIT path never branches on defaultPrevented", () => {
    // The single most important assertion in this file. react-dom 19 calls
    // preventDefault() to take over from the native POST, so on a FORM this
    // flag is true for a successful save. Reading it is how L-29 got here.
    //
    // Scoped to the submit listener on purpose. The nav-click listener may
    // legitimately read the same flag, because on an ANCHOR click there is no
    // React form-action plugin cancelling the default — a prevented anchor
    // click really does mean "something else handled this, do not navigate".
    // The flag is not universally bad; it is bad as a proxy for "did a save
    // start". An unscoped assertion here would have outlawed a correct use
    // and taught the next reader the wrong lesson.
    expect(KEEPER_ON_SUBMIT).not.toMatch(/defaultPrevented/);
  });

  it("the nav path's use of the flag is the only one left, and is deliberate", () => {
    const navListener = bodyBetween(
      keeperCode,
      "function onClick(e: MouseEvent)",
      'addEventListener("click"',
    );
    expect(navListener).toMatch(/defaultPrevented: e\.defaultPrevented/);
    // and it reaches the pure rule, not an inline if.
    expect(navListener).toMatch(/isEligibleNavClick\(/);
  });

  it("does NOT defer the decision to a microtask", () => {
    // A real click runs a microtask checkpoint between listeners, so a
    // deferred decision is not "later" in any useful sense — it is simply
    // racing the rest of the dispatch. Decide synchronously or not at all.
    expect(KEEPER_ON_SUBMIT).not.toMatch(/queueMicrotask/);
    expect(KEEPER_ON_SUBMIT).not.toMatch(/setTimeout/);
  });

  it("asks the pure rule, rather than re-implementing it inline", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/submitShouldShowPending\(/);
    expect(keeperCode).toMatch(/import[\s\S]*?submitShouldShowPending[\s\S]*?pending-core/);
  });

  it("feeds the rule all three facts it needs", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/serverAction:\s*isServerActionForm\(/);
    expect(KEEPER_ON_SUBMIT).toMatch(/formConnected:\s*form\.isConnected/);
    expect(KEEPER_ON_SUBMIT).toMatch(/optedOut:\s*form\.hasAttribute\(PENDING_OPT_OUT_ATTR\)/);
  });

  it("keeps the double-submit guard for genuine saves", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/gwBusy === "1"/);
    expect(KEEPER_ON_SUBMIT).toMatch(/stopPropagation\(\)/);
  });

  it("starts pending only after the rule says yes", () => {
    // Order matters: the guard clause must return BEFORE startPending runs,
    // otherwise the rule is decorative.
    const guardAt = KEEPER_ON_SUBMIT.indexOf("submitShouldShowPending");
    const startAt = KEEPER_ON_SUBMIT.indexOf("startPending(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(guardAt);
  });

  it("the file carries the standing prohibition so it is not silently undone", () => {
    expect(keeperSource).toMatch(/may branch on `event\.defaultPrevented`/);
  });

  it("the nav-click listener is unchanged and still only matches anchors", () => {
    // Ruled out as a suspect early in L-30 and must stay ruled out: a
    // <button> can never satisfy closest("a[href]").
    expect(keeperCode).toMatch(/closest\?\.\("a\[href\]"\)/);
  });
});

// ===========================================================================
// 4. THE COMPONENT — one click, and no form that submits to ask a question
// ===========================================================================
describe("L-30 — LeaflyOrderActions: one click to acknowledge", () => {
  it("NO form in this file cancels its own submit, ever", () => {
    // THE STRUCTURAL FIX. This is what makes "a submit event happened" mean
    // "a save started" again, for every listener in the admin — not just for
    // this panel. Four slices were spent on the consequences of it not being
    // true.
    expect(actionsCode).not.toMatch(/preventDefault/);
  });

  it("no form here has an onSubmit handler at all", () => {
    expect(actionsCode).not.toMatch(/onSubmit/);
  });

  it("the L-29 render-closure hazards are structurally absent, not patched", () => {
    expect(actionsCode).not.toMatch(/confirmedRef/);
    expect(actionsCode).not.toMatch(/requestSubmit\(\)[\s\S]{0,40}confirming/);
  });

  it("the acknowledge action is excluded from confirmation by an explicit rule", () => {
    // ── AMENDED BY SLICE L-31, DELIBERATELY AND WITH THE INTENT PRESERVED ──
    //
    // This assertion used to be the literal string
    // `const needsConfirm = action.irreversible && !isAck`. L-31 narrowed
    // that rule to `const needsConfirm = isCancel;`, because the owner asked
    // for the "Mark picked up" popup to be removed and `picked_up` was being
    // swept into the old expression by `irreversible` (it is terminal in
    // Leafly's spec, exactly as `canceled` is).
    //
    // The test failed on that change — correctly, and usefully: it is the
    // guard that forces anyone touching this line to come here and think.
    // But it was pinned to an IMPLEMENTATION rather than to the PROPERTY it
    // was protecting, and the property is unchanged:
    //
    //     THE ACKNOWLEDGEMENT MUST NEVER OPEN A DIALOG.
    //
    // That is L-30's entire subject, it is still true, and it is now
    // asserted directly rather than as a side effect of one particular
    // spelling. Re-pinning it to the new literal would repeat the mistake
    // and break the next slice for no reason.
    //
    // The rule must be a single explicit assignment, not scattered logic —
    // so that there is exactly one place to read and one place to change.
    const rule = /const needsConfirm = ([^;]+);/.exec(actionsCode);
    expect(rule, "needsConfirm must be one explicit rule").toBeTruthy();

    // ...and the plain, no-dialog branch must be the one the acknowledge
    // form is rendered from.
    expect(actionsCode).toMatch(/if \(!needsConfirm\)/);
    expect(actionsCode).toMatch(/action=\{isAck \? acknowledgeAction : statusAction\}/);

    // NOTE: the *behavioural* proof that acknowledge renders no dialog lives
    // in the render test below. A source-pattern check cannot establish it —
    // see the comment there, which records a mutation that escaped exactly
    // such a check during L-31.
  });

  it("the confirm-first path opens its dialog from a BUTTON, not a submit", () => {
    // Anchored on code, not on a comment: stripComments() has already removed
    // the prose headings, so anchoring on them would make the scope depend on
    // a comment surviving — the opposite of what these assertions are for.
    const confirmBranch = bodyBetween(
      actionsCode,
      "<ConfirmDialog",
      "export function LeaflyOrderActions",
    );
    expect(confirmBranch).toMatch(/requestSubmit\(\)/);
    const buttonBranch = bodyBetween(
      actionsCode,
      "action={statusAction}",
      "<ConfirmDialog",
    );
    expect(buttonBranch).toMatch(/type="button"/);
    expect(buttonBranch).toMatch(/onClick=\{\(\) => setConfirming\(true\)\}/);
  });

  it("the acknowledge form is a plain real form posting to the server action", () => {
    const plainBranch = bodyBetween(
      actionsCode,
      "if (!needsConfirm)",
      "return (\n    <>",
    );
    expect(plainBranch).toMatch(/action=\{isAck \? acknowledgeAction : statusAction\}/);
    expect(plainBranch).toMatch(/<SubmitButton action=\{action\} \/>/);
    // and critically, no dialog and no button-type override on this path.
    expect(plainBranch).not.toMatch(/ConfirmDialog/);
    expect(plainBranch).not.toMatch(/type="button"/);
  });

  it("the warning survives — relocated to the screen, not deleted", () => {
    expect(actionsCode).toMatch(/data-testid="leafly-ack-warning"/);
    expect(actionsCode).toMatch(/\{irreversibleWarning\}/);
  });

  it("the warning is shown for the acknowledge action specifically", () => {
    expect(actionsCode).toMatch(
      /a\.kind === "acknowledge" && a\.irreversible/,
    );
  });

  it("the warning text still comes from the core, never invented here", () => {
    expect(LEAFLY_ACK_IRREVERSIBLE_WARNING).toMatch(/permanently revokes/);
    expect(LEAFLY_ACK_IRREVERSIBLE_WARNING).toMatch(/BEFORE acknowledging/);
    // The component must not contain a second, drifting copy of the wording.
    expect(actionsCode).not.toMatch(/permanently revokes/);
  });

  it("the button still disables itself while the request is in flight", () => {
    // With the dialog gone this is now the ONLY thing between a jittery thumb
    // and a duplicate acknowledge on a one-way door. It matters more, not less.
    expect(actionsCode).toMatch(/disabled=\{pending\}/);
    expect(actionsCode).toMatch(/aria-busy=\{pending\}/);
  });

  it("the busy label still comes from the plan, not from string surgery", () => {
    expect(actionsCode).toMatch(/pending \? action\.busyLabel : action\.label/);
  });
});

// ===========================================================================
// 5. THE CORE IS UNTOUCHED — Leafly's truth did not change, only our UI
// ===========================================================================
describe("L-30 — the acknowledgement is still irreversible in the model", () => {
  const fresh = planLeaflyOrderActions({
    orderIntegrationKeyPresent: true,
    leaflyOrderId: "ORD-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  });

  it("a fresh order still offers exactly one action: acknowledge", () => {
    expect(fresh.actions).toHaveLength(1);
    expect(fresh.actions[0].kind).toBe("acknowledge");
  });

  it("and it is STILL flagged irreversible — we did not lie to ourselves", () => {
    // L-30 changes what the UI does with this flag. It must not change the
    // flag, which is Leafly's fact and is asserted in the core's own tests.
    expect(fresh.actions[0].irreversible).toBe(true);
  });

  it("the component decides presentation from the flag, never the reverse", () => {
    expect(actionsCode).toMatch(/action\.irreversible/);
  });
});

// ===========================================================================
// 6. THE OWNER'S SCREENSHOT — what the old code did, pinned as history
// ===========================================================================
describe("L-30 — the symptom, so a regression is recognisable", () => {
  it("the banner he photographed is exactly what a 57s form pending renders", () => {
    expect(pendingHint("form", 57_000)).toBe(
      "Still working — 57s. Big saves (like finalizing a manifest) can take a while; leave this page open.",
    );
  });

  it("the 20s safety net could never have rescued it — forms get 300s", () => {
    expect(PENDING_SAFETY_TIMEOUT_MS).toBe(20_000);
    expect(PENDING_FORM_SAFETY_TIMEOUT_MS).toBe(300_000);
    expect(
      shouldClearPending({
        hrefAtStart: "https://x/admin/orders",
        hrefNow: "https://x/admin/orders",
        submitterConnected: true,
        submitterDisabled: false,
        elapsedMs: 57_000,
        kind: "form",
      }).clear,
    ).toBe(false);
  });

  it("the Leafly form IS a server-action form, so the keeper does engage it", () => {
    expect(
      isServerActionForm(
        "javascript:throw new Error('A React form was unexpectedly submitted.')",
      ),
    ).toBe(true);
    expect(isServerActionForm("/admin/orders")).toBe(false);
    expect(isServerActionForm(null)).toBe(false);
  });

  it("a quick real save stays silent — no noise below the threshold", () => {
    expect(PENDING_STILL_WORKING_MS).toBe(10_000);
    expect(pendingHint("form", 9_999)).toBeNull();
  });
});

// ===========================================================================
// 7. H12f REGRESSIONS — the original complaint must not come back
// ===========================================================================
describe("L-30 — everything the progress bar still has to do", () => {
  const base = {
    hrefAtStart: "https://x/admin/orders",
    hrefNow: "https://x/admin/orders",
    submitterConnected: true,
    submitterDisabled: false,
    elapsedMs: 1_000,
  };

  it("a genuine save clears the moment the URL changes", () => {
    const d = shouldClearPending({ ...base, hrefNow: "https://x/admin/orders?ok=1", kind: "form" });
    expect(d).toEqual({ clear: true, reason: "navigated" });
  });

  it("a genuine save clears when the pressed button is replaced", () => {
    const d = shouldClearPending({ ...base, submitterConnected: false, kind: "form" });
    expect(d).toEqual({ clear: true, reason: "replaced" });
  });

  it("self-managed client buttons still take over their own feedback", () => {
    const d = shouldClearPending({ ...base, submitterDisabled: true, kind: "form" });
    expect(d).toEqual({ clear: true, reason: "self-managed" });
  });

  it("link navigations keep the tight 20s ceiling", () => {
    expect(shouldClearPending({ ...base, elapsedMs: 19_999, kind: "nav" }).clear).toBe(false);
    expect(shouldClearPending({ ...base, elapsedMs: 20_000, kind: "nav" })).toEqual({
      clear: true,
      reason: "timeout",
    });
  });

  it("a form save is finally released at the 5-minute ceiling — never stuck", () => {
    expect(shouldClearPending({ ...base, elapsedMs: 300_000, kind: "form" })).toEqual({
      clear: true,
      reason: "timeout",
    });
  });

  it("a link navigation never shows the long-save banner", () => {
    expect(pendingHint("nav", 60_000)).toBeNull();
  });

  it("ordinary admin link clicks still light the bar", () => {
    expect(
      isEligibleNavClick({
        href: "/admin/products",
        currentHref: "https://x/admin/orders",
        origin: "https://x",
        targetBlank: false,
        hasModifier: false,
        defaultPrevented: false,
        download: false,
      }),
    ).toBe(true);
  });

  it("new-tab, modified, external and download clicks still never do", () => {
    const c = {
      href: "/admin/products",
      currentHref: "https://x/admin/orders",
      origin: "https://x",
      targetBlank: false,
      hasModifier: false,
      defaultPrevented: false,
      download: false,
    };
    expect(isEligibleNavClick({ ...c, targetBlank: true })).toBe(false);
    expect(isEligibleNavClick({ ...c, hasModifier: true })).toBe(false);
    expect(isEligibleNavClick({ ...c, download: true })).toBe(false);
    expect(isEligibleNavClick({ ...c, href: "https://leafly.com" })).toBe(false);
  });
});
