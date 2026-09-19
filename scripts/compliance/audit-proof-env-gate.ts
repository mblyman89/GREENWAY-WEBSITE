/**
 * scripts/compliance/audit-proof-env-gate.ts   (Slice A)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * After a sandbox restart, `prove-0229-executes.sh` reported "0 passed, 43
 * failed". Nothing was wrong with migration 0229. The Postgres role named
 * after the invoking user had vanished, and the harness's setup line was:
 *
 *     psql -q -c "create database $DB;"
 *
 * With no `-d`, psql connects to a database named after the invoking user.
 * That database was gone, so the CREATE never ran, and the proof then
 * executed its entire checklist against a database that did not exist. It
 * blamed the migration for a problem the migration cannot cause.
 *
 * Five of the six sibling scripts were worse: they printed FAILED and still
 * exited 0.
 *
 * A PROOF THAT CANNOT TELL AN ENVIRONMENT PROBLEM FROM A MIGRATION DEFECT IS
 * NOT A PROOF. Slice A fixed all seven. This file stops the eighth from being
 * written with the same hole, because the next proof script will be created
 * by copying an existing one, and the copy is where defects propagate.
 *
 * WHAT THIS DOES *NOT* DO
 * -----------------------
 * It reads text. Text-reading cannot prove the gate FIRES -- only that it is
 * present and spelled correctly. The firing is proven by actually breaking
 * the environment in scripts/compliance/sabotage-proof-env-gate.sh, which
 * needs a live PostgreSQL and so is run by hand, not in CI.
 *
 * The two are deliberately complementary:
 *   - this file  : cheap, runs in CI, catches a NEW script missing the gate
 *   - the saboteur: expensive, needs a server, proves the gate WORKS
 *
 * Neither alone is sufficient, and saying so is the point (rule 48: a test
 * that silently passes when Postgres is absent is the same lie in a new
 * place).
 *
 * KNOWN, DELIBERATELY UNFIXED
 * ---------------------------
 * 0223-0227 end with no explicit `exit`, so their status is whatever their
 * last command returned -- they can report success while printing failures.
 * That is a real defect and it is NOT in scope for Slice A; widening a
 * scoped request without saying so is its own kind of dishonesty. It is
 * REPORTED here (see `missingExplicitExit`) so it stays visible, but it is
 * not asserted as a failure. 0228/0229 (`exit "$FAIL"`) are the model for
 * whenever that work is done.
 */

// ---------------------------------------------------------------------------
// PURE CORE (house rule 5): no file system, no psql, no process. Given the
// TEXT of a proof script, decide what is wrong with it. Everything here is a
// pure function of its input so it can be tested without a database.
// ---------------------------------------------------------------------------

/** One thing wrong with one script, in words a human can act on. */
export type GateProblem = {
  /** Stable identifier so tests can assert on a specific fault. */
  readonly code:
    | "bare-psql-c"
    | "no-refusal-gate"
    | "gate-does-not-exit-2"
    | "gate-is-silent";
  /** Plain-English explanation, including the offending line where useful. */
  readonly detail: string;
};

export type GateAudit = {
  readonly problems: readonly GateProblem[];
  /**
   * Reported, never asserted. See "KNOWN, DELIBERATELY UNFIXED" above.
   * True when the script has no explicit `exit` on its final path.
   */
  readonly missingExplicitExit: boolean;
};

/**
 * Strip comment lines and blank lines.
 *
 * WHY: every one of these scripts explains the bug in its own header, so the
 * literal string `psql -q -c "create database` appears in prose. An auditor
 * that flagged its own explanation would be unusable, and worse, would train
 * the reader to ignore it.
 *
 * Only FULL-LINE comments are dropped. A trailing `# ...` after real code is
 * kept, because the code before it still counts.
 */
export function codeLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return false;
      if (trimmed.startsWith("#")) return false;
      return true;
    });
}

/**
 * A `psql` invocation that runs SQL without saying WHICH database.
 *
 * The dangerous shape is a command-mode call (`-c` or `-f`) with no `-d` and
 * no connection URI. `psql -d "$DB" -c "..."` is fine. `psql -q -c "..."` is
 * the bug: it silently targets a database named after the invoking user.
 *
 * NOTE ON `-tAc`: the scripts use `psql -d "$DB" -tAc "select ..."` for real
 * queries, which is safe because `-d` is present. The check below is about
 * the ABSENCE of `-d`, not about which flag carries the SQL.
 */
