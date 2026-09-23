/**
 * tests/compliance/leafly-l29-phantom-pending.test.ts
 *
 * SLICE L-29 — the acknowledge button "spins forever" with no error.
 *
 * ===========================================================================
 * WHAT WENT WRONG
 * ===========================================================================
 * The owner: "I click the acknowledge button, the pop up appears, the top of
 * the page has the loading bar that spins forever, and I get the 'still
 * working - big saves like finalizing a manifest can take awhile'."
 *
 * His screenshot showed the confirmation dialog STILL OPEN above a banner
 * reading "Still working — 120s". Nothing had been submitted. Two defects,
 * one hiding the other:
 *
 *  1. PendingKeeper's `submit` listener is in the CAPTURE phase, so it ran
 *     BEFORE the form's own handler cancelled the submit to open the dialog.
 *     The keeper started a progress bar for a request that did not exist and
 *     stamped `form.dataset.gwBusy = "1"`. The bar was timing how long he
 *     spent reading the warning.
 *
 *  2. Because `gwBusy` stayed set, the keeper's double-submit guard then
 *     swallowed the REAL submit when he confirmed — with stopPropagation(),
 *     so ActionForm never even saw it. No request, hence no error to show.
 *     And behind that, ActionForm's own guard read `confirming` from a render
 *     closure, which React had already flushed to false; it would have
 *     cancelled the confirmed submit and re-opened the dialog.
 *
 * These tests pin the decision rule and the two component shapes so neither
 * defect can return quietly.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PENDING_FORM_SAFETY_TIMEOUT_MS,
  PENDING_SAFETY_TIMEOUT_MS,
  PENDING_STILL_WORKING_MS,
  isServerActionForm,
  pendingHint,
  shouldClearPending,
  submitDidStart,
} from "@/lib/admin/pending-core";

const KEEPER_SRC = "src/components/admin/ux/PendingKeeper.tsx";
const ACTIONS_SRC = "src/components/admin/orders/LeaflyOrderActions.tsx";
const keeperSource = readFileSync(KEEPER_SRC, "utf8");
const actionsSource = readFileSync(ACTIONS_SRC, "utf8");

/** Strip comments so a prose mention can never satisfy a behavioural claim. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Slice the source to one construct, bounded on BOTH sides.
 *
 * L-28 taught this twice in one slice: an unscoped source assertion silently
 * degrades into "this string appears somewhere in this file", which is a much
 * weaker claim wearing the same clothes.
 */
