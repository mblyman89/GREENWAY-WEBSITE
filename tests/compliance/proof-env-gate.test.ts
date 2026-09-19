/**
 * tests/compliance/proof-env-gate.test.ts   (Slice A)
 *
 * A PROOF THAT CANNOT TELL AN ENVIRONMENT PROBLEM FROM A MIGRATION DEFECT IS
 * NOT A PROOF.
 *
 * THE INCIDENT THESE TESTS EXIST BECAUSE OF
 * -----------------------------------------
 * After a sandbox restart, `prove-0229-executes.sh` reported:
 *
 *     0229 PROOF: 0 passed, 43 failed
 *
 * Migration 0229 was perfect. The Postgres role named after the invoking user
 * had vanished, and the harness's setup line was `psql -q -c "create database
 * $DB;"` -- no `-d`. psql therefore connected to a database named after the
 * invoking user, which no longer existed, so the CREATE never happened. The
 * proof then ran all 43 checks against a database that was not there and
 * blamed the migration.
 *
 * Five of the six sibling scripts behaved WORSE: 0223 printed `FAILED` for
 * every migration and still exited 0.
 *
 * WHY A TEST, WHEN THE SCRIPTS ARE ALREADY FIXED
 * ----------------------------------------------
 * Because the eighth proof script will be written by copying the seventh.
 * Copying is exactly how this defect spread to six files in the first place.
 * These tests fail the moment a new `prove-NNNN-executes.sh` appears without
 * the gate, which is cheaper than discovering it during the next incident.
 *
 * WHAT THESE TESTS HONESTLY CANNOT DO
 * -----------------------------------
 * They read text. Text cannot prove the gate FIRES. That is proven by
 * genuinely breaking the environment in
 * `scripts/compliance/sabotage-proof-env-gate.sh`, which needs a live
 * PostgreSQL and is therefore run by hand (38 checks, all passing at the time
 * of writing). Pretending a text test proves runtime behaviour would be the
 * original sin in a new costume, so it is stated plainly instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditGate,
  barePsqlLines,
  codeLines,
} from "../../scripts/compliance/audit-proof-env-gate";

const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts/compliance");

function proofScripts(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^prove-\d+-executes\.sh$/.test(f))
    .sort();
}

function readScript(name: string): string {
  return readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
}

// ===========================================================================
describe("the auditor recognises the bug that actually happened", () => {
  // The exact two lines from the pre-fix harnesses, verbatim.
  const ORIGINAL_BUG = [
    "#!/usr/bin/env bash",
    "DB=greenway_migtest_0229",
    'psql -q -c "drop database if exists $DB;" >/dev/null',
    'psql -q -c "create database $DB;" >/dev/null',
    'psql -d "$DB" -tAc "select 1"',
  ].join("\n");

  it("flags BOTH bare psql lines, not just the first", () => {
    const bare = barePsqlLines(ORIGINAL_BUG);
    expect(bare).toHaveLength(2);
    expect(bare[0]).toContain("drop database");
    expect(bare[1]).toContain("create database");
  });

  it("explains the fault in terms of what psql actually does", () => {
    const { problems } = auditGate(ORIGINAL_BUG);
    const bare = problems.filter((p) => p.code === "bare-psql-c");
    expect(bare.length).toBeGreaterThan(0);
    // The message must name the CAUSE, not just say "bad line". The owner
    // applies migrations by hand and needs to know why it broke.
    expect(bare[0].detail).toContain("named after the invoking user");
  });

  it("also notices the missing refusal gate", () => {
    const { problems } = auditGate(ORIGINAL_BUG);
    expect(problems.map((p) => p.code)).toContain("no-refusal-gate");
  });

  it("accepts the fixed form", () => {
    const fixed = [
      "#!/usr/bin/env bash",
      'psql -q -d postgres -c "drop database if exists $DB;" >/dev/null',
      'psql -q -d postgres -c "create database $DB;" >/dev/null',
      'if ! psql -d "$DB" -tAc "select 1" >/dev/null 2>&1; then',
      '  echo "FATAL: could not create or connect to $DB."',
      '  echo "This is an ENVIRONMENT problem, not a migration problem."',
      '  echo "NOTHING about this migration has been proven or disproven."',
      "  exit 2",
      "fi",
      'exit "$FAIL"',
    ].join("\n");
    expect(auditGate(fixed).problems).toEqual([]);
  });
});

// ===========================================================================
describe("the auditor does not cry wolf", () => {
  it("ignores the bug when it appears in a COMMENT", () => {
    // Every fixed script explains the bug in its own header. An auditor that
    // flagged the explanation would be ignored within a week.
    const src = [
      "#!/usr/bin/env bash",
      '# WRONG: psql -q -c "create database $DB;"  <- no -d, this was the bug',
      '#   psql -q -c "drop database if exists $DB;"',
      'psql -q -d postgres -c "create database $DB;"',
      'if ! psql -d "$DB" -tAc "select 1"; then',
      '  echo "ENVIRONMENT problem"',
      '  echo "Nothing about this migration is proven."',
      "  exit 2",
      "fi",
      "exit 0",
    ].join("\n");
    expect(auditGate(src).problems).toEqual([]);
  });

  it("strips full-line comments but keeps code with a trailing comment", () => {
    const lines = codeLines(
      ['# just a comment', '', 'psql -d x -c "select 1"  # inline note'].join(
        "\n",
      ),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("psql -d x");
  });

  it("accepts a connection URI instead of -d", () => {
    const src = [
      'psql postgresql://localhost/postgres -c "create database $DB;"',
      'if ! psql -d "$DB" -tAc "select 1"; then',
      '  echo "ENVIRONMENT"; echo "nothing about it proven"; exit 2',
      "fi",
      "exit 0",
    ].join("\n");
    expect(auditGate(src).problems).toEqual([]);
  });

  it("ignores an interactive psql that carries no SQL", () => {
    // `psql -q` with no -c/-f is not the failure mode; flagging it would be
    // noise, and noise is how a real warning gets missed.
    expect(barePsqlLines("psql -q\n")).toEqual([]);
  });
});

// ===========================================================================
describe("each way the gate can be broken is reported separately", () => {
  const withGate = (body: string) =>
    [
      'psql -q -d postgres -c "create database $DB;"',
      'if ! psql -d "$DB" -tAc "select 1"; then',
      body,
      "fi",
      "exit 0",
    ].join("\n");

  it("catches a gate that exits 1 instead of 2", () => {
    // 1 means "a real failure", i.e. blame the migration. That is the whole
    // bug, re-introduced through the exit code instead of the psql flag.
    const src = withGate('  echo "ENVIRONMENT"\n  echo "nothing about it"\n  exit 1');
    expect(auditGate(src).problems.map((p) => p.code)).toEqual([
      "gate-does-not-exit-2",
    ]);
  });

  it("catches a gate that exits 2 but says nothing", () => {
    // psql ALSO exits 2 when it cannot connect, so a silent exit 2 is
    // indistinguishable from an accident. The words carry the meaning.
    const src = withGate("  exit 2");
    expect(auditGate(src).problems.map((p) => p.code)).toEqual([
      "gate-is-silent",
    ]);
  });

  it("catches a gate that names the environment but not the consequence", () => {
    const src = withGate('  echo "ENVIRONMENT problem"\n  exit 2');
    expect(auditGate(src).problems.map((p) => p.code)).toEqual([
      "gate-is-silent",
    ]);
  });

  it("catches a script with no gate at all", () => {
    const src = 'psql -q -d postgres -c "create database $DB;"\nexit 0';
    expect(auditGate(src).problems.map((p) => p.code)).toEqual([
      "no-refusal-gate",
    ]);
  });
});

// ===========================================================================
describe("every proof script on disk passes the audit", () => {
  const scripts = proofScripts();

  // rule 39: guard a vacuous read. If the glob broke, every assertion below
  // would pass by iterating over nothing.
  it("finds the proof scripts at all", () => {
    expect(scripts.length).toBeGreaterThanOrEqual(7);
    expect(scripts).toContain("prove-0229-executes.sh");
  });

  it.each(scripts)("%s names a database on every psql that runs SQL", (name) => {
    const bare = barePsqlLines(readScript(name));
    expect(
      bare,
      `${name} has psql call(s) with no -d:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it.each(scripts)("%s refuses a broken environment, loudly, with exit 2", (name) => {
    const { problems } = auditGate(readScript(name));
    expect(
      problems.map((p) => `${p.code}: ${p.detail}`),
      `${name} failed the environment-gate audit`,
    ).toEqual([]);
  });
});

// ===========================================================================
describe("the known, deliberately unfixed defect stays visible", () => {
  /**
   * 0223-0227 end with no final `exit`, so their status is whatever their
   * last command happened to return -- which is how 0223 printed FAILED and
   * still exited 0.
   *
   * This is NOT fixed in Slice A. The owner asked for the bare-psql defect to
   * be brought back into scope; silently widening that into a rewrite of five
   * harnesses would be its own dishonesty, and an unreviewed change to the
   * thing that judges migrations is not a favour.
   *
   * So it is PINNED here instead. The test does not demand a fix; it demands
   * that the situation match what has been written down. If someone fixes
   * 0225, this test fails and forces the note above to be updated -- which is
   * exactly the reminder that the remaining work exists.
   */
  it("records exactly which scripts lack a final exit", () => {
    const lacking = proofScripts().filter(
      (name) => auditGate(readScript(name)).missingExplicitExit,
    );
    expect(lacking).toEqual([
      "prove-0223-executes.sh",
      "prove-0224-executes.sh",
      "prove-0225-executes.sh",
      "prove-0226-executes.sh",
      "prove-0227-executes.sh",
    ]);
  });

  it("confirms 0228 and 0229 are the model to copy", () => {
    for (const name of ["prove-0228-executes.sh", "prove-0229-executes.sh"]) {
      expect(auditGate(readScript(name)).missingExplicitExit, name).toBe(false);
    }
    // And that the model is what it claims: a final exit carrying the count.
    expect(readScript("prove-0229-executes.sh")).toContain('exit "$FAIL"');
  });
});

// ===========================================================================
describe("the runtime half is not silently claimed", () => {
  it("the saboteur that proves the gate FIRES exists and is not in CI", () => {
    // Honesty about coverage. These text tests prove the gate is PRESENT.
    // Only sabotage-proof-env-gate.sh proves it WORKS, and it needs a live
    // PostgreSQL, so it is run by hand and its result recorded in the commit.
    const saboteur = readFileSync(
      path.join(SCRIPTS_DIR, "sabotage-proof-env-gate.sh"),
      "utf8",
    );
    expect(saboteur).toContain("PGDATABASE");
    expect(saboteur).toContain("PGPORT=1");
    // It must test BOTH directions: refusing when broken, and still proving
    // when healthy. A gate that refused everything would be worse.
    expect(saboteur).toContain("TEST 1");
    expect(saboteur).toContain("TEST 2");
    expect(saboteur).toContain("TEST 3");
  });
});
