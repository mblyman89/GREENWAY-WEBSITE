/**
 * Vitest mirror + wiring alarm for USAGE-3's client poll gate.
 *
 * Three always-on client pollers now pause while their tab is hidden, poll
 * once immediately when it is seen again, and stop for good when there is
 * nothing more to learn (terminal order, finished crawl). The rules are pure
 * (poll-gate-core); this file pins them and proves each component actually
 * routes its scheduling through them instead of a bare setInterval.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_POLL_MS,
  TERMINAL_ORDER_STATUSES_FOR_CONFIRMATION,
  confirmationPollState,
  isDocumentVisible,
  nextPollDelayMs,
  shouldPollOnVisible,
  __runPollGateCoreTests,
} from "@/lib/ui/poll-gate-core";
import { CLOSED_ORDER_STATUSES } from "@/lib/orders/types";
import { HIDDEN_POLL_MS, VISIBLE_POLL_MS } from "@/lib/orders/new-order-watch-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("poll-gate-core (pure)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runPollGateCoreTests()).not.toThrow();
  });

  it("pauses when hidden, stops when done, otherwise picks the active/idle cadence", () => {
    const base = { activeMs: 4_000, idleMs: 120_000 };
    expect(nextPollDelayMs({ ...base, visible: true, state: "active" })).toBe(4_000);
    expect(nextPollDelayMs({ ...base, visible: true, state: "idle" })).toBe(120_000);
    expect(nextPollDelayMs({ ...base, visible: false, state: "active" })).toBeNull();
    expect(nextPollDelayMs({ ...base, visible: true, state: "done" })).toBeNull();
    expect(shouldPollOnVisible({ visible: true, state: "idle" })).toBe(true);
    expect(shouldPollOnVisible({ visible: true, state: "done" })).toBe(false);
    expect(isDocumentVisible({ visibilityState: "hidden" })).toBe(false);
    expect(isDocumentVisible(undefined)).toBe(true);
  });

  it("the confirmation page's terminal set is exactly the order lifecycle's CLOSED set", () => {
    expect([...TERMINAL_ORDER_STATUSES_FOR_CONFIRMATION].sort()).toEqual([...CLOSED_ORDER_STATUSES].sort());
    for (const s of CLOSED_ORDER_STATUSES) expect(confirmationPollState(s)).toBe("done");
    expect(confirmationPollState("ready")).toBe("idle");
    expect(CONFIRMATION_POLL_MS).toBe(30_000);
  });
});

describe("components route their scheduling through the gate", () => {
  it("OrderConfirmation: no bare setInterval, pauses when hidden, stops on a terminal status", () => {
    const src = stripComments(read("src/components/checkout/OrderConfirmation.tsx"));
    expect(src).not.toContain("setInterval(");
    expect(src).toContain("nextPollDelayMs({");
    expect(src).toContain("confirmationPollState(");
    expect(src).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(src).toContain('document.removeEventListener("visibilitychange", onVisibility)');
    // A transient failure must still re-arm (finally), so the page cannot
    // silently stop updating after one bad response.
    expect(src).toMatch(/finally \{\s*if \(!cancelled\) schedule\(\);/);
    // The cadence is the pinned constant, not a hand-typed number.
    expect(src).not.toMatch(/30_000|30000/);
    expect(src).toContain("CONFIRMATION_POLL_MS");
  });

  it("HarvestJobsLive: 5 s while a job runs, 2 min idle, paused when hidden", () => {
    const src = read("src/components/admin/kb/HarvestJobsLive.tsx");
    expect(src).toContain("const ACTIVE_POLL_MS = 5_000;");
    expect(src).toContain("const IDLE_POLL_MS = 120_000;");
    const code = stripComments(src);
    expect(code).toContain("nextPollDelayMs({");
    expect(code).toContain("shouldPollOnVisible({");
    expect(code).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(code).not.toMatch(/setTimeout\(\(\) => void poll\(\), next\)/);
  });

  it("VendorCrawlStatusChip: 4 s while crawling, 2 min idle, stops for good when finished", () => {
    const src = read("src/components/admin/kb/VendorCrawlStatusChip.tsx");
    expect(src).toContain("const ACTIVE_POLL_MS = 4_000;");
    expect(src).toContain("const IDLE_POLL_MS = 120_000;");
    const code = stripComments(src);
    expect(code).toContain("nextPollDelayMs({");
    expect(code).toMatch(/state = s\.active \? "active" : "done"/);
    expect(code).toContain('document.addEventListener("visibilitychange", onVisibility)');
  });
});

describe("Orders board hidden-tab cadence", () => {
  it("visible stays at the owner's 15 s; hidden backs off to 2 minutes", () => {
    expect(VISIBLE_POLL_MS).toBe(15000);
    expect(HIDDEN_POLL_MS).toBe(120000);
    expect(HIDDEN_POLL_MS).toBeGreaterThan(VISIBLE_POLL_MS);
  });
});
