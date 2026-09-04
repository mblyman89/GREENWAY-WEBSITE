/**
 * SLICE 18B — fast self-test runner (used by the mutation harness).
 *
 * Runs ONLY the 18B pure cores so a mutation sweep does not pay for the whole
 * compliance battery on every mutant. The full battery still guards these cores
 * via scripts/compliance/run-pure-selftests.ts — this is a speed tool, not a
 * replacement.
 */
import { __runMenuClassificationFilterTests } from "@/lib/menu/menu-classification-filter-core";
import { __runPosClassificationSearchTests } from "@/lib/pos/classification-search-core";
// 18B EXTENDED the 18A worklist core with `shopLane`, so its self-tests are
// part of this slice's safety net. Mutation run #1 proved the point: the
// "worklist lane is always null" mutant SURVIVED purely because this runner
// omitted the core, so the four shopLane assertions never executed.
import { __runClassificationWorklistTests } from "@/lib/inventory/classification-worklist-core";

let total = 0;

const filter = __runMenuClassificationFilterTests();
if (filter.passed < 1) throw new Error("menu-classification-filter-core reported zero assertions");
console.log(`menu-classification-filter-core: ${filter.passed} assertions passed`);
total += filter.passed;

const search = __runPosClassificationSearchTests();
if (search.passed < 1) throw new Error("classification-search-core reported zero assertions");
console.log(`classification-search-core: ${search.passed} assertions passed`);
total += search.passed;

const worklist = __runClassificationWorklistTests();
if (worklist.passed < 1) throw new Error("classification-worklist-core reported zero assertions");
console.log(`classification-worklist-core: ${worklist.passed} assertions passed`);
total += worklist.passed;

console.log(`SLICE 18B: ${total} assertions passed`);
