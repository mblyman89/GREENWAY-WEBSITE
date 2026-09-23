/**
 * scripts/recon/l29-confirm-reentry-probe.mjs
 *
 * SLICE L-29, SECOND DEFECT — the one hiding behind the first.
 *
 * ===========================================================================
 * WHY THIS PROBE EXISTS
 * ===========================================================================
 * Fixing the phantom-pending bug means the keeper will stop swallowing the
 * real submit. Good — except the keeper's swallow was also MASKING whatever
 * happens next. Before shipping a fix it has to be shown that the submit,
 * once allowed through, actually reaches the server action rather than
 * bouncing off a second guard.
 *
 * The guard in question is in LeaflyOrderActions.ActionForm:
 *
 *     onSubmit={(e) => {
 *       if (action.irreversible && !confirming) {
 *         e.preventDefault();
 *         setConfirming(true);
 *       }
 *     }}
 *
 * and the confirm handler:
 *
 *     onConfirm={() => {
 *       setConfirming(false);
 *       Promise.resolve().then(() => formRef.current?.requestSubmit());
 *     }}
 *
 * Read it closely. The submit is allowed through only when `confirming` is
 * TRUE. But `onConfirm` sets it to FALSE first, and then submits. So the
 * whole thing hinges on the re-render NOT having been applied yet when
 * `requestSubmit()` runs — i.e. on the submit handler still being the stale
 * closure. The source comment says the microtask exists to ensure React
 * "has applied `confirming: false`", which is the opposite of what makes the
 * guard pass.
 *
 * Whether that works depends entirely on React's flush timing for discrete
 * events relative to a microtask. That is an implementation detail of React,
 * not a guarantee of the app. So this probe runs the logic under BOTH
 * timings and reports what each produces.
 *
 * Run:  node scripts/recon/l29-confirm-reentry-probe.mjs
 * Exit: 0 = the CURRENT design is timing-dependent AND the ref design is not
 *       1 = a claim here is false
 *       2 = drift from the real source
 */

import { readFileSync } from "node:fs";

const SRC = "src/components/admin/orders/LeaflyOrderActions.tsx";
const source = readFileSync(SRC, "utf8");

