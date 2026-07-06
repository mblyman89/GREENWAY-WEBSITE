/** Run the PURE payroll self-tests (no DB).
 * Usage: npx tsx scripts/discovery/test_payroll_pure.ts */
import { __runPayrollCoreTests } from "../../src/lib/payroll/payroll-core";
import { __runPayrollGuardrailsCoreTests } from "../../src/lib/payroll/payroll-guardrails-core";
import { __runNachaCoreTests } from "../../src/lib/payments/nacha-core";

const results = [
  __runPayrollCoreTests(),
  __runPayrollGuardrailsCoreTests(),
  __runNachaCoreTests(),
];

const failed = results.reduce((s, r) => s + r.failed, 0);
if (failed > 0) {
  console.error(`\n${failed} payroll test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll payroll pure tests passed.");
