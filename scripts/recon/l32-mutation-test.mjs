#!/usr/bin/env node
/**
 * scripts/recon/l32-mutation-test.mjs
 *
 * SLICE L-32 — TESTING THE TESTS.
 *
 * ===========================================================================
 * WHY THIS EXISTS AT ALL
 * ===========================================================================
 * The owner's standing instruction is "test it, test the tests". Slice L-29
 * is the permanent reason it is standing: it shipped 37 passing tests for a
 * fix that did not work, because the tests were STRUCTURALLY INCAPABLE of
 * failing. A green suite is evidence of nothing until you have watched it go
 * red for the right reason.
 *
 * This script breaks the L-32 fix, one deliberate defect at a time, and
 * demands the suite notice. A mutation that SURVIVES is a hole in the tests,
 * not a curiosity.
 *
 * INERT mutations — where the search text is not found, so nothing was
 * actually changed — are reported as failures too. L-28 shipped one of those
 * and it looked exactly like a pass.
 *
 * Every mutation is applied to a real file, the real suites are run, and the
 * file is restored from the in-memory original in a `finally`. If this is
 * killed mid-run, `git checkout` the files listed in FILES below.
 *
 * Usage:  node scripts/recon/l32-mutation-test.mjs
 * Exit 0  = every mutation was caught.
 * Exit 1  = at least one survived, or was inert, or restoration failed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * THE SUITES UNDER TEST.
 *
 * The L-32 suite is first, but the L-30 and L-31 suites are included
 * deliberately. This slice changed `planLeaflyOrderActions` — the function
 * BOTH of those suites depend on — so running L-32 alone would prove the new
 * tests work while saying nothing about whether the change quietly broke the
 * guarantees the previous two slices were bought with.
 *
 * THE ESCAPED MUTATION (below) is the reason the render suite is here. It is
 * carried forward from L-31 unchanged, as a standing regression check on the
 * one hole that has actually escaped a sweep in this codebase.
 */
const SUITES = [
  "tests/compliance/leafly-l32-stale-confirm.test.ts",
  "tests/compliance/leafly-l31-lifecycle.test.ts",
  "tests/compliance/leafly-l31-dialog-render.test.tsx",
  "tests/compliance/leafly-l30-one-click-acknowledge.test.ts",
  "tests/compliance/pure-selftests.test.ts",
];

const CORE = "src/lib/leafly/order-ack-core.ts";
const ACK = "src/lib/leafly/order-ack-server.ts";
const FETCH = "src/lib/leafly/order-fetch-server.ts";
const ACTIONS = "src/components/admin/orders/LeaflyOrderActions.tsx";
const PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx";

const FILES = [CORE, ACK, FETCH, ACTIONS, PANEL];

/**
 * Each mutation states the DEFECT IT SIMULATES in plain words. A mutation
 * whose real-world meaning cannot be stated proves nothing about the product.
 */
