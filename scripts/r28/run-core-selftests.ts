/**
 * scripts/r28/run-core-selftests.ts
 *
 * R28 - runs only the R28 pure cores on the real certificate fixtures and
 * exits 1 when any reports a failure. Used by scripts/r28/mutate_ts_core.py
 * (fast loop); the full gate is scripts/compliance/run-pure-selftests.ts.
 *
 *   npx tsx scripts/r28/run-core-selftests.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { __runCoaExtractCoreTests } from "../../src/lib/inventory/coa-extract-core";
import { __runCoaPanelCoreTests } from "../../src/lib/inventory/coa-panel-core";
import { r28MakeExtract } from "./coa-fixture-extract";

const dir = join(__dirname, "..", "..", "tests", "fixtures", "coa");
const fx: Record<string, string> = {};
for (const f of readdirSync(dir)) {
  const m = f.match(/^(item\d\d\.(?:unpdf|layout|wcia)|transfer)\.(?:txt|json)$/);
  if (m) fx[m[1]] = readFileSync(join(dir, f), "utf8");
}
if (Object.keys(fx).length < 52) throw new Error(`expected 52 fixtures, found ${Object.keys(fx).length}`);

let bad = 0;
const results: [string, { passed: number; failed: number }][] = [];
try {
  results.push(["coa-extract-core", __runCoaExtractCoreTests(fx)]);
  results.push(["coa-panel-core", __runCoaPanelCoreTests(fx, r28MakeExtract(fx))]);
} catch (e) {
  console.error("threw:", e instanceof Error ? e.message : e);
  process.exit(1);
}
for (const [name, r] of results) {
  console.log(`${name}: ${r.passed} passed, ${r.failed} failed`);
  if (r.failed > 0 || r.passed === 0) bad += 1;
}
process.exit(bad > 0 ? 1 : 0);
