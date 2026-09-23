/**
 * scripts/recon/l27-mutation-test.mjs
 *
 * SLICE L-27 — "Test it, test the tests."
 *
 * A green suite proves the tests RAN, not that they would CATCH anything. This
 * script breaks the L-27 fix in twelve realistic ways — each one a mistake a
 * future maintainer could plausibly make — and asserts the compliance suite
 * goes red for every single one.
 *
 * A mutation that SURVIVES is a hole in the tests, not a pass.
 *
 * Run: node scripts/recon/l27-mutation-test.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SUITE = "tests/compliance/leafly-l27-auth-fetch-floor.test.ts";

const MUTATIONS = [
  {
    name: "floor raised above the action budget (ordering destroyed)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "export const AUTH_FETCH_FLOOR_MS = 20_000;",
    to: "export const AUTH_FETCH_FLOOR_MS = 250_000;",
  },
  {
    name: "floor dropped below the per-query deadlines (wrong timer wins)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "export const AUTH_FETCH_FLOOR_MS = 20_000;",
    to: "export const AUTH_FETCH_FLOOR_MS = 3_000;",
  },
  {
    name: "signal never passed to the underlying fetch (silently unbounded)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "return await impl(input, { ...init, signal: controller.signal });",
    to: "return await impl(input, { ...init });",
  },
  {
    name: "timer never cleared (leaks an armed abort per request)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "      clearTimeout(timer);\n      detachCaller?.();",
    to: "      detachCaller?.();",
  },
  {
    name: "caller listener never removed (leaks a listener per request)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "      clearTimeout(timer);\n      detachCaller?.();",
    to: "      clearTimeout(timer);",
  },
  {
    name: "nonsense budget falls through to unbounded",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "        ? floorMs\n        : AUTH_FETCH_FLOOR_MS;",
    to: "        ? floorMs\n        : 0;",
  },
  {
    name: "abort reason loses its budget, making logs undiagnosable",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "`Supabase request exceeded the ${budget}ms transport floor.`",
    to: "`Supabase request aborted.`",
  },
  {
    name: "AbortSignal.any reintroduced (the GC bug returns)",
    file: "src/lib/supabase/fetch-floor.ts",
    from: "      callerSignal.addEventListener(\"abort\", onCallerAbort, { once: true });",
    to: "      const merged = AbortSignal.any([callerSignal, controller.signal]);\n      void merged;",
  },
  {
    name: "floor removed from the cookie-bound client (the acknowledge path)",
    file: "src/lib/supabase/server.ts",
    from: "    global: SUPABASE_GLOBAL_OPTIONS,",
    to: "",
  },
  {
    name: "floor removed from the middleware",
    file: "src/middleware.ts",
    from: "    global: SUPABASE_GLOBAL_OPTIONS,",
    to: "",
  },
  {
    name: "middleware stops catching, so an abort 500s all of /admin",
    file: "src/middleware.ts",
    from: "await supabase.auth.getUser().catch(() => undefined);",
    to: "await supabase.auth.getUser();",
  },
  {
    name: "login page stops explaining, blaming the operator's password",
    file: "src/app/admin/login/page.tsx",
    from: "  const unavailable = authCheckUnavailable();",
    to: "  const unavailable = false;",
  },
];

function suiteFails() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=dot`, {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 180_000,
    });
    return false; // exit 0 → suite passed → mutation SURVIVED
  } catch {
    return true; // non-zero → suite failed → mutation CAUGHT
  }
}

console.log(`\nL-27 mutation sweep — ${MUTATIONS.length} mutations\n`);

let caught = 0;
const survivors = [];

for (const [i, m] of MUTATIONS.entries()) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, "utf8");

  if (!original.includes(m.from)) {
    console.log(
      `${String(i + 1).padStart(2)}. ${m.name}\n    SKIPPED — anchor not found in ${m.file}`,
    );
    survivors.push(`${m.name} (anchor missing — mutation never applied)`);
    continue;
  }

  writeFileSync(path, original.replace(m.from, m.to), "utf8");
  let detected;
  try {
    detected = suiteFails();
  } finally {
    writeFileSync(path, original, "utf8"); // always restore
  }

  if (detected) caught += 1;
  else survivors.push(m.name);

  console.log(
    `${String(i + 1).padStart(2)}. ${detected ? "CAUGHT  " : "SURVIVED"}  ${m.name}`,
  );
}

console.log(
  `\n──────────────────────────────────────────────\ncaught ${caught}/${MUTATIONS.length}, survived ${survivors.length}/${MUTATIONS.length}`,
);
if (survivors.length) {
  console.log("\nSURVIVORS (holes in the tests):");
  for (const s of survivors) console.log(`  - ${s}`);
}
process.exit(survivors.length === 0 ? 0 : 1);
