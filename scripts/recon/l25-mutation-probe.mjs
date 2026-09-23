#!/usr/bin/env node
/**
 * SLICE L-25 — MUTATION PROBE ("test the tests")
 * =============================================================================
 *
 * The owner asked for this explicitly: "Test it, test the tests."
 *
 * A green suite proves nothing on its own. This slice is proof of that: the
 * detail-view money code was wrong by a factor of a hundred for its entire
 * life, and 17,716 tests stayed green over it, because the FIXTURE invented
 * dollar amounts and cart keys that Leafly never sends. The tests agreed with
 * the code, and both disagreed with reality.
 *
 * So instead of trusting green, this probe deliberately BREAKS the code, one
 * change at a time, and demands that the suite notice. A mutant that survives
 * is a hole in the tests — a change that could ship without any alarm.
 *
 * ── HOW TO READ THE OUTPUT ───────────────────────────────────────────────────
 *   KILLED   — the suite caught the sabotage. Good.
 *   SURVIVED — the suite did NOT notice. That is a gap, unless the mutant is
 *              marked as a CONTROL.
 *
 * ── WHY THERE IS A CONTROL MUTANT ────────────────────────────────────────────
 * A harness that reports "all killed" is indistinguishable from a harness
 * that is silently broken — one that edits the wrong file, or runs no tests,
 * or treats every exit code as failure. The CONTROL is a change that is
 * genuinely harmless (a comment edit). It MUST survive. If the control dies,
 * the harness itself is lying and every other result here is worthless.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 * Every mutation is applied to a file, tested, then reverted from an in-memory
 * copy of the original bytes. The original is restored in a `finally`, and a
 * final verification re-reads every touched file and compares it byte-for-byte
 * with what was read at the start. If a revert ever failed, this says so
 * loudly rather than leaving sabotaged code in the tree.
 *
 * Usage:  node scripts/recon/l25-mutation-probe.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/* ------------------------------------------------------------------------- *
 * THE MUTANTS
 * ------------------------------------------------------------------------- */

const DETAIL_CORE = "src/lib/leafly/order-detail-core.ts";
const DB_DEADLINE = "src/lib/leafly/db-deadline.ts";
const CREDS = "src/lib/integrations/integration-credentials-store.ts";

/**
 * `tests` is the narrowest set of files that SHOULD catch the mutant. Running
 * the whole 191-second suite per mutant would take an hour; running a targeted
 * set is honest as long as the set is the one a reviewer would expect to fail.
 *
 * `selfTest` runs the pure self-test harness instead, for mutants whose
 * coverage lives inside the module's own `__selfTest...` function.
 */
const MUTANTS = [
  // ---- the money defect this slice fixed ----------------------------------
  // Each of these re-introduces the exact bug the owner would have seen.
  {
    name: "subtotal is scaled again (the 100x defect returns)",
    file: DETAIL_CORE,
    find: "subtotalMinorUnits: readMinorUnits(o.subtotal),",
    replace: "subtotalMinorUnits: toMinorUnits(o.subtotal),",
    selfTest: true,
  },
  {
    name: "total is scaled again ($48.03 -> $4,803.00)",
    file: DETAIL_CORE,
    find: "totalMinorUnits: readMinorUnits(o.total),",
    replace: "totalMinorUnits: toMinorUnits(o.total),",
    selfTest: true,
  },
  {
    name: "the taxes array is read as a scalar again (em dash on every order)",
    file: DETAIL_CORE,
    find: "taxesMinorUnits: readTaxesMinorUnits(o.taxes),",
    replace: "taxesMinorUnits: toMinorUnits(o.taxes),",
    selfTest: true,
  },
  {
    name: "cart line prices read the ghost keys again",
    file: DETAIL_CORE,
    find: "lineTotalMinorUnits: readMinorUnits(li.discountedPriceCents, li.priceCents) ??",
    replace: "lineTotalMinorUnits: readMinorUnits(li.totalPrice, li.price) ??",
    selfTest: true,
  },

  // ---- the readers themselves ---------------------------------------------
  {
    name: "readMinorUnits silently rounds a fraction instead of refusing it",
    file: DETAIL_CORE,
    find: "if (typeof value === \"number\" && Number.isFinite(value) && Number.isInteger(value)) {",
    replace: "if (typeof value === \"number\" && Number.isFinite(value)) {",
    selfTest: true,
  },
  {
    name: "a missing taxes array reports $0.00 instead of unknown",
    file: DETAIL_CORE,
    find: "  if (!Array.isArray(value)) return null;",
    replace: "  if (!Array.isArray(value)) return 0;",
    selfTest: true,
  },
  {
    name: "one unreadable tax component is skipped, understating the tax",
    file: DETAIL_CORE,
    find: "    if (amount === null) return null;",
    replace: "    if (amount === null) continue;",
    selfTest: true,
  },

  // ---- the hang fix: the deadline classifier ------------------------------
  {
    name: "a fired deadline is no longer recognised by name",
    file: DB_DEADLINE,
    find: "  if (name === \"TimeoutError\" || name === \"AbortError\") return true;",
    replace: "  if (false) return true;",
    tests: ["tests/compliance/leafly-l25-db-deadline.test.ts"],
  },
  {
    name: "isDbDeadlineError always says yes (a real DB fault reads as slow)",
    file: DB_DEADLINE,
    find: "  if (error === null || typeof error !== \"object\") return false;",
    replace: "  if (error === null || typeof error !== \"object\") return true;",
    tests: ["tests/compliance/leafly-l25-db-deadline.test.ts"],
  },

  // ---- the hang fix: the bound itself ------------------------------------
  // This is the root cause of the owner's spinning button. If the wiring test
  // cannot see the bound disappear, it is not protecting anything.
  {
    name: "THE ROOT CAUSE: the credentials read loses its deadline",
    file: CREDS,
    findRegex: /\.abortSignal\(dbDeadline\("credentials_read"\)\)/,
    replaceFirstOnly: "",
    tests: ["tests/compliance/leafly-l25-db-deadline.test.ts"],
  },

  // ---- CONTROL: MUST SURVIVE ---------------------------------------------
  {
    name: "CONTROL — a comment is reworded (harmless, must survive)",
    file: DETAIL_CORE,
    find: "// ---- money, already in minor units (L-25) --------------------------------",
    replace: "// ---- money, already in minor units (L-25) -- control mutant marker -----",
    selfTest: true,
    mustSurvive: true,
  },
];

