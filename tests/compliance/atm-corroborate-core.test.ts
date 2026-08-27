/**
 * tests/compliance/atm-corroborate-core.test.ts   (books-69 step 3)
 *
 * TWO PAYMENT ALLIANCE REPORTS OF THE SAME MONEY.
 *
 * Payment Alliance publishes Michael's ATM period twice, and the two versions
 * do not agree. Measured from his own 2026-05-01..2026-08-23 exports:
 *
 *                        Surcharge      Transaction
 *     Funds Movement     16,272.50       526,620.00
 *     Daily Settlement   16,267.50       526,520.00
 *
 * The entire difference is four adjustment rows on three days, which only the
 * Funds Movement report carries. These tests hold the line on three things:
 *
 *   1. an explained correction is distinguished from an unexplained difference,
 *   2. the primary report stays authoritative even when nothing explains a
 *      difference, and
 *   3. the choice between the two sources is RECORDED rather than made silently
 *      the way `planSettlementUpserts` used to make it.
 */

import { describe, expect, it } from "vitest";

import {
  mapFundsMovementCsv,
  mapSimpleSummaryCsv,
  type FundsMovementRow,
  type SettlementRow,
} from "@/lib/atm/atm-core";
import {
  agreementNeedsAttention,
  compareReports,
  daysNeedingAttention,
  summariseCorroboration,
} from "@/lib/atm/atm-corroborate-core";
import { planSettlementUpserts, summarizeIngest, ingestResultMessage } from "@/lib/atm/atm-sync-core";

/* ── fixtures shaped exactly like the verified mappers emit ───────────────── */

function fm(
  settlementDate: string,
  txnCents: number | null,
  surchargeCents: number | null,
  transactionLegCount: number,
  surchargeLegCount: number,
): FundsMovementRow {
  return {
    terminalId: "HG26499",
    settlementDate,
    terminalTransactionCents: txnCents,
    surchargeCents,
    accountTail: "******6228",
    legCount: transactionLegCount + surchargeLegCount,
    transactionLegCount,
    surchargeLegCount,
  };
}

function ds(
  settlementDate: string,
  settlementTotalCents: number | null,
  surchargeCents: number | null,
): SettlementRow {
  return {
    terminalId: "HG26499",
    settlementDate,
    totalTrx: null,
    withdrawalTrx: null,
    surchargedWdTrx: null,
    terminalTransactionCents: null,
    surchargeCents,
    settlementTotalCents,
    raw: {},
  };
}

/**
 * Michael's REAL rows for the three disagreeing days plus one clean day, copied
 * from "Funds Movement By Account By Day 5.1.26-8.23.26.csv" and
 * "ATM Daily Settlement Report 5.1.26-8.23.26.csv".
 */
const FM_CSV_HEADER =
  '"Market Partner Code","Market Partner","Acct #","Group","Location",' +
  '"Settlement Date","Terminal","Settlement Type","Amount"\r\n';

function fmCsvRow(date: string, type: string, amount: string): string {
  return (
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS",' +
    `"${date}","HG26499","${type}","${amount}"\r\n`
  );
}

const REAL_FM_CSV =
  FM_CSV_HEADER +
  // 2026-05-01: a clean day. Both reports match to the cent.
  fmCsvRow("5/1/26", "Transaction", "$6,160.00") +
  fmCsvRow("5/1/26", "Surcharge", "$145.00") +
  // 2026-06-27: a NEGATIVE correction on the transaction leg.
  fmCsvRow("6/27/26", "Transaction", "$3,060.00") +
  fmCsvRow("6/27/26", "Surcharge", "$107.50") +
  fmCsvRow("6/27/26", "Transaction", "-$100.00") +
  // 2026-07-02: corrections on BOTH legs.
  fmCsvRow("7/2/26", "Transaction", "$4,980.00") +
  fmCsvRow("7/2/26", "Surcharge", "$157.50") +
  fmCsvRow("7/2/26", "Transaction", "$100.00") +
  fmCsvRow("7/2/26", "Surcharge", "$5.00") +
  // 2026-07-09: a positive correction on the transaction leg only.
  fmCsvRow("7/9/26", "Transaction", "$2,500.00") +
  fmCsvRow("7/9/26", "Transaction", "$100.00") +
  fmCsvRow("7/9/26", "Surcharge", "$92.50");

