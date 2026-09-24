#!/usr/bin/env node
/**
 * scripts/recon/l31-mutation-test.mjs
 *
 * SLICE L-31 — TESTING THE TESTS.
 *
 * ===========================================================================
 * WHY
 * ===========================================================================
 * The owner's standing instruction is "test it, test the tests", and slice
 * L-29 is the permanent reason it is a standing instruction: that slice
 * shipped 37 passing tests for a fix that did not work, because the tests
 * were STRUCTURALLY INCAPABLE of failing. A green suite is evidence of
 * nothing until you have watched it go red for the right reason.
 *
 * This script breaks the fix, one deliberate defect at a time, and demands
 * that the suite notices. A mutation that SURVIVES is a hole in the tests.
 *
 * It also checks for INERT mutations — ones where the search text was not
 * found at all, so nothing was actually changed and the "test" was vacuous.
 * L-28 shipped an inert mutation that looked like a pass; it is checked for
 * explicitly here so that a refactor which renames a symbol turns this script
 * red instead of quietly hollowing it out.
 *
 * Every mutation is applied to a real file on disk, the real suite is run,
 * and the file is restored from the in-memory original in a `finally`. If the
 * process is killed mid-run, `git checkout` the listed files.
 *
 * Usage:  node scripts/recon/l31-mutation-test.mjs
 * Exit 0  = every mutation was caught.
 * Exit 1  = at least one survived or was inert.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * THE SUITES UNDER TEST.
 *
 * This was a single file until a mutation escaped it. The story is worth
 * keeping, because it is the whole reason the second file exists:
 *
 *   The rule "Mark picked up must not open a popup" was, at first, tested by
 *   READING LeaflyOrderActions.tsx and asserting on the text of the
 *   `needsConfirm` expression. That test passed. It also passed when the
 *   expression was changed to `const needsConfirm = action.irreversible;`
 *   — a change that PUTS THE POPUP BACK, because `irreversible` is true for
 *   the picked_up action. The mutation survived at 51/51 green.
 *
 *   A rule about what the UI DOES cannot be proven by reading the source.
 *   You have to render it and look at the output. That is
 *   leafly-l31-dialog-render.test.tsx, and it is included here so that the
 *   sweep exercises the assertion that actually has teeth.
 *
 * Both files must be green for a mutation to count as SURVIVED.
 */
const SUITES = [
  "tests/compliance/leafly-l31-lifecycle.test.ts",
  "tests/compliance/leafly-l31-dialog-render.test.tsx",
  "tests/compliance/leafly-l30-one-click-acknowledge.test.ts",
];

const CORE = "src/lib/leafly/lifecycle-core.ts";
const ACK = "src/lib/leafly/order-ack-server.ts";
const BRIDGE = "src/lib/leafly/bridge-server.ts";
const ACTIONS = "src/components/admin/orders/LeaflyOrderActions.tsx";
const STRIP = "src/components/admin/orders/LeaflyLifecycleStrip.tsx";
const PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx";

/**
 * Each mutation states the DEFECT IT SIMULATES in plain words. A mutation
 * whose real-world meaning cannot be stated is a mutation that proves
 * nothing about the product.
 */
