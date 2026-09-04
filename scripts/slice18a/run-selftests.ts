/**
 * SLICE 18A — fast self-test runner.
 *
 * The full pure sweep (scripts/compliance/run-pure-selftests.ts) is the gate CI
 * runs, and it stays the authority. But mutation testing invokes the suite once
 * per mutant, and running the whole repo's self-tests ~19 times is minutes of
 * wall clock for no extra signal. This runs ONLY the two 18A cores.
 *
 * Both cores are also registered in the full sweep, so this file is an
 * accelerator and never a substitute — nothing is tested here that CI doesn't
 * also test.
 */
import { __runClassificationStatusTests } from "@/lib/inventory/classification-status-core";
import { __runClassificationWorklistTests } from "@/lib/inventory/classification-worklist-core";

const status = __runClassificationStatusTests();
if (status.passed < 1) throw new Error("classification-status-core: no assertions ran");

const worklist = __runClassificationWorklistTests();
if (worklist.passed < 1) throw new Error("classification-worklist-core: no assertions ran");

console.log(`classification-status-core:   ${status.passed} assertions passed`);
console.log(`classification-worklist-core: ${worklist.passed} assertions passed`);
