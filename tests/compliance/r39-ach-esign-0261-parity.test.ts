/**
 * tests/compliance/r39-ach-esign-0261-parity.test.ts  (R39 S6)
 *
 * Migration 0261 enforces the in-person e-sign rules in the database;
 * src/lib/payments/ach-esign-core.ts enforces the same rules in the app. If
 * they disagree, the screen would offer a step the database then refuses, or
 * the database would accept something the app would have refused.
 *
 * The BEHAVIOUR is proven against real Postgres by
 * scripts/recon/ach-esign-0261-pg-check.sql (CI runs it via POST_APPLY_CHECKS)
 * and by 42 SQL mutants in scripts/r39/mutate-0261-sql.py. This file only
 * shows that the two texts state the SAME numbers and lists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import {
  ESIGN_STATES,
  ID_TYPES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  SESSION_TTL_MS,
  canMoveEsign,
  checkIdCheck,
  signatureMatches,
} from "@/lib/payments/ach-esign-core";
import { MAX_ACCOUNTS_PER_PAYEE } from "@/lib/payments/ach-authorization-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = read("supabase/migrations/0261_ach_esign.sql");
const RB = read("supabase/rollbacks/0261_ach_esign.rollback.sql");
const RUNBOOK = read("docs/MIGRATIONS_TO_RUN.md");
const MUT_LOG = read("scripts/r39/mutate-0261-sql.last.log");

/** Remove `--` comments so a rule written in a comment cannot satisfy a test. */
const code = (s: string) =>
  s
    .split("\n")
    .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
    .join("\n");
const SQLC = code(SQL);
const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("0261 states and moves agree with ach-esign-core", () => {
  it("the state CHECK lists exactly ESIGN_STATES", () => {
    const m = /check \(state in \(([^)]*)\)\)/.exec(SQLC);
    expect(m, "state CHECK not found").not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...ESIGN_STATES].sort());
  });

  it("every move the trigger allows is allowed by canMoveEsign, and vice versa (resend is a no-op state)", () => {
    const sqlMoves: Record<string, string[]> = {};
    for (const m of SQLC.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) sqlMoves[m[1]] = quoted(m[2]);
    expect(Object.keys(sqlMoves).sort()).toEqual(["code_sent", "consented", "started"]);
    for (const from of ESIGN_STATES) {
      for (const to of ESIGN_STATES) {
        if (from === to) continue; // same state is not a move in SQL (resend keeps code_sent)
        expect(canMoveEsign(from, to), `${from}->${to}`).toBe((sqlMoves[from] ?? []).includes(to));
      }
    }
    // signed and cancelled are final in both places
    expect(SQLC).toContain("if old.state in ('signed', 'cancelled') then");
    for (const to of ESIGN_STATES) {
      expect(canMoveEsign("signed", to)).toBe(false);
      expect(canMoveEsign("cancelled", to)).toBe(false);
    }
  });

  it("the ID types CHECK lists exactly ID_TYPES", () => {
    const m = /id_type\s+text not null check \(id_type in \(([^)]*)\)\)/.exec(SQLC);
    expect(m).not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...ID_TYPES].sort());
  });
});