const MUTATIONS = [
  // ── D1 / D2: the writeback ───────────────────────────────────────────────
  {
    name: "D1 regression: the status push stops persisting entirely",
    why: "The original bug. Leafly moves, our board does not.",
    file: ACK,
    // Turns the call into a discarded object literal. Syntactically valid,
    // semantically the pre-L-31 behaviour: Leafly is told, we are not.
    from: "    persistWarning = await persistStatusAfterPush({",
    to: "    persistWarning = null; void ({",
  },
  {
    name: "D1 regression: persistence runs even on a FAILED push",
    why: "Writing a status Leafly rejected is worse than writing nothing.",
    file: ACK,
    from: 'if (assessment.disposition === "success") {',
    to: "if (true) {",
  },
  {
    name: "D2 regression: ignore Leafly's body, write what we asked for",
    why: "Believing our intent over Leafly's confirmation.",
    file: CORE,
    from: 'return { status: fromBody, source: "response_body", usedResponseBody: true };',
    to: 'return { status: input.requestedStatus.trim(), source: "requested", usedResponseBody: false };',
  },
  {
    name: "D2 regression: no fallback when the body is unreadable",
    why: "A 200 with an empty body would leave the row stale forever.",
    file: CORE,
    from: 'if (fromBody !== "") {',
    to: "if (false) {",
  },

  // ── D3: closing the local order ──────────────────────────────────────────
  {
    name: "D3 regression: picked_up no longer closes the register order",
    why: "The order never reaches the hidden table — the owner's complaint.",
    file: CORE,
    from: '  if (status === "picked_up") {',
    to: "  if (false) {",
  },
  {
    name: "D3: close as 'completed' on a CANCELLED order",
    why: "A cancelled order counted as a completed sale.",
    file: CORE,
    from: '      localStatus: "cancelled",',
    to: '      localStatus: "completed",',
  },
  {
    name: "D3: Leafly's one-L spelling written into Greenway's column",
    why: "Violates the migration 0007 CHECK constraint at runtime.",
    file: CORE,
    from: 'reason: `This order is ${status} on Leafly.`,',
    to: 'reason: `This order is canceled on Leafly.`,',
    expectCaught: false,
    note: "reason text only — not asserted, and should NOT be",
    informational: true,
  },
  {
    name: "D3: close an order even with no register order linked",
    why: "Would attempt a write against a null id.",
    file: CORE,
    from: "  if (!hasLocal) {",
    to: "  if (false) {",
  },
  {
    name: "D3: re-close an order a human already settled",
    why: "A remote event silently overwriting a settled till.",
    file: BRIDGE,
    from: 'const CLOSEABLE_FROM = ["new", "acknowledged", "preparing", "ready"];',
    to: 'const CLOSEABLE_FROM = ["new", "acknowledged", "preparing", "ready", "completed", "cancelled", "no_show"];',
  },
  {
    name: "D3: the completion bridge is deleted",
    why: "The stage that did not exist before this slice.",
    file: BRIDGE,
    from: "export async function onLeaflyOrderClosed",
    to: "async function onLeaflyOrderClosed_removed",
  },
  {
    name: "D3: caller stops distinguishing no-op from failure",
    why: "Every confirmed/ready push would warn the operator falsely.",
    file: ACK,
    from: "if (!closed.attempted) return null;",
    to: "if (false) return null;",
  },

  // ── The step model ───────────────────────────────────────────────────────
  {
    name: "two steps marked current at once",
    why: "'Which step am I on?' becomes ambiguous again.",
    file: CORE,
    // The real shape. The first draft of this mutation guessed at an
    // `index === currentIndex` line that does not exist, so it changed
    // nothing and "passed" vacuously. That is the L-28 inert-mutation trap,
    // and it is why this script reports INERT as a failure rather than
    // letting a no-op masquerade as a caught defect.
    from: '    if (key === nextStatus) return "current";',
    to: '    if (idx > currentIdx) return "current";',
  },
  {
    name: "pickup orders get the delivery steps",
    why: "A finished pickup order looks permanently two-thirds done.",
    file: CORE,
    from: '  return (fulfillmentMechanism ?? "").trim() === "delivery"',
    to: '  return (fulfillmentMechanism ?? "").trim() !== "delivery"',
  },
  {
    name: "raw enum values shown as step labels",
    why: "'picked_up' on a counter screen is a developer's word.",
    file: CORE,
    from: '  picked_up: "Picked up",',
    to: '  picked_up: "picked_up",',
  },
  {
    name: "the strip's 'Next' label drifts from the button label",
    why: "The operator hunts for a control that does not exist.",
    file: CORE,
    from: '  ready: "Mark ready for pickup",',
    to: '  ready: "Set ready",',
  },
  {
    name: "picked_up no longer counts as closed",
    why: "The card never leaves the open list.",
    file: CORE,
    from: '      phase: "complete",\n      headline: "Complete. This order is finished and closed on Leafly.",\n      nextLabel: null,\n      nextStatus: null,\n      steps: buildSteps(() => "done"),\n      progress: 1,\n      isClosed: true,',
    to: '      phase: "in_progress",\n      headline: "Complete. This order is finished and closed on Leafly.",\n      nextLabel: null,\n      nextStatus: null,\n      steps: buildSteps(() => "done"),\n      progress: 1,\n      isClosed: false,',
  },

  // ── The popup the owner asked us to remove ───────────────────────────────
  {
    name: "the 'Mark picked up' popup comes back",
    why: "Literally the thing the owner asked us to delete.",
    file: ACTIONS,
    from: "  const needsConfirm = isCancel;",
    to: "  const needsConfirm = action.irreversible && !isAck;",
  },
  {
    name: "THE ESCAPED MUTATION: popup returns via `action.irreversible`",
    why:
      "This exact edit survived a 51-test green suite on 2025-09-24. It puts " +
      "the 'Mark picked up' popup back AND re-adds one to acknowledge, while " +
      "mentioning neither 'isAck' nor 'acknowledge' — so every source-reading " +
      "assertion written about the expression is blind to it. It is pinned " +
      "here permanently. If this one ever goes back to SURVIVED, the render " +
      "test has been weakened or deleted; do not accept the slice.",
    file: ACTIONS,
    from: "  const needsConfirm = isCancel;",
    to: "  const needsConfirm = action.irreversible;",
  },
  {
    name: "the CANCEL confirmation is removed too",
    why: "Reading the owner's instruction wider than he gave it.",
    file: ACTIONS,
    from: "  const needsConfirm = isCancel;",
    to: "  const needsConfirm = false;",
  },
  {
    name: "the relocated terminal warning is deleted",
    why: "L-30's rule: relocate the protection, never just delete it.",
    file: ACTIONS,
    from: "leafly-terminal-note-",
    to: "leafly-note-removed-",
  },
  {
    name: "a form cancels its own submit again",
    why: "The L-30 invariant that cost four slices.",
    file: ACTIONS,
    from: "        {hiddenFields}\n        {terminalNote}",
    to: "        {hiddenFields}\n        {((e) => e.preventDefault) ? null : null}\n        {terminalNote}",
  },

  // ── The strip ────────────────────────────────────────────────────────────
  {
    name: "the strip is removed from the order card",
    why: "The whole visibility half of the slice disappears.",
    file: PANEL,
    from: "        <LeaflyLifecycleStrip",
    to: "        <LeaflyLifecycleStripRemoved",
  },
  {
    name: "the strip becomes a client component",
    why: "Puts the one thing that must always render behind hydration.",
    file: STRIP,
    from: "import { lifecycleView }",
    to: '"use client";\nimport { useState } from "react";\nimport { lifecycleView }',
  },
  {
    name: "aria-current is dropped — colour becomes the only signal",
    why: "Unreadable to a colour-blind operator on a phone at a counter.",
    file: STRIP,
    from: "              aria-current={step.state === \"current\" ? \"step\" : undefined}",
    to: "              data-current={step.state === \"current\" ? \"step\" : undefined}",
  },
  {
    name: "the 'Leafly sends the emails' note is deleted",
    why: "The owner loses the answer he spent a slice asking for.",
    file: STRIP,
    from: "Leafly sends every customer message",
    to: "Greenway sends every customer message",
  },
  {
    name: "the strip starts deciding the lifecycle itself",
    why: "A second, untested copy of Leafly's transition rules.",
    file: STRIP,
    from: "  const view = lifecycleView({",
    to: "  const LEAFLY_ORDER_STATUS_SEQUENCE = [];\n  void LEAFLY_ORDER_STATUS_SEQUENCE;\n  const view = lifecycleView({",
  },

  // ── The spec pins ────────────────────────────────────────────────────────
  {
    name: "the core stops citing the spec checksum",
    why: "Nobody can tell which document the rules were derived from.",
    file: CORE,
    from: "daab7bcf6f77177de85425adf7f805f1",
    to: "00000000000000000000000000000000",
  },
];

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", timeout: 180_000 });
    return { pass: true, output: "" };
  } catch (err) {
    return { pass: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function suitePasses() {
  return run("npx", ["vitest", "run", ...SUITES, "--reporter=dot"]).pass;
}

console.log("=".repeat(76));
console.log("L-31 MUTATION SWEEP — does the suite actually catch the defects?");
console.log("=".repeat(76));

// Baseline. If the suite is not green to begin with, every result below is
// meaningless, so refuse to continue rather than report nonsense.
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
    const green = suitePasses();

    if (m.informational) {
      // Not a hole in the tests — deliberately unasserted. Reported so the
      // decision is visible rather than silently absent.
      console.log(`ℹ️  NOTED    ${m.name}`);
      console.log(`            ${m.note} (suite ${green ? "stayed green" : "went red"})`);
      continue;
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

// Restoration check: the tree must be exactly as we found it.
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
