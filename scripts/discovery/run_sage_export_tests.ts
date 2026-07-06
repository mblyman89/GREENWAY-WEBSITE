/** Run the PURE Sage 50 core self-tests (no DB). Usage: npx tsx scripts/discovery/run_sage_export_tests.ts */
import { __runSage50CoreTests } from "../../src/lib/accounting/sage50-core";
import { __runSageHelperCoreTests } from "../../src/lib/accounting/sage-helper-core";
import { __runSageExportsCoreTests } from "../../src/lib/accounting/sage-exports-core";
__runSage50CoreTests();
__runSageHelperCoreTests();
__runSageExportsCoreTests();
