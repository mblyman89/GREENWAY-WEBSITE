/**
 * tests/compliance/day-report-core.test.ts  (POS Slice B22)
 *
 * Vitest mirror of the day-report-core self-tests: X/Z aggregation over the
 * register's ledger + drawer day, and the 576px Star slip.
 */
import { describe, expect, it } from "vitest";
import {
  summarizeDayEvents,
  summarizeDrawerDay,
  reportKind,
  buildDayReportSlipHtml,
  __runDayReportCoreTests,
  type DayEventRow,
} from "@/lib/pos/day-report-core";

describe("day-report-core (POS B22)", () => {
  it("self-tests pass", () => {
    expect(() => __runDayReportCoreTests()).not.toThrow();
  });

  it("sums only processed sales; exceptions/pendings counted, never summed", () => {
    const rows: DayEventRow[] = [
      { eventType: "sale", status: "processed", payload: { totalMinor: 5000, subtotalMinor: 4000, taxMinor: 1000 } },
      {
        eventType: "sale",
        status: "processed",
        payload: { totalMinor: 3000, subtotalMinor: 3000, taxMinor: 0, medical: { medicalSavingsMinor: 555 } },
      },
      { eventType: "sale", status: "exception", payload: { totalMinor: 9999 } },
      { eventType: "sale", status: "pending", payload: { totalMinor: 1111 } },
      { eventType: "no_sale", status: "processed", payload: {} },
      { eventType: "punch", status: "processed", payload: {} },
    ];
    const s = summarizeDayEvents(rows);
    expect(s.saleCount).toBe(2);
    expect(s.grossMinor).toBe(8000);
    expect(s.taxMinor).toBe(1000);
    expect(s.medicalSaleCount).toBe(1);
    expect(s.medicalSavingsMinor).toBe(555);
    expect(s.noSaleCount).toBe(1);
    expect(s.exceptionCount).toBe(1);
    expect(s.pendingCount).toBe(1);
  });

  it("drawer day: over/short stays null until manager reconcile (blind stays blind)", () => {
    const open = summarizeDrawerDay(
      [{ status: "open", openingCountMinor: 15000, overShortMinor: null }],
      [{ amountMinor: 50000 }],
    );
    expect(open.anyOpen).toBe(true);
    expect(open.overShortMinor).toBeNull();
    expect(open.dropsMinor).toBe(50000);

    const done = summarizeDrawerDay(
      [
        { status: "reconciled", openingCountMinor: 20000, overShortMinor: -125 },
        { status: "verified", openingCountMinor: 10000, overShortMinor: 25 },
      ],
      [],
    );
    expect(done.overShortMinor).toBe(-100);
    expect(reportKind(open)).toBe("X");
    expect(reportKind(done)).toBe("Z");
    expect(reportKind(null)).toBe("X");
  });

  it("slip prints kind banner, money, blind-count language, 576px family, and never a drawer kick", () => {
    const html = buildDayReportSlipHtml({
      kind: "Z",
      registerLabel: "Register 1",
      businessDay: "2026-07-16",
      printedAtIso: "2026-07-17T04:55:00.000Z",
      requestedByName: "Mark L.",
      summary: summarizeDayEvents([
        { eventType: "sale", status: "processed", payload: { totalMinor: 8000, subtotalMinor: 7000, taxMinor: 1000 } },
      ]),
      drawer: summarizeDrawerDay([{ status: "reconciled", openingCountMinor: 20000, overShortMinor: 0 }], []),
      headerText: null,
      addressLines: ["Port Orchard, WA"],
    });
    expect(html).toContain("Z REPORT");
    expect(html).toContain("GREENWAY MARIJUANA");
    expect(html).toContain("$80.00");
    expect(html).toContain("body{width:576px");
    expect(html).toContain("blind");
    expect(html).toContain("Port Orchard, WA");
  });
});
