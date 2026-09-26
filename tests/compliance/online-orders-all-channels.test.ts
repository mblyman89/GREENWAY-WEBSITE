/**
 * Online Orders report — ALL CHANNELS (website + Leafly).
 *
 * Pins the three defects found in the audit and the new comparison report:
 *
 *   1. Leafly money is integer MINOR UNITS. The old report fed it to a
 *      decimal-dollar parser, so an order of 3370 ($33.70) showed as $3,370.00
 *      — every Leafly total was 100x too high.
 *   2. The report read only `leafly_orders`; website orders were missing.
 *   3. Every webhook wrote `raw_order`, so a status/cancel ENVELOPE overwrote
 *      the collected full Order — which Leafly deletes 24h after a terminal
 *      state. Only `order_submit` may write it now.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildOnlineChannelsReport,
  comparisonLeader,
  contactIdentity,
  isWebsiteOrderRow,
  leaflyOutcome,
  readLeaflyPayloadFacts,
  websiteOutcome,
  intMinorOrNull,
  POS_SALE_NOTE_PREFIX,
  LEAFLY_AUTO_CANCEL_CODE,
  __runOnlineChannelsReportTests,
  type ChannelOrderRow,
} from "@/lib/reports/online-orders-channels-core";
import {
  buildOnlineOrdersReport,
  reportIntegerMinor,
  AUTO_CANCEL_REASON_CODE,
} from "@/lib/leafly/online-orders-report-core";
import { POS_SALE_STAFF_NOTE_PREFIX } from "@/lib/pos/pickup-core";
import { webhookMayWriteRawOrder } from "@/lib/leafly/webhook-parse-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function row(p: Partial<ChannelOrderRow> & Pick<ChannelOrderRow, "channel" | "id">): ChannelOrderRow {
  return {
    placedAt: "2026-03-02T18:00:00Z",
    dayKey: "2026-03-02",
    hour: 10,
    weekday: 1,
    outcome: "fulfilled",
    totalMinor: null,
    totalSource: null,
    itemCount: null,
    ...p,
  };
}

describe("pure self-tests", () => {
  it("channels core self-tests all pass", () => {
    const r = __runOnlineChannelsReportTests();
    expect(r.failed, r.messages.join("\n")).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(96);
  });
});

describe("the 100x defect — Leafly totals are integer cents", () => {
  it("the screenshot class: 3370 + 4803 + 2500 is $106.73, not $10,673.00", () => {
    const r = buildOnlineOrdersReport({
      orders: [{ totalMinorUnits: 3370 }, { totalMinorUnits: 4803 }, { totalMinorUnits: 2500 }],
    });
    expect(r.grossMinorUnits).toBe(10_673);
    expect(r.grossMinorUnits).not.toBe(1_067_300);
    expect(r.averageOrderMinorUnits).toBe(Math.round(10_673 / 3));
  });

  it("reportIntegerMinor refuses decimals and strings instead of guessing a unit", () => {
    expect(reportIntegerMinor(3370)).toBe(3370);
    expect(reportIntegerMinor(0)).toBe(0);
    expect(reportIntegerMinor(33.7)).toBeNull();
    expect(reportIntegerMinor("3370")).toBeNull();
    expect(reportIntegerMinor("33.70")).toBeNull();
    expect(reportIntegerMinor(Number.NaN)).toBeNull();
    expect(reportIntegerMinor(null)).toBeNull();
  });

  it("the payload reader takes `total` (what the register collects), never totalWithTip", () => {
    const f = readLeaflyPayloadFacts({ id: "L1", total: 3370, totalWithTip: 3870, tip: 500 });
    expect(f.collected).toBe(true);
    expect(f.totalMinor).toBe(3370);
    expect(f.tipMinor).toBe(500);
  });

  it("taxes are summed from taxes[].amountCents without scaling", () => {
    const f = readLeaflyPayloadFacts({ id: "L1", total: 1000, taxes: [{ amountCents: 370 }, { amountCents: 30 }] });
    expect(f.taxMinor).toBe(400);
  });

  it("a decimal-looking total is refused, not converted", () => {
    expect(readLeaflyPayloadFacts({ id: "L1", total: 33.7 }).totalMinor).toBeNull();
    expect(readLeaflyPayloadFacts({ id: "L1", total: "33.70" }).totalMinor).toBeNull();
  });

  it("a webhook ENVELOPE (no `id`) is not a collected order and carries no money", () => {
    const f = readLeaflyPayloadFacts({ eventType: "order_status_update", orderId: "L1", total: 3370 });
    expect(f.collected).toBe(false);
    expect(f.totalMinor).toBeNull();
    expect(f.lines).toEqual([]);
  });

  it("cart lines use discountedPriceCents, falling back to priceCents", () => {
    const f = readLeaflyPayloadFacts({
      id: "L1",
      total: 5000,
      cartItems: [
        { name: "A", quantity: 2, priceCents: 3000, discountedPriceCents: 2500 },
        { name: "B", quantity: 1, priceCents: 2500 },
      ],
    });
    expect(f.itemCount).toBe(3);
    expect(f.lines.map((l) => l.lineMinor)).toEqual([2500, 2500]);
  });
});

describe("which `orders` rows are website orders", () => {
  it("register sales are excluded by staff note or pos_client_uuid", () => {
    expect(isWebsiteOrderRow({ origin: "greenway" })).toBe(true);
    expect(isWebsiteOrderRow({ origin: null })).toBe(true);
    expect(isWebsiteOrderRow({ origin: "greenway", staffNote: `${POS_SALE_NOTE_PREFIX} register 1` })).toBe(false);
    expect(isWebsiteOrderRow({ origin: "greenway", posClientUuid: "7f0c…" })).toBe(false);
  });

  it("Leafly local copies and register-origin rows are excluded (no double count)", () => {
    expect(isWebsiteOrderRow({ origin: "leafly" })).toBe(false);
    expect(isWebsiteOrderRow({ origin: "register" })).toBe(false);
  });

  it("a staff note that merely mentions a POS sale later is still a website order", () => {
    expect(isWebsiteOrderRow({ origin: "greenway", staffNote: "Customer asked: POS sale — ?" })).toBe(true);
  });

  it("the POS prefix is the SAME string the register sync writes", () => {
    expect(POS_SALE_NOTE_PREFIX).toBe(POS_SALE_STAFF_NOTE_PREFIX);
  });

  it("the auto-cancel code matches the Leafly contract core", () => {
    expect(LEAFLY_AUTO_CANCEL_CODE).toBe(AUTO_CANCEL_REASON_CODE);
  });
});

describe("outcomes", () => {
  it("a website order picked up at the register is fulfilled, not cancelled", () => {
    expect(websiteOutcome("cancelled", true)).toBe("fulfilled");
    expect(websiteOutcome("cancelled", false)).toBe("cancelled");
    expect(websiteOutcome("completed", false)).toBe("fulfilled");
    expect(websiteOutcome("no_show", false)).toBe("no_show");
    expect(websiteOutcome("ready", false)).toBe("open");
  });

  it("Leafly: lost-to-clock is its own outcome, no-show is recognised, local pickup rescues", () => {
    expect(leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: "order_api_unacknowledged" })).toBe("lost_to_clock");
    expect(leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: "not_picked_up" })).toBe("no_show");
    expect(leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: "customer_canceled" })).toBe("cancelled");
    expect(leaflyOutcome({ leaflyStatus: "picked_up" })).toBe("fulfilled");
    expect(leaflyOutcome({ leaflyStatus: "ready", localFulfilled: true })).toBe("fulfilled");
    expect(leaflyOutcome({ leaflyStatus: "ready" })).toBe("open");
  });
});

describe("the comparison report", () => {
  const orders: ChannelOrderRow[] = [
    row({ channel: "website", id: "w1", totalMinor: 5000, itemCount: 2, customerKey: "k1" }),
    row({ channel: "website", id: "w2", totalMinor: 3000, itemCount: 1, outcome: "cancelled", customerKey: "k1" }),
    row({ channel: "website", id: "w3", totalMinor: null, outcome: "open", dayKey: "2026-03-03", weekday: 2, hour: 15 }),
    row({ channel: "leafly", id: "l1", totalMinor: 3370, totalSource: "leafly_payload", customerKey: "k1" }),
    row({ channel: "leafly", id: "l2", totalMinor: 2000, totalSource: "register_copy", outcome: "lost_to_clock" }),
    row({ channel: "leafly", id: "l3", totalMinor: null, outcome: "no_show" }),
  ];
  const r = buildOnlineChannelsReport({ orders, dayKeys: ["2026-03-01", "2026-03-02", "2026-03-03"] });

  it("counts BOTH channels", () => {
    expect(r.channels.website.orders).toBe(3);
    expect(r.channels.leafly.orders).toBe(3);
    expect(r.all.orders).toBe(6);
  });

  it("money is summed only over known totals, and the known count is reported", () => {
    expect(r.channels.website.placedValueMinor).toBe(8000);
    expect(r.channels.website.valueKnown).toBe(2);
    expect(r.channels.website.averageOrderMinor).toBe(4000);
    expect(r.channels.leafly.placedValueMinor).toBe(5370);
    expect(r.all.placedValueMinor).toBe(13_370);
    expect(r.all.valueKnown).toBe(4);
    expect(r.channels.website.fulfilledValueMinor).toBe(5000);
  });

  it("rates use FINISHED orders; open orders wait", () => {
    expect(r.channels.website.finished).toBe(2);
    expect(r.channels.website.pickupRate).toBe(0.5);
    expect(r.channels.leafly.finished).toBe(3);
    expect(r.channels.leafly.lostToClockRate).toBeCloseTo(1 / 3);
    expect(r.channels.leafly.noShowRate).toBeCloseTo(1 / 3);
  });

  it("shares add up to one", () => {
    expect((r.channels.website.shareOfOrders ?? 0) + (r.channels.leafly.shareOfOrders ?? 0)).toBeCloseTo(1);
    expect((r.channels.website.shareOfValue ?? 0) + (r.channels.leafly.shareOfValue ?? 0)).toBeCloseTo(1);
    expect(r.channels.website.shareOfValue).toBeCloseTo(8000 / 13_370);
  });

  it("daily trend is gap-filled and split by channel", () => {
    expect(r.daily.map((d) => d.date)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(r.daily[0]).toEqual({ date: "2026-03-01", websiteOrders: 0, leaflyOrders: 0, websiteValueMinor: 0, leaflyValueMinor: 0 });
    expect(r.daily[1].websiteOrders).toBe(2);
    expect(r.daily[1].leaflyOrders).toBe(3);
    expect(r.daily[1].leaflyValueMinor).toBe(5370);
    expect(r.daily[2].websiteOrders).toBe(1);
  });

  it("hour and weekday buckets", () => {
    expect(r.byHour[10]).toEqual({ hour: 10, website: 2, leafly: 3 });
    expect(r.byHour[15].website).toBe(1);
    expect(r.byWeekday[1].label).toBe("Mon");
    expect(r.byWeekday[2].website).toBe(1);
  });

  it("customers: repeat within channel and overlap across channels", () => {
    expect(r.channels.website.uniqueCustomers).toBe(1);
    expect(r.channels.website.repeatCustomers).toBe(1);
    expect(r.crossChannelCustomers).toBe(1);
  });

  it("Leafly value sources are counted honestly", () => {
    expect(r.leaflyValueSources).toEqual({ payload: 1, registerCopy: 1, unknown: 1 });
  });

  it("comparison rows carry the leader", () => {
    const byKey = Object.fromEntries(r.comparison.map((c) => [c.key, c]));
    expect(byKey.orders.leader).toBe("tie");
    expect(byKey.aov.website).toBe(4000);
    expect(byKey.aov.leafly).toBe(2685);
    expect(byKey.aov.leader).toBe("website");
    expect(byKey.pickup.leader).toBe("website");
    expect(byKey.no_show.betterWhen).toBe("lower");
  });

  it("insights compare only when both sides exist", () => {
    expect(r.insights.length).toBeGreaterThan(0);
    const one = buildOnlineChannelsReport({ orders: [row({ channel: "leafly", id: "x" })] });
    expect(one.insights).toHaveLength(1);
    expect(one.insights[0]).toMatch(/nothing to compare/);
    expect(buildOnlineChannelsReport({ orders: [] }).insights).toEqual([]);
  });

  it("comparisonLeader honours direction and unknowns", () => {
    expect(comparisonLeader(2, 1, "higher")).toBe("website");
    expect(comparisonLeader(2, 1, "lower")).toBe("leafly");
    expect(comparisonLeader(1, 1, "higher")).toBe("tie");
    expect(comparisonLeader(null, 1, "higher")).toBeNull();
  });

  it("contact identity normalises phone then email", () => {
    expect(contactIdentity(null, "+1 (360) 555-0100")).toBe("p:3605550100");
    expect(contactIdentity("A@B.com", "3605550100")).toBe("p:3605550100");
    expect(contactIdentity(" A@B.com ", null)).toBe("e:a@b.com");
    expect(contactIdentity("nope", "555")).toBeNull();
  });

  it("intMinorOrNull is integer-only", () => {
    expect(intMinorOrNull(12)).toBe(12);
    expect(intMinorOrNull(1.5)).toBeNull();
    expect(intMinorOrNull("12")).toBeNull();
  });
});

describe("the webhook clobber fix", () => {
  it("only order_submit may write raw_order", () => {
    expect(webhookMayWriteRawOrder("order_submit")).toBe(true);
    for (const e of ["order_status_update", "order_cancel", "order_update", "", null, undefined]) {
      expect(webhookMayWriteRawOrder(e as never)).toBe(false);
    }
  });

  it("webhook-server gates patch.raw_order behind the rule", () => {
    const src = read("src/lib/leafly/webhook-server.ts");
    const writes = src.match(/patch\.raw_order\s*=/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(src).toContain("if (parsed.body && webhookMayWriteRawOrder(parsed.eventType)) patch.raw_order = parsed.body;");
  });
});

describe("server and page wiring", () => {
  const server = read("src/lib/leafly/online-orders-report-server.ts");
  const page = read("src/app/admin/reports/online-orders/page.tsx");

  it("the server reads website orders from `orders` and excludes register sales", () => {
    expect(server).toContain('.eq("origin", "greenway")');
    expect(server).toContain('.is("pos_client_uuid", null)');
    expect(server).toContain("isWebsiteOrderRow({");
  });

  it("the server reads register pickups by the SLICE L-37 marker", () => {
    expect(server).toContain("REGISTER_PICKED_UP_NOTE_PREFIX");
    expect(server).toContain('.eq("to_status", "cancelled")');
  });

  it("the server pages every list read and never uses the decimal parser", () => {
    expect((server.match(/pagedAllChecked</g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(server).not.toContain("reportMoneyToMinor");
    expect(server).not.toContain("totalRaw");
    expect(server).toContain("totalMinorUnits: totalMinor");
  });

  it("customer identity is hashed before leaving the server", () => {
    expect(server).toContain('createHash("sha256")');
    expect(server).toContain("customerKey: hashKey(");
  });

  it("the page shows both channels, the comparison, the charts and passes the day range", () => {
    expect(page).toContain("fromDate: range.fromDate");
    expect(page).toContain("toDate: range.toDate");
    expect(page).toContain("channels.comparison.map");
    expect(page).toContain("<OnlineOrdersDailyCharts");
    expect(page).toContain("<OnlineOrdersShareDonuts");
    expect(page).toContain("<OnlineOrdersOutcomeChart");
    expect(page).toContain("<OnlineOrdersTimingCharts");
    expect(page).toContain('label="All online orders"');
    expect(page).toContain('label="Leafly orders"');
    expect(page).not.toContain("totalRaw");
    expect(page).not.toContain("reportMoneyToMinor");
  });

  it("lifecycle rates say what they are out of", () => {
    // Confirmed, Ready and Picked up — each one names its denominator.
    for (const step of ["reachedConfirmed", "reachedReady", "reachedPickedUp"]) {
      expect(page).toContain("${report.lifecycle." + step + "} of ${report.lifecycle.acknowledged} acknowledged");
    }
  });
});
