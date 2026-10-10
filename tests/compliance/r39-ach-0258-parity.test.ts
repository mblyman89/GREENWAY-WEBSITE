/**
 * tests/compliance/r39-ach-0258-parity.test.ts  (R39 S2)
 *
 * Migration 0258 enforces the ACH rules in the database, and
 * src/lib/payments/ach-authorization-core.ts enforces the same rules in the
 * app. Two copies of one rule drift apart unless something compares them.
 * This file compares them.
 *
 * Rule 141 (source-text tests are a last resort): the BEHAVIOUR of every
 * guard is proven against a real Postgres by
 * scripts/recon/ach-authorizations-pg-check.sql, which CI runs, and by 60
 * mutants in scripts/r39/mutate-0258-sql.sh. That cannot show the SQL
 * agreeing with the TypeScript, because the TypeScript never runs in
 * Postgres. Reading both texts is the only way to check it, which is why
 * this test does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  POST_APPLY_CHECKS,
  judgePostApplyCheck,
} from "../../scripts/compliance/verify-migrations-execute";
import {
  AUTHORIZATION_STATES,
  MAX_ACCOUNTS_PER_PAYEE,
  POLICY_RETENTION_YEARS,
  canTransition,
  retentionVerdict,
  validateMicroEntryCents,
} from "@/lib/payments/ach-authorization-core";

const ROOT = join(__dirname, "..", "..");
const SQL = readFileSync(join(ROOT, "supabase/migrations/0258_ach_authorizations.sql"), "utf8");
const RB = readFileSync(join(ROOT, "supabase/rollbacks/0258_ach_authorizations.rollback.sql"), "utf8");
const RUNBOOK = readFileSync(join(ROOT, "docs/MIGRATIONS_TO_RUN.md"), "utf8");
const CI = readFileSync(join(ROOT, ".github/workflows/compliance-tests.yml"), "utf8");
const VME = readFileSync(join(ROOT, "scripts/compliance/verify-migrations-execute.ts"), "utf8");

/** Remove `--` comments so a rule written in a comment cannot satisfy a test. */
const code = (s: string) =>
  s
    .split("\n")
    .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
    .join("\n");
const SQLC = code(SQL);

/** Parse the `allowed := case old.state when ... then array[...]` block. */
function sqlTransitions(): Map<string, string[]> {
  const fn = SQLC.match(/function public\.ach_auth_guard_transition\(\)[\s\S]*?end \$\$;/);
  if (!fn) throw new Error("ach_auth_guard_transition not found in 0258");
  const out = new Map<string, string[]>();
  const re = /when '([a-z_]+)'\s+then array\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fn[0]))) {
    out.set(
      m[1],
      [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(),
    );
  }
  return out;
}

describe("0258 and ach-authorization-core.ts state the same rules", () => {
  it("the state list is identical, in both directions", () => {
    const m = SQLC.match(/check \(state in \(([^)]*)\)\)/);
    expect(m, "state check constraint not found").not.toBeNull();
    const sqlStates = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(sqlStates).toEqual([...AUTHORIZATION_STATES].sort());
  });

  it("every transition edge agrees: all 49 from/to pairs", () => {
    const t = sqlTransitions();
    // archived has no `when` arm in SQL (it falls to `else array[]`), so it
    // must be the ONLY state missing, and the core must agree it has no exits.
    expect([...t.keys()].sort()).toEqual(AUTHORIZATION_STATES.filter((s) => s !== "archived").sort());
    expect(SQLC).toMatch(/else array\[\]::text\[\]/);
    let pairs = 0;
    for (const from of AUTHORIZATION_STATES) {
      for (const to of AUTHORIZATION_STATES) {
        if (from === to) continue; // SQL short-circuits same-state updates
        pairs += 1;
        const inSql = (t.get(from) ?? []).includes(to);
        expect(inSql, `${from} -> ${to}: SQL ${inSql}, core ${canTransition(from, to)}`).toBe(
          canTransition(from, to),
        );
      }
    }
    expect(pairs).toBe(42); // 7 x 7 minus the 7 same-state pairs
  });

  it("the account limit is the same number in both", () => {
    expect(MAX_ACCOUNTS_PER_PAYEE).toBe(3);
    expect(SQLC).toMatch(/\)\s*>=\s*3 then\s+raise exception 'ACH_ACCOUNT_LIMIT/);
    expect(SQLC).toMatch(/check \(priority between 1 and 3\)/);
  });

  it("the retention padding is the same number of years in both", () => {
    expect(POLICY_RETENTION_YEARS).toBe(6);
    const hits = SQLC.match(/interval '(\d+) years'/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const h of hits) expect(h).toBe(`interval '${POLICY_RETENTION_YEARS} years'`);
  });

  it("retention: the core and the SQL agree on the exact boundary day", () => {
    // The pg-check asserts ach_retention_may_dispose is false ON the 6-year
    // date and true the day after. The core must give the same answer, or the
    // app would offer a delete that the database then refuses.
    const ended = "2026-10-01";
    const onDay = retentionVerdict({ signedOn: "2026-01-15", endedOn: ended, legalHold: false, today: "2032-10-01" });
    const after = retentionVerdict({ signedOn: "2026-01-15", endedOn: ended, legalHold: false, today: "2032-10-02" });
    expect(onDay.kind).toBe("keep_until");
    expect(after.kind).toBe("may_dispose");
    expect(SQLC).toMatch(/p_today\s*>\s*greatest\(/);
  });

  it("the micro-entry (test credit) range is 1..99 cents in both", () => {
    expect(SQLC).toMatch(/micro_amount_cents between 1 and 99/);
    expect(validateMicroEntryCents(1).ok).toBe(true);
    expect(validateMicroEntryCents(99).ok).toBe(true);
    expect(validateMicroEntryCents(0).ok).toBe(false);
    expect(validateMicroEntryCents(100).ok).toBe(false);
  });
});

