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
  summarizeRefunds,
  auditRefundMinor,
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

  // ── AN-4: refunds on the X/Z slip ──────────────────────────────────────────

  it("AN-4: summarizeRefunds splits voids vs returns; garbage amounts contribute $0", () => {
    const r = summarizeRefunds([
      { source: "void", refundMinor: 2500 },
      { source: "void", refundMinor: 1000 },
      { source: "return", refundMinor: 750 },
      { source: "return", refundMinor: -50 },
      { source: "return", refundMinor: 12.5 as unknown as number },
    ]);
    expect(r.voidCount).toBe(2);
    expect(r.voidRefundMinor).toBe(3500);
    expect(r.returnCount).toBe(3);
    expect(r.returnRefundMinor).toBe(750);
    expect(r.refundTotalMinor).toBe(4250);
    expect(summarizeRefunds([]).refundTotalMinor).toBe(0);
  });

  it("AN-4: auditRefundMinor is defensive on after_json shape", () => {
    expect(auditRefundMinor({ refundMinor: 4321 })).toBe(4321);
    expect(auditRefundMinor({ refundMinor: "42" })).toBe(0);
    expect(auditRefundMinor(null)).toBe(0);
    expect(auditRefundMinor("garbage")).toBe(0);
    expect(auditRefundMinor({ refundMinor: -100 })).toBe(0);
  });

  it("AN-4: slip prints store-wide refund section only when the day had cash out", () => {
    const base = {
      kind: "Z" as const,
      registerLabel: "Register 1",
      businessDay: "2026-07-16",
      printedAtIso: "2026-07-17T04:55:00.000Z",
      requestedByName: "Mark",
      summary: summarizeDayEvents([]),
      drawer: null,
      headerText: null,
      addressLines: [],
    };
    const withRefunds = buildDayReportSlipHtml({
      ...base,
      refunds: summarizeRefunds([
        { source: "void", refundMinor: 3500 },
        { source: "return", refundMinor: 750 },
      ]),
    });
    expect(withRefunds).toContain("REFUNDS &mdash; STORE-WIDE CASH OUT");
    expect(withRefunds).toContain("Voided sales (1)");
    expect(withRefunds).toContain("-$35.00");
    expect(withRefunds).toContain("Counter returns (1)");
    expect(withRefunds).toContain("-$7.50");
    expect(withRefunds).toContain("Total cash refunded");
    expect(withRefunds).toContain("-$42.50");
    expect(withRefunds).toContain("not tied to one register");

    // Zero refunds — no section.
    expect(buildDayReportSlipHtml({ ...base, refunds: summarizeRefunds([]) })).not.toContain("REFUNDS");
    // Absent (older cached bundle) — no section, slip still builds.
    expect(buildDayReportSlipHtml(base)).not.toContain("REFUNDS");
  });
});
