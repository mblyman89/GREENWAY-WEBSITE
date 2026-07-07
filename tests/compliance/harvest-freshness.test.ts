/**
 * tests/compliance/harvest-freshness.test.ts — Slice H6 (trickle + cadence).
 *
 * Pins the PURE staleness/selection rules in src/lib/kb/harvest-freshness-core.ts:
 *  • quarterly cadence boundary (90 days) is exact and configurable;
 *  • unparseable/missing timestamps fail CLOSED to "never" (eligible for
 *    harvest — the safe direction: worst case is a redundant polite crawl,
 *    never a silently-forgotten vendor);
 *  • due-target selection is never-first then stalest-first, deterministic,
 *    excludes fresh sites entirely, and respects the cap (a trickle must be
 *    a bounded background hum, not a burst).
 */
import { describe, it, expect } from "vitest";
import {
  STALE_AFTER_DAYS,
  classifyFreshness,
  selectDueTargets,
  summarizeFreshness,
  type FreshnessTarget,
} from "@/lib/kb/harvest-freshness-core";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 86_400_000;

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

function target(over: Partial<FreshnessTarget> & { entityId: string }): FreshnessTarget {
  return {
    url: "https://example.com",
    displayName: over.entityId,
    lastHarvestAt: null,
    ...over,
  };
}

describe("classifyFreshness — quarterly cadence", () => {
  it("uses a 90-day default (strategy: re-harvest Tier 1 quarterly)", () => {
    expect(STALE_AFTER_DAYS).toBe(90);
  });

  it("null/undefined/empty → never", () => {
    expect(classifyFreshness(null, NOW)).toBe("never");
    expect(classifyFreshness(undefined, NOW)).toBe("never");
    expect(classifyFreshness("", NOW)).toBe("never");
  });

  it("unparseable timestamps fail CLOSED to never", () => {
    expect(classifyFreshness("not-a-date", NOW)).toBe("never");
  });

  it("boundary: exactly 90 days old is stale; 89.999 days is fresh", () => {
    expect(classifyFreshness(iso(90), NOW)).toBe("stale");
    expect(classifyFreshness(new Date(NOW - 90 * DAY + 1).toISOString(), NOW)).toBe("fresh");
    expect(classifyFreshness(iso(0), NOW)).toBe("fresh");
    expect(classifyFreshness(iso(365), NOW)).toBe("stale");
  });

  it("cadence is configurable", () => {
    expect(classifyFreshness(iso(10), NOW, 7)).toBe("stale");
    expect(classifyFreshness(iso(10), NOW, 30)).toBe("fresh");
  });
});

describe("selectDueTargets — never-first, then stalest-first, capped", () => {
  const fresh = target({ entityId: "fresh", lastHarvestAt: iso(5) });
  const stale100 = target({ entityId: "stale100", lastHarvestAt: iso(100) });
  const stale200 = target({ entityId: "stale200", lastHarvestAt: iso(200) });
  const neverA = target({ entityId: "never-a" });
  const neverB = target({ entityId: "never-b" });

  it("orders never-harvested before stale, oldest stale first, fresh excluded", () => {
    const due = selectDueTargets([fresh, stale100, neverB, stale200, neverA], NOW, 10);
    expect(due.map((t) => t.entityId)).toEqual(["never-a", "never-b", "stale200", "stale100"]);
  });

  it("respects the cap (a trickle is bounded)", () => {
    const due = selectDueTargets([fresh, stale100, neverB, stale200, neverA], NOW, 2);
    expect(due.map((t) => t.entityId)).toEqual(["never-a", "never-b"]);
  });

  it("cap 0 or negative selects nothing", () => {
    expect(selectDueTargets([neverA], NOW, 0)).toEqual([]);
    expect(selectDueTargets([neverA], NOW, -1)).toEqual([]);
  });

  it("is deterministic: name ties break on entityId", () => {
    const a = target({ entityId: "id-a", displayName: "Same" });
    const b = target({ entityId: "id-b", displayName: "Same" });
    expect(selectDueTargets([b, a], NOW, 10).map((t) => t.entityId)).toEqual(["id-a", "id-b"]);
  });

  it("all-fresh input selects nothing (no redundant crawling)", () => {
    expect(selectDueTargets([fresh], NOW, 10)).toEqual([]);
  });
});

describe("summarizeFreshness — cadence card counts", () => {
  it("counts each bucket and due = never + stale", () => {
    const s = summarizeFreshness(
      [
        target({ entityId: "n1" }),
        target({ entityId: "n2" }),
        target({ entityId: "s1", lastHarvestAt: iso(120) }),
        target({ entityId: "f1", lastHarvestAt: iso(1) }),
      ],
      NOW,
    );
    expect(s).toEqual({ never: 2, stale: 1, fresh: 1, due: 3 });
  });

  it("empty input → all zeros", () => {
    expect(summarizeFreshness([], NOW)).toEqual({ never: 0, stale: 0, fresh: 0, due: 0 });
  });
});