const line = "─".repeat(74);
const results = [];
function check(label, actual, expected) {
  const ok = actual === expected;
  results.push({ label, ok, actual, expected });
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// MODEL
//
// `flushBeforeMicrotask` is the single knob. React flushes discrete-event
// state updates synchronously at the end of the event handler, which happens
// while the JS stack is still unwound — i.e. BEFORE any microtask queued
// inside that handler. That is `true`. The `false` case models the opposite
// assumption the current code is written against.
// ───────────────────────────────────────────────────────────────────────────

/** The CURRENT design: a state flag read through a render closure. */
function runCurrentDesign({ flushBeforeMicrotask }) {
  const out = { submitted: 0, dialogOpens: 0 };
  let committed = { confirming: false }; // what the rendered closure sees
  let next = { confirming: false }; // what setState has scheduled
  const microtasks = [];

  const render = () => {
    committed = { ...next };
  };

  function onSubmit(e) {
    // The handler closes over the COMMITTED value at render time.
    const confirming = committed.confirming;
    if (!confirming) {
      e.preventDefault();
      next.confirming = true;
      out.dialogOpens += 1;
      render(); // opening the dialog obviously re-renders
    } else {
      out.submitted += 1;
    }
  }

  function requestSubmit() {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    onSubmit(e);
  }

  // 1. He presses Acknowledge.
  requestSubmit();

  // 2. He presses "Acknowledge to Leafly" in the dialog. This is onConfirm.
  next.confirming = false;
  microtasks.push(() => requestSubmit());
  if (flushBeforeMicrotask) render(); // React flushes the discrete update
  while (microtasks.length) microtasks.shift()();

  return out;
}

/** The PROPOSED design: an explicit ref, not a render-derived value. */
function runRefDesign({ flushBeforeMicrotask }) {
  const out = { submitted: 0, dialogOpens: 0 };
  let committed = { confirming: false };
  let next = { confirming: false };
  const confirmedRef = { current: false }; // survives renders, read live
  const microtasks = [];
  const render = () => {
    committed = { ...next };
  };

  function onSubmit(e) {
    if (!confirmedRef.current) {
      e.preventDefault();
      next.confirming = true;
      out.dialogOpens += 1;
      render();
      return;
    }
    // One-shot: consume the permission so a later stray submit re-confirms.
    confirmedRef.current = false;
    out.submitted += 1;
  }

  function requestSubmit() {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    onSubmit(e);
  }

  requestSubmit();

  // onConfirm: grant permission, close the dialog, submit.
  confirmedRef.current = true;
  next.confirming = false;
  microtasks.push(() => requestSubmit());
  if (flushBeforeMicrotask) render();
  while (microtasks.length) microtasks.shift()();

  return out;
}

console.log(line);
console.log("L-29 PROBE #2 — does the confirmed submit actually get through?");
console.log(line);
console.log("Once the keeper stops swallowing the submit, ActionForm's own guard");
console.log("decides its fate. That guard is read from a React render closure, so");
console.log("its behaviour depends on when React flushes. Both timings, measured:\n");

console.log("CURRENT DESIGN (state flag through a render closure):");
const curFlush = runCurrentDesign({ flushBeforeMicrotask: true });
const curNoFlush = runCurrentDesign({ flushBeforeMicrotask: false });
console.log(`   React flushes before the microtask  -> submitted=${curFlush.submitted}, dialog opened ${curFlush.dialogOpens}x`);
console.log(`   React flushes after  the microtask  -> submitted=${curNoFlush.submitted}, dialog opened ${curNoFlush.dialogOpens}x`);
check(
  "the current design gives DIFFERENT answers depending on React's timing",
  curFlush.submitted !== curNoFlush.submitted,
  true,
);
check(
  "under a synchronous flush the acknowledgement is NEVER sent",
  curFlush.submitted,
  0,
);
check(
  "...and the dialog reopens instead",
  curFlush.dialogOpens,
  2,
);

console.log("\nPROPOSED DESIGN (explicit ref, read live):");
const refFlush = runRefDesign({ flushBeforeMicrotask: true });
const refNoFlush = runRefDesign({ flushBeforeMicrotask: false });
console.log(`   React flushes before the microtask  -> submitted=${refFlush.submitted}, dialog opened ${refFlush.dialogOpens}x`);
console.log(`   React flushes after  the microtask  -> submitted=${refNoFlush.submitted}, dialog opened ${refNoFlush.dialogOpens}x`);
check("the ref design sends exactly one acknowledgement when flushed early", refFlush.submitted, 1);
check("the ref design sends exactly one acknowledgement when flushed late", refNoFlush.submitted, 1);
check("the ref design never reopens the dialog", refFlush.dialogOpens, 1);
check("the ref design is timing-INDEPENDENT", refFlush.submitted === refNoFlush.submitted, true);

// ───────────────────────────────────────────────────────────────────────────
// Pin the claim about the current source so this probe cannot rot.
// ───────────────────────────────────────────────────────────────────────────
console.log("\nSOURCE CHECK:");
const usesStateGuard = /action\.irreversible && !confirming/.test(source);
const setsFalseThenSubmits =
  /setConfirming\(false\);[\s\S]{0,400}?requestSubmit\(\)/.test(source);
console.log(`   guard reads the render-time state flag ....... ${usesStateGuard}`);
console.log(`   onConfirm sets false, THEN submits ........... ${setsFalseThenSubmits}`);

console.log(`\n${line}`);
console.log("VERDICT");
console.log(line);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`${failed.length} claim(s) false — investigate before shipping.`);
  for (const f of failed) console.log(`   - ${f.label}`);
  process.exit(1);
}
if (usesStateGuard && setsFalseThenSubmits) {
  console.log("The confirmed submit is gated on a React render closure, and whether");
  console.log("it survives depends on when React flushes state relative to a");
  console.log("microtask. React flushes discrete-event updates synchronously at the");
  console.log("end of the handler — before queued microtasks — which is the column");
  console.log("where the acknowledgement is NEVER SENT and the dialog reopens.");
  console.log("");
  console.log("Today this is invisible: the keeper's stale `gwBusy` guard swallows");
  console.log("the submit with stopPropagation() before ActionForm's handler ever");
  console.log("runs. Fixing only the keeper would trade a phantom spinner for a");
  console.log("dialog that reopens. BOTH have to be fixed, in the same change.");
  console.log("");
  console.log("The ref design removes the dependency on render timing entirely:");
  console.log("correct under both columns above.");
  process.exit(0);
}
console.log("The source no longer has the shape this probe describes.");
process.exit(2);
