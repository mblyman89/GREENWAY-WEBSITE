/**
 * tests/compliance/exception-reminder-core.test.ts (Task AN-6)
 *
 * Vitest mirror of the pure exception-reminder core self-tests: the daily
 * "POS exceptions need review" planner + the nav-badge formatter.
 */
import { describe, expect, it } from "vitest";
import {
  CRITICAL_AGE_DAYS,
  POS_EXCEPTIONS_PATH,
  calendarDaysBetween,
  formatBadgeCount,
  planPosExceptionReminder,
  __runExceptionReminderCoreTests,
} from "@/lib/pos/exception-reminder-core";

describe("exception-reminder-core (AN-6)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runExceptionReminderCoreTests()).not.toThrow();
  });

  it("calendarDaysBetween handles boundaries and garbage", () => {
    expect(calendarDaysBetween("2026-02-10", "2026-02-13")).toBe(3);
    expect(calendarDaysBetween("2026-02-13", "2026-02-13")).toBe(0);
    expect(calendarDaysBetween("2026-01-31", "2026-02-02")).toBe(2);
    expect(calendarDaysBetween("2025-12-31", "2026-01-01")).toBe(1);
    // Never guess: future "oldest" or malformed labels → null.
    expect(calendarDaysBetween("2026-02-14", "2026-02-13")).toBeNull();
    expect(calendarDaysBetween("garbage", "2026-02-13")).toBeNull();
    expect(calendarDaysBetween("2026-02-10", "13-02-2026")).toBeNull();
  });

  it("plans nothing when the queue is empty or inputs are garbage", () => {
    expect(planPosExceptionReminder("2026-02-13", { count: 0, oldestDayKey: null })).toBeNull();
    expect(planPosExceptionReminder("2026-02-13", { count: -1, oldestDayKey: null })).toBeNull();
    expect(planPosExceptionReminder("2026-02-13", { count: 1.5, oldestDayKey: null })).toBeNull();
    expect(planPosExceptionReminder("nope", { count: 3, oldestDayKey: null })).toBeNull();
  });

  it("fresh exception plans a WARNING with a per-day dedupe key and deep link", () => {
    const r = planPosExceptionReminder("2026-02-13", { count: 1, oldestDayKey: "2026-02-13" });
    expect(r).not.toBeNull();
    expect(r!.dedupeKey).toBe("pos-exceptions:2026-02-13");
    expect(r!.stage).toBe("pos_exceptions_daily");
    expect(r!.urgency).toBe("warning");
    expect(r!.linkPath).toBe(POS_EXCEPTIONS_PATH);
    expect(r!.subject).toContain("1 register exception awaiting");
    expect(r!.body).toContain("oldest arrived today");
    // A new day → a new key, so the nag re-fires daily until resolved.
    const next = planPosExceptionReminder("2026-02-14", { count: 1, oldestDayKey: "2026-02-13" });
    expect(next!.dedupeKey).toBe("pos-exceptions:2026-02-14");
  });

  it(`escalates to CRITICAL once the oldest is ${CRITICAL_AGE_DAYS}+ days old`, () => {
    const warn = planPosExceptionReminder("2026-02-13", { count: 2, oldestDayKey: "2026-02-11" });
    expect(warn!.urgency).toBe("warning");
    const crit = planPosExceptionReminder("2026-02-13", { count: 4, oldestDayKey: "2026-02-10" });
    expect(crit!.urgency).toBe("critical");
    expect(crit!.subject).toMatch(/^OVERDUE:/);
    expect(crit!.subject).toContain("4 register exceptions");
    expect(crit!.body).toContain("waiting 3 days");
  });

  it("unknown oldest age stays warning and invents no age", () => {
    const r = planPosExceptionReminder("2026-02-13", { count: 7, oldestDayKey: "garbage" });
    expect(r!.urgency).toBe("warning");
    expect(r!.body).not.toContain("waiting");
  });

  it("formatBadgeCount hides zero/garbage and caps at 99+", () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-5)).toBeNull();
    expect(formatBadgeCount("3")).toBeNull();
    expect(formatBadgeCount(Number.NaN)).toBeNull();
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });
});