/* ------------------------------------------------------------------------- *
 * RUNNER
 * ------------------------------------------------------------------------- */

const originals = new Map();
function readOriginal(file) {
  if (!originals.has(file)) originals.set(file, readFileSync(file, "utf8"));
  return originals.get(file);
}

function runSelfTests() {
  const r = spawnSync("npx", ["tsx", "scripts/compliance/run-pure-selftests.ts"], {
    encoding: "utf8",
    timeout: 300_000,
  });
  return r.status === 0;
}

function runVitest(files) {
  const r = spawnSync("npx", ["vitest", "run", ...files], {
    encoding: "utf8",
    timeout: 900_000,
  });
  return r.status === 0;
}

console.log("SLICE L-25 — MUTATION PROBE");
console.log("=".repeat(78));
console.log("A mutant that SURVIVES is a hole in the tests.");
console.log("The CONTROL mutant MUST survive, or this harness is lying.\n");

// A green baseline first. Sabotaging an already-red suite proves nothing,
// because every mutant would "die" for reasons that have nothing to do with
// the mutation.
process.stdout.write("baseline: pure self-tests ... ");
if (!runSelfTests()) {
  console.log("RED — aborting. Fix the baseline before trusting any mutant.");
  process.exit(1);
}
console.log("green");

const results = [];

try {
  for (const m of MUTANTS) {
    const original = readOriginal(m.file);
    let mutated;

    if (m.findRegex) {
      if (!m.findRegex.test(original)) {
        console.log(`\n!! ANCHOR MISSING (regex) in ${m.file}: ${m.name}`);
        results.push({ ...m, outcome: "ANCHOR-MISSING" });
        continue;
      }
      // Replace only the FIRST occurrence, deliberately: removing one of two
      // bounds is the realistic regression (someone edits one call site and
      // not the other) and it proves the test counts bounds rather than just
      // checking that the word appears somewhere in the file.
      mutated = original.replace(m.findRegex, m.replaceFirstOnly);
    } else {
      const hits = original.split(m.find).length - 1;
      if (hits !== 1) {
        // Rule: an anchor must match EXACTLY once, or the mutation is not the
        // one described and the result would be meaningless.
        console.log(`\n!! ANCHOR MATCHED ${hits}x in ${m.file}: ${m.name}`);
        results.push({ ...m, outcome: `ANCHOR-${hits}x` });
        continue;
      }
      mutated = original.replace(m.find, m.replace);
    }

    if (mutated === original) {
      console.log(`\n!! MUTATION WAS A NO-OP: ${m.name}`);
      results.push({ ...m, outcome: "NO-OP" });
      continue;
    }

    process.stdout.write(`\n[${m.mustSurvive ? "CONTROL" : "mutant"}] ${m.name}\n  running ... `);
    writeFileSync(m.file, mutated);

    let passed;
    try {
      passed = m.selfTest ? runSelfTests() : runVitest(m.tests);
    } finally {
      writeFileSync(m.file, original);
    }

    // passed === true  => the suite did NOT notice => the mutant SURVIVED.
    const outcome = passed ? "SURVIVED" : "KILLED";
    const ok = m.mustSurvive ? outcome === "SURVIVED" : outcome === "KILLED";
    console.log(`${outcome}  ${ok ? "(as required)" : "<<< PROBLEM"}`);
    results.push({ ...m, outcome, ok });
  }
} finally {
  // Belt and braces: restore everything, then PROVE it was restored.
  for (const [file, text] of originals) writeFileSync(file, text);
  let clean = true;
  for (const [file, text] of originals) {
    if (readFileSync(file, "utf8") !== text) {
      console.log(`\n!!! FAILED TO RESTORE ${file} — CHECK THE TREE BEFORE COMMITTING`);
      clean = false;
    }
  }
  if (clean) console.log("\nall mutated files restored byte-for-byte");
}

/* ------------------------------------------------------------------------- *
 * VERDICT
 * ------------------------------------------------------------------------- */

console.log("\n" + "=".repeat(78));
const problems = results.filter((r) => !r.ok);
const killed = results.filter((r) => r.outcome === "KILLED").length;
const survived = results.filter((r) => r.outcome === "SURVIVED").length;

console.log(`killed: ${killed}   survived: ${survived}   total: ${results.length}`);

const control = results.find((r) => r.mustSurvive);
if (!control || control.outcome !== "SURVIVED") {
  console.log("\nCONTROL DID NOT SURVIVE — the harness is not trustworthy.");
  process.exit(1);
}
console.log("control survived, so the harness discriminates.");

if (problems.length > 0) {
  console.log("\nGAPS FOUND:");
  for (const p of problems) console.log(`  - ${p.outcome}: ${p.name}`);
  process.exit(1);
}
console.log("\nEvery sabotage was caught, and the harmless change was not.");
