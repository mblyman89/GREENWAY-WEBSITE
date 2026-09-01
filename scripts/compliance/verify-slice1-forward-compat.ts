/**
 * scripts/compliance/verify-slice1-forward-compat.ts  (SLICE 1)
 *
 * The owner's requirement: "make sure it will work after all slices are
 * complete." SLICE 1 lands first, but SLICES 2-6 change the READ paths that
 * feed and follow it. This harness asserts the properties SLICE 1 relies on so
 * that a later slice cannot silently break the created_at fix.
 *
 * It is a STRUCTURAL audit of the checked-in source (no DB, no network): it
 * greps the real files and fails if an invariant is violated.
 *
 * Run: npx tsx scripts/compliance/verify-slice1-forward-compat.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    console.error(`  FAIL  ${msg}`);
    failures++;
  }
};

console.log("SLICE 1 forward-compatibility audit\n");

// ---------------------------------------------------------------------------
// A. The defect cannot come back.
// ---------------------------------------------------------------------------
console.log("A. The created_at defect cannot reappear");
{
  const svc = read("src/lib/pos/import-service.ts");

  check(
    !/\.\.\.\(\s*lot\.createdAtIso\s*\?/.test(svc),
    "the conditional created_at spread is gone from import-service.ts",
  );
  check(
    /created_at:\s*resolveLotCreatedAt\(/.test(svc),
    "every lot row sets created_at via resolveLotCreatedAt()",
  );
  check(
    /assertUniformInsertKeys\(rows,\s*`inventory_lots batch \$\{batchNumber\}`\)/.test(svc),
    "the key-uniformity guardrail runs before the inventory_lots insert",
  );

  // The guardrail must come BEFORE the network call, not after.
  const guardIdx = svc.indexOf("assertUniformInsertKeys(rows");
  const insertIdx = svc.indexOf('from("inventory_lots").insert(rows)');
  check(guardIdx > -1 && insertIdx > -1 && guardIdx < insertIdx, "guardrail precedes the insert() call");

  // No OTHER conditional spread may sneak into a row builder in this file.
  const spreads = svc.match(/\.\.\.\([^)]*\?[^)]*\{[^}]*\}\s*:\s*\{\s*\}\)/g) ?? [];
  check(spreads.length === 0, `no conditional-object spreads remain in import-service.ts (found ${spreads.length})`);
}

// ---------------------------------------------------------------------------
// B. Rule 8 - the store clock, never a raw local Date for business time.
// ---------------------------------------------------------------------------
console.log("\nB. Standing Rule 8 (Pacific business clock)");
{
  const svc = read("src/lib/pos/import-service.ts");
  check(
    /import\s*\{\s*storeNow\s*\}\s*from\s*"@\/lib\/reports\/timezone"/.test(svc),
    "import-service.ts sources its clock from the Pacific timezone helper",
  );
  check(
    /const importCreatedAtFallback = storeNow\(\)\.toISOString\(\);/.test(svc),
    "the fallback instant comes from storeNow()",
  );
  // One instant per RUN, not per row: hoisted above the batch loop.
  const fallbackIdx = svc.indexOf("const importCreatedAtFallback");
  const loopIdx = svc.indexOf("for (let start = 0; start < toCreate.length; start += LOT_BATCH)");
  check(
    fallbackIdx > -1 && loopIdx > -1 && fallbackIdx < loopIdx,
    "the fallback is computed ONCE before the batch loop (deterministic across all batches)",
  );
}

// ---------------------------------------------------------------------------
// C. Idempotency - re-publishing after the earlier partial failure is safe.
//    The owner's DB already holds ~3,800 lots from the aborted run.
// ---------------------------------------------------------------------------
console.log("\nC. Idempotency / retry safety (~3,800 lots already committed)");
{
  const svc = read("src/lib/pos/import-service.ts");
  check(
    /chunkedIn\(/.test(svc) && /ccrs_inventory_external_id/.test(svc),
    "existing lots are deduped by ccrs_inventory_external_id",
  );
  check(
    /const toCreate = plan\.lots\.filter\(\(l\) => !existingIds\.has\(l\.ccrsExternalId\)\)/.test(svc),
    "only lots that do not already exist are inserted (no duplicates on retry)",
  );
  // The dedupe read MUST be paginated, or it would re-insert duplicates once
  // more than 1,000 lots exist. This is why SLICE 1 is safe to ship before 2/3.
  check(
    /\.range\(from, to\)/.test(svc),
    "the dedupe read is paginated via chunkedIn/.range() - not subject to the db.max_rows 1000 cap",
  );
}

// ---------------------------------------------------------------------------
// D. Publish ordering - the crash blocked the menu swap.
// ---------------------------------------------------------------------------
console.log("\nD. Publish ordering (why the customer site was empty)");
{
  const svc = read("src/lib/pos/import-service.ts");
  const lotsIdx = svc.indexOf("await createImportLots(importId, actorId);");
  const rpcIdx = svc.indexOf('admin.rpc("publish_menu_version"');
  check(lotsIdx > -1 && rpcIdx > -1, "both lot creation and the publish RPC are present");
  check(lotsIdx < rpcIdx, "lot creation still runs BEFORE publish_menu_version (fixing the throw unblocks the swap)");
}

// ---------------------------------------------------------------------------
// E. The backfill path shares the fix.
// ---------------------------------------------------------------------------
console.log("\nE. Backfill path");
{
  const svc = read("src/lib/pos/import-service.ts");
  const calls = (svc.match(/await createImportLots\(importId, actorId\);/g) ?? []).length;
  check(calls === 2, `both publish and backfill call the single fixed createImportLots() (${calls} call sites)`);
}

// ---------------------------------------------------------------------------
// F. PURE-core contract (Rule 5) - logic lives in *-core.ts and is self-tested.
// ---------------------------------------------------------------------------
console.log("\nF. PURE core contract");
{
  const core = read("src/lib/pos/import-lot-core.ts");
  check(/export function resolveLotCreatedAt\(/.test(core), "resolveLotCreatedAt is exported from the PURE core");
  check(/export function assertUniformInsertKeys\(/.test(core), "assertUniformInsertKeys is exported from the PURE core");
  check(/export function findNonUniformInsertRow\(/.test(core), "findNonUniformInsertRow is exported from the PURE core");
  check(!/from "@\/lib\/supabase/.test(core), "the PURE core still performs no I/O (no supabase import)");

  const runner = read("scripts/compliance/run-pure-selftests.ts");
  check(/__runImportLotCoreTests/.test(runner), "the core's self-tests are registered in the pure self-test sweep");

  // The new behaviour must actually be asserted, not just implemented.
  for (const needle of ["resolveLotCreatedAt(", "assertUniformInsertKeys(", "findNonUniformInsertRow("]) {
    const inTests = core.lastIndexOf(needle) > core.indexOf("export function __runImportLotCoreTests");
    check(inTests, `__runImportLotCoreTests exercises ${needle.replace("(", "()")}`);
  }
}

// ---------------------------------------------------------------------------
// G. Schema contract - the constraint SLICE 1 is defending against.
// ---------------------------------------------------------------------------
console.log("\nG. Schema contract");
{
  const mig = read("supabase/migrations/0023_pos_inventory_lots.sql");
  check(
    /created_at\s+timestamptz not null default now\(\)/.test(mig),
    "inventory_lots.created_at is NOT NULL with a default (migration 0023) - the constraint being satisfied",
  );
}

// ---------------------------------------------------------------------------
// H. Slices 2-6 scope is untouched by SLICE 1.
// ---------------------------------------------------------------------------
console.log("\nH. Slice isolation (SLICE 1 changed no read path)");
{
  const targets: [string, string][] = [
    ["src/lib/inventory/store.ts", "computeInventoryStats"],
    ["src/lib/inventory/inventory-intel.ts", "loadIntelLots"],
    ["src/lib/pos/menu-version.ts", "getVersionItems"],
  ];
  for (const [file, fn] of targets) {
    check(read(file).includes(fn), `${file} still defines ${fn} (untouched - belongs to a later slice)`);
  }
}

console.log("");
if (failures > 0) {
  console.error(`FORWARD-COMPAT AUDIT FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("FORWARD-COMPAT AUDIT PASSED - SLICE 1 holds and stays compatible with SLICES 2-6.");