export function barePsqlLines(source: string): string[] {
  return codeLines(source).filter((line) => {
    if (!/(^|[;&|]\s*|\s)psql\b/.test(line)) return false;

    // Does this invocation carry SQL at all? A bare `psql` with no -c/-f is
    // an interactive session and is not what broke.
    const carriesSql = /\s-[a-zA-Z]*[cf]\b/.test(line);
    if (!carriesSql) return false;

    // Does it name a database? Either -d/--dbname, or a connection URI, or
    // the database given as a trailing positional argument.
    const namesDb =
      /\s-d\b/.test(line) ||
      /\s--dbname\b/.test(line) ||
      /postgres(ql)?:\/\//.test(line) ||
      /\sPGDATABASE=/.test(line);

    return !namesDb;
  });
}

/**
 * Does the script REFUSE to continue when the scratch database is missing?
 *
 * Three separate properties, because each can be broken on its own:
 *   1. there is a connectivity check at all,
 *   2. it exits 2 -- not 0 ("proved") and not 1 ("a real failure"),
 *   3. it SAYS, in words, that this is an environment problem and that
 *      nothing has been proven.
 *
 * (3) matters more than it looks. `psql` itself exits 2 when it cannot
 * connect, so a script with NO gate can still exit 2 entirely by accident.
 * The words are what make the exit code trustworthy.
 */
export function auditGate(source: string): GateAudit {
  const problems: GateProblem[] = [];

  for (const line of barePsqlLines(source)) {
    problems.push({
      code: "bare-psql-c",
      detail:
        `psql runs SQL without naming a database, so it silently targets a ` +
        `database named after the invoking user: ${line.trim()}`,
    });
  }

  const code = codeLines(source).join("\n");

  // The gate is a connectivity probe guarding an early exit.
  const hasProbe = /if\s+!\s*psql[^\n]*-tAc[^\n]*select 1/i.test(code);
  if (!hasProbe) {
    problems.push({
      code: "no-refusal-gate",
      detail:
        "no connectivity check before the migration work, so a missing " +
        "scratch database will be reported as a migration defect",
    });
  } else {
    if (!/\bexit 2\b/.test(code)) {
      problems.push({
        code: "gate-does-not-exit-2",
        detail:
          'the refusal gate does not "exit 2". 0 means proved and 1 means a ' +
          'real failure, so "not proven" needs its own code',
      });
    }
    // The wording check runs against the WHOLE source (comments included is
    // wrong here -- we want what the script PRINTS), so use echo lines only.
    const printed = codeLines(source)
      .filter((l) => /\becho\b/.test(l))
      .join("\n");
    const saysEnvironment = /ENVIRONMENT/i.test(printed);
    const saysNothingProven = /nothing about/i.test(printed);
    if (!saysEnvironment || !saysNothingProven) {
      problems.push({
        code: "gate-is-silent",
        detail:
          "the refusal gate exits without telling the reader it is an " +
          "ENVIRONMENT problem and that nothing about the migration has " +
          "been proven -- psql also exits 2 on a failed connection, so the " +
          "exit code alone is ambiguous",
      });
    }
  }

  // Is there an exit on the script's NORMAL path, i.e. outside the refusal
  // gate? Every one of these scripts has `exit 2` inside the gate, so a naive
  // "does the word exit appear" check reports every script as fine and
  // detects nothing. Verified against the real files: 0223-0227 have ONLY the
  // gate's `exit 2`; 0228/0229 also have a final `exit "$FAIL"`.
  //
  // The gate's exit is indented (it sits inside an `if`). A final-path exit is
  // at column zero. That is the distinction used here, and it is checked in
  // the tests against all seven real scripts so it cannot rot silently.
  const hasFinalExit = source
    .split("\n")
    .some((l) => /^exit\s+\S/.test(l) && !l.trim().startsWith("#"));

  return { problems, missingExplicitExit: !hasFinalExit };
}

export const __internals = { codeLines };
