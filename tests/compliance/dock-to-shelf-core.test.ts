/**
 * tests/compliance/dock-to-shelf-core.test.ts
 *
 * W12 — pins the dock-to-shelf lead-time math (audit gap G9):
 *   - MEDIANS, not means (robust to one weird weekend);
 *   - NEVER GUESS: no completed timestamp pairs → null → the card shows an
 *     em dash, never an invented number; negative intervals (clock skew)
 *     and unparseable stamps are dropped, not counted;
 *   - approve→live joins each approval to the FIRST publish at-or-after it
 *     (approved drafts ride the next published version, W7); approvals with
 *     no publish after them are open hops and are NOT measured;
 *   - honest formatting: minutes under 1h, hours under 48h, days after.
 */
import { describe, expect, it } from "vitest";
import {
  medianHours,
  nextPublishAfter,
  buildDockToShelfMetrics,
  formatHopHours,
  __runDockToShelfCoreTests,
  type StampPair,
} from "@/lib/catalog/dock-to-shelf-core";

const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();
const pair = (s: number, e: number): StampPair => ({ startIso: at(s), endIso: at(e) });

describe("dock-to-shelf-core (W12)", () => {
  it("median: empty → null (em dash, never a guessed number)", () => {
    expect(medianHours([])).toBeNull();
  });

  it("median: odd count → middle; even count → mean of middle two", () => {
    expect(medianHours([pair(0, 2), pair(0, 4), pair(0, 10)])).toBe(4);
    expect(medianHours([pair(0, 2), pair(0, 4)])).toBe(3);
  });

  it("median: negative intervals and junk stamps are dropped, not counted", () => {
    expect(
      medianHours([pair(5, 1), { startIso: "junk", endIso: at(1) }, pair(0, 6)]),
    ).toBe(6);
    expect(medianHours([pair(5, 1)])).toBeNull();
  });

  it("nextPublishAfter: first publish at-or-after the approval; none yet → null", () => {
    expect(nextPublishAfter(at(3), [at(1), at(5), at(9)])).toBe(at(5));
    expect(nextPublishAfter(at(5), [at(1), at(5)])).toBe(at(5));
    expect(nextPublishAfter(at(10), [at(1), at(5)])).toBeNull();
  });

  it("full build: three hops measured independently; open approve→live hops excluded", () => {
    const m = buildDockToShelfMetrics({
      manifestPairs: [pair(0, 2), pair(0, 4)],
      approvalPairs: [pair(2, 6)],
      approvalTimes: [at(6), at(20)], // at(20) has no publish after → open, unmeasured
      publishedAts: [at(8)], // unsorted input tolerated (sorted internally)
    });
    expect(m.receiveToAcceptHours).toBe(3);
    expect(m.receiveToAcceptCount).toBe(2);
    expect(m.acceptToApproveHours).toBe(4);
    expect(m.acceptToApproveCount).toBe(1);
    expect(m.approveToLiveHours).toBe(2);
    expect(m.approveToLiveCount).toBe(1);
  });

  it("no data anywhere → all hops null with zero counts", () => {
    const m = buildDockToShelfMetrics({
      manifestPairs: [],
      approvalPairs: [],
      approvalTimes: [],
      publishedAts: [],
    });
    expect(m.receiveToAcceptHours).toBeNull();
    expect(m.acceptToApproveHours).toBeNull();
    expect(m.approveToLiveHours).toBeNull();
    expect(m.receiveToAcceptCount + m.acceptToApproveCount + m.approveToLiveCount).toBe(0);
  });

  it("formatting: honest units at every scale", () => {
    expect(formatHopHours(null)).toBe("—");
    expect(formatHopHours(0.5)).toBe("30m");
    expect(formatHopHours(4.26)).toBe("4.3h");
    expect(formatHopHours(23)).toBe("23h");
    expect(formatHopHours(72)).toBe("3d");
  });

  it("embedded self-tests pass", () => {
    const { passed } = __runDockToShelfCoreTests();
    expect(passed).toBeGreaterThan(0);
  });
});
