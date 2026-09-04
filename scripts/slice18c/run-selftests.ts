/**
 * SLICE 18C — fast self-test runner (used by the mutation harness).
 *
 * Runs ONLY the cores 18C touches so a mutation sweep does not pay for the
 * whole compliance battery on every mutant. The full battery still guards
 * these via scripts/compliance/run-pure-selftests.ts — this is a speed tool,
 * not a replacement.
 *
 * The FILTER core is included deliberately: 18C's badge delegates to it, so a
 * mutant that breaks qualification must be caught here too. (18B's mutation
 * round #1 proved the cost of omitting a core a slice depends on — a real
 * defect survived purely because its assertions never executed.)
 */
import { __runMenuClassificationBadgeTests } from "@/lib/menu/menu-classification-badge-core";
import { __runMenuClassificationFilterTests } from "@/lib/menu/menu-classification-filter-core";
import { __runMenuDohBadgeCoreTests } from "@/lib/menu/menu-doh-badge-core";

let total = 0;

const badge = __runMenuClassificationBadgeTests();
if (badge.passed < 1) throw new Error("menu-classification-badge-core reported zero assertions");
console.log(`menu-classification-badge-core: ${badge.passed} assertions passed`);
total += badge.passed;

const filter = __runMenuClassificationFilterTests();
if (filter.passed < 1) throw new Error("menu-classification-filter-core reported zero assertions");
console.log(`menu-classification-filter-core: ${filter.passed} assertions passed`);
total += filter.passed;

// 18C renders the DOH pill on the PDP for the first time, so its core is in
// scope for this slice's safety net.
const doh = __runMenuDohBadgeCoreTests();
if (doh.passed < 1) throw new Error("menu-doh-badge-core reported zero assertions");
console.log(`menu-doh-badge-core: ${doh.passed} assertions passed`);
total += doh.passed;

console.log(`SLICE 18C: ${total} assertions passed`);
