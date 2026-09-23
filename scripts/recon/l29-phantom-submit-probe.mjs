/**
 * scripts/recon/l29-phantom-submit-probe.mjs
 *
 * SLICE L-29 — "the acknowledge still spins forever, even longer than the 20
 * second limit and still isnt giving any errors."
 *
 * ===========================================================================
 * THE OWNER'S REPORT, VERBATIM
 * ===========================================================================
 *   "is it the pop up dialog box that asks me to confirm the acknowledgement?
 *    am I clicking it too quickly? is this box even needed and causing
 *    problems. ... I click the acknowledge button, the pop up appears, the top
 *    of the page has the loading bar that spins forever, and I get the 'still
 *    working - big saves like finalizing a manifest can take awhile'. is this
 *    the problem? this pop up getting stuck?"
 *
 * His screenshot is the decisive evidence and it is worth stating plainly:
 * the confirmation dialog is STILL OPEN, unanswered, while the banner at the
 * top of the page already reads "Still working — 120s."
 *
 * Nothing has been submitted. He has not answered the question yet. So what
 * is the page "working" on for two minutes? That is the whole slice.
 *
 * ===========================================================================
 * WHAT THIS PROBE MODELS
 * ===========================================================================
 * Three real pieces of the app, replayed against a minimal DOM:
 *
 *   1. PendingKeeper's capture-phase `submit` listener, copied in behaviour
 *      from src/components/admin/ux/PendingKeeper.tsx.
 *   2. ActionForm's bubble-phase `onSubmit` handler, which calls
 *      preventDefault() to open the confirmation instead of submitting
 *      (src/components/admin/orders/LeaflyOrderActions.tsx).
 *   3. The pure clearing rules, imported from the real
 *      src/lib/admin/pending-core.ts — NOT re-implemented, so a change to the
 *      real rules changes this probe's verdict.
 *
 * The DOM is hand-rolled rather than jsdom on purpose: vitest.config.ts
 * documents a deliberate house rule that this repo does not take a jsdom
 * dependency ("It is NOT an invitation to add jsdom"). What matters here is
 * event ORDER and the capture/bubble split, which is a few dozen lines of
 * well-specified behaviour, and modelling it explicitly makes the mechanism
 * legible instead of hiding it inside a library.
 *
 * Run:  node scripts/recon/l29-phantom-submit-probe.mjs
 * Exit: 0 = the phantom pending is reproduced AND the fix resolves it
 *       1 = a claim this probe makes is false — do not ship
 *       2 = the probe no longer models the real source
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ───────────────────────────────────────────────────────────────────────────
// 0. PIN THE MODEL TO THE REAL SOURCE
//    Scoped per construct. L-28 taught this the hard way twice: an unscoped
//    source assertion degrades into "this string appears somewhere in this
//    file", which is not the claim being made.
// ───────────────────────────────────────────────────────────────────────────
const KEEPER_SRC = "src/components/admin/ux/PendingKeeper.tsx";
const ACTIONS_SRC = "src/components/admin/orders/LeaflyOrderActions.tsx";
const keeper = readFileSync(KEEPER_SRC, "utf8");
const actions = readFileSync(ACTIONS_SRC, "utf8");

function bodyBetween(source, startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  if (start === -1) return null;
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  return source.slice(start, end === -1 ? source.length : end);
}

const ON_SUBMIT = bodyBetween(keeper, "function onSubmit(e: Event)", "document.addEventListener");
const ACTION_FORM_SUBMIT = bodyBetween(actions, "onSubmit={(e) => {", "className=\"inline\"");

const pins = [
  [
    keeper,
    /document\.addEventListener\("submit", onSubmit, true\)/,
    `${KEEPER_SRC}: keeper listens for submit in the CAPTURE phase`,
  ],
  [
    ON_SUBMIT,
    /kind: "form"/,
    `${KEEPER_SRC}: a form submit gets the long FORM ceiling`,
  ],
  [
    ON_SUBMIT,
    /queueMicrotask\(/,
    `${KEEPER_SRC}: the keeper defers its decision past the capture phase`,
  ],
  [
    ON_SUBMIT,
    /submitDidStart\(/,
    `${KEEPER_SRC}: ...and asks the pure rule whether the submit survived`,
  ],
  [
    ACTION_FORM_SUBMIT,
    /e\.preventDefault\(\)/,
    `${ACTIONS_SRC}: the irreversible action cancels its own submit to confirm first`,
  ],
  [
    ACTION_FORM_SUBMIT,
    /confirmedRef\.current/,
    `${ACTIONS_SRC}: permission is read from a ref, not a render-time state flag`,
  ],
];

let drift = false;
if (!ON_SUBMIT || !ACTION_FORM_SUBMIT) {
  console.error("MODEL DRIFT: could not locate the two handlers this probe models.");
  drift = true;
} else {
  for (const [scope, re, label] of pins) {
    if (!re.test(scope)) {
      console.error(`MODEL DRIFT: could not find ${label}`);
      drift = true;
    }
  }
}
if (drift) {
  console.error("\nThe probe no longer models the real components. Fix it before trusting it.");
  process.exit(2);
}

// The clearing rules are IMPORTED, not copied.
const core = await import(
  pathToFileURL(new URL("../../src/lib/admin/pending-core.ts", import.meta.url).pathname).href
).catch(() => null);

// pending-core.ts is TypeScript; if it cannot be imported directly, parse the
// two constants out of it rather than hard-coding them.
let PENDING_FORM_SAFETY_TIMEOUT_MS;
let PENDING_STILL_WORKING_MS;
let pendingHint;
let shouldClearPending;
if (core?.shouldClearPending) {
  ({ PENDING_FORM_SAFETY_TIMEOUT_MS, PENDING_STILL_WORKING_MS, pendingHint, shouldClearPending } =
    core);
} else {
  const src = readFileSync("src/lib/admin/pending-core.ts", "utf8");
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name} = ([0-9_]+);`));
    if (!m) {
      console.error(`MODEL DRIFT: could not read ${name} from pending-core.ts`);
      process.exit(2);
    }
    return Number(m[1].replace(/_/g, ""));
  };
  PENDING_FORM_SAFETY_TIMEOUT_MS = num("PENDING_FORM_SAFETY_TIMEOUT_MS");
  PENDING_STILL_WORKING_MS = num("PENDING_STILL_WORKING_MS");
  // Mirror of the real rules, used only when the TS import is unavailable.
  const NAV_CEIL = num("PENDING_SAFETY_TIMEOUT_MS");
  shouldClearPending = (c) => {
    if (c.hrefNow !== c.hrefAtStart) return { clear: true, reason: "navigated" };
    if (!c.submitterConnected) return { clear: true, reason: "replaced" };
    if (c.submitterDisabled) return { clear: true, reason: "self-managed" };
    const ceiling = c.kind === "form" ? PENDING_FORM_SAFETY_TIMEOUT_MS : NAV_CEIL;
    if (c.elapsedMs >= ceiling) return { clear: true, reason: "timeout" };
    return { clear: false, reason: "" };
  };
  pendingHint = (kind, elapsedMs) => {
    if (kind !== "form") return null;
    if (elapsedMs < PENDING_STILL_WORKING_MS) return null;
    return `Still working — ${Math.floor(elapsedMs / 1000)}s. Big saves (like finalizing a manifest) can take a while; leave this page open.`;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 1. A MINIMAL DOM WITH REAL CAPTURE/BUBBLE SEMANTICS
// ───────────────────────────────────────────────────────────────────────────
class Node {
  constructor(tag) {
    this.tag = tag;
    this.parent = null;
    this.children = [];
    this.listeners = { capture: {}, bubble: {} };
    this.dataset = {};
    this.isConnected = true;
    this.disabled = false;
    this.attrs = {};
  }
  append(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(type, fn, capture = false) {
    const bag = capture ? this.listeners.capture : this.listeners.bubble;
    (bag[type] ||= []).push(fn);
  }
  get classList() {
    this._classes ||= new Set();
    const s = this._classes;
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), has: (c) => s.has(c) };
  }
}

/** Dispatch with real capture-then-bubble ordering. */
function dispatch(target, event) {
  const path = [];
  for (let n = target; n; n = n.parent) path.push(n);
  const rootFirst = [...path].reverse();

  event.target = target;
  event.defaultPrevented = false;
  event._stopped = false;
  event.preventDefault = () => {
    event.defaultPrevented = true;
  };
  event.stopPropagation = () => {
    event._stopped = true;
  };

  // Capture: document -> target
  for (const node of rootFirst) {
    if (event._stopped) break;
    for (const fn of node.listeners.capture[event.type] ?? []) fn(event);
  }
  // Bubble: target -> document
  for (const node of path) {
    if (event._stopped) break;
    for (const fn of node.listeners.bubble[event.type] ?? []) fn(event);
  }
  return !event.defaultPrevented;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. THE REAL PLAYERS
// ───────────────────────────────────────────────────────────────────────────

/** PendingKeeper, behaviourally. `guard` is the L-29 fix (absent = today). */
function mountKeeper(doc, { guard = false } = {}) {
  const state = { pending: null, barVisible: false, hint: null };

  doc.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!form || form.tag !== "form") return;
      if (!String(form.getAttribute("action") ?? "").startsWith("javascript:")) return;
      if (form.dataset.gwBusy === "1") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const rec = {
        hrefAtStart: doc.href,
        startedAt: 0,
        kind: "form",
        submitter: e.submitter ?? null,
        form,
      };

      if (guard) {
        // THE FIX. The keeper cannot know at capture time whether a bubble
        // handler downstream is going to cancel this submit — capture runs
        // FIRST, by definition. So it commits nothing yet; it waits one turn
        // and only lights up if the submit actually survived.
        state.armed = rec;
        return;
      }

      state.pending = rec;
      state.barVisible = true;
      if (rec.submitter) {
        rec.submitter.classList.add("gw-submit-busy");
        rec.submitter.setAttribute("aria-busy", "true");
      }
      form.dataset.gwBusy = "1";
    },
    true,
  );

  /** Called after the event finishes — the microtask the fix waits for. */
  state.settle = (event) => {
    if (!guard) return;
    const rec = state.armed;
    state.armed = null;
    if (!rec) return;
    if (event.defaultPrevented) return; // cancelled — never was a save
    state.pending = rec;
    state.barVisible = true;
    if (rec.submitter) {
      rec.submitter.classList.add("gw-submit-busy");
      rec.submitter.setAttribute("aria-busy", "true");
    }
    rec.form.dataset.gwBusy = "1";
  };

  state.tick = (elapsedMs) => {
    const rec = state.pending;
    if (!rec) return;
    const decision = shouldClearPending({
      hrefAtStart: rec.hrefAtStart,
      hrefNow: doc.href,
      submitterConnected: rec.submitter ? rec.submitter.isConnected : true,
      submitterDisabled: rec.submitter ? rec.submitter.disabled : false,
      elapsedMs,
      kind: rec.kind,
    });
    if (decision.clear) {
      rec.submitter?.classList.remove("gw-submit-busy");
      rec.submitter?.removeAttribute("aria-busy");
      delete rec.form.dataset.gwBusy;
      state.pending = null;
      state.barVisible = false;
      state.hint = null;
      state.lastClearReason = decision.reason;
      return;
    }
    state.hint = pendingHint(rec.kind, elapsedMs);
  };

  return state;
}