function bodyBetween(src: string, startAnchor: string, endAnchor: string): string {
  const start = src.indexOf(startAnchor);
  expect(start, `anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  return src.slice(start, end === -1 ? src.length : end);
}

const keeperCode = stripComments(keeperSource);
const actionsCode = stripComments(actionsSource);
const KEEPER_ON_SUBMIT = bodyBetween(keeperCode, "function onSubmit(e: Event)", "document.addEventListener");
const ACTION_ON_SUBMIT = bodyBetween(actionsCode, "onSubmit={(e) => {", "className=\"inline\"");
const ON_CONFIRM = bodyBetween(actionsCode, "onConfirm={() => {", "onCancel=");
const ON_CANCEL = bodyBetween(actionsCode, "onCancel={() => {", "/>");

describe("L-29 — submitDidStart: the pure rule", () => {
  it("a cancelled submit is NOT a save in flight", () => {
    expect(submitDidStart({ defaultPrevented: true, formConnected: true })).toBe(false);
  });

  it("a surviving submit IS a save in flight", () => {
    expect(submitDidStart({ defaultPrevented: false, formConnected: true })).toBe(true);
  });

  it("a form that left the document is not pending — nothing to spin on", () => {
    expect(submitDidStart({ defaultPrevented: false, formConnected: false })).toBe(false);
  });

  it("cancellation dominates: a detached AND cancelled submit is still not a save", () => {
    expect(submitDidStart({ defaultPrevented: true, formConnected: false })).toBe(false);
  });

  it("is pure — same input, same answer, no hidden state", () => {
    const input = { defaultPrevented: false, formConnected: true };
    const runs = Array.from({ length: 5 }, () => submitDidStart(input));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("L-29 — the exact scenario from the owner's screenshot", () => {
  /**
   * Replays the reported sequence against the real rules: press Acknowledge,
   * the form cancels its submit to open the dialog, then time passes while he
   * reads eight lines about permanently losing the customer's ID.
   */
  it("the confirmation submit must not be treated as a save", () => {
    const cancelledToConfirm = { defaultPrevented: true, formConnected: true };
    expect(submitDidStart(cancelledToConfirm)).toBe(false);
  });

  it("had it been treated as a save, the banner would read exactly what he saw", () => {
    // 120s is the number in his screenshot. This is the sentence the old code
    // produced for a request that did not exist.
    expect(pendingHint("form", 120_000)).toBe(
      "Still working — 120s. Big saves (like finalizing a manifest) can take a while; leave this page open.",
    );
  });

  it("and the 20s safety net would NOT have rescued it — forms get 300s", () => {
    expect(PENDING_FORM_SAFETY_TIMEOUT_MS).toBeGreaterThan(PENDING_SAFETY_TIMEOUT_MS);
    const at120s = shouldClearPending({
      hrefAtStart: "https://greenway/admin/orders",
      hrefNow: "https://greenway/admin/orders",
      submitterConnected: true,
      submitterDisabled: false,
      elapsedMs: 120_000,
      kind: "form",
    });
    expect(at120s.clear).toBe(false);
  });

  it("the phantom would have persisted for a full five minutes", () => {
    const justUnder = shouldClearPending({
      hrefAtStart: "u",
      hrefNow: "u",
      submitterConnected: true,
      submitterDisabled: false,
      elapsedMs: PENDING_FORM_SAFETY_TIMEOUT_MS - 1,
      kind: "form",
    });
    expect(justUnder.clear).toBe(false);
  });

  it("the banner stays silent below the threshold, so a quick real save is quiet", () => {
    expect(pendingHint("form", PENDING_STILL_WORKING_MS - 1)).toBeNull();
  });

  it("the Leafly form IS a server-action form, so the keeper does engage with it", () => {
    // If this were false the keeper would never have touched the form and the
    // bug could not have happened. Pin it so the diagnosis stays anchored.
    expect(
      isServerActionForm("javascript:throw new Error('A React form was unexpectedly submitted.')"),
    ).toBe(true);
  });
});

describe("L-29 — PendingKeeper defers its decision past the capture phase", () => {
  it("still listens in the capture phase (it must see every admin form)", () => {
    expect(keeperCode).toMatch(/document\.addEventListener\("submit", onSubmit, true\)/);
  });

  it("does NOT start pending synchronously inside the capture listener", () => {
    // The whole bug: committing during capture, before any handler could
    // cancel. startPending must appear only inside the deferred block.
    const beforeMicrotask = KEEPER_ON_SUBMIT.split("queueMicrotask(")[0];
    expect(beforeMicrotask).not.toMatch(/startPending\(/);
  });

  it("defers the decision to a microtask", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/queueMicrotask\(/);
  });

  it("asks the pure rule whether the submit actually started", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/submitDidStart\(/);
  });

  it("feeds the rule the event's defaultPrevented, read after propagation", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/defaultPrevented: e\.defaultPrevented/);
  });

  it("feeds the rule the form's connectedness", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/formConnected: form\.isConnected/);
  });

  it("only marks the form busy once the save is real", () => {
    // gwBusy is the flag that swallowed his acknowledgement. It must not be
    // set on the provisional path.
    const beforeMicrotask = KEEPER_ON_SUBMIT.split("queueMicrotask(")[0];
    expect(beforeMicrotask).not.toMatch(/dataset\.gwBusy = "1"/);
  });

  it("keeps the double-submit guard for genuine saves", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/form\.dataset\.gwBusy === "1"/);
    expect(KEEPER_ON_SUBMIT).toMatch(/stopPropagation\(\)/);
  });

  it("still ignores non-server-action forms (client panels own their feedback)", () => {
    expect(KEEPER_ON_SUBMIT).toMatch(/isServerActionForm\(/);
    expect(isServerActionForm("/admin/orders")).toBe(false);
    expect(isServerActionForm(null)).toBe(false);
  });

  it("imports the rule rather than re-implementing it inline", () => {
    expect(keeperCode).toMatch(/submitDidStart/);
    expect(keeperCode).toMatch(/from "@\/lib\/admin\/pending-core"/);
  });
});

describe("L-29 — ActionForm's confirmed submit does not depend on render timing", () => {
  it("permission lives in a ref", () => {
    expect(actionsCode).toMatch(/const confirmedRef = useRef\(false\)/);
  });

  it("the submit guard reads the ref, NOT the render-time state flag", () => {
    expect(ACTION_ON_SUBMIT).toMatch(/confirmedRef\.current/);
    // The old shape is what cancelled the confirmed submit.
    expect(ACTION_ON_SUBMIT).not.toMatch(/!confirming/);
  });

  it("the permission is one-shot — consumed when used", () => {
    expect(ACTION_ON_SUBMIT).toMatch(/confirmedRef\.current = false/);
  });

  it("onConfirm grants permission BEFORE submitting", () => {
    const grantIdx = ON_CONFIRM.indexOf("confirmedRef.current = true");
    const submitIdx = ON_CONFIRM.indexOf("requestSubmit()");
    expect(grantIdx).toBeGreaterThan(-1);
    expect(submitIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeLessThan(submitIdx);
  });

  it("onCancel revokes permission — no standing yes on a one-way door", () => {
    expect(ON_CANCEL).toMatch(/confirmedRef\.current = false/);
  });

  it("reversible actions are still never intercepted", () => {
    expect(ACTION_ON_SUBMIT).toMatch(/if \(!action\.irreversible\) return;/);
  });

  it("the dialog is still driven by state (it is a render concern)", () => {
    expect(actionsCode).toMatch(/open=\{confirming\}/);
  });

  it("the form is still a real form posting to a real server action", () => {
    // The no-JS fallback documented in the file header must survive the fix.
    expect(actionsCode).toMatch(/action=\{isAck \? acknowledgeAction : statusAction\}/);
    expect(actionsCode).toMatch(/type="submit"/);
  });
});

describe("L-29 — the dialog itself is exonerated", () => {
  /**
   * The owner asked directly: "is this box even needed and causing problems."
   * It is needed, and it was not the cause. These pin the reasons it stays.
   */
  it("the acknowledge action is still gated behind a confirmation", () => {
    expect(actionsCode).toMatch(/ConfirmDialog/);
    expect(actionsCode).toMatch(/Acknowledge this order to Leafly\?/);
  });

  it("the warning text still comes from the core, not from the component", () => {
    expect(actionsCode).toMatch(/irreversibleWarning/);
  });

  it("nothing in the fix makes the dialog slower to answer", () => {
    // No artificial delay, no disabled-until-timer, no typed gate added to
    // the acknowledgement. Reading time must never be charged to the server.
    expect(actionsCode).not.toMatch(/requireTextToConfirm/);
    expect(actionsCode).not.toMatch(/setTimeout\([^)]*\d{3,}/);
  });
});

describe("L-29 — regressions the fix must not introduce", () => {
  it("a genuine save still clears the moment the URL changes", () => {
    const d = shouldClearPending({
      hrefAtStart: "https://greenway/admin/orders",
      hrefNow: "https://greenway/admin/orders?ack=1",
      submitterConnected: true,
      submitterDisabled: false,
      elapsedMs: 50,
      kind: "form",
    });
    expect(d).toEqual({ clear: true, reason: "navigated" });
  });

  it("a genuine save still clears when the button is replaced", () => {
    const d = shouldClearPending({
      hrefAtStart: "u",
      hrefNow: "u",
      submitterConnected: false,
      submitterDisabled: false,
      elapsedMs: 50,
      kind: "form",
    });
    expect(d).toEqual({ clear: true, reason: "replaced" });
  });

  it("self-managed client buttons still take over their own feedback", () => {
    const d = shouldClearPending({
      hrefAtStart: "u",
      hrefNow: "u",
      submitterConnected: true,
      submitterDisabled: true,
      elapsedMs: 50,
      kind: "form",
    });
    expect(d).toEqual({ clear: true, reason: "self-managed" });
  });

  it("link navigations keep the tight 20s ceiling", () => {
    const d = shouldClearPending({
      hrefAtStart: "u",
      hrefNow: "u",
      submitterConnected: true,
      submitterDisabled: false,
      elapsedMs: PENDING_SAFETY_TIMEOUT_MS,
      kind: "nav",
    });
    expect(d).toEqual({ clear: true, reason: "timeout" });
  });

  it("a link navigation never shows the long-save banner", () => {
    expect(pendingHint("nav", 120_000)).toBeNull();
  });
});