const MUTATIONS = [
  // ── C4: the stale-confirm detection ────────────────────────────────────
  {
    name: "C4 regression: the 400 comes straight back",
    why: "Removes the stale-state guard entirely. 'Confirm order' returns as the primary button and pressing it sends pending→confirmed to an order Leafly already has at confirmed. This is EXACTLY the owner's reported error.",
    file: CORE,
    from: '  if (currentStatus === "pending") {',
    to: "  if (false) {",
  },
  {
    name: "C4: the guard fires on the WRONG status",
    why: "Diverts healthy confirmed orders into the repair path, so the real next step ('Mark ready for pickup') disappears and the board becomes unusable for good orders.",
    file: CORE,
    from: '  if (currentStatus === "pending") {',
    to: '  if (currentStatus === "confirmed") {',
  },
  {
    name: "C4: the repair action is offered ALONGSIDE the status buttons",
    why: "The safe button appears but the dangerous one is still there, still primary. The operator can still press the press that must fail — a fix that only looks like a fix.",
    file: CORE,
    from: "  const currentStatus = (input.leaflyStatus ?? \"\").trim();\n  if (currentStatus === \"pending\") {",
    to: "  const currentStatus = (input.leaflyStatus ?? \"\").trim();\n  if (false) {",
  },
  {
    name: "C4: the repair is marked irreversible",
    why: "Would print 'Final step — Leafly will not let this order move again' beside a button that only performs a READ. Over-warning is how you train staff to click through the warnings that matter.",
    file: CORE,
    from: "          // Reads from Leafly and writes only to our own row. There is\n          // nothing here to take back.\n          irreversible: false,",
    to: "          irreversible: true,",
  },
  {
    name: "C4: the repair is demoted from primary",
    why: "The operator is no longer steered to the one safe press after an error they do not understand.",
    file: CORE,
    from: '          hint: LEAFLY_RECONCILE_ACTION_HINT,\n          // Reads from Leafly and writes only to our own row. There is\n          // nothing here to take back.\n          irreversible: false,\n          emphasis: "primary",',
    to: '          hint: LEAFLY_RECONCILE_ACTION_HINT,\n          irreversible: false,\n          emphasis: "normal",',
  },

  // ── C4: the WIRING, which rendering cannot see ─────────────────────────
  {
    name: "C4 wiring: the repair button posts to the STATUS action",
    why: "THE NEAR-MISS. An earlier draft chose the destination with a two-way ternary on isAck, so a third kind fell silently into the status branch. The button renders perfectly, posts no nextStatus, and fails validation — the cure produces a fresh error.",
    file: ACTIONS,
    from: "  const formAction = isAck\n    ? acknowledgeAction\n    : isReconcile\n      ? reconcileAction\n      : statusAction;",
    to: "  const formAction = isAck ? acknowledgeAction : statusAction;",
  },
  {
    name: "C4 wiring: the repair form posts a nextStatus anyway",
    why: "Turns the inert read back into a push. The safe button becomes the dangerous one while still being labelled safe.",
    file: ACTIONS,
    from: '      {action.kind === "status" && action.status ? (',
    to: "      {!isAck && action.status ? (",
  },
  {
    name: "C4 wiring: the panel forgets to pass the repair action",
    why: "The button renders and does nothing at all when pressed. Proven to be a compile error, which is the strongest possible catch.",
    file: PANEL,
    from: "            reconcileAction={collectLeaflyOrderAction}",
    to: "",
    expectTypeError: true,
  },

  // ── C4: the explanation ────────────────────────────────────────────────
  {
    name: "C4: the on-screen explanation disappears",
    why: "The expected 'Confirm order' button is missing with no reason given. An operator reasonably concludes the screen is broken — the precise loss of trust the planner's own header warns about.",
    file: ACTIONS,
    from: '  const showStaleNotice = actions.some((a) => a.kind === "reconcile");',
    to: "  const showStaleNotice = false;",
  },
  {
    name: "C4: the notice leaks jargon at the operator",
    why: "'400' and 'stale row' are our words for the problem, not the budtender's. The notice is read at a counter, sometimes with a customer standing there.",
    file: CORE,
    from: '  "This order was accepted here, but this screen and Leafly may disagree "',
    to: '  "Stale row detected: transition 400. "',
  },

  // ── C5: the acknowledge-time failure message ───────────────────────────
  {
    name: "C5: the warning stops naming the repair button",
    why: "Reverts to naming a prohibition with no remedy. The operator is told not to do the one thing they know how to do, and nothing else.",
    file: CORE,
    from: '  `so the shopper may still see it as pending. Press \\u201c${LEAFLY_RECONCILE_ACTION_LABEL}\\u201d `',
    to: '  "so the shopper may still see it as pending. "',
  },
  {
    name: "C5: the warning implies the acknowledgement failed",
    why: "THE MOST EXPENSIVE WORDING MISTAKE AVAILABLE. Invites a second acknowledge against a door that is already shut and ID images that are already gone.",
    file: CORE,
    from: '  "This order IS accepted here and the acknowledgement went through \\u2014 do " +\n  "NOT acknowledge it again. But we could not tell Leafly you confirmed it, " +',
    to: '  "Something went wrong. " +',
  },

  // ── C2: showing Leafly's own reason ────────────────────────────────────
  {
    name: "C2: go back to showing our guess instead of Leafly's reason",
    why: "The owner's error text literally contained the word 'Usually'. We were recording Leafly's real answer in the database and showing him our speculation about it.",
    file: CORE,
    from: "  const theirs = explainLeaflyErrorBody(body);\n  if (theirs === null) return assessment.message;",
    to: "  const theirs = null;\n  if (theirs === null) return assessment.message;",
  },
  {
    name: "C2: ignore validation_result, show only the summary",
    why: "validation_result is where Leafly puts the SPECIFIC field complaint. Dropping it keeps the vague half and discards the actionable half.",
    file: CORE,
    // NOTE (L-32): this read `record.validation_result` and was INERT — the
    // real identifier is `rec`. An inert mutation is a fake pass: it reports
    // nothing survived only because nothing was ever changed. Verified
    // against src/lib/leafly/order-ack-core.ts:787 before re-pinning.
    from: "Array.isArray(rec.validation_result)",
    to: "false",
  },
  {
    name: "C2: the error explanation is unbounded",
    why: "A large or hostile body would flood the operator's screen and push the real controls out of view.",
    file: CORE,
    // NOTE (L-32): the offset was written as 399 here and is 400 in the
    // source, so this too was INERT. Verified at order-ack-core.ts:828.
    from: "  return joined.length > 400 ? `${joined.slice(0, 400)}\u2026` : joined;",
    to: "  return joined;",
  },

  // ── C1: the raw_order wipe (a defect introduced by my own L-31) ─────────
  {
    name: "C1 regression: raw_order is written unconditionally again",
    why: "A 200 with an unreadable body wipes the customer's whole order detail — the '18 blank fields' symptom. raw_order was the ONLY unguarded field of seven, with 20 read sites.",
    file: FETCH,
    from: "  if (hasPayload) patch.raw_order = input.order;",
    to: "  patch.raw_order = input.order;",
  },
  {
    name: "C1: an empty object counts as a real payload",
    why: "Restores the wipe through the exact path persistStatusAfterPush uses, which passes `order: {}` when the body is unusable.",
    file: FETCH,
    from: "    Object.keys(input.order).length > 0;",
    to: "    true;",
  },
  {
    name: "C1: the all-empty patch succeeds silently",
    why: "The hole the C1 guard itself opened. PostgREST accepts an empty update and returns success, so the function would report ok having written nothing whatsoever.",
    file: FETCH,
    from: "  if (Object.keys(patch).length === 0) {",
    to: "  if (false) {",
  },

  // ── C3: the self-heal ──────────────────────────────────────────────────
  {
    name: "C3: a rejection no longer re-reads from Leafly",
    why: "The row stays stale after the rejection, so the operator is returned to the identical screen that just failed them. Stuck forever.",
    file: ACK,
    // NOTE (L-32): this carried four leading spaces of indentation on every
    // line; the real block sits at two. INERT for want of two spaces.
    // Verified at order-ack-server.ts:893-895.
    from: '  if (assessment.disposition === "fix_request") {\n    try {\n      const { collectLeaflyOrder } = await import("./order-fetch-server");',
    to: '  if (false) {\n    try {\n      const { collectLeaflyOrder } = await import("./order-fetch-server");',
  },

  // ── THE ESCAPED MUTATION — carried forward from L-31, permanently ──────
  {
    name: "THE ESCAPED MUTATION (L-31): the picked-up popup comes back",
    why: "This exact mutation SURVIVED a full sweep at 51/51 green, because the rule was tested by READING the source instead of rendering it. It is kept here forever as the standing proof that the render suite has teeth.",
    file: ACTIONS,
    from: "  const needsConfirm = isCancel;",
    to: "  const needsConfirm = action.irreversible;",
  },
];

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", timeout: 600_000 });
    return { pass: true, output: "" };
  } catch (err) {
    return { pass: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function suitePasses() {
  return run("npx", ["vitest", "run", ...SUITES, "--reporter=dot"]).pass;
}

/**
 * Some mutations are caught by the COMPILER rather than by a test — removing
 * a required prop, for instance. That is a stronger guarantee than a failing
 * assertion, not a weaker one, so it counts as caught. But it has to be
 * CHECKED rather than assumed, or "the compiler would catch it" becomes the
 * same kind of comfortable belief this script exists to dismantle.
 */
function typechecks() {
  return run("npx", ["tsc", "--noEmit"]).pass;
}

console.log("=".repeat(76));
console.log("SLICE L-32 — MUTATION SWEEP");
console.log("=".repeat(76));
console.log(`suites : ${SUITES.length}`);
console.log(`files  : ${FILES.length}`);
console.log(`mutants: ${MUTATIONS.length}`);

process.stdout.write("\nBASELINE (unmutated) ... ");
if (!suitePasses()) {
  console.log("❌ THE SUITE IS ALREADY RED. Fix that before mutating.");
  process.exit(1);
}
console.log("✅ green\n");

let caught = 0;
let survived = 0;
let inert = 0;
const problems = [];

for (const m of MUTATIONS) {
  const original = readFileSync(m.file, "utf8");
  const occurrences = original.split(m.from).length - 1;

  if (occurrences === 0) {
    inert += 1;
    problems.push(`INERT: ${m.name} — search text not found in ${m.file}`);
    console.log(`⚠️  INERT    ${m.name}`);
    console.log(`            search text absent from ${m.file}`);
    continue;
  }

  try {
    writeFileSync(m.file, original.replace(m.from, m.to), "utf8");

    // A type error is a catch. Checked FIRST for mutations expected to
    // produce one, because vitest may not even be able to load the file.
    let green;
    if (m.expectTypeError) {
      const compiles = typechecks();
      green = compiles && suitePasses();
      if (!compiles) {
        console.log(`✅ caught   ${m.name}`);
        console.log(`            (caught by the COMPILER — the strongest catch)`);
        caught += 1;
        continue;
      }
    } else {
      green = suitePasses();
    }

    if (green) {
      survived += 1;
      problems.push(`SURVIVED: ${m.name} (${m.file})`);
      console.log(`❌ SURVIVED ${m.name}`);
      console.log(`            ${m.why}`);
    } else {
      caught += 1;
      console.log(`✅ caught   ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, original, "utf8");
  }
}

console.log("\n" + "=".repeat(76));
console.log(`caught: ${caught}   survived: ${survived}   inert: ${inert}`);
console.log("=".repeat(76));

process.stdout.write("\nPOST-RESTORE (unmutated) ... ");
const restored = suitePasses();
console.log(restored ? "✅ green" : "❌ RED — files were not restored cleanly!");

if (problems.length > 0 || !restored) {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log(`  - ${p}`);
  if (!restored) console.log("  - the suite is red after restoration");
  process.exit(1);
}

console.log("\n✅ Every mutation was caught. The tests can fail, for the right reasons.");
process.exit(0);
