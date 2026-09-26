/**
 * tests/compliance/leafly-online-orders-report.test.ts — SLICE 8, round L-24.
 *
 * The report core carries 154 embedded self-tests that CI already runs. This
 * file adds the assertions those cannot make: PROPERTIES that must hold over
 * generated input rather than over hand-picked examples, and the one check the
 * core is structurally unable to perform on itself (see the drift block at the
 * bottom — the core imports nothing, so it cannot compare its own money parser
 * against the shared one).
 *
 * WHY A REPORTING TAB DESERVES THIS MUCH CARE
 * -------------------------------------------
 * Every other tab in the suite measures MONEY, and a wrong number there is
 * visibly wrong — the owner knows roughly what a day's sales look like. This
 * tab measures a CONTRACT, and nobody has an intuition for what "83%
 * acknowledged on time" ought to feel like. A quietly wrong figure here would
 * simply be believed. So the arithmetic is pinned down by properties, not by
 * eyeballing a few examples.
 *
 * The single most important assertion in this file is that `safeRate` returns
 * null on an empty denominator. "0% of orders reached the customer" and "there
 * were no orders" are opposite facts demanding opposite reactions, and a report
 * that renders both as "0%" would send the owner hunting a bug on a quiet
 * Tuesday.
 *
 * A NOTE ON THE FIXTURES, WRITTEN DOWN SO THE NEXT PERSON DOES NOT LOSE AN HOUR
 * ----------------------------------------------------------------------------
 * `ReportOrderRow` is a row of ISO TIMESTAMP STRINGS, not booleans and not
 * epoch milliseconds. "Acknowledged" is `acknowledgedAt` being a non-empty
 * string; "bridged to the register" is `localOrderId` being populated. Invent a
 * boolean field like `acknowledged` and TypeScript will accept the object (the
 * type's fields are all optional), every row will silently read as
 * unacknowledged, and the resulting failures will look like core defects rather
 * than fixture defects. This exact mistake was made while writing this file.
 */
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@/lib/leafly/order-detail-core";
import {
  __MONEY_CORPUS,
  ALERT_FREE_NOTE,
  AUTO_CANCEL_REASON_CODE,
  buildOnlineOrdersReport,
  formatDuration,
  formatRate,
  formatReportMoney,
  headlineFinding,
  labelForStatus,
  LEAFLY_EXIT_STATUSES,
  LEAFLY_LIFECYCLE_ORDER,
  lifecycleRank,
  medianOf,
  msBetween,
  percentileNearestRank,
  reachedAtLeast,
  reportMoneyToMinor,
  safeRate,
  tally,
  type ReportAttemptRow,
  type ReportOrderRow,
} from "@/lib/leafly/online-orders-report-core";

// ---------------------------------------------------------------------------
// A tiny deterministic generator. Seeded so a failure is reproducible — a
// property test that cannot be replayed is just a flaky test.
// ---------------------------------------------------------------------------
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ALL_STATUSES: readonly string[] = [...LEAFLY_LIFECYCLE_ORDER, ...LEAFLY_EXIT_STATUSES];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Coherent random orders.
 *
 * "Coherent" matters: an order whose status is `ready` but which was never
 * acknowledged is not a state Leafly can produce, and feeding one in would make
 * `readyRate` exceed 100% and break an invariant for reasons that say nothing
 * about the code. So anything past `pending` is generated as acknowledged.
 * Hostile-shaped rows are tested separately and deliberately, below.
 */
