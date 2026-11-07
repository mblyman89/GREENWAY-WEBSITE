/**
 * tests/compliance/d198-atm-cash-drops.test.ts   (D198 - ATM cash drops from the tills)
 *
 * Owner (2026-11-07): "the ipad should only accept whole 20 dollar amounts. i want the number of
 * 20s taken from the till to be entered on the register. ... the atm drops count toward the 2k
 * drop. any register can do an atm drop. ... it is a lot of money and is easy to steal. so matching
 * is essential."
 *
 * S1 pins: migration 0346 (destination / twenties_count CHECKs, write-once money trigger, the owner's
 * append-only atm_drop_reviews, grants), the PG check, the rollback, the owner hand-off, the pure
 * core's self-tests and that the core stays bundle-safe for the iPad (no imports at all).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __runAtmDropCoreTests, ATM_BILL_MINOR, splitDrops, validateAtmDropFields } from "@/lib/registers/atm-drop-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import { classifyTable } from "@/lib/accounting/factory-reset-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0346_atm_cash_drops.sql");

describe("D198 S1 migration 0346", () => {
  it("adds the five drawer_drops columns idempotently", () => {
    for (const c of ["destination text not null default 'safe'", "twenties_count integer", "atm_terminal_id text", "device_id text", "recorded_via text"]) {
      expect(MIG).toContain(`alter table public.drawer_drops add column if not exists ${c};`);
    }
  });

  it("an ATM drop is a $20 count and the amount is count x 2000, enforced by the database", () => {
    expect(MIG).toMatch(/check \(destination in \('safe', 'atm'\)\)/);
    expect(MIG).toMatch(/destination = 'safe' and twenties_count is null/);
    expect(MIG).toMatch(/amount_minor = twenties_count \* 2000/);
    expect(ATM_BILL_MINOR).toBe(2000);
  });

  it("the money on a drop is write-once", () => {
    expect(MIG).toMatch(/create or replace function public\.drawer_drops_money_immutable\(\)/);
    for (const col of ["session_id", "amount_minor", "destination", "twenties_count", "atm_terminal_id", "dropped_at"]) {
      expect(MIG).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(MIG).toMatch(/before update on public\.drawer_drops/);
    expect(MIG).not.toMatch(/before delete on public\.drawer_drops/);
    expect(MIG).toMatch(/revoke all on function public\.drawer_drops_money_immutable\(\) from public, anon, authenticated;/);
  });

  it("atm_drop_reviews is append-only for the server, invisible to app roles, kept by the reset, no FK", () => {
    expect(MIG).toMatch(/create table if not exists public\.atm_drop_reviews/);
    expect(MIG).toMatch(/alter table public\.atm_drop_reviews enable row level security;/);
    expect(MIG).toMatch(/revoke all on table public\.atm_drop_reviews from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke update, delete, truncate, references, trigger on table public\.atm_drop_reviews from service_role;/);
    expect(MIG).toMatch(/grant select, insert on table public\.atm_drop_reviews to service_role;/);
    const table = MIG.slice(MIG.indexOf("create table if not exists public.atm_drop_reviews"), MIG.indexOf("comment on table public.atm_drop_reviews"));
    expect(table).not.toMatch(/references/i);
    expect(classifyTable("atm_drop_reviews")?.disposition).toBe("KEEP");
    expect(classifyTable("drawer_drops")?.disposition).toBe("WIPE");
  });

  it("has a pg-check, a rollback and an owner hand-off", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/atm-cash-drops-0346-pg-check.sql", mustPrint: "ATM CASH DROPS 0346 CHECK PASSED" });
    expect(read("scripts/recon/atm-cash-drops-0346-pg-check.sql")).toContain("\\echo 'ATM CASH DROPS 0346 CHECK PASSED'");
    const rb = read("supabase/rollbacks/0346_atm_cash_drops.rollback.sql");
    expect(rb).toMatch(/\[ATM drop: /); // ATM details written into notes before the columns go
    expect(rb).toMatch(/if not exists \(select 1 from public\.atm_drop_reviews\)/); // sign-offs never destroyed
    expect(existsSync(join(ROOT, "supabase/rollbacks/0346_atm_cash_drops.rollback.sql"))).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0346_atm_cash_drops.sql");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("i want the number of 20s taken from the till to be entered on the register");
  });
});

describe("D198 S1 pure core", () => {
  it("self-tests pass and are registered", () => {
    const r = __runAtmDropCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(53);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("atm-drop-core", __runAtmDropCoreTests()');
  });

  it("is bundle-safe for the iPad: imports nothing", () => {
    const src = read("src/lib/registers/atm-drop-core.ts");
    expect(src).not.toMatch(/^import /m);
  });

  it("old builds send no destination and stay safe drops; an ATM drop never trusts a typed amount", () => {
    const v = validateAtmDropFields({ amountMinor: 12345 });
    expect(v.ok && v.destination).toBe("safe");
    expect(validateAtmDropFields({ destination: "atm", twentiesCount: 3, amountMinor: 6001 }).ok).toBe(false);
  });

  it("drawer + drop-due count every drop; deposit / EOD count safe drops only", () => {
    const s = splitDrops([{ amount_minor: 100000 }, { amount_minor: 40000, destination: "atm", twenties_count: 20 }]);
    expect(s.totalMinor).toBe(140000);
    expect(s.safeMinor).toBe(100000);
    expect(s.atmMinor).toBe(40000);
  });
});
