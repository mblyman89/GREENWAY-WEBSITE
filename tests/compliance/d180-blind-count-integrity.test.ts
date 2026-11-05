/**
 * D180 (S3) — blind-count integrity. Owner: "I am making all of my employees
 * manager types … we need a system that is very good at beating the fraud
 * triangle."
 *
 * Pins: the closer's count is never overwritten (reconcile + correction write
 * reconciled_count_minor), it stays hidden until the second count on every
 * page that could leak it, money consumers read countedCashMinor, and the
 * second count is timed by a server-signed token and flagged (never blocked).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runCountIntegrityTests,
  closerCountVisible,
  countedCashMinor,
  readOpenedToken,
  secondCountFlags,
  signOpenedToken,
} from "@/lib/registers/count-integrity-core";
import { expectedDeposit } from "@/lib/registers/deposit-bag-flow-core";
import { keyedHasher } from "@/lib/security/keyed-hash";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D180 core", () => {
  it("self-test passes", () => {
    const r = __runCountIntegrityTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(35);
  });
  it("money reads the reconciled count; the closer's count is hidden until the second count", () => {
    expect(countedCashMinor({ reconciled_count_minor: 267810, closing_count_minor: 0 })).toBe(267810);
    expect(closerCountVisible({ status: "closed", second_count_minor: null })).toBe(false);
    expect(closerCountVisible({ status: "closed", second_count_minor: 1 })).toBe(true);
  });
  it("a real keyed token round-trips and refuses tampering", () => {
    const h = keyedHasher("secondCountOpened", "fixed-test-key")!;
    const t0 = 1_793_800_000_000;
    const tok = signOpenedToken("s1", t0, h);
    expect(readOpenedToken(tok, "s1", t0 + 1000, h)).toBe(t0);
    expect(readOpenedToken(tok, "s1", t0 + 1000, keyedHasher("secondCountOpened", "other-key"))).toBeNull();
    expect(readOpenedToken(tok.replace(`.${t0}.`, `.${t0 - 600_000}.`), "s1", t0, h)).toBeNull();
  });
  it("the 2026-11-04 audit case (54 s after close, every coin identical) is flagged", () => {
    const D = { pennies: 0, nickels: 0, dimes: 0, quarters: 158, half_dollars: 0, dollar_coins: 0, ones: 0, twos: 0, fives: 0, tens: 0, twenties: 93, fifties: 0, hundreds: 0 };
    const v = secondCountFlags({
      closedAtIso: "2026-11-04T05:00:00.000Z",
      openedAtMs: null,
      savedAtMs: Date.parse("2026-11-04T05:00:54.000Z"),
      closerDenoms: D,
      secondDenoms: { ...D },
      loginEmployeeId: null,
      closerEmployeeId: "c",
    });
    expect(v.flags).toEqual(expect.arrayContaining(["fast", "identical_and_fast", "no_timer"]));
  });
  it("the deposit sheet withholds a blind drawer's line", () => {
    const e = expectedDeposit([{ id: "a", registerName: "SR1", status: "closed", openingMinor: 16750, closingMinor: 90000, secondCountMinor: null }], []);
    expect(e.lines).toHaveLength(0);
    expect(e.expectedMinor).toBeNull();
  });
});

describe("D180 wiring", () => {
  it("reconcile never writes the closer's count once 0343 exists", () => {
    const s = read("src/lib/registers/store.ts");
    const i = s.indexOf("export async function reconcileDrawer");
    const body = s.slice(i, s.indexOf("\n}\n", i));
    expect(body).toContain("? { reconciled_count_minor: counted }");
    // the closer's column is written only on the pre-0343 fallback path
    expect(body).toMatch(/with0343\s*\n?\s*\? \{ reconciled_count_minor: counted \}\s*\n?\s*: opts\.countBasis\s*\n?\s*\? \{ closing_count_minor: counted \}/);
    expect(body).toContain("let { data, error } = await write(true, true, true);");
  });
  it("the correction writes reconciled_count_minor and compares on it", () => {
    const s = read("src/lib/registers/drawer-correction-store.ts");
    expect(s).toContain('with0343 ? { reconciled_count_minor: check.newCountMinor } : { closing_count_minor: check.newCountMinor }');
    expect(s).toContain('q = q.eq("reconciled_count_minor", oldCount)');
    expect(s).toContain("let { data, error } = await update(true, true);");
  });
  it("money consumers read countedCashMinor", () => {
    expect(read("src/lib/registers/drawer-posting-service.ts")).toContain("const countedMinor = countedCashMinor(session);");
    expect(read("src/lib/registers/deposit-bag-store.ts")).toContain("closingMinor: countedCashMinor(s),");
    expect(read("src/lib/registers/eod-store.ts")).toContain("closingMinor: countedCashMinor(s),");
    expect(read("src/lib/registers/drawer-figure-store.ts")).toContain("closingMinor: countedCashMinor(session),");
  });
  it("every page that could leak the closer's count hides it until the second count", () => {
    expect(read("src/lib/registers/oversight.ts")).toContain("closingCountMinor: closerCountVisible(s) ? s.closing_count_minor : null,");
    expect(read("src/lib/registers/oversight.ts")).toContain("amountMinor: closerCountVisible(s) ? s.closing_count_minor : null,");
    expect(read("src/lib/registers/eod-store.ts")).toContain("closingCountMinor: closerCountVisible(s) ? countedCashMinor(s) : null,");
    expect(read("src/lib/registers/deposit-bag-store.ts")).toContain("secondCountMinor: s.second_count_minor ?? null,");
    expect(read("src/lib/registers/eod-store.ts")).toContain("secondCountMinor: s.second_count_minor ?? null,");
    expect(read("src/app/admin/registers/history/page.tsx")).toContain("!closerCountVisible(s)");
    expect(read("src/app/admin/registers/history/[id]/page.tsx")).toContain("!closerVisible");
    expect(read("src/app/admin/registers/history/[id]/page.tsx")).not.toContain("{formatCents(session.closing_count_minor)}");
  });
  it("the blind form carries a server-signed opened token; the action reads it and audits the flags", () => {
    const page = read("src/app/admin/registers/page.tsx");
    expect(page).toContain('signOpenedToken(item.sessionId, Date.now(), keyedHasher("secondCountOpened"))');
    expect(page).toContain('<input type="hidden" name="opened_token" value={openedToken} />');
    expect(page).toContain('data-testid="second-count-flags"');
    const a = read("src/app/admin/registers/actions.ts");
    expect(a).toContain('readOpenedToken(str(formData, "opened_token"), sessionId, Date.now(), keyedHasher("secondCountOpened"))');
    expect(a).toContain('action: "drawer.second_count_flagged"');
    expect(a).toContain("flags: result.flags ?? [],");
  });
  it("flags warn, never block: the count is saved before the flags are worked out", () => {
    const s = read("src/lib/registers/store.ts");
    const i = s.indexOf("export async function recordSecondCount");
    const body = s.slice(i, s.indexOf("\n}\n", i));
    expect(body.indexOf('.is("second_count_minor", null)')).toBeGreaterThan(0);
    expect(body.indexOf("secondCountFlags({")).toBeGreaterThan(body.indexOf('.is("second_count_minor", null)'));
    expect(body).not.toMatch(/flags[^\n]*return \{ ok: false/);
  });
});

describe("D180 migration 0343", () => {
  const sql = read("supabase/migrations/0343_drawer_count_integrity.sql");
  it("adds the columns idempotently and makes the counts write-once", () => {
    for (const c of ["reconciled_count_minor", "second_count_opened_at", "second_count_flags", "second_count_entered_by_login"]) {
      expect(sql).toContain(`add column if not exists ${c}`);
    }
    expect(sql).toContain("CLOSER_COUNT_IMMUTABLE");
    expect(sql).toContain("SECOND_COUNT_IMMUTABLE");
    expect(sql).toContain("before update on public.drawer_sessions");
    expect(sql).toContain("drop trigger if exists drawer_sessions_counts_immutable");
  });
  it("backfills before the trigger exists and restores the closer's count from the 'close' row", () => {
    const iBackfill = sql.indexOf("set reconciled_count_minor = s.closing_count_minor");
    const iRestore = sql.indexOf("set closing_count_minor = c.total_minor");
    const iTrigger = sql.indexOf("create trigger drawer_sessions_counts_immutable");
    expect(iBackfill).toBeGreaterThan(0);
    expect(iRestore).toBeGreaterThan(iBackfill);
    expect(iTrigger).toBeGreaterThan(iRestore);
  });
  it("ships its pg-check, rollback and run-list entry", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("drawer-count-integrity-0343-pg-check.sql");
    expect(read("scripts/recon/drawer-count-integrity-0343-pg-check.sql")).toContain("DRAWER COUNT INTEGRITY 0343 CHECK PASSED");
    expect(read("supabase/rollbacks/0343_drawer_count_integrity.rollback.sql")).toContain("drop trigger if exists drawer_sessions_counts_immutable");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0343_drawer_count_integrity.sql");
  });
});