function randomOrders(count: number, seed: number): ReportOrderRow[] {
  const rnd = makeRng(seed);
  const rows: ReportOrderRow[] = [];
  const base = Date.parse("2026-02-01T17:00:00.000Z");

  for (let i = 0; i < count; i += 1) {
    const leaflyStatus = ALL_STATUSES[Math.floor(rnd() * ALL_STATUSES.length)];
    const rank = lifecycleRank(leaflyStatus);
    const isExit = leaflyStatus === "canceled" || leaflyStatus === "expired";

    const firstSeenMs = base + Math.floor(rnd() * 4) * 86_400_000 + Math.floor(rnd() * 3_600_000);
    // Leafly's own deadline: fifteen minutes, as the spec states. Supplied by
    // them on the webhook, never computed locally — mirrored here.
    const acknowledgeByMs = firstSeenMs + 900_000;

    // Anything past `pending` must have been acknowledged for the row to make
    // sense. Exits may or may not have been.
    const acknowledged = rank >= 1 || (isExit && rnd() > 0.5);
    // Some acknowledgements land late on purpose, so `late` is exercised.
    const ackMs = firstSeenMs + Math.floor(rnd() * 1_200_000);

    const autoCancelled = isExit && rnd() > 0.5;

    rows.push({
      leaflyOrderId: `ord-${i}`,
      leaflyStatus,
      fulfillmentMechanism: rnd() > 0.8 ? "delivery" : "pickup",
      marketplace: rnd() > 0.85 ? "uberEats" : "leafly",
      medicalStatus: rnd() > 0.7 ? "medical" : "recreational",
      paymentPreference: rnd() > 0.5 ? "cash" : "debit",
      acknowledgeBy: iso(acknowledgeByMs),
      acknowledgedAt: acknowledged ? iso(ackMs) : null,
      canceledAt: isExit ? iso(firstSeenMs + 1_800_000) : null,
      cancelationReasonCode: autoCancelled
        ? AUTO_CANCEL_REASON_CODE
        : isExit
          ? "customer_canceled"
          : null,
      localOrderId: rank >= 1 && rnd() > 0.2 ? `local-${i}` : null,
      firstSeenAt: iso(firstSeenMs),
      announcedAt: rnd() > 0.2 ? iso(firstSeenMs + 2_000) : null,
      printedAt: rnd() > 0.25 ? iso(firstSeenMs + 3_000) : null,
      totalMinorUnits: rnd() > 0.1 ? Math.round(rnd() * 30000) : null,
    });
  }
  return rows;
}

/** An independently written cancellation oracle, from the column semantics. */
function countCancellations(orders: readonly ReportOrderRow[]) {
  const reasonOf = (o: ReportOrderRow) =>
    typeof o.cancelationReasonCode === "string" ? o.cancelationReasonCode.trim() : "";
  const isCancelled = (o: ReportOrderRow) =>
    (typeof o.canceledAt === "string" && o.canceledAt.trim() !== "") ||
    o.leaflyStatus === "canceled" ||
    o.leaflyStatus === "expired";
  let auto = 0;
  let other = 0;
  for (const o of orders) {
    if (reasonOf(o) === AUTO_CANCEL_REASON_CODE) auto += 1;
    else if (isCancelled(o)) other += 1;
  }
  return { auto, other, total: auto + other };
}

// ===========================================================================

describe("Slice 8 — a rate is never invented out of an empty denominator", () => {
  it("returns null, not zero, when nothing was measured", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. "0% acknowledged on time" and "no
    // orders yet" demand opposite reactions from the owner.
    expect(safeRate(0, 0)).toBeNull();
    expect(safeRate(5, 0)).toBeNull();
    expect(safeRate(0, -1)).toBeNull();
  });

  it("returns a real zero when the denominator is real", () => {
    // The contrast case. A genuine 0% must survive, or the guard went too far
    // and now hides the very failure it was added to expose.
    expect(safeRate(0, 10)).toBe(0);
  });

  it("never returns a rate outside 0..1 for sane counts", () => {
    const rnd = makeRng(99);
    for (let i = 0; i < 500; i += 1) {
      const d = 1 + Math.floor(rnd() * 100);
      const n = Math.floor(rnd() * (d + 1));
      const r = safeRate(n, d);
      expect(r).not.toBeNull();
      expect(r as number).toBeGreaterThanOrEqual(0);
      expect(r as number).toBeLessThanOrEqual(1);
    }
  });

  it("refuses non-finite inputs rather than propagating NaN", () => {
    // A NaN reaching the screen renders as "NaN%", which destroys the reader's
    // trust in every other number on the page, including the correct ones.
    expect(safeRate(NaN, 10)).toBeNull();
    expect(safeRate(1, Infinity)).toBeNull();
    expect(safeRate(Infinity, 10)).toBeNull();
  });

  it("formats a null rate as a dash and never as 0%", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(NaN)).toBe("—");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0.8333, 1)).toBe("83.3%");
  });
});

