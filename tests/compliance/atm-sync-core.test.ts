/**
 * tests/compliance/atm-sync-core.test.ts  (SLICE A-2c)
 *
 * Vitest mirror for the ATM/PAI ingestion "brain" (atm-sync-core). Pins the
 * deterministic UPSERT-plan logic that feeds the atm_cash_loads and
 * atm_settlements tables (migration 0156):
 *   • trxTimeToIso           — PAI "Trx Time" → ISO dedup key (12h → 24h)
 *   • planCashLoadUpserts    — idempotent on (terminal_id, loaded_at)
 *   • planSettlementUpserts  — Simple Summary ⊕ FundsMovement merge precedence
 *   • summarizeIngest / ingestResultMessage — plain-English result
 * No I/O — pure logic. Also runs the in-module self-tests as one assertion.
 */
import { describe, expect, it } from "vitest";
import {
  trxTimeToIso,
  planCashLoadUpserts,
  planSettlementUpserts,
  summarizeIngest,
  ingestResultMessage,
  __runAtmSyncCoreTests,
} from "@/lib/atm/atm-sync-core";
import type {
  CashLoadRow,
  SettlementRow,
  FundsMovementRow,
} from "@/lib/atm/atm-core";

// --- small builders (keep tests readable) ---------------------------------

function cashLoad(over: Partial<CashLoadRow>): CashLoadRow {
  return {
    terminalId: "TERM1",
    loadedAtRaw: "6/1/25 9:30:00 AM",
    loadDate: "2025-06-01",
    cashLoadCents: 100000,
    balanceAfterCents: 500000,
    raw: {},
    ...over,
  };
}

function summaryRow(over: Partial<SettlementRow>): SettlementRow {
  return {
    terminalId: "TERM1",
    settlementDate: "2025-06-01",
    totalTrx: 10,
    withdrawalTrx: 9,
    surchargedWdTrx: 8,
    terminalTransactionCents: null,
    surchargeCents: 2400,
    settlementTotalCents: 90000,
    raw: {},
    ...over,
  };
}

function fmRow(over: Partial<FundsMovementRow>): FundsMovementRow {
  return {
    terminalId: "TERM1",
    settlementDate: "2025-06-01",
    terminalTransactionCents: 87600,
    surchargeCents: 2400,
    accountTail: "1234",
    legCount: 2,
    ...over,
  };
}

// --- trxTimeToIso ----------------------------------------------------------

describe("trxTimeToIso (PAI Trx Time → ISO dedup key)", () => {
  it("returns null for blank/junk", () => {
    expect(trxTimeToIso("")).toBeNull();
    expect(trxTimeToIso(null)).toBeNull();
    expect(trxTimeToIso(undefined)).toBeNull();
    expect(trxTimeToIso("not a date")).toBeNull();
  });
  it("date-only anchors at noon UTC", () => {
    expect(trxTimeToIso("6/1/25")).toBe("2025-06-01T12:00:00Z");
  });
  // PAI reports EASTERN wall-clock time; trxTimeToIso converts it to a true UTC
  // instant (see the comment in atm-sync-core.ts). June 1 is EDT = UTC-4, so
  // 9:30 AM Eastern is 13:30Z. These expectations were stale after the
  // Eastern->UTC fix landed and asserted the OLD, wrong behaviour of pasting
  // Eastern digits under a "Z" suffix.
  it("converts 12h AM/PM to 24h and Eastern to UTC (EDT = UTC-4)", () => {
    expect(trxTimeToIso("6/1/25 9:30:00 AM")).toBe("2025-06-01T13:30:00Z");
    expect(trxTimeToIso("6/1/25 1:05:00 PM")).toBe("2025-06-01T17:05:00Z");
  });
  it("handles 12 AM (midnight) and 12 PM (noon)", () => {
    expect(trxTimeToIso("6/1/25 12:00:00 AM")).toBe("2025-06-01T04:00:00Z");
    expect(trxTimeToIso("6/1/25 12:00:00 PM")).toBe("2025-06-01T16:00:00Z");
  });
  it("defaults seconds to 00 when absent", () => {
    expect(trxTimeToIso("6/1/25 3:15 PM")).toBe("2025-06-01T19:15:00Z");
  });
  it("uses EST (UTC-5) in winter, not EDT", () => {
    // January is outside daylight time; the offset must change with the date.
    expect(trxTimeToIso("1/15/25 9:30:00 AM")).toBe("2025-01-15T14:30:00Z");
  });
});

// --- planCashLoadUpserts ---------------------------------------------------

