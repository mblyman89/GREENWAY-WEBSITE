#!/usr/bin/env node
/**
 * scripts/recon/l30-mutation-test.mjs — SLICE L-30. TEST THE TESTS.
 *
 * ===========================================================================
 * WHY THIS SWEEP IS TAKEN MORE SERIOUSLY THAN THE LAST ONE
 * ===========================================================================
 * L-29 ran a mutation sweep too. 18 mutations, 18 caught, zero survived — and
 * the fix it was guarding did not work. That is worth sitting with, because
 * it is the trap this whole slice exists to escape:
 *
 *   A MUTATION SWEEP MEASURES WHETHER YOUR TESTS PIN YOUR CODE.
 *   IT CANNOT TELL YOU WHETHER YOUR CODE IS RIGHT.
 *
 * L-29's tests pinned L-29's design perfectly. The design was wrong, so the
 * sweep cheerfully certified a bug. A sweep is a necessary check, never a
 * sufficient one, and it is why this slice ALSO ships two probes that drive
 * real Chromium with real trusted clicks (`l30-real-click-probe.mjs`,
 * `l30-plain-form-regression-probe.mjs`). Those answer "does it work"; this
 * answers "would we notice if it stopped".
 *
 * Every mutation below is a plausible future edit — a refactor, a cleanup, a
 * well-meaning simplification — and several are literally the L-29 code being
 * put back. If any survives, the guard is decorative and must be strengthened
 * before shipping.
 *
 * Run:  node scripts/recon/l30-mutation-test.mjs
 * Exit: 0 = every mutation caught; 1 = at least one survived.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TEST = "tests/compliance/leafly-l30-one-click-acknowledge.test.ts";

const KEEPER = "src/components/admin/ux/PendingKeeper.tsx";
const ACTIONS = "src/components/admin/orders/LeaflyOrderActions.tsx";
const CORE = "src/lib/admin/pending-core.ts";

const log = (...a) => console.log(...a);
const hr = (t) => log(`\n${"═".repeat(74)}\n${t}\n${"═".repeat(74)}`);

/**
 * Each mutation: a file, a find, a replace, and a plain-English description
 * of the regression it simulates.
 */
