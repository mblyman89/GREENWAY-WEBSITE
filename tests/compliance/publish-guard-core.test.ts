/**
 * tests/compliance/publish-guard-core.test.ts
 *
 * SLICE 76 — vitest mirror for the publish safety core. The stakes: the live
 * menu is an atomic snapshot (publish_menu_version swaps the WHOLE menu), and
 * the owner once published a stale 3-item draft over an 18-item live menu.
 * These tests pin the plain-English verdicts, the latest/outdated draft
 * flagging, and the "to fix" explanations with their fix-it links.
 */
import { describe, it, expect } from "vitest";
import {
  __runPublishGuardTests,
  buildPublishVerdict,
  flagDraftFreshness,
  explainDiagnostic,
  PUBLISH_SEMANTICS_COPY,
} from "@/lib/pos/publish-guard-core";

describe("publish-guard-core (SLICE 76)", () => {
  it("embedded self-tests pass", () => {
    const { passed } = __runPublishGuardTests();
    expect(passed).toBeGreaterThanOrEqual(30);
  });

  it("the owner's exact trap reads as DANGER: stale small draft over a newer live menu", () => {
    const v = buildPublishVerdict({
      added: 0,
      removed: 15,
      priceChanged: 0,
      unchanged: 3,
      hasLiveMenu: true,
      stagedCreatedAt: "2026-02-01T10:00:00Z",
      publishedCreatedAt: "2026-02-02T10:00:00Z",
    });
    expect(v.level).toBe("danger");
    expect(v.requiresRemovalConfirm).toBe(true);
    // S16 (bible S16.4): the trap is named in plain words, not capitals.
    expect(v.headline).toContain("older than your live menu");
    expect(v.headline).toContain("15 products");
    expect(v.detail).toContain("take them off the menu");
  });

  it("adds-only publishes are SAFE and need no confirmation", () => {
    const v = buildPublishVerdict({
      added: 5,
      removed: 0,
      priceChanged: 1,
      unchanged: 18,
      hasLiveMenu: true,
    });
    expect(v.level).toBe("safe");
    expect(v.requiresRemovalConfirm).toBe(false);
  });

  it("first-ever publish is SAFE (nothing can be removed)", () => {
    const v = buildPublishVerdict({
      added: 18,
      removed: 0,
      priceChanged: 0,
      unchanged: 0,
      hasLiveMenu: false,
    });
    expect(v.level).toBe("safe");
    expect(v.detail).toContain("18");
  });

  it("S15: freshness is by item SET - the superset is latest even with an older timestamp", () => {
    const flagged = flagDraftFreshness(
      [
        { id: "c", created_at: "2026-02-03T00:00:00Z" },
        { id: "b", created_at: "2026-02-02T12:00:00Z" },
        { id: "a", created_at: "2026-02-01T00:00:00Z" },
      ],
      {
        liveCreatedAt: "2026-02-02T00:00:00Z",
        removedById: new Map<string, number | null>([["c", 4], ["b", 0], ["a", 0]]),
      },
    );
    expect(flagged.map((d) => [d.id, d.freshness])).toEqual([
      ["c", "would_remove"],
      ["b", "latest"],
      ["a", "superseded"],
    ]);
    expect(flagged[0].removedCount).toBe(4);
  });

  it("explains the unmapped-category warning with a Types & Categories fix link", () => {
    const x = explainDiagnostic("draft_inject_unmapped_category", "raw");
    expect(x.fixHref).toBe("/admin/settings/types");
    expect(x.informational).toBe(false);
    expect(x.fix.length).toBeGreaterThan(0);
  });

  it("unknown diagnostic codes keep the raw message and invent no link", () => {
    const x = explainDiagnostic("brand_new_code", "the exact message");
    expect(x.meaning).toBe("the exact message");
    expect(x.fixHref).toBeNull();
  });

  it("the shared semantics copy describes the normal path, not snapshot theory (S16.4)", () => {
    expect(PUBLISH_SEMANTICS_COPY).toBe(
      "Products you approve go live by themselves. This page lists the few updates that need a human first.",
    );
    expect(PUBLISH_SEMANTICS_COPY).not.toMatch(/REPLACES|WHOLE|NEWEST|REMOVE/);
  });
});
