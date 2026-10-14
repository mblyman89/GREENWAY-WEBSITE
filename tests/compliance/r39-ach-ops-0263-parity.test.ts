/**
 * tests/compliance/r39-ach-ops-0263-parity.test.ts  (R39 S7)
 *
 * Migration 0263 (returns / change notices, account checks, holds, legal hold,
 * annual review) enforces rules in the database; the app's pure cores
 * (ach-authorization-core, ach-return-log-core) enforce the same rules before
 * anything is sent. If they disagree, Michael or Stephen would be offered a
 * button the database refuses, or the database would accept what the app
 * means to refuse.
 *
 * BEHAVIOUR is proven against real Postgres by
 * scripts/recon/ach-ops-0263-pg-check.sql (CI runs it via POST_APPLY_CHECKS)
 * and by 80 SQL mutants in scripts/r39/mutate-0263-sql.py. This file shows the
 * texts state the SAME numbers and lists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import {
  AUTHORIZATION_STATES,
  CALLBACK_METHODS,
  MIN_CALLBACK_NOTE_CHARS,
  validateMicroEntryCents,
} from "@/lib/payments/ach-authorization-core";
import { MIN_RESOLUTION_NOTE_CHARS, NOTICE_MAX_AGE_DAYS } from "@/lib/payments/ach-return-log-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = read("supabase/migrations/0263_ach_operations.sql");
const SQL0258 = read("supabase/migrations/0258_ach_authorizations.sql");
const RB = read("supabase/rollbacks/0263_ach_operations.rollback.sql");
const RUNBOOK = read("docs/MIGRATIONS_TO_RUN.md");
const MUT_LOG = read("scripts/r39/mutate-0263-sql.last.log");

/** Remove `--` comments so a rule written in a comment cannot satisfy a test. */
const code = (s: string) =>
  s
    .split("\n")
    .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
    .join("\n");
const SQLC = code(SQL);
const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const FUNCTIONS = [
  "ach_notice_log",
  "ach_notice_resolve",
  "ach_auth_release_hold",
  "ach_verification_start",
  "ach_verification_mark_sent",
  "ach_verification_finish",
  "ach_auth_set_legal_hold",
  "ach_auth_review_done",
] as const;