describe("planCashLoadUpserts (idempotent on terminal_id + loaded_at)", () => {
  it("maps a clean row to a pai upsert with truncated cents", () => {
    const plan = planCashLoadUpserts([cashLoad({ cashLoadCents: 100000.4, balanceAfterCents: 500000.9 })]);
    expect(plan.upserts).toHaveLength(1);
    const u = plan.upserts[0];
    expect(u.terminal_id).toBe("TERM1");
    expect(u.loaded_at).toBe("2025-06-01T13:30:00Z"); // 9:30 AM Eastern -> UTC
    expect(u.load_date).toBe("2025-06-01");
    expect(u.cash_load_cents).toBe(100000);
    expect(u.balance_after_cents).toBe(500000);
    expect(u.source).toBe("pai");
    expect(u.raw.loaded_at_raw).toBe("6/1/25 9:30:00 AM");
  });
  it("keeps a null balance null (never invents a balance)", () => {
    const plan = planCashLoadUpserts([cashLoad({ balanceAfterCents: null })]);
    expect(plan.upserts[0].balance_after_cents).toBeNull();
  });
  it("skips rows with missing terminal id", () => {
    const plan = planCashLoadUpserts([cashLoad({ terminalId: "" })]);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/terminal/i);
  });
  it("skips rows with unparseable load time", () => {
    const plan = planCashLoadUpserts([cashLoad({ loadedAtRaw: "garbage" })]);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/time/i);
  });
  it("de-dupes within a batch on the composite key (last wins)", () => {
    const plan = planCashLoadUpserts([
      cashLoad({ cashLoadCents: 100000 }),
      cashLoad({ cashLoadCents: 222222 }),
    ]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].cash_load_cents).toBe(222222);
  });
});

// --- planSettlementUpserts -------------------------------------------------

describe("planSettlementUpserts (Simple Summary ⊕ FundsMovement merge)", () => {
  it("merges by (settlement_date, terminal_id) into one row", () => {
    const plan = planSettlementUpserts([summaryRow({})], [fmRow({})]);
    expect(plan.upserts).toHaveLength(1);
    const u = plan.upserts[0];
    expect(u.total_trx).toBe(10);
    expect(u.withdrawal_trx).toBe(9);
    expect(u.surcharged_wd_trx).toBe(8);
    expect(u.settlement_total_cents).toBe(90000);
    // terminal_transaction_cents ONLY from FundsMovement
    expect(u.terminal_transaction_cents).toBe(87600);
    // deposit-truth surcharge wins
    expect(u.surcharge_cents).toBe(2400);
  });
  it("FundsMovement surcharge overwrites the Simple Summary fallback", () => {
    const plan = planSettlementUpserts(
      [summaryRow({ surchargeCents: 9999 })],
      [fmRow({ surchargeCents: 2400 })],
    );
    expect(plan.upserts[0].surcharge_cents).toBe(2400);
  });
  it("falls back to Simple Summary surcharge when FundsMovement has none", () => {
    const plan = planSettlementUpserts(
      [summaryRow({ surchargeCents: 2400 })],
      [fmRow({ surchargeCents: null })],
    );
    expect(plan.upserts[0].surcharge_cents).toBe(2400);
  });
  it("Simple-Summary-only: no terminal_transaction_cents invented", () => {
    const plan = planSettlementUpserts([summaryRow({})], []);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].terminal_transaction_cents).toBeNull();
    expect(plan.upserts[0].total_trx).toBe(10);
  });
  it("FundsMovement-only: counts and settlement_total stay null", () => {
    const plan = planSettlementUpserts([], [fmRow({})]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].terminal_transaction_cents).toBe(87600);
    expect(plan.upserts[0].total_trx).toBeNull();
    expect(plan.upserts[0].settlement_total_cents).toBeNull();
  });
  it("skips rows missing date or terminal", () => {
    const plan = planSettlementUpserts(
      [summaryRow({ settlementDate: "" })],
      [fmRow({ terminalId: "" })],
    );
    expect(plan.upserts).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
  });
  it("separates distinct terminals on the same day", () => {
    const plan = planSettlementUpserts(
      [summaryRow({ terminalId: "TERM1" }), summaryRow({ terminalId: "TERM2" })],
      [fmRow({ terminalId: "TERM1" }), fmRow({ terminalId: "TERM2" })],
    );
    expect(plan.upserts).toHaveLength(2);
  });
});

// --- summarizeIngest / ingestResultMessage --------------------------------

describe("summarizeIngest + ingestResultMessage (plain English)", () => {
  it("counts upserts and collects problems", () => {
    const cashLoadPlan = planCashLoadUpserts([cashLoad({}), cashLoad({ terminalId: "" })]);
    const settlementPlan = planSettlementUpserts([summaryRow({})], [fmRow({})]);
    const sum = summarizeIngest({ cashLoadPlan, settlementPlan, mapProblems: ["header mismatch"] });
    expect(sum.cashLoadsUpserted).toBe(1);
    expect(sum.settlementsUpserted).toBe(1);
    expect(sum.didSomething).toBe(true);
    expect(sum.problems.length).toBeGreaterThanOrEqual(2);
  });
  it("reports nothing imported when empty", () => {
    const sum = summarizeIngest({});
    expect(sum.didSomething).toBe(false);
    expect(ingestResultMessage(sum)).toMatch(/No rows/i);
  });
  it("builds a human message with pluralization", () => {
    const settlementPlan = planSettlementUpserts([summaryRow({})], [fmRow({})]);
    const sum = summarizeIngest({ settlementPlan });
    expect(ingestResultMessage(sum)).toBe("Imported 1 settlement day.");
  });
});

// --- in-module self-tests (single source of truth) ------------------------

describe("atm-sync-core in-module self-tests", () => {
  it("runs __runAtmSyncCoreTests without throwing", () => {
    expect(() => __runAtmSyncCoreTests()).not.toThrow();
  });
});
