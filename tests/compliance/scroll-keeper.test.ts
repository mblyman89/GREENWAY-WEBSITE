/**
 * tests/compliance/scroll-keeper.test.ts — Slice H12e, rewritten D262.
 *
 * Owner (D262): "I want all tasks to just complete and leave me where I am on
 * the page. I dont want to get jumped around for any reason at all."
 * Pins: an action landing on the same page holds every programmatic scroll
 * (nothing is restored to the old button position); a different page is a
 * real navigation; the hold ends after the tail.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  GUARD_IDLE,
  SCROLL_GUARD_TAIL_MS,
  guardArmed,
  guardOnSettle,
  guardOnStart,
  isRscRequest,
  isServerActionRequest,
  shouldHoldScroll,
} from "@/lib/admin/scroll-keeper-core";

const T = 1_700_000_000_000;
const P = "/admin/vendors/v1";

describe("request detection (next@16.4.3 headers)", () => {
  it("server action = next-action header, any shape/case", () => {
    expect(isServerActionRequest({ "Next-Action": "abc" })).toBe(true);
    expect(isServerActionRequest(new Headers({ "next-action": "abc" }))).toBe(true);
    expect(isServerActionRequest([["next-action", "abc"]])).toBe(true);
    expect(isServerActionRequest({ rsc: "1" })).toBe(false);
    expect(isServerActionRequest(undefined)).toBe(false);
  });
  it("rsc load = rsc: 1", () => {
    expect(isRscRequest({ RSC: "1" })).toBe(true);
    expect(isRscRequest({ accept: "text/x-component" })).toBe(false);
  });
});

describe("scroll hold", () => {
  it("idle never holds", () => {
    expect(shouldHoldScroll(GUARD_IDLE, T, P)).toBe(false);
  });
  it("action in flight on the same page holds; tail holds; then releases", () => {
    let g = guardOnStart(GUARD_IDLE, "action", T, P);
    expect(shouldHoldScroll(g, T + 10, P)).toBe(true);
    g = guardOnSettle(g, T + 500);
    expect(shouldHoldScroll(g, T + 500 + SCROLL_GUARD_TAIL_MS - 1, P)).toBe(true);
    expect(shouldHoldScroll(g, T + 500 + SCROLL_GUARD_TAIL_MS + 1, P)).toBe(false);
  });
  it("an action that lands on a different page does not hold there", () => {
    const g = guardOnStart(GUARD_IDLE, "action", T, P);
    expect(shouldHoldScroll(g, T + 10, "/admin/vendors")).toBe(false);
  });
  it("rsc loads are tracked only while armed (the redirect target load)", () => {
    expect(guardOnStart(GUARD_IDLE, "rsc", T, P)).toBe(GUARD_IDLE);
    let g = guardOnStart(GUARD_IDLE, "action", T, P);
    g = guardOnSettle(g, T + 100);
    g = guardOnStart(g, "rsc", T + 200, P);
    expect(g.inFlight).toBe(1);
    expect(shouldHoldScroll(g, T + 100 + SCROLL_GUARD_TAIL_MS + 5_000, P)).toBe(true); // still loading
    g = guardOnSettle(g, T + 9_000);
    expect(guardArmed(g, T + 9_000 + SCROLL_GUARD_TAIL_MS + 1)).toBe(false);
  });
  it("overlapping actions keep the first page and count both", () => {
    let g = guardOnStart(GUARD_IDLE, "action", T, P);
    g = guardOnStart(g, "action", T + 50, P);
    g = guardOnSettle(g, T + 100);
    expect(g.inFlight).toBe(1);
    expect(g.path).toBe(P);
  });
});

describe("the keeper never restores an old position (D262)", () => {
  const src = readFileSync("src/components/admin/ux/ScrollKeeper.tsx", "utf8");
  it("no record-and-restore of scrollY at submit time", () => {
    expect(src).not.toMatch(/window\.scrollY/);
    expect(src).not.toMatch(/sessionStorage\.setItem/);
  });
});