const MUTATIONS = [
  // ── Putting L-29 back, in pieces ─────────────────────────────────────────
  {
    name: "Keeper defers the decision to a microtask again (the L-29 design)",
    file: KEEPER,
    apply: (s) =>
      s.replace(
        "      const submitter = (e as SubmitEvent).submitter;\n      startPending({",
        "      const submitter = (e as SubmitEvent).submitter;\n      queueMicrotask(() => {});\n      startPending({",
      ),
  },
  {
    name: "Keeper reads defaultPrevented in the submit path again",
    file: KEEPER,
    apply: (s) =>
      s.replace(
        "          formConnected: form.isConnected,",
        "          formConnected: form.isConnected && !e.defaultPrevented,",
      ),
  },
  {
    name: "Keeper stops asking the pure rule and inlines the check",
    file: KEEPER,
    apply: (s) =>
      s.replace(
        /if \(\n\s*!submitShouldShowPending\(\{[\s\S]*?\}\)\n\s*\) \{\n\s*return;\n\s*\}/,
        'if (!isServerActionForm(form.getAttribute("action"))) {\n        return;\n      }',
      ),
  },
  {
    name: "Keeper ignores the opt-out marker",
    file: KEEPER,
    apply: (s) =>
      s.replace(
        "          optedOut: form.hasAttribute(PENDING_OPT_OUT_ATTR),",
        "          optedOut: false,",
      ),
  },
  {
    name: "Keeper forgets the form-connected check",
    file: KEEPER,
    apply: (s) =>
      s.replace("          formConnected: form.isConnected,", "          formConnected: true,"),
  },
  {
    name: "Keeper starts pending BEFORE consulting the rule",
    file: KEEPER,
    apply: (s) => {
      const guard = s.match(
        /      if \(\n\s*!submitShouldShowPending\(\{[\s\S]*?\}\)\n\s*\) \{\n\s*return;\n\s*\}\n/,
      );
      if (!guard) return s;
      const start = s.match(/      const submitter = \(e as SubmitEvent\)\.submitter;\n      startPending\(\{[\s\S]*?\n      \}\);\n/);
      if (!start) return s;
      return s.replace(guard[0], "").replace(start[0], start[0] + guard[0]);
    },
  },
  {
    name: "Keeper drops the double-submit guard",
    file: KEEPER,
    apply: (s) =>
      s.replace(
        /      if \(form\.dataset\.gwBusy === "1"\) \{[\s\S]*?\n      \}\n/,
        "",
      ),
  },
  {
    name: "Keeper stops watching in the capture phase",
    file: KEEPER,
    apply: (s) =>
      s.replace('addEventListener("submit", onSubmit, true)', 'addEventListener("submit", onSubmit, false)'),
  },
  {
    name: "Keeper's nav listener stops matching anchors (would catch buttons)",
    file: KEEPER,
    apply: (s) => s.replace('closest?.("a[href]")', 'closest?.("a[href], button")'),
  },

  // ── The pure rule ────────────────────────────────────────────────────────
  {
    name: "The rule becomes ambiguous again — it consults defaultPrevented",
    file: CORE,
    apply: (s) =>
      s.replace(
        "export function submitShouldShowPending(s: SubmitStart): boolean {",
        "export function submitShouldShowPending(s: SubmitStart & { defaultPrevented?: boolean }): boolean {\n  if (s.defaultPrevented) return false;",
      ),
  },
  {
    name: "The rule always says yes",
    file: CORE,
    apply: (s) =>
      s.replace(
        /export function submitShouldShowPending\(s: SubmitStart\): boolean \{[\s\S]*?\n\}/,
        "export function submitShouldShowPending(_s: SubmitStart): boolean {\n  return true;\n}",
      ),
  },
  {
    name: "The rule ignores the opt-out",
    file: CORE,
    apply: (s) => s.replace("  if (s.optedOut) return false;", ""),
  },
  {
    name: "The rule engages client panels' own forms",
    file: CORE,
    apply: (s) => s.replace("  if (!s.serverAction) return false;", ""),
  },
  {
    name: "The deleted L-29 rule is quietly restored alongside the new one",
    file: CORE,
    apply: (s) =>
      s +
      "\nexport type SubmitSettle = { defaultPrevented: boolean; formConnected: boolean };\n" +
      "export function submitDidStart(s: SubmitSettle): boolean {\n  return !s.defaultPrevented && s.formConnected;\n}\n",
  },
  {
    name: "The opt-out attribute name drifts",
    file: CORE,
    apply: (s) =>
      s.replace('export const PENDING_OPT_OUT_ATTR = "data-gw-no-pending";', 'export const PENDING_OPT_OUT_ATTR = "data-gw-skip-pending";'),
  },
  {
    name: "The form-save ceiling is shortened to the nav ceiling",
    file: CORE,
    apply: (s) => s.replace("PENDING_FORM_SAFETY_TIMEOUT_MS = 300_000", "PENDING_FORM_SAFETY_TIMEOUT_MS = 20_000"),
  },
  {
    name: "The 'Still working' threshold is removed (noise on every save)",
    file: CORE,
    apply: (s) => s.replace("PENDING_STILL_WORKING_MS = 10_000", "PENDING_STILL_WORKING_MS = 0"),
  },
  {
    name: "Pending never clears on navigation — the stuck-UI regression",
    file: CORE,
    apply: (s) =>
      s.replace(
        'if (c.hrefNow !== c.hrefAtStart) return { clear: true, reason: "navigated" };',
        "",
      ),
  },

  // ── The component: the actual thing the owner asked for ──────────────────
  {
    name: "THE BIG ONE — the acknowledge confirmation dialog is put back",
    file: ACTIONS,
    apply: (s) => s.replace("const needsConfirm = action.irreversible && !isAck;", "const needsConfirm = action.irreversible;"),
  },
  {
    name: "A form cancels its own submit again (submit-to-ask-a-question)",
    file: ACTIONS,
    apply: (s) =>
      s.replace(
        '        action={isAck ? acknowledgeAction : statusAction}\n        className="inline"',
        '        action={isAck ? acknowledgeAction : statusAction}\n        onSubmit={(e) => { e.preventDefault(); }}\n        className="inline"',
      ),
  },
  {
    name: "The confirm-first button becomes a submit again",
    file: ACTIONS,
    apply: (s) =>
      s.replace(
        '        <SubmitButton\n          action={action}\n          type="button"\n          onClick={() => setConfirming(true)}\n        />',
        "        <SubmitButton action={action} />",
      ),
  },
  {
    name: "The relocated warning is dropped — protection silently lost",
    file: ACTIONS,
    apply: (s) =>
      s.replace(
        /      \{showAckWarning \? \([\s\S]*?\) : null\}\n/,
        "",
      ),
  },
  {
    name: "The warning shows for the wrong actions",
    file: ACTIONS,
    apply: (s) => s.replace('(a) => a.kind === "acknowledge" && a.irreversible,', "() => true,"),
  },
  {
    name: "The component hard-codes its own copy of the warning wording",
    file: ACTIONS,
    apply: (s) =>
      s.replace(
        "          {irreversibleWarning}",
        '          {"Leafly then permanently revokes our access to the ID images."}',
      ),
  },
  {
    name: "The busy button stops disabling itself (double-submit on a one-way door)",
    file: ACTIONS,
    apply: (s) => s.replace(/disabled=\{pending\}/g, "disabled={false}"),
  },
  {
    name: "The busy label stops changing (the L-17 regression)",
    file: ACTIONS,
    apply: (s) => s.replace("const label = pending ? action.busyLabel : action.label;", "const label = action.label;"),
  },
];