describe("Slice 8 — the lifecycle ladder matches Leafly's own spec", () => {
  it("lists the six progressing statuses in Leafly's order", () => {
    // Straight from the OrderStatus enum in order-api-v1.openapi.json. If
    // Leafly adds a stop, this test is where that news should arrive.
    expect([...LEAFLY_LIFECYCLE_ORDER]).toEqual([
      "pending",
      "confirmed",
      "ready",
      "out_for_delivery",
      "arrived_at_customer",
      "picked_up",
    ]);
  });

  it("keeps the two exits OUT of the ladder", () => {
    // canceled/expired are not "further along" than confirmed; ranking them on
    // the same scale would make a cancelled order look like progress and would
    // inflate the exact funnel this tab exists to report honestly.
    expect([...LEAFLY_EXIT_STATUSES]).toEqual(["canceled", "expired"]);
    for (const exit of LEAFLY_EXIT_STATUSES) {
      expect(LEAFLY_LIFECYCLE_ORDER).not.toContain(exit);
      expect(lifecycleRank(exit)).toBe(-1);
      expect(reachedAtLeast(exit, "confirmed")).toBe(false);
    }
  });

  it("ranks strictly increasing along the ladder", () => {
    for (let i = 1; i < LEAFLY_LIFECYCLE_ORDER.length; i += 1) {
      expect(lifecycleRank(LEAFLY_LIFECYCLE_ORDER[i])).toBeGreaterThan(
        lifecycleRank(LEAFLY_LIFECYCLE_ORDER[i - 1]),
      );
    }
  });

  it("reachedAtLeast is monotonic — anything past a stop counts as reaching it", () => {
    // Full 6x6 matrix. Exhaustive because it is cheap and because an off-by-one
    // here would misreport every funnel number on the page.
    for (let i = 0; i < LEAFLY_LIFECYCLE_ORDER.length; i += 1) {
      for (let j = 0; j < LEAFLY_LIFECYCLE_ORDER.length; j += 1) {
        expect(reachedAtLeast(LEAFLY_LIFECYCLE_ORDER[i], LEAFLY_LIFECYCLE_ORDER[j])).toBe(i >= j);
      }
    }
  });

  it("treats an unknown status as no progress rather than guessing", () => {
    expect(reachedAtLeast("nonsense", "ready")).toBe(false);
    expect(reachedAtLeast(null, "pending")).toBe(false);
    expect(reachedAtLeast(undefined, "pending")).toBe(false);
    expect(reachedAtLeast("", "pending")).toBe(false);
  });

  it("labels every status the owner can actually see", () => {
    // A raw snake_case token on screen looks like a bug to a non-engineer.
    for (const s of ALL_STATUSES) {
      const label = labelForStatus(s);
      expect(label).not.toBe("Unknown");
      expect(label).not.toContain("_");
    }
    expect(labelForStatus(null)).toBe("Unknown");
    expect(labelForStatus("  ")).toBe("Unknown");
  });
});

describe("Slice 8 — money is read off the decimal text, not the float", () => {
  it("does not lose the half cent", () => {
    // Math.round(1.005 * 100) === 100 in IEEE 754, because 1.005 is really
    // 1.00499999999999989... The right answer for a human-typed value is 101.
    expect(reportMoneyToMinor("1.005")).toBe(101);
    expect(reportMoneyToMinor(1.005)).toBe(101);
    expect(reportMoneyToMinor("10.005")).toBe(1001);
  });

  it("returns null — never zero — for anything unreadable", () => {
    // The separator-only cases at the end are the ones a mutation run proved
    // were the only inputs reaching the "parsed, but no digits" branch.
    for (const bad of [null, undefined, "", "   ", "abc", {}, [], NaN, Infinity, ".", "-", "-.", "$."]) {
      expect(reportMoneyToMinor(bad)).toBeNull();
      expect(reportMoneyToMinor(bad)).not.toBe(0);
    }
  });

  it("keeps a genuine zero distinct from a missing one", () => {
    expect(reportMoneyToMinor(0)).toBe(0);
    expect(reportMoneyToMinor("0.00")).toBe(0);
    expect(formatReportMoney(0)).toBe("$0.00");
    expect(formatReportMoney(null)).toBe("—");
  });

  it("handles the shapes Leafly actually sends", () => {
    expect(reportMoneyToMinor("42.50")).toBe(4250);
    expect(reportMoneyToMinor("$1,234.56")).toBe(123456);
    expect(reportMoneyToMinor("-3.25")).toBe(-325);
    expect(reportMoneyToMinor(".75")).toBe(75);
    expect(reportMoneyToMinor("5.1")).toBe(510);
    expect(reportMoneyToMinor("1e2")).toBe(10000);
  });

  it("round-trips through the formatter for a wide range of values", () => {
    const rnd = makeRng(7);
    for (let i = 0; i < 400; i += 1) {
      const minor = Math.floor(rnd() * 2_000_000) - 500_000;
      const text = formatReportMoney(minor);
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("undefined");
      // Cents are always two digits — "$5.5" would be a rendering bug.
      expect(text).toMatch(/\.\d{2}$/);
      expect(text).toMatch(/^-?\$[\d,]+\.\d{2}$/);
    }
  });

  it("groups thousands so a five-figure total is readable at a glance", () => {
    expect(formatReportMoney(123456789)).toBe("$1,234,567.89");
    expect(formatReportMoney(-123456)).toBe("-$1,234.56");
  });
});