describe("0261 numbers agree with ach-esign-core", () => {
  it("code sends and attempts", () => {
    expect(SQLC).toContain(`check (otp_sends between 0 and ${OTP_MAX_SENDS})`);
    expect(SQLC).toContain(`check (otp_attempts between 0 and ${OTP_MAX_ATTEMPTS})`);
  });

  it("session lifetime", () => {
    expect(SESSION_TTL_MS).toBe(30 * 60 * 1000);
    expect(SQLC).toContain("if s.started_at < now() - interval '30 minutes' then");
  });

  it("accounts per authorization", () => {
    expect(SQLC).toContain(`if n < 1 or n > ${MAX_ACCOUNTS_PER_PAYEE} then`);
  });

  it("ID detail: the same 4..40 length and the same no-5-digits rule", () => {
    expect(SQLC).toContain("check (length(id_detail) between 4 and 40 and id_detail !~ '[0-9]{5,}')");
    const today = "2026-01-01";
    const sqlOk = (d: string) => d.length >= 4 && d.length <= 40 && !/[0-9]{5,}/.test(d);
    for (const d of ["1234", "1234 exp 2029-05-01", "WDL123456789", "12345", "abc", "x".repeat(41), "A1B2 exp 2030-12-31"]) {
      const app = checkIdCheck("passport", d, today).ok;
      // The app may refuse MORE (expired dates); it may never accept what SQL refuses.
      if (app) expect(sqlOk(d), d).toBe(true);
      if (!sqlOk(d)) expect(app, d).toBe(false);
    }
  });

  it("the typed-name comparison is the same case- and spacing-insensitive rule", () => {
    expect(SQLC).toContain("lower(regexp_replace(trim(coalesce(p_typed_name, '')), '\\s+', ' ', 'g'))");
    expect(SQLC).toContain("<> lower(regexp_replace(trim(s.legal_name), '\\s+', ' ', 'g'))");
    expect(signatureMatches("  esign   PROBE ", "Esign Probe")).toBe(true); // the pg-check's happy-path input
    expect(signatureMatches("Someone Else", "Esign Probe")).toBe(false);
  });
});

describe("0261 guard of the guards", () => {
  it("the trigger covers DELETE as well as UPDATE, and signed rows are kept", () => {
    expect(SQLC).toMatch(/before update or delete on public\.ach_esign_sessions/);
    expect(SQLC).toContain("ACH_ESIGN_KEEP");
  });

  it("the function is service_role only and NOT security definer", () => {
    expect(SQLC).not.toMatch(/security definer/i);
    expect(SQLC).toMatch(/revoke all on function public\.ach_esign_complete\([^)]*\) from public, anon, authenticated;/);
    expect(SQLC).toMatch(/grant execute on function public\.ach_esign_complete\([^)]*\) to service_role;/);
  });

  it("the rollback refuses once anything is signed, before it drops anything", () => {
    const rb = code(RB);
    expect(rb).toContain("ROLLBACK REFUSED: ach_esign_sessions holds signed sessions");
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop function"));
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop table"));
  });

  it("CI runs the behavioural check, after 0260's, and it prints its all-clear line", () => {
    const c = POST_APPLY_CHECKS.find((x) => x.file === "scripts/recon/ach-esign-0261-pg-check.sql");
    expect(c?.mustPrint).toBe("ACH 0261 CHECK PASSED");
    expect(read(c!.file)).toContain("ACH 0261 CHECK PASSED");
    const files = POST_APPLY_CHECKS.map((x) => x.file);
    expect(files.indexOf(c!.file)).toBeGreaterThan(files.indexOf("scripts/recon/ach-intake-0260-pg-check.sql"));
  });

  it("the last recorded SQL mutation run killed every mutant", () => {
    const m = /killed (\d+)\/(\d+) survivors \[\]/.exec(MUT_LOG);
    expect(m, "mutation log has no clean summary").not.toBeNull();
    expect(Number(m![1])).toBe(Number(m![2]));
    expect(Number(m![2])).toBeGreaterThanOrEqual(42);
  });

  it("the runbook tells the owner how to run, check and roll back 0261", () => {
    const i = RUNBOOK.indexOf("## R39 — 0261");
    expect(i, "MIGRATIONS_TO_RUN.md has no 0261 section").toBeGreaterThan(-1);
    const j = RUNBOOK.indexOf("\n## ", i + 5);
    const sec = RUNBOOK.slice(i, j === -1 ? undefined : j);
    for (const h of ["**Without it:**", "**Run it, then:**", "**Check:**", "**Rollback (only if needed):**"]) {
      expect(sec, h).toContain(h);
    }
    expect(sec).toContain("supabase/rollbacks/0261_ach_esign.rollback.sql");
    expect(sec).toContain("AFTER 0258, 0259 and 0260");
    expect(sec).toContain("ACH 0261 CHECK PASSED");
  });
});
