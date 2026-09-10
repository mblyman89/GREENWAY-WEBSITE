/**
 * scripts/generate-schema-tables.ts
 *
 * Regenerate src/lib/admin/schema-tables.ts from the migrations on disk.
 *
 * Run after adding a migration that creates a table:
 *     npx tsx scripts/generate-schema-tables.ts
 *
 * The generated file is what the factory-reset screen builds its plan from.
 * `tests/compliance/factory-reset-core.test.ts` fails the build if the snapshot
 * and the migrations disagree, so forgetting to run this is caught in CI rather
 * than discovered by the owner reading a reset screen that is missing a table.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const OUT = join(process.cwd(), "src", "lib", "admin", "schema-tables.ts");

/**
 * Extract every table the migrations create.
 *
 * Comments are stripped first so commented-out DDL is not counted, and the
 * optional `if not exists` clause is named explicitly rather than skipped with
 * a wildcard — a wildcard produces a phantom table called "if".
 *
 * This is deliberately the SAME extraction the test uses. If the two ever
 * differ, the snapshot could satisfy the test while being wrong.
 */
export function tablesFromMigrations(dir: string = MIGRATIONS_DIR): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
  const found = new Set<string>();
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf8");
    const stripped = raw
      .split("\n")
      .map((line) => line.split("--")[0])
      .join("\n");
    for (const m of stripped.matchAll(re)) found.add(m[1].toLowerCase());
  }
  return [...found].sort();
}

function main(): void {
  const tables = tablesFromMigrations();
  const migrationCount = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length;

  const header = `/**
 * src/lib/admin/schema-tables.ts   (GENERATED — see the test that guards it)
 *
 * The list of tables the migrations create, snapshotted so the factory-reset
 * screen can build a real plan at runtime.
 *
 * WHY A SNAPSHOT AND NOT A DIRECTORY READ. The reset screen needs the actual
 * schema, and reading \`supabase/migrations\` at request time works locally and
 * fails on Vercel, where the SQL files are not part of the deployed bundle.
 * Reading it from the database instead would need another RPC and would make a
 * settings page depend on a live query just to draw a list.
 *
 * WHY THIS IS NOT A HAND-TYPED LIST. It is regenerated from the migrations and
 * \`tests/compliance/factory-reset-core.test.ts\` fails the build the moment it
 * disagrees with what is on disk, in either direction. That is the same
 * anti-rot guard that protects the reset rules themselves — a hand-maintained
 * list drifting from reality is D-62, and this file must never become one.
 *
 * To regenerate: npx tsx scripts/generate-schema-tables.ts
 *
 * Measured ${tables.length} tables across ${migrationCount} migrations at the time of writing.
 */

export const SCHEMA_TABLES: readonly string[] = [
${tables.map((t) => `  "${t}",`).join("\n")}
] as const;

/** The tables the migrations create, for \`buildResetPlan\`. */
export function listSchemaTables(): readonly string[] {
  return SCHEMA_TABLES;
}
`;

  writeFileSync(OUT, header, "utf8");
  console.log(`schema-tables.ts regenerated: ${tables.length} tables from ${migrationCount} migrations`);
}

if (process.argv[1] && process.argv[1].endsWith("generate-schema-tables.ts")) main();