describe("Slice 8 — the duplicated money parser has not drifted", () => {
  it("agrees with order-detail-core's toMinorUnits on the whole hostile corpus", () => {
    // The report core imports NOTHING by design, so it carries its own copy of
    // the parser. A duplicate is only safe if something proves it still agrees
    // with the original — and the core cannot prove that about itself. This is
    // the check the core's own comment promises, and it lives here because
    // here is the only place both modules can be loaded at once.
    expect(__MONEY_CORPUS.length).toBeGreaterThan(20);
    for (const value of __MONEY_CORPUS) {
      expect({ value, got: reportMoneyToMinor(value) }).toEqual({
        value,
        got: toMinorUnits(value),
      });
    }
  });

  it("agrees on randomly generated decimal text too", () => {
    // The fixed corpus catches known traps; this catches unknown ones.
    const rnd = makeRng(4242);
    for (let i = 0; i < 600; i += 1) {
      const whole = Math.floor(rnd() * 100000);
      const frac = String(Math.floor(rnd() * 10000)).padStart(4, "0").slice(0, 1 + Math.floor(rnd() * 4));
      const sign = rnd() > 0.85 ? "-" : "";
      const text = `${sign}${whole}.${frac}`;
      expect(reportMoneyToMinor(text)).toBe(toMinorUnits(text));
    }
  });
});

