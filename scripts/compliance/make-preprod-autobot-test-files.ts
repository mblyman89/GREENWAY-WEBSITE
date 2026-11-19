/**
 * scripts/compliance/make-preprod-autobot-test-files.ts  (D254)
 *
 * Writes the seven-file PREprod practice set (ccrs-autobot-test-core) to a
 * folder, for a hand upload or to read before the hub button makes its own.
 * No database, no network.
 *
 *   npx tsx scripts/compliance/make-preprod-autobot-test-files.ts <outDir> [licenseNumber] [submittedBy]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planOutboxFiles } from "../../src/lib/compliance/ccrs-outbox-core";
import { verifyCcrsBatch } from "../../src/lib/compliance/ccrs-batch-core";
import { AUTOBOT_TEST_EXPECT, buildAutobotTestSources } from "../../src/lib/compliance/ccrs-autobot-test-core";

const out = process.argv[2];
if (!out) {
  console.error("usage: make-preprod-autobot-test-files.ts <outDir> [licenseNumber] [submittedBy]");
  process.exit(2);
}
const licenseNumber = process.argv[3] ?? "413541";
const submittedBy = process.argv[4] ?? "Michael Lyman";
const now = new Date();
const { ids, files } = buildAutobotTestSources({ licenseNumber, submittedBy, now });
const planned = planOutboxFiles(files, { licenseNumber, now, lastStamp: null });
const v = verifyCcrsBatch(planned.map((f) => ({ type: f.type, csv: f.csv })));
if (!v.ok) {
  console.error(JSON.stringify(v.problems, null, 2));
  process.exit(1);
}
mkdirSync(out, { recursive: true });
for (const f of planned) writeFileSync(join(out, f.fileName), f.csv);
console.log(JSON.stringify({ tag: ids.tag, files: planned.map((f) => ({ group: f.group, name: f.fileName, expect: AUTOBOT_TEST_EXPECT[f.type] })) }, null, 2));