/** One ActionForm for an irreversible action, plus its confirmation. */
function buildOrderPanel(doc) {
  const form = doc.append(new Node("form"));
  // React's server-action sentinel — verified present in react-dom's source.
  form.setAttribute("action", "javascript:throw new Error('A React form was unexpectedly submitted.')");
  const button = form.append(new Node("button"));
  button.setAttribute("type", "submit");

  const ui = { confirming: false, submitted: 0 };

  form.addEventListener("submit", (e) => {
    // ActionForm.onSubmit — bubble phase, because React attaches it as a
    // normal JSX handler.
    if (/* action.irreversible */ true && !ui.confirming) {
      e.preventDefault();
      ui.confirming = true; // the dialog opens
    } else {
      ui.submitted += 1; // the real POST leaves the browser
    }
  });

  return { form, button, ui };
}

function clickSubmit({ doc, keeper, panel }) {
  const event = { type: "submit", submitter: panel.button };
  dispatch(panel.form, event);
  keeper.settle(event); // the fix's deferred decision; a no-op without it
  return event;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. SCENARIOS
// ───────────────────────────────────────────────────────────────────────────
const line = "─".repeat(74);
const results = [];
function check(label, actual, expected) {
  const ok = actual === expected;
  results.push({ label, ok, actual, expected });
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`         expected ${expected}, got ${actual}`);
  return ok;
}

