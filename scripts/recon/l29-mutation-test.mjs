/**
 * scripts/recon/l29-mutation-test.mjs
 *
 * SLICE L-29 — testing the tests.
 *
 * A green suite proves nothing until you show it can go red. Each mutation
 * below reintroduces the L-29 bug, or a plausible neighbouring mistake, and
 * the suite must fail. A mutation that SURVIVES is a hole in the suite.
 *
 * This has earned its place: the L-28 sweep caught two real holes a fully
 * green suite had hidden, and the L-28 probe sweep caught two more.
 *
 * Run:  node scripts/recon/l29-mutation-test.mjs
 */

import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const TARGETS = {
  keeper: "src/components/admin/ux/PendingKeeper.tsx",
  core: "src/lib/admin/pending-core.ts",
  actions: "src/components/admin/orders/LeaflyOrderActions.tsx",
};
const SUITE = "tests/compliance/leafly-l29-phantom-pending.test.ts";
const BACKUPS = Object.fromEntries(
  Object.entries(TARGETS).map(([k, p]) => [k, `/tmp/l29-backup-${k}`]),
);

for (const [k, p] of Object.entries(TARGETS)) copyFileSync(p, BACKUPS[k]);
const restore = () => {
  for (const [k, p] of Object.entries(TARGETS)) copyFileSync(BACKUPS[k], p);
};

/**
 * Each mutation: a file key, and a transform. Returning the unchanged source
 * is treated as a harness error (the anchor drifted), not as a pass.
 */
const MUTATIONS = [
  // ── The original bug, put straight back ────────────────────────────────
  {
    name: "Keeper commits pending during the CAPTURE phase again (the bug)",
    file: "keeper",
    fn: (s) =>
      s.replace(
        /queueMicrotask\(\(\) => \{[\s\S]*?\}\);\n    \}/,
        "startPending(rec);\n    }",
      ),
  },
  {
    name: "Keeper ignores defaultPrevented (treats a cancelled submit as a save)",
    file: "keeper",
    fn: (s) => s.replace(/defaultPrevented: e\.defaultPrevented/, "defaultPrevented: false"),
  },
  {
    name: "Keeper drops the submitDidStart check entirely",
    file: "keeper",
    fn: (s) =>
      s.replace(
        /if \(!submitDidStart\(\{[\s\S]*?\}\)\) \{\n\s*return;[^}]*\}/,
        "",
      ),
  },
  {
    name: "Keeper stops passing form connectedness",
    file: "keeper",
    fn: (s) => s.replace(/formConnected: form\.isConnected/, "formConnected: true"),
  },
  {
    name: "Keeper sets gwBusy provisionally, before the save is known real",
    file: "keeper",
    fn: (s) =>
      s.replace(
        /const submitter = \(e as SubmitEvent\)\.submitter;/,
        'form.dataset.gwBusy = "1";\n      const submitter = (e as SubmitEvent).submitter;',
      ),
  },
  {
    name: "Keeper loses its double-submit guard",
    file: "keeper",
    fn: (s) => s.replace(/if \(form\.dataset\.gwBusy === "1"\) \{/, "if (false) {"),
  },
  {
    name: "Keeper engages with non-server-action forms too",
    file: "keeper",
    fn: (s) =>
      s.replace(/if \(!isServerActionForm\(form\.getAttribute\("action"\)\)\) return;/, ""),
  },

  // ── The pure rule ──────────────────────────────────────────────────────
  {
    name: "submitDidStart says a cancelled submit IS a save",
    file: "core",
    fn: (s) => s.replace(/if \(s\.defaultPrevented\) return false;/, ""),
  },
  {
    name: "submitDidStart ignores a detached form",
    file: "core",
    fn: (s) => s.replace(/if \(!s\.formConnected\) return false;/, ""),
  },
  {
    name: "submitDidStart always returns true",
    file: "core",
    fn: (s) =>
      s.replace(
        /export function submitDidStart\(s: SubmitSettle\): boolean \{[\s\S]*?\n\}/,
        "export function submitDidStart(_s: SubmitSettle): boolean {\n  return true;\n}",
      ),
  },
  {
    name: "Form ceiling lowered to the nav ceiling (would mask the phantom)",
    file: "core",
    fn: (s) =>
      s.replace(/export const PENDING_FORM_SAFETY_TIMEOUT_MS = 300_000;/, "export const PENDING_FORM_SAFETY_TIMEOUT_MS = 20_000;"),
  },
  {
    name: "The 'Still working' sentence changes wording",
    file: "core",
    fn: (s) => s.replace(/Still working — \$\{secs\}s\./, "Working — ${secs}s."),
  },

  // ── ActionForm's confirmed-submit guard ────────────────────────────────
  {
    name: "ActionForm reverts to the render-closure state guard (2nd bug)",
    file: "actions",
    fn: (s) =>
      s.replace(
        /if \(!action\.irreversible\) return;\n\s*if \(confirmedRef\.current\) \{[\s\S]*?\n\s*\}\n\s*e\.preventDefault\(\);\n\s*setConfirming\(true\);/,
        "if (action.irreversible && !confirming) {\n            e.preventDefault();\n            setConfirming(true);\n          }",
      ),
  },
  {
    name: "onConfirm submits BEFORE granting permission",
    file: "actions",
    fn: (s) =>
      s.replace(
        /confirmedRef\.current = true;\n\s*setConfirming\(false\);\n\s*formRef\.current\?\.requestSubmit\(\);/,
        "setConfirming(false);\n            formRef.current?.requestSubmit();\n            confirmedRef.current = true;",
      ),
  },
  {
    name: "Permission is no longer one-shot (a stray submit inherits the yes)",
    file: "actions",
    fn: (s) =>
      s.replace(
        /confirmedRef\.current = false; \/\/ one-shot: consume the permission/,
        "// permission left standing",
      ),
  },
  {
    name: "onCancel leaves permission granted",
    file: "actions",
    fn: (s) =>
      s.replace(
        /onCancel=\{\(\) => \{[\s\S]*?confirmedRef\.current = false;\n\s*setConfirming\(false\);\n\s*\}\}/,
        "onCancel={() => setConfirming(false)}",
      ),
  },
  {
    name: "Reversible actions get intercepted too",
    file: "actions",
    fn: (s) => s.replace(/if \(!action\.irreversible\) return;/, ""),
  },
  {
    name: "The confirmation dialog is removed entirely",
    file: "actions",
    fn: (s) => s.replace(/Acknowledge this order to Leafly\?/, "Acknowledge?"),
  },
];

