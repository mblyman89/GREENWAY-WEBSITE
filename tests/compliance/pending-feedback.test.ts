/**
 * tests/compliance/pending-feedback.test.ts — Slice H12f.
 *
 * Pins the pending-feedback decision rules (src/lib/admin/pending-core.ts):
 * the admin UI must respond INSTANTLY to clicks and may never get stuck busy.
 * Owner: "the button clicks take a really long time to respond… I'll click
 * it, then not know if it worked."
 */
import { describe, it, expect } from "vitest";
import {
  PENDING_SAFETY_TIMEOUT_MS,
  shouldClearPending,
  isEligibleNavClick,
  isServerActionForm,
} from "@/lib/admin/pending-core";

const HERE = "https://shop.example/admin/media?status=draft";

describe("H12f shouldClearPending", () => {
  it("clears the moment the URL changes (redirect landed)", () => {
    expect(
      shouldClearPending({
        hrefAtStart: HERE,
        hrefNow: "https://shop.example/admin/media?status=draft&saved=1",
        submitterConnected: true,
        submitterDisabled: false,
        elapsedMs: 500,
      }),
    ).toEqual({ clear: true, reason: "navigated" });
  });

  it("clears when the pressed button left the document (in-place re-render)", () => {
    expect(
      shouldClearPending({
        hrefAtStart: HERE,
        hrefNow: HERE,
        submitterConnected: false,
        submitterDisabled: false,
        elapsedMs: 500,
      }),
    ).toEqual({ clear: true, reason: "replaced" });
  });

  it("steps aside for buttons that manage their own pending state", () => {
    // AiBusyButton & other client panels set disabled={pending} and render
    // their own spinner — the keeper must not double up on them.
    expect(
      shouldClearPending({
        hrefAtStart: HERE,
        hrefNow: HERE,
        submitterConnected: true,
        submitterDisabled: true,
        elapsedMs: 100,
      }),
    ).toEqual({ clear: true, reason: "self-managed" });
  });

  it("never gets stuck: the safety timeout always clears", () => {
    expect(
      shouldClearPending({
        hrefAtStart: HERE,
        hrefNow: HERE,
        submitterConnected: true,
        submitterDisabled: false,
        elapsedMs: PENDING_SAFETY_TIMEOUT_MS,
      }),
    ).toEqual({ clear: true, reason: "timeout" });
  });

  it("stays pending while the action is still running", () => {
    expect(
      shouldClearPending({
        hrefAtStart: HERE,
        hrefNow: HERE,
        submitterConnected: true,
        submitterDisabled: false,
        elapsedMs: 3000,
      }),
    ).toEqual({ clear: false, reason: "" });
  });
});

const BASE = {
  currentHref: HERE,
  origin: "https://shop.example",
  targetBlank: false,
  hasModifier: false,
  defaultPrevented: false,
  download: false,
};

describe("H12f isEligibleNavClick", () => {
  it("plain left-click on another admin page shows the bar", () => {
    expect(isEligibleNavClick({ ...BASE, href: "/admin/vendors" })).toBe(true);
  });

  it("same path with different query (filter change) shows the bar", () => {
    expect(isEligibleNavClick({ ...BASE, href: "/admin/media?status=published" })).toBe(true);
  });

  it("same path + same query (hash jump / no-op) never shows the bar", () => {
    expect(isEligibleNavClick({ ...BASE, href: "/admin/media?status=draft" })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/admin/media?status=draft#ai-drafts" })).toBe(false);
  });

  it("new-tab, modified, prevented, and download clicks never show the bar", () => {
    expect(isEligibleNavClick({ ...BASE, href: "/admin/vendors", targetBlank: true })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/admin/vendors", hasModifier: true })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/admin/vendors", defaultPrevented: true })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/admin/vendors", download: true })).toBe(false);
  });

  it("external, cross-origin, and non-admin links never show the bar", () => {
    expect(isEligibleNavClick({ ...BASE, href: "https://evil.example/admin/x" })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/" })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: "/menu" })).toBe(false);
    expect(isEligibleNavClick({ ...BASE, href: null })).toBe(false);
  });

  it("bare /admin (dashboard) counts as an admin navigation", () => {
    expect(isEligibleNavClick({ ...BASE, href: "/admin" })).toBe(true);
  });
});

describe("H12f isServerActionForm", () => {
  it("recognises React's server-action sentinel", () => {
    // React marks <form action={serverFn}> with a javascript: sentinel —
    // verified in react-dom-client.production.js.
    expect(isServerActionForm("javascript:throw new Error('A React form was unexpectedly submitted.')")).toBe(true);
  });

  it("leaves client-managed and plain forms alone", () => {
    expect(isServerActionForm(null)).toBe(false);
    expect(isServerActionForm(undefined)).toBe(false);
    expect(isServerActionForm("")).toBe(false);
    expect(isServerActionForm("/search")).toBe(false);
    expect(isServerActionForm("https://example.com/post")).toBe(false);
  });
});