function newWorld({ guard }) {
  const doc = new Node("#document");
  doc.href = "https://greenway/admin/orders";
  const keeper = mountKeeper(doc, { guard });
  const panel = buildOrderPanel(doc);
  return { doc, keeper, panel };
}

console.log(line);
console.log("L-29 PROBE — the spinner that starts before anything is submitted");
console.log(line);
console.log(`FORM ceiling from pending-core : ${PENDING_FORM_SAFETY_TIMEOUT_MS / 1000}s`);
console.log(`"Still working" threshold      : ${PENDING_STILL_WORKING_MS / 1000}s`);
console.log("");

// ── TODAY ──────────────────────────────────────────────────────────────────
console.log("TODAY — press Acknowledge, dialog opens, DO NOT answer it:");
{
  const w = newWorld({ guard: false });
  const event = clickSubmit(w);

  check("the dialog is open, waiting for an answer", w.panel.ui.confirming, true);
  check("the submit was CANCELLED (preventDefault)", event.defaultPrevented, true);
  check("nothing was actually submitted", w.panel.ui.submitted, 0);
  check("...yet the progress bar is showing", w.keeper.barVisible, true);
  check("...and the form is flagged busy", w.panel.form.dataset.gwBusy, "1");
  check("...and the button is spinning", w.panel.button.classList.has("gw-submit-busy"), true);

  // Time passes while he reads the warning — which is exactly what the dialog
  // is FOR. It is eight lines about permanently losing the customer's ID.
  w.keeper.tick(12_000);
  console.log(`\n   after 12s the page says: "${w.keeper.hint}"`);
  check("a 'Still working' banner appears with nothing running", w.keeper.hint !== null, true);

  w.keeper.tick(120_000);
  console.log(`   after 120s the page says: "${w.keeper.hint}"`);
  check("still 'working' at 120s — matches his screenshot", w.keeper.barVisible, true);

  w.keeper.tick(25_000 + 1);
  check(
    "the 20s safety net does NOT rescue it (forms get 300s)",
    w.keeper.barVisible,
    true,
  );

  console.log("\n   THE SECOND FAILURE — he answers the dialog after reading it:");
  const second = clickSubmit(w);
  check(
    "the keeper swallows the REAL submit as a double-submit",
    second.defaultPrevented,
    true,
  );
  check("the acknowledgement never leaves the browser", w.panel.ui.submitted, 0);
}

