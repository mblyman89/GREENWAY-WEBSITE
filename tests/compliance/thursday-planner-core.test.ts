/**
 * tests/compliance/thursday-planner-core.test.ts  (PR-P6)
 *
 * THURSDAY BRAND-SALE MULTI-WEEK PLANNER — the pure brain, pinned.
 *
 * The planner lets the owner queue a DIFFERENT brand for each of the next
 * several Thursdays. Each week becomes its own DATE-WINDOWED one-off promotion
 * (weekday=null, a start/end window covering exactly that one Pacific
 * Thursday), so the discount engine turns each week's deal on that Thursday and
 * off at end of day — next week's brand takes over automatically. This suite
 * proves the date math and the transform are safe and predictable:
 *   • next-Thursday enumeration (including "today is Thursday");
 *   • a precise, ordered UTC on/off window per Thursday;
 *   • brand validation against the live menu (case-insensitive, de-duped);
 *   • unknown brands dropped + reported; empty weeks skipped (not errors);
 *   • non-Thursday dates refused; per-week percent clamped to the guided range.
 *
 * These are anchored to fixed calendar dates so they never drift:
 *   2026-08-05 = Wednesday, 2026-08-06 = Thursday, then +7 = 08-13, 08-20.
 */
import { describe, it, expect } from "vitest";
import {
  THURSDAY_INDEX,
  upcomingThursdays,
  thursdayWindowUtc,
  humanThursdayLabel,
  buildPlannedPromotions,
  __runThursdayPlannerTests,
  type PlannedWeek,
} from "../../src/lib/promotions/thursday-planner-core";

const MENU = ["Fairwinds", "Avitas", "Dama", "Top Shelf Co"];

describe("thursday-planner-core: embedded self-tests", () => {
  it("passes every embedded assertion", () => {
    const { passed, failed } = __runThursdayPlannerTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });
});

describe("upcomingThursdays", () => {
  it("returns the next N Thursdays starting from the upcoming one", () => {
    const th = upcomingThursdays(3, "2026-08-05"); // Wednesday
    expect(th).toEqual(["2026-08-06", "2026-08-13", "2026-08-20"]);
  });

  it("includes today when today is itself a Thursday", () => {
    const th = upcomingThursdays(2, "2026-08-06"); // Thursday
    expect(th[0]).toBe("2026-08-06");
    expect(th[1]).toBe("2026-08-13");
  });

  it("every returned date is a Thursday", () => {
    for (const d of upcomingThursdays(6, "2026-08-05")) {
      const [y, mo, day] = d.split("-").map(Number);
      expect(new Date(Date.UTC(y, mo - 1, day)).getUTCDay()).toBe(THURSDAY_INDEX);
    }
  });

  it("clamps count to a sane range (0 → empty, >52 → 52)", () => {
    expect(upcomingThursdays(0, "2026-08-05")).toEqual([]);
    expect(upcomingThursdays(999, "2026-08-05").length).toBe(52);
    expect(upcomingThursdays(-3, "2026-08-05")).toEqual([]);
  });
});

describe("thursdayWindowUtc", () => {
  it("produces an ordered ISO window (start before end)", () => {
    const w = thursdayWindowUtc("2026-08-13");
    expect(w.startsAtUtc.endsWith("Z")).toBe(true);
    expect(w.endsAtUtc.endsWith("Z")).toBe(true);
    expect(new Date(w.startsAtUtc).getTime()).toBeLessThan(
      new Date(w.endsAtUtc).getTime(),
    );
  });

  it("distinct Thursdays produce non-overlapping windows", () => {
    const a = thursdayWindowUtc("2026-08-13");
    const b = thursdayWindowUtc("2026-08-20");
    // a ends before b starts → no overlap, so brands cannot both be live.
    expect(new Date(a.endsAtUtc).getTime()).toBeLessThan(
      new Date(b.startsAtUtc).getTime(),
    );
  });
});