describe("0258 guard of the guards", () => {
  it("the rollback refuses once real records exist, using dynamic SQL so a re-run is clean", () => {
    const rb = code(RB);
    expect(rb).toContain("ROLLBACK REFUSED: signed ACH authorizations exist");
    expect(rb).toContain("ROLLBACK REFUSED: ACH documents have been uploaded");
    // A static `exists (select ... from public.ach_authorizations)` is planned
    // even behind to_regclass and errors on the second run. Measured, not
    // assumed (R39 S2 found it by running the file twice).
    expect(rb).not.toMatch(/exists\s*\(\s*select[^)]*from public\.ach_authorizations/);
    expect(rb).toMatch(/execute 'select count\(\*\) from public\.ach_authorizations/);
    // The guard runs BEFORE the first drop.
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop table"));
  });

  it("CI runs the behavioural check after every migration is applied (rule 48)", () => {
    // CI's migrations job runs verify-migrations-execute.ts against the
    // bootstrapped Postgres, and that script runs POST_APPLY_CHECKS.
    expect(CI).toContain("npx tsx scripts/compliance/verify-migrations-execute.ts");
    const ach = POST_APPLY_CHECKS.find((c) => c.file === "scripts/recon/ach-authorizations-pg-check.sql");
    expect(ach?.mustPrint).toBe("ACH 0258 CHECK PASSED");
    // The pg-check really prints that line (a typo here would fail every run,
    // but would do so as an unexplained red).
    expect(readFileSync(join(ROOT, ach!.file), "utf8")).toContain("ACH 0258 CHECK PASSED");
    // Wiring: the checks run only once all migrations succeed, and only inside main().
    const main = VME.slice(VME.indexOf("function main()"));
    expect(main.indexOf("POST_APPLY_CHECKS")).toBeGreaterThan(main.indexOf("SECOND run - idempotency"));
  });

  it("judgePostApplyCheck: exit 0 WITHOUT the all-clear line is a failure, not a pass", () => {
    const c = { file: "x.sql", mustPrint: "ALL CLEAR" };
    expect(judgePostApplyCheck(c, { exitedOk: true, output: "NOTICE: ALL CLEAR\n" })).toBeNull();
    expect(judgePostApplyCheck(c, { exitedOk: true, output: "" })).toMatch(/never printed "ALL CLEAR"/);
    expect(judgePostApplyCheck(c, { exitedOk: true, output: "all clear" })).toMatch(/never printed/);
    expect(
      judgePostApplyCheck(c, { exitedOk: false, output: "a\npsql:x.sql:3: ERROR:  probe was ACCEPTED\nb" }),
    ).toBe("psql:x.sql:3: ERROR:  probe was ACCEPTED");
    // Non-zero exit with the line still printed is a FAILURE (the line could
    // come from an earlier block before a later one died).
    expect(judgePostApplyCheck(c, { exitedOk: false, output: "ALL CLEAR" })).not.toBeNull();
    expect(judgePostApplyCheck(c, { exitedOk: false, output: "" })).toMatch(/non-zero/);
  });

  it("the migration ends by asking PostgREST to reload, and grants nothing to anon", () => {
    expect(SQLC.trim()).toMatch(/notify pgrst, 'reload schema';$/);
    expect(SQLC).not.toMatch(/grant [^;]* to anon/i);
  });

  it("MIGRATIONS_TO_RUN tells Michael what 0258 does, how to check it, and how to undo it", () => {
    const at = RUNBOOK.indexOf("## R39 — 0258");
    expect(at).toBeGreaterThan(-1);
    const entry = RUNBOOK.slice(at);
    expect(entry).toContain("0258_ach_authorizations.sql");
    expect(entry).toContain("supabase/rollbacks/0258_ach_authorizations.rollback.sql");
    expect(entry).toContain("**Without it:**");
    expect(entry).toContain("**Check:**");
    expect(entry).toContain("-- 7");
    expect(entry).toContain("**refuses**");
  });
});
