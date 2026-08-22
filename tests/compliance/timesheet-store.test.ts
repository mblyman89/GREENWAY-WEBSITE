/**
 * tests/compliance/timesheet-store.test.ts   (slice books-32)
 *
 * The gate over the TIMESHEET STORE - the layer between the database rows and
 * the overtime engine.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ENGINE TESTS
 *
 * `timesheet-core.ts` is proven to compute overtime correctly. That proof is
 * worth nothing if the rows handed to it are the wrong rows. Standing rule 63d
 * says the handoff is where the defect lives, and this slice proved it: the
 * first draft of the store selected punches with a hardcoded `-08:00` offset,
 * which is Pacific STANDARD time. Every pay period between March and November
 * would have had its selection window shifted an hour, dropping a punch that
 * started at 00:30 on day one of the period and dragging in a punch belonging
 * to the next period. A January control showed a variance of ZERO, which is
 * why the bug would have survived Michael's 2027-01-01 cutover testing and
 * only started losing hours in March.
 *
 * WHAT IS ASSERTED HERE THAT THE ENGINE CANNOT ASSERT ABOUT ITSELF
 *   - The pure mappers (`toRawPunch`, `toEmployeePayFacts`, `expectedPeriodCount`)
 *     refuse or report unknown rather than defaulting.
 *   - SOURCE-LEVEL rules no runtime test can reach without a database: that the
 *     punch window is DST-aware, that the approval write carries a race guard,
 *     and that the stored `minutes` column is never used to paper over a
 *     missing timestamp.
 *
 * THE STAKES
 * These functions decide which punches get paid. A punch this layer fails to
 * select is not an error on a screen - it is an hour of somebody's pay that
 * silently never existed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  expectedPeriodCount,
  toEmployeePayFacts,
  toRawPunch,
} from "@/lib/payroll/timesheet-store";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

const STORE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "payroll",
  "timesheet-store.ts",
);

const storeSrc = readFileSync(STORE_PATH, "utf8");

/**
 * The source with comments stripped, so a rule merely DESCRIBED in prose cannot
 * satisfy a test looking for the rule IMPLEMENTED in code. Without this, the
 * long comment block explaining the daylight-saving defect would itself make
 * the "no hardcoded offset" test pass while the bug sat two lines below it.
 */
