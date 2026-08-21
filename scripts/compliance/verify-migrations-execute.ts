/**
 * scripts/compliance/verify-migrations-execute.ts
 *
 * THE MIGRATION THAT PARSES IS NOT THE MIGRATION THAT RUNS.
 *
 * Every migration in this repo is covered by text-reading "drift alarm" tests:
 * they prove the file still SAYS what the design depends on. 0195 alone has 545
 * lines of them. What none of them could prove is that the file RUNS -- because
 * reading SQL as text is not executing SQL.
 *
 * That gap became real when Michael tried to apply 0195 and got:
 *
 *     Failed to run sql query: ERROR: 42P01: relation "a" does not exist
 *
 * Every text test was green. The file was, in fact, fine -- proven by applying
 * all 195 migrations in order to a real PostgreSQL 15 instance, where 0195
 * applied cleanly, re-applied cleanly, and returned an empty audit. The error
 * came from the SQL being MANGLED IN TRANSIT between the file and the database,
 * not from the file. But nothing in the repo could have told us that, because
 * nothing in the repo had ever executed a migration.
 *
 * This script closes that gap. It is not a linter and it does not read the SQL
 * as prose. It builds a throwaway PostgreSQL database, applies every migration
 * in order, and reports the first one that fails. Then it applies the LAST
 * migration a second time, because a migration Michael has to re-run is a
 * migration that must be idempotent (he applies these by hand, and a hand can
 * slip).
 *
 * WHY THIS IS SEPARATE FROM THE VITEST SUITE. It needs a live postgres, which
 * the test sandbox does not always have. So it degrades honestly: if it cannot
 * find a server it says so and exits 0 with a SKIPPED banner, rather than
 * failing the build for an absent dependency or -- far worse -- passing
 * silently and letting someone believe the migrations were executed when they
 * were not. Standing rule 48: a check that cannot classify its input must say
 * so, never quietly skip. The banner IS the saying-so.
 *
 * Usage:
 *   PGURL='postgres://postgres@/postgres?host=/tmp/pgsock&port=5433' \
 *     npx tsx scripts/compliance/verify-migrations-execute.ts
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

/** Exit codes, so CI can tell "broken" from "not run". */
const EXIT_OK = 0;
const EXIT_FAILED = 1;

interface Failure {
  file: string;
  message: string;
}

/**
 * Read the migration list the same way the database will see it: sorted by
 * filename, which is the numeric order because every file is zero-padded.
 */
export function migrationFilesInOrder(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * The single most valuable thing this file knows.
 *
 * Postgres reports `relation "x" does not exist` when a bare word lands in a
 * table position. When that word is a common English article -- "a" above all
 * -- the overwhelmingly likely cause is not a missing table but PROSE that has
 * been fed to the parser: a comment whose `--` marker was lost somewhere
 * between the file and the server.
 *
 * So when we see that specific shape, we do not just repeat Postgres's message
 * (which sends the reader hunting for a table named "a" that never existed).
 * We name the real cause and say where to look.
 */
export function explainRelationError(message: string): string | null {
  const m = /relation "([^"]+)" does not exist/i.exec(message);
  if (!m) return null;
  const rel = m[1];
  const ENGLISH_WORDS = new Set([
    "a",
    "an",
    "the",
    "it",
    "is",
    "this",
    "that",
    "and",
    "or",
    "not",
    "no",
    "of",
    "to",
    "in",
    "on",
    "so",
  ]);
  if (!ENGLISH_WORDS.has(rel.toLowerCase())) return null;
  return (
    `The database was asked for a table named "${rel}". That is an ordinary ` +
    `English word, not a table anyone would create, which means the server was ` +
    `almost certainly sent PROSE instead of SQL -- a comment line whose "--" ` +
    `marker went missing between the file and the database. The migration file ` +
    `itself is probably fine. Suspect the transport: a partial copy/paste, an ` +
    `editor that reflowed a long comment, or a client that strips comments ` +
    `without understanding dollar-quoted bodies. Re-send the WHOLE file.`
  );
}

/** Run one SQL file. Returns null on success, or the first ERROR line. */
function applyFile(pgurl: string, file: string): string | null {
  try {
    execFileSync(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "-q", "-X", "-f", path.join(MIGRATIONS_DIR, file), pgurl],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    return null;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const text = e.stderr ?? e.message ?? String(err);
    const line = text
      .split("\n")
      .find((l) => /ERROR:/i.test(l));
    return (line ?? text).trim();
  }
}

function main(): void {
  const pgurl = process.env.PGURL ?? "";
  const files = migrationFilesInOrder();

  if (!pgurl) {
    // Rule 48: say so loudly rather than pretending to have checked.
    console.log(
      [
        "",
        "  MIGRATION EXECUTION CHECK: SKIPPED (no PGURL set).",
        "",
        `  ${files.length} migrations were NOT executed. This is not a pass.`,
        "  To actually run them, start a postgres and set PGURL, e.g.",
        "",
        "    PGURL='postgres://postgres@/postgres?host=/tmp/pgsock&port=5433' \\",
        "      npx tsx scripts/compliance/verify-migrations-execute.ts",
        "",
      ].join("\n"),
    );
    process.exit(EXIT_OK);
  }

  console.log(`Applying ${files.length} migrations in order...`);
  const failures: Failure[] = [];

  for (const f of files) {
    const err = applyFile(pgurl, f);
    if (err) {
      failures.push({ file: f, message: err });
      break; // the first failure is the only honest one; the rest cascade
    }
  }

  if (failures.length === 0) {
    // A migration Michael re-runs by hand must survive being re-run.
    const last = files[files.length - 1];
    const again = applyFile(pgurl, last);
    if (again) {
      failures.push({ file: `${last} (SECOND run - idempotency)`, message: again });
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`\n  FAILED: ${f.file}\n    ${f.message}`);
      const hint = explainRelationError(f.message);
      if (hint) console.error(`\n    WHAT THIS PROBABLY MEANS:\n    ${hint}`);
    }
    console.error("\nMIGRATION EXECUTION CHECK FAILED.\n");
    process.exit(EXIT_FAILED);
  }

  console.log(
    `\n  All ${files.length} migrations applied in order, and ` +
      `${files[files.length - 1]} re-applied cleanly (idempotent).`,
  );
  console.log("MIGRATION EXECUTION CHECK PASSED.\n");
  process.exit(EXIT_OK);
}

/**
 * Self-test hook. Importing this file must not run migrations, so main() is
 * only called when this is the entry point.
 */
if (require.main === module) {
  main();
}

/** Exported for the compliance tests, which must be able to prove this logic. */
export const __internals = { readFileSync, MIGRATIONS_DIR };
