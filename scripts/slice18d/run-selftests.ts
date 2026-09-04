/**
 * SLICE 18D — fast self-test runner.
 *
 * Includes EVERY pure core this slice touches, not just the one it edits most.
 * That is the direct lesson of 18B's first mutation round, where a mutant
 * survived purely because its core was missing from the fast runner and the
 * assertions that would have caught it never executed.
 *
 *   classification-search-core : the register's classification logic (18B+18D)
 *   sale-grid-core             : the chip + filter knob 18D adds
 *   sale-flow-core             : searchProducts, which 18B wired keywords into
 *                                and 18D must leave byte-for-byte unchanged
 */
import { __runPosClassificationSearchTests } from "../../src/lib/pos/classification-search-core";
import { __runSaleGridCoreTests } from "../../src/lib/pos/sale-grid-core";
import { __runSaleFlowCoreTests } from "../../src/lib/pos/sale-flow-core";

let total = 0;

{
  const r = __runPosClassificationSearchTests();
  if (r.passed < 1) throw new Error("classification-search-core: no assertions ran");
  console.log(`classification-search-core: ${r.passed} assertions passed`);
  total += r.passed;
}

// These two log their own counts and throw on failure.
__runSaleGridCoreTests();
__runSaleFlowCoreTests();

console.log(`SLICE 18D: classification-search-core contributed ${total} assertions`);
console.log("SLICE 18D: all touched cores passed");
