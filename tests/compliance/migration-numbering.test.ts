/**
 * tests/compliance/migration-numbering.test.ts
 *
 * MIGRATION NUMBERING IS A SAFETY PROPERTY, NOT HOUSEKEEPING.
 *
 * Migrations are applied MANUALLY by the owner in the Supabase SQL editor
 * (standing rule 6), in numeric order, by reading the file names. That makes the
 * file name the only thing carrying run order — there is no tool checking it.
 *
 * Two files sharing a number is therefore a real hazard rather than an untidy
 * one: the owner sees "0179" twice, runs one of them, ticks it off, and moves
 * on. If the skipped one created a function the later migration depends on, the
 * later one fails — or worse, succeeds against a stale definition.
 *
 * This exact collision happened: slice books-01 shipped `0179_books_owner_only`
 * while `0179_discovery_competitor_kind` already existed. The books files were
 * renumbered to 0185/0186 and this test exists so it cannot recur silently.
 *
 * It also enforces the naming convention and — the part that actually matters —
 * that no migration references a LATER migration's number in a way that implies
 * a backwards dependency.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("supabase migration numbering", () => {
  it("has at least one migration (the test is pointed at the right directory)", () => {
    expect(migrationFiles().length).toBeGreaterThan(100);
  });

  it("every migration is named NNNN_snake_case.sql", () => {
    const bad = migrationFiles().filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad, `badly named migrations: ${bad.join(", ")}`).toEqual([]);
  });

  it("NO TWO MIGRATIONS SHARE A NUMBER", () => {
    // The one that actually bit us. The owner runs these by hand, in order, by
    // reading the file names; a duplicate number means one of them gets skipped.
    const byNumber = new Map<string, string[]>();
    for (const f of migrationFiles()) {
      const n = f.slice(0, 4);
      byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
    }
    const collisions = [...byNumber.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([n, files]) => `${n}: ${files.join(" AND ")}`);

    expect(
      collisions,
      `duplicate migration numbers — the owner applies these manually in numeric ` +
        `order, so a duplicate means one gets skipped:\n${collisions.join("\n")}`,
    ).toEqual([]);
  });

  it("the books migrations sit at their renumbered homes", () => {
    const files = migrationFiles();
    expect(files).toContain("0185_books_owner_only.sql");
    expect(files).toContain("0186_cutover_config.sql");
    // and the old colliding names are gone
    expect(files).not.toContain("0179_books_owner_only.sql");
    expect(files).not.toContain("0184_cutover_config.sql");
    // while the migration they collided with is untouched
    expect(files).toContain("0179_discovery_competitor_kind.sql");
  });

  it("0186 runs AFTER 0185, because it depends on is_owner()", () => {
    // A dependency that is only expressed by file name is a dependency worth
    // asserting. 0186's RLS policies call is_owner(), which 0185 creates.
    const cutover = readFileSync(
      resolve(MIGRATIONS_DIR, "0186_cutover_config.sql"),
      "utf8",
    );
    const ownerOnly = readFileSync(
      resolve(MIGRATIONS_DIR, "0185_books_owner_only.sql"),
      "utf8",
    );
    expect(cutover).toContain("public.is_owner()");
    expect(ownerOnly).toContain("create or replace function public.is_owner()");
    expect("0186_cutover_config.sql" > "0185_books_owner_only.sql").toBe(true);
  });

  it("each books migration announces itself with its own number", () => {
    // A header that still says "0179" inside 0185_*.sql is exactly the kind of
    // stale breadcrumb that sends someone to the wrong file at 11pm.
    for (const [file, expected] of [
      ["0185_books_owner_only.sql", "0185"],
      ["0186_cutover_config.sql", "0186"],
    ] as const) {
      const head = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8")
        .split("\n")
        .slice(0, 5)
        .join("\n");
      expect(head, `${file} header`).toContain(expected);
    }
  });

  it("no books migration still refers to its pre-renumber identity", () => {
    for (const file of ["0185_books_owner_only.sql", "0186_cutover_config.sql"]) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      expect(sql, `${file} mentions 0179`).not.toMatch(/\b0179\b/);
      expect(sql, `${file} mentions 0184`).not.toMatch(/\b0184\b/);
    }
  });

  it("every migration is idempotent-shaped (standing rule 6)", () => {
    // Not a proof — you cannot prove idempotence by grepping. It is a smoke
    // alarm for the most common way a migration stops being re-runnable: a bare
    // CREATE TABLE / CREATE INDEX with no guard. The owner is told every
    // migration is safe to paste twice, so that promise deserves a tripwire.
    const offenders: string[] = [];
    for (const f of migrationFiles()) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, f), "utf8");
      const stripped = sql
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // `create table x` without `if not exists`
      if (/\bcreate\s+table\s+(?!if\s+not\s+exists)/i.test(stripped)) {
        offenders.push(`${f}: create table without "if not exists"`);
      }
      // `create index x` without `if not exists` (concurrently is allowed between)
      if (
        /\bcreate\s+(unique\s+)?index\s+(concurrently\s+)?(?!if\s+not\s+exists)/i.test(
          stripped,
        )
      ) {
        offenders.push(`${f}: create index without "if not exists"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