describe("Slice 8 — percentiles report a real observation", () => {
  it("never interpolates a value nobody measured", () => {
    // Nearest-rank on purpose: "the slowest 5% took at least this long" must
    // be a statement about an order somebody can go and look at.
    const data = [1, 2, 3, 4, 100];
    expect(data).toContain(percentileNearestRank(data, 0.95));
    const rnd = makeRng(808);
    for (let t = 0; t < 60; t += 1) {
      const n = 1 + Math.floor(rnd() * 25);
      const d = Array.from({ length: n }, () => Math.floor(rnd() * 900)).sort((a, b) => a - b);
      for (const p of [0, 0.5, 0.9, 0.95, 1]) {
        expect(d).toContain(percentileNearestRank(d, p));
      }
    }
  });

  it("returns null for an empty set rather than zero", () => {
    expect(percentileNearestRank([], 0.5)).toBeNull();
    expect(medianOf([])).toBeNull();
  });

  it("clamps a nonsense p instead of reading off the end of the array", () => {
    const d = [1, 2, 3];
    expect(percentileNearestRank(d, -5)).toBe(1);
    expect(percentileNearestRank(d, 5)).toBe(3);
    expect(percentileNearestRank(d, NaN)).toBeNull();
  });

  it("is monotonic in p", () => {
    const rnd = makeRng(21);
    const data = Array.from({ length: 60 }, () => Math.floor(rnd() * 1000)).sort((a, b) => a - b);
    let prev = -Infinity;
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1]) {
      const v = percentileNearestRank(data, p) as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("brackets the median between the extremes and does not mutate its input", () => {
    const rnd = makeRng(33);
    for (let t = 0; t < 50; t += 1) {
      const n = 1 + Math.floor(rnd() * 30);
      const data = Array.from({ length: n }, () => Math.floor(rnd() * 500));
      const before = [...data];
      const m = medianOf(data) as number;
      expect(m).toBeGreaterThanOrEqual(Math.min(...data));
      expect(m).toBeLessThanOrEqual(Math.max(...data));
      // A helper that sorts its caller's array in place would silently reorder
      // the samples every other statistic on the page is computed from.
      expect(data).toEqual(before);
    }
  });
});

describe("Slice 8 — deadline arithmetic uses Leafly's clock, honestly", () => {
  it("refuses to measure against an unparseable instant", () => {
    expect(msBetween(null, "2026-02-01T00:00:00Z")).toBeNull();
    expect(msBetween("2026-02-01T00:00:00Z", "not a date")).toBeNull();
    expect(msBetween("", "")).toBeNull();
  });

  it("returns a signed difference so lateness is representable", () => {
    expect(msBetween("2026-02-01T00:00:00Z", "2026-02-01T00:05:00Z")).toBe(300_000);
    expect(msBetween("2026-02-01T00:05:00Z", "2026-02-01T00:00:00Z")).toBe(-300_000);
  });

  it("counts an acknowledgement after the deadline as late, not as on time", () => {
    const rows: ReportOrderRow[] = [
      {
        firstSeenAt: "2026-02-01T00:00:00Z",
        acknowledgeBy: "2026-02-01T00:15:00Z",
        acknowledgedAt: "2026-02-01T00:20:00Z", // five minutes past Leafly's clock
        leaflyStatus: "confirmed",
      },
      {
        firstSeenAt: "2026-02-01T00:00:00Z",
        acknowledgeBy: "2026-02-01T00:15:00Z",
        acknowledgedAt: "2026-02-01T00:02:00Z",
        leaflyStatus: "confirmed",
      },
    ];
    const r = buildOnlineOrdersReport({ orders: rows });
    expect(r.acknowledgement.late).toBe(1);
    expect(r.acknowledgement.onTime).toBe(1);
    expect(r.acknowledgement.onTimeRate).toBe(0.5);
    // Median headroom across +780s and -300s is +240s.
    expect(r.acknowledgement.medianHeadroomSeconds).toBe(240);
    expect(r.acknowledgement.measured).toBe(2);
    expect(r.acknowledgement.medianSeconds).toBe((120 + 1200) / 2);
    expect(r.acknowledgement.slowestSeconds).toBe(1200);
  });

  it("ignores an acknowledgement recorded before the order was seen", () => {
    // Negative elapsed time is a clock problem, not a fast shop. Letting it in
    // would drag the median down and hide a genuine slowdown.
    const r = buildOnlineOrdersReport({
      orders: [
        {
          firstSeenAt: "2026-02-01T00:10:00Z",
          acknowledgedAt: "2026-02-01T00:00:00Z",
          leaflyStatus: "confirmed",
        },
      ],
    });
    expect(r.acknowledgement.measured).toBe(0);
    expect(r.acknowledgement.medianSeconds).toBeNull();
  });
});

describe("Slice 8 — the whole report holds together on random input", () => {
  it("never throws, whatever the rows contain", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(() => buildOnlineOrdersReport({ orders: randomOrders(30, seed) })).not.toThrow();
    }
  });

  it("survives rows that are entirely empty", () => {
    // These are real: migration 0226 makes almost every column nullable so an
    // unrecognised payload is still recordable inside a handler contractually
    // obliged to answer 200. A report that throws on one goes blank at exactly
    // the moment it is needed.
    const r = buildOnlineOrdersReport({
      orders: [{}, {}, { leaflyStatus: null, totalMinorUnits: undefined }],
      attempts: [{}, { disposition: null }],
    });
    expect(r.totalOrders).toBe(3);
    expect(r.ordersWithTotal).toBe(0);
    expect(r.averageOrderMinorUnits).toBeNull();
    expect(r.statusMix).toEqual([{ key: "unknown", label: "Unknown", count: 3 }]);
    expect(r.outbound.total).toBe(2);
    expect(r.outbound.successRate).toBe(0);
  });

  it("keeps every count within the total, always", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const orders = randomOrders(40, seed);
      const r = buildOnlineOrdersReport({ orders });

      expect(r.totalOrders).toBe(orders.length);
      for (const n of [
        r.acknowledgedOrders,
        r.autoCanceledOrders,
        r.otherCanceledOrders,
        r.announced,
        r.printed,
        r.bridgedToRegister,
        r.ordersWithTotal,
        r.lifecycle.acknowledged,
        r.lifecycle.reachedConfirmed,
        r.lifecycle.reachedReady,
        r.lifecycle.reachedPickedUp,
        r.lifecycle.stalledAtConfirmed,
      ]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(r.totalOrders);
      }
    }
  });

  it("keeps the lifecycle funnel monotonically narrowing", () => {
    // You cannot reach `ready` without having reached `confirmed`. If this ever
    // inverts, the funnel is lying about where orders get stuck — the exact
    // question the tab was built to answer.
    for (let seed = 1; seed <= 40; seed += 1) {
      const r = buildOnlineOrdersReport({ orders: randomOrders(40, seed) });
      expect(r.lifecycle.reachedConfirmed).toBeGreaterThanOrEqual(r.lifecycle.reachedReady);
      expect(r.lifecycle.reachedReady).toBeGreaterThanOrEqual(r.lifecycle.reachedPickedUp);
      for (const rate of [
        r.lifecycle.confirmedRate,
        r.lifecycle.readyRate,
        r.lifecycle.pickedUpRate,
      ]) {
        if (rate !== null) {
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("splits cancellations without double counting", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const orders = randomOrders(40, seed);
      const r = buildOnlineOrdersReport({ orders });
      const oracle = countCancellations(orders);
      expect(r.autoCanceledOrders).toBe(oracle.auto);
      expect(r.otherCanceledOrders).toBe(oracle.other);
      expect(r.autoCanceledOrders + r.otherCanceledOrders).toBe(oracle.total);
    }
  });

  it("never folds a missed deadline into the generic cancelled bucket", () => {
    // THE HEADLINE THE WHOLE TAB EXISTS FOR. An order lost to the 15-minute
    // clock is indistinguishable from one never placed in a sales report;
    // `order_api_unacknowledged` is the only trace, and it must stay separate
    // from a customer changing their mind.
    const orders: ReportOrderRow[] = [
      {
        leaflyStatus: "canceled",
        canceledAt: "2026-02-01T00:20:00Z",
        cancelationReasonCode: AUTO_CANCEL_REASON_CODE,
      },
      {
        leaflyStatus: "canceled",
        canceledAt: "2026-02-01T00:20:00Z",
        cancelationReasonCode: "customer_canceled",
      },
    ];
    const r = buildOnlineOrdersReport({ orders });
    expect(r.autoCanceledOrders).toBe(1);
    expect(r.otherCanceledOrders).toBe(1);
    expect(r.autoCancelRate).toBe(0.5);
  });

  it("sums money only over rows that carried a readable total", () => {
    const r = buildOnlineOrdersReport({
      // Leafly money is integer minor units (cents). A fractional number is not
      // cents and is refused rather than rounded into a plausible-looking total.
      orders: [{ totalMinorUnits: 1000 }, { totalMinorUnits: 501 }, { totalMinorUnits: null }, { totalMinorUnits: 33.7 }],
    });
    expect(r.ordersWithTotal).toBe(2);
    expect(r.grossMinorUnits).toBe(1000 + 501);
    // The average divides by the MEASURED rows, not by all four — otherwise a
    // missing total silently drags the average down.
    expect(r.averageOrderMinorUnits).toBe(Math.round(1501 / 2));
  });

  it("agrees with a hand count of the daily buckets", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const orders = randomOrders(35, seed);
      const r = buildOnlineOrdersReport({ orders });
      expect(r.dailyVolume.reduce((acc, d) => acc + d.orders, 0)).toBe(orders.length);
      // Buckets must come out in calendar order or the chart draws backwards.
      const dates = r.dailyVolume.map((d) => d.date);
      expect([...dates].sort((a, b) => a.localeCompare(b))).toEqual(dates);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it("drops a row with no first-seen instant from the daily chart rather than guessing a day", () => {
    const r = buildOnlineOrdersReport({
      orders: [{ firstSeenAt: "2026-02-01T00:00:00Z" }, { firstSeenAt: null }, {}],
    });
    expect(r.totalOrders).toBe(3);
    expect(r.dailyVolume.reduce((a, d) => a + d.orders, 0)).toBe(1);
  });

  it("returns honest nulls on an empty window instead of zeros", () => {
    const r = buildOnlineOrdersReport({ orders: [], attempts: [] });
    expect(r.totalOrders).toBe(0);
    expect(r.autoCancelRate).toBeNull();
    expect(r.acknowledgement.onTimeRate).toBeNull();
    expect(r.acknowledgement.medianSeconds).toBeNull();
    expect(r.acknowledgement.p95Seconds).toBeNull();
    expect(r.lifecycle.readyRate).toBeNull();
    expect(r.outbound.successRate).toBeNull();
    expect(r.averageOrderMinorUnits).toBeNull();
    expect(r.dailyVolume).toEqual([]);
    // And it must not shout about a problem that does not exist.
    expect(headlineFinding(r)).toBeNull();
  });
});

describe("Slice 8 — the stalled-at-confirmed number, which is the notification story", () => {
  it("counts an acknowledged order sitting at confirmed and nothing else", () => {
    // This single number answers "why did my customer never hear anything?".
    // Leafly is the sole originator of consumer messages and only speaks when
    // WE report a transition, so a lifecycle parked at `confirmed` means the
    // shopper was told the store has the order and then told nothing more.
    const orders: ReportOrderRow[] = [
      { leaflyStatus: "confirmed", acknowledgedAt: "2026-02-01T00:01:00Z" }, // counts
      { leaflyStatus: "confirmed", acknowledgedAt: null }, // never acknowledged
      { leaflyStatus: "ready", acknowledgedAt: "2026-02-01T00:01:00Z" }, // moved on
      {
        leaflyStatus: "confirmed",
        acknowledgedAt: "2026-02-01T00:01:00Z",
        canceledAt: "2026-02-01T00:30:00Z", // cancelled, so not a silent customer
      },
    ];
    const r = buildOnlineOrdersReport({ orders });
    expect(r.lifecycle.stalledAtConfirmed).toBe(1);
  });

  it("never exceeds the acknowledged count it is drawn from", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const r = buildOnlineOrdersReport({ orders: randomOrders(40, seed) });
      expect(r.lifecycle.stalledAtConfirmed).toBeLessThanOrEqual(r.lifecycle.acknowledged);
    }
  });
});

