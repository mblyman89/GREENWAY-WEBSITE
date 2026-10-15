/**
 * tests/compliance/r39-ach-ops-core.test.ts  (R39 S7)
 *
 * ach-ops-core.ts against migration 0263's text: every refusal the database
 * can raise has words for Michael; the dates the core hands to
 * ach_verification_mark_sent always satisfy the function's own order check;
 * the self-tests run; and the new authority is taught.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  OPS_ERROR_TABLE,
  __runAchOpsCoreTests,
  checkEffectiveDate,
  opsDbErrorMessage,
  planCheckFile,
  type PlannedCheck,
} from "@/lib/payments/ach-ops-core";
import { isFedAchBankingDay, addCalendarDays } from "@/lib/payments/ach-authorization-core";
import { achLesson } from "@/lib/payments/ach-mentor";
import { uncitedAchAuthorities } from "@/lib/payments/ach-mentor-gates";

const ROOT = join(__dirname, "..", "..");
const SQL = readFileSync(join(ROOT, "supabase/migrations/0263_ach_operations.sql"), "utf8");
const SQL0258 = readFileSync(join(ROOT, "supabase/migrations/0258_ach_authorizations.sql"), "utf8");

const ORIG = {
  destinationRouting: "325170754",
  destinationName: "TIMBERLAND BANK",
  immediateOrigin: "1911234567",
  companyName: "GREENWAY MARIJUANA",
  companyId: "1911234567",
  originatingDfi: "32517075",
  companyEin: "911234567", // R41 S2: Timberland shape (test EIN, not Greenway's)
};
const check = (o: Partial<PlannedCheck> = {}): PlannedCheck => ({
  verificationId: "v1",
  method: "prenote",
  status: "planned",
  microCents: null,
  payeeName: "Ann Lee",
  payeeRef: null,
  accountType: "checking",
  routing: "125000024",
  accountNumber: "123456789",
  ...o,
});

describe("every 0263 refusal has words", () => {
  const codes = [...new Set([...SQL.matchAll(/(ACH_[A-Z_]+):/g)].map((m) => m[1]))].sort();
  it("found the codes (the scrape is not empty)", () => {
    expect(codes.length).toBeGreaterThanOrEqual(30);
  });
  it.each(codes)("%s maps to a specific message, not the fallback", (c) => {
    const msg = opsDbErrorMessage(`${c}: something`);
    expect(msg.startsWith("The database refused"), msg).toBe(false);
    expect(msg.includes("migration 0263"), msg).toBe(false);
  });
  it("the named constraints 0263 adds are mapped too", () => {
    for (const c of ["ach_ver_one_open_per_account", "ach_ver_sent_shape", "ach_ver_note_shape"]) {
      expect(SQL).toContain(c);
      expect(opsDbErrorMessage(`violates "${c}"`).startsWith("The database refused"), c).toBe(false);
    }
  });
  it("the 0258 transition guard words are mapped", () => {
    expect(SQL0258).toContain("ACH_AUTH_TRANSITION");
    expect(opsDbErrorMessage("ACH_AUTH_TRANSITION: x").startsWith("The database refused")).toBe(false);
  });
  it("each table row is reachable (no row is shadowed by an earlier, broader one)", () => {
    for (const [re, text] of OPS_ERROR_TABLE) {
      const sample = re.source.split("|")[0].replace(/\\/g, "");
      expect(opsDbErrorMessage(`${sample}: x`), re.source).toBe(text);
    }
  });
});

describe("dates handed to ach_verification_mark_sent always satisfy 0263", () => {
  it("for every banking day over two years, prenote and test credit", () => {
    let tried = 0;
    let day = "2026-10-01";
    for (let i = 0; i < 730; i++) {
      day = addCalendarDays(day, 1);
      const today = addCalendarDays(day, -1);
      if (!isFedAchBankingDay(day)) {
        expect(checkEffectiveDate(day, today).ok, day).toBe(false);
        continue;
      }
      for (const method of ["prenote", "micro_entry"] as const) {
        const r = planCheckFile({
          method,
          checks: [check({ method, microCents: method === "micro_entry" ? 42 : null })],
          originator: ORIG,
          effective: day,
          todayIso: today,
          createdAt: new Date(`${today}T20:00:00Z`),
          fileIdModifier: "A", // R41 S3: the ledger supplies the letter; required
        });
        expect(r.ok, `${method} ${day}`).toBe(true);
        if (!r.ok) continue;
        // 0263: settlement >= effective and eligible > settlement (function and CHECK)
        expect(r.plan.settlement >= r.plan.effective).toBe(true);
        expect(r.plan.eligible > r.plan.settlement).toBe(true);
        if (method === "prenote") expect(isFedAchBankingDay(r.plan.eligible), r.plan.eligible).toBe(true);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(900);
  });
  it("0263 still checks that order (the property above is about the right rule)", () => {
    expect(SQL).toContain("or p_settlement < p_effective or p_eligible <= p_settlement then");
  });
});

describe("self-tests and teaching", () => {
  it("the pure self-tests pass, at least as many as the registry floor", () => {
    const r = __runAchOpsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(92);
    const reg = readFileSync(join(ROOT, "scripts/compliance/run-pure-selftests.ts"), "utf8");
    expect(reg).toContain('assertRan("ach-ops-core", __runAchOpsCoreTests(), 92)');
  });
  it("the micro-entry monitoring authority is taught and nothing is left uncited", () => {
    const l = achLesson("test-credit-monitoring");
    expect(l?.authorities).toContain("ach-micro-entry-monitor-volumes");
    expect(uncitedAchAuthorities()).toEqual([]);
  });
});
