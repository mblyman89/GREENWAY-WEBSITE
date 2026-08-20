/**
 * tests/compliance/payroll-rate-registry-core.test.ts  (books-15)
 *
 * THE RATE REGISTRY, ADVERSARIALLY TESTED.
 *
 * Michael's ask: "rates change often and we will need a clever way to update
 * the system when they change." The clever way is that a rate is a DATED ROW
 * WITH A RECEIPT, and there is no way to get a rate except by asking for a
 * specific date.
 *
 * That design only holds if the escape hatches genuinely do not exist. So this
 * file spends most of its effort trying to get a WRONG NUMBER OUT rather than
 * proving the right one comes back:
 *
 *   - can a lookup in a gap be tricked into returning the nearest row?
 *   - can two rows for one day both be loaded?
 *   - can a milli-percent be read as cents?
 *   - does the year boundary land on the right side, to the day?
 *   - can a rate above the legal maximum be stored?
 *
 * Every test here was confirmed capable of failing by breaking the code under
 * it (standing rule 15c). Nothing in this file passes vacuously.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_PAYROLL_RATE_KEYS,
  PayrollRateRegistry,
  STATUTORY_RATE_CEILINGS_MILLI_PERCENT,
  addDays,
  describeKey,
  findCeilingViolations,
  findRateGaps,
  findRateOverlaps,
  findShareSumViolations,
  isValidIsoDate,
  validateRateRow,
  type PayrollRateKey,
  type PayrollRateRow,
} from "@/lib/payroll/payroll-rate-registry-core";
import {
  GREENWAY_RATES,
  GREENWAY_RATE_ROWS,
} from "@/lib/payroll/payroll-rates-2026";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A known-good row, so each test can corrupt exactly one field and no others. */
function row(over: Partial<PayrollRateRow> = {}): PayrollRateRow {
  return {
    key: "pfml_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 1_130,
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "test row",
    ...over,
  };
}

function mustRefuse<T>(r: { ok: true; value: T } | { ok: false; refusal: unknown }) {
  if (r.ok) throw new Error("expected a refusal, got a value");
  return r.refusal as { code: string; message: string; whatToDo: string; authorityId: string | null };
}

function mustGet<T>(r: { ok: true; value: T } | { ok: false; refusal: { message: string } }): T {
  if (!r.ok) throw new Error(`expected a value, got refusal: ${r.refusal.message}`);
  return r.value;
}

// ---------------------------------------------------------------------------
// 1) DATE VALIDATION - the foundation everything else stands on
// ---------------------------------------------------------------------------