describe("Slice 8 — outbound health reflects what we actually sent", () => {
  const attempts: ReportAttemptRow[] = [
    { disposition: "success" },
    { disposition: "success" },
    { disposition: "retry" },
    { disposition: "fix_config" },
    { disposition: "fix_request" },
    { disposition: "gone" },
    { disposition: null, refusalCode: "already_acknowledged" },
    { disposition: null, refusalCode: "already_acknowledged" },
    { disposition: null, refusalCode: "same_status" },
    { disposition: "weird_new_value" },
  ];

  it("buckets each disposition exactly once and tolerates an unknown one", () => {
    const r = buildOnlineOrdersReport({ orders: [], attempts }).outbound;
    expect(r.total).toBe(10);
    expect(r.success).toBe(2);
    expect(r.retry).toBe(1);
    expect(r.fixConfig).toBe(1);
    expect(r.fixRequest).toBe(1);
    expect(r.gone).toBe(1);
    // An unrecognised disposition must not be quietly counted as a success.
    expect(r.success + r.retry + r.fixConfig + r.fixRequest + r.gone).toBeLessThan(r.total);
    expect(r.successRate).toBe(0.2);
  });

  it("ranks refusals by frequency with a stable tiebreak", () => {
    const r = buildOnlineOrdersReport({ orders: [], attempts }).outbound;
    expect(r.refused).toBe(3);
    expect(r.topRefusals.map((x) => x.key)).toEqual(["already_acknowledged", "same_status"]);
    expect(r.topRefusals[0].count).toBe(2);
    // Refusals are shown to a human, so they must be spelled out.
    expect(r.topRefusals[0].label).toBe("Already acknowledged");
  });

  it("shows at most six refusal reasons so the panel cannot run off the page", () => {
    const many: ReportAttemptRow[] = Array.from({ length: 20 }, (_, i) => ({
      refusalCode: `code_${i}`,
    }));
    expect(buildOnlineOrdersReport({ orders: [], attempts: many }).outbound.topRefusals.length).toBe(6);
  });
});