const REAL_DS_CSV =
  '"Terminal","Location","Settlement Date","Total Trxs","WD Trxs","Surcharge WDs","Surch","Settlement"\r\n' +
  '"HG26499","CASCADE GENERAL PARTNERS","5/1/26","63","58","58","$145.00","$6,160.00"\r\n' +
  '"HG26499","CASCADE GENERAL PARTNERS","6/27/26","47","43","43","$107.50","$3,060.00"\r\n' +
  '"HG26499","CASCADE GENERAL PARTNERS","7/2/26","67","63","63","$157.50","$4,980.00"\r\n' +
  '"HG26499","CASCADE GENERAL PARTNERS","7/9/26","44","37","37","$92.50","$2,500.00"\r\n';

/* ═════════════════════════════════════════════════════════════════════════
 * 1. THE REAL REPORTS, END TO END THROUGH THE VERIFIED MAPPERS
 * ═════════════════════════════════════════════════════════════════════════ */

describe("the two real Payment Alliance reports, compared", () => {
  const fmRows = mapFundsMovementCsv(REAL_FM_CSV);
  const dsRows = mapSimpleSummaryCsv(REAL_DS_CSV);
  const cmp = compareReports(fmRows.rows, dsRows.rows);

  it("parses both real exports with no problems, so the comparison is on real data", () => {
    expect(fmRows.problems).toHaveLength(0);
    expect(dsRows.problems).toHaveLength(0);
    expect(fmRows.rows).toHaveLength(4);
    expect(dsRows.rows).toHaveLength(4);
  });

  it("finds the clean day identical and the three known days different", () => {
    const byDate = new Map(cmp.map((c) => [c.settlementDate, c]));
    expect(byDate.get("2026-05-01")?.agreement).toBe("agreed");
    expect(byDate.get("2026-06-27")?.agreement).toBe("adjusted");
    expect(byDate.get("2026-07-02")?.agreement).toBe("adjusted");
    expect(byDate.get("2026-07-09")?.agreement).toBe("adjusted");
  });

  it("nets the -$100.00 reversal into 2026-06-27 rather than dropping or absolutising it", () => {
    const d = cmp.find((c) => c.settlementDate === "2026-06-27");
    // $3,060.00 + (-$100.00) = $2,960.00. Dropping the row would give $3,060.00
    // and taking its absolute value would give $3,160.00.
    expect(d?.primaryTransactionCents).toBe(296_000);
    expect(d?.transactionDiffCents).toBe(-10_000);
  });

  it("nets both corrections on 2026-07-02", () => {
    const d = cmp.find((c) => c.settlementDate === "2026-07-02");
    expect(d?.primaryTransactionCents).toBe(508_000); // $4,980 + $100
    expect(d?.primarySurchargeCents).toBe(16_250); // $157.50 + $5.00
    expect(d?.transactionDiffCents).toBe(10_000);
    expect(d?.surchargeDiffCents).toBe(500);
  });

  it("raises none of the three for attention, because every one is explained", () => {
    expect(daysNeedingAttention(cmp)).toHaveLength(0);
  });

  it("reports the primary totals, which are the ones the books use", () => {
    const s = summariseCorroboration(cmp);
    // $6,160.00 + $2,960.00 + $5,080.00 + $2,600.00 = $16,800.00
    expect(s.primaryTransactionCents).toBe(1_680_000);
    // $145.00 + $107.50 + $162.50 + $92.50 = $507.50
    expect(s.primarySurchargeCents).toBe(50_750);
    // The corroborating report, for contrast: $6,160 + $3,060 + $4,980 + $2,500.
    expect(s.secondaryTransactionCents).toBe(1_670_000);
    expect(s.agreed).toBe(1);
    expect(s.adjusted).toBe(3);
    expect(s.unexplained).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 2. EXPLAINED VS UNEXPLAINED - THE JUDGEMENT THAT MATTERS
 * ═════════════════════════════════════════════════════════════════════════ */

describe("an explained correction is not the same thing as an unexplained difference", () => {
  it("calls a difference with a correction row behind it adjusted", () => {
    const cmp = compareReports([fm("2026-06-27", 296_000, 10_750, 2, 1)], [ds("2026-06-27", 306_000, 10_750)]);
    expect(cmp[0]?.agreement).toBe("adjusted");
    expect(agreementNeedsAttention("adjusted")).toBe(false);
  });

  it("calls a difference with NO correction row unexplained, and says so in plain English", () => {
    const cmp = compareReports([fm("2026-06-28", 100_000, 0, 1, 1)], [ds("2026-06-28", 105_000, 0)]);
    expect(cmp[0]?.agreement).toBe("unexplained");
    expect(cmp[0]?.explanation).toContain("has NOT been accounted for");
    expect(agreementNeedsAttention("unexplained")).toBe(true);
  });

  it("does not let a corrected transaction leg vouch for an unexplained surcharge difference", () => {
    // This is 2026-06-27's real shape - two transaction rows, ONE surcharge row -
    // with a surcharge difference added. Judging the day as a whole would call
    // this explained; judging the differing leg calls it what it is.
    const cmp = compareReports([fm("2026-06-27", 296_000, 10_750, 2, 1)], [ds("2026-06-27", 306_000, 10_000)]);
    expect(cmp[0]?.agreement).toBe("unexplained");
  });

  it("does not let a corrected surcharge leg vouch for an unexplained transaction difference", () => {
    const cmp = compareReports([fm("2026-06-27", 296_000, 10_750, 1, 2)], [ds("2026-06-27", 306_000, 10_750)]);
    expect(cmp[0]?.agreement).toBe("unexplained");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 3. THE PRIMARY STAYS AUTHORITATIVE
 * ═════════════════════════════════════════════════════════════════════════ */

describe("the report the books are built on stays authoritative", () => {
  it("keeps the primary figure on an UNEXPLAINED day, because a question is not a reason to switch sources", () => {
    const cmp = compareReports([fm("2026-06-28", 100_000, 0, 1, 1)], [ds("2026-06-28", 105_000, 0)]);
    expect(cmp[0]?.agreement).toBe("unexplained");
    expect(cmp[0]?.authoritativeTransactionCents).toBe(100_000);
    expect(cmp[0]?.authoritativeSurchargeCents).toBe(0);
  });

  it("keeps the corrected figure on an adjusted day, not the uncorrected one", () => {
    const cmp = compareReports([fm("2026-06-27", 296_000, 10_750, 2, 1)], [ds("2026-06-27", 306_000, 10_750)]);
    expect(cmp[0]?.authoritativeTransactionCents).toBe(296_000);
  });

  it("invents NO primary figure for a day only the corroborating report has", () => {
    const cmp = compareReports([], [ds("2026-08-24", 500, 25)]);
    expect(cmp[0]?.agreement).toBe("secondary_only");
    expect(cmp[0]?.authoritativeTransactionCents).toBeNull();
    expect(cmp[0]?.authoritativeSurchargeCents).toBeNull();
    // But the corroborating figures are still shown, so the day can be chased.
    expect(cmp[0]?.secondaryTransactionCents).toBe(500);
  });

  it("keeps both figures on every disagreement, so the rejected one stays readable", () => {
    const cmp = compareReports([fm("2026-07-02", 508_000, 16_250, 2, 2)], [ds("2026-07-02", 498_000, 15_750)]);
    expect(cmp[0]?.primarySurchargeCents).toBe(16_250);
    expect(cmp[0]?.secondarySurchargeCents).toBe(15_750);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 4. THE UNION, NOT THE INTERSECTION
 * ═════════════════════════════════════════════════════════════════════════ */

describe("a day present in only one report does not vanish", () => {
  it("keeps a day only the primary has, and treats it as normal", () => {
    const cmp = compareReports([fm("2026-08-24", 500, 25, 1, 1)], []);
    expect(cmp).toHaveLength(1);
    expect(cmp[0]?.agreement).toBe("primary_only");
    expect(agreementNeedsAttention("primary_only")).toBe(false);
  });

  it("keeps a day only the corroborating report has, and RAISES it", () => {
    const cmp = compareReports([], [ds("2026-08-24", 500, 25)]);
    expect(cmp).toHaveLength(1);
    expect(cmp[0]?.agreement).toBe("secondary_only");
    expect(agreementNeedsAttention("secondary_only")).toBe(true);
    expect(cmp[0]?.explanation).toContain("missing from");
  });

  it("compares the union when each report has a day the other lacks", () => {
    const cmp = compareReports([fm("2026-08-24", 500, 25, 1, 1)], [ds("2026-08-25", 700, 30)]);
    // An intersection would return zero rows here and look like a clean run.
    expect(cmp.map((c) => c.settlementDate)).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("returns days in date order", () => {
    const cmp = compareReports(
      [fm("2026-07-09", 1, 1, 1, 1), fm("2026-05-01", 1, 1, 1, 1), fm("2026-06-27", 1, 1, 1, 1)],
      [],
    );
    expect(cmp.map((c) => c.settlementDate)).toEqual(["2026-05-01", "2026-06-27", "2026-07-09"]);
  });

  it("does not merge two terminals on the same date into one comparison", () => {
    const a = fm("2026-08-24", 500, 25, 1, 1);
    const b = { ...fm("2026-08-24", 900, 40, 1, 1), terminalId: "HG99999" };
    const cmp = compareReports([a, b], []);
    expect(cmp).toHaveLength(2);
    expect(new Set(cmp.map((c) => c.terminalId))).toEqual(new Set(["HG26499", "HG99999"]));
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 5. A MISSING FIGURE IS NOT A ZERO
 * ═════════════════════════════════════════════════════════════════════════ */

describe("a column a report never carried is not treated as a zero balance", () => {
  it("reports no difference rather than a false one when the secondary lacks the figure", () => {
    const cmp = compareReports([fm("2026-06-29", 100_000, 250, 1, 1)], [ds("2026-06-29", null, 250)]);
    // null - 100000 would have manufactured a $1,000.00 disagreement.
    expect(cmp[0]?.transactionDiffCents).toBeNull();
    expect(cmp[0]?.agreement).toBe("agreed");
  });

  it("reports no difference when the primary lacks the figure", () => {
    const cmp = compareReports([fm("2026-06-29", null, 250, 0, 1)], [ds("2026-06-29", 100_000, 250)]);
    expect(cmp[0]?.transactionDiffCents).toBeNull();
  });

  it("still compares the leg that IS present on both sides", () => {
    const cmp = compareReports([fm("2026-06-29", 100_000, 250, 1, 1)], [ds("2026-06-29", null, 500)]);
    expect(cmp[0]?.surchargeDiffCents).toBe(-250);
    expect(cmp[0]?.agreement).toBe("unexplained");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 6. NOTHING HERE POSTS ANYTHING
 * ═════════════════════════════════════════════════════════════════════════ */

describe("comparing the reports moves no money", () => {
  it("returns only comparisons - no journal, no lines, no posting flag", () => {
    const cmp = compareReports([fm("2026-07-02", 508_000, 16_250, 2, 2)], [ds("2026-07-02", 498_000, 15_750)]);
    const c = cmp[0] as unknown as Record<string, unknown>;
    expect(c).not.toHaveProperty("lines");
    expect(c).not.toHaveProperty("journal");
    expect(c).not.toHaveProperty("postable");
    expect(c).not.toHaveProperty("entity");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 7. THE SUMMARY SENTENCE
 * ═════════════════════════════════════════════════════════════════════════ */

describe("the summary Michael reads", () => {
  it("says there is nothing to compare when a report has not been loaded", () => {
    const s = summariseCorroboration([]);
    expect(s.days).toBe(0);
    expect(s.sentence).toContain("nothing to compare");
  });

  it("names the report the books use, and states its totals", () => {
    const cmp = compareReports([fm("2026-07-02", 508_000, 16_250, 2, 2)], [ds("2026-07-02", 498_000, 15_750)]);
    const s = summariseCorroboration(cmp);
    expect(s.sentence).toContain("Funds Movement");
    expect(s.sentence).toContain("$5,080.00");
    expect(s.sentence).toContain("$162.50");
  });

  it("says nothing needs attention when every difference is explained", () => {
    const cmp = compareReports([fm("2026-07-02", 508_000, 16_250, 2, 2)], [ds("2026-07-02", 498_000, 15_750)]);
    expect(summariseCorroboration(cmp).sentence).toContain("Nothing needs your attention");
  });

  it("counts and names the days that do need attention", () => {
    const cmp = compareReports([fm("2026-06-28", 100_000, 0, 1, 1)], [ds("2026-06-28", 105_000, 0)]);
    const s = summariseCorroboration(cmp);
    expect(s.needsAttention).toBe(1);
    expect(s.sentence).toContain("1 day needs your attention");
  });

  it("counts an adjusted day separately from an unexplained one", () => {
    const cmp = compareReports(
      [fm("2026-06-27", 296_000, 10_750, 2, 1), fm("2026-06-28", 100_000, 0, 1, 1)],
      [ds("2026-06-27", 306_000, 10_750), ds("2026-06-28", 105_000, 0)],
    );
    const s = summariseCorroboration(cmp);
    expect(s.adjusted).toBe(1);
    expect(s.unexplained).toBe(1);
    expect(s.needsAttention).toBe(1);
  });

  it("renders a negative total with a real minus rather than $-", () => {
    // Reachable: the Funds Movement report carries reversal rows, so a period
    // whose only surcharge row is a reversal nets negative.
    const cmp = compareReports([fm("2026-06-27", -10_000, -500, 1, 1)], []);
    const s = summariseCorroboration(cmp);
    expect(s.sentence).toContain("\u2212$100.00");
    expect(s.sentence).not.toContain("$-100.00");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * 8. THE SILENT PREFERENCE THIS REPLACES
 * ═════════════════════════════════════════════════════════════════════════ */

describe("the ingest no longer discards a disagreement without saying so", () => {
  const ssRows = [ds("2026-07-02", 498_000, 15_750)];
  const fmRows = [fm("2026-07-02", 508_000, 16_250, 2, 2)];

  it("still prefers the Funds Movement surcharge, which was always the right call", () => {
    const plan = planSettlementUpserts(ssRows, fmRows);
    expect(plan.upserts[0].surcharge_cents).toBe(16_250);
  });

  it("but now records that the two reports disagreed on that day", () => {
    const plan = planSettlementUpserts(ssRows, fmRows);
    expect(plan.corroboration).toHaveLength(1);
    expect(plan.corroboration[0].agreement).not.toBe("agreed");
    expect(plan.corroboration[0].secondarySurchargeCents).toBe(15_750);
  });

  it("stays quiet in the result message when the difference is explained", () => {
    const plan = planSettlementUpserts(ssRows, fmRows);
    const sum = summarizeIngest({ settlementPlan: plan });
    expect(sum.corroborationAttention).toHaveLength(0);
    expect(ingestResultMessage(sum)).not.toContain("nothing in the files explains why");
  });

  it("names the day in the result message when nothing explains the difference", () => {
    const plan = planSettlementUpserts(
      [ds("2026-07-03", 100_000, 5_000)],
      [fm("2026-07-03", 105_000, 5_000, 1, 1)],
    );
    const sum = summarizeIngest({ settlementPlan: plan });
    expect(sum.corroborationAttention).toHaveLength(1);
    expect(ingestResultMessage(sum)).toContain("2026-07-03");
    expect(ingestResultMessage(sum)).toContain("nothing in the files explains why");
  });

  it("reports an empty corroboration when only one report was supplied, without inventing agreement", () => {
    const plan = planSettlementUpserts([], fmRows);
    // One source cannot corroborate itself: the day is primary_only, not agreed.
    expect(plan.corroboration).toHaveLength(1);
    expect(plan.corroboration[0].agreement).toBe("primary_only");
    expect(summarizeIngest({ settlementPlan: plan }).corroborationAttention).toHaveLength(0);
  });
});