describe("humanThursdayLabel", () => {
  it("formats a friendly month/day label", () => {
    expect(humanThursdayLabel("2026-08-13")).toBe("Aug 13");
    expect(humanThursdayLabel("2026-12-03")).toBe("Dec 3");
  });
});

describe("buildPlannedPromotions", () => {
  it("builds one dated draft per week with a valid brand", () => {
    const plan: PlannedWeek[] = [
      { ymd: "2026-08-06", brands: ["Avitas"], percent: 20 },
      { ymd: "2026-08-13", brands: ["Fairwinds"], percent: 25 },
      { ymd: "2026-08-20", brands: ["Dama"], percent: null },
    ];
    const r = buildPlannedPromotions(plan, MENU, 15);
    expect(r.drafts.length).toBe(3);
    expect(r.scheduledCount).toBe(3);
    expect(r.skippedCount).toBe(0);
    expect(r.drafts[0].brands).toEqual(["Avitas"]);
    expect(r.drafts[0].discountPercent).toBe(20);
    // Week with null percent falls back to the plan default.
    expect(r.drafts[2].discountPercent).toBe(15);
    // Each draft is a real dated window and the title carries its date label.
    expect(r.drafts.every((d) => d.startsAtUtc < d.endsAtUtc)).toBe(true);
    expect(r.drafts[1].title).toContain("Aug 13");
  });

  it("resolves brands case-insensitively and de-dupes", () => {
    const r = buildPlannedPromotions(
      [{ ymd: "2026-08-06", brands: ["avitas", "AVITAS", "  Dama "], percent: 20 }],
      MENU,
      15,
    );
    expect(r.drafts.length).toBe(1);
    expect(r.drafts[0].brands).toEqual(["Avitas", "Dama"]);
  });

  it("drops unknown brands (with a warning) and skips a week with none valid", () => {
    const plan: PlannedWeek[] = [
      { ymd: "2026-08-06", brands: ["Avitas", "Ghost"], percent: 20 },
      { ymd: "2026-08-13", brands: ["Nope"], percent: 20 },
    ];
    const r = buildPlannedPromotions(plan, MENU, 15);
    expect(r.drafts.length).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.drafts[0].brands).toEqual(["Avitas"]);
    expect(r.warnings.some((w) => w.includes("Ghost"))).toBe(true);
  });

  it("refuses a non-Thursday date and warns", () => {
    const r = buildPlannedPromotions(
      [{ ymd: "2026-08-05", brands: ["Avitas"], percent: 20 }], // Wednesday
      MENU,
      15,
    );
    expect(r.drafts.length).toBe(0);
    expect(r.skippedCount).toBe(1);
    expect(r.warnings.some((w) => w.includes("isn't a Thursday"))).toBe(true);
  });

  it("clamps per-week percent to the guided range and reports it", () => {
    const r = buildPlannedPromotions(
      [{ ymd: "2026-08-06", brands: ["Avitas"], percent: 500 }],
      MENU,
      15,
    );
    expect(r.drafts[0].discountPercent).toBe(90);
    expect(r.warnings.some((w) => w.includes("adjusted"))).toBe(true);
  });

  it("returns no drafts and a helpful warning for an empty plan", () => {
    const r = buildPlannedPromotions([], MENU, 15);
    expect(r.drafts.length).toBe(0);
    expect(r.warnings.some((w) => w.toLowerCase().includes("no weeks"))).toBe(true);
  });

  it("titles single vs multiple brands differently", () => {
    const one = buildPlannedPromotions(
      [{ ymd: "2026-08-06", brands: ["Avitas"], percent: 20 }],
      MENU,
      15,
    ).drafts[0].title;
    const many = buildPlannedPromotions(
      [{ ymd: "2026-08-06", brands: ["Avitas", "Dama", "Fairwinds"], percent: 20 }],
      MENU,
      15,
    ).drafts[0].title;
    expect(one).toContain("Avitas 20% off");
    expect(many).toContain("3 brands 20% off");
  });
});
