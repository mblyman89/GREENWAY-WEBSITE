/**
 * scripts/platform/build-db-contract.ts  (G-71a, owner message 12)
 *
 * Owner (verbatim): "Update the standing rules so we don't rely on the database
 * to do things for us and we are more deliberate about how we communicate with
 * the database."
 *
 * Writes src/lib/platform/db-contract.generated.json: the exact list of public
 * tables/views (`.from("x")`) and functions (`.rpc("x")`) the server code
 * talks to. That list is THE DATABASE CONTRACT:
 *   - CI (tests/compliance/g71a-db-contract.test.ts) fails when the code
 *     names a table or function the file does not list (run this script), or
 *     when a contract entry is not created by any migration;
 *   - the daily platform-health cron asks production whether the server role
 *     can still reach every entry (platform_db_contract_check, 0331).
 *
 * Usage:  npx tsx scripts/platform/build-db-contract.ts         (write)
 *         npx tsx scripts/platform/build-db-contract.ts --check (exit 1 if stale)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectDbContract, renderDbContract } from "../../src/lib/platform/db-contract-scan";

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "src/lib/platform/db-contract.generated.json");

const contract = collectDbContract(ROOT);
const text = renderDbContract(contract);
if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== text) {
    console.error("db-contract.generated.json is stale: run `npx tsx scripts/platform/build-db-contract.ts`.");
    process.exit(1);
  }
  console.log(`db contract up to date: ${contract.tables.length} tables/views, ${contract.functions.length} functions.`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${contract.tables.length} tables/views, ${contract.functions.length} functions.`);
}
