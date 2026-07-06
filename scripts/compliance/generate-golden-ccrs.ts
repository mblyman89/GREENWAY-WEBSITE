/**
 * scripts/compliance/generate-golden-ccrs.ts  (S-14)
 *
 * Emits the golden CCRS files for the compliance test harness from the shared
 * fixture. Run ONLY when the fixture or the CCRS spec encoding intentionally
 * changes, then hand-verify the diff before committing:
 *
 *   npx tsx scripts/compliance/generate-golden-ccrs.ts
 *
 * The tests (tests/compliance/ccrs-batch.test.ts) re-assemble the same fixture
 * and byte-compare against these files, so ANY drift in column order, header
 * shape, quoting, CRLF endings, or date formatting fails CI.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleCcrsFile,
  CCRS_UPLOAD_ORDER,
} from "../../src/lib/compliance/ccrs-batch-core";
import {
  FIXTURE_ROWS,
  FIXTURE_SUBMITTED_AT,
  FIXTURE_SUBMITTED_BY,
} from "../../tests/compliance/fixtures/ccrs-fixture";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "tests", "compliance", "golden", "ccrs");
mkdirSync(outDir, { recursive: true });

for (const type of CCRS_UPLOAD_ORDER) {
  const csv = assembleCcrsFile({
    type,
    submittedBy: FIXTURE_SUBMITTED_BY,
    submittedDate: FIXTURE_SUBMITTED_AT,
    rows: FIXTURE_ROWS[type],
  });
  const file = join(outDir, `${type}.golden.csv`);
  writeFileSync(file, csv, "utf8");
  console.log(`wrote ${file} (${FIXTURE_ROWS[type].length} data row(s))`);
}
console.log("golden CCRS files regenerated — hand-verify the git diff before committing.");
