/**
 * scripts/sweep-migration-columns.ts   (books-35)
 *
 * Parses EVERY migration in supabase/migrations and reports any column-shaped
 * line whose type the shared parser cannot classify.
 *
 * This is the control that keeps `KNOWN_SQL_TYPES` honest. The mentor coverage
 * gates only read the two migrations they care about; if a later migration
 * introduces a type nobody listed, those gates would never notice — but the
 * moment that type appears in a table a gate DOES read, the gate silently
 * under-reads. Sweeping everything means the list falls behind loudly, in one
 * place, with the file and column named, instead of quietly and everywhere.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readMigrationColumns } from "@/lib/payroll/migration-columns";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let totalColumns = 0;
let problems = 0;

for (const f of files) {
  const { columns, unrecognised } = readMigrationColumns(join(dir, f));
  totalColumns += Object.keys(columns).length;
  if (unrecognised.length > 0) {
    problems += unrecognised.length;
    console.error(`\n${f}:`);
    for (const u of unrecognised) {
      console.error(`   UNRECOGNISED  ${u.table}.${u.column}  type="${u.rawType}"`);
      console.error(`                 ${u.line}`);
    }
  }
}

console.log(`swept ${files.length} migrations, parsed ${totalColumns} columns`);

if (problems > 0) {
  console.error(
    `\n${problems} column-shaped line(s) could not be classified. Either the line is not a ` +
      `column (in which case the parser needs to learn the shape), or the type is real and ` +
      `belongs in KNOWN_SQL_TYPES in src/lib/payroll/migration-columns.ts.`,
  );
  process.exit(1);
}

console.log("no unrecognised column types");
