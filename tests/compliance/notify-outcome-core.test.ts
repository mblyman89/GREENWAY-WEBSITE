/**
 * GW-024 / GW-025 — order-placed email outcomes must be diagnosable, never
 * silently swallowed. Mirrors the embedded self-tests in
 * notify-outcome-core.ts and adds a few edge cases.
 */

import { describe, expect, it } from "vitest";

import {
  __runNotifyOutcomeCoreTests,
  describeSendFailure,
  summarizeNotifyOutcomes,
  type EmailSendOutcome,
} from "@/lib/orders/notify-outcome-core";

describe("notify-outcome-core (GW-024 / GW-025)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runNotifyOutcomeCoreTests()).not.toThrow();
  });

  it("all skipped (email not configured) is quiet and ok", () => {
    const s = summarizeNotifyOutcomes("GW-100034", [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "skipped" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.failures).toHaveLength(0);
    expect(s.logLine).toBeNull();
    expect(s.orderEventNote).toBeNull();
  });

  it("all sent produces one confirmation log line and no timeline note", () => {
    const s = summarizeNotifyOutcomes("GW-100035", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "sent" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.logLine).toContain("GW-100035");
    expect(s.logLine).toContain("customer + staff");
    expect(s.orderEventNote).toBeNull();
  });

  it("a failed staff alert earns the loudest timeline note", () => {
    const s = summarizeNotifyOutcomes("GW-100036", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "failed", detail: "HTTP 401 — API key is invalid" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.failures.map((f) => f.audience)).toEqual(["staff"]);
    expect(s.logLine).toContain("FAILED");
    expect(s.logLine).toContain("401");
    expect(s.orderEventNote).toContain("staff new-order alert");
    expect(s.orderEventNote).toContain("only alert");
  });

  it("a failed customer confirmation tells staff to mention it at pickup", () => {
    const s = summarizeNotifyOutcomes("GW-100037", [
      { audience: "customer", status: "failed", detail: "HTTP 422 — from address not verified" },
      { audience: "staff", status: "sent" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.orderEventNote).toContain("mention it at pickup");
    expect(s.orderEventNote).toContain("staff alert went out");
  });

  it("both failing produces the blunt nobody-was-emailed note", () => {
    const s = summarizeNotifyOutcomes("GW-100038", [
      { audience: "customer", status: "failed", detail: "HTTP 429" },
      { audience: "staff", status: "failed", detail: "HTTP 429" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.failures).toHaveLength(2);
    expect(s.orderEventNote).toContain("Nobody was emailed");
  });

  it("skips are never counted as failures even alongside a failure", () => {
    const outcomes: EmailSendOutcome[] = [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "failed", detail: "HTTP 500" },
    ];
    const s = summarizeNotifyOutcomes("GW-100039", outcomes);
    expect(s.failures).toHaveLength(1);
    expect(s.failures[0].audience).toBe("staff");
  });

  it("a failure with no detail still yields a readable log line", () => {
    const s = summarizeNotifyOutcomes("GW-100040", [
      { audience: "staff", status: "failed" },
    ]);
    expect(s.logLine).toContain("unknown error");
  });

  describe("describeSendFailure", () => {
    it("includes status and a body snippet", () => {
      expect(describeSendFailure(401, '{"message":"API key is invalid"}')).toBe(
        'HTTP 401 — {"message":"API key is invalid"}',
      );
    });

    it("returns status only for an empty body", () => {
      expect(describeSendFailure(500, "")).toBe("HTTP 500");
    });

    it("collapses whitespace and caps long bodies", () => {
      expect(describeSendFailure(422, "x\n\n   y")).toContain("x y");
      expect(describeSendFailure(400, "a".repeat(500)).length).toBeLessThan(220);
    });
  });
});