function runSuite() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=dot`, {
      stdio: "pipe",
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
    });
    return true; // green
  } catch {
    return false; // red
  }
}

console.log("─".repeat(74));
console.log("L-29 MUTATION SWEEP — can the suite actually go red?");
console.log("─".repeat(74));

// Baseline must be green, or every result below is meaningless.
restore();
if (!runSuite()) {
  console.error("BASELINE IS RED. Fix the suite before running the sweep.");
  process.exit(2);
}
console.log("baseline: GREEN\n");

let caught = 0;
const survived = [];
const broken = [];

MUTATIONS.forEach((m, i) => {
  restore();
  const path = TARGETS[m.file];
  const before = readFileSync(path, "utf8");
  const after = m.fn(before);
  if (after === before) {
    broken.push(m.name);
    console.log(`  ANCHOR MISS  ${i + 1}. ${m.name}`);
    return;
  }
  writeFileSync(path, after);
  const green = runSuite();
  if (green) {
    survived.push(m.name);
    console.log(`  SURVIVED <-- ${i + 1}. ${m.name}`);
  } else {
    caught += 1;
    console.log(`  caught       ${i + 1}. ${m.name}`);
  }
});

restore();

console.log(`\n${"─".repeat(74)}`);
console.log(
  `RESULT: ${caught} caught, ${survived.length} survived, ${broken.length} anchor-miss, of ${MUTATIONS.length}`,
);
if (broken.length) {
  console.log("\nANCHOR MISSES (the mutation never applied — fix the harness):");
  for (const b of broken) console.log(`   - ${b}`);
}
if (survived.length) {
  console.log("\nHOLES IN THE SUITE:");
  for (const s of survived) console.log(`   - ${s}`);
}
if (survived.length === 0 && broken.length === 0) {
  console.log("Every mutation was caught. The suite defends the fix.");
}

// Verify the source really is back to normal.
let dirty = false;
for (const [k, p] of Object.entries(TARGETS)) {
  if (readFileSync(p, "utf8") !== readFileSync(BACKUPS[k], "utf8")) {
    console.error(`RESTORE FAILED for ${p}`);
    dirty = true;
  }
}
if (dirty) process.exit(3);
console.log("Source restored cleanly.");
process.exit(survived.length === 0 && broken.length === 0 ? 0 : 1);