/** The body of one SQL function, from its `create or replace` to the next. */
function fnBody(name: string): string {
  const i = SQLC.indexOf(`create or replace function public.${name}(`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const j = SQLC.indexOf("create or replace function", i + 10);
  return SQLC.slice(i, j === -1 ? undefined : j);
}

describe("0263 numbers agree with the app cores", () => {
  it("resolution note: 10 characters in the table CHECK, the resolve function and the app", () => {
    expect(MIN_RESOLUTION_NOTE_CHARS).toBe(10);
    expect(SQLC).toContain(`resolution_note is null or length(trim(resolution_note)) >= ${MIN_RESOLUTION_NOTE_CHARS}`);
    expect(fnBody("ach_notice_resolve")).toContain(`coalesce(length(trim(p_note)), 0) < ${MIN_RESOLUTION_NOTE_CHARS} then`);
  });

  it("notice date: the app's 400-day window is the database's", () => {
    expect(fnBody("ach_notice_log")).toContain(`p_received_on < today - ${NOTICE_MAX_AGE_DAYS} then`);
    expect(fnBody("ach_notice_log")).toContain("p_received_on > today");
  });

  it("hold release (as replaced by 0271): callback methods, the 10-character note, owner only, no solo reason", () => {
    // R41 S0: 0271 replaces ach_auth_release_hold with the same signature, so
    // the LIVE body is 0271's; 0263's original must still exist for the replace.
    expect(fnBody("ach_auth_release_hold")).toContain("p_reason  text");
    const s71 = code(readFileSync(join(ROOT, "supabase/migrations/0271_ach_owner_authority.sql"), "utf8"));
    const i = s71.indexOf("create or replace function public.ach_auth_release_hold(");
    expect(i, "0271 does not replace ach_auth_release_hold").toBeGreaterThan(-1);
    const body = s71.slice(i, s71.indexOf("end $$;", i));
    const m = /p_method not in \(([^)]*)\)/.exec(body);
    expect(m, "method list not found").not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...CALLBACK_METHODS].sort());
    expect(body).toContain(`coalesce(length(trim(p_note)), 0) < ${MIN_CALLBACK_NOTE_CHARS} then`);
    expect(body).toContain("if not public.ach_write_by_owner(p_actor) then");
    expect(body).not.toMatch(/is_solo/);
    expect(body).not.toMatch(/length\(trim\(p_reason\)\), 0\) </);
    expect(body).toContain("return 'owner';");
    // The owner check comes before the row is even read (no information leak).
    expect(body.indexOf("ach_write_by_owner(p_actor)")).toBeLessThan(body.indexOf("for update"));
  });

  it("voided-check callback pass needs the same 10-character note", () => {
    expect(fnBody("ach_verification_finish")).toContain(
      `v.method = 'voided_check_callback' and coalesce(length(trim(p_note)), 0) < ${MIN_CALLBACK_NOTE_CHARS} then`,
    );
  });

  it("test credit: 1..99 cents in the 0258 CHECK and in validateMicroEntryCents (every value 0..100 compared)", () => {
    const c0258 = code(SQL0258);
    expect(c0258).toContain("micro_amount_cents is null or micro_amount_cents between 1 and 99");
    expect(c0258).toContain("payee_confirmed_cents is null or payee_confirmed_cents between 1 and 99");
    let compared = 0;
    for (let c = -1; c <= 101; c++) {
      expect(validateMicroEntryCents(c).ok, `${c}`).toBe(c >= 1 && c <= 99);
      compared++;
    }
    expect(compared).toBe(103);
  });

  it("verification methods: the start function's list is the 0258 table's list", () => {
    const m = /p_method not in \(([^)]*)\)/.exec(fnBody("ach_verification_start"));
    expect(m).not.toBeNull();
    const t = /method\s+text not null check \(method in \(([^)]*)\)\)/.exec(code(SQL0258));
    expect(t, "0258 method CHECK not found").not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual(quoted(t![1]).sort());
    expect(quoted(m![1]).sort()).toEqual(["micro_entry", "prenote", "voided_check_callback"]);
  });

  it("every authorization state the functions name is a real state", () => {
    const named = new Set<string>();
    for (const m of SQLC.matchAll(/a2?\.state (?:not )?in \(([^)]*)\)/g)) for (const s of quoted(m[1])) named.add(s);
    for (const m of SQLC.matchAll(/a\.state <> '([a-z_]+)'/g)) named.add(m[1]);
    expect(named.size).toBeGreaterThanOrEqual(4);
    for (const s of named) expect(AUTHORIZATION_STATES as readonly string[], s).toContain(s);
  });

  it("annual review: one year, Pacific date, in pass and in review-done", () => {
    expect(fnBody("ach_verification_finish")).toContain("annual_review_due_on = coalesce(a.annual_review_due_on, (today + interval '1 year')::date)");
    expect(fnBody("ach_verification_finish")).toContain("today date := (now() at time zone 'America/Los_Angeles')::date;");
    expect(fnBody("ach_auth_review_done")).toContain("nxt  date := ((now() at time zone 'America/Los_Angeles')::date + interval '1 year')::date;");
  });

  it("sent dates: effective <= settlement < first live day, in the function and the CHECK", () => {
    expect(fnBody("ach_verification_mark_sent")).toContain("or p_settlement < p_effective or p_eligible <= p_settlement then");
    expect(SQLC).toContain("and settlement_date >= effective_date and eligible_on > settlement_date)");
    // A test credit may be confirmed the day after it settles; a prenote waits for the given day.
    expect(fnBody("ach_verification_mark_sent")).toContain("eligible_on = case when v.method = 'prenote' then p_eligible else p_settlement + 1 end");
  });
});