describe("Slice 8 — the headline only speaks when there is something to say", () => {
  it("stays silent on a clean window", () => {
    const orders: ReportOrderRow[] = Array.from({ length: 10 }, (_, i) => ({
      leaflyOrderId: `ord-${i}`,
      leaflyStatus: "picked_up",
      firstSeenAt: "2026-02-01T00:00:00Z",
      acknowledgeBy: "2026-02-01T00:15:00Z",
      acknowledgedAt: "2026-02-01T00:02:00Z",
      totalMinorUnits: 2500,
    }));
    const r = buildOnlineOrdersReport({ orders });
    expect(r.autoCanceledOrders).toBe(0);
    expect(r.lifecycle.stalledAtConfirmed).toBe(0);
    expect(r.acknowledgement.late).toBe(0);
    expect(headlineFinding(r)).toBeNull();
  });

  it("leads with lost orders, because they cost money today", () => {
    // Priority is by COST, not by which word sounds most severe. An order lost
    // to the clock outranks a stalled lifecycle even when both are present.
    const orders: ReportOrderRow[] = [
      { leaflyStatus: "canceled", cancelationReasonCode: AUTO_CANCEL_REASON_CODE },
      { leaflyStatus: "confirmed", acknowledgedAt: "2026-02-01T00:01:00Z" },
    ];
    const h = headlineFinding(buildOnlineOrdersReport({ orders }));
    expect(h).not.toBeNull();
    expect(h as string).toContain("auto-cancelled");
    expect(h as string).toContain("15-minute");
  });

  it("falls through to the stalled lifecycle when nothing was lost to the clock", () => {
    const h = headlineFinding(
      buildOnlineOrdersReport({
        orders: [{ leaflyStatus: "confirmed", acknowledgedAt: "2026-02-01T00:01:00Z" }],
      }),
    );
    expect(h as string).toContain("Confirmed");
    // Singular grammar — "1 orders" reads as a bug to the owner.
    expect(h as string).toContain("1 acknowledged order ");
    expect(h as string).not.toContain("orders never");
  });

  it("pluralises correctly in both directions", () => {
    const two = headlineFinding(
      buildOnlineOrdersReport({
        orders: [
          { leaflyStatus: "canceled", cancelationReasonCode: AUTO_CANCEL_REASON_CODE },
          { leaflyStatus: "canceled", cancelationReasonCode: AUTO_CANCEL_REASON_CODE },
        ],
      }),
    );
    expect(two as string).toContain("2 orders auto-cancelled");
    const one = headlineFinding(
      buildOnlineOrdersReport({
        orders: [{ leaflyStatus: "canceled", cancelationReasonCode: AUTO_CANCEL_REASON_CODE }],
      }),
    );
    expect(one as string).toContain("1 order auto-cancelled");
  });

  it("never produces a headline containing a raw null, undefined or NaN", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const h = headlineFinding(buildOnlineOrdersReport({ orders: randomOrders(25, seed) }));
      if (h !== null) {
        expect(h).not.toContain("undefined");
        expect(h).not.toContain("null");
        expect(h).not.toContain("NaN");
      }
    }
  });
});

