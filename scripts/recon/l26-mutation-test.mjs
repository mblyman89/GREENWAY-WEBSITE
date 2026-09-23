/**
 * SLICE L-26 — MUTATION TESTING ("test the tests").
 *
 * A green suite proves nothing on its own. It proves something only if each
 * test can actually FAIL when the thing it guards is broken. This slice is
 * the fourth attempt at one bug, and two of the previous three shipped with
 * green suites, so the suite itself is now under suspicion.
 *
 * Method: apply one surgical mutation to production source, run the tests,
 * and require that they go RED. Then restore the file byte-for-byte and
 * confirm the restore by hash. A mutation that leaves the suite GREEN is a
 * hole in the tests and is reported as SURVIVED.
 *
 * Every mutation below is a realistic regression — something a future
 * maintainer could plausibly do — not a random character swap.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const TEST_FILES = [
  "tests/compliance/leafly-l26-render-deadline.test.ts",
];

const hash = (s) => createHash("sha256").update(s).digest("hex");

const MUTATIONS = [
  {
    name: "M1 — remove the db floor from the admin (service-role) client",
    why: "The single line that bounds ~300 service-role queries.",
    file: "src/lib/supabase/admin.ts",
    apply: (s) => s.replace(/\n\s*db:\s*SUPABASE_DB_OPTIONS,/, ""),
  },
  {
    name: "M2 — remove the db floor from the cookie-bound server client",
    why: "Session resolution runs before every render AND every action.",
    file: "src/lib/supabase/server.ts",
    apply: (s) => s.replace(/\n\s*db:\s*SUPABASE_DB_OPTIONS,/, ""),
  },
  {
    name: "M3 — make the render budget infinite",
    why: "The exact bug: a reader that never settles hangs the render.",
    file: "src/lib/supabase/render-budget.ts",
    apply: (s) =>
      s.replace(
        /export const RENDER_READER_BUDGET_MS = [\d_]+;/,
        "export const RENDER_READER_BUDGET_MS = Number.POSITIVE_INFINITY;",
      ),
  },
  {
    name: "M4 — withRenderBudget stops guarding and just awaits",
    why: "The most likely 'simplification' a future maintainer would make.",
    file: "src/lib/supabase/render-budget.ts",
    apply: (s) =>
      s.replace(
        /const guard = new Promise<typeof TIMED_OUT>\(\(resolve\) => \{\s*timer = setTimeout\(\(\) => resolve\(TIMED_OUT\), budgetMs\);\s*\}\);/,
        "const guard = new Promise<typeof TIMED_OUT>(() => {});",
      ),
  },
  {
    name: "M5 — drop the label from the timeout log",
    why: "A degraded panel nobody can find in the logs is a silent failure.",
    file: "src/lib/supabase/render-budget.ts",
    apply: (s) => s.replace(/\$\{label\}/g, "a reader"),
  },
  {
    name: "M6 — unwrap the announcer reader on the orders page",
    why: "The slowest secondary reader; unwrapping restores the hang.",
    file: "src/app/admin/orders/page.tsx",
    apply: (s) =>
      s.replace(
        /withRenderBudget\(\s*\n?\s*getAnnouncerPanelDataCached\(\)/,
        "(getAnnouncerPanelDataCached()",
      ),
  },
  {
    name: "M7 — announcer fallback claims the shop has no speakers",
    why: "Would tell the owner to buy hardware they already own.",
    file: "src/lib/announcer/announcer-admin-store.ts",
    apply: (s) =>
      s.replace(
        /headline: "Could not check the speakers in time\.",/,
        'headline: "No speakers are set up yet.",',
      ),
  },
  {
    name: "M8 — announcer fallback claims the migration was never run",
    why: "Accuses the owner of a setup fault we never actually observed.",
    file: "src/lib/announcer/announcer-admin-store.ts",
    apply: (s) => s.replace(/notInstalled: false,/, "notInstalled: true,"),
  },
  {
    name: "M9 — reintroduce AbortSignal.any (the GC-broken API)",
    why: "Measured to stop firing after a GC cycle; nodejs/node#57736.",
    file: "src/lib/supabase/db-floor.ts",
    apply: (s) =>
      s +
      "\nexport function composeSignals(a: AbortSignal, b: AbortSignal) {\n" +
      "  return AbortSignal.any([a, b]);\n}\n",
  },
  {
    name: "M10 — hard-code the floor instead of sharing the constant",
    why: "Invites silent drift between the two client factories.",
    file: "src/lib/supabase/admin.ts",
    apply: (s) => s.replace(/db:\s*SUPABASE_DB_OPTIONS,/, "db: { timeout: 15000 },"),
  },
  {
    name: "M11 — wrap a PRIMARY reader, faking an empty orders board",
    why: "An empty board is not degraded, it is a lie: orders would hide.",
    file: "src/app/admin/orders/page.tsx",
    apply: (s) =>
      s.replace(
        /\n(\s*)listOrdersPaged\(\{ \.\.\.queryFilter, from: firstWin\.from, to: firstWin\.to \}\),/,
        "\n$1withRenderBudget(listOrdersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }), { rows: [], total: 0 } as never, \"orders\"),",
      ),
  },
  {
    name: "M12 — Leafly setup fallback silently discards the problem text",
    why: "An empty problem renders as a clean bill of health.",
    file: "src/lib/leafly/order-readiness-server.ts",
    // Shadow the parameter with an empty string at the top of the body, so
    // every downstream use of `problem` silently becomes "".
    apply: (s) =>
      s.replace(
        /(export function emptyLeaflyOrderSetupState\(problem: string\)\s*:\s*LeaflyOrderSetupState\s*\{)/,
        "$1\n  problem = \"\";",
      ),
  },
];

function runTests() {
  try {
    execFileSync("npx", ["vitest", "run", ...TEST_FILES], {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 180_000,
    });
    return { green: true };
  } catch (e) {
    return { green: false, out: String(e.stdout || "") };
  }
}

console.log("=== L-26 MUTATION TESTING ===\n");

// Sanity: the suite must be GREEN before we mutate anything, or every
// "caught" result below would be meaningless.
const baseline = runTests();
if (!baseline.green) {
  console.log("BASELINE IS RED — aborting. Fix the suite before mutating.");
  process.exit(1);
}
console.log("baseline: GREEN\n");

let caught = 0;
let survived = 0;
const survivors = [];

for (const m of MUTATIONS) {
  const original = readFileSync(m.file, "utf8");
  const before = hash(original);
  const mutated = m.apply(original);

  if (mutated === original) {
    console.log(`${m.name}\n   NOT APPLIED (pattern did not match) — inconclusive\n`);
    survivors.push(`${m.name} (pattern did not match)`);
    survived++;
    continue;
  }

  writeFileSync(m.file, mutated);
  let result;
  try {
    result = runTests();
  } finally {
    writeFileSync(m.file, original);
    if (hash(readFileSync(m.file, "utf8")) !== before) {
      console.log("!! RESTORE FAILED for " + m.file);
      process.exit(2);
    }
  }

  if (result.green) {
    survived++;
    survivors.push(m.name);
    console.log(`${m.name}\n   SURVIVED  <-- the tests did NOT catch this\n   why it matters: ${m.why}\n`);
  } else {
    caught++;
    console.log(`${m.name}\n   caught\n`);
  }
}

console.log("=== RESULT ===");
console.log(`caught:   ${caught}/${MUTATIONS.length}`);
console.log(`survived: ${survived}/${MUTATIONS.length}`);
if (survivors.length) {
  console.log("\nSURVIVORS (holes in the suite):");
  for (const s of survivors) console.log("  - " + s);
}
process.exit(survived === 0 ? 0 : 1);