describe("0263 guard of the guards", () => {
  it("notices and checks are kept: both triggers cover DELETE", () => {
    expect(SQLC).toMatch(/before update or delete on public\.ach_return_notices/);
    expect(SQLC).toMatch(/before update or delete on public\.ach_verifications/);
    expect(SQLC).toContain("ACH_NOTICE_KEEP");
    expect(SQLC).toContain("ACH_VERIFICATION_KEEP");
  });

  it("a finished check says FINAL before it says anything else", () => {
    const body = fnBody("ach_verification_finish");
    expect(body.indexOf("ACH_VERIFICATION_FINAL")).toBeGreaterThan(-1);
    expect(body.indexOf("ACH_VERIFICATION_FINAL")).toBeLessThan(body.indexOf("ACH_VERIFICATION_STATE"));
  });

  it("all eight functions are service_role only, pin search_path, and are NOT security definer", () => {
    expect(SQLC).not.toMatch(/security definer/i);
    for (const fn of FUNCTIONS) {
      expect(fnBody(fn), fn).toContain("set search_path = public, pg_temp");
      expect(SQLC).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQLC).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });

  it("every function writes an event to the append-only log", () => {
    for (const fn of FUNCTIONS) {
      const body = fnBody(fn);
      expect(body, fn).toContain("insert into public.ach_authorization_events");
    }
  });

  it("the rollback refuses (three ways) before it drops anything", () => {
    const rb = code(RB);
    const refusals = [...rb.matchAll(/ROLLBACK REFUSED/g)].length;
    expect(refusals).toBe(3);
    const lastRefusal = rb.lastIndexOf("ROLLBACK REFUSED");
    expect(lastRefusal).toBeLessThan(rb.indexOf("drop function"));
    expect(lastRefusal).toBeLessThan(rb.indexOf("drop trigger"));
  });

  it("CI runs the behavioural check, after 0262's, and it prints its all-clear line", () => {
    const c = POST_APPLY_CHECKS.find((x) => x.file === "scripts/recon/ach-ops-0263-pg-check.sql");
    expect(c?.mustPrint).toBe("ACH 0263 CHECK PASSED");
    expect(read(c!.file)).toContain("ACH 0263 CHECK PASSED");
    const files = POST_APPLY_CHECKS.map((x) => x.file);
    expect(files.indexOf("scripts/recon/vendor-esign-0262-pg-check.sql")).toBeGreaterThan(-1);
    expect(files.indexOf(c!.file)).toBeGreaterThan(files.indexOf("scripts/recon/vendor-esign-0262-pg-check.sql"));
  });

  it("the last recorded SQL mutation run killed every mutant", () => {
    const m = /killed (\d+)\/(\d+) survivors \[\]/.exec(MUT_LOG);
    expect(m, "mutation log has no clean summary").not.toBeNull();
    expect(Number(m![1])).toBe(Number(m![2]));
    expect(Number(m![2])).toBeGreaterThanOrEqual(80);
  });

  it("the runbook tells the owner how to run, check and roll back 0263", () => {
    const i = RUNBOOK.indexOf("## R39 — 0263");
    expect(i, "MIGRATIONS_TO_RUN.md has no 0263 section").toBeGreaterThan(-1);
    const j = RUNBOOK.indexOf("\n## ", i + 5);
    const sec = RUNBOOK.slice(i, j === -1 ? undefined : j);
    for (const h of ["**Without it:**", "**Run it, then:**", "**Check:**", "**Rollback (only if needed):**"]) expect(sec, h).toContain(h);
    expect(sec).toContain("supabase/rollbacks/0263_ach_operations.rollback.sql");
    expect(sec).toContain("AFTER 0258, 0259, 0260, 0261 and 0262");
    expect(sec).toContain("ACH 0263 CHECK PASSED");
  });
});