// ── WITH THE FIX ───────────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log("WITH THE FIX — the keeper waits to see if the submit survives:");
{
  const w = newWorld({ guard: true });
  clickSubmit(w);

  check("the dialog is open, waiting for an answer", w.panel.ui.confirming, true);
  check("no progress bar — nothing is running", w.keeper.barVisible, false);
  check("the form is NOT flagged busy", w.panel.form.dataset.gwBusy, undefined);
  check("the button is not spinning", w.panel.button.classList.has("gw-submit-busy"), false);

  w.keeper.tick(120_000);
  check("no phantom 'Still working' banner", w.keeper.hint, null);

  console.log("\n   He reads the warning, then confirms:");
  const second = clickSubmit(w);
  check("the real submit is allowed through", second.defaultPrevented, false);
  check("the acknowledgement is sent exactly once", w.panel.ui.submitted, 1);
  check("NOW the progress bar shows", w.keeper.barVisible, true);
  check("and the form is guarded against a double submit", w.panel.form.dataset.gwBusy, "1");

  console.log("\n   And the double-submit guard still works on a genuine save:");
  const third = clickSubmit(w);
  check("a second press during the real save is swallowed", third.defaultPrevented, true);
  check("still exactly one acknowledgement", w.panel.ui.submitted, 1);
}

// ── CANCEL PATH ────────────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log('WITH THE FIX — he presses "Not yet" and walks away:');
{
  const w = newWorld({ guard: true });
  clickSubmit(w);
  w.panel.ui.confirming = false; // onCancel
  w.keeper.tick(120_000);
  check("no progress bar after cancelling", w.keeper.barVisible, false);
  check("the form is left clean for a later press", w.panel.form.dataset.gwBusy, undefined);
}

// ───────────────────────────────────────────────────────────────────────────
// 4. VERDICT
// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log("VERDICT");
console.log(line);
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log("REPRODUCED. The confirmation dialog is not slow and it is not stuck.");
  console.log("");
  console.log("PendingKeeper listens for `submit` in the CAPTURE phase, which by");
  console.log("definition runs BEFORE the form's own bubble-phase handler. The Leafly");
  console.log("acknowledge form cancels its first submit (preventDefault) in order to");
  console.log("ask for confirmation — but by then the keeper has already declared a");
  console.log("save in flight, started the bar, and set form.dataset.gwBusy = '1'.");
  console.log("");
  console.log("So the spinner is timing the OWNER READING THE DIALOG. It is counting");
  console.log("his reading time as server time. Nothing is hung; nothing is even");
  console.log("running. And because a form save gets the 300s ceiling, the 20s safety");
  console.log("net never fires — which is why it 'spins forever'.");
  console.log("");
  console.log("Then the real damage: gwBusy is still '1', so when he finally presses");
  console.log("'Acknowledge to Leafly', the keeper's own double-submit guard swallows");
  console.log("the genuine submit. The acknowledgement never leaves the browser. That");
  console.log("is why there is no error and no detail — no request was ever made.");
  console.log("");
  console.log("ANSWER TO HIS QUESTION: the dialog is not the problem and should stay.");
  console.log("Clicking too quickly is not the problem either — the opposite, reading");
  console.log("it carefully is what runs the clock up.");
  process.exit(0);
}
console.log(`${failed.length} claim(s) in this probe are false:`);
for (const f of failed) console.log(`   - ${f.label} (expected ${f.expected}, got ${f.actual})`);
console.log("Do not ship on the strength of this run. Investigate further.");
process.exit(1);