describe("Slice 8 — breakdowns are deterministic", () => {
  it("orders by count descending, then key ascending", () => {
    // Without the tiebreak the order of two equal buckets follows Map insertion
    // order, which follows row order, which follows the database — and a report
    // whose rows reshuffle between identical loads looks broken.
    const rows: ReportOrderRow[] = [
      { leaflyStatus: "ready" },
      { leaflyStatus: "confirmed" },
      { leaflyStatus: "picked_up" },
      { leaflyStatus: "picked_up" },
    ];
    expect(tally(rows, (r) => r.leaflyStatus, {}).map((x) => x.key)).toEqual([
      "picked_up",
      "confirmed",
      "ready",
    ]);
  });

  it("files a null or blank column under Unknown rather than dropping the row", () => {
    const rows: ReportOrderRow[] = [
      { marketplace: null },
      { marketplace: "   " },
      { marketplace: "leafly" },
    ];
    const t = tally(rows, (r) => r.marketplace, { leafly: "Leafly" });
    expect(t.reduce((a, x) => a + x.count, 0)).toBe(3);
    expect(t.find((x) => x.key === "unknown")?.count).toBe(2);
    expect(t.find((x) => x.key === "unknown")?.label).toBe("Unknown");
  });

  it("trims whitespace so ' leafly' and 'leafly' are not two buckets", () => {
    const t = tally([{ marketplace: " leafly " }, { marketplace: "leafly" }], (r) => r.marketplace, {});
    expect(t.length).toBe(1);
    expect(t[0].count).toBe(2);
  });

  it("produces the same output for the same input, every time", () => {
    const orders = randomOrders(50, 12);
    const a = JSON.stringify(buildOnlineOrdersReport({ orders }));
    const b = JSON.stringify(buildOnlineOrdersReport({ orders: [...orders] }));
    expect(a).toBe(b);
  });
});

describe("Slice 8 — durations read like a human wrote them", () => {
  it("renders a dash for unknown rather than 0s", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
    expect(formatDuration(Infinity)).toBe("—");
  });

  it("scales units sensibly", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3660)).toBe("1h 1m");
  });

  it("keeps a negative readable — it means the deadline was missed", () => {
    expect(formatDuration(-90)).toBe("-1m 30s");
    expect(formatDuration(-30)).toBe("-30s");
  });

  it("never emits NaN for any finite input", () => {
    const rnd = makeRng(55);
    for (let i = 0; i < 300; i += 1) {
      const s = Math.floor(rnd() * 100000) - 20000;
      const out = formatDuration(s);
      expect(out).not.toContain("NaN");
      expect(out).not.toBe("—");
    }
  });
});

describe("Slice 8 — the owner's no-email rule is written into the page copy", () => {
  it("explains that the speaker, printer and register are the alert channels", () => {
    // The owner's words were a design constraint, not a preference: "I don't
    // need an email sent to us, the back office dashboard, printer and speaker
    // let us know an order has been placed." This note exists so a future
    // contributor reading three failure counts does not conclude the obvious
    // next feature is "email the staff".
    expect(ALERT_FREE_NOTE).toContain("speaker");
    expect(ALERT_FREE_NOTE).toContain("printer");
    expect(ALERT_FREE_NOTE).toContain("register");
    expect(ALERT_FREE_NOTE).toContain("not email");
  });
});