// ───────────────────────────────────────────────────────────────────────────
function runTests() {
  try {
    execFileSync("npx", ["vitest", "run", TEST, "--reporter=dot"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    return true; // tests passed
  } catch {
    return false; // tests failed
  }
}

hr("L-30 MUTATION SWEEP — would the tests notice if this broke?");

log("\nBaseline: the suite must be GREEN before any mutation is applied.");
if (!runTests()) {
  log("  ❌ baseline is already failing — fix that first.");
  process.exit(1);
}
log("  ✅ baseline green\n");

const originals = new Map();
for (const f of [KEEPER, ACTIONS, CORE]) {
  originals.set(f, readFileSync(resolve(ROOT, f), "utf8"));
}
function restoreAll() {
  for (const [f, src] of originals) writeFileSync(resolve(ROOT, f), src);
}
process.on("exit", restoreAll);
process.on("SIGINT", () => { restoreAll(); process.exit(130); });

let caught = 0;
const survived = [];
const inert = [];

MUTATIONS.forEach((m, i) => {
  const original = originals.get(m.file);
  const mutated = m.apply(original);
  const n = String(i + 1).padStart(2, "0");

  if (mutated === original) {
    // The mutation did not change anything — it cannot test anything either.
    // Reported loudly: a no-op mutation silently inflates the score, which is
    // the mutation-testing equivalent of the bug this slice is about.
    inert.push(m.name);
    log(`  ⚠️  ${n}. INERT (pattern did not match): ${m.name}`);
    return;
  }

  writeFileSync(resolve(ROOT, m.file), mutated);
  const stillGreen = runTests();
  writeFileSync(resolve(ROOT, m.file), original);

  if (stillGreen) {
    survived.push(m.name);
    log(`  ❌ ${n}. SURVIVED: ${m.name}`);
  } else {
    caught += 1;
    log(`  ✅ ${n}. caught:   ${m.name}`);
  }
});

restoreAll();

hr("RESULT");
log(`  mutations applied : ${MUTATIONS.length - inert.length}`);
log(`  caught            : ${caught}`);
log(`  survived          : ${survived.length}`);
log(`  inert (no-op)     : ${inert.length}`);

if (inert.length > 0) {
  log("\n  ⚠️  Inert mutations test nothing. Fix their patterns:");
  for (const n of inert) log(`     • ${n}`);
}
if (survived.length > 0) {
  log("\n  ❌ These regressions would ship unnoticed:");
  for (const n of survived) log(`     • ${n}`);
}

if (survived.length > 0 || inert.length > 0) process.exit(1);

log("\n  ✅ Every mutation was caught.");
log("\n  Read this the right way: the tests now PIN the code. That is not the");
log("  same as the code being CORRECT — L-29 scored 18/18 on a broken fix.");
log("  The correctness evidence is l30-real-click-probe.mjs, which drives");
log("  real Chromium with a real trusted click and counts the requests.");
process.exit(0);
