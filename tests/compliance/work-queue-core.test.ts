/**
 * tests/compliance/work-queue-core.test.ts
 *
 * W2 — pins the Command Center work queue contract:
 *   - the queue only shows rows with real work (count > 0);
 *   - priority order is fixed (overdue → awaiting intake → held lots →
 *     onboarding drafts → POs to send → mastering suggestions);
 *   - each row carries exactly ONE action rooted under /admin/;
 *   - "POs to pay" is deliberately absent until the paid-stamp exists (W9).
 */
import { describe, expect, it } from "vitest";
import {
  buildWorkQueue,
  emptyWorkQueueInputs,
  __runWorkQueueCoreTests,
  type WorkQueueInputs,
  type WorkQueueRowKey,
} from "@/lib/catalog/work-queue-core";

const FULL: WorkQueueInputs = {
  overdueInTransit: 2,
  awaitingIntake: 3,
  heldLots: 1,
  onboardingDrafts: 4,
  posToSend: 5,
  masteringSuggestions: 6,
};

const CANONICAL_ORDER: WorkQueueRowKey[] = [
  "overdue_in_transit",
  "awaiting_intake",
  "held_lots",
  "onboarding_drafts",
  "pos_to_send",
  "mastering_suggestions",
];

describe("work-queue-core: buildWorkQueue", () => {
  it("returns an empty queue when there is genuinely no work", () => {
    expect(buildWorkQueue(emptyWorkQueueInputs())).toEqual([]);
  });

  it("emits all six rows in the fixed priority order when everything has work", () => {
    const rows = buildWorkQueue(FULL);
    expect(rows.map((r) => r.key)).toEqual(CANONICAL_ORDER);
    expect(rows.map((r) => r.priority)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never emits a zero-count row (no padding)", () => {
    const rows = buildWorkQueue({ ...emptyWorkQueueInputs(), heldLots: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("held_lots");
    expect(rows[0].count).toBe(2);
  });

  it("keeps stable priorities on a sparse queue (rows skip, order holds)", () => {
    const rows = buildWorkQueue({
      ...emptyWorkQueueInputs(),
      masteringSuggestions: 9,
      overdueInTransit: 1,
      onboardingDrafts: 7,
    });
    expect(rows.map((r) => r.key)).toEqual([
      "overdue_in_transit",
      "onboarding_drafts",
      "mastering_suggestions",
    ]);
    // Priorities stay canonical even when in-between rows are absent.
    expect(rows.map((r) => r.priority)).toEqual([1, 4, 6]);
  });

  it("marks overdue trucks critical; receiving/held/onboarding warning; the rest info", () => {
    const bySeverity = new Map(buildWorkQueue(FULL).map((r) => [r.key, r.severity]));
    expect(bySeverity.get("overdue_in_transit")).toBe("critical");
    expect(bySeverity.get("awaiting_intake")).toBe("warning");
    expect(bySeverity.get("held_lots")).toBe("warning");
    expect(bySeverity.get("onboarding_drafts")).toBe("warning");
    expect(bySeverity.get("pos_to_send")).toBe("info");
    expect(bySeverity.get("mastering_suggestions")).toBe("info");
  });

  it("gives every row exactly one admin-rooted action", () => {
    for (const row of buildWorkQueue(FULL)) {
      expect(row.actionLabel.length).toBeGreaterThan(0);
      expect(row.actionHref.startsWith("/admin/")).toBe(true);
    }
  });

  it("pins the action targets to the real surfaces", () => {
    const byKey = new Map(buildWorkQueue(FULL).map((r) => [r.key, r.actionHref]));
    expect(byKey.get("overdue_in_transit")).toBe("/admin/inventory/intake");
    expect(byKey.get("awaiting_intake")).toBe("/admin/inventory/intake");
    expect(byKey.get("held_lots")).toBe("/admin/inventory?status=quarantine");
    expect(byKey.get("onboarding_drafts")).toBe("/admin/inventory/drafts");
    expect(byKey.get("pos_to_send")).toBe("/admin/purchasing");
    expect(byKey.get("mastering_suggestions")).toBe("/admin/products/masters?tab=suggestions");
  });

  it("uses singular vs plural copy correctly", () => {
    const one = buildWorkQueue({ ...emptyWorkQueueInputs(), overdueInTransit: 1 });
    expect(one[0].text).toContain("manifest is");
    const many = buildWorkQueue({ ...emptyWorkQueueInputs(), overdueInTransit: 3 });
    expect(many[0].text).toContain("manifests are");
  });

  it('has NO "POs to pay" row — deliberately absent until the W9 paid-stamp exists', () => {
    const keys = buildWorkQueue(FULL).map((r) => r.key as string);
    expect(keys.some((k) => k.includes("pay"))).toBe(false);
  });

  it("embedded self-tests pass", () => {
    expect(__runWorkQueueCoreTests().passed).toBeGreaterThan(0);
  });
});
