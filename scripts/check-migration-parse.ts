/**
 * scripts/check-migration-parse.ts   (books-35)
 *
 * Parses one migration file and prints the result, so the shell proof can
 * assert on the parser's REFUSAL path as well as its happy path.
 *
 * Exit 0 and a `COLUMNS:` line means the file parsed. Exit 1 and an
 * `UNRECOGNISED COLUMN TYPE` message means the parser refused, which for a
 * file containing an unclassifiable type is the correct outcome.
 */
import { migrationColumnTypesStrict } from "@/lib/payroll/migration-columns";

const path = process.argv[2];
if (!path) {
  console.error("usage: check-migration-parse.ts <path-to-sql>");
  process.exit(2);
}

try {
  const cols = migrationColumnTypesStrict(path);
  const rendered = Object.entries(cols)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(" ");
  console.log(`COLUMNS: ${rendered}`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