describe("isValidIsoDate", () => {
  it("accepts real dates", () => {
    expect(isValidIsoDate("2026-01-01")).toBe(true);
    expect(isValidIsoDate("2026-12-31")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // 2024 IS a leap year
  });

  it("rejects calendar dates that do not exist (rule 13f)", () => {
    // A regex-only check passes all of these. That is the whole point.
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false); // 2025 is NOT a leap year
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-01-00")).toBe(false);
    expect(isValidIsoDate("2026-01-32")).toBe(false);
  });

  it("gets the century leap rule right", () => {
    // 1900 was not a leap year; 2000 was. Anyone hand-rolling this gets one wrong.
    expect(isValidIsoDate("1900-02-29")).toBe(false);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
    expect(isValidIsoDate("2100-02-29")).toBe(false);
  });

  it("rejects malformed shapes, not just bad numbers", () => {
    for (const bad of [
      "",
      "2026",
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "2026-01-01T00:00:00Z",
      " 2026-01-01",
      "2026-01-01 ",
      "not-a-date",
      "0000-00-00",
    ]) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
  });

  it("sweeps every day of a leap year and a common year (rule 15b)", () => {
    // Domain sweep: the count itself is the assertion. 2024 must yield 366
    // valid days and 2025 exactly 365, with February the only difference.
    let leap = 0;
    let common = 0;
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const mm = String(m).padStart(2, "0");
        const dd = String(d).padStart(2, "0");
        if (isValidIsoDate(`2024-${mm}-${dd}`)) leap++;
        if (isValidIsoDate(`2025-${mm}-${dd}`)) common++;
      }
    }
    expect(leap).toBe(366);
    expect(common).toBe(365);
    expect(leap - common).toBe(1);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("crosses February correctly in both leap and common years", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("round-trips over a full year, one day at a time (rule 15b)", () => {
    // Walks all 366 days of 2024 forward and back. Any off-by-one, any DST or
    // timezone leak, and the two ends stop meeting.
    let d = "2024-01-01";
    let steps = 0;
    while (d !== "2025-01-01") {
      d = addDays(d, 1);
      steps++;
      if (steps > 400) break;
    }
    expect(steps).toBe(366);
    let back = "2025-01-01";
    for (let i = 0; i < 366; i++) back = addDays(back, -1);
    expect(back).toBe("2024-01-01");
  });

  it("stays on ISO format with zero padding", () => {
    expect(addDays("2026-01-05", -4)).toBe("2026-01-01");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(/^\d{4}-\d{2}-\d{2}$/.test(addDays("2026-03-07", 3))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2) ROW VALIDATION - every field, one corruption at a time
// ---------------------------------------------------------------------------

describe("validateRateRow", () => {
  it("accepts a well-formed row (negative control - rule 15a)", () => {
    // If this ever fails, every rejection test below is passing for the wrong
    // reason and the whole section is worthless.
    expect(validateRateRow(row())).toBeNull();
  });

  it("accepts an open-ended row", () => {
    expect(validateRateRow(row({ effectiveTo: null }))).toBeNull();
  });

  it("accepts a single-day row", () => {
    expect(
      validateRateRow(row({ effectiveFrom: "2026-05-05", effectiveTo: "2026-05-05" })),
    ).toBeNull();
  });

  it("rejects an unknown key", () => {
    const p = validateRateRow(row({ key: "pfml_totl" as PayrollRateKey }));
    expect(p).toContain("unknown rate key");
    // Rule 19: the GRWNY/GRNWY typo hid 18 live accounts. A mistyped key must
    // never be silently treated as a new, empty levy.
    expect(p).toContain("pfml_totl");
  });

  it("rejects a fake calendar date in either bound", () => {
    expect(validateRateRow(row({ effectiveFrom: "2026-02-30" }))).toContain("effectiveFrom");
    expect(validateRateRow(row({ effectiveTo: "2025-02-29" }))).toContain("effectiveTo");
  });

  it("rejects a range that runs backwards", () => {
    const p = validateRateRow(row({ effectiveFrom: "2026-12-31", effectiveTo: "2026-01-01" }));
    expect(p).toContain("is before effectiveFrom");
  });

  it("rejects a float value (rule 13e - FLOAT FORBIDDEN in money paths)", () => {
    const p = validateRateRow(row({ value: 1_130.5 }));
    expect(p).toContain("must be an integer");
    // The realistic version: somebody types the percent instead of milli-percent.
    expect(validateRateRow(row({ value: 1.13 }))).toContain("must be an integer");
  });

  it("rejects NaN and Infinity, which are not integers but often slip past", () => {
    expect(validateRateRow(row({ value: Number.NaN }))).toContain("must be an integer");
    expect(validateRateRow(row({ value: Number.POSITIVE_INFINITY }))).toContain(
      "must be an integer",
    );
  });

  it("rejects a negative rate", () => {
    expect(validateRateRow(row({ value: -1 }))).toContain("cannot be negative");
  });

  it("accepts zero, because a zero rate is a real thing", () => {
    // A brand-new employer can genuinely carry a 0% social-cost component. Zero
    // must be storable; only "no row at all" may refuse.
    expect(validateRateRow(row({ value: 0 }))).toBeNull();
  });

  it("rejects a milli-percent over 100%", () => {
    expect(validateRateRow(row({ value: 100_001 }))).toContain("over 100%");
    // 100.000% exactly is legitimate - it is how a full share is expressed.
    expect(validateRateRow(row({ key: "pfml_employee_share_of_total", value: 100_000 }))).toBeNull();
  });

  it("does not apply the 100% guard to units where it is meaningless", () => {
    // $78,200 in cents is 7_820_000, far over 100_000, and perfectly correct.
    expect(
      validateRateRow(row({ key: "wa_suta_wage_base", value: 7_820_000, unit: "cents" })),
    ).toBeNull();
    expect(
      validateRateRow(
        row({ key: "lni_employee_rate", value: 16_445, unit: "milli_cents_per_hour" }),
      ),
    ).toBeNull();
  });

  it("rejects blank provenance fields (rule 11 - evidence, not memory)", () => {
    expect(validateRateRow(row({ authorityId: "" }))).toContain("authorityId is blank");
    expect(validateRateRow(row({ authorityId: "   " }))).toContain("authorityId is blank");
    expect(validateRateRow(row({ documentId: "" }))).toContain("documentId is blank");
    expect(validateRateRow(row({ documentId: "\t\n" }))).toContain("documentId is blank");
    expect(validateRateRow(row({ note: "" }))).toContain("note is blank");
  });
});

// ---------------------------------------------------------------------------
// 3) OVERLAP DETECTION - the "forgot to close last year's row" defect
// ---------------------------------------------------------------------------

describe("findRateOverlaps", () => {
  it("finds nothing in a clean adjacent pair (negative control)", () => {
    expect(
      findRateOverlaps([
        row({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", value: 920 }),
        row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
      ]),
    ).toEqual([]);
  });

  it("catches the single most likely editing mistake: a shared day", () => {
    // Off by ONE DAY. This is what happens when someone closes the old row on
    // Jan 1 instead of Dec 31.
    const p = findRateOverlaps([
      row({ effectiveFrom: "2025-01-01", effectiveTo: "2026-01-01", value: 920 }),
      row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("overlaps");
  });

  it("catches an open-ended row that was never closed", () => {
    // The realistic disaster: paste in next year's rate, forget to end this
    // year's. Without this check the old row wins forever, because it is first.
    const p = findRateOverlaps([
      row({ effectiveFrom: "2025-01-01", effectiveTo: null, value: 920 }),
      row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("never ends");
  });

  it("catches a fully contained row", () => {
    expect(
      findRateOverlaps([
        row({ effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }),
        row({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30", value: 1_000 }),
      ]),
    ).toHaveLength(1);
  });

  it("catches two identical rows", () => {
    expect(findRateOverlaps([row(), row()])).toHaveLength(1);
  });

  it("does not care about input order", () => {
    const a = row({ effectiveFrom: "2025-01-01", effectiveTo: "2026-06-01", value: 920 });
    const b = row({ effectiveFrom: "2026-01-01", effectiveTo: null });
    expect(findRateOverlaps([a, b])).toHaveLength(1);
    expect(findRateOverlaps([b, a])).toHaveLength(1);
  });

  it("never confuses two different keys", () => {
    // Identical dates, different levies. Not an overlap - that is normal.
    expect(
      findRateOverlaps([
        row({ key: "pfml_total" }),
        row({ key: "wa_cares_total", value: 580 }),
        row({ key: "wa_suta_total", value: 400 }),
      ]),
    ).toEqual([]);
  });

  it("handles the empty and single-row cases without inventing problems", () => {
    expect(findRateOverlaps([])).toEqual([]);
    expect(findRateOverlaps([row()])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4) GAP DETECTION - reported, not fatal
// ---------------------------------------------------------------------------

describe("findRateGaps", () => {
  it("finds nothing when coverage is continuous (negative control)", () => {
    expect(
      findRateGaps([
        row({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", value: 920 }),
        row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
      ]),
    ).toEqual([]);
  });

  it("finds a one-day hole", () => {
    // The nastiest kind of gap, because it looks like nothing on a screen.
    const g = findRateGaps([
      row({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-30", value: 920 }),
      row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toContain("2025-12-31");
  });

  it("finds a multi-year hole and names both ends", () => {
    const g = findRateGaps([
      row({ effectiveFrom: "2020-01-01", effectiveTo: "2020-12-31", value: 400 }),
      row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toContain("2021-01-01");
    expect(g[0]).toContain("2025-12-31");
  });

  it("reports nothing before the first row or after an open last row", () => {
    // A gap is only a hole BETWEEN rows. "Before Michael was an employer" is
    // not a defect, and a lookup there refuses anyway.
    expect(findRateGaps([row({ effectiveFrom: "2026-01-01", effectiveTo: null })])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5) STATUTORY CEILINGS - numbers the legislature actually wrote
// ---------------------------------------------------------------------------

describe("findCeilingViolations", () => {
  it("passes the real rates (negative control)", () => {
    expect(findCeilingViolations(GREENWAY_RATE_ROWS)).toEqual([]);
  });

  it("catches the 10x typo that the 100% guard cannot", () => {
    // 11_300 milli-percent is 11.3% - ten times the real PFML premium, well
    // under the generic 100% limit, and utterly illegal under RCW
    // 50A.10.030(6)(b)(ii). This is the exact fat-finger this check exists for.
    const p = findCeilingViolations([row({ value: 11_300 })]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("RCW 50A.10.030(6)(b)(ii)");
    expect(p[0]).toContain("1200");
  });

  it("allows a rate exactly at the ceiling", () => {
    // "must not exceed 1.20 percent" - 1.20% itself is lawful.
    expect(findCeilingViolations([row({ value: 1_200 })])).toEqual([]);
    expect(findCeilingViolations([row({ value: 1_201 })])).toHaveLength(1);
  });

  it("enforces the WA Cares ceiling from RCW 50B.04.080(1)", () => {
    expect(findCeilingViolations([row({ key: "wa_cares_total", value: 580 })])).toEqual([]);
    const p = findCeilingViolations([row({ key: "wa_cares_total", value: 581 })]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("RCW 50B.04.080(1)");
  });

  it("asserts no ceiling where the statute states none (rule 1)", () => {
    // SUTA and L&I have no single statutory total. Inventing one would be an
    // assumption, so the map must stay silent about them.
    expect(STATUTORY_RATE_CEILINGS_MILLI_PERCENT.wa_suta_total).toBeUndefined();
    expect(STATUTORY_RATE_CEILINGS_MILLI_PERCENT.lni_employee_rate).toBeUndefined();
    expect(findCeilingViolations([row({ key: "wa_suta_total", value: 9_000 })])).toEqual([]);
  });

  it("does not apply a percent ceiling to a non-percent unit", () => {
    expect(
      findCeilingViolations([
        row({ key: "wa_cares_total", value: 9_999_999, unit: "cents" }),
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6) PFML SHARE SUM - the pair that must total the whole premium
// ---------------------------------------------------------------------------

describe("findShareSumViolations", () => {
  it("passes the real 71.43 / 28.57 split (negative control)", () => {
    expect(findShareSumViolations(GREENWAY_RATE_ROWS)).toEqual([]);
  });

  it("catches a split that does not reach the whole premium", () => {
    // Somebody updates the employee share and forgets the employer one. Nothing
    // else in the system would notice; the paycheck would still balance.
    const p = findShareSumViolations([
      row({ key: "pfml_employee_share_of_total", value: 72_000 }),
      row({ key: "pfml_employer_share_of_total", value: 28_570 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("100_000");
  });

  it("catches a split that overshoots", () => {
    expect(
      findShareSumViolations([
        row({ key: "pfml_employee_share_of_total", value: 71_430 }),
        row({ key: "pfml_employer_share_of_total", value: 30_000 }),
      ]),
    ).toHaveLength(1);
  });

  it("only compares rows whose dates actually overlap", () => {
    // A 2025 employee share and a 2026 employer share never coexist, so they
    // are not required to sum. Getting this wrong would produce false alarms
    // every January and train Michael to ignore the check.
    expect(
      findShareSumViolations([
        row({
          key: "pfml_employee_share_of_total",
          effectiveFrom: "2025-01-01",
          effectiveTo: "2025-12-31",
          value: 71_520,
        }),
        row({
          key: "pfml_employer_share_of_total",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          value: 28_570,
        }),
      ]),
    ).toEqual([]);
  });

  it("does compare rows that share even a single day", () => {
    expect(
      findShareSumViolations([
        row({
          key: "pfml_employee_share_of_total",
          effectiveFrom: "2025-01-01",
          effectiveTo: "2026-01-01",
          value: 71_520,
        }),
        row({
          key: "pfml_employer_share_of_total",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          value: 28_570,
        }),
      ]),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7) CONSTRUCTION - refuse to build rather than build something wrong
// ---------------------------------------------------------------------------

describe("PayrollRateRegistry.create", () => {
  it("builds from valid rows (negative control)", () => {
    expect(() => PayrollRateRegistry.create([row()])).not.toThrow();
  });

  it("builds from an empty table", () => {
    // Legitimate: a fresh install has no rates yet. Every lookup then refuses,
    // which is the correct behaviour, not a crash.
    const r = PayrollRateRegistry.create([]);
    expect(r.all()).toEqual([]);
    expect(mustRefuse(r.lookup("pfml_total", "2026-01-01")).code).toBe(
      "rate_not_evidenced_for_date",
    );
  });

  it("throws on an overlap, naming both rows", () => {
    expect(() =>
      PayrollRateRegistry.create([
        row({ effectiveFrom: "2025-01-01", effectiveTo: null, value: 920 }),
        row({ effectiveFrom: "2026-01-01", effectiveTo: null }),
      ]),
    ).toThrow(/never ends/);
  });

  it("throws on a malformed row", () => {
    expect(() => PayrollRateRegistry.create([row({ value: -5 })])).toThrow(/cannot be negative/);
    expect(() => PayrollRateRegistry.create([row({ documentId: "" })])).toThrow(/documentId/);
  });

  it("throws on a rate above the statutory ceiling", () => {
    expect(() => PayrollRateRegistry.create([row({ value: 11_300 })])).toThrow(/statutory/);
  });

  it("throws on a broken PFML share pair", () => {
    expect(() =>
      PayrollRateRegistry.create([
        row({ key: "pfml_employee_share_of_total", value: 71_430 }),
        row({ key: "pfml_employer_share_of_total", value: 28_000 }),
      ]),
    ).toThrow(/must total exactly/);
  });

  it("reports ALL problems at once, not just the first", () => {
    // Fixing one error, rebuilding, and finding the next is how people give up
    // halfway and leave a table half-corrected.
    let msg = "";
    try {
      PayrollRateRegistry.create([row({ value: -1 }), row({ key: "nope" as PayrollRateKey })]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("2 problem(s)");
    expect(msg).toContain("cannot be negative");
    expect(msg).toContain("unknown rate key");
  });

  it("copies its input, so mutating the caller's array cannot change the table", () => {
    const rows = [row()];
    const reg = PayrollRateRegistry.create(rows);
    rows.push(row({ effectiveFrom: "2026-06-01", value: 999 }));
    expect(reg.all()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8) LOOKUP - the only door in, and it must not have a back door
// ---------------------------------------------------------------------------

describe("PayrollRateRegistry.lookup", () => {
  const reg = PayrollRateRegistry.create([
    row({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", value: 920 }),
    row({ effectiveFrom: "2026-01-01", effectiveTo: null, value: 1_130 }),
  ]);

  it("returns the row in force on the date (negative control)", () => {
    expect(mustGet(reg.lookup("pfml_total", "2025-06-15")).value).toBe(920);
    expect(mustGet(reg.lookup("pfml_total", "2026-06-15")).value).toBe(1_130);
  });

  it("lands on the correct side of the year boundary TO THE DAY", () => {
    // The one-day test. December 31 is still last year's rate; January 1 is the
    // new one. An exclusive effectiveTo would break exactly one day a year and
    // would be found in an audit, not in testing.
    expect(mustGet(reg.lookup("pfml_total", "2025-12-31")).value).toBe(920);
    expect(mustGet(reg.lookup("pfml_total", "2026-01-01")).value).toBe(1_130);
    expect(mustGet(reg.lookup("pfml_total", "2025-12-31")).value).not.toBe(1_130);
    expect(mustGet(reg.lookup("pfml_total", "2026-01-01")).value).not.toBe(920);
  });

  it("treats both endpoints as inclusive", () => {
    expect(mustGet(reg.lookup("pfml_total", "2025-01-01")).value).toBe(920);
    expect(mustGet(reg.lookup("pfml_total", "2025-12-31")).value).toBe(920);
  });

  it("REFUSES before the first row instead of reaching backwards", () => {
    // The whole design rests on this. A 2024 pay period must not silently get
    // the 2025 rate.
    const ref = mustRefuse(reg.lookup("pfml_total", "2024-12-31"));
    expect(ref.code).toBe("rate_not_evidenced_for_date");
    expect(ref.message).toContain("2024-12-31");
    expect(ref.message).toContain("2025-01-01 to 2025-12-31");
    expect(ref.whatToDo).toContain("2024-12-31");
  });

  it("REFUSES inside a gap instead of reaching for the nearest row", () => {
    const gapped = PayrollRateRegistry.create([
      row({ effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31", value: 740 }),
      row({ effectiveFrom: "2026-01-01", effectiveTo: null, value: 1_130 }),
    ]);
    const ref = mustRefuse(gapped.lookup("pfml_total", "2025-07-01"));
    expect(ref.code).toBe("rate_not_evidenced_for_date");
    // It must not have quietly answered with either neighbour.
    expect(ref.message).toContain("2025-07-01");
  });

  it("REFUSES for a key with no rows at all, and says so plainly", () => {
    const ref = mustRefuse(reg.lookup("lni_employee_rate", "2026-06-15"));
    expect(ref.code).toBe("rate_not_evidenced_for_date");
    expect(ref.message).toContain("no rate on file");
  });

  it("REFUSES a date that is not a real date", () => {
    for (const bad of ["2026-02-30", "2025-02-29", "06/15/2026", "", "tomorrow"]) {
      const ref = mustRefuse(reg.lookup("pfml_total", bad));
      expect(ref.code).toBe("rate_registry_malformed");
      expect(ref.whatToDo).toContain("YYYY-MM-DD");
    }
  });

  it("explains itself in plain English with no jargon (rule for Michael)", () => {
    const ref = mustRefuse(reg.lookup("pfml_total", "2024-01-01"));
    expect(ref.message).toContain("WA Paid Leave total premium rate");
    expect(ref.message.length).toBeGreaterThan(80);
    expect(ref.whatToDo.length).toBeGreaterThan(20);
    // No identifier leakage into a message Michael reads.
    expect(ref.message).not.toContain("undefined");
    expect(ref.message).not.toContain("[object");
    expect(ref.message).not.toContain("pfml_total");
  });

  it("has no current(), latest(), or default escape hatch (rule 14)", () => {
    // Those three functions are precisely how a January catch-up run computes a
    // December paycheck with the new year's rate. They must not exist.
    const anyReg = reg as unknown as Record<string, unknown>;
    expect(anyReg.current).toBeUndefined();
    expect(anyReg.latest).toBeUndefined();
    expect(anyReg.now).toBeUndefined();
    expect(anyReg.getOrDefault).toBeUndefined();
  });

  it("sweeps every day across the boundary and finds exactly one change (rule 15b)", () => {
    // 60 days, Dec 2 2025 through Jan 30 2026. Exactly one transition, on the
    // right day. A sweep catches an off-by-one that two spot checks can miss.
    const seen: Array<{ d: string; v: number }> = [];
    let d = "2025-12-02";
    for (let i = 0; i < 60; i++) {
      seen.push({ d, v: mustGet(reg.lookup("pfml_total", d)).value });
      d = addDays(d, 1);
    }
    const changes = seen.filter((s, i) => i > 0 && s.v !== seen[i - 1]!.v);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.d).toBe("2026-01-01");
    expect(new Set(seen.map((s) => s.v))).toEqual(new Set([920, 1_130]));
  });
});

// ---------------------------------------------------------------------------
// 9) UNIT SAFETY - the 1000x error
// ---------------------------------------------------------------------------

describe("PayrollRateRegistry.lookupValue", () => {
  it("returns the raw integer when the unit matches (negative control)", () => {
    expect(mustGet(GREENWAY_RATES.lookupValue("pfml_total", "2026-03-01", "milli_percent"))).toBe(
      1_130,
    );
  });

  it("REFUSES a unit mismatch rather than converting", () => {
    // 1_130 is plausible as milli-percent, as cents ($11.30), and as milli-cents
    // per hour. Converting on a guess is a thousandfold error that looks fine.
    const ref = mustRefuse(GREENWAY_RATES.lookupValue("pfml_total", "2026-03-01", "cents"));
    expect(ref.code).toBe("rate_registry_malformed");
    expect(ref.message).toContain("milli_percent");
    expect(ref.message).toContain("cents");
    expect(ref.authorityId).toBe("esd-pfml-2026-rate-announcement");
  });

  it("refuses every wrong unit for every real row, and accepts the right one", () => {
    // Full sweep of the actual table: 3 units x every row. Exactly one must pass.
    const units = ["milli_percent", "milli_cents_per_hour", "cents"] as const;
    let accepted = 0;
    let refused = 0;
    for (const r of GREENWAY_RATE_ROWS) {
      for (const u of units) {
        const res = GREENWAY_RATES.lookupValue(r.key, r.effectiveFrom, u);
        if (u === r.unit) {
          expect(res.ok).toBe(true);
          accepted++;
        } else {
          expect(res.ok).toBe(false);
          refused++;
        }
      }
    }
    expect(accepted).toBe(GREENWAY_RATE_ROWS.length);
    expect(refused).toBe(GREENWAY_RATE_ROWS.length * 2);
  });

  it("passes a date refusal straight through without masking it", () => {
    const ref = mustRefuse(GREENWAY_RATES.lookupValue("pfml_total", "2019-01-01", "milli_percent"));
    expect(ref.code).toBe("rate_not_evidenced_for_date");
  });
});

// ---------------------------------------------------------------------------
// 10) HISTORY - the audit trail
// ---------------------------------------------------------------------------

describe("PayrollRateRegistry.history", () => {
  it("returns rows oldest first", () => {
    const reg = PayrollRateRegistry.create([
      row({ effectiveFrom: "2026-01-01", effectiveTo: null, value: 1_130 }),
      row({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", value: 920 }),
    ]);
    const h = reg.history("pfml_total");
    expect(h.map((r) => r.value)).toEqual([920, 1_130]);
  });

  it("keeps superseded rows, so a prior quarter recomputes correctly", () => {
    // Amended returns are the reason old rows are never deleted.
    expect(GREENWAY_RATES.history("pfml_total").length).toBeGreaterThanOrEqual(2);
    expect(mustGet(GREENWAY_RATES.lookup("pfml_total", "2025-08-15")).value).toBe(920);
  });

  it("returns empty for a key with no rows, never throws", () => {
    expect(PayrollRateRegistry.create([]).history("wa_cares_total")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11) GREENWAY'S REAL TABLE - the facts, checked against the documents
// ---------------------------------------------------------------------------

describe("Greenway's actual 2026 rates", () => {
  it("builds without throwing - the import itself is the test", () => {
    expect(GREENWAY_RATES.all().length).toBe(GREENWAY_RATE_ROWS.length);
    expect(GREENWAY_RATE_ROWS.length).toBeGreaterThan(0);
  });

  it("has PFML at 1.13% for 2026 and 0.92% for 2025 (ESD 2025-10-29)", () => {
    expect(mustGet(GREENWAY_RATES.lookup("pfml_total", "2026-01-01")).value).toBe(1_130);
    expect(mustGet(GREENWAY_RATES.lookup("pfml_total", "2025-12-31")).value).toBe(920);
  });

  it("splits PFML 71.43 / 28.57 and the two total exactly 100%", () => {
    const ee = mustGet(
      GREENWAY_RATES.lookupValue("pfml_employee_share_of_total", "2026-06-01", "milli_percent"),
    );
    const er = mustGet(
      GREENWAY_RATES.lookupValue("pfml_employer_share_of_total", "2026-06-01", "milli_percent"),
    );
    expect(ee).toBe(71_430);
    expect(er).toBe(28_570);
    expect(ee + er).toBe(100_000);
  });

  it("has WA Cares at 0.58% with NO wage base key in existence", () => {
    expect(mustGet(GREENWAY_RATES.lookup("wa_cares_total", "2026-06-01")).value).toBe(580);
    // WA Cares is uncapped. A wage-base key would invite someone to fill it in
    // with the PFML ceiling and under-withhold every high earner.
    expect(ALL_PAYROLL_RATE_KEYS).not.toContain("wa_cares_wage_base" as PayrollRateKey);
  });

  it("has no separate PFML wage base, because the statute points at Social Security", () => {
    // RCW 50A.10.030(4) sets the PFML cap "equal to the maximum wages subject to
    // taxation for social security". Two rows for one legal number is one row
    // too many.
    expect(ALL_PAYROLL_RATE_KEYS).not.toContain("pfml_wage_base" as PayrollRateKey);
    expect(mustGet(GREENWAY_RATES.lookupValue("fica_oasdi_wage_base", "2026-06-01", "cents"))).toBe(
      18_450_000,
    );
  });

  it("has L&I in milli-cents per hour, both sides read off the notice", () => {
    // books-14 defect: the employee share used to be derived as half the medical
    // aid rate, giving $0.067185/hr against a true $0.16445/hr. Never derived now.
    const ee = mustGet(
      GREENWAY_RATES.lookupValue("lni_employee_rate", "2026-06-01", "milli_cents_per_hour"),
    );
    const er = mustGet(
      GREENWAY_RATES.lookupValue("lni_employer_rate", "2026-06-01", "milli_cents_per_hour"),
    );
    expect(ee).toBe(16_445);
    expect(er).toBe(39_485);
    // Together they must equal the total premium printed on the notice.
    expect(ee + er).toBe(55_930);
    // And the employee share must NOT be half - that is the bug we fixed.
    expect(ee).not.toBe(Math.round((ee + er) / 2));
  });

  it("has SUTA at 0.40% on a $78,200 base for 2026", () => {
    expect(mustGet(GREENWAY_RATES.lookupValue("wa_suta_total", "2026-06-01", "milli_percent"))).toBe(
      400,
    );
    expect(
      mustGet(GREENWAY_RATES.lookupValue("wa_suta_wage_base", "2026-06-01", "cents")),
    ).toBe(7_820_000);
  });

  it("REFUSES every 2027 rate, because no 2027 notice has arrived", () => {
    // This is the behaviour Michael will actually meet, next January. It must
    // refuse loudly rather than reuse 2026 - and the message must tell him to
    // go get the notice.
    for (const key of ["wa_suta_total", "lni_employee_rate", "fica_oasdi_wage_base"] as const) {
      const ref = mustRefuse(GREENWAY_RATES.lookup(key, "2027-01-01"));
      expect(ref.code).toBe("rate_not_evidenced_for_date");
      expect(ref.whatToDo.toLowerCase()).toContain("notice");
    }
  });

  it("every row cites an authority that actually exists (rule 1 - no invented ids)", () => {
    // An authorityId that resolves to nothing is a citation to a document that
    // was never read. Silent, and fatal to the whole evidence chain.
    const known = new Set(PAYROLL_TAX_AUTHORITIES.map((a) => a.id));
    for (const r of GREENWAY_RATE_ROWS) {
      expect(known.has(r.authorityId)).toBe(true);
    }
    expect(known.size).toBe(PAYROLL_TAX_AUTHORITIES.length); // no duplicate ids
  });

  it("every row carries a document and a readable note (rule 11)", () => {
    for (const r of GREENWAY_RATE_ROWS) {
      expect(r.documentId.trim().length).toBeGreaterThan(3);
      expect(r.note.trim().length).toBeGreaterThan(30);
    }
  });

  it("has no overlaps and no interior gaps", () => {
    expect(findRateOverlaps(GREENWAY_RATE_ROWS)).toEqual([]);
    expect(findRateGaps(GREENWAY_RATE_ROWS)).toEqual([]);
  });

  it("stores every value as a non-negative integer (rule 13e)", () => {
    for (const r of GREENWAY_RATE_ROWS) {
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      // Belt and braces: a float that happens to be integral would pass
      // Number.isInteger, so also confirm no precision was lost.
      expect(String(r.value)).not.toContain(".");
    }
  });
});

// ---------------------------------------------------------------------------
// 12) HOSTILE INPUT AND WIRING
// ---------------------------------------------------------------------------

describe("hostile input (rule 13f)", () => {
  const reg = PayrollRateRegistry.create([row()]);

  it("survives absurd dates without throwing", () => {
    for (const bad of [
      "9999-12-31",
      "0001-01-01",
      "2026-01-01\u0000",
      "2026-01-01<script>",
      "٢٠٢٦-٠١-٠١", // Arabic-Indic digits
      "2026-01-01;DROP TABLE",
    ]) {
      expect(() => reg.lookup("pfml_total", bad)).not.toThrow();
    }
  });

  it("refuses rather than crashing on null and undefined dates", () => {
    expect(() =>
      reg.lookup("pfml_total", null as unknown as string),
    ).not.toThrow();
    expect(reg.lookup("pfml_total", undefined as unknown as string).ok).toBe(false);
  });

  it("refuses an unknown key at lookup instead of returning something", () => {
    expect(reg.lookup("not_a_key" as PayrollRateKey, "2026-06-01").ok).toBe(false);
  });

  it("describeKey covers every key with no fallthrough", () => {
    // A missing case would return undefined and put "undefined" in a refusal
    // message Michael reads.
    for (const k of ALL_PAYROLL_RATE_KEYS) {
      const d = describeKey(k);
      expect(typeof d).toBe("string");
      expect(d.length).toBeGreaterThan(5);
      expect(d).not.toContain("_");
    }
    expect(new Set(ALL_PAYROLL_RATE_KEYS.map(describeKey)).size).toBe(
      ALL_PAYROLL_RATE_KEYS.length,
    );
  });

  it("has no duplicate keys in ALL_PAYROLL_RATE_KEYS", () => {
    expect(new Set(ALL_PAYROLL_RATE_KEYS).size).toBe(ALL_PAYROLL_RATE_KEYS.length);
  });
});

describe("the gate is wired (rule 16)", () => {
  it("proves construction validation actually runs, not just exists", () => {
    // Rule 16: a gate that is never called is decoration. This is the proof
    // that create() reaches validateRateRow, findRateOverlaps,
    // findCeilingViolations and findShareSumViolations - one deliberate
    // violation of each, each caught.
    const cases: Array<[string, PayrollRateRow[], RegExp]> = [
      ["malformed", [row({ value: -1 })], /cannot be negative/],
      [
        "overlap",
        [row({ effectiveTo: null }), row({ effectiveFrom: "2026-06-01", effectiveTo: null })],
        /never ends/,
      ],
      ["ceiling", [row({ value: 50_000 })], /statutory/],
      [
        "share sum",
        [
          row({ key: "pfml_employee_share_of_total", value: 50_000 }),
          row({ key: "pfml_employer_share_of_total", value: 40_000 }),
        ],
        /must total exactly/,
      ],
    ];
    for (const [name, rows, re] of cases) {
      let threw = false;
      try {
        PayrollRateRegistry.create(rows);
      } catch (e) {
        threw = true;
        expect((e as Error).message, name).toMatch(re);
      }
      expect(threw, `${name} must be rejected at construction`).toBe(true);
    }
  });
});
