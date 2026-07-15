/**
 * tests/compliance/leaderboard-core.test.ts
 *
 * Vitest mirror for the B34 budtender-leaderboard core. Key invariants:
 * only PROCESSED sales count; the TODAY board ranks by sales count with NO
 * reliance on money (blind-count discipline); the WEEK board ranks by gross;
 * competition ranking (ties share, next skips); malformed payloads count
 * the sale but contribute zero money.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateLeaderboard,
  rankLeaderboard,
  medalFor,
  __runLeaderboardCoreTests,
  type LeaderboardEventRow,
} from "@/lib/pos/leaderboard-core";

const TODAY = "2026-07-16";

function sale(
  employeeId: string,
  dayKey: string,
  totalMinor: number,
  qty: number,
  status = "processed",
): LeaderboardEventRow {
  return { employeeId, eventType: "sale", status, payload: { totalMinor, lines: [{ quantity: qty }] }, dayKey };
}

describe("aggregateLeaderboard", () => {
  it("splits today vs week and only counts processed sales", () => {
    const boards = aggregateLeaderboard(
      [
        sale("a", TODAY, 5000, 2),
        sale("a", "2026-07-12", 7000, 3),
        sale("b", TODAY, 100, 1, "pending"),
        sale("b", TODAY, 100, 1, "exception"),
        { employeeId: "c", eventType: "no_sale", status: "processed", payload: {}, dayKey: TODAY },
      ],
      TODAY,
    );
    expect(boards.today).toHaveLength(1);
    expect(boards.today[0]).toMatchObject({ employeeId: "a", saleCount: 1, itemCount: 2, grossMinor: 5000 });
    expect(boards.week.find((e) => e.employeeId === "a")).toMatchObject({ saleCount: 2, grossMinor: 12000 });
    expect(boards.week.find((e) => e.employeeId === "b")).toBeUndefined();
    expect(boards.week.find((e) => e.employeeId === "c")).toBeUndefined();
  });

  it("is defensive on malformed payloads and blank employee ids", () => {
    const boards = aggregateLeaderboard(
      [
        { employeeId: "x", eventType: "sale", status: "processed", payload: "garbage", dayKey: TODAY },
        { employeeId: "", eventType: "sale", status: "processed", payload: { totalMinor: 1 }, dayKey: TODAY },
      ],
      TODAY,
    );
    expect(boards.today).toHaveLength(1);
    expect(boards.today[0]).toMatchObject({ employeeId: "x", saleCount: 1, grossMinor: 0, itemCount: 0 });
  });
});

describe("rankLeaderboard", () => {
  const names = { a: "Alex", b: "Bailey", c: "Casey" };

  it("today ranks by sales count regardless of gross", () => {
    const ranked = rankLeaderboard(
      [
        { employeeId: "a", saleCount: 3, itemCount: 5, grossMinor: 999999 },
        { employeeId: "b", saleCount: 4, itemCount: 4, grossMinor: 1 },
      ],
      "today",
      names,
    );
    expect(ranked[0].name).toBe("Bailey");
    expect(ranked[0].rank).toBe(1);
  });

  it("week ranks by gross with sales-count tiebreak, competition ranking skips", () => {
    const ranked = rankLeaderboard(
      [
        { employeeId: "a", saleCount: 2, itemCount: 2, grossMinor: 5000 },
        { employeeId: "b", saleCount: 2, itemCount: 2, grossMinor: 5000 },
        { employeeId: "c", saleCount: 9, itemCount: 9, grossMinor: 400 },
      ],
      "week",
      names,
    );
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
    expect(ranked[2].rank).toBe(3);
    expect(ranked[2].name).toBe("Casey");
  });

  it("unresolvable employees get a safe name", () => {
    const ranked = rankLeaderboard([{ employeeId: "zz", saleCount: 1, itemCount: 1, grossMinor: 1 }], "today", names);
    expect(ranked[0].name).toBe("Unknown");
  });
});

describe("medalFor", () => {
  it("podium medals then empty", () => {
    expect(medalFor(1)).toBe("🥇");
    expect(medalFor(2)).toBe("🥈");
    expect(medalFor(3)).toBe("🥉");
    expect(medalFor(4)).toBe("");
  });
});

describe("self-test harness", () => {
  it("runs clean", () => {
    expect(() => __runLeaderboardCoreTests()).not.toThrow();
  });
});