const storeCode = storeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the comment-stripping helper actually strips (rule 39)", () => {
  it("leaves real code behind and removes prose", () => {
    // If this ever produced an empty string, every source-level assertion below
    // would pass vacuously.
    expect(storeCode.length).toBeGreaterThan(1_000);
    expect(storeCode).toContain("export function toRawPunch");
    // A phrase that appears ONLY inside the block comments must be gone.
    expect(storeSrc).toContain("Pacific STANDARD time");
    expect(storeCode).not.toContain("Pacific STANDARD time");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * toRawPunch - the row -> engine-input mapping
 * ════════════════════════════════════════════════════════════════════════ */

describe("toRawPunch", () => {
  const good = {
    id: "p1",
    employee_id: "e1",
    punch_kind: "work",
    clock_in_at: "2027-01-04T17:00:00.000Z",
    clock_out_at: "2027-01-05T01:00:00.000Z",
    minutes: 480,
  };

  it("maps a complete work punch across unchanged", () => {
    const r = toRawPunch(good);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.punch).toEqual({
      id: "p1",
      employeeId: "e1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00.000Z",
      clockOutAt: "2027-01-05T01:00:00.000Z",
      minutes: 480,
    });
  });

  it("maps punch_kind 'break' to break", () => {
    const r = toRawPunch({ ...good, punch_kind: "break" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.punch.punchKind).toBe("break");
  });

  it("treats any non-'break' kind as work, matching the database CHECK", () => {
    // time_punches_punch_kind_check allows exactly ('work','break'). A null or
    // an unexpected value must land on the side that gets PAID, because the
    // failure mode of guessing 'break' is unpaid time.
    for (const kind of ["work", null, "WORK", "regular"]) {
      const r = toRawPunch({ ...good, punch_kind: kind });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("unreachable");
      expect(r.punch.punchKind).toBe("work");
    }
  });

  it("REFUSES a punch with no clock-in rather than inventing one", () => {
    const r = toRawPunch({ ...good, clock_in_at: null });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.code).toBe("OPEN_PUNCH");
    expect(r.refusal.subjectId).toBe("p1");
    // The message must name the punch and say what to do about it.
    expect(r.refusal.message).toContain("p1");
    expect(r.refusal.fix.length).toBeGreaterThan(30);
  });

  it("does NOT drop a refused punch silently - it returns it", () => {
    // The defect being prevented: `if (!row.clock_in_at) continue;`. That is a
    // one-word change that makes hours disappear with no message anywhere.
    const r = toRawPunch({ ...good, clock_in_at: null });
    expect(r).toBeDefined();
    expect(r.ok).toBe(false);
  });

  it("carries a null clock_out_at through instead of substituting minutes (rule 62d)", () => {
    // An open punch has an UNKNOWN length. The stored `minutes` column must not
    // be used to fill that in, because the engine's job is to notice the
    // disagreement, not to have it hidden from it.
    const r = toRawPunch({ ...good, clock_out_at: null, minutes: 480 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.punch.clockOutAt).toBeNull();
    expect(r.punch.minutes).toBe(480);
  });

  it("carries a null minutes through as null, not zero (rule 62d)", () => {
    const r = toRawPunch({ ...good, minutes: null });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.punch.minutes).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * toEmployeePayFacts
 * ════════════════════════════════════════════════════════════════════════ */

describe("toEmployeePayFacts", () => {
  const emp = { id: "e1", full_name: "A Worker", flsa_status: "non_exempt" };
  const pay = {
    employee_id: "e1",
    basis: "hourly",
    hourly_rate_milli_cents: 2_000_000,
  };

  it("maps an hourly non-exempt employee", () => {
    expect(toEmployeePayFacts(emp, pay)).toEqual({
      employeeId: "e1",
      fullName: "A Worker",
      flsaStatus: "non_exempt",
      basis: "hourly",
      hourlyRateMilliCents: 2_000_000,
    });
  });

  it("reads a null flsa_status as non_exempt - the database default and the safe answer", () => {
    const f = toEmployeePayFacts({ ...emp, flsa_status: null }, pay);
    expect(f.flsaStatus).toBe("non_exempt");
  });

  it("only the exact string 'exempt' means exempt", () => {
    // Anything else must fall to non_exempt, because non_exempt is the status
    // that EARNS overtime. Guessing in the other direction stops paying it.
    for (const s of ["Exempt", "EXEMPT", "exempt_admin", "", null, "salaried"]) {
      const f = toEmployeePayFacts({ ...emp, flsa_status: s }, pay);
      expect(f.flsaStatus).toBe(s === "exempt" ? "exempt" : "non_exempt");
    }
    expect(toEmployeePayFacts({ ...emp, flsa_status: "exempt" }, pay).flsaStatus).toBe(
      "exempt",
    );
  });

  it("only the exact string 'salary' means salary; everything else is hourly", () => {
    for (const b of ["hourly", "Salary", "", null, "wage"]) {
      const f = toEmployeePayFacts(emp, { ...pay, basis: b });
      expect(f.basis).toBe("hourly");
    }
    expect(toEmployeePayFacts(emp, { ...pay, basis: "salary" }).basis).toBe("salary");
  });

  it("a MISSING pay record yields a null rate, not a zero rate (rule 62d)", () => {
    // A zero rate multiplies out to a zero paycheck that looks arithmetically
    // fine. A null rate makes the engine refuse with NO_HOURLY_RATE.
    const f = toEmployeePayFacts(emp, null);
    expect(f.hourlyRateMilliCents).toBeNull();
    expect(f.hourlyRateMilliCents).not.toBe(0);
  });

  it("a salary record with a null hourly rate stays null", () => {
    // employee_pay_basis_shape_chk guarantees a salary row has a NULL
    // hourly_rate_milli_cents, so this is the real shape, not a hypothetical.
    const f = toEmployeePayFacts(emp, {
      employee_id: "e1",
      basis: "salary",
      hourly_rate_milli_cents: null,
    });
    expect(f.basis).toBe("salary");
    expect(f.hourlyRateMilliCents).toBeNull();
  });

  it("names an unnamed employee rather than rendering 'null' on a payroll screen", () => {
    const f = toEmployeePayFacts({ ...emp, full_name: null }, pay);
    expect(f.fullName).toBe("(no name on file)");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * expectedPeriodCount
 * ════════════════════════════════════════════════════════════════════════ */

describe("expectedPeriodCount", () => {
  const of = (freq: string, n: number) =>
    Array.from({ length: n }, () => ({ pay_frequency: freq }));

  it("returns 26 for a biweekly calendar - Michael's staff cadence", () => {
    expect(expectedPeriodCount(of("biweekly", 26))).toBe(26);
  });

  it("returns the right count for every cadence the database CHECK allows", () => {
    // Migration 0197 constrains pay_periods.pay_frequency to exactly these
    // eight values. A branch for a value the database forbids would be dead
    // code (rule 50); a missing branch would be a wrong complaint.
    expect(expectedPeriodCount(of("weekly", 1))).toBe(52);
    expect(expectedPeriodCount(of("biweekly", 1))).toBe(26);
    expect(expectedPeriodCount(of("semimonthly", 1))).toBe(24);
    expect(expectedPeriodCount(of("monthly", 1))).toBe(12);
    expect(expectedPeriodCount(of("quarterly", 1))).toBe(4);
    expect(expectedPeriodCount(of("semiannually", 1))).toBe(2);
    expect(expectedPeriodCount(of("annually", 1))).toBe(1);
    // 'daily' is allowed by the CHECK but has no fixed annual count.
    expect(expectedPeriodCount(of("daily", 1))).toBeNull();
  });

  it("every cadence in the migration CHECK is handled by name", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "0197_timesheet_workweek.sql",
      ),
      "utf8",
    );
    const block = migration.match(
      /pay_frequency text not null\s*check \(pay_frequency in \(([\s\S]*?)\)\)/,
    );
    expect(block).not.toBeNull();
    const allowed = [...(block as RegExpMatchArray)[1].matchAll(/'([a-z]+)'/g)].map(
      (m) => m[1],
    );
    // Guard the guard: if the regex stopped matching, this list would be empty
    // and the loop below would assert nothing at all.
    expect(allowed.length).toBe(8);
    for (const cadence of allowed) {
      // Either it maps to a number, or it is deliberately null ('daily').
      const got = expectedPeriodCount(of(cadence, 1));
      expect(cadence === "daily" ? got === null : typeof got === "number").toBe(true);
    }
  });

  it("returns null for an EMPTY calendar rather than pretending it expects zero", () => {
    expect(expectedPeriodCount([])).toBeNull();
  });

  it("returns null when cadences are MIXED rather than picking one", () => {
    // The owner is paid annually and the staff biweekly, so a mixed calendar is
    // the normal state at Greenway, not a corruption. Answering "26" here would
    // produce a confident complaint about a calendar that is correct.
    const mixed = [...of("biweekly", 26), { pay_frequency: "annually" }];
    expect(expectedPeriodCount(mixed)).toBeNull();
  });

  it("returns null for a cadence nobody has taught it", () => {
    expect(expectedPeriodCount(of("fortnightly", 3))).toBeNull();
  });

  it("counts the CADENCE, not the number of rows", () => {
    // A calendar with only 3 biweekly periods on it still EXPECTS 26; that gap
    // is exactly what the progress panel is meant to surface.
    expect(expectedPeriodCount(of("biweekly", 3))).toBe(26);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * SOURCE-LEVEL RULES (things no runtime test can reach without a database)
 * ════════════════════════════════════════════════════════════════════════ */

describe("the punch selection window is daylight-saving aware", () => {
  it("contains no hardcoded Pacific offset in executable code", () => {
    // THE DEFECT THIS SLICE CAUGHT. `-08:00` is Pacific Standard Time; from the
    // second Sunday in March to the first Sunday in November the true offset is
    // -07:00. The literal is banned outright rather than commented against.
    expect(storeCode).not.toMatch(/-0[78]:00/);
    expect(storeCode).not.toMatch(/T00:00:00[-+]\d{2}:\d{2}/);
  });

  it("builds both bounds with the shared DST-aware helper", () => {
    expect(storeCode).toContain("pacificWallTimeToUtcISO(period.start_date");
    expect(storeCode).toContain("pacificWallTimeToUtcISO(nextDay(period.end_date)");
  });

  it("uses a half-open window: gte on the start, lt on the day AFTER the end", () => {
    // `lte end_date` on a timestamp column silently excludes everything worked
    // after midnight on the final day of the period.
    expect(storeCode).toMatch(/\.gte\(\s*"clock_in_at"/);
    expect(storeCode).toMatch(/\.lt\(\s*"clock_in_at"/);
    expect(storeCode).not.toMatch(/\.lte\(\s*"clock_in_at"/);
  });

  it("PROOF the hardcoded offset really did drop a real punch (summer)", () => {
    // Reproduces the measurement that condemned the original code, so the
    // reason for the helper survives in an executable form rather than only in
    // a comment somebody may later delete.
    const start = "2027-06-05";
    const end = "2027-06-18";
    const nextAfterEnd = "2027-06-19";

    const hardLo = Date.parse(`${start}T00:00:00-08:00`);
    const hardHi = Date.parse(`${nextAfterEnd}T00:00:00-08:00`);
    const goodLo = Date.parse(pacificWallTimeToUtcISO(start, "start"));
    const goodHi = Date.parse(pacificWallTimeToUtcISO(nextAfterEnd, "start"));

    // The window really is shifted a full hour at both ends.
    expect((hardLo - goodLo) / 60_000).toBe(60);
    expect((hardHi - goodHi) / 60_000).toBe(60);

    // A punch on day ONE of the period, which the engine would assign to
    // 2027-06-05, is EXCLUDED by the broken window and INCLUDED by the fixed one.
    const early = Date.parse(
      pacificWallTimeToUtcISO(start, { h: 0, m: 30, s: 0, ms: 0 }),
    );
    expect(pacificDayKey(new Date(early).toISOString())).toBe(start);
    expect(early >= hardLo && early < hardHi).toBe(false);
    expect(early >= goodLo && early < goodHi).toBe(true);

    // And a punch belonging to the NEXT period is dragged in by the broken
    // window, where the engine would then refuse it as PUNCH_OUTSIDE_PERIOD.
    const stray = Date.parse(
      pacificWallTimeToUtcISO(nextAfterEnd, { h: 0, m: 30, s: 0, ms: 0 }),
    );
    expect(pacificDayKey(new Date(stray).toISOString())).toBe(nextAfterEnd);
    expect(stray >= hardLo && stray < hardHi).toBe(true);
    expect(stray >= goodLo && stray < goodHi).toBe(false);

    // Keep the end date referenced so the fixture cannot drift unnoticed.
    expect(end).toBe("2027-06-18");
  });

  it("CONTROL: the same comparison in January shows ZERO variance (rule 60)", () => {
    // This is the control that makes the finding meaningful. Michael's first
    // payroll is 2027-01-01. In winter the hardcoded offset is CORRECT, so
    // cutover testing would have shown nothing wrong. If this control ever
    // fails, the test above is measuring something other than daylight saving.
    const winter = "2027-01-02";
    const hardLo = Date.parse(`${winter}T00:00:00-08:00`);
    const goodLo = Date.parse(pacificWallTimeToUtcISO(winter, "start"));
    expect(hardLo - goodLo).toBe(0);
  });
});

describe("the approval gate cannot be raced or forged", () => {
  it("the UPDATE carries its own status guard, not just a prior read", () => {
    // A check-then-write with nothing in between is a race. The race here would
    // re-approve a quarter that has already been filed.
    expect(storeCode).toMatch(/\.neq\(\s*"status",\s*"locked"\s*\)/);
  });

  it("records WHO approved and WHEN", () => {
    expect(storeCode).toContain("approved_by: approvedByStaffId");
    expect(storeCode).toContain("approved_at:");
  });

  it("refuses an approval with no person attached", () => {
    expect(storeCode).toContain("BAD_INPUT");
    expect(storeCode).toMatch(/if \(!approvedByStaffId\)/);
  });

  it("treats an empty UPDATE result as a lost race rather than success", () => {
    // `.neq` filtering the row out returns no data and NO error. Reading that
    // as success is how a locked period gets silently re-approved.
    expect(storeCode).toMatch(/if \(!data\)/);
  });
});

describe("the store computes nothing it should be asking the engine", () => {
  it("never re-implements the overtime threshold or multiplier", () => {
    // Two copies of the overtime rule eventually disagree, on a paycheck.
    expect(storeCode).not.toMatch(/\b40\s*\*\s*100\b/);
    expect(storeCode).not.toMatch(/\b4000\b|\b4_000\b/);
    expect(storeCode).not.toMatch(/1\.5|15_000\b/);
    expect(storeCode).toContain("WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS");
    expect(storeCode).toContain("WA_OVERTIME_MULTIPLIER_BASIS_POINTS");
  });

  it("delegates every hours calculation to computePeriodHours", () => {
    expect(storeCode).toContain("computePeriodHours(");
  });

  it("never uses the stored minutes column as a fallback for a timestamp", () => {
    // The engine reports the disagreement between stored minutes and the
    // minutes implied by the timestamps. Resolving it here destroys the
    // evidence that anything ever differed.
    expect(storeCode).not.toMatch(/clock_in_at\s*\?\?/);
    expect(storeCode).not.toMatch(/minutes\s*\?\?\s*0/);
  });

  it("never defaults a missing hourly rate to zero", () => {
    expect(storeCode).not.toMatch(/hourly_rate_milli_cents\s*\?\?\s*0/);
    expect(storeCode).toContain("hourly_rate_milli_cents ?? null");
  });
});

describe("the store reads only current, active rows", () => {
  it("filters employees to the active ones", () => {
    expect(storeCode).toMatch(/\.eq\(\s*"active",\s*true\s*\)/);
  });

  it("filters pay records to the current one", () => {
    // employee_pay is effective-dated; without is_current a rehired employee
    // with two rows would be paid at both rates.
    expect(storeCode).toMatch(/\.eq\(\s*"is_current",\s*true\s*\)/);
  });
});

describe("the service-role bypass is acknowledged, not assumed away", () => {
  it("says in the file that RLS does not protect this path", () => {
    // Migration 0197 puts owner-only policies on pay_periods. The service role
    // ignores them. Every caller must therefore pass requireBooksAccess()
    // first, and that obligation is written down (rule 62e) rather than
    // remembered.
    expect(storeSrc).toContain("requireBooksAccess()");
    expect(storeSrc.toLowerCase()).toContain("service role");
  });
});
