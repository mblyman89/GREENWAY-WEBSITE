/**
 * scripts/r36/run-labs-selftests.ts
 *
 * R36 #4 - runs only the cores the Cultivera / testing-labs work touched
 * (on the real R28 fixtures) and exits 1 on any failure. Used by
 * scripts/r36/mutate_ts_labs.py (fast loop); the full gate is
 * scripts/compliance/run-pure-selftests.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { __runCoaExtractCoreTests } from "../../src/lib/inventory/coa-extract-core";
import { __runCoaPdfTextCoreTests } from "../../src/lib/inventory/coa-pdf-text-core";
import { __runCoaFactsCoreTests } from "../../src/lib/inventory/coa-facts-core";
import { __runTestingLabsCoreTests } from "../../src/lib/inventory/testing-labs-core";

const dir = join(__dirname, "..", "..", "tests", "fixtures", "coa");
const fx: Record<string, string> = {};
for (const f of readdirSync(dir)) {
  const m = f.match(/^(item\d\d\.(?:unpdf|layout|wcia)|transfer)\.(?:txt|json)$/);
  if (m) fx[m[1]] = readFileSync(join(dir, f), "utf8");
}
if (Object.keys(fx).length < 52) throw new Error(`expected 52 fixtures, found ${Object.keys(fx).length}`);

let bad = 0;
try {
  for (const [name, r] of [
    ["coa-extract-core", __runCoaExtractCoreTests(fx)],
    ["coa-pdf-text-core", __runCoaPdfTextCoreTests(fx)],
    ["coa-facts-core", __runCoaFactsCoreTests(fx)],
    ["testing-labs-core", __runTestingLabsCoreTests()],
  ] as const) {
    console.log(`${name}: ${r.passed} passed, ${r.failed} failed`);
    if (r.failed > 0 || r.passed === 0) bad += 1;
  }
} catch (e) {
  console.error("threw:", e instanceof Error ? e.message : e);
  process.exit(1);
}
process.exit(bad > 0 ? 1 : 0);
